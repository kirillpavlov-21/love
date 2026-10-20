/* Обработчик запросов «Куда идём?» без фреймворка:
   handle(method, url, headers, body, ip) → { status, headers, body }.
   Его вызывают server.mjs (свой сервер / Docker) и yc/main.mjs (Yandex Cloud Functions).
   Протокол: POST {action, …} (Content-Type text/plain — без preflight) или GET ?votes= / ?ratings=1 / ?reviews= / ?s=.
   Ответ всегда JSON: {ok:true, …} или {ok:false, error:'код'}. /admin (или ?admin=1) — страница модерации (вход формой). */
import { cleanText, cleanLine } from './lib/text.mjs';
import { sha256b64, hmacHex, safeEqual, rand62, timeId, TIME_ID_RE, isObj, byteLen, DAY } from './lib/util.mjs';
import { adminPage, loginPage } from './lib/admin.mjs';
import { MAX_SPINS } from './lib/spins.mjs';

export const MAX_BODY = 8192;
export const RETAIN_MS = 90 * DAY;           // голоса, ответы, приглашения — 90 дней после последнего изменения
export const SHORT_MS = 180 * DAY;           // короткие ссылки
export const FIX_MS = 365 * DAY;             // сообщения об ошибках в каталоге
export const MAX_VOTERS = 60;
export const RATINGS_TTL = 5 * 60e3;
export const REPORTS_TO_HIDE = 3;
export const TAGS = ['talk', 'cozy', 'loud', 'first', 'group', 'cheap', 'pricey', 'view', 'service', 'queue'];
const MODES = ['date', 'guys', 'girls'];
const FITS = ['date', 'group', ''];
const CITIES = ['msk', 'spb'];
/* Дедлайн голосования (until, минуты эпохи) — не дальше 14 дней вперёд (+5 минут на спешащие часы телефона) */
export const UNTIL_MAX_MS = 14 * DAY;

/* [сколько, окно в секундах]. Счётчики хранятся в базе (с TTL), в памяти — только быстрый отсев. */
export const LIMITS = {
  ip: [600, 600],          // все запросы с одного IP (CGNAT у мобильных — поэтому щедро)
  ipWrite: [150, 600],     // все POST с одного IP
  allWrite: [20000, 600],  // все POST вообще — защита бюджета
  vote: [120, 600],        // на одно приглашение
  voter: [20, 600],        // на одного голосующего
  spin: [30, 600],         // на одно приглашение: у каждой новой ничьей свой итог колеса
  invite: [30, 600],       // по IP
  close: [20, 600],        // «Закрыть сейчас» — на одно приглашение
  opened: [60, 600],       // на одно приглашение
  answer: [20, 600],       // на одно приглашение
  mine: [60, 600],         // по IP
  reviewIp: [10, 600],
  reviewDev: [5, 600],
  reviewDay: [20, 86400],
  reviewAll: [300, 600],
  report: [30, 600],
  reportDev: [20, 600],
  short: [30, 600],
  shortAll: [2000, 600],
  expand: [120, 600],
  expandMiss: [30, 600],
  fix: [10, 600],
  fixDev: [5, 600],
  fixAll: [200, 600],
  read: [300, 600],        // GET ?reviews= с одного IP
  adminLogin: [10, 600],   // попытки входа в /admin с одного IP — считаются все, и верные тоже
};
/* Модерация: что отправляет отзыв в очередь */
const FLOOD_NEW = 10;      // отзывов с новых устройств за 10 минут по всему сайту
const FLOOD_PLACE = 5;     // отзывов на одно место за 10 минут
const IP_PLACE_DAY = 2;    // опубликованных сразу отзывов на одно место с одного IP за сутки
const NEW_DEV_MS = 3600e3;
const ADMIN_SESSION_MS = 12 * 3600e3;
const SHORT_TEXT = 8;
const RUDE = 2;

const KEY_RE = /^[A-Za-z0-9_-]{22}$/;
const VOTER_ID_RE = /^[A-Za-z0-9_-]{1,12}$/;
const SECRET_RE = /^[\x21-\x7E]{8,128}$/;
const DEV_RE = /^[A-Za-z0-9_-]{8,64}$/;
const PLACE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CODE_RE = /^[A-Za-z0-9]{4,16}$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const LEADERS_RE = /^(0|[1-9]\d{0,2})(,(0|[1-9]\d{0,2}))*$/;
const REF_RE = /^[a-z0-9]{8}$/;          // метка «пришёл по приглашению»: 8 знаков хэша кода исходного приглашения

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const bad = code => new HttpError(400, code);
const rate = () => new HttpError(429, 'rate');

const split = v => String(v || '').split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);

function readConfig(env) {
  const origins = new Set();
  for (const o of split(env.ALLOWED_ORIGINS)) { try { origins.add(new URL(o).origin); } catch (e) { /* пропускаем мусор */ } }
  const sites = [];
  for (const s of split(env.SITE_ORIGINS)) {
    try {
      const u = new URL(s);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
      sites.push({ origin: u.origin, path: u.pathname.endsWith('/') ? u.pathname : u.pathname + '/' });
    } catch (e) { /* пропускаем */ }
  }
  const admin = String(env.ADMIN_TOKEN || '');
  return {
    origins, sites,
    admin: admin.length >= 16 ? admin : '',
    salt: String(env.HASH_SALT || 'kuda-v1'),
  };
}

/* ---------- проверка полей ---------- */
function reqStr(v, re, code) { if (typeof v !== 'string' || !re.test(v)) throw bad(code); return v; }
function reqInt(v, min, max, code) { if (!Number.isInteger(v) || v < min || v > max) throw bad(code); return v; }
function optStr(v, maxRaw, code) {
  if (v == null) return '';
  if (typeof v !== 'string' || v.length > maxRaw) throw bad(code);
  return v;
}
function intList(v, max, lo, hi, code) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > max) throw bad(code);
  const out = [];
  for (const x of v) { reqInt(x, lo, hi, code); if (!out.includes(x)) out.push(x); }
  return out;
}
function cleanVoter(v, now) {
  if (!isObj(v)) throw bad('voter');
  const id = reqStr(v.id, VOTER_ID_RE, 'voter');
  const n = cleanLine(optStr(v.n, 120, 'voter'), 30) || '?';
  if (!(v.y === 0 || v.y === 1 || v.y === true || v.y === false)) throw bad('voter');
  const o = intList(v.o, 20, 0, 99, 'voter');
  const d = intList(v.d, 60, 0, 40000, 'voter');
  // необязательные поля компании: s — номера слотов времени (до 4), m — дни «может быть» (как d), p — «со мной ещё +N».
  // У старых клиентов их нет; пустые не храним и не отдаём — голос выглядит как раньше
  const s = intList(v.s, 4, 0, 3, 'voter');
  const m = intList(v.m, 60, 0, 40000, 'voter').filter(x => !d.includes(x));
  const p = v.p == null ? 0 : reqInt(v.p, 0, 9, 'voter');
  // st — станция метро, откуда поедет («Встретимся посередине»): только название, до 40 знаков
  const st = v.st == null || v.st === '' ? '' : cleanLine(optStr(v.st, 60, 'voter'), 40);
  // t из ссылок — в минутах (старый формат) или мс; будущее не принимаем
  let t = Number(v.t) || 0;
  if (t > 0 && t < 1e11) t *= 60000;
  if (!(t > 0) || t > now) t = now - 1;
  const out = { id, n, y: v.y ? 1 : 0, o, d, t };
  if (out.y) {
    if (s.length) out.s = s;
    if (m.length) out.m = m;
    if (p) out.p = p;
    if (st) out.st = st;
  }
  return out;
}
/* Итог колеса: i — вариант, d — день, L — набор лидеров ничьей ('0,3,5': номера по возрастанию, без повторов,
   i среди них). Без L — как у старых клиентов: один итог на приглашение. */
function cleanSpin(r) {
  if (Number.isInteger(r)) r = { i: r };
  if (!isObj(r)) throw bad('result');
  const out = { i: reqInt(r.i, 0, 199, 'result'), d: null, L: '' };
  if (r.d != null) out.d = reqInt(r.d, 0, 40000, 'result');
  if (r.L != null && r.L !== '') {
    if (typeof r.L !== 'string' || r.L.length > 60 || !LEADERS_RE.test(r.L)) throw bad('result');
    const ids = r.L.split(',').map(Number);
    if (ids.some((x, k) => x > 199 || (k > 0 && x <= ids[k - 1])) || !ids.includes(out.i)) throw bad('result');
    out.L = r.L;
  }
  return out;
}
const s120 = (v, code) => cleanLine(optStr(v, 300, code), 120);
function cleanPick(p, code) {
  if (p == null) return null;
  if (typeof p === 'string') return s120(p, code);
  if (!isObj(p)) throw bad(code);
  const out = {};
  if (p.emoji != null) out.emoji = cleanLine(optStr(p.emoji, 32, code), 16);
  if (p.title != null) out.title = s120(p.title, code);
  if (p.kind != null) out.kind = reqStr(p.kind, /^[a-z]{0,20}$/, code);
  if (p.plan != null && p.plan !== '') out.plan = reqStr(p.plan, PLACE_RE, code);
  if (p.id != null && p.id !== '') out.id = reqStr(p.id, PLACE_RE, code);
  return out;
}
/* Ответ «билет» из режима свидания: только известные поля */
function cleanAnswer(a) {
  if (!isObj(a)) throw bad('answer');
  const out = {};
  const flag = v => { if (!(v === true || v === false || v === 0 || v === 1)) throw bad('answer'); return !!v; };
  if (a.yes != null) out.yes = flag(a.yes);
  if (a.no != null) out.no = flag(a.no);
  if (a.noTries != null) out.noTries = reqInt(a.noTries, 0, 9999, 'answer');
  if (a.hearts != null) out.hearts = reqInt(a.hearts, 0, 9999, 'answer');
  if (a.place != null) out.place = cleanPick(a.place, 'answer');
  if (a.placeText != null) out.placeText = s120(a.placeText, 'answer');
  for (const k of ['date', 'day']) {
    if (a[k] != null && a[k] !== '') out[k] = reqStr(a[k], YMD_RE, 'answer');
  }
  if (a.dateOther != null) out.dateOther = s120(a.dateOther, 'answer');
  if (a.time != null && a.time !== '') out.time = reqStr(a.time, HM_RE, 'answer');
  if (a.timeNext != null) out.timeNext = flag(a.timeNext);   // время после полуночи — уже следующий день
  if (a.food != null) {
    if (!Array.isArray(a.food) || a.food.length > 12) throw bad('answer');
    out.food = a.food.map(f => (typeof f === 'string' ? cleanLine(optStr(f, 120, 'answer'), 60) : cleanPick(f, 'answer')));
  }
  if (a.note != null) out.note = cleanText(optStr(a.note, 1500, 'answer'), { max: 500, keepLinks: true }).text;
  if (a.event != null && a.event !== '') out.event = reqStr(a.event, PLACE_RE, 'answer');
  const json = JSON.stringify(out);
  if (json.length > 4000) throw bad('answer');
  return json;
}

/**
 * @param {object} opts
 * @param {object} opts.store — store/sqlite.mjs или store/ydb.mjs
 * @param {object} [opts.env] — переменные окружения
 * @param {() => number} [opts.now]
 * @param {typeof fetch} [opts.fetch] — для проверки токена Яндекса
 * @param {object} [opts.limits] — переопределить лимиты (тесты)
 * @param {{error: Function, warn?: Function}} [opts.log]
 */
export function createHandler(opts) {
  const store = opts.store;
  const env = opts.env || process.env;
  const now = opts.now || Date.now;
  const fetchImpl = opts.fetch || globalThis.fetch;
  const limits = { ...LIMITS, ...(opts.limits || {}) };
  const log = opts.log || console;
  const cfg = readConfig(env);

  const hid = s => sha256b64(cfg.salt + '|' + s, 22);
  const voteHash = (key, secret) => sha256b64('kuda-v|' + key + '|' + secret, 32);
  const ownerHash = secret => sha256b64('kuda-owner|' + secret, 22);

  /* ---------- лимиты: память → база ---------- */
  const mem = new Map();
  async function over(name, id) {
    const [max, win] = limits[name];
    const k = name + ':' + id;
    const t = now();
    const mk = k + '|' + Math.floor(t / 1000 / win);
    const m = (mem.get(mk) || 0) + 1;
    if (mem.size > 50000) mem.clear();
    mem.set(mk, m);
    if (m > max) return true;                // в этом экземпляре уже перебор — базу не трогаем
    return (await store.hit(k, win, t)) > max;
  }
  async function guard(checks) {
    for (const [name, id] of checks) if (await over(name, id)) throw rate();
  }

  /* ---------- рейтинги: память 5 минут → снимок в базе → пересчёт ---------- */
  let ratingsMem = null, ratingsBusy = null;
  async function ratings() {
    const t = now();
    if (ratingsMem && t - ratingsMem.at < RATINGS_TTL) return ratingsMem;
    if (ratingsBusy) return ratingsBusy;
    ratingsBusy = (async () => {
      try {
        const snap = await store.snapshotGet('ratings');
        if (snap && snap.data && t - snap.at < RATINGS_TTL) return (ratingsMem = { r: snap.data, at: snap.at });
        const r = {};
        const one = (s, n) => (n > 0 ? Math.round((s / n) * 10) / 10 : null);
        // [средняя, сколько, для свидания, для компании, сколько «для свидания», сколько «для компании»] —
        // по двум последним клиент не показывает под-оценку, за которой один-два отзыва
        for (const a of await store.ratingsAgg()) if (a.n > 0) r[a.place] = [one(a.sum, a.n), a.n, one(a.dsum, a.dn), one(a.gsum, a.gn), a.dn, a.gn];
        await store.snapshotPut('ratings', r, t);
        return (ratingsMem = { r, at: t });
      } catch (e) {
        if (ratingsMem) return ratingsMem;    // база недоступна — отдаём что было
        throw e;
      } finally {
        ratingsBusy = null;
      }
    })();
    return ratingsBusy;
  }
  async function ratingsReset() { ratingsMem = null; await store.snapshotDel('ratings'); }

  async function yandexUid(token) {
    if (!token) return '';
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2000);   // клиент ждёт ответа 4 с — Яндексу не больше половины
    try {
      const r = await fetchImpl('https://login.yandex.ru/info?format=json', { headers: { Authorization: 'OAuth ' + token }, signal: ctl.signal });
      if (!r.ok) return '';
      const j = await r.json();
      const id = j && (j.id || j.psuid);
      return id ? hid('y|' + String(id)) : '';
    } catch (e) {
      return '';   // Яндекс не ответил — считаем отзыв анонимным
    } finally {
      clearTimeout(timer);
    }
  }

  const pubReview = r => {
    const o = { id: r.id, stars: r.stars, text: r.text, tags: r.tags, name: r.name, fit: r.fit, at: r.at };
    if (r.reply) o.reply = r.reply;
    if (r.ver) o.ver = true;
    return o;
  };
  const exp = () => now() + RETAIN_MS;

  /* ================= действия ================= */
  const POST = {
    async vote(b, ip) {
      const key = reqStr(b.key, KEY_RE, 'key');
      const t = now();
      const voter = cleanVoter(b.voter, t);
      const secret = reqStr(b.secret, SECRET_RE, 'secret');
      let seeds = [];
      if (b.seed != null) {
        if (!Array.isArray(b.seed) || b.seed.length > MAX_VOTERS) throw bad('seed');
        const m = new Map();
        for (const s of b.seed) { const v = cleanVoter(s, t); if (v.id !== voter.id) m.set(v.id, v); }
        seeds = Array.from(m.values());
      }
      await guard([['ipWrite', ip], ['allWrite', '*'], ['vote', key], ['voter', key + '|' + voter.id]]);
      voter.t = t;
      const r = await store.vote(key, voter, voteHash(key, secret), seeds, { now: t, exp: exp(), max: MAX_VOTERS });
      if (r.status === 'owner') throw new HttpError(403, 'owner');
      if (r.status === 'full') throw new HttpError(409, 'full');
      // дедлайн прошёл (или организатор закрыл голосование) — голос не принимаем
      if (r.status === 'closed') throw new HttpError(409, 'closed');
      return { votes: r.votes, rev: r.rev, spin: r.spin, spins: r.spins, until: r.until == null ? null : r.until };
    },
    /* Ответ: spin — итог для этого L (первый остаётся), spins — все итоги по наборам лидеров */
    async spin(b, ip) {
      const key = reqStr(b.key, KEY_RE, 'key');
      const spin = cleanSpin(b.result);
      await guard([['ipWrite', ip], ['allWrite', '*'], ['spin', key]]);
      const t = now();
      const r = await store.spin(key, { ...spin, t }, { now: t, exp: exp(), max: MAX_SPINS });
      return { spin: r.spin, spins: r.spins, rev: r.rev };
    },
    /* until — дедлайн голосования (минуты эпохи), ref — метка «пришёл по приглашению», city — 'msk' | 'spb'.
       Всё необязательно; запоминается при первой регистрации (повтор их не меняет, «Закрыть сейчас» — меняет until) */
    async invite(b, ip) {
      const key = reqStr(b.key, KEY_RE, 'key');
      const owner = reqStr(b.owner, KEY_RE, 'owner');
      if (!MODES.includes(b.mode)) throw bad('mode');
      const title = cleanLine(optStr(b.title, 300, 'title'), 80);
      const t = now();
      const until = b.until == null ? null : reqInt(b.until, 1, Math.floor((t + UNTIL_MAX_MS) / 60000) + 5, 'until');
      const ref = b.ref == null || b.ref === '' ? '' : reqStr(b.ref, REF_RE, 'ref');
      if (b.city != null && b.city !== '' && !CITIES.includes(b.city)) throw bad('city');
      const city = b.city || '';
      await guard([['ipWrite', ip], ['allWrite', '*'], ['invite', ip]]);
      const r = await store.invite(key, { owner, mode: b.mode, title, until, ref, city }, { now: t, exp: exp() });
      if (r === 'taken') throw new HttpError(409, 'taken');
      return {};
    },
    /* «Закрыть сейчас»: только создатель (его секрет), дедлайн становится «сейчас»; уже закрытое — как было */
    async close(b, ip) {
      const key = reqStr(b.key, KEY_RE, 'key');
      const secret = reqStr(b.ownerSecret, SECRET_RE, 'secret');
      await guard([['ipWrite', ip], ['allWrite', '*'], ['close', key]]);
      const t = now();
      const r = await store.closeVote(key, ownerHash(secret), { now: t, until: Math.floor(t / 60000), exp: exp() });
      if (r.status === 'nf') throw new HttpError(404, 'nf');
      if (r.status === 'owner') throw new HttpError(403, 'owner');
      return { until: r.until, rev: r.rev };
    },
    async opened(b, ip) {
      const key = reqStr(b.key, KEY_RE, 'key');
      const dev = hid('d|' + reqStr(b.dev, DEV_RE, 'dev'));
      await guard([['ipWrite', ip], ['allWrite', '*'], ['opened', key]]);
      await store.devSeen(dev, now());
      await store.opened(key, dev, { now: now(), exp: exp() });
      return {};
    },
    async answer(b, ip) {
      const key = reqStr(b.key, KEY_RE, 'key');
      const json = cleanAnswer(b.answer);
      await guard([['ipWrite', ip], ['allWrite', '*'], ['answer', key]]);
      await store.answer(key, json, { now: now(), exp: exp() });
      return {};
    },
    async mine(b, ip) {
      const secret = reqStr(b.ownerSecret, SECRET_RE, 'secret');
      if (!Array.isArray(b.keys) || b.keys.length > 50) throw bad('keys');
      const keys = Array.from(new Set(b.keys.map(k => reqStr(k, KEY_RE, 'keys'))));
      await guard([['mine', ip]]);
      const owner = ownerHash(secret);
      const all = keys.length ? await store.invites(keys) : {};
      const items = {};
      for (const [k, m] of Object.entries(all)) {
        if (!m.owner || !safeEqual(m.owner, owner)) continue;
        let answer = null;
        try { answer = m.answer ? JSON.parse(m.answer) : null; } catch (e) { answer = null; }
        items[k] = { mode: m.mode, title: m.title, opened: m.opened, firstOpen: m.firstOpen, votes: m.cnt, answer, updated: m.upd, until: m.until == null ? null : m.until };
      }
      return { items };
    },
    async review(b, ip) {
      const place = reqStr(b.place, PLACE_RE, 'place');
      const stars = reqInt(b.stars, 1, 5, 'stars');
      const rawText = optStr(b.text, 1000, 'text');
      const rawName = optStr(b.name, 120, 'name');
      let tags = [];
      if (b.tags != null) {
        if (!Array.isArray(b.tags) || b.tags.length > 5 || b.tags.some(t => !TAGS.includes(t))) throw bad('tags');
        tags = Array.from(new Set(b.tags));
      }
      const fit = b.fit == null ? '' : b.fit;
      if (!FITS.includes(fit)) throw bad('fit');
      const devRaw = reqStr(b.dev, DEV_RE, 'dev');
      const token = b.yandexToken == null || b.yandexToken === '' ? '' : reqStr(b.yandexToken, /^[A-Za-z0-9._-]{10,400}$/, 'token');
      const dev = hid('d|' + devRaw);
      await guard([['ipWrite', ip], ['allWrite', '*'], ['reviewIp', ip], ['reviewDev', dev], ['reviewDay', dev], ['reviewAll', '*']]);

      const tx = cleanText(rawText, { max: 600, mask: true });
      const nm = cleanText(rawName, { max: 30, line: true, mask: true });
      const t = now();
      const yuid = await yandexUid(token);
      let why = '';
      if (tx.links || nm.links) why = 'links';
      else if (tx.text && Array.from(tx.text).length < SHORT_TEXT) why = 'short';
      else if (tx.caps) why = 'caps';
      else if (tx.masked + nm.masked >= RUDE) why = 'rude';
      const first = await store.devSeen(dev, t);
      if (!yuid && t - first < NEW_DEV_MS && (await store.hit('rvnew', 600, t)) > FLOOD_NEW) why = why || 'flood';
      if ((await store.hit('rvplace:' + place, 600, t)) > FLOOD_PLACE) why = why || 'wave';
      // id устройства придумать легко: третий и следующие отзывы на место с одного IP за сутки — через модератора
      if ((await store.hit('rvipp:' + ip + '|' + place, 86400, t)) > IP_PLACE_DAY) why = why || 'ipplace';

      const rec = {
        id: timeId(t), place, stars, text: tx.text, tags, name: nm.text, fit, at: t,
        status: why ? 'pending' : 'ok', why, dev, yuid, ver: yuid ? 1 : 0,
      };
      const owners = ['d:' + dev].concat(yuid ? ['y:' + yuid] : []);
      if ((await store.reviewAdd(rec, owners)) === 'dup') throw new HttpError(409, 'dup');
      return { item: pubReview(rec), pending: !!why };
    },
    async report(b, ip) {
      const id = reqStr(b.id, TIME_ID_RE, 'id');
      const dev = hid('d|' + reqStr(b.dev, DEV_RE, 'dev'));
      const reason = cleanLine(optStr(b.reason, 400, 'reason'), 200);
      await guard([['ipWrite', ip], ['allWrite', '*'], ['report', ip], ['reportDev', dev]]);
      // жалоба считается, только если ни это устройство, ни этот IP на отзыв ещё не жаловались:
      // иначе один человек спрятал бы любой отзыв тремя выдуманными id устройств
      const r = await store.report(id, ['d:' + dev, 'i:' + ip], reason, { now: now(), threshold: REPORTS_TO_HIDE });
      if (!r) throw new HttpError(404, 'nf');
      if (r.status !== 'ok') await ratingsReset();
      return {};
    },
    async short(b, ip) {
      if (!cfg.sites.length) throw new HttpError(503, 'off');
      if (typeof b.url !== 'string' || b.url.length > 4000) throw bad('url');
      let u;
      try { u = new URL(b.url); } catch (e) { throw bad('url'); }
      if (u.username || u.password || !cfg.sites.some(s => s.origin === u.origin && (u.pathname + '/').startsWith(s.path))) throw bad('url');
      await guard([['ipWrite', ip], ['allWrite', '*'], ['short', ip], ['shortAll', '*']]);
      const url = u.href;
      const t = now();
      const code = await store.shortPut(url, sha256b64('u|' + url, 32), { now: t, exp: t + SHORT_MS, gen: () => rand62(7) });
      return { code };
    },
    async fix(b, ip) {
      const place = reqStr(b.place, PLACE_RE, 'place');
      const raw = optStr(b.text, 2000, 'text');
      const dev = hid('d|' + reqStr(b.dev, DEV_RE, 'dev'));
      const text = cleanText(raw, { max: 1000, keepLinks: true }).text;
      if (Array.from(text).length < 3) throw bad('text');
      await guard([['ipWrite', ip], ['allWrite', '*'], ['fix', ip], ['fixDev', dev], ['fixAll', '*']]);
      const t = now();
      await store.devSeen(dev, t);
      await store.fixAdd({ id: timeId(t), place, text, dev, at: t, exp: t + FIX_MS });
      return {};
    },
  };

  async function routeGet(p, ip) {
    if (p.has('votes')) {
      const key = reqStr(p.get('votes'), KEY_RE, 'key');
      const revRaw = p.get('rev');
      const rev = revRaw == null || revRaw === '' ? null : Number(revRaw);
      if (rev !== null && (!Number.isInteger(rev) || rev < 0)) throw bad('rev');
      if (rev !== null) {
        const cur = await store.rev(key);
        if ((cur === null ? 0 : cur) === rev) return { same: true };
      }
      const v = await store.votes(key);
      // until — дедлайн голосования (минуты эпохи) или null: «Закрыть сейчас» видят все, кто опрашивает итоги
      // неизвестное приглашение — прежний ответ без until (старые клиенты), у существующего until есть всегда (null — без дедлайна)
      return v ? { votes: v.votes, rev: v.rev, spin: v.spin, spins: v.spins, until: v.until == null ? null : v.until } : { votes: [], rev: 0, spin: null, spins: {} };
    }
    if (p.has('ratings')) {
      const r = await ratings();
      return { r: r.r, at: r.at, _cache: 'public, max-age=60' };
    }
    if (p.has('reviews')) {
      const place = reqStr(p.get('reviews'), PLACE_RE, 'place');
      const before = p.get('before') ? reqStr(p.get('before'), TIME_ID_RE, 'before') : '';
      const limit = p.get('limit') ? Number(p.get('limit')) : 10;
      reqInt(limit, 1, 20, 'limit');
      await guard([['read', ip]]);
      const r = await store.reviews(place, before, limit);
      return { items: r.items.map(pubReview), total: r.total };
    }
    if (p.has('s')) {
      const code = reqStr(p.get('s'), CODE_RE, 'code');
      await guard([['expand', ip]]);
      const url = await store.shortGet(code, now());
      if (!url) {
        await guard([['expandMiss', ip]]);
        throw new HttpError(404, 'nf');
      }
      return { url };
    }
    return { service: 'kuda', v: 1 };
  }

  /* ---------- ответы ---------- */
  function corsFor(origin) {
    if (!origin) return {};
    if (!cfg.origins.has(origin)) return null;
    return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  }
  const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  function json(status, obj, cors, extra = {}) {
    const cache = obj._cache || 'no-store';
    delete obj._cache;
    return {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache, ...BASE_HEADERS, ...(cors || {}), ...extra },
      body: JSON.stringify(obj),
    };
  }

  /* ================= /admin =================
     Вход — формой с паролем, дальше «сессия» живёт только в скрытом поле форм (HMAC от ADMIN_TOKEN и срока).
     Ни Basic-авторизации, ни cookies: в Yandex Cloud Functions заголовки Authorization и Cookie до функции
     не доходят, а WWW-Authenticate в ответе переименовывается. Все переходы по странице — POST-формы;
     токен сессии одновременно защищает от подделки запросов с чужих сайтов (CSRF). */
  const ADMIN_HEADERS = {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...BASE_HEADERS, 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  };
  const html = (status, body, extra = {}) => ({ status, headers: { ...ADMIN_HEADERS, ...extra }, body });
  const sessionFor = exp => exp.toString(36) + '.' + hmacHex(cfg.admin, 'kuda-admin-session|' + exp).slice(0, 40);
  function sessionOk(s, t) {
    const m = /^([0-9a-z]{1,12})\.[0-9a-f]{40}$/.exec(String(s || ''));
    if (!m) return false;
    const exp = parseInt(m[1], 36);
    return exp > t && exp <= t + ADMIN_SESSION_MS && safeEqual(s, sessionFor(exp));
  }
  async function admin(method, u, h, body, ip) {
    if (!cfg.admin) return html(404, '<!doctype html><title>404</title><p>Страница модерации выключена: задай ADMIN_TOKEN (не короче 16 символов).');
    const self = /\/admin\/?$/.test(u.pathname) ? u.pathname : '?admin=1';
    const login = (status, msg, extra) => html(status, loginPage({ self, msg }), extra);
    if (method === 'GET' || method === 'HEAD') return login(200, '');
    if (method !== 'POST') return html(405, 'Method not allowed', { Allow: 'GET, POST' });
    if (byteLen(body) > MAX_BODY) return html(413, 'Too large');
    const site = h['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return html(403, 'Forbidden');
    const f = new URLSearchParams(typeof body === 'string' ? body : Buffer.from(body || '').toString('utf8'));
    const op = f.get('op') || '';
    const t = now();
    let session = f.get('s') || '';
    let done = '';
    if (op === 'login') {
      // считаем каждую попытку до проверки пароля: после 10 за 10 минут не пускает даже с верным
      if (await over('adminLogin', ip)) return login(429, 'Слишком много попыток входа — подожди 10 минут.', { 'Retry-After': '600' });
      if (!safeEqual(f.get('password') || '', cfg.admin)) return login(401, 'Пароль не подошёл.');
      session = sessionFor(t + ADMIN_SESSION_MS);
    } else if (!sessionOk(session, t)) {
      return login(401, op ? 'Сессия закончилась — войди ещё раз.' : '');
    } else if (op === 'logout') {
      return login(200, 'Выход выполнен. Чтобы вернуться, введи пароль.');
    } else {
      const id = f.get('id') || '';
      const needId = ['approve', 'hide', 'reply', 'fixdone', 'delete'].includes(op);
      if (needId && !TIME_ID_RE.test(id)) return html(400, 'Bad id');
      done = op;
      if (op === 'approve' || op === 'hide') {
        await store.reviewStatus(id, op === 'approve' ? 'ok' : 'hidden', op === 'hide' ? 'admin' : '');
        await ratingsReset();
      } else if (op === 'reply') {
        await store.reviewReply(id, cleanText(f.get('text') || '', { max: 600 }).text);
      } else if (op === 'fixdone') {
        await store.fixDone(id);
      } else if (op === 'delete') {
        // навсегда удаляем только уже скрытый отзыв: два шага вместо подтверждения (страница без скриптов)
        const rec = await store.review(id);
        if (rec && rec.status === 'hidden') { await store.reviewDelete(id); await ratingsReset(); } else done = '';
      } else if (op === 'recompute') {
        await store.ratingsRebuild();
        await ratingsReset();
      } else if (op === 'cleanup') {
        await store.cleanup(now());
      } else {
        done = '';
      }
    }
    // «Отзывы места»: модератору нужно найти любой отзыв, в том числе старый, — например, чтобы удалить по просьбе автора
    const place = op === 'place' && PLACE_RE.test(f.get('place') || '') ? f.get('place') : '';
    const [stats, pending, latest, fixes] = await Promise.all([
      store.stats(t), store.pendingReviews(50), place ? store.placeReviews(place, 100) : store.latestReviews(30), store.fixList(50),
    ]);
    return html(200, adminPage({ stats, pending, latest, fixes, session, self, done, place, now: t }));
  }

  /* ================= вход ================= */
  return async function handle(method, url, headers, body, ip) {
    method = String(method || 'GET').toUpperCase();
    const h = {};
    for (const [k, v] of Object.entries(headers || {})) h[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
    let u;
    try { u = new URL(url || '/', 'http://local'); } catch (e) { return json(400, { ok: false, error: 'url' }, {}); }
    const ipId = hid('ip|' + (ip || '-'));
    if (/\/admin\/?$/.test(u.pathname) || u.searchParams.has('admin')) {
      try {
        return await admin(method, u, h, body, ipId);
      } catch (e) {
        log.error('[kuda] admin: ' + (e && e.message));
        return html(500, 'Ошибка сервера — смотри логи.');
      }
    }
    const cors = corsFor(h.origin);
    if (!cors) return json(403, { ok: false, error: 'origin' }, {});
    if (method === 'OPTIONS') {
      return { status: 204, headers: { ...BASE_HEADERS, ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }, body: '' };
    }
    try {
      if (byteLen(body) > MAX_BODY) throw new HttpError(413, 'big');
      await guard([['ip', ipId]]);
      let res;
      if (method === 'GET') res = await routeGet(u.searchParams, ipId);
      else if (method === 'POST') {
        let b;
        try { b = JSON.parse(typeof body === 'string' ? body : Buffer.from(body || '').toString('utf8')); } catch (e) { throw bad('json'); }
        if (!isObj(b) || typeof b.action !== 'string' || !Object.hasOwn(POST, b.action)) throw bad('action');
        res = await POST[b.action](b, ipId);
      } else throw new HttpError(405, 'method');
      return json(200, { ok: true, ...res }, cors);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { ok: false, error: e.code }, cors, e.status === 429 ? { 'Retry-After': '60' } : {});
      log.error('[kuda] ' + (e && (e.name + ': ' + e.message)));
      const busy = e && /Throttl|Overload|Unavailable|Timeout|ThroughputExceeded|LimitExceeded|TransactionConflict|SQLITE_BUSY|database is locked/i.test(String(e.name) + ' ' + String(e.message));
      return json(busy ? 503 : 500, { ok: false, error: busy ? 'busy' : 'server' }, cors);
    }
  };
}

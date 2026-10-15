/* Проверка relay/Code.gs без Google: загружаем скрипт в node:vm с поддельными сервисами Apps Script
   (свойства, кэш, замок, таблицы, UrlFetch, Utilities, ContentService) и прогоняем основные сценарии.
   Запуск: node relay/test/harness.mjs   (Node 18+, без зависимостей). Код выхода 1 — что-то упало.
   Каждый вызов doPost/doGet/pollBot/cleanup — отдельное «выполнение»: свежий контекст скрипта
   (как в Apps Script), общие только поддельные хранилища. Время — поддельное (W.now). */
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RELAY = path.join(HERE, '..');
const SCRIPT = new vm.Script(fs.readFileSync(path.join(RELAY, 'Code.gs'), 'utf8'), { filename: 'Code.gs' });
const B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DAY = 864e5;
const BOT = 'kuda_test_bot';

/* ======================= поддельный мир ======================= */

function world(props = {}) {
  return {
    now: Date.UTC(2026, 9, 15, 9, 0, 0),
    props: { TG_TOKEN: '123456:TEST', SITE_URL: 'https://pozovi.ru', bot_name: BOT, ...props },
    propReads: 0, propWrites: 0,
    cache: new Map(), evictions: 0,
    lockBusy: false, onLock: null,
    sheets: {}, sheetCreates: 0, sheetOpens: 0, openFail: 0,
    fetches: [], tg: {}, updates: [], members: {}, triggers: [],
    random: null, logs: [],
  };
}
const today = W => Math.floor(W.now / DAY);

function propsApi(W) {
  const size = d => Object.keys(d).reduce((n, k) => n + k.length + String(d[k]).length, 0);
  const check = d => {
    for (const k of Object.keys(d)) if (String(d[k]).length > 9 * 1024) throw new Error('Exception: Argument too large: value');
    if (size(d) > 500 * 1024) throw new Error('Exception: You have exceeded the property storage quota.');
  };
  return {
    getProperty(k) { W.propReads++; return Object.prototype.hasOwnProperty.call(W.props, k) ? W.props[k] : null; },
    getProperties() { W.propReads++; return { ...W.props }; },
    setProperty(k, v) { W.propWrites++; const d = { ...W.props, [k]: String(v) }; check(d); W.props = d; return this; },
    setProperties(map, deleteAllOthers) {
      W.propWrites++;
      const d = deleteAllOthers ? {} : { ...W.props };
      for (const [k, v] of Object.entries(map)) d[k] = String(v);
      check(d); W.props = d; return this;
    },
    deleteProperty(k) { W.propWrites++; delete W.props[k]; return this; },
  };
}

/* Как CacheService: значения — строки, срок до 6 часов, больше 1 000 записей — остаются 900 самых «дальних» по сроку */
function cacheApi(W) {
  const alive = k => { const e = W.cache.get(k); if (!e) return null; if (e.exp <= W.now) { W.cache.delete(k); return null; } return e; };
  const put1 = (k, v, ttl) => {
    if (typeof v !== 'string') throw new Error('cache: значение не строка — ' + k);
    if (k.length > 250) throw new Error('cache: длинный ключ ' + k);
    if (v.length > 100 * 1024) throw new Error('cache: большое значение ' + k);
    ttl = ttl == null ? 600 : ttl;
    if (ttl > 21600) throw new Error('cache: срок больше 6 часов');
    W.cache.set(k, { v, exp: W.now + ttl * 1000 });
  };
  const evict = () => {
    for (const [k, e] of W.cache) if (e.exp <= W.now) W.cache.delete(k);
    if (W.cache.size > 1000) {
      W.cache = new Map([...W.cache.entries()].sort((a, b) => b[1].exp - a[1].exp).slice(0, 900));
      W.evictions++;
    }
  };
  const c = {
    get(k) { const e = alive(k); return e ? e.v : null; },
    getAll(keys) { const o = {}; for (const k of keys) { const e = alive(k); if (e) o[k] = e.v; } return o; },
    put(k, v, ttl) { put1(k, v, ttl); evict(); },
    putAll(map, ttl) { for (const [k, v] of Object.entries(map)) put1(k, v, ttl); evict(); },
    remove(k) { W.cache.delete(k); },
    removeAll(keys) { keys.forEach(k => W.cache.delete(k)); },
  };
  return { getScriptCache: () => c };
}

function lockApi(W, ex) {
  const lock = {
    tryLock(ms) {
      if (ex.held) return true;
      if (W.lockBusy) { W.now += ms; return false; }
      if (W.onLock) { const f = W.onLock; W.onLock = null; f(); }  // «параллельное выполнение» успело что-то поменять
      ex.held = true; return true;
    },
    waitLock(ms) { if (!this.tryLock(ms)) throw new Error('Exception: Lock timeout'); },
    releaseLock() { ex.held = false; },
    hasLock() { return ex.held; },
  };
  return { getScriptLock: () => lock };
}

/* Таблица: без текстового формата строки вида «0123», «12e3», «true» превращаются в число/логическое, как в Google Sheets */
function convert(v, fmt) {
  if (typeof v !== 'string' || fmt === '@') return v;
  if (v.startsWith("'")) return v.slice(1);
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(v)) return Number(v);
  return v;
}
class FakeSheet {
  constructor() { this.rows = []; this.maxRows = 1000; this.maxCols = 26; }
  getMaxColumns() { return this.maxCols; }
  deleteColumns(start, n) {
    if (!(start >= 1 && n >= 1 && start + n - 1 <= this.maxCols)) throw new Error('Exception: Those columns are out of bounds.');
    if (n >= this.maxCols) throw new Error('Exception: Sorry, it is not possible to delete all non-frozen columns.');
    this.rows.forEach(row => row.splice(start - 1, n));
    this.maxCols -= n;
    return this;
  }
  cell(r, c) {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    while (row.length < c) row.push({ v: '', fmt: '' });
    return row[c - 1];
  }
  getLastRow() { for (let i = this.rows.length; i > 0; i--) if (this.rows[i - 1].some(x => x.v !== '')) return i; return 0; }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(after, n) { if (after < this.rows.length) this.rows.splice(after, 0, ...Array.from({ length: n }, () => [])); this.maxRows += n; return this; }
  appendRow(vals) {
    const r = this.getLastRow() + 1;
    if (r > this.maxRows) this.maxRows = r;
    vals.forEach((v, j) => { const cell = this.cell(r, j + 1); cell.v = convert(v, cell.fmt); });
    return this;
  }
  getRange(r, c, nr = 1, nc = 1) {
    if (!(r >= 1 && c >= 1 && r + nr - 1 <= this.maxRows && c + nc - 1 <= this.maxCols)) throw new Error('Exception: The coordinates of the range are outside the dimensions of the sheet.');
    const sh = this;
    const each = f => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) f(i, j); };
    return {
      getValues() { const out = Array.from({ length: nr }, () => Array(nc).fill('')); each((i, j) => { const row = sh.rows[r + i - 1]; const x = row && row[c + j - 1]; out[i][j] = x ? x.v : ''; }); return out; },
      getValue() { return this.getValues()[0][0]; },
      setValues(vals) {
        if (vals.length !== nr || vals.some(x => x.length !== nc)) throw new Error('Exception: The number of rows/columns in the data does not match the range.');
        each((i, j) => { const cell = sh.cell(r + i, c + j); cell.v = convert(vals[i][j], cell.fmt); });
        return this;
      },
      setNumberFormat(f) { each((i, j) => { sh.cell(r + i, c + j).fmt = f; }); return this; },
    };
  }
  deleteRows(start, n) {
    if (n >= this.maxRows) throw new Error('Exception: Sorry, it is not possible to delete all non-frozen rows.');
    this.rows.splice(start - 1, n); this.maxRows -= n; return this;
  }
}
function sheetsApi(W) {
  const ss = id => ({ getId: () => id, getSheets: () => [W.sheets[id]] });
  return {
    create() { W.sheetCreates++; const id = 'sheet-' + W.sheetCreates; W.sheets[id] = new FakeSheet(); return ss(id); },
    openById(id) {
      W.sheetOpens++;
      if (W.openFail > 0) { W.openFail--; throw new Error('Exception: Service Spreadsheets failed while accessing document with id ' + id); }
      if (!W.sheets[id]) throw new Error('Exception: Document ' + id + ' is missing');
      return ss(id);
    },
  };
}

function fetchApi(W) {
  let msg = 0;
  const defaults = {
    getMe: () => ({ ok: true, result: { username: BOT } }),
    getUpdates: p => ({ ok: true, result: W.updates.filter(u => u.update_id >= Number(p.offset || 0)).slice(0, Number(p.limit || 100)) }),
    sendMessage: () => ({ ok: true, result: { message_id: ++msg } }),
    getChatMember: p => ({ ok: true, result: { status: W.members[p.chat_id + ':' + p.user_id] || 'member' } }),
  };
  return {
    fetch(url, opt) {
      const m = String(url).match(/^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/);
      if (!m) throw new Error('UrlFetch: неожиданный адрес ' + url);
      assert.equal(m[1], W.props.TG_TOKEN);
      assert.equal(opt.muteHttpExceptions, true);
      const p = { ...(opt.payload || {}) };
      W.fetches.push({ method: m[2], p, at: W.now });
      const h = W.tg[m[2]] || defaults[m[2]] || (() => ({ ok: true, result: true }));
      const res = h(p);
      return { getContentText: () => JSON.stringify(res), getResponseCode: () => 200 };
    },
  };
}

function utilsApi(W) {
  return {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest(alg, s) { assert.equal(alg, 'SHA_256'); return Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest(), b => (b > 127 ? b - 256 : b)); },
    base64EncodeWebSafe(bytes) { return Buffer.from(Array.from(bytes, b => b & 255)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'); },
    getUuid: () => crypto.randomUUID(),
    sleep(ms) { W.now += ms; },
  };
}

/* Одно выполнение скрипта: свежий контекст, общие хранилища. Проверяем, что замок отпущен. */
function exec(W, call) {
  const ex = { held: false };
  const log = (lvl) => (...a) => W.logs.push(lvl + ' ' + a.map(String).join(' '));
  const ctx = vm.createContext({
    PropertiesService: { getScriptProperties: () => propsApi(W) },
    CacheService: cacheApi(W),
    LockService: lockApi(W, ex),
    SpreadsheetApp: sheetsApi(W),
    UrlFetchApp: fetchApi(W),
    Utilities: utilsApi(W),
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: s => ({ s, mime: '', setMimeType(m) { this.mime = m; return this; }, getContent() { return this.s; } }),
    },
    ScriptApp: {
      getProjectTriggers: () => W.triggers.slice(),
      deleteTrigger: t => { W.triggers = W.triggers.filter(x => x !== t); },
      newTrigger: name => {
        const t = { name, getHandlerFunction: () => name };
        const b = { timeBased: () => b, everyMinutes: n => { t.every = n + 'm'; return b; }, everyDays: n => { t.every = n + 'd'; return b; }, atHour: h => { t.at = h; return b; }, create: () => { W.triggers.push(t); return t; } };
        return b;
      },
    },
    Logger: { log: log('LOG') },
    console: { log: log('LOG'), info: log('INFO'), warn: log('WARN'), error: log('ERROR') },
    __now: () => W.now,
    __rand: () => (W.random ? W.random() : Math.random()),
  });
  vm.runInContext('Date.now = function () { return __now(); }; Math.random = function () { return __rand(); };', ctx);
  SCRIPT.runInContext(ctx);
  const out = call(ctx);
  assert.equal(ex.held, false, 'замок не отпущен');
  return out;
}
const plain = x => JSON.parse(JSON.stringify(x));
const run = (W, src) => plain(exec(W, ctx => vm.runInContext(src, ctx)));
const post = (W, body) => JSON.parse(exec(W, ctx => ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } })).getContent());
const get = (W, params) => JSON.parse(exec(W, ctx => ctx.doGet({ parameter: params })).getContent());
const sends = (W, from = 0) => W.fetches.slice(from).filter(f => f.method === 'sendMessage');

let UPD = 1;
function say(W, chatId, text, { type = 'private', from, sender_chat } = {}) {
  const m = { message_id: UPD, chat: { id: chatId, type }, from: from || { id: chatId, username: 'user' + Math.abs(chatId) }, text };
  if (sender_chat) m.sender_chat = sender_chat;
  W.updates.push({ update_id: UPD++, message: m });
}
function poll(W) { const n = W.fetches.length; exec(W, ctx => ctx.pollBot()); return sends(W, n); }
const keyOf = t => (String(t).match(/<code>([A-Za-z0-9]{24,})<\/code>/) || [])[1];
function startKey(W, chatId, opts) { say(W, chatId, '/start', opts); const s = poll(W); const k = keyOf(s.length && s[s.length - 1].p.text); assert.ok(k, 'бот не прислал ключ'); return k; }
const secret = () => crypto.randomBytes(18).toString('base64url');
const fp = s => crypto.createHash('sha256').update('kuda-tg|' + s, 'utf8').digest('base64url').slice(0, 12);
const b62 = n => { let s = ''; do { s = B62[n % 62] + s; n = Math.floor(n / 62); } while (n > 0); return s; };
const randSeq = idx => { let i = 0; return () => (idx[i++ % idx.length] + 0.5) / 62; };
const LONG = 'https://pozovi.ru/index.html#v=' + 'x'.repeat(80);
const unesc = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/* ======================= сценарии ======================= */

const T = [];
const test = (name, fn) => T.push([name, fn]);

test('siteBase_: корень домена, папка, файл, мусор', () => {
  const cases = {
    'https://pozovi.ru': 'https://pozovi.ru/',
    'https://pozovi.ru/': 'https://pozovi.ru/',
    'https://Pozovi.RU/Love/': 'https://pozovi.ru/Love/',
    'https://user.github.io/love': 'https://user.github.io/love/',
    'https://user.github.io/love/': 'https://user.github.io/love/',
    'https://user.github.io/love/create.html': 'https://user.github.io/love/',
    'https://user.github.io/love/create.html?x=1#k': 'https://user.github.io/love/',
    'https://pozovi.ru:8443?x': 'https://pozovi.ru:8443/',
    'http://pozovi.ru/': '',
    'javascript:alert(1)': '',
    'https://': '',
    '': '',
  };
  for (const [site, want] of Object.entries(cases)) {
    const W = world({ SITE_URL: site });
    assert.equal(run(W, 'siteBase_()'), want, 'SITE_URL=' + JSON.stringify(site));
  }
});

test('cleanText_: фишинг при SITE_URL = корень домена, разметка, порядок обрезки', () => {
  const W = world({ SITE_URL: 'https://pozovi.ru' });
  const ct = s => run(W, 'cleanText_(' + JSON.stringify(s) + ')');
  const evil = ct('Жми https://evil.example/login');
  assert.ok(!evil.includes('https://evil') && evil.includes('https∶//evil․example'), evil);
  assert.equal(ct('Билет: https://pozovi.ru/go.html#s=1abcd'), 'Билет: https://pozovi.ru/go.html#s=1abcd');
  assert.ok(!ct('https://pozovi.ru.evil.com/x').includes('pozovi.ru.evil'), 'поддомен-обманка');
  assert.ok(!ct('https://pozovi.ru@evil.com/').includes('https://'), 'userinfo-обманка');
  assert.equal(ct('<b>Да</b>, идём! &lt;script&gt;'), '<b>Да</b>, идём! &lt;script&gt;');
  assert.equal(ct('<i>x</i>'), '&lt;i&gt;x&lt;/i&gt;');
  assert.equal(ct('<b>жирный'), '<b>жирный</b>');
  assert.equal(ct('</b>текст<b></b>'), 'текст');
  assert.equal(ct('<b>a</b><b>b</b>'), '<b>ab</b>');
  assert.ok(ct('evil<b>.com</b>/login').includes('․'), 'ссылка, разрезанная тегом, тоже обезврежена');
  assert.ok(ct('@scam_admin пиши').startsWith('＠scam_admin'));
  assert.ok(ct('жми /stop').includes('∕stop'));
  assert.ok(!ct('\u200Bhttps://evil.com').includes('\u200B'));
  assert.equal(ct('   '), '');
  // обрезка: сначала раскрываем сущности, потом режем, потом экранируем
  const lt = ct('&lt;'.repeat(5000));
  assert.equal(lt, '&lt;'.repeat(3800), 'видимых символов не больше 3800');
  assert.equal(ct('a'.repeat(3799) + '&amp;b'), 'a'.repeat(3799) + '&amp;', 'сущность не разрезана');
  assert.equal(ct('a'.repeat(3799) + '😀'), 'a'.repeat(3799), 'эмодзи не разрезано пополам');
  assert.equal(ct('<b>' + 'я'.repeat(5000) + '</b>'), '<b>' + 'я'.repeat(3800) + '</b>');
  // defang_ не меняет длину (на этом держится разметка)
  const rnd = () => Array.from({ length: 60 }, () => ' a.@/:hts:/w.ру@x/'[Math.floor(Math.random() * 17)]).join('');
  const samples = Array.from({ length: 300 }, rnd).concat(['https://a.b/c', 'x@abcd /cmd', 'tg://resolve?domain=x', '1.2.3.4:80/x', 'https://pozovi.ru/a b.c']);
  const lens = run(W, 'JSON.parse(' + JSON.stringify(JSON.stringify(samples)) + ').map(function (s) { return defang_(s).length === s.length; })');
  assert.ok(lens.every(Boolean), 'defang_ изменил длину');
});

test('shortAllowed_: только сайт и Яндекс Карты, SHORT_ALLOW без «/» не открывает поддомены', () => {
  const W = world({ SITE_URL: 'https://pozovi.ru' });
  const ok = u => run(W, 'shortAllowed_(' + JSON.stringify(u) + ')');
  assert.equal(ok('https://pozovi.ru/start.html#x=' + 'a'.repeat(20)), true);
  assert.equal(ok('https://yandex.ru/maps/?rtext=55.7,37.6~55.8,37.5'), true);
  assert.equal(ok('https://evil.example/' + 'a'.repeat(20)), false);
  assert.equal(ok('https://pozovi.ru.evil.com/' + 'a'.repeat(20)), false);
  assert.equal(ok('http://pozovi.ru/' + 'a'.repeat(20)), false);
  const W2 = world({ SITE_URL: '', SHORT_ALLOW: 'https://a.ru, ftp://x.ru/' });
  assert.equal(run(W2, 'shortAllowed_("https://a.ru/page.html")'), true);
  assert.equal(run(W2, 'shortAllowed_("https://a.ru.evil.com/page.html")'), false);
  assert.equal(run(W2, 'shortAllowed_("ftp://x.ru/file")'), false);
});

test('бот: /start выдаёт ключ, /key — тот же, /newkey — новый, старый перестаёт работать', () => {
  const W = world();
  const k1 = startKey(W, 101);
  assert.equal(W.props['k_' + k1], '101');
  assert.equal(W.props['c_101'], k1 + '|' + today(W));
  say(W, 101, '/key');
  assert.equal(keyOf(poll(W)[0].p.text), k1);
  say(W, 101, '/newkey');
  const k2 = keyOf(poll(W)[0].p.text);
  assert.ok(k2 && k2 !== k1);
  assert.equal(W.props['k_' + k1], undefined);
  assert.equal(post(W, { action: 'register', key: k1, ids: [] }).error, 'key');
  assert.deepEqual(post(W, { action: 'register', key: k2, ids: [] }), { ok: true, taken: 0, fresh: 0 });
  say(W, 101, 'привет');
  assert.ok(poll(W)[0].p.text.includes('/key'), 'подсказка на обычное сообщение');
  say(W, 101, '/key@other_bot');
  assert.equal(poll(W).length, 0, 'команда другому боту');
  // c_ указывает на чужой ключ (запись-сирота) — выдаём новый, чужой k_ не трогаем
  const alien = 'A'.repeat(24);
  W.props['k_' + alien] = '404';
  W.props.c_303 = alien + '|' + today(W);
  const k3 = startKey(W, 303);
  assert.notEqual(k3, alien);
  assert.equal(W.props['k_' + alien], '404');
});

test('register → notify: отпечаток c, taken, перенос тем же создателем, /stop', () => {
  const W = world();
  const k1 = startKey(W, 101), k2 = startKey(W, 202);
  const s1 = secret(), c1 = fp(s1);
  assert.deepEqual(post(W, { action: 'register', key: k1, s: s1, ids: ['abc123', 'abc123', 'BAD!'] }), { ok: true, taken: 0, fresh: 1 });
  assert.equal(W.props.i_abc123, '101|' + today(W) + '|' + c1);
  assert.equal(post(W, { action: 'register', key: k1, ids: ['zz1'] }).error, 'secret');
  let n = W.fetches.length;
  assert.deepEqual(post(W, { id: 'abc123', c: c1, text: '<b>Да!</b> Идём в https://evil.example' }), { ok: true });
  const m = sends(W, n)[0];
  assert.equal(m.p.chat_id, '101');
  assert.equal(m.p.parse_mode, 'HTML');
  assert.ok(m.p.text.startsWith('<b>Да!</b> Идём в https∶//evil․example'), m.p.text);
  assert.equal(post(W, { id: 'abc123', c: 'wrongwrong12', text: 'x' }).ok, false);
  assert.equal(post(W, { id: 'nope', c: c1, text: 'x' }).ok, false);
  // чужой создатель не перехватит
  assert.deepEqual(post(W, { action: 'register', key: k2, s: secret(), ids: ['abc123'] }), { ok: true, taken: 1, fresh: 0 });
  assert.ok(W.props.i_abc123.startsWith('101|'));
  // тот же создатель (знает s) переносит в другой чат
  assert.deepEqual(post(W, { action: 'register', key: k2, s: s1, ids: ['abc123'] }), { ok: true, taken: 0, fresh: 1 });
  assert.ok(W.props.i_abc123.startsWith('202|'));
  assert.ok(!String(W.props.l_101 || '').split(',').includes('abc123'));
  n = W.fetches.length;
  assert.equal(post(W, { id: 'abc123', c: c1, text: 'ещё' }).ok, true);
  assert.equal(sends(W, n)[0].p.chat_id, '202');
  say(W, 202, '/stop');
  assert.ok(poll(W)[0].p.text.includes('Ключ удалён'));
  assert.equal(W.props.c_202, undefined);
  assert.equal(post(W, { id: 'abc123', c: c1, text: 'после stop' }).ok, false);
  assert.equal(post(W, { action: 'test', key: k2 }).error, 'key');
});

test('notify: продление i_ под замком не затирает перенос и не воскрешает удалённое', () => {
  const W = world();
  const k = startKey(W, 101);
  const s = secret(), c = fp(s);
  post(W, { action: 'register', key: k, s, ids: ['inv1'] });
  const yday = today(W) - 1;
  // пока отправляли, register_ перенёс приглашение в чат 303
  W.props.i_inv1 = '101|' + yday + '|' + c;
  W.onLock = () => { W.props.i_inv1 = '303|' + yday + '|' + c; };
  assert.equal(post(W, { id: 'inv1', c, text: 'да' }).ok, true);
  assert.equal(W.props.i_inv1, '303|' + yday + '|' + c, 'перенос не затёрт');
  // пока отправляли, cleanup удалил запись
  W.props.i_inv1 = '101|' + yday + '|' + c;
  W.onLock = () => { delete W.props.i_inv1; };
  assert.equal(post(W, { id: 'inv1', c, text: 'да' }).ok, true);
  assert.equal(W.props.i_inv1, undefined, 'удалённое не воскресло');
  // замок занят — сообщение уходит, продление откладывается
  W.props.i_inv1 = '101|' + yday + '|' + c;
  W.lockBusy = true;
  assert.equal(post(W, { id: 'inv1', c, text: 'да' }).ok, true);
  assert.equal(W.props.i_inv1, '101|' + yday + '|' + c);
  W.lockBusy = false;
  // обычный случай: продлеваем i_ и отмечаем день у ключа
  W.props.c_101 = k + '|' + (today(W) - 5);
  assert.equal(post(W, { id: 'inv1', c, text: 'да' }).ok, true);
  assert.equal(W.props.i_inv1, '101|' + today(W) + '|' + c);
  assert.equal(W.props.c_101, k + '|' + today(W));
});

test('notify: не больше 4 чтений свойств на сообщение (настройки — из кэша)', () => {
  const W = world();
  const k = startKey(W, 101);
  const s = secret(), c = fp(s);
  post(W, { action: 'register', key: k, s, ids: ['inv1'] });
  post(W, { id: 'inv1', c, text: 'прогрев' });
  const before = W.propReads;
  for (let i = 0; i < 5; i++) assert.equal(post(W, { id: 'inv1', c, text: '<b>a</b> b <b>c</b> https://x.ru d <b>e</b>' }).ok, true);
  const per = (W.propReads - before) / 5;
  assert.ok(per <= 4, 'чтений на уведомление: ' + per);
});

test('короткие ссылки: сокращение, раскрытие из таблицы, текстовый формат хвоста', () => {
  const W = world();
  const r = post(W, { action: 'short', url: LONG });
  assert.equal(r.ok, true);
  assert.match(r.id, /^[A-Za-z0-9]{5,14}$/);
  assert.equal(W.sheetCreates, 1);
  assert.deepEqual(get(W, { s: r.id }), { ok: true, url: LONG });
  W.cache = new Map();  // кэш сбросили — читаем таблицу
  assert.deepEqual(get(W, { s: r.id }), { ok: true, url: LONG });
  assert.equal(post(W, { action: 'short', url: 'https://evil.example/' + 'a'.repeat(80) }).error, 'url');
  // хвосты, которые таблица превратила бы в число / логическое
  for (const tag of ['0123', '12e3', 'TRUE', '1e10']) {
    W.random = randSeq([...tag].map(ch => B62.indexOf(ch)));
    const x = post(W, { action: 'short', url: LONG + tag });
    W.random = null;
    assert.ok(x.id.endsWith(tag), x.id);
    const sh = Object.values(W.sheets)[0];
    assert.equal(typeof sh.rows[sh.getLastRow() - 1][2].v, 'string', 'хвост сохранён текстом: ' + tag);
    W.cache = new Map();
    assert.deepEqual(get(W, { s: x.id }), { ok: true, url: LONG + tag }, 'раскрытие ' + tag);
  }
  // строки, записанные старой версией (appendRow без формата), тоже раскрываются
  const sh = Object.values(W.sheets)[0];
  for (const tag of ['0123', '12e3', 'true']) {
    sh.appendRow([LONG + 'old' + tag, today(W), tag]);
    assert.notEqual(typeof sh.rows[sh.getLastRow() - 1][2].v, 'string');
    W.cache = new Map();
    assert.deepEqual(get(W, { s: b62(sh.getLastRow()) + tag }), { ok: true, url: LONG + 'old' + tag }, 'старая строка ' + tag);
  }
  assert.equal(get(W, { s: 'ab' }).ok, false);
  assert.equal(get(W, { s: '0000a' }).ok, false);
});

test('таблица ссылок: сбой Google не создаёт новую таблицу, повторяем; раскрытие без таблицы её не создаёт', () => {
  const W0 = world();
  assert.deepEqual(get(W0, { s: '1abcd' }), { ok: false });
  assert.equal(W0.sheetCreates, 0);
  const W = world();
  const a = post(W, { action: 'short', url: LONG });
  const id = W.props.short_sheet;
  W.openFail = 5;
  assert.deepEqual(post(W, { action: 'short', url: LONG + '1' }), { ok: false, error: 'busy' });
  assert.equal(W.props.short_sheet, id);
  assert.equal(W.sheetCreates, 1);
  W.openFail = 1;  // один сбой — помогает повтор
  const b = post(W, { action: 'short', url: LONG + '2' });
  assert.equal(b.ok, true);
  W.cache = new Map();
  W.openFail = 5;
  assert.deepEqual(get(W, { s: a.id }), { ok: false, error: 'busy' });
  W.openFail = 0;
  assert.deepEqual(get(W, { s: a.id }), { ok: true, url: LONG });
  assert.deepEqual(get(W, { s: b.id }), { ok: true, url: LONG + '2' });
  assert.equal(W.sheetCreates, 1);
});

test('раскрытие: перебор одной строки не блокирует остальные, номер за концом таблицы не открывает её', () => {
  const W = world();
  const codes = [1, 2, 3].map(i => post(W, { action: 'short', url: LONG + i }).id);
  const row1 = codes[0].slice(0, -4), tag1 = codes[0].slice(-4);
  const bad = tag1 === 'zzzz' ? 'yyyy' : 'zzzz';
  for (let i = 0; i < 20; i++) assert.deepEqual(get(W, { s: row1 + bad }), { ok: false });
  assert.deepEqual(get(W, { s: row1 + bad }), { ok: false, error: 'rate' });
  assert.deepEqual(get(W, { s: codes[0] }), { ok: true, url: LONG + 1 }, 'перебор хвостов чужим человеком не выключает ссылку владельца');
  W.cache.delete('ex_' + codes[0]);
  assert.deepEqual(get(W, { s: codes[0] }), { ok: false, error: 'rate' }, 'без кэша эту строку временно не читаем');
  assert.deepEqual(get(W, { s: codes[1] }), { ok: true, url: LONG + 2 }, 'другие строки работают');
  assert.deepEqual(get(W, { s: codes[2] }), { ok: true, url: LONG + 3 });
  W.now += 11 * 60000;
  assert.deepEqual(get(W, { s: codes[0] }), { ok: true, url: LONG + 1 }, 'через 10 минут снова раскрывается');
  // коды с номером за концом таблицы
  const opens = W.sheetOpens;
  for (let i = 0; i < 100; i++) assert.deepEqual(get(W, { s: b62(1000 + i) + 'abcd' }), { ok: false });
  assert.ok(W.sheetOpens - opens <= 61, 'открытий таблицы: ' + (W.sheetOpens - opens));
  // свежая ссылка раскрывается сразу, даже если сведения о таблице устарели
  const d = post(W, { action: 'short', url: LONG + 4 });
  W.cache.set('shm', { v: JSON.stringify({ ...JSON.parse(W.cache.get('shm').v), last: 3 }), exp: W.now + 3600e3 });
  W.now += 61000;
  assert.deepEqual(get(W, { s: d.id }), { ok: true, url: LONG + 4 });
});

test('лимиты: 20 сообщений на приглашение, 5 тестов, 100 новых приглашений за 10 минут', () => {
  const W = world();
  const k = startKey(W, 101);
  const s = secret(), c = fp(s);
  post(W, { action: 'register', key: k, s, ids: ['inv1'] });
  for (let i = 0; i < 20; i++) assert.equal(post(W, { id: 'inv1', c, text: 'm' + i }).ok, true, 'сообщение ' + i);
  assert.deepEqual(post(W, { id: 'inv1', c, text: 'лишнее' }), { ok: false, error: 'rate' });
  W.now += 10 * 60000;
  assert.equal(post(W, { id: 'inv1', c, text: 'новое окно' }).ok, true);
  for (let i = 0; i < 5; i++) assert.equal(post(W, { action: 'test', key: k }).ok, true);
  assert.equal(post(W, { action: 'test', key: k }).error, 'rate');
  const ids = n => Array.from({ length: 50 }, (_, i) => 'r' + n + 'x' + i);
  assert.equal(post(W, { action: 'register', key: k, s, ids: ids(1) }).fresh, 50);
  assert.equal(post(W, { action: 'register', key: k, s, ids: ids(2) }).fresh, 50);  // 100 новых за окно
  assert.equal(post(W, { action: 'register', key: k, s, ids: ids(3) }).error, 'rate');
  assert.equal(W.props.i_inv1, undefined, 'сто первое (самое старое) вытеснено');
  W.now += 10 * 60000;
  assert.equal(post(W, { action: 'register', key: k, s, ids: ids(3) }).fresh, 50);
  assert.equal(String(W.props.l_101).split(',').length, 100, 'не больше 100 приглашений на чат');
});

test('кэш переполнен: общие счётчики выживают всегда, счётчики «на кого-то» — пока мусор живёт меньше 15 минут', () => {
  const W = world();
  const fill = ttl => exec(W, ctx => {
    const out = [];
    for (let i = 0; i < 3; i++) out.push(ctx.allowAll_([['*tst', 3], ['loc', 3]]));
    const cache = ctx.CacheService.getScriptCache();
    for (let i = 0; i < 2000; i++) cache.put('junk' + ttl + '_' + i, 'x', ttl);
    out.push(ctx.allow_('*tst', 3), ctx.allow_('loc', 3));
    return out;
  });
  // мусор как ex_ (10 минут) — вытесняется раньше любых счётчиков
  assert.deepEqual(fill(600), [true, true, true, false, false]);
  assert.ok(W.evictions > 0);
  W.now += 10 * 60000;
  W.cache = new Map();
  // мусор на час — счётчик «на кого-то» теряется, общий остаётся
  assert.deepEqual(fill(3600), [true, true, true, false, true]);
});

test('UrlFetch: бюджет на 6 часов по ярусам — опрос, запас владельцев, общий; копия счётчика в свойствах', () => {
  const W = world({ URLFETCH_DAY: '3000' });
  assert.deepEqual(run(W, 'fetchCaps_()'), { all: 570, send: 285, base: 243 });
  assert.deepEqual(run(world(), 'fetchCaps_()'), { all: 3800, send: 3400, base: 2890 }, 'бесплатный аккаунт: 5 × 3 800 < 20 000');
  const k1 = startKey(W, 101), k2 = startKey(W, 202);
  const s = secret(), c = fp(s);
  post(W, { action: 'register', key: k1, s, ids: ['inv1'] });
  post(W, { action: 'register', key: k2, s, ids: ['inv2'] });
  // общий бюджет выели (спам, ответы бота)
  exec(W, ctx => { for (let i = 0; i < 400; i++) ctx.send_('101', 'x' + i); });
  assert.equal(W.fetches.length, 243, 'общий потолок');
  // первые 5 сообщений владельца за 10 минут идут из запаса
  for (let i = 0; i < 5; i++) assert.equal(post(W, { id: 'inv1', c, text: 'да ' + i }).ok, true);
  assert.deepEqual(post(W, { id: 'inv1', c, text: 'шестое' }), { ok: false, error: 'busy' });
  assert.equal(post(W, { id: 'inv2', c, text: 'другой владелец' }).ok, true, 'спам одного не оставил без ответов других');
  // запас тоже выели
  exec(W, ctx => { for (let i = 0; i < 400; i++) ctx.send_('202', 'y' + i, 'own'); });
  assert.equal(W.fetches.length, 285);
  assert.deepEqual(post(W, { id: 'inv2', c, text: 'ещё' }), { ok: false, error: 'busy' });
  assert.equal(post(W, { action: 'test', key: k1 }).error, 'busy');
  // опрос Telegram продолжается, но ответы не уходят
  say(W, 101, '/key');
  poll(W);
  assert.equal(W.fetches.length, 286);
  assert.equal(W.fetches[285].method, 'getUpdates');
  // кэш сбросили — счётчик восстанавливается из свойств, а не с нуля
  W.cache = new Map();
  assert.equal(post(W, { action: 'test', key: k1 }).error, 'busy');
  assert.ok(Number(String(W.props.fetch_q).split(':')[1]) >= 275, W.props.fetch_q);
  // следующая четверть
  W.now += 6 * 3600e3;
  assert.equal(post(W, { action: 'test', key: k1 }).ok, true);
});

test('группа: /stop и /newkey — только админы (и анонимный админ), /key — любой', () => {
  const W = world();
  const G = -500, opt = uid => ({ type: 'supergroup', from: { id: uid, username: 'm' + uid } });
  say(W, G, '/key@' + BOT, opt(11));
  const k = keyOf(poll(W)[0].p.text);
  assert.ok(k);
  say(W, G, '/stop@' + BOT, opt(12));
  assert.ok(poll(W)[0].p.text.includes('только админ'));
  assert.equal(W.props['c_' + G].split('|')[0], k, 'ключ на месте');
  say(W, G, '/newkey@' + BOT, opt(12));
  poll(W);
  assert.equal(W.props['c_' + G].split('|')[0], k);
  W.members[G + ':13'] = 'administrator';
  say(W, G, '/newkey@' + BOT, opt(13));
  const k2 = keyOf(poll(W)[0].p.text);
  assert.ok(k2 && k2 !== k);
  say(W, G, '/stop@' + BOT, { type: 'supergroup', from: { id: 1087968824, username: 'GroupAnonymousBot' }, sender_chat: { id: G, type: 'supergroup' } });
  assert.ok(poll(W)[0].p.text.includes('Ключ удалён'));
  assert.equal(W.props['c_' + G], undefined);
  W.members[G + ':14'] = 'creator';
  say(W, G, '/key@' + BOT, opt(11));
  poll(W);
  say(W, G, '/stop@' + BOT, opt(14));
  assert.ok(poll(W)[0].p.text.includes('Ключ удалён'));
  say(W, G, 'просто болтаем', opt(11));
  assert.equal(poll(W).length, 0, 'в группе на обычные сообщения молчим');
});

test('сообщение об ошибке в каталоге уходит в ADMIN_CHAT', () => {
  const W = world({ ADMIN_CHAT: '999' });
  say(W, 101, '/start fix_place-1');
  assert.ok(poll(W)[0].p.text.includes('Опиши'));
  say(W, 101, 'Закрылось <навсегда>');
  const s = poll(W);
  const admin = s.find(x => x.p.chat_id === '999');
  assert.ok(admin && admin.p.text.includes('place-1') && admin.p.text.includes('&lt;навсегда&gt;'));
  assert.ok(s.find(x => x.p.chat_id === 101 || x.p.chat_id === '101'));
});

test('группа стала супергруппой: ключ и приглашения переезжают', () => {
  const W = world();
  const k = startKey(W, -600, { type: 'group' });
  const s = secret(), c = fp(s);
  post(W, { action: 'register', key: k, s, ids: ['g1'] });
  W.tg.sendMessage = p => (p.chat_id === '-600' ? { ok: false, error_code: 400, description: 'group chat was upgraded to a supergroup chat', parameters: { migrate_to_chat_id: -100600 } } : { ok: true, result: {} });
  assert.equal(post(W, { id: 'g1', c, text: 'да' }).ok, true);
  assert.equal(W.props['k_' + k], '-100600');
  assert.ok(W.props['c_-100600'].startsWith(k + '|'));
  assert.ok(W.props.i_g1.startsWith('-100600|'));
  assert.equal(W.props['c_-600'], undefined);
});

test('cleanup: старые приглашения, заброшенные ключи, сироты, старый формат c_; одной записью', () => {
  const W = world({ short_sheet: undefined });
  delete W.props.short_sheet;
  const d = today(W);
  const K = n => ('K' + n).padEnd(24, 'x');
  Object.assign(W.props, {
    tg_offset: '77',
    ['k_' + K(1)]: '701', c_701: K(1) + '|' + (d - 200),                    // заброшен, без приглашений → удалить
    ['k_' + K(2)]: '702', c_702: K(2) + '|' + (d - 200), i_live2: '702|' + (d - 10) + '|cccccccccccc', l_702: 'live2',  // есть приглашение → оставить
    ['k_' + K(3)]: '703', c_703: K(3),                                         // старый формат → допишем день
    ['k_' + K(4)]: '704', c_704: K(5) + '|' + d,                             // k_K4 — сирота
    c_705: K(6) + '|' + d,                                                     // c_ без k_ — сирота
    ['k_' + K(7)]: '707', c_707: K(7) + '|' + (d - 3),                        // живой
  });
  for (let i = 0; i < 60; i++) W.props['i_old' + i] = '707|' + (d - 120) + '|cccccccccccc';
  W.props.l_707 = Array.from({ length: 60 }, (_, i) => 'old' + i).join(',');
  const writes = W.propWrites;
  exec(W, ctx => ctx.cleanup());
  assert.ok(W.propWrites - writes <= 2, 'записей в свойства: ' + (W.propWrites - writes));
  assert.equal(W.props['k_' + K(1)], undefined); assert.equal(W.props.c_701, undefined);
  assert.equal(W.props['k_' + K(2)], '702'); assert.ok(W.props.i_live2); assert.equal(W.props.l_702, 'live2');
  assert.equal(W.props.c_703, K(3) + '|' + d);
  assert.equal(W.props['k_' + K(4)], undefined); assert.equal(W.props.c_704, undefined);
  assert.equal(W.props.c_705, undefined);
  assert.equal(W.props['k_' + K(7)], '707');
  assert.equal(Object.keys(W.props).filter(k => k.startsWith('i_old')).length, 0);
  assert.equal(W.props.l_707, undefined);
  assert.equal(W.props.TG_TOKEN, '123456:TEST'); assert.equal(W.props.tg_offset, '77'); assert.equal(W.props.SITE_URL, 'https://pozovi.ru');
});

test('cleanup: короткие ссылки старше 90 дней удаляются, номера остальных не съезжают', () => {
  const W = world();
  const now = W.now;
  W.now = now - 100 * DAY;
  const old = [1, 2, 3, 4, 5].map(i => post(W, { action: 'short', url: LONG + 'old' + i }).id);
  W.now = now - 10 * DAY;
  const fresh = [6, 7, 8].map(i => post(W, { action: 'short', url: LONG + 'new' + i }).id);
  W.now = now;
  W.cache = new Map();
  exec(W, ctx => ctx.cleanup());
  assert.equal(W.props.short_off, '5');
  assert.equal(Object.values(W.sheets)[0].getLastRow(), 3);
  for (const c of old) assert.deepEqual(get(W, { s: c }), { ok: false });
  fresh.forEach((c, i) => assert.deepEqual(get(W, { s: c }), { ok: true, url: LONG + 'new' + (i + 6) }));
  const n = post(W, { action: 'short', url: LONG + 'after' });
  assert.equal(n.id.slice(0, -4), b62(9));
  W.cache = new Map();
  assert.deepEqual(get(W, { s: n.id }), { ok: true, url: LONG + 'after' });
  // все строки устарели — лист не ломается
  W.now += 200 * DAY;
  exec(W, ctx => ctx.cleanup());
  assert.equal(W.props.short_off, '9');
  assert.equal(Object.values(W.sheets)[0].getLastRow(), 0);
  const z = post(W, { action: 'short', url: LONG + 'z' });
  assert.equal(z.id.slice(0, -4), b62(10));
  assert.deepEqual(get(W, { s: z.id }), { ok: true, url: LONG + 'z' });
});

test('хранилище почти полное: register чистит самые старые приглашения одной записью', () => {
  const W = world();
  const k = startKey(W, 101);
  const d = today(W);
  for (let i = 0; i < 13500; i++) W.props['i_f' + i] = '-100' + (i % 500) + '|' + (d - 80 + (i % 60)) + '|cccccccccccc';
  const usage = () => Object.keys(W.props).reduce((n, x) => n + x.length + String(W.props[x]).length, 0);
  assert.ok(usage() > 420 * 1024, 'заполнено: ' + usage());
  const writes = W.propWrites;
  const r = post(W, { action: 'register', key: k, s: secret(), ids: ['new1'] });
  assert.deepEqual(r, { ok: true, taken: 0, fresh: 1 });
  assert.ok(usage() <= 345 * 1024, 'после чистки: ' + usage());
  assert.ok(W.propWrites - writes <= 2, 'записей: ' + (W.propWrites - writes));
  assert.ok(W.props.i_new1 && W.props['k_' + k] === '101');
});

test('замок занят: register/short отвечают busy, опрос пропускает минуту', () => {
  const W = world();
  const k = startKey(W, 101);
  W.lockBusy = true;
  assert.deepEqual(post(W, { action: 'register', key: k, s: secret(), ids: ['x1'] }), { ok: false, error: 'busy' });
  assert.deepEqual(post(W, { action: 'short', url: LONG }), { ok: false, error: 'busy' });
  const n = W.fetches.length;
  exec(W, ctx => ctx.pollBot());
  assert.equal(W.fetches.length, n);
  W.lockBusy = false;
});

test('setupTriggers, doGet, мусор в doPost', () => {
  const W = world();
  delete W.props.bot_name;
  exec(W, ctx => ctx.setupTriggers());
  assert.equal(W.props.bot_name, BOT);
  assert.deepEqual(W.triggers.map(t => t.name + ':' + t.every), ['pollBot:1m', 'cleanup:1d']);
  exec(W, ctx => ctx.setupTriggers());
  assert.equal(W.triggers.length, 2, 'повторный запуск не плодит триггеры');
  assert.deepEqual(get(W, {}), { ok: true, bot: BOT });
  exec(W, ctx => ctx.stats());
  assert.ok(W.logs.some(l => l.includes('Пользователей:') && l.includes('из 3800')), 'stats пишет в журнал');
  assert.deepEqual(post(W, 'not json'), { ok: false });
  assert.deepEqual(post(W, 'null'), { ok: false });
  assert.deepEqual(post(W, { action: 'short' }), { ok: false, error: 'url' });
});

test('cleanText_: обходы обезвреживания — хвост ссылки на сайт, «китайские» точки, невидимки, команды после знаков', () => {
  const W = world({ SITE_URL: 'https://pozovi.ru' });
  const ct = s => run(W, 'cleanText_(' + JSON.stringify(s) + ')');
  const live = t => /(?:^|[^\w.․])(?:evil|scam)[.\u3002\uFF0E\uFF61]com/i.test(t) || /:\/\//.test(t.replace(/https:\/\/pozovi\.ru\/[A-Za-z0-9\-._~/?#=&%+]*/g, ''));
  // Telegram обрывает ссылку на «, », ", <, >, ' — то, что после, стало бы отдельной живой ссылкой
  for (const s of ['https://pozovi.ru/«evil.com/login', 'https://pozovi.ru/"evil.com', 'https://pozovi.ru/&lt;evil.com',
    "https://pozovi.ru/x'evil.com", 'https://pozovi.ru/x)evil.com', 'https://pozovi.ru/»https://evil.com']) {
    const t = ct(s);
    assert.ok(t.startsWith('https://pozovi.ru/'), 'ссылка на сайт осталась: ' + t);
    assert.ok(!live(unesc(t)), 'обход: ' + s + ' → ' + t);
  }
  for (const s of ['evil\u3002com/login', 'evil\uFF0Ecom', 'evil\uFF61com', 'evil\u00AD.com', 'evil.\u00ADcom', 'evil\u200D.com',
    'tg://resolve?domain=scam', 'ton://x', 'Зайди на 1.2.3.4/x', 'EVIL.COM', 'пример.рф', 'evil.xn--p1ai']) {
    const t = ct(s);
    assert.ok(!/[.\u3002\uFF0E\uFF61](?=[\p{L}\p{N}])/u.test(t) && !t.includes('://'), s + ' → ' + t);
  }
  // команды: Telegram видит /команду после пробела и знаков препинания, но не после букв, «/», «<», «>»
  for (const s of ['Срочно:/stop', 'жми →/newkey', '!/stop', '(/stop)', '/stop']) assert.ok(!/\/stop|\/newkey/.test(ct(s)), s + ' → ' + ct(s));
  assert.equal(ct('Привет/пока и 1/2'), 'Привет/пока и 1/2', 'дроби и слова через «/» не трогаем');
  assert.equal(ct('<i>x</i>'), '&lt;i&gt;x&lt;/i&gt;');
  // ссылка на сайт целиком остаётся нажимаемой
  assert.equal(ct('Билет: https://pozovi.ru/index.html#Ab3_-x&v=1~2%20 и всё'), 'Билет: https://pozovi.ru/index.html#Ab3_-x&amp;v=1~2%20 и всё');
  // эмодзи со склейкой не распадаются, невидимки вокруг обычных букв — убираются
  assert.equal(ct('Сауна 🧖\u200D♀\uFE0F, кот 🐈\u200D⬛, семья 👨\u200D👩\u200D👧'), 'Сауна 🧖\u200D♀\uFE0F, кот 🐈\u200D⬛, семья 👨\u200D👩\u200D👧');
  assert.equal(ct('a\u200Db\u00ADc\u2066d'), 'abcd');
  assert.equal(ct('a\uD83Db\uDC00c😀'), 'abc😀', 'одиночные половинки суррогатных пар убраны (Telegram не принял бы текст)');
  // обычный русский текст не портится заметно: точка перед буквой — «․», выглядит так же
  assert.equal(ct('Встречаемся в 19.30, ок? Да. Идём!'), 'Встречаемся в 19․30, ок? Да. Идём!');
});

test('сообщение об ошибке: ссылки в тексте и имени обезврежены, ник остаётся', () => {
  const W = world({ ADMIN_CHAT: '999' });
  say(W, 101, '/start fix_place-1', { from: { id: 101, first_name: 'evil.com' } });
  poll(W);
  say(W, 101, 'Закрылось, смотри https://evil.example/x и @scam_bot', { from: { id: 101, first_name: 'evil.com' } });
  const a = poll(W).find(x => x.p.chat_id === '999');
  assert.ok(a && !a.p.text.includes('https://') && a.p.text.includes('evil․example') && a.p.text.includes('＠scam_bot'), a && a.p.text);
  assert.ok(a.p.text.includes('от evil․com'), a.p.text);
  say(W, 102, '/start fix_place-2', { from: { id: 102, username: 'real_user' } });
  poll(W);
  say(W, 102, 'Другие часы', { from: { id: 102, username: 'real_user' } });
  assert.ok(poll(W).find(x => x.p.chat_id === '999').p.text.includes('от @real_user'));
  // без ADMIN_CHAT «Записали» — правда: сообщение лежит в журнале выполнений
  const W2 = world();
  say(W2, 101, '/start fix_place-3');
  poll(W2);
  say(W2, 101, 'Переехали на Тверскую');
  assert.ok(poll(W2)[0].p.text.includes('Записали'));
  assert.ok(W2.logs.some(l => l.includes('place-3') && l.includes('Переехали на Тверскую')), 'сообщение в журнале');
});

test('бот: поток команд от одного чата не тратит замок и свойства сверх лимита ответов', () => {
  const W = world();
  startKey(W, 101);
  const r0 = W.propReads, w0 = W.propWrites, f0 = W.fetches.length;
  for (let i = 0; i < 300; i++) say(W, 101, i % 2 ? '/key' : '/start');
  poll(W); poll(W); poll(W);
  const n = sends(W, f0).length;
  assert.ok(n <= 12, 'ответов: ' + n);
  assert.ok(W.propReads - r0 <= 40, 'чтений свойств: ' + (W.propReads - r0));
  assert.ok(W.propWrites - w0 <= 6, 'записей свойств: ' + (W.propWrites - w0));
  // другой человек в это время получает ответ
  say(W, 202, '/start');
  assert.ok(keyOf(poll(W)[0].p.text));
});

test('/stop с записью-сиротой не удаляет ключ другого чата', () => {
  const W = world();
  const k = startKey(W, 404);
  W.props.c_303 = k + '|' + today(W);  // c_ указывает на чужой ключ
  say(W, 303, '/stop');
  assert.ok(poll(W)[0].p.text.includes('Ключ удалён'));
  assert.equal(W.props['k_' + k], '404', 'ключ чата 404 цел');
  assert.equal(W.props.c_303, undefined);
});

test('тексты бота: блок «Уведомления в Telegram» и ссылка на конструктор', () => {
  for (const [site, want] of [['https://pozovi.ru', 'https://pozovi.ru/create.html'], ['https://user.github.io/love/start.html', 'https://user.github.io/love/create.html']]) {
    const W = world({ SITE_URL: site });
    say(W, 101, '/start');
    const t = poll(W)[0].p.text;
    assert.ok(t.includes('«Уведомления в Telegram»'), t);
    assert.ok(t.includes('Конструктор: ' + want), t);
  }
  const W = world({ SITE_URL: 'http://insecure.ru' });
  say(W, 101, '/start');
  assert.ok(!poll(W)[0].p.text.includes('Конструктор:'));
});

test('таблица ссылок: 3 столбца вместо 26; старая таблица обрезается при чистке', () => {
  const W = world();
  post(W, { action: 'short', url: LONG });
  const sh = Object.values(W.sheets)[0];
  assert.equal(sh.getMaxColumns(), 3);
  sh.maxCols = 26;  // как у таблицы прежней версии
  exec(W, ctx => ctx.cleanup());
  assert.equal(sh.getMaxColumns(), 3);
  W.cache = new Map();
  const r = post(W, { action: 'short', url: LONG + 'x' });
  assert.deepEqual(get(W, { s: r.id }), { ok: true, url: LONG + 'x' });
});

test('раскрытие: устаревший сдвиг строк в кэше после ночной чистки исправляется сам', () => {
  const W = world();
  const now = W.now;
  W.now = now - 100 * DAY;
  [1, 2, 3].forEach(i => post(W, { action: 'short', url: LONG + 'old' + i }));
  W.now = now - DAY;
  const fresh = [4, 5, 6].map(i => post(W, { action: 'short', url: LONG + 'new' + i }).id);
  W.now = now;
  exec(W, ctx => ctx.cleanup());
  assert.equal(W.props.short_off, '3');
  assert.equal(JSON.parse(W.cache.get('shm').v).off, 3, 'чистка сразу кладёт новые сведения');
  // гонка: параллельное раскрытие успело записать в кэш сведения со старым сдвигом
  W.cache.set('shm', { v: JSON.stringify({ id: W.props.short_sheet, off: 0, last: 6, at: W.now }), exp: W.now + 3600e3 });
  W.now += 61000;
  fresh.forEach((c, i) => { W.cache.delete('ex_' + c); assert.deepEqual(get(W, { s: c }), { ok: true, url: LONG + 'new' + (i + 4) }, 'ссылка ' + c); });
  assert.equal(JSON.parse(W.cache.get('shm').v).off, 3);
});

test('в relay/ нет названий Telegram-каналов и чужих аккаунтов', () => {
  const allowed = new Set(['BotFather', 'userinfobot']);
  for (const f of ['Code.gs', 'README.md', 'appsscript.json']) {
    const src = fs.readFileSync(path.join(RELAY, f), 'utf8');
    for (const m of src.matchAll(/t\.me\/([A-Za-z0-9_]{3,})/g)) assert.ok(allowed.has(m[1]), f + ': t.me/' + m[1]);
    for (const m of src.matchAll(/(?:^|[^\w.@/])@([A-Za-z][A-Za-z0-9_]{3,})/g)) assert.ok(allowed.has(m[1]), f + ': @' + m[1]);
    assert.ok(!/из канала|пост в канале/i.test(src), f + ': упоминание канала');
  }
});

/* ======================= запуск ======================= */

let failed = 0;
for (const [name, fn] of T) {
  try {
    fn();
    console.log('ok   ' + name);
  } catch (err) {
    failed++;
    console.log('FAIL ' + name + '\n     ' + String(err && err.stack || err).split('\n').slice(0, 6).join('\n     '));
  }
}
console.log('\n' + (T.length - failed) + ' из ' + T.length + ' сценариев прошли');
process.exit(failed ? 1 : 0);

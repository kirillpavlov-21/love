#!/usr/bin/env node
/* Конвейер каталога «Куда идём?».
   Источники (Telegram, Instagram, ящик в issues) → модель вытаскивает факты → код проверяет их
   (совпадения с каталогом, геокодер, метро, правила планов) → assets/auto.js + отчёт для Pull Request.
   Имена источников живут только в папке состояния (--state; в Actions это служебная ветка pipeline-data —
   на сайт она не публикуется, но в публичном репозитории видна на GitHub), в отчёте и описании PR.
   Issues ящика закрывает close-inbox.mjs — отдельным шагом, когда PR уже создан.
   Справка: node pipeline/run.mjs --help */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchChannel, normChannel } from './lib/sources/telegram.mjs';
import { fetchAccount, normUsername } from './lib/sources/instagram.mjs';
import { fetchInbox } from './lib/sources/inbox.mjs';
import {
  loadCatalog, findMatch, slugId, catOf, catalogIndex, validatePlan, nearbyPlaces, nameSim, normName, distM, CATS,
} from './lib/catalog.mjs';
import { geocode, inMoscowRegion, nearestMetro, okrOf } from './lib/geo.mjs';
import { findCommonsCandidates, savePhoto } from './lib/photos.mjs';
import { makeLLM, moscowDay, officialUrl } from './lib/llm.mjs';
import { renderAutoJs, emptyAutoData } from './lib/autojs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

// posts — сколько постов отдаём модели за запуск (остальные ждут следующего, попытка не считается)
export const LIMITS = { places: 25, events: 30, plans: 15, planPlaces: 10, closed: 5, posts: 120 };
// $ за 1 млн токенов; запись в кеш на час — вдвое дороже обычного ввода
export const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 8 };
const SEEN_DAYS = 120;
const FIRST_RUN_DAYS = 21;
const MAX_ATTEMPTS = 3;              // столько раз пробуем пост, на который модель ничего не вернула
const MIN_CONF = { place: 0.6, event: 0.6, closure: 0.8 };
const MAX_METRO_M = 3000;
const GEOCACHE_MAX = 5000;
const GEO_FAILS_MAX = 3;             // столько сбоев геокодера подряд — и до конца запуска его не трогаем
const BUDGET_MIN = 35;               // минут на разбор постов моделью (задача в Actions живёт 60)
const DUP_EVENT_M = 150;             // события ближе — одна площадка
const FITS = ['date', 'guys', 'girls'];
const EVENT_CATS = ['concert', 'theatre', 'exhibition', 'standup', 'festival', 'sport', 'show', 'party', 'lecture', 'kids'];
const PLACE_HINTS = ['first', 'autumn', 'halloween', 'view'];
// точность геокодера «только улица / район» — координаты могут уехать на километры
const WEAK_PRECISION = new Set(['', 'street', 'road', 'other', 'suburb', 'quarter', 'neighbourhood', 'city_district', 'district',
  'city', 'town', 'village', 'hamlet', 'locality', 'province', 'area', 'county', 'state', 'country']);

const USAGE = `Конвейер каталога «Куда идём?»

  node pipeline/run.mjs [флаги]

  --state <папка>     состояние и список источников (по умолчанию .pipeline-data)
  --repo <папка>      корень сайта, где лежит assets/ (по умолчанию — репозиторий конвейера)
  --report <файл>     куда положить отчёт для PR (по умолчанию ./pipeline-report.md)
  --inbox-out <файл>  список issues ящика, которые закрыть после PR (по умолчанию ./pipeline-inbox.json)
  --dry               ничего не писать в assets/ и не трогать прочитанное (только отчёт <дата>-dry.md и кеш геокодера)
  --mock <папка>      ответы модели из сохранённых файлов (тесты)
  --record <папка>    сохранять ответы модели в папку (потом их можно проиграть через --mock)
  --max-posts N       сколько постов брать с источника за запуск (40)
  --budget-min N      сколько минут запуска отдать разбору постов (35), остальное — в следующий раз
  --since-days N      не разбирать посты старше N дней (по умолчанию 21 — только при первом запуске источника)
  --no-llm            только скачать источники и показать счётчики
  --no-photos         не искать фото на Wikimedia Commons
  --today ГГГГ-ММ-ДД  считать сегодняшней эту дату (для воспроизведения запусков)

Переменные окружения: ANTHROPIC_API_KEY (обязательно, кроме --mock/--no-llm), YANDEX_GEOCODER_KEY,
IG_ACCESS_TOKEN + IG_USER_ID, GITHUB_TOKEN + GITHUB_REPOSITORY (ящик в issues), PIPELINE_SOURCES (JSON вместо sources.json).
Последняя строка вывода — CHANGES=1 или CHANGES=0. Код выхода 1 — модель не ответила ни разу
или недоступны все источники одного вида: состояние тогда сохранять не нужно.`;

/* ---------- мелочи ---------- */

const sleep = ms => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve());
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
export const moscowToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
export const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const r6 = x => Math.round(x * 1e6) / 1e6;
const km = m => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} км` : `${Math.round(m)} м`);
const clone = x => JSON.parse(JSON.stringify(x));
const uniq = a => [...new Set(a)];
const escRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Ошибка разбора JSON без куска файла: V8 цитирует текст («…"chan_two",]…»), а в sources.json и state.json
   имена источников, лог же в публичном репозитории виден всем. Оставляем только место ошибки */
export function jsonError(file, e) {
  const m = /line (\d+) column (\d+)/.exec(e && e.message) || null;
  const pos = /position (\d+)/.exec(e && e.message);
  return new Error(`${file}: не JSON` + (m ? ` (строка ${m[1]}, столбец ${m[2]})` : pos ? ` (позиция ${pos[1]})` : ''));
}

async function readJson(file, fallback) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(`${file}: ${e.code || e.message}`);
  }
  try { return JSON.parse(text); } catch (e) { throw jsonError(file, e); }
}
// запись через временный файл: оборванный запуск не оставит половину JSON
async function writeAtomic(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, text);
  await fs.rename(tmp, file);
}

/* ---------- флаги ---------- */

export function parseArgs(argv) {
  const o = { state: '.pipeline-data', repo: REPO, report: 'pipeline-report.md', inboxOut: 'pipeline-inbox.json', dry: false, mock: '', record: '',
    maxPosts: 40, budgetMin: BUDGET_MIN, sinceDays: null, llm: true, photos: true, today: '', help: false };
  const num = (flag, v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${flag}: нужно целое число от 1`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    const flag = eq > 0 ? a.slice(0, eq) : a;
    const val = () => {
      if (eq > 0) return a.slice(eq + 1);
      const v = argv[++i];
      if (v === undefined || String(v).startsWith('--')) throw new Error(`${flag}: нужно значение`);
      return String(v);
    };
    switch (flag) {
      case '--state': o.state = val(); break;
      case '--repo': o.repo = val(); break;
      case '--report': o.report = val(); break;
      case '--inbox-out': o.inboxOut = val(); break;
      case '--mock': o.mock = val(); break;
      case '--record': o.record = val(); break;
      case '--max-posts': o.maxPosts = num(flag, val()); break;
      case '--budget-min': o.budgetMin = num(flag, val()); break;
      case '--since-days': o.sinceDays = num(flag, val()); break;
      case '--today': o.today = val(); if (!isDate(o.today)) throw new Error('--today: нужна дата ГГГГ-ММ-ДД'); break;
      case '--dry': o.dry = true; break;
      case '--no-llm': o.llm = false; break;
      case '--no-photos': o.photos = false; break;
      case '-h': case '--help': o.help = true; break;
      default: throw new Error(`неизвестный флаг ${a} (см. --help)`);
    }
  }
  return o;
}

/* ---------- источники и состояние ---------- */

/* sources.json: { telegram: [...], instagram: [...], inbox: true } → нормализованные имена без дублей */
export function normSources(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const list = v => (Array.isArray(v) ? v : []);
  const tg = list(s.telegram).map(normChannel), ig = list(s.instagram).map(normUsername);
  return {
    telegram: uniq(tg.filter(Boolean)),
    instagram: uniq(ig.filter(Boolean)),
    inbox: s.inbox === true,
    invalid: tg.filter(x => !x).length + ig.filter(x => !x).length,
  };
}

/* state.json: { tg: {канал: lastId}, ig: {аккаунт: lastTs}, seen: {ключ поста: дата}, retry: {…}, geocache: {…} } */
export function normState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return { tg: obj(s.tg), ig: obj(s.ig), seen: obj(s.seen), retry: obj(s.retry), geocache: obj(s.geocache), lastRun: String(s.lastRun || '') };
}

/* Забываем прочитанные посты старше days дней: курсоры каналов всё равно не дадут их скачать снова */
export function pruneSeen(seen, today, days = SEEN_DAYS) {
  const cut = addDays(today, -days);
  let n = 0;
  for (const [k, d] of Object.entries(seen)) if (!(typeof d === 'string' && d >= cut)) { delete seen[k]; n++; }
  return n;
}

function trimCache(cache, max = GEOCACHE_MAX) {
  const keys = Object.keys(cache);
  for (let i = 0; i < keys.length - max; i++) delete cache[keys[i]];
}

/* ---------- разбор полей ---------- */

const cleanName = s => String(s || '').replace(/[«»"“”„]/g, '').replace(/\s+/g, ' ').trim();
/* «г. Москва, ул. Покровка, 9, Россия» → «ул. Покровка, 9» */
export function cleanAddr(s) {
  return String(s || '').split(',').map(x => x.replace(/\s+/g, ' ').trim())
    .filter(x => x && !/^(г\.?\s*)?москва$|^россия$|^\d{6}$/i.test(x)).join(', ');
}

const KIND_BY_CAT = { food: 'Кафе', coffee: 'Кофейня', bar: 'Бар', culture: 'Культурное пространство', walk: 'Прогулка',
  fun: 'Развлечения', spa: 'Баня', books: 'Книжный магазин', pc: 'Компьютерный клуб' };
const EMOJI_BY_KIND = [
  [/вин/i, '🍷'], [/коктейл/i, '🍸'], [/пив|паб|крафт/i, '🍺'], [/коф/i, '☕'], [/чай/i, '🍵'], [/пекар|булоч/i, '🥐'],
  [/кондитер|десерт/i, '🍰'], [/пицц/i, '🍕'], [/бургер/i, '🍔'], [/суши|рамен|япон/i, '🍣'], [/хинкал|грузин/i, '🥟'],
  [/стейк|мяс/i, '🥩'], [/устриц|рыб|морепрод/i, '🦪'], [/музе/i, '🏛️'], [/театр/i, '🎭'], [/кино/i, '🎬'],
  [/галере|выстав/i, '🖼️'], [/концерт|джаз|музык/i, '🎵'], [/парк|сад|сквер/i, '🌳'], [/набереж/i, '🌊'], [/смотров/i, '🏙️'],
  [/усадьб/i, '🏰'], [/книж/i, '📚'], [/компьютер|кибер/i, '🎮'], [/бан[яиь]|спа|хамам/i, '🧖'], [/караоке|стендап/i, '🎤'],
  [/боулинг/i, '🎳'], [/бильярд/i, '🎱'], [/квест/i, '🗝️'], [/скалодром/i, '🧗'], [/бар|лаунж/i, '🍸'],
];
const EMOJI_BY_CAT = { food: '🍽️', coffee: '☕', bar: '🍸', culture: '🏛️', walk: '🌳', fun: '🎉', spa: '🧖', books: '📚', pc: '🎮' };
export const emojiFor = (kind, cat) => (EMOJI_BY_KIND.find(([rx]) => rx.test(kind || '')) || [null, EMOJI_BY_CAT[cat] || '📍'])[1];
const EVENT_EMOJI = { concert: '🎵', theatre: '🎭', exhibition: '🖼️', standup: '🎤', festival: '🎪', sport: '🏟️', show: '✨',
  party: '🪩', lecture: '🎓', kids: '🧸' };

/* Станция метро, упомянутая у элемента (area) или единственная в тексте поста («м. Китай-город»):
   подсказка геокодеру, где искать адрес, если в Москве несколько одинаковых улиц */
export function stationHint(area, text, stations) {
  const names = Object.keys(stations || {});
  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е');
  const W = '[^а-яa-z0-9-]';
  const found = s => {
    const t = ' ' + norm(s).replace(/[«»"()]/g, ' ') + ' ';
    return names.filter(n => n.length >= 4 && new RegExp(`${W}${escRx(norm(n))}(?=${W})`).test(t));
  };
  const longest = list => list.sort((a, b) => b.length - a.length)[0];
  let name = area ? longest(found(area)) : null;
  if (!name && text) {
    // просмотр назад, чтобы «м. А и м. Б» дало обе станции
    const mentions = [...String(text).matchAll(/(?<=(?:^|[\s(,;])(?:м\.|метро|ст\.\s*м\.)\s*«?)[А-ЯЁ][^,.;:\n)»]{2,40}/g)].map(m => m[0]);
    const hits = uniq(mentions.map(m => longest(found(m))).filter(Boolean));
    if (hits.length === 1) name = hits[0];
  }
  if (!name) return null;
  const [lat, lon] = stations[name];
  return { name, lat, lon };
}

/* Слова о закрытии: без них в тексте поста закрытие не принимаем, как бы ни была уверена модель */
export const CLOSURE_RX = /закры|последн\S*\s+(день|рабоч)|прекраща|больше не работ|не будет работать/i;

/* Цитата-доказательство закрытия: предложение с «закрылось / последний день…», не длиннее 20 слов */
export function evidenceQuote(text, maxWords = 20) {
  const t = String(text || '').replace(/\s*\(https?:\/\/[^)]*\)/g, '').replace(/https?:\/\/\S+/g, '');
  // предложения и строки (заголовок поста без точки — отдельная строка)
  const sentences = t.split(/\n+|(?<=[.!?…])\s+/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const s = sentences.find(x => CLOSURE_RX.test(x)) || sentences[0] || '';
  const w = s.split(' ').filter(Boolean);
  const q = w.length > maxWords ? w.slice(0, maxWords).join(' ') + ' …' : w.join(' ');
  return q.replace(/«/g, '„').replace(/»/g, '“');           // внутри наших «ёлочек» — „лапки“
}

const sameName = (a, b) => {
  const x = normName(a), y = normName(b);
  return x === y || nameSim(a, b) >= 0.75 || (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)));
};

/* Занятые id: места каталога, ключи таблицы фото в photos.js и файлы в assets/ph —
   новое место не должно получить чужое фото или затереть картинку.
   files — файлы Commons, которые уже стоят у мест: одно фото здания не раздаём разным заведениям */
const fileKey = f => String(f || '').replace(/ /g, '_').normalize('NFC');
async function photoIndex(repoDir, catalog) {
  const taken = new Set(Object.keys(catalog.places));
  const files = new Set();
  for (const p of Object.values(catalog.places)) if (p && p.ph && p.ph.file) files.add(fileKey(p.ph.file));
  try {
    const js = await fs.readFile(path.join(repoDir, 'assets/photos.js'), 'utf8');
    for (const m of js.matchAll(/^\s*["']([a-z0-9][a-z0-9-]*)["']\s*:\s*\[\s*(?:"([^"]+)"|'([^']+)')?/gm)) {
      taken.add(m[1]);
      if (m[2] || m[3]) files.add(fileKey(m[2] || m[3]));
    }
  } catch (e) { /* нет photos.js — нечего учитывать */ }
  for (const dir of ['assets/ph', 'assets/ph/t']) {
    try {
      for (const f of await fs.readdir(path.join(repoDir, dir))) if (f.endsWith('.webp')) taken.add(f.slice(0, -5));
    } catch (e) { /* папки ещё нет */ }
  }
  return { taken, files };
}

/* ---------- события: id и повторы ---------- */

const shortSlug = (s, n) => {
  const x = slugId(s);
  return x.length > n ? (x.slice(0, n).replace(/-[^-]*$/, '') || x.slice(0, n)) : x;
};
/* ev-<название>-<площадка>-<ГГГГММДД>: одинаковые названия в разных местах в один день — разные события */
export const eventId = (ev, venue = '') => {
  const t = slugId(ev.title);
  const v = venue ? shortSlug(venue, 24) : '';
  return `ev-${t}${v && v !== 'place' && !t.endsWith(v) ? '-' + v : ''}-${String(ev.start).replace(/-/g, '')}`;
};

/* Одно и то же событие под разными заголовками: «Щелкунчик» и «Балет „Щелкунчик“» */
export function similarTitle(a, b) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  if (x === y || nameSim(a, b) >= 0.8) return true;
  const A = x.split(' '), B = y.split(' ');
  const [s, l] = A.length <= B.length ? [A, new Set(B)] : [B, new Set(A)];
  return s.every(w => l.has(w)) && s.some(w => w.length >= 5);
}

/* Повтор события: те же дни (или пересекающиеся у выставок), похожее название и та же площадка —
   по id места, по точке в пределах 150 м или по названию площадки. → найденное событие или null */
export function findDupEvent(e, list) {
  const eEnd = e.end || e.start;
  for (const x of list || []) {
    if (!x || !x.start || !x.title) continue;
    const xEnd = x.end || x.start;
    const overlap = e.start <= xEnd && x.start <= eEnd && (xEnd !== x.start || eEnd !== e.start);
    if (x.start !== e.start && !overlap) continue;
    if (!similarTitle(e.title, x.title)) continue;
    const d = Number.isFinite(e.lat) && Number.isFinite(x.lat) ? distM(e, x) : Infinity;
    if ((e.place && x.place && e.place === x.place) || d <= DUP_EVENT_M
      || (e.venue && x.venue && sameName(e.venue, x.venue) && !(d < Infinity && d > 1500))) return x;
  }
  return null;
}

/* ---------- описание своими словами ---------- */

const wordsOf = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim().split(' ').filter(Boolean);
/* Самый длинный общий кусок (в словах) описания и текста поста. keep — факты, которые брать можно
   (название, площадка, адрес): их вырезаем из обоих текстов, чтобы они не считались копией */
export function copiedRun(note, text, keep = []) {
  const cut = (w, tag) => {
    const out = w.slice();
    for (const k of keep.map(wordsOf).filter(x => x.length)) {
      for (let i = 0; i + k.length <= out.length; i++) {
        if (k.every((x, j) => out[i + j] === x)) for (let j = 0; j < k.length; j++) out[i + j] = tag + i + '.' + j;
      }
    }
    return out;
  };
  const a = cut(wordsOf(note), '\u0000n'), b = cut(wordsOf(text), '\u0000t');
  let best = 0, cover = 0;
  const covered = new Array(a.length).fill(false);
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] !== b[j - 1]) continue;
      cur[j] = prev[j - 1] + 1;
      if (cur[j] > best) best = cur[j];
      if (cur[j] >= 4) for (let k = i - cur[j]; k < i; k++) covered[k] = true;
    }
    prev = cur;
  }
  cover = covered.filter(Boolean).length;
  return { longest: best, share: a.length ? cover / a.length : 0 };
}
/* Копия: пять слов подряд из поста или куски по четыре слова — больше трети описания */
export const isCopied = (note, text, keep = []) => {
  const r = copiedRun(note, text, keep);
  return r.longest >= 5 || r.share > 0.3;
};

/* ---------- имена источников ---------- */

const nameRx = n => new RegExp(`(?<![A-Za-z0-9_])${escRx(n)}(?![A-Za-z0-9_])`, 'i');
// поля-коды (раздел, округ, даты, id остановок) — не текст: «coffee» в cat не значит, что это имя канала
const CODE_KEYS = new Set(['id', 'cat', 'okr', 'hint', 'fit', 'tags', 'when', 'mode', 'emoji', 'chk', 'added', 'updated',
  'start', 'end', 'dates', 'time', 'price', 'lat', 'lon', 's', 't', 'stops', 'place', 'closed']);
function textsOf(v, key = '', out = []) {
  if (CODE_KEYS.has(key)) return out;
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) textsOf(x, '', out);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) textsOf(x, k, out);
  return out;
}
/* Имя источника в любом текстовом поле значения (в том числе в %-кодированной ссылке) → имя или '' */
export function leakOf(value, names) {
  const s = textsOf(value).join('\n');
  let d = s;
  try { d = decodeURIComponent(s); } catch { /* битое %-кодирование — проверим как есть */ }
  return (names || []).find(n => nameRx(n).test(s) || nameRx(n).test(d)) || '';
}

/* ---------- запуск ---------- */

export async function main(argv = process.argv.slice(2), deps = {}) {
  const opts = parseArgs(argv);
  const out = deps.out || (s => console.log(s));
  if (opts.help) { out(USAGE); return { changes: 0, help: true }; }
  // любая ошибка наружу — без имён источников: CLI печатает её в публичный лог
  const box = { redact: s => String(s ?? '') };
  try {
    return await runPipeline(opts, deps, box);
  } catch (e) {
    if (e && typeof e.message === 'string') e.message = box.redact(e.message);
    throw e;
  }
}

async function runPipeline(opts, deps, box) {
  const t0 = Date.now();
  const out = deps.out || (s => console.log(s));
  const log = deps.log || (s => console.error(s));
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const today = opts.today || deps.today || moscowToday();
  const repoDir = path.resolve(opts.repo);
  const stateDir = path.resolve(opts.state);
  const reportFile = path.resolve(opts.report);
  const inboxFile = path.resolve(opts.inboxOut);
  const tgDelayMs = deps.tgDelayMs ?? 1500;
  const geoIntervalMs = deps.geoIntervalMs ?? 1100;
  const fatal = [];                                // причины выйти с кодом 1 (Actions покрасит запуск в красный)

  // список источников: секрет PIPELINE_SOURCES или sources.json в папке состояния
  let rawSources;
  if (env.PIPELINE_SOURCES && String(env.PIPELINE_SOURCES).trim()) {
    try { rawSources = JSON.parse(env.PIPELINE_SOURCES); } catch (e) { throw new Error('PIPELINE_SOURCES: не JSON'); }
  } else {
    rawSources = await readJson(path.join(stateDir, 'sources.json'), null);
    if (!rawSources) throw new Error(`нет ${path.join(stateDir, 'sources.json')} — скопируйте pipeline/sources.example.json`);
  }
  const sources = normSources(rawSources);
  if (sources.invalid) log(`sources: пропущено некорректных имён — ${sources.invalid}`);
  if (!sources.telegram.length && !sources.instagram.length && !sources.inbox) log('sources: список пуст — читать нечего (см. pipeline/README.md)');

  // в логах (а они в публичном репозитории видны всем) — не имена каналов, а номера
  const labels = new Map();
  sources.telegram.forEach((c, i) => labels.set(c, `tg#${i + 1}`));
  sources.instagram.forEach((u, i) => labels.set(u, `ig#${i + 1}`));
  const redact = s => {
    let t = String(s ?? '');
    for (const [name, lbl] of labels) t = t.replace(new RegExp(`(?<![A-Za-z0-9_.])${escRx(name)}(?![A-Za-z0-9_])`, 'gi'), lbl);
    return t;
  };
  box.redact = redact;

  const stateRaw = await readJson(path.join(stateDir, 'state.json'), {});
  const state = normState(clone(stateRaw));
  const prunedSeen = pruneSeen(state.seen, today);
  const catalog = await loadCatalog(repoDir);

  /* ---- 1. источники ---- */
  const srcRuns = [];
  const fetched = [];
  const cursor = { tg: {}, ig: {} };
  const firstRun = new Set();

  for (const [i, ch] of sources.telegram.entries()) {
    if (i > 0) await sleep(tgDelayMs);
    const since = Number(state.tg[ch]) || 0;
    if (!since) firstRun.add('tg:' + ch);
    const s = { type: 'tg', name: ch, label: labels.get(ch), posts: 0 };
    try {
      const r = await fetchChannel(ch, { sinceId: since, maxPosts: opts.maxPosts, fetchImpl, delayMs: tgDelayMs });
      fetched.push(...r.posts);
      s.posts = r.posts.length;
      if (r.capped) s.capped = r.capped;
      cursor.tg[ch] = Math.max(since, Number(r.lastId) || 0);
    } catch (e) {
      s.error = e.message;
      log(`${s.label}: ${redact(e.message)}`);
    }
    srcRuns.push(s);
  }

  for (const u of sources.instagram) {
    const since = Number(state.ig[u]) || 0;
    if (!since) firstRun.add('ig:' + u);
    const s = { type: 'ig', name: u, label: labels.get(u), posts: 0 };
    try {
      const r = await fetchAccount(u, { token: env.IG_ACCESS_TOKEN, igUserId: env.IG_USER_ID, sinceTs: since, fetchImpl, limit: opts.maxPosts });
      if (r.skipped) s.skipped = 'нет IG_ACCESS_TOKEN / IG_USER_ID';
      else {
        fetched.push(...r.posts);
        s.posts = r.posts.length;
        cursor.ig[u] = Math.max(since, Number(r.lastTs) || 0);
      }
    } catch (e) {
      s.error = e.message;
      log(`${s.label}: ${redact(e.message)}`);
    }
    srcRuns.push(s);
  }

  if (sources.inbox) {
    const s = { type: 'inbox', name: 'inbox', label: 'inbox', posts: 0 };
    if (!env.GITHUB_REPOSITORY) s.skipped = 'нет GITHUB_REPOSITORY';
    else {
      try {
        const r = await fetchInbox({ repo: env.GITHUB_REPOSITORY, token: env.GITHUB_TOKEN, fetchImpl });
        fetched.push(...r.posts);
        s.posts = r.posts.length;
        if (r.ignored && r.ignored.length) s.ignored = r.ignored;
      } catch (e) {
        s.error = e.message;
        log(`inbox: ${e.message}`);
      }
    }
    srcRuns.push(s);
  }

  // посты, которые прошлый запуск не смог разобрать
  const fetchedKeys = new Set(fetched.map(p => p && p.key));
  for (const [key, r] of Object.entries(state.retry)) {
    if (r && r.post && r.post.key === key && !state.seen[key] && !fetchedKeys.has(key)) fetched.push(r.post);
  }

  // имена всех источников (и прошлых — из курсоров): в данных сайта их быть не должно
  const srcNames = uniq([...sources.telegram, ...sources.instagram, ...Object.keys(state.tg), ...Object.keys(state.ig),
    ...fetched.filter(p => p && p.source !== 'inbox' && p.channel).map(p => String(p.channel))]).filter(n => n.length >= 4);
  const labelOf = n => labels.get(n) || 'прежний источник';

  // ошибки источников — предупреждение в Actions; все источники одного вида упали — запуск красный
  const warnings = srcRuns.filter(s => s.error).map(s => `::warning title=Источник недоступен::${s.label}: ${redact(s.error)}`);
  for (const [t, what] of [['tg', 'все Telegram-каналы'], ['ig', 'все Instagram-аккаунты']]) {
    const list = srcRuns.filter(s => s.type === t && !s.skipped);
    if (list.length && list.every(s => s.error)) fatal.push(`${what} из списка недоступны — см. отчёт, раздел «Источники»`);
  }

  /* ---- 2. фильтр: уже прочитанные, старые, пустые ---- */
  const cutoff = addDays(today, -(opts.sinceDays ?? FIRST_RUN_DAYS));
  const skipped = { seen: 0, old: 0, short: 0 };
  const quietSeen = [];            // старые и пустые — запомнить как прочитанные, модели не отправлять
  const quietInbox = [];           // пустые issues ящика — закрыть с пояснением
  let fresh = [];
  const keys = new Set();
  for (const p of fetched) {
    if (!p || !p.key || keys.has(p.key)) continue;
    keys.add(p.key);
    if (state.seen[p.key]) { skipped.seen++; continue; }
    const useCut = p.source !== 'inbox' && (opts.sinceDays != null || firstRun.has(p.source + ':' + p.channel));
    if (useCut && p.date && moscowDay(p.date) < cutoff) { skipped.old++; quietSeen.push(p.key); continue; }
    if (String(p.text || '').trim().length < 10) {
      skipped.short++;
      if (p.source === 'inbox') quietInbox.push(p); else quietSeen.push(p.key);
      continue;
    }
    fresh.push(p);
  }
  fresh.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.key).localeCompare(String(b.key)));
  // не больше LIMITS.posts за запуск, старые первыми: остальные ждут в retry, попытка не считается
  const overflow = fresh.slice(LIMITS.posts);
  fresh = fresh.slice(0, LIMITS.posts);

  const fetchLines = summarizeSources(srcRuns, skipped, fresh.length, opts.sinceDays ?? FIRST_RUN_DAYS, overflow.length);
  if (!opts.llm) {
    // только счётчики: состояние не трогаем, иначе посты пропадут без разбора
    for (const l of [...fetchLines, ...warnings, ...fatal.map(f => `::error title=Конвейер каталога::${f}`)]) out(l);
    out('CHANGES=0');
    return { changes: 0, fetchOnly: true, sources: srcRuns.map(s => ({ ...s, name: undefined })), skipped,
      fresh: fresh.length + overflow.length, fatal: fatal.join('; ') || undefined };
  }

  /* ---- 3. модель ---- */
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!opts.mock && !apiKey && !deps.llmClient) {
    throw new Error('нет ANTHROPIC_API_KEY (для проверки без модели — --no-llm, для тестов — --mock <папка>)');
  }
  const llm = makeLLM({
    apiKey,
    mockDir: opts.mock ? path.resolve(opts.mock) : undefined,
    recordDir: opts.record ? path.resolve(opts.record) : undefined,
    client: deps.llmClient,
    today,
    batchSize: 8,
    maxBatchChars: 8 * 3500,
    log: m => log('[llm] ' + m),
  });
  // исход по каждому посту: ответила ли модель, отказалась, упала связь или не хватило времени
  const status = new Map();
  const items = fresh.length
    ? await llm.extract(fresh, catalogIndex(catalog), { status, deadline: t0 + opts.budgetMin * 60000, channels: srcNames })
    : [];
  const sent = fresh.filter(p => status.has(p.key) && status.get(p.key) !== 'skipped');
  const notCounted = st => !st || st === 'transient' || st === 'skipped';
  // модель не ответила ни на одну пачку (нет связи, перегрузка, кончились деньги): ничего не помечаем прочитанным
  const outage = sent.length > 0 && sent.every(p => status.get(p.key) === 'transient');
  if (outage) fatal.push('модель не ответила ни на один запрос — посты не тронуты и разберутся в следующий раз');

  /* ---- 4. проверка и применение ---- */
  const postByKey = new Map(fresh.map(p => [p.key, p]));
  const order = new Map(fresh.map((p, i) => [p.key, i]));
  items.sort((a, b) => (order.get(a.post_key) ?? 0) - (order.get(b.post_key) ?? 0));

  const auto = Object.assign(emptyAutoData(), clone(catalog.auto || {}));
  const before = renderAutoJs(auto);
  const { taken, files: usedFiles } = await photoIndex(repoDir, catalog);
  const knownEvents = catalog.events.filter(Boolean).slice();
  const eventIds = new Set(knownEvents.map(e => e.id));
  const scenarioIds = new Set(catalog.scenarios.map(s => s.id).concat(auto.scenarios.map(s => s.id)));
  const planSigs = new Set(catalog.scenarios.map(s => s.mode + ':' + (s.stops || []).join(',')));
  const closedNow = new Set(auto.closed);
  const res = { places: [], closed: [], events: [], plans: [], updates: [], rejected: [], plansRejected: [], deferred: [],
    irrelevant: 0, dupEvents: [], hidden: [], failed: [], waiting: 0 };
  const deferredKeys = new Set();
  const appliedKeys = new Set();                   // посты, из которых что-то попало в auto.js
  const notes = new Map();                         // ключ поста → что с ним сделали (для ответа в ящик)
  const note = (post, s) => { if (!notes.has(post.key)) notes.set(post.key, []); notes.get(post.key).push(s); };
  const reject = (item, post, reason) => { res.rejected.push({ item, post, reason }); note(post, `не добавлено: ${reason}`); };
  const defer = (item, post, reason) => { res.deferred.push({ item, post, reason }); deferredKeys.add(post.key); note(post, `отложено: ${reason}`); };
  const leak = v => { const n = leakOf(v, srcNames); return n ? labelOf(n) : ''; };

  // геокодер: «не нашли» — отказ, а сбой сервиса (429, 5xx, блокировка) — отложить пост до следующего запуска
  let geoFails = 0;
  async function locate(addr, item, post) {
    if (geoFails >= GEO_FAILS_MAX) return { transient: 'геокодер недоступен — повторим в следующий раз' };
    const near = stationHint(item.area, post.text, catalog.stations);
    let g;
    try {
      g = await geocode(addr, {
        yandexKey: env.YANDEX_GEOCODER_KEY || undefined, fetchImpl, cache: state.geocache, minIntervalMs: geoIntervalMs,
        near: near || undefined, log: m => log(m), strict: true,
      });
    } catch (e) {
      if (!e.transient) throw e;
      geoFails++;
      return { transient: `${e.message} — повторим в следующий раз` };
    }
    geoFails = 0;
    if (!g) return { error: `адрес «${addr}» не нашёлся на карте` };
    if (!inMoscowRegion(g.lat, g.lon)) return { error: 'адрес вне Москвы и ближнего Подмосковья' };
    const weak = WEAK_PRECISION.has(String(g.precision || ''));
    if (near) {
      const d = distM(g, near);
      if (d > (weak ? 1500 : 3000)) return { error: `адрес нашёлся в ${km(d)} от метро из поста (${near.name}) — проверить вручную` };
    } else if (g.ambiguous) {
      return { error: 'в Москве несколько мест с таким адресом — проверить вручную' };
    } else if (weak) {
      return { error: 'адрес нашёлся только до улицы, без дома' };
    }
    const metro = nearestMetro(g.lat, g.lon, catalog.stations);
    if (!metro || metro.distM > MAX_METRO_M) return { error: `до метро дальше 3 км (${metro ? km(metro.distM) : 'нет станций'})` };
    return { lat: r6(g.lat), lon: r6(g.lon), metro: metro.name, metroDistM: metro.distM,
      okr: okrOf(g.lat, g.lon, g.district, catalog.places), display: g.display || '' };
  }

  function onUpdate(item, post, id, by) {
    const p = catalog.places[id];
    if (!p) return reject(item, post, 'обновление для места, которого нет в каталоге');
    res.updates.push({ id, name: p.name, item, post, by: by || 'модель' });
    note(post, `«${p.name}» уже есть в каталоге — изменения только в отчёте`);
  }

  async function photoFor(id, place) {
    try {
      const all = await findCommonsCandidates(place, { fetchImpl });
      if (!all.length) return { note: 'на Commons рядом нет подходящих снимков' };
      // снимок, который уже стоит у другого места (обычно здание), второму заведению не отдаём
      const cands = all.filter(c => !usedFiles.has(fileKey(c.file)));
      if (!cands.length) return { note: `все ${all.length} снимков рядом уже стоят у других мест каталога` };
      const i = await llm.pickPhoto({ id, ...place }, cands);
      if (i < 0) return { note: `ни один из ${cands.length} снимков не показывает место` };
      const ph = await savePhoto(cands[i], id, repoDir, { fetchImpl });
      if (leak(ph)) {
        await Promise.all([ph.s, ph.t].map(f => fs.rm(path.join(repoDir, f), { force: true })));
        return { note: 'в подписи фото имя источника — фото не взято' };
      }
      usedFiles.add(fileKey(ph.file));
      return { ph };
    } catch (e) {
      return { note: `ошибка: ${e.message}` };
    }
  }

  async function onNewPlace(item, post) {
    const name = cleanName(item.name);
    const cat = CATS.includes(item.cat) ? item.cat : catOf(item.kind);
    const kind = String(item.kind || '').trim() || KIND_BY_CAT[cat];
    const addr = cleanAddr(item.address);
    if (item.adult) return reject(item, post, 'место 18+ — такие добавляем только вручную');
    if (item.confidence < MIN_CONF.place) return reject(item, post, `модель не уверена (${item.confidence})`);
    if (!addr) return reject(item, post, 'в посте нет адреса');
    if (!item.note_ru) return reject(item, post, 'нет описания своими словами');
    if (isCopied(item.note_ru, post.text, [name, item.name, addr, item.address, kind]))
      return reject(item, post, 'описание повторяет текст поста — нужно своими словами');
    let m = findMatch({ name, addr, kind, cat }, catalog);
    if (m) return onUpdate(item, post, m.id, m.by);
    if (res.places.length >= LIMITS.places) return defer(item, post, 'лимит новых мест за запуск');
    const loc = await locate(addr, item, post);
    if (loc.transient) return defer(item, post, loc.transient);
    if (loc.error) return reject(item, post, loc.error);
    m = findMatch({ name, addr, kind, cat, lat: loc.lat, lon: loc.lon }, catalog);
    if (m) return onUpdate(item, post, m.id, m.by);

    const id = slugId(name, taken);
    taken.add(id);
    const hint = uniq((item.hints || []).filter(h => PLACE_HINTS.includes(h)
      || (h === 'night' && /круглосуточ|24\s*\/\s*7|24 час/i.test(item.hours || ''))));
    const place = { name, kind, emoji: emojiFor(kind, cat), addr, metro: loc.metro, lat: loc.lat, lon: loc.lon,
      price: [1, 2, 3].includes(item.price) ? item.price : 2, okr: loc.okr, cat, note: item.note_ru };
    if (hint.length) place.hint = hint;
    place.chk = today.slice(0, 7);
    place.added = today;
    const leaked = leak(place);
    if (leaked) return reject(item, post, `в данных места имя источника (${leaked})`);
    let photo = { note: opts.dry ? 'пробный запуск — фото не искали' : 'фото выключены (--no-photos)' };
    if (opts.photos && !opts.dry) {
      photo = await photoFor(id, place);
      if (photo.ph) place.ph = photo.ph;
    }
    auto.places[id] = place;
    catalog.places[id] = place;
    res.places.push({ id, place, item, post, loc, photo });
    appliedKeys.add(post.key);
    note(post, `добавлено место «${name}»`);
  }

  /* Закрытие прячет место и все подборки с ним — поэтому строже всего: имя из поста совпадает с местом,
     в тексте есть слова о закрытии, и не больше LIMITS.closed за запуск */
  function onClosure(item, post) {
    const name = cleanName(item.name);
    if (!name) return reject(item, post, 'закрытие без названия места');
    let id = item.match_id;
    if (!id) {
      const m = findMatch({ name, addr: cleanAddr(item.address) }, catalog);
      if (m && m.score >= 0.9) id = m.id;
    }
    const p = id && catalog.places[id];
    if (!p) return reject(item, post, 'закрытие: места нет в каталоге');
    if (item.confidence < MIN_CONF.closure) return reject(item, post, `закрытие: модель не уверена (${item.confidence} < ${MIN_CONF.closure})`);
    if (!sameName(name, p.name)) return reject(item, post, `закрытие: «${name}» не похоже на «${p.name}» (${id})`);
    if (!CLOSURE_RX.test(String(post.text || ''))) return reject(item, post, 'закрытие: в тексте нет слов о закрытии');
    if (closedNow.has(id) || p.closed) { note(post, `«${p.name}» уже отмечено закрытым`); return; }
    if (res.closed.length >= LIMITS.closed) return defer(item, post, 'лимит закрытий за запуск');
    closedNow.add(id);
    p.closed = true;
    auto.closed.push(id);
    res.closed.push({ id, name: p.name, item, post, evidence: evidenceQuote(post.text) });
    appliedKeys.add(post.key);
    note(post, `«${p.name}» отмечено закрытым`);
  }

  function dupEvent(item, post, dup) {
    res.dupEvents.push({ item, post, dup });
    note(post, `событие уже в афише («${dup.title}»)`);
  }

  async function onEvent(item, post) {
    const ev = item.event;
    if (!ev) return reject(item, post, 'событие без дат');
    if (ev.end < today) return reject(item, post, 'событие уже прошло');
    if (!/^https:\/\//i.test(ev.url || '')) return reject(item, post, 'нет официальной https-ссылки на событие');
    // повторная проверка ссылки уже со всеми источниками запуска, а не только с каналами пачки
    const url = officialUrl(ev.url, srcNames);
    if (!url) return reject(item, post, 'ссылка на событие не прошла проверку (соцсеть, сокращатель, IP или имя источника)');
    if (!EVENT_CATS.includes(ev.cat)) return reject(item, post, `неизвестный вид события «${ev.cat}»`);
    if (item.confidence < MIN_CONF.event) return reject(item, post, `модель не уверена (${item.confidence})`);
    if (!item.note_ru) return reject(item, post, 'нет описания своими словами');
    if (isCopied(item.note_ru, post.text, [ev.title, ev.venue, item.name, ev.address, item.address]))
      return reject(item, post, 'описание повторяет текст поста — нужно своими словами');

    // площадка из каталога — по match_id модели или по имени и адресу
    let venue = null;
    const byId = item.match_id && catalog.places[item.match_id];
    if (byId && !byId.closed) venue = { id: item.match_id, p: byId };
    else {
      const m = findMatch({ name: cleanName(ev.venue || item.name), addr: cleanAddr(ev.address || item.address) }, catalog);
      if (m && m.score >= 0.9 && !catalog.places[m.id].closed) venue = { id: m.id, p: catalog.places[m.id] };
    }
    if (venue && !(Number.isFinite(venue.p.lat) && venue.p.metro)) venue = null;
    const venueName = cleanName(ev.venue) || (venue ? venue.p.name : cleanName(item.name));
    if (!venueName) return reject(item, post, 'не указана площадка');
    // повтор: сначала без геокодера (площадка из каталога или по названию), потом ещё раз по точке
    const probe = { title: ev.title, start: ev.start, end: ev.end, place: venue ? venue.id : '', venue: venueName };
    let dup = findDupEvent(venue ? { ...probe, lat: venue.p.lat, lon: venue.p.lon } : probe, knownEvents);
    if (dup) return dupEvent(item, post, dup);
    if (res.events.length >= LIMITS.events) return defer(item, post, 'лимит событий за запуск');

    let loc;
    if (venue) {
      loc = { lat: venue.p.lat, lon: venue.p.lon, metro: venue.p.metro, addr: venue.p.addr };
    } else {
      const addr = cleanAddr(ev.address || item.address);
      if (!addr) return reject(item, post, 'нет адреса площадки');
      const l = await locate(addr, item, post);
      if (l.transient) return defer(item, post, l.transient);
      if (l.error) return reject(item, post, l.error);
      loc = { ...l, addr };
      dup = findDupEvent({ ...probe, lat: loc.lat, lon: loc.lon }, knownEvents);
      if (dup) return dupEvent(item, post, dup);
    }
    let id = eventId(ev, venueName);
    for (let n = 2; eventIds.has(id); n++) id = `${eventId(ev, venueName)}-${n}`;
    const e = { id, title: ev.title, cat: ev.cat, emoji: EVENT_EMOJI[ev.cat], start: ev.start, end: ev.end };
    if (Array.isArray(ev.dates) && ev.dates.length > 1) e.dates = ev.dates;
    if (ev.time) e.time = ev.time;
    e.venue = venueName;
    if (venue) e.place = venue.id;
    Object.assign(e, { addr: loc.addr, metro: loc.metro, lat: loc.lat, lon: loc.lon });
    if (ev.price_from != null || ev.price_to != null) e.price = [ev.price_from ?? ev.price_to, ev.price_to ?? ev.price_from];
    if (ev.age) e.age = ev.age;
    e.url = url;
    e.note = item.note_ru;
    e.fit = uniq((item.fit || []).filter(f => FITS.includes(f)));
    e.added = today;
    const leaked = leak(e);
    if (leaked) return reject(item, post, `в данных события имя источника (${leaked})`);
    eventIds.add(id);
    knownEvents.push(e);
    auto.events.push(e);
    res.events.push({ event: e, item, post, loc });
    appliedKeys.add(post.key);
    note(post, `событие «${ev.title}» добавлено в афишу`);
  }

  for (const item of items) {
    const post = postByKey.get(item.post_key);
    if (!post) continue;
    if (item.type === 'irrelevant') { res.irrelevant++; continue; }
    if (item.type === 'new_place') await onNewPlace(item, post);
    else if (item.type === 'place_update') {
      if (item.match_id) onUpdate(item, post, item.match_id);
      else {
        const m = findMatch({ name: cleanName(item.name), addr: cleanAddr(item.address) }, catalog);
        if (m) onUpdate(item, post, m.id, m.by);
        else reject(item, post, 'обновление для места, которого нет в каталоге');
      }
    } else if (item.type === 'closure') onClosure(item, post);
    else if (item.type === 'event') await onEvent(item, post);
  }

  /* ---- 5. подборки с новыми местами ---- */
  const planId = (mode, title) => {
    const base = `auto-${mode}-${slugId(title) || 'plan'}`;
    let id = base;
    for (let n = 2; scenarioIds.has(id); n++) id = `${base}-${n}`;
    return id;
  };
  for (const np of res.places.slice(0, LIMITS.planPlaces)) {
    if (res.plans.length >= LIMITS.plans) break;
    const p = np.place;
    const nearby = nearbyPlaces({ id: np.id, ...p }, catalog, 1200, 25);
    const modes = uniq((np.item.fit || []).filter(f => FITS.includes(f)));
    const proposals = await llm.proposePlans({
      newPlace: { id: np.id, name: p.name, kind: p.kind, cat: p.cat, addr: p.addr, price: p.price, note: p.note, hours: np.item.hours },
      nearby, modes: modes.length ? modes : FITS,
    });
    for (const pl of proposals) {
      if (res.plans.length >= LIMITS.plans) break;
      const v = validatePlan(pl, catalog);
      if (!v.ok) { res.plansRejected.push({ plan: pl, errors: v.errors, place: np.id }); continue; }
      const sig = pl.mode + ':' + pl.stops.join(',');
      if (planSigs.has(sig)) continue;
      const sc = { id: planId(pl.mode, pl.title), mode: pl.mode, emoji: pl.emoji, title: pl.title,
        stops: pl.stops, when: pl.when, tags: pl.tags, why: pl.why, added: today };
      const leaked = leak(sc);
      if (leaked) { res.plansRejected.push({ plan: pl, errors: [`в тексте имя источника (${leaked})`], place: np.id }); continue; }
      scenarioIds.add(sc.id);
      planSigs.add(sig);
      auto.scenarios.push(sc);
      catalog.scenarios.push(sc);
      res.plans.push({ scenario: sc, place: np.id });
    }
  }

  /* ---- 6. итог и запись ---- */
  const newlyClosed = new Set(res.closed.map(c => c.id));
  res.hidden = catalog.scenarios.filter(s => (s.stops || []).some(id => newlyClosed.has(id))).map(s => s.id);
  auto.scenarios = auto.scenarios.filter(s => !(s.stops || []).some(id => closedNow.has(id)));
  const applied = res.places.length + res.closed.length + res.events.length + res.plans.length;
  if (applied) {
    auto.events = auto.events.filter(e => !(e && e.end && e.end < today));   // прошедшие события больше не нужны
    auto.updated = today;
  }
  const after = renderAutoJs(auto);
  const changes = applied > 0 && after !== before ? 1 : 0;
  // последний рубеж: имя источника, которого не было в auto.js, — не пишем вовсе
  const was = catalog.auto || {};
  const newLeak = leakOf({ p: auto.places, e: auto.events, s: auto.scenarios },
    srcNames.filter(n => !leakOf({ p: was.places, e: was.events, s: was.scenarios }, [n])));
  if (newLeak) throw new Error(`assets/auto.js: в новых данных нашлось имя источника (${labelOf(newLeak)}) — запись остановлена`);
  if (changes && !opts.dry) await writeAtomic(path.join(repoDir, 'assets/auto.js'), after);

  // ответ в issue ящика: что сделали и придёт ли PR. Закрывает их close-inbox.mjs, когда PR уже создан
  const inboxComment = (p, failed) => {
    const lines = failed ? [`не удалось разобрать за ${MAX_ATTEMPTS} попытки — посмотрите вручную`]
      : !String(p.text || '').trim() || String(p.text).trim().length < 10 ? ['в сообщении нет текста — разбирать нечего']
        : notes.get(p.key) || ['полезных фактов не нашлось'];
    return `Разобрано конвейером ${today}:\n\n${lines.map(l => '- ' + l).join('\n')}\n\n`
      + (changes && appliedKeys.has(p.key) ? 'Изменения — в Pull Request с меткой `auto`, его проверит человек.' : 'В каталог ничего не добавлено.');
  };
  const inboxClose = [];

  // что модель не разобрала: повторим в следующий раз, но не больше MAX_ATTEMPTS.
  // Сбой связи, нехватка времени, отложенное и не влезшее в лимит — ждут без счёта попыток
  const processed = new Set(items.map(i => i.post_key));
  if (!opts.dry && !outage) {
    const wait = p => { state.retry[p.key] = { post: p, n: (state.retry[p.key] && state.retry[p.key].n) || 0 }; res.waiting++; };
    // issues ящика в seen не кладём: открытый issue и так придёт снова, а закрытый — не придёт
    const done = (p, failed) => {
      delete state.retry[p.key];
      if (p.source === 'inbox') inboxClose.push({ number: p.id, comment: inboxComment(p, failed) });
      else state.seen[p.key] = today;
    };
    for (const k of quietSeen) state.seen[k] = today;
    for (const p of quietInbox) done(p, false);
    for (const p of fresh) {
      if (deferredKeys.has(p.key) || notCounted(status.get(p.key))) { wait(p); continue; }
      if (processed.has(p.key)) { done(p, false); continue; }
      const n = ((state.retry[p.key] && state.retry[p.key].n) || 0) + 1;
      if (n >= MAX_ATTEMPTS) { res.failed.push(p); done(p, true); } else state.retry[p.key] = { post: p, n };
    }
    for (const p of overflow) wait(p);
    for (const k of Object.keys(state.retry)) if (state.seen[k]) delete state.retry[k];
    Object.assign(state.tg, cursor.tg);
    Object.assign(state.ig, cursor.ig);
    state.lastRun = today;
  }
  trimCache(state.geocache);
  // в пробном запуске и когда модель недоступна сохраняем только кеш геокодера
  const stateOut = opts.dry || outage ? { ...normState(stateRaw), geocache: state.geocache } : state;
  await writeAtomic(path.join(stateDir, 'state.json'), JSON.stringify(stateOut, null, 1) + '\n');
  if (!opts.dry) {
    if (inboxClose.length) await writeAtomic(inboxFile, JSON.stringify(inboxClose, null, 1) + '\n');
    else await fs.rm(inboxFile, { force: true });
  }

  const usage = llm.usage();
  const report = renderReport({ today, opts, res, srcRuns, skipped, fresh, overflow, usage, prunedSeen,
    inboxClose: inboxClose.map(x => x.number), changes, outage, fatal, places: catalog.places });
  await writeAtomic(path.join(stateDir, 'reports', `${today}${opts.dry ? '-dry' : ''}.md`), report);
  await writeAtomic(reportFile, report);

  for (const l of fetchLines) out(l);
  out(`Новых мест: ${res.places.length}, закрытий: ${res.closed.length}, событий: ${res.events.length}, подборок: ${res.plans.length}, `
    + `обновлений в отчёте: ${res.updates.length}, отклонено: ${res.rejected.length + res.plansRejected.length}, отложено: ${res.deferred.length}`);
  out(`Модель: вызовов ${usage.calls}, ≈ $${cost(usage).toFixed(2)}`);
  if (opts.dry) out('Пробный запуск: assets/ и прочитанные посты не тронуты.');
  for (const l of [...warnings, ...fatal.map(f => `::error title=Конвейер каталога::${f}`)]) out(l);
  out(`CHANGES=${changes}`);
  return { changes, res, usage, auto, report, inboxClose, fatal: fatal.join('; ') || undefined };
}

/* ---------- отчёт ---------- */

export const cost = u => ((u.input || 0) * PRICE.input + (u.output || 0) * PRICE.output
  + (u.cacheRead || 0) * PRICE.cacheRead + (u.cacheWrite || 0) * PRICE.cacheWrite) / 1e6;

function summarizeSources(srcRuns, skipped, freshCount, days, overflow = 0) {
  const by = t => srcRuns.filter(s => s.type === t);
  const line = (title, list, unit) => {
    if (!list.length) return `${title}: нет в списке`;
    const posts = list.reduce((n, s) => n + s.posts, 0);
    const err = list.filter(s => s.error).length, skip = list.filter(s => s.skipped), cap = list.filter(s => s.capped).length;
    return `${title}: ${unit} ${list.length}, получено постов ${posts}` + (err ? `, с ошибкой ${err}` : '')
      + (cap ? `, упёрлись в --max-posts ${cap}` : '')
      + (skip.length ? `, пропущено ${skip.length} (${skip[0].skipped})` : '');
  };
  const inbox = by('inbox')[0];
  return [
    line('telegram', by('tg'), 'каналов'),
    line('instagram', by('ig'), 'аккаунтов'),
    inbox ? `ящик (issues): ${inbox.skipped ? 'пропущен — ' + inbox.skipped : inbox.error ? 'ошибка' : 'записей ' + inbox.posts}` : 'ящик (issues): выключен',
    `уже разобрано раньше: ${skipped.seen}, старше ${days} дн.: ${skipped.old}, без текста: ${skipped.short}, к разбору: ${freshCount}`
      + (overflow ? `, ждут следующего запуска: ${overflow}` : ''),
  ];
}

const md = s => String(s == null ? '' : s).replace(/([\\`*_[\]<>|])/g, '\\$1').replace(/\s+/g, ' ').trim();
// в адресе ссылки скобки и звёздочки кодируем: иначе ссылка из поста может сломать или дописать разметку отчёта
export const safeHref = url => String(url).replace(/[()[\]<>*\s]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
const link = (title, url) => (url ? `[${title}](${safeHref(url)})` : title);
const hostOf = url => { try { return new URL(url).hostname; } catch { return ''; } };
const mapUrl = (lat, lon) => `https://yandex.ru/maps/?pt=${lon},${lat}&z=17&l=map`;
const postLink = p => (p ? link(p.source === 'inbox' ? `issue #${p.id}` : 'пост', p.url) : '');
const fmtPrice = pr => (pr ? (pr[0] === 0 && pr[1] === 0 ? 'бесплатно' : pr[0] === pr[1] ? `${pr[0]} ₽` : `${pr[0]}–${pr[1]} ₽`) : '');
const MODE_EMOJI = { date: '💕', guys: '🍻', girls: '💅' };
const TYPE_RU = { new_place: 'новое место', place_update: 'обновление места', closure: 'закрытие', event: 'событие', irrelevant: 'не по теме' };
const OKR_RU = { center: 'Центр', north: 'Север', ne: 'Северо-Восток', east: 'Восток', se: 'Юго-Восток', south: 'Юг', sw: 'Юго-Запад',
  west: 'Запад', nw: 'Северо-Запад', zel: 'Зеленоград', new: 'Новая Москва', khimki: 'Химки', mo: 'Подмосковье' };

/* Остановки плана по-человечески: «Название (тип, `id`) → 350 м → …» */
function stopsText(stops, places) {
  return (stops || []).map((id, i) => {
    const p = places[id], prev = i > 0 ? places[stops[i - 1]] : null;
    const leg = i === 0 ? '' : prev && p ? ` → ${km(distM(prev, p))} → ` : ' → ';
    return leg + (p ? `${md(p.name)} (${md(p.kind)}, \`${id}\`)` : `\`${id}\``);
  }).join('');
}

function renderReport({ today, opts, res, srcRuns, skipped, fresh, overflow = [], usage, prunedSeen, inboxClose, changes, outage, fatal = [], places = {} }) {
  const L = [];
  L.push(`# Каталог: обновление ${today}`, '');
  L.push(opts.dry
    ? '_Пробный запуск (`--dry`): в assets/ ничего не записано._'
    : 'Предложения конвейера. Проверьте места, адреса и тексты, поправьте `assets/auto.js` при необходимости и смержите PR. '
      + 'Имена источников есть только в этом отчёте и в служебной ветке `pipeline-data` (на сайт она не публикуется, но в публичном репозитории видна на GitHub) — в файлы сайта они не попадают.');
  L.push('');
  if (fatal.length) {
    L.push(...fatal.map(f => `> **Внимание:** ${md(f)}.`), '');
  }
  L.push(`**Итог:** новых мест ${res.places.length} · закрытий ${res.closed.length} · событий ${res.events.length} · подборок ${res.plans.length}`
    + ` · обновлений (не применены) ${res.updates.length} · отклонено ${res.rejected.length + res.plansRejected.length}`
    + (res.deferred.length ? ` · отложено ${res.deferred.length}` : '') + (changes ? '' : ' · **изменений нет**'));
  L.push('');

  // закрытия — первыми: они прячут места и подборки с сайта
  if (res.closed.length) {
    L.push(`## Закрылись — проверьте в первую очередь (${res.closed.length})`, '');
    for (const c of res.closed) L.push(`- **${md(c.name)}** (\`${c.id}\`) — «${md(c.evidence)}» · уверенность ${c.item.confidence} · ${postLink(c.post)}`);
    if (res.hidden.length) L.push('', `Скроются подборки с этими местами: ${res.hidden.map(id => '`' + id + '`').join(', ')}`);
    L.push('');
  }

  if (res.places.length) {
    L.push(`## Новые места (${res.places.length})`, '');
    for (const { id, place: p, item, post, loc, photo } of res.places) {
      L.push(`- ${p.emoji} **${md(p.name)}** (\`${id}\`) — ${md(p.kind)}, ${md(p.addr)} · м. ${md(p.metro)} (${km(loc.metroDistM)}) · ${OKR_RU[p.okr] || p.okr} · цена ${p.price}`
        + ` · ${link('на карте', mapUrl(p.lat, p.lon))} · ${postLink(post)}`);
      L.push(`  > ${md(p.note)}`);
      const extra = [];
      if (item.hours) extra.push(`часы из поста: ${md(item.hours)}`);
      if (p.hint) extra.push(`подсказки: ${p.hint.join(', ')}`);
      extra.push(p.ph ? `фото: ${link(md(p.ph.file), p.ph.u)} — ${md(p.ph.a)}, ${md(p.ph.l)}` : `без фото (${md(photo && photo.note)})`);
      if (loc.display) extra.push(`геокодер: ${md(loc.display)}`);
      L.push(`  ${extra.join(' · ')}`);
    }
    L.push('');
  }

  if (res.events.length) {
    L.push(`## События (${res.events.length})`, '');
    for (const { event: e, post } of res.events) {
      const when = e.start === e.end ? e.start : `${e.start} — ${e.end}`;
      const bits = [`${when}${e.time ? ' ' + e.time : ''}`, `${md(e.venue)} (${md(e.addr)}, м. ${md(e.metro)})`];
      if (e.price) bits.push(fmtPrice(e.price));
      if (e.age) bits.push(e.age);
      // куда ведёт «Билеты» — домен открытым текстом, а не «сайт»
      const host = hostOf(e.url);
      const site = `билеты: ${link('`' + host + '`', e.url)}` + (/(^|\.)xn--/.test(host) ? ' ⚠ домен в punycode — проверьте' : '');
      L.push(`- ${e.emoji} **${md(e.title)}** (\`${e.id}\`) — ${bits.join(' · ')} · ${site} · ${postLink(post)}`);
      L.push(`  > ${md(e.note)}`);
    }
    L.push('');
  }

  if (res.plans.length) {
    L.push(`## Подборки (${res.plans.length})`, '');
    for (const { scenario: s } of res.plans) {
      L.push(`- ${MODE_EMOJI[s.mode] || ''} ${s.emoji} **${md(s.title)}** (\`${s.id}\`, ${s.when}) — ${stopsText(s.stops, places)}`
        + (s.tags.length ? ` · ${s.tags.join(', ')}` : ''));
      L.push(`  > ${md(s.why)}`);
    }
    L.push('');
  }

  if (res.updates.length) {
    L.push(`## Обновления мест — не применены, проверьте вручную (${res.updates.length})`, '');
    for (const u of res.updates) {
      const it = u.item, bits = [];
      if (it.address) bits.push(`адрес: ${md(it.address)}`);
      if (it.hours) bits.push(`часы: ${md(it.hours)}`);
      if (it.reason) bits.push(md(it.reason));
      L.push(`- **${md(u.name)}** (\`${u.id}\`, совпадение: ${md(u.by)})${bits.length ? ' — ' + bits.join(' · ') : ''} · ${postLink(u.post)}`);
    }
    L.push('');
  }

  if (res.rejected.length || res.plansRejected.length) {
    L.push(`## Отклонено (${res.rejected.length + res.plansRejected.length})`, '');
    for (const r of res.rejected) {
      const it = r.item;
      const what = it.type === 'event' && it.event ? it.event.title : it.name;
      L.push(`- ${md(r.reason)} — ${md(what) || '—'} (${TYPE_RU[it.type] || it.type}) · ${postLink(r.post)}`);
    }
    for (const r of res.plansRejected) L.push(`- план «${md(r.plan.title)}» (${stopsText(r.plan.stops, places)}): ${md(r.errors.join('; '))}`);
    L.push('');
  }

  if (res.dupEvents.length) {
    L.push(`## Уже в афише — не добавлены (${res.dupEvents.length})`, '');
    for (const d of res.dupEvents) {
      L.push(`- «${md(d.item.event && d.item.event.title)}» — повтор «${md(d.dup.title)}» (\`${d.dup.id}\`, ${d.dup.start}) · ${postLink(d.post)}`);
    }
    L.push('');
  }

  if (res.deferred.length) {
    L.push(`## Отложено до следующего запуска (${res.deferred.length})`, '');
    for (const d of res.deferred) {
      const what = d.item.type === 'event' && d.item.event ? d.item.event.title : d.item.name;
      L.push(`- ${md(d.reason)} — ${md(what) || '—'} · ${postLink(d.post)}`);
    }
    L.push('');
  }
  if (res.failed.length) {
    L.push(`## Не разобрано за ${MAX_ATTEMPTS} попытки (${res.failed.length})`, '');
    for (const p of res.failed) L.push(`- ${postLink(p)}`);
    L.push('');
  }

  L.push('## Источники', '');
  if (outage) L.push('- **модель не ответила ни разу** — прочитанное не отмечено, посты разберутся в следующий запуск');
  for (const s of srcRuns) {
    let what = s.error ? `ошибка: ${md(s.error)}` : s.skipped ? `пропущен: ${s.skipped}` : `новых постов ${s.posts}`;
    if (s.capped) {
      what += s.capped.left ? ` · ещё ${s.capped.left} ждут следующего запуска` : '';
      what += s.capped.lost ? ` · **пропущены посты ${s.capped.lost[0]}–${s.capped.lost[1]}** (слишком много с прошлого запуска)` : '';
    }
    L.push(`- ${s.type === 'inbox' ? 'ящик (issues)' : s.type + ' `' + s.name + '`'} — ${what}${s.ignored ? ` · от посторонних (пропущены): ${s.ignored.map(n => '#' + n).join(', ')}` : ''}`);
  }
  L.push(`- к разбору: ${fresh.length} · уже разобраны раньше: ${skipped.seen} · старые: ${skipped.old} · без текста: ${skipped.short} · нерелевантных: ${res.irrelevant}`
    + (overflow.length ? ` · не влезли в лимит ${LIMITS.posts} постов за запуск: ${overflow.length}` : '')
    + (res.waiting ? ` · ждут повтора без счёта попыток: ${res.waiting}` : '')
    + (prunedSeen ? ` · забыто старых отметок: ${prunedSeen}` : ''));
  if (inboxClose.length) L.push(`- issues ящика получат ответ и закроются после PR: ${inboxClose.map(n => '#' + n).join(', ')}`);
  L.push('');

  L.push('## Модель', '');
  L.push(`Вызовов ${usage.calls} · ввод ${usage.input} · вывод ${usage.output} · кеш: чтение ${usage.cacheRead}, запись ${usage.cacheWrite}`
    + (usage.errors ? ` · ошибок ${usage.errors}` : '') + (usage.refusals ? ` · отказов ${usage.refusals}` : ''));
  L.push(`Оценка: **≈ $${cost(usage).toFixed(2)}** (за 1 млн токенов: ввод $${PRICE.input}, вывод $${PRICE.output}, чтение кеша $${PRICE.cacheRead.toFixed(2)}, запись в кеш $${PRICE.cacheWrite}).`);
  L.push('');
  return L.join('\n');
}

/* ---------- CLI ---------- */

const isCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isCli) {
  main().then(r => {
    // модель молчит или все источники одного вида недоступны — красный запуск, письмо владельцу
    if (r && r.fatal) { console.error(`Ошибка: ${r.fatal}`); process.exitCode = 1; }
  }, e => {
    console.error(`Ошибка: ${e && e.message ? e.message : e}`);
    process.exitCode = 1;
  });
}

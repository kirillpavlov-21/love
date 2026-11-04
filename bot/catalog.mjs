/* Каталог сайта для бота: те же файлы, что грузит главная (config.js, shared.js, места, афиша, фото, geo.js, intent.js, pick.js).
   ─ loadCatalog({ dir }) — из папки репозитория (по умолчанию: бот на ноутбуке видит то же, что ежедневная задача уже слила в main);
   ─ loadCatalog({ base }) — с самого сайта (BOT_DATA=site): новые данные без git pull.
   Результат живёт ttl (по умолчанию час); не получилось обновить — остаётся прежний.
   clock — число (мс): «сейчас» для песочницы (тестам нужен один и тот же день); без него — настоящее время.

   Безопасность. Файлы сайта для бота — чужой код: их дописывает и робот каталога, а с сайта они приходят по сети.
   Поэтому они выполняются в отдельном мире V8 (vm.constants.DONT_CONTEXTIFY): window, document и прочее создаются внутри песочницы,
   снаружи туда не передаётся ни одного объекта или функции — иначе через .constructor.constructor код из песочницы
   дотянулся бы до process и токена бота. Граница — только строки: бот зовёт __api(имя, аргументы в JSON) и получает JSON-копию ответа. */
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

export const SITE = 'https://kirillpavlov-21.github.io/love/';
/* [файл, обязателен] — порядок как на страницах сайта: города, матчи и находки робота дописывают своё в KUDA и KUDA_EVENTS */
export const FILES = [
  ['config.js', true], ['assets/shared.js', true], ['assets/places.js', true], ['assets/places-spb.js'], ['assets/places-info.js'],
  ['assets/events.js'], ['assets/events-spb.js'], ['assets/sport.js'], ['assets/auto.js'], ['assets/photos.js'],
  ['assets/collections.js'], ['assets/collections-auto.js'], ['assets/cols.js'], ['assets/geo.js', true], ['assets/intent.js', true], ['assets/pick.js', true],
];

/* Окружение браузера — целиком внутри песочницы (код строкой, ничего снаружи) */
const BOOT = (site, clock) => `(() => {
  const g = globalThis, noop = () => {};
  const el = () => ({ style: {}, dataset: {}, children: [], classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop, getAttribute: () => null, appendChild: noop, append: noop, remove: noop, insertAdjacentHTML: noop,
    addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [] });
  const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } }; };
  const SITE = ${JSON.stringify(site)}, u = SITE.match(/^(https?:\\/\\/[^/]+)(\\/.*)$/) || [SITE, SITE, '/'];
  g.window = g; g.self = g;
  g.console = { log: noop, info: noop, warn: noop, error: noop, debug: noop };
  g.setTimeout = noop; g.clearTimeout = noop; g.setInterval = noop; g.clearInterval = noop;
  g.document = Object.assign(el(), { documentElement: el(), body: el(), head: el(), createElement: el, getElementById: () => null, readyState: 'complete', cookie: '' });
  g.location = { href: SITE + 'start.html', origin: u[1], pathname: u[2] + 'start.html', search: '', hash: '' };
  g.navigator = { userAgent: 'kuda-bot', language: 'ru-RU' };
  g.localStorage = store(); g.sessionStorage = store();
  g.addEventListener = noop; g.removeEventListener = noop; g.dispatchEvent = noop;
  g.matchMedia = () => ({ matches: false, addEventListener: noop });
  /* для ссылок «Позвать» (cols.js → encodeList): UTF-8 и base64 своими силами */
  g.TextEncoder = class { encode(s) { const b = unescape(encodeURIComponent(String(s))), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; } };
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  g.btoa = s => { s = String(s); let o = ''; for (let i = 0; i < s.length; i += 3) { const a = s.charCodeAt(i), b = s.charCodeAt(i + 1), c = s.charCodeAt(i + 2), n = (a << 16) | ((b || 0) << 8) | (c || 0);
    o += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (isNaN(b) ? '=' : B64[(n >> 6) & 63]) + (isNaN(c) ? '=' : B64[n & 63]); } return o; };
  ${typeof clock === 'number' && isFinite(clock) ? `{ const t = ${Math.round(clock)}; Date.now = () => t; }` : ''}
})();`;

/* Что бот может спросить у песочницы: аргументы и ответы — JSON. Объекты по id: план, место */
const API = `(() => {
  const g = globalThis, K = g.DateKit, I = g.KudaIntent, P = g.KudaPick;
  const plan = id => K.planById(String(id));
  const F = {
    data: () => ({ places: K.kuda().places, scenarios: K.kuda().scenarios, cfg: g.DATE_CONFIG || {} }),
    parse: (t, o) => I.parse(String(t || ''), o || {}),
    plans: (q, c) => { c = c || {}; if (Array.isArray(c.skip)) c.skip = new Set(c.skip); return P.plans(q || {}, c); },
    events: (q, c) => P.events(q || {}, c || {}),
    places: (q, c) => P.places(q || {}, c || {}),
    top: c => P.top(c || {}),
    indoorPlan: id => P.indoorPlan(plan(id)),
    planById: id => plan(id),
    planStops: id => K.planStops(plan(id)),
    planPhoto: id => K.planPhoto(plan(id)),
    cityOf: id => K.cityOf(String(id)),
    todayMsk: () => K.todayMsk(),
    dayNum: d => K.dayNum(String(d)),
    numDay: n => K.numDay(+n),
    distM: (a, b) => K.distM(a, b),
    cleanAuthor: s => K.cleanAuthor(String(s || '')),
    encodeList: ids => (g.KudaCols && typeof g.KudaCols.encodeList === 'function' ? g.KudaCols.encodeList((ids || []).map(String)) : ''),
  };
  g.__api = (name, args) => { const f = F[name]; if (!f) return 'null'; const r = f.apply(null, JSON.parse(args)); return JSON.stringify(r === undefined ? null : r); };
})();`;

async function readAll(src) {
  if (src.dir) return Promise.all(FILES.map(([f]) => fs.readFile(path.join(src.dir, f), 'utf8').catch(() => null)));
  const base = src.base.endsWith('/') ? src.base : src.base + '/';
  return Promise.all(FILES.map(([f]) => fetch(base + f, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
    .then(r => (r.ok ? r.text() : null)).catch(() => null)));
}

/* Загрузить каталог заново: { D, I, P, K, encodeList, cfg, site, at, missing } — всё, что отдаёт песочница, — копии */
export async function buildCatalog(src) {
  const site = src.site || (src.base ? new URL(src.base).href : SITE);
  const texts = await readAll(src);
  const ctx = vm.createContext(vm.constants.DONT_CONTEXTIFY);
  vm.runInContext(BOOT(site, src.clock), ctx, { filename: 'boot.js', timeout: 2000 });
  const missing = [];
  FILES.forEach(([f, required], i) => {
    if (texts[i] == null) { if (required) throw new Error(f + ' не загрузился'); missing.push(f); return; }
    try { vm.runInContext(texts[i], ctx, { filename: f, timeout: 10000 }); } catch (e) {
      if (required) throw new Error(f + ': ' + (e && e.message));
      missing.push(f);
    }
  });
  vm.runInContext(API, ctx, { filename: 'api.js', timeout: 2000 });
  const call = vm.runInContext('globalThis.__api', ctx);
  if (typeof call !== 'function') throw new Error('песочница без __api');
  // в песочницу — только строки, обратно — только строка JSON; разбираем её сами
  const J = (name, ...args) => {
    const out = call(String(name), JSON.stringify(args));
    if (typeof out !== 'string') throw new Error('песочница вернула не строку');
    return JSON.parse(out);
  };
  const data = J('data');
  if (!data || !data.places || !Array.isArray(data.scenarios)) throw new Error('каталог без мест и планов');
  const idOf = x => (x && typeof x === 'object' ? x.id : x);
  return {
    D: { places: data.places, scenarios: data.scenarios }, cfg: data.cfg || {},
    I: { parse: (t, o) => J('parse', t, o || {}) },
    P: {
      plans: (q, c) => J('plans', q || {}, Object.assign({}, c, c && c.skip ? { skip: Array.from(c.skip) } : null)),
      events: (q, c) => J('events', q || {}, c || {}),
      places: (q, c) => J('places', q || {}, c || {}),
      top: c => J('top', c || {}),
      indoorPlan: p => J('indoorPlan', idOf(p)),
    },
    K: {
      planById: id => J('planById', id), planStops: p => J('planStops', idOf(p)) || [], planPhoto: p => J('planPhoto', idOf(p)),
      cityOf: x => J('cityOf', idOf(x)), todayMsk: () => J('todayMsk'), dayNum: d => J('dayNum', d), numDay: n => J('numDay', n),
      distM: (a, b) => J('distM', { lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }), cleanAuthor: s => J('cleanAuthor', s),
    },
    encodeList: ids => J('encodeList', Array.from(ids || [])) || '',
    site, at: Date.now(), missing,
  };
}

const CACHE = new Map();
export async function loadCatalog(src) {
  const key = src.dir || src.base, ttl = src.ttl == null ? 3600e3 : src.ttl;
  const had = CACHE.get(key);
  if (had && had.value && Date.now() - had.value.at < ttl) return had.value;
  if (had && had.pending) return had.pending;
  const pending = buildCatalog(src).then(v => { CACHE.set(key, { value: v }); return v; }, e => {
    if (had && had.value) { CACHE.set(key, { value: Object.assign(had.value, { at: Date.now() - ttl + 300e3 }) }); return had.value; }   // повторим через 5 минут
    CACHE.delete(key);
    throw e;
  });
  CACHE.set(key, { value: had && had.value, pending });
  return pending;
}

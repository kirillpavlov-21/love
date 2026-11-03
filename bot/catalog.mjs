/* Каталог сайта для бота: те же файлы, что грузит главная (config.js, shared.js, места, афиша, фото, geo.js, intent.js, pick.js),
   выполняем в песочнице с минимальным window/document — как scripts/build-seo.mjs.
   ─ loadCatalog({ dir }) — из папки репозитория (бот на ноутбуке, тесты);
   ─ loadCatalog({ base }) — с самого сайта (бот в облаке): после ежедневного обновления сайта бот видит новые данные без передеплоя.
   Результат живёт ttl (по умолчанию час); не получилось обновить — остаётся прежний.
   clock — число (мс) или функция: «сейчас» для shared.js и intent.js (тестам нужен один и тот же день). */
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

function sandbox(clock) {
  const noop = () => {};
  const el = () => ({
    style: {}, dataset: {}, children: [], classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop, getAttribute: () => null, appendChild: noop, append: noop, remove: noop, insertAdjacentHTML: noop,
    addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [],
  });
  const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
  const sb = {
    console: { log: noop, info: noop, warn: noop, error: noop, debug: noop },
    setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
    URL, URLSearchParams, TextEncoder, TextDecoder, Intl, atob, btoa,
    document: Object.assign(el(), { documentElement: el(), body: el(), head: el(), createElement: el, getElementById: () => null, readyState: 'complete', cookie: '' }),
    location: { href: SITE + 'start.html', origin: new URL(SITE).origin, pathname: new URL(SITE).pathname + 'start.html', search: '', hash: '' },
    navigator: { userAgent: 'kuda-bot', language: 'ru-RU' },
    localStorage: store(), sessionStorage: store(), addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
  };
  sb.window = sb; sb.self = sb;
  sb.__clock = typeof clock === 'function' ? clock : typeof clock === 'number' ? () => clock : () => Date.now();
  vm.createContext(sb);
  vm.runInContext('(() => { Date.now = () => __clock(); })();', sb);
  return sb;
}

async function readAll(src) {
  if (src.dir) {
    return Promise.all(FILES.map(([f]) => fs.readFile(path.join(src.dir, f), 'utf8').catch(() => null)));
  }
  const base = src.base.endsWith('/') ? src.base : src.base + '/';
  return Promise.all(FILES.map(([f]) => fetch(base + f, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
    .then(r => (r.ok ? r.text() : null)).catch(() => null)));
}

/* Загрузить каталог заново: { W, K, I, P, D, CFG, site, at, missing } */
export async function buildCatalog(src) {
  const texts = await readAll(src);
  const W = sandbox(src.clock);
  const missing = [];
  FILES.forEach(([f, required], i) => {
    if (texts[i] == null) { if (required) throw new Error(f + ' не загрузился'); missing.push(f); return; }
    try { vm.runInContext(texts[i], W, { filename: f, timeout: 10000 }); } catch (e) {
      if (required) throw new Error(f + ': ' + e.message);
      missing.push(f);
    }
  });
  if (!W.KUDA || !W.KUDA.places || !W.DateKit || !W.KudaIntent || !W.KudaPick) throw new Error('каталог без KUDA, DateKit, KudaIntent или KudaPick');
  return { W, K: W.DateKit, I: W.KudaIntent, P: W.KudaPick, D: W.KUDA, CFG: W.DATE_CONFIG || {}, site: src.site || (src.base ? new URL(src.base).href : SITE), at: Date.now(), missing };
}

const CACHE = new Map();
export async function loadCatalog(src) {
  const key = src.dir || src.base, ttl = src.ttl == null ? 3600e3 : src.ttl;
  const had = CACHE.get(key);
  if (had && (had.value && Date.now() - had.value.at < ttl)) return had.value;
  if (had && had.pending) return had.pending;
  const pending = buildCatalog(src).then(v => { CACHE.set(key, { value: v }); return v; }, e => {
    if (had && had.value) { CACHE.set(key, { value: Object.assign(had.value, { at: Date.now() - ttl + 300e3 }) }); return had.value; }   // повторим через 5 минут
    CACHE.delete(key);
    throw e;
  });
  CACHE.set(key, { value: had && had.value, pending });
  return pending;
}

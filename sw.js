/* Service worker «Куда идём?»: быстрый повторный заход и работа без сети.
   ─ Страницы (HTML), config.js и манифест — сначала сеть (свежие тексты и номера ?v=). Сеть молчит дольше 4 с,
     а копия есть — показываем копию, сеть дописывает кэш в фоне. Без сети незнакомая страница — заглушка «Нет интернета»
     с кнопками «Обновить» и «Открыть главную» (главная сохраняется при установке).
   ─ assets/** — сначала кэш: адрес с ?v= не меняется, пока не поднимут номер. Скрипты и стили без ?v=
     ещё и тихо обновляются в фоне. Картинки — до 300 штук, самые старые вытесняются.
   ─ Чужие адреса (наш сервер API, посредник, Яндекс, шрифты, Метрика, Commons), запросы не GET
     и всё, что не страница и не файл сайта, не трогаем вовсе.
   ─ На localhost всё идёт «сначала сеть»: правки видны сразу, без подъёма ?v= (офлайн там тоже работает).
   ─ Клик по уведомлению, показанному через service worker, поднимает открытые «Мои приглашения» и ведёт к нужной
     карточке (data.url с #inv-…), а если вкладки нет — открывает data.url нашего сайта.
   Поменял логику этого файла или хочешь сбросить кэши у всех — подними VERSION. */
'use strict';

const VERSION = '2026-10-16.1';
const PAGES = 'kuda-pages-' + VERSION, ASSETS = 'kuda-assets-' + VERSION, IMAGES = 'kuda-img-' + VERSION;
const MAX_PAGES = 60, MAX_IMAGES = 300, NET_WAIT = 4000;

const ROOT = new URL('./', self.registration.scope);            // папка сайта: …/love/ или /
const DEV = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(ROOT.hostname);
const OFFLINE = new URL('start.html', ROOT).href;                // запасная страница без сети
const ROOT_FILES = ['config.js', 'manifest.webmanifest'];
const FILE_RE = /\.(?:js|css|json|webmanifest|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf)$/i;
const CODE_RE = /\.(?:js|css|json|webmanifest)$/i;

/* Что за запрос: page — страница, file — config.js и манифест, code — скрипт или стиль, img — картинка/шрифт, '' — мимо */
function kindOf(req) {
  if (req.method !== 'GET' || req.headers.has('range')) return '';
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return '';
  const url = new URL(req.url);
  if (url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return '';
  const rel = url.pathname.slice(ROOT.pathname.length);
  if (req.mode === 'navigate') return rel === '' || /(?:\/|\.html)$/.test(rel) ? 'page' : '';
  if (ROOT_FILES.indexOf(rel) >= 0) return 'file';
  if (rel.indexOf('assets/') === 0 && FILE_RE.test(rel)) return CODE_RE.test(rel) ? 'code' : 'img';
  return '';
}
/* Страница одна при любых ?m=…&place=… — храним без параметров */
const pageKey = req => { const u = new URL(req.url); return u.origin + u.pathname; };
const good = res => !!res && res.status === 200 && res.type === 'basic' && !res.redirected;
const MATCH = { ignoreVary: true };

/* Старые версии того же файла (другой ?v=) больше не нужны */
async function dropOtherVersions(cache, href) {
  const u = new URL(href);
  const keys = await cache.keys();
  await Promise.all(keys.filter(k => { const x = new URL(k.url); return x.pathname === u.pathname && x.search !== u.search; }).map(k => cache.delete(k)));
}
/* Сверх лимита — удаляем самые старые записи (главную для офлайна, config.js и манифест не трогаем) */
const pinned = k => k.url === OFFLINE || ROOT_FILES.some(f => k.url.split('?')[0] === new URL(f, ROOT).href);
async function trim(cache, max) {
  const keys = (await cache.keys()).filter(k => !pinned(k));
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)));
}
/* Записать ответ в кэш (в фоне, после того как страница уже получила ответ) */
async function store(cache, key, res, how) {
  try {
    await cache.put(key, res);
    if (how === 'trim-pages') await trim(cache, MAX_PAGES);
    else if (how === 'trim-images') await trim(cache, MAX_IMAGES);
    else if (how === 'versions') await dropOtherVersions(cache, typeof key === 'string' ? key : key.url);
  } catch (e) { /* место кончилось — не страшно */ }
}
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
/* Заглушка «Нет интернета» по тому же адресу: «Обновить» откроет нужную страницу, когда сеть вернётся;
   если главная сохранена — ещё и «Открыть главную» (она работает без сети) */
const offlinePage = withHome => new Response(
  '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#0F0E13"><title>Нет сети</title></head>' +
  '<body style="margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;box-sizing:border-box;background:#0F0E13;color:#F4F1EA;font:500 16px/1.5 system-ui,-apple-system,sans-serif;text-align:center">' +
  '<main style="max-width:360px"><h1 style="font-size:22px;margin:0 0 8px">Нет интернета</h1><p style="margin:0 0 18px;color:#A39EAE">Эта страница ещё не сохранилась на телефоне. Проверь сеть и попробуй снова.' +
  (withHome ? ' А готовые планы на главной открываются и без сети.' : '') + '</p>' +
  '<a href="" style="display:inline-block;margin:4px;padding:14px 22px;border-radius:14px;font-weight:700;text-decoration:none;background:#FF6F91;color:#1C0A10">Обновить</a>' +
  (withHome ? '<a href="' + OFFLINE + '" style="display:inline-block;margin:4px;padding:14px 22px;border-radius:14px;font-weight:700;text-decoration:none;border:1px solid rgba(244,241,234,.16);color:#F4F1EA">Открыть главную</a>' : '') +
  '</main></body></html>',
  { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

/* ---------- стратегии ---------- */
/* Сначала сеть; медленно, а копия есть — копия, сеть дописывает кэш в фоне */
async function networkFirst(event, req, key, isPage, name) {
  name = name || PAGES;
  const cache = await caches.open(name);
  const cached = await cache.match(key, MATCH);
  const net = (async () => {
    const pre = isPage && event.preloadResponse ? await event.preloadResponse.catch(() => null) : null;
    const res = pre || await fetch(req);
    if (good(res)) event.waitUntil(store(cache, key, res.clone(), isPage ? 'trim-pages' : name === IMAGES ? 'trim-images' : 'versions'));
    return res;
  })();
  event.waitUntil(net.catch(() => null));
  try {
    const res = await (cached ? Promise.race([net, sleep(NET_WAIT).then(() => cached)]) : net);
    return res.status >= 500 && cached ? cached : res;
  } catch (e) {
    if (cached) return cached;
    if (!isPage) throw e;
    return offline();
  }
}
/* Без сети и без копии страницы. Главную вместо незнакомой страницы не подставляем: адрес остался бы прежним
   (приглашение, конструктор), и ссылки «Поделиться» на такой странице вели бы не туда */
async function offline() {
  return offlinePage(!!(await caches.match(OFFLINE, MATCH)));
}
/* Сначала кэш; без ?v= скрипты и стили ещё и обновляются в фоне */
async function cacheFirst(event, req, name) {
  const cache = await caches.open(name);
  const cached = await cache.match(req, MATCH);
  const versioned = /[?&]v=/.test(new URL(req.url).search);
  if (cached && (name === IMAGES || versioned)) return cached;
  const net = fetch(req).then(res => {
    if (good(res)) event.waitUntil(store(cache, req, res.clone(), name === IMAGES ? 'trim-images' : versioned ? 'versions' : ''));
    return res;
  });
  if (cached) { event.waitUntil(net.catch(() => null)); return cached; }
  return net;
}

/* ---------- жизненный цикл ---------- */
/* Установка: главная и всё, что она подключает с нашего сайта, — чтобы она открывалась без сети с первого раза */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const res = await fetch(new Request(OFFLINE, { cache: 'no-cache' }));
    if (!good(res)) throw new Error('start.html: ' + res.status);
    const html = await res.clone().text();
    const pages = await caches.open(PAGES);
    await pages.put(OFFLINE, res);
    const urls = new Set();
    html.replace(/\s(?:src|href)="([^"#]+)"/g, (m, u) => { try { urls.add(new URL(u, OFFLINE).href); } catch (e) { /* мусор */ } return m; });
    /* Включена экономия трафика — заранее берём только config.js и манифест, скрипты и картинки докачаются по ходу */
    const lite = !!(self.navigator && self.navigator.connection && self.navigator.connection.saveData);
    await Promise.all(Array.from(urls).map(async u => {
      const req = new Request(u);
      const kind = kindOf(req);
      if (!kind || kind === 'page' || (lite && kind !== 'file')) return;
      try {
        const r = await fetch(req);
        if (good(r)) await (await caches.open(kind === 'file' ? PAGES : kind === 'img' ? IMAGES : ASSETS)).put(kind === 'file' ? u : req, r);
      } catch (e) { /* не страшно: догрузится при первом заходе */ }
    }));
    /* Новая версия включается сразу: страницы берутся из сети, файлы — по своему ?v=, так что старые вкладки не ломаются */
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [PAGES, ASSETS, IMAGES];
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.indexOf('kuda-') === 0 && keep.indexOf(n) < 0).map(n => caches.delete(n)));
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (e) { /* не поддерживается */ } }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const kind = kindOf(req);
  if (!kind) return;   // браузер сам сходит в сеть, как без service worker
  if (kind === 'page') event.respondWith(networkFirst(event, req, pageKey(req), true));
  else if (kind === 'file') event.respondWith(networkFirst(event, req, req.url, false));
  else if (DEV) event.respondWith(networkFirst(event, req, req.url, false, kind === 'img' ? IMAGES : ASSETS));
  else event.respondWith(cacheFirst(event, req, kind === 'img' ? IMAGES : ASSETS));
});

/* Нажали на уведомление, которое страница показала через service worker («Мои приглашения» на Android).
   Адрес — data.url (только наш сайт), по умолчанию — «Мои приглашения»; в нём якорь карточки: invites.html#inv-<id>.
   Эта страница уже открыта — поднимаем её вкладку и ведём к карточке:
     1) якорь другой — меняем только его (без перезагрузки; браузер сам прокрутит к карточке);
     2) и всегда шлём странице сообщение { type: 'kuda-notification-click', url, hash } — она прокрутит
        к карточке плавно и подсветит её, даже если якорь тот же или вкладка не под service worker.
   Не открыта или поднять не дали — открываем data.url в новой вкладке. */
const NOTIFY_MSG = 'kuda-notification-click';
/* Одна и та же страница? Без ?…, #… и «.html»: GitHub Pages отдаёт invites.html и по адресу …/invites */
const samePage = (a, b) => {
  const p = u => { const x = new URL(u); return x.origin + x.pathname.replace(/(?:\/index)?\.html$/i, '').replace(/\/$/, ''); };
  try { return p(a) === p(b); } catch (e) { return false; }
};
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  let url = new URL('invites.html', ROOT).href;
  if (typeof data.url === 'string' && data.url) {
    try { const u = new URL(data.url, ROOT); if (u.origin === ROOT.origin && u.pathname.startsWith(ROOT.pathname)) url = u.href; } catch (e) { /* по умолчанию */ }
  }
  const hash = new URL(url).hash;   // '#inv-…' или ''
  event.waitUntil((async () => {
    const wins = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(c => samePage(c.url, url));
    // несколько вкладок с этой страницей — сначала та, что в фокусе, потом видимая
    const rank = c => (c.focused ? 2 : 0) + (c.visibilityState === 'visible' ? 1 : 0);
    wins.sort((a, b) => rank(b) - rank(a));
    for (const c of wins) {
      let win = null;
      try { win = typeof c.focus === 'function' ? ((await c.focus()) || c) : null; } catch (e) { /* поднять не дали — следующая или новая вкладка */ }
      if (!win) continue;
      if (hash && new URL(win.url).hash !== hash && typeof win.navigate === 'function') {
        // navigate умеет только вкладка под этим service worker; смена одного якоря страницу не перезагружает.
        // Отказ (вкладка не под service worker) или нет ответа 3 с — остаёмся с той же вкладкой, хватит сообщения
        try {
          const nav = Promise.resolve(win.navigate(win.url.split('#')[0] + hash)).catch(() => null);
          win = (await Promise.race([nav, sleep(3000).then(() => null)])) || win;
        } catch (e) { /* ок */ }
      }
      try { win.postMessage({ type: NOTIFY_MSG, url, hash }); } catch (e) { /* вкладка закрылась — она уже поднята, ничего страшного */ }
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});

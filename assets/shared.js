/* Общий код игры и конструктора. Настройки — в config.js, здесь менять ничего не нужно. */
(function () {
  'use strict';

  /* Запасные значения, если в config.js чего-то не хватает */
  const BASE = {
    her: 'Солнышко', me: 'Я', catName: 'Мурчик', cat: 'line', theme: 'pink',
    greeting: 'Я {cat} — почтовый котик 🐾 {me} просит передать тебе кое-что очень важное… Но сначала пройди маленькую игру!',
    question: 'Пойдёшь со мной на свидание?',
    signature: '{me}',
    finale: 'Жду нашей встречи! 💕',
    levels: { hearts: true, letter: true, place: true, date: true, time: true, food: true },
    heartsGoal: 12,
    noButton: 'runaway',
    places: [], placeSurprise: true, placeCustom: true,
    dates: { mode: 'next', start: '', days: 14, skipWeekdays: [], list: [] },
    dateOther: true,
    time: { from: '12:00', to: '22:00', step: 30, def: '19:00' },
    food: [],
  };

  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  /* Ключи, которые из чужой ссылки (JSON) могли бы подменить прототип объекта */
  const BAD_KEYS = ['__proto__', 'constructor', 'prototype'];
  function merge(base, over) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    if (!isObj(over)) return out;
    for (const k of Object.keys(over)) {
      if (BAD_KEYS.includes(k)) continue;
      const v = over[k];
      if (v === undefined) continue;
      out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
    }
    return out;
  }

  function defaults() {
    const cfg = window.DATE_CONFIG || {};
    return merge(BASE, cfg.invite || {});
  }

  /* ---------- ссылка ----------
     В ссылку кладём только то, что отличается от config.js (обычно лишь имена),
     и выбираем самый короткий вариант: как есть или сжатый.
     Формат: #<код>[&p=1][&s=N]. Старые ссылки вида #i=<код> тоже работают. */
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (isObj(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    return JSON.stringify(v);
  }
  function diffInvite(obj, base) {
    const out = {};
    for (const k of Object.keys(obj)) {
      const a = obj[k], b = base ? base[k] : undefined;
      if (isObj(a) && isObj(b)) {
        const d = diffInvite(a, b);
        if (Object.keys(d).length) out[k] = d;
      } else if (canon(a) !== canon(b)) out[k] = a;
    }
    return out;
  }
  function toB64url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64url(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function pipe(bytes, Stream, format) {
    const res = new Response(new Blob([bytes]).stream().pipeThrough(new Stream(format)));
    return new Uint8Array(await res.arrayBuffer());
  }
  /* Короткие имена полей (только для ссылки) */
  const KEYS = ('her:a me:b catName:c cat:d theme:e greeting:f question:g signature:h finale:i levels:j heartsGoal:k ' +
    'noButton:l places:m placeSurprise:n placeCustom:o dates:p dateOther:q time:r food:s emoji:t title:u note:v mode:w ' +
    'start:x days:y skipWeekdays:z list:A from:B to:C step:D def:E hearts:F letter:G place:H date:I opts:J plan:K tg:L tgu:M ' +
    'event:N').split(' ').map(x => x.split(':'));   // новые ключи — только в конец, старые буквы не переиспользуем
  const SHORT = Object.fromEntries(KEYS), LONG = Object.fromEntries(KEYS.map(([l, sh]) => [sh, l]));
  function rekey(v, map) {
    if (Array.isArray(v)) return v.map(x => rekey(x, map));
    if (isObj(v)) { const o = {}; for (const k of Object.keys(v)) o[map[k] || k] = rekey(v[k], map); return o; }
    return v;
  }
  /* Кириллица — 1 байт на букву вместо 2 (остальное как UTF-8 после байта 0xC2) */
  function packText(str) {
    const out = [], enc = new TextEncoder();
    for (const ch of str) {
      const c = ch.codePointAt(0);
      if (c < 0x80) out.push(c);
      else if (c >= 0x410 && c <= 0x44F) out.push(0x80 + c - 0x410);
      else if (c === 0x401) out.push(0xC0);
      else if (c === 0x451) out.push(0xC1);
      else { out.push(0xC2); enc.encode(ch).forEach(b => out.push(b)); }
    }
    return new Uint8Array(out);
  }
  function unpackText(bytes) {
    let s = '';
    const dec = new TextDecoder();
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b < 0x80) s += String.fromCharCode(b);
      else if (b < 0xC0) s += String.fromCharCode(0x410 + b - 0x80);
      else if (b === 0xC0) s += 'Ё';
      else if (b === 0xC1) s += 'ё';
      else {
        const lead = bytes[i + 1], n = lead >= 0xF0 ? 4 : lead >= 0xE0 ? 3 : 2;
        s += dec.decode(bytes.subarray(i + 1, i + 1 + n));
        i += n;
      }
    }
    return s;
  }
  const FORMATS = { k: 'deflate-raw', r: 'deflate-raw', z: 'deflate' };
  async function encodeInvite(obj) {
    const bytes = packText(JSON.stringify(rekey(obj, SHORT)));
    let best = 'c' + toB64url(bytes);
    if (window.CompressionStream) {
      try {
        const c = 'k' + toB64url(await pipe(bytes, CompressionStream, 'deflate-raw'));
        if (c.length < best.length) best = c;
      } catch (e) { /* без сжатия */ }
    }
    return best;
  }
  async function decodeInvite(code) {
    const kind = code[0];
    let bytes = fromB64url(code.slice(1));
    if (FORMATS[kind]) bytes = await pipe(bytes, DecompressionStream, FORMATS[kind]);
    else if (!'jc'.includes(kind)) throw new Error('bad code');
    if (kind === 'c' || kind === 'k') return rekey(JSON.parse(unpackText(bytes)), LONG);
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  /* То же, но без коротких ключей — для голосов и ответов, где ключи и так короткие */
  async function encodeData(obj) {
    const bytes = packText(JSON.stringify(obj));
    let best = 'c' + toB64url(bytes);
    if (window.CompressionStream) {
      try {
        const c = 'k' + toB64url(await pipe(bytes, CompressionStream, 'deflate-raw'));
        if (c.length < best.length) best = c;
      } catch (e) { /* без сжатия */ }
    }
    return best;
  }
  async function decodeData(code) {
    const kind = code[0];
    let bytes = fromB64url(code.slice(1));
    if (kind === 'k') bytes = await pipe(bytes, DecompressionStream, 'deflate-raw');
    else if (kind !== 'c') throw new Error('bad code');
    return JSON.parse(unpackText(bytes));
  }
  function readHash(hash) {
    const parts = String(hash === undefined ? location.hash : hash).replace(/^#/, '').split('&');
    const p = {};
    let code = '';
    parts.forEach((part, i) => {
      if (!part) return;
      const eq = part.indexOf('=');
      if (eq < 0) { if (i === 0) code = part; return; }
      try { p[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1)); } catch (e) { /* битый параметр */ }
    });
    return { code: code || p.i || '', preview: p.p === '1', start: parseInt(p.s, 10) || 0, votes: p.v || '', answer: p.a || '', results: p.r === '1' };
  }

  /* ---------- тексты ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fill(str, inv) {
    return String(str || '').replace(/\{her\}/g, inv.her).replace(/\{me\}/g, inv.me).replace(/\{cat\}/g, inv.catName).replace(/\{title\}/g, inv.title || '');
  }
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /* ---------- даты ---------- */
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  function parseYmd(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  function listDates(cfg) {
    cfg = cfg || {};
    // «сегодня» — по Москве: свидание в Москве, а телефон может жить в другом часовом поясе
    const today = parseYmd(todayMsk());
    let out = [];
    if (cfg.mode === 'list') {
      out = (cfg.list || []).map(parseYmd).filter(Boolean);
    } else {
      let start = parseYmd(cfg.start) || addDays(today, 1);
      if (start < today) start = today;
      const skip = (cfg.skipWeekdays || []).map(Number);
      const days = Math.max(1, Math.min(90, +cfg.days || 14));
      for (let i = 0; i < days; i++) {
        const d = addDays(start, i);
        if (!skip.includes(d.getDay())) out.push(d);
      }
    }
    const uniq = Array.from(new Set(out.filter(d => d >= today).map(ymd)));
    return uniq.sort();
  }
  function fmtDay(s) {
    const d = parseYmd(s);
    if (!d) return s;
    const t = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  const DAY0 = Date.UTC(2020, 0, 1);
  const dayNum = s => { const d = parseYmd(s); return d ? Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - DAY0) / 864e5) : -1; };
  const numDay = n => { const d = new Date(DAY0 + n * 864e5); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
  const toMin = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const fromMin = m => pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60);

  /* ---------- отправка ответов ----------
     Токена на сайте нет: текст уходит посреднику (Google Apps Script),
     он пересылает его в Telegram. text/plain — чтобы браузер не делал preflight. */
  /* Ответ посредника как есть: { ok, error? }; error: 'net' — нет связи, 'rate' — слишком часто, 'key' — ключ не подошёл */
  async function relayCall(url, body) {
    if (!url) return { ok: false, error: 'off' };
    let r;
    try { r = await fetch(url, { method: 'POST', body: JSON.stringify(body) }); } catch (e) { return { ok: false, error: 'net' }; }
    try {
      const j = await r.json();
      return j && typeof j === 'object' ? j : { ok: false, error: 'busy' };
    } catch (e) {
      // вместо JSON — страница ошибки (лимит Apps Script, сбой): связь есть, сервер перегружен
      return { ok: false, error: 'busy' };
    }
  }
  /* id — хэш приглашения, c — отпечаток секрета создателя из ссылки: посредник пересылает ответ,
     только если приглашение зарегистрировал его создатель (знает секрет s, у которого этот отпечаток) */
  const relaySend = (url, text, id, c) => relayCall(url, { text, id: id || '', c: c || '' }).then(j => !!j.ok);
  /* Пустой ids — просто проверка ключа */
  const relayRegister = (url, key, ids, s) => relayCall(url, { action: 'register', key, s: s || '', ids });
  const relayTest = (url, key) => relayCall(url, { action: 'test', key });

  /* ---------- короткие ссылки ----------
     В чат не должны уходить километровые ссылки. По очереди пробуем:
     1) свой сервер (config.js → api.url, assets/api.js): ссылка вида …/go.html#s=Ab3cD9e — данные остаются у нас;
     2) свой сокращатель в посреднике (config.js → telegram.relayUrl, action 'short'): тоже …/go.html#s=…;
     3) clck.ru (сокращатель Яндекса), если он отвечает браузеру;
     4) если ничего не вышло — исходная ссылка. Результат запоминается на время сессии.
     Каждый способ ждём ограниченное время и обрываем запрос, чтобы он не досылался в фоне. */
  const SHORT_CACHE = 'kuda-short';
  const sitePath = file => new URL(file, location.href).href.split('#')[0].split('?')[0];
  function timed(f, ms) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    let t = 0;
    const stop = new Promise((_, rej) => { t = setTimeout(() => { if (ctl) ctl.abort(); rej(new Error('timeout')); }, ms); });
    return Promise.race([f(ctl ? ctl.signal : undefined), stop]).then(v => { clearTimeout(t); return v; }, e => { clearTimeout(t); throw e; });
  }
  async function shortLink(url) {
    if (!url || url.length < 60) return url;
    let cache = {};
    try { cache = JSON.parse(sessionStorage.getItem(SHORT_CACHE) || '{}'); } catch (e) { /* ок */ }
    if (cache[url]) return cache[url];
    const cfg = (window.DATE_CONFIG || {}).telegram || {};
    const api = window.KudaAPI;
    const tries = [];
    // сервер только что не ответил (например, страница сама спросила его секунду назад) — не ждём его второй раз
    if (api && api.on && typeof api.short === 'function' && !/^(net|timeout)$/.test(api.lastError || '')) tries.push([async () => {
      const code = await api.short(url);   // свой таймаут у api.js; ошибка — null
      if (typeof code !== 'string' || !/^[A-Za-z0-9]{4,16}$/.test(code)) throw new Error('api');
      return sitePath('go.html') + '#s=' + code;
    }, 6000]);
    // Apps Script просыпается долго — ждём его дольше
    if (cfg.relayUrl) tries.push([async signal => {
      const r = await fetch(cfg.relayUrl, { method: 'POST', body: JSON.stringify({ action: 'short', url }), signal });
      const j = await r.json();
      if (!j.ok || !/^[A-Za-z0-9_-]{1,16}$/.test(j.id || '')) throw new Error('relay');
      return sitePath('go.html') + '#s=' + j.id;
    }, 7000]);
    tries.push([async signal => {
      const r = await fetch('https://clck.ru/--?url=' + encodeURIComponent(url), { signal });
      const t = (await r.text()).trim();
      if (!/^https:\/\/clck\.ru\/[A-Za-z0-9_-]+$/.test(t)) throw new Error('clck');
      return t;
    }, 3500]);
    for (const [f, ms] of tries) {
      try {
        const short = await timed(f, ms);
        cache[url] = short;
        try { sessionStorage.setItem(SHORT_CACHE, JSON.stringify(cache)); } catch (e) { /* ок */ }
        return short;
      } catch (e) { /* следующий способ */ }
    }
    cache[url] = url;   // не получилось — не ждём сервисы повторно в этой сессии
    try { sessionStorage.setItem(SHORT_CACHE, JSON.stringify(cache)); } catch (e) { /* ок */ }
    return url;
  }
  /* Короткая ссылка на маршрут плана из подборки: go.html#r=<id плана> сама откроет Яндекс Карты */
  const goRoute = planId => sitePath('go.html') + '#r=' + encodeURIComponent(planId);

  /* ---------- режимы ---------- */
  const MODES = {
    date: { label: 'Свидание', emoji: '💕', theme: 'pink', acc: '', group: false },
    guys: {
      label: 'Пацаны', emoji: '🍻', theme: 'sport', acc: 'shades', group: true,
      title: 'Пятница с пацанами',
      greeting: 'Йо! Я {cat}, и у меня срочное донесение: {me} собирает пацанов — «{title}». Но сначала разминка!',
      question: 'Погнали? Ты с нами?', yes: 'Я в деле', no: 'Не смогу',
      catchTitle: 'Собери всё для вечера', good: ['🍕', '🎱', '🎳', '🏆', '🔥'], gold: '👑', bad: '🧦',
      done: 'Кидай ссылку пацанам в чат — пусть тоже отметятся.',
    },
    girls: {
      label: 'Подружки', emoji: '💅', theme: 'lavender', acc: 'bow', group: true,
      title: 'Девичник',
      greeting: 'Привет! Я {cat} 🎀 {me} собирает девочек — «{title}». Но сначала маленькая игра!',
      question: 'Девочки, собираемся? Ты с нами?', yes: 'Конечно!', no: 'Не смогу',
      catchTitle: 'Собери всё для девичника', good: ['💅', '🌸', '🧁', '🎀', '☕'], gold: '💎', bad: '🧹',
      done: 'Отправь ссылку девочкам в чат, чтобы все отметились.',
    },
  };
  // только свои ключи: mode из ссылки вроде 'constructor' или '__proto__' — это не режим
  const modeOf = inv => { const m = inv && inv.mode; return typeof m === 'string' && Object.prototype.hasOwnProperty.call(MODES, m) ? m : 'date'; };

  const kuda = () => window.KUDA || { places: {}, scenarios: [], adult: [] };
  /* Закрытые места (closed: true — ставит assets/auto.js) нигде не показываем.
     Только свои ключи: ?place=constructor не должен находить Object.prototype.constructor */
  const placeById = id => {
    const P = kuda().places;
    const p = typeof id === 'string' && P && Object.prototype.hasOwnProperty.call(P, id) ? P[id] : null;
    return p && typeof p === 'object' && !p.closed ? p : null;
  };
  /* Готовый план из подборки или «план» из одного места каталога: p-<id места> */
  const planById = id => {
    const s = kuda().scenarios.find(x => x.id === id);
    if (s) return s.stops.some(x => (kuda().places[x] || {}).closed) ? null : s;
    const p = typeof id === 'string' && id.startsWith('p-') ? placeById(id.slice(2)) : null;
    return p && !p.adult ? { id, mode: '', emoji: p.emoji, title: p.name, stops: [id.slice(2)], when: '', why: p.note, single: true } : null;
  };
  const planStops = plan => (plan ? plan.stops.map(placeById).filter(Boolean) : []);

  /* ---------- города ----------
     У старых данных поля city нет — это Москва. Петербург: места spb-…, планы spb-d-/spb-g-/spb-w-…, события ev-spb-…;
     матчи из sport.js несут city сами. Город интерфейса: ?city= → localStorage 'kuda-city' → Москва. */
  const CITIES = {
    msk: { id: 'msk', name: 'Москва', full: 'Москва', in: 'в Москве', gen: 'Москвы', center: [55.751, 37.618], zoom: 11, maxKm: 70,
      ya: { id: 213, slug: 'moscow' }, addr: 'Москва', seo: 'moskva', all: 'Вся Москва',
      okrs: [['center', 'Центр'], ['north', 'Север'], ['ne', 'Северо-Восток'], ['east', 'Восток'], ['se', 'Юго-Восток'], ['south', 'Юг'],
        ['sw', 'Юго-Запад'], ['west', 'Запад'], ['nw', 'Северо-Запад'], ['khimki', 'Химки · Левобережный'], ['zel', 'Зеленоград'], ['new', 'Новая Москва'], ['mo', 'Подмосковье']] },
    spb: { id: 'spb', name: 'Петербург', full: 'Санкт-Петербург', in: 'в Петербурге', gen: 'Петербурга', center: [59.939167, 30.315833], zoom: 11, maxKm: 60,
      ya: { id: 2, slug: 'saint-petersburg' }, addr: 'Санкт-Петербург', seo: 'spb', all: 'Весь Петербург',
      okrs: [['center', 'Центр'], ['petrograd', 'Петроградка'], ['vo', 'Васильевский'], ['north', 'Север'], ['nw', 'Приморский'], ['south', 'Юг'],
        ['sw', 'Юго-Запад'], ['east', 'Правый берег'], ['out', 'Пригороды']] },
  };
  const CITY_KEY = 'kuda-city';
  const SPB_ID = /^(spb-|ev-spb-|p-spb-)/;
  const isCity = c => typeof c === 'string' && Object.prototype.hasOwnProperty.call(CITIES, c);
  function city() {
    try { const q = new URLSearchParams(location.search).get('city'); if (isCity(q)) return q; } catch (e) { /* нет location */ }
    try { const s = localStorage.getItem(CITY_KEY); if (isCity(s)) return s; } catch (e) { /* приватный режим */ }
    return 'msk';
  }
  function setCity(c) {
    if (!isCity(c)) return;
    try { localStorage.setItem(CITY_KEY, c); } catch (e) { /* приватный режим */ }
  }
  const cityConf = c => CITIES[isCity(c) ? c : city()];
  /* Город места, плана, события или id; у точки без id и города — по координатам */
  function cityOf(x) {
    if (x == null) return 'msk';
    if (typeof x === 'string') {
      if (SPB_ID.test(x)) return 'spb';
      const p = placeById(x); if (p) return cityOf(p);
      const s = kuda().scenarios.find(y => y.id === x); if (s) return cityOf(s);
      const e = eventById(x); if (e) return cityOf(e);
      return 'msk';
    }
    if (isCity(x.city)) return x.city;
    if (typeof x.id === 'string' && SPB_ID.test(x.id)) return 'spb';
    if (Array.isArray(x.stops) && x.stops.length) return cityOf(String(x.stops[0]));
    if (typeof x.place === 'string' && x.place) return cityOf(x.place);
    if (Number.isFinite(x.lat) && Number.isFinite(x.lon)) return cityByPoint(x.lat, x.lon) || 'msk';
    return 'msk';
  }
  const inCity = (x, c) => cityOf(x) === (isCity(c) ? c : city());
  /* Город по точке: в пределах maxKm от центра, иначе null */
  function cityByPoint(lat, lon) {
    for (const c of Object.values(CITIES)) if (distM({ lat, lon }, { lat: c.center[0], lon: c.center[1] }) <= c.maxKm * 1000) return c.id;
    return null;
  }
  /* Раздел каталога: поле cat, а у старых мест — по типу места */
  const CAT_BY_KIND = [
    ['pc', /компьютерн|кибер/i],
    ['books', /книж/i], ['spa', /бан|спа|хамам|аквапарк|терм/i], ['coffee', /коф|пекар|кондитер|булоч|чайн/i],
    ['fun', /тир|боулинг|картинг|vr|квест|скалодром|падел|стендап|бильярд|караоке|аттракц|развлеч|теплоход|студи|мастер|арт-вечер|танц|стадион|петанк/i],
    ['culture', /музе|театр|кино|галере|планетар|концерт|дом культуры|культурн|центр|искусств|лекторий|архитектур/i],
    ['walk', /парк|сад|набереж|усадьб|заповедник|смотров|квартал|дизайн-завод|креатив/i],
    ['bar', /бар|паб|лаунж|винотек|крафт/i],
  ];
  const catOf = p => (p && (p.cat || p.c)) || ((CAT_BY_KIND.find(([, rx]) => rx.test((p && p.kind) || '')) || ['food'])[0]);
  /* ---------- подсказки к местам и планам: «красиво осенью», «для первого свидания»… ----------
     Часть подсказок выводится из данных (тип места, цена, Michelin), часть задана руками в поле hint. */
  const HINTS = {
    halloween: ['🎃', 'Тематично на Хэллоуин', 'Хэллоуин'],
    autumn: ['🍂', 'Красиво осенью', 'Осень'],
    newyear: ['🎄', 'Новогоднее настроение', 'Новый год'],
    first:['💘', 'Для первого свидания', 'Первое свидание'],
    michelin: ['⭐', 'Гид Michelin 2021', 'Michelin'],
    view: ['🏙️', 'С видом', 'С видом'],
    scenic: ['🌅', 'Живописно', 'Живописно'],
    rain: ['☔', 'Если дождь', 'Если дождь'],
    company: ['👯', 'Для компании', 'Компанией'],
    night: ['🌙', 'Работает круглосуточно', '24/7'],
    budget: ['💸', 'Недорого', 'Недорого'],
  };
  const HINT_ORDER = Object.keys(HINTS);
  const HRX = {
    nature: /парк|сад|усадьб|лес|заповедник|заказник|ботаническ|дендр|пруд|бульвар|бор\b|пойм|овраг|холм|чаша|долин|роща/i,
    view: /панорам|смотров|этаж|на крыше|крыш|высот|с видом|вид на /i,
    indoor: /компьютерн|музе|театр|галере|кино|выстав|аквапарк|бан[ия]|спа\b|хамам|боулинг|квест|бильярд|планетар|цирк|библиотек|книжн|лекторий|концерт|караоке|тир|vr|скалодром|мастерск|студи|бункер|дворец|культурн|ужин-спектакль|ужин-шоу|оранжере|стендап/i,
    company: /караоке|бар\b|бар |паб|бильярд|квест|картинг|боулинг|тир|стендап|клуб|бани|баня|vr|раки|фудхолл|фудмолл|кластер|теплоход|гастробар/i,
    walk: /парк|сад|набереж|улица|бульвар|мост|площадь|квартал|пруд|усадьб|лес|заказник|заповедник|некрополь|ансамбль|монастыр|озеро|акведук|бор\b/i,
  };
  /* ---------- московское время и сезоны ----------
     Москва живёт по UTC+3 без перехода на летнее время, поэтому дату считаем сдвигом, без Intl:
     поля getUTC*() у mskDate() — московские. */
  const MSK_MS = 3 * 3600e3;
  const mskDate = d => new Date((d == null ? Date.now() : +d) + MSK_MS);
  /* Сегодня по Москве: 'YYYY-MM-DD' (d — необязательная дата, для проверок) */
  const todayMsk = d => { const x = mskDate(d); return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate()); };
  const mskMD = d => { const x = mskDate(d); return [x.getUTCMonth() + 1, x.getUTCDate()]; };
  /* Сезон: зима — декабрь–февраль, весна — март–май, лето — июнь–август, осень — сентябрь–ноябрь */
  const SEASONS = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
  const seasonNow = d => SEASONS[mskMD(d)[0] - 1];
  /* План (или место) с полем season: ['winter', …] показываем в каталоге только в свой сезон; без поля — круглый год.
     По прямой ссылке и в приглашениях такой план всё равно открывается. */
  const seasonOk = (x, d) => !x || !Array.isArray(x.season) || !x.season.length || x.season.includes(seasonNow(d));
  /* Сезонные подсказки живут только в свой срок (по Москве): 🎃 — с 1 октября по 1 ноября,
     🎄 — с 1 декабря по 10 января, 🍂 — с сентября по ноябрь. Вне срока их нет ни в фильтрах, ни на карточках. */
  const HINT_WHEN = {
    halloween: (m, day) => m === 10 || (m === 11 && day === 1),
    newyear: (m, day) => m === 12 || (m === 1 && day <= 10),
    autumn: m => m >= 9 && m <= 11,
  };
  const hintLive = (k, d) => !HINT_WHEN[k] || HINT_WHEN[k].apply(null, mskMD(d));
  const HINT_CACHE = new WeakMap();
  const placeHints = p => placeHintsAll(p).filter(k => hintLive(k));
  function placeHintsAll(p) {
    if (!p) return [];
    if (HINT_CACHE.has(p)) return HINT_CACHE.get(p);
    const h = new Set(p.hint || []);
    const txt = p.kind + ' ' + (p.note || '');
    if (p.mich) h.add('michelin');
    if (HRX.view.test(txt)) h.add('view');
    const walk = p.cat === 'walk' || HRX.walk.test(p.kind);
    if (walk) h.add('scenic');
    if (HRX.nature.test(p.kind) || (walk && HRX.nature.test(p.name))) h.add('autumn');
    if (!walk && HRX.indoor.test(p.kind)) h.add('rain');
    if (HRX.company.test(p.kind)) h.add('company');
    if ((p.price || 1) <= 1) h.add('budget');
    const out = HINT_ORDER.filter(k => h.has(k));
    HINT_CACHE.set(p, out);
    return out;
  }
  function planHints(plan) {
    if (!plan) return [];
    const st = planStops(plan);
    if (!st.length) return [];
    const per = st.map(placeHints), h = new Set();
    (plan.tags || []).concat(plan.hint || []).forEach(t => { if (HINTS[t]) h.add(t); });
    per.forEach(a => a.forEach(x => { if (['halloween', 'newyear', 'michelin', 'view', 'autumn', 'first', 'scenic', 'company'].includes(x)) h.add(x); }));
    if (per.every(a => a.includes('rain'))) h.add('rain');
    const top = Math.max(...st.map(p => p.price || 1));
    if (top <= 1) h.add('budget');
    if (plan.mode && plan.mode !== 'date') h.delete('first');
    return HINT_ORDER.filter(k => h.has(k) && hintLive(k));
  }
  /* Сезонные подсказки, которые сейчас в сроке (их поднимаем наверх): 'halloween', 'newyear', 'autumn' */
  const seasonHints = d => Object.keys(HINT_WHEN).filter(k => hintLive(k, d));
  /* form: 'icon' — только эмодзи, 'short' — короткая подпись, по умолчанию — полная */
  const hintChip = (k, form) => HINTS[k] ? `<span class="hchip h-${k}" title="${HINTS[k][1]}">${HINTS[k][0]}${form === 'icon' ? '' : ' ' + HINTS[k][form === 'short' ? 2 : 1]}</span>` : '';

  /* ---------- афиша: события из assets/events.js и assets/auto.js (window.KUDA_EVENTS) ----------
     Даты — строки 'YYYY-MM-DD' по Москве. Прошедшие события (end раньше сегодняшнего дня) в списки не попадают,
     но eventById находит и их — чтобы старые приглашения на событие открывались. Находит и по прежнему id из поля aka
     (футбольные матчи переехали из events.js в sport.js с новыми id, у перенесённого матча меняется дата в id). */
  const RX_YMD = /^\d{4}-\d{2}-\d{2}$/;
  const evAll = () => (Array.isArray(window.KUDA_EVENTS) ? window.KUDA_EVENTS : []).filter(e => e && e.id && e.title && RX_YMD.test(e.start || ''));
  const evEnd = ev => (RX_YMD.test(ev.end || '') && ev.end >= ev.start ? ev.end : ev.start);
  const eventById = id => {
    if (!id) return null;
    const all = evAll();
    return all.find(e => e.id === id) || all.find(e => Array.isArray(e.aka) && e.aka.includes(id)) || null;
  };
  const EV_MAX_DAYS = 90;   // у долгих выставок — не больше 90 дней вперёд, как в listDates
  /* Дни события начиная с сегодняшнего (или from): явные dates либо каждый день от start до end */
  function eventDays(ev, from) {
    if (!ev || !RX_YMD.test(ev.start || '')) return [];
    const first = from && RX_YMD.test(from) && from > todayMsk() ? from : todayMsk(), end = evEnd(ev);
    if (Array.isArray(ev.dates) && ev.dates.length) {
      return Array.from(new Set(ev.dates.filter(d => RX_YMD.test(d) && d >= first && d >= ev.start && d <= end))).sort().slice(0, EV_MAX_DAYS);
    }
    const out = [];
    for (let n = Math.max(dayNum(ev.start), dayNum(first)), last = dayNum(end); n <= last && out.length < EV_MAX_DAYS; n++) out.push(numDay(n));
    return out;
  }
  /* Ближайшие события: { from, to: 'YYYY-MM-DD', mode: 'date'|'guys'|'girls' } → по ближайшей дате, затем по времени */
  function events(o) {
    o = o || {};
    const to = RX_YMD.test(o.to || '') ? o.to : '';
    const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    return evAll().map(ev => {
      if (o.mode && Array.isArray(ev.fit) && ev.fit.length && !ev.fit.includes(o.mode)) return null;
      const day = eventDays(ev, o.from)[0];
      return day && (!to || day <= to) ? [ev, day] : null;
    }).filter(Boolean)
      .sort((a, b) => cmp(a[1], b[1]) || cmp(a[0].time || '99', b[0].time || '99') || String(a[0].title).localeCompare(String(b[0].title), 'ru'))
      .map(x => x[0]);
  }

  /* Фото места из assets/photos.js: { s: большое, t: превью, a: автор, l: лицензия, u: страница файла, src?: источник (без него — Wikimedia Commons) } */
  const photo = p => (p && p.ph) || null;
  const planPhoto = plan => planStops(plan).map(photo).find(Boolean) || null;
  /* Подпись автора без лишнего: ссылки на соцсети и каналы, просьбы «подписывайте так-то» и хвосты длиннее 60 знаков убираем */
  const SOC = '(?:telegram|телеграм|t\\.me|tg:|instagram|инстаграм|vk\\.com|вконтакте|youtube)';
  const RX_SOC_BOX = new RegExp('\\s*[([][^)\\]]*' + SOC + '[^)\\]]*[)\\]]', 'gi');   // «(Telegram: канал)» целиком
  const RX_SOC_TAIL = new RegExp('(^|\\s)' + SOC + '(?![A-Za-zА-Яа-яЁё0-9_]).*$', 'i');      // «Telegram: …» до конца строки
  function cleanAuthor(a) {
    const t = String(a || '').replace(/\s+/g, ' ').trim().replace(RX_SOC_BOX, '').replace(RX_SOC_TAIL, '')
      .replace(/\s*(?:Используя|Using|При использовании|Please credit|Credit:).*$/i, '').replace(/[\s,;:–—(-]+$/, '').trim();
    return t.length > 60 ? t.slice(0, 57).replace(/\s+\S*$/, '') + '…' : t;
  }
  /* Ссылка на страницу файла — только https (данные приходят и из автоматического каталога) */
  const photoCredit = ph => {
    if (!ph) return '';
    const src = ph.src === 'Flickr' ? 'Flickr' : 'Wikimedia Commons';
    const who = esc(cleanAuthor(ph.a) || 'автор на ' + (src === 'Flickr' ? 'Flickr' : 'Commons'));
    return `Фото: ${/^https:\/\//i.test(ph.u || '') ? `<a href="${esc(ph.u)}" target="_blank" rel="noopener">${who}</a>` : who}${ph.l ? ', ' + esc(ph.l) : ''} · ${src}`;
  };
  function distM(a, b) {
    const R = 6371000, toR = x => x * Math.PI / 180;
    const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const walkMin = (a, b) => Math.max(1, Math.round(distM(a, b) * 1.3 / 75));
  const priceText = n => '₽'.repeat(Math.max(1, Math.min(3, n || 1)));
  /* Что значат ₽ — подсказка к значку цены (как в places.js) */
  const PRICE_HINT = ['', 'до ~1 500 ₽ на человека', '~1 500–3 000 ₽ на человека', 'от ~3 000 ₽ на человека'];
  const priceHint = n => PRICE_HINT[Math.max(1, Math.min(3, n || 1))];
  /* Подпись станции: «м. Арбатская»; у мест в Подмосковье, где метро далеко, — МЦД или электричка:
     «Переделкино (МЦД-4)», «Мытищи (ж/д)» → «ж/д Мытищи» */
  const isMetro = m => !!m && !/\((ж\/д|МЦД[^)]*)\)$/.test(m);
  const metroText = m => !m ? '' : /\(ж\/д\)$/.test(m) ? 'ж/д ' + m.replace(/\s*\(ж\/д\)$/, '') : isMetro(m) ? 'м. ' + m : m;
  /* Регион Яндекс Карт — по городу самого места (у приглашения своего «города интерфейса» нет) */
  const yaBase = c => { const y = CITIES[c].ya; return `https://yandex.ru/maps/${y.id}/${y.slug}/`; };
  const mapUrl = p => yaBase(cityOf(p)) + '?text=' + encodeURIComponent(p.name + ', ' + p.addr);
  /* Точка маршрута: адрес с номером дома — текстом (Яндекс находит тот же дом, что и ссылка на место),
     парки, набережные и адреса без номера — координатами */
  const MO_CITY = /^(Химки|Красногорск|Мытищи|Королёв|Балашиха|Люберцы|Реутов|Одинцово|Долгопрудный|Котельники|Видное|Лобня|Дзержинский|Лыткарино|Подольск|Щёлково|Пушкино|Ивантеевка|Фрязино|Домодедово|Жуковский|Раменское|Истра|Дмитров|Звенигород|Апрелевка|Наро-Фоминск|Сергиев Посад|Электросталь|Ногинск|Солнечногорск|Ступино|Чехов|Серпухов|Коломна|Клин|Голицыно|Нахабино|Мытищинский|Красногорский)(?=[,\s])/;
  function routePt(p) {
    const a = String(p.addr || '').replace(/\s*\([^)]*\)/g, '').trim();
    if (cityOf(p) === 'spb') {
      // пригороды пишем с городом в начале адреса («Пушкин, Садовая ул., 7») — им префикс Петербурга не мешает
      if (/\d/.test(a) && !/^(у|рядом|напротив)\s/i.test(a) && !/(^|, )Санкт-Петербург(,|$)/.test(a)) return encodeURIComponent('Санкт-Петербург, ' + a);
      return p.lat.toFixed(6) + ',' + p.lon.toFixed(6);
    }
    if (/\d/.test(a) && !/^(у|рядом|напротив)\s/i.test(a) && !/(^|, )Москва(,|$)/.test(a)) {
      // города области: иначе Яндекс найдёт одноимённую улицу в Москве (Комсомольский просп. в Люберцах и в Хамовниках)
      const city = /^Московская обл/.test(a) ? '' : MO_CITY.test(a) ? 'Московская область, ' : 'Москва, ';
      return encodeURIComponent(city + a);
    }
    return p.lat.toFixed(6) + ',' + p.lon.toFixed(6);
  }
  /* Маршрут: первая точка пустая — откуда ехать, человек укажет сам в Яндекс Картах,
     дальше — места плана по порядку. Общественный транспорт: короткие отрезки Яндекс сам проложит пешком */
  function routeUrl(stops) {
    return yaBase(cityOf(stops[0] || null)) + '?rtext=~' + stops.map(routePt).join('~') + '&rtt=mt';
  }

  /* ---------- Telegram-ник владельца и календарь ---------- */
  function tgUser(s) {
    const u = String(s || '').trim().replace(/^https?:\/\/(t|telegram)\.me\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
    return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(u) ? u : '';
  }
  const tgLink = (user, text) => 'https://t.me/' + user + (text ? '?text=' + encodeURIComponent(text) : '');
  /* ev: { title, day: 'YYYY-MM-DD', time?: 'HH:MM', minutes?, location?, details? }.
     Время — московское: UTC+3 без перехода на летнее время. */
  function calendarLinks(ev) {
    const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const [y, m, d] = ev.day.split('-').map(Number);
    let a, b, ia, ib;
    if (ev.time) {
      const t = toMin(ev.time), st = Date.UTC(y, m - 1, d, 0, t - 180);
      a = stamp(st); b = stamp(st + (ev.minutes || 180) * 60000);
      ia = 'DTSTART:' + a; ib = 'DTEND:' + b;
    } else {
      a = ev.day.replace(/-/g, ''); b = ymd(addDays(parseYmd(ev.day), 1)).replace(/-/g, '');
      ia = 'DTSTART;VALUE=DATE:' + a; ib = 'DTEND;VALUE=DATE:' + b;
    }
    const google = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(ev.title) +
      '&dates=' + a + '/' + b + (ev.location ? '&location=' + encodeURIComponent(ev.location) : '') +
      (ev.details ? '&details=' + encodeURIComponent(ev.details) : '') + '&ctz=Europe/Moscow';
    const esc1 = t => String(t || '').replace(/\\/g, '\\\\').replace(/[,;]/g, x => '\\' + x).replace(/\n/g, '\\n');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kuda idem//RU', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      'UID:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '@kuda-idem',
      'DTSTAMP:' + stamp(Date.now()), ia, ib, 'SUMMARY:' + esc1(ev.title)]
      .concat(ev.location ? ['LOCATION:' + esc1(ev.location)] : [], ev.details ? ['DESCRIPTION:' + esc1(ev.details)] : [],
        ['BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc1(ev.title), 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR']).join('\r\n');
    return { google, ics: URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' })) };
  }

  /* ---------- шторка: нижний лист поверх страницы ----------
     K.sheet(bg, box, opts) → { open(html, o) → { el, close }, close(then), isOpen() }
     ─ «Назад» в браузере и жест «назад» на телефоне закрывают шторку, а не уводят со страницы:
       при открытии — history.pushState, на popstate — закрыть;
     ─ кнопка × (aria-label «Закрыть»), Esc, нажатие на фон и жест «смахнуть вниз» тоже закрывают;
     ─ фокус уходит в шторку (на заголовок), Tab не выходит наружу, после закрытия фокус возвращается туда, откуда открыли.
     o.url — адрес открытой шторки в строке браузера (им можно поделиться), o.onClose(how) — вызов при закрытии
     ('close' | 'back') или когда содержимое заменили новым open ('replace'), o.label — подпись, если в html нет заголовка,
     o.adopt — не добавлять запись в историю, а занять текущую (она уже от шторки: «Вперёд» или перезагрузка с открытой карточкой).
     opts.onClose(how) — общий обработчик закрытия для страницы: вызывается, когда история уже вернулась назад.
     opts.onForward() — «Вперёд» (или «Назад») привёл на запись шторки, а шторка закрыта: страница может открыть её снова.
     Наши собственные шаги назад (закрытие крестиком, Esc, фоном) сюда не попадают.
     close(then): then вызовется тогда же — после этого можно прокручивать страницу и менять адрес
     (иначе браузер вернёт прокрутку, сохранённую в истории, а адрес достанется записи шторки). */
  function sheet(bg, box, opts) {
    opts = opts || {};
    const FOC = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
    // skip — сколько наших history.back() ещё не вернулись; pend — шторку открыли, пока история возвращалась:
    // её запись добавим, когда возврат закончится (иначе она встанет не на своё место и «Назад» уведёт со страницы)
    let open = false, pushed = false, skip = 0, pend = null, back = null, own = null, waits = [], waitT = 0, drag = null, outT = 0;
    const html = document.documentElement;
    const isOurs = st => !!(st && st.kudaSheet);
    function push(url) {
      try {
        if (url) history.pushState({ kudaSheet: 1 }, '', url);
        else history.pushState({ kudaSheet: 1 }, '');
        pushed = true;
      } catch (e) { pushed = false; }
    }
    function flush() {
      clearTimeout(waitT);
      waitT = 0;
      const w = waits;
      waits = [];
      w.forEach(f => { try { f(); } catch (e) { /* ок */ } });
    }
    const call = (f, how) => { if (f) try { f(how); } catch (e) { /* ок */ } };
    const unslide = () => { clearTimeout(outT); box.style.transition = ''; box.style.transform = ''; };
    function show(content, o) {
      o = o || {};
      const prev = own;
      own = typeof o.onClose === 'function' ? o.onClose : null;
      if (open) call(prev, 'replace');
      drag = null;
      unslide();
      box.innerHTML = `<div class="sheet-bar"><span class="grab" aria-hidden="true"></span><button type="button" class="sheet-x" data-sheet-close aria-label="Закрыть">${icon('x')}</button></div>` + content;
      if (!open) {
        back = document.activeElement;
        open = true;
        pushed = false;
        pend = null;
        // сначала запись в истории (браузер запомнит прокрутку страницы), потом блокировка прокрутки
        if (skip) pend = { url: o.url || '' };
        else if (o.adopt && isOurs(history.state)) {
          try { if (o.url) history.replaceState(history.state, '', o.url); pushed = true; } catch (e) { pushed = false; }
        } else push(o.url);
        html.classList.add('sheet-lock');
        document.body.classList.add('sheet-open');
        bg.classList.remove('hidden');
      } else if (o.url) {
        if (pend) pend.url = o.url;
        else if (pushed) { try { history.replaceState({ kudaSheet: 1 }, '', o.url); } catch (e) { /* ок */ } }
      }
      box.scrollTop = 0;
      const h = box.querySelector('h1, h2, h3');
      if (h) {
        if (!h.id) h.id = (box.id || 'sheet') + '-title';
        box.setAttribute('aria-labelledby', h.id);
        box.removeAttribute('aria-label');
      } else {
        box.removeAttribute('aria-labelledby');
        box.setAttribute('aria-label', o.label || 'Карточка');
      }
      if (o.focus !== false) {
        const f = h || box.querySelector('[data-sheet-close]');
        if (f === h && !h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
        try { f.focus({ preventScroll: true }); } catch (e) { /* ок */ }
      }
      return { el: box, close: hide };
    }
    function finish(how) {
      if (!open) return;
      open = false;
      drag = null;
      bg.classList.add('hidden');
      unslide();
      html.classList.remove('sheet-lock');
      document.body.classList.remove('sheet-open');
      const cb = own;
      own = null;
      call(cb, how);
      // обработчик страницы — первым из ожидающих: когда история вернулась (или сразу, если записи не было)
      if (opts.onClose) waits.unshift(() => opts.onClose(how));
      const b = back;
      back = null;
      if (b && b !== document.body && b.isConnected && typeof b.focus === 'function') { try { b.focus({ preventScroll: true }); } catch (e) { /* ок */ } }
    }
    // браузер восстанавливает прокрутку записи уже после popstate: ждущих зовём следующей задачей,
    // иначе их прокрутку (к местам, к подборке, к афише) он тут же перебьёт
    const later = () => { clearTimeout(waitT); waitT = setTimeout(flush, 0); };
    // наши шаги назад закончились: шторке, открытой за это время, — своя запись; потом ждущие
    function settle() {
      skip = 0;
      if (pend && open) push(pend.url);
      pend = null;
      later();
    }
    function hide(then) {
      if (typeof then === 'function') waits.push(then);
      // шторку уже закрыли, а история ещё возвращается назад — then дождётся её вместе с остальными
      if (!open) { if (!skip) flush(); return; }
      const viaHistory = pushed && isOurs(history.state);
      pushed = false;
      pend = null;
      finish('close');
      if (viaHistory) {
        skip++;
        history.back();
        // popstate почти всегда приходит раньше; это страховка (и счётчик не залипает — иначе пропустим настоящий «Назад»)
        clearTimeout(waitT);
        waitT = setTimeout(settle, 700);
      } else if (!skip) flush();
      // иначе история ещё возвращается после прошлой шторки — ждущие дождутся её (settle)
    }
    addEventListener('popstate', () => {
      if (skip) { if (--skip === 0) settle(); return; }
      if (open) { pushed = false; pend = null; finish('back'); later(); return; }
      if (isOurs(history.state) && typeof opts.onForward === 'function') { try { opts.onForward(); } catch (e) { /* ок */ } }
    });
    bg.addEventListener('click', e => { if (e.target === bg) hide(); });
    box.addEventListener('click', e => { if (e.target.closest('[data-sheet-close]')) hide(); });
    document.addEventListener('keydown', e => {
      if (!open || e.defaultPrevented) return;
      // поверх шторки открыт другой диалог (например, фото) — он сам разбирается с клавишами
      const top = e.target && e.target.closest ? e.target.closest('[aria-modal="true"]') : null;
      if (top && top !== box) return;
      if (e.key === 'Escape' && opts.esc !== false) { e.preventDefault(); hide(); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from(box.querySelectorAll(FOC)).filter(x => !x.closest('[hidden], .hidden') && x.getClientRects().length);
      if (!f.length) return;
      const a = document.activeElement, first = f[0], last = f[f.length - 1];
      if (!box.contains(a)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    });
    /* Смахнуть вниз: шторка прокручена к самому верху — тянем её пальцем; отпустили ниже порога или быстрым
       движением — закрываем, иначе она возвращается на место. Горизонтальные ленты и поля ввода не трогаем. */
    box.addEventListener('touchstart', e => {
      drag = null;
      if (!open || e.touches.length !== 1 || box.scrollTop > 0) return;
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      // палец во внутреннем списке, который прокручен вниз (станции метро и т. п.), — тянем список, а не шторку
      for (let n = e.target; n && n !== box && n.nodeType === 1; n = n.parentNode) if (n.scrollTop > 0) return;
      const t = e.touches[0];
      drag = { x: t.clientX, y: t.clientY, dy: 0, t: Date.now(), on: false };
    }, { passive: true });
    box.addEventListener('touchmove', e => {
      if (!drag) return;
      const t = e.touches[0], dx = t.clientX - drag.x, dy = t.clientY - drag.y;
      if (!drag.on) {
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        if (dy <= 0 || Math.abs(dx) > dy || box.scrollTop > 0) { drag = null; return; }   // вверх или вбок — обычная прокрутка
        drag.on = true;
        box.style.transition = 'none';
      }
      drag.dy = Math.max(0, dy);
      box.style.transform = 'translateY(' + drag.dy + 'px)';
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    const endDrag = () => {
      const d = drag;
      drag = null;
      if (!d || !d.on || !open) return;
      const fast = d.dy > 40 && d.dy / Math.max(1, Date.now() - d.t) > 0.6;
      box.style.transition = 'transform .2s ease';
      if (fast || d.dy > Math.min(150, box.offsetHeight * 0.3)) {
        box.style.transform = 'translateY(100%)';
        outT = setTimeout(() => hide(), 170);
      } else {
        box.style.transform = '';
        outT = setTimeout(() => { box.style.transition = ''; }, 220);
      }
    };
    box.addEventListener('touchend', endDrag);
    box.addEventListener('touchcancel', endDrag);
    return { open: show, close: hide, isOpen: () => open, el: box };
  }

  /* ---------- котик ---------- */
  const CATS = {
    line:   { fur: '#1A1920', belly: '#1A1920', line: '#F4F1EA', inner: 'var(--accent)', stripe: 'transparent', eye: '#F4F1EA', hi: '#0F0E13', sh: '#F4F1EA' },
    ginger: { fur: '#ffb35c', belly: '#fff0dc', line: '#6b3a22', inner: '#ff9db3', stripe: '#ef8a34', eye: '#3b2230' },
    grey:   { fur: '#b8bfd3', belly: '#f4f5fb', line: '#434862', inner: '#ffadc1', stripe: '#959cb4', eye: '#2d2f45' },
    white:  { fur: '#fffaf4', belly: '#ffffff', line: '#6e5560', inner: '#ffb3c6', stripe: 'transparent', eye: '#3b2a33' },
    black:  { fur: '#433d52', belly: '#5d566e', line: '#1f1b28', inner: '#ff9db3', stripe: 'transparent', eye: '#ffd85e' },
  };
  function catVars(name) {
    const c = CATS[name] || CATS.ginger;
    return `--fur:${c.fur};--belly:${c.belly};--line:${c.line};--inner:${c.inner};--stripe:${c.stripe};--eye:${c.eye};--hi:${c.hi || '#fff'};--sh:${c.sh || '#1c1b29'}`;
  }
  /* Линейные иконки интерфейса (24×24, цвет — currentColor) */
  const ICONS = {
    heart: '<path d="M12 20s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 10c0 5.65-7 10-7 10z"/>',
    mug: '<path d="M6 5h10v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M16 9h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2"/><path d="M6 9h10"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 3v4"/><path d="M17 5h4"/>',
    pin: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
    arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
    ext: '<path d="M7 17L17 7"/><path d="M8 7h9v9"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16"/>',
    sound: '<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
    mute: '<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M22 9l-6 6"/><path d="M16 9l6 6"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    x: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.7A8 8 0 1 1 21 12z"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
    wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 3v7"/><path d="M12 14v7"/><path d="M3 12h7"/><path d="M14 12h7"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
    redo: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9"/><path d="M20 4v5h-5"/>',
    share: '<path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
    food: '<path d="M7 3v7a2 2 0 0 0 2 2v9"/><path d="M5 3v5"/><path d="M9 3v5"/><path d="M17 21V3c-2 1.5-3 4.5-3 7.5S15 15 17 15"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="15" r="1.3" fill="currentColor" stroke="none"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    send: '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    bookmark: '<path d="M6 3h12v18l-6-4.5L6 21z"/>',
    gift: '<rect x="3" y="8" width="18" height="5" rx="1.5"/><path d="M5 13v7h14v-7"/><path d="M12 8v12"/><path d="M12 8C10.5 4.5 7 4.5 7 6.5S10 8 12 8z"/><path d="M12 8c1.5-3.5 5-3.5 5-1.5S14 8 12 8z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14"/><path d="M15 6v14"/>',
    locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
    photo: '<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="12" cy="12" r="3.5"/><path d="M8 5l1.5-2h5L16 5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M21 20a6 6 0 0 0-4-5.6"/>',
    inbox: '<path d="M3 13l2.6-7.2A2 2 0 0 1 7.5 4.5h9a2 2 0 0 1 1.9 1.3L21 13"/><path d="M3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5h-5l-1.5 2.5h-5L8 13z"/>',
    wallet: '<path d="M4 7.5V7a3 3 0 0 1 3-3h10"/><rect x="3" y="7.5" width="18" height="12.5" rx="3"/><path d="M16 13.75h2"/>',
    bolt: '<path d="M13 2.5L4.5 13.5H11l-1 8 8.5-11H12z"/>',
  };
  const icon = (name, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  const MODE_ICON = { date: 'heart', guys: 'mug', girls: 'sparkle' };

  /* Значок режима: у пацанов вместо сердечек — звезда */
  const STAR_D = 'M12 2.4l2.95 6.2 6.8.85-5 4.7 1.3 6.75L12 17.6l-6.05 3.3 1.3-6.75-5-4.7 6.8-.85z';
  const markD = mode => (mode === 'guys' ? STAR_D : HEART_D);
  const HEART_D = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

  function catSVG(mood, extra) {
    return `<svg class="cat ${extra || ''}" data-mood="${mood || 'normal'}" viewBox="0 0 200 200" aria-hidden="true">
  <g class="cat-bob">
    <g class="cat-tail">
      <path d="M138 176 C176 176 190 140 176 112" fill="none" stroke="var(--line)" stroke-width="19" stroke-linecap="round"/>
      <path d="M138 176 C176 176 190 140 176 112" fill="none" stroke="var(--fur)" stroke-width="11" stroke-linecap="round"/>
    </g>
    <ellipse cx="100" cy="158" rx="48" ry="34" fill="var(--fur)" stroke="var(--line)" stroke-width="4"/>
    <ellipse cx="100" cy="164" rx="27" ry="21" fill="var(--belly)"/>
    <ellipse cx="80" cy="189" rx="13" ry="8.5" fill="var(--fur)" stroke="var(--line)" stroke-width="4"/>
    <ellipse cx="120" cy="189" rx="13" ry="8.5" fill="var(--fur)" stroke="var(--line)" stroke-width="4"/>
    <g class="cat-wave"><ellipse cx="172" cy="122" rx="12" ry="14" fill="var(--fur)" stroke="var(--line)" stroke-width="4"/>
      <path d="M166 116 v5 M172 114 v6 M178 116 v5" stroke="var(--line)" stroke-width="2.5" stroke-linecap="round"/></g>
    <g class="cat-head">
      <g class="ear ear-l"><path d="M46 68 L50 18 L92 44 Z" fill="var(--fur)" stroke="var(--line)" stroke-width="4" stroke-linejoin="round"/>
        <path d="M57 56 L59 32 L80 46 Z" fill="var(--inner)"/></g>
      <g class="ear ear-r"><path d="M154 68 L150 18 L108 44 Z" fill="var(--fur)" stroke="var(--line)" stroke-width="4" stroke-linejoin="round"/>
        <path d="M143 56 L141 32 L120 46 Z" fill="var(--inner)"/></g>
      <ellipse cx="100" cy="92" rx="64" ry="54" fill="var(--fur)" stroke="var(--line)" stroke-width="4"/>
      <g stroke="var(--stripe)" stroke-width="4.5" stroke-linecap="round"><path d="M100 41 v12"/><path d="M87 44 l3 10"/><path d="M113 44 l-3 10"/></g>
      <ellipse cx="60" cy="112" rx="12" ry="7.5" fill="var(--inner)" opacity=".7"/>
      <ellipse cx="140" cy="112" rx="12" ry="7.5" fill="var(--inner)" opacity=".7"/>
      <g class="m m-normal eyes-blink">
        <ellipse cx="76" cy="92" rx="7.5" ry="9.5" fill="var(--eye)"/><ellipse cx="124" cy="92" rx="7.5" ry="9.5" fill="var(--eye)"/>
        <circle cx="79" cy="88" r="3" fill="var(--hi, #fff)"/><circle cx="127" cy="88" r="3" fill="var(--hi, #fff)"/>
      </g>
      <g class="m m-wow">
        <circle cx="76" cy="91" r="12" fill="var(--eye)"/><circle cx="124" cy="91" r="12" fill="var(--eye)"/>
        <circle cx="80" cy="86" r="4.5" fill="var(--hi, #fff)"/><circle cx="128" cy="86" r="4.5" fill="var(--hi, #fff)"/>
        <circle cx="72" cy="96" r="2" fill="var(--hi, #fff)"/><circle cx="120" cy="96" r="2" fill="var(--hi, #fff)"/>
      </g>
      <g class="m m-happy" fill="none" stroke="var(--line)" stroke-width="4.5" stroke-linecap="round">
        <path d="M67 95 Q76 82 85 95"/><path d="M115 95 Q124 82 133 95"/>
      </g>
      <g class="m m-love">
        <g transform="translate(63 79) scale(1.1)"><path class="love-eye" d="${HEART_D}" fill="#ff4d7e" stroke="var(--line)" stroke-width="1.6"/></g>
        <g transform="translate(111 79) scale(1.1)"><path class="love-eye" d="${HEART_D}" fill="#ff4d7e" stroke="var(--line)" stroke-width="1.6"/></g>
      </g>
      <g class="m m-sad">
        <ellipse cx="76" cy="95" rx="7" ry="8" fill="var(--eye)"/><ellipse cx="124" cy="95" rx="7" ry="8" fill="var(--eye)"/>
        <circle cx="78" cy="92" r="2.5" fill="var(--hi, #fff)"/><circle cx="126" cy="92" r="2.5" fill="var(--hi, #fff)"/>
        <path d="M64 80 L84 85 M136 80 L116 85" stroke="var(--line)" stroke-width="4" stroke-linecap="round"/>
        <path class="tear" d="M70 106 q-4 7 0 10 q4 -3 0 -10z" fill="#7cc7ff"/>
      </g>
      <path d="M95 103 h10 l-5 6 z" fill="var(--inner)" stroke="var(--line)" stroke-width="2.5" stroke-linejoin="round"/>
      <path class="m m-normal m-wow-no" d="M90 112 q5 6 10 0 q5 6 10 0" fill="none" stroke="var(--line)" stroke-width="3.2" stroke-linecap="round"/>
      <g class="m m-happy m-love"><path d="M88 111 Q100 130 112 111 Z" fill="#b83a52" stroke="var(--line)" stroke-width="3" stroke-linejoin="round"/>
        <path d="M94 120 Q100 116 106 120 Q100 127 94 120Z" fill="#ff8fa6"/></g>
      <path class="m m-sad" d="M91 119 Q100 111 109 119" fill="none" stroke="var(--line)" stroke-width="3.2" stroke-linecap="round"/>
      <ellipse class="m m-wow" cx="100" cy="117" rx="5" ry="6" fill="#b83a52" stroke="var(--line)" stroke-width="2.5"/>
      <g stroke="var(--line)" stroke-width="2.4" stroke-linecap="round" opacity=".75">
        <path d="M30 100 l20 3"/><path d="M31 112 l19 -2"/><path d="M170 100 l-20 3"/><path d="M169 112 l-19 -2"/>
      </g>
      <g class="acc acc-shades">
        <path d="M56 82 h40 v9 q0 13 -14 13 h-12 q-14 0 -14 -13z" fill="#1c1b29" stroke="var(--sh, #1c1b29)" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M104 82 h40 v9 q0 13 -14 13 h-12 q-14 0 -14 -13z" fill="#1c1b29" stroke="var(--sh, #1c1b29)" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M96 86 h8" stroke="var(--sh, #1c1b29)" stroke-width="4"/>
        <path d="M63 87 l9 0 M111 87 l9 0" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".55"/>
      </g>
      <g class="acc acc-bow" transform="translate(140 38) rotate(18)">
        <path d="M0 0 L-19 -12 Q-25 0 -19 12 Z" fill="#ff5c9a" stroke="var(--line)" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M0 0 L19 -12 Q25 0 19 12 Z" fill="#ff5c9a" stroke="var(--line)" stroke-width="2.5" stroke-linejoin="round"/>
        <circle r="5.5" fill="#ff8fbf" stroke="var(--line)" stroke-width="2.5"/>
      </g>
    </g>
  </g>
</svg>`;
  }

  window.DateKit = {
    BASE, merge, defaults, diffInvite, encodeInvite, decodeInvite, encodeData, decodeData, readHash, esc, fill, hash,
    ymd, parseYmd, addDays, listDates, fmtDay, dayNum, numDay, toMin, fromMin, relaySend, relayRegister, relayTest, shortLink, goRoute, sitePath, toB64url,
    CATS, catVars, catSVG, HEART_D, STAR_D, markD, ICONS, icon, MODE_ICON, tgUser, tgLink, calendarLinks,
    MODES, modeOf, kuda, placeById, planById, planStops, catOf, photo, planPhoto, photoCredit, cleanAuthor, HINTS, placeHints, planHints, hintChip, seasonHints,
    todayMsk, seasonNow, seasonOk, eventById, events, eventDays, sheet,
    distM, walkMin, priceText, priceHint, isMetro, metroText, mapUrl, routeUrl,
    CITIES, city, setCity, cityOf, cityConf, inCity, cityByPoint,
    THEMES: ['pink', 'lavender', 'peach', 'mint', 'sport'],
  };
})();

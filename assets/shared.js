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
  function merge(base, over) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    if (!isObj(over)) return out;
    for (const k of Object.keys(over)) {
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
    'start:x days:y skipWeekdays:z list:A from:B to:C step:D def:E hearts:F letter:G place:H date:I opts:J plan:K tg:L tgu:M').split(' ').map(x => x.split(':'));
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
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
    try {
      const r = await fetch(url, { method: 'POST', body: JSON.stringify(body) });
      const j = await r.json();
      return j && typeof j === 'object' ? j : { ok: false };
    } catch (e) {
      return { ok: false, error: 'net' };
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
     1) свой сокращатель в посреднике (config.js → telegram.relayUrl, action 'short'): ссылка вида …/go.html#s=Ab3;
     2) clck.ru (сокращатель Яндекса), если он отвечает браузеру;
     3) если ничего не вышло — исходная ссылка. Результат запоминается на время сессии. */
  const SHORT_CACHE = 'kuda-short';
  const sitePath = file => new URL(file, location.href).href.split('#')[0].split('?')[0];
  function withTimeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); }
  async function shortLink(url) {
    if (!url || url.length < 60) return url;
    let cache = {};
    try { cache = JSON.parse(sessionStorage.getItem(SHORT_CACHE) || '{}'); } catch (e) { /* ок */ }
    if (cache[url]) return cache[url];
    const cfg = (window.DATE_CONFIG || {}).telegram || {};
    const tries = [];
    if (cfg.relayUrl) tries.push(async () => {
      const r = await fetch(cfg.relayUrl, { method: 'POST', body: JSON.stringify({ action: 'short', url }) });
      const j = await r.json();
      if (!j.ok || !/^[A-Za-z0-9_-]{1,16}$/.test(j.id || '')) throw new Error('relay');
      return sitePath('go.html') + '#s=' + j.id;
    });
    tries.push(async () => {
      const r = await fetch('https://clck.ru/--?url=' + encodeURIComponent(url));
      const t = (await r.text()).trim();
      if (!/^https:\/\/clck\.ru\/[A-Za-z0-9_-]+$/.test(t)) throw new Error('clck');
      return t;
    });
    for (const f of tries) {
      try {
        const short = await withTimeout(f(), 3500);
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
  const modeOf = inv => (MODES[inv && inv.mode] ? inv.mode : 'date');

  const kuda = () => window.KUDA || { places: {}, scenarios: [], adult: [] };
  const placeById = id => kuda().places[id] || null;
  /* Готовый план из подборки или «план» из одного места каталога: p-<id места> */
  const planById = id => {
    const s = kuda().scenarios.find(x => x.id === id);
    if (s) return s;
    const p = typeof id === 'string' && id.startsWith('p-') ? kuda().places[id.slice(2)] : null;
    return p && !p.adult ? { id, mode: '', emoji: p.emoji, title: p.name, stops: [id.slice(2)], when: '', why: p.note, single: true } : null;
  };
  const planStops = plan => (plan ? plan.stops.map(placeById).filter(Boolean) : []);
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
    first: ['💘', 'Для первого свидания', 'Первое свидание'],
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
  const HINT_CACHE = new WeakMap();
  function placeHints(p) {
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
    per.forEach(a => a.forEach(x => { if (['halloween', 'michelin', 'view', 'autumn', 'first', 'scenic', 'company'].includes(x)) h.add(x); }));
    if (per.every(a => a.includes('rain'))) h.add('rain');
    const top = Math.max(...st.map(p => p.price || 1));
    if (top <= 1) h.add('budget');
    if (plan.mode && plan.mode !== 'date') h.delete('first');
    return HINT_ORDER.filter(k => h.has(k));
  }
  /* Сезонные подсказки, которые поднимаем наверх: осень — сентябрь–ноябрь, Хэллоуин — до 1 ноября */
  function seasonHints(d) {
    d = d || new Date();
    const m = d.getMonth() + 1, out = [];
    if (m >= 9 && m <= 11) out.push('autumn');
    if (m === 10 || (m === 11 && d.getDate() === 1)) out.push('halloween');
    return out;
  }
  /* form: 'icon' — только эмодзи, 'short' — короткая подпись, по умолчанию — полная */
  const hintChip = (k, form) => HINTS[k] ? `<span class="hchip h-${k}" title="${HINTS[k][1]}">${HINTS[k][0]}${form === 'icon' ? '' : ' ' + HINTS[k][form === 'short' ? 2 : 1]}</span>` : '';

  /* ---------- пост о месте в Telegram-канале (поле tg: 'канал/номер') ----------
     Фото из постов не копируем к себе: показываем сам пост официальным встраиванием Telegram
     по нажатию. В России Telegram открывается только через VPN — тогда остаётся ссылка. */
  const TG_CH = {
    localshere: 'ЛОКАЛС', takayamoskva: 'такая Москва', shozhu_msk: 'Схожу, пожалуй', mcktime: 'календарь: афиша Москвы',
    poidem_moscow: 'ПОЙДЕМ! МОСКВА', idemmsk: 'Идем Москва', vmestemoscow: 'Вместе по Москве', smotri_msk: 'Ешь, гуляй, смотри в Москве',
  };
  const tgOk = post => /^[A-Za-z0-9_]{4,40}\/\d{1,7}$/.test(post || '');
  const tgUrl = post => 'https://t.me/' + post;
  const tgName = post => TG_CH[String(post).split('/')[0]] || String(post).split('/')[0];
  function tgEmbed(box, post) {
    if (!box || !tgOk(post) || box._tg) return;
    box._tg = true;
    const f = document.createElement('iframe');
    f.src = tgUrl(post) + '?embed=1&dark=1&userpic=false';
    f.title = 'Пост в Telegram-канале «' + tgName(post) + '»';
    f.loading = 'lazy';
    f.referrerPolicy = 'no-referrer';
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    f.style.cssText = 'width:100%;min-width:0;height:420px;border:0;border-radius:14px;display:block;background:transparent';
    let ready = false;
    const say = (ev, data) => { try { f.contentWindow.postMessage(JSON.stringify(Object.assign({ event: ev }, data || {})), 'https://t.me'); } catch (e) { /* ок */ } };
    const onMsg = e => {
      if (e.source !== f.contentWindow || e.origin !== 'https://t.me') return;
      let d = {};
      try { d = JSON.parse(e.data); } catch (err) { /* не наш формат */ }
      if (d.event === 'resize' && d.height) f.style.height = d.height + 'px';
      if (d.event === 'ready') { ready = true; say('visible', { frame: 'tg-' + post.replace(/\W/g, '-') }); say('focus', { has_focus: true }); }
    };
    window.addEventListener('message', onMsg);
    box.innerHTML = '';
    box.appendChild(f);
    setTimeout(() => {
      if (ready || !f.isConnected) return;
      window.removeEventListener('message', onMsg);
      box.innerHTML = `<p class="tg-fail">Telegram не открылся — в России он работает только через VPN. <a href="${tgUrl(post)}" target="_blank" rel="noopener">Открыть пост в Telegram</a></p>`;
    }, 9000);
  }

  /* Фото места из assets/photos.js (Wikimedia Commons): { s: большое, t: превью, a: автор, l: лицензия, u: страница файла } */
  const photo = p => (p && p.ph) || null;
  const planPhoto = plan => planStops(plan).map(photo).find(Boolean) || null;
  const photoCredit = ph => ph ? `Фото: <a href="${esc(ph.u)}" target="_blank" rel="noopener">${esc(ph.a)}</a>, ${esc(ph.l)} · Wikimedia Commons` : '';
  function distM(a, b) {
    const R = 6371000, toR = x => x * Math.PI / 180;
    const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const walkMin = (a, b) => Math.max(1, Math.round(distM(a, b) * 1.3 / 75));
  const priceText = n => '₽'.repeat(Math.max(1, Math.min(3, n || 1)));
  /* Подпись станции: «м. Арбатская»; у мест в Подмосковье, где метро далеко, — МЦД или электричка:
     «Переделкино (МЦД-4)», «Мытищи (ж/д)» → «ж/д Мытищи» */
  const isMetro = m => !!m && !/\((ж\/д|МЦД[^)]*)\)$/.test(m);
  const metroText = m => !m ? '' : /\(ж\/д\)$/.test(m) ? 'ж/д ' + m.replace(/\s*\(ж\/д\)$/, '') : isMetro(m) ? 'м. ' + m : m;
  const mapUrl = p => 'https://yandex.ru/maps/213/moscow/?text=' + encodeURIComponent(p.name + ', ' + p.addr);
  /* Точка маршрута: адрес с номером дома — текстом (Яндекс находит тот же дом, что и ссылка на место),
     парки, набережные и адреса без номера — координатами */
  function routePt(p) {
    const a = String(p.addr || '').replace(/\s*\([^)]*\)/g, '').trim();
    if (/\d/.test(a) && !/^(у|рядом|напротив)\s/i.test(a) && !/(^|, )Москва(,|$)/.test(a)) {
      const city = /^(Химки|Красногорск|Мытищи|Королёв|Балашиха),/.test(a) ? 'Московская область, ' : 'Москва, ';
      return encodeURIComponent(city + a);
    }
    return p.lat.toFixed(6) + ',' + p.lon.toFixed(6);
  }
  /* Маршрут: первая точка пустая — откуда ехать, человек укажет сам в Яндекс Картах,
     дальше — места плана по порядку. Общественный транспорт: короткие отрезки Яндекс сам проложит пешком */
  function routeUrl(stops) {
    return 'https://yandex.ru/maps/213/moscow/?rtext=~' + stops.map(routePt).join('~') + '&rtt=mt';
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
    MODES, modeOf, kuda, placeById, planById, planStops, catOf, photo, planPhoto, photoCredit, HINTS, placeHints, planHints, hintChip, seasonHints, tgOk, tgUrl, tgName, tgEmbed, distM, walkMin, priceText, isMetro, metroText, mapUrl, routeUrl,
    THEMES: ['pink', 'lavender', 'peach', 'mint', 'sport'],
  };
})();

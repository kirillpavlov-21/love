/* Клиент своего бэкенда (папка server/): живые голоса компании, ответы на приглашения,
   «Мои приглашения», отзывы и рейтинги, короткие ссылки, сообщения об ошибках в каталоге.
   Адрес — config.js → api.url. Пусто — KudaAPI.on = false: сети нет, все вызовы сразу отдают null,
   сайт работает как раньше (голоса живут в ссылках).
   Каждый вызов: таймаут 4 с (рейтинги — 6 с), при любой ошибке — null, исключений наружу нет.
   Код последней ошибки — KudaAPI.lastError ('off', 'net', 'timeout', 'rate', 'dup', 'owner', 'full', 'taken', …). */
(function () {
  'use strict';

  const CFG = (window.DATE_CONFIG && window.DATE_CONFIG.api) || {};
  const BASE = typeof CFG.url === 'string' ? CFG.url.trim() : '';
  const on = /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(BASE + '/');
  const TIMEOUT = 4000, RATINGS_TIMEOUT = 6000;
  const RATINGS_KEY = 'kuda-ratings', RATINGS_TTL = 10 * 60e3;

  const store = kind => ({
    get(k) { try { return window[kind].getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window[kind].setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { window[kind].removeItem(k); } catch (e) { /* ок */ } },
  });
  const ls = store('localStorage'), ss = store('sessionStorage');
  const readJson = (st, k, d) => { try { const v = JSON.parse(st.get(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };

  /* ---------- байты, base64url, SHA-256 ---------- */
  function b64url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function utf8(str) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(str);
    const s = unescape(encodeURIComponent(str));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function randomBytes(n) {
    const b = new Uint8Array(n);
    const c = window.crypto || window.msCrypto;
    if (c && c.getRandomValues) c.getRandomValues(b);
    else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
    return b;
  }
  const rand = n => b64url(randomBytes(n));

  /* Запасной SHA-256 для страниц без crypto.subtle (http, старые встроенные браузеры) */
  function sha256js(bytes) {
    const K = [], H = [];
    for (let n = 2, c = 0; c < 64; n++) {
      let prime = true;
      for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
      if (!prime) continue;
      if (c < 8) H[c] = (Math.pow(n, 1 / 2) * 4294967296) | 0;
      K[c++] = (Math.pow(n, 1 / 3) * 4294967296) | 0;
    }
    const len = bytes.length, total = ((len + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(total);
    m.set(bytes);
    m[len] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(total - 4, (len * 8) >>> 0);
    dv.setUint32(total - 8, Math.floor((len * 8) / 4294967296));
    const W = new Int32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getInt32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const x = W[i - 15], y = W[i - 2];
        const s0 = (x >>> 7 | x << 25) ^ (x >>> 18 | x << 14) ^ (x >>> 3);
        const s1 = (y >>> 17 | y << 15) ^ (y >>> 19 | y << 13) ^ (y >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
        const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    const out = new Uint8Array(32), ov = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) ov.setInt32(i * 4, H[i]);
    return out;
  }
  async function sha256(str) {
    const data = utf8(str);
    const c = window.crypto;
    if (c && c.subtle && c.subtle.digest) {
      try { return new Uint8Array(await c.subtle.digest('SHA-256', data)); } catch (e) { /* ниже — запасной вариант */ }
    }
    return sha256js(data);
  }
  const digest = (prefix, s) => sha256(prefix + s).then(b => b64url(b).slice(0, 22));

  /* ---------- ключи и устройство ---------- */
  const keyCache = new Map();
  /* Ключ приглашения: сервер видит только хэш кода из ссылки, сам код — нет */
  function key(code) {
    code = String(code || '');
    if (!keyCache.has(code)) keyCache.set(code, digest('kuda-votes|', code));
    return keyCache.get(code);
  }
  const ownerKey = secret => digest('kuda-owner|', String(secret || ''));
  let DEV = '';
  /* Случайный id этого браузера: один отзыв на место, «открыли» без повторов */
  function dev() {
    if (DEV) return DEV;
    let v = ls.get('kuda-dev');
    if (!v || !/^[A-Za-z0-9_-]{16,64}$/.test(v)) { v = rand(16); ls.set('kuda-dev', v); }
    return (DEV = v);
  }
  let VSEC = '';
  /* Секрет голосующего: без него чужой не перезапишет твой голос (сервер хранит только хэш) */
  function voteSecret() {
    if (VSEC) return VSEC;
    let v = ls.get('kuda-vsec');
    if (!v || !/^[A-Za-z0-9_-]{22,64}$/.test(v)) { v = rand(24); ls.set('kuda-vsec', v); }
    return (VSEC = v);
  }

  /* ---------- запрос ---------- */
  async function call(params, body, ms) {
    if (!on) { api.lastError = 'off'; return null; }
    let url = BASE;
    const init = { credentials: 'omit' };
    if (params) {
      url += (BASE.indexOf('?') >= 0 ? '&' : '?') + new URLSearchParams(params).toString();
      init.method = 'GET';
    } else {
      init.method = 'POST';
      init.body = JSON.stringify(body);   // text/plain — без preflight
    }
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    if (ctl) init.signal = ctl.signal;
    let timer = 0, timedOut = false;
    const limit = new Promise((_, reject) => {
      timer = setTimeout(() => { timedOut = true; if (ctl) ctl.abort(); reject(new Error('timeout')); }, ms || TIMEOUT);
    });
    try {
      const j = await Promise.race([fetch(url, init).then(r => r.json()), limit]);
      if (!j || typeof j !== 'object') { api.lastError = 'bad'; return null; }
      if (j.ok !== true) { api.lastError = typeof j.error === 'string' ? j.error : 'http'; return null; }
      api.lastError = '';
      return j;
    } catch (e) {
      api.lastError = timedOut ? 'timeout' : 'net';
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  /* Сервер выключен или вызвали без нужных аргументов — сеть не трогаем */
  function fail() { api.lastError = on ? 'args' : 'off'; return null; }
  /* Обёртка: никаких исключений наружу */
  const safe = fn => async function () {
    try { return await fn.apply(null, arguments); } catch (e) { api.lastError = 'client'; return null; }
  };
  const pickVoter = v => {
    const o = { id: String(v.id || ''), n: String(v.n == null ? '' : v.n), y: v.y ? 1 : 0, o: Array.isArray(v.o) ? v.o : [], d: Array.isArray(v.d) ? v.d : [], t: +v.t || 0 };
    // компания: слоты времени, дни «может быть», «со мной ещё +N» — только если есть (старый сервер их не ждёт)
    if (Array.isArray(v.s) && v.s.length) o.s = v.s;
    if (Array.isArray(v.m) && v.m.length) o.m = v.m;
    if (v.p > 0) o.p = v.p;
    return o;
  };
  /* spins — итоги колеса по наборам лидеров {'0,2': {i, d, t, L}} (сервер с L); у старого сервера — {} */
  const spinsOut = j => (j.spins && typeof j.spins === 'object' && !Array.isArray(j.spins) ? j.spins : {});
  const votesOut = j => ({ votes: Array.isArray(j.votes) ? j.votes : [], rev: j.rev | 0, spin: j.spin || null, spins: spinsOut(j), until: Number.isInteger(j.until) ? j.until : null });

  /* ---------- голоса компании ---------- */
  /* voter: {id, n, y, o:[индексы вариантов], d:[номера дней]}; seed — голоса из старой ссылки (&v=) */
  const vote = safe(async (code, voter, secret, seed) => {
    if (!on || !code || !voter) return fail();
    const body = { action: 'vote', key: await key(code), voter: pickVoter(voter), secret: secret || voteSecret() };
    if (Array.isArray(seed) && seed.length) body.seed = seed.slice(0, 60).map(pickVoter);
    const j = await call(null, body);
    return j && votesOut(j);
  });
  /* rev — последняя известная версия: если ничего не поменялось, вернётся {same: true} */
  const votes = safe(async (code, rev) => {
    if (!on || !code) return fail();
    const p = { votes: await key(code) };
    if (Number.isInteger(rev) && rev >= 0) p.rev = rev;
    const j = await call(p);
    return j && (j.same ? { same: true, rev } : votesOut(j));
  });
  /* Живое обновление итогов: cb({votes, rev, spin, spins}) при каждом изменении.
     Пока вкладка скрыта — пауза; без изменений интервал растёт 15 → 60 с; 30 минут тишины — ждём возвращения на вкладку.
     opts: {interval: 15000, max: 60000, rev — уже известная версия (тогда первый запрос — через interval)}. Возвращает stop(). */
  function poll(code, cb, opts) {
    opts = opts || {};
    const base = Math.max(5000, opts.interval || 15000), max = Math.max(base, opts.max || 60000), idle = opts.idle || 30 * 60e3;
    const doc = typeof document !== 'undefined' ? document : null;
    const hidden = () => !!(doc && doc.hidden);
    let rev = Number.isInteger(opts.rev) ? opts.rev : -1, wait = base, timer = 0, stopped = !on || !code, busy = false, lastChange = Date.now();
    const schedule = ms => { clearTimeout(timer); timer = 0; if (!stopped && !hidden()) timer = setTimeout(tick, ms); };
    async function tick() {
      timer = 0;
      if (stopped || hidden() || busy || Date.now() - lastChange > idle) return;
      busy = true;
      const r = await votes(code, rev >= 0 ? rev : undefined);
      busy = false;
      if (stopped) return;
      if (r && !r.same) {
        rev = r.rev; wait = base; lastChange = Date.now();
        try { cb(r); } catch (e) { setTimeout(() => { throw e; }); }
      } else {
        wait = Math.min(max, Math.round(wait * 1.5));
      }
      schedule(wait);
    }
    function onVisible() {
      if (hidden()) { clearTimeout(timer); timer = 0; return; }
      wait = base; lastChange = Date.now();
      schedule(0);
    }
    if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', onVisible);
    schedule(rev >= 0 ? wait : 0);
    return function stop() {
      stopped = true;
      clearTimeout(timer);
      if (doc && doc.removeEventListener) doc.removeEventListener('visibilitychange', onVisible);
    };
  }
  /* Итог колеса при ничьей: result — индекс варианта или {i, d, L} (L — лидеры ничьей «0,2» по возрастанию).
     Для каждого L первый результат остаётся у всех; без L — один итог на приглашение (старые клиенты) */
  const spin = safe(async (code, result) => {
    if (!on || !code) return fail();
    const j = await call(null, { action: 'spin', key: await key(code), result });
    return j && { spin: j.spin || null, spins: spinsOut(j), rev: j.rev | 0 };
  });

  /* ---------- приглашения ---------- */
  /* meta: {mode: 'date'|'guys'|'girls', title, until? (дедлайн, минуты эпохи), ref? (8 знаков хэша приглашения, по которому позвали), city?} */
  const invite = safe(async (code, ownerSecret, meta) => {
    if (!on || !code || !ownerSecret) return fail();
    meta = meta || {};
    const body = { action: 'invite', key: await key(code), owner: await ownerKey(ownerSecret), mode: meta.mode || 'date', title: String(meta.title || '').slice(0, 80) };
    if (Number.isInteger(meta.until) && meta.until > 0) body.until = meta.until;
    if (/^[a-z0-9]{8}$/.test(meta.ref || '')) body.ref = meta.ref;
    if (meta.city === 'msk' || meta.city === 'spb') body.city = meta.city;
    const j = await call(null, body);
    return j ? true : null;
  });
  /* «Закрыть сейчас»: только создатель приглашения (его секрет); ответ — {until, rev} */
  const closeVote = safe(async (code, ownerSecret) => {
    if (!on || !code || !ownerSecret) return fail();
    const j = await call(null, { action: 'close', key: await key(code), ownerSecret });
    return j && { until: Number.isInteger(j.until) ? j.until : null, rev: j.rev | 0 };
  });
  /* «Приглашение открыли» — один раз с устройства */
  const opened = safe(async code => {
    if (!on || !code) return fail();
    const k = await key(code);
    const seen = readJson(ls, 'kuda-opened', []);
    if (Array.isArray(seen) && seen.indexOf(k) >= 0) return true;
    const j = await call(null, { action: 'opened', key: k, dev: dev() });
    if (!j) return null;
    ls.set('kuda-opened', JSON.stringify((Array.isArray(seen) ? seen : []).concat(k).slice(-200)));
    return true;
  });
  /* Ответ на свидание: {yes, place, placeText, date, dateOther, time, food, note, event} — последний ответ заменяет прежний */
  const answer = safe(async (code, ans) => {
    if (!on || !code || !ans) return fail();
    const j = await call(null, { action: 'answer', key: await key(code), answer: ans });
    return j ? true : null;
  });
  /* «Мои приглашения»: {код: {mode, title, opened, firstOpen, votes, answer, updated}} — только свои (по секрету создателя) */
  const mine = safe(async (ownerSecret, codes) => {
    if (!on || !ownerSecret || !Array.isArray(codes)) return fail();
    const list = Array.from(new Set(codes.filter(Boolean).map(String))).slice(-50);
    const keys = await Promise.all(list.map(key));
    if (!keys.length) return {};
    const j = await call(null, { action: 'mine', ownerSecret: String(ownerSecret), keys });
    if (!j) return null;
    const out = {};
    keys.forEach((k, i) => { if (j.items && j.items[k]) out[list[i]] = j.items[k]; });
    return out;
  });

  /* ---------- отзывы и рейтинги ---------- */
  let ratingsBusy = null;
  /* {placeId: [средняя, сколько, для свидания|null, для компании|null, сколько «для свидания», сколько «для компании»]};
     кэш на 10 минут в sessionStorage */
  const ratings = safe(async () => {
    const cached = readJson(ss, RATINGS_KEY, null);
    if (cached && cached.r && Date.now() - cached.at < RATINGS_TTL) return cached.r;
    if (!on) return fail();
    if (!ratingsBusy) {
      ratingsBusy = call({ ratings: 1 }, null, RATINGS_TIMEOUT).then(j => {
        ratingsBusy = null;
        if (j && j.r && typeof j.r === 'object') { ss.set(RATINGS_KEY, JSON.stringify({ at: Date.now(), r: j.r })); return j.r; }
        return cached && cached.r ? cached.r : null;   // сеть подвела — пусть будут старые цифры
      }, () => { ratingsBusy = null; return null; });
    }
    return ratingsBusy;
  });
  /* {items: [{id, stars, text, tags, name, fit, at, reply?, ver?}], total}; before — id последнего показанного */
  const reviews = safe(async (placeId, before) => {
    if (!on || !placeId) return fail();
    const p = { reviews: placeId, limit: 10 };
    if (before) p.before = before;
    const j = await call(p);
    return j && { items: Array.isArray(j.items) ? j.items : [], total: j.total | 0 };
  });
  /* data: {place, stars 1–5, text ≤600, tags ≤5, name ≤30, fit 'date'|'group'|'', yandexToken?} → {item, pending} */
  const review = safe(async data => {
    if (!on || !data || !data.place) return fail();
    const body = {
      action: 'review', place: data.place, stars: data.stars, text: data.text || '', tags: data.tags || [],
      name: data.name || '', fit: data.fit || '', dev: dev(),
    };
    if (data.yandexToken) body.yandexToken = data.yandexToken;
    const j = await call(null, body);
    if (!j && api.lastError !== 'dup') return null;
    const done = readJson(ls, 'kuda-reviewed', []);
    ls.set('kuda-reviewed', JSON.stringify((Array.isArray(done) ? done : []).filter(x => x !== data.place).concat(data.place).slice(-500)));
    ss.del(RATINGS_KEY);
    return j && { item: j.item, pending: !!j.pending };
  });
  /* Уже оставлял отзыв об этом месте с этого браузера? (без сети) */
  function reviewed(placeId) {
    const done = readJson(ls, 'kuda-reviewed', []);
    return Array.isArray(done) && done.indexOf(placeId) >= 0;
  }
  const report = safe(async (id, reason) => {
    if (!on || !id) return fail();
    const j = await call(null, { action: 'report', id, dev: dev(), reason: String(reason || '').slice(0, 200) });
    return j ? true : null;
  });

  /* ---------- короткие ссылки и ошибки в каталоге ---------- */
  /* Код короткой ссылки (только для адресов нашего сайта): ссылка вида go.html#s=<код> */
  const short = safe(async url => {
    if (!on || !url) return fail();
    const j = await call(null, { action: 'short', url: String(url) });
    return j && typeof j.code === 'string' ? j.code : null;
  });
  /* Раскрыть код обратно в адрес */
  const expand = safe(async code => {
    if (!on || !code) return fail();
    const j = await call({ s: String(code) });
    return j && typeof j.url === 'string' ? j.url : null;
  });
  /* «Нашли ошибку?» — текст уходит модератору */
  const fix = safe(async (place, text) => {
    if (!on || !place || !text) return fail();
    const j = await call(null, { action: 'fix', place, text: String(text).slice(0, 1000), dev: dev() });
    return j ? true : null;
  });

  const api = {
    closeVote,
    on, lastError: on ? '' : 'off',
    key, ownerKey, dev, voteSecret,
    vote, votes, poll, spin, invite, opened, answer, mine,
    ratings, reviews, review, reviewed, report, short, expand, fix,
  };
  window.KudaAPI = api;
})();

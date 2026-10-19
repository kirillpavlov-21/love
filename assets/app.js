/* Игра-приглашение на свидание. Настройки — в config.js или в ссылке из create.html */
(function () {
  'use strict';

  const K = window.DateKit;
  const CFG = window.DATE_CONFIG || {};
  const TG = CFG.telegram || {};
  const TG_READY = !!TG.relayUrl;
  /* Свой сервер (assets/api.js, config.js → api.url). Нет файла или пустой адрес — всё работает на ссылках */
  const API = window.KudaAPI || null;
  const API_ON = !!(API && API.on);
  /* Вызов API без исключений: нет такой функции (старый api.js) или она упала — null */
  const api = (fn, ...args) => {
    try { return API && typeof API[fn] === 'function' ? Promise.resolve(API[fn](...args)).catch(() => null) : Promise.resolve(null); }
    catch (e) { return Promise.resolve(null); }
  };
  const apiErr = () => (API && typeof API.lastError === 'string' ? API.lastError : '');
  const stage = document.getElementById('stage');
  /* ?v= этого скрипта — с тем же номером догружаем афишу (assets/events.js, events-spb.js, sport.js), когда она нужна */
  const VER = (() => { try { const m = /[?&]v=([^&#]+)/.exec((document.currentScript && document.currentScript.src) || ''); return m ? '?v=' + m[1] : ''; } catch (e) { return ''; } })();
  /* «Уменьшить движение» в настройках системы: без конфетти, сердечного дождя и плавной прокрутки */
  const RMQ = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const calm = () => !!(RMQ && RMQ.matches);

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = K.esc;
  const I = K.icon;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const vibrate = p => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* нет вибрации */ } };
  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
  };

  let INV = null;          // итоговое приглашение
  let INV_ID = '';
  let PREVIEW = false;     // превью из конструктора: ничего не отправляем и не сохраняем
  let KEY = 'date-invite';
  let STEPS = [];
  let LEVEL_COUNT = 0;
  let RESUME = 0;
  let MODE = 'date', MC = K.MODES.date, GROUP = false;
  let CODE = '';            // код приглашения из ссылки
  let PRIOR = [];           // все голоса, которые мы видели: ссылка + этот браузер + сервер (групповой режим)
  let VOTER_ID = '';
  let ANSWER = null;        // ответ девушки, открытый по ссылке-билету
  let EVENT = null;         // событие из афиши, на которое зовут (свидание), и его дни
  let EV_DAYS = [];
  let EV_PAST = null;       // событие из приглашения уже прошло
  let REV = -1;             // версия голосов на сервере
  let SPIN = null;          // итог колеса с сервера: { i, L? } — для каждой ничьей (L) первый сохранённый остаётся у всех
  let SRV_UNTIL = null;     // дедлайн с сервера («Закрыть сейчас» организатора), минуты эпохи
  let SPINS = null;         // итоги колеса по наборам лидеров с сервера: { '0,2': { i, L } }
  let SYNC = '';            // '' — сервер не спрашивали, 'on' — голоса с сервера, 'off' — сервер не ответил
  let VOTE_STATE = '';      // мой голос на сервере: 'saving' | 'saved' | 'local'
  let OWN = false;          // приглашение создано в этом браузере (create.js → localStorage kuda-own)
  const live = () => API_ON && !PREVIEW && !!CODE;
  const DEF = K.defaults();
  const T = s => K.fill(s, INV);
  /* Текст режима: свой из приглашения или стандартный для пацанов/подружек */
  const MT = key => {
    const v = INV[key];
    return GROUP && (v == null || v === '' || v === DEF[key]) ? MC[key] : v;
  };
  const groupTitle = () => INV.title || MC.title || '';
  /* Свои приглашения создатель проверяет сам — себе в Telegram ничего не шлём */
  const canNotify = () => TG_READY && !PREVIEW && !OWN && !!INV.tg;
  /* Цель Метрики через assets/track.js: без согласия на аналитику — только локальный журнал, без имён и текстов */
  function goal(type, v) {
    if (PREVIEW) return;
    try { if (window.KudaTrack && typeof window.KudaTrack.ev === 'function') window.KudaTrack.ev(type, { mode: MODE, v }); } catch (e) { /* без аналитики */ }
  }
  /* После голоса: текст режима из shared.js («кидай ссылку в чат») не говорит, что голос пока только здесь — свой текст */
  const DONE = {
    guys: 'Кинь ссылку в чат пацанам — иначе остальные его не увидят.',
    girls: 'Отправь ссылку в чат девочкам — иначе остальные его не увидят.',
  };
  function isOwn(id) {
    try { const a = JSON.parse(localStorage.getItem('kuda-own') || '[]'); return Array.isArray(a) && a.includes(id); } catch (e) { return false; }
  }
  /* Приглашение есть в истории конструктора этого браузера (create.js → date-constructor-history: { code, link, … }) */
  function inHistory(code) {
    if (!code) return false;
    try {
      const l = JSON.parse(localStorage.getItem('date-constructor-history') || '[]');
      return Array.isArray(l) && l.some(x => x && (x.code === code || K.readHash('#' + (String(x.link || '').split('#')[1] || '')).code === code));
    } catch (e) { return false; }
  }
  /* Имя для голосования: введённое здесь раньше → своё приглашение — имя из него → имя из конструктора или прошлых голосов (kuda-name) */
  const NAME_STUB = ['Я', 'Твой друг'];
  function knownName() {
    const me = String(INV.me || '').trim();
    let n = OWN && me && !NAME_STUB.includes(me) ? me : '';
    if (!n) { try { n = localStorage.getItem('kuda-name') || ''; } catch (e) { /* приватный режим */ } }
    return String(n).trim().slice(0, 30);
  }

  /* pre — день и время, подставленные из события (их снимаем, если выбрали другое место) */
  /* timeNext — время после полуночи в окне через полночь (22:00–02:00): встреча в ночь на следующий день */
  const freshAnswers = () => ({ yes: false, noTries: 0, hearts: 0, place: null, placeText: '', date: '', dateOther: '', time: '', timeNext: false, food: null, note: '', coming: null, opts: [], days: [], maybe: [], slots: [], plus: 0, name: '', pre: null });
  const S = { step: 0, a: freshAnswers(), sent: {} };

  function save() {
    if (PREVIEW) return;
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* приватный режим */ }
  }
  function load() {
    if (PREVIEW) return;
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && d.a) { Object.assign(S.a, d.a); S.step = d.step | 0; S.sent = d.sent || {}; }
    } catch (e) { /* пусто */ }
  }

  /* ================= Звуки (синтез, без файлов) =================
     iPhone глушит Web Audio беззвучным режимом, как рингтон. Поэтому до создания
     AudioContext объявляем звук «медиа» (audioSession = playback), а там, где этого
     API нет, включаем тихий зацикленный <audio>. Контекст создаём только по касанию. */
  const Sfx = (() => {
    const IOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let ctx = null, out = null, on = true, silent = null;
    try { on = localStorage.getItem('date-sound') !== '0'; } catch (e) { /* по умолчанию вкл */ }
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* нет API */ }

    function silentWav() {
      const n = 4000, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
      const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
      w(36, 'data'); v.setUint32(40, n, true);
      for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
      return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    }
    function init() {
      try {
        if (!on) return;
        if (IOS && !navigator.audioSession) {
          if (!silent) {
            silent = document.createElement('audio');
            silent.src = silentWav();
            silent.loop = true;
            silent.setAttribute('playsinline', '');
            silent.setAttribute('x-webkit-airplay', 'deny');
            silent.disableRemotePlayback = true;
          }
          if (silent.paused) { const p = silent.play(); if (p && p.catch) p.catch(() => {}); }
        }
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          ctx = new AC();
          const comp = ctx.createDynamicsCompressor();
          out = ctx.createGain();
          out.gain.value = 1;
          out.connect(comp); comp.connect(ctx.destination);
        }
        if (ctx.state !== 'running') { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
        const b = ctx.createBufferSource();
        b.buffer = ctx.createBuffer(1, 1, 22050);
        b.connect(ctx.destination);
        b.start(0);
      } catch (e) { /* без звука */ }
    }
    function tone(f, dur, o) {
      o = o || {};
      if (!on || !ctx) return;
      if (ctx.state !== 'running') { try { ctx.resume(); } catch (e) { /* ок */ } }
      const t = ctx.currentTime + 0.01 + (o.when || 0);
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(f, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.min(0.9, (o.vol || 0.12) * 2.4), t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(out);
      osc.start(t); osc.stop(t + dur + 0.03);
    }
    return {
      init,
      get on() { return on; },
      toggle() {
        on = !on;
        try { localStorage.setItem('date-sound', on ? '1' : '0'); } catch (e) { /* ок */ }
        if (on) init();
        else if (silent) silent.pause();
        return on;
      },
      click() { tone(760, 0.06, { type: 'triangle', vol: 0.08 }); },
      pop() { tone(560, 0.13, { type: 'triangle', vol: 0.2, to: 130 }); tone(1500, 0.05, { type: 'square', vol: 0.03 }); },
      catch() { tone(880, 0.09, { vol: 0.12 }); tone(1320, 0.14, { vol: 0.1, when: 0.06 }); },
      gold() { [988, 1319, 1760].forEach((f, i) => tone(f, 0.15, { vol: 0.1, when: i * 0.06 })); },
      bad() { tone(320, 0.22, { type: 'sawtooth', vol: 0.05, to: 150 }); },
      tick() { tone(1250, 0.03, { type: 'square', vol: 0.02 }); },
      stamp() { tone(150, 0.18, { vol: 0.3, to: 55 }); tone(520, 0.05, { type: 'triangle', vol: 0.05 }); },
      whoosh() { tone(380, 0.18, { vol: 0.05, to: 950 }); },
      meow() { tone(640, 0.2, { type: 'triangle', vol: 0.09, to: 980 }); tone(960, 0.22, { type: 'triangle', vol: 0.08, when: 0.18, to: 520 }); },
      success() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.12, when: i * 0.09 })); tone(1568, 0.45, { vol: 0.06, when: 0.38 }); },
      fanfare() { [523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, { type: 'triangle', vol: 0.12, when: i * 0.11 })); },
      sad() { tone(440, 0.25, { type: 'triangle', vol: 0.08, to: 330 }); tone(330, 0.35, { type: 'triangle', vol: 0.07, when: 0.22, to: 247 }); },
    };
  })();

  /* ================= Конфетти и сердечки ================= */
  const FX = (() => {
    const cv = document.createElement('canvas');
    cv.id = 'fx';
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');
    const paths = {};
    const heartPath = () => paths[MODE] || (paths[MODE] = new Path2D(K.markD(MODE)));
    let parts = [], raf = 0, last = 0, dpr = 1, W = 0, H = 0;
    function size() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = innerWidth; H = innerHeight;
      cv.width = W * dpr; cv.height = H * dpr;
    }
    size();
    addEventListener('resize', size);
    function palette() {
      const cs = getComputedStyle(document.documentElement);
      return [cs.getPropertyValue('--accent').trim() || '#ff4f86', cs.getPropertyValue('--accent-2').trim() || '#ff9dba', '#ffd35c', '#ffffff', '#ff7aa2', '#b39bff'];
    }
    function add(p) {
      parts.push(p);
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
    }
    function burst(o) {
      if (calm()) return;
      o = o || {};
      const x = o.x != null ? o.x : W / 2, y = o.y != null ? o.y : H * 0.45;
      const n = o.n || 80, pw = o.power || 1, cols = o.colors || palette();
      const shapes = o.shapes || ['heart', 'rect', 'dot', 'heart'];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = (2 + Math.random() * 9) * pw;
        add({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (3 + Math.random() * 4) * pw, g: 0.28,
          r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3, s: (6 + Math.random() * 9) * (o.scale || 1),
          c: cols[i % cols.length], sh: shapes[(Math.random() * shapes.length) | 0], life: 1, dec: 0.008 + Math.random() * 0.01, drag: 0.985,
        });
      }
    }
    function rain(n) {
      if (calm()) return;
      const cols = palette();
      for (let i = 0; i < (n || 50); i++) {
        add({
          x: Math.random() * W, y: -20 - Math.random() * H * 0.7, vx: (Math.random() - 0.5) * 0.6, vy: 1.4 + Math.random() * 2.2, g: 0.015,
          r: (Math.random() - 0.5) * 0.6, vr: (Math.random() - 0.5) * 0.04, s: 11 + Math.random() * 13,
          c: cols[i % cols.length], sh: 'heart', life: 1, dec: 0.0022, drag: 1, sway: Math.random() * 6.28,
        });
      }
    }
    function tick(now) {
      const k = Math.min(3, (now - last) / 16.67);
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      parts = parts.filter(p => p.life > 0 && p.y < H + 40);
      for (const p of parts) {
        p.vx *= Math.pow(p.drag, k);
        p.vy += p.g * k;
        p.x += p.vx * k + (p.sway !== undefined ? Math.sin(now / 600 + p.sway) * 0.6 * k : 0);
        p.y += p.vy * k;
        p.r += p.vr * k;
        p.life -= p.dec * k;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        if (p.sh === 'heart') { const sc = p.s / 22; ctx.scale(sc, sc); ctx.translate(-12, -12); ctx.fill(heartPath()); }
        else if (p.sh === 'rect') ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        else { ctx.beginPath(); ctx.arc(0, 0, p.s / 3, 0, 6.2832); ctx.fill(); }
        ctx.restore();
      }
      raf = parts.length ? requestAnimationFrame(tick) : 0;
      if (!raf) ctx.clearRect(0, 0, W, H);
    }
    return { burst, rain };
  })();

  /* ================= Мелкие помощники ================= */
  function toast(text) {
    $$('.toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    // длинное сообщение — дольше на экране (и анимация исчезновения растягивается вместе с ним)
    const ms = Math.max(2700, String(text).length * 55);
    // читалке — через постоянную живую область (#sr-live в index.html): область, вставленную сразу с текстом, она часто не озвучивает
    const sr = document.getElementById('sr-live');
    if (sr) {
      t.setAttribute('aria-hidden', 'true');
      clearTimeout(sr._t); clearTimeout(sr._c);
      sr.textContent = '';
      sr._t = setTimeout(() => { sr.textContent = text; }, 60);
      sr._c = setTimeout(() => { if (sr.textContent === text) sr.textContent = ''; }, ms + 100);
    } else t.setAttribute('role', 'status');
    t.style.animationDuration = ms + 'ms';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms + 100);
  }
  /* ---------- фокус ----------
     Экран или его часть перерисовали — кнопка с фокусом исчезла, фокус упал на <body>: читалка молчит, Tab идёт с начала.
     Ставим фокус на заголовок или главную кнопку, но только если он действительно потерян */
  function focusLost() {
    const a = document.activeElement;
    return !a || a === document.body || a === document.documentElement || !a.isConnected || !!a.disabled
      || !a.getClientRects().length || !!a.closest('[inert], [aria-hidden="true"]');
  }
  function focusTo(node) {
    if (!node) return;
    if (!/^(A|BUTTON|INPUT|TEXTAREA|SELECT)$/.test(node.tagName) && !node.hasAttribute('tabindex')) node.tabIndex = -1;
    try { node.focus({ preventScroll: true }); } catch (e) { /* ок */ }
  }
  const refocus = node => { if (focusLost()) focusTo(node); };
  /* Перерисовка через innerHTML: запоминаем «ту же» кнопку (id или классы + номер среди таких же), после — возвращаем на неё фокус */
  const STATE_CLS = /^(pulse|busy|hidden|lead|spin|ok|warn|out)$/;
  function focusKey(root) {
    const a = document.activeElement;
    if (!a || a === document.body || !root.contains(a)) return null;
    const cls = Array.from(a.classList).filter(c => /^[a-z][\w-]*$/i.test(c) && !STATE_CLS.test(c));
    const sel = a.id && /^[a-z][\w-]*$/i.test(a.id) ? '#' + a.id : a.tagName.toLowerCase() + cls.map(c => '.' + c).join('');
    return { sel, n: $$(sel, root).indexOf(a) };
  }
  function restoreFocus(root, key, fallback) {
    if (!key || !focusLost()) return;
    const list = $$(key.sel, root);
    focusTo(list[Math.max(0, key.n)] || list[list.length - 1] || (fallback ? $(fallback, root) : null));
  }
  function typeInto(node, text, speed) {
    if (!node) return;
    node.innerHTML = '<span class="tw"><span class="ghost">' + esc(text) + '</span><span class="live"></span></span>';
    const live = $('.live', node);
    const chars = Array.from(text);
    let i = 0;
    clearInterval(node._tw);
    node._tw = setInterval(() => {
      i++;
      live.textContent = chars.slice(0, i).join('');
      if (i >= chars.length) clearInterval(node._tw);
    }, speed || 24);
    node.onclick = () => { clearInterval(node._tw); live.textContent = text; };
  }
  function say(node, text) {
    if (!node) return;
    clearInterval(node._tw);
    node.textContent = text;
    node.classList.remove('pop');
    void node.offsetWidth;
    node.classList.add('pop');
  }
  const LOVE = () => (MODE === 'guys' ? 'happy' : 'love');
  function mood(scope, m, ms) {
    if (m === 'love') m = LOVE();
    const svg = $('.cat', scope);
    if (!svg) return;
    clearTimeout(svg._mt);
    svg.dataset.mood = m;
    if (ms) svg._mt = setTimeout(() => { svg.dataset.mood = svg.dataset.base || 'normal'; }, ms);
  }
  /* Номер уровня — и в заголовке (скрыто): на заголовок встаёт фокус при смене экрана, читалка скажет «Уровень 2 из 5. Куда пойдём?» */
  const head = (step, title, sub) =>
    `<div class="lvl-head"><span class="lvl-tag" aria-hidden="true">Уровень ${step.level} из ${LEVEL_COUNT}</span><h2><span class="vh">Уровень ${step.level} из ${LEVEL_COUNT}. </span>${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}</div>`;
  const miniCat = (text, m) =>
    `<div class="comment"><div class="mini-cat">${K.catSVG(m || 'normal')}</div><div class="bubble b-left">${esc(text || '')}</div></div>`;
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* ниже запасной путь */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }
  /* Случайная строка из [A-Za-z0-9_-] */
  const ABC = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
  function rnd(n) {
    const a = new Uint8Array(n);
    try { crypto.getRandomValues(a); } catch (e) { for (let i = 0; i < n; i++) a[i] = (Math.random() * 256) | 0; }
    return Array.from(a, b => ABC[b & 63]).join('');
  }
  const uniq = a => Array.from(new Set(a));
  const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
  const hnum = s => parseInt(K.hash(s), 36) || 0;

  /* ================= Город приглашения =================
     У игры нет своего «города интерфейса»: город — у мест и событий приглашения (id spb-…, ev-spb-… или поле city).
     По нему — регион Яндекс Карт, город в адресе для календаря и город главной в ссылках «Все планы», «Создать свой…». */
  const cityOf = x => (typeof K.cityOf === 'function' ? K.cityOf(x) : 'msk');
  /* Город приглашения — по первому пункту из каталога (событие, шарик-место, вариант голосования); '' — таких нет */
  function invCity() {
    if (!INV) return '';
    const ids = [INV.event].concat((Array.isArray(INV.places) ? INV.places : []).map(p => p && p.plan),
      (Array.isArray(INV.opts) ? INV.opts : []).map(o => o && (o.plan || o.event)));
    const id = ids.find(x => typeof x === 'string' && x);
    return id ? cityOf(id) : '';
  }
  /* Город в конце адреса для календаря — только не московский: в московских адресах бывают города области («Химки, …»),
     и раньше календарь получал их без города */
  const locCity = (x, addr) => {
    const c = K.CITIES && K.CITIES[cityOf(x)];
    return c && c.id !== 'msk' && String(addr || '').indexOf(c.addr) < 0 ? c.addr : '';
  };
  /* Метка «пришёл по приглашению» для своего приглашения гостя: 8 знаков хэша кода — без имён и самого кода */
  const refTag = () => (CODE ? K.hash(CODE).padStart(8, '0').slice(-8) : '');
  const refQ = () => (refTag() ? '&ref=' + refTag() : '');
  /* create.html в городе приглашения, с меткой ref */
  function guestCreateUrl(q) {
    const c = invCity();
    return 'create.html?' + q + refQ() + (c ? '&city=' + encodeURIComponent(c) : '');
  }
  /* Три плана рядом с тем, за что гость голосовал (другой повод — «позвать других на этот же план»), или любые три этого города */
  function guestPlans() {
    const items = optItems(), mine = (S.a.opts || []).map(i => items[i]).filter(Boolean);
    const anchor = mine.concat(items).map(o => o.plan && K.planById(o.plan)).find(Boolean);
    const c = invCity() || 'msk';
    const taken = new Set(items.map(o => o.plan).filter(Boolean));
    const at = anchor ? K.planStops(anchor)[0] : null;
    const pool = (K.kuda().scenarios || []).filter(x => x && !taken.has(x.id) && x.mode !== MODE && K.cityOf(x) === c && K.planStops(x).length === x.stops.length && K.seasonOk(x));
    const d = x => (at ? K.distM(at, K.planStops(x)[0]) : (K.hash(CODE + x.id) >>> 0));
    return pool.map(x => [x, d(x)]).filter(x => !at || x[1] <= 2500).sort((a, b) => a[1] - b[1]).slice(0, 3).map(x => x[0]);
  }
  function guestBlock() {
    let pl = [];
    try { pl = guestPlans(); } catch (e) { pl = []; }
    if (!pl.length) return '';
    return `<div class="guest-box"><h3>Пока остальные голосуют</h3><p class="sub">Позови своих — на свидание или с друзьями, рядом с этим местом:</p>
      ${pl.map(x => `<a class="chip-link guest-plan" href="${esc(guestCreateUrl('plan=' + encodeURIComponent(x.id) + '&mode=' + x.mode))}">${esc(x.emoji || '📍')} ${esc(x.title)} <small>· ${esc((K.MODES[x.mode] || {}).label || '')}</small></a>`).join('')}</div>`;
  }
  /* Ссылка на главную в городе приглашения: получатель из Петербурга попадёт на петербургские планы */
  function hubUrl(q, c) {
    if (c === undefined) c = invCity();
    const s = [q, c ? 'city=' + encodeURIComponent(c) : ''].filter(Boolean).join('&');
    return 'start.html' + (s ? '?' + s : '');
  }

  /* ================= Дата в Москве ================= */
  let MSK_FMT = null;
  /* { today: 'YYYY-MM-DD', min: минуты от полуночи } */
  function mskNow() {
    const d = new Date();
    try {
      MSK_FMT = MSK_FMT || new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      const o = {};
      MSK_FMT.formatToParts(d).forEach(p => { o[p.type] = p.value; });
      if (!o.year || !o.month || !o.day) throw new Error('tz');
      return { today: `${o.year}-${o.month}-${o.day}`, min: (+o.hour % 24) * 60 + (+o.minute || 0) };
    } catch (e) {
      const m = new Date(d.getTime() + 3 * 3600e3);   // Москва — UTC+3 круглый год
      return { today: m.toISOString().slice(0, 10), min: m.getUTCHours() * 60 + m.getUTCMinutes() };
    }
  }
  const RX_YMD = /^\d{4}-\d{2}-\d{2}$/;
  function todayYmd() {
    if (typeof K.todayMsk === 'function') { try { const t = K.todayMsk(); if (RX_YMD.test(t)) return t; } catch (e) { /* ниже */ } }
    return mskNow().today;
  }
  const todayNum = () => K.dayNum(todayYmd());
  const dayShort = s => { const d = K.parseYmd(s); return d ? new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }).format(d) : s; };
  const dayMonth = s => { const d = K.parseYmd(s); return d ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(d) : s; };
  const shortDay = n => dayShort(K.numDay(n));

  /* ================= События из афиши (assets/events.js и auto.js) ================= */
  const EV_MIN = { concert: 150, theatre: 180, exhibition: 120, standup: 120, festival: 240, sport: 150, show: 150, party: 300, lecture: 90, kids: 120 };
  const EV_CAT = { concert: 'Концерт', theatre: 'Спектакль', exhibition: 'Выставка', standup: 'Стендап', festival: 'Фестиваль', sport: 'Спорт', show: 'Шоу', party: 'Вечеринка', lecture: 'Лекция', kids: 'Детям' };
  const TICKET = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/><path d="M14 7.5v9" stroke-dasharray="1.6 2.2"/></svg>';
  function eventById(id) {
    if (!id || typeof id !== 'string') return null;
    let ev = null;
    if (typeof K.eventById === 'function') { try { ev = K.eventById(id); } catch (e) { ev = null; } }
    if (!ev) ev = (Array.isArray(window.KUDA_EVENTS) ? window.KUDA_EVENTS : []).find(e => e && e.id === id) || null;
    return ev && ev.title && RX_YMD.test(ev.start || '') ? ev : null;
  }
  /* Будущие дни события: список dates или каждый день от start до end; сегодняшний показ — пока не прошёл час от начала */
  function evDaysAll(ev) {
    if (!ev) return [];
    const now = mskNow();
    let days = null;
    if (typeof K.eventDays === 'function') { try { days = K.eventDays(ev); } catch (e) { days = null; } }
    if (!Array.isArray(days)) {
      if (Array.isArray(ev.dates) && ev.dates.length) days = ev.dates.slice();
      else {
        days = [];
        const end = K.parseYmd(RX_YMD.test(ev.end || '') ? ev.end : ev.start);
        for (let d = K.parseYmd(ev.start > now.today ? ev.start : now.today), i = 0; d && end && d <= end && i < 400; d = K.addDays(d, 1), i++) days.push(K.ymd(d));
      }
    }
    const late = !!ev.time && now.min >= K.toMin(ev.time) + 60;
    return uniq(days.filter(d => RX_YMD.test(d) && d >= now.today && !(late && d === now.today))).sort();
  }
  /* Дни, которые предлагаем в игре: короткий список — весь; длинный (выставка, частые показы) — в окне дат приглашения */
  function evDays(ev) {
    const all = evDaysAll(ev);
    if (all.length <= 14) return all;
    const inv = new Set(K.listDates(INV.dates));
    const both = all.filter(d => inv.has(d));
    return (both.length ? both : all).slice(0, 31);
  }
  function evWhen(ev, days) {
    days = days || evDaysAll(ev);
    if (!days.length) return 'Уже прошло';
    const t = ev.time ? ' · ' + ev.time : '';
    if (days.length === 1) return dayShort(days[0]) + t;
    if (!(Array.isArray(ev.dates) && ev.dates.length) && days.length > 7) return 'до ' + dayMonth(RX_YMD.test(ev.end || '') ? ev.end : days[days.length - 1]) + t;
    return `${days.length} ${plural(days.length, 'дата', 'даты', 'дат')}, ближайшая — ${dayShort(days[0])}${t}`;
  }
  /* То же коротко — для плашки на карточке голосования: «пт, 16 окт. · 20:00 и ещё 6» */
  function evWhenShort(ev, days) {
    days = days || evDaysAll(ev);
    if (days.length <= 1 || (!(Array.isArray(ev.dates) && ev.dates.length) && days.length > 7)) return evWhen(ev, days);
    return `${dayShort(days[0])}${ev.time ? ' · ' + ev.time : ''} и ещё ${days.length - 1}`;
  }
  function evPrice(ev) {
    const p = Array.isArray(ev.price) ? ev.price : null;
    if (!p || p[0] == null || !isFinite(p[0])) return '';
    const n = x => new Intl.NumberFormat('ru-RU').format(Math.round(x));
    const a = +p[0], b = p[1] == null || !isFinite(p[1]) ? a : +p[1];
    if (b <= 0) return 'Бесплатно';
    if (a <= 0) return 'до ' + n(b) + ' ₽';
    return b > a ? n(a) + '–' + n(b) + ' ₽' : 'от ' + n(a) + ' ₽';
  }
  /* Площадка: из события, недостающее — из каталога */
  function evVenue(ev) {
    const pl = ev.place ? K.placeById(ev.place) : null;
    const lat = isFinite(ev.lat) && +ev.lat ? +ev.lat : pl ? pl.lat : NaN, lon = isFinite(ev.lon) && +ev.lon ? +ev.lon : pl ? pl.lon : NaN;
    return { name: ev.venue || (pl && pl.name) || '', addr: ev.addr || (pl && pl.addr) || '', metro: ev.metro || (pl && pl.metro) || '', lat, lon, pl };
  }
  const evPlaceLine = ev => { const v = evVenue(ev); return [v.name, K.metroText(v.metro)].filter(Boolean).join(' · '); };
  const evLoc = ev => { const v = evVenue(ev); return [v.name, v.addr, locCity(ev, v.addr)].filter(Boolean).join(', '); };
  /* Яндекс Карты — в регионе города события (Москва или Петербург), а не по умолчанию московском */
  function evRoute(ev) {
    const v = evVenue(ev), city = cityOf(ev);
    if (v.pl) return K.routeUrl([v.pl]);
    if (isFinite(v.lat) && isFinite(v.lon)) return K.routeUrl([{ name: v.name, addr: v.addr, lat: v.lat, lon: v.lon, city }]);
    return v.addr ? K.mapUrl({ name: v.name, addr: v.addr, city }) : '';
  }
  const evPhoto = ev => (ev.place ? K.photo(K.placeById(ev.place)) : null);
  /* Автор фото без приписок про соцсети (shared.js cleanAuthor) */
  const phAuthor = ph => (typeof K.cleanAuthor === 'function' ? K.cleanAuthor(ph.a) : String(ph.a || '')) || 'Wikimedia Commons';
  const evUrl = ev => (/^https:\/\/[^\s"'<>]+$/i.test(ev.url || '') ? ev.url : '');
  const evPick = ev => ({ emoji: ev.emoji || '🎫', title: ev.title, kind: 'event', plan: '', event: ev.id });
  function evLinks(ev) {
    const url = evUrl(ev), route = evRoute(ev), free = evPrice(ev) === 'Бесплатно';
    if (!url && !route) return '';
    return `<div class="plan-links">
      ${url ? `<a class="chip-link" href="${esc(url)}" target="_blank" rel="noopener nofollow">${TICKET}${free ? 'Подробнее' : 'Билеты'}<span class="vh"> — сайт организатора</span></a>` : ''}
      ${route ? `<a class="chip-link" href="${esc(route)}" target="_blank" rel="noopener">${I('route')}Как добраться</a>` : ''}
    </div>`;
  }

  function heartSVG(type, alpha) {
    const fill = type === 'gold' ? '#F5C451' : type === 'broken' ? '#5A5766' : 'var(--accent)';
    let extra = '';
    if (type === 'broken') extra = '<path d="M12 5.2 L10.3 9.3 L13.2 11.8 L10.8 15.2 L12.4 19.5" fill="none" stroke="#16151B" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>';
    if (type === 'gold') extra = '<path d="M18.6 1.6 l.8 1.9 1.9.8 -1.9.8 -.8 1.9 -.8-1.9 -1.9-.8 1.9-.8z" fill="#FFF7DA"/><ellipse cx="7.2" cy="7.6" rx="2.2" ry="1.3" fill="#FFF7DA" opacity=".7" transform="rotate(-35 7.2 7.6)"/>';
    return `<svg viewBox="0 0 24 24"><path d="${K.HEART_D}" fill="${fill}"${alpha ? ` opacity="${alpha}"` : ''}/>${extra}</svg>`;
  }
  const BASKET = () => `<svg viewBox="0 0 100 50" aria-hidden="true">
    <path d="M8 14 H92 L83 45 Q82 49 78 49 H22 Q18 49 17 45 Z" fill="#1A1920" stroke="#F4F1EA" stroke-width="3" stroke-linejoin="round"/>
    <path d="M13 27 H87 M17 38 H83" stroke="rgba(244,241,234,.28)" stroke-width="2" stroke-linecap="round"/>
    <path d="M31 17 V47 M50 17 V48 M69 17 V47" stroke="rgba(244,241,234,.18)" stroke-width="2" stroke-linecap="round"/>
    <rect x="3" y="7" width="94" height="12" rx="6" fill="#22212A" stroke="#F4F1EA" stroke-width="3"/>
    <path d="${K.markD(MODE)}" transform="translate(41.5 24) scale(.7)" fill="var(--accent)"/>
  </svg>`;
  const BCOL = ['#FF6F91', '#B9A1FF', '#D7F25C', '#FFA463', '#6EE7B7', '#7CC4FF', '#F5C451', '#FF9ED2'];
  function balloonSVG(color) {
    return `<svg viewBox="0 0 100 150" aria-hidden="true">
      <path d="M50 116 C43 126 57 134 49 150" fill="none" stroke="rgba(244,241,234,.35)" stroke-width="2"/>
      <path d="M50 4 C79 4 95 27 95 52 C95 82 70 106 50 110 C30 106 5 82 5 52 C5 27 21 4 50 4 Z" fill="${color}" stroke="rgba(0,0,0,.08)" stroke-width="2"/>
      <path d="M43 118 L50 108 L57 118 Z" fill="${color}"/>
      <ellipse cx="29" cy="33" rx="8" ry="15" fill="#fff" opacity=".35" transform="rotate(28 29 33)"/>
      <ellipse cx="38" cy="16" rx="3" ry="4" fill="#fff" opacity=".3"/>
    </svg>`;
  }
  const FCOL = ['#ffd6e0', '#ffe7b8', '#d4ecff', '#e3dbff', '#d2f5e6', '#ffdccf', '#fff1b8', '#ffd9f1'];
  const CLOUD = '<svg viewBox="0 0 100 50" aria-hidden="true"><path d="M20 45 Q2 45 5 32 Q8 20 22 24 Q26 8 44 10 Q60 2 70 18 Q88 14 92 30 Q98 45 80 45 Z" fill="#fff" opacity=".92"/></svg>';
  function citySVG() {
    let s = 11;
    const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    let x = -4, out = '';
    while (x < 404) {
      const w = (26 + r() * 34) | 0, h = (34 + r() * 60) | 0, y = 110 - h;
      out += `<rect x="${x}" y="${y}" width="${w}" height="${h + 4}" rx="3" fill="var(--bld)"/>`;
      for (let wy = y + 8; wy < 102; wy += 13) for (let wx = x + 6; wx < x + w - 8; wx += 11) if (r() > 0.35) out += `<rect class="win" x="${wx}" y="${wy}" width="5" height="7" rx="1"/>`;
      x += w + ((r() * 4) | 0);
    }
    return `<svg class="city" viewBox="0 0 400 110" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${out}</svg>`;
  }
  const SKY = [
    [6, '#ffcdb5', '#fff2da'], [9, '#a9dcff', '#fff4df'], [13, '#86ccff', '#e1f4ff'], [16.5, '#ffc08f', '#ffe6b8'],
    [18.5, '#ff8fa6', '#ffc59a'], [19.75, '#8a6bc4', '#ff9ab1'], [21, '#3a3380', '#8e5aa6'], [22.5, '#1c1b4a', '#3a2f73'], [24.5, '#11112c', '#241f55'],
    // окно через полночь до утра: часы после 24 — следующий день
    [28.5, '#11112c', '#241f55'], [30, '#ffcdb5', '#fff2da'], [33, '#a9dcff', '#fff4df'], [37, '#86ccff', '#e1f4ff'],
  ];
  const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, t) => { const A = hexRgb(a), B = hexRgb(b); return 'rgb(' + A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',') + ')'; };
  function skyAt(h) {
    if (h <= SKY[0][0]) return [SKY[0][1], SKY[0][2]];
    for (let i = 1; i < SKY.length; i++) {
      if (h <= SKY[i][0]) {
        const [h0, a0, b0] = SKY[i - 1], [h1, a1, b1] = SKY[i], t = (h - h0) / (h1 - h0);
        return [mix(a0, a1, t), mix(b0, b1, t)];
      }
    }
    const l = SKY[SKY.length - 1];
    return [l[1], l[2]];
  }
  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  /* ================= Ответы и Telegram ================= */
  const has = id => STEPS.some(s => s.id === id);
  function placeText(plain) {
    const p = S.a.place;
    const e = x => (plain ? '' : x + ' ');
    if (!p) return '—';
    if (p.kind === 'custom') return e('✍️') + (S.a.placeText || 'свой вариант');
    if (p.kind === 'surprise') return e('🎁') + `Сюрприз — выбирает ${INV.me}`;
    return (p.emoji ? e(p.emoji) : '') + p.title;
  }
  function foodText(plain) {
    const f = S.a.food;
    if (!f) return '—';
    if (!f.length) return (plain ? '' : '🎲 ') + `Выбирает ${INV.me}`;
    return f.map(x => (plain ? '' : x.emoji + ' ') + x.title).join(', ');
  }
  /* [эмодзи для Telegram, иконка для билета, подпись, значение] */
  function answerRows(plain) {
    const rows = [];
    const p = S.a.place, ev = p && p.kind === 'event' ? eventById(p.event) : null;
    if (p && p.kind === 'event') {
      rows.push(['🎫', 'sparkle', 'Событие', placeText(plain)]);
      if (ev && evPlaceLine(ev)) rows.push(['📍', 'pin', 'Где', evPlaceLine(ev)]);
    } else if (has('place')) rows.push(['📍', 'pin', 'Место', placeText(plain)]);
    // день и время из события подставляются без уровня — показываем их всё равно
    if (has('date') || S.a.date) rows.push(['📅', 'calendar', 'День', S.a.date ? K.fmtDay(S.a.date) : (S.a.dateOther || '—')]);
    if (has('time') || S.a.time) rows.push(['🕐', 'clock', 'Время', S.a.time || '—']);
    if (has('food')) rows.push(['🍽', 'food', 'Еда', foodText(plain)]);
    if (!rows.length) rows.push(['💕', 'heart', 'Ответ', 'Да!']);
    return rows;
  }
  /* Род того, кого зовут: who = 'm' — «он», иначе «она» (по умолчанию, как в старых ссылках) */
  const GF = (f, m) => (INV.who === 'm' ? m : f);
  function summary(html) {
    const e = s => (html ? esc(s) : s);
    const b = s => (html ? '<b>' + s + '</b>' : s);
    const L = [];
    if (html) {
      L.push(`💌 ${b(e(INV.her))} ${GF('прошла', 'прошёл')} приглашение!`);
      if (has('letter')) L.push(`✅ Ответ: ${b('ДА')}` + (S.a.noTries ? ` (${GF('пыталась', 'пытался')} нажать «Нет»: ${S.a.noTries})` : ''));
    } else {
      L.push(`Привет, ${INV.me}! Я ${GF('прошла', 'прошёл')} твою игру 😊`, 'Мой ответ — да! 💕');
    }
    for (const [i, , l, v] of answerRows()) L.push(`${i} ${l}: ${b(e(v))}`);
    if (html && has('hearts')) L.push(`❤️ ${GF('Поймала', 'Поймал')} сердечек: ${S.a.hearts}`);
    if (S.a.note) L.push(html ? `✉️ ${e(S.a.note)}` : `P.S. ${S.a.note}`);
    return L.join('\n');
  }
  function tgText(kind) {
    if (GROUP) {
      const who = '<b>' + esc(S.a.name || 'Кто-то') + '</b>';
      if (kind === 'open') return `👀 Открыли приглашение «${esc(groupTitle())}»`;
      const opts = optItems().filter((o, i) => (S.a.opts || []).includes(i)).map(o => o.emoji + ' ' + o.title).join(', ') || '—';
      const days = (S.a.days || []).map(d => K.fmtDay(d)).join(', ') || 'пока не знает';
      return S.a.coming === false ? `${MC.emoji} ${who} не сможет` : `${MC.emoji} ${who} в деле!\n📍 За: ${esc(opts)}\n📅 Может: ${esc(days)}`;
    }
    const her = '<b>' + esc(INV.her) + '</b>';
    if (kind === 'open') return `👀 ${her} ${GF('открыла', 'открыл')} приглашение`;
    if (kind === 'yes') return `💕 ${her} ${GF('сказала', 'сказал')} «Да»!\n` + (S.a.noTries ? `${GF('Пыталась', 'Пытался')} нажать «Нет»: ${S.a.noTries} ${plural(S.a.noTries, 'раз', 'раза', 'раз')} 😅` : 'С первой попытки 😍');
    if (kind === 'no') return `😢 ${her} ${GF('нажала', 'нажал')} «Нет»`;
    if (kind === 'note') return `✉️ ${her} пишет:\n${esc(S.a.note)}`;
    return summary(true);
  }
  /* c — отпечаток секрета создателя из ссылки (tg): без него посредник ответ не перешлёт */
  function notify(kind) {
    if (!canNotify()) return Promise.resolve(false);
    return K.relaySend(TG.relayUrl, tgText(kind), INV_ID, typeof INV.tg === 'string' ? INV.tg : '');
  }
  /* Ответ из ссылки-билета: ссылку можно подделать или обрезать — берём только поля нужного вида */
  function cleanAnswer(a) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
    const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    const pick = p => (p && typeof p === 'object' && !Array.isArray(p) ? {
      emoji: str(p.emoji, 16), title: str(p.title, 120), kind: /^(custom|surprise|event)$/.test(p.kind) ? p.kind : '',
      plan: str(p.plan, 80), event: str(p.event, 80),
    } : null);
    const time = typeof a.time === 'string' && /^\d{1,2}:\d{2}$/.test(a.time) ? a.time : '';
    return {
      yes: !!a.yes, place: pick(a.place), placeText: str(a.placeText, 120),
      date: typeof a.date === 'string' && RX_YMD.test(a.date) ? a.date : '', dateOther: str(a.dateOther, 120),
      time, timeNext: !!time && a.timeNext === true,
      food: Array.isArray(a.food) ? a.food.map(pick).filter(f => f && f.title).slice(0, 12) : null,
      note: str(a.note, 500),
    };
  }
  /* Без уровня с письмом вопроса «да/нет» нет: дошла до билета — значит, согласна (как и цель «decision» в финале) */
  const saidYes = () => !!S.a.yes || !has('letter');
  async function answerLink() {
    const a = S.a;
    const payload = { yes: saidYes(), place: a.place, placeText: a.placeText, date: a.date, dateOther: a.dateOther, time: a.time, food: a.food, note: a.note };
    if (a.timeNext && a.time) payload.timeNext = true;
    return baseUrl() + '#' + CODE + '&a=' + await K.encodeData(payload);
  }
  /* Ответ на свидание для сервера: только поля, которые он принимает */
  function answerPayload() {
    const a = S.a, p = a.place;
    const out = {
      yes: saidYes(), noTries: a.noTries | 0, hearts: a.hearts | 0,
      place: p ? { emoji: String(p.emoji || ''), title: String(p.title || ''), kind: String(p.kind || ''), plan: String(p.plan || '') } : null,
      placeText: a.placeText || '', date: a.date || '', dateOther: a.dateOther || '', time: a.time || '',
      food: Array.isArray(a.food) ? a.food.map(f => ({ emoji: String(f.emoji || ''), title: String(f.title || '') })) : null,
      note: a.note || '',
    };
    if (p && p.kind === 'event' && p.event) out.event = p.event;
    // 00:30 в окне 22:00–02:00 — это ночь на следующий день после date (для календаря в «Моих приглашениях»)
    if (a.timeNext && a.time) out.timeNext = true;
    return out;
  }
  /* День встречи для календаря: время после полуночи — уже следующий день */
  const meetDay = (date, a) => (date && a.time && a.timeNext ? K.ymd(K.addDays(K.parseYmd(date), 1)) : date);
  /* Сохранить ответ на сервере («Мои приглашения» у создателя). Тот же ответ второй раз не шлём */
  function saveAnswer(payload) {
    if (!live() || GROUP || OWN) return Promise.resolve(false);
    const sig = JSON.stringify(payload);
    if (S.sent.ans === sig) return Promise.resolve(true);
    return api('answer', CODE, payload).then(ok => {
      if (ok) { S.sent.ans = sig; save(); }
      return !!ok;
    }, () => false);
  }
  /* Ник владельца в Telegram: из приглашения или из config.js */
  const hostTg = () => K.tgUser(INV.tgu) || K.tgUser(CFG.myTelegram);
  /* Ссылку-билет сокращаем заранее, при показе финала и после записки: на iPhone «Поделиться» не открывается,
     если перед ним ждали ответа сети. Не успела сократиться — отправляем полную ссылку, не ждём. */
  const ticket = { sig: '', url: '', busy: null };
  function prepareTicket(onReady) {
    if (!CODE || PREVIEW) return;   // в превью ответ ненастоящий — настоящую ссылку-билет не делаем
    const sig = JSON.stringify(S.a);
    if (ticket.sig === sig && (ticket.url || ticket.busy)) { if (onReady && ticket.url) onReady(); return; }
    ticket.sig = sig; ticket.url = '';
    const p = ticket.busy = answerLink().then(long => { if (ticket.sig === sig && !ticket.url) ticket.url = long; return shortAny(long); })
      .then(short => { if (ticket.sig !== sig) return; ticket.url = short; ticket.busy = null; if (onReady) onReady(); })
      .catch(() => { if (ticket.busy === p) ticket.busy = null; });
  }
  /* «Забронировать»: готовый текст, «Позвонить» (tel:), «Скопировать», сайт или Яндекс Карты; отметка «Забронировано» */
  function bookBox(p, o) {
    if (!p) return '';
    const text = K.bookText(o);
    const done = !!(S.sent && S.sent.booked);
    return `<div class="book-wrap"><button class="btn btn-soft btn-wide book-open" aria-expanded="false">📞 Забронировать</button>
      <div class="book-box hidden" data-text="${esc(text)}">
        <p class="k">Бронь · ${esc(p.name)}</p>
        <p class="book-text">${esc(text)}</p>
        <div class="book-acts">
          ${p.tel ? `<a class="btn btn-primary" href="${esc(K.telHref(p.tel))}">Позвонить ${esc(K.telText(p.tel))}</a>` : ''}
          <button class="btn btn-soft book-copy">Скопировать текст</button>
          ${p.site ? `<a class="btn btn-soft" href="${esc(p.site)}" target="_blank" rel="noopener nofollow">Сайт места</a>` : `<a class="btn btn-soft" href="${esc(K.mapUrl(p))}" target="_blank" rel="noopener">Яндекс Карты</a>`}
        </div>
        <label class="book-done"><input type="checkbox"${done ? ' checked' : ''}> ${GF('Забронировала', 'Забронировал')} ✓</label>
      </div></div>`;
  }
  function wireBook(root) {
    const w = root && root.querySelector('.book-wrap');
    if (!w) return;
    const open = w.querySelector('.book-open'), box = w.querySelector('.book-box');
    open.onclick = () => { Sfx.click(); const on = box.classList.toggle('hidden'); open.setAttribute('aria-expanded', String(!on)); };
    w.querySelector('.book-copy').onclick = () => copyText(box.dataset.text).then(ok => toast(ok ? 'Текст скопирован' : 'Не получилось скопировать'));
    w.querySelector('.book-done input').onchange = e => { S.sent = S.sent || {}; S.sent.booked = e.target.checked ? (S.a.name || INV.me || '✓') : ''; save(); toast(e.target.checked ? 'Отметили: забронировано' : 'Отметку сняли'); };
  }
  /* Текст через «Поделиться», а где его нет или он не сработал — в буфер обмена */
  function sendText(text, okMsg) {
    if (navigator.share) {
      navigator.share({ text }).catch(e => { if (!e || e.name !== 'AbortError') copyText(text).then(ok => toast(ok ? okMsg : 'Не получилось скопировать')); });
      return;
    }
    copyText(text).then(ok => toast(ok ? okMsg : 'Не получилось скопировать'));
  }
  /* Текст подруге: место, день, время, кто позвал (как он сам вписал имя) и маршрут */
  function friendText(plan) {
    const L = [GF('Иду на свидание 💕', 'Иду на свидание 💕')];
    if (INV.me && INV.me !== '?') L.push('С кем: ' + INV.me);
    for (const [i, , l, v] of answerRows(true)) L.push(`${i} ${l}: ${v}`);
    if (plan) L.push('🗺 Маршрут: ' + K.goRoute(plan.id));
    return L.join('\n');
  }
  /* Картинка-билет для сторис: без имён — только план, день и время; QR — на маршрут или на сайт */
  function ticketCard(plan, ev, when) {
    const stopOf = p => ({ emoji: p.emoji, name: p.name, meta: K.metroText(p.metro), lat: p.lat, lon: p.lon });
    const stops = plan ? K.planStops(plan).map(stopOf) : ev ? [{ emoji: ev.emoji || '🎫', name: ev.title, meta: ev.venue || '' }]
      : S.a.place && S.a.place.title ? [{ emoji: S.a.place.emoji || '📍', name: S.a.place.title, meta: '' }] : [];
    const c = K.cityConf(K.cityOf(plan || ev || {}));
    return { title: plan ? plan.title : ev ? ev.title : 'Иду на свидание', sub: when, stops, mode: 'date', city: c ? c.name : '',
      url: plan ? K.goRoute(plan.id) : hubUrl(''), fileName: 'svidanie' };
  }
  function shareAnswer() {
    if (PREVIEW) { toast('Это превью — ответ никуда не отправляется'); return; }
    prepareTicket();
    const text = summary(false) + (CODE && ticket.url ? '\n\nМой билет: ' + ticket.url : '');
    const u = hostTg();
    if (u) {
      copyText(text);   // запасной путь, если Telegram не подставит текст сам
      toast('Открываю Telegram — ответ уже в поле сообщения');
      setTimeout(() => { location.href = K.tgLink(u, text); }, 700);
      return;
    }
    if (navigator.share) {
      navigator.share({ text }).catch(e => { if (!e || e.name !== 'AbortError') copyAnswer(text); });
      return;
    }
    copyAnswer(text);
  }
  async function copyAnswer(text) {
    const ok = await copyText(text);
    toast(ok ? 'Ответ скопирован! Отправь его в личку 💌' : 'Сделай скриншот билета и отправь его 📸');
  }

  const baseUrl = () => location.href.split('#')[0].replace(/[?].*$/, '');
  /* Своя короткая ссылка go.html#s=… (свой сервер, затем посредник): её раскрывают и go.html, и «Объединить».
     '' — не вышло. Сокращатели вроде clck.ru здесь не берём: ссылку с голосами из них не достать */
  const SHORT_MEMO = new Map();
  async function ownShort(long) {
    if (SHORT_MEMO.has(long)) return SHORT_MEMO.get(long);
    if (API_ON) {
      const code = await api('short', long);
      if (typeof code === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(code)) {
        const url = K.sitePath('go.html') + '#s=' + code;
        SHORT_MEMO.set(long, url);
        return url;
      }
    }
    if (TG.relayUrl) {
      const s = await K.shortLink(long);
      if (/go\.html#s=[A-Za-z0-9_-]{1,16}$/.test(s || '')) return s;
    }
    return '';
  }
  /* Для билета подойдёт любая короткая ссылка — её открывает человек, а не «Объединить» */
  const shortAny = long => ownShort(long).catch(() => '').then(s => s || K.shortLink(long));
  function stopsLine(plan) {
    const st = K.planStops(plan);
    if (!st.length) return '';
    if (st.length === 1) return (st[0].name === plan.title ? '' : st[0].name + ' · ') + K.metroText(st[0].metro);
    let walk = 0;
    for (let i = 1; i < st.length; i++) walk += K.walkMin(st[i - 1], st[i]);
    return st.map(p => p.name).join(' → ') + (st.length > 1 ? ` · ${walk} мин пешком` : '');
  }
  /* «Успеть домой»: выбранные день и время + план → до скольки вход в метро, разводка мостов в Петербурге */
  function homeRiskBlock(plan, time, day) {
    if (!K.homeRisk || !time) return '';
    const r = K.homeRisk(K.planStops(plan), time, day || K.todayMsk(), K.cityOf(plan));
    return r.length ? `<div class="home-risk">${r.map(x => `<p>${esc(x.text)}</p>`).join('')}</div>` : '';
  }
  function planBlock(plan) {
    const st = K.planStops(plan);
    if (!st.length) return '';
    return `<div class="plan-links">
      ${st.map(p => `<a class="chip-link" href="${K.mapUrl(p)}" target="_blank" rel="noopener">${I('pin')}${esc(p.name)}</a>`).join('')}
      <a class="chip-link" href="${K.routeUrl(st)}" target="_blank" rel="noopener">${I('route')}Маршрут</a>
    </div>`;
  }

  const placeLoc = plan => { const p = K.planStops(plan)[0]; return p ? [p.name, p.addr, locCity(p, p.addr)].filter(Boolean).join(', ') : ''; };
  const planDetails = plan => {
    const st = K.planStops(plan);
    return st.length ? stopsLine(plan) + '\nМаршрут: ' + K.goRoute(plan.id) : '';
  };
  /* .ics лежит в Blob: старые ссылки освобождаем при перерисовке итогов */
  let CAL_URLS = [];
  function revokeCal() {
    CAL_URLS.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) { /* ок */ } });
    CAL_URLS = [];
  }
  function calBlock(ev) {
    let c;
    try { c = K.calendarLinks(ev); } catch (e) { return ''; }
    if (/^blob:/.test(c.ics)) CAL_URLS.push(c.ics);
    return `<div class="plan-links cal-links">
      <a class="chip-link" href="${c.ics}" download="kuda-idem.ics">${I('calendar')}В календарь</a>
      <a class="chip-link" href="${c.google}" target="_blank" rel="noopener">${I('calendar')}Google Календарь</a>
    </div>`;
  }

  /* ================= Навигация ================= */
  let current = null, cleanup = null, CUR = 0;
  function go(i) {
    CUR = clamp(i, 0, STEPS.length - 1);
    const step = STEPS[CUR];
    if (step.id !== 'intro') { S.step = CUR; save(); }
    mount(step, () => go(CUR + 1));
    renderProgress();
  }
  function showScreen(id, run) {
    mount({ id, run }, () => {});
    const box = $('#progress');
    box.innerHTML = '';
    box.removeAttribute('aria-label');
    box.setAttribute('aria-hidden', 'true');   // полоски уровней на итогах не показываем
  }
  function mount(step, next) {
    if (cleanup) { try { cleanup(); } catch (e) { /* ок */ } cleanup = null; }
    const el = document.createElement('section');
    el.className = 'screen s-' + step.id + ' enter';
    el.addEventListener('animationend', function done(e) {
      if (e.target !== el) return;
      el.classList.remove('enter');
      el.removeEventListener('animationend', done);
    });
    const old = current;
    current = el;
    // уходящий экран — под новым, без касаний и фокуса: его кнопки («Дальше» поверх оверлея) не просвечивают и не ловят тапы
    if (old) {
      old.classList.remove('enter'); old.classList.add('leave');
      old.setAttribute('aria-hidden', 'true');
      try { old.inert = true; } catch (e) { /* старый браузер */ }
      setTimeout(() => old.remove(), 380);
    }
    stage.appendChild(el);
    cleanup = step.run(el, next, step) || null;
    // фокус был на кнопке ушедшего экрана — ставим его на заголовок нового: читалка объявит уровень, Tab пойдёт отсюда
    if (old && current === el) refocus($('h1, h2', el));
  }
  function renderProgress() {
    const box = $('#progress');
    box.innerHTML = STEPS.filter(s => s.level).map(s => {
      const i = STEPS.indexOf(s);
      const cls = i < CUR ? 'done' : i === CUR ? 'now' : '';
      return `<span class="pg ${cls}"></span>`;
    }).join('');
    box.removeAttribute('aria-hidden');
    box.setAttribute('aria-label', CUR > 0 ? `Уровень ${Math.min(CUR, LEVEL_COUNT)} из ${LEVEL_COUNT}` : `Уровней в игре: ${LEVEL_COUNT}`);
  }

  /* ================= Экран: приветствие ================= */
  function scrIntro(el, next) {
    if (GROUP) return scrIntroGroup(el, next);
    const resume = RESUME > 0 && RESUME < STEPS.length;
    el.innerHTML = `
      <div>
        <span class="badge">Только для тебя</span>
        <h1 class="title">Привет,<br><span class="hl">${esc(INV.her)}</span></h1>
      </div>
      <div class="intro-mid">
        <div class="bubble b-down" id="greet"></div>
        <div class="intro-cat">${K.catSVG('normal', 'waving')}</div>
      </div>
      <div class="actions">
        ${EV_PAST ? `<p class="hint">Событие «${esc(EV_PAST.title)}» уже прошло — но встретиться можно и без него 😉</p>` : ''}
        <button class="btn btn-primary btn-xl pulse" id="go">${resume ? 'Продолжить' : 'Начать игру'}${I('arrow')}</button>
        <p class="hint">${I('sound')}Со звуком веселее</p>
      </div>`;
    const t = setTimeout(() => typeInto($('#greet', el), resume ? `С возвращением! Продолжим с того места, где остановились 😊` : T(INV.greeting)), 380);
    $('#go', el).onclick = () => {
      Sfx.init(); Sfx.click();
      if (resume) { RESUME = 0; go(RESUME_TARGET); } else next();
    };
    return () => clearTimeout(t);
  }
  let RESUME_TARGET = 1;

  function scrIntroGroup(el, next) {
    el.innerHTML = `
      <div>
        <span class="badge">${esc(MC.label)} · зовёт ${esc(INV.me)}</span>
        <h1 class="title"><span class="hl">${esc(groupTitle())}</span></h1>
      </div>
      <div class="intro-mid">
        <div class="bubble b-down" id="greet"></div>
        <div class="intro-cat">${K.catSVG('normal', 'waving')}</div>
      </div>
      <div class="actions"></div>`;
    const acts = $('.actions', el);
    let last = '';
    // голоса с сервера и из других вкладок приходят позже — перерисовываем только низ экрана
    function paint() {
      const my = myVote();
      // пока сервер не ответил (или голос сохраняется) — не пугаем: через секунду может оказаться, что всё уже сохранено
      const unsent = my && !voteSaved() && !voteSent() && VOTE_STATE !== 'saving' && !(live() && !SYNC);
      const html = `
        ${unsent ? `<button class="vs-remind" id="remind">${I('send')}<span>Твой голос пока только у тебя — отправь ссылку в чат, иначе остальные его не увидят</span>${I('arrow')}</button>` : ''}
        ${PRIOR.length ? `<p class="hint">Уже отметились (${PRIOR.length}): ${esc(PRIOR.map(v => v.n).join(', '))}</p>` : ''}
        <button class="btn btn-primary btn-xl pulse" id="go">${my ? 'Изменить голос' : 'Погнали'}${I('arrow')}</button>
        ${PRIOR.length ? `<button class="link-btn" id="res">${I('users')}Посмотреть итоги</button>` : `<p class="hint">${I('sound')}Со звуком веселее</p>`}`;
      if (html === last) return;
      last = html;
      const fk = focusKey(acts);
      acts.innerHTML = html;
      $('#go', el).onclick = () => {
        Sfx.init(); Sfx.click();
        if (myVote()) revote(); else { S.a = freshAnswers(); restep(); next(); }
      };
      const res = $('#res', el), rem = $('#remind', el);
      if (res) res.onclick = () => { Sfx.click(); showResults(false); };
      if (rem) rem.onclick = () => { Sfx.init(); Sfx.click(); showResults(false); };
      restoreFocus(acts, fk, '#go');
    }
    paint();
    const off = onVotes(paint);
    const t = setTimeout(() => typeInto($('#greet', el), T(MT('greeting'))), 380);
    return () => { clearTimeout(t); off(); };
  }

  /* ================= Уровень: поймай сердечки ================= */
  function lvlHearts(el, next, step) {
    const goal = clamp(parseInt(INV.heartsGoal, 10) || 12, 3, 50);
    const emo = e => `<span class="emo">${e}</span>`;
    const legend = GROUP
      ? `<div>${emo(MC.good.slice(0, 3).join(''))} <span>+1</span></div><div>${emo(MC.gold)} <span>+3 джекпот!</span></div><div>${emo(MC.bad)} <span>−1 мимо</span></div>`
      : `<div>${heartSVG('pink')} <span>+1</span></div><div>${heartSVG('gold')} <span>+3 золотое!</span></div><div>${heartSVG('broken')} <span>−1 разбитое</span></div>`;
    el.innerHTML = `
      ${head(step, GROUP ? MC.catchTitle : 'Поймай сердечки', GROUP ? `Води котика пальцем и собери <b>${goal}</b> штук` : `Води котика пальцем и собери <b>${goal}</b> ${plural(goal, 'сердечко', 'сердечка', 'сердечек')}`)}
      <div class="meter"><div class="meter-bar"><i></i></div><b class="meter-num">0 / ${goal}</b></div>
      <div class="pf">
        <div class="catcher"><div class="cat-slot">${K.catSVG('normal')}</div><div class="basket">${BASKET()}</div></div>
        <div class="pf-hand hidden"></div>
        <div class="pf-overlay"><div class="pf-card">
          <div class="legend">${legend}</div>
          <button class="btn btn-primary" id="play">Поехали${I('arrow')}</button>
        </div></div>
      </div>`;
    const pf = $('.pf', el), catcher = $('.catcher', el), basket = $('.basket', el);
    const bar = $('.meter-bar i', el), num = $('.meter-num', el), hand = $('.pf-hand', el);
    let W = 0, H = 0, catX = 0, targetX = 0, items = [], running = false, raf = 0, last = 0, spawnIn = 0.3, score = 0, t = 0, moved = false;
    const CW = 112;
    function measure() { W = pf.clientWidth; H = pf.clientHeight; }
    measure();
    catX = targetX = W / 2;
    catcher.style.transform = `translate3d(${catX - CW / 2}px,0,0)`;
    const onResize = () => { measure(); targetX = clamp(targetX, CW / 2, W - CW / 2); };
    addEventListener('resize', onResize);

    function onPtr(e) {
      const r = pf.getBoundingClientRect();
      targetX = clamp((e.clientX - r.left) * (W / r.width), CW / 2 - 10, W - CW / 2 + 10);
      if (!moved) { moved = true; hand.classList.add('hidden'); }
    }
    pf.addEventListener('pointerdown', onPtr);
    pf.addEventListener('pointermove', onPtr);
    const onKey = e => {
      if (e.key === 'ArrowLeft') targetX = clamp(targetX - 50, CW / 2, W - CW / 2);
      if (e.key === 'ArrowRight') targetX = clamp(targetX + 50, CW / 2, W - CW / 2);
    };
    addEventListener('keydown', onKey);

    function spawn() {
      const r = Math.random();
      const type = r < 0.1 ? 'gold' : r < 0.24 ? 'broken' : 'pink';
      const size = type === 'gold' ? 42 : rand(32, 42);
      const d = document.createElement('div');
      d.className = 'fall f-' + type;
      d.style.width = d.style.height = size + 'px';
      d.innerHTML = GROUP
        ? emo(type === 'gold' ? MC.gold : type === 'broken' ? MC.bad : MC.good[(Math.random() * MC.good.length) | 0])
        : heartSVG(type, type === 'pink' ? rand(0.75, 1).toFixed(2) : 0);
      pf.appendChild(d);
      const speed = rand(150, 195) * (1 + score * 0.025) * clamp(H / 520, 0.8, 1.3);
      items.push({ el: d, type, x0: rand(24, W - 24), x: 0, y: -30, v: speed, a: rand(6, 22), f: rand(1.4, 3), ph: rand(0, 6.28), size });
    }
    function floatText(x, y, text, minus) {
      const f = document.createElement('div');
      f.className = 'plus' + (minus ? ' minus' : '');
      f.textContent = text;
      f.style.left = x + 'px'; f.style.top = y + 'px';
      pf.appendChild(f);
      setTimeout(() => f.remove(), 850);
    }
    function setScore(v) {
      score = clamp(v, 0, goal);
      bar.style.width = (score / goal * 100) + '%';
      num.textContent = score + ' / ' + goal;
    }
    function grab(it) {
      it.el.remove();
      const top = H - catcher.offsetHeight;
      const pr = pf.getBoundingClientRect(), k = pr.width / W;
      if (it.type === 'broken') {
        setScore(score - 1);
        floatText(it.x, top, '−1', true);
        Sfx.bad(); vibrate(40);
        mood(el, 'sad', 800);
        catcher.classList.remove('shake'); void catcher.offsetWidth; catcher.classList.add('shake');
        return;
      }
      const add = it.type === 'gold' ? 3 : 1;
      setScore(score + add);
      floatText(it.x, top, '+' + add);
      if (add > 1) Sfx.gold(); else Sfx.catch();
      vibrate(12);
      mood(el, add > 1 ? 'love' : 'happy', 600);
      basket.classList.remove('bump'); void basket.offsetWidth; basket.classList.add('bump');
      FX.burst({ x: pr.left + it.x * k, y: pr.top + top * k + 20, n: add > 1 ? 26 : 10, power: 0.45, scale: 0.8, shapes: ['heart', 'dot'] });
      if (score >= goal) win();
    }
    function loop(ts) {
      if (!running) return;
      const dt = Math.min(0.05, (ts - last) / 1000 || 0);
      last = ts; t += dt;
      catX += (targetX - catX) * Math.min(1, dt * 14);
      const tilt = clamp((targetX - catX) * 0.12, -12, 12);
      catcher.style.transform = `translate3d(${catX - CW / 2}px,0,0) rotate(${tilt}deg)`;
      spawnIn -= dt;
      if (spawnIn <= 0) { spawn(); spawnIn = rand(0.5, 0.8) * Math.max(0.55, 1 - score * 0.025); }
      const top = H - catcher.offsetHeight + 16;
      const bottom = H - 8;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        it.y += it.v * dt;
        it.x = clamp(it.x0 + Math.sin(t * it.f + it.ph) * it.a, 16, W - 16);
        it.el.style.transform = `translate3d(${it.x - it.size / 2}px,${it.y - it.size / 2}px,0) rotate(${Math.sin(t * 2 + it.ph) * 14}deg)`;
        if (it.y > top && it.y < bottom && Math.abs(it.x - catX) < 50) {
          items.splice(i, 1);
          grab(it);
          if (!running) return;
          continue;
        }
        if (it.y > H + 40) { it.el.remove(); items.splice(i, 1); }
      }
      raf = requestAnimationFrame(loop);
    }
    function win() {
      running = false;
      cancelAnimationFrame(raf);
      items.forEach(it => it.el.remove());
      items = [];
      S.a.hearts = score;
      save();
      mood(el, 'love');
      Sfx.fanfare(); vibrate([20, 40, 20]);
      const r = pf.getBoundingClientRect();
      FX.burst({ x: r.left + r.width / 2, y: r.top + r.height * 0.55, n: 110 });
      const ov = document.createElement('div');
      ov.className = 'pf-overlay';
      ov.innerHTML = `<div class="pf-card">
          <span class="win-ic">${I('check')}</span>
          <h3>Уровень пройден!</h3>
          <p class="sub">${GROUP ? `Собрано ${score} — можно открывать приглашение` : `Ты ${GF('собрала', 'собрал')} ${score} — этого хватит, чтобы открыть секретное письмо`}</p>
          <button class="btn btn-primary">Дальше${I('arrow')}</button></div>`;
      pf.appendChild(ov);
      $('button', ov).onclick = () => { Sfx.click(); next(); };
      refocus($('button', ov));
    }
    $('#play', el).onclick = () => {
      Sfx.init(); Sfx.click();
      measure();
      $('.pf-overlay', el).remove();
      moved = false;
      hand.classList.remove('hidden');
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      removeEventListener('resize', onResize);
      removeEventListener('keydown', onKey);
    };
  }

  /* ================= Уровень: письмо с вопросом ================= */
  function lvlLetter(el, next, step) {
    el.innerHTML = `
      ${head(step, 'Секретное письмо', 'Нажми на печать, чтобы открыть')}
      <div class="env-area">
        <div class="envelope">
          <div class="env-back"></div>
          <div class="env-paper">${esc(GROUP ? groupTitle() : INV.her)}</div>
          <div class="env-front"></div>
          <div class="env-flap"></div>
          <button class="seal" aria-label="Открыть письмо"><svg viewBox="0 0 24 24"><path d="${K.markD(MODE)}" fill="currentColor"/></svg></button>
          <span class="tap-hint"></span>
        </div>
      </div>
      <div class="letter-cat"><div class="cat-slot">${K.catSVG('normal')}</div><div class="bubble b-left">${GROUP ? 'Тебе приглашение! Открывай 👀' : 'Тебе письмо! Открывай скорее 🥺'}</div></div>`;
    const bub = $('.letter-cat .bubble', el);
    let timers = [];
    $('.seal', el).onclick = async () => {
      Sfx.init(); Sfx.pop(); vibrate(15);
      $('.seal', el).classList.add('crack');
      const hint = $('.tap-hint', el); if (hint) hint.remove();
      const env = $('.envelope', el);
      env.classList.add('open');
      mood(el, 'wow');
      setTimeout(() => Sfx.whoosh(), 350);
      await sleep(1300);
      env.classList.add('out');
      await sleep(430);
      $('.env-area', el).innerHTML = `
        <div class="letter">
          <div class="letter-stamp"><svg viewBox="0 0 24 24"><path d="${K.markD(MODE)}"/></svg></div>
          <p class="l-to">${GROUP ? 'Привет!' : esc(INV.her) + ','}</p>
          <p class="l-q">${esc(T(GROUP ? MT('question') : INV.question))}</p>
          <p class="l-sign">${esc(GROUP ? '— ' + INV.me : T(INV.signature))}</p>
          <div class="yn"><button class="btn btn-primary yes">${esc(GROUP ? MC.yes : 'Да')}</button><button class="btn btn-soft no">${esc(GROUP ? MC.no : 'Нет')}</button></div>
        </div>`;
      $('.lvl-head .sub', el).textContent = 'Ответь честно 😇';
      mood(el, 'normal');
      say(bub, 'Ну что? Я жду ответа… 👀');
      wire();
      // печать с фокусом исчезла вместе с конвертом — фокус на «Да»
      refocus($('.yes', el));
    };

    function wire() {
      const yes = $('.yes', el), no = $('.no', el);
      const NO_TEXT = ['Нет', 'Точно нет?', 'Подумай ещё 🤔', GF('Промахнулась 😜', 'Промахнулся 😜'), 'Не-а 🙃', 'Я убегаю!', 'Ну пожааалуйста 🥺', 'Кнопка устала 🙈'];
      const CAT_TEXT = ['Эй! 😳', GF('Ты точно подумала?', 'Ты точно подумал?'), 'У меня сейчас слёзки потекут…', 'Нажми «Да», тебе понравится 😊', 'Кнопка «Нет» явно против 😅', 'Ну пожалуйста-пожалуйста 🥹', 'Последний шанс нажать «Да»!', 'Ой, а «Нет» закончилось 😇'];
      let tries = 0, lastDodge = 0;
      // в компании «Не смогу» — всегда настоящая кнопка, даже в старых ссылках с убегающей «Нет»
      const real = GROUP || INV.noButton === 'real';

      function dodge(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        if (no.classList.contains('gone')) return;
        lastDodge = Date.now();
        tries++;
        S.a.noTries = tries; save();
        Sfx.whoosh(); vibrate(8);
        const sr = el.getBoundingClientRect(), br = no.getBoundingClientRect(), yr = yes.getBoundingClientRect();
        const sx = el.clientWidth / sr.width || 1;
        if (!no.classList.contains('free')) {
          no.style.left = (br.left - sr.left) * sx + 'px';
          no.style.top = (br.top - sr.top) * sx + el.scrollTop + 'px';
          no.classList.add('free');
          el.appendChild(no);
          void no.offsetWidth;
        }
        no.textContent = NO_TEXT[Math.min(tries, NO_TEXT.length - 1)];
        const w = no.offsetWidth, h = no.offsetHeight, W = el.clientWidth, H = el.clientHeight;
        const pad = 26;
        const yb = { l: (yr.left - sr.left) * sx - pad, t: (yr.top - sr.top) * sx - pad, r: (yr.right - sr.left) * sx + pad, b: (yr.bottom - sr.top) * sx + pad };
        const cx = parseFloat(no.style.left), cy = parseFloat(no.style.top);
        let x, y, k = 0;
        do {
          x = rand(10, Math.max(12, W - w - 10));
          y = rand(H * 0.1, Math.max(H * 0.1 + 1, H - h - 20));
          k++;
        } while (k < 50 && ((x < yb.r && x + w > yb.l && y < yb.b && y + h > yb.t) || Math.hypot(x - cx, y - cy) < 100));
        no.style.left = x + 'px';
        no.style.top = y + 'px';
        yes.style.setProperty('--s', (1 + Math.min(tries, 8) * 0.08).toFixed(2));
        say(bub, CAT_TEXT[Math.min(tries - 1, CAT_TEXT.length - 1)]);
        mood(el, tries >= 3 ? 'sad' : 'wow');
        if (tries >= 8) { no.classList.add('gone'); no.disabled = true; mood(el, 'happy'); }
      }

      // в компании «Не смогу» сразу ведёт к имени: иначе тот, кто не может, не отметится
      if (GROUP) {
        no.onclick = () => {
          if (no.disabled) return;
          no.disabled = true;
          S.a.coming = false; S.a.opts = []; S.a.days = []; save();
          Sfx.sad(); mood(el, 'sad');
          say(bub, 'Жаль 😢 Но отметься — так всем будет понятно');
          timers.push(setTimeout(() => go(STEPS.length - 1), 1100));
        };
      } else if (real) {
        no.onclick = () => {
          S.a.noTries++; save();
          Sfx.sad(); mood(el, 'sad');
          say(bub, 'Хорошо… Я всё передам 🥺 Но если передумаешь — «Да» всё ещё здесь');
          if (!S.sent.no) { S.sent.no = true; save(); notify('no'); }
          if (live() && !S.sent.ansNo) saveAnswer({ yes: false, no: true, noTries: S.a.noTries | 0 }).then(ok => { if (ok) { S.sent.ansNo = true; save(); } });
        };
      } else {
        no.addEventListener('pointerdown', dodge);
        no.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') dodge(e); });
        no.addEventListener('click', e => { e.preventDefault(); if (Date.now() - lastDodge > 450) dodge(e); });
      }

      yes.onclick = () => {
        if (yes.disabled) return;
        yes.disabled = true;
        S.a.yes = true; if (GROUP) S.a.coming = true; save();
        Sfx.success(); vibrate([30, 50, 30]);
        // спрятанная «Нет» / «Не смогу» не должна ловить Tab и Enter: иначе после «Да» с клавиатуры уйдёт отказ
        no.classList.add('gone'); no.disabled = true;
        FX.burst({ n: 150, power: 1.25 });
        timers.push(setTimeout(() => FX.rain(45), 450));
        if (!GROUP && TG.notifyYes !== false && !S.sent.yes) notify('yes').then(ok => { if (ok) { S.sent.yes = true; save(); } });
        const ov = document.createElement('div');
        ov.className = 'celebrate';
        ov.innerHTML = `
          <svg class="big-heart" viewBox="0 0 24 24"><path d="${K.markD(MODE)}"/></svg>
          <h2>${GROUP ? 'Йееес!' : 'Ураааа!'}</h2>
          <p>${GROUP ? `${esc(INV.catName)} уже в предвкушении 🎉 Осталось решить, куда и когда!` : `${esc(INV.catName)} танцует от счастья 💃 Осталось выбрать детали!`}</p>
          <div class="cat-slot">${K.catSVG(LOVE())}</div>
          <button class="btn btn-primary btn-xl">Дальше${I('arrow')}</button>`;
        el.appendChild(ov);
        $('button', ov).onclick = () => { Sfx.click(); next(); };
        refocus($('button', ov));
      };
    }
    return () => timers.forEach(clearTimeout);
  }

  /* ================= Уровень: шарики с местами (или карточка события) ================= */
  /* Места из приглашения: свои, готовые планы, «Сюрприз», «Свой вариант» */
  function placeOpts() {
    const opts = (INV.places || []).filter(p => p && (p.title || K.planById(p.plan))).map(p => {
      const pl = p.plan ? K.planById(p.plan) : null;
      return { emoji: p.emoji || (pl && pl.emoji) || '📍', title: p.title || pl.title, note: p.note || (pl && pl.why) || '', plan: pl ? pl.id : '', ph: pl ? K.planPhoto(pl) : null };
    });
    if (INV.placeSurprise) opts.push({ emoji: '🎁', title: 'Сюрприз', note: `Место выберет ${INV.me} — и не скажет куда 🤫`, kind: 'surprise' });
    if (INV.placeCustom) opts.push({ emoji: '✍️', title: 'Свой вариант', note: 'Напиши, куда тебе хочется', kind: 'custom' });
    return opts;
  }
  function lvlPlace(el, next, step) {
    let stop = null;
    const done = () => { save(); restep(); next(); };
    // смена вида по кнопке — фокус на новый заголовок (первый вид фокусирует mount)
    const swap = (f, focus) => { if (stop) stop(); stop = f(); if (focus) refocus($('h2', el)); };
    if (EVENT) swap(eventView); else swap(balloonView);
    return () => { if (stop) stop(); };

    function eventView() {
      const ev = EVENT, ph = evPhoto(ev), price = evPrice(ev), url = evUrl(ev), alt = placeOpts().length > 0;
      const cat = [EV_CAT[ev.cat], ev.age].filter(Boolean).join(' · ');
      el.innerHTML = `
        ${head(step, 'Куда пойдём?', `${esc(INV.me)} зовёт тебя сюда`)}
        <article class="ev-card">
          ${ph ? `<figure class="sheet-ph"><img src="${esc(ph.s)}" alt="" decoding="async"><figcaption>${K.photoCredit(ph)}</figcaption></figure>`
            : `<div class="ev-cover c-${esc(ev.cat || 'show')}" aria-hidden="true"><span>${esc(ev.emoji || '🎫')}</span></div>`}
          ${cat ? `<p class="eyebrow">${esc(cat)}</p>` : ''}
          <h3>${esc(ev.title)}</h3>
          <ul class="ev-facts">
            <li>${I('calendar')}<span>${esc(evWhen(ev, EV_DAYS))}</span></li>
            ${evPlaceLine(ev) ? `<li>${I('pin')}<span>${esc(evPlaceLine(ev))}</span></li>` : ''}
            ${price ? `<li>${TICKET}<span>${esc(price)}</span></li>` : ''}
          </ul>
          ${ev.note ? `<p class="ev-note">${esc(ev.note)}</p>` : ''}
          ${url ? `<a class="chip-link" href="${esc(url)}" target="_blank" rel="noopener nofollow">${I('ext')}Подробнее о событии<span class="vh"> — сайт организатора</span></a>` : ''}
        </article>
        <div class="actions">
          <button class="btn btn-primary btn-xl btn-wide pulse ev-go">Пойдём!${I('heart')}</button>
          ${alt ? `<button class="link-btn ev-alt">${I('redo')}Давай другое</button>` : ''}
        </div>`;
      let timer = 0;
      $('.ev-go', el).onclick = e => {
        const b = e.currentTarget;
        if (b.disabled) return;
        b.disabled = true;
        Sfx.init(); Sfx.success(); vibrate([20, 40, 20]);
        const r = b.getBoundingClientRect();
        FX.burst({ x: r.left + r.width / 2, y: r.top, n: 70, power: 0.8 });
        S.a.place = evPick(ev);
        applyEvent();
        timer = setTimeout(done, 450);
      };
      const altBtn = $('.ev-alt', el);
      if (altBtn) altBtn.onclick = () => { Sfx.click(); swap(balloonView, true); };
      return () => clearTimeout(timer);
    }

    function balloonView() {
      const opts = placeOpts();
      const cols = opts.length <= 4 ? 2 : 3;
      el.innerHTML = `
        ${head(step, 'Куда пойдём?', 'Лопни шарик с местом, которое нравится')}
        <div class="balloons c${cols}" style="--cols:${cols}">${opts.map((o, i) => `
          <button class="balloon" data-i="${i}" style="--dur:${rand(2.4, 3.6).toFixed(2)}s;--d:${(-rand(0, 3)).toFixed(2)}s">
            <span class="bl-in" style="--id:${(i * 0.07).toFixed(2)}s">
              <span class="bl-body">${balloonSVG(BCOL[i % BCOL.length])}<span class="bl-emoji">${esc(o.emoji)}</span></span>
              <span class="bl-label">${esc(o.title)}</span>
            </span>
          </button>`).join('')}
        </div>
        ${EVENT ? `<button class="link-btn ev-back">${I('arrow')}Всё-таки «${esc(EVENT.title)}»</button>` : ''}`;
      const back = $('.ev-back', el);
      if (back) back.onclick = () => { Sfx.click(); S.a.place = null; save(); swap(eventView, true); };
      let busy = false, timer = 0, picked = null;
      const box = $('.balloons', el);
      box.addEventListener('click', e => {
        const b = e.target.closest('.balloon');
        if (!b || busy) return;
        busy = true;
        picked = b;
        const i = +b.dataset.i, o = opts[i];
        Sfx.init(); Sfx.pop(); vibrate(20);
        const r = $('.bl-body', b).getBoundingClientRect();
        FX.burst({ x: r.left + r.width / 2, y: r.top + r.height * 0.38, n: 44, power: 0.7, colors: [BCOL[i % BCOL.length], '#ffffff', BCOL[(i + 3) % BCOL.length]] });
        b.classList.add('pop');
        $$('.balloon', el).forEach(x => {
          if (x === b) return;
          x.style.setProperty('--fd', rand(0, 0.25).toFixed(2) + 's');
          x.classList.add('fly');
        });
        timer = setTimeout(() => sheet(o), 480);
      });
      function sheet(o) {
        S.a.place = { emoji: o.emoji, title: o.title, kind: o.kind || '', plan: o.plan || '' };
        save();
        const sh = document.createElement('div');
        sh.className = 'sheet';
        sh.innerHTML = `
          ${o.ph ? `<figure class="sheet-ph"><img src="${esc(o.ph.s)}" alt="${esc(o.title)}" decoding="async"><figcaption>${K.photoCredit(o.ph)}</figcaption></figure>` : `<div class="sheet-emoji">${esc(o.emoji)}</div>`}
          <h3>${esc(o.title)}</h3>
          ${o.note ? `<p>${esc(T(o.note))}</p>` : ''}
          ${o.plan ? `<p class="opt-stops">${esc(stopsLine(K.planById(o.plan)))}</p>` : ''}
          ${o.kind === 'custom' ? `<input class="field" maxlength="80" placeholder="Например: каток в парке" aria-label="Куда тебе хочется" value="${esc(S.a.placeText)}">` : ''}
          <div class="row"><button class="btn btn-soft again">${I('redo')}Другое</button><button class="btn btn-primary ok">Дальше${I('arrow')}</button></div>`;
        el.appendChild(sh);
        // улетевшие шарики — невидимые кнопки: пока открыта карточка, их нет ни для Tab, ни для читалки; фокус — на карточку
        box.setAttribute('inert', '');
        refocus($('h3', sh));
        Sfx.catch();
        const inp = $('input', sh), ok = $('.ok', sh);
        if (inp) {
          ok.disabled = !inp.value.trim();
          inp.oninput = () => { ok.disabled = !inp.value.trim(); };
        }
        $('.again', sh).onclick = () => { Sfx.click(); sh.remove(); reset(); };
        ok.onclick = () => {
          if (ok.disabled) return;
          if (inp) S.a.placeText = inp.value.trim();
          if (EVENT) dropEvent();
          Sfx.click(); done();
        };
      }
      function reset() {
        busy = false;
        S.a.place = null; save();
        box.removeAttribute('inert');
        $$('.balloon', el).forEach(x => {
          x.classList.remove('pop', 'fly');
          const bi = $('.bl-in', x);
          bi.style.animation = 'none';
          void bi.offsetWidth;
          bi.style.animation = '';
        });
        refocus(picked);
      }
      return () => clearTimeout(timer);
    }
  }

  /* ================= Уровень: календарь ================= */
  function dayComment(d) {
    // «завтра» — по Москве, как и сами даты приглашения
    const today = K.parseYmd(todayYmd());
    if (today && +d === +today) return 'Прямо сегодня? Вот это настрой 🔥';
    if (today && +d === +K.addDays(today, 1)) return 'Уже завтра?! Вот это да 😍';
    const w = d.getDay();
    if (w === 5) return 'Пятница — идеальный день для свидания 😏';
    if (w === 6 || w === 0) return 'Выходной — можно гулять хоть до ночи ✨';
    return 'Отличный вечер после рабочего дня 🌇';
  }
  /* Дни для календаря: событие из афиши, события-варианты компании или даты из приглашения */
  function dayOptions() {
    if (!GROUP) return evChosen() ? EV_DAYS : K.listDates(INV.dates);
    return groupDays();
  }
  /* Компания: если все варианты, за которые голос (или все вообще, если голоса «за» нет), — события, предлагаем только их дни */
  function groupDays() {
    const items = optItems();
    const liked = (S.a.opts || []).filter(i => items[i]);
    const pool = (liked.length ? liked : items.map((_, i) => i)).map(i => items[i]);
    if (pool.length && pool.every(o => o.event)) {
      const all = new Set();
      pool.forEach(o => evDays(eventById(o.event)).forEach(d => all.add(d)));
      if (all.size) return Array.from(all).sort().slice(0, 42);
    }
    return K.listDates(INV.dates);
  }
  function lvlDate(el, next, step) {
    const days = dayOptions();
    const multi = GROUP;
    // все даты прошли — шаг пропускаем, календаря без дней не показываем
    if (multi && !days.length) {
      S.a.days = []; save();
      const t = setTimeout(next, 0);
      return () => clearTimeout(t);
    }
    // свидание с выбранным планом: дни, когда какая-то остановка не работает (часы oh), — серые с подписью «выходной»
    const pl = !GROUP && S.a.place && S.a.place.plan ? K.planById(S.a.place.plan) : null;
    const stops = pl ? K.planStops(pl) : [];
    const shut = d => stops.some(p => K.closedOn(p, d));
    const open = days.filter(d => !shut(d));
    const avail = new Set(open.length ? open : days);
    const evOn = !GROUP && evChosen();
    let cal = '';
    if (days.length) {
      const first = K.parseYmd(days[0]), last = K.parseYmd(days[days.length - 1]);
      const start = K.addDays(first, -((first.getDay() + 6) % 7));
      const end = K.addDays(last, 6 - ((last.getDay() + 6) % 7));
      const cells = [];
      for (let d = start; d <= end; d = K.addDays(d, 1)) {
        const s = K.ymd(d), we = d.getDay() === 0 || d.getDay() === 6;
        const mon = d.getDate() === 1 || +d === +start ? `<small>${MONTHS_SHORT[d.getMonth()]}</small>` : '';
        cells.push(avail.has(s)
          ? `<button class="day avail${we ? ' we' : ''}" data-d="${s}" aria-label="${esc(K.fmtDay(s))}" aria-pressed="false"><span>${d.getDate()}</span>${mon}</button>`
          : days.includes(s) ? `<span class="day off shut" title="Выходной у места из плана"><span>${d.getDate()}</span><small>выходной</small></span>`
          : `<span class="day off" aria-hidden="true"><span>${d.getDate()}</span>${mon}</span>`);
      }
      const months = Array.from(new Set(days.map(s => MONTHS[K.parseYmd(s).getMonth()])));
      cal = `<div class="cal">
        <div class="cal-month">${months.join(' — ')}</div>
        <div class="cal-wd" aria-hidden="true">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(x => `<span>${x}</span>`).join('')}</div>
        <div class="cal-grid">${cells.join('')}</div>
      </div>`;
    }
    const other = !multi && (INV.dateOther || !days.length);
    const sub = multi ? 'Отметь все дни, когда можешь'
      : !days.length ? 'Напиши, когда тебе удобно'
        : evOn ? `Выбери день — «${esc(EVENT.title)}» идёт в эти даты` : 'Поставь сердечко на удобный день';
    el.innerHTML = `
      ${head(step, multi ? 'Когда удобно?' : 'Когда увидимся?', sub)}
      ${cal}
      <div class="pick-line" aria-live="polite"></div>
      ${days.length ? miniCat(multi ? 'Отмечай всё, что подходит — выберем день, когда смогут все' : 'Выбирай любой — я всё запомню 📝') : ''}
      ${multi ? `<div class="day-acts"><button class="link-btn all">${I('check')}Подходит любой</button><button class="link-btn idk">Пока не знаю</button></div>` : ''}
      ${other ? `<button class="link-btn other ${days.length ? '' : 'hidden'}">Ни один день не подходит</button>
        <div class="other-box ${days.length ? 'hidden' : ''}" style="width:100%"><input class="field" maxlength="80" placeholder="Например: в следующие выходные" aria-label="Когда тебе удобно"></div>` : ''}
      <div class="actions"><button class="btn btn-primary btn-wide next" disabled>Дальше${I('arrow')}</button></div>`;
    const nextBtn = $('.next', el), line = $('.pick-line', el), bub = $('.comment .bubble', el), inp = $('.other-box input', el);
    const allBtn = $('.all', el);
    // в компании «Дальше» — когда отмечен хоть один день; «не знаю» — отдельной кнопкой, чтобы не путать с «любой»
    const upd = () => {
      nextBtn.disabled = multi ? !S.a.days.length && !(S.a.maybe || []).length : !(S.a.date || (inp && inp.value.trim()));
      if (allBtn) allBtn.classList.toggle('hidden', S.a.days.length === days.length);
    };
    const stampHtml = `<svg class="stamp" viewBox="0 0 24 24" aria-hidden="true"><path d="${K.markD(MODE)}"/></svg>`;
    function toggle(b, quiet, force) {
      const d = b.dataset.d, on = force != null ? force : !b.classList.contains('picked');
      if (on === b.classList.contains('picked')) return;
      b.classList.toggle('picked', on);
      b.setAttribute('aria-pressed', String(on));
      if (on) b.insertAdjacentHTML('afterbegin', stampHtml); else { const st = $('.stamp', b); if (st) st.remove(); }
      S.a.days = on ? Array.from(new Set(S.a.days.concat(d))).sort() : S.a.days.filter(x => x !== d);
      line.textContent = S.a.days.length ? `Отмечено: ${S.a.days.length} ${plural(S.a.days.length, 'день', 'дня', 'дней')}` : '';
      if (!quiet) { save(); if (on) { Sfx.stamp(); vibrate(15); mood(el, 'happy', 700); } else Sfx.click(); }
    }
    /* компания: тап по дню — «да» → «может быть» → снято */
    function setMaybe(b, on) {
      const d = b.dataset.d;
      b.classList.toggle('maybe', on);
      S.a.maybe = on ? Array.from(new Set((S.a.maybe || []).concat(d))).sort() : (S.a.maybe || []).filter(x => x !== d);
    }
    function cycle(b) {
      if (b.classList.contains('picked')) { toggle(b, true, false); setMaybe(b, true); save(); Sfx.click(); }
      else if (b.classList.contains('maybe')) { setMaybe(b, false); save(); Sfx.click(); }
      else toggle(b, false, true);
      const m = (S.a.maybe || []).length;
      line.textContent = (S.a.days.length ? `Отмечено: ${S.a.days.length} ${plural(S.a.days.length, 'день', 'дня', 'дней')}` : '') + (m ? `${S.a.days.length ? ' · ' : ''}может быть: ${m}` : '');
    }
    function mark(b, quiet) {
      $$('.day.picked', el).forEach(x => { x.classList.remove('picked'); x.setAttribute('aria-pressed', 'false'); const s = $('.stamp', x); if (s) s.remove(); });
      if (!b) { line.textContent = ''; return; }
      b.classList.add('picked');
      b.setAttribute('aria-pressed', 'true');
      b.insertAdjacentHTML('afterbegin', stampHtml);
      line.textContent = K.fmtDay(b.dataset.d);
      say(bub, dayComment(K.parseYmd(b.dataset.d)));
      if (!quiet) { Sfx.stamp(); vibrate(15); mood(el, 'happy', 900); }
    }
    el.addEventListener('click', e => {
      const b = e.target.closest('.day.avail');
      if (!b) return;
      if (multi) { cycle(b); upd(); return; }
      S.a.date = b.dataset.d; S.a.dateOther = '';
      if (inp) inp.value = '';
      save(); mark(b); upd();
    });
    const otherBtn = $('.other', el);
    if (otherBtn) otherBtn.onclick = () => {
      Sfx.click();
      otherBtn.classList.add('hidden');
      $('.other-box', el).classList.remove('hidden');
      inp.focus();
    };
    if (inp) inp.oninput = () => {
      S.a.dateOther = inp.value.trim();
      if (S.a.dateOther && S.a.date) { S.a.date = ''; mark(null); }
      save(); upd();
    };
    if (allBtn) allBtn.onclick = () => {
      $$('.day.avail', el).forEach(b => toggle(b, true, true));
      save(); Sfx.stamp(); vibrate(15); mood(el, 'happy', 700);
      upd();
    };
    const idk = $('.idk', el);
    if (idk) idk.onclick = () => { Sfx.click(); S.a.days = []; save(); next(); };
    if (multi) {
      const keep = (S.a.days || []).filter(d => avail.has(d));
      S.a.days = [];
      keep.forEach(d => toggle($(`.day[data-d="${d}"]`, el), true));
      S.a.maybe = (S.a.maybe || []).filter(d => avail.has(d) && !keep.includes(d));
      S.a.maybe.forEach(d => { const b = $(`.day[data-d="${d}"]`, el); if (b) b.classList.add('maybe'); });
    } else if (S.a.date && avail.has(S.a.date)) mark($(`.day[data-d="${S.a.date}"]`, el), true);
    else S.a.date = '';
    if (S.a.dateOther && inp) { inp.value = S.a.dateOther; $('.other-box', el).classList.remove('hidden'); if (otherBtn) otherBtn.classList.add('hidden'); }
    upd();
    nextBtn.onclick = () => { if (nextBtn.disabled) return; Sfx.click(); next(); };
  }

  /* ================= Уровень: время и небо ================= */
  function period(h) {
    h = ((h % 24) + 24) % 24;   // окно через полночь: 24:30 — это 00:30
    if (h < 5) return { label: 'ночь', cat: 'Прогулка под звёздами? Ммм ✨' };
    if (h < 12) return { label: 'утро', cat: 'Утреннее свидание — это так мило ☀️' };
    if (h < 17) return { label: 'день', cat: 'Днём можно успеть всё-всё 🌤' };
    if (h < 20) return { label: 'вечер', cat: 'Вечер — самое романтичное время 🌅' };
    return { label: 'ночь', cat: 'Прогулка под звёздами? Ммм ✨' };
  }
  function lvlTime(el, next, step) {
    const tc = INV.time || {};
    /* Окно может идти через полночь: конструктор пишет «до» как 26:00 (02:00 следующего дня), старые ссылки — как 02:00.
       Внутри окна минуты идут подряд (22:00 → 24:30 → 26:00), а на экран и в ответ — по модулю суток */
    const fromRaw = K.toMin(tc.from || '12:00'), from = fromRaw % 1440, shift = fromRaw - from;
    // «с» тоже могли записать после полуночи (24:30) — «до» сдвигаем на те же сутки
    let to = K.toMin(tc.to || '22:00') - shift;
    if (to < from) to += Math.ceil((from - to) / 1440) * 1440;
    if (to === from) to = from + 60;          // пустое окно — час от начала
    to = Math.min(to, from + 1440);
    const stepM = clamp(+tc.step || 30, 5, 180);
    const N = Math.max(1, Math.floor((to - from) / stepM));
    const inWin = t => {
      if (!/^\d{1,2}:\d{2}$/.test(String(t || ''))) return null;
      let m = K.toMin(t) % 1440;
      if (m < from) m += 1440;
      return m <= to ? m : null;
    };
    // выбранное время (в ответе оно по модулю суток), иначе «сначала» из приглашения, иначе начало окна
    let m0 = inWin(S.a.time);
    if (m0 == null) m0 = inWin(tc.def || '19:00');
    if (m0 == null) m0 = from;
    const v0 = clamp(Math.round((m0 - from) / stepM), 0, N);
    const stars = Array.from({ length: 30 }, () => {
      const sz = rand(1.5, 3.5).toFixed(1);
      return `<i style="left:${rand(2, 98).toFixed(1)}%;top:${rand(3, 58).toFixed(1)}%;width:${sz}px;height:${sz}px;animation-delay:${(-rand(0, 2)).toFixed(2)}s"></i>`;
    }).join('');
    el.innerHTML = `
      ${head(step, 'Во сколько?', 'Двигай ползунок — солнце побежит за ним')}
      <div class="sky">
        <div class="stars">${stars}</div>
        <div class="cloud" style="top:12%">${CLOUD}</div><div class="cloud c2">${CLOUD}</div>
        <div class="orb sun"></div><div class="orb moon"></div>
        ${citySVG()}
      </div>
      <div class="time-read"><b></b><span></span></div>
      <div class="range-wrap">
        <input type="range" class="range" min="0" max="${N}" step="1" value="${v0}" aria-label="Время">
        <div class="range-labels"><span>${K.fromMin(from)}</span><span>${K.fromMin(from + N * stepM)}</span></div>
      </div>
      ${miniCat('')}
      <div class="actions"><button class="btn btn-primary btn-wide next">Дальше${I('arrow')}</button></div>`;
    const sky = $('.sky', el), sun = $('.sun', el), moon = $('.moon', el), range = $('.range', el);
    const read = $('.time-read b', el), per = $('.time-read span', el), bub = $('.comment .bubble', el);
    const stops = [];
    // небо до 6 утра — продолжение прошлой ночи (часы 24–30), иначе окно 01:00–04:00 было бы дневным
    const skyH = h => (h < 6 ? h + 24 : h);
    for (let i = 0; i <= 6; i++) stops.push(skyAt(skyH((from + N * stepM * i / 6) / 60))[0] + ' ' + Math.round(i * 100 / 6) + '%');
    range.style.setProperty('--track', `linear-gradient(90deg, ${stops.join(', ')})`);
    let lastPer = '';
    function upd(sound) {
      const m = from + (+range.value) * stepM, h = m / 60, t = (+range.value) / N, hs = skyH(h);
      const [c1, c2] = skyAt(hs);
      sky.style.background = `linear-gradient(180deg, ${c1}, ${c2})`;
      // после полуночи (hs ≥ 24) ночь держится до рассвета, к 6 утра (30) — как днём
      const night = hs < 24 ? clamp((hs - 19.3) / 1.4, 0, 1) : clamp((29.6 - hs) / 1.4, 0, 1);
      sky.style.setProperty('--night', night.toFixed(3));
      sky.style.setProperty('--lights', (hs < 24 ? clamp((hs - 17.8) / 1.6, 0, 1) : clamp((30 - hs) / 1.6, 0, 1)).toFixed(3));
      sky.style.setProperty('--bld', mix('#dcc2e4', '#2c2552', hs < 24 ? clamp((hs - 17) / 4, 0, 1) : clamp((30 - hs) / 3, 0, 1)));
      const x = 8 + t * 84, y = 76 - Math.sin(Math.PI * t) * 58;
      for (const o of [sun, moon]) { o.style.left = x + '%'; o.style.top = y + '%'; }
      sun.style.opacity = (1 - night).toFixed(3);
      moon.style.opacity = night.toFixed(3);
      read.textContent = K.fromMin(m);
      const p = period(h);
      per.textContent = p.label;
      // читалке — само время, а не номер шага ползунка
      range.setAttribute('aria-valuetext', K.fromMin(m) + ', ' + p.label);
      if (p.label !== lastPer) { lastPer = p.label; say(bub, p.cat); if (sound) mood(el, 'happy', 700); }
      S.a.time = K.fromMin(m);
      // минуты после полуночи (окно 22:00–02:00): встреча в ночь на следующий день — это нужно календарю
      S.a.timeNext = m + shift >= 1440;
      save();
      if (sound) { Sfx.tick(); vibrate(4); }
    }
    range.addEventListener('input', () => upd(true));
    upd(false);
    $('.next', el).onclick = () => { Sfx.click(); next(); };
  }

  /* ================= Свайпы: еда (свидание) и голосование за планы (компания) ================= */
  function swipeLevel(el, next, step, cfg) {
    const items = cfg.items;
    // читалке: видна только верхняя карточка, кнопки называют вариант, смена карточки объявляется (sr)
    const likeName = cfg.likeName || 'Да', nopeName = cfg.nopeName || 'Нет';
    el.innerHTML = `
      ${head(step, cfg.title, cfg.sub)}
      <div class="deck"></div>
      <div class="deck-count" aria-hidden="true"></div>
      <p class="vh deck-live" role="status" aria-live="polite"></p>
      <div class="swipe-btns"><button class="round nope" aria-label="${esc(nopeName)}">${I('x')}</button><button class="round like" aria-label="${esc(likeName)}">${I(GROUP ? 'check' : 'heart')}</button></div>
      <div class="food-result hidden"></div>
      <div class="actions hidden"><div class="row"><button class="btn btn-soft again">${I('redo')}Заново</button><button class="btn btn-primary ok">Дальше${I('arrow')}</button></div></div>`;
    const deck = $('.deck', el), cnt = $('.deck-count', el), btns = $('.swipe-btns', el), res = $('.food-result', el), acts = $('.actions', el);
    const sr = $('.deck-live', el), nopeBtn = $('.nope', btns), likeBtn = $('.like', btns);
    let idx = 0, liked = [], likedIdx = [], busy = false;
    const topCard = () => $(`.fcard[data-i="${idx}"]`, deck);

    function build() {
      idx = 0; liked = []; likedIdx = []; busy = false;
      deck.innerHTML = items.map((f, i) => `
        <div class="fcard${f.ph ? ' has-ph' : ''}" data-i="${i}" style="--c:${FCOL[i % FCOL.length]};z-index:${items.length - i}">
          <span class="tag like" aria-hidden="true">${cfg.likeTag}</span><span class="tag nope" aria-hidden="true">${cfg.nopeTag}</span>
          ${f.ph ? `<div class="fph"><img src="${esc(f.ph.s)}" alt="" draggable="false" decoding="async"><span class="fcap">© ${esc(phAuthor(f.ph))}, ${esc(f.ph.l)}</span></div>` : ''}
          <div class="fe">${esc(f.emoji)}</div>${f.when ? `<div class="fdate">${I('calendar')}${esc(f.whenShort || f.when)}</div>` : ''}<div class="ft${f.title.length > 40 ? ' xs' : f.title.length > 24 ? ' s' : ''}">${esc(f.title)}</div>${f.note ? `<div class="fn${f.title.length > 24 || f.when ? ' s' : ''}">${esc(f.note)}</div>` : ''}
          ${f.stops ? `<div class="opt-stops">${esc(f.stops)}</div>` : ''}
        </div>`).join('');
      [deck, cnt, btns].forEach(x => x.classList.remove('hidden'));
      res.classList.add('hidden'); acts.classList.add('hidden');
      layout();
    }
    function layout() {
      $$('.fcard', deck).forEach(c => {
        const d = +c.dataset.i - idx;
        c.dataset.depth = Math.min(d, 3);
        c.style.visibility = d > 3 ? 'hidden' : '';
        if (d > 0) c.setAttribute('aria-hidden', 'true'); else c.removeAttribute('aria-hidden');
      });
      cnt.textContent = idx < items.length ? `${idx + 1} / ${items.length}` : '';
      const f = items[idx];
      if (f) {
        sr.textContent = `${idx + 1} из ${items.length}: ${f.title}`;
        nopeBtn.setAttribute('aria-label', `${nopeName}: «${f.title}»`);
        likeBtn.setAttribute('aria-label', `${likeName}: «${f.title}»`);
      }
      attach();
    }
    function tags(c, dx) {
      $('.tag.like', c).style.opacity = clamp(dx / 90, 0, 1);
      $('.tag.nope', c).style.opacity = clamp(-dx / 90, 0, 1);
    }
    function attach() {
      const c = topCard();
      if (!c) return;
      let sx = 0, sy = 0, dx = 0, dy = 0, drag = false;
      c.onpointerdown = e => {
        if (busy) return;
        drag = true; sx = e.clientX; sy = e.clientY; dx = dy = 0;
        try { c.setPointerCapture(e.pointerId); } catch (err) { /* ок */ }
        c.classList.add('dragging');
      };
      c.onpointermove = e => {
        if (!drag) return;
        dx = e.clientX - sx; dy = e.clientY - sy;
        c.style.transform = `translate(${dx}px, ${dy * 0.35}px) rotate(${dx / 14}deg)`;
        tags(c, dx);
      };
      c.onpointerup = c.onpointercancel = () => {
        if (!drag) return;
        drag = false;
        c.classList.remove('dragging');
        if (Math.abs(dx) > 90) decide(dx > 0);
        else { c.style.transform = ''; tags(c, 0); }
      };
    }
    function decide(like) {
      const c = topCard();
      if (!c || busy) return;
      busy = true;
      const f = items[idx];
      tags(c, like ? 120 : -120);
      c.style.transform = `translate(${like ? 150 : -150}%, -8%) rotate(${like ? 26 : -26}deg)`;
      c.style.opacity = '0';
      if (like) {
        liked.push(f); likedIdx.push(idx);
        Sfx.catch();
        const r = c.getBoundingClientRect();
        FX.burst({ x: r.left + r.width / 2, y: r.top + r.height / 2, n: 22, power: 0.6, shapes: ['heart'] });
      } else Sfx.whoosh();
      vibrate(10);
      idx++;
      setTimeout(() => {
        c.remove();
        busy = false;
        if (idx >= items.length) finish(); else layout();
      }, 320);
    }
    function finish() {
      cfg.onFinish(liked, likedIdx);
      save();
      [deck, cnt, btns].forEach(x => x.classList.add('hidden'));
      res.classList.remove('hidden'); acts.classList.remove('hidden');
      res.innerHTML = cfg.result(liked);
      sr.textContent = '';
      Sfx.success();
      // кнопки с фокусом спрятаны — фокус на итог
      refocus($('h3', res) || $('.ok', acts));
    }
    nopeBtn.onclick = () => decide(false);
    likeBtn.onclick = () => decide(true);
    $('.again', acts).onclick = () => { Sfx.click(); build(); refocus($('.lvl-head h2', el)); };
    $('.ok', acts).onclick = () => { Sfx.click(); next(); };
    build();
  }

  function lvlFood(el, next, step) {
    const items = (INV.food || []).filter(f => f && f.title).map(f => ({ emoji: f.emoji || '🍽', title: f.title, note: f.note || '' }));
    swipeLevel(el, next, step, {
      title: 'Что будем есть?', sub: 'Свайпай: вправо — хочу, влево — не хочу', items, likeTag: 'ХОЧУ', nopeTag: 'НЕТ', likeName: 'Хочу', nopeName: 'Не хочу',
      onFinish: liked => { S.a.food = liked.map(f => ({ emoji: f.emoji, title: f.title })); },
      result: liked => liked.length
        ? `<h3>Твой выбор:</h3>
           <div class="food-emojis">${liked.map((f, i) => `<span style="animation-delay:${(i * 0.08).toFixed(2)}s">${esc(f.emoji)}</span>`).join('')}</div>
           <p class="sub">${esc(liked.map(f => f.title).join(', '))}</p>
           ${miniCat(liked.length > 2 ? 'Кто-то проголодался 😋' : 'Вкусный выбор! Записал 📝', 'happy')}`
        : `<div class="food-emojis"><span>🤔</span></div>
           <h3>Ничего не приглянулось?</h3>
           ${miniCat(`Тогда ${INV.me} удивит тебя чем-нибудь вкусным 😉`, 'wow')}`,
    });
  }

  /* Варианты для голосования: готовые планы из подборок, события из афиши или свои */
  let OPT_CACHE = null;
  function optItems() {
    const day = todayYmd();
    if (OPT_CACHE && OPT_CACHE.day === day) return OPT_CACHE.items;
    const items = (INV.opts || []).map(o => {
      if (o && o.event) {
        const ev = eventById(o.event);
        if (!ev) return { emoji: '❓', title: 'Событие недоступно', note: '', stops: '', plan: '' };
        const days = evDaysAll(ev);
        return { emoji: ev.emoji || '🎫', title: ev.title, note: ev.note || '', stops: evPlaceLine(ev), plan: '', event: ev.id, ph: evPhoto(ev), when: evWhen(ev, days), whenShort: evWhenShort(ev, days), past: !days.length };
      }
      const pl = o && o.plan ? K.planById(o.plan) : null;
      if (pl) return { emoji: pl.emoji, title: pl.title, note: pl.why, stops: stopsLine(pl), plan: pl.id, ph: K.planPhoto(pl) };
      if (o && o.title) return { emoji: o.emoji || '📍', title: o.title, note: o.note || '', stops: '', plan: '' };
      return { emoji: '❓', title: 'Вариант недоступен', note: '', stops: '', plan: '' };
    });
    OPT_CACHE = { day, items };
    return items;
  }
  function lvlVote(el, next, step) {
    // прошедшие события в колоду не кладём; номера вариантов остаются как в приглашении
    const all = optItems().map((o, i) => [o, i]);
    const deck = all.some(([o]) => !o.past) ? all.filter(([o]) => !o.past) : all;
    swipeLevel(el, next, step, {
      title: 'Куда пойдём?', sub: 'Свайпай: вправо — за, влево — против', items: deck.map(x => x[0]), likeTag: 'ЗА', nopeTag: 'НЕТ', likeName: 'За', nopeName: 'Против',
      // от выбора зависит календарь (только события — только их дни; дней нет — шаг пропускаем)
      onFinish: (liked, idx) => { S.a.opts = idx.map(j => deck[j][1]); restep(); },
      result: liked => liked.length
        ? `<h3>Ты за:</h3>
           <div class="food-emojis">${liked.map((f, i) => `<span style="animation-delay:${(i * 0.08).toFixed(2)}s">${esc(f.emoji)}</span>`).join('')}</div>
           <p class="sub">${esc(liked.map(f => f.title).join(', '))}</p>
           ${miniCat('Записал! Посмотрим, что выберут остальные 📝', 'happy')}`
        : `<div class="food-emojis"><span>🤷</span></div>
           <h3>Тебе всё равно?</h3>
           ${miniCat('Так и запишем: подойдёт любой вариант 😉', 'wow')}`,
    });
  }

  /* ================= Финал: билет ================= */
  /* Места каталога из ответа — их можно оценить после встречи (отзывы работают только с сервером) */
  function rateIds(plan, ev) {
    const ids = plan ? plan.stops.filter(id => K.placeById(id)) : ev && ev.place && K.placeById(ev.place) ? [ev.place] : [];
    return uniq(ids).slice(0, 3);
  }
  function rateBlock(ids, day) {
    if (!API_ON || !ids.length) return '';
    const one = ids.length === 1;
    // день встречи прошёл (билет открыли позже) — спрашиваем прямо
    const after = !!day && day < todayYmd();
    return `<div class="rate-box">
      <p class="hint">${I('sparkle')}${after ? 'Как прошло? Оцени место — так другим будет проще выбрать' : 'Как сходите — оцени место: так другим будет проще выбрать'}</p>
      <div class="plan-links">${ids.map(id => `<a class="chip-link" href="${esc(hubUrl('place=' + encodeURIComponent(id), cityOf(id)))}#reviews" target="_blank" rel="noopener">${I('heart')}${one ? 'Оценить место' : 'Оценить: ' + esc(K.placeById(id).name)}</a>`).join('')}</div>
    </div>`;
  }

  function scrFinal(el) {
    if (GROUP) return scrFinalGroup(el);
    const rows = answerRows(true);
    const ev = S.a.place && S.a.place.kind === 'event' ? eventById(S.a.place.event) : null;
    const plan = !ev && S.a.place && S.a.place.plan ? K.planById(S.a.place.plan) : null;
    const view = !!ANSWER;
    const flight = 'LOVE-' + (parseInt(INV_ID, 36) % 900 + 100);
    const d = K.parseYmd(S.a.date);
    const topInfo = d ? `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${S.a.time ? ' · ' + S.a.time : ''}` : (S.a.time || '❤');
    const tgUser = hostTg();
    // 00:30 в окне через полночь — уже следующий день: в календарь иначе попадёт на сутки раньше
    const calDay = meetDay(S.a.date, S.a);
    const calEv = S.a.date ? (ev ? {
      title: `${ev.title} · ${INV.her} и ${INV.me}`, day: calDay, time: S.a.time || '', minutes: EV_MIN[ev.cat],
      location: evLoc(ev), details: evUrl(ev),
    } : {
      title: `Свидание · ${INV.her} и ${INV.me}`, day: calDay, time: S.a.time || '',
      location: plan ? placeLoc(plan) : (S.a.place && S.a.place.kind !== 'surprise' ? placeText(true) : ''),
      details: plan ? planDetails(plan) : '',
    }) : null;
    const extra = ev
      ? `<div class="tally"><h3>${esc(ev.emoji || '🎫')} ${esc(ev.title)}</h3>${evPlaceLine(ev) ? `<p class="v-day">${I('pin')}${esc(evLoc(ev))}</p>` : ''}${evLinks(ev)}${calEv ? calBlock(calEv) : ''}</div>`
      : plan || calEv ? `<div class="tally"><h3>${plan ? esc(plan.title) : 'Не забудь'}</h3>${plan ? planBlock(plan) : ''}${plan ? homeRiskBlock(plan, S.a.time, S.a.date) : ''}${calEv ? calBlock(calEv) : ''}${plan && !view ? bookBox(K.bookStop(K.planStops(plan)), { n: 2, day: S.a.date, time: S.a.time }) : ''}</div>` : '';
    el.innerHTML = `
      <div class="res-head"><p class="eyebrow">${view ? 'Ответ получен' : 'Готово'}</p>
        <h2 class="final-title">${view ? `${esc(INV.her)} ${GF('ответила', 'ответил')} «да»` : 'Твой билет на свидание'}</h2></div>
      <div class="ticket-wrap"><div class="ticket">
        <div class="t-top"><small>BOARDING PASS</small><b>${esc(topInfo)}</b></div>
        <div class="t-names">
          <div><small>Пассажир</small><b>${esc(INV.her)}</b></div>
          <div class="t-mid"><svg viewBox="0 0 24 24"><path d="${K.HEART_D}"/></svg></div>
          <div><small>Встречает</small><b>${esc(INV.me)}</b></div>
        </div>
        <div class="t-rows">${rows.concat(view && S.a.note ? [['✉️', 'chat', 'Пишет', S.a.note]] : []).map(([, ic, l, v]) => `<div class="t-row"><i>${I(ic)}</i><div><small>${l}</small><b>${esc(v)}</b></div></div>`).join('')}</div>
        <div class="t-cut"></div>
        <div class="t-bottom"><div class="barcode"></div><small>РЕЙС<br>${flight}</small></div>
      </div></div>
      ${extra}
      ${rateBlock(rateIds(plan, ev), S.a.date)}
      <div class="send-state" role="status"></div>
      <div class="final-cat"><div class="cat-slot">${K.catSVG(LOVE())}</div><div class="bubble b-left">${esc(view ? 'Осталось только встретиться 😉' : T(INV.finale))}</div></div>
      ${view ? `<div class="actions"><a class="btn btn-primary btn-wide" href="${esc(hubUrl(''))}">Все планы «${esc((CFG.site && CFG.site.name) || 'Куда идём?')}»${I('arrow')}</a></div>` : ''}
      <div class="actions${view ? ' hidden' : ''}">
        <button class="btn btn-primary btn-wide share">${I('share')}${tgUser ? 'Отправить ответ в Telegram' : 'Отправить ответ'}</button>
        <button class="btn btn-soft btn-wide note-open">${I('pen')}Написать пару слов</button>
        <button class="btn btn-soft btn-wide friend">💬 ${GF('Скинуть подруге', 'Скинуть другу')}</button>
        ${window.KudaShareCard ? `<button class="btn btn-soft btn-wide card-story">🖼️ Картинка для сторис</button>` : ''}
        <div class="note-box hidden">
          <textarea class="field" rows="3" maxlength="500" placeholder="Пожелание, вопрос или просто что-то милое…"></textarea>
          <button class="btn btn-primary note-send">Отправить</button>
        </div>
        <button class="link-btn replay">${I('redo')}Пройти заново</button>
        <a class="btn btn-soft btn-wide surprise-back" href="${esc(guestCreateUrl('mode=date'))}">${I('sparkle')}Сделай ответный сюрприз</a>
        <a class="link-btn viral" href="${esc(hubUrl('from=invite' + refQ()))}">${I('sparkle')}Сделать своё приглашение</a>
      </div>`;

    const ticket = $('.ticket', el), cut = $('.t-cut', el);
    const setCut = () => ticket.style.setProperty('--cut', (cut.offsetTop + 1) + 'px');
    requestAnimationFrame(setCut);
    addEventListener('resize', setCut);
    if (view) {
      setTimeout(() => { Sfx.fanfare(); FX.burst({ n: 120, power: 1.1 }); }, 350);
      return () => removeEventListener('resize', setCut);
    }

    const state = $('.send-state', el), shareBtn = $('.share', el);
    wireBook(el);
    // «Скинуть подруге»: куда, когда и с кем — текстом, без сети и без геолокации; маршрут — ссылкой go.html
    const fr = $('.friend', el);
    if (fr) fr.onclick = () => { Sfx.click(); sendText(friendText(plan), GF('Скопировано — отправь подруге', 'Скопировано — отправь другу')); };
    const cs = $('.card-story', el);
    if (cs) cs.onclick = () => {
      Sfx.click();
      cs.disabled = true;
      window.KudaShareCard.share(Object.assign(ticketCard(plan, ev, topInfo), { size: 'story' })).then(r => {
        cs.disabled = false;
        if (r === 'saved') toast('Картинка сохранена — выкладывай');
        else if (r === 'error') toast('Не получилось нарисовать картинку');
      });
    };
    const noteOpen = $('.note-open', el), noteBox = $('.note-box', el), noteArea = $('textarea', noteBox);
    const sig = JSON.stringify(Object.assign({}, S.a, { note: '' }));
    const setState = (txt, ok) => { state.innerHTML = (ok ? I('check') : '') + esc(txt); state.classList.toggle('ok', !!ok); };

    // ссылку-билет готовим сразу; пока сокращается — на кнопке точка-индикатор, ждать её не обязательно
    const ticketReady = () => { shareBtn.classList.remove('busy'); shareBtn.removeAttribute('aria-busy'); };
    if (CODE && !PREVIEW) { shareBtn.classList.add('busy'); shareBtn.setAttribute('aria-busy', 'true'); prepareTicket(ticketReady); }
    // ответ сохраняем на сервере: создатель увидит его в «Моих приглашениях»; ссылка-билет остаётся запасным путём
    const savedText = `Ответ сохранён — ${INV.me} увидит его в «Моих приглашениях»`;
    const saveToServer = () => {
      if (!live() || OWN) return Promise.resolve(false);
      if (!canNotify()) setState('Сохраняю ответ…');
      return saveAnswer(answerPayload()).then(ok => {
        if (!canNotify()) setState(ok ? savedText : 'Не получилось сохранить ответ — отправь его кнопкой ниже', ok);
        return ok;
      });
    };
    if (PREVIEW) setState('Это превью — ответ никуда не отправляется');
    else if (OWN) setState('Это твоё приглашение — твой ответ не сохраняем и никому не отправляем');
    else saveToServer();
    // «да» со всеми деталями (без письма вопроса нет — билет и есть ответ) — цель «decision», с устройства один раз; своё не считаем
    if (!PREVIEW && !OWN && (S.a.yes || !has('letter')) && !S.sent.decision) { S.sent.decision = 1; save(); goal('decision', 'date'); }
    if (!PREVIEW && canNotify()) {
      shareBtn.classList.add('hidden');
      if (S.sent.final === sig) setState(`${INV.me} уже видит твой ответ`, true);
      else {
        setState('Отправляю ответ…');
        notify('final').then(ok => {
          if (ok) { S.sent.final = sig; save(); setState(`${INV.me} уже видит твой ответ`, true); }
          else { setState('Не получилось отправить автоматически — нажми кнопку ниже'); shareBtn.classList.remove('hidden'); }
        });
      }
    }

    shareBtn.onclick = () => { Sfx.click(); shareAnswer(); };
    noteOpen.onclick = () => {
      Sfx.click();
      noteOpen.classList.add('hidden');
      noteBox.classList.remove('hidden');
      noteArea.value = S.a.note || '';
      noteArea.focus();
    };
    $('.note-send', el).onclick = async () => {
      const txt = noteArea.value.trim();
      if (!txt) { noteArea.focus(); return; }
      S.a.note = txt; save();
      Sfx.click();
      prepareTicket(ticketReady);   // в билете теперь и записка
      const noteDone = () => {
        toast(`Отправлено! ${INV.me} прочитает ${MODE === 'guys' ? '📨' : '💌'}`);
        noteBox.classList.add('hidden');
        noteOpen.classList.remove('hidden');
        noteOpen.innerHTML = I('pen') + 'Написать ещё';
        FX.burst({ n: 40, power: 0.7, shapes: ['heart'] });
      };
      if (live() && !OWN && !canNotify()) {
        const btn = $('.note-send', el);
        btn.disabled = true;
        const ok = await saveToServer();
        btn.disabled = false;
        if (ok) { noteDone(); return; }
        toast('Не сохранилось — нажми «Отправить ответ»');
        return;
      }
      if (canNotify()) {
        saveToServer();
        const ok = await notify('note');
        if (ok) { noteDone(); return; }
        // после ожидания сети «Поделиться» на iPhone может не открыться — просим нажать кнопку ещё раз
        shareBtn.classList.remove('hidden');
        toast('Не отправилось автоматически — нажми «Отправить ответ»');
        return;
      }
      shareAnswer();
    };
    $('.replay', el).onclick = () => {
      Sfx.click();
      S.a = freshAnswers();
      restep();
      go(1);
    };

    setTimeout(() => { Sfx.fanfare(); FX.burst({ n: 160, power: 1.2 }); }, 350);
    const rain = setTimeout(() => FX.rain(60), 1100);
    return () => { clearTimeout(rain); removeEventListener('resize', setCut); };
  }

  /* ================= Компания: голоса ================= */
  /* Голоса живут в трёх местах: в ссылке (&v=), в этом браузере (localStorage kuda-votes:<id приглашения>)
     и — если включён сервер — на сервере. Всё увиденное объединяем: у каждого голосующего остаётся самый свежий голос. */
  const VOTER_RE = /^[A-Za-z0-9_-]{1,12}$/;
  const VKEY = () => 'kuda-votes:' + INV_ID;
  const SKEY = () => 'kuda-spin:' + INV_ID;
  function voterId() {
    if (VOTER_ID) return VOTER_ID;
    const k = 'kuda-voter:' + INV_ID;
    try { VOTER_ID = localStorage.getItem(k) || ''; } catch (e) { /* приватный режим */ }
    if (!VOTER_RE.test(VOTER_ID)) {
      VOTER_ID = rnd(8);
      if (!PREVIEW) { try { localStorage.setItem(k, VOTER_ID); } catch (e) { /* ок */ } }
    }
    return VOTER_ID;
  }
  /* Секрет голосующего: сервер хранит только его хэш, чужой не перезапишет твой голос */
  let VSEC = '';
  function voteSecret() {
    if (VSEC) return VSEC;
    const k = 'kuda-vsec:' + INV_ID;
    try { VSEC = localStorage.getItem(k) || ''; } catch (e) { /* ок */ }
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(VSEC)) {
      VSEC = rnd(24);
      try { localStorage.setItem(k, VSEC); } catch (e) { /* ок */ }
    }
    return VSEC;
  }
  /* t — миллисекунды; в старых ссылках — минуты */
  function cleanVotes(arr) {
    return (Array.isArray(arr) ? arr : []).filter(v => v && typeof v.id === 'string' && VOTER_RE.test(v.id)).map(v => {
      let t = +v.t || 0;
      if (t > 0 && t < 1e11) t *= 60000;
      return {
        id: v.id, n: String(v.n == null || v.n === '' ? '?' : v.n).slice(0, 30), y: v.y ? 1 : 0,
        o: uniq((Array.isArray(v.o) ? v.o : []).filter(x => isInt(x, 0, 99))).slice(0, 20),
        d: uniq((Array.isArray(v.d) ? v.d : []).filter(x => isInt(x, 0, 40000))).slice(0, 60),
        s: uniq((Array.isArray(v.s) ? v.s : []).filter(x => isInt(x, 0, 3))).slice(0, 4),
        m: uniq((Array.isArray(v.m) ? v.m : []).filter(x => isInt(x, 0, 40000))).slice(0, 60),
        p: isInt(v.p, 0, 9) ? v.p : 0,
        t: t > 0 ? t : 0,
      };
    });
  }
  function mergeVotes(...lists) {
    const m = new Map();
    for (const list of lists) for (const v of cleanVotes(list)) { const p = m.get(v.id); if (!p || v.t >= p.t) m.set(v.id, v); }
    return Array.from(m.values()).sort((a, b) => a.t - b.t);
  }
  function loadSeen() {
    if (PREVIEW) return [];
    try { return cleanVotes(JSON.parse(localStorage.getItem(VKEY()) || '[]')); } catch (e) { return []; }
  }
  /* Подписчики на изменение голосов: экран приветствия и итоги */
  const VOTE_SUBS = new Set();
  const onVotes = f => { VOTE_SUBS.add(f); return () => VOTE_SUBS.delete(f); };
  function votesChanged() { VOTE_SUBS.forEach(f => { try { f(); } catch (e) { setTimeout(() => { throw e; }); } }); }
  /* Добавить голоса (из ссылки, сервера, вставленных ссылок) и запомнить всё в этом браузере; true — что-то поменялось */
  function mergeIn(...lists) {
    const before = JSON.stringify(PRIOR);
    PRIOR = mergeVotes(PRIOR, loadSeen(), ...lists);
    if (!PREVIEW) {
      const keep = JSON.stringify(PRIOR.slice(-60));
      try { if (localStorage.getItem(VKEY()) !== keep) localStorage.setItem(VKEY(), keep); } catch (e) { /* ок */ }
    }
    return JSON.stringify(PRIOR) !== before;
  }
  function addVotes(...lists) { if (mergeIn(...lists)) votesChanged(); }
  const myVote = () => PRIOR.find(v => v.id === VOTER_ID) || null;
  /* Отпечаток голоса без времени: «этот голос уже на сервере / уже отправлен ссылкой» */
  const voteSig = v => {
    if (!v) return '';
    const a = [v.n, v.y, v.o, v.d];
    if ((v.s || []).length || (v.m || []).length || v.p) a.push(v.s || [], v.m || [], v.p || 0);
    return JSON.stringify(a);
  };
  const voteSaved = () => { const my = myVote(); return !!my && S.sent.api === voteSig(my); };
  const voteSent = () => { const my = myVote(); return !!my && S.sent.vote === voteSig(my); };

  /* ---------- сервер ---------- */
  let REMOTE_IDS = null;    // id голосов, которые уже есть на сервере (их не досылаем)
  function applyRemote(r) {
    if (!r || !Array.isArray(r.votes)) return false;
    if (Number.isInteger(r.rev)) REV = r.rev;
    if (r.spin && Number.isInteger(r.spin.i)) SPIN = r.spin;
    if (r.spins && typeof r.spins === 'object' && !Array.isArray(r.spins)) SPINS = r.spins;
    if (Number.isInteger(r.until)) SRV_UNTIL = r.until;
    SYNC = 'on';
    const remote = cleanVotes(r.votes);
    REMOTE_IDS = new Set(remote.map(v => v.id));
    const rm = remote.find(v => v.id === VOTER_ID);
    mergeIn(r.votes);
    const my = myVote();
    // мой голос на сервере такой же, как здесь, — значит, он сохранён
    if (rm && my && voteSig(rm) === voteSig(my) && S.sent.api !== voteSig(my)) { S.sent.api = voteSig(my); save(); }
    if (GROUP && !PREVIEW && isClosed() && current && !current.classList.contains('s-results')) {
      showResults(false);
      toast('Голосование уже закрыто — вот итог');
      return true;
    }
    votesChanged();
    return true;
  }
  /* Первая загрузка голосов с сервера; через 2,5 с перестаём ждать (ответ, если придёт позже, всё равно применим) */
  function pullRemote() {
    if (!live()) return;
    const p = api('votes', CODE);
    const slow = setTimeout(() => { if (!SYNC) { SYNC = 'off'; votesChanged(); } }, 2500);
    p.then(r => {
      clearTimeout(slow);
      if (!applyRemote(r)) { if (SYNC !== 'on') { SYNC = 'off'; votesChanged(); } return; }
      syncUp(r.votes);
    });
  }
  /* Мой голос или голоса из старых ссылок ещё не на сервере — досылаем (чужие уходят как seed: сервер берёт их, только если таких ещё нет) */
  function syncUp(remote) {
    const my = myVote();
    if (!my || !live()) return;
    const rv = cleanVotes(remote), ids = new Set(rv.map(v => v.id));
    const rm = rv.find(v => v.id === my.id);
    if (!rm || voteSig(rm) !== voteSig(my) || PRIOR.some(v => !ids.has(v.id))) pushVote(my);
  }
  let PUSH = Promise.resolve();
  function pushVote(mine) {
    if (!live() || !mine) return PUSH;
    VOTE_STATE = 'saving';
    votesChanged();
    PUSH = PUSH.then(async () => {
      // чужие голоса из ссылок, которых на сервере ещё нет; запрос — не больше ~6 КБ (лимит сервера 8 КБ)
      const seed = [];
      let size = 0;
      for (const v of PRIOR.slice().reverse()) {
        if (v.id === mine.id || (REMOTE_IDS && REMOTE_IDS.has(v.id))) continue;
        size += new Blob([JSON.stringify(v)]).size + 1;
        if (size > 5000 || seed.length >= 59) break;
        seed.push(v);
      }
      let r = await api('vote', CODE, mine, voteSecret(), seed);
      // сервер отверг какой-то голос из старой ссылки — сохраняем хотя бы свой
      if (!r && seed.length && !/^(rate|net|timeout|off|owner|full|closed)$/.test(apiErr())) r = await api('vote', CODE, mine, voteSecret(), []);
      // организатор закрыл голосование или прошёл дедлайн — голос не принят, итог окончательный
      if (!r && apiErr() === 'closed') { SRV_UNTIL = SRV_UNTIL || Math.floor(Date.now() / 60000); toast('Голосование уже закрыто — твой голос не попал в итог'); }
      if (r && Array.isArray(r.votes)) {
        if (ADOPT && ADOPT.id === mine.id) ADOPT = null;
        if (voteSig(myVote()) === voteSig(mine)) { S.sent.api = voteSig(mine); save(); }
        VOTE_STATE = 'saved';
        applyRemote(r);
      } else if (apiErr() === 'owner' && ADOPT && ADOPT.id === mine.id) {
        // «это я» не подтвердилось: тот голос сохранён из другого браузера — оставляем его как был
        undoAdopt();
        VOTE_STATE = '';
        votesChanged();
      } else {
        VOTE_STATE = 'local';
        votesChanged();
      }
    }).catch(() => { VOTE_STATE = 'local'; votesChanged(); });
    return PUSH;
  }

  /* ---------- ссылки с голосами ----------
     Ссылку и текст готовим заранее и синхронно отдаём по нажатию: на iPhone «Поделиться» и буфер обмена
     работают только сразу после касания. Сначала — несжатая ссылка (готова мгновенно), потом сжатая и короткая. */
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
  const encSync = obj => 'c' + K.toB64url(packText(JSON.stringify(obj)));
  const linkWith = (data, w) => baseUrl() + '#' + CODE + (data ? '&v=' + data : '') + (w != null ? '&w=' + w : '');
  const SH = { sig: '', link: '', timer: 0 };
  let FORCED = null;   // итог колеса для текущей ничьей
  function prepareShare() {
    if (!CODE || PREVIEW) return;
    const votes = PRIOR, w = FORCED;
    const sig = JSON.stringify([votes, w]);
    if (SH.sig === sig) return;
    SH.sig = sig;
    SH.link = linkWith(votes.length ? encSync(votes) : '', w);
    clearTimeout(SH.timer);
    SH.timer = setTimeout(async () => {
      try {
        const long = votes.length ? linkWith(await K.encodeData(votes), w) : SH.link;
        if (SH.sig !== sig) return;
        SH.link = long;
        // сначала своя короткая ссылка; без своего сервера — любой сокращатель (clck.ru):
        // человек откроет её как обычно, а «Объединить» про такие ссылки честно предупреждает
        const short = await shortAny(long);
        if (SH.sig === sig && short && short.length < long.length) SH.link = short;
      } catch (e) { /* остаётся длинная ссылка */ }
    }, votes.length ? 400 : 0);
  }
  const shareLink = () => { prepareShare(); return SH.link || baseUrl() + '#' + CODE; };
  const shareText = () => `${MC.emoji} ${groupTitle()}\nГолосуем, куда и когда идём! Уже отметились: ${PRIOR.map(v => v.n).join(', ') || '—'}\n👉 ${shareLink()}`;

  /* ---------- подсчёт ---------- */
  function tally(votes) {
    const items = optItems();
    const today = todayNum();
    const inV = votes.filter(v => v.y);
    const opt = items.map((o, i) => ({ o, i, who: inV.filter(v => v.o.includes(i)).map(v => v.n) }))
      .sort((a, b) => b.who.length - a.who.length || a.i - b.i);
    // прошедшие дни не считаем; пустой список дней — «пока не знаю»
    const dIn = inV.filter(v => v.d.some(d => d >= today) || (v.m || []).some(d => d >= today));
    const dm = new Map();
    // «может быть» — полголоса: в списке имя с «?»
    dIn.forEach(v => { v.d.forEach(d => { if (d >= today) { const x = dm.get(d) || { who: [], w: 0, yes: 0 }; x.who.push(v.n); x.w += 1; x.yes++; dm.set(d, x); } });
      (v.m || []).forEach(d => { if (d >= today && !v.d.includes(d)) { const x = dm.get(d) || { who: [], w: 0, yes: 0 }; x.who.push(v.n + '?'); x.w += 0.5; dm.set(d, x); } }); });
    const days = Array.from(dm.entries()).map(([d, x]) => ({ d, who: x.who, w: x.w, yes: x.yes })).sort((a, b) => b.w - a.w || b.yes - a.yes || a.d - b.d);
    const SL = slotList();
    const slots = SL.length > 1 ? SL.map((tm, i) => ({ i, tm, who: inV.filter(v => (v.s || []).includes(i)).map(v => v.n) })).sort((a, b) => b.who.length - a.who.length || a.i - b.i) : [];
    const plus = inV.reduce((n, v) => n + (v.p || 0), 0);
    return { opt, days, inV, dIn, slots, plus, idk: inV.filter(v => !v.d.length && !(v.m || []).length).map(v => v.n), any: inV.filter(v => !v.o.length).map(v => v.n) };
  }
  const leadersOf = t => { const top = t.opt.length ? t.opt[0].who.length : 0; return t.opt.filter(x => top > 0 && x.who.length === top); };
  const leadSig = L => L.map(x => x.i).sort((a, b) => a - b).join(',');
  /* Итог колеса: с сервера (общий для всех) или из этого браузера — если ничья всё та же */
  let LOCAL_SPIN = null;
  function readLocalSpin() {
    if (LOCAL_SPIN) return LOCAL_SPIN;
    try { const s = JSON.parse(localStorage.getItem(SKEY()) || 'null'); return s && Number.isInteger(s.i) && typeof s.L === 'string' ? s : null; } catch (e) { return null; }
  }
  function saveLocalSpin(i, L) {
    LOCAL_SPIN = { i, L };
    if (!PREVIEW) { try { localStorage.setItem(SKEY(), JSON.stringify(LOCAL_SPIN)); } catch (e) { /* ок */ } }
  }
  function forcedFor(t) {
    const L = leadersOf(t);
    if (L.length < 2) return null;
    // колесо детерминировано: итог берём, только если для этой ничьей оно выбрало бы то же самое.
    // Сервер хранит итог на каждый набор лидеров (L); итог другой ничьей (другие лидеры) не годится.
    // Итог без L (старый клиент или старый сервер) — один на приглашение: сверяем только с колесом
    const win = wheelPlan(L.map(x => x.i)).win, sig = leadSig(L);
    const srv = SPINS && Object.prototype.hasOwnProperty.call(SPINS, sig) ? SPINS[sig]
      : SPIN && (!SPIN.L || SPIN.L === sig) ? SPIN : null;
    if (srv && srv.i === win) return win;
    const loc = readLocalSpin();
    return loc && loc.L === sig && loc.i === win ? win : null;
  }
  /* Колесо без случайности: по коду приглашения и набору лидеров — на всех телефонах один и тот же победитель */
  const WHEEL_MAX = 8;
  function wheelPlan(ids) {
    let sub = ids.slice().sort((a, b) => a - b);
    if (sub.length > WHEEL_MAX) sub = sub.slice().sort((a, b) => hnum(CODE + '|w|' + a) - hnum(CODE + '|w|' + b) || a - b).slice(0, WHEEL_MAX).sort((a, b) => a - b);
    return { sub, win: sub[hnum(CODE + '|' + sub.join(',')) % sub.length] };
  }
  /* Слоты времени из приглашения: 1–4 значения 'ЧЧ:ММ' (один — время фиксировано) */
  function slotList() { return (Array.isArray(INV.slots) ? INV.slots : []).filter(x => /^([01]\d|2[0-3]):[0-5]\d$/.test(x)).slice(0, 4); }
  /* Дедлайн: until из ссылки или с сервера (организатор закрыл раньше), минуты эпохи → {closed, text} или null */
  function deadline() {
    const u = [INV.until, SRV_UNTIL].filter(x => Number.isInteger(x) && x > 0);
    if (!u.length) return null;
    const ms = Math.min(...u) * 60000;
    const d = new Date(ms + 3 * 3600e3);
    const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getUTCDay()];
    const text = `${wd} ${d.getUTCDate()}.${String(d.getUTCMonth() + 1).padStart(2, '0')} в ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    const left = ms - Date.now();
    return { closed: left <= 0, text, left };
  }
  const isClosed = () => { const d = deadline(); return !!(d && d.closed); };
  function deadlineHtml() {
    const d = deadline();
    if (!d) return '';
    if (d.closed) return '<p class="deadline closed">🔒 Голосование закрыто — итог ниже окончательный</p>';
    return `<p class="deadline">⏳ Голосуем до ${esc(d.text)} — осталось ${K.leftText(d.left)}</p>`;
  }
  /* Шаг «Во сколько»: можно отметить несколько слотов */
  function lvlSlot(el, next, step) {
    const SL = slotList();
    S.a.slots = (S.a.slots || []).filter(i => i < SL.length);
    el.innerHTML = `
      ${head(step, 'Во сколько удобно?', 'Отметь всё, что подходит')}
      <div class="slots">${SL.map((tm, i) => `<button type="button" class="slot${S.a.slots.includes(i) ? ' picked' : ''}" data-i="${i}" aria-pressed="${S.a.slots.includes(i)}">${esc(tm)}</button>`).join('')}</div>
      <button class="link-btn any-time" type="button">Мне всё равно, во сколько</button>
      <div class="actions"><button class="btn btn-primary btn-wide next">Дальше${I('arrow')}</button></div>`;
    $('.slots', el).addEventListener('click', e => {
      const b = e.target.closest('.slot');
      if (!b) return;
      const i = +b.dataset.i, on = !S.a.slots.includes(i);
      S.a.slots = on ? S.a.slots.concat(i).sort() : S.a.slots.filter(x => x !== i);
      b.classList.toggle('picked', on); b.setAttribute('aria-pressed', String(on));
      save(); if (on) { Sfx.stamp(); vibrate(12); } else Sfx.click();
    });
    $('.any-time', el).onclick = () => { Sfx.click(); S.a.slots = []; save(); next(); };
    $('.next', el).onclick = () => { Sfx.click(); next(); };
  }
  function verdict(votes, forced, t) {
    t = t || tally(votes);
    const leaders = leadersOf(t);
    const win = forced != null ? t.opt.find(x => x.i === forced) || null : leaders.length === 1 ? leaders[0] : null;
    const ev = win && win.o.event ? eventById(win.o.event) : null;
    let day = t.days.length ? t.days[0] : null;
    if (ev) { const ok = new Set(evDaysAll(ev).map(K.dayNum)); day = t.days.find(x => ok.has(x.d)) || null; }
    const SL = slotList();
    const slot = SL.length === 1 ? { tm: SL[0], who: [] } : t.slots.length && t.slots[0].who.length ? t.slots[0] : null;
    return { t, win, leaders, ev, day, slot, people: t.inV.length + t.plus, wheel: forced != null && !!win, plan: win && win.o.plan ? K.planById(win.o.plan) : null };
  }
  /* «могут все» — только когда про дни ответили хотя бы двое и все — твёрдым «да»; «может быть» считаем отдельно */
  function canLine(v, names) {
    const m = v.t.dIn.length, yes = v.day.yes == null ? v.day.who.length : v.day.yes, maybe = v.day.who.length - yes;
    if (yes === m && m >= 2) return 'могут все';
    const may = maybe ? ` + ${maybe} «может»` : '';
    return names ? `могут ${v.day.who.join(', ')} (${yes} из ${m}${may})` : `могут ${yes} из ${m}${may}`;
  }
  /* «A, B, C и ещё 4» — чтобы ничья из десяти планов не превращалась в простыню */
  const someTitles = (list, n) => list.slice(0, n).map(x => x.o.title).join(', ') + (list.length > n ? ` и ещё ${list.length - n}` : '');
  /* Итог в общий чат: коротко, ссылка на голосование — всегда, чтобы присоединились и те, кто ещё не отметился */
  function verdictText(votes, forced) {
    const v = verdict(votes, forced);
    const L = [`${MC.emoji} ${groupTitle()} — итог`];
    if (v.win) {
      L.push(`📍 ${v.win.o.title}${v.wheel ? ' (выбрало колесо)' : ''}`);
      const st = v.plan ? K.planStops(v.plan) : [];
      if (st.length > 1 || (st[0] && st[0].name !== v.win.o.title)) L.push('   ' + st.map(p => p.name).join(' → '));
      if (v.ev && evPlaceLine(v.ev)) L.push('   ' + evPlaceLine(v.ev));
    } else if (v.leaders.length > 1) L.push(`📍 Пока ничья: ${someTitles(v.leaders, 3)}`);
    if (v.day) L.push(`📅 ${shortDay(v.day.d)}${v.ev && v.ev.time ? ', ' + v.ev.time : v.slot ? ', ' + v.slot.tm : ''} — ${canLine(v, true)}`);
    else if (v.slot && !(v.ev && v.ev.time)) L.push(`🕗 Во сколько: ${v.slot.tm}${v.slot.who.length ? ' (' + v.slot.who.length + ')' : ''}`);
    if (v.t.plus) L.push(`👥 Идут: ${v.t.inV.length} + ${v.t.plus} ${plural(v.t.plus, 'гость', 'гостя', 'гостей')}`);
    const dl = deadline();
    if (dl) L.push(dl.closed ? '🔒 Голосование закрыто' : `⏳ Голосуем до ${dl.text}`);
    if (v.plan) L.push(`🗺 Маршрут: ${K.goRoute(v.plan.id)}`);
    if (S.sent && S.sent.booked) L.push(`✅ Забронировано — ${S.sent.booked}`);
    if (v.ev && evUrl(v.ev)) L.push(`🎫 Билеты: ${evUrl(v.ev)}`);
    L.push(`🗳 ${v.win ? 'Итоги и голосование' : 'Голосуем тут'}: ${shareLink()}`);
    return L.join('\n');
  }
  function verdictHtml(votes, forced, t) {
    const v = verdict(votes, forced, t);
    if (!v.t.inV.length || (!v.win && !v.day && v.leaders.length < 2)) return '';
    const tie = !v.win && v.leaders.length > 1;
    const noOpts = !v.t.opt.length;
    const evNext = v.ev && !v.day ? evDaysAll(v.ev)[0] || '' : '';
    const calDay = v.day ? K.numDay(v.day.d) : evNext;
    const cal = calDay ? {
      title: groupTitle() + (v.win ? ' · ' + v.win.o.title : ''), day: calDay, time: (v.ev && v.ev.time) || (v.slot && v.slot.tm) || '', minutes: v.ev ? EV_MIN[v.ev.cat] : undefined,
      location: v.plan ? placeLoc(v.plan) : v.ev ? evLoc(v.ev) : '', details: v.plan ? planDetails(v.plan) : v.ev ? evUrl(v.ev) : '',
    } : null;
    const title = v.win ? esc(v.win.o.title)
      : tie ? (v.leaders.length === 2 ? v.leaders.map(x => esc(x.o.title)).join(' или ') : `${v.leaders.length} ${plural(v.leaders.length, 'вариант', 'варианта', 'вариантов')} с равными голосами`)
        : noOpts && v.day ? esc(shortDay(v.day.d)) : 'Место пока не выбрано';
    return `<div class="tally verdict">
      <p class="eyebrow">${v.wheel ? 'Колесо решило' : tie ? 'Пока ничья' : noOpts ? 'Удобнее всего' : 'Пока лидирует'}</p>
      <h3 class="v-title">${title}</h3>
      ${tie && v.leaders.length > 2 ? `<div class="v-tie">${v.leaders.slice(0, 4).map(x => `<span>${esc(x.o.emoji || '📍')} ${esc(x.o.title)}</span>`).join('')}${v.leaders.length > 4 ? `<span class="more">+${v.leaders.length - 4}</span>` : ''}</div>` : ''}
      ${tie ? `<p class="v-day">${v.t.inV.length < 2 ? 'Подожди голоса остальных или крутани колесо ниже' : 'Крутани колесо ниже — оно решит'}</p>` : ''}
      ${v.ev && evPlaceLine(v.ev) ? `<p class="v-day">${I('pin')}${esc(evPlaceLine(v.ev))}</p>` : ''}
      ${v.day ? `<p class="v-day">${I('calendar')}${esc(shortDay(v.day.d))}${v.ev && v.ev.time ? ' · ' + esc(v.ev.time) : v.slot ? ' · ' + esc(v.slot.tm) : ''} · ${esc(canLine(v))}</p>`
        : evNext ? `<p class="v-day">${I('calendar')}Ближайший показ: ${esc(dayShort(evNext))}${v.ev.time ? ' · ' + esc(v.ev.time) : ''}</p>` : ''}
      ${!v.day && v.slot && !(v.ev && v.ev.time) ? `<p class="v-day">${I('clock')}Во сколько: ${esc(v.slot.tm)}${v.slot.who.length ? ' · ' + v.slot.who.length + ' ' + plural(v.slot.who.length, 'голос', 'голоса', 'голосов') : ''}</p>` : ''}
      ${v.t.plus ? `<p class="v-day">${I('users')}Идут ${v.t.inV.length} + ${v.t.plus} ${plural(v.t.plus, 'гость', 'гостя', 'гостей')}</p>` : ''}
      ${v.plan ? planBlock(v.plan) : ''}
      ${v.ev ? evLinks(v.ev) : ''}
      ${cal ? calBlock(cal) : ''}
      ${PREVIEW ? '' : `<button class="btn btn-soft btn-wide verdict-share">${I('send')}Отправить итог в чат</button>`}
      ${PREVIEW || !window.KudaShareCard || !v.win ? '' : `<button class="btn btn-soft btn-wide verdict-card">🖼️ Картинка с итогом</button>`}
      ${PREVIEW || !v.plan ? '' : bookBox(K.bookStop(K.planStops(v.plan)), { n: v.t.inV.length + v.t.plus, day: v.day ? K.numDay(v.day.d) : '', time: v.slot ? v.slot.tm : '', name: S.a.name || '' })}
    </div>`;
  }
  function tallyHtml(votes, forced, t) {
    t = t || tally(votes);
    const max = Math.max(1, t.inV.length);
    const leaders = leadersOf(t);
    const row = (cls, title, who, n, attr) => `<div class="t-item${cls}"${attr || ''}><i class="bar" style="width:${(n / max * 100).toFixed(0)}%"></i>
      <span class="n">${esc(title)}<small>${who}</small></span><span class="c">${n}<span class="vh"> ${plural(n, 'голос', 'голоса', 'голосов')}</span></span></div>`;
    const liveOn = live() && SYNC === 'on';
    const slotsHtml = t.slots.length && t.slots.some(x => x.who.length) ? `<div class="tally"><h3>Во сколько</h3>
        ${t.slots.map(x => row(x.who.length && x.who.length === t.slots[0].who.length ? ' lead' : '', x.tm, x.who.length ? esc(x.who.join(', ')) : 'пока никто', x.who.length)).join('')}</div>` : '';
    return `${deadlineHtml()}${verdictHtml(votes, forced, t)}
      <div class="tally">
        <h3>Проголосовали: ${votes.length}</h3>
        <div class="voters">${votes.length ? votes.map(v => `<span class="${v.y ? '' : 'out'}">${esc(v.n)}${v.y ? '' : '<span class="vh"> — не сможет</span>'}</span>`).join('') : '<span>пока никого</span>'}</div>
        ${votes.length && !PREVIEW ? `<p class="hint">${liveOn ? 'Кого нет в списке — те ещё не отметились.' : 'Здесь голоса из ссылок, которые дошли до тебя.'}</p>` : ''}
      </div>
      ${t.opt.length ? `<div class="tally"><h3>Куда</h3>
        ${t.opt.map(x => row(leaders.includes(x) ? ' lead' : '', x.o.title, x.who.length ? esc(x.who.join(', ')) : x.o.when ? esc(x.o.when) : 'пока никто', x.who.length, ` data-i="${x.i}"`)).join('')}
        ${t.any.length ? `<p class="hint">Подойдёт любой вариант: ${esc(t.any.join(', '))}</p>` : ''}
        ${leaders.length > 1 && forced == null ? `<button class="btn btn-soft dashed btn-wide wheel">${I('wheel')}Ничья — крутить колесо</button>` : ''}
      </div>` : ''}
      ${t.days.length || t.idk.length ? `<div class="tally"><h3>Когда</h3>
        ${t.days.slice(0, 6).map(x => row(x.w === t.days[0].w ? ' lead' : '', shortDay(x.d), esc(x.who.join(', ')), x.w)).join('')}
        ${t.days.some(x => x.who.some(n => /\?$/.test(n))) ? '<p class="hint">«?» — может быть, считается за полголоса.</p>' : ''}
        ${t.idk.length ? `<p class="hint">Пока не знают, когда смогут: ${esc(t.idk.join(', '))}</p>` : ''}
      </div>` : ''}${slotsHtml}`;
  }

  /* ---------- финал компании: имя и голос ---------- */
  function scrFinalGroup(el) {
    const name = S.a.name || knownName();
    const out = S.a.coming === false;
    el.innerHTML = `
      <div class="res-head"><p class="eyebrow">${esc(groupTitle())}</p><h2 class="final-title">${out ? 'Жаль, что не получится' : 'Последний шаг'}</h2></div>
      <div class="final-cat"><div class="cat-slot">${K.catSVG(out ? 'sad' : 'happy')}</div><div class="bubble b-left">Как тебя записать в голосовании?</div></div>
      <form class="name-box" novalidate>
        <input class="field nm" maxlength="30" placeholder="Например: Петя" value="${esc(name)}" aria-label="Твоё имя" autocomplete="given-name" enterkeyhint="done">
        ${out ? '' : `<div class="plus-row" role="group" aria-label="Сколько человек приведёшь с собой"><span>Со мной ещё</span><button type="button" class="btn btn-soft sq pl-dec" aria-label="Меньше">−</button><b class="pl-n" aria-live="polite">+${S.a.plus || 0}</b><button type="button" class="btn btn-soft sq pl-inc" aria-label="Больше">+</button></div>`}
        <button class="btn btn-primary btn-wide send" type="submit">Готово${I('check')}</button>
      </form>
      ${!out && myVote() ? `<button class="link-btn decline" type="button">Планы поменялись — не смогу</button>` : ''}
      <div class="vstate warn twin hidden" role="group" aria-labelledby="twin-t"></div>`;
    const form = $('.name-box', el), inp = $('.nm', el), btn = $('.send', el), twinBox = $('.twin', el);
    const plusN = $('.pl-n', el);
    const setPlus = n => { S.a.plus = Math.max(0, Math.min(5, n)); save(); if (plusN) plusN.textContent = '+' + S.a.plus; };
    if (plusN) { $('.pl-dec', el).onclick = () => { Sfx.click(); setPlus((S.a.plus || 0) - 1); }; $('.pl-inc', el).onclick = () => { Sfx.click(); setPlus((S.a.plus || 0) + 1); }; }
    // «Изменить голос» ведёт сразу к вариантам, мимо письма с «Не смогу» — отказаться можно здесь
    const decline = $('.decline', el);
    if (decline) decline.onclick = () => {
      Sfx.click();
      S.a.coming = false; S.a.opts = []; S.a.days = [];
      S.a.name = inp.value.trim().slice(0, 30) || S.a.name; save();
      go(STEPS.length - 1);
    };
    let sent = false, asked = false;
    btn.disabled = !inp.value.trim();
    inp.oninput = () => { btn.disabled = sent || !inp.value.trim(); };
    form.onsubmit = e => {
      e.preventDefault();
      // второе нажатие (двойной тап, Enter) голос не дублирует
      if (sent || !inp.value.trim()) return;
      S.a.name = inp.value.trim().slice(0, 30); save();
      if (!PREVIEW) { try { localStorage.setItem('kuda-name', S.a.name); } catch (e2) { /* ок */ } }
      const twin = asked ? null : twinOf(S.a.name);
      if (twin) { asked = true; askTwin(twin); return; }
      submit();
    };
    function submit() {
      if (sent) return;
      sent = true; btn.disabled = true;
      Sfx.success(); vibrate([20, 40, 20]);
      const today = todayNum(), prev = myVote();
      // время голоса — не раньше прежнего: часы телефона могут отставать от сервера, а побеждает более поздний голос
      const mine = {
        id: voterId(), n: S.a.name, y: out ? 0 : 1, o: out ? [] : (S.a.opts || []),
        d: out ? [] : (S.a.days || []).map(K.dayNum).filter(n => n >= today), t: Math.max(Date.now(), prev ? prev.t + 1 : 0),
      };
      if (!out) {
        const m = (S.a.maybe || []).map(K.dayNum).filter(n => n >= today && !mine.d.includes(n));
        if (m.length) mine.m = m;
        if ((S.a.slots || []).length && slotList().length > 1) mine.s = S.a.slots.slice(0, 4);
        if (S.a.plus > 0) mine.p = Math.min(5, S.a.plus | 0);
      }
      addVotes([mine]);
      notify('vote');
      goal('vote', out ? 'no' : 'yes');
      VOTE_STATE = live() ? 'saving' : 'local';
      showResults(true);
      if (live()) pushVote(mine);
    }
    /* «Это ты?» — то же имя уже голосовало из другого браузера (например, из Telegram вместо Safari) */
    function askTwin(twin) {
      form.classList.add('hidden');
      twinBox.innerHTML = `
        <p class="vs-title" id="twin-t">${I('users')}<span>«${esc(twin.n)}» уже есть в голосовании</span></p>
        <p class="vs-text">Это ты — с другого телефона или браузера? Тогда просто обновим тот голос, чтобы в итогах не было двойника.</p>
        <button class="btn btn-primary btn-wide yes" type="button">Да, это я${I('check')}</button>
        <button class="link-btn no" type="button">Нет, это другой человек</button>`;
      twinBox.classList.remove('hidden');
      const yes = $('.yes', twinBox);
      yes.focus();
      yes.onclick = () => { Sfx.click(); adoptVoter(twin); submit(); };
      $('.no', twinBox).onclick = () => { Sfx.click(); submit(); };
    }
  }
  /* Голос с таким же именем под другим id, а своего голоса в этом браузере нет — скорее всего, это тот же человек */
  function twinOf(name) {
    if (PREVIEW || myVote()) return null;
    const n = String(name || '').trim().toLowerCase();
    return n ? PRIOR.find(v => v.id !== VOTER_ID && String(v.n).trim().toLowerCase() === n) || null : null;
  }
  function setVoter(id) {
    VOTER_ID = id;
    if (!PREVIEW) { try { localStorage.setItem('kuda-voter:' + INV_ID, id); } catch (e) { /* ок */ } }
  }
  /* «Да, это я»: голосуем под id того голоса. С сервером это ещё не точно: голос, отправленный из другого браузера,
     защищён его секретом — тогда сервер ответит owner и всё вернётся как было (undoAdopt) */
  let ADOPT = null;     // { id, prev: прежний id этого браузера, orig: голос до перезаписи }
  let LOCKED = '';      // имя голоса, который сервер не дал перезаписать отсюда
  function adoptVoter(twin) {
    if (!VOTER_RE.test(twin.id)) return;
    ADOPT = live() ? { id: twin.id, prev: voterId(), orig: Object.assign({}, twin) } : null;
    LOCKED = '';
    setVoter(twin.id);
  }
  function undoAdopt() {
    const a = ADOPT;
    ADOPT = null;
    if (!a) return;
    setVoter(a.prev);
    PRIOR = PRIOR.map(v => (v.id === a.id ? a.orig : v));
    if (!PREVIEW) { try { localStorage.setItem(VKEY(), JSON.stringify(PRIOR.slice(-60))); } catch (e) { /* ок */ } }
    LOCKED = a.orig.n;
  }

  /* «Изменить голос»: прежний выбор подставлен, мини-игру не повторяем */
  function revote() {
    const my = myVote();
    S.a = freshAnswers();
    if (!my) { restep(); go(1); return; }
    const today = todayNum();
    Object.assign(S.a, { yes: !!my.y, coming: my.y ? true : null, opts: my.o.slice(), days: my.d.filter(d => d >= today).map(K.numDay), name: my.n });
    restep();
    const at = id => STEPS.findIndex(s => s.id === id);
    let i = my.y ? [at('vote'), at('date')].find(x => x > 0) : at('letter');
    if (!(i > 0)) i = my.y ? STEPS.length - 1 : 1;
    go(i);
  }

  /* ---------- итоги ---------- */
  function showResults(justVoted) {
    showScreen('results', el => {
      let dead = false, pending = false, lastState = '', first = true;
      const known = new Set(PRIOR.map(v => v.id));
      el.innerHTML = `
        <div class="res-head">
          <p class="eyebrow">${esc(groupTitle())}${justVoted ? '' : ' · зовёт ' + esc(INV.me)}</p>
          <h2 class="final-title">${justVoted ? 'Голос учтён' : 'Итоги голосования'}</h2>
          ${justVoted ? '' : '<p class="sub res-sub"></p>'}
        </div>
        <div class="vstate"></div>
        <p class="vh vs-live" role="status" aria-live="polite"></p>
        <p class="live-note hidden"><i class="live-dot" aria-hidden="true"></i>Обновляется автоматически</p>
        <div class="tally-wrap"></div>
        ${PREVIEW ? '' : `<div class="merge-box">
          <button class="link-btn merge-open" aria-expanded="false">${live() ? 'Есть старые ссылки с голосами? Добавить их' : 'Голоса разошлись по разным ссылкам? Объединить'}</button>
          <div class="merge hidden">
            <textarea class="field" rows="3" placeholder="Вставь сюда ссылки из чата — можно сразу несколько" aria-label="Ссылки с голосами"></textarea>
            <button class="btn btn-soft merge-go">Объединить голоса</button>
          </div>
        </div>`}
        <div class="actions">
          <button class="link-btn revote">${myVote() ? I('redo') + 'Изменить мой голос' : I('check') + 'Проголосовать'}</button>
          <a class="link-btn" href="${esc(hubUrl('m=' + MODE + '&from=invite' + refQ()))}">Создать свой сбор${I('arrow')}</a>
        </div>
        ${justVoted && !PREVIEW && !OWN ? guestBlock() : ''}`;
      const wrap = $('.tally-wrap', el), box = $('.vstate', el), liveNote = $('.live-note', el), sr = $('.vs-live', el);

      /* Поделиться: текст готов заранее, вызываем сразу по нажатию */
      const markSent = () => {
        const my = myVote();
        if (my && !PREVIEW) { S.sent.vote = voteSig(my); save(); }
        renderState();
      };
      function manualCopy(text) {
        let m = $('.manual-copy', box);
        if (!m) {
          box.insertAdjacentHTML('beforeend', `<label class="manual-copy"><span>Скопируй вручную:</span><textarea class="field" rows="3" readonly></textarea></label>`);
          m = $('.manual-copy', box);
        }
        const ta = $('textarea', m);
        ta.value = text;
        ta.focus(); ta.select();
      }
      function copyThen(text, okMsg, onOk) {
        copyText(text).then(ok => {
          if (ok) { toast(okMsg); if (onOk) onOk(); } else { toast('Не получилось скопировать — скопируй текст вручную'); manualCopy(text); }
        });
      }
      function shareNow(text, okMsg, onOk) {
        if (navigator.share) {
          navigator.share({ text }).then(() => { if (onOk) onOk(); }, e => { if (!e || e.name !== 'AbortError') copyThen(text, okMsg, onOk); });
          return;
        }
        copyThen(text, okMsg, onOk);
      }

      function stateKey() {
        const my = myVote();
        return [PREVIEW, !!my, my && my.y, VOTE_STATE, voteSaved(), voteSent(), SYNC, LOCKED].join('|');
      }
      /* Карточка «что с моим голосом» + кнопки «Отправить в чат» / «Скопировать ссылку» */
      function renderState() {
        const k = stateKey();
        if (k === lastState) return;
        lastState = k;
        if (PREVIEW) {
          box.className = 'vstate muted';
          box.innerHTML = `<p class="vs-text">Это превью: голоса ненастоящие, ссылкой отсюда не поделиться.</p>`;
          return;
        }
        const my = myVote(), u = hostTg();
        let cls = 'plain', title = '', text = '';
        if (my) {
          if (voteSaved()) { cls = 'ok'; title = 'Голос сохранён'; text = 'Остальные увидят его сами. Позови в чат тех, кто ещё не отметился.'; }
          else if (VOTE_STATE === 'saving') { cls = 'busy'; title = 'Сохраняю голос…'; }
          else if (voteSent()) { cls = 'ok'; title = 'Ссылка с голосом отправлена'; text = 'Изменишь голос — отправь новую ссылку, иначе остальные увидят старый.'; }
          else if (live() && !SYNC) { cls = 'busy'; title = 'Проверяю, сохранён ли голос…'; }
          else { cls = 'warn'; title = 'Твой голос пока только у тебя'; text = MC.done || 'Отправь ссылку в чат, иначе остальные его не увидят.'; }
        } else if (LOCKED) {
          cls = 'warn'; title = `Голос «${LOCKED}» отсюда не поменять`;
          text = 'Он отправлен из другого браузера — поменять его можно только там, в итогах остаётся прежний. Если это другой человек с таким же именем, нажми «Проголосовать» ниже.';
        }
        box.className = 'vstate ' + cls;
        if (sr.textContent !== title) sr.textContent = title;
        const fk = focusKey(box);
        box.innerHTML = `
          ${title ? `<p class="vs-title">${cls === 'ok' ? I('check') : cls === 'warn' ? I('send') : ''}<span>${esc(title)}</span></p>` : ''}
          ${text ? `<p class="vs-text">${esc(text)}</p>` : ''}
          <div class="share-row">
            <button class="btn btn-primary share${cls === 'warn' ? ' pulse' : ''}">${I('chat')}Отправить в чат</button>
            <button class="btn btn-soft sq copy" aria-label="Скопировать ссылку" title="Скопировать ссылку">${I('link')}</button>
          </div>
          ${u && my && cls === 'warn' ? `<button class="link-btn tg">${I('send')}Отправить в Telegram — @${esc(u)}</button>` : ''}`;
        $('.share', box).onclick = () => { Sfx.click(); shareNow(shareText(), 'Скопировано — вставь в общий чат 💬', markSent); };
        $('.copy', box).onclick = () => { Sfx.click(); copyThen(shareLink(), 'Ссылка скопирована 🔗', markSent); };
        const tg = $('.tg', box);
        if (tg) tg.onclick = () => {
          Sfx.click();
          const text = shareText();
          copyText(text);
          markSent();
          location.href = K.tgLink(u, text);
        };
        // «Отправить в чат» сам меняет карточку (markSent) — фокус остаётся на той же кнопке
        restoreFocus(box, fk, '.share');
      }

      function render() {
        if (dead) return;
        pending = false;
        revokeCal();
        const t = tally(PRIOR);
        FORCED = forcedFor(t);
        // кто-то проголосовал, а фокус был на кнопке итогов — после перерисовки возвращаем его на ту же кнопку
        const fk = focusKey(wrap);
        wrap.innerHTML = tallyHtml(PRIOR, FORCED, t);
        // компания решила: один лидер, когда «иду» сказали хотя бы двое, или выбор колеса — цель «decision» (один раз)
        if (!PREVIEW && !S.sent.decision) {
          const v = verdict(PRIOR, FORCED, t);
          if (v.win && (v.wheel || t.inV.length >= 2)) { S.sent.decision = 1; save(); goal('decision', v.wheel ? 'wheel' : 'group'); }
        }
        const wheel = $('.wheel', wrap);
        if (wheel) wheel.onclick = () => spin(wrap, wheel, i => {
          if (dead) return;
          const sig = leadSig(leadersOf(tally(PRIOR)));
          saveLocalSpin(i, sig);
          if (live()) {
            // L — лидеры этой ничьей: у каждой новой ничьей свой итог на сервере (длиннее 60 знаков сервер не примет)
            api('spin', CODE, sig.length <= 60 ? { i, L: sig } : { i }).then(r => {
              if (r && r.spin && Number.isInteger(r.spin.i)) {
                SPIN = r.spin;
                if (r.spins && typeof r.spins === 'object' && !Array.isArray(r.spins)) SPINS = r.spins;
                render();
              }
            });
          }
          render();
          // кнопки колеса больше нет — фокус на итог
          refocus($('.v-title', wrap));
          wrap.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
        });
        const vs = $('.verdict-share', wrap);
        if (vs) vs.onclick = () => { Sfx.click(); shareNow(verdictText(PRIOR, FORCED), 'Итог скопирован — вставь в общий чат'); };
        wireBook(wrap);
        const vc = $('.verdict-card', wrap);
        if (vc) vc.onclick = () => {
          Sfx.click();
          const v = verdict(PRIOR, FORCED);
          if (!v.win) return;
          const st = v.plan ? K.planStops(v.plan) : [];
          const when = [v.day ? shortDay(v.day.d) : '', v.ev && v.ev.time ? v.ev.time : v.slot ? v.slot.tm : ''].filter(Boolean).join(' · ');
          const ppl = v.t.plus ? `идут ${v.t.inV.length} + ${v.t.plus}` : `идут ${v.t.inV.length}`;
          vc.disabled = true;
          window.KudaShareCard.share({ title: v.win.o.title, sub: [when, ppl].filter(Boolean).join(' · '), mode: MODE, size: 'square', fileName: 'itog',
            city: (K.cityConf(K.cityOf(v.plan || v.ev || {})) || {}).name || '', url: shareLink(),
            stops: st.length ? st.map(p => ({ emoji: p.emoji, name: p.name, meta: K.metroText(p.metro), lat: p.lat, lon: p.lon })) : [{ emoji: v.win.o.emoji || '📍', name: v.win.o.title, meta: v.ev ? v.ev.venue || '' : '' }] })
            .then(r => { vc.disabled = false; if (r === 'saved') toast('Картинка сохранена — кидай в общий чат'); else if (r === 'error') toast('Не получилось нарисовать картинку'); });
        };
        restoreFocus(wrap, fk, '.v-title');
        renderState();
        liveNote.classList.toggle('hidden', !(live() && SYNC === 'on'));
        if (justVoted) $('.final-title', el).textContent = myVote() || !LOCKED ? 'Голос учтён' : 'Голос не изменён';
        const sub = $('.res-sub', el);
        if (sub) sub.textContent = live() && SYNC !== 'off' ? 'Итоги общие для всех и обновляются сами.' : 'Смотри, куда и когда удобно всем.';
        const rv = $('.revote', el);
        if (rv) rv.innerHTML = myVote() ? I('redo') + 'Изменить мой голос' : I('check') + 'Проголосовать';
        // кто-то проголосовал, пока экран открыт
        const fresh = PRIOR.filter(v => !known.has(v.id));
        fresh.forEach(v => known.add(v.id));
        const others = fresh.filter(v => v.id !== VOTER_ID);
        if (!first && others.length) toast(`Новый голос: ${others.map(v => v.n).join(', ')}`);
        first = false;
        prepareShare();
      }
      render();
      // голоса меняются: сервер, другая вкладка, «Объединить». Во время колеса не перерисовываем
      const off = onVotes(() => { if (SPINNING) pending = true; else render(); });
      const afterSpin = () => { if (pending) render(); };
      SPIN_DONE.add(afterSpin);
      const stopPoll = live() && typeof API.poll === 'function' ? API.poll(CODE, r => { applyRemote(r); }, REV >= 0 ? { interval: 15000, rev: REV } : { interval: 15000 }) : null;
      const burst = justVoted ? setTimeout(() => FX.burst({ n: 120, power: 1.1 }), 250) : 0;

      if (!PREVIEW) {
        const openBtn = $('.merge-open', el);
        openBtn.onclick = () => {
          const m = $('.merge', el);
          m.classList.toggle('hidden');
          openBtn.setAttribute('aria-expanded', String(!m.classList.contains('hidden')));
        };
        $('.merge-go', el).onclick = async () => {
          const go2 = $('.merge-go', el);
          if (go2.disabled) return;
          go2.disabled = true;
          try { await mergeLinks($('.merge textarea', el)); } finally { go2.disabled = false; }
        };
      }
      $('.revote', el).onclick = () => { Sfx.click(); revote(); };
      return () => {
        dead = true;
        off();
        SPIN_DONE.delete(afterSpin);
        if (stopPoll) stopPoll();
        clearTimeout(burst);
        revokeCal();
      };
    });
  }

  /* «Объединить»: ссылки с голосами из чата. Свои короткие ссылки (go.html#s=…) раскрываем через сервер или посредника */
  async function mergeLinks(area) {
    let text = area.value;
    let lost = 0;
    for (const m of text.match(/go\.html#s=[A-Za-z0-9_-]{1,16}/g) || []) {
      const code = m.split('=')[1];
      let url = API_ON ? await api('expand', code) : null;
      const relay = TG.relayUrl;
      if (!url && relay) {
        try {
          // посредник (Apps Script) просыпается долго, но дольше 10 с не ждём
          const j = await Promise.race([
            fetch(relay + (relay.includes('?') ? '&' : '?') + 's=' + code).then(r => r.json()),
            new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 10000)),
          ]);
          if (j && j.ok && typeof j.url === 'string') url = j.url;
        } catch (e) { /* ниже — посчитаем как нераскрытую */ }
      }
      if (url) text += '\n' + url; else lost++;
    }
    // чужие сокращатели браузер раскрыть не может — говорим прямо, а не теряем молча
    lost += (text.match(/https?:\/\/(clck\.ru|is\.gd|vk\.cc|bit\.ly)\/[A-Za-z0-9_-]+/g) || []).length;
    const lostMsg = lost ? ` ${lost} ${plural(lost, 'короткую ссылку', 'короткие ссылки', 'коротких ссылок')} не получилось раскрыть — открой ${lost > 1 ? 'их' : 'её'} и вставь сюда полный адрес из браузера.` : '';
    const re = /#([A-Za-z0-9_-]+)((?:&[A-Za-z]+=[A-Za-z0-9_-]*)+)/g;
    let m, added = 0, foreign = 0;
    const lists = [];
    while ((m = re.exec(text))) {
      const v = /&v=([A-Za-z0-9_-]+)/.exec(m[2]);
      if (!v) continue;
      if (m[1] !== CODE) { foreign++; continue; }
      try { lists.push(await K.decodeData(v[1])); added++; } catch (e) { /* битая ссылка */ }
    }
    if (!added) { toast(lostMsg ? lostMsg.trim() : foreign ? 'Это ссылки от другого сбора' : 'Не нашёл ссылок с голосами'); return; }
    addVotes(...lists);
    area.value = '';
    Sfx.success();
    toast(`Готово! Голосов теперь: ${PRIOR.length}.` + lostMsg);
    // голоса из старых ссылок досылаем на сервер вместе со своим
    const my = myVote();
    if (live() && my) pushVote(my);
  }

  /* Колесо при ничьей: не больше 8 секторов и не дольше ~5 секунд. Победителя знаем заранее (wheelPlan) */
  let SPINNING = false;
  const SPIN_DONE = new Set();
  function spin(wrap, btn, onWin) {
    const all = $$('.t-item.lead[data-i]', wrap);
    if (all.length < 2 || SPINNING) return;
    const plan = wheelPlan(all.map(x => +x.dataset.i));
    const items = all.filter(x => plan.sub.includes(+x.dataset.i));
    if (all.length > WHEEL_MAX) toast(`В колесе ${WHEEL_MAX} вариантов из ${all.length} с равными голосами`);
    const winner = Math.max(0, items.findIndex(x => +x.dataset.i === plan.win));
    SPINNING = true;
    btn.disabled = true;
    const total = items.length * Math.max(3, Math.ceil(18 / items.length)) + winner;
    let k = 0;
    const finish = () => { SPINNING = false; SPIN_DONE.forEach(f => f()); };
    const tick = () => {
      if (!wrap.isConnected) { finish(); return; }
      items.forEach(x => x.classList.remove('spin'));
      items[k % items.length].classList.add('spin');
      Sfx.tick();
      // замедление к концу: первые шаги быстрые, последние ~0,5 с
      if (k++ < total) { const f = k / total; setTimeout(tick, 55 + 420 * f * f * f); }
      else {
        Sfx.fanfare();
        FX.burst({ n: 100, power: 1 });
        toast('Колесо выбрало: ' + $('.n', items[winner]).firstChild.textContent);
        setTimeout(() => { SPINNING = false; if (onWin) onWin(plan.win); SPIN_DONE.forEach(f => f()); }, 900);
      }
    };
    tick();
  }

  /* ================= Ошибка ссылки ================= */
  function showError() {
    document.documentElement.style.cssText += ';' + K.catVars('line');
    stage.innerHTML = `<section class="screen"><div class="err">
      <div class="cat-slot">${K.catSVG('sad')}</div>
      <h2>Ой, ссылка сломалась</h2>
      <p class="sub">Похоже, ссылку скопировали не целиком. Попроси прислать её ещё раз.</p>
    </div></section>`;
  }

  /* Пример ответов для превью финала из конструктора */
  function demoAnswers() {
    if (GROUP) { Object.assign(S.a, { yes: true, coming: true, opts: [0], days: dayOptions().slice(0, 2), name: 'Ты' }); return; }
    const days = evChosen() ? EV_DAYS : K.listDates(INV.dates);
    const p = (INV.places || []).find(x => x && (x.title || K.planById(x.plan)));
    const tDef = K.toMin((EVENT && EVENT.time) || (INV.time && INV.time.def) || '19:00');
    Object.assign(S.a, {
      yes: true, hearts: INV.heartsGoal || 12,
      place: EVENT ? evPick(EVENT)
        : p ? { emoji: p.emoji || (K.planById(p.plan) || {}).emoji, title: p.title || (K.planById(p.plan) || {}).title, kind: '', plan: p.plan || '' } : { emoji: '🎁', title: 'Сюрприз', kind: 'surprise' },
      date: days[0] || '', dateOther: days[0] ? '' : 'в выходные',
      // «сначала» в окне через полночь записано как 24:30 — в билете это 00:30
      time: K.fromMin(tDef), timeNext: tDef >= 1440,
      food: (INV.food || []).filter(f => f && f.title).slice(0, 2).map(f => ({ emoji: f.emoji, title: f.title })),
    });
  }

  /* ================= Запуск ================= */
  /* Свидание на событие: если выбрали событие (или его не из чего выбирать), день и время берём из афиши.
     Один день — уровень «Когда» пропускаем, есть время начала — пропускаем «Во сколько» */
  const placeOn = () => (INV.levels || {}).place !== false;
  const evChosen = () => !!EVENT && (!placeOn() || !S.a.place || S.a.place.kind === 'event');
  function applyEvent() {
    const pre = { date: '', time: '' };
    if (EV_DAYS.length === 1) { S.a.date = EV_DAYS[0]; S.a.dateOther = ''; pre.date = S.a.date; }
    else if (S.a.date && !EV_DAYS.includes(S.a.date)) S.a.date = '';
    if (EVENT.time) { S.a.time = EVENT.time; S.a.timeNext = false; pre.time = EVENT.time; }
    if (!placeOn()) S.a.place = evPick(EVENT);
    S.a.pre = pre;
  }
  /* Выбрали другое место — подставленные из события день и время снимаем */
  function dropEvent() {
    const pre = S.a.pre;
    if (pre) {
      if (pre.date && S.a.date === pre.date) S.a.date = '';
      if (pre.time && S.a.time === pre.time) S.a.time = '';
    }
    S.a.pre = null;
  }
  const RUNNERS = { hearts: lvlHearts, letter: lvlLetter, place: lvlPlace, date: lvlDate, time: lvlTime, food: lvlFood, vote: lvlVote, slot: lvlSlot };
  function buildSteps() {
    const on = INV.levels || {};
    const list = [{ id: 'intro', run: scrIntro }];
    let n = 0;
    const ev = !GROUP && evChosen();
    if (ev) applyEvent();
    const ids = GROUP ? ['hearts', 'letter', 'vote', 'date', 'slot'] : ['hearts', 'letter', 'place', 'date', 'time', 'food'];
    for (const id of ids) {
      if (on[id] === false && !(GROUP && id === 'letter')) continue;
      if (id === 'vote' && !(INV.opts || []).length) continue;
      if (id === 'place' && !EVENT && !placeOpts().length) continue;
      if (id === 'date' && GROUP && !groupDays().length) continue;
      if (id === 'date' && ev && EV_DAYS.length === 1) continue;
      if (id === 'time' && ev && EVENT.time) continue;
      if (id === 'food' && !(INV.food || []).some(f => f && f.title)) continue;
      if (id === 'slot' && slotList().length < 2) continue;
      list.push({ id, level: ++n, run: RUNNERS[id] });
    }
    list.push({ id: 'final', run: scrFinal });
    LEVEL_COUNT = n;
    return list;
  }
  /* Шаги зависят от выбора места (событие или нет) — пересобираем после выбора */
  function restep() {
    STEPS = buildSteps();
    renderProgress();
  }
  function floaters() {
    const box = $('.floaters');
    box.innerHTML = Array.from({ length: 14 }, () =>
      `<i style="--x:${rand(0, 100).toFixed(1)}%;--s:${rand(10, 24).toFixed(0)}px;--t:${rand(9, 17).toFixed(1)}s;--d:${(-rand(0, 17)).toFixed(1)}s"></i>`).join('');
  }
  /* Другие вкладки этого браузера: новые голоса, итог колеса, «ссылку уже отправили» */
  function onStorage(e) {
    if (!e.key) return;
    if (e.key === VKEY()) { addVotes(); return; }
    if (e.key === SKEY()) { LOCAL_SPIN = null; votesChanged(); return; }
    if (e.key === KEY && e.newValue) {
      try {
        const d = JSON.parse(e.newValue);
        if (d && d.sent && typeof d.sent === 'object') { Object.assign(S.sent, d.sent); votesChanged(); }
      } catch (err) { /* чужой формат */ }
    }
  }
  /* Итог колеса из ссылки (&w=) — если ничья в голосах всё та же */
  function adoptLinkSpin() {
    const m = /(?:^#|&)w=(\d{1,3})(?=&|$)/.exec(location.hash);
    if (!m) return;
    const L = leadersOf(tally(PRIOR));
    if (L.length < 2) return;
    const loc = readLocalSpin();
    if (loc && loc.L === leadSig(L)) return;
    if (+m[1] === wheelPlan(L.map(x => x.i)).win) saveLocalSpin(+m[1], leadSig(L));
  }

  /* Афиша нужна только приглашениям с событием — её грузим тогда, остальные открываются без неё:
     assets/events.js (Москва, ~130 КБ), events-spb.js (Петербург) и sport.js (футбольные матчи обоих городов).
     Качаются параллельно, выполняются по порядку (async = false): events.js записывает window.KUDA_EVENTS заново,
     events-spb.js и sport.js дописывают в него свои. События из auto.js (он уже выполнен) возвращаем, если таких id в афише нет */
  const EV_FILES = ['assets/events.js', 'assets/events-spb.js', 'assets/sport.js'];
  const needsEvents = inv => !!inv.event || (Array.isArray(inv.opts) && inv.opts.some(o => o && o.event));
  function loadEvents() {
    const files = EV_FILES.filter(f => !document.querySelector('script[src*="' + f + '"]'));
    if (!files.length) return Promise.resolve();
    const before = Array.isArray(window.KUDA_EVENTS) ? window.KUDA_EVENTS.slice() : [];
    return Promise.all(files.map(f => new Promise(ok => {
      const s = document.createElement('script');
      s.src = f + VER;
      s.async = false;
      s.onload = s.onerror = () => ok();   // без сети — откроется как приглашение без события
      document.head.appendChild(s);
    }))).then(() => {
      const E = Array.isArray(window.KUDA_EVENTS) ? window.KUDA_EVENTS : (window.KUDA_EVENTS = []);
      const seen = new Set(E.map(e => e && e.id));
      before.forEach(e => { if (e && !seen.has(e.id)) { seen.add(e.id); E.push(e); } });
    });
  }

  async function init() {
    const h = K.readHash();
    PREVIEW = h.preview;
    let inv = K.defaults();
    if (h.code) {
      try { inv = K.merge(inv, await K.decodeInvite(h.code)); }
      catch (e) { showError(); return; }
    }
    const evReady = needsEvents(inv) ? loadEvents() : null;
    INV = inv;
    CODE = h.code;
    INV_ID = K.hash(h.code || JSON.stringify(inv));
    KEY = 'date-invite:' + INV_ID;
    // своё: отмечено конструктором (kuda-own) или лежит в его истории — у старых приглашений есть только история
    OWN = !!h.code && !PREVIEW && (isOwn(INV_ID) || inHistory(h.code));
    MODE = K.modeOf(INV); MC = Object.assign({}, K.MODES[MODE]); GROUP = !!MC.group;
    if (DONE[MODE]) MC.done = DONE[MODE];
    /* в свидании — не текст сбора пацанов/подружек */
    if (!GROUP) ['greeting', 'question'].forEach(k => {
      if (Object.values(K.MODES).some(m => m.group && INV[k] === m[k])) INV[k] = DEF[k];
    });
    document.documentElement.dataset.theme = K.THEMES.includes(INV.theme) ? INV.theme : (MC.theme || 'pink');
    document.documentElement.dataset.acc = MC.acc || '';
    document.documentElement.style.cssText += ';' + K.catVars(INV.cat);
    document.title = GROUP ? `${MC.emoji} ${groupTitle()}` : `💌 ${INV.her}, тебе приглашение`;
    load();
    if (evReady) await evReady;
    if (!GROUP && INV.event) {
      const ev = eventById(INV.event), days = ev ? evDays(ev) : [];
      if (days.length) { EVENT = ev; EV_DAYS = days; } else if (ev) EV_PAST = ev;
    }
    if (!EVENT && S.a.place && S.a.place.kind === 'event') { S.a.place = null; dropEvent(); }
    STEPS = buildSteps();
    floaters();
    if (GROUP) {
      voterId();
      let fromLink = [];
      if (h.votes) { try { fromLink = await K.decodeData(h.votes); } catch (e) { fromLink = []; } }
      mergeIn(fromLink);
      adoptLinkSpin();
      addEventListener('storage', onStorage);
    } else if (h.answer) {
      try { ANSWER = cleanAnswer(await K.decodeData(h.answer)); } catch (e) { ANSWER = null; }
    }

    const sb = $('#soundBtn');
    // переключатель: подпись постоянная, состояние — в aria-pressed («Звук, нажата» = звук включён)
    const sbSet = on => { sb.innerHTML = I(on ? 'sound' : 'mute'); sb.setAttribute('aria-pressed', String(on)); sb.setAttribute('aria-label', 'Звук'); };
    sbSet(Sfx.on);
    sb.onclick = () => { sbSet(Sfx.toggle()); Sfx.click(); };
    // звук разрешается только из «настоящего» жеста: touchend / click / keydown
    ['touchend', 'click', 'keydown'].forEach(ev => document.addEventListener(ev, () => Sfx.init(), { capture: true, passive: true }));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) Sfx.init(); });
    stage.addEventListener('click', e => {
      const c = e.target.closest('.cat');
      if (!c || c.closest('.catcher')) return;
      const box = c.parentElement;
      mood(box, 'happy', 900);
      Sfx.meow();
    });
    addEventListener('hashchange', () => location.reload());

    if (ANSWER) {
      PREVIEW = true;   // это ты смотришь её ответ — ничего не сохраняем и не отправляем
      S.a = Object.assign(freshAnswers(), ANSWER);
      showScreen('final', scrFinal);
      return;
    }
    // «открыли приглашение» — для «Моих приглашений» создателя (с этого устройства один раз; итоги по &r=1 смотрит сам создатель)
    if (live() && !h.results && !OWN) api('opened', CODE);
    if (GROUP) pullRemote();
    // дедлайн прошёл — голосовать поздно, сразу итог
    if (GROUP && (h.results || isClosed())) { showResults(false); return; }

    if (canNotify() && TG.notifyOpen !== false && !S.sent.open) {
      notify('open').then(ok => { if (ok) { S.sent.open = true; save(); } });
    }

    if (PREVIEW && h.start) {
      if (h.start >= STEPS.length - 1) demoAnswers();
      go(h.start);
      return;
    }
    if (GROUP) { go(0); return; }
    const saved = S.step;
    if (saved >= STEPS.length - 1 && saved > 0) { go(STEPS.length - 1); return; }
    RESUME_TARGET = clamp(saved, 1, STEPS.length - 1);
    RESUME = saved;
    go(0);
  }

  init();
})();

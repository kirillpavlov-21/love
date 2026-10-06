/* Игра-приглашение на свидание. Настройки — в config.js или в ссылке из create.html */
(function () {
  'use strict';

  const K = window.DateKit;
  const CFG = window.DATE_CONFIG || {};
  const TG = CFG.telegram || {};
  const TG_READY = !!TG.relayUrl;
  const stage = document.getElementById('stage');

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
  let PRIOR = [];           // голоса, которые уже лежат в ссылке (групповой режим)
  let VOTER_ID = '';
  let ANSWER = null;        // ответ девушки, открытый по ссылке-билету
  const DEF = K.defaults();
  const T = s => K.fill(s, INV);
  /* Текст режима: свой из приглашения или стандартный для пацанов/подружек */
  const MT = key => {
    const v = INV[key];
    return GROUP && (v == null || v === '' || v === DEF[key]) ? MC[key] : v;
  };
  const groupTitle = () => INV.title || MC.title || '';
  const canNotify = () => TG_READY && !PREVIEW && !!INV.tg;

  const freshAnswers = () => ({ yes: false, noTries: 0, hearts: 0, place: null, placeText: '', date: '', dateOther: '', time: '', food: null, note: '', coming: null, opts: [], days: [], name: '' });
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
    const heart = new Path2D(K.HEART_D);
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
        if (p.sh === 'heart') { const sc = p.s / 22; ctx.scale(sc, sc); ctx.translate(-12, -12); ctx.fill(heart); }
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
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2700);
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
  function mood(scope, m, ms) {
    const svg = $('.cat', scope);
    if (!svg) return;
    clearTimeout(svg._mt);
    svg.dataset.mood = m;
    if (ms) svg._mt = setTimeout(() => { svg.dataset.mood = svg.dataset.base || 'normal'; }, ms);
  }
  const head = (step, title, sub) =>
    `<div class="lvl-head"><span class="lvl-tag">Уровень ${step.level} из ${LEVEL_COUNT}</span><h2>${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}</div>`;
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

  function heartSVG(type, alpha) {
    const fill = type === 'gold' ? '#F5C451' : type === 'broken' ? '#5A5766' : 'var(--accent)';
    let extra = '';
    if (type === 'broken') extra = '<path d="M12 5.2 L10.3 9.3 L13.2 11.8 L10.8 15.2 L12.4 19.5" fill="none" stroke="#16151B" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>';
    if (type === 'gold') extra = '<path d="M18.6 1.6 l.8 1.9 1.9.8 -1.9.8 -.8 1.9 -.8-1.9 -1.9-.8 1.9-.8z" fill="#FFF7DA"/><ellipse cx="7.2" cy="7.6" rx="2.2" ry="1.3" fill="#FFF7DA" opacity=".7" transform="rotate(-35 7.2 7.6)"/>';
    return `<svg viewBox="0 0 24 24"><path d="${K.HEART_D}" fill="${fill}"${alpha ? ` opacity="${alpha}"` : ''}/>${extra}</svg>`;
  }
  const BASKET = `<svg viewBox="0 0 100 50" aria-hidden="true">
    <path d="M8 14 H92 L83 45 Q82 49 78 49 H22 Q18 49 17 45 Z" fill="#1A1920" stroke="#F4F1EA" stroke-width="3" stroke-linejoin="round"/>
    <path d="M13 27 H87 M17 38 H83" stroke="rgba(244,241,234,.28)" stroke-width="2" stroke-linecap="round"/>
    <path d="M31 17 V47 M50 17 V48 M69 17 V47" stroke="rgba(244,241,234,.18)" stroke-width="2" stroke-linecap="round"/>
    <rect x="3" y="7" width="94" height="12" rx="6" fill="#22212A" stroke="#F4F1EA" stroke-width="3"/>
    <path d="${K.HEART_D}" transform="translate(41.5 24) scale(.7)" fill="var(--accent)"/>
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
    if (has('place')) rows.push(['📍', 'pin', 'Место', placeText(plain)]);
    if (has('date')) rows.push(['📅', 'calendar', 'День', S.a.date ? K.fmtDay(S.a.date) : (S.a.dateOther || '—')]);
    if (has('time')) rows.push(['🕐', 'clock', 'Время', S.a.time || '—']);
    if (has('food')) rows.push(['🍽', 'food', 'Еда', foodText(plain)]);
    if (!rows.length) rows.push(['💕', 'heart', 'Ответ', 'Да!']);
    return rows;
  }
  function summary(html) {
    const e = s => (html ? esc(s) : s);
    const b = s => (html ? '<b>' + s + '</b>' : s);
    const L = [];
    if (html) {
      L.push(`💌 ${b(e(INV.her))} прошла приглашение!`);
      if (has('letter')) L.push(`✅ Ответ: ${b('ДА')}` + (S.a.noTries ? ` (пыталась нажать «Нет»: ${S.a.noTries})` : ''));
    } else {
      L.push(`Привет, ${INV.me}! Я прошла твою игру 😊`, 'Мой ответ — да! 💕');
    }
    for (const [i, , l, v] of answerRows()) L.push(`${i} ${l}: ${b(e(v))}`);
    if (html && has('hearts')) L.push(`❤️ Поймала сердечек: ${S.a.hearts}`);
    if (S.a.note) L.push(html ? `✉️ ${e(S.a.note)}` : `P.S. ${S.a.note}`);
    return L.join('\n');
  }
  function tgText(kind) {
    if (GROUP) {
      const who = '<b>' + esc(S.a.name || 'Кто-то') + '</b>';
      if (kind === 'open') return `👀 Открыли приглашение «${esc(groupTitle())}»`;
      const opts = optItems().filter((o, i) => (S.a.opts || []).includes(i)).map(o => o.emoji + ' ' + o.title).join(', ') || '—';
      const days = (S.a.days || []).map(d => K.fmtDay(d)).join(', ') || 'любой / пока не знает';
      return S.a.coming === false ? `${MC.emoji} ${who} не сможет` : `${MC.emoji} ${who} в деле!\n📍 За: ${esc(opts)}\n📅 Может: ${esc(days)}`;
    }
    const her = '<b>' + esc(INV.her) + '</b>';
    if (kind === 'open') return `👀 ${her} открыла приглашение`;
    if (kind === 'yes') return `💕 ${her} сказала «Да»!\n` + (S.a.noTries ? `Пыталась нажать «Нет»: ${S.a.noTries} ${plural(S.a.noTries, 'раз', 'раза', 'раз')} 😅` : 'С первой попытки 😍');
    if (kind === 'no') return `😢 ${her} нажала «Нет»`;
    if (kind === 'note') return `✉️ ${her} пишет:\n${esc(S.a.note)}`;
    return summary(true);
  }
  function notify(kind) {
    if (!canNotify()) return Promise.resolve(false);
    return K.relaySend(TG.relayUrl, tgText(kind), INV_ID);
  }
  async function answerLink() {
    const a = S.a;
    const payload = { yes: a.yes, place: a.place, placeText: a.placeText, date: a.date, dateOther: a.dateOther, time: a.time, food: a.food, note: a.note };
    return baseUrl() + '#' + CODE + '&a=' + await K.encodeData(payload);
  }
  /* Ник владельца в Telegram: из приглашения или из config.js */
  const hostTg = () => K.tgUser(INV.tgu) || K.tgUser(CFG.myTelegram);
  async function shareAnswer() {
    const text = summary(false) + (CODE ? '\n\nМой билет: ' + await answerLink() : '');
    const u = hostTg();
    if (u) {
      await copyText(text);   // запасной путь, если Telegram не подставит текст сам
      toast('Открываю Telegram — ответ уже в поле сообщения');
      setTimeout(() => { location.href = K.tgLink(u, text); }, 700);
      return;
    }
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const ok = await copyText(text);
    toast(ok ? 'Ответ скопирован! Отправь его в личку 💌' : 'Сделай скриншот билета и отправь его 📸');
  }

  const baseUrl = () => location.href.split('#')[0].replace(/[?].*$/, '');
  function stopsLine(plan) {
    const st = K.planStops(plan);
    if (!st.length) return '';
    if (st.length === 1) return (st[0].name === plan.title ? '' : st[0].name + ' · ') + 'м. ' + st[0].metro;
    let walk = 0;
    for (let i = 1; i < st.length; i++) walk += K.walkMin(st[i - 1], st[i]);
    return st.map(p => p.name).join(' → ') + (st.length > 1 ? ` · ${walk} мин пешком` : '');
  }
  function planBlock(plan) {
    const st = K.planStops(plan);
    if (!st.length) return '';
    return `<div class="plan-links">
      ${st.map(p => `<a class="chip-link" href="${K.mapUrl(p)}" target="_blank" rel="noopener">${I('pin')}${esc(p.name)}</a>`).join('')}
      ${st.length > 1 ? `<a class="chip-link" href="${K.routeUrl(st)}" target="_blank" rel="noopener">${I('route')}Маршрут</a>` : ''}
    </div>`;
  }

  const placeLoc = plan => { const p = K.planStops(plan)[0]; return p ? p.name + ', ' + p.addr : ''; };
  const planDetails = plan => {
    const st = K.planStops(plan);
    return st.length ? stopsLine(plan) + (st.length > 1 ? '\nМаршрут: ' + K.routeUrl(st) : '\n' + K.mapUrl(st[0])) : '';
  };
  function calBlock(ev) {
    let c;
    try { c = K.calendarLinks(ev); } catch (e) { return ''; }
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
    $('#progress').innerHTML = '';
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
    if (old) { old.classList.remove('enter'); old.classList.add('leave'); setTimeout(() => old.remove(), 380); }
    stage.appendChild(el);
    cleanup = step.run(el, next, step) || null;
  }
  function renderProgress() {
    const box = $('#progress');
    box.innerHTML = STEPS.filter(s => s.level).map(s => {
      const i = STEPS.indexOf(s);
      const cls = i < CUR ? 'done' : i === CUR ? 'now' : '';
      return `<span class="pg ${cls}"></span>`;
    }).join('');
    box.setAttribute('aria-label', `Уровень ${Math.min(CUR, LEVEL_COUNT)} из ${LEVEL_COUNT}`);
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
    const mine = PRIOR.some(v => v.id === VOTER_ID);
    const names = PRIOR.map(v => esc(v.n)).join(', ');
    el.innerHTML = `
      <div>
        <span class="badge">${esc(MC.label)} · зовёт ${esc(INV.me)}</span>
        <h1 class="title"><span class="hl">${esc(groupTitle())}</span></h1>
      </div>
      <div class="intro-mid">
        <div class="bubble b-down" id="greet"></div>
        <div class="intro-cat">${K.catSVG('normal', 'waving')}</div>
      </div>
      <div class="actions">
        ${PRIOR.length ? `<p class="hint">Уже отметились (${PRIOR.length}): ${names}</p>` : ''}
        <button class="btn btn-primary btn-xl pulse" id="go">${mine ? 'Изменить голос' : 'Погнали'}${I('arrow')}</button>
        ${PRIOR.length ? `<button class="link-btn" id="res">${I('users')}Посмотреть итоги</button>` : `<p class="hint">${I('sound')}Со звуком веселее</p>`}
      </div>`;
    const t = setTimeout(() => typeInto($('#greet', el), T(MT('greeting'))), 380);
    $('#go', el).onclick = () => { Sfx.init(); Sfx.click(); S.a = freshAnswers(); next(); };
    const res = $('#res', el);
    if (res) res.onclick = () => { Sfx.click(); showResults(PRIOR); };
    return () => clearTimeout(t);
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
        <div class="catcher"><div class="cat-slot">${K.catSVG('normal')}</div><div class="basket">${BASKET}</div></div>
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
          <p class="sub">${GROUP ? `Собрано ${score} — можно открывать приглашение` : `Ты собрала ${score} — этого хватит, чтобы открыть секретное письмо`}</p>
          <button class="btn btn-primary">Дальше${I('arrow')}</button></div>`;
      pf.appendChild(ov);
      $('button', ov).onclick = () => { Sfx.click(); next(); };
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
          <button class="seal" aria-label="Открыть письмо"><svg viewBox="0 0 24 24"><path d="${K.HEART_D}" fill="currentColor"/></svg></button>
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
          <div class="letter-stamp"><svg viewBox="0 0 24 24"><path d="${K.HEART_D}"/></svg></div>
          <p class="l-to">${GROUP ? 'Привет!' : esc(INV.her) + ','}</p>
          <p class="l-q">${esc(T(GROUP ? MT('question') : INV.question))}</p>
          <p class="l-sign">${esc(GROUP ? '— ' + INV.me : T(INV.signature))}</p>
          <div class="yn"><button class="btn btn-primary yes">${esc(GROUP ? MC.yes : 'Да')}</button><button class="btn btn-soft no">${esc(GROUP ? MC.no : 'Нет')}</button></div>
        </div>`;
      $('.lvl-head .sub', el).textContent = 'Ответь честно 😇';
      mood(el, 'normal');
      say(bub, 'Ну что? Я жду ответа… 👀');
      wire();
    };

    function wire() {
      const yes = $('.yes', el), no = $('.no', el);
      const NO_TEXT = ['Нет', 'Точно нет?', 'Подумай ещё 🤔', 'Промахнулась 😜', 'Не-а 🙃', 'Я убегаю!', 'Ну пожааалуйста 🥺', 'Кнопка устала 🙈'];
      const CAT_TEXT = ['Эй! 😳', 'Ты точно подумала?', 'У меня сейчас слёзки потекут…', 'Нажми «Да», тебе понравится 😊', 'Кнопка «Нет» явно против 😅', 'Ну пожалуйста-пожалуйста 🥹', 'Последний шанс нажать «Да»!', 'Ой, а «Нет» закончилось 😇'];
      let tries = 0, lastDodge = 0;
      const real = INV.noButton === 'real';

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
        if (tries >= 8) { no.classList.add('gone'); mood(el, 'happy'); }
      }

      if (real && GROUP) {
        no.onclick = () => {
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
        no.classList.add('gone');
        FX.burst({ n: 150, power: 1.25 });
        timers.push(setTimeout(() => FX.rain(45), 450));
        if (!GROUP && TG.notifyYes !== false && !S.sent.yes) notify('yes').then(ok => { if (ok) { S.sent.yes = true; save(); } });
        const ov = document.createElement('div');
        ov.className = 'celebrate';
        ov.innerHTML = `
          <svg class="big-heart" viewBox="0 0 24 24"><path d="${K.HEART_D}"/></svg>
          <h2>${GROUP ? 'Йееес!' : 'Ураааа!'}</h2>
          <p>${GROUP ? `${esc(INV.catName)} уже в предвкушении 🎉 Осталось решить, куда и когда!` : `${esc(INV.catName)} танцует от счастья 💃 Осталось выбрать детали!`}</p>
          <div class="cat-slot">${K.catSVG('love')}</div>
          <button class="btn btn-primary btn-xl">Дальше${I('arrow')}</button>`;
        el.appendChild(ov);
        $('button', ov).onclick = () => { Sfx.click(); next(); };
      };
    }
    return () => timers.forEach(clearTimeout);
  }

  /* ================= Уровень: шарики с местами ================= */
  function lvlPlace(el, next, step) {
    const opts = (INV.places || []).filter(p => p && (p.title || K.planById(p.plan))).map(p => {
      const pl = p.plan ? K.planById(p.plan) : null;
      return { emoji: p.emoji || (pl && pl.emoji) || '📍', title: p.title || pl.title, note: p.note || (pl && pl.why) || '', plan: pl ? pl.id : '', ph: pl ? K.planPhoto(pl) : null };
    });
    if (INV.placeSurprise) opts.push({ emoji: '🎁', title: 'Сюрприз', note: `Пусть ${INV.me} выберет сам — и не скажет куда 🤫`, kind: 'surprise' });
    if (INV.placeCustom) opts.push({ emoji: '✍️', title: 'Свой вариант', note: 'Напиши, куда тебе хочется', kind: 'custom' });
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
      </div>`;
    let busy = false, timer = 0;
    $('.balloons', el).addEventListener('click', e => {
      const b = e.target.closest('.balloon');
      if (!b || busy) return;
      busy = true;
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
        ${o.ph ? `<figure class="sheet-ph"><img src="${o.ph.s}" alt="${esc(o.title)}" decoding="async"><figcaption>${K.photoCredit(o.ph)}</figcaption></figure>` : `<div class="sheet-emoji">${esc(o.emoji)}</div>`}
        <h3>${esc(o.title)}</h3>
        ${o.note ? `<p>${esc(T(o.note))}</p>` : ''}
        ${o.plan ? `<p class="opt-stops">${esc(stopsLine(K.planById(o.plan)))}</p>` : ''}
        ${o.kind === 'custom' ? `<input class="field" maxlength="80" placeholder="Например: каток в парке" value="${esc(S.a.placeText)}">` : ''}
        <div class="row"><button class="btn btn-soft again">${I('redo')}Другое</button><button class="btn btn-primary ok">Дальше${I('arrow')}</button></div>`;
      el.appendChild(sh);
      Sfx.catch();
      const inp = $('input', sh), ok = $('.ok', sh);
      if (inp) {
        ok.disabled = !inp.value.trim();
        inp.oninput = () => { ok.disabled = !inp.value.trim(); };
      }
      $('.again', sh).onclick = () => { Sfx.click(); sh.remove(); reset(); };
      ok.onclick = () => {
        if (inp) S.a.placeText = inp.value.trim();
        save(); Sfx.click(); next();
      };
    }
    function reset() {
      busy = false;
      S.a.place = null; save();
      $$('.balloon', el).forEach(x => {
        x.classList.remove('pop', 'fly');
        const bi = $('.bl-in', x);
        bi.style.animation = 'none';
        void bi.offsetWidth;
        bi.style.animation = '';
      });
    }
    return () => clearTimeout(timer);
  }

  /* ================= Уровень: календарь ================= */
  function dayComment(d) {
    const now = new Date();
    const tomorrow = K.addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), 1);
    if (+d === +tomorrow) return 'Уже завтра?! Вот это да 😍';
    const w = d.getDay();
    if (w === 5) return 'Пятница — идеальный день для свидания 😏';
    if (w === 6 || w === 0) return 'Выходной — можно гулять хоть до ночи ✨';
    return 'Отличный вечер после рабочего дня 🌇';
  }
  function lvlDate(el, next, step) {
    const days = K.listDates(INV.dates);
    const avail = new Set(days);
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
          ? `<button class="day avail${we ? ' we' : ''}" data-d="${s}"><span>${d.getDate()}</span>${mon}</button>`
          : `<span class="day off"><span>${d.getDate()}</span>${mon}</span>`);
      }
      const months = Array.from(new Set(days.map(s => MONTHS[K.parseYmd(s).getMonth()])));
      cal = `<div class="cal">
        <div class="cal-month">${months.join(' — ')}</div>
        <div class="cal-wd">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(x => `<span>${x}</span>`).join('')}</div>
        <div class="cal-grid">${cells.join('')}</div>
      </div>`;
    }
    const multi = GROUP;
    const other = !multi && (INV.dateOther || !days.length);
    el.innerHTML = `
      ${head(step, multi ? 'Когда удобно?' : 'Когда увидимся?', multi ? 'Отметь все дни, когда можешь' : days.length ? 'Поставь сердечко на удобный день' : 'Напиши, когда тебе удобно')}
      ${cal}
      <div class="pick-line"></div>
      ${days.length ? miniCat(multi ? 'Отмечай всё, что подходит — выберем день, когда смогут все' : 'Выбирай любой — я всё запомню 📝') : ''}
      ${multi ? '<button class="link-btn idk">Пока не знаю</button>' : ''}
      ${other ? `<button class="link-btn other ${days.length ? '' : 'hidden'}">Ни один день не подходит</button>
        <div class="other-box ${days.length ? 'hidden' : ''}" style="width:100%"><input class="field" maxlength="80" placeholder="Например: в следующие выходные"></div>` : ''}
      <div class="actions"><button class="btn btn-primary btn-wide next" disabled>Дальше${I('arrow')}</button></div>`;
    const nextBtn = $('.next', el), line = $('.pick-line', el), bub = $('.comment .bubble', el), inp = $('.other-box input', el);
    const upd = () => { nextBtn.disabled = multi ? false : !(S.a.date || (inp && inp.value.trim())); };
    const stampHtml = `<svg class="stamp" viewBox="0 0 24 24"><path d="${K.HEART_D}"/></svg>`;
    function toggle(b, quiet) {
      const d = b.dataset.d, on = !b.classList.contains('picked');
      b.classList.toggle('picked', on);
      if (on) b.insertAdjacentHTML('afterbegin', stampHtml); else { const st = $('.stamp', b); if (st) st.remove(); }
      S.a.days = on ? Array.from(new Set(S.a.days.concat(d))).sort() : S.a.days.filter(x => x !== d);
      line.textContent = S.a.days.length ? `Отмечено: ${S.a.days.length} ${plural(S.a.days.length, 'день', 'дня', 'дней')}` : '';
      if (!quiet) { save(); if (on) { Sfx.stamp(); vibrate(15); mood(el, 'happy', 700); } else Sfx.click(); }
    }
    function mark(b, quiet) {
      $$('.day.picked', el).forEach(x => { x.classList.remove('picked'); const s = $('.stamp', x); if (s) s.remove(); });
      if (!b) { line.textContent = ''; return; }
      b.classList.add('picked');
      b.insertAdjacentHTML('afterbegin', `<svg class="stamp" viewBox="0 0 24 24"><path d="${K.HEART_D}"/></svg>`);
      line.textContent = K.fmtDay(b.dataset.d);
      say(bub, dayComment(K.parseYmd(b.dataset.d)));
      if (!quiet) { Sfx.stamp(); vibrate(15); mood(el, 'happy', 900); }
    }
    el.addEventListener('click', e => {
      const b = e.target.closest('.day.avail');
      if (!b) return;
      if (multi) { toggle(b); upd(); return; }
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
    const idk = $('.idk', el);
    if (idk) idk.onclick = () => { Sfx.click(); S.a.days = []; save(); next(); };
    if (multi) {
      const keep = (S.a.days || []).filter(d => avail.has(d));
      S.a.days = [];
      keep.forEach(d => toggle($(`.day[data-d="${d}"]`, el), true));
    } else if (S.a.date && avail.has(S.a.date)) mark($(`.day[data-d="${S.a.date}"]`, el), true);
    else S.a.date = '';
    if (S.a.dateOther && inp) { inp.value = S.a.dateOther; $('.other-box', el).classList.remove('hidden'); if (otherBtn) otherBtn.classList.add('hidden'); }
    upd();
    nextBtn.onclick = () => { Sfx.click(); next(); };
  }

  /* ================= Уровень: время и небо ================= */
  function period(h) {
    if (h < 12) return { label: 'утро', cat: 'Утреннее свидание — это так мило ☀️' };
    if (h < 17) return { label: 'день', cat: 'Днём можно успеть всё-всё 🌤' };
    if (h < 20) return { label: 'вечер', cat: 'Вечер — самое романтичное время 🌅' };
    return { label: 'ночь', cat: 'Прогулка под звёздами? Ммм ✨' };
  }
  function lvlTime(el, next, step) {
    const tc = INV.time || {};
    const from = K.toMin(tc.from || '12:00');
    let to = K.toMin(tc.to || '22:00');
    if (to <= from) to = from + 60;
    const stepM = clamp(+tc.step || 30, 5, 180);
    const N = Math.max(1, Math.floor((to - from) / stepM));
    const v0 = clamp(Math.round((K.toMin(S.a.time || tc.def || '19:00') - from) / stepM), 0, N);
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
    for (let i = 0; i <= 6; i++) stops.push(skyAt((from + (from + N * stepM - from) * i / 6) / 60)[0] + ' ' + Math.round(i * 100 / 6) + '%');
    range.style.setProperty('--track', `linear-gradient(90deg, ${stops.join(', ')})`);
    let lastPer = '';
    function upd(sound) {
      const m = from + (+range.value) * stepM, h = m / 60, t = (+range.value) / N;
      const [c1, c2] = skyAt(h);
      sky.style.background = `linear-gradient(180deg, ${c1}, ${c2})`;
      const night = clamp((h - 19.3) / 1.4, 0, 1);
      sky.style.setProperty('--night', night.toFixed(3));
      sky.style.setProperty('--lights', clamp((h - 17.8) / 1.6, 0, 1).toFixed(3));
      sky.style.setProperty('--bld', mix('#dcc2e4', '#2c2552', clamp((h - 17) / 4, 0, 1)));
      const x = 8 + t * 84, y = 76 - Math.sin(Math.PI * t) * 58;
      for (const o of [sun, moon]) { o.style.left = x + '%'; o.style.top = y + '%'; }
      sun.style.opacity = (1 - night).toFixed(3);
      moon.style.opacity = night.toFixed(3);
      read.textContent = K.fromMin(m);
      const p = period(h);
      per.textContent = p.label;
      if (p.label !== lastPer) { lastPer = p.label; say(bub, p.cat); if (sound) mood(el, 'happy', 700); }
      S.a.time = K.fromMin(m);
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
    el.innerHTML = `
      ${head(step, cfg.title, cfg.sub)}
      <div class="deck"></div>
      <div class="deck-count"></div>
      <div class="swipe-btns"><button class="round nope" aria-label="Нет">${I('x')}</button><button class="round like" aria-label="Да">${I(GROUP ? 'check' : 'heart')}</button></div>
      <div class="food-result hidden"></div>
      <div class="actions hidden"><div class="row"><button class="btn btn-soft again">${I('redo')}Заново</button><button class="btn btn-primary ok">Дальше${I('arrow')}</button></div></div>`;
    const deck = $('.deck', el), cnt = $('.deck-count', el), btns = $('.swipe-btns', el), res = $('.food-result', el), acts = $('.actions', el);
    let idx = 0, liked = [], likedIdx = [], busy = false;
    const topCard = () => $(`.fcard[data-i="${idx}"]`, deck);

    function build() {
      idx = 0; liked = []; likedIdx = []; busy = false;
      deck.innerHTML = items.map((f, i) => `
        <div class="fcard${f.ph ? ' has-ph' : ''}" data-i="${i}" style="--c:${FCOL[i % FCOL.length]};z-index:${items.length - i}">
          <span class="tag like">${cfg.likeTag}</span><span class="tag nope">${cfg.nopeTag}</span>
          ${f.ph ? `<div class="fph"><img src="${f.ph.s}" alt="" draggable="false" decoding="async"><span class="fcap">© ${esc(f.ph.a)}, ${esc(f.ph.l)}</span></div>` : ''}
          <div class="fe">${esc(f.emoji)}</div><div class="ft">${esc(f.title)}</div>${f.note ? `<div class="fn">${esc(f.note)}</div>` : ''}
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
      });
      cnt.textContent = idx < items.length ? `${idx + 1} / ${items.length}` : '';
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
      Sfx.success();
    }
    $('.nope', btns).onclick = () => decide(false);
    $('.like', btns).onclick = () => decide(true);
    $('.again', acts).onclick = () => { Sfx.click(); build(); };
    $('.ok', acts).onclick = () => { Sfx.click(); next(); };
    build();
  }

  function lvlFood(el, next, step) {
    const items = (INV.food || []).filter(f => f && f.title).map(f => ({ emoji: f.emoji || '🍽', title: f.title, note: f.note || '' }));
    swipeLevel(el, next, step, {
      title: 'Что будем есть?', sub: 'Свайпай: вправо — хочу, влево — не хочу', items, likeTag: 'ХОЧУ', nopeTag: 'НЕТ',
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

  /* Варианты для голосования: готовые планы из подборок или свои */
  function optItems() {
    return (INV.opts || []).map(o => {
      const pl = o && o.plan ? K.planById(o.plan) : null;
      if (pl) return { emoji: pl.emoji, title: pl.title, note: pl.why, stops: stopsLine(pl), plan: pl.id, ph: K.planPhoto(pl) };
      if (o && o.title) return { emoji: o.emoji || '📍', title: o.title, note: o.note || '', stops: '', plan: '' };
      return { emoji: '❓', title: 'Вариант недоступен', note: '', stops: '', plan: '' };
    });
  }
  function lvlVote(el, next, step) {
    swipeLevel(el, next, step, {
      title: 'Куда пойдём?', sub: 'Свайпай: вправо — за, влево — против', items: optItems(), likeTag: 'ЗА', nopeTag: 'НЕТ',
      onFinish: (liked, idx) => { S.a.opts = idx; },
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
  function scrFinal(el) {
    if (GROUP) return scrFinalGroup(el);
    const rows = answerRows(true);
    const plan = S.a.place && S.a.place.plan ? K.planById(S.a.place.plan) : null;
    const view = !!ANSWER;
    const flight = 'LOVE-' + (parseInt(INV_ID, 36) % 900 + 100);
    const d = K.parseYmd(S.a.date);
    const topInfo = d ? `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${S.a.time ? ' · ' + S.a.time : ''}` : (S.a.time || '❤');
    const tgUser = hostTg();
    const calEv = S.a.date ? {
      title: `Свидание · ${INV.her} и ${INV.me}`, day: S.a.date, time: S.a.time || '',
      location: plan ? placeLoc(plan) : (S.a.place && S.a.place.kind !== 'surprise' ? placeText(true) : ''),
      details: plan ? planDetails(plan) : '',
    } : null;
    el.innerHTML = `
      <div class="res-head"><p class="eyebrow">${view ? 'Ответ получен' : 'Готово'}</p>
        <h2 class="final-title">${view ? `${esc(INV.her)} ответила «да»` : 'Твой билет на свидание'}</h2></div>
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
      ${plan || calEv ? `<div class="tally"><h3>${plan ? esc(plan.title) : 'Не забудь'}</h3>${plan ? planBlock(plan) : ''}${calEv ? calBlock(calEv) : ''}</div>` : ''}
      <div class="send-state"></div>
      <div class="final-cat"><div class="cat-slot">${K.catSVG('love')}</div><div class="bubble b-left">${esc(view ? 'Осталось только встретиться 😉' : T(INV.finale))}</div></div>
      ${view ? `<div class="actions"><a class="btn btn-primary btn-wide" href="start.html">Все планы «Куда идём?»${I('arrow')}</a></div>` : ''}
      <div class="actions${view ? ' hidden' : ''}">
        <button class="btn btn-primary btn-wide share">${I('share')}${tgUser ? 'Отправить ответ в Telegram' : 'Отправить ответ'}</button>
        <button class="btn btn-soft btn-wide note-open">${I('pen')}Написать пару слов</button>
        <div class="note-box hidden">
          <textarea class="field" rows="3" maxlength="500" placeholder="Пожелание, вопрос или просто что-то милое…"></textarea>
          <button class="btn btn-primary note-send">Отправить</button>
        </div>
        <button class="link-btn replay">${I('redo')}Пройти заново</button>
        <a class="link-btn viral" href="start.html?from=invite">${I('sparkle')}Сделать своё приглашение</a>
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
    const noteOpen = $('.note-open', el), noteBox = $('.note-box', el), noteArea = $('textarea', noteBox);
    const sig = JSON.stringify(Object.assign({}, S.a, { note: '' }));
    const setState = (txt, ok) => { state.innerHTML = (ok ? I('check') : '') + esc(txt); state.classList.toggle('ok', !!ok); };

    if (PREVIEW) setState('Это превью — в Telegram ничего не отправляется');
    else if (canNotify()) {
      shareBtn.classList.add('hidden');
      if (S.sent.final === sig) setState(`${INV.me} уже получил твой ответ`, true);
      else {
        setState('Отправляю ответ…');
        notify('final').then(ok => {
          if (ok) { S.sent.final = sig; save(); setState(`${INV.me} уже получил твой ответ`, true); }
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
      if (canNotify()) {
        const ok = await notify('note');
        if (ok) {
          toast(`Отправлено! ${INV.me} прочитает 💌`);
          noteBox.classList.add('hidden');
          noteOpen.classList.remove('hidden');
          noteOpen.innerHTML = I('pen') + 'Написать ещё';
          FX.burst({ n: 40, power: 0.7, shapes: ['heart'] });
          return;
        }
      }
      shareAnswer();
    };
    $('.replay', el).onclick = () => {
      Sfx.click();
      S.a = freshAnswers();
      go(1);
    };

    setTimeout(() => { Sfx.fanfare(); FX.burst({ n: 160, power: 1.2 }); }, 350);
    const rain = setTimeout(() => FX.rain(60), 1100);
    return () => { clearTimeout(rain); removeEventListener('resize', setCut); };
  }

  /* ================= Компания: голос, итоги, объединение ссылок ================= */
  function voterId() {
    if (VOTER_ID) return VOTER_ID;
    const k = 'kuda-voter:' + INV_ID;
    try { VOTER_ID = localStorage.getItem(k) || ''; } catch (e) { /* приватный режим */ }
    if (!VOTER_ID) {
      VOTER_ID = Math.random().toString(36).slice(2, 8);
      if (!PREVIEW) { try { localStorage.setItem(k, VOTER_ID); } catch (e) { /* ок */ } }
    }
    return VOTER_ID;
  }
  function cleanVotes(arr) {
    return (Array.isArray(arr) ? arr : []).filter(v => v && typeof v.id === 'string' && v.id.length <= 12).map(v => ({
      id: v.id, n: String(v.n || '?').slice(0, 30), y: v.y ? 1 : 0,
      o: (Array.isArray(v.o) ? v.o : []).filter(Number.isInteger).slice(0, 20),
      d: (Array.isArray(v.d) ? v.d : []).filter(Number.isInteger).slice(0, 60),
      t: +v.t || 0,
    }));
  }
  function mergeVotes(...lists) {
    const m = new Map();
    for (const list of lists) for (const v of cleanVotes(list)) { const p = m.get(v.id); if (!p || v.t >= p.t) m.set(v.id, v); }
    return Array.from(m.values()).sort((a, b) => a.t - b.t);
  }
  const votesLink = async votes => baseUrl() + '#' + CODE + '&v=' + await K.encodeData(votes);
  function tally(votes) {
    const items = optItems();
    const inV = votes.filter(v => v.y);
    const opt = items.map((o, i) => ({ o, i, who: inV.filter(v => v.o.includes(i)).map(v => v.n) }))
      .sort((a, b) => b.who.length - a.who.length || a.i - b.i);
    const dm = new Map();
    inV.forEach(v => v.d.forEach(d => dm.set(d, (dm.get(d) || []).concat(v.n))));
    const days = Array.from(dm.entries()).map(([d, who]) => ({ d, who })).sort((a, b) => b.who.length - a.who.length || a.d - b.d);
    return { opt, days, inV, any: inV.filter(v => !v.o.length).map(v => v.n) };
  }
  const shortDay = n => new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }).format(K.parseYmd(K.numDay(n)));
  function verdict(votes, forced) {
    const t = tally(votes);
    const top = t.opt.length ? t.opt[0].who.length : 0;
    const leaders = t.opt.filter(x => top > 0 && x.who.length === top);
    const win = forced != null ? t.opt.find(x => x.i === forced) : leaders.length === 1 ? leaders[0] : null;
    return { t, win, leaders, plan: win && win.o.plan ? K.planById(win.o.plan) : null, day: t.days.length ? t.days[0] : null };
  }
  function verdictText(votes, forced) {
    const v = verdict(votes, forced);
    const L = [`${MC.emoji} ${groupTitle()} — итог голосования`];
    if (v.win) L.push(`📍 ${v.win.o.title}` + (v.plan ? `\n${planDetails(v.plan)}` : ''));
    if (v.day) L.push(`📅 ${K.fmtDay(K.numDay(v.day.d))} — могут ${v.day.who.join(', ')}`);
    L.push(`Голосовали: ${v.t.inV.map(x => x.n).join(', ') || '—'}`);
    return L.join('\n');
  }
  function verdictHtml(votes, forced) {
    const v = verdict(votes, forced);
    if (!v.t.inV.length || (!v.win && !v.day && v.leaders.length < 2)) return '';
    const tie = !v.win && v.leaders.length > 1;
    const ev = v.day ? { title: groupTitle() + (v.win ? ' · ' + v.win.o.title : ''), day: K.numDay(v.day.d), location: v.plan ? placeLoc(v.plan) : '', details: v.plan ? planDetails(v.plan) : '' } : null;
    return `<div class="tally verdict">
      <p class="eyebrow">${forced != null ? 'Колесо решило' : tie ? 'Пока ничья' : 'Пока лидирует'}</p>
      <h3 class="v-title">${v.win ? esc(v.win.o.title) : tie ? v.leaders.map(x => esc(x.o.title)).join(' или ') : 'Место пока не выбрано'}</h3>
      ${tie ? '<p class="v-day">Крутани колесо ниже — оно решит</p>' : ''}
      ${v.day ? `<p class="v-day">${I('calendar')}${esc(shortDay(v.day.d))} · могут ${v.day.who.length} из ${v.t.inV.length}</p>` : ''}
      ${v.plan ? planBlock(v.plan) : ''}
      ${ev ? calBlock(ev) : ''}
      <button class="btn btn-soft btn-wide verdict-share">${I('send')}Отправить итог в чат</button>
    </div>`;
  }
  function tallyHtml(votes, forced) {
    const t = tally(votes);
    const max = Math.max(1, t.inV.length);
    const top = t.opt.length ? t.opt[0].who.length : 0;
    const leaders = t.opt.filter(x => top > 0 && x.who.length === top);
    const dTop = t.days.length ? t.days[0].who.length : 0;
    const row = (cls, title, who, n) => `<div class="t-item${cls}"><i class="bar" style="width:${(n / max * 100).toFixed(0)}%"></i>
      <span class="n">${esc(title)}<small>${who}</small></span><span class="c">${n}</span></div>`;
    return `${verdictHtml(votes, forced)}
      <div class="tally">
        <h3>Проголосовали: ${votes.length}</h3>
        <div class="voters">${votes.length ? votes.map(v => `<span class="${v.y ? '' : 'out'}"${v.y ? '' : ' title="не сможет"'}>${esc(v.n)}</span>`).join('') : '<span>пока никого</span>'}</div>
      </div>
      ${t.opt.length ? `<div class="tally"><h3>Куда</h3>
        ${t.opt.map(x => row(leaders.includes(x) ? ' lead' : '', x.o.title, x.who.length ? esc(x.who.join(', ')) : 'пока никто', x.who.length).replace('class="t-item', `data-i="${x.i}" class="t-item`)).join('')}
        ${t.any.length ? `<p class="hint">Подойдёт любой вариант: ${esc(t.any.join(', '))}</p>` : ''}
        ${leaders.length > 1 ? `<button class="btn btn-soft dashed btn-wide wheel">${I('wheel')}Ничья — крутить колесо</button>` : ''}
      </div>` : ''}
      ${t.days.length ? `<div class="tally"><h3>Когда</h3>
        ${t.days.slice(0, 6).map(x => row(x.who.length === dTop ? ' lead' : '', shortDay(x.d), esc(x.who.join(', ')), x.who.length)).join('')}
      </div>` : ''}`;
  }

  function scrFinalGroup(el) {
    let name = S.a.name || '';
    if (!name) { try { name = localStorage.getItem('kuda-name') || ''; } catch (e) { /* ок */ } }
    const out = S.a.coming === false;
    el.innerHTML = `
      <div class="res-head"><p class="eyebrow">${esc(groupTitle())}</p><h2 class="final-title">${out ? 'Жаль, что не получится' : 'Последний шаг'}</h2></div>
      <div class="final-cat"><div class="cat-slot">${K.catSVG(out ? 'sad' : 'happy')}</div><div class="bubble b-left">Как тебя записать в голосовании?</div></div>
      <div class="name-box">
        <input class="field nm" maxlength="30" placeholder="Например: Петя" value="${esc(name)}">
        <button class="btn btn-primary btn-wide send">Готово${I('check')}</button>
      </div>`;
    const inp = $('.nm', el), btn = $('.send', el);
    btn.disabled = !inp.value.trim();
    inp.oninput = () => { btn.disabled = !inp.value.trim(); };
    btn.onclick = () => {
      S.a.name = inp.value.trim().slice(0, 30); save();
      if (!PREVIEW) { try { localStorage.setItem('kuda-name', S.a.name); } catch (e) { /* ок */ } }
      Sfx.success(); vibrate([20, 40, 20]);
      const mine = { id: voterId(), n: S.a.name, y: out ? 0 : 1, o: S.a.opts || [], d: (S.a.days || []).map(K.dayNum).filter(n => n >= 0), t: Math.floor(Date.now() / 60000) };
      PRIOR = mergeVotes(PRIOR, [mine]);
      notify('vote');
      showResults(PRIOR, true);
    };
  }

  function showResults(votes, justVoted) {
    showScreen('results', el => {
      el.innerHTML = `
        <div class="res-head">
          <p class="eyebrow">${esc(groupTitle())}${justVoted ? '' : ' · зовёт ' + esc(INV.me)}</p>
          <h2 class="final-title">${justVoted ? 'Голос учтён' : 'Итоги голосования'}</h2>
          <p class="sub">${justVoted ? esc(MC.done) : 'Смотри, куда и когда удобно всем.'}</p>
        </div>
        <div class="share-row">
          <button class="btn btn-primary share">${I('chat')}Отправить в чат</button>
          <button class="btn btn-soft sq copy" aria-label="Скопировать ссылку" title="Скопировать ссылку">${I('link')}</button>
        </div>
        <div class="tally-wrap"></div>
        <div class="merge-box">
          <button class="link-btn merge-open">Голоса разошлись по разным ссылкам? Объединить</button>
          <div class="merge hidden" style="display:flex;flex-direction:column;gap:8px">
            <textarea class="field" rows="3" placeholder="Вставь сюда ссылки из чата — можно сразу несколько"></textarea>
            <button class="btn btn-soft merge-go">Объединить голоса</button>
          </div>
        </div>
        <div class="actions">
          <button class="link-btn revote">${justVoted ? I('redo') + 'Изменить мой голос' : I('check') + 'Проголосовать'}</button>
          <a class="link-btn" href="start.html">Создать свой сбор${I('arrow')}</a>
        </div>`;
      const wrap = $('.tally-wrap', el);
      let cur = votes, forced = null;
      function render() {
        wrap.innerHTML = tallyHtml(cur, forced);
        const wheel = $('.wheel', wrap);
        if (wheel) wheel.onclick = () => spin(wrap, wheel, i => { forced = i; render(); wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
        const vs = $('.verdict-share', wrap);
        if (vs) vs.onclick = async () => {
          Sfx.click();
          const text = verdictText(cur, forced) + '\n👉 ' + await votesLink(cur);
          if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
          toast(await copyText(text) ? 'Итог скопирован — вставь в общий чат' : 'Не получилось скопировать');
        };
      }
      render();
      if (justVoted) setTimeout(() => FX.burst({ n: 120, power: 1.1 }), 250);
      const shareText = async () => `${MC.emoji} ${groupTitle()}\nГолосуем, куда и когда идём! Уже отметились: ${cur.map(v => v.n).join(', ') || '—'}\n👉 ${await votesLink(cur)}`;
      $('.share', el).onclick = async () => {
        Sfx.click();
        const text = await shareText();
        if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
        toast(await copyText(text) ? 'Скопировано — вставь в общий чат 💬' : 'Не получилось скопировать');
      };
      $('.copy', el).onclick = async () => { Sfx.click(); toast(await copyText(await votesLink(cur)) ? 'Ссылка скопирована 🔗' : 'Не получилось скопировать'); };
      $('.merge-open', el).onclick = () => { $('.merge', el).classList.toggle('hidden'); };
      $('.merge-go', el).onclick = async () => {
        const text = $('.merge textarea', el).value;
        const re = /#([A-Za-z0-9_-]+)&v=([A-Za-z0-9_-]+)/g;
        let m, added = 0, foreign = 0;
        const lists = [];
        while ((m = re.exec(text))) {
          if (m[1] !== CODE) { foreign++; continue; }
          try { lists.push(await K.decodeData(m[2])); added++; } catch (e) { /* битая ссылка */ }
        }
        if (!added) { toast(foreign ? 'Это ссылки от другого сбора' : 'Не нашёл ссылок с голосами'); return; }
        cur = mergeVotes(cur, ...lists);
        PRIOR = cur; forced = null;
        $('.merge textarea', el).value = '';
        render();
        Sfx.success();
        toast(`Готово! Голосов теперь: ${cur.length}`);
      };
      $('.revote', el).onclick = () => { Sfx.click(); S.a = freshAnswers(); go(1); };
    });
  }
  function spin(wrap, btn, onWin) {
    const items = $$('.t-item.lead[data-i]', wrap);
    if (items.length < 2) return;
    btn.disabled = true;
    const winner = (Math.random() * items.length) | 0;
    const total = items.length * 3 + winner;
    let k = 0;
    const tick = () => {
      items.forEach(x => x.classList.remove('spin'));
      items[k % items.length].classList.add('spin');
      Sfx.tick();
      if (k++ < total) setTimeout(tick, 70 + k * k * 1.6);
      else {
        Sfx.fanfare();
        FX.burst({ n: 100, power: 1 });
        toast('Колесо выбрало: ' + $('.n', items[winner]).firstChild.textContent);
        btn.disabled = false;
        if (onWin) setTimeout(() => onWin(+items[winner].dataset.i), 900);
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
    const days = K.listDates(INV.dates);
    if (GROUP) { Object.assign(S.a, { yes: true, coming: true, opts: [0], days: days.slice(0, 2), name: 'Ты' }); return; }
    const p = (INV.places || []).find(x => x && (x.title || x.plan));
    Object.assign(S.a, {
      yes: true, hearts: INV.heartsGoal || 12,
      place: p ? { emoji: p.emoji || (K.planById(p.plan) || {}).emoji, title: p.title || (K.planById(p.plan) || {}).title, kind: '', plan: p.plan || '' } : { emoji: '🎁', title: 'Сюрприз', kind: 'surprise' },
      date: days[0] || '', dateOther: days[0] ? '' : 'в выходные',
      time: (INV.time && INV.time.def) || '19:00',
      food: (INV.food || []).filter(f => f && f.title).slice(0, 2).map(f => ({ emoji: f.emoji, title: f.title })),
    });
  }

  /* ================= Запуск ================= */
  const RUNNERS = { hearts: lvlHearts, letter: lvlLetter, place: lvlPlace, date: lvlDate, time: lvlTime, food: lvlFood, vote: lvlVote };
  function buildSteps() {
    const on = INV.levels || {};
    const list = [{ id: 'intro', run: scrIntro }];
    let n = 0;
    const ids = GROUP ? ['hearts', 'letter', 'vote', 'date'] : ['hearts', 'letter', 'place', 'date', 'time', 'food'];
    for (const id of ids) {
      if (on[id] === false && !(GROUP && id === 'letter')) continue;
      if (id === 'vote' && !(INV.opts || []).length) continue;
      if (id === 'place' && !(INV.places || []).some(p => p && (p.title || p.plan)) && !INV.placeCustom && !INV.placeSurprise) continue;
      if (id === 'food' && !(INV.food || []).some(f => f && f.title)) continue;
      list.push({ id, level: ++n, run: RUNNERS[id] });
    }
    list.push({ id: 'final', run: scrFinal });
    LEVEL_COUNT = n;
    return list;
  }
  function floaters() {
    const box = $('.floaters');
    box.innerHTML = Array.from({ length: 14 }, () =>
      `<i style="--x:${rand(0, 100).toFixed(1)}%;--s:${rand(10, 24).toFixed(0)}px;--t:${rand(9, 17).toFixed(1)}s;--d:${(-rand(0, 17)).toFixed(1)}s"></i>`).join('');
  }

  async function init() {
    const h = K.readHash();
    PREVIEW = h.preview;
    let inv = K.defaults();
    if (h.code) {
      try { inv = K.merge(inv, await K.decodeInvite(h.code)); }
      catch (e) { showError(); return; }
    }
    INV = inv;
    CODE = h.code;
    INV_ID = K.hash(h.code || JSON.stringify(inv));
    KEY = 'date-invite:' + INV_ID;
    MODE = K.modeOf(INV); MC = K.MODES[MODE]; GROUP = !!MC.group;
    document.documentElement.dataset.theme = K.THEMES.includes(INV.theme) ? INV.theme : (MC.theme || 'pink');
    document.documentElement.dataset.acc = MC.acc || '';
    document.documentElement.style.cssText += ';' + K.catVars(INV.cat);
    document.title = GROUP ? `${MC.emoji} ${groupTitle()}` : '💌 Приглашение для ' + INV.her;
    STEPS = buildSteps();
    load();
    floaters();
    if (GROUP) {
      voterId();
      if (h.votes) { try { PRIOR = mergeVotes(await K.decodeData(h.votes)); } catch (e) { PRIOR = []; } }
    } else if (h.answer) {
      try { ANSWER = await K.decodeData(h.answer); } catch (e) { ANSWER = null; }
    }

    const sb = $('#soundBtn');
    const sbSet = on => { sb.innerHTML = I(on ? 'sound' : 'mute'); sb.setAttribute('aria-pressed', String(on)); sb.setAttribute('aria-label', on ? 'Выключить звук' : 'Включить звук'); };
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
    if (GROUP && h.results) { showResults(PRIOR); return; }

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

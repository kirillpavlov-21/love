/* Общий код игры и конструктора. Настройки — в config.js, здесь менять ничего не нужно. */
(function () {
  'use strict';

  /* Запасные значения, если в config.js чего-то не хватает */
  const BASE = {
    her: 'Солнышко', me: 'Я', catName: 'Мурчик', cat: 'ginger', theme: 'pink',
    greeting: 'Я {cat} — почтовый котик 🐾 {me} попросил передать тебе кое-что очень важное… Но сначала пройди маленькую игру!',
    question: 'Пойдёшь со мной на свидание?',
    signature: 'Твой {me}',
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
    'start:x days:y skipWeekdays:z list:A from:B to:C step:D def:E hearts:F letter:G place:H date:I').split(' ').map(x => x.split(':'));
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
    return { code: code || p.i || '', preview: p.p === '1', start: parseInt(p.s, 10) || 0 };
  }

  /* ---------- тексты ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fill(str, inv) {
    return String(str || '').replace(/\{her\}/g, inv.her).replace(/\{me\}/g, inv.me).replace(/\{cat\}/g, inv.catName);
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
  const toMin = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const fromMin = m => pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60);

  /* ---------- отправка ответов ----------
     Токена на сайте нет: текст уходит посреднику (Google Apps Script),
     он пересылает его в Telegram. text/plain — чтобы браузер не делал preflight. */
  async function relaySend(url, text) {
    if (!url) return false;
    try {
      const r = await fetch(url, { method: 'POST', body: JSON.stringify({ text }) });
      const j = await r.json();
      return !!j.ok;
    } catch (e) {
      return false;
    }
  }

  /* ---------- котик ---------- */
  const CATS = {
    ginger: { fur: '#ffb35c', belly: '#fff0dc', line: '#6b3a22', inner: '#ff9db3', stripe: '#ef8a34', eye: '#3b2230' },
    grey:   { fur: '#b8bfd3', belly: '#f4f5fb', line: '#434862', inner: '#ffadc1', stripe: '#959cb4', eye: '#2d2f45' },
    white:  { fur: '#fffaf4', belly: '#ffffff', line: '#6e5560', inner: '#ffb3c6', stripe: 'transparent', eye: '#3b2a33' },
    black:  { fur: '#433d52', belly: '#5d566e', line: '#1f1b28', inner: '#ff9db3', stripe: 'transparent', eye: '#ffd85e' },
  };
  function catVars(name) {
    const c = CATS[name] || CATS.ginger;
    return `--fur:${c.fur};--belly:${c.belly};--line:${c.line};--inner:${c.inner};--stripe:${c.stripe};--eye:${c.eye}`;
  }
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
        <circle cx="79" cy="88" r="3" fill="#fff"/><circle cx="127" cy="88" r="3" fill="#fff"/>
      </g>
      <g class="m m-wow">
        <circle cx="76" cy="91" r="12" fill="var(--eye)"/><circle cx="124" cy="91" r="12" fill="var(--eye)"/>
        <circle cx="80" cy="86" r="4.5" fill="#fff"/><circle cx="128" cy="86" r="4.5" fill="#fff"/>
        <circle cx="72" cy="96" r="2" fill="#fff"/><circle cx="120" cy="96" r="2" fill="#fff"/>
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
        <circle cx="78" cy="92" r="2.5" fill="#fff"/><circle cx="126" cy="92" r="2.5" fill="#fff"/>
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
    </g>
  </g>
</svg>`;
  }

  window.DateKit = {
    BASE, merge, defaults, diffInvite, encodeInvite, decodeInvite, readHash, esc, fill, hash,
    ymd, parseYmd, addDays, listDates, fmtDay, toMin, fromMin, relaySend,
    CATS, catVars, catSVG, HEART_D,
    THEMES: ['pink', 'lavender', 'peach', 'mint'],
  };
})();

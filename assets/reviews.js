/* Отзывы и оценки мест «Куда идём?» — window.KudaReviews
   ─ Звёзды в карточках (badge, planBadge), сглаженная оценка для сортировки (score)
     и блок «Отзывы» в карточке места (mount): сводка, список, форма, жалобы.
   ─ Данные — только через window.KudaAPI (assets/api.js). Бэкенда нет (api.url пуст) —
     модуль ничего не рисует и не ходит в сеть.
   ─ Текст людей всегда экранируется. В localStorage — только id мест, где ты оставил отзыв,
     и id отзывов, на которые ты пожаловался. */
(function () {
  'use strict';

  const PRIOR = 4.2, WEIGHT = 5;   // байесовская оценка: (WEIGHT·PRIOR + сумма оценок) / (WEIGHT + n)
  const SOLID = 3;                 // с 3 отзывов показываем цифру, раньше — «новое»
  const PAGE = 10, FIRST = 3, TEXT_MAX = 600, NAME_MAX = 30, TAGS_MAX = 5, CUT = 240;
  /* LS_DONE — свои подробности {место: {id, p, t}}; список мест 'kuda-reviewed' ведёт api.js (массив) — его только читаем */
  const LS_DONE = 'kuda-rv-mine', LS_API_DONE = 'kuda-reviewed', LS_REP = 'kuda-reported';

  const dict = pairs => pairs.reduce((o, [k, v]) => { o[k] = v; return o; }, Object.create(null));
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const TAGS = [
    ['talk', 'Можно поговорить'], ['cozy', 'Уютно'], ['loud', 'Шумно'], ['first', 'Для первого свидания'],
    ['group', 'Для компании'], ['cheap', 'Недорого'], ['pricey', 'Дорого'], ['view', 'Красивый вид'],
    ['service', 'Хороший сервис'], ['queue', 'Очереди'],
  ];
  const TAG = dict(TAGS);
  const FITS = [['date', 'Свидание'], ['group', 'Компания'], ['', 'Другое']];
  const FIT_DONE = dict([['date', 'На свидании'], ['group', 'С компанией']]);
  const SUBS = [['date', 'Для свидания'], ['group', 'Для компании']];
  const WORD = ['', 'Плохо', 'Так себе', 'Нормально', 'Хорошо', 'Отлично'];
  const TITLE = 'Отзывы гостей', ANCHOR = 'reviews';   // заголовок по умолчанию и якорь start.html?place=…#reviews
  const TOKEN_RE = /^[A-Za-z0-9._-]{10,400}$/;          // как проверяет сервер (server/handler.mjs)
  const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const REASONS = [['rude', 'Оскорбления'], ['spam', 'Спам или реклама'], ['fake', 'Не про это место'], ['personal', 'Личные данные']];
  const STAR_D = 'M12 2.4l2.95 6.2 6.8.85-5 4.7 1.3 6.75L12 17.6l-6.05 3.3 1.3-6.75-5-4.7 6.8-.85z';
  const PEN = '<svg class="rv-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/></svg>';
  /* Ссылка на политику — от адреса скрипта, чтобы работала и со страниц во вложенных папках */
  const PRIVACY = (() => {
    try {
      const s = document.currentScript && document.currentScript.src;
      if (s) return new URL('../privacy.html#reviews', s).href;
    } catch (e) { /* ниже — относительная */ }
    return 'privacy.html#reviews';
  })();

  /* ---------- тексты ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const num = x => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many;
  }
  const rw = n => plural(n, 'отзыв', 'отзыва', 'отзывов');
  /* Чистим ввод: управляющие символы, лишние пробелы и строки, длина */
  function clean(s, max, multi) {
    s = String(s == null ? '' : s).replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g, '');
    s = multi ? s.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
    s = s.trim();
    if (s.length > max) {
      s = s.slice(0, max);
      if (/[\uD800-\uDBFF]$/.test(s)) s = s.slice(0, -1);
      s = s.trim();
    }
    return s;
  }
  /* Ссылки, ники и телефоны в отзыве не публикуем — просим убрать до отправки */
  const LINK = /(https?:\/\/|www\.|t\.me\/|[a-z0-9а-яё-]{2,}\.(ru|рф|com|net|org|su|io|me|info|online|site|pro|shop|club|app|moscow)(?![a-zа-яё0-9])|@[a-z0-9_]{4,})/i;
  const PHONE = /(^|\D)(\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)|(^|\D)\d{10,}(?!\d)/;
  const bad = s => !!s && (LINK.test(s) || PHONE.test(s));

  /* ---------- даты (по Москве, UTC+3 без перехода на летнее время) ---------- */
  function toMs(v) {
    if (typeof v === 'string' && /^\d+$/.test(v)) v = +v;
    if (typeof v === 'number') return isFinite(v) && v > 0 ? (v < 1e11 ? v * 1000 : v) : 0;
    if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? 0 : t; }
    return 0;
  }
  const msk = ms => { const d = new Date(ms + 3 * 3600e3); return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]; };
  function dayText(ms) {
    const [y, m, d] = msk(ms);
    return d + ' ' + MON[m] + (y !== msk(Date.now())[0] ? ' ' + y : '');
  }
  function dayIso(ms) {
    const [y, m, d] = msk(ms);
    return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  /* ---------- хранилище браузера ---------- */
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } },
  };
  function doneAll() {
    const m = store.get(LS_DONE), out = Object.create(null);
    if (m && typeof m === 'object' && !Array.isArray(m)) {
      for (const k of Object.keys(m)) if (m[k] && typeof m[k] === 'object') out[k] = m[k];
    }
    return out;
  }
  /* Отзыв с этого браузера: сначала свои подробности, потом общий список api.js (там только id мест) */
  function doneOf(id) {
    const m = doneAll();
    if (has(m, id)) return m[id];
    const a = store.get(LS_API_DONE);
    return Array.isArray(a) && a.indexOf(id) >= 0 ? { id: '', p: 0, t: 0 } : null;
  }
  function markDone(id, info) {
    const m = doneAll();
    m[id] = Object.assign({ t: Date.now() }, info);
    const keep = Object.keys(m).sort((a, b) => (+m[b].t || 0) - (+m[a].t || 0)).slice(0, 300);
    store.set(LS_DONE, dict(keep.map(k => [k, m[k]])));
  }
  function reportedAll() { const a = store.get(LS_REP); return Array.isArray(a) ? a.filter(x => typeof x === 'string') : []; }
  function setReported(id, on) {
    const a = reportedAll().filter(x => x !== id);
    if (on) a.push(id);
    store.set(LS_REP, a.slice(-300));
  }

  /* ---------- бэкенд ---------- */
  const api = () => { const a = window.KudaAPI; return a && a.on ? a : null; };
  async function call(name, ...args) { return (await callE(name, ...args))[0]; }
  /* [ответ, код ошибки]: api.js при отказе сервера отдаёт null, а код ('dup', 'rate', 'nf'…) кладёт в lastError —
     читаем его сразу после ответа, пока другой запрос его не перезаписал. Ответ вида {ok:false, error} тоже понимаем */
  async function callE(name, ...args) {
    const a = api();
    if (!a || typeof a[name] !== 'function') return [null, 'off'];
    try {
      const r = await a[name](...args);
      if (r != null && !(typeof r === 'object' && r.ok === false)) return [r, ''];
      const code = r && typeof r.error === 'string' ? r.error : typeof a.lastError === 'string' ? a.lastError : '';
      return [null, code];
    } catch (e) { return [null, 'client']; }
  }
  function authName() {
    try {
      const A = window.KudaAuth;
      const u = A && (typeof A.user === 'function' ? A.user() : A.user);
      const n = u && typeof u.name === 'string' ? clean(u.name, NAME_MAX) : '';
      return n === 'Ты' ? '' : n;   // «Ты» — заглушка auth.js, когда профиль не загрузился
    } catch (e) { return ''; }
  }
  /* Токен Яндекс ID для отметки «✓ Яндекс ID» (сервер сам проверит его в login.yandex.ru).
     KudaAuth.token() может вернуть строку или промис — промис ждём не дольше 1,5 с */
  async function authToken() {
    try {
      const A = window.KudaAuth;
      let t = A && typeof A.token === 'function' ? A.token() : '';
      if (t && typeof t.then === 'function') {
        t = await Promise.race([Promise.resolve(t).catch(() => ''), new Promise(r => setTimeout(() => r(''), 1500))]);
      }
      t = typeof t === 'string' ? t.trim() : '';
      return TOKEN_RE.test(t) ? t : '';
    } catch (e) { return ''; }
  }
  function track(S, stars) {
    try {
      const T = window.KudaTrack;
      if (T && typeof T.ev === 'function') T.ev('review', { kind: 'place', id: S.id, mode: S.mode || undefined, v: stars });
    } catch (e) { /* аналитика не мешает отзыву */ }
  }

  /* ---------- оценки всех мест: {placeId: [avg, count, dateAvg|null, groupAvg|null(, dateN, groupN)]} ---------- */
  let R = Object.create(null);
  function sub(a, n) {
    if (a == null || a === '') return null;
    a = +a;
    if (!(a >= 1 && a <= 5)) return null;
    if (n != null && !(+n >= SOLID)) return null;
    return Math.round(a * 10) / 10;
  }
  function row(v) {
    if (!Array.isArray(v)) return null;
    const avg = +v[0], count = Math.floor(+v[1]);
    if (!(count > 0) || !(avg >= 1 && avg <= 5)) return null;
    // сколько отзывов за под-оценкой, сервер может не прислать; при count < 3 их точно меньше трёх
    const n = i => v[i] != null ? v[i] : count < SOLID ? 0 : null;
    return { avg: Math.round(avg * 10) / 10, count, date: sub(v[2], n(4)), group: sub(v[3], n(5)), subN: v[4] != null && v[5] != null };
  }
  function setRatings(res) {
    // api.js отдаёт карту; на всякий случай понимаем и ответ сервера целиком {ok, r, at}
    const map = res && typeof res === 'object' && res.r && typeof res.r === 'object' && !Array.isArray(res.r) ? res.r : res;
    const out = Object.create(null);
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      for (const id of Object.keys(map)) { const r = row(map[id]); if (r) out[id] = r; }
    }
    R = out;
  }
  function emit() {
    try { document.dispatchEvent(new CustomEvent('kuda-ratings')); } catch (e) { /* без события */ }
  }
  async function load() {
    const res = await call('ratings');
    if (res) { setRatings(res); emit(); }
    return !!res;
  }
  /* ready не ждёт дольше 8 с: карточки рисуются и без звёзд, звёзды придут событием kuda-ratings */
  const ready = new Promise(resolve => {
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    const go = () => { load().then(fin, fin); };
    setTimeout(fin, 8000);
    if (window.KudaAPI) go();
    else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
    else setTimeout(go, 0);
  });

  function rating(id) {
    const r = id != null ? R[id] : null;
    return r ? { avg: r.avg, count: r.count, date: r.date, group: r.group } : null;
  }
  function score(id) {
    const r = id != null ? R[id] : null;
    const n = r ? r.count : 0, sum = r ? r.avg * r.count : 0;
    return (WEIGHT * PRIOR + sum) / (WEIGHT + n);
  }
  function pill(label, inner, cls) {
    return `<span class="rv-badge${cls ? ' ' + cls : ''}" role="img" aria-label="${esc(label)}"><span class="rv-st" aria-hidden="true">★</span> ${inner}</span>`;
  }
  const fresh = (label, n) => pill(`${label}: ${n} ${rw(n)}`, '<span class="rv-bt">новое</span>', 'rv-new');
  function badge(id, opts) {
    const r = id != null ? R[id] : null;
    if (!r) return '';
    if (r.count < SOLID) return fresh('Оценок пока мало', r.count);
    const short = !!(opts && opts.short);
    return pill(`Оценка ${num(r.avg)} из 5, ${r.count} ${rw(r.count)}`,
      `<span class="rv-bt">${num(r.avg)}</span>${short ? '' : `<span class="rv-bn"> · ${r.count}</span>`}`);
  }
  /* Оценка плана — среднее по остановкам, у которых уже есть 3+ отзыва */
  function planBadge(plan, opts) {
    const ids = plan && Array.isArray(plan.stops) ? plan.stops.filter((x, i, a) => a.indexOf(x) === i) : [];
    const rs = ids.map(id => R[id]).filter(Boolean);
    if (!rs.length) return '';
    const solid = rs.filter(r => r.count >= SOLID);
    if (!solid.length) return fresh('Места плана только начали оценивать', rs.reduce((s, r) => s + r.count, 0));
    const avg = solid.reduce((s, r) => s + r.avg, 0) / solid.length, n = solid.reduce((s, r) => s + r.count, 0);
    const short = !!(opts && opts.short);
    return pill(`Средняя оценка мест плана ${num(avg)} из 5, ${n} ${rw(n)}`,
      `<span class="rv-bt">${num(avg)}</span>${short ? '' : `<span class="rv-bn"> · ${n}</span>`}`);
  }

  /* ---------- блок «Отзывы» ---------- */
  function normItem(x) {
    if (!x || typeof x !== 'object') return null;
    const stars = Math.round(+x.stars);
    if (!(stars >= 1 && stars <= 5)) return null;
    const tags = Array.isArray(x.tags) ? x.tags.filter((t, i, a) => typeof t === 'string' && has(TAG, t) && a.indexOf(t) === i).slice(0, TAGS_MAX) : [];
    const reply = typeof x.reply === 'string' ? x.reply : x.reply && typeof x.reply.text === 'string' ? x.reply.text : '';
    return {
      id: x.id == null ? '' : String(x.id).slice(0, 80),
      stars, tags,
      text: typeof x.text === 'string' ? x.text.trim().slice(0, 2000) : '',
      name: typeof x.name === 'string' ? clean(x.name, 40) : '',
      fit: x.fit === 'date' || x.fit === 'group' ? x.fit : '',
      at: toMs(x.at), reply: reply.trim().slice(0, 2000), ver: x.ver === true, own: false,
    };
  }

  /* stats с первой страницы (необязательно): {dist:[n1..n5], tags:{talk:n…}, date:[avg,n]|null, group:[avg,n]|null}.
     Копируем: объект ответа может лежать в кэше api.js, а мы его дополняем после своего отзыва */
  function normStats(x) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
    const o = {};
    if (Array.isArray(x.dist)) o.dist = x.dist.slice(0, 5);
    if (x.tags && typeof x.tags === 'object' && !Array.isArray(x.tags)) {
      o.tags = TAGS.reduce((t, [k]) => { t[k] = Math.max(0, Math.floor(+x.tags[k]) || 0); return t; }, {});
    }
    SUBS.forEach(([k]) => { if (has(x, k)) o[k] = Array.isArray(x[k]) ? x[k].slice(0, 2) : null; });
    return o;
  }

  /* Сводка: точные числа — из stats сервера или когда загружены все отзывы; иначе — из общей карты оценок */
  function agg(S) {
    const all = !S.more, st = S.stats && typeof S.stats === 'object' ? S.stats : null, r = R[S.id];
    let dist = null;
    if (st && Array.isArray(st.dist) && st.dist.length === 5) {
      dist = st.dist.map(n => Math.max(0, Math.floor(+n) || 0));
      if (!dist.some(Boolean)) dist = null;
    }
    if (!dist && all && S.items.length) {
      dist = [0, 0, 0, 0, 0];
      S.items.forEach(it => { dist[it.stars - 1]++; });
    }
    const n = dist ? dist.reduce((s, x) => s + x, 0) : 0;
    let avg = null;
    if (dist) avg = dist.reduce((s, x, i) => s + x * (i + 1), 0) / n;
    else if (r) avg = r.avg;
    else if (S.items.length) avg = S.items.reduce((s, it) => s + it.stars, 0) / S.items.length;
    const subOf = k => {
      if (st && has(st, k)) return Array.isArray(st[k]) ? sub(st[k][0], st[k][1]) : null;
      const xs = S.items.filter(it => it.fit === k);
      if (all) return xs.length >= SOLID ? sub(xs.reduce((s, it) => s + it.stars, 0) / xs.length) : null;
      // загружена не вся лента: цифре из общей карты верим, если сервер прислал счётчики или 3+ таких отзыва уже видно
      return r && r[k] != null && (r.subN || xs.length >= SOLID) ? r[k] : null;
    };
    const cnt = Object.create(null);
    if (st && st.tags) TAGS.forEach(([k]) => { cnt[k] = st.tags[k]; });
    else S.items.forEach(it => it.tags.forEach(t => { cnt[t] = (cnt[t] || 0) + 1; }));
    const min = S.total >= 8 ? 2 : 1;   // при многих отзывах единичные теги — шум
    const tags = TAGS.map(([k, l]) => [k, l, cnt[k] || 0]).filter(t => t[2] >= min).sort((a, b) => b[2] - a[2]).slice(0, 6);
    // числа у тегов — только точные (stats сервера или вся лента), иначе просто «что отмечают»
    return { avg, dist, n, date: subOf('date'), group: subOf('group'), tags, tagsExact: !!(st && st.tags) || all };
  }

  function bodyHtml(S) {
    if (S.state === 'loading') return '<p class="rv-load">Загружаю отзывы…</p>';
    if (S.state === 'error') return '<p class="rv-empty">Отзывы не загрузились. <button type="button" class="rv-link" data-rv="retry">Повторить</button></p>';
    if (!S.total) {
      const who = S.mode === 'date' ? 'Были здесь на свидании?' : S.mode === 'guys' || S.mode === 'girls' ? 'Были здесь с компанией?' : 'Были здесь?';
      return `<p class="rv-empty">Отзывов пока нет. ${who} Расскажи, как прошло, — это поможет другим выбрать.</p>`;
    }
    const a = agg(S);
    const line = `<p class="rv-line">${a.avg != null ? `<span class="rv-big"><span class="rv-st" aria-hidden="true">★</span> <span class="rv-sr">Средняя оценка </span>${num(a.avg)}<span class="rv-sr"> из 5</span></span> ` : ''}<span class="rv-cnt">${a.avg != null ? '<span class="rv-dot" aria-hidden="true">· </span>' : ''}${S.total} ${rw(S.total)}</span></p>`;
    const bars = a.dist ? `<ul class="rv-bars" aria-label="Сколько каких оценок">${[5, 4, 3, 2, 1].map(s => {
      const c = a.dist[s - 1], w = a.n ? Math.round(c / a.n * 100) : 0;
      return `<li><span class="rv-bl" aria-hidden="true">${s}</span><span class="rv-bar" aria-hidden="true"><i style="width:${w}%"></i></span><span class="rv-bc" aria-hidden="true">${c}</span><span class="rv-sr">${s} ${plural(s, 'звезда', 'звезды', 'звёзд')}: ${c}</span></li>`;
    }).join('')}</ul>` : '';
    const subs = SUBS.map(([k, l]) => a[k] != null ? `<span>${l} <b>${num(a[k])}</b></span>` : '').filter(Boolean);
    const subHtml = subs.length ? `<p class="rv-subs">${subs.join('<span aria-hidden="true"> · </span>')}</p>` : '';
    const cloud = a.tags.length ? `<ul class="rv-cloud" aria-label="Что отмечают гости">${a.tags.map(([, l, c]) =>
      `<li class="rv-tag">${esc(l)}${a.tagsExact ? ` <b>${c}</b>` : ''}</li>`).join('')}</ul>` : '';
    return `<div class="rv-sum">${line}${bars}</div>${subHtml}${cloud}`;
  }

  function textHtml(t) {
    const chars = Array.from(t);
    if (chars.length <= CUT) return `<p class="rv-text">${esc(t)}</p>`;
    let cut = chars.slice(0, CUT).join('');
    const sp = cut.lastIndexOf(' ');
    if (sp > CUT * 0.6) cut = cut.slice(0, sp);
    cut = cut.replace(/[\s.,;:!?…—–-]+$/, '');
    // одной строкой: у .rv-text white-space: pre-line
    return `<p class="rv-text"><span data-rv-short>${esc(cut)}…</span><span data-rv-full hidden>${esc(t)}</span> <button type="button" class="rv-link rv-exp" data-rv="expand" aria-expanded="false">ещё</button></p>`;
  }
  const REPORT_BTN = '<button type="button" class="rv-link" data-rv="report">Пожаловаться</button>';
  /* Автор вошёл через Яндекс ID — сервер проверил токен и прислал ver: true */
  const VER = '<span class="rv-ver" title="Автор вошёл через Яндекс ID"><span aria-hidden="true">✓</span><span class="rv-sr">Вошёл через</span> Яндекс ID</span>';
  function itemHtml(it, reported) {
    const acts = it.own ? '<span class="rv-mine">Твой отзыв</span>'
      : reported ? '<span class="rv-done">Жалоба отправлена — проверим</span>'
        : it.id ? REPORT_BTN : '';
    return `<li class="rv-item${it.own ? ' rv-own' : ''}" data-rv-id="${esc(it.id)}" tabindex="-1">
      <div class="rv-top"><span class="rv-name">${esc(it.name || 'Гость')}</span>${it.ver ? VER : ''}<span class="rv-stars" role="img" aria-label="Оценка ${it.stars} из 5"><span class="rv-on">${'★'.repeat(it.stars)}</span><span class="rv-off">${'★'.repeat(5 - it.stars)}</span></span>${it.at ? `<time class="rv-date" datetime="${dayIso(it.at)}">${dayText(it.at)}</time>` : ''}</div>
      ${it.fit || it.tags.length ? `<p class="rv-itags">${it.fit ? `<span class="rv-fit">${FIT_DONE[it.fit]}</span>` : ''}${it.tags.map(t => `<span class="rv-itag">${esc(TAG[t])}</span>`).join('')}</p>` : ''}
      ${it.text ? textHtml(it.text) : ''}
      ${it.reply ? `<div class="rv-reply"><b>Ответ «Куда идём?»</b><p>${esc(it.reply)}</p></div>` : ''}
      ${acts ? `<div class="rv-acts">${acts}</div>` : ''}
    </li>`;
  }

  function noteHtml(d) {
    const wait = d && +d.p && Date.now() - (+d.t || 0) < 7 * 864e5;
    return `<p class="rv-note" tabindex="-1">${wait ? 'Твой отзыв на проверке — появится здесь, как только мы его посмотрим.' : 'Твой отзыв об этом месте уже у нас. Спасибо!'}</p>`;
  }
  function formHtml(S) {
    const u = S.uid;
    /* имя радиокнопки — «1 звезда»…«5 звёзд» (текст подписи и aria-label), словесная оценка («Плохо»…) — описание */
    const star = n => {
      const nm = n + ' ' + plural(n, 'звезда', 'звезды', 'звёзд');
      return `<input type="radio" class="rv-sr" name="${u}-s" id="${u}-s${n}" value="${n}" data-rv-in="star" aria-label="${nm}" aria-describedby="${u}-w${n}" required><label for="${u}-s${n}" data-n="${n}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${STAR_D}"/></svg><span class="rv-sr">${nm}</span></label><span id="${u}-w${n}" hidden>${WORD[n]}</span>`;
    };
    const fit = ([v, l], i) => `<input type="radio" class="rv-sr" name="${u}-fit" id="${u}-f${i}" value="${v}" data-rv-in="fit"><label for="${u}-f${i}" class="rv-chip">${l}</label>`;
    const tag = ([v, l]) => `<input type="checkbox" class="rv-sr" id="${u}-t-${v}" value="${v}" data-rv-in="tag"><label for="${u}-t-${v}" class="rv-chip">${esc(l)}</label>`;
    return `<form class="rv-form" id="${u}-f" hidden novalidate aria-labelledby="${u}-ft">
      <p class="rv-ft" id="${u}-ft">${S.name ? `Как тебе «${esc(S.name)}»?` : 'Как тебе это место?'}</p>
      <fieldset class="rv-fs"><legend>Твоя оценка</legend>
        <div class="rv-rate" data-rv-rate>${[1, 2, 3, 4, 5].map(star).join('')}</div>
        <p class="rv-word" data-rv-word aria-hidden="true">Нажми на звезду</p></fieldset>
      <fieldset class="rv-fs"><legend>Для чего ходили?</legend><div class="rv-chips">${FITS.map(fit).join('')}</div></fieldset>
      <fieldset class="rv-fs"><legend>Что запомнилось? <span class="rv-opt">до ${TAGS_MAX}</span></legend><div class="rv-chips">${TAGS.map(tag).join('')}</div></fieldset>
      <div class="rv-field"><label for="${u}-x">Пару слов <span class="rv-opt">— по желанию</span></label>
        <textarea id="${u}-x" rows="4" maxlength="${TEXT_MAX}" data-rv-in="text" aria-describedby="${u}-c" placeholder="Что понравилось, что нет? Можно ли спокойно поговорить, были ли очереди?"></textarea>
        <span class="rv-count" id="${u}-c" data-rv-count>0 / ${TEXT_MAX}</span></div>
      <div class="rv-field"><label for="${u}-n">Как тебя подписать</label>
        <input id="${u}-n" type="text" maxlength="${NAME_MAX}" autocomplete="nickname" data-rv-in="name" placeholder="Гость" value="${esc(authName())}"></div>
      <p class="rv-consent">Отзыв увидят все. Не пиши телефоны и ссылки. <a href="${esc(PRIVACY)}" target="_blank" rel="noopener">Как мы храним отзывы</a></p>
      <p class="rv-err" data-rv-err role="alert"></p>
      <div class="rv-actions"><button type="submit" class="rv-btn rv-primary">Отправить отзыв</button><button type="button" class="rv-btn rv-ghost" data-rv="cancel">Отмена</button></div>
    </form>`;
  }
  function writeHtml(S) {
    const d = doneOf(S.id);
    if (d) return noteHtml(d);
    return `<button type="button" class="rv-btn rv-ghost rv-wide" data-rv="open" aria-expanded="false" aria-controls="${S.uid}-f">${PEN}Оставить отзыв</button>
      ${formHtml(S)}
      <div class="rv-thanks" data-rv-thanks role="status" tabindex="-1" hidden></div>`;
  }
  function shellHtml(S) {
    const u = S.uid;
    return `<section class="rv" id="${u}" data-reviews="${esc(S.id)}" aria-labelledby="${u}-h" aria-busy="true">
      <div class="rv-head"><h4 class="rv-h" id="${u}-h">${esc(S.title)}</h4></div>
      <div class="rv-body" data-rv-body>${bodyHtml(S)}</div>
      <div class="rv-write" data-rv-write>${writeHtml(S)}</div>
      <ul class="rv-list" data-rv-list hidden></ul>
      <p class="rv-pager" data-rv-pager hidden><button type="button" class="rv-btn rv-ghost rv-wide" data-rv="more">Показать ещё</button></p>
    </section>`;
  }

  const focus = el => { try { if (el && typeof el.focus === 'function') el.focus(); } catch (e) { /* ок */ } };
  const alive = S => S.box.__rv === S.uid && S.root.isConnected !== false;
  const $ = (S, sel) => S.root.querySelector(sel);
  const $$ = (S, sel) => Array.from(S.root.querySelectorAll(sel));

  function paintBody(S) { const b = $(S, '[data-rv-body]'); if (b) b.innerHTML = bodyHtml(S); }
  /* where: 'reset' — заменить список, 'start' — свой новый отзыв сверху, 'end' — следующая страница */
  function paintList(S, items, where) {
    const ul = $(S, '[data-rv-list]');
    if (!ul) return;
    const rep = reportedAll();
    const html = items.map(it => itemHtml(it, !!it.id && rep.includes(it.id))).join('');
    if (where === 'reset') ul.innerHTML = html;
    else if (html) ul.insertAdjacentHTML(where === 'start' ? 'afterbegin' : 'beforeend', html);
    ul.hidden = !S.shown;
  }
  /* Сначала видно FIRST отзывов, «Показать ещё» открывает следующие PAGE (догружая с сервера) */
  function paintPager(S) {
    const p = $(S, '[data-rv-pager]'), b = $(S, '[data-rv="more"]');
    if (!p || !b) return;
    p.hidden = !(S.shown < S.items.length || S.more);
    const left = S.total - S.shown;
    b.textContent = left > 0 ? `Показать ещё ${Math.min(PAGE, left)}` : 'Показать ещё';
    b.disabled = false;
  }
  function paintWrite(S) { const w = $(S, '[data-rv-write]'); if (w) w.innerHTML = writeHtml(S); }

  async function fetchPage(S, before) {
    const req = before ? S.req : ++S.req;
    const res = await call('reviews', S.id, before || undefined);
    if (!alive(S) || req !== S.req) return false;
    if (!res || res.ok === false || !Array.isArray(res.items)) {
      if (!before) { S.state = 'error'; paintBody(S); S.root.setAttribute('aria-busy', 'false'); }
      return false;
    }
    const seen = new Set(S.items.map(it => it.id).filter(Boolean)), got = [];
    res.items.forEach(x => {
      const it = normItem(x);
      if (!it || (it.id && seen.has(it.id))) return;
      if (it.id) seen.add(it.id);
      got.push(it);
    });
    const d = doneOf(S.id);
    got.forEach(it => { if (d && d.id && it.id === String(d.id)) it.own = true; });
    if (!before) S.stats = normStats(res.stats);
    S.items = S.items.concat(got);
    const total = Math.floor(+res.total), known = total >= 0;
    S.total = Math.max(known ? total : 0, S.items.length);
    S.more = got.length > 0 && (known ? S.items.length < S.total : got.length >= PAGE);
    S.state = 'ok';
    // отзыв с проверки уже опубликован — убираем «на проверке»
    if (d && +d.p && got.some(it => it.own)) { markDone(S.id, { id: d.id, p: 0, t: d.t }); paintWrite(S); }
    paintBody(S);
    if (!before) {
      S.shown = Math.min(FIRST, S.items.length);
      paintList(S, S.items.slice(0, S.shown), 'reset');
      paintPager(S);
      S.root.setAttribute('aria-busy', 'false');
    }
    return true;
  }
  async function more(S, b) {
    if (S.paging) return;
    const want = S.shown + PAGE, last = S.items.filter(it => it.id).pop();
    if (S.items.length < want && S.more && last) {
      S.paging = true;
      b.disabled = true; b.textContent = 'Загружаю…';
      const ok = await fetchPage(S, last.id);
      S.paging = false;
      if (!alive(S)) return;
      if (!ok && S.shown >= S.items.length) { b.disabled = false; b.textContent = 'Не загрузилось — нажми ещё раз'; return; }
    }
    const from = S.shown;
    S.shown = Math.min(want, S.items.length);
    paintList(S, S.items.slice(from, S.shown), 'end');
    paintPager(S);
    // кнопка исчезла — переводим фокус на первый новый отзыв, чтобы он не потерялся
    if ($(S, '[data-rv-pager]').hidden) focus($$(S, '.rv-item')[from]);
  }

  function paintStars(S, n) {
    $$(S, '[data-rv-rate] label').forEach(l => {
      if (+l.getAttribute('data-n') <= n) l.classList.add('on'); else l.classList.remove('on');
    });
    const w = $(S, '[data-rv-word]');
    if (w) w.textContent = n ? WORD[n] : 'Нажми на звезду';
  }
  const picked = (S, kind) => $$(S, `input[data-rv-in="${kind}"]`).filter(i => i.checked);
  const chosen = S => { const c = picked(S, 'star')[0]; return c ? +c.value : 0; };
  function limitTags(S) {
    const all = $$(S, 'input[data-rv-in="tag"]'), on = all.filter(i => i.checked).length;
    all.forEach(i => { i.disabled = !i.checked && on >= TAGS_MAX; });
  }
  function setErr(S, msg) { const e = $(S, '[data-rv-err]'); if (e) e.textContent = msg; }
  function openForm(S, on) {
    const f = $(S, '.rv-form'), b = $(S, '[data-rv="open"]');
    if (!f || !b) return;
    f.hidden = !on; b.hidden = on;
    b.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (!on) { setErr(S, ''); focus(b); return; }
    const nm = $(S, 'input[data-rv-in="name"]');
    if (nm && !nm.value) { const a = authName(); if (a) nm.value = a; }
    focus(picked(S, 'star')[0] || $(S, 'input[data-rv-in="star"]'));
  }
  const THANKS = {
    sending: '<b>Спасибо!</b> Отправляем отзыв…',
    pending: '<b>Спасибо за отзыв!</b> Он появится здесь, как только мы его проверим.',
    done: '<b>Спасибо за отзыв!</b> Он уже в списке и поможет другим выбрать.',
  };
  function thanks(S, st) {
    const f = $(S, '.rv-form'), t = $(S, '[data-rv-thanks]');
    if (!t) return;
    if (!st) { t.hidden = true; t.innerHTML = ''; if (f) f.hidden = false; return; }
    t.innerHTML = THANKS[st];
    t.hidden = false;
    if (f) f.hidden = true;
    focus(t);
  }
  /* Коды: сервер (server/handler.mjs) и api.js ('net', 'timeout' — связь; 'bad', 'http' — странный ответ) */
  function errText(code) {
    code = String(code || '');
    if (!code || /^(net|timeout|abort)/i.test(code)) return 'Не получилось отправить. Проверь интернет и попробуй ещё раз.';
    if (/rate|limit|flood|many|slow/i.test(code)) return 'Слишком много отзывов подряд. Попробуй чуть позже.';
    if (/^(off|busy|disabled|unavailable)$/i.test(code)) return 'Отзывы сейчас временно не принимаем. Загляни чуть позже.';
    if (/^(text|stars|tags?|name|fit|place|big|long|short|invalid)$/i.test(code)) return 'Сервер не принял отзыв. Проверь оценку и текст и попробуй ещё раз.';
    return 'Не получилось отправить — что-то сломалось у нас. Попробуй ещё раз чуть позже.';
  }
  /* Новый опубликованный отзыв сразу учитываем в звёздах карточек… */
  function bumpRating(id, stars) {
    const r = R[id], n = (r ? r.count : 0) + 1;
    R[id] = { avg: Math.round(((r ? r.avg * r.count : 0) + stars) / n * 10) / 10, count: n, date: r ? r.date : null, group: r ? r.group : null };
    emit();
  }
  /* …и в сводке и списке открытого блока */
  function bumpList(S, it) {
    S.total += 1;
    S.items.unshift(it);
    const st = S.stats;
    if (!st) return;
    if (Array.isArray(st.dist) && st.dist.length === 5) st.dist = st.dist.map((x, i) => (Math.floor(+x) || 0) + (i === it.stars - 1 ? 1 : 0));
    if (st.tags) it.tags.forEach(t => { st.tags[t] += 1; });
    if (it.fit && Array.isArray(st[it.fit]) && st[it.fit][1] != null) {
      const [a, c] = st[it.fit], k = (Math.floor(+c) || 0) + 1;
      st[it.fit] = [((+a || 0) * (k - 1) + it.stars) / k, k];
    }
  }

  async function submit(S) {
    if (S.busy) return;
    const stars = chosen(S);
    if (!(stars >= 1 && stars <= 5)) {
      setErr(S, 'Поставь оценку — от 1 до 5 звёзд.');
      focus($(S, 'input[data-rv-in="star"]'));
      return;
    }
    const ta = $(S, 'textarea[data-rv-in="text"]'), nm = $(S, 'input[data-rv-in="name"]');
    const text = clean(ta ? ta.value : '', TEXT_MAX, true), name = clean(nm ? nm.value : '', NAME_MAX);
    if (bad(text) || bad(name)) {
      setErr(S, 'Убери, пожалуйста, телефоны и ссылки — отзыв увидят все.');
      focus(bad(text) ? ta : nm);
      return;
    }
    const tags = picked(S, 'tag').map(i => i.value).filter(t => has(TAG, t)).slice(0, TAGS_MAX);
    const fv = (picked(S, 'fit')[0] || {}).value;
    const data = { place: S.id, stars, text, tags, name, fit: fv === 'date' || fv === 'group' ? fv : '' };
    try { const a = api(), d = a && typeof a.dev === 'function' ? a.dev() : ''; if (typeof d === 'string' && d) data.dev = d; } catch (e) { /* api.js добавит сам */ }
    setErr(S, '');
    S.busy = true;
    thanks(S, 'sending');   // оптимистично: «спасибо» сразу, ответ сервера уточнит
    const tok = await authToken();
    if (tok) data.yandexToken = tok;
    let [res, code] = await callE('review', data);
    // токен Яндекса не подошёл — отзыв всё равно примем, просто без отметки «вошёл через Яндекс ID»
    if (!res && code === 'token' && data.yandexToken) {
      delete data.yandexToken;
      [res, code] = await callE('review', data);
    }
    S.busy = false;
    const ok = !!res && (res.ok === true || !!res.item || typeof res.pending === 'boolean');
    if (ok) {
      const pending = res.pending === true || (!res.item && res.pending !== false);
      let it = null;
      if (!pending) {
        it = normItem(res.item) || normItem(Object.assign({ id: '' }, data));
        if (!it.at) it.at = Date.now();
        it.own = true;
      }
      markDone(S.id, { id: it ? it.id : res.item && res.item.id != null ? String(res.item.id) : '', p: pending ? 1 : 0 });
      track(S, stars);
      if (it) bumpRating(S.id, it.stars);
      if (!alive(S)) return;
      if (it && S.state === 'ok') {
        bumpList(S, it);
        S.shown += 1;
        paintBody(S);
        paintList(S, [it], 'start');
        paintPager(S);
      } else if (it && S.state === 'error') {
        // список не загрузился — пробуем снова, свой отзыв придёт с сервера
        S.state = 'loading'; S.items = []; S.total = 0; S.shown = 0; S.more = false; S.stats = null;
        paintBody(S);
        fetchPage(S, '');
      }
      thanks(S, pending ? 'pending' : 'done');
      return;
    }
    if (/dup|already|exist|twice|reviewed/i.test(code)) {
      markDone(S.id, { id: '', p: 0 });
      if (!alive(S)) return;
      paintWrite(S);
      focus($(S, '.rv-note'));
      return;
    }
    if (!alive(S)) return;
    thanks(S, '');
    setErr(S, errText(code));
    focus($(S, '.rv-form button[type="submit"]'));
  }

  function expand(b) {
    const p = b.closest('.rv-text');
    if (!p) return;
    const s = p.querySelector('[data-rv-short]'), f = p.querySelector('[data-rv-full]');
    const open = b.getAttribute('aria-expanded') !== 'true';
    if (s) s.hidden = open;
    if (f) f.hidden = !open;
    b.setAttribute('aria-expanded', open ? 'true' : 'false');
    b.textContent = open ? 'свернуть' : 'ещё';
  }
  function reportAsk(b) {
    const li = b.closest('.rv-item'), acts = li && li.querySelector('.rv-acts');
    if (!acts) return;
    acts.innerHTML = `<div class="rv-confirm" role="group" aria-label="Жалоба на отзыв"><p>Что не так с отзывом? Мы проверим его.</p><div class="rv-chips">${REASONS.map(([k, l]) =>
      `<button type="button" class="rv-chip" data-rv="rep-go" data-reason="${k}">${l}</button>`).join('')}</div><button type="button" class="rv-link" data-rv="rep-cancel">Отмена</button></div>`;
    focus(acts.querySelector('[data-rv="rep-go"]'));
  }
  function reportCancel(b) {
    const li = b.closest('.rv-item'), acts = li && li.querySelector('.rv-acts');
    if (!acts) return;
    acts.innerHTML = REPORT_BTN;
    focus(acts.querySelector('[data-rv="report"]'));
  }
  async function reportSend(S, b) {
    const li = b.closest('.rv-item'), acts = li && li.querySelector('.rv-acts');
    const id = li ? li.getAttribute('data-rv-id') : '';
    if (!acts || !id || S.reporting) return;
    const reason = b.getAttribute('data-reason') || 'other';
    S.reporting = true;
    setReported(id, true);
    acts.innerHTML = '<span class="rv-done" tabindex="-1">Спасибо! Проверим этот отзыв.</span>';
    focus(acts.querySelector('.rv-done'));
    const [res, code] = await callE('report', id, reason);
    S.reporting = false;
    // nf — отзыв уже скрыли или удалили: жаловаться больше не на что
    if (res || /dup|already|exist|^nf$|not.?found/i.test(code)) return;
    setReported(id, false);
    if (!alive(S)) return;
    const why = /rate|limit/i.test(code) ? 'Слишком много жалоб подряд — попробуй чуть позже.' : 'Жалоба не отправилась.';
    acts.innerHTML = `<span class="rv-fail">${why}</span> <button type="button" class="rv-link" data-rv="report">Попробовать ещё раз</button>`;
  }

  function bind(S) {
    const root = S.root;
    root.addEventListener('click', e => {
      const b = e.target && e.target.closest ? e.target.closest('[data-rv]') : null;
      if (!b) return;
      const act = b.getAttribute('data-rv');
      if (act === 'more') more(S, b);
      else if (act === 'retry') { S.state = 'loading'; S.items = []; S.total = 0; S.shown = 0; S.more = false; S.stats = null; paintBody(S); fetchPage(S, ''); }
      else if (act === 'open') openForm(S, true);
      else if (act === 'cancel') openForm(S, false);
      else if (act === 'expand') expand(b);
      else if (act === 'report') reportAsk(b);
      else if (act === 'rep-go') reportSend(S, b);
      else if (act === 'rep-cancel') reportCancel(b);
    });
    root.addEventListener('change', e => {
      const t = e.target, kind = t && t.getAttribute ? t.getAttribute('data-rv-in') : '';
      if (kind === 'star') { paintStars(S, chosen(S)); setErr(S, ''); }
      else if (kind === 'tag') limitTags(S);
    });
    root.addEventListener('input', e => {
      const t = e.target, kind = t && t.getAttribute ? t.getAttribute('data-rv-in') : '';
      if (kind === 'name') setErr(S, '');
      if (kind !== 'text') return;
      setErr(S, '');
      const c = $(S, '[data-rv-count]'), n = String(t.value || '').length;
      if (!c) return;
      c.textContent = n + ' / ' + TEXT_MAX;
      if (n > TEXT_MAX - 50) c.classList.add('warn'); else c.classList.remove('warn');
    });
    root.addEventListener('submit', e => { e.preventDefault(); submit(S); });
    // наведение мышью подсвечивает звёзды; уходим — снова выбранная оценка
    root.addEventListener('mouseover', e => {
      const l = e.target && e.target.closest ? e.target.closest('label[data-n]') : null;
      if (l) paintStars(S, +l.getAttribute('data-n'));
    });
    root.addEventListener('mouseout', e => {
      const l = e.target && e.target.closest ? e.target.closest('label[data-n]') : null;
      if (l) paintStars(S, chosen(S));
    });
  }

  /* Якорь #reviews — у последнего смонтированного блока (id в документе один): прежний блок
     возвращает себе свой id. Чужой элемент с id="reviews" не трогаем — блок найдут по [data-reviews] */
  function anchor(S) {
    try {
      const doc = S.root.ownerDocument || document, old = doc.getElementById(ANCHOR);
      if (old && old !== S.root) {
        if (!old.hasAttribute('data-reviews')) return;
        if (old.__rvUid) old.setAttribute('id', old.__rvUid); else old.removeAttribute('id');
      }
      S.root.__rvUid = S.uid;
      S.root.setAttribute('id', ANCHOR);
    } catch (e) { /* без якоря остаётся [data-reviews] */ }
  }

  let seq = 0;
  /* Блок «Отзывы» в контейнере (пустой элемент в карточке места). Нет бэкенда — ничего не рисуем, false.
     opts: placeName, mode ('date'|'guys'|'girls'), title (заголовок, по умолчанию «Отзывы гостей»),
     open: true — сразу раскрыть форму («Как прошло? Оцени место»).
     У блока есть data-reviews="<id места>" и (если id свободен) id="reviews" — для перехода по start.html?place=…#reviews */
  function mount(container, placeId, opts) {
    if (!container || placeId == null || placeId === '' || !api()) return false;
    opts = opts || {};
    const title = typeof opts.title === 'string' ? clean(opts.title, 80) : '';
    const S = {
      id: String(placeId), name: String(opts.placeName || ''), mode: String(opts.mode || ''), title: title || TITLE,
      uid: 'kuda-rv' + (++seq), items: [], total: 0, shown: 0, stats: null, more: false, state: 'loading',
      busy: false, paging: false, reporting: false, req: 0, box: container, root: null,
    };
    container.__rv = S.uid;
    container.innerHTML = shellHtml(S);
    S.root = container.querySelector('.rv');
    anchor(S);
    bind(S);
    if (opts.open) openForm(S, true);
    fetchPage(S, '');
    // общая карта оценок пришла позже списка — уточняем сводку (нужно, когда загружена не вся лента)
    ready.then(() => { if (alive(S) && S.state === 'ok' && S.total) paintBody(S); });
    return true;
  }

  window.KudaReviews = {
    ready, rating, score, badge, planBadge, mount,
    reviewed: id => id != null && !!doneOf(String(id)),
    refresh: load,
    TAGS: TAGS.map(t => t.slice()),
    get on() { return !!api(); },
  };
})();

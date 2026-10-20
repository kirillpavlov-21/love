/* Подборки: проверка пунктов, авто-подборки и ссылка на свой список (window.KudaCols). Данные — assets/collections.js
   (window.KUDA.collections), разметку рисует hub.js; здесь только данные и правила, без DOM и без сети.
   ─ Город подборки — поле city, иначе по префиксу id ('spb-c-…' — Петербург), иначе Москва.
   ─ Живой пункт: место есть, не закрыто, не 18+ и сейчас его сезон; план — все остановки на месте и он в сезоне;
     событие ещё не прошло; и всё это — из города подборки. Живых меньше MIN — подборки нет нигде (на полке, по ссылке,
     в «Входит в подборки»).
   ─ На полке — подборки города и повода (mode), в свой сезон (season) и срок (from..until), плюс авто-подборки,
     которые считаем на месте: «Бесплатно на этих выходных» (с четверга по воскресенье), «Новое за месяц», «Допоздна»,
     «Если дождь» (когда на сегодня обещают осадки — флаг wet даёт страница) и «Обсуждают на этой неделе» (поле buzz).
     По прямой ссылке подборка открывается и не в сезон — лишь бы в ней были живые пункты.
   ─ Свой список: id через запятую в base64url — start.html?list=…&t=название, до LIST_MAX штук. Сервер не нужен. */
(function () {
  'use strict';

  const K = window.DateKit;
  if (!K) return;
  const MIN = 4, AUTO_MAX = 15, LIST_MAX = 40, NEW_DAYS = 30;
  const MODES = ['date', 'guys', 'girls'];
  const RX_YMD = /^\d{4}-\d{2}-\d{2}$/;
  const RX_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
  const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const arr = v => (Array.isArray(v) ? v : []);
  const str = v => (typeof v === 'string' ? v.trim() : '');
  const isCity = c => typeof c === 'string' && own(K.CITIES, c);
  const D = () => K.kuda();
  const today = () => K.todayMsk();
  const NB = '\u00a0';   // неразрывный пробел: «12 мест», «до 3 000 ₽»

  /* ---------- подборки из collections.js: только с правильной формой ---------- */
  let LIST = null;
  function list() {
    if (LIST) return LIST;
    const seen = new Set();
    LIST = arr(D().collections).filter(c => c && typeof c.id === 'string' && RX_ID.test(c.id) && !seen.has(c.id) && seen.add(c.id) &&
      str(c.title) && (Array.isArray(c.items) || Array.isArray(c.sections))).map(c => {
      const sections = arr(c.sections).filter(s => s && str(s.t) && Array.isArray(s.items)).map(s => ({ t: str(s.t), items: s.items.filter(x => typeof x === 'string') }));
      // у 'trip' пункты — в разделах; общий список — все пункты по порядку
      const items = arr(c.items).filter(x => typeof x === 'string').concat(...sections.map(s => s.items));
      return Object.assign({}, c, {
        title: str(c.title), emoji: str(c.emoji) || '📌', lead: str(c.lead), kind: c.kind === 'trip' ? 'trip' : 'editorial',
        items: Array.from(new Set(items)), sections, mode: arr(c.mode).filter(m => MODES.includes(m)),
        season: arr(c.season), from: RX_YMD.test(c.from || '') ? c.from : '', until: RX_YMD.test(c.until || '') ? c.until : '',
        filter: str(c.filter),
      });
    });
    return LIST;
  }
  const cityOfCol = c => (!c || c.auto ? '' : isCity(c.city) ? c.city : /^spb-/.test(c.id) ? 'spb' : 'msk');
  const fitsMode = (c, mode) => !c.mode || !c.mode.length || c.mode.includes(mode);
  /* Сезон (season) и срок (from..until) подборки по московскому дню */
  const inSeason = (c, day) => { day = day || today(); return K.seasonOk(c) && (!c.from || day >= c.from) && (!c.until || day <= c.until); };

  /* ---------- пункт подборки: место, план или событие ---------- */
  let PLAN_IX = null;
  const planIx = () => PLAN_IX || (PLAN_IX = new Map(arr(D().scenarios).filter(s => s && s.id).map(s => [s.id, s])));
  /* id → { id, kind: 'place' | 'plan' | 'event', x } (x — null, если закрыто); неизвестный id — null. p-<id места> — тоже место */
  function resolve(id) {
    if (typeof id !== 'string' || !RX_ID.test(id)) return null;
    if (planIx().has(id)) return { id, kind: 'plan', x: K.planById(id) };
    const P = D().places;
    const pid = !own(P, id) && /^p-/.test(id) ? id.slice(2) : id;
    if (own(P, pid)) return { id: pid, kind: 'place', x: K.placeById(pid) };
    const ev = K.eventById(id);
    return ev ? { id: ev.id, kind: 'event', x: ev } : null;
  }
  /* Пункт живой и из города city */
  function alive(r, city) {
    if (!r || !r.x) return false;
    const x = r.x;
    if (r.kind === 'place') return !x.adult && K.seasonOk(x) && K.cityOf(r.id) === city;
    if (r.kind === 'plan') return !x.single && K.planStops(x).length === x.stops.length && K.seasonOk(x) && K.cityOf(x) === city;
    return K.eventDays(x).length > 0 && K.cityOf(x) === city;
  }
  /* Живые пункты подборки или списка { items, city? } для города o.city */
  function liveOf(ids, city) {
    const seen = new Set(), out = [];
    arr(ids).forEach(id => {
      const r = resolve(id);
      if (!r || seen.has(r.kind + ':' + r.id) || !alive(r, city)) return;
      seen.add(r.kind + ':' + r.id);
      out.push(r);
    });
    return out;
  }

  /* ---------- авто-подборки: считаются на месте, у каждого города свои ---------- */
  const AUTO = {
    'a-free': { emoji: '🆓', title: 'Бесплатно на этих выходных',
      lead: 'События со свободным входом в эту субботу и воскресенье: выставки, концерты, лекции и праздники. Билет не нужен, но на некоторые просят зарегистрироваться — проверь на странице события.' },
    'a-rain': { emoji: '☔', title: 'Если дождь',
      lead: 'На сегодня обещают непогоду — собрали места под крышей: музеи, кафе, бани и развлечения, где дождь и снег вечер не испортят.' },
    'a-new': { emoji: '✨', title: 'Новое за месяц',
      lead: 'Места и планы, которые появились в каталоге за последние 30 дней: свежие открытия, о которых знают ещё не все.' },
    'a-late': { emoji: '🌙', title: 'Допоздна',
      lead: 'Куда пойти, если вечер только начинается в одиннадцать: места, которые работают до утра или круглосуточно. Часы лучше уточнить перед выходом.' },
    'a-buzz': { emoji: '🔥', title: 'Обсуждают на этой неделе',
      lead: 'Места, о которых больше всего говорили в последние дни: новые открытия и старые любимцы, к которым снова потянулись.' },
  };
  const AUTO_IDS = Object.keys(AUTO);
  const autoCol = id => (own(AUTO, id) ? Object.assign({ id, kind: 'auto', auto: true, mode: [], items: [], sections: [], filter: '' }, AUTO[id]) : null);

  const wdOf = ymd => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))).getUTCDay();
  /* Ближайшие выходные: с понедельника по пятницу — суббота и воскресенье этой недели, в субботу — она и воскресенье, в воскресенье — оно */
  function weekend(day) {
    const wd = wdOf(day), n = K.dayNum(day);
    if (wd === 0) return [day];
    return [K.numDay(n + 6 - wd), K.numDay(n + 7 - wd)];
  }
  /* Неделя по ISO 8601: '2026-W42' */
  function isoWeek(day) {
    const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)));
    const wd = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - wd);
    const y = d.getUTCFullYear(), w = Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
    return y + '-W' + String(w).padStart(2, '0');
  }
  const isNew = (x, day) => { const a = x && x.added; return !!a && RX_YMD.test(a) && a <= day && K.dayNum(day) - K.dayNum(a) <= NEW_DAYS; };

  /* Живые места города (без 18+ и не в сезон) — один раз на город */
  const PL_CACHE = {};
  function cityPlaces(city) {
    const key = city + '|' + today();   // сезон и закрытия меняются — кэш на день
    if (PL_CACHE[key]) return PL_CACHE[key];
    const P = D().places || {};
    return (PL_CACHE[key] = Object.keys(P).map(id => ({ id, kind: 'place', x: K.placeById(id) })).filter(r => alive(r, city)));
  }
  /* Порядок разделов каталога по поводу: что чаще нужно поздно вечером или в непогоду */
  const LATE_CATS = { date: ['bar', 'food', 'fun', 'coffee', 'culture', 'spa'], guys: ['bar', 'pc', 'spa', 'fun', 'food'], girls: ['bar', 'food', 'spa', 'fun', 'coffee'] };
  const RAIN_CATS = { date: ['culture', 'food', 'coffee', 'fun', 'books', 'spa', 'bar'], guys: ['fun', 'spa', 'bar', 'culture', 'food', 'pc'], girls: ['culture', 'spa', 'food', 'coffee', 'fun', 'books', 'bar'] };
  /* По очереди из каждого раздела (сначала с фото) — чтобы подборка не была из одних баров */
  function mix(rows, cats, n) {
    const by = cats.map(c => rows.filter(r => K.catOf(r.x) === c).sort((a, b) => !!K.photo(b.x) - !!K.photo(a.x)));
    const out = [];
    for (let i = 0; out.length < n && by.some(l => l.length > i); i++) by.forEach(l => { if (l[i] && out.length < n) out.push(l[i]); });
    return out;
  }
  function autoItems(id, o) {
    const city = o.city, mode = MODES.includes(o.mode) ? o.mode : 'date', day = today();
    if (id === 'a-free') {
      const wk = weekend(day);
      return K.events({ mode }).filter(e => Array.isArray(e.price) && +e.price[0] === 0 && (e.price[1] == null || +e.price[1] === 0) && K.cityOf(e) === city)
        .map(e => [e, K.eventDays(e).find(d => wk.includes(d))]).filter(x => x[1])
        .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)).slice(0, AUTO_MAX).map(x => ({ id: x[0].id, kind: 'event', x: x[0] }));
    }
    if (id === 'a-new') {
      const plans = arr(D().scenarios).filter(s => s && s.mode === mode && isNew(s, day)).map(s => ({ id: s.id, kind: 'plan', x: K.planById(s.id) })).filter(r => alive(r, city));
      return cityPlaces(city).filter(r => isNew(r.x, day) && (mode === 'guys' || K.catOf(r.x) !== 'pc')).concat(plans)
        .map((r, i) => [r, i]).sort((a, b) => (a[0].x.added < b[0].x.added ? 1 : a[0].x.added > b[0].x.added ? -1 : a[1] - b[1])).slice(0, AUTO_MAX).map(x => x[0]);
    }
    if (id === 'a-late') return mix(cityPlaces(city).filter(r => K.placeHints(r.x).includes('night')), LATE_CATS[mode], AUTO_MAX);
    if (id === 'a-rain') return mix(cityPlaces(city).filter(r => K.placeHints(r.x).includes('rain')), RAIN_CATS[mode], AUTO_MAX);
    if (id === 'a-buzz') {
      const wk = [isoWeek(day), isoWeek(K.numDay(K.dayNum(day) - 7))];
      return cityPlaces(city).filter(r => wk.includes(r.x.buzz)).slice(0, AUTO_MAX);
    }
    return [];
  }
  /* Авто-подборка на полке: «Бесплатно» — с четверга по воскресенье, «Если дождь» — когда мокро */
  function autoShown(id, o, day) {
    if (id === 'a-free') return [4, 5, 6, 0].includes(wdOf(day));
    if (id === 'a-rain') return !!o.wet;
    return true;
  }

  /* ---------- что показывать ---------- */
  /* Пункты подборки (или списка { items, city }) для города и повода: [{ id, kind, x }] — только живые */
  const ITEMS = new Map();
  function items(col, o) {
    o = o || {};
    if (!col) return [];
    const city = col.auto ? (isCity(o.city) ? o.city : K.city()) : isCity(col.city) ? col.city : cityOfCol(col) || (isCity(o.city) ? o.city : 'msk');
    const key = col.id && col.id !== 'list' ? [col.id, city, o.mode || '', today()].join('|') : '';
    if (key && ITEMS.has(key)) return ITEMS.get(key);
    const out = col.auto ? autoItems(col.id, { city, mode: o.mode }) : liveOf(col.items, city);
    if (key) ITEMS.set(key, out);
    return out;
  }
  /* Подборка по id (своя или авто) или null */
  const find = id => (typeof id !== 'string' ? null : list().find(c => c.id === id) || autoCol(id));
  /* Полка «Подборки»: [{ col, items }] для { city, mode, wet }. Порядок: подборки только для этого повода, сезонные,
     срочные авто-подборки (бесплатно на выходных, дождь), остальные свои и в конце — прочие авто-подборки */
  const SHELF = new Map();
  function shelf(o) {
    o = o || {};
    const city = isCity(o.city) ? o.city : K.city(), mode = MODES.includes(o.mode) ? o.mode : 'date', day = today();
    const key = [city, mode, o.wet ? 1 : 0, day].join('|');
    if (SHELF.has(key)) return SHELF.get(key);
    const rank = c => (c.mode.length === 1 ? 3 : c.season.length || c.from || c.until ? 2 : c.mode.length ? 1 : 0);
    const ed = list().map((col, i) => ({ col, i })).filter(x => cityOfCol(x.col) === city && fitsMode(x.col, mode) && inSeason(x.col, day))
      .map(x => Object.assign(x, { items: items(x.col, { city, mode }), r: rank(x.col) })).filter(x => x.items.length >= MIN)
      .sort((a, b) => b.r - a.r || a.i - b.i);
    const au = AUTO_IDS.filter(id => autoShown(id, o, day)).map(id => ({ col: autoCol(id), items: autoItems(id, { city, mode }) })).filter(x => x.items.length >= MIN);
    const hot = au.filter(x => ['a-free', 'a-rain'].includes(x.col.id));
    const out = ed.filter(x => x.r >= 2).concat(hot, ed.filter(x => x.r < 2), au.filter(x => !hot.includes(x)))
      .map(x => ({ col: x.col, items: x.items }));
    SHELF.set(key, out);
    return out;
  }
  /* Свои подборки города, где есть это место (само или остановкой плана), — для «Входит в подборки» в карточке места */
  function ofPlace(id, o) {
    o = o || {};
    const city = isCity(o.city) ? o.city : K.city(), mode = MODES.includes(o.mode) ? o.mode : 'date', day = today();
    return list().filter(c => cityOfCol(c) === city && fitsMode(c, mode) && inSeason(c, day)).filter(c => {
      const its = items(c, { city, mode });
      return its.length >= MIN && its.some(r => (r.kind === 'place' && r.id === id) || (r.kind === 'plan' && r.x.stops.includes(id)));
    });
  }

  /* «13 мест · до 3 000 ₽»: сколько и почём (цена мест 1–3 — на человека, как в places.js) */
  const NOUN = { place: ['место', 'места', 'мест'], plan: ['план', 'плана', 'планов'], event: ['событие', 'события', 'событий'], mix: ['идея', 'идеи', 'идей'] };
  const plural = (n, f) => { const a = n % 100, b = n % 10; return a > 10 && a < 20 ? f[2] : b === 1 ? f[0] : b >= 2 && b <= 4 ? f[1] : f[2]; };
  function summary(rows) {
    rows = arr(rows);
    const kinds = new Set(rows.map(r => r.kind)), n = rows.length;
    const noun = NOUN[kinds.size === 1 ? Array.from(kinds)[0] : 'mix'] || NOUN.mix;
    const pr = [];
    rows.forEach(r => {
      if (r.kind === 'place') pr.push(r.x.price || 1);
      else if (r.kind === 'plan') pr.push(Math.max(...K.planStops(r.x).map(p => p.price || 1)));
    });
    const evs = rows.filter(r => r.kind === 'event');
    let money = '';
    if (pr.length) {
      const hi = Math.max(...pr), lo = Math.min(...pr);
      money = hi <= 1 ? `до 1${NB}500${NB}₽` : hi === 2 ? `до 3${NB}000${NB}₽` : lo >= 3 ? `от 3${NB}000${NB}₽` : 'на любой бюджет';
    } else if (evs.length && evs.every(r => Array.isArray(r.x.price) && +r.x.price[0] === 0 && (r.x.price[1] == null || +r.x.price[1] === 0))) money = 'бесплатно';
    return [n + NB + plural(n, noun), money].filter(Boolean).join(' · ');
  }

  /* ---------- свой список в ссылке: id через запятую → base64url ---------- */
  function encodeList(ids) {
    const s = Array.from(new Set(arr(ids).filter(id => typeof id === 'string' && RX_ID.test(id)))).slice(0, LIST_MAX).join(',');
    return s ? K.toB64url(new TextEncoder().encode(s)) : '';
  }
  function decodeList(v) {
    if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{2,4000}$/.test(v)) return [];
    try {
      let b = v.replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      const bin = atob(b), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return Array.from(new Set(new TextDecoder().decode(bytes).split(',').filter(id => RX_ID.test(id)))).slice(0, LIST_MAX);
    } catch (e) { return []; }
  }
  /* Город списка — по первому пункту, который нашёлся и не закрыт; ничего — '' */
  function listCity(ids) {
    for (const id of arr(ids)) {
      const r = resolve(id);
      if (r && r.x) { const c = K.cityOf(r.kind === 'place' ? r.id : r.x); if (isCity(c)) return c; }
    }
    return '';
  }
  /* Название списка из ссылки: одна строка, до 40 знаков */
  const cleanTitle = t => Array.from(String(t || '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 40).join('').trim();
  /* Город карточки из адреса (start.html?col=… / ?list=…) — чтобы страница сразу открылась в нужном городе; '' — не знаем */
  function linkCity(param, v) {
    if (param === 'col') { const c = find(v); return c ? cityOfCol(c) : ''; }
    if (param === 'list') return listCity(decodeList(v));
    return '';
  }

  window.KudaCols = { MIN, LIST_MAX, AUTO_MAX, list, find, items, shelf, ofPlace, summary, inSeason, fitsMode, cityOf: cityOfCol, resolve,
    encodeList, decodeList, listCity, cleanTitle, linkCity, weekend, isoWeek };
})();

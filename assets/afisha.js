/* Афиша «Куда идём?»: события Москвы на ближайшие дни.
   ─ shelf()  — лента «Ближайшие события» над готовыми планами;
   ─ mount()  — вкладка «Афиша»: даты, жанры, «Бесплатно», повод, список по дням;
   ─ open()   — карточка события: когда, где, цена, билеты, календарь, «Позвать», план вокруг;
   ─ handleDeepLink() — ссылка start.html?event=<id>;
   ─ count()  — числа для страницы: заголовок «Афиша N событий» = список вкладки с её фильтрами (подробно — у функции).
   Данные — window.KUDA_EVENTS (assets/events.js и auto.js). Даты и время — московские (Europe/Moscow),
   прошедшие события не показываем. Афиш-картинок нет: эмодзи на цветной подложке, а у площадки
   из каталога — её фото с Wikimedia Commons с автором и лицензией. */
(function () {
  'use strict';

  const K = window.DateKit || {};
  const esc = K.esc || (s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const OWN_IC = {
    ticket: '<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/><path d="M14 7.5v9" stroke-dasharray="1.6 2.2"/>',
  };
  const I = name => OWN_IC[name]
    ? `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${OWN_IC[name]}</svg>`
    : (K.icon ? K.icon(name) : '');

  /* ---------- справочники ---------- */
  const MODES = ['date', 'guys', 'girls'];
  const FIT_LABEL = { date: 'для свидания', guys: 'для пацанов', girls: 'для подружек' };
  /* жанр: [чип, в карточке, эмодзи по умолчанию] */
  const CATS = {
    concert: ['Концерты', 'Концерт', '🎤'], theatre: ['Театр', 'Спектакль', '🎭'], exhibition: ['Выставки', 'Выставка', '🖼️'],
    standup: ['Стендап', 'Стендап', '🎙️'], festival: ['Фестивали', 'Фестиваль', '🎪'], sport: ['Спорт', 'Спорт', '🏟️'],
    show: ['Шоу', 'Шоу', '✨'], party: ['Вечеринки', 'Вечеринка', '🪩'], lecture: ['Лекции', 'Лекция', '📚'], kids: ['Детям', 'Детям', '🧸'],
  };
  const CAT_ORDER = Object.keys(CATS);
  const WHEN = [['today', 'Сегодня'], ['tomorrow', 'Завтра'], ['weekend', 'Выходные'], ['week', 'Неделя'], ['month', 'Месяц'], ['all', 'Все']];
  const WHEN_IDS = WHEN.map(w => w[0]);
  const WHEN_EMPTY = { today: 'Сегодня', tomorrow: 'Завтра', weekend: 'На выходных', week: 'В ближайшие 7 дней', month: 'В ближайший месяц', all: 'В афише' };
  /* сколько длится событие для календаря, минуты */
  const MINUTES = { concert: 150, theatre: 180, exhibition: 120, standup: 120, festival: 240, sport: 150, show: 150, party: 300, lecture: 90, kids: 120 };
  const LONG_DAYS = 7;      // без списка дат и дольше недели — «долгое» событие (выставка): «до 12 января»
  const GRACE_MIN = 60;     // через час после начала сегодняшний показ уже не предлагаем
  const PAGE = 30;          // событий в списке до «Показать ещё»
  const NEAR_M = 900;       // «план вокруг события» — места в радиусе
  const NEAR_CATS = ['food', 'bar', 'coffee', 'walk'];
  const NEAR_Q = { date: 'кафе', guys: 'бар', girls: 'кафе' };

  const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
  const evWord = n => n + ' ' + plural(n, 'событие', 'события', 'событий');
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  /* ---------- даты: строки 'YYYY-MM-DD', считаем в днях UTC — без сдвигов часовых поясов ---------- */
  const pad = n => String(n).padStart(2, '0');
  const RX_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
  const dn = s => { const m = RX_DAY.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : NaN; };
  const nd = n => { const d = new Date(n * 864e5); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
  const validDay = s => typeof s === 'string' && RX_DAY.test(s) && nd(dn(s)) === s;
  const addD = (s, n) => nd(dn(s) + n);
  const wday = s => new Date(dn(s) * 864e5).getUTCDay();
  const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : 0; };
  const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const WD_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MON_S = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  /* год пишем, только если дата дальше ~10 месяцев: «до 12 января» понятно и так */
  const yr = (d, today) => (Math.abs(dn(d) - dn(today)) > 300 ? ' ' + d.slice(0, 4) : '');
  const dd = d => +d.slice(8, 10), mm = d => +d.slice(5, 7) - 1;
  const dShort = (d, today) => `${WD[wday(d)]}, ${dd(d)} ${MON_S[mm(d)]}${yr(d, today)}`;      // «Сб, 18 окт»
  const dMonth = (d, today) => `${dd(d)} ${MON[mm(d)]}${yr(d, today)}`;                       // «12 января»
  const dLong = (d, today) => `${WD_FULL[wday(d)]}, ${dMonth(d, today)}`;                     // «Суббота, 18 октября»
  function dayLabel(d, today) {
    if (d === today) return 'Сегодня';
    if (d === addD(today, 1)) return 'Завтра';
    return dShort(d, today);
  }

  /* Сейчас в Москве: { today: 'YYYY-MM-DD', nowMin: минуты от полуночи } */
  let clock = () => new Date();
  let FMT = null;
  function mskNow(date) {
    const d = date || clock();
    try {
      FMT = FMT || new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      const o = {};
      FMT.formatToParts(d).forEach(p => { o[p.type] = p.value; });
      if (!o.year || !o.month || !o.day) throw new Error('tz');
      return { today: `${o.year}-${o.month}-${o.day}`, nowMin: (+o.hour % 24) * 60 + (+o.minute || 0) };
    } catch (e) {
      const m = new Date(d.getTime() + 3 * 3600e3);   // Москва — UTC+3 круглый год
      return { today: m.toISOString().slice(0, 10), nowMin: m.getUTCHours() * 60 + m.getUTCMinutes() };
    }
  }

  /* ---------- данные ---------- */
  /* число или строка с числом; '' и true не считаем ценой (isFinite('') === true) */
  const numOk = v => (typeof v === 'number' && isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && isFinite(v));
  function normalize(src) {
    const out = [], seen = new Set();
    (Array.isArray(src) ? src : []).forEach(raw => {
      if (!raw || typeof raw !== 'object') return;
      const id = String(raw.id || '').trim(), title = String(raw.title || '').trim();
      if (!id || !title || seen.has(id) || !validDay(raw.start)) return;
      const start = raw.start;
      const end = validDay(raw.end) && raw.end >= start ? raw.end : start;
      const dates = Array.isArray(raw.dates) ? Array.from(new Set(raw.dates.filter(validDay))).sort() : [];
      const cat = CATS[raw.cat] ? raw.cat : '';
      const tm = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(raw.time || '').trim());
      /* площадка из каталога подставляет то, чего нет у события: координаты, адрес, метро */
      const pl = raw.place ? placesMap()[raw.place] || null : null;
      let lat = Number(raw.lat), lon = Number(raw.lon);
      let geo = isFinite(lat) && isFinite(lon) && Math.abs(lat) > 1 && Math.abs(lon) > 1;
      if (!geo && pl && isFinite(pl.lat) && isFinite(pl.lon)) { lat = +pl.lat; lon = +pl.lon; geo = true; }
      let price = null;
      if (Array.isArray(raw.price) && numOk(raw.price[0]) && +raw.price[0] >= 0) {
        const from = Math.round(+raw.price[0]);
        const to = numOk(raw.price[1]) && +raw.price[1] >= from ? Math.round(+raw.price[1]) : null;
        price = [from, to];
      }
      const age = /^\d{1,2}\+$/.test(String(raw.age || '').trim()) ? String(raw.age).trim() : '';
      seen.add(id);
      out.push({
        id, title, cat, emoji: String(raw.emoji || (CATS[cat] ? CATS[cat][2] : '📅')),
        start, end, dates, time: tm ? pad(+tm[1]) + ':' + tm[2] : '',
        venue: String(raw.venue || (pl && pl.name) || '').trim(), place: raw.place ? String(raw.place) : '',
        addr: String(raw.addr || (pl && pl.addr) || '').trim(), metro: String(raw.metro || (pl && pl.metro) || '').trim(),
        lat: geo ? lat : null, lon: geo ? lon : null, price, age,
        url: /^https:\/\/[^\s"'<>]+$/i.test(String(raw.url || '').trim()) ? String(raw.url).trim() : '',
        note: String(raw.note || '').trim(),
        fit: Array.isArray(raw.fit) ? raw.fit.filter(m => MODES.includes(m)) : [],
        long: !dates.length && dn(end) - dn(start) >= LONG_DAYS - 1,
      });
    });
    return out;
  }
  /* auto.js дописывает события в тот же массив — пересчитываем, если он сменился или вырос */
  let SRC = null, SRC_N = -1, LIST = [], BY_ID = new Map();
  function events() {
    const src = Array.isArray(window.KUDA_EVENTS) ? window.KUDA_EVENTS : [];
    if (src !== SRC || src.length !== SRC_N) {
      SRC = src; SRC_N = src.length;
      LIST = normalize(src);
      BY_ID = new Map(LIST.map(e => [e.id, e]));
    }
    return LIST;
  }
  const findEvent = id => (events(), BY_ID.get(String(id || '')) || null);

  /* ---------- когда идёт событие ---------- */
  const over = (ev, d, ctx) => d === ctx.today && !!ev.time && ctx.nowMin >= toMin(ev.time) + GRACE_MIN;
  /* Ближайший день события в окне [from; to] (to = '' — без конца), не раньше сегодняшнего; '' — нет */
  function nextDay(ev, ctx, from, to) {
    const lo = from && from > ctx.today ? from : ctx.today;
    if (ev.dates.length) {
      for (const d of ev.dates) {
        if (d < lo) continue;
        if (to && d > to) break;
        if (!over(ev, d, ctx)) return d;
      }
      return '';
    }
    let d = ev.start > lo ? ev.start : lo;
    if (over(ev, d, ctx)) d = addD(d, 1);
    return d > ev.end || (to && d > to) ? '' : d;
  }
  /* Будущие дни показа (для выбора даты); у долгих событий — пусто: там день выбирают в календаре */
  function upcomingDays(ev, ctx) {
    if (ev.long) return [];
    if (ev.dates.length) return ev.dates.filter(d => d >= ctx.today && !over(ev, d, ctx));
    const out = [];
    for (let d = nextDay(ev, ctx); d && d <= ev.end && out.length < 31; d = addD(d, 1)) out.push(d);
    return out;
  }
  const isUpcoming = (ev, ctx) => !!nextDay(ev, ctx || mskNow());
  const fits = (ev, mode) => !ev.fit.length || ev.fit.includes(mode);
  const isFree = ev => !!ev.price && ev.price[0] === 0;
  const isAdult = ev => parseInt(ev.age, 10) >= 18;
  /* На свидании 18+ ставим после остальных событий того же дня (не прячем) */
  const adultRank = mode => (mode === 'date' ? it => (isAdult(it.ev) ? 1 : 0) : () => 0);
  const closingSoon = (ev, ctx) => ev.long && ev.start <= ctx.today && dn(ev.end) - dn(ctx.today) <= 7;

  /* Окно дат для чипа: выходные — ближайшие суббота и воскресенье (в воскресенье — только оно) */
  function windowOf(when, today) {
    switch (when) {
      case 'today': return { from: today, to: today };
      case 'tomorrow': { const t = addD(today, 1); return { from: t, to: t }; }
      case 'weekend': {
        const w = wday(today);
        if (w === 0) return { from: today, to: today };
        const sat = addD(today, 6 - w);
        return { from: sat, to: addD(sat, 1) };
      }
      case 'week': return { from: today, to: addD(today, 6) };
      case 'month': return { from: today, to: addD(today, 30) };
      default: return { from: today, to: '' };
    }
  }

  /* Фильтр: { when | from+to, cat, free, mode, fit (по умолчанию — да, если задан mode), ctx }
     → [{ ev, day: ближайший показ в окне, long }] по ближайшему показу, затем по времени
     (на свидании 18+ — после остальных событий того же дня) */
  function filterEvents(list, o) {
    o = o || {};
    const ctx = o.ctx || mskNow();
    const w = o.from ? { from: o.from, to: o.to || '' } : windowOf(o.when, ctx.today);
    const mode = MODES.includes(o.mode) ? o.mode : '';
    const a18 = adultRank(mode);
    const out = [];
    (list || []).forEach(ev => {
      if (o.cat && ev.cat !== o.cat) return;
      if (o.free && !isFree(ev)) return;
      if (mode && o.fit !== false && !fits(ev, mode)) return;
      const day = nextDay(ev, ctx, w.from, w.to);
      if (day) out.push({ ev, day, long: ev.long });
    });
    return out.sort((a, b) => cmp(a.day, b.day) || (a18(a) - a18(b)) || cmp(a.ev.time, b.ev.time) || cmp(a.ev.end, b.ev.end) || a.ev.title.localeCompare(b.ev.title, 'ru'));
  }

  /* Группы по дням; долгие события (выставки) — отдельной группой в конце, первыми — те, что скоро закроются.
     o.mode — повод: на свидании и среди выставок 18+ идут после остальных (внутри дня порядок уже задал filterEvents) */
  function groupByDay(items, today, o) {
    const a18 = adultRank(o && o.mode);
    const groups = [], byDay = new Map(), long = [];
    (items || []).forEach(it => {
      if (it.long) { long.push(it); return; }
      let g = byDay.get(it.day);
      if (!g) {
        const rel = it.day === today || it.day === addD(today, 1);
        g = { key: it.day, title: dayLabel(it.day, today), sub: rel ? dShort(it.day, today).toLowerCase() : '', items: [] };
        byDay.set(it.day, g);
        groups.push(g);
      }
      g.items.push(it);
    });
    if (long.length) {
      long.sort((a, b) => cmp(a.day, b.day) || (a18(a) - a18(b)) || cmp(a.ev.end, b.ev.end) || a.ev.title.localeCompare(b.ev.title, 'ru'));
      groups.push({ key: 'long', title: 'Выставки и долгие события', sub: 'в любой день до закрытия', items: long });
    }
    return groups;
  }

  /* «Сегодня, 19:00 · ещё 2 даты», «Сб, 18 окт, 20:00», «до 12 января», «с 1 ноября до 12 января».
     o.day — какой показ подписать, o.row — без дня (он в заголовке группы), o.noMore — без «ещё N дат» */
  function formatWhen(ev, ctx, o) {
    o = o || {};
    ctx = ctx || mskNow();
    const t = ctx.today;
    if (ev.long) {
      if (ev.end < t) return '';
      if (ev.end === t) return 'последний день — сегодня';
      return ev.start > t ? `с ${dMonth(ev.start, t)} до ${dMonth(ev.end, t)}` : `до ${dMonth(ev.end, t)}`;
    }
    const d = o.day || nextDay(ev, ctx);
    if (!d) return '';
    const parts = [];
    if (!o.row) parts.push(dayLabel(d, t) + (ev.time ? ', ' + ev.time : ''));
    else if (ev.time) parts.push(ev.time);
    if (!o.noMore) {
      const more = upcomingDays(ev, ctx).filter(x => x > d).length;
      if (more) parts.push(`ещё ${more} ${plural(more, 'дата', 'даты', 'дат')}`);
    }
    return parts.join(' · ');
  }

  /* Цена: «Бесплатно», «от 1 500 ₽»; full — «от 1 500 до 4 000 ₽».
     [x, x] в events.js значит «известна только нижняя цена» — поэтому тоже «от x», а не точная сумма */
  const num = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  function priceText(ev, full) {
    const p = ev && ev.price;
    if (!p) return '';
    const [from, to] = p;
    if (from === 0) return to && full ? `Бесплатно, есть билеты до ${num(to)}\u00A0₽` : 'Бесплатно';
    return full && to && to > from ? `от ${num(from)} до ${num(to)}\u00A0₽` : `от ${num(from)}\u00A0₽`;
  }

  /* ---------- места рядом ---------- */
  function distM(a, b) {
    if (K.distM) return K.distM(a, b);
    const R = 6371000, r = x => x * Math.PI / 180;
    const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const walkOf = m => Math.max(1, Math.round(m * 1.3 / 75));   // как K.walkMin: петляем по улицам
  const catOf = p => (K.catOf ? K.catOf(p) : (p.cat || 'food'));
  /* До limit мест каталога в радиусе (еда, бары, кофе, прогулки), без закрытых, 18+ и самой площадки.
     Порядок — по score(id) (рейтинг отзывов), при равенстве — ближе; не больше двух мест одного раздела */
  function nearbyPlaces(ev, places, o) {
    o = o || {};
    if (!ev || ev.lat == null || ev.lon == null) return [];
    const radius = o.radius || NEAR_M, limit = o.limit || 4, score = typeof o.score === 'function' ? o.score : null;
    const cand = [];
    Object.keys(places || {}).forEach(id => {
      const p = places[id];
      if (!p || p.closed || p.adult || id === ev.place || !isFinite(p.lat) || !isFinite(p.lon)) return;
      const c = catOf(p);
      if (!NEAR_CATS.includes(c)) return;
      const dist = distM(ev, p);
      if (dist > radius) return;
      let s = 0;
      if (score) { try { s = Number(score(id)) || 0; } catch (e) { s = 0; } }
      cand.push({ id, p, c, dist, walk: walkOf(dist), s });
    });
    const order = (a, b) => (b.s - a.s) || (a.dist - b.dist) || cmp(a.id, b.id);
    cand.sort(order);
    const out = [], per = {};
    cand.forEach(x => { if (out.length < limit && (per[x.c] || 0) < 2) { per[x.c] = (per[x.c] || 0) + 1; out.push(x); } });
    cand.forEach(x => { if (out.length < limit && !out.includes(x)) out.push(x); });
    return out.sort(order);
  }
  const placesMap = () => ((K.kuda ? K.kuda() : window.KUDA) || {}).places || {};
  function placeOf(ev) {
    if (!ev.place) return null;
    const p = K.placeById ? K.placeById(ev.place) : placesMap()[ev.place];
    return p && !p.closed ? p : null;
  }
  const photoOf = ev => { const p = placeOf(ev); return p && K.photo ? K.photo(p) : null; };
  const reviewScore = () => { const R = window.KudaReviews; return R && typeof R.score === 'function' ? id => R.score(id) : null; };

  /* ---------- ссылки ---------- */
  function shareUrl(id, mode) {
    let base = 'start.html';
    try { base = K.sitePath ? K.sitePath('start.html') : new URL('start.html', location.href).href.split(/[?#]/)[0]; } catch (e) { /* относительная */ }
    return base + '?event=' + encodeURIComponent(id) + (MODES.includes(mode) ? '&m=' + mode : '');
  }
  /* Где продают билеты — по адресу ссылки: [ключ для аналитики, домен (с поддоменами) или проверка, «Билеты — …», «проверь их …»] */
  const SELLERS = [
    ['yandex', 'afisha.yandex.ru', 'Яндекс Афиша', 'на Яндекс Афише'],
    ['kassir', 'kassir.ru', 'Кассир', 'на Кассир.ру'],
    ['ticketland', 'ticketland.ru', 'Ticketland', 'на Ticketland'],
    ['mtslive', 'mts-live.ru', 'МТС Live', 'на МТС Live'],
    ['concert', 'concert.ru', 'Concert.ru', 'на Concert.ru'],
    ['radario', h => h.split('.').includes('radario'), 'Радарио', 'на Радарио'],
    ['timepad', h => h.split('.').includes('timepad'), 'Timepad', 'на Timepad'],
    ['kinoafisha', 'kinoafisha.info', 'Киноафиша', 'на Киноафише'],
  ];
  const ORGANIZER = { key: 'site', name: 'сайт организатора', on: 'на сайте организатора' };
  function ticketSource(url) {
    let h = '', path = '';
    try { const u = new URL(url); h = u.hostname.toLowerCase().replace(/^www\.|\.$/g, ''); path = u.pathname; } catch (e) { return ORGANIZER; }
    /* старые ссылки Яндекса: yandex.ru/afisha/… */
    if (/^yandex\.(ru|com)$/.test(h) && /^\/afisha(\/|$)/.test(path)) h = 'afisha.yandex.ru';
    const s = SELLERS.find(([, m]) => (typeof m === 'function' ? m(h) : h === m || h.endsWith('.' + m)));
    return s ? { key: s[0], name: s[2], on: s[3] } : ORGANIZER;
  }
  const inviteUrl = (id, mode) => 'create.html?event=' + encodeURIComponent(id) + '&mode=' + (MODES.includes(mode) ? mode : 'date');
  const ll = p => p.lat.toFixed(6) + ',' + p.lon.toFixed(6);
  /* До площадки — общественным транспортом, откуда ехать, человек укажет сам; к месту рядом — пешком */
  const routeTo = ev => (ev.lat != null
    ? 'https://yandex.ru/maps/213/moscow/?rtext=~' + ll(ev) + '&rtt=mt'
    : 'https://yandex.ru/maps/213/moscow/?text=' + encodeURIComponent([ev.venue, ev.addr].filter(Boolean).join(', ')));
  const walkRoute = (a, b) => 'https://yandex.ru/maps/213/moscow/?rtext=' + ll(a) + '~' + ll(b) + '&rtt=pd';
  const venueMap = ev => 'https://yandex.ru/maps/213/moscow/?text=' + encodeURIComponent([ev.venue, ev.addr].filter(Boolean).join(', '));
  /* «м. Чистые пруды» — без переноса после «м.» */
  const metroText = m => (K.metroText ? K.metroText(m) : m ? 'м. ' + m : '').replace(/^(м\.|ж\/д) /, '$1\u00A0');

  function track(type, data) {
    try { if (window.KudaTrack) window.KudaTrack.ev(type, Object.assign({ kind: 'event' }, data)); } catch (e) { /* аналитика не мешает афише */ }
  }

  /* ---------- разметка ---------- */
  const catName = ev => (CATS[ev.cat] ? CATS[ev.cat][1] : 'Событие');
  const ageTag = ev => (ev.age ? `<span class="af-tag af-age${ev.age === '18+' ? ' af-a18' : ''}">${esc(ev.age)}</span>` : '');
  function cover(ev, cls) {
    const ph = photoOf(ev);
    return ph && ph.t
      ? `<span class="${cls} af-phc" aria-hidden="true"><img src="${esc(ph.t)}" width="240" height="240" alt="" loading="lazy" decoding="async"></span>`
      : `<span class="${cls} afc-${ev.cat || 'other'}" aria-hidden="true">${esc(ev.emoji)}</span>`;
  }
  function tagsHtml(ev, ctx) {
    const pr = priceText(ev);
    return (pr ? `<span class="af-tag${isFree(ev) ? ' af-free' : ''}">${esc(pr)}</span>` : '') + ageTag(ev) +
      (closingSoon(ev, ctx) ? '<span class="af-tag af-soon">скоро закроется</span>' : '');
  }
  /* Строка списка; o.withDay — с днём (вне группы по дням) */
  function itemHtml(it, ctx, o) {
    const ev = it.ev;
    const when = formatWhen(ev, ctx, { day: it.day, row: !(o && o.withDay) });
    const sub = [when, ev.venue, metroText(ev.metro)].filter(Boolean).join(' · ');
    return `<li><button type="button" class="af-item" data-af-ev="${esc(ev.id)}">${cover(ev, 'af-cov')}` +
      `<span class="af-main"><span class="af-vh">${esc(catName(ev))}. </span><span class="af-name">${esc(ev.title)}</span>` +
      `<span class="af-sub">${esc(sub)}</span><span class="af-tags">${tagsHtml(ev, ctx)}</span></span></button></li>`;
  }
  function cardHtml(it, ctx) {
    const ev = it.ev, pr = priceText(ev);
    return `<li class="af-cell"><button type="button" class="af-card" data-af-ev="${esc(ev.id)}">${cover(ev, 'af-ccov')}` +
      `<span class="af-cwhen">${esc(formatWhen(ev, ctx, { day: it.day, noMore: true }))}</span>` +
      `<span class="af-vh">${esc(catName(ev))}. </span><span class="af-ct">${esc(ev.title)}</span>` +
      `<span class="af-cv">${esc(ev.venue)}</span>` +
      `<span class="af-tags">${pr ? `<span class="af-tag${isFree(ev) ? ' af-free' : ''}">${esc(pr)}</span>` : ''}${ageTag(ev)}</span></button></li>`;
  }

  /* ---------- лента «Ближайшие события» ---------- */
  /* Сначала события с датой на 2 недели вперёд, плюс до двух выставок (первыми — что скоро закроются);
     если места остаются — добираем выставками и событиями позже.
     В каждой части предпочитаем события, отмеченные для этого повода, — события без отметки повода
     идут только на свободные места. Внутри дня: на свидании 18+ — после остальных, затем отмеченные для повода */
  function shelfItems(all, mode, limit, ctx) {
    const items = filterEvents(all, { ctx, mode, when: 'all' });
    const own = it => (it.ev.fit.includes(mode) ? 0 : 1), a18 = adultRank(mode);
    const sameDay = (a, b) => cmp(a.day, b.day) || (a18(a) - a18(b)) || (own(a) - own(b));
    const soon = addD(ctx.today, 13);
    const dated = items.filter(it => !it.long && it.day <= soon);
    const later = items.filter(it => !it.long && it.day > soon);
    const long = items.filter(it => it.long).sort((a, b) => sameDay(a, b) || cmp(a.ev.end, b.ev.end));
    /* n штук из list: сначала отмеченные для повода; порядок — как в list (сортировка стабильная) */
    const pick = (list, n) => {
      const mine = list.filter(it => !own(it)), chosen = new Set(mine.slice(0, n));
      list.forEach(it => { if (chosen.size < n) chosen.add(it); });
      return list.filter(it => chosen.has(it)).sort(sameDay);
    };
    let nLong = Math.min(2, long.length, limit);
    const nDated = Math.min(dated.length, limit - nLong);
    nLong = Math.min(long.length, limit - nDated);
    const nLater = Math.min(later.length, limit - nDated - nLong);
    return pick(dated, nDated).concat(pick(long, nLong), pick(later, nLater));
  }
  const SHELVES = new WeakMap();
  function shelf(container, opts) {
    if (!container) return 0;
    opts = opts || {};
    const mode = MODES.includes(opts.mode) ? opts.mode : 'date';
    const limit = Math.max(1, Math.min(20, +opts.limit || 8));
    const ctx = mskNow();
    const items = shelfItems(events(), mode, limit, ctx);
    let s = SHELVES.get(container);
    if (!s) {
      s = {};
      SHELVES.set(container, s);
      container.classList.add('af-host');
      container.addEventListener('click', e => {
        const b = e.target.closest('[data-af-ev]');
        if (b) { open(b.dataset.afEv, s.opts); return; }
        if (e.target.closest('[data-af-all]') && typeof s.opts.onAll === 'function') s.opts.onAll();
      });
      live(() => (container.isConnected ? (shelf(container, s.opts), true) : false));
    }
    s.opts = Object.assign({}, opts, { mode });
    /* прячем и атрибутом hidden, и классом .hidden — его используют страницы сайта */
    const show = on => { container.hidden = !on; container.classList.toggle('hidden', !on); };
    if (!items.length) { container.innerHTML = ''; show(false); return 0; }
    show(true);
    const all = typeof opts.onAll === 'function' ? `<button type="button" class="af-mini" data-af-all>Вся афиша${I('arrow')}</button>` : '';
    container.innerHTML = `<div class="af af-shelf"><div class="af-shelf-head"><h3 class="af-shelf-h">Ближайшие события</h3>${all}</div>` +
      `<ul class="af-rail">${items.map(it => cardHtml(it, ctx)).join('')}</ul></div>`;
    return items.length;
  }

  /* ---------- вкладка «Афиша» ---------- */
  const MOUNTS = new WeakMap();
  let UID = 0;
  let TAB = null;   // последняя нарисованная вкладка: её фильтры показывает count({ mode })
  /* День по умолчанию: неделя; если на неделе пусто — месяц, иначе все даты */
  const defaultWhen = (all, ctx, mode) => ['week', 'month'].find(w => filterEvents(all, { ctx, mode, when: w }).length) || 'all';
  /* Фильтры вкладки для повода; пока вкладку не рисовали — вид по умолчанию */
  function viewState(mode, all, ctx) {
    const m = TAB && TAB.el.isConnected ? TAB : null;
    if (!m) return { when: defaultWhen(all, ctx, mode), cat: '', free: false, fit: true };
    const st = m.st;
    /* вкладка ещё не перерисована под новый повод, а день подобран автоматически — считаем, как она его подберёт */
    const when = m.auto && m.mode !== mode ? defaultWhen(all, ctx, mode) : st.when || defaultWhen(all, ctx, mode);
    return { when, cat: st.cat, free: st.free, fit: st.fit };
  }
  /* Сообщаем странице, что число событий во вкладке изменилось (главная обновит «Афиша N событий») */
  function notify(reason) {
    try { document.dispatchEvent(new CustomEvent('kuda-afisha', { detail: { reason } })); } catch (e) { /* старый браузер */ }
  }
  function mount(container, opts) {
    if (!container) return null;
    opts = opts || {};
    let m = MOUNTS.get(container);
    const first = !m;
    if (first) {
      m = { el: container, uid: 'afm' + (++UID), st: { when: '', cat: '', free: false, fit: true, limit: PAGE } };
      MOUNTS.set(container, m);
      container.classList.add('af-host');
      container.addEventListener('click', e => onMountClick(m, e));
      live(() => (container.isConnected ? (renderMount(m), true) : false));
    }
    const mode = MODES.includes(opts.mode) ? opts.mode : 'date';
    const modeChanged = !first && mode !== m.mode;
    if (modeChanged) m.st.limit = PAGE;
    m.mode = mode;
    m.opts = Object.assign({}, opts, { mode });
    /* стартовые фильтры (например, из ссылки) — только при первом показе */
    if (first) {
      if (WHEN_IDS.includes(opts.when)) m.st.when = opts.when;
      if (CATS[opts.cat]) m.st.cat = opts.cat;
      if (opts.free) m.st.free = true;
    }
    /* день выбрали не сами — подбираем заново и при смене повода */
    if (!m.st.when || (m.auto && modeChanged)) { m.st.when = defaultWhen(events(), mskNow(), mode); m.auto = true; }
    renderMount(m);
    return {
      refresh: () => renderMount(m),
      count: () => count({ mode: m.mode }),
      get state() { return Object.assign({}, m.st); },
    };
  }
  const chip = (k, label, n, on, cls) => `<button type="button" class="af-chip${cls ? ' ' + cls : ''}" data-af-k="${k}" aria-pressed="${on}">${label}<span class="af-n"><span class="af-vh">, </span>${n}</span></button>`;
  function setRow(root, name, html) {
    const row = root.querySelector(`[data-af-row="${name}"]`);
    if (!row || row._h === html) return;
    const a = document.activeElement, had = a && row.contains(a) ? a.getAttribute('data-af-k') : null;
    row.innerHTML = html;
    row._h = html;
    if (had) { const b = row.querySelector(`[data-af-k="${had}"]`); if (b) b.focus({ preventScroll: true }); }
  }
  /* Выбранный чип виден целиком: ряд прокручивается к нему */
  function revealOn(row) {
    const on = row && row.querySelector('[aria-pressed="true"]');
    if (!on || !row.getBoundingClientRect) return;
    const fr = row.getBoundingClientRect(), r = on.getBoundingClientRect();
    if (r.right > fr.right - 20) row.scrollLeft += r.right - fr.right + 20;
    else if (r.left < fr.left + 20) row.scrollLeft -= fr.left + 20 - r.left;
  }
  function renderMount(m) {
    const all = events(), ctx = mskNow(), st = m.st, mode = m.mode;
    let root = m.el.querySelector('.af-tab');
    if (!root) {
      m.el.innerHTML = `<div class="af af-tab">
        <div class="af-chips" role="group" aria-label="Когда" data-af-row="when"></div>
        <div class="af-chips" role="group" aria-label="Жанр и цена" data-af-row="cat"></div>
        <div class="af-seg" role="group" aria-label="Кому подходит" data-af-row="fit" hidden></div>
        <p class="af-status af-vh" role="status" aria-live="polite"></p>
        <div class="af-list"></div>
        <button type="button" class="af-more" data-af-more hidden></button>
      </div>`;
      root = m.el.querySelector('.af-tab');
    }
    TAB = m;
    const list = root.querySelector('.af-list'), more = root.querySelector('[data-af-more]');
    const status = root.querySelector('.af-status'), seg = root.querySelector('[data-af-row="fit"]');
    const any = all.some(ev => isUpcoming(ev, ctx));
    root.classList.toggle('af-none', !any);
    if (!any) {
      list.innerHTML = noDataHtml(m);
      more.hidden = true;
      status.textContent = '';
      return told(m, 0);
    }
    const base = { ctx, mode, fit: st.fit };
    setRow(root, 'when', WHEN.map(([id, label]) =>
      chip('when:' + id, label, filterEvents(all, Object.assign({}, base, { when: id, cat: st.cat, free: st.free })).length, st.when === id)).join(''));
    const inWin = filterEvents(all, Object.assign({}, base, { when: st.when, free: st.free }));
    const per = {};
    inWin.forEach(it => { per[it.ev.cat] = (per[it.ev.cat] || 0) + 1; });
    const freeN = filterEvents(all, Object.assign({}, base, { when: st.when, cat: st.cat, free: true })).length;
    setRow(root, 'cat', chip('free', 'Бесплатно', freeN, st.free, 'af-free') +
      CAT_ORDER.filter(c => per[c] || st.cat === c).map(c => chip('cat:' + c, CATS[c][0], per[c] || 0, st.cat === c)).join(''));

    /* «Для пацанов 21 · Все 42» — на выбранные даты, жанр и «Бесплатно»; выбранная половина = число в списке */
    const sel = { ctx, mode, when: st.when, cat: st.cat, free: st.free };
    const mineL = filterEvents(all, Object.assign({}, sel, { fit: true })), anyL = filterEvents(all, Object.assign({}, sel, { fit: false }));
    const items = st.fit ? mineL : anyL;
    const fitLabel = FIT_LABEL[mode][0].toUpperCase() + FIT_LABEL[mode].slice(1);
    seg.hidden = st.fit && anyL.length === mineL.length;
    setRow(root, 'fit', [[1, fitLabel, mineL.length], [0, 'Все', anyL.length]].map(([v, label, n]) =>
      `<button type="button" class="af-sg" data-af-k="fit:${v}" aria-pressed="${st.fit === !!v}">${label}<span class="af-n"><span class="af-vh">: </span>${n}</span></button>`).join(''));
    const say = evWord(items.length) + (st.fit ? ' ' + FIT_LABEL[mode] : ' для любой компании');
    if (status.textContent !== say) status.textContent = say;

    if (!items.length) {
      list.innerHTML = emptyHtml(m, all, ctx);
      more.hidden = true;
      return told(m, 0);
    }
    let left = st.limit, html = '';
    groupByDay(items, ctx.today, { mode }).forEach((g, i) => {
      if (left <= 0) return;
      const part = g.items.slice(0, left);
      left -= part.length;
      const hid = `${m.uid}-g${i}`;
      html += `<section class="af-day" aria-labelledby="${hid}"><h3 class="af-day-h" id="${hid}">${esc(g.title)}${g.sub ? ` <small>${esc(g.sub)}</small>` : ''}</h3>` +
        `<ul class="af-items">${part.map(it => itemHtml(it, ctx)).join('')}</ul></section>`;
    });
    list.innerHTML = html;
    const rest = items.length - Math.min(items.length, st.limit);
    more.hidden = rest <= 0;
    more.textContent = `Показать ещё ${Math.min(rest, PAGE)} из ${rest}`;
    return told(m, items.length);
  }
  /* Число в списке изменилось — говорим странице (один раз на изменение) */
  function told(m, n) {
    if (m.told !== n) { m.told = n; notify('count'); }
    return n;
  }
  /* Пусто по фильтрам: предлагаем ослабить ровно тот фильтр, без которого что-то найдётся */
  function emptyHtml(m, all, ctx) {
    const st = m.st, mode = m.mode;
    const base = { ctx, mode, fit: st.fit, when: st.when, cat: st.cat, free: st.free };
    const n = patch => filterEvents(all, Object.assign({}, base, patch));
    const tries = [], on = st.when === 'all' ? '' : ' на эти даты';
    if (st.cat) tries.push(['cat', { cat: '' }, x => `В жанре «${CATS[st.cat][0]}»${on} ничего нет, зато в других жанрах — ${evWord(x)}.`, 'Все жанры']);
    if (st.free) tries.push(['free', { free: false }, x => `Бесплатного${on} нет, зато есть ${evWord(x)} с билетами.`, 'Показать платные']);
    if (st.fit) tries.push(['fit', { fit: false }, x => `${FIT_LABEL[mode][0].toUpperCase() + FIT_LABEL[mode].slice(1)}${on} ничего не подобрали, но есть ${evWord(x)} для любой компании.`, 'Показать все']);
    if (st.when !== 'all') tries.push(['when', { when: 'all' }, (x, first) => `${WHEN_EMPTY[st.when]} ничего нет. Ближайшее — ${formatWhen(first.ev, ctx, { day: first.day, noMore: true }).replace(/^(Сегодня|Завтра)/, w => w.toLowerCase())}: «${first.ev.title}».`, 'Смотреть все даты']);
    const plans = typeof m.opts.onPlans === 'function' ? '<button type="button" class="af-btn af-ghost" data-af-plans>Готовые планы на вечер</button>' : '';
    /* до двух вариантов: объясняем первый, второй — запасной кнопкой (или готовые планы) */
    const ways = [];
    tries.forEach(([k, patch, text, btn]) => { const found = ways.length < 2 ? n(patch) : []; if (found.length) ways.push({ k, text: text(found.length, found[0]), btn }); });
    if (ways.length) {
      const [a, b] = ways;
      return emptyBox('🔎', 'Ничего не нашлось', a.text, `<button type="button" class="af-btn af-primary" data-af-relax="${a.k}">${a.btn}</button>` +
        (b ? `<button type="button" class="af-btn af-ghost" data-af-relax="${b.k}">${b.btn}</button>` : plans));
    }
    if (filterEvents(all, { ctx, mode, fit: false, when: 'all' }).length) {
      return emptyBox('🔎', 'Ничего не нашлось', 'По такому сочетанию фильтров событий нет.', `<button type="button" class="af-btn af-primary" data-af-relax="reset">Сбросить фильтры</button>${plans}`);
    }
    return noDataHtml(m);
  }
  function noDataHtml(m) {
    const plans = typeof m.opts.onPlans === 'function' ? '<button type="button" class="af-btn af-primary" data-af-plans>Смотреть готовые планы</button>' : '';
    return emptyBox('🗓️', 'Афиша обновляется', 'Новые события появятся совсем скоро. А пока выбери готовый план на вечер — там сотни проверенных мест по всей Москве.', plans);
  }
  const emptyBox = (e, title, text, actions) => `<div class="af-empty"><span class="af-empty-e" aria-hidden="true">${e}</span><b>${esc(title)}</b><p>${esc(text)}</p>${actions ? `<div class="af-empty-act">${actions}</div>` : ''}</div>`;

  function onMountClick(m, e) {
    const st = m.st, t = e.target;
    const it = t.closest('[data-af-ev]');
    if (it) { open(it.dataset.afEv, m.opts); return; }
    const c = t.closest('[data-af-k]');
    if (c) {
      const [kind, val] = c.dataset.afK.split(':');
      if (kind === 'when') { st.when = val; m.auto = false; }
      else if (kind === 'cat') st.cat = st.cat === val ? '' : val;
      else if (kind === 'free') st.free = !st.free;
      else if (kind === 'fit') { if (st.fit === (val === '1')) return; st.fit = val === '1'; }
      st.limit = PAGE;
      const row = c.closest('[data-af-row]');
      renderMount(m);
      revealOn(row);
      track('event_filter', { v: c.dataset.afK, mode: m.mode });
      return;
    }
    const rx = t.closest('[data-af-relax]');
    if (rx) {
      const k = rx.dataset.afRelax;
      if (k === 'cat' || k === 'reset') st.cat = '';
      if (k === 'free' || k === 'reset') st.free = false;
      if (k === 'fit' || k === 'reset') st.fit = false;
      if (k === 'when' || k === 'reset') { st.when = 'all'; m.auto = false; }
      st.limit = PAGE;
      renderMount(m);
      m.el.querySelectorAll('[data-af-row]').forEach(revealOn);
      const firstItem = m.el.querySelector('.af-item');
      if (firstItem) firstItem.focus({ preventScroll: true });
      return;
    }
    if (t.closest('[data-af-plans]') && typeof m.opts.onPlans === 'function') { m.opts.onPlans(); return; }
    if (t.closest('[data-af-more]')) {
      const before = m.el.querySelectorAll('.af-item').length;
      st.limit += PAGE;
      renderMount(m);
      const next = m.el.querySelectorAll('.af-item')[before];
      if (next) next.focus({ preventScroll: true });
    }
  }

  /* Сколько событий — для счётчиков страницы:
     count() / count({ mode: '' }) — все предстоящие события, любой повод (есть ли что показать вообще);
     count({ mode }) — сколько сейчас в списке вкладки «Афиша» для этого повода: выбранные даты, жанр,
       «Бесплатно» и «Для … / Все»; пока вкладку не рисовали — вид по умолчанию (неделя; если пусто — месяц или все даты).
       Это число для заголовка «Афиша N событий»: оно совпадает со списком и с выбранной половиной «Для … / Все»;
     count({ mode, when, cat?, free?, fit? }) — то же по явным фильтрам, без состояния вкладки:
       { mode, when: 'week' } — события этой недели под повод (число на вкладке). */
  function count(opts) {
    opts = opts || {};
    const mode = MODES.includes(opts.mode) ? opts.mode : '';
    const all = events(), ctx = mskNow();
    if (!mode) return filterEvents(all, { ctx, when: 'all' }).length;
    const st = WHEN_IDS.includes(opts.when) ? { when: opts.when, cat: CATS[opts.cat] ? opts.cat : '', free: !!opts.free, fit: opts.fit !== false } : viewState(mode, all, ctx);
    return filterEvents(all, { ctx, mode, when: st.when, cat: st.cat, free: st.free, fit: st.fit }).length;
  }
  /* Предстоящие события по порядку — для конструктора и других страниц: [{ ...событие, next: 'YYYY-MM-DD' }] */
  function upcoming(opts) {
    opts = opts || {};
    return filterEvents(events(), { mode: opts.mode, when: opts.when || 'all', cat: opts.cat, free: opts.free })
      .map(it => Object.assign({}, it.ev, { next: it.day }));
  }

  /* ---------- карточка события ---------- */
  let CUR = null, SEQ = 0;
  function whenMain(st) {
    const ev = st.ev, t = st.ctx.today;
    if (ev.long) {
      const range = ev.end === t ? 'Сегодня последний день' : ev.start > t ? `С ${dMonth(ev.start, t)} по ${dMonth(ev.end, t)}` : `Идёт до ${dMonth(ev.end, t)}`;
      return range + (ev.time ? `, начало в ${ev.time}` : '');
    }
    const d = st.day, rel = d === t ? 'Сегодня' : d === addD(t, 1) ? 'Завтра' : '';
    return (rel ? `${rel}, ${dMonth(d, t)}` : dLong(d, t)) + (ev.time ? ', ' + ev.time : '');
  }
  function sheetHtml(st, tok) {
    const ev = st.ev, ctx = st.ctx, t = ctx.today, place = placeOf(ev);
    const ph = place && K.photo ? K.photo(place) : null;
    const hero = ph && ph.s
      ? `<figure class="af-ph"><img src="${esc(ph.s)}" width="720" height="450" alt="${esc(ev.venue || place.name)}" decoding="async">${K.photoCredit ? `<figcaption>${K.photoCredit(ph)}</figcaption>` : ''}</figure>`
      : `<div class="af-hero afc-${ev.cat || 'other'}" aria-hidden="true"><span>${esc(ev.emoji)}</span></div>`;
    let pick = '';
    if (st.days.length > 1) {
      const shown = st.days.slice(0, 12), rest = st.days.length - shown.length;
      pick = `<div class="af-days" role="group" aria-label="Выбери дату">${shown.map(d =>
        `<button type="button" class="af-chip af-sm" data-af-day="${d}" aria-pressed="${d === st.day}">${dayLabel(d, t)}</button>`).join('')}` +
        `${rest > 0 ? `<span class="af-dim">и ещё ${rest} ${plural(rest, 'дата', 'даты', 'дат')}</span>` : ''}</div>`;
    } else if (ev.long) {
      const lo = ev.start > t ? ev.start : t;
      pick = `<span class="af-dim">Часы работы и выходные дни уточни на сайте площадки.</span>` +
        (K.calendarLinks ? `<label class="af-pick">День для календаря <input type="date" data-af-date min="${lo}" max="${ev.end}" value="${st.day}"></label>` : '');
    }
    const priceFull = priceText(ev, true);
    const metro = metroText(ev.metro);
    const venue = ev.venue || (place && place.name) || '';
    const placeLink = place && typeof st.opts.onPlace === 'function'
      ? `<button type="button" class="af-link" data-af-place="${esc(ev.place)}">О площадке: фото и как найти</button>` : '';
    /* подпись по адресу: «Билеты — Яндекс Афиша», у сайта площадки или организатора — «сайт организатора» */
    const src = ev.url ? ticketSource(ev.url) : null, tkWord = isFree(ev) ? 'Подробнее' : 'Билеты';
    const tickets = src ? `<a class="af-btn af-ghost" href="${esc(ev.url)}" target="_blank" rel="noopener nofollow" data-af-t="event_tickets" data-af-v="${src.key}" aria-label="${esc(`${tkWord} — ${src.name}, откроется в новой вкладке`)}">${I('ticket')}` +
      `<span class="af-bl"><span>${tkWord}</span><small>${esc(src.name)}</small></span></a>` : '';
    const cal = K.calendarLinks ? `<button type="button" class="af-btn af-ghost" data-af-cal aria-expanded="false" aria-controls="${tok}-cal">${I('calendar')}<span>В календарь</span></button>` : '';
    return `
      ${hero}
      <p class="af-eyebrow">${esc(catName(ev))}${ev.age ? ` · <span class="af-tag af-age${ev.age === '18+' ? ' af-a18' : ''}">${esc(ev.age)}</span>` : ''}</p>
      <h3 class="af-title" id="${tok}-t" tabindex="-1">${esc(ev.title)}</h3>
      <ul class="af-facts">
        <li>${I('calendar')}<span><b data-af-when>${esc(whenMain(st))}</b>${pick}</span></li>
        ${venue || ev.addr ? `<li>${I('pin')}<span><a class="af-venue" href="${venueMap(ev)}" target="_blank" rel="noopener"><b>${esc(venue)}</b></a>` +
          `<span class="af-dim">${esc([ev.addr, metro].filter(Boolean).join(' · '))}</span>${placeLink}</span></li>` : ''}
        <li>${I('ticket')}<span><b>${esc(priceFull || (src ? 'Цена — ' + src.on : 'Цену уточни у площадки'))}</b></span></li>
      </ul>
      ${ev.note ? `<p class="af-note">${esc(ev.note)}</p>` : ''}
      <div class="af-actions">
        <a class="af-btn af-primary" href="${inviteUrl(ev.id, st.mode)}" data-af-t="event_invite"><span>Позвать на событие</span>${I('arrow')}</a>
        ${tickets || cal ? `<div class="af-row${tickets && cal ? '' : ' af-one'}">${tickets}${cal}</div>` : ''}
        ${cal ? `<div class="af-cal" id="${tok}-cal" hidden>
          <a class="af-btn af-ghost af-sm" data-af-g href="#" target="_blank" rel="noopener" data-af-t="event_cal">Google Календарь</a>
          <a class="af-btn af-ghost af-sm" data-af-ics href="#" download="${esc(ev.id)}.ics" data-af-t="event_cal">Apple, Outlook и другие (.ics)</a>
        </div>` : ''}
        <div class="af-row">
          <a class="af-btn af-ghost" href="${routeTo(ev)}" target="_blank" rel="noopener" data-af-t="event_route">${I('route')}<span>Как добраться</span></a>
          <button type="button" class="af-btn af-ghost" data-af-share>${I('share')}<span>Поделиться</span></button>
        </div>
        <p class="af-live" role="status" aria-live="polite"></p>
      </div>
      ${ev.lat != null ? `<section class="af-near" aria-labelledby="${tok}-n">
        <h4 id="${tok}-n">План вокруг события</h4>
        <p class="af-dim">Куда зайти до начала или после — пешком от площадки.</p>
        <div data-af-near>${nearHtml(st)}</div>
      </section>` : ''}
      <p class="af-disc">Даты, время и цены могут измениться — перед походом проверь их ${src ? src.on : 'у площадки'}.</p>`;
  }
  function nearHtml(st) {
    const ev = st.ev, R = window.KudaReviews;
    const list = nearbyPlaces(ev, placesMap(), { score: reviewScore() });
    if (!list.length) {
      const q = 'https://yandex.ru/maps/213/moscow/?ll=' + ev.lon.toFixed(6) + ',' + ev.lat.toFixed(6) + '&z=16&text=' + encodeURIComponent(NEAR_Q[st.mode] || 'кафе');
      return `<p class="af-dim">В нашем каталоге рядом пока ничего нет. <a href="${q}" target="_blank" rel="noopener">Поискать рядом в Яндекс Картах</a></p>`;
    }
    const onPlace = typeof st.opts.onPlace === 'function';
    return `<ul class="af-near-list">${list.map(x => {
      const p = x.p, ph = K.photo ? K.photo(p) : null;
      let badge = '';
      if (R && typeof R.badge === 'function') { try { badge = R.badge(x.id, { short: true }) || ''; } catch (e) { badge = ''; } }
      const name = onPlace
        ? `<button type="button" class="af-np-name" data-af-place="${esc(x.id)}">${esc(p.name)}</button>`
        : `<a class="af-np-name" href="start.html?place=${encodeURIComponent(x.id)}">${esc(p.name)}</a>`;
      return `<li class="af-np"><span class="af-np-e${ph && ph.t ? ' af-phc' : ''}" aria-hidden="true">${ph && ph.t ? `<img src="${esc(ph.t)}" width="240" height="240" alt="" loading="lazy" decoding="async">` : esc(p.emoji)}</span>` +
        `<span class="af-np-main">${name}<span class="af-np-sub">${x.walk} мин пешком · ${esc(String(p.kind || '').split(' · ')[0])}${badge ? ' ' + badge : ''}</span></span>` +
        `<a class="af-np-go" href="${walkRoute(ev, p)}" target="_blank" rel="noopener" data-af-t="event_plan" data-af-v="${esc(x.id)}" aria-label="Маршрут пешком от площадки до «${esc(p.name)}»">${I('route')}</a></li>`;
    }).join('')}</ul>`;
  }

  /* Событие прошло или его нет: объясняем и предлагаем, что идёт сейчас */
  function goneHtml(ev, st, tok) {
    const ctx = st.ctx;
    let sug = filterEvents(events(), { ctx, mode: st.mode, when: 'all' });
    if (ev && ev.cat) sug = sug.filter(it => it.ev.cat === ev.cat).concat(sug.filter(it => it.ev.cat !== ev.cat));
    sug = sug.filter(it => !it.long).concat(sug.filter(it => it.long)).slice(0, 3);
    const all = typeof st.opts.onAll === 'function' ? '<button type="button" class="af-btn af-primary" data-af-all>Вся афиша</button>' : '';
    const plans = typeof st.opts.onPlans === 'function' ? `<button type="button" class="af-btn ${all ? 'af-ghost' : 'af-primary'}" data-af-plans>Готовые планы на вечер</button>` : '';
    return `<div class="af-gone"><span class="af-empty-e" aria-hidden="true">🕰️</span>
        <h3 class="af-title" id="${tok}-t" tabindex="-1">${ev ? 'Это событие уже прошло' : 'Такого события нет в афише'}</h3>
        <p class="af-note">${ev ? `«${esc(ev.title)}» уже закончилось.` : 'Возможно, его отменили или ссылка устарела.'}${sug.length ? ' Вот что идёт в ближайшие дни:' : ''}</p></div>
      ${sug.length ? `<ul class="af-items">${sug.map(it => itemHtml(it, ctx, { withDay: true })).join('')}</ul>` : ''}
      ${all || plans ? `<div class="af-actions">${all}${plans}</div>` : ''}`;
  }

  /* Открыть событие. Прошедшее или неизвестное — карточка «уже прошло» с подсказками; тогда вернёт false */
  function open(id, opts) {
    const so = Object.assign({}, opts);
    /* adopt (занять текущую запись истории) — только для этого открытия, не для карточек, открытых из неё */
    opts = Object.assign({}, opts);
    delete opts.adopt;
    const mode = MODES.includes(opts.mode) ? opts.mode : 'date';
    const ctx = mskNow(), ev = findEvent(id);
    if (!ev || !isUpcoming(ev, ctx)) {
      present(tok => goneHtml(ev, { ctx, mode, opts }, tok), so, { ev: null, id: String(id || ''), mode, opts, ctx });
      return false;
    }
    const st = { ev, id: ev.id, mode, opts, ctx, day: nextDay(ev, ctx), days: upcomingDays(ev, ctx) };
    present(tok => sheetHtml(st, tok), so, st);
    track('event_open', { id: ev.id, mode });
    const R = window.KudaReviews;
    if (R && R.ready && typeof R.ready.then === 'function') {
      const cur = CUR;
      R.ready.then(() => {
        if (CUR !== cur || !cur || !cur.root.isConnected) return;
        const box = cur.root.querySelector('[data-af-near]');
        if (box) box.innerHTML = nearHtml(st);
      }, () => { /* без рейтингов — по расстоянию */ });
    }
    return true;
  }

  /* Шторку даёт страница (opts.openSheet — у главной своя шторка, «назад» её закрывает),
     иначе — своё окно: фокус внутри, Esc и клик по фону закрывают, фокус возвращается назад */
  function present(build, opts, st) {
    release();
    const tok = 'af' + (++SEQ) + Math.random().toString(36).slice(2, 6);
    const html = `<div class="af af-sheet" data-af-root="${tok}">${build(tok)}</div>`;
    let root = null, close = null, hosted = false, host = null;
    if (typeof opts.openSheet === 'function') {
      try {
        /* id — какое событие открыто (главная строит по нему адрес ?event=<id>), adopt — занять текущую запись истории */
        const r = opts.openSheet(html, { onClose: () => release(tok), kind: 'event', id: st.id || '', adopt: !!opts.adopt });
        host = r && r.nodeType === 1 ? r : r && r.el && r.el.nodeType === 1 ? r.el : null;
        root = (host && host.querySelector(`[data-af-root="${tok}"]`)) || document.querySelector(`[data-af-root="${tok}"]`);
        close = r && typeof r.close === 'function' ? r.close : typeof opts.closeSheet === 'function' ? opts.closeSheet : null;
        hosted = !!root;
        /* шторка страницы — диалог: подписываем его заголовком события */
        const dlg = root && root.closest('[role="dialog"]');
        if (dlg) dlg.setAttribute('aria-labelledby', tok + '-t');
      } catch (e) { root = null; }
    }
    if (!root) { const o = overlay(html, tok); root = o.root; close = o.close; }
    /* своя кнопка «Закрыть» — только если у шторки страницы её нет */
    const box = host || (root && root.parentElement);
    if (hosted && close && !(box && box.querySelector('[data-sheet-close], .sheet-x'))) {
      root.insertAdjacentHTML('afterbegin', `<button type="button" class="af-x" data-af-x aria-label="Закрыть">${I('x')}</button>`);
    }
    const cur = { tok, root, close, st, blob: '' };
    CUR = cur;
    root.addEventListener('click', e => onSheetClick(cur, e));
    root.addEventListener('change', e => onSheetChange(cur, e));
    const title = root.querySelector('.af-title');
    if (title) title.focus({ preventScroll: true });
  }
  /* Карточку закрыли или заменили: освобождаем ссылку на .ics */
  function release(tok) {
    if (!CUR || (tok && CUR.tok !== tok)) return;
    if (CUR.blob) { try { URL.revokeObjectURL(CUR.blob); } catch (e) { /* ок */ } }
    CUR = null;
  }

  function onSheetClick(cur, e) {
    const t = e.target, st = cur.st;
    if (t.closest('[data-af-x]')) { if (cur.close) cur.close(); return; }
    const day = t.closest('[data-af-day]');
    if (day) { setDay(cur, day.dataset.afDay); return; }
    if (t.closest('[data-af-cal]')) { toggleCal(cur); return; }
    if (t.closest('[data-af-share]')) { shareEvent(cur); return; }
    const ev = t.closest('[data-af-ev]');
    if (ev) { open(ev.dataset.afEv, st.opts); return; }
    const pl = t.closest('[data-af-place]');
    if (pl && typeof st.opts.onPlace === 'function') { e.preventDefault(); st.opts.onPlace(pl.dataset.afPlace); return; }
    if (t.closest('[data-af-all]') && typeof st.opts.onAll === 'function') { closeThen(cur, st.opts.onAll); return; }
    if (t.closest('[data-af-plans]') && typeof st.opts.onPlans === 'function') { closeThen(cur, st.opts.onPlans); return; }
    const a = t.closest('[data-af-t]');
    if (a && st.ev) track(a.dataset.afT, { id: st.ev.id, mode: st.mode, v: a.dataset.afV || undefined });
  }
  /* Закрыть карточку, потом fn (прокрутка страницы). Шторка главной закрывается через history.back() —
     прокручивать раньше нельзя: браузер вернёт сохранённую прокрутку. close(then) вызывает then, когда можно;
     если шторка страницы колбэк не поддерживает — запасной таймер */
  function closeThen(cur, fn) {
    let done = false;
    /* и после popstate браузер ещё восстанавливает прокрутку записи — прокручиваем следующей задачей */
    const go = () => { if (!done) { done = true; setTimeout(() => { try { fn(); } catch (e) { /* ок */ } }, 20); } };
    if (!cur.close) { go(); return; }
    try { cur.close(go); } catch (e) { go(); return; }
    setTimeout(go, 800);
  }
  function onSheetChange(cur, e) {
    const inp = e.target.closest && e.target.closest('[data-af-date]');
    if (!inp) return;
    const v = inp.value, ev = cur.st.ev;
    if (validDay(v) && v >= inp.min && v <= ev.end) setDay(cur, v);
    else inp.value = cur.st.day;
  }
  function setDay(cur, d) {
    const st = cur.st;
    if (!st.ev || (!st.ev.long && !st.days.includes(d))) return;
    st.day = d;
    cur.root.querySelectorAll('[data-af-day]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.afDay === d)));
    revealOn(cur.root.querySelector('.af-days'));
    const w = cur.root.querySelector('[data-af-when]');
    if (w) w.textContent = whenMain(st);
    hideCal(cur);
  }
  function hideCal(cur) {
    const box = cur.root.querySelector('.af-cal'), btn = cur.root.querySelector('[data-af-cal]');
    if (box) box.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
  /* Ссылки в календарь собираем по нажатию: .ics — это Blob, его не держим дольше нужного */
  function toggleCal(cur) {
    const box = cur.root.querySelector('.af-cal'), btn = cur.root.querySelector('[data-af-cal]');
    if (!box || !K.calendarLinks) return;
    if (!box.hidden) { hideCal(cur); return; }
    const ev = cur.st.ev;
    if (cur.blob) { try { URL.revokeObjectURL(cur.blob); } catch (e) { /* ок */ } }
    const l = K.calendarLinks({
      title: ev.title, day: cur.st.day, time: ev.time, minutes: MINUTES[ev.cat] || 150,
      location: [ev.venue, ev.addr].filter(Boolean).join(', '), details: [ev.note, ev.url].filter(Boolean).join('\n'),
    });
    cur.blob = l.ics;
    box.querySelector('[data-af-g]').href = l.google;
    box.querySelector('[data-af-ics]').href = l.ics;
    box.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  }
  async function shareEvent(cur) {
    const ev = cur.st.ev, url = shareUrl(ev.id, cur.st.mode);
    const say = text => {
      if (typeof cur.st.opts.toast === 'function') { cur.st.opts.toast(text); return; }
      const l = cur.root.querySelector('.af-live');
      if (!l) return;
      l.textContent = text;
      clearTimeout(l._t);
      l._t = setTimeout(() => { l.textContent = ''; }, 4000);
    };
    track('event_share', { id: ev.id, mode: cur.st.mode });
    try {
      if (navigator.share) { await navigator.share({ title: ev.title, text: `${ev.title} — ${formatWhen(ev, mskNow(), { noMore: true })}`, url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); say('Ссылка скопирована'); }
    catch (e) { try { window.prompt('Скопируй ссылку', url); } catch (er) { say(url); } }
  }

  /* Своё окно для страниц без шторки */
  let OV = null;
  function overlay(html, tok) {
    const top = `<div class="af-dlg-top"><span class="af-grab" aria-hidden="true"></span><button type="button" class="af-x" data-af-x aria-label="Закрыть">${I('x')}</button></div>`;
    if (OV) {
      OV.dlg.innerHTML = top + html;
      OV.dlg.setAttribute('aria-labelledby', tok + '-t');
      OV.dlg.scrollTop = 0;
      return { root: OV.dlg.querySelector(`[data-af-root="${tok}"]`), close: OV.close };
    }
    const back = document.activeElement;
    const body = document.body, prev = { o: body.style.overflow, p: body.style.paddingRight };
    const sbw = window.innerWidth - document.documentElement.clientWidth;
    const ov = document.createElement('div');
    ov.className = 'af af-ov';
    ov.innerHTML = `<div class="af-dlg" role="dialog" aria-modal="true" aria-labelledby="${tok}-t">${top}${html}</div>`;
    const dlg = ov.firstElementChild;
    body.style.overflow = 'hidden';
    if (sbw > 0) body.style.paddingRight = sbw + 'px';   // без прыжка вёрстки, когда пропадает полоса прокрутки
    body.appendChild(ov);
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Tab') trap(e, dlg);
    };
    function close(then) {
      if (!OV || OV.ov !== ov) { if (typeof then === 'function') then(); return; }
      document.removeEventListener('keydown', onKey, true);
      ov.remove();
      body.style.overflow = prev.o;
      body.style.paddingRight = prev.p;
      OV = null;
      release();
      if (back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
      if (typeof then === 'function') then();
    }
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.af-dlg-top [data-af-x]')) close(); });
    OV = { ov, dlg, close };
    return { root: dlg.querySelector(`[data-af-root="${tok}"]`), close };
  }
  function trap(e, box) {
    const f = Array.from(box.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter(x => !x.closest('[hidden]') && x.getClientRects().length);
    if (!f.length) return;
    const a = document.activeElement, first = f[0], last = f[f.length - 1];
    if (!box.contains(a)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  }

  /* Ссылка start.html?event=<id>[&m=guys]: открывает карточку события (или «уже прошло»). true — обработано */
  function handleDeepLink(qs, opts) {
    let p;
    try {
      p = qs && typeof qs.get === 'function' ? qs : new URLSearchParams(qs == null ? location.search : String(qs));
    } catch (e) { return false; }
    const id = String(p.get('event') || '').trim();
    if (!id) return false;
    /* эта карточка уже открыта (например, главная открыла её сама по параметру event) — второй раз не открываем */
    if (CUR && CUR.st && CUR.st.id === id && CUR.root && CUR.root.isConnected && CUR.root.getClientRects().length) return true;
    opts = Object.assign({}, opts);
    if (!MODES.includes(opts.mode)) { const m = p.get('m') || p.get('mode'); if (MODES.includes(m)) opts.mode = m; }
    open(id, opts);
    return true;
  }

  /* Страница висит открытой: при возвращении на вкладку (новый день или прошло полчаса) прошедшее убираем */
  const LIVE = new Set();
  let liveAt = Date.now(), liveDay = '';
  function live(fn) { LIVE.add(fn); }
  if (typeof document !== 'undefined' && document.addEventListener) {
    liveDay = mskNow().today;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      const day = mskNow().today;
      if (day === liveDay && Date.now() - liveAt < 30 * 60e3) return;
      liveDay = day; liveAt = Date.now();
      LIVE.forEach(fn => { if (!fn()) LIVE.delete(fn); });
      /* страница может обновить свои счётчики (например, число событий на вкладке) */
      try { document.dispatchEvent(new CustomEvent('kuda-afisha', { detail: { reason: 'refresh' } })); } catch (e) { /* старый браузер */ }
    });
  }

  window.KudaAfisha = {
    count, shelf, mount, open, handleDeepLink, upcoming,
    /* чистые функции — для тестов */
    _test: {
      normalize, filterEvents, groupByDay, nearbyPlaces, formatWhen, priceText, windowOf, nextDay, upcomingDays,
      dayLabel, mskNow, shelfItems, itemHtml, cardHtml, isFree, isAdult, shareUrl, inviteUrl, ticketSource, sheetHtml, CATS, WHEN,
      setClock: fn => { clock = typeof fn === 'function' ? fn : () => new Date(); },
    },
  };
})();

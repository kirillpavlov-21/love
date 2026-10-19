/* Конструктор: форма → приглашение → короткая ссылка. Режимы: свидание, пацаны, подружки. */
(function () {
  'use strict';

  const K = window.DateKit;
  const CFG = window.DATE_CONFIG || {};
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = K.esc;
  /* Черновик формы. Версия в ключе: при смене версии старые черновики сбрасываются один раз
     (в них могли остаться шаблоны чужого режима — «девичник» в свидании и т.п.). */
  const DRAFT = 'kuda-draft-v2';
  const OLD_DRAFTS = ['date-constructor-draft'];
  /* История отправленных приглашений — её же читает invites.html («Мои приглашения»).
     Запись: { code, link (полная ссылка без голосов), short?, mode, title, label, ev?, city? ('spb' | 'msk' — город мест из каталога), at, upd, reg? } */
  const HIST = 'date-constructor-history';
  const HIST_MAX = 50;
  /* Приглашения, созданные в этом браузере (K.hash(code)): игра не засчитывает создателю «открыли»,
     не сохраняет его ответ на свидание и не шлёт уведомления — голосовать в компании он может */
  const OWN = 'kuda-own';
  /* Секрет владельца для своего сервера: «Мои приглашения» видят статусы только своих приглашений */
  const OWNER_SECRET = 'kuda-owner';
  /* Ключ владельца от Telegram-бота и отметка, что посредник его принял */
  const OWNER = 'kuda-owner-key';
  const OWNER_OK = 'kuda-owner-key-ok';
  /* Секрет создателя: случайная строка этого браузера. В приглашение кладём только её отпечаток (tg),
     а сам секрет показываем боту при регистрации — так бот знает, что приглашение создали здесь. */
  const CREATOR = 'kuda-creator';
  const RENEW = 'kuda-owner-renew';
  const MODE_ORDER = ['date', 'guys', 'girls'];
  const MAX_OPTS = 20, MAX_PLACES = 12;
  /* Имена, которые попадают в ссылку, если поле пустое. В черновик их не пишем: иначе после перезагрузки
     в поле «Твоё имя» стояло бы «Твой друг» как будто введённое */
  const FALLBACK = { her: 'Солнышко', me: 'Твой друг' };

  const LEVELS = {
    date: [
      ['hearts', '❤️ Поймай сердечки', 'мини-игра: котик ловит сердечки в корзинку'],
      ['letter', '💌 Письмо с вопросом', '«Пойдёшь со мной на свидание?» и кнопки Да/Нет'],
      ['place', '🎈 Шарики с местами', 'лопает шарик и выбирает место'],
      ['date', '📅 Календарь', 'ставит сердечко на удобный день'],
      ['time', '🌇 Время', 'слайдер с небом: утро → ночь'],
      ['food', '🍕 Свайпы еды', 'вправо — хочу, влево — нет'],
    ],
    group: [
      ['hearts', '🎮 Мини-игра', 'разминка: котик ловит предметы'],
      ['date', '📅 Выбор дней', 'каждый отмечает все удобные дни'],
    ],
  };
  const CAT_NAMES = { line: 'Контурный', ginger: 'Рыжий', grey: 'Серый', white: 'Белый', black: 'Чёрный' };
  const THEME_INFO = {
    pink: ['Роза', '#FF6F91'],
    lavender: ['Лаванда', '#B9A1FF'],
    peach: ['Янтарь', '#FFA463'],
    mint: ['Мята', '#6EE7B7'],
    sport: ['Лайм', '#D7F25C'],
  };
  const WEEK = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Вс']];
  const EMOJIS = '☕ 🎬 🌳 🍝 ⛸️ 🎡 🎳 🎤 🖼️ 🌊 🍷 🎭 🏛️ 🚲 🌅 🎨 📚 🎮 🧗 🛶 🏖️ 🍕 🍣 🍔 🥐 🍜 🥩 🥗 🍰 🍦 🧋 🍫 🌮 🥟 🍤 🍓 🍿 🎱 🎯 🧖 ⚽ 💅 💃'.split(' ');
  const EV_CATS = {
    concert: 'Концерт', theatre: 'Спектакль', exhibition: 'Выставка', standup: 'Стендап', festival: 'Фестиваль',
    sport: 'Спорт', show: 'Шоу', party: 'Вечеринка', lecture: 'Лекция', kids: 'Детям',
  };
  /* Подписи фильтров — как в «Афише» */
  const EV_CHIPS = {
    concert: 'Концерты', theatre: 'Театр', exhibition: 'Выставки', standup: 'Стендап', festival: 'Фестивали',
    sport: 'Спорт', show: 'Шоу', party: 'Вечеринки', lecture: 'Лекции', kids: 'Детям',
  };
  /* «м. Охотный ряд» не разрываем на «м.» и название */
  const metro = m => K.metroText(m).replace(/^(м\.|ж\/д) /, '$1\u00a0');
  const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  const DEF = K.defaults();
  // пришли по чужому приглашению (?ref= — 8 знаков хэша его кода): метка уйдёт на сервер вместе с регистрацией
  const REF = (/^[a-z0-9]{8}$/.exec(new URLSearchParams(location.search).get('ref') || '') || [''])[0];
  const state = {
    mode: 'date', cat: 'line', theme: 'pink', who: 'f',
    texts: {},                          // тексты других режимов: {guys: {greeting, question, title}, …}
    levels: { date: null, group: null }, // уровни свидания и компании хранятся отдельно
    gsel: new Set(), autoSel: false,    // выбор для голосования текущего режима компании
    gselBy: { guys: null, girls: null }, // выбор каждого режима компании: {sel: [...], auto}
    optsBy: { guys: null, girls: null }, // свои варианты каждого режима компании (в #opts — варианты lastGroup)
    lastGroup: 'guys',
    event: '', evOther: false,          // событие из афиши (свидание) и «предложить и другие места»
    city: K.city(),                     // город каталога: в приглашении — места и события одного города
  };
  let pvStep = 0;
  let pvCounter = 0;
  let pvShown = '';
  /* Режим только из своего списка: «?mode=__proto__» или «constructor» в ссылке не должны сломать форму */
  const okMode = m => typeof m === 'string' && MODE_ORDER.includes(m);
  const modeOf = inv => (okMode(inv && inv.mode) ? inv.mode : 'date');
  const isGroup = () => state.mode !== 'date';
  const kindOf = mode => (mode === 'date' ? 'date' : 'group');
  const MC = () => K.MODES[state.mode];
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c; };

  function toast(t) {
    const el = $('#toast');
    el.textContent = t;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 2800);
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* запасной путь */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (e) { return false; }
  }
  /* Копирование текста, который ещё готовится (короткая ссылка): ClipboardItem с обещанием
     сохраняет разрешение на запись, пока ждём сеть. Без него — обычный путь после ожидания. */
  function copyLater(textP) {
    const cb = navigator.clipboard;
    if (cb && cb.write && window.ClipboardItem) {
      try {
        return cb.write([new ClipboardItem({ 'text/plain': textP.then(t => new Blob([t], { type: 'text/plain' })) })])
          .then(() => true, () => textP.then(copyText));
      } catch (e) { /* ниже — запасной путь */ }
    }
    return textP.then(copyText);
  }
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ок */ } },
    del: k => { try { localStorage.removeItem(k); } catch (e) { /* ок */ } },
  };
  const readJson = (k, d) => { try { const v = JSON.parse(ls.get(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  const API = () => (window.KudaAPI && window.KudaAPI.on ? window.KudaAPI : null);

  /* ---------- текст и тема по умолчанию для режима ---------- */
  const modeDefault = (mode, key) => (mode === 'date' ? DEF[key] : K.MODES[mode][key]);
  const themeDefault = mode => (mode === 'date' ? DEF.theme : K.MODES[mode].theme);
  /* стандартный текст чужого режима (например, «собирает девочек» в свидании) — меняем на текст текущего */
  const ownText = (mode, key, val) => {
    const foreign = Object.keys(K.MODES).some(m => m !== mode && val === modeDefault(m, key));
    return !val || foreign ? modeDefault(mode, key) : val;
  };

  /* ---------- афиша: события (assets/events.js + auto.js) ---------- */
  function mskToday() {
    if (K.todayMsk) { try { const t = K.todayMsk(); if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t; } catch (e) { /* ниже */ } }
    try {
      const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    } catch (e) { /* ниже */ }
    return K.ymd(new Date());
  }
  function evById(id) {
    if (!id || typeof id !== 'string') return null;
    if (K.eventById) { try { return K.eventById(id) || null; } catch (e) { /* ниже */ } }
    return (window.KUDA_EVENTS || []).find(e => e && e.id === id) || null;
  }
  const EV_DAYS = new Map();
  /* Дни события начиная с сегодняшнего (по Москве) */
  function evDays(ev) {
    if (!ev) return [];
    if (EV_DAYS.has(ev)) return EV_DAYS.get(ev);
    let out = null;
    if (K.eventDays) { try { out = K.eventDays(ev); } catch (e) { out = null; } }
    if (!Array.isArray(out)) {
      const t = mskToday();
      if (Array.isArray(ev.dates) && ev.dates.length) out = ev.dates.filter(d => d >= t).sort();
      else {
        out = [];
        const end = ev.end || ev.start;
        let d = K.parseYmd(ev.start > t ? ev.start : t);
        while (d && K.ymd(d) <= end && out.length < 400) { out.push(K.ymd(d)); d = K.addDays(d, 1); }
      }
    }
    EV_DAYS.set(ev, out);
    return out;
  }
  const evAlive = ev => !!ev && evDays(ev).length > 0;

  /* ---------- город каталога ----------
     В одном приглашении — места одного города. Каталог показывает город state.city: из ?city=, из плана или события
     в ссылке (?plan=, ?event=), из уже выбранного (черновик, «В конструктор»), иначе — город главной (K.city()).
     Город пункта — по id: места spb-…, планы spb-d-/spb-g-/spb-w-…, события ev-spb-…, у матчей — своё поле city. */
  const okCity = c => typeof c === 'string' && Object.prototype.hasOwnProperty.call(K.CITIES, c);
  const CITY_OF = new Map();
  /* Город плана, места (p-<id>) или события; неизвестный id — '' (кроме петербургских: их видно по префиксу) */
  function itemCity(id) {
    if (typeof id !== 'string' || !id) return '';
    if (CITY_OF.has(id)) return CITY_OF.get(id);
    const pl = K.planById(id), ev = pl ? null : evById(id);
    const c = pl ? K.cityOf(pl.single ? pl.stops[0] : pl) : ev ? K.cityOf(ev) : K.cityOf(id) === 'spb' ? 'spb' : '';
    if (pl || ev) CITY_OF.set(id, c);
    return c;
  }
  const inCityNow = id => itemCity(id) === state.city;
  /* Сколько мест в каталоге каждого города: переключатель показываем, только если городов с местами больше одного */
  const CITY_N = {};
  Object.keys(K.kuda().places || {}).forEach(id => { if (K.placeById(id)) { const c = K.cityOf(id); CITY_N[c] = (CITY_N[c] || 0) + 1; } });
  const pkCities = () => Object.keys(K.CITIES).filter(c => c === state.city || CITY_N[c]);
  /* Город приглашения или черновика — по первому пункту из каталога, '' — пунктов из каталога нет */
  const firstCity = ids => { for (const id of ids) { const c = itemCity(id); if (c) return c; } return ''; };

  const EV_LIST = {};
  /* Ближайшие события города, подходящие режиму, — по дате */
  function evList(mode) {
    const key = mode + '|' + state.city;
    if (EV_LIST[key]) return EV_LIST[key];
    let list = null;
    if (K.events) { try { list = K.events({ mode }); } catch (e) { list = null; } }
    if (!Array.isArray(list)) {
      list = (window.KUDA_EVENTS || []).filter(e => e && e.id).slice()
        .sort((a, b) => (evDays(a)[0] || '9').localeCompare(evDays(b)[0] || '9') || String(a.title).localeCompare(String(b.title), 'ru'));
    }
    return (EV_LIST[key] = list.filter(e => e && evAlive(e) && K.cityOf(e) === state.city && (!Array.isArray(e.fit) || !e.fit.length || e.fit.includes(mode))));
  }
  const curEvent = () => (!isGroup() && state.event ? evById(state.event) : null);
  function dayShort(s) {
    const d = K.parseYmd(s);
    return d ? `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}` : s;
  }
  function evWhen(ev) {
    const days = evDays(ev);
    if (!days.length) return 'уже прошло';
    if (days.length === 1) return dayShort(days[0]);
    if (!(Array.isArray(ev.dates) && ev.dates.length)) return 'до ' + dayShort(ev.end).replace(/^\S+ /, '');
    return `${dayShort(days[0])} и ещё ${days.length - 1} ${plural(days.length - 1, 'дата', 'даты', 'дат')}`;
  }
  const rub = n => Number(n).toLocaleString('ru-RU') + ' ₽';
  function evPrice(ev) {
    const p = ev.price;
    if (!Array.isArray(p) || !p.length) return '';
    if (+p[0] === 0 && +(p[1] || 0) === 0) return 'бесплатно';
    if (+p[0] === 0) return 'до ' + rub(p[1]);
    if (p[1] == null || +p[1] === +p[0]) return 'от ' + rub(p[0]);
    return `${Number(p[0]).toLocaleString('ru-RU')}–${rub(p[1])}`;
  }
  const evPhoto = ev => { const p = ev && ev.place ? K.placeById(ev.place) : null; return p ? K.photo(p) : null; };
  const evText = ev => norm([ev.title, ev.venue, ev.metro, ev.addr, EV_CATS[ev.cat] || ''].join(' '));

  /* ---------- оценки мест (assets/reviews.js; без сервера — пусто) ---------- */
  function rateBadge(it) {
    const R = window.KudaReviews;
    if (!R || !it) return '';
    try {
      if (it.cat && it.start) return it.place && R.badge ? R.badge(it.place, { short: true }) || '' : '';
      if (it.single) return R.badge ? R.badge(it.stops[0], { short: true }) || '' : '';
      return R.planBadge ? R.planBadge(it, { short: true }) || '' : '';
    } catch (e) { return ''; }
  }

  /* ---------- списки: места, варианты, еда, даты ---------- */
  function itemRow(it, kind) {
    const pl = it.plan ? K.planById(it.plan) : null;
    const st = pl ? K.planStops(pl) : [];
    return `<div class="li"${pl ? ` data-plan="${esc(pl.id)}"` : ''}>
      <input class="em" value="${esc(it.emoji || (pl && pl.emoji) || '')}" maxlength="8" aria-label="Эмодзи" placeholder="🙂">
      <div class="li-main">
        <input class="ti" value="${esc(it.title || (pl && pl.title) || '')}" maxlength="40" placeholder="${kind === 'food' ? 'Блюдо' : 'Название места'}" aria-label="${kind === 'food' ? 'Блюдо' : 'Название'}">
        <input class="no" value="${esc(it.note || (pl && pl.why) || '')}" maxlength="90" placeholder="Подпись (необязательно)" aria-label="Подпись">
        ${pl && st.length ? `<span class="plan-tag">${pl.single ? '📍 Место из каталога: ' + esc([st[0].kind, metro(st[0].metro)].filter(Boolean).join(' · ')) : '📋 Готовый план: ' + esc(st.map(p => p.name).join(' → '))}</span>` : ''}
      </div>
      <button class="del" type="button" title="Удалить" aria-label="Удалить">${K.icon('x')}</button>
    </div>`;
  }
  const dateRow = d => `<div class="li date-li"><input class="dt" type="date" value="${esc(d || '')}" aria-label="Дата"><button class="del" type="button" title="Удалить" aria-label="Удалить">${K.icon('x')}</button></div>`;
  function renderList(id, items) {
    const box = $('#' + id);
    box.innerHTML = id === 'dates' ? items.map(dateRow).join('') : items.map(it => itemRow(it, id)).join('');
  }
  function readRow(r) {
    const o = { emoji: $('.em', r).value.trim(), title: $('.ti', r).value.trim() };
    const note = $('.no', r).value.trim();
    if (note) o.note = note;
    if (r.dataset.plan) {
      const pl = K.planById(r.dataset.plan);
      // если подписи совпадают с планом — храним только id плана (короче ссылка)
      if (pl && o.emoji === pl.emoji && o.title === pl.title && (o.note || '') === (pl.why || '')) return { plan: pl.id };
      o.plan = r.dataset.plan;
    }
    return o;
  }
  const readList = id => $$('.li', $('#' + id)).map(readRow).filter(o => o.title || o.plan);

  /* ---------- выбор из каталога: подборки, все места, события; поиск, подсказки ---------- */
  /* Один и тот же выбор в двух режимах: в свидании пункт становится шариком (#places) или событием приглашения,
     в компании — вариантом для голосования (state.gsel). Места каталога идут как «p-<id>», события — «ev-…». */
  const PK_STEP = 24;
  const pk = { tab: 'plans', q: '', hint: '', ecat: '', limit: PK_STEP, pinned: [] };
  /* Улица-пример в подсказке поиска — своя у каждого города */
  const PK_STREET = { msk: 'Арбат', spb: 'Невский' };
  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е');
  const SEASON = K.seasonHints();
  const PK_HINTS = ['autumn', 'halloween', 'newyear', 'first', 'scenic', 'view', 'rain', 'budget', 'company', 'night', 'michelin'];
  const isEv = id => typeof id === 'string' && !K.planById(id) && !!evById(id);
  function pkSelected() {
    if (isGroup()) return state.gsel;
    const s = new Set($$('#places .li[data-plan]').map(r => r.dataset.plan));
    if (state.event) s.add(state.event);
    return s;
  }
  const pkHints = it => it.single ? K.placeHints(K.placeById(it.stops[0])) : K.planHints(it);
  const PK_TEXT = new Map();
  function pkText(it) {
    if (!PK_TEXT.has(it.id)) {
      const st = K.planStops(it);
      PK_TEXT.set(it.id, norm([it.title, it.when].concat(st.map(p => [p.name, p.kind, p.metro, p.addr].join(' '))).join(' ')));
    }
    return PK_TEXT.get(it.id);
  }
  const lead = s => s.replace(/^[^0-9A-Za-zА-Яа-яЁё]+/, '');
  /* В каталоге — только то, что сейчас в сезоне (поле season, как на главной). Уже выбранное
     (черновик, ?plan=, «В конструктор» из приглашения) всё равно видно: отмеченные идут отдельно, через pk.pinned */
  const pkPlanOk = (s, mode) => s.mode === mode && K.planStops(s).length && K.seasonOk(s) && inCityNow(s.id);
  const PK_PLACES = {};   // город → места каталога
  function pkPlaces() {
    const c = state.city;
    if (!PK_PLACES[c]) {
      PK_PLACES[c] = Object.keys(K.kuda().places).filter(id => K.seasonOk(K.placeById(id)) && K.cityOf(id) === c).map(id => K.planById('p-' + id)).filter(Boolean)
        .sort((a, b) => (!!K.photo(K.placeById(b.stops[0])) - !!K.photo(K.placeById(a.stops[0]))) || lead(a.title).localeCompare(lead(b.title), 'ru'));
    }
    return PK_PLACES[c];
  }
  function pkPlans() {
    const list = K.kuda().scenarios.filter(s => pkPlanOk(s, state.mode));
    // в сезон подборки про осень и Хэллоуин — первыми
    const season = s => (s.tags || []).some(t => SEASON.includes(t)) ? 0 : 1;
    return list.map((s, i) => [s, i]).sort((a, b) => season(a[0]) - season(b[0]) || a[1] - b[1]).map(x => x[0]);
  }
  const ck = on => `<span class="pk-ck" aria-hidden="true">${on ? '✓' : '+'}</span>`;
  function pkItem(it, on) {
    const st = K.planStops(it), ph = it.single ? K.photo(st[0]) : K.planPhoto(it);
    if (!st.length) return '';
    const sub = it.single ? [st[0].kind, metro(st[0].metro)].filter(Boolean).join(' · ') : st.map(x => x.name).join(' → ');
    const hints = pkHints(it).filter(h => !(h === 'first' && isGroup())).slice(0, 3);
    const rb = rateBadge(it);
    return `<button type="button" class="pk-it${on ? ' on' : ''}" data-pk="${esc(it.id)}" aria-pressed="${on}">
      <span class="pk-im">${ph ? `<img src="${esc(ph.t)}" alt="" loading="lazy">` : esc(it.emoji)}</span>
      <span class="pk-tx"><b>${ph ? esc(it.emoji) + ' ' : ''}${esc(it.title)}</b><small>${rb ? rb + ' · ' : ''}${esc(sub)}</small>${hints.length ? `<span class="hints">${hints.map(h => K.hintChip(h, 'short')).join('')}</span>` : ''}</span>
      ${ck(on)}
    </button>`;
  }
  function evItem(ev, on) {
    const ph = evPhoto(ev), rb = rateBadge(ev), price = evPrice(ev);
    const when = [evWhen(ev), ev.time].filter(Boolean).join(' · ');
    return `<button type="button" class="pk-it pk-ev${on ? ' on' : ''}" data-pk="${esc(ev.id)}" aria-pressed="${on}">
      <span class="pk-im">${ph ? `<img src="${esc(ph.t)}" alt="" loading="lazy">` : esc(ev.emoji || '🎫')}</span>
      <span class="pk-tx"><b>${ph ? esc(ev.emoji || '') + ' ' : ''}${esc(ev.title)}</b><small>${[`<span class="pk-when">${esc(when)}</span>`, rb].concat([ev.venue, price].filter(Boolean).map(esc)).filter(Boolean).join(' · ')}</small></span>
      ${ck(on)}
    </button>`;
  }
  const anyItem = (id, on) => { const pl = K.planById(id); if (pl) return pkItem(pl, on); const ev = evById(id); return ev ? evItem(ev, on) : ''; };
  /* Отмеченные — наверху, но только после смены вкладки/поиска: при нажатии пункт не прыгает из-под пальца */
  const pinNow = () => { pk.pinned = Array.from(pkSelected()); };
  /* Кнопка каталога в фокусе (клавиатура, экранный диктор): после перерисовки возвращаем фокус на неё же */
  const PK_ATTRS = ['data-pk', 'data-pkh', 'data-pke', 'data-pktab', 'data-pkmore', 'data-pkcity'];
  function pkFocus(box) {
    const ae = document.activeElement;
    if (!ae || !box.contains(ae)) return null;
    const a = PK_ATTRS.find(x => ae.hasAttribute(x));
    return a ? { a, v: ae.getAttribute(a), n: box.querySelectorAll('.pk-list .pk-it').length } : null;
  }
  function pkRefocus(box, f) {
    if (!f) return;
    // после «Показать ещё» — фокус на первый из новых пунктов
    const added = f.a === 'data-pkmore' ? box.querySelectorAll('.pk-list .pk-it')[f.n] : null;
    const el = added || box.querySelector(`[${f.a}="${CSS.escape(f.v)}"]`);
    if (el && el !== document.activeElement) el.focus({ preventScroll: true });
  }
  function renderPicker() {
    const box = $(isGroup() ? '#planPick' : '#datePlans');
    const other = $(isGroup() ? '#datePlans' : '#planPick');
    if (other.firstChild) other.innerHTML = '';
    const focus = pkFocus(box);
    if (!$('.pk-list', box)) {
      box.innerHTML = `<div class="pk-city hidden" role="group" aria-label="Город каталога"></div>
        <div class="pk-tabs seg" role="group" aria-label="Каталог"><button type="button" data-pktab="plans"></button><button type="button" data-pktab="places"></button><button type="button" data-pktab="events"></button></div>
        <input class="pk-q" type="search" placeholder="" aria-label="Поиск по планам, местам и событиям" autocomplete="off">
        <div class="pk-hints" role="group" aria-label="Подсказки"></div><div class="pk-list"></div><div class="pk-foot"></div>`;
    }
    renderCitySeg(box);
    const q = $('.pk-q', box);
    if (q.value !== pk.q) q.value = pk.q;
    q.placeholder = `Поиск: парк, бар, ${PK_STREET[state.city] || 'кофейня'}, концерт…`;
    const sel = pkSelected();
    const plans = pkPlans(), places = pkPlaces(), events = evList(state.mode);
    if (pk.tab === 'events' && !events.length) pk.tab = 'plans';
    const tabs = { plans: ['Планы', plans.length], places: ['Все места', places.length], events: ['События', events.length] };
    $$('[data-pktab]', box).forEach(b => {
      const on = b.dataset.pktab === pk.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.innerHTML = `${tabs[b.dataset.pktab][0]}<i>${tabs[b.dataset.pktab][1]}</i>`;
      b.classList.toggle('hidden', b.dataset.pktab === 'events' && !events.length);
    });
    box.querySelector('.pk-tabs').classList.toggle('two', !events.length);
    const words = norm(pk.q).split(/\s+/).filter(Boolean);
    let found, chipsHtml;
    if (pk.tab === 'events') {
      const byQ = words.length ? events.filter(ev => words.every(w => evText(ev).includes(w))) : events;
      const counts = {};
      byQ.forEach(ev => { counts[ev.cat] = (counts[ev.cat] || 0) + 1; });
      const cats = Object.keys(EV_CATS).filter(c => counts[c]);
      if (pk.ecat && !cats.includes(pk.ecat)) cats.unshift(pk.ecat);
      chipsHtml = `<button type="button" data-pke="" class="${pk.ecat ? '' : 'on'}" aria-pressed="${!pk.ecat}">Все</button>` +
        cats.map(c => `<button type="button" data-pke="${c}" class="${pk.ecat === c ? 'on' : ''}" aria-pressed="${pk.ecat === c}">${EV_CHIPS[c]}<i>${counts[c] || 0}</i></button>`).join('');
      found = pk.ecat ? byQ.filter(ev => ev.cat === pk.ecat) : byQ;
    } else {
      const all = pk.tab === 'places' ? places : plans;
      const byQ = words.length ? all.filter(it => words.every(w => pkText(it).includes(w) || pkHints(it).some(h => norm(K.HINTS[h][1]).includes(w)))) : all;
      const counts = {};
      byQ.forEach(it => pkHints(it).forEach(h => { counts[h] = (counts[h] || 0) + 1; }));
      const chips = PK_HINTS.filter(h => counts[h] && !(h === 'first' && isGroup()));
      if (pk.hint && !chips.includes(pk.hint)) chips.unshift(pk.hint);
      chipsHtml = `<button type="button" data-pkh="" class="${pk.hint ? '' : 'on'}" aria-pressed="${!pk.hint}">Все</button>` +
        chips.map(h => `<button type="button" data-pkh="${h}" class="${pk.hint === h ? 'on' : ''}" aria-pressed="${pk.hint === h}">${K.HINTS[h][0]} ${K.HINTS[h][2]}<i>${counts[h] || 0}</i></button>`).join('');
      found = pk.hint ? byQ.filter(it => pkHints(it).includes(pk.hint)) : byQ;
    }
    $('.pk-hints', box).innerHTML = chipsHtml;
    const pinned = pk.pinned.filter(id => K.planById(id) || evById(id));
    const pinSet = new Set(pinned);
    const list = found.filter(it => !pinSet.has(it.id));
    const one = it => (pk.tab === 'events' ? evItem(it, sel.has(it.id)) : pkItem(it, sel.has(it.id)));
    $('.pk-list', box).innerHTML = pinned.map(id => anyItem(id, sel.has(id))).join('') + (list.length
      ? list.slice(0, pk.limit).map(one).join('')
      : found.length ? '' : `<p class="pk-empty">Ничего не нашлось. Попробуй другое слово${pk.tab === 'plans' ? ' или вкладку «Все места»' : ''}.</p>`);
    const more = list.length - pk.limit;
    const n = sel.size;
    $('.pk-foot', box).innerHTML = (more > 0 ? `<button type="button" class="more" data-pkmore>Показать ещё ${Math.min(PK_STEP, more)} из ${more}</button>` : '') +
      (n ? `<span class="pk-sel">Выбрано: ${n}</span>` : '');
    pkRefocus(box, focus);
  }
  const optCount = () => state.gsel.size + readList('opts').length;
  function togglePick(id) {
    // пункт другого города — сначала переключаем каталог на его город: в приглашении один город
    const fc = pkSelected().has(id) ? '' : foreignCity(id);
    if (fc) switchCity(fc, { save: true, quiet: true });
    if (isGroup()) {
      if (state.gsel.has(id)) state.gsel.delete(id);
      else if (optCount() >= MAX_OPTS) { toast(`Не больше ${MAX_OPTS} вариантов — так голосовать удобнее`); return; }
      else state.gsel.add(id);
      state.autoSel = false;
      return;
    }
    if (isEv(id)) {
      if (state.event === id) setEvent('');
      else setEvent(id, true);
      return;
    }
    const row = $(`#places .li[data-plan="${CSS.escape(id)}"]`);
    if (row) row.remove();
    else if ($$('#places .li').length >= MAX_PLACES) { toast(`Не больше ${MAX_PLACES} шариков — иначе выбирать тяжело`); return; }
    else $('#places').insertAdjacentHTML('beforeend', itemRow({ plan: id }, 'places'));
  }

  /* ---------- смена города каталога ----------
     Пункты прежнего города не теряются: откладываем их (в памяти вкладки) и возвращаем, если переключиться обратно.
     Свои варианты без места из каталога («Покер у Димы», стандартные шарики) от города не зависят и остаются. */
  const STASH = {};   // город → { places: [пункты шариков], event, evOther, gsel: { guys: [id…], girls: [id…] }, filled? }
  const stashOf = c => STASH[c] || (STASH[c] = { places: [], event: '', evOther: false, gsel: {} });
  const foreignCity = id => { const c = itemCity(id); return c && c !== state.city ? c : ''; };
  /* Убираем из формы пункты другого города и откладываем их; ответ — сколько убрали */
  function dropForeign() {
    let n = 0;
    $$('#places .li[data-plan]').forEach(r => {
      const c = foreignCity(r.dataset.plan);
      if (!c) return;
      const o = readRow(r), s = stashOf(c);
      r.remove();
      n++;
      if (!s.places.some(x => x.plan === o.plan)) s.places.push(o);
    });
    const ec = state.event ? foreignCity(state.event) : '';
    if (ec) {
      Object.assign(stashOf(ec), { event: state.event, evOther: state.evOther });
      state.event = ''; state.evOther = false;
      n++;
    }
    const keep = (ids, mode, auto) => ids.filter(id => {
      const c = foreignCity(id);
      if (!c) return true;
      // выбор по умолчанию (три первые подборки) не откладываем — у нового города будут свои
      if (!auto) { const g = stashOf(c).gsel; g[mode] = Array.from(new Set((g[mode] || []).concat(id))); n++; }
      return false;
    });
    if (isGroup()) state.gsel = new Set(keep(Array.from(state.gsel), state.mode, state.autoSel));
    ['guys', 'girls'].forEach(m => {
      const g = state.gselBy[m];
      if (!g || (isGroup() && m === state.mode)) return;
      const sel = keep(g.sel, m, g.auto);
      // выбор по умолчанию целиком из другого города — пусть режим наберёт свой, когда на него переключатся
      state.gselBy[m] = sel.length || !g.auto ? { sel, auto: g.auto } : null;
    });
    return n;
  }
  /* Возвращаем отложенное для текущего города; ответ — сколько вернули */
  function restoreCity() {
    const s = STASH[state.city];
    if (!s) return 0;
    delete STASH[state.city];
    let n = 0;
    const back = s.places.filter(o => K.planById(o.plan) && !$(`#places .li[data-plan="${CSS.escape(o.plan)}"]`));
    // стандартные шарики (кофейня, кино…), которые подставили, когда уходили из этого города, — убираем обратно
    if (back.length && s.filled && isDefaultPlaces()) $('#places').innerHTML = '';
    back.forEach(o => {
      if ($$('#places .li').length >= MAX_PLACES) return;
      $('#places').insertAdjacentHTML('beforeend', itemRow(o, 'places'));
      n++;
    });
    if (s.event && !state.event && evAlive(evById(s.event))) { state.event = s.event; state.evOther = s.evOther; n++; }
    Object.keys(s.gsel).forEach(m => {
      const ids = s.gsel[m].filter(id => validOpt(id, m));
      if (!ids.length) return;
      if (isGroup() && m === state.mode) {
        const room = Math.max(0, MAX_OPTS - readList('opts').length);
        state.gsel = new Set((state.autoSel ? [] : Array.from(state.gsel)).concat(ids).slice(0, room));
        state.autoSel = false;
      } else {
        const g = state.gselBy[m];
        state.gselBy[m] = { sel: Array.from(new Set((g && !g.auto ? g.sel : []).concat(ids))), auto: false };
      }
      n += ids.length;
    });
    return n;
  }
  /* Число мест каталога в подсказке «любое из 960+ мест Москвы» — для города каталога */
  function placeCount() {
    const n = pkPlaces().length;
    const el = $('#placeCount'), cityEl = $('#placeCity');
    if (el) el.textContent = n >= 20 ? Math.floor(n / 10) * 10 + '+' : String(n);
    if (cityEl) cityEl.textContent = K.CITIES[state.city].gen;
  }
  /* o.save — запомнить город и для главной (выбрал сам или пришёл по ссылке на план или событие), o.quiet — без подсказки */
  function switchCity(c, o) {
    o = o || {};
    if (!okCity(c) || c === state.city) return false;
    const was = state.city;
    state.city = c;
    if (o.save) K.setCity(c);
    const gone = dropForeign(), back = restoreCity();
    if (isGroup() && !state.gsel.size && !readList('opts').length) { state.gsel = new Set(defaultGroupSel(state.mode)); state.autoSel = true; }
    if (!isGroup() && !state.event && !$$('#places .li').length) {
      ensurePlaces();
      // вернёмся в прежний город — стандартные шарики уступят место отложенным
      if (STASH[was]) STASH[was].filled = true;
    }
    // поиск и фильтры прежнего города («Арбат») в новом обычно пусты — начинаем с чистого листа
    Object.assign(pk, { q: '', hint: '', ecat: '', limit: PK_STEP });
    placeCount();
    pinNow();
    renderPicker();
    renderEventUi();
    if (!o.quiet) {
      toast(gone ? `Выбранное ${K.CITIES[was].in} отложил: в приглашении — один город${back ? '. Вернул выбранное ' + K.CITIES[c].in : ''}`
        : back ? `Вернул выбранное ${K.CITIES[c].in} ✓` : `Каталог: ${K.CITIES[c].name}`);
    }
    changed();
    return true;
  }
  function renderCitySeg(box) {
    const el = $('.pk-city', box), list = pkCities();
    el.classList.toggle('hidden', list.length < 2);
    el.innerHTML = list.length < 2 ? '' : '<span class="pk-city-l" aria-hidden="true">📍</span>' + list.map(c =>
      `<button type="button" data-pkcity="${c}" class="${c === state.city ? 'on' : ''}" aria-pressed="${c === state.city}">${esc(K.CITIES[c].name)}</button>`).join('');
  }

  /* ---------- событие в приглашении на свидание ---------- */
  /* Шариков нет совсем (приглашение только на событие) — вернём стандартные, чтобы было из чего выбирать */
  function ensurePlaces() {
    if ($$('#places .li').length || $('#placeSurprise').checked || $('#placeCustom').checked) return;
    renderList('places', DEF.places);
    $('#placeSurprise').checked = !!DEF.placeSurprise;
    $('#placeCustom').checked = !!DEF.placeCustom;
  }
  function setEvent(id, announce) {
    const ev = id ? evById(id) : null;
    if (id && !evAlive(ev)) { toast('Это событие уже прошло — выбери другое во вкладке «События»'); return; }
    if (!ev && state.event) ensurePlaces();
    const swap = !!state.event;
    state.event = ev ? ev.id : '';
    if (ev) {
      // новое событие вместо прежнего — «другие места» оставляем как были
      if (!swap) state.evOther = false;
      const lv = $('#lv-place');
      if (lv) lv.checked = true;
      if (announce) toast(`Зовём на «${ev.title}» ✓`);
    }
    pinNow();
    renderEventUi();
  }
  function evCard(ev) {
    const ph = evPhoto(ev), price = evPrice(ev), rb = rateBadge(ev);
    const line1 = [evWhen(ev), ev.time].filter(Boolean).join(' · ');
    const line2 = [ev.venue, metro(ev.metro)].filter(Boolean).join(' · ');
    const line3 = [price, ev.age].filter(Boolean).join(' · ');
    return `<div class="ev-card">
      <span class="pk-im ev-im">${ph ? `<img src="${esc(ph.t)}" alt="" loading="lazy">` : esc(ev.emoji || '🎫')}</span>
      <div class="ev-tx">
        <p class="ev-eye">${esc(EV_CATS[ev.cat] || 'Событие')} из афиши</p>
        <b>${esc(ev.title)}</b>
        <small>${esc(line1)}</small>
        ${line2 ? `<small>${esc(line2)}</small>` : ''}
        ${line3 || rb ? `<small>${rb ? rb + (line3 ? ' · ' : '') : ''}${esc(line3)}</small>` : ''}
      </div>
      <button class="del" type="button" data-ev-del title="Убрать событие" aria-label="Убрать событие «${esc(ev.title)}»">${K.icon('x')}</button>
    </div>`;
  }
  function renderEventUi() {
    const ev = curEvent();
    const box = $('#evBox');
    box.classList.toggle('hidden', !ev);
    if (ev) {
      box.innerHTML = `${evCard(ev)}
        <p class="hint">В игре вместо шариков будет карточка события${evDays(ev).length === 1 ? ', день — ' + esc(dayShort(evDays(ev)[0])) : ', дни — по афише'}${ev.time ? ', начало — ' + esc(ev.time) : ''}.
          <button type="button" class="linkbtn" data-ev-change>Другое событие</button></p>
        <label class="tg"><input type="checkbox" id="evOther"${state.evOther ? ' checked' : ''}><span></span><b>Предложить и другие места</b><i>если событие не зайдёт — выберет шарик с местом</i></label>`;
    } else box.innerHTML = '';
    $('#placesEd').classList.toggle('hidden', !!ev && !state.evOther);
    // дни и время: для события — по афише; свои настройки нужны, только если можно выбрать другое место
    const days = ev ? evDays(ev) : [];
    $('#evDates').classList.toggle('hidden', !ev);
    if (ev) {
      const shown = days.slice(0, 4).map(dayShort).join(', ') + (days.length > 4 ? ` и ещё ${days.length - 4}` : '');
      $('#evDates').textContent = days.length === 1 ? `📅 День по афише: ${shown} — спрашивать день не будем.` : `📅 Дни по афише: ${shown}. В календаре будут только они.`;
    }
    $('#dateEd').classList.toggle('hidden', !!ev && !state.evOther);
    $('#dateCap').classList.toggle('hidden', !ev);
    const timed = !!(ev && ev.time);
    $('#evTime').classList.toggle('hidden', !timed);
    if (timed) $('#evTime').textContent = `🕐 Начало события — ${ev.time}. Время спрашивать не будем.`;
    $('#timeEd').classList.toggle('hidden', timed && !state.evOther);
    $('#timeCap').classList.toggle('hidden', !timed);
    // один день по афише — день не спрашиваем, и кнопка «Ни один день не подходит» не нужна
    const dob = $('#dateOtherBox');
    if (dob) dob.classList.toggle('hidden', !!ev && days.length === 1 && !state.evOther);
  }

  /* ---------- режим ---------- */
  function renderModeSeg() {
    $('#modeSeg').innerHTML = MODE_ORDER.map(m =>
      `<button type="button" data-mode="${m}" class="${m === state.mode ? 'on' : ''}" aria-pressed="${m === state.mode}">${K.icon(K.MODE_ICON[m])}${K.MODES[m].label}</button>`).join('');
  }
  function readLevels() {
    const levels = {};
    $$('#levels input').forEach(i => { levels[i.id.slice(3)] = i.checked; });
    return levels;
  }
  function renderLevels(levels) {
    const list = isGroup() ? LEVELS.group : LEVELS.date;
    $('#levels').innerHTML = list.map(([id, t, d]) =>
      `<label class="tg"><input type="checkbox" id="lv-${id}"${(levels || {})[id] !== false ? ' checked' : ''}><span></span><b>${t}</b><i>${d}</i></label>`).join('');
  }
  function applyModeUi() {
    document.body.dataset.mode = state.mode;
    renderModeSeg();
    $('#resTitle').textContent = isGroup() ? 'Ссылка для общего чата' : 'Ссылка-приглашение';
    $('#open').innerHTML = K.icon('ext') + 'Открыть как получатель';
    $('#answerHint').textContent = isGroup()
      ? '«Превью без отправки» — посмотреть игру, ничего не сохраняя. Итоги голосования — в «Моих приглашениях».'
      : (API() ? 'Ответ появится в «Моих приглашениях», как только человек дойдёт до конца игры.'
        : 'В конце игры человек отправит тебе ответ ссылкой-билетом.') +
        ' «Открыть как получатель» — пройти всю игру самому: в этом браузере твои ответы не сохраняются и никуда не уходят.';
  }
  /* Сценарии режима по умолчанию — три первые подборки города каталога */
  function defaultGroupSel(mode) {
    return K.kuda().scenarios.filter(s => pkPlanOk(s, mode)).slice(0, 3).map(s => s.id);
  }
  /* Вариант для голосования: план своего режима, место или идущее событие — и только из города каталога */
  const validOpt = (id, mode) => {
    if (!inCityNow(id)) return false;
    const pl = K.planById(id);
    if (pl) return pl.single || pl.mode === mode;
    return evAlive(evById(id));
  };
  function switchMode(next) {
    if (next === state.mode || !okMode(next)) return;
    const prev = state.mode;
    state.texts[prev] = { greeting: $('#greeting').value, question: $('#question').value, title: $('#title').value };
    state.levels[kindOf(prev)] = readLevels();
    if (prev !== 'date') {
      state.gselBy[prev] = { sel: Array.from(state.gsel), auto: state.autoSel };
      state.optsBy[prev] = readList('opts');
    }
    const t = state.texts[next] || {};
    $('#greeting').value = t.greeting != null ? t.greeting : modeDefault(next, 'greeting');
    $('#question').value = t.question != null ? t.question : modeDefault(next, 'question');
    $('#title').value = t.title || K.MODES[next].title || '';
    if (state.theme === themeDefault(prev)) state.theme = themeDefault(next);
    state.mode = next;
    if (pk.hint === 'first') pk.hint = '';
    renderLevels(state.levels[kindOf(next)]);
    renderSwatches();
    if (next !== 'date') {
      // свои варианты у пацанов и подружек разные: «Покер у Димы» не переезжает в девичник
      if (next !== state.lastGroup) renderList('opts', state.optsBy[next] || []);
      state.lastGroup = next;
      const saved = state.gselBy[next];
      let sel, auto = false;
      if (saved) { sel = saved.sel.filter(id => validOpt(id, next)); auto = !!saved.auto; }
      else {
        // у другого режима компании берём отдельные места и события — подборки у режимов свои
        sel = Array.from(state.gsel).filter(id => validOpt(id, next) && !(K.planById(id) && !K.planById(id).single));
      }
      if (!sel.length && !readList('opts').length) { sel = defaultGroupSel(next); auto = true; }
      state.gsel = new Set(sel);
      state.autoSel = auto;
    }
    applyModeUi();
    pinNow();
    renderPicker();
    renderEventUi();
    changed();
  }

  /* ---------- форма ⇄ приглашение ---------- */
  /* src — черновик (с полями _mode, _texts, _levels, _gsel, …), приглашение из ссылки или {} */
  function fillForm(src) {
    src = isObj(src) ? src : {};
    const inv = K.merge(DEF, src);
    state.mode = okMode(src._mode) ? src._mode : modeOf(inv);
    // город — по первому пункту из каталога (событие, шарики, варианты голосования); их нет — город остаётся прежним.
    // В черновике варианты голосования лежат и в _gsel, а выбор по умолчанию (_auto) город не задаёт: его подставили сами.
    // Отложенное прежней формы к новой не относится
    const draft = typeof src._mode === 'string', auto = isObj(src._auto) ? src._auto : {};
    const ids = [src._event, inv.event].concat(
      (Array.isArray(inv.places) ? inv.places : []).map(p => p && p.plan),
      draft ? [] : (Array.isArray(inv.opts) ? inv.opts : []).map(o => o && (o.plan || o.event)),
      ...(isObj(src._gsel) ? ['guys', 'girls'].map(m => (Array.isArray(src._gsel[m]) && !auto[m] ? src._gsel[m] : [])) : []));
    state.city = firstCity(ids.filter(x => typeof x === 'string')) || state.city;
    Object.keys(STASH).forEach(c => { delete STASH[c]; });
    ['her', 'me', 'catName', 'signature', 'finale'].forEach(k => { $('#' + k).value = inv[k] || ''; });
    // старые черновики хранили запасные имена как введённые — в форме их не показываем
    if (typeof src._mode === 'string') ['her', 'me'].forEach(k => { if (inv[k] === FALLBACK[k]) $('#' + k).value = ''; });
    $('#tgu').value = K.tgUser(inv.tgu) ? '@' + K.tgUser(inv.tgu) : '';
    $('#greeting').value = ownText(state.mode, 'greeting', String(inv.greeting || '').trim());
    $('#question').value = ownText(state.mode, 'question', String(inv.question || '').trim());
    $('#title').value = inv.title || (isGroup() ? MC().title : '') || '';
    state.texts = {};
    if (isObj(src._texts)) Object.keys(src._texts).forEach(m => { if (okMode(m) && m !== state.mode && isObj(src._texts[m])) state.texts[m] = Object.assign({}, src._texts[m]); });
    state.cat = K.CATS[inv.cat] ? inv.cat : 'line';
    state.who = inv.who === 'm' ? 'm' : 'f';
    renderWho();
    state.theme = K.THEMES.includes(inv.theme) ? inv.theme : themeDefault(state.mode);
    renderSwatches();
    state.levels = { date: null, group: null };
    if (isObj(src._levels)) ['date', 'group'].forEach(k => { if (isObj(src._levels[k])) state.levels[k] = Object.assign({}, src._levels[k]); });
    state.levels[kindOf(state.mode)] = Object.assign({}, inv.levels);
    renderLevels(state.levels[kindOf(state.mode)]);
    $('#heartsGoal').value = inv.heartsGoal || 12;
    // «Нет» убегает — только в свидании; в черновике компании хранится выбор для свидания
    const no = state.mode === 'date' ? inv.noButton : src._no;
    $('#noButton').value = no === 'real' ? 'real' : 'runaway';
    renderList('places', (inv.places || []).filter(p => p && (p.title || (p.plan && K.planById(p.plan)))));
    $('#placeSurprise').checked = !!inv.placeSurprise;
    $('#placeCustom').checked = !!inv.placeCustom;
    // варианты для голосования: подборки, места и события — в выбор каталога, свои — списком
    const opts = Array.isArray(inv.opts) ? inv.opts.filter(isObj) : [];
    const picked = opts.map(o => o.plan || o.event).filter(id => typeof id === 'string' && (K.planById(id) || evById(id)));
    state.gselBy = { guys: null, girls: null };
    if (isObj(src._gsel)) ['guys', 'girls'].forEach(m => { if (Array.isArray(src._gsel[m])) state.gselBy[m] = { sel: src._gsel[m].filter(id => typeof id === 'string'), auto: !!(src._auto || {})[m] }; });
    const custom = list => list.filter(o => isObj(o) && !o.plan && !o.event && o.title);
    state.optsBy = { guys: null, girls: null };
    if (isObj(src._opts)) ['guys', 'girls'].forEach(m => { if (Array.isArray(src._opts[m])) state.optsBy[m] = custom(src._opts[m]); });
    const lg = okMode(src._group) && src._group !== 'date' ? src._group : '';
    state.lastGroup = isGroup() ? state.mode : lg || (state.gselBy.girls && !state.gselBy.guys ? 'girls' : 'guys');
    renderList('opts', isGroup() || !state.optsBy[state.lastGroup] ? custom(opts) : state.optsBy[state.lastGroup]);
    if (isGroup()) {
      state.gsel = new Set(picked);
      state.autoSel = !!(src._auto || {})[state.mode];
    } else {
      const g = state.gselBy[state.lastGroup];
      state.gsel = new Set(g ? g.sel : picked);
      state.autoSel = false;
    }
    const d = inv.dates || {};
    $$('input[name="dmode"]').forEach(r => { r.checked = r.value === (d.mode === 'list' ? 'list' : 'next'); });
    $('#dStart').value = d.start || '';
    $('#dDays').value = d.days || 14;
    const skip = (d.skipWeekdays || []).map(Number);
    $$('#weekdays input').forEach(c => { c.checked = !skip.includes(+c.value); });
    renderList('dates', (d.list && d.list.length) ? d.list : ['']);
    $('#dateOther').checked = inv.dateOther !== false;
    const t = inv.time || {};
    $('#tFrom').value = clockOf(t.from, '12:00');
    $('#tTo').value = clockOf(t.to, '22:00');
    $('#tStep').value = String([15, 30, 60].includes(+t.step) ? +t.step : 30);
    $('#tDef').value = clockOf(t.def, '19:00');
    // компания: варианты времени и срок. В черновике — как в полях; в ссылке без slots — стандартные три
    const draftSl = Array.isArray(src._slots) ? src._slots.map(x => (typeof x === 'string' ? x : '')) : null;
    const linkSl = Array.isArray(src.slots) ? src.slots.filter(x => typeof x === 'string') : null;
    fillSlots(draftSl || (linkSl && linkSl.length ? linkSl : SLOT_DEF), typeof src._slotAsk === 'boolean' ? src._slotAsk : true);
    const um = ['hour', 'today', 'thu', 'own'].includes(src._umode) ? src._umode : '';
    const uMs = typeof src._until === 'string' ? msOfLocal(src._until) : Number.isInteger(src.until) ? src.until * 60000 : NaN;
    if (um && um !== 'own') { setUMode(um); pickUntil(um); }   // «через час» из вчерашнего черновика — от текущего момента
    else if ((um === 'own' || (!draft && uMs)) && uMs > Date.now()) { setUMode('own'); $('#untilAt').value = localOf(uMs); renderUntil(); }
    else { setUMode(''); $('#untilAt').value = ''; renderUntil(); }
    // пустой список блюд — осознанный выбор (уровень пропускается), стандартные не подставляем
    renderList('food', (inv.food || []).filter(f => f && f.title));
    // событие: из черновика (_event) или из ссылки (event)
    const evId = typeof src._event === 'string' ? src._event : (typeof inv.event === 'string' ? inv.event : '');
    const ev = evId ? evById(evId) : null;
    state.event = ev && evAlive(ev) ? ev.id : '';
    state.evOther = src._evOther != null ? !!src._evOther : !!(state.event && ((inv.places || []).length || inv.placeSurprise || inv.placeCustom));
    // пункты другого города (смешанная ссылка, черновик до смены города на главной) — в сторону: в приглашении один город.
    // Выбор по умолчанию другого города заменяем подборками этого
    dropForeign();
    if (isGroup() && state.autoSel && !state.gsel.size && !readList('opts').length) state.gsel = new Set(defaultGroupSel(state.mode));
    placeCount();
    syncDateMode();
    applyModeUi();
    pinNow();
    renderPicker();
    renderEventUi();
    return { pastEvent: !!evId && !state.event };
  }
  /* Окно через полночь (22:00–02:00) в ссылке: «до» = 26:00, то есть 02:00 следующего дня, и «сначала»
     после полуночи тоже +24 ч (00:30 → 24:30). Так слайдер игры сразу идёт 22:00 → 02:00 и встаёт на 00:30
     (подписи у него по модулю суток). В форме — обычные часы. */
  const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const clockOf = (t, d) => (/^\d{1,2}:\d{2}$/.test(t || '') ? hhmm(K.toMin(t) % 1440) : d);
  function readTime() {
    const v = id => $('#' + id).value.trim();
    const from = v('tFrom') || '12:00';
    const a = K.toMin(from);
    let b = K.toMin(v('tTo') || '22:00'), d = K.toMin(v('tDef') || '19:00');
    if (b === a) b = a + 60;          // пустое окно — как в игре: час от начала
    else if (b < a) b += 1440;        // через полночь
    if (d < a) d += 1440;
    if (d > b) d = a;                 // «сначала» вне окна — с начала
    return { from, to: hhmm(b), step: +v('tStep') || 30, def: hhmm(d) };
  }
  /* Окно может идти через полночь: 22:00–02:00 */
  function inWindow(t, from, to) {
    const a = K.toMin(from);
    let b = K.toMin(to), x = K.toMin(t);
    if (b <= a) { b += 1440; if (x < a) x += 1440; }
    return x >= a && x <= b;
  }
  /* ---------- компания: «Во сколько» и «Решаем до» (время московское, как в игре) ---------- */
  const SLOT_DEF = ['19:00', '20:00', '21:00'];
  const MSK = 3 * 3600e3, DAY = 86400e3;
  const UNTIL_MAX = 14 * DAY;                       // дальше двух недель сервер дедлайн не примет
  const mskNow = () => new Date(Date.now() + MSK);   // поля UTC этой даты — московское время
  const localOf = ms => new Date(ms + MSK).toISOString().slice(0, 16);   // 'ГГГГ-ММ-ДДTЧЧ:ММ' по Москве
  const msOfLocal = s => { const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - MSK : NaN; };
  const mskMidnight = () => { const n = mskNow(); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) - MSK; };
  /* «через час» (до 5 минут вверх), «сегодня 18:00» (прошло — завтра), «чт 18:00» (ближайший четверг) */
  function untilPreset(kind) {
    const now = Date.now(), soon = now + 15 * 60e3, day = mskMidnight();
    if (kind === 'hour') return Math.ceil((now + 3600e3) / 300e3) * 300e3;
    if (kind === 'today') { const t = day + 18 * 3600e3; return t > soon ? t : t + DAY; }
    if (kind === 'thu') { let t = day + ((4 - mskNow().getUTCDay() + 7) % 7) * DAY + 18 * 3600e3; if (t <= soon) t += 7 * DAY; return t; }
    return NaN;
  }
  const uMode = () => ($('input[name="umode"]:checked') || {}).value || '';
  function setUMode(m) { $$('input[name="umode"]').forEach(r => { r.checked = r.value === m; }); }
  function renderSlots() { $('#slotEd').classList.toggle('off', !$('#slotAsk').checked); }
  function renderUntil() {
    const t = mskMidnight() + 18 * 3600e3;
    $('#uToday').textContent = t > Date.now() + 15 * 60e3 ? 'Сегодня 18:00' : 'Завтра 18:00';
    const m = uMode(), box = $('#untilAt');
    box.classList.toggle('hidden', !m);
    const ms = msOfLocal(box.value), info = $('#untilInfo');
    if (!m) info.textContent = 'После срока голосование закроется, итог у всех будет одинаковый.';
    else if (!(ms > Date.now())) info.textContent = 'Этот срок уже прошёл — выбери другой.';
    else if (ms - Date.now() > UNTIL_MAX) info.textContent = 'Не дальше двух недель — так компания точно не забудет.';
    else info.textContent = 'Время московское. После срока голосование закроется, итог у всех будет одинаковый.';
  }
  function pickUntil(m) {
    const box = $('#untilAt');
    if (m && m !== 'own') box.value = localOf(untilPreset(m));
    else if (m === 'own' && !(msOfLocal(box.value) > Date.now())) box.value = localOf(untilPreset('today'));
    renderUntil();
  }
  function fillSlots(list, ask) {
    const ins = $$('#slotEd .slot-in');
    ins.forEach((el, i) => { el.value = list[i] || ''; });
    $('#slotAsk').checked = ask;
    renderSlots();
  }
  function readSlots() {
    if (!$('#slotAsk').checked) return [];
    const out = [];
    $$('#slotEd .slot-in').forEach(el => { const t = el.value; if (/^([01]\d|2[0-3]):[0-5]\d$/.test(t) && !out.includes(t)) out.push(t); });
    return out.slice(0, 4);
  }
  /* дедлайн в минутах эпохи или 0 (нет, прошёл, дальше двух недель) */
  function readUntil() {
    if (!uMode()) return 0;
    const ms = msOfLocal($('#untilAt').value);
    return ms > Date.now() && ms - Date.now() <= UNTIL_MAX ? Math.floor(ms / 60000) : 0;
  }
  /* «Сегодня, решаем за час»: только сегодня, ближайшие часы с 19:00, срок — через час */
  function presetNow() {
    const n = mskNow();
    $$('input[name="dmode"]').forEach(r => { r.checked = r.value === 'list'; });
    renderList('dates', [n.toISOString().slice(0, 10)]);
    syncDateMode();
    const h0 = Math.max(19, n.getUTCHours() + (n.getUTCMinutes() >= 30 ? 2 : 1));
    const sl = [h0, h0 + 1, h0 + 2].filter(h => h <= 23).map(h => String(h).padStart(2, '0') + ':00');
    fillSlots(sl.length ? sl : ['23:30'], true);
    setUMode('hour');
    pickUntil('hour');
    changed();
    toast('Сегодня, решаем за час ✓');
  }
  /* «Собрать снова»: тот же состав, даты на неделю позже, старый срок не переносим */
  function shiftWeek(inv) {
    const d = inv && inv.dates;
    if (!isObj(d)) return inv;
    const plus = s => { const t = K.parseYmd(s); return t ? K.ymd(K.addDays(t, 7)) : s; };
    if (Array.isArray(d.list)) d.list = d.list.map(plus);
    if (d.start) d.start = plus(d.start);
    delete inv.until;
    return inv;
  }
  function groupOpts() {
    const out = [];
    state.gsel.forEach(id => {
      if (K.planById(id)) out.push({ plan: id });
      else if (evAlive(evById(id))) out.push({ event: id });
    });
    return out.concat(readList('opts'));
  }
  /* all = true — для черновика: все поля обоих режимов и служебные _поля; иначе — ровно то, что пойдёт в ссылку */
  function readForm(all) {
    const v = id => $('#' + id).value.trim();
    const dmode = ($('input[name="dmode"]:checked') || {}).value || 'next';
    const inv = {
      me: v('me') || FALLBACK.me, catName: v('catName') || 'Мурчик',
      cat: state.cat, theme: state.theme,
      // пустой текст — стандартный текст режима (иначе котик промолчит)
      greeting: v('greeting') || modeDefault(state.mode, 'greeting'), question: v('question') || modeDefault(state.mode, 'question'),
      levels: readLevels(),
      heartsGoal: Math.max(3, Math.min(50, parseInt(v('heartsGoal'), 10) || 12)),
      noButton: v('noButton'),
      dates: {
        mode: dmode,
        start: dmode === 'next' ? v('dStart') : '',
        days: Math.max(1, Math.min(60, parseInt(v('dDays'), 10) || 14)),
        skipWeekdays: $$('#weekdays input').filter(c => !c.checked).map(c => +c.value),
        list: dmode === 'list' ? $$('#dates .dt').map(i => i.value).filter(Boolean) : [],
      },
    };
    const dateFields = () => ({
      her: v('her') || FALLBACK.her, signature: v('signature'), finale: v('finale'),
      places: readList('places'),
      placeSurprise: $('#placeSurprise').checked,
      placeCustom: $('#placeCustom').checked,
      dateOther: $('#dateOther').checked,
      time: readTime(),
      food: readList('food'),
    });
    if (isGroup()) {
      // в компании «Не смогу» всегда можно нажать — иначе тот, кто не придёт, не сможет об этом сказать
      inv.noButton = 'real';
      // стандартные тексты режима не кладём в ссылку — игра подставит их сама
      if (inv.greeting === MC().greeting) inv.greeting = DEF.greeting;
      if (inv.question === MC().question) inv.question = DEF.question;
      Object.assign(inv, { mode: state.mode, title: v('title') || MC().title, opts: groupOpts() });
      const sl = readSlots(), until = readUntil();
      if (sl.length) inv.slots = sl;
      if (until) inv.until = until;
    } else {
      Object.assign(inv, dateFields());
      if (state.who === 'm') inv.who = 'm';
      const ev = curEvent();
      if (ev && evAlive(ev)) {
        inv.event = ev.id;
        // без «других мест» шариков нет: только событие
        if (!state.evOther) Object.assign(inv, { places: [], placeSurprise: false, placeCustom: false });
        // дни и время берутся из афиши — свои настройки в ссылку не кладём (короче ссылка; в черновике они остаются)
        if (!state.evOther && !all) {
          inv.dates = DEF.dates;
          if (ev.time) inv.time = DEF.time;
          if (evDays(ev).length === 1) inv.dateOther = DEF.dateOther;
        }
      }
    }
    const tgu = K.tgUser(v('tgu'));
    if (tgu) inv.tgu = tgu;
    if (tgReady()) inv.tg = TG.c;
    if (all) {
      Object.assign(inv, dateFields());
      // имена — как в полях, пустые тоже
      inv.her = v('her'); inv.me = v('me');
      delete inv.event;
      if (state.who === 'm') inv.who = 'm';
      inv.title = v('title');
      if (!isGroup()) {
        const g = state.gselBy[state.lastGroup];
        inv.opts = (g ? g.sel : []).map(id => (K.planById(id) ? { plan: id } : { event: id })).concat(readList('opts'));
      }
      inv._group = state.lastGroup;
      inv._opts = {};
      const ob = Object.assign({}, state.optsBy, { [state.lastGroup]: readList('opts') });
      ['guys', 'girls'].forEach(m => { if (ob[m]) inv._opts[m] = ob[m]; });
      inv.noButton = $('#noButton').value;
      inv._no = $('#noButton').value;
      inv._mode = state.mode;
      inv._texts = Object.assign({}, state.texts);
      delete inv._texts[state.mode];
      inv._levels = Object.assign({}, state.levels, { [kindOf(state.mode)]: readLevels() });
      const by = Object.assign({}, state.gselBy);
      if (isGroup()) by[state.mode] = { sel: Array.from(state.gsel), auto: state.autoSel };
      inv._gsel = {}; inv._auto = {};
      ['guys', 'girls'].forEach(m => { if (by[m]) { inv._gsel[m] = by[m].sel; inv._auto[m] = !!by[m].auto; } });
      inv._event = state.event;
      inv._evOther = state.evOther;
      inv._slots = $$('#slotEd .slot-in').map(el => el.value);
      inv._slotAsk = $('#slotAsk').checked;
      inv._umode = uMode();
      inv._until = $('#untilAt').value;
      delete inv.slots; delete inv.until;
    }
    return inv;
  }

  /* Обращаться «к ней» или «к нему»: от этого зависят окончания в игре и уведомлениях */
  function renderWho() {
    $$('#who [data-who]').forEach(b => { const on = b.dataset.who === state.who; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  }
  function renderSwatches() {
    $('#cats').innerHTML = Object.keys(K.CATS).map(c =>
      `<button type="button" class="sw ${c === state.cat ? 'on' : ''}" data-cat="${c}" aria-pressed="${c === state.cat}" style="${K.catVars(c)}">${K.catSVG('normal')}${CAT_NAMES[c]}</button>`).join('');
    $('#themes').innerHTML = K.THEMES.map(t =>
      `<button type="button" class="sw ${t === state.theme ? 'on' : ''}" data-theme="${t}" aria-pressed="${t === state.theme}"><div class="theme-dot" style="--dot:${THEME_INFO[t][1]}"></div>${THEME_INFO[t][0]}</button>`).join('');
  }
  function syncDateMode() {
    const mode = ($('input[name="dmode"]:checked') || {}).value;
    $('#dNext').classList.toggle('hidden', mode === 'list');
    $('#dList').classList.toggle('hidden', mode !== 'list');
  }
  const fmtDM = s => { const d = K.parseYmd(s); return d.getDate() + '.' + String(d.getMonth() + 1).padStart(2, '0'); };
  function dateInfo(inv) {
    const box = $('#dateInfo');
    if (isGroup()) {
      // все варианты — события: дни для голосования игра возьмёт из афиши
      const evs = (inv.opts || []).filter(o => o.plan || o.event || o.title);
      if (evs.length && evs.every(o => o.event)) {
        const days = Array.from(new Set([].concat(...evs.map(o => evDays(evById(o.event)))))).sort();
        const lead = evs.length === 1 ? 'Голосуем за событие' : 'Все варианты — события';
        box.textContent = days.length ? `${lead}, поэтому дни для голосования возьмём из афиши: ${days.slice(0, 5).map(dayShort).join(', ')}${days.length > 5 ? ` и ещё ${days.length - 5}` : ''}.` : '';
        return;
      }
    }
    const days = K.listDates(inv.dates);
    if (!days.length) { box.textContent = 'Сейчас не получится ни одного дня — выбор дня будет пропущен или заменён полем «напиши, когда удобно».'; return; }
    const n = days.length;
    box.textContent = `В календаре будет ${n} ${plural(n, 'день', 'дня', 'дней')}: ${fmtDM(days[0])} — ${fmtDM(days[n - 1])}` +
      (inv.dates.mode === 'next' && !inv.dates.start ? ' (считается от дня, когда откроют ссылку)' : '');
  }
  function timeInfo() {
    const from = $('#tFrom').value || '12:00', to = $('#tTo').value || '22:00', def = $('#tDef').value || '19:00';
    const box = $('#timeInfo');
    box.classList.remove('warn');
    if (K.toMin(from) === K.toMin(to)) {
      box.textContent = `«С» и «До» совпадают — в игре будет час: с ${from} до ${K.fromMin(K.toMin(from) + 60)}. Поставь конец позже начала.`;
      box.classList.add('warn');
      return;
    }
    const night = K.toMin(to) < K.toMin(from);
    let t = night ? `Окно через полночь: с ${from} до ${to} следующего дня.` : 'Можно и через полночь: например, с 22:00 до 02:00.';
    if (!inWindow(def, from, to)) { t += ` «Сначала» (${def}) не входит в окно — слайдер начнётся с ${from}.`; box.classList.add('warn'); }
    box.textContent = t;
  }

  /* ---------- ссылка: всегда по текущей форме ----------
     Код считаем сразу при каждом изменении (сжатие — доли миллисекунды), а «Скопировать», «Поделиться»
     и «Открыть» дожидаются именно его: в чат не уйдёт ссылка на прошлое состояние формы. */
  function baseUrl() {
    const u = new URL('index.html', location.href);
    return /^https?:$/.test(u.protocol) ? u.href.replace(/index\.html$/, '') : u.href;
  }
  const L = { sig: null, ready: Promise.resolve(''), code: '', codeSig: null, vfor: '', vraw: null, vsuf: '', vready: Promise.resolve('') };
  function syncCode() {
    const diff = K.diffInvite(readForm(), DEF);
    const sig = JSON.stringify(diff);
    if (sig !== L.sig) {
      L.sig = sig;
      const p = L.ready = K.encodeInvite(diff).then(c => { if (L.ready === p) { L.code = c; L.codeSig = sig; } return c; });
    }
    return L.ready;
  }
  /* Голоса компании, которые этот браузер уже видел (свой голос создателя в том числе), — в ссылку &v=,
     чтобы друзья сразу видели их даже без сервера. Хранит игра: localStorage kuda-votes:<INV_ID>. */
  const votesKey = code => 'kuda-votes:' + K.hash(code);
  function cleanVotes(arr) {
    return (Array.isArray(arr) ? arr : []).filter(v => v && typeof v.id === 'string' && v.id.length <= 12).map(v => ({
      id: v.id, n: String(v.n || '?').slice(0, 30), y: v.y ? 1 : 0,
      o: (Array.isArray(v.o) ? v.o : []).filter(Number.isInteger).slice(0, 20),
      d: (Array.isArray(v.d) ? v.d : []).filter(Number.isInteger).slice(0, 60),
      t: +v.t || 0,
    })).sort((a, b) => a.t - b.t).slice(-60);
  }
  const storedVotes = code => { let raw = ls.get(votesKey(code)) || ''; let v = []; try { v = JSON.parse(raw || '[]'); } catch (e) { raw = ''; } return { raw, list: cleanVotes(Array.isArray(v) ? v : v && v.votes) }; };
  function syncVotes() {
    if (!isGroup() || !L.code) { L.vfor = L.code; L.vraw = null; L.vsuf = ''; return (L.vready = Promise.resolve('')); }
    const code = L.code, { raw, list } = storedVotes(code);
    if (code === L.vfor && raw === L.vraw) return L.vready;
    L.vfor = code; L.vraw = raw;
    if (!list.length) { L.vsuf = ''; return (L.vready = Promise.resolve('')); }
    L.vsuf = null;   // считается
    const p = L.vready = K.encodeData(list).then(d => { if (L.vready === p) L.vsuf = '&v=' + d; return L.vsuf || ''; }, () => { if (L.vready === p) L.vsuf = ''; return ''; });
    return p;
  }
  /* Синхронно: ссылка уже соответствует форме и голосам? */
  function isFresh() {
    syncCode();
    if (L.codeSig !== L.sig) return false;
    syncVotes();
    return L.vsuf !== null;
  }
  const bareLink = () => baseUrl() + '#' + L.code;
  const realLink = () => bareLink() + (isGroup() && L.vfor === L.code && L.vsuf ? L.vsuf : '');
  async function freshLink() {
    await syncCode();
    await syncVotes();
    return realLink();
  }
  const previewLink = step => bareLink() + '&p=1' + (step ? '&s=' + step : '');

  function pvSteps(inv) {
    const on = inv.levels || {};
    let lv;
    if (isGroup()) {
      lv = [];
      if (on.hearts !== false) lv.push('🎮');
      lv.push(state.mode === 'guys' ? '✉️' : '💌');
      if ((inv.opts || []).length) lv.push('🗳');
      if (on.date !== false) lv.push('📅');
    } else {
      const ev = inv.event ? evById(inv.event) : null;
      lv = LEVELS.date.filter(([id]) => on[id] !== false &&
        !(id === 'food' && !(inv.food || []).length) &&
        !(id === 'place' && !ev && !(inv.places || []).length && !inv.placeCustom && !inv.placeSurprise) &&
        !(id === 'date' && ev && evDays(ev).length === 1) &&
        !(id === 'time' && ev && ev.time)).map(l => l[1].split(' ')[0]);
    }
    const items = [['Старт', 0]].concat(lv.map((e, i) => [String(i + 1) + ' ' + e, i + 1]), [[isGroup() ? '📊 Финал' : '🎫 Финал', lv.length + 1]]);
    if (pvStep > lv.length + 1) pvStep = 0;
    $('#pvSteps').innerHTML = items.map(([t, s]) => `<button type="button" data-step="${s}" class="${s === pvStep ? 'on' : ''}" aria-pressed="${s === pvStep}">${t}</button>`).join('');
  }
  /* Превью перезагружаем, только если поменялись код или шаг: иначе игра мигает на каждую паузу в наборе */
  function reloadPreview(force) {
    if (!L.code || getComputedStyle($('.preview')).display === 'none') return;
    const key = L.code + '|' + pvStep;
    if (!force && key === pvShown) return;
    pvShown = key;
    $('#pv').src = 'index.html?pv=' + (++pvCounter) + '#' + L.code + '&p=1' + (pvStep ? '&s=' + pvStep : '');
  }

  const saveDraft = () => ls.set(DRAFT, JSON.stringify(readForm(true)));
  /* Изменение формы: код — сразу, остальное — после паузы в наборе */
  function changed() { syncCode(); refreshSoon(); }
  async function refresh() {
    saveDraft();
    syncName();
    const inv = readForm();
    dateInfo(inv);
    timeInfo();
    pvSteps(inv);
    renderPicker();
    $('#foodInfo').classList.toggle('hidden', !!readList('food').length || !$('#lv-food') || !$('#lv-food').checked);
    $('#tgOn').classList.toggle('hidden', !K.tgUser($('#tgu').value) && !tgReady());
    const long = await freshLink();
    if (long !== realLink()) return;   // форма успела поменяться — допишет следующий вызов
    $('#link').value = shortOf[long] || long;
    linkInfo(long);
    reloadPreview();
    if (resultSeen && !shortP[long]) shortSoon(long);
    renderSelfVote();
  }
  const refreshSoon = debounce(refresh, 350);

  /* Короткие ссылки. Сокращаем не после каждой паузы в наборе (иначе в сервисе копятся сотни черновиков),
     а когда блок со ссылкой на экране или нажаты «Скопировать»/«Поделиться». Готовая короткая ссылка
     нужна заранее: на iPhone «Поделиться» не открывается, если перед ним ждали ответа сети. */
  const shortOf = {}, shortP = {};
  let resultSeen = false;
  function prepareShort(long) {
    if (!long || !L.code) return Promise.resolve(long || '');
    if (shortP[long]) return shortP[long];
    // K.shortLink: свой сервер (go.html#s=…), посредник, clck.ru — по очереди
    shortP[long] = K.shortLink(long).then(short => {
      shortOf[long] = short;
      if (realLink() === long) { $('#link').value = short; linkInfo(long); }
      return short;
    }, () => long);
    linkInfo(long);
    return shortP[long];
  }
  const prefetchShort = () => { if (isFresh()) prepareShort(realLink()); else freshLink().then(prepareShort); };
  function linkInfo(long) {
    const short = shortOf[long];
    $('#linkLen').textContent = short ? (short !== long ? 'Короткая ссылка готова — её удобно кинуть в чат'
      : long.length > 100 ? `Длина ссылки: ${long.length} символов — сервис коротких ссылок сейчас недоступен` : `Длина ссылки: ${long.length} символов`)
      : shortP[long] ? 'Сокращаем ссылку…' : 'Ссылку сократим, когда нажмёшь «Скопировать» или «Поделиться»';
  }
  /* Пока блок со ссылкой на экране, сокращаем после паузы подольше: не плодим короткие ссылки на каждую букву */
  const shortSoon = debounce(long => { if (resultSeen && realLink() === long) prepareShort(long); }, 2000);
  /* Копируем короткую ссылку на текущее состояние формы */
  function copyCurrent() {
    if (isFresh()) {
      const long = realLink();
      if (shortOf[long]) return copyText(shortOf[long]);
    }
    return copyLater(freshLink().then(prepareShort));
  }

  /* ---------- голос создателя (компания) ---------- */
  function myVote() {
    if (!isGroup() || !L.code) return null;
    const { list } = storedVotes(L.code);
    const me = ls.get('kuda-voter:' + K.hash(L.code));
    return { list, mine: me ? list.find(v => v.id === me) || null : null };
  }
  /* Последнее приглашение, где создатель уже проголосовал: поменял форму после этого — ссылка новая, голос нужен заново */
  const VOTED = 'kuda-cr-voted';
  /* «Отметься сам» / «сама»: девичник обычно собирает девушка */
  const selfWord = () => (state.mode === 'girls' ? 'сама' : 'сам');
  /* Имя организатора — в kuda-name при каждом изменении поля «Твоё имя»: игра подставит его, когда он сам
     отметится в голосовании (туда же игра пишет имя, введённое в ней). Поле очистили — возвращаем прежнее имя
     (записанное не нами: игрой или в прошлый визит), а не оставляем недописанное. */
  const NAME = 'kuda-name';
  // «Твой друг» — запасное имя (поле было пустым, приглашение загрузили в форму), а не имя человека
  const fieldName = () => { const v = $('#me').value.trim().slice(0, 30); return v === FALLBACK.me ? '' : v; };
  let name0 = null, nameMine = null, nameSeen = null;   // прежнее имя · что записали мы · значение поля при записи
  /* force = false — только если имени ещё нет: при запуске в kuda-name может быть имя новее черновика */
  function saveName(force) {
    const me = fieldName(), cur = ls.get(NAME);
    nameSeen = me;
    if (cur !== nameMine) name0 = cur;
    if (me) { if (force || !cur) { if (cur !== me) ls.set(NAME, me); nameMine = me; } }
    else if (force && nameMine !== null) { if (name0) ls.set(NAME, name0); else ls.del(NAME); nameMine = null; }
  }
  /* Поле поменялось (набор, черновик, «В форму», сброс) — пишем; иначе не трогаем имя, которое могла записать игра */
  const syncName = () => { if (fieldName() !== nameSeen) saveName(true); };
  function renderSelfVote() {
    const group = isGroup();
    const st = group ? myVote() : null;
    const voted = !!(st && st.mine);
    if (group) {
      const others = st ? st.list.filter(v => v !== st.mine).length : 0;
      const n = voted ? st.mine.o.length : 0;
      let last = null;
      try { last = JSON.parse(sessionStorage.getItem(VOTED) || 'null'); } catch (e) { last = null; }
      if (voted && L.code && (!last || last.code !== L.code)) {
        try { sessionStorage.setItem(VOTED, JSON.stringify({ code: L.code, mode: state.mode })); } catch (e) { /* ок */ }
      }
      const stale = !voted && last && last.code !== L.code && last.mode === state.mode;
      $('#svText').textContent = voted
        ? (st.mine.y ? `✓ Твой голос уже в ссылке: ${n ? `за ${n} ${plural(n, 'вариант', 'варианта', 'вариантов')}` : 'подойдёт любой вариант'}. Друзья увидят его сразу.` : '✓ В ссылке отмечено, что ты не сможешь.') +
          (others ? ` Ещё голосов в ссылке: ${others}.` : '')
        : (stale ? 'Приглашение изменилось после твоего голоса — это уже новая ссылка. Отметься в ней ещё раз, чтобы друзья видели твой выбор.'
          : `Сначала отметься ${selfWord()}: пройди игру и проголосуй — твой голос попадёт в ссылку, и друзья сразу увидят, куда ты хочешь.`) +
          (others ? ` В ссылке уже голосов: ${others}.` : '');
      $('#vote span').textContent = voted ? 'Изменить свой голос' : `Сначала отметься ${selfWord()}`;
      const mb = $('#mbVote span');
      if (mb) mb.textContent = `Отметься ${selfWord()}`;
    }
    $('#vote').classList.toggle('primary', group && !voted);
    $('#copy').classList.toggle('primary', !group || voted);
    $('#mbVote').classList.toggle('hidden', !group || voted);
    $('#mbPv').classList.toggle('hidden', group && !voted);
    $('#mbCopy').classList.toggle('primary', !group || voted);
    $('#mbCopy span').textContent = group && !voted ? 'Копировать' : 'Скопировать ссылку';
  }

  /* ---------- история и регистрация на сервере ---------- */
  function histList() { const l = readJson(HIST, []); return Array.isArray(l) ? l.filter(x => x && (x.code || x.link)) : []; }
  const saveHist = list => ls.set(HIST, JSON.stringify(list.slice(0, HIST_MAX)));
  const histCode = x => x.code || K.readHash('#' + (String(x.link || '').split('#')[1] || '')).code;
  function patchHist(code, patch) {
    const list = histList();
    const x = list.find(y => histCode(y) === code);
    if (!x) return;
    Object.assign(x, patch);
    saveHist(list);
  }
  function ownerSecret() {
    let s = ls.get(OWNER_SECRET) || '';
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(s)) {
      const b = new Uint8Array(18);
      try { crypto.getRandomValues(b); } catch (e) { for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256); }
      s = K.toB64url(b);   // 24 символа
      ls.set(OWNER_SECRET, s);
    }
    return s;
  }
  function markOwn(code) {
    const id = K.hash(code);
    const own = readJson(OWN, []);
    const list = (Array.isArray(own) ? own : []).filter(x => x !== id);
    list.push(id);
    ls.set(OWN, JSON.stringify(list.slice(-300)));
  }
  /* Регистрируем приглашение на своём сервере один раз: «Мои приглашения» покажут, открыли ли и что ответили */
  function registerInvite(x) {
    const api = API();
    if (!api || !x || x.reg) return;
    api.invite(x.code, ownerSecret(), { mode: x.mode, title: x.title, until: x.until, city: x.city, ref: x.ref }).then(ok => {
      if (ok) patchHist(x.code, { reg: 1 });
      else if (api.lastError === 'taken') patchHist(x.code, { reg: -1 });
    });
  }
  function remember() {
    const code = L.code;
    if (!code) return;
    const inv = readForm();
    const group = isGroup();
    const title = group ? inv.title : inv.her;
    const link = bareLink();
    const list = histList();
    const old = list.find(x => histCode(x) === code);
    const now = Date.now();
    const x = Object.assign({}, old || {}, {
      code, link, mode: state.mode, title,
      label: group ? `${MC().emoji} ${title}` : title,
      at: old && old.at ? old.at : now, upd: now,
    });
    if (inv.event) x.ev = inv.event; else delete x.ev;
    // город — если в приглашении есть что-то из каталога («Мои приглашения» подпишут петербургские)
    const city = firstCity([inv.event].concat((inv.places || []).map(p => p && p.plan), (inv.opts || []).map(o => o && (o.plan || o.event))).filter(Boolean));
    if (city) x.city = city; else delete x.city;
    if (inv.until) x.until = inv.until; else delete x.until;
    if (REF && !x.ref) x.ref = REF;
    saveHist([x].concat(list.filter(y => histCode(y) !== code)));
    markOwn(code);
    renderHist();
    registerInvite(x);
    if (tgReady()) registerIds([K.hash(code)]);
    // в историю — короткая ссылка без голосов (голоса добавим при копировании оттуда)
    if (shortOf[link] && shortOf[link] !== link) patchHist(code, { short: shortOf[link] });
    else if (realLink() === link) prepareShort(link).then(s => { if (s && s !== link) patchHist(code, { short: s }); });
  }
  /* Модель «Для тебя» учится на том, куда зовут: передаём выбранные планы и места (только при отправке) */
  function trackInvite() {
    const picked = isGroup() ? Array.from(state.gsel) : $$('#places .li[data-plan]').map(r => r.dataset.plan);
    if (window.KudaTrack) window.KudaTrack.invited(picked.filter(id => K.planById(id)), state.mode);
  }
  /* Ссылка из истории: голоса, которые браузер видел, + короткая, если готова */
  async function histLink(x) {
    const code = histCode(x);
    const { list } = storedVotes(code);
    const long = (x.link || baseUrl() + '#' + code) + (list.length && x.mode && x.mode !== 'date' ? '&v=' + await K.encodeData(list) : '');
    if (long === x.link && x.short) return x.short;
    const s = await K.shortLink(long);
    if (long === x.link && s !== long) patchHist(code, { short: s });
    return s;
  }
  const HIST_SHOW = 5;
  function renderHist() {
    const list = histList();
    const fmt = t => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    // город подписываем, если приглашения в разных городах или город не Москва
    const cities = new Set(list.map(x => (okCity(x.city) ? x.city : 'msk')));
    const cityLabel = x => (okCity(x.city) && (x.city !== 'msk' || cities.size > 1) ? ' · ' + K.CITIES[x.city].name : '');
    $('#hist').innerHTML = list.length ? list.slice(0, HIST_SHOW).map((x, i) => {
      const name = x.title || x.label || x.her || 'Приглашение';
      const shown = x.mode ? `${K.MODES[okMode(x.mode) ? x.mode : 'date'].emoji} ${x.title || x.label || 'Приглашение'}` : (x.label || x.her || 'Приглашение');
      return `
      <div class="hist-item">
        <b>${esc(shown)}<small>${esc(fmt(x.at || 0) + cityLabel(x))}</small></b>
        <button class="btn" type="button" data-h="copy" data-i="${i}">Копировать</button>
        <button class="btn" type="button" data-h="load" data-i="${i}">В форму</button>
        <button class="btn" type="button" data-h="del" data-i="${i}" aria-label="Удалить «${esc(name)}» из списка">${K.icon('x')}</button>
      </div>`;
    }).join('') + (list.length > HIST_SHOW ? `<a class="hist-more" href="invites.html">Ещё ${list.length - HIST_SHOW} — в «Моих приглашениях»</a>` : '')
      : '<p class="hint">Пока пусто.</p>';
    $('#hist')._list = list;
  }

  /* ---------- Telegram (через посредника, только для владельца) ---------- */
  const relayUrl = () => (CFG.telegram || {}).relayUrl || '';
  const ownerKey = () => ls.get(OWNER) || '';
  /* Ключ подходит, только если посредник его принял: с неверным ключом уведомления не подключаются */
  const keyOk = () => !!ownerKey() && ls.get(OWNER_OK) === ownerKey();
  /* Секрет создателя (s) и его отпечаток (c = SHA-256, 12 символов) — считаем один раз при запуске.
     Без crypto.subtle (страница открыта не по https) ответы в Telegram не подключаются. */
  const TG = { s: '', c: '' };
  const tgReady = () => !!(relayUrl() && keyOk() && TG.c);
  async function creatorProof() {
    try {
      let s = ls.get(CREATOR) || '';
      if (!/^[A-Za-z0-9_-]{22,64}$/.test(s)) {
        const b = new Uint8Array(18);
        crypto.getRandomValues(b);
        s = K.toB64url(b);
        ls.set(CREATOR, s);
      }
      const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('kuda-tg|' + s)));
      TG.s = s; TG.c = K.toB64url(d).slice(0, 12);
    } catch (e) { TG.s = TG.c = ''; }
  }
  /* Ответ посредника: { ok, error } — 'key' ключ не подошёл, 'rate' слишком часто, 'net' нет связи */
  function registerIds(ids) {
    if (!relayUrl() || !ownerKey()) return Promise.resolve({ ok: false, error: 'off' });
    return K.relayRegister(relayUrl(), ownerKey(), TG.s ? ids : [], TG.s);
  }
  const histIds = () => histList().map(histCode).filter(Boolean).map(K.hash).slice(0, 40);
  const registerHistory = () => registerIds(histIds());
  /* Раз в день продлеваем срок хранения своих приглашений у бота (иначе через 90 дней без ответов их забудут) */
  function renewHistory() {
    const day = String(Math.floor(Date.now() / 864e5));
    if (!relayUrl() || !keyOk() || !TG.s || ls.get(RENEW) === day || !histIds().length) return;
    registerHistory().then(j => { if (j.ok) ls.set(RENEW, day); });
  }
  const relayError = j => j.error === 'net' ? 'Не удалось связаться с ботом — проверь интернет'
    : j.error === 'rate' ? 'Слишком часто — попробуй через несколько минут'
      : j.error === 'busy' ? 'Бот сейчас занят — попробуй ещё раз через минуту' : 'Ключ не подошёл — проверь его';
  /* Проверяем ключ у посредника. Неверный ключ стираем, сеть подвела — оставляем и проверим позже */
  function verifyKey(quiet) {
    const key = ownerKey();
    if (!key || !relayUrl()) return Promise.resolve();
    return registerHistory().then(j => {
      if (ownerKey() !== key) return;
      if (j.ok) { ls.set(OWNER_OK, key); if (!quiet) toast('Ключ подошёл ✓ Уведомления будут приходить на приглашения, которые ты отправишь отсюда'); }
      else if (j.error === 'key' || j.error === 'secret') { ls.del(OWNER); ls.del(OWNER_OK); if (!quiet) toast(relayError(j)); tgError = true; }
      else if (!quiet) toast(relayError(j) + ' — проверим ключ ещё раз позже');
      tgStatus();
      changed();
    });
  }
  let tgError = false;
  function tgStatus() {
    const url = relayUrl(), key = ownerKey();
    $('#relayBox').classList.toggle('hidden', !url);
    const el = $('#tgStatus');
    el.className = 'status' + (keyOk() ? ' ok' : tgError ? ' err' : '');
    el.textContent = keyOk() ? '✓ Ключ подошёл. Уведомления будут приходить в Telegram на приглашения, которые ты скопируешь или отправишь отсюда.'
      : key ? 'Ключ ещё не проверен — проверим, как только бот ответит.'
        : tgError ? 'Ключ не подошёл, мы его не сохранили. Проверь его в сообщении от бота.'
          : 'Получи ключ у нашего бота — и уведомления о твоих приглашениях будут приходить в Telegram.';
    $('#tgTest').disabled = !keyOk();
    if ($('#ownerKey') !== document.activeElement) $('#ownerKey').value = key;
    const bot = K.tgUser((CFG.telegram || {}).bot);
    $('#keyHow').classList.toggle('hidden', !bot);
    if (bot) { $('#botLink').href = 'https://t.me/' + bot + '?start=key'; $('#botLink').textContent = '@' + bot; }
    // без посредника здесь только ник: кнопка «Написать в Telegram» в конце игры, а не уведомления
    $('#tgTitle').textContent = url ? 'Уведомления в Telegram' : 'Ответ в Telegram';
    $('#tgHint').textContent = API() ? 'Ответы и голоса и так видны в «Моих приглашениях» — Telegram нужен, только если тебе так удобнее.'
      : 'Без ника ответ всё равно дойдёт: в конце игры человек отправит тебе ссылку-билет в любом мессенджере.';
    $('#tgOn').classList.toggle('hidden', !K.tgUser($('#tgu').value) && !keyOk());
  }
  async function tgTest() {
    const j = await K.relayTest(relayUrl(), ownerKey());
    toast(j.ok ? 'Отправлено — проверь Telegram ✓' : relayError(j));
  }

  /* ---------- эмодзи-панель ---------- */
  let emojiTarget = null;
  function initEmojiBar() {
    const bar = $('#emojiBar');
    bar.innerHTML = EMOJIS.map(e => `<button type="button" aria-label="${e}">${e}</button>`).join('');
    bar.addEventListener('pointerdown', e => e.preventDefault());
    bar.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || !emojiTarget) return;
      emojiTarget.value = b.textContent;
      emojiTarget.dispatchEvent(new Event('input', { bubbles: true }));
      bar.classList.add('hidden');
      emojiTarget.blur();
    });
    document.addEventListener('focusin', e => {
      if (e.target.classList && e.target.classList.contains('em')) { emojiTarget = e.target; bar.classList.remove('hidden'); }
    });
    document.addEventListener('focusout', e => {
      if (e.target === emojiTarget) setTimeout(() => { if (document.activeElement !== emojiTarget) bar.classList.add('hidden'); }, 120);
    });
  }

  /* ---------- приход с главной и из афиши: ?mode=guys&plan=g-sanduny, ?event=ev-…&mode=date ---------- */
  const isDefaultPlaces = () => {
    const cur = readList('places');
    return !cur.length || (cur.length === DEF.places.length && cur.every((p, i) => !p.plan && p.title === DEF.places[i].title && p.emoji === DEF.places[i].emoji));
  };
  function applyUrlParams() {
    const q = new URLSearchParams(location.search);
    const m = q.get('mode'), planId = q.get('plan'), evId = q.get('event'), qc = q.get('city');
    if (!m && !planId && !evId && !qc) return;
    history.replaceState(null, '', 'create.html' + location.hash);
    // город: у плана или события из ссылки — их город, иначе ?city=. Переключаем до режима:
    // подборки по умолчанию для голосования берутся уже из нужного города
    const item = planId && K.planById(planId) ? planId : evId && evById(evId) ? evId : '';
    const c = (item && itemCity(item)) || (okCity(qc) ? qc : '');
    if (c && !switchCity(c, { save: true, quiet: true })) K.setCity(c);
    if (okMode(m)) switchMode(m);
    if (evId) {
      const ev = evById(evId);
      if (!evAlive(ev)) { toast(ev ? 'Это событие уже прошло — выбери другое во вкладке «События»' : 'Такого события нет в афише — выбери другое во вкладке «События»'); pk.tab = 'events'; renderPicker(); return; }
      if (!isGroup()) { setEvent(ev.id); toast(`Зовём на «${ev.title}» ✓`); }
      else {
        // свежая форма — голосуем только за событие (дни игра возьмёт из афиши); есть свой выбор — добавляем к нему
        const sel = state.autoSel ? new Set() : new Set(state.gsel);
        if (sel.size >= MAX_OPTS) sel.delete(Array.from(sel).pop());
        sel.add(ev.id);
        state.gsel = sel; state.autoSel = false;
        pk.tab = 'events';
        toast(`Добавил «${ev.title}» в голосование ✓`);
      }
      pinNow();
      renderPicker();
      changed();
      return;
    }
    const pl = planId ? K.planById(planId) : null;
    if (!pl) return;
    if (pl.mode && pl.mode !== state.mode) switchMode(pl.mode);
    if (state.mode === 'date') {
      // стандартные шарики (кофейня, кино…) заменяем выбранным — иначе он теряется среди них
      if (isDefaultPlaces()) $('#places').innerHTML = '';
      if (!$(`#places .li[data-plan="${CSS.escape(pl.id)}"]`)) $('#places').insertAdjacentHTML('afterbegin', itemRow({ plan: pl.id }, 'places'));
      if (state.event) { state.evOther = true; renderEventUi(); }
      const lv = $('#lv-place');
      if (lv) lv.checked = true;
    } else {
      const sel = new Set([pl.id].concat(state.autoSel ? [] : Array.from(state.gsel)));
      K.kuda().scenarios.filter(s => !sel.has(s.id) && pkPlanOk(s, state.mode)).slice(0, Math.max(0, 3 - sel.size)).forEach(s => sel.add(s.id));
      state.gsel = sel; state.autoSel = false;
    }
    pinNow();
    renderPicker();
    toast(pl.single ? `Добавил место «${pl.title}» ✓` : `Добавил план «${pl.title}» ✓`);
    changed();
  }
  /* «В конструктор» из «Мои приглашения»: create.html#from=<код> — копия приглашения в форме */
  async function applyHashLoad() {
    const m = /^#(from|again)=([A-Za-z0-9_-]{2,4000})$/.exec(location.hash);
    if (!m) return false;
    history.replaceState(null, '', 'create.html' + location.search);
    try {
      const inv = await K.decodeInvite(m[2]);
      const again = m[1] === 'again';
      const r = fillForm(again ? shiftWeek(inv) : inv);
      toast(r.pastEvent ? 'Загрузил в форму. Событие уже прошло — выбери другое' : again ? 'Тот же состав, даты на неделю позже ✓' : 'Загрузил приглашение в форму ✓');
      changed();
      return true;
    } catch (e) { toast('Не удалось прочитать приглашение'); return false; }
  }

  /* ---------- запуск ---------- */
  function openGame(link) {
    // окно открываем сразу (иначе браузер заблокирует), ссылку подставляем, когда она готова
    if (isFresh()) { window.open(link ? link() : realLink(), '_blank'); remember(); return; }
    const w = window.open('', '_blank');
    freshLink().then(() => { remember(); const l = link ? link() : realLink(); if (w && !w.closed) w.location.href = l; else location.href = l; });
  }
  function openPreview(step) {
    if (isFresh()) { window.open(previewLink(step), '_blank'); return; }
    const w = window.open('', '_blank');
    freshLink().then(() => { const l = previewLink(step); if (w && !w.closed) w.location.href = l; else location.href = l; });
  }
  /* Скопировать не вышло (старый браузер, запрет буфера) — показываем поле со ссылкой и выделяем её */
  function showLink() {
    const el = $('#link');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    try { el.focus({ preventScroll: true }); el.setSelectionRange(0, el.value.length); } catch (e) { /* ок */ }
    toast('Не получилось скопировать — ссылка выделена, скопируй её вручную');
  }
  function doCopy() {
    const group = isGroup();
    const voted = !!(myVote() || {}).mine;
    copyCurrent().then(ok => (!ok ? showLink() : toast(group
      ? (voted ? 'Ссылка скопирована — кидай в общий чат 💬' : `Ссылка скопирована 💬 Не забудь отметиться ${selfWord()}`)
      : 'Ссылка скопирована 💌 Отправь её!')));
    freshLink().then(() => { remember(); trackInvite(); });
    if (!shortOf[realLink()]) toast('Сокращаем ссылку…');
  }

  function init() {
    // название сайта — из config.js (site.name), как на главной
    if (CFG.site && CFG.site.name) { const b = $('.back span'); if (b) b.textContent = CFG.site.name; }
    $('#weekdays').innerHTML = WEEK.map(([n, t]) => `<label class="chip"><input type="checkbox" value="${n}"><span>${t}</span></label>`).join('');

    let draft = null;
    try { OLD_DRAFTS.forEach(k => localStorage.removeItem(k)); } catch (e) { /* ок */ }
    draft = readJson(DRAFT, null);
    if (!isObj(draft)) draft = null;
    const r = fillForm(draft || {});
    if (!draft) { $('#her').value = ''; $('#me').value = ''; }   // имена из config.js — только пример, форма начинается пустой
    if (r.pastEvent) toast('Событие из черновика уже прошло — убрал его');
    const user = window.KudaAuth && window.KudaAuth.user && window.KudaAuth.user();
    if (user && user.name && user.name !== 'Ты' && !$('#me').value.trim()) $('#me').value = user.name;
    saveName(false);   // имя из черновика или входа — только если игра ещё не знает имени
    tgStatus();
    renderHist();
    initEmojiBar();

    const form = $('#form');
    form.addEventListener('input', e => {
      if (e.target.classList.contains('pk-q')) { pk.q = e.target.value; pk.limit = PK_STEP; pinNow(); renderPicker(); return; }
      if (e.target.id === 'ownerKey') return;
      changed();   // имя в kuda-name запишет refresh после паузы в наборе
    });
    form.addEventListener('change', e => {
      const t = e.target;
      if (t.classList.contains('pk-q')) return;
      if (t.id === 'me') saveName(true);
      if (t.id === 'ownerKey') {
        const key = t.value.replace(/\s+/g, '');
        tgError = false;
        if (key && !/^[A-Za-z0-9]{24,64}$/.test(key)) {
          tgError = true; ls.del(OWNER); ls.del(OWNER_OK);
          toast('Похоже, ключ скопирован не целиком — в нём 24+ латинских букв и цифр');
        } else if (key) { ls.set(OWNER, key); verifyKey(false); }
        else { ls.del(OWNER); ls.del(OWNER_OK); }
        tgStatus(); changed();
        return;
      }
      if (t.id === 'evOther') {
        state.evOther = t.checked;
        // включили «другие места», а список пуст (приглашение из ссылки) — вернём стандартные шарики
        if (t.checked) ensurePlaces();
        renderEventUi(); pinNow(); renderPicker(); changed();
        return;
      }
      if (t.name === 'dmode') syncDateMode();
      if (t.name === 'umode') pickUntil(t.value);
      if (t.id === 'untilAt') { if (uMode() !== 'own') setUMode('own'); renderUntil(); }
      if (t.id === 'slotAsk') renderSlots();
      if (t.id === 'tgu') {
        const raw = t.value.trim(), u = K.tgUser(raw);
        if (raw && !u) toast('Ник в Telegram: латиница, цифры и _, от 5 символов');
        else if (u) t.value = '@' + u;
      }
      changed();
    });
    form.addEventListener('click', e => {
      const t = e.target;
      const sw = t.closest('.sw');
      if (sw) {
        if (sw.dataset.cat) state.cat = sw.dataset.cat;
        if (sw.dataset.theme) state.theme = sw.dataset.theme;
        renderSwatches(); changed(); return;
      }
      const tab = t.closest('[data-pktab]');
      if (tab) { pk.tab = tab.dataset.pktab; pk.limit = PK_STEP; pinNow(); renderPicker(); return; }
      const pc = t.closest('[data-pkcity]');
      if (pc) { switchCity(pc.dataset.pkcity, { save: true }); return; }
      const ph = t.closest('[data-pkh]');
      if (ph) { pk.hint = ph.dataset.pkh === pk.hint ? '' : ph.dataset.pkh; pk.limit = PK_STEP; pinNow(); renderPicker(); return; }
      const pe = t.closest('[data-pke]');
      if (pe) { pk.ecat = pe.dataset.pke === pk.ecat ? '' : pe.dataset.pke; pk.limit = PK_STEP; pinNow(); renderPicker(); return; }
      if (t.closest('[data-pkmore]')) { pk.limit += PK_STEP; renderPicker(); return; }
      const it = t.closest('[data-pk]');
      if (it) { togglePick(it.dataset.pk); renderPicker(); changed(); return; }
      if (t.closest('[data-ev-del]')) { setEvent(''); changed(); return; }
      if (t.closest('[data-ev-change]')) {
        setEvent(''); pk.tab = 'events'; pk.limit = PK_STEP; renderPicker(); changed();
        const pick = $('#datePlans');
        if (pick) pick.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (t.closest('.del') && t.closest('.li')) { t.closest('.li').remove(); renderPicker(); changed(); return; }
      if (t.closest('#presetNow')) { presetNow(); return; }
      const add = t.closest('.btn-add');
      if (add) {
        const id = add.dataset.add, box = $('#' + id);
        if (id === 'opts' && optCount() >= MAX_OPTS) { toast(`Не больше ${MAX_OPTS} вариантов — так голосовать удобнее`); return; }
        if (id === 'places' && $$('#places .li').length >= MAX_PLACES) { toast(`Не больше ${MAX_PLACES} шариков — иначе выбирать тяжело`); return; }
        box.insertAdjacentHTML('beforeend', id === 'dates' ? dateRow('') : itemRow({}, id));
        const last = box.lastElementChild;
        const f = $('.ti', last) || $('.dt', last);
        if (f) f.focus();
        changed(); return;
      }
    });
    $('#modeSeg').addEventListener('click', e => {
      const b = e.target.closest('[data-mode]');
      if (b) switchMode(b.dataset.mode);
    });
    $('#pvSteps').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      pvStep = +b.dataset.step;
      $$('#pvSteps button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      reloadPreview();
    });

    $('#copy').onclick = doCopy;
    $('#mbCopy').onclick = doCopy;
    $('#share').onclick = async () => {
      const long = isFresh() ? realLink() : await freshLink();
      remember();
      trackInvite();
      const text = isGroup() ? `${MC().emoji} ${$('#title').value.trim() || MC().title} — голосуем, куда и когда идём!` : 'У меня для тебя кое-что есть 💌';
      // «Поделиться» открываем сразу, без ожидания сети: короткая ссылка уже готова, если блок был на экране
      const url = shortOf[long] || long;
      if (navigator.share) { try { await navigator.share({ title: text, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
      if (await copyText(url)) toast('Ссылка скопирована'); else showLink();
    };
    // блок со ссылкой показался на экране — заранее просим короткую ссылку (и при касании кнопок)
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(es => { resultSeen = es.some(e => e.isIntersecting); if (resultSeen) prefetchShort(); }, { threshold: 0.3 }).observe($('#result'));
    }
    ['#copy', '#share', '#mbCopy'].forEach(s => $(s).addEventListener('pointerdown', prefetchShort));
    $('#open').onclick = () => openGame();
    const vote = () => {
      // имя в игре подставится само
      saveName(true);
      openGame();
      toast('Проголосуй во вкладке с игрой и возвращайся сюда — голос сам попадёт в ссылку');
    };
    $('#vote').onclick = vote;
    $('#mbVote').onclick = vote;
    $('#openPv').onclick = () => openPreview(pvStep);
    $('#mbPv').onclick = () => openPreview(0);
    $('#who').addEventListener('click', e => {
      const b = e.target.closest('[data-who]');
      if (!b || b.dataset.who === state.who) return;
      state.who = b.dataset.who; renderWho(); changed();
    });
    $('#reset').onclick = () => {
      const mode = state.mode;
      if (!confirm(`Сбросить форму? Имена, тексты, места и даты вернутся к начальным. Режим «${K.MODES[mode].label}» останется.`)) return;
      ls.del(DRAFT);
      const tgu = $('#tgu').value;   // ник в Telegram — личная настройка, а не часть приглашения
      fillForm(mode === 'date' ? {} : { mode, theme: themeDefault(mode) });
      $('#tgu').value = tgu;
      if (mode !== 'date') { state.gsel = new Set(defaultGroupSel(mode)); state.autoSel = true; pinNow(); renderPicker(); }
      $('#her').value = ''; $('#me').value = '';
      changed();
      toast('Форма сброшена ✓');
    };

    $('#foodDefaults').onclick = () => {
      const cur = readList('food').filter(f => f.title);
      const same = cur.length === DEF.food.length && cur.every((f, i) => f.title === DEF.food[i].title && f.emoji === DEF.food[i].emoji);
      if (same) { toast('Уже стоят стандартные блюда'); return; }
      if (cur.length && !confirm('Заменить список блюд стандартным набором?')) return;
      renderList('food', DEF.food);
      const lv = $('#lv-food');
      if (lv) lv.checked = true;
      changed();
      toast('Вернул стандартные блюда ✓');
    };

    $('#tgTest').onclick = tgTest;

    $('#hist').addEventListener('click', async e => {
      const b = e.target.closest('[data-h]');
      if (!b) return;
      const list = $('#hist')._list || [], x = list[+b.dataset.i];
      if (!x) return;
      if (b.dataset.h === 'copy') toast(await copyLater(histLink(x)) ? 'Ссылка скопирована' : 'Не получилось скопировать');
      if (b.dataset.h === 'load') {
        try {
          const r = fillForm(await K.decodeInvite(histCode(x)));
          changed();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          toast(r.pastEvent ? 'Загрузил в форму. Событие уже прошло — выбери другое' : 'Загрузил в форму ✓');
        } catch (err) { toast('Не удалось прочитать ссылку'); }
      }
      if (b.dataset.h === 'del') {
        const code = histCode(x);
        saveHist(histList().filter(y => histCode(y) !== code));
        renderHist();
      }
    });

    // голос создателя появился в другой вкладке (игра) — обновляем ссылку; история — из «Мои приглашения»
    const onOutside = () => { refresh(); renderHist(); };
    addEventListener('storage', e => {
      if (!e.key || e.key.startsWith('kuda-votes:') || e.key.startsWith('kuda-voter:')) refresh();
      if (!e.key || e.key === HIST) renderHist();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) onOutside(); });
    addEventListener('pageshow', e => { if (e.persisted) onOutside(); });
    // оценки мест пришли с сервера — показываем звёзды в каталоге
    document.addEventListener('kuda-ratings', () => { renderPicker(); if (curEvent()) renderEventUi(); });
    addEventListener('resize', debounce(() => reloadPreview(), 400));
    // create.html#from=<код> открыли, когда конструктор уже на экране (та же вкладка) — тоже загружаем в форму
    addEventListener('hashchange', () => { applyHashLoad(); });

    applyUrlParams();
    applyHashLoad().then(() => {
      changed();
      refresh();
      // ссылка с ключом Telegram собирается, когда отпечаток секрета создателя готов
      creatorProof().then(() => {
        if (ownerKey() && !keyOk()) verifyKey(true); else renewHistory();
        changed();
      });
    });
    // приглашения из истории, которые ещё не зарегистрированы на сервере (созданы до его подключения)
    if (API()) histList().filter(x => !x.reg && x.code && x.mode).slice(0, 5).forEach(registerInvite);
  }

  init();
})();

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
  const HIST = 'date-constructor-history';
  const OWNER = 'kuda-owner-key';
  /* Секрет создателя: случайная строка этого браузера. В приглашение кладём только её отпечаток (tg),
     а сам секрет показываем боту при регистрации — так бот знает, что приглашение создали здесь. */
  const CREATOR = 'kuda-creator';
  const RENEW = 'kuda-owner-renew';
  const MODE_ORDER = ['date', 'guys', 'girls'];

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

  const DEF = K.defaults();
  let state = { mode: 'date', cat: 'line', theme: 'pink', texts: {}, gsel: new Set(), who: 'f' };
  let code = '';
  let pvStep = 0;
  let pvCounter = 0;
  const isGroup = () => state.mode !== 'date';
  const MC = () => K.MODES[state.mode];

  function toast(t) {
    const el = $('#toast');
    el.textContent = t;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 2600);
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
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ок */ } },
  };

  /* ---------- текст и тема по умолчанию для режима ---------- */
  const modeDefault = (mode, key) => (mode === 'date' ? DEF[key] : K.MODES[mode][key]);
  const themeDefault = mode => (mode === 'date' ? DEF.theme : K.MODES[mode].theme);
  const noDefault = mode => (mode === 'date' ? DEF.noButton : 'real');
  /* стандартный текст чужого режима (например, «собирает девочек» в свидании) — меняем на текст текущего */
  const ownText = (mode, key, val) => {
    const foreign = Object.keys(K.MODES).some(m => m !== mode && val === modeDefault(m, key));
    return !val || foreign ? modeDefault(mode, key) : val;
  };

  /* ---------- списки: места, варианты, еда, даты ---------- */
  function itemRow(it, kind) {
    const pl = it.plan ? K.planById(it.plan) : null;
    return `<div class="li"${pl ? ` data-plan="${esc(pl.id)}"` : ''}>
      <input class="em" value="${esc(it.emoji || (pl && pl.emoji) || '')}" maxlength="8" aria-label="Эмодзи" placeholder="🙂">
      <div class="li-main">
        <input class="ti" value="${esc(it.title || (pl && pl.title) || '')}" maxlength="40" placeholder="${kind === 'food' ? 'Блюдо' : 'Название места'}">
        <input class="no" value="${esc(it.note || (pl && pl.why) || '')}" maxlength="90" placeholder="Подпись (необязательно)">
        ${pl ? `<span class="plan-tag">${pl.single ? '📍 Место из каталога: ' + esc([K.planStops(pl)[0].kind, K.metroText(K.planStops(pl)[0].metro)].filter(Boolean).join(' · ')) : '📋 Готовый план: ' + esc(K.planStops(pl).map(p => p.name).join(' → '))}</span>` : ''}
      </div>
      <button class="del" type="button" title="Удалить" aria-label="Удалить">${K.icon('x')}</button>
    </div>`;
  }
  const dateRow = d => `<div class="li date-li"><input class="dt" type="date" value="${esc(d || '')}"><button class="del" type="button" title="Удалить" aria-label="Удалить">${K.icon('x')}</button></div>`;
  function renderList(id, items) {
    const box = $('#' + id);
    box.innerHTML = id === 'dates' ? items.map(dateRow).join('') : items.map(it => itemRow(it, id)).join('');
  }
  function readList(id) {
    return $$('.li', $('#' + id)).map(r => {
      const o = { emoji: $('.em', r).value.trim(), title: $('.ti', r).value.trim() };
      const note = $('.no', r).value.trim();
      if (note) o.note = note;
      if (r.dataset.plan) {
        const pl = K.planById(r.dataset.plan);
        // если подписи совпадают с планом — храним только id плана (короче ссылка)
        if (pl && o.emoji === pl.emoji && o.title === pl.title && (o.note || '') === pl.why) return { plan: pl.id };
        o.plan = r.dataset.plan;
      }
      return o;
    }).filter(o => o.title || o.plan);
  }

  /* ---------- выбор из каталога: подборки и все места, поиск, подсказки ---------- */
  /* Один и тот же выбор в двух режимах: в свидании пункт становится шариком (#places),
     в компании — вариантом для голосования (state.gsel). Места каталога идут как «p-<id>». */
  const PK_STEP = 24;
  const pk = { tab: 'plans', q: '', hint: '', limit: PK_STEP };
  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е');
  const SEASON = K.seasonHints();
  const PK_HINTS = ['autumn', 'halloween', 'first', 'scenic', 'view', 'rain', 'budget', 'company', 'night', 'michelin'];
  const pkSelected = () => isGroup() ? state.gsel : new Set($$('#places .li[data-plan]').map(r => r.dataset.plan));
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
  let PK_PLACES = null;
  function pkPlaces() {
    if (!PK_PLACES) {
      PK_PLACES = Object.keys(K.kuda().places).map(id => K.planById('p-' + id)).filter(Boolean)
        .sort((a, b) => (!!K.photo(K.placeById(b.stops[0])) - !!K.photo(K.placeById(a.stops[0]))) || lead(a.title).localeCompare(lead(b.title), 'ru'));
    }
    return PK_PLACES;
  }
  function pkPlans() {
    const list = K.kuda().scenarios.filter(s => s.mode === state.mode);
    // в сезон подборки про осень и Хэллоуин — первыми
    const season = s => (s.tags || []).some(t => SEASON.includes(t)) ? 0 : 1;
    return list.map((s, i) => [s, i]).sort((a, b) => season(a[0]) - season(b[0]) || a[1] - b[1]).map(x => x[0]);
  }
  function pkItem(it, on) {
    const st = K.planStops(it), ph = it.single ? K.photo(st[0]) : K.planPhoto(it);
    const sub = it.single ? [st[0].kind, K.metroText(st[0].metro)].filter(Boolean).join(' · ') : st.map(x => x.name).join(' → ');
    const hints = pkHints(it).filter(h => !(h === 'first' && isGroup())).slice(0, 3);
    return `<button type="button" class="pk-it${on ? ' on' : ''}" data-pk="${esc(it.id)}">
      <span class="pk-im">${ph ? `<img src="${esc(ph.t)}" alt="" loading="lazy">` : esc(it.emoji)}</span>
      <span class="pk-tx"><b>${ph ? esc(it.emoji) + ' ' : ''}${esc(it.title)}</b><small>${esc(sub)}</small>${hints.length ? `<span class="hints">${hints.map(h => K.hintChip(h, 'short')).join('')}</span>` : ''}</span>
      <span class="pk-ck" aria-hidden="true">${on ? '✓' : '+'}</span>
    </button>`;
  }
  function renderPicker() {
    const box = $(isGroup() ? '#planPick' : '#datePlans');
    const other = $(isGroup() ? '#datePlans' : '#planPick');
    if (other.firstChild) other.innerHTML = '';
    if (!$('.pk-list', box)) {
      box.innerHTML = `<div class="pk-tabs seg"><button type="button" data-pktab="plans"></button><button type="button" data-pktab="places"></button></div>
        <input class="pk-q" type="search" placeholder="Поиск: парк, бар, Арбат, Хэллоуин…" aria-label="Поиск по местам и подборкам" autocomplete="off">
        <div class="pk-hints"></div><div class="pk-list"></div><div class="pk-foot"></div>`;
    }
    const q = $('.pk-q', box);
    if (q.value !== pk.q) q.value = pk.q;
    const sel = pkSelected();
    const plans = pkPlans(), places = pkPlaces();
    const tabs = { plans: ['Подборки', plans.length], places: ['Все места', places.length] };
    $$('[data-pktab]', box).forEach(b => {
      b.classList.toggle('on', b.dataset.pktab === pk.tab);
      b.textContent = `${tabs[b.dataset.pktab][0]} · ${tabs[b.dataset.pktab][1]}`;
    });
    const all = pk.tab === 'places' ? places : plans;
    const words = norm(pk.q).split(/\s+/).filter(Boolean);
    const byQ = words.length ? all.filter(it => words.every(w => pkText(it).includes(w) || pkHints(it).some(h => norm(K.HINTS[h][1]).includes(w)))) : all;
    const counts = {};
    byQ.forEach(it => pkHints(it).forEach(h => { counts[h] = (counts[h] || 0) + 1; }));
    const chips = PK_HINTS.filter(h => counts[h] && !(h === 'first' && isGroup()));
    if (pk.hint && !chips.includes(pk.hint)) chips.unshift(pk.hint);
    $('.pk-hints', box).innerHTML = `<button type="button" data-pkh="" class="${pk.hint ? '' : 'on'}">Все</button>` +
      chips.map(h => `<button type="button" data-pkh="${h}" class="${pk.hint === h ? 'on' : ''}">${K.HINTS[h][0]} ${K.HINTS[h][2]}<i>${counts[h] || 0}</i></button>`).join('');
    const found = pk.hint ? byQ.filter(it => pkHints(it).includes(pk.hint)) : byQ;
    const list = found.filter(it => !sel.has(it.id));
    // отмеченные (и подборки, и отдельные места) всегда наверху — их видно и легко снять
    const picked = Array.from(sel).map(K.planById).filter(Boolean);
    $('.pk-list', box).innerHTML = picked.map(it => pkItem(it, true)).join('') + (list.length
      ? list.slice(0, pk.limit).map(it => pkItem(it, false)).join('')
      : found.length ? '' : `<p class="pk-empty">Ничего не нашлось. Попробуй другое слово${pk.tab === 'plans' ? ' или вкладку «Все места»' : ''}.</p>`);
    const more = list.length - pk.limit;
    const n = sel.size;
    $('.pk-foot', box).innerHTML = (more > 0 ? `<button type="button" class="more" data-pkmore>Показать ещё ${Math.min(PK_STEP, more)} из ${more}</button>` : '') +
      (n ? `<span class="pk-sel">Выбрано: ${n}</span>` : '');
  }
  function renderPlanPickers(selectedGroup) {
    if (selectedGroup) state.gsel = selectedGroup;
    renderPicker();
  }
  function togglePick(id) {
    if (isGroup()) {
      if (state.gsel.has(id)) state.gsel.delete(id); else state.gsel.add(id);
    } else {
      const row = $(`#places .li[data-plan="${id}"]`);
      if (row) row.remove(); else $('#places').insertAdjacentHTML('beforeend', itemRow({ plan: id }, 'places'));
    }
  }

  /* ---------- режим ---------- */
  function renderModeSeg() {
    $('#modeSeg').innerHTML = MODE_ORDER.map(m =>
      `<button type="button" data-mode="${m}" class="${m === state.mode ? 'on' : ''}">${K.icon(K.MODE_ICON[m])}${K.MODES[m].label}</button>`).join('');
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
    $('#open').innerHTML = K.icon('ext') + (isGroup() ? 'Открыть как участник' : 'Открыть как получатель');
  }
  function switchMode(next) {
    if (next === state.mode || !K.MODES[next]) return;
    const prev = state.mode;
    state.texts[prev] = { greeting: $('#greeting').value, question: $('#question').value, title: $('#title').value };
    const t = state.texts[next] || {};
    $('#greeting').value = t.greeting != null ? t.greeting : modeDefault(next, 'greeting');
    $('#question').value = t.question != null ? t.question : modeDefault(next, 'question');
    $('#title').value = t.title || K.MODES[next].title || '';
    if (state.theme === themeDefault(prev)) state.theme = themeDefault(next);
    if ($('#noButton').value === noDefault(prev)) $('#noButton').value = noDefault(next);
    state.mode = next;
    if (pk.hint === 'first') pk.hint = '';
    const levels = {};
    $$('#levels input').forEach(i => { levels[i.id.slice(3)] = i.checked; });
    renderLevels(levels);
    renderSwatches();
    applyModeUi();
    const sel = new Set(Array.from(state.gsel).filter(id => { const pl = K.planById(id); return pl && (pl.mode === next || pl.single); }));
    if (!sel.size && !readList('opts').length) K.kuda().scenarios.filter(s => s.mode === next).slice(0, 3).forEach(p => sel.add(p.id));
    renderPlanPickers(sel);
    update();
  }

  /* ---------- форма ⇄ приглашение ---------- */
  function fillForm(inv) {
    inv = K.merge(DEF, inv);
    if (!(inv.food || []).some(f => f && f.title)) inv.food = DEF.food;
    state.mode = K.modeOf(inv);
    ['her', 'me', 'catName', 'greeting', 'question', 'signature', 'finale'].forEach(k => { $('#' + k).value = inv[k] || ''; });
    $('#tgu').value = K.tgUser(inv.tgu) ? '@' + K.tgUser(inv.tgu) : '';
    $('#greeting').value = ownText(state.mode, 'greeting', (inv.greeting || '').trim());
    $('#question').value = ownText(state.mode, 'question', (inv.question || '').trim());
    $('#title').value = inv.title || MC().title || '';
    state.cat = K.CATS[inv.cat] ? inv.cat : 'line';
    state.who = inv.who === 'm' ? 'm' : 'f';
    renderWho();
    state.theme = K.THEMES.includes(inv.theme) ? inv.theme : themeDefault(state.mode);
    renderSwatches();
    renderLevels(inv.levels);
    $('#heartsGoal').value = inv.heartsGoal || 12;
    $('#noButton').value = inv.noButton === 'real' ? 'real' : 'runaway';
    renderList('places', inv.places || []);
    $('#placeSurprise').checked = !!inv.placeSurprise;
    $('#placeCustom').checked = !!inv.placeCustom;
    const opts = Array.isArray(inv.opts) ? inv.opts : [];
    renderList('opts', opts.filter(o => o && !o.plan));
    const d = inv.dates || {};
    $$('input[name="dmode"]').forEach(r => { r.checked = r.value === (d.mode === 'list' ? 'list' : 'next'); });
    $('#dStart').value = d.start || '';
    $('#dDays').value = d.days || 14;
    const skip = (d.skipWeekdays || []).map(Number);
    $$('#weekdays input').forEach(c => { c.checked = !skip.includes(+c.value); });
    renderList('dates', (d.list && d.list.length) ? d.list : ['']);
    $('#dateOther').checked = inv.dateOther !== false;
    const t = inv.time || {};
    $('#tFrom').value = t.from || '12:00';
    $('#tTo').value = t.to || '22:00';
    $('#tStep').value = String([15, 30, 60].includes(+t.step) ? +t.step : 30);
    $('#tDef').value = t.def || '19:00';
    renderList('food', inv.food || []);
    syncDateMode();
    applyModeUi();
    renderPlanPickers(new Set(opts.filter(o => o && o.plan).map(o => o.plan)));
  }
  function readForm(all) {
    const v = id => $('#' + id).value.trim();
    const levels = {};
    $$('#levels input').forEach(i => { levels[i.id.slice(3)] = i.checked; });
    const dmode = ($('input[name="dmode"]:checked') || {}).value || 'next';
    const inv = {
      me: v('me') || 'Твой друг', catName: v('catName') || 'Мурчик',
      cat: state.cat, theme: state.theme,
      greeting: v('greeting'), question: v('question'),
      levels,
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
      her: v('her') || 'Солнышко', signature: v('signature'), finale: v('finale'),
      places: readList('places'),
      placeSurprise: $('#placeSurprise').checked,
      placeCustom: $('#placeCustom').checked,
      dateOther: $('#dateOther').checked,
      time: { from: v('tFrom') || '12:00', to: v('tTo') || '22:00', step: +v('tStep') || 30, def: v('tDef') || '19:00' },
      food: readList('food'),
    });
    if (isGroup()) {
      // черновику нужны и поля свидания, иначе после перезагрузки пропадут блюда и места
      if (all) Object.assign(inv, dateFields());
      // стандартные тексты режима не кладём в ссылку — игра подставит их сама
      if (inv.greeting === MC().greeting) inv.greeting = DEF.greeting;
      if (inv.question === MC().question) inv.question = DEF.question;
      Object.assign(inv, {
        mode: state.mode,
        title: v('title') || MC().title,
        opts: Array.from(state.gsel).filter(id => K.planById(id)).map(plan => ({ plan })).concat(readList('opts')),
      });
    }
    // «к нему» и ник — поля свидания; в черновик кладём и в режиме компании, иначе после перезагрузки сбросятся
    if (!isGroup() || all) {
      if (!isGroup()) Object.assign(inv, dateFields());
      if (state.who === 'm') inv.who = 'm';
      const tgu = K.tgUser(v('tgu'));
      if (tgu) inv.tgu = tgu;
    }
    if (ownerKey() && relayUrl() && TG.c) inv.tg = TG.c;
    return inv;
  }

  /* Обращаться «к ней» или «к нему»: от этого зависят окончания в игре и уведомлениях */
  function renderWho() {
    $$('#who [data-who]').forEach(b => { const on = b.dataset.who === state.who; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  }
  function renderSwatches() {
    $('#cats').innerHTML = Object.keys(K.CATS).map(c =>
      `<button type="button" class="sw ${c === state.cat ? 'on' : ''}" data-cat="${c}" style="${K.catVars(c)}">${K.catSVG('normal')}${CAT_NAMES[c]}</button>`).join('');
    $('#themes').innerHTML = K.THEMES.map(t =>
      `<button type="button" class="sw ${t === state.theme ? 'on' : ''}" data-theme="${t}"><div class="theme-dot" style="--dot:${THEME_INFO[t][1]}"></div>${THEME_INFO[t][0]}</button>`).join('');
  }
  function syncDateMode() {
    const mode = ($('input[name="dmode"]:checked') || {}).value;
    $('#dNext').classList.toggle('hidden', mode === 'list');
    $('#dList').classList.toggle('hidden', mode !== 'list');
  }
  function dateInfo(inv) {
    const days = K.listDates(inv.dates);
    const box = $('#dateInfo');
    if (!days.length) { box.textContent = 'Сейчас не получится ни одного дня — выбор дня будет пропущен или заменён полем «напиши, когда удобно».'; return; }
    const f = s => { const d = K.parseYmd(s); return d.getDate() + '.' + String(d.getMonth() + 1).padStart(2, '0'); };
    const n = days.length, w = n % 10 === 1 && n % 100 !== 11 ? 'день' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 'дня' : 'дней';
    box.textContent = `В календаре будет ${n} ${w}: ${f(days[0])} — ${f(days[n - 1])}` +
      (inv.dates.mode === 'next' && !inv.dates.start ? ' (считается от дня, когда откроют ссылку)' : '');
  }

  /* ---------- ссылка и превью ---------- */
  function baseUrl() {
    const u = new URL('index.html', location.href);
    return /^https?:$/.test(u.protocol) ? u.href.replace(/index\.html$/, '') : u.href;
  }
  const realLink = () => baseUrl() + '#' + code;
  const previewLink = step => baseUrl() + '#' + code + '&p=1' + (step ? '&s=' + step : '');

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
      lv = LEVELS.date.filter(([id]) => on[id] !== false &&
        !(id === 'food' && !(inv.food || []).length) &&
        !(id === 'place' && !(inv.places || []).length && !inv.placeCustom && !inv.placeSurprise)).map(l => l[1].split(' ')[0]);
    }
    const items = [['Старт', 0]].concat(lv.map((e, i) => [String(i + 1) + ' ' + e, i + 1]), [[isGroup() ? '📊 Финал' : '🎫 Финал', lv.length + 1]]);
    if (pvStep > lv.length + 1) pvStep = 0;
    $('#pvSteps').innerHTML = items.map(([t, s]) => `<button type="button" data-step="${s}" class="${s === pvStep ? 'on' : ''}">${t}</button>`).join('');
  }
  function reloadPreview() {
    if (!code) return;
    const pv = $('#pv');
    if (getComputedStyle($('.preview')).display === 'none') return;
    pv.src = 'index.html?pv=' + (++pvCounter) + '#' + code + '&p=1' + (pvStep ? '&s=' + pvStep : '');
  }

  const update = debounce(async () => {
    const inv = readForm();
    ls.set(DRAFT, JSON.stringify(readForm(true)));
    dateInfo(inv);
    pvSteps(inv);
    renderPlanPickers();
    code = await K.encodeInvite(K.diffInvite(inv, DEF));
    const long = realLink();
    $('#link').value = shortOf[long] || long;
    linkInfo();
    reloadPreview();
    if (resultSeen) prepareShort();
  }, 450);
  /* Короткие ссылки. Сокращаем не после каждой паузы в наборе (иначе в сервисе копятся сотни черновиков),
     а когда блок со ссылкой на экране или нажаты «Скопировать»/«Поделиться». Готовая короткая ссылка
     нужна заранее: на iPhone «Поделиться» не открывается, если перед ним ждали ответа сети. */
  const shortOf = {}, shortP = {};
  let resultSeen = false;
  function prepareShort() {
    const long = realLink();
    if (!code || shortP[long]) return shortP[long] || Promise.resolve(long);
    shortP[long] = K.shortLink(long).then(short => { shortOf[long] = short; if (realLink() === long) { $('#link').value = short; linkInfo(); } return short; });
    linkInfo();
    return shortP[long];
  }
  function linkInfo() {
    const long = realLink(), short = shortOf[long];
    $('#linkLen').textContent = short ? (short !== long ? 'Короткая ссылка готова — её удобно кинуть в чат'
      : long.length > 100 ? `Длина ссылки: ${long.length} символов — сервис коротких ссылок сейчас недоступен` : `Длина ссылки: ${long.length} символов`)
      : shortP[long] ? 'Сокращаем ссылку…' : 'Ссылку сократим, когда нажмёшь «Скопировать» или «Поделиться»';
  }
  const sendLink = () => shortOf[realLink()] || realLink();
  /* Копируем короткую ссылку. Если она ещё готовится — через ClipboardItem с обещанием: Safari и Chrome
     дождутся ответа, не теряя разрешения на запись, а без него — после ожидания обычным способом. */
  async function copyLink() {
    const long = realLink();
    if (shortOf[long]) return copyText(shortOf[long]);
    const p = prepareShort();
    if (navigator.clipboard && window.ClipboardItem && navigator.clipboard.write) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': p.then(s => new Blob([s], { type: 'text/plain' })) })]);
        return true;
      } catch (e) { /* ниже — запасной путь */ }
    }
    return copyText(await p);
  }

  /* ---------- история ---------- */
  function histList() { try { return JSON.parse(ls.get(HIST) || '[]'); } catch (e) { return []; } }
  function remember() {
    const inv = readForm();
    const label = isGroup() ? `${MC().emoji} ${inv.title}` : inv.her;
    const link = realLink();
    let list = histList().filter(x => x.link !== link && !((x.label || x.her) === label && Date.now() - x.at < 60 * 60 * 1000));
    list.unshift({ label, link, at: Date.now() });
    ls.set(HIST, JSON.stringify(list.slice(0, 30)));
    renderHist();
    if (ownerKey() && relayUrl() && TG.s) registerIds([K.hash(code)]);
  }
  /* Модель «Для тебя» учится на том, куда зовут: передаём выбранные планы и места (только при отправке) */
  function trackInvite() {
    const picked = isGroup() ? Array.from(state.gsel) : $$('#places .li[data-plan]').map(r => r.dataset.plan);
    if (window.KudaTrack) window.KudaTrack.invited(picked.filter(id => K.planById(id)), state.mode);
  }
  function renderHist() {
    const list = histList();
    $('#hist').innerHTML = list.length ? list.map((x, i) => `
      <div class="hist-item">
        <b>${esc(x.label || x.her)}<small>${new Date(x.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></b>
        <button class="btn" data-h="copy" data-i="${i}">Копировать</button>
        <button class="btn" data-h="load" data-i="${i}">В форму</button>
        <button class="btn" data-h="del" data-i="${i}" aria-label="Удалить">${K.icon('x')}</button>
      </div>`).join('') : '<p class="hint">Пока пусто.</p>';
    $('#hist')._list = list;
  }

  /* ---------- Telegram (через посредника, только для владельца) ---------- */
  const relayUrl = () => (CFG.telegram || {}).relayUrl || '';
  const ownerKey = () => ls.get(OWNER) || '';
  /* Секрет создателя (s) и его отпечаток (c = SHA-256, 12 символов) — считаем один раз при запуске.
     Без crypto.subtle (страница открыта не по https) ответы в Telegram не подключаются. */
  const TG = { s: '', c: '' };
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
  const histIds = () => histList().map(x => K.readHash('#' + (x.link.split('#')[1] || '')).code).filter(Boolean).map(K.hash);
  const registerHistory = () => registerIds(histIds());
  /* Раз в день продлеваем срок хранения своих приглашений у бота (иначе через 90 дней без ответов их забудут) */
  function renewHistory() {
    const day = String(Math.floor(Date.now() / 864e5));
    if (!relayUrl() || !ownerKey() || !TG.s || ls.get(RENEW) === day || !histIds().length) return;
    registerHistory().then(j => { if (j.ok) ls.set(RENEW, day); });
  }
  const relayError = j => j.error === 'net' ? 'Не удалось связаться с ботом — проверь интернет'
    : j.error === 'rate' ? 'Слишком часто — попробуй через несколько минут'
      : j.error === 'busy' ? 'Бот сейчас занят — попробуй ещё раз через минуту' : 'Ключ не подошёл — проверь его';
  function tgStatus() {
    const el = $('#tgStatus');
    const url = relayUrl(), key = ownerKey();
    el.className = url && key ? 'status ok' : 'status';
    el.textContent = !url
      ? 'Ответы в Telegram скоро появятся. А пока ответ придёт ссылкой-билетом: человек сам отправит её тебе.'
      : key ? '✓ Ключ сохранён. Ответы будут приходить в Telegram на приглашения, которые ты скопируешь или отправишь отсюда с этим ключом.'
        : 'Получи ключ у нашего бота — и ответы на твои приглашения будут приходить тебе в Telegram.';
    // без бота кнопка теста не нужна вовсе, без ключа — видна, но неактивна
    $('#tgTest').classList.toggle('hidden', !url);
    $('#tgTest').disabled = !url || !key;
    $('#ownerKey').value = key;
    const bot = K.tgUser((CFG.telegram || {}).bot);
    $('#keyHow').classList.toggle('hidden', !url || !bot);
    if (bot) { $('#botLink').href = 'https://t.me/' + bot + '?start=key'; $('#botLink').textContent = '@' + bot; }
    $('#ownerKey').closest('label').classList.toggle('hidden', !url);
  }
  async function tgTest() {
    const j = await K.relayTest(relayUrl(), ownerKey());
    toast(j.ok ? 'Отправлено — проверь Telegram ✓' : relayError(j));
  }

  /* ---------- эмодзи-панель ---------- */
  let emojiTarget = null;
  function initEmojiBar() {
    const bar = $('#emojiBar');
    bar.innerHTML = EMOJIS.map(e => `<button type="button">${e}</button>`).join('');
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

  /* ---------- приход с главной: ?mode=guys&plan=g-sanduny ---------- */
  function applyUrlParams() {
    const q = new URLSearchParams(location.search);
    const m = q.get('mode'), planId = q.get('plan');
    if (m && K.MODES[m]) switchMode(m);
    const pl = planId ? K.planById(planId) : null;
    if (!pl) return;
    if (pl.mode && pl.mode !== state.mode) switchMode(pl.mode);
    if (state.mode === 'date') {
      if (!$(`#places .li[data-plan="${pl.id}"]`)) $('#places').insertAdjacentHTML('afterbegin', itemRow({ plan: pl.id }, 'places'));
      $('#lv-place').checked = true;
    } else {
      const sel = new Set([pl.id].concat(Array.from(state.gsel)));
      K.kuda().scenarios.filter(s => s.mode === state.mode && !sel.has(s.id)).slice(0, Math.max(0, 3 - sel.size)).forEach(s => sel.add(s.id));
      renderPlanPickers(sel);
    }
    toast(`Добавил план «${pl.title}» ✓`);
    history.replaceState(null, '', 'create.html');
  }

  /* ---------- запуск ---------- */
  function init() {
    // название сайта — из config.js (site.name), как на главной
    if (CFG.site && CFG.site.name) { const b = $('.back'); if (b && b.lastChild) b.lastChild.textContent = CFG.site.name; }
    $('#weekdays').innerHTML = WEEK.map(([n, t]) => `<label class="chip"><input type="checkbox" value="${n}"><span>${t}</span></label>`).join('');

    let draft = null;
    try { OLD_DRAFTS.forEach(k => localStorage.removeItem(k)); } catch (e) { /* ок */ }
    try { draft = JSON.parse(ls.get(DRAFT) || 'null'); } catch (e) { /* пусто */ }
    fillForm(draft || DEF);
    if (!draft) { $('#her').value = ''; $('#me').value = ''; }   // имена из config.js — только пример, форма начинается пустой
    const user = window.KudaAuth && window.KudaAuth.user();
    if (user && user.name && user.name !== 'Ты' && !$('#me').value.trim()) $('#me').value = user.name;
    tgStatus();
    renderHist();
    initEmojiBar();

    const form = $('#form');
    form.addEventListener('input', e => {
      if (e.target.classList.contains('pk-q')) { pk.q = e.target.value; pk.limit = PK_STEP; renderPicker(); return; }
      if (e.target.id === 'ownerKey') return;
      if (!e.target.closest('#tg')) update();
    });
    form.addEventListener('change', e => {
      if (e.target.classList.contains('pk-q')) return;
      if (e.target.id === 'ownerKey') {
        ls.set(OWNER, e.target.value.trim());
        tgStatus();
        // пустая история — посредник просто проверит ключ
        if (ownerKey()) registerHistory().then(j => toast(j.ok ? 'Ключ подошёл ✓ Ответы будут приходить на приглашения, которые ты отправишь с ним' : relayError(j)));
        update();
        return;
      }
      if (e.target.name === 'dmode') syncDateMode();
      if (!e.target.closest('#tg')) update();
    });
    form.addEventListener('click', e => {
      const t = e.target;
      const sw = t.closest('.sw');
      if (sw) {
        if (sw.dataset.cat) state.cat = sw.dataset.cat;
        if (sw.dataset.theme) state.theme = sw.dataset.theme;
        renderSwatches(); update(); return;
      }
      const tab = t.closest('[data-pktab]');
      if (tab) { pk.tab = tab.dataset.pktab; pk.limit = PK_STEP; renderPicker(); return; }
      const ph = t.closest('[data-pkh]');
      if (ph) { pk.hint = ph.dataset.pkh === pk.hint ? '' : ph.dataset.pkh; pk.limit = PK_STEP; renderPicker(); return; }
      if (t.closest('[data-pkmore]')) { pk.limit += PK_STEP; renderPicker(); return; }
      const it = t.closest('[data-pk]');
      if (it) { togglePick(it.dataset.pk); renderPicker(); update(); return; }
      if (t.closest('.del')) { t.closest('.li').remove(); update(); return; }
      const add = t.closest('.btn-add');
      if (add) {
        const id = add.dataset.add, box = $('#' + id);
        box.insertAdjacentHTML('beforeend', id === 'dates' ? dateRow('') : itemRow({}, id));
        const last = box.lastElementChild;
        const f = $('.ti', last) || $('.dt', last);
        if (f) f.focus();
        update(); return;
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
      $$('#pvSteps button').forEach(x => x.classList.toggle('on', x === b));
      reloadPreview();
    });

    $('#copy').onclick = async () => {
      remember();
      trackInvite();
      const ready = !!shortOf[realLink()];
      if (!ready) toast('Сокращаем ссылку…');
      toast(await copyLink() ? (isGroup() ? 'Ссылка скопирована — кидай в общий чат 💬' : 'Ссылка скопирована 💌 Отправь её!') : 'Скопируй ссылку вручную');
    };
    $('#share').onclick = async () => {
      remember();
      trackInvite();
      const text = isGroup() ? `${MC().emoji} ${$('#title').value || MC().title} — голосуем, куда и когда идём!` : 'У меня для тебя кое-что есть 💌';
      // «Поделиться» открываем сразу, без ожидания сети: короткая ссылка уже готова, если блок был на экране
      const url = sendLink();
      if (navigator.share) { try { await navigator.share({ title: text, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
      toast(await copyLink() ? 'Ссылка скопирована' : 'Скопируй ссылку вручную');
    };
    // блок со ссылкой показался на экране — заранее просим короткую ссылку (и при касании кнопок внизу экрана)
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(es => { resultSeen = es.some(e => e.isIntersecting); if (resultSeen) prepareShort(); }, { threshold: 0.3 }).observe($('#result'));
    }
    ['#copy', '#share', '#mbCopy'].forEach(s => $(s).addEventListener('pointerdown', () => prepareShort()));
    $('#open').onclick = () => { remember(); window.open(realLink(), '_blank'); };
    $('#openPv').onclick = () => window.open(previewLink(pvStep), '_blank');
    $('#mbPv').onclick = () => window.open(previewLink(0), '_blank');
    $('#mbCopy').onclick = () => $('#copy').click();
    $('#who').addEventListener('click', e => {
      const b = e.target.closest('[data-who]');
      if (!b || b.dataset.who === state.who) return;
      state.who = b.dataset.who; renderWho(); update();
    });
    $('#tgu').addEventListener('change', () => {
      const raw = $('#tgu').value.trim(), u = K.tgUser(raw);
      if (raw && !u) toast('Ник в Telegram: латиница, цифры и _, от 5 символов');
      else if (u) $('#tgu').value = '@' + u;
    });
    $('#reset').onclick = () => {
      if (!confirm('Сбросить форму? Имена, тексты, места и даты вернутся к начальным.')) return;
      try { localStorage.removeItem(DRAFT); } catch (e) { /* ок */ }
      state.texts = {};
      fillForm(DEF); $('#her').value = ''; $('#me').value = ''; update();
    };

    $('#foodDefaults').onclick = () => {
      const cur = readList('food').filter(f => f.title);
      const same = cur.length === DEF.food.length && cur.every((f, i) => f.title === DEF.food[i].title && f.emoji === DEF.food[i].emoji);
      if (same) { toast('Уже стоят стандартные блюда'); return; }
      if (cur.length && !confirm('Заменить список блюд стандартным набором?')) return;
      renderList('food', DEF.food);
      $('#lv-food').checked = true;
      update();
      toast('Вернул стандартные блюда ✓');
    };

    $('#tgTest').onclick = tgTest;

    $('#hist').addEventListener('click', async e => {
      const b = e.target.closest('[data-h]');
      if (!b) return;
      const list = $('#hist')._list || [], x = list[+b.dataset.i];
      if (!x) return;
      if (b.dataset.h === 'copy') toast(await copyText(x.link) ? 'Ссылка скопирована' : 'Не получилось скопировать');
      if (b.dataset.h === 'load') {
        try {
          const c = K.readHash('#' + (x.link.split('#')[1] || '')).code;
          state.texts = {};
          fillForm(K.merge(DEF, await K.decodeInvite(c))); update();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          toast('Загрузил в форму ✓');
        } catch (err) { toast('Не удалось прочитать ссылку'); }
      }
      if (b.dataset.h === 'del') {
        list.splice(+b.dataset.i, 1);
        ls.set(HIST, JSON.stringify(list));
        renderHist();
      }
    });

    addEventListener('resize', debounce(reloadPreview, 400));
    applyUrlParams();
    // ссылку собираем, когда отпечаток секрета создателя готов (он входит в приглашение, если есть ключ)
    creatorProof().then(() => { update(); renewHistory(); });
  }

  init();
})();

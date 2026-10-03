/* Конструктор: форма → приглашение → короткая ссылка. Режимы: свидание, пацаны, подружки. */
(function () {
  'use strict';

  const K = window.DateKit;
  const CFG = window.DATE_CONFIG || {};
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = K.esc;
  const DRAFT = 'date-constructor-draft';
  const HIST = 'date-constructor-history';
  const OWNER = 'kuda-owner-key';
  const MODE_ORDER = ['date', 'guys', 'girls'];

  const LEVELS = {
    date: [
      ['hearts', '❤️ Поймай сердечки', 'мини-игра: котик ловит сердечки в корзинку'],
      ['letter', '💌 Письмо с вопросом', '«Пойдёшь со мной на свидание?» и кнопки Да/Нет'],
      ['place', '🎈 Шарики с местами', 'она лопает шарик с местом'],
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
  let state = { mode: 'date', cat: 'line', theme: 'pink', texts: {} };
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

  /* ---------- списки: места, варианты, еда, даты ---------- */
  function itemRow(it, kind) {
    const pl = it.plan ? K.planById(it.plan) : null;
    return `<div class="li"${pl ? ` data-plan="${esc(pl.id)}"` : ''}>
      <input class="em" value="${esc(it.emoji || (pl && pl.emoji) || '')}" maxlength="8" aria-label="Эмодзи" placeholder="🙂">
      <div class="li-main">
        <input class="ti" value="${esc(it.title || (pl && pl.title) || '')}" maxlength="40" placeholder="${kind === 'food' ? 'Блюдо' : 'Название места'}">
        <input class="no" value="${esc(it.note || (pl && pl.why) || '')}" maxlength="90" placeholder="Подпись (необязательно)">
        ${pl ? `<span class="plan-tag">📋 Готовый план: ${esc(K.planStops(pl).map(p => p.name).join(' → '))}</span>` : ''}
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

  /* ---------- готовые планы ---------- */
  function renderPlanPickers(selectedGroup) {
    const datePlans = K.kuda().scenarios.filter(s => s.mode === 'date');
    const inPlaces = new Set($$('#places .li[data-plan]').map(r => r.dataset.plan));
    $('#datePlans').innerHTML = datePlans.map(p =>
      `<button type="button" data-dplan="${p.id}" class="${inPlaces.has(p.id) ? 'on' : ''}">${p.emoji} ${esc(p.title)}<small>${esc(K.planStops(p).map(x => x.name).join(' → '))}</small></button>`).join('');
    if (isGroup()) {
      const sel = selectedGroup || new Set($$('#planPick button.on').map(b => b.dataset.gplan));
      $('#planPick').innerHTML = K.kuda().scenarios.filter(s => s.mode === state.mode).map(p =>
        `<button type="button" data-gplan="${p.id}" class="${sel.has(p.id) ? 'on' : ''}">${p.emoji} ${esc(p.title)}<small>${esc(K.planStops(p).map(x => x.name).join(' → '))}</small></button>`).join('');
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
    $('#resTitle').textContent = isGroup() ? 'Ссылка для общего чата' : 'Ссылка для неё';
    $('#open').innerHTML = K.icon('ext') + (isGroup() ? 'Открыть как участник' : 'Открыть как она');
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
    const levels = {};
    $$('#levels input').forEach(i => { levels[i.id.slice(3)] = i.checked; });
    renderLevels(levels);
    renderSwatches();
    applyModeUi();
    const sel = new Set($$('#planPick button.on').map(b => b.dataset.gplan).filter(id => (K.planById(id) || {}).mode === next));
    if (!sel.size && !readList('opts').length) K.kuda().scenarios.filter(s => s.mode === next).slice(0, 3).forEach(p => sel.add(p.id));
    renderPlanPickers(sel);
    update();
  }

  /* ---------- форма ⇄ приглашение ---------- */
  function fillForm(inv) {
    inv = K.merge(K.BASE, inv);
    state.mode = K.modeOf(inv);
    ['her', 'me', 'catName', 'greeting', 'question', 'signature', 'finale'].forEach(k => { $('#' + k).value = inv[k] || ''; });
    $('#tgu').value = K.tgUser(inv.tgu) ? '@' + K.tgUser(inv.tgu) : '';
    if (isGroup()) {
      if (!inv.greeting || inv.greeting === DEF.greeting) $('#greeting').value = MC().greeting;
      if (!inv.question || inv.question === DEF.question) $('#question').value = MC().question;
    }
    $('#title').value = inv.title || MC().title || '';
    state.cat = K.CATS[inv.cat] ? inv.cat : 'line';
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
  function readForm() {
    const v = id => $('#' + id).value.trim();
    const levels = {};
    $$('#levels input').forEach(i => { levels[i.id.slice(3)] = i.checked; });
    const dmode = ($('input[name="dmode"]:checked') || {}).value || 'next';
    const inv = {
      me: v('me') || 'Я', catName: v('catName') || 'Мурчик',
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
    if (isGroup()) {
      // стандартные тексты режима не кладём в ссылку — игра подставит их сама
      if (inv.greeting === MC().greeting) inv.greeting = DEF.greeting;
      if (inv.question === MC().question) inv.question = DEF.question;
      Object.assign(inv, {
        mode: state.mode,
        title: v('title') || MC().title,
        opts: $$('#planPick button.on').map(b => ({ plan: b.dataset.gplan })).concat(readList('opts')),
      });
    } else {
      Object.assign(inv, {
        her: v('her') || 'Солнышко', signature: v('signature'), finale: v('finale'),
        places: readList('places'),
        placeSurprise: $('#placeSurprise').checked,
        placeCustom: $('#placeCustom').checked,
        dateOther: $('#dateOther').checked,
        time: { from: v('tFrom') || '12:00', to: v('tTo') || '22:00', step: +v('tStep') || 30, def: v('tDef') || '19:00' },
        food: readList('food'),
      });
      const tgu = K.tgUser(v('tgu'));
      if (tgu) inv.tgu = tgu;
    }
    if (ownerKey() && relayUrl()) inv.tg = 1;
    return inv;
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
      lv.push('💌');
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
    ls.set(DRAFT, JSON.stringify(inv));
    dateInfo(inv);
    pvSteps(inv);
    renderPlanPickers();
    code = await K.encodeInvite(K.diffInvite(inv, DEF));
    $('#link').value = realLink();
    $('#linkLen').textContent = `Длина ссылки: ${realLink().length} символов`;
    reloadPreview();
  }, 450);

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
    registerIds([K.hash(code)]);
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
  function registerIds(ids) {
    if (!relayUrl() || !ownerKey() || !ids.length) return Promise.resolve(false);
    return K.relayRegister(relayUrl(), ownerKey(), ids);
  }
  function registerHistory() {
    const ids = histList().map(x => K.readHash('#' + (x.link.split('#')[1] || '')).code).filter(Boolean).map(K.hash);
    return registerIds(ids);
  }
  function tgStatus() {
    const el = $('#tgStatus');
    const url = relayUrl(), key = ownerKey();
    el.className = url && key ? 'status ok' : 'status';
    el.textContent = !url
      ? 'Посредник не настроен. Ответы всё равно придут: человек отправит тебе ссылку-билет.'
      : key ? '✓ Ключ сохранён — ответы на твои приглашения будут приходить в Telegram.'
        : 'Посредник подключён. Введи ключ владельца, чтобы ответы на твои приглашения приходили тебе в Telegram.';
    $('#tgTest').disabled = !url || !key;
    $('#ownerKey').value = key;
  }
  async function tgTest() {
    try {
      const r = await fetch(relayUrl(), { method: 'POST', body: JSON.stringify({ action: 'test', key: ownerKey() }) });
      const j = await r.json();
      toast(j.ok ? 'Отправлено — проверь Telegram ✓' : 'Ключ не подошёл — проверь его');
    } catch (e) { toast('Не удалось связаться с посредником'); }
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
    if (pl.mode !== state.mode) switchMode(pl.mode);
    if (pl.mode === 'date') {
      if (!$(`#places .li[data-plan="${pl.id}"]`)) $('#places').insertAdjacentHTML('afterbegin', itemRow({ plan: pl.id }, 'places'));
      $('#lv-place').checked = true;
    } else {
      const sel = new Set([pl.id].concat($$('#planPick button.on').map(b => b.dataset.gplan)));
      K.kuda().scenarios.filter(s => s.mode === pl.mode && !sel.has(s.id)).slice(0, Math.max(0, 3 - sel.size)).forEach(s => sel.add(s.id));
      renderPlanPickers(sel);
    }
    toast(`Добавил план «${pl.title}» ✓`);
    history.replaceState(null, '', 'create.html');
  }

  /* ---------- запуск ---------- */
  function init() {
    $('#weekdays').innerHTML = WEEK.map(([n, t]) => `<label class="chip"><input type="checkbox" value="${n}"><span>${t}</span></label>`).join('');

    let draft = null;
    try { draft = JSON.parse(ls.get(DRAFT) || 'null'); } catch (e) { /* пусто */ }
    fillForm(draft || DEF);
    tgStatus();
    renderHist();
    initEmojiBar();

    const form = $('#form');
    form.addEventListener('input', e => {
      if (e.target.id === 'ownerKey') return;
      if (!e.target.closest('#tg')) update();
    });
    form.addEventListener('change', e => {
      if (e.target.id === 'ownerKey') {
        ls.set(OWNER, e.target.value.trim());
        tgStatus();
        if (ownerKey()) registerHistory().then(ok => toast(ok ? 'Ключ подошёл ✓ Старые приглашения тоже подключены' : 'Ключ не подошёл — проверь его'));
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
      const dp = t.closest('[data-dplan]');
      if (dp) {
        const row = $(`#places .li[data-plan="${dp.dataset.dplan}"]`);
        if (row) row.remove(); else $('#places').insertAdjacentHTML('beforeend', itemRow({ plan: dp.dataset.dplan }, 'places'));
        update(); return;
      }
      const gp = t.closest('[data-gplan]');
      if (gp) { gp.classList.toggle('on'); update(); return; }
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
      toast(await copyText(realLink()) ? (isGroup() ? 'Ссылка скопирована — кидай в общий чат 💬' : 'Ссылка скопирована 💌 Отправь её ей!') : 'Скопируй ссылку вручную');
    };
    $('#share').onclick = async () => {
      remember();
      const text = isGroup() ? `${MC().emoji} ${$('#title').value || MC().title} — голосуем, куда и когда идём!` : 'У меня для тебя кое-что есть 💌';
      if (navigator.share) { try { await navigator.share({ title: text, text, url: realLink() }); return; } catch (e) { if (e.name === 'AbortError') return; } }
      toast(await copyText(realLink()) ? 'Ссылка скопирована' : 'Скопируй ссылку вручную');
    };
    $('#open').onclick = () => { remember(); window.open(realLink(), '_blank'); };
    $('#openPv').onclick = () => window.open(previewLink(pvStep), '_blank');
    $('#mbPv').onclick = () => window.open(previewLink(0), '_blank');
    $('#mbCopy').onclick = () => $('#copy').click();
    $('#tgu').addEventListener('change', () => {
      const raw = $('#tgu').value.trim(), u = K.tgUser(raw);
      if (raw && !u) toast('Ник в Telegram: латиница, цифры и _, от 5 символов');
      else if (u) $('#tgu').value = '@' + u;
    });
    $('#reset').onclick = () => {
      if (!confirm('Сбросить форму к настройкам из config.js?')) return;
      try { localStorage.removeItem(DRAFT); } catch (e) { /* ок */ }
      state.texts = {};
      fillForm(DEF); update();
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
    update();
  }

  init();
})();

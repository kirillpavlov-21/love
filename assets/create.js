/* Конструктор: форма → приглашение → ссылка #i=... */
(function () {
  'use strict';

  const K = window.DateKit;
  const CFG = window.DATE_CONFIG || {};
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = K.esc;
  const DRAFT = 'date-constructor-draft';
  const HIST = 'date-constructor-history';

  const LEVELS = [
    ['hearts', '❤️ Поймай сердечки', 'мини-игра: котик ловит сердечки в корзинку'],
    ['letter', '💌 Письмо с вопросом', '«Пойдёшь со мной на свидание?» и кнопки Да/Нет'],
    ['place', '🎈 Шарики с местами', 'она лопает шарик с местом'],
    ['date', '📅 Календарь', 'ставит сердечко на удобный день'],
    ['time', '🌇 Время', 'слайдер с небом: утро → ночь'],
    ['food', '🍕 Свайпы еды', 'вправо — хочу, влево — нет'],
  ];
  const CAT_NAMES = { ginger: 'Рыжий', grey: 'Серый', white: 'Белый', black: 'Чёрный' };
  const THEME_INFO = {
    pink: ['Розовая', 'linear-gradient(135deg,#ffd2df,#ff4f86)'],
    lavender: ['Лаванда', 'linear-gradient(135deg,#e2d8ff,#7b5cff)'],
    peach: ['Персик', 'linear-gradient(135deg,#ffdcc9,#ff6848)'],
    mint: ['Мята', 'linear-gradient(135deg,#d3f1e6,#ff5a7c)'],
  };
  const WEEK = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Вс']];
  const EMOJIS = '☕ 🎬 🌳 🍝 ⛸️ 🎡 🎳 🎤 🖼️ 🌊 🍷 🎭 🏛️ 🚲 🌅 🎨 📚 🎮 🧗 🛶 🏖️ 🍕 🍣 🍔 🥐 🍜 🥩 🥗 🍰 🍦 🧋 🍫 🌮 🥟 🍤 🍓 🍿'.split(' ');

  let state = { cat: 'ginger', theme: 'pink' };
  let code = '';
  let pvStep = 0;
  let pvCounter = 0;

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

  /* ---------- списки: места, еда, даты ---------- */
  function itemRow(it, kind) {
    return `<div class="li">
      <input class="em" value="${esc(it.emoji || '')}" maxlength="8" aria-label="Эмодзи" placeholder="🙂">
      <div class="li-main">
        <input class="ti" value="${esc(it.title || '')}" maxlength="40" placeholder="${kind === 'places' ? 'Название места' : 'Блюдо'}">
        <input class="no" value="${esc(it.note || '')}" maxlength="90" placeholder="Подпись (необязательно)">
      </div>
      <button class="del" type="button" title="Удалить">✕</button>
    </div>`;
  }
  const dateRow = d => `<div class="li date-li"><input class="dt" type="date" value="${esc(d || '')}"><button class="del" type="button" title="Удалить">✕</button></div>`;
  function renderList(id, items) {
    const box = $('#' + id);
    box.innerHTML = id === 'dates' ? items.map(dateRow).join('') : items.map(it => itemRow(it, id)).join('');
  }
  function readList(id) {
    return $$('.li', $('#' + id)).map(r => {
      const o = { emoji: $('.em', r).value.trim(), title: $('.ti', r).value.trim() };
      const note = $('.no', r).value.trim();
      if (note) o.note = note;
      return o;
    }).filter(o => o.title);
  }

  /* ---------- форма ⇄ приглашение ---------- */
  function fillForm(inv) {
    inv = K.merge(K.BASE, inv);
    ['her', 'me', 'catName', 'greeting', 'question', 'signature', 'finale'].forEach(k => { $('#' + k).value = inv[k] || ''; });
    state.cat = K.CATS[inv.cat] ? inv.cat : 'ginger';
    state.theme = K.THEMES.includes(inv.theme) ? inv.theme : 'pink';
    renderSwatches();
    LEVELS.forEach(([id]) => { $('#lv-' + id).checked = (inv.levels || {})[id] !== false; });
    $('#heartsGoal').value = inv.heartsGoal || 12;
    $('#noButton').value = inv.noButton === 'real' ? 'real' : 'runaway';
    renderList('places', inv.places || []);
    $('#placeSurprise').checked = !!inv.placeSurprise;
    $('#placeCustom').checked = !!inv.placeCustom;
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
  }
  function readForm() {
    const v = id => $('#' + id).value.trim();
    const levels = {};
    LEVELS.forEach(([id]) => { levels[id] = $('#lv-' + id).checked; });
    const mode = ($('input[name="dmode"]:checked') || {}).value || 'next';
    return {
      her: v('her') || 'Солнышко', me: v('me') || 'Я', catName: v('catName') || 'Мурчик',
      cat: state.cat, theme: state.theme,
      greeting: v('greeting'), question: v('question'), signature: v('signature'), finale: v('finale'),
      levels,
      heartsGoal: Math.max(3, Math.min(50, parseInt(v('heartsGoal'), 10) || 12)),
      noButton: v('noButton'),
      places: readList('places'),
      placeSurprise: $('#placeSurprise').checked,
      placeCustom: $('#placeCustom').checked,
      dates: {
        mode,
        start: mode === 'next' ? v('dStart') : '',
        days: Math.max(1, Math.min(60, parseInt(v('dDays'), 10) || 14)),
        skipWeekdays: $$('#weekdays input').filter(c => !c.checked).map(c => +c.value),
        list: mode === 'list' ? $$('#dates .dt').map(i => i.value).filter(Boolean) : [],
      },
      dateOther: $('#dateOther').checked,
      time: { from: v('tFrom') || '12:00', to: v('tTo') || '22:00', step: +v('tStep') || 30, def: v('tDef') || '19:00' },
      food: readList('food'),
    };
  }

  function renderSwatches() {
    $('#cats').innerHTML = Object.keys(K.CATS).map(c =>
      `<button type="button" class="sw ${c === state.cat ? 'on' : ''}" data-cat="${c}" style="${K.catVars(c)}">${K.catSVG('normal')}${CAT_NAMES[c]}</button>`).join('');
    $('#themes').innerHTML = K.THEMES.map(t =>
      `<button type="button" class="sw ${t === state.theme ? 'on' : ''}" data-theme="${t}"><div class="theme-dot" style="background:${THEME_INFO[t][1]}"></div>${THEME_INFO[t][0]}</button>`).join('');
  }
  function syncDateMode() {
    const mode = ($('input[name="dmode"]:checked') || {}).value;
    $('#dNext').classList.toggle('hidden', mode === 'list');
    $('#dList').classList.toggle('hidden', mode !== 'list');
  }
  function dateInfo(inv) {
    const days = K.listDates(inv.dates);
    const box = $('#dateInfo');
    if (!days.length) { box.textContent = '⚠️ Сейчас не получится ни одного дня — она увидит поле «напиши, когда удобно».'; return; }
    const f = s => { const d = K.parseYmd(s); return d.getDate() + '.' + String(d.getMonth() + 1).padStart(2, '0'); };
    box.textContent = `В календаре будет ${days.length} ${days.length % 10 === 1 && days.length % 100 !== 11 ? 'день' : (days.length % 10 >= 2 && days.length % 10 <= 4 && (days.length % 100 < 10 || days.length % 100 >= 20)) ? 'дня' : 'дней'}: ${f(days[0])} — ${f(days[days.length - 1])}` +
      (inv.dates.mode === 'next' && !inv.dates.start ? ' (считается от дня, когда она откроет ссылку)' : '');
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
    const lv = LEVELS.filter(([id]) => on[id] !== false &&
      !(id === 'food' && !(inv.food || []).length) &&
      !(id === 'place' && !(inv.places || []).length && !inv.placeCustom && !inv.placeSurprise));
    const items = [['Старт', 0]].concat(lv.map((l, i) => [String(i + 1) + ' ' + l[1].split(' ')[0], i + 1]), [['🎫 Финал', lv.length + 1]]);
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
    try { localStorage.setItem(DRAFT, JSON.stringify(inv)); } catch (e) { /* ок */ }
    dateInfo(inv);
    pvSteps(inv);
    code = await K.encodeInvite(K.diffInvite(inv, K.defaults()));
    $('#link').value = realLink();
    $('#linkLen').textContent = `Длина ссылки: ${realLink().length} символов`;
    reloadPreview();
  }, 450);

  function remember() {
    const inv = readForm();
    let list = [];
    try { list = JSON.parse(localStorage.getItem(HIST) || '[]'); } catch (e) { /* пусто */ }
    const link = realLink();
    list = list.filter(x => x.link !== link && !(x.her === inv.her && Date.now() - x.at < 60 * 60 * 1000));
    list.unshift({ her: inv.her, link, at: Date.now() });
    try { localStorage.setItem(HIST, JSON.stringify(list.slice(0, 30))); } catch (e) { /* ок */ }
    renderHist();
  }
  function renderHist() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(HIST) || '[]'); } catch (e) { /* пусто */ }
    $('#hist').innerHTML = list.length ? list.map((x, i) => `
      <div class="hist-item">
        <b>${esc(x.her)}<small>${new Date(x.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></b>
        <button class="btn" data-h="copy" data-i="${i}">Копировать</button>
        <button class="btn" data-h="load" data-i="${i}">В форму</button>
        <button class="btn" data-h="del" data-i="${i}">✕</button>
      </div>`).join('') : '<p class="hint">Пока пусто.</p>';
    $('#hist')._list = list;
  }

  /* ---------- Telegram (через посредника) ---------- */
  function tgStatus() {
    const url = (CFG.telegram || {}).relayUrl;
    const el = $('#tgStatus');
    el.className = url ? 'status ok' : 'status';
    el.textContent = url
      ? '✓ Посредник подключён — ответы будут приходить тебе в Telegram.'
      : 'Посредник не настроен. Ответы всё равно можно получить: в финале у неё будет кнопка «Отправить ответ».';
    $('#tgTest').disabled = !url;
  }
  async function tgTest() {
    const ok = await K.relaySend((CFG.telegram || {}).relayUrl, '✅ <b>Тест из конструктора</b>: всё работает 💌');
    toast(ok ? 'Отправлено — проверь Telegram ✓' : 'Не получилось. Проверь адрес посредника в config.js');
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

  /* ---------- запуск ---------- */
  function init() {
    $('#levels').innerHTML = LEVELS.map(([id, t, d]) =>
      `<label class="tg"><input type="checkbox" id="lv-${id}"><span></span><b>${t}</b><i>${d}</i></label>`).join('');
    $('#weekdays').innerHTML = WEEK.map(([n, t]) => `<label class="chip"><input type="checkbox" value="${n}"><span>${t}</span></label>`).join('');

    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(DRAFT) || 'null'); } catch (e) { /* пусто */ }
    fillForm(draft || K.defaults());
    tgStatus();
    renderHist();
    initEmojiBar();

    const form = $('#form');
    form.addEventListener('input', e => { if (!e.target.closest('#tg')) update(); });
    form.addEventListener('change', e => {
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
    $('#pvSteps').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      pvStep = +b.dataset.step;
      $$('#pvSteps button').forEach(x => x.classList.toggle('on', x === b));
      reloadPreview();
    });

    $('#copy').onclick = async () => { remember(); toast(await copyText(realLink()) ? 'Ссылка скопирована 💌 Отправь её ей!' : 'Скопируй ссылку вручную'); };
    $('#share').onclick = async () => {
      remember();
      if (navigator.share) { try { await navigator.share({ title: '💌', text: 'У меня для тебя кое-что есть 💌', url: realLink() }); return; } catch (e) { if (e.name === 'AbortError') return; } }
      toast(await copyText(realLink()) ? 'Ссылка скопирована' : 'Скопируй ссылку вручную');
    };
    $('#open').onclick = () => { remember(); window.open(realLink(), '_blank'); };
    $('#openPv').onclick = () => window.open(previewLink(pvStep), '_blank');
    $('#reset').onclick = () => {
      if (!confirm('Сбросить форму к настройкам из config.js?')) return;
      try { localStorage.removeItem(DRAFT); } catch (e) { /* ок */ }
      fillForm(K.defaults()); update();
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
          fillForm(K.merge(K.defaults(), await K.decodeInvite(c))); update();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          toast('Загрузил в форму ✓');
        } catch (err) { toast('Не удалось прочитать ссылку'); }
      }
      if (b.dataset.h === 'del') {
        list.splice(+b.dataset.i, 1);
        try { localStorage.setItem(HIST, JSON.stringify(list)); } catch (err) { /* ок */ }
        renderHist();
      }
    });

    addEventListener('resize', debounce(reloadPreview, 400));
    update();
  }

  init();
})();

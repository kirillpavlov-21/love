/* Главная «Куда идём?»: режимы, готовые планы, 18+ */
(function () {
  'use strict';

  const K = window.DateKit;
  const D = K.kuda();
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = K.esc;
  const I = K.icon;
  const ORDER = ['date', 'guys', 'girls'];
  const HERO = {
    date: {
      eyebrow: 'Игра-приглашение',
      title: 'Позови на свидание игрой',
      text: 'Она ловит сердечки, открывает письмо и сама выбирает место, день и время. Ответ придёт тебе.',
      cta: 'Создать приглашение',
      call: 'Позвать на свидание сюда',
    },
    guys: {
      eyebrow: 'Сбор компании',
      title: 'Собери пацанов без споров в чате',
      text: 'Скинь ссылку — каждый отметит, куда и в какие дни может. Сразу видно, что побеждает.',
      cta: 'Собрать пацанов',
      call: 'Позвать пацанов сюда',
    },
    girls: {
      eyebrow: 'Девичник',
      title: 'Собери подружек на девичник',
      text: 'Мини-игра с голосованием: каждая выбирает места и дни, а итоги видны всем.',
      cta: 'Собрать подружек',
      call: 'Позвать подружек сюда',
    },
  };
  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
  };

  let mode = new URLSearchParams(location.search).get('m');
  if (!ORDER.includes(mode)) {
    try { mode = localStorage.getItem('kuda-mode'); } catch (e) { /* приватный режим */ }
  }
  if (!ORDER.includes(mode)) mode = 'date';
  document.documentElement.style.cssText += ';' + K.catVars('line');

  function toast(t) {
    const el = $('#toast');
    el.textContent = t;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 2400);
  }
  function planMeta(plan) {
    const st = K.planStops(plan);
    const legs = [];
    for (let i = 1; i < st.length; i++) legs.push(K.walkMin(st[i - 1], st[i]));
    const price = Math.max(...st.map(p => p.price || 1));
    return { st, legs, price };
  }
  const createUrl = (m, planId) => `create.html?mode=${m}` + (planId ? `&plan=${encodeURIComponent(planId)}` : '');
  /* Демо-приглашение для каждого режима: открывается как превью — ничего не отправляется */
  const DEMO = {};
  async function demoUrl(m) {
    if (!DEMO[m]) {
      const inv = m === 'date' ? {} : { mode: m, theme: K.MODES[m].theme, opts: D.scenarios.filter(s => s.mode === m).slice(0, 3).map(s => ({ plan: s.id })) };
      DEMO[m] = 'index.html#' + await K.encodeInvite(inv) + '&p=1';
    }
    return DEMO[m];
  }
  const kindLow = s => String(s || '').split(' · ')[0].toLowerCase();
  const hasTag = (p, t) => (p.tags || []).includes(t);
  const FILTERS = [
    ['all', 'Все', () => true],
    ['day', 'Днём', p => ['утро', 'день'].includes(p.when)],
    ['eve', 'Вечером', p => ['закат', 'вечер', 'ночь'].includes(p.when)],
    ['cheap', 'Недорого', p => planMeta(p).price <= 1],
    ['active', 'Активно', p => hasTag(p, 'active')],
    ['culture', 'Культура', p => hasTag(p, 'culture')],
    ['view', 'С видом', p => hasTag(p, 'view')],
  ];
  let flt = 'all';

  function renderModes() {
    $('#modes').innerHTML = ORDER.map(m => {
      const c = K.MODES[m];
      return `<button type="button" data-m="${m}" class="${m === mode ? 'on' : ''}" aria-pressed="${m === mode}">${I(K.MODE_ICON[m])}${c.label}</button>`;
    }).join('');
  }
  function renderHero() {
    const h = HERO[mode];
    $('#hero').innerHTML = `
      <div class="cat-slot">${K.catSVG('normal')}</div>
      <p class="eyebrow">${h.eyebrow}</p>
      <h1>${h.title}</h1>
      <p>${h.text}</p>
      <div class="hero-actions">
        <a class="btn primary" href="${createUrl(mode)}">${h.cta}${I('arrow')}</a>
        <a class="btn ghost demo" href="#" target="_blank" rel="noopener">${I('eye')}Посмотреть пример</a>
      </div>
      <p class="usp"><span>${I('check')}Бесплатно</span><span>${I('check')}Без регистрации</span><span>${I('check')}Реальные места с маршрутом</span></p>`;
    const demo = $('#hero .demo'), m = mode;
    demoUrl(m).then(u => { if (m === mode) demo.href = u; });
  }
  function routeHtml(st, legs) {
    return st.map((p, i) => (i ? `<span class="dash"></span><span class="walk">${legs[i - 1]} мин пешком</span>` : '') +
      `<span class="dot${i ? ' o' : ''}"></span><span class="stop-name">${esc(p.name)} <span>· ${esc(kindLow(p.kind))}</span></span>`).join('');
  }
  function renderFilters(all) {
    const avail = FILTERS.filter(([id, , fn]) => id === 'all' || all.some(fn));
    if (!avail.some(([id]) => id === flt)) flt = 'all';
    $('#filters').innerHTML = avail.map(([id, label]) =>
      `<button type="button" data-f="${id}" class="${id === flt ? 'on' : ''}" aria-pressed="${id === flt}">${label}</button>`).join('');
  }
  function renderCards() {
    const all = D.scenarios.filter(s => s.mode === mode);
    renderFilters(all);
    const fn = (FILTERS.find(f => f[0] === flt) || FILTERS[0])[2];
    const plans = all.filter(fn);
    $('#count').textContent = `${plans.length} ${plural(plans.length, 'план', 'плана', 'планов')}`;
    $('#cards').innerHTML = plans.map((p, i) => {
      const { st, legs, price } = planMeta(p);
      return `<button type="button" class="card" data-plan="${p.id}" style="animation-delay:${(Math.min(i, 8) * 0.05).toFixed(2)}s">
        <span class="card-head"><span class="ttl">${esc(p.title)}</span><span class="price">${K.priceText(price)}</span></span>
        <span class="route">${routeHtml(st, legs)}</span>
        <span class="chips">
          <span class="chip">${I('clock')}${esc(p.when)}</span>
          <span class="chip"><span class="metro">М</span>${esc(st[0] ? st[0].metro : '')}</span>
        </span>
      </button>`;
    }).join('');
    $('#adultBlock').classList.toggle('hidden', mode !== 'guys');
  }
  function renderAdult() {
    $('#adultCards').innerHTML = D.adult.map(K.placeById).filter(Boolean).map(p => `
      <div class="card" style="cursor:default">
        <span class="card-head"><span class="ttl">${esc(p.name)}</span><span class="chip a18">18+</span></span>
        <span class="walk">${esc(kindLow(p.kind))} · м. ${esc(p.metro)}</span>
        <span class="walk">${esc(p.note)}</span>
        <span class="chips"><a class="chip" href="${K.mapUrl(p)}" target="_blank" rel="noopener">${I('pin')}${esc(p.addr)}</a></span>
      </div>`).join('');
  }
  function apply() {
    document.documentElement.dataset.mode = mode;
    document.documentElement.dataset.acc = K.MODES[mode].acc || '';
    renderModes(); renderHero(); renderCards();
    $('#adultWrap').classList.add('hidden');
    $('#adultBtn').classList.remove('hidden');
  }

  function openPlan(id) {
    const plan = K.planById(id);
    if (!plan) return;
    const { st, legs, price } = planMeta(plan);
    const parts = st.map((p, i) => (i ? `<span class="dash"></span><span class="walk">${legs[i - 1]} мин пешком</span>` : '') + `
      <span class="dot${i ? ' o' : ''}"></span>
      <div class="stop">
        <b>${esc(p.name)}</b>
        <span class="k">${esc(p.kind)} · м. ${esc(p.metro)} · ${K.priceText(p.price)}</span>
        <p>${esc(p.note)}</p>
        <a href="${K.mapUrl(p)}" target="_blank" rel="noopener">${esc(p.addr)} — в Яндекс Картах${I('ext')}</a>
      </div>`).join('');
    $('#sheet').innerHTML = `
      <span class="grab"></span>
      <p class="eyebrow">${esc(plan.when)} · ${K.priceText(price)}</p>
      <h3>${esc(plan.title)}</h3>
      <p class="why">${esc(plan.why)}</p>
      <div class="itin">${parts}</div>
      <div class="sheet-actions">
        ${st.length > 1 ? `<a class="btn ghost wide" href="${K.routeUrl(st)}" target="_blank" rel="noopener">${I('route')}Маршрут через все точки</a>` : `<a class="btn ghost wide" href="${K.mapUrl(st[0])}" target="_blank" rel="noopener">${I('pin')}Открыть в Яндекс Картах</a>`}
        <a class="btn primary wide" href="${createUrl(mode, plan.id)}">${HERO[mode].call}${I('arrow')}</a>
      </div>`;
    $('#sheetBg').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  function closeSheets() {
    $('#sheetBg').classList.add('hidden');
    $('#ageBg').classList.add('hidden');
    document.body.style.overflow = '';
  }

  $('#modes').addEventListener('click', e => {
    const b = e.target.closest('button[data-m]');
    if (!b || b.dataset.m === mode) return;
    mode = b.dataset.m;
    flt = 'all';
    try { localStorage.setItem('kuda-mode', mode); } catch (err) { /* ок */ }
    history.replaceState(null, '', '?m=' + mode);
    apply();
  });
  $('#filters').addEventListener('click', e => {
    const b = e.target.closest('button[data-f]');
    if (!b || b.dataset.f === flt) return;
    flt = b.dataset.f;
    renderCards();
  });
  $('#random').onclick = () => {
    const fn = (FILTERS.find(f => f[0] === flt) || FILTERS[0])[2];
    let plans = D.scenarios.filter(s => s.mode === mode && fn(s));
    if (!plans.length) plans = D.scenarios.filter(s => s.mode === mode);
    const prev = $('#random')._last;
    let p;
    do { p = plans[(Math.random() * plans.length) | 0]; } while (plans.length > 1 && p.id === prev);
    $('#random')._last = p.id;
    openPlan(p.id);
  };
  $('#cards').addEventListener('click', e => {
    const c = e.target.closest('.card[data-plan]');
    if (c) openPlan(c.dataset.plan);
  });
  ['#sheetBg', '#ageBg'].forEach(sel => $(sel).addEventListener('click', e => { if (e.target === $(sel)) closeSheets(); }));
  addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets(); });

  let adultOk = false;
  try { adultOk = sessionStorage.getItem('kuda-18') === '1'; } catch (e) { /* ок */ }
  function showAdult() {
    renderAdult();
    $('#adultWrap').classList.remove('hidden');
    $('#adultBtn').classList.add('hidden');
  }
  $('#adultBtn').onclick = () => {
    if (adultOk) { showAdult(); return; }
    $('#ageBg').classList.remove('hidden');
  };
  $('#ageYes').onclick = () => {
    adultOk = true;
    try { sessionStorage.setItem('kuda-18', '1'); } catch (e) { /* ок */ }
    closeSheets();
    showAdult();
  };
  $('#ageNo').onclick = () => { closeSheets(); toast('Тогда подберём что-нибудь другое'); };

  apply();
})();

/* Главная «Куда идём?»: режимы, готовые планы, 18+ */
(function () {
  'use strict';

  const K = window.DateKit;
  const D = K.kuda();
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = K.esc;
  const ORDER = ['date', 'guys', 'girls'];
  const HERO = {
    date: {
      title: 'Позови на свидание игрой',
      text: 'Она ловит сердечки, открывает письмо и выбирает место, день и время. Ответ придёт тебе.',
      cta: '💌 Создать приглашение',
    },
    guys: {
      title: 'Собери пацанов без споров в чате',
      text: 'Скинь ссылку — каждый отметит, куда и в какие дни может. Сразу видно, что побеждает.',
      cta: '🍻 Собрать пацанов',
    },
    girls: {
      title: 'Собери подружек на девичник',
      text: 'Мини-игра с голосованием: каждая выбирает места и дни, а итоги видны всем.',
      cta: '💅 Собрать подружек',
    },
  };

  let mode = new URLSearchParams(location.search).get('m');
  if (!ORDER.includes(mode)) {
    try { mode = localStorage.getItem('kuda-mode'); } catch (e) { /* приватный режим */ }
  }
  if (!ORDER.includes(mode)) mode = 'date';

  function toast(t) {
    const el = $('#toast');
    el.textContent = t;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 2400);
  }
  function planMeta(plan) {
    const st = K.planStops(plan);
    let walk = 0;
    for (let i = 1; i < st.length; i++) walk += K.walkMin(st[i - 1], st[i]);
    const price = Math.max(...st.map(p => p.price || 1));
    return { st, walk, price };
  }
  const createUrl = (m, planId) => `create.html?mode=${m}` + (planId ? `&plan=${encodeURIComponent(planId)}` : '');

  function renderModes() {
    $('#modes').innerHTML = ORDER.map(m => {
      const c = K.MODES[m];
      return `<button type="button" data-m="${m}" class="${m === mode ? 'on' : ''}" aria-pressed="${m === mode}"><span>${c.emoji}</span>${c.label}</button>`;
    }).join('');
  }
  function renderHero() {
    const h = HERO[mode];
    $('#hero').innerHTML = `
      <div class="cat-slot">${K.catSVG('normal')}</div>
      <div>
        <h1>${h.title}</h1>
        <p>${h.text}</p>
        <a class="btn primary" href="${createUrl(mode)}">${h.cta}</a>
      </div>`;
  }
  function renderCards() {
    const plans = D.scenarios.filter(s => s.mode === mode);
    $('#cards').innerHTML = plans.map((p, i) => {
      const { st, walk, price } = planMeta(p);
      return `<button type="button" class="card" data-plan="${p.id}" style="animation-delay:${(i * 0.04).toFixed(2)}s">
        <div class="ce">${p.emoji}</div>
        <h3>${esc(p.title)}</h3>
        <div class="stops">${st.map(s => esc(s.name)).join(' → ')}</div>
        <div class="chips">
          <span class="chip">🕐 ${esc(p.when)}</span>
          <span class="chip">${K.priceText(price)}</span>
          ${st.length > 1 ? `<span class="chip">🚶 ${walk} мин</span>` : ''}
          <span class="chip">Ⓜ️ ${esc(st[0] ? st[0].metro : '')}</span>
        </div>
      </button>`;
    }).join('');
    $('#adultBlock').classList.toggle('hidden', mode !== 'guys');
  }
  function renderAdult() {
    $('#adultCards').innerHTML = D.adult.map(K.placeById).filter(Boolean).map(p => `
      <div class="card" style="cursor:default">
        <div class="ce">${p.emoji}</div>
        <h3>${esc(p.name)}</h3>
        <div class="stops">${esc(p.kind)} · Ⓜ️ ${esc(p.metro)}</div>
        <p class="muted">${esc(p.note)}</p>
        <div class="chips"><span class="chip a18">18+</span><a class="chip" href="${K.mapUrl(p)}" target="_blank" rel="noopener">📍 Яндекс Карты</a></div>
      </div>`).join('');
  }
  document.documentElement.style.cssText += ';' + K.catVars('ginger');

  function apply() {
    document.documentElement.dataset.theme = K.MODES[mode].theme;
    document.documentElement.dataset.acc = K.MODES[mode].acc || '';
    renderModes(); renderHero(); renderCards();
    $('#adultCards').classList.add('hidden');
    $('#adultBtn').classList.remove('hidden');
  }

  function openPlan(id) {
    const plan = K.planById(id);
    if (!plan) return;
    const { st } = planMeta(plan);
    const parts = [];
    st.forEach((p, i) => {
      if (i) parts.push(`<div class="walk">🚶 ~${K.walkMin(st[i - 1], p)} мин пешком</div>`);
      parts.push(`<div class="stop">
        <div class="se">${p.emoji}</div>
        <div>
          <b>${esc(p.name)}</b>
          <span class="k">${esc(p.kind)} · Ⓜ️ ${esc(p.metro)} · ${K.priceText(p.price)}</span>
          <p>${esc(p.note)}</p>
          <a href="${K.mapUrl(p)}" target="_blank" rel="noopener">📍 ${esc(p.addr)} — открыть в Яндекс Картах</a>
        </div>
      </div>`);
    });
    const ctaText = mode === 'date' ? '💌 Позвать на свидание с этим планом' : mode === 'guys' ? '🍻 Позвать пацанов сюда' : '💅 Позвать подружек сюда';
    $('#sheet').innerHTML = `
      <div class="grab"></div>
      <h3>${plan.emoji} ${esc(plan.title)}</h3>
      <p class="why">${esc(plan.why)}</p>
      ${parts.join('')}
      <div class="sheet-actions">
        <a class="btn ghost wide" href="${K.routeUrl(st)}" target="_blank" rel="noopener">🧭 Маршрут через все точки</a>
        <a class="btn primary wide" href="${createUrl(mode, plan.id)}">${ctaText}</a>
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
    try { localStorage.setItem('kuda-mode', mode); } catch (err) { /* ок */ }
    history.replaceState(null, '', '?m=' + mode);
    apply();
  });
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
    $('#adultCards').classList.remove('hidden');
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
  $('#ageNo').onclick = () => { closeSheets(); toast('Тогда подберём что-нибудь другое 😉'); };

  apply();
})();

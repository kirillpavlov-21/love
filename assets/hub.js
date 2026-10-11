/* Главная «Куда идём?»: режимы, готовые планы, 18+ */
(function () {
  'use strict';

  const K = window.DateKit;
  const D = K.kuda();
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
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
  const phStrip = st => { const ph = st.map(K.photo).filter((x, i, a) => x && a.findIndex(y => y && y.u === x.u) === i).slice(0, 3);
    return ph.length ? `<span class="card-ph n${ph.length}" aria-hidden="true">${ph.map(x => `<img src="${ph.length < 3 ? x.s : x.t}" alt="" loading="lazy" decoding="async">`).join('')}</span>` : ''; };
  const emoTile = p => { const ph = K.photo(p);
    return `<span class="pl-emo${ph ? ' ph' : ''}" aria-hidden="true">${ph ? `<img src="${ph.t}" alt="" loading="lazy" decoding="async">` : esc(p.emoji)}</span>`; };
  const heroPh = (ph, alt) => ph ? `<figure class="hero-ph"><img src="${ph.s}" alt="${esc(alt)}" decoding="async"><figcaption>${K.photoCredit(ph)}</figcaption></figure>` : '';
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
  /* Подсказки к планам и местам («🍂 Красиво осенью», «💘 Для первого свидания»…) — в shared.js */
  const SEASON = K.seasonHints();
  const hasHint = (p, h) => K.planHints(p).includes(h);
  const HFILTERS = [
    ['autumn', '🍂 Осень', p => hasHint(p, 'autumn')],
    ['halloween', '🎃 Хэллоуин', p => hasHint(p, 'halloween')],
  ];
  const FILTERS = [
    ['all', 'Все', () => true],
    ...HFILTERS,
    ['first', '💘 Первое свидание', p => hasHint(p, 'first')],
    ['rain', '☔ Если дождь', p => hasHint(p, 'rain')],
    ['day', 'Днём', p => ['утро', 'день'].includes(p.when)],
    ['eve', 'Вечером', p => ['закат', 'вечер', 'ночь'].includes(p.when)],
    ['cheap', 'Недорого', p => planMeta(p).price <= 1],
    ['active', 'Активно', p => hasTag(p, 'active')],
    ['culture', 'Культура', p => hasTag(p, 'culture')],
    ['view', 'С видом', p => hasTag(p, 'view')],
  ];
  let flt = 'all';

  /* ---------- каталог «Все места» ---------- */
  const PCATS = [['all', 'Все'], ['autumn', '🍂 Осень'], ['halloween', '🎃 Хэллоуин'], ['first', '💘 Для первого свидания'], ['walk', 'Прогулки'], ['culture', 'Культура'], ['food', 'Рестораны'], ['michelin', 'Michelin'],
    ['coffee', 'Кофе'], ['bar', 'Бары'], ['fun', 'Развлечения'], ['spa', 'Бани и спа'], ['books', 'Книжные']];
  /* Округа Москвы (поле okr у места) */
  const OKRS = [['all', 'Вся Москва'], ['center', 'Центр'], ['north', 'Север'], ['ne', 'Северо-Восток'], ['east', 'Восток'],
    ['se', 'Юго-Восток'], ['south', 'Юг'], ['sw', 'Юго-Запад'], ['west', 'Запад'], ['nw', 'Северо-Запад'],
    ['zel', 'Зеленоград'], ['new', 'Новая Москва'], ['mo', 'Подмосковье']];
  const OKR_NAME = Object.fromEntries(OKRS);
  const MICH = { 2: 'Две звезды Michelin 2021', 1: 'Звезда Michelin 2021', bib: 'Bib Gourmand Michelin 2021', rec: 'В гиде Michelin 2021' };
  const CAT_BY_KIND = [
    ['books', /книж/i], ['spa', /бан|спа|хамам|аквапарк|терм/i], ['coffee', /коф|пекар|кондитер|булоч|чайн/i],
    ['fun', /тир|боулинг|картинг|vr|квест|скалодром|падел|стендап|бильярд|караоке|аттракц|развлеч|теплоход|студи|мастер|арт-вечер|танц|стадион|петанк/i],
    ['culture', /музе|театр|кино|галере|планетар|концерт|дом культуры|культурн|центр|искусств|лекторий|архитектур/i],
    ['walk', /парк|сад|набереж|усадьб|заповедник|смотров|квартал|дизайн-завод|креатив/i],
    ['bar', /бар|паб|лаунж|винотек|крафт/i], ['food', /.*/],
  ];
  const catOf = p => p.cat || (CAT_BY_KIND.find(([, rx]) => rx.test(p.kind)) || ['food'])[0];
  const PLACES = Object.entries(D.places).filter(([, p]) => !p.adult).map(([id, p]) => Object.assign({ id, c: catOf(p) }, p))
    .sort((a, b) => (!!b.ph - !!a.ph) || a.name.replace(/^[^A-Za-zА-Яа-яЁё0-9]+/, '').localeCompare(b.name.replace(/^[^A-Za-zА-Яа-яЁё0-9]+/, ''), 'ru'));
  const PSTEP = 24;
  let pcat = 'all', pokr = 'all', pq = '', plimit = PSTEP, pview = 'list';
  const norm = t => String(t || '').toLowerCase().replace(/ё/g, 'е');

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
  /* на карточке — до трёх подсказок; «недорого» и так видно по цене */
  const cardHints = p => K.planHints(p).filter(h => h !== 'budget').slice(0, 3).map(h => K.hintChip(h, 'short')).join('');
  const sheetHints = hs => hs.length ? `<p class="hints-line">${hs.map(h => K.hintChip(h)).join('')}</p>` : '';
  /* Сезонная плашка над планами: осенью — «где красиво», в октябре — ещё и Хэллоуин */
  const SEASON_TILES = {
    autumn: ['🍂', 'Куда пойти осенью', 'Парки, усадьбы и бульвары в листьях'],
    halloween: ['🎃', 'Тематично на Хэллоуин', 'Готика, бункеры, Булгаков и квесты'],
  };
  function renderSeason(all) {
    const tiles = SEASON.filter(h => SEASON_TILES[h]).map(h => [h, all.filter(p => hasHint(p, h)).length]).filter(x => x[1]);
    $('#season').innerHTML = tiles.map(([h, n]) => { const [e, t, d] = SEASON_TILES[h];
      return `<button type="button" class="season-tile s-${h}${flt === h ? ' on' : ''}" data-f="${h}"><span class="e">${e}</span><span><b>${t}</b><small>${d} · ${n} ${plural(n, 'план', 'плана', 'планов')}</small></span></button>`; }).join('');
    $('#season').classList.toggle('hidden', !tiles.length);
  }
  function renderFilters(all) {
    renderSeason(all);
    const avail = FILTERS.filter(([id, , fn]) => id === 'all' || all.some(fn));
    if (!avail.some(([id]) => id === flt)) flt = 'all';
    $('#filters').innerHTML = avail.map(([id, label]) =>
      `<button type="button" data-f="${id}" class="${id === flt ? 'on' : ''}" aria-pressed="${id === flt}">${label}</button>`).join('');
  }
  const CSTEP = 24;
  let climit = CSTEP;
  function renderCards() {
    const all = D.scenarios.filter(s => s.mode === mode);
    renderFilters(all);
    const fn = (FILTERS.find(f => f[0] === flt) || FILTERS[0])[2];
    // в сезон — подборки про осень и Хэллоуин, потом планы с фото, порядок внутри групп — как в подборке
    const inSeason = p => (p.tags || []).some(t => SEASON.includes(t));
    const plans = all.filter(fn).map((p, i) => [p, i]).sort((a, b) => (inSeason(b[0]) - inSeason(a[0])) || (!!K.planPhoto(b[0]) - !!K.planPhoto(a[0])) || a[1] - b[1]).map(x => x[0]);
    $('#count').textContent = `${plans.length} ${plural(plans.length, 'план', 'плана', 'планов')}`;
    const rest = plans.length - Math.min(climit, plans.length);
    $('#cmore').classList.toggle('hidden', rest <= 0);
    $('#cmore').textContent = `Показать ещё ${Math.min(rest, CSTEP)} из ${rest}`;
    $('#cards').innerHTML = plans.slice(0, climit).map((p, i) => {
      const { st, legs, price } = planMeta(p);
      return `<button type="button" class="card" data-plan="${p.id}" style="animation-delay:${(Math.min(i, 8) * 0.05).toFixed(2)}s">
        ${phStrip(st)}<span class="card-head"><span class="ttl">${esc(p.title)}</span><span class="price">${K.priceText(price)}</span></span>
        <span class="route">${routeHtml(st, legs)}</span>
        <span class="chips">
          <span class="chip">${I('clock')}${esc(p.when)}</span>
          <span class="chip"><span class="metro">М</span>${esc(st[0] ? st[0].metro : '')}</span>
          ${cardHints(p)}
        </span>
      </button>`;
    }).join('');
  }
  const ALABEL = { strip: 'Стриптиз', men: 'Мужской стриптиз', show: 'Бурлеск' };
  // мужской стриптиз — только у «Подружек», на свидание — только бурлеск; первая вкладка открывается по умолчанию
  const AMODES = { guys: ['strip', 'show'], girls: ['men', 'strip', 'show'], date: ['show'] };
  const ANOTE = {
    guys: 'Стриптиз-клубы и бурлеск-шоу.',
    girls: 'Мужской стриптиз для девичника, стриптиз-клубы и бурлеск-шоу.',
    date: 'Бурлеск-шоу с живым джазом — смелый, но красивый вечер вдвоём.',
  };
  const ABTN = { guys: 'Места 18+: стриптиз и бурлеск', girls: 'Места 18+: мужской стриптиз и бурлеск', date: 'Бурлеск-шоу 18+' };
  const ADULT = D.adult.map(id => Object.assign({ id }, K.placeById(id))).filter(p => p.name);
  let acat = (AMODES[mode] || AMODES.guys)[0];
  function renderAdult() {
    const list = ADULT.filter(p => p.a18 === acat);
    const cats = AMODES[mode] || AMODES.guys;
    const n = ADULT.filter(p => cats.includes(p.a18)).length;
    $('#afilters').classList.toggle('hidden', cats.length < 2);
    $('#afilters').innerHTML = cats.map(id =>
      `<button type="button" data-ac="${id}" class="${id === acat ? 'on' : ''}" aria-pressed="${id === acat}">${ALABEL[id]} · ${ADULT.filter(p => p.a18 === id).length}</button>`).join('');
    $('#acount').textContent = `${n} ${plural(n, 'место', 'места', 'мест')}`;
    $('#anote').textContent = (ANOTE[mode] || ANOTE.guys) + ' Только для взрослых: перед походом проверь условия входа и дресс-код.';
    $('#alist').innerHTML = list.map(p => `
      <button type="button" class="pl-item" data-pid="${p.id}">
        ${emoTile(p)}
        <span class="pl-main"><span class="pl-name">${esc(p.name)}</span><span class="pl-sub">${esc(p.kind.replace(' · 18+', ''))} · м. ${esc(p.metro)}</span></span>
        <span class="price">${K.priceText(p.price)}</span>
      </button>`).join('');
    const f = $('#afilters'), on = f.querySelector('.on');
    const fr = f.getBoundingClientRect(), r = on.getBoundingClientRect();
    if (r.right > fr.right - 20) f.scrollLeft += r.right - fr.right + 20;
    else if (r.left < fr.left + 20) f.scrollLeft -= fr.left + 20 - r.left;
  }
  /* ---------- карта мест: Leaflet + OpenStreetMap, грузится при первом открытии ---------- */
  let PLIST = [], MAP = null, MLAYER = null, leafletP = null;
  const CAT_COLOR = { walk: '#6EE7B7', culture: '#B9A1FF', food: '#FF6F91', coffee: '#FFA463', bar: '#F4C95D', fun: '#D7F25C', spa: '#7CC6FE', books: '#E8A3D8' };
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (leafletP) return leafletP;
    leafletP = new Promise((res, rej) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    return leafletP;
  }
  function renderMap() {
    loadLeaflet().then(() => {
      if (!MAP) {
        MAP = L.map('pmap', { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([55.751, 37.618], 10);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© участники OpenStreetMap' }).addTo(MAP);
        MAP.on('popupopen', e => {
          const b = e.popup.getElement().querySelector('[data-open-place]');
          if (b) b.onclick = () => openPlace(b.dataset.openPlace);
        });
      }
      if (MLAYER) MLAYER.remove();
      MLAYER = L.layerGroup(PLIST.map(p => L.circleMarker([p.lat, p.lon], {
        radius: 7, weight: 2, color: '#0F0E13', fillColor: CAT_COLOR[p.c] || '#FF6F91', fillOpacity: 0.95,
      }).bindPopup(`<b>${esc(p.name)}</b><br><span>${esc(p.kind)} · м. ${esc(p.metro)}</span><br><button type="button" class="map-open" data-open-place="${p.id}">Подробнее</button>`))).addTo(MAP);
      setTimeout(() => {
        MAP.invalidateSize();
        if (PLIST.length) MAP.fitBounds(L.latLngBounds(PLIST.map(p => [p.lat, p.lon])), { padding: [24, 24], maxZoom: 15 });
      }, 30);
    }).catch(() => { $('#pmap').innerHTML = '<p class="pl-empty">Карта не загрузилась. Проверьте интернет и попробуйте ещё раз.</p>'; });
  }

  const listHints = p => { const e = K.placeHints(p).filter(h => ['halloween', 'autumn', 'first'].includes(h)).map(h => K.HINTS[h][0]).join(''); return e ? e + ' ' : ''; };
  /* Пост о месте в Telegram-канале: встраиваем только по нажатию (Telegram в России — через VPN) */
  const tgBlock = p => p && K.tgOk(p.tg) ? `<div class="tg-post">
      <button type="button" class="btn ghost wide tg-load" data-tg="${esc(p.tg)}">${I('eye')}Фото из поста</button>
      <a class="tg-link" href="${K.tgUrl(p.tg)}" target="_blank" rel="noopener">Пост в канале «${esc(K.tgName(p.tg))}» в Telegram${I('ext')}</a>
      <div class="tg-box"></div></div>` : '';
  function renderPlaces() {
    const q = norm(pq).trim();
    const inCat = p => pcat === 'all' || (pcat === 'michelin' ? !!p.mich : K.HINTS[pcat] ? K.placeHints(p).includes(pcat) : p.c === pcat);
    const inQ = p => !q || norm(p.name + ' ' + p.kind + ' ' + p.metro + ' ' + p.addr + ' ' + (OKR_NAME[p.okr] || '')).includes(q);
    const base = PLACES.filter(p => inCat(p) && inQ(p));
    const list = base.filter(p => pokr === 'all' || p.okr === pokr);
    $('#pfilters').innerHTML = PCATS.map(([id, label]) =>
      `<button type="button" data-pc="${id}" class="${id === pcat ? 'on' : ''}" aria-pressed="${id === pcat}">${label}</button>`).join('');
    const cnt = {};
    base.forEach(p => { cnt[p.okr] = (cnt[p.okr] || 0) + 1; });
    $('#pokrs').innerHTML = OKRS.filter(([id]) => id === 'all' || cnt[id] || id === pokr).map(([id, label]) =>
      `<button type="button" data-po="${id}" class="${id === pokr ? 'on' : ''}" aria-pressed="${id === pokr}">${label}<span class="n">${id === 'all' ? base.length : (cnt[id] || 0)}</span></button>`).join('');
    PLIST = list;
    if (pview === 'map') { renderMap(); }
    $('#pcount').textContent = `${list.length} ${plural(list.length, 'место', 'места', 'мест')}`;
    $('#plist').innerHTML = list.length ? list.slice(0, plimit).map(p => `
      <button type="button" class="pl-item" data-pid="${p.id}">
        ${emoTile(p)}
        <span class="pl-main"><span class="pl-name">${esc(p.name)}${p.mich ? ' <span class="mich" title="' + MICH[p.mich] + '">M</span>' : ''}</span><span class="pl-sub">${listHints(p)}${esc(p.kind)} · м. ${esc(p.metro)}</span></span>
        <span class="price">${K.priceText(p.price)}</span>
      </button>`).join('') : '<p class="pl-empty">Ничего не нашлось. Попробуйте другое слово или категорию.</p>';
    const rest = list.length - Math.min(plimit, list.length);
    $('#pmore').classList.toggle('hidden', rest <= 0 || pview === 'map');
    $('#pmore').textContent = `Показать ещё ${Math.min(rest, PSTEP)} из ${rest}`;
  }
  function openPlace(id) {
    const p = K.placeById(id);
    if (!p) return;
    const inPlans = D.scenarios.filter(s => s.stops.includes(id));
    $('#sheet').innerHTML = `
      <span class="grab"></span>
      ${heroPh(K.photo(p), p.name)}
      <p class="eyebrow">${esc(p.kind)} · ${K.priceText(p.price)}${p.okr && OKR_NAME[p.okr] && p.okr !== 'all' ? ' · ' + esc(OKR_NAME[p.okr]) : ''}</p>
      <h3>${esc(p.name)}</h3>
      ${p.mich ? `<p class="mich-line"><span class="mich">M</span>${MICH[p.mich]}</p>` : ''}
      ${sheetHints(K.placeHints(p).filter(h => h !== 'michelin'))}
      <p class="why">${esc(p.note)}</p>
      ${tgBlock(p)}
      <div class="stop solo">
        <span class="k">м. ${esc(p.metro)}</span>
        <a href="${K.mapUrl(p)}" target="_blank" rel="noopener">${esc(p.addr)} — в Яндекс Картах${I('ext')}</a>
      </div>
      ${inPlans.length ? `<div class="in-plans"><p class="k">Есть в готовых планах</p>${inPlans.map(s =>
        `<button type="button" class="chip" data-open-plan="${s.id}">${esc(s.title)}</button>`).join('')}</div>` : ''}
      <div class="sheet-actions">
        <a class="btn ${p.adult ? 'primary' : 'ghost'} wide" href="${K.mapUrl(p)}" target="_blank" rel="noopener">${I('pin')}Открыть в Яндекс Картах</a>
        ${p.adult ? '' : `<a class="btn primary wide" href="${createUrl(mode, 'p-' + id)}">${HERO[mode].call}${I('arrow')}</a>`}
      </div>`;
    $('#sheetBg').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function apply() {
    document.documentElement.dataset.mode = mode;
    document.documentElement.dataset.acc = K.MODES[mode].acc || '';
    renderModes(); renderHero(); renderCards();
    acat = (AMODES[mode] || AMODES.guys)[0];
    $('#adultBtn').textContent = ABTN[mode] || ABTN.guys;
    if (!$('#adultWrap').classList.contains('hidden')) renderAdult();
  }

  function openPlan(id) {
    const plan = K.planById(id);
    if (!plan) return;
    const { st, legs, price } = planMeta(plan);
    const shown = new Set();
    const stopPh = p => { const ph = K.photo(p); if (!ph || shown.has(ph.u)) return ''; shown.add(ph.u);
      return `<figure class="stop-ph"><img src="${ph.s}" alt="${esc(p.name)}" loading="lazy" decoding="async"><figcaption>${K.photoCredit(ph)}</figcaption></figure>`; };
    const parts = st.map((p, i) => (i ? `<span class="dash"></span><span class="walk">${legs[i - 1]} мин пешком</span>` : '') + `
      <span class="dot${i ? ' o' : ''}"></span>
      <div class="stop">
        ${stopPh(p)}
        <b>${esc(p.name)}</b>
        <span class="k">${esc(p.kind)} · м. ${esc(p.metro)} · ${K.priceText(p.price)}</span>
        <p>${esc(p.note)}</p>
        <a href="${K.mapUrl(p)}" target="_blank" rel="noopener">${esc(p.addr)} — в Яндекс Картах${I('ext')}</a>
        ${tgBlock(p)}
      </div>`).join('');
    $('#sheet').innerHTML = `
      <span class="grab"></span>
      <p class="eyebrow">${esc(plan.when)} · ${K.priceText(price)}</p>
      <h3>${esc(plan.title)}</h3>
      ${sheetHints(K.planHints(plan).filter(h => !(h === 'first' && mode !== 'date')))}
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
    flt = 'all'; climit = CSTEP;
    try { localStorage.setItem('kuda-mode', mode); } catch (err) { /* ок */ }
    history.replaceState(null, '', '?m=' + mode);
    apply();
  });
  $('#pfilters').addEventListener('click', e => {
    const b = e.target.closest('button[data-pc]');
    if (!b || b.dataset.pc === pcat) return;
    pcat = b.dataset.pc; plimit = PSTEP;
    renderPlaces();
  });
  let pqTimer = 0;
  $('#psearch').addEventListener('input', e => {
    clearTimeout(pqTimer);
    pqTimer = setTimeout(() => { pq = e.target.value; plimit = PSTEP; renderPlaces(); }, 150);
  });
  $('#pmore').onclick = () => { plimit += PSTEP; renderPlaces(); };
  $('#cmore').onclick = () => { climit += CSTEP; renderCards(); };
  $('#pokrs').addEventListener('click', e => {
    const b = e.target.closest('button[data-po]');
    if (!b || b.dataset.po === pokr) return;
    pokr = b.dataset.po; plimit = PSTEP;
    renderPlaces();
  });
  $('#pview').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b || b.dataset.v === pview) return;
    pview = b.dataset.v;
    $$('#pview button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    $('#pmap').classList.toggle('hidden', pview !== 'map');
    $('#plist').classList.toggle('hidden', pview === 'map');
    $('#pmore').classList.toggle('hidden', pview === 'map' || PLIST.length <= plimit);
    if (pview === 'map') renderMap();
  });
  $('#afilters').addEventListener('click', e => {
    const b = e.target.closest('[data-ac]');
    if (!b) return;
    acat = b.dataset.ac;
    renderAdult();
  });
  $('#alist').addEventListener('click', e => {
    const b = e.target.closest('.pl-item[data-pid]');
    if (b) openPlace(b.dataset.pid);
  });
  $('#plist').addEventListener('click', e => {
    const b = e.target.closest('.pl-item[data-pid]');
    if (b) openPlace(b.dataset.pid);
  });
  $('#sheet').addEventListener('click', e => {
    const tg = e.target.closest('.tg-load');
    if (tg) { tg.classList.add('hidden'); K.tgEmbed($('.tg-box', tg.parentNode), tg.dataset.tg); return; }
    const b = e.target.closest('[data-open-plan]');
    if (b) openPlan(b.dataset.openPlan);
  });
  $('#filters').addEventListener('click', e => {
    const b = e.target.closest('button[data-f]');
    if (!b || b.dataset.f === flt) return;
    flt = b.dataset.f; climit = CSTEP;
    renderCards();
  });
  $('#season').addEventListener('click', e => {
    const b = e.target.closest('button[data-f]');
    if (!b) return;
    flt = b.dataset.f === flt ? 'all' : b.dataset.f; climit = CSTEP;
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
    $('#adultWrap').classList.remove('hidden');
    $('#adultBtn').classList.add('hidden');
    renderAdult();
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
  renderPlaces();
})();

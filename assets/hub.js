/* Главная «Куда идём?»: режимы, готовые планы, 18+ */
(function () {
  'use strict';

  const K = window.DateKit;
  const D = K.kuda();
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = K.esc;
  const I = K.icon;
  const CFG = window.DATE_CONFIG || {};
  const T = window.KudaTrack, G = window.KudaGeo, KM = window.KudaMap, AU = window.KudaAuth, GAL = window.KudaGallery;
  const todayYmd = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  /* Действующие промокоды заведений (assets/promos.js) */
  const PROMOS = (window.KUDA_PROMOS || []).filter(x => x && K.placeById(x.place) && (!x.until || x.until >= todayYmd));
  const promoOf = id => PROMOS.find(x => x.place === id) || null;
  /* Название сайта из config.js (site.name) — чтобы переименование было в одном месте */
  if (CFG.site && CFG.site.name) { const lg = $('.top .logo'); if (lg && lg.lastChild) lg.lastChild.textContent = CFG.site.name; }
  const planPromo = plan => plan.stops.some(promoOf);
  const ORDER = ['date', 'guys', 'girls'];
  const HERO = {
    date: {
      eyebrow: 'Игра-приглашение',
      title: 'Позови на свидание игрой',
      text: 'Мини-игра вместо скучного «го?»: сердечки, письмо и выбор места, дня и времени. Ответ придёт тебе.',
      cta: 'Создать приглашение',
      call: 'Позвать на свидание сюда',
    },
    guys: {
      eyebrow: 'Сбор компании',
      title: 'Собери пацанов без споров в чате',
      text: 'Компы, бани, тиры и бары. Скинь ссылку — каждый отметит, куда и в какие дни может. Сразу видно, что побеждает.',
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
    ['saved', '🔖 Сохранённые', p => T.isFav('plan:' + p.id)],
    ...HFILTERS,
    ['pc', '🎮 Компы', p => hasTag(p, 'pc')],
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
  const PCATS = [['all', 'Все'], ['saved', '🔖 Сохранённые'], ['promo', '🎁 С промокодом'], ['pc', '🎮 Компы'], ['autumn', '🍂 Осень'], ['halloween', '🎃 Хэллоуин'], ['first', '💘 Для первого свидания'], ['walk', 'Прогулки'], ['culture', 'Культура'], ['food', 'Рестораны'], ['michelin', 'Michelin'],
    ['coffee', 'Кофе'], ['bar', 'Бары'], ['fun', 'Развлечения'], ['spa', 'Бани и спа'], ['books', 'Книжные']];
  /* Округа Москвы (поле okr у места) */
  const OKRS = [['all', 'Вся Москва'], ['center', 'Центр'], ['north', 'Север'], ['ne', 'Северо-Восток'], ['east', 'Восток'],
    ['se', 'Юго-Восток'], ['south', 'Юг'], ['sw', 'Юго-Запад'], ['west', 'Запад'], ['nw', 'Северо-Запад'],
    ['khimki', 'Химки · Левобережный'], ['zel', 'Зеленоград'], ['new', 'Новая Москва'], ['mo', 'Подмосковье']];
  const OKR_NAME = Object.fromEntries(OKRS);
  const MICH = { 2: 'Две звезды Michelin 2021', 1: 'Звезда Michelin 2021', bib: 'Bib Gourmand Michelin 2021', rec: 'В гиде Michelin 2021' };
  const PLACES = Object.entries(D.places).filter(([, p]) => !p.adult).map(([id, p]) => Object.assign({ id, c: K.catOf(p) }, p))
    .sort((a, b) => (!!b.ph - !!a.ph) || a.name.replace(/^[^A-Za-zА-Яа-яЁё0-9]+/, '').localeCompare(b.name.replace(/^[^A-Za-zА-Яа-яЁё0-9]+/, ''), 'ru'));
  const PSTEP = 24;
  let pcat = 'all', pokr = 'all', pq = '', plimit = PSTEP, pview = 'list';
  /* «Рядом со мной»: координаты берём из браузера только по нажатию и никуда не отправляем */
  let near = G.saved();
  const distText = m => m < 950 ? `${Math.max(100, Math.round(m / 50) * 50)} м` : `${(m / 1000).toFixed(m < 9950 ? 1 : 0).replace('.', ',')} км`;
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
    pc: ['🎮', 'Компы для пацанов', 'Компьютерные клубы по всей Москве и еда рядом'],
  };
  /* Постоянная плашка: компы — только у пацанов */
  const PROMO = { guys: ['pc'] };
  function renderSeason(all) {
    const fnOf = id => (FILTERS.find(f => f[0] === id) || [])[2] || (p => hasHint(p, id));
    // у пацанов компы — первой плашкой
    const promo = PROMO[mode] || [], first = mode === 'guys' ? promo.slice(0, 1) : [];
    const ids = first.concat(SEASON.filter(h => SEASON_TILES[h]), promo.slice(first.length));
    const tiles = ids.map(h => [h, all.filter(fnOf(h)).length]).filter(x => x[1]);
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
          <span class="chip">${st[0] && K.isMetro(st[0].metro) ? '<span class="metro">М</span>' + esc(st[0].metro) : esc(st[0] ? K.metroText(st[0].metro) : '')}</span>
          ${cardHints(p)}${planPromo(p) ? '<span class="chip promo-tag">🎁 промокод</span>' : ''}
        </span>
      </button>`;
    }).join('');
    watchCards();
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
        <span class="pl-main"><span class="pl-name">${esc(p.name)}</span><span class="pl-sub">${esc(p.kind.replace(' · 18+', ''))} · ${esc(K.metroText(p.metro))}</span></span>
        <span class="price">${K.priceText(p.price)}</span>
      </button>`).join('');
    const f = $('#afilters'), on = f.querySelector('.on');
    const fr = f.getBoundingClientRect(), r = on.getBoundingClientRect();
    if (r.right > fr.right - 20) f.scrollLeft += r.right - fr.right + 20;
    else if (r.left < fr.left + 20) f.scrollLeft -= fr.left + 20 - r.left;
  }
  /* ---------- большая карта мест: Яндекс Карты (assets/maps.js), грузится при первом открытии ----------
     На карте — все места под текущими фильтрами, рядом стоящие собираются в кластеры. Кнопка «На карте»
     в карточке места или плана выделяет его точки (у плана — номера по порядку маршрута). */
  let PLIST = [], MAP = null, OM = null, FOCUS = null, ME = null, picking = false;
  let focus = null;   // { ids: [id места…], title }
  const placeOf = id => PLACES.find(x => x.id === id) || null;
  function balloonProps(p) {
    const pr = promoOf(p.id);
    return {
      hintContent: p.name,
      balloonContentHeader: esc(p.name) + (pr ? ' 🎁' : ''),
      balloonContentBody: `<span class="ym-sub">${esc(p.kind)} · ${esc(K.metroText(p.metro))}</span>${pr ? `<br><span class="ym-promo">🎁 ${esc(pr.title)}</span>` : ''}`,
      balloonContentFooter: `<button type="button" class="map-open" data-open-place="${esc(p.id)}">Подробнее</button>`,
    };
  }
  function setPicking(on) {
    picking = !!on;
    $('#pmap').classList.toggle('picking', picking);
    $('#mapPick').classList.toggle('hidden', !picking);
  }
  function renderFocusBar() {
    const bar = $('#mapFocus');
    bar.classList.toggle('hidden', !focus);
    if (focus) bar.innerHTML = `<span>${I('pin')}На карте: <b>${esc(focus.title)}</b></span><button type="button" class="mini" data-focus-clear>Все места</button>`;
  }
  function renderMap() {
    const box = $('#pmap');
    renderFocusBar();
    KM.load().then(ym => {
      if (!MAP) {
        box.innerHTML = '';
        MAP = new ym.Map(box, { center: [55.751, 37.618], zoom: 10, controls: ['zoomControl', 'fullscreenControl'] }, { suppressMapOpenBlock: true });
        MAP.behaviors.disable('scrollZoom');   // колесо мыши листает страницу, а карту приближают кнопки и щипок
        OM = new ym.ObjectManager({ clusterize: true, gridSize: 64 });
        OM.clusters.options.set('preset', 'islands#invertedDarkBlueClusterIcons');
        MAP.geoObjects.add(OM);
        MAP.events.add('click', e => {
          if (!picking) return;
          const c = e.get('coords');
          setPicking(false);
          setNear({ lat: c[0], lon: c[1], label: 'Точка на карте', src: 'map' });
        });
      }
      OM.removeAll();
      OM.add({ type: 'FeatureCollection', features: PLIST.map((p, i) => ({
        type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [p.lat, p.lon] }, properties: balloonProps(p),
        options: promoOf(p.id) ? { preset: 'islands#circleIcon', iconColor: KM.PROMO_COLOR } : { preset: 'islands#circleDotIcon', iconColor: KM.CAT_COLOR[p.c] || KM.CAT_COLOR.food },
      })) });
      if (ME) MAP.geoObjects.remove(ME);
      ME = near ? new ym.Placemark([near.lat, near.lon], { hintContent: near.label || 'Ты здесь' }, { preset: 'islands#geolocationIcon', iconColor: '#3D8BFF' }) : null;
      if (ME) MAP.geoObjects.add(ME);
      if (FOCUS) { MAP.geoObjects.remove(FOCUS); FOCUS = null; }
      const fst = focus ? focus.ids.map(placeOf).filter(Boolean) : [];
      if (fst.length) {
        FOCUS = new ym.GeoObjectCollection();
        if (fst.length > 1) FOCUS.add(new ym.Polyline(fst.map(p => [p.lat, p.lon]), {}, { strokeColor: '#1C1B29', strokeWidth: 3, strokeStyle: 'shortdash', strokeOpacity: 0.85 }));
        fst.forEach((p, i) => FOCUS.add(new ym.Placemark([p.lat, p.lon], Object.assign(balloonProps(p), { iconContent: fst.length > 1 ? String(i + 1) : '' }),
          { preset: 'islands#icon', iconColor: promoOf(p.id) ? KM.PROMO_COLOR : '#E0446B', zIndex: 900 })));
        MAP.geoObjects.add(FOCUS);
      }
      MAP.container.fitToViewport();
      const view = fst.length ? fst : near ? [] : PLIST;
      if (!fst.length && near) MAP.setCenter([near.lat, near.lon], 14);
      else if (view.length === 1) MAP.setCenter([view[0].lat, view[0].lon], 15);
      else if (view.length) MAP.setBounds(ym.util.bounds.fromPoints(view.map(p => [p.lat, p.lon])), { checkZoomRange: true, zoomMargin: 30 });
      if (fst.length === 1) FOCUS.get(0).balloon.open();
    }).catch(() => {
      MAP = null;
      box.innerHTML = `<div class="map-fail"><p>Яндекс Карты не загрузились — проверь интернет или отключи блокировщик рекламы для этого сайта.</p><button type="button" class="btn ghost" data-map-retry>Попробовать ещё раз</button></div>`;
    });
  }
  /* Переключение «Список / Карта» */
  function setView(v) {
    pview = v;
    $$('#pview button').forEach(x => { const on = x.dataset.v === v; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
    $('#pmap').classList.toggle('hidden', v !== 'map');
    $('#plist').classList.toggle('hidden', v === 'map');
    $('#pmore').classList.toggle('hidden', v === 'map' || PLIST.length <= plimit);
    $('#mapLegend').classList.toggle('hidden', v !== 'map');
    if (v !== 'map') { setPicking(false); focus = null; renderFocusBar(); }
    else renderMap();
  }
  const LEGEND = [['walk', 'прогулки'], ['culture', 'культура'], ['food', 'еда'], ['coffee', 'кофе'], ['bar', 'бары'], ['fun', 'развлечения'], ['pc', 'компы'], ['spa', 'бани'], ['books', 'книжные']];
  $('#mapLegend').innerHTML = LEGEND.map(([c, t]) => `<span><i style="background:${KM.CAT_COLOR[c]}"></i>${t}</span>`).join('') +
    (PROMOS.length ? `<span><i style="background:${KM.PROMO_COLOR}"></i>с промокодом</span>` : '');
  /* «На карте» из карточки: большая карта с выделенными точками места или плана */
  function showOnMap(ids, title) {
    focus = { ids, title };
    closeSheets();
    setView('map');
    $('#mapFocus').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const listHints = p => { const e = K.placeHints(p).filter(h => ['halloween', 'autumn', 'night'].includes(h) || (h === 'first' && mode === 'date')).map(h => K.HINTS[h][0]).join(''); return e ? e + ' ' : ''; };
  /* Источник: пост о месте в Telegram-канале — просто ссылкой */
  const tgBlock = p => p && K.tgOk(p.tg) ? `<a class="tg-link" href="${K.tgUrl(p.tg)}" target="_blank" rel="noopener">Отзыв в канале «${esc(K.tgName(p.tg))}» в Telegram${I('ext')}</a>` : '';
  const favBtn = (key, title) => { const on = T.isFav(key);
    return `<button type="button" class="fav${on ? ' on' : ''}" data-fav="${esc(key)}" aria-pressed="${on}" title="${on ? 'Убрать из сохранённых' : 'Сохранить'}">${I('bookmark')}<span>${on ? 'Сохранено' : 'Сохранить'}</span></button>`; };
  /* «до 31 декабря» (год — только если не текущий) */
  const untilText = ymd => { const d = K.parseYmd(ymd); if (!d) return ymd;
    return new Intl.DateTimeFormat('ru-RU', d.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' }).format(d); };
  const promoBox = x => x ? `<div class="promo-box"><span class="pb-ic">${I('gift')}</span><div><b>${esc(x.title)}</b>
      ${x.code ? `<button type="button" class="pb-code" data-code="${esc(x.code)}">${esc(x.code)} ${I('copy')}</button>` : ''}
      ${x.terms ? `<small>${esc(x.terms)}</small>` : ''}${x.until ? `<small>Действует до ${esc(untilText(x.until))}</small>` : ''}</div></div>` : '';
  const REPORT = { place: 'Место закрылось или есть ошибка? Сообщи нам', plan: 'План устарел или есть ошибка? Сообщи нам' };
  const reportLink = (what, id) => {
    const sup = CFG.support || {}, text = REPORT[what] || REPORT.place;
    if (sup.telegram) return `<a class="report" href="https://t.me/${encodeURIComponent(sup.telegram)}?start=fix_${encodeURIComponent(id).slice(0, 56)}" target="_blank" rel="noopener">${I('flag')}${text}</a>`;
    if (sup.email) return `<a class="report" href="mailto:${esc(sup.email)}?subject=${encodeURIComponent('Ошибка: ' + id)}">${I('flag')}${text}</a>`;
    return '';
  };
  function renderPlaces() {
    const q = norm(pq).trim();
    const inCat = p => pcat === 'all' || (pcat === 'michelin' ? !!p.mich : pcat === 'saved' ? T.isFav('place:' + p.id)
      : pcat === 'promo' ? !!promoOf(p.id) : K.HINTS[pcat] ? K.placeHints(p).includes(pcat) : p.c === pcat);
    const inQ = p => !q || norm(p.name + ' ' + p.kind + ' ' + p.metro + ' ' + p.addr + ' ' + (OKR_NAME[p.okr] || '')).includes(q);
    const base = PLACES.filter(p => inCat(p) && inQ(p));
    let list = base.filter(p => pokr === 'all' || p.okr === pokr);
    if (near) list = list.map(p => [p, K.distM(near, p)]).sort((a, b) => a[1] - b[1]).map(([p, d]) => Object.assign({}, p, { dist: d }));
    const hasSaved = PLACES.some(p => T.isFav('place:' + p.id));
    $('#pfilters').innerHTML = PCATS.filter(([id]) => id === pcat || (id === 'saved' ? hasSaved : id === 'promo' ? PROMOS.length : id === 'first' ? mode === 'date' : true)).map(([id, label]) =>
      `<button type="button" data-pc="${id}" class="${id === pcat ? 'on' : ''}" aria-pressed="${id === pcat}">${label}</button>`).join('');
    const cnt = {};
    base.forEach(p => { cnt[p.okr] = (cnt[p.okr] || 0) + 1; });
    $('#pokrs').innerHTML = `<button type="button" data-near class="near${near ? ' on' : ''}" aria-pressed="${!!near}">${near ? '📍 ' + esc(near.label || 'Рядом') + ' ✕' : '📍 Рядом со мной'}</button>` + OKRS.filter(([id]) => id === 'all' || cnt[id] || id === pokr).map(([id, label]) =>
      `<button type="button" data-po="${id}" class="${id === pokr ? 'on' : ''}" aria-pressed="${id === pokr}">${label}<span class="n">${id === 'all' ? base.length : (cnt[id] || 0)}</span></button>`).join('');
    PLIST = list;
    if (pview === 'map') { renderMap(); }
    $('#pcount').textContent = `${list.length} ${plural(list.length, 'место', 'места', 'мест')}`;
    // название обрезается многоточием, а значки Michelin и промокода стоят отдельно и не съедают его
    $('#plist').innerHTML = list.length ? list.slice(0, plimit).map(p => `
      <button type="button" class="pl-item${promoOf(p.id) ? ' has-promo' : ''}" data-pid="${p.id}">
        ${emoTile(p)}
        <span class="pl-main"><span class="pl-name"><span class="nm">${esc(p.name)}</span>${p.mich ? '<span class="mich" title="' + MICH[p.mich] + '">M</span>' : ''}${promoOf(p.id) ? '<span class="promo-tag" title="Есть промокод">🎁</span>' : ''}</span><span class="pl-sub">${p.dist != null ? `<b class="dist">${distText(p.dist)}</b> · ` : ''}${listHints(p)}${esc(p.kind)} · ${esc(K.metroText(p.metro))}</span></span>
        <span class="price">${K.priceText(p.price)}</span>
      </button>`).join('') : (pcat === 'saved' ? '<p class="pl-empty">Здесь появятся места, которые ты сохранишь значком 🔖 в карточке.</p>' : '<p class="pl-empty">Ничего не нашлось. Попробуй другое слово или категорию.</p>');
    const rest = list.length - Math.min(plimit, list.length);
    $('#pmore').classList.toggle('hidden', rest <= 0 || pview === 'map');
    $('#pmore').textContent = `Показать ещё ${Math.min(rest, PSTEP)} из ${rest}`;
  }
  /* «Похожие рядом»: та же категория в пределах ~3 км, близкие признаки и то, что нравится человеку */
  function similarPlaces(id, n) {
    const p = PLACES.find(x => x.id === id);
    if (!p) return [];
    const fa = new Set(T.featsOf('place', id));
    return PLACES.filter(x => x.id !== id && x.c === p.c).map(x => {
      const d = K.distM(p, x);
      if (d > 3000) return null;
      const fb = T.featsOf('place', x.id), inter = fb.filter(f => fa.has(f)).length;
      return [x, inter / (fa.size + fb.length - inter || 1) + 0.15 * T.score('place', x.id) - d / 6000];
    }).filter(Boolean).sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]);
  }
  function openPlace(id) {
    const p = K.placeById(id);
    if (!p) return;
    const similar = p.adult ? [] : similarPlaces(id, 4);
    // планы только текущего режима: у чужих — другие кнопки и другой конструктор
    const inPlans = p.adult ? [] : D.scenarios.filter(s => s.mode === mode && s.stops.includes(id));
    const ph = K.photo(p);
    $('#sheet').innerHTML = `
      <span class="grab"></span>
      ${heroPh(ph, p.name)}
      ${ph && ph.file ? '<div class="gal hidden" aria-label="Ещё фото"></div>' : ''}
      <p class="eyebrow">${esc(p.kind)} · ${K.priceText(p.price)}${p.okr && OKR_NAME[p.okr] && p.okr !== 'all' ? ' · ' + esc(OKR_NAME[p.okr]) : ''}</p>
      <div class="ttl-row"><h3>${esc(p.name)}</h3>${p.adult ? '' : favBtn('place:' + id)}</div>
      ${p.mich ? `<p class="mich-line"><span class="mich">M</span>${MICH[p.mich]}</p>` : ''}
      ${sheetHints(K.placeHints(p).filter(h => h !== 'michelin'))}
      ${promoBox(promoOf(id))}
      <p class="why">${esc(p.note)}</p>
      <div class="stop solo">
        <span class="k">${esc(K.metroText(p.metro))}</span>
        <a href="${K.mapUrl(p)}" target="_blank" rel="noopener">${esc(p.addr)} — фото, часы работы и отзывы в Яндекс Картах${I('ext')}</a>
        ${tgBlock(p)}
      </div>
      ${inPlans.length ? `<div class="in-plans"><p class="k">Есть в готовых планах</p>${inPlans.map(s =>
        `<button type="button" class="chip" data-open-plan="${s.id}">${esc(s.title)}</button>`).join('')}</div>` : ''}
      ${similar.length ? `<div class="in-plans"><p class="k">Похожие рядом</p>${similar.map(x =>
        `<button type="button" class="chip" data-open-place="${x.id}">${esc(x.emoji)} ${esc(x.name)}</button>`).join('')}</div>` : ''}
      <div class="sheet-actions">
        ${p.adult ? `<a class="btn primary wide" href="${K.routeUrl([p])}" target="_blank" rel="noopener">${I('route')}Как добраться</a>` : `
        <a class="btn primary wide" data-act="create" href="${createUrl(mode, 'p-' + id)}">${HERO[mode].call}${I('arrow')}</a>
        <div class="row two">
          <button type="button" class="btn ghost" data-map="${esc(id)}" data-title="${esc(p.name)}">${I('map')}На карте</button>
          <a class="btn ghost" data-act="route" href="${K.routeUrl([p])}" target="_blank" rel="noopener">${I('route')}Как добраться</a>
        </div>
        <button type="button" class="btn ghost wide" data-share="place=${encodeURIComponent(id)}" data-title="${esc(p.name)}">${I('share')}Поделиться местом</button>`}
      </div>
      ${p.adult ? '' : reportLink('place', id)}`;
    $('#sheet').dataset.kind = 'place'; $('#sheet').dataset.id = id;
    $('#sheet').dataset.adult = p.adult ? '1' : '';
    openSheet();
    if (!p.adult) {
      T.ev('open_place', { kind: 'place', id, mode });
      if (ph && ph.file) GAL.load(id, ph).then(items => renderGallery(id, items)).catch(() => { /* Commons недоступен — одно фото */ });
    }
  }
  /* Ещё фото места (Wikimedia Commons) лентой; по нажатию — крупно с автором и лицензией */
  function renderGallery(id, items) {
    const box = $('#sheet .gal');
    if (!box || $('#sheet').dataset.id !== id || !items.length) return;
    box.innerHTML = items.map((x, i) => `<button type="button" class="gal-it" data-gal="${i}"><img src="${esc(x.s)}" alt="" loading="lazy" decoding="async"></button>`).join('');
    box.classList.remove('hidden');
    box._items = items;
  }
  function showPhoto(x) {
    const ov = document.createElement('div');
    ov.className = 'lightbox';
    ov.innerHTML = `<figure><img src="${esc(x.s)}" alt=""><figcaption>Фото: <a href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.a)}</a>, ${esc(x.l)} · Wikimedia Commons</figcaption></figure><button type="button" class="lb-x" aria-label="Закрыть">${I('x')}</button>`;
    ov.addEventListener('click', e => { if (!e.target.closest('figcaption a')) ov.remove(); });
    document.body.appendChild(ov);
  }
  /* Пока открыта карточка, плашка про аналитику не закрывает её кнопки — покажем её после */
  function openSheet() {
    $('#sheetBg').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.body.classList.add('sheet-open');
    $('#sheet').scrollTop = 0;
  }

  function apply() {
    document.documentElement.dataset.mode = mode;
    document.documentElement.dataset.acc = K.MODES[mode].acc || '';
    renderModes(); renderHero(); renderForYou(); renderCards();
    acat = (AMODES[mode] || AMODES.guys)[0];
    $('#adultBtn').textContent = ABTN[mode] || ABTN.guys;
    if (!$('#adultWrap').classList.contains('hidden')) renderAdult();
  }

  /* «Для тебя»: планы, которые модель (assets/track.js) считает самыми подходящими */
  function renderForYou() {
    const picks = T.forYou(D.scenarios.filter(s => s.mode === mode), 8);
    $('#foryouBlock').classList.toggle('hidden', picks.length < 3);
    if (picks.length < 3) return;
    const likes = T.topLikes(2);
    $('#fyNote').textContent = likes.length ? `Подобрали по тому, что ты открываешь и сохраняешь: ты любишь ${likes.join(' и ')}.` : 'Подобрали по тому, что ты открываешь и сохраняешь.';
    $('#foryou').innerHTML = picks.map(p => { const { st } = planMeta(p); const ph = K.planPhoto(p);
      return `<button type="button" class="fy-card" data-plan="${p.id}">
        <span class="fy-ph">${ph ? `<img src="${ph.t}" alt="" loading="lazy" decoding="async">` : esc(p.emoji)}</span>
        <b>${esc(p.title)}</b><small>${esc(st.map(x => x.name).join(' → '))}</small></button>`; }).join('');
  }
  /* Показы карточек: увидел ≥ 1,5 с и не открыл — модель учтёт это слабым «не интересно» */
  const seen = new Map();
  let cardIO = null;
  function watchCards() {
    if (!('IntersectionObserver' in window)) return;
    if (!cardIO) cardIO = new IntersectionObserver(es => es.forEach(e => {
      const id = e.target.dataset.plan;
      if (e.isIntersecting) { if (!seen.has(id)) seen.set(id, setTimeout(() => seen.set(id, true), 1500)); }
      else if (seen.get(id) !== true) { clearTimeout(seen.get(id)); seen.delete(id); }
    }), { threshold: 0.6 });
    $$('#cards .card').forEach(c => cardIO.observe(c));
  }
  const opened = new Set();
  addEventListener('pagehide', () => {
    let n = 0;
    seen.forEach((v, id) => { if (v === true && !opened.has(id) && n < 12) { T.skipped('plan', id); n++; } });
  });

  function openPlan(id) {
    opened.add(id);
    const plan = K.planById(id);
    if (!plan) return;
    // план другого режима (например, по ссылке из чужого режима) — открываем в его режиме, чтобы кнопки совпадали
    if (plan.mode && plan.mode !== mode && ORDER.includes(plan.mode)) setMode(plan.mode);
    const { st, legs, price } = planMeta(plan);
    const shown = new Set();
    const stopPh = p => { const ph = K.photo(p); if (!ph || shown.has(ph.u)) return ''; shown.add(ph.u);
      return `<figure class="stop-ph"><img src="${ph.s}" alt="${esc(p.name)}" loading="lazy" decoding="async"><figcaption>${K.photoCredit(ph)}</figcaption></figure>`; };
    // у мест из planStops нет id — берём его из плана, иначе промокоды остановок не находятся
    const ids = plan.stops.filter(x => K.placeById(x));
    const parts = st.map((p, i) => { const pr = promoOf(ids[i]); return (i ? `<span class="dash"></span><span class="walk">${legs[i - 1]} мин пешком</span>` : '') + `
      <span class="dot${i ? ' o' : ''}"></span>
      <div class="stop${pr ? ' has-promo' : ''}">
        ${stopPh(p)}
        <b>${esc(p.name)}${pr ? ' <span class="promo-tag">🎁 промокод</span>' : ''}</b>
        <span class="k">${esc(p.kind)} · ${esc(K.metroText(p.metro))} · ${K.priceText(p.price)}</span>
        <p>${esc(p.note)}</p>
        ${promoBox(pr)}
        <a href="${K.mapUrl(p)}" target="_blank" rel="noopener">${esc(p.addr)} — в Яндекс Картах${I('ext')}</a>
        ${tgBlock(p)}
      </div>`; }).join('');
    $('#sheet').innerHTML = `
      <span class="grab"></span>
      <p class="eyebrow">${esc(plan.when)} · ${K.priceText(price)}</p>
      <div class="ttl-row"><h3>${esc(plan.title)}</h3>${favBtn('plan:' + plan.id)}</div>
      ${sheetHints(K.planHints(plan).filter(h => !(h === 'first' && mode !== 'date')))}
      <p class="why">${esc(plan.why)}</p>
      <div class="itin">${parts}</div>
      <div class="sheet-actions">
        <a class="btn primary wide" data-act="create" href="${createUrl(mode, plan.id)}">${HERO[mode].call}${I('arrow')}</a>
        <div class="row two">
          <button type="button" class="btn ghost" data-map="${esc(plan.stops.join(','))}" data-title="${esc(plan.title)}">${I('map')}На карте</button>
          <a class="btn ghost" data-act="route" href="${K.routeUrl(st)}" target="_blank" rel="noopener">${I('route')}${st.length > 1 ? 'Маршрут' : 'Как добраться'}</a>
        </div>
        <button type="button" class="btn ghost wide" data-share="plan=${encodeURIComponent(plan.id)}" data-title="${esc(plan.title)}">${I('share')}Поделиться планом</button>
      </div>
      ${reportLink('plan', plan.id)}`;
    $('#sheet').dataset.kind = 'plan'; $('#sheet').dataset.id = plan.id; $('#sheet').dataset.adult = '';
    openSheet();
    T.ev('open_plan', { kind: 'plan', id: plan.id, mode });
  }
  function closeSheets() {
    const was = !$('#sheetBg').classList.contains('hidden');
    $('#sheetBg').classList.add('hidden');
    $('#ageBg').classList.add('hidden');
    document.body.style.overflow = '';
    document.body.classList.remove('sheet-open');
    // «Для тебя» учится на открытиях и сохранениях — обновляем после закрытия карточки, а не после перезагрузки
    if (was) renderForYou();
    if (!T.consent() && consentDue) showConsent();
  }

  function setMode(m) {
    if (!ORDER.includes(m) || m === mode) return;
    mode = m;
    flt = 'all'; climit = CSTEP;
    try { localStorage.setItem('kuda-mode', mode); } catch (err) { /* ок */ }
    history.replaceState(null, '', '?m=' + mode);
    if (pcat === 'first' && mode !== 'date') pcat = 'all';
    apply();
    renderPlaces();
  }
  $('#modes').addEventListener('click', e => {
    const b = e.target.closest('button[data-m]');
    if (b) setMode(b.dataset.m);
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
    if (e.target.closest('button[data-near]')) { toggleNear(); return; }
    const b = e.target.closest('button[data-po]');
    if (!b || b.dataset.po === pokr) return;
    pokr = b.dataset.po; plimit = PSTEP;
    renderPlaces();
  });
  function setNear(p) {
    near = p;
    G.save(p);
    setPicking(false);
    pokr = 'all'; plimit = PSTEP;
    closeSheets();
    renderPlaces();
    $('#placesBlock').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (p) { toast('Сначала — ближайшие места'); T.ev('near', { v: p.src }); }
  }
  /* Окно выбора открывается сразу; геолокация идёт параллельно и сама подставит точку, если успеет */
  let locating = 0;
  function toggleNear() {
    setPicking(false);
    if (near) { near = null; G.save(null); renderPlaces(); return; }
    openNearPicker('Определяем, где ты… Можно не ждать — выбери станцию метро или точку на карте.', true);
    const run = ++locating;
    G.locate().then(p => {
      if (run !== locating || $('#sheet').dataset.kind !== 'near' || $('#sheetBg').classList.contains('hidden')) return;
      setNear(p);
    }).catch(e => {
      if (run !== locating) return;
      const m = $('#nearMsg');
      if (m) { m.textContent = G.MSG[e.code] || G.MSG.unavailable; m.classList.remove('busy'); }
    });
  }
  /* Запасной путь: станция метро или точка на карте */
  function openNearPicker(msg, busy) {
    setPicking(false);   // окно выбора открыли заново — прежний режим «точка на карте» больше не действует
    const st = G.stations();
    $('#sheet').innerHTML = `
      <span class="grab"></span>
      <h3>Откуда искать?</h3>
      <p class="muted${busy ? ' busy' : ''}" id="nearMsg">${esc(msg)}</p>
      <label class="psearch"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input id="mq" type="search" placeholder="Станция метро" aria-label="Станция метро" autocomplete="off"></label>
      <div class="metro-list" id="mlist"></div>
      <div class="sheet-actions">
        <button type="button" class="btn ghost wide" id="pickMap">${I('map')}Поставить точку на карте</button>
        <button type="button" class="btn ghost wide" id="pickRetry">${I('locate')}Попробовать определить ещё раз</button>
      </div>`;
    $('#sheet').dataset.kind = 'near'; $('#sheet').dataset.id = '';
    const draw = q => {
      const nq = norm(q).trim();
      const list = st.filter(x => !nq || norm(x.name).includes(nq)).slice(0, nq ? 40 : 24);
      $('#mlist').innerHTML = list.map(x => `<button type="button" class="chip" data-metro="${esc(x.name)}"><span class="metro">М</span>${esc(x.name)}</button>`).join('') || '<p class="muted">Такой станции нет в каталоге — поставь точку на карте.</p>';
    };
    draw('');
    $('#mq').addEventListener('input', e => draw(e.target.value));
    $('#mlist').addEventListener('click', e => {
      const b = e.target.closest('[data-metro]');
      if (!b) return;
      const x = st.find(y => y.name === b.dataset.metro);
      if (x) setNear({ lat: x.lat, lon: x.lon, label: 'м. ' + x.name, src: 'metro' });
    });
    $('#pickMap').onclick = () => {
      locating++;   // ответ геолокации, пришедший позже, точку уже не подменит
      closeSheets();
      focus = null;
      setView('map');
      setPicking(true);
      $('#mapPick').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    $('#pickRetry').onclick = () => { closeSheets(); near = null; toggleNear(); };
    openSheet();
  }
  /* Ссылка на место или план: start.html?m=guys&place=roku — открывается сразу с карточкой */
  const shareUrl = q => location.origin + location.pathname + '?m=' + mode + '&' + q;
  async function share(title, url) {
    try {
      if (navigator.share) { await navigator.share({ title, url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast('Ссылка скопирована'); }
    catch (e) { prompt('Скопируй ссылку', url); }
  }
  $('#pview').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (b && b.dataset.v !== pview) setView(b.dataset.v);
  });
  /* Карта: «Подробнее» в балуне, «Все места» вместо выделенных, отмена выбора точки, повторная загрузка */
  $('#placesBlock').addEventListener('click', e => {
    const op = e.target.closest('#pmap [data-open-place]');
    if (op) {
      if (MAP && MAP.container.isFullscreen()) MAP.container.exitFullscreen();
      openPlace(op.dataset.openPlace);
      return;
    }
    if (e.target.closest('[data-focus-clear]')) { focus = null; renderMap(); return; }
    if (e.target.closest('[data-pick-cancel]')) { setPicking(false); return; }
    if (e.target.closest('[data-map-retry]')) { $('#pmap').innerHTML = ''; renderMap(); }
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
    const sh = e.target.closest('[data-share]');
    const sk = $('#sheet').dataset;
    if (sh) { share(sh.dataset.title, shareUrl(sh.dataset.share)); T.ev('share', { kind: sk.kind, id: sk.id, mode }); return; }
    const fv = e.target.closest('[data-fav]');
    if (fv) {
      const on = T.toggleFav(fv.dataset.fav);
      fv.outerHTML = favBtn(fv.dataset.fav);
      toast(on ? 'Сохранено — ищи в «Сохранённых»' : 'Убрано из сохранённых');
      if (sk.kind === 'place') renderPlaces(); else renderCards();
      renderForYou();
      return;
    }
    const pc = e.target.closest('[data-code]');
    if (pc) { navigator.clipboard && navigator.clipboard.writeText(pc.dataset.code).then(() => toast('Промокод скопирован'), () => {}); T.ev('promo_copy', { kind: 'place', id: sk.id }); return; }
    const gi = e.target.closest('[data-gal]');
    if (gi) { const box = gi.closest('.gal'); if (box && box._items) showPhoto(box._items[+gi.dataset.gal]); return; }
    const mp = e.target.closest('[data-map]');
    if (mp) { showOnMap(mp.dataset.map.split(','), mp.dataset.title || ''); return; }
    const act = e.target.closest('[data-act]');
    // места 18+ не попадают ни в журнал, ни в Метрику
    if (act && sk.kind && !sk.adult) T.ev(act.dataset.act, { kind: sk.kind, id: sk.id, mode });
    const op = e.target.closest('[data-open-place]');
    if (op) { openPlace(op.dataset.openPlace); return; }
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
  $('#foryou').addEventListener('click', e => {
    const c = e.target.closest('[data-plan]');
    if (c) openPlan(c.dataset.plan);
  });
  $('#fyReset').onclick = () => { T.reset(); renderForYou(); renderPlaces(); toast('Забыли твои предпочтения'); };
  $('#cards').addEventListener('click', e => {
    const c = e.target.closest('.card[data-plan]');
    if (c) openPlan(c.dataset.plan);
  });
  ['#sheetBg', '#ageBg'].forEach(sel => $(sel).addEventListener('click', e => { if (e.target === $(sel)) closeSheets(); }));
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    // сначала закрываем верхний слой: открытое фото, затем карточку
    const lb = $('.lightbox');
    if (lb) { lb.remove(); return; }
    if (picking) { setPicking(false); return; }
    closeSheets();
  });

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

  /* ---------- промокоды ---------- */
  function renderPromo() {
    const sup = CFG.support || {};
    const contact = sup.email ? `mailto:${sup.email}?subject=${encodeURIComponent('Промокод для гостей')}` : 'partners.html';
    // значок «скоро» — только пока промокодов нет
    $$('.soon').forEach(x => x.classList.toggle('hidden', !!PROMOS.length));
    $('#promoList').innerHTML = PROMOS.length ? `<div class="plist">${PROMOS.map(x => { const p = K.placeById(x.place);
      return `<button type="button" class="pl-item has-promo" data-pid="${esc(x.place)}">${emoTile(p)}
        <span class="pl-main"><span class="pl-name"><span class="nm">${esc(p.name)}</span></span><span class="pl-sub">🎁 ${esc(x.title)}${x.until ? ' · до ' + esc(untilText(x.until)) : ''}</span></span>
        <span class="price">${K.priceText(p.price)}</span></button>`; }).join('')}</div>
        <p class="promo-biz">Вы заведение? <a href="${contact}">Разместить промокод</a></p>`
      : `<div class="promo-soon"><span class="ps-ic">${I('gift')}</span><div><b>Скоро здесь появятся промокоды</b>
        <p>Скидки и бонусы от мест из наших подборок: компьютерных клубов, баров, ресторанов и бань. Заведения с промокодом будут подсвечены значком 🎁 в списке и на карте.</p>
        <p class="promo-biz">Вы заведение?</p>
        <a class="btn ghost wide" href="${contact}">Разместить промокод${I('arrow')}</a></div></div>`;
  }
  $('#promoList').addEventListener('click', e => { const b = e.target.closest('.pl-item[data-pid]'); if (b) openPlace(b.dataset.pid); });

  /* ---------- вкладки-якоря ---------- */
  $('#tabs').addEventListener('click', e => {
    const a = e.target.closest('a[data-tab]');
    if (!a) return;
    e.preventDefault();
    const want = a.dataset.tab === 'map' ? 'map' : a.dataset.tab === 'places' ? 'list' : null;
    if (want && pview !== want) $(`#pview button[data-v="${want}"]`).click();
    $(a.getAttribute('href')).scrollIntoView({ behavior: 'smooth', block: 'start' });
    T.ev('tab', { v: a.dataset.tab });
  });

  /* ---------- вход через Яндекс ---------- */
  function renderLogin() {
    const u = AU.user(), b = $('#login');
    b.innerHTML = u ? (u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : I('user')) + `<span>${esc(u.name)}</span>` : `${I('user')}<span>Войти</span>`;
    b.title = u ? 'Выйти из аккаунта' : 'Войти через Яндекс';
  }
  $('#login').onclick = () => {
    if (AU.user()) {
      if (confirm('Выйти из аккаунта Яндекса на этом устройстве?')) { AU.logout(); renderLogin(); }
      return;
    }
    if (!AU.login()) toast('Вход через Яндекс появится совсем скоро');
  };
  document.addEventListener('kuda-auth', () => { renderLogin(); const u = AU.user(); if (u) toast(`Привет, ${u.name}!`); });
  AU.handleReturn().then(r => { if (r && r.error) toast('Не получилось войти через Яндекс. Попробуй ещё раз.'); });

  /* ---------- согласие на аналитику и обратная связь ---------- */
  /* Плашка не появляется поверх открытой карточки (иначе закрывает её кнопки) — ждёт, пока карточку закроют */
  let consentDue = false;
  function showConsent(force) {
    if (!force && document.body.classList.contains('sheet-open')) { consentDue = true; return; }
    consentDue = false;
    $('#consent').classList.remove('hidden');
  }
  const hideConsent = v => { consentDue = false; T.setConsent(v); $('#consent').classList.add('hidden'); toast(v === 'all' ? 'Спасибо! Аналитика включена' : 'Хорошо, без Метрики'); };
  $('#consentYes').onclick = () => hideConsent('all');
  $('#consentNo').onclick = () => hideConsent('basic');
  $('#consentOpen').onclick = () => showConsent(true);
  if (!T.consent()) setTimeout(() => showConsent(), 1200);
  (() => {
    const sup = CFG.support || {}, fb = $('#feedback');
    if (sup.telegram) { fb.href = 'https://t.me/' + encodeURIComponent(sup.telegram); fb.target = '_blank'; fb.rel = 'noopener'; }
    else if (sup.email) fb.href = 'mailto:' + sup.email;
    else fb.remove();
  })();

  /* Параметры ссылки: f — фильтр планов, cat/okr — раздел каталога, plan/place — сразу открыть карточку */
  const QS = new URLSearchParams(location.search);
  if (FILTERS.some(f => f[0] === QS.get('f'))) flt = QS.get('f');
  if (PCATS.some(c => c[0] === QS.get('cat'))) pcat = QS.get('cat');
  if (OKRS.some(o => o[0] === QS.get('okr'))) pokr = QS.get('okr');
  apply();
  renderPlaces();
  renderPromo();
  renderLogin();
  if (QS.get('tab') === 'promo') $('#promoBlock').scrollIntoView();
  if (QS.get('plan') && K.planById(QS.get('plan'))) openPlan(QS.get('plan'));
  else if (QS.get('place') && K.placeById(QS.get('place')) && !K.placeById(QS.get('place')).adult) openPlace(QS.get('place'));
})();

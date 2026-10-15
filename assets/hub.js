/* Главная «Куда идём?»: режимы, готовые планы, каталог мест, большая карта, карточки мест и планов.
   Карточка открывается в шторке K.sheet (shared.js): «Назад» в браузере, Esc, × и жест «смахнуть вниз» её закрывают.
   Модули страницы открывают свои карточки в той же шторке через openSheet(html, { onClose }) —
   снаружи она доступна как window.KudaHub.openSheet. Места 18+ — на отдельной странице adult.html.
   ─ Афиша (assets/afisha.js, KudaAfisha): вкладка «Афиша» с числом событий недели, лента «Ближайшие события»
     над планами, карточка события по ссылке ?event=<id>. Нет модуля или событий — вкладки нет.
   ─ Отзывы (assets/reviews.js, KudaReviews) — только со своим сервером (KudaAPI.on): звёзды на карточках,
     блок «Отзывы гостей» в карточке места, «По рейтингу» в каталоге. Без сервера ничего этого не видно.
   ─ «Подобрать за 10 секунд» (?quiz=1), бюджет на человека (?b=1|2), «Новое», погода от Open-Meteo.
   Тяжёлое (лента событий, вкладка афиши, погода) рисуем после первой отрисовки страницы.
   Места для модулей: #plansActions — кнопки рядом с «Удиви меня», .sheet-slot[data-slot="rating|reviews|events"]
   в карточках; событие document 'kuda-mode' — смена режима; KudaHub.addOpener(param, fn) — свой параметр адреса,
   по которому сразу открывается карточка. */
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
  /* Свой сервер (assets/api.js): живые голоса, «Мои приглашения», сообщения об ошибках. Нет модуля или пустой api.url — работаем без него */
  const API = window.KudaAPI || null;
  const LIVE = !!(API && API.on);
  /* Афиша и отзывы — отдельные модули: их может не быть на странице (или в старой копии из кэша) */
  const A = window.KudaAfisha && typeof window.KudaAfisha.mount === 'function' ? window.KudaAfisha : null;
  const RV = window.KudaReviews && typeof window.KudaReviews.badge === 'function' && LIVE ? window.KudaReviews : null;
  const todayYmd = K.todayMsk();
  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
  };
  /* Вызов модуля, который не должен ломать страницу: ошибка внутри — значит, этой части просто нет */
  const safe = (fn, d) => { try { const v = fn(); return v == null ? d : v; } catch (e) { return d; } };
  /* После первой отрисовки: кадр + задача; в фоновой вкладке кадров нет — тогда по таймеру */
  function afterPaint(fn) {
    let done = false;
    const run = () => { if (!done) { done = true; fn(); } };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(run, 0));
    setTimeout(run, 250);
  }

  /* Действующие промокоды заведений (assets/promos.js). Раздел и вкладка «Промокоды» — когда партнёров PROMO_MIN и больше,
     а значок 🎁 у места и сам код в его карточке — всегда.
     Промокод — реклама: без erid из ОРД и рекламодателя не показываем вовсе, а рядом с самим промокодом пишем
     «Реклама · рекламодатель · erid: …» (adLine) */
  const PROMO_MIN = 5;
  const str = v => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
  const PROMOS = (Array.isArray(window.KUDA_PROMOS) ? window.KUDA_PROMOS : []).filter(x => {
    const p = x && typeof x.place === 'string' && K.placeById(x.place);
    return p && !p.adult && (!x.until || x.until >= todayYmd) && str(x.title) && str(x.erid) && str(x.advertiser);
  });
  const promoOf = id => PROMOS.find(x => x.place === id) || null;
  /* «Реклама · ООО «Ромашка», ИНН 7700000000 · erid: 2SDnje…» */
  const adText = x => {
    const inn = str(x.inn).replace(/\s+/g, '');
    return ['Реклама', str(x.advertiser) + (/^\d{10}(\d{2})?$/.test(inn) ? ', ИНН ' + inn : ''), 'erid: ' + str(x.erid)].join(' · ');
  };
  const adLine = x => `<small class="ad-mark">${esc(adText(x))}</small>`;
  const planPromo = plan => plan.stops.some(promoOf);
  /* Название сайта из config.js (site.name) — чтобы переименование было в одном месте */
  if (CFG.site && CFG.site.name) { const lg = $('.top .logo'); if (lg && lg.lastChild) lg.lastChild.textContent = CFG.site.name; }

  const ORDER = ['date', 'guys', 'girls'];
  /* Тексты героя по режимам. Обещание «итог у всех одинаковый» — только когда голоса живут на сервере */
  const HERO = {
    date: {
      hook: 'Не пиши «го?». Позови игрой',
      text: 'Ссылка-игра: сердечки, письмо, выбор места, дня и времени из твоих вариантов. Ответ вернётся к тебе с готовым маршрутом.',
      cta: 'Создать приглашение',
      call: 'Позвать на свидание сюда',
    },
    guys: {
      hook: 'Пацаны, голосуем: компы, баня или бар?',
      text: LIVE ? 'Скинь ссылку в общий чат — каждый отметит, куда и когда может. Итог у всех одинаковый и обновляется сам.'
        : 'Скинь ссылку в общий чат — каждый отметит, куда и в какие дни может, а при ничьей поможет колесо.',
      cta: 'Собрать пацанов',
      call: 'Позвать пацанов сюда',
    },
    girls: {
      hook: 'Девичник без 200 сообщений в чате',
      text: LIVE ? 'Бранч, спа, мастер-класс или бар — каждая отмечает места и дни, победитель виден всем сразу.'
        : 'Бранч, спа, мастер-класс или бар — каждая отметит места и дни, которые ей подходят.',
      cta: 'Собрать подружек',
      call: 'Позвать подружек сюда',
    },
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

  /* ---------- каталог: какие планы и места показываем ---------- */
  /* План в каталоге: все остановки на месте (не закрыты) и сейчас его сезон (поле season) */
  const PLAN_OK = new Set(D.scenarios.filter(s => s && Array.isArray(s.stops) && s.stops.length &&
    s.stops.every(id => K.placeById(id)) && K.seasonOk(s)).map(s => s.id));
  const modePlans = m => D.scenarios.filter(s => s.mode === (m || mode) && PLAN_OK.has(s.id));
  /* Тип места после названия: «ансамбль XVII века», «кафе в ГУМе» — строчной только первая буква, аббревиатуры («VR-арена») не трогаем */
  const kindLow = s => { const t = String(s || '').split(' · ')[0];
    return /^[A-ZА-ЯЁ]{2}/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1); };
  const hasTag = (p, t) => (p.tags || []).includes(t);
  function planMeta(plan) {
    const st = K.planStops(plan);
    const legs = [];
    for (let i = 1; i < st.length; i++) legs.push(K.walkMin(st[i - 1], st[i]));
    const price = st.length ? Math.max(...st.map(p => p.price || 1)) : 1;
    return { st, legs, price };
  }
  /* Цена плана — по самому дорогому месту (1–3), с кэшем: нужна фильтрам, квизу и «Удиви меня» */
  const PRICE = new Map();
  const planPrice = p => { if (!PRICE.has(p.id)) PRICE.set(p.id, planMeta(p).price); return PRICE.get(p.id); };

  /* ---------- бюджет на человека: 1 — до 1 500 ₽, 2 — до 3 000 ₽, 0 — любой (цена места 1–3, как в places.js) ---------- */
  const NB = ' ';
  const BUDGETS = [[1, `до 1${NB}500${NB}₽`], [2, `до 3${NB}000${NB}₽`], [0, 'любой']];
  let bud = 0;
  const budOk = (price, b) => { b = b == null ? bud : b; return !b || (price || 1) <= b; };
  /* Ориентир для карточки: на двоих (свидание) или на человека (компания) */
  const EST_PAIR = ['', `до 3${NB}000${NB}₽`, `3–6${NB}тыс.${NB}₽`, `от 6${NB}000${NB}₽`];
  const EST_ONE = ['', `до 1${NB}500${NB}₽`, `1${NB}500–3${NB}000${NB}₽`, `от 3${NB}000${NB}₽`];
  function budgetEst(price) {
    const n = Math.max(1, Math.min(3, price || 1)), pair = mode === 'date';
    return `<p class="budget-est">${I('wallet')}<span><b>≈${NB}${pair ? EST_PAIR[n] + ' на двоих' : EST_ONE[n] + ' на человека'}</b> · ориентир по ценам мест</span></p>`;
  }

  /* ---------- «Новое»: места и подборки, которые добавили за последние 30 дней (поле added) ---------- */
  const NEW_DAYS = 30;
  const isNew = x => { const a = x && x.added;
    return !!a && /^\d{4}-\d{2}-\d{2}$/.test(a) && a <= todayYmd && K.dayNum(todayYmd) - K.dayNum(a) <= NEW_DAYS; };
  /* новее — раньше; в один день — то, что дописано в каталог позже */
  const byNewest = list => list.map((x, i) => [x, i]).sort((a, b) => (a[0].added < b[0].added ? 1 : a[0].added > b[0].added ? -1 : b[1] - a[1])).map(x => x[0]);

  /* ---------- «Под крышей»: все остановки — в помещении (еда, кофе, бары, культура, развлечения, бани, книжные, компы),
     кроме парков, усадеб, катков и прочего под открытым небом ---------- */
  const INDOOR_CATS = ['food', 'coffee', 'bar', 'culture', 'fun', 'spa', 'books', 'pc'];
  const OUT_KIND = /парк|сад|усадьб|набережн|бульвар|заповедник|заказник|смотров|каток|теплоход|канатн|открытым небом|монастыр|обител|некропол|стадион|квартал|автоквест|пейнтбол|конноспорт|петанк|архитектур|дизайн-завод/i;
  function indoorPlace(p) {
    const c = K.catOf(p);
    if (!INDOOR_CATS.includes(c)) return false;
    if (c !== 'culture' && c !== 'fun') return true;   // ресторан «в парке» — всё равно под крышей
    const k = String(p.kind || '');
    return !OUT_KIND.test(k) || /аквапарк|крыт/i.test(k);
  }
  const INDOOR = new Map();
  const indoorPlan = p => { if (!INDOOR.has(p.id)) { const st = K.planStops(p); INDOOR.set(p.id, st.length > 0 && st.every(indoorPlace)); } return INDOOR.get(p.id); };

  /* Отрезок между остановками: пешком, а если план на транспорте (тег drive) или идти дольше получаса — «на транспорте» */
  const legText = (min, plan) => hasTag(plan, 'drive') || min > 30 ? 'на транспорте' : `${min} мин пешком`;
  const priceTag = n => `<span class="price" title="${esc(K.priceHint(n))}">${K.priceText(n)}</span>`;

  /* Подсказки к планам и местам («🍂 Красиво осенью», «💘 Для первого свидания»…) — в shared.js.
     Сезонные (🎃, 🎄, 🍂) shared.js сам прячет вне срока; здесь — только фильтры и плашки на текущий сезон */
  const SEASON = K.seasonHints();
  const SEASON_LABEL = { halloween: '🎃 Хэллоуин', newyear: '🎄 Новый год', autumn: '🍂 Осень' };
  const hasHint = (p, h) => K.planHints(p).includes(h);
  /* «Недорого» теперь — бюджет на человека (отдельный переключатель); старые ссылки ?f=cheap → ?b=1 */
  const FILTERS = [
    ['all', 'Все', () => true],
    ['saved', '🔖 Сохранённые', p => T.isFav('plan:' + p.id)],
    ['new', '✨ Новое', isNew],
    ...SEASON.filter(h => SEASON_LABEL[h]).map(h => [h, SEASON_LABEL[h], p => hasHint(p, h)]),
    ['pc', '🎮 Компы', p => hasTag(p, 'pc')],
    ['first', '💘 Первое свидание', p => hasHint(p, 'first')],
    ['rain', '☔ Под крышей', indoorPlan],
    ['day', 'Днём', p => ['утро', 'день'].includes(p.when)],
    ['eve', 'Вечером', p => ['закат', 'вечер', 'ночь'].includes(p.when)],
    ['active', 'Активно', p => hasTag(p, 'active')],
    ['culture', 'Культура', p => hasTag(p, 'culture')],
    ['view', 'С видом', p => hasTag(p, 'view')],
  ];
  let flt = 'all';

  /* ---------- каталог «Все места» ---------- */
  const PCATS = [['all', 'Все'], ['saved', '🔖 Сохранённые'], ['new', '✨ Новое'], ['promo', '🎁 С промокодом'], ['pc', '🎮 Компы'],
    ...SEASON.filter(h => SEASON_LABEL[h]).map(h => [h, SEASON_LABEL[h]]),
    ['first', '💘 Для первого свидания'], ['walk', 'Прогулки'], ['culture', 'Культура'], ['food', 'Рестораны'], ['michelin', 'Michelin'],
    ['coffee', 'Кофе'], ['bar', 'Бары'], ['fun', 'Развлечения'], ['spa', 'Бани и спа'], ['books', 'Книжные']];
  /* Округа Москвы (поле okr у места) */
  const OKRS = [['all', 'Вся Москва'], ['center', 'Центр'], ['north', 'Север'], ['ne', 'Северо-Восток'], ['east', 'Восток'],
    ['se', 'Юго-Восток'], ['south', 'Юг'], ['sw', 'Юго-Запад'], ['west', 'Запад'], ['nw', 'Северо-Запад'],
    ['khimki', 'Химки · Левобережный'], ['zel', 'Зеленоград'], ['new', 'Новая Москва'], ['mo', 'Подмосковье']];
  const OKR_NAME = Object.fromEntries(OKRS);
  const MICH = { 2: 'Две звезды Michelin 2021', 1: 'Звезда Michelin 2021', bib: 'Bib Gourmand Michelin 2021', rec: 'В гиде Michelin 2021' };
  // места 18+ — на adult.html; закрытые (closed: true ставит assets/auto.js) — ни в каталоге, ни на карте, ни в «похожих»
  const PLACES = Object.entries(D.places).filter(([, p]) => p && !p.adult && !p.closed && K.seasonOk(p)).map(([id, p]) => Object.assign({ id, c: K.catOf(p) }, p))
    .sort((a, b) => (!!b.ph - !!a.ph) || a.name.replace(/^[^A-Za-zА-Яа-яЁё0-9]+/, '').localeCompare(b.name.replace(/^[^A-Za-zА-Яа-яЁё0-9]+/, ''), 'ru'));
  const PSTEP = 24;
  /* psort: '' — как обычно (с фото — выше), 'rating' — по сглаженной оценке гостей (только со своим сервером) */
  let pcat = 'all', pokr = 'all', pq = '', plimit = PSTEP, pview = 'list', psort = '';
  /* «Рядом со мной»: координаты берём из браузера только по нажатию и никуда не отправляем */
  let near = G.saved();
  const distText = m => m < 950 ? `${Math.max(100, Math.round(m / 50) * 50)} м` : `${(m / 1000).toFixed(m < 9950 ? 1 : 0).replace('.', ',')} км`;
  const norm = t => String(t || '').toLowerCase().replace(/ё/g, 'е');

  /* ---------- обложки: фото, а без фото — цвет раздела, крупный эмодзи и узор (стили .cover в hub.css) ---------- */
  const CV_CATS = ['walk', 'culture', 'food', 'coffee', 'bar', 'fun', 'pc', 'spa', 'books'];
  const cvOf = p => { const c = p ? p.c || K.catOf(p) : ''; return 'cv-' + (CV_CATS.includes(c) ? c : 'food'); };
  /* У плана из нескольких мест — эмодзи остановок пунктиром, у одного места — эмодзи плана */
  const coverEmo = (st, plan) => st.length > 1
    ? `<span class="cv-route" aria-hidden="true">${st.map(p => esc(p.emoji || '📍')).join('<i></i>')}</span>`
    : `<span class="cv-e" aria-hidden="true">${esc((plan && plan.emoji) || (st[0] && st[0].emoji) || '📍')}</span>`;
  /* Оценка гостей поверх фото: появляется, когда пришли рейтинги, и не сдвигает карточку */
  const planRate = plan => RV ? `<span class="card-rate" data-rate-plan="${esc(plan.id)}">${safe(() => RV.planBadge(plan), '')}</span>` : '';
  function planVisual(plan, st) {
    const ph = st.map(K.photo).filter((x, i, a) => x && a.findIndex(y => y && y.u === x.u) === i).slice(0, 3);
    if (ph.length) return `<span class="card-ph n${ph.length}">${ph.map(x => `<img src="${esc(ph.length < 3 ? x.s : x.t)}" alt="" loading="lazy" decoding="async">`).join('')}${planRate(plan)}</span>`;
    return `<span class="card-ph cover ${cvOf(st[0])}">${coverEmo(st, plan)}${planRate(plan)}</span>`;
  }
  /* Значок оценки места в строке списка (короткий: «★ 4,6») */
  const placeRate = id => RV ? `<span class="pl-rate" data-rate-place="${esc(id)}">${safe(() => RV.badge(id, { short: true }), '')}</span>` : '';
  const emoTile = p => { const ph = K.photo(p);
    return ph ? `<span class="pl-emo ph" aria-hidden="true"><img src="${esc(ph.t)}" alt="" loading="lazy" decoding="async"></span>`
      : `<span class="pl-emo cover ${cvOf(p)}" aria-hidden="true">${esc(p.emoji)}</span>`; };
  const heroPh = (ph, alt) => `<figure class="hero-ph"><img src="${esc(ph.s)}" alt="${esc(alt)}" decoding="async"><figcaption>${K.photoCredit(ph)}</figcaption></figure>`;
  const placeCover = p => `<div class="hero-cv cover ${cvOf(p)}" aria-hidden="true"><span class="cv-e">${esc(p.emoji)}</span><span class="cv-k">${esc(String(p.kind || '').split(' · ')[0])}</span></div>`;

  const createUrl = (m, planId) => `create.html?mode=${m}` + (planId ? `&plan=${encodeURIComponent(planId)}` : '');
  /* Демо-приглашение для каждого режима: открывается как превью — ничего не отправляется.
     Ссылки собираем заранее, при загрузке: пока ссылки нет, кнопка неактивна (раньше ранний тап открывал копию главной) */
  const DEMO_URL = {}, DEMO_P = {};
  function demoUrl(m) {
    if (!DEMO_P[m]) {
      const inv = m === 'date' ? {} : { mode: m, theme: K.MODES[m].theme, opts: modePlans(m).slice(0, 3).map(s => ({ plan: s.id })) };
      DEMO_P[m] = K.encodeInvite(inv).then(code => (DEMO_URL[m] = 'index.html#' + code + '&p=1')).catch(() => '');
    }
    return DEMO_P[m];
  }

  /* ---------- адрес страницы: режим и фильтры в строке браузера, чтобы ссылку можно было переслать ---------- */
  const OWN_PARAMS = ['m', 'f', 'b', 'cat', 'okr', 'tab', 'place', 'plan', 'event', 'quiz'];
  function baseQuery() {
    const q = new URLSearchParams();
    q.set('m', mode);
    if (flt !== 'all' && flt !== 'saved') q.set('f', flt);
    if (bud) q.set('b', String(bud));
    if (pcat !== 'all' && pcat !== 'saved') q.set('cat', pcat);
    if (pokr !== 'all') q.set('okr', pokr);
    // чужие параметры (utm_*, from, event…) не теряем
    new URLSearchParams(location.search).forEach((v, k) => { if (!OWN_PARAMS.includes(k) && !q.has(k)) q.set(k, v); });
    return q.toString();
  }
  /* Пока открыта карточка, текущая запись истории — её; адрес страницы обновится после закрытия.
     clean — запись больше не считается записью карточки (её карточку открыть не удалось) */
  function syncUrl(clean) {
    if (SH.isOpen()) return;
    // якорь #reviews нужен только при открытии (карточка места сразу на отзывах) — в адресе страницы его не оставляем
    const h = location.hash === '#reviews' ? '' : location.hash;
    try { history.replaceState(clean ? null : history.state, '', '?' + baseQuery() + h); } catch (e) { /* file:// и песочницы */ }
  }
  const sheetUrl = q => '?' + baseQuery() + '&' + q;
  /* Ссылка на место или план: start.html?m=guys&place=roku — открывается сразу с карточкой */
  const shareUrl = q => location.origin + location.pathname + '?m=' + mode + '&' + q;

  /* ---------- шторка ---------- */
  const SH = K.sheet($('#sheetBg'), $('#sheet'), {
    // вызывается, когда история уже вернулась назад: «Для тебя» учится на открытиях и сохранениях — обновляем;
    // адрес страницы — снова режим и фильтры; отложенная плашка про аналитику — теперь
    onClose: () => {
      $$('.lightbox').forEach(x => x.remove());   // фото крупно открывали из карточки — закрылась карточка, закрываем и его
      renderForYou(); syncUrl(); if (!T.consent() && consentDue) showConsent();
    },
    // «Вперёд» после «Назад» на запись карточки: шторка закрыта — открываем ту же карточку на этой же записи
    onForward: () => { if (!openFromQuery(new URLSearchParams(location.search), { adopt: true })) syncUrl(true); },
  });
  /* openSheet(html, { onClose, kind, id, url, label, adopt }) → { el, close } */
  function openSheet(html, o) {
    o = o || {};
    const r = SH.open(html, o);
    const ds = $('#sheet').dataset;
    ds.kind = o.kind || '';
    ds.id = o.id || '';
    return r;
  }
  const closeSheet = then => SH.close(then);

  /* ---------- режимы и герой ---------- */
  function renderModes() {
    $('#modes').innerHTML = ORDER.map(m => {
      const c = K.MODES[m];
      return `<button type="button" data-m="${m}" class="${m === mode ? 'on' : ''}" aria-pressed="${m === mode}">${I(K.MODE_ICON[m])}${c.label}</button>`;
    }).join('');
  }
  function renderHero() {
    const h = HERO[mode], url = DEMO_URL[mode], m = mode;
    $('#heroMode').innerHTML = `
      <p class="hero-hook"><b>${esc(h.hook)}</b>${esc(h.text)}</p>
      <div class="hero-actions">
        <a class="btn primary" href="${createUrl(mode)}">${h.cta}${I('arrow')}</a>
        <a class="btn ghost demo" ${url ? `href="${esc(url)}"` : 'aria-disabled="true"'} target="_blank" rel="noopener">${I('eye')}<span class="l-long">Посмотреть пример</span><span class="l-short">Пример</span></a>
      </div>`;
    if (!url) demoUrl(m).then(u => {
      const a = $('#heroMode .demo');
      if (!u || m !== mode || !a) return;
      a.href = u;
      a.removeAttribute('aria-disabled');
    });
  }
  /* Числа в тексте страницы — из каталога, чтобы не устаревали */
  const MONTH_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
  /* Текст в элемент, если он есть на странице (старая копия start.html из кэша не должна ломать скрипт) */
  const setText = (sel, t) => { const el = $(sel); if (el) el.textContent = t; };
  const setHtml = (sel, h) => { const el = $(sel); if (el) el.innerHTML = h; };
  function renderCounts() {
    // планов — с округлением, как мест («450+»): тогда текст совпадает с start.html и строки героя не перескакивают
    const np = PLAN_OK.size, rp = np >= 20 ? Math.floor(np / 10) * 10 : np;
    setText('#planCount', `${np >= 20 ? rp + '+' : np} ${plural(rp, 'готовый план', 'готовых плана', 'готовых планов')}`);
    const n = PLACES.length, round = n >= 20 ? Math.floor(n / 10) * 10 : n, txt = n >= 20 ? round + '+' : String(n);
    setText('#faqPlaces', txt);
    // «проверены в октябре»: самый частый месяц проверки (chk), если он не старше прошлого месяца
    // и так проверен почти весь каталог (95%) — иначе обещание было бы неправдой
    const cnt = {};
    PLACES.forEach(p => { if (/^\d{4}-\d{2}$/.test(p.chk || '')) cnt[p.chk] = (cnt[p.chk] || 0) + 1; });
    const top = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || (a < b ? 1 : -1))[0];
    const months = ym => +ym.slice(0, 4) * 12 + +ym.slice(5, 7);
    const fresh = top && months(todayYmd.slice(0, 7)) - months(top) <= 1 && cnt[top] >= PLACES.length * 0.95;
    // «по Москве» — как в start.html: строка и со шрифтом Onest, и с системным переносится одинаково (страница не прыгает, когда шрифт догрузится)
    setText('#uspPlaces', `${txt} ${plural(round, 'место', 'места', 'мест')}` + (fresh ? `, проверены в ${MONTH_IN[+top.slice(5, 7) - 1]}` : ' по Москве'));
    // галочки уже есть в start.html; дорисовываем, где их нет (в #uspPlaces текст только что заменили)
    $$('#hero .usp span').forEach(s => { if (!s.querySelector('.ic')) s.insertAdjacentHTML('afterbegin', I('check')); });
  }
  /* В start.html — честные тексты для сайта без своего сервера: голоса живут в ссылках.
     Со своим сервером меняем их на обещания общего итога и хранения на сервере */
  function applyLiveCopy() {
    const tg = !!(CFG.telegram && CFG.telegram.relayUrl);
    const tgLine = tg ? ' По желанию можно включить уведомления в Telegram — это необязательно.' : '';
    if (!LIVE) {
      const fa = $('#faqAnswer');
      if (fa && tg) fa.insertAdjacentText('beforeend', tgLine);
      return;
    }
    setText('#heroSubEnd', 'Кинь ссылку в чат — все проголосуют, итог увидит каждый.');
    setHtml('#how3', '<b>Итоги у всех одинаковые:</b> кто идёт, куда и в какой день — обновляются сами.');
    setHtml('#faqAnswer', 'Ответ появится в <a href="invites.html">«Моих приглашениях»</a> (значок в шапке), как только человек нажмёт «Отправить»: там видно, открыли ли приглашение, кто проголосовал и что ответили. ' +
      'Включи там уведомления — браузер сообщит о новом ответе, пока страница открыта.' + tgLine);
    setText('#faqGroup', 'Выбери «Пацаны» или «Подружки», отметь подходящие планы и кинь ссылку в общий чат. Каждый отметит, куда и в какие дни может, — ' +
      'итог у всех одинаковый и обновляется сам. При ничьей поможет колесо.');
    setHtml('#faqStore', 'Голоса и ответы на приглашения хранятся на нашем сервере в России и удаляются через 90 дней. Отзывы о местах тоже хранятся там и видны на сайте. ' +
      'Всё остальное — имена, места и даты — живёт в самой ссылке и в твоём браузере. Аккаунт не нужен. Подробнее — в <a href="privacy.html">политике конфиденциальности</a>.');
  }

  /* ---------- готовые планы ---------- */
  function routeHtml(plan, st, legs) {
    return st.map((p, i) => (i ? `<span class="dash"></span><span class="walk">${legText(legs[i - 1], plan)}</span>` : '') +
      `<span class="dot${i ? ' o' : ''}"></span><span class="stop-name">${esc(p.name)} <span>· ${esc(kindLow(p.kind))}</span></span>`).join('');
  }
  /* на карточке — до трёх подсказок; «недорого» и так видно по цене */
  const cardHints = p => K.planHints(p).filter(h => h !== 'budget').slice(0, 3).map(h => K.hintChip(h, 'short')).join('');
  const sheetHints = hs => hs.length ? `<p class="hints-line">${hs.map(h => K.hintChip(h)).join('')}</p>` : '';
  /* Сезонные плашки над планами: Хэллоуин, Новый год, осень — только в свой срок */
  const SEASON_TILES = {
    halloween: ['🎃', 'Тематично на Хэллоуин', 'Готика, бункеры, Булгаков и квесты'],
    newyear: ['🎄', 'Новогоднее настроение', 'Катки, ярмарки и огоньки'],
    autumn: ['🍂', 'Куда пойти осенью', 'Парки, усадьбы и бульвары в листьях'],
    pc: ['🎮', 'Компы для пацанов', 'Компьютерные клубы по всей Москве и еда рядом'],
  };
  /* Постоянная плашка: компы — только у пацанов, и первой */
  const PROMO_TILE = { guys: ['pc'] };
  function renderSeason(all) {
    const fnOf = id => (FILTERS.find(f => f[0] === id) || [])[2] || (p => hasHint(p, id));
    const promo = PROMO_TILE[mode] || [];
    const ids = promo.concat(SEASON.filter(h => SEASON_TILES[h] && !promo.includes(h)));
    const tiles = ids.map(h => [h, all.filter(fnOf(h)).length]).filter(x => x[1]);
    $('#season').innerHTML = tiles.map(([h, n]) => { const [e, t, d] = SEASON_TILES[h];
      return `<button type="button" class="season-tile s-${h}${flt === h ? ' on' : ''}" data-f="${h}" aria-pressed="${flt === h}"><span class="e" aria-hidden="true">${e}</span><span><b>${t}</b><small>${d} · ${n} ${plural(n, 'план', 'плана', 'планов')}</small></span></button>`; }).join('');
    $('#season').classList.toggle('hidden', !tiles.length);
  }
  function renderFilters(all) {
    renderSeason(all);
    const avail = FILTERS.filter(([id, , fn]) => id === 'all' || all.some(fn));
    if (!avail.some(([id]) => id === flt)) flt = 'all';
    $('#filters').innerHTML = avail.map(([id, label]) =>
      `<button type="button" data-f="${id}" class="${id === flt ? 'on' : ''}" aria-pressed="${id === flt}">${label}</button>`).join('');
    renderBudget('#budget', 'plans');
  }
  /* Бюджет на человека — один на планы и места: «до 1 500 ₽ · до 3 000 ₽ · любой» */
  function budgetSeg(where) {
    return `<span class="tools-l" id="bl-${where}">На человека</span><div class="seg" role="group" aria-labelledby="bl-${where}">${BUDGETS.map(([b, t]) =>
      `<button type="button" data-bud="${b}" data-bud-in="${where}" class="${b === bud ? 'on' : ''}" aria-pressed="${b === bud}">${t}</button>`).join('')}</div>`;
  }
  function renderBudget(sel, where, extra) {
    const box = $(sel);
    if (box) box.innerHTML = `<div class="tools-b">${budgetSeg(where)}</div>${extra || ''}`;
  }
  function setBudget(b, where) {
    b = [0, 1, 2].includes(+b) ? +b : 0;
    if (b === bud) return;
    bud = b; climit = CSTEP; plimit = PSTEP;
    renderCards();
    renderPlaces();
    syncUrl();
    T.ev('budget', { v: String(b), kind: where });
  }
  const CSTEP = 24;
  let climit = CSTEP;
  /* Лента «Новые планы» — среди карточек после NEW_AT-й, когда фильтр «Все» */
  const NEW_AT = 4, RAIL_N = 12;
  function newPlansRail(all) {
    const fresh = byNewest(all.filter(p => isNew(p) && budOk(planPrice(p))));
    if (fresh.length < 3) return '';
    return `<section class="feed-rail" aria-labelledby="npTitle">
      <div class="feed-head"><h3 id="npTitle">✨ Новые планы</h3><button type="button" class="mini" data-f-new>Все новые · ${fresh.length}</button></div>
      <div class="rail">${fresh.slice(0, RAIL_N).map(p => { const { st } = planMeta(p); const ph = K.planPhoto(p);
        return `<button type="button" class="fy-card" data-plan="${esc(p.id)}">
          ${ph ? `<span class="fy-ph"><img src="${esc(ph.t)}" alt="" loading="lazy" decoding="async"></span>` : `<span class="fy-ph cover ${cvOf(st[0])}">${coverEmo(st, p)}</span>`}
          <b>${esc(p.title)}</b><small>${esc(st.map(x => x.name).join(' → '))}</small></button>`; }).join('')}</div>
    </section>`;
  }
  function renderCards() {
    const all = modePlans();
    renderFilters(all);
    const fn = (FILTERS.find(f => f[0] === flt) || FILTERS[0])[2];
    // в сезон — подборки про Хэллоуин, Новый год и осень, потом планы с фото, порядок внутри групп — как в подборке
    const inSeason = p => (p.tags || []).some(t => SEASON.includes(t));
    const plans = all.filter(p => fn(p) && budOk(planPrice(p))).map((p, i) => [p, i]).sort((a, b) => (inSeason(b[0]) - inSeason(a[0])) || (!!K.planPhoto(b[0]) - !!K.planPhoto(a[0])) || a[1] - b[1]).map(x => x[0]);
    $('#count').textContent = `${plans.length} ${plural(plans.length, 'план', 'плана', 'планов')}`;
    const rest = plans.length - Math.min(climit, plans.length);
    $('#cmore').classList.toggle('hidden', rest <= 0);
    $('#cmore').textContent = `Показать ещё ${Math.min(rest, CSTEP)} из ${rest}`;
    const rail = flt === 'all' && plans.length > NEW_AT ? newPlansRail(all) : '';
    const html = plans.slice(0, climit).map((p, i) => {
      const { st, legs, price } = planMeta(p);
      return `<button type="button" class="card" data-plan="${esc(p.id)}" style="animation-delay:${(Math.min(i, 8) * 0.05).toFixed(2)}s">
        ${planVisual(p, st)}<span class="card-head"><span class="ttl">${esc(p.title)}</span><span class="card-meta">${priceTag(price)}</span></span>
        <span class="route">${routeHtml(p, st, legs)}</span>
        <span class="chips">
          <span class="chip">${I('clock')}${esc(p.when)}</span>
          <span class="chip">${st[0] && K.isMetro(st[0].metro) ? '<span class="metro" aria-hidden="true">М</span>' + esc(st[0].metro) : esc(st[0] ? K.metroText(st[0].metro) : '')}</span>
          ${cardHints(p)}${planPromo(p) ? '<span class="chip promo-tag">🎁 промокод</span>' : ''}
        </span>
      </button>` + (i === NEW_AT - 1 ? rail : '');
    });
    $('#cards').innerHTML = html.join('') || `<p class="pl-empty">${bud ? 'В этом бюджете таких планов нет — попробуй «любой» или другой фильтр.' : 'Таких планов пока нет — попробуй другой фильтр.'}</p>`;
    watchCards();
    renderWx();
  }

  /* ---------- большая карта мест: Яндекс Карты (assets/maps.js), грузится при первом открытии ----------
     На карте — все места под текущими фильтрами, рядом стоящие собираются в кластеры. */
  let PLIST = [], MAP = null, OM = null, ME = null, picking = false;
  const COARSE = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  function balloonProps(p) {
    const pr = promoOf(p.id);
    return {
      hintContent: esc(p.name),   // подсказки и балуны Яндекс Карт — HTML
      balloonContentHeader: esc(p.name) + (pr ? ' 🎁' : ''),
      balloonContentBody: `<span class="ym-sub">${esc(p.kind)} · ${esc(K.metroText(p.metro))}</span>${pr ? `<br><span class="ym-promo">🎁 ${esc(pr.title)}</span><br><span class="ym-ad">${esc(adText(pr))}</span>` : ''}`,
      balloonContentFooter: `<button type="button" class="map-open" data-open-place="${esc(p.id)}">Подробнее</button>`,
    };
  }
  function setPicking(on) {
    picking = !!on;
    $('#pmap').classList.toggle('picking', picking);
    $('#mapPick').classList.toggle('hidden', !picking);
  }
  function renderMap() {
    const box = $('#pmap');
    KM.load().then(ym => {
      if (!MAP) {
        box.innerHTML = '';
        MAP = new ym.Map(box, { center: KM.CENTER, zoom: KM.ZOOM, controls: ['zoomControl', 'fullscreenControl'] }, { suppressMapOpenBlock: true });
        MAP.behaviors.disable('scrollZoom');   // колесо мыши листает страницу, а карту приближают кнопки и щипок
        // на телефоне одним пальцем листаем страницу, а карту двигаем двумя пальцами или во весь экран
        if (COARSE) {
          MAP.behaviors.disable('drag');
          MAP.container.events.add('fullscreenenter', () => MAP.behaviors.enable('drag'));
          MAP.container.events.add('fullscreenexit', () => MAP.behaviors.disable('drag'));
        }
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
      ME = near ? new ym.Placemark([near.lat, near.lon], { hintContent: esc(near.label || 'Ты здесь') }, { preset: 'islands#geolocationIcon', iconColor: '#3D8BFF' }) : null;
      if (ME) MAP.geoObjects.add(ME);
      MAP.container.fitToViewport();
      // рядом со мной — вокруг точки; мест немного — показываем все; много — центр Москвы (иначе карта отъезжает на всю область)
      if (near) MAP.setCenter([near.lat, near.lon], 14);
      else if (PLIST.length === 1) MAP.setCenter([PLIST[0].lat, PLIST[0].lon], 15);
      else if (PLIST.length && PLIST.length <= 150) MAP.setBounds(ym.util.bounds.fromPoints(PLIST.map(p => [p.lat, p.lon])), { checkZoomRange: true, zoomMargin: 30 });
      else MAP.setCenter(KM.CENTER, KM.ZOOM);
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
    if (v !== 'map') setPicking(false);
    else renderMap();
    syncTabs();
  }
  const LEGEND = [['walk', 'прогулки'], ['culture', 'культура'], ['food', 'еда'], ['coffee', 'кофе'], ['bar', 'бары'], ['fun', 'развлечения'], ['pc', 'компы'], ['spa', 'бани'], ['books', 'книжные']];
  $('#mapLegend').innerHTML = LEGEND.map(([c, t]) => `<span><i style="background:${KM.CAT_COLOR[c]}"></i>${t}</span>`).join('') +
    (PROMOS.length ? `<span><i style="background:${KM.PROMO_COLOR}"></i>с промокодом</span>` : '') +
    (COARSE ? '<span class="map-hint">Карту двигают двумя пальцами или во весь экран — кнопкой в углу.</span>' : '');

  /* ---------- список мест ---------- */
  const listHints = p => { const e = K.placeHints(p).filter(h => ['halloween', 'newyear', 'autumn', 'night'].includes(h) || (h === 'first' && mode === 'date')).map(h => K.HINTS[h][0]).join(''); return e ? e + ' ' : ''; };
  const favBtn = key => { const on = T.isFav(key);
    return `<button type="button" class="fav${on ? ' on' : ''}" data-fav="${esc(key)}" aria-pressed="${on}" title="${on ? 'Убрать из сохранённых' : 'Сохранить'}">${I('bookmark')}<span>${on ? 'Сохранено' : 'Сохранить'}</span></button>`; };
  /* «до 31 декабря» (год — только если не текущий) */
  const untilText = ymd => { const d = K.parseYmd(ymd); if (!d) return ymd;
    return new Intl.DateTimeFormat('ru-RU', ymd.slice(0, 4) === todayYmd.slice(0, 4) ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' }).format(d); };
  const promoBox = x => x ? `<div class="promo-box"><span class="pb-ic" aria-hidden="true">${I('gift')}</span><div><b>${esc(x.title)}</b>
      ${x.code ? `<button type="button" class="pb-code" data-code="${esc(x.code)}" aria-label="Скопировать промокод ${esc(x.code)}">${esc(x.code)} ${I('copy')}</button>` : ''}
      ${x.terms ? `<small>${esc(x.terms)}</small>` : ''}${x.until ? `<small>Действует до ${esc(untilText(x.until))}</small>` : ''}${adLine(x)}</div></div>` : '';
  /* Фото, часы работы и отзывы — в Яндекс Картах: там у места всё это есть */
  const yaLink = (p, sm) => `<a class="ya-link${sm ? ' sm' : ''}" data-act="yandex" href="${K.mapUrl(p)}" target="_blank" rel="noopener"><span class="ya-ic" aria-hidden="true">${I('photo')}</span><span><b>Фото, часы и отзывы</b><small>в Яндекс Картах</small></span>${I('ext')}</a>`;
  /* «Место закрылось или есть ошибка?»: со своим сервером — форма прямо в карточке, без него — почта или чат поддержки из config.js */
  const REPORT = { place: 'Место закрылось или есть ошибка? Сообщи нам', plan: 'План устарел или есть ошибка? Сообщи нам' };
  function reportBox(kind, id, title) {
    const text = REPORT[kind] || REPORT.place;
    if (LIVE && typeof API.fix === 'function') {
      return `<details class="report-box"><summary>${I('flag')}${text}</summary>
        <form data-fix="${esc(id)}" data-fix-kind="${kind}" data-fix-title="${esc(title)}">
          <textarea name="text" maxlength="900" required aria-label="Что не так" aria-describedby="fixErr" placeholder="${kind === 'plan' ? 'Что не так? Например: одно из мест закрылось' : 'Что не так? Например: закрылось, переехало, другие часы'}"></textarea>
          <p class="fix-err" id="fixErr" data-fix-err role="alert"></p>
          <button type="submit" class="btn ghost wide">${I('send')}Отправить</button>
          <p class="muted">Без имени и контактов — уйдёт только этот текст.</p>
        </form></details>`;
    }
    // почта — первой: Telegram в России работает с перебоями
    const sup = CFG.support || {};
    if (sup.email) return `<a class="report" href="mailto:${esc(sup.email)}?subject=${encodeURIComponent('Ошибка: ' + id)}">${I('flag')}${text}</a>`;
    if (sup.telegram) return `<a class="report" href="https://t.me/${encodeURIComponent(sup.telegram)}?start=fix_${encodeURIComponent(id).slice(0, 56)}" target="_blank" rel="noopener">${I('flag')}${text}</a>`;
    return '';
  }
  /* Сортировка «По рейтингу» — когда хоть у одного места есть оценки гостей */
  const hasRatings = () => !!RV && PLACES.some(p => safe(() => RV.rating(p.id), null));
  /* Лента «Новые места» — в списке после NEWP_AT-го места, пока человек просто листает каталог */
  const NEWP_AT = 6;
  function newPlacesRail(pool) {
    const fresh = byNewest(pool.filter(isNew));
    if (fresh.length < 3) return '';
    return `<section class="feed-rail" aria-labelledby="nplTitle">
      <div class="feed-head"><h3 id="nplTitle">✨ Новые места</h3><button type="button" class="mini" data-pc-new>Все новые · ${fresh.length}</button></div>
      <div class="rail">${fresh.slice(0, RAIL_N).map(p => { const ph = K.photo(p);
        return `<button type="button" class="fy-card" data-pid="${esc(p.id)}">
          ${ph ? `<span class="fy-ph"><img src="${esc(ph.t)}" alt="" loading="lazy" decoding="async"></span>` : `<span class="fy-ph cover ${cvOf(p)}"><span class="cv-e" aria-hidden="true">${esc(p.emoji)}</span></span>`}
          <b>${esc(p.name)}</b><small>${esc(String(p.kind || '').split(' · ')[0])} · ${esc(K.metroText(p.metro))}</small></button>`; }).join('')}</div>
    </section>`;
  }
  /* Под фильтрами мест: бюджет на человека и «По рейтингу» */
  function renderPTools(rated) {
    if (rated === undefined) rated = hasRatings();
    renderBudget('#ptools', 'places', rated ? `<button type="button" class="mini sort${psort === 'rating' ? ' on' : ''}" data-psort aria-pressed="${psort === 'rating'}"><span class="rv-st" aria-hidden="true">★</span>По рейтингу</button>` : '');
  }
  function renderPlaces() {
    const q = norm(pq).trim();
    const inCat = p => pcat === 'all' || (pcat === 'michelin' ? !!p.mich : pcat === 'saved' ? T.isFav('place:' + p.id) : pcat === 'new' ? isNew(p)
      : pcat === 'promo' ? !!promoOf(p.id) : K.HINTS[pcat] ? K.placeHints(p).includes(pcat) : p.c === pcat);
    // компьютерные клубы в «Все» и «Новое» — только у пацанов (иначе «рядом со мной» на окраине — сплошь компы); в поиске и в «🎮 Компы» — всегда
    const pcHidden = (pcat === 'all' || pcat === 'new') && mode !== 'guys' && !q;
    const inQ = p => !q || norm(p.name + ' ' + p.kind + ' ' + p.metro + ' ' + p.addr + ' ' + (OKR_NAME[p.okr] || '')).includes(q);
    const base = PLACES.filter(p => inCat(p) && inQ(p) && !(pcHidden && p.c === 'pc') && budOk(p.price));
    let list = base.filter(p => pokr === 'all' || p.okr === pokr);
    if (near) list = list.map(p => [p, K.distM(near, p)]).sort((a, b) => a[1] - b[1]).map(([p, d]) => Object.assign({}, p, { dist: d }));
    const rated = hasRatings();
    if (psort === 'rating' && !rated) psort = '';
    // по рейтингу: сглаженная оценка (у мест без отзывов — средняя), при равенстве — прежний порядок (с фото или ближе)
    if (psort === 'rating') list = list.map((p, i) => [p, safe(() => +RV.score(p.id), 0) || 0, i]).sort((a, b) => (b[1] - a[1]) || a[2] - b[2]).map(x => x[0]);
    const hasSaved = PLACES.some(p => T.isFav('place:' + p.id));
    const hasNew = PLACES.some(isNew);
    $('#pfilters').innerHTML = PCATS.filter(([id]) => id === pcat || (id === 'saved' ? hasSaved : id === 'new' ? hasNew : id === 'promo' ? PROMOS.length : id === 'first' ? mode === 'date' : true)).map(([id, label]) =>
      `<button type="button" data-pc="${id}" class="${id === pcat ? 'on' : ''}" aria-pressed="${id === pcat}">${label}</button>`).join('');
    renderPTools(rated);
    const cnt = {};
    base.forEach(p => { cnt[p.okr] = (cnt[p.okr] || 0) + 1; });
    const nl = near ? esc(near.label || 'Рядом') : '';
    $('#pokrs').innerHTML = (near ? `<button type="button" data-near class="near on" aria-pressed="true" aria-label="Рядом: ${nl}. Нажми, чтобы сбросить">📍 ${nl} <span aria-hidden="true">✕</span></button>`
      : '<button type="button" data-near class="near" aria-pressed="false">📍 Рядом со мной</button>') + OKRS.filter(([id]) => id === 'all' || cnt[id] || id === pokr).map(([id, label]) =>
      `<button type="button" data-po="${id}" class="${id === pokr ? 'on' : ''}" aria-pressed="${id === pokr}">${label}<span class="n">${id === 'all' ? base.length : (cnt[id] || 0)}</span></button>`).join('');
    PLIST = list;
    if (pview === 'map') renderMap();
    $('#pcount').textContent = `${list.length} ${plural(list.length, 'место', 'места', 'мест')}`;
    // название обрезается многоточием, а значки Michelin и промокода стоят отдельно и не съедают его;
    // в подписи метро — первым: его чаще всего ищут глазами, и на узком экране оно не должно обрезаться
    // «Новые места» — только когда человек просто листает весь каталог
    const rail = pcat === 'all' && !q && !near && pokr === 'all' && !psort && list.length > NEWP_AT ? newPlacesRail(base) : '';
    $('#plist').innerHTML = list.length ? list.slice(0, plimit).map((p, i) => `
      <button type="button" class="pl-item${promoOf(p.id) ? ' has-promo' : ''}" data-pid="${esc(p.id)}">
        ${emoTile(p)}
        <span class="pl-main"><span class="pl-name"><span class="nm">${esc(p.name)}</span>${p.mich ? '<span class="mich" title="' + MICH[p.mich] + '">M</span>' : ''}${promoOf(p.id) ? '<span class="promo-tag" title="Есть промокод">🎁</span>' : ''}${placeRate(p.id)}</span><span class="pl-sub">${p.dist != null ? `<b class="dist">${distText(p.dist)}</b> · ` : ''}${esc(K.metroText(p.metro))} · ${listHints(p)}${esc(p.kind)}</span></span>
        ${priceTag(p.price)}
      </button>` + (i === NEWP_AT - 1 ? rail : '')).join('')
      : pcat === 'saved' ? '<p class="pl-empty">Здесь появятся места, которые ты сохранишь значком 🔖 в карточке.</p>'
      : bud ? '<p class="pl-empty">В этом бюджете ничего не нашлось — попробуй «любой» или другую категорию.</p>'
      : '<p class="pl-empty">Ничего не нашлось. Попробуй другое слово или категорию.</p>';
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

  /* ---------- карточка места ----------
     .sheet-slot — места для блоков, которые добавляются отдельно: data-slot="rating" (оценка под заголовком),
     "reviews" (отзывы), "events" (события в этом месте). Пустые слоты не видны. */
  /* so — параметры шторки (adopt: занять текущую запись истории) */
  function openPlace(id, so) {
    const p = K.placeById(id);
    if (!p || p.adult) return false;
    const similar = similarPlaces(id, 4);
    // планы только текущего режима: у чужих — другие кнопки и другой конструктор
    const inPlans = modePlans().filter(s => s.stops.includes(id));
    const ph = K.photo(p);
    const okr = p.okr && OKR_NAME[p.okr] && p.okr !== 'all' ? ' · ' + esc(OKR_NAME[p.okr]) : '';
    openSheet(`
      ${ph ? heroPh(ph, p.name) : placeCover(p)}
      ${ph && ph.file ? '<div class="gal hidden" role="group" aria-label="Ещё фото"></div>' : ''}
      <p class="eyebrow">${esc(p.kind)} · <span title="${esc(K.priceHint(p.price))}">${K.priceText(p.price)}</span>${okr}</p>
      <div class="ttl-row"><h3>${esc(p.name)}</h3>${favBtn('place:' + id)}</div>
      ${p.mich ? `<p class="mich-line"><span class="mich">M</span>${MICH[p.mich]}</p>` : ''}
      ${sheetHints(K.placeHints(p).filter(h => h !== 'michelin' && !(h === 'first' && mode !== 'date')))}
      <div class="sheet-slot" data-slot="rating">${ratingLine('place', id)}</div>
      ${promoBox(promoOf(id))}
      <p class="why">${esc(p.note)}</p>
      ${K.catOf(p) !== 'walk' ? budgetEst(p.price) : ''}
      <div class="stop solo">
        <span class="k">${esc(K.metroText(p.metro))}</span>
        <span class="addr">${esc(p.addr)}</span>
        ${yaLink(p)}
      </div>
      <div class="sheet-slot" data-slot="events">${placeEvents(id)}</div>
      ${inPlans.length ? `<div class="in-plans"><p class="k">Есть в готовых планах</p>${inPlans.map(s =>
        `<button type="button" class="chip" data-open-plan="${esc(s.id)}">${esc(s.title)}</button>`).join('')}</div>` : ''}
      ${similar.length ? `<div class="in-plans"><p class="k">Похожие рядом</p>${similar.map(x =>
        `<button type="button" class="chip" data-open-place="${esc(x.id)}">${esc(x.emoji)} ${esc(x.name)}</button>`).join('')}</div>` : ''}
      <div class="sheet-actions">
        <a class="btn primary wide" data-act="create" href="${createUrl(mode, 'p-' + id)}">${HERO[mode].call}${I('arrow')}</a>
        <div class="row two">
          <a class="btn ghost" data-act="route" href="${K.routeUrl([p])}" target="_blank" rel="noopener">${I('route')}Как добраться</a>
          <button type="button" class="btn ghost" data-share="place=${encodeURIComponent(id)}" data-title="${esc(p.name)}">${I('share')}Поделиться</button>
        </div>
      </div>
      <div class="sheet-slot" data-slot="reviews"></div>
      ${reportBox('place', id, p.name)}`, Object.assign({ kind: 'place', id, url: sheetUrl('place=' + encodeURIComponent(id)) }, so));
    T.ev('open_place', { kind: 'place', id, mode });
    if (ph && ph.file) GAL.load(id, ph).then(items => renderGallery(id, items)).catch(() => { /* Commons недоступен — одно фото */ });
    mountReviews(id, p, so && so.reviews);
    return true;
  }
  /* «Отзывы гостей» в карточке места (assets/reviews.js) — со своим сервером; без него слот пустой и не виден.
     toReviews — карточку открыли кнопкой «Отзывы» из плана (плавно прокручиваем к отзывам)
     или 'land' — по ссылке start.html?place=…#reviews («Оцени место» из игры): сразу и держим, пока догружаются фото */
  function mountReviews(id, p, toReviews) {
    const slot = $('#sheet .sheet-slot[data-slot="reviews"]');
    if (!RV || !slot || typeof RV.mount !== 'function') return;
    if (!safe(() => RV.mount(slot, id, { placeName: p.name, mode }), false)) return;
    const h = $('.rv-h', slot);
    if (h) h.textContent = 'Отзывы гостей';
    if (toReviews) goReviews(toReviews === 'land' ? id : '');
  }
  function goReviews(landId) {
    const slot = $('#sheet .sheet-slot[data-slot="reviews"]');
    if (!slot || !slot.firstChild) return;
    if (landId) pinTo(() => $('#sheet .sheet-slot[data-slot="reviews"]'), () => SH.isOpen() && $('#sheet').dataset.id === landId);
    else slot.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const h = $('.rv-h', slot);
    if (h) { if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
  /* Строка оценки под заголовком: у места — «★ 4,6 · 12 отзывов гостей» (ведёт к отзывам), у плана — средняя по местам */
  function ratingLine(kind, id) {
    if (!RV) return '';
    if (kind === 'place') {
      const r = safe(() => RV.rating(id), null), b = safe(() => RV.badge(id, { short: true }), '');
      if (!r || !b) return '';
      return `<button type="button" class="rate-line" data-goto-rv>${b}<span>${r.count} ${plural(r.count, 'отзыв', 'отзыва', 'отзывов')} гостей</span></button>`;
    }
    const plan = K.planById(id), b = plan ? safe(() => RV.planBadge(plan), '') : '';
    return b ? `<p class="rate-line">${b}<span>оценка мест плана по отзывам гостей</span></p>` : '';
  }
  /* «Скоро здесь»: ближайшие события в этом месте (афиша) */
  function placeEvents(id) {
    if (!A || typeof A.upcoming !== 'function') return '';
    const evs = safe(() => A.upcoming({}), []).filter(e => e.place === id).slice(0, 3);
    return evs.length ? `<div class="in-plans"><p class="k">Скоро здесь</p>${evs.map(e =>
      `<button type="button" class="chip ev-row" data-open-event="${esc(e.id)}"><span class="ev-e" aria-hidden="true">${esc(e.emoji || '📅')}</span><span><b>${esc(e.title)}</b> <small>${esc(evWhen(e))}</small></span></button>`).join('')}</div>` : '';
  }
  /* Ещё фото места (Wikimedia Commons) лентой превью; по нажатию — крупно с автором и лицензией */
  function renderGallery(id, items) {
    const box = $('#sheet .gal');
    if (!box || !SH.isOpen() || $('#sheet').dataset.id !== id || !items.length) return;
    box.innerHTML = items.map((x, i) => `<button type="button" class="gal-it" data-gal="${i}" aria-label="Фото ${i + 2}: ${esc(x.a)}"><img src="${esc(x.t || x.s)}" alt="" loading="lazy" decoding="async"></button>`).join('');
    box.classList.remove('hidden');
    box._items = items;
  }
  /* Фото крупно — отдельный диалог поверх карточки: Esc и × закрывают, фокус возвращается к превью */
  function showPhoto(x, from) {
    const ov = document.createElement('div');
    ov.className = 'lightbox';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Фото');
    ov.innerHTML = `<figure><img src="${esc(x.s)}" alt=""><figcaption>${K.photoCredit(x)}</figcaption></figure><button type="button" class="lb-x" aria-label="Закрыть фото">${I('x')}</button>`;
    const close = () => { ov.remove(); if (from && from.isConnected) from.focus({ preventScroll: true }); };
    ov.addEventListener('click', e => { if (!e.target.closest('figcaption a')) close(); });
    ov.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      const f = $$('a[href], button', ov), i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
    });
    document.body.appendChild(ov);
    $('.lb-x', ov).focus();
  }

  /* ---------- «Для тебя»: планы, которые модель (assets/track.js) считает самыми подходящими ---------- */
  function renderForYou() {
    const picks = T.forYou(modePlans(), 8);
    $('#foryouBlock').classList.toggle('hidden', picks.length < 3);
    if (picks.length < 3) return;
    const likes = T.topLikes(2);
    $('#fyNote').textContent = likes.length ? `Подобрали по тому, что ты открываешь и сохраняешь: ты любишь ${likes.join(' и ')}.` : 'Подобрали по тому, что ты открываешь и сохраняешь.';
    $('#foryou').innerHTML = picks.map(p => { const { st } = planMeta(p); const ph = K.planPhoto(p);
      return `<button type="button" class="fy-card" data-plan="${esc(p.id)}">
        ${ph ? `<span class="fy-ph"><img src="${esc(ph.t)}" alt="" loading="lazy" decoding="async"></span>` : `<span class="fy-ph cover ${cvOf(st[0])}" aria-hidden="true">${coverEmo(st, p)}</span>`}
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

  /* ---------- карточка плана ---------- */
  function openPlan(id, so) {
    const plan = K.planById(id);
    if (!plan) return false;
    // «план» из одного места каталога (p-<id>) — это просто карточка места
    if (plan.single) return openPlace(plan.stops[0], so);
    opened.add(plan.id);
    // план другого режима (например, по ссылке из чужого режима) — открываем в его режиме, чтобы кнопки совпадали
    if (plan.mode && plan.mode !== mode && ORDER.includes(plan.mode)) setMode(plan.mode);
    const { st, legs, price } = planMeta(plan);
    if (!st.length) return false;
    const shown = new Set();
    const stopPh = p => { const ph = K.photo(p); if (!ph || shown.has(ph.u)) return ''; shown.add(ph.u);
      return `<figure class="stop-ph"><img src="${esc(ph.s)}" alt="${esc(p.name)}" loading="lazy" decoding="async"><figcaption>${K.photoCredit(ph)}</figcaption></figure>`; };
    // у мест из planStops нет id — берём его из плана, иначе промокоды остановок не находятся
    const ids = plan.stops.filter(x => K.placeById(x));
    const parts = st.map((p, i) => { const pr = promoOf(ids[i]); return (i ? `<span class="dash"></span><span class="walk">${legText(legs[i - 1], plan)}</span>` : '') + `
      <span class="dot${i ? ' o' : ''}"></span>
      <div class="stop${pr ? ' has-promo' : ''}">
        ${stopPh(p)}
        <b>${esc(p.name)}${pr ? ' <span class="promo-tag">🎁 промокод</span>' : ''}</b>
        <span class="k">${esc(p.kind)} · ${esc(K.metroText(p.metro))} · <span title="${esc(K.priceHint(p.price))}">${K.priceText(p.price)}</span></span>
        ${RV ? `<span class="stop-rate"><span data-rate-place="${esc(ids[i])}">${safe(() => RV.badge(ids[i]), '')}</span><button type="button" class="stop-rv" data-open-place="${esc(ids[i])}" data-rv>Отзывы<span class="vh"> о месте «${esc(p.name)}»</span></button></span>` : ''}
        <p>${esc(p.note)}</p>
        ${promoBox(pr)}
        <span class="addr">${esc(p.addr)}</span>
        ${yaLink(p, true)}
      </div>`; }).join('');
    const anyPh = st.some(p => K.photo(p));
    openSheet(`
      ${anyPh ? '' : `<div class="hero-cv cover ${cvOf(st[0])}" aria-hidden="true">${coverEmo(st, plan)}</div>`}
      <p class="eyebrow">${[esc(plan.when), `<span title="${esc(K.priceHint(price))}">${K.priceText(price)}</span>`].filter(Boolean).join(' · ')}</p>
      <div class="ttl-row"><h3>${esc(plan.title)}</h3>${favBtn('plan:' + plan.id)}</div>
      ${sheetHints(K.planHints(plan).filter(h => !(h === 'first' && mode !== 'date')))}
      <div class="sheet-slot" data-slot="rating">${ratingLine('plan', plan.id)}</div>
      <p class="why">${esc(plan.why)}</p>
      ${st.some(p => K.catOf(p) !== 'walk') ? budgetEst(price) : ''}
      <div class="itin">${parts}</div>
      <div class="sheet-actions">
        <a class="btn primary wide" data-act="create" href="${createUrl(mode, plan.id)}">${HERO[mode].call}${I('arrow')}</a>
        <div class="row two">
          <a class="btn ghost" data-act="route" href="${K.routeUrl(st)}" target="_blank" rel="noopener">${I('route')}${st.length > 1 ? 'Маршрут' : 'Как добраться'}</a>
          <button type="button" class="btn ghost" data-share="plan=${encodeURIComponent(plan.id)}" data-title="${esc(plan.title)}">${I('share')}Поделиться</button>
        </div>
      </div>
      ${reportBox('plan', plan.id, plan.title)}`, Object.assign({ kind: 'plan', id: plan.id, url: sheetUrl('plan=' + encodeURIComponent(plan.id)) }, so));
    T.ev('open_plan', { kind: 'plan', id: plan.id, mode });
    return true;
  }

  function apply() {
    document.documentElement.dataset.mode = mode;
    document.documentElement.dataset.acc = K.MODES[mode].acc || '';
    renderModes(); renderHero(); renderForYou(); renderCards();
    renderAfTab(); renderAfisha();
    $('#adultLink').href = 'adult.html?m=' + mode;
    // модули страницы (афиша и др.) подстраиваются под режим по этому событию
    try { document.dispatchEvent(new CustomEvent('kuda-mode', { detail: { mode } })); } catch (e) { /* старый браузер */ }
  }
  function setMode(m) {
    if (!ORDER.includes(m) || m === mode) return;
    mode = m;
    flt = 'all'; climit = CSTEP;
    try { localStorage.setItem('kuda-mode', mode); } catch (err) { /* ок */ }
    if (pcat === 'first' && mode !== 'date') pcat = 'all';
    // подборка из квиза — для другого повода: прячем
    if (quizRes && quizRes.q.who !== mode) { quizRes = null; renderQuizRes(); }
    apply();
    renderPlaces();
    syncUrl();
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
    syncUrl();
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
    syncUrl();
  });

  /* ---------- «Рядом со мной» ---------- */
  function setNear(p) {
    near = p;
    G.save(p);
    setPicking(false);
    pokr = 'all'; plimit = PSTEP;
    // прокручиваем, когда шторка закрылась и история вернулась назад — иначе браузер вернёт старую прокрутку
    closeSheet(() => {
      renderPlaces();
      syncUrl();
      $('#placesBlock').scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (p) { toast('Сначала — ближайшие места'); T.ev('near', { v: p.src }); }
    });
  }
  /* Окно выбора открывается сразу; геолокация идёт параллельно и сама подставит точку, если успеет */
  let locating = 0;
  function toggleNear() {
    setPicking(false);
    if (near) { near = null; G.save(null); renderPlaces(); return; }
    openNearPicker('Определяем, где ты… Можно не ждать — выбери станцию метро или точку на карте.', true);
    const run = ++locating;
    G.locate().then(p => {
      if (run !== locating || $('#sheet').dataset.kind !== 'near' || !SH.isOpen()) return;
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
    openSheet(`
      <h3>Откуда искать?</h3>
      <p class="muted${busy ? ' busy' : ''}" id="nearMsg" role="status">${esc(msg)}</p>
      <label class="psearch"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input id="mq" type="search" placeholder="Станция метро" aria-label="Станция метро" autocomplete="off"></label>
      <div class="metro-list" id="mlist"></div>
      <div class="sheet-actions">
        <button type="button" class="btn ghost wide" id="pickMap">${I('map')}Поставить точку на карте</button>
        <button type="button" class="btn ghost wide" id="pickRetry">${I('locate')}Попробовать определить ещё раз</button>
      </div>`, { kind: 'near' });
    const draw = q => {
      const nq = norm(q).trim();
      const list = st.filter(x => !nq || norm(x.name).includes(nq)).slice(0, nq ? 40 : 24);
      $('#mlist').innerHTML = list.map(x => `<button type="button" class="chip" data-metro="${esc(x.name)}"><span class="metro" aria-hidden="true">М</span>${esc(x.name)}</button>`).join('') || '<p class="muted">Такой станции нет в каталоге — поставь точку на карте.</p>';
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
      closeSheet(() => {
        setView('map');
        setPicking(true);
        $('#mapPick').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    };
    // шторку не закрываем: окно выбора просто открывается заново с новым поиском
    $('#pickRetry').onclick = () => { near = null; toggleNear(); };
  }

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
  /* Карта: «Подробнее» в балуне, отмена выбора точки, повторная загрузка */
  $('#placesBlock').addEventListener('click', e => {
    const op = e.target.closest('#pmap [data-open-place]');
    if (op) {
      if (MAP && MAP.container.isFullscreen()) MAP.container.exitFullscreen();
      openPlace(op.dataset.openPlace);
      return;
    }
    if (e.target.closest('[data-pick-cancel]')) { setPicking(false); return; }
    if (e.target.closest('[data-map-retry]')) { $('#pmap').innerHTML = ''; renderMap(); }
  });
  $('#plist').addEventListener('click', e => {
    if (e.target.closest('[data-pc-new]')) { pcat = 'new'; plimit = PSTEP; renderPlaces(); syncUrl(); $('#pfilters').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const b = e.target.closest('[data-pid]');
    if (b) openPlace(b.dataset.pid);
  });
  /* Бюджет на человека (в планах и в местах) и «По рейтингу» */
  function onTools(e) {
    const b = e.target.closest('button[data-bud]');
    if (b) {
      const host = e.currentTarget, v = b.dataset.bud;
      setBudget(+v, b.dataset.budIn);
      const nb = host && $(`[data-bud="${v}"]`, host);
      if (nb) nb.focus({ preventScroll: true });
      return;
    }
    if (e.target.closest('[data-psort]')) {
      psort = psort === 'rating' ? '' : 'rating'; plimit = PSTEP;
      renderPlaces();
      const nb = $('#ptools [data-psort]');
      if (nb) nb.focus({ preventScroll: true });
      if (psort) T.ev('sort', { v: 'rating' });
    }
  }
  ['#budget', '#ptools'].forEach(sel => { const el = $(sel); if (el) el.addEventListener('click', onTools); });
  $('#sheet').addEventListener('click', e => {
    const sh = e.target.closest('[data-share]');
    const sk = $('#sheet').dataset;
    if (sh) { share(sh.dataset.title, shareUrl(sh.dataset.share)); T.ev('share', { kind: sk.kind, id: sk.id, mode }); return; }
    const fv = e.target.closest('[data-fav]');
    if (fv) {
      const on = T.toggleFav(fv.dataset.fav);
      fv.outerHTML = favBtn(fv.dataset.fav);
      const nb = $$('#sheet [data-fav]').find(x => x.dataset.fav === fv.dataset.fav);
      if (nb) nb.focus({ preventScroll: true });
      toast(on ? 'Сохранено — ищи в «Сохранённых»' : 'Убрано из сохранённых');
      if (sk.kind === 'place') renderPlaces(); else renderCards();
      return;
    }
    const pc = e.target.closest('[data-code]');
    if (pc) { if (navigator.clipboard) navigator.clipboard.writeText(pc.dataset.code).then(() => toast('Промокод скопирован'), () => {}); T.ev('promo_copy', { kind: 'place', id: sk.id }); return; }
    const gi = e.target.closest('[data-gal]');
    if (gi) { const box = gi.closest('.gal'); if (box && box._items) showPhoto(box._items[+gi.dataset.gal], gi); return; }
    const act = e.target.closest('[data-act]');
    if (act && (sk.kind === 'place' || sk.kind === 'plan')) T.ev(act.dataset.act, { kind: sk.kind, id: sk.id, mode });
    if (e.target.closest('[data-goto-rv]')) { goReviews(); return; }
    // «Отзывы» у остановки плана — карточка места сразу на отзывах
    const op = e.target.closest('[data-open-place]');
    if (op) { openPlace(op.dataset.openPlace, op.hasAttribute('data-rv') ? { reviews: true } : null); return; }
    const oe = e.target.closest('[data-open-event]');
    if (oe) { openEvent(oe.dataset.openEvent); return; }
    const b = e.target.closest('[data-open-plan]');
    if (b) { openPlan(b.dataset.openPlan); return; }
    const qz = e.target.closest('[data-qz]');
    if (qz) quizAnswer(qz.dataset.qz, qz.dataset.v);
  });
  /* Сообщение об ошибке в месте или плане — модератору на свой сервер.
     Ошибку в форме пишем текстом (role="alert") и отмечаем поле; после отправки фокус — на «Спасибо», а не в пустоту */
  function fixErr(f, msg) {
    const ta = $('textarea', f), el = $('[data-fix-err]', f);
    if (el) el.textContent = msg;
    if (ta) { if (msg) ta.setAttribute('aria-invalid', 'true'); else ta.removeAttribute('aria-invalid'); }
  }
  $('#sheet').addEventListener('input', e => {
    const f = e.target.closest('form[data-fix]');
    if (f && e.target.matches('textarea[aria-invalid]')) fixErr(f, '');
  });
  $('#sheet').addEventListener('submit', async e => {
    const f = e.target.closest('form[data-fix]');
    if (!f) return;
    e.preventDefault();
    const ta = $('textarea', f), btn = $('button[type="submit"]', f);
    const text = ta.value.trim();
    // как на сервере: не меньше трёх символов (эмодзи — один символ)
    if (Array.from(text).length < 3) { fixErr(f, 'Опиши проблему хотя бы парой слов.'); ta.focus(); return; }
    fixErr(f, '');
    btn.disabled = true;
    const body = f.dataset.fixKind === 'plan' ? `План «${f.dataset.fixTitle}»: ${text}` : text;
    let ok = false;
    try { ok = await API.fix(f.dataset.fix, body); } catch (er) { ok = false; }
    if (!f.isConnected) return;
    btn.disabled = false;
    if (ok) {
      const box = f.closest('details'), done = document.createElement('p');
      done.className = 'report';
      done.setAttribute('role', 'status');
      done.tabIndex = -1;
      done.innerHTML = `${I('check')}Спасибо! Проверим и поправим.`;
      box.replaceWith(done);
      done.focus({ preventScroll: true });
      T.ev('fix', { v: f.dataset.fixKind });
    } else toast(API.lastError === 'rate' ? 'Слишком часто — попробуй чуть позже' : 'Не получилось отправить — проверь интернет и попробуй ещё раз');
  });
  $('#filters').addEventListener('click', e => {
    const b = e.target.closest('button[data-f]');
    if (!b || b.dataset.f === flt) return;
    flt = b.dataset.f; climit = CSTEP;
    renderCards();
    syncUrl();
  });
  $('#season').addEventListener('click', e => {
    const b = e.target.closest('button[data-f]');
    if (!b) return;
    flt = b.dataset.f === flt ? 'all' : b.dataset.f; climit = CSTEP;
    renderCards();
    syncUrl();
  });
  /* «Удиви меня»: случайный, но хороший план под текущий фильтр и бюджет — из лучшей части списка
     (по сезону, фото, оценкам гостей и тому, что человеку нравится), не тот же, что в прошлый раз */
  $('#random').onclick = () => {
    const fn = (FILTERS.find(f => f[0] === flt) || FILTERS[0])[2];
    let plans = modePlans().filter(p => fn(p) && budOk(planPrice(p)));
    if (!plans.length) plans = modePlans();
    if (!plans.length) return;
    const ranked = plans.map(p => [p, planQuality(p)]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
    const pool = ranked.slice(0, Math.max(8, Math.ceil(ranked.length * 0.4)));
    const prev = $('#random')._last;
    let p;
    do { p = pool[(Math.random() * pool.length) | 0]; } while (pool.length > 1 && p.id === prev);
    $('#random')._last = p.id;
    T.ev('surprise', { mode });
    openPlan(p.id);
  };
  $('#foryou').addEventListener('click', e => {
    const c = e.target.closest('[data-plan]');
    if (c) openPlan(c.dataset.plan);
  });
  $('#fyReset').onclick = () => { T.reset(); renderForYou(); renderPlaces(); toast('Забыли твои предпочтения'); };
  $('#cards').addEventListener('click', e => {
    if (e.target.closest('[data-f-new]')) { flt = 'new'; climit = CSTEP; renderCards(); syncUrl(); $('#filters').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const c = e.target.closest('[data-plan]');
    if (c) openPlan(c.dataset.plan);
  });
  // Esc в режиме «точка на карте» — отмена (шторку закрывает сама шторка)
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && picking && !SH.isOpen()) setPicking(false);
  });

  /* ---------- оценки гостей (assets/reviews.js): пришли рейтинги — дописываем значки на месте, без перерисовки карточек ---------- */
  const PRIOR = 4.2;   // у мест без отзывов reviews.js отдаёт score = 4,2 — «как в среднем»
  const avgScore = ids => {
    if (!RV) return 0;
    const v = (ids || []).map(id => +safe(() => RV.score(id), 0)).filter(x => x > 0);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  };
  function paintRatings() {
    if (!RV) return;
    $$('[data-rate-plan]').forEach(el => {
      const p = K.planById(el.dataset.ratePlan), h = p ? safe(() => RV.planBadge(p), '') : '';
      if (el.innerHTML !== h) el.innerHTML = h;
    });
    $$('[data-rate-place]').forEach(el => {
      const h = safe(() => RV.badge(el.dataset.ratePlace, el.closest('.stop-rate') ? null : { short: true }), '');
      if (el.innerHTML !== h) el.innerHTML = h;
    });
    const ds = $('#sheet').dataset, slot = $('#sheet .sheet-slot[data-slot="rating"]');
    if (SH.isOpen() && slot && (ds.kind === 'place' || ds.kind === 'plan')) slot.innerHTML = ratingLine(ds.kind, ds.id);
    // «По рейтингу» появляется, когда есть оценки; если список уже так отсортирован — порядок мог измениться
    if (psort === 'rating') renderPlaces();
    else if (!!$('#ptools [data-psort]') !== hasRatings()) renderPTools();
  }
  if (RV) {
    document.addEventListener('kuda-ratings', paintRatings);
    if (RV.ready && typeof RV.ready.then === 'function') RV.ready.then(paintRatings, () => { /* без оценок */ });
  }

  /* Насколько план хорош «вообще» — для «Удиви меня» и квиза: сезон, фото, оценки гостей, вкусы человека («Для тебя»)
     и погода (bad — непогода в нужный день; не задано — сегодняшняя) */
  function planQuality(p, bad) {
    let q = 0;
    if (K.planHints(p).some(h => SEASON.includes(h))) q += 0.8;
    if (K.planPhoto(p)) q += 0.4;
    const s = avgScore(p.stops);
    if (s) q += 2 * (s - PRIOR);
    if (T.ready()) q += 2 * (1 / (1 + Math.exp(-T.score('plan', p.id))) - 0.5);
    if (bad === undefined) bad = !!wxHint(WX);
    if (bad) q += indoorPlan(p) ? 0.6 : -0.6;
    return q;
  }

  /* ---------- погода (Open-Meteo, без ключа): дождь, снег или мороз — плашка «вот планы под крышей» ----------
     В запросе только координаты центра Москвы — ничего о человеке; ответ живёт час в sessionStorage. Не ответил — плашки нет. */
  const WX_URL = 'https://api.open-meteo.com/v1/forecast?latitude=55.75&longitude=37.62&current=temperature_2m,precipitation,weather_code' +
    '&daily=weather_code,temperature_2m_max,precipitation_probability_max,precipitation_sum&timezone=Europe%2FMoscow&forecast_days=7';
  const WX_KEY = 'kuda-wx', WX_TTL = 3600e3;
  let WX = null;
  function wxCached() {
    try {
      const c = JSON.parse(sessionStorage.getItem(WX_KEY) || 'null'), age = c ? Date.now() - c.at : -1;
      if (c && c.d && c.d.day === todayYmd && age >= 0 && age < WX_TTL) return c.d;
    } catch (e) { /* хранилище недоступно */ }
    return null;
  }
  function wxParse(j) {
    const c = j && j.current, dl = j && j.daily;
    if (!c || !dl || !Array.isArray(dl.time)) return null;
    const num = v => (v == null || v === '' || !isFinite(+v) ? null : +v);
    const col = k => (Array.isArray(dl[k]) ? dl[k] : []);
    const days = {};
    dl.time.forEach((d, i) => { days[d] = { code: num(col('weather_code')[i]), pp: num(col('precipitation_probability_max')[i]), ps: num(col('precipitation_sum')[i]), t: num(col('temperature_2m_max')[i]) }; });
    return { day: todayYmd, t: num(c.temperature_2m), code: num(c.weather_code), days };
  }
  async function wxLoad() {
    if (typeof fetch !== 'function') return null;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctl) ctl.abort(); }, 5000);
    try {
      const r = await fetch(WX_URL, { signal: ctl ? ctl.signal : undefined, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!r.ok) return null;
      const d = wxParse(await r.json());
      if (d) { try { sessionStorage.setItem(WX_KEY, JSON.stringify({ at: Date.now(), d })); } catch (e) { /* ок */ } }
      return d;
    } catch (e) { return null; } finally { clearTimeout(timer); }
  }
  /* Коды WMO: 51–57 морось, 61–67 дождь, 71–77 снег, 80–82 ливень, 85–86 снегопад, 95–99 гроза → [эмодзи, что, обещают что] */
  function wxWord(c) {
    if (c == null) return null;
    if (c >= 95 && c <= 99) return ['⛈️', 'гроза', 'грозу'];
    if (c === 56 || c === 57 || c === 66 || c === 67) return ['🌧️', 'ледяной дождь', 'ледяной дождь'];
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return ['🌨️', 'снег', 'снег'];
    if (c >= 51 && c <= 55) return ['🌦️', 'морось', 'морось'];
    if ((c >= 61 && c <= 65) || (c >= 80 && c <= 82)) return ['🌧️', 'дождь', 'дождь'];
    return null;
  }
  /* Осадки в этот день: обещают с вероятностью от 60 % или от 2 мм */
  const wxWetDay = d => !!d && !!wxWord(d.code) && ((d.pp != null && d.pp >= 60) || (d.ps != null && d.ps >= 2));
  // знак — по округлённому значению: −0,4° — это «0°», а не «−0°»
  const tempText = t => { if (t == null) return ''; const r = Math.round(t); return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r) + '°'; };
  /* Сегодня: { emoji, text } или null — идёт дождь или снег, их обещают или мороз от −10° */
  function wxHint(w) {
    if (!w || w.day !== todayYmd) return null;
    const t = tempText(w.t), now = wxWord(w.code), day = w.days && w.days[todayYmd];
    if (now) return { emoji: now[0], text: `Сегодня ${t ? t + ' и ' : ''}${now[1]}` };
    if (wxWetDay(day)) { const f = wxWord(day.code); return { emoji: f[0], text: `Сегодня ${t ? t + ', ' : ''}обещают ${f[2]}` }; }
    if (w.t != null && w.t <= -10) return { emoji: '🥶', text: `Сегодня ${t}` };
    return null;
  }
  /* Ближайшие выходные (в субботу — сб и вс, в воскресенье — только оно) */
  function weekendDays() {
    const n = K.dayNum(todayYmd), wd = new Date(Date.UTC(+todayYmd.slice(0, 4), +todayYmd.slice(5, 7) - 1, +todayYmd.slice(8))).getUTCDay();
    if (wd === 0) return [todayYmd];
    const sat = n + (6 - wd);
    return [K.numDay(sat), K.numDay(sat + 1)];
  }
  function renderWx() {
    const box = $('#wx');
    if (!box) return;
    const h = wxHint(WX), n = h ? modePlans().filter(indoorPlan).length : 0;
    box.classList.toggle('hidden', !n);
    if (!n) { box.innerHTML = ''; return; }
    const on = flt === 'rain';
    box.innerHTML = `<button type="button" class="wx-btn${on ? ' on' : ''}" data-wx aria-pressed="${on}"><span class="wx-e" aria-hidden="true">${h.emoji}</span>` +
      `<span class="wx-t">${esc(h.text)} — вот планы под крышей</span><span class="wx-go" aria-hidden="true">${on ? I('check') + '<span class="wx-gt">Показаны</span>' : '<span class="wx-gt">Показать</span>' + I('arrow')}</span></button>`;
  }
  const wxBox = $('#wx');
  if (wxBox) wxBox.addEventListener('click', e => {
    if (!e.target.closest('[data-wx]')) return;
    const on = flt !== 'rain';
    flt = on ? 'rain' : 'all'; climit = CSTEP;
    renderCards();
    syncUrl();
    const nb = $('#wx [data-wx]');
    if (nb) nb.focus({ preventScroll: true });
    if (on) T.ev('weather', { v: WX && WX.code != null ? String(WX.code) : '', mode });
  });

  /* ---------- афиша (assets/afisha.js) ---------- */
  const WD_S = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const MON_S = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const MON_G = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  /* «сегодня, 19:00», «сб, 17 окт, 20:00», у выставок — «до 12 января» (cap — с большой буквы) */
  function evWhen(e, cap) {
    let t;
    if (e.long) t = e.end === todayYmd ? 'последний день — сегодня' : `до ${+e.end.slice(8)} ${MON_G[+e.end.slice(5, 7) - 1]}`;
    else {
      const d = e.next || K.eventDays(e)[0] || e.start, [y, m, dd] = d.split('-').map(Number);
      t = d === todayYmd ? 'сегодня' : d === K.numDay(K.dayNum(todayYmd) + 1) ? 'завтра'
        : `${WD_S[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]}, ${dd} ${MON_S[m - 1]}`;
      if (e.time) t += ', ' + e.time;
    }
    return cap ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  }
  /* Параметры для афиши: карточка события — в шторке главной с адресом ?event=<id> («Назад» её закрывает);
     «Вся афиша» и «Готовые планы» — прокрутка, когда шторка закрылась; место рядом с событием — карточка места */
  function afOpts(id, so) {
    return {
      mode,
      openSheet: (html, o) => {
        const eid = (o && o.id) || id;
        return openSheet(html, Object.assign({}, o, { url: eid ? sheetUrl('event=' + encodeURIComponent(eid)) : undefined }, so && so.adopt ? { adopt: true } : null));
      },
      onAll: () => closeSheet(() => goTab('events')),
      onPlans: () => closeSheet(() => goTab('plans')),
      onPlace: pid => { T.ev('event_plan', { kind: 'event', id: $('#sheet').dataset.id || '', v: pid, mode }); openPlace(pid); },
    };
  }
  /* Открыть событие (по ссылке — через handleDeepLink). Прошедшее — афиша сама покажет «уже прошло» с подсказками */
  function openEvent(id, so) {
    if (!A || !id) return false;
    const o = afOpts(id, so);
    if (so && so.deep && typeof A.handleDeepLink === 'function') safe(() => A.handleDeepLink(new URLSearchParams('event=' + encodeURIComponent(id)), o));
    else safe(() => A.open(id, o));
    return SH.isOpen() && $('#sheet').dataset.kind === 'event';
  }
  const afCount = (m, when) => safe(() => (when ? A.upcoming({ mode: m, when }).length : A.count({ mode: m })), 0);
  /* Вкладка «Афиша» — когда есть хоть одно событие; на ней число событий этой недели под текущий повод */
  function renderAfTab() {
    const tab = $('#tabEvents'), blk = $('#eventsBlock');
    if (!A || !tab || !blk) return;
    const any = afCount('') > 0;
    tab.classList.toggle('hidden', !any);
    blk.classList.toggle('hidden', !any);
    const wk = any && typeof A.upcoming === 'function' ? afCount(mode, 'week') : 0;
    tab.innerHTML = 'Афиша' + (wk ? `<span class="tab-n" aria-hidden="true">${wk}</span>` : '');
    if (wk) tab.setAttribute('aria-label', `Афиша: ${wk} ${plural(wk, 'событие', 'события', 'событий')} на этой неделе`);
    else tab.removeAttribute('aria-label');
    const n = any ? afCount(mode) : 0;
    setText('#ecount', n ? `${n} ${plural(n, 'событие', 'события', 'событий')}` : '');
  }
  /* Лента «Ближайшие события» и вкладка — после первой отрисовки (afReady), дальше — при смене повода */
  let afReady = false;
  function renderAfisha() {
    if (!A || !afReady) return;
    const blk = $('#eventsBlock'), host = $('#afisha'), sh = $('#shelf');
    if (host && blk && !blk.classList.contains('hidden')) safe(() => A.mount(host, afOpts()));
    if (sh && typeof A.shelf === 'function') {
      sh.classList.remove('hidden'); sh.classList.remove('wait');
      safe(() => A.shelf(sh, Object.assign(afOpts(), { limit: 8 })));
    }
  }
  function bootAfisha() { if (A && !afReady) { afReady = true; renderAfisha(); } }
  document.addEventListener('kuda-afisha', renderAfTab);   // вкладка висела открытой: прошедшее афиша убрала сама

  /* ---------- «Подобрать за 10 секунд»: с кем, бюджет, когда (+ где) → три лучших плана и два события ---------- */
  const QZ = [
    { k: 'who', q: 'С кем идёшь?', o: [['date', '💕', 'На свидание'], ['guys', '🍻', 'С друзьями'], ['girls', '💅', 'С подругами']] },
    { k: 'bud', q: 'Бюджет на человека', o: [['1', '💸', `до 1${NB}500${NB}₽`], ['2', '💳', `до 3${NB}000${NB}₽`], ['0', '✨', 'Неважно']] },
    { k: 'when', q: 'Когда?', o: [['eve', '🌆', 'Сегодня вечером'], ['day', '☀️', 'На выходных днём'], ['late', '🌙', 'Поздно, после 22:00']] },
    { k: 'where', q: 'Где удобнее?', o: [['any', '🗺️', 'Неважно'], ['near', '📍', 'Рядом со мной']] },
  ];
  const QZ_OKRS = ['center', 'north', 'ne', 'east', 'se', 'south', 'sw', 'west', 'nw'];
  const WHEN_SUM = { eve: 'сегодня вечером', day: 'на выходных днём', late: 'поздно вечером' };
  /* Время дня плана под ответ «когда» */
  const WHEN_W = {
    eve: { 'вечер': 3, 'закат': 3, 'ночь': 1, 'день': -1.5, 'утро': -2.5 },
    day: { 'день': 3, 'утро': 2.5, 'закат': 1, 'вечер': -1.5, 'ночь': -3 },
    late: { 'ночь': 3, 'вечер': 0.5, 'закат': -0.5, 'день': -3, 'утро': -3 },
  };
  let Q = null, quizRes = null;
  function quizHtml(msg) {
    const s = QZ[Q.step];
    return `<p class="eyebrow">Подобрать за 10 секунд · ${Q.step + 1} из ${QZ.length}</p>
      <div class="qz-prog" aria-hidden="true">${QZ.map((x, i) => `<i${i <= Q.step ? ' class="on"' : ''}></i>`).join('')}</div>
      <h3 id="qzQ" tabindex="-1">${s.q}</h3>
      <div class="qz-opts" role="group" aria-labelledby="qzQ">${s.o.map(([v, e, t]) =>
        `<button type="button" class="qz-opt" data-qz="${s.k}" data-v="${v}"><span class="qz-e" aria-hidden="true">${e}</span><span>${t}</span></button>`).join('')}</div>
      ${s.k === 'where' ? `<div class="qz-okrs" role="group" aria-label="Или округ">${QZ_OKRS.map(o =>
        `<button type="button" class="chip" data-qz="where" data-v="${o}">${OKR_NAME[o]}</button>`).join('')}</div>` : ''}
      <p class="muted qz-msg${Q.busy ? ' busy' : ''}" role="status">${esc(msg || '')}</p>
      ${Q.step ? `<button type="button" class="link qz-back" data-qz="back">${I('arrow')}Назад</button>` : ''}`;
  }
  function quizStep(msg) {
    const box = $('#qz');
    if (!box || !Q) return;
    box.innerHTML = quizHtml(msg);
    const h = $('#qzQ');
    if (h) h.focus({ preventScroll: true });
  }
  function openQuiz(so) {
    Q = { step: 0, who: mode, bud: 0, when: 'eve', where: 'any', near: null, busy: false, loc: 0 };
    openSheet(`<div class="qz" id="qz">${quizHtml()}</div>`, Object.assign({ kind: 'quiz', label: 'Подобрать за 10 секунд', url: sheetUrl('quiz=1') }, so));
    return true;
  }
  function quizAnswer(k, v) {
    if (!Q || $('#sheet').dataset.kind !== 'quiz') return;
    Q.loc++; Q.busy = false;   // ответили, пока искали геолокацию, — её ответ больше не нужен
    if (k === 'back') { if (Q.step > 0) { Q.step--; quizStep(); } return; }
    if (k !== QZ[Q.step].k) return;
    if (k === 'who' && ORDER.includes(v)) Q.who = v;
    else if (k === 'bud') Q.bud = [1, 2].includes(+v) ? +v : 0;
    else if (k === 'when' && WHEN_SUM[v]) Q.when = v;
    else if (k === 'where') {
      if (v === 'near') { quizNear(); return; }
      Q.where = OKR_NAME[v] && v !== 'all' ? v : 'any';
      Q.near = null;
    } else return;
    if (k === 'where') { quizFinish(); return; }
    Q.step++;
    quizStep();
  }
  /* «Рядом со мной»: точка уже выбрана в каталоге — сразу; иначе спрашиваем браузер, а пока можно выбрать округ */
  function quizNear() {
    if (near) { Q.where = 'near'; Q.near = near; quizFinish(); return; }
    if (!G || typeof G.locate !== 'function') { quizStep('Не получилось узнать, где ты. Выбери округ или «Неважно».'); return; }
    const run = ++Q.loc;
    Q.busy = true;
    quizStep('Определяем, где ты… Можно не ждать — выбери округ или «Неважно».');
    G.locate().then(p => {
      if (!Q || Q.loc !== run || !SH.isOpen() || $('#sheet').dataset.kind !== 'quiz') return;
      Q.where = 'near'; Q.near = p;
      quizFinish();
    }).catch(err => {
      if (!Q || Q.loc !== run || !SH.isOpen() || $('#sheet').dataset.kind !== 'quiz') return;
      Q.busy = false;
      // подсказки geo.js зовут выбрать метро или точку на карте — в квизе их нет, тут свои
      quizStep((QZ_GEO[err && err.code] || QZ_GEO.unavailable) + ' Выбери округ или «Неважно».');
    });
  }
  const QZ_GEO = {
    denied: 'Доступ к геопозиции запрещён для этого сайта.',
    unavailable: 'Браузер не смог определить, где ты.',
    timeout: 'Браузер слишком долго определял место.',
    unsupported: 'Этот браузер не умеет определять место.',
    far: 'Похоже, ты не в Москве (или включён VPN).',
  };
  /* Лучшие планы: время дня, бюджет, где, сезон, погода, оценки гостей и «Для тебя»; три разных — без общих мест */
  function quizPick(q) {
    const all = modePlans(q.who);
    const bad = q.when === 'day' ? weekendDays().some(d => wxWetDay(WX && WX.day === todayYmd && WX.days[d])) : !!wxHint(WX);
    const timeFn = (FILTERS.find(f => f[0] === (q.when === 'day' ? 'day' : 'eve')) || FILTERS[0])[2];
    const score = p => {
      const st = K.planStops(p), price = planPrice(p);
      let s = (WHEN_W[q.when][p.when] || 0) + planQuality(p, bad);
      if (q.when === 'late') { if (hasTag(p, 'late')) s += 2.5; if (st.some(x => K.placeHints(x).includes('night'))) s += 1; }
      if (q.bud && price > q.bud) s -= 4 * (price - q.bud);
      if (q.where === 'near' && q.near && st[0]) s += 2.5 - K.distM(q.near, st[0]) / 1500;
      else if (q.where !== 'any' && q.where !== 'near') s += st[0] && st[0].okr === q.where ? 3 : st.some(x => x.okr === q.where) ? 2 : -2;
      return s;
    };
    const ranked = all.map((p, i) => [p, score(p), i]).sort((a, b) => (b[1] - a[1]) || a[2] - b[2]).map(x => x[0]);
    const plans = [], used = new Set();
    ranked.forEach(p => { if (plans.length < 3 && !p.stops.some(id => used.has(id))) { plans.push(p); p.stops.forEach(id => used.add(id)); } });
    ranked.forEach(p => { if (plans.length < 3 && !plans.includes(p)) plans.push(p); });
    const total = all.filter(p => timeFn(p) && budOk(planPrice(p), q.bud)).length;
    return { q, plans, events: quizEvents(q), total };
  }
  /* Два события под ответы: в нужное время (вечер — 17:00–21:30, поздно — с 21:00 или вечеринка, днём — до 18:00),
     в бюджете (если цена известна) и ближе к человеку */
  function quizEvents(q) {
    if (!A || typeof A.upcoming !== 'function') return [];
    let list = safe(() => A.upcoming({ mode: q.who, when: q.when === 'day' ? 'weekend' : 'today' }), []);
    if (list.length < 2 && q.when !== 'day') list = list.concat(safe(() => A.upcoming({ mode: q.who, when: 'week' }), []).filter(e => !list.some(x => x.id === e.id)));
    const maxRub = q.bud === 1 ? 1500 : q.bud === 2 ? 3000 : Infinity;
    const fit = e => { const t = e.time || '';
      if (q.when === 'day') return e.long || !t || t < '18:00';
      if (q.when === 'late') return t >= '21:00' || e.cat === 'party';
      return !t || (t >= '17:00' && t <= '21:30'); };
    const sc = e => {
      let s = e.next === todayYmd && q.when !== 'day' ? 1 : 0;
      if (e.long) s -= q.when === 'day' ? 0 : 1;
      if (e.price && e.price[0] > maxRub) s -= 3;
      if (q.near && e.lat != null) s += 1.5 - K.distM(q.near, e) / 3000;
      return s;
    };
    return list.filter(fit).map((e, i) => [e, sc(e), i]).sort((a, b) => (b[1] - a[1]) || a[2] - b[2]).slice(0, 2).map(x => x[0]);
  }
  function quizFinish() {
    const q = Object.assign({}, Q);
    Q.loc++; Q.busy = false;
    const res = quizPick(q);
    T.ev('quiz_done', { mode: q.who, v: [q.bud || 'any', q.when, q.where].join('|') });
    // результат — на странице, над готовыми планами: карточки открываются и закрываются, а подборка остаётся
    closeSheet(() => {
      if (q.who !== mode) setMode(q.who);
      quizRes = res;
      renderQuizRes();
      const box = $('#quizRes'), h = $('#qrTitle');
      if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (h) h.focus({ preventScroll: true });
    });
  }
  const qrPlan = p => { const { st, price } = planMeta(p), ph = K.planPhoto(p);
    return `<button type="button" class="qr-it" data-plan="${esc(p.id)}">
      ${ph ? `<span class="qr-ph"><img src="${esc(ph.t)}" alt="" loading="lazy" decoding="async"></span>` : `<span class="qr-ph cover ${cvOf(st[0])}"><span class="cv-e" aria-hidden="true">${esc(p.emoji || (st[0] && st[0].emoji) || '📍')}</span></span>`}
      <span class="qr-main"><b>${esc(p.title)}</b><small>${esc(st.map(x => x.name).join(' → '))}</small>
        <span class="qr-meta">${esc(p.when)} · <span title="${esc(K.priceHint(price))}">${K.priceText(price)}</span>${RV ? ` <span data-rate-plan="${esc(p.id)}">${safe(() => RV.planBadge(p), '')}</span>` : ''}</span></span>
    </button>`; };
  const qrEvent = e => `<button type="button" class="qr-it" data-open-event="${esc(e.id)}">
      <span class="qr-ph afc-${esc(e.cat || 'other')}" aria-hidden="true">${esc(e.emoji || '📅')}</span>
      <span class="qr-main"><b>${esc(e.title)}</b><small>${esc(evWhen(e, true))}${e.venue ? ' · ' + esc(e.venue) : ''}</small></span>
    </button>`;
  function renderQuizRes() {
    const box = $('#quizRes');
    if (!box) return;
    box.classList.toggle('hidden', !quizRes);
    if (!quizRes) { box.innerHTML = ''; return; }
    const { q, plans, events, total } = quizRes;
    const sum = [K.MODES[q.who].label, q.bud ? BUDGETS.find(b => b[0] === q.bud)[1] + ' на человека' : 'любой бюджет', WHEN_SUM[q.when],
      q.where === 'near' ? 'рядом с тобой' : OKR_NAME[q.where] || ''].filter(Boolean).join(' · ');
    const evHead = q.when === 'day' ? 'В афише на выходных' : !events.every(e => e.next === todayYmd) ? 'Ближайшие события'
      : events.some(e => e.long) ? 'Сегодня в афише' : q.when === 'late' ? 'В афише сегодня ночью' : 'В афише сегодня вечером';
    box.innerHTML = `
      <div class="qr-head"><h3 id="qrTitle" tabindex="-1">${I('bolt')}Подобрали для тебя</h3>
        <button type="button" class="qr-x" data-q-close aria-label="Скрыть подборку">${I('x')}</button></div>
      <p class="qr-sum">${esc(sum)}</p>
      ${plans.length ? `<div class="qr-list">${plans.map(qrPlan).join('')}</div>` : '<p class="pl-empty">Под такие ответы планов не нашлось — попробуй другой бюджет или время.</p>'}
      ${events.length ? `<p class="qr-k">${evHead}</p><div class="qr-list">${events.map(qrEvent).join('')}</div>` : ''}
      <div class="qr-foot">${total > plans.length ? `<button type="button" class="btn ghost" data-q-all>Все подходящие · ${total}</button>` : ''}<button type="button" class="btn ghost" data-q-again>${I('redo')}Заново</button></div>`;
  }
  /* «Все подходящие планы»: бюджет и время дня из ответов — в фильтры каталога */
  function quizApply() {
    const q = quizRes && quizRes.q;
    if (!q) return;
    bud = q.bud; flt = q.when === 'day' ? 'day' : 'eve'; climit = CSTEP; plimit = PSTEP;
    renderCards();
    renderPlaces();
    syncUrl();
    $('#filters').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const qrBox = $('#quizRes');
  if (qrBox) qrBox.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('[data-q-close]')) { quizRes = null; renderQuizRes(); const b = $('#quiz'); if (b) b.focus({ preventScroll: true }); return; }
    if (t.closest('[data-q-again]')) { openQuiz(); return; }
    if (t.closest('[data-q-all]')) { quizApply(); return; }
    const ev = t.closest('[data-open-event]');
    if (ev) { openEvent(ev.dataset.openEvent); return; }
    const p = t.closest('[data-plan]');
    if (p) openPlan(p.dataset.plan);
  });
  const qzBtn = $('#quiz');
  if (qzBtn) qzBtn.onclick = () => openQuiz();

  /* ---------- промокоды: раздел — когда партнёров PROMO_MIN и больше ---------- */
  function renderPromo() {
    const on = PROMOS.length >= PROMO_MIN;
    $('#promoBlock').classList.toggle('hidden', !on);
    $('#tabPromo').classList.toggle('hidden', !on);
    if (!on) return;
    const sup = CFG.support || {};
    const contact = sup.email ? `mailto:${sup.email}?subject=${encodeURIComponent('Промокод для гостей')}` : 'partners.html';
    $('#promoCount').textContent = `${PROMOS.length} ${plural(PROMOS.length, 'место', 'места', 'мест')}`;
    $('#promoList').innerHTML = `<div class="plist">${PROMOS.map(x => { const p = K.placeById(x.place);
      return `<button type="button" class="pl-item has-promo" data-pid="${esc(x.place)}">${emoTile(p)}
        <span class="pl-main"><span class="pl-name"><span class="nm">${esc(p.name)}</span></span><span class="pl-sub">🎁 ${esc(x.title)}${x.until ? ' · до ' + esc(untilText(x.until)) : ''}</span>${adLine(x)}</span>
        ${priceTag(p.price)}</button>`; }).join('')}</div>
      <p class="promo-biz">Вы заведение? <a href="${esc(contact)}">Разместить промокод</a></p>`;
  }
  $('#promoList').addEventListener('click', e => { const b = e.target.closest('.pl-item[data-pid]'); if (b) openPlace(b.dataset.pid); });

  /* ---------- вкладки-якоря: подсвечиваем раздел, который сейчас на экране ---------- */
  let curSec = '';
  function syncTabs() {
    const tab = curSec === 'placesBlock' ? (pview === 'map' ? 'map' : 'places') : { plansBlock: 'plans', eventsBlock: 'events', promoBlock: 'promo' }[curSec] || '';
    $$('#tabs a[data-tab]').forEach(a => {
      const on = a.dataset.tab === tab;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
  }
  /* land — открыли по ссылке (?tab=…): прокручиваем сразу и держим раздел на месте, пока страница догружается */
  function goTab(tab, land) {
    if (!/^[a-z]+$/.test(String(tab || ''))) return false;
    if (tab === 'events') renderAfTab();   // вкладка «Афиша» прячется, пока не посчитаны события, — считаем сейчас
    const a = $(`#tabs a[data-tab="${tab}"]`);
    if (!a || a.classList.contains('hidden')) return false;
    if (tab === 'events') bootAfisha();   // афиша ещё не нарисована — рисуем сразу, иначе прокрутим к пустому месту
    const want = tab === 'map' ? 'map' : tab === 'places' ? 'list' : null;
    if (want && pview !== want) setView(want);
    const sec = $(a.getAttribute('href'));
    if (!sec || sec.classList.contains('hidden')) return false;
    if (land) pinTo(() => sec);
    else {
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // как у обычного якоря: фокус — в раздел (на заголовок), чтобы следующий Tab шёл по разделу, а не по вкладкам
      const h = $('h2', sec);
      if (h) { if (!h.hasAttribute('tabindex')) h.tabIndex = -1; h.focus({ preventScroll: true }); }
    }
    return true;
  }
  /* Прокрутка при открытии по ссылке. Выше цели ещё догружаются шрифты, фото, лента событий, погода, галерея —
     раздел уезжает вниз, а плавная прокрутка обрывается. Поэтому прокручиваем сразу и ещё несколько секунд
     возвращаем цель на место, пока человек сам не тронул страницу. find() → элемент; alive() — цель ещё нужна */
  function pinTo(find, alive) {
    const USER_EV = ['wheel', 'touchstart', 'pointerdown', 'keydown'];   // человек сам листает или нажимает — не мешаем
    let off = false, ro = null;
    const timers = [];
    const stop = () => {
      if (off) return;
      off = true;
      timers.forEach(clearTimeout);
      if (ro) ro.disconnect();
      USER_EV.forEach(t => removeEventListener(t, stop, true));
    };
    const go = () => {
      if (off) return;
      const el = find();
      if (!el || !el.isConnected || (alive && !alive())) { stop(); return; }
      el.scrollIntoView({ block: 'start' });
    };
    USER_EV.forEach(t => addEventListener(t, stop, { capture: true, passive: true }));
    go();
    [120, 350, 700, 1200, 2000, 3000, 4500].forEach(ms => timers.push(setTimeout(go, ms)));
    timers.push(setTimeout(stop, 5000));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(go, () => { /* ок */ });
    if (document.readyState !== 'complete') addEventListener('load', go, { once: true });
    // что-то выше цели поменяло высоту (фото, галерея, погода) — тут же возвращаем цель на место
    if (typeof ResizeObserver === 'function') {
      const el = find(), box = el && el.closest('.psheet');
      ro = new ResizeObserver(() => go());
      if (box) Array.from(box.children).forEach(c => ro.observe(c));
      else ro.observe(document.body);
    }
    return stop;
  }
  $('#tabs').addEventListener('click', e => {
    const a = e.target.closest('a[data-tab]');
    if (!a) return;
    e.preventDefault();
    goTab(a.dataset.tab);
    T.ev('tab', { v: a.dataset.tab });
  });
  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver(es => {
      es.forEach(e => { if (e.isIntersecting) curSec = e.target.id; else if (curSec === e.target.id) curSec = ''; });
      syncTabs();
    }, { rootMargin: '-35% 0px -60% 0px' });
    ['plansBlock', 'eventsBlock', 'placesBlock', 'promoBlock'].forEach(id => { const s = $('#' + id); if (s) spy.observe(s); });
  }

  /* ---------- вход через Яндекс: кнопка — только когда вход настроен (config.js → auth.yandexClientId) ---------- */
  function renderLogin() {
    const u = AU.user(), b = $('#login');
    b.classList.toggle('hidden', !AU.enabled() && !u);
    b.innerHTML = u ? (u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : I('user')) + `<span>${esc(u.name)}</span>` : `${I('user')}<span>Войти</span>`;
    b.title = u ? 'Выйти из аккаунта' : 'Войти через Яндекс';
  }
  $('#login').onclick = () => {
    if (AU.user()) {
      if (confirm('Выйти из аккаунта Яндекса на этом устройстве?')) { AU.logout(); renderLogin(); }
      return;
    }
    AU.login();
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
  /* Счётчик Метрики не задан (config.js → analytics.metrikaId) — спрашивать не о чем: ни плашки, ни «Настроек аналитики» в подвале
     (privacy.html в этом случае пишет «Сейчас счётчик не подключён»). Появится номер — плашка покажется всем, кто ещё не отвечал */
  if (String((CFG.analytics || {}).metrikaId || '').trim()) {
    $('#consentOpen').onclick = () => showConsent(true);
    if (!T.consent()) setTimeout(() => showConsent(), 1200);
  } else $('#consentOpen').remove();
  (() => {
    const sup = CFG.support || {}, fb = $('#feedback');
    if (!fb) return;
    if (sup.email) fb.href = 'mailto:' + sup.email;
    else if (sup.telegram) { fb.href = 'https://t.me/' + encodeURIComponent(sup.telegram); fb.target = '_blank'; fb.rel = 'noopener'; }
    else fb.remove();
  })();

  /* ---------- карточка из адреса: ?plan=…, ?place=… (модули добавляют свои параметры через KudaHub.addOpener) ---------- */
  /* start.html?place=<id>#reviews («Оцени место» из игры) — карточка места сразу на «Отзывах гостей» */
  const OPENERS = [['plan', openPlan], ['place', (v, so) => openPlace(v, so && so.rv ? Object.assign({ reviews: 'land' }, so) : so)], ['quiz', (v, so) => openQuiz(so)]];
  if (A) OPENERS.push(['event', (v, so) => openEvent(v, Object.assign({ deep: true }, so))]);
  const addOpener = (param, fn) => { if (typeof fn === 'function' && !OPENERS.some(o => o[0] === param)) { OPENERS.push([param, fn]); OWN_PARAMS.push(param); } };
  function openFromQuery(q, so) {
    for (const [param, fn] of OPENERS) {
      const v = q.get(param);
      if (v) return !!fn(v, so);
    }
    return false;
  }

  /* «Установить приложение» (assets/pwa.js подключается после этого файла): кнопка в подвале видна, только когда установка возможна */
  function mountPwa() {
    const P = window.KudaPWA;
    const slot = $('#pwaSlot');
    if (!P || typeof P.installButton !== 'function' || !slot || slot.firstChild) return;
    const name = (CFG.site && CFG.site.name) || 'Куда идём?';
    P.installButton('#pwaSlot', { label: 'Установить приложение', className: 'mini',
      onResult: r => { if (r === 'accepted') toast(`Готово — «${name}» теперь среди приложений`); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountPwa); else setTimeout(mountPwa, 0);

  /* Для модулей страницы и проверок: та же шторка, режим, уведомление */
  window.KudaHub = { openSheet, closeSheet, mode: () => mode, toast, openPlace, openPlan, openEvent, openQuiz, addOpener };

  /* Параметры ссылки: m — режим, f — фильтр планов (f=cheap из старых ссылок — то же, что b=1), b — бюджет на человека (1 | 2),
     cat/okr — раздел каталога, tab — вкладка (plans | events | places | map | promo), plan/place/event — сразу открыть карточку
     (place=…#reviews — сразу на отзывах), quiz=1 — «Подобрать за 10 секунд» */
  const QS = new URLSearchParams(location.search);
  if (FILTERS.some(f => f[0] === QS.get('f'))) flt = QS.get('f');
  if (['1', '2'].includes(QS.get('b'))) bud = +QS.get('b');
  else if (QS.get('f') === 'cheap') bud = 1;   // старый фильтр «Недорого»
  WX = wxCached();                             // погода из кэша — сразу, без сдвига страницы
  // лента событий появится после первой отрисовки — держим под неё место, чтобы планы не прыгали
  if (A && $('#shelf') && afCount(mode) > 0) { $('#shelf').classList.remove('hidden'); $('#shelf').classList.add('wait'); }
  if (PCATS.some(c => c[0] === QS.get('cat'))) pcat = QS.get('cat');
  if (OKRS.some(o => o[0] === QS.get('okr'))) pokr = QS.get('okr');
  $('#heroCat').innerHTML = K.catSVG('normal');
  renderCounts();
  applyLiveCopy();
  apply();
  renderPlaces();
  renderPromo();
  renderLogin();
  ORDER.forEach(m => { demoUrl(m); });   // ссылки «Посмотреть пример» готовим заранее
  // перезагрузка с открытой карточкой: эта запись истории — уже её, новую не добавляем (иначе «Назад» придётся жать дважды)
  const restoring = !!(history.state && history.state.kudaSheet);
  const toRv = location.hash === '#reviews';   // читаем до syncUrl: он уберёт якорь из адреса
  // раздел по ссылке: ?tab=events|map|places|plans|promo или якорь раздела (#placesBlock — из подборок moskva/)
  const SEC_TAB = { plansBlock: 'plans', eventsBlock: 'events', placesBlock: 'places', promoBlock: 'promo' };
  const hashSec = location.hash.slice(1);
  const landTab = QS.get('tab') || (Object.prototype.hasOwnProperty.call(SEC_TAB, hashSec) ? SEC_TAB[hashSec] : '');
  if (!restoring) syncUrl();             // в адресе остаются режим и фильтры, без plan/place/tab
  if (landTab) goTab(landTab, true);
  if (!openFromQuery(QS, { adopt: restoring, rv: toRv }) && restoring) syncUrl(true);
  afterPaint(() => {
    bootAfisha();
    if (!WX) wxLoad().then(d => { if (d) { WX = d; renderWx(); } });
  });
})();

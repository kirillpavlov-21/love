/* «Куда пойдём?» — подбор карточками (start.html, #deck).
   На главной — панель: с кем (Вдвоём / Друзья / Подруги / Один), когда (Сейчас / Вечером / На выходных),
   веер из трёх фото и «Листать 10 карточек». По кнопке — игра на весь экран: одна карточка за раз
   (место, готовый маршрут или событие под выбранные «с кем» и «когда»), прогресс 1/10, в конце — «Сегодня — сюда».
   ─ Вправо (♥) — «Хочу»: в «Сохранённые» (KudaTrack.toggleFav), модель вкуса учится как на сохранении.
     Влево (✕) — «Не то»: 30 дней не показываем (KudaTrack.notThis), модель учится как на отказе. Нажатие — карточка целиком.
   ─ Следующую карточку выбираем после каждого свайпа: оценка подбора (KudaPick: момент, сезон, погода, бюджет, вкус)
     + сдвиг модели с начала колоды + разнообразие (два отказа из трёх по одному типу — тип откладываем и пробуем другое;
     ещё три отказа подряд по другим типам — отложенное возвращаем; лайк снимает отложенность)
     + не больше двух карточек одного типа и вида подряд + шум от личного зерна (kuda-deck-seed) — колоды у людей разные.
   ─ В холодные месяцы места «прийти и посидеть» чуть выше прогулок; закрытые в выбранное время места не показываем.
   ─ «Хочу сходить · N» — шторка с сохранённым и «Сегодня — сюда» (часы работы, бюджет, расстояние).
   «С кем» синхронно с режимами главной (Свидание / Друзья / Подружки); «Один» — места и события без маршрутов на двоих.
   Всё — только в этом браузере. */
(function () {
  'use strict';

  const K = window.DateKit, T = () => window.KudaTrack, PK = () => window.KudaPick, H = () => window.KudaHub, G = () => window.KudaGeo, IN = () => window.KudaIntent;
  const root = document.getElementById('deck');
  if (!K || !root) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const safe = (fn, d) => { try { return fn(); } catch (e) { return d; } };
  const SS = {
    get(k, d) { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } },
  };
  const SVG = { x: '<path d="M6 6l12 12M18 6L6 18"/>', heart: '<path d="M12 20s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 10c0 5.65-7 10-7 10z"/>', arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>' };
  const ic = n => `<svg viewBox="0 0 24 24" aria-hidden="true">${SVG[n]}</svg>`;

  /* личное зерно: у каждого браузера свой порядок равных по оценке карточек */
  const SEED = (() => {
    try { let s = localStorage.getItem('kuda-deck-seed'); if (!s) { s = Math.random().toString(36).slice(2, 10); localStorage.setItem('kuda-deck-seed', s); } return s; } catch (e) { return 'x'; }
  })();
  function noise(id) { let h = 2166136261; for (const ch of SEED + id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000 - 0.5; }

  const COLD = [11, 12, 1, 2, 3].includes(new Date(Date.now() + 3 * 3600e3).getUTCMonth() + 1);
  const KIND_LABEL = { place: 'место', plan: 'маршрут', event: 'событие' };
  const WHO = [['date', 'Вдвоём'], ['guys', 'Друзья'], ['girls', 'Подруги'], ['solo', 'Один']];
  const WHEN = [['now', 'Сейчас', 'сейчас'], ['eve', 'Вечером', 'сегодня вечером'], ['wknd', 'На выходных', 'на выходных']];
  const SESSION = 10;
  const shortDay = ymd => {
    const t = K.todayMsk ? K.todayMsk() : '';
    if (ymd === t) return 'сегодня';
    if (t && ymd === K.ymd(K.addDays(K.parseYmd(t), 1))) return 'завтра';
    const d = K.parseYmd ? K.parseYmd(ymd) : null;
    return d ? new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }).format(d).replace(/\.$/, '') : ymd;
  };
  /* ранг → 0…2: оценки мест, маршрутов и событий в разных шкалах — сравниваем места в своём списке */
  const byRank = list => list.map((x, i) => Object.assign(x, { base: 2 - 2 * i / Math.max(1, list.length) }));
  const mskHour = () => new Date(Date.now() + 3 * 3600e3).getUTCHours();

  /* ---------- намерение: с кем и когда ---------- */
  const hubMode = () => (H() ? H().mode() : 'date');
  let intent = SS.get('kuda-deck-intent', null);
  if (!intent || !WHO.some(w => w[0] === intent.who) || !WHEN.some(w => w[0] === intent.when)) intent = { who: hubMode(), when: mskHour() < 17 ? 'eve' : 'now' };
  const saveIntent = () => SS.set('kuda-deck-intent', intent);

  /* ---------- колода ---------- */
  let pool = [], cur = null, hist = SS.get('kuda-deck-hist', []), cool = new Set(SS.get('kuda-deck-cool', [])), othersNo = 0, built = '';
  const skipSet = () => new Set([...safe(() => T().favs(), []), ...['place', 'plan', 'event'].flatMap(k => safe(() => T().noList(k), []).map(id => k + ':' + id)),
    ...['place', 'plan'].flatMap(k => safe(() => T().beenList(k), []).map(id => k + ':' + id))]);
  const sig = () => [H() ? H().city() : K.city(), intent.who, intent.when].join(':');

  function build() {
    const city = H() ? H().city() : K.city(), solo = intent.who === 'solo', mode = solo ? hubMode() : intent.who;
    const skip = skipSet(), t = safe(() => T().taste(), null);
    const q = safe(() => IN().parse(WHEN.find(w => w[0] === intent.when)[2], { city }), {}) || {};
    const ts = safe(() => PK().moment(q).ts, Date.now());
    const learned = safe(() => T().ready(), false) ? (k, id) => T().score(k, id) : null;
    const plans = solo ? [] : safe(() => PK().plans(q, { city, mode, taste: t, learned, limit: 60, diverse: false, skip: new Set([...skip].filter(k => k.startsWith('plan:')).map(k => k.slice(5))) }), [])
      .filter(r => !r.closed).map(r => r.plan).filter(p => !p.single && K.planPhoto(p) && !K.planPhoto(p).b).map(p => {
        const st = K.planStops(p);
        return { k: 'plan', id: p.id, c: K.catOf(st.find(x => K.catOf(x) !== 'food') || st[0]), title: p.title, line: st.map(x => x.name).join(' → '), ph: K.planPhoto(p) };
      });
    const places = Object.entries(K.kuda().places).map(([id, raw]) => {
      // «Фото здания» (ph.b) — просто фасад, место по нему не выбрать: в игру не берём
      if (!raw || raw.closed || raw.adult || !raw.ph || raw.ph.b || skip.has('place:' + id) || !K.seasonOk(raw)) return null;
      const p = Object.assign({ id }, raw);
      if (K.cityOf(p) !== city) return null;
      const c = K.catOf(p);
      if (c === 'pc' && mode === 'date') return null;
      const o = K.openState(p, ts);
      if (o && !o.open) return null;   // закрыто в выбранное время — не предлагаем
      let s = learned ? learned('place', id) : 0;
      if (COLD) s += safe(() => PK().indoorPlace(p), false) ? 0.6 : c === 'walk' ? -0.4 : 0;
      if (t && t.bud && (p.price || 1) > t.bud) s -= 0.8 * ((p.price || 1) - t.bud);
      return { k: 'place', id, c, title: p.name, line: [p.kind, K.metroText(p.metro), K.priceText(p.price)].filter(Boolean).join(' · '), ph: p.ph, s: s + noise(id) * 1.5 };
    }).filter(Boolean).sort((a, b) => b.s - a.s).slice(0, 90);
    const events = safe(() => PK().events(q, { city, mode: solo ? null : mode, limit: 24 }), []).map(r => {
      const e = r.ev, ph = K.evPhoto(e);
      if (!ph || skip.has('event:' + e.id)) return null;
      return { k: 'event', id: e.id, c: 'ev:' + (e.cat || '-'), title: e.title, line: [shortDay(r.day) + (e.time ? ' ' + e.time : ''), e.venue].filter(Boolean).join(' · '), ph };
    }).filter(Boolean);
    pool = [...byRank(plans), ...byRank(places), ...byRank(events)];
    pool.forEach(x => { x.m0 = learned ? safe(() => T().score(x.k, x.id), 0) : 0; });
    built = sig(); cur = null;
  }
  const ensure = () => { if (built !== sig()) build(); const skip = skipSet(); pool = pool.filter(x => !skip.has(x.k + ':' + x.id)); };

  /* следующая карточка: лучшая по оценке с поправками; иногда — случайная из лучших */
  function next(except) {
    const list = except ? pool.filter(x => x !== except) : pool;
    if (!list.length) return null;
    const shown = hist.slice(-2), likedC = new Set(hist.slice(-6).filter(h => h.y).map(h => h.c));
    const ready = safe(() => T().ready(), false);
    const sc = list.map(x => {
      let s = x.base + noise(x.id) * 0.8;
      if (ready) s += 0.8 * (safe(() => T().score(x.k, x.id), 0) - x.m0);
      if (cool.has(x.c)) s -= 3;
      if (likedC.has(x.c)) s += 0.5;
      if (shown.length === 2 && shown.every(h => h.c === x.c)) s -= 1.5;
      if (shown.length === 2 && shown.every(h => h.k === x.k)) s -= 0.8;
      return [x, s];
    }).sort((a, b) => b[1] - a[1]);
    const i = !except && Math.random() < 0.2 ? Math.floor(Math.random() * Math.min(10, sc.length)) : 0;
    return sc[i][0];
  }

  function decide(like) {
    const x = cur;
    if (!x) return;
    pool = pool.filter(y => y !== x);
    hist.push({ c: x.c, k: x.k, y: like ? 1 : 0 });
    if (hist.length > 20) hist = hist.slice(-20);
    if (like) {
      if (!T().isFav(x.k + ':' + x.id)) T().toggleFav(x.k + ':' + x.id);
      cool.delete(x.c); othersNo = 0;
      game.liked.push(x.k + ':' + x.id);
    } else {
      T().notThis(x.k, x.id);
      if (cool.size && !cool.has(x.c) && ++othersNo >= 3) { cool.clear(); othersNo = 0; }   // и другое не заходит — возвращаем отложенное
      else if (hist.slice(-3).filter(h => !h.y && h.c === x.c).length >= 2) { cool.add(x.c); othersNo = 0; }
    }
    game.n++;
    SS.set('kuda-deck-hist', hist); SS.set('kuda-deck-cool', [...cool]);
    T().ev(like ? 'deck_like' : 'deck_nope', { kind: x.k, id: x.id, mode: hubMode(), v: intent.who + '|' + intent.when });
    if (navigator.vibrate && navigator.userActivation && navigator.userActivation.hasBeenActive) safe(() => navigator.vibrate(8));
  }

  /* ---------- панель на главной ---------- */
  const wantN = () => safe(() => T().favs(), []).filter(k => /^(place|plan|event):/.test(k)).length;
  const seg = (list, key, label) => `<div class="dkp-row" role="group" aria-label="${label}">${list.map(([v, t]) => `<button type="button" class="dkp-c" data-${key}="${v}" aria-pressed="${intent[key] === v}">${t}</button>`).join('')}</div>`;
  function renderPanel() {
    ensure();
    const fan = pool.slice().sort((a, b) => (b.base + noise(b.id)) - (a.base + noise(a.id))).filter(x => x.ph && x.ph.t).slice(0, 3);
    const n = wantN();
    root.innerHTML = `<div class="dkp">
      <div class="dkp-head"><h2 class="dkp-h" id="deckTitle">Куда пойдём?</h2>
        <div class="dkp-fan" aria-hidden="true">${fan.map(x => `<img src="${esc(x.ph.t)}" alt="" decoding="async">`).join('')}</div></div>
      ${seg(WHO, 'who', 'С кем')}${seg(WHEN, 'when', 'Когда')}
      <button type="button" class="btn primary wide dkp-go" data-dk="play"${pool.length ? '' : ' disabled'}>${pool.length ? 'Листать 10 карточек' : 'Под это пока пусто'}${ic('arrow')}</button>
      ${n ? `<button type="button" class="dkp-want" data-dk="want">Хочу сходить · ${n}</button>` : ''}
    </div>`;
  }

  /* ---------- игра на весь экран ---------- */
  const game = { el: null, n: 0, liked: [], done: false };
  const lock = on => document.documentElement.classList.toggle('dk-lock', on);
  const sheetOpen = () => document.documentElement.classList.contains('sheet-lock');   // шторка карточки открыта поверх игры
  const cardHtml = (x, back) => `
    <article class="dk-card${back ? ' back' : ''}" data-id="${esc(x.id)}" ${back ? 'aria-hidden="true"' : 'tabindex="0" aria-describedby="dkHint"'}>
      <img src="${esc(x.ph.s)}" alt="" draggable="false" decoding="async">
      <span class="dk-kind">${KIND_LABEL[x.k]}</span>
      <span class="dk-tag yes" aria-hidden="true">Хочу</span><span class="dk-tag no" aria-hidden="true">Не то</span>
      <div class="dk-txt"><b>${esc(x.title)}</b><span>${esc(x.line)}</span></div>
      <small class="dk-cr">© ${esc(K.cleanAuthor(x.ph.a) || x.ph.src || 'Wikimedia Commons')}</small>
    </article>`;

  function openGame() {
    ensure();
    if (!pool.length) return;
    game.n = 0; game.liked = []; game.done = false; cur = null;
    if (!game.el) {
      game.el = document.createElement('div');
      game.el.className = 'dk-game';
      game.el.setAttribute('role', 'dialog'); game.el.setAttribute('aria-modal', 'true'); game.el.setAttribute('aria-label', 'Подбор карточками');
      game.el.addEventListener('click', onGameClick);
      game.el.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheetOpen()) close(); });
      document.body.appendChild(game.el);
    }
    game.el.hidden = false; lock(true);
    try { history.pushState({ kudaDeck: 1 }, ''); } catch (e) { /* ок */ }
    T().ev('deck_play', { v: intent.who + '|' + intent.when, mode: hubMode() });
    renderGame();
  }
  const close = () => { if (history.state && history.state.kudaDeck) history.back(); else hide(); };
  function hide() {
    if (!game.el || game.el.hidden) return;
    game.el.hidden = true; lock(false); renderPanel();
    const b = root.querySelector('[data-dk="play"]'); if (b) b.focus({ preventScroll: true });
  }

  function renderGame() {
    ensure();
    if (!game.done && (game.n >= SESSION || !(pool.length))) game.done = true;
    if (game.done) { renderResult(); return; }
    if (!cur || !pool.includes(cur)) cur = next();
    const after = next(cur);
    const p = Math.min(SESSION, game.n + 1);
    game.el.innerHTML = `<div class="dkg">
      <div class="dkg-top"><button type="button" class="dkg-x" data-g="close" aria-label="Закрыть подбор">${ic('x')}</button>
        <div class="dkg-prog" aria-hidden="true"><i style="width:${(game.n / SESSION) * 100}%"></i></div>
        <span class="dkg-n">${p} из ${SESSION}</span></div>
      <div class="dk-stack">${(after ? cardHtml(after, true) : '') + cardHtml(cur)}</div>
      <p class="vh" id="dkHint">Вправо или ♥ — хочу, влево или ✕ — не то, Enter — подробнее</p>
      <div class="dk-btns">
        <button type="button" class="dk-round no" data-g="no" aria-label="Не то: ${esc(cur.title)}">${ic('x')}</button>
        <button type="button" class="dk-round yes" data-g="yes" aria-label="Хочу: ${esc(cur.title)}">${ic('heart')}</button>
      </div></div>`;
    attach();
    const c = game.el.querySelector('.dk-card:not(.back)'); if (c) c.focus({ preventScroll: true });
  }

  function renderResult() {
    const liked = wantItems(game.liked), best = todayPick(liked, intent.when === 'wknd');
    const pick = best.length ? best : liked.slice(0, 3);
    const title = pick.length ? (intent.when === 'wknd' ? 'На выходных — сюда' : 'Сегодня — сюда') : 'Ничего не зацепило';
    game.el.innerHTML = `<div class="dkg dkg-res">
      <div class="dkg-top"><button type="button" class="dkg-x" data-g="close" aria-label="Закрыть подбор">${ic('x')}</button><span class="dkg-n">${game.liked.length} из ${game.n} понравилось</span></div>
      <div class="dkg-body"><h2 class="dkg-h" tabindex="-1">${title}</h2>
        ${pick.length ? rowHtml(pick[0], true) + (pick.length > 1 ? `<p class="dkg-sub">Если не выйдет</p>${pick.slice(1).map(x => rowHtml(x)).join('')}` : '')
          : `<p class="dkg-none">Попробуем другое: поменяй «с кем» или «когда» — или полистай ещё, подбор уже учёл отказы.</p>`}
      </div>
      <div class="dkg-acts"><button type="button" class="btn primary wide" data-g="more">Ещё 10 карточек${ic('arrow')}</button>
        <button type="button" class="btn ghost wide" data-g="want">Всё сохранённое · ${wantN()}</button></div></div>`;
    const h = game.el.querySelector('.dkg-h'); if (h) h.focus({ preventScroll: true });
  }

  function fling(like) {
    const c = game.el && game.el.querySelector('.dk-card:not(.back)');
    if (!c || !cur) return;
    c.classList.add(like ? 'go-yes' : 'go-no');
    decide(like);
    setTimeout(renderGame, 220);
  }

  function attach() {
    const c = game.el.querySelector('.dk-card:not(.back)');
    if (!c) return;
    let sx = 0, sy = 0, dx = 0, drag = false, moved = false;
    c.addEventListener('pointerdown', e => { drag = true; moved = false; sx = e.clientX; sy = e.clientY; dx = 0; safe(() => c.setPointerCapture(e.pointerId)); c.classList.add('drag'); });
    c.addEventListener('pointermove', e => {
      if (!drag) return;
      dx = e.clientX - sx; const dy = e.clientY - sy;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      c.style.transform = `translate(${dx}px, ${dy * 0.25}px) rotate(${dx / 18}deg)`;
      c.style.setProperty('--yes', Math.max(0, Math.min(1, dx / 90)));
      c.style.setProperty('--no', Math.max(0, Math.min(1, -dx / 90)));
    });
    const up = () => {
      if (!drag) return;
      drag = false; c.classList.remove('drag');
      if (Math.abs(dx) > 90) { fling(dx > 0); return; }
      c.style.transform = ''; c.style.setProperty('--yes', 0); c.style.setProperty('--no', 0);
      if (!moved) open(cur);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', () => { drag = false; c.classList.remove('drag'); c.style.transform = ''; });
    c.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') { e.preventDefault(); fling(true); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); fling(false); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(cur); }
    });
  }

  const open = x => { if (!x || !H()) return; T().ev('deck_open', { kind: x.k, id: x.id }); (x.k === 'plan' ? H().openPlan : x.k === 'place' ? H().openPlace : H().openEvent)(x.id); };

  function onGameClick(e) {
    const o = e.target.closest('[data-open]');
    if (o) { const v = o.dataset.open, i = v.indexOf(':'); open({ k: v.slice(0, i), id: v.slice(i + 1) }); return; }
    const b = e.target.closest('[data-g]');
    if (!b) return;
    const a = b.dataset.g;
    if (a === 'yes' || a === 'no') fling(a === 'yes');
    else if (a === 'close') close();
    else if (a === 'more') { game.n = 0; game.liked = []; game.done = false; cur = null; renderGame(); }
    else if (a === 'want') openWant();
  }

  root.addEventListener('click', e => {
    const w = e.target.closest('[data-who]'), t = e.target.closest('[data-when]'), b = e.target.closest('[data-dk]');
    if (w) {
      intent.who = w.dataset.who; saveIntent();
      // «Вдвоём / С друзьями / С подругами» — это режимы главной: переключаем и их (ниже лента под тот же повод)
      if (intent.who !== 'solo' && intent.who !== hubMode()) { const m = document.querySelector(`#modes [data-m="${intent.who}"]`); if (m) m.click(); }
      renderPanel();
    } else if (t) { intent.when = t.dataset.when; saveIntent(); renderPanel(); }
    else if (b && b.dataset.dk === 'play') openGame();
    else if (b && b.dataset.dk === 'want') openWant();
  });

  /* ---------- «Хочу сходить» и «Сегодня — сюда» ---------- */
  let wBud = 0, wPt = null;
  function wantItems(keys) {
    const city = H() ? H().city() : K.city(), today = K.todayMsk ? K.todayMsk() : '';
    return (keys || safe(() => T().favs(), [])).map(key => {
      const i = key.indexOf(':'), k = key.slice(0, i), id = key.slice(i + 1);
      if (k === 'place') { const raw = K.placeById(id); if (!raw || raw.closed) return null; const p = Object.assign({ id }, raw); if (K.cityOf(p) !== city) return null; return { k, id, title: p.name, line: [p.kind, K.metroText(p.metro)].filter(Boolean).join(' · '), ph: K.photo(p), stops: [p], price: p.price || 1 }; }
      if (k === 'plan') { const p = K.planById(id); if (!p || K.cityOf(p) !== city) return null; const st = K.planStops(p); if (st.some(x => x.closed)) return null; return { k, id, title: p.title, line: st.map(x => x.name).join(' → '), ph: K.planPhoto(p), stops: st, price: Math.max(1, ...st.map(x => x.price || 1)) }; }
      if (k === 'event') { const e = K.eventById && K.eventById(id); const day = e && K.eventDays(e, today)[0]; if (!day) return null; const pl = e.place && K.placeById(e.place); return { k, id, title: e.title, line: [shortDay(day) + (e.time ? ' ' + e.time : ''), e.venue].filter(Boolean).join(' · '), ph: K.evPhoto(e), stops: pl ? [Object.assign({ id: e.place }, pl)] : [], price: 1, day }; }
      return null;
    }).filter(Boolean);
  }
  function todayPick(items, anyDay) {
    const mo = safe(() => PK().moment({}, Date.now()), null), ts = mo ? mo.ts : Date.now(), today = K.todayMsk ? K.todayMsk() : '';
    const t = safe(() => T().taste(), null), pt = wPt || (t && t.station) || null;
    return items.map(x => {
      if (wBud && x.price > wBud) return null;
      if (x.k === 'event' && !anyDay && x.day !== today) return null;
      let s = safe(() => T().score(x.k === 'event' ? 'plan' : x.k, x.id), 0);
      const st = anyDay ? [] : x.stops.map(p => K.openState(p, ts)).filter(Boolean);
      if (st.some(o => !o.open)) { if (st.some(o => o.dayOff)) return null; s -= 4; }
      if (x.k === 'event') s += 2;
      const p0 = x.stops.find(p => p && p.lat != null);
      if (pt && p0) s -= Math.min(6, K.distM(pt, p0) / 1500);
      return [x, s];
    }).filter(Boolean).sort((a, b) => b[1] - a[1]).slice(0, 3).map(r => r[0]);
  }
  const rowHtml = (x, big) => `<button type="button" class="dk-row${big ? ' big' : ''}" data-open="${x.k}:${esc(x.id)}">
      ${x.ph ? `<img src="${esc(big ? x.ph.s : x.ph.t)}" alt="" loading="lazy" decoding="async">` : '<span class="dk-noph" aria-hidden="true"></span>'}
      <span><b>${esc(x.title)}</b><small>${esc(x.line)}</small></span></button>`;
  function wantHtml() {
    const items = wantItems(), best = todayPick(items);
    return `<h2 class="dk-h" tabindex="-1">Хочу сходить</h2>
      <div class="dk-f" role="group" aria-label="Бюджет на человека">${[[0, 'Любой бюджет'], [1, 'до 1500 ₽'], [2, 'до 3000 ₽']].map(([v, l]) => `<button type="button" data-bud="${v}" aria-pressed="${wBud === v}">${l}</button>`).join('')}
        <button type="button" data-near aria-pressed="${!!wPt}">Рядом со мной</button></div>
      <h3 class="dk-sub">Сегодня — сюда</h3>
      ${best.length ? rowHtml(best[0], true) + (best.length > 1 ? `<p class="dk-sub2">Если не выйдет</p>${best.slice(1).map(x => rowHtml(x)).join('')}` : '')
        : `<p class="dk-none">Сегодня из сохранённого ничего не подходит — смени бюджет или полистай ещё.</p>`}
      <h3 class="dk-sub">Всё сохранённое · ${items.length}</h3>
      <div class="dk-list">${items.map(x => rowHtml(x)).join('')}</div>`;
  }
  function openWant() {
    if (!H()) return;
    const sh = H().openSheet(`<div class="dk-want-sh">${wantHtml()}</div>`, { kind: 'want', label: 'Хочу сходить' });
    const box = sh && sh.el ? sh.el.querySelector('.dk-want-sh') || sh.el : null;
    if (!box) return;
    T().ev('deck_want', { v: String(wantN()) });
    box.addEventListener('click', e => {
      const o = e.target.closest('[data-open]');
      if (o) { const v = o.dataset.open, i = v.indexOf(':'); open({ k: v.slice(0, i), id: v.slice(i + 1) }); return; }
      const b = e.target.closest('[data-bud]');
      if (b) { wBud = +b.dataset.bud; box.innerHTML = wantHtml(); return; }
      if (e.target.closest('[data-near]')) {
        if (wPt) { wPt = null; box.innerHTML = wantHtml(); return; }
        const c = H().city(), fail = () => H().toast('Не вышло понять, где ты');
        Promise.resolve(G() ? G().locate(c) : null).then(p => { if (p && p.lat != null) { wPt = p; box.innerHTML = wantHtml(); } else fail(); }, fail);
      }
    });
  }

  // смена повода сверху — «с кем» в панели тоже («Один» остаётся, пока не выбрали повод)
  document.addEventListener('kuda-mode', () => { if (intent.who !== hubMode()) { intent.who = hubMode(); saveIntent(); } renderPanel(); });
  document.addEventListener('kuda-city', () => { built = ''; renderPanel(); });
  // «Назад» в браузере закрывает игру; шторка карточки поверх игры живёт в своей записи истории
  window.addEventListener('popstate', () => {
    if (game.el && !game.el.hidden) { if (!(history.state && history.state.kudaDeck) && !sheetOpen()) hide(); else renderGameSoon(); }
    else setTimeout(renderPanel, 60);
  });
  const renderGameSoon = () => setTimeout(() => { if (game.el && !game.el.hidden) renderGame(); }, 60);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !(game.el && !game.el.hidden)) renderPanel(); });
  window.KudaDeck = { render: renderPanel, open: openGame, _debug: () => ({ pool: pool.length, cool: [...cool], hist, intent, game: { n: game.n, liked: game.liked.length } }) };
  if (H()) renderPanel(); else document.addEventListener('DOMContentLoaded', renderPanel);
})();

/* «Листай и выбирай» — колода над лентой главной (start.html, #deck).
   Одна карточка за раз: место, готовый маршрут или событие ближайшей недели — только с фото.
   ─ Вправо (♥) — «Хочу»: в «Сохранённые» (KudaTrack.toggleFav), модель вкуса учится как на сохранении.
     Влево (✕) — «Не то»: 30 дней не показываем (KudaTrack.notThis), модель учится как на отказе. Нажатие — карточка целиком.
   ─ Следующую карточку выбираем после каждого свайпа, а не заранее:
       оценка подбора (KudaPick: момент, сезон, погода, бюджет, вкус) + сдвиг модели с начала колоды (учится на лету)
       + разнообразие: два отказа из трёх по одному типу (кофейни, бары, прогулки, события…) — тип откладываем и пробуем другое;
         ещё три отказа подряд уже по другим типам — отложенное возвращаем; лайк снимает отложенность с типа
       + не больше двух карточек одного типа и одного вида (место / маршрут / событие) подряд
       + шум от личного зерна (kuda-deck-seed) и иногда случайная карточка из лучших — колоды у людей не совпадают.
   ─ В холодные месяцы места «прийти и посидеть» чуть выше прогулок.
   ─ «Хочу сходить · N» — шторка с сохранённым и ответом «Сегодня — сюда»: лучший вариант и два запасных
     с учётом часов работы, бюджета и расстояния (📍 рядом со мной или станция из знакомства).
   Всё — только в этом браузере. */
(function () {
  'use strict';

  const K = window.DateKit, T = () => window.KudaTrack, PK = () => window.KudaPick, H = () => window.KudaHub, G = () => window.KudaGeo;
  const root = document.getElementById('deck');
  if (!K || !root) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const safe = (fn, d) => { try { return fn(); } catch (e) { return d; } };
  const SS = {
    get(k, d) { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } },
  };

  /* личное зерно: у каждого браузера свой порядок равных по оценке карточек */
  const SEED = (() => {
    try { let s = localStorage.getItem('kuda-deck-seed'); if (!s) { s = Math.random().toString(36).slice(2, 10); localStorage.setItem('kuda-deck-seed', s); } return s; } catch (e) { return 'x'; }
  })();
  function noise(id) { let h = 2166136261; for (const ch of SEED + id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000 - 0.5; }

  const COLD = [11, 12, 1, 2, 3].includes(new Date(Date.now() + 3 * 3600e3).getUTCMonth() + 1);
  const KIND_LABEL = { place: 'место', plan: 'маршрут', event: 'событие' };
  const shortDay = ymd => {
    const t = K.todayMsk ? K.todayMsk() : '';
    if (ymd === t) return 'сегодня';
    if (t && ymd === K.ymd(K.addDays(K.parseYmd(t), 1))) return 'завтра';
    const d = K.parseYmd ? K.parseYmd(ymd) : null;
    return d ? new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }).format(d).replace(/\.$/, '') : ymd;
  };
  /* ранг → 0…2: оценки мест, маршрутов и событий в разных шкалах — сравниваем места в своём списке */
  const byRank = list => list.map((x, i) => Object.assign(x, { base: 2 - 2 * i / Math.max(1, list.length) }));

  /* ---------- колода ---------- */
  let pool = [], cur = null, hist = SS.get('kuda-deck-hist', []), cool = new Set(SS.get('kuda-deck-cool', [])), othersNo = 0, built = '';
  const skipSet = () => new Set([...safe(() => T().favs(), []), ...['place', 'plan', 'event'].flatMap(k => safe(() => T().noList(k), []).map(id => k + ':' + id)),
    ...['place', 'plan'].flatMap(k => safe(() => T().beenList(k), []).map(id => k + ':' + id))]);

  function build() {
    const city = H() ? H().city() : K.city(), mode = H() ? H().mode() : 'date', skip = skipSet(), t = safe(() => T().taste(), null);
    const learned = safe(() => T().ready(), false) ? (k, id) => T().score(k, id) : null;
    const plans = safe(() => PK().plans({}, { city, mode, taste: t, learned, limit: 60, diverse: false, skip: new Set([...skip].filter(k => k.startsWith('plan:')).map(k => k.slice(5))) }), [])
      .map(r => r.plan).filter(p => !p.single && K.planPhoto(p)).map(p => {
        const st = K.planStops(p);
        return { k: 'plan', id: p.id, c: K.catOf(st.find(x => K.catOf(x) !== 'food') || st[0]), title: p.title, line: st.map(x => x.name).join(' → '), ph: K.planPhoto(p) };
      });
    const places = Object.entries(K.kuda().places).map(([id, raw]) => {
      if (!raw || raw.closed || raw.adult || !raw.ph || skip.has('place:' + id) || !K.seasonOk(raw)) return null;
      const p = Object.assign({ id }, raw);
      if (K.cityOf(p) !== city) return null;
      const c = K.catOf(p);
      if (c === 'pc' && mode === 'date') return null;
      let s = learned ? learned('place', id) : 0;
      if (COLD) s += safe(() => PK().indoorPlace(p), false) ? 0.6 : c === 'walk' ? -0.4 : 0;
      if (t && t.bud && (p.price || 1) > t.bud) s -= 0.8 * ((p.price || 1) - t.bud);
      const o = K.openState(p);
      if (o && o.dayOff) s -= 1;
      return { k: 'place', id, c, title: p.name, line: [p.kind, K.metroText(p.metro), K.priceText(p.price)].filter(Boolean).join(' · '), ph: p.ph, s: s + noise(id) * 1.5 };
    }).filter(Boolean).sort((a, b) => b.s - a.s).slice(0, 90);
    const events = safe(() => PK().events({ day: 'week' }, { city, mode, limit: 24 }), []).map(r => {
      const e = r.ev, ph = K.evPhoto(e);
      if (!ph || skip.has('event:' + e.id)) return null;
      return { k: 'event', id: e.id, c: 'ev:' + (e.cat || '-'), title: e.title, line: [shortDay(r.day) + (e.time ? ' ' + e.time : ''), e.venue].filter(Boolean).join(' · '), ph };
    }).filter(Boolean);
    pool = [...byRank(plans), ...byRank(places), ...byRank(events)];
    pool.forEach(x => { x.m0 = learned ? safe(() => T().score(x.k, x.id), 0) : 0; });
    built = city + ':' + mode;
  }

  /* следующая карточка: лучшая по оценке с поправками; иногда — случайная из лучших */
  function next() {
    if (!pool.length) return null;
    const shown = hist.slice(-2), likedC = new Set(hist.slice(-6).filter(h => h.y).map(h => h.c));
    const ready = safe(() => T().ready(), false);
    const sc = pool.map(x => {
      let s = x.base + noise(x.id) * 0.8;
      if (ready) s += 0.8 * (safe(() => T().score(x.k, x.id), 0) - x.m0);
      if (cool.has(x.c)) s -= 3;
      if (likedC.has(x.c)) s += 0.5;
      if (shown.length === 2 && shown.every(h => h.c === x.c)) s -= 1.5;
      if (shown.length === 2 && shown.every(h => h.k === x.k)) s -= 0.8;
      return [x, s];
    }).sort((a, b) => b[1] - a[1]);
    const i = Math.random() < 0.2 ? Math.floor(Math.random() * Math.min(10, sc.length)) : 0;
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
    } else {
      T().notThis(x.k, x.id);
      if (cool.size && !cool.has(x.c) && ++othersNo >= 3) { cool.clear(); othersNo = 0; }   // и другое не заходит — возвращаем отложенное
      else if (hist.slice(-3).filter(h => !h.y && h.c === x.c).length >= 2) { cool.add(x.c); othersNo = 0; }
    }
    SS.set('kuda-deck-hist', hist); SS.set('kuda-deck-cool', [...cool]);
    T().ev(like ? 'deck_like' : 'deck_nope', { kind: x.k, id: x.id, mode: H() && H().mode() });
    if (navigator.vibrate) safe(() => navigator.vibrate(8));
  }

  /* ---------- отрисовка ---------- */
  const cardHtml = (x, back) => `
    <article class="dk-card${back ? ' back' : ''}" data-id="${esc(x.id)}" ${back ? 'aria-hidden="true"' : 'tabindex="0" aria-describedby="dkHint"'}>
      <img src="${esc(x.ph.s)}" alt="" draggable="false" decoding="async">
      <span class="dk-kind">${KIND_LABEL[x.k]}</span>
      <span class="dk-tag yes" aria-hidden="true">Хочу</span><span class="dk-tag no" aria-hidden="true">Не то</span>
      <div class="dk-txt"><b>${esc(x.title)}</b><span>${esc(x.line)}</span></div>
      <small class="dk-cr">© ${esc(K.cleanAuthor(x.ph.a) || x.ph.src || 'Wikimedia Commons')}</small>
    </article>`;
  const wantN = () => safe(() => T().favs(), []).filter(k => /^(place|plan|event):/.test(k)).length;

  function render() {
    if (built !== (H() ? H().city() + ':' + H().mode() : '')) { build(); cur = null; }
    // сохранили или «не то» в самой карточке — из колоды убираем; текущую карточку не меняем без свайпа
    const skip = skipSet();
    pool = pool.filter(x => !skip.has(x.k + ':' + x.id));
    if (!cur || !pool.includes(cur)) cur = next();
    const after = cur && (() => { const keep = cur; pool = pool.filter(y => y !== keep); const n = next(); pool.push(keep); return n; })();
    const n = wantN();
    root.innerHTML = `
      <div class="dk-stack">${cur ? (after ? cardHtml(after, true) : '') + cardHtml(cur) : `<div class="dk-empty"><b>Пока всё</b><span>Загляни позже — добавим новое</span><button type="button" class="btn ghost" data-dk="again">Показать отложенное</button></div>`}</div>
      <p class="vh" id="dkHint">Вправо или ♥ — хочу, влево или ✕ — не то, Enter — подробнее</p>
      <div class="dk-btns">
        <button type="button" class="dk-round no" data-dk="no" aria-label="Не то${cur ? ': ' + esc(cur.title) : ''}"${cur ? '' : ' disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        <button type="button" class="dk-want" data-dk="want"${n ? '' : ' disabled'}>Хочу сходить${n ? ' · ' + n : ''}</button>
        <button type="button" class="dk-round yes" data-dk="yes" aria-label="Хочу${cur ? ': ' + esc(cur.title) : ''}"${cur ? '' : ' disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 10c0 5.65-7 10-7 10z"/></svg></button>
      </div>`;
    attach();
  }

  function fling(like) {
    const c = root.querySelector('.dk-card:not(.back)');
    if (!c || !cur) return;
    c.classList.add(like ? 'go-yes' : 'go-no');
    decide(like);
    setTimeout(render, 220);
  }

  function attach() {
    const c = root.querySelector('.dk-card:not(.back)');
    if (!c) return;
    let sx = 0, sy = 0, dx = 0, drag = false, moved = false;
    c.addEventListener('pointerdown', e => { drag = true; moved = false; sx = e.clientX; sy = e.clientY; dx = 0; safe(() => c.setPointerCapture(e.pointerId)); c.classList.add('drag'); });
    c.addEventListener('pointermove', e => {
      if (!drag) return;
      dx = e.clientX - sx; const dy = e.clientY - sy;
      if (!moved && Math.abs(dy) > Math.abs(dx) + 6) { drag = false; c.classList.remove('drag'); c.style.transform = ''; return; }   // листают страницу
      if (Math.abs(dx) > 6) moved = true;
      c.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
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

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-dk]');
    if (!b) return;
    const a = b.dataset.dk;
    if (a === 'yes' || a === 'no') fling(a === 'yes');
    else if (a === 'want') openWant();
    else if (a === 'again') { cool.clear(); hist = []; SS.set('kuda-deck-hist', []); SS.set('kuda-deck-cool', []); built = ''; render(); }
  });

  /* ---------- «Хочу сходить» и «Сегодня — сюда» ---------- */
  let wBud = 0, wPt = null;
  function wantItems() {
    const city = H() ? H().city() : K.city(), today = K.todayMsk ? K.todayMsk() : '';
    return safe(() => T().favs(), []).map(key => {
      const i = key.indexOf(':'), k = key.slice(0, i), id = key.slice(i + 1);
      if (k === 'place') { const raw = K.placeById(id); if (!raw || raw.closed) return null; const p = Object.assign({ id }, raw); if (K.cityOf(p) !== city) return null; return { k, id, title: p.name, line: [p.kind, K.metroText(p.metro)].filter(Boolean).join(' · '), ph: K.photo(p), stops: [p], price: p.price || 1 }; }
      if (k === 'plan') { const p = K.planById(id); if (!p || K.cityOf(p) !== city) return null; const st = K.planStops(p); if (st.some(x => x.closed)) return null; return { k, id, title: p.title, line: st.map(x => x.name).join(' → '), ph: K.planPhoto(p), stops: st, price: Math.max(1, ...st.map(x => x.price || 1)) }; }
      if (k === 'event') { const e = K.eventById && K.eventById(id); const day = e && K.eventDays(e, today)[0]; if (!day) return null; const pl = e.place && K.placeById(e.place); return { k, id, title: e.title, line: [shortDay(day) + (e.time ? ' ' + e.time : ''), e.venue].filter(Boolean).join(' · '), ph: K.evPhoto(e), stops: pl ? [Object.assign({ id: e.place }, pl)] : [], price: 1, day }; }
      return null;
    }).filter(Boolean);
  }
  function todayPick(items) {
    const mo = safe(() => PK().moment({}, Date.now()), null), ts = mo ? mo.ts : Date.now(), today = K.todayMsk ? K.todayMsk() : '';
    const t = safe(() => T().taste(), null), pt = wPt || (t && t.station) || null;
    return items.map(x => {
      if (wBud && x.price > wBud) return null;
      if (x.k === 'event' && x.day !== today) return null;
      let s = safe(() => T().score(x.k === 'event' ? 'plan' : x.k, x.id), 0);
      const st = x.stops.map(p => K.openState(p, ts)).filter(Boolean);
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
        <button type="button" data-near aria-pressed="${!!wPt}">📍 Рядом</button></div>
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

  document.addEventListener('kuda-mode', () => { built = ''; render(); });
  document.addEventListener('kuda-city', () => { built = ''; render(); });
  // вернулись на вкладку — счётчик «Хочу сходить» и колода без того, что сохранили или убрали в карточке
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  window.addEventListener('popstate', () => setTimeout(render, 60));   // шторка карточки закрылась (она живёт в истории)
  window.KudaDeck = { render, _debug: () => ({ pool: pool.length, cool: [...cool], hist }) };
  if (H()) render(); else document.addEventListener('DOMContentLoaded', render);
})();

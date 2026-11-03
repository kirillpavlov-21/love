/* Подбор: одна оценка для поиска обычными словами, «Сейчас для тебя», квиза, «Удиви меня» и бота.
   KudaPick.plans(q, ctx)  → [{ plan, score, why: [{ e, t }] }] — лучшие планы под запрос q (KudaIntent.parse или {}) и момент;
   KudaPick.events(q, ctx) → [{ ev, day, score, why }];   KudaPick.places(q, ctx) → [{ place, score, why }] (только когда есть что искать);
   KudaPick.moment(q, now) → { when, ts, day, label } — на какое время подбираем, если человек не сказал: сейчас вечер — значит вечер.
   ctx: { city, mode — если в запросе нет, anyMode — планы всех режимов (свой — выше), skip — Set id, которые не показывать («Не то»),
          now, wet — непогода, point — где человек ({ lat, lon }), nearAlways — считать расстояние от point без «рядом» в запросе,
          taste — явный вкус (KudaTrack.taste),
          learned(kind, id) — поправка модели «Для тебя» (−∞…+∞), rating(id места) — оценка гостей, seen — Set id (показанное — ниже),
          limit, diverse — без общих остановок, plans — свой список планов (иначе все планы города и режима) }
   Учитываем: с кем, время дня и день, часы работы (DateKit.openState) на момент встречи, погоду, бюджет, станцию, район,
   настроение (теги и подсказки), слова запроса по названиям и типам, сезон, фото, оценки, вкус. why — причины для подписи «почему так». */
(function () {
  'use strict';

  const K = () => window.DateKit;
  const I = () => window.KudaIntent;
  const NB = ' ';
  const pad = n => String(n).padStart(2, '0');
  const sig = z => 1 / (1 + Math.exp(-z));
  const norm = t => (I() ? I().norm(t) : ' ' + String(t || '').toLowerCase().replace(/ё/g, 'е') + ' ');
  const stem = w => (I() ? I().stem(w) : w);

  /* ---------- момент: когда встречаемся ---------- */
  const MSK = 3 * 3600e3;
  const hourOf = ts => new Date(ts + MSK).getUTCHours() + new Date(ts + MSK).getUTCMinutes() / 60;
  const ymdOf = ts => { const d = new Date(ts + MSK); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
  const atMsk = (ymd, h) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d) + h * 3600e3 - MSK; };
  const wdOf = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  /* Время по умолчанию: до 16 — день, до 21:30 — вечер, позже и до 5 утра — поздно */
  const whenAt = h => (h >= 5 && h < 16 ? 'day' : h >= 16 && h < 21.5 ? 'eve' : 'late');
  /* Во сколько проверяем «открыто ли»: днём — 14:00, вечером — 19:30, поздно — 23:00; сегодня и уже позже — через полчаса */
  const AT = { day: 14, eve: 19.5, late: 23 };
  function moment(q, now) {
    q = q || {};
    now = now == null ? Date.now() : +now;
    const today = ymdOf(now);
    let day = q.day && /^\d{4}-\d{2}-\d{2}$/.test(q.day) ? q.day : today;
    if (q.day === 'weekend') {
      const wd = wdOf(today);
      day = wd === 6 || wd === 0 ? today : I() ? I().plusDays(now, (6 - wd + 7) % 7) : today;
    }
    let when = q.when === 'now' ? whenAt(hourOf(now)) : q.when || (day === today ? whenAt(hourOf(now)) : q.day === 'weekend' ? 'day' : 'eve');
    let ts = atMsk(day, AT[when]);
    if (day === today && (q.when === 'now' || ts < now + 30 * 60e3)) ts = now + 30 * 60e3;
    // глубокая ночь: «сегодня» уже наступило, а вечер прошёл — подбираем на «сейчас»
    if (day === today && hourOf(now) < 5) { when = 'late'; ts = now + 30 * 60e3; }
    return { when, ts, day, now: q.when === 'now' || (day === today && Math.abs(ts - now) <= 3600e3) };
  }

  /* ---------- «под крышей»: все остановки в помещении ---------- */
  const INDOOR_CATS = ['food', 'coffee', 'bar', 'culture', 'fun', 'spa', 'books', 'pc'];
  const OUT_KIND = /парк|сад|усадьб|набережн|бульвар|заповедник|заказник|смотров|каток|теплоход|канатн|открытым небом|монастыр|обител|некропол|стадион|квартал|автоквест|пейнтбол|конноспорт|петанк|архитектур|дизайн-завод|крыш|кораблик|катер|водн(ая|ые) прогулк|развод|форт|залив|пляж|остров|фонтан/i;
  function indoorPlace(p) {
    const c = K().catOf(p);
    if (!INDOOR_CATS.includes(c)) return false;
    if (c !== 'culture' && c !== 'fun') return true;   // ресторан «в парке» — всё равно под крышей
    const k = String(p.kind || '');
    return !OUT_KIND.test(k) || /аквапарк|крыт/i.test(k);
  }
  const INDOOR = new Map();
  const indoorPlan = plan => {
    if (!INDOOR.has(plan.id)) { const st = K().planStops(plan); INDOOR.set(plan.id, st.length > 0 && st.every(indoorPlace)); }
    return INDOOR.get(plan.id);
  };

  /* ---------- словарь тегов: что показать в «почему» ---------- */
  const TAG_WHY = {
    talk: ['💬', 'можно поговорить'], active: ['⚡', 'активно'], culture: ['🏛️', 'культура'], view: ['🏙️', 'с видом'], pc: ['🎮', 'компы'],
    banya: ['🧖', 'баня'], spa: ['🧴', 'спа'], karaoke: ['🎤', 'караоке'], quest: ['🔐', 'квест'], rink: ['⛸️', 'каток'], brunch: ['🥞', 'бранч'],
    sober: ['🚫', 'без алкоголя'], dog: ['🐕', 'можно с собакой'], late: ['🌙', 'допоздна'], anniversary: ['🎉', 'для праздника'],
    first: ['💘', 'для первого свидания'], newyear: ['🎄', 'новогоднее'], budget: ['💸', 'недорого'],
  };
  /* Вкус «это или то» в подписи: «ты любишь культуру» */
  const LIKE = { talk: 'ты любишь поговорить', active: 'ты любишь подвигаться', culture: 'ты любишь культуру', bar: 'ты любишь бары',
    walk: 'ты любишь гулять', rain: 'ты выбираешь «под крышей»', view: 'ты любишь красивые виды', food: 'ты любишь вкусно поесть',
    coffee: 'ты любишь кофейни', spa: 'ты любишь спа', banya: 'ты любишь баню', pc: 'ты любишь компы' };
  const CAT_WHY = { food: ['🍽️', 'с ужином'], coffee: ['☕', 'с кофе'], bar: ['🍷', 'с баром'], walk: ['🚶', 'с прогулкой'], books: ['📚', 'книжный'] };
  /* Жанр афиши → тип места в плане */
  const GENRE_KIND = {
    standup: [/стендап|комеди|юмор/i, '🎙️', 'стендап'], theatre: [/театр|спектакл|опер|балет/i, '🎭', 'театр'],
    concert: [/концерт|джаз|филармони|музык|клуб живой/i, '🎤', 'живая музыка'], exhibition: [/музе|галере|выстав|арт-|центр современного/i, '🖼️', 'выставка'],
    lecture: [/лекто|библиотек|просветит/i, '🧠', 'лекторий'], party: [/клуб|бар|танц/i, '🪩', 'вечеринка'], kids: [/детск|зоопарк|океанариум/i, '🧸', 'для детей'],
  };
  /* Время дня плана под «когда» — как в квизе главной */
  const WHEN_W = {
    day: { 'день': 3, 'утро': 2.5, 'закат': 1, 'вечер': -1.5, 'ночь': -3 },
    eve: { 'вечер': 3, 'закат': 3, 'ночь': 1, 'день': -1.5, 'утро': -2.5 },
    late: { 'ночь': 3, 'вечер': 0.5, 'закат': -0.5, 'день': -3, 'утро': -3 },
  };

  const hasTag = (p, t) => (p.tags || []).includes(t);
  const planPrice = st => (st.length ? Math.max(...st.map(p => p.price || 1)) : 1);
  const priceWhy = (price, mode) => {
    const n = Math.max(1, Math.min(3, price || 1));
    return mode === 'date' ? ['💸', '≈' + NB + ['', `до 3${NB}000`, `3–6${NB}тыс.`, `от 6${NB}000`][n] + NB + '₽ на двоих']
      : ['💸', '≈' + NB + ['', `до 1${NB}500`, `1${NB}500–3${NB}000`, `от 3${NB}000`][n] + NB + '₽ на человека'];
  };
  const okrName = (c, id) => { try { return (K().CITIES[c].okrs.find(o => o[0] === id) || [])[1] || ''; } catch (e) { return ''; } };
  const minWalk = m => Math.max(1, Math.round(m * 1.3 / 75));
  const distWhy = (m, from) => (m < 2600 ? `${minWalk(m)}${NB}мин пешком ${from}` : `${(m / 1000).toFixed(m < 9950 ? 1 : 0).replace('.', ',')}${NB}км ${from}`);
  /* Слово запроса в тексте: по корню («грузинскую» → «грузинск») */
  const hit = (txt, w) => txt.includes(' ' + stem(w));
  const isNew = (x, today) => { const a = x && x.added; return !!a && /^\d{4}-\d{2}-\d{2}$/.test(a) && a <= today && K().dayNum(today) - K().dayNum(a) <= 30; };
  /* Кому из остановок назначено время: «открыто до 23:00» — по самой ранней из известных */
  function openAt(st, ts) {
    let closed = null, until = '', known = 0;
    st.forEach(p => {
      const o = K().openState(p, ts);
      if (!o) return;
      known++;
      if (!o.open) { if (!closed) closed = { p, o }; return; }
      if (!o.allDay && o.until && (!until || cmpUntil(o.until, until) < 0)) until = o.until;
    });
    return { closed, until, known };
  }
  /* «01:00» позже «23:00»: время после полуночи считаем как +24 часа */
  const cmpUntil = (a, b) => { const m = t => { const [h, mm] = t.split(':').map(Number); return (h < 6 ? h + 24 : h) * 60 + mm; }; return m(a) - m(b); };

  /* ---------- планы ---------- */
  function plans(q, ctx) {
    q = q || {}; ctx = ctx || {};
    const k = K(), city = q.city || ctx.city || k.city(), mode = q.mode || ctx.mode || 'date';
    const mo = moment(q, ctx.now), today = ymdOf(ctx.now == null ? Date.now() : +ctx.now);
    const D = k.kuda();
    /* С кем — не сказали, а ctx.anyMode: смотрим планы всех режимов, свой режим чуть выше («компы» найдутся и со вкладки «Свидание») */
    const any = !q.mode && !!ctx.anyMode;
    const pool = (ctx.plans || D.scenarios.filter(s => s && (any || s.mode === mode) && Array.isArray(s.stops) && s.stops.length &&
      s.stops.every(id => k.placeById(id)) && k.seasonOk(s) && k.cityOf(s) === city)).filter(s => !(ctx.skip && ctx.skip.has(s.id)));
    const genreRx = (q.ev || []).map(g => GENRE_KIND[g]).filter(Boolean);
    const wet = !!q.indoor || (!!ctx.wet && mo.day === today);   // погода из ctx — сегодняшняя: на завтра и выходные её не переносим
    const from = q.station ? 'от м.' + NB + q.station.name : 'от тебя';
    const pt = q.station || (q.near || ctx.nearAlways ? ctx.point : null) || null;
    const taste = ctx.taste || null;
    const words = (q.words || []).map(w => w.toLowerCase());
    const scored = pool.map((p, idx) => {
      const st = k.planStops(p);
      if (!st.length) return null;
      const why = [], add = (e, t, w) => why.push({ e, t, w: w || 1 });
      let want = 0, got = 0, matched = !words.length;
      const hints = k.planHints(p), price = planPrice(st);
      let s = WHEN_W[mo.when][p.when] || 0;
      if (any && p.mode === mode) s += 2;
      // жанр афиши в запросе («стендап», «театр») — планы с таким местом
      genreRx.forEach(([r, e, t]) => { want++; if (st.some(x => r.test(x.kind || '') || r.test(x.name || ''))) { got++; s += 3; add(e, t, 3); } });
      if (mo.when === 'late' && hasTag(p, 'late')) s += 2;
      // часы работы на момент встречи
      const oa = openAt(st, mo.ts);
      if (oa.closed) s -= 7;
      else if (oa.known) { s += 0.4 * oa.known / st.length; if (mo.now && oa.until) add('🕐', 'открыто до ' + oa.until, 5); }
      // погода
      if (wet) {
        if (indoorPlan(p)) { s += q.indoor ? 3 : 1.5; add('☔', 'всё под крышей', q.indoor ? 4 : 3); } else s -= q.indoor ? 5 : 2;
      }
      if (q.outdoor && st.some(x => k.catOf(x) === 'walk')) { s += 2; }
      // бюджет
      const bud = q.bud || 0;
      if (bud && price > bud) s -= 4 * (price - bud);
      else if (bud) add(...priceWhy(price, mode), 2);
      if (q.premium) { if (price >= 3) s += 1.5; if (st.some(x => x.mich)) { s += 1.5; add('⭐', 'гид Michelin', 3); } }
      // где
      if (pt && st[0] && st[0].lat != null) {
        const d = k.distM(pt, st[0]);
        s += Math.max(-6, 5 - d / 500);
        add('📍', distWhy(d, from), 4);
      } else if (q.okr) {
        const inOkr = st[0].okr === q.okr ? 3 : st.some(x => x.okr === q.okr) ? 2 : -2.5;
        s += inOkr;
        if (inOkr > 0) add('🗺️', okrName(city, q.okr), 3);
      }
      // настроение: теги и подсказки
      (q.tags || []).forEach(t => {
        want++;
        if (hasTag(p, t) || hints.includes(t) || (t === 'late' && p.when === 'ночь')) { got++; s += 3; if (TAG_WHY[t]) add(...TAG_WHY[t], 3); }
      });
      (q.hints || []).forEach(h => { want++; if (hints.includes(h)) { got++; s += 3; if (TAG_WHY[h]) add(...TAG_WHY[h], 3); } });
      (q.cats || []).forEach(c => {
        want++;
        if (st.some(x => k.catOf(x) === c)) { got++; s += 2.5; if (CAT_WHY[c] && c !== 'walk') add(...CAT_WHY[c], 2); }
      });
      (q.kinds || []).forEach(w => { want++; if (st.some(x => norm(x.kind).includes(w))) { got++; s += 3; } });
      if (want && !got) s -= 3;
      if (q.romantic && (hasTag(p, 'view') || hints.includes('view') || hints.includes('scenic'))) { s += 1.5; add('✨', 'красиво', 2); }
      if (q.fresh) { if (st.some(x => isNew(x, today)) || isNew(p, today)) { s += 3; add('✨', 'новое', 3); } else s -= 1; }
      // слова — по названиям и типам мест
      if (words.length) {
        const name = norm(p.title + ' ' + st.map(x => x.name).join(' ')), kind = norm(st.map(x => (x.kind || '') + ' ' + (x.note || '')).join(' ') + ' ' + (p.why || ''));
        words.forEach(w => { if (hit(name, w)) { s += 4; matched = true; } else if (hit(kind, w)) { s += 2.5; matched = true; } });
        if (!matched) s -= 3;
      }
      // качество и вкус
      if (k.seasonHints && hints.some(h => k.seasonHints().includes(h))) s += 0.8;
      if (k.planPhoto(p)) s += 0.4;
      if (ctx.rating) { const r = st.map(x => +ctx.rating(x.id) || 0).filter(Boolean); if (r.length) s += 2 * (r.reduce((a, b) => a + b, 0) / r.length - 4.2); }
      if (ctx.learned) { const z = +ctx.learned('plan', p.id) || 0; s += 2 * (sig(z) - 0.5); }
      if (taste) {
        (taste.vibes || []).forEach(t => {
          if (hasTag(p, t) || hints.includes(t) || st.some(x => k.catOf(x) === t)) {
            s += 1.2;
            const w = TAG_WHY[t] || CAT_WHY[t];
            if (LIKE[t] && !(w && why.some(x => x.t === w[1]))) add('💛', LIKE[t], 1.5);
          }
        });
        if (!bud && taste.bud && price > taste.bud) s -= 1.5 * (price - taste.bud);
        if (!pt && taste.station && st[0].lat != null) {
          const d = k.distM(taste.station, st[0]);
          s += Math.max(-1.5, 1.5 - d / 4000);
          if (d < 3000) add('🏠', distWhy(d, 'от м.' + NB + taste.station.name), 2);
        }
      }
      if (ctx.seen && ctx.seen.has(p.id)) s -= 1.5;
      if (q.random) s += (Math.random() - 0.5) * 5;
      if (!why.length || (bud === 0 && why.length < 2)) add(...priceWhy(price, mode), 0.5);
      return { plan: p, score: s, why: tidy(why), closed: oa.closed ? oa.closed.p.name : '', match: matched && (!want || got > 0), i: idx };
    }).filter(Boolean).sort((a, b) => (b.score - a.score) || a.i - b.i);
    return pickTop(scored, ctx.limit || 3, ctx.diverse !== false, x => x.plan.stops);
  }
  /* Причины: важные — первыми, без повторов, не больше трёх */
  const tidy = why => why.sort((a, b) => b.w - a.w).filter((x, i, a) => a.findIndex(y => y.t === x.t) === i).slice(0, 3).map(({ e, t }) => ({ e, t }));
  /* Лучшие n без общих остановок (если хватает), иначе добираем по порядку */
  function pickTop(list, n, diverse, keys) {
    if (!diverse) return list.slice(0, n);
    const out = [], used = new Set();
    for (const x of list) { if (out.length >= n) break; const ks = keys(x) || []; if (ks.some(id => used.has(id))) continue; out.push(x); ks.forEach(id => used.add(id)); }
    for (const x of list) { if (out.length >= n) break; if (!out.includes(x)) out.push(x); }
    return out;
  }

  /* ---------- события ---------- */
  const EV_TIME = {
    day: e => e.long || !e.time || e.time < '18:00',
    eve: e => !e.time || (e.time >= '16:30' && e.time <= '21:30'),
    late: e => (e.time && e.time >= '21:00') || e.cat === 'party',
  };
  function events(q, ctx) {
    q = q || {}; ctx = ctx || {};
    const k = K(), city = q.city || ctx.city || k.city(), mode = q.mode || ctx.mode || null, now = ctx.now == null ? Date.now() : +ctx.now;
    const today = ymdOf(now), mo = moment(q, now);
    let fromD = today, toD = today;
    if (q.day === 'weekend') { fromD = mo.day; toD = wdOf(mo.day) === 6 ? I().plusDays(atMsk(mo.day, 12), 1) : mo.day; }
    else if (q.day === 'week') toD = I().plusDays(now, 6);
    else if (q.day) fromD = toD = q.day;
    else if (!q.when) toD = I().plusDays(now, 2);
    let list = (k.events({ from: fromD, to: toD, mode }) || []).filter(e => k.inCity(e, city));
    // на сегодня пусто — смотрим на три дня вперёд
    if (list.length < 2 && !q.day) list = list.concat((k.events({ from: today, to: I().plusDays(now, 3), mode }) || []).filter(e => k.inCity(e, city) && !list.includes(e)));
    const maxRub = q.free ? 0 : q.bud === 1 ? 1500 : q.bud === 2 ? 3000 : Infinity;
    const pt = q.station || (q.near ? ctx.point : null);
    const words = q.words || [];
    const scored = list.map((e, i) => {
      const day = (k.eventDays(e, fromD) || [])[0];
      if (!day) return null;
      e.long = e.long != null ? e.long : (e.end && e.end > e.start && !(Array.isArray(e.dates) && e.dates.length));
      const why = [], add = (em, t, w) => why.push({ e: em, t, w: w || 1 });
      let s = 0;
      if ((q.ev || []).length) { if (q.ev.includes(e.cat)) s += 4; else s -= 4; }
      if ((q.tags || []).includes('culture') && ['theatre', 'exhibition', 'concert', 'lecture'].includes(e.cat)) s += 1.5;
      if (q.when && q.when !== 'now' && EV_TIME[q.when] && !EV_TIME[q.when](e)) s -= 3;
      if (day === today && e.time && !e.long && atMsk(day, +e.time.slice(0, 2) + +e.time.slice(3, 5) / 60) < now + 20 * 60e3) s -= 6;   // уже началось — не успеть
      const p0 = Array.isArray(e.price) ? +e.price[0] : null;
      if (q.free) { if (p0 === 0) { s += 3; add('🆓', 'бесплатно', 4); } else s -= 4; }
      else if (p0 != null && isFinite(maxRub) && p0 > maxRub) s -= 3;
      if (p0 === 0 && !q.free) add('🆓', 'бесплатно', 2);
      else if (p0 > 0) add('🎟️', `от ${String(p0).replace(/\B(?=(\d{3})+(?!\d))/g, NB)}${NB}₽`, 1.5);
      if (pt && e.lat != null) { const d = k.distM(pt, e); s += Math.max(-2, 2 - d / 2500); add('📍', distWhy(d, q.station ? 'от м.' + NB + q.station.name : 'от тебя'), 3); }
      if (words.length) {
        const txt = norm(e.title + ' ' + (e.venue || '') + ' ' + (e.note || ''));
        const n = words.filter(w => hit(txt, w)).length;
        s += n ? 4 * n : -3;
      }
      if (e.long) s -= (q.ev || []).includes('exhibition') ? 0 : 1;
      if (day === today && !q.day) s += 0.5;
      add('📅', dayLine(day, e, today), 5);
      return { ev: e, day, score: s, why: tidy(why), i };
    }).filter(Boolean).sort((a, b) => (b.score - a.score) || a.i - b.i);
    // спросили про жанр или назвали что-то словами — только то, что подходит; иначе — без явно неподходящего
    const strict = (q.ev || []).length || words.length || q.free || (q.tags || []).length || (q.cats || []).length || (q.kinds || []).length;
    return scored.filter(x => x.score > (strict ? 0 : -2)).slice(0, ctx.limit || 2);
  }
  const dayLine = (day, e, today) => {
    const t = e.time && !e.long ? ' в ' + e.time : '';
    if (e.long && day === today) return 'идёт сейчас';
    return (I() ? I().dayText(day, atMsk(today, 12)) : day) + t;
  };

  /* ---------- места: когда в запросе есть слова, раздел или тип ---------- */
  function places(q, ctx) {
    q = q || {}; ctx = ctx || {};
    const k = K(), city = q.city || ctx.city || k.city(), words = q.words || [];
    if (!words.length && !(q.cats || []).length && !(q.kinds || []).length && !q.station) return [];
    const mo = moment(q, ctx.now), D = k.kuda();
    const pt = q.station || (q.near ? ctx.point : null);
    const out = Object.entries(D.places).map(([id, raw], i) => {
      if (!raw || raw.adult || raw.closed || !k.seasonOk(raw)) return null;
      const p = Object.assign({ id }, raw);
      if (k.cityOf(p) !== city) return null;
      let s = 0, rel = 0;
      const why = [], add = (e, t, w) => why.push({ e, t, w: w || 1 });
      if (words.length) {
        const name = norm(p.name), kind = norm(p.kind), note = norm((p.note || '') + ' ' + (p.metro || ''));
        words.forEach(w => { if (hit(name, w)) { s += 5; rel++; } else if (hit(kind, w)) { s += 3; rel++; } else if (hit(note, w)) { s += 1.5; rel++; } });
      }
      (q.cats || []).forEach(c => { if (k.catOf(p) === c) { s += 3; rel++; } });
      (q.kinds || []).forEach(w => { if (norm(p.kind).includes(w)) { s += 3; rel++; } });
      (q.tags || []).forEach(t => { if (k.placeHints(p).includes(t)) s += 1.5; });
      if (!rel && !(pt && !words.length && !(q.cats || []).length)) return null;
      if (pt && p.lat != null) { const d = k.distM(pt, p); s += Math.max(-5, 4 - d / 600); add('📍', distWhy(d, q.station ? 'от м.' + NB + q.station.name : 'от тебя'), 3); }
      const o = k.openState(p, mo.ts);
      if (o) { if (o.open) { s += 1; if (mo.now && o.until) add('🕐', 'открыто до ' + o.until, 4); } else s -= 2.5; }
      if (q.bud && (p.price || 1) > q.bud) s -= 2 * ((p.price || 1) - q.bud);
      if (q.indoor && !indoorPlace(p)) s -= 2;
      if (p.ph) s += 0.3;
      return { place: p, score: s, why: tidy(why), i };
    }).filter(Boolean).sort((a, b) => (b.score - a.score) || a.i - b.i);
    return out.slice(0, ctx.limit || 4);
  }

  window.KudaPick = { plans, events, places, moment, indoorPlace, indoorPlan, whenAt, TAG_WHY };
})();

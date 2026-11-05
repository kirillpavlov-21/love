/* Подстройка под человека: что он открывает, сохраняет и куда зовёт.
   ─ Журнал действий и модель живут только в этом браузере (localStorage), на сервер не уходят.
   ─ Модель — логистическая регрессия по признакам мест и планов (категория, подсказки, округ с городом, цена,
     время дня, теги). Учится онлайн: открыл/сохранил/позвал — положительный пример, карточку видел
     и пролистал — слабый отрицательный. По весам ранжируем блок «Для тебя».
     Сильные действия (сохранить, позвать, поделиться, маршрут) по одному месту или плану учитываются
     один раз — повторное сохранение и снятие не «накачивают» модель; открытие — раз в день.
   ─ Яндекс Метрика (если задан счётчик в config.js) подключается только после согласия на аналитику:
     туда уходят те же события без имён и текстов приглашений. Отзыв согласия выключает счётчик сразу,
     в этой же вкладке, и стирает его cookie. */
(function () {
  'use strict';

  const CFG = (window.DATE_CONFIG || {});
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ок */ } },
  };
  const K_LOG = 'kuda-events', K_MODEL = 'kuda-model', K_FAV = 'kuda-fav', K_CONSENT = 'kuda-consent', K_ONCE = 'kuda-learned';
  const MAX_LOG = 400;
  const today = () => Math.floor(Date.now() / 864e5);

  /* ---------- тест с живыми людьми: личная ссылка ?tester=<код> (бот: /start tester_<код>) ----------
     Код запоминаем в этом браузере (kuda-tester). Тестер видит плашку и сам соглашается — тогда включаем Метрику и подписываем
     визиты кодом (userParams): в отчётах видно, кто что делал, без имён и аккаунтов Telegram. Запись экрана (Вебвизор) — только
     на главной и без того, что вводят в поля; в игре-приглашении и конструкторе — только нажатия (там имена и тексты писем).
     ?tester=off — выйти из теста */
  const K_TESTER = 'kuda-tester', TESTER_RX = /^[a-z0-9_-]{2,24}$/i;
  const tester = () => { const t = LS.get(K_TESTER, null); return t && TESTER_RX.test(t.code || '') ? t : null; };
  (function readTester() {
    let v = null;
    try { v = new URLSearchParams(location.search).get('tester'); } catch (e) { return; }
    if (v === 'off') { LS.del(K_TESTER); return; }
    const t = tester();
    if (v && TESTER_RX.test(v) && (!t || t.code !== v.toLowerCase())) LS.set(K_TESTER, { code: v.toLowerCase(), at: Date.now(), ok: false });
  })();
  const onHub = () => !!document.getElementById('nowBlock');
  // поля ввода — без записи нажатий клавиш в Вебвизоре (класс Метрики ym-disable-keys), в том числе появившиеся позже
  function noKeys(root) { (root.querySelectorAll ? root.querySelectorAll('input, textarea') : []).forEach(x => x.classList.add('ym-disable-keys')); }
  function testerBanner() {
    const t = tester();
    if (!t || t.ok || document.getElementById('kudaTester') || !metrikaId()) return;
    const b = document.createElement('div');
    b.id = 'kudaTester';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', 'Тестирование сайта');
    b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:1200;max-width:460px;margin:0 auto;padding:16px;border-radius:18px;background:var(--surface,#1A1920);border:1px solid var(--line-2,rgba(244,241,234,.16));color:var(--text,#F4F1EA);font:500 14px/1.45 var(--body,system-ui,sans-serif);box-shadow:0 18px 48px rgba(0,0,0,.5)';
    b.innerHTML = '<p style="margin:0 0 12px"><b style="display:block;margin-bottom:4px;font-size:15px">Ты в тесте «Куда идём?» 🙌</b>Смотрим, как ты пользуешься сайтом: куда нажимаешь и где путаешься (Яндекс Метрика, на главной — запись экрана). То, что ты вводишь в поля, имена и тексты приглашений не записываются. Код теста: <b>' +
      t.code + '</b>.</p><div style="display:flex;gap:8px"><button type="button" data-t="ok" style="flex:1;min-height:44px;border:0;border-radius:12px;background:var(--accent,#FF6F91);color:var(--on-accent,#1C0A10);font:700 15px var(--body,system-ui,sans-serif);cursor:pointer">Согласен</button>' +
      '<button type="button" data-t="no" style="min-height:44px;padding:0 16px;border:1px solid var(--line-2,rgba(244,241,234,.16));border-radius:12px;background:transparent;color:inherit;font:600 15px var(--body,system-ui,sans-serif);cursor:pointer">Не хочу</button></div>';
    b.addEventListener('click', e => {
      const a = e.target.closest('[data-t]');
      if (!a) return;
      if (a.dataset.t === 'ok') {
        LS.set(K_TESTER, Object.assign({}, t, { ok: true }));
        setConsent('all');
        const c = document.getElementById('consent');
        if (c) c.classList.add('hidden');
      } else LS.del(K_TESTER);
      b.remove();
    });
    document.body.appendChild(b);
  }
  // после разбора всего файла: плашке нужны metrikaId и setConsent ниже
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', testerBanner); else setTimeout(testerBanner, 0);

  /* ---------- признаки ---------- */
  const K = () => window.DateKit;
  /* Категория места: по умолчанию — из shared.js (поле cat или тип места) */
  let catOf = p => K().catOf(p);
  const setCat = fn => { catOf = fn; };
  /* Округ — с городом: коды районов Петербурга (center, north, sw…) совпадают с московскими, а веса у них должны быть свои.
     Москва — без префикса ('o:center'), как раньше: модель, выученная до Петербурга, не теряется; Петербург — 'o:spb:center' */
  const okrFeat = p => { const c = cityOf(p); return 'o:' + (c && c !== 'msk' ? c + ':' : '') + (p.okr || '-'); };
  const cityOf = p => { try { return typeof K().cityOf === 'function' ? K().cityOf(p) : 'msk'; } catch (e) { return 'msk'; } };
  function placeFeats(p) {
    if (!p) return [];
    const f = ['c:' + catOf(p), okrFeat(p), 'p:' + (p.price || 1)];
    K().placeHints(p).forEach(h => f.push('h:' + h));
    return f;
  }
  function planFeats(plan) {
    if (!plan) return [];
    const st = K().planStops(plan), f = new Set(['w:' + (plan.when || '-'), 'n:' + Math.min(3, st.length)]);
    (plan.tags || []).forEach(t => f.add('t:' + t));
    st.forEach(p => placeFeats(p).forEach(x => f.add(x)));
    return Array.from(f);
  }
  const featsOf = (kind, id) => kind === 'place' ? placeFeats(K().placeById(id)) : planFeats(K().planById(id));

  /* ---------- модель ---------- */
  let M = LS.get(K_MODEL, null);
  if (!M || M.v !== 1) M = { v: 1, w: {}, b: 0, pos: 0, neg: 0 };
  const sig = z => 1 / (1 + Math.exp(-z));
  function raw(feats) { let z = M.b; feats.forEach(f => { z += (M.w[f] || 0) / Math.sqrt(feats.length || 1); }); return z; }
  function learn(feats, y, weight) {
    if (!feats.length) return;
    const lr = 0.25 * weight, n = Math.sqrt(feats.length), g = y - sig(raw(feats));
    M.b += lr * g * 0.1;
    feats.forEach(f => {
      const w = (M.w[f] || 0) * 0.995; // лёгкая L2-регуляризация
      M.w[f] = Math.max(-4, Math.min(4, w + lr * g / n));
    });
    if (y) M.pos++; else M.neg++;
    LS.set(K_MODEL, M);
  }
  const score = (kind, id) => raw(featsOf(kind, id));
  const ready = () => M.pos >= 3;

  /* Сколько «весит» действие как положительный пример */
  const POS = { open_plan: 1, open_place: 0.8, fav: 2, route: 1.5, share: 1.5, create: 2.5, invite: 3 };
  /* Учим один раз на место или план: сильные действия — навсегда, открытия — раз в день */
  const DAILY = { open_plan: 1, open_place: 1 };
  function firstTime(type, kind, id) {
    const once = LS.get(K_ONCE, {}), k = type + ':' + kind + ':' + id, d = today();
    if (once[k] != null && (!DAILY[type] || once[k] === d)) return false;
    once[k] = d;
    const keys = Object.keys(once);
    if (keys.length > 800) keys.slice(0, keys.length - 800).forEach(x => delete once[x]);
    LS.set(K_ONCE, once);
    return true;
  }

  /* ---------- аналитика ---------- */
  let ym = null;
  const metrikaId = () => String((CFG.analytics && CFG.analytics.metrikaId) || '');
  function consent() { return LS.get(K_CONSENT, null); }
  function setConsent(v) {
    const was = consent();
    LS.set(K_CONSENT, v);
    if (v === 'all') loadMetrika();
    else if (was === 'all' || ym) stopMetrika();
  }
  function loadMetrika() {
    const id = metrikaId();
    if (!id || ym || consent() !== 'all') return;
    window['disableYaCounter' + id] = false;
    /* официальный код счётчика Яндекс Метрики */
    if (!window.ym) (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
      m[i].l = 1 * new Date();
      k = e.createElement(t); a = e.getElementsByTagName(t)[0]; k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
    /* Без автоматического хита и без отслеживания ссылок: в #… приглашения зашиты имена и тексты,
       а в ссылках календаря — имена. Хит отправляем сами, адрес — без # */
    // запись экрана — только у тестера, который согласился, и только на главной (в игре и конструкторе — имена и тексты писем)
    const t = tester(), wv = !!(t && t.ok && onHub());
    if (wv) { noKeys(document); new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.nodeType === 1 && noKeys(n)))).observe(document.body, { childList: true, subtree: true }); }
    window.ym(id, 'init', { defer: true, clickmap: true, trackLinks: false, accurateTrackBounce: true, webvisor: wv });
    // и без текстов из адреса: q — запрос «Что хочется?» (ссылка из бота), t — название списка в ссылке «Позвать»
    const bare = u => { try { const x = new URL(u); ['q', 't', 'tester'].forEach(k => x.searchParams.delete(k)); x.hash = ''; return x.href; } catch (e) { return ''; } };
    // Mini App или браузер; у тестера — его код: в Метрике отчёты по каждому, без имён
    const vp = { tg: document.documentElement.classList.contains('tg') ? 1 : 0 };
    if (t && t.ok) { vp.tester = t.code; window.ym(id, 'userParams', { tester: t.code, UserID: t.code }); }
    window.ym(id, 'hit', bare(location.href), { referer: bare(document.referrer), params: vp });
    ym = (...a) => window.ym(id, ...a);
  }
  /* Согласие отозвали: больше ничего не отправляем, отключаем уже загруженный счётчик
     (официальный флаг disableYaCounter<номер>) и стираем его cookie и записи в хранилище */
  function stopMetrika() {
    ym = null;
    const id = metrikaId();
    if (id) window['disableYaCounter' + id] = true;
    try {
      document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(n => /^_ym/.test(n)).forEach(n => {
        [location.hostname, '.' + location.hostname.split('.').slice(-2).join('.'), ''].forEach(d => {
          document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : '');
        });
      });
      Object.keys(localStorage).filter(k => /^_ym/.test(k)).forEach(k => localStorage.removeItem(k));
    } catch (e) { /* ок */ }
  }

  /* ---------- интересы из афиши: «смотрел концерт Макана» → потом ненавязчиво подсказать другой его концерт ----------
     Ключ — исполнитель, спектакль или команда из названия события («Концерт. Макан» → «макан», «Динамо — ЦСКА» → «динамо»
     и «цска»). Помним при открытии, «Следить», «Поделиться» (сильнее), до 40 ключей на полгода — только в этом браузере */
  const K_INT = 'kuda-int', INT_MAX = 40, INT_DAYS = 180, INT_W = { event_open: 1, event_watch: 3, event_share: 2 };
  const keyNorm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”„()]/g, '').replace(/\s+/g, ' ').trim();
  function eventKeys(e) {
    if (!e || !e.title) return [];
    // «Концерт. Полина Гагарина. Шоу «Навсегда»» → «Полина Гагарина»; «Стендап. Ваня Усович. Сольный концерт» → «Ваня Усович»
    const t = String(e.title).replace(/^(концерт|спектакль|стендап|шоу|выставка|фестиваль|вечеринка|спорт|футбол|лекция|мюзикл|опера|балет)\.\s*/i, '');
    const head = t.split(/\.\s|\s«|:\s/)[0].trim();
    if (e.cat === 'football' || e.cat === 'sport' || / — /.test(head)) return head.split(/\s+—\s+/).map(x => x.replace(/\s*\(.*$/, '')).map(keyNorm).filter(k => k.length > 2).map(k => ({ k, label: k.replace(/^./, c => c.toUpperCase()) }));
    const k = keyNorm(head);
    return k.length > 2 && k.split(' ').length <= 6 ? [{ k, label: head }] : [];
  }
  function noteInterest(type, id) {
    const w = INT_W[type], e = w && K().eventById ? K().eventById(id) : null;
    if (!e) return;
    const m = LS.get(K_INT, {}), d = today();
    eventKeys(e).forEach(({ k, label }) => {
      const x = m[k] || { n: 0, label, cat: e.cat || '', ids: [] };
      x.n += w; x.at = d; x.label = label;
      if (!x.ids.includes(e.id)) x.ids = x.ids.concat(e.id).slice(-5);
      m[k] = x;
    });
    const keys = Object.keys(m).filter(k => d - (m[k].at || 0) <= INT_DAYS).sort((a, b) => (m[b].at - m[a].at) || (m[b].n - m[a].n)).slice(0, INT_MAX);
    LS.set(K_INT, Object.fromEntries(keys.map(k => [k, m[k]])));
  }
  /* Чем событие e близко человеку: { label, seen } — тот же исполнитель или спектакль (seen — это событие уже открывали), иначе null */
  function interestOf(e) {
    const m = LS.get(K_INT, {}), d = today();
    for (const { k } of eventKeys(e)) {
      const x = m[k];
      if (x && d - (x.at || 0) <= INT_DAYS) return { label: x.label, seen: (x.ids || []).includes(e.id), n: x.n };
    }
    return null;
  }
  const interests = () => { const m = LS.get(K_INT, {}); return Object.keys(m).sort((a, b) => m[b].n - m[a].n).map(k => ({ key: k, label: m[k].label, n: m[k].n, cat: m[k].cat })); };

  /* ---------- события ---------- */
  function ev(type, data) {
    data = data || {};
    const log = LS.get(K_LOG, []);
    log.push(Object.assign({ t: type, ts: Date.now() }, data));
    if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
    LS.set(K_LOG, log);
    if (data.kind === 'event' && data.id && INT_W[type]) noteInterest(type, data.id);
    // открытие из «Удиви меня» выбрал случай, а не человек — модель на нём не учим
    const chance = data.src === 'surprise' && DAILY[type];
    if (data.kind && data.id && POS[type] && !chance && firstTime(type, data.kind, data.id)) learn(featsOf(data.kind, data.id), 1, POS[type]);
    // город — по самой карточке (место, план, событие), без карточки — не передаём
    if (ym) ym('reachGoal', type, { kind: data.kind, id: data.id, mode: data.mode, v: data.v, city: data.id ? cityOf(String(data.id)) : undefined });
  }
  /* Приглашение из конструктора: учим модель по каждому выбранному плану или месту (p-<id места>) */
  function invited(planIds, mode) {
    const ids = (planIds || []).slice(0, 12);
    ids.forEach(pid => {
      const place = /^p-/.test(pid);
      ev('invite', { kind: place ? 'place' : 'plan', id: place ? pid.slice(2) : pid, mode });
    });
    if (!ids.length) ev('invite', { mode });
  }
  /* Карточка была на экране ≥ 1,5 с, а её не открыли — слабый отрицательный пример (не чаще раза в сутки) */
  let seenNeg = LS.get('kuda-neg', {});
  function skipped(kind, id) {
    const k = kind + ':' + id, day = today();
    if (seenNeg[k] === day) return;
    seenNeg[k] = day; LS.set('kuda-neg', seenNeg);
    learn(featsOf(kind, id), 0, 0.3);
  }

  /* ---------- избранное ---------- */
  const favs = () => LS.get(K_FAV, []);
  const isFav = key => favs().includes(key);
  function toggleFav(key) {
    const f = favs(), on = !f.includes(key);
    LS.set(K_FAV, on ? [key].concat(f).slice(0, 200) : f.filter(x => x !== key));
    if (on) { const [kind, id] = key.split(':'); ev('fav', { kind, id }); }
    return on;
  }

  /* ---------- рекомендации ---------- */
  /* Последние открытые не показываем повторно в «Для тебя» */
  function recentIds(kind, n) {
    return LS.get(K_LOG, []).filter(e => e.kind === kind && /^open_/.test(e.t)).slice(-n).map(e => e.id);
  }
  function forYou(plans, n) {
    if (!ready()) return [];
    const recent = new Set(recentIds('plan', 12));
    return plans.filter(p => !recent.has(p.id)).map(p => [p, score('plan', p.id)])
      .sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]);
  }
  /* Что модель поняла — для подписи «Подобрали, потому что ты любишь …» */
  const FEAT_NAME = { 'c:walk': 'прогулки', 'c:culture': 'культуру', 'c:food': 'рестораны', 'c:bar': 'бары', 'c:coffee': 'кофейни',
    'c:fun': 'развлечения', 'c:pc': 'компы', 'c:spa': 'бани', 'c:books': 'книжные', 'h:view': 'виды', 'h:autumn': 'осенние парки',
    'h:halloween': 'мистику', 'h:michelin': 'Michelin', 'h:budget': 'недорогие места', 'h:night': 'ночные места', 'w:вечер': 'вечера', 'w:день': 'дневные прогулки' };
  function topLikes(n) {
    return Object.entries(M.w).filter(([f, w]) => w > 0.15 && FEAT_NAME[f]).sort((a, b) => b[1] - a[1]).slice(0, n).map(([f]) => FEAT_NAME[f]);
  }
  /* ---------- знакомство: ответы на первом входе (hub.js, «Давай познакомимся») ----------
     { v: 1, who: 'date' | 'guys' | 'girls' — с кем чаще, stage: 'first' | 'new' | 'long' — первые свидания, недавно вместе, давно вместе,
       likes — что нравится (теги, разделы, жанры: culture, theatre, walk, bar…), mood — настроение (talk, party, romantic, fresh),
       avoid — чего не надо (sober, loud, outdoor, late, far), vibes — likes и mood вместе (их читает KudaPick),
       bud: 0–3 — бюджет на человека, station: { name, lat, lon } — «откуда обычно еду», me и partner — имена для приглашений, at }.
     Модель «Для тебя» учится медленно, а это работает с первого визита: KudaPick поднимает такие планы и пишет «вы любите …».
     Всё — только в этом браузере */
  const K_TASTE = 'kuda-taste', K_NO = 'kuda-no', NO_DAYS = 30;
  const SLUG = /^[a-z]{2,12}$/;
  const slugs = (a, n) => Array.from(new Set((Array.isArray(a) ? a : []).map(String))).filter(x => SLUG.test(x)).slice(0, n || 16);
  const nameOf = s => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
  function taste() {
    const t = LS.get(K_TASTE, null);
    return t && t.v === 1 && Array.isArray(t.vibes) ? t : null;
  }
  function setTaste(t) {
    if (!t) { LS.del(K_TASTE); return null; }
    const st = t.station && t.station.name && isFinite(t.station.lat) && isFinite(t.station.lon) ? { name: String(t.station.name).slice(0, 60), lat: +t.station.lat, lon: +t.station.lon } : null;
    const likes = slugs(t.likes), mood = slugs(t.mood, 8);
    const v = { v: 1, who: ['date', 'guys', 'girls'].includes(t.who) ? t.who : '', stage: ['first', 'new', 'long'].includes(t.stage) ? t.stage : '',
      likes, mood, avoid: slugs(t.avoid, 8), vibes: slugs((t.vibes || []).concat(likes, mood), 20), bud: [0, 1, 2, 3].includes(+t.bud) ? +t.bud : 0,
      station: st, me: nameOf(t.me), partner: nameOf(t.partner), at: new Date().toISOString().slice(0, 10) };
    LS.set(K_TASTE, v);
    return v;
  }
  /* Поправить знакомство одной деталью («Не то → дорого»: бюджет ниже) */
  const tweakTaste = patch => setTaste(Object.assign({ v: 1, vibes: [] }, taste() || {}, patch));

  /* ---------- «Уже были» и «Как прошло?» ----------
     kuda-been: { 'plan:<id>': день } — где уже были: полгода не предлагаем в подборке; kuda-rated: { 'plan:<id>': { r, d } } — ответ на «Как прошло?».
     Спрашиваем про последний план, куда звали, строили маршрут или звонили (журнал действий), — не раньше чем через 12 часов и не позже двух недель */
  const K_BEEN = 'kuda-been', K_RATED = 'kuda-rated', BEEN_DAYS = 180;
  function been(kind, id) {
    const b = LS.get(K_BEEN, {}), d = today();
    Object.keys(b).forEach(k => { if (d - b[k] > BEEN_DAYS) delete b[k]; });
    b[kind + ':' + id] = d;
    LS.set(K_BEEN, b);
  }
  const beenList = kind => { const b = LS.get(K_BEEN, {}), d = today(); return Object.keys(b).filter(k => k.startsWith(kind + ':') && d - b[k] <= BEEN_DAYS).map(k => k.slice(kind.length + 1)); };
  const INTENT = ['create', 'route', 'invite', 'call', 'site'];
  function pendingVisit(now) {
    now = now == null ? Date.now() : now;
    const rated = LS.get(K_RATED, {}), log = LS.get(K_LOG, []);
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (!e || e.kind !== 'plan' || !e.id || !INTENT.includes(e.t)) continue;
      const age = now - e.ts;
      if (age < 12 * 3600e3) continue;   // ещё не успели сходить
      if (age > 14 * 864e5) break;       // давно — не спрашиваем
      if (!rated['plan:' + e.id]) return { kind: 'plan', id: e.id, ts: e.ts };
    }
    return null;
  }
  /* r: 'great' — отлично (сильный плюс), 'ok' — нормально, 'bad' — не наше (минус), 'skip' — не ходили (просто не спрашиваем) */
  function rate(kind, id, r) {
    const rated = LS.get(K_RATED, {}), keys = Object.keys(rated);
    rated[kind + ':' + id] = { r, d: today() };
    if (keys.length > 300) keys.slice(0, keys.length - 300).forEach(k => delete rated[k]);
    LS.set(K_RATED, rated);
    if (r === 'skip') return;
    been(kind, id);
    if (r === 'great') learn(featsOf(kind, id), 1, 3);
    if (r === 'bad') learn(featsOf(kind, id), 0, 1.5);
    ev('rate', { kind, id, v: r });
  }
  /* «Не то»: сильный отрицательный пример и 30 дней не показываем этот план в подборке «Сейчас» */
  function notThis(kind, id) {
    const no = LS.get(K_NO, {}), d = today();
    Object.keys(no).forEach(k => { if (d - no[k] > NO_DAYS) delete no[k]; });
    no[kind + ':' + id] = d;
    LS.set(K_NO, no);
    learn(featsOf(kind, id), 0, 1.5);
  }
  const noList = kind => { const no = LS.get(K_NO, {}), d = today(); return Object.keys(no).filter(k => k.startsWith(kind + ':') && d - no[k] <= NO_DAYS).map(k => k.slice(kind.length + 1)); };

  /* «Сбросить»: стираем журнал, модель, вкус и память о пролистанных карточках — и в хранилище, и в памяти страницы */
  function reset() { [K_LOG, K_MODEL, K_ONCE, 'kuda-neg', K_TASTE, K_NO, 'kuda-taste-skip', K_BEEN, K_RATED, K_INT, 'kuda-shown'].forEach(LS.del); M = { v: 1, w: {}, b: 0, pos: 0, neg: 0 }; seenNeg = {}; }

  if (consent() === 'all') loadMetrika();
  window.KudaTrack = { setCat, ev, invited, skipped, score, ready, forYou, topLikes, favs, isFav, toggleFav, consent, setConsent, reset, featsOf,
    taste, setTaste, tweakTaste, notThis, noList, been, beenList, pendingVisit, rate, interestOf, interests, eventKeys, tester };
})();

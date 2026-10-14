/* Подстройка под человека: что он открывает, сохраняет и куда зовёт.
   ─ Журнал действий и модель живут только в этом браузере (localStorage), на сервер не уходят.
   ─ Модель — логистическая регрессия по признакам мест и планов (категория, подсказки, округ, цена,
     время дня, теги). Учится онлайн: открыл/сохранил/позвал — положительный пример, карточку видел
     и пролистал — слабый отрицательный. По весам ранжируем блок «Для тебя».
   ─ Яндекс Метрика (если задан счётчик в config.js) подключается только после согласия на аналитику:
     туда уходят те же события без имён и текстов приглашений — для обучения моделей на сервере. */
(function () {
  'use strict';

  const CFG = (window.DATE_CONFIG || {});
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ок */ } },
  };
  const K_LOG = 'kuda-events', K_MODEL = 'kuda-model', K_FAV = 'kuda-fav', K_CONSENT = 'kuda-consent';
  const MAX_LOG = 400;

  /* ---------- признаки ---------- */
  const K = () => window.DateKit;
  /* Категория места: у старых мест её нет в данных — главная передаёт свою функцию (по типу места) */
  let catOf = p => p.cat || p.c || 'food';
  const setCat = fn => { catOf = fn; };
  function placeFeats(p) {
    if (!p) return [];
    const f = ['c:' + catOf(p), 'o:' + (p.okr || '-'), 'p:' + (p.price || 1)];
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

  /* ---------- аналитика ---------- */
  let ym = null;
  function consent() { return LS.get(K_CONSENT, null); }
  function setConsent(v) { LS.set(K_CONSENT, v); if (v === 'all') loadMetrika(); }
  function loadMetrika() {
    const id = CFG.analytics && CFG.analytics.metrikaId;
    if (!id || ym || consent() !== 'all') return;
    /* официальный код счётчика Яндекс Метрики */
    (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
      m[i].l = 1 * new Date();
      k = e.createElement(t); a = e.getElementsByTagName(t)[0]; k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
    window.ym(id, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: false });
    ym = (...a) => window.ym(id, ...a);
  }

  /* ---------- события ---------- */
  function ev(type, data) {
    data = data || {};
    const log = LS.get(K_LOG, []);
    log.push(Object.assign({ t: type, ts: Date.now() }, data));
    if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
    LS.set(K_LOG, log);
    if (data.kind && data.id && POS[type]) learn(featsOf(data.kind, data.id), 1, POS[type]);
    if (ym) ym('reachGoal', type, { kind: data.kind, id: data.id, mode: data.mode, v: data.v });
  }
  /* Карточка была на экране ≥ 1,5 с, а её не открыли — слабый отрицательный пример (не чаще раза в сутки) */
  const seenNeg = LS.get('kuda-neg', {});
  function skipped(kind, id) {
    const k = kind + ':' + id, day = Math.floor(Date.now() / 864e5);
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
  function reset() { [K_LOG, K_MODEL, 'kuda-neg'].forEach(LS.del); M = { v: 1, w: {}, b: 0, pos: 0, neg: 0 }; }

  if (consent() === 'all') loadMetrika();
  window.KudaTrack = { setCat, ev, skipped, score, ready, forYou, topLikes, favs, isFav, toggleFav, consent, setConsent, reset, featsOf };
})();

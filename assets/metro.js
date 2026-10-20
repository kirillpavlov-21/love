/* «Встретимся посередине» (A11): сколько ехать от станции метро до места. window.KudaMetro.
   Петербург — граф линий по таблице станций geo.js (у каждой станции есть номер линии): станции линии выстроены цепочкой
   по координатам, перегон = км / 0,6 + 0,5 мин на остановку, пересадка между станциями разных линий ближе 400 м — 4 мин.
   Москва — у станций нет линий, поэтому оценка по прямой: 6 мин + 1,7 мин на км (с пересадками и петлями линий).
   К поездке добавляем 5 мин на вход и ожидание и путь пешком от станции места (75 м в минуту, ×1,3 на изгибы улиц). */
(function () {
  'use strict';

  const K = window.DateKit, G = window.KudaGeo;
  if (!K || !G || !G.table) return;
  const R = 6371, rad = x => x * Math.PI / 180;
  const km = (a, b) => { const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const GRAPH = {};
  /* станции на двух линиях, которые в таблице записаны один раз (с одной линией) */
  const ALSO = { spb: { 'Технологический институт': [1, 2], 'Площадь Александра Невского': [3, 4] } };

  /* граф города: { name → [[сосед, мин]] } или null (нет линий) */
  function graph(c) {
    if (c in GRAPH) return GRAPH[c];
    const T = G.table(c), names = Object.keys(T);
    if (!names.length || !names.every(n => T[n][2])) return (GRAPH[c] = null);
    const adj = {};
    const add = (a, b, w) => { (adj[a] = adj[a] || []).push([b, w]); (adj[b] = adj[b] || []).push([a, w]); };
    const lines = {};
    names.forEach(n => { new Set([T[n][2]].concat((ALSO[c] || {})[n] || [])).forEach(l => { (lines[l] = lines[l] || []).push(n); }); });
    Object.values(lines).forEach(list => {
      if (list.length < 2) return;
      // конец линии — станция, самая далёкая от первой; дальше — ближайшая непосещённая
      const far = from => list.reduce((best, n) => (km(T[from], T[n]) > km(T[from], T[best]) ? n : best), list[0]);
      let cur = far(far(list[0]));
      const left = new Set(list); left.delete(cur);
      while (left.size) {
        let nx = null;
        left.forEach(n => { if (!nx || km(T[cur], T[n]) < km(T[cur], T[nx])) nx = n; });
        add(cur, nx, km(T[cur], T[nx]) / 0.6 + 0.5);
        left.delete(nx); cur = nx;
      }
    });
    // пересадки
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const a = names[i], b = names[j];
      if (T[a][2] !== T[b][2] && km(T[a], T[b]) < 0.4) add(a, b, 4);
    }
    return (GRAPH[c] = adj);
  }
  /* кратчайшие времена от станции до всех (Дейкстра; ~70 узлов) */
  const DIST = {};
  function fromStation(c, st) {
    const key = c + '|' + st;
    if (DIST[key]) return DIST[key];
    const adj = graph(c);
    if (!adj || !adj[st]) return null;
    const d = { [st]: 0 }, done = new Set();
    for (;;) {
      let u = null;
      for (const n in d) if (!done.has(n) && (u === null || d[n] < d[u])) u = n;
      if (u === null) break;
      done.add(u);
      for (const [v, w] of adj[u] || []) if (!(v in d) || d[u] + w < d[v]) d[v] = d[u] + w;
    }
    return (DIST[key] = d);
  }
  /* минут от станции st до места p (в городе c); не знаем — null */
  function minutes(c, st, p) {
    const T = G.table(c);
    if (!p || !T[st] || !Number.isFinite(p.lat)) return null;
    const walk = from => Math.round(km(from, [p.lat, p.lon]) * 1000 * 1.3 / 75);
    const near = T[p.metro] ? p.metro : Object.keys(T).reduce((b, n) => (!b || km(T[n], [p.lat, p.lon]) < km(T[b], [p.lat, p.lon]) ? n : b), '');
    if (near === st) return walk(T[st]) + 2;
    const d = fromStation(c, st);
    const ride = d && near in d ? d[near] : 6 + km(T[st], T[near]) * 1.7;
    return Math.round(5 + ride + walk(T[near]));
  }
  /* для варианта (первая точка плана или место) и голосов со станцией: { avg, max, who, n } или null, если станций меньше двух */
  function spread(c, p, voters) {
    const rows = (voters || []).filter(v => v && v.st).map(v => ({ n: v.n, m: minutes(c, v.st, p) })).filter(x => x.m != null);
    if (rows.length < 2) return null;
    const max = rows.reduce((a, b) => (b.m > a.m ? b : a));
    return { avg: Math.round(rows.reduce((s, x) => s + x.m, 0) / rows.length), max: max.m, who: max.n, n: rows.length };
  }
  const names = c => Object.keys(G.table(c)).sort((a, b) => a.localeCompare(b, 'ru'));

  window.KudaMetro = { minutes, spread, names, graph };
})();

/* Сгенерировано pipeline/football.mjs — не править руками: файл целиком пересобирается при каждом запуске.
   Футбольные матчи Москвы и Петербурга (РПЛ, Кубок России). У каждого матча свой city ('msk' | 'spb'). */
window.KUDA_SPORT = { updated: '', events: [] };
(function (E, S) {
  const have = new Set(E.map(e => e.id));
  for (const e of S.events) if (e && e.id && !have.has(e.id)) { E.push(e); have.add(e.id); }
})(window.KUDA_EVENTS = window.KUDA_EVENTS || [], window.KUDA_SPORT);

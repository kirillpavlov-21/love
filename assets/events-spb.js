/* Афиша Петербурга: концерты, спектакли, выставки и другие события с датами. Поля — как в events.js (см. шапку там).
   id — 'ev-spb-<название латиницей>-<ггггммдд первой даты>'. Файл подключается после events.js и только добавляет события. */
(function (E, L) {
  const have = new Set(E.map(e => e.id));
  for (const e of L) if (e && e.id && !have.has(e.id)) { E.push(Object.assign(e, { city: 'spb' })); have.add(e.id); }
})(window.KUDA_EVENTS = window.KUDA_EVENTS || [], [
]);

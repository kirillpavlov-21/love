/* Подборки к праздникам и событиям — собирает scripts/occasions.mjs по календарю scripts/occasions-calendar.mjs.
   Не править руками: файл пересобирается каждый день, прошедшие поводы из него уходят. Формат — как в assets/collections.js.
   Обновлено: 2026-10-21. Подключается после collections.js: подборки редакции с тем же id главнее. */
(function (K, L) {
  if (!K) return;
  const list = K.collections = Array.isArray(K.collections) ? K.collections : [];
  const have = new Set(list.map(c => c && c.id));
  for (const c of L) if (c && c.id && !have.has(c.id)) { list.push(c); have.add(c.id); }
})(window.KUDA, [
]);

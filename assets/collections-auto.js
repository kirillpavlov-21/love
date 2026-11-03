/* Подборки к праздникам и событиям — собирает scripts/occasions.mjs по календарю scripts/occasions-calendar.mjs.
   Не править руками: файл пересобирается каждый день, прошедшие поводы из него уходят. Формат — как в assets/collections.js.
   Обновлено: 2026-11-03. Подключается после collections.js: подборки редакции с тем же id главнее. */
(function (K, L) {
  if (!K) return;
  const list = K.collections = Array.isArray(K.collections) ? K.collections : [];
  const have = new Set(list.map(c => c && c.id));
  for (const c of L) if (c && c.id && !have.has(c.id)) { list.push(c); have.add(c.id); }
})(window.KUDA, [
  {"id":"c-o-noch-iskusstv-2026","kind":"editorial","emoji":"🖼️","title":"Ночь искусств","occasion":"noch-iskusstv","from":"2026-10-28","until":"2026-11-04","lead":"Музеи, галереи и концертные залы открыты допоздна, многие — с бесплатным входом. Наметь два-три места рядом друг с другом и иди вечером.","items":["museum-moscow","mmoma","mamm","tretyakov-gallery","tsaritsyno","cosmos","obraztsov-theatre","cinema-museum","ev-vadim-fishkin-slovar-voobrazhaemykh-mest-20260915","ev-videoigry-afry-shafik-20260915","ev-viktor-borisov-musatov-garmoniya-obraza-20260709","ev-gyustav-faye-i-russkie-kollektsionery-20261009","d-ges2","d-conservatory"],"updated":"2026-11-03"},
  {"id":"spb-c-o-noch-iskusstv-2026","kind":"editorial","emoji":"🖼️","title":"Ночь искусств","occasion":"noch-iskusstv","from":"2026-10-28","until":"2026-11-04","lead":"Музеи, галереи и концертные залы открыты допоздна, многие — с бесплатным входом. Наметь два-три места рядом друг с другом и иди вечером.","items":["spb-ledokol-krasin","spb-kapella","spb-nizhniy-park","ev-spb-art-stena-supernova-20261001","ev-spb-bardo-fabiani-pamyat-o-prekrasnom-proshlom-20260925","ev-spb-imperatorskiy-kitay-dinastiya-tsin-20260624","ev-spb-linii-sveta-shveytsarskie-risunki-dlya-vitrazhey-20261028","ev-spb-rossiya-1896-20260924","spb-d-svechi","spb-d-etazhi","spb-g-flot","spb-glavnyy-shtab","spb-rosfoto","spb-tishine"],"updated":"2026-11-03"}
]);

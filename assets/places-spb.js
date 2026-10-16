/* Петербург: места и готовые планы «Куда идём?». Поля — те же, что в places.js (см. шапку там).
   id мест начинаются с 'spb-', планов — с 'spb-d-' (свидание), 'spb-g-' (с пацанами), 'spb-w-' (девичник):
   по префиксу сайт понимает город, поэтому приглашения с петербургскими местами открываются в Петербурге.
   okr — район: center, petrograd, vo, north, nw, south, sw, east, out (пригороды); metro — станция Петербургского метро.
   Файл подключается сразу после places.js и только добавляет своё: места и планы Москвы не трогает. */
(function (K, D) {
  if (!K || !K.places) return;
  for (const [id, p] of Object.entries(D.places)) if (!Object.prototype.hasOwnProperty.call(K.places, id)) K.places[id] = Object.assign(p, { city: 'spb' });
  const have = new Set(K.scenarios.map(s => s.id));
  for (const s of D.scenarios) if (!have.has(s.id)) K.scenarios.push(Object.assign(s, { city: 'spb' }));
  for (const id of D.adult) if (!K.adult.includes(id)) K.adult.push(id);
})(window.KUDA, {
  places: {},
  scenarios: [],
  adult: [],
});

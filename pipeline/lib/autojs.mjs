/* assets/auto.js: постоянный код слияния (ES5, без зависимостей) + данные аргументом.
   Код слияния здесь — единственный источник: run.mjs пишет файл только через renderAutoJs. */

export const AUTO_HEADER = '/* Сгенерировано pipeline/run.mjs — не править руками: изменения придут следующим запуском. */';

/* Код слияния. Важно: внутри не должно быть «})({» — по этой стыковке catalog.mjs находит данные.
   Города: auto.js подключается после places-spb.js, events-spb.js и sport.js. Места, планы и события Петербурга
   приходят с полем city: 'spb' и id с префиксом (spb-…, spb-d-/spb-g-/spb-w-…, ev-spb-…), московские — без поля city.
   Слиянию город не важен: id во всех городах разные, а город на сайте считает K.cityOf — поэтому код один для всех. */
export const MERGE_JS = `(function (A) {
  'use strict';
  var K = window.KUDA || (window.KUDA = {});
  if (!K.places) K.places = {};
  if (!K.scenarios) K.scenarios = [];
  if (!K.adult) K.adult = [];
  var E = window.KUDA_EVENTS || (window.KUDA_EVENTS = []);
  var own = Object.prototype.hasOwnProperty;
  var places = A.places || {}, scenarios = A.scenarios || [], events = A.events || [], closedIds = A.closed || [];
  var i, j, id, seen, stops;
  // места: id, которые уже есть в places.js, не трогаем
  for (id in places) if (own.call(places, id) && !own.call(K.places, id)) K.places[id] = places[id];
  // планы и события: только новые id
  seen = Object.create(null);
  for (i = 0; i < K.scenarios.length; i++) if (K.scenarios[i]) seen[K.scenarios[i].id] = 1;
  for (i = 0; i < scenarios.length; i++) if (scenarios[i] && !seen[scenarios[i].id]) { seen[scenarios[i].id] = 1; K.scenarios.push(scenarios[i]); }
  seen = Object.create(null);
  for (i = 0; i < E.length; i++) if (E[i]) seen[E[i].id] = 1;
  for (i = 0; i < events.length; i++) if (events[i] && !seen[events[i].id]) { seen[events[i].id] = 1; E.push(events[i]); }
  // закрытые места: пометить, убрать планы с ними и убрать из 18+
  var closed = Object.create(null);
  for (i = 0; i < closedIds.length; i++) {
    id = closedIds[i];
    closed[id] = 1;
    if (own.call(K.places, id) && K.places[id]) K.places[id].closed = true;
  }
  for (id in K.places) if (own.call(K.places, id) && K.places[id] && K.places[id].closed) closed[id] = 1;
  for (i = K.scenarios.length - 1; i >= 0; i--) {
    stops = (K.scenarios[i] && K.scenarios[i].stops) || [];
    for (j = 0; j < stops.length; j++) if (closed[stops[j]]) { K.scenarios.splice(i, 1); break; }
  }
  for (i = K.adult.length - 1; i >= 0; i--) if (closed[K.adult[i]]) K.adult.splice(i, 1);
})`;

export const emptyAutoData = () => ({ updated: '', places: {}, scenarios: [], events: [], closed: [] });

// JSON одной строкой; U+2028/2029 экранируем — старые браузеры считают их переводом строки
const LS = new RegExp('\\u2028', 'g'), PS = new RegExp('\\u2029', 'g');
const one = v => JSON.stringify(v).replace(LS, '\\u2028').replace(PS, '\\u2029');

/* Данные: по записи на строку (маленькие диффы в PR), места по id, планы и события в порядке добавления */
export function serializeAutoData(d) {
  const data = Object.assign(emptyAutoData(), d || {});
  const ids = Object.keys(data.places).sort();
  const block = (open, close, rows) => (rows.length ? `${open}\n${rows.join(',\n')}\n  ${close}` : open + close);
  return '{\n' + [
    `  "updated": ${one(data.updated || '')}`,
    `  "places": ` + block('{', '}', ids.map(id => `    ${one(id)}: ${one(data.places[id])}`)),
    `  "scenarios": ` + block('[', ']', data.scenarios.map(s => '    ' + one(s))),
    `  "events": ` + block('[', ']', data.events.map(e => '    ' + one(e))),
    `  "closed": ${one([...new Set(data.closed)].sort())}`,
  ].join(',\n') + '\n}';
}

export function renderAutoJs(data) {
  return `${AUTO_HEADER}\n${MERGE_JS}(${serializeAutoData(data)});\n`;
}

export const EVENTS_STUB = `/* Афиша «Куда идём?»: концерты, спектакли, выставки и другие события с датами.
   Прошедшие события сайт скрывает сам.
   Конвейер pipeline/run.mjs этот файл не трогает: свои события он добавляет через assets/auto.js. */
window.KUDA_EVENTS = window.KUDA_EVENTS || [];
`;

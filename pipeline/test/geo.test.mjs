import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geocode, inMoscowRegion, nearestMetro, okrOf, simplifyAddr, UA } from '../lib/geo.mjs';
import { parseStations, loadCatalog } from '../lib/catalog.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const quiet = () => {};

/* Поддельный fetch: отвечает по очереди и запоминает запросы */
function fakeFetch(...bodies) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    const b = bodies.length > 1 ? bodies.shift() : bodies[0];
    if (b instanceof Error) throw b;
    if (b && b.status) return { ok: false, status: b.status, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(b)) };
  };
  fn.calls = calls;
  return fn;
}

/* ---------- Москва, метро ---------- */

test('inMoscowRegion: рамка 55.1–56.1, 36.8–38.3', () => {
  assert.equal(inMoscowRegion(55.75, 37.62), true);
  assert.equal(inMoscowRegion(56.0, 37.2), true, 'Зеленоград');
  assert.equal(inMoscowRegion(59.93, 30.31), false, 'Петербург');
  assert.equal(inMoscowRegion(55.75, 38.5), false);
  assert.equal(inMoscowRegion(NaN, 37.6), false);
});

test('nearestMetro: по таблице FIXED из assets/geo.js', async () => {
  const stations = parseStations(await fs.readFile(path.join(REPO, 'assets/geo.js'), 'utf8'));
  assert.deepEqual(nearestMetro(55.7520, 37.6038, stations), { name: 'Арбатская', distM: 0 });
  const m = nearestMetro(55.7636, 37.5925, stations);                         // Патриаршие пруды
  assert.equal(m.name, 'Маяковская');
  assert.ok(m.distM > 500 && m.distM < 1200, String(m.distM));
  assert.equal(nearestMetro(55.75, 37.6, [{ name: 'А', lat: 55.75, lon: 37.61 }, { name: 'Б', lat: 55.7, lon: 37.6 }]).name, 'А');
  assert.equal(nearestMetro(NaN, 37.6, stations), null);
  assert.equal(nearestMetro(55.75, 37.6, {}), null);
});

/* ---------- округ ---------- */

test('okrOf: названия округов от геокодеров', () => {
  const cases = [
    ['Москва, Центральный административный округ, Тверской район', 'center'],
    ['Москва, Северный административный округ, район Левобережный', 'north'],
    ['Москва, Северо-Восточный административный округ, район Южное Медведково', 'ne'],
    ['Москва, Восточный административный округ', 'east'],
    ['Москва, Юго-Восточный административный округ', 'se'],
    ['Москва, Южный административный округ, район Чертаново Северное', 'south'],
    ['Москва, Юго-Западный административный округ', 'sw'],
    ['Москва, Западный административный округ', 'west'],
    ['Москва, Северо-Западный административный округ, район Северное Тушино', 'nw'],
    ['Москва, Зеленоградский административный округ', 'zel'],
    ['Москва, Новомосковский административный округ, поселение Сосенское', 'new'],
    ['Москва, Троицкий административный округ', 'new'],
    ['Москва, муниципальный округ Хамовники, Центральный административный округ', 'center'],
    ['ЮЗАО', 'sw'],
    ['Москва, СВАО, район Свиблово', 'ne'],
    ['Московская область, городской округ Химки, Химки', 'khimki'],
    ['Московская область, городской округ Мытищи, Мытищи', 'mo'],
    ['Московская область, Красногорск', 'mo'],
  ];
  for (const [d, want] of cases) assert.equal(okrOf(55.75, 37.6, d), want, d);
});

test('okrOf: без названия — ближайшее место каталога или координаты', async () => {
  assert.equal(okrOf(55.7558, 37.6176, ''), 'center', 'Кремль');
  assert.equal(okrOf(55.99, 37.20, ''), 'zel');
  assert.equal(okrOf(55.86, 37.65, ''), 'ne');
  assert.equal(okrOf(55.55, 37.40, ''), 'new');
  assert.equal(okrOf(55.90, 37.43, ''), 'khimki');
  assert.equal(okrOf(55.80, 38.10, ''), 'mo');
  assert.equal(okrOf(NaN, NaN, ''), '');
  const places = { a: { lat: 55.80, lon: 37.50, okr: 'north' }, b: { lat: 55.60, lon: 37.60, okr: 'south' } };
  assert.equal(okrOf(55.801, 37.501, '', places), 'north');
  assert.equal(okrOf(55.70, 37.75, '', places), 'se', 'дальше 1,5 км от мест — по координатам');
  // проверка на настоящем каталоге: соседи угадывают округ почти всегда
  const c = await loadCatalog(REPO);
  let hit = 0, n = 0;
  for (const [id, p] of Object.entries(c.places)) {
    const others = { ...c.places };
    delete others[id];
    n++;
    if (okrOf(p.lat, p.lon, '', others) === p.okr) hit++;
  }
  assert.ok(hit / n > 0.9, `соседи угадали ${hit} из ${n}`);
});

/* ---------- Nominatim ---------- */

const OSM_HIT = [{
  lat: '55.7612345678', lon: '37.5838123456', place_rank: 30, addresstype: 'building', display_name: '5с1, Садовая-Кудринская улица, Москва',
  address: { house_number: '5с1', road: 'Садовая-Кудринская улица', suburb: 'Пресненский район', city_district: 'Центральный административный округ', city: 'Москва', state: 'Москва' },
}];

test('geocode через Nominatim: параметры запроса, разбор ответа, User-Agent', async () => {
  const f = fakeFetch(OSM_HIT);
  const r = await geocode('Садовая-Кудринская ул., 5, стр. 1', { fetchImpl: f, minIntervalMs: 0 });
  assert.deepEqual(r, {
    lat: 55.761235, lon: 37.583812, display: '5с1, Садовая-Кудринская улица, Москва',
    district: 'Москва, Центральный административный округ, Пресненский район', precision: 'exact',
  });
  assert.equal(okrOf(r.lat, r.lon, r.district), 'center');
  const u = new URL(f.calls[0].url);
  assert.equal(u.origin + u.pathname, 'https://nominatim.openstreetmap.org/search');
  assert.equal(u.searchParams.get('format'), 'jsonv2');
  assert.equal(u.searchParams.get('addressdetails'), '1');
  assert.equal(u.searchParams.get('countrycodes'), 'ru');
  assert.equal(u.searchParams.get('viewbox'), '36.8,56.1,38.3,55.1');
  assert.equal(u.searchParams.get('bounded'), '1');
  assert.equal(u.searchParams.get('q'), 'Садовая-Кудринская ул., 5, стр. 1, Москва');
  assert.equal(f.calls[0].headers['User-Agent'], UA);
});

test('geocode: город в адресе не дублируем; отбрасываем «просто Москву» и точки вне области', async () => {
  const f = fakeFetch([
    { lat: '59.9', lon: '30.3', place_rank: 30, address: {} },
    { lat: '55.75', lon: '37.61', place_rank: 16, addresstype: 'city', address: { city: 'Москва' } },
    { lat: '55.889', lon: '37.444', place_rank: 26, addresstype: 'road', address: { road: 'улица Пожарского', city: 'Химки', county: 'городской округ Химки', state: 'Московская область' } },
  ]);
  const r = await geocode('Химки, ул. Пожарского, 12', { fetchImpl: f, minIntervalMs: 0 });
  assert.equal(new URL(f.calls[0].url).searchParams.get('q'), 'Химки, ул. Пожарского, 12');
  assert.equal(r.lat, 55.889);
  assert.equal(r.precision, 'street');
  assert.equal(okrOf(r.lat, r.lon, r.district), 'khimki');
  const none = await geocode('нет такого', { fetchImpl: fakeFetch([{ lat: '55.75', lon: '37.61', place_rank: 16, address: {} }]), minIntervalMs: 0 });
  assert.equal(none, null);
});

test('geocode: кеш — Map и обычный объект, «не нашли» тоже кешируется', async () => {
  const cache = new Map();
  const f = fakeFetch(OSM_HIT);
  const a = await geocode('Садовая-Кудринская ул., 5', { fetchImpl: f, cache, minIntervalMs: 0 });
  const b = await geocode('  Садовая-Кудринская   ул., 5 ', { fetchImpl: f, cache, minIntervalMs: 0 });
  assert.deepEqual(a, b);
  assert.equal(f.calls.length, 1);
  const obj = {};
  const g = fakeFetch([]);
  assert.equal(await geocode('Пустота, 1', { fetchImpl: g, cache: obj, minIntervalMs: 0 }), null);
  assert.equal(await geocode('Пустота, 1', { fetchImpl: g, cache: obj, minIntervalMs: 0 }), null);
  assert.equal(g.calls.length, 1);
  assert.deepEqual(Object.values(obj), [null]);
  assert.match(Object.keys(obj)[0], /^osm:/);
});

test('geocode: ошибка сети — null, без кеша, с предупреждением', async () => {
  const cache = new Map();
  const warns = [];
  const f = fakeFetch({ status: 429 });
  assert.equal(await geocode('Тверская ул., 7', { fetchImpl: f, cache, minIntervalMs: 0, log: m => warns.push(m) }), null);
  assert.equal(cache.size, 0);
  assert.match(warns[0], /HTTP 429/);
  const g = fakeFetch(new Error('ECONNRESET'));
  assert.equal(await geocode('Тверская ул., 7', { fetchImpl: g, cache, minIntervalMs: 0, log: quiet }), null);
  assert.equal(await geocode('', { fetchImpl: g, minIntervalMs: 0 }), null);
  assert.equal(g.calls.length, 1, 'пустой адрес — без запроса');
});

test('geocode: не чаще одного запроса в minIntervalMs, даже параллельно', async () => {
  const f = fakeFetch([]);
  const t0 = Date.now();
  await Promise.all(['А, 1', 'Б, 2', 'В, 3'].map(a => geocode(a, { fetchImpl: f, minIntervalMs: 60, log: quiet })));
  const el = Date.now() - t0;
  assert.equal(f.calls.length, 3);
  assert.ok(el >= 110, `прошло ${el} мс`);
});

/* ---------- Яндекс ---------- */

const yaObj = (pos, kind, text, comps, precision = 'exact') => ({
  GeoObject: {
    name: text.split(', ').pop(), Point: { pos },
    metaDataProperty: { GeocoderMetaData: { kind, text, precision, Address: { Components: comps } } },
  },
});
const yaResp = (...members) => ({ response: { GeoObjectCollection: { featureMember: members } } });

test('geocode через Яндекс: параметры, координаты «lon lat», округ обратным запросом', async () => {
  const fwd = yaResp(
    yaObj('37.6176 55.7558', 'locality', 'Россия, Москва', [{ kind: 'country', name: 'Россия' }, { kind: 'province', name: 'Москва' }, { kind: 'locality', name: 'Москва' }]),
    yaObj('37.603831 55.729875', 'house', 'Россия, Москва, Крымский Вал, 9', [
      { kind: 'country', name: 'Россия' }, { kind: 'province', name: 'Центральный федеральный округ' }, { kind: 'province', name: 'Москва' },
      { kind: 'locality', name: 'Москва' }, { kind: 'street', name: 'Крымский Вал' }, { kind: 'house', name: '9' }]),
  );
  const rev = yaResp(
    { GeoObject: { name: 'Центральный административный округ', Point: { pos: '37.6 55.75' } } },
    { GeoObject: { name: 'район Якиманка', Point: { pos: '37.6 55.73' } } },
  );
  const f = fakeFetch(fwd, rev);
  const r = await geocode('ул. Крымский Вал, 9', { yandexKey: 'test-key', fetchImpl: f, minIntervalMs: 0 });
  assert.deepEqual(r, {
    lat: 55.729875, lon: 37.603831, display: 'Россия, Москва, Крымский Вал, 9',
    district: 'Москва, Центральный административный округ, район Якиманка', precision: 'exact',
  });
  assert.equal(okrOf(r.lat, r.lon, r.district), 'center');
  const u = new URL(f.calls[0].url);
  assert.equal(u.origin + u.pathname, 'https://geocode-maps.yandex.ru/1.x/');
  assert.equal(u.searchParams.get('apikey'), 'test-key');
  assert.equal(u.searchParams.get('geocode'), 'Москва, ул. Крымский Вал, 9');
  assert.equal(u.searchParams.get('format'), 'json');
  assert.equal(u.searchParams.get('lang'), 'ru_RU');
  assert.equal(u.searchParams.get('bbox'), '36.8,55.1~38.3,56.1');
  assert.equal(u.searchParams.get('rspn'), '1');
  const u2 = new URL(f.calls[1].url);
  assert.equal(u2.searchParams.get('geocode'), '37.603831,55.729875');
  assert.equal(u2.searchParams.get('kind'), 'district');
});

test('geocode через Яндекс: Подмосковье — округ из ответа, без второго запроса', async () => {
  const f = fakeFetch(yaResp(yaObj('37.4440 55.8890', 'house', 'Россия, Московская область, Химки, улица Пожарского, 12', [
    { kind: 'country', name: 'Россия' }, { kind: 'province', name: 'Московская область' }, { kind: 'area', name: 'городской округ Химки' },
    { kind: 'locality', name: 'Химки' }, { kind: 'street', name: 'улица Пожарского' }, { kind: 'house', name: '12' }])));
  const r = await geocode('Химки, ул. Пожарского, 12', { yandexKey: 'k', fetchImpl: f, minIntervalMs: 0 });
  assert.equal(f.calls.length, 1);
  assert.equal(r.district, 'Московская область, городской округ Химки, Химки');
  assert.equal(okrOf(r.lat, r.lon, r.district), 'khimki');
  assert.equal(new URL(f.calls[0].url).searchParams.get('geocode'), 'Химки, ул. Пожарского, 12');
});

test('geocode через Яндекс: только «Москва» целиком — null', async () => {
  const f = fakeFetch(yaResp(yaObj('37.6176 55.7558', 'locality', 'Россия, Москва', [{ kind: 'province', name: 'Москва' }, { kind: 'locality', name: 'Москва' }], 'other')));
  assert.equal(await geocode('непонятно что', { yandexKey: 'k', fetchImpl: f, minIntervalMs: 0 }), null);
});

test('okrOf: только район без округа (так часто отвечает Nominatim)', () => {
  assert.equal(okrOf(55.64, 37.60, 'Москва, район Зюзино'), 'sw');
  assert.equal(okrOf(55.76, 37.58, 'Москва, Пресненский район'), 'center');
  assert.equal(okrOf(55.88, 37.66, 'Москва, район Северный'), 'ne', 'район «Северный» — это СВАО, не САО');
  assert.equal(okrOf(55.80, 37.62, 'Москва, район Марьина Роща'), 'ne');
  assert.equal(okrOf(55.85, 37.48, 'Москва, район Левобережный'), 'north');
  assert.equal(okrOf(55.89, 37.47, 'Московская область, городской округ Химки, Химки, Левобережный'), 'khimki', 'микрорайон Химок с тем же именем');
  assert.equal(okrOf(55.55, 37.48, 'Москва, поселение Сосенское'), 'new');
  assert.equal(okrOf(55.99, 37.20, 'Москва, Зеленоград, район Крюково'), 'zel');
});

test('geocode: Nominatim не нашёл — второй запрос с упрощённым адресом', async () => {
  const f = fakeFetch([], OSM_HIT);
  const r = await geocode('Садовая-Кудринская ул., 5, стр. 1 (вход со двора)', { fetchImpl: f, minIntervalMs: 0 });
  assert.equal(r.lat, 55.761235);
  assert.equal(f.calls.length, 2);
  assert.equal(new URL(f.calls[1].url).searchParams.get('q'), 'Садовая-Кудринская улица, 5, Москва');
});

test('simplifyAddr: сокращения, строения, дроби', () => {
  assert.equal(simplifyAddr('ул. Марксистская, 34к7'), 'улица Марксистская, 34');
  assert.equal(simplifyAddr('Большая Никитская ул., 23/14с1'), 'Большая Никитская улица, 23');
  assert.equal(simplifyAddr('Химки, Совхозная ул., вл. 14/1 (парк)'), 'Химки, Совхозная улица, 14');
  assert.equal(simplifyAddr('просп. Мира, 26, стр. 1'), 'проспект Мира, 26');
  assert.equal(simplifyAddr('Ленинградское ш., д. 51'), 'Ленинградское шоссе, 51');
  assert.equal(simplifyAddr('Земляной Вал, 9А'), 'Земляной Вал, 9А');
});

test('geocode: несколько одноимённых улиц — near выбирает ближнюю, ambiguous предупреждает', async () => {
  const two = [
    { lat: '55.5903', lon: '37.2119', place_rank: 30, addresstype: 'building', display_name: 'далеко', address: { house_number: '2', suburb: 'район Внуково', state: 'Москва' } },
    { lat: '55.7853', lon: '37.6152', place_rank: 30, addresstype: 'building', display_name: 'рядом', address: { house_number: '2', suburb: 'район Марьина Роща', state: 'Москва' } },
  ];
  const plain = await geocode('Октябрьская ул., 2', { fetchImpl: fakeFetch(two), minIntervalMs: 0 });
  assert.equal(plain.display, 'далеко', 'без подсказки — первая находка');
  assert.equal(plain.ambiguous, true);
  assert.deepEqual(plain.alts, [{ lat: 55.7853, lon: 37.6152, display: 'рядом' }]);
  const cache = new Map();
  const hinted = await geocode('Октябрьская ул., 2', { fetchImpl: fakeFetch(two), minIntervalMs: 0, near: { lat: 55.7815, lon: 37.6151 }, cache });
  assert.equal(hinted.display, 'рядом');
  assert.equal(okrOf(hinted.lat, hinted.lon, hinted.district), 'ne');
  assert.match([...cache.keys()][0], /@55\.782,37\.615$/, 'подсказка входит в ключ кеша');
  const one = await geocode('Тверская ул., 7', { fetchImpl: fakeFetch(OSM_HIT), minIntervalMs: 0 });
  assert.equal(one.ambiguous, undefined);
});

test('geocode strict: сбой сервиса — исключение с transient, «не нашли» — по-прежнему null', async () => {
  const cache = new Map();
  await assert.rejects(geocode('Тверская ул., 7', { fetchImpl: fakeFetch({ status: 429 }), cache, minIntervalMs: 0, log: quiet, strict: true }),
    e => e.transient === true && /геокодер недоступен/.test(e.message));
  await assert.rejects(geocode('Тверская ул., 7', { fetchImpl: fakeFetch(new Error('ECONNRESET')), cache, minIntervalMs: 0, log: quiet, strict: true }),
    e => e.transient === true);
  assert.equal(cache.size, 0, 'сбой не кешируется');
  assert.equal(await geocode('Пустота, 1', { fetchImpl: fakeFetch([]), minIntervalMs: 0, strict: true }), null);
});

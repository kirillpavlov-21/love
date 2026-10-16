/* Два города: Москва и Петербург. Геокодер и районы, каталог (города, id, дубли, планы), источники по городам,
   запросы к модели и сквозной прогон с каналами обоих городов. Сеть не трогаем: fetch и модель подставные,
   работа идёт на временной копии assets/. Каналы, места и адреса выдуманы. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  CITIES, normCity, cityHint, mentionsCity, inRegion, inSpbRegion, inMoscowRegion, regionOf, okrOf, geocode, nearestMetro,
} from '../lib/geo.mjs';
import {
  loadCatalog, parseStations, placeCity, cityOf, findMatch, slugId, placeId, validatePlan, nearbyPlaces, catalogIndex, parseAutoJs,
} from '../lib/catalog.mjs';
import { renderAutoJs, emptyAutoData } from '../lib/autojs.mjs';
import { buildExtractUser, buildPlansUser, buildPhotoUser, normItem, requestKey } from '../lib/llm.mjs';
import { labelCity, fetchInbox } from '../lib/sources/inbox.mjs';
import {
  main, normSources, fairSlice, eventId, cleanAddr, itemCity, stationHint, findDupEvent,
} from '../run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const GEO_JS = readFileSync(path.join(ROOT, 'assets/geo.js'), 'utf8');
const quiet = () => {};
const tmpDirs = [];
after(async () => { await Promise.all(tmpDirs.map(d => fs.rm(d, { recursive: true, force: true }))); });

/* Поддельный fetch: отвечает по очереди и запоминает запросы */
function fakeFetch(...bodies) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    const b = bodies.length > 1 ? bodies.shift() : bodies[0];
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(b)) };
  };
  fn.calls = calls;
  return fn;
}

/* ---------- города и регионы ---------- */

test('регионы: рамка Петербурга 59.633–60.245 × 29.425–30.76 с пригородами, Москва — как раньше', () => {
  assert.equal(inSpbRegion(59.9390, 30.3158), true, 'Дворцовая');
  assert.equal(inSpbRegion(59.633, 29.425), true, 'угол рамки');
  assert.equal(inSpbRegion(60.245, 30.76), true, 'угол рамки');
  assert.equal(inSpbRegion(59.9950, 29.7660), true, 'Кронштадт');
  assert.equal(inSpbRegion(60.1960, 29.7010), true, 'Зеленогорск');
  assert.equal(inSpbRegion(59.7230, 30.4100), true, 'Пушкин');
  assert.equal(inSpbRegion(60.0504, 30.4424), true, 'Мурино');
  assert.equal(inSpbRegion(59.6, 30.3), false, 'южнее рамки');
  assert.equal(inSpbRegion(55.75, 37.62), false, 'Москва');
  assert.equal(inMoscowRegion(59.93, 30.31), false);
  assert.equal(inRegion('spb', 59.93, 30.31), true);
  assert.equal(inRegion('msk', 55.75, 37.62), true);
  assert.equal(inRegion(undefined, 55.75, 37.62), true, 'без города — Москва');
  assert.equal(regionOf(59.93, 30.31), 'spb');
  assert.equal(regionOf(55.75, 37.62), 'msk');
  assert.equal(regionOf(56.86, 35.9), '', 'Тверь — ни там, ни там');
  assert.equal(regionOf(NaN, 30), '');
});

test('normCity и cityHint: коды, русские названия, пригороды целым словом', () => {
  for (const s of ['spb', 'SPB', 'СПб', 'Петербург', 'Санкт-Петербург', 'питер', 'saint petersburg']) assert.equal(normCity(s), 'spb', s);
  for (const s of ['msk', 'Москва', 'moscow', 'МСК']) assert.equal(normCity(s), 'msk', s);
  for (const s of ['', 'kazan', null, undefined, 42]) assert.equal(normCity(s), '', String(s));
  assert.equal(cityHint('Пушкин, Садовая ул., 7'), 'spb');
  assert.equal(cityHint('г. Санкт-Петербург, Невский пр., 28'), 'spb');
  assert.equal(cityHint('Открылось в Питере на Рубинштейна'), 'spb');
  assert.equal(cityHint('Мурино, Привокзальная пл., 1'), 'spb');
  assert.equal(cityHint('Пушкинская ул., 10'), '', 'улица, а не город Пушкин');
  assert.equal(cityHint('ул. Ломоносова, 5'), '', 'улица, а не Ломоносов');
  assert.equal(cityHint('г. Москва, Тверская ул., 7'), 'msk');
  assert.equal(cityHint('Московский пр., 10'), '', 'Московский проспект есть и в Петербурге');
  for (const s of ['Песочный пер., 3', 'Кронштадтский бул., 7', 'Ломоносовский пр., 23', 'Павловская ул., 7', 'Ленинградский пр., 31'])
    assert.equal(cityHint(s), '', `московская улица: ${s}`);
  assert.equal(cityHint(''), '');
  assert.equal(mentionsCity('Открылось в Петербурге', 'spb'), true);
  assert.equal(mentionsCity('Открылось в Петербурге', 'msk'), false);
  assert.equal(mentionsCity('Петербургская кухня в центре Москвы', 'msk'), true);
  assert.equal(mentionsCity('Новое кафе в Химках', 'msk'), true);
  assert.equal(mentionsCity('Московский пр., 10', 'msk'), false, 'Московский проспект — не Москва');
  assert.equal(mentionsCity('что угодно', 'kzn'), false);
  assert.deepEqual(Object.keys(CITIES), ['msk', 'spb']);
});

/* ---------- районы Петербурга ---------- */

test('okrOf: районы Петербурга по названию от геокодера', () => {
  const cases = [
    ['Санкт-Петербург, Центральный район, округ Литейный', 'center'],
    ['Санкт-Петербург, Адмиралтейский район', 'center'],
    ['Санкт-Петербург, Петроградский район', 'petrograd'],
    ['Санкт-Петербург, Василеостровский район', 'vo'],
    ['Санкт-Петербург, Выборгский район', 'north'],
    ['Санкт-Петербург, Калининский район', 'north'],
    ['Санкт-Петербург, Приморский район', 'nw'],
    ['Санкт-Петербург, Московский район', 'south'],
    ['Санкт-Петербург, Фрунзенский район', 'south'],
    ['Санкт-Петербург, Кировский район', 'sw'],
    ['Санкт-Петербург, Красносельский район', 'sw'],
    ['Санкт-Петербург, Невский район', 'east'],
    ['Санкт-Петербург, Красногвардейский район', 'east'],
    ['Санкт-Петербург, Пушкинский район, Пушкин', 'out'],
    ['Санкт-Петербург, Петродворцовый район, Петергоф', 'out'],
    ['Санкт-Петербург, Кронштадтский район', 'out'],
    ['Санкт-Петербург, Курортный район, Сестрорецк', 'out'],
    ['Санкт-Петербург, Колпинский район', 'out'],
    ['Санкт-Петербург, Ломоносов', 'out'],
    ['Ленинградская область, Всеволожский район, Мурино', 'out'],
  ];
  // точка в Петербурге — город по точке; без точки — по «Санкт-Петербург» в названии
  for (const [d, want] of cases) {
    assert.equal(okrOf(59.93, 30.31, d), want, d);
    assert.equal(okrOf(NaN, NaN, d, null, 'spb'), want, d + ' (город задан)');
  }
  // московские имена не путают Петербург: «Московский», «Красносельский» и «Северный» в Москве — другие округа
  assert.equal(okrOf(59.85, 30.32, 'Санкт-Петербург, Московский район'), 'south');
  assert.equal(okrOf(55.77, 37.66, 'Москва, Красносельский район'), 'center', 'в Москве Красносельский — ЦАО');
  assert.equal(okrOf(55.75, 37.6, 'Москва, Центральный административный округ'), 'center');
});

test('okrOf: Петербург без названия района — места каталога того же города, иначе опорные точки', () => {
  const pts = [
    [59.9398, 30.3146, 'center', 'Эрмитаж'], [59.9341, 30.3061, 'center', 'Исаакиевский собор'], [59.9480, 30.3960, 'center', 'Смольный'],
    [59.9500, 30.3167, 'petrograd', 'Петропавловская крепость'], [59.9700, 30.2600, 'petrograd', 'Крестовский остров'],
    [59.9318, 30.2513, 'vo', 'Васильевский, 29-я линия'], [59.9240, 30.2410, 'vo', 'Севкабель'],
    [59.9560, 30.3560, 'north', 'Финляндский вокзал'], [59.9871, 30.1776, 'nw', 'Лахта'],
    [59.9430, 30.4190, 'east', 'Охта'], [59.8300, 30.3800, 'south', 'Купчино'], [59.8670, 30.2610, 'sw', 'Автово'],
    [59.7160, 30.3960, 'out', 'Пушкин'], [59.8850, 29.9090, 'out', 'Петергоф'], [60.1500, 29.9000, 'out', 'Курортный район'],
  ];
  for (const [lat, lon, want, name] of pts) assert.equal(okrOf(lat, lon, ''), want, name);
  // ближайшее место каталога того же города
  const places = { 'spb-a': { lat: 59.9400, lon: 30.3000, okr: 'vo', city: 'spb' }, m: { lat: 59.9401, lon: 30.3001, okr: 'mo' } };
  assert.equal(okrOf(59.9401, 30.3002, '', places), 'vo');
  // московское место (без city и без префикса) рядом не считается, и коды вне списка Петербурга — тоже
  assert.equal(okrOf(59.9340, 30.3300, '', { m: { lat: 59.9341, lon: 30.3301, okr: 'north' } }), 'center');
  assert.equal(okrOf(NaN, NaN, '', null, 'spb'), '');
});

/* ---------- геокодер ---------- */

const SPB_HIT = [{
  lat: '59.93525', lon: '30.32794', place_rank: 30, addresstype: 'building', display_name: '28, Невский проспект, Санкт-Петербург',
  address: { house_number: '28', road: 'Невский проспект', suburb: 'округ № 78', city_district: 'Центральный район', city: 'Санкт-Петербург', state: 'Санкт-Петербург' },
}];

test('geocode Петербург через Nominatim: рамка, город в запросе, точки Москвы отброшены, свой ключ кеша', async () => {
  const f = fakeFetch([{ lat: '55.75', lon: '37.61', place_rank: 30, addresstype: 'building', address: {} }, ...SPB_HIT]);
  const cache = {};
  const r = await geocode('Невский пр., 28', { fetchImpl: f, minIntervalMs: 0, city: 'spb', cache });
  assert.equal(r.lat, 59.93525);
  assert.equal(r.precision, 'exact');
  assert.equal(r.ambiguous, undefined, 'московская находка отброшена, а не «несколько мест»');
  assert.equal(okrOf(r.lat, r.lon, r.district), 'center');
  const u = new URL(f.calls[0].url);
  assert.equal(u.searchParams.get('viewbox'), '29.425,60.245,30.76,59.633');
  assert.equal(u.searchParams.get('bounded'), '1');
  assert.equal(u.searchParams.get('q'), 'Невский пр., 28, Санкт-Петербург');
  assert.deepEqual(Object.keys(cache), ['osm:spb:невский пр., 28']);
  // тот же адрес в Москве — другой ключ кеша и другой запрос (старые московские ключи не меняются)
  const g = fakeFetch([]);
  assert.equal(await geocode('Невский пр., 28', { fetchImpl: g, minIntervalMs: 0, cache }), null);
  assert.ok(g.calls.length >= 1, 'не из кеша Петербурга');
  assert.equal(new URL(g.calls[0].url).searchParams.get('viewbox'), '36.8,56.1,38.3,55.1');
  assert.equal(new URL(g.calls[0].url).searchParams.get('q'), 'Невский пр., 28, Москва');
  assert.ok('osm:невский пр., 28' in cache);
  // пригород: город уже в адресе — не дописываем «Санкт-Петербург»
  const h = fakeFetch([]);
  await geocode('Пушкин, Садовая ул., 7', { fetchImpl: h, minIntervalMs: 0, city: 'spb' });
  assert.equal(new URL(h.calls[0].url).searchParams.get('q'), 'Пушкин, Садовая ул., 7');
});

const yaObj = (pos, kind, text, comps, precision = 'exact') => ({
  GeoObject: { name: text.split(', ').pop(), Point: { pos },
    metaDataProperty: { GeocoderMetaData: { kind, text, precision, Address: { Components: comps } } } },
});
const yaResp = (...members) => ({ response: { GeoObjectCollection: { featureMember: members } } });

test('geocode Петербург через Яндекс: рамка, «просто Санкт-Петербург» отброшен, район обратным запросом', async () => {
  const fwd = yaResp(
    yaObj('30.315833 59.939167', 'locality', 'Россия, Санкт-Петербург', [{ kind: 'province', name: 'Санкт-Петербург' }, { kind: 'locality', name: 'Санкт-Петербург' }]),
    yaObj('30.327940 59.935250', 'house', 'Россия, Санкт-Петербург, Невский проспект, 28', [
      { kind: 'country', name: 'Россия' }, { kind: 'province', name: 'Северо-Западный федеральный округ' }, { kind: 'province', name: 'Санкт-Петербург' },
      { kind: 'locality', name: 'Санкт-Петербург' }, { kind: 'street', name: 'Невский проспект' }, { kind: 'house', name: '28' }]),
  );
  const rev = yaResp({ GeoObject: { name: 'муниципальный округ № 78', Point: { pos: '30.33 59.93' } } },
    { GeoObject: { name: 'Центральный район', Point: { pos: '30.36 59.93' } } });
  const f = fakeFetch(fwd, rev);
  const r = await geocode('Невский пр., 28', { yandexKey: 'k', fetchImpl: f, minIntervalMs: 0, city: 'spb' });
  assert.equal(r.lat, 59.93525);
  assert.equal(r.district, 'Санкт-Петербург, муниципальный округ № 78, Центральный район');
  assert.equal(okrOf(r.lat, r.lon, r.district, null, 'spb'), 'center');
  const u = new URL(f.calls[0].url);
  assert.equal(u.searchParams.get('geocode'), 'Санкт-Петербург, Невский пр., 28');
  assert.equal(u.searchParams.get('bbox'), '29.425,59.633~30.76,60.245');
  assert.equal(new URL(f.calls[1].url).searchParams.get('kind'), 'district');
  // только «Санкт-Петербург» целиком — не адрес
  const g = fakeFetch(yaResp(yaObj('30.315833 59.939167', 'locality', 'Россия, Санкт-Петербург', [], 'other')));
  assert.equal(await geocode('непонятно что', { yandexKey: 'k', fetchImpl: g, minIntervalMs: 0, city: 'spb' }), null);
});

/* ---------- станции ---------- */

test('станции Петербурга: FIXED_SPB из assets/geo.js — [lat, lon, линия], отдельно от московских', () => {
  const spb = parseStations(GEO_JS, 'spb');
  const msk = parseStations(GEO_JS);
  assert.ok(Object.keys(spb).length >= 70, `станций ${Object.keys(spb).length}`);
  assert.equal(spb['Горьковская'].length, 3);
  assert.ok(spb['Маяковская'][0] > 59 && msk['Маяковская'][0] < 56, 'одноимённые станции — в своём городе');
  assert.ok(!('Невский проспект' in msk));
  assert.equal(nearestMetro(59.9561, 30.3189, spb).name, 'Горьковская');
  assert.throws(() => parseStations('const FIXED = { "А": [1, 2] };', 'spb'), /FIXED_SPB/);
  // подсказка геокодеру — станция из таблицы города поста
  const h = stationHint('м. Маяковская', '', spb);
  assert.ok(h.lat > 59, 'Маяковская петербургская');
  assert.equal(stationHint('', 'Адрес: Большая Конюшенная, 99, м. Невский проспект', spb).name, 'Невский проспект');
  assert.equal(stationHint('', 'м. Невский проспект', msk), null, 'в Москве такой станции нет');
});

/* ---------- каталог ---------- */

const PLACES_JS = `window.KUDA = { updated: '2026-10-01',
  places: {
    kofe: { name: 'Кофемания', kind: 'Кофейня', cat: 'coffee', addr: 'Садовая ул., 7', metro: 'Арбатская', lat: 55.7520, lon: 37.6000, okr: 'center' },
    park: { name: 'Парк', kind: 'Парк', cat: 'walk', addr: 'Тестовая ул., 1', metro: 'Арбатская', lat: 55.7525, lon: 37.6005, okr: 'center' },
  },
  scenarios: [{ id: 'd-1', mode: 'date', emoji: '🌳', title: 'Парк и кофе', stops: ['park', 'kofe'], when: 'день', why: 'Тест.' }],
  adult: [] };`;
// как assets/places-spb.js: слияние с city: 'spb', без перезаписи чужих id
const PLACES_SPB_JS = `(function (K, D) {
  if (!K || !K.places) return;
  for (const [id, p] of Object.entries(D.places)) if (!Object.prototype.hasOwnProperty.call(K.places, id)) K.places[id] = Object.assign(p, { city: 'spb' });
  const have = new Set(K.scenarios.map(s => s.id));
  for (const s of D.scenarios) if (!have.has(s.id)) K.scenarios.push(Object.assign(s, { city: 'spb' }));
  for (const id of D.adult) if (!K.adult.includes(id)) K.adult.push(id);
})(window.KUDA, {
  places: {
    'spb-kofe': { name: 'Кофемания', kind: 'Кофейня', cat: 'coffee', addr: 'Садовая ул., 7', metro: 'Садовая', lat: 59.9265, lon: 30.3170, okr: 'center' },
    'spb-sad': { name: 'Михайловский сад', kind: 'Сад', cat: 'walk', addr: 'Инженерная ул., 2', metro: 'Гостиный двор', lat: 59.9396, lon: 30.3325, okr: 'center' },
    'spb-bistro': { name: 'Бистро Нева', kind: 'Бистро', cat: 'food', addr: 'Итальянская ул., 5', metro: 'Гостиный двор', lat: 59.9370, lon: 30.3310, okr: 'center' },
  },
  scenarios: [{ id: 'spb-d-sad', mode: 'date', emoji: '🌳', title: 'Сад и бистро', stops: ['spb-sad', 'spb-bistro'], when: 'день', why: 'Тест.' }],
  adult: [],
});`;
const EVENTS_JS = `window.KUDA_EVENTS = [{ id: 'ev-msk', title: 'Концерт', cat: 'concert', start: '2026-10-20', end: '2026-10-20', venue: 'Зал', lat: 55.75, lon: 37.6 }];`;
const EVENTS_SPB_JS = `(function (E, L) {
  const have = new Set(E.map(e => e.id));
  for (const e of L) if (e && e.id && !have.has(e.id)) { E.push(Object.assign(e, { city: 'spb' })); have.add(e.id); }
})(window.KUDA_EVENTS = window.KUDA_EVENTS || [], [
  { id: 'ev-spb-koncert-20261021', title: 'Концерт', cat: 'concert', start: '2026-10-21', end: '2026-10-21', venue: 'Зал', lat: 59.93, lon: 30.33 },
]);`;
const SPORT_JS = `window.KUDA_SPORT = { updated: '2026-10-16', events: [
  { id: 'ev-fb-zenit-spartak-20261025', title: 'Зенит — Спартак', cat: 'sport', start: '2026-10-25', end: '2026-10-25', venue: 'Газпром Арена', city: 'spb', lat: 59.973, lon: 30.221 },
] };
(function (E, S) {
  const have = new Set(E.map(e => e.id));
  for (const e of S.events) if (e && e.id && !have.has(e.id)) { E.push(e); have.add(e.id); }
})(window.KUDA_EVENTS = window.KUDA_EVENTS || [], window.KUDA_SPORT);`;
const GEO_FIX = `(function () {
  const FIXED = { 'Арбатская': [55.7520, 37.6038], 'Маяковская': [55.7699, 37.5962] };
  const FIXED_SPB = { 'Маяковская': [59.9315, 30.3549, 3], 'Садовая': [59.9267, 30.3175, 5], 'Гостиный двор': [59.9338, 30.3330, 3] };
})();`;

async function fixtureRepo(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kuda-cities-'));
  tmpDirs.push(dir);
  await fs.mkdir(path.join(dir, 'assets'));
  for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(dir, 'assets', name), text);
  return dir;
}

test('loadCatalog: places-spb.js после places.js, events-spb.js и sport.js после events.js, станции по городам', async () => {
  const dir = await fixtureRepo({ 'places.js': PLACES_JS, 'places-spb.js': PLACES_SPB_JS, 'events.js': EVENTS_JS,
    'events-spb.js': EVENTS_SPB_JS, 'sport.js': SPORT_JS, 'geo.js': GEO_FIX });
  const c = await loadCatalog(dir);
  assert.deepEqual(Object.keys(c.places).sort(), ['kofe', 'park', 'spb-bistro', 'spb-kofe', 'spb-sad']);
  assert.equal(c.places['spb-sad'].city, 'spb');
  assert.equal(c.places.kofe.city, undefined, 'московские — без поля city');
  assert.deepEqual(c.scenarios.map(s => s.id), ['d-1', 'spb-d-sad']);
  assert.deepEqual(c.events.map(e => e.id), ['ev-msk', 'ev-spb-koncert-20261021', 'ev-fb-zenit-spartak-20261025']);
  assert.deepEqual(c.events.map(e => cityOf(e, c)), ['msk', 'spb', 'spb']);
  assert.deepEqual(Object.keys(c.stations), ['Арбатская', 'Маяковская'], 'stations — по-прежнему Москва');
  assert.deepEqual(Object.keys(c.cityStations.spb), ['Маяковская', 'Садовая', 'Гостиный двор']);
  assert.equal(c.cityStations.msk, c.stations);
  // без файлов Петербурга и без FIXED_SPB — как раньше
  const old = await fixtureRepo({ 'places.js': PLACES_JS, 'geo.js': 'const FIXED = { "Арбатская": [55.752, 37.6038] };' });
  const o = await loadCatalog(old);
  assert.deepEqual(Object.keys(o.places), ['kofe', 'park']);
  assert.deepEqual(o.cityStations.spb, {});
});

test('настоящий репозиторий: загружаются places-spb.js, events-spb.js и sport.js, таблица метро Петербурга', async () => {
  const c = await loadCatalog(ROOT);
  assert.ok(Object.keys(c.cityStations.spb).length >= 70);
  for (const [id, p] of Object.entries(c.places)) {
    if (placeCity(id, p) === 'spb') assert.match(id, /^spb-/, `место Петербурга ${id} без префикса spb-`);
  }
  for (const e of c.events) if (cityOf(e, c) === 'spb' && !/^ev-fb-/.test(e.id)) assert.match(e.id, /^ev-spb-/, e.id);
});

test('cityOf / placeCity: поле city → префикс id → остановки плана → площадка события → точка → Москва', () => {
  const P = { a: { lat: 55.75, lon: 37.6 }, 'spb-b': { lat: 59.93, lon: 30.3 }, c: { city: 'spb' }, d: { lat: 59.93, lon: 30.3 } };
  assert.equal(placeCity('a', P.a), 'msk');
  assert.equal(placeCity('spb-b', P['spb-b']), 'spb');
  assert.equal(placeCity('c', P.c), 'spb');
  assert.equal(placeCity('d', P.d), 'spb', 'без поля и префикса — по точке');
  assert.equal(placeCity('x', {}), 'msk');
  assert.equal(cityOf('spb-anything'), 'spb');
  assert.equal(cityOf('ev-spb-x-20261020'), 'spb');
  assert.equal(cityOf('c', P), 'spb');
  assert.equal(cityOf({ id: 'auto-date-x', stops: ['spb-b', 'a'] }, P), 'spb', 'план — по первой остановке');
  assert.equal(cityOf({ id: 'spb-d-x', stops: ['a'] }, P), 'spb', 'префикс id важнее остановок');
  assert.equal(cityOf({ id: 'ev-x', place: 'c' }, P), 'spb');
  assert.equal(cityOf({ id: 'ev-fb-x', city: 'msk', lat: 59.9, lon: 30.3 }), 'msk', 'явный city важнее точки');
  assert.equal(cityOf({ id: 'ev-x', lat: 59.9, lon: 30.3 }), 'spb');
  assert.equal(cityOf(null), 'msk');
});

test('findMatch: только в своём городе — одно имя и адрес в Москве и Петербурге не склеиваются', async () => {
  const dir = await fixtureRepo({ 'places.js': PLACES_JS, 'places-spb.js': PLACES_SPB_JS, 'geo.js': GEO_FIX });
  const c = await loadCatalog(dir);
  assert.equal(findMatch({ name: 'Кофемания', addr: 'Садовая ул., 7', city: 'spb' }, c).id, 'spb-kofe');
  assert.equal(findMatch({ name: 'Кофемания', addr: 'Садовая ул., 7', city: 'msk' }, c).id, 'kofe');
  assert.equal(findMatch({ name: 'Кофемания', lat: 59.9266, lon: 30.3171 }, c).id, 'spb-kofe', 'город по координатам');
  assert.equal(findMatch({ name: 'Михайловский сад', city: 'msk' }, c), null, 'в Москве такого нет');
  assert.equal(findMatch({ name: 'Михайловский сад', city: 'spb' }, c).id, 'spb-sad');
  // без города и координат — как раньше, по всему каталогу: имя в двух городах неоднозначно
  assert.equal(findMatch({ name: 'Кофемания' }, c), null);
});

test('id: места spb-…, московское «SPB …» — msk-…, события ev-spb-…, уникальность', () => {
  assert.equal(placeId('Эрмитаж', new Set(), 'spb'), 'spb-ermitazh');
  assert.equal(placeId('Эрмитаж', new Set(['spb-ermitazh']), 'spb'), 'spb-ermitazh-2');
  assert.equal(placeId('Эрмитаж', new Set(['ermitazh'])), 'ermitazh-2', 'в Москве — без префикса');
  assert.equal(placeId('SPB Bar', new Set()), 'msk-spb-bar', 'московское место не должно выглядеть петербургским');
  assert.equal(slugId('Кофемания', ['spb-kofemaniya'], 'spb-'), 'spb-kofemaniya-2');
  assert.equal(eventId({ title: 'Ночь в музее', start: '2026-11-01' }, '', 'spb'), 'ev-spb-noch-v-muzee-20261101');
  assert.equal(eventId({ title: 'Ночь в музее', start: '2026-11-01' }, 'Эрмитаж', 'spb'), 'ev-spb-noch-v-muzee-ermitazh-20261101');
  assert.equal(eventId({ title: 'Ночь в музее', start: '2026-11-01' }), 'ev-noch-v-muzee-20261101', 'Москва — как раньше');
  assert.equal(eventId({ title: 'СПб-джаз', start: '2026-11-01' }), 'ev-msk-spb-dzhaz-20261101');
});

const PL = {
  park: { name: 'Парк', kind: 'Парк', cat: 'walk', lat: 55.7500, lon: 37.6000 },
  rest: { name: 'Ресторан', kind: 'Ресторан', cat: 'food', lat: 55.7510, lon: 37.6010 },
  'spb-sad': { name: 'Сад', kind: 'Сад', cat: 'walk', lat: 59.9396, lon: 30.3325, city: 'spb' },
  'spb-bistro': { name: 'Бистро', kind: 'Бистро', cat: 'food', lat: 59.9370, lon: 30.3310, city: 'spb' },
  twin: { name: 'Двойник', kind: 'Ресторан', cat: 'food', lat: 59.9371, lon: 30.3311, city: 'msk' },   // выдуманное: московское по полю
};
const plan = (id, stops, tags = [], extra = {}) => ({ id, mode: 'date', emoji: '✨', title: 'T', stops, when: 'вечер', tags, why: 'тест', ...extra });

test('validatePlan: места из разных городов — нельзя, даже с тегом drive; план Петербурга — только с местами Петербурга', () => {
  assert.deepEqual(validatePlan(plan('spb-d-x', ['spb-sad', 'spb-bistro']), PL).errors, []);
  assert.deepEqual(validatePlan(plan('auto-date-x', ['park', 'rest']), PL).errors, []);
  const mixed = validatePlan(plan('x', ['park', 'spb-bistro'], ['drive']), PL);
  assert.equal(mixed.ok, false);
  assert.ok(mixed.errors.some(e => /места из разных городов: park \(Москва\), spb-bistro \(Петербург\)/.test(e)), mixed.errors.join('; '));
  const near = validatePlan(plan('x', ['spb-sad', 'twin']), PL);
  assert.ok(near.errors.some(e => /разных городов/.test(e)), 'рядом, но разные города');
  const wrong = validatePlan(plan('spb-g-x', ['park', 'rest']), PL);
  assert.ok(wrong.errors.some(e => /план города «Петербург», а места — в Москве/.test(e)), wrong.errors.join('; '));
  const wrong2 = validatePlan(plan('auto-date-x', ['park'], [], { city: 'spb' }), PL);
  assert.equal(wrong2.ok, false, 'город плана из поля city');
});

test('nearbyPlaces: соседи только того же города', () => {
  const near = nearbyPlaces({ id: 'spb-sad', ...PL['spb-sad'] }, { places: PL, adult: [] }, 1200, 25);
  assert.deepEqual(near.map(x => x.id), ['spb-bistro'], 'московский «Двойник» рядом по координатам, но не в городе');
  assert.deepEqual(nearbyPlaces({ id: 'park', ...PL.park }, PL).map(x => x.id), ['rest']);
});

test('catalogIndex: места Петербурга — с городом в адресе; фильтр по городу', () => {
  const P = { b: { name: 'Б', kind: 'Бар', addr: 'ул. Б, 1' }, 'spb-a': { name: 'А', kind: 'Кафе', addr: 'Невский пр., 1', city: 'spb' } };
  assert.equal(catalogIndex(P), 'b|Б|Бар|ул. Б, 1\nspb-a|А|Кафе|Санкт-Петербург, Невский пр., 1');
  assert.equal(catalogIndex(P, 'spb'), 'spb-a|А|Кафе|Санкт-Петербург, Невский пр., 1');
  assert.equal(catalogIndex(P, 'msk'), 'b|Б|Бар|ул. Б, 1');
});

/* ---------- источники ---------- */

test('normSources: старый формат — Москва; cities.spb — Петербург; канал в обоих — город по тексту', () => {
  const old = normSources({ telegram: ['@some_channel', 'https://t.me/s/other_one/12', 'bad name!'], instagram: ['insta.user'], inbox: true });
  assert.deepEqual(old.telegram, ['some_channel', 'other_one']);
  assert.deepEqual(old.instagram, ['insta.user']);
  assert.equal(old.invalid, 1);
  assert.deepEqual(old.city, { 'tg:some_channel': 'msk', 'tg:other_one': 'msk', 'ig:insta.user': 'msk' });
  assert.deepEqual(old.badCities, []);

  const s = normSources({
    telegram: ['msk_one', 'both_cities'], instagram: ['msk.acc'],
    cities: { spb: { telegram: ['spb_one', 'both_cities', 'spb-placeholder'], instagram: ['spb.acc'] }, 'Казань': { telegram: ['kzn_one'] } },
    inbox: false,
  });
  assert.deepEqual(s.telegram, ['msk_one', 'both_cities', 'spb_one']);
  assert.deepEqual(s.instagram, ['msk.acc', 'spb.acc']);
  assert.deepEqual(s.city, { 'tg:msk_one': 'msk', 'tg:both_cities': '', 'tg:spb_one': 'spb', 'ig:msk.acc': 'msk', 'ig:spb.acc': 'spb' });
  assert.equal(s.invalid, 2, 'заглушка с дефисом и канал неизвестного города');
  assert.deepEqual(s.badCities, ['Казань']);
  assert.deepEqual(normSources({ cities: { 'СПб': { telegram: ['spb_two'] } } }).city, { 'tg:spb_two': 'spb' }, 'город по-русски');
  // записи-объекты { handle, city } тоже понимаются: город записи важнее города списка
  const o = normSources({
    telegram: ['msk_one', { handle: 'spb_obj', city: 'spb' }, { handle: '@msk_obj' }, { name: 'both_obj', city: 'msk' }, { handle: 'kzn_obj', city: 'Казань' }, { city: 'spb' }],
    instagram: [{ username: 'spb.ig', city: 'Петербург' }],
    cities: { spb: { telegram: ['both_obj', { handle: 'msk_in_spb', city: 'msk' }] } },
  });
  assert.deepEqual(o.telegram, ['msk_one', 'spb_obj', 'msk_obj', 'both_obj', 'msk_in_spb']);
  assert.deepEqual(o.instagram, ['spb.ig']);
  assert.deepEqual(o.city, { 'tg:msk_one': 'msk', 'tg:spb_obj': 'spb', 'tg:msk_obj': 'msk', 'tg:both_obj': '', 'tg:msk_in_spb': 'msk', 'ig:spb.ig': 'spb' });
  assert.equal(o.invalid, 2, 'неизвестный город записи и запись без имени');
  assert.deepEqual(o.badCities, ['Казань']);
  assert.deepEqual(normSources(null).telegram, []);
  // пример из репозитория: только заглушки, без настоящих имён
  const ex = JSON.parse(readFileSync(path.join(HERE, '..', 'sources.example.json'), 'utf8'));
  const n = normSources(ex);
  assert.deepEqual([n.telegram, n.instagram], [[], []]);
  assert.ok(ex.cities && ex.cities.spb, 'пример показывает формат cities.spb');
});

test('fairSlice: лимит постов поровну между городами, порядок по дате сохраняется', () => {
  const p = (k, city, d) => ({ key: k, city, date: d });
  const list = [p('s1', 'spb', '1'), p('s2', 'spb', '2'), p('s3', 'spb', '3'), p('s4', 'spb', '4'), p('m1', 'msk', '5'), p('m2', 'msk', '6')];
  const [take, rest] = fairSlice(list, 4);
  assert.deepEqual(take.map(x => x.key), ['s1', 's2', 'm1', 'm2']);
  assert.deepEqual(rest.map(x => x.key), ['s3', 's4']);
  const [all, none] = fairSlice(list, 10);
  assert.equal(all.length, 6);
  assert.deepEqual(none, []);
  assert.deepEqual(fairSlice(list.slice(0, 4), 2)[0].map(x => x.key), ['s1', 's2'], 'один город — просто самые старые');
});

test('ящик: метка «спб» задаёт город заявки', async () => {
  assert.equal(labelCity([{ name: 'источник' }, { name: 'спб' }]), 'spb');
  assert.equal(labelCity([{ name: 'Петербург' }]), 'spb');
  assert.equal(labelCity(['мск']), 'msk');
  assert.equal(labelCity([{ name: 'источник' }]), '');
  assert.equal(labelCity(null), '');
  const fetchImpl = async () => new Response(JSON.stringify([
    { number: 1, state: 'open', author_association: 'OWNER', title: 'А', body: 'текст', labels: [{ name: 'источник' }, { name: 'СПб' }] },
    { number: 2, state: 'open', author_association: 'OWNER', title: 'Б', body: 'текст', labels: [{ name: 'источник' }] },
  ]), { status: 200 });
  const r = await fetchInbox({ repo: 'o/r', fetchImpl });
  assert.deepEqual(r.posts.map(p => p.city), ['spb', undefined]);
});

test('cleanAddr и itemCity: город из адреса убираем, пригороды оставляем; город — модель → источник → адрес → Москва', () => {
  assert.equal(cleanAddr('г. Санкт-Петербург, Невский пр., 28, Россия, 191186'), 'Невский пр., 28');
  assert.equal(cleanAddr('Санкт-Петербург, наб. реки Мойки, 12'), 'наб. реки Мойки, 12');
  assert.equal(cleanAddr('СПб, Рубинштейна ул., 3'), 'Рубинштейна ул., 3');
  assert.equal(cleanAddr('Ленинградская обл., Мурино, Привокзальная пл., 1'), 'Мурино, Привокзальная пл., 1');
  assert.equal(cleanAddr('Пушкин, Садовая ул., 7'), 'Пушкин, Садовая ул., 7');
  assert.equal(cleanAddr('Московский пр., 10'), 'Московский пр., 10');
  assert.equal(itemCity({ city: 'spb' }, { city: 'msk', text: 'А в Петербурге на Рубинштейна открылся бар' }), 'spb', 'модель видит, что место в другом городе');
  assert.equal(itemCity({ city: 'spb', address: 'Пушкин, Садовая ул., 7' }, { city: 'msk', text: 'Новое кафе' }), 'spb', 'пригород в адресе');
  assert.equal(itemCity({ city: 'spb', address: 'Садовая ул., 7' }, { city: 'msk', text: 'Новое кафе на Садовой' }), 'msk',
    'город другой, но в посте он не назван — ошибка модели, остаётся город источника');
  assert.equal(itemCity({ city: 'msk' }, { city: 'spb', text: 'Открылось в Химках' }), 'msk', 'ближний город Подмосковья');
  assert.equal(itemCity({ city: 'spb' }, { city: '', text: 'Новое кафе' }), 'spb', 'канал про оба города — верим модели');
  assert.equal(itemCity({ city: '' }, { city: 'spb' }), 'spb');
  assert.equal(itemCity({ city: '', address: 'Пушкин, Садовая ул., 7' }, { source: 'inbox' }), 'spb');
  assert.equal(itemCity({ city: '' }, { source: 'inbox', text: 'Открылось в Питере кафе' }), 'spb');
  assert.equal(itemCity({ city: '' }, { source: 'inbox', text: 'Кафе на Тверской' }), 'msk');
});

test('findDupEvent: одинаковое событие в другом городе — не повтор', () => {
  const list = [
    { id: 'ev-shchelkunchik-20261225', title: 'Щелкунчик', start: '2026-12-25', end: '2026-12-25', venue: 'Большой театр', lat: 55.76, lon: 37.6186 },
    { id: 'ev-spb-shchelkunchik-20261225', title: 'Щелкунчик', start: '2026-12-25', end: '2026-12-25', venue: 'Мариинский театр', city: 'spb' },
  ];
  const probe = { title: 'Балет «Щелкунчик»', start: '2026-12-25', venue: 'Большой театр' };
  assert.equal(findDupEvent({ ...probe, city: 'msk' }, list).id, 'ev-shchelkunchik-20261225');
  assert.equal(findDupEvent({ ...probe, city: 'spb' }, list), null, 'в Петербурге свой «Большой театр» — не московский');
  assert.equal(findDupEvent({ ...probe, venue: 'Мариинский театр', city: 'spb' }, list).id, 'ev-spb-shchelkunchik-20261225');
  assert.equal(findDupEvent(probe, list).id, 'ev-shchelkunchik-20261225', 'без города — как раньше');
});

/* ---------- модель ---------- */

test('запросы к модели: город источника у поста, город в планах и в адресе для фото', () => {
  const post = (city, extra = {}) => ({ source: 'tg', channel: 'chan', id: 1, key: 'tg:chan/1', date: '2026-10-14T10:00:00Z', text: 'Текст поста о месте.', ...(city ? { city } : {}), ...extra });
  assert.match(buildExtractUser([post('spb')], '2026-10-15').content, /<post key="p1" date="2026-10-14" city="Петербург">/);
  assert.match(buildExtractUser([post('msk')], '2026-10-15').content, /<post key="p1" date="2026-10-14" city="Москва">/);
  // без города (ящик, старые тесты) — сообщение прежнее, ключ мока не меняется
  const plain = buildExtractUser([post('')], '2026-10-15').content;
  assert.match(plain, /<post key="p1" date="2026-10-14">/);
  assert.equal(requestKey(plain), requestKey(buildExtractUser([post('', { city: undefined })], '2026-10-15').content));

  const plans = buildPlansUser({ newPlace: { id: 'spb-x', name: 'X', kind: 'Кафе', cat: 'food', city: 'spb' }, nearby: [], city: 'spb' });
  assert.match(plans, /\nГород: Петербург\.$/);
  assert.match(buildPlansUser({ newPlace: { id: 'x' } }), /Город: Москва\./);
  const photo = buildPhotoUser({ name: 'X', kind: 'Кафе', addr: 'Невский пр., 1', city: 'spb' }, []);
  assert.match(photo[0].text, /Адрес: Санкт-Петербург, Невский пр., 1\./);
  assert.match(buildPhotoUser({ name: 'X', kind: 'Кафе', addr: 'Тверская ул., 1' }, [])[0].text, /Адрес: Тверская ул., 1\./);
});

test('normItem: поле city — msk, spb или пусто; старые ответы без поля city принимаются', () => {
  const raw = { post_key: 'p1', type: 'new_place', match_id: '', name: 'Тест', kind: 'Кафе', cat: 'food', address: '', area: '', price: 2,
    hours: '', note_ru: 'Описание.', fit: [], hints: [], adult: false, event: null, confidence: 0.7, reason: 'тест' };
  const ctx = { keyMap: new Map([['p1', 'tg:x/1']]), ids: new Set(), today: '2026-10-15' };
  assert.equal(normItem(raw, ctx).city, '', 'ответ без поля city');
  assert.equal(normItem({ ...raw, city: 'spb' }, ctx).city, 'spb');
  assert.equal(normItem({ ...raw, city: 'kzn' }, ctx), null, 'чужой код города — элемент негоден');
});

/* ---------- auto.js на сайте ---------- */

function browser(files) {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const [name, code] of files) vm.runInContext(code, ctx, { filename: name });
  return ctx;
}

test('auto.js: места, планы и события Петербурга с полем city сливаются, сайт видит их город', () => {
  const data = { ...emptyAutoData(), updated: '2026-10-16',
    places: { 'spb-novoe': { name: 'Новое', kind: 'Кафе', cat: 'food', addr: 'Невский пр., 1', metro: 'Адмиралтейская', lat: 59.936, lon: 30.315, okr: 'center', city: 'spb' },
      novoe: { name: 'Новое', kind: 'Кафе', cat: 'food', addr: 'Тверская ул., 1', metro: 'Охотный ряд', lat: 55.757, lon: 37.613, okr: 'center' } },
    scenarios: [{ id: 'spb-d-auto-novoe', mode: 'date', emoji: '☕', title: 'Новое', stops: ['spb-novoe'], when: 'день', tags: [], why: 'Тест.', city: 'spb' }],
    events: [{ id: 'ev-spb-test-20261101', title: 'Тест', cat: 'concert', start: '2026-11-01', end: '2026-11-01', lat: 59.93, lon: 30.33, city: 'spb' }],
    closed: [] };
  const js = renderAutoJs(data);
  assert.deepEqual(parseAutoJs(js), data);
  const read = f => readFileSync(path.join(ROOT, f), 'utf8');
  const w = browser([['config.js', read('config.js')], ['shared.js', read('assets/shared.js')],
    ['places.js', 'window.KUDA = { places: { old: { name: "Старое", lat: 55.75, lon: 37.6 } }, scenarios: [], adult: [] };'],
    ['places-spb.js', PLACES_SPB_JS], ['events-spb.js', EVENTS_SPB_JS], ['auto.js', js], ['auto.js#2', js]]);
  const K = w.DateKit;
  assert.equal(w.KUDA.places['spb-novoe'].city, 'spb');
  assert.equal(K.cityOf(w.KUDA.places['spb-novoe']), 'spb');
  assert.equal(K.cityOf('spb-novoe'), 'spb');
  assert.equal(K.cityOf(w.KUDA.places.novoe), 'msk');
  assert.equal(K.cityOf(K.planById('spb-d-auto-novoe')), 'spb');
  assert.equal(w.KUDA.scenarios.filter(s => s.id === 'spb-d-auto-novoe').length, 1, 'повторное выполнение без дублей');
  assert.equal(K.cityOf(w.KUDA_EVENTS.find(e => e.id === 'ev-spb-test-20261101')), 'spb');
});

/* ---------- сквозной прогон: каналы двух городов ---------- */

const TODAY = '2026-10-15';
const page = (ch, posts) => '<html><body><section class="tgme_channel_history js-message_history">'
  + posts.map(([id, date, text]) => `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="${ch}/${id}">`
    + `<div class="tgme_widget_message_text js-message_text" dir="auto">${text}</div>`
    + `<div class="tgme_widget_message_footer"><a class="tgme_widget_message_date" href="https://t.me/${ch}/${id}"><time datetime="${date}" class="time">12:00</time></a></div></div></div>`).join('')
  + '</section></body></html>';
const MSK_CH = 'mskexample', SPB_CH = 'spbexample';
const MSK_PAGE = page(MSK_CH, [
  [301, '2026-10-13T09:00:00+00:00', 'Открылась кофейня «Тестовая Нева» на Покровке, 99, м. Китай-город.'],
  [302, '2026-10-13T10:00:00+00:00', '30 октября — джаз в «Тестовом зале», Малый Примерный пер., 3.'],
]);
const SPB_PAGE = page(SPB_CH, [
  [501, '2026-10-14T09:00:00+00:00', 'Открылась кофейня «Тестовая Нева» на Большой Конюшенной, 99, м. Невский проспект.'],
  [502, '2026-10-14T10:00:00+00:00', '30 октября — джаз в «Тестовом зале», Литейный пр., 99.'],
  [503, '2026-10-14T11:00:00+00:00', 'Кофейня «Черновик» закрылась навсегда, вчера был последний день.'],
]);
const SPB_EXTRA = PLACES_SPB_JS.replace(/'spb-kofe'[^\n]*\n/, '');
const MSK_EXTRA = `
;(function (K) {
  K.places.chernovik = { name: 'Черновик', kind: 'Кофейня', emoji: '☕', addr: 'Примерная ул., 5', metro: 'Китай-город',
    lat: 55.7566, lon: 37.6335, price: 1, okr: 'center', cat: 'coffee', note: 'Тестовая кофейня.' };
  // московский двойник с адресом петербургского места: имя + дом совпадают, координаты — нет
  K.places['testovaya-neva-dvoynik'] = { name: 'Тестовая Нева', kind: 'Кофейня', emoji: '☕', addr: 'Большая Конюшенная ул., 99', metro: 'Китай-город',
    lat: 55.7570, lon: 37.6340, price: 1, okr: 'center', cat: 'coffee', note: 'Тестовый двойник.' };
})(window.KUDA);
`;

async function makeRepo(dir) {
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
  const src = f => path.join(ROOT, 'assets', f);
  await fs.writeFile(path.join(dir, 'assets/places.js'), readFileSync(src('places.js'), 'utf8') + MSK_EXTRA);
  await fs.writeFile(path.join(dir, 'assets/places-spb.js'), SPB_EXTRA);
  for (const f of ['geo.js', 'photos.js', 'events.js', 'events-spb.js', 'sport.js', 'auto.js']) await fs.copyFile(src(f), path.join(dir, 'assets', f));
  return dir;
}

const nominatimHit = (lat, lon, house, road, district, city) => ({
  lat: String(lat), lon: String(lon), addresstype: 'building', place_rank: 30, display_name: `${house}, ${road}, ${city}`,
  address: { house_number: house, road, city_district: district, city, state: city },
});

function makeFetch(calls, spbPage = SPB_PAGE) {
  return async url => {
    const u = new URL(url);
    calls.push(u);
    const html = s => new Response(s, { status: 200, headers: { 'content-type': 'text/html' } });
    const json = o => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.hostname === 't.me') {
      if (u.searchParams.get('before')) return html('<html><body><section class="tgme_channel_history"></section></body></html>');
      if (u.pathname === `/s/${MSK_CH}`) return html(MSK_PAGE);
      if (u.pathname === `/s/${SPB_CH}`) return html(spbPage);
      return new Response('not found', { status: 404 });
    }
    if (u.hostname === 'nominatim.openstreetmap.org') {
      const q = u.searchParams.get('q') || '', spb = u.searchParams.get('viewbox') === '29.425,60.245,30.76,59.633';
      if (!spb && /Покровка/.test(q)) return json([nominatimHit(55.759012, 37.645031, '99', 'улица Покровка', 'Басманный район', 'Москва')]);
      if (!spb && /Примерный/.test(q)) return json([nominatimHit(55.754105, 37.640112, '3', 'Малый Примерный переулок', 'Басманный район', 'Москва')]);
      if (spb && /Конюшенная/.test(q)) return json([nominatimHit(59.937, 30.326, '99', 'Большая Конюшенная улица', 'Центральный район', 'Санкт-Петербург')]);
      if (spb && /Литейный/.test(q)) return json([nominatimHit(59.9400, 30.3480, '99', 'Литейный проспект', 'Центральный район', 'Санкт-Петербург')]);
      return json([]);
    }
    throw new Error(`тест: неожиданный запрос ${u.hostname}`);
  };
}

const msg = data => ({ type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(data) }],
  stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
const BASE = { match_id: '', name: '', kind: '', cat: '', address: '', area: '', price: 1, hours: '', note_ru: '', fit: [], hints: [],
  adult: false, event: null, confidence: 0.9, reason: '' };

function stubClient(seen) {
  return { beta: { messages: { async create(body) {
    const props = Object.keys(body.output_config.format.schema.properties);
    const content = body.messages[0].content;
    if (props.includes('items')) {
      const items = [];
      for (const [, ref, city, text] of content.matchAll(/<post key="(p\d+)" date="[^"]*"(?: city="([^"]*)")?>\n([\s\S]*?)\n<\/post>/g)) {
        seen.push([city, text.slice(0, 30)]);
        const spb = city === 'Петербург';
        const it = o => items.push({ ...BASE, post_key: ref, ...o });           // без поля city: город — от источника
        if (/Тестовая Нева/.test(text)) {
          const area = (/м\. [А-ЯЁ][а-яё-]+(?: [а-яё-]+)?/.exec(text) || [''])[0];
          const addr = /Пушкин/.test(text) ? 'Пушкин, Большая Конюшенная ул., 99' : spb ? 'Большая Конюшенная ул., 99' : 'ул. Покровка, 99';
          it({ type: 'new_place', name: 'Тестовая Нева', kind: 'Кофейня', cat: 'coffee', fit: ['date', 'girls'], address: addr, area,
            note_ru: 'Небольшая кофейня с собственной обжаркой — хороша, чтобы начать прогулку.', reason: 'открытие' });
        } else if (/джаз/.test(text)) {
          it({ type: 'event', name: 'Тестовый зал', kind: 'Концертный зал', cat: 'culture', fit: ['date'],
            note_ru: 'Вечер живого джаза в камерном зале — тихий концерт вдвоём.', reason: 'концерт с датой',
            event: { title: 'Джаз в Тестовом зале', cat: 'concert', start: '2026-10-30', end: '2026-10-30', dates: [], time: '20:00',
              venue: 'Тестовый зал', address: spb ? 'Литейный пр., 99' : 'Малый Примерный пер., 3', price_from: null, price_to: null, age: '',
              url: spb ? 'https://example.org/spb-jazz' : 'https://example.org/msk-jazz' } });
        } else if (/Черновик/.test(text)) {
          // модель ошиблась: сопоставила с московской кофейней — закрывать её нельзя
          it({ type: 'closure', match_id: 'chernovik', name: 'Черновик', kind: 'Кофейня', confidence: 0.95, reason: 'закрылась' });
        } else it({ type: 'irrelevant' });
      }
      return msg({ items });
    }
    if (props.includes('plans')) {
      seen.push(['plans', content]);
      const lines = content.split('\n');
      const newId = lines[1].split('|')[0];
      const near = lines.slice(lines.findIndex(l => l.startsWith('Места рядом')) + 1).filter(l => l.includes('|')).map(l => l.split('|'));
      const walk = near.find(n => n[3] === 'walk');
      const plans = [{ mode: 'girls', emoji: '☕', title: 'Кофе с подругой', stops: [newId], when: 'утро', tags: [], why: 'Неспешное утро в новой кофейне.' }];
      if (walk) plans.push({ mode: 'date', emoji: '🍂', title: 'Сад и кофе', stops: [walk[0], newId], when: 'день', tags: ['autumn'], why: 'Прогулка, а потом кофе в паре минут пешком.' });
      return msg({ plans });
    }
    throw new Error('тест: неизвестный запрос к модели');
  } } } };
}

test('сквозной прогон: каналы Москвы и Петербурга — места, события и подборки каждый в своём городе', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kuda-2cities-'));
  tmpDirs.push(tmp);
  const repo = await makeRepo(path.join(tmp, 'repo'));
  const state = path.join(tmp, 'state');
  await fs.mkdir(state, { recursive: true });
  await fs.writeFile(path.join(state, 'sources.json'), JSON.stringify({ telegram: [MSK_CH], cities: { spb: { telegram: [SPB_CH] } } }));
  const calls = [], seen = [], lines = [], logs = [];
  const r = await main(['--repo', repo, '--state', state, '--report', path.join(state, 'report.md'), '--inbox-out', path.join(state, 'inbox.json'),
    '--today', TODAY, '--no-photos'], { fetchImpl: makeFetch(calls), llmClient: stubClient(seen), env: {}, tgDelayMs: 0, geoIntervalMs: 0,
    out: l => lines.push(l), log: l => logs.push(l) });
  assert.equal(r.changes, 1);

  // модель видит город источника у каждого поста
  assert.deepEqual(seen.filter(([c]) => c !== 'plans').map(([c]) => c), ['Москва', 'Москва', 'Петербург', 'Петербург', 'Петербург']);

  const data = parseAutoJs(readFileSync(path.join(repo, 'assets/auto.js'), 'utf8'));
  const merged0 = await loadCatalog(repo);
  // одно имя в двух городах — два разных места; московский «двойник» с тем же домом петербургское место не поглотил
  assert.deepEqual(Object.keys(data.places).sort(), ['spb-testovaya-neva', 'testovaya-neva']);
  const m = data.places['testovaya-neva'], s = data.places['spb-testovaya-neva'];
  assert.equal(m.city, undefined);
  assert.equal(m.metro, nearestMetro(m.lat, m.lon, merged0.stations).name, 'ближайшая станция Москвы');
  assert.equal(s.metro, nearestMetro(s.lat, s.lon, merged0.cityStations.spb).name, 'ближайшая станция Петербурга');
  assert.equal(s.city, 'spb');
  assert.equal(s.metro, 'Невский проспект', 'станция из FIXED_SPB');
  assert.equal(s.okr, 'center');
  assert.equal(s.addr, 'Большая Конюшенная ул., 99');
  assert.ok(!r.res.updates.some(u => u.id === 'testovaya-neva-dvoynik'), 'не «обновление» московского двойника');

  // геокодер Петербурга — в рамке Петербурга
  const osm = calls.filter(u => u.hostname === 'nominatim.openstreetmap.org');
  assert.ok(osm.some(u => /Конюшенная.*Санкт-Петербург/.test(u.searchParams.get('q')) && u.searchParams.get('viewbox') === '29.425,60.245,30.76,59.633'));
  assert.ok(osm.some(u => /Покровка.*Москва/.test(u.searchParams.get('q')) && u.searchParams.get('viewbox') === '36.8,56.1,38.3,55.1'));

  // одинаковые события в один день в двух городах — оба добавлены, у петербургского ev-spb- и city
  const ev = Object.fromEntries(data.events.map(e => [e.id, e]));
  assert.deepEqual(Object.keys(ev).sort(), ['ev-dzhaz-v-testovom-zale-testovyy-zal-20261030', 'ev-spb-dzhaz-v-testovom-zale-testovyy-zal-20261030']);
  assert.equal(ev['ev-spb-dzhaz-v-testovom-zale-testovyy-zal-20261030'].city, 'spb');
  assert.ok(ev['ev-spb-dzhaz-v-testovom-zale-testovyy-zal-20261030'].lat > 59);
  assert.equal(ev['ev-dzhaz-v-testovom-zale-testovyy-zal-20261030'].city, undefined);

  // закрытие из петербургского поста не трогает московскую кофейню с тем же именем
  assert.deepEqual(data.closed, []);
  assert.ok(r.res.rejected.some(x => /закрытие: места нет в каталоге/.test(x.reason)));

  // подборки: в Петербурге spb-<режим>-auto-…, с полем city, только из мест Петербурга
  const merged = await loadCatalog(repo);
  const spbPlans = data.scenarios.filter(x => x.city === 'spb');
  const mskPlans = data.scenarios.filter(x => !x.city);
  assert.ok(spbPlans.length >= 2 && mskPlans.length >= 1);
  for (const sc of spbPlans) {
    assert.match(sc.id, /^spb-[dgw]-auto-[a-z0-9-]+$/);
    assert.ok(sc.stops.every(id => placeCity(id, merged.places[id]) === 'spb'), sc.stops.join(','));
    assert.ok(validatePlan(sc, merged).ok);
  }
  for (const sc of mskPlans) assert.match(sc.id, /^auto-(date|guys|girls)-/);
  assert.ok(spbPlans.some(sc => sc.stops.includes('spb-sad')), 'сосед — петербургский сад из places-spb.js');
  const planReqs = seen.filter(([c]) => c === 'plans').map(([, t]) => t);
  assert.ok(planReqs.some(t => t.includes('spb-testovaya-neva|') && t.endsWith('Город: Петербург.') && !/\nchernovik\|/.test(t)));

  // отчёт: город и районы Петербурга
  const report = readFileSync(path.join(state, 'report.md'), 'utf8');
  assert.match(report, /По городам: Москва — мест 1, закрытий 0, событий 1, подборок \d+ · Петербург — мест 1, закрытий 0, событий 1, подборок \d+/);
  assert.match(report, /\(`spb-testovaya-neva`\) — Кофейня, Петербург, Большая Конюшенная ул\., 99 · м\. Невский проспект \(\d+ м\) · Центр/);
  assert.match(report, new RegExp(`tg \`${SPB_CH}\` · Петербург — новых постов 3`));

  // сайт: петербургские записи видны в своём городе
  const read = f => readFileSync(f, 'utf8');
  const w = browser([path.join(ROOT, 'config.js'), path.join(ROOT, 'assets/shared.js'),
    ...['places.js', 'places-spb.js', 'events.js', 'events-spb.js', 'sport.js', 'auto.js'].map(f => path.join(repo, 'assets', f))].map(f => [f, read(f)]));
  assert.equal(w.DateKit.cityOf(w.KUDA.places['spb-testovaya-neva']), 'spb');
  assert.equal(w.DateKit.cityOf(w.KUDA.places['testovaya-neva']), 'msk');
  assert.ok(!w.KUDA.places.chernovik.closed);

  // имена каналов — не в данных сайта и не в логах
  const auto = readFileSync(path.join(repo, 'assets/auto.js'), 'utf8');
  for (const ch of [MSK_CH, SPB_CH]) {
    assert.ok(!auto.includes(ch));
    for (const l of [...lines, ...logs]) assert.ok(!l.includes(ch), l);
  }
  const st = JSON.parse(readFileSync(path.join(state, 'state.json'), 'utf8'));
  assert.equal(st.tg[SPB_CH], 503);
  assert.ok(Object.keys(st.geocache).some(k => k.startsWith('osm:spb:')), 'кеш геокодера Петербурга — со своим ключом');
});

test('пригород Петербурга дальше 3 км от метро — место без станции, с пометкой в отчёте', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kuda-suburb-'));
  tmpDirs.push(tmp);
  const repo = await makeRepo(path.join(tmp, 'repo'));
  const state = path.join(tmp, 'state');
  await fs.mkdir(state, { recursive: true });
  await fs.writeFile(path.join(state, 'sources.json'), JSON.stringify({ cities: { spb: { telegram: [SPB_CH] } } }));
  const base = makeFetch([], page(SPB_CH, [[601, '2026-10-14T09:00:00+00:00', 'В Пушкине открылась кофейня «Тестовая Нева», Большая Конюшенная, 99.']]));
  const fetchImpl = async url => {
    const u = new URL(url);
    if (u.hostname === 'nominatim.openstreetmap.org' && /Конюшенная/.test(u.searchParams.get('q'))) {
      // «Большая Конюшенная» в Пушкине (выдумано для теста): Пушкинский район, 10+ км до метро
      return new Response(JSON.stringify([nominatimHit(59.7160, 30.3960, '99', 'Большая Конюшенная улица', 'Пушкинский район', 'Пушкин')]), { status: 200 });
    }
    return base(url);
  };
  const r = await main(['--repo', repo, '--state', state, '--report', path.join(state, 'report.md'), '--inbox-out', path.join(state, 'inbox.json'),
    '--today', TODAY, '--no-photos', '--dry'], { fetchImpl, llmClient: stubClient([]), env: {}, tgDelayMs: 0, geoIntervalMs: 0, out: quiet, log: quiet });
  const np = r.res.places.find(p => p.id === 'spb-testovaya-neva');
  assert.ok(np, r.res.rejected.map(x => x.reason).join('; '));
  assert.equal(np.place.metro, '');
  assert.equal(np.place.okr, 'out');
  assert.match(readFileSync(path.join(state, 'report.md'), 'utf8'), /\*\*без метро\*\* \(до «[^»]+» \d+,\d км; пригород — впишите ж\/д станцию/);
});

test('отложенный пост без поля city (из прошлых запусков) получает город по нынешнему списку источников', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kuda-retry-'));
  tmpDirs.push(tmp);
  const repo = await makeRepo(path.join(tmp, 'repo'));
  const state = path.join(tmp, 'state');
  await fs.mkdir(state, { recursive: true });
  // канал пишет про оба города: у его новых постов города нет — решит модель
  await fs.writeFile(path.join(state, 'sources.json'), JSON.stringify({ telegram: [MSK_CH], cities: { spb: { telegram: [SPB_CH, MSK_CH] } } }));
  const old = { source: 'tg', channel: SPB_CH, id: 450, key: `tg:${SPB_CH}/450`, url: `https://t.me/${SPB_CH}/450`,
    date: '2026-10-12T09:00:00+00:00', text: 'Пост из прошлого запуска о новом месте без адреса.' };
  await fs.writeFile(path.join(state, 'state.json'), JSON.stringify({ tg: { [SPB_CH]: 999, [MSK_CH]: 999 }, seen: {},
    retry: { [old.key]: { post: old, n: 1 } }, geocache: {} }));
  const seen = [];
  await main(['--repo', repo, '--state', state, '--report', path.join(state, 'report.md'), '--inbox-out', path.join(state, 'inbox.json'),
    '--today', TODAY, '--no-photos', '--dry'], { fetchImpl: makeFetch([]), llmClient: stubClient(seen), env: {}, tgDelayMs: 0, geoIntervalMs: 0, out: quiet, log: quiet });
  assert.deepEqual(seen, [['Петербург', old.text.slice(0, 30)]]);
  assert.equal(normSources(JSON.parse(readFileSync(path.join(state, 'sources.json'), 'utf8'))).city[`tg:${MSK_CH}`], '', 'канал в обоих списках');
});

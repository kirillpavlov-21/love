import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  loadCatalog, parseAutoJs, parseStations, normName, nameSkeleton, distM, findMatch, parseAddr, slugId, translit,
  catOf, catalogIndex, validatePlan, nearbyPlaces, placeCity,
} from '../lib/catalog.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/* ---------- мини-репозиторий во временной папке ---------- */

const PLACES_JS = `/* тестовый каталог */
window.KUDA = {
  updated: '2026-10-01',
  places: {
    park: { name: 'Тестовый парк', kind: 'Парк', emoji: '🌳', addr: 'Тестовая ул., 1', metro: 'Арбатская', lat: 55.7520, lon: 37.6000, price: 1, okr: 'center', note: 'Парк.', tg: 'example_channel/1' },
    bistro: { name: 'Бистро Ромашка', kind: 'Бистро', emoji: '🍽️', addr: 'Тестовая ул., 5', metro: 'Арбатская', lat: 55.7530, lon: 37.6010, price: 2, okr: 'center', cat: 'food', note: 'Еда.' },
    strip: { name: 'Клуб 18', kind: 'Стриптиз-клуб · 18+', emoji: '💃', addr: 'Тестовая ул., 9', metro: 'Арбатская', lat: 55.7535, lon: 37.6020, price: 3, okr: 'center', note: '18+', adult: true, a18: 'strip' },
  },
  scenarios: [
    { id: 'd-1', mode: 'date', emoji: '🌳', title: 'Парк и ужин', stops: ['park', 'bistro'], when: 'вечер', why: 'Тест.' },
    { id: 'd-2', mode: 'date', emoji: '🍽️', title: 'Только ужин', stops: ['bistro'], when: 'вечер', why: 'Тест.' },
  ],
  adult: ['strip'],
};`;
const GEO_JS = `(function () {
  'use strict';
  const FIXED = {
    'Арбатская': [55.7520, 37.6038], 'Смоленская': [55.7481, 37.5823],
  };
  window.KudaGeo = { FIXED_COUNT: Object.keys(FIXED).length };
})();`;
const EVENTS_JS = `window.KUDA_EVENTS = [
  { id: 'ev-test', title: 'Концерт', cat: 'concert', start: '2026-10-20', end: '2026-10-20', venue: 'Зал', addr: 'Тестовая ул., 3', lat: 55.75, lon: 37.6, url: 'https://example.org', note: 'Тест.' },
];`;
const AUTO_JS = `/* Сгенерировано pipeline/run.mjs — не править руками: изменения придут следующим запуском. */
(function (A) {
  var K = window.KUDA; if (!K) return;
  Object.keys(A.places).forEach(function (id) { if (!K.places[id]) K.places[id] = A.places[id]; });
})({
  "updated": "2026-10-15",
  "places": {
    "kofe-novy": { "name": "Кофе Новый", "kind": "Кофейня", "emoji": "☕", "addr": "Тестовая ул., 7", "metro": "Арбатская", "lat": 55.7525, "lon": 37.6005, "price": 1, "okr": "center", "cat": "coffee", "note": "Новая кофейня.", "added": "2026-10-15" },
    "bistro": { "name": "Подмена", "kind": "Бар", "lat": 1, "lon": 1 }
  },
  "scenarios": [ { "id": "a-1", "mode": "date", "emoji": "☕", "title": "Кофе и парк", "stops": ["kofe-novy", "park"], "when": "утро", "why": "Тест." } ],
  "events": [ { "id": "ev-test", "title": "Дубль" }, { "id": "ev-auto", "title": "Выставка", "cat": "exhibition", "start": "2026-10-16", "end": "2026-11-01" } ],
  "closed": ["park", "strip"]
});`;

async function fixtureRepo(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kuda-cat-'));
  await fs.mkdir(path.join(dir, 'assets'));
  for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(dir, 'assets', name), text);
  return dir;
}

test('loadCatalog: только places.js и geo.js — events и auto пустые', async () => {
  const dir = await fixtureRepo({ 'places.js': PLACES_JS, 'geo.js': GEO_JS });
  try {
    const c = await loadCatalog(dir);
    assert.equal(Object.keys(c.places).length, 3);
    assert.equal(c.scenarios.length, 2);
    assert.deepEqual(c.events, []);
    assert.deepEqual(c.adult, ['strip']);
    assert.deepEqual(c.auto, { updated: '', places: {}, scenarios: [], events: [], closed: [], buzz: {} });
    assert.deepEqual(c.stations, { 'Арбатская': [55.7520, 37.6038], 'Смоленская': [55.7481, 37.5823] });
    assert.equal(c.updated, '2026-10-01');
    // обычные объекты, а не из песочницы vm
    assert.equal(Object.getPrototypeOf(c.places), Object.prototype);
    assert.ok(!('tg' in c.places.park), 'старое поле tg не переносим');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('loadCatalog: auto.js добавляет места, планы и события, закрывает места', async () => {
  const dir = await fixtureRepo({ 'places.js': PLACES_JS, 'geo.js': GEO_JS, 'events.js': EVENTS_JS, 'auto.js': AUTO_JS });
  try {
    const c = await loadCatalog(dir);
    assert.equal(c.auto.updated, '2026-10-15');
    assert.ok(c.places['kofe-novy'], 'место из auto.js добавлено');
    assert.equal(c.places.bistro.name, 'Бистро Ромашка', 'существующий id не перезаписан');
    assert.equal(c.places.park.closed, true);
    assert.equal(c.places.strip.closed, true);
    assert.deepEqual(c.adult, [], 'закрытое 18+ убрано из adult');
    // планы с закрытым парком пропали, план без него остался
    assert.deepEqual(c.scenarios.map(s => s.id), ['d-2']);
    assert.deepEqual(c.events.map(e => e.id), ['ev-test', 'ev-auto']);
    assert.equal(c.events[0].title, 'Концерт', 'существующее событие не перезаписано');
    assert.deepEqual(c.auto.closed, ['park', 'strip']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('loadCatalog: понятная ошибка без places.js', async () => {
  const dir = await fixtureRepo({ 'geo.js': GEO_JS });
  try { await assert.rejects(loadCatalog(dir), /places\.js/); } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('parseAutoJs: JSON, JS-литерал и вариант с window.KUDA_AUTO', () => {
  assert.equal(parseAutoJs(AUTO_JS).places['kofe-novy'].cat, 'coffee');
  const js = `(function (A) { if (x})(y) {} })({ updated: '2026-10-15', places: {}, scenarios: [], events: [], closed: ['a'] });`;
  assert.deepEqual(parseAutoJs(js).closed, ['a']);
  const glob = `window.KUDA_AUTO = { updated: '2026-10-14', places: { a: { name: 'A' } } };`;
  const d = parseAutoJs(glob);
  assert.equal(d.updated, '2026-10-14');
  assert.deepEqual(d.events, []);
  assert.throws(() => parseAutoJs('/* пусто */'), /auto\.js/);
});

test('parseStations: таблица FIXED из geo.js', () => {
  assert.equal(Object.keys(parseStations(GEO_JS)).length, 2);
  assert.throws(() => parseStations('const X = 1;'), /FIXED/);
});

/* ---------- настоящий каталог ---------- */

test('настоящий каталог: больше 700 мест, станции, планы проходят проверку', async t => {
  const c = await loadCatalog(REPO);
  assert.ok(Object.keys(c.places).length > 700, `мест ${Object.keys(c.places).length}`);
  assert.ok(c.scenarios.length > 300, `планов ${c.scenarios.length}`);
  assert.ok(Object.keys(c.stations).length > 150, `станций ${Object.keys(c.stations).length}`);
  assert.ok(c.adult.length > 10);
  for (const [id, p] of Object.entries(c.places)) {
    assert.ok(p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon), `место ${id} без имени или координат`);
  }
  const fails = c.scenarios.map(s => [s, validatePlan(s, c)]).filter(([, r]) => !r.ok);
  for (const [s, r] of fails) t.diagnostic(`${s.id}: ${r.errors.join('; ')}`);
  const share = 1 - fails.length / c.scenarios.length;
  assert.ok(share >= 0.95, `проходят ${(share * 100).toFixed(1)} % планов`);
});

test('настоящий каталог: findMatch не путает места между собой и находит их со сдвигом', async () => {
  const c = await loadCatalog(REPO);
  const dups = [];
  for (const [id, p] of Object.entries(c.places)) {
    const others = { ...c.places };
    delete others[id];
    const m = findMatch({ name: p.name, lat: p.lat, lon: p.lon, addr: p.addr, kind: p.kind, cat: p.cat }, others);
    if (m) dups.push(`${id} → ${m.id} (${m.by})`);
  }
  assert.deepEqual(dups, [], 'места каталога не должны совпадать друг с другом');
  let wrong = 0, miss = 0;
  for (const [id, p] of Object.entries(c.places)) {
    const m = findMatch({ name: p.name, lat: p.lat + 0.0012, lon: p.lon, cat: p.cat }, c);         // ~130 м к северу
    if (!m) miss++; else if (m.id !== id) wrong++;
  }
  assert.equal(wrong, 0);
  assert.equal(miss, 0);
  // только имя и адрес, без координат: у мест с номером дома (в своём городе — у сетей точки есть в обоих)
  let withHouse = 0, found = 0;
  for (const [id, p] of Object.entries(c.places)) {
    const a = parseAddr(p.addr);
    if (!a || !a.house) continue;
    withHouse++;
    const m = findMatch({ name: p.name, addr: p.addr, city: placeCity(id, p) }, c);
    if (m && m.id === id) found++;
  }
  assert.ok(withHouse > 650);
  assert.equal(found, withHouse);
});

/* ---------- имена ---------- */

test('normName: регистр, ё, кавычки, пунктуация, слова-типы', () => {
  assert.equal(normName('Ресторан «Ёлка»'), 'елка');
  assert.equal(normName('Кафе "Пушкинъ"'), 'пушкинъ');
  assert.equal(normName('Erwin. Патрики'), 'erwin патрики');
  assert.equal(normName('Mátes'), 'mates');
  assert.equal(normName('Винный бар Single'), 'single');
  assert.equal(normName('Кофейня'), 'кофейня', 'имя целиком из слова-типа не пропадает');
  assert.equal(normName('Bulletbar'), 'bulletbar', 'части слов не трогаем');
  assert.equal(normName('Барашка'), 'барашка');
  assert.equal(normName(''), '');
});

test('nameSkeleton: кириллица и латиница сходятся', () => {
  assert.equal(nameSkeleton('Кофемания'), nameSkeleton('Coffeemania'));
  assert.equal(nameSkeleton('Красота'), nameSkeleton('Krasota'));
});

test('distM: гаверсинус, массивы, нет координат', () => {
  assert.ok(Math.abs(distM({ lat: 55, lon: 37 }, { lat: 56, lon: 37 }) - 111195) < 50);
  assert.ok(Math.abs(distM([55.7520, 37.6038], [55.7481, 37.5823]) - 1420) < 30);
  assert.equal(distM({ lat: 55.75, lon: 37.6 }, { lat: 55.75, lon: 37.6 }), 0);
  assert.equal(distM({ lat: 55.75 }, { lat: 55.75, lon: 37.6 }), Infinity);
});

test('parseAddr: разные записи одного адреса', () => {
  const k = a => { const r = parseAddr(a); return r && `${r.street}|${r.house}|${r.bld}`; };
  assert.equal(k('ул. Большая Никитская, д. 23/14, стр. 1'), k('Большая Никитская ул., 23/14с1'));
  assert.equal(k('Москва, Большая Никитская улица, 23'), 'б никитская|23|');
  assert.equal(k('ул. Марксистская, 34к7'), k('Марксистская ул., 34, корп. 7'));
  assert.equal(k('3-я ул. Ямского Поля, 15'), k('Ямского Поля 3-я ул., д. 15'));
  assert.equal(k('Пятницкая 3'), 'пятницкая|3|');
  assert.equal(k('Земляной Вал, 9А'), 'вал земляной|9а|');
  assert.equal(k('Химки, Совхозная ул., вл. 14/1 (парк «Эко-Берег»)'), 'совхозная|14|');
  assert.equal(k('причал у гостиницы «Украина», Кутузовский пр., 2/1'), 'кутузовский|2|');
  assert.equal(k('ул. 1905 года, 10А'), '1905 года|10а|');
  assert.equal(k('Тверская ул.'), 'тверская||');
  assert.equal(parseAddr(''), null);
});

/* ---------- поиск совпадений ---------- */

const MINI = {
  'kofemania-nikitskaya': { name: 'Кофемания на Никитской', kind: 'Ресторан', cat: 'food', addr: 'Большая Никитская ул., 13/6', lat: 55.756120, lon: 37.608850 },
  'kofemania-pokrovka': { name: 'Кофемания на Покровке', kind: 'Ресторан', cat: 'food', addr: 'ул. Покровка, 17', lat: 55.759500, lon: 37.646200 },
  krasota: { name: 'Krasota', kind: 'Гастротеатр', cat: 'food', addr: 'Романов пер., 2, стр. 1', lat: 55.752998, lon: 37.607841 },
  'raketa-bistro': { name: 'Ракета Бистро', kind: 'Бистро', cat: 'food', addr: 'ул. Лужники, 24, стр. 21', lat: 55.712615, lon: 37.566622 },
  'raketa-club': { name: 'Ракета Клуб', kind: 'Падел-клуб', cat: 'fun', addr: 'ул. Лужники, 24, стр. 35', lat: 55.712615, lon: 37.566622 },
  'gorky-park': { name: 'Парк Горького', kind: 'Парк', cat: 'walk', addr: 'ул. Крымский Вал, 9', lat: 55.729875, lon: 37.603831 },
  planetarium: { name: 'Московский планетарий', kind: 'Планетарий', cat: 'culture', addr: 'Садовая-Кудринская ул., 5, стр. 1', lat: 55.761302, lon: 37.583806 },
  'mates-1': { name: 'Mátes', kind: 'Бистро', cat: 'food', addr: 'Малая Бронная ул., 20', lat: 55.7620, lon: 37.5940 },
  'mates-2': { name: 'Mátes', kind: 'Бистро', cat: 'food', addr: 'ул. Шаболовка, 20', lat: 55.7200, lon: 37.6090 },
};

test('findMatch: сеть «Кофемания» — филиал по расстоянию или адресу', () => {
  let m = findMatch({ name: 'Кофемания', lat: 55.75625, lon: 37.60900 }, MINI);
  assert.equal(m.id, 'kofemania-nikitskaya');
  assert.equal(m.by, 'branch+300m');
  m = findMatch({ name: 'Кофемания', addr: 'ул. Большая Никитская, д. 13/6' }, MINI);
  assert.equal(m.id, 'kofemania-nikitskaya');
  m = findMatch({ name: 'Coffeemania', lat: 55.7596, lon: 37.6461 }, MINI);
  assert.equal(m && m.id, 'kofemania-pokrovka', 'латиницей тоже');
  // другой филиал далеко — не совпадение, а новое место
  assert.equal(findMatch({ name: 'Кофемания', lat: 55.7400, lon: 37.5300 }, MINI), null);
  // без координат и адреса имя сети неоднозначно
  assert.equal(findMatch({ name: 'Кофемания' }, MINI), null);
  // обратное направление: в каталоге короткое имя, у кандидата — с филиалом
  m = findMatch({ name: 'Krasota на Арбате', lat: 55.7531, lon: 37.6080 }, MINI);
  assert.equal(m && m.id, 'krasota');
});

test('findMatch: точное имя, транслит, опечатка, слова, адрес', () => {
  assert.equal(findMatch({ name: 'Krasota', lat: 55.7530, lon: 37.6078 }, MINI).by, 'name+300m');
  assert.equal(findMatch({ name: 'Красота', lat: 55.7531, lon: 37.6079 }, MINI).id, 'krasota');
  assert.equal(findMatch({ name: 'Красота', addr: 'Романов переулок, д. 2, строение 1' }, MINI).id, 'krasota');
  assert.equal(findMatch({ name: 'Красота', addr: 'Романов пер., 2, стр. 5' }, MINI), null, 'другое строение');
  const typo = findMatch({ name: 'Кофемания на Никитскои', lat: 55.7562, lon: 37.6089 }, MINI);
  assert.equal(typo.id, 'kofemania-nikitskaya');
  assert.equal(findMatch({ name: 'Планетарий', lat: 55.7614, lon: 37.5839 }, MINI).id, 'planetarium');
  assert.equal(findMatch({ name: 'Планетарий', lat: 55.7650, lon: 37.5839 }, MINI), null, '400 м — слишком далеко для неполного имени');
  const far = findMatch({ name: 'Krasota', lat: 55.7600, lon: 37.6078 }, MINI);
  assert.equal(far, null, '780 м — уже другое место');
});

test('findMatch: соседи в одном комплексе и общие слова не склеиваются', () => {
  // бистро при клубе: одна точка, похожие имена, но разделы разные
  assert.equal(findMatch({ name: 'Ракета', lat: 55.712615, lon: 37.566622, cat: 'fun' }, MINI).id, 'raketa-club');
  assert.equal(findMatch({ name: 'Ракета', lat: 55.712615, lon: 37.566622, kind: 'Бистро' }, MINI).id, 'raketa-bistro');
  assert.equal(findMatch({ name: 'Ракета Бар', lat: 55.712615, lon: 37.566622, cat: 'bar' }, MINI).id, 'raketa-bistro');
  // «Парк» — слишком общее слово для филиала
  assert.equal(findMatch({ name: 'Парк', lat: 55.7299, lon: 37.6038 }, MINI), null);
  // два филиала с одинаковым именем: без координат не угадываем, с координатами — ближний
  assert.equal(findMatch({ name: 'Mates' }, MINI), null);
  assert.equal(findMatch({ name: 'Mates', lat: 55.7201, lon: 37.6091 }, MINI).id, 'mates-2');
  // одно место с таким именем, без координат — слабое совпадение
  const weak = findMatch({ name: 'Московский планетарий' }, MINI);
  assert.equal(weak.id, 'planetarium');
  assert.equal(weak.score, 0.6);
  assert.equal(findMatch({ name: '' }, MINI), null);
});

test('findMatch: принимает и весь каталог, и словарь мест', () => {
  const m1 = findMatch({ name: 'Krasota', lat: 55.753, lon: 37.6078 }, { places: MINI, scenarios: [] });
  const m2 = findMatch({ name: 'Krasota', lat: 55.753, lon: 37.6078 }, MINI);
  assert.deepEqual(m1, m2);
});

/* ---------- id ---------- */

test('slugId: транслитерация и уникальность', () => {
  assert.equal(translit('жхцчшщюяйёыьъ'), 'zhkhtschshshchyuyayey');
  assert.equal(slugId('Щука и Жаба'), 'shchuka-i-zhaba');
  assert.equal(slugId('Чайхона №1'), 'chaykhona-1');
  assert.equal(slugId('Объект 35'), 'obekt-35');
  assert.equal(slugId('Мёд & Рысь'), 'med-and-rys');
  assert.equal(slugId('Юность ёлки'), 'yunost-elki');
  assert.equal(slugId('Mátes Patriki'), 'mates-patriki');
  assert.equal(slugId('«Кафе Пушкинъ»'), 'kafe-pushkin');
  assert.equal(slugId('!!!'), 'place');
  assert.equal(slugId('Кофемания', new Set(['kofemaniya'])), 'kofemaniya-2');
  assert.equal(slugId('Кофемания', new Set(['kofemaniya', 'kofemaniya-2'])), 'kofemaniya-3');
  assert.equal(slugId('Кофемания', { kofemaniya: {} }), 'kofemaniya-2');
  assert.equal(slugId('Кофемания', ['kofemaniya']), 'kofemaniya-2');
  const long = slugId('Очень длинное название ресторана с террасой на крыше у самой реки');
  assert.ok(long.length <= 40 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(long), long);
});

/* ---------- разделы ---------- */

test('catOf: типы мест', () => {
  assert.equal(catOf('Компьютерный клуб'), 'pc');
  assert.equal(catOf('Кофейня'), 'coffee');
  assert.equal(catOf('Винный бар'), 'bar');
  assert.equal(catOf('Парк'), 'walk');
  assert.equal(catOf('Музей'), 'culture');
  assert.equal(catOf('Караоке'), 'fun');
  assert.equal(catOf('Баня на дровах'), 'spa');
  assert.equal(catOf('Книжный с кафе'), 'books');
  assert.equal(catOf('Ресторан'), 'food');
  assert.equal(catOf('Испанский ресторан и бар'), 'bar', '«спа» внутри слова — не спа');
  assert.equal(catOf(''), 'food');
  assert.equal(catOf({ kind: 'Парк', cat: 'fun' }), 'fun', 'у места явный cat важнее');
});

test('catOf совпадает с CAT_BY_KIND из assets/shared.js (кроме исправленного «спа» внутри слова)', async () => {
  const shared = await fs.readFile(path.join(REPO, 'assets/shared.js'), 'utf8');
  const m = /const CAT_BY_KIND = (\[[\s\S]*?\]);/.exec(shared);
  assert.ok(m, 'нашёл CAT_BY_KIND в shared.js');
  const table = vm.runInNewContext(m[1]);
  const siteCat = kind => (table.find(([, rx]) => rx.test(kind)) || ['food'])[0];
  const c = await loadCatalog(REPO);
  const kinds = [...new Set(Object.values(c.places).map(p => p.kind))];
  const diff = kinds.filter(k => siteCat(k) !== catOf(k));
  assert.ok(diff.every(k => /спа|бан/i.test(k) && siteCat(k) === 'spa'), diff.join(', '));
});

/* ---------- индекс ---------- */

test('catalogIndex: строки id|name|kind|addr по id, без переносов и «|»', () => {
  const idx = catalogIndex({ places: {
    b: { name: 'Бэ | бар', kind: 'Бар', addr: 'ул. Б,\n1' },
    a: { name: 'А', kind: 'Кафе', addr: 'ул. А, 1', closed: true },
  } });
  assert.equal(idx, 'a|А|Кафе (закрыто)|ул. А, 1\nb|Бэ бар|Бар|ул. Б, 1');
  assert.equal(catalogIndex(MINI), catalogIndex({ places: MINI }), 'стабилен');
  assert.equal(catalogIndex(MINI).split('\n').length, Object.keys(MINI).length);
});

/* ---------- проверка планов ---------- */

const P = {
  park: { name: 'Парк', kind: 'Парк', cat: 'walk', lat: 55.7500, lon: 37.6000 },
  museum: { name: 'Музей', kind: 'Музей', cat: 'culture', lat: 55.7510, lon: 37.6010 },
  rest: { name: 'Ресторан', kind: 'Ресторан', cat: 'food', lat: 55.7520, lon: 37.6020 },
  rest2: { name: 'Ресторан 2', kind: 'Грузинский ресторан', cat: 'food', lat: 55.7525, lon: 37.6025 },
  wine: { name: 'Вино', kind: 'Винный бар', cat: 'bar', lat: 55.7530, lon: 37.6030 },
  bar: { name: 'Бар', kind: 'Коктейльный бар', cat: 'bar', lat: 55.7531, lon: 37.6031 },
  coffee: { name: 'Кофе', kind: 'Кофейня', cat: 'coffee', lat: 55.7495, lon: 37.5995 },
  karaoke: { name: 'Караоке', kind: 'Караоке', cat: 'fun', lat: 55.7535, lon: 37.6035 },
  far: { name: 'Далеко', kind: 'Парк', cat: 'walk', lat: 55.8000, lon: 37.6000 },
  closed: { name: 'Закрыто', kind: 'Кафе', cat: 'food', lat: 55.7500, lon: 37.6000, closed: true },
  oceanarium: { name: 'Океанариум', kind: 'Океанариум', lat: 55.7505, lon: 37.6005 },
  strip: { name: 'Клуб', kind: 'Стриптиз-клуб · 18+', adult: true, a18: 'strip', lat: 55.7536, lon: 37.6036 },
  men: { name: 'Шоу', kind: 'Мужской стриптиз · 18+', adult: true, a18: 'men', lat: 55.7537, lon: 37.6037 },
  burl: { name: 'Кабаре', kind: 'Бурлеск-шоу · 18+', adult: true, a18: 'show', lat: 55.7538, lon: 37.6038 },
};
const plan = (mode, stops, tags) => ({ id: 'x', mode, emoji: '✨', title: 'T', stops, when: 'вечер', tags, why: 'тест' });
const errs = (mode, stops, tags) => validatePlan(plan(mode, stops, tags), P).errors;

test('validatePlan: хорошие планы', () => {
  assert.deepEqual(errs('date', ['park', 'rest']), []);
  assert.deepEqual(errs('date', ['museum', 'rest', 'bar']), []);
  assert.deepEqual(errs('girls', ['coffee', 'park']), [], 'кофе с собой перед прогулкой');
  assert.deepEqual(errs('girls', ['wine', 'karaoke']), [], 'караоке после вина — вечернее развлечение');
  assert.deepEqual(errs('date', ['oceanarium', 'park']), [], 'непонятный тип без cat — не еда');
  assert.deepEqual(errs('guys', ['park', 'far'], ['drive']), [], 'с тегом drive далеко можно');
  assert.deepEqual(errs('date', ['rest']), []);
  assert.ok(validatePlan(plan('date', ['park', 'rest']), { places: P }).ok, 'принимает и весь каталог');
});

test('validatePlan: нарушения правил', () => {
  const has = (list, rx) => assert.ok(list.some(e => rx.test(e)), list.join('; ') || '(нет ошибок)');
  has(errs('date', ['park', 'far']), /переход park → far: \d+ м > 1600/);
  has(errs('date', ['rest', 'rest2']), /два ужина подряд/);
  has(errs('date', ['rest', 'wine']), /винный бар wine после ресторана/);
  has(errs('date', ['rest', 'bar', 'wine']), /винный бар wine после ресторана/);
  has(errs('date', ['rest', 'park']), /park .* после еды или бара/);
  has(errs('date', ['bar', 'museum']), /museum .* после еды или бара/);
  has(errs('date', ['park', 'nope']), /нет места nope/);
  has(errs('date', ['closed']), /закрыто/);
  has(errs('date', []), /остановок 0/);
  has(errs('date', ['park', 'museum', 'coffee', 'rest']), /остановок 4/);
  has(errs('date', ['park', 'park']), /дважды/);
  has(errs('party', ['park']), /mode/);
  has(errs('date', ['strip']), /18\+ strip на свидании/);
  has(errs('guys', ['men']), /мужской стриптиз men только для режима girls/);
  has(errs('date', ['men']), /мужской стриптиз/);
  assert.deepEqual(errs('date', ['burl']), [], 'бурлеск на свидании можно');
  assert.deepEqual(errs('girls', ['rest', 'men']), []);
  assert.deepEqual(errs('guys', ['bar', 'strip']), []);
  assert.equal(validatePlan(null, P).ok, false);
});

test('validatePlan: 18+ из списка adult каталога, даже без флага у места', () => {
  const places = { a: { name: 'A', kind: 'Клуб', cat: 'fun', lat: 55.75, lon: 37.6 } };
  assert.equal(validatePlan(plan('date', ['a']), { places, adult: ['a'] }).ok, false);
  assert.equal(validatePlan(plan('date', ['a']), places).ok, true);
});

/* ---------- соседи ---------- */

test('nearbyPlaces: ближние первыми, без самого места, 18+ и закрытых', () => {
  const near = nearbyPlaces({ id: 'park', lat: 55.7500, lon: 37.6000 }, { places: P, adult: [] }, 1200, 25);
  const ids = near.map(x => x.id);
  assert.ok(!ids.includes('park') && !ids.includes('closed') && !ids.includes('strip') && !ids.includes('far'));
  assert.deepEqual(near.map(x => x.distM), [...near.map(x => x.distM)].sort((a, b) => a - b));
  assert.deepEqual(Object.keys(near[0]).sort(), ['cat', 'distM', 'id', 'kind', 'name']);
  assert.equal(near.find(x => x.id === 'oceanarium').cat, 'food', 'cat по таблице сайта');
  assert.equal(nearbyPlaces({ lat: 55.75, lon: 37.6 }, P, 1200, 2).length, 2);
  assert.deepEqual(nearbyPlaces({ lat: 55.0, lon: 37.0 }, P), []);
});

test('validatePlan: винный гастробар после ресторана — нарушение (по названию и эмодзи, не только по типу)', async () => {
  const c = await loadCatalog(REPO);
  const v = validatePlan({ mode: 'date', stops: ['km20', 'khleb-vino'], tags: [] }, c);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /винный бар khleb-vino после ресторана/.test(e)), v.errors.join('; '));
  // слово «вин» внутри другого слова — не вино
  const P = {
    rest: { name: 'Ресторан', kind: 'Ресторан', cat: 'food', lat: 55.75, lon: 37.6 },
    vinyl: { name: 'Винил', kind: 'Бар', cat: 'bar', emoji: '🎵', lat: 55.7501, lon: 37.6 },
  };
  assert.ok(validatePlan({ mode: 'guys', stops: ['rest', 'vinyl'], tags: [] }, P).ok);
});

/* Сквозной тест run.mjs: Telegram, Nominatim и Commons — подставной fetch, модель — записанные ответы (mockDir).
   Работает на временной копии assets/, сеть не трогает. Источник — выдуманный канал из fixtures/tg-page*.html. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import {
  main, parseArgs, stationHint, evidenceQuote, cleanAddr, pruneSeen, normSources, emojiFor, eventId, cost, LIMITS,
  isCopied, copiedRun, similarTitle, findDupEvent, leakOf, safeHref,
} from '../run.mjs';
import { parseAutoJs, loadCatalog, validatePlan } from '../lib/catalog.mjs';
import { renderAutoJs, emptyAutoData, MERGE_JS } from '../lib/autojs.mjs';
import { closeInboxFile } from '../close-inbox.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FIX = path.join(HERE, 'fixtures');
const TODAY = '2026-10-15';
const CH = 'examplechannel';
const NEW_ID = 'testovoe-zerno';
const EV_ID = 'ev-vecher-kamernoy-muzyki-pri-svechakh-uslovnyy-dom-20261024';

const TG_PAGE = readFileSync(path.join(FIX, 'tg-page.html'), 'utf8');
const TG_BEFORE = readFileSync(path.join(FIX, 'tg-page-before.html'), 'utf8');
const TG_EMPTY = '<html><body><section class="tgme_channel_history js-message_history"></section></body></html>';

/* Тестовое место «Черновик» и план с ним — их закроет пост из фикстуры */
const EXTRA_PLACES = `
;(function (K) {
  K.places.chernovik = { name: 'Черновик', kind: 'Кофейня', emoji: '☕', addr: 'Примерная ул., 5', metro: 'Китай-город',
    lat: 55.7566, lon: 37.6335, price: 1, okr: 'center', cat: 'coffee', note: 'Тестовая кофейня для сквозного теста.' };
  K.scenarios.push({ id: 'd-test-chernovik', mode: 'date', emoji: '☕', title: 'Тестовый план', stops: ['chernovik'], when: 'день', tags: [], why: 'Тест.' });
})(window.KUDA);
`;

async function makeRepo(dir) {
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
  const src = f => path.join(ROOT, 'assets', f);
  await fs.writeFile(path.join(dir, 'assets/places.js'), readFileSync(src('places.js'), 'utf8') + EXTRA_PLACES);
  for (const f of ['geo.js', 'photos.js']) await fs.copyFile(src(f), path.join(dir, 'assets', f));
  // заглушки events.js и auto.js — как в репозитории
  for (const f of ['events.js', 'auto.js']) await fs.copyFile(src(f), path.join(dir, 'assets', f));
  return dir;
}

async function makeState(dir, sources = { telegram: [CH], instagram: ['someaccount'], inbox: false }) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'sources.json'), JSON.stringify(sources));
  return dir;
}

/* ---------- подставной fetch ---------- */

const nominatim = (lat, lon, road, house) => ({
  lat: String(lat), lon: String(lon), addresstype: 'building', place_rank: 30,
  display_name: `${house}, ${road}, Басманный район, Москва, Россия`,
  address: { house_number: house, road, suburb: 'Басманный район', city_district: 'Центральный административный округ', city: 'Москва', state: 'Москва' },
});

let IMG;
async function image() {
  IMG ||= await sharp({ create: { width: 1280, height: 853, channels: 3, background: { r: 190, g: 120, b: 80 } } }).jpeg().toBuffer();
  return IMG;
}

function makeFetch(calls = []) {
  return async (url) => {
    const u = new URL(url);
    calls.push(u.hostname);
    const html = s => new Response(s, { status: 200, headers: { 'content-type': 'text/html' } });
    const json = o => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.hostname === 't.me') {
      if (u.pathname !== `/s/${CH}`) return new Response('not found', { status: 404 });
      const b = u.searchParams.get('before');
      return html(!b ? TG_PAGE : b === '1201' ? TG_BEFORE : TG_EMPTY);
    }
    if (u.hostname === 'nominatim.openstreetmap.org') {
      const q = u.searchParams.get('q') || '';
      if (/Покровка/.test(q)) return json([nominatim(55.759012, 37.645031, 'улица Покровка', '99')]);
      if (/Примерный/.test(q)) return json([nominatim(55.754105, 37.640112, 'Малый Примерный переулок', '3')]);
      return json([]);
    }
    if (u.hostname === 'commons.wikimedia.org') {
      const title = 'File:Test cafe facade.jpg';
      if (u.searchParams.get('list') === 'geosearch') {
        return json({ query: { geosearch: [{ pageid: 501, ns: 6, title, lat: 55.75902, lon: 37.64501, dist: 12 }] } });
      }
      return json({ query: { pages: [{ pageid: 501, ns: 6, title, imageinfo: [{
        url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Test_cafe_facade.jpg',
        thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Test_cafe_facade.jpg/1280px-Test_cafe_facade.jpg',
        width: 3000, height: 2000, mime: 'image/jpeg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Test_cafe_facade.jpg',
        extmetadata: { Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Tester">Иван Тестов</a>' },
          LicenseShortName: { value: 'CC BY-SA 4.0' }, License: { value: 'cc-by-sa-4.0' } },
      }] }] } });
    }
    if (u.hostname === 'upload.wikimedia.org') return new Response(await image(), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    throw new Error(`тест: неожиданный запрос ${u.hostname}`);
  };
}

/* ---------- подставная модель: отвечает по содержимому запроса (для записи моков) ---------- */

const msg = data => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
  content: [{ type: 'text', text: JSON.stringify(data) }], stop_reason: 'end_turn', stop_details: null,
  usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 },
});
const BASE = { match_id: '', name: '', kind: '', cat: '', address: '', area: '', price: 1, hours: '', note_ru: '', fit: [], hints: [],
  adult: false, event: null, confidence: 0.9, reason: '' };

function extractItems(content) {
  const items = [];
  for (const [, ref, text] of content.matchAll(/<post key="(p\d+)" date="[^"]*"(?: city="[^"]*")?>\n([\s\S]*?)\n<\/post>/g)) {
    const it = o => items.push({ ...BASE, post_key: ref, ...o });
    if (/Тестовое зерно/.test(text)) {
      it({ type: 'new_place', name: 'Тестовое зерно', kind: 'Кофейня', cat: 'coffee', address: 'ул. Покровка, 99', area: 'Китай-город',
        hours: 'ежедневно 8:00–22:00', note_ru: 'Светлая кофейня со своей обжаркой и несладкими десертами — удобная точка старта для прогулки по Покровке.',
        fit: ['date', 'girls'], hints: ['first', 'night'], confidence: 0.92, reason: 'открытие кофейни с адресом' });
    } else if (/Черновик/.test(text)) {
      it({ type: 'closure', match_id: 'chernovik', name: 'Черновик', kind: 'Кофейня', cat: 'coffee', address: 'Примерная ул., 5',
        confidence: 0.95, reason: 'прямо сказано, что закрылась навсегда' });
    } else if (/камерной музыки/.test(text)) {
      it({ type: 'event', name: 'Условный дом', kind: 'Особняк', cat: 'culture', address: 'Малый Примерный пер., 3',
        note_ru: 'Камерный концерт при свечах в старом особняке — тихий вечер на двоих.', fit: ['date'], reason: 'концерт с датой',
        event: { title: 'Вечер камерной музыки при свечах', cat: 'concert', start: '2026-10-24', end: '2026-10-24', dates: [], time: '19:30',
          venue: 'Условный дом', address: 'Малый Примерный пер., 3', price_from: 1500, price_to: 3500, age: '12+',
          url: 'https://example.org/tickets/candle-night' } });
    } else if (/Куда сходить/.test(text)) {
      it({ type: 'new_place', name: 'Пример', kind: 'Парк', cat: 'walk', note_ru: 'Парк с прудом, где осенью красиво.', confidence: 0.7, reason: 'место из подборки' });
      it({ type: 'irrelevant', reason: 'выставка без даты' });
    } else {
      it({ type: 'irrelevant', confidence: 0.95, reason: 'реклама' });
    }
  }
  return items;
}

function planFor(content) {
  const lines = content.split('\n');
  const newId = lines[1].split('|')[0];
  const near = [];
  for (let i = lines.findIndex(l => l.startsWith('Места рядом')) + 1; i < lines.length && lines[i].includes('|'); i++) {
    const [id, , kind, cat] = lines[i].split('|');
    near.push({ id, kind, cat });
  }
  const walk = near.find(n => n.cat === 'walk' || n.cat === 'culture');
  const foods = near.filter(n => /ресторан|бистро|траттори/i.test(n.kind));
  const plans = [];
  if (walk) plans.push({ mode: 'date', emoji: '🍂', title: 'Прогулка и кофе', stops: [walk.id, newId], when: 'день', tags: ['autumn'],
    why: 'Сначала погулять, а потом согреться кофе в новой кофейне в паре минут пешком.' });
  plans.push({ mode: 'girls', emoji: '☕', title: 'Кофе на Покровке', stops: [newId], when: 'утро', tags: [],
    why: 'Неспешный завтрак с подругами в светлой кофейне со своей обжаркой.' });
  if (foods.length >= 2) plans.push({ mode: 'date', emoji: '🍽️', title: 'Два ужина подряд', stops: [newId, foods[0].id, foods[1].id], when: 'вечер',
    tags: [], why: 'Кофе, а потом два ресторана один за другим.' });
  return plans;
}

function stubClient() {
  return { beta: { messages: { async create(body) {
    const props = Object.keys(body.output_config.format.schema.properties);
    const content = body.messages[0].content;
    if (props.includes('items')) return msg({ items: extractItems(content) });
    if (props.includes('plans')) return msg({ plans: planFor(content) });
    if (props.includes('index')) return msg({ index: 0, reason: 'фасад кофейни' });
    throw new Error('тест: неизвестный запрос к модели');
  } } } };
}

/* ---------- прогон ---------- */

async function run(args, { repo, state, fetchImpl = makeFetch(), llmClient, env = {} }) {
  const lines = [], logs = [];
  const r = await main(['--repo', repo, '--state', state, '--report', path.join(state, 'pipeline-report.md'),
    '--inbox-out', path.join(state, 'pipeline-inbox.json'), '--today', TODAY, ...args],
    { fetchImpl, llmClient, env, tgDelayMs: 0, geoIntervalMs: 0, out: l => lines.push(l), log: l => logs.push(l) });
  return { ...r, lines, logs };
}

const readAuto = repo => readFileSync(path.join(repo, 'assets/auto.js'), 'utf8');
const readState = dir => JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8'));

/* Окно браузера в песочнице: config.js → shared.js → places.js → events.js → auto.js */
function browser(repo, { autoTwice = false } = {}) {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  const files = [path.join(ROOT, 'config.js'), path.join(ROOT, 'assets/shared.js'),
    ...['places.js', 'events.js', 'auto.js'].map(f => path.join(repo, 'assets', f))];
  if (autoTwice) files.push(path.join(repo, 'assets/auto.js'));
  for (const f of files) vm.runInContext(readFileSync(f, 'utf8'), ctx, { filename: f });
  return ctx;
}

/* Один общий сценарий на файл: A — запись ответов модели, B — прогон по мокам, C и D — повторы */
let scenario;
function setup() {
  scenario ||= (async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kuda-run-'));
    const mockDir = path.join(tmp, 'mock');
    const A = { repo: await makeRepo(path.join(tmp, 'a/repo')), state: await makeState(path.join(tmp, 'a/state')) };
    const runA = await run(['--record', mockDir], { ...A, llmClient: stubClient() });
    const B = { repo: await makeRepo(path.join(tmp, 'b/repo')), state: await makeState(path.join(tmp, 'b/state')) };
    const calls = [];
    const runB = await run(['--mock', mockDir], { ...B, fetchImpl: makeFetch(calls) });
    await fs.copyFile(path.join(B.state, 'pipeline-report.md'), path.join(tmp, 'report-b.md'));
    return { tmp, mockDir, A, B, runA, runB, calls, autoB: readAuto(B.repo) };
  })();
  return scenario;
}

// временные папки убираем; KUDA_KEEP_TMP=1 — оставить для разбора (отчёт прогона B — report-b.md)
const tmpDirs = [];
after(async () => {
  if (scenario) tmpDirs.push((await scenario).tmp);
  if (process.env.KUDA_KEEP_TMP) { console.log('# временные папки: ' + tmpDirs.join(', ')); return; }
  await Promise.all(tmpDirs.map(d => fs.rm(d, { recursive: true, force: true })));
});

test('запись ответов модели и прогон по мокам дают один и тот же auto.js', async () => {
  const s = await setup();
  assert.equal(s.runA.changes, 1);
  assert.equal(s.runB.changes, 1);
  assert.ok((await fs.readdir(s.mockDir)).length >= 3, 'записаны ответы extract, plans и photo');
  assert.equal(readAuto(s.A.repo), s.autoB);
  assert.equal(s.runB.lines.at(-1), 'CHANGES=1');
  assert.ok(!s.calls.some(h => !['t.me', 'nominatim.openstreetmap.org', 'commons.wikimedia.org', 'upload.wikimedia.org'].includes(h)));
});

test('новое место: все поля по формату сайта, фото с Commons', async () => {
  const s = await setup();
  const data = parseAutoJs(s.autoB);
  assert.equal(data.updated, TODAY);
  assert.deepEqual(Object.keys(data.places), [NEW_ID]);
  const p = data.places[NEW_ID];
  const cat = await loadCatalog(ROOT);
  assert.equal(p.name, 'Тестовое зерно');
  assert.equal(p.kind, 'Кофейня');
  assert.equal(p.emoji, '☕');
  assert.equal(p.cat, 'coffee');
  assert.equal(p.addr, 'ул. Покровка, 99');
  assert.ok(cat.stations[p.metro], `метро «${p.metro}» есть в таблице FIXED`);
  assert.equal(p.lat, 55.759012);
  assert.equal(p.lon, 37.645031);
  assert.equal(p.okr, 'center');
  assert.equal(p.price, 1);
  assert.equal(p.added, TODAY);
  assert.equal(p.chk, '2026-10');
  assert.deepEqual(p.hint, ['first'], 'night без круглосуточных часов отброшен');
  assert.ok(p.note.length > 0 && p.note.length <= 180);
  assert.equal(p.tg, undefined);
  assert.deepEqual(p.ph, {
    s: `assets/ph/${NEW_ID}.webp`, t: `assets/ph/t/${NEW_ID}.webp`, a: 'Иван Тестов', l: 'CC BY-SA 4.0',
    file: 'Test_cafe_facade.jpg', u: 'https://commons.wikimedia.org/wiki/File:Test_cafe_facade.jpg',
  });
  const big = await sharp(path.join(s.B.repo, p.ph.s)).metadata();
  const small = await sharp(path.join(s.B.repo, p.ph.t)).metadata();
  assert.equal(big.width, 720);
  assert.deepEqual([small.width, small.height], [240, 240]);
});

test('закрытие, событие и подборка', async () => {
  const s = await setup();
  const data = parseAutoJs(s.autoB);
  assert.deepEqual(data.closed, ['chernovik']);

  assert.equal(data.events.length, 1);
  const e = data.events[0];
  assert.equal(e.id, EV_ID);
  assert.equal(e.title, 'Вечер камерной музыки при свечах');
  assert.equal(e.cat, 'concert');
  assert.equal(e.emoji, '🎵');
  assert.equal(e.start, '2026-10-24');
  assert.equal(e.end, '2026-10-24');
  assert.equal(e.time, '19:30');
  assert.equal(e.venue, 'Условный дом');
  assert.equal(e.addr, 'Малый Примерный пер., 3');
  assert.deepEqual(e.price, [1500, 3500]);
  assert.equal(e.age, '12+');
  assert.match(e.url, /^https:\/\//);
  assert.ok(Number.isFinite(e.lat) && Number.isFinite(e.lon) && e.metro);
  assert.deepEqual(e.fit, ['date']);
  assert.equal(e.added, TODAY);

  assert.ok(data.scenarios.length >= 1);
  const merged = await loadCatalog(s.B.repo);
  for (const sc of data.scenarios) {
    assert.match(sc.id, /^auto-(date|guys|girls)-[a-z0-9-]+$/);
    assert.ok(sc.stops.includes(NEW_ID));
    assert.equal(sc.added, TODAY);
    const v = validatePlan(sc, merged);
    assert.ok(v.ok, `${sc.id}: ${v.errors.join('; ')}`);
  }
  assert.equal(new Set(data.scenarios.map(x => x.id)).size, data.scenarios.length);
});

test('отчёт: ссылки на посты, цитата закрытия, отказы с причинами, расход модели', async () => {
  const s = await setup();
  const report = readFileSync(path.join(s.B.state, 'pipeline-report.md'), 'utf8');
  assert.equal(report, readFileSync(path.join(s.B.state, 'reports', `${TODAY}.md`), 'utf8'));
  assert.match(report, /^# Каталог: обновление 2026-10-15/);
  assert.ok(report.includes(`https://t.me/${CH}/1201`), 'ссылка на пост нового места');
  const quote = /«([^»]*закрылась[^»]*)»/.exec(report);
  assert.ok(quote, 'цитата о закрытии');
  assert.ok(quote[1].replace(' …', '').split(/\s+/).length <= 20);
  assert.match(report, /в посте нет адреса — Пример \(новое место\)/);
  // закрытия — в начале отчёта, ссылка на билеты показывает домен
  assert.ok(report.indexOf('## Закрылись') < report.indexOf('## Новые места'));
  assert.match(report, /билеты: \[`example\.org`\]\(https:\/\/example\.org\/tickets\/candle-night\)/);
  // остановки подборок — с названиями, а не только id
  assert.match(report, /Тестовое зерно \(Кофейня, `testovoe-zerno`\)/);
  assert.match(report, /Скроются подборки с этими местами: `d-test-chernovik`/);
  assert.match(report, /≈ \$\d+\.\d\d/);
  assert.match(report, /ig `someaccount` — пропущен: нет IG_ACCESS_TOKEN/);
});

test('состояние: курсор канала, прочитанные посты, кеш геокодера', async () => {
  const s = await setup();
  const st = readState(s.B.state);
  assert.equal(st.tg[CH], 1208);
  for (const id of [1193, 1201, 1205, 1207, 1208]) assert.equal(st.seen[`tg:${CH}/${id}`], TODAY);
  assert.deepEqual(st.retry, {});
  assert.ok(Object.keys(st.geocache).length >= 2);
  assert.equal(st.lastRun, TODAY);
});

test('повторный прогон с теми же постами ничего не меняет', async () => {
  const s = await setup();
  // C: то же содержимое источника, но состояние с нуля — посты разбираются заново
  const C = { repo: s.B.repo, state: await makeState(path.join(s.tmp, 'c/state')) };
  const runC = await run(['--mock', s.mockDir], C);
  assert.equal(runC.changes, 0);
  assert.equal(runC.lines.at(-1), 'CHANGES=0');
  assert.equal(readAuto(s.B.repo), s.autoB);
  assert.ok(runC.res.updates.some(u => u.id === NEW_ID), 'новое место узнано как уже добавленное');
  assert.equal(runC.res.dupEvents.length, 1);
  assert.equal(runC.res.dupEvents[0].dup.id, EV_ID);
  // D: состояние после B — всё уже прочитано
  const before = readState(s.B.state);
  const runD = await run(['--mock', s.mockDir], s.B);
  assert.equal(runD.changes, 0);
  assert.equal(runD.usage.calls, 0);
  assert.equal(readAuto(s.B.repo), s.autoB);
  assert.deepEqual(readState(s.B.state).seen, before.seen);
});

test('auto.js в браузере: место добавлено, закрытое скрыто, план с ним убран, повторное выполнение без дублей', async () => {
  const s = await setup();
  const w = browser(s.B.repo, { autoTwice: true });
  const K = w.KUDA, D = w.DateKit;
  assert.equal(K.places[NEW_ID].name, 'Тестовое зерно');
  assert.equal(K.places.chernovik.closed, true);
  assert.equal(D.placeById('chernovik'), null);
  assert.equal(D.planById('p-chernovik'), null);
  assert.ok(D.placeById(NEW_ID));
  assert.ok(!K.scenarios.some(x => x.id === 'd-test-chernovik'));
  const autoIds = parseAutoJs(s.autoB).scenarios.map(x => x.id);
  for (const id of autoIds) assert.equal(K.scenarios.filter(x => x.id === id).length, 1);
  assert.equal(w.KUDA_EVENTS.filter(e => e.id === EV_ID).length, 1);
  // старые места не тронуты
  const orig = browser(ROOT);
  const some = Object.keys(orig.KUDA.places).filter(id => !orig.KUDA.places[id].closed).slice(0, 20);
  for (const id of some) assert.equal(K.places[id].name, orig.KUDA.places[id].name);
});

test('имена источников не попадают ни в auto.js, ни в вывод запуска', async () => {
  const s = await setup();
  assert.ok(!s.autoB.includes(CH));
  assert.ok(!/t\.me|telegram|instagram/i.test(s.autoB));
  for (const l of [...s.runB.lines, ...s.runB.logs]) assert.ok(!l.includes(CH), l);
  // канал с ошибкой: в логе номер, а не имя
  const E = { repo: await makeRepo(path.join(s.tmp, 'e/repo')), state: await makeState(path.join(s.tmp, 'e/state'), { telegram: ['missingchannel'] }) };
  const r = await run(['--no-llm'], E);
  assert.ok(r.logs.some(l => l.startsWith('tg#1: ')));
  assert.ok(![...r.lines, ...r.logs].some(l => l.includes('missingchannel')));
  // все каналы недоступны — запуск красный, в Actions — предупреждение с номером
  assert.match(r.fatal, /Telegram/);
  assert.ok(r.lines.some(l => l.startsWith('::warning') && l.includes('tg#1')));
});

test('--no-llm: только счётчики, состояние не трогаем', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kuda-nollm-'));
  tmpDirs.push(tmp);
  const X = { repo: await makeRepo(path.join(tmp, 'repo')), state: await makeState(path.join(tmp, 'state')) };
  const r = await run(['--no-llm', '--max-posts', '10'], X);
  assert.equal(r.changes, 0);
  assert.equal(r.lines.at(-1), 'CHANGES=0');
  assert.match(r.lines[0], /^telegram: каналов 1, получено постов 5/);
  assert.match(r.lines.join('\n'), /к разбору: 5/);
  assert.ok(!existsSync(path.join(X.state, 'state.json')));
});

test('--dry: assets/ и прочитанные посты не тронуты', async () => {
  const s = await setup();
  const X = { repo: await makeRepo(path.join(s.tmp, 'dry/repo')), state: await makeState(path.join(s.tmp, 'dry/state')) };
  const auto0 = readAuto(X.repo);
  const r = await run(['--mock', s.mockDir, '--dry'], X);
  assert.equal(readAuto(X.repo), auto0);
  assert.ok(!existsSync(path.join(X.repo, 'assets/ph')));
  assert.equal(r.res.places.length, 1);
  const st = readState(X.state);
  assert.deepEqual(st.seen || {}, {});
  assert.ok(Object.keys(st.geocache).length >= 1, 'кеш геокодера сохраняется и в пробном запуске');
});

test('ящик: issue разобран, получил ответ и закрыт', async () => {
  const s = await setup();
  const X = { repo: await makeRepo(path.join(s.tmp, 'inbox/repo')), state: await makeState(path.join(s.tmp, 'inbox/state'), { inbox: true }) };
  const base = makeFetch();
  const gh = [];
  let comment = '';
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname !== 'api.github.com') return base(url, init);
    gh.push(`${init.method || 'GET'} ${u.pathname}`);
    if (!init.method) {
      return new Response(JSON.stringify([{ number: 7, state: 'open', author_association: 'OWNER', html_url: 'https://github.com/o/r/issues/7',
        created_at: '2026-10-14T10:00:00Z', title: 'Новая кофейня', body: 'Открылась кофейня «Тестовое зерно»: ул. Покровка, 99, м. Китай-город.' }]), { status: 200 });
    }
    if (init.method === 'POST') comment = JSON.parse(init.body).body;
    return new Response('{}', { status: init.method === 'POST' ? 201 : 200 });
  };
  const r = await run([], { ...X, fetchImpl, llmClient: stubClient(), env: { GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' } });
  assert.equal(r.res.places.length, 1);
  // run.mjs только читает ящик: закрывать до PR нельзя — если PR не создастся, заявка пропадёт
  assert.deepEqual(gh, ['GET /repos/o/r/issues']);
  assert.equal(readState(X.state).seen['inbox:7'], undefined, 'issue не в seen: пока открыт, придёт снова');
  assert.match(readFileSync(path.join(X.state, 'pipeline-report.md'), 'utf8'), /закроются после PR: #7/);
  const list = JSON.parse(readFileSync(path.join(X.state, 'pipeline-inbox.json'), 'utf8'));
  assert.deepEqual(list.map(x => x.number), [7]);
  assert.match(list[0].comment, /Pull Request/);
  // шаг после PR: ответ и закрытие
  const done = await closeInboxFile(path.join(X.state, 'pipeline-inbox.json'), { repo: 'o/r', token: 't', fetchImpl, log: () => {} });
  assert.deepEqual(done, { closed: [7], failed: [] });
  assert.deepEqual(gh, ['GET /repos/o/r/issues', 'POST /repos/o/r/issues/7/comments', 'PATCH /repos/o/r/issues/7']);
  assert.match(comment, /добавлено место «Тестовое зерно»/);
});

test('ящик: issue без своих изменений не обещает PR; пустой — закрывается с пояснением', async () => {
  const s = await setup();
  const X = { repo: await makeRepo(path.join(s.tmp, 'inbox2/repo')), state: await makeState(path.join(s.tmp, 'inbox2/state'), { inbox: true }) };
  const base = makeFetch();
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname !== 'api.github.com') return base(url, init);
    return new Response(JSON.stringify([
      { number: 8, state: 'open', author_association: 'OWNER', html_url: 'https://github.com/o/r/issues/8', created_at: '2026-10-14T10:00:00Z',
        title: 'Реклама', body: 'Доставка роллов за 30 минут — скидка по промокоду.' },
      { number: 9, state: 'open', author_association: 'OWNER', html_url: 'https://github.com/o/r/issues/9', created_at: '2026-10-14T11:00:00Z',
        title: '', body: 'ок' },
    ]), { status: 200 });
  };
  await run([], { ...X, fetchImpl, llmClient: stubClient(), env: { GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' } });
  const list = JSON.parse(readFileSync(path.join(X.state, 'pipeline-inbox.json'), 'utf8'));
  const by = Object.fromEntries(list.map(x => [x.number, x.comment]));
  assert.match(by[8], /В каталог ничего не добавлено/);
  assert.match(by[9], /нет текста/);
});

test('нет ключа модели — понятная ошибка', async () => {
  const s = await setup();
  await assert.rejects(run([], { repo: s.B.repo, state: await makeState(path.join(s.tmp, 'nokey/state')) }), /ANTHROPIC_API_KEY/);
});

/* ---------- мелкие функции ---------- */

test('parseArgs', () => {
  const o = parseArgs(['--state', 'st', '--dry', '--max-posts=10', '--since-days', '7', '--no-photos', '--mock', 'm']);
  assert.equal(o.state, 'st');
  assert.equal(o.dry, true);
  assert.equal(o.maxPosts, 10);
  assert.equal(o.sinceDays, 7);
  assert.equal(o.photos, false);
  assert.equal(o.mock, 'm');
  assert.equal(parseArgs([]).maxPosts, 40);
  assert.equal(parseArgs([]).sinceDays, null);
  assert.throws(() => parseArgs(['--max-posts', '0']), /целое/);
  assert.throws(() => parseArgs(['--state']), /значение/);
  assert.throws(() => parseArgs(['--wat']), /неизвестный флаг/);
});

test('stationHint: метро из area или единственное в тексте', async () => {
  const { stations } = await loadCatalog(ROOT);
  assert.equal(stationHint('м. Китай-город', '', stations).name, 'Китай-город');
  assert.equal(stationHint('', 'Адрес: ул. Покровка, 99, м. Китай-город', stations).name, 'Китай-город');
  assert.equal(stationHint('', 'м. Китай-город и м. Курская', stations), null);
  assert.equal(stationHint('Патриаршие пруды', 'без метро', stations), null);
});

test('evidenceQuote: предложение о закрытии, не длиннее 20 слов', () => {
  const t = 'Грустные новости. Кофейня на углу закрылась навсегда — двенадцатого октября был последний день, и больше она не откроется никогда-никогда, совсем, точно, правда, честно. Спасибо!';
  const q = evidenceQuote(t);
  assert.match(q, /^Кофейня на углу закрылась/);
  assert.ok(q.replace(' …', '').split(' ').length <= 20);
  assert.ok(!evidenceQuote('Закрылись (https://example.com/x) навсегда.').includes('http'));
});

test('cleanAddr, emojiFor, eventId, cost, normSources, pruneSeen', () => {
  assert.equal(cleanAddr('г. Москва, ул. Покровка, 99, Россия'), 'ул. Покровка, 99');
  assert.equal(cleanAddr('Москва, Тверская ул., 1, 125009'), 'Тверская ул., 1');
  assert.equal(emojiFor('Винный бар', 'bar'), '🍷');
  assert.equal(emojiFor('Кофейня', 'coffee'), '☕');
  assert.equal(emojiFor('Что-то новое', 'walk'), '🌳');
  assert.equal(eventId({ title: 'Ночь в музее', start: '2026-11-01' }), 'ev-noch-v-muzee-20261101');
  assert.equal(cost({ input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 0 }), 24.2);
  const src = normSources({ telegram: ['@some_channel', 'https://t.me/s/other_one/12', 'bad name!'], instagram: ['insta.user'], inbox: true });
  assert.deepEqual(src.telegram, ['some_channel', 'other_one']);
  assert.deepEqual(src.instagram, ['insta.user']);
  assert.equal(src.inbox, true);
  assert.equal(src.invalid, 1);
  const seen = { a: '2026-10-01', b: '2026-05-01', c: 7 };
  assert.equal(pruneSeen(seen, TODAY), 2);
  assert.deepEqual(seen, { a: '2026-10-01' });
});

test('код слияния auto.js: свои места не перезаписывает, 18+ и планы с закрытыми чистит', () => {
  const ctx = {};
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(`window.KUDA = { places: { a: { name: 'A' }, b: { name: 'B' }, c: { name: 'C', closed: true } },
    scenarios: [{ id: 's1', stops: ['a'] }, { id: 's2', stops: ['a', 'b'] }, { id: 's3', stops: ['c'] }], adult: ['b', 'x'] };`, ctx);
  const data = { ...emptyAutoData(), updated: TODAY,
    places: { a: { name: 'чужое' }, n: { name: 'N' } },
    scenarios: [{ id: 's1', stops: ['n'] }, { id: 's4', stops: ['n', 'a'] }],
    events: [{ id: 'ev-1' }, { id: 'ev-1' }],
    closed: ['b'] };
  const js = renderAutoJs(data);
  assert.ok(!MERGE_JS.includes('})({'));
  vm.runInContext(js, ctx);
  vm.runInContext(js, ctx);
  const K = ctx.KUDA;
  assert.equal(K.places.a.name, 'A');
  assert.equal(K.places.n.name, 'N');
  assert.equal(K.places.b.closed, true);
  const plain = x => JSON.parse(JSON.stringify(x));                     // массивы из песочницы — другого realm
  assert.deepEqual(plain(K.scenarios.map(s => s.id)), ['s1', 's4']);
  assert.deepEqual(plain(K.adult), ['x']);
  assert.deepEqual(plain(ctx.KUDA_EVENTS.map(e => e.id)), ['ev-1']);
  // данные читаются обратно тем же разбором, что в catalog.mjs
  assert.deepEqual(parseAutoJs(js), { ...data, closed: ['b'] });
  assert.deepEqual(parseAutoJs(readFileSync(path.join(ROOT, 'assets/auto.js'), 'utf8')), emptyAutoData());
});

/* ---------- сбои и защита ---------- */

function stubWith(extract = extractItems, fail = null) {
  return { beta: { messages: { async create(body) {
    if (fail) throw fail;
    const props = Object.keys(body.output_config.format.schema.properties);
    const content = body.messages[0].content;
    if (props.includes('items')) return msg({ items: extract(content) });
    if (props.includes('plans')) return msg({ plans: planFor(content) });
    if (props.includes('index')) return msg({ index: 0, reason: 'фасад' });
    throw new Error('тест: неизвестный запрос к модели');
  } } } };
}
const fresh = async (s, name, sources) => ({
  repo: await makeRepo(path.join(s.tmp, name, 'repo')), state: await makeState(path.join(s.tmp, name, 'state'), sources),
});

test('геокодер недоступен (429): место и событие отложены, пост ждёт в retry без счёта попытки', async () => {
  const s = await setup();
  const X = await fresh(s, 'geo429');
  const base = makeFetch();
  const fetchImpl = async (url, init) => (new URL(url).hostname === 'nominatim.openstreetmap.org'
    ? new Response('slow down', { status: 429 }) : base(url, init));
  const r = await run(['--no-photos'], { ...X, fetchImpl, llmClient: stubWith() });
  assert.equal(r.res.places.length, 0);
  assert.equal(r.res.events.length, 0);
  assert.ok(r.res.deferred.length >= 2 && r.res.deferred.every(d => /геокодер недоступен/.test(d.reason)));
  assert.ok(!r.res.rejected.some(x => /не нашёлся/.test(x.reason)), 'это не «адрес не найден»');
  const st = readState(X.state);
  assert.equal(st.seen[`tg:${CH}/1201`], undefined);
  assert.equal(st.retry[`tg:${CH}/1201`].n, 0);
  assert.deepEqual(r.res.closed.map(c => c.id), ['chernovik'], 'закрытию геокодер не нужен');
});

test('модель недоступна: ничего не помечено прочитанным, курсоры на месте, запуск с ошибкой', async () => {
  const s = await setup();
  const X = await fresh(s, 'outage');
  for (let i = 0; i < 3; i++) {
    const r = await run([], { ...X, llmClient: stubWith(extractItems, new Anthropic.APIConnectionError({ message: 'down' })) });
    assert.match(r.fatal, /модель не ответила/);
    assert.equal(r.res.failed.length, 0);
    assert.ok(r.lines.some(l => l.startsWith('::error')));
  }
  const st = readState(X.state);
  assert.deepEqual(st.seen, {});
  assert.deepEqual(st.retry, {});
  assert.deepEqual(st.tg, {});
});

test('закрытие: без названия или без слов о закрытии в посте — отказ; не больше лимита за запуск', async () => {
  const s = await setup();
  const X = await fresh(s, 'closure');
  const extract = content => extractItems(content).map(it => {
    const ref = it.post_key;
    if (!/Тестовое зерно/.test(content.split(`<post key="${ref}"`)[1].split('</post>')[0])) return it;
    return { ...BASE, post_key: ref, type: 'closure', match_id: 'chernovik', name: '', confidence: 0.85 };
  });
  const both = content => {
    const out = extract(content);
    const ref = (/<post key="(p\d+)"[^>]*>\nОткрытие недели/.exec(content) || [])[1];
    if (ref) out.push({ ...BASE, post_key: ref, type: 'closure', match_id: 'chernovik', name: 'Черновик', confidence: 0.95 });
    return out;
  };
  const r = await run(['--no-photos'], { ...X, llmClient: stubWith(both) });
  const reasons = r.res.rejected.map(x => x.reason);
  assert.ok(reasons.includes('закрытие без названия места'), reasons.join('; '));
  assert.ok(reasons.includes('закрытие: в тексте нет слов о закрытии'), reasons.join('; '));
  // настоящий пост о закрытии всё равно закрывает
  assert.deepEqual(r.res.closed.map(c => c.id), ['chernovik']);
});

test('не больше LIMITS.posts постов за запуск: остальные ждут без счёта попыток', async () => {
  const s = await setup();
  const X = await fresh(s, 'cap');
  const was = LIMITS.posts;
  LIMITS.posts = 2;
  try {
    const r = await run(['--no-photos'], { ...X, llmClient: stubWith() });
    const st = readState(X.state);
    assert.equal(Object.keys(st.seen).length, 2);
    assert.equal(Object.keys(st.retry).length, 3);
    assert.ok(Object.values(st.retry).every(x => x.n === 0));
    assert.match(r.report, /не влезли в лимит 2 постов за запуск: 3/);
  } finally { LIMITS.posts = was; }
});

test('фото, которое уже стоит у другого места, новому месту не отдаём', async () => {
  const s = await setup();
  const X = await fresh(s, 'photo-reuse');
  const ph = path.join(X.repo, 'assets/photos.js');
  await fs.writeFile(ph, readFileSync(ph, 'utf8').replace('const PH = {', 'const PH = {\n    "zzz-test": ["Test_cafe_facade.jpg", "Иван Тестов", "CC BY-SA 4.0"],'));
  const r = await run([], { ...X, llmClient: stubWith() });
  const np = r.res.places.find(p => p.id === NEW_ID);
  assert.ok(np && !np.place.ph);
  assert.match(np.photo.note, /уже стоят у других мест/);
});

test('битый sources.json: в ошибке нет имён источников; --dry пишет отчёт в <дата>-dry.md', async () => {
  const s = await setup();
  const X = await fresh(s, 'badjson');
  await fs.writeFile(path.join(X.state, 'sources.json'), '{\n  "telegram": ["chan_two",],\n  "inbox": true\n}');
  await assert.rejects(run(['--no-llm'], X), e => /не JSON/.test(e.message) && !e.message.includes('chan_two'));
  await fs.writeFile(path.join(X.state, 'sources.json'), "{ 'telegram': ['another_c'] }");
  await assert.rejects(run(['--no-llm'], X), e => !e.message.includes('another_c'));

  const D = await fresh(s, 'dryname');
  await run(['--mock', s.mockDir, '--dry'], D);
  assert.ok(existsSync(path.join(D.state, 'reports', `${TODAY}-dry.md`)));
  assert.ok(!existsSync(path.join(D.state, 'reports', `${TODAY}.md`)), 'пробный запуск не затирает настоящий отчёт дня');
  assert.ok(!existsSync(path.join(D.state, 'pipeline-inbox.json')));
});

/* ---------- проверки текста, событий и имён ---------- */

test('isCopied: пять слов подряд из поста — копия; название и адрес не считаются', () => {
  const post = 'На Покровке открылась кофейня «Тестовое зерно» — светлый зал на 20 мест, своя обжарка и десерты без сахара.';
  assert.ok(isCopied('Светлый зал на 20 мест, своя обжарка и десерты без сахара.', post));
  assert.ok(!isCopied('Светлая кофейня со своей обжаркой и несладкими десертами — удобный старт прогулки.', post));
  const ev = '24 октября — вечер камерной музыки при свечах в особняке «Условный дом».';
  assert.ok(!isCopied('Вечер камерной музыки при свечах — тихий концерт на двоих.', ev, ['Вечер камерной музыки при свечах', 'Условный дом']));
  assert.ok(copiedRun('раз два три четыре пять', 'ноль раз два три четыре пять шесть').longest === 5);
});

test('события: id с площадкой, повторы по дате, названию и площадке', () => {
  assert.equal(eventId({ title: 'Хэллоуин-вечеринка', start: '2026-10-31' }, 'Бар Один'), 'ev-khellouin-vecherinka-bar-odin-20261031');
  assert.ok(similarTitle('Щелкунчик', 'Балет «Щелкунчик»'));
  assert.ok(!similarTitle('Щелкунчик', 'Лебединое озеро'));
  const list = [
    { id: 'ev-a', title: 'Балет «Щелкунчик»', start: '2026-12-25', end: '2026-12-25', venue: 'Большой театр', lat: 55.76, lon: 37.6186 },
    { id: 'ev-b', title: 'Хэллоуин-вечеринка', start: '2026-10-31', end: '2026-10-31', venue: 'Бар Один', lat: 55.75, lon: 37.60 },
    { id: 'ev-c', title: 'Выставка света', start: '2026-10-01', end: '2026-12-01', venue: 'Галерея', place: 'gal' },
  ];
  assert.equal(findDupEvent({ title: 'Щелкунчик', start: '2026-12-25', venue: 'Большой', lat: 55.7601, lon: 37.6187 }, list).id, 'ev-a');
  assert.equal(findDupEvent({ title: 'Хэллоуин-вечеринка', start: '2026-10-31', venue: 'Бар Два', lat: 55.77, lon: 37.65 }, list), null,
    'одинаковое название в другом баре — другое событие');
  assert.equal(findDupEvent({ title: 'Щелкунчик', start: '2026-12-26', venue: 'Большой театр' }, list), null, 'другой день');
  assert.equal(findDupEvent({ title: 'Выставка «Света»', start: '2026-11-15', end: '2026-11-15', place: 'gal' }, list).id, 'ev-c',
    'та же выставка, названная одним днём');
  assert.equal(findDupEvent({ title: 'Выставка света', start: '2026-10-20', end: '2026-12-01', place: 'gal' }, list).id, 'ev-c');
  assert.equal(findDupEvent({ title: 'Выставка света', start: '2027-01-10', end: '2027-01-10', place: 'gal' }, list), null, 'после конца — другая');
});

test('leakOf и safeHref: имя источника в тексте или ссылке; разметка из ссылки не ломает отчёт', () => {
  assert.equal(leakOf({ note: 'Кофе и книги.', url: 'https://example.org/?x=examplechannel' }, [CH]), CH);
  assert.equal(leakOf({ url: 'https://example.org/%65xamplechannel' }, [CH]), CH);
  assert.equal(leakOf({ cat: 'coffee', note: 'Кофе.' }, ['coffee']), '', 'коды разделов — не текст');
  assert.equal(safeHref('https://e.org/a)b[c]*'), 'https://e.org/a%29b%5Bc%5D%2A');
});

/* Тесты LLM-слоя: моки из fixtures/llm и подставной client — сеть не трогаем */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import {
  makeLLM, buildExtractUser, requestKey, matchesSchema, clip,
  EXTRACT_SCHEMA, PLANS_SCHEMA, PHOTO_SCHEMA,
} from '../lib/llm.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'llm');
const input = JSON.parse(readFileSync(path.join(FIX, 'input.json'), 'utf8'));
const TODAY = input.today;

const quiet = () => {
  const lines = [];
  const log = (m) => lines.push(m);
  log.lines = lines;
  return log;
};

/* Подставной client: запоминает тела запросов и отвечает по очереди */
function stubClient(responses) {
  const bodies = [];
  const queue = [...responses];
  return {
    bodies,
    beta: {
      messages: {
        async create(body) {
          bodies.push(structuredClone(body));
          const r = queue.length > 1 ? queue.shift() : queue[0];
          if (r instanceof Error) throw r;
          return typeof r === 'function' ? r(body) : r;
        },
      },
    },
  };
}

const okMsg = (data, extra = {}) => ({
  type: 'message', role: 'assistant', model: 'claude-opus-5-5',
  content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: JSON.stringify(data) }],
  stop_reason: 'end_turn', stop_details: null,
  usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 4000 },
  ...extra,
});

const item = (o) => ({
  post_key: 'p1', type: 'new_place', city: '', match_id: '', name: 'Тест', kind: 'Кафе', cat: 'food', address: '', area: '', price: 2, hours: '',
  note_ru: 'Описание.', fit: [], hints: [], adult: false, event: null, confidence: 0.7, reason: 'тест', confirm_url: '', ...o,
});

const posts = (n, channel = 'chan-a') => Array.from({ length: n }, (_, i) => ({
  source: 'tg', channel, id: i + 1, key: `tg:${channel}/${i + 1}`, url: `https://t.me/${channel}/${i + 1}`,
  date: '2026-10-14T10:00:00+00:00', text: `Пост номер ${i + 1}: новое кафе на тестовой улице, дом ${i + 1}.`,
}));

/* —— мок-фикстуры —— */

test('фикстуры лежат под sha1 сообщения пользователя', () => {
  for (const list of [input.posts, input.refusalPosts]) {
    const key = requestKey(buildExtractUser(list, TODAY).content);
    assert.ok(existsSync(path.join(FIX, key + '.json')),
      `нет фикстуры ${key}.json — формат сообщения изменился, перегенерируйте моки`);
  }
});

test('extract: негодные элементы выброшены, остальные нормализованы', async () => {
  const log = quiet();
  const llm = makeLLM({ mockDir: FIX, today: TODAY, log });
  const items = await llm.extract(input.posts, input.catalog);

  // из 13 элементов мока годны 6
  assert.equal(items.length, 6);
  const byName = Object.fromEntries(items.filter((i) => i.name).map((i) => [i.name, i]));

  // ключи вернулись настоящие
  assert.deepEqual([...new Set(items.map((i) => i.post_key))].sort(),
    ['ig:chan-b/17900000000000001', 'inbox:7', 'tg:chan-a/101', 'tg:chan-a/102'].sort());

  const ex = byName['Пример'];
  assert.equal(ex.type, 'new_place');
  assert.equal(ex.post_key, 'tg:chan-a/101');
  assert.ok(!ex.note_ru.includes('@'), 'упоминание вырезано');
  assert.ok(!/посте/.test(ex.note_ru), 'предложение про источник вырезано');
  assert.match(ex.note_ru, /вторым этажом/);

  const closed = items.find((i) => i.type === 'closure');
  assert.equal(closed.match_id, 'beta');

  const ev = items.find((i) => i.type === 'event');
  assert.equal(ev.event.url, '', 'ссылка на соцсеть не годится как официальная');
  assert.deepEqual(ev.event.dates, ['2026-10-25', '2026-10-26'], 'даты вне start..end отброшены');
  assert.deepEqual([ev.event.price_from, ev.event.price_to], [1500, 4000]);
  assert.equal(ev.event.time, '19:30');
  assert.equal(ev.event.age, '12+');
  assert.ok(!items.some((i) => i.event?.title === 'Прошедший концерт'));

  assert.equal(items.filter((i) => i.type === 'irrelevant').length, 1);

  const long = byName['Длинное описание'];
  assert.equal(long.match_id, '', 'выдуманный id очищен');
  assert.equal(long.type, 'new_place');
  assert.ok(long.note_ru.length <= 180);
  assert.ok(long.note_ru.endsWith('…'));
  assert.equal(long.confidence, 1);

  assert.equal(byName['Альфа'].type, 'place_update', 'место из каталога — обновление');

  for (const bad of ['Без причины', 'Странный тип', 'Чужой пост', 'Цена строкой']) assert.ok(!byName[bad], bad);
  // ни одно поле не содержит имён источников
  const dump = JSON.stringify(items.map(({ post_key, ...rest }) => rest));
  assert.ok(!/chan-a|chan-b|t\.me|@/.test(dump), dump);

  const u = llm.usage();
  assert.equal(u.calls, 1);
  assert.equal(u.cacheRead, 15000);
  assert.equal(u.input, 1200);
  assert.equal(u.output, 900);
});

test('extract: отказ модели даёт [] и не роняет запуск', async () => {
  const log = quiet();
  const llm = makeLLM({ mockDir: FIX, today: TODAY, log });
  const items = await llm.extract(input.refusalPosts, input.catalog);
  assert.deepEqual(items, []);
  assert.equal(llm.usage().refusals, 1);
  assert.ok(log.lines.some((l) => /отказ/.test(l) && /cyber/.test(l)));
});

test('extract: нет мока — пустой результат и понятное сообщение', async () => {
  const log = quiet();
  const llm = makeLLM({ mockDir: FIX, today: TODAY, log });
  const p = posts(1);
  const items = await llm.extract(p, input.catalog);
  assert.deepEqual(items, []);
  const key = requestKey(buildExtractUser(p, TODAY).content);
  assert.ok(log.lines.some((l) => l.includes(key + '.json')));
  assert.equal(llm.usage().errors, 1);
});

/* —— тело запроса —— */

test('extract: тело запроса — кэш на последнем системном блоке, без thinking, structured output', async () => {
  const client = stubClient([okMsg({ items: [] })]);
  const llm = makeLLM({ client, today: TODAY, log: quiet() });
  await llm.extract(posts(2), input.catalog);
  assert.equal(client.bodies.length, 1);
  const b = client.bodies[0];

  assert.equal(b.model, 'claude-opus-5-5');
  assert.equal(b.max_tokens, 16000);
  assert.ok(!('thinking' in b), 'thinking не передаём: на этой модели он всегда включён');
  assert.ok(!JSON.stringify(b).includes('"disabled"'));
  assert.ok(!JSON.stringify(b).includes('budget_tokens'));
  assert.deepEqual(b.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(b.fallbacks, 'default');
  assert.equal(b.output_config.effort, 'medium');
  assert.equal(b.output_config.format.type, 'json_schema');
  assert.deepEqual(b.output_config.format.schema, EXTRACT_SCHEMA);

  assert.equal(b.system.length, 2);
  assert.equal(b.system[0].cache_control, undefined);
  assert.deepEqual(b.system.at(-1).cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.ok(b.system.at(-1).text.startsWith('Каталог:\n'));
  assert.ok(b.system.at(-1).text.includes('alpha|Альфа|Ресторан'));
  assert.ok(!JSON.stringify(b.system).includes(TODAY), 'в системном промпте нет даты');

  assert.equal(b.messages.length, 1);
  assert.equal(b.messages[0].role, 'user');
  const user = b.messages[0].content;
  assert.ok(user.includes(`Сегодня: ${TODAY}`));
  assert.ok(user.includes('key="p1"') && user.includes('key="p2"'));
  assert.ok(!user.includes('chan-a'), 'модель не видит имён источников');
});

test('extract: системные блоки побайтно одинаковы между пачками (кэш)', async () => {
  const client = stubClient([okMsg({ items: [] })]);
  const llm = makeLLM({ client, today: TODAY, batchSize: 2, log: quiet() });
  await llm.extract(posts(5), input.catalog);
  assert.equal(client.bodies.length, 3);
  const sys = client.bodies.map((b) => JSON.stringify(b.system));
  assert.equal(new Set(sys).size, 1);
  assert.equal(new Set(client.bodies.map((b) => b.messages[0].content)).size, 3);
});

test('extract: max_tokens на пачке — делим пополам, на одном посте — []', async () => {
  const cut = { ...okMsg({}), content: [], stop_reason: 'max_tokens' };
  const client = stubClient([
    cut, // пачка из 2 постов
    okMsg({ items: [item({ post_key: 'p1', name: 'Первое' })] }),
    cut, // второй пост сам по себе тоже упёрся в лимит
  ]);
  const llm = makeLLM({ client, today: TODAY, log: quiet() });
  const items = await llm.extract(posts(2), input.catalog);
  assert.equal(client.bodies.length, 3);
  assert.deepEqual(items.map((i) => [i.post_key, i.name]), [['tg:chan-a/1', 'Первое']]);
});

test('extract: после смены модели (fallback) читаем текст после блока fallback', async () => {
  const res = okMsg({ items: [item({ name: 'Спасённое' })] });
  res.content = [
    { type: 'text', text: '{"items": [' }, // обрывок первой модели
    { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } },
    ...res.content,
  ];
  const llm = makeLLM({ client: stubClient([res]), today: TODAY, log: quiet() });
  const items = await llm.extract(posts(1), input.catalog);
  assert.deepEqual(items.map((i) => i.name), ['Спасённое']);
  assert.equal(llm.usage().fallbacks, 1);
});

test('extract: ошибки API ловятся по классам — 429 пропускает пачку, 401 роняет запуск', async () => {
  const rate = Anthropic.APIError.generate(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 'slow down', new Headers());
  assert.ok(rate instanceof Anthropic.RateLimitError);
  const log = quiet();
  const llm = makeLLM({ client: stubClient([rate]), today: TODAY, log });
  assert.deepEqual(await llm.extract(posts(1), input.catalog), []);
  assert.equal(llm.usage().errors, 1);
  assert.ok(log.lines.some((l) => /лимит/.test(l)));

  const auth = Anthropic.APIError.generate(401, { type: 'error', error: { type: 'authentication_error', message: 'bad key' } }, 'bad key', new Headers());
  const llm2 = makeLLM({ client: stubClient([auth]), today: TODAY, log: quiet() });
  await assert.rejects(llm2.extract(posts(1), input.catalog), Anthropic.AuthenticationError);
});

test('extract: пустые посты не отправляются', async () => {
  const client = stubClient([okMsg({ items: [] })]);
  const llm = makeLLM({ client, today: TODAY, log: quiet() });
  assert.deepEqual(await llm.extract([{ ...posts(1)[0], text: '  ' }], input.catalog), []);
  assert.equal(client.bodies.length, 0);
});

test('recordDir: сырой ответ пишется под ключом мока', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'llm-rec-'));
  const res = okMsg({ items: [] });
  const client = stubClient([res]);
  const llm = makeLLM({ client, recordDir: dir, today: TODAY, log: quiet() });
  await llm.extract(posts(1), input.catalog);
  const key = requestKey(client.bodies[0].messages[0].content);
  assert.deepEqual(readdirSync(dir), [key + '.json']);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, key + '.json'), 'utf8')), res);
});

/* —— схемы —— */

test('схемы: на каждом объекте additionalProperties:false и required = все поля', () => {
  const walk = (s, where) => {
    if (s.anyOf) return s.anyOf.forEach((x, i) => walk(x, `${where}.anyOf[${i}]`));
    if (s.type === 'array') return walk(s.items, where + '[]');
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false, where);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), where);
      for (const [k, v] of Object.entries(s.properties)) walk(v, `${where}.${k}`);
    }
    // ограничений, которых нет в structured outputs, не используем
    for (const k of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern']) assert.ok(!(k in s), `${where}: ${k}`);
  };
  walk(EXTRACT_SCHEMA, 'extract');
  walk(PLANS_SCHEMA, 'plans');
  walk(PHOTO_SCHEMA, 'photo');
  assert.ok(matchesSchema({ items: [item()] }, EXTRACT_SCHEMA));
  assert.ok(!matchesSchema({ items: [item({ fit: ['friends'] })] }, EXTRACT_SCHEMA));
  assert.ok(!matchesSchema({ items: [item({ event: { title: 'x' } })] }, EXTRACT_SCHEMA));
});

test('clip: режет по слову и ставит многоточие', () => {
  assert.equal(clip('коротко', 180), 'коротко');
  const s = clip('слово '.repeat(60), 50);
  assert.ok(s.length <= 50 && s.endsWith('…'));
});

/* —— планы —— */

const planInput = {
  newPlace: { id: 'newbar', name: 'Новый бар', kind: 'Коктейльный бар', cat: 'bar', addr: 'Тестовая ул., 1', price: 2, note: 'Бар с авторскими коктейлями.' },
  nearby: [
    { id: 'museum', name: 'Музей', kind: 'Музей', cat: 'culture', distM: 600 },
    { id: 'park', name: 'Парк', kind: 'Парк', cat: 'walk', distM: 400 },
  ],
  modes: ['date', 'guys'],
};

test('proposePlans: проверка остановок и режимов, кэш на системном блоке', async () => {
  const plan = (o) => ({ mode: 'date', emoji: '🍸', title: 'Музей и коктейль', stops: ['museum', 'newbar'], when: 'вечер', tags: ['culture'], why: 'Сначала выставка, потом коктейли в восьми минутах пешком.', ...o });
  const client = stubClient([okMsg({ plans: [
    plan(),
    plan({ stops: ['museum', 'nowhere'] }), // нет такого места
    plan({ stops: ['museum', 'park'] }), // без нового места
    plan({ mode: 'girls' }), // режим не просили
    plan({ stops: ['park', 'museum', 'newbar', 'museum'] }), // повтор и 4 остановки
    plan({ mode: 'guys', emoji: 'abc', title: '«Парк и бар»', stops: ['park', 'newbar'], why: 'Прогулка и бар. Об этом писали в телеграме.' }),
    plan(), // дубль первого
  ] })]);
  const llm = makeLLM({ client, today: TODAY, log: quiet() });
  const plans = await llm.proposePlans(planInput);
  assert.equal(plans.length, 2);
  assert.deepEqual(plans[0].stops, ['museum', 'newbar']);
  assert.equal(plans[1].emoji, '📍');
  assert.equal(plans[1].title, 'Парк и бар');
  assert.equal(plans[1].why, 'Прогулка и бар.');

  const b = client.bodies[0];
  assert.ok(!('thinking' in b));
  assert.equal(b.output_config.effort, 'medium');
  assert.deepEqual(b.output_config.format.schema, PLANS_SCHEMA);
  assert.deepEqual(b.system.at(-1).cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.equal(b.fallbacks, 'default');
  const user = b.messages[0].content;
  assert.ok(user.includes('newbar|Новый бар|Коктейльный бар|bar'));
  assert.ok(user.indexOf('park|') < user.indexOf('museum|'), 'соседи по расстоянию');
  assert.ok(user.includes('Режимы: date, guys'));
});

test('proposePlans: отказ — пустой список', async () => {
  const refusal = { ...okMsg({}), content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null } };
  const llm = makeLLM({ client: stubClient([refusal]), today: TODAY, log: quiet() });
  assert.deepEqual(await llm.proposePlans(planInput), []);
  assert.deepEqual(await llm.proposePlans({ nearby: [] }), []);
});

/* —— фото —— */

const cands = Array.from({ length: 8 }, (_, i) => ({
  file: `Example ${i}.jpg`, thumb: `https://upload.wikimedia.org/thumb/example-${i}.jpg/1280px-example-${i}.jpg`,
  artist: 'Автор', license: 'CC BY-SA 4.0', descUrl: `https://commons.wikimedia.org/wiki/File:Example_${i}.jpg`,
}));
const place = { id: 'newbar', name: 'Новый бар', kind: 'Коктейльный бар', addr: 'Тестовая ул., 1' };

test('pickPhoto: до шести картинок по url, effort low, номер кандидата', async () => {
  const client = stubClient([okMsg({ index: 2, reason: 'вывеска бара на фасаде' })]);
  const llm = makeLLM({ client, today: TODAY, log: quiet() });
  assert.equal(await llm.pickPhoto(place, cands), 2);
  const b = client.bodies[0];
  assert.equal(b.output_config.effort, 'low');
  assert.deepEqual(b.output_config.format.schema, PHOTO_SCHEMA);
  assert.ok(!('thinking' in b));
  assert.deepEqual(b.system.at(-1).cache_control, { type: 'ephemeral', ttl: '1h' });
  const imgs = b.messages[0].content.filter((x) => x.type === 'image');
  assert.equal(imgs.length, 6);
  assert.deepEqual(imgs[0].source, { type: 'url', url: cands[0].thumb });
});

test('pickPhoto: -1, если ничего не подошло, номер вне диапазона или отказ', async () => {
  for (const res of [
    okMsg({ index: -1, reason: 'нет вывески' }),
    okMsg({ index: 7, reason: 'вне списка' }),
    okMsg({ index: '1', reason: 'не число' }),
    { ...okMsg({}), content: [], stop_reason: 'refusal' },
  ]) {
    const llm = makeLLM({ client: stubClient([res]), today: TODAY, log: quiet() });
    assert.equal(await llm.pickPhoto(place, cands), -1);
  }
  const client = stubClient([okMsg({ index: 0, reason: '' })]);
  const llm = makeLLM({ client, today: TODAY, log: quiet() });
  assert.equal(await llm.pickPhoto(place, []), -1);
  assert.equal(client.bodies.length, 0, 'без кандидатов не спрашиваем');
});

test('pickPhoto: номер считается в исходном массиве, если часть превью без https', async () => {
  const mixed = [{ ...cands[0], thumb: 'http://insecure/x.jpg' }, cands[1], cands[2]];
  const llm = makeLLM({ client: stubClient([okMsg({ index: 1, reason: '' })]), today: TODAY, log: quiet() });
  assert.equal(await llm.pickPhoto(place, mixed), 2);
});

test('usage: суммирует токены по всем вызовам', async () => {
  const llm = makeLLM({ client: stubClient([okMsg({ index: -1, reason: '' })]), today: TODAY, log: quiet() });
  await llm.pickPhoto(place, cands);
  await llm.pickPhoto(place, cands);
  const u = llm.usage();
  assert.deepEqual([u.calls, u.input, u.output, u.cacheRead, u.cacheWrite], [2, 200, 100, 0, 8000]);
});

/* —— ссылки событий, даты по Москве, исходы по постам —— */

test('officialUrl: метки «откуда» срезаны, соцсети, мультиссылки, сокращатели, IP и имена источников — нет', async () => {
  const { officialUrl } = await import('../lib/llm.mjs');
  const ch = ['examplechannel'];
  assert.equal(officialUrl('https://afisha.yandex.ru/moscow/concert/x?utm_source=examplechannel&utm_medium=telegram&id=5', ch),
    'https://afisha.yandex.ru/moscow/concert/x?id=5');
  assert.equal(officialUrl('https://example.org/e?from=examplechannel', ch), 'https://example.org/e');
  for (const bad of [
    'https://taplink.cc/examplechannel', 'https://example.org/examplechannel/tickets', 'https://example.org/x#ref%3Dexamplechannel',
    'https://t.me./somechannel/123', 'https://telegram.dog/x', 'https://telesco.pe/x/1', 'https://instagr.am/p/1',
    'https://www.instagram.com./account/', 'https://linktr.ee/x', 'https://telegra.ph/x',
    'https://afisha.yandex.ru@phish.example/login', 'https://185.12.13.14:8443/pay', 'https://185.12.13.14/pay',
    'https://example.org:8443/x', 'https://clck.ru/3ABCD', 'https://bit.ly/x', 'https://localhost/x', 'http://example.org/x',
  ]) assert.equal(officialUrl(bad, ch), '', bad);
  assert.equal(officialUrl('https://www.example.org./tickets', ch), 'https://www.example.org/tickets');
});

test('buildExtractUser: день поста — по Москве, а не по UTC', () => {
  const p = { ...posts(1)[0], date: '2026-10-14T21:30:00.000Z' };      // 00:30 МСК 15 октября
  assert.match(buildExtractUser([p], TODAY).content, /date="2026-10-15"/);
});

test('extract: исход по каждому посту — ok, отказ, сбой связи; при сбое связи status transient', async () => {
  const status = new Map();
  const llm = makeLLM({ client: stubClient([new Anthropic.APIConnectionError({ message: 'down' })]), today: TODAY, log: quiet() });
  assert.deepEqual(await llm.extract(posts(2), input.catalog, { status }), []);
  assert.deepEqual([...status.values()], ['transient', 'transient']);

  const over = Anthropic.APIError.generate(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 'Overloaded', new Headers());
  const s2 = new Map();
  await makeLLM({ client: stubClient([over]), today: TODAY, log: quiet() }).extract(posts(1), input.catalog, { status: s2 });
  assert.equal(s2.get('tg:chan-a/1'), 'transient', '529 — перегрузка, не вина поста');

  const s3 = new Map();
  const ok = okMsg({ items: [item({ post_key: 'p1' })] });
  const refusal = { ...okMsg({}), content: [], stop_reason: 'refusal', stop_details: { category: 'cyber' } };
  await makeLLM({ client: stubClient([refusal, ok, refusal]), today: TODAY, log: quiet() }).extract(posts(2), input.catalog, { status: s3 });
  assert.deepEqual(Object.fromEntries(s3), { 'tg:chan-a/1': 'ok', 'tg:chan-a/2': 'refusal' });

  const s4 = new Map();
  const client = stubClient([ok]);
  await makeLLM({ client, today: TODAY, log: quiet() }).extract(posts(2), input.catalog, { status: s4, deadline: Date.now() - 1 });
  assert.equal(client.bodies.length, 0, 'время вышло — запросов нет');
  assert.deepEqual([...s4.values()], ['skipped', 'skipped']);
});

test('extract: кончились деньги (402 / credit balance) — запуск падает, как при неверном ключе', async () => {
  const billing = Anthropic.APIError.generate(402, { type: 'error', error: { type: 'billing_error', message: 'payment required' } }, 'x', new Headers());
  await assert.rejects(makeLLM({ client: stubClient([billing]), today: TODAY, log: quiet() }).extract(posts(1), input.catalog), /402/);
  const credit = Anthropic.APIError.generate(400, { type: 'error', error: { type: 'invalid_request_error',
    message: 'Your credit balance is too low to access the Anthropic API.' } }, 'x', new Headers());
  await assert.rejects(makeLLM({ client: stubClient([credit]), today: TODAY, log: quiet() }).extract(posts(1), input.catalog), /credit balance/);
});

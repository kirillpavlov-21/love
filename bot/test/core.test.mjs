/* Проверки бота и подбора на настоящем каталоге из репозитория: разбор фраз (assets/intent.js), подбор (assets/pick.js)
   и сценарии бота (bot/core.mjs) с поддельным Telegram — без сети. Часы песочницы — вторник, 3 ноября 2026, 19:00 по Москве. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from '../catalog.mjs';
import { memoryStore } from '../store.mjs';
import { createBot } from '../core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NOW = Date.UTC(2026, 10, 3, 16, 0);
const C = await buildCatalog({ dir: ROOT, clock: NOW });
/* массивы из песочницы — другого «мира» (свой Array): для сравнения переводим в обычные */
const plain = x => JSON.parse(JSON.stringify(x));
const parse = (t, city = 'msk') => plain(C.I.parse(t, { city, now: NOW }));

test('каталог загрузился целиком', () => {
  assert.deepEqual(C.missing, []);
  assert.ok(C.D.scenarios.length > 300);
});

test('разбор: с кем, деньги, когда, погода, станция', () => {
  const q = parse('свидание недорого под крышей у Чистых прудов');
  assert.equal(q.mode, 'date');
  assert.equal(q.bud, 1);
  assert.equal(q.indoor, true);
  assert.equal(q.station && q.station.name, 'Чистые пруды');
  assert.deepEqual(q.tags, []);   // «крыша» из «под крышей» не стала «с видом»
  const g = parse('нас пятеро в субботу днём, активно');
  assert.equal(g.mode, 'guys');
  assert.equal(g.day, '2026-11-07');
  assert.equal(g.when, 'day');
  assert.ok(g.tags.includes('active'));
  assert.equal(parse('компы до утра').when, 'late');
  assert.ok(parse('компьютерный клуб').tags.includes('pc'));
  assert.deepEqual(parse('компьютерный клуб').ev, []);   // не «вечеринка»
  assert.equal(parse('не дорого').bud, 1);
  assert.equal(parse('не дорого').premium, false);
  assert.equal(parse('ужин до 3000').bud, 2);
  assert.equal(parse('бранч с подругами').mode, 'girls');
  assert.equal(parse('на Ваське погулять').city, 'spb');
  assert.equal(parse('на Ваське погулять').okr, 'vo');
  assert.equal(parse('театр завтра').day, '2026-11-04');
  assert.ok(parse('театр завтра').ev.includes('theatre'));
  assert.deepEqual(parse('грузинская кухня').words, ['грузинская']);
  assert.equal(parse('').empty, true);
});

test('подбор: только открытые в момент встречи и разные', () => {
  const q = parse('свидание сегодня вечером');
  const r = C.P.plans(q, { city: 'msk', mode: 'date', limit: 3 });
  assert.equal(r.length, 3);
  r.forEach(x => assert.equal(x.closed, '', x.plan.title + ' — закрыто: ' + x.closed));
  const stops = r.flatMap(x => x.plan.stops);
  assert.equal(new Set(stops).size, stops.length, 'у трёх планов нет общих остановок');
  r.forEach(x => assert.ok(x.why.length >= 1, 'есть «почему»'));
});

test('подбор: «под крышей» — все остановки в помещении, станция — рядом', () => {
  const q = parse('свидание под крышей у Чистых прудов');
  const r = C.P.plans(q, { city: 'msk', mode: 'date', limit: 3 });
  r.forEach(x => assert.ok(C.P.indoorPlan(x.plan), x.plan.title));
  const near = r.filter(x => C.K.distM(q.station, C.K.planStops(x.plan)[0]) < 2500);
  assert.ok(near.length >= 2, 'хотя бы два плана в пределах 2,5 км от станции');
});

test('подбор: «компы» со свидания находят планы компании', () => {
  const r = C.P.plans(parse('компы до утра'), { city: 'msk', mode: 'date', anyMode: true, limit: 3 });
  assert.ok(r.every(x => (x.plan.tags || []).includes('pc')), r.map(x => x.plan.title).join(', '));
});

test('подбор: вкус человека и «Не то»', () => {
  const base = C.P.plans({}, { city: 'msk', mode: 'date', limit: 3 }).map(x => x.plan.id);
  const skip = new Set([base[0]]);
  const r = C.P.plans({}, { city: 'msk', mode: 'date', limit: 3, skip });
  assert.ok(!r.some(x => x.plan.id === base[0]));
  const t = C.P.plans({}, { city: 'msk', mode: 'date', limit: 3, taste: { vibes: ['culture'], bud: 0 } });
  assert.ok(t.filter(x => (x.plan.tags || []).includes('culture')).length >= 2);
});

/* ---------- бот с поддельным Telegram ---------- */
function fakeApi() {
  const calls = [];
  let mid = 100;
  const api = async (method, params) => {
    calls.push({ method, params });
    if (method === 'sendMessage' || method === 'sendPoll' || method === 'sendPhoto') return { message_id: ++mid, chat: { id: params.chat_id } };
    return true;
  };
  return { api, calls, last: m => calls.filter(c => c.method === m).pop(), all: m => calls.filter(c => c.method === m) };
}
const make = () => {
  const T = fakeApi(), store = memoryStore();
  const bot = createBot({ api: T.api, store, catalog: async () => C, site: 'https://example.org/love/', name: 'kuda_test_bot' });
  return { T, bot, store };
};
const priv = { id: 1, type: 'private' }, group = { id: -5, type: 'supergroup' };
const ann = { id: 11, first_name: 'Аня', is_bot: false }, pete = { id: 12, first_name: 'Петя', is_bot: false };
const msg = (text, chat = priv, from = ann) => ({ message: { message_id: 1, chat, from, text } });

test('бот: фраза в личке → планы, «почему» и кнопки', async () => {
  const { T, bot } = make();
  await bot.handle(msg('свидание недорого, если дождь'));
  const m = T.last('sendMessage');
  assert.ok(m, 'ответил');
  assert.match(m.params.text, /Понял так: 💕 свидание/);
  assert.match(m.params.text, /1️⃣ <b>/);
  assert.match(m.params.text, /https:\/\/example\.org\/love\/start\.html\?plan=/);
  const kb = m.params.reply_markup.inline_keyboard.flat();
  assert.ok(kb.some(b => /^опрос [A-Za-z0-9]{8}$/.test(b.switch_inline_query || '')), 'кнопка «Голосование в чат»');
  assert.ok(kb.some(b => /create\.html\?mode=date&list=/.test(b.url || '')), 'кнопка «Позвать игрой» со списком планов');
});

test('бот: голосование кнопками — голоса, снятие голоса, лидер', async () => {
  const { T, bot } = make();
  await bot.handle(msg('с друзьями баня или бар'));
  const qid = T.last('sendMessage').params.reply_markup.inline_keyboard.flat().find(b => b.switch_inline_query).switch_inline_query.split(' ')[1];
  await bot.handle({ inline_query: { id: 'iq1', from: ann, query: 'опрос ' + qid } });
  const res = T.last('answerInlineQuery').params.results;
  assert.equal(res[0].type, 'article');
  const btns = res[0].reply_markup.inline_keyboard.flat().filter(b => b.callback_data);
  assert.ok(btns.length >= 2);
  const [, pid] = btns[0].callback_data.split('|');
  const vote = (from, i, n) => bot.handle({ callback_query: { id: 'cb' + n, from, inline_message_id: 'im1', data: `v|${pid}|${i}` } });
  await vote(ann, 0, 1);
  await vote(pete, 0, 2);
  await vote(pete, 1, 3);
  let e = T.last('editMessageText').params;
  assert.equal(e.inline_message_id, 'im1');
  assert.match(e.text, /— <b>2<\/b>: Аня, Петя/);
  assert.match(e.text, /👑 Лидирует/);
  await vote(ann, 0, 4);   // Аня передумала
  e = T.last('editMessageText').params;
  assert.match(e.text, /— <b>1<\/b>: Петя/);
  assert.match(e.text, /🤝 Поровну/);
  assert.equal(T.last('answerCallbackQuery').params.text, 'Голос снят');
});

test('бот: в группе — нативный опрос и «когда», без обращения молчит', async () => {
  const { T, bot } = make();
  await bot.handle(msg('просто болтаем', group));
  assert.equal(T.calls.length, 0);
  await bot.handle(msg('/opros@kuda_test_bot баня в пятницу', group));
  const p = T.last('sendPoll').params;
  assert.equal(p.chat_id, -5);
  assert.equal(p.is_anonymous, false);
  assert.ok(p.options.length >= 2 && p.options.length <= 12);
  assert.match(p.question, /^Куда идём в пятницу\?$/);
  await bot.handle(msg('/kogda', group));
  assert.equal(T.last('sendPoll').params.options.length, 7);
  await bot.handle(msg('/opros@other_bot что-то', group));
  assert.equal(T.all('sendPoll').length, 2, 'команда другому боту — не наша');
});

test('бот: квиз кнопками доходит до подборки', async () => {
  const { T, bot } = make();
  await bot.handle(msg('/podobrat'));
  const cb = (data, n) => bot.handle({ callback_query: { id: 'q' + n, from: ann, data, message: { message_id: 7, chat: priv } } });
  await cb('z|girls', 1);
  await cb('z|girls|2', 2);
  await cb('z|girls|2|wke', 3);
  const m = T.last('sendMessage').params.text;
  assert.match(m, /💅 с подругами/);
  assert.match(m, /на выходных/);
});

test('бот: ссылка с сайта t.me/бот?start=poll_… и город', async () => {
  const { T, bot, store } = make();
  const ids = C.D.scenarios.filter(s => s.mode === 'guys' && C.K.cityOf(s) === 'msk').slice(0, 3);
  await bot.handle(msg('/start poll_' + ids.map(s => bot.ref(s.id)).join('_')));
  const m = T.last('sendMessage').params;
  assert.match(m.text, /Варианты для голосования/);
  ids.forEach(s => assert.ok(m.text.includes(s.title.replace(/&/g, '&amp;').replace(/</g, '&lt;'))));
  await bot.handle({ callback_query: { id: 'c1', from: ann, data: 'c|spb', message: { message_id: 3, chat: priv } } });
  assert.equal((await store.get('u:11')).city, 'spb');
  await bot.handle(msg('бар с видом'));
  assert.match(T.last('sendMessage').params.text, /city=spb/);
});

test('номер плана на сайте (hub.js: tgRef) совпадает с номером в боте', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(path.join(ROOT, 'assets/hub.js'), 'utf8');
  const m = /const tgRef = (id => \{[^\n]+\});/.exec(src);
  assert.ok(m, 'tgRef есть в hub.js');
  const tgRef = (0, eval)(m[1]);
  const { bot } = make();
  C.D.scenarios.slice(0, 50).forEach(s => assert.equal(tgRef(s.id), bot.ref(s.id)));
});

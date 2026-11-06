/* Проверки бота и подбора на настоящем каталоге из репозитория: разбор фраз (assets/intent.js), подбор (assets/pick.js)
   и сценарии бота (bot/core.mjs) с поддельным Telegram — без сети. Часы песочницы — вторник, 3 ноября 2026, 19:00 по Москве. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from '../catalog.mjs';
import { memoryStore } from '../store.mjs';
import { createBot, setupBot } from '../core.mjs';

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

test('подбор: рэп и имя артиста — только то, где это правда есть', () => {
  const q = parse('рэп');
  assert.deepEqual(q.kinds, ['рэп']);
  // мест «под рэп» в каталоге нет — значит, честное «нет», а не опера «по остальному»
  assert.ok(!C.P.plans(q, { city: 'msk', mode: 'guys', anyMode: true, limit: 5 }).some(x => x.match));
  const ev = C.P.events(q, { city: 'msk', mode: 'guys', limit: 5 });
  assert.ok(ev.length > 0, 'рэп-концерты в афише ближайших двух месяцев');
  ev.forEach(x => assert.match(`${x.ev.title} ${x.ev.note || ''}`.toLowerCase(), /рэп|трэп|хип/, x.ev.title));
  // «концерт <имя>»: чужие концерты жанр не вытягивает
  C.P.events(parse('концерт хаски'), { city: 'msk', mode: 'guys', limit: 3 })
    .forEach(x => assert.match(`${x.ev.title} ${x.ev.note || ''}`.toLowerCase(), /хаски/, x.ev.title));
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

test('бот: фраза в личке → карточка плана с фото, «почему» и кнопками', async () => {
  const { T, bot } = make();
  await bot.handle(msg('свидание недорого, если дождь'));
  const m = T.last('sendMessage');
  assert.ok(m, 'ответил');
  assert.match(m.params.text, /🔎 <i>💕 свидание/);
  assert.match(m.params.text, /^.+ <b>.+<\/b>\n<i>.+<\/i>/m, 'название и остановки');
  const lp = m.params.link_preview_options;
  assert.ok(lp.is_disabled || (/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/.+\/960px-/.test(lp.url) && lp.show_above_text && /📷 .+ · Wikimedia Commons/.test(m.params.text)),
    'фото над текстом — только с автором и лицензией');
  const kb = m.params.reply_markup.inline_keyboard.flat();
  assert.ok(kb.some(b => /^g\|[A-Za-z0-9]{8}\|1$/.test(b.callback_data || '')), 'листать ›');
  assert.ok(kb.some(b => b.web_app && /^https:\/\/example\.org\/love\/start\.html\?tg=1&plan=/.test(b.web_app.url)), '«Подробнее» — Mini App');
  assert.ok(kb.some(b => /^опрос [A-Za-z0-9]{8}$/.test(b.switch_inline_query || '')), 'кнопка «Голосование в чат»');
  assert.ok(kb.some(b => /create\.html\?mode=date&list=/.test(b.url || '')), 'кнопка «Позвать игрой» со списком планов');
});

test('бот: ‹ › и «Другие варианты» меняют ту же карточку', async () => {
  const { T, bot } = make();
  await bot.handle(msg('с друзьями баня или бар'));
  const m = T.last('sendMessage').params, title = t => (/<b>([^<]+)<\/b>\n<i>/.exec(t) || [])[1];
  const pager = m.reply_markup.inline_keyboard[0], next = pager[2].callback_data;   // ‹ · «1 из N» · ›
  const cb = (data, n) => bot.handle({ callback_query: { id: 'g' + n, from: ann, data, message: { message_id: 101, chat: priv } } });
  await cb(next, 1);
  const e1 = T.last('editMessageText').params;
  assert.equal(e1.message_id, 101);
  assert.notEqual(title(e1.text), title(m.text), '› — другой план');
  assert.match(pager[1].text, /^1 из \d$/);
  assert.match(e1.reply_markup.inline_keyboard[0][1].text, /^2 из \d$/);
  const more = m.reply_markup.inline_keyboard.flat().find(b => /^m\|/.test(b.callback_data || '')).callback_data;
  await cb(more, 2);
  const e2 = T.last('editMessageText').params;
  assert.ok(![title(m.text), title(e1.text)].includes(title(e2.text)), 'другие варианты — новые планы');
  assert.equal(T.all('sendMessage').length, 1, 'новых сообщений нет');
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
  assert.match(e.text, /▰+▱* <b>2<\/b> · Аня, Петя/);
  assert.match(e.text, /👑 Лидирует/);
  await vote(ann, 0, 4);   // Аня передумала
  e = T.last('editMessageText').params;
  assert.match(e.text, /<b>1<\/b> · Петя/);
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
  const m = T.last('sendMessage').params, html = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  assert.match(m.text, /Варианты для голосования/);
  assert.ok(m.text.includes(html(ids[0].title)));
  const qid = m.reply_markup.inline_keyboard.flat().find(b => b.switch_inline_query).switch_inline_query.split(' ')[1];
  assert.deepEqual((await store.get('q:' + qid)).ids, ids.map(s => s.id), 'все три плана — в карточке, листаются ‹ ›');
  // из Mini App: «опрос <номер> <номер>…» в inline-режиме — голосование без хранилища
  await bot.handle({ inline_query: { id: 'iq2', from: ann, query: 'опрос ' + ids.map(s => bot.ref(s.id)).join(' ') } });
  const art = T.last('answerInlineQuery').params.results[0];
  assert.equal(art.reply_markup.inline_keyboard.filter(r => r[0].callback_data).length, 3);
  ids.forEach(s => assert.ok(art.input_message_content.message_text.includes(html(s.title))));
  await bot.handle({ callback_query: { id: 'c1', from: ann, data: 'c|spb', message: { message_id: 3, chat: priv } } });
  assert.equal((await store.get('u:11')).city, 'spb');
  await bot.handle(msg('бар с видом'));
  assert.match(JSON.stringify(T.last('sendMessage').params.reply_markup), /city=spb/);
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

test('песочница: подменённый файл сайта не достаёт до process и токена', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const { FILES } = await import('../catalog.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kuda-sbx-'));
  try {
    for (const [f] of FILES) { fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true }); if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f)); }
    const evil = `(() => { const tries = [
      () => this.constructor.constructor('return process')(),
      () => globalThis.constructor.constructor('return process')(),
      () => console.log.constructor('return process')(),
      () => Date.now.constructor('return process')(),
      () => location.constructor.constructor('return process')(),
    ]; window.__leak = tries.map(t => { try { const p = t(); return p && p.env ? 'LEAK' : 'нет'; } catch (e) { return 'нет'; } }); })();\n`;
    fs.writeFileSync(path.join(tmp, 'config.js'), evil + fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8') + '\nwindow.DATE_CONFIG.__leak = window.__leak;');
    const X = await buildCatalog({ dir: tmp, clock: NOW });
    assert.deepEqual(plain(X.cfg.__leak), ['нет', 'нет', 'нет', 'нет', 'нет']);
    assert.ok(X.D.scenarios.length > 300, 'каталог при этом загрузился');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('разбор: даты с «на», завтрак, время вместо денег, Ленинградка', () => {
  const v = parse('свидание на 14 февраля');
  assert.equal(v.mode, 'date');
  assert.equal(v.day, '2027-02-14');
  assert.equal(parse('на 8 марта с подругами').day, '2027-03-08');
  assert.equal(parse('стол на 6 человек').group, true);
  const b = parse('завтрак в субботу');
  assert.equal(b.day, '2026-11-07');
  assert.ok(b.tags.includes('brunch'));
  assert.equal(parse('бар до 23:00').premium, false);
  assert.equal(parse('бар до 23:00').bud, 0);
  assert.equal(parse('до 2 ночи').when, 'late');
  assert.equal(parse('ужин до 3к').bud, 2);
  assert.equal(parse('у Ленинградского вокзала бар').city, null);
});

test('бот: бессмыслица — честное «не нашлось», без случайных планов', async () => {
  const { T, bot } = make();
  await bot.handle(msg('ааабббввв'));
  const m = T.last('sendMessage').params;
  assert.match(m.text, /Планов под это не нашлось/);
  assert.ok(!/1️⃣/.test(m.text));
});

test('бот: черновиков голосований от одного человека не больше 15', async () => {
  const { bot, store } = make();
  for (let i = 0; i < 25; i++) await bot.handle({ inline_query: { id: 'q' + i, from: ann, query: 'бар ' + 'с видом'.slice(0, i % 7) } });
  assert.ok(store.size() <= 17, 'записей в хранилище: ' + store.size());
});

test('хранилище в файле: права только у владельца, запись переживает перезапуск', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const { fileStore } = await import('../store.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuda-store-')), file = path.join(dir, 'sub', 'bot.json');
  try {
    const s = fileStore(file);
    await s.set('u:1', { city: 'spb' }, 60);
    s.flush();
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
    assert.deepEqual(await fileStore(file).get('u:1'), { city: 'spb' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('токен: TG_TOKEN важнее файла, файл получает права только владельца, нет ничего — пусто', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const { botToken } = await import('../tg.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuda-tok-'));
  const file = path.join(dir, 'tg-token');
  try {
    fs.writeFileSync(file, '123:abc\n', { mode: 0o644 });
    assert.equal(botToken({ TG_TOKEN_FILE: file }), '123:abc');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(botToken({ TG_TOKEN: ' 9:z ', TG_TOKEN_FILE: file }), '9:z');
    assert.equal(botToken({ TG_TOKEN_FILE: path.join(dir, 'нет') }), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('оформление: кнопка меню открывает Mini App, своё описание владельца не трогаем', async () => {
  const T = fakeApi();
  const api = async (method, params) => { await T.api(method, params); return method === 'getMyDescription' ? { description: 'своё' } : method === 'getMyShortDescription' ? { short_description: '' } : true; };
  await setupBot(api, 'https://example.org/love');
  assert.equal(T.last('setChatMenuButton').params.menu_button.web_app.url, 'https://example.org/love/start.html?tg=1');
  assert.equal(T.all('setMyDescription').length, 0, 'описание владельца осталось');
  assert.equal(T.all('setMyShortDescription').length, 1);
});

test('как пишут люди: сленг понят, конкретное занятие — точно, незнакомое слово — «по остальному», а не пусто', async () => {
  const p = parse('завтра после пар куда сходить с тян');
  assert.equal(p.mode, 'date');
  assert.equal(p.when, 'eve');
  assert.deepEqual(p.words, [], 'служебные слова не ищем в названиях');
  assert.equal(parse('др у друга нас 6 человек').mode, 'guys');
  assert.equal(parse('катка в кс').tags.includes('rink'), false, '«катка» — игра, а не каток');
  assert.deepEqual(parse('надоели рестораны').not, ['food']);
  assert.equal(parse('до 1.5к').bud, 1);
  assert.equal(parse('kuda shodit s devushkoi').mode, 'date', 'транслит');
  const { T, bot } = make();
  await bot.handle(msg('падел'));
  assert.match(T.last('sendMessage').params.text, /<b>[^<]*Падел[^<]*<\/b>/, 'падел — план с паделом, а не любой «активный»');
  await bot.handle(msg('аниме кафе'));
  const m = T.last('sendMessage').params.text;
  assert.match(m, /Про «аниме» готовых планов нет — подобрал по остальному/);
  assert.ok(!/Планов под это не нашлось/.test(m));
  await bot.handle(msg('привет'));
  assert.match(T.last('sendMessage').params.text, /Привет! Я — «Куда идём\?»/);
});

test('бот: /top — топ дня и семь на неделю, у каждого — почему', async () => {
  const { T, bot } = make();
  await bot.handle(msg('/top'));
  const m = T.last('sendMessage').params;
  assert.match(m.text, /🔥 <b>Топ дня<\/b>/);
  assert.match(m.text, /📅 <b>Топ недели<\/b>/);
  assert.ok((m.text.match(/^<b>\d\.<\/b>/gm) || []).length >= 3);
  assert.match(m.text, /Выбор «Куда идём\?»/);
});

test('тестеры: /start tester_код — журнал действий, «Открыть приложение» с кодом, /stoptest — больше не пишем', async () => {
  const T = fakeApi(), store = memoryStore(), log = [];
  const bot = createBot({ api: T.api, store, catalog: async () => C, site: 'https://example.org/love/', name: 'kuda_test_bot', audit: r => log.push(r) });
  await bot.handle(msg('просто так'));
  assert.equal(log.length, 0, 'не тестер — не пишем');
  await bot.handle(msg('/start tester_Anya'));
  assert.equal((await store.get('u:11')).tester, 'anya');
  const app = T.last('sendMessage').params.reply_markup.inline_keyboard.flat().find(b => b.web_app);
  assert.match(app.web_app.url, /start\.html\?tg=1&tester=anya$/);
  await bot.handle(msg('свидание в субботу'));
  await bot.handle({ callback_query: { id: 'c1', from: ann, data: 'z', message: { message_id: 3, chat: priv } } });
  assert.deepEqual(log.map(r => [r.tester, r.kind]), [['anya', 'message'], ['anya', 'message'], ['anya', 'button']]);
  assert.equal(log[1].text, 'свидание в субботу');
  await bot.handle(msg('/stoptest'));
  await bot.handle(msg('ещё что-то'));
  assert.equal(log.length, 3, 'после /stoptest — ничего');
  assert.equal((await store.get('u:11')).tester, undefined);
});

test('честное «нет»: «🔔 Напиши, когда появится» запоминает запрос, проверка пишет, когда нашлось, и снимает подписку', async () => {
  const { T, bot, store } = make();
  await bot.handle(msg('аниме кафе'));
  const m = T.last('sendMessage').params;
  const w = m.reply_markup.inline_keyboard.flat().find(b => /^w\|[A-Za-z0-9]{8}$/.test(b.callback_data || ''));
  assert.ok(w, 'под ответом «по остальному» — подписка');
  await bot.handle({ callback_query: { id: 'w1', from: ann, data: w.callback_data, message: { message_id: 101, chat: priv } } });
  assert.match(T.last('sendMessage').params.text, /🔔 Запомнил: «аниме кафе»/);
  assert.equal((await store.get('w:11')).length, 1);
  assert.equal(await bot.checkWishes(), 0, 'точного всё ещё нет — молчим');
  assert.equal((await store.get('w:11')).length, 1, 'подписка осталась');
  // запрос, под который точное уже есть, — как будто план появился в каталоге
  await store.set('w:11', [{ t: 'падел', c: 'msk', m: 'guys', chat: 1, ev: [], at: Date.now() }]);
  const before = T.all('sendMessage').length;
  assert.equal(await bot.checkWishes(), 1);
  const sent = T.all('sendMessage').slice(before);
  assert.equal(sent.length, 1);
  assert.match(sent[0].params.text, /🔔 Появилось то, что ты искал: «падел»/);
  assert.equal(await store.get('w:11'), null, 'подписку сняли');
  await bot.handle(msg('/stopwish'));
  assert.match(T.last('sendMessage').params.text, /больше не жду/);
  // в группе подписки нет: писать будет некому
  await bot.handle(msg('@kuda_test_bot аниме кафе', group));
  assert.ok(!T.last('sendMessage').params.reply_markup.inline_keyboard.flat().some(b => /^w\|/.test(b.callback_data || '')));
});

test('без повторов: план, показанный в прошлые дни, назавтра уступает место другому', async () => {
  const { T, bot, store } = make();
  const title = t => (/<b>([^<]+)<\/b>\n<i>/.exec(t) || [])[1];
  await bot.handle(msg('свидание сегодня вечером'));
  const first = title(T.last('sendMessage').params.text);
  const u = await store.get('u:11');
  assert.ok(u.shown && u.shown.length >= 1, 'показанное запомнили');
  // тот же день — тот же ответ
  await bot.handle(msg('свидание сегодня вечером'));
  assert.equal(title(T.last('sendMessage').params.text), first);
  // «вчера» показывали — сегодня первым другой план
  await store.set('u:11', Object.assign(u, { shown: u.shown.map(([id, d]) => [id, d - 1]) }));
  await bot.handle(msg('свидание сегодня вечером'));
  assert.notEqual(title(T.last('sendMessage').params.text), first);
});

test('«рядом» — не дальше 25 минут: со станцией дальние планы не предлагаем, в «почему» — минуты', () => {
  const q = parse('свидание у Чистых прудов');
  const r = C.P.plans(q, { city: 'msk', mode: 'date', limit: 3 });
  assert.ok(r.length >= 1);
  r.forEach(x => assert.ok(x.min == null || x.min <= 25, x.plan.title + ': ' + x.min + ' мин'));
  assert.ok(r.some(x => x.why.some(w => /мин (пешком )?от м\. Чистые пруды/.test(w.t))), 'минуты от станции');
});

test('бот: «📷 Фото» — альбом снимков плана, у каждого место, автор и лицензия', async () => {
  const p = C.D.scenarios.find(s => C.K.planStops(s).reduce((n, x) => n + (x.ph ? 1 + (x.gal || []).length : 0), 0) >= 3);
  if (!p) return;   // галерей в каталоге нет — нечего проверять
  const { T, bot } = make();
  await bot.handle({ callback_query: { id: 'f1', from: ann, data: 'f|' + p.id, message: { message_id: 101, chat: priv } } });
  const m = T.last('sendMediaGroup');
  assert.ok(m, 'альбом отправлен');
  assert.ok(m.params.media.length >= 2 && m.params.media.length <= 10);
  m.params.media.forEach(x => {
    assert.match(x.media, /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\//);
    assert.match(x.caption, /📷 .+ · Wikimedia Commons$/);
  });
});

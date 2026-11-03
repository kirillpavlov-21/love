/* Бот «Куда идём?» для Telegram — то же, что главная сайта, только в чате.
   ─ Любая фраза в личке («свидание недорого под крышей», «нас пятеро в субботу, баня») → три плана с «почему» и события из афиши.
     Подбор — тот же, что на сайте: KudaIntent + KudaPick из assets/ (bot/catalog.mjs грузит их вместе с каталогом).
     Кнопки: «Голосование в чат», «Ещё варианты», «Позвать игрой» (конструктор сайта с этими планами), «Открыть на сайте».
   ─ /podobrat — квиз кнопками, /udivi — «Удиви меня» с фото, /afisha — что идёт сегодня, завтра и на выходных, /gorod — Москва или Петербург.
   ─ Голосование кнопками работает в любом чате, бота туда добавлять не нужно: «@бот что хотим» в поле ввода или кнопка
     «Голосование в чат» → карточка с вариантами; каждый жмёт свои (ещё раз — снять голос), карточка показывает, кто за что и кто лидирует.
   ─ Бот в группе: /opros [что хотим] — нативный опрос Telegram (открытый, можно несколько ответов), /kogda — опрос по дням недели;
     в группе бот отвечает только на команды, на «@бот …» и на ответы на свои сообщения.
   ─ Хранилище (bot/store.mjs): u:<id> — город и режим человека, q:<id> — запрос и показанные планы, v:<id> — голосование.
   Имена каналов и источников бот не пишет: тексты планов и событий — те же, что на сайте.
   createBot({ api, store, catalog, site, name, log }) → { handle(update), COMMANDS } */

const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '11.', '12.'];
const TTL = { user: 365 * 86400, query: 2 * 86400, fresh: 3 * 3600, vote: 30 * 86400 };
const MAX_POLL = 10;
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cut = (s, n) => { s = String(s || '').trim(); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'; };
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const rid = (n = 8) => Array.from(crypto.getRandomValues(new Uint8Array(n)), x => ALPHA[x % ALPHA.length]).join('');
/* Короткий номер плана для кнопок и ссылок t.me/<бот>?start=… (там до 64 знаков): FNV-1a от id → 6 знаков base36 */
const ref = id => { let h = 0x811c9dc5; for (const ch of String(id)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36).padStart(6, '0').slice(-6); };
const b64u = s => Buffer.from(s, 'utf8').toString('base64url');
const unb64u = s => { try { return Buffer.from(s, 'base64url').toString('utf8'); } catch (e) { return ''; } };
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MODE_WORD = { date: 'свидание', guys: 'с друзьями', girls: 'с подругами' };

export const COMMANDS = [
  { command: 'podobrat', description: 'Подобрать план за 10 секунд' },
  { command: 'udivi', description: 'Удиви меня' },
  { command: 'afisha', description: 'Афиша: сегодня, завтра, выходные' },
  { command: 'opros', description: 'Опрос «куда идём» (в группе)' },
  { command: 'kogda', description: 'Опрос «когда всем удобно»' },
  { command: 'gorod', description: 'Москва или Петербург' },
  { command: 'help', description: 'Как пользоваться' },
];

export function createBot({ api, store, catalog, site, name = '', log = () => {} }) {
  const SITE = (site || 'https://kirillpavlov-21.github.io/love/').replace(/\/?$/, '/');
  let botName = name;
  const REFS = new WeakMap();
  const planByRef = (C, r) => {
    if (!REFS.has(C)) REFS.set(C, new Map(C.D.scenarios.filter(s => s && s.id).map(s => [ref(s.id), s])));
    return REFS.get(C).get(r) || null;
  };

  /* ---------- люди и ссылки ---------- */
  const userOf = async id => Object.assign({ city: 'msk', mode: '' }, await store.get('u:' + id));
  const saveUser = (id, u) => store.set('u:' + id, { city: u.city, mode: u.mode }, TTL.user);
  const cq = c => (c === 'spb' ? '&city=spb' : '');
  const U = {
    plan: (p, c) => SITE + 'start.html?plan=' + encodeURIComponent(p.id) + cq(c),
    place: (p, c) => SITE + 'start.html?place=' + encodeURIComponent(p.id) + cq(c),
    route: p => SITE + 'go.html#r=' + encodeURIComponent(p.id),
    event: (e, c) => SITE + 'start.html?event=' + encodeURIComponent(e.id) + cq(c),
    ask: (t, c, m) => SITE + 'start.html?m=' + (m || 'date') + cq(c) + (t ? '&q=' + encodeURIComponent(cut(t, 120)) : ''),
    home: (c, tab) => SITE + 'start.html' + (c === 'spb' ? '?city=spb' : '') + (tab ? (c === 'spb' ? '&' : '?') + 'tab=' + tab : ''),
    invite: (C, ids, m, c, title) => {
      const v = C.encodeList(ids);
      return SITE + 'create.html?mode=' + (m || 'date') + cq(c) + (v ? '&list=' + v + '&t=' + encodeURIComponent(cut(title, 40)) : '');
    },
    list: (C, ids, c, title) => {
      const v = C.encodeList(ids);
      return v ? SITE + 'start.html?list=' + v + cq(c) + '&t=' + encodeURIComponent(cut(title, 40)) : U.home(c);
    },
  };
  const absUrl = u => { try { return new URL(u, SITE).href; } catch (e) { return ''; } };

  /* ---------- отправка ---------- */
  const NOPREV = { is_disabled: true };
  const send = (chatId, text, kb, extra) => api('sendMessage', Object.assign({ chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: NOPREV }, kb ? { reply_markup: kb } : null, extra));
  const answerCb = (c, text) => api('answerCallbackQuery', Object.assign({ callback_query_id: c.id }, text ? { text } : null)).catch(() => {});
  const editCb = (c, text, kb) => api('editMessageText', Object.assign(
    c.inline_message_id ? { inline_message_id: c.inline_message_id } : { chat_id: c.message.chat.id, message_id: c.message.message_id },
    { text, parse_mode: 'HTML', link_preview_options: NOPREV }, kb ? { reply_markup: kb } : null)).catch(e => { if (!/not modified/i.test(e.description || '')) throw e; });
  /* Голоса одного голосования меняем по очереди: два нажатия одновременно не должны потерять голос */
  const LOCKS = new Map();
  function locked(key, fn) {
    const prev = LOCKS.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => {});
    LOCKS.set(key, tail);
    tail.then(() => { if (LOCKS.get(key) === tail) LOCKS.delete(key); });   // последний в очереди — убираем запись
    return next;
  }
  /* Не больше 40 обращений в минуту от одного человека: лишние молча пропускаем (бота нельзя «залить») */
  const RATE = new Map();
  function tooMany(uid) {
    if (!uid) return false;
    const t = Date.now(), r = RATE.get(uid);
    if (!r || t - r[1] > 60e3) { RATE.set(uid, [1, t]); if (RATE.size > 5000) RATE.clear(); return false; }
    r[0]++;
    return r[0] > 40;
  }

  /* ---------- подбор ---------- */
  async function pick(text, u, o = {}) {
    const C = await catalog();
    const q = C.I.parse(String(text || '').slice(0, 120), { city: u.city });
    const city = q.city || u.city || 'msk';
    const mode = q.mode || u.mode || o.mode || 'date';
    const skip = new Set(o.skip || []);
    const found = C.P.plans(q, { city, mode, anyMode: !q.mode, limit: o.limit || 3, skip });
    // назвали что-то конкретное — только планы, где это есть; иначе честное «не нашлось» и места
    const specific = q.words.length || q.tags.length || q.cats.length || q.kinds.length || q.ev.length || q.hints.length;
    const plans = specific ? found.filter(r => r.match) : found;
    const events = o.noEvents ? [] : C.P.events(q, { city, mode: q.mode || null, limit: 2 });
    const places = q.words.length ? C.P.places(q, { city, limit: 3 }) : [];
    return { C, q, city, mode: q.mode || (plans[0] && plans[0].plan.mode) || mode, plans, events, places };
  }
  const whyText = why => (why && why.length ? esc(why.map(w => w.e + ' ' + w.t).join(' · ')) : '');
  function planBlock(C, r, i, city) {
    const p = r.plan, st = C.K.planStops(p), w = whyText(r.why);
    return `${i == null ? '' : (NUM[i] || '•') + ' '}<b>${esc(p.title)}</b>\n${esc(st.map(x => x.name).join(' → '))}${w ? '\n' + w : ''}\n` +
      `<a href="${esc(U.plan(p, city))}">Подробнее</a> · <a href="${esc(U.route(p))}">Маршрут</a>`;
  }
  const eventLine = (r, city) => `• <a href="${esc(U.event(r.ev, city))}">${esc(r.ev.title)}</a>${r.why.length ? ' — ' + whyText(r.why) : ''}`;
  const placeLine = (r, city) => `• <a href="${esc(U.place(r.place, city))}">${esc(r.place.name)}</a> — ${esc(r.place.kind || '')}${r.why.length ? ' · ' + whyText(r.why) : ''}`;
  const titleOf = q => {
    const day = q.chips.find(c => c.k === 'day');
    return 'Куда идём' + (day ? ' ' + day.t : '') + '?';
  };
  function resultsText(R, head) {
    const { C, q, city } = R, out = [];
    const got = q.chips.length ? 'Понял так: ' + q.chips.map(c => c.e + ' ' + c.t).join(' · ') : '';
    out.push(`<b>${esc(head || (R.plans.length ? 'Вот что подходит' : 'Планов под это не нашлось'))}</b>${got ? '\n' + esc(got) : ''}`);
    if (R.places.length && !R.plans.length) out.push('📍 <b>Места</b>\n' + R.places.map(r => placeLine(r, city)).join('\n'));
    R.plans.forEach((r, i) => out.push(planBlock(C, r, i, city)));
    if (!R.plans.length) out.push('Попробуй проще: «свидание вечером», «бар с видом», «компы до утра».');
    if (R.places.length && R.plans.length) out.push('📍 <b>Места</b>\n' + R.places.map(r => placeLine(r, city)).join('\n'));
    if (R.events.length) out.push('📅 <b>В афише</b>\n' + R.events.map(r => eventLine(r, city)).join('\n'));
    return out.join('\n\n');
  }
  function resultsKb(R, qid, chatType, text) {
    const ids = R.plans.map(r => r.plan.id), rows = [];
    if (ids.length > 1) rows.push([chatType === 'private' ? { text: '🗳️ Голосование в чат', switch_inline_query: 'опрос ' + qid } : { text: '🗳️ Сделать опрос', callback_data: 'p|' + qid }]);
    const more = { text: '🔄 Ещё варианты', callback_data: 'm|' + qid };
    rows.push(ids.length ? [more, { text: R.mode === 'date' ? '💌 Позвать игрой' : '🎮 Позвать игрой', url: U.invite(R.C, ids, R.mode, R.city, text || titleOf(R.q)) }] : [more]);
    rows.push([{ text: '🌐 Открыть на сайте', url: U.ask(text, R.city, R.mode) }]);
    return { inline_keyboard: rows };
  }
  async function answerQuery(chat, from, u, text, o = {}) {
    text = String(text || '').slice(0, 120);
    const R = await pick(text, u, Object.assign({ mode: chat.type === 'private' ? 'date' : 'guys' }, o));
    // город и «с кем» из запроса запоминаем — в следующий раз подберём там же
    if ((R.q.city && R.q.city !== u.city) || (R.q.mode && R.q.mode !== u.mode)) {
      u.city = R.q.city || u.city; u.mode = R.q.mode || u.mode;
      await saveUser(from.id, u);
    }
    const qid = rid();
    await store.set('q:' + qid, { text, city: R.city, mode: R.mode, ids: R.plans.map(r => r.plan.id) }, TTL.query);
    return send(chat.id, resultsText(R, o.head), resultsKb(R, qid, chat.type, text));
  }

  /* ---------- голосование кнопками: работает в любом чате ---------- */
  const DRAFTS = 15;
  async function newVote(title, opts, link, uid) {
    const pid = rid();
    const V = { title, opts, link: link || '', votes: {}, at: Date.now() };
    await store.set('v:' + pid, V, TTL.fresh);   // не отправили — само исчезнет; первый голос продлит до 30 дней
    if (uid) {
      // inline-запрос приходит на каждое изменение текста: держим у человека не больше DRAFTS черновиков без голосов
      const key = 'd:' + uid, list = (await store.get(key)) || [];
      list.push(pid);
      while (list.length > DRAFTS) {
        const old = list.shift(), ov = await store.get('v:' + old);
        if (ov && !Object.keys(ov.votes || {}).some(k => (ov.votes[k] || []).length)) await store.del('v:' + old);
      }
      await store.set(key, list, TTL.fresh);
    }
    return { pid, V };
  }
  function voteText(V) {
    const tally = V.opts.map((o, i) => V.votes[i] || []);
    const max = Math.max(0, ...tally.map(t => t.length));
    const people = new Set(tally.flat().map(v => v[0])).size;
    const lines = V.opts.map((o, i) => {
      const vs = tally[i], names = vs.slice(0, 5).map(v => esc(v[1])).join(', ') + (vs.length > 5 ? ` +${vs.length - 5}` : '');
      return `${NUM[i] || '•'} ${o.url ? `<a href="${esc(o.url)}">${esc(o.t)}</a>` : esc(o.t)}${vs.length ? ` — <b>${vs.length}</b>: ${names}` : ''}`;
    });
    const lead = max ? V.opts.filter((o, i) => tally[i].length === max) : [];
    const foot = !people ? 'Пока никто не голосовал.'
      : lead.length === 1 ? `👑 Лидирует: <b>${esc(lead[0].t)}</b> · проголосовали: ${people}`
        : `🤝 Поровну: ${lead.map(o => esc(o.t)).join(' и ')} · проголосовали: ${people}`;
    return `🗳️ <b>${esc(V.title)}</b>\nЖми на подходящие варианты — можно несколько. Нажмёшь ещё раз — голос снимется.\n\n${lines.join('\n')}\n\n${foot}`;
  }
  function voteKb(pid, V) {
    const rows = V.opts.map((o, i) => [{ text: `${NUM[i] || i + 1 + '.'} ${cut(o.t, 38)}${(V.votes[i] || []).length ? ' · ' + V.votes[i].length : ''}`, callback_data: `v|${pid}|${i}` }]);
    if (V.link) rows.push([{ text: '🌐 Все варианты на сайте', url: V.link }]);
    return { inline_keyboard: rows };
  }
  async function onVote(c, pid, i) {
    if (!/^[A-Za-z0-9]{8}$/.test(pid || '') || !(i >= 0)) return answerCb(c);
    return locked('v:' + pid, async () => {
      const V = await store.get('v:' + pid);
      if (!V || !V.opts[i]) return answerCb(c, 'Это голосование устарело — собери новое');
      const me = [c.from.id, cut(c.from.first_name || c.from.username || 'Гость', 24)];
      const list = V.votes[i] || [];
      const had = list.findIndex(v => v[0] === me[0]);
      if (had >= 0) list.splice(had, 1); else list.push(me);
      V.votes[i] = list;
      await store.set('v:' + pid, V, TTL.vote);
      await editCb(c, voteText(V), voteKb(pid, V));
      return answerCb(c, had >= 0 ? 'Голос снят' : 'Голос учтён ✓');
    });
  }
  /* Варианты для голосования: планы (с ссылкой на сайт) или дни недели */
  const planOpts = (C, plans, city) => plans.slice(0, MAX_POLL).map(p => ({ t: cut(p.title, 60), url: U.plan(p, city), id: p.id }));
  function dayOpts(C, n) {
    const out = [], today = C.K.todayMsk();
    for (let k = 0; k < (n || 7); k++) {
      const d = C.K.numDay(C.K.dayNum(today) + k), [y, m, dd] = d.split('-').map(Number), wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
      out.push({ t: (k === 0 ? 'Сегодня' : k === 1 ? 'Завтра' : WD[wd].replace(/^./, s => s.toUpperCase())) + `, ${dd} ${MON[m - 1]}` });
    }
    return out;
  }
  async function voteArticle(title, opts, link, desc, uid) {
    const { pid, V } = await newVote(title, opts, link, uid);
    return {
      type: 'article', id: 'v' + pid, title: '🗳️ ' + title, description: desc || opts.map(o => o.t).join(' · ').slice(0, 200),
      input_message_content: { message_text: voteText(V), parse_mode: 'HTML', link_preview_options: NOPREV },
      reply_markup: voteKb(pid, V),
    };
  }
  /* Нативный опрос Telegram: только там, где бот есть (группа или личка). Голоса считает сам Telegram */
  async function nativePoll(chatId, question, opts, after) {
    if (opts.length < 2) return send(chatId, 'Для опроса нужно хотя бы два варианта — уточни запрос, например: <code>/opros баня или бар в пятницу</code>');
    await api('sendPoll', { chat_id: chatId, question: cut(question, 300), options: opts.slice(0, 12).map(o => ({ text: cut(o.t, 100) })), is_anonymous: false, allows_multiple_answers: true });
    if (after) await send(chatId, after);
  }

  /* ---------- сценарии ---------- */
  async function welcome(chat, u) {
    const C = await catalog().catch(() => null);
    // город плана — по id (spb-… — Петербург), как DateKit.cityOf: без 650 вопросов песочнице
    const n = C ? C.D.scenarios.filter(s => (String(s.id).startsWith('spb-') ? 'spb' : 'msk') === u.city).length : 0;
    const cityName = u.city === 'spb' ? 'Петербурге' : 'Москве';
    const at = botName ? '@' + botName : 'меня';
    const text = `Привет! Подскажу, куда пойти в ${cityName}: на свидание, с друзьями или с подругами${n ? ` — у меня ${Math.floor(n / 10) * 10}+ готовых планов` : ''}.\n\n` +
      'Напиши, что хочется, обычными словами:\n• <i>свидание недорого, если дождь</i>\n• <i>нас пятеро в субботу, баня</i>\n• <i>бар с видом у Чистых прудов</i>\n\n' +
      `В любом чате набери ${esc(at)} и что хотите — соберу голосование «куда идём», добавлять меня в чат не нужно.`;
    const rows = [
      [{ text: '🎯 Подобрать за 10 секунд', callback_data: 'z' }, { text: '🎲 Удиви меня', callback_data: 's' }],
      [{ text: '📅 Афиша сегодня', callback_data: 'a|today' }, { text: '🗳️ Голосование в чат', switch_inline_query: '' }],
      [{ text: `📍 Город: ${u.city === 'spb' ? 'Петербург' : 'Москва'} · сменить`, callback_data: 'c|' + (u.city === 'spb' ? 'msk' : 'spb') }],
    ];
    if (chat.type === 'private') rows.push([{ text: '🌐 Открыть приложение', web_app: { url: U.home(u.city) } }]);
    return send(chat.id, text, { inline_keyboard: rows });
  }
  async function start(msg, u, arg) {
    const chat = msg.chat;
    let m;
    if ((m = /^plan_([a-z0-9]{6})$/i.exec(arg))) {
      const C = await catalog(), p = planByRef(C, m[1].toLowerCase());
      if (p) return send(chat.id, planBlock(C, { plan: p, why: [] }, null, C.K.cityOf(p)), { inline_keyboard: [[{ text: '🗳️ Голосование в чат', switch_inline_query: p.title.slice(0, 40) }]] });
    }
    if ((m = /^q_([A-Za-z0-9_-]{2,60})$/.exec(arg))) { const t = unb64u(m[1]); if (t) return answerQuery(chat, msg.from, u, t); }
    // с сайта: «Голосование в Telegram» — t.me/<бот>?start=poll_<номер>_<номер>…
    if ((m = /^poll_((?:[a-z0-9]{6}_){1,9}[a-z0-9]{6})$/i.exec(arg))) {
      const C = await catalog(), plans = m[1].toLowerCase().split('_').map(r => planByRef(C, r)).filter(Boolean);
      if (plans.length > 1) {
        const city = C.K.cityOf(plans[0]), qid = rid();
        await store.set('q:' + qid, { text: '', city, mode: plans[0].mode, ids: plans.map(p => p.id) }, TTL.query);
        const body = plans.map((p, i) => planBlock(C, { plan: p, why: [] }, i, city)).join('\n\n');
        return send(chat.id, `<b>Варианты для голосования</b>\n\n${body}\n\nЖми «Голосование в чат» и выбери чат компании — там появится карточка с кнопками.`,
          { inline_keyboard: [[{ text: '🗳️ Голосование в чат', switch_inline_query: 'опрос ' + qid }]] });
      }
    }
    return welcome(chat, u);
  }
  const help = (chat, u) => welcome(chat, u);

  /* Квиз: с кем → бюджет → когда; ответы — в данных кнопок (z|date|1|eve), хранилище не нужно */
  const QUIZ = {
    who: [['date', '💕 Свидание'], ['guys', '🍻 С друзьями'], ['girls', '💅 С подругами']],
    bud: [['1', `💸 До 1 500 ₽`], ['2', `💳 До 3 000 ₽`], ['0', '✨ Неважно']],
    when: [['eve', '🌆 Сегодня вечером'], ['tom', '📅 Завтра вечером'], ['wke', '☀️ На выходных'], ['late', '🌙 Поздно, после 22:00']],
  };
  const QUIZ_TEXT = { bud: { 1: 'недорого', 2: 'до 3000', 0: '' }, when: { eve: 'сегодня вечером', tom: 'завтра вечером', wke: 'на выходных', late: 'сегодня допоздна' } };
  const qzKb = (pre, list) => ({ inline_keyboard: list.map(([v, t]) => [{ text: t, callback_data: pre + '|' + v }]) });
  async function quiz(c, parts) {
    const chat = c.message.chat;
    const [, who, bud, when] = parts;
    if (!who) return quizStart(chat);   // с кнопки приветствия — новым сообщением, приветствие остаётся
    if (bud == null) return editCb(c, '<b>Подобрать за 10 секунд</b> · 2 из 3\nБюджет на человека?', qzKb('z|' + who, QUIZ.bud));
    if (!when) return editCb(c, '<b>Подобрать за 10 секунд</b> · 3 из 3\nКогда?', qzKb('z|' + who + '|' + bud, QUIZ.when));
    const text = [MODE_WORD[who] || '', QUIZ_TEXT.bud[bud] || '', QUIZ_TEXT.when[when] || ''].filter(Boolean).join(' ');
    const u = await userOf(c.from.id);
    if (MODE_WORD[who]) { u.mode = who; await saveUser(c.from.id, u); }
    await editCb(c, `<b>Подобрать за 10 секунд</b> ✓\n${esc(text)}`);
    return answerQuery(chat, c.from, u, text, { head: 'Подобрал' });
  }
  async function quizStart(chat) {
    return send(chat.id, '<b>Подобрать за 10 секунд</b> · 1 из 3\nС кем идёшь?', qzKb('z', QUIZ.who));
  }

  async function surprise(chat, u) {
    const C = await catalog(), city = u.city || 'msk', mode = u.mode || (chat.type === 'private' ? 'date' : 'guys');
    const r = C.P.plans(C.I.parse('удиви меня', { city }), { city, mode, limit: 1 })[0];
    if (!r) return send(chat.id, 'Сейчас нечего предложить — попробуй позже.');
    const p = r.plan, ph = C.K.planPhoto(p);
    const kb = { inline_keyboard: [[{ text: '🎲 Ещё раз', callback_data: 's' }, { text: p.mode === 'date' ? '💌 Позвать сюда' : '🎮 Позвать сюда', url: SITE + 'create.html?mode=' + p.mode + '&plan=' + encodeURIComponent(p.id) + cq(city) }]] };
    const caption = '🎲 <b>Удиви меня</b>\n\n' + planBlock(C, r, null, city);
    const src = ph ? absUrl(ph.s) : '';
    // фото — только снимки со свободной лицензией из assets/photos.js; подпись автора и лицензии обязательна
    if (src && /^https:/.test(src) && !/\.webp(\?|$)/i.test(src)) {
      const credit = `\n\n<i>Фото: ${esc(C.K.cleanAuthor(ph.a) || 'автор на Wikimedia Commons')}${ph.l ? ', ' + esc(ph.l) : ''} · ${ph.src === 'Flickr' ? 'Flickr' : 'Wikimedia Commons'}</i>`;
      try { return await api('sendPhoto', { chat_id: chat.id, photo: src, caption: cut(caption, 900) + credit, parse_mode: 'HTML', reply_markup: kb }); } catch (e) { log('sendPhoto', e.message); }
    }
    return send(chat.id, caption, kb);
  }

  const AF = { today: 'сегодня', tomorrow: 'завтра', weekend: 'на выходных' };
  async function afisha(chat, u, arg) {
    const C = await catalog(), city = u.city || 'msk';
    const when = /tomorrow|завтр/i.test(arg || '') ? 'tomorrow' : /weekend|выходн/i.test(arg || '') ? 'weekend' : 'today';
    const extra = String(arg || '').replace(/today|tomorrow|weekend|сегодня|завтра|на выходных|выходные/ig, '').trim();
    const q = C.I.parse(AF[when] + ' ' + extra, { city });
    const evs = C.P.events(q, { city, limit: 8 });
    const head = `📅 <b>Афиша ${city === 'spb' ? 'Петербурга' : 'Москвы'} · ${AF[when]}</b>`;
    const body = evs.length ? evs.map(r => eventLine(r, city)).join('\n') : 'Пока ничего не нашлось — загляни во всю афишу на сайте.';
    const kb = { inline_keyboard: [
      Object.keys(AF).map(k => ({ text: (k === when ? '• ' : '') + AF[k].replace(/^./, s => s.toUpperCase()), callback_data: 'a|' + k })),
      [{ text: '🌐 Вся афиша', url: U.home(city, 'events') }],
    ] };
    return send(chat.id, head + '\n\n' + body, kb);
  }

  async function groupPoll(msg, u, arg) {
    const chat = msg.chat;
    if (chat.type === 'private') return answerQuery(chat, msg.from, u, arg || (u.mode === 'date' ? 'свидание' : 'с друзьями'), { limit: 4, head: 'Варианты для опроса' });
    const R = await pick(arg, u, { mode: 'guys', limit: 4, noEvents: true });
    const opts = planOpts(R.C, R.plans.map(r => r.plan), R.city);
    const links = R.plans.map((r, i) => `${NUM[i]} <a href="${esc(U.plan(r.plan, R.city))}">${esc(r.plan.title)}</a>${r.why.length ? ' — ' + whyText(r.why) : ''}`).join('\n');
    return nativePoll(chat.id, titleOf(R.q), opts, links ? 'Подробнее о вариантах:\n' + links + '\n\nКогда удобно — /kogda' : '');
  }
  async function daysPoll(msg) {
    const chat = msg.chat, C = await catalog();
    if (chat.type === 'private') return send(chat.id, 'Выбери чат компании — там появится карточка с днями недели, каждый отметит свои.', { inline_keyboard: [[{ text: '📅 Голосование по дням в чат', switch_inline_query: 'когда' }]] });
    return nativePoll(chat.id, 'Когда всем удобно?', dayOpts(C, 7));
  }
  async function cityMenu(chat, u) {
    return send(chat.id, `Сейчас подбираю ${u.city === 'spb' ? 'в Петербурге' : 'в Москве'}. Сменить?`, { inline_keyboard: [[{ text: (u.city !== 'spb' ? '✓ ' : '') + 'Москва', callback_data: 'c|msk' }, { text: (u.city === 'spb' ? '✓ ' : '') + 'Петербург', callback_data: 'c|spb' }]] });
  }

  /* ---------- входящие ---------- */
  async function onMessage(msg) {
    const chat = msg.chat, text = String(msg.text || '').trim();
    if (!text || !msg.from || msg.from.is_bot) return;
    const priv = chat.type === 'private';
    const u = await userOf(msg.from.id);
    const cmd = /^\/([a-z_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/i.exec(text);
    if (cmd && cmd[2] && botName && cmd[2].toLowerCase() !== botName.toLowerCase()) return;   // команда другому боту
    if (cmd) {
      const arg = (cmd[3] || '').trim();
      switch (cmd[1].toLowerCase()) {
        case 'start': return start(msg, u, arg);
        case 'podobrat': case 'quiz': return quizStart(chat);
        case 'udivi': case 'random': return surprise(chat, u);
        case 'afisha': return afisha(chat, u, arg);
        case 'opros': case 'poll': return groupPoll(msg, u, arg);
        case 'kogda': case 'when': return daysPoll(msg);
        case 'gorod': case 'city': return cityMenu(chat, u);
        default: return priv ? help(chat, u) : null;
      }
    }
    // в группе — только «@бот …» и ответ на сообщение бота
    if (!priv) {
      const mention = botName && text.toLowerCase().includes('@' + botName.toLowerCase());
      const reply = msg.reply_to_message && msg.reply_to_message.from && botName && msg.reply_to_message.from.username === botName;
      if (!mention && !reply) return;
    }
    const q = botName ? text.replace(new RegExp('@' + botName, 'ig'), ' ').trim() : text;
    return answerQuery(chat, msg.from, u, q);
  }

  async function onCallback(c) {
    const parts = String(c.data || '').split('|'), k = parts[0];
    if (k === 'v') return onVote(c, parts[1], +parts[2]);
    // остальные кнопки — только в сообщениях бота (у карточек из inline-режима нет чата)
    if (!c.message) return answerCb(c);
    const chat = c.message.chat, u = await userOf(c.from.id);
    if (k === 'z') { await answerCb(c); return quiz(c, parts); }
    if (k === 's') { await answerCb(c); return surprise(chat, u); }
    if (k === 'a') { await answerCb(c); return afisha(chat, u, parts[1]); }
    if (k === 'c') {
      u.city = parts[1] === 'spb' ? 'spb' : 'msk';
      await saveUser(c.from.id, u);
      await answerCb(c, u.city === 'spb' ? 'Теперь — Петербург' : 'Теперь — Москва');
      return send(chat.id, `📍 Подбираю ${u.city === 'spb' ? 'в Петербурге' : 'в Москве'}. Напиши, что хочется, или /podobrat.`);
    }
    if (k === 'm' || k === 'p') {
      const Q = /^[A-Za-z0-9]{8}$/.test(parts[1] || '') ? await store.get('q:' + parts[1]) : null;
      if (!Q) return answerCb(c, 'Запрос устарел — напиши его ещё раз');
      await answerCb(c);
      const uu = Object.assign({}, u, { city: Q.city, mode: Q.mode });
      if (k === 'm') {
        const R = await pick(Q.text, uu, { skip: Q.ids, mode: Q.mode, noEvents: true });
        if (!R.plans.length) return send(chat.id, 'Больше вариантов под этот запрос нет — попробуй другие слова.');
        Q.ids = Q.ids.concat(R.plans.map(r => r.plan.id)).slice(-30);
        await store.set('q:' + parts[1], Q, TTL.query);
        return send(chat.id, resultsText(R, 'Ещё варианты'), resultsKb(R, parts[1], chat.type, Q.text));
      }
      const C = await catalog(), plans = Q.ids.map(id => C.K.planById(id)).filter(Boolean).slice(-MAX_POLL);
      return nativePoll(chat.id, titleOf(C.I.parse(Q.text, { city: Q.city })), planOpts(C, plans, Q.city));
    }
    return answerCb(c);
  }

  async function onInline(iq) {
    const text = String(iq.query || '').trim().slice(0, 120);
    const u = await userOf(iq.from.id);
    const results = [];
    let m;
    if ((m = /^(?:опрос|голосование)\s+([A-Za-z0-9]{8})$/i.exec(text))) {
      const Q = await store.get('q:' + m[1]);
      const C = await catalog();
      const plans = Q ? Q.ids.map(id => C.K.planById(id)).filter(Boolean).slice(0, MAX_POLL) : [];
      if (plans.length > 1) results.push(await voteArticle(titleOf(C.I.parse(Q.text, { city: Q.city })), planOpts(C, plans, Q.city), U.list(C, plans.map(p => p.id), Q.city, Q.text || 'Куда идём'), '', iq.from.id));
    } else if (/^(когда|дни|дата|по дням)$/i.test(text)) {
      const C = await catalog();
      results.push(await voteArticle('Когда всем удобно?', dayOpts(C, 7), '', 'Ближайшие 7 дней — каждый отметит свои', iq.from.id));
    } else {
      const R = await pick(text, u, { limit: 5, mode: u.mode || 'guys', noEvents: true });
      const plans = R.plans.map(r => r.plan);
      if (plans.length > 1) results.push(await voteArticle(titleOf(R.q), planOpts(R.C, plans.slice(0, 4), R.city), U.list(R.C, plans.slice(0, 4).map(p => p.id), R.city, text || 'Куда идём'), 'Голосование: ' + plans.slice(0, 4).map(p => p.title).join(' · '), iq.from.id));
      R.plans.forEach(r => {
        const p = r.plan, ph = R.C.K.planPhoto(p), th = ph ? absUrl(ph.t) : '';
        results.push(Object.assign({
          type: 'article', id: 'p' + ref(p.id), title: p.title,
          description: cut(R.C.K.planStops(p).map(x => x.name).join(' → ') + (r.why.length ? ' · ' + r.why.map(w => w.t).join(' · ') : ''), 200),
          input_message_content: { message_text: planBlock(R.C, r, null, R.city), parse_mode: 'HTML', link_preview_options: NOPREV },
          reply_markup: { inline_keyboard: [[{ text: 'Подробнее', url: U.plan(p, R.city) }, { text: 'Маршрут', url: U.route(p) }]] },
        }, th && /^https:/.test(th) && !/\.webp(\?|$)/i.test(th) ? { thumbnail_url: th } : null));
      });
    }
    return api('answerInlineQuery', { inline_query_id: iq.id, results: results.slice(0, 20), cache_time: 0, is_personal: true,
      button: { text: '💬 Подобрать в чате с ботом', start_parameter: 'inline' } });
  }

  async function handle(update) {
    const from = (update.message || update.callback_query || update.inline_query || {}).from;
    if (tooMany(from && from.id)) return null;
    try {
      if (update.message) return await onMessage(update.message);
      if (update.callback_query) return await onCallback(update.callback_query);
      if (update.inline_query) return await onInline(update.inline_query);
    } catch (e) {
      log('ошибка', e && e.message);
      const chatId = update.message ? update.message.chat.id : update.callback_query && update.callback_query.message ? update.callback_query.message.chat.id : null;
      if (update.callback_query) answerCb(update.callback_query, 'Что-то пошло не так — попробуй ещё раз');
      else if (chatId) send(chatId, 'Что-то пошло не так — попробуй ещё раз чуть позже.').catch(() => {});
    }
    return null;
  }
  return { handle, setName: n => { botName = n; }, ref, b64u, COMMANDS };
}

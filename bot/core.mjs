/* Бот «Куда идём?» для Telegram — то же, что главная сайта, только в чате.
   ─ Ответ — одна карточка, как в приложении: фото плана над текстом, «почему», факты, описание свёрнутой цитатой;
     ‹ › листают планы, «Другие варианты» меняют их — всё в том же сообщении. «Подробнее» в личке открывает сайт как Mini App.
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

const TTL = { user: 365 * 86400, query: 2 * 86400, fresh: 3 * 3600, vote: 30 * 86400, wish: 45 * 86400 };
const dayNo = () => Math.floor((Date.now() + 3 * 3600e3) / 864e5);   // день по Москве — что показывали «вчера и раньше»
const MAX_POLL = 10;
import { createHash } from 'node:crypto';

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cut = (s, n) => { s = String(s || '').trim(); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'; };
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const rid = (n = 8) => Array.from(crypto.getRandomValues(new Uint8Array(n)), x => ALPHA[x % ALPHA.length]).join('');
/* Короткий номер плана для кнопок и ссылок t.me/<бот>?start=… (там до 64 знаков): FNV-1a от id → 6 знаков base36 */
const ref = id => { let h = 0x811c9dc5; for (const ch of String(id)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36).padStart(6, '0').slice(-6); };
const b64u = s => Buffer.from(s, 'utf8').toString('base64url');
const GREET = /^(привет|приветик|приветствую|хай|хей|здравствуй|здравствуйте|hello|hi|hey|ку|йо|салют|добр(ый|ое|ого) (день|вечер|утро|дня|вечера|утра)|ты кто|кто ты|что ты умеешь|что умеешь|помощь|help|start|старт|начать)[\s!.?)]*$/i;
const THANKS = /^(спасибо|спс|сяб|благодарю|thanks|thx|пасиб[оа]?|круто|класс|супер|ок|окей|понял|ясно)[\s!.)]*$/i;
const unb64u = s => { try { return Buffer.from(s, 'base64url').toString('utf8'); } catch (e) { return ''; } };
/* Фото плана для превью над текстом: тот же снимок Wikimedia Commons, что на сайте, но jpg 960 px с upload.wikimedia.org
   (webp с сайта Telegram показывает плохо). Путь превью Commons — md5 от имени файла: /thumb/a/ab/Имя/960px-Имя */
const commonsThumb = (file, w = 960) => {
  const name = String(file || '').replace(/ /g, '_');
  if (!/\.(jpe?g|png)$/i.test(name)) return '';
  const h = createHash('md5').update(name).digest('hex'), e = encodeURIComponent(name);
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${h[0]}/${h.slice(0, 2)}/${e}/${w}px-${e}`;
};
// «м. Арбатская»; МЦД и электрички — как есть («Переделкино (МЦД-4)»), «Мытищи (ж/д)» → «ж/д Мытищи» (как DateKit.metroText)
const metroText = m => (/\(ж\/д\)$/.test(m) ? 'ж/д ' + m.replace(/\s*\(ж\/д\)$/, '') : /\(МЦД[^)]*\)$/.test(m) ? m : 'м. ' + m);
// в рублях, как на сайте (фокус-группа: «недорого» у всех своё): свидание — на двоих, компания — на человека
const PRICE_W = { date: ['', '💸 до 3 000 ₽ на двоих', '💳 3–6 тыс. ₽ на двоих', '💎 от 6 000 ₽ на двоих'], one: ['', '💸 до 1 500 ₽ на человека', '💳 1 500–3 000 ₽ на человека', '💎 от 3 000 ₽ на человека'] };
const WHEN_W = { утро: '🌅 утром', день: '☀️ днём', вечер: '🌆 вечером', ночь: '🌙 ночью' };
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MODE_WORD = { date: 'свидание', guys: 'с друзьями', girls: 'с подругами' };

export const COMMANDS = [
  { command: 'podobrat', description: 'Подобрать план за 10 секунд' },
  { command: 'top', description: 'Топ дня и недели' },
  { command: 'udivi', description: 'Удиви меня' },
  { command: 'afisha', description: 'Афиша: сегодня, завтра, выходные' },
  { command: 'opros', description: 'Опрос «куда идём» (в группе)' },
  { command: 'kogda', description: 'Опрос «когда всем удобно»' },
  { command: 'gorod', description: 'Москва или Петербург' },
  { command: 'help', description: 'Как пользоваться' },
];

/* Оформление бота при запуске: кнопка меню слева от поля ввода открывает сайт как Mini App (start.html?tg=1);
   описание («Что умеет бот») и короткое описание ставим, только если владелец не задал свои в @BotFather */
const DESCRIPTION = 'Подскажу, куда пойти в Москве и Петербурге: на свидание, с друзьями или с подругами. ' +
  'Напиши обычными словами, что хочется, — «свидание недорого, если дождь» — и получишь готовые планы с маршрутом. ' +
  'В любом чате набери моё имя и что хотите — соберу голосование «куда идём».';
const SHORT = 'Готовые планы на вечер в Москве и Петербурге и голосование «куда идём» в любом чате';
export async function setupBot(api, site, log = () => {}) {
  const url = String(site || 'https://kirillpavlov-21.github.io/love/').replace(/\/?$/, '/') + 'start.html?tg=1';
  await api('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Куда идём?', web_app: { url } } }).catch(e => log('кнопка меню не поставилась:', e.message));
  const d = await api('getMyDescription').catch(() => null);
  if (d && !d.description) await api('setMyDescription', { description: DESCRIPTION }).catch(e => log('описание не поставилось:', e.message));
  const s = await api('getMyShortDescription').catch(() => null);
  if (s && !s.short_description) await api('setMyShortDescription', { short_description: SHORT }).catch(e => log('короткое описание не поставилось:', e.message));
}

/* audit(запись) — только для тестеров (/start tester_<код>): что они пишут и нажимают — для разбора, где бот путает (poll.mjs пишет в ~/.kuda/logs/testers.jsonl) */
export function createBot({ api, store, catalog, site, name = '', log = () => {}, audit = null }) {
  const SITE = (site || 'https://kirillpavlov-21.github.io/love/').replace(/\/?$/, '/');
  let botName = name;
  const REFS = new WeakMap();
  const planByRef = (C, r) => {
    if (!REFS.has(C)) REFS.set(C, new Map(C.D.scenarios.filter(s => s && s.id).map(s => [ref(s.id), s])));
    return REFS.get(C).get(r) || null;
  };

  /* ---------- люди и ссылки ---------- */
  const userOf = async id => Object.assign({ city: 'msk', mode: '' }, await store.get('u:' + id));
  const saveUser = (id, u) => store.set('u:' + id, Object.assign({ city: u.city, mode: u.mode }, u.tester ? { tester: u.tester } : null,
    u.shown && u.shown.length ? { shown: u.shown.slice(-40) } : null), TTL.user);
  const cq = c => (c === 'spb' ? '&city=spb' : '');
  const U = {
    plan: (p, c) => SITE + 'start.html?plan=' + encodeURIComponent(p.id) + cq(c),
    place: (p, c) => SITE + 'start.html?place=' + encodeURIComponent(p.id) + cq(c),
    route: p => SITE + 'go.html#r=' + encodeURIComponent(p.id),
    event: (e, c) => SITE + 'start.html?event=' + encodeURIComponent(e.id) + cq(c),
    ask: (t, c, m) => SITE + 'start.html?m=' + (m || 'date') + cq(c) + (t ? '&q=' + encodeURIComponent(cut(t, 120)) : ''),
    // сайт как Mini App в Telegram (assets/tgapp.js): кнопки web_app в личке и меню чата
    app: (c, extra) => SITE + 'start.html?tg=1' + cq(c) + (extra ? '&' + extra : ''),
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

  /* ---------- отправка ---------- */
  const NOPREV = { is_disabled: true };
  const send = (chatId, text, kb, extra) => api('sendMessage', Object.assign({ chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: NOPREV }, kb ? { reply_markup: kb } : null, extra));
  const answerCb = (c, text) => api('answerCallbackQuery', Object.assign({ callback_query_id: c.id }, text ? { text } : null)).catch(() => {});
  const editCb = (c, text, kb, preview) => api('editMessageText', Object.assign(
    c.inline_message_id ? { inline_message_id: c.inline_message_id } : { chat_id: c.message.chat.id, message_id: c.message.message_id },
    { text, parse_mode: 'HTML', link_preview_options: preview || NOPREV }, kb ? { reply_markup: kb } : null)).catch(e => { if (!/not modified/i.test(e.description || '')) throw e; });
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
    // одному — без «свидания» по умолчанию; сохранённый «с кем» человека тоже держим (иначе «баня» у парня — женская баня)
    const mode = q.mode || u.mode || (q.solo ? 'guys' : o.mode) || 'date';
    const skip = new Set(o.skip || []), n = o.limit || 3;
    // показанное в прошлые дни — ниже: повторы делают каталог из 650 планов похожим на каталог из двадцати (фокус-группа)
    const seen = (u.shown || []).filter(x => x[1] < dayNo()).map(x => x[0]);
    // берём с запасом и только потом оставляем n: иначе подходящие планы терялись за лимитом до фильтра
    let found = C.P.plans(q, { city, mode, anyMode: !q.mode && (!u.mode || q.solo), limit: 30, skip, seen });
    // назвали что-то конкретное — сначала планы, где это есть. Таких нет — лучшие по остальному с честной пометкой, а не пустой ответ:
    // в тестах «как пишут люди» треть запросов уходила в «не нашлось» из-за одного незнакомого слова
    const specific = q.words.length || q.tags.length || q.cats.length || q.kinds.length || q.ev.length || q.hints.length;
    let strict = specific ? found.filter(r => r.match) : found;
    // своего режима не хватило («батуты» у того, кто обычно с друзьями, есть только у подруг) — смотрим все режимы, раз «с кем» не сказали
    if (specific && !strict.length && !q.mode && u.mode) {
      const any = C.P.plans(q, { city, mode, anyMode: true, limit: 30, skip, seen }), hit = any.filter(r => r.match);
      if (hit.length) { found = any; strict = hit; }
    }
    // «по остальному» — только если что-то кроме незнакомых слов поняли (с кем, когда, бюджет, занятие); на бессмыслицу — честное «не нашлось»
    const soft = !!specific && !strict.length && found.length > 0 && (q.chips.length > 0 || q.kinds.length > 0);
    const plans = (soft ? found : strict).slice(0, n);
    const events = o.noEvents ? [] : C.P.events(q, { city, mode: q.mode || null, limit: 2 });
    const places = q.words.length || q.kinds.length ? C.P.places(q, { city, limit: 3 }) : [];
    return { C, q, city, mode: q.mode || (plans[0] && plans[0].plan.mode) || mode, plans, events, places, soft };
  }
  const whyText = why => (why && why.length ? esc(why.map(w => w.e + ' ' + w.t).join(' · ')) : '');
  /* Карточка плана — одно сообщение, как в приложении: снимок над текстом (превью ссылки на фото Commons), название и остановки,
     «почему» и короткие факты, описание — свёрнутой цитатой, внизу автор и лицензия снимка (без них фото не показываем) */
  function planCard(C, p, why, city, o = {}) {
    const st = C.K.planStops(p), ph = C.K.planPhoto(p);
    const img = ph && ph.src !== 'Flickr' ? commonsThumb(ph.file) : '';
    const price = Math.max(0, ...st.map(x => +x.price || 0));
    const facts = [st[0] && st[0].metro ? '🚇 ' + esc(metroText(st[0].metro)) : '', PRICE_W[p.mode === 'date' ? 'date' : 'one'][price] || '', WHEN_W[p.when] || ''].filter(Boolean).join(' · ');
    const w = whyText(why), out = [];
    if (o.top) out.push(o.top, '');
    out.push(`${esc(p.emoji || '📍')} <b>${esc(p.title)}</b>`, `<i>${esc(st.map(x => x.name).join(' → '))}</i>`);
    if (w || facts) out.push('', ...[w, facts].filter(Boolean));
    if (p.why) out.push('', `<blockquote expandable>${esc(p.why)}</blockquote>`);
    if (o.foot) out.push('', o.foot);
    if (img) out.push('', `<i>📷 ${esc(C.K.cleanAuthor(ph.a) || 'автор на Wikimedia Commons')}${ph.l ? ', ' + esc(ph.l) : ''} · Wikimedia Commons</i>`);
    return { text: out.join('\n'), preview: img ? { url: img, prefer_large_media: true, show_above_text: true } : NOPREV };
  }
  /* Все снимки плана с Commons (главные и галереи остановок, assets/gallery.js) — для альбома «📷 Фото»: выбирают глазами */
  const planPhotos = (C, p) => {
    const seen = new Set(), out = [];
    for (const x of C.K.planStops(p)) for (const ph of (x.ph ? [x.ph, ...(x.gal || [])] : [])) {
      if (!ph || !ph.file || ph.src === 'Flickr' || seen.has(ph.file)) continue;
      seen.add(ph.file); out.push({ ph, name: x.name });
    }
    return out;
  };
  /* Кнопки карточки: листать ‹ ›, «Подробнее» (в личке — сразу Mini App), маршрут, голосование и игра-приглашение, другие варианты */
  function cardKb(C, Q, qid, i, p, priv) {
    const n = Q.ids.length, rows = [];
    if (n > 1) rows.push([{ text: '‹', callback_data: `g|${qid}|${(i + n - 1) % n}` }, { text: `${i + 1} из ${n}`, callback_data: 'x' }, { text: '›', callback_data: `g|${qid}|${(i + 1) % n}` }]);
    rows.push([priv ? { text: '✨ Подробнее', web_app: { url: U.app(Q.city, 'plan=' + encodeURIComponent(p.id)) } } : { text: '✨ Подробнее', url: U.plan(p, Q.city) },
      { text: '🗺 Маршрут', url: U.route(p) }]);
    const nph = planPhotos(C, p).length;
    if (nph >= 3) rows.push([{ text: `📷 Фото (${Math.min(nph, 10)})`, callback_data: 'f|' + p.id }]);
    const vote = n < 2 ? { text: '🗳️ Обсудить в чате', switch_inline_query: cut(p.title, 40) }
      : priv ? { text: '🗳️ Голосование в чат', switch_inline_query: 'опрос ' + qid } : { text: '🗳️ Опрос в чате', callback_data: 'p|' + qid };
    rows.push([vote, { text: Q.mode === 'date' ? '💌 Позвать игрой' : '🎮 Позвать игрой', url: U.invite(C, Q.ids, Q.mode, Q.city, Q.text || Q.title || 'Куда идём?') }]);
    if (!Q.fixed) rows.push([{ text: '🔄 Другие варианты', callback_data: 'm|' + qid }]);
    if (Q.soft && priv) rows.push([{ text: '🔔 Напиши, когда появится', callback_data: 'w|' + qid }]);
    return { inline_keyboard: rows };
  }
  function queryCard(C, Q, qid, i, priv) {
    const p = C.K.planById(Q.ids[i]);
    if (!p) return { text: 'Этот план убрали из каталога — посмотри другие варианты.', preview: NOPREV, kb: { inline_keyboard: [[{ text: '🔄 Другие варианты', callback_data: 'm|' + qid }]] } };
    return Object.assign(planCard(C, p, (Q.why || [])[i], Q.city, { top: Q.top, foot: Q.foot }), { kb: cardKb(C, Q, qid, i, p, priv) });
  }
  const cardArgs = card => [card.text, card.kb, card.preview];
  const sendCard = (chatId, card) => send(chatId, card.text, card.kb, { link_preview_options: card.preview });
  const eventLine = (r, city) => `${esc(r.ev.emoji || '🎫')} <a href="${esc(U.event(r.ev, city))}"><b>${esc(r.ev.title)}</b></a>` +
    (r.why.length || r.ev.venue ? `\n<i>${[whyText(r.why), r.ev.venue ? esc(cut(r.ev.venue, 48)) : ''].filter(Boolean).join(' · ')}</i>` : '');
  const placeLine = (r, city) => `📍 <a href="${esc(U.place(r.place, city))}"><b>${esc(r.place.name)}</b></a>${r.place.kind ? ' — ' + esc(r.place.kind) : ''}${r.why.length ? '\n<i>' + whyText(r.why) + '</i>' : ''}`;
  const titleOf = q => {
    const day = q.chips.find(c => c.k === 'day');
    return 'Куда идём' + (day ? ' ' + day.t : '') + '?';
  };
  // шапка карточки: как поняли запрос («🔎 свидание · вечером»), над ней — заголовок квиза или «Ещё варианты»
  const topOf = (R, head) => [head ? `<b>${esc(head)}</b>` : '', R.q.chips.length ? '🔎 <i>' + esc(R.q.chips.map(c => c.e + ' ' + c.t).join(' · ')) + '</i>' : '',
    R.soft ? `🤔 <i>${R.q.words.length ? `Про «${esc(R.q.words.join(' '))}» готовых планов нет` : 'Точно под это готовых планов нет'} — подобрал по остальному</i>` : ''].filter(Boolean).join('\n');
  const evFoot = R => [R.places.length && R.soft ? '📍 <b>Нашлись места</b>\n' + R.places.map(r => placeLine(r, R.city)).join('\n') : '',
    R.events.length ? '📅 <b>В афише</b>\n' + R.events.map(r => eventLine(r, R.city)).join('\n') : ''].filter(Boolean).join('\n\n');
  const queryOf = (R, text, head) => ({ text, city: R.city, mode: R.mode, title: titleOf(R.q), ids: R.plans.map(r => r.plan.id), why: R.plans.map(r => r.why), top: topOf(R, head), foot: evFoot(R),
    soft: !!R.soft, ev: R.events.map(r => r.ev.id) });
  function emptyText(R) {
    const out = [topOf(R, 'Планов под это не нашлось')];
    if (R.places.length) out.push('', '<b>Зато есть места</b>', R.places.map(r => placeLine(r, R.city)).join('\n'));
    if (R.events.length) out.push('', evFoot(R));
    out.push('', '<i>Попробуй проще: «свидание вечером», «бар с видом», «компы до утра».</i>');
    return out.join('\n');
  }
  const emptyKb = (R, text, qid) => ({ inline_keyboard: [
    ...(qid ? [[{ text: '🔔 Напиши, когда появится', callback_data: 'w|' + qid }]] : []),
    [{ text: '🎯 Подобрать за 10 секунд', callback_data: 'z' }, { text: '🎲 Удиви меня', callback_data: 's' }],
    [{ text: '🌐 Поискать на сайте', url: U.ask(text, R.city, R.mode) }],
  ] });
  async function answerQuery(chat, from, u, text, o = {}) {
    text = String(text || '').slice(0, 120);
    const R = await pick(text, u, Object.assign({ mode: chat.type === 'private' ? 'date' : 'guys' }, o));
    // город и «с кем» из запроса запоминаем — в следующий раз подберём там же
    if ((R.q.city && R.q.city !== u.city) || (R.q.mode && R.q.mode !== u.mode)) {
      u.city = R.q.city || u.city; u.mode = R.q.mode || u.mode;
      await saveUser(from.id, u);
    }
    const qid = rid(), Q = queryOf(R, text, o.head), priv = chat.type === 'private';
    // честное «нет» на конкретный запрос — с подпиской «напишу, когда появится» (только в личке: пишем человеку, а не в группу)
    const specific = R.q.words.length || R.q.tags.length || R.q.kinds.length || R.q.ev.length;
    if (!R.plans.length) {
      if (priv && specific) await store.set('q:' + qid, Q, TTL.query);
      return send(chat.id, emptyText(R), emptyKb(R, text, priv && specific ? qid : ''));
    }
    await store.set('q:' + qid, Q, TTL.query);
    if (priv) { const ids = Q.ids; u.shown = (u.shown || []).filter(x => !ids.includes(x[0])).concat(ids.map(id => [id, dayNo()])).slice(-40); await saveUser(from.id, u); }
    return sendCard(chat.id, queryCard(R.C, Q, qid, 0, priv));
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
    const lead = max ? V.opts.filter((o, i) => tally[i].length === max) : [];
    // у каждого варианта — полоска доли голосов ▰▰▱▱ и кто за него; лидер — с короной
    const lines = V.opts.map((o, i) => {
      const vs = tally[i], names = vs.slice(0, 5).map(v => esc(v[1])).join(', ') + (vs.length > 5 ? ` +${vs.length - 5}` : '');
      const k = people ? Math.round(vs.length / people * 8) : 0;
      const crown = lead.length === 1 && vs.length === max ? ' 👑' : '';
      const bar = people ? `\n${'▰'.repeat(k)}${'▱'.repeat(8 - k)} ${vs.length ? `<b>${vs.length}</b> · ${names}` : '0'}` : '';
      return `<b>${i + 1}.</b> ${o.url ? `<a href="${esc(o.url)}">${esc(o.t)}</a>` : esc(o.t)}${crown}${bar}`;
    });
    const foot = !people ? '<i>Пока никто не голосовал — будь первым</i>'
      : lead.length === 1 ? `👑 Лидирует: <b>${esc(lead[0].t)}</b> · проголосовали: ${people}`
        : `🤝 Поровну: ${lead.map(o => esc(o.t)).join(' и ')} · проголосовали: ${people}`;
    return `🗳️ <b>${esc(V.title)}</b>\n<i>Жми на всё, что подходит — можно несколько. Нажмёшь ещё раз — голос снимется.</i>\n\n${lines.join('\n\n')}\n\n${foot}`;
  }
  function voteKb(pid, V) {
    const rows = V.opts.map((o, i) => [{ text: `${i + 1}. ${cut(o.t, 34)}${(V.votes[i] || []).length ? '  ·  ' + V.votes[i].length : ''}`, callback_data: `v|${pid}|${i}` }]);
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
    const text = `👋 <b>Привет! Я — «Куда идём?»</b>\nПодскажу, куда пойти в ${cityName}: на свидание, с друзьями или с подругами${n ? ` — у меня ${Math.floor(n / 10) * 10}+ готовых планов` : ''}.\n\n` +
      '<b>Напиши, что хочется, обычными словами</b>\n<blockquote>свидание недорого, если дождь\nнас пятеро в субботу, баня\nбар с видом у Чистых прудов</blockquote>\n\n' +
      `🗳️ В любом чате набери <code>${esc(at)}</code> и что хотите — соберу голосование «куда идём». Добавлять меня в чат не нужно.`;
    const rows = [];
    if (chat.type === 'private') rows.push([{ text: '✨ Открыть приложение', web_app: { url: U.app(u.city, u.tester ? 'tester=' + encodeURIComponent(u.tester) : '') } }]);
    rows.push(
      [{ text: '🎯 Подобрать за 10 секунд', callback_data: 'z' }, { text: '🎲 Удиви меня', callback_data: 's' }],
      [{ text: '🔥 Топ недели', callback_data: 't' }, { text: '📅 Афиша сегодня', callback_data: 'a|today' }],
      [{ text: '🗳️ Голосование в чат', switch_inline_query: '' }],
      [{ text: `📍 ${u.city === 'spb' ? 'Петербург' : 'Москва'} · сменить город`, callback_data: 'c|' + (u.city === 'spb' ? 'msk' : 'spb') }],
    );
    // картинка сверху — обложка сайта (assets/og-hub.png), превью большой картинкой над текстом
    return send(chat.id, text, { inline_keyboard: rows }, { link_preview_options: { url: SITE + 'assets/og-hub.png', prefer_large_media: true, show_above_text: true } });
  }
  async function start(msg, u, arg) {
    const chat = msg.chat, priv = chat.type === 'private';
    let m;
    if ((m = /^plan_([a-z0-9]{6})$/i.exec(arg))) {
      const C = await catalog(), p = planByRef(C, m[1].toLowerCase());
      if (p) {
        const qid = rid(), Q = { text: '', city: C.K.cityOf(p), mode: p.mode, title: 'Куда идём?', ids: [p.id], why: [], top: '', foot: '', fixed: true };
        await store.set('q:' + qid, Q, TTL.query);
        return sendCard(chat.id, queryCard(C, Q, qid, 0, priv));
      }
    }
    // тест с живыми людьми: t.me/<бот>?start=tester_<код>; выйти — /stoptest
    if ((m = /^tester_([a-z0-9_-]{2,24})$/i.exec(arg)) && priv) {
      u.tester = m[1].toLowerCase();
      await saveUser(msg.from.id, u);
      await send(chat.id, `🧪 <b>Спасибо, что тестируешь!</b>\nКод теста: <code>${esc(u.tester)}</code>. Пользуйся ботом и приложением как обычно и пиши как есть — так, как написал бы другу.\n\n<i>Пока идёт тест, твои сообщения и нажатия в этом боте сохраняются у автора, чтобы понять, где бот ошибается. Выйти из теста — /stoptest.</i>`);
      return welcome(chat, u);
    }
    if ((m = /^q_([A-Za-z0-9_-]{2,60})$/.exec(arg))) { const t = unb64u(m[1]); if (t) return answerQuery(chat, msg.from, u, t); }
    // с сайта: «Голосование в Telegram» — t.me/<бот>?start=poll_<номер>_<номер>…
    if ((m = /^poll_((?:[a-z0-9]{6}_){1,9}[a-z0-9]{6})$/i.exec(arg))) {
      const C = await catalog(), plans = m[1].toLowerCase().split('_').map(r => planByRef(C, r)).filter(Boolean);
      if (plans.length > 1) {
        const qid = rid(), Q = { text: '', city: C.K.cityOf(plans[0]), mode: plans[0].mode, title: 'Куда идём?', ids: plans.map(p => p.id), why: [], foot: '', fixed: true,
          top: '🗳️ <b>Варианты для голосования</b>\n<i>Листай ‹ › и жми «Голосование в чат» — выбери чат компании, там появится карточка с кнопками</i>' };
        await store.set('q:' + qid, Q, TTL.query);
        return sendCard(chat.id, queryCard(C, Q, qid, 0, priv));
      }
    }
    return welcome(chat, u);
  }
  const help = (chat, u) => welcome(chat, u);

  /* Квиз: с кем → бюджет → когда; ответы — в данных кнопок (z|date|1|eve), хранилище не нужно. Шаги — в одном сообщении */
  const QUIZ = {
    who: [['date', '💕 Свидание'], ['guys', '🍻 С друзьями'], ['girls', '💅 С подругами']],
    bud: [['1', `💸 До 1 500 ₽`], ['2', `💳 До 3 000 ₽`], ['0', '✨ Неважно']],
    when: [['eve', '🌆 Сегодня вечером'], ['tom', '📅 Завтра вечером'], ['wke', '☀️ На выходных'], ['late', '🌙 Поздно, после 22:00']],
  };
  const QUIZ_TEXT = { bud: { 1: 'недорого', 2: 'до 3000', 0: '' }, when: { eve: 'сегодня вечером', tom: 'завтра вечером', wke: 'на выходных', late: 'сегодня допоздна' } };
  const qzKb = (pre, list) => ({ inline_keyboard: list.map(([v, t]) => [{ text: t, callback_data: pre + '|' + v }]) });
  const qzHead = (n, q) => `🎯 <b>Подобрать за 10 секунд</b>\n<i>${'●'.repeat(n)}${'○'.repeat(3 - n)}  шаг ${n} из 3</i>\n\n${q}`;
  async function quiz(c, parts) {
    const chat = c.message.chat;
    const [, who, bud, when] = parts;
    if (!who) return quizStart(chat);   // с кнопки приветствия — новым сообщением, приветствие остаётся
    if (bud == null) return editCb(c, qzHead(2, 'Бюджет на человека?'), qzKb('z|' + who, QUIZ.bud));
    if (!when) return editCb(c, qzHead(3, 'Когда?'), qzKb('z|' + who + '|' + bud, QUIZ.when));
    const text = [MODE_WORD[who] || '', QUIZ_TEXT.bud[bud] || '', QUIZ_TEXT.when[when] || ''].filter(Boolean).join(' ');
    const u = await userOf(c.from.id);
    if (MODE_WORD[who]) { u.mode = who; await saveUser(c.from.id, u); }
    await editCb(c, `🎯 <b>Подобрать за 10 секунд</b> ✓\n<i>${esc(text)}</i>`);
    return answerQuery(chat, c.from, u, text, { head: 'Подобрал' });
  }
  async function quizStart(chat) {
    return send(chat.id, qzHead(1, 'С кем идёшь?'), qzKb('z', QUIZ.who));
  }

  /* «Удиви меня»: карточка случайного плана; «Ещё раз» на самой карточке меняет её на месте */
  async function surprise(chat, u, c) {
    const C = await catalog(), city = u.city || 'msk', mode = u.mode || (chat.type === 'private' ? 'date' : 'guys');
    const r = C.P.plans(C.I.parse('удиви меня', { city }), { city, mode, limit: 1 })[0];
    if (!r) return send(chat.id, 'Сейчас нечего предложить — попробуй позже.');
    const p = r.plan, card = planCard(C, p, r.why, city, { top: '🎲 <b>Удиви меня</b>' });
    const kb = { inline_keyboard: [
      [{ text: '🎲 Ещё раз', callback_data: 's|e' }, { text: p.mode === 'date' ? '💌 Позвать сюда' : '🎮 Позвать сюда', url: SITE + 'create.html?mode=' + p.mode + '&plan=' + encodeURIComponent(p.id) + cq(city) }],
      [chat.type === 'private' ? { text: '✨ Подробнее', web_app: { url: U.app(city, 'plan=' + encodeURIComponent(p.id)) } } : { text: '✨ Подробнее', url: U.plan(p, city) }, { text: '🗺 Маршрут', url: U.route(p) }],
    ] };
    return c ? editCb(c, card.text, kb, card.preview) : send(chat.id, card.text, kb, { link_preview_options: card.preview });
  }

  /* «Топ дня» и «Топ недели» — тот же отбор, что на главной (KudaPick.top): один главный вариант и семь на неделю */
  const DAY_W = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  async function topList(chat, u, c) {
    const C = await catalog(), city = u.city || 'msk', mode = u.mode || (chat.type === 'private' ? 'date' : 'guys');
    const R = C.P.top({ city, mode });
    if (!R || !R.day) return send(chat.id, 'Сегодня топа нет — загляни в /afisha или напиши, что хочется.');
    const d = new Date(Date.now() + 3 * 3600e3), priv = chat.type === 'private';
    const link = x => (x.kind === 'event' ? U.event(x.ev, city) : U.plan(x.plan, city));
    const name = x => (x.kind === 'event' ? x.ev.title : x.plan.title), emo = x => (x.kind === 'event' ? x.ev.emoji : x.plan.emoji) || '📍';
    const why = x => esc((x.why || []).slice(0, 2).map(w => w.e + ' ' + w.t).join(' · '));
    const day = R.day, ph = day.kind === 'plan' ? C.K.planPhoto(day.plan) : C.K.evPhoto ? C.K.evPhoto(day.ev) : null, img = ph && ph.src !== 'Flickr' ? commonsThumb(ph.file) : '';
    const text = [`🔥 <b>Топ дня</b> · ${DAY_W[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`, '',
      `${esc(emo(day))} <a href="${esc(link(day))}"><b>${esc(name(day))}</b></a>`, `<i>${why(day)}</i>`, '',
      '📅 <b>Топ недели</b>', ...R.week.map((x, i) => `<b>${i + 1}.</b> ${esc(emo(x))} <a href="${esc(link(x))}">${esc(name(x))}</a>\n<i>${why(x)}</i>`), '',
      '<i>Выбор «Куда идём?»: что идёт, по какой цене и с учётом погоды — один на весь день.</i>',
      img ? `<i>📷 ${esc(C.K.cleanAuthor(ph.a) || 'автор на Wikimedia Commons')}${ph.l ? ', ' + esc(ph.l) : ''} · Wikimedia Commons</i>` : ''].filter(x => x !== null).join('\n').trim();
    const open = day.kind === 'plan' && priv ? { text: '✨ Топ дня подробнее', web_app: { url: U.app(city, 'plan=' + encodeURIComponent(day.plan.id)) } } : { text: '✨ Топ дня подробнее', url: link(day) };
    const kb = { inline_keyboard: [[open], [{ text: '🎯 Подобрать под себя', callback_data: 'z' }, { text: '🎲 Удиви меня', callback_data: 's' }]] };
    const preview = img ? { url: img, prefer_large_media: true, show_above_text: true } : NOPREV;
    return c ? editCb(c, text, kb, preview) : send(chat.id, text, kb, { link_preview_options: preview });
  }

  const AF = { today: 'сегодня', tomorrow: 'завтра', weekend: 'на выходных' };
  /* Афиша: события столбиком (эмодзи, название-ссылка, когда · сколько · где); переключатель дня меняет это же сообщение */
  async function afisha(chat, u, arg, c) {
    const C = await catalog(), city = u.city || 'msk';
    const when = /tomorrow|завтр/i.test(arg || '') ? 'tomorrow' : /weekend|выходн/i.test(arg || '') ? 'weekend' : 'today';
    const extra = String(arg || '').replace(/today|tomorrow|weekend|сегодня|завтра|на выходных|выходные/ig, '').trim();
    const q = C.I.parse(AF[when] + ' ' + extra, { city });
    const evs = C.P.events(q, { city, limit: 8 });
    const head = `📅 <b>Афиша ${city === 'spb' ? 'Петербурга' : 'Москвы'} · ${AF[when]}</b>`;
    const body = evs.length ? evs.map(r => eventLine(r, city)).join('\n\n') : '<i>Пока ничего не нашлось — загляни во всю афишу на сайте.</i>';
    const all = chat.type === 'private' ? { text: '✨ Вся афиша в приложении', web_app: { url: U.app(city, 'tab=events') } } : { text: '🌐 Вся афиша', url: U.home(city, 'events') };
    const kb = { inline_keyboard: [
      Object.keys(AF).map(k => ({ text: (k === when ? '• ' : '') + AF[k].replace(/^./, s => s.toUpperCase()), callback_data: 'a|' + k + '|e' })),
      [all],
    ] };
    return c ? editCb(c, head + '\n\n' + body, kb) : send(chat.id, head + '\n\n' + body, kb);
  }

  async function groupPoll(msg, u, arg) {
    const chat = msg.chat;
    if (chat.type === 'private') return answerQuery(chat, msg.from, u, arg || (u.mode === 'date' ? 'свидание' : 'с друзьями'), { limit: 4, head: 'Варианты для опроса' });
    const R = await pick(arg, u, { mode: 'guys', limit: 4, noEvents: true });
    const opts = planOpts(R.C, R.plans.map(r => r.plan), R.city);
    const links = R.plans.map((r, i) => `<b>${i + 1}.</b> <a href="${esc(U.plan(r.plan, R.city))}">${esc(r.plan.title)}</a>${r.why.length ? '\n<i>' + whyText(r.why) + '</i>' : ''}`).join('\n\n');
    return nativePoll(chat.id, titleOf(R.q), opts, links ? '📋 <b>Подробнее о вариантах</b>\n\n' + links + '\n\n<i>Когда всем удобно — /kogda</i>' : '');
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
        case 'top': return topList(chat, u);
        case 'udivi': case 'random': return surprise(chat, u);
        case 'afisha': return afisha(chat, u, arg);
        case 'opros': case 'poll': return groupPoll(msg, u, arg);
        case 'kogda': case 'when': return daysPoll(msg);
        case 'gorod': case 'city': return cityMenu(chat, u);
        case 'stoptest': delete u.tester; await saveUser(msg.from.id, u); return send(chat.id, 'Готово: тест закончен, больше ничего не сохраняю. Спасибо! 🙌');
        case 'stopwish': await store.del('w:' + msg.from.id); return send(chat.id, 'Хорошо, больше не жду — подписки на «напиши, когда появится» удалены.');
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
    // «привет», «ты кто», «что умеешь» — приветствие с примерами; «спасибо» — короткий ответ, а не случайный план
    if (GREET.test(q)) return welcome(chat, u);
    if (THANKS.test(q)) return send(chat.id, 'Рад помочь 🙌 Если что — просто напиши, что хочется, или жми /podobrat.');
    return answerQuery(chat, msg.from, u, q);
  }

  async function onCallback(c) {
    const parts = String(c.data || '').split('|'), k = parts[0];
    if (k === 'v') return onVote(c, parts[1], +parts[2]);
    // остальные кнопки — только в сообщениях бота (у карточек из inline-режима нет чата)
    if (!c.message) return answerCb(c);
    const chat = c.message.chat, u = await userOf(c.from.id);
    if (k === 'z') { await answerCb(c); return quiz(c, parts); }
    if (k === 's') { await answerCb(c); return surprise(chat, u, parts[1] === 'e' ? c : null); }
    if (k === 't') { await answerCb(c); return topList(chat, u); }
    // «📷 Фото»: альбом до 10 снимков плана, у каждого — место, автор и лицензия
    if (k === 'f') {
      const C = await catalog(), p = C.K.planById(String(parts[1] || '')), list = p ? planPhotos(C, p).slice(0, 10) : [];
      if (list.length < 2) return answerCb(c, 'Других фото пока нет');
      await answerCb(c);
      return api('sendMediaGroup', { chat_id: chat.id, media: list.map(({ ph, name }) => ({ type: 'photo', media: commonsThumb(ph.file),
        caption: cut(`${name} · 📷 ${C.K.cleanAuthor(ph.a) || 'автор на Commons'}${ph.l ? ', ' + ph.l : ''} · Wikimedia Commons`, 200) })) });
    }
    if (k === 'w') {
      const Q = /^[A-Za-z0-9]{8}$/.test(parts[1] || '') ? await store.get('q:' + parts[1]) : null;
      if (!Q || !Q.text || chat.type !== 'private') return answerCb(c, 'Запрос устарел — напиши его ещё раз');
      await addWish(c.from.id, chat.id, Q);
      await answerCb(c, '🔔 Запомнил');
      return send(chat.id, `🔔 Запомнил: «${esc(Q.text)}». Как только в каталоге или афише появится подходящее — напишу сюда. Передумал — /stopwish`);
    }
    if (k === 'a') { await answerCb(c); return afisha(chat, u, parts[1], parts[2] === 'e' ? c : null); }
    if (k === 'c') {
      u.city = parts[1] === 'spb' ? 'spb' : 'msk';
      await saveUser(c.from.id, u);
      await answerCb(c, u.city === 'spb' ? 'Теперь — Петербург' : 'Теперь — Москва');
      return send(chat.id, `📍 Подбираю ${u.city === 'spb' ? 'в Петербурге' : 'в Москве'}. Напиши, что хочется, или /podobrat.`);
    }
    if (k === 'm' || k === 'p' || k === 'g') {
      const Q = /^[A-Za-z0-9]{8}$/.test(parts[1] || '') ? await store.get('q:' + parts[1]) : null;
      if (!Q) return answerCb(c, 'Запрос устарел — напиши его ещё раз');
      const C = await catalog(), priv = chat.type === 'private';
      // ‹ › — та же карточка, другой план
      if (k === 'g') {
        await answerCb(c);
        return editCb(c, ...cardArgs(queryCard(C, Q, parts[1], Math.max(0, Math.min(Q.ids.length - 1, +parts[2] || 0)), priv)));
      }
      // «Другие варианты» — новые планы в этом же сообщении, показанные не повторяем
      if (k === 'm') {
        const seen = (Q.seen || Q.ids).slice(-30);
        const R = await pick(Q.text, Object.assign({}, u, { city: Q.city, mode: Q.mode }), { skip: seen, mode: Q.mode, noEvents: true });
        if (!R.plans.length) return answerCb(c, 'Больше вариантов под этот запрос нет — попробуй другие слова');
        await answerCb(c);
        Object.assign(Q, { ids: R.plans.map(r => r.plan.id), why: R.plans.map(r => r.why), seen: seen.concat(R.plans.map(r => r.plan.id)).slice(-30) });
        await store.set('q:' + parts[1], Q, TTL.query);
        return editCb(c, ...cardArgs(queryCard(C, Q, parts[1], 0, priv)));
      }
      await answerCb(c);
      const plans = Q.ids.map(id => C.K.planById(id)).filter(Boolean).slice(-MAX_POLL);
      return nativePoll(chat.id, titleOf(C.I.parse(Q.text, { city: Q.city })), planOpts(C, plans, Q.city));
    }
    return answerCb(c);
  }

  async function onInline(iq) {
    const text = String(iq.query || '').trim().slice(0, 120);
    const u = await userOf(iq.from.id);
    const results = [];
    let m;
    if ((m = /^(?:опрос|голосование)\s+((?:[a-z0-9]{6}\s+){1,7}[a-z0-9]{6})$/i.exec(text))) {
      // из Mini App (assets/tgapp.js): номера планов прямо в запросе — хранилище не нужно
      const C = await catalog(), plans = m[1].toLowerCase().split(/\s+/).map(r => planByRef(C, r)).filter(Boolean);
      if (plans.length > 1) {
        const city = C.K.cityOf(plans[0]);
        results.push(await voteArticle('Куда идём?', planOpts(C, plans, city), U.list(C, plans.map(p => p.id), city, 'Куда идём'), '', iq.from.id));
      }
    } else if ((m = /^(?:опрос|голосование)\s+([A-Za-z0-9]{8})$/i.exec(text))) {

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
        const p = r.plan, ph = R.C.K.planPhoto(p), th = ph && ph.src !== 'Flickr' ? commonsThumb(ph.file, 330) : '', card = planCard(R.C, p, r.why, R.city);
        results.push(Object.assign({
          type: 'article', id: 'p' + ref(p.id), title: p.title,
          description: cut(R.C.K.planStops(p).map(x => x.name).join(' → ') + (r.why.length ? ' · ' + r.why.map(w => w.t).join(' · ') : ''), 200),
          input_message_content: { message_text: card.text, parse_mode: 'HTML', link_preview_options: card.preview },
          reply_markup: { inline_keyboard: [[{ text: '✨ Подробнее', url: U.plan(p, R.city) }, { text: '🗺 Маршрут', url: U.route(p) }]] },
        }, th ? { thumbnail_url: th } : null));
      });
    }
    return api('answerInlineQuery', { inline_query_id: iq.id, results: results.slice(0, 20), cache_time: 0, is_personal: true,
      button: { text: '💬 Подобрать в чате с ботом', start_parameter: 'inline' } });
  }

  async function handle(update) {
    const from = (update.message || update.callback_query || update.inline_query || {}).from;
    if (tooMany(from && from.id)) return null;
    if (audit && from && !from.is_bot) {
      const u = await userOf(from.id), m = update.message, c = update.callback_query, q = update.inline_query;
      // /start tester_… — тоже в журнал: так видно, когда человек пришёл
      const start = m && /^\/start tester_([a-z0-9_-]{2,24})$/i.exec(String(m.text || '').trim());
      const code = u.tester || (start && start[1].toLowerCase());
      if (code && !(m && /^\/stoptest/i.test(m.text || ''))) audit({ at: new Date().toISOString(), tester: code, chat: (m && m.chat.type) || (c && c.message && c.message.chat.type) || (q ? 'inline' : ''),
        kind: m ? 'message' : c ? 'button' : 'inline', text: m ? String(m.text || '').slice(0, 300) : q ? String(q.query || '').slice(0, 120) : '', data: c ? String(c.data || '') : '' });
    }
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
  /* «Напиши, когда появится»: до 5 запросов на человека, 45 дней. Индекс w:all — у кого есть подписки */
  async function addWish(uid, chatId, Q) {
    const list = ((await store.get('w:' + uid)) || []).filter(w => w.t !== Q.text);
    list.push({ t: Q.text, c: Q.city, m: Q.mode, chat: chatId, ev: Q.ev || [], at: Date.now() });
    await store.set('w:' + uid, list.slice(-5), TTL.wish);
    const idx = (await store.get('w:all')) || [];
    if (!idx.includes(uid)) { idx.push(uid); await store.set('w:all', idx.slice(-5000), TTL.user); }
  }
  // событие «про это»: слово запроса (по корню) в названии или площадке — и его не было в ответе, когда подписывались
  const stemW = w => w.slice(0, Math.max(4, Math.ceil(w.length * 0.7)));
  const evHits = (R, w) => R.events.filter(r => !(w.ev || []).includes(r.ev.id) &&
    R.q.words.some(x => x.length >= 4 && String(r.ev.title + ' ' + (r.ev.venue || '')).toLowerCase().replace(/ё/g, 'е').includes(stemW(x.toLowerCase().replace(/ё/g, 'е')))));
  /* проверить подписки: нашлось точное — пишем и подписку снимаем. Вызывает poll.mjs / webhook.mjs раз в несколько часов */
  async function checkWishes() {
    const idx = (await store.get('w:all')) || [], keep = [];
    let sent = 0;
    for (const uid of idx) {
      const left = [];
      for (const w of (await store.get('w:' + uid)) || []) {
        if (Date.now() - w.at > TTL.wish * 1000) continue;
        let R;
        try { R = await pick(w.t, { city: w.c, mode: w.m }, { mode: w.m }); } catch (e) { left.push(w); continue; }
        const head = `🔔 Появилось то, что ты искал: «${esc(w.t)}»`, ev = evHits(R, w);
        try {
          if (R.plans.length && !R.soft) {
            const qid = rid(), Q = queryOf(R, w.t, head);
            await store.set('q:' + qid, Q, TTL.query);
            await sendCard(w.chat, queryCard(R.C, Q, qid, 0, true));
          } else if (ev.length) await send(w.chat, head + '\n\n' + ev.slice(0, 3).map(r => eventLine(r, R.city)).join('\n'));
          else { left.push(w); continue; }
          sent++;
        } catch (e) { if (log) log(`подписка ${uid}: ${e.message}`); left.push(w); }
      }
      if (left.length) { await store.set('w:' + uid, left, TTL.wish); keep.push(uid); } else await store.del('w:' + uid);
    }
    await store.set('w:all', keep, TTL.user);
    return sent;
  }

  return { handle, setName: n => { botName = n; }, ref, b64u, COMMANDS, checkWishes };
}

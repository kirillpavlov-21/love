/* Посредник между сайтом и Telegram (Google Apps Script) — один общий бот для всех пользователей.
   Необязательная часть сайта: голоса, ответы и отзывы хранит основной бэкенд (server/). Посредник нужен
   для уведомлений в Telegram и для своих коротких ссылок.
   Как устроено:
   • Пользователь пишет боту /start — бот выдаёт ему личный ключ владельца, привязанный к его чату.
   • Конструктор на сайте регистрирует id приглашений этим ключом (action: register) и доказывает,
     что приглашения создал он: присылает секрет создателя s, а в само приглашение кладёт только
     его отпечаток c = SHA-256(s). Приглашение привязывается к чату владельца вместе с c.
   • Ответ на приглашение (сайт присылает id, c и текст) уходит в чат, к которому привязано приглашение,
     только если c совпал. Кто знает ссылку, знает c, но не s — перехватить чужое приглашение
     (после /newkey, /stop или истечения срока) нельзя: у перехватчика будет другой c.
   • Текст ответа экранируется: из разметки остаётся только <b>, ссылки не на сайт, @ники и /команды
     обезвреживаются — фишинг от имени бота не пройдёт.
   Единственный секрет — токен бота. Он живёт только здесь (лучше в «Свойствах скрипта»), на сайте его нет.
   Апдейты Telegram забираем через getUpdates по триггеру раз в минуту: вебхук на Apps Script
   не работает, потому что веб-приложение отвечает Telegram редиректом 302.
   Ещё посредник умеет:
   • сокращать ссылки сайта (action: short → код; GET ?s=код → длинная ссылка). Ссылки хранятся
     в Google-таблице «Короткие ссылки сайта» в аккаунте владельца скрипта 90 дней;
   • принимать сообщения об ошибках: ссылка с сайта t.me/<бот>?start=fix_<id места> — бот попросит
     описать проблему и перешлёт текст в чат ADMIN_CHAT (свойство скрипта). */

const TG_TOKEN = 'ВСТАВЬ_ТОКЕН_БОТА';  // запасной вариант: лучше задай свойство скрипта TG_TOKEN
const SITE_URL = '';                   // адрес сайта (или свойство SITE_URL): бот покажет ссылку, ссылки на сайт в ответах останутся ссылками

const INVITE_TTL_DAYS = 90;       // приглашение без ответов и продлений забываем через 90 дней
const KEY_TTL_DAYS = 180;         // ключ без приглашений, которым полгода не пользовались, удаляем
const SHORT_TTL_DAYS = 90;        // короткие ссылки живут 90 дней, потом строки удаляются из таблицы
const MAX_INVITES_PER_CHAT = 100; // приглашений на один чат (ключ): самые старые вытесняются
const MAX_IDS_PER_CALL = 50;      // конструктор присылает не больше 40 (вся история)
const STORE_SOFT = 420 * 1024;    // хранилище свойств — 500 КБ на проект: после 420 КБ чистим самые старые приглашения…
const STORE_TARGET = 340 * 1024;  // …пока не останется 340 КБ
const BULK_DELETE = 20;           // если удалять больше — переписываем хранилище одним вызовом
const TEXT_MAX = 3800;            // Telegram принимает до 4 096 видимых символов
const KEY_LEN = 24;
const ID_RE = /^[a-z0-9]{1,13}$/;
const KEY_RE = /^[A-Za-z0-9]{24,64}$/;
const CHAT_RE = /^-?\d{1,20}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{16,64}$/;
const SHORT_RE = /^[A-Za-z0-9]{5,14}$/;
const B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
/* Невидимые и управляющие символы: ими можно спрятать ссылку от проверки. Склейку эмодзи (U+200D) убираем
   отдельно и только не после эмодзи — иначе 🧖‍♀️ в уведомлении распадётся на два значка (см. visible_). */
const INVIS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2069\u3164\uFEFF\uFFA0\uFFF9-\uFFFB]/g;

/* Лимиты на 10 минут. IP-адреса Apps Script не видит, поэтому лимиты — по ключу, чату, приглашению,
   «семейству» ссылок и строке таблицы. Имена со «*» — общие счётчики (см. allowAll_). */
const LIM = {
  notifyInvite: 20,    // сообщений по одному приглашению
  notifyOwner: 40,     // сообщений одному владельцу
  notifyAll: 250,      // общий поток уведомлений
  reserveAll: 100,     // запас: если общий поток исчерпан, у каждого владельца проходят первые…
  reserveOwner: 5,     // …5 сообщений за 10 минут
  test: 5,             // тестовых сообщений на ключ
  register: 100,       // новых приглашений на чат
  registerAll: 1500,   // новых приглашений всего
  shortFamily: 30,     // коротких ссылок для одного приглашения (голоса, ответы)
  shortAll: 300,       // коротких ссылок всего (поток отдельный от уведомлений)
  expandMiss: 20,      // неудачных раскрытий на одну строку таблицы (перебор хвоста кода)
  expandRefresh: 60,   // внеочередных перечитываний числа строк таблицы
  botChat: 12,         // ответов бота одному чату
  botHelp: 3,          // из них — подсказок на обычные сообщения
  botAll: 300,         // ответов бота всего
  fixChat: 3,          // сообщений об ошибке в каталоге от одного чата
  fixAll: 60,          // сообщений об ошибке всего
  newKeyChat: 5,       // новых ключей на чат
  newKeyAll: 60,       // новых ключей всего
};

/* Суточная квота UrlFetch: 20 000 запросов на бесплатном аккаунте (Workspace — 100 000, задай свойство
   URLFETCH_DAY). Когда Google обнуляет счётчик, заранее не известно, поэтому считаем по 6-часовым четвертям:
   любые сутки задевают не больше 5 четвертей, на четверть даём 19 % квоты — в сумме не больше 95 %.
   Ярусы внутри четверти (tg_, третий аргумент):
   • 'poll' — опрос Telegram и настройка: им всегда остаётся FETCH_POLL запросов (getUpdates раз в минуту = 360),
     даже если уведомления выели всё, бот продолжает получать команды;
   • 'own' — первые reserveOwner уведомлений владельца за 10 минут: им остаётся ещё FETCH_OWN от бюджета,
     чтобы спам с десятков своих ключей не оставил без ответов всех остальных;
   • остальное (ответы бота, сообщения об ошибках, уведомления сверх запаса) — общий бюджет. */
const FETCH_DAY = 20000;
const FETCH_POLL = 400;
const FETCH_OWN = 0.15;    // доля бюджета уведомлений, которую держим для первых сообщений каждого владельца
const FETCH_SAVE = 25;     // копию счётчика в свойства пишем раз в 25 запросов (на случай сброса кэша)
const FETCH_SHARDS = 8;    // счётчик разбит на части, чтобы параллельные запросы реже затирали друг друга

/* Хранилище — свойства скрипта (всего 500 КБ на проект):
   k_<ключ>    → chat_id владельца
   c_<chat_id> → <ключ>|<день>  (действующий ключ чата и день, когда им последний раз пользовались)
   i_<id>      → <chat_id>|<день>|<c>  (чьё приглашение, когда его последний раз продлевали, отпечаток секрета создателя)
   l_<chat_id> → id приглашений чата через запятую, от старых к новым (для лимита и переноса группы)
   tg_offset   → номер следующего апдейта Telegram
   bot_name    → ник бота без @ (для doGet и команд вида /key@бот в группах)
   short_sheet, short_off → id таблицы коротких ссылок и сколько старых строк из неё уже удалено
   fetch_q     → <четверть>:<запросов> — копия счётчика UrlFetch
   Кэш (CacheService, около 1 000 записей): счётчики лимитов, cfg — настройки на 10 минут, shm — сведения
   о таблице ссылок, ex_<код> — раскрытые ссылки на 10 минут, fx_<чат> — ожидаем описание ошибки. */

/* ======================= сайт → посредник ======================= */

function doPost(e) {
  try {
    const raw = String((e && e.postData && e.postData.contents) || '{}');
    if (raw.length > 65536) return json_({ ok: false });
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object') return json_({ ok: false });
    if (body.action === 'register') return json_(register_(body));
    if (body.action === 'short') return json_(short_(body));
    if (body.action === 'test') return json_(test_(body));
    return json_(notify_(body));
  } catch (err) {
    console.error(err);
    return json_({ ok: false });
  }
}

/* GET ?s=<код> — раскрыть короткую ссылку; без параметров — проверка, что посредник жив, и ник бота. */
function doGet(e) {
  try {
    const code = String((e && e.parameter && e.parameter.s) || '');
    if (code) return json_(expand_(code));
    return json_({ ok: true, bot: conf_('bot_name') });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'busy' });
  }
}

/* ======================= короткие ссылки ======================= */

/* Какие адреса можно сокращать: свойство SHORT_ALLOW (префиксы через запятую), иначе адрес сайта
   из SITE_URL и Яндекс Карты. Без настроек — любые https-ссылки (go.html на сайте всё равно
   перенаправляет только на сам сайт и Яндекс Карты). */
function shortAllowed_(url) {
  if (!/^https:\/\/[^\s]{8,3990}$/.test(url)) return false;
  let allow = String(conf_('SHORT_ALLOW')).split(',').map(prefix_).filter(String);
  const site = siteBase_();
  if (!allow.length && site) allow = [site, 'https://yandex.ru/maps/'];
  return !allow.length || allow.some(function (a) { return url.indexOf(a) === 0; });
}

/* Префикс из SHORT_ALLOW: только https, и после домена обязательно «/» — иначе «https://site.ru»
   пропустил бы и https://site.ru.evil.example/ */
function prefix_(s) {
  s = String(s || '').trim();
  if (/^https:\/\/[^/?#\s]+$/i.test(s)) s += '/';
  return /^https:\/\/[^/?#\s]+\//i.test(s) ? s : '';
}

/* Таблица коротких ссылок. Если id уже есть, а таблица не открылась (сбой Google), — повторяем и
   в конце бросаем ошибку: новую таблицу при этом не создаём, иначе все выданные ссылки сломаются. */
let short_sheet_memo_ = null;
function openShort_(id) {
  if (short_sheet_memo_ && short_sheet_memo_.id === id) return short_sheet_memo_.sh;
  let last = null;
  for (let i = 0; i < 3; i++) {
    try {
      const sh = SpreadsheetApp.openById(id).getSheets()[0];
      short_sheet_memo_ = { id: id, sh: sh };
      return sh;
    } catch (err) {
      last = err;
      if (i < 2) Utilities.sleep(300 * (i + 1));
    }
  }
  throw new Error('таблица коротких ссылок не открылась (' + last + '). Новую не создаём, чтобы не потерять ' +
    'выданные ссылки. Если таблицу удалили насовсем — удали свойства short_sheet и short_off.');
}
/* Создаём таблицу только при первом сокращении (вызывается под замком) */
function newShortSheet_() {
  const ss = SpreadsheetApp.create('Короткие ссылки сайта');
  const sh = ss.getSheets()[0];
  trimColumns_(sh);
  props_().setProperty('short_sheet', ss.getId());
  short_sheet_memo_ = { id: ss.getId(), sh: sh };
  return sh;
}
/* Нужны 3 столбца (адрес, день, хвост кода). В новом листе их 26, а лимит Google — 10 млн ячеек на таблицу,
   и пустые столбцы его тоже расходуют: без лишних строк в таблицу влезает в 8 раз больше ссылок. */
function trimColumns_(sh) {
  const n = sh.getMaxColumns();
  if (n > 3) sh.deleteColumns(4, n - 3);
}
/* Сведения о таблице: id, off — сколько первых строк удалено по сроку, last — номер последней строки
   с учётом удалённых, at — когда считали. Лежат в кэше, чтобы раскрытие не читало свойства.
   mode: '' — из кэша (если есть); 'rows' — пересчитать только строки (id и off из кэша, без чтения свойств);
   'full' — перечитать всё. У только что посчитанных сведений fresh = true (в кэш не пишется). */
function shortMeta_(mode) {
  const cache = cache_();
  let meta = null;
  if (mode !== 'full') {
    try { meta = JSON.parse(cache.get('shm') || 'null'); } catch (err) { meta = null; }
    if (!meta || typeof meta !== 'object' || !meta.id) meta = null;
    else if (!mode) return meta;
  }
  if (!meta) {
    const p = props_();
    const id = p.getProperty('short_sheet');
    if (!id) return null;
    meta = { id: id, off: Number(p.getProperty('short_off')) || 0 };
  }
  meta = { id: meta.id, off: Number(meta.off) || 0, at: Date.now() };
  meta.last = meta.off + openShort_(meta.id).getLastRow();
  cache.put('shm', JSON.stringify(meta), 3600);
  meta.fresh = true;
  return meta;
}
function readShort_(meta, row) {
  return openShort_(meta.id).getRange(row - meta.off, 1, 1, 3).getValues()[0];
}

function b62_(n) { let s = ''; do { s = B62[n % 62] + s; n = Math.floor(n / 62); } while (n > 0); return s; }
function unb62_(s) { let n = 0; for (let i = 0; i < s.length; i++) { const d = B62.indexOf(s[i]); if (d < 0) return -1; n = n * 62 + d; } return n; }
function digest_(s, len) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)).slice(0, len);
}

/* Код = номер строки (сквозной, с учётом удалённых) в base62 + 4 случайных символа:
   коды не перебрать подряд. */
function short_(body) {
  const url = String(body.url || '');
  if (!shortAllowed_(url)) return { ok: false, error: 'url' };
  // «семейство» — ссылки одного приглашения (всё до первого &): голоса и ответы одного сбора
  const fam = digest_(url.split('&')[0], 16);
  if (!allowAll_([['sf' + fam, LIM.shortFamily], ['*short', LIM.shortAll]])) return { ok: false, error: 'rate' };
  return withLock_(5000, function () {
    try {
      const p = props_();
      let id = p.getProperty('short_sheet');
      const sh = id ? openShort_(id) : newShortSheet_();
      id = short_sheet_memo_.id;
      const off = Number(p.getProperty('short_off')) || 0;
      const n = sh.getLastRow() + 1;
      if (n > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
      let tag = '';
      for (let i = 0; i < 4; i++) tag += B62[Math.floor(Math.random() * 62)];
      const range = sh.getRange(n, 1, 1, 3);
      // текстовый формат: иначе таблица превратит хвост «0123» в число 123, «12e3» — в 12000, «TRUE» — в «истину»
      range.setNumberFormat('@');
      range.setValues([[url, String(day_()), tag]]);
      const row = off + n;
      cache_().put('shm', JSON.stringify({ id: id, off: off, last: row, at: Date.now() }), 3600);
      return { ok: true, id: b62_(row) + tag };
    } catch (err) {
      console.error('Короткие ссылки: ' + err);
      return { ok: false, error: 'busy' };
    }
  }, { ok: false, error: 'busy' });
}

/* Раскрытие: свежие и популярные ссылки — из кэша; номер за концом таблицы отбрасываем, не открывая её;
   неудачные попытки считаем по строке, а не по всем сразу — перебор одной строки не мешает остальным.
   error: 'rate' — по этой строке слишком много неудачных попыток, 'busy' — таблица не открылась. */
function expand_(code) {
  if (!SHORT_RE.test(code)) return { ok: false };
  const row = unb62_(code.slice(0, -4)), tag = code.slice(-4);
  if (row < 1) return { ok: false };
  const cache = cache_();
  const hit = cache.get('ex_' + code);
  if (hit) return { ok: true, url: hit };
  try {
    let meta = shortMeta_('');
    if (!meta) return { ok: false };  // таблицы ещё нет — коротких ссылок не выдавали
    const old = function () { return !meta.fresh && Date.now() - meta.at > 60000; };
    // строка новее, чем мы помним, — пересчитываем строки (раз в минуту, плюс небольшой общий запас)
    if (row > meta.last && (old() || (!meta.fresh && allow_('*xr', LIM.expandRefresh)))) meta = shortMeta_('rows');
    if (row > meta.last || row <= meta.off) return { ok: false };  // такой строки нет или она удалена по сроку
    const miss = 'xm' + row;
    if (!peek_(miss, LIM.expandMiss)) return { ok: false, error: 'rate' };
    let cells = readShort_(meta, row);
    const good = function () { return /^https:\/\//.test(String(cells[0] || '')) && tagMatch_(cells[2], tag); };
    if (!good() && old()) {
      // ночная чистка могла сдвинуть строки, а в кэше остались прежние сведения — перечитываем (не чаще раза в минуту)
      const now = shortMeta_('full');
      if (now.off !== meta.off) {
        meta = now;
        if (row > meta.last || row <= meta.off) return { ok: false };
        cells = readShort_(meta, row);
      }
    }
    const url = String(cells[0] || '');
    if (!good()) {
      allow_(miss, LIM.expandMiss);
      // Настоящий код этой строки кладём в кэш: кто перебирает хвосты, упрётся в лимит, а у владельца ссылки
      // она продолжит открываться (иначе 20 запросов чужого человека выключали бы любую ссылку на 10 минут).
      const real = typeof cells[2] === 'string' ? cells[2].replace(/^'/, '') : '';
      if (/^https:\/\//.test(url) && url.length < 90000 && /^[A-Za-z0-9]{4}$/.test(real)) cache.put('ex_' + b62_(row) + real, url, 900);
      return { ok: false };
    }
    if (url.length < 90000) cache.put('ex_' + code, url, 600);
    return { ok: true, url: url };
  } catch (err) {
    console.error('Короткие ссылки: ' + err);
    return { ok: false, error: 'busy' };
  }
}

/* Хвост кода в ячейке. Новые строки пишутся текстом; в строках, записанных раньше, таблица могла
   превратить хвост в число («0123» → 123, «12e3» → 12000) или в TRUE/FALSE — сравниваем и так. */
function tagMatch_(v, tag) {
  if (typeof v === 'string') return v.replace(/^'/, '') === tag;
  if (typeof v === 'number') return /^[0-9eE.]+$/.test(tag) && isFinite(Number(tag)) && Number(tag) === v;
  if (typeof v === 'boolean') return tag.toLowerCase() === String(v);
  return false;
}

/* ======================= приглашения и ответы ======================= */

/* Ответ на приглашение: пересылаем, только если приглашение привязано к чату с действующим ключом
   и отпечаток c из ссылки совпал с отпечатком того, кто приглашение зарегистрировал. */
function notify_(body) {
  const id = String(body.id || '');
  if (!ID_RE.test(id)) return { ok: false };
  const inv = parseInv_(props_().getProperty('i_' + id));
  if (!inv || !inv.chat) return { ok: false };
  if (inv.c !== String(body.c || '').slice(0, 16)) return { ok: false };
  if (!liveChat_(inv.chat)) return { ok: false };  // владелец отключил ответы (/stop)
  const text = cleanText_(body.text);
  if (!text) return { ok: false };
  const tier = ownerTier_(inv.chat);
  if (!fetchPeek_(tier)) return { ok: false, error: 'busy' };  // запас запросов к Telegram на эти 6 часов исчерпан
  if (!allowNotify_(inv.chat, id)) return { ok: false, error: 'rate' };
  const ok = send_(inv.chat, text, tier);
  // на приглашение отвечают — продлеваем срок хранения (не чаще раза в день)
  if (ok && inv.day !== day_()) renewInvite_(id, inv);
  return { ok: ok };
}

/* Продление под замком: пока мы отправляли, register_ мог перенести приглашение в другой чат, а cleanup —
   удалить его. Перечитываем запись и пишем, только если она всё ещё та же. Замок занят — не страшно,
   продлим при следующем ответе. */
function renewInvite_(id, inv) {
  withLock_(1500, function () {
    const props = props_();
    const today = day_();
    const now = parseInv_(props.getProperty('i_' + id));
    if (!now || now.chat !== inv.chat || now.c !== inv.c || now.day === today) return;
    const put = {};
    put['i_' + id] = now.chat + '|' + today + '|' + now.c;
    const ck = parseChatKey_(props.getProperty('c_' + now.chat));
    if (ck.key && ck.day !== today) put['c_' + now.chat] = ck.key + '|' + today;
    props.setProperties(put);
  }, null);
}

function test_(body) {
  const chat = chatByKey_(body.key);
  if (!chat) return { ok: false, error: 'key' };
  const tier = ownerTier_(chat);
  if (!fetchPeek_(tier)) return { ok: false, error: 'busy' };
  if (!allowAll_([['t' + chat, LIM.test]]) || !allowNotify_(chat, '')) return { ok: false, error: 'rate' };
  touchChat_(chat);
  return { ok: send_(chat, '✅ <b>Тест из конструктора</b>: ответы на твои приглашения будут приходить сюда.', tier) };
}

/* Первые reserveOwner сообщений владельца за 10 минут могут взять из запаса UrlFetch (ярус 'own') */
function ownerTier_(chat) {
  return peek_('o' + chat, LIM.reserveOwner) ? 'own' : '';
}

/* Привязываем id приглашений к чату владельца ключа.
   • Своё приглашение (тот же чат) — продлеваем срок хранения.
   • Приглашение с другим отпечатком c (его создал кто-то другой) — не трогаем: taken.
   • Свободный id или тот же создатель (знает секрет s) из другого чата — привязываем к этому чату.
   Пустой список ids — просто проверка ключа. */
function register_(body) {
  const chat = chatByKey_(body.key);
  if (!chat) return { ok: false, error: 'key' };
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter(function (id, i, a) {
    return ID_RE.test(id) && a.indexOf(id) === i;
  }).slice(0, MAX_IDS_PER_CALL);
  if (!ids.length) { touchChat_(chat); return { ok: true, taken: 0, fresh: 0 }; }
  const s = String(body.s || '');
  if (!SECRET_RE.test(s)) return { ok: false, error: 'secret' };
  const c = digest_('kuda-tg|' + s, 12);

  return withLock_(8000, function () {
    const props = props_();
    const all = props.getProperties();
    const today = day_();
    const put = {}, del = [];
    const owned = function (id) { const v = put['i_' + id] || all['i_' + id]; const inv = v && parseInv_(v, all); return !!inv && inv.chat === chat; };
    let list = splitList_(all['l_' + chat]).filter(function (id) { return owned(id); });
    let taken = 0, fresh = 0;
    ids.forEach(function (id) {
      const old = parseInv_(all['i_' + id], all);
      if (old && old.chat === chat) {
        // своё: продлеваем, отпечаток не меняем (ссылки у гостей — со старым c)
        if (old.day !== today) put['i_' + id] = chat + '|' + today + '|' + old.c;
        list = list.filter(function (x) { return x !== id; }).concat(id);
        return;
      }
      if (old && old.c && old.c !== c) { taken++; return; }                       // создал кто-то другой
      if (old && !old.c && old.chat && liveChat_(old.chat, all)) { taken++; return; } // старая запись без отпечатка, владелец на связи
      if (old && old.chat && old.chat !== chat) {                                   // тот же создатель переносит приглашение в другой чат
        const theirs = splitList_(put['l_' + old.chat] || all['l_' + old.chat]).filter(function (x) { return x !== id; });
        put['l_' + old.chat] = theirs.join(',');
      }
      put['i_' + id] = chat + '|' + today + '|' + c;
      list = list.concat(id);
      fresh++;
    });
    if (fresh && !allowAll_([['r' + chat, LIM.register, fresh], ['*rall', LIM.registerAll, fresh]])) return { ok: false, error: 'rate' };
    // не больше MAX_INVITES_PER_CHAT на чат: самые старые забываем
    while (list.length > MAX_INVITES_PER_CHAT) {
      const old = list.shift();
      if (ids.indexOf(old) >= 0 && put['i_' + old]) { delete put['i_' + old]; fresh--; continue; }
      if (owned(old)) del.push('i_' + old);
    }
    put['l_' + chat] = list.join(',');
    // ключом пользуются — отмечаем день (по нему cleanup забывает заброшенные ключи)
    const ck = parseChatKey_(all['c_' + chat]);
    if (ck.key && all['k_' + ck.key] === chat && ck.day !== today) put['c_' + chat] = ck.key + '|' + today;
    // место в хранилище: если его мало — удаляем самые старые приглашения всех пользователей
    const used = usage_(all) + Object.keys(put).reduce(function (n, k) { return n + k.length + put[k].length - (all[k] ? k.length + String(all[k]).length : 0); }, 0);
    let gone = del;
    if (used > STORE_SOFT) gone = del.concat(purgeOldest_(all, used - STORE_TARGET, put));
    try {
      commit_(props, all, put, gone);
    } catch (err) {
      console.error('Хранилище свойств переполнено: ' + err);
      const now = props.getProperties();
      try {
        commit_(props, now, put, del.concat(purgeOldest_(now, STORE_SOFT - STORE_TARGET, put)));
      } catch (err2) {
        console.error(err2);
        return { ok: false, error: 'storage' };
      }
    }
    return { ok: true, taken: taken, fresh: Math.max(0, fresh) };
  }, { ok: false, error: 'busy' });
}

/* Самые старые приглашения (по дню последнего продления), занимающие не меньше need байт.
   keep — записи, которые сейчас пишутся: их не трогаем. Возвращает имена для удаления и убирает их из all.
   Списки l_ чистятся сами при следующей регистрации и в cleanup. */
function purgeOldest_(all, need, keep) {
  const items = Object.keys(all).filter(function (k) { return k.indexOf('i_') === 0 && !(keep && keep[k]); })
    .map(function (k) { const inv = parseInv_(all[k], all); return [k, inv ? inv.day : 0, k.length + String(all[k]).length]; })
    .sort(function (a, b) { return a[1] - b[1]; });
  const out = [];
  let freed = 0;
  for (let i = 0; i < items.length && freed < need; i++) {
    out.push(items[i][0]);
    delete all[items[i][0]];
    freed += items[i][2];
  }
  if (out.length) console.warn('Мало места в хранилище: удаляем старых приглашений — ' + out.length);
  return out;
}

/* Записываем изменения: put — новые значения, dels — что удалить. Удалений много — переписываем всё
   хранилище одним вызовом (setProperties с удалением остального) вместо тысяч deleteProperty под замком.
   all — снимок свойств, сделанный под тем же замком. */
function commit_(props, all, put, dels) {
  const gone = {};
  dels.forEach(function (k) { if (!(k in put)) gone[k] = true; });
  const names = Object.keys(gone);
  if (names.length > BULK_DELETE) {
    const map = {};
    Object.keys(all).forEach(function (k) { if (!gone[k]) map[k] = String(all[k]); });
    Object.keys(put).forEach(function (k) { map[k] = put[k]; });
    const fq = props.getProperty('fetch_q');  // счётчик UrlFetch пишется без замка — берём свежий
    if (fq) map.fetch_q = fq;
    props.setProperties(map, true);
    return;
  }
  names.forEach(function (k) { props.deleteProperty(k); });
  if (Object.keys(put).length) props.setProperties(put);
}

/* ======================= текст ответа ======================= */

/* Сайт присылает текст с разметкой <b>…</b> и уже экранированными &lt; &gt; &amp;.
   Порядок: делим по <b>/</b> → раскрываем сущности и убираем невидимые символы → обезвреживаем ссылки,
   @ники и /команды во всём видимом тексте сразу (ссылку могли разрезать тегом: evil<b>.com</b>) →
   обрезаем до TEXT_MAX видимых символов, не разрывая эмодзи → экранируем заново. Так обрезка не попадает
   внутрь сущности («&am»), а длина в Telegram не превышает лимит. */
function cleanText_(raw) {
  const segs = [];
  let open = false;
  String(raw || '').slice(0, 30000).split(/(<\/?b>)/i).forEach(function (part) {
    if (/^<b>$/i.test(part)) { open = true; return; }
    if (/^<\/b>$/i.test(part)) { open = false; return; }
    const t = visible_(unesc_(part));
    if (t) segs.push({ b: open, t: t });
  });
  const vis = segs.map(function (s) { return s.t; }).join('');
  let safe = defang_(vis);
  // defang_ меняет символ на символ, длина та же; на всякий случай — запасной путь по кускам
  if (safe.length !== vis.length) safe = segs.map(function (s) { return defang_(s.t); }).join('');
  let pos = 0, left = TEXT_MAX, out = '';
  segs.forEach(function (s) {
    let t = safe.slice(pos, pos + s.t.length);
    pos += s.t.length;
    if (left <= 0) return;
    if (t.length > left) t = cut_(t, left);
    left -= t.length;
    out += s.b ? '<b>' + esc_(t) + '</b>' : esc_(t);
  });
  return out.replace(/<\/b><b>/g, '').replace(/<b>\s*<\/b>/g, '').trim();
}

/* Без невидимых символов и одиночных половинок суррогатных пар (такой текст Telegram не примет);
   склейка U+200D остаётся только после эмодзи (🧖‍♀️, 🐈‍⬛) */
function visible_(s) {
  return String(s).replace(INVIS_RE, '')
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, function (m) { return m.length === 2 ? m : ''; })
    .replace(/\u200D/g, function (z, i, all) {
      return /[\uDC00-\uDFFF\uFE0F\u2600-\u27BF\u2B00-\u2BFF]/.test(all.charAt(i - 1)) ? z : '';
    });
}

/* Первые n символов, не разрезая эмодзи пополам */
function cut_(s, n) {
  s = String(s);
  if (s.length <= n) return s;
  const t = s.slice(0, n);
  return /[\uD800-\uDBFF]$/.test(t) ? t.slice(0, -1) : t;
}

/* Хвост ссылки на сайт, который остаётся нажимаемым: только «спокойные» символы адреса. На «, », ", <, >,
   скобках, кавычках Telegram может оборвать ссылку, а то, что дальше, разобрать как новую ссылку, —
   поэтому всё после такого символа обезвреживается как обычный текст. */
const SITE_TAIL_RE = /^[A-Za-z0-9\-._~\/?#=&%+]*/;
/* Обезвреживаем всё, из чего Telegram сам сделает ссылку, упоминание или команду:
   • точку перед буквой или цифрой (на всякий случай и «китайские» точки 。．｡ — некоторые программы считают их точкой) → «․»;
   • «://» любой схемы (https, tg, ton…) → «∶//»;
   • @ник → ＠ник; /команду после пробела или знака препинания → ∕команда.
   Нажимаемыми остаются только ссылки на сайт из SITE_URL (их «спокойная» часть).
   Каждая замена — символ на символ, длина строки не меняется (на это опирается cleanText_). */
function defang_(s) {
  s = String(s);
  const site = siteBase_();
  const keep = [];  // [начало, конец) ссылок на сайт
  if (site) {
    for (let i = s.indexOf(site); i >= 0; i = s.indexOf(site, i)) {
      const end = i + site.length + SITE_TAIL_RE.exec(s.slice(i + site.length))[0].length;
      keep.push([i, end]);
      i = end;
    }
  }
  const kept = function (at) { return keep.some(function (r) { return at >= r[0] && at < r[1]; }); };
  const out = s.split('');  // по UTF-16-единицам, как и индексы совпадений
  const mark = function (re, ch, lead) {
    let m;
    while ((m = re.exec(s))) {
      const at = m.index + (lead ? m[1].length : 0);
      if (!kept(at)) out[at] = ch;
    }
  };
  mark(/[.\u3002\uFF0E\uFF61](?=[\p{L}\p{N}])/gu, '․');
  mark(/:(?=\/\/)/g, '∶');
  mark(/@(?=[A-Za-z0-9_]{3,})/g, '＠');
  mark(/(^|[^\p{L}\p{N}_\/<>])\/(?=[A-Za-z0-9_])/gu, '∕', true);  // после букв, «/», «<», «>» Telegram команду не видит
  return out.join('');
}

/* ======================= Telegram → бот ======================= */

/* Раз в минуту по триггеру (ставит setupTriggers): забираем новые сообщения боту и отвечаем.
   Замок держим только пока забираем очередь и двигаем tg_offset — ответы отправляются без него,
   чтобы регистрация и короткие ссылки не ждали, пока бот отвечает. */
function pollBot() {
  const updates = withLock_(5000, function () {
    const props = props_();
    const offset = Number(props.getProperty('tg_offset') || 0);
    const r = tg_('getUpdates', { offset: offset, timeout: 0, limit: 100, allowed_updates: JSON.stringify(['message']) }, 'poll');
    if (!r.ok || !Array.isArray(r.result)) { console.warn('getUpdates: ' + (r.description || 'нет ответа')); return []; }
    // сначала двигаем очередь: если обработка упадёт на середине, те же сообщения не придут повторно
    if (r.result.length) props.setProperty('tg_offset', String(r.result[r.result.length - 1].update_id + 1));
    return r.result;
  }, []);
  updates.forEach(function (u) {
    try {
      if (u.message) onMessage_(u.message);
    } catch (err) {
      console.error(err);  // одно сломанное сообщение не должно стопорить очередь
    }
  });
}

function onMessage_(m) {
  const chat = String((m.chat && m.chat.id) || '');
  const text = String(m.text || '').trim();
  if (!CHAT_RE.test(chat) || !text) return;
  const isPrivate = m.chat.type === 'private';
  const c = text.match(/^\/([a-z]+)(?:@(\w+))?(?:\s+(\S+))?/i);
  if (!c) {
    if (isPrivate && forwardFix_(chat, m, text)) return;
    if (isPrivate) reply_(chat, helpText_(), 'help');  // в группах на обычные сообщения не отвечаем
    return;
  }
  const bot = conf_('bot_name');
  if (c[2] && bot && c[2].toLowerCase() !== bot.toLowerCase()) return;  // команда другому боту
  // Лимит ответов этому чату исчерпан — молчим, не трогая замок и свойства: иначе поток /key от одного
  // человека выел бы суточную квоту чтений свойств (50 000) у всех.
  if (!peekAll_([['bc' + chat, LIM.botChat], ['*ball', LIM.botAll]])) return;
  // ссылка «Нашли ошибку?» с сайта: /start fix_<id места или плана>
  if (isPrivate && c[1].toLowerCase() === 'start' && /^fix_[\w-]{1,56}$/.test(c[3] || '')) {
    cache_().put('fx_' + chat, c[3].slice(4), 3600);
    return reply_(chat, '🛠 Спасибо, что помогаешь! Опиши одним сообщением, что не так: место закрылось, другой адрес, неверные часы, ошибка в описании…');
  }
  const cmd = c[1].toLowerCase();
  if (cmd === 'start' || cmd === 'key') {
    const key = issueKey_(chat, false);
    return reply_(chat, key ? keyText_(key, cmd === 'start') : key === '' ? tooOften_() : busyText_());
  }
  if (cmd === 'newkey' || cmd === 'stop') {
    // в группе сменить или отключить ключ может только админ: иначе любой участник выключит ответы всем
    if (!isPrivate && !isAdmin_(chat, m)) return reply_(chat, '🙅 В группе сменить или отключить ключ может только админ группы.');
    if (cmd === 'newkey') {
      const key = issueKey_(chat, true);
      return reply_(chat, key ? newKeyText_(key) : key === '' ? tooOften_() : busyText_());
    }
    if (!revokeKey_(chat)) return reply_(chat, busyText_());
    return reply_(chat, '🔕 Ключ удалён — ответы на приглашения сюда больше не придут.\n\nЧтобы снова их получать, отправь /key: бот выдаст новый ключ, его нужно вставить в конструкторе.');
  }
  if (isPrivate || c[2]) reply_(chat, helpText_(), 'help');
}

/* Автор сообщения — создатель или админ группы. Анонимный админ пишет от имени самой группы (sender_chat). */
function isAdmin_(chat, m) {
  if (m.sender_chat && String(m.sender_chat.id) === chat) return true;
  if (!m.from || !m.from.id) return false;
  const r = tg_('getChatMember', { chat_id: chat, user_id: String(m.from.id) });
  const st = r.ok && r.result ? r.result.status : '';
  return st === 'creator' || st === 'administrator';
}

/* Ответ бота с лимитами: на чат (отдельно — на подсказки) и на всех. Лишнее молча пропускаем. */
function reply_(chat, text, kind) {
  const rules = [['bc' + chat, LIM.botChat], ['*ball', LIM.botAll]];
  if (kind === 'help') rules.push(['bh' + chat, LIM.botHelp]);
  if (!fetchPeek_('') || !allowAll_(rules)) return false;
  return send_(chat, text);
}

function tooOften_() {
  return '⏳ Слишком часто. Попробуй ещё раз минут через десять.';
}
function busyText_() {
  return '⏳ Бот сейчас занят — попробуй ещё раз через минуту.';
}

/* Пересылаем описание ошибки в ADMIN_CHAT (свойство скрипта), если человек пришёл по ссылке «Нашли ошибку?» */
function forwardFix_(chat, m, text) {
  const cache = cache_();
  const what = cache.get('fx_' + chat);
  if (!what) return false;
  cache.remove('fx_' + chat);
  if (!allowAll_([['fxc' + chat, LIM.fixChat], ['*fix', LIM.fixAll]])) { reply_(chat, tooOften_()); return true; }
  const admin = conf_('ADMIN_CHAT');
  // ник оставляем нажимаемым (админу может понадобиться ответить), имя и текст обезвреживаем, как ответы гостей
  const from = m.from || {};
  const who = from.username ? '@' + esc_(from.username) : esc_(cut_(defang_(visible_(from.first_name || '')), 64));
  const body = cut_(defang_(visible_(text)), 1500);
  if (admin) send_(admin, '🛠 <b>Ошибка в каталоге</b>: <code>' + esc_(what) + '</code>' + (who ? ' от ' + who : '') + '\n' + esc_(body));
  else console.warn('Ошибка в каталоге (ADMIN_CHAT не задан): ' + what + ' — ' + body);  // видно в «Выполнениях» скрипта
  reply_(chat, admin ? '✅ Передали команде — поправим. Спасибо!' : '✅ Спасибо! Записали.');
  return true;
}

/* Действующий ключ чата; renew — выпустить новый, а старый отключить. Приглашения привязаны к чату,
   поэтому после /newkey ответы на уже отправленные приглашения продолжают приходить.
   Возвращает ключ, '' — превышен лимит новых ключей, null — посредник занят. */
function issueKey_(chat, renew) {
  return withLock_(5000, function () {
    const props = props_();
    const today = day_();
    const old = parseChatKey_(props.getProperty('c_' + chat));
    const mine = !!old.key && props.getProperty('k_' + old.key) === chat;
    if (mine && !renew) {
      if (old.day !== today) props.setProperty('c_' + chat, old.key + '|' + today);
      return old.key;
    }
    if (!allowAll_([['nk' + chat, LIM.newKeyChat], ['*nkall', LIM.newKeyAll]])) return '';
    const key = newKey_();
    const put = {};
    put['k_' + key] = chat;
    put['c_' + chat] = key + '|' + today;
    try {
      props.setProperties(put);
    } catch (err) {
      console.error('Не удалось сохранить ключ: ' + err);
      return null;
    }
    if (mine && old.key !== key) props.deleteProperty('k_' + old.key);  // старый ключ сразу перестаёт работать
    return key;
  }, null);
}

/* /stop: ключ удаляем, а приглашения остаются привязаны к чату — их никто не перехватит,
   а ответы не пересылаются, пока у чата нет действующего ключа. false — посредник занят. */
function revokeKey_(chat) {
  return withLock_(5000, function () {
    const props = props_();
    const old = parseChatKey_(props.getProperty('c_' + chat));
    // запись-сирота может указывать на ключ другого чата — его не трогаем
    if (old.key && props.getProperty('k_' + old.key) === chat) props.deleteProperty('k_' + old.key);
    props.deleteProperty('c_' + chat);
    return true;
  }, false);
}

/* Отмечаем, что ключом чата пользуются (раз в день). Замок занят — пропускаем. */
function touchChat_(chat) {
  withLock_(1000, function () {
    const props = props_();
    const ck = parseChatKey_(props.getProperty('c_' + chat));
    if (ck.key && ck.day !== day_()) props.setProperty('c_' + chat, ck.key + '|' + day_());
  }, null);
}

/* Случайный ключ из латиницы и цифр (SHA-256 от двух UUID, ~140 бит). */
function newKey_() {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Date.now());
  return Utilities.base64EncodeWebSafe(raw).replace(/[^A-Za-z0-9]/g, '').slice(0, KEY_LEN);
}

function keyText_(key, hello) {
  return (hello ? '👋 Привет! Я присылаю ответы на приглашения, которые ты создаёшь на сайте.\n\n' : '') +
    '🔑 Твой ключ владельца:\n<code>' + key + '</code>\n\n' +
    'Нажми на ключ — он скопируется. Вставь его в конструкторе в поле «Ключ владельца» (блок «Уведомления в Telegram») ' +
    'и нажми «Отправить тестовое сообщение» — оно придёт сюда. Ответы будут приходить на приглашения, ' +
    'которые ты скопируешь или отправишь из конструктора после этого.' + siteLine_() +
    '\n\nНе показывай ключ другим. Потерял — /key, сменить — /newkey, отключить ответы — /stop.';
}

function newKeyText_(key) {
  return '🔁 Старый ключ больше не работает. Новый ключ владельца:\n<code>' + key + '</code>\n\n' +
    'Вставь его в конструкторе вместо старого — на каждом устройстве, где пользуешься конструктором. ' +
    'Ответы на уже отправленные приглашения продолжат приходить сюда.' + siteLine_();
}

function helpText_() {
  return 'Я присылаю ответы на приглашения, которые ты создаёшь на сайте.\n\n' +
    '/key — показать ключ владельца\n' +
    '/newkey — выпустить новый ключ (старый перестанет работать)\n' +
    '/stop — больше не присылать ответы\n\n' +
    'В группе /newkey и /stop может отправить только админ.' + siteLine_();
}

/* Ссылка на конструктор: папка сайта из SITE_URL + create.html (SITE_URL может быть и корнем домена) */
function siteLine_() {
  const base = siteBase_();
  return base ? '\n\nКонструктор: ' + esc_(base + 'create.html') : '';
}

/* ======================= обслуживание ======================= */

/* Запусти один раз вручную (▶ Выполнить): проверит токен, разрешит доступ, настроит бота
   и поставит триггеры — pollBot раз в минуту и cleanup раз в сутки. Можно запускать повторно. */
function setupTriggers() {
  const me = tg_('getMe', null, 'poll');
  if (!me.ok) throw new Error('Telegram не принял токен: ' + (me.description || 'нет ответа') + '. Проверь свойство скрипта TG_TOKEN.');
  const bot = me.result.username;
  setConf_('bot_name', bot);
  tg_('deleteWebhook', null, 'poll');  // пока у бота есть вебхук, getUpdates не работает
  tg_('setMyCommands', { commands: JSON.stringify([
    { command: 'key', description: 'Показать ключ владельца' },
    { command: 'newkey', description: 'Выпустить новый ключ (старый перестанет работать)' },
    { command: 'stop', description: 'Больше не присылать ответы' },
  ]) }, 'poll');
  tg_('setMyShortDescription', { short_description: 'Присылаю ответы на твои приглашения с сайта.' }, 'poll');
  tg_('setMyDescription', { description: 'Присылаю ответы на приглашения, которые ты создаёшь на сайте. Нажми «Старт» — получишь ключ владельца, его нужно вставить в конструкторе.' }, 'poll');

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['pollBot', 'cleanup'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pollBot').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('cleanup').timeBased().everyDays(1).atHour(4).create();
  pollBot();
  Logger.log('Готово: бот @' + bot + ' отвечает раз в минуту. Впиши в config.js → telegram.bot: \'' + bot + '\'');
}

/* Раз в сутки по триггеру:
   • забываем приглашения старше INVITE_TTL_DAYS (и старые записи без отпечатка с отключёнными ключами),
     пересобираем списки l_;
   • забываем ключи, у которых нет приглашений и которыми не пользовались KEY_TTL_DAYS дней,
     и записи-сироты k_/c_ (иначе хранилище растёт с каждым новым пользователем);
   • следим за местом в хранилище; всё записываем одним вызовом;
   • удаляем из таблицы короткие ссылки старше SHORT_TTL_DAYS. */
function cleanup() {
  withLock_(30000, function () {
    const props = props_();
    const all = props.getProperties();
    const today = day_();
    const oldest = today - INVITE_TTL_DAYS;
    const lists = {}, put = {}, gone = [];
    Object.keys(all).forEach(function (name) {
      if (name.indexOf('i_') !== 0) return;
      const inv = parseInv_(all[name], all);
      const dead = !inv || !inv.chat || inv.day < oldest || (!inv.c && !liveChat_(inv.chat, all));
      if (dead) { gone.push(name); return; }
      (lists[inv.chat] = lists[inv.chat] || []).push([name.slice(2), inv.day]);
    });
    const invites = gone.length;
    Object.keys(all).forEach(function (name) {
      if (name.indexOf('l_') === 0 && !lists[name.slice(2)]) gone.push(name);
    });
    Object.keys(lists).forEach(function (chat) {
      const ids = lists[chat].sort(function (a, b) { return a[1] - b[1]; }).map(function (x) { return x[0]; });
      const v = ids.slice(-MAX_INVITES_PER_CHAT).join(',');
      if (all['l_' + chat] !== v) put['l_' + chat] = v;
    });
    let keys = 0;
    Object.keys(all).forEach(function (name) {
      if (name.indexOf('c_') === 0) {
        const chat = name.slice(2), ck = parseChatKey_(all[name]);
        if (!ck.key || all['k_' + ck.key] !== chat) { gone.push(name); return; }       // ключа уже нет
        if (!ck.day) { put[name] = ck.key + '|' + today; return; }                     // старый формат: срок считаем с сегодня
        if (ck.day < today - KEY_TTL_DAYS && !lists[chat]) { gone.push(name, 'k_' + ck.key); keys++; }
      } else if (name.indexOf('k_') === 0) {
        if (parseChatKey_(all['c_' + all[name]]).key !== name.slice(2)) gone.push(name); // ключ заменили или отключили
      }
    });
    // место в хранилище считаем по тому, что останется
    const left = {};
    const skip = {};
    gone.forEach(function (k) { skip[k] = true; });
    Object.keys(all).forEach(function (k) { if (!skip[k]) left[k] = all[k]; });
    Object.keys(put).forEach(function (k) { left[k] = put[k]; });
    const used = usage_(left);
    const purged = used > STORE_SOFT ? purgeOldest_(left, used - STORE_TARGET, put) : [];
    commit_(props, all, put, gone.concat(purged));
    let links = 0;
    try { links = purgeShort_(); } catch (err) { console.error('Короткие ссылки: ' + err); }
    Logger.log('Удалено приглашений: ' + (invites + purged.length) + ', заброшенных ключей: ' + keys + ', старых коротких ссылок: ' + links);
  }, null);
}

/* Строки таблицы идут по времени: двоичным поиском находим первую свежую и удаляем всё, что старше.
   Номера кодов сквозные: short_off помнит, сколько строк уже удалено. Вызывается под замком. */
function purgeShort_() {
  const p = props_();
  const id = p.getProperty('short_sheet');
  if (!id) return 0;
  const sh = openShort_(id);
  trimColumns_(sh);  // таблицы, созданные прежней версией, — с 26 столбцами
  const last = sh.getLastRow();
  if (!last) return 0;
  const oldest = day_() - SHORT_TTL_DAYS;
  let lo = 1, hi = last + 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((Number(sh.getRange(mid, 2).getValue()) || 0) < oldest) lo = mid + 1; else hi = mid;
  }
  const n = lo - 1;
  if (!n) return 0;
  if (n >= sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);  // все строки листа удалить нельзя
  sh.deleteRows(1, n);
  const off = (Number(p.getProperty('short_off')) || 0) + n;
  p.setProperty('short_off', String(off));
  // сразу кладём новые сведения: раскрытие не прочитает строки со старым сдвигом
  cache_().put('shm', JSON.stringify({ id: id, off: off, last: off + sh.getLastRow(), at: Date.now() }), 3600);
  return n;
}

/* Для себя: сколько пользователей и приглашений, насколько заполнено хранилище, сколько запросов к Telegram. */
function stats() {
  const all = props_().getProperties();
  const today = day_();
  let users = 0, idle = 0, invites = 0;
  Object.keys(all).forEach(function (name) {
    if (name.indexOf('c_') === 0) {
      users++;
      const d = parseChatKey_(all[name]).day;
      if (d && d < today - 30) idle++;
    }
    if (name.indexOf('i_') === 0) invites++;
  });
  const caps = fetchCaps_();
  Logger.log('Пользователей: ' + users + ' (месяц не заходили: ' + idle + '), приглашений: ' + invites +
    ', хранилище: ' + Math.round(usage_(all) / 1024) + ' из 500 КБ (чистка начинается с ' + Math.round(STORE_SOFT / 1024) + ' КБ)' +
    ', запросов к Telegram за эти 6 часов: ' + fetchState_().n + ' из ' + caps.all + ' (общий бюджет — ' + caps.base + ', с запасом владельцев — ' + caps.send + ')');
}

/* ======================= помощники ======================= */

function props_() {
  return PropertiesService.getScriptProperties();
}
let cache_memo_ = null;
function cache_() {
  return cache_memo_ || (cache_memo_ = CacheService.getScriptCache());
}

/* Настройки из свойств скрипта: читаем раз в 10 минут (кэш cfg), а не на каждый запрос —
   квота на чтение свойств 50 000 в сутки. Поменял свойство вручную — подействует в течение 10 минут. */
const CONF_KEYS = ['SITE_URL', 'SHORT_ALLOW', 'URLFETCH_DAY', 'ADMIN_CHAT', 'bot_name'];
let conf_memo_ = null;
function conf_(name) {
  if (!conf_memo_) {
    const cache = cache_();
    let c = null;
    try { c = JSON.parse(cache.get('cfg') || 'null'); } catch (err) { c = null; }
    if (!c || typeof c !== 'object') {
      const p = props_();
      c = {};
      CONF_KEYS.forEach(function (k) { c[k] = p.getProperty(k) || ''; });
      cache.put('cfg', JSON.stringify(c), 600);
    }
    conf_memo_ = c;
  }
  return String(conf_memo_[name] || '');
}
function setConf_(name, value) {
  props_().setProperty(name, value);
  cache_().remove('cfg');
  conf_memo_ = null;
}

let token_cache_ = '';
function token_() {
  if (token_cache_) return token_cache_;
  const t = String(props_().getProperty('TG_TOKEN') || TG_TOKEN).trim();
  if (!t || t.indexOf('ВСТАВЬ') === 0) throw new Error('Нет токена бота: добавь свойство скрипта TG_TOKEN (Настройки проекта → Свойства скрипта).');
  return (token_cache_ = t);
}

/* tier — ярус бюджета UrlFetch: 'poll' (опрос, настройка), 'own' (первые сообщения владельца) или '' (см. FETCH_DAY) */
function tg_(method, payload, tier) {
  if (!fetchTake_(tier || '')) return { ok: false, quota: true, description: 'исчерпан запас запросов к Telegram на эти 6 часов' };
  let r;
  try {
    r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token_() + '/' + method, { method: 'post', muteHttpExceptions: true, payload: payload || {} });
  } catch (err) {
    return { ok: false, description: String(err) };
  }
  try {
    return JSON.parse(r.getContentText());
  } catch (err) {
    return { ok: false, description: 'HTTP ' + r.getResponseCode() };
  }
}

function send_(chat, text, tier, moved) {
  const base = { chat_id: chat, disable_web_page_preview: 'true' };
  let r = tg_('sendMessage', Object.assign({ text: text, parse_mode: 'HTML' }, base), tier);
  if (r.ok) return true;
  if (r.quota) { console.warn('sendMessage в ' + chat + ': ' + r.description); return false; }
  const to = r.parameters && r.parameters.migrate_to_chat_id;
  if (to && !moved) { moveChat_(chat, String(to)); return send_(String(to), text, tier, true); }  // группа стала супергруппой
  if (r.error_code !== 400) { console.warn('sendMessage в ' + chat + ': ' + (r.description || 'нет ответа')); return false; }
  // если разметка не разобралась — отправляем простым текстом (ссылки уже обезврежены)
  r = tg_('sendMessage', Object.assign({ text: unesc_(text.replace(/<[^>]+>/g, '')) }, base), tier);
  return !!r.ok;
}

/* У группы сменился chat_id (стала супергруппой) — переносим ключ и приглашения. */
function moveChat_(from, to) {
  if (!CHAT_RE.test(to)) return;
  withLock_(5000, function () {
    const props = props_();
    const all = props.getProperties();
    const put = {};
    const ck = parseChatKey_(all['c_' + from]);
    if (ck.key && all['k_' + ck.key] === from) { put['k_' + ck.key] = to; put['c_' + to] = ck.key + '|' + day_(); }
    const ids = splitList_(all['l_' + from]);
    ids.forEach(function (id) {
      const inv = parseInv_(all['i_' + id], all);
      if (inv && inv.chat === from) put['i_' + id] = to + '|' + inv.day + '|' + inv.c;
    });
    if (ids.length) put['l_' + to] = ids.join(',');
    if (Object.keys(put).length) props.setProperties(put);
    props.deleteProperty('c_' + from);
    props.deleteProperty('l_' + from);
  }, null);
}

function chatByKey_(key) {
  key = String(key || '');
  return KEY_RE.test(key) ? props_().getProperty('k_' + key) : null;
}

/* c_<chat>: «ключ|день»; старый формат — просто «ключ» (день 0, cleanup допишет сегодняшний) */
function parseChatKey_(v) {
  const p = String(v || '').split('|');
  return { key: KEY_RE.test(p[0]) ? p[0] : '', day: Number(p[1]) || 0 };
}

/* У чата есть действующий ключ (не было /stop). all — снимок свойств, если он уже есть. */
function liveChat_(chat, all) {
  const get = function (k) { return all ? all[k] : props_().getProperty(k); };
  const key = parseChatKey_(get('c_' + chat)).key;
  return !!key && get('k_' + key) === chat;
}

/* i_<id>: «chat|день|c»; старый формат «ключ|день» (до отпечатков) — чат берём по ключу, c пустой. */
function parseInv_(v, all) {
  const p = String(v || '').split('|');
  if (p.length === 3 && CHAT_RE.test(p[0])) return { chat: p[0], day: Number(p[1]) || 0, c: p[2] };
  if (p.length === 2 && KEY_RE.test(p[0])) {
    const chat = all ? all['k_' + p[0]] : props_().getProperty('k_' + p[0]);
    return { chat: chat || '', day: Number(p[1]) || 0, c: '' };
  }
  return null;
}

function splitList_(v) {
  return String(v || '').split(',').filter(function (id) { return ID_RE.test(id); });
}

function usage_(all) {
  return Object.keys(all).reduce(function (n, k) { return n + k.length + String(all[k]).length; }, 0);
}

/* Замок скрипта. Если он уже наш (вызов изнутри другого замка) — просто выполняем. Не дождались — busy. */
function withLock_(ms, fn, busy) {
  const lock = LockService.getScriptLock();
  const had = lock.hasLock();
  if (!had && !lock.tryLock(ms)) return busy;
  try {
    return fn();
  } finally {
    if (!had) lock.releaseLock();
  }
}

/* Уведомление владельцу: лимит на приглашение и на владельца, затем общий поток;
   если общий поток кто-то выел — первые reserveOwner сообщений владельца идут из запаса. */
function allowNotify_(chat, id) {
  const own = id ? [['ni' + id, LIM.notifyInvite], ['o' + chat, LIM.notifyOwner]] : [['o' + chat, LIM.notifyOwner]];
  if (!peekAll_(own)) return false;
  if (allowAll_(own.concat([['*nall', LIM.notifyAll]]))) return true;
  return allowAll_(own.concat([['nr' + chat, LIM.reserveOwner], ['*nres', LIM.reserveAll]]));
}

/* Счётчики лимитов в кэше по 10-минутным окнам. Правило — [имя, максимум, сколько добавить].
   • Счётчик «на кого-то» (чат, приглашение, строка таблицы) — ключ w<имя>_<окно>, живёт 15 минут.
   • Общий счётчик (имя со «*») — один ключ g<имя> со значением «окно:число» и сроком 6 часов, срок
     обновляется при каждой записи. Переполненный кэш (около 1 000 записей) выбрасывает записи, которым
     осталось жить меньше всего, поэтому общие счётчики уходят последними: общие лимиты не сбрасываются
     под нагрузкой. Если кэш всё же потеряет счётчики, суточную квоту держит fetchTake_ (копия в свойствах).
   allowAll_ пропускает, только если хватает во всех счётчиках сразу. */
function win_() { return Math.floor(Date.now() / 600000); }
function rkey_(name, w) { return name.charAt(0) === '*' ? 'g' + name.slice(1) : 'w' + name + '_' + w; }
function rval_(name, raw, w) {
  if (raw === null || raw === undefined) return 0;
  if (name.charAt(0) !== '*') return Number(raw) || 0;
  const p = String(raw).split(':');
  return Number(p[0]) === w ? Number(p[1]) || 0 : 0;
}
function counts_(rules) {
  const w = win_();
  const keys = rules.map(function (r) { return rkey_(r[0], w); });
  const got = cache_().getAll(keys);
  return { w: w, keys: keys, n: rules.map(function (r, i) { return rval_(r[0], got[keys[i]], w); }) };
}
function peekAll_(rules) {
  const st = counts_(rules);
  return rules.every(function (r, i) { return st.n[i] + (r[2] || 1) <= r[1]; });
}
function allowAll_(rules) {
  const st = counts_(rules);
  if (!rules.every(function (r, i) { return st.n[i] + (r[2] || 1) <= r[1]; })) return false;
  const loc = {}, glob = {};
  rules.forEach(function (r, i) {
    const v = st.n[i] + (r[2] || 1);
    if (r[0].charAt(0) === '*') glob[st.keys[i]] = st.w + ':' + v; else loc[st.keys[i]] = String(v);
  });
  if (Object.keys(loc).length) cache_().putAll(loc, 900);
  if (Object.keys(glob).length) cache_().putAll(glob, 21600);
  return true;
}
function allow_(name, max, n) { return allowAll_([[name, max, n || 1]]); }
function peek_(name, max) { return peekAll_([[name, max]]); }

/* Счётчик запросов к Telegram за 6-часовую четверть (см. FETCH_DAY): части gf<четверть>_<0..7> в кэше
   со сроком 6 часов и копия fetch_q в свойствах — если кэш сбросят, счёт не начнётся с нуля. */
function quarter_() { return Math.floor(Date.now() / 216e5); }
/* Потолки четверти: all — для 'poll', send — для 'own', base — для всего остального */
function fetchCaps_() {
  const all = Math.floor((Number(conf_('URLFETCH_DAY')) || FETCH_DAY) * 0.19);
  const send = all - Math.min(FETCH_POLL, Math.floor(all / 2));
  return { all: all, send: send, base: send - Math.floor(send * FETCH_OWN) };
}
function fetchCap_(tier) {
  const caps = fetchCaps_();
  return tier === 'poll' ? caps.all : tier === 'own' ? caps.send : caps.base;
}
let fetch_shard_ = -1;
function fetchState_() {
  const q = quarter_();
  const keys = [];
  for (let i = 0; i < FETCH_SHARDS; i++) keys.push('gf' + q + '_' + i);
  const got = cache_().getAll(keys);
  let n = 0, any = false, seed = 0;
  keys.forEach(function (k) { if (got[k] !== null && got[k] !== undefined) { any = true; n += Number(got[k]) || 0; } });
  if (!any) {
    const saved = String(props_().getProperty('fetch_q') || '').split(':');
    if (Number(saved[0]) === q) n = seed = (Number(saved[1]) || 0) + FETCH_SAVE;  // могли не успеть сохранить до FETCH_SAVE запросов
  }
  return { q: q, keys: keys, got: got, n: n, seed: seed };
}
function fetchPeek_(tier) {
  return fetchState_().n < fetchCap_(tier);
}
function fetchTake_(tier) {
  const st = fetchState_();
  if (st.n >= fetchCap_(tier)) return false;
  if (fetch_shard_ < 0) fetch_shard_ = Math.floor(Math.random() * FETCH_SHARDS);
  const put = {};
  if (st.seed) put[st.keys[0]] = String(st.seed);
  const k = st.keys[fetch_shard_];
  put[k] = String((k in put ? Number(put[k]) : Number(st.got[k]) || 0) + 1);
  cache_().putAll(put, 21600);
  const total = st.n + 1;
  if (st.seed || Math.floor(total / FETCH_SAVE) !== Math.floor(st.n / FETCH_SAVE)) props_().setProperty('fetch_q', st.q + ':' + total);
  return true;
}

/* Адрес сайта для белого списка ссылок: origin + папка, всегда с «/» на конце.
   https://site.ru → https://site.ru/; https://user.github.io/love → …/love/; …/love/create.html → …/love/.
   Не https или не разобрался — пусто (тогда ссылки в ответах обезвреживаются все). */
let site_memo_ = null;
function siteBase_() {
  if (site_memo_ !== null) return site_memo_;
  const raw = String(conf_('SITE_URL') || SITE_URL).trim();
  const m = raw.match(/^(https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d{1,5})?)(\/[^?#\s]*)?(?:[?#]\S*)?$/i);
  if (!m) return (site_memo_ = '');
  let path = m[2] || '/';
  // последний кусок пути с точкой — файл (create.html): отрезаем; без точки — папка
  path = /\/[^/]*\.[^/]*$/.test(path) ? path.replace(/[^/]*$/, '') : path.replace(/\/?$/, '/');
  return (site_memo_ = m[1].toLowerCase() + path);
}

function day_() {
  return Math.floor(Date.now() / 864e5);
}

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unesc_(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

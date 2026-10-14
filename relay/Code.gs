/* Посредник между сайтом и Telegram (Google Apps Script) — один общий бот для всех пользователей.
   Как устроено:
   • Пользователь пишет боту /start — бот выдаёт ему личный ключ владельца, привязанный к его чату.
   • Конструктор на сайте регистрирует id приглашений этим ключом (action: register).
   • Ответы на приглашение (сайт присылает text + id) уходят в чат того, кто его зарегистрировал.
   Единственный секрет — токен бота. Он живёт только здесь (лучше в «Свойствах скрипта»), на сайте его нет.
   Апдейты Telegram забираем через getUpdates по триггеру раз в минуту: вебхук на Apps Script
   не работает, потому что веб-приложение отвечает Telegram редиректом 302.
   Ещё посредник умеет:
   • сокращать ссылки сайта (action: short → код; GET ?s=код → длинная ссылка). Ссылки хранятся
     в Google-таблице «Короткие ссылки» в аккаунте владельца скрипта, код — номер строки в base62;
   • принимать сообщения об ошибках: ссылка с сайта t.me/<бот>?start=fix_<id места> — бот попросит
     описать проблему и перешлёт текст в чат ADMIN_CHAT (свойство скрипта). */

const TG_TOKEN = 'ВСТАВЬ_ТОКЕН_БОТА';  // запасной вариант: лучше задай свойство скрипта TG_TOKEN
const SITE_URL = '';                   // необязательно: адрес конструктора, бот покажет ссылку (или свойство SITE_URL)

const MAX_PER_OWNER_10_MIN = 40;  // сообщений одному владельцу за 10 минут — защита от спама
const MAX_TOTAL_10_MIN = 300;     // всего сообщений через посредника за 10 минут — бережём квоты
const MAX_NEW_IDS_10_MIN = 100;   // новых приглашений на одного владельца за 10 минут
const MAX_IDS_PER_CALL = 50;      // конструктор присылает не больше 30 (вся история)
const INVITE_TTL_DAYS = 90;       // через сколько дней забываем приглашение (место в хранилище ограничено)
const KEY_LEN = 24;
const ID_RE = /^[a-z0-9]{1,13}$/;
const KEY_RE = /^[A-Za-z0-9]{24,64}$/;
const SHORT_RE = /^[A-Za-z0-9]{1,10}$/;
const MAX_SHORT_10_MIN = 400;     // новых коротких ссылок за 10 минут — защита от спама
const B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/* Хранилище — свойства скрипта (всего 500 КБ на проект):
   k_<ключ>    → chat_id владельца
   c_<chat_id> → его действующий ключ
   i_<id>      → <ключ>|<день регистрации>  (каким ключом зарегистрировано приглашение)
   tg_offset   → номер следующего апдейта Telegram
   bot_name    → ник бота без @ (для doGet и команд вида /key@бот в группах) */

/* ======================= сайт → посредник ======================= */

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'register') return json_(register_(body));
    if (body.action === 'short') return json_(short_(body));
    if (body.action === 'test') {
      const chat = chatByKey_(body.key);
      if (!chat) return json_({ ok: false });
      if (!allowSend_(chat)) return json_({ ok: false, error: 'rate' });
      return json_({ ok: send_(chat, '✅ <b>Тест из конструктора</b>: ответы на твои приглашения будут приходить сюда.') });
    }
    return json_(notify_(body));
  } catch (err) {
    console.error(err);
    return json_({ ok: false });
  }
}

/* GET ?s=<код> — раскрыть короткую ссылку; без параметров — проверка, что посредник жив, и ник бота. */
function doGet(e) {
  const code = String((e && e.parameter && e.parameter.s) || '');
  if (code) return json_(expand_(code));
  return json_({ ok: true, bot: props_().getProperty('bot_name') || '' });
}

/* ======================= короткие ссылки ======================= */

/* Какие адреса можно сокращать: свойство SHORT_ALLOW (префиксы через запятую), иначе адрес сайта
   из SITE_URL и Яндекс Карты. Без настроек — любые https-ссылки (go.html на сайте всё равно
   перенаправляет только на сам сайт и Яндекс Карты). */
function shortAllowed_(url) {
  if (!/^https:\/\/[^\s]{8,3990}$/.test(url)) return false;
  const p = props_();
  let allow = String(p.getProperty('SHORT_ALLOW') || '').split(',').map(function (x) { return x.trim(); }).filter(String);
  const site = String(p.getProperty('SITE_URL') || SITE_URL).replace(/[^/]*$/, '');
  if (!allow.length && site) allow = [site, 'https://yandex.ru/maps/'];
  return !allow.length || allow.some(function (a) { return url.indexOf(a) === 0; });
}
function sheet_() {
  const p = props_();
  let id = p.getProperty('short_sheet');
  let ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (err) { ss = null; } }
  if (!ss) { ss = SpreadsheetApp.create('Короткие ссылки сайта'); p.setProperty('short_sheet', ss.getId()); }
  return ss.getSheets()[0];
}
function b62_(n) { let s = ''; do { s = B62[n % 62] + s; n = Math.floor(n / 62); } while (n > 0); return s; }
function unb62_(s) { let n = 0; for (let i = 0; i < s.length; i++) { const d = B62.indexOf(s[i]); if (d < 0) return -1; n = n * 62 + d; } return n; }

function short_(body) {
  const url = String(body.url || '');
  if (!shortAllowed_(url)) return { ok: false, error: 'url' };
  // одна и та же ссылка — один код (кэш на 6 часов, чтобы не плодить строки)
  const cache = CacheService.getScriptCache();
  const h = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, url)).slice(0, 40);
  const hit = cache.get('sh_' + h);
  if (hit) return { ok: true, id: hit };
  if (!allow_('short', MAX_SHORT_10_MIN, 1)) return { ok: false, error: 'rate' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: false, error: 'busy' };
  try {
    const sh = sheet_();
    sh.appendRow([url, day_()]);
    const id = b62_(sh.getLastRow());
    cache.put('sh_' + h, id, 21600);
    return { ok: true, id: id };
  } finally {
    lock.releaseLock();
  }
}
function expand_(code) {
  if (!SHORT_RE.test(code)) return { ok: false };
  const row = unb62_(code);
  if (row < 1) return { ok: false };
  const cache = CacheService.getScriptCache();
  const hit = cache.get('ex_' + code);
  if (hit) return { ok: true, url: hit };
  const sh = sheet_();
  if (row > sh.getLastRow()) return { ok: false };
  const url = String(sh.getRange(row, 1).getValue() || '');
  if (!url) return { ok: false };
  if (url.length < 90000) cache.put('ex_' + code, url, 21600);
  return { ok: true, url: url };
}

/* Ответ на приглашение: пересылаем, только если приглашение зарегистрировано действующим ключом. */
function notify_(body) {
  const id = String(body.id || '');
  if (!ID_RE.test(id)) return { ok: false };
  const inv = parseInv_(props_().getProperty('i_' + id));
  const chat = inv && chatByKey_(inv.key);
  if (!chat) return { ok: false };
  const text = String(body.text || '').slice(0, 3800);
  if (!text) return { ok: false };
  if (!allowSend_(chat)) return { ok: false, error: 'rate' };
  return { ok: send_(chat, text) };
}

/* Привязываем id приглашений к ключу. Чужие приглашения (зарегистрированные действующим ключом
   другого человека) не перехватываем; свои — обновляем, чтобы продлить срок хранения. */
function register_(body) {
  const key = String(body.key || '');
  const chat = chatByKey_(key);
  if (!chat) return { ok: false };
  const props = props_();
  const today = day_();
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter(function (id, i, a) {
    return ID_RE.test(id) && a.indexOf(id) === i;
  }).slice(0, MAX_IDS_PER_CALL);
  const put = {};
  let taken = 0, fresh = 0;
  ids.forEach(function (id) {
    const old = parseInv_(props.getProperty('i_' + id));
    if (old && old.key === key) {
      if (old.day !== today) put['i_' + id] = key + '|' + today;
      return;
    }
    const oldChat = old && chatByKey_(old.key);
    if (oldChat && oldChat !== chat) { taken++; return; }
    put['i_' + id] = key + '|' + today;
    fresh++;
  });
  if (fresh && !allow_('r' + chat, MAX_NEW_IDS_10_MIN, fresh)) return { ok: false, error: 'rate' };
  if (Object.keys(put).length) {
    try {
      props.setProperties(put);
    } catch (err) {
      console.error('Хранилище свойств переполнено? ' + err);  // запусти cleanup или stats
      return { ok: false, error: 'storage' };
    }
  }
  return { ok: true, taken: taken };
}

/* ======================= Telegram → бот ======================= */

/* Раз в минуту по триггеру (ставит setupTriggers): забираем новые сообщения боту и отвечаем. */
function pollBot() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;  // предыдущий запуск ещё работает
  try {
    const props = props_();
    const offset = Number(props.getProperty('tg_offset') || 0);
    const r = tg_('getUpdates', { offset: offset, timeout: 0, limit: 100, allowed_updates: JSON.stringify(['message']) });
    if (!r.ok) { console.warn('getUpdates: ' + (r.description || 'нет ответа')); return; }
    if (!r.result.length) return;
    r.result.forEach(function (u) {
      try {
        if (u.message) onMessage_(u.message);
      } catch (err) {
        console.error(err);  // одно сломанное сообщение не должно стопорить очередь
      }
    });
    props.setProperty('tg_offset', String(r.result[r.result.length - 1].update_id + 1));
  } finally {
    lock.releaseLock();
  }
}

function onMessage_(m) {
  const chat = String((m.chat && m.chat.id) || '');
  const text = String(m.text || '').trim();
  if (!chat || !text) return;
  const isPrivate = m.chat.type === 'private';
  const c = text.match(/^\/([a-z]+)(?:@(\w+))?(?:\s+(\S+))?/i);
  if (!c) {
    if (isPrivate && forwardFix_(chat, m, text)) return;
    if (isPrivate) send_(chat, helpText_());  // в группах на обычные сообщения не отвечаем
    return;
  }
  // ссылка «Нашли ошибку?» с сайта: /start fix_<id места или плана>
  if (isPrivate && c[1].toLowerCase() === 'start' && /^fix_[\w-]{1,56}$/.test(c[3] || '')) {
    CacheService.getScriptCache().put('fx_' + chat, c[3].slice(4), 3600);
    return send_(chat, '🛠 Спасибо, что помогаешь! Опиши одним сообщением, что не так: место закрылось, другой адрес, неверные часы, ошибка в описании…');
  }
  const bot = props_().getProperty('bot_name') || '';
  if (c[2] && bot && c[2].toLowerCase() !== bot.toLowerCase()) return;  // команда другому боту
  const cmd = c[1].toLowerCase();
  if (cmd === 'start' || cmd === 'key') return send_(chat, keyText_(issueKey_(chat, false), cmd === 'start'));
  if (cmd === 'newkey') return send_(chat, newKeyText_(issueKey_(chat, true)));
  if (cmd === 'stop') {
    revokeKey_(chat);
    return send_(chat, '🔕 Ключ удалён — ответы на приглашения сюда больше не придут.\n\nЧтобы снова их получать, отправь /key: будет новый ключ, его нужно вставить в конструкторе.');
  }
  if (isPrivate || c[2]) send_(chat, helpText_());
}

/* Пересылаем описание ошибки в ADMIN_CHAT (свойство скрипта), если человек пришёл по ссылке «Нашли ошибку?» */
function forwardFix_(chat, m, text) {
  const cache = CacheService.getScriptCache();
  const what = cache.get('fx_' + chat);
  if (!what) return false;
  cache.remove('fx_' + chat);
  const admin = props_().getProperty('ADMIN_CHAT');
  const who = m.from ? esc_((m.from.username ? '@' + m.from.username : m.from.first_name) || '') : '';
  if (admin && allow_('fix', 60, 1)) send_(admin, '🛠 <b>Ошибка в каталоге</b>: <code>' + esc_(what) + '</code>' + (who ? ' от ' + who : '') + '\n' + esc_(text.slice(0, 1500)));
  send_(chat, admin ? '✅ Передали команде — поправим. Спасибо!' : '✅ Спасибо! Записали.');
  return true;
}

/* Действующий ключ чата; renew — выпустить новый, а старый отключить. */
function issueKey_(chat, renew) {
  const props = props_();
  const old = props.getProperty('c_' + chat);
  if (old && !renew && props.getProperty('k_' + old) === chat) return old;
  if (old) props.deleteProperty('k_' + old);
  const key = newKey_();
  const put = {};
  put['k_' + key] = chat;
  put['c_' + chat] = key;
  props.setProperties(put);
  return key;
}

function revokeKey_(chat) {
  const props = props_();
  const old = props.getProperty('c_' + chat);
  if (old) props.deleteProperty('k_' + old);
  props.deleteProperty('c_' + chat);
}

/* Случайный ключ из латиницы и цифр (SHA-256 от двух UUID, ~140 бит). */
function newKey_() {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Date.now());
  return Utilities.base64EncodeWebSafe(raw).replace(/[^A-Za-z0-9]/g, '').slice(0, KEY_LEN);
}

function keyText_(key, hello) {
  return (hello ? '👋 Привет! Я присылаю ответы на приглашения, которые ты создаёшь на сайте.\n\n' : '') +
    '🔑 Твой ключ владельца:\n<code>' + key + '</code>\n\n' +
    'Нажми на ключ — он скопируется. Вставь его в конструкторе в поле «Ключ владельца» (блок «Ответы в Telegram») ' +
    'и нажми «Отправить тестовое сообщение» — оно придёт сюда.' + siteLine_() +
    '\n\nНе показывай ключ другим. Потерял — /key, сменить — /newkey, отключить ответы — /stop.';
}

function newKeyText_(key) {
  return '🔁 Старый ключ больше не работает. Новый ключ владельца:\n<code>' + key + '</code>\n\n' +
    'Вставь его в конструкторе вместо старого: приглашения, созданные в этом браузере, подключатся заново сами. ' +
    'На других устройствах ключ тоже нужно заменить.' + siteLine_();
}

function helpText_() {
  return 'Я присылаю ответы на приглашения, которые ты создаёшь на сайте.\n\n' +
    '/key — показать ключ владельца\n' +
    '/newkey — выпустить новый ключ (старый перестанет работать)\n' +
    '/stop — больше не присылать ответы' + siteLine_();
}

function siteLine_() {
  const url = props_().getProperty('SITE_URL') || SITE_URL;
  return url ? '\n\nКонструктор: ' + esc_(url) : '';
}

/* ======================= обслуживание ======================= */

/* Запусти один раз вручную (▶ Выполнить): проверит токен, разрешит доступ, настроит бота
   и поставит триггеры — pollBot раз в минуту и cleanup раз в сутки. Можно запускать повторно. */
function setupTriggers() {
  const me = tg_('getMe');
  if (!me.ok) throw new Error('Telegram не принял токен: ' + (me.description || 'нет ответа') + '. Проверь свойство скрипта TG_TOKEN.');
  const bot = me.result.username;
  props_().setProperty('bot_name', bot);
  tg_('deleteWebhook');  // пока у бота есть вебхук, getUpdates не работает
  tg_('setMyCommands', { commands: JSON.stringify([
    { command: 'key', description: 'Показать ключ владельца' },
    { command: 'newkey', description: 'Выпустить новый ключ (старый перестанет работать)' },
    { command: 'stop', description: 'Больше не присылать ответы' },
  ]) });
  tg_('setMyShortDescription', { short_description: 'Присылаю ответы на твои приглашения с сайта.' });
  tg_('setMyDescription', { description: 'Присылаю ответы на приглашения, которые ты создаёшь на сайте. Нажми «Старт» — получишь ключ владельца, его нужно вставить в конструкторе.' });

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['pollBot', 'cleanup'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pollBot').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('cleanup').timeBased().everyDays(1).atHour(4).create();
  pollBot();
  Logger.log('Готово: бот @' + bot + ' отвечает раз в минуту. Впиши в config.js → telegram.bot: \'' + bot + '\'');
}

/* Раз в сутки по триггеру: забываем старые приглашения и приглашения с отключёнными ключами. */
function cleanup() {
  const props = props_();
  const all = props.getProperties();
  const oldest = day_() - INVITE_TTL_DAYS;
  let n = 0;
  Object.keys(all).some(function (name) {
    if (name.indexOf('i_') !== 0) return false;
    const inv = parseInv_(all[name]);
    if (inv && inv.day >= oldest && all['k_' + inv.key]) return false;
    props.deleteProperty(name);
    return ++n >= 3000;  // остальное — в следующий раз, чтобы уложиться в лимит времени
  });
  Logger.log('Удалено приглашений: ' + n);
}

/* Для себя: сколько пользователей и приглашений, насколько заполнено хранилище. */
function stats() {
  const all = props_().getProperties();
  let users = 0, invites = 0, bytes = 0;
  Object.keys(all).forEach(function (name) {
    if (name.indexOf('k_') === 0) users++;
    if (name.indexOf('i_') === 0) invites++;
    bytes += name.length + String(all[name]).length;
  });
  Logger.log('Пользователей: ' + users + ', приглашений: ' + invites + ', хранилище: ' + Math.round(bytes / 1024) + ' из 500 КБ');
}

/* ======================= помощники ======================= */

function props_() {
  return PropertiesService.getScriptProperties();
}

let token_cache_ = '';
function token_() {
  if (token_cache_) return token_cache_;
  const t = String(props_().getProperty('TG_TOKEN') || TG_TOKEN).trim();
  if (!t || t.indexOf('ВСТАВЬ') === 0) throw new Error('Нет токена бота: добавь свойство скрипта TG_TOKEN (Настройки проекта → Свойства скрипта).');
  return (token_cache_ = t);
}

function tg_(method, payload) {
  const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token_() + '/' + method, { method: 'post', muteHttpExceptions: true, payload: payload || {} });
  try {
    return JSON.parse(r.getContentText());
  } catch (err) {
    return { ok: false, description: 'HTTP ' + r.getResponseCode() };
  }
}

function send_(chat, text) {
  const base = { chat_id: chat, disable_web_page_preview: 'true' };
  let r = tg_('sendMessage', Object.assign({ text: text, parse_mode: 'HTML' }, base));
  if (r.ok) return true;
  const to = r.parameters && r.parameters.migrate_to_chat_id;
  if (to) { moveChat_(chat, String(to)); return send_(String(to), text); }  // группа стала супергруппой
  if (r.error_code !== 400) { console.warn('sendMessage в ' + chat + ': ' + (r.description || 'нет ответа')); return false; }
  // если разметка не разобралась — отправляем простым текстом
  const plain = text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  r = tg_('sendMessage', Object.assign({ text: plain }, base));
  return !!r.ok;
}

/* У группы сменился chat_id (стала супергруппой) — переносим ключ, приглашения остаются. */
function moveChat_(from, to) {
  const props = props_();
  const key = props.getProperty('c_' + from);
  if (!key) return;
  const put = {};
  put['k_' + key] = to;
  put['c_' + to] = key;
  props.setProperties(put);
  props.deleteProperty('c_' + from);
}

function chatByKey_(key) {
  key = String(key || '');
  return KEY_RE.test(key) ? props_().getProperty('k_' + key) : null;
}

function parseInv_(v) {
  const p = String(v || '').split('|');
  return p.length === 2 && KEY_RE.test(p[0]) ? { key: p[0], day: Number(p[1]) || 0 } : null;
}

/* Не больше 40 сообщений одному владельцу и 300 всего за 10 минут. */
function allowSend_(chat) {
  return allow_('o' + chat, MAX_PER_OWNER_10_MIN, 1) && allow_('all', MAX_TOTAL_10_MIN, 1);
}

function allow_(name, max, n) {
  const cache = CacheService.getScriptCache();
  const key = name + '_' + Math.floor(Date.now() / 600000);
  const used = Number(cache.get(key) || 0);
  if (used + n > max) return false;
  cache.put(key, String(used + n), 700);
  return true;
}

function day_() {
  return Math.floor(Date.now() / 864e5);
}

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

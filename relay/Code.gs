/* Посредник между сайтом и Telegram (Google Apps Script) — один общий бот для всех пользователей.
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
     в Google-таблице «Короткие ссылки» в аккаунте владельца скрипта, код — номер строки в base62;
   • принимать сообщения об ошибках: ссылка с сайта t.me/<бот>?start=fix_<id места> — бот попросит
     описать проблему и перешлёт текст в чат ADMIN_CHAT (свойство скрипта). */

const TG_TOKEN = 'ВСТАВЬ_ТОКЕН_БОТА';  // запасной вариант: лучше задай свойство скрипта TG_TOKEN
const SITE_URL = '';                   // адрес конструктора (или свойство SITE_URL): бот покажет ссылку, ссылки на сайт в ответах останутся ссылками

const INVITE_TTL_DAYS = 90;       // приглашение без ответов и продлений забываем через 90 дней
const MAX_INVITES_PER_CHAT = 100; // приглашений на один чат (ключ): самые старые вытесняются
const MAX_IDS_PER_CALL = 50;      // конструктор присылает не больше 30 (вся история)
const STORE_SOFT = 420 * 1024;    // хранилище свойств — 500 КБ на проект: после 420 КБ чистим самые старые приглашения…
const STORE_TARGET = 340 * 1024;  // …пока не останется 340 КБ
const KEY_LEN = 24;
const ID_RE = /^[a-z0-9]{1,13}$/;
const KEY_RE = /^[A-Za-z0-9]{24,64}$/;
const CHAT_RE = /^-?\d{1,20}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{16,64}$/;
const SHORT_RE = /^[A-Za-z0-9]{5,14}$/;
const B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/* Лимиты на 10 минут. IP-адреса Apps Script не видит, поэтому лимиты — по ключу, чату, приглашению
   и по «семейству» ссылок; у уведомлений свой общий поток и отдельный запас, который не съест спам. */
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
  expandMiss: 300,     // неудачных раскрытий коротких ссылок (перебор кодов)
  botChat: 12,         // ответов бота одному чату
  botHelp: 3,          // из них — подсказок на обычные сообщения
  botAll: 300,         // ответов бота всего
  fixChat: 3,          // сообщений об ошибке в каталоге от одного чата
  fixAll: 60,          // сообщений об ошибке всего
  newKeyChat: 5,       // новых ключей на чат
  newKeyAll: 60,       // новых ключей всего
};

/* Хранилище — свойства скрипта (всего 500 КБ на проект):
   k_<ключ>    → chat_id владельца
   c_<chat_id> → его действующий ключ
   i_<id>      → <chat_id>|<день>|<c>  (чьё приглашение, когда его последний раз продлевали, отпечаток секрета создателя)
   l_<chat_id> → id приглашений чата через запятую, от старых к новым (для лимита и переноса группы)
   tg_offset   → номер следующего апдейта Telegram
   bot_name    → ник бота без @ (для doGet и команд вида /key@бот в группах) */

/* ======================= сайт → посредник ======================= */

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
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
  let allow = String(props_().getProperty('SHORT_ALLOW') || '').split(',').map(function (x) { return x.trim(); }).filter(String);
  const site = siteBase_();
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
function digest_(s, len) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)).slice(0, len);
}

function short_(body) {
  const url = String(body.url || '');
  if (!shortAllowed_(url)) return { ok: false, error: 'url' };
  // одна и та же ссылка — один код (кэш на 6 часов, чтобы не плодить строки)
  const cache = CacheService.getScriptCache();
  const h = digest_(url, 40);
  const hit = cache.get('sh_' + h);
  if (hit) return { ok: true, id: hit };
  // «семейство» — ссылки одного приглашения (всё до первого &): голоса и ответы одного сбора
  const fam = digest_(url.split('&')[0], 16);
  if (!allowAll_([['sf' + fam, LIM.shortFamily], ['short', LIM.shortAll]])) return { ok: false, error: 'rate' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: false, error: 'busy' };
  try {
    const sh = sheet_();
    // к номеру строки добавляем 4 случайных символа: коды не перебрать подряд
    let tag = '';
    for (let i = 0; i < 4; i++) tag += B62[Math.floor(Math.random() * 62)];
    sh.appendRow([url, day_(), tag]);
    const id = b62_(sh.getLastRow()) + tag;
    cache.put('sh_' + h, id, 21600);
    if (url.length < 90000) cache.put('ex_' + id, url, 21600);
    return { ok: true, id: id };
  } finally {
    lock.releaseLock();
  }
}
function expand_(code) {
  if (!SHORT_RE.test(code) || code.length < 5) return { ok: false };
  const row = unb62_(code.slice(0, -4)), tag = code.slice(-4);
  if (row < 1) return { ok: false };
  const cache = CacheService.getScriptCache();
  const hit = cache.get('ex_' + code);
  if (hit) return { ok: true, url: hit };
  // кто-то перебирает коды — не читаем таблицу, пока не утихнет (свежие ссылки раскрываются из кэша)
  if (!peek_('exm', LIM.expandMiss)) return { ok: false, error: 'rate' };
  const sh = sheet_();
  const cells = row <= sh.getLastRow() ? sh.getRange(row, 1, 1, 3).getValues()[0] : [];
  const url = String(cells[0] || '');
  if (!url || String(cells[2]) !== tag) { allow_('exm', LIM.expandMiss, 1); return { ok: false }; }
  if (url.length < 90000) cache.put('ex_' + code, url, 21600);
  return { ok: true, url: url };
}

/* ======================= приглашения и ответы ======================= */

/* Ответ на приглашение: пересылаем, только если приглашение привязано к чату с действующим ключом
   и отпечаток c из ссылки совпал с отпечатком того, кто приглашение зарегистрировал. */
function notify_(body) {
  const id = String(body.id || '');
  if (!ID_RE.test(id)) return { ok: false };
  const props = props_();
  const inv = parseInv_(props.getProperty('i_' + id));
  if (!inv || !inv.chat) return { ok: false };
  if (inv.c !== String(body.c || '').slice(0, 16)) return { ok: false };
  if (!liveChat_(inv.chat)) return { ok: false };  // владелец отключил ответы (/stop)
  const text = cleanText_(body.text);
  if (!text) return { ok: false };
  if (!allowNotify_(inv.chat, id)) return { ok: false, error: 'rate' };
  const ok = send_(inv.chat, text);
  // на приглашение отвечают — продлеваем срок хранения (не чаще раза в день)
  if (ok && inv.day !== day_()) props.setProperty('i_' + id, inv.chat + '|' + day_() + '|' + inv.c);
  return { ok: ok };
}

function test_(body) {
  const chat = chatByKey_(body.key);
  if (!chat) return { ok: false, error: 'key' };
  if (!allowAll_([['t' + chat, LIM.test]]) || !allowNotify_(chat, '')) return { ok: false, error: 'rate' };
  return { ok: send_(chat, '✅ <b>Тест из конструктора</b>: ответы на твои приглашения будут приходить сюда.') };
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
  if (!ids.length) return { ok: true, taken: 0, fresh: 0 };
  const s = String(body.s || '');
  if (!SECRET_RE.test(s)) return { ok: false, error: 'secret' };
  const c = digest_('kuda-tg|' + s, 12);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return { ok: false, error: 'busy' };
  try {
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
        const theirs = splitList_(all['l_' + old.chat]).filter(function (x) { return x !== id; });
        put['l_' + old.chat] = theirs.join(',');
      }
      put['i_' + id] = chat + '|' + today + '|' + c;
      list = list.concat(id);
      fresh++;
    });
    if (fresh && !allowAll_([['r' + chat, LIM.register, fresh], ['rall', LIM.registerAll, fresh]])) return { ok: false, error: 'rate' };
    // не больше MAX_INVITES_PER_CHAT на чат: самые старые забываем
    while (list.length > MAX_INVITES_PER_CHAT) {
      const old = list.shift();
      if (ids.indexOf(old) >= 0 && put['i_' + old]) { delete put['i_' + old]; fresh--; continue; }
      if (owned(old)) del.push('i_' + old);
    }
    put['l_' + chat] = list.join(',');
    // место в хранилище: если его мало — удаляем самые старые приглашения всех пользователей
    const used = usage_(all) + Object.keys(put).reduce(function (n, k) { return n + k.length + put[k].length - (all[k] ? k.length + String(all[k]).length : 0); }, 0);
    if (used > STORE_SOFT) purgeOldest_(all, used - STORE_TARGET, put);
    del.forEach(function (k) { props.deleteProperty(k); });
    try {
      props.setProperties(put);
    } catch (err) {
      console.error('Хранилище свойств переполнено: ' + err);
      purgeOldest_(props.getProperties(), STORE_SOFT - STORE_TARGET, put);
      try { props.setProperties(put); } catch (err2) { console.error(err2); return { ok: false, error: 'storage' }; }
    }
    return { ok: true, taken: taken, fresh: Math.max(0, fresh) };
  } finally {
    lock.releaseLock();
  }
}

/* Удаляем самые старые приглашения (по дню последнего продления), пока не освободим need байт.
   keep — записи, которые сейчас пишутся: их не трогаем. Списки l_ чистятся сами при следующей регистрации и в cleanup. */
function purgeOldest_(all, need, keep) {
  const props = props_();
  const items = Object.keys(all).filter(function (k) { return k.indexOf('i_') === 0 && !(keep && keep[k]); })
    .map(function (k) { const inv = parseInv_(all[k], all); return [k, inv ? inv.day : 0, k.length + String(all[k]).length]; })
    .sort(function (a, b) { return a[1] - b[1]; });
  let freed = 0, n = 0;
  for (let i = 0; i < items.length && freed < need; i++) {
    props.deleteProperty(items[i][0]);
    delete all[items[i][0]];
    freed += items[i][2];
    n++;
  }
  console.warn('Мало места в хранилище: удалено старых приглашений — ' + n);
  return n;
}

/* ======================= текст ответа ======================= */

/* Сайт присылает текст с разметкой <b>…</b> и уже экранированными &lt; &gt; &amp;.
   Оставляем только парные <b>, всё остальное экранируем заново; ссылки не на сайт, @ники и /команды
   обезвреживаем, чтобы Telegram не сделал их нажимаемыми. */
function cleanText_(raw) {
  const t = String(raw || '').slice(0, 3800)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁩﻿]/g, '');
  let out = '', open = false;
  t.split(/(<\/?b>)/i).forEach(function (part) {
    if (/^<b>$/i.test(part)) { if (!open) { out += '<b>'; open = true; } return; }
    if (/^<\/b>$/i.test(part)) { if (open) { out += '</b>'; open = false; } return; }
    out += esc_(defang_(unesc_(part)));
  });
  if (open) out += '</b>';
  return out.replace(/<b>\s*<\/b>/g, '').trim();
}

const URL_RE = /(?:(?:https?|ftp|tg|tonsite|ton):\/\/[^\s]+|(?:[a-z0-9а-яё_-]+\.)+[a-zа-яё]{2,24}(?::\d{1,5})?(?:[\/?#][^\s]*)?|\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:[\/?#][^\s]*)?)/gi;
function defang_(s) {
  const site = siteBase_();
  return s
    .replace(URL_RE, function (m) { return site && m.indexOf(site) === 0 ? m : m.replace(/\./g, '․').replace(/:\/\//, '∶//'); })
    .replace(/@(?=[A-Za-z0-9_]{3,})/g, '＠')                    // @ник → ＠ник
    .replace(/(^|[\s(\[{"'«])\/(?=[A-Za-z0-9_])/g, '$1∕');     // /команда → ∕команда
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
    // сначала двигаем очередь: если обработка упадёт на середине, те же сообщения не придут повторно
    props.setProperty('tg_offset', String(r.result[r.result.length - 1].update_id + 1));
    r.result.forEach(function (u) {
      try {
        if (u.message) onMessage_(u.message);
      } catch (err) {
        console.error(err);  // одно сломанное сообщение не должно стопорить очередь
      }
    });
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
    if (isPrivate) reply_(chat, helpText_(), 'help');  // в группах на обычные сообщения не отвечаем
    return;
  }
  // ссылка «Нашли ошибку?» с сайта: /start fix_<id места или плана>
  if (isPrivate && c[1].toLowerCase() === 'start' && /^fix_[\w-]{1,56}$/.test(c[3] || '')) {
    CacheService.getScriptCache().put('fx_' + chat, c[3].slice(4), 3600);
    return reply_(chat, '🛠 Спасибо, что помогаешь! Опиши одним сообщением, что не так: место закрылось, другой адрес, неверные часы, ошибка в описании…');
  }
  const bot = props_().getProperty('bot_name') || '';
  if (c[2] && bot && c[2].toLowerCase() !== bot.toLowerCase()) return;  // команда другому боту
  const cmd = c[1].toLowerCase();
  if (cmd === 'start' || cmd === 'key') {
    const key = issueKey_(chat, false);
    return reply_(chat, key ? keyText_(key, cmd === 'start') : tooOften_());
  }
  if (cmd === 'newkey') {
    const key = issueKey_(chat, true);
    return reply_(chat, key ? newKeyText_(key) : tooOften_());
  }
  if (cmd === 'stop') {
    revokeKey_(chat);
    return reply_(chat, '🔕 Ключ удалён — ответы на приглашения сюда больше не придут.\n\nЧтобы снова их получать, отправь /key: бот выдаст новый ключ, его нужно вставить в конструкторе.');
  }
  if (isPrivate || c[2]) reply_(chat, helpText_(), 'help');
}

/* Ответ бота с лимитами: на чат (отдельно — на подсказки) и на всех. Лишнее молча пропускаем. */
function reply_(chat, text, kind) {
  const rules = [['bc' + chat, LIM.botChat], ['ball', LIM.botAll]];
  if (kind === 'help') rules.push(['bh' + chat, LIM.botHelp]);
  if (!allowAll_(rules)) return false;
  return send_(chat, text);
}

function tooOften_() {
  return '⏳ Слишком часто. Попробуй ещё раз минут через десять.';
}

/* Пересылаем описание ошибки в ADMIN_CHAT (свойство скрипта), если человек пришёл по ссылке «Нашли ошибку?» */
function forwardFix_(chat, m, text) {
  const cache = CacheService.getScriptCache();
  const what = cache.get('fx_' + chat);
  if (!what) return false;
  cache.remove('fx_' + chat);
  if (!allowAll_([['fxc' + chat, LIM.fixChat], ['fix', LIM.fixAll]])) { reply_(chat, tooOften_()); return true; }
  const admin = props_().getProperty('ADMIN_CHAT');
  const who = m.from ? esc_((m.from.username ? '@' + m.from.username : m.from.first_name) || '') : '';
  if (admin) send_(admin, '🛠 <b>Ошибка в каталоге</b>: <code>' + esc_(what) + '</code>' + (who ? ' от ' + who : '') + '\n' + esc_(text.slice(0, 1500)));
  reply_(chat, admin ? '✅ Передали команде — поправим. Спасибо!' : '✅ Спасибо! Записали.');
  return true;
}

/* Действующий ключ чата; renew — выпустить новый, а старый отключить. Приглашения привязаны к чату,
   поэтому после /newkey ответы на уже отправленные приглашения продолжают приходить.
   Возвращает '' при превышении лимита новых ключей. */
function issueKey_(chat, renew) {
  const props = props_();
  const old = props.getProperty('c_' + chat);
  if (old && !renew && props.getProperty('k_' + old) === chat) return old;
  if (!allowAll_([['nk' + chat, LIM.newKeyChat], ['nkall', LIM.newKeyAll]])) return '';
  if (old) props.deleteProperty('k_' + old);
  const key = newKey_();
  const put = {};
  put['k_' + key] = chat;
  put['c_' + chat] = key;
  props.setProperties(put);
  return key;
}

/* /stop: ключ удаляем, а приглашения остаются привязаны к чату — их никто не перехватит,
   а ответы не пересылаются, пока у чата нет действующего ключа. */
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

/* Раз в сутки по триггеру: забываем приглашения старше INVITE_TTL_DAYS (и старые записи без отпечатка
   с отключёнными ключами), пересобираем списки l_ и следим за местом в хранилище. */
function cleanup() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const props = props_();
    const all = props.getProperties();
    const oldest = day_() - INVITE_TTL_DAYS;
    const lists = {};
    let n = 0;
    Object.keys(all).forEach(function (name) {
      if (name.indexOf('i_') !== 0) return;
      const inv = parseInv_(all[name], all);
      const dead = !inv || !inv.chat || inv.day < oldest || (!inv.c && !liveChat_(inv.chat, all));
      if (dead) { if (n < 3000) { props.deleteProperty(name); delete all[name]; n++; } return; }  // остальное — в следующий раз
      (lists[inv.chat] = lists[inv.chat] || []).push([name.slice(2), inv.day]);
    });
    Object.keys(all).forEach(function (name) {
      if (name.indexOf('l_') === 0 && !lists[name.slice(2)]) props.deleteProperty(name);
    });
    const put = {};
    Object.keys(lists).forEach(function (chat) {
      const ids = lists[chat].sort(function (a, b) { return a[1] - b[1]; }).map(function (x) { return x[0]; });
      put['l_' + chat] = ids.slice(-MAX_INVITES_PER_CHAT).join(',');
    });
    if (Object.keys(put).length) props.setProperties(put);
    const now = props.getProperties();
    const used = usage_(now);
    if (used > STORE_SOFT) purgeOldest_(now, used - STORE_TARGET);
    Logger.log('Удалено приглашений: ' + n);
  } finally {
    lock.releaseLock();
  }
}

/* Для себя: сколько пользователей и приглашений, насколько заполнено хранилище. */
function stats() {
  const all = props_().getProperties();
  let users = 0, invites = 0;
  Object.keys(all).forEach(function (name) {
    if (name.indexOf('k_') === 0) users++;
    if (name.indexOf('i_') === 0) invites++;
  });
  Logger.log('Пользователей: ' + users + ', приглашений: ' + invites + ', хранилище: ' + Math.round(usage_(all) / 1024) + ' из 500 КБ (чистка начинается с ' + Math.round(STORE_SOFT / 1024) + ' КБ)');
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
  // если разметка не разобралась — отправляем простым текстом (ссылки уже обезврежены)
  r = tg_('sendMessage', Object.assign({ text: unesc_(text.replace(/<[^>]+>/g, '')) }, base));
  return !!r.ok;
}

/* У группы сменился chat_id (стала супергруппой) — переносим ключ и приглашения. */
function moveChat_(from, to) {
  const lock = LockService.getScriptLock();
  const had = lock.hasLock();
  if (!had && !lock.tryLock(5000)) return;
  try {
    const props = props_();
    const all = props.getProperties();
    const put = {};
    const key = all['c_' + from];
    if (key) { put['k_' + key] = to; put['c_' + to] = key; }
    const ids = splitList_(all['l_' + from]);
    ids.forEach(function (id) {
      const inv = parseInv_(all['i_' + id], all);
      if (inv && inv.chat === from) put['i_' + id] = to + '|' + inv.day + '|' + inv.c;
    });
    if (ids.length) put['l_' + to] = ids.join(',');
    if (Object.keys(put).length) props.setProperties(put);
    props.deleteProperty('c_' + from);
    props.deleteProperty('l_' + from);
  } finally {
    if (!had) lock.releaseLock();
  }
}

function chatByKey_(key) {
  key = String(key || '');
  return KEY_RE.test(key) ? props_().getProperty('k_' + key) : null;
}

/* У чата есть действующий ключ (не было /stop). all — снимок свойств, если он уже есть. */
function liveChat_(chat, all) {
  const get = function (k) { return all ? all[k] : props_().getProperty(k); };
  const key = get('c_' + chat);
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

/* Уведомление владельцу: лимит на приглашение и на владельца, затем общий поток;
   если общий поток кто-то выел — первые reserveOwner сообщений владельца идут из запаса. */
function allowNotify_(chat, id) {
  const own = id ? [['ni' + id, LIM.notifyInvite], ['o' + chat, LIM.notifyOwner]] : [['o' + chat, LIM.notifyOwner]];
  if (!peekAll_(own)) return false;
  if (allowAll_(own.concat([['nall', LIM.notifyAll]]))) return true;
  return allowAll_(own.concat([['nr' + chat, LIM.reserveOwner], ['nres', LIM.reserveAll]]));
}

/* Счётчики в кэше по 10-минутным окнам. allowAll_ пропускает, только если хватает во всех счётчиках сразу. */
function bucket_(name) { return name + '_' + Math.floor(Date.now() / 600000); }
function peekAll_(rules) {
  const keys = rules.map(function (r) { return bucket_(r[0]); });
  const got = CacheService.getScriptCache().getAll(keys);
  return rules.every(function (r, i) { return Number(got[keys[i]] || 0) + (r[2] || 1) <= r[1]; });
}
function allowAll_(rules) {
  const cache = CacheService.getScriptCache();
  const keys = rules.map(function (r) { return bucket_(r[0]); });
  const got = cache.getAll(keys);
  if (!rules.every(function (r, i) { return Number(got[keys[i]] || 0) + (r[2] || 1) <= r[1]; })) return false;
  const put = {};
  rules.forEach(function (r, i) { put[keys[i]] = String(Number(got[keys[i]] || 0) + (r[2] || 1)); });
  cache.putAll(put, 700);
  return true;
}
function allow_(name, max, n) { return allowAll_([[name, max, n || 1]]); }
function peek_(name, max) { return peekAll_([[name, max]]); }

function siteBase_() {
  return String(props_().getProperty('SITE_URL') || SITE_URL).replace(/[^/]*$/, '');
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

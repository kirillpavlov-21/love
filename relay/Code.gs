/* Посредник между сайтом и Telegram (Google Apps Script).
   Токен бота и chat_id живут только здесь, в твоём Google-аккаунте,
   а не на GitHub и не в коде сайта. Сайт присылает сюда текст,
   скрипт пересылает его тебе в Telegram. */

const TG_TOKEN = 'ВСТАВЬ_ТОКЕН_БОТА';
const TG_CHAT = 'ВСТАВЬ_CHAT_ID';
const MAX_PER_10_MIN = 40;   // защита от спама через посредника

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const text = String(body.text || '').slice(0, 3800);
    if (!text) return json_({ ok: false });
    if (!allow_()) return json_({ ok: false, error: 'rate' });
    return json_({ ok: send_(text) });
  } catch (err) {
    return json_({ ok: false });
  }
}

function doGet() {
  return json_({ ok: true });
}

function send_(text) {
  const url = 'https://api.telegram.org/bot' + TG_TOKEN + '/sendMessage';
  const base = { chat_id: TG_CHAT, disable_web_page_preview: 'true' };
  let r = UrlFetchApp.fetch(url, { method: 'post', muteHttpExceptions: true, payload: Object.assign({ text: text, parse_mode: 'HTML' }, base) });
  if (r.getResponseCode() === 200) return true;
  // если разметка не разобралась — отправляем простым текстом
  const plain = text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  r = UrlFetchApp.fetch(url, { method: 'post', muteHttpExceptions: true, payload: Object.assign({ text: plain }, base) });
  return r.getResponseCode() === 200;
}

function allow_() {
  const cache = CacheService.getScriptCache();
  const key = 'n' + Math.floor(Date.now() / 600000);
  const n = Number(cache.get(key) || 0);
  if (n >= MAX_PER_10_MIN) return false;
  cache.put(key, String(n + 1), 700);
  return true;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* Запусти один раз вручную (▶ Выполнить), чтобы разрешить скрипту ходить в Telegram.
   Придёт тестовое сообщение. */
function authorize() {
  Logger.log(send_('✅ <b>Посредник подключён</b>: ответы на приглашения будут приходить сюда 💌') ? 'Готово' : 'Ошибка: проверь токен и chat_id');
}

/* Посредник между сайтом и Telegram (Google Apps Script).
   Токен бота, chat_id и ключ владельца живут только здесь, в твоём Google-аккаунте.
   Сайт присылает текст и id приглашения; пересылаем, только если приглашение
   зарегистрировал владелец (конструктор с ключом владельца). */

const TG_TOKEN = 'ВСТАВЬ_ТОКЕН_БОТА';
const TG_CHAT = 'ВСТАВЬ_CHAT_ID';
const OWNER_KEY = 'ПРИДУМАЙ_ДЛИННЫЙ_КЛЮЧ';
const MAX_PER_10_MIN = 40;   // защита от спама через посредника
const ID_RE = /^[a-z0-9]{1,13}$/;

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'register') {
      if (!keyOk_(body.key)) return json_({ ok: false });
      const props = PropertiesService.getScriptProperties();
      (Array.isArray(body.ids) ? body.ids : []).slice(0, 100).forEach(function (id) {
        if (ID_RE.test(String(id))) props.setProperty('i_' + id, '1');
      });
      return json_({ ok: true });
    }
    if (body.action === 'test') {
      if (!keyOk_(body.key)) return json_({ ok: false });
      return json_({ ok: send_('✅ <b>Тест из конструктора</b>: ответы на твои приглашения будут приходить сюда 💌') });
    }
    const id = String(body.id || '');
    if (!ID_RE.test(id) || PropertiesService.getScriptProperties().getProperty('i_' + id) !== '1') return json_({ ok: false });
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

function keyOk_(k) {
  k = String(k || '');
  if (k.length !== OWNER_KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < k.length; i++) diff |= k.charCodeAt(i) ^ OWNER_KEY.charCodeAt(i);
  return diff === 0;
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

/* Запусти один раз вручную (▶ Выполнить), чтобы разрешить скрипту ходить в Telegram. */
function authorize() {
  PropertiesService.getScriptProperties().getProperty('x');
  Logger.log(send_('✅ <b>Посредник подключён</b>: ответы на приглашения будут приходить сюда 💌') ? 'Готово' : 'Ошибка: проверь токен и chat_id');
}

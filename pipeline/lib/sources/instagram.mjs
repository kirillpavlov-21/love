/* Источник: Instagram через официальный Graph API (Business Discovery).
   Только публичные бизнес/креатор-аккаунты, только подписи и ссылки на посты; картинки не берём.
   instagram.com не скрейпим никогда. Без токена модуль молча пропускается. */

const GRAPH = 'https://graph.facebook.com/v21.0';

/* '@name', 'instagram.com/name/' → 'name'; мусор → '' */
export function normUsername(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^https?:\/\//i, '').replace(/^(www\.)?instagram\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
  return /^[A-Za-z0-9._]{1,30}$/.test(s) ? s : '';
}

/* время: число (мс) или строка ISO, в том числе формат Graph API «…+0000» */
function toMs(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (!v) return 0;
  const t = Date.parse(String(v).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(t) ? 0 : t;
}

/* токен не должен утечь в логи и отчёт */
function redact(s, token) {
  let out = String(s || '');
  if (token) out = out.split(token).join('***');
  return out.replace(/access_token=[^&\s"]+/g, 'access_token=***');
}

/* Последние посты аккаунта новее sinceTs.
   sinceTs / lastTs — миллисекунды Unix (принимается и строка ISO).
   → { posts (по возрастанию даты), lastTs } или { posts: [], lastTs, skipped } */
export async function fetchAccount(username, { token, igUserId, sinceTs = 0, fetchImpl = globalThis.fetch, limit = 30 } = {}) {
  if (!token || !igUserId) return { posts: [], lastTs: sinceTs, skipped: 'no token' };
  const user = normUsername(username);
  if (!user) throw new Error(`instagram: некорректное имя аккаунта «${username}»`);
  if (!/^\d+$/.test(String(igUserId))) throw new Error('instagram: igUserId должен быть числом');
  if (typeof fetchImpl !== 'function') throw new Error('instagram: нет fetch');

  const n = Math.min(100, Math.max(1, Math.floor(Number(limit) || 30)));
  const fields = `business_discovery.username(${user}){media.limit(${n}){id,caption,permalink,timestamp}}`;
  const url = `${GRAPH}/${igUserId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;

  let res, data;
  try {
    res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    data = await res.json().catch(() => null);
  } catch (e) {
    throw new Error('instagram: ' + redact(e && e.message, token));
  }
  if (!res.ok || !data || data.error) {
    const msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
    throw new Error(`instagram: ${redact(msg, token)}`);
  }

  const media = (data.business_discovery && data.business_discovery.media && data.business_discovery.media.data) || [];
  const since = toMs(sinceTs);
  let last = since;
  const posts = [];
  for (const m of media) {
    if (!m || !m.id) continue;
    const ts = toMs(m.timestamp);
    if (ts > last) last = ts;
    if (ts <= since) continue;
    const text = String(m.caption || '').trim();
    if (!text) continue;      // пост без подписи — нечего разбирать
    const permalink = /^https:\/\/(www\.)?instagram\.com\//.test(String(m.permalink || '')) ? m.permalink : '';
    posts.push({
      source: 'ig',
      channel: user,
      id: String(m.id),
      key: `ig:${user}/${m.id}`,
      url: permalink,
      date: ts ? new Date(ts).toISOString() : '',
      text,
    });
  }
  posts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { posts, lastTs: last };
}

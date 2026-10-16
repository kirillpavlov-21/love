/* Источник: ручной «ящик» — issues в GitHub-репозитории с меткой (по умолчанию «источник»).
   Владелец кладёт туда ссылку или текст поста из Instagram, наводку на место и т. п.
   По умолчанию берём только issues от владельца и участников репозитория: чужие могут прислать что угодно.
   Город: вторая метка «спб» / «Петербург» (или «мск» / «Москва») задаёт город заявки; без неё город определит модель по тексту. */

const API = 'https://api.github.com';
const UA = 'KudaIdemBot/1.0 (+https://kirillpavlov-21.github.io/love/)';
const TRUSTED = ['OWNER', 'MEMBER', 'COLLABORATOR'];
const MAX_PAGES = 5;
const MAX_TEXT = 8000;
const CITY_LABEL = [[/^(спб|питер|петербург|санкт-петербург|spb)$/i, 'spb'], [/^(мск|москва|msk)$/i, 'msk']];

/* Город по меткам issue: 'spb' | 'msk' | '' */
export function labelCity(labels) {
  for (const l of Array.isArray(labels) ? labels : []) {
    const name = String((l && typeof l === 'object' ? l.name : l) || '').trim();
    const hit = CITY_LABEL.find(([rx]) => rx.test(name));
    if (hit) return hit[1];
  }
  return '';
}

function checkRepo(repo) {
  const r = String(repo || '').trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(r)) throw new Error(`inbox: некорректный repo «${repo}», нужен вид owner/name`);
  return r;
}

function headers(token, json) {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': UA };
  if (token) h.Authorization = `Bearer ${token}`;
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function ghError(res, what) {
  let msg = '';
  try { const d = await res.json(); msg = d && d.message ? `: ${d.message}` : ''; } catch { /* тело не JSON */ }
  return new Error(`inbox: ${what} — HTTP ${res.status}${msg}`);
}

/* следующая страница из заголовка Link */
function nextLink(res) {
  const link = res.headers && res.headers.get && res.headers.get('link');
  const m = link && link.match(/<([^>]+)>;\s*rel="next"/);
  return m && m[1].startsWith(API + '/') ? m[1] : null;
}

/* тело issue: убираем HTML-комментарии шаблона и лишние пустые строки */
function cleanBody(s) {
  return String(s || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* Открытые issues с меткой → посты для разбора.
   trusted — допустимые author_association; null/[] — брать от всех.
   → { posts (по возрастанию номера), ignored: [номера от посторонних] } */
export async function fetchInbox({ repo, token, label = 'источник', fetchImpl = globalThis.fetch, trusted = TRUSTED } = {}) {
  if (!repo) return { posts: [], ignored: [], skipped: 'no repo' };
  const r = checkRepo(repo);
  if (typeof fetchImpl !== 'function') throw new Error('inbox: нет fetch');
  const allow = Array.isArray(trusted) && trusted.length ? new Set(trusted) : null;

  const posts = [];
  const ignored = [];
  let url = `${API}/repos/${r}/issues?state=open&labels=${encodeURIComponent(label)}&sort=created&direction=asc&per_page=100`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res = await fetchImpl(url, { headers: headers(token) });
    if (!res.ok) throw await ghError(res, 'не удалось прочитать issues');
    const list = await res.json();
    for (const it of Array.isArray(list) ? list : []) {
      if (!it || it.pull_request || (it.state && it.state !== 'open') || !Number.isInteger(it.number)) continue;   // PR тоже приходят в /issues
      if (allow && !allow.has(it.author_association)) { ignored.push(it.number); continue; }
      const text = (String(it.title || '').trim() + '\n' + cleanBody(it.body)).trim().slice(0, MAX_TEXT);
      const post = {
        source: 'inbox',
        channel: 'inbox',
        id: it.number,
        key: `inbox:${it.number}`,
        url: it.html_url || `https://github.com/${r}/issues/${it.number}`,
        date: it.created_at ? new Date(it.created_at).toISOString() : '',
        text,
      };
      const city = labelCity(it.labels);
      if (city) post.city = city;
      posts.push(post);
    }
    url = nextLink(res);
  }
  posts.sort((a, b) => a.id - b.id);
  return { posts, ignored };
}

/* Отвечает в issue (если есть comment) и закрывает его как выполненное. */
export async function closeInboxItem({ repo, token, number, comment, fetchImpl = globalThis.fetch } = {}) {
  const r = checkRepo(repo);
  if (!token) throw new Error('inbox: для закрытия issue нужен токен');
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`inbox: некорректный номер issue «${number}»`);
  if (typeof fetchImpl !== 'function') throw new Error('inbox: нет fetch');
  const base = `${API}/repos/${r}/issues/${n}`;

  if (comment && String(comment).trim()) {
    const res = await fetchImpl(`${base}/comments`, {
      method: 'POST', headers: headers(token, true), body: JSON.stringify({ body: String(comment) }),
    });
    if (!res.ok) throw await ghError(res, `не удалось прокомментировать #${n}`);
  }
  const res = await fetchImpl(base, {
    method: 'PATCH', headers: headers(token, true), body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
  });
  if (!res.ok) throw await ghError(res, `не удалось закрыть #${n}`);
  return { ok: true, number: n };
}

/* Источник: публичное веб-превью Telegram-канала (t.me/s/<канал>).
   Только чтение открытых страниц: одна страница за раз, пауза между запросами, честный User-Agent.
   Имена каналов приходят из конфига запуска (служебная ветка pipeline-data или секрет) и в файлы сайта не попадают;
   в публичном репозитории ветка pipeline-data видна на GitHub. */
import { parse } from 'node-html-parser';

export const USER_AGENT = 'KudaIdemBot/1.0 (+https://kirillpavlov-21.github.io/love/)';
const ORIGIN = 'https://t.me';
const MAX_PAGES = 40;          // предохранитель от бесконечной листалки
const RETRIES = 2;             // повторы при 429 / 5xx
const BLOCK = new Set(['div', 'p', 'blockquote', 'pre', 'li', 'ul', 'ol', 'table', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const SKIP = new Set(['script', 'style', 'noscript', 'svg', 'img', 'video', 'audio']);

const sleep = ms => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve());

/* '@name', 't.me/name', 'https://t.me/s/name/123' → 'name'; мусор → '' */
export function normChannel(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^https?:\/\//i, '').replace(/^(www\.)?(t|telegram)\.me\//i, '').replace(/^s\//, '');
  s = s.replace(/^@/, '').split(/[/?#]/)[0];
  return /^[A-Za-z0-9_]{3,64}$/.test(s) ? s : '';
}

/* ссылка → «текст (url)»; хэштеги, пустые и совпадающие с текстом ссылки — без дублей */
function linkText(text, href) {
  const t = text.trim();
  if (!href || /^javascript:/i.test(href)) return text;
  if (href.startsWith('?q=') || href.startsWith('?tag=')) return text;      // поиск по хэштегу внутри канала
  let url;
  try { url = new URL(href, ORIGIN + '/').href; } catch { return text; }
  if (!t) return url;
  const bare = s => s.replace(/^(https?:\/\/|mailto:|tel:)/i, '').replace(/^www\./i, '').replace(/\/$/, '').toLowerCase();
  if (bare(t) === bare(url) || bare(t) === bare(href)) return text;
  return `${text} (${url})`;
}

/* текст узла: <br> → перевод строки, блоки с новой строки, эмодзи как символы */
function nodeText(node) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { out += n.text; continue; }
    if (n.nodeType !== 1) continue;
    const tag = String(n.rawTagName || '').toLowerCase();
    if (tag === 'br') { out += '\n'; continue; }
    if (SKIP.has(tag)) continue;
    const inner = nodeText(n);
    if (tag === 'a') out += linkText(inner, n.getAttribute('href'));
    else if (BLOCK.has(tag)) out += '\n' + inner + '\n';
    else out += inner;
  }
  return out;
}

function cleanText(s) {
  return s
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isInside(el, cls, stop) {
  for (let p = el.parentNode; p && p !== stop; p = p.parentNode) {
    if (p.classList && p.classList.contains(cls)) return true;
  }
  return false;
}

function toIso(dt) {
  const d = new Date(dt || '');
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/* Разбор одной страницы t.me/s/… (для тестов и fetchChannel).
   → { posts (по возрастанию id, только с текстом), ids (все id страницы, включая служебные),
       minId, maxId, before (data-before ссылки «ещё» или null), hasHistory } */
export function parseChannelPage(html, channel) {
  const ch = normChannel(channel) || String(channel || '');
  const root = parse(String(html || ''), { blockTextElements: { script: true, noscript: true, style: true } });
  const hasHistory = !!root.querySelector('.tgme_channel_history');
  const byId = new Map();
  const ids = [];

  for (const msg of root.querySelectorAll('.tgme_widget_message[data-post]')) {
    const id = parseInt(String(msg.getAttribute('data-post')).split('/').pop(), 10);
    if (!Number.isFinite(id) || id <= 0) continue;
    ids.push(id);
    // служебные сообщения («канал создан», «фото обновлено», закреп и т. п.)
    if (msg.classList.contains('service_message') || msg.querySelector('.tgme_widget_message_service_text')) continue;

    // первый (внешний) блок текста, не из цитаты-ответа: внутри бывает вложенный дубль того же класса
    const textEl = msg.querySelectorAll('.tgme_widget_message_text')
      .find(el => !isInside(el, 'tgme_widget_message_reply', msg));
    const text = textEl ? cleanText(nodeText(textEl)) : '';
    if (!text) continue;   // только фото/видео без подписи — нечего разбирать

    const timeEl = msg.querySelector('.tgme_widget_message_date time[datetime]') || msg.querySelector('time[datetime]');
    byId.set(id, {
      source: 'tg',
      channel: ch,
      id,
      key: `tg:${ch}/${id}`,
      url: `${ORIGIN}/${ch}/${id}`,
      date: toIso(timeEl && timeEl.getAttribute('datetime')),
      text,
    });
  }

  const more = root.querySelector('.tme_messages_more[data-before]');
  const before = more ? parseInt(more.getAttribute('data-before'), 10) : NaN;
  return {
    posts: [...byId.values()].sort((a, b) => a.id - b.id),
    ids,
    minId: ids.length ? Math.min(...ids) : null,
    maxId: ids.length ? Math.max(...ids) : null,
    before: Number.isFinite(before) ? before : null,
    hasHistory,
  };
}

async function getPage(url, fetchImpl, delayMs) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html', 'Accept-Language': 'ru,en;q=0.7' },
      redirect: 'follow',
    });
    if (res.ok) {
      // без публичного превью t.me/s/… уводит на обычную страницу канала
      if (res.url) {
        let path = '';
        try { path = new URL(res.url).pathname; } catch { /* мок без url */ }
        if (path && !path.startsWith('/s/')) throw new Error(`telegram: у канала нет публичного превью (${url})`);
      }
      return await res.text();
    }
    const retriable = res.status === 429 || res.status >= 500;
    if (!retriable || attempt >= RETRIES) throw new Error(`telegram: HTTP ${res.status} для ${url}`);
    const ra = parseInt((res.headers && res.headers.get && res.headers.get('retry-after')) || '', 10);
    await sleep(Math.min(Number.isFinite(ra) ? ra * 1000 : delayMs * 4, 30000));
  }
}

/* Новые посты канала: от свежих к старым через ?before=<minId>, пока не дойдём до sinceId.
   Первый запуск (sinceId = 0) — самые свежие maxPosts. Дальше, если с прошлого раза постов больше maxPosts,
   берём самые старые непрочитанные, а курсор ставим на последний взятый: остальные придут следующим запуском.
   Листаем не глубже backlog × maxPosts постов; что старше — пропущено, это видно в capped.lost.
   → { posts (по возрастанию id), lastId (курсор для следующего запуска),
       capped?: { left (ждут следующего запуска), lost: [от id, до id] | null } } */
export async function fetchChannel(channel, { sinceId = 0, maxPosts = 60, fetchImpl = globalThis.fetch, delayMs = 1500, backlog = 3 } = {}) {
  const ch = normChannel(channel);
  if (!ch) throw new Error(`telegram: некорректное имя канала «${channel}»`);
  if (typeof fetchImpl !== 'function') throw new Error('telegram: нет fetch');
  const since = Number(sinceId) || 0;
  const cap = Math.max(0, Number(maxPosts) || 0);
  const limit = since ? cap * Math.max(1, Number(backlog) || 1) : cap;
  const found = new Map();
  let maxSeen = since;
  let before = null;
  let reached = false;                                       // дошли до курсора или до начала канала

  for (let page = 0; page < MAX_PAGES && found.size < limit; page++) {
    if (page > 0) await sleep(delayMs);
    const url = `${ORIGIN}/s/${ch}` + (before ? `?before=${before}` : '');
    const p = parseChannelPage(await getPage(url, fetchImpl, delayMs), ch);
    if (page === 0 && !p.hasHistory) throw new Error(`telegram: на странице нет ленты сообщений (${url})`);
    if (!p.ids.length) { reached = true; break; }
    maxSeen = Math.max(maxSeen, p.maxId);

    // от свежих к старым
    for (const post of p.posts.slice().reverse()) {
      if (post.id <= since || found.has(post.id)) continue;
      if (found.size >= limit) break;
      found.set(post.id, post);
    }
    if (p.minId <= since || p.before === null) { reached = true; break; }   // дошли до прочитанного или до начала канала
    if (before !== null && p.minId >= before) { reached = true; break; }    // страница не сдвинулась — не крутимся
    before = p.minId;
  }

  const all = [...found.values()].sort((a, b) => a.id - b.id);
  if (!since || (reached && all.length <= cap)) return { posts: all.slice(-cap || all.length), lastId: maxSeen };
  // хвост не влез: берём самые старые, курсор — на последний взятый
  const posts = all.slice(0, cap);
  const lastId = posts.length ? posts[posts.length - 1].id : maxSeen;
  const lowest = all.length ? all[0].id : (before ?? maxSeen + 1);
  const lost = !reached && lowest > since + 1 ? [since + 1, lowest - 1] : null;
  return { posts, lastId, capped: { left: all.length - posts.length, lost } };
}

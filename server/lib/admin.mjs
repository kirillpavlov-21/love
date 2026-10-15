/* Страница модерации /admin: без скриптов и внешних файлов, всё экранируется.
   Вход — форма с паролем; токен сессии ходит скрытым полем во всех формах (cookies не нужны). */

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = ms => (ms ? new Date(ms).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const WHY = {
  links: 'были ссылки, @ники или телефоны (вырезаны)', short: 'очень короткий текст', caps: 'капсом', rude: 'много мата (замаскирован)',
  flood: 'волна отзывов с новых устройств', wave: 'много отзывов на это место за 10 минут',
  ipplace: 'уже не первый отзыв на это место с этого IP за сутки', reports: 'жалобы', admin: 'скрыт вручную',
};
const TAG = {
  talk: 'Можно поговорить', cozy: 'Уютно', loud: 'Шумно', first: 'Для первого свидания', group: 'Для компании', cheap: 'Недорого',
  pricey: 'Дорого', view: 'Красивый вид', service: 'Хороший сервис', queue: 'Очереди',
};
const STATUS = { ok: 'опубликован', pending: 'на проверке', hidden: 'скрыт' };
const DONE = {
  approve: 'Отзыв опубликован.', hide: 'Отзыв скрыт.', reply: 'Ответ сохранён.', fixdone: 'Сообщение закрыто.',
  recompute: 'Рейтинги пересчитаны.', cleanup: 'Старые данные удалены.', delete: 'Отзыв удалён навсегда.',
};

const CSS = `
:root{color-scheme:light dark;--bg:#0f1020;--card:#1a1b30;--line:#2c2e4a;--text:#ecebf7;--muted:#a3a3c2;--acc:#ff5d8f;--ok:#3ecf8e;--warn:#ffb648}
@media (prefers-color-scheme: light){:root{--bg:#f6f5fb;--card:#fff;--line:#e2e0ef;--text:#1d1b2e;--muted:#66637f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:920px;margin:0 auto;padding:16px}h1{font-size:22px;margin:8px 0 16px}h2{font-size:17px;margin:28px 0 10px}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px}.stat b{display:block;font-size:20px}.stat span{color:var(--muted);font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:0 0 10px}
.meta{color:var(--muted);font-size:13px;display:flex;flex-wrap:wrap;gap:4px 12px}.text{white-space:pre-wrap;margin:8px 0;overflow-wrap:anywhere}
.why{color:var(--warn);font-size:13px}.tags{font-size:13px;color:var(--muted)}.reply{border-left:3px solid var(--acc);padding-left:8px;margin:6px 0;white-space:pre-wrap}
form{display:inline}.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}
button{font:inherit;border:1px solid var(--line);background:transparent;color:var(--text);border-radius:999px;padding:6px 14px;cursor:pointer}
button.ok{border-color:var(--ok);color:var(--ok)}button.no{border-color:var(--acc);color:var(--acc)}
textarea{font:inherit;width:100%;min-height:56px;background:transparent;color:var(--text);border:1px solid var(--line);border-radius:10px;padding:8px}
.note{background:var(--card);border:1px solid var(--ok);border-radius:12px;padding:10px 14px}.empty{color:var(--muted)}
.err{background:var(--card);border:1px solid var(--acc);border-radius:12px;padding:10px 14px}
.top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
label{display:block;margin:0 0 6px;color:var(--muted);font-size:14px}
.find{display:block;margin:0 0 12px}.find input{font:inherit;flex:1;min-width:0;background:transparent;color:var(--text);border:1px solid var(--line);border-radius:10px;padding:6px 10px}
input[type=password]{font:inherit;width:100%;max-width:360px;background:transparent;color:var(--text);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:0 0 12px}
.login{display:block;max-width:420px}button.main{border-color:var(--acc);background:var(--acc);color:#fff;padding:10px 20px}
details summary{cursor:pointer;color:var(--muted);font-size:14px}
`;

const shell = (title, body) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;

export const loginPage = ({ self, msg }) => shell('Модерация — вход', `<h1>Модерация «Куда идём?»</h1>
${msg ? `<p class="err">${esc(msg)}</p>` : ''}
<form class="login" method="post" action="${esc(self)}"><input type="hidden" name="op" value="login">
<input type="text" name="username" value="admin" autocomplete="username" hidden>
<label for="pw">Пароль (ADMIN_TOKEN)</label><input id="pw" type="password" name="password" autocomplete="current-password" required autofocus>
<div><button class="main">Войти</button></div></form>
<p class="empty">Сессия действует 12 часов. Обновлять страницу — кнопкой «Обновить»: адрес не хранит вход.</p>`);

function button(ctx, op, id, label, cls = '') {
  return `<form method="post" action="${esc(ctx.self)}"><input type="hidden" name="s" value="${esc(ctx.session)}"><input type="hidden" name="op" value="${esc(op)}">${id ? `<input type="hidden" name="id" value="${esc(id)}">` : ''}<button class="${cls}">${esc(label)}</button></form>`;
}

function reviewCard(ctx, r, actions) {
  const tags = (r.tags || []).map(t => TAG[t] || t).join(' · ');
  const reasons = (r.reasons || []).length ? `<div class="why">Жалобы: ${r.reasons.map(esc).join(' · ')}</div>` : '';
  return `<div class="card">
  <div class="meta"><b>${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</b><span>место: ${esc(r.place)}</span><span>${esc(r.name || 'без имени')}</span>
  <span>${esc(fmt(r.at))}</span><span>${esc(STATUS[r.status] || r.status)}</span>${r.fit ? `<span>${r.fit === 'date' ? 'свидание' : 'компания'}</span>` : ''}${r.ver ? '<span>Яндекс ID</span>' : ''}${r.reports ? `<span>жалоб: ${r.reports}</span>` : ''}</div>
  ${r.why ? `<div class="why">Почему на проверке: ${esc(WHY[r.why] || r.why)}</div>` : ''}${reasons}
  ${r.text ? `<div class="text">${esc(r.text)}</div>` : '<div class="empty">Без текста — только оценка.</div>'}
  ${tags ? `<div class="tags">${esc(tags)}</div>` : ''}
  ${r.reply ? `<div class="reply">${esc(r.reply)}</div>` : ''}
  <div class="row">${actions}</div>
</div>`;
}

export function adminPage({ stats, pending, latest, fixes, session, self, done, place = '' }) {
  const ctx = { session, self };
  const s = stats || {};
  const stat = (n, label) => `<div class="stat"><b>${esc(n)}</b><span>${esc(label)}</span></div>`;
  const replyForm = r => `<details><summary>${r.reply ? 'Изменить ответ' : 'Ответить от имени сайта'}</summary>
<form method="post" action="${esc(self)}"><input type="hidden" name="s" value="${esc(session)}"><input type="hidden" name="op" value="reply"><input type="hidden" name="id" value="${esc(r.id)}">
<textarea name="text" maxlength="600" placeholder="Пустой ответ — убрать">${esc(r.reply || '')}</textarea><button>Сохранить</button></form></details>`;
  const body = `<div class="top"><h1>Модерация «Куда идём?»</h1><div class="row">${button(ctx, 'view', '', 'Обновить')}${button(ctx, 'logout', '', 'Выйти')}</div></div>
${DONE[done] ? `<p class="note">${esc(DONE[done])}</p>` : ''}
<div class="stats">
${stat(s.reviews || 0, 'опубликовано отзывов')}${stat(s.pending || 0, 'ждут проверки')}${stat(s.hidden || 0, 'скрыто')}${stat(s.places || 0, 'мест с оценками')}
${stat(s.invites || 0, 'приглашений')}${stat(s.voters || 0, 'голосов')}${stat(s.answers || 0, 'ответов')}${stat(s.shorts || 0, 'коротких ссылок')}${stat(s.fixes || 0, 'сообщений об ошибках')}
</div>${s.approx ? '<p class="empty">Цифры приблизительные: данных много, посчитаны не все.</p>' : ''}

<h2>Ждут проверки (${pending.length})</h2>
${pending.length ? pending.map(r => reviewCard(ctx, r, button(ctx, 'approve', r.id, 'Опубликовать', 'ok') + button(ctx, 'hide', r.id, 'Скрыть', 'no'))).join('') : '<p class="empty">Очередь пуста.</p>'}

<h2>Сообщения об ошибках в каталоге (${fixes.length})</h2>
${fixes.length ? fixes.map(f => `<div class="card"><div class="meta"><span>место: ${esc(f.place)}</span><span>${esc(fmt(f.at))}</span></div>
<div class="text">${esc(f.text)}</div><div class="row">${button(ctx, 'fixdone', f.id, 'Готово, убрать')}</div></div>`).join('') : '<p class="empty">Новых сообщений нет.</p>'}

<h2>${place ? `Все отзывы места «${esc(place)}» (${latest.length})` : 'Последние отзывы'}</h2>
<form class="find" method="post" action="${esc(self)}"><input type="hidden" name="s" value="${esc(session)}"><input type="hidden" name="op" value="place">
<label for="pl">Все отзывы одного места, с проверкой и скрытые — id места из ссылки на сайте</label>
<div class="row"><input id="pl" name="place" value="${esc(place)}" placeholder="например, krasota" autocapitalize="off" spellcheck="false" required maxlength="64"><button>Показать</button></div></form>
${latest.length ? latest.map(r => reviewCard(ctx, r, (r.status === 'ok' ? button(ctx, 'hide', r.id, 'Скрыть', 'no') : button(ctx, 'approve', r.id, 'Опубликовать', 'ok'))
    + (r.status === 'hidden' ? button(ctx, 'delete', r.id, 'Удалить навсегда', 'no') : '') + replyForm(r))).join('') : '<p class="empty">Отзывов пока нет.</p>'}

<h2>Обслуживание</h2>
<div class="row">${button(ctx, 'recompute', '', 'Пересчитать рейтинги')}${button(ctx, 'cleanup', '', 'Удалить просроченное сейчас')}</div>
<p class="empty">Голоса, ответы и приглашения хранятся 90 дней после последнего изменения, короткие ссылки — 180 дней, сообщения об ошибках — до 365 дней. Отзывы хранятся, пока их не удалят: скрытый не виден на сайте; по просьбе автора скрой отзыв и нажми «Удалить навсегда».</p>`;
  return shell('Модерация — Куда идём?', body);
}

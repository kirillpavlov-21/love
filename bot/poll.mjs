#!/usr/bin/env node
/* Бот «Куда идём?» на ноутбуке или своём сервере: long polling — без вебхука, домена и открытых портов.
     TG_TOKEN=123456:AA… node bot/poll.mjs
   Переменные окружения:
     TG_TOKEN   — токен от @BotFather (обязательно; в репозиторий не кладём);
     SITE_URL   — адрес сайта (по умолчанию GitHub Pages): ссылки в ответах и каталог, который бот берёт с сайта;
     BOT_DATA   — local: каталог из этой папки репозитория, а не с сайта (для проверки правок до публикации);
     BOT_STORE  — файл хранилища (по умолчанию ~/.kuda/bot-store.json — вне репозитория);
     TG_API     — адрес своего сервера Bot API, если он есть (по умолчанию https://api.telegram.org).
   При запуске бот снимает вебхук (иначе getUpdates не работает) и ставит список команд. Ctrl+C — остановить. */
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { telegram } from './tg.mjs';
import { fileStore } from './store.mjs';
import { loadCatalog, SITE } from './catalog.mjs';
import { createBot, COMMANDS } from './core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = process.env.SITE_URL || SITE;
const src = process.env.BOT_DATA === 'local' ? { dir: ROOT, site } : { base: site };
const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);
const api = telegram(process.env.TG_TOKEN, { base: process.env.TG_API || undefined });   // TG_API — свой сервер Bot API (по умолчанию api.telegram.org)
const store = fileStore(process.env.BOT_STORE || path.join(os.homedir(), '.kuda', 'bot-store.json'));

const me = await api('getMe');
await api('deleteWebhook', { drop_pending_updates: false });
await api('setMyCommands', { commands: COMMANDS }).catch(e => log('команды не поставились:', e.message));
const C = await loadCatalog(src);
log(`каталог: ${C.D.scenarios.length} планов${C.missing.length ? ' (не загрузились: ' + C.missing.join(', ') + ')' : ''}`);
const bot = createBot({ api, store, catalog: () => loadCatalog(src), site, name: me.username, log });
log(`бот @${me.username} работает. Напиши ему в Telegram: https://t.me/${me.username}`);

let offset = 0;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { store.flush(); log('остановлен'); process.exit(0); });
for (;;) {
  let ups = [];
  try {
    ups = await api('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query', 'inline_query'], _timeout: 65000 });
  } catch (e) {
    log('нет связи с Telegram:', e.message, '— повторю через 5 секунд');
    await new Promise(r => setTimeout(r, 5000));
    continue;
  }
  // не ждём ответа на каждое: люди в разных чатах не ждут друг друга (голоса одного голосования идут по очереди — core.mjs)
  for (const u of ups) { offset = u.update_id + 1; bot.handle(u); }
}

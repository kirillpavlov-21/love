#!/usr/bin/env node
/* Бот «Куда идём?» на вебхуке: HTTP-сервер для хостинга или своего сервера с доменом и https.
   Хостинг — за рубежом: с российских серверов api.telegram.org с 2026 года часто недоступен.
     TG_TOKEN=… PUBLIC_URL=https://bot.example.com TG_SECRET=<длинная случайная строка> node bot/webhook.mjs
   Сервер слушает PORT (по умолчанию 8080), путь /tg; при запуске ставит вебхук PUBLIC_URL/tg с секретом —
   Telegram присылает его в заголовке X-Telegram-Bot-Api-Secret-Token, чужие запросы получают 401.
   SITE_URL, BOT_DATA, BOT_STORE — как в bot/poll.mjs. GET / — «живой ли» (для проверок хостинга). */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { telegram, botToken } from './tg.mjs';
import { fileStore } from './store.mjs';
import { loadCatalog, SITE } from './catalog.mjs';
import { createBot, setupBot, COMMANDS } from './core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = process.env.SITE_URL || SITE;
// каталог — из этой папки (её обновляет ежедневная задача и git pull); BOT_DATA=site — прямо с сайта
const src = process.env.BOT_DATA === 'site' ? { base: site } : { dir: ROOT, site };
const secret = process.env.TG_SECRET || '';
const pub = String(process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);
if (!pub || !/^https:\/\//.test(pub)) { console.error('PUBLIC_URL — https-адрес этого сервера, например https://bot.example.com'); process.exit(1); }
if (secret.length < 16 || !/^[A-Za-z0-9_-]+$/.test(secret)) { console.error('TG_SECRET — от 16 знаков: латиница, цифры, _ и -'); process.exit(1); }

const api = telegram(botToken(), { base: process.env.TG_API || undefined });   // TG_API — свой сервер Bot API (по умолчанию api.telegram.org)
const store = fileStore(process.env.BOT_STORE || path.join(os.homedir(), '.kuda', 'bot-store.json'));
const me = await api('getMe');
// журнал тестеров (/start tester_<код>): одна строка JSON на действие, только у автора бота (сводка — node bot/testers.mjs)
const TESTERS = process.env.BOT_TESTERS || path.join(os.homedir(), '.kuda', 'logs', 'testers.jsonl');
const audit = rec => fs.promises.mkdir(path.dirname(TESTERS), { recursive: true, mode: 0o700 }).then(() => fs.promises.appendFile(TESTERS, JSON.stringify(rec) + '\n', { mode: 0o600 })).catch(e => log('журнал тестеров:', e.message));
const bot = createBot({ api, store, catalog: () => loadCatalog(src), site, name: me.username, audit, log });
// «напиши, когда появится»: проверяем подписки раз в 6 часов (каталог и афиша обновляются раз в сутки)
const wishes = () => bot.checkWishes().then(n => { if (n) log(`подписки: отправил ${n}`); }).catch(e => log(`подписки: ${e.message}`));
setTimeout(wishes, 2 * 60e3).unref?.();
setInterval(wishes, 6 * 3600e3).unref?.();
await loadCatalog(src);

const ok = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end('ok'); return; }
  if (req.method !== 'POST' || req.url !== '/tg') { res.writeHead(404); res.end(); return; }
  if (!ok(String(req.headers['x-telegram-bot-api-secret-token'] || ''), secret)) { res.writeHead(401); res.end(); return; }
  let body = '', size = 0;
  req.on('data', ch => { size += ch.length; if (size > 1e6) req.destroy(); else body += ch; });
  req.on('end', () => {
    // отвечаем сразу: Telegram ждёт ответ недолго и при ошибке шлёт то же обновление снова
    res.writeHead(200); res.end();
    let u = null;
    try { u = JSON.parse(body); } catch (e) { return; }
    if (u && typeof u === 'object') bot.handle(u);
  });
});
server.listen(+process.env.PORT || 8080, async () => {
  await api('setWebhook', { url: pub + '/tg', secret_token: secret, allowed_updates: ['message', 'callback_query', 'inline_query'] });
  await api('setMyCommands', { commands: COMMANDS }).catch(e => log('команды не поставились:', e.message));
  await setupBot(api, site, log);   // кнопка меню → Mini App, описание бота, если своего нет
  log(`бот @${me.username} на вебхуке ${pub}/tg`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { store.flush(); process.exit(0); });

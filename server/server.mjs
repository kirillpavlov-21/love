/* HTTP-сервер для своего сервера (VPS), Docker и локальной разработки.
   Запуск: node server.mjs   (переменные окружения — server/README.md)
   Тело запроса не больше 8 КБ, чистка просроченных данных — раз в час. */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createHandler, MAX_BODY } from './handler.mjs';
import { createStore } from './store/index.mjs';

/* Адрес клиента для лимитов.
   TRUST_PROXY=1 — за своим обратным прокси (Caddy, nginx): правый адрес X-Forwarded-For — его дописал наш прокси,
   левые клиент мог подделать. X-Real-IP при этом не читаем: Caddy пропускает его от клиента как есть.
   TRUST_PROXY=x-real-ip — только X-Real-IP (nginx с proxy_set_header X-Real-IP $remote_addr). */
function clientIp(req, mode) {
  const h = mode === 'x-real-ip' ? req.headers['x-real-ip'] : mode ? req.headers['x-forwarded-for'] : '';
  if (typeof h === 'string' && h.trim()) return h.split(',').pop().trim();
  return req.socket.remoteAddress || '';
}

/**
 * @param {object} [o]
 * @param {object} [o.env]
 * @param {number} [o.port]
 * @param {string} [o.host]
 * @param {object} [o.store] — готовое хранилище (тесты)
 * @param {Console} [o.log]
 */
export async function start(o = {}) {
  const env = o.env || process.env;
  const log = o.log || console;
  const store = o.store || (await createStore(env));
  const handle = createHandler({ store, env, log });
  const tp = String(env.TRUST_PROXY || '').toLowerCase();
  const trustProxy = tp === '1' || tp === 'true' ? 'xff' : tp === 'x-real-ip' ? 'x-real-ip' : '';
  const quiet = env.LOG_REQUESTS === '0';

  const server = http.createServer((req, res) => {
    const t0 = Date.now();
    const path = (req.url || '/').split('?')[0];
    const finish = r => {
      res.writeHead(r.status, r.headers);
      res.end(r.body);
      // в лог — без адресов, параметров и тела: там ключи приглашений и тексты
      if (!quiet) log.log(`${new Date().toISOString()} ${req.method} ${path} ${r.status} ${Date.now() - t0}ms`);
    };
    const len = Number(req.headers['content-length'] || 0);
    if (len > MAX_BODY) {
      res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' });
      res.end('{"ok":false,"error":"big"}', () => req.destroy());
      return;
    }
    const chunks = [];
    let size = 0, tooBig = false;
    req.on('data', c => {
      if (tooBig) return;
      size += c.length;
      if (size > MAX_BODY) {
        tooBig = true;
        res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' });
        res.end('{"ok":false,"error":"big"}', () => req.destroy());
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return;
      const body = Buffer.concat(chunks).toString('utf8');
      handle(req.method, req.url, req.headers, body, clientIp(req, trustProxy)).then(finish, e => {
        log.error('[kuda] ' + (e && e.message));
        finish({ status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: '{"ok":false,"error":"server"}' });
      });
    });
    req.on('error', () => { /* клиент оборвал соединение */ });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;

  const clean = () => store.cleanup(Date.now()).catch(e => log.error('[kuda] cleanup: ' + e.message));
  clean();
  const timer = setInterval(clean, 3600e3);
  timer.unref();

  const port = o.port != null ? o.port : Number(env.PORT || 8787);
  const host = o.host || env.HOST || '127.0.0.1';
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const addr = server.address();
  const url = `http://${host.includes(':') ? `[${host}]` : host}:${addr.port}`;

  async function close() {
    clearInterval(timer);
    const closed = new Promise(r => server.close(() => r()));
    server.closeIdleConnections();
    await closed;
    await store.close();
  }
  return { server, store, url, port: addr.port, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().then(({ url, store, close }) => {
    console.log(`«Куда идём?» API: ${url} (хранилище: ${store.kind})`);
    const stop = () => close().then(() => process.exit(0), () => process.exit(1));
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  }, e => {
    console.error('Не удалось запустить сервер: ' + e.message);
    process.exit(1);
  });
}

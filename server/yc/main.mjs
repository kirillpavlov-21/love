/* Обработчик Yandex Cloud Functions (его вызывает yc/index.js — точка входа yc/index.handler).
   HTTP-вызов (публичная ссылка функции или API Gateway) → handler.mjs;
   вызов от таймера (триггер kuda-api-cleanup) → удаление просроченных данных.
   Хранилище — STORE=ydb (YDB Document API); доступ по статическому ключу из Lockbox
   или по IAM-токену сервисного аккаунта функции (context.token). */
import { createHandler } from '../handler.mjs';
import { createStore } from '../store/index.mjs';

let iamToken = '';
let booting = null;

function boot() {
  if (!booting) {
    booting = (async () => {
      const store = await createStore(process.env, { token: () => iamToken });
      return { store, handle: createHandler({ store, env: process.env }) };
    })().catch(e => { booting = null; throw e; });
  }
  return booting;
}

const isTimer = ev => Array.isArray(ev && ev.messages) && ev.messages.some(m => m && m.event_metadata && /TimerMessage/.test(m.event_metadata.event_type || ''));

function urlOf(ev) {
  const qs = new URLSearchParams();
  const multi = ev.multiValueQueryStringParameters;
  if (multi && typeof multi === 'object') {
    for (const [k, v] of Object.entries(multi)) for (const x of [].concat(v)) qs.append(k, String(x));
  } else {
    for (const [k, v] of Object.entries(ev.queryStringParameters || {})) qs.append(k, String(v));
  }
  let path = typeof ev.path === 'string' && ev.path.startsWith('/') ? ev.path : '/';
  if (path.includes('{')) path = typeof ev.url === 'string' && ev.url.startsWith('/') ? ev.url.split('?')[0] : '/';
  const q = qs.toString();
  return path + (q ? '?' + q : '');
}

export async function handler(event, context) {
  if (context && context.token && context.token.access_token) iamToken = context.token.access_token;
  try {
    const { store, handle } = await boot();
    if (isTimer(event)) {
      const r = await store.cleanup(Date.now());
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, cleanup: r }) };
    }
    const ev = event || {};
    let body = typeof ev.body === 'string' ? ev.body : '';
    if (ev.isBase64Encoded && body) {
      if (body.length > 12000) return { statusCode: 413, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: '{"ok":false,"error":"big"}' };
      body = Buffer.from(body, 'base64').toString('utf8');
    }
    const ip = (ev.requestContext && ev.requestContext.identity && ev.requestContext.identity.sourceIp) || '';
    const r = await handle(ev.httpMethod || 'GET', urlOf(ev), ev.headers || {}, body, ip);
    return { statusCode: r.status, headers: r.headers, body: r.body, isBase64Encoded: false };
  } catch (e) {
    console.error('[kuda] ' + (e && e.message));
    return { statusCode: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: '{"ok":false,"error":"busy"}' };
  }
}

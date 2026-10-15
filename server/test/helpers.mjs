/* Общие помощники тестов: хранилища (SQLite во временном файле, YDB на подделке), часы, вызовы обработчика */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteStore } from '../store/sqlite.mjs';
import { createYdbStore } from '../store/ydb.mjs';
import { createHandler } from '../handler.mjs';
import { FakeDynamo } from './fake-dynamo.mjs';

export const ORIGIN = 'http://localhost:8765';
export const ADMIN = 'test-admin-token-0123456789';
export const T0 = Date.UTC(2026, 9, 15, 9, 0, 0);   // 15 октября 2026, 12:00 по Москве

export const MAKERS = {
  async sqlite() {
    const dir = mkdtempSync(join(tmpdir(), 'kuda-test-'));
    const store = await createSqliteStore({ path: join(dir, 'kuda.db') });
    return { store, dir, cleanup: async () => { await store.close(); rmSync(dir, { recursive: true, force: true }); } };
  },
  async ydb() {
    const fake = new FakeDynamo();
    const store = await createYdbStore({ doc: fake, prefix: 't_' });
    await store.init();
    return { store, fake, cleanup: async () => {} };
  },
};

/* Тестовый «мир»: хранилище + часы + обработчик */
export async function world(kind, o = {}) {
  const made = await MAKERS[kind]();
  const clock = { t: T0 };
  const env = { ALLOWED_ORIGINS: ORIGIN + ', https://kuda.example', SITE_ORIGINS: ORIGIN + ' https://user.github.io/date-invite/', ADMIN_TOKEN: ADMIN, ...(o.env || {}) };
  const logs = [];
  const log = { error: m => logs.push(m), warn: m => logs.push(m), log: m => logs.push(m) };
  const mk = (extra = {}) => createHandler({ store: made.store, env, now: () => clock.t, fetch: o.fetch, limits: o.limits, log, ...extra });
  let handle = mk();
  const bodies = [];
  async function raw(method, url, { body = '', headers = {}, ip = '10.0.0.1', origin = ORIGIN } = {}) {
    const h = { ...headers };
    if (origin) h.Origin = origin;
    const r = await handle(method, url, h, typeof body === 'string' ? body : JSON.stringify(body), ip);
    bodies.push(r.body);
    return r;
  }
  async function post(body, opt = {}) {
    const r = await raw('POST', '/', { ...opt, body });
    return { status: r.status, headers: r.headers, ...JSON.parse(r.body) };
  }
  async function get(query, opt = {}) {
    const r = await raw('GET', '/?' + query, opt);
    return { status: r.status, headers: r.headers, ...JSON.parse(r.body) };
  }
  /* /admin: POST-форма (как из браузера), без Origin */
  async function admin(fields, { path = '/admin', ip, headers = {} } = {}) {
    return raw('POST', path, { body: new URLSearchParams(fields).toString(), origin: null, ip, headers });
  }
  /* Вход: страница модерации + токен сессии из скрытого поля */
  async function login({ path = '/admin', ip, password = ADMIN } = {}) {
    const r = await admin({ op: 'login', password }, { path, ip });
    const m = r.body.match(/name="s" value="([^"]+)"/);
    return { r, s: m ? m[1] : '' };
  }
  return {
    ...made, clock, env, logs, bodies, raw, post, get, admin, login,
    tick(ms) { clock.t += ms; },
    restart(extra) { handle = mk(extra); },    // новый экземпляр функции с тем же хранилищем
  };
}

export const KEY = 'K'.repeat(21) + 'a';
export const KEY2 = 'Z'.repeat(21) + 'b';
export const dev = n => 'device-' + String(n).padStart(6, '0');
/* «Свой» IP для устройства n: у разных людей — разные адреса */
export const ipOf = n => '10.2.' + Math.floor(n / 250) % 250 + '.' + (n % 250 + 1);

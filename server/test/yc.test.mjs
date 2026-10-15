/* yc/index.js → yc/main.mjs: событие HTTP-интеграции Yandex Cloud Functions → handler, таймер → очистка */
import { describe, it, before, after } from 'node:test';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGIN = 'https://kuda.example';
const dir = mkdtempSync(join(tmpdir(), 'kuda-yc-'));
Object.assign(process.env, { STORE: 'sqlite', SQLITE_PATH: join(dir, 'kuda.db'), ALLOWED_ORIGINS: ORIGIN, ADMIN_TOKEN: 'yc-admin-token-0123456789' });
const { handler } = await import('../yc/main.mjs');

const ev = (o = {}) => ({
  httpMethod: 'GET', headers: { Origin: ORIGIN }, multiValueHeaders: {}, queryStringParameters: {}, multiValueQueryStringParameters: {},
  requestContext: { identity: { sourceIp: '198.51.100.1', userAgent: 'test' }, httpMethod: o.httpMethod || 'GET', requestId: 'r1' },
  body: '', isBase64Encoded: false, path: '', url: '', params: {}, pathParams: {}, ...o,
});

describe('yc/index.js + yc/main.mjs', () => {
  after(() => rmSync(dir, { recursive: true, force: true }));
  const key = 'Y'.repeat(22);

  it('POST с телом в base64 и GET с параметрами', async () => {
    const body = Buffer.from(JSON.stringify({ action: 'vote', key, voter: { id: 'a', n: 'Аня', y: 1, o: [], d: [] }, secret: 'secret-123' })).toString('base64');
    const p = await handler(ev({ httpMethod: 'POST', body, isBase64Encoded: true }), { token: { access_token: 't1.x' } });
    assert.equal(p.statusCode, 200);
    assert.equal(p.headers['Access-Control-Allow-Origin'], ORIGIN);
    assert.equal(JSON.parse(p.body).rev, 1);
    const g = await handler(ev({ queryStringParameters: { votes: key, rev: '1' }, multiValueQueryStringParameters: { votes: [key], rev: ['1'] } }), {});
    assert.deepEqual(JSON.parse(g.body), { ok: true, same: true });
    const g2 = await handler(ev({ queryStringParameters: { votes: key }, multiValueQueryStringParameters: undefined }), {});
    assert.equal(JSON.parse(g2.body).votes.length, 1);
  });

  it('точка входа yc/index.handler — CommonJS: работает через require (как в примерах Cloud Functions)', async () => {
    const require = createRequire(import.meta.url);
    const entry = require('../yc/index.js');
    assert.equal(typeof entry.handler, 'function');
    const r = await entry.handler(ev({ queryStringParameters: { votes: key }, multiValueQueryStringParameters: { votes: [key] } }), {});
    assert.equal(r.statusCode, 200);
    assert.equal(JSON.parse(r.body).ok, true);
  });

  it('?admin=1: вход формой — без Authorization и Cookie (Cloud Functions их вырезает)', async () => {
    const q = { queryStringParameters: { admin: '1' }, multiValueQueryStringParameters: { admin: ['1'] } };
    const page = await handler(ev({ ...q, headers: {} }), {});
    assert.equal(page.statusCode, 200);
    assert.match(page.headers['Content-Type'], /text\/html/);
    assert.match(page.body, /<form class="login" method="post" action="\?admin=1">/);
    // форма приходит как application/x-www-form-urlencoded в base64
    const form = b => Buffer.from(new URLSearchParams(b).toString()).toString('base64');
    const post = b => handler(ev({ ...q, httpMethod: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(b), isBase64Encoded: true }), {});
    const r = await post({ op: 'login', password: 'yc-admin-token-0123456789' });
    assert.equal(r.statusCode, 200);
    assert.match(r.body, /Ждут проверки/);
    const s = r.body.match(/name="s" value="([^"]+)"/)[1];
    const v = await post({ op: 'view', s });
    assert.equal(v.statusCode, 200);
    assert.match(v.body, /Ждут проверки/);
    assert.equal((await post({ op: 'login', password: 'wrong-wrong-wrong' })).statusCode, 401);
  });

  it('слишком большое тело и чужой сайт', async () => {
    const big = await handler(ev({ httpMethod: 'POST', body: Buffer.from('x'.repeat(10000)).toString('base64'), isBase64Encoded: true }), {});
    assert.equal(big.statusCode, 413);
    const evil = await handler(ev({ headers: { Origin: 'https://evil.example' } }), {});
    assert.equal(evil.statusCode, 403);
  });

  it('таймер чистит просроченное', async () => {
    const r = await handler({ messages: [{ event_metadata: { event_type: 'yandex.cloud.events.serverless.triggers.TimerMessage', created_at: '2026-10-15T03:00:00Z' }, details: { trigger_id: 'x' } }] }, {});
    assert.equal(r.statusCode, 200);
    assert.equal(JSON.parse(r.body).ok, true);
  });
});

/* server.mjs: настоящий HTTP — лимит тела, CORS, адрес клиента за прокси */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { start } from '../server.mjs';

const ORIGIN = 'http://localhost:8765';

function request(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('server.mjs', () => {
  let srv, dir, lines = [];
  const quietLog = { log: m => lines.push(m), error: m => lines.push(m) };
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'kuda-http-'));
    srv = await start({ port: 0, host: '127.0.0.1', log: quietLog, env: { STORE: 'sqlite', SQLITE_PATH: join(dir, 'db', 'kuda.db'), ALLOWED_ORIGINS: ORIGIN, TRUST_PROXY: '1' } });
  });
  after(async () => { await srv.close(); rmSync(dir, { recursive: true, force: true }); });

  it('GET, CORS и журнал без параметров', async () => {
    const key = 'H'.repeat(22);
    const r = await request(srv.url + '/?votes=' + key, { headers: { Origin: ORIGIN } });
    assert.equal(r.status, 200);
    assert.equal(r.headers['access-control-allow-origin'], ORIGIN);
    assert.deepEqual(JSON.parse(r.body), { ok: true, votes: [], rev: 0, spin: null, spins: {} });
    assert.ok(lines.some(l => / GET \/ 200 \d+ms$/.test(l)));
    assert.ok(!lines.some(l => l.includes(key)));
  });

  it('POST text/plain без preflight', async () => {
    const r = await request(srv.url + '/', {
      method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ action: 'vote', key: 'H'.repeat(22), voter: { id: 'a', n: 'Аня', y: 1, o: [0], d: [] }, secret: 'secret-123' }),
    });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.body).votes[0].n, 'Аня');
  });

  it('тело больше 8 КБ отклоняется и по Content-Length, и потоком', async () => {
    const big = JSON.stringify({ action: 'fix', text: 'x'.repeat(9000) });
    const a = await request(srv.url + '/', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Length': Buffer.byteLength(big) }, body: big });
    assert.equal(a.status, 413);
    const b = await new Promise((resolve, reject) => {
      const req = http.request(srv.url + '/', { method: 'POST', headers: { Origin: ORIGIN, 'Transfer-Encoding': 'chunked' } }, res => {
        let d = ''; res.on('data', c => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d }));
      });
      req.on('error', reject);
      for (let i = 0; i < 10; i++) req.write('x'.repeat(1000));
      req.end();
    });
    assert.equal(b.status, 413);
    assert.equal(JSON.parse(b.body).error, 'big');
  });

  it('за прокси (TRUST_PROXY=1) лимит считается по правому X-Forwarded-For; X-Real-IP от клиента не помогает', async () => {
    const ip = '203.0.113.' + Math.floor(Math.random() * 200 + 1);
    // Caddy заменяет X-Forwarded-For адресом клиента, а X-Real-IP пропускает как есть — подделка не должна обходить лимит
    for (let i = 0; i < 600; i++) {
      await request(srv.url + '/?ratings=1', { headers: { Origin: ORIGIN, 'X-Forwarded-For': ip, 'X-Real-IP': '192.0.2.' + (i % 250) } });
    }
    assert.equal((await request(srv.url + '/?ratings=1', { headers: { Origin: ORIGIN, 'X-Forwarded-For': ip, 'X-Real-IP': '192.0.2.251' } })).status, 429);
    assert.equal((await request(srv.url + '/?ratings=1', { headers: { Origin: ORIGIN, 'X-Forwarded-For': ip + ', 198.51.100.7' } })).status, 200);
    assert.equal((await request(srv.url + '/?ratings=1', { headers: { Origin: ORIGIN, 'X-Forwarded-For': '198.51.100.7, ' + ip } })).status, 429);
  });

  it('TRUST_PROXY=x-real-ip: только X-Real-IP; без прокси заголовки не читаются', async () => {
    const d2 = mkdtempSync(join(tmpdir(), 'kuda-http2-'));
    const a = await start({ port: 0, host: '127.0.0.1', log: quietLog, env: { STORE: 'sqlite', SQLITE_PATH: join(d2, 'a.db'), ALLOWED_ORIGINS: ORIGIN, TRUST_PROXY: 'x-real-ip' } });
    const b = await start({ port: 0, host: '127.0.0.1', log: quietLog, env: { STORE: 'sqlite', SQLITE_PATH: join(d2, 'b.db'), ALLOWED_ORIGINS: ORIGIN } });
    try {
      for (let i = 0; i < 600; i++) await request(a.url + '/?ratings=1', { headers: { Origin: ORIGIN, 'X-Real-IP': '203.0.113.9', 'X-Forwarded-For': '192.0.2.' + (i % 250) } });
      assert.equal((await request(a.url + '/?ratings=1', { headers: { Origin: ORIGIN, 'X-Real-IP': '203.0.113.9' } })).status, 429);
      assert.equal((await request(a.url + '/?ratings=1', { headers: { Origin: ORIGIN, 'X-Real-IP': '203.0.113.10' } })).status, 200);
      for (let i = 0; i < 600; i++) await request(b.url + '/?ratings=1', { headers: { Origin: ORIGIN, 'X-Real-IP': '192.0.2.' + (i % 250), 'X-Forwarded-For': '192.0.2.' + (i % 250) } });
      assert.equal((await request(b.url + '/?ratings=1', { headers: { Origin: ORIGIN, 'X-Real-IP': '198.51.100.1' } })).status, 429);   // считается адрес соединения
    } finally {
      await a.close();
      await b.close();
      rmSync(d2, { recursive: true, force: true });
    }
  });
});

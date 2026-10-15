/* assets/api.js против настоящего server.mjs (SQLite во временной папке): два браузера голосуют,
   опрос, колесо, приглашения, отзывы, рейтинги, короткие ссылки; выключенный API и таймауты. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { start } from '../server.mjs';
import { loadApi } from './browser-shim.mjs';

const ORIGIN = 'http://localhost:8765';
const plain = x => JSON.parse(JSON.stringify(x));   // объекты из vm — другого «мира», сравниваем как JSON
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(10); }
  throw new Error('не дождались');
}

describe('assets/api.js ↔ server.mjs', () => {
  let srv, dir;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'kuda-client-'));
    srv = await start({
      port: 0, host: '127.0.0.1', log: { log() {}, error() {} },
      env: { STORE: 'sqlite', SQLITE_PATH: join(dir, 'kuda.db'), ALLOWED_ORIGINS: ORIGIN, SITE_ORIGINS: ORIGIN },
    });
  });
  after(async () => { await srv.close(); rmSync(dir, { recursive: true, force: true }); });

  it('ключи: SHA-256 через crypto.subtle и запасной JS дают одно и то же', async () => {
    const a = loadApi(srv.url).api, b = loadApi(srv.url, { noSubtle: true }).api;
    const want = createHash('sha256').update('kuda-votes|AbC123xyz').digest('base64url').slice(0, 22);
    assert.equal(await a.key('AbC123xyz'), want);
    assert.equal(await b.key('AbC123xyz'), want);
    const long = 'Привет, мир! '.repeat(30);
    assert.equal(await b.ownerKey(long), createHash('sha256').update('kuda-owner|' + long).digest('base64url').slice(0, 22));
    assert.match(a.dev(), /^[A-Za-z0-9_-]{22}$/);
    assert.equal(a.dev(), a.dev());
  });

  it('два голосующих, живой опрос с паузой на скрытой вкладке, колесо', async () => {
    const A = loadApi(srv.url, { timeScale: 0.01 }), B = loadApi(srv.url, { timeScale: 0.01 });
    const code = 'GRP' + Date.now().toString(36);
    const a1 = await A.api.vote(code, { id: 'a1', n: 'Аня', y: 1, o: [0, 1], d: [2480] });
    assert.deepEqual([a1.rev, a1.votes.length, a1.spin], [1, 1, null]);
    const seen = [];
    const stop = A.api.poll(code, r => seen.push(r));
    await until(() => seen.length === 1);
    assert.equal(seen[0].rev, 1);
    const b1 = await B.api.vote(code, { id: 'b2', n: 'Боря', y: 1, o: [1], d: [2481] }, null, [{ id: 'old', n: 'Из ссылки', y: 1, o: [2], d: [], t: 29000000 }]);
    assert.deepEqual(plain(b1.votes.map(v => v.id).sort()), ['a1', 'b2', 'old']);
    await until(() => seen.length === 2);
    assert.equal(seen[1].votes.length, 3);
    // скрытая вкладка — запросов нет
    A.setHidden(true);
    const n0 = A.requests.length;
    await B.api.vote(code, { id: 'b2', n: 'Боря', y: 0, o: [], d: [] });
    await sleep(300);
    assert.equal(A.requests.length, n0);
    A.setHidden(false);
    await until(() => seen.length === 3);
    assert.equal(seen[2].votes.find(v => v.id === 'b2').y, 0);
    stop();
    assert.equal(A.listeners('visibilitychange'), 0);
    const n1 = A.requests.length;
    await sleep(200);
    assert.equal(A.requests.length, n1);
    // чужой браузер не может переписать голос a1
    assert.equal(await B.api.vote(code, { id: 'a1', n: 'Взлом', y: 1, o: [], d: [] }), null);
    assert.equal(B.api.lastError, 'owner');
    const s1 = await A.api.spin(code, 1), s2 = await B.api.spin(code, { i: 0 });
    assert.equal(s1.spin.i, 1);
    assert.equal(s2.spin.i, 1);
    const same = await A.api.votes(code, s2.rev);
    assert.deepEqual(plain(same), { same: true, rev: s2.rev });
  });

  it('приглашение, «открыли» один раз, ответ, «Мои приглашения»', async () => {
    const owner = loadApi(srv.url), guest = loadApi(srv.url);
    const code = 'DATE' + Date.now().toString(36), code2 = 'GRP2' + Date.now().toString(36);
    assert.equal(await owner.api.invite(code, 'owner-secret-123456', { mode: 'date', title: 'Кино' }), true);
    assert.equal(await owner.api.invite(code2, 'owner-secret-123456', { mode: 'guys', title: 'Пятница' }), true);
    assert.equal(await guest.api.invite(code, 'someone-else-12345', { mode: 'date' }), null);
    assert.equal(guest.api.lastError, 'taken');
    assert.equal(await guest.api.opened(code), true);
    const before = guest.requests.length;
    assert.equal(await guest.api.opened(code), true);           // повтор — без сети
    assert.equal(guest.requests.length, before);
    assert.equal(await guest.api.answer(code, { yes: true, date: '2026-10-17', time: '19:00', note: 'До встречи!' }), true);
    await guest.api.vote(code2, { id: 'g1', n: 'Гость', y: 1, o: [0], d: [] });
    const m = await owner.api.mine('owner-secret-123456', [code, code2, 'unknown']);
    assert.deepEqual(plain(Object.keys(m).sort()), [code, code2].sort());
    assert.deepEqual([m[code].opened, m[code].answer.note, m[code].title], [1, 'До встречи!', 'Кино']);
    assert.equal(m[code2].votes, 1);
    assert.deepEqual(plain(await guest.api.mine('wrong-secret-1234', [code])), {});
  });

  it('отзыв, повторный — dup, рейтинги из кэша, страница отзывов, жалоба', async () => {
    const u = loadApi(srv.url), v = loadApi(srv.url);
    const r = await u.api.review({ place: 'krasota', stars: 5, text: 'Красиво, уютно, вкусно — для первого свидания то, что надо', tags: ['cozy', 'first'], fit: 'date', name: 'Аня' });
    assert.equal(r.pending, false);
    assert.equal(u.api.reviewed('krasota'), true);
    assert.equal(await u.api.review({ place: 'krasota', stars: 1 }), null);
    assert.equal(u.api.lastError, 'dup');
    const rt = await v.api.ratings();
    assert.deepEqual(plain(rt.krasota), [5, 1, 5, null, 1, 0]);
    const n = v.requests.length;
    assert.deepEqual(plain(await v.api.ratings()), plain(rt));                  // sessionStorage, без сети
    assert.equal(v.requests.length, n);
    const list = await v.api.reviews('krasota');
    assert.equal(list.total, 1);
    assert.equal(list.items[0].name, 'Аня');
    assert.equal(await v.api.report(list.items[0].id, 'спам'), true);
    assert.equal(await v.api.fix('krasota', 'Кажется, переехали на соседнюю улицу'), true);
  });

  it('короткие ссылки', async () => {
    const { api } = loadApi(srv.url);
    const url = ORIGIN + '/index.html#ABC123&v=xyz';
    const code = await api.short(url);
    assert.match(code, /^[A-Za-z0-9]{7}$/);
    assert.equal(await api.expand(code), url);
    assert.equal(await api.short('https://evil.example/'), null);
    assert.equal(api.lastError, 'url');
    assert.equal(await api.expand('nope123'), null);
  });

  it('без api.url — ни одного запроса, всё null', async () => {
    const off = loadApi('');
    const a = off.api;
    assert.equal(a.on, false);
    const results = await Promise.all([
      a.vote('X', { id: 'a' }), a.votes('X'), a.spin('X', 1), a.invite('X', 's'), a.opened('X'), a.answer('X', {}),
      a.mine('s', ['X']), a.ratings(), a.reviews('krasota'), a.review({ place: 'krasota', stars: 5 }), a.report('id'), a.short('u'), a.expand('c'), a.fix('p', 't'),
    ]);
    assert.deepEqual(results, new Array(14).fill(null));
    const stop = a.poll('X', () => {});
    stop();
    assert.equal(off.requests.length, 0);
    assert.equal(a.lastError, 'off');
    assert.equal(loadApi('http://evil.example/api').api.on, false);   // http — только для localhost
  });

  it('таймаут 4 с и не-JSON ответ → null, без исключений', async () => {
    const hang = http.createServer(() => { /* не отвечаем */ });
    const html = http.createServer((q, r) => { r.writeHead(502, { 'Content-Type': 'text/html' }); r.end('<h1>Bad gateway</h1>'); });
    await new Promise(r => hang.listen(0, '127.0.0.1', r));
    await new Promise(r => html.listen(0, '127.0.0.1', r));
    try {
      const slow = loadApi(`http://127.0.0.1:${hang.address().port}`, { timeScale: 0.01, fastTimeouts: true }).api;
      const t = Date.now();
      assert.equal(await slow.vote('X', { id: 'a', n: 'a', y: 1 }), null);
      assert.equal(slow.lastError, 'timeout');
      assert.ok(Date.now() - t < 2000);
      const bad = loadApi(`http://127.0.0.1:${html.address().port}`).api;
      assert.equal(await bad.ratings(), null);
      assert.equal(bad.lastError, 'net');
    } finally {
      hang.closeAllConnections();
      hang.close();
      html.close();
    }
  });
});

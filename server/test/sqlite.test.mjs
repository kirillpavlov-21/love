/* Набор проверок API на SQLite (временный файл) + особенности адаптера */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { suite } from './suite.mjs';
import { createSqliteStore } from '../store/sqlite.mjs';
import { createStore } from '../store/index.mjs';

suite('sqlite');

describe('[sqlite] адаптер', () => {
  it('данные переживают перезапуск: файл базы, WAL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kuda-test-'));
    const path = join(dir, 'nested', 'kuda.db');
    const a = await createSqliteStore({ path });
    const voter = { id: 'a1', n: 'Петя', y: 1, o: [1], d: [2480], t: 1000 };
    await a.vote('K'.repeat(22), voter, 'hash1', [], { now: 1000, exp: 5000, max: 60 });
    await a.close();
    const b = await createSqliteStore({ path });
    const v = await b.votes('K'.repeat(22));
    assert.deepEqual(v.votes, [voter]);
    assert.equal(v.rev, 1);
    assert.equal((await b.hit('x', 600, 1000)), 1);
    assert.equal((await b.hit('x', 600, 2000)), 2);
    assert.equal((await b.hit('x', 600, 600e3 + 1)), 1);   // новое окно
    const c = await b.cleanup(10e6);
    assert.equal(c.invites, 1);
    assert.equal(c.voters, 1);
    assert.ok(c.limits >= 1);
    await b.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('база старой версии: без колонки spins, один итог колеса — колонка добавляется, итог сохраняется', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kuda-test-'));
    const path = join(dir, 'old.db');
    const K = 'K'.repeat(22);
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE inv (
      key TEXT PRIMARY KEY, rev INTEGER NOT NULL DEFAULT 0, cnt INTEGER NOT NULL DEFAULT 0, spin TEXT,
      owner TEXT, mode TEXT, title TEXT, answer TEXT, opened INTEGER NOT NULL DEFAULT 0, fo INTEGER,
      upd INTEGER NOT NULL, exp INTEGER NOT NULL)`);
    old.prepare('INSERT INTO inv (key, rev, cnt, spin, upd, exp) VALUES (?, 5, 2, ?, 100, 9e12)').run(K, JSON.stringify({ i: 4, d: 2480, t: 100 }));
    old.close();
    const a = await createSqliteStore({ path });
    const v = await a.votes(K);
    assert.deepEqual([v.rev, v.spin, v.spins], [5, { i: 4, d: 2480, t: 100 }, {}]);
    // старый клиент: итог без L — прежний; новый: свой итог для набора лидеров
    assert.deepEqual(await a.spin(K, { i: 1, d: null, t: 200, L: '' }, { now: 200, exp: 9e12, max: 10 }), { spin: v.spin, spins: {}, rev: 5 });
    const s = await a.spin(K, { i: 1, d: null, t: 300, L: '1,4' }, { now: 300, exp: 9e12, max: 10 });
    assert.deepEqual(s, { spin: { i: 1, d: null, t: 300, L: '1,4' }, spins: { '1,4': { i: 1, d: null, t: 300, L: '1,4' } }, rev: 6 });
    await a.close();
    // второй запуск: колонка уже есть, данные на месте; в spin — последний итог (его читает прежняя версия при откате)
    const b = await createSqliteStore({ path });
    assert.deepEqual((await b.votes(K)).spin, s.spin);
    await b.close();
    const raw = new DatabaseSync(path);
    const row = raw.prepare('SELECT spin, spins FROM inv WHERE key = ?').get(K);
    raw.close();
    assert.deepEqual(JSON.parse(row.spin), s.spin);
    assert.deepEqual(JSON.parse(row.spins).map(x => x.L), ['', '1,4']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('createStore: STORE=sqlite по умолчанию, неизвестное хранилище — ошибка', async () => {
    const s = await createStore({ SQLITE_PATH: ':memory:' });
    assert.equal(s.kind, 'sqlite');
    await s.close();
    await assert.rejects(createStore({ STORE: 'mongo' }), /sqlite или ydb/);
  });
});

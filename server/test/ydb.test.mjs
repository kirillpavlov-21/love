/* Тот же набор проверок API на адаптере YDB (Document API) поверх поддельного DynamoDB в памяти,
   плюс проверка подписи запросов: статический ключ (SigV4) или IAM-токен (Bearer). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { suite } from './suite.mjs';
import { createYdbStore } from '../store/ydb.mjs';
import { createStore } from '../store/index.mjs';
import { FakeDynamo } from './fake-dynamo.mjs';

suite('ydb');

/* Мини-сервер, отвечающий как DynamoDB: запоминает заголовки запросов */
async function fakeEndpoint() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      seen.push({ headers: req.headers, url: req.url, target: req.headers['x-amz-target'], body });
      res.writeHead(200, { 'Content-Type': 'application/x-amz-json-1.0' });
      res.end(req.headers['x-amz-target'] === 'DynamoDB_20120810.ListTables' ? '{"TableNames":["kuda_inv","kuda_rev","kuda_short","kuda_lim"]}' : '{}');
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/ru-central1/b1gfolder/etndb`, seen, close: () => new Promise(r => server.close(r)) };
}

describe('[ydb] адаптер', () => {
  it('init создаёт четыре таблицы с ключами pk/sk, включает TTL счётчикам и ссылкам, повтор ничего не ломает', async () => {
    const fake = new FakeDynamo();
    const s = await createYdbStore({ doc: fake, prefix: 'kuda_' });
    await s.init();
    await s.init();
    assert.deepEqual(Array.from(fake.tables.keys()).sort(), ['kuda_inv', 'kuda_lim', 'kuda_rev', 'kuda_short']);
    assert.equal(fake.tables.get('kuda_inv').range, 'sk');
    assert.equal(fake.tables.get('kuda_short').range, null);
    assert.equal(fake.calls.filter(c => c === 'CreateTableCommand').length, 4);
    assert.deepEqual([fake.tables.get('kuda_lim').ttl, fake.tables.get('kuda_short').ttl, fake.tables.get('kuda_inv').ttl], ['ttl', 'ttl', undefined]);
    assert.equal(fake.calls.filter(c => c === 'UpdateTimeToLiveCommand').length, 2);   // второй init не включает повторно
    assert.equal(s.ttlWarning, '');
    // счётчики и короткие ссылки пишут ttl в секундах (подделка проверяет), срок — в e
    await s.hit('x', 600, 1_800_000_000_000);
    await s.devSeen('d1', 1_800_000_000_000);
    await s.shortPut('https://x.example/', 'h1', { now: 1_800_000_000_000, exp: 1_800_000_000_000 + 864e5, gen: () => 'Abc1234' });
    const sh = fake.tables.get('kuda_short').items.get('s|Abc1234');
    assert.deepEqual([sh.e, sh.ttl], [1_800_000_000_000 + 864e5, 1_800_086_400]);
    // TTL не включился (например, операция ещё идёт) — init не падает, предупреждение для deploy.sh
    const f2 = new FakeDynamo();
    const s2 = await createYdbStore({ doc: f2, prefix: 'q_' });
    const send0 = f2.send.bind(f2);
    f2.send = async cmd => { if (cmd.constructor.name === 'UpdateTimeToLiveCommand') { const e = new Error('busy'); e.name = 'ValidationException'; throw e; } return send0(cmd); };
    await s2.init();
    assert.match(s2.ttlWarning, /q_lim: ValidationException; q_short: ValidationException/);
  });

  it('короткие ссылки и сообщения об ошибках удаляются очисткой; повторное сокращение продлевает срок', async () => {
    const fake = new FakeDynamo({ pageSize: 2 });
    const s = await createYdbStore({ doc: fake, prefix: 'p_' });
    await s.init();
    const D = 864e5, T = 1_800_000_000_000;
    const code = await s.shortPut('https://x.example/a', 'ha', { now: T, exp: T + 180 * D, gen: () => 'Aaaaaaa' });
    assert.equal(await s.shortPut('https://x.example/a', 'ha', { now: T + 100 * D, exp: T + 280 * D, gen: () => 'Bbbbbbb' }), code);
    assert.equal(await s.shortGet(code, T + 200 * D), 'https://x.example/a');      // продлили до 280-го дня
    await s.shortPut('https://x.example/b', 'hb', { now: T, exp: T + 180 * D, gen: () => 'Ccccccc' });
    await s.fixAdd({ id: '0000000000aaa', place: 'krasota', text: 'закрылись', dev: 'd', at: T, exp: T + 365 * D });
    const c1 = await s.cleanup(T + 200 * D);
    assert.equal(c1.shorts, 2);                                                       // s|Ccccccc и h|hb
    assert.equal(await s.shortGet('Ccccccc', T + 200 * D), null);
    assert.equal(c1.fixes, 0);
    const c2 = await s.cleanup(T + 366 * D);
    assert.deepEqual([c2.shorts, c2.fixes], [2, 1]);
    assert.deepEqual(await s.fixList(10), []);
    // истёкший код можно выдать заново
    assert.equal(await s.shortPut('https://x.example/c', 'hc', { now: T + 400 * D, exp: T + 580 * D, gen: () => 'Aaaaaaa' }), 'Aaaaaaa');
  });

  it('cleanup листает страницы и удаляет всё просроченное приглашение целиком', async () => {
    const fake = new FakeDynamo({ pageSize: 3 });
    const s = await createYdbStore({ doc: fake, prefix: 'p_' });
    await s.init();
    const seeds = Array.from({ length: 9 }, (_, i) => ({ id: 's' + i, n: 'x', y: 1, o: [], d: [], t: 1 }));
    await s.vote('A'.repeat(22), { id: 'own', n: 'x', y: 1, o: [], d: [], t: 1 }, 'h', seeds, { now: 1, exp: 100, max: 60 });
    await s.opened('A'.repeat(22), 'dev1', { now: 1, exp: 100 });
    await s.vote('B'.repeat(22), { id: 'own', n: 'x', y: 1, o: [], d: [], t: 1 }, 'h', [], { now: 1, exp: 10_000, max: 60 });
    const r = await s.cleanup(500);
    assert.equal(r.invites, 1);
    assert.equal(r.items, 12);                 // 10 голосов + «открыл» + m
    assert.equal((await s.votes('A'.repeat(22))), null);
    assert.equal((await s.votes('B'.repeat(22))).votes.length, 1);
  });

  it('статический ключ — подпись SigV4; без ключа — IAM-токен в Authorization: Bearer', async () => {
    const ep = await fakeEndpoint();
    try {
      const a = await createYdbStore({ endpoint: ep.url, accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' });
      await a.init();
      const sig = ep.seen.pop();
      assert.match(sig.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/ru-central1\/dynamodb\/aws4_request/);
      assert.match(sig.url, /^\/ru-central1\/b1gfolder\/etndb\/?$/);   // путь из endpoint сохраняется
      await a.close();
      let token = 't1.iam-token-one';
      const b = await createYdbStore({ endpoint: ep.url, token: () => token });
      await b.init();
      assert.equal(ep.seen.pop().headers.authorization, 'Bearer t1.iam-token-one');
      token = 't1.iam-token-two';
      await b.init();
      assert.equal(ep.seen.pop().headers.authorization, 'Bearer t1.iam-token-two');
      await b.close();
    } finally {
      await ep.close();
    }
    await assert.rejects(createYdbStore({ endpoint: 'http://127.0.0.1:1/x' }), /статический ключ|IAM/);
    await assert.rejects(createYdbStore({}), /YDB_DOCAPI_ENDPOINT/);
  });

  it('createStore(STORE=ydb) берёт настройки из окружения', async () => {
    const ep = await fakeEndpoint();
    try {
      const s = await createStore({ STORE: 'ydb', YDB_DOCAPI_ENDPOINT: ep.url, AWS_ACCESS_KEY_ID: 'AKID2', AWS_SECRET_ACCESS_KEY: 'x' });
      assert.equal(s.kind, 'ydb');
      const targets = ep.seen.map(x => x.target);
      assert.ok(targets.includes('DynamoDB_20120810.ListTables'));
      assert.deepEqual(targets.filter(t => /TimeToLive/.test(t)), [
        'DynamoDB_20120810.DescribeTimeToLive', 'DynamoDB_20120810.UpdateTimeToLive',
        'DynamoDB_20120810.DescribeTimeToLive', 'DynamoDB_20120810.UpdateTimeToLive',
      ]);
      const ttl = JSON.parse(ep.seen.find(x => x.target === 'DynamoDB_20120810.UpdateTimeToLive').body);
      assert.deepEqual(ttl, { TableName: 'kuda_lim', TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true } });
      assert.equal(s.ttlWarning, '');
      await s.close();
    } finally {
      await ep.close();
    }
  });

  it('колесо: запись старой версии (только spin) и гонка записей — первый итог для набора лидеров остаётся', async () => {
    const fake = new FakeDynamo();
    const s = await createYdbStore({ doc: fake, prefix: 'w_' });
    await s.init();
    const K = 'K'.repeat(22), o = { now: 1000, exp: 9e12, max: 10 };
    await s.vote(K, { id: 'a', n: 'x', y: 1, o: [1], d: [], t: 1 }, 'h', [], o);
    const item = () => fake.tables.get('w_inv').items.get(K + '\u0000m');
    item().spin = JSON.stringify({ i: 4, d: null, t: 500 });               // так писала прежняя версия: spins нет
    assert.deepEqual(await s.votes(K).then(v => [v.spin, v.spins]), [{ i: 4, d: null, t: 500 }, {}]);
    assert.deepEqual(await s.spin(K, { i: 0, d: null, t: 600 }, o), { spin: { i: 4, d: null, t: 500 }, spins: {}, rev: 1 });
    const a = await s.spin(K, { i: 1, d: null, t: 700, L: '1,4' }, o);
    assert.deepEqual([a.spin.L, a.rev, JSON.parse(item().spins).map(x => x.L), JSON.parse(item().spin).L], ['1,4', 2, ['', '1,4'], '1,4']);

    // между чтением и записью другой экземпляр успел дописать свой набор — повтор дописывает поверх
    const send0 = fake.send.bind(fake);
    let race = null;
    fake.send = async cmd => {
      if (race && cmd.constructor.name === 'UpdateCommand' && /#spins/.test(cmd.input.UpdateExpression)) { const r = race; race = null; await r(); }
      return send0(cmd);
    };
    race = () => s.spin(K, { i: 2, d: null, t: 800, L: '2,3' }, o);
    const b = await s.spin(K, { i: 5, d: null, t: 801, L: '0,5' }, o);
    assert.deepEqual([b.spin.i, b.rev, Object.keys(b.spins)], [5, 4, ['1,4', '2,3', '0,5']]);
    // гонка за тот же набор: остаётся итог того, кто записал первым
    race = () => s.spin(K, { i: 6, d: null, t: 900, L: '6,7' }, o);
    const c = await s.spin(K, { i: 7, d: null, t: 901, L: '6,7' }, o);
    assert.deepEqual([c.spin.i, c.spin.t, c.rev], [6, 900, 5]);
    assert.deepEqual((await s.votes(K)).spin, c.spin);

    // список меняется при каждой попытке — сдаёмся с ошибкой, которую обработчик считает «busy»
    fake.send = async cmd => {
      if (cmd.constructor.name === 'UpdateCommand' && /#spins/.test(cmd.input.UpdateExpression)) item().spins = JSON.stringify(JSON.parse(item().spins).map(x => ({ ...x, t: x.t + 1 })));
      return send0(cmd);
    };
    await assert.rejects(s.spin(K, { i: 8, d: null, t: 1000, L: '8,9' }, o), e => e.name === 'TransactionConflict');
    const { world } = await import('./helpers.mjs');
    const w = await world('ydb');
    await w.post({ action: 'vote', key: K, voter: { id: 'a', n: 'x', y: 1, o: [2], d: [] }, secret: 'secret-of-a' });
    const wsend = w.fake.send.bind(w.fake);
    w.fake.send = async cmd => {
      if (cmd.constructor.name === 'UpdateCommand' && /#spins/.test(cmd.input.UpdateExpression)) {
        const it = w.fake.tables.get('t_inv').items.get(K + '\u0000m');
        if (it) it.spins = JSON.stringify([{ i: 0, d: null, t: Math.random(), L: '0,1' }]);
      }
      return wsend(cmd);
    };
    const r = await w.post({ action: 'spin', key: K, result: { i: 3, L: '2,3' } });
    assert.deepEqual([r.status, r.error], [503, 'busy']);
  });

  it('ошибки хранилища превращаются в 503 busy, без подробностей наружу', async () => {
    const { world } = await import('./helpers.mjs');
    const w = await world('ydb');
    w.fake.failNext = 'ProvisionedThroughputExceededException';
    const r = await w.get('ratings=1');
    assert.deepEqual([r.status, r.error], [503, 'busy']);
    w.fake.failNext = 'InternalServerError';
    const r2 = await w.post({ action: 'opened', key: 'K'.repeat(22), dev: 'device-000001' });
    assert.deepEqual([r2.status, r2.error], [500, 'server']);
    assert.ok(w.logs.length === 2);
  });
});

/* Один и тот же набор проверок для обоих хранилищ: каждое действие API, владение, лимиты,
   очистка текста, CORS, вход в /admin, сроки хранения. */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { world, KEY, KEY2, ORIGIN, ADMIN, dev, ipOf } from './helpers.mjs';

const ownerOf = s => createHash('sha256').update('kuda-owner|' + s).digest('base64url').slice(0, 22);
const V = (id, extra = {}) => ({ id, n: 'Имя ' + id, y: 1, o: [0], d: [2480], ...extra });
const MIN = 60e3, DAY = 864e5;

export function suite(kind) {
  describe(`[${kind}] голоса`, () => {
    let w;
    beforeEach(async () => { w = await world(kind); });
    afterEach(() => w.cleanup());

    it('первый голос: сервер ставит время, rev = 1, итог без секретов', async () => {
      const r = await w.post({ action: 'vote', key: KEY, voter: V('a1', { t: 5 }), secret: 'secret-of-a1' });
      assert.equal(r.status, 200);
      assert.equal(r.rev, 1);
      assert.equal(r.spin, null);
      assert.deepEqual(r.votes, [{ id: 'a1', n: 'Имя a1', y: 1, o: [0], d: [2480], t: w.clock.t }]);
      assert.ok(!w.bodies.some(b => b.includes('secret-of-a1')));
      assert.ok(!('h' in r.votes[0]));
    });

    it('опрос: same при том же rev, полный список при другом, пустой для нового ключа', async () => {
      await w.post({ action: 'vote', key: KEY, voter: V('a1'), secret: 'secret-of-a1' });
      assert.deepEqual((await w.get('votes=' + KEY + '&rev=1')).same, true);
      const full = await w.get('votes=' + KEY + '&rev=0');
      assert.equal(full.votes.length, 1);
      assert.equal(full.rev, 1);
      assert.equal((await w.get('votes=' + KEY)).votes.length, 1);
      const none = await w.get('votes=' + KEY2);
      assert.deepEqual([none.votes, none.rev, none.spin], [[], 0, null]);
      assert.equal((await w.get('votes=' + KEY2 + '&rev=0')).same, true);
      assert.equal((await w.get('votes=' + KEY + '&rev=-1')).error, 'rev');
      assert.equal((await w.get('votes=short')).error, 'key');
    });

    it('два голосующих видят голоса друг друга; переголосовать можно своим секретом', async () => {
      await w.post({ action: 'vote', key: KEY, voter: V('a1'), secret: 'secret-of-a1' });
      w.tick(1000);
      const b = await w.post({ action: 'vote', key: KEY, voter: V('b2', { o: [1, 2] }), secret: 'secret-of-b2' });
      assert.deepEqual(b.votes.map(v => v.id), ['a1', 'b2']);
      assert.equal(b.rev, 2);
      w.tick(1000);
      const again = await w.post({ action: 'vote', key: KEY, voter: V('a1', { n: 'Петя', y: 0, o: [] }), secret: 'secret-of-a1' });
      assert.equal(again.votes.length, 2);
      const a = again.votes.find(v => v.id === 'a1');
      assert.deepEqual([a.n, a.y, a.o], ['Петя', 0, []]);
      assert.equal(again.rev, 3);
    });

    it('чужой секрет не перезаписывает голос', async () => {
      await w.post({ action: 'vote', key: KEY, voter: V('a1'), secret: 'secret-of-a1' });
      const r = await w.post({ action: 'vote', key: KEY, voter: V('a1', { n: 'Взломщик' }), secret: 'secret-of-bad' });
      assert.equal(r.status, 403);
      assert.equal(r.error, 'owner');
      const cur = await w.get('votes=' + KEY);
      assert.equal(cur.votes[0].n, 'Имя a1');
      assert.equal(cur.rev, 1);
    });

    it('голоса из ссылки (seed) добавляются, только если такого id нет; первый со секретом их забирает', async () => {
      await w.post({ action: 'vote', key: KEY, voter: V('a1'), secret: 'secret-of-a1' });
      const r = await w.post({
        action: 'vote', key: KEY, voter: V('b2'), secret: 'secret-of-b2',
        seed: [V('a1', { n: 'Старое имя' }), V('c3', { t: 29_000_000 }), V('d4', { t: 9e15 }), V('b2', { n: 'сам себя' })],
      });
      const by = Object.fromEntries(r.votes.map(v => [v.id, v]));
      assert.deepEqual(Object.keys(by).sort(), ['a1', 'b2', 'c3', 'd4']);
      assert.equal(by.a1.n, 'Имя a1');                 // существующий не тронут
      assert.equal(by.b2.n, 'Имя b2');                 // свой голос важнее seed
      assert.equal(by.c3.t, 29_000_000 * 60000);       // минуты из старых ссылок → мс
      assert.ok(by.d4.t < w.clock.t);                  // будущее время не принимаем
      // c3 пришёл из ссылки без хозяина: первый, кто пишет с секретом, становится хозяином
      assert.equal((await w.post({ action: 'vote', key: KEY, voter: V('c3', { n: 'Я c3' }), secret: 'secret-of-c3' })).status, 200);
      assert.equal((await w.post({ action: 'vote', key: KEY, voter: V('c3'), secret: 'secret-other' })).error, 'owner');
    });

    it('не больше 60 голосующих; существующий может менять голос', async () => {
      const seed = Array.from({ length: 59 }, (_, i) => V('s' + i));
      const r = await w.post({ action: 'vote', key: KEY, voter: V('own'), secret: 'secret-own', seed });
      assert.equal(r.votes.length, 60);
      const full = await w.post({ action: 'vote', key: KEY, voter: V('late'), secret: 'secret-late' });
      assert.equal(full.status, 409);
      assert.equal(full.error, 'full');
      assert.equal((await w.post({ action: 'vote', key: KEY, voter: V('own', { o: [3] }), secret: 'secret-own' })).status, 200);
      assert.equal((await w.post({ action: 'vote', key: KEY, voter: V('s5', { o: [3] }), secret: 'secret-s5' })).status, 200);
    });

    it('проверка полей голоса', async () => {
      const cases = [
        [{ key: 'bad', voter: V('a'), secret: 'secret-123' }, 'key'],
        [{ key: KEY, voter: V('toolongvoterid1'), secret: 'secret-123' }, 'voter'],
        [{ key: KEY, voter: V('a', { o: [100] }), secret: 'secret-123' }, 'voter'],
        [{ key: KEY, voter: V('a', { o: [1.5] }), secret: 'secret-123' }, 'voter'],
        [{ key: KEY, voter: V('a', { d: Array.from({ length: 61 }, (_, i) => i) }), secret: 'secret-123' }, 'voter'],
        [{ key: KEY, voter: V('a', { y: 'yes' }), secret: 'secret-123' }, 'voter'],
        [{ key: KEY, voter: V('a', { n: 5 }), secret: 'secret-123' }, 'voter'],
        [{ key: KEY, voter: 'a', secret: 'secret-123' }, 'voter'],
        [{ key: KEY, voter: V('a'), secret: 'short' }, 'secret'],
        [{ key: KEY, voter: V('a'), secret: 'with space inside' }, 'secret'],
        [{ key: KEY, voter: V('a'), secret: 'secret-123', seed: 'x' }, 'seed'],
        [{ key: KEY, voter: V('a'), secret: 'secret-123', seed: [{ id: '!' }] }, 'voter'],
      ];
      for (const [b, code] of cases) {
        const r = await w.post({ action: 'vote', ...b });
        assert.equal(r.status, 400, JSON.stringify(b));
        assert.equal(r.error, code, JSON.stringify(b));
      }
      const r = await w.post({ action: 'vote', key: KEY, voter: V('a', { n: '  <b>Ва\u200Bся</b>\u0007  ' + 'ab'.repeat(20) }), secret: 'secret-123' });
      assert.equal(r.votes[0].n, 'Вася ' + 'ab'.repeat(20).slice(0, 25));
      assert.equal((await w.post({ action: 'vote', key: KEY, voter: V('b', { n: '' }), secret: 'secret-123' })).votes[1].n, '?');
    });

    it('колесо: первый результат остаётся, rev растёт, видно в опросе', async () => {
      await w.post({ action: 'vote', key: KEY, voter: V('a1'), secret: 'secret-of-a1' });
      const s1 = await w.post({ action: 'spin', key: KEY, result: { i: 2, d: 2481 } });
      assert.deepEqual([s1.spin.i, s1.spin.d, s1.rev], [2, 2481, 2]);
      assert.equal(s1.spin.t, w.clock.t);
      const s2 = await w.post({ action: 'spin', key: KEY, result: 5 });
      assert.deepEqual([s2.spin.i, s2.rev], [2, 2]);
      assert.equal((await w.get('votes=' + KEY + '&rev=1')).spin.i, 2);
      assert.equal((await w.post({ action: 'spin', key: KEY, result: 200 })).error, 'result');
      assert.equal((await w.post({ action: 'spin', key: KEY, result: { i: 'a' } })).error, 'result');
      const fresh = await w.post({ action: 'spin', key: KEY2, result: 0 });
      assert.deepEqual([fresh.spin.i, fresh.spin.d, fresh.rev], [0, null, 1]);
    });

    it('колесо по наборам лидеров: итог на каждый L, для L остаётся первый, spin в опросе — последний', async () => {
      await w.post({ action: 'vote', key: KEY, voter: V('a1'), secret: 'secret-of-a1' });
      const a = await w.post({ action: 'spin', key: KEY, result: { i: 2, d: 2481, L: '1,2' } });
      assert.equal(a.status, 200);
      assert.deepEqual(a.spin, { i: 2, d: 2481, t: w.clock.t, L: '1,2' });
      assert.deepEqual(a.spins, { '1,2': a.spin });
      assert.equal(a.rev, 2);
      w.tick(1000);
      const again = await w.post({ action: 'spin', key: KEY, result: { i: 1, L: '1,2' } });
      assert.deepEqual([again.spin, again.rev], [a.spin, 2]);             // первый итог для набора остаётся, rev не растёт
      // голоса поменялись — новая ничья, новый итог
      const b = await w.post({ action: 'spin', key: KEY, result: { i: 3, L: '0,3,17' } });
      assert.deepEqual([b.spin.i, b.spin.L, b.spin.d, b.rev], [3, '0,3,17', null, 3]);
      assert.deepEqual(Object.keys(b.spins).sort(), ['0,3,17', '1,2']);
      const poll = await w.get('votes=' + KEY + '&rev=2');
      assert.deepEqual([poll.rev, poll.spin], [3, b.spin]);
      assert.deepEqual(poll.spins, { '1,2': a.spin, '0,3,17': b.spin });
      assert.equal((await w.get('votes=' + KEY + '&rev=3')).same, true);
      // ничья вернулась к прежним лидерам: в ответе их итог, «последний» не меняется
      const back = await w.post({ action: 'spin', key: KEY, result: { i: 1, L: '1,2' } });
      assert.deepEqual([back.spin, back.rev], [a.spin, 3]);
      assert.deepEqual((await w.get('votes=' + KEY)).spin, b.spin);
      w.tick(1000);
      const v = await w.post({ action: 'vote', key: KEY, voter: V('b2'), secret: 'secret-of-b2' });
      assert.deepEqual([v.rev, v.spin, v.spins], [4, b.spin, poll.spins]);
    });

    it('колесо: старые клиенты без L и новые вместе', async () => {
      const legacy = await w.post({ action: 'spin', key: KEY, result: 4 });
      assert.deepEqual([legacy.spin, legacy.spins, legacy.rev], [{ i: 4, d: null, t: w.clock.t }, {}, 1]);
      w.tick(1000);
      const withL = await w.post({ action: 'spin', key: KEY, result: { i: 0, L: '0,4' } });
      assert.deepEqual([withL.spin.i, withL.spin.L, withL.rev], [0, '0,4', 2]);
      const poll = await w.get('votes=' + KEY);
      assert.deepEqual(poll.spin, withL.spin);                              // последний — с L
      assert.deepEqual(Object.keys(poll.spins), ['0,4']);                   // итог без L в карту не входит
      const legacy2 = await w.post({ action: 'spin', key: KEY, result: { i: 7, d: 2490, L: '' } });
      assert.deepEqual([legacy2.spin, legacy2.rev], [legacy.spin, 2]);      // без L — по-прежнему первый навсегда
      const legacy3 = await w.post({ action: 'spin', key: KEY, result: { i: 7, L: null } });
      assert.deepEqual(legacy3.spin, legacy.spin);
    });

    it('колесо: не больше 10 наборов лидеров, самый старый вытесняется', async () => {
      w.restart({ limits: { spin: [100, 600] } });
      for (let n = 0; n < 12; n++) {
        w.tick(10);
        const r = await w.post({ action: 'spin', key: KEY, result: { i: n, L: n + ',' + (n + 100) } });
        assert.deepEqual([r.status, r.rev, r.spin.i], [200, n + 1, n]);
        assert.equal(Object.keys(r.spins).length, Math.min(10, n + 1));
      }
      const poll = await w.get('votes=' + KEY);
      assert.deepEqual(Object.keys(poll.spins).sort(), Array.from({ length: 10 }, (_, k) => (k + 2) + ',' + (k + 102)).sort());
      assert.deepEqual([poll.spin.i, poll.spin.L], [11, '11,111']);
      // вытесненный набор записывается заново и сам вытесняет следующий по старшинству
      const again = await w.post({ action: 'spin', key: KEY, result: { i: 100, L: '0,100' } });
      assert.deepEqual([again.spin.i, again.rev, Object.keys(again.spins).length], [100, 13, 10]);
      assert.ok('0,100' in again.spins && !('2,102' in again.spins) && '3,103' in again.spins);
    });

    it('колесо: проверка набора лидеров', async () => {
      const max60 = Array.from({ length: 15 }, (_, k) => k + 100).join(',');   // 59 символов
      const over60 = Array.from({ length: 16 }, (_, k) => k + 100).join(',');  // 63 символа
      const cases = [
        { i: 1, L: 12 }, { i: 1, L: ['1', '2'] }, { i: 1, L: { a: 1 } }, { i: 2, L: '2,1' }, { i: 1, L: '1,1' }, { i: 1, L: '01,2' },
        { i: 1, L: '1, 2' }, { i: 1, L: '1,2,' }, { i: 1, L: ',1,2' }, { i: 1, L: '1;2' }, { i: 3, L: '1,2' }, { i: 1, L: '1,200' },
        { i: 1, L: '1,2000' }, { i: 1, L: '-1,1' }, { i: 100, L: over60 },
      ];
      for (const result of cases) {
        const r = await w.post({ action: 'spin', key: KEY, result });
        assert.deepEqual([r.status, r.error], [400, 'result'], JSON.stringify(result));
      }
      assert.equal((await w.get('votes=' + KEY)).rev, 0);                   // ничего не записалось
      const ok = await w.post({ action: 'spin', key: KEY, result: { i: 114, L: max60 } });
      assert.deepEqual([ok.status, ok.spin.L], [200, max60]);
      const one = await w.post({ action: 'spin', key: KEY, result: { i: 0, L: '0' } });
      assert.deepEqual([one.status, one.spin.L, one.rev], [200, '0', 2]);
    });
  });

  describe(`[${kind}] приглашения и «Мои приглашения»`, () => {
    let w;
    beforeEach(async () => { w = await world(kind); });
    afterEach(() => w.cleanup());

    it('регистрация идемпотентна, чужой владелец получает taken', async () => {
      const owner = ownerOf('creator-secret-1');
      assert.equal((await w.post({ action: 'invite', key: KEY, owner, mode: 'date', title: 'Свидание' })).status, 200);
      assert.equal((await w.post({ action: 'invite', key: KEY, owner, mode: 'date', title: 'Новое название' })).status, 200);
      const t = await w.post({ action: 'invite', key: KEY, owner: ownerOf('someone-else'), mode: 'date', title: 'Моё' });
      assert.deepEqual([t.status, t.error], [409, 'taken']);
      assert.equal((await w.post({ action: 'invite', key: KEY, owner, mode: 'party', title: '' })).error, 'mode');
      assert.equal((await w.post({ action: 'invite', key: KEY, owner: 'x', mode: 'date' })).error, 'owner');
    });

    it('открытия считаются по устройствам, ответ — последний, mine видит только владелец', async () => {
      const secret = 'creator-secret-1';
      await w.post({ action: 'invite', key: KEY, owner: ownerOf(secret), mode: 'date', title: 'Кино' });
      await w.post({ action: 'invite', key: KEY2, owner: ownerOf(secret), mode: 'guys', title: '' });
      const first = w.clock.t;
      await w.post({ action: 'opened', key: KEY, dev: dev(1) });
      w.tick(MIN);
      await w.post({ action: 'opened', key: KEY, dev: dev(1) });
      await w.post({ action: 'opened', key: KEY, dev: dev(2) });
      await w.post({ action: 'answer', key: KEY, answer: { yes: true, place: { emoji: '🎬', title: 'Кино', kind: '', plan: 'd-krasota' }, date: '2026-10-17', time: '19:30', food: [{ emoji: '🍕', title: 'Пицца' }], note: 'Жду!', junk: 'drop me' } });
      w.tick(MIN);
      await w.post({ action: 'answer', key: KEY, answer: { yes: true, date: '2026-10-18', time: '20:00', note: 'Лучше в субботу' } });
      await w.post({ action: 'vote', key: KEY2, voter: V('a1'), secret: 'secret-of-a1' });
      await w.post({ action: 'vote', key: KEY2, voter: V('b2'), secret: 'secret-of-b2' });

      const m = await w.post({ action: 'mine', ownerSecret: secret, keys: [KEY, KEY2, 'Q'.repeat(22)] });
      assert.equal(m.status, 200);
      assert.deepEqual(Object.keys(m.items).sort(), [KEY, KEY2].sort());
      const a = m.items[KEY];
      assert.deepEqual([a.mode, a.title, a.opened, a.firstOpen, a.votes], ['date', 'Кино', 2, first, 0]);
      assert.deepEqual(a.answer, { yes: true, date: '2026-10-18', time: '20:00', note: 'Лучше в субботу' });
      assert.equal(a.updated, w.clock.t);
      assert.deepEqual([m.items[KEY2].mode, m.items[KEY2].votes, m.items[KEY2].answer, m.items[KEY2].title], ['guys', 2, null, '']);
      const other = await w.post({ action: 'mine', ownerSecret: 'not-the-owner', keys: [KEY, KEY2] });
      assert.deepEqual(other.items, {});
      assert.ok(!w.bodies.some(b => b.includes(secret)));
    });

    it('проверка полей ответа и mine', async () => {
      const bads = [
        { yes: 'да' }, { date: '17.10.2026' }, { time: '25:00' }, { food: 'pizza' }, { food: new Array(13).fill('x') },
        { place: { plan: 'Bad Id' } }, { note: 'x'.repeat(1501) }, 'string',
      ];
      for (const answer of bads) assert.equal((await w.post({ action: 'answer', key: KEY, answer })).error, 'answer', JSON.stringify(answer));
      assert.equal((await w.post({ action: 'mine', ownerSecret: 'creator-secret-1', keys: new Array(51).fill(KEY) })).error, 'keys');
      assert.equal((await w.post({ action: 'mine', ownerSecret: 'creator-secret-1', keys: ['bad'] })).error, 'keys');
      assert.equal((await w.post({ action: 'mine', ownerSecret: 'x', keys: [] })).error, 'secret');
      assert.equal((await w.post({ action: 'opened', key: KEY, dev: 'bad dev' })).error, 'dev');
    });
  });

  describe(`[${kind}] отзывы и рейтинги`, () => {
    let w;
    const uids = { 'yandex-token-aaaaaa': '1001', 'yandex-token-bbbbbb': '1001', 'yandex-token-cccccc': '2002' };
    const fetch = async (url, init) => {
      assert.equal(url, 'https://login.yandex.ru/info?format=json');
      const tok = init.headers.Authorization.replace('OAuth ', '');
      return uids[tok] ? { ok: true, json: async () => ({ id: uids[tok], login: 'x' }) } : { ok: false, json: async () => ({}) };
    };
    beforeEach(async () => {
      w = await world(kind, { fetch });
      // отзывы и жалобы приходят от разных людей — у каждого устройства свой IP (если тест не задал другой)
      const post0 = w.post;
      w.post = (b, opt = {}) => post0(b, b && typeof b.dev === 'string' && !opt.ip ? { ...opt, ip: ipOf(Number(b.dev.slice(-6))) } : opt);
    });
    afterEach(() => w.cleanup());
    const R = (n, extra = {}) => ({ action: 'review', place: 'krasota', stars: 5, text: 'Очень уютное место, вкусно и спокойно', dev: dev(n), ...extra });

    it('отзыв публикуется сразу и попадает в список и рейтинг', async () => {
      const r = await w.post(R(1, { tags: ['cozy', 'first', 'cozy'], name: '  Аня  ', fit: 'date' }));
      assert.equal(r.pending, false);
      assert.deepEqual(r.item.tags, ['cozy', 'first']);
      assert.equal(r.item.name, 'Аня');
      assert.match(r.item.id, /^[0-9a-z]{9}[0-9A-Za-z]{4}$/);
      const list = await w.get('reviews=krasota');
      assert.deepEqual([list.total, list.items.length, list.items[0].text], [1, 1, 'Очень уютное место, вкусно и спокойно']);
      assert.ok(!('dev' in list.items[0]) && !('status' in list.items[0]) && !('yuid' in list.items[0]));
      const rt = await w.get('ratings=1');
      assert.deepEqual(rt.r.krasota, [5, 1, 5, null, 1, 0]);
      assert.equal(rt.at, w.clock.t);
      assert.match(rt.headers['Cache-Control'], /max-age=60/);
    });

    it('ссылки, @ники и телефоны вырезаются, отзыв уходит на проверку', async () => {
      const r = await w.post(R(1, { text: 'Отлично! Бронь через @kafe_bot или https://kafe.example/menu, тел. +7 999 123-45-67' }));
      assert.equal(r.pending, true);
      assert.equal(r.item.text, 'Отлично! Бронь через или, тел.');
      assert.equal((await w.get('reviews=krasota')).total, 0);
      assert.deepEqual((await w.get('ratings=1')).r, {});
    });

    it('короткий текст, капс и много мата — на проверку; одиночный мат маскируется', async () => {
      assert.equal((await w.post(R(1, { text: 'норм' }))).pending, true);
      assert.equal((await w.post(R(2, { text: 'УЖАСНОЕ МЕСТО НИКОМУ НЕ СОВЕТУЮ ВООБЩЕ' }))).pending, true);
      assert.equal((await w.post(R(3, { text: 'Блять, это пиздец какое место' }))).pending, true);
      const one = await w.post(R(4, { text: 'Сука, как же тут вкусно готовят, себе и друзьям советую' }));
      assert.equal(one.pending, false);
      assert.equal(one.item.text, 'С***, как же тут вкусно готовят, себе и друзьям советую');
      const empty = await w.post(R(5, { text: '', stars: 4 }));
      assert.equal(empty.pending, false);
    });

    it('один отзыв на место с устройства и с Яндекс ID', async () => {
      assert.equal((await w.post(R(1))).status, 200);
      const dup = await w.post(R(1, { stars: 1 }));
      assert.deepEqual([dup.status, dup.error], [409, 'dup']);
      assert.equal((await w.post(R(1, { place: 'single' }))).status, 200);
      const y1 = await w.post(R(2, { yandexToken: 'yandex-token-aaaaaa' }));
      assert.equal(y1.item.ver, true);
      assert.equal((await w.post(R(3, { yandexToken: 'yandex-token-bbbbbb' }))).error, 'dup');   // тот же uid, другое устройство
      assert.equal((await w.post(R(3, { yandexToken: 'yandex-token-cccccc' }))).status, 200);
      const anon = await w.post(R(4, { yandexToken: 'yandex-token-invalid' }));   // токен не подтвердился — как без него
      assert.equal(anon.status, 200);
      assert.equal(anon.item.ver, undefined);
    });

    it('проверка полей отзыва', async () => {
      const cases = [
        [{ stars: 0 }, 'stars'], [{ stars: 6 }, 'stars'], [{ stars: '5' }, 'stars'], [{ place: 'Bad Place' }, 'place'],
        [{ text: 'x'.repeat(1001) }, 'text'], [{ text: 5 }, 'text'], [{ tags: ['cozy', 'nope'] }, 'tags'],
        [{ tags: ['talk', 'cozy', 'loud', 'first', 'group', 'cheap'] }, 'tags'], [{ fit: 'party' }, 'fit'],
        [{ name: 'x'.repeat(121) }, 'name'], [{ dev: 'short' }, 'dev'], [{ yandexToken: 'bad token!' }, 'token'],
      ];
      for (const [extra, code] of cases) {
        const r = await w.post(R(9, extra));
        assert.equal(r.status, 400, JSON.stringify(extra));
        assert.equal(r.error, code, JSON.stringify(extra));
      }
      const long = await w.post(R(9, { text: 'а'.repeat(3) + ' ' + 'Хорошо. '.repeat(120) }));
      assert.ok(Array.from(long.item.text).length <= 600);
    });

    it('страницы по 10, before, total', async () => {
      const ids = [];
      for (let i = 0; i < 12; i++) {
        ids.push((await w.post(R(i, { stars: 1 + (i % 5) }))).item.id);
        w.tick(11 * MIN);
      }
      const p1 = await w.get('reviews=krasota');
      assert.equal(p1.total, 12);
      assert.deepEqual(p1.items.map(x => x.id), ids.slice(2).reverse());
      const p2 = await w.get('reviews=krasota&before=' + p1.items[9].id + '&limit=10');
      assert.deepEqual(p2.items.map(x => x.id), ids.slice(0, 2).reverse());
      assert.equal((await w.get('reviews=krasota&limit=21')).error, 'limit');
      assert.equal((await w.get('reviews=krasota&before=xx')).error, 'before');
      assert.equal((await w.get('reviews=nowhere')).total, 0);
    });

    it('волна отзывов на одно место за 10 минут уходит на проверку', async () => {
      const res = [];
      for (let i = 0; i < 7; i++) res.push((await w.post(R(i))).pending);
      assert.deepEqual(res, [false, false, false, false, false, true, true]);
    });

    it('рейтинг: средние для свидания и компании, кэш 5 минут, снимок в базе', async () => {
      await w.post(R(1, { stars: 5, fit: 'date' }));
      w.tick(11 * MIN);
      await w.post(R(2, { stars: 4, fit: 'date' }));
      w.tick(11 * MIN);
      await w.post(R(3, { stars: 2, fit: 'group' }));
      w.tick(11 * MIN);
      await w.post(R(4, { stars: 3, place: 'single' }));
      const a = await w.get('ratings=1');
      assert.deepEqual(a.r, { krasota: [3.7, 3, 4.5, 2, 2, 1], single: [3, 1, null, null, 0, 0] });
      await w.post(R(5, { stars: 1, place: 'single' }));
      w.tick(MIN);
      assert.deepEqual((await w.get('ratings=1')).r.single, [3, 1, null, null, 0, 0]);   // ещё кэш
      w.restart();                                                                  // новый экземпляр — читает снимок
      assert.equal((await w.get('ratings=1')).at, a.at);
      w.tick(5 * MIN);
      const b = await w.get('ratings=1');
      assert.deepEqual(b.r.single, [2, 2, null, null, 0, 0]);
      assert.equal(b.at, w.clock.t);
    });

    it('три жалобы от разных устройств прячут отзыв до проверки; модератор возвращает', async () => {
      const id = (await w.post(R(1))).item.id;
      await w.get('ratings=1');
      for (const n of [10, 10, 11]) { assert.equal((await w.post({ action: 'report', id, dev: dev(n), reason: 'спам' })).status, 200); w.tick(1000); }
      assert.equal((await w.get('reviews=krasota')).total, 1);       // две разные жалобы — ещё виден
      await w.post({ action: 'report', id, dev: dev(12), reason: '<b>грубость</b>' });
      assert.equal((await w.get('reviews=krasota')).total, 0);
      assert.deepEqual((await w.get('ratings=1')).r, {});
      assert.equal((await w.post({ action: 'report', id: '0000000000000', dev: dev(1) })).status, 404);
      assert.equal((await w.post({ action: 'report', id: 'nope', dev: dev(1) })).error, 'id');

      const { r: page, s } = await w.login();
      assert.equal(page.status, 200);
      assert.match(page.body, /Жалобы: [^<]*грубость/);
      assert.match(page.body, /Жалобы: [^<]*спам/);
      assert.doesNotMatch(page.body, /&lt;b&gt;/);
      const ok = await w.admin({ s, op: 'approve', id });
      assert.equal(ok.status, 200);
      assert.match(ok.body, /Отзыв опубликован/);
      assert.equal((await w.get('reviews=krasota')).total, 1);
      assert.deepEqual((await w.get('ratings=1')).r.krasota, [5, 1, null, null, 0, 0]);
      // те же жалобщики повторно ничего не меняют; нужно ещё три новых
      for (const n of [10, 11, 12, 13, 14]) await w.post({ action: 'report', id, dev: dev(n) });
      assert.equal((await w.get('reviews=krasota')).total, 1);
      await w.post({ action: 'report', id, dev: dev(15) });
      assert.equal((await w.get('reviews=krasota')).total, 0);
    });

    it('модератор находит все отзывы места и навсегда удаляет скрытый (просьба автора)', async () => {
      const a = (await w.post(R(1, { fit: 'date' }))).item.id;
      w.tick(11 * MIN);
      const b = (await w.post(R(2))).item.id;
      await w.post({ action: 'report', id: a, dev: dev(9), reason: 'это мой отзыв, удалите' });
      const { s } = await w.login();
      const list = await w.admin({ s, op: 'place', place: 'krasota' });
      assert.match(list.body, /Все отзывы места «krasota» \(2\)/);
      assert.match((await w.admin({ s, op: 'place', place: 'Bad Place' })).body, /Последние отзывы/);
      // опубликованный сразу не удаляется — сначала «Скрыть»
      assert.doesNotMatch((await w.admin({ s, op: 'delete', id: a })).body, /удалён навсегда/);
      assert.equal((await w.get('reviews=krasota')).total, 2);
      assert.match((await w.admin({ s, op: 'hide', id: a })).body, /Удалить навсегда/);
      assert.match((await w.admin({ s, op: 'delete', id: a })).body, /Отзыв удалён навсегда/);
      assert.equal(await w.store.review(a), null);
      assert.deepEqual((await w.get('reviews=krasota')).items.map(x => x.id), [b]);
      assert.doesNotMatch((await w.admin({ s, op: 'place', place: 'krasota' })).body, /это мой отзыв/);
      // запись «уже оставлял отзыв» тоже удалена: автор может написать заново
      w.tick(11 * MIN);
      assert.equal((await w.post(R(1, { stars: 3 }))).status, 200);
      assert.deepEqual((await w.get('ratings=1')).r.krasota, [4, 2, null, null, 0, 0]);
    });

    it('жалоба считается одна с IP и одна с устройства: выдуманные id не помогают', async () => {
      const id = (await w.post(R(1))).item.id;
      for (let n = 20; n < 26; n++) assert.equal((await w.post({ action: 'report', id, dev: dev(n), reason: 'спам' }, { ip: '10.7.7.7' })).status, 200);
      for (let i = 1; i < 5; i++) await w.post({ action: 'report', id, dev: dev(30), reason: 'спам' }, { ip: '10.8.0.' + i });
      assert.equal((await w.get('reviews=krasota')).total, 1);    // пока две жалобы: 10.7.7.7 и устройство 30
      await w.post({ action: 'report', id, dev: dev(31) }, { ip: '10.9.0.1' });
      assert.equal((await w.get('reviews=krasota')).total, 0);
    });

    it('с одного IP на одно место сразу публикуются два отзыва за сутки, остальные — через модератора', async () => {
      const res = [];
      for (let i = 0; i < 4; i++) { res.push((await w.post(R(40 + i), { ip: '10.6.6.6' })).pending); w.tick(11 * MIN); }
      assert.deepEqual(res, [false, false, true, true]);
      assert.equal((await w.post(R(50, { place: 'single' }), { ip: '10.6.6.6' })).pending, false);   // другое место — свой счётчик
      w.tick(DAY);
      assert.equal((await w.post(R(51), { ip: '10.6.6.6' })).pending, false);
    });
  });

  describe(`[${kind}] короткие ссылки и ошибки в каталоге`, () => {
    let w;
    beforeEach(async () => { w = await world(kind); });
    afterEach(() => w.cleanup());

    it('только адреса сайта; тот же адрес — тот же код; раскрытие; срок 180 дней', async () => {
      const url = ORIGIN + '/index.html#ABCDEF&v=k123';
      const a = await w.post({ action: 'short', url });
      assert.match(a.code, /^[A-Za-z0-9]{7}$/);
      assert.equal((await w.post({ action: 'short', url })).code, a.code);
      assert.equal((await w.get('s=' + a.code)).url, url);
      assert.equal((await w.post({ action: 'short', url: 'https://user.github.io/date-invite/start.html?x=1' })).status, 200);
      for (const bad of ['https://user.github.io/other/start.html', 'https://evil.example/', 'javascript:alert(1)', 'http://user:pw@localhost:8765/', 'https://localhost:8765/', 'not a url', 'https://user.github.io/date-invite-evil/']) {
        assert.equal((await w.post({ action: 'short', url: bad })).error, 'url', bad);
      }
      assert.equal((await w.get('s=zzzzzzz')).status, 404);
      assert.equal((await w.get('s=bad-code!')).error, 'code');
      w.tick(181 * DAY);
      assert.equal((await w.get('s=' + a.code)).status, 404);
      await w.store.cleanup(w.clock.t);
      const again = await w.post({ action: 'short', url });
      assert.equal(again.status, 200);
      assert.equal((await w.get('s=' + again.code)).url, url);
    });

    it('повторное сокращение продлевает срок; очистка удаляет просроченные ссылки и сообщения об ошибках', async () => {
      const url = ORIGIN + '/index.html#KEEP01';
      const a = await w.post({ action: 'short', url });
      w.tick(100 * DAY);
      assert.equal((await w.post({ action: 'short', url })).code, a.code);
      w.tick(100 * DAY);                                   // 200 дней от создания, 100 — от последнего сокращения
      assert.equal((await w.get('s=' + a.code)).url, url);
      assert.equal((await w.post({ action: 'fix', place: 'krasota', text: 'Переехали в соседний дом', dev: dev(1) })).status, 200);
      w.tick(181 * DAY);
      const c = await w.store.cleanup(w.clock.t);
      assert.ok(c.shorts >= 1, JSON.stringify(c));
      assert.equal(c.fixes, 0);
      assert.equal((await w.get('s=' + a.code)).status, 404);
      w.tick(185 * DAY);
      assert.equal((await w.store.cleanup(w.clock.t)).fixes, 1);
      assert.deepEqual(await w.store.fixList(10), []);
    });

    it('без SITE_ORIGINS сокращатель выключен', async () => {
      const x = await world(kind, { env: { SITE_ORIGINS: '' } });
      assert.equal((await x.post({ action: 'short', url: ORIGIN + '/' })).error, 'off');
      await x.cleanup();
    });

    it('сообщение об ошибке сохраняется для модерации', async () => {
      assert.equal((await w.post({ action: 'fix', place: 'krasota', text: 'Закрылись, теперь тут <i>"шаурма"</i> & кофе https://example.ru', dev: dev(1) })).status, 200);
      assert.equal((await w.post({ action: 'fix', place: 'krasota', text: ' a ', dev: dev(1) })).error, 'text');
      assert.equal((await w.post({ action: 'fix', place: 'Bad', text: 'текст ошибки', dev: dev(1) })).error, 'place');
      const { r: page, s } = await w.login({ path: '/?admin=1' });
      assert.equal(page.status, 200);
      assert.match(page.body, /action="\?admin=1"/);               // формы ведут туда же (Cloud Functions)
      assert.match(page.body, /Закрылись, теперь тут &quot;шаурма&quot; &amp; кофе https:\/\/example\.ru/);
      const id = page.body.match(/name="op" value="fixdone"><input type="hidden" name="id" value="([0-9A-Za-z]+)"/)[1];
      const done = await w.admin({ s, op: 'fixdone', id }, { path: '/?admin=1' });
      assert.equal(done.status, 200);
      assert.match(done.body, /Сообщение закрыто/);
      assert.doesNotMatch(done.body, /Закрылись/);
      assert.doesNotMatch((await w.admin({ s, op: 'view' }, { path: '/?admin=1' })).body, /Закрылись/);
    });
  });

  describe(`[${kind}] безопасность: лимиты, CORS, размер, /admin`, () => {
    it('лимит на приглашение хранится в базе: новый экземпляр функции тоже отказывает', async () => {
      const w = await world(kind, { limits: { vote: [3, 600] } });
      for (let i = 0; i < 3; i++) assert.equal((await w.post({ action: 'vote', key: KEY, voter: V('a' + i), secret: 'secret-123' })).status, 200);
      const r = await w.post({ action: 'vote', key: KEY, voter: V('x'), secret: 'secret-123' });
      assert.deepEqual([r.status, r.error, r.headers['Retry-After']], [429, 'rate', '60']);
      w.restart();
      assert.equal((await w.post({ action: 'vote', key: KEY, voter: V('y'), secret: 'secret-123' })).status, 429);
      assert.equal((await w.post({ action: 'vote', key: KEY2, voter: V('y'), secret: 'secret-123' })).status, 200);   // другой ключ — свой счётчик
      w.tick(10 * MIN);
      assert.equal((await w.post({ action: 'vote', key: KEY, voter: V('y'), secret: 'secret-123' })).status, 200);
      await w.cleanup();
    });

    it('лимит по IP на все запросы и на отзывы с устройства', async () => {
      const w = await world(kind, { limits: { ip: [5, 600], reviewDev: [2, 600] } });
      for (let i = 0; i < 5; i++) assert.equal((await w.get('ratings=1')).status, 200);
      assert.equal((await w.get('ratings=1')).status, 429);
      assert.equal((await w.get('ratings=1', { ip: '10.0.0.2' })).status, 200);
      const R = (place, ip) => w.post({ action: 'review', place, stars: 4, text: 'Хорошее место для прогулки', dev: dev(1) }, { ip });
      assert.equal((await R('a1', '10.1.0.1')).status, 200);
      assert.equal((await R('a2', '10.1.0.2')).status, 200);
      assert.equal((await R('a3', '10.1.0.3')).status, 429);     // устройство то же — IP не помогает
      await w.cleanup();
    });

    it('CORS: только разрешённые сайты; preflight', async () => {
      const w = await world(kind);
      const ok = await w.get('ratings=1');
      assert.equal(ok.headers['Access-Control-Allow-Origin'], ORIGIN);
      assert.equal(ok.headers.Vary, 'Origin');
      const evil = await w.get('ratings=1', { origin: 'https://evil.example' });
      assert.deepEqual([evil.status, evil.error, evil.headers['Access-Control-Allow-Origin']], [403, 'origin', undefined]);
      assert.equal((await w.post({ action: 'vote', key: KEY, voter: V('a'), secret: 'secret-123' }, { origin: 'null' })).status, 403);
      const none = await w.get('ratings=1', { origin: null });
      assert.equal(none.status, 200);
      assert.equal(none.headers['Access-Control-Allow-Origin'], undefined);
      const pre = await w.raw('OPTIONS', '/', { origin: 'https://kuda.example' });
      assert.equal(pre.status, 204);
      assert.equal(pre.headers['Access-Control-Allow-Origin'], 'https://kuda.example');
      assert.match(pre.headers['Access-Control-Allow-Methods'], /POST/);
      assert.equal((await w.raw('OPTIONS', '/', { origin: 'https://evil.example' })).status, 403);
      await w.cleanup();
    });

    it('тело больше 8 КБ, кривой JSON, неизвестное действие, метод', async () => {
      const w = await world(kind);
      const big = await w.post({ action: 'fix', place: 'krasota', dev: dev(1), text: 'x'.repeat(9000) });
      assert.deepEqual([big.status, big.error], [413, 'big']);
      assert.equal((await w.raw('POST', '/', { body: '{oops' })).status, 400);
      assert.equal(JSON.parse((await w.raw('POST', '/', { body: '{oops' })).body).error, 'json');
      for (const action of ['nope', '__proto__', 'constructor', 'toString', 5]) assert.equal((await w.post({ action })).error, 'action');
      assert.equal((await w.post([1, 2])).error, 'action');
      assert.equal((await w.raw('PUT', '/', { body: '{}' })).status, 405);
      const health = await w.get('');
      assert.deepEqual([health.status, health.ok, health.service], [200, true, 'kuda']);
      assert.ok(w.logs.length === 0, w.logs.join('\n'));
      await w.cleanup();
    });

    it('/admin: вход формой, сессия в скрытом поле, перебор, CSRF, чужой сайт', async () => {
      const w = await world(kind);
      const anon = await w.raw('GET', '/admin', { origin: null });
      assert.equal(anon.status, 200);
      assert.equal(anon.headers['WWW-Authenticate'], undefined);       // в Cloud Functions его всё равно переименуют
      assert.match(anon.body, /name="password"/);
      assert.match(anon.headers['Content-Security-Policy'], /default-src 'none'/);
      assert.doesNotMatch(anon.body, new RegExp(ADMIN));
      // заголовок Authorization не даёт входа (Cloud Functions его вырезает — полагаться на него нельзя)
      const hdr = await w.raw('GET', '/admin', { origin: null, headers: { Authorization: 'Bearer ' + ADMIN } });
      assert.doesNotMatch(hdr.body, /Ждут проверки/);
      const wrong = await w.login({ password: 'wrong-password-123' });
      assert.deepEqual([wrong.r.status, wrong.s], [401, '']);
      assert.match(wrong.r.body, /Пароль не подошёл/);
      const { r: ok, s } = await w.login();
      assert.equal(ok.status, 200);
      assert.match(ok.body, /Ждут проверки/);
      assert.match(s, /^[0-9a-z]+\.[0-9a-f]{40}$/);
      assert.doesNotMatch(ok.body, new RegExp(ADMIN));
      const id = (await w.post({ action: 'review', place: 'krasota', stars: 5, text: 'Смотрите сайт kafe.ru — там меню', dev: dev(1) })).item.id;
      // без сессии, с поддельной и с чужого сайта — ничего не меняется
      assert.equal((await w.admin({ op: 'approve', id })).status, 401);
      const [exp36, mac] = s.split('.');
      const forged = (parseInt(exp36, 36) + 3600e3).toString(36) + '.' + mac;
      assert.equal((await w.admin({ s: forged, op: 'approve', id })).status, 401);
      assert.equal((await w.admin({ s, op: 'approve', id }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
      assert.equal((await w.admin({ s, op: 'approve', id: 'nope' })).status, 400);
      assert.equal((await w.get('reviews=krasota')).total, 0);
      const ap = await w.admin({ s, op: 'approve', id }, { headers: { 'Sec-Fetch-Site': 'same-origin' } });
      assert.equal(ap.status, 200);
      assert.match(ap.body, /Отзыв опубликован/);
      assert.equal((await w.get('reviews=krasota')).total, 1);
      assert.equal((await w.admin({ s, op: 'reply', id, text: 'Спасибо! <b>Ждём</b> https://evil.example' })).status, 200);
      assert.equal((await w.get('reviews=krasota')).items[0].reply, 'Спасибо! Ждём');
      assert.equal((await w.admin({ s, op: 'hide', id })).status, 200);
      assert.equal((await w.get('reviews=krasota')).total, 0);
      assert.match((await w.admin({ s, op: 'recompute' })).body, /Рейтинги пересчитаны/);
      assert.deepEqual((await w.get('ratings=1')).r, {});
      assert.match((await w.admin({ s, op: 'cleanup' })).body, /Старые данные удалены/);
      assert.match((await w.admin({ s, op: 'logout' })).body, /Выход выполнен/);
      // сессия живёт 12 часов
      w.tick(12 * 3600e3 + 1000);
      const late = await w.admin({ s, op: 'view' });
      assert.equal(late.status, 401);
      assert.match(late.body, /Сессия закончилась/);
      // перебор: после 10 попыток за 10 минут с адреса не пускает даже с верным паролем
      for (let i = 0; i < 10; i++) await w.login({ ip: '10.9.9.9', password: 'guess-' + i + '-xxxxxxxx' });
      const blocked = await w.login({ ip: '10.9.9.9' });
      assert.deepEqual([blocked.r.status, blocked.s], [429, '']);
      assert.equal(blocked.r.headers['Retry-After'], '600');
      assert.equal((await w.login({ ip: '10.9.9.10' })).r.status, 200);
      w.tick(10 * 60e3);
      assert.equal((await w.login({ ip: '10.9.9.9' })).r.status, 200);
      assert.equal((await w.raw('PUT', '/admin', { origin: null })).status, 405);
      await w.cleanup();
      const off = await world(kind, { env: { ADMIN_TOKEN: 'short' } });
      assert.equal((await off.login({ password: 'short' })).r.status, 404);
      await off.cleanup();
    });
  });

  describe(`[${kind}] сроки хранения`, () => {
    it('голоса и ответы удаляются через 90 дней без изменений, активные живут', async () => {
      const w = await world(kind);
      await w.post({ action: 'vote', key: KEY, voter: V('a1'), secret: 'secret-of-a1' });
      await w.post({ action: 'opened', key: KEY, dev: dev(1) });
      await w.post({ action: 'invite', key: KEY2, owner: ownerOf('creator-secret-1'), mode: 'date', title: 'X' });
      w.tick(60 * DAY);
      await w.post({ action: 'answer', key: KEY2, answer: { yes: true } });
      w.tick(31 * DAY);
      const c = await w.store.cleanup(w.clock.t);
      assert.ok(c.invites >= 1);
      assert.deepEqual((await w.get('votes=' + KEY)).votes, []);
      assert.deepEqual(Object.keys((await w.post({ action: 'mine', ownerSecret: 'creator-secret-1', keys: [KEY2] })).items), [KEY2]);
      // открытие с того же устройства после удаления снова считается новым
      await w.post({ action: 'opened', key: KEY, dev: dev(1) });
      w.tick(60 * DAY);
      await w.store.cleanup(w.clock.t);
      assert.deepEqual((await w.post({ action: 'mine', ownerSecret: 'creator-secret-1', keys: [KEY2] })).items, {});
      await w.cleanup();
    });
  });
}

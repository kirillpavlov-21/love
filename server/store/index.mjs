/* Выбор хранилища по STORE=sqlite|ydb.
   Оба адаптера реализуют один интерфейс (все методы async, время — мс):
   init(), close()
   hit(counter, windowSec, now) → число запросов в текущем окне (счётчик живёт до конца окна)
   devSeen(devHash, now) → когда устройство пришло впервые
   vote(key, voter, ownerHash, seeds, {now, exp, max}) → {status:'ok'|'owner'|'full', votes, rev, spin, spins}
   votes(key) → {votes, rev, spin, spins} | null;  rev(key) → number | null
     spin — последний записанный итог колеса, spins — {L: итог} по наборам лидеров (lib/spins.mjs)
   spin(key, {i, d, t, L}, {now, exp, max}) → {spin, spins, rev} — spin здесь — итог для этого L: первый остаётся;
     хранится не больше max наборов лидеров, самый старый вытесняется; L '' — итог старого клиента
   invite(key, {owner, mode, title}, {now, exp}) → 'ok'|'taken'
   opened(key, devHash, {now, exp}) → true, если устройство открыло впервые
   answer(key, json, {now, exp});  invites(keys) → {key: {owner, mode, title, opened, firstOpen, cnt, answer, upd}}
   reviewAdd(rec, owners) → 'ok'|'dup';  reviews(place, before, limit) → {items, total};  review(id)
   reviewStatus(id, 'ok'|'pending'|'hidden', why) → rec | null;  reviewReply(id, text)
   reviewDelete(id) → true, если был — отзыв, жалобы и запись «уже оставлял» удаляются навсегда
   report(id, who[], reason, {now, threshold}) → {count, status} | null — жалоба считается, если никого из who ещё не было
   ratingsAgg() → [{place, sum, n, dsum, dn, gsum, gn}];  ratingsRebuild()
   snapshotGet(name) / snapshotPut(name, data, at) / snapshotDel(name)
   shortPut(url, urlHash, {now, exp, gen}) → code;  shortGet(code, now) → url | null
   fixAdd(rec), fixList(limit), fixDone(id);  pendingReviews(limit), latestReviews(limit), placeReviews(place, limit) — все статусы, stats(now)
   cleanup(now) → сколько удалено */
import { resolve } from 'node:path';

export async function createStore(env = process.env, extra = {}) {
  const kind = String(env.STORE || 'sqlite').toLowerCase();
  let store;
  if (kind === 'sqlite') {
    const { createSqliteStore } = await import('./sqlite.mjs');
    store = await createSqliteStore({ path: env.SQLITE_PATH === ':memory:' ? ':memory:' : resolve(env.SQLITE_PATH || './data/kuda.db') });
  } else if (kind === 'ydb') {
    const { createYdbStore } = await import('./ydb.mjs');
    store = await createYdbStore({
      endpoint: env.YDB_DOCAPI_ENDPOINT, region: env.YDB_REGION || 'ru-central1', prefix: env.YDB_TABLE_PREFIX || 'kuda_',
      accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, token: extra.token,
    });
  } else {
    throw new Error('STORE должен быть sqlite или ydb');
  }
  if (env.STORE_SKIP_INIT !== '1') await store.init();
  return store;
}

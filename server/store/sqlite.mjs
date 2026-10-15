/* Хранилище на SQLite (node:sqlite) — для своего сервера, Docker и локальной разработки.
   Один файл базы, WAL. Все многошаговые записи — в транзакции BEGIN IMMEDIATE.
   Интерфейс тот же, что у store/ydb.mjs (описан в store/index.mjs). */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { safeEqual } from '../lib/util.mjs';
import { spinList, spinAdd, spinView, MAX_SPINS } from '../lib/spins.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS inv (
  key TEXT PRIMARY KEY, rev INTEGER NOT NULL DEFAULT 0, cnt INTEGER NOT NULL DEFAULT 0, spin TEXT, spins TEXT,
  owner TEXT, mode TEXT, title TEXT, answer TEXT, opened INTEGER NOT NULL DEFAULT 0, fo INTEGER,
  upd INTEGER NOT NULL, exp INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS inv_exp ON inv(exp);
CREATE TABLE IF NOT EXISTS voters (
  key TEXT NOT NULL, id TEXT NOT NULL, n TEXT NOT NULL, y INTEGER NOT NULL, o TEXT NOT NULL, d TEXT NOT NULL,
  t INTEGER NOT NULL, h TEXT, PRIMARY KEY (key, id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS opens (key TEXT NOT NULL, dev TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (key, dev)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY, place TEXT NOT NULL, stars INTEGER NOT NULL, text TEXT NOT NULL, tags TEXT NOT NULL,
  name TEXT NOT NULL, fit TEXT NOT NULL, at INTEGER NOT NULL, status TEXT NOT NULL, why TEXT NOT NULL DEFAULT '',
  dev TEXT NOT NULL, yuid TEXT NOT NULL DEFAULT '', ver INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0, rbase INTEGER NOT NULL DEFAULT 0, reply TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS reviews_place ON reviews(place, status, id);
CREATE INDEX IF NOT EXISTS reviews_status ON reviews(status, id);
CREATE TABLE IF NOT EXISTS review_owners (place TEXT NOT NULL, who TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (place, who)) WITHOUT ROWID;
-- who: 'd:<хэш устройства>' или 'i:<хэш IP>' — одна жалоба на отзыв с устройства и с адреса
CREATE TABLE IF NOT EXISTS review_reports (id TEXT NOT NULL, who TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (id, who)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS snapshots (name TEXT PRIMARY KEY, data TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS shorts (code TEXT PRIMARY KEY, url TEXT NOT NULL, h TEXT NOT NULL UNIQUE, at INTEGER NOT NULL, exp INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS shorts_exp ON shorts(exp);
CREATE TABLE IF NOT EXISTS fixes (id TEXT PRIMARY KEY, place TEXT NOT NULL, text TEXT NOT NULL, dev TEXT NOT NULL, at INTEGER NOT NULL, exp INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS fixes_exp ON fixes(exp);
CREATE TABLE IF NOT EXISTS limits (k TEXT PRIMARY KEY, c INTEGER NOT NULL, exp INTEGER NOT NULL) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS limits_exp ON limits(exp);
CREATE TABLE IF NOT EXISTS devs (dev TEXT PRIMARY KEY, first INTEGER NOT NULL, exp INTEGER NOT NULL) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS devs_exp ON devs(exp);
`;

const DEV_TTL = 30 * 864e5;

const voterOut = r => ({ id: r.id, n: r.n, y: r.y, o: JSON.parse(r.o), d: JSON.parse(r.d), t: r.t });
const reviewOut = r => (!r ? null : {
  id: r.id, place: r.place, stars: r.stars, text: r.text, tags: JSON.parse(r.tags), name: r.name, fit: r.fit, at: r.at,
  status: r.status, why: r.why, dev: r.dev, yuid: r.yuid, ver: r.ver, reports: r.reports, rbase: r.rbase, reply: r.reply,
});

export async function createSqliteStore({ path }) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  // база старой версии: колонка spins (итоги колеса по наборам лидеров) появилась позже; spin — последний итог
  if (!db.prepare('PRAGMA table_info(inv)').all().some(c => c.name === 'spins')) {
    try { db.exec('ALTER TABLE inv ADD COLUMN spins TEXT'); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }   // второй процесс успел раньше
  }

  const q = {};
  const st = (name, sql) => (q[name] = db.prepare(sql));
  st('hit', 'INSERT INTO limits (k, c, exp) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET c = c + 1 RETURNING c');
  st('devSeen', 'INSERT INTO devs (dev, first, exp) VALUES (?, ?, ?) ON CONFLICT(dev) DO UPDATE SET exp = excluded.exp RETURNING first');
  st('invGet', 'SELECT * FROM inv WHERE key = ?');
  st('invNew', 'INSERT INTO inv (key, upd, exp) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING');
  st('invTouch', 'UPDATE inv SET upd = ?, exp = ? WHERE key = ?');
  st('invVote', 'UPDATE inv SET rev = rev + 1, cnt = ?, upd = ?, exp = ? WHERE key = ? RETURNING rev, spin, spins');
  st('invSpin', 'UPDATE inv SET spin = ?, spins = ?, rev = rev + 1, upd = ?, exp = ? WHERE key = ? RETURNING rev');
  st('invOwner', 'UPDATE inv SET owner = ?, mode = ?, title = ?, upd = ?, exp = ? WHERE key = ?');
  st('invOpened', 'UPDATE inv SET opened = opened + 1, fo = COALESCE(fo, ?), upd = ?, exp = ? WHERE key = ?');
  st('invAnswer', 'UPDATE inv SET answer = ?, upd = ?, exp = ? WHERE key = ?');
  st('voters', 'SELECT * FROM voters WHERE key = ? ORDER BY t, id');
  st('voterPut', `INSERT INTO voters (key, id, n, y, o, d, t, h) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key, id) DO UPDATE SET n = excluded.n, y = excluded.y, o = excluded.o, d = excluded.d, t = excluded.t, h = excluded.h`);
  st('voterSeed', 'INSERT INTO voters (key, id, n, y, o, d, t, h) VALUES (?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(key, id) DO NOTHING');
  st('openIns', 'INSERT INTO opens (key, dev, at) VALUES (?, ?, ?) ON CONFLICT(key, dev) DO NOTHING');
  st('ownerGet', 'SELECT id FROM review_owners WHERE place = ? AND who = ?');
  st('ownerIns', 'INSERT INTO review_owners (place, who, id) VALUES (?, ?, ?)');
  st('revIns', `INSERT INTO reviews (id, place, stars, text, tags, name, fit, at, status, why, dev, yuid, ver)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  st('revGet', 'SELECT * FROM reviews WHERE id = ?');
  st('revList', "SELECT * FROM reviews WHERE place = ? AND status = 'ok' AND id < ? ORDER BY id DESC LIMIT ?");
  st('revTotal', "SELECT COUNT(*) AS n FROM reviews WHERE place = ? AND status = 'ok'");
  st('revStatus', 'UPDATE reviews SET status = ?, why = ?, rbase = ? WHERE id = ? AND status = ?');
  st('revReply', 'UPDATE reviews SET reply = ? WHERE id = ?');
  st('revDel', 'DELETE FROM reviews WHERE id = ?');
  st('repDel', 'DELETE FROM review_reports WHERE id = ?');
  st('ownerDel', 'DELETE FROM review_owners WHERE place = ? AND id = ?');
  st('repHas', 'SELECT 1 AS x FROM review_reports WHERE id = ? AND who = ?');
  st('repIns', 'INSERT INTO review_reports (id, who, reason, at) VALUES (?, ?, ?, ?)');
  st('repInc', 'UPDATE reviews SET reports = reports + 1 WHERE id = ? RETURNING reports');
  st('repReasons', 'SELECT reason FROM review_reports WHERE id = ? AND reason <> \'\' ORDER BY at DESC LIMIT 5');
  st('agg', `SELECT place, SUM(stars) AS sum, COUNT(*) AS n,
      SUM(CASE WHEN fit = 'date' THEN stars ELSE 0 END) AS dsum, SUM(fit = 'date') AS dn,
      SUM(CASE WHEN fit = 'group' THEN stars ELSE 0 END) AS gsum, SUM(fit = 'group') AS gn
    FROM reviews WHERE status = 'ok' GROUP BY place`);
  st('snapGet', 'SELECT data, at FROM snapshots WHERE name = ?');
  st('snapPut', 'INSERT INTO snapshots (name, data, at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data, at = excluded.at');
  st('snapDel', 'DELETE FROM snapshots WHERE name = ?');
  st('shortByH', 'SELECT code, exp FROM shorts WHERE h = ?');
  st('shortGet', 'SELECT url FROM shorts WHERE code = ? AND exp > ?');
  st('shortCode', 'SELECT 1 FROM shorts WHERE code = ?');
  st('shortIns', 'INSERT INTO shorts (code, url, h, at, exp) VALUES (?, ?, ?, ?, ?)');
  st('shortExp', 'UPDATE shorts SET exp = ? WHERE code = ?');
  st('shortDel', 'DELETE FROM shorts WHERE code = ?');
  st('fixIns', 'INSERT INTO fixes (id, place, text, dev, at, exp) VALUES (?, ?, ?, ?, ?, ?)');
  st('fixList', 'SELECT id, place, text, at FROM fixes ORDER BY id DESC LIMIT ?');
  st('fixDel', 'DELETE FROM fixes WHERE id = ?');
  st('pending', "SELECT * FROM reviews WHERE status = 'pending' ORDER BY id DESC LIMIT ?");
  st('latest', 'SELECT * FROM reviews ORDER BY id DESC LIMIT ?');
  st('byPlace', 'SELECT * FROM reviews WHERE place = ? ORDER BY id DESC LIMIT ?');

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (e2) { /* уже откатили */ }
      throw e;
    }
  }
  const ensureInv = (key, now, exp) => q.invNew.run(key, now, exp);

  return {
    kind: 'sqlite',
    async init() {},
    async close() { db.close(); },

    /* ---------- лимиты и устройства ---------- */
    async hit(k, winSec, now) {
      const b = Math.floor(now / 1000 / winSec);
      return q.hit.get(k + '|' + b, (b + 1) * winSec * 1000 + 60e3).c;
    },
    async devSeen(dev, now) { return q.devSeen.get(dev, now, now + DEV_TTL).first; },

    /* ---------- голоса ---------- */
    async vote(key, voter, h, seeds, o) {
      return tx(() => {
        const cur = new Map(q.voters.all(key).map(r => [r.id, r]));
        const mine = cur.get(voter.id);
        if (mine && mine.h && !safeEqual(mine.h, h)) return { status: 'owner' };
        if (!mine && cur.size >= o.max) return { status: 'full' };
        ensureInv(key, o.now, o.exp);
        q.voterPut.run(key, voter.id, voter.n, voter.y, JSON.stringify(voter.o), JSON.stringify(voter.d), voter.t, h);
        cur.set(voter.id, true);
        for (const s of seeds) {
          if (cur.size >= o.max) break;
          if (cur.has(s.id)) continue;
          q.voterSeed.run(key, s.id, s.n, s.y, JSON.stringify(s.o), JSON.stringify(s.d), s.t);
          cur.set(s.id, true);
        }
        const r = q.invVote.get(cur.size, o.now, o.exp, key);
        return { status: 'ok', votes: q.voters.all(key).map(voterOut), rev: r.rev, ...spinView(spinList(r.spins, r.spin)) };
      });
    },
    async votes(key) {
      const inv = q.invGet.get(key);
      if (!inv) return null;
      return { votes: q.voters.all(key).map(voterOut), rev: inv.rev, ...spinView(spinList(inv.spins, inv.spin)) };
    },
    async rev(key) { const inv = q.invGet.get(key); return inv ? inv.rev : null; },
    async spin(key, spin, o) {
      return tx(() => {
        ensureInv(key, o.now, o.exp);
        const inv = q.invGet.get(key);
        const list = spinList(inv.spins, inv.spin);
        const next = spinAdd(list, spin, o.max || MAX_SPINS);
        if (!next) return { ...spinView(list, spin.L || ''), rev: inv.rev };     // для этого набора лидеров итог уже есть
        // spin — последний итог (его же читает прежняя версия сервера при откате), spins — весь список
        const r = q.invSpin.get(JSON.stringify(next[next.length - 1]), JSON.stringify(next), o.now, o.exp, key);
        return { ...spinView(next, spin.L || ''), rev: r.rev };
      });
    },

    /* ---------- приглашения ---------- */
    async invite(key, x, o) {
      return tx(() => {
        const inv = q.invGet.get(key);
        if (inv && inv.owner && !safeEqual(inv.owner, x.owner)) return 'taken';
        ensureInv(key, o.now, o.exp);
        q.invOwner.run(x.owner, x.mode, x.title, o.now, o.exp, key);
        return 'ok';
      });
    },
    async opened(key, dev, o) {
      return tx(() => {
        ensureInv(key, o.now, o.exp);
        if (!q.openIns.run(key, dev, o.now).changes) { q.invTouch.run(o.now, o.exp, key); return false; }
        q.invOpened.run(o.now, o.now, o.exp, key);
        return true;
      });
    },
    async answer(key, json, o) {
      tx(() => { ensureInv(key, o.now, o.exp); q.invAnswer.run(json, o.now, o.exp, key); });
    },
    async invites(keys) {
      const out = {};
      for (const k of keys) {
        const r = q.invGet.get(k);
        if (r) out[k] = { owner: r.owner || '', mode: r.mode || '', title: r.title || '', opened: r.opened, firstOpen: r.fo || null, cnt: r.cnt, answer: r.answer || '', upd: r.upd };
      }
      return out;
    },

    /* ---------- отзывы ---------- */
    async reviewAdd(rec, owners) {
      return tx(() => {
        if (owners.some(w => q.ownerGet.get(rec.place, w))) return 'dup';
        for (const w of owners) q.ownerIns.run(rec.place, w, rec.id);
        q.revIns.run(rec.id, rec.place, rec.stars, rec.text, JSON.stringify(rec.tags), rec.name, rec.fit, rec.at, rec.status, rec.why, rec.dev, rec.yuid, rec.ver);
        return 'ok';
      });
    },
    async reviews(place, before, limit) {
      const items = q.revList.all(place, before || '~', limit).map(reviewOut);
      return { items, total: q.revTotal.get(place).n };
    },
    async review(id) { return reviewOut(q.revGet.get(id)); },
    async reviewStatus(id, status, why = '') {
      return tx(() => {
        const r = q.revGet.get(id);
        if (!r) return null;
        if (r.status !== status) q.revStatus.run(status, status === 'ok' ? '' : why, status === 'ok' ? r.reports : r.rbase, id, r.status);
        return reviewOut(q.revGet.get(id));
      });
    },
    async reviewReply(id, text) { return q.revReply.run(text, id).changes > 0; },
    async reviewDelete(id) {
      return tx(() => {
        const r = q.revGet.get(id);
        if (!r) return false;
        q.ownerDel.run(r.place, id);
        q.repDel.run(id);
        q.revDel.run(id);
        return true;
      });
    },
    async report(id, who, reason, o) {
      return tx(() => {
        const r = q.revGet.get(id);
        if (!r) return null;
        if (who.some(w => q.repHas.get(id, w))) return { count: r.reports, status: r.status };
        who.forEach((w, i) => q.repIns.run(id, w, i ? '' : reason, o.now));
        const count = q.repInc.get(id).reports;
        let status = r.status;
        if (status === 'ok' && count - r.rbase >= o.threshold) {
          q.revStatus.run('pending', 'reports', r.rbase, id, 'ok');
          status = 'pending';
        }
        return { count, status };
      });
    },
    async ratingsAgg() { return q.agg.all().map(r => ({ place: r.place, sum: r.sum, n: r.n, dsum: r.dsum, dn: r.dn, gsum: r.gsum, gn: r.gn })); },
    async ratingsRebuild() { /* в SQLite рейтинг считается запросом — пересобирать нечего */ },
    async snapshotGet(name) { const r = q.snapGet.get(name); return r ? { data: JSON.parse(r.data), at: r.at } : null; },
    async snapshotPut(name, data, at) { q.snapPut.run(name, JSON.stringify(data), at); },
    async snapshotDel(name) { q.snapDel.run(name); },

    /* ---------- короткие ссылки ---------- */
    async shortPut(url, h, o) {
      return tx(() => {
        const ex = q.shortByH.get(h);
        if (ex && ex.exp > o.now) { q.shortExp.run(o.exp, ex.code); return ex.code; }
        if (ex) q.shortDel.run(ex.code);
        for (let i = 0; i < 8; i++) {
          const code = o.gen();
          if (q.shortCode.get(code)) continue;
          q.shortIns.run(code, url, h, o.now, o.exp);
          return code;
        }
        throw new Error('short: не удалось подобрать код');
      });
    },
    async shortGet(code, now) { const r = q.shortGet.get(code, now); return r ? r.url : null; },

    /* ---------- ошибки в каталоге ---------- */
    async fixAdd(f) { q.fixIns.run(f.id, f.place, f.text, f.dev, f.at, f.exp); },
    async fixList(limit) { return q.fixList.all(limit).map(r => ({ ...r })); },
    async fixDone(id) { return q.fixDel.run(id).changes > 0; },

    /* ---------- модерация ---------- */
    async pendingReviews(limit) {
      return q.pending.all(limit).map(r => ({ ...reviewOut(r), reasons: q.repReasons.all(r.id).map(x => x.reason) }));
    },
    async latestReviews(limit) { return q.latest.all(limit).map(reviewOut); },
    async placeReviews(place, limit) { return q.byPlace.all(place, limit).map(reviewOut); },
    async stats(now) {
      const one = sql => db.prepare(sql).get().n;
      const byStatus = {};
      for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM reviews GROUP BY status').all()) byStatus[r.status] = r.n;
      return {
        invites: one('SELECT COUNT(*) AS n FROM inv'),
        voters: one('SELECT COUNT(*) AS n FROM voters'),
        answers: one('SELECT COUNT(*) AS n FROM inv WHERE answer IS NOT NULL'),
        reviews: byStatus.ok || 0, pending: byStatus.pending || 0, hidden: byStatus.hidden || 0,
        places: one("SELECT COUNT(DISTINCT place) AS n FROM reviews WHERE status = 'ok'"),
        fixes: one('SELECT COUNT(*) AS n FROM fixes'),
        shorts: db.prepare('SELECT COUNT(*) AS n FROM shorts WHERE exp > ?').get(now).n,
        approx: false,
      };
    },

    /* ---------- срок хранения ---------- */
    async cleanup(now) {
      return tx(() => {
        const del = sql => db.prepare(sql).run(now).changes;
        const voters = del('DELETE FROM voters WHERE key IN (SELECT key FROM inv WHERE exp < ?)');
        const opens = del('DELETE FROM opens WHERE key IN (SELECT key FROM inv WHERE exp < ?)');
        return {
          invites: del('DELETE FROM inv WHERE exp < ?'), voters, opens,
          limits: del('DELETE FROM limits WHERE exp < ?'),
          devs: del('DELETE FROM devs WHERE exp < ?'),
          shorts: del('DELETE FROM shorts WHERE exp < ?'),
          fixes: del('DELETE FROM fixes WHERE exp < ?'),
        };
      });
    },
  };
}

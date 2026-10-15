/* Хранилище на YDB (Document API, совместим с DynamoDB) — для Yandex Cloud Functions, данные остаются в России.
   Подключение: endpoint из YDB_DOCAPI_ENDPOINT, регион ru-central1.
   Доступ: статический ключ сервисного аккаунта (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, подпись SigV4)
   или IAM-токен сервисного аккаунта функции (context.token) — заголовок «Authorization: Bearer».

   Таблицы (префикс YDB_TABLE_PREFIX, по умолчанию kuda_):
   inv   (pk = ключ приглашения, sk): 'm' — общее (rev, cnt, spin, spins, owner, mode, title, answer, opened, fo, upd, e;
                                      spins — JSON-список итогов колеса по наборам лидеров, spin — последний из них),
                                      'v#<id>' — голос (n, y, o, d, t, h), 'o#<dev>' — «открыл» с устройства.
   rev   (pk, sk): 'r'/<id> — отзыв целиком; 'p#<place>'/<id> — опубликованная копия для списка;
                   'q'/<id> — очередь модерации; 'u#<place>'/<d:dev|y:uid> — «один отзыв на устройство / Яндекс ID»;
                   'x#<id>'/<dev> — жалобы; 'a'/<place> — суммы для рейтинга; 'snap'/<name> — снимки; 'f'/<id> — ошибки в каталоге.
   short (pk): 's|<code>' → url, 'h|<hash url>' → code.
   lim   (pk): 'rl|<счётчик>|<окно>' — лимиты, 'dv|<dev>' — когда устройство пришло впервые.
   У записей с ограниченным сроком есть e — срок в мс; их удаляет cleanup() (таймер раз в сутки).
   В lim и short ещё и ttl — тот же срок в секундах Unix: init() включает по нему TTL YDB, и база сама
   удаляет счётчики (их много — суточная очистка за 10 секунд работы функции с ними бы не справилась).
   Просроченные счётчики лимитов до удаления не мешают: окно зашито в ключ. */
import {
  DynamoDBClient, ListTablesCommand, CreateTableCommand, DescribeTableCommand, DescribeTimeToLiveCommand, UpdateTimeToLiveCommand,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand, ScanCommand,
  BatchGetCommand, BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { spinList, spinAdd, spinView, MAX_SPINS } from '../lib/spins.mjs';

const DEV_TTL = 30 * 864e5;
const TTL_ATTR = 'ttl';
const sec = ms => Math.ceil(ms / 1000);

/* Подставляет ExpressionAttributeNames (#имя → имя) и оставляет только используемые :значения —
   DynamoDB и YDB ругаются на лишние. */
function ex(input, values = {}) {
  const text = [input.ConditionExpression, input.UpdateExpression, input.KeyConditionExpression, input.FilterExpression, input.ProjectionExpression].filter(Boolean).join(' ');
  const names = {};
  for (const m of text.match(/#[A-Za-z_][A-Za-z0-9_]*/g) || []) names[m] = m.slice(1);
  const vals = {};
  for (const m of text.match(/:[A-Za-z_][A-Za-z0-9_]*/g) || []) if (m in values) vals[m] = values[m];
  if (Object.keys(names).length) input.ExpressionAttributeNames = names;
  if (Object.keys(vals).length) input.ExpressionAttributeValues = vals;
  return input;
}
/* Пустые строки и null не храним */
function compact(item) {
  const out = {};
  for (const [k, v] of Object.entries(item)) if (v !== '' && v !== null && v !== undefined) out[k] = v;
  return out;
}
const isCond = e => e && (e.name === 'ConditionalCheckFailedException' || e.__type === 'ConditionalCheckFailedException' || /ConditionalCheckFailed/.test(e.name || ''));
const parse = (s, d = null) => { if (typeof s !== 'string' || !s) return d; try { return JSON.parse(s); } catch (e) { return d; } };
const chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };

const voterOut = it => ({ id: it.sk.slice(2), n: it.n || '', y: it.y ? 1 : 0, o: parse(it.o, []), d: parse(it.d, []), t: it.t || 0 });
const reviewOut = it => it && ({
  id: it.sk, place: it.place, stars: it.stars, text: it.text || '', tags: parse(it.tags, []), name: it.name || '', fit: it.fit || '',
  at: it.at, status: it.status, why: it.why || '', dev: it.dev || '', yuid: it.yuid || '', ver: it.ver ? 1 : 0,
  reports: it.reports || 0, rbase: it.rbase || 0, reply: it.reply || '',
});

/**
 * @param {object} o
 * @param {string} [o.endpoint] YDB_DOCAPI_ENDPOINT
 * @param {string} [o.region]
 * @param {string} [o.prefix] префикс таблиц
 * @param {string} [o.accessKeyId] @param {string} [o.secretAccessKey] статический ключ
 * @param {() => string} [o.token] IAM-токен (если статического ключа нет)
 * @param {{send: Function}} [o.doc] готовый клиент (тесты)
 */
export async function createYdbStore(o = {}) {
  let doc = o.doc, base = o.doc;
  if (!doc) {
    if (!o.endpoint) throw new Error('YDB_DOCAPI_ENDPOINT не задан');
    const keys = o.accessKeyId && o.secretAccessKey;
    base = new DynamoDBClient({
      region: o.region || 'ru-central1', endpoint: o.endpoint, maxAttempts: 3,
      credentials: keys ? { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey } : { accessKeyId: 'iam', secretAccessKey: 'iam' },
    });
    if (!keys) {
      if (!o.token) throw new Error('Нужен статический ключ (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY) или IAM-токен функции');
      // подпись SigV4 заменяем на IAM-токен уже после подписи, перед отправкой
      base.middlewareStack.add(next => async args => {
        const t = o.token();
        if (t && args.request && args.request.headers) {
          args.request.headers.authorization = 'Bearer ' + t;
          delete args.request.headers['x-amz-security-token'];
        }
        return next(args);
      }, { step: 'deserialize', name: 'kudaIamToken' });
    }
    doc = DynamoDBDocumentClient.from(base, { marshallOptions: { removeUndefinedValues: true } });
  }
  const P = o.prefix || 'kuda_';
  const T = { inv: P + 'inv', rev: P + 'rev', short: P + 'short', lim: P + 'lim' };
  const send = c => doc.send(c);

  const get = async (TableName, Key, extra = {}) => (await send(new GetCommand({ TableName, Key, ConsistentRead: true, ...extra }))).Item || null;
  const put = (TableName, Item, cond, values) => send(new PutCommand(ex({ TableName, Item: compact(Item), ConditionExpression: cond }, values)));
  const update = (TableName, Key, UpdateExpression, values, cond, ReturnValues = 'ALL_NEW') =>
    send(new UpdateCommand(ex({ TableName, Key, UpdateExpression, ConditionExpression: cond, ReturnValues }, values))).then(r => r.Attributes || {});
  const del = (TableName, Key) => send(new DeleteCommand({ TableName, Key }));
  async function queryAll(input, values, max = Infinity) {
    const out = [];
    let start;
    do {
      const r = await send(new QueryCommand(ex({ ...input, ExclusiveStartKey: start }, values)));
      out.push(...(r.Items || []));
      start = r.LastEvaluatedKey;
    } while (start && out.length < max);
    return out;
  }
  async function scanAll(input, values, max = Infinity) {
    const out = [];
    let start, pages = 0;
    do {
      const r = await send(new ScanCommand(ex({ ...input, ExclusiveStartKey: start }, values)));
      out.push(...(r.Items || []));
      start = r.LastEvaluatedKey;
    } while (start && out.length < max && ++pages < 1000);
    return { items: out, more: !!start };
  }
  async function batchDelete(TableName, keys, stop = () => false) {
    let n = 0;
    for (const part of chunk(keys, 25)) {
      if (stop()) break;
      let req = { [TableName]: part.map(Key => ({ DeleteRequest: { Key } })) };
      for (let i = 0; i < 5 && req && Object.keys(req).length; i++) {
        const r = await send(new BatchWriteCommand({ RequestItems: req }));
        req = r.UnprocessedItems && Object.keys(r.UnprocessedItems).length ? r.UnprocessedItems : null;
        if (req) await new Promise(res => setTimeout(res, 100 * (i + 1)));
      }
      n += part.length;
    }
    return n;
  }
  async function batchGet(TableName, keys) {
    const out = [];
    for (const part of chunk(keys, 100)) {
      let req = { [TableName]: { Keys: part, ConsistentRead: true } };
      for (let i = 0; i < 5 && req; i++) {
        const r = await send(new BatchGetCommand({ RequestItems: req }));
        out.push(...((r.Responses && r.Responses[TableName]) || []));
        req = r.UnprocessedKeys && r.UnprocessedKeys[TableName] ? r.UnprocessedKeys : null;
        if (req) await new Promise(res => setTimeout(res, 100 * (i + 1)));
      }
    }
    return out;
  }

  const meta = key => get(T.inv, { pk: key, sk: 'm' });
  const voters = key => queryAll({ TableName: T.inv, KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :v)', ConsistentRead: true }, { ':pk': key, ':v': 'v#' });
  const sortVotes = items => items.map(voterOut).sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  /* общий SET для записи «m»: продлить срок, завести счётчики */
  const TOUCH = '#upd = :now, #e = :exp, #rev = if_not_exists(#rev, :zero), #cnt = if_not_exists(#cnt, :zero)';

  /* ---------- рейтинг: суммы по месту ---------- */
  function aggDelta(rec, sign) {
    const v = { ':s': sign * rec.stars, ':n': sign };
    let expr = 'ADD #sum :s, #n :n';
    if (rec.fit === 'date') expr += ', #dsum :s, #dn :n';
    if (rec.fit === 'group') expr += ', #gsum :s, #gn :n';
    return update(T.rev, { pk: 'a', sk: rec.place }, expr, v, undefined, 'NONE');
  }
  const listing = rec => compact({
    pk: 'p#' + rec.place, sk: rec.id, stars: rec.stars, text: rec.text, tags: JSON.stringify(rec.tags || []), name: rec.name,
    fit: rec.fit, at: rec.at, reply: rec.reply, ver: rec.ver ? 1 : 0,
  });
  async function publish(rec) {
    await put(T.rev, listing(rec));
    await aggDelta(rec, 1);
    await del(T.rev, { pk: 'q', sk: rec.id });
  }
  async function unpublish(rec) {
    await del(T.rev, { pk: 'p#' + rec.place, sk: rec.id });
    await aggDelta(rec, -1);
  }

  const store = {
    kind: 'ydb',
    async init() {
      const have = new Set();
      let start;
      do {
        const r = await base.send(new ListTablesCommand({ ExclusiveStartTableName: start }));
        (r.TableNames || []).forEach(n => have.add(n));
        start = r.LastEvaluatedTableName;
      } while (start);
      const spec = [[T.inv, true], [T.rev, true], [T.short, false], [T.lim, false]];
      for (const [name, range] of spec) {
        if (have.has(name)) continue;
        await base.send(new CreateTableCommand({
          TableName: name, BillingMode: 'PAY_PER_REQUEST',
          KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }].concat(range ? [{ AttributeName: 'sk', KeyType: 'RANGE' }] : []),
          AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }].concat(range ? [{ AttributeName: 'sk', AttributeType: 'S' }] : []),
        }));
        for (let i = 0; i < 30; i++) {
          const d = await base.send(new DescribeTableCommand({ TableName: name }));
          if (!d.Table || d.Table.TableStatus === 'ACTIVE') break;
          await new Promise(res => setTimeout(res, 1000));
        }
      }
      // TTL для счётчиков и коротких ссылок. Не вышло — не страшно: их всё равно удаляет cleanup()
      store.ttlWarning = '';
      for (const name of [T.lim, T.short]) {
        try {
          const d = await base.send(new DescribeTimeToLiveCommand({ TableName: name }));
          const st = (d && d.TimeToLiveDescription) || {};
          if (st.AttributeName === TTL_ATTR && /^ENABL/.test(st.TimeToLiveStatus || '')) continue;
          await base.send(new UpdateTimeToLiveCommand({ TableName: name, TimeToLiveSpecification: { AttributeName: TTL_ATTR, Enabled: true } }));
        } catch (e) {
          store.ttlWarning += (store.ttlWarning ? '; ' : '') + name + ': ' + ((e && (e.name || e.message)) || 'ошибка');
        }
      }
    },
    async close() { if (base && base.destroy) base.destroy(); },

    /* ---------- лимиты и устройства ---------- */
    async hit(k, winSec, now) {
      const b = Math.floor(now / 1000 / winSec);
      const exp = (b + 1) * winSec * 1000 + 60e3;
      const a = await update(T.lim, { pk: 'rl|' + k + '|' + b }, 'ADD #c :one SET #e = :exp, #ttl = :ttl', { ':one': 1, ':exp': exp, ':ttl': sec(exp) }, undefined, 'UPDATED_NEW');
      return Number(a.c) || 1;
    },
    async devSeen(dev, now) {
      const a = await update(T.lim, { pk: 'dv|' + dev }, 'SET #first = if_not_exists(#first, :now), #e = :exp, #ttl = :ttl', { ':now': now, ':exp': now + DEV_TTL, ':ttl': sec(now + DEV_TTL) });
      return Number(a.first) || now;
    },

    /* ---------- голоса ----------
       Владение голосом — условной записью: новый голос (нет sk), голос из ссылки без хозяина (нет h) или тот же h. */
    async vote(key, voter, h, seeds, o) {
      const cur = new Map((await voters(key)).map(it => [it.sk.slice(2), it]));
      const mine = cur.get(voter.id);
      if (mine && mine.h && mine.h !== h) return { status: 'owner' };
      if (!mine && cur.size >= o.max) return { status: 'full' };
      try {
        await put(T.inv, { pk: key, sk: 'v#' + voter.id, n: voter.n, y: voter.y, o: JSON.stringify(voter.o), d: JSON.stringify(voter.d), t: voter.t, h },
          'attribute_not_exists(#sk) OR attribute_not_exists(#h) OR #h = :h', { ':h': h });
      } catch (e) {
        if (isCond(e)) return { status: 'owner' };
        throw e;
      }
      cur.set(voter.id, true);
      for (const s of seeds) {
        if (cur.size >= o.max) break;
        if (cur.has(s.id)) continue;
        try {
          await put(T.inv, { pk: key, sk: 'v#' + s.id, n: s.n, y: s.y, o: JSON.stringify(s.o), d: JSON.stringify(s.d), t: s.t }, 'attribute_not_exists(#sk)');
        } catch (e) { if (!isCond(e)) throw e; }
        cur.set(s.id, true);
      }
      const a = await update(T.inv, { pk: key, sk: 'm' }, 'SET #cnt = :cnt, #upd = :now, #e = :exp ADD #rev :one',
        { ':cnt': cur.size, ':now': o.now, ':exp': o.exp, ':one': 1 });
      return { status: 'ok', votes: sortVotes(await voters(key)), rev: Number(a.rev), ...spinView(spinList(a.spins, a.spin)) };
    },
    async votes(key) {
      const m = await meta(key);
      if (!m) return null;
      return { votes: sortVotes(await voters(key)), rev: Number(m.rev) || 0, ...spinView(spinList(m.spins, m.spin)) };
    },
    async rev(key) {
      const m = await get(T.inv, { pk: key, sk: 'm' }, { ProjectionExpression: '#rev', ExpressionAttributeNames: { '#rev': 'rev' } });
      return m ? Number(m.rev) || 0 : null;
    },
    /* Итог колеса для набора лидеров spin.L: прочитать список → дописать → записать условно
       («список не изменился с чтения»); кто-то успел раньше — читаем заново (первый итог для L остаётся). */
    async spin(key, spin, o) {
      const L = spin.L || '';
      for (let k = 0; k < 6; k++) {
        const m = await meta(key);
        const list = spinList(m && m.spins, m && m.spin);
        const next = spinAdd(list, spin, o.max || MAX_SPINS);
        if (!next) return { ...spinView(list, L), rev: Number(m && m.rev) || 0 };
        let cond = 'attribute_not_exists(#spins) AND attribute_not_exists(#spin)';
        let old;
        if (m && m.spins !== undefined) { cond = '#spins = :old'; old = m.spins; }
        else if (m && m.spin !== undefined) { cond = 'attribute_not_exists(#spins) AND #spin = :old'; old = m.spin; }   // запись старой версии
        try {
          const a = await update(T.inv, { pk: key, sk: 'm' }, 'SET #spin = :s, #spins = :list, #upd = :now, #e = :exp, #cnt = if_not_exists(#cnt, :zero) ADD #rev :one',
            { ':s': JSON.stringify(next[next.length - 1]), ':list': JSON.stringify(next), ':old': old, ':now': o.now, ':exp': o.exp, ':zero': 0, ':one': 1 }, cond);
          return { ...spinView(next, L), rev: Number(a.rev) };
        } catch (e) {
          if (!isCond(e)) throw e;
        }
      }
      const e = new Error('spin: список итогов меняется слишком часто');
      e.name = 'TransactionConflict';   // обработчик ответит 503 busy
      throw e;
    },

    /* ---------- приглашения ---------- */
    async invite(key, x, o) {
      try {
        await update(T.inv, { pk: key, sk: 'm' }, 'SET #owner = :owner, #mode = :mode, ' + (x.title ? '#title = :title, ' : '') + TOUCH + (x.title ? '' : ' REMOVE #title'),
          { ':owner': x.owner, ':mode': x.mode, ':title': x.title, ':now': o.now, ':exp': o.exp, ':zero': 0 },
          'attribute_not_exists(#owner) OR #owner = :owner', 'NONE');
        return 'ok';
      } catch (e) {
        if (isCond(e)) return 'taken';
        throw e;
      }
    },
    async opened(key, dev, o) {
      try {
        await put(T.inv, { pk: key, sk: 'o#' + dev, at: o.now }, 'attribute_not_exists(#sk)');
      } catch (e) {
        if (!isCond(e)) throw e;
        await update(T.inv, { pk: key, sk: 'm' }, 'SET ' + TOUCH, { ':now': o.now, ':exp': o.exp, ':zero': 0 }, undefined, 'NONE');
        return false;
      }
      await update(T.inv, { pk: key, sk: 'm' }, 'SET #fo = if_not_exists(#fo, :now), ' + TOUCH + ' ADD #opened :one',
        { ':now': o.now, ':exp': o.exp, ':zero': 0, ':one': 1 }, undefined, 'NONE');
      return true;
    },
    async answer(key, json, o) {
      await update(T.inv, { pk: key, sk: 'm' }, 'SET #answer = :a, ' + TOUCH, { ':a': json, ':now': o.now, ':exp': o.exp, ':zero': 0 }, undefined, 'NONE');
    },
    async invites(keys) {
      const out = {};
      for (const it of await batchGet(T.inv, keys.map(k => ({ pk: k, sk: 'm' })))) {
        out[it.pk] = {
          owner: it.owner || '', mode: it.mode || '', title: it.title || '', opened: Number(it.opened) || 0,
          firstOpen: it.fo ? Number(it.fo) : null, cnt: Number(it.cnt) || 0, answer: it.answer || '', upd: Number(it.upd) || 0,
        };
      }
      return out;
    },

    /* ---------- отзывы ---------- */
    async reviewAdd(rec, owners) {
      const done = [];
      for (const who of owners) {
        try {
          await put(T.rev, { pk: 'u#' + rec.place, sk: who, id: rec.id }, 'attribute_not_exists(#pk)');
          done.push(who);
        } catch (e) {
          for (const w of done) await del(T.rev, { pk: 'u#' + rec.place, sk: w });
          if (isCond(e)) return 'dup';
          throw e;
        }
      }
      await put(T.rev, {
        pk: 'r', sk: rec.id, place: rec.place, stars: rec.stars, text: rec.text, tags: JSON.stringify(rec.tags), name: rec.name,
        fit: rec.fit, at: rec.at, status: rec.status, why: rec.why, dev: rec.dev, yuid: rec.yuid, ver: rec.ver ? 1 : 0, reports: 0, rbase: 0,
      });
      if (rec.status === 'ok') await publish(rec);
      else await put(T.rev, { pk: 'q', sk: rec.id, place: rec.place });
      return 'ok';
    },
    async reviews(place, before, limit) {
      const r = await send(new QueryCommand(ex({
        TableName: T.rev, KeyConditionExpression: before ? '#pk = :pk AND #sk < :b' : '#pk = :pk', ScanIndexForward: false, Limit: limit,
      }, { ':pk': 'p#' + place, ':b': before })));
      const a = await get(T.rev, { pk: 'a', sk: place });
      const items = (r.Items || []).map(it => ({ ...reviewOut({ ...it, status: 'ok' }), place }));
      return { items, total: a ? Math.max(0, Number(a.n) || 0) : items.length };
    },
    async review(id) { return reviewOut(await get(T.rev, { pk: 'r', sk: id })); },
    async reviewStatus(id, status, why = '') {
      const rec = reviewOut(await get(T.rev, { pk: 'r', sk: id }));
      if (!rec) return null;
      if (rec.status === status) return rec;
      try {
        const w = status === 'ok' ? '' : why;
        await update(T.rev, { pk: 'r', sk: id }, 'SET #status = :s, #rbase = :rb' + (w ? ', #why = :why' : ' REMOVE #why'), {
          ':s': status, ':why': w, ':rb': status === 'ok' ? rec.reports : rec.rbase, ':old': rec.status,
        }, '#status = :old', 'NONE');
      } catch (e) {
        if (isCond(e)) return reviewOut(await get(T.rev, { pk: 'r', sk: id }));
        throw e;
      }
      if (rec.status === 'ok') await unpublish(rec);
      if (status === 'ok') await publish(rec);
      else if (status === 'pending') await put(T.rev, { pk: 'q', sk: id, place: rec.place });
      else await del(T.rev, { pk: 'q', sk: id });
      return { ...rec, status, why: status === 'ok' ? '' : why, rbase: status === 'ok' ? rec.reports : rec.rbase };
    },
    /* Удалить навсегда (просьба автора): сам отзыв, копию в списке, очередь, жалобы, «уже оставлял» */
    async reviewDelete(id) {
      const rec = reviewOut(await get(T.rev, { pk: 'r', sk: id }));
      if (!rec) return false;
      if (rec.status === 'ok') await unpublish(rec);
      await del(T.rev, { pk: 'q', sk: id });
      const reps = await queryAll({ TableName: T.rev, KeyConditionExpression: '#pk = :pk', ProjectionExpression: '#pk, #sk' }, { ':pk': 'x#' + id });
      const owners = await queryAll({ TableName: T.rev, KeyConditionExpression: '#pk = :pk', FilterExpression: '#id = :id', ProjectionExpression: '#pk, #sk' }, { ':pk': 'u#' + rec.place, ':id': id });
      await batchDelete(T.rev, reps.concat(owners).map(x => ({ pk: x.pk, sk: x.sk })));
      await del(T.rev, { pk: 'r', sk: id });
      return true;
    },
    async reviewReply(id, text) {
      const rec = reviewOut(await get(T.rev, { pk: 'r', sk: id }));
      if (!rec) return false;
      const expr = text ? 'SET #reply = :t' : 'REMOVE #reply';
      await update(T.rev, { pk: 'r', sk: id }, expr, { ':t': text }, undefined, 'NONE');
      if (rec.status === 'ok') {
        try { await update(T.rev, { pk: 'p#' + rec.place, sk: id }, expr, { ':t': text }, 'attribute_exists(#pk)', 'NONE'); } catch (e) { if (!isCond(e)) throw e; }
      }
      return true;
    },
    /* Жалоба считается, если никто из who (устройство, IP) на этот отзыв ещё не жаловался */
    async report(id, who, reason, o) {
      const rec = reviewOut(await get(T.rev, { pk: 'r', sk: id }));
      if (!rec) return null;
      const done = [];
      for (const w of who) {
        try {
          await put(T.rev, { pk: 'x#' + id, sk: w, reason: done.length ? '' : reason, at: o.now }, 'attribute_not_exists(#pk)');
          done.push(w);
        } catch (e) {
          for (const d of done) await del(T.rev, { pk: 'x#' + id, sk: d });
          if (isCond(e)) return { count: rec.reports, status: rec.status };
          throw e;
        }
      }
      const a = await update(T.rev, { pk: 'r', sk: id }, 'ADD #reports :one', { ':one': 1 });
      const count = Number(a.reports) || 1;
      let status = a.status;
      if (status === 'ok' && count - (Number(a.rbase) || 0) >= o.threshold) {
        status = (await store.reviewStatus(id, 'pending', 'reports')).status;
      }
      return { count, status };
    },
    async ratingsAgg() {
      const items = await queryAll({ TableName: T.rev, KeyConditionExpression: '#pk = :pk' }, { ':pk': 'a' });
      return items.map(it => ({
        place: it.sk, sum: Number(it.sum) || 0, n: Number(it.n) || 0, dsum: Number(it.dsum) || 0, dn: Number(it.dn) || 0,
        gsum: Number(it.gsum) || 0, gn: Number(it.gn) || 0,
      })).filter(r => r.n > 0);
    },
    /* Полный пересчёт сумм по опубликованным отзывам (кнопка в /admin) */
    async ratingsRebuild() {
      const all = await queryAll({ TableName: T.rev, KeyConditionExpression: '#pk = :pk' }, { ':pk': 'r' });
      const agg = new Map();
      for (const it of all) {
        if (it.status !== 'ok') continue;
        const a = agg.get(it.place) || { sum: 0, n: 0, dsum: 0, dn: 0, gsum: 0, gn: 0 };
        a.sum += it.stars; a.n++;
        if (it.fit === 'date') { a.dsum += it.stars; a.dn++; }
        if (it.fit === 'group') { a.gsum += it.stars; a.gn++; }
        agg.set(it.place, a);
      }
      const old = await queryAll({ TableName: T.rev, KeyConditionExpression: '#pk = :pk' }, { ':pk': 'a' });
      await batchDelete(T.rev, old.filter(it => !agg.has(it.sk)).map(it => ({ pk: 'a', sk: it.sk })));
      for (const [place, a] of agg) await put(T.rev, { pk: 'a', sk: place, ...a });
    },
    async snapshotGet(name) {
      const it = await get(T.rev, { pk: 'snap', sk: name });
      return it ? { data: parse(it.data), at: Number(it.at) } : null;
    },
    async snapshotPut(name, data, at) { await put(T.rev, { pk: 'snap', sk: name, data: JSON.stringify(data), at }); },
    async snapshotDel(name) { await del(T.rev, { pk: 'snap', sk: name }); },

    /* ---------- короткие ссылки ---------- */
    async shortPut(url, h, o) {
      const ex0 = await get(T.short, { pk: 'h|' + h });
      if (ex0 && Number(ex0.e) > o.now) {
        const s = await get(T.short, { pk: 's|' + ex0.code });
        if (s && s.url === url && Number(s.e) > o.now) {
          // ссылкой снова поделились — продлеваем срок обеим записям
          const v = { ':exp': o.exp, ':ttl': sec(o.exp) };
          await update(T.short, { pk: 's|' + ex0.code }, 'SET #e = :exp, #ttl = :ttl', v, undefined, 'NONE');
          await update(T.short, { pk: 'h|' + h }, 'SET #e = :exp, #ttl = :ttl', v, undefined, 'NONE');
          return ex0.code;
        }
      }
      for (let i = 0; i < 8; i++) {
        const code = o.gen();
        try {
          // занятый код можно переиспользовать, только если его срок уже вышел (запись ждёт удаления)
          await put(T.short, { pk: 's|' + code, url, at: o.now, e: o.exp, ttl: sec(o.exp) }, 'attribute_not_exists(#pk) OR #e < :now', { ':now': o.now });
        } catch (e) {
          if (isCond(e)) continue;
          throw e;
        }
        await put(T.short, { pk: 'h|' + h, code, e: o.exp, ttl: sec(o.exp) });
        return code;
      }
      throw new Error('short: не удалось подобрать код');
    },
    async shortGet(code, now) {
      const it = await get(T.short, { pk: 's|' + code });
      return it && Number(it.e) > now ? it.url : null;
    },

    /* ---------- ошибки в каталоге ---------- */
    async fixAdd(f) { await put(T.rev, { pk: 'f', sk: f.id, place: f.place, text: f.text, dev: f.dev, at: f.at, e: f.exp }); },
    async fixList(limit) {
      const r = await send(new QueryCommand(ex({ TableName: T.rev, KeyConditionExpression: '#pk = :pk', ScanIndexForward: false, Limit: limit }, { ':pk': 'f' })));
      return (r.Items || []).map(it => ({ id: it.sk, place: it.place, text: it.text || '', at: it.at }));
    },
    async fixDone(id) { await del(T.rev, { pk: 'f', sk: id }); return true; },

    /* ---------- модерация ---------- */
    async pendingReviews(limit) {
      const r = await send(new QueryCommand(ex({ TableName: T.rev, KeyConditionExpression: '#pk = :pk', ScanIndexForward: false, Limit: limit }, { ':pk': 'q' })));
      const ids = (r.Items || []).map(it => it.sk);
      if (!ids.length) return [];
      const recs = (await batchGet(T.rev, ids.map(id => ({ pk: 'r', sk: id })))).map(reviewOut).filter(x => x.status === 'pending');
      for (const rec of recs) {
        const rep = await send(new QueryCommand(ex({ TableName: T.rev, KeyConditionExpression: '#pk = :pk', Limit: 5 }, { ':pk': 'x#' + rec.id })));
        rec.reasons = (rep.Items || []).map(it => it.reason).filter(Boolean);
      }
      return recs.sort((a, b) => (a.id < b.id ? 1 : -1));
    },
    /* Все отзывы места в любом статусе (для модератора): фильтр по разделу 'r', новые сверху */
    async placeReviews(place, limit) {
      const items = await queryAll({ TableName: T.rev, KeyConditionExpression: '#pk = :pk', FilterExpression: '#place = :p', ScanIndexForward: false }, { ':pk': 'r', ':p': place }, limit);
      return items.slice(0, limit).map(reviewOut);
    },
    async latestReviews(limit) {
      const r = await send(new QueryCommand(ex({ TableName: T.rev, KeyConditionExpression: '#pk = :pk', ScanIndexForward: false, Limit: limit }, { ':pk': 'r' })));
      return (r.Items || []).map(reviewOut);
    },
    async stats(now) {
      const CAP = 5000;   // страница модерации не должна сканировать всю базу
      const revs = await queryAll({ TableName: T.rev, KeyConditionExpression: '#pk = :pk', ProjectionExpression: '#sk, #status' }, { ':pk': 'r' }, CAP);
      const by = {};
      for (const it of revs) by[it.status] = (by[it.status] || 0) + 1;
      const places = await queryAll({ TableName: T.rev, KeyConditionExpression: '#pk = :pk', ProjectionExpression: '#sk, #n' }, { ':pk': 'a' }, CAP);
      const fixes = await queryAll({ TableName: T.rev, KeyConditionExpression: '#pk = :pk', ProjectionExpression: '#sk' }, { ':pk': 'f' }, CAP);
      const inv = await scanAll({ TableName: T.inv, FilterExpression: '#sk = :m', ProjectionExpression: '#pk, #cnt, #answer' }, { ':m': 'm' }, CAP);
      const shorts = await scanAll({ TableName: T.short, FilterExpression: 'begins_with(#pk, :s) AND #e > :now', ProjectionExpression: '#pk' }, { ':s': 's|', ':now': now }, CAP);
      return {
        invites: inv.items.length, voters: inv.items.reduce((s, it) => s + (Number(it.cnt) || 0), 0),
        answers: inv.items.filter(it => it.answer).length,
        reviews: by.ok || 0, pending: by.pending || 0, hidden: by.hidden || 0,
        places: places.filter(it => Number(it.n) > 0).length, fixes: fixes.length, shorts: shorts.items.length,
        approx: inv.more || shorts.more || revs.length >= CAP,
      };
    },

    /* ---------- срок хранения: за один запуск не больше budget удалений и не дольше ~7 с
       (таймер вызывает ту же функцию с таймаутом 10 с; что не успели — удалится в следующий раз) ---------- */
    async cleanup(now, budget = 5000, timeMs = 7000) {
      const until = Date.now() + timeMs;
      const late = () => Date.now() > until;
      const out = { invites: 0, items: 0, limits: 0, shorts: 0, fixes: 0, more: false };
      const old = await scanAll({ TableName: T.inv, FilterExpression: '#sk = :m AND #e < :now', ProjectionExpression: '#pk' }, { ':m': 'm', ':now': now }, budget);
      for (const it of old.items) {
        if (out.items >= budget || late()) { out.more = true; break; }
        const all = await queryAll({ TableName: T.inv, KeyConditionExpression: '#pk = :pk', ProjectionExpression: '#pk, #sk' }, { ':pk': it.pk });
        // «m» удаляем последним: если запуск оборвётся, ключ найдётся в следующий раз
        const keys = all.filter(x => x.sk !== 'm').map(x => ({ pk: x.pk, sk: x.sk })).concat([{ pk: it.pk, sk: 'm' }]);
        out.items += await batchDelete(T.inv, keys);
        out.invites++;
      }
      // ошибки в каталоге и короткие ссылки — их немного; счётчики лимитов обычно уже удалил TTL
      const fx = await queryAll({ TableName: T.rev, KeyConditionExpression: '#pk = :pk', FilterExpression: '#e < :now', ProjectionExpression: '#pk, #sk' }, { ':pk': 'f', ':now': now }, budget);
      out.fixes = await batchDelete(T.rev, fx.map(x => ({ pk: x.pk, sk: x.sk })), late);
      if (!late()) {
        const sh = await scanAll({ TableName: T.short, FilterExpression: '#e < :now', ProjectionExpression: '#pk' }, { ':now': now }, budget);
        out.shorts = await batchDelete(T.short, sh.items.map(x => ({ pk: x.pk })), late);
      }
      if (!late()) {
        const lim = await scanAll({ TableName: T.lim, FilterExpression: '#e < :now', ProjectionExpression: '#pk' }, { ':now': now }, budget);
        out.limits = await batchDelete(T.lim, lim.items.map(x => ({ pk: x.pk })), late);
      }
      if (late()) out.more = true;
      return out;
    },
  };
  return store;
}

/* Поддельный DynamoDB/YDB Document API в памяти — для тестов store/ydb.mjs.
   Принимает те же команды (@aws-sdk/lib-dynamodb и client-dynamodb), разбирает выражения
   (ConditionExpression, UpdateExpression, KeyConditionExpression, FilterExpression, ProjectionExpression)
   и, как настоящий сервис, ругается на неиспользованные ExpressionAttributeNames/Values. */

class AwsError extends Error {
  constructor(name, msg) { super(msg || name); this.name = name; this.__type = name; }
}
const clone = v => (v === undefined ? undefined : structuredClone(v));

/* ---------- разбор выражений ---------- */
function tokenize(s) {
  const out = [];
  const re = /\s*(<>|<=|>=|=|<|>|\(|\)|,|\+|-|#[A-Za-z0-9_]+|:[A-Za-z0-9_]+|[A-Za-z_][A-Za-z0-9_.]*)/y;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < s.length) {
    if (/^\s*$/.test(s.slice(re.lastIndex))) break;
    m = re.exec(s);
    if (!m) throw new AwsError('ValidationException', 'Invalid expression near: ' + s.slice(re.lastIndex));
    out.push(m[1]);
  }
  return out;
}

class Expr {
  constructor(text, names, values, used) {
    this.t = tokenize(text);
    this.i = 0;
    this.names = names || {};
    this.values = values || {};
    this.used = used;
  }
  peek() { return this.t[this.i]; }
  next() { return this.t[this.i++]; }
  eat(tok) { if (this.t[this.i] !== tok) throw new AwsError('ValidationException', `Expected ${tok}, got ${this.t[this.i]}`); this.i++; }
  isKw(tok, kw) { return typeof tok === 'string' && tok.toUpperCase() === kw; }
  path() {
    const tok = this.next();
    if (tok && tok[0] === '#') {
      if (!(tok in this.names)) throw new AwsError('ValidationException', 'Unknown name ' + tok);
      this.used.names.add(tok);
      return this.names[tok];
    }
    if (!tok || !/^[A-Za-z_]/.test(tok)) throw new AwsError('ValidationException', 'Bad path ' + tok);
    return tok;
  }
  operand() {
    const tok = this.peek();
    if (tok && tok[0] === ':') {
      this.next();
      if (!(tok in this.values)) throw new AwsError('ValidationException', 'Unknown value ' + tok);
      this.used.values.add(tok);
      const v = this.values[tok];
      return () => v;
    }
    const p = this.path();
    return item => item[p];
  }
  // condition
  cond() {
    let left = this.and();
    while (this.isKw(this.peek(), 'OR')) { this.next(); const l = left, r = this.and(); left = it => l(it) || r(it); }
    return left;
  }
  and() {
    let left = this.not();
    while (this.isKw(this.peek(), 'AND')) { this.next(); const l = left, r = this.not(); left = it => l(it) && r(it); }
    return left;
  }
  not() {
    if (this.isKw(this.peek(), 'NOT')) { this.next(); const f = this.not(); return it => !f(it); }
    return this.primary();
  }
  primary() {
    const tok = this.peek();
    if (tok === '(') { this.next(); const f = this.cond(); this.eat(')'); return f; }
    if (tok === 'attribute_exists' || tok === 'attribute_not_exists') {
      this.next(); this.eat('('); const p = this.path(); this.eat(')');
      return tok === 'attribute_exists' ? it => it[p] !== undefined : it => it[p] === undefined;
    }
    if (tok === 'begins_with') {
      this.next(); this.eat('('); const p = this.path(); this.eat(','); const v = this.operand(); this.eat(')');
      return it => typeof it[p] === 'string' && it[p].startsWith(v(it));
    }
    const a = this.operand();
    const op = this.next();
    if (this.isKw(op, 'BETWEEN')) {
      const lo = this.operand(); if (!this.isKw(this.next(), 'AND')) throw new AwsError('ValidationException', 'BETWEEN');
      const hi = this.operand();
      return it => { const x = a(it); return x !== undefined && x >= lo(it) && x <= hi(it); };
    }
    const b = this.operand();
    const cmp = {
      '=': (x, y) => x === y, '<>': (x, y) => x !== y, '<': (x, y) => x < y, '<=': (x, y) => x <= y, '>': (x, y) => x > y, '>=': (x, y) => x >= y,
    }[op];
    if (!cmp) throw new AwsError('ValidationException', 'Bad comparator ' + op);
    return it => { const x = a(it), y = b(it); if (op !== '<>' && (x === undefined || y === undefined)) return false; return cmp(x, y); };
  }
  done() { if (this.i !== this.t.length) throw new AwsError('ValidationException', 'Trailing tokens: ' + this.t.slice(this.i).join(' ')); }
  // update
  update() {
    const acts = [];
    while (this.i < this.t.length) {
      const kw = this.next().toUpperCase();
      if (kw === 'SET') {
        do {
          const p = this.path(); this.eat('=');
          let val;
          if (this.peek() === 'if_not_exists') {
            this.next(); this.eat('('); const q = this.path(); this.eat(','); const d = this.operand(); this.eat(')');
            val = it => (it[q] !== undefined ? it[q] : d(it));
          } else {
            const x = this.operand();
            if (this.peek() === '+' || this.peek() === '-') {
              const sign = this.next() === '+' ? 1 : -1; const y = this.operand();
              val = it => x(it) + sign * y(it);
            } else val = x;
          }
          acts.push(it => { it[p] = clone(val(it)); });
        } while (this.peek() === ',' && this.next());
      } else if (kw === 'ADD') {
        do {
          const p = this.path(); const v = this.operand();
          acts.push(it => {
            const add = v(it);
            if (typeof add !== 'number') throw new AwsError('ValidationException', 'ADD supports numbers only here');
            if (it[p] !== undefined && typeof it[p] !== 'number') throw new AwsError('ValidationException', 'ADD on non-number');
            it[p] = (it[p] || 0) + add;
          });
        } while (this.peek() === ',' && this.next());
      } else if (kw === 'REMOVE') {
        do { const p = this.path(); acts.push(it => { delete it[p]; }); } while (this.peek() === ',' && this.next());
      } else throw new AwsError('ValidationException', 'Bad update clause ' + kw);
    }
    return item => { for (const a of acts) a(item); };
  }
}

function checkUsed(input, used) {
  for (const k of Object.keys(input.ExpressionAttributeNames || {})) if (!used.names.has(k)) throw new AwsError('ValidationException', 'Value provided in ExpressionAttributeNames unused in expressions: ' + k);
  for (const k of Object.keys(input.ExpressionAttributeValues || {})) if (!used.values.has(k)) throw new AwsError('ValidationException', 'Value provided in ExpressionAttributeValues unused in expressions: ' + k);
}
function compile(input, field, used, kind = 'cond') {
  const text = input[field];
  if (!text) return null;
  const e = new Expr(text, input.ExpressionAttributeNames, input.ExpressionAttributeValues, used);
  const f = kind === 'update' ? e.update() : e.cond();
  e.done();
  return f;
}
function projection(input, used) {
  if (!input.ProjectionExpression) return null;
  return input.ProjectionExpression.split(',').map(s => {
    const tok = s.trim();
    if (tok[0] === '#') {
      if (!(tok in (input.ExpressionAttributeNames || {}))) throw new AwsError('ValidationException', 'Unknown name ' + tok);
      used.names.add(tok);
      return input.ExpressionAttributeNames[tok];
    }
    return tok;
  });
}
const project = (item, attrs) => {
  if (!attrs) return clone(item);
  const o = {};
  for (const a of attrs) if (item[a] !== undefined) o[a] = clone(item[a]);
  return o;
};

/* ---------- сам «сервис» ---------- */
export class FakeDynamo {
  constructor({ pageSize = 7 } = {}) {
    this.tables = new Map();   // name → {hash, range, items: Map}
    this.pageSize = pageSize;  // маленькие страницы — проверяем, что код листает LastEvaluatedKey
    this.calls = [];
    this.failNext = null;      // имя ошибки для следующего вызова (тест отказов)
  }
  table(name) {
    const t = this.tables.get(name);
    if (!t) throw new AwsError('ResourceNotFoundException', 'Table not found: ' + name);
    return t;
  }
  keyOf(t, key) {
    if (typeof key[t.hash] !== 'string' || (t.range && typeof key[t.range] !== 'string')) throw new AwsError('ValidationException', 'Missing key');
    const extra = Object.keys(key).filter(k => k !== t.hash && k !== t.range);
    if (extra.length) throw new AwsError('ValidationException', 'Key has extra attributes');
    return t.range ? key[t.hash] + '\u0000' + key[t.range] : key[t.hash];
  }
  sorted(t) {
    return Array.from(t.items.values()).sort((a, b) => (a[t.hash] < b[t.hash] ? -1 : a[t.hash] > b[t.hash] ? 1 : t.range ? (a[t.range] < b[t.range] ? -1 : a[t.range] > b[t.range] ? 1 : 0) : 0));
  }
  validateItem(item, t) {
    // TTL-атрибут — число секунд Unix (мс сюда попадать не должны: запись «жила» бы тысячи лет)
    if (t && t.ttl && item[t.ttl] !== undefined && !(typeof item[t.ttl] === 'number' && item[t.ttl] > 1e9 && item[t.ttl] < 1e11)) {
      throw new AwsError('ValidationException', 'TTL attribute must be Unix seconds');
    }
    for (const [k, v] of Object.entries(item)) {
      if (v === '' ) throw new AwsError('ValidationException', `Empty string for ${k} (store должен такие поля опускать)`);
      if (v === null || v === undefined) throw new AwsError('ValidationException', `null for ${k}`);
      if (typeof v === 'number' && !Number.isFinite(v)) throw new AwsError('ValidationException', `Bad number ${k}`);
    }
    if (JSON.stringify(item).length > 400 * 1024) throw new AwsError('ValidationException', 'Item too large');
  }

  async send(cmd) {
    const name = cmd.constructor.name;
    const input = cmd.input || {};
    this.calls.push(name);
    if (this.failNext) { const e = this.failNext; this.failNext = null; throw new AwsError(e, 'injected'); }
    const used = { names: new Set(), values: new Set() };
    switch (name) {
      case 'ListTablesCommand': return { TableNames: Array.from(this.tables.keys()) };
      case 'CreateTableCommand': {
        if (this.tables.has(input.TableName)) throw new AwsError('ResourceInUseException');
        const hash = input.KeySchema.find(k => k.KeyType === 'HASH').AttributeName;
        const r = input.KeySchema.find(k => k.KeyType === 'RANGE');
        this.tables.set(input.TableName, { hash, range: r ? r.AttributeName : null, items: new Map() });
        return { TableDescription: { TableStatus: 'ACTIVE' } };
      }
      case 'DescribeTableCommand': this.table(input.TableName); return { Table: { TableStatus: 'ACTIVE' } };
      case 'DescribeTimeToLiveCommand': {
        const t = this.table(input.TableName);
        return { TimeToLiveDescription: t.ttl ? { TimeToLiveStatus: 'ENABLED', AttributeName: t.ttl } : { TimeToLiveStatus: 'DISABLED' } };
      }
      case 'UpdateTimeToLiveCommand': {
        const t = this.table(input.TableName);
        const spec = input.TimeToLiveSpecification || {};
        if (t.ttl && spec.Enabled) throw new AwsError('ValidationException', 'TimeToLive is already enabled');
        t.ttl = spec.Enabled ? spec.AttributeName : null;
        return { TimeToLiveSpecification: spec };
      }
      case 'GetCommand': {
        const t = this.table(input.TableName);
        const attrs = projection(input, used);
        checkUsed(input, used);
        const it = t.items.get(this.keyOf(t, input.Key));
        return { Item: it ? project(it, attrs) : undefined };
      }
      case 'PutCommand': {
        const t = this.table(input.TableName);
        this.validateItem(input.Item, t);
        const k = this.keyOf(t, { [t.hash]: input.Item[t.hash], ...(t.range ? { [t.range]: input.Item[t.range] } : {}) });
        const cond = compile(input, 'ConditionExpression', used);
        checkUsed(input, used);
        const old = t.items.get(k);
        if (cond && !cond(old || {})) throw new AwsError('ConditionalCheckFailedException', 'The conditional request failed');
        t.items.set(k, clone(input.Item));
        return {};
      }
      case 'UpdateCommand': {
        const t = this.table(input.TableName);
        const k = this.keyOf(t, input.Key);
        const cond = compile(input, 'ConditionExpression', used);
        const upd = compile(input, 'UpdateExpression', used, 'update');
        checkUsed(input, used);
        const old = t.items.get(k);
        if (cond && !cond(old || {})) throw new AwsError('ConditionalCheckFailedException', 'The conditional request failed');
        const item = old ? clone(old) : clone(input.Key);
        upd(item);
        this.validateItem(item, t);
        t.items.set(k, item);
        const rv = input.ReturnValues || 'NONE';
        if (rv === 'ALL_NEW') return { Attributes: clone(item) };
        if (rv === 'UPDATED_NEW') {
          const o = {};
          for (const [a, v] of Object.entries(item)) if (!old || JSON.stringify(old[a]) !== JSON.stringify(v)) o[a] = clone(v);
          return { Attributes: o };
        }
        if (rv === 'NONE') return {};
        throw new AwsError('ValidationException', 'ReturnValues ' + rv + ' not used by store');
      }
      case 'DeleteCommand': {
        const t = this.table(input.TableName);
        t.items.delete(this.keyOf(t, input.Key));
        return {};
      }
      case 'QueryCommand': {
        const t = this.table(input.TableName);
        const kc = compile(input, 'KeyConditionExpression', used);
        if (!kc) throw new AwsError('ValidationException', 'KeyConditionExpression required');
        const filter = compile(input, 'FilterExpression', used);
        const attrs = projection(input, used);
        checkUsed(input, used);
        if (!/#pk\s*=\s*:|pk\s*=\s*:/.test(input.KeyConditionExpression)) throw new AwsError('ValidationException', 'Query needs hash equality');
        let rows = this.sorted(t).filter(kc);
        if (input.ScanIndexForward === false) rows.reverse();
        return this.page(t, rows, input, filter, attrs);
      }
      case 'ScanCommand': {
        const t = this.table(input.TableName);
        const filter = compile(input, 'FilterExpression', used);
        const attrs = projection(input, used);
        checkUsed(input, used);
        return this.page(t, this.sorted(t), input, filter, attrs);
      }
      case 'BatchGetCommand': {
        const Responses = {};
        for (const [tn, spec] of Object.entries(input.RequestItems)) {
          const t = this.table(tn);
          if (spec.Keys.length > 100) throw new AwsError('ValidationException', 'Too many keys');
          Responses[tn] = spec.Keys.map(key => t.items.get(this.keyOf(t, key))).filter(Boolean).map(clone);
        }
        return { Responses, UnprocessedKeys: {} };
      }
      case 'BatchWriteCommand': {
        for (const [tn, reqs] of Object.entries(input.RequestItems)) {
          const t = this.table(tn);
          if (reqs.length > 25) throw new AwsError('ValidationException', 'Too many items');
          for (const r of reqs) {
            if (r.DeleteRequest) t.items.delete(this.keyOf(t, r.DeleteRequest.Key));
            else if (r.PutRequest) { this.validateItem(r.PutRequest.Item); t.items.set(this.keyOf(t, { [t.hash]: r.PutRequest.Item[t.hash], ...(t.range ? { [t.range]: r.PutRequest.Item[t.range] } : {}) }), clone(r.PutRequest.Item)); }
          }
        }
        return { UnprocessedItems: {} };
      }
      default:
        throw new AwsError('UnknownOperationException', name);
    }
  }
  page(t, rows, input, filter, attrs) {
    let start = 0;
    if (input.ExclusiveStartKey) {
      const k = this.keyOf(t, input.ExclusiveStartKey);
      start = rows.findIndex(r => this.keyOf(t, { [t.hash]: r[t.hash], ...(t.range ? { [t.range]: r[t.range] } : {}) }) === k) + 1;
    }
    const limit = input.Limit || this.pageSize;   // без Limit — короткие страницы, как будто упёрлись в 1 МБ
    const slice = rows.slice(start, start + limit);
    const more = start + slice.length < rows.length;
    const last = slice[slice.length - 1];
    return {
      Items: slice.filter(r => !filter || filter(r)).map(r => project(r, attrs)),
      LastEvaluatedKey: more && last ? { [t.hash]: last[t.hash], ...(t.range ? { [t.range]: last[t.range] } : {}) } : undefined,
    };
  }
}

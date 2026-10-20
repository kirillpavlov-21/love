/* Подборки (assets/collections.js): каждый пункт есть в каталоге, все — из города подборки, поля в своих пределах,
   пунктов не меньше 4, мест 18+ нет. Читаем настоящие файлы сайта в песочнице vm, сеть не трогаем. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILES = ['places.js', 'places-spb.js', 'events.js', 'events-spb.js', 'auto.js', 'collections.js'];
const BAD = /t\.me|телеграм|telegram|канал[аеуы]?\b|instagram|инстаграм|@[a-z0-9_]{4,}/i;

function load() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  for (const f of FILES) vm.runInContext(readFileSync(path.join(ROOT, 'assets', f), 'utf8'), ctx, { filename: f });
  return { K: ctx.window.KUDA, E: ctx.window.KUDA_EVENTS || [] };
}
const isSpb = id => /^spb-|^ev-spb-|^p-spb-/.test(id);

test('подборки: пункты существуют и из одного города, поля в пределах', () => {
  const { K, E } = load();
  const cols = K.collections || [];
  assert.ok(cols.length >= 20, `подборок ${cols.length}`);
  const plans = new Set(K.scenarios.map(s => s.id)), evs = new Map(E.map(e => [e.id, e]));
  const ids = new Set();
  for (const c of cols) {
    assert.ok(/^(spb-)?c-[a-z0-9-]+$/.test(c.id), `id ${c.id}`);
    assert.ok(!ids.has(c.id), `повтор ${c.id}`); ids.add(c.id);
    assert.ok(c.title && c.title.length <= 40, `${c.id}: title ${c.title && c.title.length}`);
    assert.ok(!c.lead || c.lead.length <= 300, `${c.id}: lead ${c.lead.length}`);
    assert.ok(!BAD.test(c.title + ' ' + (c.lead || '')), `${c.id}: упоминание канала`);
    const items = (c.items || []).concat(...(c.sections || []).map(s => s.items));
    assert.ok(items.length >= 4, `${c.id}: пунктов ${items.length}`);
    const spb = c.id.startsWith('spb-');
    for (const it of items) {
      const pid = it.startsWith('p-') ? it.slice(2) : it;
      assert.ok(!!K.places[pid] || plans.has(it) || evs.has(it), `${c.id}: нет пункта ${it}`);
      assert.equal(isSpb(it), spb, `${c.id}: пункт ${it} из другого города`);
      if (K.places[pid]) assert.ok(!K.places[pid].adult, `${c.id}: место 18+ ${it}`);
    }
    if (c.until) assert.match(c.until, /^\d{4}-\d{2}-\d{2}$/);
  }
});

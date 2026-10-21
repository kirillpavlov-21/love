/* Календарь поводов и ежедневная чистка: даты праздников, окна подборок, прошедшие события и истёкшие подборки */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orthodoxEaster, OCCASIONS } from '../../scripts/occasions-calendar.mjs';
import { windowOf, occasionsOn } from '../../scripts/occasions.mjs';
import { lastDay, pruneEvents, pruneCollections } from '../../scripts/daily.mjs';

const occ = slug => OCCASIONS.find(o => o.slug === slug);

test('православная Пасха и Масленица', () => {
  assert.equal(orthodoxEaster(2025), '2025-04-20');
  assert.equal(orthodoxEaster(2026), '2026-04-12');
  assert.equal(orthodoxEaster(2027), '2027-05-02');
  const w = windowOf(occ('maslenitsa'), 2026);
  assert.deepEqual([w.start, w.end], ['2026-02-16', '2026-02-22']);
});

test('плавающие даты: Ночь музеев — третья суббота мая, День города Москвы — первая суббота с 5 сентября', () => {
  assert.equal(windowOf(occ('noch-muzeev'), 2025).start, '2025-05-17');
  assert.equal(windowOf(occ('noch-muzeev'), 2024).start, '2024-05-18');
  for (const [y, d] of [[2022, '2022-09-10'], [2023, '2023-09-09'], [2024, '2024-09-07'], [2025, '2025-09-06']]) assert.equal(windowOf(occ('den-goroda-msk'), y).start, d);
  // поправка из occasion-dates.json главнее правила и подтверждает дату
  const w = windowOf(occ('noch-muzeev'), 2026, { 'noch-muzeev': { 2026: '2026-05-23' } });
  assert.equal(w.start, '2026-05-23');
  assert.ok(w.confirmed);
  assert.ok(!windowOf(occ('noch-muzeev'), 2026).confirmed);
});

test('окно подборки: за before дней до повода и до последнего дня; Новый год — через границу года', () => {
  const on = d => occasionsOn(d).active.map(x => x.o.slug);
  assert.ok(on('2026-02-07').includes('valentin'));
  assert.ok(!on('2026-02-06').includes('valentin'));
  assert.ok(on('2026-02-14').includes('valentin'));
  assert.ok(!on('2026-02-15').includes('valentin'));
  assert.ok(on('2027-01-05').includes('novyy-god'), 'новогодние выходные прошлого года ещё идут');
  assert.ok(!on('2027-01-09').includes('novyy-god'));
  assert.ok(occasionsOn('2026-02-01').soon.some(x => x.o.slug === 'valentin'));
});

test('у каждого повода: slug, заголовок до 40 знаков, вступление до 300, дата', () => {
  const slugs = new Set();
  for (const o of OCCASIONS) {
    assert.match(o.slug, /^[a-z0-9-]+$/);
    assert.ok(!slugs.has(o.slug), o.slug); slugs.add(o.slug);
    assert.ok(o.title.length <= 40, o.slug);
    for (const l of typeof o.lead === 'string' ? [o.lead] : Object.values(o.lead)) assert.ok(l.length > 40 && l.length <= 300, o.slug);
    assert.match(o.date(2026), /^2026-\d\d-\d\d$/);
    assert.ok(o.words instanceof RegExp && !o.words.test('Работает ПВО, атака ночью'), o.slug + ': слова для поиска постов');
  }
});

test('чистка: прошедшие события и истёкшие подборки', () => {
  assert.equal(lastDay('{ id: "ev-a", start: "2026-10-01", end: "2026-10-05", dates: ["2026-10-01","2026-10-07"] }'), '2026-10-07');
  assert.equal(lastDay('{ id: "ev-b", start: "2026-10-01" }'), '2026-10-01');
  const ev = ['  { id: "ev-old", start: "2026-10-01", end: "2026-10-20" },', '  { id: "ev-today", start: "2026-10-21", end: "2026-10-21" },', '  // —— ноябрь ——'].join('\n');
  const r = pruneEvents(ev, '2026-10-21');
  assert.deepEqual(r.gone, ['ev-old']);
  assert.ok(r.out.includes('ev-today') && r.out.includes('ноябрь'));
  const cols = ["(window.KUDA, [", "  {", "    id: 'c-old', until: '2026-10-20',", "  },", "  {", "    id: 'c-live', until: '2026-10-21',", "  },", "  {", "    id: 'c-always',", "  },", "]);"].join('\n');
  const c = pruneCollections(cols, '2026-10-21');
  assert.deepEqual(c.gone, ['c-old']);
  assert.ok(c.out.includes("c-live") && c.out.includes("c-always") && !c.out.includes('c-old'));
});

test('чистка не ломает файлы: многострочное событие, until в комментарии, комментарий после скобки', () => {
  const multi = ['  { id: "ev-test", start: "2026-10-01",', '    end: "2026-12-01" },'].join('\n');
  assert.deepEqual(pruneEvents(multi, '2026-10-21'), { out: multi, gone: [] });
  const c1 = ["  {", "    id: 'c-live', // until: '2026-10-01'", "    until: '2026-12-01',", "  },"].join('\n');
  assert.deepEqual(pruneCollections(c1, '2026-10-21').gone, []);
  const c2 = ["  {", "    id: 'c-old', until: '2026-10-01',", "  }, // конец", "  {", "    id: 'c-next',", "  },", "]);"].join('\n');
  const r = pruneCollections(c2, '2026-10-21');
  assert.deepEqual(r.gone, ['c-old']);
  assert.ok(r.out.includes('c-next') && r.out.trim().endsWith(']);'));
  // конца блока нет — остаток файла остаётся как был
  const c3 = ["  {", "    id: 'c-broken', until: '2026-10-01',", "]);"].join('\n');
  assert.equal(pruneCollections(c3, '2026-10-21').out, c3);
});

/* Робот Петербурга (A2): регистрация на события, вторая ссылка у закрытий, «Обсуждают» (buzz) в auto.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { normItem } from '../lib/llm.mjs';
import { renderAutoJs, emptyAutoData } from '../lib/autojs.mjs';
import { parseAutoJs } from '../lib/catalog.mjs';
import { isoWeek, isoDay } from '../run.mjs';

const ctx = { keyMap: new Map([['p1', 'tg:x/1']]), ids: new Set(['spb-kafe']), today: '2026-10-19', channels: ['some-channel'] };
const base = { post_key: 'p1', city: 'spb', match_id: '', name: 'Кафе', kind: 'Кафе', cat: 'food', address: '', area: '', price: 2,
  hours: '', note_ru: 'Описание.', fit: [], hints: [], adult: false, event: null, confidence: 0.9, reason: 'тест', confirm_url: '' };
const ev = o => ({ title: 'Лекция', cat: 'lecture', start: '2026-11-05', end: '2026-11-05', dates: [], time: '19:00', venue: 'Зал', address: 'Невский пр., 1',
  price_from: 0, price_to: 0, age: '', url: 'https://example.org/lecture', reg: true, reg_open: '2026-10-25', ...o });

test('A2: регистрация — дата открытия не позже начала события; старые ответы без reg принимаются', () => {
  const a = normItem({ ...base, type: 'event', event: ev() }, ctx);
  assert.equal(a.event.reg, true);
  assert.equal(a.event.reg_open, '2026-10-25');
  assert.equal(normItem({ ...base, type: 'event', event: ev({ reg_open: '2026-12-01' }) }, ctx).event.reg_open, '');
  const old = ev(); delete old.reg; delete old.reg_open;
  const b = normItem({ ...base, type: 'event', event: old }, ctx);
  assert.equal(b.event.reg, false);
});

test('A2: закрытие — подтверждение только официальной ссылкой, не постом и не соцсетью', () => {
  const ok = normItem({ ...base, type: 'closure', match_id: 'spb-kafe', confirm_url: 'https://kafe-spb.ru/' }, ctx);
  assert.equal(ok.confirm_url, 'https://kafe-spb.ru/');
  for (const u of ['https://t.me/some-channel/12', 'https://vk.com/kafe', 'http://kafe-spb.ru/', 'https://kafe-spb.ru/?utm_source=some-channel']) {
    const r = normItem({ ...base, type: 'closure', match_id: 'spb-kafe', confirm_url: u }, ctx);
    assert.ok(!r.confirm_url || !/t\.me|vk\.com|utm_|some-channel/.test(r.confirm_url), u);
  }
});

test('A2: buzz в auto.js — неделя ISO, на сайте попадает в место; пустой buzz не меняет файл', () => {
  assert.equal(isoWeek('2026-10-19'), '2026-W43');
  assert.equal(isoWeek('2026-01-01'), '2026-W01');
  assert.equal(isoDay('2026-10-19', -6), '2026-10-13');
  const plain = renderAutoJs({ ...emptyAutoData(), updated: '2026-10-19' });
  assert.ok(!/"buzz"/.test(plain));
  const js = renderAutoJs({ ...emptyAutoData(), updated: '2026-10-19', buzz: { 'spb-kafe': '2026-W43' } });
  assert.deepEqual(parseAutoJs(js).buzz, { 'spb-kafe': '2026-W43' });
  const w = { KUDA: { places: { 'spb-kafe': { name: 'Кафе' } }, scenarios: [], adult: [] } };
  w.window = w;
  vm.createContext(w);
  vm.runInContext(js, w);
  assert.equal(w.KUDA.places['spb-kafe'].buzz, '2026-W43');
});

/* Часы работы (поле oh, подмножество OSM opening_hours): разбор и «открыто ли сейчас» из assets/shared.js.
   Время — московское; shared.js грузим в песочнице vm, как в браузере. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const store = { getItem: () => null, setItem() {}, removeItem() {} };
const ctx = { window: {}, location: { href: 'http://x/', origin: 'http://x', pathname: '/' }, navigator: {}, document: { addEventListener() {}, documentElement: { dataset: {} } },
  localStorage: store, sessionStorage: store, setTimeout, TextEncoder, TextDecoder, URL, URLSearchParams, console };
vm.createContext(ctx);
vm.runInContext(readFileSync(path.join(ROOT, 'assets/shared.js'), 'utf8'), ctx, { filename: 'shared.js' });
const K = ctx.window.DateKit;
const at = (ymd, hm) => Date.parse(`${ymd}T${hm}:00+03:00`);   // 2026-10-19 — понедельник

test('часы: каждый день, через полночь, круглосуточно, выходной', () => {
  assert.equal(K.openState({ oh: 'Mo-Su 10:00-22:00' }, at('2026-10-21', '21:59')).open, true);
  assert.equal(K.openState({ oh: 'Mo-Su 10:00-22:00' }, at('2026-10-21', '22:00')).open, false);
  // пятница 12:00-02:00: в субботу в 01:30 ещё открыто, до 02:00
  const night = K.openState({ oh: 'Mo-Th 12:00-24:00; Fr,Sa 12:00-02:00; Su off' }, at('2026-10-24', '01:30'));
  assert.equal(night.open, true);
  assert.equal(night.until, '02:00');
  assert.equal(K.openState({ oh: '24/7' }, at('2026-10-19', '04:00')).allDay, true);
  const mon = K.openState({ oh: 'Mo off; Tu-Su 11:00-20:00' }, at('2026-10-19', '12:00'));
  assert.equal(mon.open, false);
  assert.equal(mon.dayOff, true);
  assert.equal(K.openText(mon), 'Сегодня выходной · откроется завтра в 11:00');
  assert.equal(K.closedOn({ oh: 'Tu-Su 10:00-18:00' }, '2026-10-19'), true);
  assert.equal(K.closedOn({ oh: 'Tu-Su 10:00-18:00' }, '2026-10-20'), false);
});

test('часы: перерыв и мусор', () => {
  const br = { oh: 'Mo-Su 11:00-15:00,16:00-20:00' };
  assert.equal(K.openState(br, at('2026-10-20', '15:30')).open, false);
  assert.equal(K.openState(br, at('2026-10-20', '15:30')).opens, '16:00');
  for (const bad of ['мусор', 'Mo-Xx 10:00-20:00', 'Mo 25:00-26:00', '', null]) assert.equal(K.ohDays(bad), null, String(bad));
  assert.equal(K.openState({}, at('2026-10-20', '12:00')), null);
});

test('часы: у мест Петербурга oh разбирается и проставлен месяц проверки', () => {
  const c2 = { window: { KUDA: { places: {}, scenarios: [], adult: [] } } };
  vm.createContext(c2);
  vm.runInContext(readFileSync(path.join(ROOT, 'assets/places-spb.js'), 'utf8'), c2);
  const P = Object.values(c2.window.KUDA.places).filter(p => p.oh);
  assert.ok(P.length > 200, `мест с часами ${P.length}`);
  for (const p of P) { assert.ok(K.ohDays(p.oh), `${p.name}: ${p.oh}`); assert.match(p.ohChk, /^\d{4}-\d{2}$/); }
});

test('часы и бронь: открытие ровно через неделю, время на вторую остановку, текст брони', () => {
  const w = K.openState({ oh: 'Mo 10:00-11:00' }, at('2026-10-19', '12:00'));
  assert.equal(w.open, false);
  assert.equal(w.inDays, 7);
  assert.equal(w.opens, '10:00');
  // музей 90 мин + дорога → ресторан; до 15 минут
  const museum = { cat: 'culture', lat: 59.9398, lon: 30.3146 }, food = { cat: 'food', lat: 59.9408, lon: 30.3146 };
  assert.equal(K.arriveAt([museum, food], food, '19:00'), '20:30');
  assert.equal(K.arriveAt([museum, food], museum, '19:00'), '19:00');
  assert.match(K.bookText({ n: 45, day: '2026-10-23', time: '20:30' }), /на 45 человек на пт, 23 октября, в 20:30/);
  assert.match(K.bookText({ n: 2, day: '2026-10-23' }), /на двоих/);
});

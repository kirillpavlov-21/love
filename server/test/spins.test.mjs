/* lib/spins.mjs — список итогов колеса по наборам лидеров (общий для SQLite и YDB) */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spinList, spinAdd, spinView, MAX_SPINS } from '../lib/spins.mjs';

describe('lib/spins', () => {
  it('spinList: новый формат, одиночный итог старой версии, мусор', () => {
    assert.deepEqual(spinList(null, null), []);
    assert.deepEqual(spinList(undefined, JSON.stringify({ i: 3, t: 5 })), [{ i: 3, d: null, t: 5, L: '' }]);
    assert.deepEqual(spinList('{битый', JSON.stringify({ i: 3, d: 7, t: 5 })), [{ i: 3, d: 7, t: 5, L: '' }]);
    assert.deepEqual(spinList(JSON.stringify([{ i: 1, L: '0,1', t: 2 }, { i: 'x' }, null, 5]), JSON.stringify({ i: 9 })), [{ i: 1, d: null, t: 2, L: '0,1' }]);
    assert.deepEqual(spinList('{}', '"x"'), []);
  });

  it('spinAdd: первый итог для набора остаётся, лишние наборы вытесняются с начала', () => {
    let list = [];
    list = spinAdd(list, { i: 0, t: 1 });
    assert.equal(spinAdd(list, { i: 5, t: 2, L: '' }), null);
    assert.equal(spinAdd(list, { i: 5, t: 2 }), null);
    list = spinAdd(list, { i: 1, d: 2480, t: 3, L: '1,2' });
    assert.equal(spinAdd(list, { i: 2, t: 4, L: '1,2' }), null);
    assert.deepEqual(list.map(s => s.L), ['', '1,2']);
    for (let n = 0; n < MAX_SPINS; n++) list = spinAdd(list, { i: n, t: 10 + n, L: n + ',' + (n + 50) });
    assert.equal(list.length, MAX_SPINS);
    assert.deepEqual([list[0].L, list[list.length - 1].L], ['0,50', '9,59']);
    assert.equal(spinAdd([], { i: 1, L: '1,2' }, 0).length, 1);              // хотя бы один итог храним всегда
  });

  it('spinView: spin — последний или итог запрошенного набора, spins — только наборы с L', () => {
    const list = [{ i: 4, d: null, t: 1, L: '' }, { i: 1, d: 2480, t: 2, L: '1,2' }, { i: 3, d: null, t: 3, L: '0,3' }];
    assert.deepEqual(spinView(list), {
      spin: { i: 3, d: null, t: 3, L: '0,3' },
      spins: { '1,2': { i: 1, d: 2480, t: 2, L: '1,2' }, '0,3': { i: 3, d: null, t: 3, L: '0,3' } },
    });
    assert.deepEqual(spinView(list, '').spin, { i: 4, d: null, t: 1 });     // старый формат — без L
    assert.deepEqual(spinView(list, '1,2').spin, { i: 1, d: 2480, t: 2, L: '1,2' });
    assert.equal(spinView(list, '5,6').spin, null);
    assert.deepEqual(spinView([]), { spin: null, spins: {} });
  });
});

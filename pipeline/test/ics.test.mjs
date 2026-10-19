/* Календари .ics для подписки (scripts/ics.mjs, его зовёт scripts/build-seo.mjs): экранирование, перенос длинных
   строк по байтам UTF-8, переход через полночь и самопроверка готового файла. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { icsText, fold, plusMinutes, calendar, checkIcs } from '../../scripts/ics.mjs';

test('ics: экранирование текста и перенос строк не длиннее 75 байт', () => {
  assert.equal(icsText('a,b;c\\d\nе'), 'a\\,b\\;c\\\\d\\nе');
  const long = 'SUMMARY:' + 'Ёлка на Неве, '.repeat(12);
  const lines = fold(long).split('\r\n');
  assert.ok(lines.length > 1);
  lines.forEach(l => assert.ok(Buffer.byteLength(l) <= 75, `строка ${Buffer.byteLength(l)} байт`));
  assert.equal(lines.map((l, i) => (i ? l.slice(1) : l)).join(''), long);   // буквы не разорваны
});

test('ics: время через полночь', () => {
  assert.deepEqual(plusMinutes('2026-10-24', '23:30', 90), { day: '2026-10-25', hm: '01:00' });
});

test('ics: календарь проходит самопроверку, UID стабилен', () => {
  const ev = { uid: 'ev-spb-test-20261024@example.org', day: '2026-10-24', time: '19:00', minutes: 120, summary: 'Концерт, большой; зал',
    location: 'Капелла, наб. реки Мойки, 20', geo: [59.94, 30.32], description: 'Строка 1\nСтрока 2', url: 'https://example.org/', categories: 'Концерт' };
  const a = calendar({ prodid: '-//test//RU', stamp: '20261019T000000Z', name: 'Тест', desc: 'Описание', events: [ev] });
  const b = calendar({ prodid: '-//test//RU', stamp: '20261019T000000Z', name: 'Тест', desc: 'Описание', events: [ev] });
  assert.equal(a, b);
  assert.deepEqual(checkIcs(a), []);
  assert.match(a, /DTSTART;TZID=Europe\/Moscow:20261024T190000/);
});

/* Футбол: разбор Википедии (сохранённые ответы в fixtures/football/), команды и id, стадионы, сведение расписания
   РПЛ из статей клубов, описания, формат assets/sport.js и сквозной запуск football.mjs с подставным fetch
   на временной копии. Сеть не нужна. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  TEAMS, VENUES, LEGACY_IDS, FIXES, slug, teamOf, teamByKey, venueKey, seasonClubKey, seasonOf, seasonsBetween,
  wikiDate, wikiDays, wikiTime, wikiLink, parseWikiMatches, parseWikiResults, parseWikiTours, sectionKind, rplSchedule,
  toEvent, noteFor, matchKind, eventId, mergeEvents, sortEvents, renderSportJs, parseSportJs, SPORT_MERGE,
} from '../lib/football.mjs';
import { main, parseArgs, wikiTitles, clubSearch, WIKI_API } from '../football.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FIX = path.join(HERE, 'fixtures', 'football');
const fix = name => readFileSync(path.join(FIX, name), 'utf8');
const json = name => JSON.parse(fix(name));
const TODAY = '2026-10-16';
const UNTIL = '2027-02-13';

/* Статьи клубов о сезоне 2026/2027 (урезаны до заголовков и шаблонов матчей) и время их последней правки */
const CLUBS = {
  'ФК «Акрон» в сезоне 2026/2027': ['akron', '2026-10-12T14:04:11Z'],
  'ФК «Балтика» в сезоне 2026/2027': ['baltika', '2026-08-12T04:16:03Z'],
  'ФК «Динамо» Москва в сезоне 2026/2027': ['dinamo', '2026-10-11T18:54:13Z'],
  'ФК «Зенит» (Санкт-Петербург) в сезоне 2026/2027': ['zenit', '2026-07-28T14:09:50Z'],
  'ФК «Ростов» в сезоне 2026/2027': ['rostov', '2026-09-26T12:40:10Z'],
  'ФК «Спартак» Москва в сезоне 2026/2027': ['spartak', '2026-10-16T08:31:25Z'],
  'ФК «Факел» в сезоне 2026/2027': ['fakel', '2026-09-19T09:51:31Z'],
  'ФК ЦСКА Москва в сезоне 2026/2027': ['cska', '2026-10-14T19:50:27Z'],
};
const clubFile = t => `wiki-club-${CLUBS[t][0]}-2026-2027.txt`;
const ARTICLES = Object.keys(CLUBS).map(title => ({ title, text: fix(clubFile(title)), ts: CLUBS[title][1] }));
const RESULTS = parseWikiResults(fix('wiki-rpl-results-2026-2027.txt'));

/* Таблицы метро из assets/geo.js: FIXED — Москва, FIXED_SPB — Петербург */
const GEO_JS = readFileSync(path.join(ROOT, 'assets', 'geo.js'), 'utf8');
const table = name => {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*;`).exec(GEO_JS);
  assert.ok(m, `assets/geo.js: нет таблицы ${name}`);
  return vm.runInNewContext('(' + m[1] + ')');
};
const STATIONS = { msk: table('FIXED'), spb: table('FIXED_SPB') };
const CENTER = { msk: [55.751, 37.618, 70], spb: [59.939167, 30.315833, 60] };
function distM(a, b, c, d) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const ctxOf = (extra = {}) => {
  const warnings = [];
  return Object.assign({ today: TODAY, until: UNTIL, prev: new Map(), gone: new Set(), warn: w => warnings.push(w), warnings }, extra);
};
const T = k => teamByKey(k);

/* ---------- id и команды ---------- */

test('slug и id матча: латиница, хозяева-гости-дата', () => {
  assert.equal(slug('Ленинградец'), 'leningradets');
  assert.equal(slug('Крылья Советов'), 'krylya-sovetov');
  assert.equal(slug('Щит и Ёлка'), 'shchit-i-elka');
  assert.equal(eventId(T('spartak'), T('rubin'), '2026-10-18'), 'ev-fb-spartak-rubin-20261018');
  for (const k of Object.keys(TEAMS)) assert.match(k, /^[a-z0-9]+(-[a-z0-9]+)*$/, k);
});

test('teamOf: по статье, по тексту, в своей статье клуба; незнакомая команда — по названию', () => {
  assert.equal(teamOf({ wiki: 'Динамо (футбольный клуб, Махачкала)' }).key, 'dinamo-mkh');
  assert.equal(teamOf({ wiki: 'Родина (футбольный клуб)' }).key, 'rodina');
  assert.equal(teamOf({ wiki: 'ЦСКА (футбольный клуб)' }).key, 'cska', 'статья без города — по названию');
  assert.equal(teamOf({ text: 'ЦСКА' }).key, 'cska');
  assert.equal(teamOf({ text: 'Динамо (Москва)' }).key, 'dinamo');
  assert.equal(teamOf({ text: 'Динамо Москва' }).key, 'dinamo');
  assert.equal(teamOf({ text: 'Динамо (Махачкала)' }).key, 'dinamo-mkh');
  assert.equal(teamOf({ text: 'Динамо' }).unknown, true, '«Динамо» без города — неоднозначно');
  assert.equal(teamOf({ text: 'Динамо', self: 'dinamo' }).key, 'dinamo', 'в статье о московском «Динамо»');
  assert.equal(teamOf({ text: 'Спартак' }).key, 'spartak');
  assert.equal(teamOf({ wiki: 'Спартак (футбольный клуб, Кострома)', text: 'Спартак' }).unknown, true, 'Кострома — не московский «Спартак»');
  const sp = T('spartak');
  assert.equal(sp.track, true);
  assert.equal(sp.q, '«Спартак»');
  assert.equal(T('cska').q, 'ЦСКА');
  const u = teamOf({ wiki: 'Ленинградец (футбольный клуб)', text: 'Ленинградец (Ленинградская область)' });
  assert.deepEqual([u.key, u.name, u.unknown, u.track], ['leningradets', 'Ленинградец', true, false]);
  // за кем следим: клубы Москвы, Подмосковья, Петербурга и сборная
  assert.deepEqual(Object.keys(TEAMS).filter(k => TEAMS[k].track).sort(), ['cska', 'dinamo', 'lokomotiv', 'rodina', 'russia', 'spartak', 'zenit']);
  for (const k of Object.keys(TEAMS).filter(x => TEAMS[x].track)) assert.match(TEAMS[k].url, /^https:\/\/[^/]+\//, k);
});

test('seasonClubKey: статьи клубов о сезоне → клуб; чужие клубы — мимо', () => {
  assert.equal(seasonClubKey('ФК «Спартак» Москва в сезоне 2026/2027'), 'spartak');
  assert.equal(seasonClubKey('ФК ЦСКА Москва в сезоне 2026/2027'), 'cska');
  assert.equal(seasonClubKey('ФК «Зенит» (Санкт-Петербург) в сезоне 2026/2027'), 'zenit');
  assert.equal(seasonClubKey('ФК «Динамо» Москва в сезоне 2026/2027'), 'dinamo');
  assert.equal(seasonClubKey('ФК «Динамо» Махачкала в сезоне 2026/2027'), 'dinamo-mkh');
  assert.equal(seasonClubKey('ФК «Факел» в сезоне 2026/2027'), 'fakel');
  assert.equal(seasonClubKey('ФК «Спартак» Кострома в сезоне 2026/2027'), null);
  assert.equal(seasonClubKey('ФК «Урал» в сезоне 2026/2027'), null);
  assert.equal(seasonClubKey('ФК «Реал Мадрид» в сезоне 2026/2027'), null);
  assert.equal(seasonClubKey('КХЛ в сезоне 2026/2027'), null);
});

/* ---------- стадионы ---------- */

test('venueKey: статьи Википедии, старые и английские имена', () => {
  assert.equal(venueKey('Lukoil Arena'), 'lukoil');
  assert.equal(venueKey('Открытие Арена'), 'lukoil');
  assert.equal(venueKey('Saint Petersburg Stadium'), 'gazprom');
  assert.equal(venueKey('Газпром Арена'), 'gazprom');
  assert.equal(venueKey('ВЭБ Арена'), 'veb');
  assert.equal(venueKey('RZD Arena'), 'rzd');
  assert.equal(venueKey('Arena Khimki'), 'khimki');
  assert.equal(venueKey('Петровский (стадион)'), 'petrovsky');
  assert.equal(venueKey('Лужники (стадион)'), 'luzhniki');
  assert.equal(venueKey('Ак Барс Арена'), null);
  assert.equal(venueKey(''), null);
  for (const k of Object.keys(TEAMS)) if (TEAMS[k].venue) assert.ok(VENUES[TEAMS[k].venue], `${k}: нет стадиона ${TEAMS[k].venue}`);
});

test('стадионы: метро есть в таблице своего города и рядом, точка в пределах города', () => {
  for (const [k, v] of Object.entries(VENUES)) {
    const st = STATIONS[v.city];
    assert.ok(st, `${k}: город ${v.city}`);
    assert.ok(st[v.metro], `${k}: станции «${v.metro}» нет в assets/geo.js (${v.city === 'spb' ? 'FIXED_SPB' : 'FIXED'})`);
    const d = distM(v.lat, v.lon, st[v.metro][0], st[v.metro][1]);
    assert.ok(d < 2500, `${k}: до «${v.metro}» ${Math.round(d)} м`);
    const nearer = Object.values(st).filter(([la, lo]) => distM(v.lat, v.lon, la, lo) < d - 1).length;
    assert.ok(nearer <= 1, `${k}: «${v.metro}» не среди двух ближайших станций`);
    const [cla, clo, km] = CENTER[v.city];
    assert.ok(distM(v.lat, v.lon, cla, clo) < km * 1000, `${k}: далеко от центра города`);
    assert.match(String(v.lat), /^\d+\.\d{4,6}$/);
    assert.ok(v.at && v.addr && v.name, k);
    if (v.city === 'spb') assert.doesNotMatch(v.addr, /Санкт-Петербург/, 'адрес Петербурга — без названия города');
  }
});

/* ---------- Википедия: даты, время, шаблоны ---------- */

test('wikiDays, wikiDate и wikiTime: форматы статей, диапазоны туров', () => {
  assert.equal(wikiDate('28 октября 2026'), '2026-10-28');
  assert.equal(wikiDate('{{date|27|03|2026|3}}'), '2026-03-27');
  assert.equal(wikiDate('скоро'), null);
  assert.deepEqual(wikiDays('3—5 ноября 2026'), { from: '2026-11-03', to: '2026-11-05' });
  assert.deepEqual(wikiDays('26 февраля—1 марта 2027'), { from: '2027-02-26', to: '2027-03-01' });
  assert.deepEqual(wikiDays('30 апреля-2 мая 2027'), { from: '2027-04-30', to: '2027-05-02' });
  assert.deepEqual(wikiDays('30 декабря—2 января 2027'), { from: '2026-12-30', to: '2027-01-02' });
  assert.deepEqual(wikiDays('29 мая 2027'), { from: '2027-05-29', to: '2027-05-29' });
  assert.equal(wikiTime('18:30 [[Московское время|МСК]]'), '18:30');
  assert.equal(wikiTime('16:15 [[Московское время|MSK]]'), '16:15');
  assert.equal(wikiTime('16:00 [[Московское время|МСК]]<br>(18:00 [[МСК+2]])'), '16:00');
  assert.equal(wikiTime('21:45 [[Московское время|МСК]]<br>(20:45 [[МСК−1]])'), '21:45');
  assert.equal(wikiTime('19:00'), '19:00');
  assert.equal(wikiTime('18:00 (МСК+2)'), null, 'только местное время другого пояса — не берём');
  assert.equal(wikiTime(''), null);
  assert.deepEqual(wikiLink("'''[[Лукойл Арена]]'''"), { target: 'Лукойл Арена', text: 'Лукойл Арена' });
});

test('parseWikiResults: несыгранные пары → номер тура, сыгранные — отдельно', () => {
  const { tours, played } = RESULTS;
  assert.equal(tours.get('akron|dinamo'), 12);
  assert.equal(tours.get('akhmat|orenburg'), 12);
  assert.equal(tours.get('baltika|akron'), 13);
  assert.equal(tours.get('cska|spartak'), 12);
  assert.equal(tours.has('akron|zenit'), false, 'сыгранный матч (0:5) — без тура');
  assert.ok(played.has('akron|zenit'));
  assert.equal(tours.size + played.size, 240, '16 команд, каждая с каждой дома и в гостях');
  assert.deepEqual(parseWikiTours(fix('wiki-rpl-results-2026-2027.txt')), tours);
});

test('РПЛ: команда не из TEAMS не путается с нашим клубом, а её матчи с нашими — в предупреждениях', () => {
  // «Акрон» вылетел, вместо него — костромской «Спартак» (его латиница — тоже spartak)
  const text = fix('wiki-rpl-results-2026-2027.txt').replace('[[Акрон (футбольный клуб)|Акрон]]', '[[Спартак (футбольный клуб, Кострома)|Спартак (Кострома)]]');
  const { tours } = parseWikiResults(text);
  assert.equal(tours.get('?Спартак|dinamo'), 12);
  assert.equal(tours.get('spartak|?Спартак'), 14);
  assert.equal(tours.get('cska|spartak'), 12, 'московский «Спартак» на месте');
  assert.ok(![...tours.keys()].some(p => p === 'spartak|dinamo' && tours.get(p) === 12), 'чужой «Спартак» не стал московским');
  const warns = [];
  const r = rplSchedule({ articles: ARTICLES, tours, today: TODAY, until: UNTIL, fixes: {}, warn: w => warns.push(w) });
  assert.ok(!r.matches.some(m => m.home.key === 'spartak' && m.away.key === 'spartak'));
  assert.ok(warns.some(w => /незнакомая команда «Спартак» в РПЛ/.test(w)), warns.join('\n'));
  assert.ok(r.matches.some(m => m.home.key === 'cska' && m.away.key === 'spartak'));
});

test('parseWikiMatches: Кубок России — дата, время МСК, стадия, стадион, сыгранные; дни «3—5 ноября»', () => {
  const list = parseWikiMatches(fix('wiki-cup-2026-2027.txt'), 'cup');
  assert.ok(list.length >= 40, `матчей ${list.length}`);
  const sr = list.find(m => m.home.key === 'spartak' && m.away.key === 'rubin');
  assert.deepEqual([sr.date, sr.time, sr.stage, sr.venue, sr.gone], ['2026-10-28', '20:30', 'Группа A, 5-й тур', 'Лукойл Арена', false]);
  const played = list.find(m => m.home.key === 'rodina' && m.away.key === 'rubin');
  assert.equal(played.gone, true);
  const or = list.find(m => m.home.key === 'orenburg' && m.away.key === 'rodina');
  assert.equal(or.time, '16:00', 'берём московское время, а не местное');
  const cl = list.find(m => m.home.key === 'cska' && m.away.key === 'lokomotiv');
  assert.deepEqual([cl.date, cl.stage, venueKey(cl.venue)], ['2026-10-29', 'Группа D, 5-й тур', 'veb']);
  // день ещё не назначен: матч на все дни раунда, без времени
  const box = `=== 6-й раунд ===
{{Footballbox collapsible
|дата     = 3—5 ноября 2026
|время    =
|команда1 = [[Спартак (футбольный клуб, Москва)|Спартак (Москва)]]
|команда2 = [[Ленинградец (футбольный клуб)|Ленинградец (Ленинградская область)]] (1Л)
|счёт     =
|стадион  = [[Лукойл Арена]]
|место    = [[Москва]]
}}`;
  const [r] = parseWikiMatches(box, 'cup');
  assert.deepEqual([r.date, r.dateTo, r.time, r.tbc, r.stage], ['2026-11-03', '2026-11-05', null, true, '6-й раунд']);
  const e = toEvent(r, ctxOf());
  assert.deepEqual([e.id, e.start, e.end, e.tbc, e.time], ['ev-fb-spartak-leningradets-20261103', '2026-11-03', '2026-11-05', true, undefined]);
  assert.match(e.note, /Точный день и время лига ещё не назначила\.$/);
  assert.doesNotMatch(e.note, /вторник|Футбол во/);
});

test('parseWikiMatches: сборная — домашний матч в Москве попадает, выезд — нет', () => {
  const past = parseWikiMatches(fix('wiki-nt-2026.txt'), 'nt');
  assert.equal(past.length, 8);
  assert.ok(past.every(m => m.gone), 'все матчи 2026 года уже сыграны');
  const extra = `
=== [[Товарищеский матч]] ===
{{Отчёт о матче
|дата = {{date|14|11|2026|3}}
|время = 19:00 [[Московское время|МСК]]
|стадион = '''Стадион:''' «[[Лужники (стадион)|Лужники]]», [[Москва]]
|команда1 = [[Сборная России по футболу|Россия]] {{Флаг России}}
|команда2 = {{Флаг Ирана}} [[Сборная Ирана по футболу|Иран]]
|счёт =
}}
=== [[Товарищеский матч]] ===
{{Отчёт о матче
|дата = {{date|18|11|2026|3}}
|стадион = '''Стадион:''' «[[Каирский международный стадион|Каир Интернейшнл]]», [[Каир]]
|команда1 = [[Сборная Египта по футболу|Египет]] {{Флаг Египта}}
|команда2 = {{Флаг России}} [[Сборная России по футболу|Россия]]
|счёт =
}}
`;
  const list = parseWikiMatches(fix('wiki-nt-2026.txt').replace('== Примечания ==', extra + '\n== Примечания =='), 'nt');
  const ctx = ctxOf();
  const evs = list.map(m => toEvent(m, ctx)).filter(Boolean);
  assert.equal(evs.length, 1);
  const e = evs[0];
  assert.deepEqual([e.id, e.title, e.time, e.venue, e.metro, e.city, e.league, e.tour], ['ev-fb-russia-iran-20261114', 'Россия — Иран', '19:00', 'Лужники', 'Воробьёвы горы', 'msk', 'Сборная России', 'Товарищеский матч']);
  assert.deepEqual(e.fit, ['guys', 'date', 'girls']);
  assert.match(e.note, /соперник — Иран/);
  assert.deepEqual(ctx.warnings, []);
});

test('sectionKind: чемпионат, кубок, товарищеские', () => {
  assert.equal(sectionKind(['Соревнования', 'Премьер-лига', 'Матчи']), 'league');
  assert.equal(sectionKind(['Чемпионат России', 'Результаты турнира']), 'league');
  assert.equal(sectionKind(['Кубок России', 'Групповой этап']), 'cup');
  assert.equal(sectionKind(['Суперкубок России']), 'other');
  assert.equal(sectionKind(['Предсезонные и товарищеские матчи']), 'other');
});

/* ---------- расписание РПЛ из статей клубов ---------- */

test('rplSchedule: точные матчи из статей, окна туров, неназначенные дни — на всё окно', () => {
  const warns = [];
  const r = rplSchedule({ articles: ARTICLES, tours: RESULTS.tours, today: TODAY, until: UNTIL, fixes: {}, warn: w => warns.push(w) });
  const get = (h, a) => r.matches.find(m => m.home.key === h && m.away.key === a);
  // в статьях ЦСКА и «Динамо» матч один и тот же — день и время совпали
  assert.deepEqual(['date', 'time', 'tbc', 'stage'].map(k => get('dinamo', 'cska')[k]), ['2026-10-18', '16:15', false, '11-й тур']);
  assert.deepEqual(['date', 'time'].map(k => get('cska', 'spartak')[k]), ['2026-10-25', '16:00']);
  assert.deepEqual(['date', 'time', 'venue'].map(k => get('rodina', 'cska')[k]), ['2026-12-05', '15:15', 'Арена Химки']);
  // о «Локомотиве» статьи нет — день не назначен, матч стоит на окно 11-го тура
  const lk = get('lokomotiv', 'krasnodar');
  assert.deepEqual([lk.date, lk.dateTo, lk.time, lk.tbc, lk.venue], ['2026-10-16', '2026-10-19', null, true, '']);
  assert.deepEqual(r.windows.get(11), { from: '2026-10-16', to: '2026-10-19' });
  assert.deepEqual(r.windows.get(18), { from: '2027-02-26', to: '2027-03-01' }, 'окно будущего тура — из диапазона в статьях');
  // «Балтика» (давно не правили) пишет «7 декабря» без времени — это только примета окна, не точный день
  const zb = get('zenit', 'baltika');
  assert.deepEqual([zb.date, zb.dateTo, zb.tbc], ['2026-12-04', '2026-12-07', true]);
  // статьи «Спартака» и «Динамо» расходятся (7 и 6 декабря) — день не ставим, предупреждаем
  const sd = get('spartak', 'dinamo');
  assert.deepEqual([sd.date, sd.dateTo, sd.time, sd.tbc], ['2026-12-06', '2026-12-07', null, true]);
  assert.ok(warns.some(w => /Спартак — Динамо.*расходятся/.test(w)), warns.join('\n'));
  // только пары, где играет наша команда; кубковые матчи из статей клубов сюда не попадают
  assert.ok(r.matches.every(m => m.home.track || m.away.track));
  assert.ok(!r.matches.some(m => m.date === '2026-10-28'), 'Спартак — Рубин 28.10 — это кубок');
  assert.equal(r.matches.filter(m => m.home.track && m.date <= '2026-12-07').length, 21);
  assert.equal(r.stat.exact > 0 && r.stat.boxes > r.stat.exact, true);
});

test('rplSchedule: поправки FIXES заполняют пробелы и решают спор, но не спорят с единодушной Википедией', () => {
  const warns = [];
  const fixes = {
    'lokomotiv|krasnodar': { date: '2026-10-17', time: '19:30' },
    'spartak|dinamo': { date: '2026-12-06', time: '17:00' },
    'cska|spartak': { date: '2026-10-24', time: '18:00' },          // Википедия единодушна: 25.10 16:00
    'zenit|akhmat': { date: '2026-03-01', time: '18:00' },          // прошлая дата — не действует
    'dinamo|cska': { date: '2026-10-18', time: '19:00' },           // в статьях 16:15
  };
  const r = rplSchedule({ articles: ARTICLES, tours: RESULTS.tours, today: TODAY, until: UNTIL, fixes, warn: w => warns.push(w) });
  const get = (h, a) => r.matches.find(m => m.home.key === h && m.away.key === a);
  assert.deepEqual(['date', 'time', 'tbc'].map(k => get('lokomotiv', 'krasnodar')[k]), ['2026-10-17', '19:30', false]);
  assert.deepEqual(['date', 'time', 'tbc', 'dateTo'].map(k => get('spartak', 'dinamo')[k]), ['2026-12-06', '17:00', false, undefined]);
  assert.deepEqual(['date', 'time'].map(k => get('cska', 'spartak')[k]), ['2026-10-25', '16:00']);
  assert.ok(warns.some(w => /ЦСКА — Спартак.*FIXES/.test(w)), warns.join('\n'));
  assert.equal(get('zenit', 'akhmat').tbc, true);
  assert.equal(get('dinamo', 'cska').time, '16:15');
  assert.ok(warns.some(w => /Динамо — ЦСКА.*16:15.*FIXES.*19:00/.test(w)), warns.join('\n'));
  // поправки в репозитории — на пары РПЛ из шаблона, с датой и временем
  for (const [pair, f] of Object.entries(FIXES)) {
    assert.ok(RESULTS.tours.has(pair) || RESULTS.played.has(pair), pair);
    assert.match(f.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(f.time, /^\d{2}:\d{2}$/);
  }
});

test('rplSchedule: матч перенесён — ни старый день из других статей, ни FIXES, ни окно тура; новый день — берём', () => {
  const box = '|date = 8 ноября 2026\n|time = 16:15 [[Московское время|MSK]]\n|team1 = [[Спартак (футбольный клуб, Москва)|Спартак (Москва)]]\n|team2 = [[Акрон (футбольный клуб)|Акрон (Тольятти)]]\n|score =';
  const sp = ARTICLES.find(a => CLUBS[a.title][0] === 'spartak');
  assert.ok(sp.text.includes(box), 'в статье «Спартака» есть матч с «Акроном» 8 ноября');
  const withSpartak = text => ARTICLES.map(a => (a === sp ? Object.assign({}, a, { text }) : a));
  const fixes = { 'spartak|akron': { date: '2026-11-08', time: '16:15' } };
  const warns = [];
  const r = rplSchedule({ articles: withSpartak(sp.text.replace(box, box + ' перенесён')), tours: RESULTS.tours, today: TODAY, until: UNTIL, fixes, warn: w => warns.push(w) });
  assert.ok(!r.matches.some(m => m.home.key === 'spartak' && m.away.key === 'akron'), 'перенесённый матч не показываем');
  assert.ok(r.moved.has('spartak|akron'));
  assert.ok(warns.some(w => /Спартак — Акрон.*08\.11\.2026 перенесён/.test(w)), warns.join('\n'));
  assert.equal(r.matches.filter(m => m.home.track && m.date <= '2026-12-07').length, 20, 'остальные матчи на месте');
  // лига назначила новый день — он и берётся, пара больше не «перенесена»
  const moved = sp.text.replace(box, box.replace('8 ноября', '9 декабря').replace('16:15', '19:00'));
  const r2 = rplSchedule({ articles: withSpartak(moved + '\n' + '== Чемпионат России ==\n{{Footballbox collapsible\n' + box + ' перенесён\n}}'), tours: RESULTS.tours, today: TODAY, until: UNTIL, fixes, warn: () => {} });
  const m2 = r2.matches.find(m => m.home.key === 'spartak' && m.away.key === 'akron');
  assert.deepEqual([m2.date, m2.time, m2.tbc], ['2026-12-09', '19:00', false]);
  assert.ok(!r2.moved.has('spartak|akron'));
});

/* ---------- события ---------- */

test('toEvent: наш матч → событие; чужой город, прошедший, перенесённый, незнакомый стадион', () => {
  const sp = T('spartak'), rub = T('rubin'), kr = T('krasnodar'), ros = T('rostov');
  const ctx = ctxOf();
  const e = toEvent({ league: 'rpl', date: '2026-10-18', time: '18:45', home: sp, away: rub, venue: 'Лукойл Арена', place: 'Москва', stage: '11-й тур' }, ctx);
  assert.deepEqual(Object.keys(e), ['id', 'title', 'cat', 'sub', 'league', 'tour', 'teams', 'emoji', 'start', 'end', 'time', 'venue', 'addr', 'metro', 'lat', 'lon', 'url', 'note', 'fit', 'city', 'aka']);
  assert.deepEqual([e.id, e.title, e.cat, e.sub, e.league, e.tour, e.start, e.end, e.time, e.venue, e.metro, e.city, e.url],
    ['ev-fb-spartak-rubin-20261018', 'Спартак — Рубин', 'sport', 'football', 'РПЛ', '11-й тур', '2026-10-18', '2026-10-18', '18:45', 'Лукойл Арена', 'Спартак', 'msk', 'https://tickets.spartak.com/']);
  assert.deepEqual(e.aka, LEGACY_IDS['ev-fb-spartak-rubin-20261018']);
  assert.deepEqual(e.fit, ['guys']);
  // гостевой матч в другом городе — не наш
  assert.equal(toEvent({ league: 'rpl', date: '2026-10-25', time: '13:45', home: ros, away: T('lokomotiv'), venue: 'Ростов Арена', place: 'Ростов-на-Дону' }, ctx), null);
  // гостевой матч без стадиона и города у хозяев без своего стадиона в таблице — тоже мимо, без предупреждений
  assert.equal(toEvent({ league: 'rpl', date: '2026-10-25', home: ros, away: T('zenit'), venue: '', place: '' }, ctx), null);
  // матч без наших команд — мимо, даже в Москве
  assert.equal(toEvent({ league: 'cup', date: '2026-11-05', time: '15:00', home: kr, away: ros, venue: 'Лужники' }, ctx), null);
  // прошёл / за горизонтом
  assert.equal(toEvent({ league: 'rpl', date: '2026-10-11', time: '18:00', home: sp, away: rub, venue: 'Лукойл Арена' }, ctx), null);
  assert.equal(toEvent({ league: 'rpl', date: '2027-03-01', time: '18:00', home: sp, away: rub, venue: 'Лукойл Арена' }, ctx), null);
  // перенесён — id запоминается, чтобы не вернуть матч из прошлого файла
  assert.equal(toEvent({ league: 'rpl', date: '2026-10-18', time: '18:45', home: sp, away: rub, venue: 'Лукойл Арена', gone: true }, ctx), null);
  assert.ok(ctx.gone.has('ev-fb-spartak-rubin-20261018'));
  // незнакомый стадион в Москве — предупреждение, матч не берём
  assert.equal(toEvent({ league: 'cup', date: '2026-11-05', time: '15:00', home: sp, away: kr, venue: 'Стадион имени Эдуарда Стрельцова', place: 'Москва' }, ctx), null);
  assert.equal(ctx.warnings.length, 1);
  assert.match(ctx.warnings[0], /незнакомый стадион.*VENUES/);
  // стадион не указан — домашний стадион хозяев; время не утверждено — tbc без time
  const t = toEvent({ league: 'rpl', date: '2026-11-22', time: null, tbc: true, home: T('zenit'), away: kr, venue: '', place: '' }, ctx);
  assert.deepEqual([t.venue, t.city, t.metro, t.time, t.tbc, t.tour], ['Газпром Арена', 'spb', 'Зенит', undefined, true, undefined]);
  assert.match(t.note, /Время начала ещё уточняется\.$/);
  assert.deepEqual(t.fit, ['guys', 'date'], 'Зенит — Краснодар: большой матч');
  // день не назначен, окно тура уже началось — матч ещё впереди
  const w = toEvent({ league: 'rpl', date: '2026-10-15', dateTo: '2026-10-18', tbc: true, home: T('lokomotiv'), away: kr, venue: '', place: '', stage: '11-й тур' }, ctx);
  assert.deepEqual([w.id, w.start, w.end, w.tbc, w.venue], ['ev-fb-lokomotiv-krasnodar-20261015', '2026-10-15', '2026-10-18', true, 'РЖД Арена']);
});

test('matchKind: дерби, матч столиц, кубок, сборная', () => {
  assert.equal(matchKind(T('cska'), T('spartak'), 'rpl'), 'derby-main');
  assert.equal(matchKind(T('zenit'), T('dinamo'), 'rpl'), 'capitals');
  assert.equal(matchKind(T('lokomotiv'), T('rodina'), 'cup'), 'derby');
  assert.equal(matchKind(T('zenit'), T('krasnodar'), 'cup'), 'cup');
  assert.equal(matchKind(T('zenit'), T('krasnodar'), 'rpl'), 'top');
  assert.equal(matchKind(T('spartak'), T('akron'), 'rpl'), 'regular');
  assert.equal(matchKind(T('russia'), teamOf({ text: 'Иран' }), 'nt'), 'national');
});

test('noteFor: до 180 знаков, без «undefined», не меняется от запуска к запуску', () => {
  const tracked = Object.keys(TEAMS).filter(k => TEAMS[k].track && !TEAMS[k].national);
  const all = Object.keys(TEAMS).concat('unknown');
  let n = 0;
  for (const h of tracked) for (const a of all) for (const league of ['rpl', 'cup']) for (const st of ['time', 'tbc', 'range']) {
    if (h === a) continue;
    const home = T(h);
    const away = a === 'unknown' ? teamOf({ text: 'Очень Длинное Название Клуба' }) : T(a);
    for (const vk of Object.keys(VENUES)) for (const date of ['2026-10-17', '2026-10-18', '2026-10-21']) {
      const id = eventId(home, away, date);
      const args = { id, kind: matchKind(home, away, league), home, away, venue: VENUES[vk], date, time: st === 'time' ? '19:30' : null, tbc: st !== 'time', range: st === 'range' };
      const note = noteFor(args);
      assert.ok(note.length <= 180, `${note.length}: ${note}`);
      assert.doesNotMatch(note, /undefined|null|\$\{/);
      if (st === 'range') assert.doesNotMatch(note, /суббот|воскрес|пятниц|понедельн|вторник|сред[уа]|четверг/i, note);
      assert.equal(noteFor(args), note);
      n++;
    }
  }
  assert.ok(n > 1000);
  // склонение гостей: «принимает „Балтику“», а не «Балтика»
  const notes = [];
  for (let d = 1; d <= 28; d++) {
    const date = `2026-11-${String(d).padStart(2, '0')}`;
    const home = T('zenit'), away = T('baltika');
    notes.push(noteFor({ id: eventId(home, away, date), kind: 'regular', home, away, venue: VENUES.gazprom, date, time: '19:00' }));
  }
  assert.ok(notes.some(x => /принимает «Балтику»/.test(x)));
  assert.ok(notes.every(x => !/принимает «Балтика»/.test(x)));
});

test('mergeEvents: прошлый файл — только будущие, не перенесённые и без новой даты для той же пары; aka', () => {
  const ev = (home, away, start, extra = {}) => Object.assign({ id: `ev-fb-${home}-${away}-${start.replace(/-/g, '')}`, sub: 'football', league: 'РПЛ', teams: [home, away], start, end: start, time: '19:00' }, extra);
  const fresh = [ev('a', 'b', '2026-10-20'), ev('c', 'd', '2026-10-25', { time: '15:00' })];
  const previous = [
    ev('a', 'b', '2026-10-20', { note: 'старое' }),        // есть в свежих — берём свежее
    ev('e', 'f', '2026-11-01'),                           // источник временно не дал — оставляем
    ev('g', 'h', '2026-10-10'),                           // прошёл — убираем
    ev('c', 'd', '2026-10-23', { end: '2026-10-26', tbc: true }),   // та же пара: день назначили — убираем, id → aka
    ev('i', 'j', '2026-11-05'),                           // перенесён (gone) — убираем
    ev('k', 'l', '2027-06-01'),                           // за горизонтом — убираем
    { id: 'ev-hockey-1', sub: 'hockey', start: '2026-11-01' },
  ];
  const { events, kept } = mergeEvents({ fresh, previous, gone: new Set(['ev-fb-i-j-20261105']), today: TODAY, until: UNTIL });
  assert.deepEqual(events.map(e => e.id), ['ev-fb-a-b-20261020', 'ev-fb-c-d-20261025', 'ev-fb-e-f-20261101']);
  assert.equal(events[0].note, undefined);
  assert.deepEqual(events[1].aka, ['ev-fb-c-d-20261023']);
  assert.equal(fresh[1].aka, undefined, 'свежие события не меняются');
  assert.deepEqual(kept.map(e => e.id), ['ev-fb-e-f-20261101']);
  // следующий запуск: aka из прошлого файла сохраняется — файл не «мигает»
  const again = mergeEvents({ fresh: [ev('c', 'd', '2026-10-25', { time: '15:00' })], previous: events, today: TODAY, until: UNTIL });
  assert.deepEqual(again.events.find(e => e.id === 'ev-fb-c-d-20261025').aka, ['ev-fb-c-d-20261023']);
  // порядок: день, время, без времени — в конце дня
  const s = sortEvents([ev('x', 'y', '2026-10-20', { time: undefined, tbc: true }), ev('a', 'b', '2026-10-20', { time: '21:00' }), ev('m', 'n', '2026-10-19')]);
  assert.deepEqual(s.map(e => e.id), ['ev-fb-m-n-20261019', 'ev-fb-a-b-20261020', 'ev-fb-x-y-20261020']);
});

/* ---------- assets/sport.js ---------- */

test('renderSportJs: разбор и повторная сборка дают тот же текст; код слияния пропускает существующие id', () => {
  const events = [{ id: 'ev-fb-a-b-20261020', title: 'А — Б', start: '2026-10-20', note: 'кавычки " и \\ и «ёлочки»' }, { id: 'ev-fb-c-d-20261021', title: 'В — Г', start: '2026-10-21' }];
  const text = renderSportJs({ updated: '2026-10-16', events });
  assert.ok(text.startsWith('/* Сгенерировано pipeline/football.mjs — не править руками'));
  assert.ok(text.includes(SPORT_MERGE));
  const back = parseSportJs(text);
  assert.deepEqual(back, { updated: '2026-10-16', events });
  assert.equal(renderSportJs(back), text);
  assert.equal(renderSportJs({ updated: '', events: [] }).includes('"events": []'), true);
  const sb = { window: { KUDA_EVENTS: [{ id: 'ev-fb-a-b-20261020', title: 'уже есть' }] } };
  vm.runInNewContext(text, sb);
  assert.deepEqual(sb.window.KUDA_EVENTS.map(e => e.title), ['уже есть', 'В — Г']);
  const sb2 = { window: {} };
  vm.runInNewContext(text, sb2);
  assert.equal(sb2.window.KUDA_EVENTS.length, 2, 'без events.js файл сам создаёт KUDA_EVENTS');
  assert.deepEqual(parseSportJs(''), { updated: '', events: [] });
  assert.throws(() => parseSportJs('window.X = 1;'), /KUDA_SPORT/);
});

/* ---------- сквозной запуск ---------- */

function fakeFetch({ failWiki = '', results = null, clubs = null } = {}) {
  const calls = [];
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => body });
  const pages = {
    'Кубок России по футболу 2026/2027': () => fix('wiki-cup-2026-2027.txt'),
    'Шаблон:Результаты матчей чемпионата России по футболу 2026/2027': () => results || fix('wiki-rpl-results-2026-2027.txt'),
    'Матчи сборной России по футболу 2026': () => fix('wiki-nt-2026.txt'),
  };
  const fn = async url => {
    const u = new URL(String(url));
    calls.push(u.href);
    if (!u.href.startsWith(WIKI_API)) return res(404, 'not found');
    const q = u.searchParams;
    if (q.get('list') === 'search') {
      if (failWiki === 'search') return res(503, 'busy');
      return res(200, clubs ? JSON.stringify({ query: { search: clubs.map(title => ({ ns: 0, title })) } }) : fix('wiki-search-2026-2027.json'));
    }
    if (failWiki === 'net') throw new Error('ECONNRESET');
    if (failWiki === 'json') return res(200, '<html>maintenance</html>');
    const list = q.get('titles').split('|').map(t => {
      const body = pages[t] ? pages[t]() : CLUBS[t] ? fix(clubFile(t)) : null;
      return body == null ? { title: t, missing: true } : { title: t, revisions: [{ timestamp: CLUBS[t] ? CLUBS[t][1] : '2026-10-16T00:00:00Z', slots: { main: { content: body } } }] };
    });
    return res(200, JSON.stringify({ query: { pages: list } }));
  };
  fn.calls = calls;
  return fn;
}
async function tmpRepo(sportJs) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kuda-football-'));
  await fs.mkdir(path.join(dir, 'assets'));
  if (sportJs != null) await fs.writeFile(path.join(dir, 'assets', 'sport.js'), sportJs);
  return dir;
}
const quiet = lines => s => lines.push(s);

test('main: пишет assets/sport.js, второй запуск ничего не меняет', async () => {
  const repo = await tmpRepo(renderSportJs({ updated: '', events: [] }));
  const lines = [];
  const f = fakeFetch();
  const r = await main(['--repo', repo, '--today', TODAY], { fetch: f, pause: 0, log: quiet(lines) });
  assert.equal(r.fatal, undefined, lines.join('\n'));
  assert.equal(lines.at(-1), 'CHANGES=1');
  const text = await fs.readFile(path.join(repo, 'assets', 'sport.js'), 'utf8');
  const { updated, events } = parseSportJs(text);
  assert.equal(updated, TODAY);
  const ids = events.map(e => e.id);
  for (const id of ['ev-fb-spartak-rubin-20261018', 'ev-fb-dinamo-cska-20261018', 'ev-fb-zenit-akhmat-20261018', 'ev-fb-cska-spartak-20261025',
    'ev-fb-zenit-dinamo-mkh-20261025', 'ev-fb-cska-zenit-20261128', 'ev-fb-spartak-dinamo-20261206', 'ev-fb-spartak-rubin-20261028',
    'ev-fb-cska-lokomotiv-20261029', 'ev-fb-zenit-krylya-sovetov-20261124', 'ev-fb-lokomotiv-rostov-20261125', 'ev-fb-dinamo-fakel-20261126']) assert.ok(ids.includes(id), id);
  assert.equal(events.length, 26);
  assert.ok(events.every(e => e.time && !e.tbc && e.start === e.end), 'сегодня у всех матчей окна есть день и время');
  assert.ok(!ids.some(id => /baltika-rostov|orenburg-rodina|akron-cska/.test(id)), 'выездные матчи не берём');
  assert.deepEqual(ids, sortEvents(events).map(e => e.id));
  const cup = events.find(e => e.id === 'ev-fb-spartak-rubin-20261028');
  assert.deepEqual([cup.league, cup.tour, cup.time], ['Кубок России', 'Группа A, 5-й тур', '20:30']);
  const der = events.find(e => e.id === 'ev-fb-cska-spartak-20261025');
  assert.deepEqual([der.tour, der.time, der.venue, der.fit.join(), der.aka.join()], ['12-й тур', '16:00', 'ВЭБ Арена', 'guys,date', 'ev-tsska-spartak-futbol-rpl-20261025']);
  assert.equal(events.find(e => e.id === 'ev-fb-zenit-akhmat-20261018').city, 'spb');
  assert.equal(events.filter(e => e.city === 'spb').length, 5);
  // запросы: поиск статей клубов и один запрос текстов
  assert.equal(f.calls.length, 2, f.calls.join('\n'));
  assert.ok(r.warnings.some(w => /Спартак — Динамо.*расходятся.*06\.12\.2026/.test(w)), r.warnings.join('\n'));
  assert.match(r.report, /## Футбол: расписание на 16\.10\.2026/);

  const lines2 = [];
  const r2 = await main(['--repo', repo, '--today', TODAY], { fetch: fakeFetch(), pause: 0, log: quiet(lines2) });
  assert.equal(r2.changed, false);
  assert.equal(lines2.at(-1), 'CHANGES=0');
  assert.equal(await fs.readFile(path.join(repo, 'assets', 'sport.js'), 'utf8'), text, 'файл не меняется байт в байт');

  // через пару дней прошедшие матчи сами по себе файл не меняют (сайт их и так прячет) — нет лишних PR после каждого тура
  const r3 = await main(['--repo', repo, '--today', '2026-10-20'], { fetch: fakeFetch(), pause: 0, log: () => {} });
  assert.equal(r3.changed, false);
  assert.equal(await fs.readFile(path.join(repo, 'assets', 'sport.js'), 'utf8'), text);
  // а при настоящем изменении (Спартак — Рубин сыгран и записан в шаблон, ЦСКА — Спартак перенесли) прошедшие уходят
  const results = fix('wiki-rpl-results-2026-2027.txt').replace(/^(\| match_СПА_РУБ\s*=).*$/m, '$1 2:1');
  assert.notEqual(results, fix('wiki-rpl-results-2026-2027.txt'), 'в шаблоне есть пара СПА_РУБ');
  const r4 = await main(['--repo', repo, '--today', '2026-10-20'], { fetch: fakeFetch({ results }), pause: 0, log: () => {} });
  assert.equal(r4.changed, false, 'сыгранный матч и так в прошлом — файл прежний');
  const moved = fix('wiki-club-cska-2026-2027.txt').replace('25 октября 2026', '26 октября 2026');
  const f5 = fakeFetch();
  const f5x = async url => {
    const u = new URL(String(url));
    if (u.searchParams.get('titles')) {
      const r0 = await f5(url);
      const j = JSON.parse(await r0.text());
      for (const p of j.query.pages) if (p.title === 'ФК ЦСКА Москва в сезоне 2026/2027') p.revisions[0].slots.main.content = moved;
      // в статье «Спартака» тоже перенос — иначе две статьи спорят
      for (const p of j.query.pages) if (p.title === 'ФК «Спартак» Москва в сезоне 2026/2027') p.revisions[0].slots.main.content = p.revisions[0].slots.main.content.replace(/25 октября 2026/g, '26 октября 2026');
      return { ok: true, status: 200, text: async () => JSON.stringify(j) };
    }
    return f5(url);
  };
  const r5 = await main(['--repo', repo, '--today', '2026-10-20'], { fetch: f5x, pause: 0, log: () => {} });
  assert.equal(r5.changed, true);
  assert.ok(r5.removed.some(e => e.id === 'ev-fb-cska-spartak-20261025'));
  assert.ok(r5.removed.some(e => e.id === 'ev-fb-spartak-rubin-20261018'), 'прошедшие уходят вместе с настоящим изменением');
  const nw = r5.events.find(e => e.id === 'ev-fb-cska-spartak-20261026');
  assert.ok(nw, 'новая дата');
  assert.deepEqual(nw.aka, ['ev-fb-cska-spartak-20261025', 'ev-tsska-spartak-futbol-rpl-20261025'], 'старые id — в aka');
  assert.equal(parseSportJs(r5.text).updated, '2026-10-20');
});

test('main: матч перенесли без нового дня — из файла уходит, а не остаётся на старой дате', async () => {
  const repo = await tmpRepo(renderSportJs({ updated: '', events: [] }));
  await main(['--repo', repo, '--today', TODAY], { fetch: fakeFetch(), pause: 0, log: () => {} });
  const before = parseSportJs(await fs.readFile(path.join(repo, 'assets', 'sport.js'), 'utf8')).events;
  assert.ok(before.some(e => e.id === 'ev-fb-spartak-akron-20261108'));
  const f = fakeFetch();
  const postponed = async url => {
    const r0 = await f(url);
    if (!new URL(String(url)).searchParams.get('titles')) return r0;
    const j = JSON.parse(await r0.text());
    for (const p of j.query.pages) {
      if (p.title !== 'ФК «Спартак» Москва в сезоне 2026/2027') continue;
      const c = p.revisions[0].slots.main.content;
      p.revisions[0].slots.main.content = c.replace(/(\|date = 8 ноября 2026\n[\s\S]*?\|score =)/, '$1 перенесён');
      assert.notEqual(p.revisions[0].slots.main.content, c);
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(j) };
  };
  const r = await main(['--repo', repo, '--today', TODAY], { fetch: postponed, pause: 0, log: () => {} });
  assert.equal(r.changed, true);
  assert.ok(!r.events.some(e => /^ev-fb-spartak-akron-/.test(e.id)), 'перенесённого матча в файле нет');
  assert.ok(r.removed.some(e => e.id === 'ev-fb-spartak-akron-20261108'));
  assert.equal(r.kept.length, 0);
  assert.ok(r.warnings.some(w => /Спартак — Акрон.*перенесён/.test(w)), r.warnings.join('\n'));
});

test('main: источник недоступен — файл не трогаем, fatal', async () => {
  const before = renderSportJs({ updated: '2026-10-10', events: [{ id: 'ev-fb-x-y-20261101', sub: 'football', start: '2026-11-01', teams: ['X', 'Y'] }] });
  for (const failWiki of ['search', 'net', 'json']) {
    const repo = await tmpRepo(before);
    const lines = [];
    const r = await main(['--repo', repo, '--today', TODAY], { fetch: fakeFetch({ failWiki }), pause: 0, log: quiet(lines) });
    assert.ok(r.fatal, failWiki);
    assert.equal(lines.at(-1), 'CHANGES=0');
    assert.equal(await fs.readFile(path.join(repo, 'assets', 'sport.js'), 'utf8'), before);
  }
});

test('main: без статей клубов РПЛ держится на поправках и окнах; матч из прошлого файла остаётся до своей даты', async () => {
  const keep = { id: 'ev-fb-spartak-zenit-20261213', title: 'Спартак — Зенит', sub: 'football', league: 'Сборная России', teams: ['Спартак', 'Зенит'], start: '2026-12-13', end: '2026-12-13' };
  const repo = await tmpRepo(renderSportJs({ updated: '2026-10-01', events: [keep] }));
  const r = await main(['--repo', repo, '--today', TODAY, '--dry'], { fetch: fakeFetch({ clubs: [] }), pause: 0, log: () => {} });
  assert.equal(r.fatal, undefined);
  assert.deepEqual(r.kept.map(e => e.id), [keep.id]);
  assert.ok(r.warnings.some(w => /статей клубов о сезоне 2026\/2027 не нашёл/.test(w)));
  // поправки FIXES дали свои матчи, а матчи клубов со статьями без окон не появились
  assert.ok(r.events.some(e => e.id === 'ev-fb-lokomotiv-krasnodar-20261017'));
  assert.ok(!r.events.some(e => e.id === 'ev-fb-dinamo-cska-20261018'));
  assert.equal(r.changed, true);
  assert.equal(parseSportJs(await fs.readFile(path.join(repo, 'assets', 'sport.js'), 'utf8')).updated, '2026-10-01', '--dry ничего не пишет');
});

test('parseArgs, окно сезонов и запросы к Википедии', () => {
  assert.deepEqual(parseArgs(['--days', '30', '--today', '2026-10-16', '--dry']).days, 30);
  assert.throws(() => parseArgs(['--days', 'x']), /--days/);
  assert.throws(() => parseArgs(['--bad']), /неизвестный флаг/);
  assert.equal(seasonOf('2026-10-16'), '2026/2027');
  assert.equal(seasonOf('2027-05-20'), '2026/2027');
  assert.deepEqual(seasonsBetween('2027-05-20', '2027-09-17'), ['2026/2027', '2027/2028']);
  const t = wikiTitles('2026-10-16', '2027-02-13');
  assert.deepEqual(t.cup, ['Кубок России по футболу 2026/2027']);
  assert.deepEqual(t.nt, ['Матчи сборной России по футболу 2026', 'Матчи сборной России по футболу 2027']);
  assert.equal(clubSearch('2026/2027'), 'intitle:"в сезоне 2026/2027" intitle:ФК');
});

/* ---------- данные сайта ---------- */

test('assets/sport.js в репозитории: формат, поля, метро, без дублей с events.js', () => {
  const text = readFileSync(path.join(ROOT, 'assets', 'sport.js'), 'utf8');
  const { events } = parseSportJs(text);
  assert.equal(renderSportJs(parseSportJs(text)), text, 'файл в том виде, в каком его пишет football.mjs');
  const ids = new Set();
  for (const e of events) {
    assert.match(e.id, /^ev-fb-[a-z0-9-]+-\d{8}$/);
    assert.ok(!ids.has(e.id), `дубль ${e.id}`);
    ids.add(e.id);
    assert.equal(e.cat, 'sport');
    assert.equal(e.sub, 'football');
    assert.equal(e.emoji, '⚽');
    assert.ok(['msk', 'spb'].includes(e.city), e.id);
    assert.ok(STATIONS[e.city][e.metro], `${e.id}: метро «${e.metro}»`);
    assert.ok(e.time ? /^\d{2}:\d{2}$/.test(e.time) && !e.tbc : e.tbc === true, e.id);
    assert.ok(e.start === e.end || (e.tbc && e.start < e.end), e.id);
    assert.match(e.url, /^https:\/\//);
    assert.ok(e.note.length <= 180, e.id);
    assert.ok(Array.isArray(e.teams) && e.teams.length === 2 && e.title === e.teams.join(' — '), e.id);
  }
  assert.deepEqual(events.map(e => e.id), sortEvents(events).map(e => e.id));
  assert.doesNotMatch(text, /t\.me\/|telegram|телеграм/i);
  // в events.js футбола больше нет — иначе матч покажется дважды
  const sb = { window: {} };
  vm.runInNewContext(readFileSync(path.join(ROOT, 'assets', 'events.js'), 'utf8'), sb);
  const football = Array.from(sb.window.KUDA_EVENTS).filter(e => e.emoji === '⚽' || /футбол|РПЛ/i.test(e.title));
  assert.deepEqual(football.map(e => e.id), []);
  const legacy = Object.values(LEGACY_IDS).flat();
  assert.ok(!sb.window.KUDA_EVENTS.some(e => legacy.includes(e.id)));
  // старые приглашения на матч из events.js открываются: DateKit.eventById находит матч по id из aka
  const win = {
    location: { search: '', href: 'https://example.org/start.html', pathname: '/start.html', hash: '' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, navigator: {},
    addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], documentElement: { dataset: {}, classList: { add() {}, remove() {} } } },
  };
  win.window = win;
  const site = vm.createContext(win);
  for (const f of ['assets/shared.js', 'assets/events.js', 'assets/sport.js']) vm.runInContext(readFileSync(path.join(ROOT, f), 'utf8'), site, { filename: f });
  for (const [id, old] of Object.entries(LEGACY_IDS)) {
    if (!events.some(e => e.id === id)) continue;
    for (const o of old) assert.equal((win.DateKit.eventById(o) || {}).id, id, `${o} → ${id}`);
  }
  assert.equal(win.DateKit.eventById('ev-fb-nope-nope-20261018'), null);
});

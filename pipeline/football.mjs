#!/usr/bin/env node
/* Футбол «для пацанов»: ближайшие матчи РПЛ, Кубка России и сборной на стадионах Москвы, Подмосковья и Петербурга
   → assets/sport.js (файл пересобирается целиком). Модель не нужна: открытые данные русской Википедии через её API
   (автоматический доступ там разрешён) + таблицы команд, стадионов и ручных поправок в pipeline/lib/football.mjs.
   ─ РПЛ: пары и номера туров — шаблон «Результаты матчей чемпионата России по футболу <сезон>» (по календарю
     premierliga.ru); день и время — статьи клубов «ФК … в сезоне <сезон>» (со ссылками на протоколы РПЛ).
   ─ Кубок России — статья «Кубок России по футболу <сезон>» (у матчей там протоколы rfs.ru).
   ─ Сборная — «Матчи сборной России по футболу <год>».
   Официальные premierliga.ru, rfs.ru и сайты клубов не отвечают зарубежным серверам (GitHub Actions работает за
   рубежом), а открытые JSON спортивных медиа их правила запрещают читать роботом.
   Сбой источника — assets/sport.js не трогаем, код выхода 1. Справка: node pipeline/football.mjs --help */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  UA, addDays, moscowToday, seasonOf, seasonsBetween, yearsBetween, parseWikiMatches, parseWikiResults, rplSchedule,
  seasonClubKey, toEvent, mergeEvents, renderSportJs, parseSportJs,
} from './lib/football.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

export const WIKI_API = 'https://ru.wikipedia.org/w/api.php';
export const wikiTitles = (today, until) => ({
  cup: seasonsBetween(today, until).map(s => `Кубок России по футболу ${s}`),
  rpl: seasonsBetween(today, until).map(s => `Шаблон:Результаты матчей чемпионата России по футболу ${s}`),
  nt: yearsBetween(today, until).map(y => `Матчи сборной России по футболу ${y}`),
});
/* Поиск статей клубов о сезоне: «ФК «Спартак» Москва в сезоне 2026/2027», «ФК ЦСКА Москва в сезоне 2026/2027» */
export const clubSearch = season => `intitle:"в сезоне ${season}" intitle:ФК`;

const USAGE = `Футбол «Куда идём?»: матчи в Москве и Петербурге → assets/sport.js

  node pipeline/football.mjs [флаги]

  --repo <папка>      корень сайта, где лежит assets/ (по умолчанию — этот репозиторий)
  --days N            на сколько дней вперёд (120)
  --today ГГГГ-ММ-ДД  считать сегодняшней эту дату (для воспроизведения запусков)
  --report <файл>     отчёт в Markdown (для описания PR)
  --dry               ничего не записывать, только показать

Последняя строка вывода — CHANGES=1 (файл изменился) или CHANGES=0.
Код выхода 1 — источник не ответил или ответил не то: assets/sport.js при этом не меняется.`;

export function parseArgs(argv) {
  const o = { repo: REPO, days: 120, today: '', report: '', dry: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => {
      const x = argv[++i];
      if (x == null || x.startsWith('--')) throw new Error(`флагу ${a} нужно значение`);
      return x;
    };
    if (a === '--repo') o.repo = path.resolve(v());
    else if (a === '--days') o.days = +v();
    else if (a === '--today') o.today = v();
    else if (a === '--report') o.report = v();
    else if (a === '--dry') o.dry = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`неизвестный флаг ${a} (см. --help)`);
  }
  if (!Number.isInteger(o.days) || o.days < 1 || o.days > 400) throw new Error('--days: целое число от 1 до 400');
  if (o.today && !/^\d{4}-\d{2}-\d{2}$/.test(o.today)) throw new Error('--today: дата в виде ГГГГ-ММ-ДД');
  return o;
}

const sleep = ms => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve());

/* GET с повтором: сеть, 429 и 5xx — до трёх попыток; остальные ошибки — сразу. Возвращает текст ответа */
async function get(fetchFn, url, { accept = 'application/json', pause = 1500 } = {}) {
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res;
    try {
      res = await fetchFn(url, { headers: { 'user-agent': UA, accept }, signal: AbortSignal.timeout(30000) });
    } catch (e) {
      last = `нет связи (${e && e.message ? e.message : e})`;
      await sleep(pause * attempt);
      continue;
    }
    if (res.ok) return await res.text();
    last = `HTTP ${res.status}`;
    if (res.status !== 429 && res.status < 500) break;
    await sleep(pause * attempt);
  }
  throw new Error(`${new URL(url).host}: ${last}`);
}
async function wikiApi(fetchFn, params, opts) {
  const q = new URLSearchParams(Object.assign({ format: 'json', formatversion: '2' }, params));
  const t = await get(fetchFn, `${WIKI_API}?${q}`, opts);
  let j;
  try { j = JSON.parse(t); } catch (e) { throw new Error('ru.wikipedia.org: ответ не JSON'); }
  if (j && j.error) throw new Error(`ru.wikipedia.org: ${j.error.code || 'ошибка'} — ${j.error.info || ''}`.trim());
  if (!j || !j.query) throw new Error('ru.wikipedia.org: неожиданный ответ API');
  return j;
}

/* Статьи клубов РПЛ о сезоне: названия из поиска, только клубы из TEAMS */
export async function findClubArticles(fetchFn, season, opts) {
  const j = await wikiApi(fetchFn, { action: 'query', list: 'search', srsearch: clubSearch(season), srnamespace: '0', srlimit: '100', srprop: '' }, opts);
  if (!Array.isArray(j.query.search)) throw new Error('ru.wikipedia.org: неожиданный ответ поиска');
  const re = new RegExp(`в сезоне ${season.replace('/', '\\/')}$`);
  return [...new Set(j.query.search.map(r => r && r.title).filter(t => t && re.test(t) && seasonClubKey(t)))].sort();
}

/* Тексты статей Википедии (по 50 за запрос): { название: { text, ts } | null }. Нет статьи — null
   (это не ошибка: сезона или года может ещё не быть) */
export async function fetchWiki(fetchFn, titles, opts) {
  const out = {};
  for (let i = 0; i < titles.length; i += 50) {
    const part = titles.slice(i, i + 50);
    const j = await wikiApi(fetchFn, {
      action: 'query', prop: 'revisions', rvprop: 'content|timestamp', rvslots: 'main', redirects: '1', titles: part.join('|'),
    }, opts);
    if (!Array.isArray(j.query.pages)) throw new Error('ru.wikipedia.org: неожиданный ответ API');
    const alias = new Map();
    for (const x of [...(j.query.normalized || []), ...(j.query.redirects || [])]) alias.set(x.from, x.to);
    const byTitle = new Map(j.query.pages.map(p => [p.title, p]));
    for (const t of part) {
      let cur = t;
      for (let k = 0; k < 3 && alias.has(cur); k++) cur = alias.get(cur);
      const p = byTitle.get(cur);
      const rev = p && !p.missing && Array.isArray(p.revisions) ? p.revisions[0] : null;
      const content = rev && (rev.slots ? rev.slots.main && rev.slots.main.content : rev.content);
      out[t] = typeof content === 'string' ? { text: content, ts: rev.timestamp || '' } : null;
    }
  }
  return out;
}

const fmtDay = d => { const [y, m, dd] = d.split('-'); return `${dd}.${m}.${y}`; };

export async function main(argv = process.argv.slice(2), deps = {}) {
  const out = deps.log || (s => console.log(s));
  const fetchFn = deps.fetch || globalThis.fetch;
  const pause = deps.pause != null ? deps.pause : 1500;
  const o = parseArgs(argv);
  if (o.help) { out(USAGE); return { help: true }; }
  const today = o.today || moscowToday(deps.now ? deps.now() : new Date());
  const until = addDays(today, o.days);
  const file = path.join(o.repo, 'assets', 'sport.js');
  const warnings = [];
  const warn = s => { if (!warnings.includes(s)) warnings.push(s); };

  let prevText = '';
  try { prevText = await fs.readFile(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let prev = { updated: '', events: [] };
  try { prev = parseSportJs(prevText); } catch (e) { warn(`прошлый assets/sport.js не читается (${e.message}) — пересобираю с нуля`); }

  out(`Футбол: матчи с ${fmtDay(today)} по ${fmtDay(until)}`);
  const raw = [];
  const gonePairs = [];                                          // [сезон, 'хозяева|гости'] — уже сыграно
  const stat = { clubs: 0, boxes: 0, rpl: 0, exact: 0, tours: 0, cup: 0, nt: 0 };
  try {
    const T = wikiTitles(today, until);
    const seasons = seasonsBetween(today, until);
    const clubs = {};
    for (const s of seasons) clubs[s] = await findClubArticles(fetchFn, s, { pause });
    const wiki = await fetchWiki(fetchFn, [...T.cup, ...T.rpl, ...T.nt, ...seasons.flatMap(s => clubs[s])], { pause });

    for (const t of T.cup) {
      if (!wiki[t]) continue;
      const list = parseWikiMatches(wiki[t].text, 'cup');
      if (!list.length) warn(`Википедия, «${t}»: не нашёл ни одного матча — поменялась разметка статьи?`);
      stat.cup += list.filter(m => m.date >= today).length;
      raw.push(...list);
    }
    seasons.forEach((s, i) => {
      const tpl = wiki[T.rpl[i]];
      if (!tpl) return;
      const { tours, played } = parseWikiResults(tpl.text);
      played.forEach(p => gonePairs.push([s, p]));
      stat.tours += tours.size;
      if (!tours.size && !played.size) { warn(`Википедия, «${T.rpl[i]}»: не разобрал ни одной пары — поменялась разметка шаблона?`); return; }
      const articles = clubs[s].filter(t => wiki[t]).map(t => ({ title: t, text: wiki[t].text, ts: wiki[t].ts }));
      stat.clubs += articles.length;
      if (tours.size && !articles.length) warn(`Википедия: статей клубов о сезоне ${s} не нашёл — дни матчей РПЛ только из FIXES`);
      const r = rplSchedule({ articles, tours, today, until, warn });
      r.played.forEach(p => gonePairs.push([s, p]));
      if (articles.length && !r.stat.boxes) warn(`Википедия: в статьях клубов о сезоне ${s} не разобрал ни одного матча РПЛ — поменялась разметка?`);
      stat.boxes += r.stat.boxes;
      stat.rpl += r.matches.length;
      stat.exact += r.stat.exact;
      raw.push(...r.matches);
    });
    for (const t of T.nt) {
      if (!wiki[t]) continue;
      const list = parseWikiMatches(wiki[t].text, 'nt');
      stat.nt += list.filter(m => m.date >= today).length;
      raw.push(...list);
    }
  } catch (e) {
    out(`Ошибка источника: ${e.message}. assets/sport.js не трогаю.`);
    out('CHANGES=0');
    return { fatal: e.message };
  }

  const prevById = new Map(prev.events.filter(e => e && e.id).map(e => [e.id, e]));
  const gone = new Set();
  // сыгранные пары РПЛ: их матчи из прошлого файла больше не держим (а свежими они и не придут)
  for (const e of prev.events) {
    if (!e || !e.id || e.league !== 'РПЛ' || !e.start) continue;
    if (gonePairs.some(([s, p]) => s === seasonOf(e.start) && e.id.startsWith(`ev-fb-${p.replace('|', '-')}-`) && /^\d{8}$/.test(e.id.slice(`ev-fb-${p.replace('|', '-')}-`.length)))) gone.add(e.id);
  }
  const ctx = { today, until, prev: prevById, gone, warn };
  const fresh = [];
  for (const m of raw) {
    const ev = toEvent(m, ctx);
    if (ev && !fresh.some(x => x.id === ev.id)) fresh.push(ev);
  }
  const { events: merged, kept } = mergeEvents({ fresh, previous: prev.events, gone, today, until });
  /* Прошедшие матчи сайт прячет сам, поэтому ради одного их удаления файл не переписываем (иначе PR — после каждого тура):
     они уйдут при следующем настоящем изменении. Дата updated меняется только вместе с матчами */
  const ahead = list => JSON.stringify(list.filter(e => e && (e.end || e.start) >= today));
  const same = !!prevText && !!prev.updated && ahead(merged) === ahead(prev.events)
    && renderSportJs(prev) === prevText;                       // и сам файл в нашем формате (шапку и код слияния не правили)
  const events = same ? prev.events : merged;
  const text = same ? prevText : renderSportJs({ updated: today, events });
  const changed = text !== prevText;
  const upcoming = events.filter(e => (e.end || e.start) >= today);

  const newIds = new Set(events.map(e => e.id));
  const added = events.filter(e => !prevById.has(e.id));
  const removed = prev.events.filter(e => e && e.id && !newIds.has(e.id));
  const by = c => upcoming.filter(e => e.city === c).length;
  const open = upcoming.filter(e => e.start !== e.end).length;
  out(`Википедия: статей клубов о сезоне ${stat.clubs} (матчей РПЛ в них ${stat.boxes}), несыгранных пар РПЛ ${stat.tours}; матчей РПЛ наших команд в окне — ${stat.rpl}, из них с точным днём ${stat.exact}; кубок — ${stat.cup} впереди, сборная — ${stat.nt}`);
  out(`В assets/sport.js впереди ${upcoming.length} матчей (Москва ${by('msk')}, Петербург ${by('spb')}, без назначенного дня ${open}); новых ${added.length}, убрано ${removed.length}, оставлено из прошлого файла ${kept.length}`);
  warnings.forEach(w => out(`⚠️ ${w}`));

  const when = e => (e.start !== e.end ? `${fmtDay(e.start)}–${fmtDay(e.end)}, день уточняется` : `${fmtDay(e.start)} ${e.time || 'время уточняется'}`);
  const line = e => `${when(e)} — ${e.title} (${e.league}${e.tour ? ', ' + e.tour : ''}), ${e.venue}`;
  const report = [
    `## Футбол: расписание на ${fmtDay(today)}`, '',
    `Матчи на стадионах Москвы, Подмосковья и Петербурга с ${fmtDay(today)} по ${fmtDay(until)}: **${upcoming.length}** (Москва ${by('msk')}, Петербург ${by('spb')}).`,
    'Источник — русская Википедия: шаблон результатов РПЛ (туры), статьи клубов о сезоне (дни и время РПЛ), статьи Кубка России и матчей сборной; плюс ручные поправки FIXES в pipeline/lib/football.mjs. Проверьте даты и время по сайту клуба или РПЛ.', '',
    ...(added.length ? ['### Новые', ...added.map(e => `- ${line(e)}`), ''] : []),
    ...(removed.length ? ['### Убраны (прошли, перенесены или пропали из источника)', ...removed.map(e => `- ${line(e)}`), ''] : []),
    ...(kept.length ? ['### Оставлены из прошлого файла (источник сейчас их не показывает)', ...kept.map(e => `- ${line(e)}`), ''] : []),
    ...(warnings.length ? ['### Предупреждения', ...warnings.map(w => `- ${w}`), ''] : []),
    '### Все матчи', ...upcoming.map(e => `- ${line(e)}${e.city === 'spb' ? ' · Петербург' : ''}`), '',
  ].join('\n');
  if (o.report) await fs.writeFile(path.resolve(o.report), report);
  if (changed && !o.dry) await fs.writeFile(file, text);
  out(o.dry && changed ? 'Пробный запуск: файл не записан' : changed ? 'assets/sport.js обновлён' : 'assets/sport.js без изменений');
  out(`CHANGES=${changed && !o.dry ? 1 : 0}`);
  return { events, added, removed, kept, warnings, changed, text, report, stat };
}

/* ---------- CLI ---------- */

const isCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isCli) {
  main().then(r => {
    if (r && r.fatal) { console.error(`Ошибка: ${r.fatal}`); process.exitCode = 1; }
  }, e => {
    console.error(`Ошибка: ${e && e.message ? e.message : e}`);
    process.exitCode = 1;
  });
}

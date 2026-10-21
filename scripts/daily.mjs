#!/usr/bin/env node
/* Ежедневное обслуживание каталога «Куда идём?» (запускает задача на ноутбуке в 20:00, после конвейера pipeline/run.mjs).
     node scripts/daily.mjs [--today YYYY-MM-DD] [--no-photos] [--no-seo] [--dry]
       1) прошедшие события — вон из assets/events.js и events-spb.js (последний день раньше сегодняшнего по Москве);
       2) подборки редакции с истёкшим until — вон из assets/collections.js;
       3) подборки к праздникам — scripts/occasions.mjs (assets/collections-auto.js);
       4) добор фото — scripts/photos-daily.mjs (фото потом смотрят глазами: scripts/photos-review.mjs);
       5) данные поменялись — поднимаем ?v= на страницах (иначе service worker отдаёт старые файлы из кэша),
          фото заменены или удалены — поднимаем VERSION в sw.js (старые снимки уходят из кэша у всех);
       6) страницы для поисковиков — scripts/build-seo.mjs.
     node scripts/daily.mjs --publish [--today …] — ветка auto/daily-<дата>, коммит, push и Pull Request (после осмотра фото).
   Сайт и сам прячет прошедшее, но в данных и на страницах поисковиков ему делать нечего. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const has = k => ARGS.includes(k);
const arg = k => { const i = ARGS.indexOf(k); return i >= 0 ? ARGS[i + 1] : ''; };
const TODAY = arg('--today') || new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const DRY = has('--dry');
const GIT = fs.existsSync('/Library/Developer/CommandLineTools/usr/bin/git') ? '/Library/Developer/CommandLineTools/usr/bin/git' : 'git';
const GH = fs.existsSync('/Users/mac/.local/bin/gh') ? '/Users/mac/.local/bin/gh' : 'gh';
const ENV = { ...process.env, PATH: path.dirname(GIT) + ':' + process.env.PATH };
const gitRaw = (...a) => execFileSync(GIT, ['-C', ROOT, ...a], { encoding: 'utf8', env: ENV });
const git = (...a) => gitRaw(...a).trim();
/* строки git status --porcelain: «XY путь» — первый пробел значимый, trim нельзя */
const status = (...paths) => gitRaw('status', '--porcelain', '--', ...paths).split('\n').filter(Boolean);
/* JS-файл данных после правки должен оставаться разбираемым — иначе не пишем */
const parses = src => { try { new Function(src); return true; } catch { return false; } };
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const write = (f, s) => { if (!DRY) fs.writeFileSync(path.join(ROOT, f), s); };
const log = [];

/* последний день события: dates, end или start */
export function lastDay(line) {
  const ds = (/dates: \[([^\]]*)\]/.exec(line) || [])[1];
  const all = [...(ds || '').matchAll(/"(\d{4}-\d\d-\d\d)"/g)].map(m => m[1]);
  const end = (/\bend: "(\d{4}-\d\d-\d\d)"/.exec(line) || [])[1], start = (/\bstart: "(\d{4}-\d\d-\d\d)"/.exec(line) || [])[1];
  return [...all, end, start].filter(Boolean).sort().pop() || '';
}
/* 1) события: одна строка — одно событие */
export function pruneEvents(src, today) {
  const gone = [];
  const out = src.split('\n').filter(l => {
    // только запись целиком в одной строке: «{ id: "ev-…", … },» — многострочные не трогаем
    if (!/^\s*\{ id: "ev-.*\},?\s*$/.test(l)) return true;
    const last = lastDay(l);
    if (last && last < today) { gone.push((/id: "([^"]+)"/.exec(l) || [])[1]); return false; }
    return true;
  }).join('\n');
  return { out, gone };
}
/* 2) подборки редакции: блоки «  {» … «  },» */
export function pruneCollections(src, today) {
  const lines = src.split('\n'), out = [], gone = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== '  {') { out.push(lines[i]); continue; }
    let j = i;
    while (j < lines.length && !/^  \},?\s*(\/\/.*)?$/.test(lines[j])) j++;
    if (j >= lines.length) { out.push(...lines.slice(i)); break; }   // конца блока нет — остаток не трогаем
    // комментарии не считаем: «// until: …» не должно удалять подборку
    const block = lines.slice(i, j + 1).map(l => l.replace(/\s\/\/.*$/, '')).join('\n');
    const until = (/\buntil: '(\d{4}-\d\d-\d\d)'/.exec(block) || [])[1];
    if (until && until < today) gone.push((/id: '([^']+)'/.exec(block) || [])[1]);
    else out.push(...lines.slice(i, j + 1));
    i = j;
  }
  return { out: out.join('\n'), gone };
}

/* fatal — ошибка скрипта останавливает обслуживание и публикацию (подборки, SEO); добор фото — нет */
function run(script, args = [], { fatal = false } = {}) {
  const r = spawnSync(process.execPath, [path.join(ROOT, script), ...args], { cwd: ROOT, encoding: 'utf8', env: ENV });
  const text = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) {
    const msg = `${script}: ошибка (код ${r.status}) — ${text.trim().split('\n').slice(-3).join(' / ')}`;
    log.push(msg);
    if (fatal) { console.error(msg); process.exit(1); }
  }
  return text;
}
const pick = (text, key) => ((new RegExp('^' + key + '=(.*)$', 'm').exec(text) || [])[1] || '').trim();

/* 5) версии: ?v= — на единицу выше, чем в main (один раз на PR); VERSION в sw.js — дата запуска */
function bumpVersions() {
  let base = '', baseSw = '';
  try { git('fetch', '-q', 'origin', 'main'); } catch { /* без сети — сравним с тем, что есть */ }
  try { base = git('show', 'origin/main:start.html'); baseSw = git('show', 'origin/main:sw.js'); } catch { /* нет origin/main — считаем от текущей */ }
  const cur = +((/\?v=(\d+)/.exec(read('start.html')) || [])[1] || 0);
  const main = +((/\?v=(\d+)/.exec(base) || [])[1] || cur);
  const changed = status('assets');
  if (changed.some(l => /assets\/[^/]+\.(js|css)$/.test(l)) && cur <= main) {
    for (const f of fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))) write(f, read(f).split(`?v=${cur}`).join(`?v=${main + 1}`));
    log.push(`?v=${main + 1} на страницах`);
  }
  // заменённые или удалённые фото — старые копии живут в кэше service worker, пока не сменится VERSION
  if (changed.some(l => /[MD]/.test(l.slice(0, 2)) && l.slice(3).startsWith('assets/ph/'))) {
    // новая VERSION, если она ещё та же, что в main: в тот же день — следующий номер (…​.2), иначе — <сегодня>.1
    const sw = read('sw.js'), v = (/const VERSION = '([^']+)'/.exec(sw) || [])[1] || '';
    const vMain = (/const VERSION = '([^']+)'/.exec(baseSw) || [])[1] || v;
    const n = v.startsWith(TODAY + '.') ? +v.slice(TODAY.length + 1) || 1 : 0;
    const next = v !== vMain ? v : `${TODAY}.${n + 1}`;
    if (next !== v) { write('sw.js', sw.replace(`const VERSION = '${v}'`, `const VERSION = '${next}'`)); log.push(`sw.js VERSION ${next}`); }
  }
}

function publish() {
  if (DRY) { console.error('--publish и --dry вместе не бывают'); process.exit(1); }
  // в коммит — только файлы сайта, которые меняет обслуживание; посторонние изменения (в том числе уже в индексе) не берём
  const paths = ['assets', 'scripts/photos-blocked.json', 'scripts/occasion-dates.json', 'sw.js', 'sitemap.xml', 'robots.txt', 'moskva', 'spb',
    ...fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))].filter(f => fs.existsSync(path.join(ROOT, f)));
  if (!status(...paths).length) { console.log('DAILY_PR=нет изменений'); return; }
  const other = status().filter(l => !paths.some(p => l.slice(3).startsWith(p)));
  if (other.length) log.push('не вошло в коммит (посторонние изменения): ' + other.map(l => l.slice(3)).join(', '));
  // после осмотра фото (photos-review --reject) страницы для поисковиков пересобираем — в них не должно остаться снятых снимков
  run('scripts/build-seo.mjs', [], { fatal: true });
  // ветка: auto/daily-<дата>, а если такая уже есть на GitHub — следующая свободная (-2, -3…); force-push не делаем
  const taken = n => { try { return !!git('ls-remote', '--heads', 'origin', n); } catch { return false; } };
  let branch = `auto/daily-${TODAY}`;
  for (let k = 2; taken(branch) && k < 10; k++) branch = `auto/daily-${TODAY}-${k}`;
  git('checkout', '-B', branch);
  git('add', '-A', '--', ...paths);
  const body = (fs.existsSync(path.join(ROOT, '.daily-report.md')) ? read('.daily-report.md') : 'Ежедневное обслуживание каталога.') + (log.length ? '\n' + log.map(l => '- ' + l).join('\n') + '\n' : '');
  git('commit', '-q', '-m', `Ежедневное обновление ${TODAY}`, '-m', body.slice(0, 3000), '--', ...paths);
  execFileSync(GIT, ['-C', ROOT, '-c', 'credential.helper=', '-c', `credential.helper=!${GH} auth git-credential`, 'push', '-q', '-u', 'origin', branch], { env: ENV });
  const url = execFileSync(GH, ['pr', 'create', '--repo', 'kirillpavlov-21/love', '--base', 'main', '--head', branch, '--title', `Ежедневное обновление ${TODAY}`, '--body', body], { cwd: ROOT, encoding: 'utf8', env: ENV }).trim();
  console.log(`DAILY_PR=${url}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (has('--publish')) publish();
  else {
    const report = [`# Ежедневное обновление ${TODAY}`, ''];
    let evGone = [];
    for (const f of ['assets/events.js', 'assets/events-spb.js']) {
      const r = pruneEvents(read(f), TODAY);
      if (r.gone.length && !parses(r.out)) { log.push(`${f}: после чистки файл не разбирается — не трогаю`); continue; }
      if (r.gone.length) { write(f, r.out); evGone = evGone.concat(r.gone); }
    }
    const rc = pruneCollections(read('assets/collections.js'), TODAY);
    if (rc.gone.length && !parses(rc.out)) { log.push('assets/collections.js: после чистки файл не разбирается — не трогаю'); rc.gone = []; }
    if (rc.gone.length) write('assets/collections.js', rc.out);
    report.push(`- прошедших событий убрано: ${evGone.length}`, `- истёкших подборок убрано: ${rc.gone.length}${rc.gone.length ? ' (' + rc.gone.join(', ') + ')' : ''}`);

    const occ = run('scripts/occasions.mjs', ['--today', TODAY, ...(DRY ? ['--dry'] : [])], { fatal: true });
    report.push(`- подборки к поводам: ${pick(occ, 'OCCASION_ACTIVE') || 'нет'}; новые: ${pick(occ, 'OCCASION_ADDED') || 'нет'}; убраны: ${pick(occ, 'OCCASION_REMOVED') || 'нет'}`);
    if (!has('--no-photos') && !DRY) {
      const ph = run('scripts/photos-daily.mjs', ['--limit', '40']);
      report.push(`- фото добавлено: ${pick(ph, 'PHOTOS_ADDED') || '0'}`);
    }
    if (!DRY) bumpVersions();
    if (!has('--no-seo') && !DRY) {
      const seo = run('scripts/build-seo.mjs', [], { fatal: true });
      report.push('- страницы для поисковиков: ' + ((/файлов \d+.*$/m.exec(seo) || [''])[0]));
    }
    report.push(...log.map(l => '- ' + l));
    if (!DRY) fs.writeFileSync(path.join(ROOT, '.daily-report.md'), report.join('\n') + '\n');
    console.log(report.join('\n'));
    console.log(occ.split('\n').filter(l => /^OCCASION_(SOON|CHECK_DATE)=/.test(l)).join('\n'));
    console.log(`DAILY_CHANGED=${status().length}`);
  }
}

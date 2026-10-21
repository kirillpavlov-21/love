#!/usr/bin/env node
/* Проверка живого сайта на устаревшее (задача на ноутбуке в 20:30): что видит посетитель прямо сейчас.
     node scripts/check-site.mjs [--site https://kirillpavlov-21.github.io/love/] [--today YYYY-MM-DD] [--pages 60]
   Берёт с сайта start.html и файлы данных с тем же ?v=, что у страницы, и ищет:
     ─ прошедшие события, которые ещё лежат в данных (сайт их прячет, но в данных и у поисковиков им не место);
     ─ подборки с истёкшим until и подборки к праздникам, которые уже должны были уйти или появиться (scripts/occasions.mjs);
     ─ фото из photos.js, которых нет на сайте (404);
     ─ страницы из sitemap.xml, которые не открываются (выборка --pages, подборки — все).
   Итог — строки ISSUE: … и CHECK_ISSUES=<число>; чинит scripts/daily.mjs + PR (это решает задача). Сеть только GET к сайту. */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { occasionsOn } from './occasions.mjs';
import { lastDay } from './daily.mjs';

const ARGS = process.argv.slice(2);
const arg = k => { const i = ARGS.indexOf(k); return i >= 0 ? ARGS[i + 1] : ''; };
const SITE = (arg('--site') || 'https://kirillpavlov-21.github.io/love/').replace(/\/?$/, '/');
const TODAY = arg('--today') || new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const PAGES = +arg('--pages') || 60;
const UA = 'KudaIdemCheck/1.0 (+https://kirillpavlov-21.github.io/love/)';
const issues = [];
const issue = s => { issues.push(s); console.log('ISSUE: ' + s); };

async function get(u, { head = false } = {}) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(u, { method: head ? 'HEAD' : 'GET', headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (r.status >= 500 && t < 2) { await new Promise(res => setTimeout(res, 1500)); continue; }
      return { status: r.status, text: head ? '' : await r.text() };
    } catch (e) { if (t === 2) return { status: 0, text: '', err: e.message }; }
  }
}
/* пачки по n параллельных запросов — сайт на GitHub Pages, не долбим */
async function pool(list, n, fn) { for (let i = 0; i < list.length; i += n) await Promise.all(list.slice(i, i + n).map(fn)); }

const start = await get(SITE + 'start.html');
if (start.status !== 200) { issue(`start.html не открывается (HTTP ${start.status}${start.err ? ', ' + start.err : ''})`); console.log(`CHECK_ISSUES=${issues.length}`); process.exit(0); }
const scripts = [...start.text.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s));
const want = ['config.js', 'assets/shared.js', 'assets/places.js', 'assets/places-spb.js', 'assets/events.js', 'assets/events-spb.js', 'assets/auto.js', 'assets/collections.js', 'assets/collections-auto.js', 'assets/photos.js'];
const src = {};
for (const f of want) {
  const s = scripts.find(x => x.split('?')[0] === f) || f;
  const r = await get(SITE + s);
  if (r.status === 200) src[f] = r.text;
  else if (!/collections-auto/.test(f)) issue(`${s} не открывается (HTTP ${r.status})`);
}

// данные в песочнице с часами на полдень сегодняшнего дня по Москве
const noop = () => {}, store = { getItem: () => null, setItem: noop, removeItem: noop };
const sb = { console: { log: noop, warn: noop, error: noop }, setTimeout, clearTimeout, URL, URLSearchParams, TextEncoder, TextDecoder,
  location: { href: SITE + 'start.html', origin: new URL(SITE).origin, pathname: new URL(SITE).pathname + 'start.html', search: '', hash: '' },
  navigator: {}, document: { addEventListener: noop, documentElement: { dataset: {} }, querySelector: () => null }, localStorage: store, sessionStorage: store,
  addEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop }) };
sb.window = sb; sb.self = sb;
vm.createContext(sb);
sb.__clock = Date.parse(TODAY + 'T12:00:00+03:00');
vm.runInContext('(() => { Date.now = () => __clock; })();', sb);
for (const f of want) if (src[f]) { try { vm.runInContext(src[f], sb, { filename: f }); } catch (e) { issue(`${f} падает при загрузке: ${e.message}`); } }
const K = sb.KUDA || {}, E = sb.KUDA_EVENTS || [];

// 1) прошедшие события в данных
const past = E.filter(e => e && e.start && lastDay(`start: "${e.start}" end: "${e.end || ''}" dates: [${(e.dates || []).map(d => `"${d}"`).join(',')}]`) < TODAY);
if (past.length) issue(`прошедших событий в данных: ${past.length} (например, ${past.slice(0, 3).map(e => e.id).join(', ')})`);

// 2) подборки: истёкшие и к праздникам
const cols = (K.collections || []).filter(c => c && c.id);
const expired = cols.filter(c => c.until && c.until < TODAY);
if (expired.length) issue(`подборки с истёкшим сроком в данных: ${expired.map(c => c.id).join(', ')}`);
// даты поводов — с подтверждёнными поправками, как у генератора
let dates = {};
try { dates = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'occasion-dates.json'), 'utf8')); } catch { /* поправок нет */ }
const { active } = occasionsOn(TODAY, dates);
for (const { o, w } of active) for (const city of o.cities || ['msk', 'spb']) {
  const has = cols.some(c => c.occasion === o.slug && (c.city || (/^spb-/.test(c.id) ? 'spb' : 'msk')) === city && (!c.until || c.until >= TODAY));
  if (!has) issue(`нет подборки к поводу «${o.title}» (${city}, ${w.from}…${w.end}) — scripts/occasions.mjs её ещё не выложил или пунктов мало`);
}

// 3) фото из photos.js
const phs = Object.entries(K.places || {}).filter(([, p]) => p && p.ph && p.ph.s).map(([id, p]) => [id, p.ph.s]);
const miss = [];
await pool(phs, 8, async ([id, s]) => { const r = await get(SITE + s, { head: true }); if (r.status !== 200) miss.push(`${id} (${r.status})`); });
if (miss.length) issue(`нет файлов фото: ${miss.slice(0, 10).join(', ')}${miss.length > 10 ? ` и ещё ${miss.length - 10}` : ''}`);

// 4) страницы из sitemap.xml: подборки — все, остальное — выборка
const sm = await get(SITE + 'sitemap.xml');
if (sm.status !== 200) issue(`sitemap.xml не открывается (HTTP ${sm.status})`);
else {
  const locs = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  const isCol = u => /\/(moskva|spb)\/[^/]+\/$/.test(u) && !/\/m\//.test(u);
  const sample = [...locs.filter(isCol), ...locs.filter(u => !isCol(u)).sort(() => Math.random() - 0.5).slice(0, PAGES)];
  const bad = [];
  await pool(sample, 6, async u => { const r = await get(u, { head: true }); if (r.status !== 200) bad.push(`${u.replace(SITE, '')} (${r.status})`); });
  if (bad.length) issue(`страницы из sitemap не открываются: ${bad.slice(0, 10).join(', ')}${bad.length > 10 ? ` и ещё ${bad.length - 10}` : ''}`);
  console.log(`проверено страниц: ${sample.length} из ${locs.length}`);
}
console.log(`событий ${E.length}, подборок ${cols.length}, фото ${phs.length}`);
console.log(`CHECK_ISSUES=${issues.length}`);

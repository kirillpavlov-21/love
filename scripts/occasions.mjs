#!/usr/bin/env node
/* Подборки к праздникам и событиям: по календарю scripts/occasions-calendar.mjs за неделю до повода (поле before)
   собирает тематическую подборку на каждый город в assets/collections-auto.js, на следующий день после повода убирает её.
   Если у повода уже есть подборка редакции в assets/collections.js (поле occasion: '<slug>') — авто-подборку не делаем.
   Пункты: выбранные ежедневной задачей по постам каналов (~/.kuda/occasion-picks.json:
   { "<slug>": { "msk": ["id", …], "spb": […], "exclude": ["id", …] } }), события в дни повода, готовые планы и места
   по правилам повода; exclude — пункты, которые задача признала неподходящими (их не берём ни в одном городе).
     node scripts/occasions.mjs [--today YYYY-MM-DD] [--dry]
       → assets/collections-auto.js; строки OCCASION_* для ежедневной задачи:
         OCCASION_ACTIVE — подборки в сроке, OCCASION_SOON — поводы в ближайшие 14 дней до начала подборки (пора искать посты),
         OCCASION_CHECK_DATE — дата посчитана по правилу (approx) и не подтверждена в scripts/occasion-dates.json
     node scripts/occasions.mjs --posts <slug> [--days 30]
       → посты каналов из ~/.kuda/pipeline-data/sources.json за последние дни со словами повода —
         в ~/.kuda/occasion-posts/<slug>.json (имена каналов остаются только там, на сайт не попадают) */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { OCCASIONS, addDays } from './occasions-calendar.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const arg = k => { const i = ARGS.indexOf(k); return i >= 0 ? ARGS[i + 1] : ''; };
const KUDA = path.join(os.homedir(), '.kuda');
const OUT = 'assets/collections-auto.js';
const MAX_ITEMS = 14, MIN_ITEMS = 6;
const mskToday = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

/* ---------- даты поводов ---------- */
/* окно повода в году y: { start, end, from } с поправкой из scripts/occasion-dates.json ({ slug: { год: 'YYYY-MM-DD' } }) */
export function windowOf(o, y, dates = {}) {
  const fix = dates[o.slug] && dates[o.slug][y];
  const start = fix || o.date(y), end = addDays(start, (o.days || 1) - 1);
  return { year: y, start, end, from: addDays(start, -(o.before ?? 7)), confirmed: !o.approx || !!fix };
}
/* поводы, чья подборка в сроке на день today, и ближайшие (начало подборки в пределах soonDays) */
export function occasionsOn(today, dates = {}, soonDays = 14) {
  const y = +today.slice(0, 4), active = [], soon = [];
  for (const o of OCCASIONS) for (const yy of [y - 1, y, y + 1]) {
    const w = windowOf(o, yy, dates);
    if (today >= w.from && today <= w.end) active.push({ o, w });
    else if (w.from > today && w.from <= addDays(today, soonDays)) soon.push({ o, w });
  }
  return { active, soon };
}

/* ---------- каталог в песочнице, как на странице (часы — полдень дня today по Москве) ---------- */
function loadCatalog(today) {
  const noop = () => {};
  const store = { getItem: () => null, setItem: noop, removeItem: noop };
  const sb = { console, setTimeout, clearTimeout, URL, URLSearchParams, TextEncoder, TextDecoder,
    location: { href: 'https://example.invalid/', origin: 'https://example.invalid', pathname: '/', search: '', hash: '' },
    navigator: {}, document: { addEventListener: noop, documentElement: { dataset: {} }, querySelector: () => null },
    localStorage: store, sessionStorage: store, addEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop }) };
  sb.window = sb; sb.self = sb;
  vm.createContext(sb);
  sb.__clock = Date.parse(today + 'T12:00:00+03:00');
  vm.runInContext('(() => { Date.now = () => __clock; })();', sb);
  for (const f of ['config.js', 'assets/shared.js', 'assets/places.js', 'assets/places-spb.js', 'assets/events.js', 'assets/events-spb.js', 'assets/auto.js', 'assets/collections.js']) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), sb, { filename: f });
  }
  return { K: sb.DateKit, D: sb.KUDA, E: sb.KUDA_EVENTS || [] };
}

/* ---------- пункты подборки ---------- */
export function pickItems(o, w, city, { K, D, E }, picks = [], today, exclude = []) {
  const P = D.places || {}, pick = o.pick || {};
  const cityOf = x => K.cityOf(x);
  const okPlace = id => P[id] && !P[id].closed && !P[id].adult && !(D.adult || []).includes(id) && K.seasonOk(P[id]) && cityOf(id) === city;
  const okPlan = s => s && !s.single && K.planStops(s).length === (s.stops || []).length && K.seasonOk(s) && cityOf(s) === city;
  const plans = (D.scenarios || []).filter(okPlan);
  const out = [], seen = new Set();
  const skip = new Set(exclude);
  const add = id => { if (id && !seen.has(id) && !skip.has(id) && out.length < MAX_ITEMS) { seen.add(id); out.push(id); } };
  // 1) выбранное по постам каналов: только живые пункты каталога этого города
  for (const id of picks) {
    const plan = plans.find(s => s.id === id), ev = K.eventById(id);
    if (okPlace(id) || plan || (ev && cityOf(ev) === city && K.eventDays(ev, w.from).some(d => d <= w.end))) add(id);
  }
  // 2) события, которые идут в дни подборки
  const first = today > w.from ? today : w.from;
  if (pick.ev || pick.evText) {
    E.filter(ev => ev && cityOf(ev) === city && K.eventDays(ev, first).some(d => d <= w.end))
      .filter(ev => pick.evText ? pick.evText.test(ev.title + ' ' + (ev.note || '')) : (pick.ev || []).includes(ev.cat))
      .slice(0, 5).forEach(ev => add(ev.id));
  }
  // 3) готовые планы по тегам или названию
  if (pick.plan) {
    plans.filter(s => (pick.plan.tags || []).some(t => (s.tags || []).includes(t) || (s.hint || []).includes(t)) || (pick.plan.title && pick.plan.title.test(s.title)))
      .slice(0, 4).forEach(s => add(s.id));
  }
  // 4) места: подсказка или тип — сильный признак, слова в описании и раздел — слабые; с фото и из планов — выше
  const inPlans = new Map();
  (D.scenarios || []).forEach(s => (s.stops || []).forEach(id => inPlans.set(id, (inPlans.get(id) || 0) + 1)));
  const onlyCat = pick.cat && !pick.hint && !pick.kind && !pick.text;
  const scored = Object.keys(P).filter(okPlace).map(id => {
    const p = P[id], hints = new Set([...(p.hint || []), ...K.placeHints(p)]);
    let s = 0;
    if ((pick.hint || []).some(h => hints.has(h))) s += 2;
    if (pick.kind && pick.kind.test(p.kind || '')) s += 2;
    if (pick.text && pick.text.test(`${p.kind || ''} ${p.name || ''} ${p.note || ''}`)) s += 1;
    if ((pick.cat || []).includes(K.catOf(p))) s += onlyCat ? 2 : 1;
    return { id, s: s >= 2 ? s + (p.ph ? 0.5 : 0) + Math.min(inPlans.get(id) || 0, 3) * 0.2 : 0 };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s || a.id.localeCompare(b.id));
  scored.forEach(x => add(x.id));
  return out;
}

/* ---------- файл подборок ---------- */
function render(list, today) {
  const body = list.map(c => '  ' + JSON.stringify(c)).join(',\n');
  return `/* Подборки к праздникам и событиям — собирает scripts/occasions.mjs по календарю scripts/occasions-calendar.mjs.
   Не править руками: файл пересобирается каждый день, прошедшие поводы из него уходят. Формат — как в assets/collections.js.
   Обновлено: ${today}. Подключается после collections.js: подборки редакции с тем же id главнее. */
(function (K, L) {
  if (!K) return;
  const list = K.collections = Array.isArray(K.collections) ? K.collections : [];
  const have = new Set(list.map(c => c && c.id));
  for (const c of L) if (c && c.id && !have.has(c.id)) { list.push(c); have.add(c.id); }
})(window.KUDA, [
${body}${body ? '\n' : ''}]);
`;
}
const readOld = () => {
  try { const s = fs.readFileSync(path.join(ROOT, OUT), 'utf8'); return [...s.matchAll(/^  (\{.*\}),?$/gm)].map(m => JSON.parse(m[1])); } catch { return []; }
};

export function build(today, { dates = readJson(path.join(ROOT, 'scripts/occasion-dates.json'), {}), picks = readJson(path.join(KUDA, 'occasion-picks.json'), {}), data } = {}) {
  const cat = data || loadCatalog(today);
  const editorial = (cat.D.collections || []).filter(c => c && c.occasion);
  const { active, soon } = occasionsOn(today, dates);
  const list = [], notes = [];
  for (const { o, w } of active) for (const city of o.cities || ['msk', 'spb']) {
    const id = `${city === 'spb' ? 'spb-' : ''}c-o-${o.slug}-${w.year}`;
    // подборка редакции к поводу — если она в городе, уже видна сегодня и её срок захватывает дни повода (прошлогодняя не мешает)
    const ed = editorial.find(c => c.occasion === o.slug && (c.city || (/^spb-/.test(c.id) ? 'spb' : 'msk')) === city
      && (!c.until || c.until >= w.start) && (!c.from || c.from <= w.end) && (!c.from || c.from <= today));
    if (ed) { notes.push(`${id}: есть подборка редакции ${ed.id}`); continue; }
    const items = pickItems(o, w, city, cat, ((picks[o.slug] || {})[city]) || [], today, (picks[o.slug] || {}).exclude || []);
    if (items.length < MIN_ITEMS) { notes.push(`${id}: живых пунктов ${items.length} < ${MIN_ITEMS} — не делаем`); continue; }
    const lead = typeof o.lead === 'string' ? o.lead : (o.lead || {})[city] || '';
    list.push(Object.assign({ id, kind: 'editorial', emoji: o.emoji, title: o.title }, o.mode ? { mode: o.mode } : {},
      { occasion: o.slug, from: w.from, until: w.end, lead, items, updated: today }));
  }
  return { list, notes, active, soon };
}

/* ---------- посты каналов к поводу ---------- */
async function posts(slug, days) {
  const o = OCCASIONS.find(x => x.slug === slug);
  if (!o) { console.error(`нет повода ${slug}`); process.exit(1); }
  const { fetchChannel } = await import('../pipeline/lib/sources/telegram.mjs');
  const src = readJson(path.join(KUDA, 'pipeline-data/sources.json'), {});
  const chans = [...(src.telegram || []).map(c => ['msk', c]), ...(((src.cities || {}).spb || {}).telegram || []).map(c => ['spb', c])];
  const rx = o.words;   // только слова самого повода: общие слова («ночь») цепляют новости
  const since = Date.now() - days * 864e5, found = [];
  for (const [city, ch] of chans) {
    try {
      const { posts: ps } = await fetchChannel(ch, { maxPosts: 40, delayMs: 1500 });
      for (const p of ps) if ((!p.date || Date.parse(p.date) >= since) && rx.test(p.text)) found.push({ city, channel: ch, url: p.url, date: p.date, text: p.text.slice(0, 1500) });
    } catch (e) { console.error(`канал пропущен: ${e.message}`); }
  }
  const out = path.join(KUDA, 'occasion-posts', slug + '.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(found, null, 1));
  console.log(`OCCASION_POSTS=${found.length} → ${out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (ARGS.includes('--posts')) await posts(arg('--posts'), +arg('--days') || 30);
  else {
    const today = arg('--today') || mskToday();
    const { list, notes, active, soon } = build(today);
    const old = readOld(), had = new Set(old.map(c => c.id)), now = new Set(list.map(c => c.id));
    const text = render(list, today);
    if (!ARGS.includes('--dry')) {
      const prev = (() => { try { return fs.readFileSync(path.join(ROOT, OUT), 'utf8'); } catch { return ''; } })();
      // дата в шапке меняется каждый день — пишем только если поменялись сами подборки
      if (prev.replace(/Обновлено: \S+/, '') !== text.replace(/Обновлено: \S+/, '') || !prev) fs.writeFileSync(path.join(ROOT, OUT), text);
    }
    notes.forEach(n => console.log('  ' + n));
    console.log(`OCCASION_ACTIVE=${list.map(c => c.id).join(',')}`);
    console.log(`OCCASION_ADDED=${[...now].filter(id => !had.has(id)).join(',')}`);
    console.log(`OCCASION_REMOVED=${[...had].filter(id => !now.has(id)).join(',')}`);
    console.log(`OCCASION_SOON=${soon.map(({ o, w }) => `${o.slug}@${w.from}`).join(',')}`);
    console.log(`OCCASION_CHECK_DATE=${[...active, ...soon].filter(({ w }) => !w.confirmed).map(({ o, w }) => `${o.slug}@${w.start}`).join(',')}`);
  }
}

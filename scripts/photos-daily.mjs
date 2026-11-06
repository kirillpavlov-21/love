#!/usr/bin/env node
/* Ежедневный добор фото мест «Куда идём?» — только свободные лицензии (CC0, CC BY, CC BY-SA, FAL, общественное достояние)
   и только когда на снимке именно это место:
     1) Wikimedia Commons рядом с точкой места (до 150 м) — в названии файла есть слово из имени места;
     2) Commons по названию — файл с координатами не дальше 400 м или с городом в названии/описании;
     3) Openverse (фото Flickr под CC) — слово из имени места в заголовке и город в заголовке или тегах;
     4) заведению без своего снимка — фото его дома: Commons до 45 м, в названии файла улица и номер дома из адреса
        (строка с { b: 1 }, подпись «Фото здания»; один дом — одному месту, как и остальные снимки).
   Площадкам афиши без фото (их нет в каталоге или у места нет снимка) — так же, по названию площадки и её точке:
   строка «@<venue>» в photos.js, картинка assets/ph/v-<имя>.webp; у разных сцен одного театра — общий снимок.
   У заведений (еда, бары, бани…) название часто — обычное слово, поэтому для них только снимки с координатами рядом (шаги 1 и 2).
   Сохраняет assets/ph/<id>.webp (720 px) и assets/ph/t/<id>.webp (240×240), дописывает assets/photos.js.
   Лиц людей на сайте быть не должно: снимки из scripts/photos-blocked.json не берём, скачанные проверяем детектором лиц
   (pipeline/lib/faces.mjs) — с лицом фото не ставим и заносим в тот же список; мелкие лица потом ищут глазами (photos-review.mjs).
   Что уже искали — в ~/.kuda/photos-tried.json (повтор через 30 дней).
     node scripts/photos-daily.mjs [--limit 60] [--dry]                                   */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { findCommonsCandidates, freeLicense, cleanArtist, stripHtml, UA } from '../pipeline/lib/photos.mjs';
import { facesIn, loadBlocked, addBlocked, photoKey } from '../pipeline/lib/faces.mjs';
import { parseStations } from '../pipeline/lib/catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(path.join(ROOT, 'pipeline/package.json'))('sharp');
const ARGS = process.argv.slice(2);
const LIMIT = +(ARGS[ARGS.indexOf('--limit') + 1] || 0) || 60;
const DRY = ARGS.includes('--dry');
const BUILDING_OFF = ARGS.includes('--no-building');
// --only-building: только шаг 4 (фото дома) — и для мест, которые уже искали недавно
const ONLY_B = ARGS.includes('--only-building');
const TRIED_FILE = path.join(os.homedir(), '.kuda', 'photos-tried.json');
const TODAY = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const RETRY_DAYS = 30;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* один запуск за раз: параллельные пишут одни и те же webp и строки photos.js — подпись могла бы разойтись с картинкой */
const LOCK = path.join(os.homedir(), '.kuda', 'photos-daily.lock');
if (!DRY) {
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); }
  catch {
    const pid = +fs.readFileSync(LOCK, 'utf8');
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { /* процесса нет — замок остался от сбоя */ }
    if (alive) { console.error(`photos-daily уже идёт (pid ${pid}) — выхожу`); process.exit(1); }
    fs.writeFileSync(LOCK, String(process.pid));
  }
  process.on('exit', () => { try { if (fs.readFileSync(LOCK, 'utf8') === String(process.pid)) fs.rmSync(LOCK); } catch { /* ок */ } });
}

/* ---------- каталог ---------- */
const ctx = { window: {}, console };
vm.createContext(ctx);
// галереи (assets/gallery.js) — тоже: место с галереей уже с фото, а снимок галереи не отдаём другому месту
for (const f of ['assets/places.js', 'assets/places-spb.js', 'assets/events.js', 'assets/events-spb.js', 'assets/sport.js', 'assets/auto.js', 'assets/photos.js', 'assets/gallery.js']) if (fs.existsSync(path.join(ROOT, f))) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const K = ctx.window.KUDA, ADULT = new Set(K.adult || []);
// занятые и отклонённые снимки: файл Commons или страница фото
const usedRaw = Object.values(K.places).flatMap(p => [p.ph, ...(p.gal || [])].map(x => x && (x.file || x.u))).filter(Boolean).concat(Object.keys(loadBlocked(ROOT)));
const used = { keys: new Set(usedRaw.map(photoKey)), has(k) { return this.keys.has(photoKey(k)); }, add(k) { this.keys.add(photoKey(k)); } };
const inPlans = new Map();
(K.scenarios || []).forEach(s => (s.stops || []).forEach(id => inPlans.set(id, (inPlans.get(id) || 0) + 1)));
const tried = (() => { try { return JSON.parse(fs.readFileSync(TRIED_FILE, 'utf8')); } catch { return {}; } })();
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const todo = Object.entries(K.places)
  .filter(([id, p]) => p && !p.ph && !p.adult && !ADULT.has(id) && !p.closed && /^[a-z0-9-]+$/.test(id) && Number.isFinite(p.lat))
  .filter(([id]) => ONLY_B || !tried[id] || dayDiff(tried[id], TODAY) >= RETRY_DAYS)
  .sort((a, b) => (inPlans.get(b[0]) || 0) - (inPlans.get(a[0]) || 0))
  .slice(0, LIMIT);
/* площадки ближайшей афиши без фото: [ключ «@venue», псевдо-место { name: без «, Большая сцена», lat, lon, venue }] */
const vslug = s => 'v-' + String(s).toLowerCase().replace(/ё/g, 'е').replace(/[а-я]/g, c => TR[c] ?? c).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const venueTodoOf = () => {
  const seen = new Map();
  for (const e of ctx.window.KUDA_EVENTS || []) {
    if (!e || !e.venue || !Number.isFinite(e.lat) || (e.end || e.start || '') < TODAY || e.ph) continue;
    const p = e.place && K.places[e.place];
    if (p && p.ph) continue;
    if (!seen.has(e.venue)) seen.set(e.venue, { name: e.venue.split(',')[0].replace(/\s*\(.*\)$/, '').trim(), lat: e.lat, lon: e.lon, venue: e.venue, city: e.city === 'spb' || String(e.id).startsWith('ev-spb-') ? 'spb' : 'msk' });
  }
  return [...seen.values()].filter(v => ONLY_B || !tried['@' + v.venue] || dayDiff(tried['@' + v.venue], TODAY) >= RETRY_DAYS).slice(0, LIMIT);
};

/* ---------- сравнение названий ---------- */
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const STOP = new Set('и в на у с к по из от для the of a an and музей театр парк сад кафе бар ресторан зал баня бани клуб остров площадь набережная улица санкт петербург петербурга спб москва москвы имени им дворец собор центр дом кофейня пекарня галерея книжный магазин компьютерный бильярдная museum theatre theater park garden cafe bar restaurant club house'.split(' '));
const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
const toks = s => norm(s).split(' ').filter(w => w.length >= 4 && !STOP.has(w));
const lat = w => w.replace(/[а-я]/g, c => TR[c] ?? c);
const keysOf = name => [...new Set(toks(name).flatMap(w => [w.slice(0, 6), lat(w).slice(0, 6)]))];
const hasKey = (text, keys) => { const t = norm(text); const tl = lat(t); return keys.some(k => t.includes(k) || tl.includes(k)); };
const CITY_RX = { spb: /петербург|peterburg|petersburg|санкт|питер|spb|leningrad|ленинград/i, msk: /москв|moscow|moskva/i };
const cityOf = (id, p) => (p && p.city ? p.city : id.startsWith('spb-') ? 'spb' : 'msk');
const R = 6371000, rad = x => x * Math.PI / 180;
const distM = (a, b) => { const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

/* достопримечательность (парк, музей, театр…) узнаётся по названию; заведение — только по координатам снимка */
const landmark = p => ['walk', 'culture'].includes(p.cat) || (p.venue && /театр|зал|арен|дворец|музе|собор|храм|манеж|стадион|галере|дк |дом культуры|центр|холл|филармони|консерватор/i.test(p.name)) || (!p.cat && /парк|сад|музе|театр|усадьб|собор|храм|монастыр|дворец|набережн|площад|мост/i.test(p.kind || ''));
/* у заведения слово места в названии («Colizeum Свиблово», «Варшавские бани») — адрес, а не имя: по нему находились районы и троллейбусы */
const GEO_JS = fs.readFileSync(path.join(ROOT, 'assets/geo.js'), 'utf8');
const STATION_KEYS = Object.fromEntries(['msk', 'spb'].map(c => [c, new Set(keysOf(Object.keys(parseStations(GEO_JS, c)).join(' ')))]));
const searchKeys = (id, p) => {
  const k = keysOf(p.name);
  if (landmark(p)) return k;
  const loc = new Set(keysOf(`${p.addr || ''} ${p.metro || ''}`));
  return k.filter(x => !loc.has(x) && !STATION_KEYS[cityOf(id, p)].has(x));
};

/* ---------- источники ---------- */
async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${new URL(url).host}`);
  return r.json();
}
/* Commons по названию: файлы с координатами рядом или с городом в названии/описании */
async function commonsByName(id, p, keys) {
  const city = cityOf(id, p);
  const q = `${p.name} ${city === 'spb' ? 'Санкт-Петербург' : 'Москва'}`;
  const j = await getJson('https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrsearch: q + ' filetype:bitmap', gsrnamespace: '6', gsrlimit: '12',
    prop: 'imageinfo|coordinates', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1280', iiextmetadatafilter: 'Artist|Credit|LicenseShortName|License|ImageDescription', iiextmetadatalanguage: 'ru' }));
  for (const pg of (j.query || {}).pages || []) {
    const ii = pg.imageinfo && pg.imageinfo[0], md = (ii && ii.extmetadata) || {};
    if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime || '') || ii.width < 800) continue;
    const title = String(pg.title || '').replace(/^File:/i, '');
    const desc = stripHtml((md.ImageDescription || {}).value || '');
    if (!hasKey(title, keys)) continue;
    const co = pg.coordinates && pg.coordinates[0];
    // у заведения название — часто обычное слово («Огород», «Рябчик»): без координат рядом снимок не берём
    if (co ? distM(p, { lat: co.lat, lon: co.lon }) > 400 : !landmark(p) || !CITY_RX[city].test(title + ' ' + desc)) continue;
    const license = freeLicense((md.LicenseShortName || {}).value, (md.License || {}).value);
    let artist = cleanArtist((md.Artist || {}).value || '') || cleanArtist((md.Credit || {}).value || '');
    if (/own work|собственн/i.test(artist)) artist = '';
    if (!license || (!artist && !/CC0|достояние/.test(license))) continue;
    const file = title.replace(/ /g, '_');
    if (used.has(file)) continue;
    return { kind: 'commons', file, thumb: ii.thumburl || ii.url, artist: artist || 'неизвестный автор', license };
  }
  return null;
}
/* Openverse (фото Flickr и др. под CC): имя места в заголовке, город — в заголовке или тегах */
const OV_LIC = { by: 'CC BY', 'by-sa': 'CC BY-SA', cc0: 'CC0', pdm: 'общественное достояние' };
async function openverse(id, p, keys) {
  const city = cityOf(id, p);
  const j = await getJson('https://api.openverse.org/v1/images/?' + new URLSearchParams({ q: `${p.name} ${city === 'spb' ? 'Петербург' : 'Москва'}`, license: 'by,by-sa,cc0,pdm', page_size: '12', mature: 'false' }));
  for (const r of j.results || []) {
    const title = String(r.title || ''), tags = (r.tags || []).map(t => t.name).join(' ');
    if (!hasKey(title, keys) || !CITY_RX[city].test(title + ' ' + tags)) continue;
    if ((r.width || 0) && r.width < 800) continue;
    const lic = OV_LIC[r.license];
    if (!lic || !r.url || !/^https:/.test(r.url)) continue;
    const license = lic + (r.license_version && !/CC0|достояние/.test(lic) ? ' ' + r.license_version : '');
    if (!r.creator && !/CC0|достояние/.test(lic)) continue;
    if (used.has(r.url) || used.has(r.foreign_landing_url) || used.has(title)) continue;
    if (r.provider === 'wikimedia' || r.source === 'wikimedia') continue;   // Commons смотрим напрямую, с координатами
    const src = r.source === 'flickr' ? 'Flickr' : r.provider === 'wikimedia' ? 'Wikimedia Commons' : (r.source || 'Openverse');
    return { kind: 'ext', file: title.slice(0, 120), thumb: r.url, artist: String(r.creator || 'неизвестный автор').slice(0, 80), license, src, u: r.foreign_landing_url || r.url };
  }
  return null;
}

/* фото дома: «Мясницкая ул., 13» → в названии файла «мясниц…»/«myasni…» и отдельный номер 13 (13к2, 13с1 — тоже) */
const ADDR_STOP = /^(ул|улица|пер|переулок|пр|просп|проспект|пр-т|ш|шоссе|наб|набережная|бул|бульвар|пл|площадь|проезд|туп|тупик|линия|стр|корп|к|д|дом|строение|корпус|большой|малый|большая|малая|старая|новая|нижняя|верхняя|средняя)$/;
function addrKeys(addr) {
  const parts = String(addr || '').split(',').map(x => x.trim()), street = parts[0] || '', num = (parts[1] || '').match(/^\d+/);
  const words = norm(street).split(' ').filter(w => w.length >= 4 && !ADDR_STOP.test(w) && !/^\d/.test(w));
  if (!words.length || !num) return null;
  return { keys: [...new Set(words.flatMap(w => [w.slice(0, 6), lat(w).slice(0, 6)]))], num: num[0] };
}
async function building(p) {
  const ak = addrKeys(p.addr);
  if (!ak) return null;
  const cs = await findCommonsCandidates(p, { radiusM: 45, limit: 15 });
  const numRx = new RegExp('(^|[^0-9])' + ak.num + '([^0-9]|$)');
  // снимки транспорта («Moscow trolleybus … Gogolevsky») и интерьеров — не дом
  const x = cs.find(x => !used.has(x.file) && hasKey(x.title, ak.keys) && numRx.test(norm(x.title)) && !/trolleybus|tram\b|tramway|\bbus\b|троллейбус|трамва|автобус|train|поезд|электрич|interior|интерьер/i.test(x.title));
  return x ? { kind: 'commons', file: x.file, thumb: x.thumb, artist: x.artist, license: x.license, b: 1 } : null;
}

/* ---------- сохранение ---------- */
async function save(id, c) {
  const r = await fetch(c.thumb, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 20 * 1024 * 1024) throw new Error('файл больше 20 МБ');
  if (DRY) return;
  fs.mkdirSync(path.join(ROOT, 'assets/ph/t'), { recursive: true });
  const img = () => sharp(buf, { failOn: 'error' }).rotate();
  await img().resize({ width: 720, withoutEnlargement: true }).webp({ quality: 72 }).toFile(path.join(ROOT, `assets/ph/${id}.webp`));
  await img().resize(240, 240, { fit: 'cover', position: sharp.strategy.attention }).webp({ quality: 72 }).toFile(path.join(ROOT, `assets/ph/t/${id}.webp`));
}
function writePhotosJs(rows) {
  if (!rows.length || DRY) return;
  const f = path.join(ROOT, 'assets/photos.js');
  const s = fs.readFileSync(f, 'utf8');
  const end = s.indexOf('\n  };\n  const places');
  if (end < 0) throw new Error('photos.js: не нашёл конец PH');
  const lines = rows.map(([id, v]) => `    ${JSON.stringify(id)}: ${JSON.stringify(v)},`).join('\n');
  fs.writeFileSync(f, s.slice(0, end) + `\n    // —— добор ${TODAY} ——\n` + lines + s.slice(end));
}

let rows = [];
const log = [];
const byBase = new Map();   // сцены одного театра: «Театр Моссовета, Основная сцена» и «…, Сцена под крышей» — один снимок
const items = todo.map(([id, p]) => [id, p, id]).concat(venueTodoOf().map(v => ['@' + v.venue, v, vslug(v.name)]));
for (const [id, p, img] of items) {
  const keys = searchKeys(id, p);
  tried[id] = TODAY;
  const twin = p.venue && byBase.get(p.name);
  // площадка есть в каталоге под другим id (у события не указан place), и у места уже есть фото — берём его
  // только театр, музей, парк…: у мест каталога cat бывает пуст, а «Ресторан» — лишь в kind (филиал Театра Пушкина ≠ кафе «Пушкинъ»); джаз-клуб на Таганке ≠ театр
  const mate = p.venue && keys.length && !/клуб|бар|паб|кафе|ресторан/i.test(p.name) && Object.values(K.places).find(q => q.ph && !q.closed && landmark(q) && Number.isFinite(q.lat) && distM(p, q) < 250 && (hasKey(q.name, keys) || hasKey(p.name, keysOf(q.name))));
  if (mate) { const mi = mate.ph.s.replace(/^assets\/ph\/|\.webp$/g, ''); rows.push([id, mate.ph.file ? [mate.ph.file, mate.ph.a, mate.ph.l, mi] : [mate.ph.u, mate.ph.a, mate.ph.l, mi, { src: mate.ph.src, u: mate.ph.u }], mi, true]); log.push(`${id}: ✓ фото места «${mate.name}»`); continue; }
  if (twin && distM(p, twin.p) < 400) { rows.push([id, [...twin.v.slice(0, 3), twin.img, ...(twin.v[4] ? [twin.v[4]] : [])], twin.img, true]); log.push(`${id}: ✓ тот же снимок, что у «${twin.p.venue}»`); continue; }
  if (!keys.length && (landmark(p) || BUILDING_OFF)) { log.push(`${id}: имя слишком общее — пропуск`); continue; }
  let c = null;
  for (const step of ONLY_B ? (!landmark(p) ? [() => building(p)] : []) : [
    ...(keys.length ? [
      async () => { const cs = await findCommonsCandidates(p, { radiusM: 150, limit: 12 }); const x = cs.find(x => !used.has(x.file) && hasKey(x.title, keys)); return x ? { kind: 'commons', file: x.file, thumb: x.thumb, artist: x.artist, license: x.license } : null; },
      () => commonsByName(id, p, keys),
    ] : []),
    ...(keys.length && landmark(p) ? [() => openverse(id, p, keys)] : []),
    ...(!landmark(p) && !BUILDING_OFF ? [() => building(p)] : []),
  ]) {
    try { c = await step(); } catch (e) { log.push(`${id}: ${e.message}`); }
    await sleep(600);
    if (c) break;
  }
  if (!c) continue;
  try {
    await save(img, c);
    used.add(c.kind === 'ext' ? c.thumb : c.file);
    const v = c.kind === 'ext' ? [c.file, c.artist, c.license, p.venue ? img : null, { src: c.src, u: c.u }] : c.b ? [c.file, c.artist, c.license, p.venue ? img : null, { b: 1 }] : p.venue ? [c.file, c.artist, c.license, img] : [c.file, c.artist, c.license];
    rows.push([id, v, img]);
    if (p.venue) byBase.set(p.name, { p, v, img });
    log.push(`${id}: ✓ ${c.kind === 'ext' ? c.src : c.b ? 'Commons, дом' : 'Commons'} — ${c.file.slice(0, 60)}`);
  } catch (e) { log.push(`${id}: не сохранилось — ${e.message}`); }
}
/* лица: такие снимки не ставим и больше не предлагаем */
if (rows.length && !DRY) {
  const pathOf = r => path.join(ROOT, `assets/ph/${r[2]}.webp`);
  const faces = await facesIn([...new Set(rows.map(pathOf))]);
  if (!faces) log.push('детектор лиц недоступен — фото проверят глазами (photos-review.mjs)');
  else {
    const bad = rows.filter(r => faces[pathOf(r)] > 0);
    bad.forEach(([id, , img]) => { ['', 't/'].forEach(d => fs.rmSync(path.join(ROOT, `assets/ph/${d}${img}.webp`), { force: true })); log.push(`${id}: на фото лицо — не взято`); });
    addBlocked(ROOT, bad.map(([, v]) => (v[4] && v[4].u ? v[4].u : v[0])));
    rows = rows.filter(r => !bad.includes(r));
    rows.filter(r => !(faces[pathOf(r)] >= 0)).forEach(([id]) => log.push(`${id}: детектор не прочитал фото — проверить глазами`));
  }
}
writePhotosJs(rows);
if (!DRY) { fs.mkdirSync(path.dirname(TRIED_FILE), { recursive: true }); fs.writeFileSync(TRIED_FILE, JSON.stringify(tried, null, 1)); }
console.log(log.join('\n'));
console.log(`PHOTOS_ADDED=${rows.length} (проверено ${items.length}: мест ${todo.length}, площадок афиши ${items.length - todo.length})`);

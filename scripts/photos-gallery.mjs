#!/usr/bin/env node
/* Галереи мест «Куда идём?»: к главному фото — ещё до 4 красивых снимков того же места. Только свободные лицензии
   (CC0, CC BY, CC BY-SA, FAL, общественное достояние) и только снимки именно этого места:
     1) Wikidata: объект с таким названием не дальше 1 км (заведение — 150 м) → его категория на Commons (P373) и главное фото (P18);
        из категории — сначала снимки с отметкой Quality / Featured / Valued, потом крупные;
     2) Commons рядом с точкой: в названии файла есть слово из имени места;
     3) Openverse (Flickr под CC) — только для парков, музеев, театров: имя места в заголовке, город — в заголовке или тегах.
   Красота: отметки Commons, размер, свежесть снимка, цвет, контраст, резкость; чёрно-белые и старые сканы, схемы, таблички,
   люди и толпа (по категориям) — мимо; почти одинаковые кадры (dHash) и больше двух снимков одного автора — мимо.
   Лица: скачанные проверяет детектор (pipeline/lib/faces.mjs), с лицом — не предлагаем и заносим в scripts/photos-blocked.json.
   Цифры не видят, что на снимке (туалет в парке, график высот вместо башни), поэтому в галерею попадает только то, что выбрали глазами:
     node scripts/photos-gallery.mjs [--limit 120] [--ids a,b] [--dry]
       — до 6 кандидатов на место в ~/.kuda/gallery-stage/<id>-<k>.webp и контактные листы (подпись «id k»), пути — строками REVIEW_SHEET=…
     node scripts/photos-gallery.mjs --accept "patriki:3,1 museon:2"
       — выбранные снимки в нужном порядке → assets/ph/g/<id>-<n>.webp (720 px) и превью assets/ph/g/t/<id>-<n>.webp, строки в assets/gallery.js.
         Если у места не было главного фото, первый снимок галереи становится главным.
     node scripts/photos-gallery.mjs --reject patriki-3,museon-2 [--why "не то место"] — убрать снимок из галереи навсегда */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { freeLicense, cleanArtist, stripHtml, UA } from '../pipeline/lib/photos.mjs';
import { facesIn, loadBlocked, addBlocked, photoKey } from '../pipeline/lib/faces.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(path.join(ROOT, 'pipeline/package.json'))('sharp');
const ARGS = process.argv.slice(2);
const arg = k => { const i = ARGS.indexOf(k); return i >= 0 ? ARGS[i + 1] : ''; };
const LIMIT = +arg('--limit') || 120;
const PER = 4;                                                            // сколько снимков в галерее обычно хватает
const STAGE_N = 6;                                                        // сколько кандидатов показать на выбор
const DRY = ARGS.includes('--dry');
const STAGE = process.env.KUDA_STAGE || path.join(os.homedir(), '.kuda', 'gallery-stage');
const STAGE_JSON = path.join(STAGE, 'stage.json');
const ONLY = arg('--ids') ? new Set(arg('--ids').split(',')) : null;
const GAL = path.join(ROOT, 'assets/gallery.js');
const TODAY = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const SHEETS = process.env.KUDA_SHEETS || path.join(os.homedir(), '.kuda', 'photos-review');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- каталог и уже взятые снимки ---------- */
const ctx = { window: {}, console };
vm.createContext(ctx);
for (const f of ['assets/places.js', 'assets/places-spb.js', 'assets/photos.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const K = ctx.window.KUDA, ADULT = new Set(K.adult || []);
export function readGallery(file = GAL) {
  if (!fs.existsSync(file)) return {};
  const s = fs.readFileSync(file, 'utf8');
  const a = s.indexOf('/*G*/'), b = s.indexOf('/*/G*/');
  return a < 0 || b < 0 ? {} : JSON.parse(s.slice(a + 5, b));
}
export function writeGallery(G, file = GAL) {
  const ids = Object.keys(G).sort();
  const body = '{\n' + ids.map(id => `    ${JSON.stringify(id)}: [\n` + G[id].map(r => `      ${JSON.stringify(r)}`).join(',\n') + '\n    ]').join(',\n') + '\n  }';
  fs.writeFileSync(file, `/* Галереи мест: ещё несколько снимков к главному фото (assets/photos.js). Собирает scripts/photos-gallery.mjs.
   Только свободные лицензии (CC0, CC BY, CC BY-SA, FAL, общественное достояние), без лиц людей.
   Формат: id места → [[файл на Commons или заголовок, автор, лицензия, номер, { src: 'Flickr', u: страница } | 0], …].
   Картинка — assets/ph/g/<id>-<номер>.webp (720 px). Если у места нет главного фото, первым становится снимок галереи
   (превью — assets/ph/g/t/<id>-<номер>.webp). Подпись с автором и лицензией — под каждым снимком. */
(function () {
  const G = /*G*/${body}/*/G*/;
  const places = (window.KUDA || {}).places || {};
  const one = (id, [file, a, l, n, ext]) => {
    const s = 'assets/ph/g/' + id + '-' + n + '.webp';
    return ext ? { s, t: 'assets/ph/g/t/' + id + '-' + n + '.webp', a, l, src: ext.src, u: ext.u }
      : { s, t: 'assets/ph/g/t/' + id + '-' + n + '.webp', a, l, file, u: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file) };
  };
  Object.keys(G).forEach(id => {
    const p = places[id];
    if (!p || !G[id].length) return;
    const g = G[id].map(r => one(id, r));
    if (!p.ph) { p.ph = g[0]; p.gal = g.slice(1); } else p.gal = g;
  });
})();
`);
}

const blocked = loadBlocked(ROOT);
const G = readGallery();
fs.mkdirSync(STAGE, { recursive: true });
// ST — кандидаты на выбор { id: [{ k, file, artist, license, ext, s, from }] }; TRIED — когда место уже смотрели (повтор через 60 дней)
const { st: ST = {}, tried: TRIED = {} } = (() => { try { return JSON.parse(fs.readFileSync(STAGE_JSON, 'utf8')); } catch { return {}; } })();
const saveStage = () => fs.writeFileSync(STAGE_JSON, JSON.stringify({ st: ST, tried: TRIED }, null, 1));

/* ---------- принять выбранные: --accept "id:2,1 id2:3" ---------- */
if (arg('--accept')) {
  for (const part of arg('--accept').split(/[\s;]+/).filter(Boolean)) {
    const [id, ks] = part.split(':');
    const st = ST[id];
    if (!st || !ks) { console.log(`${part}: нет кандидатов`); continue; }
    const rows = G[id] || [];
    let n = rows.reduce((m, r) => Math.max(m, r[3]), 0);
    for (const k of ks.split(',').map(Number)) {
      const x = st.find(y => y.k === k);
      const src = path.join(STAGE, `${id}-${k}.webp`);
      if (!x || !fs.existsSync(src)) { console.log(`${id} ${k}: нет такого кандидата`); continue; }
      n++;
      fs.mkdirSync(path.join(ROOT, 'assets/ph/g/t'), { recursive: true });
      fs.copyFileSync(src, path.join(ROOT, `assets/ph/g/${id}-${n}.webp`));
      await sharp(src).resize(240, 240, { fit: 'cover', position: sharp.strategy.attention }).webp({ quality: 72 }).toFile(path.join(ROOT, `assets/ph/g/t/${id}-${n}.webp`));
      rows.push([x.file, x.artist, x.license, n, x.ext || 0]);
    }
    if (rows.length) G[id] = rows;
    delete ST[id];
    console.log(`${id}: в галерее ${rows.length}`);
  }
  writeGallery(G);
  saveStage();
  process.exit(0);
}

/* ---------- отклонить снимки галереи: --reject id-n,… ---------- */
if (arg('--reject')) {
  const why = arg('--why') || 'не подходит';
  const keys = [];
  for (const ref of arg('--reject').split(',').map(s => s.trim()).filter(Boolean)) {
    const m = /^(.+)-(\d+)$/.exec(ref);
    if (!m || !G[m[1]]) { console.log(`${ref}: нет такого снимка`); continue; }
    const [id, n] = [m[1], +m[2]];
    const r = G[id].find(x => x[3] === n);
    if (!r) { console.log(`${ref}: нет такого снимка`); continue; }
    G[id] = G[id].filter(x => x !== r);
    if (!G[id].length) delete G[id];
    keys.push(r[4] ? r[4].u : r[0]);
    ['', 't/'].forEach(d => fs.rmSync(path.join(ROOT, `assets/ph/g/${d}${id}-${n}.webp`), { force: true }));
    console.log(`${ref}: убран`);
  }
  addBlocked(ROOT, keys, why);
  writeGallery(G);
  process.exit(0);
}

const used = new Set([
  ...Object.values(K.places).map(p => p && p.ph && (p.ph.file || p.ph.u)).filter(Boolean),
  ...Object.keys(blocked),
  ...Object.values(G).flat().map(r => (r[4] ? r[4].u : r[0])),
].map(photoKey));
const inPlans = new Map();
(K.scenarios || []).forEach(s => (s.stops || []).forEach(id => inPlans.set(id, (inPlans.get(id) || 0) + 1)));
const landmark = p => ['walk', 'culture'].includes(p.cat) || (!p.cat && /парк|сад|музе|театр|усадьб|собор|храм|монастыр|дворец|набережн|площад|мост|башн|планетари|зоопарк|рынок/i.test(p.kind || ''));
const todo = Object.entries(K.places)
  .filter(([id, p]) => p && !p.adult && !ADULT.has(id) && !p.closed && /^[a-z0-9-]+$/.test(id) && Number.isFinite(p.lat))
  .filter(([id, p]) => (ONLY ? ONLY.has(id) : !G[id] && !ST[id] && !(TRIED[id] && (Date.parse(TODAY) - Date.parse(TRIED[id])) / 864e5 < 60) && (p.ph || landmark(p))))
  .sort((a, b) => (inPlans.get(b[0]) || 0) - (inPlans.get(a[0]) || 0) || (!!b[1].ph - !!a[1].ph))
  .slice(0, ONLY ? 1e9 : LIMIT);

/* ---------- сравнение названий (как в photos-daily.mjs) ---------- */
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const STOP = new Set('и в на у с к по из от для the of a an and музей театр парк сад кафе бар ресторан зал баня бани клуб остров площадь набережная улица санкт петербург петербурга спб москва москвы имени им дворец собор центр дом кофейня пекарня галерея книжный магазин компьютерный бильярдная museum theatre theater park garden cafe bar restaurant club house'.split(' '));
const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
const toks = s => norm(s).split(' ').filter(w => w.length >= 4 && !STOP.has(w));
const lat = w => w.replace(/[а-я]/g, c => TR[c] ?? c);
const keysOf = name => [...new Set(toks(name).flatMap(w => [w.slice(0, 6), lat(w).slice(0, 6)]))];
const hasKey = (text, keys) => { const t = norm(text); const tl = lat(t); return keys.some(k => t.includes(k) || tl.includes(k)); };
const CITY_RX = { spb: /петербург|peterburg|petersburg|санкт|питер|spb|leningrad|ленинград/i, msk: /москв|moscow|moskva/i };
const cityOf = id => (id.startsWith('spb-') ? 'spb' : 'msk');
const R = 6371000, rad = x => x * Math.PI / 180;
const distM = (a, b) => { const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

/* ---------- что не берём ---------- */
// в названии файла: схемы, таблички, билеты, детали и фрагменты, афиши, люди
const JUNK = /(^|[\s_(,.-])(map|maps|карта|схема|scheme|plan of|logo|логотип|герб|coat of arms|flag|флаг|diagram|chart|plaque|доска|табличк|sign|signboard|вывеск|ticket|билет|афиша|poster|плакат|stand|стенд|inscription|надпись|detail|details|деталь|фрагмент|fragment|экспонат|exhibit|model|макет|drawing|чертёж|чертеж|scan|скан|postcard|открытка|stamp|марка|selfie|people|люди|crowd|толпа|portrait|портрет|window|windows|окно|окна|door|doors|дверь|двери|birch|берёза|береза|tree|bird|birds|птицы|duck|ducks|утки|crow|ворона|pigeon|голуби|squirrel|белка|cat|кот|dog|собака|flower|flowers|цветы|lamp|фонарь|bench|скамейка|ornament|орнамент|relief|рельеф|capital|капитель|ballet|балет|stage|сцена)([\s_.,)-]|$)/i;
// по категориям снимка: люди, события, сцена, архив, графика, стройка, транспорт, детали и живность крупным планом
const BAD_CAT = /portrait|people|persons|\bmen\b|\bwomen\b|children|crowd|protest|rall(y|ies)|demonstrat|parade|concert|performer|musicians|dancers|ballet|opera productions|performances|productions|actors|events in|festival|celebrat|wedding|selfie|\bwindows\b|\bdoors\b|\btrees\b|birch|birds|ducks|animals|fauna|flowers|plants|insects|\bcats\b|\bdogs\b|lamp|lanterns|benches|ornament|reliefs|capitals|close-up|macro|textures|bells|clocks|maps of|plans of|diagrams|drawings|paintings|engravings|lithograph|postcards|black and white|monochrome|historical images|historical photographs|old photographs|photographs from the 19|in the 19\d\ds|scans|construction|reconstruction|renovation|demolition|damaged|accident|police|military|signs in|plaques|inscriptions|tickets|posters|logos|advertis|vehicles|buses|trams in|trolleybuses|cars in|license plates|documents|exhibits|museum collections|artworks|sculptures by|mosaics|icons|stained glass/i;
const OK_MIME = /^image\/(jpeg|png|webp|tiff)$/;
const MIN_W = 1400;

/* ---------- источники ---------- */
async function getJson(url) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (r.status === 429 || r.status >= 500) { await sleep(3000 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status} ${new URL(url).host}`);
    return r.json();
  }
  throw new Error(`HTTP 429/5xx ${new URL(url).host}`);
}
const CAPI = 'https://commons.wikimedia.org/w/api.php?';
const II = { prop: 'imageinfo|coordinates', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1280',
  iiextmetadatafilter: 'Artist|Credit|LicenseShortName|License|ImageDescription|Assessments|DateTimeOriginal|Categories', iiextmetadatalanguage: 'ru' };

/* страница Commons с imageinfo → кандидат или null */
function commonsCand(pg, from, inCat = '') {
  const ii = pg.imageinfo && pg.imageinfo[0], md = (ii && ii.extmetadata) || {};
  const v = k => (md[k] && md[k].value) || '';
  if (!ii || !OK_MIME.test(ii.mime || '')) return null;
  const title = String(pg.title || '').replace(/^File:/i, '');
  if (/\.svg$/i.test(title) || !(ii.width >= MIN_W) || !(ii.height >= 800)) return null;
  const ar = ii.width / ii.height;
  if (ar < 0.62 || ar > 1.9) return null;                                // панорамы (и сферические 360°) и узкие полосы на карточке не смотрятся
  if (JUNK.test(title.replace(/_/g, ' ')) || /360|panoram|equirectangular|сферич|панорам/i.test(title)) return null;
  const cats = stripHtml(v('Categories'));
  if (BAD_CAT.test(cats) || /360°|spherical|equirectangular|panoramas/i.test(cats)) return null;
  // из дерева категорий — только снимки, лежащие в самой категории места или в её подкатегории с тем же названием
  if (inCat && !cats.toLowerCase().replace(/_/g, ' ').includes(inCat.toLowerCase().replace(/_/g, ' '))) return null;
  const year = +((v('DateTimeOriginal').match(/(19|20)\d\d/) || [])[0] || 0);
  const as = String(v('Assessments')).toLowerCase();
  if (year && year < 2005 && !/featured|quality/.test(as)) return null;  // старые сканы и выцветшие снимки
  const license = freeLicense(v('LicenseShortName'), v('License'));
  if (!license) return null;
  const NOT_AUTHOR = /own work|собственн\S* работа|transferred from|перенесено|^https?:\/\/|^www\./i;
  const name = s => (NOT_AUTHOR.test(s) ? '' : s);
  let artist = name(cleanArtist(v('Artist'))) || name(cleanArtist(v('Credit')));
  if (!artist) { if (/CC0|достояние/.test(license)) artist = 'неизвестный автор'; else return null; }
  const file = title.replace(/ /g, '_');
  if (used.has(photoKey(file))) return null;
  const thumb = ii.thumburl || ii.url;
  const co = pg.coordinates && pg.coordinates[0];
  return {
    kind: 'commons', file, artist, license, thumb, small: thumb.replace(/\/1280px-/, '/500px-'), w: ii.width, h: ii.height, year, from,
    co: co ? { lat: co.lat, lon: co.lon } : null,
    meta: (/featured/.test(as) ? 5 : 0) + (/quality/.test(as) ? 3 : 0) + (/valued/.test(as) ? 2 : 0) + (/potd|poty/.test(as) ? 2 : 0),
  };
}
async function commonsSearch(q, limit, from, inCat = '') {
  const j = await getJson(CAPI + new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrsearch: q, gsrnamespace: '6', gsrlimit: String(limit), ...II }));
  return ((j.query || {}).pages || []).map(pg => commonsCand(pg, from, inCat)).filter(Boolean);
}

/* категории главного фото места (без скрытых) — по ним проверяем, тот ли объект нашёлся в Wikidata */
async function mainCats(p) {
  if (!p.ph || !p.ph.file) return [];
  const j = await getJson(CAPI + new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', titles: 'File:' + p.ph.file, prop: 'categories', clshow: '!hidden', cllimit: '50' }));
  return (((j.query || {}).pages || [])[0] || {}).categories?.map(c => c.title.replace(/^Category:/, '')) || [];
}
const NOT_PLACE_CAT = /district|raion|районы?|okrug|округ|streets? |улиц|metro|станци|station|buildings in|views of|panoramas|photographs|taken with|in moscow$|in saint petersburg$|^\d{4}/i;

/* Wikidata: объект с таким названием рядом → категория Commons (P373) и главное фото (P18).
   Если у места есть главное фото — берём объект, чья категория совпала с категорией этого фото; иначе ближайший не дальше 300 м */
async function wikidata(id, p, mc) {
  const s = await getJson('https://www.wikidata.org/w/api.php?' + new URLSearchParams({ action: 'wbsearchentities', search: p.name.replace(/[«»"]/g, ''), language: 'ru', uselang: 'ru', type: 'item', limit: '7', format: 'json' }));
  const ids = (s.search || []).map(x => x.id);
  if (!ids.length) return null;
  const e = await getJson('https://www.wikidata.org/w/api.php?' + new URLSearchParams({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims', format: 'json' }));
  const max = landmark(p) ? 1000 : 150;
  const inMain = cat => cat && mc.some(m => m.toLowerCase() === String(cat).toLowerCase());
  let best = null;
  for (const q of ids) {
    const c = ((e.entities || {})[q] || {}).claims || {};
    const co = c.P625 && c.P625[0] && c.P625[0].mainsnak.datavalue && c.P625[0].mainsnak.datavalue.value;
    if (!co) continue;
    const d = distM(p, { lat: co.latitude, lon: co.longitude });
    if (d > max) continue;
    const val = k => c[k] && c[k][0] && c[k][0].mainsnak.datavalue && c[k][0].mainsnak.datavalue.value;
    const x = { q, d, cat: val('P373'), img: val('P18'), match: inMain(val('P373')) };
    if (!best || (x.match && !best.match) || (x.match === best.match && d < best.d)) best = x;
  }
  if (best && !best.match && (best.d > 300 || NOT_PLACE_CAT.test(best.cat || ''))) best = { ...best, cat: null, img: best.d <= 300 ? best.img : null };
  return best;
}

const OV_LIC = { by: 'CC BY', 'by-sa': 'CC BY-SA', cc0: 'CC0', pdm: 'общественное достояние' };
async function openverse(id, p, keys) {
  const city = cityOf(id);
  const j = await getJson('https://api.openverse.org/v1/images/?' + new URLSearchParams({ q: `${p.name} ${city === 'spb' ? 'Петербург' : 'Москва'}`, license: 'by,by-sa,cc0,pdm', page_size: '20', mature: 'false', source: 'flickr' }));
  const out = [];
  for (const r of j.results || []) {
    const title = String(r.title || ''), tags = (r.tags || []).map(t => t.name).join(' ');
    if (!hasKey(title, keys) || !CITY_RX[city].test(title + ' ' + tags)) continue;
    if (JUNK.test(title) || /people|portrait|girl|boy|woman|man\b|selfie|wedding|concert|parade/i.test(tags)) continue;
    if (!(r.width >= 1000) || r.width / (r.height || 1) < 0.62 || r.width / (r.height || 1) > 2.1) continue;
    const lic = OV_LIC[r.license];
    if (!lic || !r.url || !/^https:/.test(r.url) || (!r.creator && !/CC0|достояние/.test(lic))) continue;
    const u = r.foreign_landing_url || r.url;
    if (used.has(photoKey(u)) || used.has(photoKey(r.url)) || used.has(photoKey(title))) continue;
    out.push({ kind: 'ext', file: title.slice(0, 120), artist: String(r.creator || 'неизвестный автор').slice(0, 80),
      license: lic + (r.license_version && !/CC0|достояние/.test(lic) ? ' ' + r.license_version : ''), thumb: r.url, small: r.thumbnail || r.url,
      w: r.width, h: r.height, year: 0, meta: 0, from: 'flickr', src: 'Flickr', u });
  }
  return out;
}

/* ---------- красота: цвет, контраст, резкость, яркость; dHash для дублей ---------- */
async function fetchBuf(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length > 20 * 1024 * 1024) throw new Error('больше 20 МБ');
  return b;
}
async function looks(buf) {
  const { data, info } = await sharp(buf).rotate().resize(200, 200, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  let sRg = 0, sYb = 0, qRg = 0, qYb = 0, sL = 0, qL = 0;
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2], rg = r - g, yb = 0.5 * (r + g) - b, L = 0.299 * r + 0.587 * g + 0.114 * b;
    sRg += rg; sYb += yb; qRg += rg * rg; qYb += yb * yb; sL += L; qL += L * L;
  }
  const m = (s) => s / n, sd = (s, q) => Math.sqrt(Math.max(0, q / n - (s / n) ** 2));
  const colorful = Math.sqrt(sd(sRg, qRg) ** 2 + sd(sYb, qYb) ** 2) + 0.3 * Math.sqrt(m(sRg) ** 2 + m(sYb) ** 2);
  const bright = m(sL), contrast = sd(sL, qL);
  const lap = await sharp(buf).rotate().resize(400, 400, { fit: 'inside' }).greyscale()
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 }).raw().toBuffer();
  let s = 0, q = 0; for (const x of lap) { s += x; q += x * x; }
  const sharpness = q / lap.length - (s / lap.length) ** 2;
  const dh = await sharp(buf).rotate().resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
  let hash = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) hash = (hash << 1n) | (dh[y * 9 + x] > dh[y * 9 + x + 1] ? 1n : 0n);
  return { colorful, bright, contrast, sharpness, hash };
}
const ham = (a, b) => { let x = a ^ b, c = 0; while (x) { c += Number(x & 1n); x >>= 1n; } return c; };
function score(c, L) {
  if (L.colorful < 12) return -99;                                       // почти чёрно-белое
  return c.meta
    + Math.min(3, L.colorful / 18)
    + Math.min(2, L.contrast / 28)
    + Math.min(2, Math.log10(1 + L.sharpness) - 1.2)
    - (L.bright < 55 || L.bright > 205 ? 2 : 0)
    + Math.min(1.5, c.w / 2500)
    + (c.year >= 2015 ? 1 : c.year >= 2010 ? 0.5 : 0)
    + (c.from === 'wikidata-p18' ? 1.5 : 0)
    + (c.w / c.h >= 1.2 && c.w / c.h <= 1.8 ? 0.5 : 0);
}

/* ---------- скачать снимок (1280 px; если сервер против — 960 px) ---------- */
async function fetchImg(c) {
  const urls = [c.thumb, c.thumb.replace(/\/1280px-/, '/960px-')].filter((u, i, a) => a.indexOf(u) === i);
  let err;
  for (const u of urls) for (let i = 0; i < 2; i++) {
    try { return await fetchBuf(u); } catch (e) { err = e; await sleep(4000); }
  }
  throw err;
}

/* ---------- контактный лист для просмотра глазами: 5 × 4, подпись «id k» ---------- */
async function sheets(items) {
  if (!items.length) return [];
  fs.mkdirSync(SHEETS, { recursive: true });
  const W = 256, H = 190, COLS = 5, ROWS = 4, out = [];
  for (let k = 0; k < items.length; k += COLS * ROWS) {
    const part = items.slice(k, k + COLS * ROWS);
    const comp = [];
    for (let i = 0; i < part.length; i++) {
      const [label, file] = part[i];
      const x = (i % COLS) * W, y = Math.floor(i / COLS) * H;
      const tile = await sharp(file).resize(W - 4, H - 24, { fit: 'cover' }).toBuffer();
      comp.push({ input: tile, left: x + 2, top: y + 2 });
      const svg = `<svg width="${W}" height="22" xmlns="http://www.w3.org/2000/svg"><text x="4" y="16" font-family="Helvetica" font-size="14" fill="#fff">${label.replace(/[<&]/g, '')}</text></svg>`;
      comp.push({ input: Buffer.from(svg), left: x, top: y + H - 22 });
    }
    const f = path.join(SHEETS, `gallery-${TODAY}-${String(k / (COLS * ROWS) + 1).padStart(2, '0')}.jpg`);
    await sharp({ create: { width: W * COLS, height: H * Math.ceil(part.length / COLS), channels: 3, background: '#222' } }).composite(comp).jpeg({ quality: 76 }).toFile(f);
    out.push(f);
  }
  return out;
}

/* ---------- обход ---------- */
const log = [];
const staged = [];
for (const [id, p] of todo) {
  const keys = keysOf(p.name);
  const cands = [];
  const push = arr => arr.forEach(c => { if (!cands.some(x => photoKey(x.file) === photoKey(c.file))) cands.push(c); });
  try {
    const mc = await mainCats(p).catch(() => []);
    const wd = await wikidata(id, p, mc);
    await sleep(250);
    if (wd && wd.img) push(await commonsSearch(`intitle:"${String(wd.img).replace(/\.[a-z]+$/i, '').replace(/"/g, '')}" filetype:bitmap`, 3, 'wikidata-p18'));
    // категория места: из Wikidata, а нет — категория главного фото со словом из названия места
    const cats = [...new Set([wd && wd.cat, ...mc.filter(c => keys.length && hasKey(c, keys) && !NOT_PLACE_CAT.test(c))].filter(Boolean))].slice(0, 2);
    for (const c0 of cats) {
      const cat = String(c0).replace(/"/g, '');
      try { push(await commonsSearch(`deepcat:"${cat}" incategory:"Quality_images" filetype:bitmap`, 30, 'category-qi', cat)); } catch (e) { /* дерево категорий слишком большое */ }
      await sleep(250);
      push(await commonsSearch(`incategory:"${cat}" filetype:bitmap filew:>${MIN_W}`, 50, 'category'));
      await sleep(250);
    }
    // рядом с точкой — только если категория мало дала: файлы со словом из названия в имени
    if (keys.length && cands.length < 3) {
      const park = p.cat === 'walk' || /парк|сад|усадьб|набережн|остров/i.test(p.kind || '');
      const near = await getJson(CAPI + new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', generator: 'geosearch', ggscoord: `${p.lat}|${p.lon}`, ggsradius: String(park ? 300 : landmark(p) ? 150 : 60), ggslimit: '60', ggsnamespace: '6', ...II }));
      push(((near.query || {}).pages || []).map(pg => commonsCand(pg, 'near')).filter(c => c && hasKey(c.file, keys)));
      await sleep(250);
    }
    if (keys.length && landmark(p) && cands.length < PER + 2) { try { push(await openverse(id, p, keys)); } catch (e) { log.push(`${id}: Openverse — ${e.message}`); } await sleep(400); }
  } catch (e) { log.push(`${id}: ${e.message}`); continue; }
  // снимок с координатами далеко от места — не он (категория могла оказаться общей)
  const far = c => c.co && distM(p, c.co) > (p.cat === 'walk' || /парк|сад|усадьб|набережн|остров/i.test(p.kind || '') ? 1500 : landmark(p) ? 400 : 200);
  const pool = cands.filter(c => !far(c)).sort((a, b) => b.meta - a.meta || b.w - a.w).slice(0, 18);
  if (!pool.length) { log.push(`${id}: не нашлось`); continue; }
  // главное фото места — чтобы не повторить его в галерее
  let mainHash = null;
  if (p.ph && p.ph.s && fs.existsSync(path.join(ROOT, p.ph.s))) { try { mainHash = (await looks(fs.readFileSync(path.join(ROOT, p.ph.s)))).hash; } catch { /* ок */ } }
  const scored = [];
  for (const c of pool) {
    try { const L = await looks(await fetchBuf(c.small)); scored.push({ c, L, s: score(c, L) }); } catch (e) { /* не скачалось */ }
    await sleep(120);
  }
  scored.sort((a, b) => b.s - a.s);
  const pick = [], byAuthor = {};
  for (const x of scored) {
    if (x.s < 1.5 || pick.length >= STAGE_N) break;
    if (mainHash !== null && ham(mainHash, x.L.hash) <= 12) continue;
    if (pick.some(y => ham(y.L.hash, x.L.hash) <= 12)) continue;
    if ((byAuthor[x.c.artist] || 0) >= 2) continue;
    byAuthor[x.c.artist] = (byAuthor[x.c.artist] || 0) + 1;
    pick.push(x);
  }
  if (!pick.length) { log.push(`${id}: кандидаты есть (${scored.length}), но некрасивые`); TRIED[id] = TODAY; continue; }
  const list = [];
  let k = 0;
  for (const x of pick) {
    k++;
    try {
      const buf = await fetchImg(x.c);
      if (!DRY) await sharp(buf, { failOn: 'error' }).rotate().resize({ width: 720, withoutEnlargement: true }).webp({ quality: 70 }).toFile(path.join(STAGE, `${id}-${k}.webp`));
      list.push({ k, file: x.c.file, artist: x.c.artist, license: x.c.license, ext: x.c.kind === 'ext' ? { src: x.c.src, u: x.c.u } : 0, s: +x.s.toFixed(1), from: x.c.from });
    } catch (e) { log.push(`${id}-${k}: не скачалось — ${e.message}`); }
    await sleep(200);
  }
  // сохраняем после каждого места: долгий прогон (Wikimedia отвечает медленно) можно прервать без потерь
  if (list.length) { ST[id] = list; staged.push(id); TRIED[id] = TODAY; if (!DRY) saveStage(); log.push(`${id}: на выбор ${list.length} (${list.map(x => x.from + ' ' + x.s).join(', ')})`); }
}

/* лица: такие снимки не предлагаем и больше не берём */
if (staged.length && !DRY) {
  const f = (id, k) => path.join(STAGE, `${id}-${k}.webp`);
  const faces = await facesIn(staged.flatMap(id => ST[id].map(x => f(id, x.k))));
  if (!faces) log.push('детектор лиц недоступен — смотреть глазами особенно внимательно');
  else {
    const bad = [];
    for (const id of staged) {
      ST[id] = ST[id].filter(x => { if (!(faces[f(id, x.k)] > 0)) return true; bad.push(x.ext ? x.ext.u : x.file); log.push(`${id}-${x.k}: на фото лицо — не предлагаю`); return false; });
      if (!ST[id].length) delete ST[id];
    }
    addBlocked(ROOT, bad);
  }
}
if (!DRY) { staged.forEach(id => { TRIED[id] = TODAY; }); saveStage(); }
const items = staged.filter(id => ST[id]).flatMap(id => ST[id].map(x => [`${id} ${x.k}`, path.join(STAGE, `${id}-${x.k}.webp`)]));
if (!DRY) (await sheets(items)).forEach(f => console.log('REVIEW_SHEET=' + f));
console.log(log.join('\n'));
console.log(`STAGED=${staged.filter(id => ST[id]).length} мест, снимков ${items.length} (проверено ${todo.length}). Выбрать: node scripts/photos-gallery.mjs --accept "id:2,1 id2:3"`);

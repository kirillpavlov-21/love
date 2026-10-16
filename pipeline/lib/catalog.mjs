/* Каталог сайта глазами конвейера: читает assets/places.js (+ places-spb.js), events.js (+ events-spb.js, sport.js),
   auto.js и таблицы станций из geo.js (FIXED — Москва, FIXED_SPB — Петербург),
   ищет совпадения новых мест с уже известными (только в том же городе), придумывает id и проверяет планы по правилам из README. */
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { CITIES, regionOf } from './geo.mjs';

/* ---------- загрузка ---------- */

async function readOpt(file) {
  try { return await fs.readFile(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
// объекты из песочницы vm → обычные объекты этого контекста
const plain = x => JSON.parse(JSON.stringify(x === undefined ? null : x));

function sandbox() {
  const noop = () => {};
  const sb = { console: { log: noop, info: noop, warn: noop, error: noop, debug: noop } };
  sb.window = sb; sb.self = sb;
  return vm.createContext(sb);
}
function runFile(ctx, code, name) {
  try { vm.runInContext(code, ctx, { filename: name, timeout: 5000 }); } catch (e) {
    throw new Error(`${name}: не удалось выполнить (${e.message})`);
  }
}

export const emptyAuto = () => ({ updated: '', places: {}, scenarios: [], events: [], closed: [] });

/* Данные из assets/auto.js. Файл пишет конвейер: постоянный код слияния и данные аргументом —
   `(function (A) {…})({…});`. Код слияния не запускаем, а достаём сам аргумент. */
export function parseAutoJs(text) {
  const norm = d => Object.assign(emptyAuto(), d || {});
  // вариант с глобальной переменной: window.KUDA_AUTO = {…}
  const ctx = sandbox();
  ctx.KUDA = { places: {}, scenarios: [], adult: [] }; ctx.KUDA_EVENTS = [];
  try { vm.runInContext(text, ctx, { timeout: 5000 }); } catch (e) { /* ниже разберём текст */ }
  if (ctx.KUDA_AUTO && typeof ctx.KUDA_AUTO === 'object') return norm(plain(ctx.KUDA_AUTO));
  // основной вариант: аргумент IIFE после «})(»
  const rx = /\}\s*\)\s*\(\s*\{/g;
  let m;
  while ((m = rx.exec(text))) {
    const start = m.index + m[0].length - 1;
    const end = text.lastIndexOf('}');
    if (end <= start) break;
    const lit = text.slice(start, end + 1);
    let d = null;
    try { d = JSON.parse(lit); } catch (e) {
      try { d = plain(vm.runInNewContext('(' + lit + ')', {}, { timeout: 2000 })); } catch (e2) { d = null; }
    }
    if (d && typeof d === 'object' && ('places' in d || 'scenarios' in d || 'events' in d || 'closed' in d || 'updated' in d)) return norm(d);
  }
  throw new Error('assets/auto.js: не нашёл данные (ожидается `(function (A) {…})({…});`)');
}

/* Таблица станций из assets/geo.js: FIXED — Москва { 'Станция': [lat, lon] },
   FIXED_SPB — Петербург { 'Станция': [lat, lon, линия] } (city = 'spb'). Названия в городах совпадают — таблицы раздельные */
const STATION_TABLE = { msk: 'FIXED', spb: 'FIXED_SPB' };
export function parseStations(geoJs, city = 'msk') {
  const name = STATION_TABLE[city] || STATION_TABLE.msk;
  const m = new RegExp(`const\\s+${name}\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*;`).exec(geoJs);
  if (!m) throw new Error(`assets/geo.js: не нашёл таблицу ${name}`);
  const st = plain(vm.runInNewContext('(' + m[1] + ')', {}, { timeout: 2000 }));
  if (!Object.keys(st).length) throw new Error(`assets/geo.js: таблица ${name} пустая`);
  return st;
}

/* Файлы данных по порядку подключения на сайте: Москва, потом Петербург и матчи — они только добавляют своё */
const PLACE_FILES = ['places.js', 'places-spb.js'];
const EVENT_FILES = ['events.js', 'events-spb.js', 'sport.js'];

export async function loadCatalog(repoDir) {
  const A = path.join(repoDir, 'assets');
  const ctx = sandbox();
  const placesJs = await readOpt(path.join(A, 'places.js'));
  if (placesJs == null) throw new Error(`нет файла ${path.join(A, 'places.js')}`);
  runFile(ctx, placesJs, 'assets/places.js');
  if (!ctx.KUDA || !ctx.KUDA.places) throw new Error('assets/places.js: нет window.KUDA.places');
  for (const f of [...PLACE_FILES.slice(1), ...EVENT_FILES]) {
    const js = await readOpt(path.join(A, f));
    if (js != null) runFile(ctx, js, 'assets/' + f);
  }

  const K = plain(ctx.KUDA);
  const places = K.places || {};
  const scenarios = Array.isArray(K.scenarios) ? K.scenarios : [];
  const adult = Array.isArray(K.adult) ? K.adult : [];
  const events = Array.isArray(ctx.KUDA_EVENTS) ? plain(ctx.KUDA_EVENTS) : [];

  const autoJs = await readOpt(path.join(A, 'auto.js'));
  const auto = autoJs != null ? parseAutoJs(autoJs) : emptyAuto();
  const geoJs = await fs.readFile(path.join(A, 'geo.js'), 'utf8');
  const stations = parseStations(geoJs);
  // таблицы Петербурга может ещё не быть — тогда петербургские адреса не пройдут проверку метро, а Москва работает как раньше
  let spbStations = {};
  try { spbStations = parseStations(geoJs, 'spb'); } catch (e) { /* нет FIXED_SPB */ }
  const cityStations = { msk: stations, spb: spbStations };

  // слияние — как это делает сам auto.js на сайте
  for (const [id, p] of Object.entries(auto.places || {})) if (!places[id]) places[id] = plain(p);
  const sIds = new Set(scenarios.map(s => s.id));
  for (const s of auto.scenarios || []) if (s && !sIds.has(s.id)) { scenarios.push(plain(s)); sIds.add(s.id); }
  const eIds = new Set(events.map(e => e.id));
  for (const e of auto.events || []) if (e && !eIds.has(e.id)) { events.push(plain(e)); eIds.add(e.id); }
  // поле tg убрано из формата: источники на сайте не показываем и дальше не переносим
  for (const p of Object.values(places)) if (p && typeof p === 'object') delete p.tg;
  const closed = new Set(auto.closed || []);
  for (const id of closed) if (places[id]) places[id].closed = true;
  const isClosed = id => closed.has(id) || !!(places[id] && places[id].closed);
  const liveScenarios = scenarios.filter(s => !(s.stops || []).some(isClosed));
  const liveAdult = adult.filter(id => !isClosed(id));

  // stations — Москва (как раньше), cityStations — по городам
  return { updated: K.updated || '', places, scenarios: liveScenarios, events, adult: liveAdult, auto, stations, cityStations };
}

/* ---------- город ---------- */

const SPB_ID = /^(spb-|ev-spb-|p-spb-)/;
const isCityId = c => typeof c === 'string' && Object.prototype.hasOwnProperty.call(CITIES, c);
/* Город места по id и полям — как K.cityOf на сайте: поле city → префикс id (spb-…) → точка → Москва */
export function placeCity(id, p) {
  if (p && isCityId(p.city)) return p.city;
  if (typeof id === 'string' && SPB_ID.test(id)) return 'spb';
  if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) return regionOf(p.lat, p.lon) || 'msk';
  return 'msk';
}
/* Город места, плана, события или id (places — словарь мест или каталог, чтобы найти место по id):
   поле city → префикс id → первая остановка плана → площадка события → точка → Москва */
export function cityOf(x, places) {
  if (x == null) return 'msk';
  if (typeof x === 'string') {
    if (SPB_ID.test(x)) return 'spb';
    const P = places ? placesOf(places) : null;
    return P && P[x] ? placeCity(x, P[x]) : 'msk';
  }
  if (isCityId(x.city)) return x.city;
  if (typeof x.id === 'string' && SPB_ID.test(x.id)) return 'spb';
  if (Array.isArray(x.stops) && x.stops.length) return cityOf(String(x.stops[0]), places);
  if (typeof x.place === 'string' && x.place && places) return cityOf(x.place, places);
  if (Number.isFinite(x.lat) && Number.isFinite(x.lon)) return regionOf(x.lat, x.lon) || 'msk';
  return 'msk';
}

/* ---------- имена и адреса ---------- */

const TR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
export const translit = s => String(s || '').toLowerCase().replace(/[а-яё]/g, c => TR[c] ?? c);

// диакритика латиницы (Mátes → mates), но не й/ё
const deaccent = s => s.normalize('NFD').replace(/([a-z])[\u0300-\u036f]+/gi, '$1').normalize('NFC');

/* Слова-типы мест, которые часто то пишут, то нет: «Ресторан Белуга» = «Белуга» */
const KIND_WORDS = [
  'ресторан', 'ресторанчик', 'кафе', 'бар', 'кофейня', 'бистро', 'паб', 'пиццерия', 'пекарня', 'кондитерская',
  'гастробар', 'гастропаб', 'винный', 'коктейльный', 'ресторан-бар', 'кальянная', 'чайная', 'бургерная',
  'пельменная', 'столовая', 'пивной', 'пивная', 'караоке', 'караоке-бар', 'киберклуб', 'компьютерный', 'клуб',
  'бутик-отель', 'restaurant', 'cafe', 'bar', 'bistro', 'pub', 'coffee shop',
];
const KIND_RX = new RegExp('(^| )(' + KIND_WORDS.map(w => w.replace(/[-]/g, '\\-')).join('|') + ')(?= |$)', 'g');

/* Нормализованное имя: строчные, ё→е, без кавычек, пунктуации и слов-типов */
export function normName(s) {
  const base = deaccent(String(s || '').toLowerCase().replace(/ё/g, 'е'))
    .replace(/&/g, ' и ')
    .replace(/[«»"“”„‟'’`´]/g, '')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  let out = base;
  for (let i = 0; i < 3; i++) out = out.replace(KIND_RX, ' ').replace(/\s+/g, ' ').trim();
  return out || base;
}

/* «Скелет» имени для сравнения кириллицы с латиницей: Кофемания ≈ Coffeemania, Красота ≈ Krasota */
const skelWord = w => translit(w)
  .replace(/ph/g, 'f').replace(/w/g, 'v').replace(/x/g, 'ks').replace(/q/g, 'k').replace(/c/g, 'k')
  .replace(/[yj]/g, 'i').replace(/[^a-z0-9]/g, '')
  .replace(/(.)\1+/g, '$1');
// по словам: «Кофемания на Покровке» → «kofemania na pokrovke»
export const skeletonWords = s => normName(s).split(' ').map(skelWord).filter(Boolean).join(' ');
export const nameSkeleton = s => skeletonWords(s).replace(/ /g, '').replace(/(.)\1+/g, '$1');

function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
const sim = (a, b) => (!a || !b ? 0 : 1 - lev(a, b) / Math.max(a.length, b.length));
/* Похожесть имён 0..1: лучшее из сравнения нормализованных имён и скелетов */
export function nameSim(a, b) {
  const na = normName(a), nb = normName(b);
  return Math.max(sim(na, nb), sim(nameSkeleton(a), nameSkeleton(b)));
}

/* Слишком общие слова: «Парк» не должен совпасть с «Парком Горького» как сеть с филиалом */
const GENERIC = new Set(['парк', 'сад', 'музей', 'театр', 'галерея', 'сквер', 'бульвар', 'набережная', 'усадьба',
  'кинотеатр', 'библиотека', 'центр', 'дом', 'дворец', 'клуб', 'кино', 'пруд', 'пруды', 'площадь', 'улица', 'лофт',
  'студия', 'терраса', 'веранда', 'двор', 'кухня', 'место', 'мясо', 'вино', 'кофе', 'пицца', 'суши', 'гриль', 'the']
  .flatMap(w => [w, skelWord(w)]));
/* Одно имя — начало другого по границе слова: «Кофемания» и «Кофемания на Никитской», «Colizeum» и «Colizeum Таганка» */
function branchOf(na, nb) {
  const [s, l] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (s.length < 4 || s === l || GENERIC.has(s)) return false;
  return l.startsWith(s + ' ');
}
/* Все слова короткого имени есть в длинном: «Планетарий» ↔ «Московский планетарий» */
function tokensIn(na, nb) {
  const A = na.split(' '), B = nb.split(' ');
  const [s, l] = A.length <= B.length ? [A, new Set(B)] : [B, new Set(A)];
  if (s.length === l.size && s.every(w => l.has(w))) return false;            // одинаковые — это не сюда
  return s.every(w => l.has(w)) && s.some(w => w.length >= 4 && !GENERIC.has(w));
}

const CITY_RX = new RegExp('^(г\\.?\\s*)?(москва|химки|зеленоград|мытищи|люберцы|красногорск|балашиха|королев|одинцово|реутов|долгопрудный|котельники|видное|троицк|московский|коммунарка'
  + '|санкт-петербург|с\\.?-петербург|петербург|спб|пушкин|павловск|петергоф|новый петергоф|стрельна|ломоносов|кронштадт|сестрорецк|зеленогорск'
  + '|колпино|шушары|парголово|мурино|кудрово|всеволожск|сертолово)$');
const STREET_TYPES = new Set(['ул', 'улица', 'пер', 'переулок', 'просп', 'проспект', 'пр', 'пр-т', 'пр-кт', 'ш', 'шоссе',
  'бул', 'бульвар', 'б-р', 'наб', 'набережная', 'пл', 'площадь', 'проезд', 'туп', 'тупик', 'аллея', 'линия', 'тракт']);
const AREA_TYPES = new Set(['мкр', 'микрорайон', 'кв-л', 'квартал', 'тер', 'территория', 'пос', 'поселок', 'п', 'дер', 'деревня', 'село']);
const ADJ = [[/^(б|бол|больш(ой|ая|ое|ие))$/, 'б'], [/^(м|мал|мал(ый|ая|ое|ые))$/, 'м'], [/^(ср|средн(ий|яя|ее|ие))$/, 'ср'],
  [/^(в|верх|верхн(ий|яя|ее|ие))$/, 'в'], [/^(н|нижн(ий|яя|ее|ие))$/, 'н'], [/^(нов(ый|ая|ое|ые))$/, 'нов'],
  [/^(ст|стар(ый|ая|ое|ые))$/, 'ст']];
const ORD_RX = /^\d+-?(я|й|е|ый|ая|ое|ий)(?![а-я])/;
const BLD_RX = /^(стр|строение|корп|корпус|к|с)\.?\s*(\d+)/;
const words = p => p.replace(/\./g, ' ').split(/\s+/).filter(Boolean);
/* Номер дома: «10А», «23/14», «15-17», «34к7», «вл. 5», «д. 3 стр. 1» → { house: '10а', bld: 'к7' } */
function parseHouse(q) {
  const m = /^(?:д\.?|дом|вл\.?|влд\.?|владение)?\s*(\d+)(.*)$/.exec(q);
  if (!m || ORD_RX.test(q.replace(/^(?:д\.?|дом|вл\.?)\s*/, ''))) return null;
  let house = m[1], rest = m[2].trim(), bld = '';
  const lt = /^([а-я])(?![а-я])(.*)$/.exec(rest);
  if (lt && !(/^[кс]$/.test(lt[1]) && /^\s*\.?\s*\d/.test(lt[2]))) { house += lt[1]; rest = lt[2].trim(); }
  if (/^[а-я]{2}/.test(rest) && !BLD_RX.test(rest)) return null;              // «1905 года» — не дом
  rest = rest.replace(/^[/-]\s*\d+(?:[а-я](?![0-9]))?/, '').replace(/^[,\s]+/, '');
  const bm = BLD_RX.exec(rest);
  if (bm) bld = (bm[1][0] === 'к' ? 'к' : 'с') + bm[2];
  return { house, bld };
}

/* Улица, дом и строение из адреса: «ул. Большая Никитская, д. 23/14, стр. 1» → { street: 'б никитская', house: '23', bld: 'с1' } */
export function parseAddr(addr) {
  if (!addr) return null;
  const s = String(addr).toLowerCase().replace(/ё/g, 'е').replace(/\([^)]*\)/g, ' ').replace(/[«»"“”]/g, '');
  const parts = s.split(/[,;]/).map(x => x.trim()).filter(Boolean);
  const isCity = p => CITY_RX.test(p) || /^(россия|московская обл\S*|ленинградская обл\S*|\d{6})$/.test(p);
  const named = p => words(p).some(w => /[а-яa-z]{2}/.test(w) && !STREET_TYPES.has(w) && !AREA_TYPES.has(w) && !/^(корп|корпус|стр|строение)$/.test(w));
  const ok = p => !isCity(p) && named(p) && (!/^\d/.test(p) || ORD_RX.test(p));
  let si = parts.findIndex(p => ok(p) && words(p).some(w => STREET_TYPES.has(w)));
  if (si < 0) si = parts.findIndex(p => ok(p) && !words(p).some(w => AREA_TYPES.has(w)));
  if (si < 0) si = parts.findIndex(ok);
  if (si < 0) {
    // Зеленоград: «Зеленоград, корп. 1106» — номер корпуса вместо улицы и дома
    const z = parts.some(p => /зеленоград/.test(p)) && parts.map(p => /^(?:корп|корпус|к)\.?\s*(\d+)/.exec(p)).find(Boolean);
    return z ? { street: 'зеленоград', house: z[1], bld: '' } : null;
  }
  let p = parts[si], house = '', bld = '';
  // «Пятницкая 3», «ул. Арбат д. 5» — дом без запятой
  const tail = /^(.*?[а-яa-z.])\s+((?:д\.?\s*|дом\s+|вл\.?\s*)?\d.*)$/.exec(p);
  const th = tail && parseHouse(tail[2]);
  if (th) { p = tail[1]; house = th.house; bld = th.bld; }
  for (let i = si + 1; i < parts.length && !bld; i++) {
    const q = parts[i];
    const h = !house && parseHouse(q);
    if (h) { house = h.house; bld = h.bld; continue; }
    const bm = house && BLD_RX.exec(q);
    if (bm) { bld = (bm[1][0] === 'к' ? 'к' : 'с') + bm[2]; break; }
    if (!/^(подъезд|этаж|эт|оф|офис|пом|вход)/.test(q)) break;
  }
  const st = words(p.replace(/-(я|й|е|ый|ая|ое|ий)(?![а-я])/g, ''))
    .filter(w => !STREET_TYPES.has(w) && !AREA_TYPES.has(w))
    .map(w => { const ad = ADJ.find(([rx]) => rx.test(w)); return ad ? ad[1] : w; });
  if (!st.length) return null;
  return { street: st.sort().join(' '), house, bld };
}
const sameAddr = (a, b) => !!(a && b && a.house && a.street === b.street && a.house === b.house && (!a.bld || !b.bld || a.bld === b.bld));

/* ---------- расстояния ---------- */

const ll = p => (Array.isArray(p) ? { lat: p[0], lon: p[1] } : p || {});
export function distM(a, b) {
  const A = ll(a), B = ll(b);
  if (![A.lat, A.lon, B.lat, B.lon].every(Number.isFinite)) return Infinity;
  const R = 6371000, toR = x => x * Math.PI / 180;
  const dLat = toR(B.lat - A.lat), dLon = toR(B.lon - A.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(A.lat)) * Math.cos(toR(B.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ---------- поиск совпадений ---------- */

const placesOf = c => (c && c.places && typeof c.places === 'object' && !c.name ? c.places : c) || {};
// разобранные имя и адрес места — один раз на объект (findMatch зовут для каждого кандидата)
const memo = new WeakMap();
function keysOf(p) {
  let k = memo.get(p);
  if (!k || k.name !== p.name || k.addr !== p.addr) {
    k = { name: p.name, addr: p.addr, pn: normName(p.name), pw: skeletonWords(p.name), pk: nameSkeleton(p.name), pa: parseAddr(p.addr) };
    memo.set(p, k);
  }
  return k;
}

/* Еда, кофе и бары — одна группа: «Кафе» и «Кофейня» про одно и то же место пишут по-разному */
const GROUP = { food: 'gastro', coffee: 'gastro', bar: 'gastro' };
const groupOf = c => (c ? GROUP[c] || c : '');

/* Есть ли кандидат { name, lat?, lon?, addr?, kind?, cat? } в каталоге. Правила:
   то же имя (или то же имя латиницей/кириллицей) в пределах 300 м;
   филиал сети («Кофемания» ↔ «Кофемания на Никитской», «Colizeum» ↔ «Colizeum Таганка») в пределах 300 м;
   то же имя и тот же дом на той же улице (координаты не важны);
   все слова одного имени есть в другом («Планетарий» ↔ «Московский планетарий») в пределах 150 м;
   похожее имя (≥ 0,85) в пределах 120 м;
   без координат и адреса — только точное имя, если в каталоге оно одно (score 0,6).
   Филиал и похожее имя не считаются, если разделы явно разные (бистро и падел-клуб в одном комплексе).
   Только в том же городе: cand.city ('msk' | 'spb') или город по координатам кандидата — «Кофемания» в Москве
   и в Петербурге разные места, даже на одноимённой улице. Без города и координат — по всему каталогу.
   Возвращает { id, score, by } лучшего совпадения или null. */
export function findMatch(cand, catalog) {
  if (!cand || !cand.name) return null;
  const places = placesOf(catalog);
  const cn = normName(cand.name), cw = skeletonWords(cand.name), ck = nameSkeleton(cand.name);
  const ca = parseAddr(cand.addr);
  const hasLL = Number.isFinite(cand.lat) && Number.isFinite(cand.lon);
  const city = isCityId(cand.city) ? cand.city : hasLL ? regionOf(cand.lat, cand.lon) : '';
  const cg = groupOf(CATS.includes(cand.cat) ? cand.cat : cand.kind ? catOf(cand.kind) : '');
  let best = null;
  let ck2 = 1;
  const offer = (id, score, by) => { score *= ck2; if (!best || score > best.score) best = { id, score: Math.round(score * 1000) / 1000, by }; };
  const exact = [];
  for (const [id, p] of Object.entries(places)) {
    if (!p || !p.name) continue;
    if (city && placeCity(id, p) !== city) continue;
    const { pn, pw, pk, pa } = keysOf(p);
    const same = pn === cn;
    const skel = !same && ck.length >= 4 && pk === ck;
    const looseOk = !cg || groupOf(catOfPlace(p)) === cg;
    const branch = !same && !skel && looseOk && (branchOf(cn, pn) || branchOf(cw, pw));
    const subset = !same && !skel && !branch && looseOk && (tokensIn(cn, pn) || tokensIn(cw, pw));
    ck2 = looseOk ? 1 : 0.9;                                          // тот же раздел — выше при равных именах
    if (same) exact.push(id);
    const d = hasLL ? distM(cand, p) : Infinity;
    if ((same || skel || branch) && ca && sameAddr(ca, pa)) {
      offer(id, same ? 0.99 : skel ? 0.97 : 0.93, 'name+addr');
      continue;
    }
    if (d <= 300) {
      const k = 1 - d / 3000;                                          // 1 у самой точки, 0,9 на 300 м
      if (same) { offer(id, k, 'name+300m'); continue; }
      if (skel) { offer(id, 0.97 * k, 'translit+300m'); continue; }
      if (branch) { offer(id, 0.92 * k, 'branch+300m'); continue; }
      if (subset && d <= 150) { offer(id, 0.88 * k, 'words+150m'); continue; }
    }
    if (d <= 120 && looseOk) {
      const sm = nameSim(cand.name, p.name);
      if (sm >= 0.85) offer(id, sm * 0.9 * (1 - d / 1200), 'fuzzy+120m');
    }
  }
  ck2 = 1;
  if (!best && !hasLL && !ca && exact.length === 1) offer(exact[0], 0.6, 'name-only');
  return best;
}

/* ---------- id мест ---------- */

/* Латинский kebab-case id из названия, уникальный относительно taken (Set, массив или объект с id-ключами).
   prefix — начало id: 'spb-' у мест Петербурга (по нему сайт понимает город) */
export function slugId(name, taken, prefix = '') {
  const has = !taken ? () => false
    : taken instanceof Set || taken instanceof Map ? x => taken.has(x)
      : Array.isArray(taken) ? x => taken.includes(x)
        : x => Object.prototype.hasOwnProperty.call(taken, x);
  let base = translit(deaccent(String(name || '').toLowerCase()))
    .replace(/&/g, ' and ')
    .replace(/['’`"«»]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (base.length > 40) base = base.slice(0, 40).replace(/-[^-]*$/, '') || base.slice(0, 40);
  base = prefix + (base.replace(/-+$/, '') || 'place');
  if (!has(base)) return base;
  for (let i = 2; ; i++) if (!has(`${base}-${i}`)) return `${base}-${i}`;
}

/* id нового места города: в Петербурге — spb-<название>; московское место с названием «SPB …»
   не должно начинаться с spb- (иначе сайт решит, что оно петербургское) — тогда msk-<название> */
export function placeId(name, taken, city = 'msk') {
  if (city === 'spb') return slugId(name, taken, 'spb-');
  const id = slugId(name, taken);
  return SPB_ID.test(id) ? slugId(name, taken, 'msk-') : id;
}

/* ---------- разделы каталога ---------- */

/* Раздел по типу места — та же таблица, что CAT_BY_KIND в assets/shared.js, но «спа» и «баня» — целым словом
   (иначе «Испанский ресторан» попадает в спа). Конвейер всегда пишет cat явно, это запасной вариант. */
const CAT_BY_KIND = [
  ['pc', /компьютерн|кибер/i],
  ['books', /книж/i], ['spa', /(^|[^а-яё])(бан[яиь]|банн|спа|хамам|аквапарк|терм)/i], ['coffee', /коф|пекар|кондитер|булоч|чайн/i],
  ['fun', /тир|боулинг|картинг|vr|квест|скалодром|падел|стендап|бильярд|караоке|аттракц|развлеч|теплоход|студи|мастер|арт-вечер|танц|стадион|петанк/i],
  ['culture', /музе|театр|кино|галере|планетар|концерт|дом культуры|культурн|центр|искусств|лекторий|архитектур/i],
  ['walk', /парк|сад|набереж|усадьб|заповедник|смотров|квартал|дизайн-завод|креатив/i],
  ['bar', /бар|паб|лаунж|винотек|крафт/i],
];
export const CATS = ['food', 'coffee', 'bar', 'culture', 'walk', 'fun', 'spa', 'books', 'pc'];
export function catOf(kind) {
  const k = kind && typeof kind === 'object' ? (kind.cat || kind.c || kind.kind) : kind;
  if (kind && typeof kind === 'object' && CATS.includes(k)) return k;
  return (CAT_BY_KIND.find(([, rx]) => rx.test(k || '')) || ['food'])[0];
}
const catOfPlace = p => (p && CATS.includes(p.cat) ? p.cat : catOf(p && p.kind));

/* ---------- индекс для промпта ---------- */

/* Компактный список «id|name|kind|addr», отсортированный по id — стабилен между запусками (кеш промпта).
   Оба города в одном списке: у мест Петербурга адрес начинается с «Санкт-Петербург, » (и id — с spb-),
   у московских адрес как есть. city — только места этого города */
export function catalogIndex(catalog, city) {
  const places = placesOf(catalog);
  const f = s => String(s == null ? '' : s).replace(/[|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return Object.keys(places).sort().filter(id => !city || placeCity(id, places[id]) === city).map(id => {
    const p = places[id];
    const c = placeCity(id, p);
    const addr = c === 'msk' ? f(p.addr) : `${CITIES[c].full}, ${f(p.addr)}`;
    return [id, f(p.name), f(p.kind) + (p.closed ? ' (закрыто)' : ''), addr].join('|');
  }).join('\n');
}

/* ---------- проверка плана ---------- */

export const MAX_LEG_M = 1600;
// винный бар — по типу, а у баров и гастробаров ещё по названию и эмодзи («Хлеб и вино», 🍷)
const WINE_RX = /(^|[^а-яё])вин(о|а|у|ом|е|н|отек)|wine|vino|энотек|🍷/i;     // «Винтаж», «Винил» — не про вино
const isWineBar = p => (catOfPlace(p) === 'bar' || /бар|винотек|погреб/i.test(p.kind || ''))
  && (WINE_RX.test(p.kind || '') || WINE_RX.test(p.name || '') || WINE_RX.test(p.emoji || ''));
const isBurlesque = p => p.a18 === 'show' || /бурлеск/i.test(p.kind || '');
const isMenStrip = p => p.a18 === 'men' || /мужск\S* стриптиз/i.test(p.kind || '');
const isAdultPlace = (id, p, adultIds) => !!(p.adult || (adultIds && adultIds.has(id)));
const FOOD_RX = /ресторан|кафе|бистро|фудхолл|фудмолл|фудкорт|рынок|кухн|пицц|бургер|столов|траттори|остери|брассери|гастро|стейк|суши|рамен|пельмен|блин|хинкал|чебурек|шаурм|закусоч|таверн|харчевн|корчм|трактир|едальн|кулинар|кантин|дайнер|раковарн|хого|бушон|сэндвич|такери|дёнер|денер/i;
// вечерние развлечения: караоке после вина или стендап после ужина — нормальный порядок
const EVENING_RX = /караоке|стендап|бильярд|боулинг|танц|шоу|кабаре|дискотек|компьютерн|кибер/i;
/* Роль остановки для порядка: занятие/прогулка — сначала, еда/бар — потом.
   Кофе, 18+ и вечерние развлечения — нейтральны. Тип без явного cat, не похожий на еду («Океанариум»), — занятие. */
function role(p) {
  if (p.adult) return 'night';
  const c = catOfPlace(p);
  if (c === 'food') return CATS.includes(p.cat) || FOOD_RX.test(p.kind || '') ? 'eat' : 'act';
  if (c === 'bar') return 'drink';
  if (c === 'coffee') return 'coffee';
  if ((c === 'fun' || c === 'pc') && EVENING_RX.test(p.kind || '')) return 'evening';
  return 'act';
}

/* Проверка плана по правилам из README/спецификации. places — словарь мест (или весь каталог) */
export function validatePlan(plan, places, opts = {}) {
  const errors = [];
  const P = placesOf(places);
  const adultIds = opts.adult ? new Set(opts.adult) : (places && Array.isArray(places.adult) ? new Set(places.adult) : null);
  if (!plan || typeof plan !== 'object') return { ok: false, errors: ['план пустой'] };
  if (!['date', 'guys', 'girls'].includes(plan.mode)) errors.push(`неизвестный mode «${plan.mode}»`);
  const stops = Array.isArray(plan.stops) ? plan.stops : [];
  if (stops.length < 1 || stops.length > 3) errors.push(`остановок ${stops.length}, нужно от 1 до 3`);
  if (new Set(stops).size !== stops.length) errors.push('одно место дважды');
  const tags = Array.isArray(plan.tags) ? plan.tags : [];
  const ps = [];
  for (const id of stops) {
    const p = P[id];
    if (!p) { errors.push(`нет места ${id}`); continue; }
    if (p.closed) errors.push(`место ${id} закрыто`);
    ps.push([id, p]);
  }
  if (ps.length !== stops.length) return { ok: false, errors };

  // один город на план — даже с тегом drive; петербургский план (spb-… или city) — только с местами Петербурга
  const cities = [...new Set(ps.map(([id, p]) => placeCity(id, p)))];
  if (cities.length > 1) {
    errors.push(`места из разных городов: ${ps.map(([id, p]) => `${id} (${CITIES[placeCity(id, p)].name})`).join(', ')}`);
  } else if (cities.length === 1) {
    const declared = isCityId(plan.city) ? plan.city : typeof plan.id === 'string' && SPB_ID.test(plan.id) ? 'spb' : '';
    if (declared && declared !== cities[0]) errors.push(`план города «${CITIES[declared].name}», а места — ${CITIES[cities[0]].in}`);
  }

  for (let i = 1; i < ps.length; i++) {
    const [ia, a] = ps[i - 1], [ib, b] = ps[i];
    const d = distM(a, b);
    if (!tags.includes('drive') && !(d <= MAX_LEG_M)) {
      errors.push(`переход ${ia} → ${ib}: ${Number.isFinite(d) ? Math.round(d) + ' м' : 'нет координат'} > ${MAX_LEG_M} м (нужен тег drive)`);
    }
    const ra = role(a), rb = role(b);
    if (ra === 'eat' && rb === 'eat') errors.push(`два ужина подряд: ${ia} → ${ib}`);
  }
  let fed = null;
  for (const [id, p] of ps) {
    const r = role(p);
    if (r === 'act' && fed) errors.push(`${id} (${p.kind}) после еды или бара (${fed}): сначала занятие или прогулка`);
    if (isWineBar(p) && ps.some(([id2, q]) => id2 !== id && role(q) === 'eat' && stops.indexOf(id2) < stops.indexOf(id))) {
      errors.push(`винный бар ${id} после ресторана`);
    }
    if (r === 'eat' || r === 'drink') fed = fed || id;
  }
  for (const [id, p] of ps) {
    if (!isAdultPlace(id, p, adultIds)) continue;
    if (plan.mode === 'date' && !isBurlesque(p)) errors.push(`18+ ${id} на свидании (можно только бурлеск)`);
    if (isMenStrip(p) && plan.mode !== 'girls') errors.push(`мужской стриптиз ${id} только для режима girls`);
  }
  return { ok: errors.length === 0, errors };
}

/* ---------- соседи ---------- */

/* Места рядом с точкой (для подборок вокруг нового места): без закрытых и 18+, только того же города, ближайшие первыми */
export function nearbyPlaces(place, catalog, radiusM = 1200, limit = 25) {
  const P = placesOf(catalog);
  const adultIds = catalog && Array.isArray(catalog.adult) ? new Set(catalog.adult) : new Set();
  const city = place ? placeCity(place.id, place) : 'msk';
  const out = [];
  for (const [id, p] of Object.entries(P)) {
    if (place && place.id === id) continue;
    if (p.closed || p.adult || adultIds.has(id)) continue;
    if (placeCity(id, p) !== city) continue;
    const d = distM(place, p);
    if (!(d <= radiusM)) continue;
    if (d < 1 && place && place.name && normName(place.name) === normName(p.name)) continue;   // это само место
    out.push({ id, name: p.name, kind: p.kind, cat: catOfPlace(p), distM: Math.round(d) });
  }
  return out.sort((a, b) => a.distM - b.distM || a.id.localeCompare(b.id)).slice(0, limit);
}

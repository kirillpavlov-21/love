/* Геокодирование адресов, округ и ближайшее метро.
   Яндекс HTTP Геокодер, если есть ключ; иначе Nominatim (OpenStreetMap) по правилам сервиса:
   не чаще раза в секунду, понятный User-Agent, результаты кешируются. */

export const UA = 'KudaIdemBot/1.0 (+https://kirillpavlov-21.github.io/love/)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r6 = x => Math.round(x * 1e6) / 1e6;

/* ---------- Москва и область ---------- */

export function inMoscowRegion(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 55.1 && lat <= 56.1 && lon >= 36.8 && lon <= 38.3;
}

function distM(a, b) {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* Ближайшая станция из таблицы { 'Станция': [lat, lon] } (или массива { name, lat, lon }) */
export function nearestMetro(lat, lon, stations) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !stations) return null;
  const list = Array.isArray(stations) ? stations.map(s => [s.name, s.lat, s.lon])
    : Object.entries(stations).map(([name, [la, lo]]) => [name, la, lo]);
  let best = null;
  for (const [name, la, lo] of list) {
    const d = distM({ lat, lon }, { lat: la, lon: lo });
    if (!best || d < best.distM) best = { name, distM: d };
  }
  return best && { name: best.name, distM: Math.round(best.distM) };
}

/* ---------- округ ---------- */

const NB = '(?<![а-яё])', NA = '(?![а-яё])';
const AO_ABBR = { цао: 'center', сао: 'north', свао: 'ne', вао: 'east', ювао: 'se', юао: 'south', юзао: 'sw', зао: 'west',
  сзао: 'nw', зелао: 'zel', нао: 'new', тао: 'new', тинао: 'new' };
const AO_ADJ = [['северо-восточн', 'ne'], ['юго-восточн', 'se'], ['северо-западн', 'nw'], ['юго-западн', 'sw'],
  ['центральн', 'center'], ['северн', 'north'], ['восточн', 'east'], ['южн', 'south'], ['западн', 'west'],
  ['зеленоградск', 'zel'], ['новомосковск', 'new'], ['троицк', 'new']];
const CENTER = { lat: 55.7520, lon: 37.6175 };

/* Районы и поселения Москвы по округам: Nominatim часто называет только район («район Зюзино») без округа */
const RAYONS = {
  center: 'арбат,басманный,замоскворечье,красносельский,мещанский,пресненский,таганский,тверской,хамовники,якиманка',
  north: 'аэропорт,беговой,бескудниковский,войковский,восточное дегунино,головинский,дмитровский,западное дегунино,коптево,левобережный,молжаниновский,савеловский,сокол,тимирязевский,ховрино,хорошевский',
  ne: 'алексеевский,алтуфьевский,бабушкинский,бибирево,бутырский,лианозово,лосиноостровский,марфино,марьина роща,останкинский,отрадное,ростокино,свиблово,северное медведково,северный,южное медведково,ярославский',
  east: 'богородское,вешняки,восточное измайлово,восточный,гольяново,ивановское,измайлово,косино-ухтомский,метрогородок,новогиреево,новокосино,перово,преображенское,северное измайлово,соколиная гора,сокольники',
  se: 'выхино-жулебино,капотня,кузьминки,лефортово,люблино,марьино,некрасовка,нижегородский,печатники,рязанский,текстильщики,южнопортовый',
  south: 'бирюлево восточное,бирюлево западное,братеево,даниловский,донской,зябликово,москворечье-сабурово,нагатино-садовники,нагатинский затон,нагорный,орехово-борисово северное,орехово-борисово южное,царицыно,чертаново северное,чертаново центральное,чертаново южное',
  sw: 'академический,гагаринский,зюзино,коньково,котловка,ломоносовский,обручевский,северное бутово,теплый стан,черемушки,южное бутово,ясенево',
  west: 'внуково,дорогомилово,крылатское,кунцево,можайский,ново-переделкино,очаково-матвеевское,проспект вернадского,раменки,солнцево,тропарево-никулино,филевский парк,фили-давыдково',
  nw: 'куркино,митино,покровское-стрешнево,северное тушино,строгино,хорошево-мневники,щукино,южное тушино',
  zel: 'матушкино,савелки,силино,старое крюково,крюково',
  new: 'сосенское,коммунарка,внуковское,воскресенское,десеновское,кокошкино,марушкинское,московский,мосрентген,рязановское,филимонковское,щербинка,троицк,вороновское,киевский,кленовское,краснопахорское,михайлово-ярцевское,новофедоровское,первомайское,роговское,щаповское',
};
const RAYON = new Map(Object.entries(RAYONS).flatMap(([okr, list]) => list.split(',').map(n => [n, okr])));
const rayonKey = part => part.replace(/(^|\s)(район|поселение|муниципальный округ|внутригородское муниципальное образование|городской округ|поселок|пос\.)(?=\s|$)/g, ' ')
  .replace(/\s+/g, ' ').trim();

/* Округ по координатам, когда геокодер его не назвал: расстояние и направление от Кремля.
   Границы секторов подобраны по местам каталога (совпадает примерно у 85 %); такие места стоит проверить глазами. */
const SECTORS = [[30, 'ne'], [85, 'east'], [145, 'se'], [185, 'south'], [220, 'sw'], [278, 'west'], [300, 'nw'], [345, 'north'], [360, 'ne']];
function okrByGeometry(lat, lon) {
  if (lat >= 55.95 && lat <= 56.04 && lon >= 37.10 && lon <= 37.30) return 'zel';
  const d = distM(CENTER, { lat, lon });
  if (d < 3800) return 'center';
  const dy = lat - CENTER.lat, dx = (lon - CENTER.lon) * Math.cos(CENTER.lat * Math.PI / 180);
  const deg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;                  // 0 — север, 90 — восток
  if (d > 17000) {
    if (deg >= 312 && deg <= 335 && d < 24000) return 'khimki';
    if (deg >= 190 && deg <= 250 && d > 19000) return 'new';
    if (!(deg >= 185 && deg <= 300 && d < 20500)) return 'mo';                   // на западе Москва заходит за МКАД
  }
  return SECTORS.find(([to]) => deg < to)[1];
}

/* Код округа по названию района от геокодера («Центральный административный округ», «ЮЗАО»,
   «Московская область, городской округ Химки»). Если названия нет — ближайшее место каталога
   (places, необязательно, до 1,5 км), иначе — по координатам. */
export function okrOf(lat, lon, district, places) {
  const s = String(district || '').toLowerCase().replace(/ё/g, 'е');
  if (s) {
    const ao = new RegExp(NB + '([а-я-]+?)(?:ий|ый|ой)\\s+(?:административн\\S*\\s+)?округ', 'g');
    let m;
    while ((m = ao.exec(s))) {
      const hit = AO_ADJ.find(([pre]) => m[1].startsWith(pre));
      if (hit) return hit[1];
    }
    const ab = new RegExp(NB + '(' + Object.keys(AO_ABBR).join('|') + ')' + NA).exec(s);
    if (ab) return AO_ABBR[ab[1]];
    if (/зеленоград/.test(s)) return 'zel';
    const oblast = /московская обл/.test(s);
    if (new RegExp(NB + 'химки' + NA).test(s) && !/(^|, )москва(,|$)/.test(s.replace(/московская область/g, ''))) return 'khimki';
    if (oblast) return 'mo';
    for (const part of s.split(/\s*,\s*/)) {
      const okr = RAYON.get(rayonKey(part));
      if (okr) return okr;
    }
    if (/новая москва|поселение/.test(s)) return 'new';
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  if (places) {
    let best = null;
    for (const p of Object.values(places)) {
      if (!p || !p.okr || !Number.isFinite(p.lat)) continue;
      const d = distM({ lat, lon }, p);
      if (d < 1500 && (!best || d < best.d)) best = { d, okr: p.okr };
    }
    if (best) return best.okr;
  }
  return okrByGeometry(lat, lon);
}

/* ---------- кеш и очередь запросов ---------- */

function cacheApi(cache) {
  if (!cache) return null;
  if (typeof cache.get === 'function' && typeof cache.set === 'function') {
    return { has: k => (typeof cache.has === 'function' ? cache.has(k) : cache.get(k) !== undefined), get: k => cache.get(k), set: (k, v) => cache.set(k, v) };
  }
  return { has: k => Object.prototype.hasOwnProperty.call(cache, k), get: k => cache[k], set: (k, v) => { cache[k] = v; } };
}

/* Не чаще одного запроса в minIntervalMs к одному сервису — даже если geocode зовут параллельно */
const gates = new Map();
function throttle(key, minIntervalMs) {
  const prev = gates.get(key) || Promise.resolve(0);
  const next = prev.then(async lastAt => {
    const wait = lastAt + minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    return Date.now();
  });
  gates.set(key, next);
  return next;
}

async function getJson(url, { fetchImpl, provider, minIntervalMs }) {
  await throttle(provider, minIntervalMs);
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru', Accept: 'application/json' } });
  if (!res.ok) throw Object.assign(new Error(`${provider}: HTTP ${res.status}`), { status: res.status });
  return res.json();
}

/* В адресе нет города — значит, Москва */
const hasCity = a => /москв|област|обл\.|химки|зеленоград|мытищ|красногорск|люберц|балаших|королев|королёв|одинцов|реутов|долгопрудн|котельник|видное|троицк|коммунарк|щербинк|апрелевк|лобн|сколково/i.test(a);

/* Из нескольких находок: ближайшая к near (например, к станции метро из поста), иначе первая — её геокодер считает лучшей.
   ambiguous — находки дальше 2 км друг от друга (в Москве несколько Октябрьских улиц): адрес стоит проверить. */
function choose(list, near) {
  if (!list.length) return null;
  let best = list[0];
  if (near && Number.isFinite(near.lat) && Number.isFinite(near.lon)) {
    best = list.reduce((x, y) => (distM(y, near) < distM(x, near) ? y : x));
  }
  const out = { lat: best.lat, lon: best.lon, display: best.display, district: best.district, precision: best.precision };
  const others = list.filter(x => x !== best && distM(x, best) > 2000);
  if (others.length) {
    out.ambiguous = true;
    out.alts = others.slice(0, 4).map(x => ({ lat: x.lat, lon: x.lon, display: x.display }));
  }
  return out;
}

/* ---------- Яндекс ---------- */

const YA = 'https://geocode-maps.yandex.ru/1.x/';
const yaMembers = j => (((j || {}).response || {}).GeoObjectCollection || {}).featureMember || [];
async function viaYandex(addr, { yandexKey, fetchImpl, minIntervalMs, near }) {
  const q = hasCity(addr) ? addr : 'Москва, ' + addr;
  const url = `${YA}?apikey=${encodeURIComponent(yandexKey)}&geocode=${encodeURIComponent(q)}&format=json&lang=ru_RU&bbox=36.8,55.1~38.3,56.1&rspn=1&results=5`;
  const j = await getJson(url, { fetchImpl, provider: 'yandex', minIntervalMs });
  const list = [];
  for (const { GeoObject: g } of yaMembers(j)) {
    if (!g || !g.Point) continue;
    const [lon, lat] = String(g.Point.pos).split(/\s+/).map(Number);
    if (!inMoscowRegion(lat, lon)) continue;
    const meta = (g.metaDataProperty || {}).GeocoderMetaData || {};
    // результат «просто Москва» или область — это не адрес
    if (['country', 'province', 'area'].includes(meta.kind)) continue;
    if (meta.kind === 'locality' && /(^|,\s*)Москва$/.test(meta.text || '')) continue;
    const comps = ((meta.Address || {}).Components || []).filter(c => ['province', 'area', 'locality', 'district'].includes(c.kind))
      .map(c => c.name).filter(n => n && !/федеральный округ|^Россия$/.test(n));
    list.push({ lat: r6(lat), lon: r6(lon), display: meta.text || g.name || addr, district: [...new Set(comps)].join(', '), precision: meta.precision || meta.kind || '' });
  }
  const res = choose(list, near);
  if (res && !/административн|округ/i.test(res.district) && /(^|, )Москва(,|$)/.test(res.district)) {
    // в ответе на дом округа нет — спросим обратным геокодированием
    try {
      const rj = await getJson(`${YA}?apikey=${encodeURIComponent(yandexKey)}&geocode=${res.lon},${res.lat}&kind=district&format=json&lang=ru_RU&results=3`,
        { fetchImpl, provider: 'yandex', minIntervalMs });
      const names = yaMembers(rj).map(x => x.GeoObject && x.GeoObject.name).filter(Boolean);
      if (names.length) res.district = [res.district, ...names].filter(Boolean).join(', ');
    } catch (e) { /* без округа — okrOf посчитает по району или координатам */ }
  }
  return res;
}

/* ---------- Nominatim ---------- */

const OSM = 'https://nominatim.openstreetmap.org/search';
/* Nominatim плохо понимает сокращения и «стр. 1»: второй запрос — упрощённый адрес */
const ABBR = [[/(^|[\s,])ул\.\s*/g, '$1улица '], [/(^|[\s,])просп\.\s*/g, '$1проспект '], [/(^|[\s,])пр-к?т\.?\s*/g, '$1проспект '],
  [/(^|[\s,])пер\.\s*/g, '$1переулок '], [/(^|[\s,])ш\.\s*/g, '$1шоссе '], [/(^|[\s,])наб\.\s*/g, '$1набережная '],
  [/(^|[\s,])бул\.\s*/g, '$1бульвар '], [/(^|[\s,])пл\.\s*/g, '$1площадь '], [/(^|[\s,])пр\.\s*/g, '$1'],   // «пр.» — то проспект, то проезд: лучше без него
  [/(^|[\s,])(?:д|вл|влд)\.\s*/g, '$1']];
export function simplifyAddr(addr) {
  let s = String(addr).replace(/\([^)]*\)/g, ' ')
    .replace(/,\s*(?:стр|строение|корп|корпус|к|подъезд|этаж|эт|оф|офис|вход)\.?\s*[^,]*/gi, '')
    .replace(/(\d+[а-яА-Я]?)\s*\/\s*\d+(?:[а-яА-Я](?!\d))?/g, '$1')
    .replace(/(\d+[а-яА-Я]?)\s*[кКсС]\.?\s*\d+/g, '$1');
  for (const [rx, to] of ABBR) s = s.replace(rx, to);
  return s.replace(/\s+,/g, ',').replace(/\s+/g, ' ').replace(/,\s*$/, '').trim();
}

async function viaNominatim(addr, { fetchImpl, minIntervalMs, near }) {
  const withCity = x => (hasCity(x) ? x : x + ', Москва');
  const variants = [...new Set([withCity(addr), withCity(simplifyAddr(addr))])];
  for (const q of variants) {
    const url = `${OSM}?format=jsonv2&addressdetails=1&countrycodes=ru&viewbox=36.8,56.1,38.3,55.1&bounded=1&limit=5&accept-language=ru&q=${encodeURIComponent(q)}`;
    const raw = await getJson(url, { fetchImpl, provider: 'nominatim', minIntervalMs });
    const list = [];
    for (const r of Array.isArray(raw) ? raw : []) {
      const lat = Number(r.lat), lon = Number(r.lon);
      if (!inMoscowRegion(lat, lon)) continue;
      if (Number(r.place_rank) > 0 && Number(r.place_rank) < 17) continue;          // город или область целиком
      const ad = r.address || {};
      const district = [...new Set([ad.state, ad.county, ad.city, ad.town, ad.village, ad.city_district, ad.suburb].filter(Boolean))].join(', ');
      const precision = ad.house_number || ['house', 'building'].includes(r.addresstype) ? 'exact' : r.addresstype === 'road' ? 'street' : (r.addresstype || r.type || '');
      list.push({ lat: r6(lat), lon: r6(lon), display: r.display_name || addr, district, precision });
    }
    if (list.length) return choose(list, near);
  }
  return null;
}

/* Адрес → { lat, lon, display, district, precision, ambiguous?, alts? } или null.
   null — не нашли (кешируется) или ошибка сети (не кешируется, пишем в log).
   strict: true — ошибку сети или сервиса (429, 5xx, блокировка) не прячем в null, а бросаем с transient: true:
   «не нашли» и «геокодер недоступен» — разные вещи, второе надо повторить в следующий раз.
   near { lat, lon } — подсказка, где искать (координаты станции метро из поста): из нескольких находок берём ближнюю.
   cache — Map или обычный объект; ключ включает сервис и подсказку. */
export async function geocode(addr, { yandexKey, fetchImpl = globalThis.fetch, cache, minIntervalMs = 1100, near, log = console.warn, strict = false } = {}) {
  const q = String(addr || '').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  const provider = yandexKey ? 'yandex' : 'osm';
  const hint = near && Number.isFinite(near.lat) && Number.isFinite(near.lon) ? `@${near.lat.toFixed(3)},${near.lon.toFixed(3)}` : '';
  const key = provider + ':' + q.toLowerCase() + hint;
  const c = cacheApi(cache);
  if (c && c.has(key)) return c.get(key) || null;
  let res;
  try {
    res = yandexKey ? await viaYandex(q, { yandexKey, fetchImpl, minIntervalMs, near }) : await viaNominatim(q, { fetchImpl, minIntervalMs, near });
  } catch (e) {
    if (log) log(`geocode «${q}»: ${e.message}`);
    if (strict) throw Object.assign(new Error(`геокодер недоступен (${e.message})`), { transient: true, status: e.status });
    return null;
  }
  if (c) c.set(key, res);
  return res;
}

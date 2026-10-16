/* Геокодирование адресов, округ и ближайшее метро — для Москвы и Петербурга.
   Яндекс HTTP Геокодер, если есть ключ; иначе Nominatim (OpenStreetMap) по правилам сервиса:
   не чаще раза в секунду, понятный User-Agent, результаты кешируются. */

export const UA = 'KudaIdemBot/1.0 (+https://kirillpavlov-21.github.io/love/)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r6 = x => Math.round(x * 1e6) / 1e6;

/* ---------- города ----------
   Те же id, что K.CITIES в assets/shared.js: 'msk' и 'spb'. Нет поля city — значит, Москва.
   box — рамка [юг, запад, север, восток] для геокодера и проверки «адрес в нашем регионе»:
   Москва с ближним Подмосковьем; Петербург с пригородами (Кронштадт, Петергоф, Пушкин, Колпино, Зеленогорск)
   и ближней Ленобластью (Мурино, Кудрово, Всеволожск). okrs — коды районов, как в places.js / places-spb.js */
export const CITIES = {
  msk: { id: 'msk', name: 'Москва', full: 'Москва', in: 'в Москве', area: 'Москвы и ближнего Подмосковья',
    center: [55.7520, 37.6175], box: [55.1, 36.8, 56.1, 38.3],
    okrs: ['center', 'north', 'ne', 'east', 'se', 'south', 'sw', 'west', 'nw', 'zel', 'new', 'khimki', 'mo'] },
  spb: { id: 'spb', name: 'Петербург', full: 'Санкт-Петербург', in: 'в Петербурге', area: 'Петербурга и пригородов',
    center: [59.939167, 30.315833], box: [59.633, 29.425, 60.245, 30.76],
    okrs: ['center', 'petrograd', 'vo', 'north', 'nw', 'south', 'sw', 'east', 'out'] },
};
export const CITY_IDS = Object.keys(CITIES);
const isCity = c => typeof c === 'string' && Object.prototype.hasOwnProperty.call(CITIES, c);

/* Код города из конфига или ответа модели: 'msk' | 'spb' | '' (не распознан). Понимает и русские названия */
const CITY_ALIAS = { msk: 'msk', moscow: 'msk', moskva: 'msk', 'москва': 'msk', 'мск': 'msk',
  spb: 'spb', 'saint-petersburg': 'spb', 'st-petersburg': 'spb', petersburg: 'spb', piter: 'spb', 'санкт-петербург': 'spb',
  'петербург': 'spb', 'спб': 'spb', 'питер': 'spb' };
export function normCity(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase().replace(/ё/g, 'е').replace(/[\s_.]+/g, '-');
  return isCity(s) ? s : CITY_ALIAS[s] || '';
}

const inBox = (box, lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && lat >= box[0] && lat <= box[2] && lon >= box[1] && lon <= box[3];

export function inMoscowRegion(lat, lon) {
  return inBox(CITIES.msk.box, lat, lon);
}
export function inSpbRegion(lat, lon) {
  return inBox(CITIES.spb.box, lat, lon);
}
/* Точка в регионе города (Москва по умолчанию — как раньше) */
export function inRegion(city, lat, lon) {
  return inBox((CITIES[city] || CITIES.msk).box, lat, lon);
}
/* Город по точке: 'msk' | 'spb' | '' (ни там, ни там) */
export function regionOf(lat, lon) {
  return CITY_IDS.find(c => inRegion(c, lat, lon)) || '';
}

/* Приметы города в тексте адреса или поста: 'spb' | 'msk' | ''. Пригороды — целым словом:
   «Пушкин, Садовая ул.» — Петербург, а «Пушкинская ул.» — просто улица */
const SPB_WORDS = new RegExp('(?<![а-яё])(санкт-петербург\\S*|с\\.-петербург\\S*|петербург\\S*|спб|питер[ае]?|ленинградская обл\\S*|ленобласть|'
  + 'пушкин|павловск|петергоф|новый петергоф|ломоносов|кронштадт|сестрорецк|зеленогорск|колпино|стрельна|красное село|шушары|парголово|'
  + 'песочный|репино|комарово|ольгино|лахта|левашово|мурино|кудрово|всеволожск|девяткино|сертолово)(?![а-яё])', 'i');
const MSK_WORDS = /(?<![а-яё])(москв[аеуы]|московская обл\S*|подмосковь\S*)(?![а-яё])/i;
export function cityHint(text) {
  const s = String(text || '').toLowerCase().replace(/ё/g, 'е');
  if (SPB_WORDS.test(s)) return 'spb';
  if (MSK_WORDS.test(s)) return 'msk';
  return '';
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

/* ---------- районы Петербурга ----------
   Код района сайта по названию административного района: геокодеры отвечают «Центральный район»,
   «Петроградский район», для пригородов — «Пушкинский район» или сам город («Ломоносов»). */
const SPB_RAYON = [['центральн', 'center'], ['адмиралтейск', 'center'], ['петроградск', 'petrograd'], ['василеостровск', 'vo'],
  ['выборгск', 'north'], ['калининск', 'north'], ['приморск', 'nw'], ['московск', 'south'], ['фрунзенск', 'south'],
  ['кировск', 'sw'], ['красносельск', 'sw'], ['невск', 'east'], ['красногвардейск', 'east'],
  ['пушкинск', 'out'], ['петродворцов', 'out'], ['кронштадтск', 'out'], ['курортн', 'out'], ['колпинск', 'out'],
  ['всеволожск', 'out'], ['ломоносовск', 'out'], ['гатчинск', 'out'], ['тосненск', 'out']];
const SPB_TOWNS = /(?<![а-яё])(пушкин|павловск|петергоф|новый петергоф|стрельна|ломоносов|кронштадт|сестрорецк|зеленогорск|колпино|шушары|мурино|кудрово|всеволожск|сертолово)(?![а-яё])/;
/* Опорные точки районов: когда геокодер района не назвал и рядом нет мест каталога, берём район ближайшей точки
   (центр, острова, берега Невы и пригороды — по станциям метро и известным местам) */
const SPB_ANCHORS = [
  ['center', 59.9390, 30.3158], ['center', 59.9338, 30.3330], ['center', 59.9313, 30.3608], ['center', 59.9277, 30.3480],
  ['center', 59.9164, 30.3185], ['center', 59.9073, 30.2997], ['center', 59.9267, 30.3175], ['center', 59.9290, 30.2880],
  ['center', 59.9256, 30.2960], ['center', 59.9220, 30.2800], ['center', 59.9463, 30.3950], ['center', 59.9445, 30.3600],
  ['center', 59.9450, 30.3730], ['center', 59.9244, 30.3859], ['center', 59.9207, 30.3549], ['center', 59.9449, 30.3360],
  ['petrograd', 59.9662, 30.3117], ['petrograd', 59.9561, 30.3189], ['petrograd', 59.9611, 30.2920], ['petrograd', 59.9518, 30.2906],
  ['petrograd', 59.9718, 30.2594], ['petrograd', 59.9730, 30.2210], ['petrograd', 59.9790, 30.2600], ['petrograd', 59.9790, 30.2940],
  ['petrograd', 59.9500, 30.3167], ['petrograd', 59.9700, 30.3200],
  ['vo', 59.9427, 30.2783], ['vo', 59.9440, 30.3060], ['vo', 59.9485, 30.2344], ['vo', 59.9325, 30.2611], ['vo', 59.9240, 30.2400],
  ['vo', 59.9520, 30.2160], ['vo', 59.9550, 30.2400],
  ['north', 59.9557, 30.3559], ['north', 59.9712, 30.3478], ['north', 59.9850, 30.3442], ['north', 59.9999, 30.3667],
  ['north', 60.0089, 30.3709], ['north', 60.0127, 30.3960], ['north', 60.0350, 30.4181], ['north', 60.0167, 30.3157],
  ['north', 60.0371, 30.3217], ['north', 60.0516, 30.3325], ['north', 60.0670, 30.3339], ['north', 59.9900, 30.4100],
  ['nw', 60.0027, 30.2967], ['nw', 59.9853, 30.3011], ['nw', 59.9892, 30.2551], ['nw', 59.9883, 30.2031], ['nw', 60.0084, 30.2588],
  ['nw', 59.9871, 30.1776], ['nw', 60.0000, 30.1300], ['nw', 59.9840, 30.2000],
  ['east', 59.9290, 30.4119], ['east', 59.9324, 30.4391], ['east', 59.9500, 30.4100], ['east', 59.9200, 30.4666], ['east', 59.9075, 30.4833],
  ['east', 59.8968, 30.4235], ['east', 59.8775, 30.4419], ['east', 59.8653, 30.4702], ['east', 59.8488, 30.4577], ['east', 59.8309, 30.5001],
  ['east', 59.9750, 30.4850],
  ['south', 59.8916, 30.3180], ['south', 59.8791, 30.3187], ['south', 59.8664, 30.3217], ['south', 59.8522, 30.3220], ['south', 59.8333, 30.3495],
  ['south', 59.8297, 30.3755], ['south', 59.8961, 30.3580], ['south', 59.8840, 30.3687], ['south', 59.8703, 30.3789], ['south', 59.8586, 30.3935],
  ['south', 59.8397, 30.4111], ['south', 59.7700, 30.3300],
  ['sw', 59.9011, 30.2749], ['sw', 59.8796, 30.2618], ['sw', 59.8673, 30.2615], ['sw', 59.8518, 30.2683], ['sw', 59.8419, 30.2518],
  ['sw', 59.8592, 30.2303], ['sw', 59.8350, 30.1500], ['sw', 59.7390, 30.0880], ['sw', 59.9000, 30.2200],
  ['out', 59.7230, 30.4100], ['out', 59.6850, 30.4400], ['out', 59.8820, 29.9080], ['out', 59.8540, 30.0350], ['out', 59.9110, 29.7720],
  ['out', 59.9950, 29.7660], ['out', 60.0960, 29.9640], ['out', 60.1960, 29.7010], ['out', 59.7500, 30.5900], ['out', 59.8200, 30.4328],
  ['out', 60.0504, 30.4424], ['out', 59.9050, 30.5150], ['out', 60.0200, 30.6500],
];
function okrByGeometrySpb(lat, lon) {
  let best = null;
  for (const [okr, la, lo] of SPB_ANCHORS) {
    const d = distM({ lat, lon }, { lat: la, lon: lo });
    if (!best || d < best.d) best = { d, okr };
  }
  return !best || best.d > 6000 ? 'out' : best.okr;                                // дальше 6 км от всех точек — пригороды
}
function okrByNameSpb(s) {
  const rx = new RegExp(NB + '([а-я-]+?(?:ий|ый|ой))\\s+район' + NA, 'g');
  let m;
  while ((m = rx.exec(s))) {
    const hit = SPB_RAYON.find(([pre]) => m[1].startsWith(pre));
    if (hit) return hit[1];
  }
  if (SPB_TOWNS.test(s)) return 'out';
  if (/ленинградская обл/.test(s)) return 'out';
  return '';
}

/* Код округа по названию района от геокодера («Центральный административный округ», «ЮЗАО»,
   «Московская область, городской округ Химки»; в Петербурге — «Петроградский район», «Пушкинский район»).
   Если названия нет — ближайшее место каталога того же города (places, необязательно, до 1,5 км), иначе — по координатам.
   city — 'msk' | 'spb'; если не задан — по точке (а без точки — по названию: «Санкт-Петербург, …» — Петербург) */
export function okrOf(lat, lon, district, places, city) {
  const s = String(district || '').toLowerCase().replace(/ё/g, 'е');
  const c = isCity(city) ? city : regionOf(lat, lon) || (/санкт-петербург|ленинградская обл/.test(s) ? 'spb' : 'msk');
  if (c === 'spb') {
    const byName = s ? okrByNameSpb(s) : '';
    if (byName) return byName;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
    const near = nearestOkr(lat, lon, places, CITIES.spb.okrs, 'spb');
    return near || okrByGeometrySpb(lat, lon);
  }
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
  return nearestOkr(lat, lon, places, CITIES.msk.okrs, 'msk') || okrByGeometry(lat, lon);
}

/* Район ближайшего места каталога (до 1,5 км) того же города: коды районов у городов частью совпадают
   (center, north…), поэтому места другого города и чужие коды не считаем */
function nearestOkr(lat, lon, places, okrs, city) {
  if (!places) return '';
  let best = null;
  for (const [id, p] of Object.entries(places)) {
    if (!p || !p.okr || !Number.isFinite(p.lat) || !okrs.includes(p.okr)) continue;
    const pc = isCity(p.city) ? p.city : /^spb-/.test(id) ? 'spb' : 'msk';
    if (pc !== city) continue;
    const d = distM({ lat, lon }, p);
    if (d < 1500 && (!best || d < best.d)) best = { d, okr: p.okr };
  }
  return best ? best.okr : '';
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

/* В адресе нет города — значит, город источника (Москва по умолчанию) */
const hasCityMsk = a => /москв|област|обл\.|химки|зеленоград|мытищ|красногорск|люберц|балаших|королев|королёв|одинцов|реутов|долгопрудн|котельник|видное|троицк|коммунарк|щербинк|апрелевк|лобн|сколково/i.test(a);
const hasCity = (a, city) => (city === 'spb' ? SPB_WORDS.test(String(a).toLowerCase().replace(/ё/g, 'е')) : hasCityMsk(a));
// Яндекс: рамка «долгота,широта~долгота,широта»; Nominatim: viewbox «запад,север,восток,юг»
const yaBbox = c => `${c.box[1]},${c.box[0]}~${c.box[3]},${c.box[2]}`;
const osmViewbox = c => `${c.box[1]},${c.box[2]},${c.box[3]},${c.box[0]}`;
const cityRx = c => new RegExp(`(^|,\\s*)${c.full}$`);
const cityPart = c => new RegExp(`(^|, )${c.full}(,|$)`);

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
async function viaYandex(addr, { yandexKey, fetchImpl, minIntervalMs, near, city }) {
  const C = CITIES[city];
  const q = hasCity(addr, city) ? addr : C.full + ', ' + addr;
  const url = `${YA}?apikey=${encodeURIComponent(yandexKey)}&geocode=${encodeURIComponent(q)}&format=json&lang=ru_RU&bbox=${yaBbox(C)}&rspn=1&results=5`;
  const j = await getJson(url, { fetchImpl, provider: 'yandex', minIntervalMs });
  const list = [];
  for (const { GeoObject: g } of yaMembers(j)) {
    if (!g || !g.Point) continue;
    const [lon, lat] = String(g.Point.pos).split(/\s+/).map(Number);
    if (!inRegion(city, lat, lon)) continue;
    const meta = (g.metaDataProperty || {}).GeocoderMetaData || {};
    // результат «просто Москва» («просто Санкт-Петербург») или область — это не адрес
    if (['country', 'province', 'area'].includes(meta.kind)) continue;
    if (meta.kind === 'locality' && cityRx(C).test(meta.text || '')) continue;
    const comps = ((meta.Address || {}).Components || []).filter(c => ['province', 'area', 'locality', 'district'].includes(c.kind))
      .map(c => c.name).filter(n => n && !/федеральный округ|^Россия$/.test(n));
    list.push({ lat: r6(lat), lon: r6(lon), display: meta.text || g.name || addr, district: [...new Set(comps)].join(', '), precision: meta.precision || meta.kind || '' });
  }
  const res = choose(list, near);
  // в ответе на дом нет округа (Москва) или района (Петербург) — спросим обратным геокодированием
  const noArea = res && (city === 'spb' ? !/район/i.test(res.district) : !/административн|округ/i.test(res.district));
  if (noArea && cityPart(C).test(res.district)) {
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

async function viaNominatim(addr, { fetchImpl, minIntervalMs, near, city }) {
  const C = CITIES[city];
  const withCity = x => (hasCity(x, city) ? x : x + ', ' + C.full);
  const variants = [...new Set([withCity(addr), withCity(simplifyAddr(addr))])];
  for (const q of variants) {
    const url = `${OSM}?format=jsonv2&addressdetails=1&countrycodes=ru&viewbox=${osmViewbox(C)}&bounded=1&limit=5&accept-language=ru&q=${encodeURIComponent(q)}`;
    const raw = await getJson(url, { fetchImpl, provider: 'nominatim', minIntervalMs });
    const list = [];
    for (const r of Array.isArray(raw) ? raw : []) {
      const lat = Number(r.lat), lon = Number(r.lon);
      if (!inRegion(city, lat, lon)) continue;
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
   city — 'msk' (по умолчанию) или 'spb': город, рамка поиска и проверка региона.
   cache — Map или обычный объект; ключ включает сервис, город (кроме Москвы — старые ключи кеша остаются в силе) и подсказку:
   «Садовая ул., 7» в Москве и в Петербурге — разные дома. */
export async function geocode(addr, { yandexKey, fetchImpl = globalThis.fetch, cache, minIntervalMs = 1100, near, log = console.warn, strict = false, city = 'msk' } = {}) {
  const q = String(addr || '').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  const cc = isCity(city) ? city : 'msk';
  const provider = yandexKey ? 'yandex' : 'osm';
  const hint = near && Number.isFinite(near.lat) && Number.isFinite(near.lon) ? `@${near.lat.toFixed(3)},${near.lon.toFixed(3)}` : '';
  const key = provider + ':' + (cc === 'msk' ? '' : cc + ':') + q.toLowerCase() + hint;
  const c = cacheApi(cache);
  if (c && c.has(key)) return c.get(key) || null;
  let res;
  try {
    res = yandexKey ? await viaYandex(q, { yandexKey, fetchImpl, minIntervalMs, near, city: cc })
      : await viaNominatim(q, { fetchImpl, minIntervalMs, near, city: cc });
  } catch (e) {
    if (log) log(`geocode «${q}»: ${e.message}`);
    if (strict) throw Object.assign(new Error(`геокодер недоступен (${e.message})`), { transient: true, status: e.status });
    return null;
  }
  if (c) c.set(key, res);
  return res;
}

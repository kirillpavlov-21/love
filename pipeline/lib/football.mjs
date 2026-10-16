/* Футбол «для пацанов»: матчи РПЛ, Кубка России и сборной на стадионах Москвы (с Подмосковьем) и Петербурга.
   Здесь только чистые функции: разбор викитекста, таблицы команд и стадионов, сведение расписания РПЛ из статей клубов,
   id, описания и формат assets/sport.js. Сеть, файлы и отчёт — в pipeline/football.mjs. Модель не нужна: всё по таблицам
   и шаблонам. */
import vm from 'node:vm';

export const UA = 'KudaIdemBot/1.0 (+https://kirillpavlov-21.github.io/love/)';

export const LEAGUES = { rpl: 'РПЛ', cup: 'Кубок России', nt: 'Сборная России' };

/* ---------- стадионы ----------
   Координаты — OpenStreetMap (контур стадиона), сверены с Википедией/Wikidata; metro — ближайшая станция
   из assets/geo.js (FIXED для Москвы, FIXED_SPB для Петербурга). at — «где» для описаний.
   aka — как стадион называют статьи Википедии (название статьи, прежние и английские имена). */
export const VENUES = {
  lukoil: {
    name: 'Лукойл Арена', at: 'на «Лукойл Арене»', city: 'msk', addr: 'Волоколамское ш., 69', metro: 'Спартак',
    lat: 55.817589, lon: 37.44061, aka: ['Lukoil Arena', 'Открытие Арена', 'Otkritie Arena', 'Стадион Спартак'],
  },
  veb: {
    name: 'ВЭБ Арена', at: 'на «ВЭБ Арене»', city: 'msk', addr: 'ул. 3-я Песчаная, 2а', metro: 'ЦСКА',
    lat: 55.791399, lon: 37.516654, aka: ['VEB Arena', 'Arena CSKA', 'ВЭБ Арена (стадион)'],
  },
  vtb: {
    name: 'ВТБ Арена', at: 'на «ВТБ Арене»', city: 'msk', addr: 'Ленинградский просп., 36', metro: 'Динамо',
    lat: 55.791293, lon: 37.558638, aka: ['VTB Arena', 'Центральный стадион Динамо', 'ВТБ Арена — Центральный стадион Динамо'],
  },
  rzd: {
    name: 'РЖД Арена', at: 'на «РЖД Арене»', city: 'msk', addr: 'ул. Большая Черкизовская, 125', metro: 'Черкизовская',
    lat: 55.803581, lon: 37.741216, aka: ['RZD Arena', 'Lokomotiv Stadium', 'Локомотив (стадион)'],
  },
  khimki: {
    name: 'Арена Химки', at: 'на «Арене Химки»', city: 'msk', addr: 'Химки, ул. Кирова, вл. 24', metro: 'Ховрино',
    lat: 55.885401, lon: 37.454182, aka: ['Arena Khimki', 'Khimki Arena'],
  },
  luzhniki: {
    name: 'Лужники', at: 'в «Лужниках»', city: 'msk', addr: 'ул. Лужники, 24, стр. 1', metro: 'Воробьёвы горы',
    lat: 55.715734, lon: 37.555376, aka: ['Luzhniki Stadium', 'Luzhniki', 'Лужники (стадион)', 'Большая спортивная арена Лужники'],
  },
  gazprom: {
    name: 'Газпром Арена', at: 'на «Газпром Арене»', city: 'spb', addr: 'Футбольная аллея, 1', metro: 'Зенит',
    lat: 59.972377, lon: 30.221061,
    aka: ['Saint Petersburg Stadium', 'St Petersburg Stadium', 'Gazprom Arena', 'Krestovsky Stadium', 'Крестовский (стадион)', 'Санкт-Петербург (стадион)'],
  },
  petrovsky: {
    name: 'Стадион «Петровский»', at: 'на «Петровском»', city: 'spb', addr: 'Петровский остров, 2', metro: 'Спортивная',
    lat: 59.95196, lon: 30.285003, aka: ['Petrovsky Stadium', 'Petrovsky', 'Петровский (стадион)', 'Петровский'],
  },
};

/* ---------- команды ----------
   key — латиница для id матча. track — за этими командами следим (клубы Москвы, Подмосковья и Петербурга в РПЛ
   и сборная). venue — домашний стадион, url — официальная продажа билетов клуба. q — как писать в описании.
   acc — винительный падеж, если он не совпадает с q («принимает „Балтику“»).
   wiki — названия статей о клубе в русской Википедии (первое — основное); town — город клуба, base — название
   без города, если оно отличается от name. По ним команда узнаётся и в ссылках, и в простом тексте:
   «Динамо (Москва)», «ЦСКА Москва», «ФК «Зенит» (Санкт-Петербург) в сезоне 2026/2027». */
export const TEAMS = {
  spartak: { name: 'Спартак', town: 'Москва', track: true, venue: 'lukoil', url: 'https://tickets.spartak.com/', wiki: ['Спартак (футбольный клуб, Москва)'] },
  cska: { name: 'ЦСКА', q: 'ЦСКА', town: 'Москва', track: true, venue: 'veb', url: 'https://tickets.pfc-cska.com/', wiki: ['ЦСКА (футбольный клуб, Москва)'] },
  dinamo: { name: 'Динамо', town: 'Москва', track: true, venue: 'vtb', url: 'https://tickets.fcdynamo.ru/', wiki: ['Динамо (футбольный клуб, Москва)'] },
  lokomotiv: { name: 'Локомотив', town: 'Москва', track: true, venue: 'rzd', url: 'https://tickets.fclm.ru/', wiki: ['Локомотив (футбольный клуб, Москва)'] },
  rodina: { name: 'Родина', acc: '«Родину»', town: 'Москва', track: true, venue: 'khimki', url: 'https://rodina.moscow/', wiki: ['Родина (футбольный клуб)', 'Родина (футбольный клуб, Москва)'] },
  zenit: { name: 'Зенит', town: 'Санкт-Петербург', track: true, venue: 'gazprom', url: 'https://tickets.fc-zenit.ru/', wiki: ['Зенит (футбольный клуб, Санкт-Петербург)'] },
  russia: { name: 'Россия', q: 'сборная России', track: true, national: true, url: 'https://www.rfs.ru/', wiki: ['Сборная России по футболу'] },
  krasnodar: { name: 'Краснодар', town: 'Краснодар', wiki: ['Краснодар (футбольный клуб)'] },
  rubin: { name: 'Рубин', town: 'Казань', wiki: ['Рубин (футбольный клуб)'] },
  akhmat: { name: 'Ахмат', town: 'Грозный', wiki: ['Ахмат (футбольный клуб)'] },
  rostov: { name: 'Ростов', town: 'Ростов-на-Дону', wiki: ['Ростов (футбольный клуб)'] },
  'krylya-sovetov': { name: 'Крылья Советов', town: 'Самара', wiki: ['Крылья Советов (футбольный клуб, Самара)', 'Крылья Советов (футбольный клуб)'] },
  baltika: { name: 'Балтика', acc: '«Балтику»', town: 'Калининград', wiki: ['Балтика (футбольный клуб)'] },
  akron: { name: 'Акрон', town: 'Тольятти', wiki: ['Акрон (футбольный клуб)'] },
  'dinamo-mkh': { name: 'Динамо Махачкала', base: 'Динамо', town: 'Махачкала', q: '«Динамо» Махачкала', acc: 'махачкалинское «Динамо»', wiki: ['Динамо (футбольный клуб, Махачкала)'] },
  fakel: { name: 'Факел', town: 'Воронеж', wiki: ['Факел (футбольный клуб, Воронеж)'] },
  orenburg: { name: 'Оренбург', town: 'Оренбург', wiki: ['Оренбург (футбольный клуб)'] },
  sochi: { name: 'Сочи', town: 'Сочи', wiki: ['Сочи (футбольный клуб)'] },
  'pari-nn': { name: 'Пари НН', base: 'Пари Нижний Новгород', town: 'Нижний Новгород', wiki: ['Пари Нижний Новгород (футбольный клуб)'] },
  khimki: { name: 'Химки', town: 'Химки', wiki: ['Химки (футбольный клуб)'] },
  torpedo: { name: 'Торпедо', town: 'Москва', wiki: ['Торпедо (футбольный клуб, Москва)'] },
};

/* Прежние id матчей из events.js (до появления sport.js): на них могут ссылаться приглашения */
export const LEGACY_IDS = {
  'ev-fb-spartak-rubin-20261018': ['ev-spartak-rubin-20261018'],
  'ev-fb-cska-spartak-20261025': ['ev-tsska-spartak-futbol-rpl-20261025'],
  'ev-fb-dinamo-akhmat-20261031': ['ev-dinamo-m-akhmat-futbol-rpl-20261031'],
  'ev-fb-lokomotiv-spartak-20261101': ['ev-lokomotiv-spartak-futbol-rpl-20261101'],
};

/* Ручные поправки расписания РПЛ: 'хозяева|гости' (ключи TEAMS) → день и время начала по Москве.
   Нужны, когда в статьях клубов о сезоне у матча нет точного дня и времени (у «Локомотива», «Родины» и «Зенита»
   таких статей нет или они давно не обновлялись) или статьи расходятся между собой. Википедия главнее, если она
   единодушна: расхождение с поправкой попадает в предупреждения отчёта. Поправка с прошедшей датой или датой
   за пределами окна запуска ничего не делает — её можно спокойно удалить.
   Сверено вручную 16.10.2026: день и время каждого матча совпали в двух независимых расписаниях. */
export const FIXES = {
  'lokomotiv|krasnodar': { date: '2026-10-17', time: '19:30' },
  'zenit|akhmat': { date: '2026-10-18', time: '14:00' },
  'rodina|orenburg': { date: '2026-10-19', time: '19:30' },
  'zenit|dinamo-mkh': { date: '2026-10-25', time: '18:30' },
  'rodina|krasnodar': { date: '2026-10-31', time: '19:45' },
  'lokomotiv|rubin': { date: '2026-11-06', time: '19:30' },
  'zenit|rostov': { date: '2026-11-08', time: '18:30' },
  'rodina|lokomotiv': { date: '2026-11-22', time: '19:00' },
  'lokomotiv|dinamo-mkh': { date: '2026-11-29', time: '19:45' },
  'zenit|baltika': { date: '2026-12-05', time: '17:30' },
  'spartak|dinamo': { date: '2026-12-06', time: '17:00' },
};

const MSK_CLUBS = new Set(['spartak', 'cska', 'dinamo', 'lokomotiv', 'rodina', 'torpedo']);
const MSK_BIG = new Set(['spartak', 'cska', 'dinamo', 'lokomotiv']);
const TOP = new Set(['zenit', 'krasnodar', 'spartak', 'cska', 'lokomotiv', 'dinamo']);

/* ---------- строки ---------- */

const TR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
/* Латиница для id: «Ленинградец» → leningradets, «Крылья Советов» → krylya-sovetov */
export function slug(s) {
  const t = String(s || '').toLowerCase().split('').map(c => (c in TR ? TR[c] : c)).join('')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return t.slice(0, 30).replace(/-+$/, '');
}

/* Ключ для сравнения названий: регистр, ё, кавычки, «(стадион)», тире и лишние пробелы не важны */
export const normKey = s => String(s || '').toLowerCase().replace(/ё/g, 'е')
  .replace(/[«»"'„“”`]/g, '').replace(/\((?:стадион|stadium)\)/g, ' ')
  .replace(/[–—-]/g, ' ').replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();

const VENUE_INDEX = new Map();
for (const [key, v] of Object.entries(VENUES)) [v.name, ...v.aka].forEach(n => VENUE_INDEX.set(normKey(n), key));

/* Как команду пишут в тексте: «Спартак», «Динамо (Москва)», «Динамо Москва». Одинаковые у двух команд формы
   («Динамо» — и Москва, и Махачкала) не узнаём: такую команду распознаёт только ссылка или своя статья клуба */
const TEAM_BY_WIKI = new Map(), TEAM_FORMS = new Map();
const baseOf = t => t.base || t.name;
const formsOf = t => (t.national ? [t.name] : [t.name, baseOf(t), ...(t.town ? [`${baseOf(t)} (${t.town})`, `${baseOf(t)} ${t.town}`] : [])]);
for (const [key, t] of Object.entries(TEAMS)) {
  (t.wiki || []).forEach(x => TEAM_BY_WIKI.set(normKey(x), key));
  for (const f of new Set(formsOf(t).map(normKey))) TEAM_FORMS.set(f, TEAM_FORMS.has(f) && TEAM_FORMS.get(f) !== key ? null : key);
}

/* Стадион по названию из источника → ключ VENUES или null */
export function venueKey(name) {
  const k = normKey(name);
  return k ? VENUE_INDEX.get(k) || null : null;
}

/* Название без пометок: «Ленинградец (Ленинградская область) (1Л)» → «Ленинградец (Ленинградская область)» */
const bareName = s => String(s || '').replace(/\s*\((?:\d?[А-ЯA-Z]{1,3}|ПФЛ|ФНЛ)\)\s*$/, '').replace(/\s+/g, ' ').trim();
/* Ключ команды по тексту; self — клуб, о котором статья (в своей статье его часто пишут без ссылки и без города) */
function textKey(text, self) {
  const k = normKey(bareName(text));
  if (!k) return null;
  if (self && TEAMS[self] && formsOf(TEAMS[self]).some(f => normKey(f) === k)) return self;
  return TEAM_FORMS.get(k) || null;
}
/* Ключ команды по статье Википедии: известная статья или «<название> (футбольный клуб, <город>)» */
function wikiKey(title) {
  const k = TEAM_BY_WIKI.get(normKey(title));
  if (k) return k;
  const m = /^(.+?)\s*\((?:футбольный клуб|ФК)(?:,\s*([^)]+))?\)$/i.exec(String(title || '').trim());
  return m ? TEAM_FORMS.get(normKey(m[2] ? `${m[1]} (${m[2]})` : m[1])) || null : null;
}

const teamObj = key => Object.assign({ key, q: `«${TEAMS[key].name}»`, track: false }, TEAMS[key]);
/* Команда по данным источника: статья (ссылка) или простой текст. Незнакомая — по названию (unknown: true),
   чтобы матч не потерялся молча. Ссылка на незнакомую статью по тексту не угадывается: [[Спартак (футбольный клуб,
   Кострома)|Спартак]] — это не московский «Спартак» */
export function teamOf({ wiki, text, self } = {}) {
  const key = wiki ? wikiKey(wiki) : text ? textKey(text, self) : null;
  if (key) return teamObj(key);
  const name = bareName(text || wiki).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return name ? { key: slug(name) || 'team', name, q: /[а-яё]/i.test(name) ? `«${name}»` : name, track: false, unknown: true } : null;
}
export const teamByKey = key => (TEAMS[key] ? teamObj(key) : null);

/* Клуб по названию статьи о сезоне: «ФК «Спартак» Москва в сезоне 2026/2027» → 'spartak', «ФК «Урал» …» → null */
export function seasonClubKey(title) {
  const m = /^ФК\s+(?:«([^»]+)»|(\S+))\s*(.*?)\s+в сезоне\s+\d{4}\/\d{4}$/.exec(String(title || '').trim());
  if (!m) return null;
  const base = m[1] || m[2], town = m[3].replace(/^\(\s*|\s*\)$/g, '').trim();
  return TEAM_FORMS.get(normKey(town ? `${base} (${town})` : base)) || null;
}

/* ---------- время ---------- */

export const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const moscowToday = (now = new Date()) => now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const dayNum = d => Math.round(Date.parse(d + 'T00:00:00Z') / 864e5);
/* Сезон по дате: с июля — новый (2026-10-16 → «2026/2027») */
export function seasonOf(day) {
  const y = +day.slice(0, 4), m = +day.slice(5, 7);
  return m >= 7 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}
export function seasonsBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 28)) if (!out.includes(seasonOf(d))) out.push(seasonOf(d));
  if (!out.includes(seasonOf(to))) out.push(seasonOf(to));
  return out;
}
export function yearsBetween(from, to) {
  const out = [];
  for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) out.push(String(y));
  return out;
}

/* ---------- Википедия: викитекст ---------- */

/* Первая вики-ссылка: [[Цель|Текст]] → { target, text } */
export function wikiLink(s) {
  const m = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/.exec(String(s || ''));
  return m ? { target: m[1].trim(), text: (m[2] != null ? m[2] : m[1]).trim() } : null;
}
/* Викитекст → простой текст: ссылки → их текст, шаблоны и сноски — прочь */
export function wikiPlain(s) {
  let t = String(s || '').replace(/<ref[^>]*\/>/g, '').replace(/<ref[\s\S]*?<\/ref>/g, '').replace(/<br\s*\/?>/gi, ' ');
  for (let i = 0; i < 5 && /\{\{[^{}]*\}\}/.test(t); i++) t = t.replace(/\{\{[^{}]*\}\}/g, '');
  return t.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/'{2,}/g, '').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/* Шаблоны {{Имя|…}} с учётом вложенных {{ }} и [[ ]]: [{ name, params, index }].
   Подчёркивания в имени — как пробелы ({{footballbox_collapsible}} = {{Footballbox collapsible}}) */
export function wikiTemplates(text, nameRe) {
  const out = [];
  const src = String(text || '');
  let i = 0;
  while ((i = src.indexOf('{{', i)) >= 0) {
    let depth = 0, j = i, end = -1;
    while (j < src.length) {
      if (src.startsWith('{{', j)) { depth++; j += 2; } else if (src.startsWith('}}', j)) { depth--; j += 2; if (!depth) { end = j; break; } } else j++;
    }
    if (end < 0) break;
    const body = src.slice(i + 2, end - 2);
    const parts = splitTop(body);
    const name = parts.shift().trim().replace(/_/g, ' ').replace(/\s+/g, ' ');
    if (nameRe.test(name)) {
      const params = {};
      for (const p of parts) {
        const k = p.indexOf('=');
        if (k > 0) params[p.slice(0, k).trim().toLowerCase()] = p.slice(k + 1).trim();
      }
      out.push({ name, params, index: i });
      i = end;
    } else i += 2;
  }
  return out;
}
/* Разбить тело шаблона по «|» верхнего уровня */
function splitTop(body) {
  const parts = [];
  let depthT = 0, depthL = 0, cur = '';
  for (let j = 0; j < body.length; j++) {
    const two = body.slice(j, j + 2);
    if (two === '{{') { depthT++; cur += two; j++; continue; }
    if (two === '}}') { depthT--; cur += two; j++; continue; }
    if (two === '[[') { depthL++; cur += two; j++; continue; }
    if (two === ']]') { depthL--; cur += two; j++; continue; }
    if (body[j] === '|' && !depthT && !depthL) { parts.push(cur); cur = ''; continue; }
    cur += body[j];
  }
  parts.push(cur);
  return parts;
}

/* Заголовки разделов над каждой позицией текста: index → ['Первая стадия', 'Путь РПЛ. Групповой этап', 'Группа A'] */
function headingsAt(text) {
  const marks = [];
  const re = /^(={2,5})\s*(.+?)\s*\1\s*$/gm;
  let m;
  while ((m = re.exec(text))) marks.push({ index: m.index, level: m[1].length, title: wikiPlain(m[2]) });
  return index => {
    const chain = [];
    for (const h of marks) {
      if (h.index > index) break;
      while (chain.length && chain[chain.length - 1].level >= h.level) chain.pop();
      chain.push(h);
    }
    return chain.map(h => h.title);
  };
}

const MONTHS = { января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6, июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12 };
const MON_RE = Object.keys(MONTHS).join('|');
const RX_RANGE = new RegExp(`(\\d{1,2})(?:\\s+(${MON_RE}))?\\s*[—–-]\\s*(\\d{1,2})\\s+(${MON_RE})\\s+(\\d{4})`, 'i');
const RX_DAY = new RegExp(`(\\d{1,2})\\s+(${MON_RE})\\s+(\\d{4})`, 'i');
const pad = n => String(n).padStart(2, '0');
const ymdOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
/* День или дни матча: «28 октября 2026», {{date|27|03|2026|3}}, 2026-10-28 → { from, to: тот же день };
   диапазон, пока лига не назначила день («3—5 ноября 2026», «26 февраля-1 марта 2027») → { from, to } */
export function wikiDays(s) {
  const t = String(s || '');
  let m = /\{\{\s*(?:date|дата)\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})\s*\|\s*(\d{4})/i.exec(t);
  if (m) { const d = ymdOf(m[3], m[2], m[1]); return { from: d, to: d }; }
  const plain = wikiPlain(t);
  m = RX_RANGE.exec(plain);
  if (m) {
    const m2 = MONTHS[m[4].toLowerCase()], m1 = m[2] ? MONTHS[m[2].toLowerCase()] : m2, y2 = +m[5];
    const from = ymdOf(m1 > m2 ? y2 - 1 : y2, m1, m[1]), to = ymdOf(y2, m2, m[3]);
    if (from <= to && dayNum(to) - dayNum(from) <= 10) return { from, to };
  }
  m = RX_DAY.exec(plain);
  if (m) { const d = ymdOf(m[3], MONTHS[m[2].toLowerCase()], m[1]); return { from: d, to: d }; }
  m = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  return m ? { from: `${m[1]}-${m[2]}-${m[3]}`, to: `${m[1]}-${m[2]}-${m[3]}` } : null;
}
export const wikiDate = s => { const d = wikiDays(s); return d ? d.from : null; };
/* «16:00 МСК (18:00 МСК+2)» → '16:00'; время без пометки берём как московское (наши стадионы — в МСК) */
export function wikiTime(s) {
  const t = wikiPlain(s);
  let m = /(\d{1,2})[:.](\d{2})\s*\(?(?:МСК|MSK)\)?(?!\s*[+−–-]\s*\d)/.exec(t);
  if (!m && !/(?:МСК|MSK)\s*[+−–-]\s*\d/.test(t)) m = /(\d{1,2})[:.](\d{2})/.exec(t);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${pad(m[1])}:${m[2]}`;
}

/* Команда из поля шаблона: «[[Спартак (футбольный клуб, Москва)|Спартак (Москва)]]» или просто «ЦСКА» */
function wikiTeam(s, self) {
  const l = wikiLink(s);
  return teamOf(l ? { wiki: l.target, text: l.text } : { text: wikiPlain(s), self });
}

const P = (params, ...keys) => { for (const k of keys) if (params[k] != null && params[k] !== '') return params[k]; return ''; };
/* Стадия кубка: «Группа A, 5-й тур», «1/8 финала, Путь РПЛ», «Финал» */
function cupStage(chain, round) {
  const last = chain[chain.length - 1] || '';
  const r = wikiPlain(round);
  const n = /(\d+)\s*(?:-?й)?\s*тур/i.exec(r);
  if (n) return /^Группа/i.test(last) ? `${last}, ${n[1]}-й тур` : `${n[1]}-й тур`;
  if (r) return r;
  const fin = chain.slice().reverse().find(h => /финал/i.test(h));
  if (fin) return fin !== last && /путь/i.test(last) ? `${fin}, ${last}` : fin;
  return last;
}
const roundNum = s => { const m = /(\d+)\s*(?:-?й)?\s*тур/i.exec(wikiPlain(s)); return m ? +m[1] : null; };

/* Матчи из статьи: сезон Кубка России ('cup'), «Матчи сборной России по футболу ГГГГ» ('nt') или статья клуба
   о сезоне ('rpl': раздел и номер тура проверяет rplSchedule). self — клуб статьи (для имён без ссылки).
   date/dateTo — день или диапазон дней, round — номер тура из поля «раунд», chain — заголовки разделов */
export function parseWikiMatches(text, league, { self } = {}) {
  const clean = String(text || '').replace(/<!--[\s\S]*?-->/g, '');
  const head = headingsAt(clean);
  const out = [];
  for (const t of wikiTemplates(clean, /^(footballbox( collapsible)?|отчёт о матче|футбольный матч)$/i)) {
    const p = t.params;
    const days = wikiDays(P(p, 'дата', 'date'));
    const home = wikiTeam(P(p, 'команда1', 'team1', 'хозяева'), self);
    const away = wikiTeam(P(p, 'команда2', 'team2', 'гости'), self);
    if (!days || !home || !away) continue;
    const range = days.to !== days.from;
    const time = range ? null : wikiTime(P(p, 'время', 'time'));
    const score = wikiPlain(P(p, 'счёт', 'счет', 'score'));
    const stadium = P(p, 'стадион', 'stadium');
    const link = wikiLink(stadium);
    const chain = head(t.index);
    const m = {
      src: 'wiki', league, date: days.from, time, tbc: !time,
      gone: /\d/.test(score) || /перенес|отмен/i.test(score), played: /\d+\s*[:–-]\s*\d+/.test(score),
      home, away,
      venue: link ? link.target : wikiPlain(stadium).replace(/^Стадион:\s*/i, ''),
      place: wikiPlain(P(p, 'место', 'location')) || (wikiLink(stadium.replace(/\[\[[^\]]*\]\]/, '')) || {}).text || '',
      stage: league === 'cup' ? cupStage(chain, P(p, 'раунд', 'round'))
        : league === 'nt' ? (chain[chain.length - 1] || 'Товарищеский матч').replace(/^Матчи$/, 'Товарищеский матч') : '',
      round: roundNum(P(p, 'раунд', 'round')), chain,
    };
    if (range) m.dateTo = days.to;
    out.push(m);
  }
  return out;
}

/* Шаблон «Результаты матчей чемпионата России …»: несыгранные пары → номер тура, сыгранные — отдельно.
   { tours: Map 'хозяева|гости' → n, played: Set 'хозяева|гости' } */
export function parseWikiResults(text) {
  const abbr = {};
  const tours = new Map(), played = new Set();
  const src = String(text || '');
  let m;
  const reName = /^\|\s*name_([^\s=]+)\s*=\s*(.+)$/gm;
  while ((m = reName.exec(src))) {
    const l = wikiLink(m[2]);
    const t = teamOf(l ? { wiki: l.target, text: l.text } : { text: wikiPlain(m[2]) });
    if (t) abbr[m[1]] = t.key;
  }
  const reMatch = /^\|\s*match_([^\s_=]+)_([^\s_=]+)\s*=\s*(.*)$/gm;
  while ((m = reMatch.exec(src))) {
    if (!abbr[m[1]] || !abbr[m[2]]) continue;
    const pair = `${abbr[m[1]]}|${abbr[m[2]]}`, v = wikiPlain(m[3]);
    const n = /^(\d+)\s*(?:-?й)?\s*тур/i.exec(v);
    if (n) tours.set(pair, +n[1]);
    else if (/\d+\s*[:–-]\s*\d+/.test(v)) played.add(pair);
  }
  return { tours, played };
}
export const parseWikiTours = text => parseWikiResults(text).tours;

/* ---------- расписание РПЛ из статей клубов о сезоне ---------- */

/* Раздел статьи клуба: чемпионат, кубок или прочее (товарищеские, Суперкубок, сборы) */
export function sectionKind(chain) {
  const s = (chain || []).join(' / ');
  if (/товарищ|предсезон|контрольн|суперкубок|сбор/i.test(s)) return 'other';
  if (/кубок/i.test(s)) return 'cup';
  return 'league';
}

/* Самые плотные span дней подряд: из дней тура (у диапазона — каждый его день) → { from, to } */
function densest(days, span = 4) {
  const d = days.slice().sort();
  let best = null;
  for (let i = 0; i < d.length; i++) {
    let j = i;
    while (j + 1 < d.length && dayNum(d[j + 1]) - dayNum(d[i]) < span) j++;
    if (!best || j - i > best.n) best = { n: j - i, from: d[i], to: d[j] };
  }
  return best && { from: best.from, to: best.to };
}
const uniq = list => [...new Set(list)].sort();

/* Матчи РПЛ для наших команд: пары и туры — из шаблона результатов (tours), дни и время — из статей клубов о сезоне.
   Точный матч в статье — это день и время; день без времени или диапазон — только примета, когда идёт тур.
   Окно тура — самая плотная четырёхдневка среди дней его матчей во всех статьях. Если статьи расходятся,
   решает поправка из fixes, затем большинство; ничья — матч без утверждённого дня (tbc) на все спорные дни.
   Матчи без точного дня — tbc на окно своего тура (если окно известно). Матч со счётом хотя бы в одной статье —
   сыгран (шаблон результатов иногда обновляют позже). → { matches, windows, played: Set пар, stat } */
export function rplSchedule({ articles = [], tours = new Map(), today = '', until = '9999-12-31', fixes = FIXES, warn = () => {} } = {}) {
  const boxes = [], played = new Set();
  for (const a of articles) {
    const self = seasonClubKey(a.title);
    if (!self) continue;
    for (const m of parseWikiMatches(a.text, 'rpl', { self })) {
      if (sectionKind(m.chain) !== 'league' || m.home.unknown || m.away.unknown) continue;
      const pair = `${m.home.key}|${m.away.key}`;
      const n = tours.get(pair);
      if (!n || (m.round && m.round !== n)) continue;            // сыгран, не пара РПЛ или матч другого турнира
      if (m.played) played.add(pair);
      if (m.gone) continue;                                         // сыгран, перенесён или отменён
      boxes.push(Object.assign(m, { pair, tour: n, from: a.title }));
    }
  }
  const tourDays = new Map();
  for (const b of boxes) {
    if (!b.round) continue;
    const list = tourDays.get(b.tour) || [];
    for (let d = b.date; d <= (b.dateTo || b.date); d = addDays(d, 1)) list.push(d);
    tourDays.set(b.tour, list);
  }
  const windows = new Map([...tourDays].map(([n, list]) => [n, densest(list)]));
  // матч без номера тура в статье считаем своим, только если он попадает в окно тура (±1 день)
  const near = (b, w) => w && dayNum(b.date) >= dayNum(w.from) - 1 && dayNum(b.dateTo || b.date) <= dayNum(w.to) + 1;
  const byPair = new Map();
  for (const b of boxes) if (b.round || near(b, windows.get(b.tour))) byPair.set(b.pair, (byPair.get(b.pair) || []).concat(b));

  const matches = [];
  let exactN = 0;
  for (const [pair, n] of [...tours].sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : 1))) {
    const [hk, ak] = pair.split('|');
    const home = teamByKey(hk), away = teamByKey(ak);
    if (!home || !away || (!home.track && !away.track) || played.has(pair)) continue;
    const list = byPair.get(pair) || [];
    const fx = fixes[pair];
    const fix = fx && fx.date >= today && fx.date <= until ? fx : null;
    const exact = list.filter(b => !b.dateTo && b.time);
    const dates = uniq(exact.map(b => b.date));
    const label = `${home.name} — ${away.name} (${n}-й тур)`;
    let date = null, time = null, range = null;
    if (dates.length === 1) {
      date = dates[0];
      if (fix && fix.date !== date) warn(`${label}: в статьях клубов ${fmt(date)}, а в поправке FIXES — ${fmt(fix.date)}. Беру Википедию; проверьте и уберите поправку`);
    } else if (dates.length > 1) {
      const count = d => exact.filter(b => b.date === d).length;
      const top = dates.slice().sort((x, y) => count(y) - count(x));
      if (fix && dates.includes(fix.date)) date = fix.date;
      else if (count(top[0]) > count(top[1])) date = top[0];
      else range = { from: dates[0], to: dates[dates.length - 1] };
      warn(`${label}: статьи клубов расходятся (${dates.map(fmt).join(' / ')}) — ${date ? 'беру ' + fmt(date) : 'день пока не ставлю'}`);
    } else if (fix) {
      date = fix.date;
      time = fix.time || null;
    }
    if (date && !time) {
      const times = uniq(exact.filter(b => b.date === date).map(b => b.time));
      time = times.length === 1 ? times[0] : fix && fix.date === date && fix.time ? fix.time : null;
      if (times.length > 1) warn(`${label}: разное время начала в статьях (${times.join(' / ')}) — ${time ? 'беру ' + time : 'время пока не ставлю'}`);
      else if (times.length === 1 && fix && fix.date === date && fix.time && fix.time !== time) warn(`${label}: в статьях клубов начало в ${time}, а в поправке FIXES — в ${fix.time}. Беру Википедию; проверьте и уберите поправку`);
    }
    if (!date && !range) {
      const own = list.find(b => b.dateTo);
      const w = windows.get(n);
      range = own ? { from: own.date, to: own.dateTo } : w;
    }
    if (!date && !range) continue;                                 // дни тура ещё неизвестны
    if ((date || range.to) < today || (date || range.from) > until) continue;
    if (date) exactN++;
    const vb = list.find(b => venueKey(b.venue));
    const m = {
      src: 'wiki', league: 'rpl', date: date || range.from, time: date ? time : null, tbc: !date || !time, gone: false,
      home, away, venue: vb ? vb.venue : '', place: vb ? vb.place : '', stage: `${n}-й тур`,
    };
    if (!date && range.to !== range.from) m.dateTo = range.to;
    matches.push(m);
  }
  return { matches, windows, played, stat: { boxes: boxes.length, exact: exactN } };
}
const fmt = d => { const [y, m, dd] = d.split('-'); return `${dd}.${m}.${y}`; };

/* ---------- описание ---------- */

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;   // перемешать хвост
  return h >>> 0;
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const DAY_FB = ['Воскресный футбол', 'Футбол в понедельник', 'Футбол во вторник', 'Футбол в среду', 'Футбол в четверг', 'Пятничный футбол', 'Субботний футбол'];
const DAY_IN = ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу'];

/* Какой это матч: national | derby-main | capitals | derby | top | cup | regular */
export function matchKind(home, away, league) {
  const h = home.key, a = away.key;
  if (home.national || away.national || league === 'nt') return 'national';
  if ((h === 'spartak' && a === 'cska') || (h === 'cska' && a === 'spartak')) return 'derby-main';
  if ((h === 'zenit' && MSK_BIG.has(a)) || (a === 'zenit' && MSK_BIG.has(h))) return 'capitals';
  if (MSK_CLUBS.has(h) && MSK_CLUBS.has(a)) return 'derby';
  if (league === 'cup') return 'cup';
  if (TOP.has(h) && TOP.has(a)) return 'top';
  return 'regular';
}
export const isBig = kind => ['national', 'derby-main', 'capitals', 'derby', 'top'].includes(kind);

/* Шаблоны: H, A — хозяева и гости как есть («Спартак», ЦСКА), Aacc — гости в винительном («принимает „Балтику“»).
   at — «на „Лукойл Арене“», day — «Субботний футбол», when — «в субботу вечером» */
const NOTES = {
  national: [
    x => `Сборная России играет дома, соперник — ${x.A}. Игра ${x.at}: редкий шанс увидеть национальную команду вживую — зови друзей.`,
  ],
  'derby-main': [
    x => `Главное московское дерби ${x.at}: ${x.H} — ${x.A}. Самые громкие трибуны сезона, билеты разбирают быстро.`,
    x => `${x.H} и ${x.A} — дерби, которое ждёт вся Москва. ${cap(x.at)} будет шумно с первой минуты, приходи пораньше.`,
  ],
  capitals: [
    x => `Матч двух столиц ${x.at}: ${x.H} — ${x.A}. Одно из самых принципиальных противостояний в стране, болеет весь стадион.`,
    x => `${x.H} — ${x.A}: принципиальная встреча Москвы и Петербурга. Такие игры смотрит вся страна, а вживую эмоций в разы больше.`,
  ],
  derby: [
    x => `Московское дерби ${x.at}: ${x.H} принимает ${x.Aacc}. На такие игры трибуны собираются полные — билеты лучше взять заранее.`,
    x => `Дерби двух московских клубов: ${x.H} — ${x.A}. Атмосфера особенная, так что собирай компанию и бери места рядом.`,
  ],
  top: [
    x => `Встреча сильных команд: ${x.H} — ${x.A} ${x.at}. Ждём острую игру — отличный повод выбраться на стадион компанией.`,
    x => `${x.H} принимает ${x.Aacc} — встреча двух сильных клубов. Народу будет много, к стадиону лучше подъехать пораньше.`,
  ],
  cup: [
    x => `Кубок России ${x.at}: ${x.H} принимает ${x.Aacc}. В кубке нет права на ошибку, поэтому игры обычно открытые и азартные.`,
    x => `Кубковый матч ${x.at}: ${x.H} — ${x.A}. Билеты на кубок обычно проще достать, чем на чемпионат, — удобно сходить компанией.`,
  ],
  regular: [
    x => `${x.day} ${x.at}: ${x.H} принимает ${x.Aacc}. Спокойный повод выбраться на стадион мужской компанией.`,
    x => `Матч РПЛ ${x.at}: ${x.H} — ${x.A}. Не дерби, поэтому с билетами обычно проще — удобно собраться компанией и поболеть.`,
    x => `${x.H} играет дома, в гостях ${x.A}. Зови друзей, бери шарф и приходи заранее — у стадиона до матча своя атмосфера.`,
    x => `${cap(x.when)} ${x.H} принимает ${x.Aacc} ${x.at}. После игры можно всей компанией обсудить матч в баре неподалёку.`,
  ],
};
/* Описание своими словами по шаблону (вариант выбирается по id — от запуска к запуску не меняется).
   range — день ещё не назначен (матч стоит на все дни тура): тогда без дня недели */
export function noteFor({ id, kind, home, away, venue, date, time, tbc, range }) {
  const list = NOTES[kind] || NOTES.regular;
  const wd = new Date(date + 'T12:00:00Z').getUTCDay();
  const nat = kind === 'national';                    // сборные — без кавычек: «соперник — Иран»
  const nm = t => (nat ? t.name : t.q || t.name);
  const x = {
    H: nm(home), A: nm(away), Aacc: nat ? away.name : away.acc || nm(away), at: venue.at,
    day: range ? 'Футбол' : DAY_FB[wd],
    when: range ? 'в эти дни' : DAY_IN[wd] + (tbc || !time ? '' : time < '17:00' ? ' днём' : ' вечером'),
  };
  const tail = range ? ' Точный день и время лига ещё не назначила.' : tbc ? ' Время начала ещё уточняется.' : '';
  // вариант по id; не влез в 180 знаков (длинные названия) — следующий вариант, в крайнем случае коротко
  const start = hash(id) % list.length;
  for (let i = 0; i < list.length; i++) {
    const note = list[(start + i) % list.length](x) + tail;
    if (note.length <= 180) return note;
  }
  return `${x.H} — ${x.A} ${x.at}.${tail}`;
}

/* ---------- события ---------- */

export const eventId = (home, away, date) => `ev-fb-${home.key}-${away.key}-${date.replace(/-/g, '')}`;
const cityLooksOurs = s => /moscow|москв|khimki|химк|petersburg|петербург|подмосков/i.test(String(s || ''));

/* Матч источника → событие для sport.js, или null (чужой город, прошёл, перенесён — тогда id попадает в gone).
   ctx: { today, until, prev: Map id → событие из прошлого файла, gone: Set, warn(text) } */
export function toEvent(m, ctx) {
  if (!m || !m.home || !m.away || !m.date) return null;
  const last = m.dateTo || m.date;
  if (last < ctx.today || m.date > ctx.until) return null;
  if (!m.home.track && !m.away.track) return null;
  let vk = venueKey(m.venue);
  if (!vk && !m.venue && m.home.venue && (!m.place || cityLooksOurs(m.place))) vk = m.home.venue;
  const id = eventId(m.home, m.away, m.date);
  if (!vk) {
    if (cityLooksOurs(m.place) || cityLooksOurs(m.venue)) ctx.warn(`${m.home.name} — ${m.away.name} ${m.date}: незнакомый стадион «${m.venue || '?'}» (${m.place || 'город не указан'}) — добавьте его в VENUES в pipeline/lib/football.mjs`);
    return null;
  }
  if (m.gone) { ctx.gone.add(id); return null; }
  [m.home, m.away].forEach(t => { if (t.unknown && m.league !== 'nt') ctx.warn(`незнакомая команда «${t.name}» (${m.date}) — добавьте её в TEAMS в pipeline/lib/football.mjs`); });
  const V = VENUES[vk];
  const prev = ctx.prev && ctx.prev.get(id);
  const tour = m.stage || (prev && prev.tour) || '';
  const kind = matchKind(m.home, m.away, m.league);
  const range = last !== m.date;
  const tbc = !!m.tbc || !m.time || range;
  const ev = {
    id, title: `${m.home.name} — ${m.away.name}`, cat: 'sport', sub: 'football', league: LEAGUES[m.league] || m.league,
  };
  if (tour) ev.tour = tour;
  Object.assign(ev, { teams: [m.home.name, m.away.name], emoji: '⚽', start: m.date, end: last });
  if (!tbc) ev.time = m.time; else ev.tbc = true;
  Object.assign(ev, {
    venue: V.name, addr: V.addr, metro: V.metro, lat: V.lat, lon: V.lon,
    url: m.home.url || m.away.url || 'https://premierliga.ru/',
    note: noteFor({ id, kind, home: m.home, away: m.away, venue: V, date: m.date, time: m.time, tbc, range }),
    fit: kind === 'national' ? ['guys', 'date', 'girls'] : isBig(kind) ? ['guys', 'date'] : ['guys'],
    city: V.city,
  });
  if (LEGACY_IDS[id]) ev.aka = uniq(LEGACY_IDS[id]);
  return ev;
}

/* Порядок в файле: день, время (неутверждённое — в конце дня), id */
export const sortEvents = list => list.slice().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)
  || (a.time || '99:99').localeCompare(b.time || '99:99') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/* Свежие матчи + те матчи прошлого файла, которых источник сейчас не дал, но которые ещё впереди.
   Не оставляем: прошедшие, перенесённые/отменённые/сыгранные (gone) и те, у кого та же пара в том же турнире
   пришла с другой датой. У такой пары новое событие помнит прежние id в aka (на них могут ссылаться приглашения) */
export function mergeEvents({ fresh, previous = [], gone = new Set(), today, until }) {
  const out = new Map();
  for (const e of fresh) if (!out.has(e.id)) out.set(e.id, Object.assign({}, e));
  const pair = e => `${e.league}|${(e.teams || []).join('|')}`;
  const freshByPair = new Map();
  for (const e of out.values()) freshByPair.set(pair(e), (freshByPair.get(pair(e)) || []).concat(e));
  const addAka = (e, ids) => {
    const list = uniq([...(e.aka || []), ...ids.filter(x => x && x !== e.id)]);
    if (list.length) e.aka = list;
  };
  const kept = [];
  for (const e of previous) {
    if (!e || !e.id || e.sub !== 'football') continue;
    if (out.has(e.id)) { addAka(out.get(e.id), e.aka || []); continue; }
    const same = (freshByPair.get(pair(e)) || []).filter(f => Math.abs(dayNum(f.start) - dayNum(e.start)) <= 120);
    if (same.length) { if (!gone.has(e.id)) addAka(same[0], [e.id, ...(e.aka || [])]); continue; }
    if (gone.has(e.id)) continue;
    if (!((e.end || e.start) >= today && e.start <= until)) continue;
    out.set(e.id, e);
    kept.push(e);
  }
  return { events: sortEvents([...out.values()]), kept };
}

/* ---------- assets/sport.js ---------- */

export const SPORT_HEADER = `/* Сгенерировано pipeline/football.mjs — не править руками: файл целиком пересобирается при каждом запуске.
   Футбольные матчи Москвы (с Подмосковьем) и Петербурга на ближайшие ~120 дней: РПЛ, Кубок России, домашние игры сборной.
   У каждого матча свой city ('msk' | 'spb'). Поля — как у событий в events.js, плюс:
     sub: 'football'; league — турнир; tour — тур или стадия; teams — [хозяева, гости];
     tbc: true — лига ещё не утвердила время начала (тогда time нет); если не назначен и день,
       start..end — все дни тура, и матч стоит на каждый из них;
     aka — прежние id этого матча (из events.js или до переноса даты): на них могут ссылаться старые приглашения. */`;

export const SPORT_MERGE = `(function (E, S) {
  const have = new Set(E.map(e => e.id));
  for (const e of S.events) if (e && e.id && !have.has(e.id)) { E.push(e); have.add(e.id); }
})(window.KUDA_EVENTS = window.KUDA_EVENTS || [], window.KUDA_SPORT);`;

export function renderSportJs({ updated = '', events = [] }) {
  const rows = events.map(e => '    ' + JSON.stringify(e)).join(',\n');
  return `${SPORT_HEADER}
window.KUDA_SPORT = {
  "updated": ${JSON.stringify(updated)},
  "events": [${rows ? '\n' + rows + '\n  ' : ''}]
};
${SPORT_MERGE}
`;
}

/* Прочитать assets/sport.js (свой же формат или заглушку): { updated, events } */
export function parseSportJs(text) {
  if (!String(text || '').trim()) return { updated: '', events: [] };
  const sandbox = { window: {} };
  vm.runInNewContext(String(text), sandbox, { timeout: 2000, filename: 'assets/sport.js' });
  const S = sandbox.window.KUDA_SPORT;
  if (!S || !Array.isArray(S.events)) throw new Error('assets/sport.js: нет window.KUDA_SPORT.events');
  return JSON.parse(JSON.stringify({ updated: S.updated || '', events: S.events }));
}

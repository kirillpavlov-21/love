#!/usr/bin/env node
/* SEO-страницы «Куда идём?»: статические подборки по городам — moskva/** (Москва) и spb/** (Петербург), sitemap.xml и robots.txt.

   Запуск (Node 22, без зависимостей), из любой папки:
     node scripts/build-seo.mjs                    пересобрать страницы, sitemap.xml и robots.txt
     node scripts/build-seo.mjs --dry              только посчитать: что появится, изменится и удалится
     node scripts/build-seo.mjs --date=2026-10-31  собрать так, будто сегодня другой день (проверить афишу)
     node scripts/build-seo.mjs --out=/tmp/seo     записать результат в другую папку (moskva/, spb/, sitemap.xml,
                                                   robots.txt) — посмотреть сборку, не трогая сайт

   Адрес сайта — константа SITE ниже (или переменная окружения SEO_SITE). От него зависят canonical, og:url,
   JSON-LD, sitemap.xml и robots.txt. Переехали на свой домен — поменяй SITE и перезапусти скрипт.

   Данные — те же файлы, что грузит сайт: assets/places.js, places-spb.js, events.js, events-spb.js, sport.js, auto.js
   и photos.js, плюс shared.js и geo.js ради общих правил (город, раздел места, подсказки, координаты станций).
   Город места, плана и события — как на сайте (DateKit.cityOf): поле city, иначе префикс id (spb-, ev-spb-), иначе
   координаты; план — город его точек (план с точками в двух городах пропускаем). Станции метро у городов свои
   (FIXED и FIXED_SPB в geo.js): названия совпадают — «Маяковская» есть и там, и там.
   Москва собирается всегда, Петербург — когда в каталоге есть его места. Ссылки в приложение у петербургских
   подборок несут ?city=spb. Места 18+ и закрытые на страницы не попадают.
   Тексты — шаблоны ниже, цифры в них считаются из данных. Подборка, где меньше 4 пунктов, не создаётся.

   Скрипт идемпотентный: свои файлы он перечисляет в <город>/.generated.json (с хешем и датой изменения для <lastmod>)
   и при следующем запуске удаляет страницы, которых больше нет (а если манифест потерян — свои страницы узнаёт
   по <meta name="generator">). Неизменённые файлы не переписываются. Руками в moskva/ и spb/ ничего не правь.

   Афиша и «Сегодня» зависят от дня сборки, поэтому пересобирать стоит после каждого обновления каталога или афиши
   (лучше — ежедневно). JS страницам не нужен; на страницах с событиями есть крошечный скрипт: если страницу
   открыли позже дня сборки, он прячет прошедшие события и показывает, когда подборку собрали. */

const SITE = 'https://kirillpavlov-21.github.io/love/';   // адрес сайта со слешем в конце; свой домен — 'https://домен.ru/'

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { calendar, checkIcs } from './ics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_ITEMS = 4;                                   // меньше — страницу не делаем
const CAP = { places: 40, plans: 24, events: 40 };      // сколько пунктов показываем в разделе, остальное — ссылкой в приложение
const ARGS = process.argv.slice(2);
const DRY = ARGS.includes('--dry');
const argOf = k => (ARGS.find(a => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const BASE = String(process.env.SEO_SITE || SITE).replace(/\/*$/, '/');
const TODAY = argOf('date') || mskToday();
/* куда пишем: корень сайта или папка из --out (данные и фото всё равно читаем из сайта) */
const OUT_ROOT = argOf('out') ? path.resolve(argOf('out')) : ROOT;

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }
const warns = [];
function warn(msg) { warns.push(msg); }
if (!/^https?:\/\/[^/?#]+(\/[^?#]*)?$/.test(BASE)) fail('SITE должен быть адресом вида https://домен/путь/');
if (!/^\d{4}-\d\d-\d\d$/.test(TODAY)) fail('--date должен быть в формате ГГГГ-ММ-ДД');
const BASE_PATH = new URL(BASE).pathname;

function mskToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
/* полдень этого дня по Москве (UTC+3, Петербург — в том же поясе), в миллисекундах */
function mskNoon(ymd) { return Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10), 9); }

/* ---------- файлы ---------- */
const abs = rel => path.join(ROOT, rel);
const exists = rel => { try { return fs.statSync(abs(rel)).isFile(); } catch (e) { return false; } };
const read = rel => fs.readFileSync(abs(rel), 'utf8');
const outAbs = rel => path.join(OUT_ROOT, rel);
const outExists = rel => { try { return fs.statSync(outAbs(rel)).isFile(); } catch (e) { return false; } };
const outRead = rel => fs.readFileSync(outAbs(rel), 'utf8');
const enc = encodeURIComponent;
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/* ---------- данные сайта: грузим скрипты в песочнице с минимальным window/document ---------- */
function loadData() {
  const noop = () => {};
  const el = () => ({
    style: {}, dataset: {}, children: [], classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop, getAttribute: () => null, appendChild: noop, append: noop, remove: noop, insertAdjacentHTML: noop,
    addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [],
  });
  const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
  const sb = {
    console: { log: noop, info: noop, warn: noop, error: noop, debug: noop },
    setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
    URL, URLSearchParams, TextEncoder, TextDecoder, Intl, atob, btoa,
    document: Object.assign(el(), { documentElement: el(), body: el(), head: el(), createElement: el, getElementById: () => null, readyState: 'complete', cookie: '' }),
    location: { href: BASE + 'start.html', origin: new URL(BASE).origin, pathname: BASE_PATH + 'start.html', search: '', hash: '' },
    navigator: { userAgent: 'build-seo', language: 'ru-RU' },
    localStorage: store(), sessionStorage: store(), addEventListener: noop, removeEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop }),
  };
  sb.window = sb; sb.self = sb;
  vm.createContext(sb);
  /* часы песочницы: shared.js считает «сегодня» и сезонные подсказки от Date.now() — подставляем день сборки (полдень по Москве) */
  sb.__clock = mskNoon(TODAY);
  vm.runInContext('(() => { const real = Date.now; Date.now = () => (typeof __clock === "number" ? __clock : real()); })();', sb);
  // порядок — как на страницах сайта: города и матчи только дописывают своё в KUDA и KUDA_EVENTS
  // collections.js (подборки редакции) может ещё не появиться — тогда молча без него
  const files = [['config.js'], ['assets/shared.js'], ['assets/places.js', true], ['assets/places-spb.js'], ['assets/events.js'], ['assets/events-spb.js'],
    ['assets/sport.js'], ['assets/auto.js'], ['assets/collections.js', false, true], ['assets/photos.js'], ['assets/geo.js']];
  for (const [f, required, quiet] of files) {
    if (!exists(f)) { if (required) fail(f + ' не найден'); if (!quiet) warn(f + ' не найден — собираю без него'); continue; }
    try { vm.runInContext(read(f), sb, { filename: f, timeout: 10000 }); } catch (e) {
      if (required) fail(f + ': ' + e.message);
      warn(`${f} не загрузился (${e.message}) — собираю без него`);
    }
  }
  if (!sb.KUDA || !sb.KUDA.places) fail('assets/places.js не создал window.KUDA.places');
  // дата данных: "updated" в auto.js (как раньше) и, если появится, updated в places-spb.js
  const stamp = (f, rx) => { try { return (rx.exec(read(f)) || [])[1] || ''; } catch (e) { return ''; } };
  return { W: sb, autoUpdated: stamp('assets/auto.js', /"updated"\s*:\s*"(\d{4}-\d\d-\d\d)"/), spbUpdated: stamp('assets/places-spb.js', /["']?updated["']?\s*:\s*["'](\d{4}-\d\d-\d\d)["']/) };
}
const { W: CTX, autoUpdated, spbUpdated } = loadData();
const D = CTX.KUDA;
const DK = CTX.DateKit || null;
const GEO = CTX.KudaGeo || null;
const CFG = CTX.DATE_CONFIG || {};
const BRAND = String((CFG.site && CFG.site.name) || 'Куда идём?');
if (!DK) warn('assets/shared.js не дал window.DateKit — разделы и подсказки считаю упрощённо');
/* Умеет ли главная афишу: start.html грузит assets/afisha.js, а hub.js её подключает (вкладка «Афиша», ?event=…).
   Пока нет — у событий ссылки ведут на сайт организатора, а кнопки «Вся афиша» не выводятся. */
const AFISHA_HUB = (() => {
  try { return /assets\/afisha\.js/.test(read('start.html')) && /KudaAfisha/.test(read('assets/hub.js')); } catch (e) { return false; }
})();
if (!AFISHA_HUB) warn('start.html пока без афиши (assets/afisha.js + KudaAfisha в hub.js) — у событий ссылки на сайт организатора, без «Вся афиша»; пересобери после подключения');
/* Умеет ли главная подборки (?col=): start.html грузит assets/cols.js, а hub.js его подключает */
const COL_HUB = (() => {
  try { return /assets\/cols\.js/.test(read('start.html')) && /KudaCols/.test(read('assets/hub.js')); } catch (e) { return false; }
})();
/* Умеет ли конструктор «Позвать по подборке» (create.html грузит cols.js, а create.js читает ?col=) */
const COL_CREATE = (() => {
  try { return /assets\/cols\.js/.test(read('create.html')) && /applyCollection/.test(read('assets/create.js')); } catch (e) { return false; }
})();
/* Расписание матчей ведётся (sport.js собран хотя бы раз): тогда страница «Футбол» живёт и в межсезонье */
const SPORT_FEED = /^\d{4}-\d\d-\d\d$/.test(String((CTX.KUDA_SPORT || {}).updated || ''));
/* Сезонные подсказки, которые живы в день сборки (как фильтры 🎃 🎄 🍂 на главной) */
const LIVE = new Set((() => {
  try { if (DK && DK.seasonHints) return DK.seasonHints(); } catch (e) { /* ниже */ }
  const m = +TODAY.slice(5, 7), d = +TODAY.slice(8, 10);
  return [(m === 10 || (m === 11 && d === 1)) && 'halloween', (m === 12 || (m === 1 && d <= 10)) && 'newyear', m >= 9 && m <= 11 && 'autumn'].filter(Boolean);
})());

/* ---------- мелочи ---------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const coll = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });
const sortKey = s => String(s || '').replace(/^[^A-Za-zА-Яа-яЁё0-9]+/, '');
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const plural = (n, [one, few, many]) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
const num = n => Number(n).toLocaleString('ru-RU').replace(/\s/g, '\u00a0');
const N = (n, forms) => num(n) + '\u00a0' + plural(n, forms);
const joinRu = a => (a = a.filter(Boolean), a.length <= 1 ? a[0] || '' : a.slice(0, -1).join(', ') + ' и ' + a[a.length - 1]);
const q = s => (/[«»"]/.test(s) ? s : `«${s}»`);
const names = (list, k = 3) => joinRu(list.slice(0, k).map(x => q(x.name || x.title)));
const uniqBy = (list, key = x => x.id) => { const seen = new Set(); return list.filter(x => !seen.has(key(x)) && seen.add(key(x))); };
const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
/* глагол в числе: «1 план начинается», «5 планов начинаются» */
const V = (n, one, many) => (plural(n, [one, many, many]));
const W_ = {
  plan: ['план', 'плана', 'планов'], readyPlan: ['готовый план', 'готовых плана', 'готовых планов'],
  place: ['место', 'места', 'мест'], event: ['событие', 'события', 'событий'], date: ['дата', 'даты', 'дат'],
  club: ['клуб', 'клуба', 'клубов'], pcClub: ['компьютерный клуб', 'компьютерных клуба', 'компьютерных клубов'],
  restaurant: ['ресторан', 'ресторана', 'ресторанов'], bar: ['бар', 'бара', 'баров'], coffee: ['кофейня', 'кофейни', 'кофеен'],
  theatre: ['театр', 'театра', 'театров'], quest: ['квест', 'квеста', 'квестов'], rink: ['каток', 'катка', 'катков'],
  concert: ['концерт', 'концерта', 'концертов'], show: ['спектакль', 'спектакля', 'спектаклей'], expo: ['выставка', 'выставки', 'выставок'],
  standup: ['вечер стендапа', 'вечера стендапа', 'вечеров стендапа'], okrug: ['округ', 'округа', 'округов'], minute: ['минута', 'минуты', 'минут'],
  match: ['матч', 'матча', 'матчей'], sportBar: ['спорт-бар или паб', 'спорт-бара или паба', 'спорт-баров и пабов'],
};

/* ---------- даты (строки ГГГГ-ММ-ДД, считаем в UTC — без часовых поясов) ---------- */
const MON_G = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MON_S = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const WD_S = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WD_ACC = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'];
const isYmd = s => typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s);
const ymdP = s => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
const ymdF = d => d.toISOString().slice(0, 10);
const addD = (s, n) => { const d = ymdP(s); d.setUTCDate(d.getUTCDate() + n); return ymdF(d); };
const dow = s => ymdP(s).getUTCDay();
const dm = s => `${+s.slice(8, 10)}\u00a0${MON_G[+s.slice(5, 7) - 1]}${s.slice(0, 4) !== TODAY.slice(0, 4) ? ' ' + s.slice(0, 4) : ''}`;
const dRange = (a, b) => (a === b ? dm(a) : a.slice(0, 7) === b.slice(0, 7) ? `${+a.slice(8, 10)}–${dm(b)}` : `${dm(a)} — ${dm(b)}`);
const YEAR = +TODAY.slice(0, 4);
/* ближайшие выходные: в будни — суббота и воскресенье впереди, в субботу — сегодня и завтра, в воскресенье — сегодня */
const WEEKEND = (() => { const w = dow(TODAY); if (w === 0) return [TODAY]; if (w === 6) return [TODAY, addD(TODAY, 1)]; return [addD(TODAY, 6 - w), addD(TODAY, 7 - w)]; })();
const RECENT = (() => { const d = ymdP(TODAY); d.setUTCMonth(d.getUTCMonth() - 2); return ymdF(d).slice(0, 7); })();
const isNew = x => isYmd(x.added) && x.added <= TODAY && x.added >= addD(TODAY, -30);

/* ---------- общие правила сайта (shared.js); если его нет — упрощённые копии ---------- */
const CAT_BY_KIND = [
  ['pc', /компьютерн|кибер/i], ['books', /книж/i], ['spa', /бан|спа|хамам|аквапарк|терм/i], ['coffee', /коф|пекар|кондитер|булоч|чайн/i],
  ['fun', /тир|боулинг|картинг|vr|квест|скалодром|падел|стендап|бильярд|караоке|аттракц|развлеч|теплоход|студи|мастер|арт-вечер|танц|стадион|петанк/i],
  ['culture', /музе|театр|кино|галере|планетар|концерт|дом культуры|культурн|центр|искусств|лекторий|архитектур/i],
  ['walk', /парк|сад|набереж|усадьб|заповедник|смотров|квартал|дизайн-завод|креатив/i], ['bar', /бар|паб|лаунж|винотек|крафт/i],
];
const catOf = p => { try { if (DK && DK.catOf) return DK.catOf(p); } catch (e) { /* ниже */ } return p.cat || p.c || (CAT_BY_KIND.find(([, rx]) => rx.test(p.kind || '')) || ['food'])[0]; };
/* Подсказки без привязки ко дню сборки: сезонные (🎃 🍂 🎄) shared.js отдаёт только в свой срок, а сезонным
   подборкам они нужны круглый год (страница «Осень» не должна пропадать из индекса в декабре).
   Поэтому спрашиваем shared.js «в октябре» и «в декабре» и объединяем. */
const SEASON_CLOCKS = [mskNoon(`${YEAR}-10-15`), mskNoon(`${YEAR}-12-15`)];
function allHints(fn, x) {
  const out = new Set();
  try {
    for (const t of [mskNoon(TODAY), ...SEASON_CLOCKS]) { CTX.__clock = t; (fn(x) || []).forEach(h => out.add(h)); }
  } finally { CTX.__clock = mskNoon(TODAY); }
  return [...out];
}
const placeHints = p => { try { if (DK && DK.placeHints) return allHints(DK.placeHints, p); } catch (e) { /* ниже */ } return [...(p.hint || []), ...(p.mich ? ['michelin'] : []), ...((p.price || 1) <= 1 ? ['budget'] : [])]; };
const planHints = s => {
  try { if (DK && DK.planHints) return allHints(DK.planHints, s); } catch (e) { /* ниже */ }
  const h = new Set([...(s.tags || []), ...(s.hint || [])]);
  return [...h].filter(x => s.mode === 'date' || x !== 'first');
};
/* план или место с полем season показываем только в свой сезон — как каталог на главной (по прямой ссылке оно открывается) */
const SEASON_OF = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
const inSeason = (x, season = SEASON_OF[+TODAY.slice(5, 7) - 1]) => !Array.isArray(x.season) || !x.season.length || x.season.includes(season);
const distM = (a, b) => {
  const R = 6371000, r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const walkMin = (a, b) => Math.max(1, Math.round(distM(a, b) * 1.3 / 75));
const isMetro = m => !!m && !/\((ж\/д|МЦД[^)]*)\)$/.test(m);
const metroText = m => (!m ? '' : /\(ж\/д\)$/.test(m) ? 'ж/д ' + m.replace(/\s*\(ж\/д\)$/, '') : isMetro(m) ? 'м.\u00a0' + m : m);
const MODES = ['date', 'guys', 'girls'];
const MODE_LABEL = Object.fromEntries(MODES.map(m => [m, (DK && DK.MODES && DK.MODES[m] && DK.MODES[m].label) || { date: 'Свидание', guys: 'Пацаны', girls: 'Подружки' }[m]]));
const WHEN = { утро: 'утром', день: 'днём', вечер: 'вечером', закат: 'на закате', ночь: 'ночью' };
const PRICE_HINT = { 1: 'до 1 500 ₽ на человека', 2: '1 500–3 000 ₽ на человека', 3: 'дороже 3 000 ₽ на человека' };
const EV_CAT = { concert: 'Концерт', theatre: 'Спектакль', exhibition: 'Выставка', standup: 'Стендап', festival: 'Фестиваль', sport: 'Спорт', show: 'Шоу', party: 'Вечеринка', lecture: 'Лекция', kids: 'Детям' };
const EV_FORMS = {
  concert: W_.concert, theatre: W_.show, exhibition: W_.expo, standup: W_.standup, festival: ['фестиваль', 'фестиваля', 'фестивалей'],
  sport: ['спортивное событие', 'спортивных события', 'спортивных событий'], show: ['шоу', 'шоу', 'шоу'], party: ['вечеринка', 'вечеринки', 'вечеринок'],
  lecture: ['лекция', 'лекции', 'лекций'], kids: ['событие для детей', 'события для детей', 'событий для детей'],
};
/* «18 выставок» или «36 событий, среди них 18 выставок, 7 спектаклей и 6 вечеров стендапа» */
function evMix(list) {
  const c = {};
  list.forEach(e => { c[e.cat] = (c[e.cat] || 0) + 1; });
  const top = Object.entries(c).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
  if (top.length === 1) return N(list.length, EV_FORMS[top[0][0]] || W_.event);
  return `${N(list.length, W_.event)}, среди них ${joinRu(top.slice(0, 3).map(([k, n]) => N(n, EV_FORMS[k] || W_.event)))}`;
}
/* правило продукта: никаких Telegram-каналов и Instagram-аккаунтов на сайте */
const BAD = /t\.me\/|telegram|телеграм|instagram|инстаграм/i;
const ADULT_RX = /стриптиз|бурлеск|эротик/i;
const cleanText = (s, where) => { s = String(s || '').trim(); if (BAD.test(s)) { warn(`${where}: текст с упоминанием мессенджера/соцсети убран со страницы`); return ''; } return s; };

/* фото: только со всеми полями подписи и с файлами на диске */
const PH_RX = /^assets\/ph\/(t\/)?[A-Za-z0-9._-]+\.(webp|jpe?g|png)$/;
function goodPhoto(ph) {
  if (!ph || !PH_RX.test(ph.t || '') || !PH_RX.test(ph.s || '') || !ph.a || !ph.l || !/^https:\/\//.test(ph.u || '')) return null;
  if (!exists(ph.t) || !exists(ph.s)) return null;
  return { t: ph.t, s: ph.s, a: String(ph.a), l: String(ph.l), u: String(ph.u) };
}

/* ---------- города: папка подборок, обороты текста, районы, адреса для schema.org ----------
   id — как DateKit.CITIES в shared.js ('msk' | 'spb'). out — папка подборок; адреса /moskva/ уже в индексе, их не меняем.
   q — значение ?city= для ссылок в приложение (у Москвы пусто: город по умолчанию, ссылки остаются прежними). */
const TOWN_RX = /^(Химки|Красногорск|Мытищи|Королёв|Балашиха|Люберцы|Одинцово|Реутов|Долгопрудный|Видное|Котельники|Лобня|Зеленоград)(,|\s|$)/;
/* Петербург: города внутри Санкт-Петербурга (адрес пригорода пишем как «Пушкин, Садовая ул., 7») и Ленобласть */
const SPB_TOWN_RX = /^(?:г\.\s*|пос\.\s*|п\.\s*)?(Новый Петергоф|Петергоф|Пушкин|Павловск|Стрельна|Ломоносов|Кронштадт|Сестрорецк|Зеленогорск|Репино|Комарово|Солнечное|Колпино|Красное Село|Шушары|Парголово|Песочный|Металлострой|Лисий Нос|Левашово|Понтонный)(,|\s|$)/;
const LO_TOWN_RX = /^(?:г\.\s*|пос\.\s*|п\.\s*|дер\.\s*|д\.\s*)?(Мурино|Кудрово|Новое Девяткино|Всеволожск|Гатчина|Выборг|Токсово|Сертолово|Шлиссельбург|Кировск|Отрадное|Тосно|Сосновый Бор|Янино|Бугры|Старая Ладога|Приозерск|Ропша|Коммунар|Петрокрепость)(,|\s|$)/;
const CITIES = {
  msk: {
    id: 'msk', out: 'moskva', q: '', name: 'Москва', full: 'Москва', in: 'в Москве', gen: 'Москвы', dat: 'по Москве', night: 'Ночная Москва', nightNote: '',
    okrW: W_.okrug, okrIn: ['округе', 'округах', 'округах'], okrDat: ['округу', 'округам', 'округам'], okrOne: 'округ', okrPl: 'округам', okrNom: 'округа', okrGroup: 'По округам',
    wideGen: 'Москвы и Подмосковья', inWide: 'в Москве и Подмосковье', pcWhere: 'во всех округах Москвы и ближнем Подмосковье',
    mich: { 2: 'Две звезды Michelin 2021', 1: 'Звезда Michelin 2021', bib: 'Bib Gourmand Michelin 2021', rec: 'В гиде Michelin 2021' }, michGuide: 'гида Michelin 2021',
    og: 'assets/og-hub.png',
    okr: {
      center: { slug: 'cao', name: 'Центр', short: 'ЦАО', loc: 'в центре Москвы' },
      north: { slug: 'sao', name: 'Север', short: 'САО', loc: 'на севере Москвы' },
      ne: { slug: 'svao', name: 'Северо-Восток', short: 'СВАО', loc: 'на северо-востоке Москвы' },
      east: { slug: 'vao', name: 'Восток', short: 'ВАО', loc: 'на востоке Москвы' },
      se: { slug: 'yuvao', name: 'Юго-Восток', short: 'ЮВАО', loc: 'на юго-востоке Москвы' },
      south: { slug: 'yuao', name: 'Юг', short: 'ЮАО', loc: 'на юге Москвы' },
      sw: { slug: 'yuzao', name: 'Юго-Запад', short: 'ЮЗАО', loc: 'на юго-западе Москвы' },
      west: { slug: 'zao', name: 'Запад', short: 'ЗАО', loc: 'на западе Москвы' },
      nw: { slug: 'szao', name: 'Северо-Запад', short: 'СЗАО', loc: 'на северо-западе Москвы' },
      zel: { slug: 'zelenograd', name: 'Зеленоград', loc: 'в Зеленограде' },
      new: { slug: 'novaya-moskva', name: 'Новая Москва', loc: 'в Новой Москве' },
      khimki: { slug: 'himki', name: 'Химки и Левобережный', loc: 'в Химках и Левобережном' },
      mo: { slug: 'podmoskove', name: 'Подмосковье', loc: 'в ближнем Подмосковье', pcOnly: true },
    },
    town: p => (TOWN_RX.exec(p.addr || '') || [])[1] || '',
    locality: p => (TOWN_RX.exec(p.addr || '') || [])[1] || (p.okr === 'khimki' ? 'Химки' : p.okr === 'zel' ? 'Зеленоград' : p.okr === 'mo' ? 'Московская область' : 'Москва'),
    region: p => (['khimki', 'mo'].includes(p.okr) ? 'Московская область' : 'Москва'),
  },
  spb: {
    id: 'spb', out: 'spb', q: 'spb', name: 'Петербург', full: 'Санкт-Петербург', in: 'в Петербурге', gen: 'Петербурга', dat: 'по Петербургу', night: 'Ночной Петербург',
    nightNote: ' Мосты через Неву с апреля по ноябрь разводят примерно с часу до пяти утра — если ехать на другой берег, выходи заранее.',
    okrW: ['район', 'района', 'районов'], okrIn: ['районе', 'районах', 'районах'], okrDat: ['району', 'районам', 'районам'], okrOne: 'район', okrPl: 'районам', okrNom: 'районы', okrGroup: 'По районам',
    wideGen: 'Петербурга и пригородов', inWide: 'в Петербурге и пригородах', pcWhere: 'в разных районах Петербурга',
    mich: { 2: 'Две звезды Michelin', 1: 'Звезда Michelin', bib: 'Bib Gourmand Michelin', rec: 'В гиде Michelin' }, michGuide: 'гида Michelin',
    // своя картинка превью, когда появится; общая og-hub.png — с подписью про Москву, поэтому без неё — нейтральная
    og: exists('assets/og-spb.png') ? 'assets/og-spb.png' : 'assets/og-invite.png',
    // коды — как в DateKit.CITIES.spb.okrs (их понимает ?okr= на главной); районы города — в скобках в текстах
    okr: {
      center: { slug: 'centr', name: 'Центр', loc: 'в центре Петербурга', areas: 'Центральный и Адмиралтейский районы' },
      petrograd: { slug: 'petrogradskaya-storona', name: 'Петроградская сторона', loc: 'на Петроградской стороне', areas: 'Петроградский район' },
      vo: { slug: 'vasilevskij-ostrov', name: 'Васильевский остров', loc: 'на Васильевском острове', areas: 'Василеостровский район' },
      north: { slug: 'sever', name: 'Север', loc: 'на севере Петербурга', areas: 'Выборгский и Калининский районы' },
      nw: { slug: 'primorskij-rajon', name: 'Приморский район', loc: 'в Приморском районе' },
      south: { slug: 'yug', name: 'Юг', loc: 'на юге Петербурга', areas: 'Московский и Фрунзенский районы' },
      sw: { slug: 'yugo-zapad', name: 'Юго-Запад', loc: 'на юго-западе Петербурга', areas: 'Кировский и Красносельский районы' },
      east: { slug: 'pravyj-bereg', name: 'Правый берег', loc: 'на Правом берегу Невы', areas: 'Невский и Красногвардейский районы' },
      out: { slug: 'prigorody', name: 'Пригороды', loc: 'в пригородах Петербурга', towns: true },
    },
    town: p => (SPB_TOWN_RX.exec(p.addr || '') || LO_TOWN_RX.exec(p.addr || '') || [])[1] || '',
    locality: p => (SPB_TOWN_RX.exec(p.addr || '') || LO_TOWN_RX.exec(p.addr || '') || [])[1] || 'Санкт-Петербург',
    region: p => (LO_TOWN_RX.test(p.addr || '') ? 'Ленинградская область' : 'Санкт-Петербург'),
  },
};
const CITY_IDS = Object.keys(CITIES);
const MAIN = CITIES.msk;   // в его манифесте — ещё и статические страницы сайта
/* Город места, плана или события — как на сайте (DateKit.cityOf); без shared.js — упрощённая копия */
const SPB_ID = /^(spb-|ev-spb-|p-spb-)/;
const CENTERS = { msk: [55.751, 37.618, 70], spb: [59.939167, 30.315833, 60] };
function cityOf(x) {
  try { if (DK && DK.cityOf) { const c = DK.cityOf(x); if (CITIES[c]) return c; } } catch (e) { /* ниже */ }
  if (!x) return 'msk';
  if (CITIES[x.city]) return x.city;
  if (typeof x.id === 'string' && SPB_ID.test(x.id)) return 'spb';
  if (typeof x.place === 'string' && SPB_ID.test(x.place)) return 'spb';
  if (Number.isFinite(x.lat) && Number.isFinite(x.lon)) {
    const near = CITY_IDS.find(c => distM(x, { lat: CENTERS[c][0], lon: CENTERS[c][1] }) <= CENTERS[c][2] * 1000);
    if (near) return near;
  }
  return 'msk';
}

/* ---------- места, планы, события (все города; по городам делим ниже) ---------- */
const ADULT = new Set(D.adult || []);
const PLACES_ALL = new Map();
for (const [id, p] of Object.entries(D.places)) {
  if (!p || p.adult || p.closed || ADULT.has(id) || !p.name || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
  if (BAD.test(p.name)) { warn(`место ${id}: название похоже на соцсеть — пропущено`); continue; }
  PLACES_ALL.set(id, Object.assign({}, p, { id, c: catOf(p), hints: placeHints(p), ph: goodPhoto(p.ph), note: cleanText(p.note, 'место ' + id), city: cityOf(Object.assign({ id }, p)) }));
}
/* план — в городе своих точек; план, где точки в разных городах, не показываем нигде */
const PLANS_G = uniqBy((D.scenarios || []).filter(s => s && s.id && s.title && !BAD.test(s.title) && MODES.includes(s.mode) && Array.isArray(s.stops) && s.stops.length && s.stops.every(id => PLACES_ALL.has(id))))
  .map(s => Object.assign({}, s, { st: s.stops.map(id => PLACES_ALL.get(id)), hints: planHints(s), why: cleanText(s.why, 'план ' + s.id) }))
  .filter(s => {
    const cs = new Set(s.st.map(p => p.city));
    if (cs.size > 1) { warn(`план ${s.id}: точки в разных городах — пропущен`); return false; }
    s.city = [...cs][0];
    return true;
  });
const usage = new Map();
PLANS_G.forEach(s => new Set(s.stops).forEach(id => usage.set(id, (usage.get(id) || 0) + 1)));

function eventDays(e) {
  const end = isYmd(e.end) && e.end >= e.start ? e.end : e.start;
  const from = e.start > TODAY ? e.start : TODAY;
  if (Array.isArray(e.dates) && e.dates.length) return [...new Set(e.dates.filter(d => isYmd(d) && d >= from && d <= end))].sort();
  const out = [];
  for (let d = from; d <= end && out.length < 400; d = addD(d, 1)) out.push(d);
  return out;
}
const EVENTS_ALL = uniqBy((Array.isArray(CTX.KUDA_EVENTS) ? CTX.KUDA_EVENTS : []).filter(e => e && e.id && e.title && isYmd(e.start)))
  .filter(e => !(e.place && (ADULT.has(e.place) || ((D.places[e.place] || {}).adult))) && !ADULT_RX.test(e.title + ' ' + (e.note || '')) && !BAD.test(e.title))
  .map(e => {
    const days = eventDays(e), place = e.place ? PLACES_ALL.get(e.place) || null : null;
    return Object.assign({}, e, { days, next: days[0], end: isYmd(e.end) && e.end >= e.start ? e.end : e.start, placeObj: place, ph: place ? place.ph : null,
      note: cleanText(e.note, 'событие ' + e.id), url: /^https:\/\//.test(e.url || '') && !BAD.test(e.url) ? e.url : '', fit: Array.isArray(e.fit) ? e.fit : [], city: cityOf(e) });
  })
  .filter(e => e.days.length);
/* идёт без перерыва (выставка): без списка дат и дольше одного дня */
const isRun = e => !(Array.isArray(e.dates) && e.dates.length) && e.end > e.start;
/* вход свободный: цена [0] или [0, 0] (а [0, 1500] — «бесплатно или до 1 500 ₽») */
const isFree = e => Array.isArray(e.price) && e.price[0] === 0 && !(e.price[1] > 0);
/* футбольный матч: из sport.js (ev-fb-…) или футбол из общей афиши */
const isFootball = e => e.cat === 'sport' && (/^ev-fb-/.test(e.id) || e.emoji === '⚽' || /футбол|РПЛ|Премьер-лиг|Кубок России|Кубка России/i.test(e.title + ' ' + (e.note || '')));

/* ---------- страницы мест (m/<id>/), подборки редакции (podborki/<slug>/) и календари (.ics): общие данные ---------- */
/* id места годится в адрес как есть (латиница, цифры, дефис) — иначе страницы у места нет */
const PAGE_ID = /^[a-z0-9][a-z0-9-]*$/;
/* закрытые места (не 18+): у них страница «Закрылось — вот похожие рядом» с noindex, в sitemap и списках их нет */
const CLOSED_ALL = Object.entries(D.places)
  .filter(([id, p]) => p && p.closed && !p.adult && !ADULT.has(id) && p.name && !BAD.test(p.name) && PAGE_ID.test(id) && Number.isFinite(p.lat) && Number.isFinite(p.lon))
  .map(([id, p]) => Object.assign({}, p, { id, c: catOf(p), city: cityOf(Object.assign({ id }, p)) }));
const PLAN_BY = new Map(PLANS_G.map(s => [s.id, s]));
const EV_BY = new Map(EVENTS_ALL.map(e => [e.id, e]));
/* Подборки редакции — assets/collections.js (window.KUDA.collections), если он есть. Город — поле city или префикс id
   (spb-c-… — Петербург, c-… — Москва). Пункт — место, план или событие нашего каталога того же города; закрытые места,
   планы с закрытыми точками и прошедшие события выпадают. Подборка живёт с from по until и в свой сезон, как на главной;
   живых пунктов меньше 4 — страницы нет. */
const COLS_ALL = (() => {
  const raw = Array.isArray(D.collections) ? D.collections : [];
  const out = [];
  const pick = id => {
    if (typeof id !== 'string') return null;
    const pid = /^p-/.test(id) && PLACES_ALL.has(id.slice(2)) ? id.slice(2) : id;
    if (PLACES_ALL.has(pid)) return { kind: 'places', x: PLACES_ALL.get(pid) };
    if (PLAN_BY.has(id)) return { kind: 'plans', x: PLAN_BY.get(id) };
    if (EV_BY.has(id)) return { kind: 'events', x: EV_BY.get(id) };
    return null;
  };
  for (const c of raw) {
    if (!c || typeof c.id !== 'string' || !c.title || BAD.test(c.title + ' ' + (c.lead || ''))) continue;
    const city = CITIES[c.city] ? c.city : /^spb-/.test(c.id) ? 'spb' : 'msk';
    if ((isYmd(c.until) && c.until < TODAY) || (isYmd(c.from) && c.from > TODAY) || !inSeason(c)) continue;
    const live = list => uniqBy((Array.isArray(list) ? list : []).map(id => {
      const it = pick(id);
      if (!it) { warn(`подборка ${c.id}: пункт ${id} не найден, закрыт или прошёл — пропущен`); return null; }
      if (it.x.city !== city) { warn(`подборка ${c.id}: пункт ${id} из другого города — пропущен`); return null; }
      return it;
    }).filter(Boolean), it => it.kind + ':' + it.x.id);
    const secs = c.kind === 'trip' && Array.isArray(c.sections) ? c.sections.filter(s => s && s.t).map(s => ({ t: String(s.t), items: live(s.items) })).filter(s => s.items.length) : [];
    const items = secs.length ? uniqBy(secs.flatMap(s => s.items), it => it.kind + ':' + it.x.id) : live(c.items);
    if (items.length < MIN_ITEMS) { warn(`подборка ${c.id}: живых пунктов ${items.length} (меньше ${MIN_ITEMS}) — страницу не делаю`); continue; }
    const modes = (Array.isArray(c.mode) ? c.mode : [c.mode]).filter(m => MODES.includes(m));
    const base = String(c.id).replace(/^spb-/, '').replace(/^c-/, '');
    out.push({ id: c.id, city, title: String(c.title), emoji: String(c.emoji || '✨'), lead: cleanText(c.lead, 'подборка ' + c.id), kind: c.kind || 'editorial',
      mode: modes[0] || 'date', until: isYmd(c.until) ? c.until : '', updated: isYmd(c.updated) ? c.updated : '', items, secs,
      slugBase: PAGE_ID.test(base) ? base : '' });
  }
  return out;
})();

/* ---------- порядок: сначала с фото, популярные (во многих планах), Michelin, недавно проверенные ---------- */
const pScore = p => (p.ph ? 4 : 0) + Math.min(usage.get(p.id) || 0, 4) + (p.mich ? 2 : 0) + (p.chk && p.chk >= RECENT ? 1 : 0) + (isNew(p) ? 1 : 0);
const sortPlaces = (list, bonus = () => 0) => list.slice().sort((a, b) => (pScore(b) + bonus(b)) - (pScore(a) + bonus(a)) || coll.compare(sortKey(a.name), sortKey(b.name)) || cmp(a.id, b.id));
const planPh = s => s.st.map(p => p.ph).find(Boolean) || null;
const maxPrice = s => Math.max(...s.st.map(p => p.price || 1));
const sScore = s => (planPh(s) ? 3 : 0) + (s.st.length >= 2 ? 2 : 0) + (isNew(s) ? 1 : 0);
const sortPlans = (list, bonus = () => 0) => list.slice().sort((a, b) => (sScore(b) + bonus(b)) - (sScore(a) + bonus(a)) || coll.compare(sortKey(a.title), sortKey(b.title)) || cmp(a.id, b.id));
const sortEvents = list => list.slice().sort((a, b) => cmp(a.next, b.next) || cmp(a.time || '99', b.time || '99') || coll.compare(a.title, b.title) || cmp(a.id, b.id));
const has = (x, h) => x.hints.includes(h);
const fits = (e, m) => !e.fit.length || e.fit.includes(m);
const onDays = (e, days) => e.days.some(d => days.includes(d));
const within = (e, a, b) => e.days.some(d => d >= a && d <= b);
const stopsOf = plans => uniqBy(plans.flatMap(s => s.st));

/* ---------- куда ведут кнопки «Все …»: главная (hub.js) понимает ?m=&f= для планов и ?m=&cat=&okr= для каталога.
   Какие значения f и cat она знает, читаем из самого hub.js (списки FILTERS и PCATS): неизвестный параметр главная
   молча игнорирует, и ссылка «Недорогие планы» открыла бы все. Число в кнопке пишем, только если по ссылке
   откроется ровно этот список, иначе — честное «больше …». ---------- */
const HUB_SRC = (() => { try { return read('assets/hub.js'); } catch (e) { return ''; } })();
function hubKeys(name, fallback) {
  const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(HUB_SRC);
  if (!m) return { keys: new Set(fallback), season: true };
  return { keys: new Set([...m[1].matchAll(/\[\s*'([a-z]+)'/g)].map(x => x[1])), season: /SEASON/.test(m[1]) };
}
const SEASON_H = ['halloween', 'newyear', 'autumn'];
const HUB_FK = hubKeys('FILTERS', ['pc', 'first', 'rain', 'day', 'eve', 'cheap', 'active', 'culture', 'view']);
const HUB_CK = hubKeys('PCATS', ['pc', 'first', 'walk', 'culture', 'food', 'michelin', 'coffee', 'bar', 'fun', 'spa', 'books']);
const HUB_B = /QS\.get\(\s*['"]b['"]\s*\)/.test(HUB_SRC);   // бюджет ?b=1 — «до 1 500 ₽»
const knows = (k, x) => !!x && (SEASON_H.includes(x) ? k.season && LIVE.has(x) : k.keys.has(x));
const tagged = (s, t) => (s.tags || []).includes(t);
/* фильтры, смысл которых тут повторён точно (☔ «Под крышей» главная считает по-своему — число не обещаем) */
const HUB_F = {
  halloween: s => has(s, 'halloween'), newyear: s => has(s, 'newyear'), autumn: s => has(s, 'autumn'),
  pc: s => tagged(s, 'pc'), first: s => has(s, 'first'), cheap: s => maxPrice(s) <= 1,
  day: s => ['утро', 'день'].includes(s.when), eve: s => ['закат', 'вечер', 'ночь'].includes(s.when),
  active: s => tagged(s, 'active'), culture: s => tagged(s, 'culture'), view: s => tagged(s, 'view'),
};
const validF = f => (knows(HUB_FK, f) ? f : '');
const HUB_CAT = {   // подписи разделов каталога, как на главной
  walk: 'Прогулки', culture: 'Культура', food: 'Рестораны', coffee: 'Кофе', bar: 'Бары', fun: 'Развлечения', spa: 'Бани и спа', books: 'Книжные', pc: 'Компы',
  first: 'Для первого свидания', michelin: 'Michelin', halloween: 'Хэллоуин', autumn: 'Осень', newyear: 'Новый год',
};
const validCat = c => (HUB_CAT[c] && knows(HUB_CK, c) ? c : '');
/* «недорогие планы»: ?f=cheap или ?b=1 — что из этого есть на главной */
const CHEAP_Q = knows(HUB_FK, 'cheap') ? { f: 'cheap' } : HUB_B ? { b: 1 } : null;
const HINT_CAT = ['first', 'halloween', 'autumn', 'newyear'];
const qs = pairs => { const s = pairs.filter(([, v]) => v).map(([k, v]) => `${k}=${enc(v)}`).join('&'); return s ? '?' + s : ''; };
const plansHref = (mode, f, b) => 'start.html' + qs([['m', mode], ['f', validF(f)], ['b', HUB_B && b ? b : '']]);
const placesHref = (mode, cat, okr, map) => 'start.html' + qs([['m', mode], ['cat', validCat(cat)], ['okr', okr], ['tab', map ? 'map' : '']]) + '#placesBlock';
/* «Вся афиша» — вкладка на главной; пока её нет, кнопки нет */
const afishaHref = mode => (AFISHA_HUB ? 'start.html' + qs([['m', mode], ['tab', 'events']]) : null);
const moreEvents = mode => (AFISHA_HUB ? { href: afishaHref(mode), text: 'Вся афиша — на главной' } : null);
const afishaCta = (mode, text = 'Вся афиша') => (AFISHA_HUB ? { href: afishaHref(mode), text } : { href: plansHref(mode), text: 'Все планы' });
/* События на странице «на дату»: у спектакля с многими показами оставляем дни из окна (Новый год — декабрьские),
   у выставки, которая идёт без перерыва, — как есть («до 22 ноября») */
const winBy = (list, ok) => list.map(e => {
  if (isRun(e)) return e;
  const days = e.days.filter(d => ok(d, e));
  return days.length ? Object.assign({}, e, { days, next: days[0] }) : null;
}).filter(Boolean);
/* Полка «в ближайшие две недели»: события с датами вперемешку с выставками (те — сначала закрывающиеся), иначе
   первыми всегда идут выставки, которые «идут сегодня» */
function mixEvents(list) {
  const dated = sortEvents(list.filter(e => !isRun(e)));
  const runs = list.filter(isRun).sort((a, b) => cmp(a.end, b.end) || coll.compare(a.title, b.title) || cmp(a.id, b.id));
  const out = [];
  while (dated.length || runs.length) { out.push(...dated.splice(0, 2)); if (runs.length) out.push(runs.shift()); }
  return out;
}
// «до 2:00», «до 6 утра», «до 2–4 ночи», «до утра», «круглосуточно» — но не «до 6 человек»
const LATE_RX = /до 0?[0-6]:\d\d|до [0-6]([–-][1-6])? (утра|ночи)|до утра|до последнего гостя|круглосуточно|24\/7/i;
const NATURE_RX = /парк|сад|лес|усадьб|заповед|заказник|дендр|роща|бор(\s|$)|пруд|набереж|пойм/i;
const RINK_KIND = /каток|ледов|ледян/i;
const isRink = p => p.c !== 'pc' && (RINK_KIND.test(p.kind + ' ' + p.name) || /(^|[^а-яё])каток([^а-яё]|$)/i.test(p.note || ''));
const isMuseum = p => /музе|галере|выставоч/i.test(p.kind);
const isTheatre = p => /театр|кабаре|цирк|спектакл/i.test(p.kind) && !/кино|ресторан при|бистро/i.test(p.kind);
const isBath = p => p.c === 'spa' || /бан[яи]|хамам|терм|спа(\s|$)/i.test(p.kind);
const isKaraoke = p => /караоке/i.test(p.kind + ' ' + p.name + ' ' + (p.note || ''));
const isQuest = p => /квест|escape/i.test(p.kind + ' ' + p.name);
const isView = p => has(p, 'view') && /панорам|смотров|на крыше|крыш[аеиу]|с видом|вид на|\d{2}[-–]?м?\s*этаж/i.test(p.kind + ' ' + p.name + ' ' + (p.note || ''));
const isPark = p => p.c === 'walk' && NATURE_RX.test(p.kind);
const is247 = p => (p.hint || []).includes('night');
/* где посмотреть матч: бар или ресторан с трансляциями (поле tv или так сказано в типе и описании) */
const isSportsBar = p => (p.c === 'bar' || p.c === 'food') && (p.tv === true || /спорт-?бар/i.test(p.kind + ' ' + p.name) || /трансляц|футбол|(^|[^а-яё])матч/i.test(p.note || ''));
const SUB = p => (p.c === 'culture' ? (isMuseum(p) ? 'museum' : isTheatre(p) ? 'theatre' : 'culture') : p.c);
const SUB_WORD = {
  food: ['ресторан или кафе', 'ресторана или кафе', 'ресторанов и кафе'], coffee: W_.coffee, bar: W_.bar,
  museum: ['музей', 'музея', 'музеев'], theatre: W_.theatre, culture: ['культурное место', 'культурных места', 'культурных мест'],
  walk: ['место для прогулки', 'места для прогулки', 'мест для прогулки'], fun: ['развлечение', 'развлечения', 'развлечений'],
  spa: ['баня или спа', 'бани или спа', 'бань и спа'], books: ['книжный', 'книжных', 'книжных'], pc: W_.pcClub,
};
function breakdown(list, k = 4) {
  const c = {};
  list.forEach(p => { const s = SUB(p); if (SUB_WORD[s]) c[s] = (c[s] || 0) + 1; });
  return joinRu(Object.entries(c).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).slice(0, k).map(([s, n]) => N(n, SUB_WORD[s])));
}

/* ---------- станции метро: у каждого города своя таблица в geo.js (FIXED — Москва, FIXED_SPB — Петербург) ---------- */
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const slugify = s => String(s).toLowerCase().replace(/[а-яё]/g, c => TR[c] ?? '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const GEO_SRC = (() => { try { return read('assets/geo.js'); } catch (e) { return ''; } })();
function fixedTable(name) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*;`).exec(GEO_SRC);
  if (!m) return null;
  try { return vm.runInNewContext('(' + m[1] + ')', {}, { timeout: 2000 }); } catch (e) { return null; }
}
const FIXED_BY = { msk: fixedTable('FIXED'), spb: fixedTable('FIXED_SPB') };
const med = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
/* Как KudaGeo.stations(), но для одного города: станции, у которых есть места этого города; координаты — из таблицы
   города, иначе медиана мест (точные координаты, ≥ 5 знаков, важнее примерных) */
function cityStations(cid) {
  let fixed = FIXED_BY[cid];
  if (!fixed) {
    if (cid === 'msk') {   // таблицы не нашли — как раньше, через сам geo.js
      try { return GEO && GEO.stations ? GEO.stations() : []; } catch (e) { warn('KudaGeo.stations() не сработал — координаты станций по медиане мест'); return []; }
    }
    warn(`assets/geo.js: нет таблицы станций для «${CITIES[cid].name}» — координаты станций по медиане мест`);
    fixed = {};
  }
  const by = {}, rough = {};
  const prec = x => (String(x).split('.')[1] || '').length;
  for (const [id, p] of Object.entries(D.places)) {
    if (!p || !p.metro || p.adult || p.closed || !isMetro(p.metro)) continue;   // МЦД и электрички — не метро; закрытые не считаем
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || cityOf(Object.assign({ id }, p)) !== cid) continue;
    const box = prec(p.lat) >= 5 ? by : rough;
    (box[p.metro] = box[p.metro] || []).push(p);
  }
  Object.keys(rough).forEach(m => { if (!by[m]) by[m] = rough[m]; });
  const own = o => Object.prototype.hasOwnProperty.call(fixed, o);
  return Object.entries(by).map(([name, ps]) => (own(name) ? { name, lat: +fixed[name][0], lon: +fixed[name][1] } : { name, lat: med(ps.map(p => p.lat)), lon: med(ps.map(p => p.lon)) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/* ---------- ссылки ----------
   В описаниях страниц ссылки пишем от корня сайта ('start.html?…'), а на подборки — '@slug';
   при выводе они превращаются в относительные (из moskva/<slug>/ — '../../start.html' и '../slug/'),
   а ссылки в приложение у петербургских подборок получают ?city=spb. */
const L = {
  place: (id, m) => `start.html?place=${enc(id)}&m=${m}`,
  plan: s => `start.html?plan=${enc(s.id)}&m=${s.mode}`,
  event: (e, m) => `start.html?event=${enc(e.id)}&m=${m}`,
  invPlace: (id, m) => `create.html?mode=${m}&plan=p-${enc(id)}`,
  invPlan: s => `create.html?mode=${s.mode}&plan=${enc(s.id)}`,
  invEvent: (e, m) => `create.html?event=${enc(e.id)}&mode=${m}`,
  go: id => `go.html#r=p-${enc(id)}`,   // маршрут до места в Яндекс Картах (go.html понимает p-<id места>)
};
const evMode = (e, m) => (e.fit.includes(m) || !e.fit.length ? m : MODES.find(x => e.fit.includes(x)) || m);
/* ?city= в ссылку на главную или конструктор (перед #якорем); у Москвы ссылки не меняются */
function addCity(t, cq) {
  if (!cq || !/^(start|create)\.html(?=$|[?#])/.test(t) || /[?&]city=/.test(t)) return t;
  const i = t.indexOf('#'), u = i < 0 ? t : t.slice(0, i), h = i < 0 ? '' : t.slice(i);
  return u + (u.includes('?') ? '&' : '?') + 'city=' + enc(cq) + h;
}

/* ---------- вывод HTML: общие куски ---------- */
const GROUPS = [
  ['occasion', 'По поводу'], ['season', 'По сезону'], ['category', 'Места по типу'], ['afisha', 'Афиша'],
  ['okr', 'По округам'], ['metro', 'У метро'], ['pc', 'Компьютерные клубы'],
];
const countText = pg => {
  const k = pg.sections.reduce((a, s) => (a[s.kind] = (a[s.kind] || 0) + s.all.length, a), {});
  if (pg.group === 'afisha') return k.events ? N(k.events, pg.evForms || W_.event) : '';
  if (pg.count === 'events' && k.events) return N(k.events, W_.event);
  if (pg.group === 'pc' || pg.slug === 'kompyuternye-kluby') return N(pg.countItems || (k.places || 0), W_.club);
  if (pg.group === 'metro' || pg.group === 'okr' || pg.group === 'category') return N(pg.sections.filter(s => s.kind === 'places').reduce((a, s) => a + s.all.length, 0), W_.place);
  if (k.plans) return N(k.plans, W_.plan);
  if (k.events) return N(k.events, W_.event);
  return N(k.places || 0, W_.place);
};
const priceHtml = n => { n = Math.max(1, Math.min(3, n || 1)); return `<span class="pr"><span aria-hidden="true">${'₽'.repeat(n)}</span><span class="vh">цена ${PRICE_HINT[n]}</span></span>`; };
/* у повторяющихся «Подробнее», «Позвать сюда» — название для экранных дикторов */
const forName = name => `<span class="vh">: ${esc(name)}</span>`;
const rub = n => num(n) + '\u00a0₽';
function evPrice(e) {
  if (!Array.isArray(e.price) || !Number.isFinite(e.price[0])) return '';
  const [a, b] = e.price;
  if (a === 0 && (!b || b === 0)) return 'бесплатно';
  if (a === 0) return `бесплатно или до ${rub(b)}`;
  if (!Number.isFinite(b) || b <= a) return `от ${rub(a)}`;
  return `${num(a)}–${rub(b)}`;
}
function evWhen(e) {
  const t = e.time ? `, ${e.time}` : '';
  if (isRun(e)) return (e.start > TODAY ? `с ${dm(e.start)} по ${dm(e.end)}` : `до ${dm(e.end)}`) + (e.time ? `, начало в ${e.time}` : '');
  const first = `${WD_S[dow(e.next)]}, ${dm(e.next)}${t}`;
  if (e.days.length === 1) return first;
  return `${first} и ещё ${N(e.days.length - 1, W_.date)} до ${dm(e.days[e.days.length - 1])}`;
}
function credit(ph) {
  if (!ph) return '';
  const src = ph.src === 'Flickr' ? ' · Flickr' : /wikimedia\.org/.test(ph.u) ? ' · Wikimedia Commons' : '';
  return `<p class="cr">Фото: <a href="${esc(ph.u)}" target="_blank" rel="noopener">${esc(ph.a)}</a>, ${esc(ph.l)}${src}</p>`;
}
const LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>';
const HOW = '<section class="sec how" aria-labelledby="s-how"><h2 id="s-how">Как позвать</h2><ol>' +
  '<li><span><b>Выбери план, место или событие</b> — в карточке адрес, цены и маршрут в Яндекс Картах.</span></li>' +
  '<li><span><b>Нажми «Позвать сюда»</b> — соберётся приглашение-игра для свидания или голосование для компании.</span></li>' +
  '<li><span><b>Отправь ссылку</b> в любой мессенджер: тебе ответят, а компания отметит, куда и когда может. Бесплатно и без регистрации.</span></li></ol></section>';
const GEN_MARK = 'scripts/build-seo.mjs';   // по этой метке скрипт узнаёт свои страницы, даже если манифест потерян
const ICS_PRODID = `-//kuda-idem//${GEN_MARK}//RU`;   // так же — свои календари .ics
const ldJson = o => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
/* день по Москве (UTC+3); в разделе, где что-то скрыли, число «8 из 40» уже неверно — прячем, пустой раздел — целиком */
const staleJs = () => `<script>(function(){var d=new Date(Date.now()+108e5).toISOString().slice(0,10);if(d<='${TODAY}')return;` +
  `var s=document.querySelectorAll('section.sec'),i,j;for(i=0;i<s.length;i++){var l=s[i].querySelectorAll('[data-end]'),v=0;if(!l.length)continue;` +
  `for(j=0;j<l.length;j++){if(l[j].getAttribute('data-end')<d)l[j].hidden=true;else v++;}` +
  `if(v<l.length){var n=s[i].querySelector('h2 .n');if(n)n.hidden=true;}if(!v)s[i].hidden=true;}` +
  `var e=document.getElementById('stale');if(e)e.hidden=false;})();</script>`;

/* ---------- schema.org ---------- */
const LOCAL_BIZ = new Set(['Restaurant', 'CafeOrCoffeeShop', 'Bakery', 'BarOrPub', 'InternetCafe', 'BookStore', 'DaySpa', 'EntertainmentBusiness', 'BowlingAlley', 'MovieTheater', 'LocalBusiness']);
function ldType(p) {
  const k = String(p.kind || '').toLowerCase();
  switch (p.c) {
    case 'pc': return 'InternetCafe';
    case 'coffee': return /пекар|булоч|кондитер/.test(k) ? 'Bakery' : 'CafeOrCoffeeShop';
    case 'bar': return 'BarOrPub';
    case 'food': return /пекар|булоч|кондитер/.test(k) ? 'Bakery' : /кафе|кофейн/.test(k) ? 'CafeOrCoffeeShop' : 'Restaurant';
    case 'books': return 'BookStore';
    case 'spa': return 'DaySpa';
    case 'fun': return /боулинг/.test(k) ? 'BowlingAlley' : 'EntertainmentBusiness';
    case 'culture': return /кино/.test(k) ? 'MovieTheater' : /музе|галере|выстав/.test(k) ? 'Museum' : /театр|кабаре|спектакл/.test(k) ? 'PerformingArtsTheater' : /концерт/.test(k) ? 'MusicVenue' : 'TouristAttraction';
    case 'walk': return NATURE_RX.test(k) ? 'Park' : 'TouristAttraction';
    default: return 'LocalBusiness';
  }
}
const ldGeo = p => ({ '@type': 'GeoCoordinates', latitude: +(+p.lat).toFixed(6), longitude: +(+p.lon).toFixed(6) });
const crumbsLd = (list, url) => ({ '@type': 'BreadcrumbList', '@id': url + '#breadcrumb', itemListElement: list.map((x, i) => ({ '@type': 'ListItem', position: i + 1, name: x[0], item: x[2] })) });

/* ---------- подборки одного города: считает страницы, а render() превращает их в файлы ---------- */
function buildCity(cid) {
  const C = CITIES[cid];
  const OKR = C.okr;
  const VP_ALL = [...PLACES_ALL.values()].filter(p => p.city === cid);
  // Москва собирается всегда (как раньше); другой город — когда в каталоге есть его места
  if (C !== MAIN && VP_ALL.length < MIN_ITEMS) return null;
  const VP = VP_ALL.filter(p => inSeason(p));
  /* PLANS_ALL — все планы, PLANS — те, что сейчас в сезоне (их и показывает главная); сезонные подборки берут из PLANS_ALL */
  const PLANS_ALL = PLANS_G.filter(s => s.city === cid);
  const PLANS = PLANS_ALL.filter(s => inSeason(s));
  const EVENTS = EVENTS_ALL.filter(e => e.city === cid);
  const DATA_DATE = C === MAIN
    ? [D.updated, autoUpdated].filter(x => /^\d{4}-\d\d-\d\d$/.test(x || '')).sort().pop() || TODAY
    : [spbUpdated, autoUpdated, ...VP_ALL.map(p => p.added), ...PLANS_ALL.map(s => s.added)].filter(x => isYmd(x) && x <= TODAY).sort().pop() || TODAY;
  const plansBy = m => PLANS.filter(s => s.mode === m);
  /* сколько планов покажет главная (в этом городе); null — не знаем (фильтр считается там по-своему) */
  function hubPlansCount(mode, f, b) {
    f = validF(f); b = HUB_B ? b || 0 : 0;
    if (f && !HUB_F[f]) return null;
    return PLANS.filter(s => s.mode === mode && (!f || HUB_F[f](s)) && (!b || maxPrice(s) <= b)).length;
  }
  function hubPlacesCount(mode, cat, okr) {
    cat = validCat(cat);
    const inCat = p => !cat || (cat === 'michelin' ? !!p.mich : HINT_CAT.includes(cat) ? has(p, cat) : p.c === cat);
    const pcHidden = !cat && mode !== 'guys';   // в «Все» компьютерные клубы видны только у пацанов
    return VP.filter(p => inCat(p) && !(pcHidden && p.c === 'pc') && (!okr || p.okr === okr)).length;
  }
  /* «Все 28 планов — на главной» или «Больше планов — на главной» (план разных режимов — ссылка без m, в режим гостя) */
  function morePlans(list, f, b) {
    const modes = [...new Set(list.map(s => s.mode))], mode = modes.length === 1 ? modes[0] : '';
    const href = plansHref(mode, f, b);
    if (mode && hubPlansCount(mode, f, b) === list.length) return { href, text: `Все ${N(list.length, W_.plan)} — на главной` };
    return { href, text: 'Больше планов — на главной' };
  }
  function morePlaces(list, mode, cat, okr, forms = W_.place) {
    const href = placesHref(mode, cat, okr);
    if (hubPlacesCount(mode, cat, okr) === list.length) return { href, text: `Все ${N(list.length, forms)} — в каталоге` };
    const c = validCat(cat);
    return { href, text: c ? `Раздел «${HUB_CAT[c]}» в каталоге` : 'Весь каталог мест' };
  }

  /* ---------- станции этого города ---------- */
  const STATIONS = new Map();
  (() => {
    cityStations(cid).forEach(s => { if (s && s.name && Number.isFinite(s.lat) && Number.isFinite(s.lon)) STATIONS.set(s.name, { name: s.name, lat: s.lat, lon: s.lon }); });
    const by = {};
    VP_ALL.forEach(p => { if (isMetro(p.metro)) (by[p.metro] = by[p.metro] || []).push(p); });
    Object.entries(by).forEach(([name, ps]) => {
      if (!STATIONS.has(name)) STATIONS.set(name, { name, lat: med(ps.map(p => p.lat)), lon: med(ps.map(p => p.lon)) });
      const okr = {};
      ps.forEach(p => { okr[p.okr] = (okr[p.okr] || 0) + 1; });
      STATIONS.get(name).okr = Object.entries(okr).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0][0];
      STATIONS.get(name).places = ps.filter(p => inSeason(p));   // показываем то, что сейчас в сезоне
      STATIONS.get(name).allCount = ps.length;
    });
  })();

  /* ---------- подборки ---------- */
  const PAGES = [];
  function sec(kind, h2, list, cap, more, note) {
    if (!list || !list.length) return null;
    return { kind, h2, all: list, items: list.slice(0, cap), more: list.length > cap && more ? more : null, note: note || '' };
  }
  /* блок «Подписаться в календаре» (A7): ics — путь к файлу от папки города, what — что в календаре (для дикторов) */
  const calSec = (ics, h2, note, what) => ({ kind: 'cal', h2, all: [], items: [], more: null, note, ics, what });
  function add(pg) {
    pg.sections = pg.sections.filter(Boolean);
    pg.total = uniqBy(pg.sections.flatMap(s => s.all.map(x => ({ id: s.kind + ':' + x.id })))).length;
    if (pg.total < (pg.min ?? MIN_ITEMS)) return;
    PAGES.push(pg);
  }
  const evStat = n => (n ? N(n, W_.event) : '');

  /* — по поводу — */
  (() => {
    const plans = sortPlans(plansBy('date'));
    const stops = sortPlaces(stopsOf(plans).filter(p => p.c !== 'pc'));
    const evs = mixEvents(EVENTS.filter(e => fits(e, 'date') && e.next <= addD(TODAY, 14)));
    const budget = plans.filter(s => maxPrice(s) <= 1).length, first = plans.filter(s => has(s, 'first')).length;
    add({
      slug: 'svidanie', group: 'occasion', label: 'Свидание', mode: 'date',
      title: `Куда сходить на свидание ${C.in}: ${N(plans.length, W_.readyPlan)}`,
      desc: `${N(plans.length, W_.plan)} для свидания ${C.in}: прогулка, музей или шоу и ужин рядом, маршрут пешком. Выбери план и позови игрой-приглашением.`,
      h1: `Куда сходить на свидание ${C.in}`, eyebrow: `Подборка · данные на ${dm(DATA_DATE)}`,
      lead: `Здесь ${N(plans.length, W_.plan)} для двоих: прогулка, музей или шоу, а рядом — где поужинать, обычно не дальше 20 минут пешком. ${cap1(N(budget, W_.plan))} ${V(budget, 'укладывается', 'укладываются')} примерно в 1 500 ₽ на человека, ${num(first)} мы отметили как удачные для первого свидания.${evs.length ? ` Ещё ${N(evs.length, W_.event)} на ближайшие две недели — концерты, спектакли и выставки, куда удобно сходить вдвоём.` : ''} Понравился план — нажми «Позвать сюда»: соберётся приглашение-игра, а ответ с днём и временем вернётся к тебе.`,
      stats: [N(plans.length, W_.plan), N(stops.length, W_.place), evStat(evs.length)],
      app: { href: 'start.html?m=date', text: 'Все планы для свидания' }, invite: { href: 'create.html?mode=date', text: 'Позвать игрой' },
      sections: [
        sec('plans', 'Готовые планы для свидания', plans, CAP.plans, morePlans(plans)),
        sec('places', 'Места, куда зовут на свидание', stops, 18, morePlaces(stops, 'date')),
        sec('events', 'Куда сходить вдвоём в ближайшие две недели', evs, 8, moreEvents('date')),
      ],
      related: ['pervoe-svidanie', 'nedorogoe-svidanie', 'vecherom-posle-raboty', 'krishi-i-panoramy', 'restorany', 'teatry', 'koncerty', 'osen'],
    });
  })();
  (() => {
    const plans = sortPlans(plansBy('date').filter(s => has(s, 'first')));
    const places = sortPlaces(VP.filter(p => (p.hint || []).includes('first') && p.c !== 'pc'));
    const cheap = places.filter(p => (p.price || 1) <= 1).length;
    add({
      slug: 'pervoe-svidanie', group: 'occasion', label: 'Первое свидание', mode: 'date',
      title: `Первое свидание ${C.in}: ${N(plans.length + places.length, ['идея', 'идеи', 'идей'])}, где можно поговорить`,
      desc: `Куда пойти на первое свидание ${C.in}: тихие кофейни и винные бары, прогулки и небольшие музеи, где есть о чём поговорить. Готовые планы с маршрутом.`,
      h1: `Первое свидание ${C.in}: где можно спокойно поговорить`, eyebrow: `Подборка · данные на ${dm(DATA_DATE)}`,
      lead: `На первой встрече важнее всего слышать друг друга и легко находить темы для разговора. Здесь ${N(plans.length, W_.plan)} и ${N(places.length, W_.place)}, которые мы отметили как подходящие для первого свидания: камерные кафе и винные бары, прогулки по набережным и паркам, небольшие музеи.${cheap ? ` ${cap1(N(cheap, W_.place))} из подборки — ${V(cheap, 'недорогое', 'недорогие')}, примерно до 1 500 ₽ на человека.` : ''} Если разговор пойдёт хорошо, в каждом плане рядом есть вторая точка.`,
      stats: [N(plans.length, W_.plan), N(places.length, W_.place)],
      app: { href: plansHref('date', 'first'), text: 'Планы для первого свидания' }, invite: { href: 'create.html?mode=date', text: 'Позвать игрой' },
      sections: [
        sec('plans', 'Планы для первого свидания', plans, CAP.plans, morePlans(plans, 'first')),
        sec('places', 'Места для первой встречи', places, 24, morePlaces(places, 'date', 'first')),
      ],
      related: ['svidanie', 'nedorogoe-svidanie', 'kofejni', 'parki', 'muzei', 'vystavki'],
    });
  })();
  (() => {
    const plans = sortPlans(plansBy('date').filter(s => maxPrice(s) <= 1));
    const places = sortPlaces(stopsOf(plansBy('date')).filter(p => (p.price || 1) <= 1 && p.c !== 'pc'));
    const free = mixEvents(EVENTS.filter(e => isFree(e) && fits(e, 'date') && e.next <= addD(TODAY, 14)));
    add({
      slug: 'nedorogoe-svidanie', group: 'occasion', label: 'Недорогое свидание', mode: 'date',
      title: `Недорогое свидание ${C.in}: ${N(plans.length, W_.plan)} до 1 500 ₽ на человека`,
      desc: 'Свидание без больших трат: парки, бесплатные смотровые и выставки, недорогие кафе. Готовые планы с маршрутом и ценами-ориентирами.',
      h1: `Недорогое свидание ${C.in}`, eyebrow: `Подборка · данные на ${dm(DATA_DATE)}`,
      lead: `${cap1(N(plans.length, W_.plan))}, где каждая остановка обходится примерно до 1 500 ₽ на человека, а часть и вовсе бесплатна: парки, набережные, смотровые площадки. Ниже — ещё ${N(places.length, W_.place)} для свидания с таким же чеком${free.length ? ` и ${N(free.length, W_.event)} с бесплатным входом в ближайшие две недели` : ''}. Цены — ориентир: меню и билеты лучше проверить перед выходом.`,
      stats: [N(plans.length, W_.plan), N(places.length, W_.place), free.length ? N(free.length, ['бесплатное событие', 'бесплатных события', 'бесплатных событий']) : ''],
      app: CHEAP_Q ? { href: plansHref('date', CHEAP_Q.f, CHEAP_Q.b), text: 'Недорогие планы' } : { href: plansHref('date'), text: 'Все планы для свидания' }, invite: { href: 'create.html?mode=date', text: 'Позвать игрой' },
      sections: [
        sec('plans', 'Планы до 1 500 ₽ на человека', plans, CAP.plans, CHEAP_Q ? morePlans(plans, CHEAP_Q.f, CHEAP_Q.b) : morePlans(plans, 'none')),
        sec('places', 'Недорогие места для свидания', places, 24, morePlaces(places, 'date')),
        sec('events', 'Бесплатные события', free, 10, moreEvents('date')),
      ],
      related: ['svidanie', 'pervoe-svidanie', 'parki', 'kofejni', 'vystavki', 'osen'],
    });
  })();
  (() => {
    const plans = sortPlans(plansBy('guys'));
    const places = sortPlaces(VP.filter(p => has(p, 'company') && p.c !== 'pc'));
    const evs = mixEvents(EVENTS.filter(e => fits(e, 'guys') && e.next <= addD(TODAY, 14)));
    add({
      slug: 's-druzyami', group: 'occasion', label: 'С друзьями', mode: 'guys',
      title: `Куда пойти с друзьями ${C.in}: ${N(plans.length, W_.plan)} для компании`,
      desc: `Бани, бары, караоке, боулинг, квесты и компьютерные клубы — готовые планы для компании ${C.in}. Кинь ссылку в чат, и все отметят, куда и когда могут.`,
      h1: `Куда пойти с друзьями ${C.in}`, eyebrow: `Подборка для компании · данные на ${dm(DATA_DATE)}`,
      lead: `${cap1(N(plans.length, W_.plan))} для компании: бани, бары и раковарни, боулинг, тиры, караоке и компьютерные клубы. Ниже — ещё ${N(places.length, W_.place)}, куда удобно идти большой компанией${evs.length ? `, и ${N(evs.length, W_.event)} на ближайшие две недели` : ''}. Отметь пару вариантов и кинь ссылку в общий чат: каждый выберет, куда и в какие дни может.`,
      stats: [N(plans.length, W_.plan), N(places.length, W_.place), evStat(evs.length)],
      app: { href: 'start.html?m=guys', text: 'Все планы для компании' }, invite: { href: 'create.html?mode=guys', text: 'Собрать компанию' },
      sections: [
        sec('plans', 'Планы для компании', plans, CAP.plans, morePlans(plans)),
        sec('places', 'Места для большой компании', places, 24, morePlaces(places, 'guys')),
        sec('events', 'Куда сходить компанией в ближайшие две недели', evs, 8, moreEvents('guys')),
      ],
      related: ['devichnik', 'bary', 'bani', 'karaoke', 'kvesty', 'kompyuternye-kluby', 'stendap', 'futbol', 'pozdno-vecherom'],
    });
  })();
  (() => {
    const plans = sortPlans(plansBy('girls'));
    const places = sortPlaces(stopsOf(plans).filter(p => p.c !== 'pc'));
    const evs = mixEvents(EVENTS.filter(e => fits(e, 'girls') && e.next <= addD(TODAY, 14)));
    add({
      slug: 'devichnik', group: 'occasion', label: 'Девичник', mode: 'girls',
      title: `Девичник ${C.in}: ${N(plans.length, ['идея', 'идеи', 'идей'])}, куда пойти с подругами`,
      desc: `Бранчи, спа и бани, мастер-классы, караоке и бары — готовые планы для девичника ${C.in}. Каждая отметит места и дни, которые ей подходят.`,
      h1: `Девичник ${C.in}: куда пойти с подругами`, eyebrow: `Подборка для девичника · данные на ${dm(DATA_DATE)}`,
      lead: `${cap1(N(plans.length, W_.plan))} для девичника и вечера с подругами: бранчи и кофейни, спа и бани, мастер-классы, караоке и бары. Ниже — самые популярные места из этих планов (всего их ${num(places.length)})${evs.length ? ` и ${N(evs.length, W_.event)} на ближайшие две недели` : ''}. Отметь пару вариантов и отправь ссылку подругам: каждая выберет, что ей нравится и когда удобно, — без двухсот сообщений в чате.`,
      stats: [N(plans.length, W_.plan), N(places.length, W_.place), evStat(evs.length)],
      app: { href: 'start.html?m=girls', text: 'Все планы для девичника' }, invite: { href: 'create.html?mode=girls', text: 'Собрать подруг' },
      sections: [
        sec('plans', 'Планы для девичника', plans, CAP.plans, morePlans(plans)),
        sec('places', 'Места из этих планов', places, 18, morePlaces(places, 'girls')),
        sec('events', 'Куда сходить с подругами в ближайшие две недели', evs, 8, moreEvents('girls')),
      ],
      related: ['s-druzyami', 'bani', 'karaoke', 'kofejni', 'spektakli', 'stendap'],
    });
  })();
  (() => {
    const today = sortEvents(winBy(EVENTS.filter(e => e.days.includes(TODAY)), d => d === TODAY));
    const wdays = WEEKEND.filter(d => d > TODAY);
    const weekend = sortEvents(winBy(EVENTS.filter(e => onDays(e, wdays) && !e.days.includes(TODAY)), d => wdays.includes(d)));
    const plans = sortPlans(PLANS.filter(s => ['вечер', 'закат', 'ночь'].includes(s.when)));
    const wlabel = wdays.length === 2 ? `На выходных, ${dRange(wdays[0], wdays[1])}` : wdays.length ? `Завтра, ${WD[dow(wdays[0])]}, ${dm(wdays[0])}` : '';
    add({
      slug: 'segodnya', group: 'occasion', label: 'Сегодня', mode: 'date', changefreq: 'daily', count: 'events',
      title: `Куда сходить сегодня ${C.in} — ${dm(TODAY)}`,
      desc: `Что идёт ${C.in} ${dm(TODAY)}: концерты, спектакли, стендап и выставки на сегодня и ближайшие выходные, плюс готовые планы на вечер.`,
      h1: `Куда сходить сегодня ${C.in}`, eyebrow: `Афиша на ${WD_ACC[dow(TODAY)]}, ${dm(TODAY)}`,
      lead: `${cap1(WD[dow(TODAY)])}, ${dm(TODAY)}. ${today.length ? `Сегодня в нашей афише ${evMix(today)}.` : 'На сегодня в нашей афише событий нет.'}${wlabel && weekend.length ? ` ${wdays.length === 2 ? `На выходных, ${dRange(wdays[0], wdays[1])},` : 'Завтра'} — ещё ${N(weekend.length, W_.event)}.` : ''} Если не хочется покупать билеты, у нас ${N(plans.length, W_.readyPlan)} на вечер: место, ужин рядом и маршрут.`,
      stats: [`сегодня: ${N(today.length, W_.event)}`, weekend.length ? `${wdays.length === 2 ? 'выходные' : 'завтра'}: ${N(weekend.length, W_.event)}` : '', N(plans.length, W_.plan)],
      app: afishaCta(''), invite: { href: 'create.html?mode=date', text: 'Позвать игрой' },
      sections: [
        sec('events', `Сегодня, ${dm(TODAY)}`, today, 30, moreEvents('')),
        wlabel ? sec('events', wlabel, weekend, 30, moreEvents('')) : null,
        sec('plans', 'Планы на вечер без билетов', plans, 12, morePlans(plans, 'eve')),
      ],
      related: ['vyhodnye', 'vecherom-posle-raboty', 'koncerty', 'spektakli', 'vystavki', 'stendap', 'futbol'],
    });
  })();
  (() => {
    const evs = sortEvents(winBy(EVENTS.filter(e => onDays(e, WEEKEND)), d => WEEKEND.includes(d)));
    const plans = sortPlans(PLANS.filter(s => ['утро', 'день', 'закат'].includes(s.when)));
    const range = dRange(WEEKEND[0], WEEKEND[WEEKEND.length - 1]);
    add({
      slug: 'vyhodnye', group: 'occasion', label: 'Выходные', mode: 'date', changefreq: 'daily', count: 'events',
      title: `Куда сходить в выходные ${C.in}: афиша на ${range}`,
      desc: `Афиша выходных ${range}: концерты, спектакли, стендап и выставки — и готовые дневные планы: прогулка, музей и обед рядом.`,
      h1: `Чем заняться в выходные ${C.in}`, eyebrow: `Выходные ${range}`,
      lead: `${evs.length ? `На выходных, ${range}, в нашей афише ${evMix(evs)}.` : `Афиша на ${range} пока пустая.`} А если хочется просто выбраться из дома, у нас ${N(plans.length, W_.plan)} на день: парк, усадьба или музей, а потом обед или кофе рядом.`,
      stats: [evStat(evs.length), N(plans.length, W_.plan)],
      app: { href: plansHref('', 'day'), text: 'Планы на день' }, invite: { href: 'create.html?mode=guys', text: 'Собрать компанию' },
      sections: [
        sec('events', `Афиша на ${range}`, evs, CAP.events, moreEvents('')),
        sec('plans', 'Планы на день', plans, CAP.plans, morePlans(plans, 'day')),
        calSec('weekend.ics', 'Выходные в календаре', 'Бесплатные события и наш выбор на выходные — на две недели вперёд. Подпишись один раз, и календарь будет обновляться сам.', `бесплатные события и выходные ${C.in}`),
      ],
      related: ['segodnya', 'parki', 'muzei', 'vystavki', 'koncerty', 'futbol', 'osen', 'zima'],
    });
  })();
  (() => {
    const plans = sortPlans(PLANS.filter(s => s.when === 'вечер' && s.st.length <= 2 && maxPrice(s) <= 2), s => (s.st[0].okr === 'center' ? 1 : 0));
    const center = plans.filter(s => s.st[0].okr === 'center').length;
    const weekday = d => d <= addD(TODAY, 7) && dow(d) >= 1 && dow(d) <= 5;
    const evs = sortEvents(winBy(EVENTS.filter(e => e.time && e.time >= '18:00' && e.days.some(weekday)), weekday));
    add({
      slug: 'vecherom-posle-raboty', group: 'occasion', label: 'После работы', mode: 'date',
      title: `Куда сходить вечером после работы ${C.in}: ${N(plans.length, ['короткий план', 'коротких плана', 'коротких планов'])}`,
      desc: `Короткие планы на будний вечер ${C.in}: одна-две точки рядом, без дорогого чека. Бары, ужин, стендап и кино рядом с центром.`,
      h1: 'Куда сходить вечером после работы', eyebrow: `Будний вечер · данные на ${dm(DATA_DATE)}`,
      lead: `В будний вечер не хочется ехать через весь город. Здесь ${N(plans.length, ['короткий план', 'коротких плана', 'коротких планов'])}: одна-две точки рядом друг с другом и чек примерно до 3 000 ₽ на человека, ${num(center)} из них — в центре.${evs.length ? ` Ниже — ${N(evs.length, ['вечернее событие', 'вечерних события', 'вечерних событий'])} в ближайшие будни.` : ''}`,
      stats: [N(plans.length, W_.plan), evStat(evs.length)],
      app: { href: plansHref('', 'eve'), text: 'Планы на вечер' }, invite: { href: 'create.html?mode=date', text: 'Позвать игрой' },
      sections: [
        sec('plans', 'Короткие планы на вечер', plans, CAP.plans, morePlans(plans, 'eve')),
        sec('events', 'Вечерние события в будни', evs, 12, moreEvents('')),
      ],
      related: ['segodnya', 'bary', 'restorany', 'stendap', 'pozdno-vecherom', 'svidanie'],
    });
  })();
  (() => {
    const plans = sortPlans(PLANS.filter(s => s.when === 'ночь'));
    const late = sortPlaces(VP.filter(p => p.c !== 'pc' && (LATE_RX.test(p.note || '') || is247(p))));
    const clubs = sortPlaces(VP.filter(p => p.c === 'pc' && is247(p)));
    const evs = sortEvents(EVENTS.filter(e => e.time && e.time >= '21:00' && e.next <= addD(TODAY, 14)));
    add({
      slug: 'pozdno-vecherom', group: 'occasion', label: 'Поздно вечером', mode: 'guys',
      title: `Куда пойти ночью ${C.in}: бары, караоке и круглосуточные клубы`,
      desc: `Ночные планы ${C.dat}, места, которые работают допоздна, и круглосуточные компьютерные клубы. Часы работы проверь перед выходом.`,
      h1: 'Куда пойти поздно вечером и ночью', eyebrow: `${C.night} · данные на ${dm(DATA_DATE)}`,
      lead: `Вечер затянулся, а расходиться рано? ${joinRu([plans.length ? N(plans.length, ['ночной план', 'ночных плана', 'ночных планов']) : '', late.length ? N(late.length, ['место с работой допоздна', 'места с работой допоздна', 'мест с работой допоздна']) : ''])
        .replace(/^./, c => 'Здесь ' + c)}${clubs.length ? `${plans.length || late.length ? ', а для геймеров — ' : 'Здесь '}${N(clubs.length, ['круглосуточный компьютерный клуб', 'круглосуточных компьютерных клуба', 'круглосуточных компьютерных клубов'])}` : ''}.${evs.length ? ` В афише — ${N(evs.length, W_.event)} с началом после 21:00.` : ''} Часы работы меняются по дням недели и сезонам — перед выходом проверь их в Яндекс Картах.${C.nightNote}`,
      stats: [N(plans.length, W_.plan), late.length ? N(late.length, W_.place) : '', N(clubs.length, W_.club)],
      app: { href: plansHref('', 'eve'), text: 'Планы на вечер' }, invite: { href: 'create.html?mode=guys', text: 'Собрать компанию' },
      sections: [
        sec('plans', 'Ночные планы', plans, CAP.plans, morePlans(plans, 'eve')),
        sec('places', 'Работают допоздна', late, CAP.places, null),
        sec('events', 'Начало после 21:00', evs, 12, moreEvents('')),
        sec('places', 'Круглосуточные компьютерные клубы', clubs, 12, { href: '@kompyuternye-kluby', text: `Все компьютерные клубы — по ${C.okrPl} и метро` }),
      ],
      related: ['vecherom-posle-raboty', 'bary', 'karaoke', 'kompyuternye-kluby', 's-druzyami', 'futbol'],
    });
  })();

  /* — сезоны — */
  (() => {
    const Y = TODAY > `${YEAR}-11-01` ? YEAR + 1 : YEAR;
    const day = `${Y}-10-31`;
    const plans = sortPlans(PLANS_ALL.filter(s => has(s, 'halloween') && inSeason(s, 'autumn')));
    const places = sortPlaces(VP.filter(p => (p.hint || []).includes('halloween')));
    const HW = /хэллоуин|хеллоуин|halloween|страш|ужас|мистик|готич|вампир|ведьм/i;
    // дни: 30 октября — 1 ноября, а у событий с Хэллоуином в названии — неделя вокруг
    const inMain = d => d >= `${Y}-10-30` && d <= `${Y}-11-01`, inWide = d => d >= `${Y}-10-24` && d <= `${Y}-11-02`;
    const okDay = (d, e) => (HW.test(e.title) ? inWide(d) : inMain(d));
    const hw = e => HW.test(e.title + ' ' + (e.note || ''));
    // тематические — первыми, остальное, что идёт в эти дни (кроме обычных выставок), — следом
    const themed = sortEvents(winBy(EVENTS.filter(e => hw(e) && e.days.some(d => okDay(d, e))), okDay));
    const rest = sortEvents(winBy(EVENTS.filter(e => !hw(e) && e.cat !== 'exhibition' && e.days.some(inMain)), inMain));
    const evs = [...themed, ...rest];
    const live = LIVE.has('halloween');
    add({
      slug: 'halloween', group: 'season', label: `Хэллоуин ${Y}`, mode: 'guys', changefreq: 'daily',
      title: `Хэллоуин ${Y} ${C.in}: куда сходить 31 октября`,
      desc: `Куда пойти на Хэллоуин ${Y} ${C.in}: вечеринки и шоу с 30 октября по 1 ноября, места с мрачной атмосферой и готовые планы с маршрутом.`,
      h1: `Хэллоуин ${Y} ${C.in}: куда сходить`, eyebrow: `31 октября, ${WD[dow(day)]}`,
      lead: `В ${Y} году Хэллоуин выпадает на ${WD_ACC[dow(day)]}. Мы собрали ${N(plans.length, W_.plan)} с подходящей атмосферой и ${N(places.length, W_.place)} — например, ${names(places)}.${evs.length ? ` В афише с 30 октября по 1 ноября — ${evMix(evs)}.${themed.length ? ' Тематические — в начале списка.' : ''}` : ''} Зови игрой на свидание или собери компанию голосованием.`,
      stats: [N(plans.length, W_.plan), N(places.length, W_.place), evStat(evs.length)],
      app: live ? { href: plansHref('', 'halloween'), text: 'Планы на Хэллоуин' } : { href: plansHref(''), text: 'Все планы' }, invite: { href: 'create.html?mode=guys', text: 'Собрать компанию' },
      sections: [
        sec('events', 'События 30 октября — 1 ноября', evs, CAP.events, moreEvents('')),
        sec('plans', 'Планы с атмосферой', plans, CAP.plans, morePlans(plans, 'halloween')),
        sec('places', 'Места для Хэллоуина', places, 24, morePlaces(places, '', 'halloween')),
      ],
      related: ['osen', 'segodnya', 'vyhodnye', 'muzei', 's-druzyami', 'pozdno-vecherom'],
    });
  })();
  const RINKS = sortPlaces(VP_ALL.filter(isRink));
  const BATHS = sortPlaces(VP.filter(isBath));
  (() => {
    const Y = +TODAY.slice(5, 7) === 1 && +TODAY.slice(8, 10) <= 14 ? YEAR : YEAR + 1;
    const a = `${Y - 1}-12-20`, b = `${Y}-01-14`;
    const NY = /нов(ый|ого|ым) год|новогод|рождеств|щелкунчик|ёлк|елк/i;
    const inNY = d => d >= a && d <= b;
    const evs = sortEvents(winBy(EVENTS.filter(e => within(e, a, b) && (e.cat !== 'exhibition' || e.start >= `${Y - 1}-12-01` || NY.test(e.title))), inNY));
    const warm = sortPlaces(uniqBy([...RINKS, ...VP.filter(p => p.c !== 'pc' && NY.test(p.name + ' ' + (p.note || '')))]));
    add({
      slug: 'novyj-god', group: 'season', label: `Новый год ${Y}`, mode: 'date', changefreq: 'daily',
      title: `Куда сходить на Новый год ${Y} ${C.in}: концерты, шоу и катки`,
      desc: `Новогодние концерты, ледовые шоу и вечеринки ${C.in} с 20 декабря по 14 января, а ещё катки и тёплые места на праздники.`,
      h1: `Куда сходить на Новый год ${Y} ${C.in}`, eyebrow: `20 декабря — 14 января`,
      lead: `${evs.length ? `С 20 декабря по 14 января в нашей афише ${evMix(evs)}.` : 'Новогодняя афиша пока собирается.'}${warm.length ? ` Ниже — ${N(warm.length, W_.place)} для праздничной прогулки, где зимой заливают каток или украшают всё к празднику.` : ''}${TODAY < `${Y - 1}-12-01` ? ' Афиша пополняется регулярно — загляни ближе к праздникам.' : ''}`,
      stats: [evStat(evs.length), warm.length ? N(warm.length, W_.place) : ''],
      app: afishaCta(''), invite: { href: 'create.html?mode=date', text: 'Позвать игрой' },
      sections: [
        sec('events', 'Новогодняя афиша', evs, CAP.events, moreEvents('')),
        sec('places', 'Катки и праздничные прогулки', warm, CAP.places, null),
      ],
      related: ['katki', 'zima', 'koncerty', 'spektakli', 'bani'],
    });
  })();
  (() => {
    // планы, где каток — сама точка маршрута или о нём прямо сказано (а не просто пруд, где зимой заливают лёд)
    const plans = sortPlans(PLANS_ALL.filter(s => inSeason(s, 'winter') && (s.st.some(p => RINK_KIND.test(p.kind + ' ' + p.name)) || /каток|катке|коньк|на льду/i.test(s.title + ' ' + (s.why || '')))));
    add({
      slug: 'katki', group: 'season', label: 'Катки', mode: 'date',
      title: `Катки ${C.in}: ${N(RINKS.length, W_.place)}, где зимой заливают лёд`,
      desc: `Где покататься на коньках ${C.in}: катки в парках и на прудах, а рядом — кафе, чтобы согреться. Готовые планы с маршрутом.`,
      h1: `Катки ${C.in}`, eyebrow: `Зимний сезон · данные на ${dm(DATA_DATE)}`,
      lead: `${cap1(N(RINKS.length, W_.place))}, где зимой работает каток: ${names(RINKS, 4)}. Большие катки в парках обычно открываются в конце ноября или в декабре — даты и цены лучше уточнить на сайте парка.${plans.length ? ` А ещё ${N(plans.length, W_.plan)}, где рядом с катком есть куда зайти погреться.` : ''}`,
      stats: [N(RINKS.length, W_.place), plans.length ? N(plans.length, W_.plan) : ''],
      app: { href: 'start.html', text: 'Все планы' }, invite: { href: 'create.html?mode=date', text: 'Позвать игрой' },
      sections: [
        sec('places', 'Где зимой каток', RINKS, CAP.places, null),
        sec('plans', 'Планы с катком', plans, CAP.plans, null),
      ],
      related: ['zima', 'novyj-god', 'parki', 'svidanie'],
    });
  })();
  (() => {
    const plans = sortPlans(PLANS_ALL.filter(s => has(s, 'autumn') && inSeason(s, 'autumn')));
    const places = sortPlaces(VP.filter(p => has(p, 'autumn')));
    add({
      slug: 'osen', group: 'season', label: 'Осень', mode: 'date',
      title: `Куда сходить осенью ${C.in}: ${N(plans.length, W_.plan)} для золотой осени`,
      desc: `Осенние прогулки ${C.dat}: парки, усадьбы и сады с жёлтыми аллеями, а после — горячий чай или ужин рядом. Готовые планы с маршрутом.`,
      h1: `Куда сходить осенью ${C.in}`, eyebrow: `Сезон · данные на ${dm(DATA_DATE)}`,
      lead: `${cap1(N(plans.length, W_.plan))} и ${N(places.length, W_.place)}, где особенно красиво в сентябре и октябре: парки и усадьбы, сады и набережные — например, ${names(places)}. После прогулки — кофейня, чайная или ужин в паре минут ходьбы.`,
      stats: [N(plans.length, W_.plan), N(places.length, W_.place)],
      app: LIVE.has('autumn') ? { href: plansHref('', 'autumn'), text: 'Осенние планы' } : { href: plansHref(''), text: 'Все планы' }, invite: { href: 'create.html?mode=date', text: 'Позвать игрой' },
      sections: [
        sec('plans', 'Осенние планы', plans, CAP.plans, morePlans(plans, 'autumn')),
        sec('places', 'Где красиво осенью', places, 24, morePlaces(places, '', 'autumn')),
      ],
      related: ['parki', 'halloween', 'svidanie', 'vyhodnye', 'zima'],
    });
  })();
  (() => {
    const plans = sortPlans(PLANS_ALL.filter(s => has(s, 'rain') && inSeason(s, 'winter')));
    const museums = VP.filter(isMuseum).length;
    add({
      slug: 'zima', group: 'season', label: 'Зима', mode: 'date',
      title: `Куда сходить зимой ${C.in}: катки, бани и тёплые места`,
      desc: `Зимние идеи для ${C.gen}: катки, бани и спа, музеи и планы под крышей, когда на улице холодно.`,
      h1: `Куда сходить зимой ${C.in}`, eyebrow: `Сезон · данные на ${dm(DATA_DATE)}`,
      lead: `Когда на улице холодно, выручают баня, музей или план целиком под крышей, а в ясный морозный день — каток. ${cap1(joinRu([plans.length ? N(plans.length, W_.plan) + ' без прогулок по улице' : '', BATHS.length ? N(BATHS.length, ['баня или спа', 'бани и спа', 'бань и спа']) : '', RINKS.length ? N(RINKS.length, W_.place) + ', где зимой заливают каток' : '']))}${museums ? `, а ещё ${N(museums, ['музей', 'музея', 'музеев'])} в каталоге` : ''}.`,
      stats: [N(plans.length, W_.plan), N(BATHS.length + RINKS.length, W_.place)],
      app: { href: plansHref('', 'rain'), text: 'Планы под крышей' }, invite: { href: 'create.html?mode=date', text: 'Позвать игрой' },
      sections: [
        sec('plans', 'Планы под крышей', plans, CAP.plans, morePlans(plans, 'rain')),
        sec('places', 'Бани и спа', BATHS, 12, { href: '@bani', text: `Все ${N(BATHS.length, W_.place)} — в подборке бань` }),
        sec('places', 'Где зимой каток', RINKS, 12, { href: '@katki', text: 'Все катки' }),
      ],
      related: ['katki', 'novyj-god', 'bani', 'muzei', 'teatry'],
    });
  })();

  /* — места по типу — */
  function catPage(o) {
    const list = sortPlaces(o.list);
    const plans = o.plans ? sortPlans(o.plans(new Set(list.map(p => p.id)))) : [];
    const p1 = list.filter(p => (p.price || 1) <= 1).length, p3 = list.filter(p => p.price === 3).length, center = list.filter(p => p.okr === 'center').length;
    const okrs = new Set(list.map(p => p.okr)).size;
    const ctx = { n: list.length, p1, p3, center, okrs, top: names(list), mich: list.filter(p => p.mich).length, list, plans };
    add({
      slug: o.slug, group: 'category', label: o.label, mode: o.mode || 'date',
      title: o.title(ctx), desc: o.desc(ctx), h1: o.h1, eyebrow: `Места по типу · данные на ${dm(DATA_DATE)}`, lead: o.lead(ctx),
      stats: [N(list.length, W_.place), plans.length ? N(plans.length, W_.plan) : '', okrs > 1 ? N(okrs, C.okrW) : '', ...(o.stats ? o.stats(ctx) : [])],
      app: o.app || { href: placesHref(o.mode || 'date', o.cat), text: 'Открыть в каталоге' }, invite: { href: `create.html?mode=${o.mode || 'date'}`, text: o.mode === 'guys' ? 'Собрать компанию' : 'Позвать игрой' },
      sections: [
        sec('places', o.h2, list, CAP.places, morePlaces(list, o.mode || 'date', o.cat)),
        plans.length ? sec('plans', o.plansH2 || 'Готовые планы с этими местами', plans, 12, null) : null,
        ...(o.extra ? o.extra(ctx) : []),
      ],
      related: o.related,
    });
  }
  const plansWith = ids => PLANS.filter(s => s.stops.some(id => ids.has(id)));
  const ALL_CATS = ['restorany', 'kofejni', 'bary', 'parki', 'muzei', 'teatry', 'kvesty', 'bani', 'karaoke', 'kompyuternye-kluby', 'krishi-i-panoramy'];
  const otherCats = slug => ALL_CATS.filter(s => s !== slug);
  catPage({
    slug: 'restorany', label: 'Рестораны', h1: `Рестораны ${C.gen}: где поужинать`, h2: 'Рестораны', cat: 'food',
    list: VP.filter(p => p.c === 'food'), plans: plansWith,
    title: c => `Рестораны ${C.gen}: ${N(c.n, W_.restaurant)} для свидания и компании`,
    desc: () => `Рестораны ${C.gen} для свидания и компании: от недорогих бистро до гида Michelin. Адрес, метро, цена и готовые планы с прогулкой рядом.`,
    lead: c => `В каталоге ${N(c.n, W_.restaurant)} и кафе: ${num(c.p1)} недорогих (примерно до 1 500 ₽ на человека) и ${num(c.p3)} — для особого случая${c.mich ? `, ${num(c.mich)} из ${C.michGuide}` : ''}. ${cap1(N(c.center, W_.place))} в центре, остальные — по ${N(c.okrs - 1, C.okrDat)} ${C.wideGen}. Для многих есть готовые планы: прогулка до ужина или бар после.`,
    related: ['svidanie', 'vecherom-posle-raboty', 'bary', 'kofejni', 'krishi-i-panoramy', 'kuda-shodit-' + OKR.center.slug],
  });
  catPage({
    slug: 'kofejni', label: 'Кофейни', h1: `Кофейни и пекарни ${C.gen}`, h2: 'Кофейни и пекарни', cat: 'coffee',
    list: VP.filter(p => p.c === 'coffee'), plans: plansWith,
    title: c => `Кофейни и пекарни ${C.gen}: ${N(c.n, W_.place)} для встречи и прогулки`,
    desc: () => `Кофейни и пекарни ${C.gen}: завтраки, кофе с собой для прогулки и тихие места, где можно поговорить. Адреса, метро и планы рядом.`,
    lead: c => `${cap1(N(c.n, ['кофейня или пекарня', 'кофейни и пекарни', 'кофеен и пекарен']))}: завтраки, кофе с собой для прогулки и места, где спокойно поговорить, — например, ${c.top}. ${cap1(N(c.p1, W_.place))} — ${V(c.p1, 'недорогое', 'недорогие')}, примерно до 1 500 ₽ на человека. Хороший старт для первого свидания или утра выходного дня.`,
    related: ['pervoe-svidanie', 'nedorogoe-svidanie', 'restorany', 'parki', 'devichnik'],
  });
  catPage({
    slug: 'bary', label: 'Бары', h1: `Бары ${C.gen}`, h2: 'Бары', cat: 'bar', mode: 'guys',
    list: VP.filter(p => p.c === 'bar'), plans: plansWith,
    title: c => `Бары ${C.gen}: ${N(c.n, W_.bar)} — винные, коктейльные и крафтовые`,
    desc: () => `Бары ${C.gen} для свидания и компании: винные, коктейльные, крафтовые и спорт-бары. Адрес, метро, цены и планы на вечер.`,
    lead: c => {
      const k = rx => c.list.filter(p => rx.test(p.kind)).length;
      const kinds = joinRu([k(/винн|вино/i) ? N(k(/винн|вино/i), ['винный', 'винных', 'винных']) : '', k(/коктейл/i) ? N(k(/коктейл/i), ['коктейльный', 'коктейльных', 'коктейльных']) : '', k(/крафт|пив|паб/i) ? N(k(/крафт|пив|паб/i), ['пивной или паб', 'пивных или паба', 'пивных и пабов']) : '']);
      return `${cap1(N(c.n, W_.bar))} в каталоге${kinds ? `, из них ${kinds}` : ''}. ${cap1(N(c.center, W_.place))} — в центре, где удобно продолжить вечер пешком. Многие стоят в планах второй точкой: сначала прогулка, ужин или стендап, потом бар.`;
    },
    related: ['s-druzyami', 'pozdno-vecherom', 'vecherom-posle-raboty', 'karaoke', 'futbol', 'restorany'],
  });
  catPage({
    slug: 'parki', label: 'Парки', h1: `Парки ${C.gen}: где погулять`, h2: 'Парки, сады и усадьбы', cat: 'walk',
    list: VP.filter(isPark), plans: plansWith,
    title: c => `Парки ${C.gen}: ${N(c.n, W_.place)} для прогулки`,
    desc: () => `Парки, сады и усадьбы ${C.gen} для прогулки вдвоём или компанией: адреса, метро и готовые планы с кафе рядом.`,
    lead: c => `${cap1(N(c.n, W_.place))} для прогулки — парки, сады, усадьбы и набережные в ${N(c.okrs, C.okrIn)}, например ${c.top}. ${(a => (a ? `Осенью особенно ${a === c.n ? 'хороши все' : a >= c.n * 0.8 ? 'хороши почти все' : `${V(a, 'хорошо', 'хороши')} ${N(a, W_.place)}`}.` : ''))(c.list.filter(p => has(p, 'autumn')).length)} Рядом с большинством есть где перекусить — смотри готовые планы ниже.`,
    related: ['osen', 'nedorogoe-svidanie', 'vyhodnye', 'katki', 'krishi-i-panoramy'],
  });
  catPage({
    slug: 'muzei', label: 'Музеи', h1: `Музеи ${C.gen}: куда сходить`, h2: 'Музеи и галереи', cat: 'culture',
    list: VP.filter(isMuseum), plans: plansWith,
    title: c => `Музеи ${C.gen}: ${N(c.n, ['музей и галерея', 'музея и галереи', 'музеев и галерей'])}`,
    desc: () => `Музеи и галереи ${C.gen} для свидания и выходного дня: адреса, метро, цены и выставки, которые идут сейчас.`,
    lead: c => {
      const expo = EVENTS.filter(e => e.cat === 'exhibition').length;
      return `${cap1(N(c.n, W_.place))}: музеи, галереи и выставочные залы — например, ${c.top}. ${cap1(N(c.p1, W_.place))} с недорогим входом, примерно до 1 500 ₽.${expo ? ` Внизу — ${N(expo, W_.expo)}, которые идут сейчас или скоро откроются.` : ''}`;
    },
    extra: c => [sec('events', 'Выставки сейчас', sortEvents(EVENTS.filter(e => e.cat === 'exhibition')), 12, { href: '@vystavki', text: 'Все выставки' })],
    related: ['vystavki', 'pervoe-svidanie', 'vyhodnye', 'teatry', 'zima'],
  });
  catPage({
    slug: 'teatry', label: 'Театры', h1: `Театры ${C.gen}`, h2: 'Театры', cat: 'culture',
    list: VP.filter(isTheatre), plans: plansWith,
    title: c => `Театры ${C.gen}: ${N(c.n, W_.theatre)} и афиша спектаклей`,
    desc: () => `Театры ${C.gen} для свидания: драма, опера и балет, кукольные и гастротеатры. Адреса, метро и спектакли на ближайшие недели.`,
    lead: c => {
      const n = EVENTS.filter(e => e.cat === 'theatre').length;
      return `${cap1(N(c.n, W_.theatre))} в каталоге — драма, опера и балет, кукольные и гастротеатры, где ужин совмещён со спектаклем, например ${c.top}.${n ? ` В афише — ${N(n, W_.show)} на ближайшие недели с датами и ссылками на официальные кассы.` : ''} Билеты на премьеры уходят быстро, поэтому зови заранее.`;
    },
    extra: () => [sec('events', 'Спектакли в афише', sortEvents(EVENTS.filter(e => e.cat === 'theatre')), 12, { href: '@spektakli', text: 'Все спектакли' })],
    related: ['spektakli', 'svidanie', 'muzei', 'koncerty', 'zima'],
  });
  catPage({
    slug: 'kvesty', label: 'Квесты', h1: `Квесты ${C.in}`, h2: 'Квесты', cat: 'fun', mode: 'guys',
    list: VP.filter(isQuest), plans: plansWith,
    title: c => `Квесты ${C.in}: ${N(c.n, W_.quest)} для компании и свидания`,
    desc: () => `Квесты ${C.in} для компании и свидания: адреса, метро, цены и планы, куда пойти после игры.`,
    lead: c => `${cap1(N(c.n, W_.quest))} в каталоге — от хорроров до детективов. Хорошо идти компанией от двух до шести человек, а после игры обсудить всё за ужином: в планах ниже кафе и бары рядом.`,
    related: ['s-druzyami', 'devichnik', 'karaoke', 'kompyuternye-kluby'],
  });
  catPage({
    slug: 'bani', label: 'Бани и спа', h1: `Бани и спа ${C.in}`, h2: 'Бани, хамамы и спа', cat: 'spa', mode: 'guys',
    list: VP.filter(isBath), plans: plansWith,
    title: c => `Бани и спа ${C.in}: ${N(c.n, W_.place)} для компании и вдвоём`,
    desc: () => `Бани, хамамы, термы и спа ${C.in}: адреса, метро, цены и планы — куда пойти поужинать после пара.`,
    lead: c => `${cap1(N(c.n, W_.place))}: исторические бани, хамамы, термальные комплексы и спа — например, ${c.top}. Компанией или вдвоём — после пара в планах ниже есть где поужинать.`,
    related: ['s-druzyami', 'devichnik', 'zima', 'katki'],
  });
  catPage({
    slug: 'karaoke', label: 'Караоке', h1: `Караоке ${C.in}`, h2: 'Где спеть', cat: 'fun', mode: 'girls',
    list: VP.filter(isKaraoke), plans: plansWith,
    title: c => `Караоке ${C.in}: ${N(c.n, W_.place)} для девичника и компании`,
    desc: () => `Караоке ${C.in}: отдельные комнаты для компании, караоке-бары и рестораны со сценой. Адреса, метро, цены и планы на вечер.`,
    lead: c => `${cap1(N(c.n, W_.place))} с караоке — отдельные комнаты для компании, караоке-бары и рестораны со сценой, например ${c.top}. Для девичника, дня рождения или вечера с друзьями, а в планах ниже — где поужинать до этого.`,
    related: ['devichnik', 's-druzyami', 'bary', 'pozdno-vecherom'],
  });
  catPage({
    slug: 'krishi-i-panoramy', label: 'Крыши и панорамы', h1: 'Крыши, панорамы и места с видом', h2: 'Места с видом', app: { href: plansHref('date', 'view'), text: 'Планы с видом' },
    list: VP.filter(isView), plans: ids => PLANS.filter(s => (s.tags || []).includes('view') || s.stops.some(id => ids.has(id))),
    plansH2: 'Планы с видом на город',
    title: c => `Крыши и панорамы ${C.gen}: ${N(c.n, W_.place)} с видом`,
    desc: () => `Смотровые площадки, панорамные рестораны и бары, крыши и набережные ${C.gen} с видом на город. Готовые планы на закат.`,
    lead: c => `${cap1(N(c.n, W_.place))} с видом на город: смотровые площадки, панорамные рестораны и бары на высоте, крыши и набережные — например, ${c.top}.${c.plans.length ? ` Ещё ${N(c.plans.length, W_.readyPlan)} с видом — особенно хороши на закате.` : ''}`,
    related: ['svidanie', 'parki', 'restorany', 'bary'],
  });

  /* — компьютерные клубы — */
  const PCS = VP.filter(p => p.c === 'pc');
  const pcOkrPages = [], pcMetroPages = [];
  Object.entries(OKR).forEach(([okr, o]) => {
    const list = sortPlaces(PCS.filter(p => p.okr === okr), p => (is247(p) ? 1 : 0));
    if (list.length < MIN_ITEMS) return;
    const c24 = list.filter(is247).length;
    const st = {};
    list.forEach(p => { if (isMetro(p.metro)) st[p.metro] = (st[p.metro] || 0) + 1; });
    const topSt = Object.entries(st).sort((a, b) => b[1] - a[1] || coll.compare(a[0], b[0])).slice(0, 3).map(([s]) => `«${s}»`);
    const slug = 'kompyuternye-kluby-' + o.slug;
    pcOkrPages.push({ slug, okr });
    add({
      slug, group: 'pc', label: o.short ? `${o.name} (${o.short})` : o.name, mode: 'guys', okr,
      title: `Компьютерные клубы ${o.loc}${o.short ? ` (${o.short})` : ''}: ${N(list.length, W_.club)}`,
      desc: `${cap1(N(list.length, W_.pcClub))} ${o.loc}: адреса, ближайшее метро${c24 ? ', круглосуточные клубы' : ''} и планы, где поесть после игры.`,
      h1: `Компьютерные клубы ${o.loc}`, eyebrow: `Компьютерные клубы · ${o.short || o.name}`,
      lead: `${cap1(N(list.length, W_.pcClub))} ${o.loc}${c24 ? `, ${c24 === list.length ? 'все' : num(c24) + ' из них'} ${V(c24, 'работает', 'работают')} круглосуточно` : ''}.${topSt.length ? ` Больше всего клубов у ${topSt.length > 1 ? 'станций' : 'станции'} ${joinRu(topSt)}.` : ''} Цены и свободные места лучше уточнить у клуба: у сетей бывают ночные пакеты и скидки по будням.`,
      stats: [N(list.length, W_.club), c24 ? `${num(c24)} круглосуточно` : ''],
      app: { href: placesHref('guys', 'pc', okr, true), text: 'Открыть на карте' }, invite: { href: 'create.html?mode=guys', text: 'Собрать пати' },
      sections: [
        sec('places', 'Клубы', list, CAP.places, morePlaces(list, 'guys', 'pc', okr, W_.club)),
        sec('plans', 'Планы: катка и поесть рядом', sortPlans(PLANS.filter(s => s.stops.some(id => list.some(p => p.id === id)))), 8, null),
      ],
      related: ['kompyuternye-kluby'],
    });
  });
  [...STATIONS.values()].sort((a, b) => coll.compare(a.name, b.name)).forEach(stn => {
    const near = PCS.map(p => ({ p, d: distM(stn, p) })).filter(x => x.d <= 1500).sort((a, b) => a.d - b.d || cmp(a.p.id, b.p.id)).map(x => x.p);
    const own = near.filter(p => p.metro === stn.name).length;
    if (near.length < MIN_ITEMS || !own) return;
    const c24 = near.filter(is247).length;
    const slug = 'kompyuternye-kluby-u-metro-' + slugify(stn.name);
    const first = near[0];
    pcMetroPages.push({ slug, stn });
    add({
      slug, group: 'pc', label: `у м. ${stn.name}`, mode: 'guys', station: stn, near: stn, okr: stn.okr,
      title: `Компьютерные клубы у метро ${stn.name}: ${N(near.length, W_.club)} рядом`,
      desc: `${cap1(N(near.length, W_.pcClub))} в радиусе 1,5 км от метро «${stn.name}»: адреса, сколько идти пешком${c24 ? ', круглосуточные клубы' : ''}.`,
      h1: `Компьютерные клубы у метро «${stn.name}»`, eyebrow: `Компьютерные клубы · ${metroText(stn.name)}`,
      lead: `В радиусе полутора километров от станции «${stn.name}» — ${N(near.length, W_.pcClub)}. Ближе всего «${first.name}», примерно ${N(walkMin(stn, first), W_.minute)} пешком${c24 ? `; ${c24 === near.length ? 'все клубы из списка работают' : `${num(c24)} из списка ${V(c24, 'работает', 'работают')}`} круглосуточно` : ''}. Время в пути считаем по прямой с запасом на улицы, так что это ориентир, а маршрут точно построят Яндекс Карты.`,
      stats: [N(near.length, W_.club), c24 ? `${num(c24)} круглосуточно` : ''],
      app: { href: placesHref('guys', 'pc', stn.okr, true), text: 'Открыть на карте' }, invite: { href: 'create.html?mode=guys', text: 'Собрать пати' },
      sections: [sec('places', `Клубы у метро «${stn.name}»`, near, CAP.places, null, 'По расстоянию от станции.')],
      related: ['kompyuternye-kluby'],
    });
  });
  (() => {
    const list = sortPlaces(PCS, p => (is247(p) ? 1 : 0));
    const c24 = list.filter(is247).length;
    add({
      slug: 'kompyuternye-kluby', group: 'category', label: 'Компьютерные клубы', mode: 'guys',
      title: `Компьютерные клубы ${C.gen}: ${N(list.length, W_.club)} у метро и по ${C.okrPl}`,
      desc: `${cap1(N(list.length, W_.pcClub))} ${C.inWide}: адреса, метро, круглосуточные клубы и клубы рядом с твоей станцией.`,
      h1: `Компьютерные клубы ${C.gen}`, eyebrow: `Компьютерные клубы · данные на ${dm(DATA_DATE)}`,
      lead: `В каталоге ${N(list.length, W_.pcClub)} ${C.pcWhere}, ${num(c24)} ${V(c24, 'работает', 'работают')} круглосуточно. Выбери свой ${C.okrOne} или станцию метро ниже — там клубы стоят по расстоянию. Цены и свободные места лучше уточнить у клуба: у сетей бывают ночные пакеты и скидки по будням.`,
      stats: [N(list.length, W_.club), `${num(c24)} круглосуточно`, N(pcMetroPages.length, ['станция', 'станции', 'станций'])],
      app: { href: placesHref('guys', 'pc', '', true), text: 'Клубы на карте' }, invite: { href: 'create.html?mode=guys', text: 'Собрать пати' },
      sections: [
        pcOkrPages.length ? { kind: 'links', h2: `Клубы по ${C.okrPl}`, all: pcOkrPages, items: pcOkrPages.map(x => ({ href: '@' + x.slug, slug: x.slug })), more: null } : null,
        pcMetroPages.length ? { kind: 'links', h2: 'Клубы у метро', all: pcMetroPages, items: pcMetroPages.map(x => ({ href: '@' + x.slug, slug: x.slug })), more: null } : null,
        sec('places', 'Все клубы', list, CAP.places, morePlaces(list, 'guys', 'pc', '', W_.club)),
      ],
      related: ['s-druzyami', 'pozdno-vecherom', 'kvesty', 'bary'],
      countItems: list.length,
    });
  })();

  /* — афиша — */
  [
    ['koncerty', 'concert', 'Концерты', `Концерты ${C.in}`, W_.concert, 'Концерты'],
    ['spektakli', 'theatre', 'Спектакли', `Спектакли ${C.in}`, W_.show, 'Спектакли'],
    ['vystavki', 'exhibition', 'Выставки', `Выставки ${C.in}`, W_.expo, 'Выставки'],
    ['stendap', 'standup', 'Стендап', `Стендап ${C.in}`, W_.standup, 'Стендап-вечера'],
  ].forEach(([slug, cat, label, h1, forms, h2]) => {
    const evs = sortEvents(EVENTS.filter(e => e.cat === cat));
    const mode = cat === 'standup' ? 'guys' : 'date';
    const what = { concert: 'концерт', theatre: 'спектакль', exhibition: 'выставку', standup: 'стендап' }[cat];
    const related = ['koncerty', 'spektakli', 'vystavki', 'stendap', 'futbol', 'segodnya', 'vyhodnye'].filter(x => x !== slug);
    // планы, где одна из точек — площадка этого жанра: на случай, когда в афише жанра пусто или почти пусто
    const rx = { concert: /концерт|филармон|джаз|консерватор|music|музык/i, theatre: /театр|опер|балет|кабаре/i, exhibition: /музе|галере|выстав/i, standup: /стендап|комеди|stand ?up/i }[cat];
    const plans = evs.length < MIN_ITEMS ? sortPlans(PLANS.filter(x => x.st.some(p => rx.test(p.kind + ' ' + p.name)))) : [];
    if (!evs.length) {
      // у города, где афиши ещё нет совсем, пустые страницы жанров не делаем
      if (C !== MAIN && !EVENTS.length) return;
      add({
        slug, group: 'afisha', label, mode, changefreq: 'daily', min: 0,
        title: `${h1}: афиша`, desc: `${h1}: даты, площадки, метро и цены со ссылками на официальные кассы. Афиша обновляется каждый день, а пока — готовые планы.`,
        h1, eyebrow: `Афиша · обновлено ${dm(TODAY)}`,
        lead: `Сейчас в нашей афише нет ${forms[2]}: прошлые уже прошли, новые появятся при следующем обновлении.${plans.length ? ` А пока — ${N(plans.length, W_.readyPlan)}, где ${cat === 'exhibition' ? 'одна из точек — музей или галерея' : 'одна из точек — подходящая площадка'}.` : ''}`,
        stats: [], app: afishaCta(mode), invite: { href: `create.html?mode=${mode}`, text: 'Позвать игрой' },
        sections: [sec('plans', 'Готовые планы', plans, CAP.plans, morePlans(plans))], related,
      });
      return;
    }
    const last = evs.map(e => e.days[e.days.length - 1]).sort().pop();
    const prices = evs.filter(e => Array.isArray(e.price)).map(e => e.price[0]).filter(Number.isFinite);
    const free = evs.filter(isFree).length;
    const min = prices.filter(x => x > 0).sort((a, b) => a - b)[0];
    const range = dRange(evs[0].next, last);
    add({
      slug, group: 'afisha', label, mode, changefreq: 'daily',
      title: `${h1}: афиша на ${range}`,
      desc: `${cap1(N(evs.length, forms))} ${C.in} ${evs[0].next === last ? dm(last) : `с ${dm(evs[0].next)} по ${dm(last)}`}: даты, площадки, метро и цены, ссылки на официальные кассы. Позови игрой или собери компанию.`,
      h1, eyebrow: `Афиша · обновлено ${dm(TODAY)}`,
      lead: `${cap1(N(evs.length, forms))} ${evs[0].next === last ? dm(last) : `с ${dm(evs[0].next)} по ${dm(last)}`}${cat === 'exhibition' ? ' — те, что уже идут, и те, что скоро откроются' : ''}. ${free ? `${cap1(N(free, ['событие', 'события', 'событий']))} с бесплатным входом${min ? `, на остальные билеты — от ${num(min)} ₽` : ''}.` : min ? `Билеты — от ${num(min)} ₽.` : ''} Даты и цены сверяем с официальными страницами, ссылки на кассы — в карточках. Позови на ${what} игрой или собери компанию голосованием.`,
      stats: [N(evs.length, forms), free ? `${num(free)} бесплатно` : '', min ? `от ${num(min)} ₽` : ''],
      app: afishaCta(mode), invite: { href: `create.html?mode=${mode}`, text: 'Позвать игрой' }, min: 0,
      // адрес жанра не пропадает, даже если событий осталось мало
      sections: [sec('events', h2, evs, CAP.events, moreEvents(mode)), sec('plans', 'Готовые планы рядом с площадками', plans, 12, morePlans(plans))],
      related,
    });
  });
  /* — футбол: матчи в городе (sport.js и футбол из общей афиши) и где смотреть трансляции; подборка для пацанов — */
  (() => {
    const matches = sortEvents(EVENTS.filter(isFootball));
    const bars = sortPlaces(VP.filter(isSportsBar));
    // страница живёт, пока есть матчи; в межсезонье — если расписание вообще ведётся и есть где смотреть
    if (!matches.length && !(SPORT_FEED && bars.length >= MIN_ITEMS)) return;
    const venues = uniqBy(matches.map(e => e.venue).filter(Boolean), x => x).slice(0, 3).map(q);
    const min = matches.filter(e => Array.isArray(e.price)).map(e => e.price[0]).filter(x => Number.isFinite(x) && x > 0).sort((a, b) => a - b)[0];
    const last = matches.length ? matches.map(e => e.days[e.days.length - 1]).sort().pop() : '';
    const when = matches.length ? (matches[0].next === last ? dm(last) : `с ${dm(matches[0].next)} по ${dm(last)}`) : '';
    const barsN = bars.length ? N(bars.length, W_.sportBar) : '';
    add({
      slug: 'futbol', group: 'afisha', label: 'Футбол', mode: 'guys', changefreq: 'daily', min: 0, evForms: W_.match,
      title: matches.length ? `Футбол ${C.in}: ${N(matches.length, W_.match)} на ${dRange(matches[0].next, last)}` : `Футбол ${C.in}: где смотреть матчи`,
      desc: matches.length
        ? `Ближайшие футбольные матчи ${C.in}: даты, стадионы, метро и цены, ссылки на официальные кассы${bars.length ? ', а ещё бары, где показывают трансляции' : ''}. Собери компанию голосованием.`
        : `Где посмотреть футбол ${C.in}: спорт-бары и пабы с трансляциями. Расписание матчей появится здесь, как только его объявят.`,
      h1: matches.length ? `Футбол ${C.in}: ближайшие матчи` : `Футбол ${C.in}: где смотреть матчи`, eyebrow: `Афиша · обновлено ${dm(TODAY)}`,
      lead: matches.length
        ? `${cap1(N(matches.length, W_.match))} ${when}${venues.length ? ` — ${venues.length > 1 ? 'на стадионах' : 'на стадионе'} ${joinRu(venues)}` : ''}. ${min ? `Билеты — от ${num(min)} ₽, ссылки на официальные кассы — в карточках.` : 'Ссылки на официальные кассы — в карточках.'}${bars.length ? ` Не достал билеты — ниже ${barsN}, где показывают трансляции.` : ''} Кинь ссылку в чат: каждый отметит, на какой матч может пойти.`
        : `Ближайших матчей в нашей афише пока нет: у лиги перерыв или расписание ещё не объявили. А посмотреть футбол компанией можно в ${barsN} — например, ${names(bars)}.`,
      stats: [matches.length ? N(matches.length, W_.match) : '', min ? `от ${num(min)} ₽` : '', barsN],
      app: afishaCta('guys'), invite: { href: 'create.html?mode=guys', text: 'Собрать компанию' },
      sections: [
        sec('events', 'Ближайшие матчи', matches, CAP.events, moreEvents('guys')),
        sec('places', 'Где смотреть трансляции', bars, 24, null, 'Бары и пабы с экранами. Покажут ли нужный матч, лучше уточнить у заведения.'),
      ],
      related: ['s-druzyami', 'bary', 'segodnya', 'vyhodnye', 'pozdno-vecherom', 'koncerty', 'stendap'],
    });
  })();

  /* — округа (районы) — */
  const okrPages = [];
  Object.entries(OKR).forEach(([okr, o]) => {
    if (o.pcOnly) return;
    const all = VP.filter(p => p.okr === okr);
    if (all.length < 5) return;
    const list = sortPlaces(all.filter(p => p.c !== 'pc'));
    const clubs = sortPlaces(all.filter(p => p.c === 'pc'), p => (is247(p) ? 1 : 0));
    const plans = sortPlans(PLANS.filter(s => s.st[0].okr === okr));
    const st = {};
    all.forEach(p => { if (isMetro(p.metro)) st[p.metro] = (st[p.metro] || 0) + 1; });
    const topSt = Object.entries(st).sort((a, b) => b[1] - a[1] || coll.compare(a[0], b[0])).slice(0, 3).map(([s]) => `«${s}»`);
    // районы города, которые входят в эту часть; у пригородов — сами города по адресам мест
    const areas = o.towns ? joinRu(Object.entries(all.reduce((a, p) => { const t = C.town(p); if (t) a[t] = (a[t] || 0) + 1; return a; }, {}))
      .sort((a, b) => b[1] - a[1] || coll.compare(a[0], b[0])).slice(0, 4).map(x => x[0])) : o.areas || '';
    const slug = 'kuda-shodit-' + o.slug;
    okrPages.push({ slug, okr });
    add({
      slug, group: 'okr', label: o.short ? `${o.name} (${o.short})` : o.name, mode: 'date', okr, min: 5,
      title: `Куда сходить ${o.loc}${o.short ? ` (${o.short})` : ''}: ${N(all.length, W_.place)} и ${N(plans.length, W_.plan)}`,
      desc: `Куда сходить ${o.loc}${areas ? ` (${areas})` : ''}: ${breakdown(all, 3)} — адреса, метро, цены и готовые планы на вечер с маршрутом.`,
      h1: `Куда сходить ${o.loc}`, eyebrow: `Районы · ${o.short || o.name}`,
      lead: `${cap1(N(all.length, W_.place))} ${o.loc}${areas ? ` (${areas})` : ''}: ${breakdown(all)}.${list.length ? ` Например, ${names(list)}.` : ''}${plans.length ? ` ${cap1(N(plans.length, W_.readyPlan))} ${V(plans.length, 'начинается', 'начинаются')} здесь.` : ''}${topSt.length ? ` Больше всего мест у ${topSt.length > 1 ? 'станций' : 'станции'} ${joinRu(topSt)}.` : ''}`,
      stats: [N(all.length, W_.place), plans.length ? N(plans.length, W_.plan) : '', clubs.length ? N(clubs.length, W_.club) : ''],
      app: { href: placesHref('date', '', okr, true), text: 'Открыть на карте' }, invite: { href: 'create.html?mode=date', text: 'Позвать игрой' },
      sections: [
        sec('places', 'Места', list, CAP.places, morePlaces(list, 'date', '', okr)),
        sec('plans', 'Готовые планы', plans, 18, morePlans(plans)),
        sec('places', 'Компьютерные клубы', clubs, 10, { href: '@kompyuternye-kluby-' + o.slug, text: `Все ${N(clubs.length, W_.club)} ${o.loc}` }),
      ],
      related: [],
    });
  });

  /* — у метро — */
  const metroPages = new Map();
  [...STATIONS.values()].filter(s => s.allCount >= 5).sort((a, b) => coll.compare(a.name, b.name)).forEach(stn => {
    const list = sortPlaces(stn.places.filter(p => p.c !== 'pc'));
    const clubs = sortPlaces(stn.places.filter(p => p.c === 'pc'));
    const plans = sortPlans(PLANS.filter(s => s.st.some(p => p.metro === stn.name)));
    const o = OKR[stn.okr];
    let slug = 'kuda-shodit-u-metro-' + slugify(stn.name);
    while ([...metroPages.values()].includes(slug)) slug += '-2';
    const all = stn.places;
    const b = breakdown(all);
    const cheap = list.filter(p => (p.price || 1) <= 1).length;
    const before = PAGES.length;
    add({
      slug, group: 'metro', label: stn.name, mode: 'date', station: stn, okr: stn.okr, min: 3,
      title: `Куда сходить у метро ${stn.name}: ${N(all.length, W_.place)} рядом`,
      desc: `${cap1(breakdown(all, 3))} у метро «${stn.name}» — адреса, цены и готовые планы на вечер с маршрутом.`,
      h1: `Куда сходить у метро «${stn.name}»`, eyebrow: `У метро${o ? ' · ' + (o.short || o.name) : ''}`,
      lead: `Для ${N(all.length, ['места', 'мест', 'мест'])} из нашего каталога ближайшая станция — «${stn.name}»${o ? ` (${o.short || o.name})` : ''}: ${b}.${list.length ? ` Например, ${names(list)}.` : ''}${cheap ? ` Недорогих, примерно до 1 500 ₽ на человека, — ${num(cheap)}.` : ''}${plans.length ? ` ${cap1(N(plans.length, W_.readyPlan))} ${V(plans.length, 'проходит', 'проходят')} через эту станцию — например, ${q(plans[0].title)}, с маршрутом пешком между точками.` : ''}`,
      stats: [N(all.length, W_.place), plans.length ? N(plans.length, W_.plan) : ''],
      app: { href: placesHref('date', '', stn.okr, true), text: 'Открыть на карте' }, invite: { href: 'create.html?mode=date', text: 'Позвать игрой' },
      sections: [
        sec('places', `Места у метро «${stn.name}»`, list, CAP.places, null),
        sec('plans', 'Готовые планы', plans, 12, null),
        sec('places', 'Компьютерные клубы', clubs, 10, null),
      ],
      related: [],
    });
    if (PAGES.length > before) metroPages.set(stn.name, slug);
  });

  /* — связи между подборками — */
  const BY = new Map(PAGES.map(p => [p.slug, p]));
  const metroSlugOf = m => metroPages.get(m) || null;
  const pcMetroSlug = name => (pcMetroPages.find(x => x.stn.name === name) || {}).slug;
  const nearestPages = (stn, pool, k) => pool.filter(x => x.stn.name !== stn.name).map(x => ({ x, d: distM(stn, x.stn) })).filter(y => y.d <= 3500).sort((a, b) => a.d - b.d).slice(0, k).map(y => y.x.slug);
  PAGES.forEach(pg => {
    if (pg.group === 'okr') {
      const inOkr = [...metroPages.entries()].filter(([name]) => STATIONS.get(name).okr === pg.okr).sort((a, b) => STATIONS.get(b[0]).places.length - STATIONS.get(a[0]).places.length || coll.compare(a[0], b[0])).slice(0, 10).map(x => x[1]);
      pg.related = [...inOkr, 'kompyuternye-kluby-' + OKR[pg.okr].slug, ...okrPages.filter(x => x.okr !== pg.okr).map(x => x.slug)];
    } else if (pg.group === 'metro') {
      const pool = [...metroPages.entries()].map(([name, slug]) => ({ slug, stn: STATIONS.get(name) }));
      pg.related = [okrPages.find(x => x.okr === pg.okr)?.slug, pcMetroSlug(pg.station.name), ...nearestPages(pg.station, pool, 6), 'restorany', 'bary'].filter(Boolean);
    } else if (pg.group === 'pc' && pg.station) {
      pg.related = [metroSlugOf(pg.station.name), pcOkrPages.find(x => x.okr === pg.okr)?.slug, ...nearestPages(pg.station, pcMetroPages, 5), 'kompyuternye-kluby'].filter(Boolean);
    } else if (pg.group === 'pc') {
      pg.related = ['kompyuternye-kluby', ...pcMetroPages.filter(x => x.stn.okr === pg.okr).map(x => x.slug), okrPages.find(x => x.okr === pg.okr)?.slug, ...pcOkrPages.filter(x => x.okr !== pg.okr).map(x => x.slug)].filter(Boolean);
    } else if (pg.group === 'category' && pg.slug !== 'kompyuternye-kluby') {
      pg.related = [...pg.related, ...otherCats(pg.slug)];
    }
    pg.related = uniqBy(pg.related.filter(s => s && s !== pg.slug && BY.has(s)), s => s);
  });

  /* ---------- страницы мест (A10), подборки редакции (A1) и календари (A7): данные ---------- */
  /* своя страница m/<id>/ — у каждого открытого места не 18+ (и у сезонных: по названию их ищут круглый год) */
  const MP = VP_ALL.filter(p => PAGE_ID.test(p.id)).sort((a, b) => cmp(a.id, b.id));
  const HAS_PAGE = new Set(MP.map(p => p.id));
  const placeHref = p => (p && p.city === cid && HAS_PAGE.has(p.id) ? '@m/' + p.id : null);
  /* закрытое место — страница «Закрылось» с noindex (только если id не занят открытым местом) */
  const CLOSED = CLOSED_ALL.filter(p => p.city === cid && !HAS_PAGE.has(p.id)).sort((a, b) => cmp(a.id, b.id));
  /* подборки редакции этого города: адрес podborki/<slug>/ (slug — id без spb- и c-) */
  const COLS = [];
  {
    const used = new Set();
    COLS_ALL.filter(x => x.city === cid).forEach(x => {
      let slug = x.slugBase || slugify(x.title) || 'podborka';
      while (used.has(slug)) slug += '-2';
      used.add(slug);
      COLS.push(Object.assign({}, x, { slug }));
    });
  }
  const colsOf = new Map();   // 'places:<id>' / 'plans:<id>' / 'events:<id>' → подборки с этим пунктом
  COLS.forEach(col => col.items.forEach(it => { const k = it.kind + ':' + it.x.id; if (!colsOf.has(k)) colsOf.set(k, []); colsOf.get(k).push(col); }));
  const plansAt = new Map(), eventsAt = new Map();
  PLANS_ALL.forEach(s => new Set(s.stops).forEach(id => { if (!plansAt.has(id)) plansAt.set(id, []); plansAt.get(id).push(s); }));
  EVENTS.forEach(e => { if (e.place && HAS_PAGE.has(e.place)) { if (!eventsAt.has(e.place)) eventsAt.set(e.place, []); eventsAt.get(e.place).push(e); } });
  /* «Похожие рядом» — та же категория до 3 км, как в карточке места на главной; «Что ещё рядом» — другое, до 1,5 км */
  function nearOf(p) {
    const same = [], other = [];
    for (const x of VP) {
      if (x.id === p.id || !HAS_PAGE.has(x.id)) continue;
      const d = distM(p, x);
      if (x.c === p.c) { if (d <= 3000) same.push({ x, d }); } else if (x.c !== 'pc' && d <= 1500) other.push({ x, d });
    }
    const by = (a, b) => a.d - b.d || cmp(a.x.id, b.x.id);
    return { same: same.sort(by).slice(0, 4), other: other.sort(by).slice(0, 6) };
  }
  /* режим страницы места: чаще всего встречается в его планах; без планов — компьютерный клуб у пацанов, остальное — свидание */
  function placeMode(p) {
    const n = {};
    (plansAt.get(p.id) || []).forEach(s => { n[s.mode] = (n[s.mode] || 0) + 1; });
    return MODES.filter(m => n[m]).sort((a, b) => n[b] - n[a])[0] || (p.c === 'pc' ? 'guys' : 'date');
  }
  const catSlugOf = p => ({ food: 'restorany', coffee: 'kofejni', bar: 'bary', pc: 'kompyuternye-kluby', spa: 'bani' })[p.c]
    || (p.c === 'walk' && isPark(p) ? 'parki' : p.c === 'culture' && isMuseum(p) ? 'muzei' : p.c === 'culture' && isTheatre(p) ? 'teatry' : isQuest(p) ? 'kvesty' : isKaraoke(p) ? 'karaoke' : null);
  const okrSlugOf = okr => (okrPages.find(x => x.okr === okr) || {}).slug || null;

  /* календари: «выходные» города (weekend.ics) и события подборки (podborki/<slug>/calendar.ics) */
  const HOST = new URL(BASE).hostname;
  const ICS_STAMP = DATA_DATE.replace(/-/g, '') + 'T000000Z';
  const EV_MIN = { concert: 120, theatre: 150, standup: 90, show: 120, sport: 120, party: 240, lecture: 90, festival: 240, exhibition: 120, kids: 90 };
  const ymd8 = s => s.replace(/-/g, '');
  function icsEvent(e, day, uid, prefix = '') {
    const m = evMode(e, e.fit[0] || 'date');
    const app = AFISHA_HUB ? appUrl(L.event(e, m)) : '';
    const price = evPrice(e);
    return {
      uid: uid + '@' + HOST, day, time: isRun(e) ? '' : e.time, minutes: EV_MIN[e.cat] || 120,
      summary: prefix + e.title + (isFree(e) ? ' · бесплатно' : ''),
      location: [e.venue, e.addr].filter(Boolean).join(', '),
      geo: Number.isFinite(e.lat) && Number.isFinite(e.lon) ? [e.lat, e.lon] : null,
      description: [e.note, [price ? cap1(price) : '', e.age || ''].filter(Boolean).join(', '), e.url ? 'Билеты и подробности: ' + e.url : '', app ? `Позвать друзей — в «${BRAND}»: ${app}` : ''].filter(Boolean).join('\n'),
      url: app || e.url || '', categories: isFootball(e) ? 'Футбол' : EV_CAT[e.cat] || 'Событие',
    };
  }
  const byDay = (a, b) => cmp(a.day, b.day) || cmp(a.time || '', b.time || '') || cmp(a.uid, b.uid);
  /* Выходные на две недели вперёд: 1) бесплатные и отмеченные (pick/top или пункт подборки редакции) — каждый показ,
     не больше 4 у события; у выставок без перерыва — день открытия и последний день, если они в окне;
     2) наш выбор на субботу и воскресенье — до 4 событий с датой на день, каждое событие один раз: сначала площадки из
     каталога, события для нескольких поводов, с известным временем и ценой, матчи. */
  function weekendFeed() {
    const last = addD(TODAY, 13), win = d => d >= TODAY && d <= last;
    const inCols = new Set(COLS.flatMap(col => col.items.filter(it => it.kind === 'events').map(it => it.x.id)));
    const flag = e => e.pick === true || e.top === true || inCols.has(e.id);
    const out = [], uids = new Set(), taken = new Set();
    const push = (e, day, uid, prefix) => { if (uids.has(uid)) return; uids.add(uid); taken.add(e.id); out.push(icsEvent(e, day, uid, prefix)); };
    const dated = EVENTS.filter(e => !isRun(e));
    dated.filter(e => isFree(e) || flag(e)).forEach(e => e.days.filter(win).slice(0, 4).forEach(d => push(e, d, `${e.id}-${ymd8(d)}`)));
    EVENTS.filter(e => isRun(e) && (isFree(e) || flag(e))).forEach(e => {
      if (win(e.start)) push(e, e.start, `${e.id}-open`, 'Открытие: ');
      if (win(e.end) && e.end !== e.start) push(e, e.end, `${e.id}-last`, 'Последний день: ');
    });
    const score = e => (e.placeObj ? 2 : 0) + e.fit.length + (e.time ? 1 : 0) + (Array.isArray(e.price) ? 1 : 0) + (isFootball(e) ? 1 : 0);
    for (let d = TODAY; d <= last; d = addD(d, 1)) {
      if (dow(d) !== 6 && dow(d) !== 0) continue;
      dated.filter(e => e.days.includes(d) && !taken.has(e.id))
        .sort((a, b) => score(b) - score(a) || cmp(a.time || '99', b.time || '99') || coll.compare(a.title, b.title) || cmp(a.id, b.id))
        .slice(0, 4).forEach(e => push(e, d, `${e.id}-${ymd8(d)}`));
    }
    return out.sort(byDay);
  }
  /* события подборки: показы на два месяца вперёд (до 8 у события), выставка без перерыва — одной записью на весь срок */
  function colFeed(col) {
    const last = addD(TODAY, 60), out = [], uids = new Set();
    col.items.filter(it => it.kind === 'events').forEach(({ x: e }) => {
      if (isRun(e)) { if (!uids.has(e.id)) { uids.add(e.id); out.push(Object.assign(icsEvent(e, e.start, e.id), { endDay: e.end })); } return; }
      e.days.filter(d => d <= last).slice(0, 8).forEach(d => { const uid = `${e.id}-${ymd8(d)}`; if (!uids.has(uid)) { uids.add(uid); out.push(icsEvent(e, d, uid)); } });
    });
    return out.sort(byDay);
  }
  /* файлы календарей; считаем при выводе (ссылки в приложение — appUrl — определены ниже) */
  function buildIcs() {
    const weekend = calendar({
      prodid: ICS_PRODID, stamp: ICS_STAMP, name: `${BRAND} · ${C.name}: выходные и бесплатно`,
      desc: `Бесплатные события ${C.gen} и наш выбор на выходные — на две недели вперёд. Календарь обновляется сам.`, events: weekendFeed(),
    });
    COLS.forEach(col => {
      const evs = colFeed(col);
      col.ics = evs.length ? calendar({ prodid: ICS_PRODID, stamp: ICS_STAMP, name: `${BRAND} · ${col.title}`, desc: `События из подборки «${col.title}» ${C.in}.`, events: evs }) : '';
    });
    return weekend;
  }

  /* ---------- вывод HTML ---------- */
  let OTHERS = [];   // другие собранные города — ссылка на их подборки в подвале
  const groupLabel = g => (g === 'okr' ? C.okrGroup : (GROUPS.find(x => x[0] === g) || [])[1]);
  const pageUrl = slug => BASE + C.out + '/' + (slug ? slug + '/' : '');
  const appUrl = t => BASE + addCity(t, C.q);
  /* c.depth — глубина страницы от корня сайта: 1 — <город>/index.html, 2 — <город>/<slug>/, 3 — <город>/m/<id>/ и
     <город>/podborki/<slug>/. '@slug' (и '@m/<id>', '@podborki/<slug>') — страница города, '#index' — оглавление города */
  const up = n => '../'.repeat(n);
  function href(target, c) {
    if (target.startsWith('@')) return up(c.depth - 1) + target.slice(1) + '/';
    if (target === '#index') return c.depth === 1 ? './' : up(c.depth - 1);
    return up(c.depth) + addCity(target, C.q);
  }
  function thumb(ph, emoji, c) {
    if (!ph) return `<span class="th" aria-hidden="true">${esc(emoji || '📍')}</span>`;
    const lazy = c.img++ >= 3 ? ' loading="lazy"' : '';
    return `<span class="th"><img src="${esc(href(ph.t, c))}" width="240" height="240" alt=""${lazy} decoding="async"></span>`;
  }
  function metroHtml(m, c) {
    if (!m) return '';
    const slug = isMetro(m) ? metroSlugOf(m) : null;
    if (slug && slug !== c.slug) return `<a href="${href('@' + slug, c)}">${esc(metroText(m))}</a>`;
    return esc(metroText(m));
  }
  /* название места ведёт на его страницу (m/<id>/), если она есть; «Подробнее и маршрут» — в карточку на главной */
  function itPlace(p, c) {
    const app = esc(href(L.place(p.id, c.mode), c)), inv = esc(href(L.invPlace(p.id, c.mode), c));
    const own = placeHref(p) ? esc(href(placeHref(p), c)) : app;
    const meta = [esc(p.kind)];
    if (c.near) meta.push(`≈\u00a0${N(walkMin(c.near, p), W_.minute)} пешком от метро`);
    else if (p.metro) meta.push(metroHtml(p.metro, c));
    meta.push(priceHtml(p.price));
    const tags = [p.mich && C.mich[p.mich] ? `<span class="tg mich">${C.mich[p.mich]}</span>` : '', is247(p) ? '<span class="tg">Круглосуточно</span>' : '', isNew(p) ? '<span class="tg new">Новое</span>' : ''].join('');
    return `<li class="it"><div class="hd">${thumb(p.ph, p.emoji, c)}<div class="ti"><h3><a href="${own}">${esc(p.name)}</a></h3>` +
      `<p class="meta">${meta.join(' · ')}</p></div></div><p class="ad">${esc(p.addr)}</p>${tags ? `<p class="tgs">${tags}</p>` : ''}${p.note ? `<p class="nt">${esc(p.note)}</p>` : ''}` +
      `<p class="act"><a href="${app}">Подробнее и маршрут${forName(p.name)}</a><a class="pri" href="${inv}" rel="nofollow">Позвать сюда${forName(p.name)}</a></p>${credit(p.ph)}</li>`;
  }
  function itPlan(s, c) {
    const app = esc(href(L.plan(s), c)), inv = esc(href(L.invPlan(s), c)), ph = planPh(s);
    const drive = (s.tags || []).includes('drive');
    const meta = [esc(MODE_LABEL[s.mode]), esc(WHEN[s.when] || s.when || ''), priceHtml(maxPrice(s))].filter(Boolean);
    // как на главной: тег drive или больше получаса пешком — на транспорте
    const leg = (a, b) => { const m = walkMin(a, b); return drive || m > 30 ? 'дальше на метро или такси' : `${N(m, W_.minute)} пешком`; };
    const stopName = p => (placeHref(p) && placeHref(p) !== '@' + c.slug ? `<a href="${esc(href(placeHref(p), c))}">${esc(p.name)}</a>` : esc(p.name));
    const stops = s.st.map((p, i) => `<li>${i ? `<span class="wk">${leg(s.st[i - 1], p)}</span>` : ''}<b>${stopName(p)}</b> <span class="k">· ${esc(p.kind)}${i === 0 && p.metro ? ' · ' + metroHtml(p.metro, c) : ''}</span></li>`).join('');
    return `<li class="it"><div class="hd">${thumb(ph, s.emoji, c)}<div class="ti"><h3><a href="${app}">${esc(s.title)}</a></h3><p class="meta">${meta.join(' · ')}</p></div></div>` +
      `<ol class="stops">${stops}</ol>${s.why ? `<p class="nt">${esc(s.why)}</p>` : ''}` +
      `<p class="act"><a href="${app}">Открыть план${forName(s.title)}</a><a class="pri" href="${inv}" rel="nofollow">Позвать сюда${forName(s.title)}</a></p>${credit(ph)}</li>`;
  }
  function itEvent(e, c) {
    const m = evMode(e, c.mode);
    // карточка события на главной — если там есть афиша; иначе заголовок ведёт на сайт организатора
    const app = AFISHA_HUB ? esc(href(L.event(e, m), c)) : '', inv = esc(href(L.invEvent(e, m), c));
    const ext = e.url ? esc(e.url) : '';
    const title = app ? `<a href="${app}">${esc(e.title)}</a>` : ext ? `<a href="${ext}" target="_blank" rel="nofollow noopener">${esc(e.title)}<span class="vh"> (страница с билетами, откроется в новой вкладке)</span></a>` : esc(e.title);
    const th = e.ph ? thumb(e.ph, e.emoji, c) : `<span class="th dt" aria-hidden="true"><b>${+e.next.slice(8, 10)}</b>${MON_S[+e.next.slice(5, 7) - 1]}</span>`;
    const meta = [esc(isFootball(e) ? 'Футбол' : EV_CAT[e.cat] || 'Событие'), esc(evWhen(e))];
    // площадка из каталога — ссылкой на страницу места
    const vp = e.placeObj ? placeHref(e.placeObj) : null;
    const venue = vp && vp !== '@' + c.slug ? `<a href="${esc(href(vp, c))}">${esc(e.venue || e.placeObj.name)}</a>` : esc(e.venue || '');
    const where = [venue, e.metro ? metroHtml(e.metro, c) : '', esc(evPrice(e)), esc(e.age || '')].filter(Boolean);
    return `<li class="it" data-end="${e.days[e.days.length - 1]}"><div class="hd">${th}<div class="ti"><h3>${title}</h3><p class="meta">${meta.join(' · ')}</p></div></div>` +
      `${where.length ? `<p class="ad">${where.join(' · ')}</p>` : ''}${e.note ? `<p class="nt">${esc(e.note)}</p>` : ''}` +
      `<p class="act">${app ? `<a href="${app}">Подробнее${forName(e.title)}</a>` : ''}<a class="pri" href="${inv}" rel="nofollow">Позвать сюда${forName(e.title)}</a>` +
      `${ext ? `<a href="${ext}" target="_blank" rel="nofollow noopener">Билеты <span aria-hidden="true">↗</span><span class="vh">: ${esc(e.title)} (страница с билетами, откроется в новой вкладке)</span></a>` : ''}</p>${credit(e.ph)}</li>`;
  }
  /* short — внутри раздела «Клубы по округам / у метро», где приставка «Клубы» уже в заголовке */
  function relLink(slug, c, short) {
    const pg = BY.get(slug);
    const name = pg.group === 'metro' ? (short ? 'м. ' : 'У м. ') + pg.label
      : pg.group === 'pc' && pg.station ? (short ? 'м. ' : 'Клубы у м. ') + pg.station.name
      : pg.group === 'pc' ? (short ? '' : 'Клубы: ') + pg.label : pg.label;
    const n = countText(pg);
    return `<li><a href="${href('@' + slug, c)}">${esc(name)}${n ? ` <span>${esc(n)}</span>` : ''}</a></li>`;
  }
  function renderSection(s, c, i) {
    const id = 's' + (i + 1);
    if (s.kind === 'cal') return calBlock(s, c, id);
    let body;
    if (s.kind === 'links') body = `<ul class="rel">${s.items.filter(x => BY.has(x.slug)).map(x => relLink(x.slug, c, true)).join('')}</ul>`;
    else body = `<ol class="list">${s.items.map(x => (s.kind === 'plans' ? itPlan(x, c) : s.kind === 'events' ? itEvent(x, c) : itPlace(x, c))).join('')}</ol>`;
    const n = s.kind === 'links' ? '' : ` <span class="n">${s.all.length > s.items.length ? `${s.items.length} из ${s.all.length}` : s.all.length}</span>`;
    // ссылка «все …» на подборку, которой в этой сборке нет, не выводится
    const more = s.more && !(s.more.href.startsWith('@') && !BY.has(s.more.href.slice(1))) ? s.more : null;
    return `<section class="sec" aria-labelledby="${id}"><h2 id="${id}">${esc(s.h2)}${n}</h2>${s.note ? `<p class="sn">${esc(s.note)}</p>` : ''}${body}` +
      `${more ? `<p class="more"><a class="btn ghost" href="${esc(href(more.href, c))}">${esc(more.text)}</a></p>` : ''}</section>`;
  }
  /* Афиша на статической странице стареет между пересборками. Без JS страница просто показывает даты;
     с JS — прячет прошедшие события и честно пишет, когда подборку собрали. */
  const staleNote = c => `<p class="stale" id="stale" role="status" hidden>Подборку собрали ${esc(dm(TODAY))}, прошедшие события скрыты. ${AFISHA_HUB ? `<a href="${esc(href(afishaHref(''), c))}">Свежая афиша — на главной</a>` : `<a href="${esc(href('start.html', c))}">Свежие планы — на главной</a>`}</p>`;
  /* robots — для закрытого места 'noindex, follow'; tail — свой маленький скрипт в конце страницы */
  function doc({ depth, url, title, desc, mode, ogImage, crumbs, body, ld, events, robots, tail }) {
    const c = { depth };
    // картинка для превью ссылок — общая PNG 1200×630: webp-фото мест понимают не все соцсети и мессенджеры
    const og = BASE + (ogImage || C.og);
    const rules = exists('rules.html') ? `<a href="${href('rules.html', c)}">Как работают рекомендации</a>` : '';
    const other = OTHERS.map(o => `<a href="${href(o.C.out + '/', c)}">Куда сходить ${esc(o.C.in)}</a>`).join('');
    return `<!doctype html>
<html lang="ru" data-mode="${mode}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta name="robots" content="${robots || 'index, follow, max-image-preview:large'}">
<meta name="generator" content="${GEN_MARK}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(BRAND)}">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(og)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0F0E13">
<link rel="icon" href="${href('assets/icon.svg', c)}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${href('assets/icon-180.png', c)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@500;700&amp;family=Onest:wght@400;500;600;700&amp;display=swap">
<link rel="stylesheet" href="${up(depth - 1)}seo.css?v=${cssVersionOf(C)}">
<script type="application/ld+json">${ldJson(ld)}</script>
</head>
<body>
<a class="skip" href="#main">К содержанию</a>
<header class="top"><a class="logo" href="${href('start.html', c)}">${LOGO}${esc(BRAND)}</a><a class="city" href="${href('#index', c)}">${esc(C.name)}</a></header>
<nav class="crumbs" aria-label="Навигационная цепочка"><ol>${crumbs.map((x, i) => (i < crumbs.length - 1 ? `<li><a href="${esc(x[1])}">${esc(x[0])}</a></li>` : `<li aria-current="page">${esc(x[0])}</li>`)).join('')}</ol></nav>
<main id="main">
${events ? staleNote(c) + '\n' : ''}${body}
</main>
<footer class="foot">
<nav class="fl" aria-label="Разделы сайта"><a href="${href('start.html', c)}">Главная</a><a href="${href('#index', c)}">Все подборки</a><a href="${href('@m', c)}">Все места</a>${other}<a href="${href('create.html', c)}" rel="nofollow">Конструктор приглашений</a><a href="${href('partners.html', c)}">Для заведений</a><a href="${href('privacy.html', c)}">Конфиденциальность</a>${rules}</nav>
<p>Места проверяем каждый месяц. Часы работы лучше уточнить в Яндекс Картах перед выходом. Цена — ориентир на человека: ₽ — до 1 500 ₽, ₽₽ — 1 500–3 000 ₽, ₽₽₽ — дороже.</p>
<p>Координаты © участники OpenStreetMap. Фото — Wikimedia Commons и Flickr под свободными лицензиями, автор и лицензия указаны под снимком.</p>
</footer>${events ? '\n' + staleJs() : ''}${tail ? '\n' + tail : ''}
</body>
</html>
`;
  }

  /* ---------- schema.org: адрес — в городе места ---------- */
  const ldAddr = p => ({ '@type': 'PostalAddress', streetAddress: p.addr, addressLocality: C.locality(p), addressRegion: C.region(p), addressCountry: 'RU' });
  function ldPlace(p) {
    const t = ldType(p), o = { '@type': t, name: p.name };
    if (p.note) o.description = p.note;
    o.address = ldAddr(p);
    o.geo = ldGeo(p);
    if (LOCAL_BIZ.has(t)) o.priceRange = '₽'.repeat(Math.max(1, Math.min(3, p.price || 1)));
    if (p.ph) o.image = BASE + p.ph.s;
    o.url = appUrl('start.html?place=' + enc(p.id));
    return o;
  }
  function ldPlan(s) {
    const o = { '@type': 'TouristTrip', name: s.title };
    if (s.why) o.description = s.why;
    const ph = planPh(s);
    if (ph) o.image = BASE + ph.s;
    o.url = appUrl('start.html?plan=' + enc(s.id));
    o.itinerary = { '@type': 'ItemList', numberOfItems: s.st.length, itemListElement: s.st.map((p, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': ldType(p), name: p.name, address: ldAddr(p) } })) };
    return o;
  }
  function ldEvent(e) {
    // идёт без перерыва (выставка) — начало и конец всего показа; отдельные даты — ближайшая и последняя
    const first = isRun(e) ? e.start : e.next, last = e.days[e.days.length - 1];
    const o = { '@type': 'Event', name: e.title, startDate: first + (e.time && /^\d\d:\d\d$/.test(e.time) ? `T${e.time}:00+03:00` : '') };
    if (last > first) o.endDate = last;
    o.eventStatus = 'https://schema.org/EventScheduled';
    o.eventAttendanceMode = 'https://schema.org/OfflineEventAttendanceMode';
    const loc = { '@type': 'Place', name: e.venue || e.addr || C.full };
    // площадка не из каталога: город — по началу адреса («Пушкин, …», «Мурино, …»), иначе сам город
    if (e.addr) loc.address = { '@type': 'PostalAddress', streetAddress: e.addr, addressLocality: e.placeObj ? C.locality(e.placeObj) : C.town(e) || C.full, addressCountry: 'RU' };
    if (Number.isFinite(e.lat) && Number.isFinite(e.lon)) loc.geo = ldGeo(e);
    o.location = loc;
    if (e.note) o.description = e.note;
    if (e.ph) o.image = BASE + e.ph.s;
    if (Array.isArray(e.price) && Number.isFinite(e.price[0])) {
      const [a, b] = e.price;
      if (a === 0 && (!b || b === 0)) { o.isAccessibleForFree = true; o.offers = { '@type': 'Offer', price: 0, priceCurrency: 'RUB' }; }
      else if (Number.isFinite(b) && b > a) o.offers = { '@type': 'AggregateOffer', lowPrice: a, highPrice: b, priceCurrency: 'RUB' };
      else o.offers = { '@type': 'Offer', price: a, priceCurrency: 'RUB' };
      if (e.url) o.offers.url = e.url;
    }
    if (AFISHA_HUB) o.url = appUrl('start.html?event=' + enc(e.id));
    else if (e.url) o.url = e.url;
    return o;
  }

  /* ---------- календарь: «Подписаться» (webcal:// — Apple, Outlook и др.), Google Календарь и сам файл ---------- */
  const icsUrl = rel => BASE + C.out + '/' + rel;
  const webcal = u => u.replace(/^https?:/, 'webcal:');
  function calBlock(s, c, id) {
    const u = icsUrl(s.ics);
    return `<section class="sec cal" aria-labelledby="${id}"><h2 id="${id}">${esc(s.h2)}</h2>${s.note ? `<p class="sn">${esc(s.note)}</p>` : ''}<p class="act">` +
      `<a class="pri" href="${esc(webcal(u))}" rel="nofollow">Подписаться в календаре<span class="vh">: ${esc(s.what)}</span></a>` +
      `<a href="${esc('https://calendar.google.com/calendar/r?cid=' + enc(webcal(u)))}" target="_blank" rel="nofollow noopener">Google Календарь<span class="vh">: ${esc(s.what)} (откроется в новой вкладке)</span></a>` +
      `<a href="${esc(up(c.depth - 1) + s.ics)}" download rel="nofollow">Файл .ics<span class="vh">: ${esc(s.what)}</span></a></p></section>`;
  }

  /* ---------- страница места ---------- */
  const MON_P = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
  const lc1 = s => (/^[А-ЯЁA-Z][а-яёa-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); if (s.length <= n) return s; const t = s.slice(0, n - 1); return t.slice(0, Math.max(t.lastIndexOf(' '), n * 0.6)).replace(/[\s,.;:—–-]+$/, '') + '…'; };
  const mapUrlOf = p => { try { if (DK && DK.mapUrl) { const u = DK.mapUrl(p); if (/^https:\/\//.test(u)) return u; } } catch (e) { /* ниже */ } return 'https://yandex.ru/maps/?text=' + enc(C.full + ', ' + p.addr + ', ' + p.name); };
  /* часы работы (A5): подмножество OSM opening_hours → «пн–чт 12:00–24:00; пт, сб 12:00–02:00; вс выходной»; непонятное — не показываем */
  const OH_D = { Mo: 'пн', Tu: 'вт', We: 'ср', Th: 'чт', Fr: 'пт', Sa: 'сб', Su: 'вс' };
  const OH_PART = /^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:[-,](?:Mo|Tu|We|Th|Fr|Sa|Su))*)\s+(off|closed|\d\d:\d\d-\d\d:\d\d(?:,\d\d:\d\d-\d\d:\d\d)*)$/;
  function hoursOf(p) {
    const oh = String(p.oh || '').trim();
    if (!oh || BAD.test(oh)) return null;
    if (oh === '24/7') return { text: 'круглосуточно', ld: ['Mo-Su 00:00-23:59'] };
    const parts = oh.split(/\s*;\s*/).filter(Boolean), text = [], ld = [];
    for (const part of parts) {
      const m = OH_PART.exec(part);
      if (!m) return null;
      const off = /^(off|closed)$/.test(m[2]);
      text.push(`${m[1].replace(/[A-Z][a-z]/g, d => OH_D[d]).replace(/-/g, '–').replace(/,/g, ', ')} ${off ? 'выходной' : m[2].replace(/-/g, '–').replace(/,/g, ', ')}`);
      if (!off) m[2].split(',').forEach(t => ld.push(`${m[1]} ${t}`));
    }
    return text.length ? { text: text.join('; '), ld } : null;
  }
  /* телефон, сайт и бронь (A8): только официальные — +7…, https://…; без соцсетей */
  const telOf = p => (/^\+\d{10,15}$/.test(p.tel || '') ? p.tel : '');
  const telText = t => (/^\+7\d{10}$/.test(t) ? `+7 (${t.slice(2, 5)}) ${t.slice(5, 8)}-${t.slice(8, 10)}-${t.slice(10)}` : t);
  const urlOf = u => (/^https:\/\/[^\s"'<>]+$/.test(u || '') && !BAD.test(u) ? u : '');
  const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
  /* ссылки «в текущем режиме»: главная запоминает режим в localStorage 'kuda-mode' — «Позвать сюда» и «Открыть в каталоге»
     (a[data-m]) переписываем под него; без хранилища остаётся режим страницы */
  const MODE_JS = `<script>(function(){try{var m=localStorage.getItem('kuda-mode');if(!/^(date|guys|girls)$/.test(m||''))return;` +
    `document.documentElement.setAttribute('data-mode',m);var a=document.querySelectorAll('a[data-m]'),i;` +
    `for(i=0;i<a.length;i++)a[i].setAttribute('href',a[i].getAttribute('href').replace(/([?&](?:m|mode)=)(?:date|guys|girls)/,'$1'+m));}catch(e){}})();</script>`;
  function nearList(list, c, from) {
    return `<ul class="near">${list.map(({ x, d }) => {
      const m = walkMin(from, x), how = m <= 30 ? `≈\u00a0${N(m, W_.minute)} пешком` : `≈\u00a0${(d / 1000).toFixed(1).replace('.', ',')}\u00a0км`;
      return `<li><a href="${esc(href('@m/' + x.id, c))}">${thumb(x.ph, x.emoji, c)}<span class="nm"><b>${esc(x.name)}</b><span>${esc(x.kind)} · ${how}</span></span></a></li>`;
    }).join('')}</ul>`;
  }
  const colCount = col => joinRu(['places', 'plans', 'events'].map(k => [k, col.items.filter(it => it.kind === k).length]).filter(([, n]) => n)
    .map(([k, n]) => N(n, k === 'places' ? W_.place : k === 'plans' ? W_.plan : W_.event)));
  const colChips = (list, c) => `<ul class="rel">${list.map(col => `<li><a href="${esc(href('@podborki/' + col.slug, c))}"><span aria-hidden="true">${esc(col.emoji)}</span> ${esc(col.title)} <span>${esc(colCount(col))}</span></a></li>`).join('')}</ul>`;
  const ldTypeFull = p => { const t = ldType(p); return LOCAL_BIZ.has(t) || t === 'TouristAttraction' ? t : [t, 'TouristAttraction']; };
  function renderPlace(p, closed) {
    const mode = closed ? 'date' : placeMode(p);
    const c = { depth: 3, mode, slug: 'm/' + p.id, near: null, img: 3 };
    const url = pageUrl('m/' + p.id);
    const o = OKR[p.okr] || null, okrSlug = okrSlugOf(p.okr), kindLc = lc1(String(p.kind || 'Место'));
    const near = nearOf(p);
    const crumbs = [['Главная', href('start.html', c), appUrl('start.html')], [C.name, href('#index', c), pageUrl('')], ['Все места', href('@m', c), pageUrl('m')], [p.name, '', url]];
    const relHtml = slugs => { const s = uniqBy(slugs.filter(x => x && BY.has(x)), x => x).slice(0, 8); return s.length ? `<nav class="sec" aria-labelledby="s-rel"><h2 id="s-rel">Ещё подборки</h2><ul class="rel">${s.map(x => relLink(x, c)).join('')}<li><a href="${href('#index', c)}">Все подборки ${esc(C.dat)}</a></li></ul></nav>` : ''; };
    const nearSecs = (h1, h2) => [
      near.same.length ? `<section class="sec" aria-labelledby="s-same"><h2 id="s-same">${esc(h1)}</h2>${nearList(near.same, c, p)}</section>` : '',
      near.other.length ? `<section class="sec" aria-labelledby="s-near"><h2 id="s-near">${esc(h2)}</h2>${nearList(near.other, c, p)}</section>` : '',
    ].join('\n');
    if (closed) {
      // место закрылось: страница остаётся для старых ссылок, но не индексируется; ведём к похожим рядом
      const title = `${p.name}: закрылось`;
      const hero = `<section class="hero"><p class="eyebrow">${esc(p.kind)}${o ? ' · ' + esc(o.short || o.name) : ''}</p><h1>${esc(`${p.name}: место закрылось`)}</h1>` +
        `<p class="lead">${esc(`По нашим данным, ${kindLc} ${q(p.name)}${p.addr ? ` (${p.addr})` : ''} больше не работает, поэтому из каталога и планов мы его убрали. Ниже — похожие места рядом, которые работают.`)}</p>` +
        `<p class="cta"><a class="btn primary" href="${esc(href(placesHref(mode, catOf(p), '', false), c))}">Похожие места в каталоге</a><a class="btn ghost" href="${esc(href('create.html?mode=' + mode, c))}" rel="nofollow">Позвать игрой</a></p></section>`;
      const ld = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage', '@id': url + '#page', url, name: title, inLanguage: 'ru-RU', isPartOf: { '@type': 'WebSite', name: BRAND, url: BASE + 'start.html' }, breadcrumb: { '@id': url + '#breadcrumb' } }, crumbsLd(crumbs, url)] };
      return doc({ depth: 3, url, title: `${title} | ${BRAND}`, desc: `${cap1(kindLc)} ${q(p.name)} ${C.in} закрылось. Похожие места рядом — с адресами, ценами и маршрутом.`, mode, ogImage: '', crumbs, robots: 'noindex, follow',
        body: `${hero}\n${nearSecs('Похожие рядом', 'Что ещё рядом')}\n${relHtml([catSlugOf(p), okrSlug, isMetro(p.metro) ? metroSlugOf(p.metro) : null])}`, ld });
    }
    const plans = sortPlans(plansAt.get(p.id) || []);
    const evs = sortEvents(eventsAt.get(p.id) || []);
    const cols = colsOf.get('places:' + p.id) || [];
    const hours = hoursOf(p), tel = telOf(p), site = urlOf(p.site), book = urlOf(p.book);
    const price = Math.max(1, Math.min(3, p.price || 1));
    const mapU = mapUrlOf(p);
    // факты: адрес, метро, район, цена, часы, телефон, сайт, бронь, когда проверяли
    const facts = [['Адрес', `${esc(p.addr)}<br><a href="${esc(mapU)}" target="_blank" rel="nofollow noopener">Открыть на Яндекс Картах<span class="vh"> (в новой вкладке)</span></a>`]];
    if (p.metro) facts.push([isMetro(p.metro) ? 'Метро' : 'Станция', metroHtml(p.metro, c)]);
    if (o) facts.push([cap1(C.okrOne), okrSlug ? `<a href="${esc(href('@' + okrSlug, c))}">${esc(o.name)}${o.short ? ` (${esc(o.short)})` : ''}</a>` : esc(o.name)]);
    facts.push(['Цена', `<span aria-hidden="true">${'₽'.repeat(price)} · </span>${esc(PRICE_HINT[price])}`]);
    if (hours) facts.push(['Часы работы', esc(hours.text) + (/^\d{4}-\d\d$/.test(p.ohChk || '') ? ` <span class="k">· проверили в ${MON_P[+p.ohChk.slice(5, 7) - 1]} ${p.ohChk.slice(0, 4)}</span>` : '')]);
    if (tel) facts.push(['Телефон', `<a href="tel:${esc(tel)}">${esc(telText(tel))}</a>`]);
    if (site) facts.push(['Сайт', `<a href="${esc(site)}" target="_blank" rel="nofollow noopener">${esc(hostOf(site))}<span class="vh"> (в новой вкладке)</span></a>`]);
    if (book) facts.push(['Бронь', `<a href="${esc(book)}" target="_blank" rel="nofollow noopener">Забронировать на сайте заведения<span class="vh"> (в новой вкладке)</span></a>${p.minBook ? ` <span class="k">· ${esc(clip(p.minBook, 40))}</span>` : ''}`]);
    if (/^\d{4}-\d\d$/.test(p.chk || '')) facts.push(['Проверено', `работает — проверили в ${MON_P[+p.chk.slice(5, 7) - 1]} ${p.chk.slice(0, 4)}`]);
    const factsHtml = `<section class="sec" aria-labelledby="s-info"><h2 id="s-info">Адрес и детали</h2><dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl></section>`;
    const stats = [`${'₽'.repeat(price)} · ${PRICE_HINT[price]}`, p.mich && C.mich[p.mich] ? C.mich[p.mich] : '', is247(p) ? 'Круглосуточно' : '', isNew(p) ? 'Новое в каталоге' : '',
      plans.length ? `в ${N(plans.length, ['плане', 'планах', 'планах'])}` : '', evs.length ? N(evs.length, W_.event) + ' в афише' : ''].filter(Boolean);
    const ph = p.ph;
    const photo = ph ? `<figure class="pph"><img src="${esc(href(ph.s, c))}" width="720" height="450" alt="${esc(`${p.name}, ${kindLc}`)}" fetchpriority="high" decoding="async"><figcaption>${credit(ph)}</figcaption></figure>\n` : '';
    const hero = `<section class="hero"><p class="eyebrow">${esc(p.kind)}${o ? ' · ' + esc(o.short || o.name) : ''}</p><h1>${esc(p.name)}</h1>${p.note ? `<p class="lead">${esc(p.note)}</p>` : ''}` +
      `<ul class="stats" aria-label="Коротко">${stats.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` +
      `<p class="cta"><a class="btn primary" data-m href="${esc(href(L.invPlace(p.id, mode), c))}" rel="nofollow">Позвать сюда<span class="vh">: ${esc(p.name)}</span></a>` +
      `<a class="btn ghost" data-m href="${esc(href(L.place(p.id, mode), c))}">Открыть в каталоге<span class="vh">: ${esc(p.name)}</span></a>` +
      `<a class="btn ghost" href="${esc(href(L.go(p.id), c))}" rel="nofollow">Маршрут до места<span class="vh">: ${esc(p.name)}</span></a></p></section>`;
    let i = 0;
    const secs = [
      sec('plans', 'Планы с этим местом', plans, 6, { href: L.place(p.id, mode), text: 'Ещё планы — в карточке места' }),
      sec('events', 'Афиша площадки', evs, 6, moreEvents(mode)),
    ].filter(Boolean).map(s => renderSection(s, c, i++)).join('\n');
    const colsHtml = cols.length ? `<section class="sec" aria-labelledby="s-cols"><h2 id="s-cols">Входит в подборки</h2>${colChips(cols.slice(0, 3), c)}</section>` : '';
    const rel = relHtml([catSlugOf(p), isView(p) ? 'krishi-i-panoramy' : null, isRink(p) ? 'katki' : null, isSportsBar(p) ? 'futbol' : null, has(p, 'first') ? 'pervoe-svidanie' : null,
      has(p, 'autumn') ? 'osen' : null, isMetro(p.metro) ? metroSlugOf(p.metro) : null, p.c === 'pc' && isMetro(p.metro) ? pcMetroSlug(p.metro) : null, okrSlug]);
    const title = `${p.name} — ${kindLc} ${C.in}${isMetro(p.metro) ? `, м.\u00a0${p.metro}` : ''}`;
    const desc = clip(`${cap1(kindLc)} ${q(p.name)} ${C.in}: ${p.addr}${p.metro ? `, ${metroText(p.metro)}` : ''}. ${p.note || ''} ${PRICE_HINT[price] ? `Цена — ${PRICE_HINT[price]}.` : ''}`, 200);
    const place = ldPlace(p);
    place['@type'] = ldTypeFull(p);
    place['@id'] = url + '#place';
    place.url = site || url;
    place.hasMap = mapU;
    if (tel) place.telephone = tel;
    if (hours && hours.ld.length) place.openingHours = hours.ld;
    place.mainEntityOfPage = { '@id': url + '#page' };
    const ld = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', '@id': url + '#page', url, name: title, description: desc, inLanguage: 'ru-RU', isPartOf: { '@type': 'WebSite', name: BRAND, url: BASE + 'start.html' }, breadcrumb: { '@id': url + '#breadcrumb' }, mainEntity: { '@id': url + '#place' }, ...(ph ? { primaryImageOfPage: { '@type': 'ImageObject', url: BASE + ph.s } } : {}) },
        crumbsLd(crumbs, url),
        place,
      ],
    };
    return doc({ depth: 3, url, title: `${title} | ${BRAND}`, desc, mode, ogImage: '', crumbs, events: evs.length > 0, tail: MODE_JS,
      body: `${photo}${hero}\n${factsHtml}\n${secs}\n${colsHtml}\n${nearSecs('Похожие рядом', 'Что ещё рядом')}\n${rel}\n${HOW}`, ld });
  }
  /* — все места города от А до Я: m/ — */
  const AZ = [['food', 'Рестораны и кафе'], ['coffee', 'Кофейни и пекарни'], ['bar', 'Бары'], ['museum', 'Музеи и галереи'], ['theatre', 'Театры'], ['culture', 'Культура'],
    ['walk', 'Прогулки'], ['fun', 'Развлечения'], ['spa', 'Бани и спа'], ['books', 'Книжные'], ['pc', 'Компьютерные клубы']];
  function renderPlacesIndex() {
    const c = { depth: 2, mode: 'date', img: 0 };
    const url = pageUrl('m');
    const crumbs = [['Главная', href('start.html', c), appUrl('start.html')], [C.name, href('#index', c), pageUrl('')], ['Все места', '', url]];
    const groups = [...AZ, ['other', 'Другое']].map(([k, label]) => [k, label, MP.filter(p => (AZ.some(a => a[0] === SUB(p)) ? SUB(p) : 'other') === k)
      .sort((a, b) => coll.compare(sortKey(a.name), sortKey(b.name)) || cmp(a.id, b.id))]).filter(g => g[2].length);
    const toc = `<nav class="sec" aria-label="Разделы"><ul class="rel">${groups.map(([k, label, list]) => `<li><a href="#g-${k}">${esc(label)} <span>${num(list.length)}</span></a></li>`).join('')}</ul></nav>`;
    const secs = groups.map(([k, label, list]) => `<section class="sec" aria-labelledby="g-${k}"><h2 id="g-${k}">${esc(label)} <span class="n">${list.length}</span></h2>` +
      `<ul class="az">${list.map(p => `<li><a href="${esc(p.id)}/">${esc(p.name)}</a>${p.metro ? ` <span>${esc(metroText(p.metro))}</span>` : ''}</li>`).join('')}</ul></section>`).join('\n');
    const h1 = `Все места ${C.gen} от А до Я`;
    const lead = `${cap1(N(MP.length, W_.place))} ${C.in} и рядом: ${breakdown(MP)}. У каждого — своя страница: адрес, метро, цена, готовые планы с этим местом и что есть рядом. Места 18+ и закрывшиеся сюда не попадают.`;
    const hero = `<section class="hero"><p class="eyebrow">${esc(C.name)} · каталог</p><h1>${esc(h1)}</h1><p class="lead">${esc(lead)}</p>` +
      `<p class="cta"><a class="btn primary" href="${esc(href(placesHref('date', '', '', true), c))}">Все места на карте</a><a class="btn ghost" href="${href('#index', c)}">Подборки ${esc(C.dat)}</a></p></section>`;
    const ld = { '@context': 'https://schema.org', '@graph': [
      { '@type': 'CollectionPage', '@id': url + '#page', url, name: h1, description: lead, inLanguage: 'ru-RU', isPartOf: { '@type': 'WebSite', name: BRAND, url: BASE + 'start.html' }, breadcrumb: { '@id': url + '#breadcrumb' } },
      crumbsLd(crumbs, url)] };
    return doc({ depth: 2, url, title: `${h1}: ${N(MP.length, W_.place)} с адресами и ценами | ${BRAND}`, desc: clip(`Каталог ${C.gen}: ${breakdown(MP, 3)}. Адреса, метро, цены, планы и что рядом — у каждого места своя страница.`, 200), mode: 'date', ogImage: '', crumbs, body: `${hero}\n${toc}\n${secs}`, ld });
  }

  /* ---------- подборки редакции: podborki/ и podborki/<slug>/ ---------- */
  function colPrice(col) {
    const ps = col.items.flatMap(it => (it.kind === 'places' ? [it.x] : it.kind === 'plans' ? it.x.st : []));
    if (!ps.length) return '';
    const m = Math.max(...ps.map(p => p.price || 1));
    return m <= 1 ? 'до 1 500 ₽ на человека' : m <= 2 ? 'до 3 000 ₽ на человека' : '';
  }
  const itAny = (it, c) => (it.kind === 'plans' ? itPlan(it.x, c) : it.kind === 'events' ? itEvent(it.x, c) : itPlace(it.x, c));
  function renderCol(col) {
    const c = { depth: 3, mode: col.mode, slug: 'podborki/' + col.slug, near: null, img: 0 };
    const url = pageUrl('podborki/' + col.slug);
    const n = colCount(col);
    const named = /москв|петербург|питер|спб/i.test(col.title);
    const title = `${col.title}${named ? '' : ' ' + C.in}: ${n}`;
    const desc = clip(col.lead || `${col.title} ${C.in}: ${n} — адреса, цены и маршрут. Выбери и позови игрой или голосованием.`, 200);
    const crumbs = [['Главная', href('start.html', c), appUrl('start.html')], [C.name, href('#index', c), pageUrl('')], ['Подборки редакции', href('@podborki', c), pageUrl('podborki')], [col.title, '', url]];
    // ?col= на главной и в конструкторе — когда они это умеют (A1), иначе — обычные кнопки
    const app = COL_HUB ? { href: `start.html?col=${enc(col.id)}&m=${col.mode}`, text: 'Открыть в приложении' } : { href: `start.html?m=${col.mode}`, text: 'Все планы' };
    const inv = COL_CREATE ? { href: `create.html?col=${enc(col.id)}&mode=${col.mode}`, text: 'Позвать по подборке' } : { href: `create.html?mode=${col.mode}`, text: col.mode === 'date' ? 'Позвать игрой' : 'Собрать компанию' };
    const stats = [n, colPrice(col), col.until ? `до ${dm(col.until)}` : ''].filter(Boolean);
    const hero = `<section class="hero"><p class="eyebrow">Подборка редакции · ${esc(C.name)}</p><h1><span aria-hidden="true">${esc(col.emoji)}</span> ${esc(col.title)}</h1>` +
      `<p class="lead">${esc(col.lead || `${cap1(n)}: адреса, цены и маршрут. Выбери вариант и позови игрой или голосованием.`)}</p>` +
      `<ul class="stats" aria-label="Коротко">${stats.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` +
      `<p class="cta"><a class="btn primary" href="${esc(href(inv.href, c))}" rel="nofollow">${esc(inv.text)}</a><a class="btn ghost" href="${esc(href(app.href, c))}">${esc(app.text)}</a></p></section>`;
    const parts = col.secs.length ? col.secs : [{ t: 'Что в подборке', items: col.items }];
    const secs = parts.map((s, i) => `<section class="sec" aria-labelledby="s${i + 1}"><h2 id="s${i + 1}">${esc(s.t)} <span class="n">${s.items.length}</span></h2>` +
      `<ol class="list">${s.items.map(it => itAny(it, c)).join('')}</ol></section>`).join('\n');
    const cal = col.ics ? calBlock(calSec(`podborki/${col.slug}/calendar.ics`, 'События подборки в календаре', 'Даты и время событий из подборки — в твоём календаре. Подпишись, и новые даты появятся сами.', `события подборки «${col.title}»`), c, 's-cal') : '';
    const others = COLS.filter(x => x !== col);
    const rel = `<nav class="sec" aria-labelledby="s-rel"><h2 id="s-rel">Ещё подборки редакции</h2>${others.length ? colChips(others.slice(0, 8), c) : ''}<p class="more"><a class="btn ghost" href="${esc(href('@podborki', c))}">Все подборки редакции ${esc(C.in)}</a></p></nav>`;
    const items = col.items.map(it => (it.kind === 'places' ? ldPlace(it.x) : it.kind === 'plans' ? ldPlan(it.x) : ldEvent(it.x)));
    const ld = { '@context': 'https://schema.org', '@graph': [
      { '@type': 'CollectionPage', '@id': url + '#page', url, name: col.title, description: desc, inLanguage: 'ru-RU', isPartOf: { '@type': 'WebSite', name: BRAND, url: BASE + 'start.html' }, breadcrumb: { '@id': url + '#breadcrumb' }, mainEntity: { '@id': url + '#list' } },
      crumbsLd(crumbs, url),
      { '@type': 'ItemList', '@id': url + '#list', name: col.title, numberOfItems: items.length, itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, item: it })) }] };
    return doc({ depth: 3, url, title: `${title} | ${BRAND}`, desc, mode: col.mode, ogImage: '', crumbs, events: col.items.some(it => it.kind === 'events'), body: `${hero}\n${secs}\n${cal}\n${rel}\n${HOW}`, ld });
  }
  function renderColsIndex() {
    const c = { depth: 2, mode: 'date', img: 0 };
    const url = pageUrl('podborki');
    const crumbs = [['Главная', href('start.html', c), appUrl('start.html')], [C.name, href('#index', c), pageUrl('')], ['Подборки редакции', '', url]];
    const h1 = `Подборки редакции ${C.in}`;
    const lead = `${cap1(N(COLS.length, ['подборка', 'подборки', 'подборок']))}, которые мы собрали сами: места, готовые планы и события на одну тему. Открой любую и позови по ней — игрой на свидание или голосованием для компании.`;
    const list = `<section class="sec" aria-labelledby="s1"><h2 id="s1" class="vh">Подборки</h2><ol class="list">${COLS.map(col => `<li class="it"><div class="hd"><span class="th" aria-hidden="true">${esc(col.emoji)}</span><div class="ti"><h3><a href="${esc(col.slug)}/">${esc(col.title)}</a></h3>` +
      `<p class="meta">${esc([colCount(col), colPrice(col), col.until ? `до ${dm(col.until)}` : ''].filter(Boolean).join(' · '))}</p></div></div>${col.lead ? `<p class="nt">${esc(clip(col.lead, 180))}</p>` : ''}</li>`).join('')}</ol></section>`;
    const hero = `<section class="hero"><p class="eyebrow">${esc(C.name)} · ${N(COLS.length, ['подборка', 'подборки', 'подборок'])}</p><h1>${esc(h1)}</h1><p class="lead">${esc(lead)}</p></section>`;
    const ld = { '@context': 'https://schema.org', '@graph': [
      { '@type': 'CollectionPage', '@id': url + '#page', url, name: h1, description: lead, inLanguage: 'ru-RU', isPartOf: { '@type': 'WebSite', name: BRAND, url: BASE + 'start.html' }, breadcrumb: { '@id': url + '#breadcrumb' }, mainEntity: { '@id': url + '#list' } },
      crumbsLd(crumbs, url),
      { '@type': 'ItemList', '@id': url + '#list', numberOfItems: COLS.length, itemListElement: COLS.map((col, i) => ({ '@type': 'ListItem', position: i + 1, name: col.title, url: pageUrl('podborki/' + col.slug) })) }] };
    return doc({ depth: 2, url, title: `${h1}: бани, бары, свидания и выходные | ${BRAND}`, desc: clip(`${h1}: ${COLS.slice(0, 4).map(x => x.title).join(', ')}. Места, планы и события на одну тему — с адресами, ценами и маршрутом.`, 200), mode: 'date', ogImage: '', crumbs, body: `${hero}\n${list}\n${HOW}`, ld });
  }

  function renderPage(pg) {
    const c = { depth: 2, mode: pg.mode, slug: pg.slug, near: pg.near || null, img: 0 };
    const url = pageUrl(pg.slug);
    // цепочка: станция метро — внутри своего округа, клубы — внутри общей подборки клубов
    const parent = pg.group === 'pc' ? 'kompyuternye-kluby' : pg.group === 'metro' ? (okrPages.find(x => x.okr === pg.okr) || {}).slug : null;
    // «Главная» — каталог своего города, как и ссылка в цепочке на странице (у Петербурга — start.html?city=spb)
    const crumbs = [['Главная', href('start.html', c), appUrl('start.html')], [C.name, href('#index', c), pageUrl('')],
      ...(parent && BY.has(parent) ? [[BY.get(parent).label, href('@' + parent, c), pageUrl(parent)]] : []),
      [pg.group === 'metro' ? 'У метро ' + pg.label : pg.group === 'pc' && pg.station ? 'У метро ' + pg.station.name : pg.label, '', url]];
    const stats = pg.stats.filter(Boolean).map(x => `<li>${esc(x)}</li>`).join('');
    const hero = `<section class="hero"><p class="eyebrow">${esc(pg.eyebrow)}</p><h1>${esc(pg.h1)}</h1><p class="lead">${esc(pg.lead)}</p>${stats ? `<ul class="stats" aria-label="Коротко">${stats}</ul>` : ''}` +
      `<p class="cta"><a class="btn primary" href="${esc(href(pg.app.href, c))}">${esc(pg.app.text)}</a>${pg.invite ? `<a class="btn ghost" href="${esc(href(pg.invite.href, c))}" rel="nofollow">${esc(pg.invite.text)}</a>` : ''}</p></section>`;
    const secs = pg.sections.map((s, i) => renderSection(s, c, i)).join('\n');
    const rel = pg.related.length ? `<nav class="sec" aria-labelledby="s-rel"><h2 id="s-rel">Ещё подборки</h2><ul class="rel">${pg.related.map(s => relLink(s, c)).join('')}<li><a href="${href('#index', c)}">Все подборки ${esc(C.dat)}</a></li></ul></nav>` : '';
    const items = [];
    pg.sections.forEach(s => s.items.forEach(x => { if (s.kind === 'places') items.push(ldPlace(x)); else if (s.kind === 'plans') items.push(ldPlan(x)); else if (s.kind === 'events') items.push(ldEvent(x)); }));
    const ld = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'CollectionPage', '@id': url + '#page', url, name: pg.h1, description: pg.desc, inLanguage: 'ru-RU', isPartOf: { '@type': 'WebSite', name: BRAND, url: BASE + 'start.html' }, breadcrumb: { '@id': url + '#breadcrumb' }, mainEntity: { '@id': url + '#list' } },
        crumbsLd(crumbs, url),
        { '@type': 'ItemList', '@id': url + '#list', name: pg.h1, numberOfItems: items.length, itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, item: it })) },
      ],
    };
    return doc({ depth: 2, url, title: `${pg.title} | ${BRAND}`, desc: pg.desc, mode: pg.mode, ogImage: '', crumbs, events: pg.sections.some(s => s.kind === 'events'), body: `${hero}\n${secs}\n${rel}\n${HOW}`, ld });
  }
  function renderIndex() {
    const c = { depth: 1, mode: 'date', img: 0 };
    const url = pageUrl('');
    const crumbs = [['Главная', href('start.html', c), appUrl('start.html')], [C.name, '', url]];
    const groups = GROUPS.map(([g], i) => {
      const list = PAGES.filter(p => p.group === g);
      if (!list.length) return '';
      return `<section class="sec" aria-labelledby="g${i}"><h2 id="g${i}">${esc(groupLabel(g))} <span class="n">${list.length}</span></h2><ul class="idx">${list.map(p => `<li><a href="${p.slug}/">${esc(p.group === 'metro' ? 'м. ' + p.label : p.group === 'pc' && p.station ? 'у м. ' + p.station.name : p.label)}${countText(p) ? ` <span>${esc(countText(p))}</span>` : ''}</a></li>`).join('')}</ul></section>`;
    }).join('\n');
    const total = { places: VP.length, plans: PLANS.length, events: EVENTS.length };
    const lead = `${cap1(N(total.places, W_.place))}, ${N(total.plans, W_.readyPlan)} и ${N(total.events, W_.event)} в афише — разложили по поводам, сезонам, ${C.okrPl} и станциям метро. В каждой подборке есть адреса, цены, маршрут и кнопка «Позвать сюда»: приглашение-игра для свидания или голосование для компании.`;
    const hero = `<section class="hero"><p class="eyebrow">${esc(C.name)} · ${N(PAGES.length, ['подборка', 'подборки', 'подборок'])}</p><h1>${esc(`Куда сходить ${C.in}: все подборки`)}</h1><p class="lead">${esc(lead)}</p>` +
      `<p class="cta"><a class="btn primary" href="${href('start.html', c)}">Открыть все планы</a><a class="btn ghost" href="${href('create.html', c)}" rel="nofollow">Позвать игрой</a></p></section>`;
    const ld = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'CollectionPage', '@id': url + '#page', url, name: `Куда сходить ${C.in}: все подборки`, inLanguage: 'ru-RU', isPartOf: { '@type': 'WebSite', name: BRAND, url: BASE + 'start.html' }, breadcrumb: { '@id': url + '#breadcrumb' }, mainEntity: { '@id': url + '#list' } },
        crumbsLd(crumbs, url),
        { '@type': 'ItemList', '@id': url + '#list', numberOfItems: PAGES.length, itemListElement: PAGES.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.h1, url: pageUrl(p.slug) })) },
      ],
    };
    return doc({ depth: 1, url, title: `Куда сходить ${C.in}: подборки по поводам, районам и метро | ${BRAND}`, desc: `${cap1(N(total.places, W_.place))} и ${N(total.plans, W_.readyPlan)} ${C.in}: свидание, друзья, девичник, афиша, ${C.okrNom} и станции метро. Выбери подборку и позови игрой.`, mode: 'date', ogImage: '', crumbs, body: `${hero}\n${groups}\n${HOW}`, ld });
  }

  /* файлы города: стиль, подборки, оглавление; others — все собранные города (для ссылок между ними) */
  function render(all, files) {
    OTHERS = all.filter(b => b.C !== C);
    files.set(C.out + '/seo.css', cssOf(C));
    PAGES.sort((a, b) => GROUPS.findIndex(g => g[0] === a.group) - GROUPS.findIndex(g => g[0] === b.group));
    // календари считаем до страниц: у подборки с событиями на странице — блок «Подписаться» (col.ics)
    const weekend = buildIcs();
    if (weekend) files.set(C.out + '/weekend.ics', weekend);
    for (const pg of PAGES) files.set(`${C.out}/${pg.slug}/index.html`, renderPage(pg));
    files.set(C.out + '/index.html', renderIndex());
    // своя страница у каждого места (A10) и «Закрылось» с noindex у закрытых
    for (const p of MP) files.set(`${C.out}/m/${p.id}/index.html`, renderPlace(p));
    for (const p of CLOSED) files.set(`${C.out}/m/${p.id}/index.html`, renderPlace(p, true));
    if (MP.length) files.set(C.out + '/m/index.html', renderPlacesIndex());
    // подборки редакции (A1)
    for (const col of COLS) {
      files.set(`${C.out}/podborki/${col.slug}/index.html`, renderCol(col));
      if (col.ics) files.set(`${C.out}/podborki/${col.slug}/calendar.ics`, col.ics);
    }
    if (COLS.length) files.set(C.out + '/podborki/index.html', renderColsIndex());
  }
  return { C, PAGES, VP, PLANS, EVENTS, DATA_DATE, groupLabel, pageUrl, render, MP, COLS };
}

/* ---------- стили подборок ---------- */
const CSS = `/* Подборки «Куда идём?» (@OUT/**) — стиль «Ночной город», как на главной.
   Файл пишет scripts/build-seo.mjs — правь там, иначе следующий запуск перезапишет. */
:root {
  --bg: #0F0E13; --surface: #1A1920; --surface-2: #22212A; --surface-3: #2A2932;
  --line: rgba(244, 241, 234, .08); --line-2: rgba(244, 241, 234, .16);
  --text: #F4F1EA; --muted: #A39EAE; --muted-2: #C9C5D2;
  --accent: #FF6F91; --on-accent: #1C0A10; --glow: rgba(255, 111, 145, .28);
  --display: 'Unbounded', 'Arial Black', system-ui, sans-serif;
  --body: 'Onest', system-ui, -apple-system, 'Segoe UI', sans-serif;
  color-scheme: dark;
}
html[data-mode="guys"] { --accent: #D7F25C; --on-accent: #15170A; --glow: rgba(215, 242, 92, .24); }
html[data-mode="girls"] { --accent: #B9A1FF; --on-accent: #17102A; --glow: rgba(185, 161, 255, .28); }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; background: var(--bg); }
body { margin: 0 auto; max-width: 760px; min-height: 100vh; padding: 0 max(16px, env(safe-area-inset-right)) calc(32px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); font: 400 16px/1.5 var(--body); color: var(--text); background: var(--bg); -webkit-font-smoothing: antialiased; overflow-wrap: break-word; }
@media (min-width: 480px) { body { padding-left: max(20px, env(safe-area-inset-left)); padding-right: max(20px, env(safe-area-inset-right)); } }
a { color: var(--accent); }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 8px; }
.vh { position: absolute !important; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.skip { position: absolute; left: 12px; top: -80px; z-index: 9; padding: 10px 14px; border-radius: 12px; background: var(--accent); color: var(--on-accent); font-weight: 700; text-decoration: none; }
.skip:focus { top: 12px; }
[hidden] { display: none !important; }
.stale { margin: 0 0 12px; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--line-2); background: var(--surface-2); font-size: 14px; line-height: 1.45; color: var(--muted-2); }

.top { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: calc(16px + env(safe-area-inset-top)) 0 4px; }
.logo { display: flex; align-items: center; gap: 10px; min-height: 44px; color: var(--text); text-decoration: none; font: 700 19px var(--display); letter-spacing: -.02em; }
.logo svg { flex: none; width: 22px; height: 22px; color: var(--accent); }
.city { display: inline-flex; align-items: center; min-height: 40px; padding: 0 14px; border-radius: 99px; border: 1px solid var(--line-2); color: var(--text); font-size: 14px; font-weight: 500; text-decoration: none; }
.crumbs ol { display: flex; flex-wrap: wrap; gap: 2px 6px; margin: 14px 0 12px; padding: 0; list-style: none; font-size: 13px; color: var(--muted); }
.crumbs li + li::before { content: '/'; margin-right: 6px; opacity: .5; }
.crumbs a { color: var(--muted-2); text-underline-offset: 3px; }

.hero { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 12px; padding: 22px 18px 20px; border-radius: 26px; border: 1px solid var(--line);
  background-color: var(--surface); background-image: linear-gradient(rgba(244, 241, 234, .045) 1px, transparent 1px), linear-gradient(90deg, rgba(244, 241, 234, .045) 1px, transparent 1px); background-size: 26px 26px; }
.hero::before { content: ''; position: absolute; right: -70px; top: -80px; width: 260px; height: 260px; border-radius: 50%; background: radial-gradient(closest-side, var(--glow), transparent); pointer-events: none; }
.hero > * { position: relative; margin: 0; }
.eyebrow { font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); }
h1 { font: 700 26px/1.12 var(--display); letter-spacing: -.02em; text-wrap: balance; }
.lead { max-width: 620px; font-size: 15px; line-height: 1.55; color: #B3AEBE; }
.stats { display: flex; flex-wrap: wrap; gap: 8px; padding: 0; list-style: none; }
.stats li { padding: 6px 11px; border-radius: 99px; background: var(--surface-2); font-size: 13px; font-weight: 600; color: var(--muted-2); }
.cta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px !important; }
.btn { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 20px; border-radius: 16px; border: 1px solid transparent; font: 700 15px var(--body); text-align: center; text-decoration: none; }
.btn.primary { background: var(--accent); color: var(--on-accent); }
.btn.ghost { border-color: var(--line-2); color: var(--text); font-weight: 600; }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.cta .btn { flex: 1 1 200px; }
@media (min-width: 620px) { .hero { padding: 30px; } h1 { font-size: 34px; } }

.sec { margin-top: 30px; }
.sec h2 { margin: 0 0 14px; font: 500 19px/1.25 var(--display); letter-spacing: -.01em; }
.sec h2 .n { font: 500 13px var(--body); letter-spacing: 0; color: var(--muted); }
.sn { margin: -6px 0 14px; font-size: 14px; color: var(--muted); }
.list { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.it { padding: 14px; border-radius: 18px; border: 1px solid var(--line); background: var(--surface); }
.hd { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 12px; align-items: center; }
.ti { min-width: 0; }
.th { display: grid; place-items: center; width: 56px; height: 56px; overflow: hidden; border-radius: 14px; background: var(--surface-2); font-size: 26px; line-height: 1; }
.th img { display: block; width: 100%; height: 100%; object-fit: cover; }
.th.dt { align-content: center; gap: 3px; background: var(--surface-3); font: 600 11px/1 var(--body); letter-spacing: .06em; text-transform: uppercase; color: var(--accent); }
.th.dt b { font: 700 20px/1 var(--display); letter-spacing: 0; color: var(--text); }
.it h3 { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.3; }
.it h3 a { color: var(--text); text-decoration: none; }
.it h3 a:hover { text-decoration: underline; text-underline-offset: 3px; }
.meta, .ad { margin: 4px 0 0; font-size: 13px; line-height: 1.4; color: var(--muted); }
.ad { margin-top: 10px; }
.meta a, .ad a, .stops a { color: var(--muted-2); text-underline-offset: 2px; }
.pr { font-weight: 600; color: var(--muted-2); }
.tgs { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; }
.tg { padding: 3px 8px; border-radius: 99px; background: var(--surface-2); font-size: 12px; font-weight: 600; color: var(--muted-2); }
.tg.mich { background: rgba(230, 57, 70, .16); color: #FF7A84; }
.tg.new { background: var(--glow); color: var(--text); }
.nt { margin: 8px 0 0; font-size: 14px; line-height: 1.5; color: var(--muted-2); }
.stops { display: grid; gap: 6px; margin: 10px 0 0; padding: 0; list-style: none; font-size: 14px; line-height: 1.35; }
.stops li { position: relative; padding-left: 18px; }
.stops li::before { content: ''; position: absolute; left: 1px; bottom: 5px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
.stops li + li::before { background: transparent; box-shadow: inset 0 0 0 2px var(--accent); }
.stops .k { color: var(--muted); }
.stops .wk { display: block; margin-bottom: 2px; font-size: 12px; color: var(--muted); }
.act { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 0; }
.act a { flex: 1 1 auto; display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line-2); color: var(--text); font-size: 14px; font-weight: 600; text-decoration: none; }
.act a:hover { border-color: var(--muted); }
.act a.pri { border-color: transparent; background: var(--accent); color: var(--on-accent); }
.cr { margin: 8px 0 0; font-size: 11px; line-height: 1.35; color: var(--muted); }
.cr a { color: inherit; }
.more { margin: 14px 0 0; }
.more .btn { width: 100%; }
.rel { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
.rel a { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 14px; border-radius: 99px; border: 1px solid var(--line-2); background: var(--surface); color: var(--text); font-size: 14px; font-weight: 600; text-decoration: none; }
.rel a span { font-weight: 500; color: var(--muted); }
.rel a:hover { border-color: var(--muted); }
.idx { display: grid; grid-template-columns: 1fr; gap: 8px; margin: 0; padding: 0; list-style: none; }
@media (min-width: 560px) { .idx { grid-template-columns: 1fr 1fr; } }
.idx a { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; min-height: 48px; padding: 13px 14px; border-radius: 14px; border: 1px solid var(--line); background: var(--surface); color: var(--text); font-weight: 600; text-decoration: none; }
.idx a span { flex: none; font-size: 13px; font-weight: 500; color: var(--muted); }
.idx a:hover { border-color: var(--line-2); }
.how ol { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; counter-reset: s; }
.how li { counter-increment: s; display: grid; grid-template-columns: 34px 1fr; gap: 12px; align-items: start; padding: 14px; border-radius: 18px; border: 1px solid var(--line); background: var(--surface); font-size: 15px; line-height: 1.45; color: var(--muted-2); }
.how li::before { content: counter(s); display: grid; place-items: center; width: 34px; height: 34px; border-radius: 12px; background: var(--surface-3); color: var(--accent); font: 700 15px var(--display); }
.how b { color: var(--text); }
.foot { margin-top: 36px; padding-top: 18px; border-top: 1px solid var(--line); text-align: center; font-size: 12px; line-height: 1.6; color: var(--muted); }
.foot p { margin: 8px 0 0; }
.fl { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 16px; }
.fl a { display: inline-flex; align-items: center; min-height: 32px; color: var(--muted-2); font-size: 13px; font-weight: 500; text-underline-offset: 3px; }
`;
/* стиль города: тот же CSS, в шапке — папка города; версия в ссылке на стиль меняется только вместе с файлом */
const cssOf = C => CSS.replace('@OUT', C.out);
const cssVersionOf = C => sha(cssOf(C)).slice(0, 8);

/* ---------- сборка: города, файлы, манифесты, sitemap.xml, robots.txt ---------- */
const BUILT = [], SKIPPED = [];
for (const cid of CITY_IDS) { const b = buildCity(cid); if (b) BUILT.push(b); else SKIPPED.push(CITIES[cid]); }
const files = new Map();   // путь от корня → содержимое
for (const b of BUILT) b.render(BUILT, files);

/* самопроверка: правило про мессенджеры, разметка JSON-LD, «undefined» в тексте */
for (const [f, html] of files) {
  if (BAD.test(html)) fail(`${f}: в тексте есть упоминание Telegram/Instagram — так нельзя`);
  if (/\bundefined\b|\bNaN\b|\[object Object\]/.test(html)) fail(`${f}: в тексте «undefined»/«NaN» — ошибка в шаблоне`);
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch (e) { fail(`${f}: JSON-LD не разбирается (${e.message})`); }
  }
}

const DIRS = Object.values(CITIES).map(C => C.out);
const manOf = C => C.out + '/.generated.json';
const old = { files: {}, static: {} };
for (const C of Object.values(CITIES)) {
  try {
    const m = JSON.parse(outRead(manOf(C)));
    Object.assign(old.files, m.files || {});
    if (C === MAIN && m.static) old.static = m.static;
  } catch (e) { /* первый запуск */ }
}
const SAFE = new RegExp(`^(${DIRS.join('|')})\\/(seo\\.css|index\\.html|weekend\\.ics|[a-z0-9-]+\\/index\\.html|(m|podborki)\\/[a-z0-9-]+\\/(index\\.html|calendar\\.ics))$`);
const NOTE = 'Список файлов, которые создаёт scripts/build-seo.mjs (для удаления устаревших и <lastmod> в sitemap.xml). Не править руками.';
const mans = new Map(BUILT.map(b => [b.C.out, b.C === MAIN ? { note: NOTE, site: BASE, files: {}, static: {} } : { note: NOTE, site: BASE, files: {} }]));
const stat = { added: [], changed: [], same: 0, removed: [] };
for (const [f, content] of files) {
  const man = mans.get(f.split('/')[0]);
  const h = sha(content), prev = old.files[f];
  const onDisk = outExists(f) ? outRead(f) : null;
  const same = onDisk === content;
  man.files[f] = { sha: h, lastmod: same && prev && prev.sha === h && isYmd(prev.lastmod) ? prev.lastmod : TODAY };
  if (same) { stat.same++; continue; }
  (onDisk == null ? stat.added : stat.changed).push(f);
  if (!DRY) { fs.mkdirSync(path.dirname(outAbs(f)), { recursive: true }); fs.writeFileSync(outAbs(f), content); }
}
/* устаревшие страницы: из прошлых манифестов, а если они потеряны — по метке generator внутри файла
   (в том числе всё в папке города, который больше не собирается) */
const stale = new Set(Object.keys(old.files).filter(f => !files.has(f) && SAFE.test(f)));
const ours = f => outExists(f) && outRead(f).includes(`<meta name="generator" content="${GEN_MARK}">`);
for (const dir of DIRS) {
  try {
    for (const d of fs.readdirSync(outAbs(dir), { withFileTypes: true })) {
      const f = `${dir}/${d.name}/index.html`;
      if (d.isDirectory() && !files.has(f) && SAFE.test(f) && ours(f)) stale.add(f);
      if (d.isDirectory() && (d.name === 'm' || d.name === 'podborki')) {
        for (const e of fs.readdirSync(outAbs(`${dir}/${d.name}`), { withFileTypes: true })) {
          const g = `${dir}/${d.name}/${e.name}/index.html`;
          if (e.isDirectory() && !files.has(g) && SAFE.test(g) && ours(g)) stale.add(g);
        }
      }
    }
    if (!files.has(`${dir}/index.html`) && ours(`${dir}/index.html`)) stale.add(`${dir}/index.html`);
  } catch (e) { /* папки ещё нет */ }
}
for (const f of [...stale].sort()) {
  if (!outExists(f)) continue;
  stat.removed.push(f);
  if (DRY) continue;
  fs.unlinkSync(outAbs(f));
  const dir = path.dirname(outAbs(f));
  if (!DIRS.some(d => dir === outAbs(d))) { try { fs.rmdirSync(dir); } catch (e) { /* в папке есть что-то ещё — оставляем */ } }
}
/* город больше не собирается: его страницы удалены выше, убираем манифест и пустую папку */
if (!DRY) {
  for (const C of SKIPPED) {
    if (!outExists(manOf(C))) continue;
    fs.unlinkSync(outAbs(manOf(C)));
    try { fs.rmdirSync(outAbs(C.out)); } catch (e) { /* там есть чужие файлы — оставляем */ }
  }
}

/* статические страницы сайта: в sitemap только индексируемые; lastmod — когда менялся файл (у главной — ещё и данные).
   start.html?city=spb — каталог Петербурга на главной: отдельный адрес, пока у главной нет canonical. */
const DATA_FILES = ['assets/places.js', 'assets/places-spb.js', 'assets/events.js', 'assets/events-spb.js', 'assets/sport.js', 'assets/auto.js', 'assets/photos.js'];
const BUILT_IDS = new Set(BUILT.map(b => b.C.id));
const STATIC = [
  { file: 'start.html', deps: DATA_FILES, priority: '1.0', changefreq: 'daily' },
  { file: 'start.html', query: '?m=guys', priority: '0.9', changefreq: 'weekly', variant: true },
  { file: 'start.html', query: '?m=girls', priority: '0.9', changefreq: 'weekly', variant: true },
  // каталог Петербурга меняется вместе с его данными (и общими auto.js, photos.js), а не с московскими
  { file: 'start.html', query: '?city=spb', deps: DATA_FILES.filter(f => !/^assets\/(places|events)\.js$/.test(f)), priority: '0.9', changefreq: 'daily', variant: true, city: 'spb' },
  { file: 'create.html', priority: '0.6', changefreq: 'monthly' },
  { file: 'partners.html', priority: '0.4', changefreq: 'monthly' },
  { file: 'rules.html', priority: '0.2', changefreq: 'yearly' },
  { file: 'privacy.html', priority: '0.2', changefreq: 'yearly' },
];
const noindex = html => /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
const canonical = html => /<link[^>]+rel=["']canonical["']/i.test(html);
const urls = [];
const mainMan = mans.get(MAIN.out);
for (const s of STATIC) {
  if (!exists(s.file) || (s.city && !BUILT_IDS.has(s.city))) continue;
  const html = read(s.file);
  if (noindex(html) || (s.variant && canonical(html))) continue;
  const key = s.file + (s.query || '');
  const h = sha(html + (s.deps || []).map(f => (exists(f) ? read(f) : '')).join('\n'));
  const prev = old.static && old.static[key];
  mainMan.static[key] = { sha: h, lastmod: prev && prev.sha === h && isYmd(prev.lastmod) ? prev.lastmod : TODAY };
  urls.push({ loc: BASE + s.file + (s.query || ''), lastmod: mainMan.static[key].lastmod, changefreq: s.changefreq, priority: s.priority });
}
const PRIO = { occasion: '0.8', season: '0.7', category: '0.7', afisha: '0.7', okr: '0.6', metro: '0.5', pc: '0.5' };
for (const b of BUILT) {
  const man = mans.get(b.C.out);
  urls.push({ loc: b.pageUrl(''), lastmod: man.files[b.C.out + '/index.html'].lastmod, changefreq: 'weekly', priority: '0.8' });
  for (const pg of b.PAGES) urls.push({ loc: b.pageUrl(pg.slug), lastmod: man.files[`${b.C.out}/${pg.slug}/index.html`].lastmod, changefreq: pg.changefreq || 'weekly', priority: PRIO[pg.group] || '0.5' });
  const lm = f => (man.files[f] || {}).lastmod || TODAY;
  if (b.COLS.length) {
    urls.push({ loc: b.pageUrl('podborki'), lastmod: lm(`${b.C.out}/podborki/index.html`), changefreq: 'weekly', priority: '0.7' });
    for (const col of b.COLS) urls.push({ loc: b.pageUrl('podborki/' + col.slug), lastmod: lm(`${b.C.out}/podborki/${col.slug}/index.html`), changefreq: 'weekly', priority: '0.7' });
  }
  if (b.MP.length) {
    urls.push({ loc: b.pageUrl('m'), lastmod: lm(`${b.C.out}/m/index.html`), changefreq: 'weekly', priority: '0.5' });
    for (const p of b.MP) urls.push({ loc: b.pageUrl('m/' + p.id), lastmod: lm(`${b.C.out}/m/${p.id}/index.html`), changefreq: 'monthly', priority: '0.4' });
  }
}
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Сгенерировано scripts/build-seo.mjs — не править руками: адрес сайта меняется константой SITE в скрипте. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${xml(u.loc)}</loc><lastmod>${u.lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>
`;
const robots = `# Сгенерировано scripts/build-seo.mjs — адрес сайта меняется константой SITE в скрипте.
# Поисковики читают robots.txt только из корня домена: на github.io/<репозиторий>/ этот файл работает после переезда на свой домен.
# Служебные страницы (adult.html, create.html, go.html, index.html с приглашением…) закрыты meta robots noindex —
# Disallow им не ставим: страницу, закрытую в robots.txt, поисковик не прочитает и noindex не увидит.
User-agent: *
Allow: /
# Яндекс: параметры, которые только открывают карточку или фильтр на главной, — одна страница, а не тысячи.
# city не чистим: start.html?city=spb — каталог Петербурга, это другая страница
Clean-param: plan&place&event&f&b&cat&okr&tab&quiz ${BASE_PATH}start.html
# и метки рекламы и рассылок — на всём сайте
Clean-param: utm_source&utm_medium&utm_campaign&utm_content&utm_term&yclid

Sitemap: ${BASE}sitemap.xml
`;
const writeIfChanged = (f, s) => { const cur = outExists(f) ? outRead(f) : null; if (cur === s) return false; if (!DRY) { fs.mkdirSync(OUT_ROOT, { recursive: true }); fs.writeFileSync(outAbs(f), s); } return true; };
const smChanged = writeIfChanged('sitemap.xml', sitemap);
const rbChanged = writeIfChanged('robots.txt', robots);
if (!DRY) {
  for (const [dir, man] of mans) {
    const f = dir + '/.generated.json', t = JSON.stringify(man, null, 1) + '\n';
    fs.mkdirSync(outAbs(dir), { recursive: true });
    if (!outExists(f) || outRead(f) !== t) fs.writeFileSync(outAbs(f), t);
  }
}

/* ---------- отчёт ---------- */
const bytes = [...files.values()].reduce((a, s) => a + Buffer.byteLength(s), 0);
console.log(`${DRY ? '[проверка, без записи] ' : ''}SEO-страницы на ${TODAY}, сайт ${BASE}${OUT_ROOT !== ROOT ? ` → папка ${OUT_ROOT}` : ''}`);
for (const b of BUILT) {
  const byGroup = GROUPS.map(([g]) => `${b.groupLabel(g)}: ${b.PAGES.filter(p => p.group === g).length}`).join(' · ');
  console.log(`  ${b.C.name} (данные на ${b.DATA_DATE}): мест ${b.VP.length}, планов ${b.PLANS.length}, событий впереди ${b.EVENTS.length}`);
  console.log(`    подборок ${b.PAGES.length} + ${b.C.out}/index.html — ${byGroup}`);
}
for (const C of SKIPPED) console.log(`  ${C.name}: мест в каталоге нет — подборки ${C.out}/ не собираю`);
console.log(`  файлов ${files.size}, ${(bytes / 1024).toFixed(0)} КБ; новых ${stat.added.length}, изменено ${stat.changed.length}, без изменений ${stat.same}, удалено ${stat.removed.length}`);
if (stat.removed.length) console.log('  удалены: ' + stat.removed.join(', '));
console.log(`  sitemap.xml: ${urls.length} адресов${smChanged ? ' (обновлён)' : ''}; robots.txt${rbChanged ? ' обновлён' : ' без изменений'}`);
uniqBy(warns, x => x).forEach(w => console.log('  ⚠ ' + w));

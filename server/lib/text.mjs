/* Очистка текста от людей: отзывы, имена, заметки, сообщения об ошибках.
   Порядок: NFC → теги → управляющие и невидимые символы → ссылки/почта/@ники/телефоны →
   повторы → пробелы → мат (маска) → обрезка по длине. */

// управляющие символы (кроме \n), C1
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
// невидимые и «направляющие» символы, селекторы вариантов (кроме FE0F у эмодзи), теги Unicode
const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0E\uFEFF\uFFA0\uFFF9-\uFFFB\u{E0000}-\u{E007F}]/gu;
// ZWJ оставляем только внутри эмодзи-последовательностей (👩\u200D💻)
const LONE_ZWJ = /(?<![\p{Extended_Pictographic}\uFE0F\u{1F3FB}-\u{1F3FF}])\u200D|\u200D(?!\p{Extended_Pictographic})/gu;
const TAGS = /<!--[\s\S]*?-->|<\/?[a-z!?][^<>]*>/gi;
const SPACES = /[ \t\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g;
const ZALGO = /(\p{M}{2})\p{M}+/gu;
const REPEAT = /(.)\1{3,}/gu;

const TLD = 'ru|su|rf|com|net|org|info|biz|pro|io|me|co|cc|tv|to|ly|gl|gg|be|link|click|site|online|store|shop|xyz|top|club|app|dev|page|space|website|tech|digital|live|moscow|msk|spb|ua|by|kz|uz|am|ge|de|uk|us|eu|fr|it|es|pl|cz|lt|lv|ee|fi|nl|ch|at|tk|ml|ga|cf|gq|ws|im|ai|xn--p1ai|рф|рус';
// хвостовую пунктуацию («сайт.ру/меню, и…») оставляем в тексте
const END = String.raw`[^\s.,!?;:)\]}»"'\u2026]`;
const URL_SCHEME = new RegExp(String.raw`\b(?:https?|ftp|tg|tonsite|ton|viber|whatsapp|intent):\/\/(?:[^\s]*${END})?|\bwww\.(?:[^\s]*${END})?`, 'giu');
const URL_BARE = new RegExp(String.raw`(?<![\p{L}\p{N}@._-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:${TLD})(?![\p{L}\p{N}-])(?::\d{1,5})?(?:[/?#](?:[^\s]*${END})?)?`, 'giu');
const EMAIL = /[\p{L}\p{N}._%+-]+[@\uFF20\uFE6B][\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const HANDLE = /(^|[^\p{L}\p{N}_])[@\uFF20\uFE6B][A-Za-z0-9_]{3,32}(?![A-Za-z0-9_])/gu;
/* \u0422\u0435\u043b\u0435\u0444\u043e\u043d\u044b: \u0440\u043e\u0441\u0441\u0438\u0439\u0441\u043a\u0438\u0435 (+7/8/7, \u043a\u043e\u0434 \u0432 \u0441\u043a\u043e\u0431\u043a\u0430\u0445 \u0438\u043b\u0438 \u043c\u043e\u0431\u0438\u043b\u044c\u043d\u044b\u0439 9xx, \u0437\u0430\u0442\u0435\u043c 3-2-2 \u0446\u0438\u0444\u0440\u044b) \u0438 \u043c\u0435\u0436\u0434\u0443\u043d\u0430\u0440\u043e\u0434\u043d\u044b\u0435 \u0441 \u00ab+\u00bb.
   \u041f\u0440\u043e\u0441\u0442\u043e \u043c\u043d\u043e\u0433\u043e \u0446\u0438\u0444\u0440 \u043f\u043e\u0434\u0440\u044f\u0434 \u2014 \u043d\u0435 \u0442\u0435\u043b\u0435\u0444\u043e\u043d: \u00ab15.10.2026 19:00\u00bb, \u00ab\u0446\u0435\u043d\u044b 350 450 550 650\u00bb \u043e\u0441\u0442\u0430\u044e\u0442\u0441\u044f \u0432 \u0442\u0435\u043a\u0441\u0442\u0435. */
const SEP = String.raw`[\s.\u2010-\u2015-]{0,2}`;
const PHONE = new RegExp(String.raw`(?<![\d,:/]|\d\.)(?:(?:\+\s?7|\b[78])${SEP}\(?\d{3}\)?|\(\d{3}\)|\b9\d{2})${SEP}\d{3}${SEP}\d{2}${SEP}\d{2}(?!\d)|\+\s?\d(?:[\s().\u2010-\u2015-]{0,2}\d){8,13}(?!\d)`, 'g');

/* ---------- мат: компактный список корней ----------
   Слово приводим к «кириллице»: латинские двойники и цифры → русские буквы, ё → е, повторы схлопываем.
   Корни подобраны так, чтобы не задевать «себе», «небо», «хлеб», «тихую», «страхует», «мандарин», «гондола». */
const LOOK = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', n: 'п', o: 'о', p: 'р', r: 'г', t: 'т', u: 'и', i: 'и', x: 'х', y: 'у', '0': 'о', '3': 'з', '4': 'ч', '6': 'б', '@': 'а', 'ё': 'е' };
const PREF = '(?:на|по|о|об|объ|за|от|отъ|ни|рас|раз|разъ|до|вы|при|про|под|подъ|пере|недо|не|у|с|съ|въ|а|ох)';
const PREF_E = '(?:на|по|о|об|объ|за|от|отъ|ни|рас|раз|разъ|до|вы|при|про|под|подъ|пере|недо|не|у|съ|въ)';  // без «с»: «себе», «себя»
const RU_BAD = [
  new RegExp(`^${PREF}?ху[йеяию]`),
  /п[ие]зд/,
  new RegExp(`^${PREF_E}?еб(?:[аеиоуюя]|л|н|$)`),
  /долб[оа]еб/,
  /бляд|^блят|^бля$/,
  /^с+ук(?:а|и|е|у|ой|ою|ам|ами|ах)$|^сукин|^сучар/,
  /^муд(?:ак|ач|ил|озвон|ень)/,
  /пид[оа]?р/,
  /залуп/,
  /г[ао]ндон/,
  /шлюх/,
  /^манд(?:а|е|у|ы|ой)$|^мандавош/,
  /^(?:за|по|на|от|ни|вз|у)?дроч/,
  /^говн/,
];
const LAT_BAD = /^(?:na|po|o|za|ot|ni|ras|do|vy)?(?:hu[yiej]|xu[yiej])|pi[sz]d|^bly[ad]|^bl[iy]at|^suk[aiu]$|^(?:za|na|po|u|vy|ot|do)?(?:e|yo|jo)ba[lnt]|^pid[oa]?r|^mudak|zalup|g[ao]ndon|shl[yj]uh|dolbo[ey]?e?b/;

function normWord(w) {
  const low = w.toLowerCase();
  if (!/[а-яё]/.test(low)) return null;          // чисто латинское слово проверяем отдельно
  let s = '';
  for (const ch of low) s += LOOK[ch] || ch;
  return s.replace(/(.)\1+/gu, '$1');
}

export function isProfane(word) {
  const n = normWord(word);
  if (n) return RU_BAD.some(re => re.test(n));
  const low = word.toLowerCase();
  if (/^[a-z0-9@$]+$/.test(low)) return LAT_BAD.test(low.replace(/(.)\1+/g, '$1'));
  return false;
}

export function maskProfanity(text) {
  let count = 0;
  const out = String(text).replace(/[\p{L}\p{N}@$]+/gu, w => {
    if (w.length < 3 || /^\d+$/.test(w) || !isProfane(w)) return w;
    count++;
    const chars = Array.from(w);
    return chars[0] + '*'.repeat(chars.length - 1);
  });
  return { text: out, count };
}

/* Обрезка по символам (не рвёт суррогатные пары) */
export function cut(s, max) {
  const a = Array.from(s);
  return a.length > max ? a.slice(0, max).join('').trimEnd() : s;
}

/**
 * Очистить текст.
 * @param {string} raw
 * @param {{max?: number, line?: boolean, keepLinks?: boolean, mask?: boolean}} o
 *   line — одна строка (переносы → пробел); keepLinks — не вырезать ссылки (для сообщений об ошибках);
 *   mask — маскировать мат.
 * @returns {{text: string, links: number, masked: number, caps: boolean}}
 */
export function cleanText(raw, o = {}) {
  const max = o.max || 600;
  let s = String(raw == null ? '' : raw).normalize('NFC');
  s = s.replace(/\r\n?|[\u2028\u2029]/g, '\n').replace(/\t/g, ' ');
  s = s.replace(TAGS, ' ');
  s = s.replace(CTRL, '').replace(INVISIBLE, '').replace(LONE_ZWJ, '');
  let links = 0;
  const drop = () => { links++; return ' '; };
  if (!o.keepLinks) {
    s = s.replace(EMAIL, drop).replace(URL_SCHEME, drop).replace(URL_BARE, drop)
      .replace(HANDLE, (m, pre) => { links++; return pre + ' '; })
      .replace(PHONE, drop);
  }
  s = s.replace(ZALGO, '$1').replace(REPEAT, '$1$1$1');
  if (o.line) s = s.replace(/\s+/g, ' ');
  s = s.replace(SPACES, ' ').replace(/ ([,.;:!?])/g, '$1').split('\n').map(l => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  let masked = 0;
  if (o.mask) { const m = maskProfanity(s); s = m.text; masked = m.count; }
  s = cut(s, max);
  const letters = s.match(/\p{L}/gu) || [];
  const upper = s.match(/\p{Lu}/gu) || [];
  const caps = letters.length >= 20 && upper.length / letters.length > 0.6;
  return { text: s, links, masked, caps };
}

/* Короткая строка без переносов: имя, заголовок */
export const cleanLine = (raw, max, mask = false) => cleanText(raw, { max, line: true, mask }).text;

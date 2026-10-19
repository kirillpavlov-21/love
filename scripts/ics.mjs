/* Календарь в формате iCalendar (RFC 5545) для подписки: «выходные» города и события подборок.
   Чистые функции без зависимостей — их зовёт scripts/build-seo.mjs, а проверяет scripts/test/ics.test.mjs.

   Правила, на которые полагаются календари при подписке (Apple, Google, Outlook):
   ─ строки через CRLF, длиннее 75 байт — переносятся (CRLF + пробел), не разрывая букву UTF-8;
   ─ в тексте экранируем \ ; , и перевод строки;
   ─ UID стабилен между сборками: id события + день показа — так календарь обновляет запись, а не плодит копии;
   ─ время — местное с TZID=Europe/Moscow (Москва и Петербург в одном поясе), описание пояса — в VTIMEZONE;
   ─ DTSTAMP не зависит от дня сборки (дата данных), чтобы файл не менялся без причины. */

export const TZID = 'Europe/Moscow';
/* Москва без перехода на летнее время с 2014 года: одно правило STANDARD +03:00 */
const VTIMEZONE = ['BEGIN:VTIMEZONE', `TZID:${TZID}`, 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0300', 'TZOFFSETTO:+0300', 'TZNAME:MSK', 'END:STANDARD', 'END:VTIMEZONE'];

/* текст свойства: \ ; , и переводы строк */
export const icsText = s => String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\\;,]/g, c => '\\' + c).replace(/\n/g, '\\n');

/* перенос длинной строки: не больше 75 байт в строке, продолжение начинается с пробела */
export function fold(line) {
  const out = [];
  let cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 75; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

const ymd8 = s => s.replace(/-/g, '');
const pad = n => String(n).padStart(2, '0');
/* ГГГГ-ММ-ДД + n дней (в UTC, без поясов) */
function addDays(s, n) {
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/* день и время + минуты: { day, hm } — с переходом через полночь */
export function plusMinutes(day, hm, min) {
  const t = +hm.slice(0, 2) * 60 + +hm.slice(3, 5) + min;
  return { day: addDays(day, Math.floor(t / 1440)), hm: `${pad(Math.floor((t % 1440) / 60))}:${pad(t % 60)}` };
}
const local = (day, hm) => `${ymd8(day)}T${hm.replace(':', '')}00`;

/* Одна запись VEVENT. ev: { uid, day, time?, minutes?, endDay? (последний день для событий «весь день»), summary,
   location?, geo?: [lat, lon], description?, url?, categories?, free? } */
export function vevent(ev, stamp) {
  const L = ['BEGIN:VEVENT', `UID:${ev.uid}`, `DTSTAMP:${stamp}`];
  if (ev.time && /^\d\d:\d\d$/.test(ev.time)) {
    const end = plusMinutes(ev.day, ev.time, ev.minutes || 120);
    L.push(`DTSTART;TZID=${TZID}:${local(ev.day, ev.time)}`, `DTEND;TZID=${TZID}:${local(end.day, end.hm)}`);
  } else {
    // «весь день»: DTEND — следующий день после последнего (не включительно)
    L.push(`DTSTART;VALUE=DATE:${ymd8(ev.day)}`, `DTEND;VALUE=DATE:${ymd8(addDays(ev.endDay && ev.endDay > ev.day ? ev.endDay : ev.day, 1))}`);
  }
  L.push(`SUMMARY:${icsText(ev.summary)}`);
  if (ev.location) L.push(`LOCATION:${icsText(ev.location)}`);
  if (ev.geo && ev.geo.every(Number.isFinite)) L.push(`GEO:${(+ev.geo[0]).toFixed(6)};${(+ev.geo[1]).toFixed(6)}`);
  if (ev.description) L.push(`DESCRIPTION:${icsText(ev.description)}`);
  if (ev.url) L.push(`URL:${ev.url}`);
  if (ev.categories) L.push(`CATEGORIES:${icsText(ev.categories)}`);
  L.push('STATUS:CONFIRMED', 'TRANSP:TRANSPARENT', 'END:VEVENT');
  return L;
}

/* Весь календарь. cal: { prodid, name, desc, stamp ('ГГГГММДДTЧЧММССZ'), refresh ('PT12H'), events: [vevent-данные] } */
export function calendar(cal) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${cal.prodid}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(cal.name)}`, `X-WR-CALDESC:${icsText(cal.desc || '')}`, `X-WR-TIMEZONE:${TZID}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${cal.refresh || 'PT12H'}`, `X-PUBLISHED-TTL:${cal.refresh || 'PT12H'}`, ...VTIMEZONE];
  for (const ev of cal.events) L.push(...vevent(ev, cal.stamp));
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

/* Самопроверка готового файла (её же зовёт сборка): CRLF, длина строк, парные BEGIN/END, обязательные поля, уникальные UID.
   Возвращает список ошибок — пустой, если всё хорошо. */
export function checkIcs(text) {
  const errs = [];
  if (!text.endsWith('\r\n')) errs.push('файл не заканчивается CRLF');
  if (/[^\r]\n/.test(text)) errs.push('перевод строки без CR');
  const raw = text.split('\r\n');
  raw.pop();
  raw.forEach((l, i) => { if (Buffer.byteLength(l) > 75) errs.push(`строка ${i + 1} длиннее 75 байт`); });
  // разворачиваем переносы
  const lines = [];
  raw.forEach(l => { if (/^[ \t]/.test(l) && lines.length) lines[lines.length - 1] += l.slice(1); else lines.push(l); });
  const stack = [], uids = new Set();
  let ev = null;
  for (const l of lines) {
    const m = /^(BEGIN|END):([A-Z-]+)$/.exec(l);
    if (m && m[1] === 'BEGIN') { stack.push(m[2]); if (m[2] === 'VEVENT') ev = {}; continue; }
    if (m && m[1] === 'END') {
      if (stack.pop() !== m[2]) errs.push(`END:${m[2]} без пары`);
      if (m[2] === 'VEVENT' && ev) {
        for (const k of ['UID', 'DTSTAMP', 'DTSTART', 'SUMMARY']) if (!ev[k]) errs.push(`VEVENT без ${k}`);
        if (ev.UID && uids.has(ev.UID)) errs.push(`повтор UID ${ev.UID}`);
        if (ev.UID) uids.add(ev.UID);
        if (ev.DTSTART && ev.DTEND && ev.DTEND.replace(/^.*:/, '') <= ev.DTSTART.replace(/^.*:/, '')) errs.push(`DTEND не позже DTSTART у ${ev.UID}`);
        ev = null;
      }
      continue;
    }
    const k = /^([A-Z-]+)[;:]/.exec(l);
    if (!k) { errs.push(`строка без имени свойства: ${l.slice(0, 40)}`); continue; }
    if (ev) ev[k[1]] = l;
    if (k[1] === 'DTSTART' && /TZID=/.test(l) && !/TZID=Europe\/Moscow:\d{8}T\d{6}$/.test(l)) errs.push(`странный DTSTART: ${l}`);
  }
  if (stack.length) errs.push('не закрыт ' + stack.join(', '));
  if (lines[0] !== 'BEGIN:VCALENDAR' || lines[lines.length - 1] !== 'END:VCALENDAR') errs.push('нет BEGIN/END:VCALENDAR по краям');
  for (const k of ['VERSION:2.0', 'PRODID:']) if (!lines.some(l => l.startsWith(k))) errs.push('нет ' + k);
  return errs;
}

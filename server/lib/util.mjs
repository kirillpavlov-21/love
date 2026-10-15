/* Мелкие помощники: хэши, сравнение секретов, идентификаторы */
import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export const b64url = buf => Buffer.from(buf).toString('base64url');
export const sha256 = s => createHash('sha256').update(String(s), 'utf8').digest();
export const sha256b64 = (s, len = 43) => b64url(sha256(s)).slice(0, len);
export const hmacHex = (key, s) => createHmac('sha256', String(key)).update(String(s), 'utf8').digest('hex');

/* Сравнение секретов за постоянное время: сравниваем SHA-256 от обеих строк (длины равны всегда) */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return timingSafeEqual(sha256('k|' + a), sha256('k|' + b)) && a.length === b.length;
}

export function rand62(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += B62[randomInt(62)];
  return s;
}

/* Id, который сортируется по времени: 9 знаков base36 от миллисекунд + 4 случайных */
export const timeId = ms => Math.floor(ms).toString(36).padStart(9, '0') + rand62(4);
export const TIME_ID_RE = /^[0-9a-z]{9}[0-9A-Za-z]{4}$/;

export const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const byteLen = s => (typeof s === 'string' ? Buffer.byteLength(s, 'utf8') : s ? s.length || 0 : 0);

export const DAY = 864e5;

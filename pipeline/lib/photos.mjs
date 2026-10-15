/* Фото мест — только Wikimedia Commons со свободной лицензией (CC0, общественное достояние, CC BY, CC BY-SA, FAL).
   Ищем файлы рядом с точкой места, сохраняем в assets/ph/<id>.webp (720 px) и assets/ph/t/<id>.webp (240×240),
   автора и лицензию отдаём в формате, который понимает сайт (ph: { s, t, a, l, file, u }). */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const UA = 'KudaIdemBot/1.0 (+https://kirillpavlov-21.github.io/love/)';
const API = 'https://commons.wikimedia.org/w/api.php';
const MIN_WIDTH = 800;
const MAX_BYTES = 20 * 1024 * 1024;
// превью Commons отдаёт с thumb.wikimedia.org (раньше — upload.wikimedia.org)
const IMG_HOSTS = ['upload.wikimedia.org', 'thumb.wikimedia.org'];

async function api(params, fetchImpl) {
  const url = API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Commons API: HTTP ${res.status}`);
  const j = await res.json();
  if (j && j.error) throw new Error(`Commons API: ${j.error.code || ''} ${j.error.info || ''}`.trim());
  return j;
}

/* ---------- текст из метаданных ---------- */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', ndash: '–', mdash: '—', copy: '©' };
export function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
      return ENT[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ').trim();
}

/* Автор без ссылок на соцсети: «Иван Петров (Telegram:SomeHandle)» → «Иван Петров» */
const SOCIAL = 'telegram|tg|instagram|insta|ig|vk|vkontakte|вконтакте|twitter|x|facebook|fb|youtube|tiktok|threads|t\\.me|vk\\.com|instagram\\.com';
const NOT_WORD = '(?<![A-Za-zА-Яа-яЁё0-9_.])';
export function cleanArtist(s) {
  let a = stripHtml(s);
  a = a.replace(new RegExp('\\s*[([]\\s*(?:' + SOCIAL + ')\\s*[:@/][^)\\]]*[)\\]]', 'gi'), '');
  a = a.replace(new RegExp('\\s*[,;|–—-]?\\s*' + NOT_WORD + '(?:' + SOCIAL + ')\\s*[:@]\\s*\\S+', 'gi'), '');
  a = a.replace(/\s*\(?\s*(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|instagram\.com|vk\.com|tiktok\.com|youtube\.com|x\.com|twitter\.com)\/\S*\)?/gi, '');
  a = a.replace(/(^|\s)@[\w.]+/g, '$1');
  a = a.replace(/\s*\(\s*\)/g, '').replace(/\s+/g, ' ').replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '').trim();
  if (a.length > 80) a = a.slice(0, 78).replace(/\s+\S*$/, '') + '…';
  return a;
}

/* Свободная лицензия → подпись как в assets/photos.js, иначе null (NC, ND, GFDL-only, fair use…) */
export function freeLicense(short, code) {
  const s = stripHtml(short), c = String(code || '').toLowerCase();
  if (/(^|[\s-])(nc|nd)([\s-]|$)/i.test(s) || /-(nc|nd)(-|$)/.test(c) || /fair use|non-?free|copyrighted/i.test(s)) return null;
  if (/^cc0\b|^cc-zero/i.test(s) || /^cc0/.test(c)) return 'CC0';
  if (/^(public domain|pd\b|pd-|общественное достояние)/i.test(s) || /^pd(-|$)/.test(c)) return 'общественное достояние';
  const cc = /^cc[\s-]?(by(?:[\s-]sa)?|sa)(?:[\s-]+(\d(?:\.\d)?))?(?:[\s-]+(igo))?/i.exec(s);
  if (cc) return ('CC ' + cc[1].toUpperCase().replace(/[\s-]+/, '-') + (cc[2] ? ' ' + cc[2] : '') + (cc[3] ? ' IGO' : '')).trim();
  if (/free art licen[cs]e|licence art libre|^fal\b/i.test(s) || c === 'fal') return 'Free Art License';
  return null;
}

const NOT_AUTHOR = /own work|собственн\S* работа|transferred from|перенесено|^https?:\/\/|^www\./i;
const OK_MIME = /^image\/(jpeg|png|webp|tiff)$/;
const JUNK = /(^|[\s_(-])(map|карта|схема|scheme|plan of|logo|логотип|герб|coat of arms|flag|флаг|diagram|chart)([\s_.,)-]|$)/i;

/* Кандидаты на фото места: файлы Commons в радиусе radiusM от точки, ближние первыми.
   [{ file, thumb (1280 px), artist, license, descUrl, width, height, distM, title, desc }] */
export async function findCommonsCandidates(place, { fetchImpl = globalThis.fetch, radiusM = 60, limit = 12 } = {}) {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return [];
  const r = Math.max(10, Math.min(10000, Math.round(radiusM)));
  const geo = await api({
    action: 'query', list: 'geosearch', gscoord: `${place.lat}|${place.lon}`, gsradius: String(r),
    gslimit: String(Math.min(100, Math.max(limit * 3, 20))), gsnamespace: '6',
  }, fetchImpl);
  const hits = ((geo.query || {}).geosearch || []).filter(h => h && h.pageid && /^File:/i.test(h.title || ''))
    .sort((a, b) => (a.dist || 0) - (b.dist || 0));
  if (!hits.length) return [];
  const info = {};
  for (let i = 0; i < hits.length; i += 50) {
    const j = await api({
      action: 'query', pageids: hits.slice(i, i + 50).map(h => h.pageid).join('|'), prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1280',
      iiextmetadatafilter: 'Artist|Credit|LicenseShortName|License|UsageTerms|AttributionRequired|ImageDescription',
      iiextmetadatalanguage: 'ru',
    }, fetchImpl);
    for (const p of (j.query || {}).pages || []) info[p.pageid] = p;
  }
  const out = [];
  for (const h of hits) {
    const page = info[h.pageid];
    const ii = page && page.imageinfo && page.imageinfo[0];
    if (!ii) continue;
    const title = String(page.title || h.title).replace(/^File:/i, '');
    if (!OK_MIME.test(ii.mime || '') || /\.svg$/i.test(title)) continue;
    if (!(ii.width >= MIN_WIDTH)) continue;
    if (JUNK.test(title.replace(/_/g, ' '))) continue;
    const md = ii.extmetadata || {};
    const v = k => (md[k] && md[k].value) || '';
    const license = freeLicense(v('LicenseShortName') || v('UsageTerms'), v('License'));
    if (!license) continue;
    // Credit — только если там имя: «Own work» / «Собственная работа», «перенесено из…» и голая ссылка — не автор
    const name = s => (NOT_AUTHOR.test(s) ? '' : s);
    let artist = name(cleanArtist(v('Artist'))) || name(cleanArtist(v('Credit')));
    if (!artist) {
      if (license === 'CC0' || license === 'общественное достояние') artist = 'неизвестный автор';
      else continue;                                                         // CC BY без автора подписать нельзя
    }
    const thumb = ii.thumburl || ii.url;
    if (!thumb) continue;
    const file = title.replace(/ /g, '_');
    out.push({
      file, thumb, artist, license, descUrl: ii.descriptionurl || 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file),
      width: ii.width, height: ii.height, distM: Math.round(h.dist || 0), title: title.replace(/_/g, ' ').replace(/\.[a-z0-9]+$/i, ''),
      desc: stripHtml(v('ImageDescription')).slice(0, 200),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/* Скачать превью 1280 px с серверов Wikimedia и сохранить две картинки для сайта.
   Возвращает ph: { s, t, a, l, file, u } — как в assets/photos.js */
export async function savePhoto(cand, id, repoDir, { fetchImpl = globalThis.fetch } = {}) {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(String(id || ''))) throw new Error(`savePhoto: плохой id «${id}»`);
  if (!cand || !cand.file || !cand.thumb) throw new Error('savePhoto: нет файла');
  let u;
  try { u = new URL(cand.thumb); } catch (e) { throw new Error(`savePhoto: плохая ссылка ${cand.thumb}`); }
  if (u.protocol !== 'https:' || !IMG_HOSTS.includes(u.hostname)) throw new Error(`savePhoto: качаем только с ${IMG_HOSTS.join(' или ')}, а не ${u.hostname}`);
  for (const k of [...u.searchParams.keys()]) if (/^utm_/.test(k)) u.searchParams.delete(k);
  const res = await fetchImpl(u.href, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`savePhoto: HTTP ${res.status} для ${cand.file}`);
  const len = Number(res.headers && res.headers.get && res.headers.get('content-length'));
  if (len > MAX_BYTES) throw new Error(`savePhoto: файл слишком большой (${len} байт)`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`savePhoto: файл слишком большой (${buf.length} байт)`);

  const s = `assets/ph/${id}.webp`, t = `assets/ph/t/${id}.webp`;
  await fs.mkdir(path.join(repoDir, 'assets/ph/t'), { recursive: true });
  const img = () => sharp(buf, { failOn: 'error' }).rotate();               // rotate() — поворот по EXIF
  await img().resize({ width: 720, withoutEnlargement: true }).webp({ quality: 72 }).toFile(path.join(repoDir, s));
  await img().resize(240, 240, { fit: 'cover', position: sharp.strategy.attention }).webp({ quality: 72 }).toFile(path.join(repoDir, t));
  return { s, t, a: cand.artist, l: cand.license, file: cand.file, u: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(cand.file) };
}

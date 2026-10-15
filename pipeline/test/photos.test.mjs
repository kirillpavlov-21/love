import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { findCommonsCandidates, savePhoto, cleanArtist, freeLicense, stripHtml, UA } from '../lib/photos.mjs';

const json = b => ({ ok: true, status: 200, headers: new Map(), json: async () => JSON.parse(JSON.stringify(b)) });

/* Ответы Commons: geosearch, затем imageinfo по pageids */
const GEO = { query: { geosearch: [
  { pageid: 3, ns: 6, title: 'File:Far good.jpg', lat: 55.7, lon: 37.6, dist: 55.2 },
  { pageid: 1, ns: 6, title: 'File:Тестовый дом 01.jpg', lat: 55.7, lon: 37.6, dist: 12.4 },
  { pageid: 2, ns: 6, title: 'File:Icon.svg', lat: 55.7, lon: 37.6, dist: 13 },
  { pageid: 4, ns: 6, title: 'File:Small.jpg', lat: 55.7, lon: 37.6, dist: 14 },
  { pageid: 5, ns: 6, title: 'File:Nc.jpg', lat: 55.7, lon: 37.6, dist: 15 },
  { pageid: 6, ns: 6, title: 'File:Gfdl.jpg', lat: 55.7, lon: 37.6, dist: 16 },
  { pageid: 7, ns: 6, title: 'File:Old photo.jpg', lat: 55.7, lon: 37.6, dist: 17 },
  { pageid: 8, ns: 6, title: 'File:No author.jpg', lat: 55.7, lon: 37.6, dist: 18 },
  { pageid: 9, ns: 6, title: 'File:Map of district.png', lat: 55.7, lon: 37.6, dist: 19 },
  { pageid: 10, ns: 6, title: 'File:Walk.webm', lat: 55.7, lon: 37.6, dist: 20 },
] } };
const ii = (title, { mime = 'image/jpeg', width = 4000, height = 3000, lic = 'CC BY-SA 4.0', code = 'cc-by-sa-4.0', artist = 'A.Savin', desc = '' } = {}) => ({
  title, imageinfo: [{
    width, height, mime, size: 123,
    url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/' + encodeURIComponent(title.slice(5).replace(/ /g, '_')),
    thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/x.jpg/1280px-x.jpg', thumbwidth: 1280,
    descriptionurl: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')),
    extmetadata: {
      Artist: artist == null ? undefined : { value: artist }, LicenseShortName: { value: lic }, License: { value: code },
      ImageDescription: { value: desc },
    },
  }],
});
const INFO = { query: { pages: [
  { pageid: 1, ns: 6, ...ii('File:Тестовый дом 01.jpg', { artist: '<a href="//commons.wikimedia.org/wiki/User:Tester">Tester</a> (Telegram:SomeHandle)', desc: '<b>Дом</b> на&nbsp;улице' }) },
  { pageid: 2, ns: 6, ...ii('File:Icon.svg', { mime: 'image/svg+xml' }) },
  { pageid: 3, ns: 6, ...ii('File:Far good.jpg', { lic: 'CC BY 2.0', code: 'cc-by-2.0', artist: 'Ivan' }) },
  { pageid: 4, ns: 6, ...ii('File:Small.jpg', { width: 640, height: 480 }) },
  { pageid: 5, ns: 6, ...ii('File:Nc.jpg', { lic: 'CC BY-NC-SA 2.0', code: 'cc-by-nc-sa-2.0' }) },
  { pageid: 6, ns: 6, ...ii('File:Gfdl.jpg', { lic: 'GFDL', code: 'gfdl' }) },
  { pageid: 7, ns: 6, ...ii('File:Old photo.jpg', { lic: 'Public domain', code: 'pd', artist: '' }) },
  { pageid: 8, ns: 6, ...ii('File:No author.jpg', { lic: 'CC BY 4.0', code: 'cc-by-4.0', artist: null }) },
  { pageid: 9, ns: 6, ...ii('File:Map of district.png', { mime: 'image/png' }) },
  { pageid: 10, ns: 6, ...ii('File:Walk.webm', { mime: 'video/webm' }) },
] } };

function commonsFetch({ geo = GEO, info = INFO } = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url: u, headers: init.headers || {} });
    if (u.searchParams.get('list') === 'geosearch') return json(geo);
    if (u.searchParams.get('prop') === 'imageinfo') return json(info);
    return { ok: false, status: 404, headers: new Map(), json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}

test('findCommonsCandidates: запросы к Commons API', async () => {
  const f = commonsFetch();
  await findCommonsCandidates({ name: 'Тест', lat: 55.751234, lon: 37.618765 }, { fetchImpl: f });
  assert.equal(f.calls.length, 2);
  const g = f.calls[0].url;
  assert.equal(g.origin + g.pathname, 'https://commons.wikimedia.org/w/api.php');
  assert.equal(g.searchParams.get('list'), 'geosearch');
  assert.equal(g.searchParams.get('gsnamespace'), '6');
  assert.equal(g.searchParams.get('gsradius'), '60');
  assert.equal(g.searchParams.get('gscoord'), '55.751234|37.618765');
  assert.equal(f.calls[0].headers['User-Agent'], UA);
  const i = f.calls[1].url;
  assert.equal(i.searchParams.get('prop'), 'imageinfo');
  assert.equal(i.searchParams.get('iiurlwidth'), '1280');
  assert.match(i.searchParams.get('iiprop'), /extmetadata/);
  assert.deepEqual(i.searchParams.get('pageids').split('|').map(Number).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('findCommonsCandidates: только свободные лицензии, ≥ 800 px, без SVG, видео и карт, ближние первыми', async () => {
  const list = await findCommonsCandidates({ lat: 55.75, lon: 37.62 }, { fetchImpl: commonsFetch() });
  assert.deepEqual(list.map(c => c.file), ['Тестовый_дом_01.jpg', 'Old_photo.jpg', 'Far_good.jpg']);
  const [a, pd, far] = list;
  assert.equal(a.artist, 'Tester', 'HTML и ссылка на соцсеть убраны');
  assert.equal(a.license, 'CC BY-SA 4.0');
  assert.equal(a.thumb, 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/x.jpg/1280px-x.jpg');
  assert.match(a.descUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File/);
  assert.equal(a.distM, 12);
  assert.equal(a.desc, 'Дом на улице');
  assert.equal(pd.license, 'общественное достояние');
  assert.equal(pd.artist, 'неизвестный автор', 'та же подпись, что в assets/photos.js');
  assert.equal(far.license, 'CC BY 2.0');
  for (const c of list) for (const k of ['file', 'thumb', 'artist', 'license', 'descUrl']) assert.ok(c[k], `${c.file}: нет ${k}`);
});

test('findCommonsCandidates: limit, радиус, пустые ответы, ошибки', async () => {
  assert.equal((await findCommonsCandidates({ lat: 55.75, lon: 37.62 }, { fetchImpl: commonsFetch(), limit: 1 })).length, 1);
  const f = commonsFetch({ geo: { query: { geosearch: [] } } });
  assert.deepEqual(await findCommonsCandidates({ lat: 55.75, lon: 37.62 }, { fetchImpl: f, radiusM: 3 }), []);
  assert.equal(f.calls.length, 1, 'без находок imageinfo не спрашиваем');
  assert.equal(f.calls[0].url.searchParams.get('gsradius'), '10', 'минимум API — 10 м');
  const none = commonsFetch();
  assert.deepEqual(await findCommonsCandidates({ name: 'Без координат' }, { fetchImpl: none }), []);
  assert.equal(none.calls.length, 0);
  const bad = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(findCommonsCandidates({ lat: 55.75, lon: 37.62 }, { fetchImpl: bad }), /HTTP 503/);
  const apiErr = async () => json({ error: { code: 'badvalue', info: 'нет такого параметра' } });
  await assert.rejects(findCommonsCandidates({ lat: 55.75, lon: 37.62 }, { fetchImpl: apiErr }), /badvalue/);
});

test('cleanArtist, freeLicense, stripHtml', () => {
  assert.equal(cleanArtist('Иван Петров (Telegram:SomeHandle)'), 'Иван Петров');
  assert.equal(cleanArtist('Ivan Petrov, Instagram: @ivan_ph'), 'Ivan Petrov');
  assert.equal(cleanArtist('Ivan (https://t.me/example)'), 'Ivan');
  assert.equal(cleanArtist('Ivan [vk: id123]'), 'Ivan');
  assert.equal(cleanArtist('Max: John'), 'Max: John', '«x:» внутри слова — не соцсеть');
  assert.equal(cleanArtist('Минеева Ю. (Julmin)'), 'Минеева Ю. (Julmin)');
  assert.equal(cleanArtist('<span>A &amp; B</span>'), 'A & B');
  assert.ok(cleanArtist('x'.repeat(200)).length <= 80);
  assert.equal(freeLicense('CC BY-SA 4.0'), 'CC BY-SA 4.0');
  assert.equal(freeLicense('CC-BY-SA-3.0'), 'CC BY-SA 3.0');
  assert.equal(freeLicense('CC BY 2.5'), 'CC BY 2.5');
  assert.equal(freeLicense('CC0'), 'CC0');
  assert.equal(freeLicense('Public domain'), 'общественное достояние');
  assert.equal(freeLicense('', 'pd'), 'общественное достояние');
  assert.equal(freeLicense('Free Art License'), 'Free Art License');
  assert.equal(freeLicense('CC BY-NC 4.0'), null);
  assert.equal(freeLicense('CC BY-ND 2.0'), null);
  assert.equal(freeLicense('GFDL'), null);
  assert.equal(freeLicense('Fair use'), null);
  assert.equal(freeLicense(''), null);
  assert.equal(stripHtml('a<br/>b &#171;c&#187; &#x41;'), 'a b «c» A');
});

/* ---------- сохранение ---------- */

async function testJpeg() {
  // 1280×853 с градиентом, чтобы кадрирование было не по пустоте
  const w = 1280, h = 853, raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    raw[i] = x % 256; raw[i + 1] = y % 256; raw[i + 2] = (x + y) % 256;
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();
}

test('savePhoto: 720 px webp и превью 240×240 во временной папке', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kuda-ph-'));
  try {
    const jpg = await testJpeg();
    const calls = [];
    const f = async (url, init = {}) => {
      calls.push({ url: String(url), headers: init.headers || {} });
      return { ok: true, status: 200, headers: new Map([['content-length', String(jpg.length)]]), arrayBuffer: async () => jpg.buffer.slice(jpg.byteOffset, jpg.byteOffset + jpg.length) };
    };
    const cand = { file: 'Тестовый_дом_01.jpg', thumb: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/x.jpg/1280px-x.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo', artist: 'Tester', license: 'CC BY-SA 4.0' };
    const ph = await savePhoto(cand, 'test-dom', dir, { fetchImpl: f });
    assert.deepEqual(ph, {
      s: 'assets/ph/test-dom.webp', t: 'assets/ph/t/test-dom.webp', a: 'Tester', l: 'CC BY-SA 4.0', file: 'Тестовый_дом_01.jpg',
      u: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent('Тестовый_дом_01.jpg'),
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/x.jpg/1280px-x.jpg', 'превью 1280 px, а не оригинал; без utm-меток');
    assert.equal(calls[0].headers['User-Agent'], UA);
    const big = await sharp(path.join(dir, ph.s)).metadata();
    assert.equal(big.format, 'webp');
    assert.equal(big.width, 720);
    assert.equal(big.height, Math.round(853 * 720 / 1280));
    const small = await sharp(path.join(dir, ph.t)).metadata();
    assert.equal(small.format, 'webp');
    assert.deepEqual([small.width, small.height], [240, 240]);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('savePhoto: только серверы Wikimedia, безопасный id, ошибки загрузки', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kuda-ph-'));
  try {
    let n = 0;
    const f = async () => { n++; return { ok: false, status: 404, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) }; };
    const cand = { file: 'X.jpg', thumb: 'https://upload.wikimedia.org/x.jpg', artist: 'A', license: 'CC0' };
    await assert.rejects(savePhoto({ ...cand, thumb: 'https://example.com/x.jpg' }, 'ok-id', dir, { fetchImpl: f }), /wikimedia\.org/);
    await assert.rejects(savePhoto({ ...cand, thumb: 'http://upload.wikimedia.org/x.jpg' }, 'ok-id', dir, { fetchImpl: f }), /wikimedia\.org/);
    await assert.rejects(savePhoto({ ...cand, thumb: 'https://upload.wikimedia.org.evil.example/x.jpg' }, 'ok-id', dir, { fetchImpl: f }), /wikimedia\.org/);
    await assert.rejects(savePhoto(cand, '../evil', dir, { fetchImpl: f }), /плохой id/);
    await assert.rejects(savePhoto(cand, 'Bad Id', dir, { fetchImpl: f }), /плохой id/);
    assert.equal(n, 0, 'до проверок ничего не качаем');
    await assert.rejects(savePhoto(cand, 'ok-id', dir, { fetchImpl: f }), /HTTP 404/);
    const notImage = async () => ({ ok: true, status: 200, headers: new Map(), arrayBuffer: async () => new TextEncoder().encode('<html>').buffer });
    await assert.rejects(savePhoto(cand, 'ok-id', dir, { fetchImpl: notImage }));
    await assert.rejects(fs.access(path.join(dir, 'assets/ph/ok-id.webp')));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('автор: «Собственная работа» и ссылка в Credit — не автор; CC BY без автора пропускаем, CC0 — «неизвестный автор»', async () => {
  const geo = { query: { geosearch: [
    { pageid: 21, ns: 6, title: 'File:Own work.jpg', lat: 55.7, lon: 37.6, dist: 5 },
    { pageid: 22, ns: 6, title: 'File:Own work cc0.jpg', lat: 55.7, lon: 37.6, dist: 6 },
    { pageid: 23, ns: 6, title: 'File:Flickr.jpg', lat: 55.7, lon: 37.6, dist: 7 },
    { pageid: 24, ns: 6, title: 'File:Igo.jpg', lat: 55.7, lon: 37.6, dist: 8 },
  ] } };
  const own = '<span class="int-own-work" lang="ru">Собственная работа</span>';
  const withCredit = (x, credit) => { x.imageinfo[0].extmetadata.Credit = { value: credit }; return x; };
  const info = { query: { pages: [
    { pageid: 21, ns: 6, ...withCredit(ii('File:Own work.jpg', { artist: null }), own) },
    { pageid: 22, ns: 6, ...withCredit(ii('File:Own work cc0.jpg', { artist: null, lic: 'CC0', code: 'cc0' }), own) },
    { pageid: 23, ns: 6, ...withCredit(ii('File:Flickr.jpg', { artist: '', lic: 'CC BY 2.0', code: 'cc-by-2.0' }), 'https://www.flickr.com/photos/x/1') },
    { pageid: 24, ns: 6, ...ii('File:Igo.jpg', { lic: 'CC BY-SA 3.0 IGO', code: 'cc-by-sa-3.0-igo', artist: 'Ivan' }) },
  ] } };
  const list = await findCommonsCandidates({ lat: 55.7, lon: 37.6 }, { fetchImpl: commonsFetch({ geo, info }) });
  const by = Object.fromEntries(list.map(c => [c.file, c]));
  assert.equal(by['Own_work.jpg'], undefined, 'CC BY-SA без настоящего автора не берём');
  assert.equal(by['Flickr.jpg'], undefined, 'голая ссылка — не автор');
  assert.equal(by['Own_work_cc0.jpg'].artist, 'неизвестный автор');
  assert.equal(by['Igo.jpg'].license, 'CC BY-SA 3.0 IGO');
  assert.equal(freeLicense('CC BY 3.0 IGO'), 'CC BY 3.0 IGO');
});

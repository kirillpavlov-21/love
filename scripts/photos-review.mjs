#!/usr/bin/env node
/* Осмотр новых фото мест перед Pull Request: на сайте не должно быть лиц людей (и портретов — фото, живописи, мозаики;
   скульптуры и далёкая толпа без различимых лиц — можно).
     node scripts/photos-review.mjs [--base origin/main]
       — фото в assets/ph, добавленные или изменённые относительно base: детектор лиц + контактный лист
         ~/.kuda/photos-review/<дата>-<n>.jpg (по 12 снимков, подпись — id места), пути печатает строками REVIEW_SHEET=…
     node scripts/photos-review.mjs --reject id1,id2 [--why "не то место"]
       — убрать фото этих мест: строки в assets/photos.js (и у мест, где это фото общее), файлы webp,
         снимок — в scripts/photos-blocked.json, чтобы его не взяли снова */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { facesIn, addBlocked } from '../pipeline/lib/faces.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const arg = k => { const i = ARGS.indexOf(k); return i >= 0 ? ARGS[i + 1] : ''; };
const TODAY = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const GIT = fs.existsSync('/Library/Developer/CommandLineTools/usr/bin/git') ? '/Library/Developer/CommandLineTools/usr/bin/git' : 'git';

/* убрать фото мест ids; вернуть id всех мест, у которых его не стало.
   Снимок ищем по файлу картинки: общий кадр (4-й элемент — id картинки) убираем у всех мест, кто его показывает,
   с какой бы стороны ни назвали; фото новых мест конвейера лежат в assets/auto.js (поле ph) — их тоже */
export function reject(ids, why = 'лица людей') {
  const f = path.join(ROOT, 'assets/photos.js');
  const rows = fs.readFileSync(f, 'utf8').split('\n').map(l => {
    const m = l.match(/^\s*"([^"]+)":\s*(\[.*\]),?\s*$/);
    return m ? { l, id: m[1], v: JSON.parse(m[2]), img: JSON.parse(m[2])[3] || m[1] } : { l };
  });
  const imgs = new Set(ids);
  rows.forEach(r => { if (r.id && ids.includes(r.id)) imgs.add(r.img); });
  const gone = [], keys = [];
  fs.writeFileSync(f, rows.filter(r => {
    if (!r.id || !imgs.has(r.img)) return true;
    gone.push(r.id); keys.push(r.v[4] ? r.v[4].u : r.v[0]);
    return false;
  }).map(r => r.l).join('\n'));
  // auto.js: данные — JSON в вызове })({…});
  const af = path.join(ROOT, 'assets/auto.js');
  if (fs.existsSync(af)) {
    const src = fs.readFileSync(af, 'utf8'), at = src.lastIndexOf('})(');
    const data = at > 0 ? JSON.parse(src.slice(at + 3).replace(/\);\s*$/, '')) : null;
    let changed = false;
    for (const [id, pl] of Object.entries((data && data.places) || {})) {
      const img = pl && pl.ph && path.basename(String(pl.ph.s || ''), '.webp');
      if (!img || !(imgs.has(img) || ids.includes(id))) continue;
      imgs.add(img); gone.push(id); keys.push(pl.ph.file || pl.ph.u); delete pl.ph; changed = true;
    }
    if (changed) fs.writeFileSync(af, src.slice(0, at + 3) + JSON.stringify(data, null, 2) + ');\n');
  }
  for (const img of imgs) for (const p of [`assets/ph/${img}.webp`, `assets/ph/t/${img}.webp`]) fs.rmSync(path.join(ROOT, p), { force: true });
  addBlocked(ROOT, keys, why);
  return [...new Set(gone)];
}

async function review(base) {
  let names = [];
  try {
    names = execFileSync(GIT, ['-C', ROOT, 'diff', '--name-only', '--diff-filter=AM', base, '--', 'assets/ph'], { encoding: 'utf8' }).split('\n');
  } catch (e) { console.error(`git diff с ${base} не вышел: ${e.message}`); process.exit(1); }
  // новые файлы, ещё не в индексе
  names = names.concat(execFileSync(GIT, ['-C', ROOT, 'ls-files', '--others', '--exclude-standard', '--', 'assets/ph'], { encoding: 'utf8' }).split('\n'));
  const files = [...new Set(names.filter(n => /^assets\/ph\/[^/]+\.webp$/.test(n)))].filter(n => fs.existsSync(path.join(ROOT, n)));
  if (!files.length) { console.log('REVIEW_NONE=1 (новых фото нет)'); return; }
  const faces = await facesIn(files.map(f => path.join(ROOT, f)));
  const flagged = faces ? files.filter(f => faces[path.join(ROOT, f)] > 0).map(f => path.basename(f, '.webp')) : [];
  const unchecked = faces ? files.filter(f => !(faces[path.join(ROOT, f)] >= 0)).map(f => path.basename(f, '.webp')) : [];
  console.log(faces ? `FACES_FOUND=${flagged.join(',')}` : 'FACES_FOUND=? (детектор недоступен — только осмотр)');
  if (unchecked.length) console.log(`FACES_UNCHECKED=${unchecked.join(',')} (детектор не смог прочитать — смотреть особенно внимательно)`);

  const sharp = createRequire(path.join(ROOT, 'pipeline/package.json'))('sharp');
  const out = path.join(os.homedir(), '.kuda', 'photos-review');
  fs.mkdirSync(out, { recursive: true });
  const W = 640, H = 430, C = 3, PER = 12;
  for (let s = 0; s * PER < files.length; s++) {
    const chunk = files.slice(s * PER, (s + 1) * PER), rows = Math.ceil(chunk.length / C), comp = [];
    for (let i = 0; i < chunk.length; i++) {
      const x = (i % C) * W, y = Math.floor(i / C) * (H + 26), id = path.basename(chunk[i], '.webp');
      comp.push({ input: await sharp(path.join(ROOT, chunk[i])).resize(W - 6, H, { fit: 'contain', background: '#000' }).toBuffer(), left: x, top: y });
      const label = id.replace(/[<&>]/g, '') + (flagged.includes(id) ? ' — ЛИЦО?' : '');
      comp.push({ input: Buffer.from(`<svg width="${W}" height="26"><rect width="100%" height="100%" fill="#fff"/><text x="6" y="19" font-size="17" font-family="Arial">${label}</text></svg>`), left: x, top: y + H });
    }
    const file = path.join(out, `${TODAY}-${s + 1}.jpg`);
    await sharp({ create: { width: W * C, height: rows * (H + 26), channels: 3, background: '#888' } }).composite(comp).jpeg({ quality: 82 }).toFile(file);
    console.log(`REVIEW_SHEET=${file}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (ARGS.includes('--reject')) {
    const ids = arg('--reject').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) { console.error('--reject id1,id2'); process.exit(1); }
    console.log(`REJECTED=${reject(ids, arg('--why') || undefined).join(',')}`);
  } else await review(arg('--base') || 'origin/main');
}

/* Лица людей на фото: на сайте их быть не должно (правило каталога). Проверка — FaceDetector в Chrome без окна
   (Shape Detection API; включается флагом --enable-experimental-web-platform-features, на macOS работает через Vision).
   Мелкие лица в толпе детектор пропускает, поэтому новые фото ещё раз смотрят глазами (scripts/photos-review.mjs).
   Нужны Google Chrome и playwright-core: путь к модулю — KUDA_PLAYWRIGHT, иначе ищем рядом.
     facesIn(['assets/ph/x.webp', …]) → { 'assets/ph/x.webp': число лиц, -1 — файл не прочитался } или null, если проверить нечем */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const CHROME = process.env.KUDA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PW = [process.env.KUDA_PLAYWRIGHT, path.join(os.homedir(), 'influencer-agent/node_modules/playwright-core')].filter(Boolean);

function playwright() {
  const req = createRequire(import.meta.url);
  for (const p of [...PW, 'playwright-core']) { try { return req(p); } catch { /* следующий */ } }
  return null;
}

/* Отклонённые снимки — scripts/photos-blocked.json: { "<файл Commons или адрес страницы фото>": "причина" }.
   Их больше не предлагаем ни одному месту */
const blockedPath = root => path.join(root, 'scripts/photos-blocked.json');
/* ключ снимка для сравнения: без «File:», расширения и подчёркиваний — один и тот же кадр приходит с Commons и через Openverse по-разному */
export const photoKey = s => String(s || '').replace(/^File:/i, '').replace(/\.(jpe?g|png|webp|tiff?|gif)$/i, '').replace(/_/g, ' ').normalize('NFC').trim().toLowerCase();
export function loadBlocked(root) {
  try { return JSON.parse(fs.readFileSync(blockedPath(root), 'utf8')); } catch { return {}; }
}
export function addBlocked(root, keys, why = 'лица людей') {
  const b = loadBlocked(root);
  keys.filter(Boolean).forEach(k => { b[k] = why; });
  fs.writeFileSync(blockedPath(root), JSON.stringify(b, null, 1) + '\n');
}

export async function facesIn(files) {
  const pw = playwright();
  if (!pw || !fs.existsSync(CHROME) || !files.length) return null;
  let browser;
  try { browser = await pw.chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-experimental-web-platform-features'] }); }
  catch { return null; }   // Chrome не запустился — проверим только глазами
  try {
    const page = await browser.newPage();
    // FaceDetector есть только в защищённом контексте — отдаём пустую страницу с https-адреса, в сеть не ходим
    await page.route('https://faces.invalid/', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>faces</title>' }));
    await page.goto('https://faces.invalid/').catch(() => null);
    if (!(await page.evaluate(() => 'FaceDetector' in window).catch(() => false))) return null;
    const out = {};
    for (const f of files) {
      const mime = /\.png$/i.test(f) ? 'image/png' : /\.jpe?g$/i.test(f) ? 'image/jpeg' : 'image/webp';
      const src = `data:${mime};base64,` + fs.readFileSync(f).toString('base64');
      out[f] = await page.evaluate(async src => {
        const img = new Image(); img.src = src; await img.decode();
        return (await new FaceDetector({ fastMode: false, maxDetectedFaces: 10 }).detect(img)).length;
      }, src).catch(() => -1);
    }
    return out;
  } finally { await browser.close(); }
}

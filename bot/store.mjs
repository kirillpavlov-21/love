/* Хранилище бота: get(k) → значение или null, set(k, v, ttlSec), del(k). Ключи: u:<id> — город и режим человека,
   q:<id> — запрос и показанные планы (кнопки «Ещё», «Опрос»), v:<id> — голосование кнопками (варианты и голоса).
   memoryStore — для тестов; fileStore — JSON-файл (бот на ноутбуке или на своём сервере): пишется с задержкой и атомарно
   (временный файл → rename), просроченное вычищается при загрузке и раз в час. Файл — вне репозитория (по умолчанию ~/.kuda/bot-store.json). */
import fs from 'node:fs';
import path from 'node:path';

export function memoryStore() {
  const m = new Map();
  return {
    async get(k) { const x = m.get(k); if (!x) return null; if (x.e && x.e < Date.now()) { m.delete(k); return null; } return x.v; },
    async set(k, v, ttl) { m.set(k, { v, e: ttl ? Date.now() + ttl * 1000 : 0 }); },
    async del(k) { m.delete(k); },
    size: () => m.size,
  };
}

export function fileStore(file) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { data = {}; }
  const sweep = () => { const t = Date.now(); for (const k of Object.keys(data)) if (data[k] && data[k].e && data[k].e < t) delete data[k]; };
  sweep();
  let timer = null;
  const flush = () => {
    timer = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  };
  const later = () => { if (!timer) timer = setTimeout(flush, 500); };
  setInterval(() => { sweep(); later(); }, 3600e3).unref();
  return {
    async get(k) { const x = data[k]; if (!x) return null; if (x.e && x.e < Date.now()) { delete data[k]; later(); return null; } return x.v; },
    async set(k, v, ttl) { data[k] = { v, e: ttl ? Date.now() + ttl * 1000 : 0 }; later(); },
    async del(k) { delete data[k]; later(); },
    flush: () => { if (timer) { clearTimeout(timer); flush(); } },
    size: () => Object.keys(data).length,
  };
}

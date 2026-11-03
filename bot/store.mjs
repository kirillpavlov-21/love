/* Хранилище бота: get(k) → значение или null, set(k, v, ttlSec), del(k). Ключи: u:<id> — город и режим человека,
   q:<id> — запрос и показанные планы (кнопки «Ещё», «Опрос»), v:<id> — голосование кнопками (варианты и голоса),
   d:<id> — черновики голосований человека из inline-режима.
   memoryStore — для тестов; fileStore — JSON-файл (бот на ноутбуке или на своём сервере): пишется в фоне не чаще раза в секунду
   и атомарно (временный файл → rename), файл и папка — только для владельца (0600 / 0700): там id и имена из Telegram.
   Просроченное вычищается при загрузке и раз в час. Файл — вне репозитория (по умолчанию ~/.kuda/bot-store.json). */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export function memoryStore() {
  const m = new Map();
  return {
    async get(k) { const x = m.get(k); if (!x) return null; if (x.e && x.e < Date.now()) { m.delete(k); return null; } return x.v; },
    async set(k, v, ttl) { m.set(k, { v, e: ttl ? Date.now() + ttl * 1000 : 0 }); },
    async del(k) { m.delete(k); },
    flush: () => {},
    size: () => m.size,
  };
}

export function fileStore(file) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { data = {}; }
  const sweep = () => { const t = Date.now(); for (const k of Object.keys(data)) if (data[k] && data[k].e && data[k].e < t) delete data[k]; };
  sweep();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let timer = null, writing = null, dirty = false;
  const tmp = file + '.tmp';
  async function write() {
    timer = null;
    if (writing) { dirty = true; return; }   // запись уже идёт — повторим после неё
    dirty = false;
    writing = fsp.writeFile(tmp, JSON.stringify(data), { mode: 0o600 }).then(() => fsp.rename(tmp, file))
      .catch(e => console.error('хранилище бота не записалось:', e.message))
      .finally(() => { writing = null; if (dirty) later(); });
  }
  const later = () => { if (!timer) timer = setTimeout(write, 1000); };
  setInterval(() => { sweep(); later(); }, 3600e3).unref();
  return {
    async get(k) { const x = data[k]; if (!x) return null; if (x.e && x.e < Date.now()) { delete data[k]; later(); return null; } return x.v; },
    async set(k, v, ttl) { data[k] = { v, e: ttl ? Date.now() + ttl * 1000 : 0 }; later(); },
    async del(k) { delete data[k]; later(); },
    /* при остановке процесса — синхронно, чтобы последние голоса не потерялись */
    flush: () => { if (timer) clearTimeout(timer); timer = null; fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 }); fs.renameSync(tmp, file); },
    size: () => Object.keys(data).length,
  };
}

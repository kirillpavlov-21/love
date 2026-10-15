#!/usr/bin/env node
/* Ответить в issues ящика и закрыть их — последним шагом, когда PR уже создан и состояние сохранено.
   run.mjs пишет список в pipeline-inbox.json: [{ number, comment }]. Если шаг не дошёл до конца,
   issue остаётся открытым и разберётся заново в следующий запуск — заявка не теряется.
   Запуск: GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/name node pipeline/close-inbox.mjs [pipeline-inbox.json] */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { closeInboxItem } from './lib/sources/inbox.mjs';

/* → { closed: [номера], failed: [номера] } */
export async function closeInboxFile(file, { repo, token, fetchImpl = globalThis.fetch, log = s => console.error(s) } = {}) {
  let list;
  try { list = JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return { closed: [], failed: [] };
    throw new Error(`${file}: не читается или не JSON`);
  }
  const closed = [], failed = [];
  for (const it of Array.isArray(list) ? list : []) {
    try {
      await closeInboxItem({ repo, token, number: it && it.number, comment: it && it.comment, fetchImpl });
      closed.push(it.number);
    } catch (e) {
      failed.push(it && it.number);
      log(`inbox #${it && it.number}: ${e.message}`);
    }
  }
  return { closed, failed };
}

const isCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isCli) {
  const file = path.resolve(process.argv[2] || 'pipeline-inbox.json');
  closeInboxFile(file, { repo: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN }).then(r => {
    console.log(`закрыто issues ящика: ${r.closed.length}` + (r.failed.length ? `, не удалось: ${r.failed.map(n => '#' + n).join(', ')}` : ''));
    if (r.failed.length) process.exitCode = 1;
  }, e => {
    console.error(`Ошибка: ${e.message}`);
    process.exitCode = 1;
  });
}

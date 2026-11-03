/* Клиент Telegram Bot API без зависимостей: api(method, params) → result, ошибка — исключение с .code и .description.
   429 (слишком часто) — ждём retry_after и повторяем, не больше трёх раз. Токен — из окружения (TG_TOKEN) или файла ~/.kuda/tg-token, в репозитории его нет.
   params._timeout — своё время ожидания ответа в мс (long polling getUpdates ждёт дольше обычного). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// TG_TOKEN, иначе файл TG_TOKEN_FILE (по умолчанию ~/.kuda/tg-token, права только у владельца) — чтобы токен не жил в истории команд
export function botToken(env = process.env) {
  if (env.TG_TOKEN) return env.TG_TOKEN.trim();
  const file = env.TG_TOKEN_FILE || path.join(os.homedir(), '.kuda', 'tg-token');
  try {
    if (fs.statSync(file).mode & 0o077) fs.chmodSync(file, 0o600);
    return fs.readFileSync(file, 'utf8').trim();
  } catch { return ''; }
}

export function telegram(token, opts = {}) {
  if (!token) throw new Error('нет токена бота: задай TG_TOKEN или положи его в ~/.kuda/tg-token (bot/README.md)');
  const base = (opts.base || 'https://api.telegram.org') + '/bot' + token + '/';
  return async function api(method, params = {}) {
    const { _timeout, ...body } = params;
    for (let i = 0; ; i++) {
      const r = await fetch(base + method, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(_timeout || opts.timeout || 30000),
      });
      const j = await r.json().catch(() => ({ ok: false, error_code: r.status, description: 'HTTP ' + r.status }));
      if (j.ok) return j.result;
      if (j.error_code === 429 && i < 3) { await new Promise(res => setTimeout(res, Math.min(30, (j.parameters && j.parameters.retry_after) || 1) * 1000)); continue; }
      const e = new Error(method + ': ' + (j.description || 'ошибка Telegram'));
      e.code = j.error_code; e.description = j.description || '';
      throw e;
    }
  };
}

/* Клиент Telegram Bot API без зависимостей: api(method, params) → result, ошибка — исключение с .code и .description.
   429 (слишком часто) — ждём retry_after и повторяем, не больше трёх раз. Токен приходит из окружения (TG_TOKEN), в репозитории его нет.
   params._timeout — своё время ожидания ответа в мс (long polling getUpdates ждёт дольше обычного). */
export function telegram(token, opts = {}) {
  if (!token) throw new Error('нет токена бота: TG_TOKEN');
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

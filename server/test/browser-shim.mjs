/* assets/api.js в node:vm с минимальным «браузером»: window, localStorage, sessionStorage, document, fetch, crypto.
   fetch добавляет заголовок Origin, как настоящий браузер на странице сайта. */
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const API_JS = fileURLToPath(new URL('../../assets/api.js', import.meta.url));

function storage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), _m: m };
}

/**
 * @param {string} url — config.js → api.url
 * @param {object} [o]
 * @param {string} [o.origin] — Origin страницы
 * @param {boolean} [o.noSubtle] — без crypto.subtle (проверка запасного SHA-256)
 * @param {number} [o.timeScale] — ускорить таймеры опроса (0.01 → 15 с превращаются в 150 мс)
 * @param {boolean} [o.fastTimeouts] — ускорять и таймауты запросов (4 и 6 с); иначе под нагрузкой
 *   параллельных тестов запрос к живому серверу не успевал бы за 40 мс
 */
export function loadApi(url, o = {}) {
  const origin = o.origin || 'http://localhost:8765';
  const scale = o.timeScale || 1;
  const listeners = new Map();
  const document = {
    hidden: false,
    addEventListener: (t, f) => listeners.set(t, (listeners.get(t) || []).concat(f)),
    removeEventListener: (t, f) => listeners.set(t, (listeners.get(t) || []).filter(x => x !== f)),
  };
  const requests = [];
  const fetchShim = (u, init = {}) => {
    requests.push({ url: u, method: init.method || 'GET', body: init.body });
    return globalThis.fetch(u, { ...init, headers: { ...(init.headers || {}), Origin: origin } });
  };
  const window = {
    DATE_CONFIG: { api: { url } },
    localStorage: o.localStorage || storage(),
    sessionStorage: storage(),
    crypto: o.noSubtle ? { getRandomValues: a => globalThis.crypto.getRandomValues(a) } : globalThis.crypto,
  };
  const ctx = vm.createContext({
    window, document, fetch: fetchShim, console, AbortController, URLSearchParams, TextEncoder, btoa, atob,
    setTimeout: (f, ms) => setTimeout(f, (ms === 4000 || ms === 6000) && !o.fastTimeouts ? ms : (ms || 0) * scale), clearTimeout,
  });
  vm.runInContext(readFileSync(API_JS, 'utf8'), ctx, { filename: 'assets/api.js' });
  return {
    api: window.KudaAPI, window, document, requests,
    setHidden(h) { document.hidden = h; for (const f of listeners.get('visibilitychange') || []) f(); },
    listeners: t => (listeners.get(t) || []).length,
  };
}

/* Вход через Яндекс ID без своего сервера (OAuth 2.0, response_type=token).
   1) Кнопка «Войти» уводит на oauth.yandex.ru, Яндекс возвращает на start.html с #access_token=…
   2) Берём имя и аватар из login.yandex.ru/info и храним их только в этом браузере (localStorage).
   3) Сам токен — только в sessionStorage этой вкладки, до её закрытия или выхода: KudaAuth.token() отдаёт его
      модулю отзывов, а наш сервер проверяет его в login.yandex.ru и ставит отметку «вошёл через Яндекс ID».
      Токен никуда больше не уходит и не пишется в журнал.
   Настройка: config.js → auth.yandexClientId (как зарегистрировать приложение — docs/yandex-login.md). */
(function () {
  'use strict';

  const CFG = window.DATE_CONFIG || {};
  const CLIENT = (CFG.auth && CFG.auth.yandexClientId) || '';
  const KEY = 'kuda-user', STATE = 'kuda-oauth-state', BACK = 'kuda-oauth-back', TOKEN = 'kuda-ya-token';
  const TOKEN_RE = /^[A-Za-z0-9._-]{10,400}$/;   // как проверяет сервер отзывов
  const ls = {
    get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } },
    set(v) { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (e) { /* ок */ } },
  };
  /* Токен: { t, exp } в sessionStorage; exp — когда истекает (мс), 0 — срок не сообщили */
  const tok = {
    get() {
      try {
        const v = JSON.parse(sessionStorage.getItem(TOKEN) || 'null');
        if (!v || typeof v.t !== 'string' || !TOKEN_RE.test(v.t)) return '';
        if (v.exp && Date.now() >= v.exp) { sessionStorage.removeItem(TOKEN); return ''; }
        return v.t;
      } catch (e) { return ''; }
    },
    set(t, sec) {
      try {
        if (!t || !TOKEN_RE.test(t)) { sessionStorage.removeItem(TOKEN); return; }
        // с запасом в минуту, чтобы не отправить токен, который истечёт по дороге
        const s = parseInt(sec, 10), exp = s > 0 ? Date.now() + Math.max(0, s - 60) * 1000 : 0;
        sessionStorage.setItem(TOKEN, JSON.stringify({ t, exp }));
      } catch (e) { /* хранилище недоступно — войдём без отметки в отзывах */ }
    },
  };
  /* Адрес возврата — всегда главная: там нет своего #-хэша (в игре хэш занят приглашением) */
  const redirectUri = () => new URL('start.html', location.href).href.split('#')[0].split('?')[0];
  const enabled = () => !!CLIENT;

  function login() {
    if (!CLIENT) return false;
    const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { sessionStorage.setItem(STATE, state); sessionStorage.setItem(BACK, location.href); } catch (e) { /* ок */ }
    location.href = 'https://oauth.yandex.ru/authorize?' + new URLSearchParams({
      response_type: 'token', client_id: CLIENT, redirect_uri: redirectUri(), state, force_confirm: 'no',
    });
    return true;
  }
  function logout() {
    tok.set('');
    ls.set(null);
    document.dispatchEvent(new CustomEvent('kuda-auth', { detail: null }));
  }
  /* Токен для проверки на сервере отзывов: строка или '' (не входили в этой вкладке, истёк, вышли) */
  const token = () => (ls.get() ? tok.get() : '');

  async function profile(access) {
    try {
      const r = await fetch('https://login.yandex.ru/info?format=json', { headers: { Authorization: 'OAuth ' + access } });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      return {
        id: j.psuid || j.id || '', name: j.first_name || j.display_name || j.real_name || j.login || 'Ты',
        avatar: j.default_avatar_id && !j.is_avatar_empty ? `https://avatars.yandex.net/get-yapic/${j.default_avatar_id}/islands-68` : '',
        ts: Date.now(),
      };
    } catch (e) {
      // профиль не отдали (сеть, блокировщик) — всё равно считаем, что человек вошёл
      return { id: '', name: 'Ты', avatar: '', ts: Date.now() };
    }
  }

  /* Возврат с oauth.yandex.ru: #access_token=…&expires_in=…&state=… */
  async function handleReturn() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.get('access_token') && !h.get('error')) return null;
    let want = '', back = '';
    try { want = sessionStorage.getItem(STATE) || ''; back = sessionStorage.getItem(BACK) || ''; sessionStorage.removeItem(STATE); sessionStorage.removeItem(BACK); } catch (e) { /* ок */ }
    // токен — сразу из адреса: не остаётся ни в строке браузера, ни в истории
    history.replaceState(null, '', location.pathname + location.search);
    if (h.get('error') || !want || h.get('state') !== want) return { error: h.get('error') || 'state' };
    const access = h.get('access_token') || '';
    const user = await profile(access);
    tok.set(access, h.get('expires_in'));
    ls.set(user);
    if (window.KudaTrack) window.KudaTrack.ev('login', { v: 'yandex' });
    document.dispatchEvent(new CustomEvent('kuda-auth', { detail: user }));
    if (back && back.split('#')[0] !== location.href.split('#')[0]) location.replace(back);
    return { user };
  }

  window.KudaAuth = { enabled, login, logout, user: ls.get, token, handleReturn };
})();

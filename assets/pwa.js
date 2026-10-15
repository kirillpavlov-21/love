/* «Куда идём?» как приложение на телефоне — window.KudaPWA
   ─ Регистрирует sw.js (только https или localhost, не во фрейме): быстрый повторный заход и офлайн.
   ─ Ловит beforeinstallprompt (Android, Chrome и Яндекс Браузер на компьютере) — системное окно установки
     открывается по нашей кнопке, а не всплывает само.
   ─ На iPhone и iPad системного окна нет — по кнопке показываем подсказку «Поделиться → На экран „Домой“».
   API: canInstall() → можно предложить установку; install() → Promise<'accepted'|'dismissed'|'ios'|'installed'|'unavailable'>;
        installButton(container, { label, className }) → кнопка, которая сама прячется, когда установка недоступна;
        installed() → сайт открыт как приложение; ready → Promise<регистрация service worker | null>.
   Изменения — событие document 'kuda-pwa' ({ detail: { canInstall, installed } }).
   Цель Метрики pwa_install — один раз на устройство: после установки или при первом запуске с экрана «Домой». */
(function () {
  'use strict';
  if (window.KudaPWA) return;

  const script = document.currentScript;
  /* Папка сайта — от адреса этого файла (assets/pwa.js → ../), чтобы работало и со страниц во вложенных папках */
  const ROOT = (() => {
    try { if (script && script.src) return new URL('../', script.src); } catch (e) { /* ниже — от страницы */ }
    return new URL('./', location.href);
  })();
  const framed = (() => { try { return window.top !== window.self; } catch (e) { return true; } })();
  const secure = location.protocol === 'https:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  /* Не Safari: Chrome, Firefox, Edge, Яндекс Браузер, Opera или встроенный браузер приложения */
  const OTHER_IOS = isIOS && /CriOS|FxiOS|EdgiOS|YaBrowser|OPiOS|OPT\/|GSA\/|Instagram|FBAN|FBAV|VKClient|Telegram|MicroMessenger/.test(ua);
  const NAME = ((window.DATE_CONFIG || {}).site || {}).name || 'Куда идём?';

  /* ---------- service worker ---------- */
  const ready = new Promise(done => {
    if (!secure || framed || !('serviceWorker' in navigator)) return done(null);
    const go = () => navigator.serviceWorker.register(new URL('sw.js', ROOT).href, { scope: ROOT.href, updateViaCache: 'none' })
      .then(done, () => done(null));
    /* после загрузки страницы — не отнимаем сеть у картинок и скриптов */
    if (document.readyState === 'complete') setTimeout(go, 0); else window.addEventListener('load', () => setTimeout(go, 0), { once: true });
  });

  /* ---------- установка ---------- */
  let deferred = null;
  const installed = () => {
    try { if (window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: minimal-ui)').matches)) return true; } catch (e) { /* старый браузер */ }
    return navigator.standalone === true;
  };
  const canInstall = () => !framed && !installed() && (!!deferred || isIOS);
  function changed() {
    try { document.dispatchEvent(new CustomEvent('kuda-pwa', { detail: { canInstall: canInstall(), installed: installed() } })); } catch (e) { /* без события */ }
  }
  /* Цель Метрики — один раз на устройство. На странице без assets/track.js не отмечаем:
     посчитаем при запуске с экрана «Домой» — приложение открывается на главной, а там track.js есть */
  function counted(how) {
    const T = window.KudaTrack;
    if (!T || typeof T.ev !== 'function') return;
    try {
      if (localStorage.getItem('kuda-pwa')) return;
      localStorage.setItem('kuda-pwa', how);
    } catch (e) { return; }
    T.ev('pwa_install', { v: how });
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();   // без самовольной плашки браузера — установка по нашей кнопке
    deferred = e;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    counted('prompt');
    changed();
  });
  if (installed()) counted(isIOS ? 'ios' : 'launch');

  async function install() {
    if (installed()) return 'installed';
    if (deferred) {
      const e = deferred;
      deferred = null;   // одно событие — одно окно; браузер пришлёт новое, если человек передумает
      changed();
      try {
        await e.prompt();
        const choice = await e.userChoice;
        return choice && choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
      } catch (err) {
        return 'unavailable';
      }
    }
    if (isIOS && !framed) { iosHint(); return 'ios'; }
    return 'unavailable';
  }

  /* ---------- оформление (своё: страницы сайта подключают разные стили) ---------- */
  function css() {
    if (document.getElementById('kpwa-css')) return;
    const s = document.createElement('style');
    s.id = 'kpwa-css';
    s.textContent = [
      '.kpwa-btn[hidden],.kpwa-bg[hidden]{display:none!important}',
      ':where(.kpwa-btn){display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 18px;border-radius:14px;border:1px solid var(--line-2,rgba(244,241,234,.16));background:transparent;color:var(--text,#F4F1EA);font:600 15px/1.2 var(--body,system-ui,-apple-system,sans-serif);cursor:pointer}',
      '.kpwa-btn svg{width:18px;height:18px;flex:none}',
      '.kpwa-bg{position:fixed;inset:0;z-index:1000;display:flex;align-items:flex-end;justify-content:center;padding:16px 16px calc(16px + env(safe-area-inset-bottom));background:rgba(8,7,11,.62)}',
      '.kpwa-sheet{width:100%;max-width:420px;max-height:calc(100vh - 32px);overflow:auto;padding:22px 20px 18px;border-radius:24px;border:1px solid var(--line-2,rgba(244,241,234,.16));background:var(--surface,#1A1920);color:var(--text,#F4F1EA);font:500 15px/1.5 var(--body,system-ui,-apple-system,sans-serif);box-shadow:0 18px 48px rgba(0,0,0,.5)}',
      '.kpwa-sheet h2{margin:0 0 12px;font:700 19px/1.25 var(--display,var(--body,system-ui,sans-serif))}',
      '.kpwa-sheet ol{margin:0 0 16px;padding-left:22px}',
      '.kpwa-sheet li{margin:0 0 8px;color:var(--muted-2,#C9C5D2)}',
      '.kpwa-sheet li b{color:var(--text,#F4F1EA)}',
      '.kpwa-sheet li svg{width:18px;height:18px;vertical-align:-3px;margin:0 2px;color:var(--accent,#FF6F91)}',
      '.kpwa-note{margin:0 0 16px;color:var(--muted,#A39EAE);font-size:13px;line-height:1.45}',
      '.kpwa-note b{color:var(--muted-2,#C9C5D2)}',
      '.kpwa-ok{display:flex;width:100%;align-items:center;justify-content:center;min-height:50px;border:0;border-radius:16px;background:var(--accent,#FF6F91);color:var(--on-accent,#1C0A10);font:700 16px var(--body,system-ui,-apple-system,sans-serif);cursor:pointer}',
      '.kpwa-ok:focus-visible,.kpwa-btn:focus-visible{outline:2px solid var(--accent,#FF6F91);outline-offset:3px}',
      '@media (min-width:620px){.kpwa-bg{align-items:center}}',
    ].join('\n');
    document.head.appendChild(s);
  }
  const SVG = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + d + '</svg>';
  const IC_INSTALL = SVG('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 7.5v7"/><path d="M9 11.5l3 3 3-3"/>');
  const IC_SHARE = SVG('<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>');
  const IC_ADD = SVG('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/>');

  /* Подсказка для iPhone и iPad: доступное модальное окно, Esc и фон закрывают, фокус возвращается на кнопку */
  function iosHint() {
    css();
    const back = document.activeElement;
    const bg = document.createElement('div');
    bg.className = 'kpwa-bg';
    /* Где кнопка «Поделиться»: в Safari на iPhone — внизу, а в новых iOS она спрятана в меню «•••» у адреса;
       в Chrome и других браузерах — у адресной строки */
    const where = OTHER_IOS
      ? 'в браузере — обычно эта кнопка у адресной строки.'
      : '— на iPhone внизу экрана Safari (если её не видно, сначала нажми <b>«•••»</b> рядом с адресом), на iPad вверху справа.';
    bg.innerHTML = '<div class="kpwa-sheet" role="dialog" aria-modal="true" aria-labelledby="kpwa-t">' +
      '<h2 id="kpwa-t"></h2><ol>' +
      '<li>Нажми <b>«Поделиться»</b> ' + IC_SHARE + ' ' + where + '</li>' +
      '<li>Выбери <b>«На экран „Домой“»</b> ' + IC_ADD + '. Не видно — пролистай список вниз или нажми <b>«Ещё»</b>.</li>' +
      '<li>Нажми <b>«Добавить»</b> — иконка появится рядом с приложениями.</li>' +
      '</ol><p class="kpwa-note">Нет такого пункта? Похоже, страница открыта внутри мессенджера или в браузере, который так не умеет. Открой её в Safari (в мессенджере — меню <b>«…»</b> → <b>«Открыть в Safari»</b>) и повтори.</p>' +
      '<button type="button" class="kpwa-ok">Понятно</button></div>';
    bg.querySelector('#kpwa-t').textContent = 'Добавь «' + NAME + '» на экран «Домой»';
    const ok = bg.querySelector('.kpwa-ok');
    function close() {
      document.removeEventListener('keydown', onKey, true);
      bg.remove();
      if (back && typeof back.focus === 'function') { try { back.focus(); } catch (e) { /* ок */ } }
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') { e.preventDefault(); ok.focus(); }   // в окне одна кнопка — фокус не уходит за его пределы
    }
    ok.addEventListener('click', close);
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(bg);
    ok.focus();
  }

  /* Кнопка «Установить приложение»: видна, только когда установка возможна */
  function installButton(container, opts) {
    opts = opts || {};
    if (typeof container === 'string') container = document.querySelector(container);
    if (!container || framed) return null;
    css();
    const b = document.createElement('button');
    b.type = 'button';
    b.className = (opts.className == null ? 'btn ghost' : opts.className) + ' kpwa-btn';
    b.innerHTML = IC_INSTALL + '<span></span>';
    b.querySelector('span').textContent = opts.label || 'Установить приложение';
    const sync = () => { b.hidden = !canInstall(); };
    b.addEventListener('click', () => {
      install().then(r => {
        sync();
        if (typeof opts.onResult === 'function') { try { opts.onResult(r); } catch (e) { setTimeout(() => { throw e; }); } }
      });
    });
    document.addEventListener('kuda-pwa', sync);
    sync();
    container.appendChild(b);
    return b;
  }

  window.KudaPWA = { canInstall, install, installButton, installed, ready };
})();

/* Главная как Telegram Mini App: бот открывает start.html?tg=1 (кнопка «Открыть приложение», меню чата, «Подробнее» у плана).
   ─ шапка, фон и нижняя панель Telegram — в цвет сайта, свайп вниз не закрывает приложение посреди прокрутки;
   ─ системная «Назад» закрывает открытую шторку (шторки живут в истории — DateKit.sheet);
   ─ «Голосование в Telegram» (t.me/<бот>?start=poll_…) — сразу выбор чата через inline-режим бота, плюс большая кнопка внизу;
   ─ остальные ссылки t.me открываются внутри Telegram, нажатия — с лёгкой вибрацией.
   Библиотеку telegram-web-app.js start.html грузит асинхронно: нет её (медленная сеть, открыли не в Telegram) — сайт работает как обычно */
(function () {
  'use strict';

  const BG = '#0F0E13', ACCENT = '#FF6F91', ON_ACCENT = '#1C0A10';
  const POLL = /^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}\?start=poll_((?:[a-z0-9]{6}_){1,7}[a-z0-9]{6})$/i;
  let tries = 0;
  (function wait() {
    const W = window.Telegram && window.Telegram.WebApp;
    if (W && typeof W.ready === 'function') init(W);
    else if (++tries < 80) setTimeout(wait, 100);   // до 8 с: в Telegram библиотека обычно уже в кэше
  })();

  function init(W) {
    const at = v => typeof W.isVersionAtLeast === 'function' && W.isVersionAtLeast(v);
    const safe = f => { try { f(); } catch (e) { /* старый клиент Telegram — без этой мелочи */ } };
    const haptic = kind => safe(() => { if (kind) W.HapticFeedback.impactOccurred(kind); else W.HapticFeedback.selectionChanged(); });
    safe(() => W.ready());
    safe(() => W.expand());
    if (at('6.1')) { safe(() => W.setHeaderColor(BG)); safe(() => W.setBackgroundColor(BG)); }
    if (at('7.10')) safe(() => W.setBottomBarColor(BG));
    if (at('7.7')) safe(() => W.disableVerticalSwipes());
    document.documentElement.dataset.tgPlatform = W.platform || '';

    const sheetOpen = () => document.body.classList.contains('sheet-open');
    const pollLink = () => document.querySelector('a[data-now-tg]');
    // голосование: inline-запрос «опрос <номер> <номер>…» — бот соберёт карточку с кнопками в выбранном чате
    function vote(a) {
      const m = POLL.exec(a.href);
      if (!m || !at('6.7')) return false;
      haptic('medium');
      safe(() => W.switchInlineQuery('опрос ' + m[1].split('_').join(' '), ['users', 'groups', 'supergroups']));
      return true;
    }

    // «Назад» — пока открыта шторка; большая кнопка внизу — голосование, когда шторок нет и вариантов хотя бы два
    const main = at('6.1') && W.MainButton;
    if (main) {
      safe(() => W.MainButton.setParams(Object.assign({ text: '🗳️ Голосование в чат', color: ACCENT, text_color: ON_ACCENT }, at('7.10') ? { has_shine_effect: true } : null)));
      W.MainButton.onClick(() => { const a = pollLink(); if (a) vote(a); });
    }
    // вторая кнопка внизу — «Позвать»: приглашение сразу с этими планами («Пусть выберет из этих»)
    const inviteLink = () => document.querySelector('a[data-now-invite]');
    const sec = at('7.10') && W.SecondaryButton;
    if (sec) {
      safe(() => W.SecondaryButton.setParams({ text: '💌 Позвать', position: 'left' }));
      W.SecondaryButton.onClick(() => { const a = inviteLink(); if (a) { haptic('light'); location.href = a.href; } });
    }
    if (at('6.1')) W.BackButton.onClick(() => { haptic('light'); history.back(); });
    let raf = 0;
    const sync = () => {
      raf = 0;
      if (at('6.1')) safe(() => (sheetOpen() ? W.BackButton.show() : W.BackButton.hide()));
      if (main) safe(() => (!sheetOpen() && pollLink() && at('6.7') ? W.MainButton.show() : W.MainButton.hide()));
      if (sec) safe(() => (!sheetOpen() && inviteLink() ? W.SecondaryButton.show() : W.SecondaryButton.hide()));
    };
    // галерея и полноэкранный просмотр: лёгкий щелчок на каждом новом фото
    const galAt = new WeakMap();
    document.addEventListener('scroll', e => {
      const t = e.target;
      if (!t.classList || !(t.classList.contains('gal-track') || t.classList.contains('lb-track')) || !t.clientWidth) return;
      const i = Math.round(t.scrollLeft / t.clientWidth);
      if (galAt.has(t) && galAt.get(t) !== i) haptic();
      galAt.set(t, i);
    }, true);
    new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(sync); }).observe(document.body, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
    sync();

    document.addEventListener('click', e => {
      const a = e.target.closest('a[href]');
      if (a && /^https:\/\/t\.me\//i.test(a.href)) {
        e.preventDefault();
        if (!vote(a)) safe(() => W.openTelegramLink(a.href));
        return;
      }
      if (e.target.closest('button, a, [role="button"], [role="option"], label')) haptic();
    }, true);
  }
})();

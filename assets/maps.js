/* Карта мест на сайте — Яндекс Карты (JavaScript API 2.1). Одна большая карта каталога (вкладка «Карта»);
   в карточках мест и планов карты нет — там «Как добраться» / «Маршрут» и «Фото, часы и отзывы» в Яндекс Картах.
   Библиотека грузится только при первом показе карты. Ключ API — config.js → maps.yandexKey
   (бесплатный ключ «JavaScript API и HTTP Геокодер» в кабинете разработчика Яндекса, см. README).
   Если API не загрузился (нет сети, блокировщик), тег скрипта убираем — следующая попытка начнётся с чистого листа. */
(function () {
  'use strict';

  const CFG = window.DATE_CONFIG || {};
  const KEY = String((CFG.maps && CFG.maps.yandexKey) || '').trim();
  const SRC = 'https://api-maps.yandex.ru/2.1/?lang=ru_RU' + (KEY ? '&apikey=' + encodeURIComponent(KEY) : '');
  let apiP = null;

  function load() {
    if (window.ymaps && window.ymaps.Map) return Promise.resolve(window.ymaps);
    if (apiP) return apiP;
    apiP = new Promise((res, rej) => {
      const old = document.getElementById('ymaps-api');
      if (old) old.remove();
      const s = document.createElement('script');
      s.id = 'ymaps-api';
      s.src = SRC;
      s.async = true;
      let done = false;
      const fail = () => { if (done) return; done = true; clearTimeout(t); s.remove(); apiP = null; rej(new Error('ymaps')); };
      const t = setTimeout(fail, 15000);
      s.onload = () => {
        if (!window.ymaps || !window.ymaps.ready) { fail(); return; }
        window.ymaps.ready(() => { if (done) return; done = true; clearTimeout(t); res(window.ymaps); }, fail);
      };
      s.onerror = fail;
      document.head.appendChild(s);
    });
    return apiP;
  }

  /* Цвет точки по разделу каталога — насыщенные, чтобы читались на светлой карте */
  const CAT_COLOR = { walk: '#1E9E57', culture: '#7B5CD6', food: '#E0446B', coffee: '#D9731A', bar: '#B88A00', fun: '#6C9A0F', pc: '#0E9AA7', spa: '#2F80ED', books: '#C1489C' };
  const PROMO_COLOR = '#F5B000';

  /* Центр и масштаб, с которых карта открывается, когда мест под фильтром много (или их нет), — свои у каждого города
     (K.CITIES в shared.js: center, zoom). center(c) / zoom(c) — для города c, по умолчанию — для города интерфейса.
     CENTER и ZOOM — московские, для старых вызовов */
  const CENTER = [55.751, 37.618], ZOOM = 11;
  const conf = c => { const K = window.DateKit; try { return K && typeof K.cityConf === 'function' ? K.cityConf(c) : null; } catch (e) { return null; } };
  const center = c => { const x = conf(c); return x && Array.isArray(x.center) ? x.center.slice() : CENTER.slice(); };
  const zoom = c => { const x = conf(c); return x && Number.isFinite(x.zoom) ? x.zoom : ZOOM; };

  window.KudaMap = { load, CAT_COLOR, PROMO_COLOR, CENTER, ZOOM, center, zoom, hasKey: !!KEY };
})();

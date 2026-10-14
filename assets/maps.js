/* Карты на сайте: Leaflet + OpenStreetMap. Библиотека грузится только при первом показе карты.
   miniMap — маленькая карта маршрута в карточке плана или места: пронумерованные точки и пунктир между ними. */
(function () {
  'use strict';

  let leafletP = null;
  function load() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletP) return leafletP;
    leafletP = new Promise((res, rej) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      s.onload = () => res(window.L);
      s.onerror = () => { leafletP = null; rej(new Error('leaflet')); };
      document.head.appendChild(s);
    });
    return leafletP;
  }

  const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const ATTR = '© участники OpenStreetMap';
  function tiles(L) { return L.tileLayer(TILES, { maxZoom: 18, attribution: ATTR }); }

  /* Пронумерованная точка: divIcon, цвет — акцент режима */
  function numIcon(L, n, opts) {
    const cls = 'mm-pin' + (opts && opts.promo ? ' promo' : '') + (opts && opts.me ? ' me' : '');
    return L.divIcon({ className: '', html: `<span class="${cls}">${n}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
  }

  /* el — контейнер; stops — [{lat, lon, name}]; возвращает объект карты (или null, если не загрузилась) */
  async function miniMap(el, stops, opts) {
    opts = opts || {};
    if (!el || !stops.length) return null;
    let L;
    try { L = await load(); } catch (e) { el.innerHTML = '<p class="mm-off">Карта не загрузилась — маршрут откроется в Яндекс Картах.</p>'; return null; }
    if (!el.isConnected) return null;
    const map = L.map(el, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, dragging: !L.Browser.mobile, tap: false });
    tiles(L).addTo(map);
    const pts = stops.map(p => [p.lat, p.lon]);
    if (pts.length > 1) L.polyline(pts, { color: '#ffffff', weight: 3, opacity: 0.9, dashArray: '6 8', className: 'mm-line' }).addTo(map);
    stops.forEach((p, i) => L.marker([p.lat, p.lon], { icon: numIcon(L, stops.length > 1 ? i + 1 : '•', { promo: p.promo }), title: p.name, keyboard: false }).addTo(map));
    if (opts.me) L.marker([opts.me.lat, opts.me.lon], { icon: numIcon(L, '', { me: true }), keyboard: false }).addTo(map);
    const fit = () => {
      map.invalidateSize();
      if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 16 });
      else map.setView(pts[0], 15);
    };
    fit();
    setTimeout(fit, 60);
    return map;
  }

  window.KudaMap = { load, tiles, numIcon, miniMap };
})();

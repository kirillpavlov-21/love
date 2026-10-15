/* Галерея места: ещё несколько фото того же объекта с Wikimedia Commons.
   У места уже есть одно фото (assets/photos.js, поле file). Берём категорию этого файла на Commons
   (например «Kuskovo estate») и показываем другие снимки из неё — с автором и лицензией.
   Запросы идут прямо из браузера к открытому API Commons (CORS: origin=*), ответ кэшируется на неделю.
   В ленте — превью 250 px (t), крупно по нажатию — 720 px (s): на мобильном интернете не качаем большие снимки ради плиток.
   Если Commons недоступен — остаётся одно фото, ничего не ломается. */
(function () {
  'use strict';

  const API = 'https://commons.wikimedia.org/w/api.php';
  const TTL = 7 * 864e5, MAX = 6;
  const cacheKey = id => 'kuda-gal2:' + id;   // 2 — в записях есть превью t
  const cget = id => { try { const v = JSON.parse(localStorage.getItem(cacheKey(id)) || 'null'); return v && Date.now() - v.ts < TTL ? v.items : null; } catch (e) { return null; } };
  const cset = (id, items) => { try { localStorage.setItem(cacheKey(id), JSON.stringify({ ts: Date.now(), items })); } catch (e) { /* ок */ } };

  /* Категории, которые ничего не говорят об объекте: годы, камеры, лицензии, «Москва» целиком… */
  const GENERIC = /^(Category:)?(\d{3,4}|.*\b(19|20)\d\d\b.*|Moscow|Москва|Russia|.*photographs? (by|taken)|Taken with.*|.*(CC[- ]BY|GFDL|Free Art|license|Public domain).*|Quality images.*|Featured pictures.*|Valued images.*|Uploaded .*|Files .*|Images .*|Media .*|Pages .*|.*panoramio.*|.*Wiki Loves.*|Self-published work|.*\bcountry\b.*|Streets in Moscow|Parks in Moscow|Museums in Moscow|Restaurants in Moscow)$/i;

  function qs(o) { return Object.entries(Object.assign({ format: 'json', origin: '*', formatversion: 2 }, o)).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&'); }
  async function api(params) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
    try { const r = await fetch(API + '?' + qs(params), { signal: ctl.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); }
    finally { clearTimeout(t); }
  }
  /* Текст из HTML Commons: теги прочь, сущности (&amp;, &#039;…) — обратно в буквы; экранирует потом страница */
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const strip = html => String(html || '').replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] !== '#') return ENT[e.toLowerCase()] || m;
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 31 && n < 0x110000 ? String.fromCodePoint(n) : '';
    })
    .replace(/\s+/g, ' ').trim();
  /* Превью того же файла: в адресе миниатюры Commons ширина задана сегментом «/720px-имя» */
  const thumbOf = url => /\/\d+px-[^/]+$/.test(url) ? url.replace(/\/\d+px-([^/]+)$/, '/250px-$1') : url;

  async function bestCategory(file) {
    const j = await api({ action: 'query', titles: 'File:' + file, prop: 'categories', clshow: '!hidden', cllimit: 30 });
    const page = j.query && j.query.pages && j.query.pages[0];
    const cats = ((page && page.categories) || []).map(c => c.title).filter(t => !GENERIC.test(t));
    if (!cats.length) return null;
    // самая узкая категория, где есть хотя бы 3 файла
    const info = await api({ action: 'query', titles: cats.slice(0, 20).join('|'), prop: 'categoryinfo' });
    const sized = ((info.query && info.query.pages) || []).map(p => [p.title, (p.categoryinfo && p.categoryinfo.files) || 0])
      .filter(([, n]) => n >= 3 && n <= 3000).sort((a, b) => a[1] - b[1]);
    return sized.length ? sized[0][0] : null;
  }

  /* Автор — без ссылок на соцсети и каналы (shared.js → cleanAuthor), в том числе в записях из кэша */
  const tidy = items => items.map(x => Object.assign({}, x, { a: (window.DateKit && window.DateKit.cleanAuthor ? window.DateKit.cleanAuthor(x.a) : x.a) || 'автор на Commons' }));
  async function load(id, ph) {
    if (!ph || !ph.file) return [];
    const hit = cget(id);
    if (hit) return tidy(hit);
    const cat = await bestCategory(ph.file);
    if (!cat) { cset(id, []); return []; }
    const j = await api({ action: 'query', generator: 'categorymembers', gcmtitle: cat, gcmtype: 'file', gcmlimit: 20,
      prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: 720 });
    const own = 'File:' + ph.file.replace(/_/g, ' ');
    const items = ((j.query && j.query.pages) || [])
      .filter(p => p.title !== own && p.imageinfo && /image\/(jpeg|png|webp)/.test(p.imageinfo[0].mime))
      .map(p => { const ii = p.imageinfo[0], m = ii.extmetadata || {};
        const s = ii.thumburl || ii.url;
        return { s, t: thumbOf(s), u: ii.descriptionurl, a: strip(m.Artist && m.Artist.value).slice(0, 60) || 'автор на Commons',
          l: strip(m.LicenseShortName && m.LicenseShortName.value) || 'свободная лицензия' }; })
      .filter(x => x.s)
      .slice(0, MAX);
    cset(id, items);
    return tidy(items);
  }

  window.KudaGallery = { load };
})();

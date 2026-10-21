/* Картинка для чата и сторис (A9): заголовок, остановки, схема маршрута точками по координатам (без тайлов карт),
   город, QR на короткую ссылку и подпись сайта. Рисуем на canvas: 'story' — 1080×1920, 'square' — 1080×1080.
   window.KudaShareCard.render(o) → Promise<Blob JPEG>; share(o) → 'shared' | 'saved' | 'cancel' | 'error':
   navigator.share({ files }) там, где он умеет файлы, иначе скачивание (так во встроенном браузере Telegram).
   o: { title, sub, stops: [{ emoji, name, meta, lat, lon }], city, url, mode, size, fileName } — сеть не нужна,
   кроме короткой ссылки: длинную (> 200 байт) сокращаем через DateKit.shortLink. */
(function () {
  'use strict';

  const K = window.DateKit;
  const QR = window.KudaQR;
  const SIZES = { story: [1080, 1920], square: [1080, 1080] };
  const ACCENT = { date: '#FF7A9A', guys: '#D7F24B', girls: '#C9A5FF' };
  const BG = '#121016', TEXT = '#F4F1EA', MUTED = '#A39EAE';
  const DISPLAY = '"Unbounded", "Onest", system-ui, sans-serif', BODY = '"Onest", system-ui, sans-serif';

  /* строки по ширине: перенос по словам, лишнее — с многоточием */
  function lines(g, text, maxW, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean), out = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (g.measureText(t).width <= maxW) { cur = t; continue; }
      if (cur) out.push(cur);
      cur = w;
      if (out.length === maxLines) break;
    }
    if (out.length < maxLines && cur) out.push(cur);
    if (out.length > maxLines) out.length = maxLines;
    const used = out.join(' ').split(/\s+/).length;
    if (used < words.length || g.measureText(out[out.length - 1] || '').width > maxW) {
      let last = out[out.length - 1] || '';
      while (last && g.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      out[out.length - 1] = last.replace(/[\s,.;:—-]+$/, '') + '…';
    }
    return out;
  }
  function rrect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  /* схема маршрута: точки по координатам в рамке, пунктир между ними, номера остановок */
  function route(g, stops, x, y, w, h, accent) {
    const pts = stops.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
    if (pts.length < 2) return false;
    const lat0 = pts.reduce((a, s) => a + s.lat, 0) / pts.length, kx = Math.cos(lat0 * Math.PI / 180);
    const xs = pts.map(s => s.lon * kx), ys = pts.map(s => -s.lat);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY) || 1e-4, pad = 70;
    const sc = Math.min((w - pad * 2) / Math.max(maxX - minX, span * 0.3), (h - pad * 2) / Math.max(maxY - minY, span * 0.3));
    const cx = x + w / 2 - ((minX + maxX) / 2) * sc, cy = y + h / 2 - ((minY + maxY) / 2) * sc;
    const P = pts.map((s, i) => [cx + xs[i] * sc, cy + ys[i] * sc]);
    g.save();
    rrect(g, x, y, w, h, 36); g.fillStyle = 'rgba(255,255,255,0.04)'; g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 2; g.stroke();
    g.setLineDash([14, 14]); g.lineWidth = 6; g.strokeStyle = accent; g.globalAlpha = 0.7;
    g.beginPath(); P.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.stroke();
    g.setLineDash([]); g.globalAlpha = 1;
    P.forEach(([px, py], i) => {
      g.beginPath(); g.arc(px, py, 30, 0, Math.PI * 2); g.fillStyle = accent; g.fill();
      g.fillStyle = BG; g.font = `700 30px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), px, py + 1);
    });
    g.restore();
    return true;
  }
  function qr(g, text, x, y, size) {
    const q = QR && QR.make(text);
    if (!q) return false;
    const quiet = 4, cell = Math.floor(size / (q.size + quiet * 2)), real = cell * (q.size + quiet * 2), ox = x + (size - real) / 2, oy = y + (size - real) / 2;
    g.save();
    rrect(g, x - 12, y - 12, size + 24, size + 24, 28); g.fillStyle = '#fff'; g.fill();
    g.fillStyle = '#000';
    for (let r = 0; r < q.size; r++) for (let c = 0; c < q.size; c++) if (q.at(c, r)) g.fillRect(ox + (c + quiet) * cell, oy + (r + quiet) * cell, cell, cell);
    g.restore();
    return true;
  }

  async function qrUrl(url) {
    if (!url) return '';
    if (new TextEncoder().encode(url).length <= 200) return url;
    // сокращаем не дольше 4 с; не вышло — QR не ставим (не подменяем приглашение главной), подпись просит отправить ссылку
    try {
      const s = K && K.shortLink ? await Promise.race([K.shortLink(url), new Promise(r => setTimeout(() => r(''), 4000))]) : '';
      if (s && new TextEncoder().encode(s).length <= 200) return s;
    } catch (e) { /* ниже */ }
    return '';
  }

  async function render(o) {
    o = o || {};
    const [W, H] = SIZES[o.size] || SIZES.story, story = H > W;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const accent = ACCENT[o.mode] || ACCENT.date;
    try { if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 800))]); } catch (e) { /* шрифт по умолчанию */ }
    // фон: ночной город с мягким свечением цвета повода
    g.fillStyle = BG; g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W * 0.85, H * 0.08, 0, W * 0.85, H * 0.08, W * 0.9);
    glow.addColorStop(0, accent + '55'); glow.addColorStop(1, accent + '00');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    const M = 84;
    let y = story ? 150 : 96;
    // знак сайта и город
    g.save(); g.translate(M, y - 46); g.scale(2.4, 2.4); g.fillStyle = accent; g.fill(new Path2D(K ? K.markD(o.mode) : 'M12 2L22 22H2z')); g.restore();
    g.fillStyle = TEXT; g.font = `700 40px ${DISPLAY}`; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillText('Куда идём?', M + 76, y);
    if (o.city) { g.font = `600 30px ${BODY}`; g.fillStyle = MUTED; g.textAlign = 'right'; g.fillText(String(o.city).toUpperCase(), W - M, y); g.textAlign = 'left'; }
    y += story ? 150 : 110;
    // заголовок и строка «когда»
    const tSize = story ? 92 : 74;
    g.font = `700 ${tSize}px ${DISPLAY}`; g.fillStyle = TEXT;
    lines(g, o.title, W - M * 2, 3).forEach(l => { g.fillText(l, M, y); y += tSize * 1.12; });
    if (o.sub) { y += 6; g.font = `600 ${story ? 46 : 40}px ${BODY}`; g.fillStyle = accent; lines(g, o.sub, W - M * 2, 2).forEach(l => { g.fillText(l, M, y); y += 58; }); }
    y += story ? 40 : 20;
    // остановки
    const stops = (o.stops || []).slice(0, story ? 4 : 3);
    const qrSize = story ? 300 : 230;
    const rowW = story ? W - M * 2 : W - M * 2 - qrSize - 40;
    stops.forEach((s, i) => {
      g.font = `56px ${BODY}`; g.fillText(s.emoji || '📍', M, y + 48);
      g.font = `700 ${story ? 46 : 40}px ${BODY}`; g.fillStyle = TEXT;
      g.fillText(lines(g, (stops.length > 1 ? (i + 1) + '. ' : '') + s.name, rowW - 96, 1)[0] || '', M + 96, y + 30);
      if (s.meta) { g.font = `500 ${story ? 32 : 28}px ${BODY}`; g.fillStyle = MUTED; g.fillText(lines(g, s.meta, rowW - 96, 1)[0] || '', M + 96, y + 76); }
      g.fillStyle = TEXT;
      y += story ? 128 : 108;
    });
    // схема маршрута — в сторис, если есть место
    const qy = H - M - qrSize;
    if (story && qy - y > 380) route(g, stops, M, y + 20, W - M * 2, Math.min(560, qy - y - 80), accent);
    // QR и подпись
    const link = await qrUrl(o.url);
    const hasQr = link && qr(g, link, W - M - qrSize, qy, qrSize);
    g.textAlign = 'left'; g.fillStyle = MUTED; g.font = `500 ${story ? 32 : 28}px ${BODY}`;
    const capW = W - M * 2 - (hasQr ? qrSize + 50 : 0);
    const cap = hasQr ? 'Наведи камеру на код — откроется план и маршрут' : o.url ? 'Ссылку на приглашение отправь вместе с картинкой' : 'Открой «Куда идём?» — там план и маршрут';
    let cy = H - M - (story ? 110 : 80);
    lines(g, cap, capW, 2).forEach(l => { g.fillText(l, M, cy); cy += story ? 44 : 38; });
    g.fillStyle = TEXT; g.font = `700 ${story ? 34 : 30}px ${DISPLAY}`;
    try { g.fillText(new URL(K && K.sitePath ? K.sitePath('start.html') : location.href).host, M, H - M); } catch (e) { /* без адреса */ }
    if (o.credit) { g.font = `400 22px ${BODY}`; g.fillStyle = MUTED; g.fillText(lines(g, 'Фото: ' + o.credit, W - M * 2, 1)[0], M, H - 30); }
    // JPEG: плавное свечение фона в PNG весит под мегабайт, в JPEG — около 150 КБ, а QR читается так же
    return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.92));
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  async function share(o) {
    o = o || {};
    let blob;
    try { blob = await render(o); } catch (e) { return 'error'; }
    if (!blob) return 'error';
    const name = (o.fileName || 'kuda-idem') + (o.size === 'square' ? '-chat' : '-story') + '.jpg';
    const file = typeof File === 'function' ? new File([blob], name, { type: 'image/jpeg' }) : null;
    try {
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: o.title || 'Куда идём?' });
        return 'shared';
      }
    } catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
    download(blob, name);
    return 'saved';
  }

  window.KudaShareCard = { render, share, SIZES };
})();

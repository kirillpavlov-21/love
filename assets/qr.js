/* QR-код без библиотек: байтовый режим (UTF-8), уровень коррекции M, версии 1–10 (до 213 байт).
   window.KudaQR.make(text) → { size, version, at(x, y) → true (тёмный модуль) } или null, если текст не влез.
   Алгоритм — по ISO/IEC 18004: кодирование, Рида — Соломона в GF(256), чередование блоков, маска с наименьшим штрафом. */
(function () {
  'use strict';

  // уровень M: всего кодовых слов, слов коррекции на блок, число блоков — для версий 1–10
  const TOTAL = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
  const ECC = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  /* ---------- поле GF(256), многочлен 0x11D ---------- */
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
  /* делитель (x − α^0)…(x − α^(n−1)), старший коэффициент опущен */
  function divisor(n) {
    let r = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(r.length + 1).fill(0);
      for (let j = 0; j < r.length; j++) { next[j] ^= r[j]; next[j + 1] ^= mul(r[j], EXP[i]); }
      r = next;
    }
    return r.slice(1);
  }
  function remainder(data, div) {
    const res = new Array(div.length).fill(0);
    for (const b of data) {
      const f = b ^ res.shift();
      res.push(0);
      for (let i = 0; i < div.length; i++) res[i] ^= mul(div[i], f);
    }
    return res;
  }

  /* ---------- данные: режим 0100, длина, байты, терминатор и заполнители 0xEC 0x11 ---------- */
  function encode(bytes) {
    for (let v = 1; v <= 10; v++) {
      const dataWords = TOTAL[v - 1] - ECC[v - 1] * BLOCKS[v - 1], cc = v < 10 ? 8 : 16;
      if (4 + cc + bytes.length * 8 > dataWords * 8) continue;
      const bits = [];
      const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
      put(4, 4); put(bytes.length, cc);
      bytes.forEach(b => put(b, 8));
      put(0, Math.min(4, dataWords * 8 - bits.length));
      while (bits.length % 8) bits.push(0);
      const words = [];
      for (let i = 0; i < bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
      for (let p = 0xEC; words.length < dataWords; p ^= 0xEC ^ 0x11) words.push(p);
      return { v, words };
    }
    return null;
  }
  /* блоки данных + коррекция, чередование по столбцам */
  function interleave(v, data) {
    const nb = BLOCKS[v - 1], ecc = ECC[v - 1], total = TOTAL[v - 1];
    const shortLen = Math.floor(total / nb), nShort = nb - (total % nb);
    const div = divisor(ecc), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const len = shortLen - ecc + (i < nShort ? 0 : 1);
      const dat = data.slice(k, k + len);
      k += len;
      blocks.push({ dat, ec: remainder(dat, div) });
    }
    const out = [];
    for (let i = 0; i <= shortLen - ecc; i++) blocks.forEach(b => { if (i < b.dat.length) out.push(b.dat[i]); });
    for (let i = 0; i < ecc; i++) blocks.forEach(b => out.push(b.ec[i]));
    return out;
  }

  /* ---------- матрица ---------- */
  function build(v, codewords, mask) {
    const n = 17 + 4 * v;
    const m = Array.from({ length: n }, () => new Array(n).fill(false));
    const fn = Array.from({ length: n }, () => new Array(n).fill(false));
    const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };
    // поисковые узоры с белой каймой
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(n - 4, 3); finder(3, n - 4);
    // синхронизирующие полосы
    for (let i = 0; i < n; i++) { if (!fn[6][i]) set(i, 6, i % 2 === 0); if (!fn[i][6]) set(6, i, i % 2 === 0); }
    // выравнивающие узоры (кроме углов с поисковыми)
    const al = ALIGN[v - 1];
    al.forEach((ay, i) => al.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    // формат (уровень и маска) — 15 бит в двух копиях, и версия — у v ≥ 7
    const format = msk => {
      const data = msk;   // уровень M — биты 00
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      const b = i => ((bits >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, b(i));
      set(8, 7, b(6)); set(8, 8, b(7)); set(7, 8, b(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, b(i));
      for (let i = 0; i < 8; i++) set(n - 1 - i, 8, b(i));
      for (let i = 8; i < 15; i++) set(8, n - 15 + i, b(i));
      set(8, n - 8, true);   // всегда тёмный модуль
    };
    format(0);
    if (v >= 7) {
      let rem = v;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const bits = (v << 12) | rem;
      for (let i = 0; i < 18; i++) { const d = ((bits >>> i) & 1) === 1, a = n - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, d); set(c, a, d); }
    }
    // данные зигзагом снизу справа, столбец 6 пропускаем
    let k = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? n - 1 - vert : vert;
        if (fn[y][x]) continue;
        if (k < codewords.length * 8) { m[y][x] = ((codewords[k >>> 3] >>> (7 - (k & 7))) & 1) === 1; k++; }
      }
    }
    // маска
    const MASK = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
      (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0][mask];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fn[y][x] && MASK(x, y)) m[y][x] = !m[y][x];
    format(mask);
    return m;
  }

  /* штраф по четырём правилам стандарта: серии, квадраты 2×2, ложные поисковые узоры, баланс тёмного */
  function penalty(m) {
    const n = m.length;
    let p = 0, dark = 0;
    const line = get => {
      let run = 1, s = 0, str = '';
      for (let i = 0; i < n; i++) {
        const c = get(i);
        str += c ? '1' : '0';
        if (i && c === get(i - 1)) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else run = 1;
      }
      for (const pat of ['10111010000', '00001011101']) { let i = -1; while ((i = str.indexOf(pat, i + 1)) >= 0) s += 40; }
      return s;
    };
    for (let i = 0; i < n; i++) { p += line(x => m[i][x]); p += line(y => m[y][i]); }
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) dark++;
    const total = n * n;
    p += Math.max(0, Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return p;
  }

  function make(text) {
    const enc = encode(Array.from(new TextEncoder().encode(String(text))));
    if (!enc) return null;
    const cw = interleave(enc.v, enc.words);
    let best = null, bestP = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const m = build(enc.v, cw, mask), p = penalty(m);
      if (p < bestP) { bestP = p; best = m; }
    }
    return { size: best.length, version: enc.v, at: (x, y) => !!(best[y] && best[y][x]) };
  }

  window.KudaQR = { make };
})();

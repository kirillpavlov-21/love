/* «Мои приглашения»: список из истории конструктора (localStorage), ссылки, а со своим сервером —
   живые статусы: открыли, голоса и лидер компании, ответ на свидание; уведомления, пока страница открыта. */
(function () {
  'use strict';

  const K = window.DateKit;
  const CFG = window.DATE_CONFIG || {};
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = K.esc;
  const HIST = 'date-constructor-history';   // пишет assets/create.js
  const OWNER_SECRET = 'kuda-owner';
  const OWN = 'kuda-own';
  const NOTIFY = 'kuda-inv-notify';
  const SEEN = 'kuda-inv-seen';   // статусы, которые ты уже видел: что нового — подсветим при следующем визите
  const POLL = 20000, POLL_BG = 60000, MAX = 50;
  const DEF = K.defaults();
  const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const API = () => (window.KudaAPI && window.KudaAPI.on ? window.KudaAPI : null);
  /* Режим только из своего списка (не «__proto__» из подделанной ссылки) */
  const okMode = m => m === 'date' || m === 'guys' || m === 'girls';
  const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c; };

  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ок */ } },
    del: k => { try { localStorage.removeItem(k); } catch (e) { /* ок */ } },
  };
  const readJson = (k, d) => { try { const v = JSON.parse(ls.get(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };

  function toast(t) {
    const el = $('#toast');
    el.textContent = t;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 3200);
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* запасной путь */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (e) { return false; }
  }
  /* Текст ещё готовится (короткая ссылка) — ClipboardItem с обещанием держит разрешение на запись */
  function copyLater(textP) {
    const cb = navigator.clipboard;
    if (cb && cb.write && window.ClipboardItem) {
      try {
        return cb.write([new ClipboardItem({ 'text/plain': textP.then(t => new Blob([t], { type: 'text/plain' })) })])
          .then(() => true, () => textP.then(copyText));
      } catch (e) { /* ниже */ }
    }
    return textP.then(copyText);
  }

  /* ---------- даты и события ---------- */
  function dayShort(s) {
    const d = K.parseYmd(s);
    return d ? `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}` : String(s || '');
  }
  const hm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  function whenText(ms) {
    if (!ms) return '';
    const d = new Date(+ms), now = new Date();
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 864e5);
    if (diff === 0) return 'сегодня в ' + hm(d);
    if (diff === 1) return 'вчера в ' + hm(d);
    return `${d.getDate()} ${MON[d.getMonth()]} в ${hm(d)}`;
  }
  const created = ms => (ms ? new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  function evById(id) {
    if (!id || typeof id !== 'string') return null;
    if (K.eventById) { try { return K.eventById(id) || null; } catch (e) { /* ниже */ } }
    return (window.KUDA_EVENTS || []).find(e => e && e.id === id) || null;
  }

  /* ---------- город ----------
     Город приглашения — у мест и событий в нём (id spb-…, ev-spb-… или поле city): из истории (create.js пишет city)
     или по первому пункту из каталога. Без мест из каталога города нет. */
  const okCity = c => !!c && typeof c === 'string' && !!K.CITIES && Object.prototype.hasOwnProperty.call(K.CITIES, c);
  const cityOf = x => (typeof K.cityOf === 'function' ? K.cityOf(x) : 'msk');
  function invCity(x, inv) {
    if (okCity(x && x.city)) return x.city;
    if (!inv) return '';
    const ids = [inv.event].concat((Array.isArray(inv.places) ? inv.places : []).map(p => p && p.plan),
      (Array.isArray(inv.opts) ? inv.opts : []).map(o => o && (o.plan || o.event)));
    const id = ids.find(v => typeof v === 'string' && v);
    return id ? cityOf(id) : '';
  }
  /* Город в конце адреса для календаря — только не московский (в московских адресах бывают города области) */
  const locCity = (x, addr) => {
    const c = K.CITIES && K.CITIES[cityOf(x)];
    return c && c.id !== 'msk' && String(addr || '').indexOf(c.addr) < 0 ? c.addr : '';
  };

  /* ---------- история и голоса ---------- */
  function histList() { const l = readJson(HIST, []); return Array.isArray(l) ? l.filter(x => x && (x.code || x.link)) : []; }
  const saveHist = list => ls.set(HIST, JSON.stringify(list.slice(0, MAX)));
  const histCode = x => x.code || K.readHash('#' + (String(x.link || '').split('#')[1] || '')).code;
  function patchHist(code, patch) {
    const list = histList();
    const x = list.find(y => histCode(y) === code);
    if (!x) return;
    Object.assign(x, patch);
    saveHist(list);
  }
  function ownerSecret() {
    let s = ls.get(OWNER_SECRET) || '';
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(s)) {
      const b = new Uint8Array(18);
      try { crypto.getRandomValues(b); } catch (e) { for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256); }
      s = K.toB64url(b);
      ls.set(OWNER_SECRET, s);
    }
    return s;
  }
  /* Голоса, которые этот браузер видел (их пишет игра в kuda-votes:<INV_ID>), — в ссылку &v= */
  function cleanVotes(arr) {
    return (Array.isArray(arr) ? arr : []).filter(v => v && typeof v.id === 'string' && v.id.length <= 12).map(v => ({
      id: v.id, n: String(v.n || '?').slice(0, 30), y: v.y ? 1 : 0,
      o: (Array.isArray(v.o) ? v.o : []).filter(Number.isInteger).slice(0, 20),
      d: (Array.isArray(v.d) ? v.d : []).filter(Number.isInteger).slice(0, 60),
      t: +v.t || 0,
    })).sort((a, b) => a.t - b.t).slice(-60);
  }
  function localVotes(code) {
    const v = readJson('kuda-votes:' + K.hash(code), []);
    return cleanVotes(Array.isArray(v) ? v : v && v.votes);
  }
  function myVote(code) {
    const me = ls.get('kuda-voter:' + K.hash(code));
    return me ? localVotes(code).find(v => v.id === me) || null : null;
  }

  /* ---------- элементы списка ---------- */
  let items = [];
  const DEC = new Map();   // код → разобранное приглашение (или null)
  const S = Object.create(null);     // код → статус с сервера; undefined — ещё не знаем, null — сервер о нём не знает
  const SNAP = Object.create(null);  // код → прошлый статус (для уведомлений)
  const SHORT = Object.create(null); // длинная ссылка → короткая
  const regTried = new Set();
  const FRESH = new Set();   // коды с новостями за этот визит — плашка «Новое»
  let polled = false, srvErr = false, lastPoll = 0, timer = 0, busy = false, unseen = 0;
  const BASE_TITLE = document.title;

  async function decode(code) {
    if (DEC.has(code)) return DEC.get(code);
    let inv = null;
    try { inv = K.merge(DEF, await K.decodeInvite(code)); } catch (e) { inv = null; }
    DEC.set(code, inv);
    return inv;
  }
  function optTitle(it, i) {
    const o = ((it.inv && it.inv.opts) || [])[i];
    if (!o) return `вариант ${i + 1}`;
    if (o.plan) { const pl = K.planById(o.plan); if (pl) return pl.title; }
    if (o.event) { const ev = evById(o.event); if (ev) return ev.title; }
    return o.title || `вариант ${i + 1}`;
  }
  async function load() {
    const seen = new Set();
    const list = histList().filter(x => { const c = histCode(x); if (!c || seen.has(c)) return false; seen.add(c); return true; });
    markOwn(list.map(histCode));
    const old = new Map(items.map(it => [it.code, it]));
    items = await Promise.all(list.map(async x => {
      const code = histCode(x);
      const inv = await decode(code);
      const mode = okMode(x.mode) ? x.mode : inv && okMode(inv.mode) ? inv.mode : 'date';
      const MC = K.MODES[mode];
      const group = !!MC.group;
      const title = group ? (inv && inv.title) || x.title || MC.title : x.title || (inv && inv.her) || x.label || 'Приглашение';
      const prev = old.get(code) || {};
      // ссылка из истории — только обычная http(s); иначе собираем заново по коду
      const link = /^https?:\/\/[^\s"'<>]+$/.test(x.link || '') ? x.link : K.sitePath('index.html').replace(/index\.html$/, '') + '#' + code;
      const it = Object.assign(prev, { x, code, inv, mode, group, title, link, who: inv && inv.who === 'm' ? 'm' : 'f', city: invCity(x, inv) });
      it.vsuf = group ? await votesSuffix(code) : '';
      return it;
    }));
    render();
    schedule(polled ? POLL : 0);
  }
  async function votesSuffix(code) {
    const list = localVotes(code);
    if (!list.length) return '';
    try { return '&v=' + await K.encodeData(list); } catch (e) { return ''; }
  }
  /* Всё из истории создано в этом браузере: игра не засчитает создателю «открыли» и не сохранит его ответ
     (тот же список kuda-own ведёт create.js — дополняем приглашениями, созданными до его появления) */
  function markOwn(codes) {
    const own = readJson(OWN, []);
    const list = Array.isArray(own) ? own.filter(x => typeof x === 'string') : [];
    const ids = codes.map(K.hash).filter(id => list.indexOf(id) < 0);
    if (ids.length) ls.set(OWN, JSON.stringify(list.concat(ids).slice(-300)));
  }
  const longOf = it => it.link + (it.vsuf || '');
  /* Компания — настоящая игра (проголосовать самому), свидание — превью: твой просмотр не засчитается как «открыла» */
  const openOf = it => (it.group ? longOf(it) : it.link + '&p=1');
  const quickOf = it => (!it.vsuf && it.x.short) || SHORT[longOf(it)] || '';
  function shortOf(it) {
    const q = quickOf(it);
    if (q) return Promise.resolve(q);
    const long = longOf(it);
    return K.shortLink(long).then(s => {
      SHORT[long] = s;
      if (!it.vsuf && s && s !== long) { it.x.short = s; patchHist(it.code, { short: s }); }
      return s || long;
    }, () => long);
  }

  /* ---------- статус ---------- */
  const GF = (it, f, m) => (it.who === 'm' ? m : f);
  function answerOf(it, a) {
    if (!a || typeof a !== 'object') return null;
    // «Нет» — только явный отказ: без уровня с письмом yes не ставится, но место и день выбраны — это согласие
    if (a.no === true || (a.yes === false && !a.place && !a.date && !a.day && !a.dateOther)) return { yes: false, line: 'Ответ: «Нет»' };
    const ev = a.event ? evById(a.event) : null;
    let place = '', plan = null;
    if (ev) place = ev.title;
    else if (a.place && typeof a.place === 'object') {
      if (a.place.kind === 'custom') place = a.placeText || 'свой вариант';
      else if (a.place.kind === 'surprise') place = 'Сюрприз — выбираешь ты';
      else {
        plan = a.place.plan ? K.planById(a.place.plan) : null;
        place = a.place.title || (plan && plan.title) || '';
      }
    } else if (typeof a.place === 'string') place = a.place;
    const day = a.date || a.day || '';
    const when = day ? dayShort(day) : a.dateOther ? `«${a.dateOther}»` : '';
    const food = Array.isArray(a.food) ? (a.food.length ? a.food.map(f => (typeof f === 'string' ? f : [f.emoji, f.title].filter(Boolean).join(' '))).filter(Boolean).join(', ') : 'выбираешь ты') : '';
    let loc = '';
    if (ev) loc = [ev.venue, ev.addr, locCity(ev, ev.addr)].filter(Boolean).join(', ');
    else if (plan) { const st = K.planStops(plan)[0]; if (st) loc = [st.name, st.addr, locCity(st, st.addr)].filter(Boolean).join(', '); }
    const time = a.time || (ev && ev.time) || '';
    const rest = [place, when, time].filter(Boolean).join(', ');
    // время после полуночи (окно «22:00–02:00») — в календарь уже следующий день
    const calDay = day && a.timeNext === true ? K.ymd(K.addDays(K.parseYmd(day), 1)) : day;
    return { yes: true, place, day, calDay, time, food, note: a.note || '', loc, ev, line: 'Да!' + (rest ? ' ' + rest : '') };
  }
  /* Колесо в игре без случайности (assets/app.js, wheelPlan): по коду приглашения и набору лидеров — один победитель */
  const WHEEL_MAX = 8;
  const hnum = s => parseInt(K.hash(s), 36) || 0;
  function wheelWin(code, ids) {
    let sub = ids.slice().sort((a, b) => a - b);
    if (sub.length > WHEEL_MAX) sub = sub.slice().sort((a, b) => hnum(code + '|w|' + a) - hnum(code + '|w|' + b) || a - b).slice(0, WHEEL_MAX).sort((a, b) => a - b);
    return sub[hnum(code + '|' + sub.join(',')) % sub.length];
  }
  /* Итог колеса — только для той же ничьей, что сейчас (как forcedFor в игре): после новых голосов лидеры меняются,
     и старый итог к новой ничьей не относится. L — лидеры на момент вращения («0,3», по возрастанию):
     есть — должен совпасть с нынешними; нет (итог старой версии) — сверяем с колесом для нынешней ничьей.
     spins — итоги по наборам лидеров {L: итог}, если сервер их прислал. */
  function spinFor(it, lead) {
    if (lead.length < 2) return null;
    const sig = lead.join(',');
    const ok = i => (Number.isInteger(i) && lead.includes(i) ? i : null);
    const map = it.spins && typeof it.spins === 'object' ? it.spins : null;
    if (map && Object.prototype.hasOwnProperty.call(map, sig)) {
      const i = ok(map[sig] && map[sig].i);
      if (i != null) return i;
    }
    const s = it.spin;
    const obj = s && typeof s === 'object';
    const i = ok(obj ? s.i : s);
    if (i == null) return null;
    if (obj && typeof s.L === 'string' && s.L) return s.L === sig ? i : null;
    return i === wheelWin(it.code, lead) ? i : null;
  }
  function leaderOf(it) {
    const votes = Array.isArray(it.votes) ? it.votes : [];
    const yes = votes.filter(v => v && v.y);
    const cnt = new Map(), days = new Map();
    const today = K.dayNum(K.todayMsk ? K.todayMsk() : K.ymd(new Date()));   // прошедшие дни не считаем — как в игре
    // варианты — только те, что есть в приглашении (как в игре), иначе набор лидеров разойдётся с колесом
    const nOpt = it.inv && Array.isArray(it.inv.opts) ? it.inv.opts.length : 100;
    yes.forEach(v => {
      new Set(Array.isArray(v.o) ? v.o : []).forEach(i => { if (Number.isInteger(i) && i >= 0 && i < nOpt) cnt.set(i, (cnt.get(i) || 0) + 1); });
      new Set(Array.isArray(v.d) ? v.d : []).forEach(d => { if (d >= today) days.set(d, (days.get(d) || 0) + 1); });
    });
    const top = Math.max(0, ...cnt.values());
    const lead = top ? Array.from(cnt.keys()).filter(i => cnt.get(i) === top).sort((a, b) => a - b) : [];
    let text = '';
    const spin = spinFor(it, lead);
    if (lead.length === 1) text = 'лидирует: ' + optTitle(it, lead[0]);
    else if (spin != null) text = 'колесо выбрало: ' + optTitle(it, spin);
    else if (lead.length === 2) text = `ничья: ${optTitle(it, lead[0])} или ${optTitle(it, lead[1])}`;
    else if (lead.length > 2) text = `ничья из ${lead.length} вариантов`;
    const dTop = Math.max(0, ...days.values());
    const day = dTop ? Array.from(days.keys()).filter(d => days.get(d) === dTop).sort((a, b) => a - b)[0] : null;
    return { text, day: day != null ? dayShort(K.numDay(day)) : '', out: votes.length - yes.length };
  }
  function statusHtml(it) {
    if (!API()) {
      if (!it.group) return '';
      return myVote(it.code) ? '<span class="pill ok">✓ Твой голос в ссылке</span>'
        : '<span class="pill warn">Твоего голоса ещё нет</span><p>Нажми «Открыть» и отметься — твой голос попадёт в ссылку. Потом скопируй её здесь и отправь в чат заново, иначе друзья его не увидят.</p>';
    }
    const s = S[it.code];
    if (s === undefined) return `<span class="pill">${srvErr ? 'Статус не загрузился — попробуем ещё раз' : 'Загружаю статус…'}</span>`;
    if (s === null) return it.x.reg === -1 ? '<span class="pill">Статус видно в браузере, где приглашение создали</span>'
      : '<span class="pill">Статус появится чуть позже</span>';
    const out = FRESH.has(it.code) ? ['<span class="pill new">Новое</span>'] : [];
    const opened = +s.opened || 0;
    if (it.group) out.push(opened ? `<span class="pill ok">Открыли ✓${opened > 1 ? ` · ${opened} ${plural(opened, 'человек', 'человека', 'человек')}` : ''}</span>` : '<span class="pill">Ещё не открыли</span>');
    else if (!s.answer) out.push(opened ? `<span class="pill ok">${GF(it, 'Открыла', 'Открыл')} ✓${s.firstOpen ? ' · ' + esc(whenText(s.firstOpen)) : ''}</span>` : '<span class="pill">Ещё не открыли</span>');
    if (it.group) {
      const n = +s.votes || 0;
      if (!n) out.push('<span class="pill">Пока никто не проголосовал</span>');
      else {
        const L = Array.isArray(it.votes) ? leaderOf(it) : null;
        out.push(`<span class="pill acc">Голосов: ${n}${L && L.text ? ', ' + esc(L.text) : ''}</span>`);
        if (L && L.day) out.push(`<span class="pill">Удобнее всего: ${esc(L.day)}</span>`);
        if (L && L.out) out.push(`<span class="pill">Не смогут: ${L.out}</span>`);
      }
      if (!myVote(it.code)) out.push('<p>Твоего голоса в этом браузере ещё нет — нажми «Открыть» и отметься.</p>');
    } else if (s.answer) {
      const a = answerOf(it, s.answer);
      if (a && !a.yes) out.push(`<div class="inv-ans no"><b>${esc(a.line)}</b></div>`);
      else if (a) {
        out.push(`<div class="inv-ans"><b>${esc(a.line)}</b>${a.loc ? `<span>📍 ${esc(a.loc)}</span>` : ''}${a.food ? `<span>Еда: ${esc(a.food)}</span>` : ''}${a.note ? `<span>P.S. ${esc(a.note)}</span>` : ''}${a.day ? `<div class="inv-cal">
          <button class="btn" type="button" data-a="ics">${K.icon('calendar')}Добавить в календарь</button>
          <button class="btn" type="button" data-a="gcal">Google Календарь</button></div>` : ''}</div>`);
      }
    }
    return out.join('');
  }

  /* ---------- разметка ---------- */
  const cardId = code => 'inv-' + K.hash(code);
  const multiCity = () => new Set(items.map(it => (okCity(it.city) ? it.city : 'msk'))).size > 1;
  function card(it) {
    const MC = K.MODES[it.mode] || K.MODES.date;
    const ev = !it.group && it.inv && it.inv.event ? evById(it.inv.event) : null;
    const opts = it.group && it.inv ? (it.inv.opts || []).length : 0;
    // город подписываем, если приглашения в разных городах или город не Москва
    const city = okCity(it.city) && (it.city !== 'msk' || multiCity()) ? K.CITIES[it.city].name : '';
    const sub = [it.group ? MC.label : 'Свидание', city, created(it.x.at)].filter(Boolean).join(' · ') +
      (opts ? ` · ${opts} ${plural(opts, 'вариант', 'варианта', 'вариантов')}` : '');
    const id = cardId(it.code);
    return `<article class="inv" data-mode="${esc(it.mode)}" data-code="${esc(it.code)}" id="${id}" aria-labelledby="${id}-t">
      <div class="inv-h">
        <span class="inv-ic" aria-hidden="true">${esc(MC.emoji)}</span>
        <div class="inv-tt"><h2 id="${id}-t">${esc(it.title)}</h2><p>${esc(sub)}</p>${ev ? `<p class="inv-ev">${esc(ev.emoji || '🎫')} ${esc(ev.title)}</p>` : ''}</div>
        <button class="btn icon inv-del" type="button" data-a="del" aria-label="Убрать «${esc(it.title)}» из списка" title="Убрать из списка">${K.icon('x')}</button>
      </div>
      <div class="inv-st" aria-live="polite">${statusHtml(it)}</div>
      <div class="inv-acts">
        <button class="btn primary" type="button" data-a="copy">${K.icon('copy')}Скопировать</button>
        <button class="btn" type="button" data-a="share">${K.icon('share')}Поделиться</button>
        <a class="btn" data-a="open" href="${esc(openOf(it))}" target="_blank" rel="noopener"${it.group ? '' : ' title="Превью: ничего не сохраняется и не отправляется"'}>${K.icon(it.group ? 'ext' : 'eye')}${it.group ? 'Открыть' : 'Посмотреть'}</a>
        ${it.group ? `<a class="btn" data-a="res" href="${esc(longOf(it) + '&r=1')}" target="_blank" rel="noopener">Итоги</a>` : ''}
        <a class="btn" href="create.html#from=${esc(it.code)}">${K.icon('pen')}В конструктор</a>
      </div>
    </article>`;
  }
  function renderSrv() {
    const box = $('#srv');
    box.classList.toggle('hidden', !items.length);
    if (!items.length) return;
    if (!API()) {
      box.innerHTML = '<p>Живые статусы — открыли ли приглашение, кто проголосовал и что ответили — появятся здесь, когда подключим сервер. Пока ответ на свидание придёт ссылкой-билетом, а голоса компании — ссылками, которые друзья пришлют после голосования: открой такую ссылку, и голос попадёт в «Итоги».</p>';
      return;
    }
    let html = `<p>${srvErr ? 'Сервер сейчас не отвечает — статусы обновятся, как только связь вернётся.' : 'Статусы обновляются сами каждые 20 секунд, пока страница открыта.'}</p>`;
    if ('Notification' in window) {
      const perm = Notification.permission;
      if (perm === 'denied') html += '<p>Уведомления запрещены в настройках браузера — разреши их для этого сайта, если хочешь узнавать о голосах и ответах сразу.</p>';
      else if (notifyOn()) html += '<p>🔔 Уведомления включены: пока эта страница открыта, сообщим о новых голосах и ответах.</p><button class="btn sm" type="button" data-a="notify-off">Выключить уведомления</button>';
      else html += '<button class="btn sm" type="button" data-a="notify">🔔 Уведомлять, пока страница открыта</button>';
    }
    if (box._html !== html) {
      // кнопку «Уведомлять» / «Выключить» перерисовали — фокус с клавиатуры не должен улететь на <body>
      const had = box.contains(document.activeElement);
      box.innerHTML = html; box._html = html;
      if (had) {
        const b = $('[data-a="notify"],[data-a="notify-off"]', box) || box;
        if (b === box) box.tabIndex = -1;
        b.focus({ preventScroll: true });
      }
    }
  }
  function render() {
    const empty = !items.length;
    $('#empty').classList.toggle('hidden', !empty);
    // «а с ним и ответы» — только со своим сервером: без него ответы приходят ссылками, а не сюда
    const ans = $('#emptyAns');
    if (ans) ans.classList.toggle('hidden', !API());
    if (empty && !$('#emptyCat').firstChild) {
      $('#emptyCat').setAttribute('style', K.catVars('line'));
      $('#emptyCat').innerHTML = K.catSVG('normal');
    }
    $('#list').innerHTML = items.map(card).join('');
    renderSrv();
  }
  function paint(it) {
    const el = document.getElementById(cardId(it.code));
    if (!el) return;
    const st = $('.inv-st', el), html = statusHtml(it);
    if (st._html !== html) { st.innerHTML = html; st._html = html; }
    const open = $('[data-a="open"]', el), res = $('[data-a="res"]', el);
    if (open) open.href = openOf(it);
    if (res) res.href = longOf(it) + '&r=1';
  }
  const paintAll = () => items.forEach(paint);

  /* ---------- уведомления ---------- */
  const canNotify = () => 'Notification' in window;
  const notifyOn = () => canNotify() && ls.get(NOTIFY) === '1' && Notification.permission === 'granted';
  function ask() {
    return new Promise(res => {
      try {
        const r = Notification.requestPermission(res);   // старый Safari — через колбэк
        if (r && r.then) r.then(res, () => res('default'));
      } catch (e) { res('default'); }
    });
  }
  async function enableNotify() {
    if (!canNotify()) return;
    let p = Notification.permission;
    if (p === 'default') p = await ask();
    if (p === 'granted') { ls.set(NOTIFY, '1'); toast('Уведомления включены 🔔'); }
    else toast('Без разрешения браузера уведомления не придут');
    renderSrv();
    schedule(POLL);
  }
  function show(title, body, code) {
    if (!notifyOn()) return;
    const opts = { body, tag: 'kuda-' + K.hash(code), icon: 'assets/icon-192.png', lang: 'ru', data: { url: K.sitePath('invites.html') + '#' + cardId(code) } };
    try {
      const n = new Notification(title, opts);
      n.onclick = () => { try { window.focus(); } catch (e) { /* ок */ } focusCard(code); n.close(); };
    } catch (e) {
      // Android Chrome показывает уведомления только через service worker
      try { if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) navigator.serviceWorker.getRegistration().then(r => r && r.showNotification(title, opts)).catch(() => {}); } catch (err) { /* ок */ }
    }
  }
  function focusCard(code) {
    const el = document.getElementById(cardId(code));
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('fresh'); void el.offsetWidth; el.classList.add('fresh');
  }
  const snapOf = s => (s ? { o: +s.opened || 0, v: +s.votes || 0, a: s.answer ? JSON.stringify(s.answer) : '' } : null);
  /* Что нового с прошлого раза: ответ (важнее всего), голоса, первое открытие */
  function news(it, prev, cur) {
    const out = [];
    if (cur.a && cur.a !== prev.a) {
      const a = answerOf(it, S[it.code].answer);
      out.push({ code: it.code, rank: 0, push: true, title: `💌 ${it.title} ${GF(it, 'ответила', 'ответил')}`, body: a ? a.line : 'Есть ответ' });
    }
    if (cur.v > prev.v) {
      const d = cur.v - prev.v;
      out.push({ code: it.code, rank: 1, push: true, title: `🗳 «${it.title}»: ${d > 1 ? `+${d} ${plural(d, 'голос', 'голоса', 'голосов')}` : 'новый голос'}`,
        body: `Всего ${cur.v} ${plural(cur.v, 'голос', 'голоса', 'голосов')}` });
    }
    if (!prev.o && cur.o && !cur.a) {
      out.push({ code: it.code, rank: 2, push: false, title: it.group ? `👀 «${it.title}» открыли` : `👀 ${it.title} ${GF(it, 'открыла', 'открыл')} приглашение`, body: '' });
    }
    return out;
  }
  /* quiet — новости, пришедшие, пока страница была закрыта: подсвечиваем и показываем плашку, но без системных уведомлений */
  function announce(msgs, quiet) {
    msgs.sort((a, b) => a.rank - b.rank);
    msgs.forEach(m => { FRESH.add(m.code); focusFresh(m.code); });
    const away = document.hidden || (document.hasFocus && !document.hasFocus());
    if (!quiet && away) msgs.filter(m => m.push).forEach(m => show(m.title, m.body, m.code));
    if (!document.hidden) {
      const m = msgs[0];
      toast(m.title + (m.body ? '. ' + m.body : '') + (msgs.length > 1 ? ` (и ещё ${msgs.length - 1})` : ''));
    }
    if (away && !quiet) { unseen += msgs.length; document.title = `(${unseen}) ${BASE_TITLE}`; }
  }
  function focusFresh(code) {
    const el = document.getElementById(cardId(code));
    if (el) { el.classList.remove('fresh'); void el.offsetWidth; el.classList.add('fresh'); }
  }
  const seenAll = () => { if (unseen) { unseen = 0; document.title = BASE_TITLE; } };

  /* ---------- опрос сервера ---------- */
  function schedule(ms) {
    clearTimeout(timer); timer = 0;
    if (!API() || !items.length) return;
    if (document.hidden && !notifyOn()) return;   // вкладка скрыта — ждём возвращения
    timer = setTimeout(tick, Math.max(0, ms));
  }
  async function tick() {
    timer = 0;
    if (busy || (document.hidden && !notifyOn())) return;
    busy = true;
    try { await poll(); } catch (e) { /* следующий круг */ } finally { busy = false; }
    schedule(document.hidden ? POLL_BG : POLL);
  }
  async function poll() {
    const api = API();
    if (!api || !items.length) return;
    lastPoll = Date.now();
    const list = items.slice(0, MAX);
    const res = await api.mine(ownerSecret(), list.map(it => it.code));
    if (!res) { srvErr = true; renderSrv(); paintAll(); return; }
    srvErr = false;
    list.forEach(it => { S[it.code] = res[it.code] || null; });
    // лидер компании: голоса перечитываем, только когда что-то поменялось
    const need = list.filter(it => it.group && S[it.code] && (+S[it.code].votes || 0) > 0 && S[it.code].updated !== it.vupd).slice(0, 10);
    await Promise.all(need.map(async it => {
      const r = await api.votes(it.code);
      if (r && Array.isArray(r.votes)) { it.votes = r.votes; it.spin = r.spin || null; it.spins = r.spins || null; it.vupd = S[it.code].updated; }
    }));
    // первый опрос сравниваем с тем, что видели в прошлый визит (localStorage), следующие — с прошлым опросом
    const first = !polled, seen = first ? readJson(SEEN, {}) : null;
    const msgs = [];
    list.forEach(it => {
      const cur = snapOf(S[it.code]);
      const old = seen && seen[K.hash(it.code)];
      const prev = SNAP[it.code] || (old && typeof old === 'object' ? { o: +old.o || 0, v: +old.v || 0, a: String(old.a || '') } : null);
      if (prev && cur) msgs.push(...news(it, prev, cur));
      if (cur) SNAP[it.code] = cur;
    });
    const keep = {};
    items.forEach(it => { if (SNAP[it.code]) keep[K.hash(it.code)] = SNAP[it.code]; });
    ls.set(SEEN, JSON.stringify(keep));
    polled = true;
    if (msgs.length) announce(msgs, first);
    renderSrv();
    paintAll();
    // приглашения, о которых сервер не знает (созданы до его подключения), — регистрируем на себя
    list.filter(it => S[it.code] === null && it.x.reg !== -1 && !regTried.has(it.code)).slice(0, 5).forEach(it => {
      regTried.add(it.code);
      api.invite(it.code, ownerSecret(), { mode: it.mode, title: it.title }).then(ok => {
        if (ok) { patchHist(it.code, { reg: 1 }); it.x.reg = 1; schedule(3000); }
        else if (api.lastError === 'taken') { patchHist(it.code, { reg: -1 }); it.x.reg = -1; paint(it); }
      });
    });
  }

  /* ---------- действия ---------- */
  const itemOf = el => { const c = el && el.closest('.inv'); return c ? items.find(it => it.code === c.dataset.code) : null; };
  function calendar(it, kind) {
    const a = answerOf(it, (S[it.code] || {}).answer);
    if (!a || !a.yes || !a.day) return;
    const title = (a.ev ? a.ev.title : 'Свидание' + (a.place ? ': ' + a.place : '')) + ' · ' + it.title;
    const links = K.calendarLinks({ title, day: a.calDay || a.day, time: a.time || '', minutes: 180, location: a.loc, details: 'Договорились в «' + ((CFG.site && CFG.site.name) || 'Куда идём?') + '»' });
    if (kind === 'gcal') { window.open(links.google, '_blank', 'noopener'); URL.revokeObjectURL(links.ics); return; }
    const link = document.createElement('a');
    link.href = links.ics; link.download = 'svidanie.ics';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(links.ics), 10000);
  }
  function onClick(e) {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'notify') { enableNotify(); return; }
    if (a === 'notify-off') { ls.del(NOTIFY); renderSrv(); toast('Уведомления выключены'); return; }
    const it = itemOf(b);
    if (!it) return;
    if (a === 'copy') {
      const q = quickOf(it);
      (q ? copyText(q) : copyLater(shortOf(it))).then(ok => toast(ok ? (it.group ? 'Ссылка скопирована — кидай в общий чат 💬' : 'Ссылка скопирована 💌') : 'Не получилось скопировать'));
    } else if (a === 'share') {
      const url = quickOf(it) || longOf(it);
      const text = it.group ? `${(K.MODES[it.mode] || {}).emoji || ''} ${it.title} — голосуем, куда и когда идём!`.trim() : 'У меня для тебя кое-что есть 💌';
      if (navigator.share) {
        navigator.share({ title: text, text, url }).catch(err => { if (!err || err.name !== 'AbortError') copyText(url).then(ok => toast(ok ? 'Ссылка скопирована' : 'Не получилось поделиться')); });
      } else copyText(url).then(ok => toast(ok ? 'Ссылка скопирована' : 'Не получилось скопировать'));
    } else if (a === 'ics' || a === 'gcal') calendar(it, a);
    else if (a === 'del') {
      if (!confirm(`Убрать «${it.title}» из списка? Сама ссылка продолжит работать.`)) return;
      saveHist(histList().filter(x => histCode(x) !== it.code));
      const i = items.indexOf(it), had = $('#list').contains(document.activeElement);
      items = items.filter(x => x !== it);
      render();
      // карточку с кнопкой в фокусе стёрли — ставим фокус на соседнюю (или на «Пока пусто»), а не на <body>
      if (had) {
        const next = items[Math.min(i, items.length - 1)];
        const h = next ? document.getElementById(cardId(next.code) + '-t') : $('#empty h2');
        if (h) { h.tabIndex = -1; h.focus(); }
      }
      toast('Убрал из списка');
    }
  }

  function init() {
    if (CFG.site && CFG.site.name) $('#siteName').textContent = CFG.site.name;
    document.addEventListener('click', onClick);
    // короткую ссылку готовим заранее: на iPhone «Поделиться» не открывается после ожидания сети
    $('#list').addEventListener('pointerdown', e => {
      const b = e.target.closest('[data-a="copy"],[data-a="share"]');
      const it = b && itemOf(b);
      if (it) shortOf(it);
    });
    addEventListener('storage', e => {
      if (!e.key || e.key === HIST) { load(); return; }
      if (e.key.startsWith('kuda-votes:') || e.key.startsWith('kuda-voter:')) {
        Promise.all(items.filter(it => it.group).map(async it => { it.vsuf = await votesSuffix(it.code); })).then(paintAll);
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (!notifyOn()) { clearTimeout(timer); timer = 0; } return; }
      seenAll();
      schedule(4000 - (Date.now() - lastPoll));
    });
    addEventListener('focus', seenAll);
    addEventListener('pageshow', e => { if (e.persisted) load(); });
    load().then(() => {
      // пришли из уведомления: invites.html#inv-<id> — показываем нужную карточку
      const m = /^#(inv-[a-z0-9]{1,16})$/.exec(location.hash);
      const el = m && document.getElementById(m[1]);
      if (el) { el.scrollIntoView({ block: 'center' }); focusFresh(el.dataset.code); }
    });
  }

  init();
})();

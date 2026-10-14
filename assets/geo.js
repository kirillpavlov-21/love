/* «Рядом со мной»: где человек находится.
   1) Геолокация браузера. На компьютере её часто нет: Chrome и Edge определяют место через сетевой сервис,
      и без Wi-Fi он может молчать, даже когда доступ разрешён. Поэтому ждём подольше и пробуем второй раз.
   2) Если не вышло — человек выбирает станцию метро (координаты станций считаем по местам каталога)
      или ставит точку на карте. Точка запоминается только в этом браузере. */
(function () {
  'use strict';

  const KEY = 'kuda-near';
  const ls = {
    get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } },
    set(v) { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (e) { /* приватный режим */ } },
  };

  /* Москва и ближнее Подмосковье: точку дальше ~70 км от центра считаем ошибкой (VPN, чужой город) */
  const CENTER = { lat: 55.751, lon: 37.618 };
  function inArea(p) {
    const K = window.DateKit;
    return !!p && K.distM(CENTER, p) < 70000;
  }

  function once(opts) {
    return new Promise((res, rej) => navigator.geolocation.getCurrentPosition(
      pos => res({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy }), rej, opts));
  }
  /* Возвращает точку или бросает ошибку с кодом: denied | unavailable | timeout | unsupported | far */
  async function locate() {
    if (!('geolocation' in navigator)) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
    if (!window.isSecureContext) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
    let p;
    try {
      p = await once({ enableHighAccuracy: false, timeout: 9000, maximumAge: 600000 });
    } catch (e) {
      if (e && e.code === 1) throw Object.assign(new Error('denied'), { code: 'denied' });
      // вторая попытка: точная геолокация (GPS на телефоне, Wi-Fi на ноутбуке)
      try { p = await once({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }); } catch (e2) {
        if (e2 && e2.code === 1) throw Object.assign(new Error('denied'), { code: 'denied' });
        throw Object.assign(new Error('unavailable'), { code: e2 && e2.code === 3 ? 'timeout' : 'unavailable' });
      }
    }
    if (!inArea(p)) throw Object.assign(new Error('far'), { code: 'far', point: p });
    return Object.assign(p, { label: 'Ты здесь', src: 'gps' });
  }

  /* Станции, рядом с которыми в каталоге только места с примерными координатами, — точка входа в метро */
  const FIXED = {
    'Марьино': [55.65, 37.744],
    'Свиблово': [55.8556, 37.6531],
    'Первомайская': [55.7944, 37.7994],
    'Коньково': [55.6334, 37.5193],
    'Рижская': [55.7925, 37.6363],
    'Алексеевская': [55.8078, 37.6387],
    'Бабушкинская': [55.8697, 37.6644],
    'Алтуфьево': [55.8981, 37.5867],
    'Беломорская': [55.8653, 37.4763],
    'Ховрино': [55.8781, 37.4818],
    'Молодёжная': [55.7411, 37.4159],
    'Аминьевская': [55.6975, 37.4636],
    'Озёрная': [55.6698, 37.4489],
    'Новопеределкино': [55.6387, 37.3549],
    'Беляево': [55.6426, 37.5262],
    'Пражская': [55.6118, 37.6033],
    'Южная': [55.6223, 37.609],
    'Братиславская': [55.6588, 37.7509],
    'Рязанский проспект': [55.7166, 37.7928],
    'Электрозаводская': [55.782, 37.7053],
    'Семёновская': [55.783, 37.7194],
    'Щёлковская': [55.8101, 37.7985],
    'Выхино': [55.7158, 37.8171],
    'Преображенская площадь': [55.7963, 37.715],
    'Новокосино': [55.7451, 37.8641],
  };
  /* Станции: медиана координат мест с этой станцией (только точные координаты, ≥ 5 знаков) */
  let STATIONS = null;
  function stations() {
    if (STATIONS) return STATIONS;
    const K = window.DateKit, by = {};
    const prec = x => (String(x).split('.')[1] || '').length;
    // точные координаты (≥ 5 знаков) важнее; станции только с примерными точками тоже попадают в список
    const rough = {};
    Object.values(K.kuda().places).forEach(p => {
      if (!p.metro || p.adult || /МЦД/.test(p.metro)) return;
      const box = prec(p.lat) >= 5 ? by : rough;
      (box[p.metro] = box[p.metro] || []).push(p);
    });
    Object.keys(rough).forEach(m => { if (!by[m]) by[m] = rough[m]; });
    const med = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
    STATIONS = Object.entries(by).map(([name, ps]) => FIXED[name] ? { name, lat: FIXED[name][0], lon: FIXED[name][1], n: ps.length }
      : { name, lat: med(ps.map(p => p.lat)), lon: med(ps.map(p => p.lon)), n: ps.length })
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return STATIONS;
  }

  const MSG = {
    denied: 'Доступ к геопозиции запрещён для этого сайта. Разреши его в настройках браузера (значок слева от адреса) или выбери метро.',
    unavailable: 'Браузер не смог определить, где ты. На компьютере так бывает без Wi-Fi. Выбери станцию метро или точку на карте.',
    timeout: 'Браузер слишком долго определял место. Выбери станцию метро или точку на карте.',
    unsupported: 'Этот браузер не умеет определять место. Выбери станцию метро или точку на карте.',
    far: 'Похоже, ты не в Москве (или включён VPN). Выбери станцию метро или точку на карте.',
  };

  window.KudaGeo = { locate, stations, inArea, saved: ls.get, save: ls.set, MSG };
})();

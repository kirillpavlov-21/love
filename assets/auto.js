/* Сгенерировано pipeline/run.mjs — не править руками: изменения придут следующим запуском. */
(function (A) {
  'use strict';
  var K = window.KUDA || (window.KUDA = {});
  if (!K.places) K.places = {};
  if (!K.scenarios) K.scenarios = [];
  if (!K.adult) K.adult = [];
  var E = window.KUDA_EVENTS || (window.KUDA_EVENTS = []);
  var own = Object.prototype.hasOwnProperty;
  var places = A.places || {}, scenarios = A.scenarios || [], events = A.events || [], closedIds = A.closed || [], buzz = A.buzz || {};
  var i, j, id, seen, stops;
  // места: id, которые уже есть в places.js, не трогаем
  for (id in places) if (own.call(places, id) && !own.call(K.places, id)) K.places[id] = places[id];
  // планы и события: только новые id
  seen = Object.create(null);
  for (i = 0; i < K.scenarios.length; i++) if (K.scenarios[i]) seen[K.scenarios[i].id] = 1;
  for (i = 0; i < scenarios.length; i++) if (scenarios[i] && !seen[scenarios[i].id]) { seen[scenarios[i].id] = 1; K.scenarios.push(scenarios[i]); }
  seen = Object.create(null);
  for (i = 0; i < E.length; i++) if (E[i]) seen[E[i].id] = 1;
  for (i = 0; i < events.length; i++) if (events[i] && !seen[events[i].id]) { seen[events[i].id] = 1; E.push(events[i]); }
  // закрытые места: пометить, убрать планы с ними и убрать из 18+
  var closed = Object.create(null);
  for (i = 0; i < closedIds.length; i++) {
    id = closedIds[i];
    closed[id] = 1;
    if (own.call(K.places, id) && K.places[id]) K.places[id].closed = true;
  }
  for (id in K.places) if (own.call(K.places, id) && K.places[id] && K.places[id].closed) closed[id] = 1;
  for (i = K.scenarios.length - 1; i >= 0; i--) {
    stops = (K.scenarios[i] && K.scenarios[i].stops) || [];
    for (j = 0; j < stops.length; j++) if (closed[stops[j]]) { K.scenarios.splice(i, 1); break; }
  }
  for (i = K.adult.length - 1; i >= 0; i--) if (closed[K.adult[i]]) K.adult.splice(i, 1);
  // «Обсуждают»: неделя ISO (2026-W42), когда о месте писали три источника и больше
  for (id in buzz) if (own.call(buzz, id) && own.call(K.places, id) && K.places[id]) K.places[id].buzz = buzz[id];
})({
  "updated": "2026-11-03",
  "places": {
    "m2-organic-club": {"name":"M2 organic club","kind":"Ресторан","emoji":"🍽️","addr":"ул. Спиридоновка, 34/1","metro":"Баррикадная","lat":55.762188,"lon":37.590504,"price":2,"okr":"center","cat":"food","note":"Ресторан сети с собственной фермой: сезонная кухня из фермерских продуктов, запоминающиеся десерты и лавка с молочным и выпечкой.","hint":["first"],"chk":"2026-11","added":"2026-11-03"},
    "spb-catch22": {"name":"Catch22","kind":"Коктейльный бар","emoji":"🍸","addr":"Бородинская ул., 4А","metro":"Звенигородская","lat":59.925729,"lon":30.331851,"price":3,"okr":"center","cat":"bar","note":"Стильный бар напротив БДТ, где часто проходят светские вечера; подойдёт для особого свидания или выхода после театра.","chk":"2026-11","added":"2026-11-03","city":"spb"},
    "spb-igristye": {"name":"Игристые","kind":"Ресторан","emoji":"🍽️","addr":"пер. Гривцова, 13/11","metro":"Садовая","lat":59.926663,"lon":30.317424,"price":2,"okr":"center","cat":"food","note":"Ресторан с сенсорными столами: через них заказывают еду, ставят музыку и играют, плюс бесплатное караоке с полудня. Весёлый вариант для компании.","chk":"2026-11","added":"2026-11-03","city":"spb"},
    "spb-most-bistro": {"name":"Мост бистро","kind":"Бистро","emoji":"🍽️","addr":"Приморский пр., 80","metro":"Беговая","lat":59.989006,"lon":30.188474,"price":2,"okr":"nw","cat":"food","note":"Бистро рядом с Лахта Центром и парком 300-летия: долгие завтраки, пироги по мотивам кино и сериалов, вино. Удобно перед прогулкой у залива.","hint":["first"],"chk":"2026-11","added":"2026-11-03","city":"spb"},
    "spb-sanisayd": {"name":"Санисайд","kind":"Кафе","emoji":"🍽️","addr":"Гороховая ул., 47Б","metro":"Адмиралтейская","lat":59.934611,"lon":30.312936,"price":2,"okr":"center","cat":"food","note":"Городское кафе с полезной едой и завтраками в течение всего дня; осенью добавили чиа-пудинги и тыквенный латте. Подходит для неспешной встречи днём.","hint":["first"],"chk":"2026-11","added":"2026-11-03","city":"spb"}
  },
  "scenarios": [
    {"id":"spb-d-auto-bdt-i-kokteyl-posle-spektaklya","mode":"date","emoji":"🎭","title":"БДТ и коктейль после спектакля","stops":["spb-bdt-tovstonogova","spb-catch22"],"when":"вечер","tags":["culture"],"why":"Спектакль в БДТ, а бар буквально напротив театра: можно обсудить постановку за коктейлем, никуда не идя.","city":"spb","added":"2026-11-03"},
    {"id":"spb-w-auto-ulitsa-rossi-i-vecher-v-bare","mode":"girls","emoji":"🍸","title":"Улица Росси и вечер в баре","stops":["spb-ulitsa-zodchego","spb-catch22"],"when":"вечер","tags":["autumn"],"why":"Пройтись по идеально ровной улице Росси в огнях, затем семь минут к Фонтанке — в нарядный бар на особый вечер.","city":"spb","added":"2026-11-03"},
    {"id":"auto-date-prudy-i-fermerskiy-uzhin","mode":"date","emoji":"🦢","title":"Пруды и фермерский ужин","stops":["patriki","m2-organic-club"],"when":"вечер","tags":["autumn"],"why":"Круг вокруг Патриарших, а через пять минут пешком — ужин из фермерских продуктов и десерт на двоих.","added":"2026-11-03"},
    {"id":"auto-girls-chekhov-i-sezonnaya-kukhnya","mode":"girls","emoji":"📚","title":"Чехов и сезонная кухня","stops":["chekhov-house","m2-organic-club"],"when":"день","tags":["culture"],"why":"Небольшой дом-музей писателя, затем пять минут пешком до обеда с сезонным меню и лавкой, где можно взять выпечку домой.","added":"2026-11-03"},
    {"id":"spb-d-auto-lakhta-i-dolgiy-zavtrak","mode":"date","emoji":"🌊","title":"Лахта и долгий завтрак","stops":["spb-lakhta-obzornaya","spb-most-bistro"],"when":"утро","tags":["view"],"why":"Утром — набережная у Лахта Центра и вид на залив, потом минут восемь пешком до бистро с поздними завтраками и пирогами.","city":"spb","added":"2026-11-03"},
    {"id":"spb-w-auto-park-u-zaliva-i-pirogi","mode":"girls","emoji":"🍂","title":"Парк у залива и пироги","stops":["spb-park-300","spb-most-bistro"],"when":"день","tags":["autumn"],"why":"Осенняя прогулка по парку 300-летия вдоль воды, а дальше завтрак в бистро с пирогами по мотивам любимых сериалов.","city":"spb","added":"2026-11-03"},
    {"id":"spb-d-auto-fotovystavka-i-pozdniy-zavtrak","mode":"date","emoji":"📷","title":"Фотовыставка и поздний завтрак","stops":["spb-rosfoto","spb-sanisayd"],"when":"день","tags":["culture"],"why":"Выставка в РОСФОТО, потом три минуты пешком до спокойного кафе, где завтракают весь день и легко договорить.","city":"spb","added":"2026-11-03"},
    {"id":"spb-w-auto-kolonnada-i-tykvennyy-latte","mode":"girls","emoji":"⛪","title":"Колоннада и тыквенный латте","stops":["spb-kolonnada-isaakievskogo","spb-sanisayd"],"when":"день","tags":["view","autumn"],"why":"Подъём на колоннаду Исаакия ради вида на крыши, затем пять минут до кафе с полезной едой и осенними напитками.","city":"spb","added":"2026-11-03"},
    {"id":"spb-w-auto-yusupovskiy-sad-i-karaoke","mode":"girls","emoji":"🎤","title":"Юсуповский сад и караоке","stops":["spb-yusupovskiy-sad","spb-igristye"],"when":"вечер","tags":["autumn"],"why":"Прогулка по саду у пруда, затем пять минут до ресторана, где через стол ставят музыку и поют караоке без доплаты.","city":"spb","added":"2026-11-03"},
    {"id":"spb-g-auto-katka-i-stol-pristavka","mode":"guys","emoji":"🎮","title":"Катка и стол-приставка","stops":["spb-community-heroes","spb-igristye"],"when":"вечер","tags":["pc"],"why":"Пара матчей в компьютерном клубе, потом четыре минуты пешком до ужина за сенсорным столом, где можно доиграть.","city":"spb","added":"2026-11-03"}
  ],
  "events": [
    {"id":"ev-spb-damy-i-gusary-sankt-peterburgskiy-20261106","title":"Дамы и гусары","cat":"theatre","emoji":"🎭","start":"2026-11-06","end":"2026-11-06","time":"18:00","venue":"Санкт-Петербургский гуманитарный университет профсоюзов","addr":"ул. Фучика, 15","metro":"Бухарестская","lat":59.87947,"lon":30.377109,"price":[0,0],"age":"6+","reg":true,"url":"https://masterskaya-ss-pronina.timepad.ru/event/3988936/","note":"Студенческая постановка классического водевиля с музыкой и юмором, бесплатно по записи; лёгкий вариант для вечера вдвоём.","fit":["date","girls"],"city":"spb","added":"2026-11-03"}
  ],
  "closed": []
});

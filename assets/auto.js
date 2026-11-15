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
  "updated": "2026-11-15",
  "places": {
    "spb-muzey-arkheologii-zaliva": {"name":"Музей археологии залива","kind":"Музей","emoji":"🏛️","addr":"Кронштадт, форт Константин","metro":"","lat":59.995194,"lon":29.703269,"price":1,"okr":"out","cat":"culture","note":"Новый музей подводных находок в кронштадтском форте: вещи с затонувших судов XVIII–XX веков и рассказ о том, как их поднимают. Хороший повод для поездки вдвоём.","chk":"2026-11","added":"2026-11-15","city":"spb"},
    "spb-put": {"name":"Путь","kind":"Галерея","emoji":"🖼️","addr":"Гороховая ул., 49Б","metro":"Сенная площадь","lat":59.926711,"lon":30.323185,"price":1,"okr":"center","cat":"culture","note":"Галерея психологических выставок без света: аудио, видео и личные задания о страхах, желаниях и близких. После визита есть о чём поговорить вдвоём.","hint":["first"],"chk":"2026-11","added":"2026-11-15","city":"spb"},
    "spb-teatralnaya-biblioteka": {"name":"Театральная библиотека","kind":"Библиотека","emoji":"🏛️","addr":"ул. Зодчего Росси, 2","metro":"Гостиный двор","lat":59.931125,"lon":30.336587,"price":1,"okr":"center","cat":"culture","note":"Старинная библиотека с историей от XVIII века: сюда приходят на выставки, лекции и экскурсии. Тихий культурный повод для прогулки по центру вдвоём.","hint":["first"],"chk":"2026-11","added":"2026-11-15","city":"spb"}
  },
  "scenarios": [
    {"id":"spb-d-auto-poezdka-v-fort-za-nakhodkami-so-dna","mode":"date","emoji":"⚓","title":"Поездка в форт за находками со дна","stops":["spb-muzey-arkheologii-zaliva"],"when":"день","tags":["culture"],"why":"Выбираетесь из города в Кронштадт на полдня: в форте смотрите вещи с затонувших кораблей и узнаёте, как их поднимают. Дорога вдвоём — уже часть свидания.","city":"spb","added":"2026-11-15"},
    {"id":"spb-g-auto-fort-i-zatonuvshie-korabli","mode":"guys","emoji":"🚢","title":"Форт и затонувшие корабли","stops":["spb-muzey-arkheologii-zaliva"],"when":"день","tags":["culture"],"why":"Собираетесь компанией и едете в кронштадтский форт: якоря, утварь и детали судов трёх столетий плюс рассказ о работе подводных археологов. Хватит тем на обратную дорогу.","city":"spb","added":"2026-11-15"},
    {"id":"spb-d-auto-vystavka-v-temnote-i-kokteyli","mode":"date","emoji":"🕯️","title":"Выставка в темноте и коктейли","stops":["spb-put","spb-gorkiy"],"when":"вечер","tags":["culture"],"why":"Сначала проходите выставку без света и делитесь тем, что каждый там услышал, а потом идёте в коктейльный бар в соседнем доме — меньше минуты пешком, и разговор продолжается сам.","city":"spb","added":"2026-11-15"},
    {"id":"spb-w-auto-vystavka-o-sebe-i-kofe-v-osobnyake","mode":"girls","emoji":"☕","title":"Выставка о себе и кофе в особняке","stops":["spb-put","spb-dom-flou"],"when":"день","tags":["culture"],"why":"Днём проходите личные задания в галерее, затем пять минут пешком до кофейни в особняке модерн: спокойное место, чтобы обсудить, кому что откликнулось.","city":"spb","added":"2026-11-15"},
    {"id":"spb-d-auto-biblioteka-ulitsa-rossi-i-kokteyli","mode":"date","emoji":"📚","title":"Библиотека, улица Росси и коктейли","stops":["spb-teatralnaya-biblioteka","spb-ulitsa-zodchego","spb-oy"],"when":"вечер","tags":["culture"],"why":"Заходите на выставку в старинную библиотеку, выходите прямо на идеально симметричную улицу Росси и через пять минут пешком садитесь в коктейльном баре.","city":"spb","added":"2026-11-15"},
    {"id":"spb-w-auto-teatralnyy-kvartal-i-kofe","mode":"girls","emoji":"🎭","title":"Театральный квартал и кофе","stops":["spb-teatralnaya-biblioteka","spb-muzey-fotosalon-karla-bully","spb-cafe-alto"],"when":"день","tags":["culture"],"why":"Экскурсия или выставка в библиотеке, затем пять минут до старинного фотоателье с видом на крыши Невского, а после — кофе неподалёку. Всё в пределах десяти минут ходьбы.","city":"spb","added":"2026-11-15"}
  ],
  "events": [
    {"id":"ev-festival-izobreteniy-tsentralnyy-detskiy-mir-20261030","title":"Фестиваль изобретений","cat":"festival","emoji":"🎪","start":"2026-10-24","end":"2026-11-15","venue":"Центральный детский мир","addr":"Театральный пр., 5, стр. 1","metro":"Кузнецкий Мост","lat":55.760083,"lon":37.624963,"price":[0,0],"url":"https://cdm-moscow.ru/news/festival-izobreteniy-v-tsdm","note":"Бесплатный научный праздник в ЦДМ: опыты, робототехника, мастер-классы и концерты. Подойдёт, чтобы зайти компанией или с детьми.","fit":["girls","guys"],"added":"2026-11-15"},
    {"id":"ev-velichayshiy-shoumen-teatr-na-melnikova-20261126","title":"Величайший шоумен","cat":"theatre","emoji":"🎭","start":"2026-11-26","end":"2026-11-26","time":"19:00","venue":"Театр на Мельникова","place":"teatr-na-melnikova","addr":"ул. Мельникова, 7, стр. 1","metro":"Дубровка","lat":55.725548,"lon":37.673468,"price":[700,700],"age":"6+","url":"https://iframeab-pre8259.intickets.ru/event/50140106/","note":"Мюзикл о мечтателе, придумавшем большое шоу: живой вокал, цирковые номера, костюмы и грим. Лёгкий вечер для пары или подруг.","fit":["date","girls"],"added":"2026-11-15"},
    {"id":"ev-basni-dedushki-krylova-anglikanskaya-tserkov-20261128","title":"Басни дедушки Крылова","cat":"kids","emoji":"🧸","start":"2026-11-28","end":"2026-11-28","time":"14:00","venue":"Англиканская церковь Святого Андрея","addr":"Вознесенский пер., 8/5, стр. 3","metro":"Александровский сад","lat":55.758379,"lon":37.605052,"age":"0+","url":"https://stageon.ru/event/cmv28li16yfyc147525n49p5y","note":"Детский интерактивный концерт духового ансамбля по басням Крылова в старинном соборе: загадки, дирижирование и музыка для семейного похода.","fit":[],"added":"2026-11-15"},
    {"id":"ev-spb-poka-sobiraetsya-mir-tsifergauz-20261030","title":"Пока собирается мир","cat":"exhibition","emoji":"🖼️","start":"2026-10-29","end":"2027-01-31","venue":"Цифергауз","addr":"наб. Адмиралтейского канала, 2И","metro":"Горный институт","lat":59.929461,"lon":30.285763,"price":[0,0],"age":"16+","reg":true,"url":"https://zifergauz.timepad.ru/event/4278494/","note":"Бесплатная выставка о связях природы, человека и технологий: художники исследуют, как камера, алгоритмы и память складывают картину мира. Тихий формат для свидания.","fit":["date","girls"],"city":"spb","added":"2026-11-15"},
    {"id":"ev-spb-ayvazovskiy-korpus-benua-russkogo-20261031","title":"Айвазовский","cat":"exhibition","emoji":"🖼️","start":"2026-10-16","end":"2027-05-10","venue":"Корпус Бенуа Русского музея","place":"spb-korpus-benua","addr":"Инженерная ул., 2-4","metro":"Невский проспект","lat":59.938738,"lon":30.328385,"price":[800,800],"url":"https://ticket.rusmuseum.ru/event/668A0C0DF419C7FB45D77F1D7D69952F2E71790D/2026-10-21","note":"Крупная ретроспектива мариниста: около двухсот работ, отреставрированный «Девятый вал», модели кораблей и мультимедийный зал. Спокойный повод для свидания.","fit":["date","girls"],"city":"spb","added":"2026-11-15"}
  ],
  "closed": [],
  "buzz": {"kuzminki":"2026-W46","spb-ekaterininskiy-park":"2026-W46","spb-nizhniy-park":"2026-W46","spb-oranienbaum":"2026-W46","spb-park-aleksandriya":"2026-W46","usadba-marfino":"2026-W46"}
});

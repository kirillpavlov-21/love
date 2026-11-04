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
  "updated": "2026-11-04",
  "places": {
    "finch-2": {"name":"Finch","kind":"Кафе","emoji":"🍽️","addr":"Большой Афанасьевский пер., 14","metro":"Кропоткинская","lat":55.747046,"lon":37.597586,"price":2,"okr":"center","cat":"food","note":"Новое бистро на первом этаже старого доходного дома: завтраки, сэндвичи и десерты в аккуратном интерьере, можно и поработать.","hint":["first"],"chk":"2026-11","added":"2026-11-04"},
    "milovida": {"name":"Миловида","kind":"Кофейня","emoji":"☕","addr":"ул. Дольская, 1, стр. 13","metro":"Царицыно","lat":55.612456,"lon":37.681685,"price":1,"okr":"south","cat":"coffee","note":"Кофейня в старинной арочной галерее в парке Царицыно: кофе с десертом и вид на Верхний пруд, особенно хороша в листопад.","hint":["first","autumn","view"],"chk":"2026-11","added":"2026-11-04"},
    "spb-ba": {"name":"Ба","kind":"Ресторан русской кухни","emoji":"🍽️","addr":"Колокольная ул., 1","metro":"Владимирская","lat":59.928627,"lon":30.349421,"price":2,"okr":"center","cat":"food","note":"Щичная в духе японской раменной: пять видов щей, свои соленья и квашеная капуста, русская кухня без музейности.","hint":["autumn"],"chk":"2026-11","added":"2026-11-04","city":"spb"},
    "spb-casimir": {"name":"Casimir","kind":"Кофейня","emoji":"☕","addr":"Гагаринская ул., 34","metro":"Чернышевская","lat":59.943268,"lon":30.343616,"price":1,"okr":"center","cat":"coffee","note":"Кофейня с сезонным меню: необычный фильтр, тыквенный суп, каша с тыквой и оладьи с брусникой.","hint":["first","autumn"],"chk":"2026-11","added":"2026-11-04","city":"spb"},
    "spb-geologorazvedochnyy-muzey": {"name":"Геологоразведочный музей","kind":"Музей","emoji":"🏛️","addr":"Средний пр. В.О., 74","metro":"Горный институт","lat":59.938032,"lon":30.262308,"price":1,"okr":"vo","cat":"culture","note":"Музей минералов и окаменелостей, где теперь показывают настоящие яйца динозавров из Гоби и предлагают самим разгадать, чьи они.","hint":["first"],"chk":"2026-11","added":"2026-11-04","city":"spb"}
  },
  "scenarios": [
    {"id":"auto-date-pushkin-na-prechistenke-i-obed","mode":"date","emoji":"📜","title":"Пушкин на Пречистенке и обед","stops":["pushkin-museum-prechistenka","finch-2"],"when":"день","tags":["culture"],"why":"Сначала залы музея Пушкина в старой усадьбе, потом пять минут переулками до бистро в доходном доме — сэндвичи и десерт, чтобы обсудить увиденное.","added":"2026-11-04"},
    {"id":"auto-girls-bulvar-i-branch-v-pereulke","mode":"girls","emoji":"🍂","title":"Бульвар и бранч в переулке","stops":["gogolevsky","finch-2"],"when":"утро","tags":["autumn"],"why":"Неспешная прогулка по Гоголевскому бульвару и пара минут до Большого Афанасьевского, где можно засесть за поздний завтрак и десерты.","added":"2026-11-04"},
    {"id":"spb-d-auto-yaytsa-dinozavrov-i-pekarnya","mode":"date","emoji":"🦕","title":"Яйца динозавров и пекарня","stops":["spb-geologorazvedochnyy-muzey","spb-babka"],"when":"день","tags":["culture"],"why":"Разгадать, чьи яйца из Гоби, побродить среди минералов, а потом пройти минут восемь по Васильевскому до пекарни за выпечкой.","city":"spb","added":"2026-11-04"},
    {"id":"spb-g-auto-mineraly-i-pivnoy-uzhin","mode":"guys","emoji":"🍺","title":"Минералы и пивной ужин","stops":["spb-geologorazvedochnyy-muzey","spb-tolstyy-fraer-vasilevskom"],"when":"вечер","tags":["culture"],"why":"Камни, окаменелости и динозавры в музее, затем около двенадцати минут пешком до пивного ресторана на Васильевском.","city":"spb","added":"2026-11-04"},
    {"id":"spb-d-auto-muzey-shtiglitsa-i-tykvennyy-sup","mode":"date","emoji":"🏛️","title":"Музей Штиглица и тыквенный суп","stops":["spb-muzey-shtiglitsa","spb-casimir"],"when":"день","tags":["culture","autumn"],"why":"Роскошные залы музея Штиглица, а через две минуты — уютная кофейня с осенним меню, чтобы согреться супом или оладьями.","city":"spb","added":"2026-11-04"},
    {"id":"spb-w-auto-poltory-komnaty-i-kofe","mode":"girls","emoji":"☕","title":"Полторы комнаты и кофе","stops":["spb-muzey-brodskogo","spb-casimir"],"when":"день","tags":["culture","autumn"],"why":"Квартира Бродского на Литейном и пять минут пешком до кофейни на Гагаринской с необычным фильтром и тыквенными блюдами.","city":"spb","added":"2026-11-04"},
    {"id":"spb-d-auto-dostoevskiy-i-tarelka-shchey","mode":"date","emoji":"📚","title":"Достоевский и тарелка щей","stops":["spb-literaturno-memorialnyy","spb-ba"],"when":"вечер","tags":["culture","autumn"],"why":"Квартира Достоевского в двух минутах от щичной: после музея — горячие щи и соленья, очень петербургский осенний вечер.","city":"spb","added":"2026-11-04"},
    {"id":"spb-g-auto-arktika-shchi-i-pab","mode":"guys","emoji":"🧊","title":"Арктика, щи и паб","stops":["spb-muzey-arktiki","spb-ba","spb-ring-bells"],"when":"вечер","tags":["culture"],"why":"Полярные экспедиции в музее, потом сытные щи в пяти минутах и пинта в пабе буквально через дорогу.","city":"spb","added":"2026-11-04"},
    {"id":"spb-w-auto-dovlatov-shchi-i-kokteyl","mode":"girls","emoji":"🍸","title":"Довлатов, щи и коктейль","stops":["spb-muzey-dovlatova","spb-ba","spb-el-copitas"],"when":"вечер","tags":["culture"],"why":"Короткий музей Довлатова, ужин в щичной в пяти минутах ходьбы и коктейль в соседнем баре напоследок.","city":"spb","added":"2026-11-04"},
    {"id":"auto-date-tsaritsyno-i-kofe-u-pruda","mode":"date","emoji":"🍁","title":"Царицыно и кофе у пруда","stops":["tsaritsyno","milovida"],"when":"день","tags":["autumn","view"],"why":"Прогулка по дворцовому ансамблю и парку, а потом кофе с десертом в старинной галерее с видом на Верхний пруд.","added":"2026-11-04"}
  ],
  "events": [
    {"id":"ev-spb-tatyana-larina-kts-troitskiy-20261108","title":"Татьяна Ларина","cat":"theatre","emoji":"🎭","start":"2026-11-08","end":"2026-11-08","time":"18:00","venue":"КЦ Троицкий","addr":"пр. Обуховской Обороны, 223","metro":"Пролетарская","lat":59.866295,"lon":30.466862,"price":[0,0],"age":"12+","reg":true,"url":"https://teatr-dva-kryla.ru/","note":"Бесплатный спектакль по «Евгению Онегину» в малом зале культурного центра, нужна регистрация.","fit":["date"],"city":"spb","added":"2026-11-04"},
    {"id":"ev-spb-dzhuletta-stseny-iz-tragedii-uezdnye-kts-troitskiy-20261121","title":"Джульетта. Сцены из трагедии. Уездные барышни. Сцены из сельской жизни","cat":"theatre","emoji":"🎭","start":"2026-11-21","end":"2026-11-21","time":"19:00","venue":"КЦ Троицкий","addr":"пр. Обуховской Обороны, 223","metro":"Пролетарская","lat":59.866295,"lon":30.466862,"price":[0,0],"reg":true,"url":"https://teatr-dva-kryla.ru/","note":"Бесплатный спектакль по Шекспиру и повестям Пушкина: сцены из «Ромео и Джульетты» и «Барышни-крестьянки».","fit":["date"],"city":"spb","added":"2026-11-04"},
    {"id":"ev-spb-doch-docheri-docherey-docheri-muzey-oberiu-20261019","title":"Дочь дочери дочерей дочери","cat":"exhibition","emoji":"🖼️","start":"2026-10-12","end":"2027-01-12","venue":"Музей ОБЭРИУ","place":"spb-muzey-oberiu","addr":"Съезжинская ул., 37","metro":"Горьковская","lat":59.953903,"lon":30.306148,"price":[950,950],"url":"https://oberiumuseum.ru/calendar/","note":"Новая экспозиция в бывшей квартире Введенского о женщинах круга обэриутов: художницах, музах и хранительницах архивов.","fit":["date","girls"],"city":"spb","added":"2026-11-04"}
  ],
  "closed": [],
  "buzz": {"spb-muzey-oberiu":"2026-W45"}
});

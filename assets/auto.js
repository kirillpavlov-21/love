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
  "updated": "2026-11-11",
  "places": {
    "antipa": {"name":"ANTIПА","kind":"Кафе","emoji":"🍽️","addr":"Колымажный пер., 8","metro":"Кропоткинская","lat":55.747985,"lon":37.605352,"price":1,"okr":"center","cat":"food","note":"Светлое минималистичное кафе при храме с завтраками и свежей выпечкой. Удобно зайти перед Пушкинским музеем.","hint":["first"],"chk":"2026-11","added":"2026-11-11"},
    "kafedra": {"name":"Кафедра","kind":"Кофейня","emoji":"☕","addr":"ул. Малая Грузинская, 25, стр. 7","metro":"Улица 1905 года","lat":55.76662,"lon":37.571352,"price":1,"okr":"center","cat":"coffee","note":"Кофейня рядом с католическим собором: тихо, есть пироги и место посидеть с ноутбуком. Хороша для спокойного разговора.","hint":["first"],"chk":"2026-11","added":"2026-11-11"},
    "ostrov-paskhi": {"name":"Остров Пасхи","kind":"Кафе","emoji":"☕","addr":"ул. Покровка, 26/1","metro":"Чкаловская","lat":55.759834,"lon":37.649286,"price":1,"okr":"center","cat":"coffee","note":"Необычное пространство при храме из трёх залов, один из которых оформлен как катакомбы. Есть о чём поговорить за кофе.","hint":["first"],"chk":"2026-11","added":"2026-11-11"},
    "sofiya": {"name":"София","kind":"Кофейня","emoji":"☕","addr":"Софийская наб., 32, стр. 13","metro":"Третьяковская","lat":55.747687,"lon":37.621876,"price":1,"okr":"center","cat":"coffee","note":"Два этажа в колокольне с окнами на реку и Кремль и тихим двором. Уютная остановка во время прогулки по набережной.","hint":["first","view"],"chk":"2026-11","added":"2026-11-11"}
  },
  "scenarios": [
    {"id":"auto-date-goticheskiy-sobor-i-pirog","mode":"date","emoji":"⛪","title":"Готический собор и пирог","stops":["catholic-cathedral","kafedra"],"when":"день","tags":["culture"],"why":"Зайти в неоготический собор посмотреть витражи, а потом минута до тихой кофейни по соседству. Красивое место и спокойный разговор без дороги.","added":"2026-11-11"},
    {"id":"auto-girls-biomuzey-i-kofe-u-sobora","mode":"girls","emoji":"🦋","title":"Биомузей и кофе у собора","stops":["bio-museum","kafedra"],"when":"день","tags":["culture"],"why":"Старинный музей с коллекциями и оранжереей, затем четыре минуты пешком до кофейни с пирогами. Лёгкая познавательная прогулка на полдня.","added":"2026-11-11"},
    {"id":"auto-date-zoopark-i-teplaya-kofeynya","mode":"date","emoji":"🦒","title":"Зоопарк и тёплая кофейня","stops":["zoo","kafedra"],"when":"день","tags":["autumn"],"why":"Погулять среди вольеров, пока светло, и за десять минут дойти до кофейни согреться. Простой план без пафоса, где легко найти темы для разговора.","added":"2026-11-11"},
    {"id":"auto-date-zaryade-i-kofe-v-kolokolne","mode":"date","emoji":"🌇","title":"Зарядье и кофе в колокольне","stops":["zaryadye","sofiya"],"when":"день","tags":["view","autumn"],"why":"Прогулка по парку и парящему мосту, затем десять минут через реку до кофейни с окнами на Кремль. Виды с обоих берегов за одну встречу.","added":"2026-11-11"},
    {"id":"auto-girls-tretyakovka-i-vid-na-kreml","mode":"girls","emoji":"🎨","title":"Третьяковка и вид на Кремль","stops":["tretyakov-kadashi","sofiya"],"when":"день","tags":["culture","view"],"why":"После выставки в Кадашах семь минут пешком до набережной, где в колокольне варят кофе. Искусство сменяется тихим двором и панорамой.","added":"2026-11-11"},
    {"id":"auto-date-pushkinskiy-i-kafe-za-uglom","mode":"date","emoji":"🖼️","title":"Пушкинский и кафе за углом","stops":["pushkinmuseum","antipa"],"when":"день","tags":["culture"],"why":"Пара часов среди картин, а потом минута пешком до светлого кафе с выпечкой: впечатления удобно обсудить сразу, пока они свежие.","added":"2026-11-11"},
    {"id":"auto-girls-bulvar-i-pozdniy-zavtrak","mode":"girls","emoji":"🍂","title":"Бульвар и поздний завтрак","stops":["gogolevsky","antipa"],"when":"утро","tags":["autumn"],"why":"Неспешно пройтись по Гоголевскому бульвару и через пять минут сесть завтракать в тихом переулке. Спокойное начало выходного дня.","added":"2026-11-11"},
    {"id":"auto-date-most-s-vidom-i-kofe-v-pereulke","mode":"date","emoji":"🌉","title":"Мост с видом и кофе в переулке","stops":["patriarshy-bridge","antipa"],"when":"день","tags":["view"],"why":"С моста открывается панорама реки и центра, а в десяти минутах ходьбы ждёт кафе с тёплой выпечкой, где можно согреться после ветра.","added":"2026-11-11"},
    {"id":"auto-date-chistye-prudy-i-kofe-v-katakombakh","mode":"date","emoji":"🕯️","title":"Чистые пруды и кофе в катакомбах","stops":["chistye-prudy","ostrov-paskhi"],"when":"вечер","tags":["autumn"],"why":"Круг по бульвару у пруда и пять минут до необычного кафе с подземным залом. После прогулки на холоде приятно сесть в тепле и разговориться.","added":"2026-11-11"},
    {"id":"auto-girls-khokhlovka-i-tri-zala-na-pokrovke","mode":"girls","emoji":"☕","title":"Хохловка и три зала на Покровке","stops":["khokhlovskaya-ploshchad","ostrov-paskhi"],"when":"день","tags":[],"why":"Посидеть в амфитеатре у старой стены, а через четыре минуты выбрать зал по настроению в кафе при храме. Рядом, без спешки и с поводом для фото.","added":"2026-11-11"}
  ],
  "events": [
    {"id":"ev-spb-muzhskoy-sezon-dvorets-iskusstv-20270302","title":"Мужской сезон","cat":"show","emoji":"✨","start":"2027-03-02","end":"2027-03-02","time":"19:00","venue":"Дворец искусств Ленинградской области","addr":"пл. Стачек, 4","metro":"Нарвская","lat":59.900459,"lon":30.275936,"price":[1000,1000],"age":"16+","url":"https://iframeab-pre8259.intickets.ru/event/75795110/","note":"Гастрольное танцевальное шоу под струями воды, рассчитанное на женскую аудиторию. Вариант для вечера с подругами.","fit":["girls"],"city":"spb","added":"2026-11-11"},
    {"id":"ev-spb-letuchiy-korabl-pervyy-eksperimentalnyy-20261128","title":"Летучий корабль","cat":"kids","emoji":"🧸","start":"2026-11-28","end":"2026-11-28","time":"16:00","venue":"Первый Экспериментальный Театр","addr":"Константиновский пр., 19","metro":"Крестовский остров","lat":59.973139,"lon":30.270191,"url":"https://pervyy-eksperimenta-event.timepad.ru/event/4253268/","note":"Интерактивная сказка для детей с куклами, фокусами и знакомой музыкой. Вариант для семейного выхода днём.","fit":[],"city":"spb","added":"2026-11-11"}
  ],
  "closed": [],
  "buzz": {"kuzminki":"2026-W46","spb-ekaterininskiy-park":"2026-W46","spb-elagin-ostrov":"2026-W46","spb-korpus-benua":"2026-W46","spb-nizhniy-park":"2026-W46","spb-oranienbaum":"2026-W46","spb-park-aleksandriya":"2026-W46"}
});

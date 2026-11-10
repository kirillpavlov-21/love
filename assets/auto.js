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
  "updated": "2026-11-10",
  "places": {
    "dom-teleshova": {"name":"Дом Телешова","kind":"Музей","emoji":"🏛️","addr":"Покровский бул., 16–18, стр. 4–4А","metro":"Чкаловская","lat":55.753329,"lon":37.646317,"price":1,"okr":"center","cat":"culture","note":"Старинный особняк, где два века живёт одна семья: камин, живая музыка и чайная с оплатой по желанию — деньги идут на реставрацию. Тихое место для разговора.","hint":["first","autumn"],"chk":"2026-11","added":"2026-11-10"},
    "spb-dvorets-kottedzh": {"name":"Дворец Коттедж","kind":"Музей","emoji":"🏛️","addr":"Петергоф, парк Александрия, 7","metro":"Новый Петергоф (ж/д)","lat":59.878478,"lon":29.945313,"price":1,"okr":"out","cat":"culture","note":"Небольшой неоготический дворец Николая I в парке Александрия: семейные интерьеры, террасы и окна на залив. Камерная альтернатива парадному Петергофу.","hint":["first"],"chk":"2026-11","added":"2026-11-10","city":"spb"}
  },
  "scenarios": [
    {"id":"auto-date-chay-u-kamina-i-uzhin-na-pokrovke","mode":"date","emoji":"🫖","title":"Чай у камина и ужин на Покровке","stops":["dom-teleshova","plus47"],"when":"вечер","tags":["culture","autumn"],"why":"Сначала чай под живую музыку в старом особняке, потом пять минут пешком по бульвару до бистро. Тихое начало даёт наговориться, а ужин завершает вечер.","added":"2026-11-10"},
    {"id":"auto-girls-osobnyak-pereulki-i-knizhnyy","mode":"girls","emoji":"📚","title":"Особняк, переулки и книжный","stops":["ivanovskaya-gorka","dom-teleshova","ozero"],"when":"день","tags":["culture","autumn"],"why":"Прогулка по старым переулкам, затем чайная в особняке в семи минутах и книжный с кафе ещё в пяти. Всё рядом, можно никуда не спешить.","added":"2026-11-10"},
    {"id":"auto-date-staryy-dom-i-bar-s-kryshey","mode":"date","emoji":"🌇","title":"Старый дом и бар с крышей","stops":["dom-teleshova","sur"],"when":"закат","tags":["culture","view"],"why":"Час в особняке с камином и чаем, потом три минуты до бара с крышей. Уютный разговор сменяется видом на вечерний город.","added":"2026-11-10"},
    {"id":"spb-d-auto-aleksandriya-i-dvorets-u-zaliva","mode":"date","emoji":"🏰","title":"Александрия и дворец у залива","stops":["spb-park-aleksandriya","spb-dvorets-kottedzh"],"when":"день","tags":["culture","autumn"],"why":"Сначала идёте по аллеям парка к заливу, потом заходите в маленький дворец в шести минутах. Тихо, без толп парадного Петергофа.","city":"spb","added":"2026-11-10"}
  ],
  "events": [
    {"id":"ev-nedorosl-teatr-na-melnikova-20261128","title":"Недоросль","cat":"theatre","emoji":"🎭","start":"2026-11-28","end":"2026-11-28","time":"12:00","venue":"Театр на Мельникова","place":"teatr-na-melnikova","addr":"ул. Мельникова, 7, стр. 1","metro":"Дубровка","lat":55.725548,"lon":37.673468,"price":[700,700],"age":"6+","url":"https://iframeab-pre8259.intickets.ru/event/67986915/","note":"Музыкальная версия комедии Фонвизина: классический текст, исторические костюмы и современные ритмы, полтора часа без антракта. Подойдёт для похода с детьми.","fit":["girls"],"added":"2026-11-10"},
    {"id":"ev-moskovskiy-moroz-fest-usadba-deda-moroza-v-20261121","title":"Московский Мороз-фест","cat":"festival","emoji":"🎪","start":"2026-11-21","end":"2026-11-22","venue":"Усадьба Деда Мороза в Кузьминках","place":"kuzminki","addr":"Кузьминская ул., 10","metro":"Люблино","lat":55.677864,"lon":37.796277,"url":"https://www.mos.ru/news/item/177625073/","note":"Два дня зимнего фестиваля в усадьбе Деда Мороза: гости из разных регионов показывают свои новогодние традиции. Повод для прогулки по парку вдвоём или компанией.","fit":["date","girls"],"added":"2026-11-10"},
    {"id":"ev-mamulki-bend-petrovich-20261206","title":"Мамульки Bend","cat":"concert","emoji":"🎵","start":"2026-12-06","end":"2027-01-05","dates":["2026-12-06","2027-01-05"],"time":"19:00","venue":"Петрович","addr":"ул. Мясницкая, 24/7, стр. 3","metro":"Чистые пруды","lat":55.762511,"lon":37.636448,"price":[1200,1200],"url":"https://iframeab-pre4799.intickets.ru/seance/76255185/","note":"Праздничные концерты группы, которая мешает ска, диско, панк и джаз с фольклором и каверами. Шумный вечер для компании друзей.","fit":["guys","girls"],"added":"2026-11-10"}
  ],
  "closed": [],
  "buzz": {"if-bar":"2026-W46","kuzminki":"2026-W46","spb-ekaterininskiy-park":"2026-W46","spb-elagin-ostrov":"2026-W46","spb-korpus-benua":"2026-W46","spb-muzey-oberiu":"2026-W46","spb-nizhniy-park":"2026-W46","spb-oranienbaum":"2026-W46","spb-park-aleksandriya":"2026-W46"}
});

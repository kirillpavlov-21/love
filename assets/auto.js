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
  "updated": "2026-11-16",
  "places": {
    "anglikanskaya-tserkov-svyatogo-andreya": {"name":"Англиканская церковь Святого Андрея","kind":"Концертный зал","emoji":"🎵","addr":"Вознесенский пер., 8/5, стр. 3","metro":"Александровский сад","lat":55.758379,"lon":37.605052,"price":2,"okr":"center","cat":"culture","note":"Неоготическая церковь в переулке у Тверской, где регулярно идут концерты. Рядом сквер с ротондой и фонтаном — удобно совместить с прогулкой.","hint":["first"],"chk":"2026-11","added":"2026-11-16"},
    "sdvig": {"name":"СДВиГ","kind":"Бар","emoji":"🍸","addr":"Большая Сухаревская пл., 1/2, стр. 1","metro":"Сухаревская","lat":55.773073,"lon":37.632948,"price":2,"okr":"center","cat":"bar","note":"Бар-лофт во дворе у Сухаревской: рамён, крылышки, запечённый камамбер и авторские коктейли, по вечерам концерты, стендап и игры.","chk":"2026-11","added":"2026-11-16"},
    "spb-dumskaya-bashnya": {"name":"Думская башня","kind":"Смотровая площадка","emoji":"🏙️","addr":"Думская ул., 1-3","metro":"Невский проспект","lat":59.934708,"lon":30.329613,"price":1,"okr":"center","cat":"walk","note":"Смотровая на высоте почти 50 метров над Невским: подъём пешком по двум сотням ступеней мимо старого часового механизма. Короткое приключение на двоих.","hint":["view"],"chk":"2026-11","added":"2026-11-16","city":"spb"},
    "spb-fedorovskiy-skver": {"name":"Фёдоровский сквер","kind":"Сквер","emoji":"🌳","addr":"Дунайский пр., 47","metro":"Дунайская","lat":59.841113,"lon":30.408717,"price":1,"okr":"south","cat":"walk","note":"Обновлённый сквер на десять гектаров: дорожки для прогулок и бега, качели, амфитеатр, столы для тенниса. Спокойная прогулка вдали от центра.","chk":"2026-11","added":"2026-11-16","city":"spb"},
    "spb-museum-route-66": {"name":"Museum Route 66","kind":"Музей","emoji":"🏛️","addr":"Конюшенная пл., 2Ж","metro":"Невский проспект","lat":59.94089,"lon":30.326526,"price":1,"okr":"center","cat":"culture","note":"Американские автомобили 1940–1970-х в декорациях из кино: за руль можно садиться, детали трогать, фотографироваться. Весело и вдвоём, и компанией.","chk":"2026-11","added":"2026-11-16","city":"spb"}
  },
  "scenarios": [
    {"id":"auto-date-kontsert-v-tserkvi-i-bistro","mode":"date","emoji":"🎻","title":"Концерт в церкви и бистро","stops":["anglikanskaya-tserkov-svyatogo-andreya","centrale"],"when":"вечер","tags":["culture"],"why":"Слушаете музыку под неоготическими сводами, а ужинать идёте в бистро через минуту ходьбы. Весь вечер умещается в одном тихом переулке.","added":"2026-11-16"},
    {"id":"auto-girls-pereulki-kontsert-i-deserty","mode":"girls","emoji":"☕","title":"Переулки, концерт и десерты","stops":["tverskaya","anglikanskaya-tserkov-svyatogo-andreya","niqa"],"when":"день","tags":["culture"],"why":"Сворачиваете с Тверской в переулки, попадаете на дневной концерт в церкви и заканчиваете в кондитерской в четырёх минутах пешком.","added":"2026-11-16"},
    {"id":"spb-d-auto-progulka-po-fedorovskomu-skveru","mode":"date","emoji":"🌳","title":"Прогулка по Фёдоровскому скверу","stops":["spb-fedorovskiy-skver"],"when":"день","tags":["active"],"why":"Гуляете по дорожкам, качаетесь на качелях и играете партию в настольный теннис. Простой план без толпы, когда хочется побыть вдвоём на воздухе.","city":"spb","added":"2026-11-16"},
    {"id":"auto-guys-stendap-i-bar-do-utra","mode":"guys","emoji":"🎙","title":"Стендап и бар до утра","stops":["comedy-34","sdvig"],"when":"вечер","tags":[],"why":"После выступления комиков идёте три минуты до бара во дворе, где кухня и коктейли работают до шести утра. Есть где обсудить шутки.","added":"2026-11-16"},
    {"id":"auto-date-teatr-na-sretenke-i-bar-loft","mode":"date","emoji":"🎭","title":"Театр на Сретенке и бар-лофт","stops":["shkola-dramaticheskogo-iskusstva","sdvig"],"when":"вечер","tags":["culture"],"why":"Спектакль, затем пять минут пешком до спрятанного во дворе бара с мягким светом и рамёном. Удобно продолжить разговор о постановке.","added":"2026-11-16"},
    {"id":"auto-girls-knizhnyy-kofe-i-kokteyli","mode":"girls","emoji":"📚","title":"Книжный, кофе и коктейли","stops":["polyandriya-letters","sdvig"],"when":"вечер","tags":[],"why":"Выбираете книги и пьёте кофе в книжном на Садовой, а к открытию бара переходите через площадь за коктейлями и закусками. Около пяти минут пешком.","added":"2026-11-16"},
    {"id":"spb-g-auto-retrokary-avtomaty-i-bar","mode":"guys","emoji":"🚗","title":"Ретрокары, автоматы и бар","stops":["spb-museum-route-66","spb-muzey-sovetskikh","spb-daiquiri"],"when":"вечер","tags":["culture","active"],"why":"Садитесь за руль американской классики, через минуту играете в советские автоматы, а потом идёте две минуты до коктейльного бара. Весь вечер на одной площади.","city":"spb","added":"2026-11-16"},
    {"id":"spb-d-auto-amerika-60-kh-i-kakao","mode":"date","emoji":"📸","title":"Америка 60-х и какао","stops":["spb-museum-route-66","spb-spas-krovi","spb-chao-kakao"],"when":"день","tags":["culture"],"why":"Фотографируетесь в декорациях старого кино, проходите мимо Спаса на Крови и греетесь какао в пяти минутах. Лёгкий план, где есть чем заняться и о чём говорить.","city":"spb","added":"2026-11-16"},
    {"id":"spb-w-auto-retromuzey-i-karaoke","mode":"girls","emoji":"🎤","title":"Ретромузей и караоке","stops":["spb-museum-route-66","spb-spletni-by"],"when":"вечер","tags":["culture"],"why":"Сначала фотосессия среди блестящих кадиллаков, потом караоке-бар буквально через дверь. Не нужно никуда ехать между частями вечера.","city":"spb","added":"2026-11-16"},
    {"id":"spb-d-auto-bashnya-nad-nevskim-i-kokteyli","mode":"date","emoji":"🌇","title":"Башня над Невским и коктейли","stops":["spb-dumskaya-bashnya","spb-naberezhnaya-kanala","spb-oy"],"when":"закат","tags":["view"],"why":"Поднимаетесь на башню к закату, спускаетесь к каналу Грибоедова и минут за десять доходите до коктейльного бара. Сначала виды, потом разговор.","city":"spb","added":"2026-11-16"},
    {"id":"spb-w-auto-kryshi-knigi-i-kofe","mode":"girls","emoji":"📖","title":"Крыши, книги и кофе","stops":["spb-dumskaya-bashnya","spb-dom-knigi","spb-seyf-coffee"],"when":"день","tags":["view"],"why":"Двести ступеней ради панорамы, потом три минуты до Дома книги за открытками и кофе по соседству. Всё в одном квартале у Невского.","city":"spb","added":"2026-11-16"},
    {"id":"spb-g-auto-dumskaya-bashnya-i-pivo","mode":"guys","emoji":"🍺","title":"Думская башня и пиво","stops":["spb-dumskaya-bashnya","spb-kriek-italyanskoy"],"when":"вечер","tags":["view","active"],"why":"Сначала подъём пешком на смотровую, затем пять минут до пивного ресторана на Итальянской. Короткая разминка перед долгим столом.","city":"spb","added":"2026-11-16"}
  ],
  "events": [
    {"id":"ev-spb-dzhaz-i-rok-n-roll-novogodniy-kontsert-kosmonavt-20261226","title":"Джаз и рок-н-ролл. Новогодний концерт","cat":"concert","emoji":"🎵","start":"2026-12-26","end":"2026-12-26","time":"20:00","venue":"Космонавт","addr":"Бронницкая ул., 24","metro":"Технологический институт","lat":59.913985,"lon":30.323815,"price":[1800,1800],"age":"0+","url":"https://accordlab.ru/symphojazz","note":"Предновогодняя версия оркестровой программы с джазом и рок-н-роллом. Хороший повод собраться в конце декабря.","fit":["date","guys","girls"],"city":"spb","added":"2026-11-16"}
  ],
  "closed": [],
  "buzz": {"usadba-marfino":"2026-W47"}
});

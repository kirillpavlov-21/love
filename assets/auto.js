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
  "updated": "2026-11-12",
  "places": {
    "osobnyak-zinaidy-morozovoy": {"name":"Особняк Зинаиды Морозовой","kind":"Особняк","emoji":"🌳","addr":"ул. Спиридоновка, 17","metro":"Баррикадная","lat":55.761254,"lon":37.591227,"price":1,"okr":"center","cat":"walk","note":"Неоготический особняк, похожий на английский замок, с интерьерами по эскизам Врубеля; красивая точка для прогулки по Спиридоновке.","hint":["halloween","autumn"],"chk":"2026-11","added":"2026-11-12"},
    "spb-roots-le-petit-bar": {"name":"Roots le petit bar","kind":"Бар","emoji":"🍸","addr":"ул. Блохина, 3/1","metro":"Спортивная","lat":59.951022,"lon":30.304446,"price":2,"okr":"petrograd","cat":"bar","note":"Небольшой бар с авторскими коктейлями, живой гитарой и танцами под винил ближе к ночи; подойдёт для пары и компании подруг.","chk":"2026-11","added":"2026-11-12","city":"spb"},
    "vvedenskoe-kladbishche": {"name":"Введенское кладбище","kind":"Некрополь","emoji":"🌳","addr":"Наличная ул., 1","metro":"Лефортово","lat":55.770741,"lon":37.705107,"price":1,"okr":"se","cat":"walk","note":"Старинный некрополь с готическими склепами и надгробиями; место для тихой прогулки и разговоров не о работе.","hint":["halloween","autumn"],"chk":"2026-11","added":"2026-11-12"}
  },
  "scenarios": [
    {"id":"auto-date-zamok-na-spiridonovke-i-prud","mode":"date","emoji":"🏰","title":"Замок на Спиридоновке и пруд","stops":["osobnyak-zinaidy-morozovoy","patriki","ilovecake"],"when":"день","tags":["autumn"],"why":"Рассмотреть неоготический особняк, за четыре минуты дойти до Патриарших и сделать круг у воды, а потом вернуться на десерт в кондитерскую рядом.","added":"2026-11-12"},
    {"id":"auto-date-gotika-prud-i-dzhaz","mode":"date","emoji":"🎷","title":"Готика, пруд и джаз","stops":["osobnyak-zinaidy-morozovoy","patriki","the-bix"],"when":"вечер","tags":["halloween"],"why":"В сумерках особняк с башнями выглядит особенно загадочно. Оттуда пять минут до пруда и ещё столько же до джаз-бара, где вечер продолжается под живую музыку.","added":"2026-11-12"},
    {"id":"auto-date-osobnyak-i-dom-chekhova","mode":"date","emoji":"📖","title":"Особняк и дом Чехова","stops":["osobnyak-zinaidy-morozovoy","chekhov-house","mates-patriki"],"when":"день","tags":["culture"],"why":"Два дома с историей в пяти минутах друг от друга: снаружи замок Морозовой, внутри скромный быт писателя. После музея — кофе неподалёку, чтобы обсудить увиденное.","added":"2026-11-12"},
    {"id":"auto-date-sklepy-i-staryy-park-lefortova","mode":"date","emoji":"🍂","title":"Склепы и старый парк Лефортова","stops":["vvedenskoe-kladbishche","lefortovo-park"],"when":"день","tags":["autumn","halloween"],"why":"Сначала тихие аллеи с готическими надгробиями, затем минут пятнадцать пешком до парка с прудами и плотинами. Долгая прогулка, в которой хватает времени на разговор.","added":"2026-11-12"},
    {"id":"spb-d-auto-kamchatka-tsoya-i-bar-s-gitaroy","mode":"date","emoji":"🎸","title":"Камчатка Цоя и бар с гитарой","stops":["spb-kotelnaya-kamchatka","spb-roots-le-petit-bar"],"when":"вечер","tags":["culture"],"why":"Заглянуть в легендарную котельную, а через три минуты пешком сесть в маленьком баре, где тоже играют на гитаре. Музыкальный вечер без переездов и мостов.","city":"spb","added":"2026-11-12"},
    {"id":"spb-w-auto-oberiuty-i-kokteyli-na-blokhina","mode":"girls","emoji":"🍸","title":"Обэриуты и коктейли на Блохина","stops":["spb-muzey-oberiu","spb-roots-le-petit-bar"],"when":"вечер","tags":["culture"],"why":"Небольшой музей поэтов-абсурдистов даёт темы для разговора, а в пяти минутах ходьбы ждут коктейли и танцы под винил. Всё на одной стороне Невы.","city":"spb","added":"2026-11-12"},
    {"id":"spb-d-auto-zvezdy-v-planetarii-i-bar","mode":"date","emoji":"🔭","title":"Звёзды в планетарии и бар","stops":["spb-planetariy","spb-roots-le-petit-bar"],"when":"вечер","tags":["culture"],"why":"Сеанс под куполом планетария, потом восемь минут через парк до камерного бара с живой музыкой. Сначала смотрите на звёзды, потом спокойно разговариваете.","city":"spb","added":"2026-11-12"}
  ],
  "events": [
    {"id":"ev-spb-shou-mylnykh-puzyrey-klink-dom-molodezhi-20261115","title":"Шоу мыльных пузырей «Клинк!»","cat":"kids","emoji":"🧸","start":"2026-11-15","end":"2026-11-15","time":"12:00","venue":"Дом молодёжи","addr":"Новоизмайловский пр., 48","metro":"Московская","lat":59.853474,"lon":30.30653,"url":"https://xn----7sbcb4ct9a0b.xn--p1ai/","note":"Семейное представление с гигантскими мыльными пузырями, лазерами, неоном и театром теней; зрителей вовлекают в действие.","fit":[],"city":"spb","added":"2026-11-12"},
    {"id":"ev-vselennaya-neoklassiki-olympic-orchestra-eldar-20261127","title":"Вселенная неоклассики. Olympic Orchestra","cat":"concert","emoji":"🎵","start":"2026-11-27","end":"2026-12-12","dates":["2026-11-27","2026-12-12"],"time":"19:30","venue":"Эльдар","place":"eldar","addr":"Ленинский просп., 105","metro":"Новаторская","lat":55.66525,"lon":37.513424,"url":"https://stageon.ru/event/cmryh29kc0ai8geuw4fhw7opm","note":"Оркестр исполняет современную неоклассику и знаменитую киномузыку в тёмном зале среди свечей и проекций.","fit":["date","girls"],"added":"2026-11-12"},
    {"id":"ev-vivaldi-vremena-goda-eldar-20261122","title":"Вивальди. Времена года","cat":"concert","emoji":"🎵","start":"2026-11-22","end":"2026-11-22","time":"16:00","venue":"Эльдар","place":"eldar","addr":"Ленинский просп., 105","metro":"Новаторская","lat":55.66525,"lon":37.513424,"url":"https://stageon.ru/event/cmpggayiu01pjn8kyqhst5g2n","note":"Оркестр играет Вивальди и другую классику при свечах, а художник тут же рисует картины на воде, которые выводят на экран.","fit":["date","girls"],"added":"2026-11-12"},
    {"id":"ev-vivaldi-vremena-goda-dk-im-gorbunova-20261128","title":"Вивальди. Времена года","cat":"concert","emoji":"🎵","start":"2026-11-28","end":"2026-11-28","time":"16:00","venue":"ДК им. Горбунова","addr":"Новозаводская ул., 27","metro":"Багратионовская","lat":55.750162,"lon":37.497121,"url":"https://stageon.ru/event/cmryh1rjz061ageuw4l7faq07","note":"Оркестр играет Вивальди и другую классику при свечах, а художник тут же рисует картины на воде, которые выводят на экран.","fit":["date","girls"],"added":"2026-11-12"},
    {"id":"ev-spb-noch-ee-otkroveniy-dvorets-iskusstv-20261204","title":"Ночь её откровений","cat":"theatre","emoji":"🎭","start":"2026-12-04","end":"2026-12-04","time":"19:00","venue":"Дворец искусств Ленинградской области","addr":"пл. Стачек, 4","metro":"Нарвская","lat":59.900459,"lon":30.275936,"age":"16+","url":"https://spb.comedytheatre.ru/performances/noch-eyo-otkroveniy","note":"Авантюрная комедия на двоих: знакомство женатого бизнесмена с девушкой в баре оборачивается историей с неожиданным финалом.","fit":["date","girls"],"city":"spb","added":"2026-11-12"},
    {"id":"ev-slishkom-zhenatyy-taksist-dk-im-zueva-20261114","title":"Слишком женатый таксист","cat":"theatre","emoji":"🎭","start":"2026-11-14","end":"2026-11-14","time":"20:00","venue":"ДК им. Зуева","place":"klub-imeni-zueva","addr":"Лесная ул., 18","metro":"Белорусская","lat":55.778985,"lon":37.590269,"price":[1500,1500],"age":"18+","url":"https://msk.comedytheatre.ru/performances/slishkom-zhenatyy-taksist","note":"Комедия положений про таксиста, который живёт на две семьи и после случайного происшествия вынужден изворачиваться всё отчаяннее.","fit":["date","girls"],"added":"2026-11-12"},
    {"id":"ev-spb-mir-2-ritmy-20261114","title":"МИР-2","cat":"party","emoji":"🪩","start":"2026-11-14","end":"2026-11-14","venue":"Ритмы","place":"spb-ritmy","addr":"Кожевенная линия, 34","metro":"Горный институт","lat":59.923041,"lon":30.24355,"url":"https://mir2.ticketscloud.org/","note":"Ночь техно в связке с медиаискусством: световые инсталляции меняют пространство клуба, за пультом десяток диджеев и живое выступление.","fit":["guys","girls"],"city":"spb","added":"2026-11-12"},
    {"id":"ev-boing-boing-teatrium-na-serpukhovke-20261114","title":"Боинг-Боинг","cat":"theatre","emoji":"🎭","start":"2026-11-14","end":"2026-11-14","time":"20:00","venue":"Театриум на Серпуховке","addr":"Павловская ул., 6","metro":"Серпуховская","lat":55.719672,"lon":37.626812,"age":"16+","url":"https://msk.comedytheatre.ru/performances/boing-boing","note":"Лёгкая комедия положений о архитекторе, который запутался в расписании трёх невест-стюардесс; хороший повод посмеяться вдвоём.","fit":["date","girls"],"added":"2026-11-12"}
  ],
  "closed": [],
  "buzz": {"if-bar":"2026-W46","kuzminki":"2026-W46","spb-ekaterininskiy-park":"2026-W46","spb-elagin-ostrov":"2026-W46","spb-korpus-benua":"2026-W46","spb-nizhniy-park":"2026-W46","spb-oranienbaum":"2026-W46","spb-park-aleksandriya":"2026-W46"}
});

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
  "updated": "2026-11-17",
  "places": {
    "grand-kofemaniya": {"name":"Гранд Кофемания","kind":"Ресторан","emoji":"🍽️","addr":"Малый Черкасский пер., 2","metro":"Лубянка","lat":55.758606,"lon":37.626508,"price":3,"okr":"center","cat":"food","note":"Большой ресторан у Лубянки с поздними бранчами по выходным и пёстрой публикой. Удобно осесть после прогулки по центру.","hint":["first"],"chk":"2026-11","added":"2026-11-17"},
    "masa-madre-meshcherskiy": {"name":"Masa Madre Мещерский","kind":"Пекарня","emoji":"🥐","addr":"Воскресенская ул., 3А","metro":"Говорово","lat":55.67405,"lon":37.40629,"price":1,"okr":"west","cat":"food","note":"Просторная пекарня напротив пляжа: открытый цех, булки с корицей, веранда на траве за домом. В выходные на вход бывает очередь.","hint":["first"],"chk":"2026-11","added":"2026-11-17"},
    "seryy-dom": {"name":"Серый дом","kind":"Ресторан","emoji":"🍽️","addr":"бул. Братьев Весниных, 1","metro":"ЗИЛ","lat":55.698141,"lon":37.640094,"price":3,"okr":"south","cat":"food","note":"Новый ресторан в квартале ЗИЛАРТ с отсылками к Шагалу: гигантский кокошник у входа, люстры, старая мебель и зелень. Нарядно для ужина вдвоём.","chk":"2026-11","added":"2026-11-17"},
    "spb-mechta": {"name":"Мечта","kind":"Кофейня","emoji":"☕","addr":"Малый пр. П. С., 71","metro":"Петроградская","lat":59.966743,"lon":30.307299,"price":1,"okr":"petrograd","cat":"coffee","note":"Кофейня на Петроградской с сезонными напитками вроде матчи с тыквой и пряного бамбла с карамелью. Зайти погреться во время прогулки.","hint":["autumn"],"chk":"2026-11","added":"2026-11-17","city":"spb"},
    "spb-oranzhereya-tavricheskogo-sada": {"name":"Оранжерея Таврического сада","kind":"Оранжерея","emoji":"🌳","addr":"Шпалерная ул., 43","metro":"Чернышевская","lat":59.948678,"lon":30.368511,"price":1,"okr":"center","cat":"walk","note":"Тёплый зимний сад с пальмами, кактусами и лианами — тропики посреди холодного сезона. Приятно зайти вдвоём, когда на улице слякоть.","hint":["first","autumn"],"chk":"2026-11","added":"2026-11-17","city":"spb"},
    "spb-sunduk": {"name":"Сундук","kind":"Арт-кафе","emoji":"🍽️","addr":"Фурштатская ул., 42","metro":"Чернышевская","lat":59.945485,"lon":30.36142,"price":2,"okr":"center","cat":"food","note":"Кафе, интерьер которого тридцать лет собирали из картин, витражей, самоваров и винила; вечерами играют джаз и блюз. Есть что разглядывать вдвоём.","hint":["first"],"chk":"2026-11","added":"2026-11-17","city":"spb"}
  },
  "scenarios": [
    {"id":"auto-date-les-i-bulki-s-koritsey","mode":"date","emoji":"🥐","title":"Лес и булки с корицей","stops":["meshchersky","masa-madre-meshcherskiy"],"when":"день","tags":["autumn"],"why":"Гуляете по лесным тропам, а потом за пять минут выходите к пекарне у пляжа за кофе и выпечкой. Свежий воздух и тёплая булка — простой и надёжный расклад.","added":"2026-11-17"},
    {"id":"auto-girls-utro-v-meshcherskom","mode":"girls","emoji":"🌲","title":"Утро в Мещерском","stops":["meshchersky","masa-madre-meshcherskiy"],"when":"утро","tags":["autumn"],"why":"Приезжаете пораньше, пока нет очереди, делаете круг по парку и садитесь завтракать на веранде пекарни. От леса до входа меньше трёхсот метров.","added":"2026-11-17"},
    {"id":"spb-d-auto-bashni-karpovka-i-matcha","mode":"date","emoji":"🏰","title":"Башни, Карповка и матча","stops":["spb-dom-s-bashnyami","spb-naberezhnaya-reki","spb-mechta"],"when":"день","tags":["autumn"],"why":"От дома-замка на площади спускаетесь к Карповке и идёте вдоль воды, а греться заходите в кофейню — она в пяти минутах от набережной.","city":"spb","added":"2026-11-17"},
    {"id":"spb-w-auto-avangard-i-sezonnyy-kofe","mode":"girls","emoji":"🎨","title":"Авангард и сезонный кофе","stops":["spb-muzey-peterburgskogo-avangarda-dom","spb-mechta"],"when":"день","tags":["culture"],"why":"Сначала маленький деревянный дом-музей, потом семь минут пешком до кофейни с осенними напитками. Камерно и без спешки.","city":"spb","added":"2026-11-17"},
    {"id":"spb-d-auto-tropiki-sad-i-kafe-s-istoriey","mode":"date","emoji":"🌴","title":"Тропики, сад и кафе с историей","stops":["spb-oranzhereya-tavricheskogo-sada","spb-tavricheskiy-sad","spb-sunduk"],"when":"день","tags":["autumn"],"why":"Греетесь среди пальм, проходите через сад и минут через шесть садитесь обедать в кафе, увешанном редкостями. Тепло, прогулка и еда по очереди.","city":"spb","added":"2026-11-17"},
    {"id":"spb-w-auto-oranzhereya-i-kofe","mode":"girls","emoji":"🪴","title":"Оранжерея и кофе","stops":["spb-oranzhereya-tavricheskogo-sada","spb-am-saint"],"when":"день","tags":[],"why":"Фотографируетесь среди лиан и кактусов, а потом семь минут идёте до кофейни. Короткий план, когда хочется зелени посреди серого сезона.","city":"spb","added":"2026-11-17"},
    {"id":"auto-date-roshcha-i-uzhin-s-shagalom","mode":"date","emoji":"🌿","title":"Роща и ужин с Шагалом","stops":["tyufeleva-roshcha","seryy-dom"],"when":"вечер","tags":[],"why":"Проходите по парку с длинной перголой и за пару минут оказываетесь у ресторана. Современный парк и нарядный зал хорошо оттеняют друг друга.","added":"2026-11-17"},
    {"id":"auto-girls-temnota-i-lyustry","mode":"girls","emoji":"🕯️","title":"Темнота и люстры","stops":["muzey-temnoty","seryy-dom"],"when":"вечер","tags":["culture"],"why":"Час на ощупь в музее без света, потом десять минут пешком — и вы в зале, где хочется рассматривать каждую деталь. Контраст работает.","added":"2026-11-17"},
    {"id":"auto-date-krysha-tsdm-i-uzhin-u-lubyanki","mode":"date","emoji":"🌇","title":"Крыша ЦДМ и ужин у Лубянки","stops":["tsdm-view","grand-kofemaniya"],"when":"закат","tags":["view"],"why":"Встречаете закат на смотровой над центром, спускаетесь и через три минуты садитесь ужинать. Вид даёт тему для разговора, ресторан — время на него.","added":"2026-11-17"},
    {"id":"auto-girls-malyy-teatr-i-pozdniy-stol","mode":"girls","emoji":"🎭","title":"Малый театр и поздний стол","stops":["malyy-teatr","grand-kofemaniya"],"when":"вечер","tags":["culture"],"why":"После спектакля пять минут пешком до ресторана, который открыт до полуночи: можно спокойно обсудить постановку за десертом.","added":"2026-11-17"},
    {"id":"spb-d-auto-tavricheskiy-sad-i-dzhaz","mode":"date","emoji":"🎷","title":"Таврический сад и джаз","stops":["spb-tavricheskiy-sad","spb-sunduk"],"when":"вечер","tags":["autumn"],"why":"Круг по саду в сумерках, а дальше шесть минут до кафе, где вечером играют живую музыку. После прогулки приятно разглядывать интерьер и отогреваться.","city":"spb","added":"2026-11-17"},
    {"id":"spb-w-auto-kirkha-i-kafe-kunstkamera","mode":"girls","emoji":"🖼️","title":"Кирха и кафе-кунсткамера","stops":["spb-annenkirkhe","spb-sunduk"],"when":"день","tags":["culture"],"why":"Смотрите выставку в старой кирхе и за семь минут доходите до кафе, где каждая стена — отдельная коллекция. Два необычных интерьера подряд.","city":"spb","added":"2026-11-17"},
    {"id":"spb-g-auto-stendap-i-uzhin-pod-blyuz","mode":"guys","emoji":"🎤","title":"Стендап и ужин под блюз","stops":["spb-stage-standup","spb-sunduk"],"when":"вечер","tags":[],"why":"Сначала час шуток в клубе, потом минут десять пешком до кафе с живой музыкой и плотной кухней. Есть что обсудить за столом.","city":"spb","added":"2026-11-17"}
  ],
  "events": [
    {"id":"ev-valeriy-syutkin-ya-to-chto-nado-fts-moskva-20261206","title":"Валерий Сюткин. Я то, что надо!","cat":"concert","emoji":"🎵","start":"2026-12-06","end":"2026-12-06","time":"19:00","venue":"ФЦ Москва","addr":"ул. Барклая, 9","metro":"Багратионовская","lat":55.741346,"lon":37.499557,"url":"https://stageon.ru/event/cmvxpxthqjir31475pgpiv466","note":"Валерий Сюткин с музыкантами играет свои шлягеры и песни из старого советского кино. Тёплый ретро-вечер, можно позвать родителей.","fit":["date","girls"],"added":"2026-11-17"},
    {"id":"ev-spb-tretya-priroda-lakhta-tsentr-20261101","title":"Третья природа","cat":"exhibition","emoji":"🖼️","start":"2026-11-01","end":"2027-04-30","time":"10:00","venue":"Лахта Центр","place":"spb-lakhta-obzornaya","addr":"Высотная ул., 1","metro":"Беговая","lat":59.98706,"lon":30.177911,"price":[0,0],"url":"https://1703af.ru/projects/vystavka-tretya-priroda/","note":"Восемь световых и звуковых скульптур, которые отзываются на касание и ветер и превращают научные данные в музыку. Вход без билета.","fit":["date","girls","guys"],"city":"spb","added":"2026-11-17"},
    {"id":"ev-zhena-ne-uznaet-teatr-na-melnikova-20261223","title":"Жена не узнает","cat":"show","emoji":"✨","start":"2026-12-23","end":"2026-12-23","time":"19:00","venue":"Театр на Мельникова","place":"teatr-na-melnikova","addr":"ул. Мельникова, 7, стр. 1","metro":"Дубровка","lat":55.725548,"lon":37.673468,"price":[1000,1000],"age":"16+","url":"https://iframeab-pre8259.intickets.ru/event/73179044/","note":"Комедийное танцевальное шоу под струями воды: кастинг, переодевания и трюковая хореография. Весёлый вариант для компании подруг.","fit":["girls","date"],"added":"2026-11-17"},
    {"id":"ev-vest-2-0-evreyskiy-muzey-20261104","title":"Весть 2.0","cat":"exhibition","emoji":"🖼️","start":"2026-11-04","end":"2027-02-23","venue":"Еврейский музей","place":"jewish-museum","addr":"ул. Образцова, 11, стр. 1А","metro":"Марьина Роща","lat":55.789696,"lon":37.609555,"url":"https://www.jewish-museum.ru/exhibitions/vest-2-0/","note":"Выставка о том, как люди передавали новости — от каменных табличек до цифры; среди авторов Шагал и Родченко. Прямо из зала можно отправить открытку.","fit":["date","girls"],"added":"2026-11-17"},
    {"id":"ev-spb-dzhazovyy-bunt-madam-bum-20261122","title":"Джазовый Бунт","cat":"show","emoji":"✨","start":"2026-11-22","end":"2026-11-29","dates":["2026-11-22","2026-11-29"],"time":"20:00","venue":"Мадам Бум","addr":"наб. реки Карповки, 5, корп. 17","metro":"Петроградская","lat":59.969337,"lon":30.31539,"age":"18+","url":"https://madamboompetro.ticketscloud.org/e/6adb30b5c179f14c242d1442","note":"Бурлеск с джазовым ансамблем на сцене, в духе двадцатых: костюмы, конферанс, вечерний дресс-код. Сбор гостей за час до начала.","fit":["date","girls"],"city":"spb","added":"2026-11-17"}
  ],
  "closed": [],
  "buzz": {"museum-moscow":"2026-W47"}
});

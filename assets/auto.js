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
  "updated": "2026-11-13",
  "places": {
    "finch-2": {"name":"Finch","kind":"Кафе","emoji":"🍽️","addr":"Большой Афанасьевский пер., 14","metro":"Кропоткинская","lat":55.747046,"lon":37.597586,"price":2,"okr":"center","cat":"food","note":"Кафе при «Доме предпринимателей» у Кропоткинской: завтраки в любое время, сырники, каши, сэндвичи и витрина с выпечкой и печеньем.","hint":["first"],"chk":"2026-11","added":"2026-11-13"},
    "masa-madre-2": {"name":"Masa Madre","kind":"Пекарня","emoji":"🥐","addr":"Воскресенская ул., 3А","metro":"Говорово","lat":55.67405,"lon":37.40629,"price":1,"okr":"west","cat":"food","note":"Новая точка известной пекарни в Мещерском парке — за хлебом и выпечкой до или после прогулки.","chk":"2026-11","added":"2026-11-13"},
    "odeon": {"name":"Одеон","kind":"Гастротеатр","emoji":"🎭","addr":"3-я ул. Ямского Поля, 15","metro":"Белорусская","lat":55.782411,"lon":37.578705,"price":3,"okr":"north","cat":"culture","note":"Гастротеатр, где мюзикл разыгрывают прямо между столиками, а ужин из нескольких блюд входит в билет. Готовый сценарий для нарядного вечера.","chk":"2026-11","added":"2026-11-13"},
    "spb-dom-aviatorov": {"name":"Дом авиаторов","kind":"Музей","emoji":"🏛️","addr":"Всеволожск, Колтушское ш., 40","metro":"","lat":60.033295,"lon":30.636032,"price":1,"okr":"out","cat":"culture","note":"Музей о лётчиках, защищавших Ленинград, в здании XVIII века: кабина самолёта, макеты техники и мультимедийные реконструкции воздушных боёв.","chk":"2026-11","added":"2026-11-13","city":"spb"},
    "spb-mandragora": {"name":"Мандрагора","kind":"Кафе","emoji":"☕","addr":"ул. Правды, 4","metro":"Владимирская","lat":59.924256,"lon":30.344381,"price":2,"okr":"center","cat":"coffee","note":"Кафе с мистическим антуражем: к кофе или коктейлю можно заказать расклад таро, гадание по руке или на кофейной гуще. Готовая тема для разговора.","hint":["halloween"],"chk":"2026-11","added":"2026-11-13","city":"spb"}
  },
  "scenarios": [
    {"id":"spb-d-auto-zelenye-dvory-i-gadanie-za-kofe","mode":"date","emoji":"🔮","title":"Зелёные дворы и гадание за кофе","stops":["spb-izumrudnyy-gorod","spb-mandragora"],"when":"вечер","tags":["halloween"],"why":"Сказочные дворы на улице Правды буквально за стеной от кафе: сначала ищете героев во дворах, потом садитесь за кофе и расклад таро на двоих.","city":"spb","added":"2026-11-13"},
    {"id":"spb-w-auto-dovlatov-a-potom-taro","mode":"girls","emoji":"🃏","title":"Довлатов, а потом таро","stops":["spb-muzey-dovlatova","spb-mandragora"],"when":"день","tags":["culture","halloween"],"why":"Камерный музей в коммуналке писателя и пять минут пешком до кафе, где к коктейлю гадают по руке и на кофейной гуще — будет что сравнить.","city":"spb","added":"2026-11-13"},
    {"id":"spb-g-auto-vylazka-k-letchikam-vo-vsevolozhsk","mode":"guys","emoji":"✈️","title":"Вылазка к лётчикам во Всеволожск","stops":["spb-dom-aviatorov"],"when":"день","tags":["culture"],"why":"Короткая поездка за город ради музея военной авиации: посидеть в кабине самолёта и посмотреть реконструкции воздушных боёв. Музей работает только днём — выезжайте пораньше.","city":"spb","added":"2026-11-13"},
    {"id":"auto-date-skulptury-burganova-i-pozdniy-zavtrak","mode":"date","emoji":"🗿","title":"Скульптуры Бурганова и поздний завтрак","stops":["dom-burganova","finch-2"],"when":"день","tags":["culture"],"why":"Сначала дворик и залы музея скульптуры, потом минута пешком по тому же переулку до кафе — сырники и сэндвичи, пока обсуждаете увиденное.","added":"2026-11-13"},
    {"id":"auto-girls-gogolevskiy-bulvar-i-branch","mode":"girls","emoji":"🍂","title":"Гоголевский бульвар и бранч","stops":["gogolevsky","finch-2"],"when":"утро","tags":["autumn"],"why":"Круг по бульвару под жёлтыми кронами и пара минут до Большого Афанасьевского, где завтраки подают весь день и есть витрина с выпечкой.","added":"2026-11-13"},
    {"id":"auto-date-impressionisty-i-uzhin-myuzikl","mode":"date","emoji":"🎭","title":"Импрессионисты и ужин-мюзикл","stops":["impressionism","odeon"],"when":"вечер","tags":["culture"],"why":"Час в музее на «Большевике», затем семь минут пешком до гастротеатра: ужин уже в билете, а спектакль идёт прямо у вашего столика.","added":"2026-11-13"},
    {"id":"auto-girls-naryadnyy-vecher-u-belorusskoy","mode":"girls","emoji":"🥂","title":"Нарядный вечер у Белорусской","stops":["impressionism","odeon"],"when":"вечер","tags":["culture"],"why":"Выставка как разминка и повод для фото, потом короткая прогулка до гастротеатра, где мюзикл и сет из нескольких блюд закрывают весь вечер разом.","added":"2026-11-13"},
    {"id":"auto-date-les-i-svezhiy-khleb","mode":"date","emoji":"🌲","title":"Лес и свежий хлеб","stops":["meshchersky","masa-madre-2"],"when":"день","tags":["autumn","active"],"why":"Пара часов по тропам Мещерского лесопарка, а в трёх минутах от него — пекарня: горячая выпечка и кофе после прогулки на воздухе особенно кстати.","added":"2026-11-13"},
    {"id":"auto-girls-utro-v-meshcherskom-parke","mode":"girls","emoji":"🥐","title":"Утро в Мещерском парке","stops":["meshchersky","masa-madre-2"],"when":"утро","tags":["autumn"],"why":"Ранняя прогулка по лесу без толпы и завтрак выпечкой в пекарне у выхода — спокойный план, чтобы наговориться и забрать хлеб домой.","added":"2026-11-13"}
  ],
  "events": [
    {"id":"ev-bukhgalter-moy-bukhgalter-teatr-na-melnikova-20261121","title":"Бухгалтер, мой бухгалтер","cat":"theatre","emoji":"🎭","start":"2026-11-21","end":"2026-11-21","time":"19:30","venue":"Театр на Мельникова","place":"teatr-na-melnikova","addr":"ул. Мельникова, 7, стр. 1","metro":"Дубровка","lat":55.725548,"lon":37.673468,"price":[700,700],"age":"12+","url":"https://iframeab-pre8259.intickets.ru/event/75891605/","note":"Комедийный мюзикл о девяностых: скромный бухгалтер, строгая начальница и роман, которого нет в должностной инструкции.","fit":["date","girls"],"added":"2026-11-13"},
    {"id":"ev-spb-zhenshchiny-kruga-oberiu-doch-docheri-muzey-oberiu-20261029","title":"Женщины круга ОБЭРИУ. «Дочь дочери дочерей дочери»","cat":"exhibition","emoji":"🖼️","start":"2026-10-29","end":"2027-01-12","venue":"Музей ОБЭРИУ","place":"spb-muzey-oberiu","addr":"Съезжинская ул., 37","metro":"Горьковская","lat":59.953903,"lon":30.306148,"price":[950,950],"url":"https://oberiumuseum.ru/calendar/","note":"Выставка о художницах и хранительницах наследия обэриутов — Алисе Порет, Вере Ермолаевой, Татьяне Глебовой: живопись, графика, письма и архив.","fit":["date","girls"],"city":"spb","added":"2026-11-13"},
    {"id":"ev-spb-cavadisco-cabaret-otel-akyan-20261113","title":"ÇAVADISCO CABARET","cat":"party","emoji":"🪩","start":"2026-11-13","end":"2026-11-13","time":"21:00","venue":"Отель AKYAN","addr":"ул. Восстания, 19","metro":"Площадь Восстания","lat":59.935372,"lon":30.36071,"price":[4500,4500],"url":"https://radario.ru/customer/event/2876945/info/","note":"Отель на одну ночь становится кабаре в духе Прекрасной эпохи: три этажа, несколько сцен и больше двадцати артистов.","fit":["date","girls"],"city":"spb","added":"2026-11-13"},
    {"id":"ev-spb-tretya-priroda-lakhta-tsentr-20261029","title":"Третья природа","cat":"exhibition","emoji":"🖼️","start":"2026-10-24","end":"2027-04-30","venue":"Лахта Центр","place":"spb-lakhta-obzornaya","addr":"Высотная ул., 1","metro":"Беговая","lat":59.98706,"lon":30.177911,"price":[0,0],"age":"6+","reg":true,"url":"https://1703af.ru/projects/vystavka-tretya-priroda/","note":"Восемь интерактивных арт-объектов из света и звука откликаются на касания и движение воздуха; один превращает городскую погоду в музыку.","fit":["date","girls"],"city":"spb","added":"2026-11-13"},
    {"id":"ev-novyy-god-2027-ritm-blyuz-kafe-20261231","title":"Новый год 2027","cat":"party","emoji":"🪩","start":"2026-12-31","end":"2026-12-31","time":"23:30","venue":"Ритм Блюз Кафе","addr":"Староваганьковский пер., 19, стр. 2","metro":"Боровицкая","lat":55.751295,"lon":37.607229,"url":"https://rhythm-blues-cafe.edinoepole.ru/widget/events/7577/event_seats","note":"Новогодняя ночь в клубе рядом с Кремлём: праздничное меню в цене билета, живые каверы The Beatles, «Браво» и «Секрета», бой курантов.","fit":["date","guys","girls"],"added":"2026-11-13"},
    {"id":"ev-vse-o-muzhchinakh-dk-im-zueva-20261218","title":"Всё о мужчинах","cat":"theatre","emoji":"🎭","start":"2026-12-18","end":"2026-12-18","time":"19:00","venue":"ДК им. Зуева","place":"klub-imeni-zueva","addr":"Лесная ул., 18","metro":"Белорусская","lat":55.778985,"lon":37.590269,"age":"18+","url":"https://msk.comedytheatre.ru/performances/vsyo-o-muzhchinakh","note":"Комедия на троих актёров о том, чем живут и чего боятся современные мужчины. Вечер для взрослой компании или пары.","fit":["date","girls"],"added":"2026-11-13"},
    {"id":"ev-mamulki-bend-klub-restoran-petrovich-20261206","title":"Мамульки Bend","cat":"concert","emoji":"🎵","start":"2026-12-06","end":"2027-01-05","dates":["2026-12-06","2027-01-05"],"time":"19:00","venue":"Клуб-ресторан Петрович","addr":"Мясницкая ул., 24/7, стр. 3","metro":"Чистые пруды","lat":55.762511,"lon":37.636448,"url":"https://iframeab-pre4799.intickets.ru/seance/76255185/","note":"Праздничные концерты группы, которая мешает ска, диско, панк и джаз с фольклором и каверами восьмидесятых — для шумной компании.","fit":["guys","girls"],"added":"2026-11-13"},
    {"id":"ev-priroda-fotografii-novaya-tretyakovka-20261104","title":"Природа фотографии","cat":"exhibition","emoji":"🖼️","start":"2026-11-04","end":"2027-03-28","venue":"Новая Третьяковка","place":"newtretyakov","addr":"ул. Крымский Вал, 10","metro":"Октябрьская","lat":55.735062,"lon":37.606619,"url":"https://www.tretyakovgallery.ru/exhibitions/o/priroda-fotografii/","note":"Около 130 снимков трёх десятков авторов от конца XIX века до сегодня: как фотография ушла от подражания живописи к собственному языку.","fit":["date","girls"],"added":"2026-11-13"}
  ],
  "closed": [],
  "buzz": {"kuzminki":"2026-W46","spb-ekaterininskiy-park":"2026-W46","spb-elagin-ostrov":"2026-W46","spb-nizhniy-park":"2026-W46","spb-oranienbaum":"2026-W46","spb-park-aleksandriya":"2026-W46","vdnh":"2026-W46"}
});

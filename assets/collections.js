/* Подборки «Куда идём?»: темы на главной (полка «Подборки» над планами), шторка start.html?col=<id>
   и «Позвать по подборке» в конструкторе (create.html?col=<id>&mode=…). Здесь только данные: проверку пунктов
   и авто-подборки («Бесплатно на этих выходных», «Новое за месяц»…) делает assets/cols.js, страницы подборок — scripts/build-seo.mjs.
   Поля подборки:
   ─ id — 'c-…' (Москва) или 'spb-c-…' (Петербург): город — по префиксу id, а если задано — по полю city ('msk' | 'spb');
   ─ title — до 40 знаков, emoji, lead — вступление своими словами, до 300 знаков;
   ─ items — id мест, готовых планов и событий каталога (лучше 6–15), все из города подборки;
   ─ kind — 'editorial' или 'trip' (у trip пункты ещё и по разделам: sections: [{ t: 'Суббота', items: [...] }]);
   ─ mode — для каких поводов ('date' | 'guys' | 'girls'), без поля — для всех;
   ─ season — сезоны ('winter', 'spring', 'summer', 'autumn'), from / until — 'YYYY-MM-DD' (until — последний день включительно);
   ─ filter — фильтр готовых планов, чью сезонную плашку подборка заменяет на полке ('halloween', 'pc');
   ─ occasion — slug повода из scripts/occasions-calendar.mjs: подборка редакции к поводу, авто-подборку к нему не делаем;
   ─ updated — когда правили.
   Место закрылось, событие прошло, пункт из другого города или вне сезона — его не видно. Живых пунктов меньше 4 —
   подборки не видно нигде: ни на главной, ни по ссылке, ни на странице подборки.
   Файл подключается после каталога (places.js, places-spb.js, events*.js, auto.js) и только добавляет подборки с новыми id. */
(function (K, L) {
  if (!K) return;
  const list = K.collections = Array.isArray(K.collections) ? K.collections : [];
  const have = new Set(list.map(c => c && c.id));
  for (const c of L) if (c && c.id && !have.has(c.id)) { list.push(c); have.add(c.id); }
})(window.KUDA, [
  // —— Москва ——
  {
    id: 'c-kompy', kind: 'editorial', emoji: '🎮', title: 'Компы с пацанами', mode: ['guys'], filter: 'pc',
    lead: 'Клубы, где можно засесть всей пачкой: буткемпы на пятерых, приставки и мониторы для шутеров. Почти все работают круглосуточно, а час в общем зале стоит пару сотен рублей — удобно добрать ночь после бара.',
    items: ['winstrike', 'roku', 'avulus-cyber-space', 'tsentr-kibersporta-mayakovskaya', 'tsentr-kibersporta-moskva-siti', 'tsentr-kibersporta-novokuznetskaya',
      'blinkgame', 'colizeum-park-pobedy', 'colizeum-shabolovka', 'colizeum-kievskaya', '1shot-alekseevskaya', 'iziplay', 'obekt-35'],
    updated: '2026-10-16',
  },
  {
    id: 'c-devichnik', kind: 'editorial', emoji: '💅', title: 'Девичник: бранч, спа и караоке', mode: ['girls'],
    lead: 'Готовые планы на компанию подруг: бранч у прудов, женская баня, спа над городом, караоке с живой группой и бар до утра. Отметьте несколько и пустите на голосование — каждая выберет, что ей по душе.',
    items: ['w6-usachev-brunch', 'w-brunch', 'w6-solovi', 'w-spa', 'w6-jump-spa', 'w6-metropol-brunch', 'w6-ges-karaoke', 'w6-mimika-karaoke',
      'w6-patriki-kianu', 'w2-wine-crab', 'w6-city-icity', 'w6-pixel', 'w-vinzavod'],
    updated: '2026-10-16',
  },
  {
    id: 'c-halloween', kind: 'editorial', emoji: '🎃', title: 'Хэллоуин: страшно интересно', from: '2026-10-01', until: '2026-11-01', filter: 'halloween', occasion: 'hellouin',
    lead: 'Бункер холодной войны глубоко под Таганкой, ужин в полной темноте, иммерсивные спектакли и квесты с актёрами, после которых не сразу уснёшь. Кому нужно потише — мистика Булгакова и Гоголя, готический дворец и орган в неоготическом соборе.',
    items: ['bunker42', 'vtemnote', 'osobnyak-dashkov-5', 'mosspektakl', 'inkubo', 'blekvud', 'komponent-kvest', 'hooligan-group', 'chistyy-razum',
      'bulgakov', 'gogol-house', 'petrovsky-palace', 'catholic-cathedral'],
    updated: '2026-10-16',
  },
  {
    id: 'c-bani', kind: 'editorial', emoji: '🧖', title: 'Бани на компанию', mode: ['guys', 'girls'],
    lead: 'От недорогих терм, где парения уже входят в билет, до срубов на дровах на всю компанию. Почти везде можно взять отдельный кабинет или зал на 6–15 человек и не делить парную с чужими.',
    items: ['termy-los', 'termburg', 'dyuzhina', 'izmaylovskie-bani', 'bani-sokolinaya-gora', 'astrakhanskie-bani', 'sanduny', 'vorontsovskie-bani',
      'kalitnikovskie-bani', 'varshavskie-bani', 'zhar-ptitsa', 'aura-spa', 'perovskie-bani', 'taezhnye-bani'],
    updated: '2026-10-16',
  },
  {
    id: 'c-kofejni', kind: 'editorial', emoji: '☕', title: 'Кофейни для долгого разговора', mode: ['date', 'girls'],
    lead: 'Спокойные места, где не торопят освободить столик: спешелти-кофе, своя выпечка, панорамные окна и русская чайная с отдельными комнатами. Подойдёт для первой встречи и для разговора с подругой обо всём.',
    items: ['clara', 'short-talk', 'zatsepi-kislovsky', 'niqa', 'nitka-gogolevsky', 'kiosk-1936', 'masa-madre', 'cafeteria-de-madre',
      'croissant-atelier', 'kofe-2046', 'abc-usacheva', 'odmo', 'pereplet', 'zhavoronok'],
    updated: '2026-10-16',
  },
  {
    id: 'c-kryshi', kind: 'editorial', emoji: '🏙️', title: 'Крыши и виды на Москву',
    lead: 'Бесплатные смотровые, канатная дорога над рекой и рестораны выше облаков. Начни с открытых площадок, а закат встречай за столиком у окна — здесь вид на город и есть главное блюдо.',
    items: ['icity', 'tsdm-view', 'zaryadye', 'vorobyovy-gory', 'cable-car', 'krylatskie-holmy', 'panorama', 'ostankino', 'city-space', 'oblako',
      'za-kryshey', 'sedmoe-nebo', 'ruski', 'whiterabbit'],
    updated: '2026-10-16',
  },
  {
    id: 'c-bary', kind: 'editorial', emoji: '🍸', title: 'Бары, куда хочется вернуться',
    lead: 'Коктейли у Патриарших, джаз за зелёной дверью, бар в сводах старой типографии, настойки у стойки и круглосуточные места на случай, когда вечер затянулся. Выбирай по настроению: поговорить или потанцевать.',
    items: ['noor', 'the-bix', 'kianu', 'mendeleev', 'delicatessen', 'marie-laveau', 'kk-wine', 'if-bar', 'ryumochnaya-mechty', 'gornist', '16-tonn',
      'nauka-i-zhizn', 'moloko', 'keep'],
    updated: '2026-10-16',
  },
  {
    id: 'c-katki', kind: 'editorial', emoji: '⛸️', title: 'Катки Москвы', season: ['winter'],
    lead: 'Большие катки в парках с музыкой и подсветкой, лёд у стен ГУМа и крытые арены, где катаются в любую погоду, а по субботам — до утра. Коньки почти везде дают напрокат, так что можно звать без подготовки.',
    items: ['gum-katok', 'katok-park-gorkogo', 'katok-vdnkh', 'katok-luzhniki', 'katok-sokolniki', 'katok-bolotnaya', 'katok-kolomenskoe', 'katok-taganskiy-park',
      'katok-serebryanyy-led', 'katok-rechnoy-vokzal', 'mega-ice', 'arena-play', 'katok-grad'],
    updated: '2026-10-16',
  },

  // —— Петербург ——
  {
    id: 'spb-c-bani', kind: 'editorial', emoji: '🧖', title: 'Бани на компанию', mode: ['guys','girls'],
    lead: 'От старых районных бань с дровяным паром до мраморных залов XIX века и отдельных срубов у залива. Почти везде можно взять люкс или целый комплекс на компанию и не делить парную с чужими.',
    items: ['spb-yamskie-bani', 'spb-mytninskie-bani', 'spb-kazachi-bani', 'spb-banya-vodoley', 'spb-usachevskie-bani', 'spb-fonarnye-bani', 'spb-degtyarnye-bani', 'spb-siberia', 'spb-brooms', 'spb-vasileostrovskie-bani', 'spb-kruglye-bani', 'spb-bani-yaroslavskom', 'spb-primorskie-bani', 'spb-lakhtinskie-bani', 'spb-otium'],
    updated: '2026-10-19',
  },
  {
    id: 'spb-c-uzhin', kind: 'editorial', emoji: '🍜', title: 'Ужин до 3 000 ₽ на двоих', mode: ['date','girls'],
    lead: 'Рамен, хинкали, итальянское бистро и кафе-квартира с пледами — места, где вдвоём можно поужинать и не думать о счёте. А панорамный ресторан над Восстанием — ещё и с видом.',
    items: ['spb-yarumen', 'spb-mama-tata', 'spb-chang', 'spb-teplo', 'spb-oggi-bistro', 'spb-pkhalikhinkali', 'spb-moskva', 'spb-eat-market', 'spb-vasileostrovskiy-rynok', 'spb-buterbrodnaya', 'spb-nil-deli', 'spb-khroniki'],
    updated: '2026-10-19',
  },
  {
    id: 'spb-c-muzei', kind: 'editorial', emoji: '🏛️', title: 'Музеи, куда хочется вернуться',
    lead: 'Большие и маленькие: Эрмитаж и Русский музей, импрессионисты в Главном штабе, пасхальные яйца Фаберже, полярники в бывшей церкви и квартиры поэтов. Хватит на весь дождливый сезон.',
    items: ['spb-ermitazh-zimniy', 'spb-glavnyy-shtab', 'spb-russkiy-muzey', 'spb-korpus-benua', 'spb-erarta', 'spb-muzey-faberzhe', 'spb-kunstkamera', 'spb-yusupovskiy-dvorets', 'spb-muzey-shtiglitsa', 'spb-rosfoto', 'spb-muzey-arktiki', 'spb-muzey-anny', 'spb-muzey-brodskogo', 'spb-muzey-oberiu'],
    updated: '2026-10-19',
  },
  {
    id: 'spb-c-knizhnye', kind: 'editorial', emoji: '📚', title: 'Книжные с атмосферой', mode: ['date','girls'],
    lead: 'Книжные, где можно провести полдня: столетние «Подписные издания», мансарда «Все свободны», бар с поэзией и Дом Зингера с видом на Казанский. В большинстве есть кофе и встречи с авторами.',
    items: ['spb-podpisnye-izdaniya', 'spb-poryadok-slov', 'spb-vse-svobodny', 'spb-dom-knigi', 'spb-vo-ves', 'spb-knizhnaya-lavka', 'spb-knizhnyy-garazh', 'spb-konets-prekrasnoy'],
    updated: '2026-10-19',
  },
  {
    id: 'spb-c-pervoe', kind: 'editorial', emoji: '💘', title: 'Первое свидание в центре', mode: ['date'],
    lead: 'Планы, где не нужно сидеть напротив друг друга весь вечер: выставка или прогулка, а потом уютный ужин в нескольких минутах пешком. Разговор завяжется сам.',
    items: ['spb-d-impressionisty', 'spb-d-nekrasova', 'spb-d-tavricheskiy', 'spb-d-stendap', 'spb-d-komediya', 'spb-d-letniy-sad', 'spb-d-kolomna', 'spb-d-tsirk', 'spb-d-novaya-gollandiya', 'spb-d-senatskaya', 'spb-d-pushkin'],
    updated: '2026-10-19',
  },
  {
    id: 'spb-c-petrogradka', kind: 'editorial', emoji: '🌆', title: 'Петроградка вечером',
    lead: 'Планетарий и кино на «Ленфильме», авторские рестораны вокруг Зоопарка, бар с винилом, бельгийская пивная и кофейня с вишнёвым пирогом — вечер, не выходя с Петроградской стороны.',
    items: ['spb-planetariy', 'spb-kinoteatr-lenfilm', 'spb-zaytsy', 'spb-probka', 'spb-baski-monegaski', 'spb-33', 'spb-harvest', 'spb-manneken-pis', 'spb-tchk', 'spb-must', 'spb-solids', 'spb-monterey'],
    updated: '2026-10-19',
  },
  {
    id: 'spb-c-vasilevskiy', kind: 'editorial', emoji: '⚓', title: 'Васильевский и Севкабель',
    lead: 'Стрелка, сфинксы и крыша Куинджи, а дальше — бывшие заводы на берегу залива: выставки, пинг-понг, падел, крафт и закат с кофе в руке. Остров на целый день.',
    items: ['spb-strelka-vasilevskogo', 'spb-universitetskaya-naberezhnaya', 'spb-muzey-kvartira-kuindzhi', 'spb-erarta', 'spb-artmuza', 'spb-sevkabel-port', 'spb-mntn-coffee', 'spb-ontap', 'spb-kulturnyy-kvartal', 'spb-raketka', 'spb-padel-klub', 'spb-babka', 'spb-trubocheriya', 'spb-brasserie-by'],
    updated: '2026-10-19',
  },
  {
    id: 'spb-c-dozhd', kind: 'editorial', emoji: '☔', title: 'Если льёт как из ведра',
    lead: 'Всё под крышей: огромный макет страны, океанариум, советские игровые автоматы, антикафе с настолками, VR и кино в бархатном зале. Зонт можно оставить у входа.',
    items: ['spb-grand-maket', 'spb-okeanarium-planeta', 'spb-muzey-sovetskikh', 'spb-tsiferblat-moyke', 'spb-tishine', 'spb-mir-vr', 'spb-loft-proekt', 'spb-kinoteatr-avrora', 'spb-kiks-marata', 'spb-muzey-zheleznykh', 'spb-planetariy-1', 'spb-teplo'],
    updated: '2026-10-19',
  },
  {
    id: 'spb-c-bary', kind: 'editorial', emoji: '🍸', title: 'Бары от Рубинштейна до Конюшенной', mode: ['guys','girls'],
    lead: 'Мексиканский бар без меню, мартини с устрицами, пиано-бар, джаз в крошечном зале, ирландские пабы и «Ларисочная» на финал. Всё в пешей доступности друг от друга.',
    items: ['spb-el-copitas', 'spb-oy', 'spb-vchera-navsegda', 'spb-hat', 'spb-limb', 'spb-gorkiy', 'spb-daiquiri', 'spb-mollie-irish', 'spb-ring-bells', 'spb-kwakinn', 'spb-commode', 'spb-union', 'spb-larisy', 'spb-g-rubinshteina-night'],
    updated: '2026-10-19',
  },
  {
    id: 'spb-c-mosty', kind: 'editorial', emoji: '🌉', title: 'Ночь у мостов', until: '2026-11-30',
    lead: 'Разводку видно с Дворцовой набережной, Стрелки и стен Петропавловки — а погреться до и после можно в барах, которые работают до утра. Мосты разводят до конца ноября; график — в карточке плана.',
    items: ['spb-d-razvodka', 'spb-dvortsovaya-naberezhnaya', 'spb-strelka-vasilevskogo', 'spb-petropavlovskaya-krepost', 'spb-senatskaya-ploschad', 'spb-voskresenskaya-naberezhnaya', 'spb-daiquiri', 'spb-ring-bells', 'spb-monterey', 'spb-tantsploschadka'],
    updated: '2026-10-19',
  },
  {
    id: 'spb-c-kompy', kind: 'editorial', emoji: '🎮', title: 'Компы с пацанами', mode: ['guys'], filter: 'pc',
    lead: 'Круглосуточные клубы у метро: премиум-залы с топовым железом, буткемпы на команду, приставки и кальян в лаунжах. Самые недорогие — порядка 150 ₽ за час.',
    items: ['spb-colizeum-premium', 'spb-colizeum-premium-petrogradka', 'spb-colizeum-zagorodnyy', 'spb-colizeum-ligov', 'spb-cyberx', 'spb-n7-omega', 'spb-kiberprayd', 'spb-community-heroes', 'spb-kibersporta', 'spb-full-focus', 'spb-divinity-space', 'spb-yotunkheym', 'spb-tron-kiber', 'spb-xarena', 'spb-fobos'],
    updated: '2026-10-19',
  },
  {
    id: 'spb-c-halloween', kind: 'editorial', emoji: '🎃', title: 'Хэллоуин по-петербургски', filter: 'halloween', from: '2026-10-01', until: '2026-11-01', occasion: 'hellouin',
    lead: 'Замок Павла I с мрачной историей, подвал Юсуповского дворца, где убили Распутина, склеп в Шуваловском парке, заспиртованные диковины Кунсткамеры и хорроры с живыми актёрами.',
    items: ['spb-mikhaylovskiy-inzhenernyy', 'spb-yusupovskiy-dvorets', 'spb-shuvalovskiy-park', 'spb-kunstkamera', 'spb-vzaperti-kazanskoy', 'spb-vzaperti-solyanom', 'spb-tishine', 'spb-g-horror-kazanskaya'],
    updated: '2026-10-19',
  },
  {
    id: 'spb-c-prigorody', kind: 'editorial', emoji: '⛲', title: 'Пригороды за день',
    lead: 'Петергоф и Александрия, Царское Село и Павловск с белками, тихий Ораниенбаум, Кронштадт с фортами и закат в Дубках. Всё — на электричке или автобусе, без машины.',
    items: ['spb-nizhniy-park', 'spb-park-aleksandriya', 'spb-ekaterininskiy-park', 'spb-aleksandrovskiy-park-pushkin', 'spb-pavlovskiy-park', 'spb-oranienbaum', 'spb-konstantinovskiy-park', 'spb-kronshtadt-yakornaya', 'spb-ostrov-fortov', 'spb-park-dubki'],
    updated: '2026-10-19',
  },
  {
    id: 'spb-c-vyhodnye', kind: 'trip', emoji: '🧳', title: 'Выходные в Питере без машины',
    lead: 'Маршрут на два с половиной дня для тех, кто приехал впервые или давно не был: вечер у Казанского, суббота в музеях и на Новой Голландии, воскресенье на островах. Всё пешком и на метро.',
    sections: [
      { t: 'Пятница вечером', items: ['spb-dvortsovaya-ploschad', 'spb-naberezhnaya-kanala', 'spb-terrassa', 'spb-vchera-navsegda'] },
      { t: 'Суббота', items: ['spb-ermitazh-zimniy', 'spb-kolonnada-isaakievskogo', 'spb-novaya-gollandiya', 'spb-kuznya-house'] },
      { t: 'Воскресенье', items: ['spb-petropavlovskaya-krepost', 'spb-sytnyy-rynok', 'spb-strelka-vasilevskogo', 'spb-sevkabel-port'] },
    ],
    updated: '2026-10-19',
  },
]);

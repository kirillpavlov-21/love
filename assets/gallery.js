/* Галереи мест: ещё несколько снимков к главному фото (assets/photos.js). Собирает scripts/photos-gallery.mjs.
   Только свободные лицензии (CC0, CC BY, CC BY-SA, FAL, общественное достояние), без лиц людей.
   Формат: id места → [[файл на Commons или заголовок, автор, лицензия, номер, { src: 'Flickr', u: страница } | 0], …].
   Картинка — assets/ph/g/<id>-<номер>.webp (720 px). Если у места нет главного фото, первым становится снимок галереи
   (превью — assets/ph/g/t/<id>-<номер>.webp). Подпись с автором и лицензией — под каждым снимком. */
(function () {
  const G = /*G*/{
    "alexander-garden": [
      ["Moscow_-_2025_-_The_Corner_Arsenal_Tower,_Alexander_Garden.jpg","Юрий Д.К.","CC BY 4.0",1,0],
      ["Александровский_сад_в_Москве._Фото_15.jpg","Alina Vozna","CC BY-SA 4.0",2,0]
    ],
    "aptekar": [
      ["Tulip_cv._34.JPG","Kor!An (Андрей Корзун)","CC BY-SA 3.0",1,0]
    ],
    "arbat": [
      ["Moscow_2026-07-01_46.jpg","Perituss","CC0",1,0]
    ],
    "arkhangelskoe": [
      ["Arkhangelskoe_Estate_Aug2012_buildings_03.jpg","A.Savin","CC BY-SA 3.0",1,0],
      ["Arkhangelskoe_Estate_Aug2012_buildings_08.jpg","A.Savin","CC BY-SA 3.0",2,0]
    ],
    "bolshoi": [
      ["Teatro_Bolshói,_Moscú,_Rusia,_2016-10-03,_DD_42-43_HDR.jpg","Диего Дельсо","CC BY-SA 4.0",1,0],
      ["View_from_below_of_Big_Theatre_-_2025_2.jpg","Юрий Д.К.","CC BY 4.0",2,0]
    ],
    "bulgakov": [
      ["Bulgakov_Museum_09.JPG","Tothkaroj","CC BY-SA 4.0",1,0],
      ["Доходный_дом_И.Д._Пигита_Большая_Садовая_10_Москва_2026_01.jpg","Никонико962","CC BY-SA 4.0",2,0]
    ],
    "bunker42": [
      ["Cold_War_Museum,_Moscow,_tunnel.JPG","Fastboy","CC BY-SA 3.0",1,0],
      ["Cold_War_Museum,_Moscow,_bunker.JPG","Fastboy","CC BY-SA 3.0",2,0]
    ],
    "chistye-prudy": [
      ["Moscow._Clean_Ponds_P5142293_2600.jpg","Alexxx1979","CC BY-SA 4.0",1,0],
      ["Чистопрудный_бульвар_(Chistoprudny_Boulevard),_Москва_07.JPG","SergeyStepykin","CC BY-SA 3.0",2,0],
      ["Чистые_пруды_в_Москве._Фото_53.jpg","Alina Vozna","CC BY-SA 4.0",3,0],
      ["Moscow,_Clean_Ponds,_reflections_of_lights_at_night.jpg","Sergey Norin from Moscow, Russia","CC BY 2.0",4,0]
    ],
    "conservatory": [
      ["Great_Hall_Moscow_Conservatory_2024_07.jpg","Perituss","CC0",1,0],
      ["Здание_Московской_консерватории_(Большая_Никитская,_13).jpg","SergeyStepykin","CC BY-SA 3.0",2,0]
    ],
    "cosmos": [
      ["Memorial_Museum_of_Cosmonautics.jpg","miketnorton","CC BY 2.0",1,0],
      ["7359._Moscow._Memorial_Museum_of_Cosmonautics.jpg","Александровы АГ","CC BY-SA 4.0",2,0],
      ["Luna_16.jpg","Bembmv","CC BY-SA 3.0",3,0]
    ],
    "danilovsky": [
      ["Moscow_Danilovsky_Market_2026-02_084.jpg","Артём Светлов","CC BY 4.0",1,0]
    ],
    "dreamisland": [
      ["Island_of_Dreams1.jpg","mos.ru","CC BY 4.0",1,0],
      ["Island_of_Dreams_park.jpg","mos.ru","CC BY 4.0",2,0]
    ],
    "ekaterininsky": [
      ["2019-07-27-3211-Moscow-Ekaterininsky-Park.jpg","Don-vip","CC BY-SA 4.0",1,0],
      ["Moscow,_Ekaterininsky_Park_(21755240186).jpg","Gennady Grachev from Moscow, Russia","CC BY 2.0",2,0],
      ["Москва,_Екатерининский_парк01.jpg","Екатерина Борисова","CC BY-SA 4.0",3,0]
    ],
    "electrotheatre": [
      ["Moscow_Stanislavsky_Drama_Theatre_Facade_2026-05-20_9236.jpg","Mike1979 Russia","CC BY-SA 3.0",1,0],
      ["Moscow_Stanislavsky_Drama_Theatre_2026-05-20_9227.jpg","Mike1979 Russia","CC BY-SA 3.0",2,0]
    ],
    "ermitazh": [
      ["P5060610_(2).jpg","Airrainbow","CC BY-SA 4.0",1,0]
    ],
    "garage": [
      ["Moscow,_Garage_Museum_building_in_Gorky_Park_(31440535516).jpg","Gennady Grachev from Moscow, Russia","CC BY 2.0",1,0],
      ["Книжный_магазин_в_Музее_\"Гараж\".jpeg","Kjblwk","CC0",2,0]
    ],
    "ges2": [
      ["GES-2_at_night_-_Moscow.jpg","Юрий Д.К.","CC BY 4.0",1,0],
      ["Moscow_GES-2_014_7211.jpg","Ludvig14","CC BY-SA 4.0",2,0],
      ["GES-2_(August_2021)-2.jpg","Dzasohovich","CC BY-SA 4.0",3,0]
    ],
    "gogol-house": [
      ["Gogol_house.jpg","Eden87","CC BY-SA 3.0",1,0],
      ["Dom_Gogolya,_Nikitskiy_blv,_back_view_(winter,_2013)_by_shakko_02.jpg","Shakko","CC BY-SA 4.0",2,0]
    ],
    "gogolevsky": [
      ["Moscow._Gogolevsky_Boulevard._Statue_of_Nikolai_Vasilyevich_Gogol_P4162374_2750.jpg","Alexxx1979","CC BY-SA 4.0",1,0],
      ["Ограда_Гоголевского_б-ра_02.jpg","Книжная пыль","CC BY-SA 4.0",2,0]
    ],
    "gorky-park": [
      ["Moscow_Gorky_Park_main_portal_08-2016_img1.jpg","A.Savin","Free Art License",1,0],
      ["Moscow_-_2025_-_Gorky_park,_warm_autumn_day12.jpg","Юрий Д.К.","CC BY 4.0",2,0],
      ["Vorobyovy_Gory_(28871233613).jpg","Valeri Pizhanski from Odintsovo, Russia","CC BY-SA 2.0",3,0]
    ],
    "illuzion": [
      ["Москва._Кинотеатр_Иллюзион_в_жилом_здании_на_Котельнической_набережной._2010-07-27_19-57-22.jpg","Shesmax","CC BY-SA 4.0",1,0],
      ["Illusion_2021.jpg","Никита Андреев","CC BY-SA 4.0",2,0]
    ],
    "izmailovo-estate": [
      ["Мостовая_башня_(Измайлово).jpg","Riotous.Red","CC BY-SA 4.0",1,0],
      ["Moscow._Izmaylovo_Estate._Barbican_tower_P5140022_2655.jpg","Alexxx1979","CC BY-SA 4.0",2,0]
    ],
    "izmailovsky-kremlin": [
      ["Moscow._Izmailovo_Kremlin_P5140094_2750.jpg","Alexxx1979","CC BY-SA 4.0",1,0],
      ["Izmailovo-moscow-20-07-2014.jpg","OliBac","CC BY 2.0",2,0],
      ["Кремль_в_Измайлове,_Москва_30.08.2026_(12).jpg","SmallSonMarex","CC BY 4.0",3,0]
    ],
    "japanese-garden": [
      ["2020_Japanese_Garden_in_Moscow_-_Autumn_Colors_01.jpg","Andrey Korzun","CC BY-SA 4.0",1,0],
      ["2020_Japanese_Garden_in_Moscow_-_Autumn_Colors_03.jpg","Andrey Korzun","CC BY-SA 4.0",2,0],
      ["Японский_сад_во_время_цветения_саккуры.jpg","Carbonkidka","CC BY-SA 4.0",3,0],
      ["Ботанический_сад_Японский_садик_Москва_2017_фото_10.jpg","Aleksandra057","CC BY-SA 4.0",4,0]
    ],
    "khlebzavod": [
      ["Хлебозавод_№_9.jpg","Leokand","CC0",1,0],
      ["Bakery_9_2015-09_01_3.jpg","Svetlov Artem","CC0",2,0],
      ["Комплекс_зданий_хлебозавода_№_9_(2).jpg","Молчаливый Отто","CC BY-SA 4.0",3,0]
    ],
    "khudozhestvenny": [
      ["Кинотеатр_\"Художественный\",_Москва_02.jpg","SergeyStepykin","CC BY-SA 3.0",1,0],
      ["Khudozhestvenny_cinema_00029.jpg","Anna Anichkova","CC BY-SA 3.0",2,0]
    ],
    "kolomenskoe": [
      ["Moscow._Kolomenskoye._Church_of_the_Ascension_P5183117_2600.jpg","Alexxx1979","CC BY-SA 4.0",1,0],
      ["Palace_of_tsar_Alexey_Mihajlovicha_in_Kolomenskoe-1.jpg","Aleks G","CC BY-SA 3.0",2,0]
    ],
    "krymsky-bridge": [
      ["Крымский_мост_на_закате.jpg","Lyubov94foto","CC BY-SA 4.0",1,0],
      ["Krymsky_Bridge_IMG_8999_01.jpg","Sunny365days","CC BY 4.0",2,0],
      ["Moscow_-_July_2026_-_Ministry_of_Defense_building,_view_from_Bersenevskaya_Embankment.jpg","Юрий Д.К.","CC BY 4.0",3,0]
    ],
    "kuskovo": [
      ["Moscow_Kuskovo_Park_2025-08-30_6654.jpg","Mike1979 Russia","CC BY-SA 3.0",1,0],
      ["Moscow_Kuskovo_Drying_House_2025-08-30_6553.jpg","Mike1979 Russia","CC BY-SA 3.0",2,0],
      ["Большой_Дворцовый_пруд_в_бывш._селе_Кусково,_вид_на_восток_с_северного_угла.jpg","U51N433","CC BY 4.0",3,0]
    ],
    "lublino": [
      ["Колоннада_дворца_усадьбы_Люблино.jpg","Carbonkidka","CC BY-SA 4.0",1,0],
      ["Durasov_Palace_Spring.jpg","Эта фотография сделана Зеленовым Антоном. Пожалуйста, поместите эту надпись в…","CC BY-SA 3.0",2,0]
    ],
    "luzhniki": [
      ["Вид_с_башни_'Око'_ММДЦ_на_Лужники.jpg","Sergey Korovkin 84","CC BY-SA 4.0",1,0],
      ["Аквапарк_Лужники._Москва_11.08.2025.jpg","SmallSonMarex","CC0",2,0]
    ],
    "mamm": [
      ["Moscow,_Ostozhenka_16_exhibition_hall_interior_(18997883949).jpg","Gennady Grachev from Moscow, Russia","CC BY 2.0",1,0]
    ],
    "marfo-mariinskaya": [
      ["Moscow_Ordynka34s2_K47.jpg","Ludvig14","CC BY-SA 4.0",1,0],
      ["Часовня_со_сторожкой,_улица_Большая_Ордынка,_34,_строение_6,_высокое_разрешение.jpg","Cosmopartic","CC BY-SA 4.0",2,0]
    ],
    "metropol": [
      ["2015_Hotel_Metropol_Moscow_01.jpg","Andrey Korzun","CC BY-SA 4.0",1,0],
      ["Здание_гостиницы_«Метрополь»_Москва_2025_03.jpg","Никонико962","CC BY-SA 4.0",2,0],
      ["Metropol,_Moscow.jpg","Ekaterina Kuzmina","CC BY-SA 2.0",3,0]
    ],
    "moscow-city": [
      ["Moscow_International_Business_Centre,_Marc_2008.JPG","Dmitry A. Mottl","CC BY-SA 3.0",1,0],
      ["MIBC_2025_01.jpg","Perituss","CC0",2,0],
      ["Moscow_-_2025_-_View_of_the_Kremlin_from_the_Bolshoi_Moskvoretsky_Bridge.jpg","Юрий Д.К.","CC BY 4.0",3,0]
    ],
    "moskvarium": [
      ["Moskvarium_1.jpg","MBH","CC BY 4.0",1,0],
      ["Москвариум,_Москва_-_Moskvarium,_Moscow.jpg","Pulux11","CC BY-SA 4.0",2,0]
    ],
    "museon": [
      ["Stalinist_architecture,_Muzeon_Park_of_Arts,_Moscow.jpg","MareCap","CC BY-SA 4.0",1,0],
      ["Moscow_-_9-2025_-_View_of_the_Crimean_embankment_in_early_autumn2.jpg","Юрий Д.К.","CC BY 4.0",2,0],
      ["Moscow_2026-08-26_053.jpg","Perituss","CC0",3,0]
    ],
    "neskuchny": [
      ["Ротонда_в_честь_800-летия_Москвы..JPG","Belyaev","CC BY-SA 3.0",1,0],
      ["20180528_Neskuchny_garden_02.jpg","Сергей А. Демидов","CC BY 4.0",2,0],
      ["Neskuchny_January_2010.jpg","Михаил Фомичев","CC BY 4.0",3,0]
    ],
    "newtretyakov": [
      ["Moscow._Bakery_\"Daily_Bread\".jpg","Юрий Д.К.","CC BY 4.0",1,0],
      ["Выставочный_центр_на_Крымской_набережной_Москва_2026_01.jpg","Никонико962","CC BY-SA 4.0",2,0]
    ],
    "north-river-station": [
      ["Moscow._Khimki_Reservoir._North_River_Terminal_P4172426_2750.jpg","Alexxx1979","CC BY-SA 4.0",1,0]
    ],
    "novodevichy-convent": [
      ["Novodevichy_Convent_night_view.jpg","Max_Ryazanov","CC BY-SA 3.0",1,0],
      ["Сетуньская_башня_Новодевичий_монастырь.jpg","Tsyganov Sergey","CC BY-SA 4.0",2,0],
      ["Novodevichy_Transfiguration_Dome_02.JPG","Heuschrecke, Aisano (Added extra sky to the top of the picture)","CC BY-SA 3.0",3,0]
    ],
    "novodevichy-ponds": [
      ["Novodevichy_Convent_Night.jpg","Эта фотография сделана Зеленовым Антоном. Пожалуйста, поместите эту надпись в…","CC BY-SA 3.0",1,0],
      ["Сквер_и_парк_у_Новодевичьего_монастыря.jpg","Владимир Дворцевой","CC BY-SA 4.0",2,0],
      ["Парк_Новодевичьи_пруды_(июль_2016).jpg","Александр Мотин","CC0",3,0]
    ],
    "ostankino": [
      ["Останкинская_Телебашня,_Москва_29.08.2026.jpg","SmallSonMarex","CC BY 4.0",1,0],
      ["Ostankino_Tower_1715.jpg","AlixSaz","CC BY-SA 4.0",2,0],
      ["Останкинская_телебашня,_вид_с_ВДНХ,_Москва_12.08.2026.jpg","SmallSonMarex","CC BY-SA 4.0",3,0]
    ],
    "paleo-museum": [
      ["Палеонтологический_музей_Орлова_(20221008152901).jpg","MikSed","CC BY-SA 4.0",1,0],
      ["Палеонтологический_музей_Орлова_(20221008140953).jpg","MikSed","CC BY-SA 4.0",2,0]
    ],
    "park-850": [
      ["2024-09-03_вид_с_Братеевского_моста_на_восток_(20240903_125933).jpg","Тёп","CC0",1,0],
      ["2024-09-03_набережная_Москвы-реки_в_районе_Марьино_(20240903_132017).jpg","Тёп","CC0",2,0]
    ],
    "pasternak-house": [
      ["Дом-музей_Б.Л.Пастернака.jpg","Liza vetta","CC BY-SA 4.0",1,0],
      ["Domo-muzeo_de_Boris_Pasternak_en_Peredelkino_04.jpg","RG72","CC BY-SA 4.0",2,0]
    ],
    "patriarshy-bridge": [
      ["Moscow_Kremlin_and_Bolshoy_Kamenny_Bridge_late_evening_01.JPG","Andrey Korzun","CC BY-SA 4.0",1,0],
      ["Cathedral_of_Christ_the_Saviour_and_Patriarshy_bridge_at_night_03.jpg","Andrey Korzun","CC BY-SA 4.0",2,0],
      ["Moscow_-_Cathedral_of_Christ_the_Saviour.jpg","Voytek S","CC BY-SA 2.5",3,0]
    ],
    "petrovsky-palace": [
      ["Петровский_путевой_дворец_23.jpg","AKfounder","CC BY-SA 4.0",1,0],
      ["Ансамбль_Петровского_путевого_дворца.jpg","Domovou","CC BY-SA 4.0",2,0],
      ["Petrovsky_Palace,_Moscow,_2024_03.jpg","MBH","CC BY-SA 4.0",3,0]
    ],
    "planetarium": [
      ["Moscow_Planetarium_2003.jpg","Ludvig14","CC BY-SA 4.0",1,0],
      ["Park_of_Sky_at_Moscow_Planetarium.jpg","Okras","CC BY-SA 4.0",2,0]
    ],
    "pushkinmuseum": [
      ["Moscow_2026-07-22_04.jpg","Perituss","CC0",1,0],
      ["Государственный_музей_А.С._Пушкина_5.jpg","Ulaisaeva","CC BY-SA 4.0",2,0],
      ["Moscow._Pushkin_State_Museum_of_Fine_Arts._Replica_of_Monument_of_Saint_Sebaldus_P4121724_2930.jpg","Alexxx1979","CC BY-SA 4.0",3,0]
    ],
    "pyatnitskaya": [
      ["Pyatnitskaya_Street_at_night_02.jpg","Andrey Korzun","CC BY-SA 4.0",1,0]
    ],
    "red-square": [
      ["Moscow_-_2025_-_GIM_at_morning_light.jpg","Юрий Д.К.","CC BY 4.0",1,0],
      ["Sobór_Kazańskiej_Ikony_Matki_Bożej_w_Moskwie.jpg","Marcin Konsek","CC BY-SA 4.0",2,0],
      ["Moscow_-_2025_-_Spasskaya_Tower.jpg","Юрий Д.К.","CC BY 4.0",3,0],
      ["Russia-2007-Moscow-Kremlin_Senate_at_night.jpg","Godot13","CC BY-SA 4.0",4,0]
    ],
    "rostokino-aqueduct": [
      ["Rostokino_Park_and_Aqueduct_08.jpg","MBH","CC BY 4.0",1,0],
      ["Rostokino_Aqueduct_Ростокинский_акведук_3776.jpg","AlixSaz","CC BY-SA 4.0",2,0],
      ["Aqueduct._Moscow._16.05.jpg","Inga Tomane","CC BY-SA 4.0",3,0]
    ],
    "sanduny": [
      ["Сандуновские_бани._Интерьер_01.JPG","Andreykor","CC BY-SA 4.0",1,0],
      ["Sandunovskiye_Baths.jpg","Jaimrsilva","CC BY-SA 4.0",2,0],
      ["Moscow_Neglinnaya14s6_M08.jpg","Ludvig14","CC BY-SA 4.0",3,0]
    ],
    "siren-garden": [
      ["Парк_\"Сиреневый_сад\"_на_Щёлковском_шоссе._Москва,_--2017-05.jpg","Sergey Korovkin 84","CC BY-SA 4.0",1,0],
      ["Сад-сиренгарий_на_Щелковском_шоссе_25.jpg","Ulaisaeva","CC BY-SA 4.0",2,0]
    ],
    "sokol-village": [
      ["Улица_Левитана_24-2.jpg","Svetlov Artem","CC0",1,0],
      ["Moskvich-407_in_Sokol_Settlement.jpg","Andreykor","CC BY 4.0",2,0]
    ],
    "sokolniki": [
      ["Парк_Сокольники_3.jpg","Ulaisaeva","CC BY-SA 4.0",1,0],
      ["Парк_Сокольники_в_Москве._Фото_11.jpg","Alina Vozna","CC BY-SA 4.0",2,0],
      ["Москва,_парк_Сокольники._Стоковое_фото_№_3.jpg","МиХХ","CC BY-SA 4.0",3,0],
      ["Клумба_в_парке_Сокольники.jpg","Ulaisaeva","CC BY-SA 4.0",4,0]
    ],
    "spb-botanicheskiy-sad": [
      ["Greenhouse_28._Victor_Greenhouse.jpg","Afanasovich","CC BY-SA 4.0",1,0],
      ["Большая_субтропическая_оранжерея_2026-09-21.png","Afanasovich","CC BY 4.0",2,0],
      ["852._Ботанический_сад_РАН._Японский_садик.jpg","GAlexandrova","CC BY-SA 4.0",3,0]
    ],
    "spb-elagin-ostrov": [
      ["Елагин_остров,_Петроградский_район,_Санкт-Петербург_2H1A3244WI.jpg","Kora27","CC BY-SA 4.0",1,0],
      ["Saint-Petersburg._Elagina_Island_Park._Nine_ponds_with_channels.jpg","Александр Байдуков","CC BY-SA 4.0",2,0],
      ["Elagin_park_in_winter_(24872014979).jpg","Raita Futo from Tokyo, Japan","CC BY 2.0",3,0]
    ],
    "spb-glavnyy-shtab": [
      ["Арка_Главного_штаба_вид_со_стороны_Невского.jpg","A.Morgunovskaya","CC BY-SA 4.0",1,0],
      ["Арка_Главного_штаба_Дворцовая_площадь_Санкт-Петербург_2026_01.jpg","Никонико962","CC BY-SA 4.0",2,0],
      ["Главный_штаб_и_Министерства_Дворцовая_площадь_6-8-10_Санкт-Петербург_2026_02.jpg","Никонико962","CC BY-SA 4.0",3,0]
    ],
    "spb-lakhta-obzornaya": [
      ["Views_from_Lakhta_Center_observation_deck_16.jpg","MBH","CC BY 4.0",1,0],
      ["Views_from_Lakhta_Center_observation_deck_19.jpg","MBH","CC BY 4.0",2,0]
    ],
    "spb-nizhniy-park": [
      ["Большой_дворец_(Петергоф)5.JPG","Клеткин","CC BY-SA 3.0",1,0]
    ],
    "spb-novaya-gollandiya": [
      ["Новая_Голландия13.jpg","Екатерина Борисова","CC BY-SA 4.0",1,0],
      ["Spb_06-2017_img33_New_Holland.jpg","A.Savin","Free Art License",2,0],
      ["New_Holland_SPB_Commandant_House.jpg","Florstein","CC BY-SA 4.0",3,0]
    ],
    "spb-park-300": [
      ["Das_Lachta_Zentr-_Лахта_Центр_2H1A5968WI.jpg","Kora27","CC BY-SA 4.0",1,0],
      ["Park_of_300_Years_Spb_-_Main_avenue.jpg","A.Savin","CC BY-SA 3.0",2,0]
    ],
    "spb-pavlovskiy-park": [
      ["Павловск,_Павловский_парк,_район_«Новая_Сильвия»._Мавзолей_«Супругу-благодетелю»_5.jpg","Игорь Гордеев","CC BY-SA 4.0",1,0]
    ],
    "spb-sevkabel-port": [
      ["Sevkabel_Port_05.jpg","MBH","CC BY-SA 4.0",1,0]
    ],
    "spb-tavricheskiy-sad": [
      ["Таврический_сад._Вид_на_пруд.jpg","Liabilityme","CC BY-SA 4.0",1,0],
      ["Лужайка_в_Таврическом_парке.jpg","George Shuklin","CC BY-SA 1.0",2,0],
      ["Таврический_сад_(гидросистема12).JPG","LenaLi Diva","CC BY-SA 3.0",3,0]
    ],
    "timiryazevsky-park": [
      ["20230423_Timiryazevsky_park_01.jpg","Сергей А. Демидов","CC BY 4.0",1,0]
    ],
    "tolstoy-estate": [
      ["Москва_Льва_Тольстого_21_дом.jpg","Vitaliy KR","CC BY-SA 4.0",1,0],
      ["Главный_дом_усадьба_льва_толстого_москва_2025.jpg","Matyuschenko","CC BY-SA 4.0",2,0],
      ["Дом-усадьба,_в_которой_жил_Лев_Николаевич_Толстой_Москва_2026_01.jpg","Никонико962","CC BY-SA 4.0",3,0]
    ],
    "trekhgorka": [
      ["Presnya_Trekhgornaya_Factory_Mos06-13.jpg","A.Savin","CC BY-SA 3.0",1,0]
    ],
    "trubetskoy-estate": [
      ["Park-Usadba_Trubeckih-5.jpg","Anirina","CC BY-SA 3.0",1,0],
      ["Усадьба_Трубецких,_ограда2.JPG","Екатерина Борисова","CC BY-SA 4.0",2,0]
    ],
    "twins-garden": [
      ["Блюда_ресторана_Twins_Garden_(коллаж).jpg","Tamara Ivanova-Issayeva","CC BY-SA 4.0",1,0]
    ],
    "usachevsky": [
      ["Усачёвский_рынок_(Хамовники).jpg","Samovarov S.I.","CC BY-SA 4.0",1,0],
      ["Moscow_Usachevsky_market_2024-10_1729187534.webp","Артём Светлов","CC BY 4.0",2,0]
    ],
    "vdnh": [
      ["Москва,_ВДНХ,_2017_год._Фото_19.jpg","Alina Vozna","CC BY-SA 4.0",1,0],
      ["ВВЦ_31.jpg","Надежда Пивоварова","CC BY-SA 3.0",2,0]
    ],
    "victory-park-zel": [
      ["Victory_Park_Zelenograd_2024_01.jpg","Perituss","CC0",1,0],
      ["Парк_40-летия_Победы.jpg","Наталья Конышева","CC BY-SA 4.0",2,0],
      ["Прогулочная_набережная.jpg","Наталья Конышева","CC BY-SA 4.0",3,0]
    ],
    "vinzavod": [
      ["Москва,_4-й_Сыромятнический_переулок,_1,_строение_9.jpg","This is Andy","CC BY-SA 4.0",1,0],
      ["Москва,_4-й_Сыромятнический_переулок,_1,_строение_7.jpg","This is Andy","CC BY-SA 4.0",2,0],
      ["Винзавод_Служебный_флигель_склады_пивоварни_Москва_2019.jpg","Aleksandra057","CC BY-SA 4.0",3,0]
    ],
    "vorobyovy-gory": [
      ["Moscow._View_of_Luzhniki_Olympic_Complex_from_Sparrow_Hills_P4131822_2600.jpg","Alexxx1979","CC BY-SA 4.0",1,0],
      ["Moscow_-_2025_-_Vorobyovskaya_Embankment3.jpg","Юрий Д.К.","CC BY 4.0",2,0]
    ],
    "zaryadye": [
      ["Saint_Basil's_Cathedral,_Moscow_-_from_Zaryadye_Park.jpg","Юрий Д.К.","CC BY 4.0",1,0],
      ["Glass_Crust_in_Zaryadye_park,_Moscow,_Russia.jpg","DmitriyGuryanov","CC BY-SA 4.0",2,0],
      ["Парк_Зарядье_в_Москве._Фото_93.jpg","Alina Vozna","CC BY-SA 4.0",3,0],
      ["Парк_Зарядье._Фото_19.jpg","Alina Vozna","CC BY-SA 4.0",4,0]
    ],
    "zil-center": [
      ["412A5943.jpg","Olya Hamitova","CC BY-SA 4.0",1,0],
      ["412A5963.jpg","Olya Hamitova","CC BY-SA 4.0",2,0]
    ]
  }/*/G*/;
  const places = (window.KUDA || {}).places || {};
  const one = (id, [file, a, l, n, ext]) => {
    const s = 'assets/ph/g/' + id + '-' + n + '.webp';
    return ext ? { s, t: 'assets/ph/g/t/' + id + '-' + n + '.webp', a, l, src: ext.src, u: ext.u }
      : { s, t: 'assets/ph/g/t/' + id + '-' + n + '.webp', a, l, file, u: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file) };
  };
  Object.keys(G).forEach(id => {
    const p = places[id];
    if (!p || !G[id].length) return;
    const g = G[id].map(r => one(id, r));
    if (!p.ph) { p.ph = g[0]; p.gal = g.slice(1); } else p.gal = g;
  });
})();

/* Очистка текста отзывов и маскировка мата */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, cleanLine, isProfane, maskProfanity } from '../lib/text.mjs';

describe('очистка текста', () => {
  it('теги, управляющие и невидимые символы', () => {
    const r = cleanText('<script>alert(1)</script><b>При\u200Bвет</b>\u202E\u0000\u0007 <!-- x --> мир\uFEFF');
    assert.equal(r.text, 'alert(1) Привет мир');
    assert.equal(cleanText('<3 люблю это место').text, '<3 люблю это место');
    assert.equal(cleanText('цена < 1000 > 500').text, 'цена < 1000 > 500');
  });

  it('эмодзи с ZWJ и вариантами остаются, одиночный ZWJ и зальго — нет', () => {
    assert.equal(cleanText('Кодим 👩\u200D💻 тут ❤\uFE0F').text, 'Кодим 👩\u200D💻 тут ❤\uFE0F');
    assert.equal(cleanText('а\u200Dб').text, 'аб');
    assert.equal(cleanText('з\u0301\u0302\u0303\u0304а').text, 'з\u0301\u0302а');
  });

  it('ссылки, почта, @ники и телефоны вырезаются, пунктуация остаётся', () => {
    const cases = [
      ['Меню: https://kafe.example/menu?x=1, вкусно', 'Меню:, вкусно', 1],
      ['Смотри www.kafe.ru.', 'Смотри.', 1],
      ['Пиши на kafe@mail.ru или @kafe_msk!', 'Пиши на или!', 2],
      ['Сайт кафе.рф и vk.com/kafe_chat', 'Сайт и', 2],
      ['Звони +7 (999) 123-45-67 или 8 800 555 35 35', 'Звони или', 2],
      ['т.е. ул.Ленина, г.Москва, 1 500 ₽, 10:00–22:00, 15.10.2026', 'т.е. ул.Ленина, г.Москва, 1 500 ₽, 10:00–22:00, 15.10.2026', 0],
    ];
    for (const [src, want, links] of cases) {
      const r = cleanText(src);
      assert.equal(r.text, want, src);
      assert.equal(r.links, links, src);
    }
    assert.equal(cleanText('https://kafe.example', { keepLinks: true }).text, 'https://kafe.example');
  });

  it('телефоны в любом виде вырезаются, а даты, время, цены и номера заказов — нет', () => {
    for (const ph of ['89991234567', '+7 999 123 45 67', '+7 (999) 123-45-67', '8 800 555 35 35', '8-999-123-45-67', '+79991234567', '(495) 123-45-67', '999 123-45-67', '8 (916) 123 45 67', '+44 20 7946 0958']) {
      const r = cleanText('Бронь: ' + ph + ' — ждём');
      assert.equal(r.text, 'Бронь: — ждём', ph);
      assert.equal(r.links, 1, ph);
    }
    assert.equal(cleanText('тел.89161234567').text, 'тел.');
    for (const ok of ['Были 15.10.2026 19:00, всё понравилось', 'Чек 1500 2000 3000 руб', 'Цены 350 450 550 650 750', 'Чек 900 1200 1500 руб', 'Столик 12, заказ 1234567890', '7 человек, 900 рублей', 'Были с 18.10 по 20.10.2026 2 раза']) {
      const r = cleanText(ok);
      assert.deepEqual([r.text, r.links], [ok, 0], ok);
    }
  });

  it('пробелы и повторы схлопываются, переносы — не больше одной пустой строки', () => {
    assert.equal(cleanText('  Супер!!!!!!!   ааааааа \t\n\n\n\n Вернусь  ').text, 'Супер!!! ааа\n\nВернусь');
    assert.equal(cleanLine('Аня\nи\r\nБоря', 30), 'Аня и Боря');
    assert.equal(cleanText('\u2028строка\u2029').text, 'строка');
  });

  it('обрезка по символам не рвёт эмодзи', () => {
    const r = cleanText('😀😃'.repeat(5), { max: 5 });
    assert.equal(r.text, '😀😃😀😃😀');
    assert.equal(cleanText('😀'.repeat(10)).text, '😀😀😀');   // повторы тоже схлопываются
  });

  it('капс определяется на длинном тексте', () => {
    assert.equal(cleanText('УЖАСНО ДОЛГО ЖДАЛИ ЗАКАЗ, НЕ ПРИДЁМ').caps, true);
    assert.equal(cleanText('ОК, ВКУСНО').caps, false);
    assert.equal(cleanText('Очень вкусно, особенно ПАСТА и десерты').caps, false);
  });
});

describe('мат', () => {
  const bad = 'хуй нахуй похуй охуеть нихуя ахуеть хуёвый пизда спиздил пиздец ебать ёбаный заебал наебал уебок съебись отъебись выебон долбоёб блядь блять бля сука суки сукин мудак мудило пидор пидорас залупа гандон гондон шлюха манда дрочить говно xуй 6лядь ХУЙ Блять huy blyat suka pizdec zaebal';
  const good = 'себе тебе себя хлеб хлеба небо небе требовать учебный погребать колебаться страхует застрахуй психует тихую сухую плохую глухую хуже худой художник хулиган ухудшить схуднуть мудрый мандарин мандат команда бледный гондола Педро сукно сук перебить подъезд забота ребята серебро небольшой употреблять оскорблять хлебница выхухоль Хуан бляха сучки рубль манеж Ебург-шоу';

  it('ловит корни, в том числе латиницей, цифрами и капсом', () => {
    assert.deepEqual(bad.split(' ').filter(w => !isProfane(w)), []);
  });
  it('не трогает обычные слова', () => {
    assert.deepEqual(good.split(' ').filter(w => w !== 'Ебург-шоу' && isProfane(w)), []);
  });
  it('маска: первая буква и звёздочки, счётчик', () => {
    assert.deepEqual(maskProfanity('Ну блять, это пиздец, но себе нормально'), { text: 'Ну б****, это п*****, но себе нормально', count: 2 });
    assert.equal(cleanText('ХУЙ тебе', { mask: true }).text, 'Х** тебе');
    assert.equal(cleanText('ХУЙ тебе', { mask: true }).masked, 1);
  });
});

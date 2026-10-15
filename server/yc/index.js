/* Точка входа Yandex Cloud Functions: yc/index.handler.
   Обычный CommonJS (module.exports), как в примерах документации Cloud Functions, — так среда выполнения
   загрузит файл и через require, и через import. Сам код — ES-модули (.mjs): подгружаем их при первом вызове. */
'use strict';

let main = null;

module.exports.handler = async function handler(event, context) {
  if (!main) main = import('./main.mjs').catch(e => { main = null; throw e; });
  return (await main).handler(event, context);
};

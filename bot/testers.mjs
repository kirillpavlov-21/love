#!/usr/bin/env node
/* Сводка по тестерам бота: node bot/testers.mjs [файл] (по умолчанию ~/.kuda/logs/testers.jsonl — его пишет poll.mjs или webhook.mjs).
   По каждому коду: когда пришёл и когда был последний раз, в сколько разных дней возвращался (вернулся ли через 2+ дня — грубое
   удержание), сколько сообщений и нажатий, частые кнопки и последние запросы — чтобы увидеть, где бот путает. Ничего никуда не шлёт */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const file = process.argv[2] || process.env.BOT_TESTERS || path.join(os.homedir(), '.kuda', 'logs', 'testers.jsonl');
if (!fs.existsSync(file)) { console.log(`Пока пусто: ${file} не найден — тестеры ещё не писали боту.`); process.exit(0); }

const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(r => r && r.tester);
// кнопки — по первой части данных: g (листать), m (другие варианты), z (квиз), s (удиви), t (топ), a (афиша), v (голос)
const BTN = { g: 'листать ‹ ›', m: 'другие варианты', z: 'квиз', s: 'удиви меня', t: 'топ', a: 'афиша', v: 'голос', c: 'город', p: 'опрос в чате', x: 'счётчик' };
const by = new Map();
for (const r of rows) {
  const t = by.get(r.tester) || { first: r.at, last: r.at, days: new Set(), msgs: [], btns: {}, inline: 0 };
  if (r.at < t.first) t.first = r.at;
  if (r.at > t.last) t.last = r.at;
  t.days.add(String(r.at).slice(0, 10));
  if (r.kind === 'message') t.msgs.push(r.text);
  else if (r.kind === 'button') { const k = BTN[String(r.data).split('|')[0]] || String(r.data).split('|')[0]; t.btns[k] = (t.btns[k] || 0) + 1; }
  else t.inline++;
  by.set(r.tester, t);
}
const day = s => String(s).slice(0, 16).replace('T', ' ');
const gap = t => (Date.parse(t.last) - Date.parse(t.first)) / 864e5;
console.log(`Тестеров: ${by.size}, действий: ${rows.length}, вернулись через 2+ дня: ${[...by.values()].filter(t => gap(t) >= 2).length}\n`);
for (const [code, t] of [...by.entries()].sort((a, b) => b[1].last.localeCompare(a[1].last))) {
  const btns = Object.entries(t.btns).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join(', ') || '—';
  console.log(`■ ${code}: ${day(t.first)} → ${day(t.last)} · дней: ${t.days.size}${gap(t) >= 2 ? ' · вернулся' : ''}`);
  console.log(`  сообщений ${t.msgs.length}, inline ${t.inline}; кнопки: ${btns}`);
  t.msgs.slice(-6).forEach(m => console.log(`  » ${m}`));
  console.log('');
}

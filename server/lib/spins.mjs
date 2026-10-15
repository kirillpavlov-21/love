/* Итоги колеса при ничьей — общие для обоих хранилищ.
   На приглашение хранится список до MAX_SPINS записей {i, d, t, L} в порядке записи (JSON):
   L — набор лидеров ничьей ('0,3,5': номера по возрастанию через запятую), '' — итог старого клиента без L.
   Для каждого L остаётся первый итог; не хватает места — уходит самый старый.
   Наружу: spin — последний записанный итог (или итог запрошенного L), spins — {L: итог} только для непустых L. */
export const MAX_SPINS = 10;

const okEntry = s => s && typeof s === 'object' && Number.isInteger(s.i);
const norm = s => ({ i: s.i, d: Number.isInteger(s.d) ? s.d : null, t: Number(s.t) || 0, L: typeof s.L === 'string' ? s.L : '' });

/* Список из базы: новый формат (spins) или одиночный итог старой версии (spin) */
export function spinList(spinsJson, spinJson) {
  const parse = v => { if (typeof v !== 'string' || !v) return null; try { return JSON.parse(v); } catch (e) { return null; } };
  const list = parse(spinsJson);
  if (Array.isArray(list)) return list.filter(okEntry).map(norm);
  const one = parse(spinJson);
  return okEntry(one) ? [norm(one)] : [];
}

/* Новый список с итогом rec или null, если для этого L итог уже есть (первый остаётся) */
export function spinAdd(list, rec, max = MAX_SPINS) {
  const L = rec.L || '';
  if (list.some(s => s.L === L)) return null;
  const next = list.concat([norm({ ...rec, L })]);
  while (next.length > Math.max(1, max)) next.shift();
  return next;
}

const out = s => (s.L ? { i: s.i, d: s.d, t: s.t, L: s.L } : { i: s.i, d: s.d, t: s.t });

/* L не задан — spin последний; задан — итог этого набора лидеров */
export function spinView(list, L) {
  const pick = L === undefined ? list[list.length - 1] : list.find(s => s.L === (L || ''));
  const spins = {};
  for (const s of list) if (s.L) spins[s.L] = out(s);
  return { spin: pick ? out(pick) : null, spins };
}

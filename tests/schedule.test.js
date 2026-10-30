const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/schedule');

// Viernes 30 de octubre de 2026 (hora local).
const T = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();
const base = { morningTime: '08:00', eveningTime: '16:30' };

test('fases del día: desayuno, trabajo, pausa, almuerzo, fuera de la jornada y cena', () => {
  const cfg = S.config(base);
  assert.equal(S.phase(T(30, 7, 10), cfg).meal, 'breakfast');
  assert.equal(S.phase(T(30, 7, 40), cfg).kind, 'off'); // antes de entrar
  assert.equal(S.phase(T(30, 9), cfg).kind, 'work');
  assert.equal(S.phase(T(30, 10, 5), cfg).kind, 'break');
  const lunch = S.phase(T(30, 12, 30), cfg);
  assert.equal(lunch.kind, 'meal');
  assert.equal(lunch.meal, 'lunch');
  assert.equal(lunch.inShift, true);
  assert.equal(S.phase(T(30, 17), cfg).kind, 'off');
  assert.equal(S.phase(T(30, 19, 20), cfg).meal, 'dinner');
  assert.equal(S.isWorkTime(T(30, 12, 30), cfg), false, 'almorzando no es hora de trabajar');
});

test('el fin de semana se descansa (por defecto de lunes a viernes)', () => {
  const cfg = S.config(base);
  const sat = S.phase(T(31, 10), cfg);
  assert.equal(sat.kind, 'rest');
  assert.equal(sat.weekend, true);
  assert.equal(S.isWorkday(T(31, 10), cfg), false);
  // Pero las comidas existen todos los días.
  assert.equal(S.phase(T(31, 12, 15), cfg).meal, 'lunch');
  // Días configurados a mano (p. ej. también los sábados).
  assert.equal(S.phase(T(31, 11), S.config({ ...base, workDays: [1, 2, 3, 4, 5, 6] })).kind, 'work');
});

test('excepciones: "trabajaré el domingo de 8 a 12" y "el lunes es feriado"', () => {
  const now = T(30, 15);
  const e1 = S.parseExtra('trabajaré domingo de 8 a 12 de la tarde', now);
  assert.deepEqual(e1, { date: '2026-11-01', start: '08:00', end: '12:00' });
  const e2 = S.parseExtra('el lunes es feriado', now);
  assert.deepEqual(e2, { date: '2026-11-02', off: true });
  let extras = S.addExtra([], e1, now);
  extras = S.addExtra(extras, e2, now);
  const cfg = S.config(base, extras);
  const sun = S.phase(T(1 + 31, 9), cfg); // 1 de noviembre
  assert.equal(new Date(T(32, 9)).getDate(), 1);
  assert.equal(sun.kind, 'work');
  assert.equal(sun.extra, true);
  assert.equal(S.phase(T(32, 12, 30), cfg).kind, 'meal');
  assert.equal(S.phase(T(32, 13), cfg).kind, 'rest', 'después del turno extra sigue siendo domingo libre');
  assert.equal(S.phase(T(33, 10), cfg).kind, 'rest', 'el lunes feriado no se trabaja');
  assert.equal(S.isWorkday(T(33, 10), cfg), false);
});

test('el parser entiende cómo lo dices', () => {
  const now = T(30, 15);
  const cases = {
    'mañana trabajo de 2 a 6 de la tarde': { date: '2026-10-31', start: '14:00', end: '18:00' },
    'el sábado me toca de 9 a 1': { date: '2026-10-31', start: '09:00', end: '13:00' },
    'hoy trabajo de 10 de la noche a 6 de la mañana': { date: '2026-10-30', start: '22:00', end: '06:00' },
    'trabajaré el domingo de 8 de la mañana a 12': { date: '2026-11-01', start: '08:00', end: '12:00' },
    'el 2 de noviembre trabajo de 8:30 a 5': { date: '2026-11-02', start: '08:30', end: '17:00' },
    'voy a trabajar el domingo': { date: '2026-11-01' },
    'no trabajo el viernes': { date: '2026-10-30', off: true },
    'Sunday I will work': null,
    'quiero comer pizza el domingo': null,
  };
  for (const [text, want] of Object.entries(cases)) assert.deepEqual(S.parseExtra(text, now), want, text);
});

test('jornada nocturna que cruza la medianoche', () => {
  const cfg = S.config({ morningTime: '22:00', eveningTime: '06:00' });
  const p = S.phase(T(30, 23), cfg);
  assert.equal(p.kind, 'work');
  assert.equal(p.night, true);
  // El turno del viernes sigue el sábado de madrugada aunque el sábado no sea laboral.
  assert.equal(S.phase(T(31, 3), cfg).kind, 'work');
  assert.equal(S.phase(T(31, 7), cfg).meal, 'breakfast');
  assert.equal(S.isNight(T(30, 20), cfg), true);
  assert.equal(S.isNight(T(30, 10), cfg), false);
});

test('tiempo de jornada entre dos momentos: un fin de semana entero no cuenta', () => {
  const cfg = S.config(base);
  // Del viernes 17:00 al lunes 7:00: nada de jornada.
  assert.equal(S.workMsBetween(T(30, 17), T(33, 7), cfg), 0);
  // Del viernes 15:00 al lunes 9:00: 1.5 h del viernes + 1 h del lunes.
  assert.equal(S.workMsBetween(T(30, 15), T(33, 9), cfg), 2.5 * 3600e3);
  assert.equal(S.nextShiftStart(T(30, 17), cfg), T(33, 8));
});

test('addExtra reemplaza el mismo día y olvida lo viejo', () => {
  const now = T(30, 15);
  let x = S.addExtra([{ date: '2026-10-01', start: '08:00', end: '12:00' }], { date: '2026-11-01', start: '08:00', end: '12:00' }, now);
  x = S.addExtra(x, { date: '2026-11-01', start: '08:00', end: '13:00' }, now);
  assert.deepEqual(x, [{ date: '2026-11-01', start: '08:00', end: '13:00' }]);
  x = S.addExtra(x, { date: '2026-11-01', off: true }, now);
  assert.deepEqual(x, [{ date: '2026-11-01', off: true }]);
  assert.equal(S.dayLabel('2026-11-01', now), 'el domingo 1');
  assert.equal(S.dayLabel('2026-10-31', now), 'mañana');
});

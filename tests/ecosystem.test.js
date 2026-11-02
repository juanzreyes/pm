// Ecosistema PC + Android: la mezcla de fotos no pierde nada ni cuenta dos veces.
const test = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../src/sync');

/** Un ciclo de sincronización de un dispositivo: anota lo suyo y mezcla las fotos de los demás. */
function cycle(dev, data, ...others) {
  sync.stamp(data, dev, cycle.t += 1000);
  let out = data;
  for (const o of others) out = sync.merge(out, sync.pick(o));
  sync.stamp(out, dev, cycle.t);
  return out;
}
cycle.t = 1_000_000;

const pc0 = () => ({
  pet: { name: 'Pou', xp: 500, coins: 120, equipped: { hat: 'cap' }, species: 'chick', fullness: 80, owned: ['cap'] },
  settings: { morningTime: '08:00', eveningTime: '16:30', personality: 'sarcastico', workDays: [1, 2, 3, 4, 5], deviceId: 'pc' },
  days: {},
});
const phone0 = () => ({ pet: { name: '', xp: 0, coins: 0, species: 'chick', fullness: 100 }, settings: { morningTime: '09:00', personality: 'motivador', deviceId: 'ph' }, days: {} });

test('un teléfono recién vinculado adopta el pollito y los ajustes del ecosistema', () => {
  let pc = cycle('pc', sync.claim(pc0(), 'pc'));
  let ph = cycle('ph', phone0(), pc);
  assert.equal(ph.pet.name, 'Pou');
  assert.equal(ph.pet.xp, 500);
  assert.equal(ph.pet.coins, 120);
  assert.deepEqual(ph.pet.equipped, { hat: 'cap' });
  assert.equal(ph.settings.personality, 'sarcastico', 'no impone sus valores por defecto');
  assert.equal(ph.settings.morningTime, '08:00');
  assert.equal(ph.settings.deviceId, 'ph', 'lo propio del dispositivo no viaja');
  pc = cycle('pc', pc, ph);
  assert.equal(pc.pet.xp, 500);
  assert.equal(pc.settings.personality, 'sarcastico');
});

test('maíz y experiencia: lo ganado y gastado en los dos a la vez se suma, sin contar dos veces', () => {
  let pc = cycle('pc', sync.claim(pc0(), 'pc'));
  let ph = cycle('ph', phone0(), pc);
  // A la vez: en la PC gana 10 XP y 10 maíz; en el teléfono gana 5 XP y 5 maíz y compra algo de 40.
  pc.pet.xp += 10; pc.pet.coins += 10;
  ph.pet.xp += 5; ph.pet.coins += 5 - 40;
  pc = cycle('pc', pc, ph);
  ph = cycle('ph', ph, pc);
  for (let i = 0; i < 4; i++) { pc = cycle('pc', pc, ph); ph = cycle('ph', ph, pc); } // sincronizar muchas veces no cambia nada
  assert.equal(pc.pet.xp, 515);
  assert.equal(ph.pet.xp, 515);
  assert.equal(pc.pet.coins, 120 + 10 + 5 - 40);
  assert.equal(ph.pet.coins, pc.pet.coins);
});

test('cosméticos, estado del pollito y ajustes: gana el cambio más reciente, venga de donde venga', () => {
  let pc = cycle('pc', sync.claim(pc0(), 'pc'));
  let ph = cycle('ph', phone0(), pc);
  // En el teléfono se pone otro sombrero y cambia la hora de almuerzo; en la PC cambia la personalidad.
  ph.pet.equipped = { hat: 'wizard' };
  ph.pet.owned = [...(ph.pet.owned || []), 'wizard'];
  ph.settings.meals = { lunch: { on: true, at: '12:30', min: 45 } };
  ph = cycle('ph', ph, pc);
  pc.settings.personality = 'zen';
  pc = cycle('pc', pc, ph);
  ph = cycle('ph', ph, pc);
  assert.deepEqual(pc.pet.equipped, { hat: 'wizard' });
  assert.ok(pc.pet.owned.includes('wizard') && pc.pet.owned.includes('cap'), 'la colección se suma');
  assert.equal(pc.settings.meals.lunch.at, '12:30');
  assert.equal(ph.settings.personality, 'zen');
  // Se fue de vacaciones en la PC → también en el teléfono; vuelve en el teléfono → vuelve en la PC.
  pc.pet.vacation = { place: 'la playa', until: 9e12 };
  pc = cycle('pc', pc, ph);
  ph = cycle('ph', ph, pc);
  assert.equal(ph.pet.vacation.place, 'la playa');
  ph.pet.vacation = null;
  ph = cycle('ph', ph, pc);
  pc = cycle('pc', pc, ph);
  assert.equal(pc.pet.vacation, null);
});

test('días especiales y tareas viajan entre dispositivos', () => {
  let pc = cycle('pc', sync.claim(pc0(), 'pc'));
  let ph = cycle('ph', phone0(), pc);
  ph.workExtras = [{ date: '2026-11-08', start: '08:00', end: '12:00' }];
  ph.days['2026-11-02'] = { standup: { today: [{ text: 'Desde el teléfono', done: false }] } };
  ph = cycle('ph', ph, pc);
  pc = cycle('pc', pc, ph);
  assert.deepEqual(pc.workExtras, [{ date: '2026-11-08', start: '08:00', end: '12:00' }]);
  assert.equal(pc.days['2026-11-02'].standup.today[0].text, 'Desde el teléfono');
});

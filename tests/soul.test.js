// Tests de la sección 1 de 2.0: el alma del pollito.
const test = require('node:test');
const assert = require('node:assert/strict');
const soulMod = require('../src/petsoul');

const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return key(d); };

function ctxWith(data = {}) {
  const said = [];
  const sent = [];
  const store = { data: { settings: {}, days: {}, alerts: {}, pet: { name: 'Kiwi', born: Date.now() - 40 * 864e5, xp: 0, coins: 100, energy: 100, happiness: 80, fullness: 80 }, ...data }, save() {} };
  const ctx = {
    store, said, sent, say: (t) => said.push(t), broadcast() {}, send: (ch, d) => sent.push([ch, d]),
    aiAvailable: () => false, isMuted: () => false, addXp() {}, levelInfo: (xp) => ({ level: Math.floor(xp / 100) + 1 }),
  };
  return { ctx, soul: soulMod.create(ctx), data: store.data };
}

test('rasgos: búho, madrugador, hacker y rematador salen de los datos reales', () => {
  const days = {};
  for (let i = 0; i < 5; i++) days[daysAgo(i)] = { hours: { 23: { w: 3600 }, 1: { w: 1800 }, 10: { w: 3600 } }, commits: 8, standup: { today: [{ done: true }, { done: true }, { done: true }, { done: true }, { done: true }] } };
  const s = soulMod.workStats(days);
  assert.equal(s.night, 5 * 5400);
  assert.deepEqual(soulMod.traitsFor(s).sort(), ['finisher', 'hacker', 'owl']);
  const early = { [daysAgo(0)]: { hours: { 6: { w: 7200 }, 9: { w: 7200 } } } };
  assert.deepEqual(soulMod.traitsFor(soulMod.workStats(early)), ['early']);
});

test('rasgos: el pollito avisa cuando le sale uno nuevo (una vez)', () => {
  const days = {};
  for (let i = 0; i < 3; i++) days[daysAgo(i)] = { commits: 12 };
  const { soul, ctx, data } = ctxWith({ days });
  soul.traitTick();
  assert.deepEqual(data.pet.traits, ['hacker']);
  assert.match(ctx.said[0], /Hacker/);
  soul.traitTick();
  assert.equal(ctx.said.length, 1, 'no repite el mismo día');
  assert.equal(soul.snapshot().soul.traits[0].emoji, '💻');
});

test('huerta: cada tarea riega, a la 3.ª está lista, se cosecha y se marchita sin tareas', () => {
  const { soul, data, ctx } = ctxWith();
  for (let i = 0; i < 3; i++) soul.onTaskDone({ text: 'x' }, false);
  const g = soul.snapshot().soul.garden;
  assert.deepEqual(g.pots.map((p) => p.growth), [1, 1, 1], 'riega la más pequeña');
  for (let i = 0; i < 6; i++) soul.onTaskDone({ text: 'x' }, false);
  assert.ok(soul.snapshot().soul.garden.pots.every((p) => p.ripe));
  assert.match(ctx.said.join('\n'), /lista para cosechar/);
  const coins = data.pet.coins;
  assert.equal(soul.act('harvest', 0).ok, true);
  assert.equal(data.pet.coins, coins + 15);
  assert.equal(soul.act('harvest', 0).ok, false, 'ya no está madura');
  assert.equal(soul.act('buyPot').ok, true);
  assert.equal(data.pet.coins, coins + 15 - 40);
  // 5 días sin regar → marchita; la siguiente tarea la revive sin crecer.
  data.pet.garden.lastWater = Date.now() - 6 * 864e5;
  data.pet.garden.pots[1].growth = 2; data.pet.garden.pots[1].wilted = false;
  soul.tick();
  assert.equal(data.pet.garden.pots[1].wilted, true);
  soul.onTaskDone({ text: 'y' }, false);
  assert.equal(data.pet.garden.pots.filter((p) => p.wilted).length < 5, true);
});

test('trucos: practicar con límite diario y energía; aprendido, lo hace al terminar todo', () => {
  const { soul, data, ctx } = ctxWith();
  for (let i = 0; i < 3; i++) assert.equal(soul.act('practice', 'spin').ok, true);
  assert.equal(soul.act('practice', 'spin').ok, false, 'máximo 3 al día');
  assert.equal(data.pet.tricks.spin.progress, 3);
  data.pet.practiceDay = 'otro-dia';
  assert.equal(soul.act('practice', 'spin').learned, true, 'a la 4.ª práctica lo aprende');
  assert.match(ctx.said.at(-1), /Aprendí Giro/);
  data.pet.energy = 5;
  data.pet.practiceDay = 'otro-dia-mas';
  assert.match(soul.act('practice', 'flip').error, /cansado/);
  ctx.sent.length = 0;
  assert.equal(soul.perform(), true);
  assert.deepEqual(ctx.sent.at(-1), ['pet:anim', 'trick-spin']);
});

test('vacaciones: si lo descuidas 24 h se va y vuelve con una postal', () => {
  const { soul, data, ctx } = ctxWith();
  Object.assign(data.pet, { fullness: 0, happiness: 5 });
  soul.vacationTick();
  assert.ok(data.pet.neglectedSince && !data.pet.vacation, 'primero solo lo anota');
  data.pet.neglectedSince = Date.now() - 25 * 3600e3;
  soul.vacationTick();
  assert.ok(data.pet.vacation, 'se fue');
  assert.match(ctx.said.at(-1), /vacaciones/);
  assert.equal(soul.isAway(), true);
  data.pet.coins = 10;
  assert.match(soul.act('callBack').error, /faltan/);
  data.pet.vacation.until = Date.now() - 1;
  soul.vacationTick();
  assert.equal(data.pet.vacation, null);
  assert.equal(data.pet.fullness, 75);
  assert.equal(data.pet.postcards.length, 1);
  assert.match(ctx.said.at(-1), /postal/);
});

test('fechas: cumpleaños que se repiten y entregas con aviso a 3 días, una sola vez', () => {
  const { soul, data, ctx } = ctxWith();
  const d = new Date();
  const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const in3 = new Date(); in3.setDate(in3.getDate() + 3);
  assert.equal(soul.act('addDate', { label: 'Ana', date: iso, kind: 'birthday' }).ok, true);
  assert.equal(soul.act('addDate', { label: 'Informe Q3', date: `${in3.getFullYear()}-${pad(in3.getMonth() + 1)}-${pad(in3.getDate())}`, kind: 'deadline' }).ok, true);
  assert.equal(soul.act('addDate', { label: '', date: iso }).ok, false);
  const h = new Date().getHours();
  if (h >= 8) {
    soul.tick();
    const msgs = ctx.said.join('\n');
    assert.match(msgs, /Hoy es el cumpleaños de Ana/);
    assert.match(msgs, /Faltan 3 días para: Informe Q3/);
    const n = ctx.said.length;
    soul.tick();
    assert.equal(ctx.said.length, n, 'no repite');
  }
  // Un cumpleaños que ya pasó este año cuenta hacia el próximo.
  const past = new Date(); past.setDate(past.getDate() - 10);
  assert.ok(soul.daysUntil({ month: past.getMonth() + 1, day: past.getDate() }) > 340);
  assert.equal(data.petDates.length, 2);
});

test('sueño y carta del viernes con tus datos reales (sin IA, por plantilla)', async () => {
  const { soul, data } = ctxWith({ days: { [daysAgo(1)]: { standup: { today: [{ text: '[PM-12] Arreglar el carrito', done: true }] } }, [daysAgo(0)]: { hours: { 10: { w: 7200 } }, pomodoros: 3, standup: { today: [{ text: 'a', done: true }] } } } });
  const d = await soul.dream(true);
  assert.match(d.text, /^Anoche soñé que .*"Arreglar el carrito"/, "sin la clave del ticket");
  data.settings.personality = 'sargento';
  const l = await soul.writeLetter(true);
  assert.match(l.text, /^¡ATENCIÓN, RECLUTA!\nEsta semana trabajamos 2 horas/);
  assert.match(l.text, /3 pomodoros/);
  assert.match(l.text, /— Kiwi 🐣$/);
});

test('linaje: el gallo veterano pone un huevo y el heredero hereda rasgo, trucos y especie', () => {
  const { soul, data, ctx } = ctxWith();
  assert.equal(soul.snapshot().soul.legacy.canLay, false, 'nivel 1 aún no');
  Object.assign(data.pet, { xp: 1000, species: 'duck', traits: ['owl'], tricks: { spin: { progress: 4, learned: true } }, coins: 77, collection: { '🦄': 1 } });
  assert.equal(soul.act('layEgg').ok, true);
  assert.equal(soul.act('hatchHeir', '').ok, false);
  assert.equal(soul.act('hatchHeir', 'Pío II').ok, true);
  const p = data.pet;
  assert.deepEqual({ name: p.name, gen: p.generation, inherited: p.inherited, species: p.species, coins: p.coins, parent: p.parent }, { name: 'Pío II', gen: 2, inherited: 'owl', species: 'duck', coins: 77, parent: 'Kiwi' });
  assert.equal(p.tricks.spin.learned, true);
  assert.deepEqual(p.collection, { '🦄': 1 }, 'la colección se conserva');
  assert.equal(data.lineage[0].name, 'Kiwi');
  assert.ok(soul.snapshot().soul.traits.some((t) => t.id === 'owl' && t.inherited));
  assert.match(ctx.said.at(-1), /Soy Pío II, generación 2/);
});

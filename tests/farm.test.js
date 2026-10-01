// 2.0 · 5/7 — Equipo: granja compartida, kudos con maíz, visitas y reto de foco.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tf = require('../src/teamfarm');

const NOW = new Date(2026, 9, 7, 11, 0).getTime(); // miércoles 7 oct 2026
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pm-farm-'));

test('semana y minutos de foco: de lunes a hoy, en minutos', () => {
  assert.equal(tf.weekKey(new Date(NOW)), '2026-10-05');
  assert.equal(tf.weekKey(new Date(2026, 9, 11)), '2026-10-05', 'el domingo sigue en la misma semana');
  const days = { '2026-10-04': { focus: { work: 99999 } }, '2026-10-05': { focus: { work: 3600 } }, '2026-10-07': { focus: { work: 1800 } } };
  assert.equal(tf.weekFocusMins(days, new Date(NOW)), 90, 'el domingo anterior no cuenta');
});

test('tarjeta pública: solo lo de la lista blanca, y se valida al leer', () => {
  const c = tf.card({ id: 'a1', name: 'Ana', pet: { name: 'Kiwi', species: 'duck', happiness: 20, coins: 999, tasks: ['secreto'] }, level: 4, focusMode: true, weekMins: 120, now: NOW });
  assert.deepEqual(Object.keys(c).sort(), ['at', 'focus', 'focusUntil', 'id', 'kudos', 'level', 'mood', 'name', 'petName', 'species', 'streak', 'v', 'week', 'weekMins']);
  assert.equal(c.mood, 'triste');
  assert.equal(JSON.stringify(c).includes('secreto'), false);
  assert.equal(tf.parseCard('{nope'), null);
  assert.equal(tf.parseCard({ v: 2, id: 'x', at: 1 }), null);
  const bad = tf.parseCard({ v: 1, id: 'x', at: NOW, name: '<img onerror=alert(1)>Eve', species: 'dragon', level: 1e9, weekMins: 1e9 });
  assert.deepEqual({ name: bad.name, species: bad.species, level: bad.level, weekMins: bad.weekMins }, { name: 'img onerror=alert(1)Eve', species: 'chick', level: 999, weekMins: 10080 });
});

test('granja: estado (en el PC, en foco, desconectado), sin mí y ordenada', () => {
  const mk = (id, name, extra) => tf.card({ id, name, now: NOW, ...extra });
  const cards = [mk('me', 'Yo'), mk('b', 'Beto', { focusMode: true }), { ...mk('c', 'Caro'), at: NOW - 3600e3 }, mk('d', 'Dani')];
  const f = tf.farm(cards, 'me', NOW);
  assert.deepEqual(f.map((m) => [m.name, m.status]), [['Dani', 'online'], ['Beto', 'focus'], ['Caro', 'away']]);
  assert.equal(tf.canVisit(f[0], [], NOW).ok, true);
  assert.match(tf.canVisit(f[1], [], NOW).error, /modo foco/);
  assert.match(tf.canVisit(f[2], [], NOW).error, /no está en su PC/);
  assert.match(tf.canVisit(f[0], [{ type: 'visit', to: 'd', at: NOW - 10 * 60e3 }], NOW).error, /hace poco/);
});

test('reto de foco: suma de la semana entre todos; las tarjetas viejas no cuentan', () => {
  const mk = (id, mins, week = '2026-10-05') => ({ ...tf.card({ id, name: id, weekMins: mins, now: NOW }), week });
  const ch = tf.challenge([mk('a', 400), mk('b', 200), mk('c', 900, '2026-09-28')], NOW);
  assert.deepEqual({ members: ch.members, goal: ch.goal, done: ch.done, reached: ch.reached, top: ch.top[0].name }, { members: 2, goal: 720, done: 600, reached: false, top: 'a' });
  assert.equal(tf.challenge([mk('a', 400), mk('b', 400)], NOW).reached, true);
});

test('buzones: kudos y visitas para mí, una sola vez, y límite de kudos diario', () => {
  const ana = tf.card({ id: 'ana', name: 'Ana', pet: { name: 'Pío', species: 'cat' }, now: NOW });
  const box = [tf.event('kudo', ana, 'me', 'gracias por el PR', NOW), tf.event('visit', ana, 'me', '', NOW), tf.event('kudo', ana, 'otro', '', NOW), { type: 'hack', to: 'me', id: 'z', at: NOW }];
  const got = tf.inbox([box, null], 'me', [], NOW);
  assert.deepEqual(got.map((e) => [e.type, e.fromName, e.species, e.msg]), [['kudo', 'Ana', 'cat', 'gracias por el PR'], ['visit', 'Ana', 'cat', '']]);
  assert.equal(tf.inbox([box], 'me', got.map((e) => e.id), NOW).length, 0, 'lo visto no se repite');
  assert.equal(tf.kudosLeft(box, new Date(NOW)), 1);
  assert.equal(tf.trimOutbox([{ at: NOW - 8 * 864e5 }, { at: NOW }], NOW).length, 1);
});

// ---------------- dos PMs que comparten la carpeta ----------------
function fakeM(name, folder, extra = {}) {
  const said = [];
  const pet = [];
  const data = { settings: { myName: name, teamFolder: folder }, pet: { name: 'Pollo de ' + name, species: 'chick', coins: 0, happiness: 50, xp: 0 }, days: {}, focusUntil: 0 };
  const M = {
    store: { data, save() {} }, TEST: true, fs, path, diag: { log: (_c, m) => said.push('ERR ' + m) },
    say: (t) => said.push(t), sendPet: (ch, v) => pet.push([ch, v]), broadcast() {}, addXp: (n) => { data.pet.xp += n; },
    levelInfo: () => ({ level: 3 }), focusMode: () => false, gami: { streaks: () => ({ daily: 2 }) }, remote: { sendTeam: async () => {} },
    said, pet, ...extra,
  };
  M.farm = require('../src/main/teamfarm')(M);
  return M;
}

test('granja de punta a punta: se ven, kudo con maíz, visita que respeta el foco y premio del reto', () => {
  const folder = tmp();
  const ana = fakeM('Ana', folder);
  let focused = true;
  const beto = fakeM('Beto', folder, { focusMode: () => focused });
  ana.farm.tick(); beto.farm.tick(); ana.farm.tick();
  const sa = ana.farm.farmState();
  assert.deepEqual(sa.mates.map((m) => [m.name, m.status]), [['Beto', 'focus']]);
  const raw = fs.readFileSync(path.join(folder, 'pm-granja', sa.me.id + '.json'), 'utf8');
  assert.equal(raw.includes('coins'), false, 'el maíz y lo demás no se comparte');
  const betoId = sa.mates[0].id;
  // Beto está en foco: no se le puede visitar, pero sí darle un kudo.
  assert.match(ana.farm.visit(betoId).error, /modo foco/);
  assert.equal(ana.farm.giveKudo(betoId, '¡Gran demo!').ok, true);
  beto.farm.tick();
  assert.equal(beto.store.data.pet.coins, tf.KUDO_CORN);
  assert.match(beto.said.join('\n'), /Ana te dio un kudo! «¡Gran demo!»/);
  beto.farm.tick();
  assert.equal(beto.store.data.pet.coins, tf.KUDO_CORN, 'el mismo kudo no se cobra dos veces');
  // Beto termina el foco: ya se le puede visitar.
  focused = false;
  beto.farm.tick(); ana.farm.tick();
  assert.equal(ana.farm.visit(betoId).ok, true);
  beto.farm.tick();
  assert.deepEqual(beto.pet.find(([ch]) => ch === 'pet:visitor'), ['pet:visitor', { name: 'Ana', petName: 'Pollo de Ana', species: 'chick', ms: 45000 }]);
  // Límite de kudos.
  ana.farm.giveKudo(betoId); ana.farm.giveKudo(betoId);
  assert.match(ana.farm.giveKudo(betoId).error, /Ya diste tus 3 kudos/);
  // Reto: con 6 h cada uno, premio una vez por semana.
  const today = new Date();
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  ana.store.data.days[key] = { focus: { work: 6 * 3600 } };
  beto.store.data.days[key] = { focus: { work: 6 * 3600 } };
  beto.farm.tick(); ana.farm.tick(); ana.farm.tick();
  assert.equal(ana.farm.farmState().challenge.reached, true);
  assert.equal(ana.said.filter((t) => /cumplió el reto/.test(t)).length, 1);
  assert.equal(ana.store.data.pet.coins, 30);
  // Dejar de compartir: no se publica nada más.
  ana.store.data.settings.teamShare = false;
  ana.farm.tick();
  assert.equal(ana.farm.farmState().mates.length, 0);
  beto.farm.tick();
  assert.equal(beto.farm.farmState().mates.length, 0, 'Beto ya no ve a Ana');
});

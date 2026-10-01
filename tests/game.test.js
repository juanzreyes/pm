// 2.0 · 6/7 — Juego: misiones, pase de temporada, huevos dorados, minijuegos y tu año.
const test = require('node:test');
const assert = require('node:assert/strict');
const gz = require('../src/gamezone');
const gami = require('../src/gamification');
const tf = require('../src/teamfarm');

test('misiones: 3 al día, siempre las mismas para la fecha y sin las que no aplican', () => {
  const a = gz.missionsFor('2026-10-07').map((m) => m.id);
  assert.equal(a.length, 3);
  assert.equal(new Set(a).size, 3);
  assert.deepEqual(gz.missionsFor('2026-10-07').map((m) => m.id), a, 'deterministas');
  for (let d = 1; d <= 28; d++) {
    const ids = gz.missionsFor(`2026-02-${String(d).padStart(2, '0')}`).map((m) => m.id);
    assert.equal(ids.includes('kudo1') || ids.includes('claude2'), false, 'sin equipo ni Claude no salen');
  }
  const many = new Set();
  for (let d = 1; d <= 28; d++) gz.missionsFor(`2026-03-${String(d).padStart(2, '0')}`, { team: true, claude: true }).forEach((m) => many.add(m.id));
  assert.ok(many.has('kudo1') && many.has('claude2') && many.size >= 8, 'hay variedad');
  const tasks = gz.MISSIONS.find((m) => m.id === 'tasks3');
  const v = gz.missionView(tasks, { day: { standup: { today: [{ done: true }, { done: true }, { done: false }] } } });
  assert.deepEqual({ n: v.n, done: v.done }, { n: 2, done: false });
  const focus = gz.missionView(gz.MISSIONS.find((m) => m.id === 'focus2h'), { day: { focus: { work: 9000 } } }, ['focus2h']);
  assert.deepEqual({ n: focus.n, done: focus.done, claimed: focus.claimed }, { n: 120, done: true, claimed: true }, 'tope en la meta');
});

test('pase de temporada: niveles, recompensas exclusivas y puntos por partida', () => {
  assert.equal(gz.seasonOf(new Date(2026, 9, 7)), '2026-10');
  assert.equal(gz.seasonName('2026-10'), 'octubre 2026');
  assert.equal(gz.tierOf(149), 0);
  assert.equal(gz.tierOf(150), 1);
  assert.equal(gz.tierOf(99999), 20);
  assert.equal(gz.tierReward(10).item, 'skin-sunset');
  assert.equal(gz.tierReward(20).item, 'skin-galaxy');
  assert.equal(gz.tierReward(5).xp, 50);
  assert.equal(gz.tierReward(3).corn, 16);
  for (const it of ['skin-sunset', 'skin-galaxy', 'skin-rainbow', 'buddy-golden']) assert.ok(gami.SHOP.find((x) => x.id === it && x.exclusive), it + ' existe como exclusivo');
  assert.equal(gz.gamePts(80, 0), 50);
  assert.equal(gz.gamePts(12, 2), 12);
  assert.equal(gz.gamePts(30, 3), 0, 'desde la 4.ª partida, no suma');
});

test('huevos dorados: por racha, una sola vez cada uno', () => {
  assert.deepEqual(gz.newEggs(6).map((e) => e.streak), []);
  assert.deepEqual(gz.newEggs(15).map((e) => e.streak), [7, 14]);
  assert.deepEqual(gz.newEggs(15, [{ streak: 7 }]).map((e) => e.streak), [14]);
  assert.equal(gz.nextEgg(15).streak, 30);
  assert.equal(gz.nextEgg(999), null);
});

test('tu año: números, destacados, tipo de año y texto para compartir', () => {
  const data = {
    pet: { name: 'Kiwi', bestScore: 40, bestScores: { snake: 55 }, achievements: [{ id: 'x', at: new Date(2026, 3, 1).getTime() }, { id: 'y', at: new Date(2025, 3, 1).getTime() }] },
    days: {
      '2025-12-31': { focus: { work: 99999 }, commits: 99 },
      '2026-03-02': { focus: { work: 4 * 3600 }, standup: { today: [{ done: true }, { done: false }] }, pomodoros: 3, commits: 5, hours: { 23: { w: 3000 } }, projects: { pm: 7200, web: 100 } },
      '2026-03-03': { focus: { work: 2 * 3600 }, standup: { today: [{ done: true }] }, claudeTasks: 4, hours: { 10: { w: 500 } }, projects: { web: 3000 } },
    },
  };
  const w = gz.wrapped(data, 2026, { kudos: 3 });
  assert.deepEqual({ days: w.days, focusH: w.focusH, tasks: w.tasks, pomodoros: w.pomodoros, commits: w.commits, claude: w.claudeTasks, dailies: w.dailies }, { days: 2, focusH: 6, tasks: 2, pomodoros: 3, commits: 5, claude: 4, dailies: 2 });
  assert.deepEqual({ top: w.topProject, wd: w.bestWeekday, month: w.bestMonth, hour: w.bestHour, best: w.bestDay, ach: w.achievements, score: w.bestScore }, { top: 'pm', wd: 'lunes', month: 'marzo', hour: 23, best: { date: '2026-03-02', hours: 4 }, ach: 1, score: 55 });
  assert.equal(w.persona.name, 'Búho nocturno');
  const t = gz.wrappedText(w);
  assert.match(t, /Mi 2026 con PM Pollito[\s\S]*6 h de trabajo enfocado[\s\S]*Proyecto estrella: pm/);
  assert.equal(gz.wrapped({ days: {} }, 2026).persona.name, 'En pleno crecimiento', 'año vacío');
});

test('ranking de minijuegos del equipo', () => {
  const c = (id, games) => tf.card({ id, name: id, games });
  const lb = tf.leaderboard([c('ana', { bugs: 40, snake: 10 }), c('beto', { bugs: 55 }), c('yo', { bugs: 12, corn: 30 })]);
  assert.deepEqual(lb.bugs.map((x) => [x.name, x.score]), [['beto', 55], ['ana', 40], ['yo', 12]]);
  assert.deepEqual(lb.corn.map((x) => x.name), ['yo']);
  assert.equal(tf.parseCard({ ...c('x', {}), games: { bugs: 1e9, hack: 5 } }).games.bugs, 999);
});

// ---------------- el módulo con su estado ----------------
function fakeM(days = {}) {
  const said = [];
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const data = { settings: {}, pet: { name: 'Kiwi', coins: 0, xp: 0, happiness: 50 }, days };
  const M = {
    store: { data, save() {} }, TEST: true, dayKey, gami, say: (t) => said.push(t), sendPet() {}, broadcast() {},
    addXp: (n) => { data.pet.xp += n; }, clamp: (v) => Math.max(0, Math.min(100, v)), checkAchievements() {}, said,
  };
  M.gz = require('../src/main/gamezone')(M);
  return M;
}

test('juego de punta a punta: reclamar misiones, subir el pase, partidas y huevos', () => {
  const today = new Date();
  const k = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const M = fakeM();
  // Todo cumplido hoy, para reclamar las misiones que toquen.
  M.store.data.days[k(today)] = { standup: { today: [{ done: true }, { done: true }, { done: true }] }, pomodoros: 3, focus: { work: 3 * 3600, distraction: 0 }, commits: 4 };
  M.gz.onGameEnd('bugs', 20);
  const st = M.gz.gameState();
  assert.equal(st.gamesToday, 1);
  assert.equal(st.bestScores.bugs, 20);
  assert.equal(M.store.data.pet.coins, 10, 'bugs: la mitad en maíz');
  assert.equal(st.season.pts, 20);
  assert.equal(M.gz.claimMission('nada').ok, false);
  for (const m of st.missions) assert.equal(M.gz.claimMission(m.id).ok, true, m.id);
  assert.equal(M.gz.claimMission(st.missions[0].id).ok, false, 'no dos veces');
  const after = M.gz.gameState();
  assert.equal(after.bonus, true);
  assert.equal(after.season.pts, 20 + 4 * gz.MISSION_PTS);
  assert.equal(after.season.tier, 2);
  assert.equal(M.store.data.pet.coins, 10 + 3 * gz.MISSION_CORN + 30 + 12 + 14, 'maíz de la partida, misiones, bono y niveles 1 y 2');
  assert.match(M.said.join('\n'), /Nivel 2 del pase/);
  // Llegar al nivel 10 da las plumas exclusivas.
  M.store.data.game.season.pts = 10 * gz.TIER_PTS - 10;
  M.store.data.game.season.tier = 9;
  M.gz.onGameEnd('snake', 15);
  assert.ok(M.store.data.pet.owned.includes('skin-sunset'));
  // Racha de 8 días laborables → huevo de 7; abrirlo da su premio una vez.
  const days = {};
  for (let i = 0, n = 0; n < 8; i++) { const d = new Date(Date.now() - i * 864e5); if (d.getDay() % 6) { days[k(d)] = { standup: { today: [] } }; n++; } }
  const M2 = fakeM(days);
  M2.gz.eggTick();
  M2.gz.eggTick();
  assert.deepEqual(M2.store.data.game.eggs.map((e) => [e.streak, e.opened]), [[7, false]]);
  const r = M2.gz.openEgg(7);
  assert.equal(r.ok, true);
  assert.equal(M2.store.data.pet.coins, 80);
  assert.equal(M2.gz.openEgg(7).ok, false);
  // Tu año, con el texto para compartir.
  const w = M2.gz.wrappedData(today.getFullYear());
  assert.equal(w.dailies >= 1, true);
  assert.match(w.text, /con PM Pollito/);
});

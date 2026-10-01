// 2.0 · 4/7 — Claude: respetar tus límites, recurrentes, modelo según la tarea y qué peticiones funcionan.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cs = require('../src/claudestats');

const NOW = new Date(2026, 9, 5, 10, 0).getTime(); // lunes 5 oct 2026, 10:00
const lim = (key, utilization, resetsAt = new Date(NOW + 2 * 3600e3).toISOString()) => ({ key, utilization, resetsAt });

test('límites: para por sesión, semana o pronóstico; sigue si hay margen', () => {
  assert.equal(cs.limitGuard({ limits: [lim('five_hour', 40)] }, 85, NOW).ok, true);
  assert.equal(cs.limitGuard(null, 85, NOW).ok, true, 'sin datos de uso no bloquea');
  const s = cs.limitGuard({ limits: [lim('five_hour', 90)] }, 85, NOW);
  assert.equal(s.ok, false);
  assert.match(s.reason, /sesión va al 90%/);
  assert.equal(s.until, NOW + 2 * 3600e3);
  assert.equal(cs.limitGuard({ limits: [lim('five_hour', 90)] }, 95, NOW).ok, true, 'el umbral es tuyo');
  const w = cs.limitGuard({ limits: [lim('five_hour', 10), lim('seven_day', 99)] }, 85, NOW);
  assert.match(w.reason, /semanal/);
  const f = cs.limitGuard({ limits: [lim('five_hour', 60)], forecast: { five_hour: { willHit: true, eta: NOW + 30 * 60e3 } } }, 85, NOW);
  assert.equal(f.ok, false);
  assert.match(f.reason, /a este ritmo/);
  assert.equal(cs.limitGuard({ limits: [lim('five_hour', 60)], forecast: { five_hour: { willHit: true, eta: NOW + 90 * 60e3 } } }, 85, NOW).ok, true, 'lejos: sigue');
});

test('recurrentes: toca el día y la hora, una vez por día', () => {
  const r = { days: [1], time: '09:30', lastRun: '' };
  assert.equal(cs.isDue(r, new Date(NOW)), true);
  assert.equal(cs.isDue({ ...r, time: '11:00' }, new Date(NOW)), false, 'aún no es la hora');
  assert.equal(cs.isDue({ ...r, days: [2] }, new Date(NOW)), false, 'otro día');
  assert.equal(cs.isDue({ ...r, lastRun: '2026-10-05' }, new Date(NOW)), false, 'ya corrió hoy');
  assert.equal(cs.isDue({ ...r, paused: true }, new Date(NOW)), false);
});

test('modelo según la tarea: fácil → haiku, normal → sonnet, difícil → opus; baja con el presupuesto', () => {
  assert.equal(cs.classify('Añade tests al carrito'), 'tests');
  assert.equal(cs.classify('Arregla el crash al guardar'), 'bug');
  assert.equal(cs.classify('Refactoriza el módulo de pagos'), 'refactor');
  assert.equal(cs.classify('Actualiza el README'), 'docs');
  assert.equal(cs.classify('Agrega exportar a CSV'), 'feature');
  assert.equal(cs.classify('hola'), 'otro');
  assert.equal(cs.chooseModel('Corrige el typo del título').model, 'haiku');
  assert.equal(cs.chooseModel('Agrega exportar a CSV en reportes').model, 'sonnet');
  assert.equal(cs.chooseModel('Migra la base de datos a Postgres').model, 'opus');
  assert.equal(cs.chooseModel('x'.repeat(1600)).model, 'opus', 'petición muy larga');
  const low = cs.chooseModel('Migra la base de datos a Postgres', { budgetPct: 85 });
  assert.equal(low.model, 'sonnet');
  assert.match(low.why, /presupuesto al 85%/);
  assert.equal(cs.chooseModel('Corrige el typo', { budgetPct: 99 }).model, 'haiku', 'haiku no baja más');
});

test('qué funciona: tasa por tipo, coste, duración y consejos', () => {
  const t0 = NOW;
  const mk = (text, status, extra = {}) => ({ text, status, cost: 0.5, startedAt: t0, endedAt: t0 + 10 * 60e3, ...extra });
  const runs = [
    mk('Añade tests al carrito', 'pr', { prState: 'merged', model: 'sonnet' }),
    mk('Añade tests a pagos', 'accepted'),
    mk('Añade tests a login', 'pr'),
    mk('Refactoriza pagos', 'discarded'),
    mk('Refactoriza login', 'failed'),
    mk('Refactoriza carrito', 'empty'),
    mk('Arregla el CI', 'pushed', { kind: 'fix' }),
    mk('Algo', 'running'),
  ];
  const st = cs.stats(runs);
  assert.equal(st.total, 6, 'los arreglos y las que siguen en marcha no cuentan');
  const tests = st.rows.find((r) => r.kind === 'tests');
  assert.deepEqual({ n: tests.n, good: tests.good, merged: tests.merged, rate: tests.rate }, { n: 3, good: 3, merged: 1, rate: 1 });
  assert.equal(tests.avgCost, 0.5);
  assert.equal(tests.avgMins, 10);
  assert.deepEqual(tests.models, { sonnet: 1 });
  assert.equal(st.rows.find((r) => r.kind === 'refactor').rate, 0);
  assert.equal(st.tips.length, 2);
  assert.match(st.tips.join('\n'), /refactor solo salen bien el 0%/);
  assert.match(st.tips.join('\n'), /tests te funcionan muy bien/);
});

// ---------------- la cola con todo junto ----------------
function fakeM(settings = {}, usage = null, budgetPct = 0) {
  const said = [];
  const data = { settings: { ...settings }, days: {}, claudeQueue: [], claudeRuns: [] };
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-c4-'));
  const M = {
    store: { data, save() {}, flush() {} }, TEST: true, path, fs, app: { getPath: () => userData }, diag: { log() {} },
    say: (t) => said.push(t), broadcast() {}, sendPet() {}, repoByName: () => null, usage, said,
    plan: {
      budgetState: () => ({ pct: budgetPct }),
      queueAdd: (text, project, extra = {}) => data.claudeQueue.push({ id: 'q' + data.claudeQueue.length, text, project, model: extra.model || 'auto' }),
      queueRemove() {},
    },
  };
  return M;
}

test('cola: el guardián respeta tus ajustes y startRun avisa (o se fuerza)', async () => {
  const usage = { limits: [lim('five_hour', 92)] };
  const M = fakeM({}, usage);
  const q = require('../src/main/claudequeue')(M);
  assert.equal(q.guard().ok, false);
  M.store.data.claudeQueue.push({ id: 'a', text: 'Agrega CSV', project: 'app' });
  const r = await q.startRun('a');
  assert.equal(r.limit, true);
  assert.match(r.error, /Mejor esperar: tu sesión va al 92%/);
  const forced = await q.startRun('a', { force: true });
  assert.notEqual(forced.limit, true, 'forzada pasa el guardián (y luego falla por otra cosa)');
  M.store.data.settings.claudeLimitPct = 95;
  assert.equal(q.guard().ok, true, 'umbral más alto');
  M.store.data.settings.claudeLimitPct = 50;
  M.store.data.settings.claudeRespectLimits = false;
  assert.equal(q.guard().ok, true, 'apagado');
  const s = q.runsState().claudeRunner;
  assert.deepEqual({ r: s.respectLimits, p: s.limitPct, m: s.modelAuto }, { r: false, p: 50, m: true });
});

test('cola: modelo elegido por ti, automático o el de Claude Code', () => {
  const M = fakeM({}, null, 90);
  const q = require('../src/main/claudequeue')(M);
  assert.deepEqual(q.modelFor({ text: 'lo que sea', model: 'opus' }), { model: 'opus', why: 'lo elegiste tú' });
  assert.equal(q.modelFor({ text: 'Migra la base de datos', model: 'auto' }).model, 'sonnet', 'difícil, pero presupuesto al 90%');
  M.store.data.settings.claudeModelAuto = false;
  assert.equal(q.modelFor({ text: 'Migra la base de datos' }).model, '');
});

test('cola: recurrentes se guardan, se encolan una vez al día y se borran', () => {
  const M = fakeM();
  const q = require('../src/main/claudequeue')(M);
  assert.equal(q.recurringSave({ text: '', project: 'app', days: '1' }).ok, false);
  assert.equal(q.recurringSave({ text: 'Actualiza dependencias y abre PR', project: 'app', days: '1,2,3,4,5', time: '09:00', model: 'haiku' }).ok, true);
  const rec = M.store.data.claudeRecurring[0];
  assert.deepEqual({ days: rec.days, time: rec.time, model: rec.model, autoRun: rec.autoRun }, { days: [1, 2, 3, 4, 5], time: '09:00', model: 'haiku', autoRun: false });
  q.recurringTick(new Date(2026, 9, 5, 8, 0));
  assert.equal(M.store.data.claudeQueue.length, 0, 'aún no es la hora');
  q.recurringTick(new Date(2026, 9, 5, 9, 1));
  q.recurringTick(new Date(2026, 9, 5, 9, 2));
  assert.equal(M.store.data.claudeQueue.length, 1, 'una vez por día');
  assert.deepEqual(M.store.data.claudeQueue[0], { id: 'q0', text: 'Actualiza dependencias y abre PR', project: 'app', model: 'haiku' });
  assert.match(M.said.at(-1), /🔁 Toca: «Actualiza dependencias/);
  q.recurringTick(new Date(2026, 9, 10, 9, 5)); // sábado
  assert.equal(M.store.data.claudeQueue.length, 1, 'fin de semana no');
  q.recurringTick(new Date(2026, 9, 12, 9, 5));
  assert.equal(M.store.data.claudeQueue.length, 2, 'el lunes siguiente sí');
  assert.equal(q.runsState().claudeRecurring.length, 1);
  q.recurringDelete(rec.id);
  assert.equal(M.store.data.claudeRecurring.length, 0);
  assert.ok(M.store.data.tombstones[rec.id]);
});

test('diario de Claude: el contexto que pega el IDE no sale como si fuera tu petición', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cj-'));
  const proj = path.join(home, 'projects', 'x');
  fs.mkdirSync(proj, { recursive: true });
  const T = Date.now();
  const at = new Date(T).toISOString();
  const msg = (uuid, content) => JSON.stringify({ type: 'user', uuid, timestamp: at, cwd: path.join(home, 'web'), message: { role: 'user', content } });
  fs.writeFileSync(path.join(proj, 's.jsonl'), [
    msg('a', [{ type: 'text', text: '<ide_opened_file>The user opened the file c:\web\a.js in the IDE.</ide_opened_file>' }, { type: 'text', text: 'revisa el login y aplica el fix' }]),
    msg('b', '<ide_selection>const x = 1;</ide_selection>'),
    msg('c', 'agrega <b>negritas</b> al título'),
  ].join('\n'));
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = home;
  try {
    const out = require('../src/journal').prompts(T - 60e3, T + 60e3);
    assert.deepEqual(Object.values(out).flat().map((p) => p.text), ['revisa el login y aplica el fix', 'agrega <b>negritas</b> al título']);
  } finally { if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev; }
});

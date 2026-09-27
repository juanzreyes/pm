// Tests de la lógica del pollito (sin Electron): node --test
const test = require('node:test');
const assert = require('node:assert/strict');

const reminders = require('../src/reminders');
const { forecast } = require('../src/forecast');
const report = require('../src/report');
const focus = require('../src/focus');
const i18n = require('../src/i18n');
const backup = require('../src/backup');
const journal = require('../src/journal');
const extras = require('../src/extras');
const planner = require('../src/planner');
const devtools = require('../src/devtools');
const petlife = require('../src/petlife');

// Contexto falso mínimo para los módulos que lo necesitan.
function fakeCtx(data = {}) {
  const store = { data: { days: {}, settings: {}, alerts: {}, pet: { name: 'Kiwi', coins: 100, happiness: 50 }, ...data }, save() {} };
  const said = [];
  const today = () => {
    const d = new Date();
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return (store.data.days[k] = store.data.days[k] || {});
  };
  return {
    store, said, today,
    say: (t) => said.push(t), broadcast() {}, animate() {}, send() {}, addXp() {}, addTask(t) { const d = today(); d.standup = d.standup || { today: [] }; d.standup.today.push({ text: t, done: false }); },
    isMuted: () => false, getMeeting: () => null, isPresenting: () => false, aiAvailable: () => false,
    usage: () => ({ local: null }), meetingsToday: () => [], insights: () => [], clipboard: { writeText() {}, readText: () => '' },
    screen: { getAllDisplays: () => [{}] }, setBlocks(l) { today().blocks = l; }, saveGoal() {},
  };
}

// ---------------- recordatorios ----------------
test('recordatorio "en 20 min"', () => {
  const now = new Date(2026, 8, 28, 10, 0);
  const r = reminders.parse('recuérdame en 20 min llamar a Ana', now);
  assert.ok(r);
  assert.equal(r.at, now.getTime() + 20 * 60e3);
  assert.match(r.text, /llamar a Ana/i);
});
test('recordatorio "a las 3" es por la tarde si ya pasó la mañana', () => {
  const now = new Date(2026, 8, 28, 11, 0);
  const r = reminders.parse('recuérdame a las 3 revisar el informe', now);
  assert.ok(r);
  assert.equal(new Date(r.at).getHours(), 15);
});
test('texto sin prefijo no es recordatorio', () => {
  assert.equal(reminders.parse('comprar pan'), null);
});

// ---------------- predicción ----------------
test('predicción de consumo: ritmo y hora de llegada', () => {
  const now = Date.now();
  const resetsAt = new Date(now + 3 * 3600e3).toISOString();
  const r = Date.parse(resetsAt);
  const samples = [0, 10, 20, 30].map((m, i) => ({ t: now - (30 - m) * 60e3, u: 20 + i * 5, r }));
  const f = forecast(samples, { utilization: 35, resetsAt }, 90 * 60e3);
  assert.ok(f.rate > 25 && f.rate < 35, `ritmo ${f.rate}`);
  assert.equal(f.willHit, true);
});

// ---------------- informes ----------------
test('daily para Slack incluye ayer, hoy y bloqueos', () => {
  const t = report.daily({ standup: { yesterday: 'Terminé el login', today: [{ text: 'Tests', done: true }, { text: 'Deploy', done: false }], help: '' } }, new Date(), [], { claudeToday: ['[pm] tests'] });
  assert.match(t, /Terminé el login/);
  assert.match(t, /~Tests~ ✔/);
  assert.match(t, /Con Claude hoy/);
  assert.match(t, /Ninguno/);
});

// ---------------- vigilante ----------------
test('presentación: Teams compartiendo', () => {
  assert.equal(focus.presentingFrom({ tt: 'Barra de control de uso compartido', p: 'ms-teams' }), 'Compartiendo pantalla en Teams');
});
test('presentación: pantalla completa real', () => {
  assert.equal(focus.presentingFrom({ f: '0,0,1920,1080', p: 'chrome' }), 'Pantalla completa');
  assert.equal(focus.presentingFrom({ f: '', p: 'chrome' }), null);
});

// ---------------- traducción ----------------
test('i18n: frases exactas y patrones', () => {
  assert.equal(i18n.tr('📚 Biblioteca de prompts', 'en'), '📚 Prompt library');
  assert.match(i18n.tr('🐞 Copiaste un error: "TypeError: x". ¿Te ayudo?', 'en'), /You copied an error/);
  assert.equal(i18n.tr('Hola', 'es'), 'Hola');
});

// ---------------- copias ----------------
test('copia cifrada: se abre solo con la contraseña correcta y sin secretos', () => {
  const data = { pet: { name: 'Kiwi' }, settings: { aiKey: 'x', backupPass: 'y' }, days: {} };
  const env = backup.envelope(data, '1.0', 'clave');
  assert.ok(env.encrypted && !env.data);
  assert.ok(!JSON.stringify(env).includes('Kiwi'));
  const back = backup.open(JSON.parse(JSON.stringify(env)), 'clave');
  assert.equal(back.pet.name, 'Kiwi');
  assert.equal(back.settings.aiKey, undefined);
  assert.equal(back.settings.backupPass, undefined);
  assert.throws(() => backup.open(env, 'mala'), /PASSWORD/);
  assert.throws(() => backup.open({ app: 'otra' }), /NOT_PM/);
});

// ---------------- diario de Claude ----------------
test('resumen del diario: 3 peticiones por proyecto como mucho', () => {
  const s = journal.summarize({ pm: [1, 2, 3, 4, 5].map((i) => ({ at: i, text: 'petición ' + i })), web: [{ at: 1, text: 'hola' }] });
  assert.equal(s[0].project, 'pm');
  assert.equal(s[0].count, 5);
  assert.equal(s[0].items.length, 3);
});

// ---------------- recurrentes ----------------
test('tareas recurrentes en español e inglés', () => {
  const ex = extras.create(fakeCtx());
  assert.deepEqual(ex.parseRecurring('cada lunes: revisar métricas'), { days: [1], text: 'revisar métricas' });
  assert.deepEqual(ex.parseRecurring('cada lunes y jueves: 1:1 con Ana').days, [1, 4]);
  assert.deepEqual(ex.parseRecurring('todos los días: leer correo').days, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ex.parseRecurring('every friday: deploy').days, [5]);
  assert.equal(ex.parseRecurring('cada pepino: x'), null);
});

// ---------------- organización ----------------
test('días laborables entre fechas', () => {
  assert.equal(planner.workdaysBetween(new Date(2026, 8, 25), new Date(2026, 8, 28)), 1); // vie → lun
  assert.equal(planner.workdaysBetween(new Date(2026, 8, 21), new Date(2026, 8, 25)), 4);
});
test('priorizar: alta prioridad y lo urgente primero', () => {
  const ctx = fakeCtx();
  ctx.today().standup = { today: [{ text: 'Leer artículo', priority: 'l' }, { text: 'Arreglar bug urgente de pagos', priority: 'h' }, { text: 'Hecha', done: true }] };
  const p = planner.create(ctx);
  const order = p.heuristicOrder();
  assert.equal(order[0], 1);
  assert.equal(order[order.length - 1], 2);
});
test('cola para Claude: añadir y copiar la siguiente', () => {
  const ctx = fakeCtx();
  let copied = '';
  ctx.clipboard.writeText = (t) => { copied = t; };
  const p = planner.create(ctx);
  p.queueAdd('añade tests al login', 'pm');
  p.queueAdd('documenta la API', '');
  assert.equal(p.snapshot().claudeQueue.length, 2);
  p.queueNext('pm');
  assert.equal(copied, 'añade tests al login');
  assert.equal(p.snapshot().claudeQueue.length, 1);
});
test('hitos: estado según fecha', () => {
  const ctx = fakeCtx();
  const p = planner.create(ctx);
  const d = new Date(Date.now() - 864e5);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.ok(p.milestoneSave({ title: 'Demo', due: iso }));
  assert.equal(p.milestonesView()[0].status, 'late');
  assert.equal(p.milestoneSave({ title: 'Sin fecha', due: 'mañana' }), false);
});

// ---------------- programación ----------------
test('mensaje de commit sugerido', () => {
  const d = devtools.create(fakeCtx());
  assert.equal(d.heuristicMessage([{ st: 'M', file: 'README.md' }], 'main'), 'docs: actualiza README.md');
  assert.match(d.heuristicMessage([{ st: 'M', file: 'renderer/pet.css' }], 'x'), /^style\(renderer\):/);
  assert.match(d.heuristicMessage([{ st: 'M', file: 'src/a.js' }], 'fix/login'), /^fix:/);
});
test('revisión antes de push: detecta secretos y restos de depuración', () => {
  const hit = (line) => devtools.PUSH_CHECKS.find(([, re]) => re.test(line));
  assert.equal(hit('const k = "sk-ant-abcdefghijklmnopqrstuvwxyz"')[0], 'clave de API');
  assert.equal(hit('  console.log(user)')[0], 'console.log');
  assert.equal(hit('<<<<<<< HEAD')[0], 'marcas de conflicto de merge');
  assert.equal(hit('const total = a + b;'), undefined);
});
test('vigilante de builds: falla y luego se arregla', () => {
  const ctx = fakeCtx();
  const d = devtools.create(ctx);
  d.devEvent({ command: 'npm test', exitCode: 1, cwd: 'C:/x/pm', output: 'FAIL src/a.test.js\n  Expected 2 received 3' });
  assert.match(ctx.said[0], /Falló `npm test` en pm/);
  d.devEvent({ command: 'npm test', exitCode: 0, cwd: 'C:/x/pm' });
  assert.match(ctx.said[1], /Ya pasa/);
  d.devEvent({ command: 'ls -la', exitCode: 1, cwd: 'C:/x/pm' }); // no es un test/build
  assert.equal(ctx.said.length, 2);
});

// ---------------- mascota ----------------
test('huevos: cada 4 pomodoros uno, y eclosiona a los 3', () => {
  const ctx = fakeCtx();
  const pl = petlife.create(ctx);
  for (let i = 0; i < 4; i++) pl.onPomodoroDone();
  assert.equal(ctx.store.data.pet.eggs.length, 1);
  for (let i = 0; i < 3; i++) pl.onPomodoroDone();
  assert.equal(ctx.store.data.pet.eggs.length, 0);
  assert.equal(Object.values(ctx.store.data.pet.collection).reduce((a, b) => a + b, 0), 1);
});
test('casita: comprar muebles con maíz', () => {
  const ctx = fakeCtx();
  const pl = petlife.create(ctx);
  assert.equal(pl.buyHome('plant').ok, true);
  assert.equal(ctx.store.data.pet.coins, 40);
  assert.match(pl.buyHome('sofa').error, /Te faltan/);
  assert.match(pl.buyHome('trophy').error, /logros/);
});
test('personalidades: el sargento regaña a su manera', () => {
  const ctx = fakeCtx({ settings: { personality: 'sargento' } });
  const pl = petlife.create(ctx);
  assert.match(pl.scold('YouTube', 10, 1), /SOLDADO|NEGATIVO/);
  const ctx2 = fakeCtx();
  assert.equal(petlife.create(ctx2).scold('YouTube', 10, 1), null); // motivador: el regaño de siempre
});

test('modo música: cualquier app que suene hace bailar al pollito (y una pausa corta no lo corta)', () => {
  const ctx = fakeCtx();
  const sent = [];
  ctx.send = (ch, d) => sent.push([ch, d]);
  const pl = petlife.create(ctx);
  pl.onSample({ mu: 'IbaiExtra - YANDEL', ms: 'OperaSoftware.OperaGXWebBrowser.1719715200', t: 'Claude' });
  assert.deepEqual(sent.at(-1), ['pet:music', { app: 'Opera', title: 'IbaiExtra - YANDEL', heard: false }]); // sin oído: detección desactivada
  pl.onSample({ mu: '', ms: '', t: 'Claude' }); // cambio de canción: sigue bailando
  assert.equal(sent.length, 1);
  ctx.store.data.settings.musicMode = false;
  pl.onSample({ mu: 'Otra - Canción', ms: 'Spotify.exe', t: '' });
  assert.equal(pl.snapshot().music, null);
});

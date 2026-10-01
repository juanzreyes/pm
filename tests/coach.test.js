// Tests de la sección 3 de 2.0: productividad (plan, mejor hora, notas de reunión, pato,
// ¿dónde me quedé?, logros, atascado y ritual de cierre).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const lib = require('../src/coachlib');

const key = (d) => lib.keyOf(d);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return key(d); };

test('plan del día: tareas estimadas contra horas libres y reuniones', () => {
  const now = new Date(); now.setHours(9, 0, 0, 0);
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const meeting = (h1, h2) => ({ start: d0.getTime() + h1 * 3600e3, end: d0.getTime() + h2 * 3600e3 });
  const load = lib.planLoad({ tasks: [{ est: 120 }, { est: 180 }, {}, {}, { done: true, est: 600 }], meetings: [meeting(10, 11), meeting(14, 15.5)], morning: '08:00', evening: '17:00', now });
  assert.deepEqual({ planned: load.plannedMin, unknown: load.unknown, meetings: load.meetingsMin, free: load.availableMin }, { planned: 390, unknown: 2, meetings: 150, free: 330 });
  assert.ok(load.overload > 1.15, 'no cabe');
  const ok = lib.planLoad({ tasks: [{ est: 60 }], morning: '08:00', evening: '17:00', now });
  assert.ok(ok.overload < 1);
});

test('mejor franja, tarea más difícil y choques con bloques o reuniones', () => {
  const days = {};
  for (let i = 0; i < 5; i++) days[daysAgo(i)] = { hours: { 10: { w: 3000 }, 11: { w: 3000 }, 15: { w: 600 } } };
  assert.deepEqual(lib.bestWindow(days), { hour: 10, start: '10:00', end: '12:00' });
  assert.equal(lib.bestWindow({}), null, 'sin datos no inventa');
  assert.equal(lib.hardestTask([{ text: 'a', est: 30 }, { text: 'b', priority: 'h' }, { text: 'c', est: 240 }]), 1);
  assert.equal(lib.hardestTask([{ text: 'a', est: 30 }, { text: 'c', est: 240 }, { text: 'x', est: 999, done: true }]), 1);
  assert.equal(lib.overlaps('10:00', '12:00', [{ start: '11:30', end: '12:30' }]), true);
  assert.equal(lib.overlaps('10:00', '12:00', [{ start: '12:00', end: '13:00' }]), false);
});

test('notas de reunión → acciones con responsable (sin IA)', () => {
  const items = lib.extractActions('Ana: enviar el presupuesto el viernes\nYo reviso el PR del carrito\nHablamos del clima\nAcción: actualizar el tablero\n- @pedro sube el fix\n[10:32] Carlos se encarga de llamar al cliente', ['Juan']);
  assert.deepEqual(items.map((x) => [x.text, x.owner, x.mine]), [
    ['Enviar el presupuesto el viernes', 'Ana', false],
    ['Yo reviso el PR del carrito', '', true],
    ['Actualizar el tablero', '', true],
    ['@pedro sube el fix', 'pedro', false],
    ['Llamar al cliente', 'Carlos', false],
  ]);
});

test('¿dónde me quedé?: último día en el proyecto y resumen en pocas líneas', () => {
  const days = { [daysAgo(4)]: { projects: { tienda: 3600 } }, [daysAgo(1)]: { projects: { otro: 3600 } }, [daysAgo(0)]: { projects: { tienda: 100 } } };
  assert.deepEqual(lib.lastSeen(days, 'tienda'), { day: daysAgo(4), daysAgo: 4 });
  const lines = lib.resumeLines({ project: 'tienda', seen: { daysAgo: 4 }, branch: 'pm-12-carrito', commits: [{ subject: 'arregla el total', when: 'hace 4 días' }], prompts: ['añade tests al carrito'], tickets: [{ key: 'PM-12' }, { key: 'PM-15' }], note: 'tienda: falta el IVA' });
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^📍 Hace 4 días en la rama pm-12-carrito: tu último commit fue «arregla el total»/);
  assert.match(lines[2], /PM-12, PM-15/);
  assert.match(lib.resumeLines({ project: 'nuevo' })[0], /No tengo rastros/);
});

test('documento de logros: tareas, tickets, PRs, hitos y horas del periodo', () => {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  const data = { days: { [key(now)]: { standup: { today: [{ text: 'Revisar PR', done: true }, { text: '[PM-12] Carrito', done: true, issue: { key: 'PM-12' } }, { text: 'No hecha', done: false }] }, projects: { tienda: 7200, Reuniones: 3600 }, focus: { work: 10800 }, commits: 4, pomodoros: 2 } } };
  const doc = lib.bragDoc(data, from, to, { runs: [{ text: 'Arregla el IVA', pr: 'https://github.com/o/r/pull/3', prState: 'merged', endedAt: Date.now() }], milestones: [{ title: 'Lanzamiento', done: true, doneAt: Date.now() }], achievements: [{ emoji: '🔥', name: 'Racha', at: Date.now() }], name: 'Kiwi' });
  assert.deepEqual(doc.counts, { tasks: 1, tickets: 1, prs: 1, commits: 4, hours: 3 });
  for (const s of ['**tienda**: 2 h', 'PM-12 Carrito', 'Arregla el IVA — https://github.com/o/r/pull/3 ✅ mezclado', 'Lanzamiento', '🔥 Racha', '- Revisar PR']) assert.ok(doc.markdown.includes(s), s);
  assert.ok(!doc.markdown.includes('Reuniones'), 'las reuniones no son un proyecto');
  assert.ok(!doc.markdown.includes('No hecha'));
});

// ---------------- módulos del proceso principal ----------------
function fakeM(extra = {}) {
  const said = [];
  const chat = [];
  const data = { settings: { morningTime: '08:00', eveningTime: '17:00' }, days: {}, pet: { name: 'Kiwi', achievements: [] }, claudeRuns: [], ...extra };
  const key0 = key(new Date());
  const M = {
    store: { data, save() {}, flush() {} }, TEST: false, path, fs, os,
    say: (t, _a, _ms, o = {}) => said.push({ t, actions: (o.actions || []).map((a) => a.cmd) }), pushChat: (who, t) => chat.push([who, t]), broadcast() {}, openPanel() {}, sendPet() {}, diag: { log() {} },
    today: () => (data.days[key0] = data.days[key0] || {}), addXp() {}, aiAvailable: () => false, focusMode: () => false, meetingNow: null,
    todaysMeetings: () => [], ex: { setBlocks: (b) => { M.today().blocks = b; } }, plan: { queueAdd: (t, p) => data.queue = [{ t, p }] },
    setMute: (min) => { M.muted = min; }, repoByName: () => 'C:/repo', prod: { projectOf: (s) => s.proj }, addTask: (t) => (M.today().standup = M.today().standup || { today: [] }).today.push({ text: t }),
    said, chat,
  };
  return M;
}

test('pato de goma: preguntas guionadas sin IA y "listo" para salir', async () => {
  const M = fakeM();
  const coach = require('../src/main/coach')(M);
  coach.duckStart('carrito.js');
  assert.match(M.chat[0][1], /Modo pato de goma \(con carrito\.js\)[\s\S]*como si yo no supiera nada/);
  assert.equal(coach.duckActive(), true);
  assert.match(await coach.duckReply('quiero que el total sume el IVA'), /^🦆 ¿Qué esperabas que pasara/);
  assert.match(await coach.duckReply('esperaba 112 y sale 100'), /^🦆 ¿Qué es lo último que cambiaste/);
  assert.match(await coach.duckReply('listo, era el redondeo'), /Cuac/);
  assert.equal(coach.duckActive(), false);
});

test('atascado: 45 min en el mismo archivo sin commits ni tareas → te lo ofrece (una vez por hora)', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const M = fakeM();
  const coach = require('../src/main/coach')(M);
  const s = { proj: 'tienda', t: 'carrito.js - tienda - Visual Studio Code' };
  coach.onSample(s, 'work');
  for (let i = 0; i < 44 * 4; i++) { t.mock.timers.tick(15000); coach.onSample(s, 'work'); }
  assert.equal(M.said.length, 0, 'a los 44 min todavía no');
  for (let i = 0; i < 8; i++) { t.mock.timers.tick(15000); coach.onSample(s, 'work'); }
  assert.equal(M.said.length, 1);
  assert.match(M.said[0].t, /Llevas 45 min con «carrito\.js» en tienda/);
  assert.deepEqual(M.said[0].actions, ['duck.start', 'coach.stuck.claude', 'ack']);
  for (let i = 0; i < 20; i++) { t.mock.timers.tick(15000); coach.onSample(s, 'work'); }
  assert.equal(M.said.length, 1, 'no insiste');
  assert.equal(coach.stuckToClaude(), true);
  assert.match(M.store.data.queue[0].t, /Estoy atascado en «carrito\.js» del proyecto tienda/);
  // Cambiar de archivo o hacer un commit reinicia la cuenta.
  const n = M.said.length;
  M.today().commits = 1;
  coach.onSample(s, 'work');
  t.mock.timers.tick(15000);
  coach.onSample(s, 'work');
  assert.equal(M.said.length, n);
});

test('abogado del diablo y mejor hora al guardar el daily; reservar el bloque', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date(new Date().setHours(8, 30, 0, 0)).getTime() });
  const days = {};
  for (let i = 1; i < 6; i++) days[daysAgo(i)] = { hours: { 15: { w: 3500 }, 16: { w: 3500 } } };
  const M = fakeM({ days });
  M.today().standup = { today: [{ text: 'Migrar pagos', est: 300 }, { text: 'Revisar PR', est: 200 }, { text: 'Doc', est: 120 }] };
  const coach = require('../src/main/coach')(M);
  const load = coach.reviewPlan();
  assert.ok(load.overload > 1.15);
  t.mock.timers.tick(10000);
  assert.match(M.said[0].t, /Abogado del diablo: planeaste ~10\.3 h/);
  t.mock.timers.tick(30000);
  assert.match(M.said[1].t, /Tu mejor franja suele ser 15:00–17:00[\s\S]*Migrar pagos/);
  assert.equal(coach.reserveBlock(JSON.stringify({ start: '15:00', end: '17:00', task: 0 })), true);
  assert.deepEqual(M.today().blocks[0], { start: '15:00', end: '17:00', title: 'Migrar pagos', task: 0 });
});

test('ritual de cierre: pijama, propone cerrar y silencia hasta el daily de mañana', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(new Date().setHours(18, 10, 0, 0)).getTime() });
  const M = fakeM();
  const sent = [];
  M.sendPet = (ch, d) => sent.push([ch, d]);
  const coach = require('../src/main/coach')(M);
  coach.ritualTick();
  assert.deepEqual(sent[0], ['pet:pajamas', { on: true }]);
  assert.deepEqual(M.said[0].actions, ['ritual.close', 'ritual.snooze']);
  coach.ritualTick();
  assert.equal(M.said.length, 1, 'una vez');
  coach.ritualClose();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(8, 0, 0, 0);
  assert.equal(M.muted, Math.round((tomorrow.getTime() - Date.now()) / 60e3));
  assert.match(M.said.at(-1).t, /No te molesto hasta mañana a las 08:00/);
});

test('¿dónde me quedé?: con el repo real (rama y último commit tuyo)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-where-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  g('init', '-q', '-b', 'main'); g('config', 'user.name', 'Yo'); g('config', 'user.email', 'yo@example.com');
  fs.writeFileSync(path.join(dir, 'a.txt'), '1'); g('add', '-A'); g('commit', '-q', '-m', 'arregla el total del carrito');
  g('checkout', '-q', '-b', 'pm-12-carrito');
  const M = fakeM({ days: { [daysAgo(3)]: { projects: { tienda: 4000 }, notes: 'tienda: falta probar el IVA' } } });
  M.repoByName = () => dir;
  M.journalMod = { prompts: () => ({ tienda: [{ at: 1, text: 'añade tests al carrito' }] }) };
  M.work = { ticketsState: () => ({ issues: [] }) };
  const where = require('../src/main/whereami')(M);
  const r = await where.resume('tienda');
  assert.match(r.lines[0], /^📍 Hace 3 días en la rama pm-12-carrito: tu último commit fue «arregla el total del carrito»/);
  assert.match(r.lines.join('\n'), /añade tests al carrito[\s\S]*falta probar el IVA/);
  assert.deepEqual(where.saveContext('tienda', { links: 'https://jira.x/board\njavascript:alert(1)\nhttp://inseguro', music: 'spotify:playlist:abc', focus: 50 }).context, { links: ['https://jira.x/board'], music: 'spotify:playlist:abc', focus: 50 });
});

// 2.0 · 7/7 — Plugins: validación, permisos y procesos reales (el plugin de ejemplo, uno que pide
// de más y uno roto), con eventos, comandos de la paleta y almacenamiento propio.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const lib = require('../src/pluginlib');

const ROOT = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pm-plug-'));
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 40)); } return false; };

test('plugin.json: validación y permisos', () => {
  const dir = tmp();
  assert.equal(lib.parseManifest('{', dir).ok, false);
  assert.match(lib.parseManifest({ id: 'A B', name: 'x' }, dir).error, /"id"/);
  assert.match(lib.parseManifest({ id: 'bueno', name: 'x', main: '../../fuera.js' }, dir).error, /dentro de la carpeta/);
  assert.match(lib.parseManifest({ id: 'bueno', name: 'x', permissions: ['root'] }, dir).error, /desconocidos: root/);
  const ok = lib.parseManifest({ id: 'bueno', name: 'Bueno', permissions: ['say', 'say', 'tasks'] }, dir);
  assert.deepEqual(ok.plugin.permissions, ['say', 'tasks']);
  assert.equal(ok.plugin.main, path.join(dir, 'index.js'));
  assert.equal(lib.allowed(ok.plugin, 'task'), true);
  assert.equal(lib.allowed(ok.plugin, 'note'), false);
  assert.equal(lib.allowed(ok.plugin, 'inventado'), false);
  assert.equal(lib.describePerms(['say'])[0], lib.PERMS.say);
});

function fakeM(userData) {
  const said = [];
  const tasks = [];
  const logs = [];
  const today = {};
  const data = { settings: {}, days: {} };
  const M = {
    store: { data, save() {} }, fs, path, APP_DIR: ROOT, app: { getPath: () => userData }, shell: { openPath() {} },
    say: (t) => said.push(t), addTask: (t) => tasks.push(t), today: () => today, broadcast() {}, diag: { log: (_c, m) => logs.push(m) },
    extStatus: () => ({ name: 'Kiwi', session: { pct: 85 }, weekly: { pct: 20 }, tasks: { done: 1, total: 2 }, pomo: null }), focusMode: () => null,
    // En los tests, un child_process normal en vez del utilityProcess de Electron.
    spawnPluginHost: (host, args) => {
      const p = fork(host, args, { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      return { post: (m) => p.connected && p.send(m), onMessage: (fn) => p.on('message', fn), onExit: (fn) => p.on('exit', fn), kill: () => p.kill() };
    },
    said, tasks, logs, today,
  };
  M.plugins = require('../src/main/plugins')(M);
  return M;
}
function writePlugin(userData, id, manifest, code) {
  const d = path.join(userData, 'plugins', id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'plugin.json'), JSON.stringify({ id, name: id, ...manifest }));
  fs.writeFileSync(path.join(d, 'index.js'), code);
}

test('plugins de punta a punta: ejemplo, permisos, eventos, comandos, datos y fallos', async () => {
  const userData = tmp();
  const M = fakeM(userData);
  try {
    // El ejemplo se instala desde la app y arranca solo cuando lo activas.
    M.plugins.installExample();
    writePlugin(userData, 'pide-de-mas', { permissions: ['say'] }, "module.exports.activate = (pm) => { pm.addTask('tarea colada'); pm.addNote('nota colada'); pm.say('hola desde pide-de-mas'); };");
    writePlugin(userData, 'roto', { permissions: [] }, "throw new Error('me rompí al cargar');");
    writePlugin(userData, 'sin-json', {}, '');
    fs.unlinkSync(path.join(userData, 'plugins', 'sin-json', 'plugin.json'));
    M.plugins.start();
    assert.equal(Object.keys(M.plugins.running).length, 0, 'nada arranca sin tu permiso');
    const st = M.plugins.pluginsState();
    assert.deepEqual(st.list.map((p) => [p.id, p.ok]).sort(), [['hola-pollito', true], ['pide-de-mas', true], ['roto', true], ['sin-json', false]]);
    assert.ok(st.list.find((p) => p.id === 'hola-pollito').perms.some((x) => /Hablar por el pollito/.test(x)));

    assert.equal(M.plugins.setEnabled('hola-pollito', true).ok, true);
    assert.equal(M.store.data.settings.plugins['hola-pollito'], true);
    assert.ok(await until(() => M.plugins.running['hola-pollito'] && M.plugins.running['hola-pollito'].ready), 'el ejemplo arrancó');
    assert.ok(await until(() => M.plugins.paletteCommands().length === 1));
    const cmd = M.plugins.paletteCommands()[0];
    assert.deepEqual({ id: cmd.id, arg: cmd.arg }, { id: 'plugin.run', arg: 'hola-pollito:frase' });
    assert.match(cmd.label, /Una frase para arrancar · Hola, pollito/);
    assert.equal(M.plugins.runCommand(cmd.arg), true);
    assert.ok(await until(() => M.said.some((s) => /^🧩 /.test(s))), 'el comando habla por el pollito');
    // Eventos: 5 tareas hechas → celebra (y el contador queda guardado en su archivo).
    const n0 = M.said.length;
    await new Promise((r) => setTimeout(r, 10100)); // respeta el límite de una burbuja cada 10 s
    for (let i = 0; i < 5; i++) M.plugins.emit('task:done', { text: 't' + i, all: false });
    assert.ok(await until(() => M.said.slice(n0).some((s) => /Llevas 5 tareas/.test(s))), 'celebró la 5.ª tarea');
    assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'plugins-data', 'hola-pollito.json'), 'utf8')).tareas, 5);
    assert.equal(M.plugins.runCommand('hola-pollito:no-existe'), false);

    // El que pide de más: su burbuja sale, la tarea y la nota no.
    M.plugins.setEnabled('pide-de-mas', true);
    assert.ok(await until(() => M.said.some((s) => /hola desde pide-de-mas/.test(s))));
    assert.ok(await until(() => M.logs.some((l) => /pide-de-mas: sin permiso para "task"/.test(l)) && M.logs.some((l) => /sin permiso para "note"/.test(l))));
    assert.deepEqual(M.tasks, []);
    assert.equal(M.today.notes, undefined);

    // El roto: se registra el error y se detiene, sin tumbar a los demás.
    M.plugins.setEnabled('roto', true);
    assert.ok(await until(() => !M.plugins.running.roto && M.logs.some((l) => /roto: .*me rompí al cargar/.test(l))));
    assert.ok(M.plugins.running['hola-pollito'], 'los demás siguen');

    // Desactivar lo para.
    M.plugins.setEnabled('hola-pollito', false);
    assert.equal(M.plugins.running['hola-pollito'], undefined);
    assert.equal(M.plugins.paletteCommands().some((c) => /hola-pollito/.test(c.arg)), false);
  } finally {
    M.plugins.stopAll();
  }
});

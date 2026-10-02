// 2.0 · 7/7 — Plataforma: servidor de la extensión del navegador, su lógica, rutas de la
// Microsoft Store y el vigilante de foco de Linux.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const hooks = require('../src/claudeHooks');
const ext = require('../extensions/browser/lib');
const sp = require('../src/storepaths');
const focus = require('../src/focus');

function serve(api) {
  return new Promise((ok) => {
    const s = hooks.startServer(() => {}, { port: 0, ...api });
    s.on('listening', () => ok({ s, port: s.address().port }));
  });
}
async function req(port, p, { method = 'GET', headers = {}, body } = {}) {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = null;
  try { j = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, j, headers: r.headers };
}

test('servidor /browser: código de emparejamiento y solo orígenes de extensión', async () => {
  const calls = [];
  const browser = {
    token: () => 'secreto', seen: () => calls.push('seen'),
    status: () => ({ ok: true, name: 'Kiwi', session: { pct: 42 } }),
    capture: (d) => { calls.push(['capture', d]); return { ok: true }; },
    focus: (d) => { calls.push(['focus', d]); return { ok: true }; },
    blocked: (d) => { calls.push(['blocked', d]); return { ok: true }; },
  };
  const { s, port } = await serve({ browser });
  try {
    const auth = { Authorization: 'Bearer secreto' };
    const extO = { Origin: 'chrome-extension://abcdefghijklmnop' };
    assert.equal((await req(port, '/browser/status')).status, 401, 'sin código');
    assert.equal((await req(port, '/browser/status', { headers: { Authorization: 'Bearer otro' } })).status, 401, 'código malo');
    assert.equal((await req(port, '/browser/status', { headers: { ...auth, Origin: 'https://evil.example' } })).status, 401, 'una web no pasa aunque tuviera el código');
    const ok = await req(port, '/browser/status', { headers: { ...auth, ...extO } });
    assert.equal(ok.status, 200);
    assert.equal(ok.j.session.pct, 42);
    assert.equal(ok.headers.get('access-control-allow-origin'), extO.Origin);
    const pre = await fetch(`http://127.0.0.1:${port}/browser/capture`, { method: 'OPTIONS', headers: extO });
    assert.equal(pre.status, 204, 'preflight de la extensión');
    assert.equal((await req(port, '/browser/capture', { method: 'POST', headers: { ...auth, ...extO, 'Content-Type': 'application/json' }, body: { text: 'Leer RFC', kind: 'task' } })).status, 200);
    assert.equal((await req(port, '/browser/nada', { method: 'POST', headers: auth, body: {} })).status, 404);
    assert.deepEqual(calls.filter((c) => c !== 'seen'), [['capture', { text: 'Leer RFC', kind: 'task' }]]);
    // Las rutas viejas (VS Code) siguen exigiendo X-PM y sin Origin.
    assert.equal((await req(port, '/status', { headers: { 'X-PM': '1', ...extO } })).status, 403);
    // Sin código configurado, nadie entra.
    assert.equal(hooks.browserAuth({ authorization: 'Bearer ' }, ''), false);
  } finally { s.close(); }
});

test('extensión: reglas de bloqueo, insignia y llamadas a PM', async () => {
  const rules = ext.rulesFor(['youtube.com', 'mal sitio', 'x.com'], 'chrome-extension://id/blocked.html');
  assert.equal(rules.length, 2);
  assert.deepEqual(rules.map((r) => r.id), [1, 2]);
  const re = new RegExp(rules[0].condition.regexFilter);
  assert.equal(re.test('https://www.youtube.com/watch?v=1'), true);
  assert.equal(re.test('https://youtube.com'), true);
  assert.equal(re.test('https://notyoutube.com/'), false, 'no frena dominios parecidos');
  assert.equal(re.test('https://youtube.com.evil.io/'), false);
  assert.equal(rules[0].action.redirect.regexSubstitution, 'chrome-extension://id/blocked.html#\\0');
  assert.deepEqual(ext.badge({ session: { pct: 92 } }), { text: '92%', color: '#e5484d' });
  assert.equal(ext.badge({ focus: { until: 1 }, session: { pct: 10 } }).text, 'foco');
  assert.equal(ext.hostOf('https://www.reddit.com/r/x'), 'reddit.com');
  const seen = [];
  const fakeFetch = async (url, o) => { seen.push([url, o.method, o.headers.Authorization]); return { ok: true, status: 200, json: async () => ({ ok: true, name: 'Kiwi' }) }; };
  assert.equal((await ext.call('T', '/browser/status', null, { port: 5000, fetchFn: fakeFetch })).name, 'Kiwi');
  assert.deepEqual(seen[0], ['http://127.0.0.1:5000/browser/status', 'GET', 'Bearer T']);
  await assert.rejects(ext.call('T', '/x', null, { fetchFn: async () => { throw new Error('ECONNREFUSED'); } }), /PM no está abierto/);
  await assert.rejects(ext.call('T', '/x', null, { fetchFn: async () => ({ ok: false, status: 401, json: async () => ({}) }) }), /Código incorrecto/);
});

test('módulo de la extensión en PM: capturas, foco y sitios', () => {
  const said = [];
  const data = { settings: {}, days: {} };
  const today = (data.days.hoy = {});
  const tasks = [];
  const M = {
    store: { data, save() {} }, broadcast() {}, say: (t) => said.push(t), today: () => today, app: { getVersion: () => '2.0.0' }, APP_DIR: 'C:/pm', path,
    prod: { capture: (t) => { tasks.push(t); return '📌 ok'; } }, extStatus: () => ({ name: 'Kiwi' }), focusMode: () => null,
    startFocus: (m) => { data.focusUntil = Date.now() + m * 60e3; }, endFocus: () => { data.focusUntil = 0; },
  };
  const b = require('../src/main/browserext')(M);
  const t1 = b.api.token();
  assert.match(t1, /^[0-9a-f]{32}$/);
  assert.equal(b.api.token(), t1, 'estable');
  assert.notEqual(b.regenerate(), t1);
  assert.equal(b.api.capture({ title: 'RFC 9110', url: 'https://www.rfc-editor.org/rfc/rfc9110', kind: 'task' }).ok, true);
  assert.deepEqual(tasks, ['RFC 9110 https://www.rfc-editor.org/rfc/rfc9110']);
  b.api.capture({ text: 'idea', url: 'javascript:alert(1)', kind: 'note' });
  assert.equal(today.notes, '🌐 idea', 'las URLs raras no se guardan');
  assert.equal(b.api.capture({}).ok, false);
  b.api.focus({ minutes: 999 });
  assert.ok(data.focusUntil - Date.now() <= 180 * 60e3 + 1000, 'máximo 3 h');
  b.api.blocked({ host: 'https://www.youtube.com/watch' });
  b.api.blocked({ host: 'youtube.com' });
  assert.deepEqual(today.blocked, { 'youtube.com': 2 });
  assert.equal(said.filter((s) => /Te frené youtube.com/.test(s)).length, 1, 'regaña como mucho cada 10 min');
  assert.deepEqual(b.saveSites('www.Netflix.com, foo, https://slack.com/x'), ['netflix.com', 'slack.com']);
  assert.deepEqual(b.api.status().blockSites, ['netflix.com', 'slack.com']);
  data.settings.focusBlock = false;
  assert.deepEqual(b.api.status().blockSites, []);
});

test('Microsoft Store: CLI y MCP apuntan a rutas estables', () => {
  const base = { home: 'C:\\Users\\ana', localAppData: 'C:\\Users\\ana\\AppData\\Local', appDir: 'C:\\Program Files\\WindowsApps\\PM_2.0.0_x64__abc\\app\\resources\\app.asar', execPath: 'C:\\Program Files\\WindowsApps\\PM_2.0.0_x64__abc\\app\\PM Pollito.exe' };
  const normal = sp.paths({ ...base, store: false });
  assert.equal(normal.exe, base.execPath);
  assert.match(normal.cli.script, /app\.asar\.unpacked\\cli\\pm\.js$/);
  assert.match(normal.cli.file, /WindowsApps\\pm\.cmd$/);
  const store = sp.paths({ ...base, store: true });
  assert.equal(store.exe, 'C:\\Users\\ana\\AppData\\Local\\Microsoft\\WindowsApps\\pm-pollito.exe');
  assert.equal(store.cli.dir, path.join('C:\\Users\\ana', '.pm-pollito', 'bin'));
  assert.equal(store.cli.onPath, false);
  assert.equal(store.copies.length, 2);
  assert.ok(store.copies.every(([from]) => from.includes('app.asar.unpacked')));
  assert.equal(JSON.stringify(store).includes('_2.0.0_'), true, 'solo el origen de las copias lleva la versión');
  assert.equal([store.exe, store.bridge, store.cli.file, store.cli.script].some((p) => p.includes('2.0.0')), false, 'lo que usan Claude y la terminal no cambia al actualizar');
  assert.match(sp.cliCmd(store.exe, store.cli.script), /set ELECTRON_RUN_AS_NODE=1\r\n"C:\\Users\\ana\\AppData\\Local\\Microsoft\\WindowsApps\\pm-pollito\.exe" ".+pm\.js" %\*/);
  assert.match(sp.pathCommand(store.cli.dir), /SetEnvironmentVariable\('Path'.+\.pm-pollito\\bin', 'User'\)/);
  const pkg = require('../package.json');
  assert.equal(pkg.build.appx.customExtensionsPath, 'build/appx-extensions.xml');
  assert.match(require('fs').readFileSync(path.join(__dirname, '..', 'build', 'appx-extensions.xml'), 'utf8'), /Alias="pm-pollito\.exe"/);
});

test('Linux: la salida de xdotool se convierte en una muestra de foco', () => {
  assert.deepEqual(focus.parseLinux('code\nmain.js - pm - Visual Studio Code\n125000\n'), { t: 'main.js - pm - Visual Studio Code', p: 'code', i: 125, m: '', tt: '', f: '', mu: '' });
  assert.equal(focus.parseLinux('\n\n0\n'), null);
  assert.equal(focus.parseLinux(''), null);
});

test('soltar sobre el pollito o el panel: enlace, texto y archivos', () => {
  const tasks = [];
  const said = [];
  const today = {};
  const M = {
    store: { data: { settings: {}, days: {} }, save() {} }, broadcast() {}, say: (t) => said.push(t), today: () => today, app: { getVersion: () => '2' }, APP_DIR: 'C:/pm', path,
    prod: { capture: (t) => { tasks.push(t); return '📌 ok'; } }, addTask: (t) => tasks.push(t), extStatus: () => ({}), focusMode: () => null,
  };
  const b = require('../src/main/browserext')(M);
  assert.equal(b.drop({ url: 'https://www.example.com/docs/guia/' }).ok, true);
  assert.equal(b.drop({ text: 'https://x.dev/a', url: '' }).ok, true, 'un enlace como texto también');
  assert.equal(b.drop({ url: 'https://ex.com/p', text: 'Guía de estilo' }).ok, true);
  assert.equal(b.drop({ text: 'Llamar a soporte' }).ok, true);
  assert.equal(b.drop({ url: 'javascript:alert(1)' }).ok, false, 'nada raro');
  assert.deepEqual(tasks, ['Revisar example.com/docs/guia https://www.example.com/docs/guia/', 'Revisar x.dev/a https://x.dev/a', 'Guía de estilo https://ex.com/p', 'Llamar a soporte']);
  const r = b.drop({ files: [{ name: 'informe.pdf', path: 'C:\Users\ana\informe.pdf' }, { name: 'x.png', path: '' }] });
  assert.deepEqual(r, { ok: true, kind: 'files', n: 2 });
  assert.deepEqual(tasks.slice(-2), ['📎 Revisar informe.pdf', '📎 Revisar x.png']);
  assert.equal(today.notes, '📎 C:\Users\ana\informe.pdf');
});

// Tests de 1.8: informe de errores (limpieza de datos), Claude en vivo, segunda opinión,
// arreglos subidos a la rama del PR y el vigilante de PRs (CI y revisión).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const er = require('../src/errreport');
const runner = require('../src/claudeRunner');
const prwatch = require('../src/prwatch');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pm-v18-'));
function fakeHttp(routes) {
  const calls = [];
  const http = async (url, opts = {}) => {
    calls.push({ url, headers: opts.headers || {} });
    const r = routes.find(([re]) => re.test(url));
    if (!r) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    const body = r[1](url);
    return { ok: true, status: 200, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  http.calls = calls;
  return http;
}
function gitRepo(name = '') {
  const dir = name ? path.join(tmp(), name) : tmp();
  if (name) fs.mkdirSync(dir);
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' }).toString();
  g('init', '-q', '-b', 'main'); g('config', 'user.name', 'Test'); g('config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(dir, 'README.md'), '# app\n');
  g('add', '-A'); g('commit', '-q', '-m', 'inicio');
  return { dir, g };
}
/** "claude" falso con salida stream-json: usa herramientas, edita un archivo y termina. */
function streamClaude({ edit = 'HECHO.md', review = 'VEREDICTO: OK' } = {}) {
  const f = path.join(tmp(), 'claude.js');
  fs.writeFileSync(f, `
    let p = ''; process.stdin.on('data', (d) => (p += d)); process.stdin.on('end', () => {
      const out = (o) => console.log(JSON.stringify(o));
      const args = process.argv.slice(2).join(' ');
      if (/VEREDICTO/.test(p)) { out({ type: 'result', is_error: false, result: ${JSON.stringify(review)} + '\\nargs: ' + args + '\\ndiff-ok: ' + /HECHO/.test(p), total_cost_usd: 0.02 }); return; }
      out({ type: 'system', subtype: 'init', model: 'x' });
      out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Voy' }, { type: 'tool_use', name: 'Read', input: { file_path: 'C:/repo/src/a.js' } }] } });
      out({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } });
      out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/cart.js' } }] } });
      ${edit ? `require('fs').writeFileSync(${JSON.stringify(edit)}, 'petición: ' + p);` : ''}
      out({ type: 'result', subtype: 'success', is_error: false, result: 'Listo', total_cost_usd: 0.1, num_turns: 4, session_id: 's1' });
    });`);
  return f;
}

// ---------------- informe de errores ----------------
test('informe de errores: quita rutas, correos, tokens, parámetros y secretos', () => {
  const home = 'C:\\Users\\juan.linares';
  const raw = [
    'Error: ENOENT C:\\Users\\juan.linares\\AppData\\Roaming\\pm-pollito\\x.json',
    'at C:\\Users\\otra.persona\\app\\main.js:10',
    'correo ana@empresa.com falló',
    'token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 y sk-ant-api03-abcdefghijk y Bearer eyJhbGciOiJIUzI1NiJ9.abc',
    'fetch https://api.github.com/repos/o/r?access_token=SECRETO falló',
    'clave AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
    'telegram 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    'el usuario juan.linares',
  ].join('\n');
  const s = er.scrub(raw, { home, user: 'juan.linares' });
  for (const leak of ['juan.linares', 'otra.persona', 'ana@empresa.com', 'ghp_ABC', 'sk-ant-api03', 'eyJhbGci', 'SECRETO', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'AAHdqTcv']) {
    assert.ok(!s.includes(leak), `se coló "${leak}":\n${s}`);
  }
  assert.match(s, /ENOENT ~\\AppData/);
  assert.match(s, /https:\/\/api\.github\.com\/repos\/o\/r\?…/);
});

test('informe de errores: sin repetir el mismo fallo y con tope por envío', () => {
  const errs = [
    { at: 1, where: 'main', msg: 'TypeError: x is undefined at line 10' },
    { at: 2, where: 'main', msg: 'TypeError: x is undefined at line 99' }, // mismo fallo, otra línea
    { at: 3, where: 'panel', msg: 'Otra cosa' },
    { at: 4, where: 'info', msg: 'Cerrado por el usuario' }, // los eventos no se envían nunca
  ];
  const p = er.pending(errs, {});
  assert.deepEqual(p.map((e) => e.where), ['main', 'panel']);
  assert.deepEqual(er.pending(errs, { [p[0].fp]: Date.now() }).map((e) => e.where), ['panel']);
  assert.equal(er.pending(errs, {}, 1).length, 1);
  const m = er.message(p, { version: '1.8.0', os: 'Windows_NT 10', electron: '33', install: 'ab12' }, { home: 'C:\\Users\\yo' });
  assert.match(m.title, /PM Pollito 1\.8\.0/);
  assert.match(m.text, /2 errores nuevos[\s\S]*\[main\] TypeError[\s\S]*\[panel\] Otra cosa/);
});

// ---------------- Claude en vivo ----------------
test('en vivo: stream-json con --verbose y cada herramienta como paso', async () => {
  const { dir } = gitRepo();
  const steps = [];
  const r = await runner.launch({ bin: streamClaude(), cwd: dir, prompt: 'haz algo', onProgress: (p) => steps.push(p) }).promise;
  assert.equal(r.ok, true, r.error);
  assert.deepEqual({ result: r.result, cost: r.cost, steps: r.steps }, { result: 'Listo', cost: 0.1, steps: 2 });
  assert.deepEqual(steps.map((s) => `${s.icon} ${s.what} ${s.target} #${s.steps}`), ['👀 Leyendo src/a.js #1', '✏️ Editando src/cart.js #2']);
  assert.match(fs.readFileSync(path.join(dir, 'HECHO.md'), 'utf8'), /haz algo/);
});

test('en vivo: descripción de cada herramienta', () => {
  assert.deepEqual(runner.describeTool('Bash', { command: 'npm test -- --watch\notra' }), { icon: '⌨️', what: 'Ejecutando', target: 'npm test -- --watch' });
  assert.deepEqual(runner.describeTool('Grep', { pattern: 'TODO' }), { icon: '🔎', what: 'Buscando', target: 'TODO' });
  assert.deepEqual(runner.describeTool('Write', { file_path: 'C:\\a\\b\\c.txt' }), { icon: '✏️', what: 'Editando', target: 'b/c.txt' });
  assert.equal(runner.describeTool('Rara').what, 'Rara');
});

// ---------------- segunda opinión ----------------
test('segunda opinión: solo lectura (dontAsk), con el diff y el veredicto', async () => {
  const { dir } = gitRepo();
  fs.writeFileSync(path.join(dir, 'HECHO.md'), 'nuevo');
  const ok = await runner.review({ bin: streamClaude(), cwd: dir, request: 'crea HECHO.md', budgetUsd: 0.5 });
  assert.equal(ok.verdict, 'ok');
  assert.match(ok.text, /--output-format stream-json --verbose --permission-mode dontAsk/);
  assert.match(ok.text, /--max-budget-usd 0\.5/);
  assert.match(ok.text, /diff-ok: true/, 'el diff llega a la revisión');
  const bad = await runner.review({ bin: streamClaude({ review: 'VEREDICTO: REVISAR\n- HECHO.md:1 falta el título' }), cwd: dir, request: 'x' });
  assert.equal(bad.verdict, 'revisar');
  assert.match(bad.text, /^- HECHO\.md:1 falta el título/);
  const { dir: vacio } = gitRepo();
  assert.equal(await runner.review({ bin: streamClaude(), cwd: vacio, request: 'x' }), null, 'sin cambios no hay nada que revisar');
});

// ---------------- arreglos sobre la rama del PR ----------------
test('arreglo: nueva copia sobre la rama del PR, commit y push, sin borrar la rama', async () => {
  const remote = tmp();
  execFileSync('git', ['init', '-q', '--bare', remote]);
  const { dir, g } = gitRepo();
  g('remote', 'add', 'origin', remote);
  g('push', '-q', '-u', 'origin', 'main');
  g('checkout', '-q', '-b', 'pm/claude-x1');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'v1');
  g('add', '-A'); g('commit', '-q', '-m', 'primer intento');
  g('push', '-q', '-u', 'origin', 'pm/claude-x1');
  g('checkout', '-q', 'main');
  const fix = await runner.prepareOn(dir, 'pm/claude-x1', 'fix1', tmp());
  assert.equal(fs.readFileSync(path.join(fix.dir, 'a.txt'), 'utf8'), 'v1');
  fs.writeFileSync(path.join(fix.dir, 'a.txt'), 'v2 arreglado');
  await runner.commitAndPush({ ...fix, repo: dir }, 'claude: arregla el CI');
  assert.equal(fs.existsSync(fix.dir), false, 'la copia se quita');
  assert.match(execFileSync('git', ['log', '--oneline', 'pm/claude-x1'], { cwd: remote }).toString(), /claude: arregla el CI[\s\S]*primer intento/);
  assert.match(g('branch', '--list', 'pm/claude-x1'), /pm\/claude-x1/, 'la rama del PR sigue');
});

// ---------------- vigilante de PRs ----------------
test('PR: CI fallido con su log, revisión con cambios y peticiones para Claude', async () => {
  const http = fakeHttp([
    [/pulls\/5$/, () => ({ state: 'open', merged: false, title: 'Arregla el carrito', head: { sha: 'abc' } })],
    [/commits\/abc\/check-runs/, () => ({ check_runs: [
      { id: 11, name: 'tests', status: 'completed', conclusion: 'failure', app: { slug: 'github-actions' }, output: { title: '1 falla' } },
      { id: 12, name: 'lint', status: 'completed', conclusion: 'success', app: { slug: 'github-actions' } },
    ] })],
    [/pulls\/5\/reviews/, () => [{ id: 7, state: 'CHANGES_REQUESTED', user: { login: 'pedro' }, body: 'Faltan tests' }, { id: 8, state: 'APPROVED', user: { login: 'ana' } }]],
    [/pulls\/5\/comments/, () => [{ pull_request_review_id: 7, path: 'src/cart.js', line: 12, body: 'Esto no maneja 0' }, { pull_request_review_id: 99, path: 'x', body: 'otro' }]],
    [/actions\/jobs\/11\/logs/, () => '2026-09-28T10:00:00.1234567Z npm test\n2026-09-28T10:00:01.0000000Z FAIL cart.test.js\n2026-09-28T10:00:01.5000000Z expected 0'],
  ]);
  const info = { owner: 'o', repo: 'r', number: 5, token: 't' };
  const st = await prwatch.status(info, http);
  assert.deepEqual({ state: st.state, sha: st.sha, total: st.checks.total, passed: st.checks.passed, failed: st.checks.failed.map((c) => c.name) }, { state: 'open', sha: 'abc', total: 2, passed: 1, failed: ['tests'] });
  assert.deepEqual(st.changesRequested, [{ id: 7, user: 'pedro', body: 'Faltan tests', comments: [{ path: 'src/cart.js', line: 12, body: 'Esto no maneja 0' }] }]);
  const log = await prwatch.failureLog(info, st.checks.failed[0], http);
  assert.equal(log, 'npm test\nFAIL cart.test.js\nexpected 0');
  assert.match(prwatch.ciPrompt({ title: 'Arregla el carrito' }, [{ name: 'tests', log }]), /CI falló[\s\S]*### tests[\s\S]*FAIL cart\.test\.js[\s\S]*no desactives/);
  assert.match(prwatch.reviewPrompt({ title: 'Arregla el carrito' }, st.changesRequested), /### pedro\nFaltan tests\n- src\/cart\.js:12: Esto no maneja 0/);
  assert.deepEqual(prwatch.parsePrUrl('https://github.com/o/r/pull/5'), { owner: 'o', repo: 'r', number: 5 });
  const merged = await prwatch.status(info, fakeHttp([[/pulls\/5$/, () => ({ state: 'closed', merged: true, head: { sha: 'z' } })]]));
  assert.equal(merged.state, 'merged');
});

// ---------------- la cola: decisiones tras el PR y arreglo de punta a punta ----------------
function fakeM(repos = {}, settings = {}) {
  const said = [];
  const data = { settings: { ...settings }, days: {}, claudeQueue: [], claudeRuns: [] };
  const userData = tmp();
  return {
    store: { data, save() {}, flush() {} }, TEST: true, path, fs, app: { getPath: () => userData }, diag: { log() {} },
    decrypt: (s) => s, say: (t, _a, _ms, o = {}) => said.push({ t, actions: (o.actions || []).map((a) => a.cmd + ':' + (a.arg || '')) }),
    broadcast() {}, sendPet() {}, openProject() {}, repoByName: (n) => repos[n] || null, plan: { queueRemove() {} }, said,
  };
}

test('cola: tras el PR decide según CI, revisión y ajustes', async () => {
  const M = fakeM({}, { claudeAutoFixCi: false });
  const q = require('../src/main/claudequeue')(M);
  const run = { id: 'r1', status: 'pr', pr: 'https://github.com/o/r/pull/5', project: 'app', text: 'Arregla el carrito', repo: 'x', branch: 'pm/claude-r1' };
  M.store.data.claudeRuns.push(run);
  const failed = { state: 'open', sha: 'a1', checks: { total: 2, pending: 0, passed: 1, failed: [{ id: 1, name: 'tests', summary: 'falla' }] }, changesRequested: [] };
  await q.onPrStatus(run, failed, {});
  assert.deepEqual(run.lastCi.names, ['tests']);
  assert.deepEqual(M.said.at(-1).actions, ['run.fix:r1:ci', 'open.url:https://github.com/o/r/pull/5'], 'sin arreglo automático: botón');
  const n = M.said.length;
  await q.onPrStatus(run, failed, {});
  assert.equal(M.said.length, n, 'el mismo commit no avisa dos veces');
  await q.onPrStatus(run, { state: 'open', sha: 'a2', checks: { total: 2, pending: 0, passed: 2, failed: [] }, changesRequested: [{ id: 7, user: 'pedro', body: 'x', comments: [] }] }, {});
  assert.match(M.said.at(-2).t, /✅ El CI pasa/);
  assert.match(M.said.at(-1).t, /pedro pidió cambios/);
  assert.equal(q.runsState().claudeRuns[0].canFixReview, true);
  await q.onPrStatus(run, { state: 'merged' }, {});
  assert.equal(run.prState, 'merged');
  assert.equal(q.fixRun('nada:ci').ok, false);
  assert.equal(q.runsState().claudeRunner.parallel, 2, 'dos a la vez por defecto');
});

test('cola: arreglo del CI de punta a punta (copia sobre la rama, Claude, push)', async () => {
  const remote = tmp();
  execFileSync('git', ['init', '-q', '--bare', remote]);
  const { dir, g } = gitRepo('app');
  g('remote', 'add', 'origin', remote);
  g('push', '-q', '-u', 'origin', 'main');
  g('branch', 'pm/claude-r2');
  g('push', '-q', 'origin', 'pm/claude-r2');
  const M = fakeM({ app: dir }, { claudeBin: streamClaude({ edit: 'ARREGLO.md' }), claudeRunTests: false });
  const q = require('../src/main/claudequeue')(M);
  const run = { id: 'r2', status: 'pr', prState: 'open', pr: 'https://github.com/o/r/pull/9', project: 'app', text: 'Arregla el carrito', repo: dir, branch: 'pm/claude-r2', lastCi: { logs: [{ name: 'tests', log: 'FAIL cart' }] }, ci: { failed: 1 } };
  M.store.data.claudeRuns.push(run);
  assert.equal(q.fixRun('r2:ci').ok, true);
  const end = Date.now() + 20000;
  let fix;
  while (Date.now() < end) {
    fix = M.store.data.claudeRuns.find((r) => r.kind === 'fix');
    if (fix && ['pushed', 'failed', 'empty'].includes(fix.status)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(fix.status, 'pushed', fix.error);
  assert.equal(run.fixes, 1);
  const log = execFileSync('git', ['log', '--format=%s', 'pm/claude-r2'], { cwd: remote }).toString();
  assert.match(log, /claude: arregla el CI/);
  const pushed = execFileSync('git', ['show', 'pm/claude-r2:ARREGLO.md'], { cwd: remote }).toString();
  assert.match(pushed, /El CI falló[\s\S]*FAIL cart/, 'Claude recibió el log del CI');
  assert.match(M.said.map((s) => s.t).join('\n'), /Subí un arreglo al PR de app/);
});

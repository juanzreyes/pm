// Tests de las mejoras 1.7: ticket → trabajo, PR + tests + tope en la cola de Claude,
// paquete de equipo y tiempo por ticket en el informe.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const trackers = require('../src/trackers');
const runner = require('../src/claudeRunner');
const teampack = require('../src/teampack');
const report = require('../src/report');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pm-team-'));
function fakeHttp(routes) {
  const calls = [];
  const http = async (url, opts = {}) => {
    const req = { url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null };
    calls.push(req);
    const r = routes.find(([re]) => re.test(`${req.method} ${url}`));
    if (!r) return { ok: false, status: 404, text: async () => 'not found', json: async () => ({}) };
    const res = r[1](req);
    const status = res && res.status ? res.status : 200;
    const body = res && res.status ? res.body : res;
    return { ok: status < 300, status, text: async () => JSON.stringify(body ?? {}), json: async () => body };
  };
  http.calls = calls;
  return http;
}
function gitRepo(files = {}, name = '') {
  const dir = name ? path.join(tmp(), name) : tmp();
  if (name) fs.mkdirSync(dir);
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' }).toString();
  g('init', '-q', '-b', 'main'); g('config', 'user.name', 'Test'); g('config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
  for (const [f, c] of Object.entries({ 'README.md': '# app\n', ...files })) fs.writeFileSync(path.join(dir, f), c);
  g('add', '-A'); g('commit', '-q', '-m', 'inicio');
  return { dir, g };
}

// ---------------- ticket → trabajo ----------------
test('tickets: descripción en texto plano de cada gestor', async () => {
  const adf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'El total no suma ' }, { type: 'text', text: 'IVA' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'paso 1' }] }] }] }] };
  const http = fakeHttp([
    [/rest\/api\/3\/issue\/PM-12\?fields=description/, () => ({ fields: { description: adf } })],
    [/api\.github\.com\/repos\/o\/app\/issues\/7$/, () => ({ body: 'Falla en **Safari**' })],
    [/_apis\/wit\/workitems\/42\?fields=System\.Description/, () => ({ fields: { 'System.Description': '<div>Pagos &amp; <b>facturas</b></div><ul><li>uno</li></ul>' } })],
  ]);
  const cfg = { jira: { site: 'https://e.atlassian.net', email: 'a@b.c', token: 't' }, github: { token: 'g' }, azure: { org: 'https://dev.azure.com/org', token: 'p' } };
  assert.equal(await trackers.details({ provider: 'jira', ref: { key: 'PM-12' } }, cfg, http), 'El total no suma IVA\n- paso 1');
  assert.equal(await trackers.details({ provider: 'github', ref: { repo: 'o/app', number: 7 } }, cfg, http), 'Falla en **Safari**');
  assert.equal(await trackers.details({ provider: 'azure', ref: { id: 42 } }, cfg, http), 'Pagos & facturas\n- uno');
});

test('tickets: pasar a "en curso" según el flujo de cada gestor', async () => {
  const http = fakeHttp([
    [/GET .*\/issue\/PM-12\/transitions$/, () => ({ transitions: [{ id: '5', name: 'Hecho', to: { name: 'Hecho', statusCategory: { key: 'done' } } }, { id: '21', name: 'Empezar', to: { name: 'En curso', statusCategory: { key: 'indeterminate' } } }] })],
    [/POST .*\/issue\/PM-12\/transitions$/, () => ({ status: 204 })],
    [/PATCH .*\/workitems\/42/, (r) => (r.body[0].value === 'In Progress' ? {} : { status: 400, body: { message: 'no existe' } })],
    [/api\.linear\.app/, (r) => (/issueUpdate/.test(r.body.query) ? { data: { issueUpdate: { success: true } } }
      : { data: { issue: { state: { type: 'unstarted' }, team: { states: { nodes: [{ id: 's3', name: 'In Review', type: 'started', position: 3 }, { id: 's2', name: 'In Progress', type: 'started', position: 2 }] } } } } })],
  ]);
  const cfg = { jira: { site: 'https://e.atlassian.net', email: 'a@b.c', token: 't' }, azure: { org: 'https://dev.azure.com/org', token: 'p' }, linear: { token: 'l' }, github: { token: 'g' } };
  assert.equal(await trackers.startProgress({ provider: 'jira', ref: { key: 'PM-12' } }, cfg, http), 'En curso');
  assert.deepEqual(http.calls.find((c) => c.method === 'POST').body, { transition: { id: '21' } });
  assert.equal(await trackers.startProgress({ provider: 'azure', ref: { id: 42 } }, cfg, http), 'In Progress'); // "Active" no existe en este proceso
  assert.equal(await trackers.startProgress({ provider: 'linear', ref: { id: 'L1' } }, cfg, http), 'In Progress');
  assert.equal(await trackers.startProgress({ provider: 'github', ref: {} }, cfg, http), null); // GitHub no tiene estados
});

test('tickets: nombre de rama legible y corto', () => {
  assert.equal(trackers.branchName({ provider: 'jira', key: 'PM-12', title: 'Informe de ventas por región' }), 'pm-12-informe-de-ventas-por-region');
  assert.equal(trackers.branchName({ provider: 'github', key: 'app#7', title: 'El login falla en Safari', ref: { number: 7 } }), 'issue-7-el-login-falla-en-safari');
  assert.ok(trackers.branchName({ provider: 'linear', key: 'ENG-4', title: 'x '.repeat(80) }).length <= 48);
});

// ---------------- cola de Claude: dependencias, tests, tope y PR ----------------
test('runner: node_modules se comparte con un enlace y descartar nunca borra el original', async () => {
  const { dir } = gitRepo({ 'package.json': '{"scripts":{"test":"node -e \\"require(\'dep\')\\""}}' });
  fs.mkdirSync(path.join(dir, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;');
  const wt = await runner.prepare(dir, 'dep1', tmp());
  assert.equal(wt.base, 'main');
  assert.ok(fs.existsSync(path.join(wt.dir, 'node_modules', 'dep', 'index.js')), 'la copia ve las dependencias');
  // Los tests corren en la copia usando las dependencias enlazadas.
  const t = await runner.runTests(wt.dir);
  assert.deepEqual({ ok: t.ok, label: t.label }, { ok: true, label: 'npm test' });
  fs.writeFileSync(path.join(wt.dir, 'nuevo.txt'), 'hola');
  assert.deepEqual((await runner.changes(wt.dir)).files, ['nuevo.txt'], 'el enlace no entra en los cambios');
  await runner.discard({ ...wt, repo: dir });
  assert.equal(fs.existsSync(wt.dir), false);
  assert.ok(fs.existsSync(path.join(dir, 'node_modules', 'dep', 'index.js')), '¡el node_modules original sigue ahí!');
});

test('runner: en un repo que no ignora node_modules, el enlace tampoco entra en el commit', async () => {
  const { dir, g } = gitRepo();
  fs.writeFileSync(path.join(dir, '.gitignore'), ''); // sin ignorar nada
  g('commit', '-q', '-am', 'sin gitignore');
  fs.mkdirSync(path.join(dir, 'node_modules', 'dep'), { recursive: true });
  const wt = await runner.prepare(dir, 'dep2', tmp());
  fs.writeFileSync(path.join(wt.dir, 'a.txt'), 'x');
  assert.deepEqual((await runner.changes(wt.dir)).files, ['a.txt']);
  const branch = await runner.accept({ ...wt, repo: dir, text: 'añade a' });
  assert.deepEqual(g('show', '--name-only', '--format=', branch).trim().split('\n'), ['a.txt']);
  assert.ok(fs.existsSync(path.join(dir, 'node_modules', 'dep')), 'el original sigue ahí');
});

test('runner: tests que fallan se reportan con el final de la salida', async () => {
  const { dir } = gitRepo({ 'package.json': '{"scripts":{"test":"node -e \\"console.log(\'2 failing\'); process.exit(1)\\""}}' });
  const t = await runner.runTests(dir);
  assert.equal(t.ok, false);
  assert.match(t.tail, /2 failing/);
  const sinTests = gitRepo();
  assert.equal(await runner.runTests(sinTests.dir), null);
  assert.equal(runner.detectTests(gitRepo({ 'go.mod': 'module x' }).dir).label, 'go test');
});

test('runner: el tope en dólares llega a Claude como --max-budget-usd', async () => {
  const { dir } = gitRepo();
  const bin = path.join(tmp(), 'claude.js');
  fs.writeFileSync(bin, "process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({ result: process.argv.slice(2).join(' '), total_cost_usd: 0 })));");
  const r = await runner.launch({ bin, cwd: dir, prompt: 'x', budgetUsd: 2.5 }).promise;
  assert.match(r.result, /--max-budget-usd 2\.5/);
  const r2 = await runner.launch({ bin, cwd: dir, prompt: 'x' }).promise;
  assert.doesNotMatch(r2.result, /max-budget/);
});

test('runner: sube la rama y abre el PR contra tu rama base', async () => {
  const remote = tmp();
  execFileSync('git', ['init', '-q', '--bare', remote]);
  const { dir, g } = gitRepo();
  g('remote', 'add', 'origin', remote);
  g('push', '-q', '-u', 'origin', 'main');
  const wt = await runner.prepare(dir, 'pr1', tmp());
  fs.writeFileSync(path.join(wt.dir, 'fix.txt'), 'arreglado');
  const branch = await runner.accept({ ...wt, repo: dir, text: 'arregla el bug' });
  await runner.pushBranch(dir, branch);
  assert.match(execFileSync('git', ['branch', '--list', branch], { cwd: remote }).toString(), /pm\/claude-pr1/);
  const http = fakeHttp([[/POST https:\/\/api\.github\.com\/repos\/juanzreyes\/pm\/pulls$/, () => ({ html_url: 'https://github.com/juanzreyes/pm/pull/5' })]]);
  const url = await runner.openPR({ ...runner.githubRepoOf('git@github.com:juanzreyes/pm.git'), token: 't', head: branch, base: wt.base, title: '[PM-12] Arregla', body: 'Hecho por Claude' }, http);
  assert.equal(url, 'https://github.com/juanzreyes/pm/pull/5');
  assert.deepEqual(http.calls[0].body, { title: '[PM-12] Arregla', head: 'pm/claude-pr1', base: 'main', body: 'Hecho por Claude', draft: false });
  const bad = fakeHttp([[/pulls$/, () => ({ status: 422, body: { message: 'Validation Failed', errors: [{ message: 'A pull request already exists' }] } })]]);
  await assert.rejects(runner.openPR({ owner: 'a', repo: 'b', token: 't', head: 'x', base: 'main', title: 't', body: '' }, bad), /already exists/);
  assert.equal(runner.githubRepoOf('https://gitlab.com/a/b.git'), null);
});

// ---------------- paquete de equipo ----------------
test('paquete de equipo: lleva lo común y nunca tokens personales', () => {
  const s = {
    trackers: { jira: { site: 'https://e.atlassian.net', email: 'yo@e.com', tokenEnc: 'SECRETO' }, github: { on: true }, azure: { org: 'https://dev.azure.com/e', tokenEnc: 'SECRETO2' } },
    teamWebhook: 'CIFRADO', teamDaily: '09:15', teamWeekly: true, teamCats: ['monitor'], morningTime: '08:30', githubToken: 'ghp_x', aiKey: 'sk-ant',
  };
  const p = teampack.build(s, { microsoft: { clientId: '11111111-2222-3333-4444-555555555555', tenant: 'e.onmicrosoft.com' } }, { name: 'Equipo Pagos' });
  const json = JSON.stringify(p);
  for (const secret of ['SECRETO', 'SECRETO2', 'CIFRADO', 'ghp_x', 'sk-ant', 'yo@e.com']) assert.ok(!json.includes(secret), `no debe llevar ${secret}`);
  assert.equal(p.team.webhook, undefined, 'el webhook solo si se pide');
  const conWebhook = teampack.build(s, {}, { webhook: 'https://hooks.slack.com/services/A/B/C' });
  assert.equal(conWebhook.team.webhook, 'https://hooks.slack.com/services/A/B/C');
  // Ida y vuelta.
  const back = teampack.parse(json);
  assert.deepEqual(back.trackers, { jira: { site: 'https://e.atlassian.net', cloud: true }, github: { on: true }, azure: { org: 'https://dev.azure.com/e' } });
  assert.equal(back.oauth.microsoft.tenant, 'e.onmicrosoft.com');
  assert.deepEqual(back.team, { daily: '09:15', weekly: true, cats: ['monitor'] });
  assert.deepEqual(back.routine, { morningTime: '08:30' });
  assert.match(teampack.todo(back).join('\n'), /Jira .* API token y tu correo[\s\S]*Azure DevOps[\s\S]*GitHub[\s\S]*Microsoft 365/);
});

test('paquete de equipo: rechaza archivos ajenos y limpia valores raros', () => {
  assert.throws(() => teampack.parse('no es json'), /JSON/);
  assert.throws(() => teampack.parse({ kind: 'otra-cosa' }), /no es una configuración/);
  const p = teampack.parse({ kind: 'pm-pollito-team', version: 1, trackers: { jira: { site: 'http://inseguro' } }, team: { webhook: 'javascript:alert(1)', daily: '9am', cats: ['monitor', 'borrar-todo'] }, oauth: { microsoft: { clientId: 'x' } } });
  assert.deepEqual(p.trackers, {});
  assert.deepEqual(p.team, { cats: ['monitor'] });
  assert.deepEqual(p.oauth, {});
});

// ---------------- proceso principal: ticket → trabajo e importar el paquete ----------------
/** Contexto M mínimo (lo que usan src/main/work.js y src/main/team.js). */
function fakeM(repos = {}) {
  const said = [];
  const data = { settings: {}, days: {}, claudeQueue: [] };
  const key = new Date().toISOString().slice(0, 10);
  const M = {
    store: { data, save() {}, flush() {} },
    TEST: true, path, fs, app: { getPath: () => tmp() }, shell: { openExternal() {} },
    diag: { log() {} }, encrypt: (s) => s, decrypt: (s) => s,
    say: (t) => said.push(t), animate() {}, broadcast() {}, sendPet() {}, openProject() {},
    today: () => (data.days[key] = data.days[key] || {}),
    taskTimer: (i) => { M.today().standup.today[i].startedAt = Date.now(); return true; },
    repoByName: (n) => repos[String(n).toLowerCase()] || null,
    plan: { queueAdd: (text, project, extra = {}) => { data.claudeQueue.push({ id: 'q' + data.claudeQueue.length, text, project, ...extra }); return true; }, queueRemove() {} },
    said,
  };
  return M;
}

test('ticket → trabajo: rama con su nombre, tarea con cronómetro y a la cola de Claude con la descripción', async (t) => {
  const { dir, g } = gitRepo({}, 'app');
  const M = fakeM({ app: dir });
  M.store.data.settings = { githubToken: 'tok', trackers: { github: { on: true } } };
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = fakeHttp([
    [/GET https:\/\/api\.github\.com\/issues\?/, () => [{ id: 1, number: 7, title: 'El login falla en Safari', html_url: 'https://github.com/o/app/issues/7', repository: { full_name: 'o/app' } }]],
    [/GET https:\/\/api\.github\.com\/repos\/o\/app\/issues\/7$/, () => ({ body: 'Pasos: abrir en Safari 17' })],
  ]);
  const work = require('../src/main/work')(M);
  await work.refreshTickets();
  assert.equal(work.ticketsState().issues.length, 1);
  const r = await work.startTicket('github:1');
  assert.equal(r.ok, true, r.error);
  assert.equal(g('rev-parse', '--abbrev-ref', 'HEAD').trim(), 'issue-7-el-login-falla-en-safari');
  const task = M.today().standup.today[0];
  assert.equal(task.text, '[app#7] El login falla en Safari');
  assert.ok(task.startedAt, 'cronómetro en marcha');
  assert.match(M.said.at(-1), /A por app#7/);
  // Otra vez: ya está en su rama y no duplica la tarea.
  assert.equal((await work.startTicket('github:1')).ok, true);
  assert.equal(M.today().standup.today.length, 1);
  const c = await work.ticketToClaude('github:1');
  assert.equal(c.ok, true);
  const q = M.store.data.claudeQueue[0];
  assert.equal(q.project, 'app');
  assert.equal(q.issue.key, 'app#7');
  assert.match(q.text, /Ticket app#7: El login falla en Safari[\s\S]*Pasos: abrir en Safari 17/);
});

test('ticket → trabajo: si PM no sabe el repo lo pregunta una vez y lo recuerda por proyecto', async (t) => {
  const { dir } = gitRepo({}, 'tienda');
  const M = fakeM({ tienda: dir });
  M.store.data.settings = { trackers: { jira: { site: 'https://e.atlassian.net', email: 'a@b.c', tokenEnc: 't' } } };
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = fakeHttp([
    [/search\/jql/, () => ({ issues: [{ id: '9', key: 'PAY-3', fields: { summary: 'Reembolsos', status: { name: 'Por hacer' }, project: { key: 'PAY' } } }] })],
    [/GET .*transitions/, () => ({ transitions: [] })],
  ]);
  const work = require('../src/main/work')(M);
  await work.refreshTickets();
  const first = await work.startTicket('jira:9');
  assert.deepEqual({ ok: first.ok, needRepo: first.needRepo }, { ok: false, needRepo: true });
  assert.equal((await work.startTicket('jira:9', 'tienda')).branch, 'pay-3-reembolsos');
  assert.equal(M.store.data.settings.ticketRepos['jira:PAY'], 'tienda');
  assert.equal((await work.ticketToClaude('jira:9')).ok, true, 'la segunda vez ya no pregunta');
});

test('importar el paquete de equipo: rellena lo común, no pisa lo tuyo y dice qué falta', async () => {
  const M = fakeM();
  const saved = {};
  M.store.data.settings = { morningTime: '07:45', eveningTime: '16:30', trackers: { jira: { site: 'https://vieja.atlassian.net', tokenEnc: 'MI-TOKEN' } } };
  M.saveOauthConfig = (p) => Object.assign(saved, p);
  M.remote = { save: async (p) => Object.assign(M.store.data.settings, p) };
  M.oauthConfig = () => ({});
  M.APP_DIR = tmp();
  const f = path.join(tmp(), 'pm-equipo.json');
  fs.writeFileSync(f, JSON.stringify({ kind: 'pm-pollito-team', version: 1, name: 'Pagos', trackers: { jira: { site: 'https://e.atlassian.net', cloud: true } },
    oauth: { microsoft: { clientId: '11111111-2222-3333-4444-555555555555' } }, team: { webhook: 'https://hooks.slack.com/services/A/B/C', daily: '09:15' }, routine: { morningTime: '08:30', eveningTime: '17:00' } }));
  const team = require('../src/main/team')(M);
  const r = await team.importPack(f);
  assert.equal(r.ok, true, r.error);
  const s = M.store.data.settings;
  assert.deepEqual(s.trackers.jira, { site: 'https://e.atlassian.net', tokenEnc: 'MI-TOKEN' }, 'cambia la URL y conserva tu token');
  assert.equal(saved.microsoft.clientId, '11111111-2222-3333-4444-555555555555');
  assert.equal(s.teamWebhook, 'https://hooks.slack.com/services/A/B/C');
  assert.equal(s.teamDaily, '09:15');
  assert.equal(s.morningTime, '07:45', 'tu hora de daily personalizada se respeta');
  assert.equal(s.eveningTime, '17:00', 'la de fábrica se cambia por la del equipo');
  assert.deepEqual(M.store.data.teamPack.name, 'Pagos');
  assert.match(r.todo.join(' | '), /Jira .*token[\s\S]*Microsoft/);
  const bad = path.join(tmp(), 'x.json');
  fs.writeFileSync(bad, '{"kind":"otra"}');
  assert.equal((await team.importPack(bad)).ok, false);
});

// ---------------- informe semanal ----------------
test('informe semanal: tiempo por ticket', () => {
  const d = new Date();
  const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const data = { days: { [k]: { standup: { today: [
    { text: '[PM-12] Informe de ventas', done: true, spent: 5400, issue: { provider: 'jira', key: 'PM-12' } },
    { text: '[PM-15] Migrar pagos', done: false, spent: 900, issue: { provider: 'jira', key: 'PM-15' } },
    { text: 'Tarea sin ticket', done: true, spent: 600 },
  ] } } } };
  const r = report.weekly(data, {});
  assert.match(r, /## 🎫 Tiempo por ticket\n- ✅ PM-12 Informe de ventas: 1 h 30 min\n- ⏳ PM-15 Migrar pagos: 15 min/);
  assert.doesNotMatch(r.split('## 🎫')[1].split('##')[0], /sin ticket/);
});

// ---------------- traducciones de 1.6 / 1.7 ----------------
test('traducciones: lo nuevo también en inglés, portugués y francés', () => {
  const I18N = require('../src/i18n');
  assert.equal(I18N.tr('🚀 Crear PR', 'en'), '🚀 Create PR');
  assert.equal(I18N.tr('  Avisos fuera del PC ', 'fr'), '  Alertes hors du PC ');
  assert.equal(I18N.tr('🎫 Mis tickets', 'pt'), '🎫 Meus tickets');
  assert.equal(I18N.tr('Guardar', 'en'), 'Save', 'lo que ya existía se sigue traduciendo igual');
  assert.equal(I18N.tr('Texto que nadie tradujo', 'en'), 'Texto que nadie tradujo');
});

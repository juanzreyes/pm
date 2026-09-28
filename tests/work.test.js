// Tests de las mejoras 1.6: gestores de tareas, ejecutor de la cola de Claude y avisos fuera del PC.
// Las APIs se simulan con un fetch falso y Claude con un script que imita `claude -p`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const trackers = require('../src/trackers');
const runner = require('../src/claudeRunner');
const out = require('../src/outbound');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pm-work-'));

/** fetch falso: `routes` es [[regex del método+url, (req) => respuesta]]; guarda las llamadas. */
function fakeHttp(routes) {
  const calls = [];
  const http = async (url, opts = {}) => {
    const req = { url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body ? (() => { try { return JSON.parse(opts.body); } catch { return opts.body; } })() : null };
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

// ---------------- gestores de tareas ----------------
test('trackers: GitHub trae issues asignadas (sin PRs) y las cierra', async () => {
  const http = fakeHttp([
    [/^GET https:\/\/api\.github\.com\/issues/, () => [
      { id: 1, number: 7, title: 'Arreglar login', html_url: 'https://github.com/o/app/issues/7', repository: { full_name: 'o/app' } },
      { id: 2, number: 8, title: 'Un PR', pull_request: {}, repository: { full_name: 'o/app' } },
    ]],
    [/^PATCH https:\/\/api\.github\.com\/repos\/o\/app\/issues\/7$/, () => ({})],
  ]);
  const cfg = { github: { token: 'ghp_x' } };
  const { issues, errors } = await trackers.fetchAll(cfg, http);
  assert.equal(errors.length, 0);
  assert.deepEqual(issues.map((i) => i.key), ['app#7']);
  assert.equal(http.calls[0].headers.Authorization, 'Bearer ghp_x');
  assert.equal(trackers.taskText(issues[0]), '[app#7] Arreglar login');
  await trackers.complete(trackers.link(issues[0]), cfg, http);
  assert.deepEqual(http.calls.at(-1).body, { state: 'closed', state_reason: 'completed' });
});

test('trackers: Jira Cloud usa la búsqueda nueva, pasa a "Hecho" y carga horas', async () => {
  const http = fakeHttp([
    [/^GET https:\/\/e\.atlassian\.net\/rest\/api\/3\/search\/jql\?/, () => ({ issues: [{ id: '100', key: 'PM-12', fields: { summary: 'Informe', status: { name: 'En curso' }, project: { key: 'PM' } } }] })],
    [/^GET .*\/issue\/PM-12\/transitions$/, () => ({ transitions: [{ id: '11', name: 'Revisar', to: { name: 'Revisión', statusCategory: { key: 'indeterminate' } } }, { id: '31', name: 'Terminar', to: { name: 'Hecho', statusCategory: { key: 'done' } } }] })],
    [/^POST .*\/issue\/PM-12\/transitions$/, () => ({ status: 204 })],
    [/^POST .*\/issue\/PM-12\/worklog$/, () => ({ id: 'w1' })],
  ]);
  const cfg = { jira: { site: 'https://e.atlassian.net/', email: 'a@b.c', token: 't' } };
  const { issues } = await trackers.fetchAll(cfg, http);
  assert.equal(issues[0].url, 'https://e.atlassian.net/browse/PM-12');
  assert.match(http.calls[0].url, /assignee%20%3D%20currentUser\(\)/);
  assert.equal(http.calls[0].headers.Authorization, 'Basic ' + Buffer.from('a@b.c:t').toString('base64'));
  assert.equal(await trackers.complete(issues[0], cfg, http), 'Hecho');
  assert.deepEqual(http.calls.find((c) => c.method === 'POST' && /transitions/.test(c.url)).body, { transition: { id: '31' } });
  assert.equal(await trackers.logWork(issues[0], 25 * 60 + 10, cfg, http), true);
  assert.deepEqual(http.calls.at(-1).body, { timeSpentSeconds: 1500 });
  // Menos de un minuto no se carga.
  assert.equal(await trackers.logWork(issues[0], 30, cfg, http), false);
});

test('trackers: Linear y Azure DevOps (estado final según el proceso)', async () => {
  const http = fakeHttp([
    [/^POST https:\/\/api\.linear\.app\/graphql$/, (r) => {
      if (/assignedIssues/.test(r.body.query)) return { data: { viewer: { assignedIssues: { nodes: [{ id: 'L1', identifier: 'ENG-4', title: 'Caché', url: 'https://linear.app/x/issue/ENG-4', state: { name: 'Todo' }, team: { key: 'ENG' } }] } } } };
      if (/states/.test(r.body.query)) return { data: { issue: { team: { states: { nodes: [{ id: 's9', name: 'Merged', type: 'completed', position: 5 }, { id: 's8', name: 'Done', type: 'completed', position: 2 }] } } } } };
      return { data: { issueUpdate: { success: true } } };
    }],
    [/^POST https:\/\/dev\.azure\.com\/org\/_apis\/wit\/wiql/, () => ({ workItems: [{ id: 42 }] })],
    [/^GET https:\/\/dev\.azure\.com\/org\/_apis\/wit\/workitems\?ids=42/, () => ({ value: [{ id: 42, fields: { 'System.Title': 'Bug de pagos', 'System.State': 'Active', 'System.TeamProject': 'Tienda' } }] })],
    [/^PATCH https:\/\/dev\.azure\.com\/org\/_apis\/wit\/workitems\/42/, (r) => (r.body[0].value === 'Done' ? { status: 400, body: { message: 'estado no válido' } } : {})],
  ]);
  const cfg = { linear: { token: 'lin' }, azure: { org: 'https://dev.azure.com/org', token: 'pat' } };
  const { issues, errors } = await trackers.fetchAll(cfg, http);
  assert.deepEqual(errors, []);
  assert.deepEqual(issues.map((i) => i.key), ['ENG-4', '#42']);
  assert.equal(issues[1].url, 'https://dev.azure.com/org/Tienda/_workitems/edit/42');
  assert.equal(await trackers.complete(issues[0], cfg, http), 'Done'); // el "completado" de menor posición
  assert.equal(await trackers.complete(issues[1], cfg, http), 'Closed'); // "Done" no existe en Agile → prueba "Closed"
});

test('trackers: un gestor que falla no tumba a los demás', async () => {
  const http = fakeHttp([
    [/api\.github\.com\/issues/, () => ({ status: 401, body: { message: 'Bad credentials' } })],
    [/api\.linear\.app/, () => ({ data: { viewer: { assignedIssues: { nodes: [] } } } })],
  ]);
  const r = await trackers.fetchAll({ github: { token: 'x' }, linear: { token: 'y' }, jira: { token: 'z' } }, http); // jira sin URL: se ignora
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].error, /revisa el token/);
  assert.equal(http.calls.length, 2);
});

// ---------------- avisos fuera del PC ----------------
test('outbound: detecta el webhook y arma el mensaje de cada servicio', () => {
  assert.equal(out.kind('https://hooks.slack.com/services/A/B/C'), 'slack');
  assert.equal(out.kind('https://discord.com/api/webhooks/1/abc'), 'discord');
  assert.equal(out.kind('https://prod-01.westus.logic.azure.com:443/workflows/x'), 'teams');
  assert.equal(out.kind('https://mi.servidor/hook'), 'generic');
  const msg = { title: 'Daily de Ana', text: 'Hoy: revisar PR', url: 'https://x.y' };
  assert.equal(out.webhookPayload('slack', msg).text, '*Daily de Ana*\nHoy: revisar PR\n<https://x.y|Abrir>');
  const teams = out.webhookPayload('teams', msg);
  assert.equal(teams.attachments[0].content.type, 'AdaptiveCard');
  assert.equal(teams.attachments[0].content.body[1].text, 'Hoy: revisar PR');
  assert.match(out.webhookPayload('discord', msg).content, /^\*\*Daily de Ana\*\*/);
  // El daily viene con *negrita* de Slack: en Teams se convierte.
  const daily = { text: '*Daily · lunes*\n✅ *Ayer:*\n- 2*3 no es negrita' };
  assert.equal(out.webhookPayload('teams', daily).attachments[0].content.body[0].text, '**Daily · lunes**\n✅ **Ayer:**\n- 2*3 no es negrita');
  assert.equal(out.webhookPayload('slack', daily).text, daily.text);
});

test('outbound: ntfy en JSON y Telegram con chat vinculado', async () => {
  const http = fakeHttp([[/ntfy\.sh$/, () => ({ id: 'n1' })], [/api\.telegram\.org\/botT0K\/sendMessage$/, () => ({ ok: true })]]);
  await out.sendNtfy({ topic: 'pm-abc' }, { title: '🤖 Claude terminó', text: 'en app', urgent: true }, http);
  assert.deepEqual(http.calls[0].body, { topic: 'pm-abc', title: '🤖 Claude terminó', message: 'en app', priority: 4 });
  await out.sendTelegram({ token: 'T0K', chatId: 55 }, { title: 'Hola', text: 'mundo' }, http);
  assert.deepEqual(http.calls[1].body, { chat_id: 55, text: 'Hola\nmundo', disable_web_page_preview: true });
  await assert.rejects(out.sendWebhook('http://inseguro', { text: 'x' }, http), /https/);
});

test('outbound: comandos de Telegram y reglas de a dónde va cada aviso', () => {
  assert.deepEqual(out.parseTelegram('/hecha 2'), { cmd: 'done', arg: '2' });
  assert.deepEqual(out.parseTelegram('/estado@MiPollitoBot'), { cmd: 'status', arg: '' });
  assert.deepEqual(out.parseTelegram('recuérdame a las 5 llamar a Ana'), { cmd: 'capture', arg: 'recuérdame a las 5 llamar a Ana' });
  assert.deepEqual(out.parseTelegram('/cola revisa los tests'), { cmd: 'queue', arg: 'revisa los tests' });
  const s = { phone: true, team: true };
  // Al celular solo lo importante, y por defecto solo si no estás en el PC.
  assert.deepEqual(out.route('claude', '🤖 ¡Claude terminó en app!', s, true), { team: false, phone: true });
  assert.deepEqual(out.route('claude', '🤖 ¡Claude terminó en app!', s, false), { team: false, phone: false });
  assert.deepEqual(out.route('claude', '🤖 ¡Claude terminó en app!', { ...s, phoneWhen: 'always' }, false), { team: false, phone: true });
  assert.deepEqual(out.route('usage', '📊 Llevas el 25% de la sesión', s, true), { team: false, phone: false });
  assert.deepEqual(out.route('reminder', '⏰ Llamar a Ana', s, true), { team: false, phone: true });
  assert.deepEqual(out.route('reminder', '⏰ ¡Anotado! Te recordaré "x" hoy a las 5', s, true), { team: false, phone: false });
  // Al canal del equipo: sitios caídos y CI roto.
  assert.deepEqual(out.route('monitor', '🔴 Se cayó API', s, false), { team: true, phone: false });
  assert.deepEqual(out.route('github', '❌ Falló el CI en #12', s, false), { team: true, phone: false });
  assert.deepEqual(out.route('monitor', '🔴 Se cayó API', { ...s, teamCats: [] }, false), { team: false, phone: false });
});

// ---------------- ejecutor de la cola de Claude ----------------
function gitRepo() {
  const dir = tmp();
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.name', 'Test');
  g('config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(dir, 'README.md'), '# app\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'inicio');
  return { dir, g };
}
/** Un "claude" falso: lee la petición por stdin, escribe un archivo y responde como `claude -p --output-format json`. */
function fakeClaude(behavior = 'edit') {
  const f = path.join(tmp(), 'claude.js');
  fs.writeFileSync(f, `
    let p = ''; process.stdin.on('data', (d) => (p += d)); process.stdin.on('end', () => {
      const args = process.argv.slice(2);
      if (${JSON.stringify(behavior)} === 'edit') require('fs').writeFileSync('HECHO.md', 'petición: ' + p + '\\nargs: ' + args.join(' '));
      if (${JSON.stringify(behavior)} === 'fail') { process.stderr.write('se rompió todo'); process.exit(3); }
      console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Listo: ' + p, total_cost_usd: 0.12, num_turns: 3, session_id: 'ses-1' }));
    });`);
  return f;
}

test('runner: Claude trabaja en un worktree aparte y se acepta en una rama', async () => {
  const { dir, g } = gitRepo();
  const base = tmp();
  const bin = fakeClaude('edit');
  const wt = await runner.prepare(dir, 'abc123', base);
  assert.equal(wt.branch, 'pm/claude-abc123');
  const r = await runner.launch({ bin, cwd: wt.dir, prompt: 'crea HECHO.md con "comillas" & símbolos' }).promise;
  assert.equal(r.ok, true, r.error);
  assert.equal(r.cost, 0.12);
  assert.equal(r.sessionId, 'ses-1');
  assert.match(r.result, /comillas/);
  assert.match(fs.readFileSync(path.join(wt.dir, 'HECHO.md'), 'utf8'), /--permission-mode acceptEdits/);
  // Tu carpeta de trabajo no se tocó.
  assert.equal(fs.existsSync(path.join(dir, 'HECHO.md')), false);
  const ch = await runner.changes(wt.dir);
  assert.deepEqual(ch.files, ['HECHO.md']);
  assert.ok(ch.ins >= 2);
  const branch = await runner.accept({ ...wt, repo: dir, text: 'crear hecho' });
  assert.equal(fs.existsSync(wt.dir), false);
  assert.match(g('log', '--oneline', branch).toString(), /claude: crear hecho/);
  assert.equal(g('rev-parse', '--abbrev-ref', 'HEAD').toString().trim(), 'main');
});

test('runner: descartar borra worktree y rama; los fallos se explican', async () => {
  const { dir, g } = gitRepo();
  const base = tmp();
  const wt = await runner.prepare(dir, 'zz9', base);
  const r = await runner.launch({ bin: fakeClaude('fail'), cwd: wt.dir, prompt: 'x' }).promise;
  assert.equal(r.ok, false);
  assert.match(r.error, /se rompió todo/);
  await runner.discard({ ...wt, repo: dir });
  assert.equal(fs.existsSync(wt.dir), false);
  assert.doesNotMatch(g('branch').toString(), /pm\/claude-zz9/);
  // Sin cambios: no hay nada que revisar.
  const wt2 = await runner.prepare(dir, 'noop', base);
  await runner.launch({ bin: fakeClaude('noop'), cwd: wt2.dir, prompt: 'solo mira' }).promise;
  assert.deepEqual((await runner.changes(wt2.dir)).files, []);
  await runner.discard({ ...wt2, repo: dir });
});

test('runner: encuentra Claude Code en la ruta configurada', () => {
  const f = fakeClaude();
  assert.equal(runner.findClaude(f), f);
  assert.equal(runner.slug('Mi Proyecto!!'), 'mi-proyecto');
});

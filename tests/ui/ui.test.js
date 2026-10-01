// Tests de interfaz: abren la app de verdad (Electron + Playwright) con datos de prueba en una
// carpeta temporal. Nunca tocan tus datos, el inicio de Windows ni tu OneDrive (PM_TEST=1).
//   npm run test:ui
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
let app;
let dir;
const page = (name) => app.windows().find((w) => w.url().includes(`/renderer/${name}.html`));
async function waitPage(name, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const p = page(name);
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`No apareció la ventana ${name}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let reposDir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ui-'));
  // Un repo de verdad y un "claude" falso para probar la cola que se ejecuta sola.
  reposDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ui-repos-'));
  const repo = path.join(reposDir, 'demo');
  fs.mkdirSync(repo);
  const g = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
  g('init', '-q', '-b', 'main'); g('config', 'user.name', 'Test'); g('config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(repo, 'README.md'), '# demo\n');
  g('add', '-A'); g('commit', '-q', '-m', 'inicio');
  // Un segundo repo cuyos tests fallan (para ver el aviso de tests).
  const api = path.join(reposDir, 'api');
  fs.mkdirSync(api);
  const ga = (...a) => execFileSync('git', a, { cwd: api, stdio: 'pipe' });
  ga('init', '-q', '-b', 'main'); ga('config', 'user.name', 'Test'); ga('config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(api, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "console.log(\'1 failing: suma\'); process.exit(1)"' } }));
  ga('add', '-A'); ga('commit', '-q', '-m', 'inicio');
  const fakeClaude = path.join(reposDir, 'claude.js');
  // Imita "claude -p --output-format stream-json": un paso visible, una pausa (para ver el progreso) y el resultado.
  fs.writeFileSync(fakeClaude, `let p = ''; process.stdin.on('data', (d) => (p += d)); process.stdin.on('end', () => {
    const out = (o) => console.log(JSON.stringify(o));
    if (/VEREDICTO/.test(p)) { out({ type: 'result', is_error: false, result: 'VEREDICTO: OK\\nTodo bien.', total_cost_usd: 0.01 }); return; }
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'src/HECHO.md' } }] } });
    setTimeout(() => {
      require('fs').writeFileSync('HECHO.md', p);
      out({ type: 'result', is_error: false, result: 'Creé HECHO.md', total_cost_usd: 0.05, num_turns: 2, session_id: 'ses-ui' });
    }, 2500);
  });`);
  const now = Date.now();
  fs.writeFileSync(path.join(dir, 'pm-data.json'), JSON.stringify({
    pet: { name: 'Testito', born: now - 3 * 864e5, happiness: 80, fullness: 80, xp: 20, coins: 500 },
    settings: { autoStartAsked: true, lang: 'es', focusWatch: false, chatter: false, sounds: false, voice: false, gitWatch: false, micWatch: false, gitRoots: [reposDir], claudeBin: fakeClaude },
    flags: { tourDone: true },
    life: { running: false, lastQuitHow: 'update', lastQuitAt: now },
    // Historial con muchos commits (para el rasgo "Hacker").
    days: Object.fromEntries([1, 2, 3].map((i) => { const d = new Date(now - i * 864e5); return [`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, { commits: 12 }]; })),
  }));
  app = await electron.launch({
    args: ['.'],
    cwd: ROOT,
    env: { ...process.env, PM_TEST: '1', PM_USER_DATA: dir, PM_NO_SAFE: '1' },
    timeout: 60000,
  });
  await waitPage('pet');
  await waitPage('panel');
});

test.after(async () => {
  if (app) await app.close().catch(() => {});
  for (const d of [dir, reposDir]) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* Windows a veces tarda en soltar archivos */ }
});

test('el pollito lleva su gafete de PM y el contador es otro elemento', async () => {
  const pet = await waitPage('pet');
  const r = await pet.evaluate(() => {
    const g = document.querySelector('svg #badge');
    return { pieces: g.children.length, text: g.textContent.trim(), visible: getComputedStyle(g).display !== 'none', unread: !!document.querySelector('#unread') };
  });
  assert.deepEqual(r, { pieces: 2, text: 'PM', visible: true, unread: true });
});

test('panel: añadir una tarea desde la interfaz', async () => {
  const panel = await waitPage('panel');
  await panel.evaluate(() => pm.command('panel', 'day'));
  await sleep(600);
  await panel.fill('#task-input', 'Tarea de prueba UI');
  await panel.press('#task-input', 'Enter');
  await panel.waitForFunction(() => [...document.querySelectorAll('#tasks .t')].some((x) => x.textContent.includes('Tarea de prueba UI')), null, { timeout: 5000 });
  // Las filas no se aplastan: el texto ocupa el espacio
  const w = await panel.evaluate(() => document.querySelector('#tasks .t').getBoundingClientRect().width);
  assert.ok(w > 150, `el texto de la tarea mide ${w}px`);
});

test('panel: pestañas con flechas del teclado y roles accesibles', async () => {
  const panel = await waitPage('panel');
  await panel.evaluate(() => pm.command('panel', 'chat'));
  await sleep(300);
  await panel.focus('nav button[data-view="chat"]');
  await panel.keyboard.press('ArrowRight');
  await sleep(200);
  const r = await panel.evaluate(() => ({
    active: document.querySelector('nav button.active').dataset.view,
    role: document.querySelector('nav button').getAttribute('role'),
    selected: document.querySelector('nav button.active').getAttribute('aria-selected'),
  }));
  assert.deepEqual(r, { active: 'usage', role: 'tab', selected: 'true' });
});

test('panel: las secciones nuevas se pintan (perfil, casita, colección)', async () => {
  const panel = await waitPage('panel');
  await panel.evaluate(() => pm.command('panel', 'pet'));
  await sleep(500);
  const r = await panel.evaluate(() => ({
    personalities: document.querySelectorAll('#personality [data-pers]').length,
    roomHeight: document.querySelector('#home').getBoundingClientRect().height,
    collection: document.querySelectorAll('#collection .ci').length,
  }));
  assert.equal(r.personalities, 4);
  assert.ok(r.roomHeight >= 150, `casita de ${r.roomHeight}px`);
  assert.ok(r.collection >= 20);
});

test('especie y modo foco se reflejan en el pollito', async () => {
  const panel = await waitPage('panel');
  const pet = await waitPage('pet');
  await panel.evaluate(() => pm.setSpecies('cat'));
  await pet.waitForFunction(() => document.body.classList.contains('species-cat'), null, { timeout: 5000 });
  await panel.evaluate(() => pm.focusStart(25));
  await pet.waitForFunction(() => document.body.classList.contains('focus-mode'), null, { timeout: 8000 });
  await panel.evaluate(() => pm.focusStop());
});

test('paleta: comandos y búsqueda global en tus datos', async () => {
  const pet = await waitPage('pet');
  await pet.evaluate(() => pm.openPalette());
  const pal = await waitPage('palette');
  await sleep(400);
  await pal.fill('#q', 'prueba UI');
  await pal.waitForFunction(() => document.querySelector('#list').innerText.includes('Tarea de prueba UI'), null, { timeout: 5000 });
  await pal.fill('#q', 'biblioteca');
  await pal.waitForFunction(() => document.querySelector('#list').innerText.includes('Biblioteca de prompts'), null, { timeout: 5000 });
  await pal.keyboard.press('Escape');
});

test('cola de Claude: ▶️ la ejecuta en una copia aparte y se acepta en una rama', async () => {
  const panel = await waitPage('panel');
  await panel.evaluate(() => pm.command('panel', 'day'));
  await panel.waitForFunction(() => document.querySelectorAll('#queue-project option').length > 1, null, { timeout: 8000 });
  await panel.fill('#queue-input', 'crea HECHO.md con un saludo');
  await panel.selectOption('#queue-project', 'demo');
  await panel.press('#queue-input', 'Enter');
  await panel.waitForSelector('#claude-queue .q-run', { timeout: 5000 });
  await panel.click('#claude-queue .q-run');
  // Progreso en vivo mientras trabaja.
  await panel.waitForFunction(() => /Editando/.test((document.querySelector('#claude-runs .run.running .run-progress') || {}).textContent || ''), null, { timeout: 15000 });
  await panel.waitForSelector('#claude-runs .run.review', { timeout: 30000 });
  assert.match(await panel.textContent('#claude-runs .run.review'), /Segunda opinión: todo bien/);
  const repo = path.join(reposDir, 'demo');
  assert.equal(fs.existsSync(path.join(repo, 'HECHO.md')), false, 'tu carpeta no se toca');
  const txt = await panel.textContent('#claude-runs .run.review');
  assert.match(txt, /1 archivo/);
  assert.equal(await panel.evaluate(() => (window.state || state).claudeQueue.length), 0, 'sale de la cola');
  await panel.click('#claude-runs .run.review .run-accept');
  await panel.waitForSelector('#claude-runs .run.accepted', { timeout: 15000 });
  const branches = execFileSync('git', ['branch', '--list', 'pm/claude-*'], { cwd: repo }).toString();
  assert.match(branches, /pm\/claude-/);
  const b = branches.replace('*', '').trim();
  assert.match(execFileSync('git', ['show', '--stat', '--format=%s', b], { cwd: repo }).toString(), /claude: crea HECHO\.md[\s\S]*HECHO\.md/);
});

test('cola de Claude: corre los tests del repo antes de avisar y muestra si fallan', async () => {
  const panel = await waitPage('panel');
  await panel.evaluate(() => pm.queueAdd('arregla la suma', 'api'));
  await panel.waitForSelector('#claude-queue .q-run', { timeout: 5000 });
  await panel.click('#claude-queue .q-run');
  await panel.waitForFunction(() => [...document.querySelectorAll('#claude-runs .run.review')].some((r) => /npm test falla/.test(r.textContent)), null, { timeout: 60000 });
  const r = await panel.evaluate(() => {
    const run = [...document.querySelectorAll('#claude-runs .run.review')].find((x) => /npm test falla/.test(x.textContent));
    return { tail: run.querySelector('pre').textContent, pr: !!run.querySelector('.run-pr'), accept: !!run.querySelector('.run-accept') };
  });
  assert.match(r.tail, /1 failing: suma/);
  assert.deepEqual({ pr: r.pr, accept: r.accept }, { pr: false, accept: true }, 'sin token de GitHub ni origin no ofrece PR');
  await panel.evaluate(() => { window.confirm = () => true; });
  await panel.click('#claude-runs .run.review .run-discard');
  await panel.waitForFunction(() => !document.querySelector('#claude-runs .run.review'), null, { timeout: 10000 });
});

test('ajustes: tickets, cola automática y avisos fuera del PC se pintan', async () => {
  const panel = await waitPage('panel');
  // Sin gestores conectados, la caja de tickets no estorba.
  assert.equal(await panel.evaluate(() => document.querySelector('#tickets').classList.contains('hidden')), true);
  await panel.evaluate(() => pm.openSettings('remote'));
  const st = await waitPage('settings');
  await st.waitForFunction(() => !document.querySelector('#sec-remote').classList.contains('hidden'), null, { timeout: 8000 });
  await st.evaluate(() => pm.remoteSave({ phoneOn: true, phoneVia: 'ntfy' }));
  await st.waitForFunction(() => /^pm-[0-9a-f]{16}$/.test(document.querySelector('#ntfy-topic').textContent), null, { timeout: 5000 });
  const r = await st.evaluate(async () => {
    const bad = await pm.remoteSave({ teamWebhook: 'http://inseguro.example' });
    const s = await pm.getState();
    return { bad: bad.ok, secretOut: 'teamWebhook' in s.settings || 'telegramToken' in s.settings, trackers: document.querySelectorAll('details.tk[data-p]').length, runBin: document.querySelector('#run-bin').textContent };
  });
  assert.deepEqual({ ...r, runBin: !!r.runBin }, { bad: false, secretOut: false, trackers: 4, runBin: true });
  // 1.7: tests y tope de la cola, y la caja del equipo.
  const cola = await st.evaluate(async () => {
    await pm.updateSettings({ claudeRunBudget: 999, claudeRunTests: false });
    const s = await pm.getState();
    return { budget: s.claudeRunner.budget, tests: s.claudeRunner.tests, teamBox: !!document.querySelector('#tp-export') };
  });
  assert.deepEqual(cola, { budget: 100, tests: false, teamBox: true }, 'el tope se limita a $100');
  await st.evaluate(() => pm.updateSettings({ claudeRunBudget: 0, claudeRunTests: true }));
  const jira = await st.evaluate(() => pm.ticketsSave('jira', { site: 'no-es-url', token: 'x' }));
  assert.equal(jira.ok, false);
  assert.match(jira.error, /https/);
});

test('Microsoft 365: al pegar el ID de aplicación aparece "Conectar" en Agenda', async () => {
  const panel = await waitPage('panel');
  await panel.evaluate(() => pm.command('panel', 'agenda'));
  await sleep(400);
  assert.equal(await panel.evaluate(() => document.querySelector('#accounts').classList.contains('hidden')), true);
  const bad = await panel.evaluate(() => pm.saveOauth({ microsoft: { clientId: 'no-es-guid' } }));
  assert.equal(bad.ok, false);
  const ok = await panel.evaluate(() => pm.saveOauth({ microsoft: { clientId: '11111111-2222-3333-4444-555555555555', tenant: 'contoso.onmicrosoft.com' } }));
  assert.deepEqual(ok, { ok: true, ready: { microsoft: true, google: false } });
  await panel.waitForFunction(() => !document.querySelector('#accounts').classList.contains('hidden'), null, { timeout: 5000 });
  assert.equal(await panel.evaluate(() => document.querySelector('.acc-btn.ms').disabled), false);
  assert.equal(fs.existsSync(path.join(dir, 'oauth.config.json')), true, 'se guarda en la carpeta de datos, no en la app');
});

test('panel: agenda y centro de avisos (en sus propios archivos) funcionan', async () => {
  const panel = await waitPage('panel');
  await panel.evaluate(() => pm.command('panel', 'agenda'));
  await sleep(300);
  // El proveedor de correo cambia la ayuda (código de panel-agenda.js).
  await panel.waitForFunction(() => document.querySelectorAll('#mail-provider option').length > 1, null, { timeout: 5000 });
  await panel.evaluate(() => { const s = document.querySelector('#mail-provider'); s.value = 'yahoo'; s.dispatchEvent(new Event('change')); });
  assert.match(await panel.innerHTML('#mail-help'), /Generar contraseña de app/);
  await panel.evaluate(() => pm.command('inbox'));
  await panel.waitForFunction(() => !document.querySelector('#o-inbox').classList.contains('hidden'), null, { timeout: 5000 });
  const n = await panel.evaluate(() => document.querySelectorAll('#ib-list [data-id], #ib-list .ib').length);
  assert.ok(n > 0, 'el centro de avisos lista algo');
  await panel.click('#ib-close');
});

test('1.8: donación en "Acerca de", informe de errores oculto sin destino y ajustes de la cola', async () => {
  const panel = await waitPage('panel');
  // No se pulsa (abriría PayPal en el navegador): se comprueba que el botón y el comando existen.
  const cmds = await panel.evaluate(() => pm.paletteList());
  assert.ok(cmds.some((c) => c.id === 'donate'), 'comando de donación en la paleta');
  // Clic real en el botón: se intercepta la apertura del navegador para no abrir PayPal.
  await app.evaluate(({ shell }) => { global.__opened = []; shell.openExternal = async (u) => { global.__opened.push(u); }; });
  await panel.evaluate(() => pm.openAbout());
  const about = await waitPage('about');
  assert.match(await about.textContent('#donate'), /PayPal/);
  await about.click('#donate');
  await sleep(400);
  assert.deepEqual(await app.evaluate(() => global.__opened), ['https://www.paypal.com/donate/?business=tfcjuanz%40gmail.com&currency_code=USD&item_name=PM%20Pollito']);
  // Un comando que el proceso no conoce ya no se ignora en silencio.
  await panel.evaluate(() => pm.command('no-existe-todavia'));
  await sleep(300);
  assert.ok((await panel.evaluate(() => pm.diagGet())).errors.some((e) => /Comando desconocido: no-existe-todavia/.test(e.msg)));
  await about.evaluate(() => pm.closeAbout());
  await panel.evaluate(() => pm.openSettings('diag'));
  const st = await waitPage('settings');
  await st.waitForFunction(() => !document.querySelector('#sec-diag').classList.contains('hidden'), null, { timeout: 8000 });
  const r = await st.evaluate(async () => {
    await pm.updateSettings({ claudeParallel: 9, claudeMaxFixes: -3 });
    const s = await pm.getState();
    return { errBoxHidden: document.querySelector('#err-box').classList.contains('hidden'), donate: !!document.querySelector('#donate'), par: s.claudeRunner.parallel, max: s.claudeRunner.maxFixes, review: s.claudeRunner.review, fixci: s.claudeRunner.autoFixCi };
  });
  assert.deepEqual(r, { errBoxHidden: true, donate: true, par: 3, max: 0, review: true, fixci: true });
  await st.evaluate(() => pm.updateSettings({ claudeParallel: 2, claudeMaxFixes: 2 }));
});

test('2.0 alma: huerta, trucos, fechas, rasgo visible y truco en el pollito', async () => {
  const panel = await waitPage('panel');
  const pet = await waitPage('pet');
  await panel.evaluate(() => pm.command('panel', 'pet'));
  await panel.waitForFunction(() => document.querySelectorAll('#soul-garden .pot').length >= 3, null, { timeout: 8000 });
  const r = await panel.evaluate(() => ({ pots: document.querySelectorAll('#soul-garden .pot:not(.pot-buy)').length, tricks: document.querySelectorAll('#soul-tricks .trick').length, traits: document.querySelectorAll('#soul-traits .trait-chip').length }));
  assert.deepEqual(r, { pots: 3, tricks: 5, traits: 6 });
  // Una fecha importante desde el formulario.
  await panel.fill('#soul-date-label', 'Cumple de Ana');
  await panel.fill('#soul-date-date', '2026-12-24');
  await panel.click('#soul-date-form button[type=submit]');
  await panel.waitForFunction(() => /Cumple de Ana/.test(document.querySelector('#soul-dates').textContent), null, { timeout: 5000 });
  // Practicar un truco: el pollito lo intenta.
  await panel.click('#soul-tricks .trick[data-id="spin"] button');
  await pet.waitForFunction(() => document.body.classList.contains('a-trick-spin'), null, { timeout: 5000 });
  // Rasgo: con muchos commits de verdad le sale la cresta de hacker.
  await panel.evaluate(() => pm.soulAct('traits'));
  await pet.waitForFunction(() => document.body.classList.contains('trait-hacker'), null, { timeout: 5000 });
  assert.equal(await pet.evaluate(() => getComputedStyle(document.querySelector('#tr-hacker')).display !== 'none'), true);
});

test('2.0 presencia: estilo pixel, respiración guiada y ajustes de apariencia', async () => {
  const panel = await waitPage('panel');
  const pet = await waitPage('pet');
  await panel.evaluate(() => pm.updateSettings({ petStyle: 'pixel' }));
  await pet.waitForFunction(() => document.body.classList.contains('style-pixel'), null, { timeout: 5000 });
  assert.match(await pet.evaluate(() => getComputedStyle(document.querySelector('#flip')).filter), /fxPixel/);
  await panel.evaluate(() => pm.updateSettings({ petStyle: 'normal' }));
  await pet.waitForFunction(() => !document.body.classList.contains('style-pixel'), null, { timeout: 5000 });
  await panel.evaluate(() => pm.command('breathe'));
  await pet.waitForFunction(() => document.body.classList.contains('breathing') && /Inhala/.test(document.querySelector('#breath').textContent), null, { timeout: 5000 });
  await panel.evaluate(() => pm.openSettings('appearance'));
  const st = await waitPage('settings');
  await st.waitForFunction(() => document.querySelectorAll('#pet-style button').length === 4 && !!document.querySelector('#pet-perch'), null, { timeout: 8000 });
  assert.equal(await st.evaluate(() => document.querySelector('#pet-perch').checked), true, 'sentarse en ventanas viene activado');
});

test('ajustes: diagnóstico sin errores de la app', async () => {
  const panel = await waitPage('panel');
  await panel.evaluate(() => pm.command('diag'));
  const st = await waitPage('settings');
  await st.waitForFunction(() => document.querySelector('#dg-mem').textContent.includes('MB'), null, { timeout: 8000 });
  const d = await st.evaluate(() => pm.diagGet());
  const own = d.errors.filter((e) => !/Autofill|DevTools|Electron Security Warning|Comando desconocido: no-existe-todavia/i.test(e.msg)); // el último lo provoca un test a propósito
  assert.deepEqual(own.map((e) => e.msg.slice(0, 160)), []);
});

test('seguridad: las ventanas están aisladas (sandbox) y sin Node', async () => {
  const panel = await waitPage('panel');
  const r = await panel.evaluate(() => ({ require: typeof window.require, process: typeof window.process, pm: typeof window.pm }));
  assert.deepEqual(r, { require: 'undefined', process: 'undefined', pm: 'object' });
});

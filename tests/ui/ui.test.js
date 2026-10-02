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
    settings: { autoStartAsked: true, lang: 'es', morningTime: '00:00', eveningTime: '23:59', focusWatch: false, chatter: false, sounds: false, voice: false, gitWatch: false, micWatch: false, gitRoots: [reposDir], claudeBin: fakeClaude, teamFolder: path.join(reposDir, 'equipo'), myName: 'Yo' },
    farm: { id: 'yo-test', sent: [], seen: [], received: [], rewardWeek: '', pendingVisits: [] },
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

test('2.0 productividad: mis proyectos, notas de reunión → tareas y modo pato', async () => {
  const panel = await waitPage('panel');
  await panel.evaluate(() => pm.command('panel', 'day'));
  await panel.evaluate(() => { document.querySelector('#pj-section').open = true; });
  await panel.waitForFunction(() => document.querySelectorAll('#pj-list .pj').length >= 2, null, { timeout: 8000 });
  // Notas de reunión → tareas.
  await panel.evaluate(() => pm.command('meeting.notes'));
  await panel.waitForSelector('#o-meeting:not(.hidden)', { timeout: 5000 });
  await panel.fill('#mt-text', 'Ana: enviar el presupuesto el viernes\nYo reviso el PR del carrito\nHablamos del clima');
  await panel.click('#mt-go');
  await panel.waitForFunction(() => document.querySelectorAll('#mt-list .mt-item').length === 2, null, { timeout: 8000 });
  assert.deepEqual(await panel.evaluate(() => [...document.querySelectorAll('#mt-list input')].map((c) => c.checked)), [false, true], 'solo la tuya marcada');
  await panel.click('#mt-add');
  await panel.waitForFunction(() => [...document.querySelectorAll('#tasks .t')].some((x) => /Yo reviso el PR del carrito/.test(x.textContent)), null, { timeout: 5000 });
  // Pato de goma desde el chat.
  await panel.evaluate(() => pm.command('panel', 'chat'));
  await panel.fill('#chat-input', '/pato');
  await panel.press('#chat-input', 'Enter');
  await panel.waitForFunction(() => !document.querySelector('#duck-banner').classList.contains('hidden'), null, { timeout: 5000 });
  await panel.fill('#chat-input', 'el total no suma el IVA');
  await panel.press('#chat-input', 'Enter');
  await panel.waitForFunction(() => /¿Qué esperabas que pasara/.test(document.querySelector('#chat-log, #chat, body').innerText), null, { timeout: 5000 });
  await panel.fill('#chat-input', 'listo');
  await panel.press('#chat-input', 'Enter');
  await panel.waitForFunction(() => document.querySelector('#duck-banner').classList.contains('hidden'), null, { timeout: 5000 });
});

test('2.0 Claude: modelo por petición, recurrentes, qué funciona y ajustes de límites', async () => {
  const panel = await waitPage('panel');
  await panel.evaluate(() => pm.command('panel', 'day'));
  await panel.waitForFunction(() => document.querySelectorAll('#crec-project option').length > 1, null, { timeout: 8000 });
  await panel.fill('#queue-input', 'corrige el typo del título');
  await panel.selectOption('#queue-model', 'haiku');
  await panel.press('#queue-input', 'Enter');
  await panel.waitForFunction(() => [...document.querySelectorAll('#claude-queue .qi')].some((q) => /corrige el typo[\s\S]*🧠 haiku/.test(q.textContent)), null, { timeout: 5000 });
  await panel.evaluate(() => { document.querySelector('#claude-recurring').open = true; document.querySelector('#claude-stats').open = true; });
  await panel.fill('#crec-text', 'Actualiza dependencias y abre PR');
  await panel.selectOption('#crec-project', 'demo');
  await panel.selectOption('#crec-days', '1');
  await panel.click('#crec-form button[type=submit]');
  await panel.waitForFunction(() => /Actualiza dependencias[\s\S]*demo[\s\S]*lunes · 09:00/.test(document.querySelector('#crec-list').textContent), null, { timeout: 5000 });
  // Las peticiones de los tests anteriores ya cuentan en "qué te funciona".
  const st = await panel.evaluate(() => ({ n: Number(document.querySelector('#cstats-count').textContent), rows: document.querySelectorAll('#cstats tbody tr').length }));
  assert.ok(st.n >= 2 && st.rows >= 1, JSON.stringify(st));
  await panel.evaluate(() => { document.querySelector('#crec-list .crec-del').click(); });
  await panel.waitForFunction(() => document.querySelector('#crec-count').textContent === '0', null, { timeout: 5000 });
  await panel.evaluate(() => [...document.querySelectorAll('#claude-queue .qi')].find((q) => /corrige el typo/.test(q.textContent)).querySelector('.q-del').click());
  await panel.evaluate(() => pm.openSettings('integrations'));
  const s = await waitPage('settings');
  await s.waitForFunction(() => !!document.querySelector('#run-limits') && document.querySelector('#run-limitpct').value === '85', null, { timeout: 8000 });
  assert.deepEqual(await s.evaluate(() => ({ lim: document.querySelector('#run-limits').checked, auto: document.querySelector('#run-modelauto').checked })), { lim: true, auto: true });
  await s.evaluate(() => { const i = document.querySelector('#run-limitpct'); i.value = '120'; i.dispatchEvent(new Event('change')); });
  await s.waitForFunction(async () => (await pm.getState()).claudeRunner.limitPct === 99, null, { timeout: 5000 });
  await s.evaluate(() => pm.updateSettings({ claudeLimitPct: 85 }));
});

test('2.0 equipo: granja compartida, kudo con maíz y visita de un compañero', async () => {
  const panel = await waitPage('panel');
  const pet = await waitPage('pet');
  // Dos compañeros escriben su tarjeta en la carpeta del equipo; Ana además le manda una visita a tu pollito.
  const g = path.join(reposDir, 'equipo', 'pm-granja');
  fs.mkdirSync(g, { recursive: true });
  const tf = require('../../src/teamfarm');
  const ana = tf.card({ id: 'ana', name: 'Ana', pet: { name: 'Pío', species: 'cat' }, level: 7, weekMins: 200 });
  fs.writeFileSync(path.join(g, 'ana.json'), JSON.stringify(ana));
  fs.writeFileSync(path.join(g, 'ana.out.json'), JSON.stringify([tf.event('visit', ana, 'yo-test', '¡hola!')]));
  fs.writeFileSync(path.join(g, 'beto.json'), JSON.stringify(tf.card({ id: 'beto', name: 'Beto', pet: { species: 'penguin' }, focusMode: true })));
  await panel.evaluate(() => pm.command('panel', 'pet'));
  await panel.evaluate(() => pm.farmRefresh());
  await panel.waitForFunction(() => document.querySelectorAll('#farm-list .mate').length === 2, null, { timeout: 8000 });
  const r = await panel.evaluate(() => [...document.querySelectorAll('#farm-list .mate')].map((m) => [m.querySelector('b').textContent, m.className.includes('st-focus'), m.querySelector('.m-visit').disabled]));
  assert.deepEqual(r, [['Ana', false, false], ['Beto', true, true]], 'Beto en foco: dormido y sin visitas');
  assert.equal(await panel.evaluate(() => !document.querySelector('#farm-challenge').classList.contains('hidden')), true, 'reto de foco visible');
  // La visita de Ana llega al pollito.
  await pet.waitForFunction(() => document.body.classList.contains('visiting') && /Pío · de Ana/.test(document.querySelector('#visitor-tag').textContent), null, { timeout: 5000 });
  // Kudo a Ana con mensaje: queda en tu buzón de la carpeta.
  await panel.click('#farm-list .mate[data-id="ana"] .m-kudo');
  await panel.fill('#farm-list .kudo-msg', 'gracias por la review');
  await panel.click('#farm-list .kudo-form button[type=submit]');
  await panel.waitForFunction(() => /2 kudos hoy/.test(document.querySelector('#farm-kudos-left').textContent), null, { timeout: 5000 });
  const out = JSON.parse(fs.readFileSync(path.join(g, 'yo-test.out.json'), 'utf8'));
  assert.deepEqual(out.map((e) => [e.type, e.to, e.msg]), [['kudo', 'ana', 'gracias por la review']]);
  const mine = JSON.parse(fs.readFileSync(path.join(g, 'yo-test.json'), 'utf8'));
  assert.equal(mine.name, 'Yo');
  assert.equal('coins' in mine, false);
});

test('2.0 juego: misiones, pase, minijuegos nuevos, exclusivos en la tienda y tu año', async () => {
  const panel = await waitPage('panel');
  await panel.evaluate(() => pm.command('panel', 'pet'));
  await panel.waitForFunction(() => document.querySelectorAll('#game-missions .mission').length === 3 && document.querySelectorAll('#game-pass .pass-tier').length === 20, null, { timeout: 8000 });
  assert.match(await panel.textContent('#game-eggs'), /Próximo huevo a los 7 días/);
  const shop = await panel.evaluate(() => [...document.querySelectorAll('#shop .item')].filter((i) => /galaxia|arcoíris/.test(i.textContent)).map((i) => i.querySelector('button').disabled));
  assert.deepEqual(shop, [true, true], 'los exclusivos no se compran');
  // Menú de minijuegos → aplastá los bugs.
  await panel.evaluate(() => pm.openGame());
  const game = await waitPage('game');
  await game.waitForSelector('#menu:not(.hidden) [data-mode="bugs"]', { timeout: 5000 });
  await game.click('[data-mode="bugs"]');
  await game.waitForFunction(() => /Aplasta los bugs/.test(document.querySelector('#ov-title').textContent) && document.querySelector('#c').className === 'm-bugs', null, { timeout: 5000 });
  await game.click('#play');
  await sleep(1500);
  // Un clic en cada pantalla: si había un bug, cuenta.
  for (const [x, y] of [[70, 64], [170, 64], [270, 64], [370, 64]]) await game.mouse.click(x + 10, y + 52 + 8);
  const r = await game.evaluate(() => pm.gameEnd(7, 'snake'));
  assert.equal(r.best, 7);
  await game.evaluate(() => pm.gameClose());
  await panel.waitForFunction(() => state.game.bestScores.snake === 7 && state.game.gamesToday >= 1 && state.game.season.pts >= 7, null, { timeout: 5000 });
  // Tu año: la tarjeta se dibuja.
  await panel.evaluate(() => pm.command('wrapped'));
  await panel.waitForSelector('#o-wrapped:not(.hidden)', { timeout: 5000 });
  await sleep(300);
  const px = await panel.evaluate(() => { const c = document.querySelector('#wr-canvas'); const d = c.getContext('2d').getImageData(10, 10, 1, 1).data; return d[3]; });
  assert.equal(px, 255, 'el canvas tiene la tarjeta');
  await panel.click('#wr-close');
});

test('2.0 plataforma: plugin en utilityProcess, widget de escritorio y extensión emparejable', async () => {
  const panel = await waitPage('panel');
  // Plugin de ejemplo: se instala, se activa (en su propio proceso de Electron) y su comando sale en la paleta.
  await panel.evaluate(() => pm.pluginsExample());
  const r = await panel.evaluate(() => pm.pluginsEnable('hola-pollito', true));
  assert.equal(r.ok, true);
  await panel.waitForFunction(async () => (await pm.getState()).plugins.list.some((p) => p.id === 'hola-pollito' && p.ready), null, { timeout: 10000 });
  await panel.waitForFunction(async () => (await pm.paletteList()).some((c) => c.arg === 'hola-pollito:frase'), null, { timeout: 5000 });
  await panel.evaluate(() => pm.command('plugin.run', 'hola-pollito:frase'));
  // Lo que dice un plugin queda en el centro de avisos (y sale en la burbuja si el pollito está visible).
  await panel.waitForFunction(async () => (await pm.getState()).inbox.some((x) => /^🧩 /.test(x.text)), null, { timeout: 5000 });
  // Ajustes: la sección de plugins lo muestra funcionando; la extensión tiene su código.
  await panel.evaluate(() => pm.openSettings('plugins'));
  const st = await waitPage('settings');
  await st.waitForFunction(() => /funcionando/.test(document.querySelector('#pl-list').textContent), null, { timeout: 8000 });
  assert.match(await st.evaluate(() => document.querySelector('#bx-token').value), /^[0-9a-f]{32}$/);
  await panel.evaluate(() => pm.pluginsEnable('hola-pollito', false));
  // Widget de escritorio.
  await panel.evaluate(() => pm.command('widget.toggle'));
  const w = await waitPage('widget');
  await w.waitForFunction(() => /Testito/.test(document.querySelector('#name').textContent) && /✅/.test(document.querySelector('#tasks').textContent), null, { timeout: 8000 });
  await w.click('#w-close');
  await sleep(500);
  assert.equal(page('widget'), undefined, 'se cierra');
  assert.equal((await panel.evaluate(() => pm.getState())).settings.desktopWidget, false);
});

test('pulido 1: pestañas que se deslizan, ficha que se mueve, números que cuentan y salidas animadas', async () => {
  const panel = await waitPage('panel');
  await panel.evaluate(() => pm.command('panel', 'chat'));
  await sleep(700);
  const r = await panel.evaluate(async () => {
    const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
    const ink0 = document.querySelector('#tab-ink').style.transform;
    document.querySelector('[data-view="day"]').click();
    await wait(60);
    const v = document.querySelector('#v-day');
    const mid = { cls: v.className, op: Number(getComputedStyle(v).opacity), tf: getComputedStyle(v).transform };
    await wait(400);
    const end = { op: Number(getComputedStyle(v).opacity), tf: getComputedStyle(v).transform, ink: document.querySelector('#tab-ink').style.transform };
    // Volver hacia la izquierda entra desde la izquierda.
    document.querySelector('[data-view="chat"]').click();
    const back = document.querySelector('#v-chat').className;
    return { ink0, mid, end, back };
  });
  assert.match(r.mid.cls, /from-right/);
  assert.ok(r.mid.op < 1 || r.mid.tf !== 'none', 'a mitad de camino todavía se mueve: ' + JSON.stringify(r.mid));
  assert.deepEqual({ op: r.end.op, tf: r.end.tf }, { op: 1, tf: 'none' });
  assert.notEqual(r.end.ink, r.ink0, 'la ficha se movió a la pestaña nueva');
  assert.match(r.back, /from-left/);
  // Números que cuentan.
  const nums = await panel.evaluate(async () => {
    const el = document.createElement('span');
    document.body.append(el);
    MOTION.countTo(el, 100, String);
    MOTION.countTo(el, 600, String);
    await new Promise((ok) => setTimeout(ok, 120));
    const mid = Number(el.textContent);
    await new Promise((ok) => setTimeout(ok, 600));
    el.remove();
    return { mid, end: Number(el.textContent) };
  });
  assert.ok(nums.mid > 100 && nums.mid < 600, 'cuenta de a poco: ' + nums.mid);
  assert.equal(nums.end, 600);
  // Una ventana interna se va con animación (y al final queda oculta).
  await panel.evaluate(() => pm.command('whatsnew'));
  await panel.waitForSelector('#o-whatsnew:not(.hidden)', { timeout: 5000 });
  const leave = await panel.evaluate(async () => {
    const o = document.querySelector('#o-whatsnew');
    o.classList.add('hidden');
    await Promise.resolve(); // el observador reacciona en la siguiente microtarea
    const during = { hidden: o.classList.contains('hidden'), leaving: o.classList.contains('leaving') };
    await new Promise((ok) => setTimeout(ok, 1200)); // holgado: con el PC bloqueado, Chromium frena los temporizadores
    return { during, after: { hidden: o.classList.contains('hidden'), leaving: o.classList.contains('leaving') } };
  });
  assert.deepEqual(leave, { during: { hidden: false, leaving: true }, after: { hidden: true, leaving: false } });
});

test('pulido 2: menú circular, caricia, pico al hablar y lanzar al pollito', async () => {
  const pet = await waitPage('pet');
  const c = await pet.evaluate(() => { const r = document.querySelector('#chick').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  // Mantener presionado → menú circular con 6 acciones; "Anotar" abre la captura.
  await pet.mouse.move(c.x, c.y);
  await pet.mouse.down();
  await sleep(750);
  await pet.mouse.up();
  await pet.waitForFunction(() => document.querySelector('#radial').classList.contains('open') && document.querySelectorAll('#radial .rd').length === 6, null, { timeout: 3000 }).catch(async (e) => { throw new Error(e.message + ' · ' + await pet.evaluate(() => document.body.className + ' | radial=' + document.querySelector('#radial').className + ' | chick=' + getComputedStyle(document.querySelector('#chick')).display)); });
  await pet.click('#radial .rd[data-i="2"]');
  const cap = await waitPage('capture');
  assert.equal(await pet.evaluate(() => document.querySelector('#radial').classList.contains('open')), false);
  await cap.keyboard.press('Escape');
  // Eventos de puntero directos en la página: con el PC bloqueado, Chromium entrega el mouse
  // simulado a ~1 movimiento por segundo y no se podría frotar ni lanzar.
  const fire = (type, x, y, extra = {}) => pet.evaluate(([t, x, y, e]) => document.querySelector('#chick').dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, screenX: e.sx ?? x, screenY: e.sy ?? y, button: 0, pointerId: 7, ...e })), [type, x, y, extra]);
  // Caricia: frotar de lado a lado cierra los ojitos y suelta corazones.
  for (let i = 0; i < 10; i++) await fire('pointermove', c.x + (i % 2 ? -30 : 30), c.y);
  assert.equal(await pet.evaluate(() => document.body.classList.contains('petting')), true);
  // El pico se abre con las vocales mientras escribe y se cierra al terminar.
  const lip = await pet.evaluate(async () => {
    say({ text: 'Hola, ¿qué tal vas con el informe?', ms: 4000 });
    const during = document.body.classList.contains('lipsync');
    await new Promise((r) => setTimeout(r, 4000));
    return { during, after: document.body.classList.contains('lipsync'), text: document.querySelector('#bubble-text').textContent };
  });
  assert.deepEqual(lip, { during: true, after: false, text: 'Hola, ¿qué tal vas con el informe?' });
  // Lanzarlo: arrastre rápido → vuela y aterriza sobre la barra de tareas.
  const getPos = () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('pet.html')); return { pos: w.getPosition(), size: w.getSize() }; });
  const p0 = await getPos();
  const sx = p0.pos[0] + c.x;
  const sy = p0.pos[1] + c.y;
  await fire('pointerdown', c.x, c.y, { sx, sy });
  await pet.evaluate(async ([cx, cy, sx, sy]) => {
    for (let i = 1; i <= 8; i++) {
      document.querySelector('#chick').dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx, clientY: cy, screenX: sx - i * 45, screenY: sy - i * 20, pointerId: 7 }));
      // Sin pausas: con la ventana sin pintar, Chromium las estira y el lanzamiento saldría lento.
    }
    document.querySelector('#chick').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cx, clientY: cy, pointerId: 7 }));
  }, [c.x, c.y, sx, sy]);
  await pet.waitForFunction(() => document.body.classList.contains('flying'), null, { timeout: 3000 });
  await pet.waitForFunction(() => !document.body.classList.contains('flying'), null, { timeout: 10000 });
  const p1 = await getPos();
  const floor = await app.evaluate(({ screen }, b) => { const wa = screen.getDisplayNearestPoint({ x: b.pos[0] + b.size[0] / 2, y: b.pos[1] + b.size[1] / 2 }).workArea; return wa.y + wa.height - b.size[1]; }, p1);
  assert.notDeepEqual(p1.pos, p0.pos, 'se movió');
  assert.equal(p1.pos[1], floor, 'aterrizó sobre la barra de tareas');
});

test('pulido 3: avisos apilados, deslizar para descartar, cola que sigue y deshacer con cuenta atrás', async () => {
  const pet = await waitPage('pet');
  const r = await pet.evaluate(async () => {
    const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
    say({ text: 'Primer aviso', ms: 8000, logged: true });
    await wait(50);
    say({ text: 'Segundo aviso', ms: 8000, logged: true });
    say({ text: 'Tercero', ms: 8000, logged: true });
    const stack = document.querySelector('#bubble-stack');
    const stackText = stack.classList.contains('hidden') ? '' : stack.textContent;
    // La cola apunta al centro real del pollito.
    const c = document.querySelector('#chick').getBoundingClientRect();
    const tail = parseFloat(getComputedStyle(document.querySelector('#bubble')).getPropertyValue('--tail-x'));
    // Deslizar a la derecha la descarta.
    const b = document.querySelector('#bubble');
    const ev = (t, x) => b.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: 60, button: 0, pointerId: 9 }));
    ev('pointerdown', 50); ev('pointermove', 90); ev('pointermove', 150); ev('pointerup', 150);
    await wait(1200);
    return { stackText, tailOk: Math.abs(tail - (c.left + c.width / 2 - 8)) < 2, hidden: b.classList.contains('hidden'), stackAfter: document.querySelector('#bubble-stack').classList.contains('hidden') };
  });
  assert.deepEqual(r, { stackText: '+2 más', tailOk: true, hidden: true, stackAfter: true });
  // Deshacer con cuenta atrás en el panel.
  const panel = await waitPage('panel');
  const t = await panel.evaluate(async () => {
    toast('Tarea borrada', () => {});
    const anims = document.querySelector('#toast-bar').getAnimations().length;
    const undo = !document.querySelector('#toast-undo').classList.contains('hidden');
    document.querySelector('#toast-undo').click();
    await new Promise((ok) => setTimeout(ok, 50));
    return { anims, undo, hiddenAfterUndo: document.querySelector('#toast').classList.contains('hidden') };
  });
  assert.deepEqual(t, { anims: 1, undo: true, hiddenAfterUndo: true });
});

test('pulido 4: lista viva, completar con confeti y botones con estado', async () => {
  const panel = await waitPage('panel');
  await panel.evaluate(() => pm.command('panel', 'day'));
  await panel.evaluate(() => pm.addTask('Fila A pulido'));
  await panel.waitForFunction(() => [...document.querySelectorAll('#tasks > li')].some((l) => /Fila A pulido/.test(l.textContent)), null, { timeout: 5000 });
  await panel.evaluate(() => { window.__rowA = [...document.querySelectorAll('#tasks > li')].find((l) => /Fila A pulido/.test(l.textContent)); });
  await panel.evaluate(() => pm.addTask('Fila B pulido'));
  await panel.waitForFunction(() => [...document.querySelectorAll('#tasks > li')].some((l) => /Fila B pulido/.test(l.textContent)), null, { timeout: 5000 });
  const r = await panel.evaluate(() => {
    const rows = [...document.querySelectorAll('#tasks > li')];
    const a = rows.find((l) => /Fila A pulido/.test(l.textContent));
    const b = rows.find((l) => /Fila B pulido/.test(l.textContent));
    return { same: a === window.__rowA, bEnter: b.classList.contains('enter') };
  });
  assert.deepEqual(r, { same: true, bEnter: true }, 'la fila A no se rehízo; la B entró animada');
  // Completar: tachado animado + confeti.
  const done = await panel.evaluate(async () => {
    const b = [...document.querySelectorAll('#tasks > li')].find((l) => /Fila B pulido/.test(l.textContent));
    b.querySelector('input[type=checkbox]').click();
    const conf = document.querySelectorAll('#fx-layer i').length;
    await new Promise((ok) => setTimeout(ok, 120));
    const b2 = [...document.querySelectorAll('#tasks > li')].find((l) => /Fila B pulido/.test(l.textContent));
    return { conf, justDone: b2.classList.contains('just-done'), done: b2.classList.contains('done') };
  });
  assert.ok(done.conf >= 8, 'confeti: ' + done.conf);
  assert.deepEqual({ j: done.justDone, d: done.done }, { j: true, d: true });
  // Botón con estado: girando y luego ✓ (o ✗ si falla).
  const btn = await panel.evaluate(async () => {
    const b = document.createElement('button');
    b.textContent = 'Guardar';
    document.body.append(b);
    let release;
    const p = MOTION.busy(b, () => new Promise((ok) => { release = ok; }));
    const during = b.classList.contains('is-busy');
    release({ ok: true });
    await p;
    const ok = b.classList.contains('is-ok');
    await MOTION.busy(b, async () => ({ ok: false, error: 'x' }));
    const err = b.classList.contains('is-err');
    b.remove();
    return { during, ok, err };
  });
  assert.deepEqual(btn, { during: true, ok: true, err: true });
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

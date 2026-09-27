// Tests de interfaz: abren la app de verdad (Electron + Playwright) con datos de prueba en una
// carpeta temporal. Nunca tocan tus datos, el inicio de Windows ni tu OneDrive (PM_TEST=1).
//   npm run test:ui
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ui-'));
  const now = Date.now();
  fs.writeFileSync(path.join(dir, 'pm-data.json'), JSON.stringify({
    pet: { name: 'Testito', born: now - 3 * 864e5, happiness: 80, fullness: 80, xp: 20, coins: 500 },
    settings: { autoStartAsked: true, lang: 'es', focusWatch: false, chatter: false, sounds: false, voice: false, gitWatch: false, micWatch: false },
    flags: { tourDone: true },
    life: { running: false, lastQuitHow: 'update', lastQuitAt: now },
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
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows a veces tarda en soltar archivos */ }
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

test('ajustes: diagnóstico sin errores de la app', async () => {
  const panel = await waitPage('panel');
  await panel.evaluate(() => pm.command('diag'));
  const st = await waitPage('settings');
  await st.waitForFunction(() => document.querySelector('#dg-mem').textContent.includes('MB'), null, { timeout: 8000 });
  const d = await st.evaluate(() => pm.diagGet());
  const own = d.errors.filter((e) => !/Autofill|DevTools|Electron Security Warning/i.test(e.msg));
  assert.deepEqual(own.map((e) => e.msg.slice(0, 160)), []);
});

test('seguridad: las ventanas están aisladas (sandbox) y sin Node', async () => {
  const panel = await waitPage('panel');
  const r = await panel.evaluate(() => ({ require: typeof window.require, process: typeof window.process, pm: typeof window.pm }));
  assert.deepEqual(r, { require: 'undefined', process: 'undefined', pm: 'object' });
});

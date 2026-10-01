// La extensión del navegador de verdad: se carga en Chromium (Playwright) y habla con un servidor
// de PM de prueba en un puerto libre (nunca con tu PM abierto). Si no hay Chromium de Playwright
// (npx playwright install chromium), la prueba se salta.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const hooks = require('../../src/claudeHooks');

const EXT = path.join(__dirname, '..', '..', 'extensions', 'browser');

test('extensión del navegador: emparejar, insignia, anotar y frenar sitios en foco', async (t) => {
  const calls = [];
  let focus = null;
  const browser = {
    token: () => 'codigo-de-prueba', seen() {},
    status: () => ({ ok: true, name: 'Kiwi', session: { pct: 42 }, weekly: { pct: 10 }, tasks: { done: 1, total: 3 }, focus, blockSites: ['youtube.com'] }),
    capture: (d) => { calls.push(['capture', d]); return { ok: true }; },
    focus: (d) => { calls.push(['focus', d]); focus = d.stop ? null : { until: Date.now() + 25 * 60e3 }; return { ok: true }; },
    blocked: (d) => { calls.push(['blocked', d.host]); return { ok: true }; },
  };
  const server = hooks.startServer(() => {}, { port: 0, browser });
  await new Promise((ok) => server.on('listening', ok));
  const port = server.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ext-'));
  let ctx;
  const opts = { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] };
  try {
    ctx = await chromium.launchPersistentContext(dir, opts).catch(async (e) => {
      // ¿Otra versión de Chromium de Playwright ya descargada? Sirve igual para esta prueba.
      const root = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), 'ms-playwright');
      const found = (fs.existsSync(root) ? fs.readdirSync(root) : []).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()
        .flatMap((d) => ['chrome-win64', 'chrome-win', 'chrome-linux'].map((s) => path.join(root, d, s, process.platform === 'win32' ? 'chrome.exe' : 'chrome')))
        .find((p) => fs.existsSync(p));
      if (!found) throw e;
      return chromium.launchPersistentContext(dir, { ...opts, channel: undefined, executablePath: found });
    });
  } catch (e) {
    server.close();
    t.skip('Sin Chromium de Playwright: ' + e.message.split('\n')[0]);
    return;
  }
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const id = new URL(sw.url()).host;
    // Emparejar desde la página de opciones (se abre sola al instalar).
    const opt = await ctx.newPage();
    await opt.goto(`chrome-extension://${id}/options.html`);
    await opt.fill('#code', 'mal');
    await opt.evaluate((p) => { document.querySelector('details').open = true; document.querySelector('#port').value = String(p); }, port);
    await opt.click('#f button[type=submit]');
    await opt.waitForFunction(() => /Código incorrecto/.test(document.querySelector('#msg').textContent), null, { timeout: 5000 });
    await opt.fill('#code', 'codigo-de-prueba');
    await opt.click('#f button[type=submit]');
    await opt.waitForFunction(() => /Conectada con Kiwi/.test(document.querySelector('#msg').textContent), null, { timeout: 5000 });
    // La insignia muestra la sesión de Claude.
    await sw.evaluate(() => refresh());
    assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), '42%');
    // Ventanita: datos y anotar una tarea.
    const pop = await ctx.newPage();
    await pop.goto(`chrome-extension://${id}/popup.html`);
    await pop.waitForFunction(() => document.querySelector('#s-pct').textContent === '42%', null, { timeout: 5000 });
    assert.match(await pop.textContent('#tasks'), /1\/3 tareas/);
    await pop.fill('#add-text', 'Leer el RFC de HTTP');
    await pop.click('#add button[type=submit]');
    await pop.waitForFunction(() => /Anotado en PM/.test(document.querySelector('#msg').textContent), null, { timeout: 5000 });
    assert.deepEqual(calls.find((c) => c[0] === 'capture'), ['capture', { text: 'Leer el RFC de HTTP', kind: 'task' }]);
    // Modo foco desde la ventanita → YouTube va a la pantalla del pollito.
    await pop.click('[data-min="25"]');
    await pop.waitForFunction(() => !document.querySelector('#focus-on').classList.contains('hidden'), null, { timeout: 5000 });
    assert.equal((await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length, 1);
    const yt = await ctx.newPage();
    await yt.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ').catch(() => {});
    await yt.waitForURL(/blocked\.html#https:\/\/www\.youtube\.com\/watch/, { timeout: 8000 });
    await yt.waitForFunction(() => document.querySelector('#host').textContent === 'youtube.com', null, { timeout: 5000 });
    assert.ok(calls.some((c) => c[0] === 'blocked' && c[1] === 'youtube.com'), 'PM se entera del sitio frenado');
    // Terminar el foco quita las reglas.
    await pop.click('#focus-stop');
    await pop.waitForFunction(() => document.querySelector('#focus-on').classList.contains('hidden'), null, { timeout: 5000 });
    assert.equal((await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length, 0);
  } finally {
    await ctx.close();
    server.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows tarda en soltar */ }
  }
});

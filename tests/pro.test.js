// Tests de las funciones "pro": sincronización, exportaciones, MCP, memoria de proyecto, perfiles.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sync = require('../src/sync');
const exporters = require('../src/exporters');
const mcp = require('../src/mcp');
const projmem = require('../src/projmem');
const profilesMod = require('../src/profiles');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));

// ---------------- sincronización ----------------
test('sync: tareas del mismo día se unen y "hecha" gana', () => {
  const a = { days: { '2026-09-28': { standup: { today: [{ text: 'A', done: false }, { text: 'B', done: false }] }, notes: 'nota 1' } }, pet: { xp: 10 } };
  const b = { days: { '2026-09-28': { standup: { today: [{ text: 'B', done: true }, { text: 'C', done: false }] }, notes: 'nota 2' } }, pet: { xp: 5 } };
  const m = sync.merge(a, b);
  const t = m.days['2026-09-28'].standup.today;
  assert.deepEqual(t.map((x) => x.text), ['A', 'B', 'C']);
  assert.equal(t.find((x) => x.text === 'B').done, true);
  assert.match(m.days['2026-09-28'].notes, /nota 1\nnota 2/);
});
test('sync: lo borrado (lápida) no reaparece', () => {
  const a = { claudeQueue: [], tombstones: { q1: Date.now() }, days: {} };
  const b = { claudeQueue: [{ id: 'q1', text: 'ya usada' }, { id: 'q2', text: 'nueva' }], days: {} };
  const m = sync.merge(a, b);
  assert.deepEqual(m.claudeQueue.map((x) => x.id), ['q2']);
});
test('sync: gana el pollito más evolucionado y se suman colecciones', () => {
  const m = sync.mergePet({ xp: 100, name: 'Kiwi', owned: ['a'], collection: { '🐸': 1 } }, { xp: 50, owned: ['b'], collection: { '🐸': 2, '🦄': 1 } });
  assert.equal(m.xp, 100);
  assert.deepEqual(m.owned.sort(), ['a', 'b']);
  assert.deepEqual(m.collection, { '🐸': 2, '🦄': 1 });
});
test('sync: dos PCs por una carpeta compartida', () => {
  const dir = tmp();
  const pc1 = { days: { '2026-09-28': { standup: { today: [{ text: 'desde PC1', done: false }] } } }, pet: { xp: 1 }, settings: { secreto: 'x' } };
  const pc2 = { days: { '2026-09-28': { standup: { today: [{ text: 'desde PC2', done: true }] } } }, pet: { xp: 2 }, settings: {} };
  sync.run(dir, pc1, { id: 'a', name: 'PC1' });
  const r = sync.run(dir, pc2, { id: 'b', name: 'PC2' });
  assert.deepEqual(r.from, ['PC1']);
  assert.equal(r.merged.days['2026-09-28'].standup.today.length, 2);
  // La foto compartida no lleva ajustes (claves, rutas…)
  const shared = JSON.parse(fs.readFileSync(path.join(dir, 'pm-sync-a.json'), 'utf8'));
  assert.equal(shared.data.settings, undefined);
  // Segunda vuelta: ya estaba mezclado
  assert.deepEqual(sync.run(dir, r.merged, { id: 'b', name: 'PC2' }).from, []);
});

// ---------------- exportaciones ----------------
test('markdown: tareas como casillas y frontmatter', () => {
  const md = exporters.markdownDay({ days: { '2026-09-28': { standup: { today: [{ text: 'Hecha', done: true }, { text: 'Pendiente' }] }, notes: 'Idea X' } } }, '2026-09-28');
  assert.match(md, /^---\ndate: 2026-09-28/);
  assert.match(md, /- \[x\] Hecha/);
  assert.match(md, /- \[ \] Pendiente/);
  assert.match(md, /Idea X/);
});
test('ics: un evento por bloque con hora local', () => {
  const ics = exporters.icsBlocks([{ start: '09:00', end: '10:30', title: 'Foco, API' }], new Date(2026, 8, 28));
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /DTSTART:20260928T090000\r\n/);
  assert.match(ics, /DTEND:20260928T103000\r\n/);
  assert.match(ics, /SUMMARY:🎯 Foco\\, API/);
});

// ---------------- MCP ----------------
test('mcp: initialize, tools/list y tools/call', async () => {
  const init = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, () => null);
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'pm-pollito');
  const list = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, () => null);
  assert.ok(list.result.tools.some((t) => t.name === 'pm_add_task'));
  const call = await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'pm_add_task', arguments: { text: 'x' } } }, async (n, a) => `ok ${n} ${a.text}`);
  assert.equal(call.result.content[0].text, 'ok pm_add_task x');
  const bad = await mcp.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'pm_add_task', arguments: {} } }, async () => { throw new Error('Falta el texto'); });
  assert.equal(bad.result.isError, true);
  assert.equal(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, () => null), null);
  const unknown = await mcp.handle({ jsonrpc: '2.0', id: 5, method: 'resources/list' }, () => null);
  assert.equal(unknown.error.code, -32601);
});

// ---------------- memoria de proyecto ----------------
test('CLAUDE.md: inserta y reemplaza solo el bloque de PM', () => {
  const repo = tmp();
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'jest', build: 'vite build' } }));
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# Mi proyecto\n\nReglas mías.\n');
  const sec = projmem.build({ days: {} }, repo, [{ cmd: 'npm test', line: 'FAIL x' }]);
  assert.match(sec, /`npm test` → jest/);
  projmem.write(repo, sec);
  projmem.write(repo, sec.replace('FAIL x', 'FAIL y'));
  const out = fs.readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8');
  assert.match(out, /Reglas mías\./);
  assert.equal(out.split(projmem.START).length, 2); // un solo bloque
  assert.match(out, /FAIL y/);
});

// ---------------- perfiles ----------------
test('perfiles: crear, cambiar (el pollito viaja) y borrar', () => {
  const dir = tmp();
  const p = profilesMod.create(dir);
  assert.equal(p.active().id, 'default');
  const id = p.add('Personal', '🏠', { pet: { name: 'Kiwi', xp: 5 }, settings: { lang: 'es', mcpToken: 'secreto' } });
  const created = JSON.parse(fs.readFileSync(path.join(dir, p.fileFor(id)), 'utf8'));
  assert.equal(created.settings.mcpToken, undefined);
  p.switchTo(id, { name: 'Kiwi', xp: 99 });
  assert.equal(p.active().id, id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, p.fileFor(id)), 'utf8')).pet.xp, 99);
  assert.throws(() => p.remove(id), /No puedo borrar/);
  p.switchTo('default', { name: 'Kiwi', xp: 100 });
  p.remove(id);
  assert.equal(p.list().list.length, 1);
});

// ---------------- integraciones con Claude (en carpetas temporales) ----------------
test('integraciones: MCP y línea de estado se instalan y se quitan sin tocar lo demás', () => {
  const home = tmp();
  const env = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME, APPDATA: process.env.APPDATA, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
  process.env.USERPROFILE = home; process.env.HOME = home; process.env.APPDATA = path.join(home, 'AppData');
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    delete require.cache[require.resolve('../src/claudeIntegrations')];
    const ci = require('../src/claudeIntegrations');
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { otro: { type: 'stdio', command: 'x' } }, numStartups: 7 }));
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'mi-linea' }, model: 'opus' }));
    ci.installMcpCode('clave');
    let j = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
    assert.equal(j.mcpServers['pm-pollito'].type, 'http');
    assert.equal(j.mcpServers['pm-pollito'].headers.Authorization, 'Bearer clave');
    assert.ok(j.mcpServers.otro && j.numStartups === 7);
    assert.ok(fs.existsSync(path.join(home, '.claude.json.pm-backup')));
    ci.uninstallMcpCode();
    j = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
    assert.equal(j.mcpServers['pm-pollito'], undefined);
    assert.ok(j.mcpServers.otro);
    // Línea de estado: guarda la del usuario y la restaura
    assert.deepEqual(ci.statusInfo(), { installed: false, other: true });
    ci.installStatusLine();
    assert.equal(ci.statusInfo().installed, true);
    ci.uninstallStatusLine();
    const s = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
    assert.equal(s.statusLine.command, 'mi-linea');
    assert.equal(s.model, 'opus');
  } finally {
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

// Resumen redactado del día por proyecto (en vez de copiar tus peticiones tal cual).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ws = require('../src/worksummary');
const report = require('../src/report');

const PROMPTS = {
  pm: [{ text: 'el boton de donacion no hace nada' }, { text: 'revisa el proyecto pm y generame el ejecutable para compartirlo' }, { text: '¿qué más le agregamos?' }],
  'MRP-Planner-UI': [{ text: 'arregla el error al guardar el pedido' }],
  Claude: [{ text: 'hola' }],
};
const COMMITS = [{ repo: 'pm', subject: 'fix: el botón de donación abre PayPal' }, { repo: 'mrp-planner-ui', subject: 'fix(pedidos): guardar con cantidad 0' }];

test('agrupa por proyecto: tiempo, peticiones y commits (sin distinguir mayúsculas)', () => {
  const g = ws.group({ prompts: PROMPTS, commits: COMMITS, secs: { pm: 7800, 'mrp-planner-ui': 2700, Teams: 600, web: 2400 } });
  assert.deepEqual(g.map((x) => [x.project, x.mins, x.prompts.length, x.commits.length]), [['pm', 130, 3, 1], ['MRP-Planner-UI', 45, 1, 1], ['web', 40, 0, 0]]);
  assert.equal(ws.hashOf(g), ws.hashOf(ws.group({ prompts: PROMPTS, commits: COMMITS, secs: { pm: 7810, 'mrp-planner-ui': 2700, web: 2400 } })), 'unos segundos más no cambian el resumen');
});

test('el pedido a Claude: un bloque por proyecto, con sus palabras y sin copiar', () => {
  const p = ws.buildPrompt(ws.group({ prompts: PROMPTS, commits: COMMITS }));
  assert.ok(p.startsWith(ws.MARK), 'marcado para que el diario lo ignore');
  assert.match(p, /primera persona[\s\S]*NO copies/);
  assert.match(p, /## pm\n- pedido: el boton de donacion no hace nada[\s\S]*- commit: fix: el botón de donación abre PayPal/);
  assert.equal(ws.cleanAi('Claro, aquí va:\n\n**📁 pm · 2 h**\nArreglé la donación.\n\n\n\n📁 web\nNada.'), '📁 pm · 2 h\nArreglé la donación.\n\n📁 web\nNada.');
  assert.equal(ws.cleanAi('No puedo.'), '');
});

test('redacción local: frases propias por proyecto, sin pegar las peticiones', () => {
  const t = ws.localSummary(ws.group({ prompts: PROMPTS, commits: COMMITS, secs: { pm: 7800, 'mrp-planner-ui': 2700 } }));
  const blocks = t.split('\n\n');
  assert.equal(blocks.length, 2);
  assert.match(blocks[0], /^📁 pm · 2 h 10 min\n[A-ZÁÉÍÓÚ]/);
  assert.match(blocks[0], /Dejé 1 commit\./);
  assert.match(blocks[1], /^📁 MRP-Planner-UI · 45 min\nCorregí errores/);
  assert.equal(t.includes('no hace nada'), false, 'no copia la petición');
  assert.equal(t.includes('¿qué más'), false);
  assert.equal(ws.topicOf('por favor arregla el login de usuarios y luego los tests'), 'login de usuarios');
  assert.equal(ws.topicOf('feat(api): exportar pedidos a CSV'), 'exportar pedidos a csv');
  assert.equal(ws.topicOf('todo eso'), '');
});

test('daily: el resumen va con el proyecto como subtítulo y frases como viñetas', () => {
  const day = { standup: { yesterday: '📁 pm · 2 h\nArreglé la donación.\n\n✅ Del plan: 2 de 3 tareas hechas.', today: [{ text: 'Deploy', done: false }], help: '' } };
  const t = report.daily(day, new Date(2026, 9, 7), [], { claudeToday: ['📁 web · 1 h', 'Mejoré el login.'] });
  assert.match(t, /✅ \*Ayer:\*\n\*📁 pm · 2 h\*\n• Arreglé la donación\.\n• Del plan: 2 de 3 tareas hechas\./);
  assert.match(t, /🛠️ \*En qué trabajé hoy:\*\n\*📁 web · 1 h\*\n• Mejoré el login\./);
});

// ---------------- el módulo: API, Claude Code o local, y caché ----------------
function fakeM({ ai = null, settings = {}, home }) {
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const data = { settings, days: { [dayKey()]: { projects: { pm: 3600 } } } };
  process.env.CLAUDE_CONFIG_DIR = home;
  return {
    store: { data, save() {} }, TEST: true, os, dayKey, lang: () => 'es', diag: { log() {} },
    aiAvailable: () => !!ai, ai, prod: { commitsBetween: async () => [{ repo: 'pm', subject: 'feat: cola de Claude con límites' }] },
  };
}
function claudeHome(prompts) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ws-'));
  const d = path.join(home, 'projects', 'x');
  fs.mkdirSync(d, { recursive: true });
  const at = new Date().toISOString();
  fs.writeFileSync(path.join(d, 's.jsonl'), prompts.map((t, i) => JSON.stringify({ type: 'user', uuid: 'u' + i, timestamp: at, cwd: path.join(home, 'pm'), message: { role: 'user', content: t } })).join('\n'));
  return home;
}

test('módulo: con la API de Claude, guardado por día y sin repetir el pedido', async () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  try {
    const home = claudeHome(['revisa los límites de la cola', ws.MARK + '\nresume mi día']);
    const asked = [];
    const M = fakeM({ home, ai: { polish: async (p) => { asked.push(p); return '📁 pm · 1 h\nPreparé la cola de Claude para que respete mis límites.'; } } });
    const w = require('../src/main/worksummary')(M);
    const r = await w.get('today');
    assert.deepEqual({ by: r.by, text: r.text }, { by: 'ai', text: '📁 pm · 1 h\nPreparé la cola de Claude para que respete mis límites.' });
    assert.match(asked[0], /- pedido: revisa los límites de la cola/);
    assert.equal(asked[0].split(ws.MARK).length, 2, 'su propia petición de resumen no cuenta como trabajo');
    await w.get('today');
    assert.equal(asked.length, 1, 'si nada cambió, sale de lo guardado');
    await w.get('today', { force: true });
    assert.equal(asked.length, 2);
    assert.deepEqual(w.cachedLines('today'), ['📁 pm · 1 h', 'Preparé la cola de Claude para que respete mis límites.']);
  } finally { if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev; }
});

test('módulo: con Claude Code (Haiku, solo lectura) y, si falla, redacción local', async () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  try {
    const home = claudeHome(['arregla el error al guardar el pedido']);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ws-bin-'));
    const bin = path.join(dir, 'claude.js');
    fs.writeFileSync(path.join(dir, 'args.txt'), '');
    fs.writeFileSync(bin, `let p = ''; process.stdin.on('data', (d) => (p += d)); process.stdin.on('end', () => {
      require('fs').writeFileSync(${JSON.stringify(path.join(dir, 'args.txt'))}, process.argv.slice(2).join(' '));
      console.log(JSON.stringify({ type: 'result', is_error: false, result: 'Listo:\\n📁 pm · 1 h\\nCorregí el guardado de pedidos.', total_cost_usd: 0.002 }));
    });`);
    const M = fakeM({ home, settings: { claudeBin: bin, summaryWithClaude: true } });
    const r = await require('../src/main/worksummary')(M).get('today');
    assert.deepEqual({ by: r.by, text: r.text }, { by: 'claude', text: '📁 pm · 1 h\nCorregí el guardado de pedidos.' });
    assert.match(fs.readFileSync(path.join(dir, 'args.txt'), 'utf8'), /--permission-mode dontAsk --model haiku --max-budget-usd 0\.2/);
    // Sin Claude: redacción local, nunca las peticiones tal cual.
    const M2 = fakeM({ home, settings: {} });
    const r2 = await require('../src/main/worksummary')(M2).get('today');
    assert.equal(r2.by, 'local');
    assert.match(r2.text, /^📁 pm · 1 h\nCorregí errores/);
    assert.equal(r2.text.includes('arregla el error'), false);
  } finally { if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev; }
});

test('encuentra el Claude Code que trae la app de escritorio de Claude (la versión más nueva)', { skip: process.platform !== 'win32' }, () => {
  const runner = require('../src/claudeRunner');
  const appdata = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-appdata-'));
  for (const [v, id] of [['2.1.9', 'aaa'], ['2.1.286', 'bbb'], ['2.1.40', 'ccc'], ['beta', 'zzz']]) {
    fs.mkdirSync(path.join(appdata, 'Claude', 'claude-code', v, id), { recursive: true });
    fs.writeFileSync(path.join(appdata, 'Claude', 'claude-code', v, id, 'claude.exe'), '');
  }
  const prev = process.env.APPDATA;
  const prevPath = process.env.PATH;
  try {
    process.env.APPDATA = appdata;
    process.env.PATH = '';
    const list = runner.bundledByDesktop(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-home-')));
    assert.deepEqual(list.map((p) => path.basename(path.dirname(path.dirname(p)))), ['2.1.286', '2.1.40', '2.1.9']);
    assert.equal(runner.findClaude(), list[0]);
  } finally { process.env.APPDATA = prev; process.env.PATH = prevPath; }
});

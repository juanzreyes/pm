// Diagnóstico: registro local de errores (pm-errors.log) y métricas de la app.
// Nada sale del PC: el informe solo se copia si el usuario pulsa "Copiar informe".
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_BYTES = 256 * 1024;
let file = null;
const recent = []; // últimos errores en memoria (para Ajustes → Diagnóstico)
const startedAt = Date.now();
let lastKey = '';
let lastAt = 0;
const listeners = []; // quién quiere enterarse de cada error nuevo (informe de errores opcional)
/** Avisa de cada error nuevo (no de los eventos 'info'). */
function onError(fn) { listeners.push(fn); }

function init(userDataDir) {
  file = path.join(userDataDir, 'pm-errors.log');
  process.on('uncaughtException', (e) => log('main', e));
  process.on('unhandledRejection', (e) => log('main', e));
}

/** Registra un error. where: 'main' | 'panel' | 'pet' | … */
function log(where, err) {
  const msg = err && err.stack ? err.stack : String(err && err.message ? err.message : err);
  const key = where + msg.slice(0, 200);
  // Evita inundar el log con el mismo error repetido en bucle.
  if (key === lastKey && Date.now() - lastAt < 30000) return;
  lastKey = key;
  lastAt = Date.now();
  const entry = { at: Date.now(), where, msg: msg.slice(0, 2000) };
  recent.push(entry);
  if (recent.length > 40) recent.shift();
  if (where !== 'info') for (const fn of listeners) { try { fn(entry); } catch { /* un oyente roto no rompe el registro */ } }
  if (where === 'main') console.error('[PM]', msg);
  if (!file) return;
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file + '.old');
    fs.appendFileSync(file, `[${new Date(entry.at).toISOString()}] (${where}) ${entry.msg}\n`);
  } catch { /* disco lleno o sin permisos: no podemos hacer más */ }
}

/** Escucha los errores de consola de una ventana. */
function watch(win, name) {
  if (!win) return;
  const who = () => (typeof name === 'function' ? name() : name);
  win.webContents.on('console-message', (...args) => {
    // Electron 33: (event, level, message, line, sourceId) — level 3 = error
    const [, level, message, line, source] = args;
    if (level === 3) log(who(), `${message} (${path.basename(String(source || ''))}:${line})`);
  });
  win.webContents.on('render-process-gone', (_e, d) => log(who(), `Ventana caída: ${d.reason} (${d.exitCode})`));
  win.webContents.on('unresponsive', () => log(who(), 'La ventana dejó de responder'));
}

function fmtMB(kb) { return Math.round(kb / 1024) + ' MB'; }

/** Métricas actuales de la app. */
function metrics(app) {
  const procs = app.getAppMetrics();
  let memKB = 0;
  let cpu = 0;
  for (const p of procs) {
    memKB += (p.memory && p.memory.workingSetSize) || 0;
    cpu += (p.cpu && p.cpu.percentCPUUsage) || 0;
  }
  const up = Math.round((Date.now() - startedAt) / 60000);
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    uptime: up >= 60 ? `${Math.floor(up / 60)} h ${up % 60} min` : `${up} min`,
    memory: fmtMB(memKB),
    memoryKB: memKB,
    cpu: Math.round(cpu * 10) / 10,
    processes: procs.length,
    errors: recent.filter((e) => e.where !== 'info').reverse(),
    events: recent.filter((e) => e.where === 'info').reverse(),
    logFile: file,
  };
}

/** Informe de texto para pegar en un issue o mandarlo a quien te ayude. */
function report(app, extra = {}) {
  const m = metrics(app);
  const L = [
    `PM Pollito ${m.version} · Electron ${m.electron} · ${m.os}`,
    `Activo: ${m.uptime} · Memoria: ${m.memory} · CPU: ${m.cpu}% · Procesos: ${m.processes}`,
    ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
    '',
    `Últimos errores (${m.errors.length}):`,
    ...m.errors.slice(0, 15).map((e) => `- [${new Date(e.at).toLocaleString()}] (${e.where}) ${e.msg.split('\n').slice(0, 3).join(' | ')}`),
    '',
    `Últimos eventos (${m.events.length}):`,
    ...m.events.slice(0, 10).map((e) => `- [${new Date(e.at).toLocaleString()}] ${e.msg}`),
  ];
  // Sin rutas personales en el informe.
  return L.join('\n').split(os.homedir()).join('~');
}

module.exports = { init, log, watch, metrics, report, onError };

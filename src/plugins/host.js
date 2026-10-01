// Proceso anfitrión de UN plugin: carga su código y le da el objeto `pm` (la API de PM Pollito).
// Corre aparte de PM (utilityProcess de Electron, o child_process en los tests): si el plugin
// se cuelga o falla, PM sigue funcionando. Mensajes con PM: { t: tipo, ... }.
const path = require('path');

const parent = process.parentPort; // utilityProcess
const send = (msg) => (parent ? parent.postMessage(msg) : process.send(msg));
const onMessage = (fn) => (parent ? parent.on('message', (e) => fn(e.data)) : process.on('message', fn));

const [main] = process.argv.slice(2);
const handlers = {}; // evento → [fn]
const commands = {}; // id → fn
const pending = {}; // id de petición → resolve
let seq = 0;
const ask = (t, data) => new Promise((resolve) => { const rid = ++seq; pending[rid] = resolve; send({ t, rid, ...data }); });

const pm = {
  say: (text) => send({ t: 'say', text: String(text) }),
  addTask: (text) => send({ t: 'task', text: String(text) }),
  addNote: (text) => send({ t: 'note', text: String(text) }),
  /** pm.registerCommand({ id, label, icon }, () => …): aparece en la paleta (Ctrl+Alt+Espacio). */
  registerCommand: (def, fn) => { commands[def.id] = fn; send({ t: 'command', id: String(def.id), label: String(def.label || def.id), icon: String(def.icon || '🧩') }); },
  /** pm.on('task:done' | 'focus:start' | 'focus:end' | 'pomodoro:done' | 'claude:done' | 'day:start', (data) => …) */
  on: (event, fn) => { (handlers[event] = handlers[event] || []).push(fn); send({ t: 'subscribe', event }); },
  getStatus: () => ask('status'),
  storage: { get: (key) => ask('storage:get', { key: String(key) }), set: (key, value) => ask('storage:set', { key: String(key), value }) },
  log: (...a) => send({ t: 'log', text: a.map(String).join(' ').slice(0, 500) }),
};

async function safe(fn, ...a) {
  try { await fn(...a); } catch (e) { send({ t: 'error', text: (e && e.stack) || String(e) }); }
}
// Eventos y comandos se atienden de uno en uno y en orden (si no, dos "tarea hecha" seguidas
// leerían el mismo contador). Las respuestas de PM pasan directo: las espera quien está en curso.
let queue = Promise.resolve();
onMessage((m) => {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'reply' && pending[m.rid]) { pending[m.rid](m.value); delete pending[m.rid]; return; }
  queue = queue.then(async () => {
    if (m.t === 'event') for (const fn of handlers[m.event] || []) await safe(fn, m.data);
    if (m.t === 'run' && commands[m.id]) await safe(commands[m.id]);
  });
});

process.on('uncaughtException', (e) => send({ t: 'error', text: (e && e.stack) || String(e) }));
process.on('unhandledRejection', (e) => send({ t: 'error', text: (e instanceof Error && e.stack) || String(e) }));

(async () => {
  try {
    const mod = require(path.resolve(main));
    const activate = typeof mod === 'function' ? mod : mod && mod.activate;
    if (typeof activate !== 'function') throw new Error('El plugin debe exportar una función activate(pm)');
    await activate(pm);
    send({ t: 'ready' });
  } catch (e) {
    send({ t: 'error', text: (e && e.stack) || String(e), fatal: true });
  }
})();

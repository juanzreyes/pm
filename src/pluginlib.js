// Plugins de PM Pollito (2.0): validación del plugin.json y permisos. Lógica pura.
// Un plugin es una carpeta en <datos de PM>/plugins/<id>/ con plugin.json y su código.
// Corre en un proceso aparte (src/plugins/host.js) y solo usa la API de PM para la que pidió permiso.
const path = require('path');

const PERMS = {
  say: '💬 Hablar por el pollito (burbujas)',
  tasks: '✅ Añadir tareas a tu día',
  notes: '📝 Escribir en tus notas de hoy',
  commands: '⌨️ Añadir comandos a la paleta',
  events: '🔔 Enterarse de lo que pasa (tareas hechas, foco, pomodoros, Claude)',
  status: '📊 Leer tu estado (límites de Claude, tareas de hoy, foco)',
  storage: '💾 Guardar sus propios datos',
};
const EVENTS = ['task:done', 'focus:start', 'focus:end', 'pomodoro:done', 'claude:done', 'day:start'];

/** Valida plugin.json. Devuelve { ok, plugin } o { ok: false, error }. */
function parseManifest(raw, dir) {
  let j;
  try { j = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return { ok: false, error: 'plugin.json no es JSON válido: ' + e.message }; }
  if (!j || typeof j !== 'object') return { ok: false, error: 'plugin.json vacío' };
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(j.id || '')) return { ok: false, error: '"id" debe ser de 3 a 40 letras minúsculas, números o guiones' };
  if (!j.name || typeof j.name !== 'string') return { ok: false, error: 'Falta "name"' };
  const main = String(j.main || 'index.js');
  const abs = path.resolve(dir, main);
  if (!abs.startsWith(path.resolve(dir) + path.sep)) return { ok: false, error: '"main" debe estar dentro de la carpeta del plugin' };
  const perms = Array.isArray(j.permissions) ? j.permissions : [];
  const bad = perms.filter((p) => !PERMS[p]);
  if (bad.length) return { ok: false, error: `Permisos desconocidos: ${bad.join(', ')}` };
  return {
    ok: true,
    plugin: {
      id: j.id, name: String(j.name).slice(0, 60), version: String(j.version || '0.0.0').slice(0, 20), description: String(j.description || '').slice(0, 300),
      author: String(j.author || '').slice(0, 60), main: abs, dir: path.resolve(dir), permissions: [...new Set(perms)],
    },
  };
}
/** Texto del permiso para pedírtelo antes de activar el plugin. */
const describePerms = (perms) => perms.map((p) => PERMS[p] || p);
/** ¿Puede este plugin hacer esta acción? */
const ACTION_PERM = { say: 'say', task: 'tasks', note: 'notes', command: 'commands', subscribe: 'events', status: 'status', 'storage:get': 'storage', 'storage:set': 'storage' };
const allowed = (plugin, type) => !!ACTION_PERM[type] && plugin.permissions.includes(ACTION_PERM[type]);

module.exports = { PERMS, EVENTS, parseManifest, describePerms, allowed };

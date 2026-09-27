// Servidor MCP del pollito (Model Context Protocol, JSON-RPC 2.0).
// Claude Code se conecta por HTTP local (127.0.0.1) con una clave secreta; Claude Desktop, con
// el puente de stdio (mcp/bridge.js). Así Claude puede leer y actualizar tus tareas, la cola, etc.
const PROTOCOL = '2025-06-18';
const SUPPORTED = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);

// Herramientas: nombre, descripción (para Claude) y esquema de entrada.
const TOOLS = [
  { name: 'pm_status', description: 'Estado actual del usuario según su pollito PM: uso de los límites de Claude (sesión y semanal, predicción), tareas de hoy, pomodoro, modo foco, presupuesto y reuniones.', inputSchema: { type: 'object', properties: {} } },
  { name: 'pm_list_tasks', description: 'Lista las tareas de hoy del usuario con su índice, si están hechas, prioridad y días que llevan pospuestas.', inputSchema: { type: 'object', properties: {} } },
  { name: 'pm_add_task', description: 'Añade una tarea a la lista de hoy del usuario.', inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Texto de la tarea' } }, required: ['text'] } },
  { name: 'pm_complete_task', description: 'Marca como hecha una tarea de hoy, por su índice (de pm_list_tasks) o por parte de su texto.', inputSchema: { type: 'object', properties: { index: { type: 'integer' }, text: { type: 'string' } } } },
  { name: 'pm_add_reminder', description: 'Crea un recordatorio en lenguaje natural, p. ej. "en 20 min revisar el deploy" o "a las 17:00 enviar el informe".', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'pm_queue_add', description: 'Añade una petición a la cola de trabajo pendiente para Claude (el pollito la recordará cuando Claude termine).', inputSchema: { type: 'object', properties: { text: { type: 'string' }, project: { type: 'string' } }, required: ['text'] } },
  { name: 'pm_queue_list', description: 'Lista las peticiones pendientes en la cola para Claude.', inputSchema: { type: 'object', properties: {} } },
  { name: 'pm_add_note', description: 'Añade una línea a las notas de hoy del usuario (decisiones, enlaces, ideas).', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'pm_log_progress', description: 'Informa al usuario de un avance importante mediante su pollito (aparece en un bocadillo en el escritorio). Úsalo con moderación.', inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } },
  { name: 'pm_start_focus', description: 'Activa el modo foco del usuario (solo avisos urgentes) durante unos minutos.', inputSchema: { type: 'object', properties: { minutes: { type: 'integer', minimum: 5, maximum: 240 } } } },
  { name: 'pm_milestones', description: 'Hitos y fechas de entrega de los proyectos, con días restantes y estado (en plazo, justo, atrasado).', inputSchema: { type: 'object', properties: {} } },
  { name: 'pm_weekly_report', description: 'Informe de la semana: tareas, horas de foco, proyectos, commits y uso de Claude.', inputSchema: { type: 'object', properties: {} } },
  { name: 'pm_project_memory', description: 'Contexto del proyecto que guarda PM: comandos de test/build detectados, errores frecuentes, decisiones anotadas y tiempo dedicado. Útil para entender el proyecto.', inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Nombre de la carpeta del repositorio' } }, required: ['project'] } },
];

/**
 * Procesa un mensaje JSON-RPC. run(name, args) ejecuta la herramienta y devuelve texto u objeto.
 * Devuelve la respuesta (o null si era una notificación).
 */
async function handle(msg, run, info = {}) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return { jsonrpc: '2.0', id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32600, message: 'Invalid Request' } };
  }
  const isNotification = msg.id === undefined || msg.id === null;
  const ok = (result) => (isNotification ? null : { jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => (isNotification ? null : { jsonrpc: '2.0', id: msg.id, error: { code, message } });
  switch (msg.method) {
    case 'initialize': {
      const want = msg.params && msg.params.protocolVersion;
      return ok({
        protocolVersion: SUPPORTED.has(want) ? want : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'pm-pollito', title: 'PM Pollito', version: info.version || '1.0.0' },
        instructions: 'PM Pollito es el Project Manager de escritorio del usuario. Úsalo para consultar o actualizar sus tareas, cola de trabajo para Claude, notas, recordatorios y límites de uso. Habla en el idioma del usuario.',
      });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call': {
      const name = msg.params && msg.params.name;
      if (!TOOLS.some((t) => t.name === name)) return fail(-32602, `Herramienta desconocida: ${name}`);
      try {
        const out = await run(name, (msg.params && msg.params.arguments) || {});
        const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
        return ok({ content: [{ type: 'text', text }], isError: false });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
      }
    }
    default:
      return fail(-32601, `Método no soportado: ${msg.method}`);
  }
}

module.exports = { handle, TOOLS, PROTOCOL };

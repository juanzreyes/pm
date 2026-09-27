// Chat con IA real (Claude) usando la API key del usuario y el SDK oficial.
// El pollito puede actuar con herramientas: añadir/completar tareas, crear recordatorios
// y empezar un pomodoro.
const AnthropicMod = require('@anthropic-ai/sdk');
const Anthropic = AnthropicMod.default || AnthropicMod;

const MODELS = {
  'claude-opus-5': 'Claude Opus 5 (más listo)',
  'claude-sonnet-5': 'Claude Sonnet 5 (equilibrado)',
  'claude-haiku-4-5': 'Claude Haiku 4.5 (más barato)',
};
const DEFAULT_MODEL = 'claude-opus-5';

const TOOLS = [
  {
    name: 'add_task',
    description: 'Añade una tarea a la lista de hoy del usuario.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Texto corto de la tarea' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'complete_task',
    description: 'Marca como hecha una tarea de hoy, por su número (empezando en 1) en la lista del contexto.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { number: { type: 'integer', description: 'Número de la tarea (1 = primera)' } },
      required: ['number'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_reminder',
    description: 'Crea un recordatorio que el pollito avisará a una hora concreta.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Qué hay que recordar' },
        at: { type: 'string', description: 'Fecha y hora local ISO 8601 sin zona, p. ej. 2026-09-26T15:30:00' },
      },
      required: ['text', 'at'],
      additionalProperties: false,
    },
  },
  {
    name: 'start_pomodoro',
    description: 'Empieza un pomodoro de 25 minutos de concentración.',
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
];

function systemPrompt(name, lang) {
  const es = lang !== 'en';
  return es
    ? `Eres ${name}, un pollito tamagotchi que vive en el escritorio del usuario y hace de Project Manager personal. ` +
        'Eres tierno, gracioso y directo; hablas en español, con frases cortas y algún emoji (sin pasarte). ' +
        'Tu trabajo: ayudar a organizar el día, priorizar tareas, vigilar el consumo de Claude y animar al usuario. ' +
        'Cada mensaje del usuario llega con un bloque <contexto> con datos reales de su día; úsalo, no inventes datos. ' +
        'Cuando el usuario pida algo que tus herramientas pueden hacer (tareas, recordatorios, pomodoro), usa la herramienta en vez de solo decirlo. ' +
        'Respuestas breves: casi siempre menos de 80 palabras, salvo que pidan un resumen o un plan.'
    : `You are ${name}, a tamagotchi chick living on the user's desktop and acting as their personal Project Manager. ` +
        'You are cute, funny and direct; you speak English in short sentences with the occasional emoji. ' +
        "Your job: help organize the day, prioritize tasks, keep an eye on the user's Claude usage and cheer them on. " +
        'Every user message comes with a <context> block holding real data about their day; use it and never make data up. ' +
        'When the user asks for something your tools can do (tasks, reminders, pomodoro), call the tool instead of just saying it. ' +
        'Keep answers short: usually under 80 words unless they ask for a summary or plan.';
}

/**
 * Crea el cliente de chat.
 * io: { apiKey(), model(), lang(), name(), context() -> string, actions: { addTask, completeTask, addReminder, startPomodoro } }
 */
function create(io) {
  const history = []; // turnos anteriores solo en texto (usuario / asistente)

  function client() {
    const key = io.apiKey();
    if (!key) return null;
    return new Anthropic({ apiKey: key, timeout: 60000, maxRetries: 2 });
  }

  async function runTool(block) {
    const input = block.input || {};
    try {
      switch (block.name) {
        case 'add_task':
          if (typeof input.text !== 'string' || !input.text.trim()) throw new Error('text vacío');
          io.actions.addTask(input.text.trim());
          return `Tarea añadida: ${input.text.trim()}`;
        case 'complete_task':
          if (!Number.isInteger(input.number)) throw new Error('number no es entero');
          return io.actions.completeTask(input.number - 1) ? 'Tarea marcada como hecha' : 'No existe esa tarea';
        case 'add_reminder': {
          const at = Date.parse(input.at);
          if (!input.text || Number.isNaN(at)) throw new Error('fecha inválida');
          io.actions.addReminder(at, String(input.text));
          return `Recordatorio creado para ${new Date(at).toLocaleString('es')}`;
        }
        case 'start_pomodoro':
          io.actions.startPomodoro();
          return 'Pomodoro iniciado';
        default:
          throw new Error('herramienta desconocida');
      }
    } catch (e) {
      return { error: e.message };
    }
  }

  /** Envía un mensaje. Devuelve { text } o lanza un Error con mensaje entendible. */
  async function chat(userText) {
    const c = client();
    if (!c) throw new Error('NO_KEY');
    const model = io.model() || DEFAULT_MODEL;
    const lang = io.lang();
    const tag = lang === 'en' ? 'context' : 'contexto';

    const messages = [
      ...history.slice(-12),
      { role: 'user', content: `<${tag}>\n${io.context()}\n</${tag}>\n\n${userText}` },
    ];

    const params = {
      model,
      max_tokens: 4000,
      system: systemPrompt(io.name(), lang),
      tools: TOOLS,
      messages,
    };
    const isHaiku = model.startsWith('claude-haiku');
    if (!isHaiku) params.output_config = { effort: 'low' }; // chat corto: rápido y barato

    const send = (p) => (model === 'claude-opus-5'
      // Opus 5: si el servidor rechaza por política, reintenta automáticamente con otro modelo.
      ? c.beta.messages.create({ ...p, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : c.messages.create(p));

    let finalText = '';
    for (let i = 0; i < 5; i++) {
      let res;
      try {
        res = await send(params);
      } catch (e) {
        throw new Error(friendly(e));
      }
      if (res.stop_reason === 'refusal') {
        finalText = lang === 'en' ? "I can't help with that one 🐣" : 'Eso no puedo hacerlo 🐣';
        break;
      }
      const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (text) finalText = text;
      if (res.stop_reason !== 'tool_use') break; // end_turn, max_tokens, etc.

      // Ejecuta las herramientas y devuelve TODOS los resultados en un solo mensaje.
      const uses = res.content.filter((b) => b.type === 'tool_use');
      const results = [];
      for (const u of uses) {
        const out = await runTool(u);
        results.push(typeof out === 'string'
          ? { type: 'tool_result', tool_use_id: u.id, content: out }
          : { type: 'tool_result', tool_use_id: u.id, content: out.error, is_error: true });
      }
      params.messages = [...params.messages, { role: 'assistant', content: res.content }, { role: 'user', content: results }];
    }

    history.push({ role: 'user', content: userText }, { role: 'assistant', content: finalText || '…' });
    while (history.length > 24) history.shift();
    return { text: finalText || '✅' };
  }

  /** Mejora un texto (daily / informe) con IA. */
  async function polish(text, instruction) {
    const c = client();
    if (!c) throw new Error('NO_KEY');
    const model = io.model() || DEFAULT_MODEL;
    const p = {
      model,
      max_tokens: 4000,
      messages: [{ role: 'user', content: `${instruction}\n\nDevuelve SOLO el texto final, sin comentarios.\n\n---\n${text}` }],
    };
    if (!model.startsWith('claude-haiku')) p.output_config = { effort: 'low' };
    let res;
    try {
      res = model === 'claude-opus-5'
        ? await c.beta.messages.create({ ...p, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : await c.messages.create(p);
    } catch (e) {
      throw new Error(friendly(e));
    }
    if (res.stop_reason === 'refusal') throw new Error('La IA no quiso procesar ese texto.');
    return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  }

  function friendly(e) {
    if (e instanceof Anthropic.AuthenticationError) return 'La API key no es válida. Revísala en 🐣 Perfil → IA.';
    if (e instanceof Anthropic.PermissionDeniedError) return 'Tu API key no tiene permiso para este modelo.';
    if (e instanceof Anthropic.RateLimitError) return 'Demasiadas peticiones o sin saldo en la API. Prueba en un rato.';
    if (e instanceof Anthropic.BadRequestError) return 'Petición rechazada por la API: ' + e.message;
    if (e instanceof Anthropic.APIConnectionError) return 'No pude conectar con la API de Claude. ¿Hay internet?';
    if (e instanceof Anthropic.APIError) return `Error de la API (${e.status}): ${e.message}`;
    return e.message || String(e);
  }

  return { chat, polish, reset: () => { history.length = 0; } };
}

module.exports = { create, MODELS, DEFAULT_MODEL };

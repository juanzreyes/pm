// Avisos fuera del PC: canal del equipo (Slack, Teams, Discord) y tu celular (ntfy o Telegram).
// Solo formatea y envía; qué se manda y cuándo lo decide src/main/remote.js.
// `http` (fetch) se inyecta en los tests.

/** Tipo de webhook según su URL. */
function kind(url) {
  const u = String(url || '');
  if (/hooks\.slack\.com\//i.test(u)) return 'slack';
  if (/discord(app)?\.com\/api\/webhooks\//i.test(u)) return 'discord';
  if (/(webhook\.office\.com|\.logic\.azure\.com|powerautomate|powerplatform\.com|environment\.api\.powerplatform)/i.test(u)) return 'teams';
  return 'generic';
}

/** El daily y el informe usan *negrita* de Slack; Teams y Discord la escriben **así**. */
const boldMd = (s) => s.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,:;!?])/gm, '$1**$2**');

/** Cuerpo del mensaje para cada tipo de webhook. msg: { title, text, url? } */
function webhookPayload(k, msg) {
  const title = String(msg.title || '').trim();
  const text = k === 'teams' || k === 'discord' ? boldMd(String(msg.text || '').trim()) : String(msg.text || '').trim();
  if (k === 'slack') {
    // Slack: *negrita* y enlaces <url|texto>.
    return { text: [title && `*${title}*`, text, msg.url && `<${msg.url}|Abrir>`].filter(Boolean).join('\n') };
  }
  if (k === 'discord') return { content: [title && `**${title}**`, text, msg.url].filter(Boolean).join('\n').slice(0, 2000) };
  if (k === 'teams') {
    // Teams (flujo "Publicar en un canal cuando se recibe una solicitud de webhook"): tarjeta adaptable.
    const body = [];
    if (title) body.push({ type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true });
    if (text) body.push({ type: 'TextBlock', text, wrap: true });
    const card = { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body };
    if (msg.url) card.actions = [{ type: 'Action.OpenUrl', title: 'Abrir', url: msg.url }];
    return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: card }] };
  }
  return { title, text, url: msg.url || undefined, source: 'pm-pollito' };
}

async function post(http, url, body, headers = {}) {
  const res = await http(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? ': ' + t.slice(0, 140) : ''}`);
  }
  return res;
}

/**
 * ¿Es un enlace que NO sirve como webhook? (el del canal, el de la app, el del editor del flujo…)
 * Devuelve el motivo para mostrarlo, o '' si parece una URL de webhook.
 */
function wrongWebhookLink(url) {
  const u = String(url || '').trim();
  if (/teams\.(microsoft|live|cloud\.microsoft)\.com\/l\/(channel|team|app|chat|entity|message)\//i.test(u) || /teams\.microsoft\.com\/(v2|_#)/i.test(u)) {
    return 'Ese es el enlace del canal o de la app de Teams, no el del flujo. En Teams: el canal → ⋯ → Flujos de trabajo → abre tu flujo → en el paso "Cuando se recibe una solicitud de webhook de Teams", copia la "URL de HTTP POST".';
  }
  if (/make\.powerautomate\.com|flow\.microsoft\.com|make\.powerapps\.com/i.test(u) && !/\/workflows\/[^/]+\/triggers\//i.test(u)) {
    return 'Ese es el enlace para editar el flujo en Power Automate, no la URL del disparador. Abre el paso "Cuando se recibe una solicitud de webhook de Teams" y copia la "URL de HTTP POST".';
  }
  if (/hooks\.slack\.com\/(apps|services)?$/i.test(u) || /slack\.com\/(app|archives)\//i.test(u)) return 'Ese es el enlace del canal de Slack. Crea un "Incoming Webhook" y copia su URL (empieza por https://hooks.slack.com/services/…).';
  if (/discord\.com\/channels\//i.test(u)) return 'Ese es el enlace del canal de Discord. En el canal → Editar → Integraciones → Webhooks → Copiar URL del webhook.';
  return '';
}

/** Un error del webhook explicado en cristiano (sobre todo los de los flujos de Teams). */
function explainWebhookError(k, status, body = '') {
  const b = String(body || '');
  if (k === 'teams') {
    if (status === 401 || status === 403 || /DirectApiAuthorizationRequired|AuthorizationFailed|InvalidAuthenticationToken|Unauthorized/i.test(b)) {
      return `Teams rechazó el mensaje (HTTP ${status}): el flujo pide iniciar sesión. En Power Automate abre el flujo → paso "Cuando se recibe una solicitud de webhook de Teams" → "¿Quién puede desencadenar el flujo?" → "Cualquiera" → Guardar.`;
    }
    if (status === 404) return `Teams no encuentra el flujo (HTTP 404): está apagado, se borró o la URL quedó incompleta. Actívalo en Power Automate (Mis flujos → Activar) y vuelve a copiar la "URL de HTTP POST" entera.`;
    if (status === 400 || /TriggerInputSchemaMismatch|InvalidRequestContent/i.test(b)) {
      return `Teams no entendió el mensaje (HTTP ${status}): el flujo no usa la plantilla "Publicar en un canal cuando se recibe una solicitud de webhook" o se cambió su esquema. Crea el flujo desde esa plantilla sin modificar el disparador.`;
    }
    if (status === 429) return 'Teams pidió esperar (HTTP 429: demasiados mensajes seguidos). Prueba en un minuto.';
    if (status >= 500) return `El flujo recibió el mensaje pero falló al publicarlo (HTTP ${status}). En Power Automate → el flujo → Historial de ejecuciones verás el paso que falló; suele ser que la cuenta del flujo no es miembro del equipo o del canal.`;
  }
  return `HTTP ${status}${b ? ': ' + b.slice(0, 140) : ''}`;
}

async function sendWebhook(url, msg, http = fetch) {
  if (!/^https:\/\//i.test(url || '')) throw new Error('La URL del webhook debe empezar por https://');
  const wrong = wrongWebhookLink(url);
  if (wrong) throw new Error(wrong);
  const k = kind(url);
  const res = await http(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(webhookPayload(k, msg)) });
  if (!res.ok) throw new Error(explainWebhookError(k, res.status, await res.text().catch(() => '')));
  return res;
}

/** ntfy: se publica en JSON para que los emojis del título lleguen bien. */
function sendNtfy(cfg, msg, http = fetch) {
  const server = String(cfg.server || 'https://ntfy.sh').replace(/\/+$/, '');
  if (!cfg.topic) return Promise.reject(new Error('Falta el tema de ntfy'));
  return post(http, server, {
    topic: cfg.topic, title: msg.title || 'PM Pollito', message: msg.text || '', priority: msg.urgent ? 4 : 3,
    tags: msg.tags || undefined, click: msg.url || undefined,
  }, cfg.auth ? { Authorization: `Bearer ${cfg.auth}` } : {});
}

const tgUrl = (token, method) => `https://api.telegram.org/bot${token}/${method}`;
function sendTelegram(cfg, msg, http = fetch) {
  if (!cfg.token || !cfg.chatId) return Promise.reject(new Error('Telegram sin vincular'));
  const text = [msg.title, msg.text, msg.url].filter(Boolean).join('\n').slice(0, 4000);
  return post(http, tgUrl(cfg.token, 'sendMessage'), { chat_id: cfg.chatId, text, disable_web_page_preview: true });
}

/** Mensajes nuevos del bot (espera hasta `wait` s si no hay ninguno). */
async function telegramUpdates(token, offset, wait = 25, http = fetch, signal) {
  const res = await http(`${tgUrl(token, 'getUpdates')}?timeout=${wait}&offset=${offset || 0}&allowed_updates=%5B%22message%22%5D`, { signal });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.description || `HTTP ${res.status}`);
  return j.result || [];
}

/** Qué quiere hacer un mensaje que te llega por Telegram. */
function parseTelegram(text) {
  const t = String(text || '').trim();
  const m = t.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/);
  if (!m) return { cmd: 'capture', arg: t };
  const c = m[1].toLowerCase();
  const arg = m[2].trim();
  if (['start', 'ayuda', 'help'].includes(c)) return { cmd: 'help', arg };
  if (['estado', 'status', 'uso'].includes(c)) return { cmd: 'status', arg };
  if (['tareas', 'tasks', 'hoy'].includes(c)) return { cmd: 'tasks', arg };
  if (['hecha', 'done', 'lista'].includes(c)) return { cmd: 'done', arg };
  if (['cola', 'claude', 'queue'].includes(c)) return { cmd: 'queue', arg };
  if (['tarea', 'task', 'anota'].includes(c)) return { cmd: 'capture', arg };
  return { cmd: 'unknown', arg: c };
}

/**
 * ¿A dónde va un aviso del pollito? Devuelve { team, phone }.
 * s: ajustes; away: llevas un rato sin tocar el PC.
 */
function route(cat, raw, s, away) {
  const text = String(raw || '');
  const phoneCats = s.phoneCats || ['claude', 'meeting', 'reminder', 'usage'];
  const teamCats = s.teamCats || ['monitor', 'ci'];
  const important = {
    claude: /(terminó|necesita|esperando|Terminé|falló|no pude)/i.test(text),
    meeting: /^(📅|🎧)/.test(text) && !/Reunión terminada/.test(text),
    reminder: /^⏰/.test(text) && !/(Anotado|Te lo recuerdo en)/.test(text), // el recordatorio al sonar, no la confirmación
    usage: /(Alerta|100%|90%|🔮|presupuesto)/.test(text),
    monitor: /^(🔴|🟢)/.test(text),
    ci: cat === 'github' && /Falló el CI/.test(text),
    tickets: cat === 'tickets',
  };
  const phoneKey = cat === 'github' ? 'ci' : cat;
  const phoneOn = !!s.phone && phoneCats.includes(phoneKey) && !!important[phoneKey] && (s.phoneWhen === 'always' || away);
  const teamKey = cat === 'github' ? 'ci' : cat;
  const teamOn = !!s.team && teamCats.includes(teamKey) && !!important[teamKey];
  return { team: teamOn, phone: phoneOn };
}

module.exports = { kind, webhookPayload, sendWebhook, wrongWebhookLink, explainWebhookError, sendNtfy, sendTelegram, telegramUpdates, parseTelegram, route };

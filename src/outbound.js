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

function sendWebhook(url, msg, http = fetch) {
  if (!/^https:\/\//i.test(url || '')) return Promise.reject(new Error('La URL del webhook debe empezar por https://'));
  return post(http, url, webhookPayload(kind(url), msg));
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

module.exports = { kind, webhookPayload, sendWebhook, sendNtfy, sendTelegram, telegramUpdates, parseTelegram, route };

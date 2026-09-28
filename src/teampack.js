// "Paquete de equipo": la configuración compartida en un archivo (pm-equipo.json) para que cada
// persona del equipo la importe en un clic. Lleva lo común (URL de Jira / Azure DevOps, IDs de
// Microsoft y Google, canal del equipo y horarios) y NUNCA tokens personales.
// El webhook del canal solo viaja si quien exporta lo pide (es un secreto compartido del equipo).

const KIND = 'pm-pollito-team';

/**
 * Arma el paquete. s: ajustes; oauth: { microsoft: {clientId, tenant}, google: {clientId, clientSecret} };
 * opts: { name, webhook (URL en claro, solo si se incluye) }.
 */
function build(s, oauth = {}, opts = {}) {
  const t = s.trackers || {};
  const pack = { kind: KIND, version: 1, name: String(opts.name || '').slice(0, 80), createdAt: new Date().toISOString() };
  const trackers = {};
  if (t.jira && t.jira.site) trackers.jira = { site: t.jira.site, cloud: !!t.jira.email };
  if (t.azure && t.azure.org) trackers.azure = { org: t.azure.org };
  if (t.github && t.github.on) trackers.github = { on: true };
  if (t.linear && t.linear.tokenEnc) trackers.linear = { on: true };
  if (Object.keys(trackers).length) pack.trackers = trackers;
  const o = {};
  if (oauth.microsoft && oauth.microsoft.clientId) o.microsoft = { clientId: oauth.microsoft.clientId, ...(oauth.microsoft.tenant ? { tenant: oauth.microsoft.tenant } : {}) };
  // El "secreto" de una app de escritorio de Google no protege nada (va dentro de cada instalación).
  if (oauth.google && oauth.google.clientId) o.google = { clientId: oauth.google.clientId, ...(oauth.google.clientSecret ? { clientSecret: oauth.google.clientSecret } : {}) };
  if (Object.keys(o).length) pack.oauth = o;
  const team = {};
  if (opts.webhook) team.webhook = opts.webhook;
  if (s.teamDaily) team.daily = s.teamDaily;
  if (s.teamWeekly) team.weekly = true;
  if (Array.isArray(s.teamCats)) team.cats = s.teamCats;
  if (Object.keys(team).length) pack.team = team;
  const routine = {};
  if (s.morningTime) routine.morningTime = s.morningTime;
  if (s.eveningTime) routine.eveningTime = s.eveningTime;
  if (s.workdaysOnly) routine.workdaysOnly = true;
  if (Object.keys(routine).length) pack.routine = routine;
  return pack;
}

const hhmm = (v) => /^\d{2}:\d{2}$/.test(v || '');
const https = (v) => /^https:\/\/[^\s]+$/i.test(v || '');

/** Comprueba el archivo y devuelve el paquete limpio (solo campos conocidos y con formato válido). */
function parse(text) {
  let p;
  try { p = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('El archivo no es un JSON válido'); }
  if (!p || p.kind !== KIND) throw new Error('Este archivo no es una configuración de equipo de PM Pollito');
  if (p.version !== 1) throw new Error('Versión de configuración desconocida: actualiza PM');
  const out = { name: String(p.name || '').slice(0, 80) };
  const t = p.trackers || {};
  out.trackers = {};
  if (t.jira && https(t.jira.site)) out.trackers.jira = { site: t.jira.site.replace(/\/+$/, ''), cloud: t.jira.cloud !== false };
  if (t.azure && https(t.azure.org)) out.trackers.azure = { org: t.azure.org.replace(/\/+$/, '') };
  if (t.github && t.github.on) out.trackers.github = { on: true };
  if (t.linear && t.linear.on) out.trackers.linear = { on: true };
  const o = p.oauth || {};
  out.oauth = {};
  if (o.microsoft && /^[0-9a-f-]{36}$/i.test(o.microsoft.clientId || '')) out.oauth.microsoft = { clientId: o.microsoft.clientId, tenant: /^[\w.-]+$/.test(o.microsoft.tenant || '') ? o.microsoft.tenant : '' };
  if (o.google && /\.apps\.googleusercontent\.com$/.test(o.google.clientId || '')) out.oauth.google = { clientId: o.google.clientId, clientSecret: String(o.google.clientSecret || '') };
  const tm = p.team || {};
  out.team = {};
  if (https(tm.webhook)) out.team.webhook = tm.webhook;
  if (hhmm(tm.daily)) out.team.daily = tm.daily;
  if (tm.weekly) out.team.weekly = true;
  if (Array.isArray(tm.cats)) out.team.cats = tm.cats.filter((c) => ['monitor', 'ci', 'tickets'].includes(c));
  const r = p.routine || {};
  out.routine = {};
  if (hhmm(r.morningTime)) out.routine.morningTime = r.morningTime;
  if (hhmm(r.eveningTime)) out.routine.eveningTime = r.eveningTime;
  if (r.workdaysOnly) out.routine.workdaysOnly = true;
  return out;
}

/**
 * Qué falta por hacer tras importar: la lista de "tu parte" (tokens personales) para guiar a la persona.
 */
function todo(pack) {
  const L = [];
  if (pack.trackers.jira) L.push(`🟦 Jira (${pack.trackers.jira.site}): pega tu API token${pack.trackers.jira.cloud ? ' y tu correo' : ''}`);
  if (pack.trackers.azure) L.push(`🔷 Azure DevOps (${pack.trackers.azure.org}): pega tu token personal (PAT)`);
  if (pack.trackers.github) L.push('🐙 GitHub: pega tu token personal');
  if (pack.trackers.linear) L.push('🟪 Linear: pega tu API key');
  if (pack.oauth.microsoft) L.push('📅 Microsoft 365: pulsa "Conectar con Microsoft" en 📬 Agenda');
  if (pack.oauth.google) L.push('📅 Google: pulsa "Conectar con Google" en 📬 Agenda');
  return L;
}

module.exports = { KIND, build, parse, todo };

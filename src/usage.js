// Lectura del consumo de Claude.
//  1) Límites reales del plan (sesión de 5 h, semanal...) vía la cuenta de Claude
//     usando la sesión de Claude Code (~/.claude/.credentials.json) o un token manual.
//  2) Estadísticas locales (tokens, mensajes, modelos) a partir de los registros
//     de Claude Code en ~/.claude/projects. Siempre funcionan, incluso sin conexión.
const fs = require('fs');
const path = require('path');
const os = require('os');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

const LABELS = {
  five_hour: 'Sesión actual (5 h)',
  seven_day: 'Semanal · todos los modelos',
  seven_day_opus: 'Semanal · Opus',
  seven_day_sonnet: 'Semanal · Sonnet',
  seven_day_oauth_apps: 'Semanal · apps',
};

function prettyKey(k) {
  return LABELS[k] || k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Lee la sesión de Claude Code. Nunca se registra ni se envía a otro sitio. */
function readClaudeCodeSession() {
  const file = path.join(claudeDir(), '.credentials.json');
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const o = j.claudeAiOauth;
    if (!o || !o.accessToken) return { found: false, file };
    return {
      found: true,
      file,
      token: o.accessToken,
      expiresAt: o.expiresAt || null,
      plan: o.subscriptionType || null,
      tier: o.rateLimitTier || null,
    };
  } catch {
    return { found: false, file };
  }
}

async function fetchLimits(token) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
        'User-Agent': 'pm-pollito/1.0',
      },
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).error.message; } catch { /* texto plano */ }
      const err = new Error(msg || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return parseLimits(JSON.parse(text));
  } finally {
    clearTimeout(t);
  }
}

/** Convierte la respuesta de uso de Claude en una lista ordenada de límites. */
function parseLimits(data) {
  const limits = [];
  for (const [key, v] of Object.entries(data || {})) {
    if (!v || typeof v !== 'object' || typeof v.utilization !== 'number') continue;
    // Límites internos desconocidos (nombres en clave) solo se muestran si tienen consumo.
    if (!LABELS[key] && v.utilization <= 0) continue;
    limits.push({
      key,
      label: prettyKey(key),
      utilization: Math.max(0, v.utilization),
      resetsAt: v.resets_at || null,
    });
  }
  // Sesión primero, luego semanal general, luego el resto.
  const order = ['five_hour', 'seven_day'];
  limits.sort((a, b) => {
    const ia = order.indexOf(a.key), ib = order.indexOf(b.key);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return limits;
}

// ---------- Estadísticas locales ----------
const fileCache = new Map(); // ruta -> { mtimeMs, size, entries }

function walk(dir, out, minMtime) {
  let items;
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) walk(p, out, minMtime);
    else if (it.name.endsWith('.jsonl')) {
      try {
        const st = fs.statSync(p);
        if (st.mtimeMs >= minMtime) out.push({ p, st });
      } catch { /* ignorar */ }
    }
  }
}

// Nombre del proyecto = carpeta raíz del repositorio git (no la subcarpeta donde estabas).
const rootCache = new Map();
function projectName(cwd) {
  if (rootCache.has(cwd)) return rootCache.get(cwd);
  let dir = cwd;
  let name = path.basename(cwd);
  for (let i = 0; i < 6; i++) {
    try {
      if (fs.existsSync(path.join(dir, '.git'))) { name = path.basename(dir); break; }
    } catch { break; }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  rootCache.set(cwd, name);
  return name;
}

function parseFile(p) {
  const entries = [];
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); } catch { return entries; }
  for (const line of raw.split('\n')) {
    if (!line.includes('"usage"')) continue;
    try {
      const j = JSON.parse(line);
      const m = j.message;
      if (j.type !== 'assistant' || !m || !m.usage || String(m.model || '').startsWith('<')) continue; // sin mensajes internos (<synthetic>)
      const u = m.usage;
      const cc = u.cache_creation || {};
      const write5m = cc.ephemeral_5m_input_tokens ?? (u.cache_creation_input_tokens || 0);
      const write1h = cc.ephemeral_1h_input_tokens || 0;
      const e = {
        id: (m.id || '') + '|' + (j.requestId || ''),
        ts: Date.parse(j.timestamp),
        model: m.model || 'desconocido',
        input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0),
        cacheRead: u.cache_read_input_tokens || 0,
        output: u.output_tokens || 0,
        project: j.cwd ? projectName(j.cwd) : path.basename(path.dirname(p)),
      };
      e.cost = costOf(e.model, u.input_tokens || 0, write5m, write1h, e.cacheRead, e.output);
      entries.push(e);
    } catch { /* línea incompleta */ }
  }
  return entries;
}

// ---------- coste equivalente en la API (US$ por millón de tokens: entrada / salida) ----------
// Con un plan Pro/Max no pagas esto; sirve para saber cuánto "vale" lo que usas y en qué proyecto.
const PRICES = [
  [/fable|mythos/, 10, 50],
  [/opus-5-5/, 4, 20],
  [/opus-(5|4-[5-9])/, 5, 25],
  [/opus/, 15, 75], // Opus 4 / 4.1
  [/sonnet-5/, 2, 10],
  [/sonnet/, 3, 15],
  [/haiku-4/, 1, 5],
  [/haiku/, 0.8, 4],
];
function priceOf(model) {
  for (const [re, inp, out] of PRICES) if (re.test(model)) return { inp, out };
  return { inp: 3, out: 15 };
}
function costOf(model, input, write5m, write1h, cacheRead, output) {
  const p = priceOf(model);
  return (input * p.inp + write5m * p.inp * 1.25 + write1h * p.inp * 2 + cacheRead * p.inp * 0.1 + output * p.out) / 1e6;
}

function emptyBucket() {
  return { input: 0, output: 0, cacheRead: 0, messages: 0, cost: 0, models: {}, projects: {} };
}

function add(b, e) {
  b.input += e.input;
  b.output += e.output;
  b.cacheRead += e.cacheRead;
  b.messages += 1;
  b.cost += e.cost || 0;
  const short = e.model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
  b.models[short] = (b.models[short] || 0) + e.input + e.output;
  const pr = b.projects[e.project] || (b.projects[e.project] = { cost: 0, tokens: 0, messages: 0 });
  pr.cost += e.cost || 0;
  pr.tokens += e.input + e.output;
  pr.messages += 1;
}

function localStats() {
  const root = path.join(claudeDir(), 'projects');
  const now = Date.now();
  const weekAgo = now - 7 * 864e5;
  const monthAgo = now - 30 * 864e5;
  const files = [];
  walk(root, files, monthAgo - 864e5);
  const byDay = {}; // 'YYYY-MM-DD' -> { tokens, messages } (últimos 30 días)
  const dayKeyOf = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const seen = new Set();
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const startYesterday = startToday.getTime() - 864e5;
  const buckets = { today: emptyBucket(), yesterday: emptyBucket(), last5h: emptyBucket(), week: emptyBucket() };
  let lastActivity = 0;

  for (const { p, st } of files) {
    let c = fileCache.get(p);
    if (!c || c.mtimeMs !== st.mtimeMs || c.size !== st.size) {
      c = { mtimeMs: st.mtimeMs, size: st.size, entries: parseFile(p) };
      fileCache.set(p, c);
    }
    for (const e of c.entries) {
      if (!e.ts || e.ts < monthAgo || seen.has(e.id)) continue;
      seen.add(e.id);
      const dk = dayKeyOf(e.ts);
      const bd = byDay[dk] || (byDay[dk] = { tokens: 0, messages: 0, cost: 0 });
      bd.tokens += e.input + e.output;
      bd.messages += 1;
      bd.cost += e.cost || 0;
      if (e.ts < weekAgo) continue;
      add(buckets.week, e);
      if (e.ts >= startToday.getTime()) add(buckets.today, e);
      else if (e.ts >= startYesterday) add(buckets.yesterday, e);
      if (e.ts >= now - 5 * 3600e3) add(buckets.last5h, e);
      if (e.ts > lastActivity) lastActivity = e.ts;
    }
  }
  return { ...buckets, byDay, lastActivity: lastActivity || null, available: fs.existsSync(root) };
}

module.exports = { readClaudeCodeSession, fetchLimits, parseLimits, localStats };

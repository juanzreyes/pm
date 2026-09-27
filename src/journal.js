// Diario automático de Claude Code: qué le pediste a Claude en cada proyecto.
// Lee solo tus mensajes (no las respuestas ni los resultados de herramientas) de ~/.claude/projects.
const fs = require('fs');
const path = require('path');
const os = require('os');

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

const rootCache = new Map();
function projectName(cwd) {
  if (!cwd) return 'Claude';
  if (rootCache.has(cwd)) return rootCache.get(cwd);
  let dir = cwd;
  let name = path.basename(cwd);
  for (let i = 0; i < 6; i++) {
    try { if (fs.existsSync(path.join(dir, '.git'))) { name = path.basename(dir); break; } } catch { break; }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  rootCache.set(cwd, name);
  return name;
}

function walk(dir, out, minMtime) {
  let items;
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) { if (it.name !== 'subagents') walk(p, out, minMtime); }
    else if (it.name.endsWith('.jsonl')) {
      try { if (fs.statSync(p).mtimeMs >= minMtime) out.push(p); } catch { /* ignorar */ }
    }
  }
}

// Mensajes que no son peticiones reales del usuario.
const NOISE = /^(<command-|<local-command|Caveat:|\[Request interrupted|<system-reminder>|<task-notification>|This session is being continued)/;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    if (content.some((b) => b && b.type === 'tool_result')) return '';
    return content.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ');
  }
  return '';
}

// Caché por archivo: solo se vuelve a leer lo que cambió (menos CPU y memoria).
// Guarda únicamente las peticiones del usuario (texto recortado), no el archivo entero.
const fileCache = new Map(); // ruta -> { mtimeMs, size, items: [{ at, text, key, cwd }] }
function promptsOf(f) {
  let st;
  try { st = fs.statSync(f); } catch { return []; }
  const c = fileCache.get(f);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.items;
  let raw;
  try { raw = fs.readFileSync(f, 'utf8'); } catch { return []; }
  const items = [];
  for (const line of raw.split('\n')) {
    if (!line.includes('"type":"user"')) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type !== 'user' || j.isMeta || j.isSidechain || !j.message) continue;
    const at = Date.parse(j.timestamp);
    if (!at) continue;
    const text = textOf(j.message.content).replace(/\s+/g, ' ').trim();
    if (text.length < 4 || NOISE.test(text)) continue;
    items.push({ at, text: text.slice(0, 400), key: j.uuid || `${at}|${text.slice(0, 40)}`, cwd: j.cwd });
  }
  fileCache.set(f, { mtimeMs: st.mtimeMs, size: st.size, items });
  return items;
}

/** Peticiones del usuario entre dos fechas, agrupadas por proyecto: { proyecto: [{ at, text }] } */
function prompts(fromMs, toMs) {
  const files = [];
  walk(path.join(claudeDir(), 'projects'), files, fromMs - 864e5);
  const live = new Set(files);
  for (const k of fileCache.keys()) if (!live.has(k)) fileCache.delete(k); // archivos viejos fuera de la caché
  const byProject = {};
  const seen = new Set();
  for (const f of files) {
    for (const it of promptsOf(f)) {
      if (it.at < fromMs || it.at >= toMs || seen.has(it.key)) continue;
      seen.add(it.key);
      const proj = projectName(it.cwd);
      (byProject[proj] = byProject[proj] || []).push({ at: it.at, text: it.text });
    }
  }
  for (const k of Object.keys(byProject)) byProject[k].sort((a, b) => a.at - b.at);
  return byProject;
}

/** Resumen corto sin IA: 2-3 peticiones por proyecto, recortadas. */
function summarize(byProject, perProject = 3, maxLen = 70) {
  const lines = [];
  const projs = Object.entries(byProject).sort((a, b) => b[1].length - a[1].length);
  for (const [proj, list] of projs) {
    const picks = list.length <= perProject ? list : [list[0], list[Math.floor(list.length / 2)], list[list.length - 1]];
    const items = picks.map((p) => (p.text.length > maxLen ? p.text.slice(0, maxLen - 1) + '…' : p.text));
    lines.push({ project: proj, count: list.length, items });
  }
  return lines;
}

module.exports = { prompts, summarize };

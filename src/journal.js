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
// (También las que hace el propio PM para redactar el resumen del día: src/worksummary.js → MARK.)
const NOISE = /^(<command-|<local-command|Caveat:|\[Request interrupted|<system-reminder>|<task-notification>|This session is being continued|\[PM Pollito · resumen)/;

// Contexto que el IDE/Claude Code pega dentro de tu mensaje (<ide_opened_file>, <ide_selection>,
// <system-reminder>…): no es lo que pediste, así que no debe salir en tu diario ni en el standup.
const CONTEXT_TAG = /<([a-z]+[_-][a-z_-]+)\b[^>]*>[\s\S]*?<\/\1>/g;
const stripContext = (s) => s.replace(CONTEXT_TAG, ' ');

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    if (content.some((b) => b && b.type === 'tool_result')) return '';
    return content.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ');
  }
  return '';
}

/** Una línea del registro de Claude Code → una petición tuya { at, text, key, cwd }, o null. */
function promptFromLine(line) {
  if (!line.includes('"type":"user"')) return null;
  let j;
  try { j = JSON.parse(line); } catch { return null; }
  if (j.type !== 'user' || j.isMeta || j.isSidechain || !j.message) return null;
  const at = Date.parse(j.timestamp);
  if (!at) return null;
  const text = stripContext(textOf(j.message.content)).replace(/\s+/g, ' ').trim();
  if (text.length < 4 || NOISE.test(text)) return null;
  return { at, text: text.slice(0, 400), key: j.uuid || `${at}|${text.slice(0, 40)}`, cwd: j.cwd };
}

/** Peticiones [{ at, text, key, cwd }] entre dos fechas, agrupadas por proyecto (sin repetidas). */
function groupPrompts(items, fromMs, toMs) {
  const byProject = {};
  const seen = new Set();
  for (const it of items) {
    if (it.at < fromMs || it.at >= toMs || seen.has(it.key)) continue;
    seen.add(it.key);
    const proj = projectName(it.cwd);
    (byProject[proj] = byProject[proj] || []).push({ at: it.at, text: it.text });
  }
  for (const k of Object.keys(byProject)) byProject[k].sort((a, b) => a.at - b.at);
  return byProject;
}

/**
 * Peticiones del usuario entre dos fechas, agrupadas por proyecto: { proyecto: [{ at, text }] }.
 * Las lee src/claudescan.js: solo lo nuevo de cada archivo (no el archivo entero cada vez).
 */
function prompts(fromMs, toMs) {
  return require('./claudescan').shared().prompts(fromMs, toMs);
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

module.exports = { prompts, summarize, promptFromLine, groupPrompts, claudeDir };

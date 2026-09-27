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

/** Peticiones del usuario entre dos fechas, agrupadas por proyecto: { proyecto: [{ at, text }] } */
function prompts(fromMs, toMs) {
  const files = [];
  walk(path.join(claudeDir(), 'projects'), files, fromMs - 864e5);
  const byProject = {};
  const seen = new Set();
  for (const f of files) {
    let raw;
    try { raw = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line.includes('"type":"user"')) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      if (j.type !== 'user' || j.isMeta || j.isSidechain || !j.message) continue;
      const at = Date.parse(j.timestamp);
      if (!at || at < fromMs || at >= toMs) continue;
      const text = textOf(j.message.content).replace(/\s+/g, ' ').trim();
      if (text.length < 4 || NOISE.test(text)) continue;
      const key = j.uuid || `${at}|${text.slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const proj = projectName(j.cwd);
      (byProject[proj] = byProject[proj] || []).push({ at, text });
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

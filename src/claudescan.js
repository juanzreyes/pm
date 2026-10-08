// Lector del historial de Claude Code (~/.claude/projects/**.jsonl) para el consumo local y el
// diario. Esos archivos son enormes (cientos de MB) y solo CRECEN: se añaden líneas al final.
// Por eso aquí:
//  - se recuerda hasta qué byte se leyó cada archivo y solo se lee lo nuevo;
//  - se lee en trozos de 8 MB (nunca el archivo entero en memoria);
//  - una sola pasada saca el consumo y las peticiones;
//  - lo leído (solo lo necesario: 31 días de consumo, 8 de peticiones) se guarda en disco, así
//    al reiniciar no hay que releer nada viejo.
// En la app corre en un hilo aparte (src/scanworker.js) para no congelar nada.
const fs = require('fs');
const path = require('path');
const usage = require('./usage');
const journal = require('./journal');

const CHUNK = 8 * 1024 * 1024;
const USAGE_DAYS = 31;
const PROMPT_DAYS = 8;
const VERSION = 1;

/**
 * @param {{ root?: string, cacheFile?: string|null, now?: () => number }} [o]
 */
function createScanner({ root = path.join(usage.claudeDir(), 'projects'), cacheFile = null, now = () => Date.now() } = {}) {
  /** @type {Map<string, { size: number, mtimeMs: number, offset: number, usage: any[], prompts: any[] }>} */
  const files = new Map();
  let dirty = false;
  let lastUpdate = 0;
  const stats = { bytesRead: 0, filesRead: 0 };

  if (cacheFile) {
    try {
      const j = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (j.v === VERSION && j.root === root) for (const [p, c] of Object.entries(j.files || {})) files.set(p, c);
    } catch { /* sin caché: se lee todo una vez */ }
  }

  function walk(dir, out, minMtime) {
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) walk(p, out, minMtime);
      else if (it.name.endsWith('.jsonl')) {
        try { const st = fs.statSync(p); if (st.mtimeMs >= minMtime) out.push({ p, st }); } catch { /* ignorar */ }
      }
    }
  }

  /** Lee de `c.offset` al final, por trozos, y procesa solo las líneas completas. */
  function readNew(p, c, st, usageFrom, promptsFrom) {
    if (st.size < c.offset) { c.offset = 0; c.usage = []; c.prompts = []; } // el archivo se reescribió
    let fd;
    try { fd = fs.openSync(p, 'r'); } catch { return; }
    try {
      let pos = c.offset;
      let carry = null;
      while (pos < st.size) {
        const len = Math.min(CHUNK, st.size - pos);
        const buf = Buffer.allocUnsafe(len);
        const n = fs.readSync(fd, buf, 0, len, pos);
        if (n <= 0) break;
        pos += n;
        stats.bytesRead += n;
        const data = carry ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
        // Se corta en el último salto de línea (un byte 0x0A nunca es parte de un carácter UTF-8).
        const last = data.lastIndexOf(10);
        if (last < 0) { carry = data; continue; }
        const text = data.toString('utf8', 0, last);
        carry = last + 1 < data.length ? data.subarray(last + 1) : null;
        for (const line of text.split('\n')) {
          const e = usage.entryFromLine(line, p);
          if (e && e.ts >= usageFrom) { c.usage.push(e); continue; }
          const it = journal.promptFromLine(line);
          if (it && it.at >= promptsFrom) c.prompts.push(it);
        }
        // Lo que quedó sin salto de línea (una línea a medio escribir) se relee la próxima vez.
        c.offset = pos - (carry ? carry.length : 0);
      }
      // …salvo que esa última línea ya sea un JSON completo (archivo que no termina en salto de línea).
      if (carry && carry.length) {
        const last = carry.toString('utf8');
        let ok = false;
        try { JSON.parse(last); ok = true; } catch { /* a medio escribir */ }
        if (ok) {
          const e = usage.entryFromLine(last, p);
          if (e && e.ts >= usageFrom) c.usage.push(e);
          else { const it = journal.promptFromLine(last); if (it && it.at >= promptsFrom) c.prompts.push(it); }
          c.offset = pos;
        }
      }
    } finally { fs.closeSync(fd); }
    c.size = st.size;
    c.mtimeMs = st.mtimeMs;
    stats.filesRead++;
  }

  /** Pone al día la caché: archivos nuevos o que crecieron. minGapMs: no repetir si se hizo hace nada. */
  function update(minGapMs = 1500) {
    const t = now();
    if (t - lastUpdate < minGapMs) return;
    lastUpdate = t;
    const usageFrom = t - USAGE_DAYS * 864e5;
    const promptsFrom = t - PROMPT_DAYS * 864e5;
    const found = [];
    walk(root, found, usageFrom - 864e5);
    const live = new Set();
    for (const { p, st } of found) {
      live.add(p);
      let c = files.get(p);
      if (!c) { c = { size: 0, mtimeMs: 0, offset: 0, usage: [], prompts: [] }; files.set(p, c); }
      if (c.size === st.size && c.mtimeMs === st.mtimeMs) continue;
      readNew(p, c, st, usageFrom, promptsFrom);
      dirty = true;
    }
    // Fuera lo viejo: archivos de hace más de un mes y entradas fuera de la ventana.
    for (const [p, c] of files) {
      if (!live.has(p)) { files.delete(p); dirty = true; continue; }
      const u = c.usage.length;
      const q = c.prompts.length;
      c.usage = c.usage.filter((e) => e.ts >= usageFrom);
      c.prompts = c.prompts.filter((it) => it.at >= promptsFrom);
      if (c.usage.length !== u || c.prompts.length !== q) dirty = true;
    }
    save();
  }

  function save() {
    if (!dirty || !cacheFile) return;
    dirty = false;
    try {
      const tmp = cacheFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ v: VERSION, root, at: now(), files: Object.fromEntries(files) }));
      fs.renameSync(tmp, cacheFile);
    } catch { /* sin disco: la próxima vez se relee */ }
  }

  const all = (k) => { const out = []; for (const c of files.values()) for (const x of c[k]) out.push(x); return out; };
  return {
    /** Consumo local (igual que usage.localStatsOld, pero leyendo solo lo nuevo). */
    stats() { update(); return usage.statsFrom(all('usage'), root, now()); },
    /** Peticiones entre dos fechas agrupadas por proyecto (como journal.prompts). */
    prompts(fromMs, toMs) { update(); return journal.groupPrompts(all('prompts'), fromMs, toMs); },
    update,
    info: () => ({ ...stats, files: files.size }),
  };
}

// Un lector compartido por carpeta (para la CLI, los tests y como respaldo si no hay hilo aparte).
const byRoot = new Map();
function shared() {
  const root = path.join(usage.claudeDir(), 'projects');
  if (!byRoot.has(root)) byRoot.set(root, createScanner({ root }));
  return byRoot.get(root);
}

module.exports = { createScanner, shared, CHUNK };

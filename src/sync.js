// Sincronización entre PCs a través de una carpeta sincronizada (OneDrive, Google Drive…).
// Cada PC escribe su "foto" (pm-sync-<id>.json) y lee las de los demás; se mezclan sin perder nada:
// uniones por id o por texto, máximos para contadores, y "lápidas" para lo que se borró a propósito.
const fs = require('fs');
const path = require('path');

const byId = (list) => new Map((list || []).map((x) => [x.id, x]));
const clone = (x) => JSON.parse(JSON.stringify(x));

/** Une dos listas de objetos con id; respeta las lápidas (borrados). */
function unionById(a, b, dead, prefer = (x, y) => x) {
  const m = byId(a);
  for (const y of b || []) {
    if (!y || !y.id || dead[y.id]) continue;
    const x = m.get(y.id);
    m.set(y.id, x ? prefer(x, y) : clone(y));
  }
  return [...m.values()].filter((x) => !dead[x.id]);
}
const maxNum = (x, y) => Math.max(Number(x) || 0, Number(y) || 0);
function maxMap(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = typeof v === 'number' ? maxNum(out[k], v) : out[k] === undefined ? v : out[k];
  return out;
}
function mergeText(a = '', b = '') {
  if (!b || a === b || a.includes(b)) return a;
  if (!a || b.includes(a)) return b;
  const have = new Set(a.split('\n').map((l) => l.trim()));
  const extra = b.split('\n').filter((l) => l.trim() && !have.has(l.trim()));
  return extra.length ? a.replace(/\s*$/, '\n') + extra.join('\n') : a;
}

/** Mezcla un día. */
function mergeDay(a, b) {
  if (!a) return clone(b);
  if (!b) return a;
  const d = clone(a);
  // Tareas: unión por texto; hecha si lo está en cualquiera de los dos.
  if (b.standup) {
    if (!d.standup) d.standup = clone(b.standup);
    else {
      const list = d.standup.today || (d.standup.today = []);
      for (const t of b.standup.today || []) {
        const x = list.find((y) => y.text === t.text);
        if (!x) list.push(clone(t));
        else {
          x.done = !!(x.done || t.done);
          x.spent = maxNum(x.spent, t.spent);
          if (!x.priority && t.priority) x.priority = t.priority;
        }
      }
      d.standup.yesterday = mergeText(d.standup.yesterday, b.standup.yesterday);
      d.standup.help = mergeText(d.standup.help, b.standup.help);
    }
  }
  d.notes = mergeText(d.notes, b.notes);
  for (const k of ['projects', 'branches', 'habits', 'hours']) if (b[k]) d[k] = maxMap(d[k], b[k]);
  if (b.focus) d.focus = maxMap(d.focus, b.focus);
  for (const k of ['pomodoros', 'commits', 'claudeTasks', 'music']) if (b[k] !== undefined) d[k] = maxNum(d[k], b[k]);
  if (b.blocks) {
    const key = (x) => `${x.start}|${x.title}`;
    const have = new Set((d.blocks || []).map(key));
    d.blocks = [...(d.blocks || []), ...b.blocks.filter((x) => !have.has(key(x))).map(clone)].sort((x, y) => (x.start < y.start ? -1 : 1));
  }
  if (b.review && !d.review) d.review = clone(b.review);
  if (b.mood && !d.mood) d.mood = b.mood;
  return d;
}

/** Mezcla el pollito: gana el más evolucionado, pero se suman colecciones y objetos. */
function mergePet(a, b) {
  if (!b) return a;
  if (!a) return clone(b);
  const base = clone((b.xp || 0) > (a.xp || 0) ? b : a);
  const other = base === a ? b : a;
  const ach = new Map([...(a.achievements || []), ...(b.achievements || [])].map((x) => [x.id, x]));
  base.achievements = [...ach.values()];
  base.owned = [...new Set([...(a.owned || []), ...(b.owned || [])])];
  base.home = [...new Set([...(a.home || []), ...(b.home || [])])];
  base.collection = maxMap(a.collection, b.collection);
  if (!base.name && other.name) base.name = other.name;
  return base;
}

/** Mezcla los datos remotos en los locales (devuelve una copia nueva). */
function merge(local, remote) {
  const out = clone(local);
  const dead = { ...(local.tombstones || {}), ...(remote.tombstones || {}) };
  out.tombstones = dead;
  out.days = out.days || {};
  for (const [k, v] of Object.entries(remote.days || {})) out.days[k] = mergeDay(out.days[k], v);
  out.reminders = unionById(out.reminders, remote.reminders, dead, (x, y) => ({ ...x, done: !!(x.done || y.done) }));
  for (const k of ['prompts', 'habits', 'recurring', 'templates', 'claudeQueue']) out[k] = unionById(out[k], remote[k], dead);
  out.milestones = unionById(out.milestones, remote.milestones, dead, (x, y) => ({ ...x, done: !!(x.done || y.done) }));
  out.weeks = out.weeks || {};
  for (const [wk, w] of Object.entries(remote.weeks || {})) {
    const cur = out.weeks[wk] || { goals: [] };
    cur.goals = unionById(cur.goals, w.goals, dead, (x, y) => ({ ...x, progress: maxNum(x.progress, y.progress) }));
    out.weeks[wk] = cur;
  }
  out.petDiary = { ...(remote.petDiary || {}), ...(out.petDiary || {}) };
  out.petDreams = { ...(remote.petDreams || {}), ...(out.petDreams || {}) };
  out.petLetters = { ...(remote.petLetters || {}), ...(out.petLetters || {}) };
  out.petDates = unionById(out.petDates, remote.petDates, dead);
  out.lineage = unionById(out.lineage, remote.lineage, dead);
  out.taskAges = { ...(remote.taskAges || {}), ...(out.taskAges || {}) };
  out.pet = mergePet(out.pet, remote.pet);
  return out;
}

// Qué viaja entre PCs (sin ajustes, claves ni cosas de este equipo).
const SYNCED = ['days', 'reminders', 'prompts', 'habits', 'recurring', 'templates', 'claudeQueue', 'milestones', 'weeks', 'petDiary', 'taskAges', 'pet', 'tombstones', 'petDreams', 'petLetters', 'petDates', 'lineage'];
function pick(data) {
  const o = {};
  for (const k of SYNCED) if (data[k] !== undefined) o[k] = data[k];
  return o;
}

/** Escribe la foto de este PC y mezcla las de los demás. Devuelve { merged, from: [nombres] }. */
function run(dir, data, device) {
  fs.mkdirSync(dir, { recursive: true });
  const mine = path.join(dir, `pm-sync-${device.id}.json`);
  let merged = data;
  const from = [];
  const seen = data.syncSeen || {};
  for (const f of fs.readdirSync(dir).filter((x) => /^pm-sync-.+\.json$/.test(x))) {
    if (path.join(dir, f) === mine) continue;
    let snap;
    try { snap = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; } // se está sincronizando
    if (!snap || !snap.device || !snap.data || snap.app !== 'pm-pollito') continue;
    if (seen[snap.device.id] && seen[snap.device.id] >= snap.at) continue; // ya lo mezclé
    merged = merge(merged, snap.data);
    seen[snap.device.id] = snap.at;
    from.push(snap.device.name || snap.device.id);
  }
  merged.syncSeen = seen;
  const tmp = mine + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ app: 'pm-pollito', device, at: Date.now(), data: pick(merged) }));
  fs.renameSync(tmp, mine);
  return { merged, from };
}

module.exports = { merge, mergeDay, mergePet, run, pick, mergeText };

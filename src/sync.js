// Sincronización del ecosistema (PCs y teléfonos). Cada dispositivo publica su "foto" y lee las de
// los demás; se mezclan sin perder nada: uniones por id o por texto, máximos para contadores,
// "lápidas" para lo que se borró a propósito, contadores por dispositivo para el maíz y la
// experiencia, y "el último cambio gana" para cosméticos, estado del pollito y ajustes compartidos.
// El transporte es aparte: una carpeta sincronizada (run) o la nube cifrada (src/cloudsync.js).
// Lógica pura: también corre en Android (los require de fs/path están dentro de run()).

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

// ---------------------------------------------------------------------------
// Maíz y experiencia sin pérdidas: cada dispositivo anota lo que ganó y gastó él ("by"); el total
// es la base + la suma de todos. Mezclar = quedarse con el máximo de cada anotación. Así lo que
// ganas en el teléfono y en la PC al mismo tiempo se suma, no se pisa.
// ---------------------------------------------------------------------------
const COUNTERS = ['xp', 'coins'];
function ledgerTotal(L, k) {
  let t = Number((L.base || {})[k]) || 0;
  for (const d of Object.values(L.by || {})) t += (Number(d[k + 'Up']) || 0) - (Number(d[k + 'Down']) || 0);
  return t;
}
function mergeLedger(a, b) {
  if (!a) return b ? clone(b) : null;
  if (!b) return clone(a);
  // La base es la del dueño del ecosistema (quien lo creó); entre dos sin dueño, la más antigua.
  // Las anotaciones: el máximo de cada una.
  const ob = !!(b.base && b.base.owner);
  const oa = !!(a.base && a.base.owner);
  const base = ob !== oa ? (ob ? b.base : a.base) : (Number(b.base && b.base.at) || Infinity) < (Number(a.base && a.base.at) || Infinity) ? b.base : a.base;
  const by = clone(a.by || {});
  for (const [dev, d] of Object.entries(b.by || {})) {
    const cur = by[dev] || (by[dev] = {});
    for (const [k, v] of Object.entries(d)) cur[k] = maxNum(cur[k], v);
  }
  return { base: clone(base), by };
}

/** Mezcla el pollito: colecciones y logros se suman; maíz/experiencia por contador; el resto, el último cambio. */
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
  if (a.ledger || b.ledger) {
    base.ledger = mergeLedger(a.ledger, b.ledger);
    for (const k of COUNTERS) base[k] = Math.max(0, ledgerTotal(base.ledger, k));
  }
  return base;
}

// ---------------------------------------------------------------------------
// "El último cambio gana": cosméticos, especie, nombre, estado del pollito y ajustes compartidos.
// Al sincronizar, cada dispositivo marca la hora de lo que cambió desde la vez anterior (stamp);
// al mezclar, gana la marca más reciente. Lo que nunca cambió en un dispositivo nuevo tiene hora 0:
// un teléfono recién vinculado adopta lo del ecosistema en vez de imponer sus valores por defecto.
// ---------------------------------------------------------------------------
// Cada entrada se marca y se mezcla por separado: cambiar la personalidad en la PC y el almuerzo en
// el teléfono a la vez no pisa ninguno de los dos. El estado del pollito va junto (cambia junto).
const SHARED_SETTINGS = ['morningTime', 'eveningTime', 'workDays', 'meals', 'breaks', 'leisure', 'mealReminders', 'breakReminders', 'personality', 'petStyle', 'myName', 'lang', 'chatter', 'pomodoroMin', 'breakMin'];
const FIELDS = {
  'pet.needs': { obj: 'pet', keys: ['fullness', 'happiness', 'clean', 'energy', 'sick', 'sickSince', 'napUntil', 'lastTick'], round: true },
  'pet.away': { obj: 'pet', keys: ['vacation', 'postcards'] },
};
for (const k of ['equipped', 'species', 'name', 'tricks', 'garden', 'traits', 'practiceDay']) FIELDS['pet.' + k] = { obj: 'pet', keys: [k] };
for (const k of SHARED_SETTINGS) FIELDS['settings.' + k] = { obj: 'settings', keys: [k] };
const round = (v) => (typeof v === 'number' ? Math.round(v) : v);
function groupValue(data, g) {
  const def = FIELDS[g];
  const src = data[def.obj] || {};
  const o = {};
  for (const k of def.keys) if (src[k] !== undefined) o[k] = def.round ? round(src[k]) : src[k];
  return o;
}
const GROUPS = Object.keys(FIELDS);
const sharedSettings = (data) => {
  const s = data.settings || {};
  const o = {};
  for (const k of SHARED_SETTINGS) if (s[k] !== undefined) o[k] = s[k];
  return o;
};

/**
 * Antes de publicar la foto: anota lo que este dispositivo ganó/gastó y la hora de lo que cambió.
 * Modifica "data" (son campos de sincronización, no estado del usuario).
 */
function stamp(data, deviceId, now = Date.now()) {
  const p = data.pet || (data.pet = {});
  const L = p.ledger || (p.ledger = { base: { xp: Number(p.xp) || 0, coins: Number(p.coins) || 0, at: now }, by: {} });
  const mine = L.by[deviceId] || (L.by[deviceId] = {});
  for (const k of COUNTERS) {
    const d = (Number(p[k]) || 0) - ledgerTotal(L, k);
    if (d > 0) mine[k + 'Up'] = (Number(mine[k + 'Up']) || 0) + d;
    else if (d < 0) mine[k + 'Down'] = (Number(mine[k + 'Down']) || 0) - d;
  }
  const st = data.syncStamps || (data.syncStamps = {});
  for (const g of GROUPS) {
    const sig = JSON.stringify(groupValue(data, g));
    if (!st[g]) st[g] = { sig, at: 0, by: deviceId }; // primera vez: sin edad conocida
    else if (st[g].sig !== sig) st[g] = { sig, at: now, by: deviceId };
  }
  data.sharedSettings = sharedSettings(data);
  return data;
}

/**
 * El dispositivo que crea el ecosistema "reclama" sus valores: lo que tenía hora 0 pasa a 1, así
 * cualquier dispositivo que se una después (con hora 0) adopta lo del ecosistema.
 */
function claim(data, deviceId, now = Date.now()) {
  stamp(data, deviceId, now);
  for (const s of Object.values(data.syncStamps)) if (!s.at) s.at = 1;
  data.pet.ledger.base.owner = true;
  return data;
}

/** Aplica sobre "out" los grupos en que "remote" tiene un cambio más reciente. */
function mergeStamps(out, remote) {
  const mine = out.syncStamps || (out.syncStamps = {});
  for (const [g, r] of Object.entries(remote.syncStamps || {})) {
    const def = FIELDS[g];
    if (!def) continue;
    const l = mine[g];
    if (l && (l.at > r.at || (l.at === r.at && l.by >= r.by))) continue; // gana lo local (empate: orden fijo)
    // Los ajustes no viajan enteros: solo los compartidos, en sharedSettings.
    const src = def.obj === 'settings' ? remote.sharedSettings : remote.pet;
    if (!src) continue;
    const dst = out[def.obj] || (out[def.obj] = {});
    for (const k of def.keys) {
      if (src[k] === undefined) delete dst[k];
      else dst[k] = clone(src[k]);
    }
    mine[g] = clone(r);
  }
  return out;
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
  out.workExtras = unionByKey(out.workExtras, remote.workExtras, (x) => x.date + '|' + (x.off ? 'off' : x.start));
  out.pet = mergePet(out.pet, remote.pet);
  mergeStamps(out, remote);
  return out;
}
function unionByKey(a, b, key) {
  const m = new Map((a || []).map((x) => [key(x), x]));
  for (const y of b || []) if (y && !m.has(key(y))) m.set(key(y), clone(y));
  return [...m.values()];
}

// Qué viaja entre PCs (sin ajustes, claves ni cosas de este equipo).
const SYNCED = ['days', 'reminders', 'prompts', 'habits', 'recurring', 'templates', 'claudeQueue', 'milestones', 'weeks', 'petDiary', 'taskAges', 'pet', 'tombstones', 'petDreams', 'petLetters', 'petDates', 'lineage', 'workExtras', 'syncStamps', 'sharedSettings'];
function pick(data) {
  const o = {};
  for (const k of SYNCED) if (data[k] !== undefined) o[k] = data[k];
  return o;
}

/** Escribe la foto de este PC y mezcla las de los demás. Devuelve { merged, from: [nombres] }. */
function run(dir, data, device) {
  const fs = require('fs');
  const path = require('path');
  stamp(data, device.id);
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

module.exports = { merge, mergeDay, mergePet, run, pick, mergeText, stamp, claim, ledgerTotal, SHARED_SETTINGS };

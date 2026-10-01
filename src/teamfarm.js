// Granja del equipo (2.0 · 5/7): los pollitos de tus compañeros, kudos con maíz, visitas y el reto
// de foco semanal. Todo pasa por una carpeta compartida (OneDrive, Google Drive, una unidad de red…):
// cada PM escribe su tarjeta pública y su buzón de salida, y lee los de los demás. Sin servidor.
// Lo que se comparte es SOLO lo de la tarjeta: nada de tareas, proyectos, apps ni notas.
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const SPECIES = ['chick', 'duck', 'cat', 'penguin'];
const ONLINE_MS = 10 * 60e3; // tarjeta tocada hace menos de 10 min = está en el PC
const KUDOS_PER_DAY = 3;
const KUDO_CORN = 10; // maíz que recibe el pollito de quien recibe el kudo
const VISIT_EVERY_MS = 60 * 60e3; // como mucho una visita por compañero y hora
const GOAL_PER_PERSON = 6 * 60; // minutos de trabajo enfocado por persona y semana
const OUTBOX_DAYS = 7;

/** Lunes de la semana de `d` (clave del reto). */
function weekKey(d = new Date()) {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return keyOf(m);
}

/** Minutos de trabajo enfocado esta semana (days[k].focus.work está en segundos). */
function weekFocusMins(days, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const start = weekKey(now);
  let secs = 0;
  for (let i = 0; i < 7; i++) {
    const k = keyOf(d);
    const f = days && days[k] && days[k].focus;
    if (f) secs += f.work || 0;
    if (k === start) break;
    d.setDate(d.getDate() - 1);
  }
  return Math.round(secs / 60);
}

const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

const GAMES = ['corn', 'bugs', 'snake'];
const cleanGames = (o) => Object.fromEntries(GAMES.map((k) => [k, Math.max(0, Math.min(999, Math.floor(Number(o && o[k]) || 0)))]));
/**
 * Tarjeta pública. Lista blanca: lo que no está aquí no sale de tu PC.
 * @param {{ id: string, name?: string, pet?: { name?: string, species?: string, happiness?: number }, level?: number, focusUntil?: number, focusMode?: boolean, weekMins?: number, streak?: number, kudos?: number, games?: Object<string, number>, now?: number }} o
 */
function card({ id, name, pet = {}, level = 1, focusUntil = 0, focusMode = false, weekMins = 0, streak = 0, kudos = 0, games = {}, now = Date.now() }) {
  return {
    v: 1, id: clean(id, 40), name: clean(name, 40) || 'Alguien', petName: clean(pet.name, 30) || 'PM',
    species: SPECIES.includes(pet.species) ? pet.species : 'chick', level: Math.max(1, Math.floor(level) || 1),
    mood: (pet.happiness ?? 70) >= 60 ? 'feliz' : (pet.happiness ?? 70) >= 30 ? 'normal' : 'triste',
    focus: !!focusMode, focusUntil: focusUntil > now ? focusUntil : 0,
    week: weekKey(new Date(now)), weekMins: Math.max(0, Math.round(weekMins)), streak: Math.max(0, streak | 0), kudos: Math.max(0, kudos | 0), games: cleanGames(games), at: now,
  };
}

/** Valida una tarjeta leída de la carpeta (la escribió otro PC: no se confía en nada). */
function parseCard(raw) {
  let c;
  try { c = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (!c || c.v !== 1 || typeof c.id !== 'string' || !c.id || typeof c.at !== 'number') return null;
  return {
    id: clean(c.id, 40), name: clean(c.name, 40) || 'Alguien', petName: clean(c.petName, 30) || 'PM',
    species: SPECIES.includes(c.species) ? c.species : 'chick', level: Math.max(1, Math.min(999, Math.floor(c.level) || 1)),
    mood: ['feliz', 'normal', 'triste'].includes(c.mood) ? c.mood : 'normal', focus: !!c.focus, focusUntil: Number(c.focusUntil) || 0,
    week: typeof c.week === 'string' ? c.week : '', weekMins: Math.max(0, Math.min(10080, Number(c.weekMins) || 0)),
    streak: Math.max(0, Math.min(9999, Number(c.streak) || 0)), kudos: Math.max(0, Number(c.kudos) || 0), games: cleanGames(c.games), at: c.at,
  };
}

/** Estado de un compañero: en foco (no molestar), en el PC o desconectado. */
function statusOf(c, now = Date.now()) {
  if (now - c.at > ONLINE_MS) return 'away';
  if (c.focus || c.focusUntil > now) return 'focus';
  return 'online';
}

/** La granja: compañeros (sin ti), con estado, ordenados: en el PC, en foco y desconectados. */
function farm(cards, meId, now = Date.now()) {
  const order = { online: 0, focus: 1, away: 2 };
  return cards.map(parseCard).filter((c) => c && c.id !== meId && now - c.at < 30 * 864e5)
    .map((c) => ({ ...c, status: statusOf(c, now) }))
    .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}

/** Reto de foco del equipo esta semana: entre todos, GOAL_PER_PERSON min por persona. */
function challenge(cards, now = Date.now()) {
  const wk = weekKey(new Date(now));
  const members = cards.filter((c) => c && c.week === wk);
  const n = Math.max(1, members.length);
  const goal = n * GOAL_PER_PERSON;
  const done = members.reduce((a, c) => a + c.weekMins, 0);
  const top = members.slice().sort((a, b) => b.weekMins - a.weekMins).slice(0, 3).map((c) => ({ name: c.name, mins: c.weekMins }));
  return { week: wk, goal, done, pct: Math.min(100, Math.round((done / goal) * 100)), members: members.length, reached: done >= goal, top };
}

/** Ranking de minijuegos del equipo (contigo): los 3 mejores de cada juego. */
function leaderboard(cards) {
  const out = {};
  for (const k of GAMES) out[k] = cards.filter((c) => c && c.games && c.games[k] > 0).map((c) => ({ id: c.id, name: c.name, score: c.games[k] })).sort((a, b) => b.score - a.score).slice(0, 3);
  return out;
}

/** Evento para el buzón de salida. type: 'kudo' | 'visit'. */
function event(type, from, to, msg = '', now = Date.now()) {
  return { id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, type, from: from.id, fromName: from.name, petName: from.petName, species: from.species, to, msg: clean(msg, 140), at: now };
}
/** Buzón de salida recortado: solo lo de la última semana y como mucho 60. */
function trimOutbox(list, now = Date.now()) {
  return (list || []).filter((e) => now - e.at < OUTBOX_DAYS * 864e5).slice(-60);
}
/** Lo nuevo para mí en los buzones de los demás (no visto antes). */
function inbox(outboxes, meId, seen = [], now = Date.now()) {
  const s = new Set(seen);
  const out = [];
  for (const box of outboxes) {
    if (!Array.isArray(box)) continue;
    for (const e of box) {
      if (!e || e.to !== meId || s.has(e.id) || !['kudo', 'visit'].includes(e.type) || typeof e.at !== 'number' || now - e.at > OUTBOX_DAYS * 864e5) continue;
      s.add(e.id);
      out.push({ id: String(e.id), type: e.type, from: clean(e.from, 40), fromName: clean(e.fromName, 40) || 'Alguien', petName: clean(e.petName, 30) || 'PM', species: SPECIES.includes(e.species) ? e.species : 'chick', msg: clean(e.msg, 140), at: e.at });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** ¿Puedes dar otro kudo hoy? sent: [{at}] de tus kudos. */
function kudosLeft(sent, now = new Date()) {
  const today = keyOf(now);
  return Math.max(0, KUDOS_PER_DAY - (sent || []).filter((e) => e.type === 'kudo' && keyOf(new Date(e.at)) === today).length);
}
/** ¿Puede tu pollito visitar a este compañero ahora? */
function canVisit(mate, sent, now = Date.now()) {
  if (!mate) return { ok: false, error: 'No encuentro a esa persona en la granja' };
  if (mate.status === 'away') return { ok: false, error: `${mate.name} no está en su PC ahora` };
  if (mate.status === 'focus') return { ok: false, error: `${mate.name} está en modo foco: mejor no molestar 🤫` };
  const last = (sent || []).filter((e) => e.type === 'visit' && e.to === mate.id).reduce((a, e) => Math.max(a, e.at), 0);
  if (now - last < VISIT_EVERY_MS) return { ok: false, error: `Tu pollito ya visitó a ${mate.name} hace poco` };
  return { ok: true };
}

module.exports = { leaderboard, weekKey, weekFocusMins, card, parseCard, statusOf, farm, challenge, event, trimOutbox, inbox, kudosLeft, canVisit, KUDO_CORN, KUDOS_PER_DAY, GOAL_PER_PERSON, SPECIES };

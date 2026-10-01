// Juego (2.0 · 6/7): misiones diarias, pase de temporada mensual gratis, huevos dorados por
// rachas largas y "Tu año con PM Pollito" (resumen anual para compartir). Lógica pura.
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------- 🎯 misiones diarias ----------
// progress(ctx) → número; ctx = { day, games, kudos, team, claude }
const MISSIONS = [
  { id: 'daily', emoji: '☀️', text: 'Haz tu daily', goal: 1, progress: (c) => (c.day.standup ? 1 : 0) },
  { id: 'tasks3', emoji: '✅', text: 'Completa 3 tareas', goal: 3, progress: (c) => ((c.day.standup && c.day.standup.today) || []).filter((t) => t.done).length },
  { id: 'pomo2', emoji: '🍅', text: 'Termina 2 pomodoros', goal: 2, progress: (c) => c.day.pomodoros || 0 },
  { id: 'focus2h', emoji: '🧠', text: '2 h de trabajo enfocado', goal: 120, unit: 'min', progress: (c) => Math.floor(((c.day.focus && c.day.focus.work) || 0) / 60) },
  { id: 'commit3', emoji: '📦', text: 'Haz 3 commits', goal: 3, progress: (c) => c.day.commits || 0 },
  { id: 'game1', emoji: '🎮', text: 'Juega un minijuego', goal: 1, progress: (c) => c.games || 0 },
  { id: 'kudo1', emoji: '🌽', text: 'Dale un kudo a alguien del equipo', goal: 1, needs: 'team', progress: (c) => c.kudos || 0 },
  { id: 'claude2', emoji: '🤖', text: 'Termina 2 tareas con Claude Code', goal: 2, needs: 'claude', progress: (c) => c.day.claudeTasks || 0 },
  { id: 'calm', emoji: '🧘', text: 'Menos de 15 min distraído (con 1 h de trabajo)', goal: 1, progress: (c) => (c.day.focus && c.day.focus.work >= 3600 && (c.day.focus.distraction || 0) < 900 ? 1 : 0) },
];
const MISSION_CORN = 15;
const MISSION_PTS = 100; // puntos de temporada por misión (y otros tantos por completar las 3)

/** Las 3 misiones del día: siempre las mismas para esa fecha, sin las que no aplican. */
function missionsFor(dateKey, { team = false, claude = false } = {}) {
  const pool = MISSIONS.filter((m) => (m.needs !== 'team' || team) && (m.needs !== 'claude' || claude));
  const out = [];
  let h = hash(dateKey);
  // El daily es la puerta del día: casi siempre está.
  if (h % 4 !== 0) out.push(pool.find((m) => m.id === 'daily'));
  const rest = pool.filter((m) => m.id !== 'daily');
  while (out.length < 3 && rest.length) {
    h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0;
    out.push(rest.splice(h % rest.length, 1)[0]);
  }
  return out;
}
function missionView(m, ctx, claimed = []) {
  const n = Math.max(0, Math.min(m.goal, m.progress(ctx)));
  return { id: m.id, emoji: m.emoji, text: m.text, goal: m.goal, unit: m.unit || '', n, done: n >= m.goal, claimed: claimed.includes(m.id) };
}

// ---------- 🎟️ pase de temporada (uno por mes, gratis) ----------
const TIER_PTS = 150;
const MAX_TIER = 20;
const seasonOf = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const seasonName = (id) => { const [y, m] = id.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const tierOf = (pts) => Math.min(MAX_TIER, Math.floor(Math.max(0, pts) / TIER_PTS));
/** Recompensa de cada nivel del pase. Los niveles 10 y 20 dan plumas exclusivas. */
function tierReward(t) {
  if (t === 10) return { item: 'skin-sunset', emoji: '🌅', label: 'Plumas atardecer (exclusivas)' };
  if (t === 20) return { item: 'skin-galaxy', emoji: '🌌', label: 'Plumas galaxia (exclusivas)' };
  if (t % 5 === 0) return { xp: 50, emoji: '⭐', label: '+50 XP' };
  return { corn: 10 + t * 2, emoji: '🌽', label: `+${10 + t * 2} maíz` };
}
/** Puntos de temporada por una partida: hasta 50, solo las 3 primeras del día. */
const gamePts = (score, gamesToday) => (gamesToday >= 3 ? 0 : Math.min(50, Math.round(score)));

// ---------- 🥚 huevos dorados por rachas largas ----------
const EGGS = [
  { streak: 7, reward: { corn: 80 }, label: '80 de maíz' },
  { streak: 14, reward: { corn: 150, xp: 50 }, label: '150 de maíz y 50 XP' },
  { streak: 30, reward: { item: 'skin-rainbow', corn: 100 }, label: 'Plumas arcoíris (exclusivas) y 100 de maíz' },
  { streak: 60, reward: { corn: 400, xp: 150 }, label: '400 de maíz y 150 XP' },
  { streak: 100, reward: { item: 'buddy-golden', corn: 300 }, label: 'Amiguito dorado (exclusivo) y 300 de maíz' },
  { streak: 200, reward: { corn: 1000, xp: 400 }, label: '1000 de maíz y 400 XP' },
];
/** Huevos que la racha ya ganó y aún no tienes. */
function newEggs(streak, eggs = []) {
  const have = new Set(eggs.map((e) => e.streak));
  return EGGS.filter((e) => streak >= e.streak && !have.has(e.streak));
}
const nextEgg = (streak) => EGGS.find((e) => e.streak > streak) || null;

// ---------- 🎁 tu año con PM Pollito ----------
/** Resumen del año (hasta hoy). data: store.data; extra: { kudos, claudePrompts } */
function wrapped(data, year = new Date().getFullYear(), extra = {}) {
  const days = Object.entries(data.days || {}).filter(([k]) => k.startsWith(year + '-'));
  const w = { year, days: days.length, focusH: 0, tasks: 0, pomodoros: 0, commits: 0, claudeTasks: 0, dailies: 0, bestDay: null, hours: Array(24).fill(0), weekdays: Array(7).fill(0), months: Array(12).fill(0), projects: {} };
  for (const [k, d] of days) {
    const secs = (d.focus && d.focus.work) || 0;
    const done = ((d.standup && d.standup.today) || []).filter((t) => t.done).length;
    w.focusH += secs / 3600;
    w.tasks += done;
    w.pomodoros += d.pomodoros || 0;
    w.commits += d.commits || 0;
    w.claudeTasks += d.claudeTasks || 0;
    if (d.standup) w.dailies++;
    const dt = new Date(k + 'T12:00:00');
    w.weekdays[dt.getDay()] += secs;
    w.months[dt.getMonth()] += secs;
    for (const [h, v] of Object.entries(d.hours || {})) w.hours[Number(h)] += (v && v.w) || 0;
    for (const [p, v] of Object.entries(d.projects || {})) w.projects[p] = (w.projects[p] || 0) + (typeof v === 'number' ? v : (v && v.secs) || 0);
    if (!w.bestDay || secs > w.bestDay.secs) w.bestDay = { key: k, secs };
  }
  const argmax = (arr) => arr.reduce((b, v, i) => (v > arr[b] ? i : b), 0);
  const topProject = Object.entries(w.projects).sort((a, b) => b[1] - a[1])[0];
  const p = data.pet || {};
  const ach = (p.achievements || []).filter((a) => new Date(a.at).getFullYear() === year).length;
  const out = {
    year, days: w.days, dailies: w.dailies, focusH: Math.round(w.focusH), tasks: w.tasks, pomodoros: w.pomodoros, commits: w.commits, claudeTasks: w.claudeTasks,
    bestDay: w.bestDay && w.bestDay.secs ? { date: w.bestDay.key, hours: Math.round((w.bestDay.secs / 3600) * 10) / 10 } : null,
    bestHour: w.hours.some((v) => v) ? argmax(w.hours) : null, bestWeekday: w.weekdays.some((v) => v) ? DAYS[argmax(w.weekdays)] : null,
    bestMonth: w.months.some((v) => v) ? MONTHS[argmax(w.months)] : null, topProject: topProject ? topProject[0] : null,
    achievements: ach, kudos: extra.kudos || 0, claudePrompts: extra.claudePrompts || 0, bestScore: Math.max(p.bestScore || 0, ...Object.values(p.bestScores || {})),
    petName: p.name || 'PM', species: p.species || 'chick',
  };
  out.persona = persona(out);
  return out;
}
/** Tu "tipo" de año, para la tarjeta. */
function persona(w) {
  if (w.bestHour !== null && (w.bestHour >= 21 || w.bestHour < 5)) return { emoji: '🦉', name: 'Búho nocturno', why: `tu hora más productiva fue a las ${w.bestHour}:00` };
  if (w.bestHour !== null && w.bestHour < 9) return { emoji: '🌅', name: 'Madrugador', why: `rendiste más a las ${w.bestHour}:00` };
  if (w.claudeTasks >= 200) return { emoji: '🤖', name: 'Dúo con Claude', why: `${w.claudeTasks} tareas con Claude Code` };
  if (w.pomodoros >= 150) return { emoji: '🍅', name: 'Maestro tomatero', why: `${w.pomodoros} pomodoros` };
  if (w.commits >= 500) return { emoji: '🚀', name: 'Máquina de commits', why: `${w.commits} commits` };
  if (w.dailies >= 150) return { emoji: '🔥', name: 'Constante', why: `${w.dailies} dailies` };
  return { emoji: '🐣', name: 'En pleno crecimiento', why: 'cada día sumaste un poco' };
}
/** Texto para compartir (canal, redes). */
function wrappedText(w) {
  const lines = [`🎁 Mi ${w.year} con PM Pollito`, `${w.persona.emoji} ${w.persona.name}: ${w.persona.why}.`];
  if (w.focusH) lines.push(`🧠 ${w.focusH} h de trabajo enfocado`);
  if (w.tasks) lines.push(`✅ ${w.tasks} tareas completadas`);
  if (w.pomodoros) lines.push(`🍅 ${w.pomodoros} pomodoros`);
  if (w.commits) lines.push(`📦 ${w.commits} commits`);
  if (w.claudeTasks) lines.push(`🤖 ${w.claudeTasks} tareas con Claude Code`);
  if (w.topProject) lines.push(`🏆 Proyecto estrella: ${w.topProject}`);
  if (w.bestWeekday) lines.push(`📅 Mi mejor día: los ${w.bestWeekday}`);
  return lines.join('\n');
}

module.exports = { MISSIONS, MISSION_CORN, MISSION_PTS, missionsFor, missionView, TIER_PTS, MAX_TIER, seasonOf, seasonName, tierOf, tierReward, gamePts, EGGS, newEggs, nextEgg, wrapped, wrappedText, persona, keyOf };

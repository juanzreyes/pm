// Lógica pura de productividad (2.0): plan del día, mejor franja, tarea más difícil,
// acciones de una reunión, preguntas del pato de goma, "¿dónde me quedé?" y documento de logros.
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const DEFAULT_TASK_MIN = 45;

/**
 * ¿Cabe el plan en el día? tasks: [{done, est}], meetings: [{start, end}] (ms), horario "HH:MM".
 * Devuelve minutos planeados, de reuniones y libres, y si está sobrecargado.
 */
function planLoad({ tasks, meetings = [], morning = '08:00', evening = '16:30', now = new Date() }) {
  const pending = (tasks || []).filter((t) => !t.done);
  const unknown = pending.filter((t) => !(t.est > 0)).length;
  const plannedMin = pending.reduce((a, t) => a + (t.est > 0 ? t.est : DEFAULT_TASK_MIN), 0);
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  const start = Math.max(toMin(morning), now.getHours() * 60 + now.getMinutes());
  const end = toMin(evening);
  let meetingsMin = 0;
  for (const m of meetings) {
    const a = Math.max(start, (m.start - day0.getTime()) / 60e3);
    const b = Math.min(end, (m.end - day0.getTime()) / 60e3);
    if (b > a) meetingsMin += b - a;
  }
  const availableMin = Math.max(0, end - start - Math.round(meetingsMin));
  return { plannedMin, availableMin, meetingsMin: Math.round(meetingsMin), unknown, meetings: meetings.length, overload: availableMin ? plannedMin / availableMin : (plannedMin ? 9 : 0) };
}

/** Mejor franja de 2 h según las horas trabajadas de los últimos 14 días: { start: 'HH:00', end, hour } o null. */
function bestWindow(days, now = new Date()) {
  const byHour = Array(24).fill(0);
  for (let i = 0; i < 14; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    for (const [h, x] of Object.entries(((days || {})[keyOf(d)] || {}).hours || {})) byHour[h] += x.w || 0;
  }
  let best = -1, bh = 0;
  for (let h = 6; h < 21; h++) { const s = byHour[h] + byHour[h + 1]; if (s > best) { best = s; bh = h; } }
  if (best < 3 * 3600) return null; // aún no hay datos suficientes
  return { hour: bh, start: fromMin(bh * 60), end: fromMin((bh + 2) * 60) };
}

/** Índice de la tarea más difícil pendiente: prioridad alta, luego la de más estimación, luego la más larga. */
function hardestTask(tasks) {
  let best = -1, score = -1;
  (tasks || []).forEach((t, i) => {
    if (t.done) return;
    const s = (t.priority === 'h' ? 1000 : 0) + (t.est > 0 ? t.est : 0) + Math.min(60, String(t.text || '').length / 3);
    if (s > score) { score = s; best = i; }
  });
  return best;
}

/** ¿Choca una franja con bloques o reuniones? */
function overlaps(start, end, blocks = [], meetings = [], day0 = new Date()) {
  const a = toMin(start), b = toMin(end);
  const d0 = new Date(day0); d0.setHours(0, 0, 0, 0);
  if (blocks.some((x) => toMin(x.start) < b && toMin(x.end) > a)) return true;
  return meetings.some((m) => (m.start - d0.getTime()) / 60e3 < b && (m.end - d0.getTime()) / 60e3 > a);
}

// ---------- notas de reunión → tareas (sin IA: por patrones) ----------
const ACTION_RE = /(acci[oó]n|action item|\btodo\b|to-do|pendiente|tarea|next step|siguiente paso|se encarga|queda en|\bva a\b|tiene que|\bdebe|hay que|\brevis|\benv[ií]|\bprepar|\bactualiz|\bllam|\bagend|\bmand|\bcre[aoé]|\barregl|\bdefin|\bsub[eoi]|\bescrib|\bpreguntar|\bconfirm|\bdocument)/i;
const NOT_OWNER = /^(acci[oó]n|action item|todo|to-do|pendiente|tarea|next step|siguiente paso|nota|notas|acuerdo|decisi[oó]n)$/i;
/** Extrae acciones de una transcripción o notas. me: tu nombre o alias (para marcar las tuyas). */
function extractActions(text, me = []) {
  const mine = me.filter(Boolean).map((x) => x.toLowerCase());
  const out = [];
  const seen = new Set();
  for (let raw of String(text || '').split(/\r?\n/)) {
    raw = raw.replace(/^\s*(?:[-*•▪◦]|\d+[.)])\s*/, '').replace(/^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, '').trim();
    if (raw.length < 8 || !ACTION_RE.test(raw)) continue;
    // "Ana: enviar el informe" · "@ana enviar…" · "Ana se encarga de…" · "Ana va a…"
    let owner = '';
    let m = raw.match(/^@?([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.]+(?:\s[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)?)\s*[:\-–]\s*(.+)$/);
    if (m && !NOT_OWNER.test(m[1])) { owner = m[1]; raw = m[2]; } else if ((m = raw.match(/^([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)\s+(?:se encarga de|queda en|va a|tiene que|debe)\s+(.+)$/))) { owner = m[1]; raw = m[2]; } else if ((m = raw.match(/@([\w.]+)/))) owner = m[1];
    const textOut = raw.replace(/^(?:acci[oó]n|action item|todo|to-do|pendiente|tarea)\s*[:\-–]\s*/i, '').replace(/\s+/g, ' ').slice(0, 200);
    const k = textOut.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    const isMine = !owner || /^(yo|me|mí|mi|i)$/i.test(owner) || mine.some((x) => owner.toLowerCase().includes(x));
    out.push({ text: textOut.charAt(0).toUpperCase() + textOut.slice(1), owner, mine: isMine });
  }
  return out.slice(0, 30);
}

// ---------- 🦆 pato de goma (sin IA) ----------
const DUCK = [
  'Cuéntame qué intentas hacer, en una frase, como si yo no supiera nada (spoiler: no sé nada, soy un pato 🦆).',
  '¿Qué esperabas que pasara y qué pasa en cambio? Sé lo más concreto que puedas.',
  '¿Qué es lo último que cambiaste antes de que dejara de funcionar (o desde que empezaste)?',
  '¿Qué has comprobado ya, y cómo sabes que esa parte está bien? ¿Lo viste o lo supones?',
  'Si tuvieras que apostar dónde está el problema, ¿en qué línea o paso sería? ¿Por qué ahí?',
  '¿Cuál es el caso más pequeño que todavía falla? ¿Puedes reproducirlo en 3 líneas?',
  'Explícame ese paso línea a línea, en voz alta. Yo escucho 👂',
];
function duckNext(step) {
  if (step < DUCK.length) return DUCK[step];
  return '¿Ves algo nuevo después de contármelo? Si sí, ¡a por ello! Si no, quizá es momento de pasárselo a Claude o a un compañero 🤝 (escribe "listo" para terminar).';
}

// ---------- 📍 ¿dónde me quedé? ----------
/** Último día (antes de hoy) en que trabajaste en el proyecto, y hace cuántos días. */
function lastSeen(days, project, now = new Date()) {
  const today = keyOf(now);
  const keys = Object.keys(days || {}).filter((k) => k < today && ((days[k].projects || {})[project] || 0) >= 300).sort();
  const k = keys.pop();
  if (!k) return null;
  const [y, m, d] = k.split('-').map(Number);
  const t0 = new Date(now); t0.setHours(0, 0, 0, 0);
  return { day: k, daysAgo: Math.round((t0.getTime() - new Date(y, m - 1, d).getTime()) / 864e5) };
}
/** Resumen en 3-4 líneas. info: { project, seen, branch, commits:[{subject, when}], prompts:[texto], tickets:[{key,title}], note, run } */
function resumeLines(info) {
  const L = [];
  const when = info.seen ? (info.seen.daysAgo === 1 ? 'ayer' : `hace ${info.seen.daysAgo} días`) : 'la última vez';
  if (info.commits && info.commits.length) L.push(`📍 ${when.charAt(0).toUpperCase() + when.slice(1)}${info.branch ? ` en la rama ${info.branch}` : ''}: tu último commit fue «${info.commits[0].subject}»${info.commits[0].when ? ` (${info.commits[0].when})` : ''}.`);
  else if (info.branch) L.push(`📍 Estás en la rama ${info.branch}${info.seen ? ` (trabajaste aquí ${when})` : ''}.`);
  if (info.prompts && info.prompts.length) L.push(`🤖 Le pediste a Claude: «${info.prompts[info.prompts.length - 1].slice(0, 90)}».`);
  if (info.run) L.push(`🔧 La cola de Claude: «${info.run.text.slice(0, 60)}» → ${info.run.status}.`);
  if (info.tickets && info.tickets.length) L.push(`🎫 Tickets abiertos: ${info.tickets.slice(0, 3).map((t) => t.key).join(', ')}${info.tickets.length > 3 ? ` y ${info.tickets.length - 3} más` : ''}.`);
  if (info.note) L.push(`🗒️ Tu nota: «${info.note.slice(0, 90)}».`);
  if (!L.length) L.push(`📍 No tengo rastros recientes de ${info.project}: empieza por un git status 😉`);
  return L;
}

// ---------- 🏆 documento de logros ----------
/** Markdown con lo logrado entre dos fechas (ms). extra: { runs, achievements, milestones, name } */
function bragDoc(data, fromMs, toMs, extra = {}) {
  const days = data.days || {};
  const tasks = [];
  const tickets = [];
  const projects = {};
  let focus = 0, pomos = 0, commits = 0;
  for (const [k, d] of Object.entries(days)) {
    const [y, m, dd] = k.split('-').map(Number);
    const t = new Date(y, m - 1, dd).getTime();
    if (t < fromMs || t >= toMs) continue;
    for (const x of (d.standup && d.standup.today) || []) {
      if (!x.done) continue;
      if (x.issue) tickets.push(`${x.issue.key} ${x.text.replace(/^\[[^\]]+\]\s*/, '')}`);
      else tasks.push(x.text);
    }
    for (const [p, s] of Object.entries(d.projects || {})) projects[p] = (projects[p] || 0) + s;
    focus += (d.focus && d.focus.work) || 0;
    pomos += d.pomodoros || 0;
    commits += d.commits || 0;
  }
  const fmt = (ms) => new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
  const L = [`# 🏆 Mis logros · ${fmt(fromMs)} – ${fmt(toMs - 1)}`, ''];
  L.push(`**${tasks.length + tickets.length} cosas terminadas** · ${Math.round(focus / 3600)} h de trabajo enfocado · ${commits} commits · ${pomos} pomodoros`, '');
  const top = Object.entries(projects).filter(([p]) => p !== 'Reuniones').sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (top.length) { L.push('## 📂 Proyectos en los que más trabajé'); top.forEach(([p, s]) => L.push(`- **${p}**: ${Math.round(s / 3600)} h`)); L.push(''); }
  if (tickets.length) { L.push('## 🎫 Tickets cerrados'); tickets.slice(0, 60).forEach((x) => L.push(`- ${x}`)); L.push(''); }
  const runs = (extra.runs || []).filter((r) => r.pr && r.endedAt >= fromMs && r.endedAt < toMs);
  if (runs.length) { L.push('## 🚀 Pull requests (con Claude)'); runs.forEach((r) => L.push(`- ${r.text.split('\n')[0].slice(0, 100)} — ${r.pr}${r.prState === 'merged' ? ' ✅ mezclado' : ''}`)); L.push(''); }
  const ms = (extra.milestones || []).filter((m) => m.done && (!m.doneAt || (m.doneAt >= fromMs && m.doneAt < toMs)));
  if (ms.length) { L.push('## 🏁 Hitos cumplidos'); ms.forEach((m) => L.push(`- ${m.title}${m.project ? ` (${m.project})` : ''}`)); L.push(''); }
  if (tasks.length) { L.push('## ✅ Tareas terminadas'); tasks.slice(0, 120).forEach((x) => L.push(`- ${x}`)); L.push(''); }
  const ach = (extra.achievements || []).filter((a) => a.at >= fromMs && a.at < toMs);
  if (ach.length) { L.push('## 🏅 Logros del pollito'); ach.forEach((a) => L.push(`- ${a.emoji || '🏅'} ${a.name}`)); L.push(''); }
  L.push(`_Generado por ${extra.name || 'PM'} 🐣 a partir de tu actividad real._`);
  return { markdown: L.join('\n'), counts: { tasks: tasks.length, tickets: tickets.length, prs: runs.length, commits, hours: Math.round(focus / 3600) } };
}

module.exports = { planLoad, bestWindow, hardestTask, overlaps, extractActions, duckNext, DUCK, lastSeen, resumeLines, bragDoc, toMin, fromMin, keyOf };

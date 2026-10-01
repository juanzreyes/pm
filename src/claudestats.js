// Lógica pura de la cola de Claude (2.0): respetar tus límites, peticiones recurrentes,
// elegir modelo según la tarea y estadísticas de qué peticiones funcionan.
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return h * 60 + (m || 0); };

// ---------- ⏸️ respetar tus límites ----------
/**
 * ¿Se puede lanzar ya? usage: { limits: [{key, utilization, resetsAt}], forecast: { five_hour: {willHit, eta} } }.
 * Para si la sesión pasa del umbral o el pronóstico dice que la llenarás en menos de 45 min.
 */
function limitGuard(usage, pct = 85, now = Date.now()) {
  const lims = (usage && usage.limits) || [];
  const s = lims.find((l) => l.key === 'five_hour');
  const w = lims.find((l) => l.key === 'seven_day');
  if (w && w.utilization >= 98) return { ok: false, reason: `tu límite semanal va al ${Math.round(w.utilization)}%`, until: Date.parse(w.resetsAt) || now + 6 * 3600e3 };
  if (!s) return { ok: true };
  const until = Date.parse(s.resetsAt) || now + 3600e3;
  if (s.utilization >= pct) return { ok: false, reason: `tu sesión va al ${Math.round(s.utilization)}%`, until };
  const f = usage.forecast && usage.forecast.five_hour;
  if (f && f.willHit && f.eta && f.eta - now < 45 * 60e3 && f.eta < until) return { ok: false, reason: `a este ritmo llenas la sesión a las ${new Date(f.eta).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`, until };
  return { ok: true };
}

// ---------- 🔁 peticiones recurrentes ----------
/** ¿Toca hoy? rec: { days: [0-6], time: 'HH:MM', lastRun: 'YYYY-MM-DD' } */
function isDue(rec, now = new Date()) {
  if (!rec || rec.paused) return false;
  if (!(rec.days || []).includes(now.getDay())) return false;
  if (rec.lastRun === keyOf(now)) return false;
  return now.getHours() * 60 + now.getMinutes() >= toMin(rec.time || '09:00');
}
const DAY_SETS = { lab: [1, 2, 3, 4, 5], all: [0, 1, 2, 3, 4, 5, 6] };

// ---------- 🧠 modelo según la tarea ----------
/** @type {Array<[string, RegExp]>} */
const KINDS = [
  ['tests', /\b(tests?|pruebas?|cobertura|coverage|unit|e2e|spec)\b/i],
  ['bug', /\b(bug|fallo|falla|error|arregla|corrige|fix|crash|rompe|no funciona|excepci[oó]n)\b/i],
  ['refactor', /\b(refactor\w*|reestructur\w*|limpi\w*|simplific\w*|reorganiz\w*|extrae|divide)\b/i],
  ['docs', /\b(docs?|documenta\w*|readme|comentarios?|changelog|explica)\b/i],
  ['deps', /\b(dependencias|deps|actualiza\w* (?:los )?paquetes|npm update|upgrade|bump|versiones)\b/i],
  ['feature', /\b(a[nñ]ade|agrega|crea|implementa|nueva|nuevo|feature|funcionalidad|soporte para)\b/i],
];
function classify(text) {
  const t = String(text || '');
  for (const [k, re] of KINDS) if (re.test(t)) return k;
  return 'otro';
}
const HARD = /\b(arquitectura|migra\w*|redise[nñ]\w*|concurrenc\w*|rendimiento|performance|seguridad|race condition|condici[oó]n de carrera|multihilo|base de datos|esquema|sincroniz\w*|algoritmo)\b/i;
const EASY = /\b(typo|errata|renombra\w*|formatea\w*|lint|ortograf\w*|traduce|actualiza el readme|bump|comentario)\b/i;
const LADDER = ['haiku', 'sonnet', 'opus'];
/**
 * Modelo para una petición: fácil → haiku, difícil → opus, lo demás → sonnet.
 * Si ya gastaste mucho del presupuesto semanal (≥80%), baja un escalón.
 */
function chooseModel(text, { budgetPct = 0 } = {}) {
  const t = String(text || '');
  let i = 1;
  if (EASY.test(t) || (t.length < 90 && ['docs', 'deps'].includes(classify(t)))) i = 0;
  if (HARD.test(t) || t.length > 1500 || classify(t) === 'refactor') i = 2;
  const reasons = [i === 0 ? 'tarea sencilla' : i === 2 ? 'tarea difícil' : 'tarea normal'];
  if (budgetPct >= 80 && i > 0) { i--; reasons.push(`presupuesto al ${Math.round(budgetPct)}%`); }
  return { model: LADDER[i], why: reasons.join(', ') };
}

// ---------- 📈 qué peticiones funcionan ----------
const OUTCOME = (r) => (r.prState === 'merged' ? 'merged' : r.status === 'pr' ? 'pr' : r.status === 'accepted' || r.status === 'pushed' ? 'accepted' : r.status === 'discarded' ? 'discarded' : r.status === 'empty' ? 'empty' : r.status === 'failed' ? 'failed' : null);
/** Por tipo de petición: cuántas, cuántas terminaron bien (PR mezclado o aceptadas), coste y duración medios. */
function stats(runs) {
  const by = {};
  for (const r of runs || []) {
    if (r.kind === 'fix') continue;
    const o = OUTCOME(r);
    if (!o) continue;
    const k = classify(r.text);
    const s = by[k] || (by[k] = { kind: k, n: 0, good: 0, merged: 0, discarded: 0, failed: 0, cost: 0, mins: 0, models: {} });
    s.n++;
    if (o === 'merged' || o === 'accepted' || o === 'pr') s.good++;
    if (o === 'merged') s.merged++;
    if (o === 'discarded' || o === 'empty') s.discarded++;
    if (o === 'failed') s.failed++;
    s.cost += r.cost || 0;
    if (r.endedAt && r.startedAt) s.mins += (r.endedAt - r.startedAt) / 60e3;
    if (r.model) s.models[r.model] = (s.models[r.model] || 0) + 1;
  }
  const rows = Object.values(by).map((s) => ({ ...s, rate: s.n ? s.good / s.n : 0, avgCost: s.n ? s.cost / s.n : 0, avgMins: s.n ? s.mins / s.n : 0 })).sort((a, b) => b.n - a.n);
  const tips = [];
  for (const s of rows) {
    if (s.n < 3) continue;
    if (s.rate < 0.4) tips.push(`Las peticiones de ${NAMES[s.kind]} solo salen bien el ${Math.round(s.rate * 100)}%: divídelas en pasos más pequeños y di qué archivo tocar.`);
    else if (s.rate >= 0.8) tips.push(`Las de ${NAMES[s.kind]} te funcionan muy bien (${Math.round(s.rate * 100)}%): buenas candidatas para la cola automática.`);
  }
  const total = rows.reduce((a, s) => a + s.n, 0);
  return { rows, tips, total };
}
const NAMES = { tests: 'tests', bug: 'bugs', refactor: 'refactor', docs: 'documentación', deps: 'dependencias', feature: 'funcionalidades', otro: 'otras cosas' };

module.exports = { limitGuard, isDue, DAY_SETS, classify, chooseModel, stats, NAMES, LADDER };

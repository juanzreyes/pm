// Organización:
//  · cola de peticiones para Claude · presupuesto semanal de Claude
//  · priorizar el día (IA o reglas) · dividir tareas en pasos
//  · tareas que envejecen · proyectos con hitos · revisión del viernes
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s+/g, ' ').trim();

/** Días laborables entre dos fechas (sin contar el primero). */
function workdaysBetween(a, b) {
  const d = new Date(a); d.setHours(0, 0, 0, 0);
  const end = new Date(b); end.setHours(0, 0, 0, 0);
  let n = 0;
  while (d < end) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n++; }
  return n;
}

function create(ctx) {
  const S = () => ctx.store.data;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const tasks = () => ((ctx.today().standup && ctx.today().standup.today) || []);

  // ================= COLA DE PETICIONES PARA CLAUDE =================
  const queue = () => (S().claudeQueue = S().claudeQueue || []);
  /** extra: { issue } si la petición viene de un ticket (el PR lo menciona). */
  function queueAdd(text, project, extra = {}) {
    text = String(text || '').trim().slice(0, 12000);
    if (!text) return false;
    queue().push({ id: newId(), text, project: project || '', at: Date.now(), ...(extra.issue ? { issue: extra.issue } : {}), ...(['haiku', 'sonnet', 'opus'].includes(extra.model) ? { model: extra.model } : {}) });
    ctx.store.save();
    ctx.broadcast();
    return true;
  }
  function queueRemove(id) {
    (S().tombstones = S().tombstones || {})[id] = Date.now(); // para que no reaparezca al sincronizar
    S().claudeQueue = queue().filter((q) => q.id !== id);
    ctx.store.save();
    ctx.broadcast();
  }
  /** Copia la siguiente petición (de ese proyecto si hay) y la quita de la cola. */
  function queueNext(project) {
    const list = queue();
    const i = Math.max(0, project ? list.findIndex((q) => q.project && q.project === project) : 0);
    const q = list[i];
    if (!q) return null;
    ctx.clipboard.writeText(q.text);
    list.splice(i, 1);
    (S().tombstones = S().tombstones || {})[q.id] = Date.now();
    ctx.store.save();
    ctx.broadcast();
    ctx.say(`📋 Siguiente petición copiada. ¡Pégala en Claude!${list.length ? ` (quedan ${list.length})` : ''}`, 'peck', 6000, { log: false });
    return q;
  }
  /** Claude terminó: si hay cola, lo recuerda. */
  function onClaudeDone(project) {
    const list = queue();
    if (!list.length) return false;
    const mine = list.filter((q) => !q.project || q.project === project);
    const next = mine[0] || list[0];
    ctx.say(`🤖 Claude terminó en ${project}. En tu cola tienes ${list.length}: "${next.text.slice(0, 60)}${next.text.length > 60 ? '…' : ''}"`, 'celebrate', 15000, {
      cat: 'claude', actions: [{ label: '📋 Copiar siguiente', cmd: 'queue.next', arg: next.project || '' }, { label: '📋 Ver cola', cmd: 'panel', arg: 'day#claude-queue' }],
    });
    return true;
  }

  // ================= PRESUPUESTO DE CLAUDE =================
  function weekStart() {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // lunes
    return d;
  }
  function budgetState() {
    const budget = Number(S().settings.claudeBudget) || 0;
    const local = ctx.usage().local;
    if (!local) return { budget, spent: 0, pct: 0 };
    const ws = weekStart();
    let spent = 0;
    for (const [k, v] of Object.entries(local.byDay || {})) {
      const [y, m, d] = k.split('-').map(Number);
      if (new Date(y, m - 1, d) >= ws) spent += v.cost || 0;
    }
    const top = Object.entries((local.week && local.week.projects) || {}).sort((a, b) => b[1].cost - a[1].cost)[0];
    // Proyección: ritmo de los días transcurridos → semana completa.
    const daysGone = Math.max(1, ((Date.now() - ws.getTime()) / 864e5));
    const projected = (spent / daysGone) * 7;
    return { budget, spent, pct: budget ? (spent / budget) * 100 : 0, top: top ? { name: top[0], cost: top[1].cost } : null, projected };
  }
  function budgetTick() {
    const b = budgetState();
    if (!b.budget) return;
    const wk = keyOf(weekStart());
    for (const t of [80, 100]) {
      const k = `budget|${wk}|${t}`;
      if (b.pct >= t && !S().alerts[k]) {
        S().alerts[k] = [1];
        ctx.store.save();
        const topTxt = b.top ? ` Lo que más gasta: ${b.top.name} ($${b.top.cost.toFixed(2)}).` : '';
        ctx.say(t >= 100
          ? `💸 ¡Te pasaste del presupuesto de Claude! $${b.spent.toFixed(2)} de $${b.budget} esta semana.${topTxt}`
          : `💰 Llevas el ${Math.round(b.pct)}% de tu presupuesto semanal de Claude ($${b.spent.toFixed(2)} de $${b.budget}).${topTxt}`,
        t >= 100 ? 'alarm' : 'alert', 14000, { cat: 'usage', target: { cmd: 'panel', arg: 'usage#budget' } });
        break;
      }
    }
  }

  // ================= TAREAS QUE ENVEJECEN =================
  const ages = () => (S().taskAges = S().taskAges || {});
  /** Anota cuándo apareció cada tarea (por su texto) para saber cuánto lleva posponiéndose. */
  function ageTick() {
    const a = ages();
    const today = keyOf(new Date());
    const live = new Set();
    for (const t of tasks()) {
      const k = norm(t.text);
      if (!k) continue;
      live.add(k);
      if (!a[k]) a[k] = { first: today };
      a[k].last = today;
      if (t.done) a[k].done = today;
    }
    // Limpieza: lo que no aparece desde hace 30 días.
    const cut = keyOf(new Date(Date.now() - 30 * 864e5));
    for (const [k, v] of Object.entries(a)) if ((v.last || v.first) < cut) delete a[k];
  }
  function ageOf(text) {
    const v = ages()[norm(text)];
    if (!v) return 0;
    const [y, m, d] = v.first.split('-').map(Number);
    return workdaysBetween(new Date(y, m - 1, d), new Date());
  }
  function agingNudge() {
    const h = new Date().getHours();
    if (h < 9 || h >= 12 || ctx.isMuted()) return;
    const k = `aging|${keyOf(new Date())}`;
    if (S().alerts[k]) return;
    const list = tasks().map((t, i) => ({ t, i, age: ageOf(t.text) })).filter((x) => !x.t.done && x.age >= 4).sort((a, b) => b.age - a.age);
    if (!list.length) return;
    S().alerts[k] = [1];
    ctx.store.save();
    const x = list[0];
    ctx.say(`🔥 "${x.t.text}" lleva ${x.age} días posponiéndose. ¿Qué hacemos con ella?`, 'judge', 20000, {
      cat: 'routine', actions: [
        { label: '💪 Hoy la hago', cmd: 'task.commit', arg: x.i },
        { label: '🤝 Delegar', cmd: 'task.delegate', arg: x.i },
        { label: '🗑️ Borrar', cmd: 'task.drop', arg: x.i },
      ],
    });
  }
  function taskCommit(i) {
    const t = tasks()[i];
    if (!t) return;
    t.priority = 'h';
    ctx.store.save(); ctx.broadcast();
    ctx.say('💪 ¡Eso! Prioridad alta. Empieza por ella y te la quitas de encima.', 'hop', 6000, { log: false, actions: [{ label: '⏱ Cronómetro', cmd: 'task.timer', arg: i }] });
  }
  function taskDelegate(i) {
    const t = tasks()[i];
    if (!t) return;
    t.done = true; t.delegated = true; t.text = t.text.replace(/^🤝 /, '') ;
    t.text = '🤝 ' + t.text;
    ctx.store.save(); ctx.broadcast();
    ctx.say('🤝 Marcada como delegada. ¡Menos carga para ti!', 'peck', 5000, { log: false });
  }
  function taskDrop(i) {
    const list = tasks();
    if (!list[i]) return;
    const [t] = list.splice(i, 1);
    const a = ages()[norm(t.text)];
    if (a) a.dropped = keyOf(new Date());
    ctx.store.save(); ctx.broadcast();
    ctx.say(`🗑️ "${t.text}" fuera. A veces soltar también es avanzar ✨`, 'peck', 6000, { log: false });
  }

  // ================= PRIORIZAR EL DÍA =================
  const PRIO = { h: 3, m: 2, l: 1 };
  function heuristicOrder() {
    const list = tasks();
    const h = new Date().getHours();
    const scored = list.map((t, i) => {
      if (t.done) return { i, s: -1000 };
      let s = (PRIO[t.priority] || 1.5) * 10;
      s += Math.min(10, ageOf(t.text) * 2); // lo que se arrastra sube
      if (t.time && /^\d{2}:\d{2}$/.test(t.time)) s += Math.max(0, 12 - (toMin(t.time) - h * 60) / 30); // con hora cercana, antes
      if (t.est) s += t.est <= 30 ? 3 : t.est >= 120 && h >= 15 ? -4 : 0; // tardes: cosas cortas
      if (/urgente|asap|hoy|bloque|bug|fix|arreglar|deploy|entrega/i.test(t.text)) s += 5;
      return { i, s };
    });
    return scored.sort((a, b) => b.s - a.s).map((x) => x.i);
  }
  /** Huecos libres de hoy (entre reuniones y bloques), desde ahora hasta las 19:00. */
  function freeSlots() {
    const now = new Date();
    let start = Math.max(9 * 60, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15);
    const end = 19 * 60;
    const busy = (ctx.today().blocks || []).map((b) => [toMin(b.start), toMin(b.end)]);
    for (const ev of ctx.meetingsToday()) {
      const s = new Date(ev.start), e = new Date(ev.end);
      busy.push([s.getHours() * 60 + s.getMinutes(), e.getHours() * 60 + e.getMinutes()]);
    }
    busy.push([13 * 60, 14 * 60]); // comida
    busy.sort((a, b) => a[0] - b[0]);
    const slots = [];
    for (const [a, b] of busy) {
      if (a > start && a - start >= 25) slots.push([start, Math.min(a, end)]);
      start = Math.max(start, b);
    }
    if (end - start >= 25) slots.push([start, end]);
    return slots.filter(([a, b]) => b > a);
  }
  async function prioritize(withBlocks = true) {
    const list = tasks();
    if (!list.filter((t) => !t.done).length) {
      ctx.say('No tienes tareas pendientes para ordenar ✨', 'peck', 5000, { log: false });
      return false;
    }
    let order = heuristicOrder();
    let why = '';
    if (ctx.aiAvailable()) {
      try {
        const txt = await ctx.ai().polish(
          list.map((t, i) => `${i}. ${t.done ? '[hecha] ' : ''}${t.text}${t.priority ? ` (prioridad ${t.priority})` : ''}${t.est ? ` (~${t.est} min)` : ''}${t.time ? ` (a las ${t.time})` : ''} · lleva ${ageOf(t.text)} días`).join('\n')
          + `\n\nReuniones de hoy: ${ctx.meetingsToday().map((e) => new Date(e.start).toTimeString().slice(0, 5) + ' ' + e.title).join(', ') || 'ninguna'}\nHora actual: ${new Date().toTimeString().slice(0, 5)}\nPatrones: ${ctx.insights().join(' ')}`,
          'Ordena estas tareas de hoy de la más a la menos importante teniendo en cuenta urgencia, reuniones, lo que se lleva días posponiendo y la energía (lo difícil cuando más rinde). Responde SOLO con JSON: {"order":[índices], "why":"una frase corta explicando el criterio"}. Las tareas hechas van al final.');
        const j = JSON.parse(txt.replace(/^[^{]*/, '').replace(/[^}]*$/, ''));
        if (Array.isArray(j.order)) {
          const seen = new Set();
          const clean = j.order.map(Number).filter((i) => Number.isInteger(i) && list[i] && !seen.has(i) && seen.add(i));
          for (let i = 0; i < list.length; i++) if (!seen.has(i)) clean.push(i);
          order = clean;
          why = String(j.why || '').slice(0, 160);
        }
      } catch { /* reglas */ }
    }
    const reordered = order.map((i) => list[i]);
    list.splice(0, list.length, ...reordered);
    let placed = 0;
    if (withBlocks) {
      const slots = freeSlots();
      const blocks = (ctx.today().blocks || []).slice();
      const planned = new Set(blocks.map((b) => b.title));
      for (const t of list.filter((x) => !x.done && !planned.has(x.text))) {
        const need = Math.max(30, Math.min(120, t.est || 60));
        const slot = slots.find(([a, b]) => b - a >= Math.min(need, 30));
        if (!slot) break;
        const len = Math.min(need, slot[1] - slot[0]);
        blocks.push({ start: fromMin(slot[0]), end: fromMin(slot[0] + len), title: t.text, task: list.indexOf(t) });
        slot[0] += len + 10;
        placed++;
      }
      ctx.setBlocks(blocks);
    }
    ctx.store.save();
    ctx.broadcast();
    ctx.say(`🧠 Día ordenado: empieza por "${list[0].text}".${placed ? ` Te reservé ${placed} bloque${placed === 1 ? '' : 's'} en tus huecos libres.` : ''}${why ? `\n${why}` : ''}`, 'read', 12000, {
      log: false, target: { cmd: 'panel', arg: 'day#tasks' }, actions: placed ? [{ label: '🗓️ Ver bloques', cmd: 'blocks' }] : [],
    });
    return true;
  }

  // ================= DIVIDIR TAREAS =================
  function genericSteps(text) {
    if (/bug|error|fallo|arreglar|fix/i.test(text)) return ['Reproducir el problema', 'Encontrar la causa', 'Arreglar y añadir un test', 'Probar y subir el cambio'];
    if (/informe|documento|presentaci[oó]n|report|doc/i.test(text)) return ['Reunir datos y fuentes', 'Hacer el esquema', 'Escribir el borrador', 'Revisar y enviar'];
    if (/reuni[oó]n|meeting|llamada/i.test(text)) return ['Preparar la agenda', 'Enviar la invitación', 'Tener la reunión', 'Mandar resumen y próximos pasos'];
    return ['Aclarar qué significa "terminado"', 'Primer paso pequeño (15 min)', 'Hacer el grueso del trabajo', 'Revisar y cerrar'];
  }
  async function splitTask(i) {
    const list = tasks();
    const t = list[i];
    if (!t) return false;
    let steps = null;
    if (ctx.aiAvailable()) {
      try {
        const txt = await ctx.ai().polish(t.text, 'Divide esta tarea en 3-6 pasos concretos y accionables (cada uno de menos de 1 hora). Responde SOLO con los pasos, uno por línea, sin numerar, cada uno de menos de 70 caracteres, en el idioma de la tarea.');
        steps = txt.split('\n').map((l) => l.replace(/^[\s\-*•\d.)]+/, '').trim()).filter(Boolean).slice(0, 6);
      } catch { /* pasos genéricos */ }
    }
    if (!steps || !steps.length) steps = genericSteps(t.text);
    const subs = steps.map((s) => ({ text: `↳ ${s}`, done: false, parent: t.text }));
    list.splice(i + 1, 0, ...subs);
    ctx.store.save();
    ctx.broadcast();
    ctx.say(`🪜 "${t.text.slice(0, 40)}" dividida en ${subs.length} pasos. ¡Paso a paso se llega! 🐣`, 'peck', 7000, { log: false });
    return true;
  }

  // ================= PROYECTOS CON HITOS =================
  const milestones = () => (S().milestones = S().milestones || []);
  function milestoneSave(m) {
    const title = String(m.title || '').trim().slice(0, 80);
    const due = String(m.due || '');
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return false;
    const list = milestones();
    const ex = m.id && list.find((x) => x.id === m.id);
    const data = { title, due, project: String(m.project || '').trim().slice(0, 60), hours: Math.max(0, Number(m.hours) || 0) };
    if (ex) Object.assign(ex, data);
    else list.push({ id: newId(), ...data, created: keyOf(new Date()), done: false });
    ctx.store.save();
    ctx.broadcast();
    return true;
  }
  function milestoneDone(id, done = true) {
    const x = milestones().find((m) => m.id === id);
    if (!x) return false;
    x.done = !!done;
    x.doneAt = done ? Date.now() : null; // para el documento de logros
    if (done) { ctx.addXp(25); ctx.say(`🏁 ¡Hito conseguido: "${x.title}"! +25 XP 🎉`, 'celebrate', 10000, { cat: 'achievement' }); }
    ctx.store.save();
    ctx.broadcast();
    return true;
  }
  function milestoneDelete(id) {
    (S().tombstones = S().tombstones || {})[id] = Date.now();
    S().milestones = milestones().filter((m) => m.id !== id);
    ctx.store.save();
    ctx.broadcast();
  }
  /** Horas dedicadas al proyecto desde que se creó el hito. */
  function hoursOn(project, since) {
    if (!project) return 0;
    let s = 0;
    const p = norm(project);
    for (const [k, v] of Object.entries(S().days)) {
      if (k < since) continue;
      for (const [name, secs] of Object.entries(v.projects || {})) if (norm(name) === p) s += secs;
    }
    return s / 3600;
  }
  function milestonesView() {
    const today = keyOf(new Date());
    return milestones().map((m) => {
      const [y, mo, d] = m.due.split('-').map(Number);
      const dueDate = new Date(y, mo - 1, d);
      const days = Math.round((dueDate.getTime() - new Date().setHours(0, 0, 0, 0)) / 864e5);
      const left = workdaysBetween(new Date(), dueDate) + (dueDate.getDay() % 6 ? 1 : 0);
      const spent = hoursOn(m.project, m.created);
      const remaining = m.hours ? Math.max(0, m.hours - spent) : 0;
      const perDay = m.hours && left > 0 ? remaining / left : 0;
      const status = m.done ? 'done' : days < 0 ? 'late' : (m.hours && perDay > 6) || (days <= 1 && remaining > 4) ? 'risk' : 'ok';
      return { ...m, days, spent: Math.round(spent * 10) / 10, remaining: Math.round(remaining * 10) / 10, perDay: Math.round(perDay * 10) / 10, status, overdue: m.due < today && !m.done };
    }).sort((a, b) => (a.done - b.done) || a.due.localeCompare(b.due));
  }
  function milestonesTick() {
    const h = new Date().getHours();
    if (h < 9 || h >= 18 || ctx.isMuted()) return;
    for (const m of milestonesView()) {
      if (m.done) continue;
      const k = `ms|${m.id}|${m.days}`;
      if (S().alerts[k]) continue;
      let text = null;
      if ([7, 3, 1, 0].includes(m.days)) text = m.days === 0 ? `🏁 ¡Hoy es la entrega de "${m.title}"! 💪` : `🏁 Faltan ${m.days} día${m.days === 1 ? '' : 's'} para "${m.title}"${m.hours ? ` · te quedan ~${m.remaining} h` : ''}.`;
      else if (m.status === 'risk' && m.days > 0) text = `⚠️ "${m.title}" va justa: necesitas ~${m.perDay} h/día hasta la entrega.`;
      else if (m.status === 'late' && m.days === -1) text = `⏰ "${m.title}" venció ayer. ¿La marcamos como hecha o movemos la fecha?`;
      if (!text) continue;
      S().alerts[k] = [1];
      ctx.store.save();
      ctx.say(text, m.status === 'ok' ? 'read' : 'alert', 12000, { cat: 'routine', target: { cmd: 'panel', arg: 'agenda#milestones' } });
      break;
    }
  }

  // ================= REVISIÓN DEL VIERNES =================
  function fridayTick() {
    const d = new Date();
    if (d.getDay() !== 5 || d.getHours() < 16 || d.getHours() >= 19 || ctx.isMuted() || ctx.getMeeting()) return;
    const k = `friday|${keyOf(d)}`;
    if (S().alerts[k]) return;
    S().alerts[k] = [1];
    ctx.store.save();
    ctx.say('📆 ¡Viernes! ¿Hacemos la revisión de la semana? Son 2 minutos y el lunes empiezas con todo listo.', 'read', 20000, {
      cat: 'routine', actions: [{ label: '📆 Revisar la semana', cmd: 'panel', arg: 'friday' }, { label: '⏰ Luego', cmd: 'ack' }],
    });
  }
  function fridaySave(r) {
    const plan = (r.plan || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 10);
    S().nextWeekPlan = { plan, note: String(r.note || '').slice(0, 1000), at: Date.now() };
    for (const g of r.goals || []) if (g && g.id) ctx.saveGoal({ id: g.id, progress: g.progress });
    ctx.addXp(10);
    ctx.store.save();
    ctx.broadcast();
    ctx.say(`📆 ¡Semana cerrada! El lunes te propongo ${plan.length} tarea${plan.length === 1 ? '' : 's'} para empezar. ¡Buen finde! 🎉 +10 XP`, 'celebrate', 9000, { log: false });
    return true;
  }
  /** Plan del lunes (lo añade el daily). */
  function mondayPlan() {
    const p = S().nextWeekPlan;
    if (!p || !p.plan.length || Date.now() - p.at > 5 * 864e5) return [];
    return new Date().getDay() === 1 ? p.plan : [];
  }

  function snapshot() {
    return {
      claudeQueue: queue(),
      budget: budgetState(),
      milestones: milestonesView(),
      taskAges: tasks().map((t) => ageOf(t.text)),
      mondayPlan: mondayPlan(),
      nextWeekPlan: S().nextWeekPlan || null,
    };
  }

  function start() {
    setInterval(() => { ageTick(); agingNudge(); milestonesTick(); fridayTick(); budgetTick(); }, 60000);
    setTimeout(() => { ageTick(); budgetTick(); }, 15000);
  }

  return {
    start, snapshot,
    queueAdd, queueRemove, queueNext, onClaudeDone,
    budgetState, prioritize, splitTask, heuristicOrder,
    ageOf, taskCommit, taskDelegate, taskDrop,
    milestoneSave, milestoneDone, milestoneDelete, milestonesView,
    fridaySave, mondayPlan,
  };
}

module.exports = { create, workdaysBetween, norm };

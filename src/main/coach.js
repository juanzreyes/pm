// El pollito coach (2.0): detecta cuando estás atascado, hace de pato de goma, revisa si tu plan
// cabe en el día, reserva tu mejor hora para lo difícil, cierra la jornada contigo y convierte
// notas de reunión en tareas.
// Parte del proceso principal. `M` es el contexto compartido de la app.
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  const lib = require('../coachlib');
  const S = () => M.store.data;
  const set = () => S().settings;
  const tasks = () => (M.today().standup && M.today().standup.today) || [];

  // =====================================================================
  // 🧱 ATASCADO
  // =====================================================================
  // 45 min de trabajo en el mismo archivo y proyecto, sin commits ni tareas hechas = probablemente atascado.
  let stuck = { key: '', since: 0, work: 0, lastAt: 0, commits: 0, done: 0, warned: 0 };
  const STUCK_SECS = 45 * 60;
  function onSample(s, cat) {
    if (cat !== 'work' || set().stuckDetector === false || M.TEST) return;
    const project = M.prod ? M.prod.projectOf(s) : '';
    if (!project || !M.repoByName(project)) { stuck.key = ''; return; }
    const key = `${project}|${s.t}`;
    const now = Date.now();
    const commits = M.today().commits || 0;
    const done = tasks().filter((t) => t.done).length;
    if (stuck.key !== key || commits !== stuck.commits || done !== stuck.done) {
      stuck = { key, project, file: String(s.t || '').split(' - ')[0].slice(0, 80), since: now, work: 0, lastAt: now, commits, done, warned: stuck.warned };
      return;
    }
    stuck.work += Math.min(15, (now - stuck.lastAt) / 1000);
    stuck.lastAt = now;
    if (stuck.work < STUCK_SECS || now - stuck.warned < 60 * 60e3 || M.focusMode() || M.meetingNow) return;
    stuck.warned = now;
    const mins = Math.round(stuck.work / 60);
    M.say(`🧱 Llevas ${mins} min con «${stuck.file}» en ${stuck.project} sin avanzar (ni commits ni tareas). ¿Lo hablamos o se lo pasamos a Claude?`, 'look', 25000, {
      cat: 'pet', actions: [{ label: '🦆 Hablarlo conmigo', cmd: 'duck.start', arg: stuck.file }, { label: '🤖 A la cola de Claude', cmd: 'coach.stuck.claude' }, { label: 'Estoy bien', cmd: 'ack' }],
    });
  }
  function stuckToClaude() {
    if (!stuck.project) return false;
    M.plan.queueAdd(`Estoy atascado en «${stuck.file}» del proyecto ${stuck.project}. Revisa ese archivo y lo que lo rodea, encuentra qué puede estar fallando y propón (o aplica) la solución explicando por qué.`, stuck.project);
    M.say('🤖 Lo puse en la cola de Claude. Pulsa ▶ para que se ponga ya.', 'peck', 7000, { log: false, target: { cmd: 'panel', arg: 'day#claude-queue' } });
    return true;
  }

  // =====================================================================
  // 🦆 PATO DE GOMA
  // =====================================================================
  let duck = null; // { step, topic, history: [] }
  function duckStart(topic) {
    duck = { step: 0, topic: String(topic || '').slice(0, 80), history: [] };
    const intro = `🦆 Modo pato de goma${duck.topic ? ` (con ${duck.topic})` : ''}: tú me lo explicas y yo pregunto. No te doy la respuesta, la vas a encontrar tú. Escribe "listo" cuando quieras terminar.\n\n${lib.duckNext(0)}`;
    M.pushChat('pet', intro);
    M.openPanel('chat');
    M.broadcast();
    return intro;
  }
  const duckActive = () => !!duck;
  async function duckReply(text) {
    if (/^(listo|gracias|ya est[aá]|lo encontr[eé]|salir|\/salir|stop|done)\b/i.test(text.trim())) {
      duck = null;
      M.addXp(3);
      return '🦆 ¡Cuac! Muy bien explicado. Si lo resolviste, ¡celébralo! Si no, la cola de Claude está a un clic 🤖';
    }
    duck.history.push(text);
    duck.step++;
    if (M.aiAvailable()) {
      try {
        const convo = duck.history.map((h, i) => `Persona (${i + 1}): ${h}`).join('\n');
        const q = await M.ai.polish(convo, 'Eres un pato de goma para depurar código o desbloquear un problema. NO des la solución ni código. Haz UNA sola pregunta socrática, corta y concreta (máx. 35 palabras), basada en lo último que dijo la persona, que la ayude a encontrar ella misma el fallo (supuestos, qué comprobó, caso mínimo, diferencia entre lo esperado y lo real). Empieza con "🦆".');
        return q.trim();
      } catch { /* sin IA: preguntas guionadas */ }
    }
    return `🦆 ${lib.duckNext(duck.step)}`;
  }

  // =====================================================================
  // 😈 ABOGADO DEL DIABLO + 🕙 TU MEJOR HORA (al guardar el daily)
  // =====================================================================
  function reviewPlan() {
    if (set().planCheck === false) return null;
    const meetings = M.todaysMeetings ? M.todaysMeetings() : [];
    const load = lib.planLoad({ tasks: tasks(), meetings, morning: set().morningTime, evening: set().eveningTime });
    if (load.plannedMin && load.overload > 1.15) {
      const h = (m) => (m >= 60 ? `${Math.round(m / 6) / 10} h` : `${m} min`);
      setTimeout(() => M.say(`😈 Abogado del diablo: planeaste ~${h(load.plannedMin)} de tareas${load.unknown ? ` (${load.unknown} sin estimar, les puse 45 min)` : ''}, pero hoy te quedan ~${h(load.availableMin)} libres${load.meetings ? ` con ${load.meetings} reunion${load.meetings === 1 ? '' : 'es'}` : ''}. ¿Priorizamos y movemos algo a mañana?`, 'judge', 20000, {
        cat: 'routine', actions: [{ label: '🧠 Priorizar', cmd: 'day.prioritize' }, { label: 'Me la juego', cmd: 'ack' }],
      }), 9000);
    }
    // Lo más difícil, en tu mejor franja (si está libre y aún no pasó).
    const win = lib.bestWindow(S().days);
    const i = lib.hardestTask(tasks());
    if (win && i >= 0 && set().bestHour !== false) {
      const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      const free = !lib.overlaps(win.start, win.end, M.today().blocks || [], meetings);
      if (free && lib.toMin(win.start) > nowMin) {
        const t = tasks()[i];
        setTimeout(() => M.say(`🕙 Tu mejor franja suele ser ${win.start}–${win.end}. ¿Te la reservo para lo más difícil: «${t.text.slice(0, 60)}»?`, 'peck', 20000, {
          cat: 'routine', actions: [{ label: `📅 Reservar ${win.start}–${win.end}`, cmd: 'coach.block', arg: JSON.stringify({ start: win.start, end: win.end, task: i }) }, { label: 'No', cmd: 'ack' }],
        }), load.overload > 1.15 ? 32000 : 9000);
      }
    }
    return load;
  }
  function reserveBlock(arg) {
    let b;
    try { b = JSON.parse(arg); } catch { return false; }
    const t = tasks()[b.task];
    const blocks = (M.today().blocks || []).slice();
    blocks.push({ start: b.start, end: b.end, title: t ? t.text : 'Lo más difícil', task: Number.isInteger(b.task) ? b.task : undefined });
    M.ex.setBlocks(blocks);
    M.say(`📅 Reservado ${b.start}–${b.end} para «${t ? t.text.slice(0, 50) : 'lo más difícil'}». Te aviso al empezar 🍅`, 'celebrate', 7000, { log: false });
    return true;
  }

  // =====================================================================
  // 🌙 RITUAL DE CIERRE
  // =====================================================================
  const endTime = () => set().endOfDay || (() => { const m = lib.toMin(set().eveningTime || '16:30') + 60; return lib.fromMin(Math.min(m, 23 * 60)); })();
  function ritualTick() {
    if (set().closingRitual === false || !S().pet.name || M.TEST) return;
    const now = new Date();
    if (set().workdaysOnly && (now.getDay() === 0 || now.getDay() === 6)) return;
    const k = lib.keyOf(now);
    const day = M.today();
    if (day.ritual || now.getHours() * 60 + now.getMinutes() < lib.toMin(endTime()) || (day.ritualSnooze || 0) > Date.now()) return;
    if (M.meetingNow) return;
    day.ritual = 'asked';
    M.store.save();
    M.sendPet('pet:pajamas', { on: true });
    M.say('🌙 Ya es hora de cerrar el día. ¿Cierro tus apps de trabajo y te dejo en paz hasta mañana?', 'yawn', 30000, {
      cat: 'routine', actions: [{ label: '🌙 Cerrar y descansar', cmd: 'ritual.close' }, { label: 'Un rato más (30 min)', cmd: 'ritual.snooze' }],
    });
    void k;
  }
  function ritualSnooze() {
    const day = M.today();
    delete day.ritual;
    day.ritualSnooze = Date.now() + 30 * 60e3;
    M.sendPet('pet:pajamas', { on: false });
    M.store.save();
    M.say('⏰ Vale, 30 minutos más. Luego a descansar 😴', 'peck', 5000, { log: false });
  }
  /** Cierra con suavidad (como pulsar la X: cada app pregunta si hay algo sin guardar) y silencia hasta mañana. */
  function ritualClose() {
    const apps = (set().closeApps || []).filter((a) => /^[\w .-]{2,40}$/.test(a));
    if (apps.length && process.platform === 'win32') {
      const list = apps.map((a) => `'${a.replace(/'/g, '')}'`).join(',');
      const cmd = `foreach ($n in @(${list})) { Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object { [void]$_.CloseMainWindow() } }`;
      require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true }, () => {});
    }
    // Silencio hasta tu hora del daily de mañana.
    const t = new Date(); t.setDate(t.getDate() + 1);
    const [h, m] = String(set().morningTime || '08:00').split(':').map(Number);
    t.setHours(h, m || 0, 0, 0);
    M.setMute(Math.round((t.getTime() - Date.now()) / 60e3));
    M.today().ritual = 'closed';
    M.store.save();
    M.say(apps.length ? `🌙 Cerré ${apps.join(', ')}. ¡A descansar! Nos vemos mañana a las ${set().morningTime || '08:00'} 💛` : `🌙 ¡A descansar! No te molesto hasta mañana a las ${set().morningTime || '08:00'} 💛 (en Ajustes → General puedes elegir qué apps cierro)`, 'love', 12000, { log: false });
    return true;
  }
  /** Por la mañana se quita el pijama. */
  function morningTick() {
    const day = M.today();
    if (!day.ritual && !day.pajamasOff && new Date().getHours() >= 5) { day.pajamasOff = true; M.sendPet('pet:pajamas', { on: false }); }
  }

  // =====================================================================
  // 📝 NOTAS DE REUNIÓN → TAREAS
  // =====================================================================
  async function meetingActions(text) {
    text = String(text || '').slice(0, 30000);
    if (text.trim().length < 20) return { ok: false, error: 'Pega la transcripción o las notas de la reunión' };
    const me = [S().settings.myName, S().pet.ownerName].filter(Boolean);
    let items = null;
    let via = 'patrones';
    if (M.aiAvailable()) {
      try {
        const raw = await M.ai.polish(text, `Extrae las acciones concretas acordadas en esta reunión. Responde SOLO con JSON válido: un array de objetos {"text": "acción breve en infinitivo", "owner": "nombre de quien la hace o vacío", "mine": true si es de ${me.length ? me.join(' / ') : 'la persona que pega las notas (habla en primera persona)'}}. Máximo 20. Sin texto fuera del JSON.`);
        const j = JSON.parse(String(raw).replace(/^[^[]*/, '').replace(/[^\]]*$/, ''));
        if (Array.isArray(j)) { items = j.filter((x) => x && x.text).slice(0, 20).map((x) => ({ text: String(x.text).slice(0, 200), owner: String(x.owner || '').slice(0, 40), mine: !!x.mine })); via = 'IA'; }
      } catch { /* sin IA o JSON roto: patrones */ }
    }
    if (!items) items = lib.extractActions(text, me);
    return { ok: true, items, via };
  }
  function addMeetingTasks(list) {
    const items = (list || []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 20);
    for (const t of items) M.addTask(t.slice(0, 200));
    if (items.length) M.say(`📝 Añadí ${items.length} tarea${items.length === 1 ? '' : 's'} de la reunión a tu día.`, 'peck', 6000, { log: false });
    return { ok: true, n: items.length };
  }

  function coachState() {
    return { duck: !!duck, endOfDay: endTime(), closeApps: set().closeApps || [] };
  }
  function start() {
    if (M.TEST) return;
    setInterval(() => { try { ritualTick(); morningTick(); } catch (e) { M.diag.log('main', 'Ritual: ' + e.message); } }, 60e3);
  }

  return { start, onSample, stuckToClaude, duckStart, duckActive, duckReply, reviewPlan, reserveBlock, ritualTick, ritualSnooze, ritualClose, meetingActions, addMeetingTasks, coachState };
};

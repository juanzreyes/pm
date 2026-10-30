// Rutina del pollito según tu horario (src/schedule.js):
//  · 🍳🍽️🌙 desayuna, almuerza y cena contigo (y te lo recuerda);
//  · ☕ pausas cortas dentro de la jornada;
//  · ⏱️ horas extra y nocturnas: si trabajas fuera de la jornada, las cuenta y te avisa;
//  · 🛋️ fines de semana y días libres: no se trabaja; él ve series, YouTube, escucha música,
//    se toma una cerveza o simplemente disfruta el día;
//  · 📅 excepciones dichas en el chat: "trabajaré el domingo de 8 a 12", "el lunes es feriado".
// Parte del proceso principal. `M` es el contexto compartido de la app.
/* eslint-disable no-use-before-define */
const S = require('../schedule');

const LEISURE = [
  { id: 'series', emoji: '📺', lines: ['Maratón de series 📺 Hoy no se trabaja, hoy se ve "un capítulo más".', 'Viendo mi serie 📺🍿 No me cuentes el final.', 'Un capítulo más y ya… 📺 (mentira)'] },
  { id: 'youtube', emoji: '▶️', lines: ['Viendo videos de pollitos en YouTube ▶️ Investigación de mercado.', 'YouTube me recomendó "10 trucos de productividad". Lo veo el lunes ▶️😴'] },
  { id: 'music', emoji: '🎧', lines: ['Música a todo volumen 🎧🎶 Día de descanso.', 'Escuchando mi playlist de domingo 🎧 Nada de reuniones.'] },
  { id: 'beer', emoji: '🍺', lines: ['Una cervecita bien fría 🍺 Me la gané esta semana.', 'Salud 🍺 por una semana bien trabajada.'] },
  { id: 'chill', emoji: '😎', lines: ['Disfrutando el día ☀️😎 Cero pendientes.', 'Tomando el sol ☀️ El backlog puede esperar al lunes.'] },
  { id: 'games', emoji: '🎮', lines: ['Echando unas partidas 🎮 Prometo no hacer speedrun de tus tareas.', 'Modo gamer 🎮 Hoy el único jefe es el del nivel 5.'] },
];
const MEAL_LINES = {
  breakfast: ['🍳 ¡Hora del desayuno! Cafecito y pan dulce antes de arrancar ☕', '🍳 Desayunemos primero: con hambre nadie programa bien.'],
  lunch: ['🍽️ ¡Hora del almuerzo! Despégate de la pantalla un rato, yo te cuido las tareas.', '🍽️ A almorzar 😋 Las tareas no se van a ningún lado.'],
  dinner: ['🌙 Hora de cenar 🫓 ¿Unas pupusitas?', '🌙 Cena tranquila: el trabajo de hoy ya está hecho.'],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

module.exports = function install(M) {
  const set = () => M.store.data.settings;
  const cfg = () => S.config(set(), M.store.data.workExtras || []);
  let lastKey = null;
  let leisure = null; // { id, emoji, until }
  let lastSaidLeisure = 0;

  function phase(now = Date.now()) { return S.phase(now, cfg()); }
  const quiet = () => !M.store.data.pet.name || M.isMuted() || M.meetingNow || M.presenting;
  const awake = (h = new Date().getHours()) => h >= 7 && h < 23;
  /** ¿Estás trabajando ahora mismo? (lo que dice el vigilante de ventanas) */
  const userWorking = () => M.fx && M.fx.cat === 'work' && Date.now() - (M.fx.lastSampleAt || 0) < 60e3;

  // ---------------------------------------------------------------------------
  // Cada 30 s: ¿cambió el momento del día?
  // ---------------------------------------------------------------------------
  function tick() {
    const now = Date.now();
    const p = phase(now);
    const key = p.kind + (p.meal ? ':' + p.meal : '');
    const changed = key !== lastKey;
    const first = lastKey === null;
    lastKey = key;
    if (changed && !first) onEnter(p);
    updateLeisure(p, now);
    if (changed) M.broadcast();
  }

  function onEnter(p) {
    const pet = M.store.data.pet;
    if (p.kind === 'meal') {
      // Él también come: la comida de su horario le llena la panza.
      if (!pet.vacation) {
        pet.fullness = M.clamp((pet.fullness ?? 50) + 35);
        pet.happiness = M.clamp((pet.happiness ?? 50) + 4);
        M.store.save();
      }
      if (!quiet() && set().mealReminders !== false && awake()) M.say(pick(MEAL_LINES[p.meal]), 'eat', 10000, { cat: 'pet' });
      return;
    }
    if (p.kind === 'break') {
      if (!quiet() && set().breakReminders !== false) M.say(`☕ Pausa de ${p.min} min: estírate, toma agua y mira lejos de la pantalla 👀`, 'yawn', 10000, { cat: 'pet' });
      return;
    }
    if (p.kind === 'rest') {
      const d = M.today();
      if (!d.restHello && !quiet() && awake()) {
        d.restHello = true;
        M.store.save();
        const nxt = S.nextShiftStart(Date.now(), cfg());
        const back = nxt ? new Date(nxt).toLocaleDateString('es', { weekday: 'long' }) : '';
        M.say(p.weekend ? `🎉 ¡Es fin de semana! Hoy no se trabaja.${back ? ` Nos vemos el ${back} 💛` : ''}` : `🌴 Hoy es tu día libre. Descansa, que te lo ganaste.${back ? ` Volvemos el ${back}.` : ''}`, 'celebrate', 10000, { cat: 'pet' });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 🛋️ Ocio: fines de semana, días libres y después de la jornada (si no estás trabajando).
  // ---------------------------------------------------------------------------
  function updateLeisure(p, now) {
    const free = (p.kind === 'rest' || (p.kind === 'off' && !p.before)) && awake() && set().leisure !== false && !M.store.data.pet.vacation && !userWorking();
    if (!free) {
      if (leisure) { leisure = null; M.broadcast(); }
      return;
    }
    if (leisure && now < leisure.until) return;
    const prev = leisure && leisure.id;
    const options = LEISURE.filter((x) => x.id !== prev && (x.id !== 'beer' || new Date().getHours() >= 12)); // la cerveza, después del mediodía
    const a = pick(options);
    leisure = { id: a.id, emoji: a.emoji, until: now + (25 + Math.random() * 20) * 60e3 };
    if (!quiet() && set().chatter !== false && now - lastSaidLeisure > 50 * 60e3) {
      lastSaidLeisure = now;
      M.say(pick(a.lines), 'hop', 8000, { cat: 'pet', log: false });
    }
    M.broadcast();
  }

  // ---------------------------------------------------------------------------
  // ⏱️ Horas extra y nocturnas (cada muestra del vigilante en la que trabajas)
  // ---------------------------------------------------------------------------
  function onWorkSample(dt) {
    const now = Date.now();
    const c = cfg();
    const p = S.phase(now, c);
    const day = M.today();
    if (p.kind === 'work' && !p.extra) {
      if (p.night) day.nightWork = (day.nightWork || 0) + dt; // jornada nocturna normal
      return;
    }
    if (p.kind === 'meal' && p.inShift) { day.workedThroughMeal = (day.workedThroughMeal || 0) + dt; return; }
    if (p.kind === 'break') return;
    const ot = day.overtime || (day.overtime = { secs: 0, night: 0, told: 0 });
    ot.secs += dt;
    if (S.isNight(now, c)) ot.night += dt;
    if (p.extra) ot.planned = (ot.planned || 0) + dt;
    // Primer aviso a los 15 min; luego a la 1 h, 2 h, 3 h…
    const next = ot.told ? ot.told * 3600 : 900;
    if (ot.secs >= next) {
      ot.told = (ot.told || 0) + 1;
      if (!quiet()) M.say(overtimeLine(ot, p), p.extra ? 'peck' : 'look', 12000, { cat: 'pet' });
    }
  }
  function overtimeLine(ot, p) {
    const dur = M.brain.fmtDur(ot.secs);
    const night = ot.night >= 300 ? ` (${M.brain.fmtDur(ot.night)} en horario nocturno 🌙)` : '';
    if (p.extra) return `📅 Turno extra en marcha: llevas ${dur}${night}. Te lo anoto como horas extra ⏱️`;
    if (p.kind === 'rest') return `⏱️ Hoy es tu día de descanso y llevas ${dur} trabajando${night}. Lo anoto como horas extra… pero descansa 💛`;
    return `⏱️ Ya terminó tu jornada: llevas ${dur} de horas extra${night}. Las voy anotando.`;
  }

  // ---------------------------------------------------------------------------
  // Chat: "trabajaré el domingo de 8 a 12", "el lunes es feriado"
  // ---------------------------------------------------------------------------
  function fromChat(text) {
    const e = S.parseExtra(text);
    if (!e) return null;
    const c = cfg();
    if (!e.off && !e.start) { e.start = S.fromMin(c.start); e.end = S.fromMin(c.end); }
    M.store.data.workExtras = S.addExtra(M.store.data.workExtras || [], e);
    M.store.save();
    lastKey = null; // recalcula ya
    tick();
    const when = S.dayLabel(e.date);
    const msg = e.off
      ? `🌴 Anotado: ${when} no se trabaja. Ese día no te pido daily ni te regaño 😌`
      : `📅 Anotado: ${when} trabajas de ${e.start} a ${e.end}. Ese día te acompaño en horario de trabajo y lo cuento como horas extra ⏱️`;
    M.broadcast();
    return msg;
  }
  function removeExtra(date, start) {
    M.store.data.workExtras = (M.store.data.workExtras || []).filter((x) => !(x.date === date && (x.start || '') === (start || '')));
    M.store.save();
    lastKey = null;
    tick();
    M.broadcast();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Para el resto de la app
  // ---------------------------------------------------------------------------
  /** Cuánto bajan hambre/ánimo/limpieza en un intervalo: casi nada fuera de la jornada (se cuida solo). */
  function decayMinutes(fromMs, toMs) {
    const total = Math.max(0, toMs - fromMs) / 60000;
    const work = S.workMsBetween(fromMs, toMs, cfg()) / 60000;
    return work + (total - work) * 0.15;
  }
  /** Si estuviste fuera solo en horas libres (el finde, la noche), no hay por qué enojarse. */
  function awayWasFree(awayMs) {
    const now = Date.now();
    return S.workMsBetween(now - awayMs, now, cfg()) < 20 * 60e3;
  }
  function welcomeBack(name, awayMs) {
    const p = phase();
    const dow = new Date().getDay();
    const longAway = awayMs > 36 * 3600e3;
    const h = new Date().getHours();
    const hi = h < 12 ? '¡Buenos días' : h < 19 ? '¡Buenas tardes' : '¡Buenas noches';
    if (p.kind === 'rest') return `${hi}! ☀️ Hoy toca descansar. Yo ya tengo planes 🍿`;
    if (longAway && (dow === 1 || dow === 2)) return `${hi}! ☀️ ¿Qué tal el finde? Yo vi series, escuché música y hasta me tomé una cervecita 🍺 ¡A empezar la semana con todo! 💪`;
    if (longAway) return `${hi}! ☀️ ¿Descansaste? Yo me cuidé solito. ¡Vamos con todo! 💪`;
    return `${hi}! ${name} reportándose 🫡`;
  }
  function todayOvertime() {
    const ot = M.today().overtime;
    return ot ? { secs: Math.round(ot.secs), night: Math.round(ot.night), planned: Math.round(ot.planned || 0) } : null;
  }
  function overtimeSummary() {
    const fmt = (s) => M.brain.fmtDur(s);
    const days = M.store.data.days || {};
    const now = new Date();
    const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    let week = 0;
    let night = 0;
    for (let d = new Date(monday); d <= now; d.setDate(d.getDate() + 1)) {
      const ot = (days[S.keyOf(d)] || {}).overtime;
      if (ot) { week += ot.secs || 0; night += ot.night || 0; }
    }
    const t = todayOvertime();
    const today = t && t.secs >= 60 ? `Hoy: ${fmt(t.secs)} de horas extra${t.night >= 60 ? ` (${fmt(t.night)} nocturnas)` : ''}.` : 'Hoy no has trabajado fuera de tu jornada 👌';
    return week >= 60 ? `⏱️ ${today}
Esta semana: ${fmt(week)}${night >= 60 ? ` (${fmt(night)} nocturnas 🌙)` : ''}.` : `⏱️ ${today}`;
  }
  function snapshot() {
    const c = cfg();
    const p = phase();
    const upcoming = (M.store.data.workExtras || []).filter((x) => x.date >= S.keyOf(new Date())).map((x) => ({ ...x, label: S.dayLabel(x.date) }));
    return {
      phase: p,
      leisure: leisure ? { id: leisure.id, emoji: leisure.emoji } : null,
      overtime: todayOvertime(),
      extras: upcoming,
      workDays: c.days,
      meals: Object.fromEntries(Object.entries(c.meals).map(([k, m]) => [k, { on: m.on, at: S.fromMin(m.at), min: m.min }])),
      breaks: c.breaks.map((b) => ({ at: S.fromMin(b.at), min: b.min })),
    };
  }

  function start() {
    setTimeout(tick, 4000);
    setInterval(() => { try { tick(); } catch (e) { M.diag.log('main', 'Rutina: ' + e.message); } }, 30e3);
  }

  return {
    start, tick, phase, cfg, isWorkTime: (ms = Date.now()) => S.isWorkTime(ms, cfg()), isWorkday: (ms = Date.now()) => S.isWorkday(ms, cfg()),
    shiftsToday: () => S.shiftsOn(Date.now(), cfg()), onWorkSample, overtimeSummary, fromChat, removeExtra, decayMinutes, awayWasFree, welcomeBack, snapshot, todayOvertime,
  };
};

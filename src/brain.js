// Personalidad y respuestas del pollito PM. Todo es local: no gasta tu cuota.

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + ' M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '') + ' k';
  return String(n);
}

function fmtUntil(iso) {
  if (!iso) return 'sin fecha';
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'ya mismo';
  const m = Math.round(ms / 60000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${mm} min`;
  return `${mm} min`;
}

function fmtClock(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const hm = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `hoy a las ${hm}` : d.toLocaleDateString('es', { weekday: 'long' }) + ` a las ${hm}`;
}

function norm(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function session(usage) {
  return usage && usage.limits && usage.limits.find((l) => l.key === 'five_hour');
}
function weekly(usage) {
  return usage && usage.limits && usage.limits.find((l) => l.key === 'seven_day');
}

function usageSummary(usage) {
  if (!usage || !usage.limits || !usage.limits.length) {
    const l = usage && usage.local;
    let s = 'Todavía no estoy conectado a tu cuenta de Claude, así que no veo tus límites 😿.';
    if (l && l.today.messages) {
      s += ` Pero en tus registros locales veo que hoy llevas ${l.today.messages} respuestas y ${fmtTokens(l.today.input + l.today.output)} tokens.`;
    }
    return s + ' Ve a la pestaña ⚙️ para conectarme.';
  }
  const lines = usage.limits.map((l) => `• ${l.label}: ${Math.round(l.utilization)}% (se reinicia en ${fmtUntil(l.resetsAt)})`);
  const s = session(usage);
  let tail = '';
  if (s) {
    if (s.utilization >= 90) tail = '¡Estamos al límite! 🥵 Guarda lo importante para después del reinicio.';
    else if (s.utilization >= 75) tail = 'Vamos bastante cargados, pío. Prioriza lo importante 😬';
    else if (s.utilization >= 50) tail = 'Vamos a mitad de camino, todo bajo control 🐥';
    else tail = '¡Tenemos muchísimo margen! A trabajar 💪';
  }
  return `Así vamos:\n${lines.join('\n')}\n${tail}`;
}

function resetSummary(usage) {
  if (!usage || !usage.limits || !usage.limits.length) {
    return 'No sé cuándo se reinician tus límites porque aún no estoy conectado a tu cuenta 😿. Conéctame en ⚙️.';
  }
  return usage.limits
    .filter((l) => l.resetsAt)
    .map((l) => `• ${l.label}: en ${fmtUntil(l.resetsAt)} (${fmtClock(l.resetsAt)})`)
    .join('\n') || 'No tengo fechas de reinicio ahora mismo.';
}

function localSummary(local, which = 'today') {
  if (!local || !local.available) return 'No encontré registros locales de Claude Code en este equipo.';
  const b = local[which];
  const label = { today: 'Hoy', yesterday: 'Ayer', week: 'Esta semana', last5h: 'En las últimas 5 h' }[which];
  if (!b.messages) return `${label} no veo actividad en Claude Code. 💤`;
  const models = Object.entries(b.models).sort((a, c) => c[1] - a[1]).slice(0, 3)
    .map(([m, t]) => `${m} (${fmtTokens(t)})`).join(', ');
  return `${label}: ${b.messages} respuestas de Claude, ${fmtTokens(b.input)} tokens de entrada, ${fmtTokens(b.output)} de salida y ${fmtTokens(b.cacheRead)} leídos de caché. Modelos: ${models}.`;
}

function fmtDur(secs) {
  const m = Math.round((secs || 0) / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function focusSummary(day) {
  const f = day && day.focus;
  if (!f || !(f.work + f.distraction + f.neutral)) return 'Hoy aún no tengo datos de tu enfoque 👀';
  const top = Object.entries(f.apps || {}).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, v]) => `${k} (${fmtDur(v)})`).join(', ');
  const total = f.work + f.distraction + f.neutral;
  const pct = Math.round((f.work / total) * 100);
  let verdict;
  if (f.distraction >= 3600) verdict = 'Más de una hora perdida… 😤 Esto no le gusta a tu PM.';
  else if (f.distraction >= 1200) verdict = 'Mmm… demasiadas distracciones hoy 🤨';
  else if (pct >= 60) verdict = '¡Día muy enfocado! Estoy orgulloso 🥹';
  else verdict = 'Vamos bien, pero podemos enfocarnos más 💪';
  return `Hoy: 💼 trabajo ${fmtDur(f.work)} · 🙈 distracciones ${fmtDur(f.distraction)} · 🗂️ otros ${fmtDur(f.neutral)} · 💤 inactivo ${fmtDur(f.idle)}${top ? `\nDistracciones: ${top}` : ''}\n${verdict}`;
}

/** Regaño por distracción; sube de tono con cada nivel. */
function scold(label, minutes, level, pendingTask) {
  const task = pendingTask ? ` "${pendingTask}" te está esperando.` : '';
  if (level <= 1) return { text: pick([`Oye… llevas ${minutes} min en ${label} 👀 ¿Eso está en tu lista de tareas?`, `Ejem, ejem… ${minutes} min de ${label} 🤨`]), anim: 'judge' };
  if (level === 2) return { text: `¡${minutes} minutos en ${label}! 😠${task} ¡A trabajar!`, anim: 'angry' };
  return { text: pick([`¡¿${minutes} MINUTOS en ${label}?! 😤💢 Soy un pollito PM muy decepcionado.`, `Voy a anotar esto en tu evaluación de desempeño 📋😤 ${minutes} min de ${label}.`, `¡Cierra ${label} YA! 💢 ${minutes} minutos… ¡minutos!`]) + task, anim: 'angry' };
}

function backToWork() {
  return pick(['¡Eso! De vuelta al trabajo 💪', '¡Así me gusta! Enfocado 🐣✨', 'Bien… te estoy vigilando 👀💛']);
}

/** Saludo al volver a abrir la app, según cómo lo cerraron. */
function returnGreeting({ name, how, awayMs, crashes, closes, pending }) {
  const away = fmtDur(awayMs / 1000);
  const extra = pending ? `\nPor cierto, tenías pendiente: "${pending}" 📌` : '';
  if (how === 'update') {
    return { text: `¡Pío! Me actualizaron ✨ Tengo cosas nuevas: escribe "ayuda" para verlas.${extra}`, anim: 'celebrate', angry: false };
  }
  if (how === 'shutdown') {
    return { text: `¡Pío! Apagaste el PC, así que te perdono 😴 Estuve dormido ${away}.${extra}`, anim: 'hop', angry: false };
  }
  if (how === 'killed') {
    return { text: `¡¿ME CERRASTE DE GOLPE?! 😡💢 Estuve apagado ${away}. ¡Ni un adiós! ${crashes > 1 ? `Y ya van ${crashes} veces…` : ''}${extra}`, anim: 'angry', angry: true };
  }
  const lines = [
    `¡Hmph! 😤 Me cerraste hace ${away}. ¿Tan mal PM soy?`,
    `¡Por fin vuelves! 😠 Me dejaste solito ${away}.`,
    `${name} está ENOJADO 💢 Me cerraste hace ${away}… acaríciame si quieres que te perdone.`,
  ];
  let t = pick(lines);
  if (closes >= 3) t += ` Ya me has cerrado ${closes} veces 😒`;
  return { text: t + extra, anim: 'angry', angry: true };
}

function hm(ms) {
  return new Date(ms).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

function mailSummary(m) {
  if (!m || !m.configured) return 'Aún no me conectaste tu correo 📭 Ve a la pestaña 📬 Agenda para hacerlo.';
  if (m.status === 'error') return `No pude revisar tu correo 😿 ${m.error || ''}`;
  if (m.status !== 'ok') return 'Estoy revisando tu correo… 📬';
  if (!m.unseen) return '¡Bandeja limpia! No tienes correos sin leer 🧹✨';
  const list = (m.recent || []).slice(0, 4).map((x) => `• ${x.from}: ${x.subject}`).join('\n');
  return `Tienes ${m.unseen} correo${m.unseen === 1 ? '' : 's'} sin leer 📧\n${list}`;
}

function agendaSummary(c, now) {
  if (now) return `Ahora mismo estás en ${now.title ? `"${now.title}"` : 'una reunión'} (${now.app}) 🎧`;
  if (!c || !c.configured) return 'Aún no me conectaste tu calendario 📅 Ve a la pestaña 📬 Agenda y pega el enlace ICS de tu calendario (Outlook o Google).';
  if (c.status === 'error') return `No pude leer tu calendario 😿 ${c.error || ''}`;
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const today = (c.events || []).filter((e) => !e.allDay && e.end > Date.now() && e.start <= end.getTime());
  if (!today.length) return '¡No te quedan reuniones hoy! Tiempo para trabajar enfocado 💪';
  const list = today.map((e) => `• ${hm(e.start)} ${e.title}${e.join ? ` (${e.join.platform})` : ''}`).join('\n');
  const next = today[0];
  const mins = Math.round((next.start - Date.now()) / 60000);
  const when = mins > 0 ? `La próxima empieza en ${fmtUntil(new Date(next.start).toISOString())}.` : 'Una está en curso ahora.';
  return `Te quedan ${today.length} reunion${today.length === 1 ? '' : 'es'} hoy 📅\n${list}\n${when}`;
}

function tasksSummary(day) {
  const tasks = day && day.standup && day.standup.today;
  if (!tasks || !tasks.length) return 'Hoy no me has contado tus tareas. ¿Hacemos el daily? 📋';
  const done = tasks.filter((t) => t.done).length;
  const list = tasks.map((t) => `${t.done ? '✅' : '⬜'} ${t.text}`).join('\n');
  return `Tus tareas de hoy (${done}/${tasks.length}):\n${list}`;
}

const JOKES = [
  '¿Por qué el pollito no usa Excel? Porque prefiere las hojas de cálculo… ¡de lechuga! 🥬',
  '¿Qué hace un pollito en un sprint? ¡Pío-rizar tareas! 🐣',
  'Mi metodología favorita es Scrum… ¡pero sin el crum de las galletas que me como! 🍪',
  '¿Sabes por qué nunca pierdo un deadline? Porque siempre estoy al pío de la letra 📅',
];

/**
 * Responde a un mensaje del chat.
 * @returns {{text: string, action?: string, anim?: string}}
 */
function reply(msg, ctx) {
  let q = norm(msg);
  // Palabras en inglés → palabras clave en español (el chat local entiende ambos idiomas).
  const EN = [
    [/\bremind me\b/, 'recuerdame'], [/\bstop (the )?pomodoro\b/, 'detener pomodoro'], [/\bunmute\b/, 'quita el silencio'],
    [/\bit'?s work\b|\bthis is work\b/, 'es trabajo'], [/\bhow much\b|\busage\b|\blimits?\b|\bused\b/, 'uso'],
    [/\bresets?\b/, 'reinicio'], [/\btasks?\b|\bto-?dos?\b/, 'tareas'], [/\bhelp\b/, 'ayuda'], [/\breport\b/, 'informe'],
    [/\bemails?\b|\binbox\b|\bmail\b/, 'correo'], [/\bmeetings?\b|\bcalendar\b|\bschedule\b/, 'reuniones'],
    [/^(hello|hi|hey)\b/, 'hola'], [/\bthanks?\b|\bthank you\b/, 'gracias'], [/\blevel\b/, 'nivel'],
    [/\bfeed\b|\bfood\b|\bhungry\b|\bcorn\b/, 'comida'], [/\bjoke\b/, 'chiste'], [/\bproductivity\b|\bdistractions?\b/, 'productividad'],
    [/\bsorry\b/, 'perdon'], [/\bmute\b|\bbe quiet\b|\bshut up\b/, 'silencio'], [/\bweek(ly)?\b/, 'semana'], [/\byesterday\b/, 'ayer'],
    [/\bcopy daily\b/, 'copiar daily'], [/\bwrap.?up\b/, 'cierre'], [/\bi love you\b|\bcute\b/, 'te quiero'], [/\bhow are you\b/, 'como estas'],
    [/\bwhat'?s your name\b|\bwho are you\b/, 'como te llamas'], [/\bfocus\b/, 'pomodoro'],
  ];
  for (const [re, es] of EN) q = q.replace(re, es);
  const { name, usage, day, pet } = ctx;
  const has = (...words) => words.some((w) => q.includes(w));

  if (/^\s*(recuerdame|recordarme|avisame|recordatorio)\b/.test(q)) {
    return { text: '⏰', action: 'remind' };
  }
  if (has('para el pomodoro', 'deten el pomodoro', 'detener pomodoro', 'parar pomodoro', 'stop pomodoro', 'cancela el pomodoro')) {
    return { text: 'Vale, detengo el pomodoro ⏹️', action: 'pomo-stop' };
  }
  if (has('pomodoro', 'concentrarme', 'modo foco', 'focus')) {
    return { text: '¡Vamos! 🍅 25 minutos de concentración total. Yo vigilo 👀', action: 'pomo-start', anim: 'hop' };
  }
  if (has('informe', 'reporte', 'resumen semanal', 'resumen de la semana')) {
    return { text: 'Aquí tienes tu informe semanal 📊 Puedes copiarlo y enviarlo.', action: 'report', anim: 'peck' };
  }
  if (has('copiar daily', 'copia el daily', 'daily para', 'daily en texto', 'exportar daily')) {
    return { text: 'Te dejo el daily listo para pegar en Slack o Teams 📋', action: 'daily-copy', anim: 'peck' };
  }
  if (has('daily', 'standup', 'stand up', 'plan del dia', 'planear')) {
    return { text: '¡Vamos con el daily! 📋', action: 'standup', anim: 'hop' };
  }
  if (has('cierre', 'cumpli', 'revision', 'fin del dia', 'terminar el dia')) {
    return { text: 'Hagamos el cierre del día 🌇', action: 'review', anim: 'hop' };
  }
  if (has('reinicia', 'reinicio', 'reset', 'resetea', 'cuando se', 'cuanto falta', 'renueva')) {
    return { text: resetSummary(usage), anim: 'peck' };
  }
  if (has('semana', 'semanal')) {
    const w = weekly(usage);
    if (w) return { text: `Esta semana llevas ${Math.round(w.utilization)}% de tu límite semanal. Se reinicia en ${fmtUntil(w.resetsAt)} (${fmtClock(w.resetsAt)}).\n\n${localSummary(usage && usage.local, 'week')}` };
    return { text: localSummary(usage && usage.local, 'week') };
  }
  if (has('ayer')) return { text: localSummary(usage && usage.local, 'yesterday') };
  if (has('token', 'mensaje', 'modelo', 'hoy he', 'estadistica')) {
    return { text: localSummary(usage && usage.local, 'today') };
  }
  if (has('uso', 'consum', 'gast', 'cuanto llevo', 'limite', 'cuota', 'como voy', 'como vamos', 'porcentaje', 'stats')) {
    return { text: usageSummary(usage), anim: 'peck' };
  }
  if (has('es trabajo', 'es del trabajo', 'es para el trabajo', 'estoy aprendiendo', 'es un tutorial', 'es un curso', 'dejame', 'no me regañes', 'no me reganes')) {
    return { text: 'Hmm… 🤨', action: 'allow', anim: 'judge' };
  }
  if (has('quita el silencio', 'ya puedes hablar', 'desmutea', 'habla de nuevo')) {
    return { text: '¡Volví! 🐣 Pío pío', action: 'unmute', anim: 'hop' };
  }
  if (has('silencio', 'callate', 'no molestes', 'estoy en reunion', 'estoy en una reunion', 'shh')) {
    return { text: 'Shhh 🤫 Me quedo calladito 1 hora (salvo avisos importantes de tus límites).', action: 'mute', anim: 'peck' };
  }
  if (has('correo', 'email', 'e-mail', 'mail', 'bandeja', 'mensajes nuevos')) {
    return { text: mailSummary(ctx.mail), anim: 'peck' };
  }
  if (has('reunion', 'agenda', 'calendario', 'meeting', 'teams', 'junta', 'cita')) {
    return { text: agendaSummary(ctx.calendar, ctx.meetingNow), anim: 'peck' };
  }
  if (has('nivel', 'experiencia', 'xp', 'level')) {
    const l = ctx.level || { level: 1, title: 'Pollito becario', into: 0, next: 100 };
    return { text: `Soy nivel ${l.level}: ${l.title} 🐣\nLlevo ${l.into}/${l.next} XP para el siguiente nivel.\nGano XP cuando completas tareas (+10), haces el daily (+15) y el cierre (+15), por cada hora enfocada (+10) y con mimos y comida 💛` };
  }
  if (has('productiv', 'youtube', 'distrac', 'perdi el tiempo', 'enfoque', 'concentr', 'tiempo perdido', 'redes')) {
    return { text: focusSummary(day), anim: 'peck' };
  }
  if (has('perdon', 'lo siento', 'disculpa', 'no te enojes', 'no te vuelvo a cerrar')) {
    return { text: pick(['Hmph… 😤 bueno… te perdono 💛', '*te mira de reojo*… está bien, perdonado 🥺💛']), action: 'forgive', anim: 'love' };
  }
  if (has('tarea', 'pendiente', 'que tengo', 'que hago', 'to do', 'todo')) {
    return { text: tasksSummary(day) };
  }
  if (has('comida', 'come', 'hambre', 'maiz', 'semilla', 'aliment')) {
    return { text: '¡Ñam ñam! 🌽', action: 'feed' };
  }
  if (has('te quiero', 'lindo', 'bonito', 'cute', 'precioso', 'guapo', 'caricia', 'mimo')) {
    return { text: pick(['¡Awww! Yo también te quiero 💛', '¡Pío pío! Me sonrojas 🥹', '*se esponja de felicidad* 💛']), action: 'pet', anim: 'love' };
  }
  if (has('chiste', 'broma', 'gracioso')) return { text: pick(JOKES), anim: 'dance' };
  if (has('como estas', 'que tal', 'como te sientes')) {
    const mood = pet.fullness < 30 ? 'Tengo un poquito de hambre 🥺🌽' : pet.happiness > 70 ? '¡Súper feliz y listo para trabajar! ✨' : 'Bien, pero un mimo no me vendría mal 🐥';
    const s = session(usage);
    return { text: mood + (s ? ` Y tu sesión va al ${Math.round(s.utilization)}%.` : '') };
  }
  if (has('nombre', 'como te llamas', 'quien eres')) {
    return { text: `Soy ${name}, tu pollito Project Manager 🐣📋. Vigilo tus límites de Claude y te ayudo a organizar tu día.` };
  }
  if (has('hola', 'buenas', 'hey', 'holi', 'buenos dias', 'buenas tardes')) {
    return { text: pick([`¡Hola! Soy ${name} 🐣 ¿Qué necesitas?`, '¡Pío pío! ¿En qué te ayudo hoy?', '¡Holaaa! 💛 ¿Revisamos cómo vas?']), anim: 'flap' };
  }
  if (has('gracias', 'genial', 'perfecto', 'excelente')) {
    return { text: pick(['¡Para eso estoy! 🐥', '¡De nada! Pío 💛', '¡Somos un gran equipo! 🙌']), anim: 'dance' };
  }
  if (has('ayuda', 'que puedes', 'que sabes', 'comandos')) {
    return {
      text: 'Puedo ayudarte con:\n• "¿Cuánto llevo?" → tus límites de Claude\n• "¿Cuándo se reinicia?" → tiempo al reinicio\n• "Tokens de hoy" / "semana" / "ayer" → estadísticas\n• "Mis tareas" → tareas del día\n• "Productividad" → cuánto trabajaste y cuánto perdiste 👀\n• "Es trabajo" → si te regaño por algo que sí es trabajo\n• "Silencio" → me callo 1 h (reuniones) 🤫\n• "Nivel" → mi nivel y XP\n• "Correos" → correos sin leer 📧\n• "Pomodoro" → 25 min de concentración 🍅\n• "Recuérdame a las 3 …" / "en 20 min …" ⏰\n• "Informe" → resumen semanal · "Copiar daily" 📊\n• Ctrl+Alt+P desde cualquier app → anotar rápido ✍️\n• "Reuniones" / "Agenda" → tus reuniones de hoy 📅\n• "Daily" / "Cierre" → planear o cerrar el día\n• "Come" 🌽, "Te quiero" 💛, "Chiste" 😄',
    };
  }
  return {
    text: pick([
      'Pío… no entendí del todo 🐣 Prueba con "¿cuánto llevo?", "mis tareas" o "ayuda".',
      'Soy un pollito sencillo 🥺 Pregúntame por tu uso de Claude, tus tareas o el reinicio.',
    ]),
  };
}

/** Mensaje para un aviso de umbral de consumo. */
function thresholdMessage(limit, threshold) {
  const pct = Math.round(limit.utilization);
  const until = fmtUntil(limit.resetsAt);
  const where = limit.key === 'five_hour' ? 'de tu sesión' : `del límite ${limit.label.toLowerCase()}`;
  if (threshold >= 100) return { text: `¡Llegamos al 100% ${where}! 😵 Se reinicia en ${until}. Hora de un descanso.`, anim: 'faint' };
  if (threshold >= 90) return { text: `¡Alerta! Llevas ${pct}% ${where} 🥵 Quedan pocas balas. Reinicio en ${until}.`, anim: 'alarm' };
  if (threshold >= 75) return { text: `Uff, ${pct}% ${where} 😬 Vamos con calma. Reinicio en ${until}.`, anim: 'alert' };
  if (threshold >= 50) return { text: `Vamos por la mitad: ${pct}% ${where} 🐥`, anim: 'peck' };
  return { text: `Llevas ${pct}% ${where}. ¡Buen ritmo! 💪`, anim: 'flap' };
}

function idleChatter(ctx) {
  const { usage, day, pet, name } = ctx;
  const opts = [];
  const s = session(usage);
  if (s) opts.push(`Tu sesión va al ${Math.round(s.utilization)}% 📊`);
  const tasks = day && day.standup && day.standup.today;
  if (tasks && tasks.length) {
    const pending = tasks.filter((t) => !t.done);
    if (pending.length) opts.push(`¿Cómo va "${pick(pending).text}"? 🧐`);
    else opts.push('¡Terminaste todas tus tareas de hoy! 🎉');
  }
  if (pet.fullness < 35) opts.push('Tengo hambre… ¿me das maicito? 🥺🌽');
  opts.push('¡Recuerda tomar agua! 💧', 'Estira un poquito la espalda 🧘', `${name} vigilando todo 👀`, 'Pío pío 🎵', '¡Tú puedes con todo hoy! ✨');
  return pick(opts);
}

module.exports = {
  reply, thresholdMessage, idleChatter, fmtUntil, fmtClock, fmtTokens, fmtDur, usageSummary,
  focusSummary, scold, backToWork, returnGreeting,
};

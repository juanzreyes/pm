// Tu horario: días laborales, jornada (también nocturna, que cruza la medianoche), comidas,
// pausas, horas extra y excepciones ("trabajaré el domingo de 8 a 12", "el lunes es feriado").
// Es la única fuente de verdad de "¿es hora de trabajar?": el pollito, los regaños por
// distracción, el daily y el cierre la consultan. Lógica pura (sin Electron), con tests.

const DAY = 864e5;
const MEALS = ['breakfast', 'lunch', 'dinner'];
const MEAL_NAMES = { breakfast: 'desayuno', lunch: 'almuerzo', dinner: 'cena' };
const DEFAULT_MEALS = {
  breakfast: { on: true, at: '07:00', min: 30 },
  lunch: { on: true, at: '12:00', min: 60 },
  dinner: { on: true, at: '19:00', min: 45 },
};
const DEFAULT_BREAKS = [{ at: '10:00', min: 15 }, { at: '15:00', min: 15 }];
// Jornada nocturna según el Código de Trabajo de El Salvador (art. 161): de 19:00 a 06:00.
const DEFAULT_NIGHT = { from: '19:00', to: '06:00' };

function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v < 24 * 60 ? v : null;
}
function fromMin(m) {
  m = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const midnight = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d; };
const at = (date, min) => { const d = new Date(date); d.setHours(0, 0, 0, 0); d.setMinutes(min); return d.getTime(); };

/**
 * Normaliza los ajustes en un horario.
 * @param {any} settings  store.data.settings
 * @param {any[]} [extras] store.data.workExtras: [{ date:'AAAA-MM-DD', start, end, note } | { date, off:true }]
 */
function config(settings = {}, extras = []) {
  // Por defecto de lunes a viernes: el fin de semana no se trabaja (salvo que lo digas).
  const valid = Array.isArray(settings.workDays) ? settings.workDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  const days = valid.length ? [...new Set(valid)] : [1, 2, 3, 4, 5];
  const meals = {};
  for (const k of MEALS) {
    const m = { ...DEFAULT_MEALS[k], ...((settings.meals || {})[k] || {}) };
    meals[k] = { on: m.on !== false, at: toMin(m.at) ?? toMin(DEFAULT_MEALS[k].at), min: Math.max(5, Math.min(180, Number(m.min) || DEFAULT_MEALS[k].min)) };
  }
  const breaks = (Array.isArray(settings.breaks) ? settings.breaks : DEFAULT_BREAKS)
    .map((b) => ({ at: toMin(b.at), min: Math.max(5, Math.min(60, Number(b.min) || 15)) }))
    .filter((b) => b.at !== null);
  const night = { ...DEFAULT_NIGHT, ...(settings.night || {}) };
  return {
    days,
    start: toMin(settings.morningTime) ?? 8 * 60,
    end: toMin(settings.eveningTime) ?? 16 * 60 + 30,
    meals,
    breaks,
    nightFrom: toMin(night.from) ?? 19 * 60,
    nightTo: toMin(night.to) ?? 6 * 60,
    extras: (extras || []).filter((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date)),
  };
}

/** Un tramo [from, to) en ms. Si termina antes de empezar, cruza la medianoche. */
function span(date, startMin, endMin, extra, note) {
  const from = at(date, startMin);
  let to = at(date, endMin);
  if (to <= from) to += DAY;
  return { from, to, extra: !!extra, note: note || '' };
}

/** Turnos que EMPIEZAN ese día: la jornada normal (si es laboral y no es libre) + los extra. */
function shiftsOn(ms, cfg) {
  const d = midnight(ms);
  const k = keyOf(d);
  const ex = cfg.extras.filter((e) => e.date === k);
  const off = ex.some((e) => e.off);
  const out = [];
  if (cfg.days.includes(d.getDay()) && !off) out.push(span(d, cfg.start, cfg.end, false));
  for (const e of ex) {
    const s = toMin(e.start);
    const t = toMin(e.end);
    if (!e.off && s !== null && t !== null && s !== t) out.push(span(d, s, t, true, e.note));
  }
  return out;
}
/** ¿Ese día se trabaja (jornada normal o extra)? */
const isWorkday = (ms, cfg) => shiftsOn(ms, cfg).length > 0;
/** ¿Ese día tiene jornada NORMAL? (un domingo con turno extra sigue siendo tu día libre) */
const isRegularDay = (ms, cfg) => shiftsOn(ms, cfg).some((s) => !s.extra);

function currentShift(ms, cfg) {
  return [...shiftsOn(ms - DAY, cfg), ...shiftsOn(ms, cfg)].find((s) => ms >= s.from && ms < s.to) || null;
}

function isNight(ms, cfg) {
  const d = new Date(ms);
  const m = d.getHours() * 60 + d.getMinutes();
  return cfg.nightFrom > cfg.nightTo ? m >= cfg.nightFrom || m < cfg.nightTo : m >= cfg.nightFrom && m < cfg.nightTo;
}

/**
 * ¿En qué momento del día estás?
 * kind: 'meal' (desayuno/almuerzo/cena, cualquier día) · 'break' (pausa dentro de la jornada) ·
 *       'work' · 'off' (día laboral, fuera de la jornada) · 'rest' (fin de semana o día libre).
 */
function phase(ms, cfg) {
  const shift = currentShift(ms, cfg);
  const d = midnight(ms);
  for (const k of MEALS) {
    const m = cfg.meals[k];
    if (!m.on) continue;
    const from = at(d, m.at);
    if (ms >= from && ms < from + m.min * 60e3) return { kind: 'meal', meal: k, label: MEAL_NAMES[k], until: from + m.min * 60e3, inShift: !!shift };
  }
  if (shift) {
    if (!shift.extra) {
      for (const b of cfg.breaks) {
        const from = at(d, b.at);
        if (from >= shift.from && from < shift.to && ms >= from && ms < from + b.min * 60e3) return { kind: 'break', until: from + b.min * 60e3, min: b.min };
      }
    }
    return { kind: 'work', until: shift.to, extra: shift.extra, note: shift.note, night: isNight(ms, cfg) };
  }
  if (!isRegularDay(ms, cfg)) {
    const dow = new Date(ms).getDay();
    return { kind: 'rest', weekend: dow === 0 || dow === 6 };
  }
  const today = shiftsOn(ms, cfg).find((s) => !s.extra);
  return { kind: 'off', before: !!today && ms < today.from, night: isNight(ms, cfg) };
}

/** ¿Es hora de trabajar? (dentro de la jornada y sin estar comiendo ni en pausa) */
const isWorkTime = (ms, cfg) => phase(ms, cfg).kind === 'work';

/** Milisegundos de jornada (normal o extra) entre dos instantes. Sirve para no enojarse por un finde. */
function workMsBetween(a, b, cfg) {
  if (!(b > a)) return 0;
  let total = 0;
  for (let t = midnight(a).getTime() - DAY; t <= b; t += DAY) {
    for (const s of shiftsOn(t + 12 * 3600e3, cfg)) total += Math.max(0, Math.min(b, s.to) - Math.max(a, s.from));
  }
  return total;
}

/** Próximo inicio de jornada (para "vuelvo el lunes a las 8"). */
function nextShiftStart(ms, cfg) {
  for (let i = 0; i < 15; i++) {
    const s = shiftsOn(ms + i * DAY, cfg).filter((x) => x.from > ms).sort((x, y) => x.from - y.from)[0];
    if (s) return s.from;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lenguaje natural: "trabajaré el domingo de 8 a 12 de la tarde", "mañana trabajo de 2 a 6",
// "el sábado me toca de 9 a 1", "el lunes es feriado", "no trabajo el viernes".
// ---------------------------------------------------------------------------
const WEEKDAYS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const MONTHS = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function parseDay(q, now) {
  const today = midnight(now);
  const plus = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };
  if (/\bpasado manana\b/.test(q)) return plus(2);
  // "mañana" como día, no "a las 8 de la mañana".
  if (/\bmanana\b/.test(q.replace(/\b(de|del|por|en) la manana\b/g, ''))) return plus(1);
  if (/\bhoy\b/.test(q)) return plus(0);
  const dm = /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/.exec(q);
  if (dm) {
    const d = new Date(today.getFullYear(), MONTHS[dm[2]], Number(dm[1]));
    if (d < today) d.setFullYear(d.getFullYear() + 1);
    return d;
  }
  const wd = /\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/.exec(q);
  if (wd) return plus((WEEKDAYS[wd[1]] - today.getDay() + 7) % 7);
  return null;
}

/** Hora con su "de la mañana/tarde/noche", "pm", "mediodía"… → minutos. explicit: si traía sufijo. */
function hourOf(h, m, suf) {
  let hh = Number(h);
  const mm = Number(m || 0);
  if (hh > 23 || mm > 59) return null;
  let explicit = false;
  if (suf) {
    explicit = true;
    if (/p\.?\s?m|tarde|noche/.test(suf)) { if (hh < 12) hh += 12; } else if (/a\.?\s?m|manana|madrugada/.test(suf)) { if (hh === 12) hh = 0; } else if (/mediodia/.test(suf)) hh = 12;
  }
  return { min: hh * 60 + mm, explicit, h: Number(h) };
}

function parseHours(q) {
  const SUF = '(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?|(?:de|del|en|por) la (?:manana|tarde|noche|madrugada)|del mediodia|de la madrugada)';
  const re = new RegExp(`(?:de|desde)\\s+(?:las?\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*${SUF}?\\s+(?:a|hasta)\\s+(?:las?\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*${SUF}?`);
  const m = re.exec(q);
  if (!m) return null;
  const s = hourOf(m[1], m[2], m[3]);
  const e = hourOf(m[4], m[5], m[6]);
  if (!s || !e) return null;
  // "de 2 a 6 de la tarde": el sufijo del final vale para los dos si encaja.
  if (!s.explicit && e.explicit && e.min >= 12 * 60 && s.min + 12 * 60 < e.min && s.h < 12) s.min += 12 * 60;
  // "de 8 a 5": sin sufijos, si el final queda antes, es de la tarde.
  if (!e.explicit && e.min <= s.min && e.h < 12) e.min += 12 * 60;
  return { start: fromMin(s.min), end: fromMin(e.min % 1440) };
}

/**
 * Entiende un mensaje sobre tu horario. Devuelve null si no habla de eso.
 * @returns {null | { date: string, start?: string, end?: string, off?: boolean }}
 */
function parseExtra(text, now = Date.now()) {
  const q = norm(text);
  const offIntent = /\b(no (voy a |vengo a )?trabaj\w*|no laboro|tengo libre|me dieron libre|dia libre|es feriado|feriado|asueto|libre el|libre)\b/.test(q);
  const workIntent = !offIntent && /\b(trabaj\w*|laborar\w*|laboro|me toca|turno|jornada|horas? extra)\b/.test(q);
  if (!offIntent && !workIntent) return null;
  const day = parseDay(q, now);
  if (!day) return null;
  const date = keyOf(day);
  if (offIntent) return { date, off: true };
  const h = parseHours(q);
  return h ? { date, ...h } : { date };
}

/** Añade (o reemplaza) una excepción y descarta las viejas (más de 7 días). */
function addExtra(extras, e, now = Date.now()) {
  const old = keyOf(new Date(now - 7 * DAY));
  const list = (extras || []).filter((x) => x.date >= old && !(x.date === e.date && !!x.off === !!e.off && (x.off || x.start === e.start)));
  // Un "libre" anula los turnos extra de ese día y viceversa.
  const clean = list.filter((x) => x.date !== e.date || (e.off ? false : !x.off));
  clean.push(e);
  return clean.sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
}

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
/** "el domingo 2" / "hoy" / "mañana" */
function dayLabel(dateKey, now = Date.now()) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const diff = Math.round((dt.getTime() - midnight(now).getTime()) / DAY);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'mañana';
  return `el ${DAY_NAMES[dt.getDay()]} ${d}`;
}

module.exports = {
  DEFAULT_MEALS, DEFAULT_BREAKS, DEFAULT_NIGHT, MEAL_NAMES,
  config, phase, shiftsOn, isWorkday, isRegularDay, isWorkTime, isNight, workMsBetween, nextShiftStart,
  parseExtra, addExtra, dayLabel, toMin, fromMin, keyOf,
};

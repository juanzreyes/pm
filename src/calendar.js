// Calendario desde un enlace ICS publicado (Outlook / Microsoft 365 / Google Calendar).
// Así el pollito sabe cuándo tienes reunión de Teams, Meet o Zoom, sin pedirte contraseñas.
/** @type {any} */
const ICAL = require('ical.js'); // build CommonJS: las clases van en la raíz

const JOIN_PATTERNS = [
  ['Teams', /https:\/\/teams\.(?:microsoft|live)\.com\/(?:l\/meetup-join|meet)\/[^\s"'<>)\\]+/i],
  ['Meet', /https:\/\/meet\.google\.com\/[a-z0-9-]+/i],
  ['Zoom', /https:\/\/[\w.-]*zoom\.us\/(?:j|my)\/[^\s"'<>)\\]+/i],
  ['Webex', /https:\/\/[\w.-]*webex\.com\/[^\s"'<>)\\]+/i],
];

function findJoin(...texts) {
  const all = texts.filter(Boolean).join('\n');
  for (const [platform, re] of JOIN_PATTERNS) {
    const m = all.match(re);
    if (m) return { platform, url: m[0].replace(/[.,;]+$/, '') };
  }
  if (/microsoft teams/i.test(all)) return { platform: 'Teams', url: null };
  return null;
}

async function fetchIcs(url) {
  url = String(url || '').trim().replace(/^webcals?:\/\//i, 'https://');
  if (!/^https:\/\//i.test(url)) throw new Error('El enlace debe empezar por https:// o webcal://');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'pm-pollito/1.0' } });
    if (!res.ok) throw new Error(`El calendario respondió ${res.status}`);
    const text = await res.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Ese enlace no parece un calendario ICS.');
    return text;
  } finally {
    clearTimeout(t);
  }
}

/** Devuelve los eventos entre fromMs y toMs, con las repeticiones ya expandidas. */
function parseEvents(text, fromMs, toMs) {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try {
      const id = tz.getFirstPropertyValue('tzid');
      if (id && !ICAL.TimezoneService.has(id)) ICAL.TimezoneService.register(tz);
    } catch { /* zona rara: se usará la hora local */ }
  }

  // Agrupa por UID: evento principal + excepciones (repeticiones movidas).
  const groups = new Map();
  for (const ve of root.getAllSubcomponents('vevent')) {
    const uid = ve.getFirstPropertyValue('uid') || Math.random().toString(36);
    if (!groups.has(uid)) groups.set(uid, { master: null, exceptions: [] });
    const g = groups.get(uid);
    if (ve.hasProperty('recurrence-id')) g.exceptions.push(ve);
    else g.master = ve;
  }

  const out = [];
  const push = (uid, item, start, end, fallbackJoin) => {
    const s = start.toJSDate().getTime();
    const e = end ? end.toJSDate().getTime() : s + 30 * 60000;
    if (e < fromMs || s > toMs) return;
    const comp = item.component;
    const status = String(comp.getFirstPropertyValue('status') || '').toUpperCase();
    const title = item.summary || '(sin título)';
    if (status === 'CANCELLED' || /^(cancel(ed|led|ado|ada)|cancelado)[:\s]/i.test(title)) return;
    out.push({
      id: `${uid}|${s}`,
      title,
      start: s,
      end: e,
      allDay: start.isDate,
      location: item.location || '',
      join: findJoin(item.location, item.description, comp.getFirstPropertyValue('url'), comp.getFirstPropertyValue('x-microsoft-skypeteamsmeetingurl')) || fallbackJoin || null,
    });
  };

  for (const [uid, g] of groups) {
    const base = g.master || g.exceptions[0];
    if (!base) continue;
    let ev;
    try {
      ev = new ICAL.Event(base, { exceptions: g.master ? g.exceptions : [] });
    } catch {
      continue;
    }
    const masterJoin = findJoin(ev.location, ev.description);
    if (g.master && ev.isRecurring()) {
      try {
        const it = ev.iterator();
        let next;
        let guard = 0;
        while ((next = it.next()) && guard++ < 2000) {
          const ms = next.toJSDate().getTime();
          if (ms > toMs) break;
          if (ms < fromMs - 864e5) continue;
          const d = ev.getOccurrenceDetails(next);
          push(uid, d.item, d.startDate, d.endDate, masterJoin);
        }
      } catch { /* regla de repetición que no entiendo */ }
    } else {
      push(uid, ev, ev.startDate, ev.endDate);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

async function load(url, fromMs, toMs) {
  return parseEvents(await fetchIcs(url), fromMs, toMs);
}

module.exports = { load, parseEvents, findJoin };

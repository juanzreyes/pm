// Recordatorios en lenguaje natural:
//   "recuérdame a las 3 revisar el informe"
//   "recuérdame en 20 min llamar a Ana"
//   "recuérdame mañana a las 9:30 la demo"
//   "avísame a las 15:45 que salga"
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const PREFIX = /^\s*(recuerdame|recordarme|recordatorio|avisame|alarma|remind me)\s*:?\s*/;

/** Devuelve { at, text } o null si no es un recordatorio con hora. */
function parse(input, now = new Date()) {
  const raw = String(input || '').trim();
  const n = norm(raw);
  const m0 = n.match(PREFIX);
  if (!m0) return null;
  // Trabajamos con índices sobre la versión normalizada (misma longitud que el original salvo tildes combinadas).
  let rest = raw.slice(m0[0].length);
  let r = norm(rest);
  let at = null;

  const cut = (match) => {
    const i = r.indexOf(match);
    rest = (rest.slice(0, i) + ' ' + rest.slice(i + match.length)).trim();
    r = norm(rest);
  };

  // "en 20 min", "en 2 horas", "en media hora"
  let m = r.match(/\b(?:en|in)\s+(\d+|media|una|un|half an|an|a)\s*(minutos?|minutes?|mins?|m|horas?|hours?|hrs?|h)\b/);
  if (m) {
    let q = m[1] === 'media' || m[1] === 'half an' ? 0.5 : ['una', 'un', 'an', 'a'].includes(m[1]) ? 1 : Number(m[1]);
    const hours = /^h/.test(m[2]);
    at = new Date(now.getTime() + q * (hours ? 3600e3 : 60e3));
    cut(m[0]);
  }

  if (!at) {
    let day = 0;
    const md = r.match(/\b(pasado manana|manana|hoy|tomorrow|today)\b/);
    if (md) {
      day = md[1] === 'pasado manana' ? 2 : md[1] === 'manana' || md[1] === 'tomorrow' ? 1 : 0;
      cut(md[0]);
    }
    const mt = r.match(/\b(?:a\s+las?|a\s+la|las?|at)\s+(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm|a\.?\s?m\.?|p\.?\s?m\.?|de la manana|de la tarde|de la noche|del mediodia)?/)
      || r.match(/\b(\d{1,2})[:h](\d{2})\s*(am|pm)?\b/);
    if (mt) {
      let h = Number(mt[1]);
      const min = Number(mt[2] || 0);
      const mer = (mt[3] || '').replace(/[.\s]/g, '');
      if (/pm|tarde|noche/.test(mer) && h < 12) h += 12;
      if (/am|manana/.test(mer) && h === 12) h = 0;
      const explicit = !!mer;
      const d = new Date(now);
      d.setDate(d.getDate() + day);
      d.setHours(h, min, 0, 0);
      // "a las 3" sin am/pm: en horario laboral, las 3 son las 15:00.
      if (!explicit && h >= 1 && h <= 7) d.setHours(h + 12);
      // Si esa hora ya pasó hoy, es para mañana.
      if (d <= now && day === 0) d.setDate(d.getDate() + 1);
      at = d;
      cut(mt[0]);
    } else if (day > 0) {
      const d = new Date(now);
      d.setDate(d.getDate() + day);
      d.setHours(9, 0, 0, 0); // "mañana" sin hora = 9:00
      at = d;
    }
  }
  if (!at) return null;
  const text = rest.replace(/^\s*(que|de|a|para|to|that)\s+/i, '').replace(/\s+/g, ' ').trim() || 'Recordatorio';
  return { at: at.getTime(), text: text.charAt(0).toUpperCase() + text.slice(1) };
}

module.exports = { parse };

// Informe de errores opcional al autor (src/errreport.js limpia y agrupa).
// Destino: el webhook de un canal del autor, configurado al compilar en reporting.config.json
// (o PM_ERROR_WEBHOOK). Sin destino, la opción no aparece. Sin permiso explícito, nada sale del PC.
// Parte del proceso principal. `M` es el contexto compartido de la app.
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  const er = require('../errreport');
  const out = require('../outbound');
  const set = () => M.store.data.settings;
  const DAY_LIMIT = 20;
  let asked = false;
  let timer = null;

  /** Webhook del autor para los errores (o null si esta copia no lo trae). */
  function destination() {
    if (process.env.PM_ERROR_WEBHOOK) return process.env.PM_ERROR_WEBHOOK;
    try {
      const c = JSON.parse(M.fs.readFileSync(M.path.join(M.APP_DIR, 'reporting.config.json'), 'utf8'));
      return /^https:\/\//.test(c.errorWebhook || '') ? c.errorWebhook : null;
    } catch { return null; }
  }
  const consent = () => set().errorReports; // undefined = sin preguntar · true · false

  /** El primer error: se pregunta una sola vez si se pueden mandar informes. */
  function onError() {
    if (M.TEST || !destination()) return;
    if (consent() === true) { schedule(); return; }
    if (consent() === false || asked || !M.store.data.pet.name) return;
    asked = true;
    setTimeout(() => M.say('😿 Tuve un error. ¿Me dejas enviar informes de errores a Juanzreyes para que lo arregle? Solo el error y la versión: nada de tus tareas, notas, correos ni claves.', 'sad', 30000, {
      cat: 'pet', remote: false, actions: [{ label: '✅ Sí, enviar', cmd: 'errors.consent', arg: 'yes' }, { label: 'No, gracias', cmd: 'errors.consent', arg: 'no' }],
    }), 3000);
  }

  function setConsent(on) {
    set().errorReports = !!on;
    M.store.save();
    M.broadcast();
    if (on) schedule(2000);
  }

  function schedule(ms = 60e3) {
    if (timer) return;
    timer = setTimeout(() => { timer = null; sendNow(false); }, ms);
  }

  /** Manda los errores nuevos (agrupados, sin repetir, con tope diario). */
  async function sendNow(manual) {
    const dest = destination();
    if (!dest) return { ok: false, error: 'Esta copia de PM no tiene configurado a dónde enviar los informes' };
    if (!manual && consent() !== true) return { ok: false, error: 'Sin permiso' };
    const d = M.store.data;
    const sent = d.errSent || (d.errSent = {});
    for (const [fp, at] of Object.entries(sent)) if (Date.now() - at > 30 * 864e5) delete sent[fp]; // un mes después, si vuelve a pasar, se reenvía
    const today = M.dayKey();
    const count = d.errSentDay && d.errSentDay.day === today ? d.errSentDay.n : 0;
    if (count >= DAY_LIMIT) return { ok: false, error: 'Ya se enviaron bastantes informes hoy' };
    const batch = er.pending(M.diag.metrics(M.app).errors, sent, Math.min(5, DAY_LIMIT - count));
    if (!batch.length) return { ok: true, sent: 0 };
    const meta = { version: M.app.getVersion(), os: `${M.os.type()} ${M.os.release()}`, electron: process.versions.electron, install: installId() };
    try {
      await out.sendWebhook(dest, er.message(batch, meta, { home: M.os.homedir(), user: M.os.userInfo().username }));
      for (const e of batch) sent[e.fp] = Date.now();
      d.errSentDay = { day: today, n: count + batch.length };
      M.store.save();
      return { ok: true, sent: batch.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Identificador anónimo de la instalación (para saber si varios errores vienen del mismo PC). */
  function installId() {
    const s = set();
    if (!s.installId) { s.installId = require('crypto').randomBytes(4).toString('hex'); M.store.save(); }
    return s.installId;
  }

  function errState() {
    return { available: !!destination(), consent: consent() === undefined ? null : !!consent() };
  }

  function start() {
    M.diag.onError(onError);
  }

  return { start, setConsent, sendNow, errState, destination };
};

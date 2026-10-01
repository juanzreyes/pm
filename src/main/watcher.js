// Vigilante de ventanas: distracciones, reuniones, presentaciones.
// Parte del proceso principal (antes en main.js). `M` es el contexto compartido de la app:
// da acceso a todo lo demás (ventanas, datos, funciones de otros módulos).
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  // ---------- vigilante de distracciones ----------
  function sendMeeting() {
    if (M.petWin && !M.petWin.isDestroyed()) M.petWin.webContents.send('pet:meeting', M.meetingNow);
    broadcast();
  }

  // Reunión/llamada en curso (micrófono en uso o ventana de reunión de Teams).
  function handleMeeting(mt) {
    const now = Date.now();
    if (mt) {
      if (!M.meetingNow) {
        const ev = M.currentEvent();
        M.meetingNow = { app: mt.app, title: mt.title || (ev ? ev.title : ''), since: now, lastSeen: now };
        const what = M.meetingNow.title ? `"${M.meetingNow.title}"` : 'una reunión';
        M.say(`🎧 Estás en ${what} (${mt.app}). Me pongo los audífonos y me quedo calladito 🤫`, null, 7000);
        sendMeeting();
      }
      M.meetingNow.lastSeen = now;
    } else if (M.meetingNow && now - M.meetingNow.lastSeen > 30000) {
      const mins = Math.round((now - M.meetingNow.since) / 60000);
      const ended = M.meetingNow;
      M.meetingNow = null;
      sendMeeting();
      if (mins >= 3) {
        M.addXp(5);
        const day = M.today();
        day.meetings = [...(day.meetings || []), { title: ended.title || ended.app, mins }];
        M.store.save();
        M.say(`¡Reunión terminada! (${mins} min) 📝 ¿Salió alguna tarea? Añádela en 📋 Día o pulsa Ctrl+Alt+P.`, 'hop', 10000);
      }
    }
  }

  function onFocusSample(s) {
    if (M.pl) M.pl.onSample(s);
    if (M.presence) M.presence.onSample(s); // el pollito se sienta en tu ventana activa
    let pres = M.focus.presentingFrom(s);
    if (pres && pres !== 'Compartiendo pantalla en Teams' && (M.store.data.settings.noHideApps || []).includes(String(s.p || '').toLowerCase())) pres = null;
    M.lastPresentApp = String(s.p || '').toLowerCase();
    // Pantalla completa en OTRO monitor: el pollito no estorba, no hace falta esconderlo.
    if (pres === 'Pantalla completa' || pres === 'Presentación de PowerPoint') {
      try {
        const [l, t, r, b] = String(s.f).split(',').map(Number);
        const center = M.screen.screenToDipPoint({ x: Math.round((l + r) / 2), y: Math.round((t + b) / 2) });
        const fsDisplay = M.screen.getDisplayNearestPoint(center);
        if (M.petWin && M.screen.getDisplayMatching(M.petWin.getBounds()).id !== fsDisplay.id) pres = null;
      } catch { /* si falla la cuenta, mejor esconderse */ }
    }
    M.handlePresenting(pres);
    // Privacidad: con el seguimiento en pausa no se registra ni se analiza nada.
    if (M.trackingPaused()) return;
    if (M.store.data.settings.micWatch === false) s = { ...s, m: '' };
    handleMeeting(M.focus.meetingFrom(s));
    const now = Date.now();
    const dt = M.fx.lastSampleAt ? Math.min((now - M.fx.lastSampleAt) / 1000, 15) : 5;
    if (!M.store.data.settings.focusWatch) {
      M.fx.lastSampleAt = now;
      if (M.prod) M.prod.onSample(s, null, 0); // la salud funciona aunque no vigile distracciones
      return;
    }
    M.fx.lastSampleAt = now;
    const day = M.today();
    let c = M.meetingNow ? { cat: 'work', label: 'Reunión' } : M.focus.classify(s);
    // Lo que le dijiste que es trabajo hoy ("es trabajo") cuenta como trabajo.
    if (c.cat === 'distraction' && day.focusAllow && day.focusAllow[c.label]) c = { cat: 'work', label: c.label };
    M.fx.cat = c.cat;
    M.fx.label = c.label;
    try { M.whereami.onSample(s, c.cat); M.coach.onSample(s, c.cat); } catch (e) { M.diag.log('main', 'Coach: ' + e.message); }

    const f = day.focus || (day.focus = { work: 0, distraction: 0, neutral: 0, idle: 0, apps: {} });
    const hoursBefore = Math.floor((f.work || 0) / 3600);
    f[c.cat] = (f[c.cat] || 0) + dt;
    if (c.cat === 'distraction') f.apps[c.label] = (f.apps[c.label] || 0) + dt;
    // Por horas (para "tus patrones") y trabajo nocturno (para cuidar el agotamiento).
    const hr = new Date().getHours();
    if (c.cat === 'work' || c.cat === 'distraction') {
      day.hours = day.hours || {};
      const hb = day.hours[hr] || (day.hours[hr] = { w: 0, d: 0 });
      if (c.cat === 'work') hb.w += dt; else hb.d += dt;
    }
    if (c.cat === 'work' && (hr >= 22 || hr < 6)) day.lateWork = (day.lateWork || 0) + dt;
    if (Math.floor(f.work / 3600) > hoursBefore) {
      M.addXp(10);
      if (!M.isMuted()) M.say(`¡${Math.floor(f.work / 3600)} h de trabajo enfocado hoy! 💪 +10 XP`, 'dance', 7000);
    }

    if (M.prod) M.prod.onSample(s, c.cat, dt); // tiempo por proyecto + salud

    const pomoFocus = !!(M.prod && M.prod.isPomoFocus());
    const work = (M.inWorkHours() || pomoFocus || !!M.focusMode()) && !M.isMuted() && !M.meetingNow;
    const step = M.focusMode() ? 1 : M.prod ? M.prod.scoldStep() : 10;

    // Racha de distracción: regaña a los 10, 20, 30… minutos (cada 2 min durante un pomodoro).
    if (c.cat === 'distraction') {
      if (!M.fx.distractSince) { M.fx.distractSince = now; M.fx.scoldLevel = 0; }
      M.fx.lastDistractAt = now;
      M.fx.workSince = null;
      const mins = Math.floor((now - M.fx.distractSince) / 60000);
      if (work && mins >= step * (M.fx.scoldLevel + 1)) {
        M.fx.scoldLevel++;
        M.fx.scolded = true;
        const m = M.brain.scold(c.label, mins, M.fx.scoldLevel, M.firstPending());
        const own = M.pl && M.pl.scold(c.label, mins, M.fx.scoldLevel);
        if (own) m.text = own;
        if (pomoFocus) m.text = '🍅 ¡Estamos en pomodoro! ' + m.text;
        else if (M.focusMode()) m.text = '🎯 ¡Estás en modo foco! ' + m.text;
        M.say(m.text, m.anim, 11000);
        M.pushChat('pet', m.text);
        M.store.data.pet.happiness = M.clamp(M.store.data.pet.happiness - 3);
      }
    } else if (M.fx.distractSince && now - M.fx.lastDistractAt > 60000) {
      // Dejó la distracción. Si lo regañé y vuelve a trabajar, lo felicito.
      if (M.fx.scolded && c.cat === 'work') {
        if (!M.fx.workSince) M.fx.workSince = now;
        if (now - M.fx.workSince >= 90000) {
          M.say((M.pl && M.pl.backToWork()) || M.brain.backToWork(), 'dance', 7000);
          M.fx.scolded = false;
          M.fx.distractSince = null;
          M.fx.scoldLevel = 0;
        }
      } else if (!M.fx.scolded || now - M.fx.lastDistractAt > 10 * 60000) {
        M.fx.distractSince = null;
        M.fx.scoldLevel = 0;
        M.fx.scolded = false;
      }
    }

    // Inactividad
    if (c.cat === 'idle') {
      if (!M.fx.idleSince) M.fx.idleSince = now - s.i * 1000;
      if (work && !M.fx.idleNotified && now - M.fx.idleSince >= 20 * 60000) {
        M.fx.idleNotified = true;
        M.say('¿Hola? ¿Sigues ahí? 👀 Llevas 20 min sin tocar nada…', 'sad', 12000);
      }
    } else if (M.fx.idleSince) {
      if (M.fx.idleNotified && work) M.say(`¡Volviste! Estuviste ${M.brain.fmtDur((now - M.fx.idleSince) / 1000)} fuera 👀`, 'hop', 8000);
      M.fx.idleSince = null;
      M.fx.idleNotified = false;
    }

    // Gestos del pollito según lo que estás haciendo.
    const payload = { cat: c.cat, label: c.label, scoldLevel: M.fx.scoldLevel, idle: s.i };
    const key = `${c.cat}|${M.fx.scoldLevel}|${s.i > 300}`;
    if (key !== M.fx.sentKey && M.petWin && !M.petWin.isDestroyed()) {
      M.fx.sentKey = key;
      M.petWin.webContents.send('pet:focus', payload);
    }
  }

  let broadcastTimer = null;
  function broadcast() {
    // Agrupa varios cambios seguidos en un solo envío (evita trabajo repetido).
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      const snap = M.snapshot();
      for (const w of [M.petWin, M.panelWin, M.settingsWin, M.paletteWin]) if (w && !w.isDestroyed()) w.webContents.send('state', snap);
    }, 16);
  }

  return {
    sendMeeting,
    handleMeeting,
    onFocusSample,
    get broadcastTimer() { return broadcastTimer; },
    set broadcastTimer(v) { broadcastTimer = v; },
    broadcast,
  };
};

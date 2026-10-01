// Rutina y vida del pollito: daily por la mañana y cierre por la tarde, hambre/limpieza/energía,
// memoria entre aperturas (¿lo cerraste, se apagó el PC o lo mataron?), charla, comida, mimos y
// el cronómetro por tarea.
// Parte del proceso principal (antes en main.js). `M` es el contexto compartido de la app.
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  // ---------- horario: daily a las 8 y cierre antes de las 5 ----------
  function checkSchedule() {
    const store = M.store;
    const now = new Date();
    const dow = now.getDay();
    if (store.data.settings.workdaysOnly && (dow === 0 || dow === 6)) return;
    if (!store.data.pet.name || M.isMuted() || M.meetingNow) return; // primero el onboarding; en silencio o reunión no molesta
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const morning = M.toMinutes(store.data.settings.morningTime);
    const evening = M.toMinutes(store.data.settings.eveningTime);
    const day = M.today();
    const t = Date.now();

    if (nowMin >= morning && nowMin < evening && !day.standup && !(day.snoozeStandup > t)) {
      day.snoozeStandup = t + 30 * 60000; // si no contestas, vuelvo a preguntar en 30 min
      store.save();
      const n = M.todaysMeetings().length;
      const agenda = M.calState.status === 'ok' ? ` Hoy tienes ${n} reunion${n === 1 ? '' : 'es'} 📅` : '';
      const inbox = M.mailState.status === 'ok' && M.mailState.unseen ? ` y ${M.mailState.unseen} correos sin leer 📧` : '';
      M.say(`¡Buenos días! ☀️ ¿Qué hiciste ayer y qué vas a hacer hoy?${agenda}${inbox}`, 'alarm-soft', 14000);
      M.openPanel('standup');
    }

    const tasks = day.standup && day.standup.today;
    if (nowMin >= evening && tasks && tasks.length && !day.review && !(day.snoozeReview > t)) {
      day.snoozeReview = t + 30 * 60000;
      store.save();
      M.say('¡Casi termina el día! 🌇 ¿Cumpliste lo que dijiste?', 'alarm-soft', 12000);
      M.openPanel('review');
    }

    // Viernes después del cierre: informe semanal listo para copiar.
    const weekKey = `${now.getFullYear()}-w${Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / (7 * 864e5))}`;
    if (dow === 5 && nowMin >= evening + 5 && (day.review || !tasks) && store.data.lastWeeklyReport !== weekKey) {
      store.data.lastWeeklyReport = weekKey;
      store.save();
      M.say('¡Es viernes! 🎉 Tu informe semanal está listo para copiar y enviar 📊', 'celebrate', 12000);
      M.openPanel('report');
    }
  }

  // ---------- vida de la mascota ----------
  function petTick() {
    const clamp = M.clamp;
    const p = M.store.data.pet;
    const now = Date.now();
    if (p.vacation) { p.lastTick = now; M.store.data.life.lastSeen = now; M.store.save(); return; } // de vacaciones: nada baja
    const last = p.lastTick || now;
    const mins = Math.min((now - last) / 60000, 60 * 24);
    p.fullness = clamp(p.fullness - mins / 15);
    p.happiness = clamp(p.happiness - mins / 25);
    // Limpieza: se ensucia poco a poco.
    p.clean = clamp((p.clean ?? 100) - mins / 40);
    // Energía: duerme de noche (o en la siesta) y se cansa de día.
    const h = new Date().getHours();
    const napping = (p.napUntil || 0) > now;
    const fx = M.fx;
    const userAway = !fx.lastSampleAt || now - fx.lastSampleAt > 60e3 || (fx.idleSince && now - fx.idleSince > 15 * 60e3);
    if (napping) p.energy = clamp((p.energy ?? 100) + mins * 12);
    else if ((h >= 23 || h < 7) && userAway) p.energy = clamp((p.energy ?? 100) + mins * 1.5);
    else p.energy = clamp((p.energy ?? 100) - mins / 10);
    // Enfermedad: si pasa mucha hambre y está muy sucio.
    if (!p.sick && (p.fullness <= 0 || p.clean <= 1 || (p.fullness <= 5 && p.clean <= 15))) {
      p.sick = true;
      p.sickSince = now;
      p.happiness = clamp(p.happiness - 15);
      setTimeout(() => M.say('🤒 No me siento bien… creo que me enfermé. ¿Me das una medicina?', 'sad', 20000, {
        cat: 'pet', actions: [{ label: '💊 Medicina (25 🌽)', cmd: 'medicine' }, { label: '🌽 Dar maíz', cmd: 'feed' }],
      }), 2000);
    }
    p.lastTick = now;
    M.store.data.life.lastSeen = now; // latido: sirve para saber cuánto estuvo apagado
    M.store.save();
    M.broadcast();
  }

  // ---------- memoria entre aperturas ----------
  function markStarted() {
    const life = M.store.data.life;
    const now = Date.now();
    const bootAt = now - M.os.uptime() * 1000;
    let how = null;
    if (life.lastStart) {
      if (life.running) {
        // No se cerró bien. Si el PC se reinició después, fue un apagado; si no, lo mataron.
        how = (life.lastSeen || life.lastStart) < bootAt ? 'shutdown' : 'killed';
        if (how === 'killed') life.crashes = (life.crashes || 0) + 1;
      } else {
        how = life.lastQuitHow || 'user';
      }
    }
    const lastAlive = life.running ? life.lastSeen || life.lastStart : life.lastQuitAt;
    M.startup = { how, awayMs: lastAlive ? now - lastAlive : 0 };
    life.running = true;
    life.lastStart = now;
    life.lastSeen = now;
    M.store.flush();
  }

  function markStopped(how) {
    const life = M.store.data.life;
    if (!life.running) return;
    life.running = false;
    life.lastQuitAt = Date.now();
    life.lastQuitHow = how || 'user';
    if (life.lastQuitHow === 'user') life.closes = (life.closes || 0) + 1;
    M.store.flush();
  }

  function greetOnStart() {
    const p = M.store.data.pet;
    if (!p.name) {
      M.say('¡Pío! Acabo de nacer 🐣 ¿Cómo me llamo?', 'hatch', 15000);
      setTimeout(() => M.openPanel('onboarding'), 1200);
      return;
    }
    const life = M.store.data.life;
    const startup = M.startup;
    if (startup && startup.how) {
      const g = M.brain.returnGreeting({
        name: p.name, how: startup.how, awayMs: startup.awayMs, crashes: life.crashes, closes: life.closes, pending: M.firstPending(),
      });
      if (g.angry) {
        life.angryUntil = Date.now() + 15 * 60000; // se le pasa con mimos, comida o pidiéndole perdón
        M.store.flush();
      }
      M.say(g.text, g.anim, 14000);
      M.pushChat('pet', g.text);
      M.broadcast();
      return;
    }
    const h = new Date().getHours();
    const hi = h < 12 ? '¡Buenos días' : h < 19 ? '¡Buenas tardes' : '¡Buenas noches';
    M.say(`${hi}! ${p.name} reportándose 🫡`, 'hop', 7000);
  }

  async function confirmQuit(from = 'menú') {
    if (typeof from !== 'string') from = 'menú';
    const name = M.store.data.pet.name || 'PM';
    M.say('¿Me vas a cerrar? 🥺', 'sad', 8000);
    const parent = M.panelWin && M.panelWin.isVisible() ? M.panelWin : M.petWin;
    const r = await M.dialog.showMessageBox(parent, {
      type: 'question',
      buttons: ['No, quédate 💛', 'Sí, ciérrate'],
      defaultId: 0,
      cancelId: 0,
      title: name,
      message: `¿Seguro que quieres cerrar a ${name}? 🥺`,
      detail: 'Se acordará… y la próxima vez que lo abras estará enojado 😤',
    });
    if (r.response === 1) {
      M.quitHow = 'user';
      M.diag.log('info', `Cerrado por el usuario desde: ${from}`);
      M.app.quit();
    } else {
      M.say('¡Yay! Sabía que me querías 💛', 'love', 6000);
    }
  }

  let nextChatterAt = Date.now() + 20 * 60000;
  let lastHungryAt = 0;
  function chatter() {
    const now = Date.now();
    const h = new Date().getHours();
    if (h < 7 || h >= 23 || !M.store.data.pet.name || M.isMuted() || M.meetingNow || M.store.data.pet.vacation) return;
    const p = M.store.data.pet;
    if (p.fullness < 25 && now - lastHungryAt > 60 * 60000) {
      lastHungryAt = now;
      M.say('Pío… tengo hambre 🥺 ¿Me das maicito? 🌽', 'sad', 9000);
      return;
    }
    if ((p.clean ?? 100) < 30 && now - (p.lastDirtyMsg || 0) > 2 * 3600e3) {
      p.lastDirtyMsg = now;
      M.say('Huelo un poquito raro… 🪰 ¿Un bañito? 🛁', 'wobble', 12000, { cat: 'pet', actions: [{ label: '🛁 Bañar', cmd: 'bath' }] });
      return;
    }
    if ((p.energy ?? 100) < 20 && !(p.napUntil > now) && now - (p.lastTiredMsg || 0) > 2 * 3600e3) {
      p.lastTiredMsg = now;
      M.say('Estoy agotado… 😪 ¿Me dejas dormir una siestita?', 'yawn', 12000, { cat: 'pet', actions: [{ label: '😴 Siesta (3 min)', cmd: 'nap' }] });
      return;
    }
    if (M.store.data.settings.chatter && now >= nextChatterAt) {
      nextChatterAt = now + (25 + Math.random() * 25) * 60000;
      M.say(M.pl && Math.random() < 0.4 ? M.pl.chatter() : M.brain.idleChatter({ usage: M.usage, day: M.today(), pet: p, name: p.name }), 'flap', 8000);
    }
  }

  function feed() {
    const clamp = M.clamp;
    const p = M.store.data.pet;
    if (p.vacation) { M.say(`🏖️ Estoy de vacaciones en ${p.vacation.place}. ¡Vuelvo pronto!`, 'peck', 6000, { log: false }); return; }
    if (p.fullness >= 98) {
      M.say('¡Estoy llenito! No me cabe ni un grano 🫃', 'wobble');
      return;
    }
    p.fullness = clamp(p.fullness + 25);
    p.happiness = clamp(p.happiness + 5);
    p.clean = clamp((p.clean ?? 100) - 6); // come como un pollito: se mancha
    M.addXp(2);
    M.store.save();
    M.animate('eat');
    if (!M.calmDown(5)) M.say('¡Ñam ñam! 🌽 Gracias 💛', 'eat');
    M.broadcast();
  }

  function petPet() {
    const p = M.store.data.pet;
    const now = Date.now();
    if (now - (p.lastPetAt || 0) > 3000) {
      p.happiness = M.clamp(p.happiness + 3);
      p.lastPetAt = now;
      M.addXp(1);
      M.store.save();
      M.animate('love');
      M.calmDown(4);
      M.broadcast();
    } else {
      M.animate('love');
    }
  }

  // Cronómetro por tarea (solo uno en marcha a la vez).
  function taskTimer(index, action) {
    const list = M.today().standup && M.today().standup.today;
    const t = list && list[index];
    if (!t) return false;
    const now = Date.now();
    for (const x of list) if (x.startedAt) { x.spent = (x.spent || 0) + (now - x.startedAt) / 1000; delete x.startedAt; }
    if (action === 'start') {
      t.startedAt = now;
      if (!t.est) M.say(`⏱️ Cronómetro en marcha para "${t.text}". Tip: doble clic en el reloj para poner cuánto estimas.`, 'peck', 6000, { log: false });
    }
    M.store.save();
    M.broadcast();
    return true;
  }

  return { checkSchedule, petTick, markStarted, markStopped, greetOnStart, confirmQuit, chatter, feed, petPet, taskTimer };
};

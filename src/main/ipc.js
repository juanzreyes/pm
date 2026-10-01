// Mensajes entre las ventanas y el proceso principal (IPC).
// Parte del proceso principal (antes en main.js). `M` es el contexto compartido de la app:
// da acceso a todo lo demás (ventanas, datos, funciones de otros módulos).
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  // ---------- IPC ----------
  // Solo nuestras propias ventanas pueden hablar con el proceso principal.
  function guardIpc() {
    const trusted = (e) => M.isAppPage((e.senderFrame && e.senderFrame.url) || (e.sender && e.sender.getURL()));
    const handle = M.ipcMain.handle.bind(M.ipcMain);
    const on = M.ipcMain.on.bind(M.ipcMain);
    M.ipcMain.handle = (ch, fn) => handle(ch, (e, ...a) => {
      if (!trusted(e)) { M.diag.log('main', `Mensaje IPC rechazado (${ch}) desde ${e.senderFrame && e.senderFrame.url}`); throw new Error('forbidden'); }
      return fn(e, ...a);
    });
    M.ipcMain.on = (ch, fn) => on(ch, (e, ...a) => {
      if (!trusted(e)) { M.diag.log('main', `Mensaje IPC rechazado (${ch})`); return; }
      return fn(e, ...a);
    });
  }

  function setupIpc() {
    guardIpc();
    M.ipcMain.handle('get-state', () => M.snapshot());

    M.ipcMain.on('pet:ignore', (_e, ignore) => {
      if (!M.petWin || M.drag) return;
      M.petWin.setIgnoreMouseEvents(!!ignore, { forward: true });
    });

    M.ipcMain.on('pet:drag-start', (_e, { screenX, screenY }) => {
      if (!M.petWin) return;
      const [x, y] = M.petWin.getPosition();
      M.drag = { dx: screenX - x, dy: screenY - y };
      M.petWin.setIgnoreMouseEvents(false);
    });
    M.ipcMain.on('pet:drag-move', (_e, { screenX, screenY }) => {
      if (!M.petWin || !M.drag) return;
      M.petWin.setPosition(Math.round(screenX - M.drag.dx), Math.round(screenY - M.drag.dy));
      if (M.panelWin && M.panelWin.isVisible()) M.placePanel();
    });
    M.ipcMain.on('pet:drag-end', () => {
      if (!M.petWin) return;
      M.drag = null;
      const [x, y] = M.petWin.getPosition();
      M.store.data.position = { x, y };
      if (M.presence) M.presence.onDragged(); // lo moviste tú: se queda ahí un rato
      // En modo discreto se pega al borde más cercano.
      if (M.store.data.settings.discreet) {
        const b = M.petWin.getBounds();
        const wa = M.screen.getDisplayMatching(b).workArea;
        M.store.data.settings.dockSide = (b.x + b.width / 2) > wa.x + wa.width / 2 ? 'right' : 'left';
        M.peekPet(2500);
      }
      M.store.save();
    });

    M.ipcMain.on('pet:click', () => M.togglePanel());
    M.ipcMain.on('pet:petted', () => M.petPet());
    M.ipcMain.on('panel:hide', () => M.panelWin && M.panelWin.hide());
    M.ipcMain.on('panel:open', (_e, view) => M.openPanel(view));

    M.ipcMain.handle('chat:send', async (_e, text) => {
      text = String(text || '').trim().slice(0, 500);
      if (!text) return null;
      M.pushChat('me', text);
      M.store.data.chatSent = (M.store.data.chatSent || 0) + 1;
      // Modo pato de goma: preguntas, no respuestas.
      if (M.coach.duckActive()) {
        const reply = await M.coach.duckReply(text);
        M.pushChat('pet', reply);
        M.broadcast();
        return { text: reply };
      }
      if (/^(\/pato|pato de goma|modo pato|rubber duck)\b/i.test(text)) {
        const intro = M.coach.duckStart('');
        return { text: intro };
      }
      // "cada lunes: revisar métricas" → tarea recurrente
      if (M.ex && M.ex.parseRecurring(text)) {
        const msg = M.prod.capture(text);
        M.pushChat('pet', msg);
        M.broadcast();
        return { text: msg };
      }
      // "modo foco", "no me distraigas 30 min", "focus mode"
      const fm = text.match(/^(?:activa(?:r)? )?(?:el )?(?:modo foco|no me distraigas|focus mode)(?:\D+(\d{1,3})\s*(?:min|m)?)?/i);
      if (fm) {
        const min = Math.max(5, Math.min(240, Number(fm[1]) || 50));
        M.startFocus(min);
        const msg = `🎯 ¡Hecho! Modo foco ${min} min. Nos vemos al terminar 💪`;
        M.pushChat('pet', msg);
        M.broadcast();
        return { text: msg };
      }
      const p = M.store.data.pet;
      const r = M.brain.reply(text, {
        name: p.name || 'PM', usage: M.usage, day: M.today(), pet: p, level: M.levelInfo(p.xp || 0), insights: M.insights,
        mail: { ...M.mailState, configured: !!M.mailConfig() || M.connectedAccounts().length > 0 },
        calendar: { ...M.calState, configured: !!M.store.data.settings.calendarUrl || M.connectedAccounts().length > 0 },
        meetingNow: M.meetingNow,
      });

      // Con IA activada, todo lo que no sea una acción directa lo responde Claude.
      if (!r.action && M.aiAvailable()) {
        M.broadcast();
        M.panelSend('chat:thinking', true);
        M.animate('look');
        try {
          const res = await M.ai.chat(text);
          M.pushChat('pet', res.text);
          M.animate('peck');
        } catch (e) {
          M.pushChat('pet', (e.message === 'NO_KEY' ? '' : '😿 ' + e.message + '\n') + r.text);
        } finally {
          M.panelSend('chat:thinking', false);
        }
        M.checkAchievements();
        M.broadcast();
        return { text: '' };
      }

      M.pushChat('pet', r.text);
      if (r.action === 'feed') M.feed();
      else if (r.action === 'pet') M.petPet();
      else if (r.action === 'allow') {
        const day = M.today();
        if (M.fx.cat === 'distraction' || (M.fx.distractSince && M.fx.label)) {
          day.focusAllow = { ...(day.focusAllow || {}), [M.fx.label]: true };
          M.fx.distractSince = null; M.fx.scoldLevel = 0; M.fx.scolded = false; M.fx.sentKey = '';
          r.text = `Vale… hoy ${M.fx.label} cuenta como trabajo 🤨 Te creo. Por ahora.`;
        } else {
          M.setMute(30);
          r.text = 'Vale, te dejo tranquilo 30 minutos 🤫';
        }
        M.store.data.chat[M.store.data.chat.length - 1].text = r.text;
        M.store.save();
      } else if (['bath', 'nap', 'medicine'].includes(r.action)) {
        M.runCommand(r.action);
      } else if (r.action === 'pomo-start') {
        M.prod.pomoStart();
      } else if (r.action === 'pomo-stop') {
        M.prod.pomoStop();
      } else if (r.action === 'remind') {
        const msg = M.prod.capture(text);
        r.text = msg || 'No entendí la hora 🤔 Prueba: "recuérdame a las 3 revisar el informe" o "recuérdame en 20 min llamar a Ana".';
        M.store.data.chat[M.store.data.chat.length - 1].text = r.text;
      } else if (r.action === 'report' || r.action === 'daily-copy') {
        setTimeout(() => M.panelSend('panel:view', r.action === 'report' ? 'report' : 'daily-copy'), 400);
      } else if (r.action === 'mute') {
        M.setMute(60);
      } else if (r.action === 'unmute') {
        M.setMute(0);
      } else if (r.action === 'forgive') {
        M.store.data.life.angryUntil = 0;
        M.store.flush();
        M.animate('love');
      }
      else if (r.anim) M.animate(r.anim);
      if (r.action === 'standup' || r.action === 'review') {
        setTimeout(() => M.panelSend('panel:view', r.action), 600);
      }
      M.broadcast();
      return r;
    });

    M.ipcMain.on('pet:feed', () => M.feed());
    M.ipcMain.on('pet:pet', () => M.petPet());

    M.ipcMain.handle('pet:rename', (_e, name) => {
      name = String(name || '').trim().slice(0, 24);
      if (!name) return false;
      const first = !M.store.data.pet.name;
      M.store.data.pet.name = name;
      if (!M.store.data.pet.born) M.store.data.pet.born = Date.now();
      if (first && !M.store.data.settings.autoStartAsked) {
        M.store.data.settings.autoStartAsked = true;
        M.setAutoStart(true); // siempre ahí: arranca con Windows (se puede quitar en Ajustes)
      }
      M.store.flush();
      if (M.tray) M.tray.refreshMenu();
      M.say(first ? `¡Pío! Me llamo ${name} 🐣💛 ¡Seré tu PM!` : `¡Ahora me llamo ${name}! 💛`, 'celebrate', 9000);
      if (first) M.pushChat('pet', `¡Hola! Soy ${name}, tu pollito Project Manager 🐣📋. Pregúntame "¿cuánto llevo?" o escribe "ayuda".`);
      M.broadcast();
      return true;
    });

    M.ipcMain.handle('standup:save', (_e, { yesterday, tasks, help }) => {
      const day = M.today();
      const list = (tasks || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 30);
      const wasDone = new Set(((day.standup && day.standup.today) || []).filter((t) => t.done).map((t) => t.text));
      day.standup = { yesterday: String(yesterday || '').trim(), today: list.map((text) => ({ text, done: wasDone.has(text) })), help: String(help || '').trim(), at: Date.now() };
      delete day.snoozeStandup;
      if (M.plugins) M.plugins.emit('day:start', { tasks: list });
      const p = M.store.data.pet;
      p.happiness = M.clamp(p.happiness + 10);
      if (!day.standup.xpGiven) { day.standup.xpGiven = true; M.addXp(15); }
      M.store.save();
      let msg = `¡Anotado! Hoy tienes ${list.length} tarea${list.length === 1 ? '' : 's'} 📋`;
      if (day.standup.help) msg += `. Sobre "${day.standup.help}": lo tendré presente y te lo recordaré durante el día 💛`;
      msg += ` Antes de las ${M.store.data.settings.eveningTime} te pregunto cómo te fue.`;
      M.pushChat('pet', msg);
      M.say(`¡Plan listo! ${list.length} tareas para hoy 💪`, 'celebrate', 8000);
      M.broadcast();
      try { M.coach.reviewPlan(); } catch (e) { M.diag.log('main', 'Revisión del plan: ' + e.message); } // ¿cabe en el día? ¿tu mejor hora?
      return true;
    });

    M.ipcMain.handle('task:toggle', (_e, { date, index }) => {
      const day = M.store.data.days[date || M.dayKey()];
      const t = day && day.standup && day.standup.today[index];
      if (!t) return false;
      t.done = !t.done;
      // Al terminarla, se para su cronómetro.
      if (t.done && t.startedAt) { t.spent = (t.spent || 0) + (Date.now() - t.startedAt) / 1000; delete t.startedAt; }
      if (t.done) {
        M.store.data.pet.happiness = M.clamp(M.store.data.pet.happiness + 4);
        if (!t.xp) { t.xp = true; M.addXp(10); }
        const all = day.standup.today.every((x) => x.done);
        M.say(all ? '¡TODAS las tareas listas! 🎉🎉' : `${M.pl ? M.pl.praise() : '¡Bien!'} "${t.text}" ✅`, all ? 'celebrate' : 'dance', 6000);
        M.work.onTaskDone(t); // si viene de un ticket: se cierra en su gestor y se cargan las horas
        if (M.soul) M.soul.onTaskDone(t, all); // riega la huerta y, si es la última, un truco
        if (M.plugins) M.plugins.emit('task:done', { text: t.text, all });
      }
      M.store.save();
      M.broadcast();
      return true;
    });

    M.ipcMain.handle('task:add', (_e, text) => {
      text = String(text || '').trim().slice(0, 200);
      if (!text) return false;
      const day = M.today();
      if (!day.standup) day.standup = { yesterday: '', today: [], help: '', at: Date.now() };
      day.standup.today.push({ text, done: false });
      M.store.save();
      M.animate('peck');
      M.broadcast();
      return true;
    });

    M.ipcMain.handle('task:remove', (_e, index) => {
      const day = M.today();
      if (!day.standup || !day.standup.today[index]) return null;
      const [removed] = day.standup.today.splice(index, 1);
      if (removed.remId) M.store.data.reminders = (M.store.data.reminders || []).filter((r) => r.id !== removed.remId);
      M.store.save();
      M.broadcast();
      return removed; // el panel lo usa para "Deshacer"
    });

    M.ipcMain.handle('review:save', (_e, { done, notes, carry, mood }) => {
      const day = M.today();
      const tasks = (day.standup && day.standup.today) || [];
      tasks.forEach((t, i) => (t.done = !!(done && done[i])));
      if (mood >= 1 && mood <= 5) day.mood = Math.round(mood);
      for (const t of tasks) if (t.startedAt) { t.spent = (t.spent || 0) + (Date.now() - t.startedAt) / 1000; delete t.startedAt; }
      const n = tasks.filter((t) => t.done).length;
      day.review = { at: Date.now(), notes: String(notes || '').trim(), carry: !!carry, done: n, total: tasks.length };
      delete day.snoozeReview;
      const ratio = tasks.length ? n / tasks.length : 1;
      if (!day.reviewXp) { day.reviewXp = true; M.addXp(15); }
      const p = M.store.data.pet;
      p.happiness = M.clamp(p.happiness + 5 + Math.round(ratio * 15));
      M.store.save();
      let msg, anim;
      if (ratio === 1) { msg = `¡Cumpliste TODO (${n}/${tasks.length})! Eres increíble 🏆🎉`; anim = 'celebrate'; }
      else if (ratio >= 0.5) { msg = `¡Buen día! ${n}/${tasks.length} tareas ✅ Lo demás, mañana 💪`; anim = 'dance'; }
      else { msg = `${n}/${tasks.length} hoy. No pasa nada, mañana lo sacamos juntos 🫂`; anim = 'hug'; }
      if (carry && n < tasks.length) msg += ' Pasé tus pendientes a mañana 📌';
      M.pushChat('pet', msg);
      if (day.focus) M.pushChat('pet', M.brain.focusSummary(day));
      M.say(msg, anim, 10000);
      M.broadcast();
      return true;
    });

    M.ipcMain.handle('snooze', (_e, kind) => {
      const day = M.today();
      const key = kind === 'review' ? 'snoozeReview' : 'snoozeStandup';
      day[key] = Date.now() + 30 * 60000;
      M.store.save();
      M.say('¡Vale! Te vuelvo a preguntar en 30 minutos ⏰', 'peck');
      return true;
    });

    M.ipcMain.handle('settings:update', (_e, patch) => {
      const allowed = ['morningTime', 'eveningTime', 'workdaysOnly', 'chatter', 'focusWatch', 'sounds', 'lang', 'aiModel', 'aiEnabled', 'autoHide', 'voice', 'smartClipboard', 'followMonitor', 'strolls', 'autoBackup', 'focusDuringBlocks', 'focusDuringPomodoro', 'claudeBudget', 'personality', 'musicMode', 'buildWatch', 'lowMemory', 'syncEnabled', 'autoMarkdown', 'musicDetect', 'trackersClose', 'trackersLogTime', 'claudeAutoRun', 'claudeRunPermission', 'claudeRunTests', 'claudeRunBudget', 'claudeParallel', 'claudeReview', 'claudeAutoFixCi', 'claudeAutoFixReview', 'claudeMaxFixes', 'petPerch', 'pcReactions', 'typeAlong', 'weatherCity', 'petStyle', 'stuckDetector', 'planCheck', 'bestHour', 'closingRitual', 'endOfDay', 'closeApps', 'myName', 'claudeRespectLimits', 'claudeLimitPct', 'claudeModelAuto', 'teamShare', 'focusBlock', 'summaryWithClaude'];
      if ('claudeLimitPct' in patch) patch.claudeLimitPct = Math.max(50, Math.min(99, Math.round(Number(patch.claudeLimitPct)) || 85));
      if ('endOfDay' in patch && !/^\d{2}:\d{2}$/.test(patch.endOfDay || '')) delete patch.endOfDay;
      if ('closeApps' in patch) patch.closeApps = (Array.isArray(patch.closeApps) ? patch.closeApps : String(patch.closeApps || '').split(/[,\n]/)).map((x) => String(x).trim().replace(/\.exe$/i, '')).filter((x) => /^[\w .-]{2,40}$/.test(x)).slice(0, 12);
      if ('myName' in patch) patch.myName = String(patch.myName || '').trim().slice(0, 40);
      if ('petStyle' in patch && !['normal', 'pixel', 'clay', 'minimal'].includes(patch.petStyle)) delete patch.petStyle;
      if ('weatherCity' in patch) patch.weatherCity = String(patch.weatherCity || '').trim().slice(0, 80);
      if ('weatherCity' in patch) setTimeout(() => M.presence.weatherTick(true), 50);
      if (patch.petPerch === false) setTimeout(() => M.presence.goHome(), 50);
      if ('teamShare' in patch || 'myName' in patch) setTimeout(() => M.farm.tick(), 50);
      if ('claudeParallel' in patch) patch.claudeParallel = Math.max(1, Math.min(3, Math.round(Number(patch.claudeParallel)) || 2));
      if ('claudeMaxFixes' in patch) patch.claudeMaxFixes = Math.max(0, Math.min(5, Math.round(Number(patch.claudeMaxFixes)) || 0));
      if ('claudeRunBudget' in patch) patch.claudeRunBudget = Math.max(0, Math.min(100, Number(patch.claudeRunBudget) || 0));
      if ('claudeRunPermission' in patch && !['acceptEdits', 'bypassPermissions'].includes(patch.claudeRunPermission)) delete patch.claudeRunPermission;
      if ('personality' in patch && !['motivador', 'sarcastico', 'zen', 'sargento'].includes(patch.personality)) delete patch.personality;
      if ('claudeBudget' in patch) patch.claudeBudget = Math.max(0, Math.min(100000, Number(patch.claudeBudget) || 0));
      if ('aiModel' in patch && !M.aiMod.MODELS[patch.aiModel]) delete patch.aiModel;
      if ('lang' in patch && !['es', 'en', 'pt', 'fr'].includes(patch.lang)) delete patch.lang;
      if ('lang' in patch && M.tray) setTimeout(() => M.tray.refreshMenu(), 50);
      for (const k of allowed) if (k in patch) M.store.data.settings[k] = patch[k];
      if (patch.focusWatch === false && M.petWin) {
        M.fx.cat = null;
        M.fx.sentKey = '';
        M.petWin.webContents.send('pet:focus', { cat: null, scoldLevel: 0, idle: 0 });
      }
      if ('autoStart' in patch) M.setAutoStart(patch.autoStart);
      M.store.save();
      M.broadcast();
      return true;
    });

    M.ipcMain.handle('token:set', async (_e, token) => {
      token = String(token || '').trim();
      if (!token) M.store.data.settings.manualToken = '';
      else {
        M.store.data.settings.manualToken = M.safeStorage.isEncryptionAvailable()
          ? M.safeStorage.encryptString(token).toString('base64')
          : Buffer.from(token, 'utf8').toString('base64');
      }
      M.store.save();
      await M.refreshUsage(true);
      return M.snapshot();
    });

    M.ipcMain.handle('usage:refresh', async () => {
      await M.refreshUsage(true);
      return M.snapshot();
    });

    M.ipcMain.on('open-external', (_e, url) => {
      const ok = /^https:\/\/(docs\.claude\.com|claude\.ai|code\.claude\.com|www\.anthropic\.com|myaccount\.google\.com|calendar\.google\.com|outlook\.office\.com|outlook\.live\.com|login\.yahoo\.com|account\.apple\.com|github\.com|console\.anthropic\.com|id\.atlassian\.com|linear\.app|dev\.azure\.com|ntfy\.sh|t\.me|play\.google\.com|apps\.apple\.com|entra\.microsoft\.com|portal\.azure\.com)\//;
      if (ok.test(url)) M.shell.openExternal(url);
    });

    M.ipcMain.handle('web:login', async () => {
      M.say('Te abrí la página de Claude 🌐 Entra con tu CORREO (Google a veces no deja dentro de apps). Yo espero aquí 🐣', 'peck', 15000);
      M.pushChat('pet', 'Para conectarme: en la ventana de Claude escribe tu correo → te llega un código o enlace → ponlo ahí. Es solo una vez: después me acuerdo 💛');
      if (M.panelWin) M.panelWin.hide();
      const org = await M.claudeWeb.login();
      M.openPanel('usage');
      if (!org) M.say('Cerraste la ventana sin entrar 😿 Cuando quieras, vuelve a pulsar "Conectar".', 'sad', 9000);
      if (org) {
        M.store.data.web = { orgId: org.id, orgName: org.name };
        M.store.flush();
        await M.refreshUsage();
        const ok = M.usage.connection.status === 'ok';
        M.say(ok ? '¡Conectado a tu cuenta de Claude! 🎉 Ya veo tus límites.' : 'Entraste, pero no pude leer tu uso todavía 😿', ok ? 'celebrate' : 'sad', 9000);
      }
      M.broadcast();
      return M.snapshot();
    });

    M.ipcMain.handle('web:logout', async () => {
      await M.claudeWeb.logout();
      M.store.data.web = { orgId: null, orgName: null };
      M.store.flush();
      await M.refreshUsage();
      return M.snapshot();
    });

    M.ipcMain.on('panel:view-changed', (_e, view) => {
      if (['chat', 'usage', 'day', 'agenda', 'pet'].includes(view)) {
        M.store.data.life.lastView = view;
        M.store.save();
      }
    });

    M.ipcMain.on('pet:context', () => {
      const name = M.store.data.pet.name || 'PM';
      M.Menu.buildFromTemplate([
        { label: `🐣 ${name} · nivel ${M.levelInfo(M.store.data.pet.xp || 0).level}`, enabled: false },
        { type: 'separator' },
        { label: '💬 Abrir panel', click: () => M.openPanel('chat') },
        { label: '🔍 Buscar comando…  (Ctrl+Alt+Espacio)', click: M.openPalette },
        { label: `🔔 Centro de avisos${(M.store.data.inbox || []).filter((x) => !x.read && x.cat !== 'pet').length ? ` (${(M.store.data.inbox || []).filter((x) => !x.read && x.cat !== 'pet').length})` : ''}`, click: () => M.openPanel('inbox') },
        M.prod && M.prod.pomoState()
          ? { label: '⏹️ Detener pomodoro', click: () => M.prod.pomoStop() }
          : { label: '🍅 Empezar pomodoro (25 min)', click: () => M.prod.pomoStart() },
        { label: '✍️ Anotar rápido…  (Ctrl+Alt+P)', click: M.openCapture },
        { label: '🎮 Minijuego: atrapa el maíz', click: M.openGame },
        { label: '📈 Estadísticas', click: () => M.openPanel('stats') },
        { label: '🛍️ Tienda', click: () => M.openPanel('shop') },
        { label: '📊 ¿Cuánto llevo?', click: () => M.openPanel('usage') },
        { label: '🌽 Dar de comer', click: M.feed },
        { label: '💛 Acariciar', click: M.petPet },
        { type: 'separator' },
        { label: '☀️ Daily de la mañana', click: () => M.openPanel('standup') },
        { label: '🌇 Cierre del día', click: () => M.openPanel('review') },
        { type: 'separator' },
        M.isMuted()
          ? { label: '🔔 Quitar silencio', click: () => { M.setMute(0); M.say('¡Volví! 🐣', 'hop'); } }
          : { label: '🔕 Silenciar 1 hora (reunión)', click: () => { M.setMute(60); M.say('Shhh 🤫 Te dejo tranquilo 1 hora.', 'peck'); } },
        { label: '🫁 Respirar conmigo', click: () => M.presence.breathe(4) },
        { label: M.store.data.settings.petPerch === false ? '🪟 Sentarte en mis ventanas' : '🪟 Quedarte quieto (no subir a las ventanas)', click: () => { M.store.data.settings.petPerch = M.store.data.settings.petPerch === false; if (!M.store.data.settings.petPerch) M.presence.goHome(); M.store.save(); M.broadcast(); } },
        { label: '🙈 Ocultar (sigue en la bandeja)', click: () => { M.petWin.hide(); if (M.panelWin) M.panelWin.hide(); if (M.tray) M.tray.refreshMenu(); } },
        { type: 'separator' },
        { label: '⚙️ Ajustes…', click: () => M.openSettings() },
        { label: 'ℹ️ Acerca de PM Pollito…', click: M.openAbout },
        { label: '❌ Cerrar PM', click: () => M.confirmQuit('menú del pollito') },
      ]).popup({ window: M.petWin });
    });

    // ----- cuentas: inicio de sesión web (Microsoft / Google) -----
    M.ipcMain.handle('account:connect', async (_e, provider) => {
      if (!['microsoft', 'google'].includes(provider)) return { ok: false, error: 'Proveedor desconocido.' };
      if (!M.oauthReady()[provider]) {
        return { ok: false, error: `Falta el ID de aplicación de ${M.PROVIDER_LABEL[provider]} en oauth.config.json (ver README).` };
      }
      M.say(`Te abrí el navegador 🌐 Inicia sesión con ${M.PROVIDER_LABEL[provider]} y pulsa "Aceptar". Yo espero aquí 🐣`, 'peck', 15000);
      try {
        const acc = await M.accounts.connect(provider, M.accountIo);
        M.store.data.settings.accounts = { ...(M.store.data.settings.accounts || {}), [provider]: acc };
        delete M.accountErrors[provider];
        M.store.data.mailSeen = null; // la primera lectura solo memoriza
        M.store.flush();
        M.openPanel('agenda');
        await M.refreshCalendar();
        await M.refreshMail();
        const n = M.todaysMeetings().length;
        const unseen = M.mailState.unseen || 0;
        M.say(`¡${acc.email || M.PROVIDER_LABEL[provider]} conectado! 🎉 Hoy: ${n} reunion${n === 1 ? '' : 'es'} y ${unseen} correos sin leer.`, 'celebrate', 10000);
        return { ok: true, state: M.snapshot() };
      } catch (e) {
        M.openPanel('agenda');
        M.say('No se pudo conectar 😿 ' + e.message, 'sad', 10000);
        return { ok: false, error: e.message };
      }
    });
    M.ipcMain.handle('oauth:save', (_e, patch) => {
      try { const ready = M.saveOauthConfig(patch || {}); M.broadcast(); return { ok: true, ready }; } catch (e) { return { ok: false, error: e.message }; }
    });
    M.ipcMain.handle('account:remove', async (_e, provider) => {
      const all = { ...(M.store.data.settings.accounts || {}) };
      delete all[provider];
      M.store.data.settings.accounts = all;
      M.accounts.forget(provider);
      delete M.accountErrors[provider];
      M.store.flush();
      await M.refreshCalendar();
      await M.refreshMail();
      return M.snapshot();
    });

    // ----- correo -----
    M.ipcMain.handle('mail:save', async (_e, cfg) => {
      const preset = M.mail.PRESETS[cfg.provider] || M.mail.PRESETS.custom;
      const host = String(cfg.host || preset.host || '').trim();
      const user = String(cfg.user || '').trim();
      const pass = String(cfg.pass || '').replace(/\s+/g, ''); // las contraseñas de app de Google vienen con espacios
      if (!host || !user || !pass) return { ok: false, error: 'Faltan datos: servidor, correo y contraseña de aplicación.' };
      try {
        await M.mail.check({ host, port: cfg.port || preset.port, user, pass });
      } catch (e) {
        return { ok: false, error: e.message };
      }
      M.store.data.settings.mail = { provider: cfg.provider, host, port: Number(cfg.port || preset.port) || 993, user, passEnc: M.encrypt(pass) };
      M.store.data.mailSeen = null; // la primera lectura solo memoriza
      M.store.flush();
      await M.refreshMail(true);
      return { ok: true, state: M.snapshot() };
    });
    M.ipcMain.handle('mail:remove', async () => {
      M.store.data.settings.mail = null;
      M.store.data.mailSeen = null;
      M.store.flush();
      await M.refreshMail();
      return M.snapshot();
    });
    M.ipcMain.handle('mail:refresh', async () => { await M.refreshMail(); return M.snapshot(); });

    // ----- agenda -----
    M.ipcMain.handle('cal:save', async (_e, url) => {
      url = String(url || '').trim();
      try {
        const from = new Date(); from.setHours(0, 0, 0, 0);
        await M.calendar.load(url, from.getTime(), from.getTime() + 864e5);
      } catch (e) {
        return { ok: false, error: e.message };
      }
      M.store.data.settings.calendarUrl = M.encrypt(url);
      M.store.flush();
      await M.refreshCalendar(true);
      return { ok: true, state: M.snapshot() };
    });
    M.ipcMain.handle('cal:remove', async () => {
      M.store.data.settings.calendarUrl = '';
      M.store.flush();
      await M.refreshCalendar();
      return M.snapshot();
    });
    M.ipcMain.handle('cal:refresh', async () => { await M.refreshCalendar(); return M.snapshot(); });
    M.ipcMain.on('join', (_e, url) => M.joinMeeting(url));

    // ----- productividad -----
    M.ipcMain.on('pomo:start', () => M.prod.pomoStart());
    M.ipcMain.on('pomo:stop', () => M.prod.pomoStop());
    M.ipcMain.handle('reminder:add', (_e, text) => {
      const r = M.prod.addReminder(String(text || '').match(/^\s*(recu[eé]rdame|av[ií]same)/i) ? text : 'recuérdame ' + text);
      return r;
    });
    M.ipcMain.on('reminder:remove', (_e, id) => M.prod.removeReminder(id));
    M.ipcMain.handle('capture:submit', (_e, text) => {
      const msg = M.prod.capture(text);
      M.store.data.flags = { ...(M.store.data.flags || {}), usedCapture: true };
      if (M.captureWin && !M.captureWin.isDestroyed()) M.captureWin.hide();
      return msg;
    });
    M.ipcMain.on('capture:close', () => { if (M.captureWin && !M.captureWin.isDestroyed()) M.captureWin.hide(); });
    M.ipcMain.handle('git:yesterday', async () => M.prod.lastWorkdayCommits());
    M.ipcMain.handle('git:refresh', async () => { await M.prod.gitRefresh(); return M.snapshot(); });
    M.ipcMain.handle('github:token', async (_e, token) => {
      M.store.data.settings.githubToken = token ? M.encrypt(String(token).trim()) : '';
      M.store.flush();
      const r = await M.prod.ghRefresh();
      if (r.status === 'ok') M.say(`¡GitHub conectado como @${r.login}! 🐙 ${r.toReview.length} PRs esperan tu revisión.`, 'celebrate', 9000);
      return M.snapshot();
    });
    M.ipcMain.handle('github:refresh', async () => { await M.prod.ghRefresh(); return M.snapshot(); });
    M.ipcMain.on('open-pr', (_e, url) => M.openSafeUrl(url));
    M.ipcMain.handle('hooks:install', () => {
      try {
        M.prod.hooksInstall();
        M.say('¡Conectado con Claude Code! 🤖 Te aviso cuando Claude termine o te necesite. (Reinicia tus sesiones de Claude Code)', 'celebrate', 11000);
        return { ok: true, state: M.snapshot() };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
    M.ipcMain.handle('hooks:uninstall', () => {
      try { M.prod.hooksUninstall(); return { ok: true, state: M.snapshot() }; } catch (e) { return { ok: false, error: e.message }; }
    });
    M.ipcMain.handle('report:weekly', () => M.prod.weeklyReport());
    M.ipcMain.handle('report:daily', () => M.prod.dailyText());
    M.ipcMain.handle('copy', (_e, text) => { M.clipboard.writeText(String(text || '')); return true; });
    M.ipcMain.handle('timesheet:export', async () => {
      const parent = M.panelWin && M.panelWin.isVisible() ? M.panelWin : M.petWin;
      const r = await M.dialog.showSaveDialog(parent, {
        title: 'Exportar horas por proyecto',
        defaultPath: M.path.join(M.app.getPath('documents'), `horas-pm-${M.dayKey()}.csv`),
        filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }],
      });
      if (r.canceled || !r.filePath) return null;
      M.fs.writeFileSync(r.filePath, M.prod.timesheet());
      M.shell.showItemInFolder(r.filePath);
      return r.filePath;
    });
    M.ipcMain.handle('settings:integrations', async (_e, patch) => {
      if (Array.isArray(patch.gitRoots)) M.store.data.settings.gitRoots = patch.gitRoots.map((x) => String(x).trim()).filter(Boolean);
      if (patch.health) M.store.data.settings.health = { ...(M.store.data.settings.health || {}), ...patch.health };
      M.store.save();
      if (patch.gitRoots) M.prod.gitRefresh();
      M.broadcast();
      return M.snapshot();
    });

    // ----- IA -----
    M.ipcMain.handle('ai:setKey', async (_e, key) => {
      key = String(key || '').trim();
      M.store.data.settings.aiKey = key ? M.encrypt(key) : '';
      M.store.data.settings.aiEnabled = true;
      M.store.flush();
      if (M.ai) M.ai.reset();
      if (!key) return { ok: true, state: M.snapshot() };
      try {
        const r = await M.ai.chat(M.lang() === 'en' ? 'Say hi in one short sentence.' : 'Salúdame en una frase corta.');
        M.pushChat('pet', r.text);
        M.say(r.text, 'celebrate', 8000);
        return { ok: true, state: M.snapshot() };
      } catch (e) {
        return { ok: false, error: e.message === 'NO_KEY' ? 'Falta la API key.' : e.message, state: M.snapshot() };
      }
    });
    M.ipcMain.handle('ai:polish', async (_e, { text, kind }) => {
      if (!M.aiAvailable()) return { ok: false, error: 'Activa la IA en 🐣 Perfil → IA.' };
      const instr = kind === 'daily'
        ? (M.lang() === 'en' ? 'Rewrite this daily stand-up to be clear, concise and professional for Slack/Teams. Keep the same facts and format (bullets).' : 'Reescribe este daily para que sea claro, conciso y profesional para Slack/Teams. Mantén los mismos datos y el formato con viñetas.')
        : (M.lang() === 'en' ? 'Turn this weekly report into a polished summary for my manager: 3-line executive summary at the top, then the key points. Keep all facts, do not invent anything.' : 'Convierte este informe semanal en un resumen pulido para mi jefe: resumen ejecutivo de 3 líneas arriba y luego los puntos clave. Mantén todos los datos y no inventes nada.');
      try {
        return { ok: true, text: await M.ai.polish(text, instr) };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });

    // ----- tienda, logros, estadísticas -----
    M.ipcMain.handle('shop:buy', (_e, id) => { const r = M.buyItem(id); return { ...r, state: M.snapshot() }; });
    M.ipcMain.handle('shop:equip', (_e, id) => { const r = M.equipItem(id); return { ...r, state: M.snapshot() }; });
    M.ipcMain.handle('shop:unequip', (_e, slot) => { M.unequipSlot(slot); return M.snapshot(); });
    M.ipcMain.handle('stats:get', () => M.statsData());

    // ----- monitor de sitios -----
    M.ipcMain.handle('monitor:add', async (_e, { url, name }) => {
      const u = M.monitor.normalize(url);
      if (!u) return { ok: false, error: 'URL no válida.' };
      const list = M.store.data.settings.monitors || [];
      if (list.length >= 15) return { ok: false, error: 'Máximo 15 sitios.' };
      list.push({ id: Date.now().toString(36), url: u, name: String(name || '').trim().slice(0, 40) });
      M.store.data.settings.monitors = list;
      M.store.save();
      await M.checkMonitors(false);
      return { ok: true, state: M.snapshot() };
    });
    M.ipcMain.handle('monitor:remove', (_e, id) => {
      M.store.data.settings.monitors = (M.store.data.settings.monitors || []).filter((m) => m.id !== id);
      delete M.monitorState[id];
      M.store.save();
      return M.snapshot();
    });
    M.ipcMain.handle('monitor:check', async () => { await M.checkMonitors(false); return M.snapshot(); });
    M.ipcMain.on('open-monitor', (_e, id) => {
      const m = (M.store.data.settings.monitors || []).find((x) => x.id === id);
      if (m) M.shell.openExternal(m.url);
    });

    // ----- minijuego -----
    M.ipcMain.on('game:open', (_e, mode) => M.openGame(String(mode || '')));
    M.ipcMain.handle('game:end', (_e, score, mode) => M.gz.onGameEnd(String(mode || 'corn'), score));
    // Juego 2.0 · 6/7: misiones, huevos dorados y tu año
    M.ipcMain.handle('mission:claim', (_e, id) => M.gz.claimMission(String(id || '')));
    M.ipcMain.handle('egg:open', (_e, streak) => M.gz.openEgg(Number(streak)));
    M.ipcMain.handle('wrapped:get', (_e, year) => M.gz.wrappedData(year));
    M.ipcMain.handle('wrapped:save', (e, dataUrl) => M.gz.saveWrapped(dataUrl, M.BrowserWindow.fromWebContents(e.sender)));
    M.ipcMain.on('game:close', () => { if (M.gameWin && !M.gameWin.isDestroyed()) M.gameWin.close(); });

    // ----- actualizaciones -----
    M.ipcMain.handle('update:check', async () => M.checkUpdates(true));

    // ----- comandos (botones de avisos, paleta, atajos) -----
    M.ipcMain.on('pet:action', (_e, { cmd, arg }) => M.runCommand(cmd, arg));
    M.ipcMain.on('command', (_e, { cmd, arg }) => M.runCommand(cmd, arg));
    M.ipcMain.handle('palette:list', () => M.paletteCommands());
    M.ipcMain.handle('sync:now', () => M.syncNow(true));
    M.ipcMain.handle('sync:dir', async (e) => {
      const r = await M.dialog.showOpenDialog(M.BrowserWindow.fromWebContents(e.sender), { title: 'Carpeta sincronizada (OneDrive, Google Drive…)', defaultPath: M.syncDir(), properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      M.store.data.settings.syncDir = r.filePaths[0]; M.store.save(); M.broadcast(); return r.filePaths[0];
    });
    M.ipcMain.handle('export:md', () => M.exportObsidian(true));
    M.ipcMain.handle('export:ics', () => M.exportBlocksIcs());
    M.ipcMain.handle('profile:add', (_e, { name, emoji }) => { const id = M.profiles.add(name, emoji, M.store.data); M.broadcast(); return id; });
    M.ipcMain.handle('profile:switch', (_e, id) => { M.switchProfile(id); return true; });
    M.ipcMain.handle('profile:remove', (_e, id) => { try { M.profiles.remove(id); M.broadcast(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } });
    M.ipcMain.handle('cli:set', (_e, on) => { try { return { ok: true, on: M.installCli(!!on) }; } catch (e) { return { ok: false, error: e.message }; } });
    M.ipcMain.handle('integrations:set', (_e, { what, on }) => { try { return { ok: true, state: M.setIntegration(what, !!on) }; } catch (e) { return { ok: false, error: e.message }; } });
    M.ipcMain.handle('projmem:update', (_e, repo) => { try { return { ok: true, file: M.updateProjectMemory(repo) }; } catch (e) { return { ok: false, error: e.message }; } });
    M.ipcMain.handle('git:repos', () => require('../git').discover(M.prod.snapshot().git.roots || []).map((r) => ({ path: r, name: M.path.basename(r) })));
    // ----- programación, organización y vida del pollito -----
    M.ipcMain.handle('queue:add', (_e, { text, project, model }) => M.plan.queueAdd(text, project, { model }));
    M.ipcMain.handle('queue:remove', (_e, id) => M.plan.queueRemove(id));
    M.ipcMain.handle('queue:next', (_e, project) => !!M.plan.queueNext(project));
    // Cola de Claude que se ejecuta sola (worktree aparte + claude -p)
    M.ipcMain.handle('runs:start', (_e, a) => (a && typeof a === 'object' ? M.work.startRun(String(a.id || ''), { force: !!a.force }) : M.work.startRun(String(a || ''))));
    // Plugins (2.0 · 7/7)
    M.ipcMain.handle('plugins:enable', (_e, id, on) => M.plugins.setEnabled(String(id || ''), !!on));
    M.ipcMain.handle('plugins:scan', () => { M.plugins.scan(); M.broadcast(); return M.plugins.pluginsState(); });
    M.ipcMain.handle('plugins:folder', () => M.plugins.openFolder());
    M.ipcMain.handle('plugins:example', () => M.plugins.installExample());
    // Extensión del navegador (2.0 · 7/7)
    M.ipcMain.handle('browser:regen', () => M.browser.regenerate());
    M.ipcMain.handle('browser:sites', (_e, list) => M.browser.saveSites(list));
    M.ipcMain.handle('browser:folder', () => { const f = M.browser.browserState().folder; M.shell.openPath(f); return f; });
    // Granja del equipo (2.0 · 5/7)
    M.ipcMain.handle('farm:folder', (e, folder) => (folder === '' ? M.farm.setFolder('') : M.farm.chooseFolder(M.BrowserWindow.fromWebContents(e.sender))));
    M.ipcMain.handle('farm:kudo', (_e, to, msg) => M.farm.giveKudo(String(to || ''), String(msg || '')));
    M.ipcMain.handle('farm:visit', (_e, to) => M.farm.visit(String(to || '')));
    M.ipcMain.handle('farm:refresh', () => { M.farm.tick(); return M.farm.farmState(); });
    M.ipcMain.handle('claudeRec:save', (_e, r) => M.work.recurringSave(r || {}));
    M.ipcMain.handle('claudeRec:delete', (_e, id) => M.work.recurringDelete(String(id)));
    M.ipcMain.handle('runs:accept', (_e, id) => M.work.acceptRun(String(id)));
    M.ipcMain.handle('runs:discard', (_e, id) => M.work.discardRun(String(id)));
    M.ipcMain.handle('runs:open', (_e, id) => { M.work.openRun(String(id)); return true; });
    M.ipcMain.handle('runs:stop', (_e, id) => { M.work.stopRun(String(id)); return true; });
    M.ipcMain.handle('runs:clear', () => { M.work.clearRuns(); return true; });
    M.ipcMain.handle('claude:bin', async (e) => {
      const r = await M.dialog.showOpenDialog(M.BrowserWindow.fromWebContents(e.sender), { title: '¿Dónde está claude (Claude Code)?', properties: ['openFile'], filters: process.platform === 'win32' ? [{ name: 'Claude Code', extensions: ['exe', 'cmd'] }] : [] });
      if (r.canceled || !r.filePaths[0]) return M.snapshot();
      M.store.data.settings.claudeBin = r.filePaths[0];
      M.store.save();
      M.broadcast();
      return M.snapshot();
    });
    // Tickets de Jira / GitHub Issues / Linear / Azure DevOps
    M.ipcMain.handle('tickets:save', (_e, { provider, patch }) => M.work.saveTracker(String(provider), patch || {}));
    M.ipcMain.handle('tickets:refresh', () => M.work.refreshTickets(true));
    M.ipcMain.handle('tickets:add', (_e, key) => (key === '*' ? M.work.addAllTickets() : M.work.addTicket(String(key))));
    M.ipcMain.handle('tickets:open', (_e, key) => { M.work.openTicket(String(key)); return true; });
    M.ipcMain.handle('runs:pr', (_e, id) => M.work.prRun(String(id)));
    M.ipcMain.handle('runs:fix', (_e, arg) => M.work.fixRun(String(arg)));
    M.ipcMain.handle('tickets:start', (_e, { key, repo }) => M.work.startTicket(String(key), repo ? String(repo) : ''));
    M.ipcMain.handle('tickets:claude', (_e, { key, repo }) => M.work.ticketToClaude(String(key), repo ? String(repo) : ''));
    // El alma del pollito: huerta, trucos, linaje, fechas, cartas…
    M.ipcMain.handle('soul:act', async (_e, { action, arg }) => { try { return await M.soul.act(String(action), arg); } catch (e) { return { ok: false, error: e.message }; } });
    // Productividad 2.0: ¿dónde me quedé?, contextos, logros, notas de reunión
    M.ipcMain.handle('where:resume', (_e, project) => M.whereami.showResume(String(project)).then((r) => ({ ok: true, lines: r.lines })).catch((e) => ({ ok: false, error: e.message })));
    M.ipcMain.handle('where:contextSave', (_e, { project, ctx }) => M.whereami.saveContext(String(project), ctx || {}));
    M.ipcMain.handle('where:contextOpen', (_e, project) => M.whereami.openContext(String(project)));
    M.ipcMain.handle('where:brag', (_e, which) => M.whereami.brag(['month', 'lastmonth', 'year'].includes(which) ? which : 'month').catch((e) => ({ ok: false, error: e.message })));
    M.ipcMain.handle('coach:meeting', (_e, text) => M.coach.meetingActions(String(text || '')));
    M.ipcMain.handle('coach:meetingAdd', (_e, list) => M.coach.addMeetingTasks(Array.isArray(list) ? list : []));
    // Informe de errores opcional al autor
    M.ipcMain.handle('errors:consent', (_e, on) => { M.errreport.setConsent(!!on); return M.snapshot(); });
    M.ipcMain.handle('errors:send', () => M.errreport.sendNow(true));
    // Configuración del equipo (pm-equipo.json)
    M.ipcMain.handle('team:export', (_e, opts) => M.team.exportPack(opts || {}));
    M.ipcMain.handle('team:import', () => M.team.importPack());
    // Avisos fuera del PC: canal del equipo y celular
    M.ipcMain.handle('remote:save', (_e, patch) => M.remote.save(patch || {}));
    M.ipcMain.handle('remote:test', (_e, which) => M.remote.test(which === 'team' ? 'team' : 'phone'));
    M.ipcMain.handle('remote:post', (_e, what) => (what === 'weekly' ? M.remote.postWeekly(true) : M.remote.postDaily(true)));
    M.ipcMain.handle('day:prioritize', (_e, withBlocks) => M.plan.prioritize(withBlocks !== false));
    M.ipcMain.handle('task:split', (_e, i) => M.plan.splitTask(Number(i)));
    M.ipcMain.handle('milestone:save', (_e, m) => M.plan.milestoneSave(m || {}));
    M.ipcMain.handle('milestone:done', (_e, { id, done }) => M.plan.milestoneDone(id, done));
    M.ipcMain.handle('milestone:delete', (_e, id) => M.plan.milestoneDelete(id));
    M.ipcMain.handle('friday:data', async () => ({ report: M.prod.weeklyReport(), goals: M.ex.goals() }));
    M.ipcMain.handle('friday:save', (_e, r) => M.plan.fridaySave(r || {}));
    M.ipcMain.handle('home:buy', (_e, id) => M.pl.buyHome(id));
    M.ipcMain.handle('diary:write', async () => { const e = await M.pl.writeDiary(M.dayKey(), true); return !!e; });
    M.ipcMain.handle('commit:suggest', (_e, dir) => (M.isRepo(dir) ? M.dev.suggestCommit(dir) : null));
    M.ipcMain.handle('push:check', () => M.runCommand('push.check'));
    M.ipcMain.handle('backup:setPass', (_e, pass) => {
      pass = String(pass || '');
      M.store.data.settings.backupPass = pass ? M.encrypt(pass) : undefined;
      if (!pass) delete M.store.data.settings.backupPass;
      M.store.save();
      M.broadcast();
      return true;
    });
    M.ipcMain.handle('palette:search', (_e, q) => (M.ex ? M.ex.search(q).map((r) => ({ ...r, label: r.label, hint: M.T(r.hint) })) : []));
    // ----- recurrentes, plantillas, modo foco y diagnóstico -----
    M.ipcMain.handle('recurring:add', (_e, r) => M.ex.addRecurring(r || {}));
    M.ipcMain.handle('recurring:delete', (_e, id) => M.ex.deleteRecurring(id));
    M.ipcMain.handle('templates:apply', (_e, id) => M.ex.applyTemplate(id));
    M.ipcMain.handle('templates:save', (_e, name) => M.ex.saveTemplate(name));
    M.ipcMain.handle('templates:delete', (_e, id) => M.ex.deleteTemplate(id));
    M.ipcMain.handle('focus:start', (_e, min) => { M.startFocus(Math.max(5, Math.min(240, Number(min) || 50))); return true; });
    M.ipcMain.handle('focus:stop', () => { M.endFocus(); return true; });
    M.ipcMain.handle('diag:get', () => M.diag.metrics(M.app));
    M.ipcMain.handle('diag:copy', () => {
      M.clipboard.writeText(M.diag.report(M.app, { Idioma: M.lang(), Empaquetada: M.app.isPackaged ? 'sí' : 'no', 'Claude conectado': M.usage.connection && M.usage.connection.status }));
      return true;
    });
    M.ipcMain.handle('diag:open', () => { const f = M.diag.metrics(M.app).logFile; if (f && M.fs.existsSync(f)) M.shell.showItemInFolder(f); else M.shell.openPath(M.app.getPath('userData')); return true; });
    M.ipcMain.on('diag:error', (e, msg) => M.diag.log('ventana', String(msg).slice(0, 2000)));
    M.ipcMain.handle('palette:run', (_e, { id, arg }) => {
      if (M.paletteWin && !M.paletteWin.isDestroyed()) M.paletteWin.hide();
      return M.runCommand(id, arg);
    });
    M.ipcMain.handle('palette:text', async (_e, text) => {
      if (M.paletteWin && !M.paletteWin.isDestroyed()) M.paletteWin.hide();
      text = String(text || '').trim();
      if (!text) return false;
      if (/^\s*(recu[eé]rdame|av[ií]same|remind me)\b/i.test(text) || /^(tarea|todo|task)\s*:/i.test(text) || (M.ex && M.ex.parseRecurring(text))) {
        M.prod.capture(text);
      } else {
        M.openPanel('chat');
        setTimeout(() => M.panelSend('chat:ask', text), 250);
      }
      return true;
    });
    M.ipcMain.on('palette:close', () => { if (M.paletteWin && !M.paletteWin.isDestroyed()) M.paletteWin.hide(); });

    // ----- centro de avisos -----
    M.ipcMain.handle('inbox:read', (_e, id) => {
      for (const x of M.store.data.inbox || []) if (!id || x.id === id) x.read = true;
      M.store.save();
      M.broadcast();
      return true;
    });
    M.ipcMain.handle('inbox:clear', () => { M.store.data.inbox = []; M.store.save(); M.broadcast(); return true; });

    // ----- ventanas -----
    M.ipcMain.on('settings:open', (_e, section) => M.openSettings(section));
    M.ipcMain.on('settings:close', () => { if (M.settingsWin && !M.settingsWin.isDestroyed()) M.settingsWin.close(); });
    M.ipcMain.on('about:open', () => M.openAbout());
    M.ipcMain.on('about:close', () => { if (M.aboutWin && !M.aboutWin.isDestroyed()) M.aboutWin.close(); });
    M.ipcMain.on('palette:open', () => M.openPalette());
    M.ipcMain.on('open-data-dir', () => M.shell.openPath(M.app.getPath('userData')));

    // ----- apariencia y privacidad -----
    M.ipcMain.handle('appearance:set', (_e, patch) => {
      const s = M.store.data.settings;
      if (patch.theme && ['system', 'light', 'dark', 'contrast'].includes(patch.theme)) s.theme = patch.theme;
      if ('reducedMotion' in patch) s.reducedMotion = !!patch.reducedMotion;
      if ('volume' in patch) s.volume = Math.max(0, Math.min(100, Number(patch.volume) || 0));
      M.store.save();
      if (patch.petSize) M.setPetSize(patch.petSize);
      if ('discreet' in patch && !!patch.discreet !== !!s.discreet) M.setDiscreet(patch.discreet);
      M.broadcast();
      return M.snapshot();
    });
    M.ipcMain.handle('tracking:pause', (_e, minutes) => { M.pauseTracking(minutes); return M.snapshot(); });
    M.ipcMain.handle('privacy:set', (_e, patch) => {
      const s = M.store.data.settings;
      if ('micWatch' in patch) s.micWatch = !!patch.micWatch;
      if ('gitWatch' in patch) s.gitWatch = !!patch.gitWatch;
      M.store.save();
      M.broadcast();
      return M.snapshot();
    });
    M.ipcMain.handle('data:export', () => M.exportData());
    M.ipcMain.handle('data:import', () => M.importData());
    M.ipcMain.handle('data:delete', () => M.deleteAllData());
    M.ipcMain.handle('flags:set', (_e, patch) => { M.store.data.flags = { ...(M.store.data.flags || {}), ...patch }; M.store.save(); M.broadcast(); return true; });

    // ----- tareas editables -----
    const taskAt = (i) => M.today().standup && M.today().standup.today[i];
    M.ipcMain.handle('task:edit', (_e, { index, text }) => {
      const t = taskAt(index);
      text = String(text || '').trim().slice(0, 200);
      if (!t || !text) return false;
      t.text = text;
      M.store.save();
      M.broadcast();
      return true;
    });
    M.ipcMain.handle('task:move', (_e, { from, to }) => {
      const list = M.today().standup && M.today().standup.today;
      if (!list || !list[from] || to < 0 || to >= list.length) return false;
      const [t] = list.splice(from, 1);
      list.splice(to, 0, t);
      M.store.save();
      M.broadcast();
      return true;
    });
    M.ipcMain.handle('task:update', (_e, { index, patch }) => {
      const t = taskAt(index);
      if (!t) return false;
      if ('priority' in patch) t.priority = ['h', 'm', 'l'].includes(patch.priority) ? patch.priority : undefined;
      if ('est' in patch) t.est = Math.max(0, Math.min(600, Math.round(Number(patch.est) || 0))) || undefined;
      if ('time' in patch) {
        if (t.remId) M.store.data.reminders = (M.store.data.reminders || []).filter((r) => r.id !== t.remId);
        t.time = /^\d{2}:\d{2}$/.test(patch.time || '') ? patch.time : undefined;
        t.remId = undefined;
        if (t.time) {
          const [h, m] = t.time.split(':').map(Number);
          const at = new Date(); at.setHours(h, m, 0, 0);
          if (at > new Date()) t.remId = M.prod.addReminderAt(at.getTime(), `📌 ${t.text}`).id;
        }
      }
      M.store.save();
      M.broadcast();
      return true;
    });
    M.ipcMain.handle('task:timer', (_e, { index, action }) => M.taskTimer(index, action));

    // ----- diario de Claude, prompts, bloques, objetivos, hábitos, notas, copias, informe mensual -----
    M.ipcMain.handle('journal:ai', (_e, which) => M.ex.aiJournal(which));
    // Resumen redactado del día por proyecto (en vez de tus peticiones tal cual).
    M.ipcMain.handle('worksummary:get', (_e, which, force) => M.worksum.get(which === 'prev' ? 'prev' : 'today', { force: !!force }));
    M.ipcMain.handle('journal:refresh', () => { M.ex.claudeJournal(true); M.broadcast(); return true; });
    M.ipcMain.handle('prompts:copy', (_e, id) => M.ex.copyPrompt(id));
    M.ipcMain.handle('prompts:save', (_e, p) => M.ex.savePrompt(p || {}));
    M.ipcMain.handle('prompts:delete', (_e, id) => M.ex.deletePrompt(id));
    M.ipcMain.handle('blocks:set', (_e, list) => M.ex.setBlocks(list));
    M.ipcMain.handle('goals:save', (_e, g) => M.ex.saveGoal(g || {}));
    M.ipcMain.handle('goals:delete', (_e, id) => M.ex.deleteGoal(id));
    M.ipcMain.handle('habits:step', (_e, { id, delta }) => M.ex.habitStep(id, delta > 0 ? 1 : -1));
    M.ipcMain.handle('habits:save', (_e, h) => M.ex.saveHabit(h || {}));
    M.ipcMain.handle('habits:delete', (_e, id) => M.ex.deleteHabit(id));
    M.ipcMain.handle('notes:set', (_e, text) => M.ex.setNotes(text));
    M.ipcMain.handle('notes:search', (_e, q) => M.ex.searchNotes(q));
    M.ipcMain.handle('backup:now', () => M.ex.backupNow(true));
    M.ipcMain.handle('backup:dir', (e) => M.ex.chooseBackupDir(M.BrowserWindow.fromWebContents(e.sender)));
    M.ipcMain.handle('backup:open', () => { const d = M.snapshot().backup.dir; M.fs.mkdirSync(d, { recursive: true }); M.shell.openPath(d); return true; });
    M.ipcMain.handle('monthly:pdf', (e, which) => M.ex.monthlyPdf(M.BrowserWindow.fromWebContents(e.sender), which));
    M.ipcMain.handle('pet:species', (_e, sp) => {
      if (!['chick', 'duck', 'cat', 'penguin'].includes(sp)) return false;
      M.store.data.pet.species = sp;
      M.store.save();
      M.broadcast();
      M.animate('celebrate');
      return true;
    });
    M.ipcMain.handle('pet:play', (_e, kind) => M.runCommand({ corn: 'play.corn', ball: 'play.ball', stroll: 'play.stroll' }[kind]));

    M.ipcMain.handle('task:restore', (_e, { index, task }) => {
      const day = M.today();
      if (!day.standup) day.standup = { yesterday: '', today: [], help: '', at: Date.now() };
      const list = day.standup.today;
      const t = { text: String(task.text || ''), done: !!task.done, priority: task.priority, time: task.time };
      // Si tenía hora, vuelve a crear su recordatorio.
      if (t.time && /^\d{2}:\d{2}$/.test(t.time)) {
        const [h, m] = t.time.split(':').map(Number);
        const at = new Date(); at.setHours(h, m, 0, 0);
        if (at > new Date()) t.remId = M.prod.addReminderAt(at.getTime(), `📌 ${t.text}`).id;
      }
      list.splice(Math.max(0, Math.min(index, list.length)), 0, t);
      M.store.save();
      M.broadcast();
      return true;
    });
    M.ipcMain.handle('reminder:restore', (_e, r) => { M.prod.addReminderAt(r.at, r.text); return true; });

    // ----- modo discreto: el pollito se asoma al pasar el ratón -----
    M.ipcMain.on('pet:hover', (_e, on) => {
      if (!M.store.data.settings.discreet) return;
      if (on) { clearTimeout(M.dockTimer); M.dockPet(true); } else M.peekPet(2500);
    });

    M.ipcMain.on('app:quit', () => M.confirmQuit('ajustes'));
  }

  return {
    guardIpc,
    setupIpc,
  };
};

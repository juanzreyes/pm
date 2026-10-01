// Arranque de la app: datos y perfil, ventanas, módulos y todos los temporizadores.
// Parte del proceso principal (antes en main.js). `M` es el contexto compartido de la app.
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  async function boot() {
    const { app } = M;
    if (process.platform === 'win32') app.setAppUserModelId('com.pm.pollito');
    if (process.platform === 'darwin' && app.dock) app.dock.hide(); // en Mac vive en la barra de menús, sin icono en el Dock
    await M.checkSafeMode();
    M.profiles = M.profilesMod.create(app.getPath('userData'));
    M.store = new M.Store(app.getPath('userData'), M.profiles.fileFor(M.profiles.active().id));
    const store = M.store;
    M.markStarted();
    // Permisos: portapapeles para todos; capturar el sonido del sistema, solo la ventana oculta de escucha.
    require('electron').session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['clipboard-sanitized-write', 'clipboard-read'].includes(perm) || (['media', 'display-capture'].includes(perm) && M.isAudioPage(wc.getURL()))));
    M.setupIpc();
    M.errreport.start(); // informe de errores opcional (solo con permiso)
    M.setupAudioCapture();
    M.createPet();
    M.createPanel();
    M.buildTray();
    watchCrashes();
    followCursor();

    M.petWin.webContents.once('did-finish-load', () => {
      M.petTick();
      M.applyPetSize();
      if (store.data.settings.discreet) setTimeout(() => M.dockPet(false), 1500);
      setTimeout(M.greetOnStart, 800);
    });
    // Apagado o cierre de sesión de Windows: no cuenta como "me cerraste".
    M.petWin.on('session-end', () => {
      M.quitHow = 'shutdown';
      M.markStopped('shutdown');
    });

    createModules();
    startTimers();
    registerShortcuts();

    if (!M.SAFE) M.stopFocus = M.focus.start(M.onFocusSample);

    // En la versión instalada, el inicio con Windows debe apuntar al .exe instalado (no al de desarrollo).
    if (app.isPackaged && store.data.settings.autoStart) M.setAutoStart(true);

    // "Siempre debe estar ahí": activa el inicio con Windows una vez (se puede quitar en Ajustes).
    if (!store.data.settings.autoStartAsked && store.data.pet.name) {
      store.data.settings.autoStartAsked = true;
      M.setAutoStart(true);
    }

    await M.refreshUsage();
    setInterval(() => M.refreshUsage(), M.USAGE_EVERY_MS);
    // Icono de la bandeja: cada 5 s (la cuenta atrás del pomodoro se ve moverse).
    M.updateTrayIcon();
    setInterval(M.updateTrayIcon, 5000);
    if (M.SAFE) {
      if (M.tray) M.tray.setToolTip('PM Pollito · modo seguro');
      M.say('🩺 Estoy en modo seguro: solo lo básico. Mira Ajustes → Diagnóstico y reiníciame cuando quieras.', 'peck', 15000, {
        cat: 'pet', actions: [{ label: '🩺 Diagnóstico', cmd: 'diag' }, { label: '🔄 Reiniciar normal', cmd: 'restart' }],
      });
      return;
    }
    M.refreshCalendar();
    M.refreshMail();
    setInterval(() => M.refreshCalendar(), 10 * 60 * 1000);
    setInterval(() => M.refreshMail(), 3 * 60 * 1000);
    setInterval(M.meetingReminders, 20 * 1000);
    setInterval(M.petTick, 60 * 1000);
    setInterval(() => { M.checkSchedule(); M.chatter(); M.checkWellbeing(); M.checkBirthday(); }, 30 * 1000);
    setTimeout(M.checkSchedule, 5000);
    // Reafirma "siempre encima" por si otra app lo tapa.
    setInterval(() => { if (M.petWin && M.petWin.isVisible()) M.petWin.setAlwaysOnTop(true, 'screen-saver'); }, 15000);
  }

  // Si el proceso de una ventana se cae (memoria, GPU…), se recarga sola en vez de desaparecer.
  function watchCrashes() {
    const revive = (getWin, name) => {
      const w = getWin();
      if (!w) return;
      w.webContents.on('render-process-gone', (_e, d) => {
        if (M.quitting || d.reason === 'clean-exit') return;
        M.diag.log('main', `La ventana ${name} se cayó (${d.reason}); la recupero`);
        setTimeout(() => { const x = getWin(); if (x && !x.isDestroyed()) x.webContents.reload(); }, 800);
      });
    };
    revive(() => M.petWin, 'del pollito');
    // (el panel se recupera solo: ver createPanel)
    // La GPU caída deja las ventanas transparentes en blanco o invisibles: recarga el pollito.
    M.app.on('child-process-gone', (_e, d) => {
      if (M.quitting) return;
      M.diag.log('main', `Proceso ${d.type} caído (${d.reason})`);
      if (d.type === 'GPU' && M.petWin && !M.petWin.isDestroyed()) setTimeout(() => M.petWin.webContents.reload(), 1500);
    });
    if (M.startup && M.startup.how === 'killed') M.diag.log('main', 'La sesión anterior terminó de golpe (proceso terminado desde fuera o fallo grave).');
  }

  // Los ojos siguen al cursor.
  function followCursor() {
    let lastCursor = '';
    setInterval(() => {
      const petWin = M.petWin;
      if (!petWin || petWin.isDestroyed() || !petWin.isVisible()) return;
      const c = M.screen.getCursorScreenPoint();
      const b = petWin.getBounds();
      const k = `${c.x - b.x},${c.y - b.y}`;
      if (k !== lastCursor) {
        lastCursor = k;
        const f = b.width / M.PET_W; // con zoom, las coordenadas de la página son más pequeñas
        petWin.webContents.send('pet:cursor', { x: (c.x - b.x) / f, y: (c.y - b.y) / f });
      }
    }, 90);
  }

  // Productividad, IA, extras, herramientas de programación, planificador, vida del pollito, trabajo en equipo.
  function createModules() {
    const { app, store, path, os, fs } = M;
    M.prod = M.productivity.create({
      store,
      appDir: M.APP_DIR,
      command: (cmd, arg) => M.runCommand(cmd, arg),
      // Dónde buscar repos si el usuario no configuró carpetas: en desarrollo, junto a este proyecto;
      // instalado, en las carpetas habituales de cualquier persona.
      defaultGitRoots: () => {
        if (!app.isPackaged) return [path.dirname(M.APP_DIR)];
        const h = os.homedir();
        return ['Desktop', 'Escritorio', 'Documents', 'Documentos', path.join('source', 'repos'), 'repos', 'dev', 'projects', 'Proyectos', 'code']
          .map((d) => path.join(h, d))
          .filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
      },
      say: M.say,
      animate: M.animate,
      send: M.sendPet,
      pushChat: M.pushChat,
      broadcast: M.broadcast,
      addXp: M.addXp,
      isMuted: M.isMuted,
      getMeeting: () => M.meetingNow,
      today: M.today,
      notify: M.notify,
      openUrl: M.openSafeUrl,
      decrypt: M.decrypt,
      encrypt: M.encrypt,
      addTask: M.addTask,
      getUsage: () => M.usage,
      petName: () => store.data.pet.name || 'PM',
      weekGoals: () => (M.ex ? M.ex.goals() : []),
      onPomodoroDone: () => M.pl && M.pl.onPomodoroDone(),
      trackBranch: (name, dt) => M.dev && M.dev.trackBranch(name, dt),
      onGitStatuses: (statuses, repos) => { if (M.dev) { M.dev.setBranches(statuses); M.dev.prePushAll(repos); } },
      onClaudeDone: (proj) => (M.plan ? M.plan.onClaudeDone(proj) : false),
      onClaudeRaw: (ev) => { if (M.sess) M.sess.onEvent(ev); },
      captureHook: (text) => {
        const q = text.match(/^(?:tarea:\s*)?(?:para claude|for claude|cola)(?:\[([^\]]*)\])?\s*:\s*([\s\S]+)$/i);
        if (q && M.plan) {
          M.plan.queueAdd(q[2], q[1] || '');
          const msg = `🤖 En la cola de Claude (${M.plan.snapshot().claudeQueue.length}). Te la recuerdo cuando Claude termine.`;
          M.say(msg, 'peck', 6000, { log: false, target: { cmd: 'panel', arg: 'day#claude-queue' } });
          return msg;
        }
        const ex = M.ex;
        const r = ex && ex.parseRecurring(text.replace(/^(tarea|todo|task)s*:s*/i, ''));
        if (!r) return null;
        ex.addRecurring(r);
        const st = ex.snapshot().recurring.slice(-1)[0];
        const msg = `🔁 ¡Anotado! "${r.text}" se añadirá a tus tareas ${st ? st.label : ''}.`;
        M.say(msg, 'peck', 7000, { log: false, target: { cmd: 'panel', arg: 'day#recurring' } });
        return msg;
      },
      claudeToday: () => (M.ex ? M.ex.journalText(M.ex.claudeJournal().today, '').map((l) => l.trim()) : []),
    });
    if (!M.SAFE) {
      M.prod.start({ status: M.extStatus, command: M.extCommand, capture: (text) => M.extCapture(text), devEvent: (ev) => (M.dev ? M.dev.devEvent(ev) : false),
        mcpToken: M.mcpToken, mcp: (msg) => M.mcpMod.handle(msg, M.mcpRun, { version: app.getVersion() }), statusline: M.statusLineText });
    }

    M.ai = M.aiMod.create({
      apiKey: () => M.decrypt(store.data.settings.aiKey),
      model: () => store.data.settings.aiModel || M.aiMod.DEFAULT_MODEL,
      lang: M.lang,
      name: () => store.data.pet.name || 'PM',
      persona: () => (M.pl ? M.pl.aiTone() : ''),
      context: M.aiContext,
      actions: {
        addTask: (text) => { M.addTask(text); M.animate('peck'); },
        completeTask: (i) => {
          const t = M.today().standup && M.today().standup.today[i];
          if (!t) return false;
          if (!t.done) { t.done = true; if (!t.xp) { t.xp = true; M.addXp(10); } M.work.onTaskDone(t); if (M.soul) M.soul.onTaskDone(t, M.today().standup.today.every((x) => x.done)); }
          store.save();
          M.broadcast();
          M.animate('dance');
          return true;
        },
        addReminder: (at, text) => M.prod.addReminderAt(at, text),
        startPomodoro: () => M.prod.pomoStart(),
      },
    });

    M.ex = M.extrasMod.create({
      store, say: M.say, broadcast: M.broadcast, animate: M.animate, sendPet: M.sendPet, today: M.today, addTask: M.addTask, addXp: M.addXp,
      isMuted: M.isMuted, trackingPaused: M.trackingPaused, aiAvailable: M.aiAvailable, lang: M.lang,
      clipboard: M.clipboard, screen: M.screen, dialog: M.dialog, shell: M.shell, app, BrowserWindow: M.BrowserWindow,
      appDir: M.APP_DIR,
      version: app.getVersion(),
      achievements: M.gami.ACHIEVEMENTS,
      ai: () => M.ai,
      usage: () => M.usage,
      getMeeting: () => M.meetingNow,
      meetingsToday: () => M.todaysMeetings(),
      isPresenting: () => !!M.presenting,
      petWin: () => (M.petWin && !M.petWin.isDestroyed() ? M.petWin : null),
      dragging: () => !!M.drag,
      onMoved: () => { if (M.tray) M.tray.refreshMenu && M.tray.refreshMenu(); },
      askChat: (text) => { M.openPanel('chat'); setTimeout(() => M.panelSend('chat:ask', text), 300); },
      backupPassword: M.backupPassword,
    });
    if (!M.SAFE) M.ex.start();
    const common = {
      store, say: M.say, broadcast: M.broadcast, animate: M.animate, send: M.sendPet, today: M.today, addTask: M.addTask, addXp: M.addXp, isMuted: M.isMuted, clipboard: M.clipboard,
      aiAvailable: M.aiAvailable, ai: () => M.ai, usage: () => M.usage, getMeeting: () => M.meetingNow, isPresenting: () => !!M.presenting,
      meetingsToday: () => M.todaysMeetings(), insights: () => M.insights(),
      askChat: (text) => { M.openPanel('chat'); setTimeout(() => M.panelSend('chat:ask', text), 300); },
      audioVerdict: () => M.audioVerdict(),
      audioOnMedia: (playing) => M.audioOnMedia(playing),
    };
    M.mcpToken(); // clave local para MCP y el comando pm
    M.dev = M.devtoolsMod.create(common);
    M.sess = M.sessionsMod.create(common);
    if (!M.SAFE) M.sess.start();
    M.plan = M.plannerMod.create({ ...common, setBlocks: (l) => M.ex.setBlocks(l), saveGoal: (g) => M.ex.saveGoal(g) });
    if (!M.SAFE) M.plan.start();
    M.pl = M.petlifeMod.create(common);
    if (!M.SAFE) M.pl.start();
    M.soul = require('../petsoul').create({ ...common, levelInfo: M.levelInfo, aiTone: () => M.pl.aiTone(), log: (e) => M.diag.log('main', 'Alma del pollito: ' + e.message) });
    if (!M.SAFE) M.soul.start();
    if (!M.SAFE) { M.work.start(); M.remote.start(); setTimeout(() => M.team.applyBundled(), 8000); }
  }

  function startTimers() {
    const { app, store } = M;
    setInterval(M.focusTick, 5000);
    setTimeout(() => M.syncNow(false), 20000);
    setInterval(() => M.syncNow(false), 5 * 60e3);
    setInterval(() => {
      const s = store.data.settings;
      if (!s.autoMarkdown || !s.markdownDir || new Date().getHours() < 21) return;
      if (store.data.lastMarkdownAt && new Date(store.data.lastMarkdownAt).toDateString() === new Date().toDateString()) return;
      M.exportObsidian(false).catch((e) => M.diag.log('main', 'Markdown: ' + e.message));
    }, 10 * 60e3);
    // Novedades: la primera vez que arranca una versión nueva.
    setTimeout(() => {
      const v = app.getVersion();
      // Quien ya usaba la app antes de guardar la versión también ve las novedades.
      const seen = store.data.lastVersionSeen || (store.data.chat.length ? '1.1.0' : null);
      store.data.lastVersionSeen = v;
      store.save();
      if (seen && seen !== v && store.data.pet.name) {
        M.say(`🎁 ¡Me actualicé a la ${v}! Tengo cosas nuevas: ves a Claude trabajar en vivo, varias peticiones a la vez, una segunda opinión antes del PR y Claude arregla solo el CI de sus PRs.`, 'celebrate', 15000, {
          cat: 'pet', actions: [{ label: '✨ Ver novedades', cmd: 'whatsnew' }],
        });
      }
    }, 20000);

    // Monitor de sitios cada 2 min, logros cada 5 min, actualizaciones cada 6 h.
    if (!M.SAFE) {
      setTimeout(() => M.checkMonitors(false), 6000);
      setInterval(() => M.checkMonitors(true), 2 * 60 * 1000);
    }
    setTimeout(M.checkAchievements, 15000);
    setInterval(M.checkAchievements, 5 * 60 * 1000);
    if (!M.TEST) setTimeout(() => M.checkUpdates(false), 30000);
    setInterval(() => M.checkUpdates(false), 6 * 3600 * 1000);
  }

  function registerShortcuts() {
    // Paleta y captura rápida desde cualquier app.
    if (!M.globalShortcut.register('CommandOrControl+Alt+Space', M.openPalette)) {
      console.error('No se pudo registrar Ctrl+Alt+Espacio (¿lo usa otra app?)');
    }
    M.nativeTheme.on('updated', M.broadcast);
    if (!M.globalShortcut.register('CommandOrControl+Alt+P', M.openCapture)) {
      console.error('No se pudo registrar Ctrl+Alt+P (¿lo usa otra app?)');
    }
  }

  return { boot };
};

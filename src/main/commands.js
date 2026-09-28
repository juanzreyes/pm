// Todas las acciones (paleta, botones de los avisos, VS Code, MCP).
// Parte del proceso principal (antes en main.js). `M` es el contexto compartido de la app:
// da acceso a todo lo demás (ventanas, datos, funciones de otros módulos).
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  const COMMANDS = [
    { id: 'panel.chat', icon: '💬', label: 'Abrir el chat', kw: 'chat hablar preguntar', run: () => M.openPanel('chat') },
    { id: 'panel.usage', icon: '📊', label: 'Ver mi consumo de Claude', kw: 'uso limite tokens cuanto llevo reinicio', run: () => M.openPanel('usage') },
    { id: 'panel.day', icon: '📋', label: 'Ver mi día y tareas', kw: 'dia tareas pendientes', run: () => M.openPanel('day') },
    { id: 'panel.agenda', icon: '📬', label: 'Ver agenda, correo y GitHub', kw: 'agenda reuniones correo github sitios', run: () => M.openPanel('agenda') },
    { id: 'panel.profile', icon: '🐣', label: 'Ver mascota, logros y tienda', kw: 'perfil mascota logros tienda accesorios', run: () => M.openPanel('pet') },
    { id: 'inbox', icon: '🔔', label: 'Centro de avisos', kw: 'avisos notificaciones historial', run: () => M.openPanel('inbox') },
    { id: 'pomo.start', icon: '🍅', label: 'Empezar pomodoro (25 min)', kw: 'pomodoro enfoque concentrarme focus', when: () => !M.prod.pomoState(), run: () => M.prod.pomoStart() },
    { id: 'pomo.stop', icon: '⏹️', label: 'Detener pomodoro', kw: 'pomodoro parar', when: () => !!M.prod.pomoState(), run: () => M.prod.pomoStop() },
    { id: 'capture', icon: '✍️', label: 'Anotar tarea o recordatorio', kw: 'anotar tarea recordatorio nota', run: () => M.openCapture() },
    { id: 'daily', icon: '☀️', label: 'Hacer el daily', kw: 'daily standup plan manana', run: () => M.openPanel('standup') },
    { id: 'review', icon: '🌇', label: 'Cierre del día', kw: 'cierre revision fin del dia', run: () => M.openPanel('review') },
    { id: 'report.weekly', icon: '📊', label: 'Informe semanal', kw: 'informe reporte semana resumen', run: () => M.openPanel('report') },
    { id: 'daily.copy', icon: '📋', label: 'Copiar daily para Slack/Teams', kw: 'copiar daily slack teams', run: () => M.openPanel('daily-copy') },
    { id: 'stats', icon: '📈', label: 'Estadísticas del mes', kw: 'estadisticas graficos mes', run: () => M.openPanel('stats') },
    { id: 'join', icon: '🎧', label: 'Unirme a la próxima reunión', kw: 'reunion teams unirme meet zoom', when: () => !!M.nextJoinable(), run: () => { const e = M.nextJoinable(); if (e) M.joinMeeting(e.join.url); } },
    { id: 'game', icon: '🎮', label: 'Minijuego: atrapa el maíz', kw: 'juego jugar minijuego', run: () => M.openGame() },
    { id: 'feed', icon: '🌽', label: 'Dar de comer al pollito', kw: 'comer maiz alimentar', run: () => M.feed() },
    { id: 'pet', icon: '💛', label: 'Acariciar al pollito', kw: 'acariciar mimo', run: () => M.petPet() },
    { id: 'bath', icon: '🛁', label: 'Bañar al pollito', kw: 'banar bano limpiar ducha', run: () => {
      const p = M.store.data.pet;
      p.clean = 100; p.happiness = M.clamp(p.happiness + 5);
      M.store.save(); M.addXp(2);
      M.say('¡Qué fresquito! 🛁✨ Huelo a flores', 'bath', 7000, { log: false });
      M.broadcast();
    } },
    { id: 'nap', icon: '😴', label: 'Siesta del pollito (3 min)', kw: 'siesta dormir descansar energia', run: () => {
      const p = M.store.data.pet;
      p.napUntil = Date.now() + 3 * 60e3;
      p.energy = M.clamp((p.energy ?? 100) + 10);
      M.store.save();
      M.say('Zzz… despiértame si me necesitas 😴', 'yawn', 5000, { log: false });
      M.broadcast();
      setTimeout(() => { p.energy = M.clamp((p.energy ?? 100) + 30); M.store.save(); M.say('¡Qué buena siesta! ⚡ Energía recargada', 'hop', 6000, { log: false }); M.broadcast(); }, 3 * 60e3 + 500);
    } },
    { id: 'medicine', icon: '💊', label: 'Dar medicina (25 🌽)', kw: 'medicina curar enfermo', when: () => !!M.store.data.pet.sick, run: () => {
      const p = M.store.data.pet;
      if ((p.coins || 0) < 25) { M.say('No tenemos suficiente maíz para la medicina (25 🌽) 😿 Completa tareas o juega al minijuego.', 'sad', 8000, { log: false }); return; }
      p.coins -= 25; p.sick = false; p.happiness = M.clamp(p.happiness + 10);
      p.fullness = Math.max(p.fullness, 30); p.clean = Math.max(p.clean ?? 0, 40);
      M.store.save();
      M.say('💊 ¡Ya me siento mucho mejor! Gracias por cuidarme 💛', 'celebrate', 8000);
      M.broadcast();
    } },
    { id: 'mute', icon: '🔕', label: 'Silenciar 1 hora (reunión)', kw: 'silencio callar reunion no molestar', when: () => !M.isMuted(), run: () => { M.setMute(60); M.say('Shhh 🤫 Te dejo tranquilo 1 hora.', 'peck', 5000, { log: false }); } },
    { id: 'unmute', icon: '🔔', label: 'Quitar silencio', kw: 'silencio hablar', when: () => M.isMuted(), run: () => { M.setMute(0); M.say('¡Volví! 🐣', 'hop', 4000, { log: false }); } },
    { id: 'tracking.pause', icon: '⏸️', label: 'Pausar el seguimiento 1 hora (privacidad)', kw: 'privacidad pausar seguimiento vigilancia', when: () => !M.trackingPaused(), run: () => { M.pauseTracking(60); M.say('⏸️ Seguimiento en pausa 1 hora. No miro ninguna ventana 🙈', 'peck', 6000); } },
    { id: 'tracking.resume', icon: '▶️', label: 'Reanudar el seguimiento', kw: 'privacidad reanudar seguimiento', when: () => M.trackingPaused(), run: () => { M.pauseTracking(0); M.say('▶️ Seguimiento reanudado 👀', 'hop', 5000); } },
    { id: 'usage.refresh', icon: '↻', label: 'Actualizar consumo de Claude', kw: 'actualizar uso refrescar', run: () => M.refreshUsage(true) },
    { id: 'pet.toggle', icon: '🙈', label: 'Ocultar / mostrar el pollito', kw: 'ocultar esconder mostrar', run: () => { if (M.petWin.isVisible()) M.petWin.hide(); else M.petWin.showInactive(); if (M.tray) M.tray.refreshMenu(); } },
    { id: 'discreet', icon: '🫣', label: 'Modo discreto (esconderse en el borde)', kw: 'discreto borde esconder asomar', run: () => M.setDiscreet(!M.store.data.settings.discreet) },
    { id: 'theme', icon: '🌓', label: 'Cambiar tema claro / oscuro', kw: 'tema oscuro claro dark light', run: () => { const cur = M.isDark(); M.store.data.settings.theme = cur ? 'light' : 'dark'; M.store.save(); M.broadcast(); } },
    { id: 'size.s', icon: '🐤', label: 'Pollito pequeño', kw: 'tamano pequeno size small', run: () => M.setPetSize('s') },
    { id: 'size.m', icon: '🐥', label: 'Pollito mediano', kw: 'tamano mediano size medium', run: () => M.setPetSize('m') },
    { id: 'size.l', icon: '🐔', label: 'Pollito grande', kw: 'tamano grande size large', run: () => M.setPetSize('l') },
    { id: 'lang', icon: '🌐', label: 'Switch to English / Cambiar a español', kw: 'idioma language ingles espanol english', run: () => { M.store.data.settings.lang = M.lang() === 'en' ? 'es' : 'en'; M.store.save(); M.reloadUi(); } },
    { id: 'tour', icon: '🧭', label: 'Ver el tour de bienvenida', kw: 'tour ayuda guia tutorial', run: () => M.openPanel('tour') },
    { id: 'settings', icon: '⚙️', label: 'Ajustes', kw: 'ajustes configuracion opciones preferencias settings', run: () => M.openSettings() },
    { id: 'about', icon: 'ℹ️', label: 'Acerca de PM Pollito', kw: 'acerca de version creditos about', run: () => M.openAbout() },
    { id: 'prompts', icon: '📚', label: 'Biblioteca de prompts', kw: 'prompts plantillas biblioteca claude copiar', run: () => M.openPanel('prompts') },
    { id: 'blocks', icon: '🗓️', label: 'Planificar el día en bloques de tiempo', kw: 'bloques time blocking horario planificar calendario', run: () => M.openPanel('blocks') },
    { id: 'goals', icon: '🎯', label: 'Objetivos de la semana', kw: 'objetivos metas semana goals', run: () => M.openPanel('day#goals') },
    { id: 'habits', icon: '💧', label: 'Hábitos (agua, ejercicio, leer…)', kw: 'habitos agua ejercicio leer racha', run: () => M.openPanel('day#habits') },
    { id: 'habit.water', icon: '💧', label: 'Me bebí un vaso de agua (+1)', kw: 'agua vaso beber hidratar', run: () => M.ex.habitStep('water', 1) },
    { id: 'notes', icon: '🗒️', label: 'Notas rápidas del día', kw: 'notas apuntes nota rapida buscar', run: () => M.openPanel('day#notes') },
    { id: 'journal', icon: '🤖', label: 'Qué hice hoy con Claude Code', kw: 'diario claude code peticiones prompts hoy', run: () => M.openPanel('day#claude-journal') },
    { id: 'play.corn', icon: '🌽', label: 'Lanzarle maíz al pollito', kw: 'jugar lanzar maiz tirar comida', run: () => { M.sendPet('pet:play', 'corn'); setTimeout(M.feed, 1400); } },
    { id: 'play.ball', icon: '⚽', label: 'Jugar a la pelota con el pollito', kw: 'jugar pelota balon', run: () => { M.sendPet('pet:play', 'ball'); const p = M.store.data.pet; p.happiness = M.clamp(p.happiness + 8); p.energy = M.clamp((p.energy ?? 100) - 4); M.addXp(2); M.store.save(); M.broadcast(); } },
    { id: 'play.stroll', icon: '🚶', label: 'Pasear por la barra de tareas', kw: 'pasear caminar paseo barra', run: () => { if (!M.ex.stroll()) M.say('Ahora no puedo pasear 🙈', 'peck', 4000, { log: false }); } },
    { id: 'report.monthly', icon: '📄', label: 'Informe mensual en PDF', kw: 'informe mensual pdf mes reporte exportar', run: () => M.ex.monthlyPdf(null, 'current').catch((e) => M.say('No pude crear el PDF 😿 ' + e.message, 'sad', 8000)) },
    { id: 'backup.now', icon: '💾', label: 'Hacer copia de seguridad ahora', kw: 'copia seguridad backup respaldo onedrive drive', run: () => { const r = M.ex.backupNow(true); if (!r.ok) M.say('No pude hacer la copia 😿 ' + r.error, 'sad', 8000); } },
    { id: 'focus.start', icon: '🎯', label: 'Modo foco: no me distraigas (50 min)', kw: 'foco concentracion no molestar distraigas focus', when: () => !M.focusMode(), run: () => M.startFocus(50) },
    { id: 'focus.start25', icon: '🎯', label: 'Modo foco 25 min', kw: 'foco concentracion no molestar focus corto', when: () => !M.focusMode(), run: () => M.startFocus(25) },
    { id: 'focus.stop', icon: '🏁', label: 'Terminar el modo foco', kw: 'foco terminar parar salir focus', when: () => !!M.focusMode(), run: () => M.endFocus() },
    { id: 'recurring', icon: '🔁', label: 'Tareas recurrentes', kw: 'recurrentes repetir cada lunes todos los dias rutina', run: () => M.openPanel('day#recurring') },
    { id: 'templates', icon: '🧩', label: 'Plantillas de día', kw: 'plantilla dia foco reuniones bugs planificar', run: () => M.openPanel('blocks') },
    { id: 'diag', icon: '🩺', label: 'Diagnóstico y errores', kw: 'diagnostico errores memoria cpu problema fallo log', run: () => M.openSettings('diag') },
    { id: 'quit', icon: '❌', label: 'Cerrar PM', kw: 'salir cerrar quit', run: () => M.confirmQuit('paleta') },
    { id: 'claude.connect', icon: '🔌', label: 'Conectar el pollito con Claude Code (MCP, hooks y línea de estado)', kw: 'mcp claude code conectar integracion statusline linea de estado hooks', run: () => {
      try {
        M.setIntegration('hooks', true); M.setIntegration('mcpCode', true);
        if (!M.integrations.statusInfo().other) M.setIntegration('statusline', true);
        M.say('🔌 ¡Conectado con Claude Code! Reinicia tus sesiones de Claude para que me vean (herramientas pm_… y línea de estado).', 'celebrate', 12000, { cat: 'claude' });
      } catch (e) { M.say('No pude conectar con Claude Code 😿 ' + e.message, 'sad', 9000); }
    } },
    { id: 'claude.sessions', icon: '🎬', label: 'Sesiones de Claude en vivo', kw: 'sesiones claude vivo trabajando activas', run: () => M.openPanel('usage#live-sessions') },
    { id: 'project.memory', hidden: true, run: (repo) => { try { M.updateProjectMemory(repo); } catch (e) { M.say('😿 ' + e.message, 'sad', 7000); } } },
    { id: 'sync.now', icon: '🔄', label: 'Sincronizar con mis otros PCs', kw: 'sincronizar sync onedrive drive otro pc portatil', run: () => M.syncNow(true) },
    { id: 'export.md', icon: '📝', label: 'Exportar días a Markdown / Obsidian', kw: 'exportar markdown obsidian notas logseq', run: () => M.exportObsidian(true) },
    { id: 'export.ics', icon: '📅', label: 'Exportar los bloques de hoy a mi calendario (.ics)', kw: 'ics calendario outlook bloques exportar', run: () => M.exportBlocksIcs() },
    { id: 'profile', hidden: true, run: (id) => { try { M.switchProfile(id); } catch (e) { M.say('😿 ' + e.message, 'sad', 6000); } } },
    { id: 'pomo.toggle', hidden: true, run: () => (M.prod.pomoState() ? M.prod.pomoStop() : M.prod.pomoStart()) },
    { id: 'restart', icon: '🔄', label: 'Reiniciar PM', kw: 'reiniciar restart modo seguro', run: () => { M.quitHow = 'update'; M.markStopped('update'); M.writeBoot({ pending: false, fails: 0 }); M.app.relaunch(); M.app.quit(); } },
    { id: 'template.apply', hidden: true, run: (id) => M.ex.applyTemplate(id) },
    { id: 'day.prioritize', icon: '🧠', label: 'Priorizar mi día (ordenar tareas y reservar bloques)', kw: 'priorizar ordenar dia tareas plan ia', run: () => M.plan.prioritize(true) },
    { id: 'push.check', icon: '🔍', label: 'Revisar antes de hacer push', kw: 'push revisar git console.log secretos subir', run: async () => {
      const repos = require('../git').discover(M.prod.snapshot().git.roots || []);
      let any = false;
      for (const r of repos) { const x = await M.dev.prePushScan(r, false); if (x) any = true; }
      if (!any) M.say('No hay commits sin subir en tus repos ✨', 'peck', 5000, { log: false });
    } },
    { id: 'queue', icon: '🤖', label: 'Cola de peticiones para Claude', kw: 'cola claude peticiones pendientes queue', run: () => M.openPanel('day#claude-queue') },
    { id: 'queue.next', icon: '📋', label: 'Copiar la siguiente petición de la cola de Claude', kw: 'cola claude siguiente copiar', when: () => !!M.plan && M.plan.snapshot().claudeQueue.length > 0, run: (proj) => M.plan.queueNext(proj) },
    { id: 'milestones', icon: '🏁', label: 'Hitos de proyectos', kw: 'hitos entrega deadline proyecto fecha', run: () => M.openPanel('agenda#milestones') },
    { id: 'friday', icon: '📆', label: 'Revisión de la semana', kw: 'viernes revision semana cierre semanal plan lunes', run: () => M.openPanel('friday') },
    { id: 'home', icon: '🏡', label: 'Casita del pollito', kw: 'casa casita decorar muebles', run: () => M.openPanel('pet#home') },
    { id: 'collection', icon: '🥚', label: 'Huevos y colección', kw: 'huevos coleccion coleccionables', run: () => M.openPanel('pet#collection') },
    { id: 'diary', icon: '📜', label: 'Diario del pollito', kw: 'diario pollito entrada', run: () => M.openPanel('pet#diary') },
    { id: 'budget', icon: '💰', label: 'Presupuesto de Claude', kw: 'presupuesto gasto coste dinero claude', run: () => M.openPanel('usage#budget') },
    { id: 'commit.suggest', hidden: true, run: (dir) => M.dev.suggestCommit(dir) },
    { id: 'dev.failPrompt', hidden: true, run: () => M.dev.failPrompt() },
    { id: 'dev.failTask', hidden: true, run: () => M.dev.failTask() },
    { id: 'dev.failAsk', hidden: true, run: () => M.dev.failAsk() },
    { id: 'task.commit', hidden: true, run: (i) => M.plan.taskCommit(Number(i)) },
    { id: 'task.delegate', hidden: true, run: (i) => M.plan.taskDelegate(Number(i)) },
    { id: 'task.drop', hidden: true, run: (i) => M.plan.taskDrop(Number(i)) },
    { id: 'blocks', hidden: true, run: () => M.openPanel('blocks') },
    { id: 'whatsnew', hidden: true, run: () => M.openPanel('whatsnew') },
    { id: 'copy.text', hidden: true, run: (t) => { M.clipboard.writeText(String(t || '')); M.say(`📋 Copiado: ${String(t || '').slice(0, 40)}`, 'peck', 3500, { log: false }); } },
    { id: 'prompt.copy', hidden: true, run: (id) => M.ex.copyPrompt(id) },
    { id: 'clip.prompt', hidden: true, run: () => M.ex.clipPrompt() },
    { id: 'clip.task', hidden: true, run: () => M.ex.clipTask() },
    { id: 'clip.ask', hidden: true, run: () => M.ex.clipAsk() },
    { id: 'monthly.pdf', hidden: true, run: (which) => M.ex.monthlyPdf(null, which || 'prev').catch((e) => M.say('No pude crear el PDF 😿 ' + e.message, 'sad', 8000)) },
    { id: 'task.timer', hidden: true, run: (i) => M.taskTimer(Number(i), 'start') },
    { id: 'palette', hidden: true, run: () => M.openPalette() },
    // Ir a una sección del panel, p. ej. "day#reminders" (abre la pestaña y resalta la sección).
    { id: 'panel', hidden: true, run: (where) => M.openPanel(where || 'chat') },
    // Abrir el proyecto donde trabajó Claude (VS Code si está, si no el Explorador).
    { id: 'open.project', hidden: true, run: (dir) => M.openProject(dir) },
    { id: 'voice.test', hidden: true, run: () => {
      const n = M.store.data.pet.name || 'PM';
      if (M.petWin) M.petWin.webContents.send('pet:say', { text: M.T(`¡Hola! Soy ${n}, tu pollito PM. Así sueno 🐣`), anim: 'wave', ms: 6000, speak: true, lang: M.lang() });
    } },
    { id: 'lang-reload', hidden: true, run: () => M.reloadUi() },
    { id: 'settings.integrations', hidden: true, run: () => M.openSettings('integrations') },
    // Solo para botones de los avisos (no aparecen en la paleta):
    { id: 'focus.allow', hidden: true, run: () => M.say(M.allowCurrentDistraction(), 'judge', 7000, { log: false }) },
    { id: 'focus.ok', hidden: true, run: () => { M.fx.distractSince = Date.now(); M.fx.scoldLevel = 0; M.say('👍 ¡Confío en ti! 💪', 'hop', 4000, { log: false }); } },
    { id: 'forgive', hidden: true, run: () => { M.store.data.life.angryUntil = 0; M.store.flush(); M.say('Hmph… 😤 … bueno, está bien. Te perdono 💛', 'love', 7000, { log: false }); M.broadcast(); } },
    { id: 'ack', hidden: true, run: () => M.animate('hop') },
    { id: 'health.done', hidden: true, run: () => { M.addXp(3); M.say('¡Así me gusta! Cuerpo sano, código sano 💪 +3 XP', 'dance', 5000, { log: false }); } },
    { id: 'snooze.standup', hidden: true, run: () => { M.today().snoozeStandup = Date.now() + 30 * 60000; M.store.save(); M.say('¡Vale! Te vuelvo a preguntar en 30 minutos ⏰', 'peck', 5000, { log: false }); } },
    { id: 'snooze.review', hidden: true, run: () => { M.today().snoozeReview = Date.now() + 30 * 60000; M.store.save(); M.say('¡Vale! Te vuelvo a preguntar en 30 minutos ⏰', 'peck', 5000, { log: false }); } },
    { id: 'reminder.done', hidden: true, run: () => { M.addXp(2); M.animate('dance'); } },
    { id: 'reminder.snooze', hidden: true, run: (id) => {
      const r = (M.store.data.reminders || []).find((x) => x.id === id);
      if (r) { M.prod.addReminderAt(Date.now() + 10 * 60000, r.text); M.say(`⏰ Te lo recuerdo en 10 minutos: "${r.text}"`, 'peck', 5000, { log: false }); }
    } },
    { id: 'open.url', hidden: true, run: (url) => { if (/^https:\/\//.test(url || '')) (M.joinMeeting(url) || M.openSafeUrl(url)); } },
    // Cola de Claude que se ejecuta sola
    { id: 'queue.run', icon: '▶️', label: 'Ejecutar la siguiente petición de la cola con Claude', kw: 'cola claude ejecutar lanzar correr automatico worktree', when: () => (M.store.data.claudeQueue || []).some((q) => q.project), run: () => M.work.startRun('').then((r) => { if (!r.ok) M.say('😿 ' + r.error, 'sad', 8000, { log: false }); }) },
    { id: 'run.open', hidden: true, run: (id) => M.work.openRun(id) },
    { id: 'run.accept', hidden: true, run: (id) => M.work.acceptRun(id) },
    { id: 'run.pr', hidden: true, run: (id) => M.work.prRun(id) },
    { id: 'run.start', hidden: true, run: (id) => M.work.startRun(id).then((r) => { if (!r.ok) M.say('😿 ' + r.error, 'sad', 8000, { log: false }); }) },
    { id: 'run.discard', hidden: true, run: (id) => M.work.discardRun(id) },
    // Tickets del equipo
    { id: 'tickets.refresh', icon: '🎫', label: 'Ver mis tickets (Jira, GitHub, Linear, Azure DevOps)', kw: 'tickets jira issues linear azure devops asignados', run: () => { M.openPanel('day#tickets'); M.work.refreshTickets(true); } },
    { id: 'tickets.add.all', icon: '📥', label: 'Traer todos mis tickets a mi día', kw: 'tickets jira issues importar dia tareas', when: () => M.work.ticketsState().issues.some((i) => !i.inDay), run: () => M.work.addAllTickets() },
    { id: 'ticket.add', hidden: true, run: (key) => M.work.addTicket(key) },
    { id: 'ticket.open', hidden: true, run: (key) => M.work.openTicket(key) },
    // Canal del equipo
    { id: 'daily.post', icon: '📣', label: 'Publicar mi daily en el canal del equipo', kw: 'daily publicar slack teams discord canal equipo', when: () => !!M.store.data.settings.teamWebhook, run: () => M.remote.postDaily(true) },
    { id: 'weekly.post', icon: '📣', label: 'Publicar el informe semanal en el canal', kw: 'informe semanal publicar slack teams canal equipo', when: () => !!M.store.data.settings.teamWebhook, run: () => M.remote.postWeekly(true) },
    { id: 'settings.remote', hidden: true, run: () => M.openSettings('remote') },
    { id: 'team.import', icon: '👥', label: 'Importar la configuración del equipo (pm-equipo.json)', kw: 'equipo importar configuracion compartir jira webhook', run: () => M.team.importPack() },
    { id: 'team.export', icon: '📤', label: 'Exportar la configuración para el equipo', kw: 'equipo exportar configuracion compartir', run: () => M.openSettings('integrations') },
    { id: 'update.install', hidden: true, run: () => {
      const u = M.getUpdater();
      if (!u) return;
      M.quitHow = 'update'; // no cuenta como "me cerraste"
      M.quitting = true;
      setImmediate(() => u.quitAndInstall(true, true)); // instalación silenciosa y vuelve a abrirse
    } },
    { id: 'open.monitor', hidden: true, run: (id) => { const m = (M.store.data.settings.monitors || []).find((x) => x.id === id); if (m) M.shell.openExternal(m.url); } },
  ];

  return {
    COMMANDS,
  };
};

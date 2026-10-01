// Sincronizar, exportar, perfiles, comando pm, MCP y memoria de proyecto.
// Parte del proceso principal (antes en main.js). `M` es el contexto compartido de la app:
// da acceso a todo lo demás (ventanas, datos, funciones de otros módulos).
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  // ---------- sincronizar entre PCs ----------
  function syncDir() {
    return M.store.data.settings.syncDir || M.path.join(require('../backup').suggestDir(), 'sync');
  }
  function device() {
    const s = M.store.data.settings;
    if (!s.deviceId) { s.deviceId = require('crypto').randomBytes(6).toString('hex'); M.store.save(); }
    return { id: s.deviceId, name: M.os.hostname() };
  }
  let syncing = false;
  function syncNow(manual = false) {
    if (M.TEST) return null;
    if (syncing || (!manual && !M.store.data.settings.syncEnabled)) return null;
    syncing = true;
    try {
      // Lápidas de más de 90 días fuera.
      const t = M.store.data.tombstones || {};
      for (const [k, at] of Object.entries(t)) if (Date.now() - at > 90 * 864e5) delete t[k];
      const r = M.syncMod.run(syncDir(), M.store.data, device());
      if (r.from.length) {
        M.store.data = r.merged;
        M.store.save();
        M.broadcast();
        if (manual || r.from.length) M.say(`🔄 Sincronizado con ${r.from.join(', ')}`, 'hop', 6000, { log: false });
      } else {
        M.store.data.syncSeen = r.merged.syncSeen;
        if (manual) M.say('🔄 Todo al día: no hay cambios de otros PCs', 'peck', 5000, { log: false });
      }
      M.store.data.lastSyncAt = Date.now();
      M.store.save();
      return { ok: true, from: r.from };
    } catch (e) {
      M.diag.log('main', 'Sincronización: ' + e.message);
      if (manual) M.say('😿 No pude sincronizar: ' + e.message, 'sad', 8000);
      return { ok: false, error: e.message };
    } finally { syncing = false; }
  }

  // ---------- exportar ----------
  function journalForDay(k) {
    const [y, m, d] = k.split('-').map(Number);
    const a = new Date(y, m - 1, d).getTime();
    try { return M.journalMod.summarize(M.journalMod.prompts(a, a + 864e5)); } catch { return []; }
  }
  async function exportObsidian(chooseDir = true) {
    let dir = M.store.data.settings.markdownDir;
    if (chooseDir || !dir) {
      const r = await M.dialog.showOpenDialog(M.settingsWin && !M.settingsWin.isDestroyed() ? M.settingsWin : undefined, { title: 'Carpeta de tu bóveda de Obsidian (o cualquier carpeta)', defaultPath: dir || M.app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      dir = M.store.data.settings.markdownDir = r.filePaths[0];
      M.store.save();
    }
    const res = M.exporters.exportMarkdown(dir, M.store.data, 60, journalForDay);
    M.store.data.lastMarkdownAt = Date.now();
    M.store.save();
    if (chooseDir) { M.say(`📝 Exporté ${res.count} días a Markdown`, 'peck', 7000, { log: false }); M.shell.openPath(res.dir); }
    M.broadcast();
    return res;
  }
  async function exportBlocksIcs() {
    const blocks = M.today().blocks || [];
    if (!blocks.length) { M.say('Hoy no tienes bloques de tiempo que exportar 🗓️', 'peck', 5000, { log: false }); return null; }
    const r = await M.dialog.showSaveDialog({ title: 'Exportar bloques a calendario', defaultPath: M.path.join(M.app.getPath('downloads'), `bloques-${M.dayKey()}.ics`), filters: [{ name: 'Calendario', extensions: ['ics'] }] });
    if (r.canceled || !r.filePath) return null;
    M.fs.writeFileSync(r.filePath, M.exporters.icsBlocks(blocks, new Date()));
    M.shell.openPath(r.filePath); // Outlook / Calendario lo importan al abrirlo
    return r.filePath;
  }

  // ---------- perfiles ----------
  function switchProfile(id) {
    M.store.flush();
    M.profiles.switchTo(id, M.store.data.pet);
    M.quitHow = 'update';
    M.markStopped('update');
    M.app.relaunch();
    M.app.quit();
  }

  // ---------- línea de comandos "pm" ----------
  // Rutas según instalador normal o Microsoft Store (src/storepaths.js).
  const sp = require('../storepaths');
  function installPaths() {
    return sp.paths({ store: !!process.windowsStore, home: M.os.homedir(), localAppData: process.env.LOCALAPPDATA || M.path.join(M.os.homedir(), 'AppData', 'Local'), appDir: M.APP_DIR, execPath: process.execPath });
  }
  /** En la Store: copia los scripts a una carpeta estable (la del paquete cambia en cada versión). */
  function refreshStableScripts() {
    const p = installPaths();
    if (!p.store) return;
    try {
      M.fs.mkdirSync(p.cli.dir, { recursive: true });
      for (const [from, to] of p.copies) M.fs.copyFileSync(from, to);
    } catch (e) { M.diag.log('main', 'Scripts de la Store: ' + e.message); }
  }
  function cliPaths() {
    const p = installPaths();
    return { ...p.cli, exe: p.exe, store: p.store };
  }
  function cliInstalled() { try { return M.fs.readFileSync(cliPaths().file, 'utf8').includes('PM Pollito'); } catch { return false; } }
  function installCli(on) {
    const c = cliPaths();
    if (!on) { if (cliInstalled()) M.fs.unlinkSync(c.file); return false; }
    if (M.fs.existsSync(c.file) && !cliInstalled()) throw new Error('Ya existe otro comando "pm" en tu PC; no lo sobrescribo.');
    if (c.store) refreshStableScripts();
    M.fs.mkdirSync(c.dir, { recursive: true });
    M.fs.writeFileSync(c.file, sp.cliCmd(c.exe, c.script));
    // En la Store, Windows no deja a la app tocar tu PATH: te damos el comando para hacerlo una vez.
    if (!c.onPath) M.say(`⌨️ Comando "pm" listo en ${c.dir}. Para usarlo desde cualquier terminal, añade esa carpeta a tu PATH (una sola vez).`, 'peck', 20000, { cat: 'pet', actions: [{ label: '📋 Copiar comando de PowerShell', cmd: 'copy.text', arg: sp.pathCommand(c.dir) }] });
    return true;
  }

  // ---------- MCP del pollito: lo que Claude puede hacer ----------
  function mcpToken() {
    if (!M.store.data.settings.mcpToken) {
      M.store.data.settings.mcpToken = require('crypto').randomBytes(24).toString('hex');
      M.store.save();
    }
    return M.store.data.settings.mcpToken;
  }
  function repoByName(name) {
    const roots = M.prod.snapshot().git.roots || [];
    return require('../git').discover(roots).find((r) => M.path.basename(r).toLowerCase() === String(name || '').toLowerCase()) || null;
  }
  function completeTaskBy({ index, text, by }) {
    const list = (M.today().standup && M.today().standup.today) || [];
    let i = Number.isInteger(index) ? index : -1;
    if (i < 0 && text) i = list.findIndex((t) => !t.done && t.text.toLowerCase().includes(String(text).toLowerCase()));
    const t = list[i];
    if (!t) throw new Error('No encontré esa tarea. Usa pm_list_tasks para ver los índices.');
    if (!t.done) {
      t.done = true;
      if (t.startedAt) { t.spent = (t.spent || 0) + (Date.now() - t.startedAt) / 1000; delete t.startedAt; }
      if (!t.xp) { t.xp = true; M.addXp(10); }
      M.store.save();
      M.broadcast();
      if (by === 'telegram') M.say(`📱 Marcaste desde el celular: "${t.text}" ✅`, 'dance', 7000, { remote: false });
      else M.say(`🤖 Claude marcó como hecha: "${t.text}" ✅`, 'dance', 7000, { cat: 'claude' });
      M.work.onTaskDone(t);
      if (M.soul) M.soul.onTaskDone(t, list.every((x) => x.done));
    }
    return `Hecha: ${t.text}`;
  }
  async function mcpRun(name, a) {
    M.diag.log('info', `Claude usó ${name}`);
    const tasks = () => (M.today().standup && M.today().standup.today) || [];
    switch (name) {
      case 'pm_status': {
        const s = (M.usage.limits || []).find((l) => l.key === 'five_hour');
        const w = (M.usage.limits || []).find((l) => l.key === 'seven_day');
        const fc = M.usage.forecast && M.usage.forecast.five_hour;
        const t = tasks();
        const nextMeet = M.todaysMeetings().find((e) => e.start > Date.now());
        return {
          claude: {
            session: s ? { percent: Math.round(s.utilization), resetsAt: s.resetsAt } : null,
            weekly: w ? { percent: Math.round(w.utilization), resetsAt: w.resetsAt } : null,
            forecast: fc && fc.rate ? { ratePerHour: Math.round(fc.rate * 10) / 10, willHitLimit: !!fc.willHit, eta: fc.eta ? new Date(fc.eta).toISOString() : null } : null,
            budget: M.plan ? M.plan.budgetState() : null,
          },
          tasks: { done: t.filter((x) => x.done).length, total: t.length, pending: t.filter((x) => !x.done).map((x) => x.text) },
          pomodoro: M.prod.pomoState(), focusMode: M.focusMode(),
          meetingNow: M.meetingNow ? M.meetingNow.title || M.meetingNow.app : null,
          nextMeeting: nextMeet ? { title: nextMeet.title, start: new Date(nextMeet.start).toISOString() } : null,
          localTime: new Date().toString(),
        };
      }
      case 'pm_list_tasks':
        return tasks().map((t, i) => ({ index: i, text: t.text, done: !!t.done, priority: t.priority || null, time: t.time || null, postponedDays: M.plan ? M.plan.ageOf(t.text) : 0 }));
      case 'pm_add_task': {
        const text = String(a.text || '').trim().slice(0, 200);
        if (!text) throw new Error('Falta el texto de la tarea.');
        M.addTask(text);
        M.say(`🤖 Claude añadió una tarea: "${text}" 📌`, 'peck', 6000, { cat: 'claude' });
        return `Tarea añadida: ${text}`;
      }
      case 'pm_complete_task':
        return completeTaskBy(a);
      case 'pm_add_reminder': {
        const text = String(a.text || '').trim();
        const r = M.prod.capture(/^(recu[eé]rdame|av[ií]same|remind me)/i.test(text) ? text : `recuérdame ${text}`);
        if (!r || !/⏰/.test(r)) throw new Error('No entendí la hora. Ejemplos: "en 20 min revisar el deploy", "a las 17:00 enviar el informe".');
        return r;
      }
      case 'pm_queue_add':
        M.plan.queueAdd(String(a.text || ''), String(a.project || ''));
        return `En la cola (${M.plan.snapshot().claudeQueue.length} pendientes).`;
      case 'pm_queue_list':
        return M.plan.snapshot().claudeQueue.map((q, i) => ({ n: i + 1, text: q.text, project: q.project || null }));
      case 'pm_add_note': {
        const text = String(a.text || '').trim().slice(0, 2000);
        if (!text) throw new Error('Falta el texto.');
        const d = M.today();
        d.notes = (d.notes ? d.notes.replace(/\s*$/, '\n') : '') + `🤖 ${text}`;
        M.store.save();
        M.broadcast();
        return 'Nota añadida a las notas de hoy.';
      }
      case 'pm_log_progress': {
        const m = String(a.message || '').trim().slice(0, 200);
        if (m) M.say(`🤖 Claude: ${m}`, 'hop', 9000, { cat: 'claude' });
        return 'Mostrado al usuario.';
      }
      case 'pm_start_focus':
        M.startFocus(Math.max(5, Math.min(240, Number(a.minutes) || 50)));
        return 'Modo foco activado.';
      case 'pm_milestones':
        return M.plan.milestonesView().map((m) => ({ title: m.title, project: m.project || null, due: m.due, daysLeft: m.days, status: m.status, hoursSpent: m.spent, hoursEstimated: m.hours || null }));
      case 'pm_weekly_report':
        return M.prod.weeklyReport();
      case 'pm_tickets': {
        const tk = M.work.ticketsState();
        if (tk.status === 'off') return 'El usuario no tiene conectado ningún gestor de tickets (Ajustes → Integraciones → Tickets del equipo).';
        return { tickets: tk.issues.map((i) => ({ key: i.key, title: i.title, status: i.status, provider: i.provider, project: i.project, url: i.url, inTodayTasks: i.inDay })), errors: tk.errors.map((e) => `${e.label}: ${e.error}`) };
      }
      case 'pm_ticket_start':
      case 'pm_ticket_to_claude': {
        const want = String(a.key || '').trim().toLowerCase();
        const issue = M.work.ticketsState().issues.find((i) => i.key.toLowerCase() === want);
        if (!issue) throw new Error(`No encontré el ticket "${a.key}" entre los asignados. Usa pm_tickets para ver las claves.`);
        const r = name === 'pm_ticket_start' ? await M.work.startTicket(issue.key2, a.project || '') : await M.work.ticketToClaude(issue.key2, a.project || '');
        if (!r.ok) throw new Error(r.needRepo ? `${r.error} Indica "project" con el nombre de la carpeta del repositorio.` : r.error);
        return name === 'pm_ticket_start' ? `Trabajando en ${issue.key}: rama ${r.branch} en ${r.repo}${r.state ? `, ticket → ${r.state}` : ''}.` : `${issue.key} está en la cola de Claude.`;
      }
      case 'pm_queue_run': {
        const r = await M.work.startRun('');
        if (!r.ok) throw new Error(r.error);
        return 'Petición lanzada. Consulta pm_runs para ver cómo va.';
      }
      case 'pm_runs':
        return M.work.runsState().claudeRuns.map((r) => ({ project: r.project, request: r.text.slice(0, 200), status: r.status, files: r.stat ? r.stat.n : 0, tests: r.tests ? (r.tests.ok ? 'pasan' : 'fallan') : null, costUsd: r.cost || 0, pr: r.pr || null, ticket: r.issueKey || null }));
      case 'pm_project_memory': {
        const repo = repoByName(a.project);
        if (!repo) throw new Error(`No encontré el repositorio "${a.project}" en tus carpetas de git.`);
        return M.projmem.build(M.store.data, repo, (M.store.data.devLog || {})[M.path.basename(repo)] || []);
      }
      default:
        throw new Error('Herramienta desconocida');
    }
  }
  /** Texto de la línea de estado de Claude Code. */
  function statusLineText(data) {
    const parts = [];
    const s = (M.usage.limits || []).find((l) => l.key === 'five_hour');
    const face = M.isAngry() ? '😤' : M.store.data.pet.sick ? '🤒' : M.meetingNow ? '🎧' : '🐣';
    parts.push(s ? `${face} ${Math.round(s.utilization)}%${s.resetsAt ? ' ⏳' + M.brain.fmtUntil(s.resetsAt) : ''}` : face);
    const p = M.prod && M.prod.pomoState();
    if (p && p.endsAt) { const left = Math.max(0, Math.round((p.endsAt - Date.now()) / 1000)); parts.push(`${p.phase === 'focus' ? '🍅' : '☕'} ${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`); }
    if (M.focusMode()) parts.push('🎯 foco');
    const t = (M.today().standup && M.today().standup.today) || [];
    if (t.length) parts.push(`✅ ${t.filter((x) => x.done).length}/${t.length}`);
    const q = M.plan ? M.plan.snapshot().claudeQueue.length : 0;
    if (q) parts.push(`📋 ${q} en cola`);
    if (data && data.cost && typeof data.cost.total_cost_usd === 'number') parts.push(`💵 $${data.cost.total_cost_usd.toFixed(2)}`);
    if (data && data.model && data.model.display_name) parts.push(data.model.display_name);
    return M.T(parts.join(' · '));
  }
  function updateProjectMemory(repo) {
    if (!repo || !isRepo(repo)) throw new Error('No es un repositorio git.');
    const file = M.projmem.write(repo, M.projmem.build(M.store.data, repo, (M.store.data.devLog || {})[M.path.basename(repo)] || []));
    M.say(`🧠 Actualicé el CLAUDE.md de ${M.path.basename(repo)} con lo que sé del proyecto.`, 'read', 8000, { log: false, actions: [{ label: '📂 Abrir proyecto', cmd: 'open.project', arg: repo }] });
    return file;
  }
  function integrationsState() {
    return {
      mcpCode: M.integrations.mcpCodeInstalled(),
      mcpDesktop: M.integrations.mcpDesktopInstalled(),
      desktopAvailable: M.integrations.desktopAvailable(),
      statusline: M.integrations.statusInfo(),
      hooks: require('../claudeHooks').installed(),
    };
  }
  /** Ruta del puente MCP y ejecutable (fuera del .asar en la versión instalada). */
  function bridgePaths() {
    const p = installPaths();
    if (p.store) refreshStableScripts();
    return { exe: p.exe, bridge: p.bridge };
  }
  function setIntegration(what, on) {
    if (what === 'mcpCode') on ? M.integrations.installMcpCode(mcpToken()) : M.integrations.uninstallMcpCode();
    else if (what === 'mcpDesktop') { const b = bridgePaths(); on ? M.integrations.installMcpDesktop(mcpToken(), b.exe, b.bridge) : M.integrations.uninstallMcpDesktop(); }
    else if (what === 'statusline') on ? M.integrations.installStatusLine() : M.integrations.uninstallStatusLine();
    else if (what === 'hooks') on ? M.prod.hooksInstall() : M.prod.hooksUninstall();
    M.broadcast();
    return integrationsState();
  }

  // Capturas desde VS Code: texto normal, o acciones sobre la carpeta abierta.
  function isRepo(dir) {
    try { return !!M.fs.statSync(M.path.join(String(dir), '.git')); } catch { return false; }
  }
  function extCapture(text) {
    text = String(text || '');
    let m;
    if ((m = text.match(/^__commit__(.+)$/))) {
      if (!isRepo(m[1]) || !M.dev) return false;
      M.dev.suggestCommit(m[1]);
      return true;
    }
    if ((m = text.match(/^__pushcheck__(.+)$/))) {
      if (!isRepo(m[1]) || !M.dev) return false;
      M.dev.prePushScan(m[1], false).then((r) => { if (!r) M.say('No hay commits sin subir (o no tiene rama remota) ✨', 'peck', 5000, { log: false }); });
      return true;
    }
    return !!M.prod.capture(text);
  }

  return {
    syncDir,
    device,
    get syncing() { return syncing; },
    set syncing(v) { syncing = v; },
    syncNow,
    journalForDay,
    exportObsidian,
    exportBlocksIcs,
    switchProfile,
    cliPaths,
    cliInstalled,
    installCli,
    mcpToken,
    repoByName,
    completeTaskBy,
    mcpRun,
    statusLineText,
    updateProjectMemory,
    integrationsState,
    bridgePaths,
    refreshStableScripts,
    setIntegration,
    isRepo,
    extCapture,
  };
};

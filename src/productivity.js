// Funciones de productividad del pollito:
// pomodoro · recordatorios · salud (pausas, vista, agua) · tiempo por proyecto ·
// git (daily automático y avisos) · GitHub (PRs y CI) · eventos de Claude Code.
const path = require('path');
const git = require('./git');
const github = require('./github');
const reminders = require('./reminders');
const report = require('./report');
const claudeHooks = require('./claudeHooks');

const fmtDur = (secs) => {
  const m = Math.round(secs / 60);
  if (secs < 60) return `${Math.round(secs)} s`;
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const hm = (ms) => new Date(ms).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });

/**
 * ctx: { store, appDir, say(text, anim, ms, opts), animate, send(channel, data), pushChat, broadcast,
 *        addXp, isMuted, getMeeting, today, notify(title, body, onClick), openUrl, decrypt, encrypt, addTask, getUsage, petName }
 */
function create(ctx) {
  const S = () => ctx.store.data;
  let lastSample = null;

  // ================= POMODORO =================
  const POMO = { focus: 25, short: 5, long: 15 };
  let pomo = null; // { phase: 'focus' | 'break', endsAt, round, long }
  let round = 0;

  const pomoState = () => (pomo ? { phase: pomo.phase, endsAt: pomo.endsAt, round: pomo.round, long: !!pomo.long } : null);
  function pomoEmit() {
    ctx.send('pet:pomo', pomoState());
    ctx.broadcast();
  }
  function pomoStart() {
    round += 1;
    pomo = { phase: 'focus', endsAt: Date.now() + POMO.focus * 60e3, round };
    ctx.say(`🍅 ¡Pomodoro #${round} de ${POMO.focus} min! Modo concentración 😤 Nada de YouTube, ¿eh?`, 'hop', 8000);
    pomoEmit();
  }
  function pomoStop() {
    if (!pomo) return;
    pomo = null;
    ctx.say('Pomodoro detenido ⏹️', 'peck', 5000);
    pomoEmit();
  }
  function pomoTick() {
    if (!pomo || Date.now() < pomo.endsAt) return;
    if (pomo.phase === 'focus') {
      const day = ctx.today();
      day.pomodoros = (day.pomodoros || 0) + 1;
      ctx.store.save();
      ctx.addXp(10);
      const long = pomo.round % 4 === 0;
      const mins = long ? POMO.long : POMO.short;
      pomo = { phase: 'break', endsAt: Date.now() + mins * 60e3, round: pomo.round, long };
      ctx.say(`🍅 ¡Pomodoro completado! (${day.pomodoros} hoy · +10 XP)\nDescanso de ${mins} min: levántate y estírate 🧘`, 'celebrate', 12000);
      ctx.notify('🍅 ¡Pomodoro completado!', `Descanso de ${mins} minutos. ¡Estírate!`, () => ctx.command('panel', 'day#pomo-box'));
      if (ctx.onPomodoroDone) ctx.onPomodoroDone();
    } else {
      pomo = null;
      ctx.say('⏰ ¡Se acabó el descanso! ¿Otro pomodoro? Escríbeme "pomodoro" o clic derecho → 🍅', 'alarm-soft', 12000);
      ctx.notify('⏰ Fin del descanso', '¿Empezamos otro pomodoro?', () => ctx.command('panel', 'day#pomo-box'));
    }
    pomoEmit();
  }

  // ================= RECORDATORIOS =================
  function addReminder(text) {
    const r = reminders.parse(text);
    if (!r) return null;
    const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ...r, done: false };
    S().reminders = [...(S().reminders || []), item];
    ctx.store.save();
    ctx.broadcast();
    return item;
  }
  function addReminderAt(at, text) {
    const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at, text: String(text).slice(0, 200), done: false };
    S().reminders = [...(S().reminders || []), item];
    ctx.store.save();
    ctx.broadcast();
    return item;
  }
  function removeReminder(id) {
    (S().tombstones = S().tombstones || {})[id] = Date.now(); // para que no reaparezca al sincronizar
    S().reminders = (S().reminders || []).filter((r) => r.id !== id);
    ctx.store.save();
    ctx.broadcast();
  }
  function remindersTick() {
    const now = Date.now();
    let changed = false;
    for (const r of S().reminders || []) {
      if (r.done || r.at > now) continue;
      r.done = true;
      changed = true;
      ctx.say(`⏰ ¡Recordatorio! ${r.text}`, 'alarm', 30000, {
        actions: [
          { label: '✅ Hecho', cmd: 'reminder.done', arg: r.id },
          { label: '⏰ +10 min', cmd: 'reminder.snooze', arg: r.id },
        ],
      });
      ctx.notify('⏰ Recordatorio', r.text, () => ctx.command('panel', 'day#reminders'));
      ctx.pushChat('pet', `⏰ Recordatorio: ${r.text}`);
    }
    const before = (S().reminders || []).length;
    S().reminders = (S().reminders || []).filter((r) => !r.done || now - r.at < 864e5);
    if (changed || before !== S().reminders.length) { ctx.store.save(); ctx.broadcast(); }
  }

  /** Captura rápida (atajo de teclado o chat): recordatorio si tiene hora; si no, tarea. */
  function capture(text) {
    text = String(text || '').trim().slice(0, 300);
    if (!text) return null;
    // "cada lunes: …" → tarea recurrente
    if (ctx.captureHook) { const h = ctx.captureHook(text); if (h) return h; }
    const r = addReminder(text);
    if (r) {
      const when = new Date(r.at).toDateString() === new Date().toDateString() ? `hoy a las ${hm(r.at)}` : `el ${new Date(r.at).toLocaleDateString('es', { weekday: 'long' })} a las ${hm(r.at)}`;
      const msg = `⏰ ¡Anotado! Te recordaré "${r.text}" ${when}.`;
      ctx.say(msg, 'peck', 7000);
      return msg;
    }
    const clean = text.replace(/^(tarea|todo|anota|anotar)\s*:?\s*/i, '');
    ctx.addTask(clean);
    const msg = `📌 Tarea añadida: "${clean}"`;
    ctx.say(msg, 'peck', 6000);
    return msg;
  }

  // ================= SALUD =================
  let activeSince = null;
  let lastStretch = 0;
  let lastEyes = 0;
  let lastWater = 0;
  function health(s) {
    const now = Date.now();
    if (s.i >= 300) { activeSince = null; return; } // 5 min sin tocar nada = ya descansaste
    if (!activeSince) { activeSince = now; lastStretch = lastEyes = lastWater = now; }
    const h = S().settings.health || {};
    if (ctx.isMuted() || ctx.getMeeting() || pomo) return; // en reunión o pomodoro no interrumpe
    if (h.breaks !== false && now - lastStretch >= 50 * 60e3) {
      lastStretch = now;
      lastEyes = now;
      ctx.say('🧘 Llevas 50 min sin parar. Pausa activa: levántate, estira brazos y cuello 2 minutos. ¡Yo también! 🐣', 'stretch', 15000);
    } else if (h.eyes !== false && now - lastEyes >= 20 * 60e3) {
      lastEyes = now;
      ctx.say('👀 Regla 20-20-20: mira algo a 6 metros durante 20 segundos.', 'look', 9000, { quiet: true });
    } else if (h.water !== false && now - lastWater >= 90 * 60e3) {
      lastWater = now;
      ctx.say('💧 ¿Tomaste agua? ¡Hidrátate! 🥤', 'flap', 8000, { quiet: true });
    }
  }

  // ================= TIEMPO POR PROYECTO =================
  const APP_NAMES = {
    chrome: 'Navegador', msedge: 'Navegador', firefox: 'Navegador', opera: 'Navegador', brave: 'Navegador',
    excel: 'Excel', winword: 'Word', powerpnt: 'PowerPoint', 'ms-teams': 'Teams', teams: 'Teams', olk: 'Outlook', outlook: 'Outlook',
    slack: 'Slack', figma: 'Figma', notion: 'Notion', postman: 'Postman', claude: 'Claude', windowsterminal: 'Terminal',
  };
  function projectOf(s) {
    const t = s.t || '';
    const p = (s.p || '').toLowerCase();
    if (/^(code|code - insiders|cursor|windsurf|vscodium|zed)$/.test(p)) {
      const parts = t.split(' - ').map((x) => x.trim());
      if (parts.length >= 3) return parts[parts.length - 2].replace(/\s*\[.*?\]\s*/g, '').replace(/\s*\(.*?\)\s*$/, '');
      if (parts.length === 2) return parts[0];
    }
    if (/idea|pycharm|webstorm|rider|phpstorm|goland|clion|studio64|datagrip/.test(p)) return t.split(/\s[–-]\s/)[0].trim() || null;
    if (p === 'devenv') return t.split(' - ')[0].trim() || null;
    if (/windowsterminal|powershell|pwsh|cmd|bash|mintty|wezterm|alacritty/.test(p)) {
      const m = t.match(/[A-Za-z]:\\[^<>:"|?*\n]*|~\/[^\s]*|\/[\w.-]+(?:\/[\w.-]+)+/);
      if (m) return path.basename(m[0].replace(/[\\/]+$/, '')) || 'Terminal';
      return 'Terminal';
    }
    return APP_NAMES[p] || (p ? p.charAt(0).toUpperCase() + p.slice(1) : null);
  }
  function trackProject(s, cat, dt) {
    if (cat !== 'work') return;
    const name = ctx.getMeeting() ? 'Reuniones' : projectOf(s);
    if (!name) return;
    const day = ctx.today();
    day.projects = day.projects || {};
    day.projects[name] = (day.projects[name] || 0) + dt;
    if (ctx.trackBranch) ctx.trackBranch(name, dt);
  }

  // ================= GIT =================
  let gitState = { repos: 0, today: [], warnings: [], at: 0 };
  const gitWarned = {};
  const roots = () => {
    const r = S().settings.gitRoots;
    return Array.isArray(r) && r.length ? r : ctx.defaultGitRoots();
  };
  async function gitRefresh() {
    if (S().settings.gitWatch === false) { gitState = { repos: 0, today: [], warnings: [], at: Date.now(), off: true }; ctx.broadcast(); return; }
    const repos = git.discover(roots());
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const todayCommits = await git.commits(repos, start.getTime(), Date.now());
    const day = ctx.today();
    const prev = day.commits || 0;
    day.commits = todayCommits.length;
    if (todayCommits.length > prev) {
      ctx.addXp(2 * (todayCommits.length - prev));
      if (prev > 0 || gitState.at) {
        const c = todayCommits[todayCommits.length - 1];
        if (!ctx.isMuted() && !ctx.getMeeting()) ctx.say(`📦 ¡Commit en ${c.repo}! "${c.subject.slice(0, 50)}" (+2 XP)`, 'dance', 6000, { quiet: true });
      }
    }
    const now = Date.now();
    const warnings = [];
    const statuses = await Promise.all(repos.map((r) => git.status(r)));
    if (ctx.onGitStatuses) ctx.onGitStatuses(statuses.filter(Boolean), repos);
    for (const st of statuses) {
      if (!st || !st.changed) continue;
      const activeRecently = now - st.lastChangeAt < 2 * 3600e3;
      const sinceCommit = now - (st.lastCommitAt || st.lastChangeAt);
      if (activeRecently && sinceCommit >= 3 * 3600e3) {
        warnings.push({ repo: st.repo, text: `${st.changed} archivos sin commit desde hace ${fmtDur(sinceCommit / 1000)}` });
        if (!gitWarned[st.repo] || now - gitWarned[st.repo] > 2 * 3600e3) {
          gitWarned[st.repo] = now;
          if (!ctx.isMuted() && !ctx.getMeeting()) ctx.say(`💾 Llevas ${fmtDur(sinceCommit / 1000)} sin commit en ${st.repo} (${st.changed} archivos) 😬 ¡Guarda tu trabajo!`, 'alert', 11000, { target: { cmd: 'open.project', arg: st.path }, actions: [{ label: '📋 Mensaje de commit', cmd: 'commit.suggest', arg: st.path }, { label: '📂 Abrir proyecto', cmd: 'open.project', arg: st.path }] });
        }
      }
      if (/^(main|master)$/.test(st.branch) && now - st.lastChangeAt < 3600e3) {
        warnings.push({ repo: st.repo, text: `cambios directos en ${st.branch}` });
        const k = st.repo + '|main|' + new Date().toDateString();
        if (!gitWarned[k]) {
          gitWarned[k] = now;
          if (!ctx.isMuted() && !ctx.getMeeting()) ctx.say(`🌿 Ojo: estás haciendo cambios directo en ${st.branch} de ${st.repo}. ¿No toca una rama? 🤔`, 'judge', 10000, { target: { cmd: 'open.project', arg: st.path } });
        }
      }
    }
    gitState = { repos: repos.length, today: todayCommits.slice(-15), warnings, at: now };
    ctx.store.save();
    ctx.broadcast();
  }
  async function lastWorkdayCommits() {
    const { from, to } = git.lastWorkday();
    return git.commits(git.discover(roots()), from, to);
  }
  const commitsBetween = (from, to) => git.commits(git.discover(roots()), from, to);

  // ================= GITHUB =================
  let gh = { status: 'off' };
  let ghPrev = null;
  async function ghRefresh() {
    const tok = ctx.decrypt(S().settings.githubToken);
    if (!tok) { gh = { status: 'off' }; ghPrev = null; ctx.broadcast(); return gh; }
    try {
      const r = await github.fetchPRs(tok);
      const notes = github.diff(ghPrev, r);
      ghPrev = r;
      gh = { status: 'ok', ...r, at: Date.now() };
      for (const n of notes.slice(0, 3)) {
        ctx.say(n.text, n.anim, 11000, { cat: 'github', actions: [{ label: '🔗 Abrir en GitHub', cmd: 'open.url', arg: n.url }] });
        ctx.notify('GitHub', n.text, () => ctx.openUrl(n.url));
        ctx.pushChat('pet', n.text);
      }
    } catch (e) {
      gh = { status: 'error', error: e.message, at: Date.now() };
    }
    ctx.broadcast();
    return gh;
  }

  // ================= CLAUDE CODE =================
  const sessions = {}; // session_id -> { proj, since }
  const CLAUDE_FOREGROUND = /claude|windowsterminal|powershell|pwsh|cmd|code|cursor|idea|pycharm|webstorm/;
  function translate(msg) {
    const m = String(msg || '');
    let x;
    if ((x = m.match(/permission to use (.+)$/i))) return `necesita permiso para usar ${x[1]}`;
    if (/waiting for your input/i.test(m)) return 'está esperando tu respuesta';
    return m || 'quiere tu atención';
  }
  function onClaudeEvent(ev) {
    if (ctx.onClaudeRaw) ctx.onClaudeRaw(ev);
    const name = ev.hook_event_name;
    const sid = ev.session_id || 'default';
    const proj = ev.cwd ? path.basename(ev.cwd) : 'Claude Code';
    const looking = lastSample && CLAUDE_FOREGROUND.test((lastSample.p || '').toLowerCase()) && lastSample.i < 20;
    if (name === 'UserPromptSubmit') {
      sessions[sid] = { proj, since: Date.now() };
    } else if (name === 'Stop') {
      const s = sessions[sid];
      delete sessions[sid];
      const secs = s ? (Date.now() - s.since) / 1000 : 0;
      const day = ctx.today();
      day.claudeTasks = (day.claudeTasks || 0) + 1;
      ctx.store.save();
      const queued = ctx.onClaudeDone ? ctx.onClaudeDone(proj) : false;
      if (secs >= 20 && !queued) {
        if (looking) ctx.animate('hop');
        else ctx.say(`✅ ¡Claude terminó en ${proj}! (${fmtDur(secs)}) Ve a revisar 👀`, 'celebrate', 12000, {
          target: { cmd: 'open.project', arg: ev.cwd },
          actions: [{ label: '📂 Abrir proyecto', cmd: 'open.project', arg: ev.cwd }, { label: '👍 Visto', cmd: 'ack' }],
        });
        if (!looking) ctx.notify('✅ Claude terminó', `${proj} · ${fmtDur(secs)}`, () => ctx.command('open.project', ev.cwd));
      }
    } else if (name === 'Notification') {
      const txt = translate(ev.message);
      ctx.say(`🙋 Claude ${txt} (${proj})`, 'alert', 15000, {
        target: { cmd: 'open.project', arg: ev.cwd },
        actions: [{ label: '📂 Ir al proyecto', cmd: 'open.project', arg: ev.cwd }],
      });
      if (!looking) ctx.notify('🙋 Claude te necesita', `${proj}: ${txt}`, () => ctx.command('open.project', ev.cwd));
    }
    ctx.send('pet:claude', { working: Object.keys(sessions).length > 0 });
    ctx.broadcast();
  }
  // Si Claude se queda "trabajando" más de 30 min sin avisar, se da por terminado.
  function claudeTick() {
    let changed = false;
    for (const [k, s] of Object.entries(sessions)) if (Date.now() - s.since > 30 * 60e3) { delete sessions[k]; changed = true; }
    if (changed) ctx.send('pet:claude', { working: Object.keys(sessions).length > 0 });
  }
  function hooksInstall() { claudeHooks.install(); ctx.broadcast(); }
  function hooksUninstall() { claudeHooks.uninstall(); ctx.broadcast(); }

  // ================= INFORMES =================
  function weeklyReport() {
    const u = ctx.getUsage();
    return report.weekly(S(), { claude: { local: u.local, limits: u.limits }, name: ctx.petName(), goals: ctx.weekGoals ? ctx.weekGoals() : [] });
  }
  async function dailyText() {
    let commits = [];
    try { commits = await lastWorkdayCommits(); } catch { /* sin git */ }
    return report.daily(ctx.today(), new Date(), commits, { claudeToday: ctx.claudeToday ? await ctx.claudeToday() : [] });
  }
  const timesheet = () => report.timesheetCsv(S(), 30);

  // ================= MUESTRAS DEL VIGILANTE =================
  function onSample(s, cat, dt) {
    lastSample = s;
    health(s);
    trackProject(s, cat, dt);
  }

  // Durante un pomodoro los regaños llegan cada 2 min en vez de cada 10.
  const scoldStep = () => (pomo && pomo.phase === 'focus' ? 2 : 10);

  function snapshot() {
    const day = ctx.today();
    return {
      pomo: pomoState(),
      pomodorosToday: day.pomodoros || 0,
      reminders: (S().reminders || []).filter((r) => !r.done).sort((a, b) => a.at - b.at),
      git: { ...gitState, roots: roots() },
      github: { ...gh, hasToken: !!S().settings.githubToken },
      claudeCode: { installed: claudeHooks.installed(), working: Object.keys(sessions).length, tasksToday: day.claudeTasks || 0 },
      projectsToday: Object.entries(day.projects || {}).sort((a, b) => b[1] - a[1]).slice(0, 8),
      health: { breaks: true, eyes: true, water: true, ...(S().settings.health || {}) },
    };
  }

  function start(extApi) {
    claudeHooks.startServer(onClaudeEvent, extApi);
    setInterval(pomoTick, 2000);
    setInterval(remindersTick, 15000);
    setInterval(claudeTick, 60000);
    setTimeout(gitRefresh, 8000);
    setInterval(gitRefresh, 10 * 60e3);
    setTimeout(ghRefresh, 10000);
    setInterval(ghRefresh, 5 * 60e3);
  }

  return {
    start, snapshot, onSample, scoldStep,
    pomoStart, pomoStop, pomoState, isPomoFocus: () => !!(pomo && pomo.phase === 'focus'),
    capture, addReminder, addReminderAt, removeReminder,
    gitRefresh, lastWorkdayCommits, commitsBetween, ghRefresh,
    hooksInstall, hooksUninstall,
    weeklyReport, dailyText, timesheet, projectOf,
  };
}

module.exports = { create };

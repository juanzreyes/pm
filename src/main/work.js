// Trabajo en equipo: tickets de Jira / GitHub Issues / Linear / Azure DevOps y la cola de Claude
// que se ejecuta sola (worktree aparte + `claude -p`).
// Parte del proceso principal. `M` es el contexto compartido de la app.
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  const trackers = require('../trackers');
  const runner = require('../claudeRunner');
  const S = () => M.store.data;
  const set = () => S().settings;

  // =====================================================================
  // TICKETS
  // =====================================================================
  let tickets = { status: 'off', issues: [], errors: [], at: 0 };
  let ticketsBusy = false;

  /** Configuración con los tokens descifrados (solo vive en el proceso principal). */
  function trackerCfg() {
    const t = set().trackers || {};
    const cfg = {};
    if (t.github && t.github.on && set().githubToken) cfg.github = { token: M.decrypt(set().githubToken) };
    if (t.jira && t.jira.tokenEnc) cfg.jira = { site: t.jira.site, email: t.jira.email, token: M.decrypt(t.jira.tokenEnc) };
    if (t.linear && t.linear.tokenEnc) cfg.linear = { token: M.decrypt(t.linear.tokenEnc) };
    if (t.azure && t.azure.tokenEnc) cfg.azure = { org: t.azure.org, token: M.decrypt(t.azure.tokenEnc) };
    return cfg;
  }
  const anyTracker = () => Object.keys(trackerCfg()).some((p) => trackers.ready(p, trackerCfg()[p]));
  const todayTasks = () => (M.today().standup && M.today().standup.today) || [];
  const issueKey = (i) => `${i.provider}:${i.id}`;

  async function refreshTickets(announce = false) {
    if (ticketsBusy) return tickets;
    if (!anyTracker()) { tickets = { status: 'off', issues: [], errors: [], at: 0 }; return tickets; }
    ticketsBusy = true;
    try {
      const r = await trackers.fetchAll(trackerCfg());
      const seen = S().ticketsSeen || (S().ticketsSeen = {});
      const first = !Object.keys(seen).length;
      const fresh = r.issues.filter((i) => !seen[issueKey(i)]);
      for (const i of r.issues) seen[issueKey(i)] = seen[issueKey(i)] || Date.now();
      // Olvida los que ya no están asignados hace más de 60 días.
      for (const [k, at] of Object.entries(seen)) if (Date.now() - at > 60 * 864e5 && !r.issues.some((i) => issueKey(i) === k)) delete seen[k];
      M.store.save();
      tickets = { status: r.errors.length && !r.issues.length ? 'error' : 'ok', issues: r.issues, errors: r.errors, at: Date.now() };
      if (!first && !announce) {
        for (const i of fresh.slice(0, 3)) {
          M.say(`🎫 Te asignaron ${i.key}: "${i.title}"`, 'alert', 12000, {
            cat: 'tickets', actions: [{ label: '＋ A mi día', cmd: 'ticket.add', arg: issueKey(i) }, { label: '🔗 Abrir', cmd: 'ticket.open', arg: issueKey(i) }],
          });
        }
      }
      if (announce) {
        const err = r.errors.map((e) => `${e.label}: ${e.error}`).join(' · ');
        M.say(r.issues.length ? `🎫 Tienes ${r.issues.length} ticket${r.issues.length === 1 ? '' : 's'} asignado${r.issues.length === 1 ? '' : 's'}.${err ? ' ⚠️ ' + err : ''}` : err ? `😿 ${err}` : '🎫 No tienes tickets abiertos asignados. ¡Bandeja limpia!', r.issues.length ? 'celebrate' : 'peck', 8000, { log: false, target: { cmd: 'panel', arg: 'day#tickets' } });
      }
    } catch (e) {
      tickets = { ...tickets, status: 'error', errors: [{ provider: '', label: 'Tickets', error: e.message }], at: Date.now() };
      M.diag.log('main', 'Tickets: ' + e.message);
    } finally {
      ticketsBusy = false;
      M.broadcast();
    }
    return tickets;
  }

  function findIssue(key) {
    return tickets.issues.find((i) => issueKey(i) === key) || null;
  }
  /** Añade un ticket a las tareas de hoy (una sola vez). */
  function addTicket(key) {
    const i = typeof key === 'string' ? findIssue(key) : key;
    if (!i) return false;
    if (todayTasks().some((t) => trackers.sameIssue(t.issue, i))) return false;
    const day = M.today();
    if (!day.standup) day.standup = { yesterday: '', today: [], help: '', at: Date.now() };
    day.standup.today.push({ text: trackers.taskText(i), done: false, issue: trackers.link(i) });
    M.store.save();
    M.animate('peck');
    M.broadcast();
    return true;
  }
  function addAllTickets() {
    let n = 0;
    for (const i of tickets.issues) if (addTicket(i)) n++;
    M.say(n ? `🎫 Añadí ${n} ticket${n === 1 ? '' : 's'} a tu día.` : '🎫 Tus tickets ya estaban en tu día.', 'peck', 6000, { log: false });
    return n;
  }
  function openTicket(key) {
    const i = findIssue(key) || todayTasks().map((t) => t.issue).find((x) => x && issueKey(x) === key);
    if (i && /^https:\/\//.test(i.url)) M.shell.openExternal(i.url);
  }

  /** Una tarea con ticket se completó en PM: se cierra en su gestor y se carga el tiempo medido. */
  function onTaskDone(t) {
    if (!t || !t.issue || t.issueClosed || set().trackersClose === false) return;
    const cfg = trackerCfg();
    const issue = t.issue;
    if (!trackers.ready(issue.provider, cfg[issue.provider])) return;
    t.issueClosed = Date.now(); // no reintentar si la desmarcas y la vuelves a marcar
    M.store.save();
    (async () => {
      let logged = '';
      try {
        if (set().trackersLogTime !== false && (t.spent || 0) >= 60 && await trackers.logWork(issue, t.spent, cfg)) logged = ` · cargué ${Math.round(t.spent / 60)} min`;
      } catch (e) { logged = ` · no pude cargar las horas (${e.message})`; }
      try {
        const state = await trackers.complete(issue, cfg);
        M.say(`🎫 ${issue.key} → ${state}${logged}`, 'dance', 7000, { cat: 'tickets', log: true });
        tickets.issues = tickets.issues.filter((i) => !trackers.sameIssue(i, issue));
        M.broadcast();
      } catch (e) {
        delete t.issueClosed;
        M.store.save();
        M.say(`😿 No pude cerrar ${issue.key}: ${e.message}`, 'sad', 10000, { cat: 'tickets', actions: [{ label: '🔗 Abrir ticket', cmd: 'ticket.open', arg: issueKey(issue) }] });
      }
    })();
  }

  // ---------- ticket → trabajo ----------
  /** El ticket, esté en la lista de asignados o solo en una tarea de hoy. */
  function issueByKey(key) {
    return findIssue(key) || todayTasks().map((t) => t.issue).find((x) => x && issueKey(x) === key) || null;
  }
  /**
   * Repo donde se trabaja un ticket: el de GitHub es obvio; para Jira/Linear/Azure se recuerda por
   * proyecto la primera vez que lo eliges.
   */
  function ticketRepo(issue, repoName) {
    const map = set().ticketRepos || (set().ticketRepos = {});
    const mapKey = `${issue.provider}:${issue.project || ''}`;
    let name = repoName || map[mapKey] || (issue.provider === 'github' && issue.ref ? String(issue.ref.repo).split('/').pop() : '');
    const repo = name ? M.repoByName(name) : null;
    if (!repo) return null;
    name = M.path.basename(repo);
    if (repoName && map[mapKey] !== name) { map[mapKey] = name; M.store.save(); }
    return { repo, name };
  }

  /** Empezar un ticket: rama con su nombre, a tus tareas con el cronómetro en marcha y "en curso" en su gestor. */
  async function startTicket(key, repoName) {
    const issue = issueByKey(key);
    if (!issue) return { ok: false, error: 'No encontré ese ticket' };
    const r = ticketRepo(issue, repoName);
    if (!r) return { ok: false, needRepo: true, error: `¿En qué repo trabajas ${issue.key}?` };
    const branch = trackers.branchName(issue);
    try {
      const cur = await runner.git(r.repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
      if (cur !== branch) {
        const exists = await runner.git(r.repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).then(() => true, () => false);
        await runner.git(r.repo, exists ? ['checkout', branch] : ['checkout', '-b', branch]);
      }
    } catch (e) {
      return { ok: false, error: `No pude cambiar a la rama ${branch}: ${e.message}` };
    }
    addTicket(issue);
    const i = todayTasks().findIndex((t) => trackers.sameIssue(t.issue, issue));
    if (i >= 0 && !todayTasks()[i].startedAt) M.taskTimer(i, 'start');
    let state = null;
    try { state = await trackers.startProgress(issue, trackerCfg()); } catch (e) { M.diag.log('main', `Ticket ${issue.key} en curso: ${e.message}`); }
    M.say(`🎫 ¡A por ${issue.key}! Rama ${branch} en ${r.name}, cronómetro en marcha${state ? ` y el ticket pasó a "${state}"` : ''}.`, 'hop', 9000, { cat: 'tickets', log: true });
    M.broadcast();
    return { ok: true, branch, state, repo: r.name };
  }

  /** Mandar un ticket a Claude: petición en la cola con título, enlace y descripción. */
  async function ticketToClaude(key, repoName) {
    const issue = issueByKey(key);
    if (!issue) return { ok: false, error: 'No encontré ese ticket' };
    const r = ticketRepo(issue, repoName);
    if (!r) return { ok: false, needRepo: true, error: `¿En qué repo va ${issue.key}?` };
    let desc = '';
    try { desc = await trackers.details(issue, trackerCfg()); } catch (e) { M.diag.log('main', `Descripción de ${issue.key}: ${e.message}`); }
    const text = [`Ticket ${issue.key}: ${issue.title}`, issue.url || '', '', desc || '(El ticket no tiene descripción.)', '',
      'Resuélvelo en este repositorio. Si algo no está claro, haz lo más razonable y explícalo al final.'].join('\n');
    M.plan.queueAdd(text, r.name, { issue: trackers.link(issue) });
    const q = (S().claudeQueue || []).slice(-1)[0];
    M.say(`🤖 ${issue.key} está en la cola de Claude (${r.name}).`, 'peck', 9000, {
      cat: 'claude', log: false, actions: q ? [{ label: '▶ Que lo haga ya', cmd: 'run.start', arg: q.id }] : [], target: { cmd: 'panel', arg: 'day#claude-queue' },
    });
    return { ok: true, queueId: q && q.id };
  }

  /** Guarda la conexión de un gestor y la prueba. */
  async function saveTracker(provider, patch = {}) {
    if (!trackers.PROVIDERS[provider]) return { ok: false, error: 'Gestor desconocido' };
    const all = { ...(set().trackers || {}) };
    if (patch.remove) { delete all[provider]; set().trackers = all; M.store.flush(); await refreshTickets(); return { ok: true }; }
    const cur = { ...(all[provider] || {}) };
    if (provider === 'github') cur.on = patch.on !== false;
    if (provider === 'jira') { cur.site = String(patch.site || cur.site || '').trim().replace(/\/+$/, ''); cur.email = String(patch.email ?? cur.email ?? '').trim(); }
    if (provider === 'azure') cur.org = String(patch.org || cur.org || '').trim().replace(/\/+$/, '');
    if (patch.token) cur.tokenEnc = M.encrypt(String(patch.token).trim());
    if (provider === 'jira' && !/^https:\/\//.test(cur.site)) return { ok: false, error: 'La URL de Jira debe empezar por https:// (ej. https://tuempresa.atlassian.net)' };
    if (provider === 'azure' && !/^https:\/\//.test(cur.org)) return { ok: false, error: 'La URL debe ser la de tu organización (ej. https://dev.azure.com/tuempresa)' };
    if (provider === 'github' && !set().githubToken) return { ok: false, error: 'Primero pega tu token de GitHub (más abajo, en GitHub).' };
    all[provider] = cur;
    set().trackers = all;
    M.store.flush();
    await refreshTickets();
    const err = tickets.errors.find((e) => e.provider === provider);
    if (err) return { ok: false, error: err.error };
    return { ok: true, count: tickets.issues.filter((i) => i.provider === provider).length };
  }

  function ticketsState() {
    const t = set().trackers || {};
    return {
      ...tickets,
      issues: tickets.issues.map((i) => ({ ...i, key2: issueKey(i), inDay: todayTasks().some((x) => trackers.sameIssue(x.issue, i)) })),
      providers: {
        github: { on: !!(t.github && t.github.on), hasToken: !!set().githubToken },
        jira: { site: (t.jira && t.jira.site) || '', email: (t.jira && t.jira.email) || '', has: !!(t.jira && t.jira.tokenEnc) },
        linear: { has: !!(t.linear && t.linear.tokenEnc) },
        azure: { org: (t.azure && t.azure.org) || '', has: !!(t.azure && t.azure.tokenEnc) },
      },
      close: set().trackersClose !== false,
      logTime: set().trackersLogTime !== false,
    };
  }

  // =====================================================================
  // COLA DE CLAUDE QUE SE EJECUTA SOLA
  // =====================================================================
  const runs = () => (S().claudeRuns = S().claudeRuns || []);
  const live = {}; // id → { kill }
  const runById = (id) => runs().find((r) => r.id === id);
  const busy = () => runs().some((r) => ['starting', 'running', 'testing'].includes(r.status));
  const claudeBin = () => runner.findClaude(set().claudeBin);
  const shortText = (s, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function saveRuns() {
    // Se guardan las 20 últimas; las que esperan revisión nunca se pierden.
    const list = runs();
    if (list.length > 20) S().claudeRuns = list.filter((r, i) => r.status === 'review' || r.status === 'failed' || i >= list.length - 20);
    M.store.save();
    M.broadcast();
  }

  /** Lanza una petición de la cola. */
  async function startRun(queueId) {
    const q = (S().claudeQueue || []).find((x) => x.id === queueId) || (queueId ? null : nextRunnable());
    if (!q) return { ok: false, error: 'Esa petición ya no está en la cola' };
    if (busy()) return { ok: false, error: 'Ya estoy ejecutando otra petición; esta va después' };
    const bin = claudeBin();
    if (!bin) {
      M.say('😿 No encontré Claude Code en este PC. Instálalo (npm i -g @anthropic-ai/claude-code) o indica dónde está en Ajustes → Integraciones.', 'sad', 12000, { cat: 'claude', actions: [{ label: '⚙️ Ajustes', cmd: 'settings.integrations' }] });
      return { ok: false, error: 'No encontré Claude Code' };
    }
    const repo = q.project ? M.repoByName(q.project) : null;
    if (!repo) return { ok: false, error: q.project ? `No encontré el repo "${q.project}" en tus carpetas de git` : 'Elige el proyecto de la petición para poder ejecutarla' };
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    /** @type {Record<string, any>} */
    const run = { id, queueId: q.id, text: q.text, project: q.project, repo, status: 'starting', startedAt: Date.now(), ...(q.issue ? { issue: q.issue } : {}) };
    runs().push(run);
    M.plan.queueRemove(q.id);
    saveRuns();
    try {
      Object.assign(run, await runner.prepare(repo, id, M.path.join(M.app.getPath('userData'), 'worktrees')));
    } catch (e) {
      Object.assign(run, { status: 'failed', error: 'No pude crear el worktree: ' + e.message, endedAt: Date.now() });
      saveRuns();
      M.say(`😿 No pude preparar "${shortText(q.text)}": ${e.message}`, 'sad', 10000, { cat: 'claude' });
      return { ok: false, error: run.error };
    }
    run.status = 'running';
    saveRuns();
    M.sendPet('pet:claude', { working: true, project: q.project });
    M.say(`🤖 Empiezo con "${shortText(q.text)}" en ${q.project}. Trabajo en una copia aparte: tu carpeta no se toca.`, 'peck', 7000, { log: false });
    const permission = set().claudeRunPermission === 'bypassPermissions' ? 'bypassPermissions' : 'acceptEdits';
    const budgetUsd = Math.max(0, Math.min(100, Number(set().claudeRunBudget) || 0)); // tope en dólares por petición (0 = sin tope)
    const job = runner.launch({ bin, cwd: run.dir, prompt: q.text, permission, budgetUsd });
    live[id] = job;
    job.promise.then((r) => finishRun(run, r));
    return { ok: true, id };
  }

  async function finishRun(run, r) {
    delete live[run.id];
    M.sendPet('pet:claude', { working: false, project: run.project });
    Object.assign(run, { endedAt: Date.now(), result: (r.result || '').slice(0, 2000), cost: r.cost || 0, sessionId: r.sessionId || '', turns: r.turns || 0 });
    let stat = { files: [], ins: 0, del: 0 };
    try { stat = await runner.changes(run.dir); } catch (e) { M.diag.log('main', 'Cambios del worktree: ' + e.message); }
    run.stat = { files: stat.files.slice(0, 50), n: stat.files.length, ins: stat.ins, del: stat.del };
    // Tests antes de avisarte: así no revisas trabajo roto.
    if (stat.files.length && set().claudeRunTests !== false) {
      run.status = 'testing';
      saveRuns();
      try { run.tests = await runner.runTests(run.dir); } catch (e) { run.tests = { ok: false, label: 'tests', tail: e.message }; }
    }
    const mins = Math.max(1, Math.round((Date.now() - run.startedAt) / 60e3));
    const testsTxt = run.tests ? (run.tests.ok ? ` · ✅ ${run.tests.label} pasa` : ` · ⚠️ ${run.tests.label} FALLA`) : '';
    if (!r.ok) {
      run.status = 'failed';
      run.error = r.error || 'Falló';
      M.say(`😿 Claude falló con "${shortText(run.text)}" en ${run.project}: ${run.error}`, 'sad', 15000, {
        cat: 'claude', actions: [...(stat.files.length ? [{ label: '👀 Ver lo que hizo', cmd: 'run.open', arg: run.id }] : []), { label: '🗑️ Descartar', cmd: 'run.discard', arg: run.id }],
      });
    } else if (!stat.files.length) {
      run.status = 'empty';
      await runner.discard(run).catch(() => {});
      M.say(`🤖 Terminé "${shortText(run.text)}" en ${run.project} sin cambiar archivos (${mins} min). Dijo: ${shortText(run.result || '—', 160)}`, 'celebrate', 15000, { cat: 'claude', target: { cmd: 'panel', arg: 'day#claude-runs' } });
    } else {
      run.status = 'review';
      M.say(`🤖 Terminé "${shortText(run.text)}" en ${run.project}: ${stat.files.length} archivo${stat.files.length === 1 ? '' : 's'} (+${stat.ins} −${stat.del}) en ${mins} min${testsTxt}. Revisa y decide.`, run.tests && !run.tests.ok ? 'alert' : 'celebrate', 20000, {
        cat: 'claude', urgent: true, target: { cmd: 'panel', arg: 'day#claude-runs' },
        actions: [{ label: '👀 Ver cambios', cmd: 'run.open', arg: run.id }, ...(prReady(run) ? [{ label: '🚀 Crear PR', cmd: 'run.pr', arg: run.id }] : [{ label: '✅ Aceptar', cmd: 'run.accept', arg: run.id }]), { label: '🗑️ Descartar', cmd: 'run.discard', arg: run.id }],
      });
    }
    saveRuns();
    if (set().claudeAutoRun) setTimeout(autoTick, 3000);
  }

  async function acceptRun(id) {
    const run = runById(id);
    if (!run || !['review', 'failed'].includes(run.status)) return { ok: false, error: 'Nada que aceptar' };
    try {
      const branch = await runner.accept(run);
      run.status = 'accepted';
      saveRuns();
      const cmd = `git merge ${branch}`;
      M.say(`✅ Guardado en la rama ${branch} de ${run.project}. Mézclala cuando quieras: ${cmd}`, 'celebrate', 15000, {
        cat: 'claude', log: true, actions: [{ label: '📋 Copiar comando', cmd: 'copy.text', arg: cmd }, { label: '📂 Ir al proyecto', cmd: 'open.project', arg: run.repo }],
      });
      return { ok: true, branch };
    } catch (e) {
      M.say(`😿 No pude guardar los cambios: ${e.message}`, 'sad', 10000, { cat: 'claude' });
      return { ok: false, error: e.message };
    }
  }
  // ---------- pull request ----------
  /** ¿Se puede abrir un PR? (token de GitHub y el repo tiene su origin en GitHub) */
  function prReady(run) {
    return !!set().githubToken && !!run.repo && !!remoteOf(run.repo);
  }
  const remotes = {};
  function remoteOf(repo) {
    if (!(repo in remotes)) {
      try { remotes[repo] = runner.githubRepoOf(require('child_process').execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).toString()); } catch { remotes[repo] = null; }
    }
    return remotes[repo];
  }
  /** Aceptar + subir la rama + abrir el PR en GitHub (contra la rama en la que estabas). */
  async function prRun(id) {
    const run = runById(id);
    if (!run || !['review', 'failed', 'accepted'].includes(run.status)) return { ok: false, error: 'Nada que publicar' };
    const gh = remoteOf(run.repo);
    if (!gh) return { ok: false, error: 'El repo no tiene su "origin" en GitHub' };
    if (!set().githubToken) return { ok: false, error: 'Falta tu token de GitHub (Ajustes → Integraciones → GitHub)' };
    try {
      if (run.status !== 'accepted') { await runner.accept(run, prTitle(run)); run.status = 'accepted'; saveRuns(); }
      M.say(`🚀 Subiendo ${run.branch} y abriendo el PR…`, 'peck', 6000, { log: false });
      await runner.pushBranch(run.repo, run.branch);
      const url = await runner.openPR({
        ...gh, token: M.decrypt(set().githubToken), head: run.branch, base: run.base || 'main', title: prTitle(run), body: prBody(run),
      });
      run.status = 'pr';
      run.pr = url;
      saveRuns();
      M.say(`🚀 PR abierto en ${run.project}: ${prTitle(run)}`, 'celebrate', 15000, { cat: 'claude', log: true, actions: [{ label: '🔗 Ver PR', cmd: 'open.url', arg: url }], target: { cmd: 'open.url', arg: url } });
      return { ok: true, url };
    } catch (e) {
      saveRuns();
      M.say(`😿 No pude abrir el PR: ${e.message}`, 'sad', 12000, { cat: 'claude' });
      return { ok: false, error: e.message };
    }
  }
  function prTitle(run) {
    const first = run.text.split('\n').find((l) => l.trim()) || 'Cambios de Claude';
    return (run.issue && !first.includes(run.issue.key) ? `[${run.issue.key}] ` : '') + first.replace(/^#+\s*/, '').slice(0, 90);
  }
  function prBody(run) {
    const L = [];
    if (run.issue) L.push(`Ticket: ${run.issue.url ? `[${run.issue.key}](${run.issue.url})` : run.issue.key}`, '');
    L.push('### Qué se pidió', '', '> ' + run.text.slice(0, 1500).split('\n').join('\n> '), '');
    if (run.result) L.push('### Lo que dice Claude', '', run.result.slice(0, 3000), '');
    if (run.tests) L.push('### Tests', '', `${run.tests.ok ? '✅' : '⚠️'} \`${run.tests.label}\` ${run.tests.ok ? 'pasa' : 'falla'}`, ...(run.tests.ok ? [] : ['', '```', run.tests.tail.slice(-1500), '```']), '');
    L.push(`---`, `_Hecho por Claude Code desde la cola de PM Pollito 🐣${run.cost ? ` · $${run.cost.toFixed(2)}` : ''}_`);
    return L.join('\n');
  }

  async function discardRun(id) {
    const run = runById(id);
    if (!run) return { ok: false };
    if (live[id]) live[id].kill();
    await runner.discard(run).catch(() => {});
    run.status = 'discarded';
    saveRuns();
    M.say(`🗑️ Descartado: "${shortText(run.text)}"`, 'peck', 5000, { log: false });
    return { ok: true };
  }
  function openRun(id) {
    const run = runById(id);
    if (run && run.dir && M.fs.existsSync(run.dir)) M.openProject(run.dir);
    else if (run) M.openProject(run.repo);
  }
  function stopRun(id) {
    if (live[id]) live[id].kill();
  }
  function clearRuns() {
    S().claudeRuns = runs().filter((r) => ['running', 'starting', 'testing', 'review', 'failed'].includes(r.status));
    saveRuns();
  }

  /** Siguiente petición que se puede ejecutar sola (tiene proyecto y su repo existe). */
  function nextRunnable() {
    return (S().claudeQueue || []).find((q) => q.project && M.repoByName(q.project)) || null;
  }
  /** Modo automático: si no hay nada en marcha, lanza la siguiente. */
  function autoTick() {
    if (M.TEST || !set().claudeAutoRun || busy()) return;
    // Nunca más de 3 esperando revisión: que no se acumule trabajo sin mirar.
    if (runs().filter((r) => r.status === 'review').length >= 3) return;
    const q = nextRunnable();
    if (q) startRun(q.id);
  }

  /** Al arrancar: lo que quedó a medias cuando se cerró PM. */
  function recover() {
    let n = 0;
    for (const r of runs()) {
      if (r.status === 'testing') { r.status = 'review'; n++; continue; } // Claude ya había terminado: solo faltaban los tests
      if (r.status === 'running' || r.status === 'starting') { r.status = 'failed'; r.error = 'PM se cerró mientras Claude trabajaba'; r.endedAt = Date.now(); n++; }
    }
    if (n) M.store.save();
  }

  function runsState() {
    return {
      claudeRuns: runs().slice(-10).reverse().map((r) => ({ id: r.id, text: r.text, project: r.project, status: r.status, startedAt: r.startedAt, endedAt: r.endedAt, stat: r.stat, cost: r.cost, error: r.error, result: r.result ? r.result.slice(0, 400) : '', sessionId: r.sessionId, branch: r.branch, tests: r.tests ? { ok: r.tests.ok, label: r.tests.label, tail: r.tests.ok ? '' : r.tests.tail } : null, pr: r.pr || '', issueKey: r.issue ? r.issue.key : '', prReady: prReady(r) })),
      claudeRunner: { bin: claudeBin(), auto: !!set().claudeAutoRun, tests: set().claudeRunTests !== false, budget: Number(set().claudeRunBudget) || 0, permission: set().claudeRunPermission === 'bypassPermissions' ? 'bypassPermissions' : 'acceptEdits', busy: busy() },
    };
  }

  function start() {
    recover();
    if (M.TEST) return;
    setTimeout(() => refreshTickets(), 12000);
    setInterval(() => refreshTickets(), 10 * 60e3);
    setInterval(autoTick, 60e3);
  }

  return {
    refreshTickets, addTicket, addAllTickets, openTicket, onTaskDone, saveTracker, ticketsState,
    startRun, acceptRun, prRun, discardRun, openRun, stopRun, clearRuns, runsState, start,
    startTicket, ticketToClaude, ticketRepo,
  };
};

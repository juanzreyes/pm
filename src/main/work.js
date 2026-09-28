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

  // La cola de Claude que se ejecuta sola vive en src/main/claudequeue.js.
  const queue = require('./claudequeue')(M);

  function start() {
    queue.start();
    if (M.TEST) return;
    setTimeout(() => refreshTickets(), 12000);
    setInterval(() => refreshTickets(), 10 * 60e3);
  }

  return {
    refreshTickets, addTicket, addAllTickets, openTicket, onTaskDone, saveTracker, ticketsState,
    ...queue, start,
    startTicket, ticketToClaude, ticketRepo,
  };
};

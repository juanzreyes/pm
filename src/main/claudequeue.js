// La cola de Claude que se ejecuta sola: cada petición en su copia del repo (git worktree), varias a la
// vez, con progreso en vivo, tests y una segunda opinión antes de avisarte; aceptar, PR y, después,
// vigilar el PR: si el CI falla o piden cambios en la revisión, Claude lo arregla en la misma rama.
// Parte del proceso principal (antes en src/main/work.js). `M` es el contexto compartido de la app.
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  const runner = require('../claudeRunner');
  const prwatch = require('../prwatch');
  const S = () => M.store.data;
  const set = () => S().settings;

  const runs = () => (S().claudeRuns = S().claudeRuns || []);
  const live = {}; // id → { kill }
  const runById = (id) => runs().find((r) => r.id === id);
  const ACTIVE = ['starting', 'running', 'testing', 'reviewing'];
  const active = () => runs().filter((r) => ACTIVE.includes(r.status)).length;
  const limit = () => Math.max(1, Math.min(3, Number(set().claudeParallel) || 2)); // cuántas a la vez
  const busy = () => active() >= limit();
  const claudeBin = () => runner.findClaude(set().claudeBin);
  const shortText = (s, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  // Temporizador que no mantiene vivo el proceso (tests y cierre de la app).
  const later = (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; };
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const worktrees = () => M.path.join(M.app.getPath('userData'), 'worktrees');
  const permission = () => (set().claudeRunPermission === 'bypassPermissions' ? 'bypassPermissions' : 'acceptEdits');
  const budget = () => Math.max(0, Math.min(100, Number(set().claudeRunBudget) || 0)); // 0 = sin tope
  const reviewBudget = () => (budget() > 0 ? Math.min(1, budget()) : 1);
  const maxFixes = () => Math.max(0, Math.min(5, set().claudeMaxFixes ?? 2));
  const KEEP = new Set(['review', 'failed', 'running', 'starting', 'testing', 'reviewing']);

  function saveRuns() {
    // Se guardan las 30 últimas; lo que espera algo de ti (o un PR abierto) nunca se pierde.
    const list = runs();
    if (list.length > 30) S().claudeRuns = list.filter((r, i) => KEEP.has(r.status) || (r.status === 'pr' && r.prState !== 'merged' && r.prState !== 'closed') || i >= list.length - 30);
    M.store.save();
    M.broadcast();
  }
  // Progreso en vivo: como mucho un repintado por segundo.
  let progressTimer = null;
  function broadcastSoon() {
    if (progressTimer) return;
    progressTimer = setTimeout(() => { progressTimer = null; M.broadcast(); }, 1000);
  }
  const petWorking = () => M.sendPet('pet:claude', { working: active() > 0 });
  const onProgress = (run) => (p) => { run.progress = { ...p, at: Date.now() }; broadcastSoon(); };

  function needBin() {
    const bin = claudeBin();
    if (!bin) M.say('😿 No encontré Claude Code en este PC. Instálalo (npm i -g @anthropic-ai/claude-code) o indica dónde está en Ajustes → Integraciones.', 'sad', 12000, { cat: 'claude', actions: [{ label: '⚙️ Ajustes', cmd: 'settings.integrations' }] });
    return bin;
  }

  // =====================================================================
  // PETICIONES DE LA COLA
  // =====================================================================
  /** Lanza una petición de la cola. */
  async function startRun(queueId) {
    const q = (S().claudeQueue || []).find((x) => x.id === queueId) || (queueId ? null : nextRunnable());
    if (!q) return { ok: false, error: 'Esa petición ya no está en la cola' };
    if (busy()) return { ok: false, error: `Ya hay ${active()} en marcha (máximo ${limit()} a la vez); esta va después` };
    const bin = needBin();
    if (!bin) return { ok: false, error: 'No encontré Claude Code' };
    const repo = q.project ? M.repoByName(q.project) : null;
    if (!repo) return { ok: false, error: q.project ? `No encontré el repo "${q.project}" en tus carpetas de git` : 'Elige el proyecto de la petición para poder ejecutarla' };
    const id = newId();
    /** @type {Record<string, any>} */
    const run = { id, queueId: q.id, text: q.text, project: q.project, repo, status: 'starting', startedAt: Date.now(), ...(q.issue ? { issue: q.issue } : {}) };
    runs().push(run);
    M.plan.queueRemove(q.id);
    saveRuns();
    try {
      Object.assign(run, await runner.prepare(repo, id, worktrees()));
    } catch (e) {
      Object.assign(run, { status: 'failed', error: 'No pude crear el worktree: ' + e.message, endedAt: Date.now() });
      saveRuns();
      M.say(`😿 No pude preparar "${shortText(q.text)}": ${e.message}`, 'sad', 10000, { cat: 'claude' });
      return { ok: false, error: run.error };
    }
    run.status = 'running';
    saveRuns();
    petWorking();
    M.say(`🤖 Empiezo con "${shortText(q.text)}" en ${q.project}. Trabajo en una copia aparte: tu carpeta no se toca.`, 'peck', 7000, { log: false });
    const job = runner.launch({ bin, cwd: run.dir, prompt: q.text, permission: permission(), budgetUsd: budget(), onProgress: onProgress(run) });
    live[id] = job;
    job.promise.then((r) => finishRun(run, r));
    return { ok: true, id };
  }

  async function finishRun(run, r) {
    delete live[run.id];
    delete run.progress;
    Object.assign(run, { endedAt: Date.now(), result: (r.result || '').slice(0, 2000), cost: r.cost || 0, sessionId: r.sessionId || '', turns: r.turns || 0, steps: r.steps || 0 });
    let stat = { files: [], ins: 0, del: 0 };
    try { stat = await runner.changes(run.dir); } catch (e) { M.diag.log('main', 'Cambios del worktree: ' + e.message); }
    run.stat = { files: stat.files.slice(0, 50), n: stat.files.length, ins: stat.ins, del: stat.del };
    // Tests antes de avisarte: así no revisas trabajo roto.
    if (stat.files.length && set().claudeRunTests !== false) {
      run.status = 'testing';
      saveRuns();
      try { run.tests = await runner.runTests(run.dir); } catch (e) { run.tests = { ok: false, label: 'tests', tail: e.message }; }
    }
    // Segunda opinión: otra pasada de Claude, de solo lectura, sobre el diff.
    if (r.ok && stat.files.length && set().claudeReview !== false) {
      run.status = 'reviewing';
      saveRuns();
      try { run.review = await runner.review({ bin: claudeBin(), cwd: run.dir, request: run.text, budgetUsd: reviewBudget() }); } catch (e) { run.review = { ok: false, verdict: 'error', text: e.message, cost: 0 }; }
      if (run.review) run.cost = (run.cost || 0) + (run.review.cost || 0);
    }
    petWorking();
    const mins = Math.max(1, Math.round((Date.now() - run.startedAt) / 60e3));
    const testsTxt = run.tests ? (run.tests.ok ? ` · ✅ ${run.tests.label} pasa` : ` · ⚠️ ${run.tests.label} FALLA`) : '';
    const reviewTxt = run.review && run.review.ok ? (run.review.verdict === 'ok' ? ' · 🔎 revisión OK' : ' · 🔎 la revisión encontró cosas') : '';
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
      const worry = (run.tests && !run.tests.ok) || (run.review && run.review.verdict === 'revisar');
      M.say(`🤖 Terminé "${shortText(run.text)}" en ${run.project}: ${stat.files.length} archivo${stat.files.length === 1 ? '' : 's'} (+${stat.ins} −${stat.del}) en ${mins} min${testsTxt}${reviewTxt}. Revisa y decide.`, worry ? 'alert' : 'celebrate', 20000, {
        cat: 'claude', urgent: true, target: { cmd: 'panel', arg: 'day#claude-runs' },
        actions: [{ label: '👀 Ver cambios', cmd: 'run.open', arg: run.id }, ...(prReady(run) ? [{ label: '🚀 Crear PR', cmd: 'run.pr', arg: run.id }] : [{ label: '✅ Aceptar', cmd: 'run.accept', arg: run.id }]), { label: '🗑️ Descartar', cmd: 'run.discard', arg: run.id }],
      });
    }
    saveRuns();
    next();
  }

  /** Cuando se libera un hueco: primero los arreglos de PR pendientes, luego la cola automática. */
  function next() {
    setTimeout(() => { processFixQueue(); autoTick(); }, 2000);
  }

  async function acceptRun(id) {
    const run = runById(id);
    if (!run || !['review', 'failed'].includes(run.status) || run.kind === 'fix') return { ok: false, error: 'Nada que aceptar' };
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
    return !!set().githubToken && !!run.repo && run.kind !== 'fix' && !!remoteOf(run.repo);
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
    if (!run || !['review', 'failed', 'accepted'].includes(run.status) || run.kind === 'fix') return { ok: false, error: 'Nada que publicar' };
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
      Object.assign(run, { status: 'pr', pr: url, prState: 'open', prAt: Date.now() });
      saveRuns();
      M.say(`🚀 PR abierto en ${run.project}: ${prTitle(run)}. Vigilo su CI y la revisión.`, 'celebrate', 15000, { cat: 'claude', log: true, actions: [{ label: '🔗 Ver PR', cmd: 'open.url', arg: url }], target: { cmd: 'open.url', arg: url } });
      later(watchPRs, 90e3); // primer vistazo al CI
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
    if (run.review && run.review.ok) L.push('### Segunda opinión (revisión automática)', '', run.review.verdict === 'ok' ? '✅ Sin problemas.' : '⚠️ Encontró cosas para revisar:', '', run.review.text.slice(0, 3000), '');
    L.push(`---`, `_Hecho por Claude Code desde la cola de PM Pollito 🐣${run.cost ? ` · $${run.cost.toFixed(2)}` : ''}_`);
    return L.join('\n');
  }

  // =====================================================================
  // DESPUÉS DEL PR: CI Y REVISIÓN
  // =====================================================================
  function prInfo(run) {
    const p = prwatch.parsePrUrl(run.pr);
    return p ? { ...p, token: M.decrypt(set().githubToken || '') } : null;
  }
  let watching = false;
  async function watchPRs() {
    if (watching || M.TEST || !set().githubToken) return;
    watching = true;
    try {
      for (const run of runs().filter((r) => r.status === 'pr' && r.pr && (!r.prState || r.prState === 'open'))) {
        const info = prInfo(run);
        if (!info) continue;
        let st;
        try { st = await prwatch.status(info); } catch (e) { M.diag.log('main', `PR ${run.pr}: ${e.message}`); continue; }
        await onPrStatus(run, st, info);
      }
    } finally {
      watching = false;
      saveRuns();
      processFixQueue();
    }
  }

  /** Decide qué hacer con el estado de un PR (separado para poder probarlo). */
  async function onPrStatus(run, st, info) {
    if (st.state !== 'open') {
      run.prState = st.state;
      M.say(st.state === 'merged' ? `🎉 ¡Mezclaron el PR de Claude en ${run.project}! "${shortText(prTitle(run))}"` : `🚪 Cerraron sin mezclar el PR de Claude en ${run.project}.`, st.state === 'merged' ? 'celebrate' : 'peck', 10000, { cat: 'claude' });
      return;
    }
    run.prState = 'open';
    run.ci = { total: st.checks.total, pending: st.checks.pending, passed: st.checks.passed, failed: st.checks.failed.length, sha: st.sha };
    const autoFix = (kind) => (kind === 'ci' ? set().claudeAutoFixCi !== false : !!set().claudeAutoFixReview) && (run.fixes || 0) < maxFixes();
    if (st.checks.failed.length && !st.checks.pending && run.ciSeen !== st.sha) {
      run.ciSeen = st.sha;
      const logs = [];
      for (const c of st.checks.failed.slice(0, 3)) logs.push({ name: c.name, log: String(await prwatch.failureLog(info, c)).slice(-6000) });
      run.lastCi = { sha: st.sha, logs, names: st.checks.failed.map((c) => c.name) };
      if (autoFix('ci')) queueFix(run, 'ci');
      else {
        M.say(`❌ Falló el CI en el PR de Claude (${run.project}): ${run.lastCi.names.join(', ')}${(run.fixes || 0) >= maxFixes() ? ` · ya lo intentó ${run.fixes} veces` : ''}`, 'alert', 20000, {
          cat: 'claude', actions: [{ label: '🔧 Que Claude lo arregle', cmd: 'run.fix', arg: `${run.id}:ci` }, { label: '🔗 Ver PR', cmd: 'open.url', arg: run.pr }],
        });
      }
    } else if (st.checks.total && !st.checks.pending && !st.checks.failed.length && run.greenSeen !== st.sha) {
      run.greenSeen = st.sha;
      M.say(`✅ El CI pasa en el PR de Claude (${run.project}). Listo para revisar.`, 'celebrate', 10000, { cat: 'claude', actions: [{ label: '🔗 Ver PR', cmd: 'open.url', arg: run.pr }] });
    }
    const seen = run.reviewsSeen || [];
    const fresh = st.changesRequested.filter((r) => !seen.includes(r.id));
    if (fresh.length) {
      run.reviewsSeen = [...seen, ...fresh.map((r) => r.id)];
      run.lastReview = { reviews: fresh };
      const who = [...new Set(fresh.map((r) => r.user).filter(Boolean))].join(', ') || 'Alguien';
      if (autoFix('review')) queueFix(run, 'review');
      else {
        M.say(`✏️ ${who} pidió cambios en el PR de Claude (${run.project}).`, 'alert', 20000, {
          cat: 'claude', actions: [{ label: '🔧 Aplicar los cambios', cmd: 'run.fix', arg: `${run.id}:review` }, { label: '🔗 Ver PR', cmd: 'open.url', arg: run.pr }],
        });
      }
    }
  }

  function queueFix(run, kind) {
    run.pendingFix = kind;
    saveRuns();
    processFixQueue();
  }
  function processFixQueue() {
    for (const run of runs().filter((r) => r.pendingFix)) {
      if (busy()) break;
      startFix(run, run.pendingFix);
    }
  }
  /** Botón "🔧 Que Claude lo arregle / Aplicar los cambios". arg: "<id>:ci" o "<id>:review". */
  function fixRun(arg) {
    const [id, kind] = String(arg || '').split(':');
    const run = runById(id);
    if (!run || run.status !== 'pr') return { ok: false, error: 'Ese PR ya no está' };
    if (kind === 'ci' && !run.lastCi) return { ok: false, error: 'No tengo el error del CI' };
    if (kind === 'review' && !run.lastReview) return { ok: false, error: 'No hay cambios pedidos' };
    queueFix(run, kind === 'review' ? 'review' : 'ci');
    if (run.pendingFix) M.say(`🔧 En cuanto haya un hueco, Claude se pone con el PR de ${run.project}.`, 'peck', 6000, { log: false });
    return { ok: true };
  }

  async function startFix(parent, kind) {
    delete parent.pendingFix;
    const bin = needBin();
    if (!bin) { saveRuns(); return; }
    const title = prTitle(parent);
    const prompt = kind === 'ci' ? prwatch.ciPrompt({ title }, parent.lastCi.logs) : prwatch.reviewPrompt({ title }, parent.lastReview.reviews);
    const id = newId();
    /** @type {Record<string, any>} */
    const fix = { id, kind: 'fix', fixOf: kind, parentId: parent.id, text: `${kind === 'ci' ? '🔧 Arreglar el CI' : '🔧 Aplicar la revisión'} · ${title}`, prompt, project: parent.project, repo: parent.repo, pr: parent.pr, status: 'starting', startedAt: Date.now() };
    parent.fixes = (parent.fixes || 0) + 1;
    runs().push(fix);
    saveRuns();
    try {
      Object.assign(fix, await runner.prepareOn(parent.repo, parent.branch, id, worktrees()));
    } catch (e) {
      Object.assign(fix, { status: 'failed', error: 'No pude preparar la rama del PR: ' + e.message, endedAt: Date.now() });
      saveRuns();
      M.say(`😿 No pude preparar el arreglo del PR: ${e.message}`, 'sad', 10000, { cat: 'claude' });
      return;
    }
    fix.status = 'running';
    saveRuns();
    petWorking();
    M.say(`🔧 Claude se pone con ${kind === 'ci' ? 'el CI' : 'la revisión'} del PR de ${parent.project} (intento ${parent.fixes} de ${maxFixes() || 1}).`, 'peck', 7000, { log: false });
    const job = runner.launch({ bin, cwd: fix.dir, prompt, permission: permission(), budgetUsd: budget(), onProgress: onProgress(fix) });
    live[id] = job;
    job.promise.then((r) => finishFix(fix, parent, r));
  }

  async function finishFix(fix, parent, r) {
    delete live[fix.id];
    delete fix.progress;
    Object.assign(fix, { endedAt: Date.now(), result: (r.result || '').slice(0, 2000), cost: r.cost || 0, steps: r.steps || 0 });
    let stat = { files: [], ins: 0, del: 0 };
    try { stat = await runner.changes(fix.dir); } catch (e) { M.diag.log('main', 'Cambios del arreglo: ' + e.message); }
    fix.stat = { files: stat.files.slice(0, 50), n: stat.files.length, ins: stat.ins, del: stat.del };
    if (!r.ok || !stat.files.length) {
      fix.status = r.ok ? 'empty' : 'failed';
      if (!r.ok) fix.error = r.error || 'Falló';
      await removeCopy(fix);
      M.say(r.ok ? `🔧 Claude miró el PR de ${parent.project} y no cambió nada: ${shortText(fix.result || '—', 160)}` : `😿 Claude no pudo arreglar el PR de ${parent.project}: ${fix.error}`, 'sad', 15000, { cat: 'claude', actions: [{ label: '🔗 Ver PR', cmd: 'open.url', arg: parent.pr }] });
    } else {
      if (set().claudeRunTests !== false) {
        fix.status = 'testing';
        saveRuns();
        try { fix.tests = await runner.runTests(fix.dir); } catch (e) { fix.tests = { ok: false, label: 'tests', tail: e.message }; }
      }
      try {
        await runner.commitAndPush(fix, `claude: ${fix.fixOf === 'ci' ? 'arregla el CI' : 'aplica la revisión'}`);
        fix.status = 'pushed';
        M.say(`🔧 Subí un arreglo al PR de ${parent.project} (${stat.files.length} archivo${stat.files.length === 1 ? '' : 's'}${fix.tests ? `, ${fix.tests.label} ${fix.tests.ok ? 'pasa' : 'FALLA'}` : ''}). Espero el CI.`, 'celebrate', 12000, { cat: 'claude', actions: [{ label: '🔗 Ver PR', cmd: 'open.url', arg: parent.pr }] });
        later(watchPRs, 120e3);
      } catch (e) {
        fix.status = 'failed';
        fix.error = 'No pude subir el arreglo: ' + e.message;
        M.say(`😿 ${fix.error}`, 'sad', 12000, { cat: 'claude', actions: [{ label: '👀 Ver', cmd: 'run.open', arg: fix.id }, { label: '🗑️ Descartar', cmd: 'run.discard', arg: fix.id }] });
      }
    }
    petWorking();
    saveRuns();
    next();
  }

  /** Quita la copia de un arreglo SIN borrar la rama (es la del PR). */
  async function removeCopy(run) {
    runner.unlinkDeps(run.dir);
    await runner.git(run.repo, ['worktree', 'remove', '--force', run.dir]).catch(() => {});
  }

  async function discardRun(id) {
    const run = runById(id);
    if (!run) return { ok: false };
    if (live[id]) live[id].kill();
    if (run.kind === 'fix') await removeCopy(run);
    else await runner.discard(run).catch(() => {});
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
    S().claudeRuns = runs().filter((r) => KEEP.has(r.status) || (r.status === 'pr' && r.prState === 'open'));
    saveRuns();
  }

  /** Siguiente petición que se puede ejecutar sola (tiene proyecto y su repo existe). */
  function nextRunnable() {
    return (S().claudeQueue || []).find((q) => q.project && M.repoByName(q.project)) || null;
  }
  /** Modo automático: llena los huecos libres con la cola. */
  function autoTick() {
    if (M.TEST || !set().claudeAutoRun) return;
    while (!busy()) {
      // Nunca más de 3 esperando revisión: que no se acumule trabajo sin mirar.
      if (runs().filter((r) => r.status === 'review').length >= 3) return;
      const q = nextRunnable();
      if (!q) return;
      startRun(q.id);
    }
  }

  /** Al arrancar: lo que quedó a medias cuando se cerró PM. */
  function recover() {
    let n = 0;
    for (const r of runs()) {
      if (r.status === 'testing' || r.status === 'reviewing') { r.status = r.kind === 'fix' ? 'failed' : 'review'; if (r.kind === 'fix') r.error = 'PM se cerró antes de subir el arreglo'; n++; continue; }
      if (r.status === 'running' || r.status === 'starting') { r.status = 'failed'; r.error = 'PM se cerró mientras Claude trabajaba'; r.endedAt = Date.now(); n++; }
      delete r.progress;
    }
    if (n) M.store.save();
  }

  function runsState() {
    return {
      claudeRuns: runs().slice(-12).reverse().map((r) => ({
        id: r.id, kind: r.kind || 'run', fixOf: r.fixOf || '', text: r.text, project: r.project, status: r.status, startedAt: r.startedAt, endedAt: r.endedAt,
        stat: r.stat, cost: r.cost, error: r.error, result: r.result ? r.result.slice(0, 400) : '', sessionId: r.sessionId, branch: r.branch,
        tests: r.tests ? { ok: r.tests.ok, label: r.tests.label, tail: r.tests.ok ? '' : r.tests.tail } : null,
        review: r.review ? { ok: r.review.ok, verdict: r.review.verdict, text: r.review.text } : null,
        progress: r.progress || null, pr: r.pr || '', prState: r.prState || '', ci: r.ci || null, fixes: r.fixes || 0, pendingFix: r.pendingFix || '',
        canFixCi: !!(r.status === 'pr' && r.lastCi && r.ci && r.ci.failed), canFixReview: !!(r.status === 'pr' && r.lastReview),
        issueKey: r.issue ? r.issue.key : '', prReady: prReady(r),
      })),
      claudeRunner: {
        bin: claudeBin(), auto: !!set().claudeAutoRun, tests: set().claudeRunTests !== false, review: set().claudeReview !== false, budget: budget(),
        parallel: limit(), autoFixCi: set().claudeAutoFixCi !== false, autoFixReview: !!set().claudeAutoFixReview, maxFixes: maxFixes(),
        permission: permission(), busy: busy(), active: active(),
      },
    };
  }

  function start() {
    recover();
    if (M.TEST) return;
    setInterval(autoTick, 60e3);
    setTimeout(watchPRs, 25e3);
    setInterval(watchPRs, 3 * 60e3);
  }

  return { startRun, acceptRun, prRun, fixRun, discardRun, openRun, stopRun, clearRuns, runsState, start, onPrStatus, watchPRs };
};

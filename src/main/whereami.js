// "¿Dónde me quedé?", cambio de contexto en un clic y documento de logros (2.0).
// Parte del proceso principal. `M` es el contexto compartido de la app.
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  const lib = require('../coachlib');
  const runner = require('../claudeRunner');
  const S = () => M.store.data;
  const set = () => S().settings;

  // =====================================================================
  // 📍 ¿DÓNDE ME QUEDÉ?
  // =====================================================================
  /** Junta los rastros de un proyecto: rama, commits, Claude, cola, tickets y notas. */
  async function resume(project) {
    const repo = M.repoByName(project);
    const info = { project, seen: lib.lastSeen(S().days, project) };
    if (repo) {
      try { info.branch = await runner.git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']); } catch { /* sin commits */ }
      try {
        let email = '';
        try { email = await runner.git(repo, ['config', 'user.email']); } catch { /* sin identidad */ }
        const log = await runner.git(repo, ['log', '-3', '--format=%s\x1f%cr', ...(email ? [`--author=${email}`] : [])]);
        info.commits = log.split('\n').filter(Boolean).map((l) => { const [subject, when] = l.split('\x1f'); return { subject: subject.slice(0, 90), when }; });
      } catch { info.commits = []; }
    }
    try {
      const byProject = M.journalMod.prompts(Date.now() - 14 * 864e5, Date.now());
      const key = Object.keys(byProject).find((k) => k.toLowerCase() === project.toLowerCase());
      info.prompts = key ? byProject[key].sort((a, b) => a.at - b.at).slice(-3).map((p) => p.text) : [];
    } catch { info.prompts = []; }
    const run = (S().claudeRuns || []).filter((r) => r.project && r.project.toLowerCase() === project.toLowerCase()).pop();
    if (run) info.run = { text: run.text, status: { review: 'esperando tu revisión', pr: 'PR abierto', accepted: 'en su rama', failed: 'falló', running: 'trabajando' }[run.status] || run.status };
    const map = set().ticketRepos || {};
    info.tickets = M.work.ticketsState().issues.filter((i) => (i.provider === 'github' && i.ref && String(i.ref.repo).split('/').pop().toLowerCase() === project.toLowerCase()) || (map[`${i.provider}:${i.project || ''}`] || '').toLowerCase() === project.toLowerCase());
    // La nota más reciente que menciona el proyecto.
    for (const k of Object.keys(S().days || {}).sort().reverse().slice(0, 30)) {
      const line = String(S().days[k].notes || '').split('\n').reverse().find((l) => l.toLowerCase().includes(project.toLowerCase()));
      if (line) { info.note = line.trim(); break; }
    }
    return { project, lines: lib.resumeLines(info), info };
  }
  async function showResume(project, auto = false) {
    const r = await resume(project);
    S().lastResume = { project, at: Date.now(), lines: r.lines };
    M.store.save();
    M.broadcast();
    M.say(`${auto ? `👋 ¡De vuelta en ${project}! ` : ''}${r.lines.join(' ')}`, 'look', 20000, { cat: 'pet', target: { cmd: 'panel', arg: 'day#pj-section' }, actions: [{ label: '🎯 Abrir todo', cmd: 'context.open', arg: project }] });
    return r;
  }
  // Al volver a un proyecto después de 2+ días, te lo cuenta solo (una vez al día por proyecto).
  let lastProject = '';
  function onSample(s, cat) {
    if (cat !== 'work' || !M.prod) return;
    const project = M.prod.projectOf(s);
    if (!project || project === lastProject) return;
    lastProject = project;
    if (!M.repoByName(project)) return;
    const seen = lib.lastSeen(S().days, project);
    if (!seen || seen.daysAgo < 2) return;
    const shown = S().resumeShown || (S().resumeShown = {});
    const k = `${project}|${lib.keyOf(new Date())}`;
    if (shown[k]) return;
    shown[k] = 1;
    for (const old of Object.keys(shown)) if (!old.endsWith(lib.keyOf(new Date()))) delete shown[old];
    showResume(project, true).catch((e) => M.diag.log('main', '¿Dónde me quedé?: ' + e.message));
  }

  // =====================================================================
  // 🎯 CAMBIO DE CONTEXTO EN UN CLIC
  // =====================================================================
  const contexts = () => (set().contexts = set().contexts || {});
  const okUrl = (u) => /^(https:\/\/|spotify:)[^\s]+$/i.test(String(u || '').trim());
  function saveContext(project, ctx) {
    const links = String(ctx.links || '').split(/\s*\n\s*/).map((x) => x.trim()).filter(okUrl).slice(0, 8);
    const music = okUrl(ctx.music) ? String(ctx.music).trim() : '';
    const focus = Math.max(0, Math.min(240, Number(ctx.focus) || 0));
    contexts()[project] = { links, music, focus };
    M.store.save();
    M.broadcast();
    return { ok: true, context: contexts()[project] };
  }
  /** "Trabajar en X": editor en el repo, sus enlaces, su música, modo foco y qué hacías. */
  async function openContext(project) {
    const repo = M.repoByName(project);
    if (!repo) return { ok: false, error: `No encontré el repo "${project}"` };
    const c = contexts()[project] || { links: [], music: '', focus: 0 };
    M.openProject(repo);
    for (const u of c.links) M.shell.openExternal(u).catch(() => {});
    if (c.music) M.shell.openExternal(c.music).catch(() => {});
    if (c.focus && !M.focusMode()) M.startFocus(c.focus);
    S().lastContext = { project, at: Date.now() };
    M.store.save();
    setTimeout(() => showResume(project).catch(() => {}), 1500);
    return { ok: true };
  }

  // =====================================================================
  // 🏆 DOCUMENTO DE LOGROS
  // =====================================================================
  function range(which) {
    const now = new Date();
    if (which === 'year') return { from: new Date(now.getFullYear(), 0, 1).getTime(), to: new Date(now.getFullYear() + 1, 0, 1).getTime(), label: String(now.getFullYear()) };
    if (which === 'lastmonth') { const a = new Date(now.getFullYear(), now.getMonth() - 1, 1); return { from: a.getTime(), to: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), label: `${a.getFullYear()}-${String(a.getMonth() + 1).padStart(2, '0')}` }; }
    return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), to: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(), label: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` };
  }
  async function brag(which = 'month') {
    const r = range(which);
    const ACH = M.gami.ACHIEVEMENTS;
    const achievements = (S().pet.achievements || []).map((a) => { const d = ACH.find((x) => x.id === a.id); return d ? { emoji: d.emoji, name: d.name, at: a.at } : null; }).filter(Boolean);
    const doc = lib.bragDoc(S(), r.from, r.to, { runs: S().claudeRuns || [], achievements, milestones: S().milestones || [], name: S().pet.name || 'PM' });
    let md = doc.markdown;
    if (M.aiAvailable() && doc.counts.tasks + doc.counts.tickets > 0) {
      try {
        const impact = await M.ai.polish(md.slice(0, 12000), 'Eres un coach de carrera. A partir de este registro real de trabajo, escribe en español 4 a 6 viñetas de IMPACTO para una evaluación de desempeño (qué se logró y por qué importa), sin inventar nada que no esté en el texto. Solo las viñetas, empezando cada una con "- ".');
        md = md.replace('\n## ', `\n## ✨ Resumen de impacto\n${impact.trim()}\n\n## `);
      } catch { /* sin IA: el documento tal cual */ }
    }
    const dir = M.path.join(M.app.getPath('documents'), 'PM Pollito');
    M.fs.mkdirSync(dir, { recursive: true });
    const file = M.path.join(dir, `logros-${r.label}.md`);
    M.fs.writeFileSync(file, md);
    M.clipboard.writeText(md);
    M.shell.showItemInFolder(file);
    M.say(`🏆 Tu documento de logros (${r.label}) está listo y copiado: ${doc.counts.tasks + doc.counts.tickets} cosas terminadas, ${doc.counts.hours} h de foco${doc.counts.prs ? `, ${doc.counts.prs} PRs` : ''}.`, 'celebrate', 12000, { cat: 'pet' });
    return { ok: true, file, counts: doc.counts };
  }

  function whereState() {
    return { contexts: contexts(), lastResume: S().lastResume || null };
  }

  return { resume, showResume, onSample, saveContext, openContext, brag, whereState };
};

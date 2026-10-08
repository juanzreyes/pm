// Herramientas para programar:
//  · vigilante de tests y builds (eventos de la extensión de VS Code)
//  · mensaje de commit sugerido
//  · revisión antes de hacer push (console.log, TODO, secretos, .env…)
//  · tiempo por rama
const path = require('path');
const git = require('./git');

// Comandos que merece la pena vigilar (tests, builds, linters, compiladores).
const WATCH_CMD = /\b(test|tests|jest|vitest|mocha|pytest|unittest|rspec|phpunit|build|compile|tsc|lint|eslint|ruff|mypy|flake8|cargo|go (test|build|vet)|mvn|gradle|dotnet (build|test)|make|cmake|ninja|npm run|yarn|pnpm|bun (test|run))\b/i;

// Qué buscar en lo que vas a subir. [etiqueta, expresión, gravedad]
/** @type {Array<[string, RegExp, number]>} */
const PUSH_CHECKS = [
  ['clave privada', /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/, 3],
  ['clave de AWS', /\bAKIA[0-9A-Z]{16}\b/, 3],
  ['clave de API', /\b(sk-(ant-)?[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|xox[bpa]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})\b/, 3],
  ['contraseña escrita en el código', /\b(password|passwd|pwd|secret|api_?key|token)\s*[:=]\s*['"][^'"\s]{6,}['"]/i, 2],
  ['marcas de conflicto de merge', /^(<{7}|>{7}|={7})( |$)/, 3],
  ['console.log', /\bconsole\.(log|debug)\(/, 1],
  ['debugger', /^\s*debugger;?\s*$/, 2],
  ['print de depuración', /^\s*(print\(|var_dump\(|dd\(|System\.out\.println\()/, 1],
  ['test con .only', /\b(it|describe|test)\.only\(/, 2],
  ['TODO/FIXME nuevo', /\b(TODO|FIXME|XXX|HACK)\b/, 1],
];
const SENSITIVE_FILES = /(^|\/)(\.env(\.[\w.-]+)?|id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.pfx|credentials\.json|secrets?\.(json|ya?ml))$/i;

function create(ctx) {
  const S = () => ctx.store.data;

  // ================= VIGILANTE DE TESTS Y BUILDS =================
  const lastResult = {}; // "proyecto|comando" -> 'ok' | 'fail'
  function devEvent(ev) {
    if (!ev || typeof ev !== 'object') return false;
    const cmd = String(ev.command || '').trim().slice(0, 200);
    if (!cmd || !WATCH_CMD.test(cmd) || S().settings.buildWatch === false) return true;
    const code = Number(ev.exitCode);
    if (!Number.isFinite(code)) return true;
    const proj = ev.cwd ? path.basename(String(ev.cwd)) : String(ev.project || 'VS Code');
    const key = `${proj}|${cmd}`;
    const before = lastResult[key];
    const day = ctx.today();
    day.builds = day.builds || { ok: 0, fail: 0 };
    if (code === 0) {
      day.builds.ok++;
      lastResult[key] = 'ok';
      if (before === 'fail') {
        ctx.addXp(5);
        ctx.say(`🎉 ¡Ya pasa \`${short(cmd)}\` en ${proj}! Arreglado 💪 +5 XP`, 'celebrate', 8000, { cat: 'dev' });
      }
    } else {
      day.builds.fail++;
      lastResult[key] = 'fail';
      S().lastDevFail = { cmd, proj, cwd: ev.cwd || '', output: String(ev.output || '').slice(-6000), at: Date.now() };
      // Historial de fallos por proyecto (para la memoria de proyecto / CLAUDE.md).
      const log = (S().devLog = S().devLog || {});
      (log[proj] = log[proj] || []).push({ at: Date.now(), cmd: short(cmd), line: errorLine(String(ev.output || '')) });
      log[proj] = log[proj].slice(-30);
      const actions = [{ label: '📋 Prompt para Claude', cmd: 'dev.failPrompt' }, { label: '📌 Tarea', cmd: 'dev.failTask' }];
      if (ctx.aiAvailable()) actions.unshift({ label: '🤖 Explícamelo', cmd: 'dev.failAsk' });
      const line = errorLine(String(ev.output || ''));
      ctx.say(`😰 Falló \`${short(cmd)}\` en ${proj}${line ? `: ${line}` : ` (código ${code})`}`, 'alert', 15000, { cat: 'dev', actions });
    }
    ctx.store.save();
    ctx.broadcast();
    return true;
  }
  const short = (c) => (c.length > 40 ? c.slice(0, 39) + '…' : c);
  function errorLine(out) {
    const lines = out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const hit = lines.filter((l) => /(error|failed|failure|exception|✕|✗|FAIL\b|assert)/i.test(l) && !/^at\s/.test(l));
    return (hit[0] || '').slice(0, 90);
  }
  function failPrompt() {
    const f = S().lastDevFail;
    if (!f) return;
    ctx.clipboard.writeText(`Al ejecutar \`${f.cmd}\` en el proyecto ${f.proj} falla con esta salida. Explícame la causa y arréglalo:\n\n\`\`\`\n${f.output || '(sin salida)'}\n\`\`\``);
    ctx.say('📋 Prompt con el error copiado. ¡Pégalo en Claude Code!', 'peck', 5000, { log: false });
  }
  function failTask() {
    const f = S().lastDevFail;
    if (!f) return;
    ctx.addTask(`🧪 Arreglar \`${short(f.cmd)}\` en ${f.proj}`);
    ctx.say('📌 Anotado como tarea', 'peck', 4000, { log: false });
  }
  function failAsk() {
    const f = S().lastDevFail;
    if (f) ctx.askChat(`Mi comando \`${f.cmd}\` falla en ${f.proj}. Explícame por qué y cómo arreglarlo:\n${(f.output || '').slice(-3000)}`);
  }

  // ================= MENSAJE DE COMMIT SUGERIDO =================
  async function changedFiles(repo) {
    const out = await git.run(repo, ['status', '--porcelain']);
    return (out || '').split('\n').filter(Boolean).map((l) => ({ st: l.slice(0, 2).trim(), file: l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop() }));
  }
  /** Sugerencia sin IA: tipo convencional + ámbito + resumen. */
  function heuristicMessage(files, branch) {
    const names = files.map((f) => f.file.replace(/\\/g, '/'));
    const only = (re) => names.length && names.every((n) => re.test(n));
    let type = 'feat';
    if (only(/\.(md|txt|rst|adoc)$|(^|\/)docs?\//i)) type = 'docs';
    else if (only(/(test|spec)s?[\/.]|__tests__/i)) type = 'test';
    else if (only(/\.(css|scss|less|sass)$/i)) type = 'style';
    else if (only(/(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|requirements.*\.txt|Cargo\.(toml|lock)|go\.(mod|sum)|\.github\/|Dockerfile|\.ya?ml$)/i)) type = 'chore';
    else if (/^(fix|bug|hotfix)[/-]/i.test(branch || '')) type = 'fix';
    else if (files.every((f) => f.st === 'M') && files.length <= 3) type = 'fix';
    else if (files.every((f) => f.st === 'D')) type = 'refactor';
    // Ámbito: carpeta común (primer nivel)
    const dirs = [...new Set(names.map((n) => (n.includes('/') ? n.split('/')[0] : '')))].filter(Boolean);
    const scope = dirs.length === 1 && !/^(src|lib|app)$/i.test(dirs[0]) ? `(${dirs[0]})` : '';
    const added = files.filter((f) => f.st === 'A' || f.st === '??').length;
    const base = (n) => path.basename(n).replace(/\.[^.]+$/, '');
    let what;
    if (names.length === 1) what = `${added ? 'añade' : 'actualiza'} ${path.basename(names[0])}`;
    else if (names.length <= 3) what = `${added === names.length ? 'añade' : 'actualiza'} ${names.map(base).join(', ')}`;
    else what = `${added ? `añade ${added} archivo${added === 1 ? '' : 's'} y ` : ''}actualiza ${names.length - added} archivo${names.length - added === 1 ? '' : 's'}`;
    return `${type}${scope}: ${what}`;
  }
  async function suggestCommit(repo) {
    const files = await changedFiles(repo);
    if (!files.length) {
      ctx.say('No hay cambios sin commit en ese proyecto ✨', 'peck', 5000, { log: false });
      return null;
    }
    const branch = await git.run(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
    let msg = heuristicMessage(files, branch);
    if (ctx.aiAvailable()) {
      const stat = (await git.run(repo, ['diff', 'HEAD', '--stat'])) || '';
      const diff = ((await git.run(repo, ['diff', 'HEAD', '--unified=1'])) || '').slice(0, 9000);
      try {
        const ai = await ctx.ai().polish(`Rama: ${branch}\nArchivos:\n${files.map((f) => `${f.st} ${f.file}`).join('\n')}\n\n${stat}\n\n${diff}`,
          'Escribe UN mensaje de commit en formato Conventional Commits (tipo(ámbito): resumen en minúsculas, máximo 72 caracteres), en el mismo idioma que los commits habituales o en español. Si hace falta, añade tras una línea en blanco 1-3 viñetas cortas.');
        if (ai && ai.length < 600) msg = ai.replace(/^```\w*\n?|```$/g, '').trim();
      } catch { /* sin IA: vale la sugerencia simple */ }
    }
    ctx.clipboard.writeText(msg);
    ctx.say(`📋 Mensaje de commit copiado:\n${msg.split('\n')[0]}`, 'peck', 9000, { log: false });
    return msg;
  }

  // ================= REVISIÓN ANTES DE PUSH =================
  const scanned = {}; // repo -> HEAD revisado
  async function prePushScan(repo, announce = true) {
    const up = await git.unpushed(repo);
    if (!up || !up.ahead) return null;
    if (announce && scanned[repo] === up.head) return null;
    scanned[repo] = up.head;
    const diff = (await git.run(repo, ['diff', up.range, '--unified=0', '--no-color'])) || '';
    const names = (await git.run(repo, ['diff', up.range, '--name-only'])) || '';
    const found = [];
    let file = '';
    for (const line of diff.split('\n')) {
      if (line.startsWith('+++ ')) { file = line.replace(/^\+\+\+ (b\/)?/, ''); continue; }
      if (!line.startsWith('+') || line.startsWith('+++')) continue;
      const code = line.slice(1);
      for (const [label, re, sev] of PUSH_CHECKS) {
        if (re.test(code)) { found.push({ label, sev, file }); break; }
      }
    }
    for (const n of names.split('\n').filter(Boolean)) if (SENSITIVE_FILES.test(n)) found.push({ label: `archivo sensible (${path.basename(n)})`, sev: 3, file: n });
    const result = { repo: path.basename(repo), path: repo, ahead: up.ahead, found, at: Date.now() };
    S().pushChecks = S().pushChecks || {};
    S().pushChecks[result.repo] = { ...result, found: found.slice(0, 30) };
    ctx.store.save();
    if (!found.length) {
      if (!announce) ctx.say(`✅ ${result.repo}: ${up.ahead} commit${up.ahead === 1 ? '' : 's'} sin subir y todo limpio. ¡Push tranquilo! 🚀`, 'hop', 7000, { log: false });
      return result;
    }
    // Resumen agrupado por tipo, lo más grave primero.
    const groups = {};
    for (const f of found) (groups[f.label] = groups[f.label] || { n: 0, sev: f.sev, files: new Set() }).n++, groups[f.label].files.add(path.basename(f.file));
    const list = Object.entries(groups).sort((a, b) => b[1].sev - a[1].sev).slice(0, 4).map(([k, g]) => `${g.n}× ${k} (${[...g.files].slice(0, 2).join(', ')})`);
    const worst = Math.max(...found.map((f) => f.sev));
    ctx.say(`${worst >= 3 ? '🚨' : '🔍'} Antes de hacer push en ${result.repo}: ${list.join(' · ')}`, worst >= 3 ? 'alarm' : 'judge', 16000, {
      cat: 'dev', actions: [{ label: '📂 Abrir proyecto', cmd: 'open.project', arg: repo }, { label: '👍 Está bien así', cmd: 'ack' }],
    });
    return result;
  }
  // Commits sin subir solo aparecen tras un commit, fetch o push: si los reflogs del repo no se
  // movieron desde la última revisión, no hace falta preguntarle nada a git.
  const lastActivity = {};
  async function prePushAll(repos) {
    for (const r of repos) {
      const act = git.refActivity(r);
      if (act !== Infinity && lastActivity[r] === act) continue;
      // Al arrancar, los repos sin movimiento en 3 días no se revisan (nada nuevo que avisar).
      if (!(r in lastActivity) && act !== Infinity && act < Date.now() - 3 * 864e5) { lastActivity[r] = act; continue; }
      lastActivity[r] = act;
      try { await prePushScan(r, true); } catch { /* repo raro */ }
    }
  }

  // ================= TIEMPO POR RAMA =================
  const repoBranch = {}; // nombre del repo -> rama actual
  function setBranches(statuses) {
    for (const st of statuses) if (st && st.branch) repoBranch[st.repo] = st.branch;
  }
  function trackBranch(project, dt) {
    const b = repoBranch[project];
    if (!b) return;
    const day = ctx.today();
    day.branches = day.branches || {};
    const k = `${project} · ${b}`;
    day.branches[k] = (day.branches[k] || 0) + dt;
  }

  return {
    devEvent, failPrompt, failTask, failAsk,
    suggestCommit, heuristicMessage,
    prePushScan, prePushAll,
    setBranches, trackBranch,
  };
}

module.exports = { create, PUSH_CHECKS, WATCH_CMD };

// Ejecuta peticiones de la cola de Claude sin que estés delante.
// Cada petición trabaja en un worktree de git aparte (tu carpeta y tu rama no se tocan):
// PM lanza `claude -p` allí y, al terminar, deja los cambios para revisar, aceptar
// (se quedan en una rama pm/claude-… para que la mezcles cuando quieras) o descartar.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const WIN = process.platform === 'win32';

function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split('\n').slice(-1)[0]));
      else resolve(String(stdout).trim());
    });
  });
}

/** Busca el ejecutable de Claude Code: el configurado, el PATH y las rutas de instalación habituales. */
function findClaude(custom) {
  const h = os.homedir();
  const exts = WIN ? ['.exe', '.cmd', ''] : [''];
  const cands = [custom, process.env.PM_CLAUDE_BIN].filter(Boolean);
  for (const dir of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) for (const e of exts) cands.push(path.join(dir, 'claude' + e));
  cands.push(
    path.join(h, '.local', 'bin', WIN ? 'claude.exe' : 'claude'),
    path.join(h, '.claude', 'local', WIN ? 'claude.exe' : 'claude'),
    ...(WIN ? [path.join(process.env.APPDATA || path.join(h, 'AppData', 'Roaming'), 'npm', 'claude.cmd')] : ['/usr/local/bin/claude', '/opt/homebrew/bin/claude']),
  );
  for (const c of cands) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* no está */ }
  }
  return null;
}

/** Cómo lanzar el ejecutable (los .js se lanzan con Node: sirve para los tests). */
function command(bin, args) {
  if (/\.js$/i.test(bin)) return { file: process.execPath, args: [bin, ...args], shell: false, env: { ELECTRON_RUN_AS_NODE: '1' } };
  if (WIN && /\.(cmd|bat)$/i.test(bin)) return { file: `"${bin}"`, args, shell: true, env: {} };
  return { file: bin, args, shell: false, env: {} };
}

const slug = (s) => String(s || 'repo').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'repo';

/** Crea el worktree en una rama nueva a partir de lo que tengas en HEAD (base = tu rama actual, para el PR). */
async function prepare(repo, id, baseDir) {
  const dir = path.join(baseDir, `${slug(path.basename(repo))}-${id}`);
  const branch = `pm/claude-${id}`;
  fs.mkdirSync(baseDir, { recursive: true });
  let base = '';
  try { base = await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']); } catch { /* repo sin commits */ }
  await git(repo, ['worktree', 'add', '-b', branch, dir, 'HEAD']);
  linkDeps(repo, dir);
  return { dir, branch, base: base === 'HEAD' ? '' : base };
}

// Dependencias ya instaladas (node_modules) compartidas con un enlace: Claude y los tests las usan
// sin reinstalar nada. Se quita el enlace (nunca su contenido) antes de borrar la copia.
const DEPS = ['node_modules'];
function linkDeps(repo, dir) {
  for (const d of DEPS) {
    const src = path.join(repo, d);
    const dst = path.join(dir, d);
    try {
      if (fs.statSync(src).isDirectory() && !fs.existsSync(dst)) fs.symlinkSync(src, dst, WIN ? 'junction' : 'dir');
    } catch { /* sin dependencias o sin permiso para enlazar: seguimos sin ellas */ }
  }
}
function unlinkDeps(dir) {
  for (const d of DEPS) {
    const dst = path.join(dir, d);
    try { if (fs.lstatSync(dst).isSymbolicLink()) fs.unlinkSync(dst); } catch { /* no hay enlace */ }
  }
}
/** Prepara los cambios de Claude. Lo enlazado nunca entra (si el repo no lo ignoraba ya, se saca del índice). */
async function stageAll(dir) {
  await git(dir, ['add', '-A']);
  for (const d of DEPS) {
    let linked = false;
    try { linked = fs.lstatSync(path.join(dir, d)).isSymbolicLink(); } catch { /* no hay enlace */ }
    if (!linked) continue;
    const inHead = await git(dir, ['ls-tree', '--name-only', 'HEAD', '--', d]).catch(() => '');
    const staged = await git(dir, ['ls-files', '--cached', '--', d]).catch(() => '');
    if (!inHead && staged) await git(dir, ['rm', '-r', '-q', '--cached', '--', d]);
  }
}

/** Qué está haciendo Claude, a partir de una herramienta que usa (para mostrarlo en vivo). */
function describeTool(name, input = {}) {
  const file = input.file_path || input.notebook_path || input.path || '';
  const short = (p) => String(p).split(/[\\/]/).slice(-2).join('/');
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(name)) return { icon: '✏️', what: 'Editando', target: short(file) };
  if (name === 'Read') return { icon: '👀', what: 'Leyendo', target: short(file) };
  if (name === 'Bash') return { icon: '⌨️', what: 'Ejecutando', target: String(input.command || '').split('\n')[0].slice(0, 60) };
  if (/^(Grep|Glob|LS)$/.test(name)) return { icon: '🔎', what: 'Buscando', target: String(input.pattern || file || '').slice(0, 60) };
  if (name === 'TodoWrite') return { icon: '📝', what: 'Planificando', target: '' };
  if (/^Web(Fetch|Search)$/.test(name)) return { icon: '🌐', what: 'Consultando', target: String(input.url || input.query || '').slice(0, 60) };
  if (/^(Task|Agent)$/.test(name)) return { icon: '🤖', what: 'Subagente', target: String(input.description || '').slice(0, 60) };
  return { icon: '🔧', what: name, target: '' };
}

/**
 * Lanza Claude en el worktree. La petición va por la entrada estándar (sin problemas de comillas).
 * Lee la salida en vivo (stream-json) y llama a onProgress({ icon, what, target, steps }) en cada herramienta.
 * Devuelve { promise, kill }. La promesa resuelve { ok, result, cost, turns, sessionId, error }.
 */
function launch({ bin, cwd, prompt, permission = 'acceptEdits', timeoutMs = 30 * 60e3, budgetUsd = 0, onProgress = null }) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', permission];
  if (budgetUsd > 0) args.push('--max-budget-usd', String(budgetUsd)); // Claude se detiene al llegar al tope
  const c = command(bin, args);
  const child = spawn(c.file, c.args, { cwd, shell: c.shell, windowsHide: true, env: { ...process.env, ...c.env } });
  let buf = '';
  let err = '';
  let last = ''; // última línea que no es JSON (por si falla antes de empezar)
  let final = null;
  let steps = 0;
  let killedBy = '';
  const onLine = (line) => {
    if (!line.trim()) return;
    let j;
    try { j = JSON.parse(line); } catch { last = line.slice(0, 400); return; }
    if (!j || typeof j !== 'object') return;
    if (j.type === 'result' || (j.type === undefined && 'result' in j)) { final = j; return; }
    if (j.type === 'assistant' && j.message && Array.isArray(j.message.content)) {
      for (const part of j.message.content) {
        if (part.type !== 'tool_use') continue;
        steps++;
        if (onProgress) { try { onProgress({ ...describeTool(part.name, part.input), steps }); } catch { /* la vista no debe romper la ejecución */ } }
      }
    }
  };
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
    if (buf.length > 5e6) buf = buf.slice(-1e6);
  });
  child.stderr.on('data', (d) => { if (err.length < 1e5) err += d; });
  child.stdin.on('error', () => { /* terminó antes de leer */ });
  child.stdin.end(prompt);
  const timer = setTimeout(() => { killedBy = 'timeout'; child.kill(); }, timeoutMs);
  const promise = new Promise((resolve) => {
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: 'No pude lanzar Claude Code: ' + e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buf) onLine(buf);
      if (killedBy) return resolve({ ok: false, error: killedBy === 'timeout' ? `Tardó más de ${Math.round(timeoutMs / 60e3)} min y lo paré` : 'Lo paraste', steps });
      const j = final;
      if (j) {
        return resolve({ ok: !j.is_error && code === 0, result: String(j.result || '').trim(), cost: Number(j.total_cost_usd) || 0, turns: j.num_turns || 0, sessionId: j.session_id || '', steps, error: j.is_error ? String(j.result || j.subtype || 'error') : (code ? `Salió con código ${code}` : '') });
      }
      resolve({ ok: false, steps, error: (err.trim() || last || `Salió con código ${code}`).split('\n').slice(-3).join(' ').slice(0, 400) });
    });
  });
  return { promise, kill: () => { killedBy = 'user'; child.kill(); } };
}

// ---------------- segunda opinión antes del PR ----------------
/** El diff preparado (lo que se commitearía), recortado para caber en una petición. */
async function stagedDiff(dir, max = 60000) {
  await stageAll(dir);
  const d = await git(dir, ['diff', '--cached', '--no-color', '--stat', '--patch']);
  return d.length > max ? d.slice(0, max) + '\n… (diff recortado)' : d;
}
const REVIEW_PROMPT = `Eres un revisor de código exigente pero práctico. Abajo está el diff de un cambio que otra sesión de Claude acaba de hacer en este repositorio para esta petición:

<peticion>
{{PETICION}}
</peticion>

Revísalo buscando SOLO problemas reales: bugs, casos que rompen, secretos o claves en el código, código de depuración olvidado, cosas a medias respecto a la petición o cambios que no tienen que ver. No propongas estilo ni refactors opcionales. Puedes leer archivos del repo si hace falta contexto, pero no cambies nada.

Responde en español. La PRIMERA línea debe ser exactamente "VEREDICTO: OK" (si se puede publicar tal cual) o "VEREDICTO: REVISAR" (si hay algo que corregir). Después, una lista corta de problemas con archivo y línea. Si todo está bien, una sola frase.

<diff>
{{DIFF}}
</diff>`;
/** Revisión de solo lectura (dontAsk: cualquier edición se deniega). */
async function review({ bin, cwd, request, budgetUsd = 1, timeoutMs = 10 * 60e3 }) {
  const diff = await stagedDiff(cwd);
  if (!diff.trim()) return null;
  const prompt = REVIEW_PROMPT.replace('{{PETICION}}', String(request || '').slice(0, 3000)).replace('{{DIFF}}', diff);
  const r = await launch({ bin, cwd, prompt, permission: 'dontAsk', budgetUsd, timeoutMs }).promise;
  if (!r.ok && !r.result) return { ok: false, verdict: 'error', text: r.error || 'La revisión falló', cost: r.cost || 0 };
  const text = String(r.result || '').trim();
  const verdict = /^\s*VEREDICTO:\s*OK/i.test(text) ? 'ok' : /VEREDICTO:\s*REVISAR/i.test(text) ? 'revisar' : 'revisar';
  return { ok: true, verdict, text: text.replace(/^\s*VEREDICTO:[^\n]*\n?/i, '').trim().slice(0, 4000), cost: r.cost || 0 };
}

// ---------------- arreglos sobre la rama de un PR ----------------
/** Worktree sobre una rama que ya existe (la del PR). Si solo está en origin, la trae. */
async function prepareOn(repo, branch, id, baseDir) {
  const dir = path.join(baseDir, `${slug(path.basename(repo))}-${id}`);
  fs.mkdirSync(baseDir, { recursive: true });
  const local = await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).then(() => true, () => false);
  if (!local) await git(repo, ['fetch', 'origin', `${branch}:${branch}`]);
  else await git(repo, ['fetch', 'origin', branch]).then(() => git(repo, ['branch', '-f', branch, `origin/${branch}`])).catch(() => { /* sin red: seguimos con la local */ });
  await git(repo, ['worktree', 'add', dir, branch]);
  linkDeps(repo, dir);
  return { dir, branch };
}
/** Commit + push a la rama del PR y quita la copia. */
async function commitAndPush(run, message) {
  await stageAll(run.dir);
  try {
    await git(run.dir, ['commit', '-m', message]);
  } catch (e) {
    if (!/user\.(name|email)|identity|Please tell me who you are/i.test(e.message)) throw e;
    await git(run.dir, ['-c', 'user.name=PM Pollito', '-c', 'user.email=pm-pollito@localhost', 'commit', '-m', message]);
  }
  await git(run.dir, ['push', 'origin', `HEAD:${run.branch}`]);
  unlinkDeps(run.dir);
  await git(run.repo, ['worktree', 'remove', '--force', run.dir]);
}

/** Cambios que dejó Claude (incluye archivos nuevos). */
async function changes(dir) {
  await stageAll(dir);
  const files = (await git(dir, ['diff', '--cached', '--name-only'])).split('\n').filter(Boolean);
  const short = await git(dir, ['diff', '--cached', '--shortstat']);
  const n = (re) => Number((short.match(re) || [])[1]) || 0;
  return { files, ins: n(/(\d+) insertion/), del: n(/(\d+) deletion/) };
}

/** Aceptar: commit en la rama del worktree y quita la carpeta (la rama queda para mezclarla). */
async function accept(run, message) {
  await stageAll(run.dir);
  const msg = message || `claude: ${run.text.split('\n')[0].slice(0, 60)}`;
  try {
    await git(run.dir, ['commit', '-m', msg]);
  } catch (e) {
    if (!/user\.(name|email)|identity|Please tell me who you are/i.test(e.message)) throw e;
    await git(run.dir, ['-c', 'user.name=PM Pollito', '-c', 'user.email=pm-pollito@localhost', 'commit', '-m', msg]);
  }
  unlinkDeps(run.dir);
  await git(run.repo, ['worktree', 'remove', '--force', run.dir]);
  return run.branch;
}

/** Descartar: borra el worktree y su rama. */
async function discard(run) {
  unlinkDeps(run.dir);
  try { await git(run.repo, ['worktree', 'remove', '--force', run.dir]); } catch { try { fs.rmSync(run.dir, { recursive: true, force: true }); await git(run.repo, ['worktree', 'prune']); } catch { /* ya no está */ } }
  try { await git(run.repo, ['branch', '-D', run.branch]); } catch { /* ya no está */ }
}

// ---------------- tests antes de avisarte ----------------
/** Comando de tests del proyecto, si lo tiene. */
function detectTests(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const t = pkg.scripts && pkg.scripts.test;
    if (t && !/no test specified/.test(t)) return { cmd: 'npm test', label: 'npm test' };
  } catch { /* no es Node */ }
  if (has('pytest.ini') || has('conftest.py') || (has('pyproject.toml') && /pytest/.test(fs.readFileSync(path.join(dir, 'pyproject.toml'), 'utf8')))) return { cmd: 'python -m pytest -q', label: 'pytest' };
  if (has('Cargo.toml')) return { cmd: 'cargo test', label: 'cargo test' };
  if (has('go.mod')) return { cmd: 'go test ./...', label: 'go test' };
  return null;
}

/** Corre los tests en la copia. Devuelve { ok, label, tail } o null si el proyecto no tiene tests. */
function runTests(dir, timeoutMs = 10 * 60e3) {
  const t = detectTests(dir);
  if (!t) return Promise.resolve(null);
  return new Promise((resolve) => {
    const child = spawn(t.cmd, { cwd: dir, shell: true, windowsHide: true, env: { ...process.env, CI: 'true', FORCE_COLOR: '0' } });
    let out = '';
    const keep = (d) => { out = (out + d).slice(-6000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => { child.kill(); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, label: t.label, tail: e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const tail = out.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').slice(-15).join('\n');
      resolve({ ok: code === 0, label: t.label, tail: code === null ? `Se pasó de ${Math.round(timeoutMs / 60e3)} min y lo paré\n${tail}` : tail });
    });
  });
}

// ---------------- pull request ----------------
/** owner/repo de un remoto de GitHub (https o ssh), o null. */
function githubRepoOf(url) {
  const m = String(url || '').trim().match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}
/** Sube la rama a origin (con tus credenciales de git). */
function pushBranch(repo, branch) {
  return git(repo, ['push', '-u', 'origin', branch]);
}
/** Abre el pull request en GitHub. Devuelve su URL. */
async function openPR({ owner, repo, token, head, base, title, body }, http = fetch) {
  const res = await http(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'PM-Pollito' },
    body: JSON.stringify({ title, head, base, body, draft: false }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (j.errors && j.errors[0] && (j.errors[0].message || j.errors[0].code)) || j.message || '';
    throw new Error(res.status === 401 || res.status === 403 ? 'GitHub no aceptó el token (necesita permiso "repo")' : `GitHub respondió ${res.status}${detail ? ': ' + detail : ''}`);
  }
  return j.html_url;
}

module.exports = { describeTool, stagedDiff, review, prepareOn, commitAndPush, findClaude, prepare, launch, changes, accept, discard, git, slug, linkDeps, unlinkDeps, detectTests, runTests, githubRepoOf, pushBranch, openPR };

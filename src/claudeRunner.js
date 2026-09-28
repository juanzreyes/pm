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

/** Crea el worktree en una rama nueva a partir de lo que tengas en HEAD. */
async function prepare(repo, id, baseDir) {
  const dir = path.join(baseDir, `${slug(path.basename(repo))}-${id}`);
  const branch = `pm/claude-${id}`;
  fs.mkdirSync(baseDir, { recursive: true });
  await git(repo, ['worktree', 'add', '-b', branch, dir, 'HEAD']);
  return { dir, branch };
}

/**
 * Lanza Claude en el worktree. La petición va por la entrada estándar (sin problemas de comillas).
 * Devuelve { promise, kill }. La promesa resuelve { ok, result, cost, turns, sessionId, error }.
 */
function launch({ bin, cwd, prompt, permission = 'acceptEdits', timeoutMs = 30 * 60e3 }) {
  const c = command(bin, ['-p', '--output-format', 'json', '--permission-mode', permission]);
  const child = spawn(c.file, c.args, { cwd, shell: c.shell, windowsHide: true, env: { ...process.env, ...c.env } });
  let out = '';
  let err = '';
  let killedBy = '';
  child.stdout.on('data', (d) => { if (out.length < 5e6) out += d; });
  child.stderr.on('data', (d) => { if (err.length < 1e5) err += d; });
  child.stdin.on('error', () => { /* terminó antes de leer */ });
  child.stdin.end(prompt);
  const timer = setTimeout(() => { killedBy = 'timeout'; child.kill(); }, timeoutMs);
  const promise = new Promise((resolve) => {
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: 'No pude lanzar Claude Code: ' + e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killedBy) return resolve({ ok: false, error: killedBy === 'timeout' ? `Tardó más de ${Math.round(timeoutMs / 60e3)} min y lo paré` : 'Lo paraste' });
      let j = null;
      try { j = JSON.parse(out.trim().split('\n').filter(Boolean).pop()); } catch { /* no es JSON */ }
      if (j && typeof j === 'object') {
        return resolve({ ok: !j.is_error && code === 0, result: String(j.result || '').trim(), cost: Number(j.total_cost_usd) || 0, turns: j.num_turns || 0, sessionId: j.session_id || '', error: j.is_error ? String(j.result || j.subtype || 'error') : (code ? `Salió con código ${code}` : '') });
      }
      resolve({ ok: false, error: (err.trim() || out.trim() || `Salió con código ${code}`).split('\n').slice(-3).join(' ').slice(0, 400) });
    });
  });
  return { promise, kill: () => { killedBy = 'user'; child.kill(); } };
}

/** Cambios que dejó Claude (incluye archivos nuevos). */
async function changes(dir) {
  await git(dir, ['add', '-A']);
  const files = (await git(dir, ['diff', '--cached', '--name-only'])).split('\n').filter(Boolean);
  const short = await git(dir, ['diff', '--cached', '--shortstat']);
  const n = (re) => Number((short.match(re) || [])[1]) || 0;
  return { files, ins: n(/(\d+) insertion/), del: n(/(\d+) deletion/) };
}

/** Aceptar: commit en la rama del worktree y quita la carpeta (la rama queda para mezclarla). */
async function accept(run, message) {
  await git(run.dir, ['add', '-A']);
  const msg = message || `claude: ${run.text.split('\n')[0].slice(0, 60)}`;
  try {
    await git(run.dir, ['commit', '-m', msg]);
  } catch (e) {
    if (!/user\.(name|email)|identity|Please tell me who you are/i.test(e.message)) throw e;
    await git(run.dir, ['-c', 'user.name=PM Pollito', '-c', 'user.email=pm-pollito@localhost', 'commit', '-m', msg]);
  }
  await git(run.repo, ['worktree', 'remove', '--force', run.dir]);
  return run.branch;
}

/** Descartar: borra el worktree y su rama. */
async function discard(run) {
  try { await git(run.repo, ['worktree', 'remove', '--force', run.dir]); } catch { try { fs.rmSync(run.dir, { recursive: true, force: true }); await git(run.repo, ['worktree', 'prune']); } catch { /* ya no está */ } }
  try { await git(run.repo, ['branch', '-D', run.branch]); } catch { /* ya no está */ }
}

module.exports = { findClaude, prepare, launch, changes, accept, discard, git, slug };

// Git local: encuentra tus repositorios, lee tus commits (para el daily) y
// detecta cambios sin commit desde hace rato o trabajo directo en main.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// Quién lanza los procesos: por defecto aquí mismo; en la app, un hilo aparte (src/main/proc.js),
// porque en Windows abrir un proceso congela a quien lo abre.
let execImpl = (file, args, opts, cb) => execFile(file, args, opts, cb);
function setExec(fn) { execImpl = fn; }

function git(cwd, args) {
  return new Promise((resolve) => {
    execImpl('git', args, { cwd, timeout: 10000, windowsHide: true, maxBuffer: 8e6 }, (err, out) => {
      resolve(err ? null : String(out).trim());
    });
  });
}

// ---------- Actividad sin lanzar git ----------
// git anota cada commit, cambio de rama, fetch o push en .git/logs (los "reflogs"): con solo mirar
// la fecha de esos archivos se sabe si un repo tuvo movimiento, sin abrir ningún proceso.
function gitDir(repo) {
  const d = path.join(repo, '.git');
  try {
    const st = fs.statSync(d);
    if (st.isDirectory()) return d;
    const m = /gitdir:\s*(.+)/.exec(fs.readFileSync(d, 'utf8')); // worktree o submódulo
    if (m) return path.resolve(repo, m[1].trim());
  } catch { /* no es repo */ }
  return null;
}
function newestIn(dir, depth = 6) {
  let max = 0;
  let items;
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) { if (depth > 0) max = Math.max(max, newestIn(p, depth - 1)); } else {
      try { max = Math.max(max, fs.statSync(p).mtimeMs); } catch { /* borrado */ }
    }
  }
  return max;
}
/**
 * Última vez que se movió algo en el repo (commits, ramas, fetch/push), según sus reflogs.
 * Infinity si no se puede saber (sin reflogs): entonces sí hay que preguntarle a git.
 */
function refActivity(repo) {
  const g = gitDir(repo);
  if (!g) return Infinity;
  let head = 0;
  try { head = fs.statSync(path.join(g, 'logs', 'HEAD')).mtimeMs; } catch { /* sin reflog */ }
  const common = (() => { try { return path.resolve(g, fs.readFileSync(path.join(g, 'commondir'), 'utf8').trim()); } catch { return g; } })();
  const refs = newestIn(path.join(common, 'logs', 'refs'));
  const t = Math.max(head, refs);
  return t || Infinity;
}
/** Fecha del último movimiento de HEAD (≈ último commit) leyendo el final de .git/logs/HEAD. */
function lastHeadMove(repo) {
  const g = gitDir(repo);
  if (!g) return null;
  const f = path.join(g, 'logs', 'HEAD');
  let fd;
  try {
    const size = fs.statSync(f).size;
    fd = fs.openSync(f, 'r');
    const len = Math.min(size, 4096);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').trim().split('\n');
    const m = /> (\d{9,11}) [+-]\d{4}\t/.exec(lines[lines.length - 1] || '');
    return m ? Number(m[1]) * 1000 : null;
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

const SKIP = new Set(['node_modules', '.git', 'vendor', 'dist', 'build', '.next', 'bin', 'obj', 'venv', '.venv']);

/** Busca repositorios en las carpetas raíz (hasta 2 niveles de profundidad). */
function discover(roots) {
  const found = new Set();
  const visit = (dir, depth) => {
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (items.some((i) => i.name === '.git')) { found.add(dir); return; }
    if (depth <= 0) return;
    for (const i of items) {
      if (i.isDirectory() && !SKIP.has(i.name) && !i.name.startsWith('.')) visit(path.join(dir, i.name), depth - 1);
    }
  };
  for (const r of roots || []) if (r) visit(r, 2);
  return [...found].sort();
}

let emailCache = null;
async function myEmail() {
  if (emailCache === null) emailCache = (await git(process.cwd(), ['config', '--global', 'user.email'])) || '';
  return emailCache;
}

/** Tus commits entre dos fechas en todos los repos: [{ repo, hash, at, subject }] */
async function commits(repos, sinceMs, untilMs) {
  const email = await myEmail();
  const out = [];
  await Promise.all(repos.map(async (repo) => {
    // Sin movimiento en sus reflogs desde `sinceMs`, no puede haber commits nuevos: ni se pregunta.
    if (refActivity(repo) < sinceMs) return;
    const args = ['log', '--all', '--no-merges', `--since=${new Date(sinceMs).toISOString()}`, `--until=${new Date(untilMs).toISOString()}`, '--pretty=format:%h%x09%ct%x09%s'];
    if (email) args.push(`--author=${email}`);
    const txt = await git(repo, args);
    if (!txt) return;
    const seen = new Set();
    for (const line of txt.split('\n')) {
      const [hash, ct, ...rest] = line.split('\t');
      const subject = rest.join('\t');
      if (!hash || seen.has(subject)) continue; // mismo commit en varias ramas
      seen.add(subject);
      out.push({ repo: path.basename(repo), hash, at: Number(ct) * 1000, subject });
    }
  }));
  return out.sort((a, b) => a.at - b.at);
}

/** Estado de un repo: rama, archivos cambiados, fecha del último commit y del último cambio. */
async function status(repo) {
  // Un solo proceso (antes eran tres): la primera línea de --branch trae la rama.
  const out = await git(repo, ['status', '--porcelain', '--branch']);
  if (out === null) return null;
  const lines = out.split('\n');
  const head = (lines[0] || '').replace(/^## /, '');
  const branch = /^No commits yet on (.+)$/.exec(head) ? RegExp.$1 : /^HEAD \(no branch\)/.test(head) ? 'HEAD' : head.split('...')[0].split(' ')[0];
  let lastMs = lastHeadMove(repo);
  if (lastMs === null) { const last = await git(repo, ['log', '-1', '--format=%ct']); lastMs = last ? Number(last) * 1000 : 0; }
  const last = lastMs ? lastMs / 1000 : 0;
  const files = lines.slice(1).filter(Boolean);
  let lastChange = 0;
  for (const l of files.slice(0, 200)) {
    const f = l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop();
    try { lastChange = Math.max(lastChange, fs.statSync(path.join(repo, f)).mtimeMs); } catch { /* borrado */ }
  }
  return {
    repo: path.basename(repo),
    path: repo,
    branch,
    changed: files.length,
    lastCommitAt: last ? Number(last) * 1000 : 0,
    lastChangeAt: lastChange,
  };
}

/** Inicio del último día laborable (si hoy es lunes → el viernes). */
function lastWorkday(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
  const end = new Date(d);
  end.setDate(end.getDate() + 1);
  return { from: d.getTime(), to: end.getTime() };
}

/** Commits locales aún sin subir: { ahead, range, head } o null si no hay rama remota. */
async function unpushed(repo) {
  const up = await git(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (!up) return null;
  const [ahead, head] = await Promise.all([git(repo, ['rev-list', '--count', '@{u}..HEAD']), git(repo, ['rev-parse', 'HEAD'])]);
  return { ahead: Number(ahead) || 0, range: '@{u}..HEAD', head, upstream: up };
}

module.exports = { discover, commits, status, lastWorkday, unpushed, run: git, setExec, refActivity, lastHeadMove };

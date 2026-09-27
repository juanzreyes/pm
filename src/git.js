// Git local: encuentra tus repositorios, lee tus commits (para el daily) y
// detecta cambios sin commit desde hace rato o trabajo directo en main.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 10000, windowsHide: true, maxBuffer: 8e6 }, (err, out) => {
      resolve(err ? null : String(out).trim());
    });
  });
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
  const [branch, porcelain, last] = await Promise.all([
    git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(repo, ['status', '--porcelain']),
    git(repo, ['log', '-1', '--format=%ct']),
  ]);
  if (branch === null) return null;
  const files = porcelain ? porcelain.split('\n').filter(Boolean) : [];
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

module.exports = { discover, commits, status, lastWorkday };

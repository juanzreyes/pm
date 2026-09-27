// Memoria de proyecto: lo que PM sabe de un repo, escrito en su CLAUDE.md entre marcas
// (<!-- pm-pollito:start --> … <!-- pm-pollito:end -->) para que Claude Code lo lea.
// Nunca toca el resto del archivo.
const fs = require('fs');
const path = require('path');

const START = '<!-- pm-pollito:start -->';
const END = '<!-- pm-pollito:end -->';

/** Comandos de test/build/lint que se detectan en el repo. */
function detectCommands(repo) {
  const out = [];
  const pkg = (() => { try { return JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')); } catch { return null; } })();
  if (pkg && pkg.scripts) {
    const pm = fs.existsSync(path.join(repo, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(repo, 'yarn.lock')) ? 'yarn' : 'npm';
    for (const k of ['test', 'build', 'lint', 'dev', 'start', 'typecheck', 'e2e', 'dist']) {
      if (pkg.scripts[k]) out.push(`\`${pm === 'npm' && !['test', 'start'].includes(k) ? 'npm run ' + k : pm + ' ' + k}\` → ${pkg.scripts[k]}`);
    }
  }
  if (fs.existsSync(path.join(repo, 'pyproject.toml')) || fs.existsSync(path.join(repo, 'pytest.ini'))) out.push('`pytest` (tests de Python)');
  if (fs.existsSync(path.join(repo, 'Cargo.toml'))) out.push('`cargo test` · `cargo build`');
  if (fs.existsSync(path.join(repo, 'go.mod'))) out.push('`go test ./...` · `go build ./...`');
  if (fs.existsSync(path.join(repo, 'Makefile'))) out.push('`make` (hay Makefile)');
  if (fs.readdirSync(repo).some((f) => /\.(sln|csproj)$/.test(f))) out.push('`dotnet build` · `dotnet test`');
  return out;
}

const norm = (s) => String(s || '').toLowerCase();

/**
 * data: store.data · repo: ruta del repo · devLog: [{ at, cmd, line }] fallos recientes de ese proyecto
 */
function build(data, repo, devLog = []) {
  const name = path.basename(repo);
  const L = [];
  // Tiempo dedicado (últimos 30 días)
  let secs = 0, days = 0;
  const branches = {};
  for (const [k, v] of Object.entries(data.days || {})) {
    if (Date.now() - Date.parse(k) > 31 * 864e5) continue;
    const t = Object.entries(v.projects || {}).filter(([p]) => norm(p) === norm(name)).reduce((a, [, s]) => a + s, 0);
    if (t) { secs += t; days++; }
    for (const [b, s] of Object.entries(v.branches || {})) if (b.startsWith(name + ' · ')) branches[b.slice(name.length + 3)] = (branches[b.slice(name.length + 3)] || 0) + s;
  }
  // Decisiones anotadas en las notas del día
  const decisions = [];
  for (const [k, v] of Object.entries(data.days || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1))) {
    for (const line of String(v.notes || '').split('\n')) {
      if (/(decisi[oó]n|decidimos|acordamos|decided|convenci[oó]n|regla)\s*:?/i.test(line) && (norm(line).includes(norm(name)) || decisions.length < 8)) decisions.push(`${k}: ${line.trim().slice(0, 160)}`);
      if (decisions.length >= 10) break;
    }
    if (decisions.length >= 10) break;
  }
  // Errores frecuentes (vigilante de tests y builds)
  const freq = {};
  for (const f of devLog) { const k = `\`${f.cmd}\`${f.line ? `: ${f.line}` : ''}`; freq[k] = (freq[k] || 0) + 1; }
  const errors = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 6);
  // Hitos del proyecto
  const ms = (data.milestones || []).filter((m) => !m.done && norm(m.project) === norm(name));

  L.push(START);
  L.push(`## 🐣 Contexto de PM Pollito (lo mantiene PM; no editar entre las marcas)`);
  L.push('');
  const cmds = detectCommands(repo);
  if (cmds.length) { L.push('**Comandos del proyecto**'); cmds.forEach((c) => L.push(`- ${c}`)); L.push(''); }
  if (errors.length) { L.push('**Errores frecuentes recientes** (tests/builds que fallaron)'); errors.forEach(([k, n]) => L.push(`- ${n}× ${k}`)); L.push(''); }
  if (decisions.length) { L.push('**Decisiones anotadas**'); decisions.forEach((d) => L.push(`- ${d}`)); L.push(''); }
  if (ms.length) { L.push('**Próximas entregas**'); ms.forEach((m) => L.push(`- ${m.title} → ${m.due}`)); L.push(''); }
  const hrs = (s) => (s / 3600).toFixed(1).replace('.', ',') + ' h';
  if (secs >= 600) {
    const topB = Object.entries(branches).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([b, s]) => `${b} (${hrs(s)})`);
    L.push(`**Actividad**: ${hrs(secs)} en ${days} día${days === 1 ? '' : 's'} (últimos 30)${topB.length ? ` · ramas: ${topB.join(', ')}` : ''}`);
    L.push('');
  }
  L.push(`_Actualizado por PM Pollito el ${new Date().toLocaleString('es')}._`);
  L.push(END);
  return L.join('\n');
}

/** Inserta o reemplaza el bloque de PM en CLAUDE.md. Devuelve la ruta. */
function write(repo, section) {
  const file = path.join(repo, 'CLAUDE.md');
  let cur = '';
  try { cur = fs.readFileSync(file, 'utf8'); } catch { cur = `# ${path.basename(repo)}\n\n`; }
  const i = cur.indexOf(START), j = cur.indexOf(END);
  const next = i >= 0 && j > i ? cur.slice(0, i) + section + cur.slice(j + END.length) : cur.replace(/\s*$/, '\n\n') + section + '\n';
  fs.writeFileSync(file, next);
  return file;
}

module.exports = { build, write, detectCommands, START, END };

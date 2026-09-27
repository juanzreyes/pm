// Prepara la carpeta public/ con lo necesario para que cualquier persona instale PM Pollito:
//   - PM-Pollito-Setup-<versión>.exe   (instalador de Windows)
//   - pm-pollito-vscode-<versión>.vsix (extensión opcional para VS Code)
//   - LEEME.txt                         (instrucciones de instalación)
//   - SHA256.txt                        (huellas para comprobar que los archivos no se alteraron)
// Se ejecuta solo después de "npm run dist" (script postdist).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const pub = path.join(root, 'public');
const dist = path.join(root, 'dist');
const extDir = path.join(root, 'vscode-extension');

fs.mkdirSync(pub, { recursive: true });

// 1) Limpia versiones anteriores para que solo quede la última.
for (const f of fs.readdirSync(pub)) {
  if (/^PM-Pollito-Setup-.*\.exe$/i.test(f) || /\.vsix$/i.test(f)) fs.unlinkSync(path.join(pub, f));
}

// 2) Instalador.
const setup = `PM-Pollito-Setup-${version}.exe`;
const setupSrc = path.join(dist, setup);
if (!fs.existsSync(setupSrc)) {
  console.error(`No encontré ${setupSrc}. Ejecuta primero "npm run dist".`);
  process.exit(1);
}
fs.copyFileSync(setupSrc, path.join(pub, setup));

// 3) Extensión de VS Code (opcional: si falla, se sigue sin ella).
let vsix = null;
try {
  const extPkg = JSON.parse(fs.readFileSync(path.join(extDir, 'package.json'), 'utf8'));
  const built = `pm-pollito-${extPkg.version}.vsix`;
  execSync('npx --yes @vscode/vsce package --allow-missing-repository --skip-license', { cwd: extDir, stdio: 'ignore' });
  vsix = `pm-pollito-vscode-${extPkg.version}.vsix`;
  fs.copyFileSync(path.join(extDir, built), path.join(pub, vsix));
} catch (e) {
  console.warn('No se pudo empaquetar la extensión de VS Code:', e.message);
}

// 4) Huellas SHA-256.
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(pub, f))).digest('hex');
const files = [setup, vsix].filter(Boolean);
fs.writeFileSync(path.join(pub, 'SHA256.txt'), files.map((f) => `${sha(f)}  ${f}`).join('\r\n') + '\r\n');

// 5) Instrucciones.
const mb = (f) => (fs.statSync(path.join(pub, f)).size / 1048576).toFixed(1);
const date = new Date().toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
const leeme = `PM POLLITO ${version} 🐣  —  tu pollito Project Manager
Hecho con ❤️ por Juanzreyes · ${date}
=====================================================================

QUÉ ES
Un pollito que vive en tu escritorio, siempre encima de tus ventanas: vigila cuánto
llevas gastado de tus límites de Claude, te pregunta cada mañana qué vas a hacer,
te avisa de reuniones y recordatorios, te regaña si te distraes y es un tamagotchi
al que cuidar (comida, baños, siestas, accesorios y logros).

REQUISITOS
- Windows 10 u 11 (64 bits).
- Opcional: una cuenta de Claude (Pro o Max) para ver tus límites de uso.

INSTALAR (1 minuto)
1. Haz doble clic en  ${setup}  (${mb(setup)} MB).
2. Si Windows muestra "Windows protegió su PC", pulsa "Más información" y luego
   "Ejecutar de todas formas". (Aparece porque el instalador aún no está firmado
   con un certificado; el archivo es seguro: puedes comprobarlo con SHA256.txt.)
3. Elige la carpeta (o deja la que viene) y pulsa Instalar.
4. Al terminar, el pollito sale de su huevo en tu escritorio: ponle nombre. 🥚➜🐣
5. Para ver tus límites de Claude: clic en el pollito → pestaña "Uso" →
   "Conectar con mi cuenta de Claude" e inicia sesión en la página oficial.

PRIMEROS PASOS
- Clic en el pollito: abre el panel.  Clic derecho: menú rápido.  Arrástralo a donde quieras.
- Ctrl+Alt+Espacio: paleta de comandos desde cualquier app.
- Ctrl+Alt+P: anotar una tarea o un recordatorio ("recuérdame a las 3 revisar el informe").
- En el panel, la lista "Configura tu pollito" te guía por lo más útil.
- Ajustes (icono ⚙️): tema oscuro, tamaño, privacidad, integraciones, idioma (English).
${vsix ? `
EXTENSIÓN PARA VS CODE (opcional)
Muestra el pollito en la barra de estado de VS Code (% de Claude, pomodoro, tareas).
- En VS Code: menú Extensiones (Ctrl+Shift+X) → "..." → "Instalar desde VSIX…"
  → elige  ${vsix}
- O en una terminal:  code --install-extension ${vsix}
` : ''}
PRIVACIDAD
Todo se guarda solo en tu PC (%APPDATA%\\pm-pollito). No hay servidores propios:
PM solo habla con Claude, GitHub o tu correo si tú los conectas. En Ajustes →
Privacidad puedes pausar el seguimiento, exportar o borrar todos tus datos.

DESINSTALAR
Configuración de Windows → Aplicaciones → "PM Pollito" → Desinstalar.

COMPROBAR LOS ARCHIVOS (opcional)
En PowerShell:  Get-FileHash .\\${setup}  y compara con SHA256.txt.
`;
fs.writeFileSync(path.join(pub, 'LEEME.txt'), '﻿' + leeme.replace(/\n/g, '\r\n'));

// 6) Web de descarga (index.html): se puede subir tal cual a cualquier hosting estático.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
let changes = '';
try {
  const log = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split('\n');
  let open = false;
  for (const line of log) {
    if (line.startsWith('## ')) { if (open) changes += '</ul>'; changes += `<h3>${md(line.slice(3))}</h3><ul>`; open = true; }
    else if (line.startsWith('- ') && open) changes += `<li>${md(line.slice(2))}</li>`;
  }
  if (open) changes += '</ul>';
} catch { /* sin changelog */ }
let icon = '';
try { icon = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'build', 'icon.png')).toString('base64'); } catch { /* sin icono */ }
const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PM Pollito — tu pollito Project Manager</title>
<meta name="description" content="Un pollito que vive en tu escritorio: vigila tus límites de Claude, organiza tu día y se integra con Claude Code.">
<style>
:root{--ink:#3b2f2f;--muted:#8a7a6a;--bg:#fff9e8;--card:#fffdf6;--line:#efe2bf;--y:#ffd84a;--o:#ff9f1c}
@media (prefers-color-scheme:dark){:root{--ink:#f3e8d2;--muted:#b3a58e;--bg:#1d1a17;--card:#26221e;--line:#463c33}}
*{box-sizing:border-box}body{margin:0;font-family:"Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--ink);line-height:1.5}
main{max-width:860px;margin:0 auto;padding:40px 18px}
header{display:flex;gap:18px;align-items:center;flex-wrap:wrap}header img{width:96px;height:96px}
h1{margin:0;font-size:38px}.sub{color:var(--muted);font-size:17px;margin:4px 0 0}
.cta{display:flex;gap:12px;flex-wrap:wrap;margin:26px 0}
.btn{display:inline-flex;align-items:center;gap:8px;padding:14px 22px;border-radius:14px;font-weight:800;text-decoration:none;border:2px solid var(--ink);color:#3b2f2f;background:var(--o);box-shadow:0 4px 0 var(--ink)}
.btn.alt{background:var(--card);color:var(--ink)}.btn small{font-weight:600;opacity:.75}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin:18px 0}
.card{background:var(--card);border:2px solid var(--line);border-radius:16px;padding:14px}.card b{display:block;margin-bottom:4px}
code{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:0 5px;font-size:.9em}
.sha{font:12px Consolas,monospace;color:var(--muted);word-break:break-all}
h2{margin-top:36px}h3{margin:18px 0 6px}ul{margin:0;padding-left:20px}footer{margin-top:40px;color:var(--muted);font-size:14px;text-align:center}
</style></head><body><main>
<header>${icon ? `<img src="${icon}" alt="">` : ''}<div><h1>PM Pollito</h1><p class="sub">Tu pollito Project Manager 🐣 · versión ${esc(version)} · ${esc(date)}</p></div></header>
<div class="cta">
  <a class="btn" href="${esc(setup)}" download>⬇️ Descargar para Windows <small>${mb(setup)} MB</small></a>
  ${vsix ? `<a class="btn alt" href="${esc(vsix)}" download>🧩 Extensión de VS Code</a>` : ''}
  <a class="btn alt" href="LEEME.txt">📄 Cómo instalar</a>
</div>
<div class="grid">
  <div class="card"><b>📊 Tus límites de Claude</b>Cuánto llevas, cuándo se reinicia y a qué hora llegarás al 100%.</div>
  <div class="card"><b>🧩 Dentro de Claude Code</b>MCP, línea de estado, sesiones en vivo y memoria de proyecto.</div>
  <div class="card"><b>☀️ Tu día organizado</b>Daily, tareas, bloques de tiempo, foco, hábitos, notas e informes.</div>
  <div class="card"><b>🐣 Un tamagotchi</b>Aliméntalo, decórale la casita, colecciona huevos y elige su personalidad.</div>
</div>
<h2>Novedades</h2>${changes}
<h2>Comprobar la descarga</h2><p>En PowerShell: <code>Get-FileHash .\\${esc(setup)}</code> y compara:</p>
<p class="sha">${files.map((f) => `${sha(f)} &nbsp;${esc(f)}`).join('<br>')}</p>
<footer>Hecho con ❤️ por Juanzreyes · Todo se guarda en tu PC</footer>
</main></body></html>`;
fs.writeFileSync(path.join(pub, 'index.html'), html);

console.log(`\n✅ public/ listo para compartir (versión ${version}):`);
for (const f of fs.readdirSync(pub)) console.log(`   - ${f}`);

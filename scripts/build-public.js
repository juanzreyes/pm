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

console.log(`\n✅ public/ listo para compartir (versión ${version}):`);
for (const f of fs.readdirSync(pub)) console.log(`   - ${f}`);

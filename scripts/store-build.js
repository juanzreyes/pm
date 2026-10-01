// Compila el paquete para la Microsoft Store (.appx) con los datos de TU cuenta de Partner Center.
//   npm run dist:store
// Los datos salen de store.config.json (no se sube a git) o de variables de entorno:
//   { "identityName": "12345Tunombre.PMPollito", "publisher": "CN=XXXXXXXX-XXXX-...", "publisherDisplayName": "Tu nombre" }
// Los tres están en Partner Center → tu app → Administración de productos → Identidad del producto.
// La Store firma el paquete al publicarlo: aquí no hace falta certificado.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const file = path.join(ROOT, 'store.config.json');
let cfg = {};
if (fs.existsSync(file)) {
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { fail(`store.config.json no es JSON válido: ${e.message}`); }
}
const identityName = process.env.PM_STORE_IDENTITY || cfg.identityName;
const publisher = process.env.PM_STORE_PUBLISHER || cfg.publisher;
const publisherDisplayName = process.env.PM_STORE_PUBLISHER_NAME || cfg.publisherDisplayName;

function fail(msg) {
  console.error(`\n✖ ${msg}\n\nCrea store.config.json en la raíz del proyecto con los datos de Partner Center\n(tu app → Administración de productos → Identidad del producto):\n\n{\n  "identityName": "12345Tunombre.PMPollito",\n  "publisher": "CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",\n  "publisherDisplayName": "Tu nombre"\n}\n`);
  process.exit(1);
}
if (!identityName || !publisher || !publisherDisplayName) fail('Faltan datos de Partner Center.');
if (!/^CN=/.test(publisher)) fail(`"publisher" debe empezar por CN= (copia "Package/Identity/Publisher" tal cual): ${publisher}`);
if (!/^[A-Za-z0-9.-]{3,50}$/.test(identityName)) fail(`"identityName" no parece válido: ${identityName}`);

// Si tienes el SDK de Windows, se usa su makeappx (la caché de electron-builder a veces no se
// puede extraer sin permisos de enlaces simbólicos). Los logos están en build/appx.
const env = { ...process.env };
if (!env.ELECTRON_BUILDER_WINDOWS_KITS_PATH && process.platform === 'win32') {
  const kits = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
  const sdk = (fs.existsSync(kits) ? fs.readdirSync(kits) : []).filter((v) => /^10\./.test(v)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((v) => path.join(kits, v, 'x64')).find((d) => fs.existsSync(path.join(d, 'makeappx.exe')) && fs.existsSync(path.join(d, 'makepri.exe')));
  if (sdk) { env.ELECTRON_BUILDER_WINDOWS_KITS_PATH = sdk; console.log('▶ SDK de Windows: ' + sdk); }
}

const args = ['--win', 'appx', '--publish', 'never',
  `-c.appx.identityName=${identityName}`, `-c.appx.publisher=${publisher}`, `-c.appx.publisherDisplayName=${publisherDisplayName}`];
if (process.env.PM_DIST_DIR) args.push(`-c.directories.output=${process.env.PM_DIST_DIR}`);
console.log('▶ electron-builder ' + args.join(' '));
// Sin shell: así un nombre con espacios ("Juan Ramon Reyes Linares") llega entero.
const r = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), ...args], { cwd: ROOT, stdio: 'inherit', env });
if (r.status !== 0) process.exit(r.status || 1);
console.log('\n✔ Listo: sube el .appx de la carpeta dist a Partner Center → tu app → Envíos → Paquetes.');

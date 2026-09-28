// Antes de "npm run release": comprueba que se puede publicar sin sorpresas.
//  - hay un token de GitHub (GH_TOKEN) para subir el instalador
//  - la versión de package.json aún no está publicada
//  - el CHANGELOG tiene la entrada de esta versión (las copias instaladas la muestran como novedades)
// Después, "prerelease" corre todos los tests.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const pub = (pkg.build.publish || []).find((p) => p.provider === 'github');
const fail = (msg) => { console.error(`\n❌ ${msg}\n`); process.exit(1); };

(async () => {
  if (!pub) fail('Falta build.publish (GitHub) en package.json.');
  if (!process.env.GH_TOKEN) fail('Falta GH_TOKEN: crea un token en https://github.com/settings/tokens (permiso "repo" o "contents: write") y en PowerShell: $env:GH_TOKEN = "…"');
  const log = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  if (!log.includes(`## ${pkg.version}`)) fail(`El CHANGELOG no tiene "## ${pkg.version}". Añade las novedades antes de publicar.`);
  const res = await fetch(`https://api.github.com/repos/${pub.owner}/${pub.repo}/releases/tags/v${pkg.version}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, 'User-Agent': 'pm-pollito-release' },
  });
  if (res.status === 200) fail(`La versión ${pkg.version} ya está publicada. Sube "version" en package.json.`);
  if (res.status === 401) fail('GitHub no aceptó el GH_TOKEN.');
  console.log(`✅ Listo para publicar la ${pkg.version} en github.com/${pub.owner}/${pub.repo} (ahora corren los tests).`);
})().catch((e) => fail('No pude comprobar GitHub: ' + e.message));

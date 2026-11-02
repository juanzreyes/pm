// Arma la app web de Android en mobile/www a partir del MISMO código de la PC:
//  · host.bundle.js    = main.js + src/** + la capa que imita Node y Electron (shim/)
//  · preload.bundle.js = preload.js de la PC con ipcRenderer del teléfono (va en cada pantalla)
//  · renderer/**       = las pantallas de la PC, con preload.bundle.js y mobile.css al principio
//  · appfiles.json     = los archivos que main.js lee del disco (CHANGELOG, configuraciones…)
//   node build.mjs [--serve]   (--serve: además, la sirve en http://localhost:5320 para probar)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = path.join(HERE, 'www');
const S = (f) => path.join(HERE, 'shim', f);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const alias = {
  electron: S('electron.js'), fs: S('fs.js'), 'fs/promises': S('fs.js'), os: S('os.js'), path: 'path-browserify',
  child_process: S('child_process.js'), worker_threads: S('worker_threads.js'), http: S('http.js'), https: S('http.js'),
  crypto: S('crypto.js'), url: S('url.js'), events: 'events', inspector: S('empty.js'), imapflow: S('imapflow.js'),
  'electron-updater': S('updater.js'), zlib: S('empty.js'), net: S('empty.js'), tls: S('empty.js'), dns: S('empty.js'),
  readline: S('empty.js'), stream: S('empty.js'), util: S('util.js'), assert: S('empty.js'), v8: S('empty.js'), perf_hooks: S('empty.js'),
};
const common = {
  bundle: true, platform: 'browser', format: 'iife', target: ['chrome100'], logLevel: 'warning', sourcemap: 'linked',
  alias, inject: [S('globals.js')], mainFields: ['browser', 'module', 'main'],
  define: { __dirname: '"/app"', __filename: '"/app/main.js"', __PM_VERSION__: JSON.stringify(pkg.version), 'process.env.NODE_ENV': '"production"' },
  nodePaths: [path.join(HERE, 'node_modules'), path.join(ROOT, 'node_modules')],
};
await build({ ...common, entryPoints: [path.join(HERE, 'host', 'boot.js')], outfile: path.join(OUT, 'host.bundle.js') });
await build({ ...common, entryPoints: [path.join(ROOT, 'preload.js')], outfile: path.join(OUT, 'preload.bundle.js'), alias: { ...alias, electron: S('renderer-electron.js') } });

// Pantallas de la PC (con la capa del teléfono al principio de <head>).
function copyDir(from, to, map) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b, map);
    else if (map && e.name.endsWith('.html')) fs.writeFileSync(b, map(fs.readFileSync(a, 'utf8')));
    else fs.copyFileSync(a, b);
  }
}
copyDir(path.join(ROOT, 'renderer'), path.join(OUT, 'renderer'), (html) => html.replace(/<head>/i, '<head>\n  <script src="../preload.bundle.js"></script>\n  <link rel="stylesheet" href="../mobile.css" />'));
fs.mkdirSync(path.join(OUT, 'src'), { recursive: true });
for (const f of ['i18n.js', 'i18n-extra.js']) fs.copyFileSync(path.join(ROOT, 'src', f), path.join(OUT, 'src', f));
fs.mkdirSync(path.join(OUT, 'build'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'build', 'icon.png'), path.join(OUT, 'build', 'icon.png'));
fs.copyFileSync(path.join(HERE, 'host', 'index.html'), path.join(OUT, 'index.html'));
fs.copyFileSync(path.join(HERE, 'host', 'host.css'), path.join(OUT, 'host.css'));
fs.copyFileSync(path.join(HERE, 'host', 'mobile.css'), path.join(OUT, 'mobile.css'));

// Archivos que main.js lee del disco.
const appFiles = {};
for (const f of ['package.json', 'CHANGELOG.md', 'PLUGINS.md', 'pm-equipo.json', 'oauth.config.example.json', 'oauth.config.json', 'reporting.config.json']) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) appFiles[f] = fs.readFileSync(p, 'utf8');
}
fs.writeFileSync(path.join(OUT, 'appfiles.json'), JSON.stringify(appFiles));
const kb = (f) => Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + ' KB';
console.log(`www listo · host ${kb('host.bundle.js')} · preload ${kb('preload.bundle.js')} · versión ${pkg.version}`);

if (process.argv.includes('--serve')) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.map': 'application/json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
  http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = path.join(OUT, u === '/' ? 'index.html' : u);
    if (!f.startsWith(OUT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  }).listen(5320, () => console.log('Sirviendo en http://localhost:5320'));
}

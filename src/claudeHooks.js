// Conexión con Claude Code mediante "hooks": Claude Code avisa al pollito cuando
// empieza a trabajar, cuando termina y cuando necesita tu permiso o tu respuesta.
// Los hooks solo hacen una petición a un servidor local (127.0.0.1); si PM está
// cerrado, fallan en silencio y Claude Code sigue normal.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 47823;
const MARK = `127.0.0.1:${PORT}/claude-hook`;
const COMMAND = `curl -s -m 2 -X POST -H "Content-Type: application/json" --data-binary @- http://${MARK} || exit 0`;
const EVENTS = ['UserPromptSubmit', 'Stop', 'Notification'];

function settingsPath() {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(dir, 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error('No pude leer tu settings.json de Claude Code: ' + e.message);
  }
}

const isOurs = (entry) => (entry && entry.hooks || []).some((h) => String(h.command || '').includes(MARK));

function installed() {
  try {
    const s = readSettings();
    return EVENTS.every((ev) => ((s.hooks && s.hooks[ev]) || []).some(isOurs));
  } catch {
    return false;
  }
}

function writeSettings(s) {
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.pm-backup');
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
}

/** Añade los hooks de PM a ~/.claude/settings.json (con copia de seguridad). */
function install() {
  const s = readSettings();
  s.hooks = s.hooks || {};
  for (const ev of EVENTS) {
    const list = Array.isArray(s.hooks[ev]) ? s.hooks[ev] : [];
    if (!list.some(isOurs)) list.push({ hooks: [{ type: 'command', command: COMMAND, timeout: 5 }] });
    s.hooks[ev] = list;
  }
  writeSettings(s);
}

/** Quita solo los hooks de PM y deja el resto intacto. */
function uninstall() {
  const s = readSettings();
  if (!s.hooks) return;
  for (const ev of EVENTS) {
    if (!Array.isArray(s.hooks[ev])) continue;
    s.hooks[ev] = s.hooks[ev].filter((e) => !isOurs(e));
    if (!s.hooks[ev].length) delete s.hooks[ev];
  }
  if (!Object.keys(s.hooks).length) delete s.hooks;
  writeSettings(s);
}

/** Servidor local que recibe los eventos de Claude Code. */
function startServer(onEvent) {
  const server = http.createServer((req, res) => {
    const ip = req.socket.remoteAddress;
    if (!(ip === '127.0.0.1' || ip === '::ffff:127.0.0.1' || ip === '::1') || req.method !== 'POST' || !req.url.startsWith('/claude-hook')) {
      res.writeHead(404);
      return res.end();
    }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      res.writeHead(204); // sin salida: Claude Code no recibe ninguna instrucción
      res.end();
      try { onEvent(JSON.parse(body || '{}')); } catch { /* evento raro */ }
    });
  });
  server.on('error', () => {}); // puerto ocupado: otra instancia ya escucha
  server.listen(PORT, '127.0.0.1');
  return server;
}

module.exports = { install, uninstall, installed, startServer, settingsPath };

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

/**
 * Servidor local (solo 127.0.0.1):
 *  - POST /claude-hook  → eventos de Claude Code
 *  - GET  /status       → estado para la extensión de VS Code
 *  - POST /command      → comandos permitidos desde la extensión ({ cmd })
 *  - POST /capture      → anotar tarea o recordatorio ({ text })
 * /status, /command y /capture exigen la cabecera "X-PM: 1" (una web no puede enviarla sin permiso).
 */
function startServer(onEvent, api = {}) {
  const server = http.createServer((req, res) => {
    const ip = req.socket.remoteAddress;
    if (!(ip === '127.0.0.1' || ip === '::ffff:127.0.0.1' || ip === '::1')) {
      res.writeHead(403);
      return res.end();
    }
    const url = (req.url || '').split('?')[0];
    const fromExtension = req.headers['x-pm'] === '1' && !req.headers.origin;
    if (url !== '/claude-hook') {
      if (!fromExtension) { res.writeHead(403); return res.end(); }
      if (req.method === 'GET' && url === '/status' && api.status) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(api.status()));
      }
      if (req.method === 'POST' && (url === '/command' || url === '/capture')) {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 1e4) req.destroy(); });
        req.on('end', () => {
          let data = {};
          try { data = JSON.parse(body || '{}'); } catch { /* vacío */ }
          const ok = url === '/command' ? api.command && api.command(String(data.cmd || '')) : api.capture && api.capture(String(data.text || ''));
          res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: !!ok }));
        });
        return;
      }
      res.writeHead(404);
      return res.end();
    }
    if (req.method !== 'POST') {
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

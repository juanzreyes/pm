// Integraciones con Claude Code y Claude Desktop:
//  · MCP del pollito en Claude Code (~/.claude.json, transporte HTTP local con clave)
//  · MCP en Claude Desktop (claude_desktop_config.json, puente por stdio)
//  · Línea de estado de Claude Code (~/.claude/settings.json → statusLine)
// Siempre con copia de seguridad (.pm-backup) y sin tocar nada que no sea nuestro.
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 47823;
const NAME = 'pm-pollito';
const STATUS_MARK = `127.0.0.1:${PORT}/statusline`;

const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const codeConfig = () => path.join(os.homedir(), '.claude.json');
const codeSettings = () => path.join(claudeDir(), 'settings.json');
const desktopConfig = () => path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`No pude leer ${path.basename(file)}: ${e.message}`);
  }
}
/** Escritura atómica con copia de seguridad del original. */
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.pm-backup');
  const tmp = file + '.pm-tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// ---------- MCP en Claude Code ----------
function codeMcpEntry(token) {
  return { type: 'http', url: `http://127.0.0.1:${PORT}/mcp`, headers: { 'X-PM': '1', Authorization: `Bearer ${token}` } };
}
function mcpCodeInstalled() {
  try { return !!(readJson(codeConfig()).mcpServers || {})[NAME]; } catch { return false; }
}
function installMcpCode(token) {
  const j = readJson(codeConfig());
  j.mcpServers = j.mcpServers || {};
  j.mcpServers[NAME] = codeMcpEntry(token);
  writeJson(codeConfig(), j);
}
function uninstallMcpCode() {
  const j = readJson(codeConfig());
  if (!j.mcpServers || !j.mcpServers[NAME]) return;
  delete j.mcpServers[NAME];
  writeJson(codeConfig(), j);
}

// ---------- MCP en Claude Desktop (puente stdio) ----------
function desktopAvailable() {
  return fs.existsSync(path.dirname(desktopConfig()));
}
function mcpDesktopInstalled() {
  try { return !!(readJson(desktopConfig()).mcpServers || {})[NAME]; } catch { return false; }
}
/** exe: ejecutable de PM (o electron en desarrollo) · bridge: ruta a mcp/bridge.js */
function installMcpDesktop(token, exe, bridge) {
  const j = readJson(desktopConfig());
  j.mcpServers = j.mcpServers || {};
  j.mcpServers[NAME] = { command: exe, args: [bridge], env: { ELECTRON_RUN_AS_NODE: '1', PM_MCP_TOKEN: token } };
  writeJson(desktopConfig(), j);
}
function uninstallMcpDesktop() {
  const j = readJson(desktopConfig());
  if (!j.mcpServers || !j.mcpServers[NAME]) return;
  delete j.mcpServers[NAME];
  writeJson(desktopConfig(), j);
}

// ---------- Línea de estado de Claude Code ----------
const STATUS_COMMAND = `curl -s -m 1 -X POST -H "X-PM: 1" -H "Content-Type: application/json" --data-binary @- http://${STATUS_MARK} || echo "🐣 PM cerrado"`;
function statusInfo() {
  try {
    const s = readJson(codeSettings());
    const cur = s.statusLine;
    return { installed: !!(cur && String(cur.command || '').includes(STATUS_MARK)), other: !!(cur && !String(cur.command || '').includes(STATUS_MARK)) };
  } catch { return { installed: false, other: false }; }
}
/** Instala la línea de estado; si había otra, la guarda para restaurarla después. */
function installStatusLine() {
  const s = readJson(codeSettings());
  if (s.statusLine && !String(s.statusLine.command || '').includes(STATUS_MARK)) s.pmPreviousStatusLine = s.statusLine;
  s.statusLine = { type: 'command', command: STATUS_COMMAND, padding: 0 };
  writeJson(codeSettings(), s);
}
function uninstallStatusLine() {
  const s = readJson(codeSettings());
  if (!s.statusLine || !String(s.statusLine.command || '').includes(STATUS_MARK)) return;
  if (s.pmPreviousStatusLine) { s.statusLine = s.pmPreviousStatusLine; delete s.pmPreviousStatusLine; } else delete s.statusLine;
  writeJson(codeSettings(), s);
}

module.exports = {
  mcpCodeInstalled, installMcpCode, uninstallMcpCode,
  desktopAvailable, mcpDesktopInstalled, installMcpDesktop, uninstallMcpDesktop,
  statusInfo, installStatusLine, uninstallStatusLine,
  codeConfig, desktopConfig, codeSettings,
};

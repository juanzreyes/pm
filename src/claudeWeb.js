// Conexión con tu cuenta de Claude a través del navegador (sin consola).
// El inicio de sesión ocurre en la página oficial de claude.ai dentro de una ventana
// de PM; PM nunca ve tu contraseña. Las cookies se guardan en una partición propia
// de Electron y solo se usan para consultar tu página de uso en claude.ai.
const { BrowserWindow, session, app } = require('electron');
const { parseLimits } = require('./usage');

const PARTITION = 'persist:claude-web';
const BASE = 'https://claude.ai';
let ses = null;
let loginWin = null;
let helperWin = null;
let helperTimer = null;

function getSession() {
  if (!ses) {
    ses = session.fromPartition(PARTITION);
    // Agente de usuario de Chrome normal (sin la marca "Electron") para que claude.ai cargue bien.
    const ua = (app.userAgentFallback || '').replace(/\s*Electron\/\S+/i, '').replace(/\s*pm-pollito\/\S+/i, '');
    if (ua) ses.setUserAgent(ua);
  }
  return ses;
}

class WebError extends Error {
  constructor(msg, status) {
    super(msg);
    this.status = status;
  }
}

async function viaSession(pathname) {
  const res = await getSession().fetch(BASE + pathname, {
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Referer: BASE + '/settings/usage' },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json };
}

// Plan B: hace la petición desde una ventana oculta de claude.ai (igual que la propia web).
async function viaHelper(pathname) {
  if (!helperWin || helperWin.isDestroyed()) {
    helperWin = new BrowserWindow({ show: false, webPreferences: { partition: PARTITION } });
    await helperWin.loadURL(BASE + '/settings/usage').catch(() => {});
  }
  clearTimeout(helperTimer);
  helperTimer = setTimeout(() => { if (helperWin && !helperWin.isDestroyed()) helperWin.destroy(); helperWin = null; }, 90000);
  const code = `fetch(${JSON.stringify(pathname)}, { headers: { Accept: 'application/json' } })
      .then(async (r) => ({ status: r.status, text: await r.text() }))
      .catch((e) => ({ status: 0, text: String(e) }))`;
  const r = await helperWin.webContents.executeJavaScript(code, true);
  let json;
  try { json = JSON.parse(r.text); } catch { json = undefined; }
  return { status: r.status, json };
}

async function getJson(pathname) {
  let r;
  try { r = await viaSession(pathname); } catch { r = { status: 0 }; }
  if (r.json === undefined) {
    try { r = await viaHelper(pathname); } catch (e) { throw new WebError('Sin respuesta de claude.ai: ' + e.message, 0); }
  }
  if (r.status === 401 || r.status === 403) throw new WebError('La sesión de claude.ai no está iniciada o caducó.', r.status);
  if (r.status < 200 || r.status >= 300 || r.json === undefined) throw new WebError(`claude.ai respondió ${r.status}`, r.status);
  return r.json;
}

/** Devuelve { id, name } de la organización principal, o lanza WebError si no hay sesión. */
async function getOrg() {
  const orgs = await getJson('/api/organizations');
  if (!Array.isArray(orgs) || !orgs.length) throw new WebError('No encontré tu organización en claude.ai.', 0);
  const withChat = orgs.find((o) => Array.isArray(o.capabilities) && o.capabilities.includes('chat'));
  const o = withChat || orgs[0];
  return { id: o.uuid, name: o.name || null };
}

async function fetchLimits(orgId) {
  const data = await getJson(`/api/organizations/${encodeURIComponent(orgId)}/usage`);
  return parseLimits(data);
}

function bringToFront(win, level) {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(true, 'screen-saver', level);
  win.show();
  win.moveTop();
  win.focus();
}

/** Permite ventanas emergentes (Google, Apple…) y las pone por encima de su ventana madre. */
function allowPopups(win, level) {
  win.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      parent: win,
      width: 520,
      height: 700,
      center: true,
      autoHideMenuBar: true,
      alwaysOnTop: true,
      webPreferences: { partition: PARTITION },
    },
  }));
  win.webContents.on('did-create-window', (child) => {
    bringToFront(child, level);
    child.on('closed', () => bringToFront(win, level - 1)); // al terminar, vuelve la ventana madre
    child.once('ready-to-show', () => bringToFront(child, level));
    child.webContents.on('did-finish-load', () => bringToFront(child, level));
    allowPopups(child, Math.min(level + 1, 9)); // ventanas emergentes anidadas
  });
}

/**
 * Abre la página oficial de inicio de sesión de claude.ai.
 * Resuelve con la organización cuando detecta que ya iniciaste sesión, o con null si cierras la ventana.
 */
function login() {
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.show();
    loginWin.focus();
    return loginWin._promise;
  }
  loginWin = new BrowserWindow({
    width: 500,
    height: 760,
    center: true,
    title: 'Conecta PM con tu cuenta de Claude',
    autoHideMenuBar: true,
    alwaysOnTop: true,
    webPreferences: { partition: PARTITION },
  });
  // Por encima del pollito y al frente, para que no quede escondida.
  loginWin.setAlwaysOnTop(true, 'screen-saver', 1);
  loginWin.once('ready-to-show', () => { loginWin.show(); loginWin.focus(); });
  loginWin.webContents.once('did-finish-load', () => {
    if (loginWin && !loginWin.isDestroyed()) { loginWin.moveTop(); loginWin.focus(); }
  });
  // Mantiene el título aunque la página lo cambie.
  loginWin.on('page-title-updated', (e) => e.preventDefault());
  // Ventanas emergentes (p. ej. inicio con Google) dentro de la misma sesión,
  // SIEMPRE por delante de la ventana de login (antes quedaban detrás).
  allowPopups(loginWin, 2);
  loginWin.loadURL(BASE + '/login');

  loginWin._promise = new Promise((resolve) => {
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      if (loginWin && !loginWin.isDestroyed()) loginWin.destroy();
      loginWin = null;
      resolve(val);
    };
    const poll = setInterval(async () => {
      try {
        const org = await getOrg();
        finish(org);
      } catch { /* todavía no ha iniciado sesión */ }
    }, 2500);
    loginWin.on('closed', () => finish(null));
  });
  return loginWin._promise;
}

async function logout() {
  await getSession().clearStorageData();
}

module.exports = { login, logout, getOrg, fetchLimits, WebError, allowPopups };

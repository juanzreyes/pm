// Electron para Android (lado "proceso principal"): el mismo main.js de la PC corre aquí.
//  · BrowserWindow → una vista con un iframe (el pollito arriba, el panel como pantalla principal,
//    ajustes/captura/juegos como hojas que se abren encima). Lo de ventanas de escritorio
//    (posición, siempre encima, bandeja, atajos globales…) se acepta y no hace nada.
//  · ipcMain ↔ ipcRenderer de cada iframe (shim/renderer-electron.js), con copia de los datos
//    como haría Electron.
//  · Notificaciones, enlaces, portapapeles, diálogos y "inactividad" con lo que da el teléfono.
const { EventEmitter } = require('events');
const host = require('../host/views');
const native = require('../host/native');

/** Objeto que acepta cualquier método que no conozcamos (y no hace nada). */
function lenient(target, name) {
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'symbol' || k === 'then' || k === 'toJSON') return undefined;
      return (...a) => { if (globalThis.__pmDebug) console.debug(`[${name}] ${String(k)} (sin efecto en Android)`, a); return undefined; };
    },
  });
}

// ---------------------------------------------------------------------------
// ipcMain
// ---------------------------------------------------------------------------
const handlers = new Map();
const ipcMain = lenient(Object.assign(new EventEmitter(), {
  handle(ch, fn) { handlers.set(ch, fn); },
  handleOnce(ch, fn) { handlers.set(ch, async (...a) => { handlers.delete(ch); return fn(...a); }); },
  removeHandler(ch) { handlers.delete(ch); },
}), 'ipcMain');
ipcMain.setMaxListeners(0);

const clone = (v) => (v === undefined ? undefined : JSON.stringify(v));
// Lo que llama cada iframe (ver renderer-electron.js).
globalThis.__pmHost = {
  async invoke(viewId, ch, argsJson) {
    const fn = handlers.get(ch);
    if (!fn) { console.warn('[ipc] sin manejador:', ch); return clone(null); }
    const args = JSON.parse(argsJson || '[]');
    const r = await fn(eventFor(viewId), ...args);
    return clone(r);
  },
  send(viewId, ch, argsJson) {
    const args = JSON.parse(argsJson || '[]');
    const e = eventFor(viewId);
    try { ipcMain.emit(ch, e, ...args); } catch (err) { console.error('[ipc] ' + ch, err); }
  },
  ready(viewId) { const w = windows.get(viewId); if (w) w.__ready(); },
};
function eventFor(viewId) {
  const w = windows.get(viewId);
  const wc = w ? w.webContents : null;
  // Como en Electron: el proceso principal verifica que el mensaje venga de sus propias pantallas.
  return { sender: wc, senderFrame: { url: wc ? wc.getURL() : '', origin: 'file://' }, returnValue: undefined, reply: (ch, ...a) => wc && wc.send(ch, ...a), preventDefault() {} };
}

// ---------------------------------------------------------------------------
// BrowserWindow
// ---------------------------------------------------------------------------
const windows = new Map();
let nextId = 1;
class WebContents extends EventEmitter {
  constructor(win) { super(); this.win = win; this.id = win.id; this._url = ''; this._zoom = 1; this.session = lenient({ setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, clearCache: async () => {} }, 'session'); }
  send(ch, ...args) { if (this.win._destroyed) return; this.win.__deliver(ch, clone(args)); }
  getURL() { return this._url; }
  getTitle() { return this.win._title || ''; }
  isDestroyed() { return !!this.win._destroyed; }
  isLoading() { return !this.win._isReady; }
  getOSProcessId() { return 1; }
  getProcessId() { return 1; }
  getType() { return 'window'; }
  setZoomFactor(z) { this._zoom = z; }
  getZoomFactor() { return this._zoom; }
  setWindowOpenHandler() {}
  setBackgroundThrottling() {}
  setAudioMuted() {}
  isAudioMuted() { return false; }
  openDevTools() {}
  closeDevTools() {}
  isDevToolsOpened() { return false; }
  focus() { this.win.focus(); }
  async executeJavaScript(code) { const f = this.win.__frame(); return f ? f.contentWindow.eval(code) : undefined; }
  insertCSS() { return Promise.resolve(''); }
  setIgnoreMenuShortcuts() {}
  capturePage() { return Promise.resolve(nativeImage.createEmpty()); }
  reload() { const f = this.win.__frame(); if (f) f.contentWindow.location.reload(); }
  get mainFrame() { return this; }
}
class BrowserWindow extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.id = nextId++;
    this.opts = opts;
    this._bounds = { x: opts.x || 0, y: opts.y || 0, width: opts.width || 400, height: opts.height || 600 };
    this._visible = opts.show !== false;
    this._destroyed = false;
    this._isReady = false;
    this._queue = [];
    this._title = opts.title || '';
    // Todo el mundo (main.js, fromWebContents, getAllWindows) ve el mismo objeto: el Proxy.
    const self = lenient(this, 'BrowserWindow');
    this.webContents = lenient(new WebContents(self), 'webContents');
    windows.set(this.id, self);
    setTimeout(() => app.emit('browser-window-created', {}, self), 0);
    return self;
  }
  loadFile(file, o = {}) {
    const rel = String(file).replace(/\\/g, '/').replace(/^.*?\/?renderer\//, 'renderer/');
    const q = o.query ? '?' + new URLSearchParams(o.query).toString() : '';
    this.webContents._url = 'file:///app/' + rel + q;
    this._isReady = false;
    this.role = host.roleOf(rel);
    host.mount(this, rel + q);
    return Promise.resolve();
  }
  loadURL(url) {
    // Páginas externas (p. ej. iniciar sesión): en el navegador del teléfono.
    if (/^https?:/.test(url)) { native.openExternal(url); return Promise.resolve(); }
    if (/^data:/.test(url)) { this.webContents._url = url; host.mount(this, url); }
    return Promise.resolve();
  }
  __frame() { return host.frameOf(this); }
  __ready() {
    this._isReady = true;
    const f = this.__frame();
    for (const [ch, json] of this._queue) f && f.contentWindow.__pmIpcEmit && f.contentWindow.__pmIpcEmit(ch, json);
    this._queue = [];
    this.webContents.emit('dom-ready');
    this.webContents.emit('did-finish-load');
    this.emit('ready-to-show');
  }
  __deliver(ch, json) {
    const f = this.__frame();
    if (!this._isReady || !f || !f.contentWindow || !f.contentWindow.__pmIpcEmit) { this._queue.push([ch, json]); return; }
    try { f.contentWindow.__pmIpcEmit(ch, json); } catch (e) { console.error('[ipc→vista]', ch, e); }
  }
  show() { if (this._destroyed) return; const was = this._visible; this._visible = true; host.show(this); if (!was) this.emit('show'); this.emit('focus'); }
  showInactive() { this.show(); }
  hide() { if (this._destroyed) return; if (host.isDocked(this)) return; const was = this._visible; this._visible = false; host.hide(this); if (was) this.emit('hide'); }
  close() { if (this._destroyed) return; const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; this.emit('close', e); if (e.defaultPrevented) { this.hide(); return; } this.destroy(); }
  destroy() { if (this._destroyed) return; this._destroyed = true; host.unmount(this); windows.delete(this.id); this.emit('closed'); }
  isDestroyed() { return this._destroyed; }
  isVisible() { return !this._destroyed && (host.isDocked(this) || this._visible); }
  isFocused() { return this.isVisible(); }
  isMinimized() { return false; }
  isMaximized() { return false; }
  isFullScreen() { return false; }
  isAlwaysOnTop() { return !!this.opts.alwaysOnTop; }
  focus() { this.show(); }
  blur() {}
  getBounds() { return { ...this._bounds }; }
  setBounds(b) { this._bounds = { ...this._bounds, ...b }; this.emit('move'); }
  getPosition() { return [this._bounds.x, this._bounds.y]; }
  setPosition(x, y) { this._bounds.x = x; this._bounds.y = y; this.emit('move'); }
  getSize() { return [this._bounds.width, this._bounds.height]; }
  setSize(w, h) { this._bounds.width = w; this._bounds.height = h; }
  getContentBounds() { return this.getBounds(); }
  getContentSize() { return this.getSize(); }
  setContentSize(w, h) { this.setSize(w, h); }
  setTitle(t) { this._title = t; }
  getTitle() { return this._title; }
  setOpacity() {}
  getOpacity() { return 1; }
  setIgnoreMouseEvents() {}
  setAlwaysOnTop() {}
  moveTop() {}
  setSkipTaskbar() {}
  setVisibleOnAllWorkspaces() {}
  setContentProtection() {}
  setBackgroundColor() {}
  setBackgroundMaterial() {}
  setMenu() {}
  setMenuBarVisibility() {}
  setResizable() {}
  setMovable() {}
  setFocusable() {}
  setShape() {}
  setHasShadow() {}
  flashFrame() {}
  setProgressBar() {}
  setOverlayIcon() {}
  minimize() {}
  restore() { this.show(); }
  maximize() {}
  center() {}
  static getAllWindows() { return [...windows.values()]; }
  static getFocusedWindow() { return host.topWindow(windows); }
  static fromWebContents(wc) { return wc ? wc.win || null : null; }
  static fromId(id) { return windows.get(id) || null; }
}

// ---------------------------------------------------------------------------
// app y compañía
// ---------------------------------------------------------------------------
const ready = new Promise((res) => setTimeout(res, 0));
const PATHS = { userData: '/data', appData: '/data', home: '/home', temp: '/tmp', documents: '/home/Documents', downloads: '/home/Download', desktop: '/home/Desktop', exe: '/app/pm-android', logs: '/data/logs', music: '/home/Music', pictures: '/home/Pictures' };
const app = lenient(Object.assign(new EventEmitter(), {
  isPackaged: true,
  name: 'PM Pollito',
  commandLine: lenient({ appendSwitch() {}, hasSwitch: () => false, getSwitchValue: () => '' }, 'commandLine'),
  dock: null,
  whenReady: () => ready,
  isReady: () => true,
  getPath: (n) => PATHS[n] || '/data',
  setPath: (n, p) => { PATHS[n] = p; },
  getVersion: () => globalThis.__pmAppVersion || '0.0.0',
  getName: () => 'PM Pollito',
  getAppPath: () => '/app',
  getLocale: () => (navigator.language || 'es').toLowerCase(),
  getSystemLocale: () => navigator.language || 'es',
  getPreferredSystemLanguages: () => navigator.languages || ['es'],
  requestSingleInstanceLock: () => true,
  hasSingleInstanceLock: () => true,
  getLoginItemSettings: () => ({ openAtLogin: false, wasOpenedAtLogin: false }),
  setLoginItemSettings: () => {},
  setAppUserModelId: () => {},
  getAppMetrics: () => [{ pid: 1, type: 'Browser', cpu: { percentCPUUsage: 0 }, memory: { workingSetSize: Math.round(((performance.memory && performance.memory.usedJSHeapSize) || 0) / 1024) } }],
  getGPUFeatureStatus: () => ({}),
  disableHardwareAcceleration: () => {},
  quit: () => { app.emit('before-quit', { preventDefault() {} }); native.minimize(); },
  exit: () => native.minimize(),
  relaunch: () => location.reload(),
  focus: () => {},
  setBadgeCount: () => true,
}), 'app');
app.setMaxListeners(0);

const screen = lenient(Object.assign(new EventEmitter(), {
  getPrimaryDisplay: () => display(),
  getAllDisplays: () => [display()],
  getDisplayNearestPoint: () => display(),
  getDisplayMatching: () => display(),
  getCursorScreenPoint: () => ({ ...host.lastPointer }),
  screenToDipPoint: (p) => p,
  dipToScreenPoint: (p) => p,
}), 'screen');
function display() {
  const w = innerWidth;
  const h = innerHeight;
  return { id: 1, bounds: { x: 0, y: 0, width: w, height: h }, workArea: { x: 0, y: 0, width: w, height: h }, workAreaSize: { width: w, height: h }, size: { width: w, height: h }, scaleFactor: devicePixelRatio || 1, rotation: 0, internal: true, label: 'Teléfono' };
}

// Inactividad: segundos desde el último toque; "bloqueado" si la app está en segundo plano.
let lastInput = Date.now();
for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel']) addEventListener(ev, () => { lastInput = Date.now(); }, { capture: true, passive: true });
const powerMonitor = lenient(Object.assign(new EventEmitter(), {
  getSystemIdleTime: () => (document.hidden ? 3600 : Math.floor((Date.now() - lastInput) / 1000)),
  getSystemIdleState: (t) => (document.hidden ? 'locked' : (Date.now() - lastInput) / 1000 >= t ? 'idle' : 'active'),
  isOnBatteryPower: () => false,
  onBatteryPower: false,
}), 'powerMonitor');
document.addEventListener('visibilitychange', () => { if (document.hidden) powerMonitor.emit('lock-screen'); else { powerMonitor.emit('unlock-screen'); powerMonitor.emit('resume'); } });

class Notification extends EventEmitter {
  constructor(o = {}) { super(); this.o = o; }
  static isSupported() { return true; }
  show() { native.notify({ title: this.o.title, body: this.o.body, silent: this.o.silent }).then((id) => { this.nid = id; this.emit('show'); }); native.onNotificationTap(this, () => this.emit('click')); }
  close() { if (this.nid) native.cancelNotification(this.nid); this.emit('close'); }
}

const shell = lenient({
  openExternal: async (url) => { native.openExternal(url); },
  openPath: async () => 'Abrir carpetas no está disponible en Android',
  showItemInFolder: () => {},
  beep: () => { if (navigator.vibrate) navigator.vibrate(40); },
  trashItem: async () => {},
}, 'shell');

let clipText = '';
const clipboard = lenient({
  writeText: (t) => { clipText = String(t); native.copy(clipText); },
  readText: () => clipText, // la lectura del portapapeles del sistema es asíncrona y con permiso: aquí, lo último copiado desde PM
  writeHTML: (h) => { clipText = String(h); native.copy(clipText); },
  readHTML: () => '',
  readImage: () => nativeImage.createEmpty(),
  availableFormats: () => (clipText ? ['text/plain'] : []),
  clear: () => { clipText = ''; },
}, 'clipboard');

const dialog = lenient({
  showMessageBox: async (_w, o) => { const opts = o || _w; return host.messageBox(opts); },
  showMessageBoxSync: (_w, o) => { const opts = o || _w; return confirm([opts.message, opts.detail].filter(Boolean).join('\n\n')) ? (opts.buttons && opts.buttons.length > 1 ? 1 : 0) : (opts.cancelId ?? 0); },
  showErrorBox: (t, c) => alert(`${t}\n\n${c}`),
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
}, 'dialog');

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const nativeTheme = lenient(Object.assign(new EventEmitter(), {
  get shouldUseDarkColors() { return darkQuery.matches; },
  shouldUseHighContrastColors: false,
  themeSource: 'system',
}), 'nativeTheme');
darkQuery.addEventListener('change', () => nativeTheme.emit('updated'));

// En el teléfono los datos ya viven en el almacenamiento privado de la app (Android lo aísla).
const safeStorage = lenient({ isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(String(s)), decryptString: (b) => Buffer.from(b).toString('utf8') }, 'safeStorage');

// Imágenes de escritorio (ícono de la bandeja): se aceptan y no se usan.
const emptyImage = (size = 32) => lenient({ isEmpty: () => true, toDataURL: () => '', toPNG: () => Buffer.alloc(0), toBitmap: () => Buffer.alloc(size * size * 4), getBitmap: () => Buffer.alloc(size * size * 4), getSize: () => ({ width: size, height: size }), resize: (o) => emptyImage((o && o.width) || size), crop: () => emptyImage(size), setTemplateImage() {}, addRepresentation() {} }, 'nativeImage');
const nativeImage = lenient({ createEmpty: () => emptyImage(), createFromPath: () => emptyImage(), createFromDataURL: () => emptyImage(), createFromBuffer: () => emptyImage(), createFromBitmap: (_b, o) => emptyImage((o && o.width) || 32) }, 'nativeImage');

class Tray extends EventEmitter { constructor() { super(); return lenient(this, 'Tray'); } }
const Menu = lenient({ buildFromTemplate: () => lenient({ popup() {}, items: [] }, 'Menu'), setApplicationMenu() {}, getApplicationMenu: () => null }, 'Menu');
class MenuItem { constructor(o) { Object.assign(this, o); } }
// Atajos de teclado globales: no existen en el teléfono; se dan por registrados para no avisar de un error.
const globalShortcut = lenient({ register: () => true, unregister() {}, unregisterAll() {}, isRegistered: () => false }, 'globalShortcut');
const session = lenient({ defaultSession: lenient({ setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, clearCache: async () => {}, webRequest: lenient({}, 'webRequest') }, 'session') }, 'session');
const utilityProcess = lenient({ fork: () => { throw new Error('Los plugins no están disponibles en Android'); } }, 'utilityProcess');
const desktopCapturer = lenient({ getSources: async () => [] }, 'desktopCapturer');
const systemPreferences = lenient({ getAccentColor: () => 'ff9f1c', getMediaAccessStatus: () => 'granted', askForMediaAccess: async () => true, on() {} }, 'systemPreferences');
const crashReporter = lenient({ start() {} }, 'crashReporter');
const protocol = lenient({ registerSchemesAsPrivileged() {}, handle() {}, registerFileProtocol() {} }, 'protocol');
const net = lenient({ fetch: (...a) => fetch(...a), isOnline: () => navigator.onLine }, 'net');
const webContents = lenient({ getAllWebContents: () => [...windows.values()].map((w) => w.webContents), fromId: (id) => (windows.get(id) || {}).webContents || null }, 'webContents');

module.exports = {
  app, BrowserWindow, ipcMain, screen, powerMonitor, Notification, shell, clipboard, dialog, nativeTheme, safeStorage, nativeImage,
  Tray, Menu, MenuItem, globalShortcut, session, utilityProcess, desktopCapturer, systemPreferences, crashReporter, protocol, net, webContents,
  __windows: windows,
};

// Electron para Android (lado "ventana"): lo que preload.js espera de require('electron') dentro de
// cada iframe. Habla con el anfitrión (shim/electron.js) por window.parent.__pmHost.
const host = () => window.parent && window.parent.__pmHost;
const viewId = Number(window.name) || 0;
const listeners = new Map(); // canal → Set(fn)

// El anfitrión entrega los mensajes como JSON; se arman aquí para que sean objetos de esta ventana.
window.__pmIpcEmit = (ch, json) => {
  const args = json ? JSON.parse(json) : [];
  for (const fn of [...(listeners.get(ch) || [])]) {
    try { fn({ sender: ipcRenderer }, ...args); } catch (e) { console.error('[ipc] ' + ch, e); }
  }
};

const ipcRenderer = {
  async invoke(ch, ...args) {
    const h = host();
    if (!h) throw new Error('Sin anfitrión');
    const json = await h.invoke(viewId, ch, JSON.stringify(args));
    return json === undefined ? undefined : JSON.parse(json);
  },
  send(ch, ...args) { const h = host(); if (h) h.send(viewId, ch, JSON.stringify(args)); },
  sendSync() { return null; },
  on(ch, fn) { if (!listeners.has(ch)) listeners.set(ch, new Set()); listeners.get(ch).add(fn); return ipcRenderer; },
  once(ch, fn) { const w = (...a) => { ipcRenderer.removeListener(ch, w); fn(...a); }; return ipcRenderer.on(ch, w); },
  removeListener(ch, fn) { const s = listeners.get(ch); if (s) s.delete(fn); return ipcRenderer; },
  removeAllListeners(ch) { if (ch) listeners.delete(ch); else listeners.clear(); return ipcRenderer; },
};
const contextBridge = { exposeInMainWorld: (name, api) => { window[name] = api; } };
const webUtils = { getPathForFile: () => '' };

// Avisa al anfitrión cuando la página está lista (equivale a did-finish-load).
if (document.readyState === 'complete') setTimeout(() => host() && host().ready(viewId), 0);
else addEventListener('load', () => host() && host().ready(viewId));
document.documentElement.classList.add('android');

module.exports = { ipcRenderer, contextBridge, webUtils };

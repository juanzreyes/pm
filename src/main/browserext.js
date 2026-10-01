// Extensión del navegador (extensions/browser): estado en la barra, "Enviar a PM" desde cualquier
// página y bloqueo de sitios que distraen durante el modo foco. Habla con el servidor local
// (src/claudeHooks.js → /browser/*) usando el código de emparejamiento de Ajustes.
// Parte del proceso principal. `M` es el contexto compartido de la app.
module.exports = function install(M) {
  const set = () => M.store.data.settings;
  const DEFAULT_SITES = ['youtube.com', 'x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'reddit.com', 'netflix.com', 'twitch.tv'];
  let lastSeen = 0;

  function token() {
    if (!set().browserToken) { set().browserToken = require('crypto').randomBytes(16).toString('hex'); M.store.save(); }
    return set().browserToken;
  }
  function regenerate() {
    set().browserToken = '';
    token();
    M.broadcast();
    return token();
  }
  const sites = () => (Array.isArray(set().focusBlockSites) ? set().focusBlockSites : DEFAULT_SITES);
  const cleanHost = (h) => String(h || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

  function status() {
    const fm = M.focusMode();
    return {
      ok: true, ...M.extStatus(), version: M.app.getVersion(),
      focus: fm ? { mode: fm, until: M.store.data.focusUntil > Date.now() ? M.store.data.focusUntil : 0 } : null,
      blockSites: set().focusBlock === false ? [] : sites(),
    };
  }
  /** "Enviar a PM": tarea (por defecto), nota o recordatorio, con el enlace de la página. */
  function capture({ text = '', url = '', title = '', kind = 'task' } = {}) {
    text = String(text).replace(/\s+/g, ' ').trim().slice(0, 280);
    title = String(title).replace(/\s+/g, ' ').trim().slice(0, 140);
    url = /^https?:\/\//i.test(url) ? String(url).slice(0, 500) : '';
    const what = text || title;
    if (!what) return { ok: false, error: 'No hay nada que enviar' };
    if (kind === 'note') {
      const d = M.today();
      d.notes = (d.notes ? d.notes.replace(/\s*$/, '\n') : '') + `🌐 ${what}${url ? ` — ${url}` : ''}`;
      M.store.save();
      M.broadcast();
      M.say(`📝 Nota guardada desde el navegador: «${what.slice(0, 60)}»`, 'peck', 5000, { log: false });
      return { ok: true, kind: 'note' };
    }
    // Las tareas llevan el enlace al final (la lista lo muestra como enlace).
    const msg = M.prod.capture(url && kind === 'task' ? `${what} ${url}` : what);
    return { ok: !!msg, kind, msg };
  }
  /** @param {{ minutes?: number, stop?: boolean }} [o] */
  function focus({ minutes, stop } = {}) {
    if (stop) { M.endFocus(); return { ok: true, focus: null }; }
    const m = Math.max(5, Math.min(180, Math.round(Number(minutes) || 25)));
    M.startFocus(m);
    return { ok: true, focus: { until: Date.now() + m * 60e3 } };
  }
  /** La extensión frenó un sitio que distrae: el pollito lo comenta (como mucho una vez cada 10 min). */
  let lastScold = 0;
  /** @param {{ host?: string }} [o] */
  function blocked({ host } = {}) {
    const h = cleanHost(host);
    if (!h) return { ok: false, error: 'Falta el sitio' };
    const day = M.today();
    day.blocked = day.blocked || {};
    day.blocked[h] = (day.blocked[h] || 0) + 1;
    M.store.save();
    if (Date.now() - lastScold > 10 * 60e3) {
      lastScold = Date.now();
      M.say(`🙅 Te frené ${h} (estás en modo foco). ¡Vuelve al trabajo, que tú puedes! 💪`, 'judge', 7000, { cat: 'focus', log: false });
    }
    return { ok: true };
  }
  function saveSites(list) {
    const clean = [...new Set((Array.isArray(list) ? list : String(list || '').split(/[\s,]+/)).map(cleanHost).filter((h) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)))].slice(0, 40);
    set().focusBlockSites = clean;
    M.store.save();
    M.broadcast();
    return clean;
  }
  function browserState() {
    return { token: token(), lastSeen, connected: Date.now() - lastSeen < 5 * 60e3, sites: sites(), block: set().focusBlock !== false, folder: M.path.join(M.APP_DIR, 'extensions', 'browser').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1') };
  }
  const api = { token, seen: () => { lastSeen = Date.now(); }, status, capture, focus, blocked };
  return { api, regenerate, saveSites, browserState, DEFAULT_SITES };
};

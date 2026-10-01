// Lógica compartida de la extensión (sin APIs del navegador, para poder probarla con Node).
(function (root) {
  const PORT = 47823;
  const base = (port) => 'http://127.0.0.1:' + (Number(port) || PORT);

  /** Llama a PM con el código de emparejamiento. Devuelve el JSON o lanza un error legible. */
  async function call(token, path, body, { port, fetchFn = root.fetch } = {}) {
    let r;
    try {
      r = await fetchFn(base(port) + path, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('PM no está abierto en este PC');
    }
    let j = {};
    try { j = await r.json(); } catch { /* sin cuerpo */ }
    if (r.status === 401) throw new Error('Código incorrecto: cópialo de PM → Ajustes → Integraciones');
    if (!r.ok || j.ok === false) throw new Error(j.error || 'PM respondió ' + r.status);
    return j;
  }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** Reglas de declarativeNetRequest: cada sitio (y sus subdominios) → la pantalla del pollito. */
  function rulesFor(sites, blockedPage) {
    return (sites || []).filter((h) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)).slice(0, 40).map((h, i) => ({
      id: i + 1,
      priority: 1,
      action: { type: 'redirect', redirect: { regexSubstitution: blockedPage + '#\\0' } },
      condition: { regexFilter: '^https?://([a-z0-9-]+\\.)*' + escapeRe(h) + '([/:?#].*)?$', resourceTypes: ['main_frame'] },
    }));
  }
  /** Lo que muestra el icono: % de la sesión de Claude (o 🎯 en foco). */
  function badge(st) {
    if (!st) return { text: '', color: '#9ca3af' };
    if (st.focus) return { text: 'foco', color: '#7c3aed' };
    const p = st.session ? st.session.pct : null;
    if (p === null) return { text: '', color: '#9ca3af' };
    return { text: p + '%', color: p >= 90 ? '#e5484d' : p >= 70 ? '#f59e0b' : '#16a34a' };
  }
  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  }
  const minsLeft = (until, now = Date.now()) => Math.max(0, Math.ceil((until - now) / 60e3));

  const api = { PORT, base, call, rulesFor, badge, hostOf, minsLeft };
  root.PMExt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);

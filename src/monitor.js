// Vigila tus sitios o servidores (URLs http/https, incluido localhost) y avisa si se caen.
async function check(url) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'pm-pollito-monitor/1.0' } });
    try { await res.body?.cancel(); } catch { /* sin cuerpo */ }
    const ms = Date.now() - t0;
    return { up: res.status < 500, status: res.status, ms };
  } catch (e) {
    return { up: false, status: 0, ms: Date.now() - t0, error: e.name === 'AbortError' ? 'Sin respuesta (12 s)' : (e.cause && e.cause.code) || e.message };
  } finally {
    clearTimeout(timer);
  }
}

function normalize(url) {
  url = String(url || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = (/^(localhost|127\.)/i.test(url) ? 'http://' : 'https://') + url;
  try { return new URL(url).toString(); } catch { return ''; }
}

module.exports = { check, normalize };

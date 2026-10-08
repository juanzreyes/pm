// Resumen redactado de tu día por proyecto (src/worksummary.js) para el daily, el "¿Qué hiciste
// ayer?" y el panel: en vez de tus peticiones tal cual, en qué trabajaste en cada proyecto.
// Lo redacta Claude (la API si la configuraste, o Claude Code con Haiku) y, si no hay ninguno,
// una versión local con plantillas. Se guarda por día: si nada cambió, no se vuelve a pedir.
// Parte del proceso principal. `M` es el contexto compartido de la app.
module.exports = function install(M) {
  const ws = require('../worksummary');
  const journal = require('../journal');
  const runner = require('../claudeRunner');
  const S = () => M.store.data;
  const cache = () => (S().workSummaries = S().workSummaries || {});
  const pending = {}; // día → promesa en curso (no pedir dos veces lo mismo)

  function range(which) {
    if (which === 'prev') return require('../git').lastWorkday();
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to: Date.now() };
  }
  async function groupsFor(which) {
    const { from, to } = range(which);
    let prompts = {};
    try { prompts = M.scan ? await M.scan.prompts(from, to) : journal.prompts(from, to); } catch { /* sin registros de Claude Code */ }
    let commits = [];
    try { commits = await M.prod.commitsBetween(from, to); } catch { /* sin git */ }
    const day = S().days[M.dayKey(new Date(from))] || {};
    return { key: M.dayKey(new Date(from)), groups: ws.group({ prompts, commits, secs: day.projects || {} }) };
  }

  /** Redacción con Claude: API (si hay clave) o Claude Code en modo solo lectura con Haiku. */
  async function withClaude(groups) {
    const prompt = ws.buildPrompt(groups, M.lang() === 'en' ? 'en' : 'es');
    if (M.aiAvailable()) {
      const t = ws.cleanAi(await M.ai.polish(prompt, ''));
      if (t) return { text: t, by: 'ai' };
    }
    // En los tests, solo si se pide explícitamente (el Claude simulado de los tests no sabe resumir).
    const bin = M.TEST && S().settings.summaryWithClaude !== true ? null : runner.findClaude(S().settings.claudeBin);
    if (bin && S().settings.summaryWithClaude !== false) {
      const r = await runner.launch({ bin, cwd: M.os.tmpdir(), prompt, permission: 'dontAsk', model: 'haiku', budgetUsd: 0.2, timeoutMs: 120e3 }).promise;
      const t = ws.cleanAi(r && r.result);
      if (t) return { text: t, by: 'claude' };
    }
    return null;
  }

  /** Resumen del día (which: 'today' | 'prev'). force: volver a redactarlo aunque no haya cambios. */
  async function get(which = 'today', { force = false } = {}) {
    const { key, groups } = await groupsFor(which);
    if (!groups.length) return { text: '', by: 'none', key };
    const hash = ws.hashOf(groups);
    const c = cache()[key];
    if (!force && c && c.hash === hash) return c;
    // Hoy cambia a cada rato: se reescribe como mucho cada 2 h (o cuando pulsas ↻), para no gastar de tu plan.
    if (!force && c && which === 'today' && c.by !== 'local' && Date.now() - c.at < 2 * 3600e3) return c;
    const id = key + hash;
    if (!pending[id]) {
      pending[id] = (async () => {
        let out = null;
        try { out = await withClaude(groups); } catch (e) { M.diag.log('info', 'Resumen del día con Claude: ' + e.message); }
        if (!out) out = { text: ws.localSummary(groups), by: 'local' };
        const rec = { ...out, hash, key, at: Date.now() };
        cache()[key] = rec;
        // Solo los últimos 14 días.
        for (const k of Object.keys(cache()).sort().slice(0, -14)) delete cache()[k];
        M.store.save();
        return rec;
      })().finally(() => { delete pending[id]; });
    }
    return pending[id];
  }

  /** Líneas del resumen de hoy, ya guardado (para textos que no pueden esperar). */
  function cachedLines(which = 'today') {
    const key = M.dayKey(new Date(range(which).from));
    const c = cache()[key];
    return c ? c.text.split('\n').map((l) => l.trim()).filter(Boolean) : [];
  }

  return { get, cachedLines, groupsFor };
};

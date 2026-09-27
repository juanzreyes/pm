// Sesiones de Claude Code en vivo: qué está haciendo cada una, en qué proyecto, cuánto lleva,
// cuántos tokens y cuánto cuesta. Se alimenta de los hooks y del archivo de transcripción.
const fs = require('fs');
const path = require('path');
const usage = require('./usage');

// Mensajes de Claude Code en español.
function translate(msg) {
  const m = String(msg || '');
  let x;
  if ((x = m.match(/permission to use (.+)$/i))) return `necesita permiso para usar ${x[1]}`;
  if (/waiting for your input/i.test(m)) return 'está esperando tu respuesta';
  return m || 'quiere tu atención';
}

function create(ctx) {
  const live = {}; // session_id -> { id, project, cwd, transcript, state, since, lastEvent, lastActivity, prompts, tokens, cost, stuckWarned, waitingMsg }
  const fileInfo = {}; // transcript -> { size, mtimeMs, tokens, cost, model }

  function onEvent(ev) {
    const name = ev.hook_event_name;
    const id = ev.session_id || 'default';
    const now = Date.now();
    let s = live[id];
    if (!s) {
      s = live[id] = { id, project: ev.cwd ? path.basename(ev.cwd) : 'Claude Code', cwd: ev.cwd || '', transcript: ev.transcript_path || '', state: 'idle', since: now, prompts: 0, tokens: 0, cost: 0 };
    }
    if (ev.transcript_path) s.transcript = ev.transcript_path;
    if (ev.cwd) { s.cwd = ev.cwd; s.project = path.basename(ev.cwd); }
    s.lastEvent = now;
    s.lastActivity = now;
    if (name === 'SessionStart') s.state = 'idle';
    else if (name === 'UserPromptSubmit') { s.state = 'working'; s.prompts++; s.workingSince = now; s.stuckWarned = false; s.waitingMsg = ''; }
    else if (name === 'Stop') { s.state = 'idle'; s.workingSince = 0; }
    else if (name === 'Notification') { s.state = 'waiting'; s.waitingMsg = translate(ev.message).slice(0, 120); }
    else if (name === 'SessionEnd') { delete live[id]; }
    refreshTokens(s);
  }

  /** Tokens y coste de la sesión (solo relee el archivo si cambió). */
  function refreshTokens(s) {
    if (!s || !s.transcript) return;
    let st;
    try { st = fs.statSync(s.transcript); } catch { return; }
    s.lastActivity = Math.max(s.lastActivity || 0, st.mtimeMs);
    const c = fileInfo[s.transcript];
    if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) { s.tokens = c.tokens; s.cost = c.cost; s.model = c.model; return; }
    const entries = usage.parseFile(s.transcript);
    const seen = new Set();
    let tokens = 0, cost = 0, model = '';
    for (const e of entries) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      tokens += e.input + e.output;
      cost += e.cost || 0;
      model = e.model;
    }
    fileInfo[s.transcript] = { size: st.size, mtimeMs: st.mtimeMs, tokens, cost, model };
    s.tokens = tokens; s.cost = cost; s.model = model;
  }

  function tick() {
    const now = Date.now();
    for (const s of Object.values(live)) {
      refreshTokens(s);
      // Atascada: trabajando, pero la transcripción no se mueve desde hace 10 min.
      if (s.state === 'working' && !s.stuckWarned && now - (s.lastActivity || s.workingSince) > 10 * 60e3) {
        s.stuckWarned = true;
        if (!ctx.isMuted()) ctx.say(`🧐 La sesión de Claude en ${s.project} no avanza desde hace ${Math.round((now - s.lastActivity) / 60000)} min. ¿Se atascó o espera algo?`, 'look', 15000, {
          cat: 'claude', target: { cmd: 'open.project', arg: s.cwd }, actions: [{ label: '📂 Ir al proyecto', cmd: 'open.project', arg: s.cwd }],
        });
      }
      // Olvida las que llevan 3 h sin actividad (se cerraron sin SessionEnd).
      if (now - (s.lastActivity || s.lastEvent) > 3 * 3600e3) delete live[s.id];
    }
  }

  function list() {
    return Object.values(live).sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0)).map((s) => ({
      id: s.id, project: s.project, cwd: s.cwd, state: s.state, since: s.since, lastActivity: s.lastActivity,
      workingSince: s.workingSince || 0, prompts: s.prompts, tokens: s.tokens, cost: s.cost, model: (s.model || '').replace(/^claude-/, ''),
      waitingMsg: s.waitingMsg || '', stuck: !!s.stuckWarned && s.state === 'working',
    }));
  }

  function start() { setInterval(tick, 20000); }
  return { onEvent, list, start, tick };
}

module.exports = { create };

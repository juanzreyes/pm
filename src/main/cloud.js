// Ecosistema en la nube (2.3): tus PCs y teléfonos sincronizados por pm-sync (cloud/), cifrado de
// punta a punta. Además de las fotos de datos (tareas, pollito, cosméticos, niveles, horario…),
// hay un buzón de mensajes entre dispositivos:
//  · avisos: lo importante que pasa en la PC (Claude terminó o te necesita, una reunión, un
//    recordatorio) llega al teléfono como notificación, y al revés;
//  · actividad: "en el teléfono completaste X", "subiste a nivel 7"… el pollito lo comenta;
//  · órdenes: desde el teléfono puedes pedirle a la PC que anote una tarea, ponga un pomodoro o el
//    modo foco, encole o ejecute una tarea para Claude, o te diga cómo va todo.
// Parte del proceso principal. `M` es el contexto compartido de la app.
/* eslint-disable no-use-before-define */
const C = require('../cloudsync');
const sync = require('../sync');
// Nota: M.plan.queueAdd y M.work.startRun son los mismos que usa el panel de la PC.

const FAST_MS = 30e3; // con actividad reciente entre dispositivos
const NORMAL_MS = 120e3;
const IDLE_MS = 10 * 60e3; // sin tocar la PC
const PUSH_MIN_MS = 90e3; // la foto no se sube más de una vez cada 90 s (salvo cambios importantes)

module.exports = function install(M) {
  const cfg = () => M.store.data.cloud || null;
  const on = () => !!(cfg() && cfg().space && cfg().key && cfg().on !== false);
  let client = null;
  let timer = null;
  let busy = false;
  let hotUntil = 0;
  let lastPushAt = 0;
  let lastSig = '';
  let dirtyImportant = false;
  let status = { state: 'off', at: 0, error: '' };

  const deviceId = () => M.device().id;
  const KIND = process.platform === 'android' ? 'phone' : 'pc';
  const deviceName = () => (cfg() && cfg().name) || M.os.hostname();
  function getClient() {
    const c = cfg();
    if (!client || client.space !== c.space || client.device !== deviceId()) {
      client = C.client({ url: c.url, space: c.space, key: c.key, device: deviceId() });
      client.space = c.space;
    }
    return client;
  }
  function away() {
    // En el teléfono, "lejos" es tener la app en segundo plano: mirarla sin tocar la pantalla cuenta.
    if (KIND === 'phone') return typeof document !== 'undefined' && document.hidden;
    try {
      const { powerMonitor } = require('electron');
      return powerMonitor.getSystemIdleTime() >= 300 || powerMonitor.getSystemIdleState(60) === 'locked';
    } catch { return false; }
  }

  // ---------------------------------------------------------------------------
  // Crear, unirse, salir
  // ---------------------------------------------------------------------------
  async function create(url) {
    const { space, key } = C.newSpace();
    M.store.data.cloud = { url: (url || C.DEFAULT_URL).replace(/\/+$/, ''), space, key, on: true, owner: true, since: 0, after: 0, createdAt: Date.now() };
    sync.claim(M.store.data, deviceId()); // este dispositivo es el dueño: los que se unan adoptan lo suyo
    M.store.save();
    client = null;
    await getClient().ensure();
    await syncNow({ force: true });
    M.broadcast();
    return pairing();
  }
  async function join(code) {
    const p = C.parsePairing(code);
    if (!p) return { ok: false, error: 'Ese código no es de PM Pollito.' };
    const prev = M.store.data.cloud;
    M.store.data.cloud = { url: p.url, space: p.space, key: p.key, on: true, owner: false, since: 0, after: 0, joinedAt: Date.now() };
    client = null;
    try {
      await getClient().pull(0, 0); // comprueba la llave
    } catch (e) {
      M.store.data.cloud = prev;
      client = null;
      return { ok: false, error: e.status === 404 ? 'Ese ecosistema ya no existe.' : e.status === 403 ? 'El código no es válido.' : 'No pude conectar: ' + e.message };
    }
    M.store.save();
    const r = await syncNow({ force: true });
    shareWithNative();
    registerPush();
    await send('*', { type: 'activity', kind: 'joined', text: `${KIND === 'phone' ? '📱' : '🖥️'} ${deviceName()} se unió a tu ecosistema` });
    M.broadcast();
    return { ok: true, devices: r && r.devices };
  }
  async function leave() {
    if (!on()) return { ok: true };
    try { await getClient().unlink(); } catch { /* sin red: igual se desvincula aquí */ }
    M.store.data.cloud = null;
    client = null;
    status = { state: 'off', at: Date.now(), error: '' };
    M.store.save();
    shareWithNative();
    M.broadcast();
    return { ok: true };
  }
  async function wipe() {
    if (!on()) return { ok: true };
    await getClient().wipe();
    M.store.data.cloud = null;
    client = null;
    status = { state: 'off', at: Date.now(), error: '' };
    M.store.save();
    shareWithNative();
    M.broadcast();
    return { ok: true };
  }
  /** Teléfono: lo nativo revisa el buzón con la app cerrada; necesita la config (o null al desvincular). */
  function shareWithNative() {
    if (KIND !== 'phone' || typeof globalThis.__pmNativeCloud !== 'function') return;
    const c = cfg();
    try { globalThis.__pmNativeCloud(c && c.space ? { url: c.url, space: c.space, key: c.key, device: deviceId(), after: c.after || 0 } : null); } catch { /* sin parte nativa */ }
  }
  /** Teléfono: registra el token de Firebase (si la app lo trae) para que la PC lo despierte al instante. */
  async function registerPush() {
    if (KIND !== 'phone' || !on()) return;
    const token = globalThis.__pmPushToken;
    const c = cfg();
    if (!token || c.pushToken === token) return;
    try { await getClient().registerPush(token); c.pushToken = token; M.store.save(); } catch (e) { M.diag.log('main', 'Push del ecosistema: ' + e.message); }
  }
  function pairing() {
    const c = cfg();
    if (!c) return null;
    return { ok: true, link: C.pairingLink(c), code: C.shortCode(c) };
  }

  // ---------------------------------------------------------------------------
  // Sincronizar: anotar lo propio → traer lo nuevo → mezclar → subir la foto si cambió
  // ---------------------------------------------------------------------------
  async function syncNow({ force = false } = {}) {
    if (!on() || busy || M.TEST && !process.env.PM_CLOUD_TEST) return null;
    busy = true;
    const c = cfg();
    try {
      const me = deviceId();
      sync.stamp(M.store.data, me);
      const r = await getClient().pull(c.since || 0, c.after || 0);
      let changed = false;
      for (const b of r.blobs) {
        if (!b.data || b.data.app !== 'pm-pollito') continue;
        M.store.data = sync.merge(M.store.data, b.data.data);
        changed = true;
        if (b.data.live && b.data.live.usage) adoptLive(b.data.live);
      }
      if (changed) sync.stamp(M.store.data, me);
      const cc = M.store.data.cloud || c;
      cc.since = r.now;
      cc.devices = r.devices.map((d) => ({ id: d.device, name: d.meta.name || 'Dispositivo', kind: d.meta.kind || '?', at: d.at, me: d.device === me }));
      for (const m of r.messages) {
        cc.after = Math.max(cc.after || 0, m.id);
        try { onMessage(m); } catch (e) { M.diag.log('main', 'Mensaje del ecosistema: ' + e.message); }
      }
      if (r.messages.length || changed) hotUntil = Date.now() + 10 * 60e3;
      M.store.data.cloud = cc;
      // Subir la foto si cambió (no más de una vez cada 90 s, salvo algo importante).
      const snap = sync.pick(M.store.data);
      const sig = JSON.stringify(snap);
      const now = Date.now();
      if (sig !== lastSig && (force || dirtyImportant || now - lastPushAt > PUSH_MIN_MS)) {
        // "live": lo que solo sabe este dispositivo y los demás quieren ver (los límites de Claude de la PC).
        const live = KIND === 'pc' && M.usage && M.usage.limits && M.usage.limits.length ? { usage: M.usage, at: now } : null;
        await getClient().push({ app: 'pm-pollito', v: 1, at: now, device: { id: me, name: deviceName(), kind: KIND }, data: snap, live }, { name: deviceName(), kind: KIND, app: M.app.getVersion() });
        lastSig = sig;
        lastPushAt = now;
        dirtyImportant = false;
      }
      M.store.save();
      status = { state: 'ok', at: now, error: '' };
      if (changed) M.broadcast();
      return { ok: true, changed, devices: cc.devices };
    } catch (e) {
      status = { state: 'error', at: Date.now(), error: e.status === 403 ? 'La llave del ecosistema ya no es válida' : e.status === 404 ? 'El ecosistema ya no existe' : e.message };
      M.diag.log('main', 'Sincronización en la nube: ' + e.message);
      return { ok: false, error: status.error };
    } finally {
      busy = false;
    }
  }
  /** Algo importante cambió aquí (tarea, compra, cosmético): sincroniza pronto. */
  let soonTimer = null;
  function soon() {
    if (!on()) return;
    dirtyImportant = true;
    clearTimeout(soonTimer);
    soonTimer = setTimeout(() => syncNow(), 8000);
  }

  // ---------------------------------------------------------------------------
  // Mensajes entre dispositivos
  // ---------------------------------------------------------------------------
  async function send(to, msg) {
    if (!on()) return null;
    try {
      const r = await getClient().send(to, { ...msg, fromName: deviceName(), fromKind: KIND, at: Date.now() });
      hotUntil = Date.now() + 10 * 60e3;
      return r;
    } catch (e) {
      M.diag.log('main', 'Mensaje al ecosistema: ' + e.message);
      return null;
    }
  }
  const icon = (m) => (m.fromKind === 'phone' ? '📱' : '🖥️');
  function onMessage(m) {
    if (m.type === 'notify') {
      M.say(`${icon(m)} ${m.fromName || 'Otro dispositivo'}: ${m.text}`, m.anim || 'peck', 10000, { cat: m.cat || 'ecosystem', remote: false });
      // En el teléfono, además, como notificación (sin sonar si estás frente a la PC).
      if (KIND === 'phone') {
        const title = `${icon(m)} ${m.fromName || 'Tu PC'}`;
        try {
          if (typeof globalThis.__pmNotifyOnce === 'function') globalThis.__pmNotifyOnce(m.id, title, m.text, !!m.pcActive);
          else new (require('electron').Notification)({ title, body: m.text, silent: !!m.pcActive }).show();
        } catch { /* sin notificaciones */ }
      }
    } else if (m.type === 'activity') {
      // Lo que hiciste en el otro dispositivo: al centro de avisos, y si es algo para celebrar, en voz alta.
      const loud = /level|achievement|joined|streak/.test(m.kind || '');
      M.say(`${icon(m)} ${m.text}`, loud ? 'celebrate' : 'peck', loud ? 9000 : 6000, { cat: 'ecosystem', remote: false, log: true });
    } else if (m.type === 'cmd') {
      const r = runCommand(m);
      if (m.reqId) send(m.from, { type: 'reply', reqId: m.reqId, ok: r.ok !== false, text: r.text || '' });
    }
  }
  // Lo que el teléfono le puede pedir a la PC (lista cerrada: nada de ejecutar cosas arbitrarias).
  function runCommand(m) {
    const a = m.args || {};
    switch (m.name) {
      case 'task.add': {
        const text = String(a.text || '').trim().slice(0, 200);
        if (!text) return { ok: false, text: 'Falta el texto' };
        M.addTask(text);
        M.say(`📱 Anotado desde tu teléfono: "${text}"`, 'peck', 7000, { cat: 'ecosystem', remote: false });
        return { ok: true, text: `Anotado en ${deviceName()}` };
      }
      case 'focus.start': {
        const min = Math.max(5, Math.min(240, Number(a.minutes) || 50));
        M.startFocus(min);
        return { ok: true, text: `Modo foco de ${min} min en ${deviceName()}` };
      }
      case 'queue.add': {
        const text = String(a.text || '').trim().slice(0, 2000);
        if (!text || !M.plan) return { ok: false, text: 'No pude encolar' };
        const it = M.plan.queueAdd(text, String(a.project || ''), {});
        M.say(`📱 Encolado para Claude desde tu teléfono: "${text.slice(0, 80)}"`, 'peck', 8000, { cat: 'claude', remote: false });
        soon();
        return { ok: true, text: 'En la cola de Claude', id: it && it.id };
      }
      case 'queue.run': {
        // Asíncrono: se responde que arrancó; cuando termine, el aviso de Claude llega solo.
        Promise.resolve(M.work.startRun(String(a.id || ''))).then((r) => {
          if (m.reqId) send(m.from, { type: 'reply', reqId: m.reqId + ':done', ok: !!(r && r.ok !== false), text: r && r.ok === false ? r.error : 'Claude empezó a trabajar en la PC' });
        });
        return { ok: true, text: 'Pidiéndole a Claude que empiece…' };
      }
      case 'say':
        M.say(`📱 ${String(a.text || '').slice(0, 300)}`, 'hop', 8000, { cat: 'ecosystem', remote: false });
        return { ok: true };
      case 'status':
        return { ok: true, text: statusText() };
      default:
        return { ok: false, text: 'Orden desconocida' };
    }
  }
  function statusText() {
    const d = M.today();
    const tasks = (d.standup && d.standup.today) || [];
    const done = tasks.filter((t) => t.done).length;
    const lims = (M.usage && M.usage.limits) || [];
    const five = lims.find((l) => l.key === 'five_hour');
    const q = (M.store.data.claudeQueue || []).filter((x) => !x.done).length;
    return [`${deviceName()}: ${done}/${tasks.length} tareas hechas hoy`, five ? `Claude 5 h: ${Math.round(five.utilization)}%` : '', q ? `${q} en la cola de Claude` : '', M.fx && M.fx.cat === 'work' ? 'trabajando ahora' : away() ? 'lejos de la PC' : ''].filter(Boolean).join(' · ');
  }

  /** Lo que la PC dice en voz alta: lo importante también va al teléfono (igual que Teams/Telegram). */
  const recent = new Map();
  function onSay(raw, cat, opts = {}) {
    if (!on() || opts.remote === false || M.TEST || KIND !== 'pc') return;
    if (!(cfg().devices || []).some((d) => d.kind === 'phone')) return;
    // Solo lo que el teléfono no puede saber por su cuenta (los recordatorios ya están sincronizados y suenan allí).
    const r = require('../outbound').route(cat, raw, { phone: true, phoneWhen: 'always', phoneCats: ['claude', 'meeting', 'usage'] }, true);
    if (!r.phone) return;
    const now = Date.now();
    if (recent.get(raw) > now - 60e3) return;
    recent.set(raw, now);
    if (recent.size > 50) recent.delete(recent.keys().next().value);
    // "pcActive": si estás frente a la PC, el teléfono lo anota sin sonar.
    send('*', { type: 'notify', text: raw, cat, important: true, pcActive: !away() });
  }
  /** Para celebrar en el otro dispositivo: niveles, logros, rachas… */
  function activity(kind, text) { send('*', { type: 'activity', kind, text }); }

  // ---------------------------------------------------------------------------
  function loop() {
    clearTimeout(timer);
    const phone = KIND === 'phone';
    const ms = !on() ? NORMAL_MS : Date.now() < hotUntil ? (phone ? 20e3 : FAST_MS) : away() ? IDLE_MS : phone ? 45e3 : NORMAL_MS;
    timer = setTimeout(async () => { await syncNow(); loop(); }, ms);
  }
  function start() {
    if (M.TEST && !process.env.PM_CLOUD_TEST) return;
    setTimeout(() => { syncNow(); loop(); shareWithNative(); registerPush(); }, 12e3);
    try { require('electron').powerMonitor.on('resume', () => setTimeout(() => syncNow(), 5000)); } catch { /* sin powerMonitor */ }
  }
  /** Los límites de Claude de la PC, si este dispositivo no tiene los suyos (el teléfono). */
  function adoptLive(live) {
    if (KIND !== 'phone') return;
    const mine = M.usage && M.usage.connection && M.usage.connection.ok;
    if (mine) return;
    const prev = M.store.data.cloud && M.store.data.cloud.live;
    if (prev && prev.at >= live.at) return;
    if (M.store.data.cloud) M.store.data.cloud.live = { at: live.at };
    M.usage = { ...live.usage, fromPc: true, fromPcAt: live.at };
  }
  /** En el teléfono: escanear el QR de la PC y unirse. */
  async function scanAndJoin() {
    if (typeof globalThis.__pmScan !== 'function') return { ok: false, error: 'Escanear solo está disponible en el teléfono.' };
    const r = await globalThis.__pmScan();
    if (!r || r.status !== 'success') return { ok: false, error: r && r.status === 'installing' ? 'Instalando el lector de códigos de Google… vuelve a tocar en unos segundos.' : r && r.status === 'cancelled' ? '' : 'No pude leer el código.' };
    return join(r.value);
  }
  function snapshot() {
    const c = cfg();
    if (!c) return { on: false, canScan: typeof globalThis.__pmScan === 'function', kind: KIND };
    return { on: on(), owner: !!c.owner, url: c.url, devices: c.devices || [], status, me: deviceId(), name: deviceName(), kind: KIND, canScan: typeof globalThis.__pmScan === 'function' };
  }
  function rename(name) {
    if (!cfg()) return false;
    cfg().name = String(name || '').trim().slice(0, 40) || undefined;
    M.store.save();
    lastSig = '';
    soon();
    return true;
  }

  return { create, join, scanAndJoin, leave, wipe, pairing, syncNow, soon, send, onSay, activity, start, snapshot, rename, runCommand };
};

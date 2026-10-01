// Plugins (src/pluginlib.js + src/plugins/host.js): los encuentra en <datos de PM>/plugins, arranca
// los que activaste (cada uno en su propio proceso) y atiende lo que piden según sus permisos.
// Parte del proceso principal. `M` es el contexto compartido de la app.
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  const lib = require('../pluginlib');
  const set = () => M.store.data.settings;
  const enabled = () => (set().plugins = set().plugins || {}); // id → true
  const dir = () => M.path.join(M.app.getPath('userData'), 'plugins');
  const dataDir = () => M.path.join(M.app.getPath('userData'), 'plugins-data');
  const HOST = M.path.join(M.APP_DIR, 'src', 'plugins', 'host.js');
  const running = {}; // id → { proc, plugin, commands: [], events: Set, lastSay, errors }
  let found = []; // [{ ok, plugin } | { ok: false, id, error }]

  /** Proceso aparte para el plugin: utilityProcess en la app, child_process en los tests. */
  function spawn(plugin) {
    if (M.spawnPluginHost) return M.spawnPluginHost(HOST, [plugin.main]);
    const { utilityProcess } = require('electron');
    const p = utilityProcess.fork(HOST, [plugin.main], { serviceName: `PM plugin ${plugin.id}`, cwd: plugin.dir });
    return { post: (m) => p.postMessage(m), onMessage: (fn) => p.on('message', fn), onExit: (fn) => p.on('exit', fn), kill: () => p.kill() };
  }

  function scan() {
    let names = [];
    try { names = M.fs.readdirSync(dir(), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* sin carpeta */ }
    found = names.map((n) => {
      const d = M.path.join(dir(), n);
      let raw;
      try { raw = M.fs.readFileSync(M.path.join(d, 'plugin.json'), 'utf8'); } catch { return { ok: false, id: n, error: 'Falta plugin.json' }; }
      const r = lib.parseManifest(raw, d);
      return r.ok ? r : { ok: false, id: n, error: r.error };
    });
    return found;
  }

  // ---------- lo que pide cada plugin ----------
  function storageFile(id) { return M.path.join(dataDir(), id + '.json'); }
  function readStore(id) { try { return JSON.parse(M.fs.readFileSync(storageFile(id), 'utf8')); } catch { return {}; } }
  function handle(r, m) {
    const { plugin } = r;
    const reply = (value) => r.proc.post({ t: 'reply', rid: m.rid, value });
    if (m.t === 'ready') { r.ready = true; M.broadcast(); return; }
    if (m.t === 'log') return M.diag.log('info', `Plugin ${plugin.id}: ${String(m.text).slice(0, 300)}`);
    if (m.t === 'error') {
      r.errors = (r.errors || 0) + 1;
      r.lastError = String(m.text).split('\n')[0].slice(0, 200);
      M.diag.log('main', `Plugin ${plugin.id}: ${String(m.text).slice(0, 600)}`);
      if (m.fatal) stop(plugin.id);
      M.broadcast();
      return;
    }
    if (!lib.allowed(plugin, m.t)) {
      M.diag.log('main', `Plugin ${plugin.id}: sin permiso para "${m.t}"`);
      if (m.rid) reply(null);
      return;
    }
    const text = String(m.text || '').trim().slice(0, 280);
    if (m.t === 'say') {
      // Como mucho una burbuja cada 10 s por plugin: que ninguno acapare al pollito.
      if (!text || Date.now() - (r.lastSay || 0) < 10e3) return;
      r.lastSay = Date.now();
      M.say(`🧩 ${text}`, 'peck', 7000, { cat: 'pet' }); // también queda en el centro de avisos
    } else if (m.t === 'task') {
      if (text) M.addTask(text);
    } else if (m.t === 'note') {
      if (!text) return;
      const d = M.today();
      d.notes = (d.notes ? d.notes.replace(/\s*$/, '\n') : '') + `🧩 ${text}`;
      M.store.save();
      M.broadcast();
    } else if (m.t === 'command') {
      const id = String(m.id).replace(/[^\w.-]/g, '').slice(0, 40);
      if (!id || r.commands.length >= 20) return;
      r.commands = r.commands.filter((c) => c.id !== id).concat({ id, label: String(m.label).slice(0, 80), icon: String(m.icon).slice(0, 4) });
    } else if (m.t === 'subscribe') {
      if (lib.EVENTS.includes(m.event)) r.events.add(m.event);
    } else if (m.t === 'status') {
      const s = M.extStatus();
      reply({ name: s.name, session: s.session, weekly: s.weekly, tasks: s.tasks, focus: !!M.focusMode(), pomo: s.pomo });
    } else if (m.t === 'storage:get') {
      reply(readStore(plugin.id)[m.key] ?? null);
    } else if (m.t === 'storage:set') {
      const all = readStore(plugin.id);
      all[m.key] = m.value;
      const json = JSON.stringify(all);
      if (json.length > 256e3) return reply(false); // 256 KB por plugin
      M.fs.mkdirSync(dataDir(), { recursive: true });
      M.fs.writeFileSync(storageFile(plugin.id), json);
      reply(true);
    }
  }

  function startOne(plugin) {
    if (running[plugin.id]) return;
    const proc = spawn(plugin);
    const r = { proc, plugin, commands: [], events: new Set(), ready: false };
    running[plugin.id] = r;
    proc.onMessage((m) => { try { handle(r, m || {}); } catch (e) { M.diag.log('main', `Plugin ${plugin.id}: ${e.message}`); } });
    proc.onExit(() => { if (running[plugin.id] === r) delete running[plugin.id]; M.broadcast(); });
  }
  function stop(id) {
    const r = running[id];
    if (!r) return;
    delete running[id];
    try { r.proc.kill(); } catch { /* ya no estaba */ }
  }

  /** Activar (tras tu permiso en Ajustes) o desactivar un plugin. */
  function setEnabled(id, on) {
    const f = scan().find((x) => x.ok && x.plugin.id === id);
    if (!f) return { ok: false, error: 'No encuentro ese plugin' };
    if (on) { enabled()[id] = true; startOne(f.plugin); } else { delete enabled()[id]; stop(id); }
    M.store.save();
    M.broadcast();
    return { ok: true };
  }
  /** Avisa a los plugins que se suscribieron (y tienen permiso de eventos). */
  function emit(event, data = {}) {
    for (const r of Object.values(running)) if (r.events.has(event)) { try { r.proc.post({ t: 'event', event, data }); } catch { /* proceso caído */ } }
  }
  function runCommand(arg) {
    const [pid, cid] = String(arg || '').split(':');
    const r = running[pid];
    if (!r || !r.commands.some((c) => c.id === cid)) return false;
    r.proc.post({ t: 'run', id: cid });
    return true;
  }
  /** Comandos de los plugins para la paleta. */
  const paletteCommands = () => Object.values(running).flatMap((r) => r.commands.map((c) => ({ id: 'plugin.run', arg: `${r.plugin.id}:${c.id}`, icon: c.icon, label: `${c.label} · ${r.plugin.name}`, kw: `plugin ${r.plugin.name} ${c.label}` })));

  /** Copia el plugin de ejemplo a tu carpeta de plugins (para empezar a escribir el tuyo). */
  function installExample() {
    const from = M.path.join(M.APP_DIR, 'examples', 'plugins', 'hola-pollito').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    const to = M.path.join(dir(), 'hola-pollito');
    M.fs.mkdirSync(to, { recursive: true });
    for (const f of M.fs.readdirSync(from)) M.fs.copyFileSync(M.path.join(from, f), M.path.join(to, f));
    scan();
    M.broadcast();
    return { ok: true, dir: to };
  }
  function openFolder() {
    M.fs.mkdirSync(dir(), { recursive: true });
    M.shell.openPath(dir());
    return dir();
  }

  function pluginsState() {
    return {
      dir: dir(),
      list: found.map((f) => (f.ok
        ? { ...f.plugin, main: undefined, ok: true, enabled: !!enabled()[f.plugin.id], running: !!running[f.plugin.id], ready: !!(running[f.plugin.id] && running[f.plugin.id].ready), perms: lib.describePerms(f.plugin.permissions), lastError: running[f.plugin.id] ? running[f.plugin.id].lastError || '' : '' }
        : { id: f.id, ok: false, error: f.error })),
    };
  }

  function start() {
    scan();
    for (const f of found) if (f.ok && enabled()[f.plugin.id]) startOne(f.plugin);
  }
  function stopAll() { for (const id of Object.keys(running)) stop(id); }

  return { start, stopAll, scan, setEnabled, emit, runCommand, paletteCommands, installExample, openFolder, pluginsState, get running() { return running; } };
};

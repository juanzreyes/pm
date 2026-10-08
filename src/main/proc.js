// Procesos lanzados desde un hilo aparte (src/procworker.js). Mismas firmas que child_process:
//  - execFile(file, args, opts, cb)  → cb(err, stdout, stderr)
//  - spawn(file, args, opts)         → { stdout: { setEncoding, on('data') }, on('exit'|'error'), kill() }
// Si el hilo no arranca, usa child_process aquí mismo.
// Parte del proceso principal. `M` es el contexto compartido de la app.
const { EventEmitter } = require('events');

module.exports = function install(M) {
  const cp = require('child_process');
  let worker = null;
  let failed = false;
  let seq = 0;
  const execs = new Map();
  const spawns = new Map();

  function ensure() {
    if (worker || failed) return worker;
    try {
      const { Worker } = require('worker_threads');
      const file = M.path.join(M.APP_DIR, 'src', 'procworker.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
      worker = new Worker(file);
      worker.unref();
      worker.on('message', (m) => {
        const ex = execs.get(m.id);
        if (ex) {
          execs.delete(m.id);
          const err = m.err ? Object.assign(new Error(m.err.message), { code: m.err.code, killed: m.err.killed }) : null;
          ex(err, m.stdout, m.stderr);
          return;
        }
        const sp = spawns.get(m.id);
        if (!sp) return;
        if (m.pid) sp.pid = m.pid;
        if (m.data !== undefined) sp.stdout.emit('data', m.data);
        if (m.error) sp.emit('error', new Error(m.error));
        if (m.exit !== undefined) { spawns.delete(m.id); sp.emit('exit', m.exit); }
      });
      worker.on('error', (e) => fail(e.message));
      worker.on('exit', (code) => { if (code !== 0) fail('el hilo terminó (' + code + ')'); });
    } catch (e) { fail(e.message); }
    return worker;
  }
  function fail(why) {
    if (failed) return;
    failed = true;
    worker = null;
    M.diag.log('info', 'Procesos en el hilo principal: ' + why);
    for (const [, cb] of execs) cb(new Error('hilo de procesos caído'), '', '');
    execs.clear();
    for (const [, sp] of spawns) sp.emit('exit', -1);
    spawns.clear();
  }

  function execFile(file, args, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    if (!ensure()) return cp.execFile(file, args, opts, cb);
    const id = ++seq;
    execs.set(id, cb || (() => {}));
    worker.postMessage({ op: 'exec', id, file, args, opts: plain(opts) });
    return undefined;
  }
  function spawn(file, args, opts = {}) {
    if (!ensure()) return cp.spawn(file, args, opts);
    const id = ++seq;
    const sp = /** @type {any} */ (new EventEmitter());
    sp.stdout = new EventEmitter();
    sp.stdout.setEncoding = () => {};
    sp.kill = () => { if (worker) worker.postMessage({ op: 'kill', id }); };
    spawns.set(id, sp);
    worker.postMessage({ op: 'spawn', id, file, args, opts: plain(opts) });
    return sp;
  }
  // Solo lo que se puede pasar entre hilos (cwd, env, timeout, windowsHide, maxBuffer…).
  const plain = (o) => JSON.parse(JSON.stringify(o || {}));
  /** Al salir: los procesos hijos (p. ej. el PowerShell del vigilante) se cierran aquí mismo, no quedan huérfanos. */
  function stop() {
    for (const [, sp] of spawns) if (sp.pid) { try { process.kill(sp.pid); } catch { /* ya no estaba */ } }
    spawns.clear();
    if (worker) worker.terminate().catch(() => {});
    worker = null;
  }

  return { execFile, spawn, stop };
};

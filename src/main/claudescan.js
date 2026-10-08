// Historial de Claude Code en un hilo aparte (src/scanworker.js + src/claudescan.js): consumo local
// y peticiones sin congelar la app. Si el hilo no arranca, se lee aquí mismo (más lento, pero
// igual de correcto). Parte del proceso principal. `M` es el contexto compartido de la app.
module.exports = function install(M) {
  const { createScanner } = require('../claudescan');
  const usage = require('../usage');
  let worker = null;
  let inline = null;
  let seq = 0;
  const pending = new Map();

  const opts = () => ({
    root: M.path.join(usage.claudeDir(), 'projects'),
    cacheFile: M.path.join(M.app.getPath('userData'), 'claude-scan-cache.json'),
  });

  function useInline(why) {
    if (why) M.diag.log('info', 'Lector del historial en el proceso principal: ' + why);
    worker = null;
    inline = inline || createScanner(opts());
    for (const [, p] of pending) p.resolve(run(p.op, p.args));
    pending.clear();
  }
  function start() {
    if (worker || inline) return;
    try {
      const { Worker } = require('worker_threads');
      const file = M.path.join(M.APP_DIR, 'src', 'scanworker.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
      worker = new Worker(file, { workerData: opts() });
      worker.unref(); // no impide cerrar la app
      worker.on('message', ({ id, result, error }) => {
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        if (error) p.reject(new Error(error)); else p.resolve(result);
      });
      worker.on('error', (e) => useInline(e.message));
      worker.on('exit', (code) => { if (code !== 0 && worker) useInline('el hilo terminó (' + code + ')'); });
    } catch (e) { useInline(e.message); }
  }
  const run = (op, args) => (op === 'stats' ? inline.stats() : op === 'prompts' ? inline.prompts(args[0], args[1]) : inline.info());
  function call(op, ...args) {
    if (!worker && !inline) start();
    if (inline) {
      try { return Promise.resolve(run(op, args)); } catch (e) { return Promise.reject(e); }
    }
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject, op, args });
      worker.postMessage({ id, op, args });
    });
  }
  function stop() {
    if (worker) worker.terminate().catch(() => {});
    worker = null;
  }

  return {
    /** Consumo local (como usage.localStats) — en el hilo aparte. */
    stats: () => call('stats'),
    /** Peticiones entre dos fechas por proyecto (como journal.prompts) — en el hilo aparte. */
    prompts: (from, to) => call('prompts', from, to),
    info: () => call('info'),
    start,
    stop,
  };
};

// Hilo que lanza procesos (git, el vigilante de ventanas de PowerShell…). En Windows, abrir un
// proceso congela a quien lo abre (más con el antivirus revisándolo): así se congela este hilo,
// no la app ni el pollito.
const { parentPort } = require('worker_threads');
const cp = require('child_process');

const kids = new Map();
parentPort.on('message', (m) => {
  if (m.op === 'exec') {
    try {
      cp.execFile(m.file, m.args, m.opts || {}, (err, stdout, stderr) => {
        parentPort.postMessage({ id: m.id, err: err ? { message: err.message, code: err.code, killed: !!err.killed } : null, stdout: String(stdout || ''), stderr: String(stderr || '') });
      });
    } catch (e) {
      parentPort.postMessage({ id: m.id, err: { message: e.message }, stdout: '', stderr: '' });
    }
  } else if (m.op === 'spawn') {
    let c;
    try { c = cp.spawn(m.file, m.args, { ...(m.opts || {}), stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) {
      parentPort.postMessage({ id: m.id, exit: -1, error: e.message });
      return;
    }
    kids.set(m.id, c);
    parentPort.postMessage({ id: m.id, pid: c.pid });
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', (d) => parentPort.postMessage({ id: m.id, data: d }));
    c.on('error', (e) => parentPort.postMessage({ id: m.id, error: e.message }));
    c.on('exit', (code) => { kids.delete(m.id); parentPort.postMessage({ id: m.id, exit: code }); });
  } else if (m.op === 'kill') {
    const c = kids.get(m.id);
    if (c) c.kill();
  }
});

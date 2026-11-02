// Lo que el código de Node da por sentado y en un WebView no existe: Buffer, process, global y
// temporizadores con .unref(). Se inyecta antes que todo lo demás (esbuild `inject`).
import { Buffer } from 'buffer';

const g = globalThis;
g.JS_MD5_NO_NODE_JS = true; // js-md5: estamos en un navegador
g.global = g;
if (!g.Buffer) g.Buffer = Buffer;

if (!g.process || !g.process.versions || !g.process.__pm) {
  const listeners = {};
  g.process = {
    __pm: true,
    env: { PM_ANDROID: '1' },
    platform: 'android',
    arch: 'arm64',
    argv: ['pm-android'],
    execPath: '/app/pm-android',
    pid: 1,
    versions: { electron: 'android', chrome: '120', pm: 'android' }, // sin 'node': si no, las librerías creen que están en Node
    version: 'v20.0.0',
    cwd: () => '/app',
    uptime: () => performance.now() / 1000,
    hrtime: Object.assign((prev) => {
      const t = performance.now();
      const s = Math.floor(t / 1000);
      const ns = Math.floor((t % 1000) * 1e6);
      return prev ? [s - prev[0], ns - prev[1]] : [s, ns];
    }, { bigint: () => BigInt(Math.floor(performance.now() * 1e6)) }),
    memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: (performance.memory && performance.memory.usedJSHeapSize) || 0, external: 0 }),
    cpuUsage: () => ({ user: 0, system: 0 }),
    nextTick: (fn, ...a) => queueMicrotask(() => fn(...a)),
    on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); return g.process; },
    once: (ev, fn) => g.process.on(ev, fn),
    off: () => g.process,
    removeListener: () => g.process,
    emit: (ev, ...a) => { for (const fn of listeners[ev] || []) fn(...a); },
    exit: () => {},
    kill: () => true,
    getuid: () => 0,
    emitWarning: () => {},
    stdout: { write: (s) => console.log(String(s)), isTTY: false },
    stderr: { write: (s) => console.warn(String(s)), isTTY: false },
    resourcesPath: '/app',
    type: 'browser',
  };
}

// En Node, setTimeout/setInterval devuelven un objeto con unref()/ref(). Aquí devolvemos un Number
// con esos métodos: clearTimeout() sigue funcionando porque convierte el objeto a número.
const wrap = (fn) => (...args) => {
  const id = fn(...args);
  const o = new Number(id); // eslint-disable-line no-new-wrappers
  o.unref = () => o;
  o.ref = () => o;
  o.hasRef = () => true;
  o.refresh = () => o;
  o[Symbol.toPrimitive] = () => id;
  return o;
};
if (!g.__pmTimers) {
  g.__pmTimers = true;
  const st = g.setTimeout.bind(g);
  const si = g.setInterval.bind(g);
  const ct = g.clearTimeout.bind(g);
  const ci = g.clearInterval.bind(g);
  g.setTimeout = wrap(st);
  g.setInterval = wrap(si);
  g.clearTimeout = (h) => ct(h == null ? h : Number(h));
  g.clearInterval = (h) => ci(h == null ? h : Number(h));
  if (!g.setImmediate) { g.setImmediate = (fn, ...a) => g.setTimeout(fn, 0, ...a); g.clearImmediate = g.clearTimeout; }
}

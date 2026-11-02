// fs de Node para Android: en memoria (las llamadas *Sync de Node funcionan tal cual) y guardado en
// IndexedDB. init() carga todo antes de arrancar la app; las escrituras se guardan en tandas de
// 250 ms y se vacían al pasar la app a segundo plano. /app es de solo lectura (archivos de la app).
const files = new Map(); // ruta → { data: string|Uint8Array, mtimeMs }
const dirs = new Set(['/']);
const dirty = new Map(); // ruta → true (escribir) | false (borrar)
let db = null;
let saveTimer = 0;

const norm = (p) => {
  let s = String(p instanceof URL ? p.pathname : p).replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(s)) s = '/' + s.slice(3); // C:/... (por si algo arma rutas de Windows)
  if (!s.startsWith('/')) s = '/app/' + s;
  const out = [];
  for (const part of s.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
};
const parent = (p) => p.slice(0, p.lastIndexOf('/')) || '/';
function enoent(p, op) { return Object.assign(new Error(`ENOENT: no such file or directory, ${op} '${p}'`), { code: 'ENOENT', errno: -2, path: p, syscall: op }); }
function eexist(p, op) { return Object.assign(new Error(`EEXIST: file already exists, ${op} '${p}'`), { code: 'EEXIST', path: p }); }
function ensureDirs(p) { let d = parent(p); const stack = []; while (d && !dirs.has(d)) { stack.push(d); d = parent(d); } for (const x of stack) dirs.add(x); }
const persistent = (p) => !p.startsWith('/app/') && !p.startsWith('/tmp/');

function mark(p, write) {
  if (!persistent(p)) return;
  dirty.set(p, write);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}
const enc = new TextEncoder();
const dec = new TextDecoder();
function toBytes(data, encoding) {
  if (typeof data === 'string') {
    if (encoding === 'base64') return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    return data; // texto: se guarda como string
  }
  if (data instanceof Uint8Array) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return String(data);
}
const asBuffer = (d) => (typeof d === 'string' ? Buffer.from(d, 'utf8') : Buffer.from(d));
const encodingOf = (o) => (typeof o === 'string' ? o : o && o.encoding) || null;

// ---------- síncronas ----------
function readFileSync(p, o) {
  const f = files.get(norm(p));
  if (!f) throw enoent(norm(p), 'open');
  const e = encodingOf(o);
  if (e) return typeof f.data === 'string' ? f.data : asBuffer(f.data).toString(e);
  return asBuffer(f.data);
}
function writeFileSync(p, data, o) {
  const k = norm(p);
  if (k.startsWith('/app/')) throw Object.assign(new Error('EROFS: solo lectura ' + k), { code: 'EROFS' });
  if (o && typeof o === 'object' && o.flag === 'wx' && files.has(k)) throw eexist(k, 'open');
  ensureDirs(k);
  files.set(k, { data: toBytes(data, encodingOf(o)), mtimeMs: Date.now() });
  mark(k, true);
}
function appendFileSync(p, data, o) {
  const k = norm(p);
  const cur = files.get(k);
  const prev = cur ? (typeof cur.data === 'string' ? cur.data : dec.decode(cur.data)) : '';
  writeFileSync(k, prev + (typeof data === 'string' ? data : dec.decode(toBytes(data))), o);
}
const existsSync = (p) => { const k = norm(p); return files.has(k) || dirs.has(k); };
function stat(k) {
  const f = files.get(k);
  const isDir = !f && dirs.has(k);
  if (!f && !isDir) throw enoent(k, 'stat');
  const size = f ? (typeof f.data === 'string' ? enc.encode(f.data).length : f.data.length) : 0;
  const t = f ? f.mtimeMs : 0;
  return { size, mtimeMs: t, mtime: new Date(t), ctimeMs: t, ctime: new Date(t), birthtimeMs: t, atimeMs: t, isFile: () => !!f, isDirectory: () => isDir, isSymbolicLink: () => false, mode: isDir ? 0o40755 : 0o100644 };
}
const statSync = (p, o) => { try { return stat(norm(p)); } catch (e) { if (o && o.throwIfNoEntry === false) return undefined; throw e; } };
function mkdirSync(p, o) {
  const k = norm(p);
  if (dirs.has(k)) { if (o && o.recursive) return undefined; throw eexist(k, 'mkdir'); }
  if (!(o && o.recursive) && !dirs.has(parent(k))) throw enoent(k, 'mkdir');
  ensureDirs(k + '/x');
  return k;
}
function readdirSync(p, o) {
  const k = norm(p);
  if (!dirs.has(k)) throw enoent(k, 'scandir');
  const pre = k === '/' ? '/' : k + '/';
  const names = new Map();
  for (const f of files.keys()) if (f.startsWith(pre)) { const rest = f.slice(pre.length); const n = rest.split('/')[0]; names.set(n, names.get(n) || (rest.includes('/') ? 'dir' : 'file')); }
  for (const d of dirs) if (d.startsWith(pre) && d !== k) { const n = d.slice(pre.length).split('/')[0]; names.set(n, 'dir'); }
  const list = [...names.keys()].sort();
  if (o && o.withFileTypes) return list.map((n) => { const t = names.get(n); return { name: n, isFile: () => t === 'file', isDirectory: () => t === 'dir', isSymbolicLink: () => false }; });
  return list;
}
function renameSync(a, b) {
  const ka = norm(a);
  const kb = norm(b);
  const f = files.get(ka);
  if (!f) throw enoent(ka, 'rename');
  ensureDirs(kb);
  files.set(kb, f);
  files.delete(ka);
  mark(ka, false);
  mark(kb, true);
}
function copyFileSync(a, b) { const f = files.get(norm(a)); if (!f) throw enoent(norm(a), 'copyfile'); writeFileSync(b, typeof f.data === 'string' ? f.data : f.data.slice()); }
function unlinkSync(p) { const k = norm(p); if (!files.delete(k)) throw enoent(k, 'unlink'); mark(k, false); }
function rmSync(p, o) {
  const k = norm(p);
  if (files.delete(k)) { mark(k, false); return; }
  if (dirs.has(k)) {
    for (const f of [...files.keys()]) if (f.startsWith(k + '/')) { files.delete(f); mark(f, false); }
    for (const d of [...dirs]) if (d === k || d.startsWith(k + '/')) dirs.delete(d);
    return;
  }
  if (!(o && o.force)) throw enoent(k, 'rm');
}
const rmdirSync = (p, o) => rmSync(p, { ...o, force: true });
// Descriptores mínimos (los usa el lector incremental del historial de Claude, que aquí no tiene nada que leer).
const fds = new Map();
let nextFd = 10;
function openSync(p, flags = 'r') {
  const k = norm(p);
  if (/r/.test(flags) && !files.has(k)) throw enoent(k, 'open');
  if (/w/.test(flags)) writeFileSync(k, '');
  const fd = nextFd++;
  fds.set(fd, k);
  return fd;
}
function readSync(fd, buf, off, len, pos) {
  const f = files.get(fds.get(fd));
  if (!f) return 0;
  const bytes = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
  const chunk = bytes.subarray(pos || 0, (pos || 0) + len);
  buf.set(chunk, off);
  return chunk.length;
}
function writeSync(fd, data) { appendFileSync(fds.get(fd), data); return String(data).length; }
const closeSync = (fd) => { fds.delete(fd); };
const fstatSync = (fd) => statSync(fds.get(fd));
const symlinkSync = () => { throw Object.assign(new Error('Los enlaces no existen en Android'), { code: 'EPERM' }); };
const realpathSync = Object.assign((p) => norm(p), { native: (p) => norm(p) });
const accessSync = (p) => { if (!existsSync(p)) throw enoent(norm(p), 'access'); };
const chmodSync = () => {};
const utimesSync = () => {};
const watch = () => ({ close() {}, on() { return this; } });
const watchFile = () => {};
const unwatchFile = () => {};
const createWriteStream = (p) => ({ write: (d) => { appendFileSync(p, d); return true; }, end: (d) => { if (d) appendFileSync(p, d); }, on() { return this; }, once() { return this; } });
const createReadStream = () => { throw Object.assign(new Error('createReadStream no está disponible en Android'), { code: 'ENOSYS' }); };

// ---------- asíncronas (promesas y callbacks) a partir de las síncronas ----------
const SYNC = { readFile: readFileSync, writeFile: writeFileSync, appendFile: appendFileSync, stat: statSync, lstat: statSync, mkdir: mkdirSync, readdir: readdirSync, rename: renameSync, copyFile: copyFileSync, unlink: unlinkSync, rm: rmSync, rmdir: rmdirSync, access: accessSync, realpath: realpathSync, chmod: chmodSync, utimes: utimesSync };
const promises = {};
const callbacks = {};
for (const [name, fn] of Object.entries(SYNC)) {
  promises[name] = async (...a) => fn(...a);
  callbacks[name] = (...a) => {
    const cb = typeof a[a.length - 1] === 'function' ? a.pop() : null;
    let r;
    let err = null;
    try { r = fn(...a); } catch (e) { err = e; }
    if (cb) queueMicrotask(() => cb(err, r));
  };
}
const exists = (p, cb) => queueMicrotask(() => cb(existsSync(p)));

// ---------- guardado en IndexedDB ----------
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('pm-fs', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function flush() {
  clearTimeout(saveTimer);
  if (!db || !dirty.size) return Promise.resolve();
  const batch = [...dirty.entries()];
  dirty.clear();
  return new Promise((res) => {
    const tx = db.transaction('files', 'readwrite');
    const st = tx.objectStore('files');
    for (const [k, write] of batch) {
      const f = files.get(k);
      if (write && f) st.put({ data: f.data, mtimeMs: f.mtimeMs }, k);
      else st.delete(k);
    }
    tx.oncomplete = () => res();
    tx.onerror = () => { for (const [k, w] of batch) if (!dirty.has(k)) dirty.set(k, w); res(); };
  });
}
/** Carga lo guardado y los archivos de la app. Llamar (y esperar) antes de arrancar. */
async function init(appFiles = {}) {
  for (const [p, data] of Object.entries(appFiles)) { const k = norm('/app/' + p); ensureDirs(k); files.set(k, { data, mtimeMs: 0 }); }
  db = await openDb();
  await new Promise((res, rej) => {
    const tx = db.transaction('files', 'readonly');
    const req = tx.objectStore('files').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return res();
      ensureDirs(c.key);
      files.set(c.key, { data: c.value.data, mtimeMs: c.value.mtimeMs || 0 });
      c.continue();
    };
    req.onerror = () => rej(req.error);
  });
  for (const d of ['/data', '/home', '/tmp', '/app']) dirs.add(d);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  addEventListener('pagehide', () => flush());
}

const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, O_RDONLY: 0 };
const api = {
  readFileSync, writeFileSync, appendFileSync, existsSync, statSync, lstatSync: statSync, mkdirSync, readdirSync, renameSync, copyFileSync, unlinkSync, rmSync, rmdirSync,
  openSync, readSync, writeSync, closeSync, fstatSync, symlinkSync, realpathSync, accessSync, chmodSync, utimesSync, watch, watchFile, unwatchFile, createWriteStream, createReadStream,
  ...callbacks, exists, promises, constants, __init: init, __flush: flush, __files: files,
};
module.exports = api;

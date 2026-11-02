// En Android no hay procesos (git, PowerShell, Claude Code): todo falla de la forma en que el
// código ya sabe manejar ("no se encontró el programa").
const { EventEmitter } = require('events');
const nope = (file) => Object.assign(new Error(`${file}: no disponible en Android`), { code: 'ENOENT' });
function execFile(file, args, opts, cb) {
  if (typeof args === 'function') cb = args;
  else if (typeof opts === 'function') cb = opts;
  const c = fake(file);
  setTimeout(() => { if (cb) cb(nope(file), '', ''); c.emit('error', nope(file)); c.emit('exit', -1); c.emit('close', -1); }, 0);
  return c;
}
function fake(file) {
  const c = new EventEmitter();
  c.stdout = new EventEmitter(); c.stdout.setEncoding = () => {}; c.stdout.pipe = () => {};
  c.stderr = new EventEmitter(); c.stderr.setEncoding = () => {}; c.stderr.pipe = () => {};
  c.stdin = { write() {}, end() {}, on() {} };
  c.kill = () => true; c.unref = () => {}; c.ref = () => {};
  c.pid = 0; c.file = file;
  c.on('error', () => {}); // que el error no tumbe la app si nadie escucha
  return c;
}
function spawn(file) { const c = fake(file); setTimeout(() => { c.emit('error', nope(file)); c.emit('exit', -1); c.emit('close', -1); }, 0); return c; }
const exec = (cmd, opts, cb) => execFile(String(cmd).split(' ')[0], [], opts, cb);
function execFileSync(file) { throw nope(file); }
function execSync(cmd) { throw nope(String(cmd).split(' ')[0]); }
function spawnSync(file) { return { status: -1, error: nope(file), stdout: '', stderr: '' }; }
const fork = spawn;
module.exports = { execFile, spawn, exec, execFileSync, execSync, spawnSync, fork };

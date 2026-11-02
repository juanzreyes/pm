// Sin servidores locales en Android (inicio de sesión con redirección local, hooks de Claude Code):
// el servidor "se crea" pero falla al escuchar, como si el puerto estuviera ocupado.
const { EventEmitter } = require('events');
function createServer() {
  const s = new EventEmitter();
  s.listen = (...a) => { setTimeout(() => s.emit('error', Object.assign(new Error('Servidor local no disponible en Android'), { code: 'EACCES' })), 0); const cb = a.find((x) => typeof x === 'function'); void cb; return s; };
  s.close = (cb) => { if (cb) cb(); return s; };
  s.address = () => ({ port: 0 });
  s.on('error', () => {});
  return s;
}
const request = () => { throw new Error('http.request no disponible en Android: usa fetch'); };
module.exports = { createServer, request, get: request, Agent: class {}, STATUS_CODES: {} };

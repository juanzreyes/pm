// crypto de Node en Android: aleatorios y hashes síncronos (md5/sha1/sha256), que es lo que usa la app.
// El cifrado con contraseña de las copias de seguridad no está en el teléfono (allí manda la nube cifrada).
const hash = require('hash.js');
const md5 = require('js-md5');

const randomBytes = (n, cb) => {
  const b = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n)));
  if (cb) { queueMicrotask(() => cb(null, b)); return undefined; }
  return b;
};
function createHash(alg) {
  const a = String(alg).toLowerCase().replace('-', '');
  const chunks = [];
  const h = {
    update(data, enc) { chunks.push(typeof data === 'string' ? Buffer.from(data, enc || 'utf8') : Buffer.from(data)); return h; },
    digest(enc) {
      const all = Buffer.concat(chunks);
      let bytes;
      if (a === 'md5') bytes = Buffer.from(md5.arrayBuffer(all));
      else if (a === 'sha1') bytes = Buffer.from(hash.sha1().update([...all]).digest());
      else if (a === 'sha256') bytes = Buffer.from(hash.sha256().update([...all]).digest());
      else if (a === 'sha512') bytes = Buffer.from(hash.sha512().update([...all]).digest());
      else throw new Error('Hash no disponible en Android: ' + alg);
      return enc ? bytes.toString(enc) : bytes;
    },
  };
  return h;
}
function createHmac(alg, key) {
  const a = String(alg).toLowerCase().replace('-', '');
  const k = typeof key === 'string' ? [...Buffer.from(key)] : [...key];
  const H = a === 'sha1' ? hash.sha1 : a === 'sha512' ? hash.sha512 : hash.sha256;
  const m = hash.hmac(H, k);
  const h = { update(d, enc) { m.update([...(typeof d === 'string' ? Buffer.from(d, enc || 'utf8') : Buffer.from(d))]); return h; }, digest(enc) { const b = Buffer.from(m.digest()); return enc ? b.toString(enc) : b; } };
  return h;
}
const nope = (what) => () => { throw new Error(`${what} no está disponible en Android`); };
module.exports = {
  randomBytes,
  randomUUID: () => globalThis.crypto.randomUUID(),
  getRandomValues: (a) => globalThis.crypto.getRandomValues(a),
  randomInt: (min, max) => { if (max === undefined) { max = min; min = 0; } return min + Math.floor(Math.random() * (max - min)); },
  createHash,
  createHmac,
  timingSafeEqual: (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0,
  scryptSync: nope('El cifrado de copias con contraseña'),
  createCipheriv: nope('El cifrado de copias con contraseña'),
  createDecipheriv: nope('El descifrado de copias con contraseña'),
  webcrypto: globalThis.crypto,
  subtle: globalThis.crypto && globalThis.crypto.subtle,
};

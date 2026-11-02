// util de Node: lo que usan algunas librerías.
const promisify = (fn) => (...a) => new Promise((res, rej) => fn(...a, (e, v) => (e ? rej(e) : res(v))));
const inspect = (v) => { try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return String(v); } };
const format = (f, ...a) => { let i = 0; const s = String(f).replace(/%[sdifjoO%]/g, (m) => (m === '%%' ? '%' : inspect(a[i++]))); return [s, ...a.slice(i).map(inspect)].join(' '); };
const inherits = (c, p) => { Object.setPrototypeOf(c.prototype, p.prototype); Object.setPrototypeOf(c, p); };
module.exports = { promisify, inspect, format, inherits, deprecate: (fn) => fn, debuglog: () => () => {}, isDeepStrictEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b), types: { isPromise: (p) => !!p && typeof p.then === 'function', isDate: (d) => d instanceof Date, isRegExp: (r) => r instanceof RegExp }, TextEncoder, TextDecoder };

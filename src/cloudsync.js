// Cliente de la sincronización en la nube (pm-sync, cloud/). Funciona igual en la PC (Node/Electron)
// y en Android (WebView): solo usa fetch, WebCrypto y CompressionStream.
//
// Seguridad: todo se cifra en el dispositivo con AES-256-GCM antes de salir. La llave maestra
// (32 bytes aleatorios) solo viaja de un dispositivo a otro dentro del QR de vinculación; de ella
// se derivan (HKDF) la llave de cifrado y la llave de acceso al servidor. El servidor solo ve
// paquetes ilegibles y guarda el SHA-256 de la llave de acceso.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else /** @type {any} */ (root).CloudSync = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_URL = 'https://pm-sync.eshoy.workers.dev';
  const subtle = () => globalThis.crypto.subtle;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // ---------- base64url ----------
  function b64(bytes) {
    let s = '';
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64(str) {
    const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '==='.slice((s.length + 3) % 4));
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

  // ---------- compresión (gzip) ----------
  async function pipe(bytes, stream) {
    const r = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await r.arrayBuffer());
  }
  const gzip = (bytes) => pipe(bytes, new CompressionStream('gzip'));
  const gunzip = (bytes) => pipe(bytes, new DecompressionStream('gzip'));

  // ---------- llaves ----------
  /** Un ecosistema nuevo: id del espacio y llave maestra. */
  function newSpace() { return { space: b64(random(18)), key: b64(random(32)) }; }
  /** Id de dispositivo (si no hay uno). */
  function newDeviceId() { return b64(random(12)); }

  async function derive(masterB64) {
    const master = await subtle().importKey('raw', unb64(masterB64), 'HKDF', false, ['deriveKey', 'deriveBits']);
    const salt = enc.encode('pm-pollito-sync-v1');
    const cryptoKey = await subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('cifrado') }, master, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const authBits = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('acceso') }, master, 256);
    return { cryptoKey, token: b64(new Uint8Array(authBits)) };
  }

  /** Objeto → JSON → gzip → AES-GCM → base64url(iv + cifrado). */
  async function seal(obj, cryptoKey) {
    const iv = random(12);
    const packed = await gzip(enc.encode(JSON.stringify(obj)));
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, cryptoKey, packed));
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv);
    out.set(ct, iv.length);
    return b64(out);
  }
  async function open(str, cryptoKey) {
    const all = unb64(str);
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, cryptoKey, all.subarray(12));
    return JSON.parse(dec.decode(await gunzip(new Uint8Array(plain))));
  }

  // ---------- vinculación (QR) ----------
  /** Texto del QR: pmpollito://pair?s=<espacio>&k=<llave>[&u=<servidor propio>] */
  function pairingLink({ space, key, url }) {
    const u = url && url !== DEFAULT_URL ? `&u=${encodeURIComponent(url)}` : '';
    return `pmpollito://pair?s=${space}&k=${key}${u}`;
  }
  /** Acepta el enlace del QR o el código corto "PM1-<espacio>-<llave>". */
  function parsePairing(text) {
    const t = String(text || '').trim();
    // Largos fijos (24 y 43): el espacio y la llave también pueden llevar "-", así que el guion solo
    // no sirve para separarlos.
    const m = /^PM1-([A-Za-z0-9_-]{24})-([A-Za-z0-9_-]{43})$/.exec(t);
    if (m) return { space: m[1], key: m[2], url: DEFAULT_URL };
    const q = /^pmpollito:\/\/pair\?(.+)$/.exec(t);
    if (!q) return null;
    const p = {};
    for (const kv of q[1].split('&')) { const [k, v] = kv.split('='); p[k] = decodeURIComponent(v || ''); }
    if (!/^[A-Za-z0-9_-]{22,64}$/.test(p.s || '') || !/^[A-Za-z0-9_-]{40,64}$/.test(p.k || '')) return null;
    return { space: p.s, key: p.k, url: p.u && /^https:\/\//.test(p.u) ? p.u.replace(/\/+$/, '') : DEFAULT_URL };
  }
  const shortCode = ({ space, key }) => `PM1-${space}-${key}`;

  // ---------- cliente ----------
  /**
   * @param {{ url?: string, space: string, key: string, device: string, fetch?: typeof fetch }} o
   */
  function client(o) {
    const base = (o.url || DEFAULT_URL).replace(/\/+$/, '');
    const doFetch = o.fetch || ((url, init) => globalThis.fetch(url, init));
    let keys = null;
    const k = async () => keys || (keys = await derive(o.key));
    async function call(method, path, body) {
      const { token } = await k();
      const res = await doFetch(base + path, {
        method,
        headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      let j = null;
      try { j = await res.json(); } catch { /* sin cuerpo */ }
      if (!res.ok || !j || j.ok === false) {
        throw Object.assign(new Error((j && j.error) || `HTTP ${res.status}`), { status: res.status });
      }
      return j;
    }
    return {
      device: o.device,
      /** Crea el espacio (o comprueba que la llave es la correcta). */
      ensure: () => call('PUT', `/v1/s/${o.space}`),
      /** Sube la foto de este dispositivo. meta = { name, kind } (también va cifrada). */
      async push(snapshot, meta, rev = 0) {
        const { cryptoKey } = await k();
        const data = await seal(snapshot, cryptoKey);
        const m = await seal(meta || {}, cryptoKey);
        return call('PUT', `/v1/s/${o.space}/d/${o.device}`, { data, meta: m, rev });
      },
      /** Fotos de los demás cambiadas desde `since`, la lista de dispositivos y mensajes después de `after`. */
      async pull(since = 0, after = 0) {
        const { cryptoKey } = await k();
        const j = await call('GET', `/v1/s/${o.space}/pull?device=${o.device}&since=${since}&after=${after}`);
        const safe = async (s) => { try { return await open(s, cryptoKey); } catch { return null; } };
        const devices = [];
        for (const d of j.devices) devices.push({ device: d.device, at: d.at, meta: d.meta ? (await safe(d.meta)) || {} : {} });
        const blobs = [];
        for (const b of j.blobs) { const data = await safe(b.data); if (data) blobs.push({ device: b.device, at: b.at, data }); }
        const messages = [];
        for (const m of j.messages) { const data = await safe(m.data); if (data) messages.push({ id: m.id, from: m.from, to: m.to, at: m.at, ...data }); }
        return { now: j.now, devices, blobs, messages };
      },
      /** Manda un mensaje cifrado a un dispositivo (o a todos con '*'). */
      async send(to, msg) {
        const { cryptoKey } = await k();
        return call('POST', `/v1/s/${o.space}/msg`, { from: o.device, to, data: await seal(msg, cryptoKey) });
      },
      /** Token de Firebase de este teléfono (vacío = borrarlo): la PC lo "despierta" con cada mensaje. */
      registerPush: (token) => call('PUT', `/v1/s/${o.space}/push`, { device: o.device, token: token || '' }),
      unlink: (device = o.device) => call('DELETE', `/v1/s/${o.space}/d/${device}`),
      wipe: () => call('DELETE', `/v1/s/${o.space}`),
    };
  }

  return { DEFAULT_URL, newSpace, newDeviceId, derive, seal, open, pairingLink, parsePairing, shortCode, client, b64, unb64 };
}));

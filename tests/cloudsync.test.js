// Cliente de la nube: cifrado, vinculación y protocolo (con un servidor falso en memoria).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/cloudsync');

test('cifrado de ida y vuelta; otra llave no puede abrirlo', async () => {
  const a = C.newSpace();
  const b = C.newSpace();
  const ka = await C.derive(a.key);
  const kb = await C.derive(b.key);
  const obj = { tareas: ['á é ñ 🐣'], n: 42, largo: 'x'.repeat(50000) };
  const sealed = await C.seal(obj, ka.cryptoKey);
  assert.ok(sealed.length < 2000, 'comprime antes de cifrar: ' + sealed.length);
  assert.ok(!sealed.includes('tareas'));
  assert.deepEqual(await C.open(sealed, ka.cryptoKey), obj);
  await assert.rejects(C.open(sealed, kb.cryptoKey));
  // La llave de acceso al servidor no es la llave maestra ni la de cifrado.
  assert.notEqual(ka.token, a.key);
  assert.match(ka.token, /^[A-Za-z0-9_-]{43}$/);
});

test('código de vinculación: enlace del QR y código corto', () => {
  const s = C.newSpace();
  assert.deepEqual(C.parsePairing(C.pairingLink(s)), { ...s, url: C.DEFAULT_URL });
  assert.deepEqual(C.parsePairing(C.shortCode(s)), { ...s, url: C.DEFAULT_URL });
  assert.deepEqual(C.parsePairing(C.pairingLink({ ...s, url: 'https://mio.example.workers.dev' })), { ...s, url: 'https://mio.example.workers.dev' });
  // Con guiones dentro del espacio y de la llave el código corto se sigue separando bien.
  for (let i = 0; i < 200; i++) { const x = C.newSpace(); assert.deepEqual(C.parsePairing(C.shortCode(x)), { ...x, url: C.DEFAULT_URL }); }
  assert.equal(C.parsePairing('hola'), null);
  assert.equal(C.parsePairing('pmpollito://pair?s=corto&k=corto'), null);
  assert.equal(C.parsePairing(C.pairingLink({ ...s, url: 'http://inseguro.example' })).url, C.DEFAULT_URL, 'solo https');
});

test('protocolo: el servidor solo recibe paquetes ilegibles y la llave de acceso', async () => {
  const seen = [];
  const store = { blobs: {}, msgs: [] };
  const fakeFetch = async (url, init) => {
    seen.push({ url, init });
    const u = new URL(url);
    const ok = (j) => ({ ok: true, status: 200, json: async () => ({ ok: true, now: 1000, ...j }) });
    if (init.method === 'PUT' && /\/d\//.test(u.pathname)) { store.blobs[u.pathname.split('/').pop()] = JSON.parse(init.body); return ok({}); }
    if (init.method === 'POST') { const b = JSON.parse(init.body); store.msgs.push({ id: store.msgs.length + 1, from: b.from, to: b.to, at: 1, data: b.data }); return ok({ id: store.msgs.length }); }
    if (u.pathname.endsWith('/pull')) {
      const dev = u.searchParams.get('device');
      return ok({
        devices: Object.entries(store.blobs).map(([d, b]) => ({ device: d, meta: b.meta, at: 1 })),
        blobs: Object.entries(store.blobs).filter(([d]) => d !== dev).map(([d, b]) => ({ device: d, data: b.data, at: 1 })),
        messages: store.msgs.filter((m) => m.from !== dev),
      });
    }
    return ok({});
  };
  const s = C.newSpace();
  const pc = C.client({ ...s, device: 'pc0001', fetch: fakeFetch });
  const ph = C.client({ ...s, device: 'ph0001', fetch: fakeFetch });
  await pc.push({ secreto: 'mis tareas' }, { name: 'PC de Ana', kind: 'pc' });
  await ph.send('*', { type: 'notify', text: 'hola' });
  const r = await ph.pull();
  assert.deepEqual(r.blobs[0].data, { secreto: 'mis tareas' });
  assert.deepEqual(r.devices[0].meta, { name: 'PC de Ana', kind: 'pc' });
  const r2 = await pc.pull();
  assert.equal(r2.messages[0].text, 'hola');
  const wire = JSON.stringify(seen.map((x) => [x.url, x.init.body]));
  assert.ok(!wire.includes('mis tareas') && !wire.includes('PC de Ana') && !wire.includes('hola'), 'nada legible viaja');
  assert.ok(!wire.includes(s.key), 'la llave maestra nunca sale del dispositivo');
  assert.ok(seen.every((x) => /^Bearer /.test(x.init.headers.authorization)));
});

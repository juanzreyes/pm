// Tests de la sección 2 de 2.0: presencia en el escritorio (ventanas, clima, respiración).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Espera a que el pollito termine de moverse (en Windows cada paso del salto tarda ~31 ms). */
async function settle(M) { let last = ''; for (let i = 0; i < 60; i++) { await sleep(60); const k = M.pos().join(','); if (k === last) return; last = k; } }
function fakeM(settings = {}) {
  const sent = [];
  let pos = [100, 600];
  const M = {
    store: { data: { settings: { ...settings }, pet: { name: 'Kiwi' }, position: { x: 100, y: 600 } }, save() {} },
    PET_W: 240, TEST: false, os, path, presenting: null, drag: null, SAFE: false,
    petWin: { isDestroyed: () => false, isVisible: () => true, getBounds: () => ({ x: pos[0], y: pos[1], width: 240, height: 300 }), getPosition: () => pos, setPosition: (x, y) => { pos = [x, y]; } },
    screen: { screenToDipRect: (_w, r) => r, getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }), getCursorScreenPoint: () => ({ x: 1, y: 1 }) },
    sendPet: (ch, d) => sent.push([ch, d]), say() {}, broadcast() {}, diag: { log() {} },
    sent, pos: () => pos,
  };
  return M;
}

test('ventanas: se sienta en la barra de título tras 2 muestras, sin tapar los botones', async () => {
  const M = fakeM();
  const pr = require('../src/main/presence')(M);
  const s = { p: 'code', wr: '400,300,1400,900,0' };
  pr.onSample(s);
  assert.equal(M.sent.length, 0, 'la primera muestra solo la apunta');
  pr.onSample(s);
  await settle(M);
  assert.deepEqual(M.sent.find((x) => x[0] === 'pet:perch'), ['pet:perch', { on: true }]);
  const [x, y] = M.pos();
  assert.equal(x, 620, 'a ~22% del borde izquierdo de la ventana');
  assert.equal(y, 300 - 300 + 36 + 4, 'patas sobre el borde superior');
  assert.ok(x + 240 < 1400 - 100, 'lejos de minimizar/maximizar/cerrar');
});

test('ventanas: maximizada o sin sitio arriba → vuelve a casa; si lo arrastras, se queda', async () => {
  const M = fakeM();
  const pr = require('../src/main/presence')(M);
  pr.onSample({ p: 'code', wr: '400,300,1400,900,0' });
  pr.onSample({ p: 'code', wr: '400,300,1400,900,0' });
  await settle(M);
  pr.onSample({ p: 'msedge', wr: '0,0,1920,1040,1' }); // maximizada
  await settle(M);
  assert.deepEqual(M.sent.filter((x) => x[0] === 'pet:perch').at(-1), ['pet:perch', { on: false }]);
  assert.deepEqual(M.pos(), [100, 600], 'vuelve a donde lo dejaste');
  // Una ventana pegada arriba (no cabe encima): no se sube.
  pr.onSample({ p: 'notepad', wr: '400,20,1200,700,0' });
  pr.onSample({ p: 'notepad', wr: '400,20,1200,700,0' });
  assert.equal(M.sent.filter((x) => x[0] === 'pet:perch' && x[1].on).length, 1);
  // Lo arrastras: 30 min sin saltar aunque cambies de ventana.
  pr.onSample({ p: 'code', wr: '400,300,1400,900,0' });
  pr.onDragged();
  pr.onSample({ p: 'code', wr: '500,400,1500,1000,0' });
  pr.onSample({ p: 'code', wr: '500,400,1500,1000,0' });
  assert.equal(M.sent.filter((x) => x[0] === 'pet:perch' && x[1].on).length, 1);
  // Desactivado en ajustes: nunca.
  const M2 = fakeM({ petPerch: false });
  const pr2 = require('../src/main/presence')(M2);
  pr2.onSample({ p: 'code', wr: '400,300,1400,900,0' });
  pr2.onSample({ p: 'code', wr: '400,300,1400,900,0' });
  assert.equal(M2.sent.length, 0);
});

test('ventanas: si mueves la ventana, la sigue sin saltar; sus propias ventanas no cuentan', async () => {
  const M = fakeM();
  const pr = require('../src/main/presence')(M);
  pr.onSample({ p: 'code', wr: '400,300,1400,900,0' });
  pr.onSample({ p: 'code', wr: '400,300,1400,900,0' });
  await settle(M);
  const hops = () => M.sent.filter((x) => x[0] === 'pet:anim' && x[1] === 'hop').length;
  const before = hops();
  pr.onSample({ p: 'code', wr: '600,350,1600,950,0' });
  await settle(M);
  assert.equal(M.pos()[0], 820, 'la sigue');
  assert.equal(hops(), before, 'sin saltar');
  pr.onSample({ p: 'electron', wr: '0,0,300,300,0' }); // hiciste clic en el pollito
  assert.equal(M.pos()[0], 820);
});

test('clima: tu ciudad (Open-Meteo) → paraguas, bufanda, abanico', async (t) => {
  const M = fakeM({ weatherCity: 'San Salvador' });
  const pr = require('../src/main/presence')(M);
  assert.equal(pr.weatherKind(61, 24, 0), 'rain');
  assert.equal(pr.weatherKind(73, -2, 0), 'snow');
  assert.equal(pr.weatherKind(1, 33, 0), 'hot');
  assert.equal(pr.weatherKind(2, 5, 0), 'cold');
  assert.equal(pr.weatherKind(0, 22, 0), 'mild');
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  const urls = [];
  globalThis.fetch = async (u) => {
    urls.push(u);
    if (/geocoding/.test(u)) return { json: async () => ({ results: [{ latitude: 13.69, longitude: -89.19, name: 'San Salvador', country: 'El Salvador' }] }) };
    return { json: async () => ({ current: { temperature_2m: 27.4, precipitation: 1.2, weather_code: 63 } }) };
  };
  const w = await pr.weatherTick(true);
  assert.deepEqual({ kind: w.kind, temp: w.temp, place: w.place }, { kind: 'rain', temp: 27, place: 'San Salvador, El Salvador' });
  assert.match(urls[0], /name=San%20Salvador/);
  assert.deepEqual(M.sent.at(-1), ['pet:weather', w]);
  await pr.weatherTick(true);
  assert.equal(urls.filter((u) => /geocoding/.test(u)).length, 1, 'la ciudad se busca una sola vez');
  M.store.data.settings.weatherCity = '';
  assert.equal(await pr.weatherTick(true), null, 'sin ciudad no hay clima');
});

test('respiración: 4 ciclos de inhala 4 · aguanta 2 · exhala 6', () => {
  const M = fakeM();
  const pr = require('../src/main/presence')(M);
  pr.breathe(4);
  assert.deepEqual(M.sent.at(-1), ['pet:breathe', { cycles: 4, inhale: 4, hold: 2, exhale: 6 }]);
  pr.breathe(99);
  assert.equal(M.sent.at(-1)[1].cycles, 10, 'con tope');
});

// Pulido 2/6 — física del pollito: lanzarlo, rebotes y aterrizaje.
const test = require('node:test');
const assert = require('node:assert/strict');
const phys = require('../src/petphysics');

const WA = { x: 0, y: 0, width: 1920, height: 1040 };
const B = phys.boundsFor(WA, 240, 300);

test('velocidad del arrastre y cuándo es un lanzamiento', () => {
  assert.deepEqual(phys.velocityFrom([{ t: 0, x: 0, y: 0 }, { t: 40, x: 40, y: 0 }, { t: 80, x: 100, y: 10 }]), { vx: 1250, vy: 125 });
  assert.deepEqual(phys.velocityFrom([{ t: 0, x: 0, y: 0 }]), { vx: 0, vy: 0 });
  assert.deepEqual(phys.velocityFrom([{ t: 0, x: 0, y: 0 }, { t: 500, x: 900, y: 0 }], 600), { vx: 0, vy: 0 }, 'muestras viejas no cuentan');
  assert.equal(phys.isThrow({ vx: 300, vy: 200 }), false, 'soltarlo despacio no lo lanza');
  assert.equal(phys.isThrow({ vx: 900, vy: -100 }), true);
  assert.deepEqual(B, { left: -60, right: 1740, top: -120, floor: 740 });
});

test('lanzado: rebota en la pared, bota cada vez menos y queda en la barra de tareas', () => {
  const r = phys.simulate({ x: 800, y: 300, vx: 2500, vy: -900 }, B);
  assert.equal(r.end.y, B.floor);
  assert.equal(r.end.vx, 0);
  assert.ok(r.t < 4, 'se detiene pronto: ' + r.t);
  assert.equal(r.events[0].kind, 'wall');
  const floors = r.events.filter((e) => e.kind === 'floor').map((e) => e.speed);
  assert.ok(floors.length >= 2 && floors.every((s, i) => i === 0 || s < floors[i - 1]), 'botes decrecientes: ' + floors);
  assert.ok(r.end.x >= B.left && r.end.x <= B.right);
});

test('nunca sale de la pantalla, aunque lo lances hacia arriba muy fuerte', () => {
  for (const v of [{ vx: -4000, vy: -4000 }, { vx: 4500, vy: 4500 }, { vx: 0, vy: -4500 }]) {
    let s = { x: 900, y: 400, ...v };
    for (let i = 0; i < 400; i++) {
      s = phys.step(s, 1 / 60, B).s;
      assert.ok(s.x >= B.left && s.x <= B.right && s.y >= B.top && s.y <= B.floor, JSON.stringify(s));
    }
  }
});

test('vuelo de la ventana: se mueve, avisa de los golpes y guarda dónde aterrizó', async () => {
  const sent = [];
  let pos = [800, 300];
  const M = {
    store: { data: { settings: {} }, save() {} },
    petWin: { isDestroyed: () => false, getPosition: () => pos, getSize: () => [240, 300], setPosition: (x, y) => { pos = [x, y]; } },
    screen: { getDisplayNearestPoint: () => ({ workArea: WA }) },
    panelWin: null, placePanel() {}, diag: { log() {} }, sendPet: (ch, v) => sent.push([ch, v]),
  };
  const fly = require('../src/main/petfly')(M);
  // Soltarlo despacio: no vuela.
  const t = Date.now();
  fly.track(800, 300); fly.track(801, 300);
  assert.equal(fly.release(), false);
  // Lanzarlo: muestras rápidas hacia la derecha.
  const realNow = Date.now;
  let fake = t;
  Date.now = () => fake;
  try {
    for (let i = 0; i < 5; i++) { fly.track(800 + i * 60, 300 - i * 10); fake += 20; }
    assert.equal(fly.release(), true);
  } finally { Date.now = realNow; }
  assert.deepEqual(sent[0], ['pet:fly', { on: true, vx: sent[0][1].vx }]);
  assert.ok(sent[0][1].vx > 2000);
  const end = Date.now() + 6000;
  while (fly.flying() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  assert.equal(fly.flying(), false);
  assert.equal(pos[1], 740, 'en el suelo');
  assert.deepEqual(M.store.data.position, { x: pos[0], y: 740 });
  assert.ok(sent.some(([ch, v]) => ch === 'pet:impact' && v.kind === 'wall'));
  assert.deepEqual(sent.at(-1), ['pet:fly', { on: false, landed: true }]);
  // Con "reducir movimiento" no vuela.
  M.store.data.settings.reducedMotion = true;
  fake = Date.now();
  Date.now = () => fake;
  try {
    for (let i = 0; i < 5; i++) { fly.track(i * 60, 0); fake += 20; }
    assert.equal(fly.release(), false);
  } finally { Date.now = realNow; }
});

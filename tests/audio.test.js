// Tests del clasificador "¿música o voz?" y de cómo decide el pollito si baila.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ac = require('../src/audioclass');
const petlife = require('../src/petlife');

function readWav(file) {
  const b = fs.readFileSync(file);
  let p = 12, rate = 0, data = null;
  while (p < b.length) {
    const id = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') rate = b.readUInt32LE(p + 12);
    if (id === 'data') data = b.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size % 2);
  }
  const out = new Float32Array(data.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = data.readInt16LE(i * 2) / 32768;
  return { rate, samples: out };
}
// Música sintética: bombo, caja, hi-hat, bajo y acordes (reproducible con semilla).
function synthMusic(rate, secs, { bpm = 120, kick = true, seed = 1 } = {}) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const out = new Float32Array(rate * secs), beat = 60 / bpm, roots = [55, 73.4, 82.5, 69.3];
  for (let i = 0; i < out.length; i++) {
    const t = i / rate, b = Math.floor(t / beat), tb = t - b * beat, root = roots[Math.floor(b / 4) % 4];
    let v = 0;
    if (kick) { v += Math.sin(2 * Math.PI * (50 + 70 * Math.exp(-tb * 30)) * tb) * Math.exp(-tb * 9) * 0.9; if (b % 2) v += rnd() * Math.exp(-tb * 18) * 0.35; }
    v += rnd() * Math.exp(-(t % (beat / 2)) * 60) * 0.12;
    v += Math.sign(Math.sin(2 * Math.PI * root * t)) * 0.18 * (0.6 + 0.4 * Math.exp(-tb * 3));
    for (const k of [4, 5, 6]) v += Math.sin(2 * Math.PI * root * k * t) * 0.07;
    out[i] = v * 0.5;
  }
  return out;
}
const mix = (a, b, g) => { const n = Math.min(a.length, b.length), o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = a[i] + b[i] * g; return o; };
const verdict = (sig, rate) => {
  const r = ac.classifySignal(sig, rate).filter((x) => !x.silent);
  return r.reduce((a, x) => a + x.music, 0) / r.length;
};

const voz = readWav(path.join(__dirname, 'fixtures', 'voz.wav'));
const R = voz.rate;

test('audio: alguien hablando → voz', () => {
  assert.ok(verdict(voz.samples, R) < 0.3);
});
test('audio: música con batería, lenta y sin batería → música', () => {
  assert.ok(verdict(synthMusic(R, 12), R) > 0.8);
  assert.ok(verdict(synthMusic(R, 12, { bpm: 75, seed: 3 }), R) > 0.8);
  assert.ok(verdict(synthMusic(R, 12, { kick: false, seed: 5 }), R) > 0.8);
});
test('audio: canción con voz encima → música; podcast/vlog con música de fondo → voz', () => {
  assert.ok(verdict(mix(synthMusic(R, 10, { seed: 9 }), voz.samples, 0.9), R) > 0.7);
  assert.ok(verdict(mix(voz.samples, synthMusic(R, 10, { seed: 11 }), 0.12), R) < 0.4);
  assert.ok(verdict(mix(voz.samples, synthMusic(R, 10, { seed: 13 }), 0.25), R) < 0.5);
});
test('audio: el silencio no decide nada', () => {
  const r = ac.classifySignal(new Float32Array(R * 8), R);
  assert.ok(r.every((x) => x.silent));
});

// ---- decisión del pollito ----
function ctxWith(v) {
  const store = { data: { days: {}, settings: {}, alerts: {}, pet: { name: 'K' } }, save() {} };
  const sent = [];
  let media = null;
  return {
    sent, media: () => media,
    ctx: {
      store, send: (ch, d) => sent.push([ch, d]), say() {}, broadcast() {}, today: () => ({}), isMuted: () => false,
      getMeeting: () => null, isPresenting: () => false, aiAvailable: () => false,
      audioVerdict: () => v.value, audioOnMedia: (p) => { media = p; },
    },
  };
}
test('pollito: con voz no baila; con música sí; mientras escucha, espera', () => {
  const v = { value: 'pending' };
  const t = ctxWith(v);
  const pl = petlife.create(t.ctx);
  const sample = { mu: 'IbaiExtra - La Velada', ms: 'OperaSoftware.OperaGXWebBrowser', t: '' };
  pl.onSample(sample);
  assert.equal(t.media(), true); // empieza a escuchar
  assert.equal(t.sent.length, 0); // aún no decide
  v.value = 'speech';
  pl.onSample(sample);
  assert.equal(t.sent.length, 0); // alguien hablando: no baila
  v.value = 'music';
  pl.onSample(sample);
  assert.equal(t.sent.at(-1)[0], 'pet:music');
  assert.equal(t.sent.at(-1)[1].heard, true);
});
test('pollito: si no se puede escuchar, decide por la app y el título', () => {
  const v = { value: 'unavailable' };
  const t = ctxWith(v);
  const pl = petlife.create(t.ctx);
  pl.onSample({ mu: 'Canal - Cómo organizar tu día', ms: 'Chrome', t: '' });
  assert.equal(t.sent.length, 0);
  pl.onSample({ mu: 'Bad Bunny - Song (Official Video)', ms: 'Chrome', t: '' });
  assert.equal(t.sent.at(-1)[0], 'pet:music');
  const t2 = ctxWith(v);
  petlife.create(t2.ctx).onSample({ mu: 'Artista - Tema', ms: 'Spotify.exe', t: '' });
  assert.equal(t2.sent.at(-1)[0], 'pet:music');
});

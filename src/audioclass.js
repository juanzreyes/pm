// ¿Música o voz? Clasificador ligero de audio (sin IA ni internet).
// Se usa en la ventana oculta que escucha el sonido del PC mientras algo se reproduce, y en los tests.
// Nada se graba ni se guarda: solo se calculan unas cifras por fotograma y se descartan.
//
// Rasgos (clásicos en la literatura de "speech/music discrimination"):
//  · Pausas: la voz tiene muchos fotogramas de poca energía entre palabras; la música casi no.
//  · Modulación a ~4 Hz: el ritmo de las sílabas; en la voz la energía sube y baja 3-6 veces por segundo.
//  · Graves: bombo y bajo ponen energía por debajo de 150 Hz; la voz apenas tiene.
//  · Pulso: la música repite golpes a intervalos regulares (autocorrelación del "flux" espectral).
//  · Agudos continuos: platillos y hi-hats.
(function (root) {
  const FFT_SIZE = 2048;

  // FFT radix-2 in situ (re, im: Float64Array de longitud potencia de 2).
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }
  const hann = new Float64Array(FFT_SIZE).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));

  /** Rasgos de un fotograma (2048 muestras). prev: espectro anterior (para el flux). */
  function frameFeatures(samples, sampleRate, prev) {
    const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
    let sum2 = 0;
    for (let i = 0; i < FFT_SIZE; i++) { const v = samples[i] || 0; sum2 += v * v; re[i] = v * hann[i]; }
    fft(re, im);
    const half = FFT_SIZE / 2, hz = sampleRate / FFT_SIZE;
    const mag = new Float64Array(half);
    let bass = 0, mid = 0, high = 0, flux = 0;
    for (let k = 1; k < half; k++) {
      const m = Math.hypot(re[k], im[k]);
      mag[k] = m;
      const f = k * hz, e = m * m;
      if (f >= 30 && f < 150) bass += e; else if (f >= 150 && f < 4000) mid += e; else if (f >= 4000 && f < 16000) high += e;
      if (prev) { const d = m - prev[k]; if (d > 0) flux += d; }
    }
    return { rms: Math.sqrt(sum2 / FFT_SIZE), bass, mid, high, flux, mag };
  }

  const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0; };
  // Energía de la envolvente en una banda de frecuencias de modulación (DFT directa, pocos puntos).
  function modEnergy(env, rate, f0, f1) {
    const n = env.length, m = mean(env);
    let e = 0, count = 0;
    for (let f = f0; f <= f1; f += 0.5) {
      let r = 0, i = 0;
      for (let t = 0; t < n; t++) { const a = (2 * Math.PI * f * t) / rate; r += (env[t] - m) * Math.cos(a); i += (env[t] - m) * Math.sin(a); }
      e += (r * r + i * i) / (n * n); count++;
    }
    return e / Math.max(1, count);
  }
  // Autocorrelación normalizada máxima del flux en retardos de pulso musical (60-180 ppm).
  function beatStrength(flux, rate) {
    const n = flux.length, m = mean(flux);
    const x = flux.map((v) => v - m);
    const r0 = x.reduce((s, v) => s + v * v, 0) || 1;
    let best = 0;
    for (let lag = Math.round(rate * 0.33); lag <= Math.round(rate * 1.0) && lag < n - 4; lag++) {
      let r = 0;
      for (let t = 0; t + lag < n; t++) r += x[t] * x[t + lag];
      best = Math.max(best, r / r0 * (n / (n - lag)));
    }
    return Math.max(0, Math.min(1, best));
  }

  /**
   * frames: [{ rms, bass, mid, high, flux }] de varios segundos seguidos · rate: fotogramas por segundo.
   * Devuelve { music: 0..1, silent, features }.
   */
  function classify(frames, rate) {
    const rms = frames.map((f) => f.rms);
    const loud = pct(rms, 0.9);
    if (frames.length < rate * 2 || loud < 0.003) return { music: 0.5, silent: true, features: null };
    const m = mean(rms);
    const ler = rms.filter((v) => v < 0.5 * m).length / rms.length; // fotogramas de poca energía
    const pauses = rms.filter((v) => v < 0.12 * loud).length / rms.length; // silencios entre palabras
    const env = rms.map((v) => v / (loud || 1));
    const mod4 = modEnergy(env, rate, 3, 6);
    const modAll = modEnergy(env, rate, 0.5, 9) || 1e-9;
    const syllabic = mod4 / modAll; // proporción de la modulación que cae en el ritmo de las sílabas
    const tot = frames.map((f) => f.bass + f.mid + f.high + 1e-12);
    const bassRatio = mean(frames.map((f, i) => f.bass / tot[i]));
    const highRatio = mean(frames.map((f, i) => f.high / tot[i]));
    const beat = beatStrength(frames.map((f) => f.flux), rate);
    // Banda de la voz (150-4000 Hz): la voz sube y baja con cada sílaba y deja huecos, aunque haya música de fondo.
    const midEnv = frames.map((f) => Math.sqrt(f.mid));
    const midMean = mean(midEnv) || 1e-9;
    const midLer = midEnv.filter((v) => v < 0.5 * midMean).length / midEnv.length;
    const midNorm = midEnv.map((v) => v / midMean);
    const midMod = modEnergy(midNorm, rate, 2.5, 7); // profundidad de la modulación silábica
    const midRange = pct(midEnv, 0.9) / (pct(midEnv, 0.15) || 1e-9); // rango dinámico (sílaba vs hueco)
    // Puntuación (log-odds) → probabilidad de música.
    let s = 0;
    s += (0.32 - ler) * 7;
    s -= (pauses - 0.12) * 9;
    s -= (Math.min(1.5, syllabic) - 0.9) * 1.5; // ritmo de sílabas (pesa poco: la música también se modula)
    s += Math.min(0.3, bassRatio - 0.06) * 6;
    s += (beat - 0.3) * 4;
    // Lo más fiable para 'alguien hablando' (también con música de fondo): huecos y modulación en la banda de la voz.
    s -= (midLer - 0.3) * 20;
    s -= (Math.min(0.02, midMod) - 0.004) * 400;
    s -= (Math.min(4, Math.log10(midRange + 1)) - 1) * 0.8;
    s += Math.min(0.2, highRatio - 0.03) * 6;
    const music = 1 / (1 + Math.exp(-s));
    return { music, silent: false, features: { ler, pauses, syllabic, bassRatio, highRatio, beat, midLer, midMod, midRange, score: s } };
  }

  /** Clasifica una señal completa (Float32Array mono) por ventanas; útil en tests. */
  function classifySignal(signal, sampleRate, { fps = 20, windowSec = 6 } = {}) {
    // Los fotogramas de 2048 muestras deben durar ~43 ms (como a 48 kHz); con menos frecuencia
    // de muestreo durarían más y "taparían" las pausas entre sílabas → se remuestrea a 48 kHz.
    if (sampleRate < 44100) {
      const to = 48000, n = Math.floor(signal.length * to / sampleRate), up = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = i * sampleRate / to, j = Math.floor(x), f = x - j;
        up[i] = (signal[j] || 0) * (1 - f) + (signal[j + 1] || 0) * f;
      }
      signal = up;
      sampleRate = to;
    }
    const hop = Math.round(sampleRate / fps);
    const frames = [];
    let prev = null;
    for (let i = 0; i + FFT_SIZE <= signal.length; i += hop) {
      const f = frameFeatures(signal.subarray(i, i + FFT_SIZE), sampleRate, prev);
      prev = f.mag;
      frames.push(f);
    }
    const per = fps * windowSec;
    const out = [];
    for (let i = 0; i + per <= frames.length; i += Math.round(per / 2)) out.push(classify(frames.slice(i, i + per), fps));
    return out;
  }

  const api = { FFT_SIZE, fft, frameFeatures, classify, classifySignal };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AudioClass = api;
})(typeof window !== 'undefined' ? window : globalThis);

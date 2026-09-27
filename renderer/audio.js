// Escucha el sonido que sale por los altavoces (captura "loopback", no el micrófono) y cada 2 s
// dice si parece música o voz. Solo se calculan cifras por fotograma (energía por bandas, pausas,
// ritmo); el audio no se graba, no se guarda y no sale del PC.
/* global AudioClass */
(async () => {
  const FPS = 20; // fotogramas por segundo analizados
  const WINDOW = FPS * 6; // se decide con los últimos 6 s
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 1, height: 1, frameRate: 1 } });
    for (const t of stream.getVideoTracks()) t.stop(); // solo interesa el sonido
    if (!stream.getAudioTracks().length) throw new Error('sin pista de audio del sistema');
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = AudioClass.FFT_SIZE;
    an.smoothingTimeConstant = 0;
    src.connect(an); // sin conectar a los altavoces: no se reproduce nada
    const buf = new Float32Array(AudioClass.FFT_SIZE);
    const frames = [];
    let prev = null;
    setInterval(() => {
      an.getFloatTimeDomainData(buf);
      const f = AudioClass.frameFeatures(buf, ctx.sampleRate, prev);
      prev = f.mag;
      frames.push({ rms: f.rms, bass: f.bass, mid: f.mid, high: f.high, flux: f.flux });
      if (frames.length > WINDOW) frames.shift();
    }, 1000 / FPS);
    setInterval(() => {
      if (frames.length < FPS * 4) return;
      const r = AudioClass.classify(frames, FPS);
      pm.audioResult({ music: r.music, silent: r.silent, features: r.features });
    }, 2000);
  } catch (e) {
    pm.audioResult({ error: e && e.message ? e.message : String(e) });
  }
})();

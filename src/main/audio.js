// ¿Música o alguien hablando? Escucha el sonido del PC (no el micrófono) solo mientras algo se
// reproduce, en una ventana oculta y aislada que calcula unas cifras cada 2 s y no graba ni guarda nada.
// `M` es el contexto compartido de la app (ver main.js).
module.exports = function install(M) {
  let win = null;
  let verdict = 'pending'; // 'music' | 'speech' | 'pending'
  let lastAt = 0;
  let last = null; // último resultado (para diagnóstico)
  let streakMusic = 0;
  let streakSpeech = 0;
  let failed = '';
  let stopTimer = null;

  const enabled = () => M.store.data.settings.musicDetect !== false && M.store.data.settings.musicMode !== false && !M.SAFE;
  const AUDIO_URL = () => require('url').pathToFileURL(M.path.join(M.APP_DIR, 'renderer', 'audio.html')).href.toLowerCase();
  const isAudioPage = (u) => decodeURIComponent(String(u || '')).toLowerCase().startsWith(decodeURIComponent(AUDIO_URL()));

  function start() {
    if (!enabled() || failed || (win && !win.isDestroyed())) return;
    verdict = 'pending';
    streakMusic = streakSpeech = 0;
    win = new M.BrowserWindow({
      show: false, width: 120, height: 80, skipTaskbar: true, focusable: false,
      webPreferences: {
        preload: M.path.join(M.APP_DIR, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
        backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required',
      },
    });
    win.loadFile(M.path.join(M.APP_DIR, 'renderer', 'audio.html'));
    win.on('closed', () => { win = null; });
  }
  function stop() {
    clearTimeout(stopTimer);
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
    verdict = 'pending';
    streakMusic = streakSpeech = 0;
  }
  /** El vigilante avisa si hay algo reproduciéndose. */
  function onMedia(playing) {
    if (playing) { clearTimeout(stopTimer); stopTimer = null; start(); }
    else if (win && !stopTimer) stopTimer = setTimeout(stop, 30000); // si en 30 s no vuelve a sonar, se libera
  }
  function onResult(r) {
    if (!r || typeof r !== 'object') return;
    if (r.error) {
      failed = String(r.error).slice(0, 200);
      M.diag.log('info', `No puedo escuchar el sonido del PC (${failed}); uso el tipo de app para decidir si es música.`);
      stop();
      return;
    }
    lastAt = Date.now();
    last = { music: Number(r.music) || 0, silent: !!r.silent, features: r.features || null, at: lastAt };
    if (r.silent) return;
    // Histéresis: dos lecturas seguidas para cambiar de opinión (evita que baile a trompicones).
    if (last.music >= 0.65) { streakMusic++; streakSpeech = 0; }
    else if (last.music <= 0.4) { streakSpeech++; streakMusic = 0; }
    if (streakMusic >= 2) verdict = 'music';
    if (streakSpeech >= 2) verdict = 'speech';
  }
  /** 'off' (desactivado) · 'unavailable' (no se pudo escuchar) · 'pending' · 'music' · 'speech' */
  function audioVerdict() {
    if (!enabled()) return 'off';
    if (failed) return 'unavailable';
    if (!win || Date.now() - lastAt > 15000) return 'pending';
    return verdict;
  }
  /** Permisos: solo la página de escucha puede capturar el audio del sistema. */
  function setupAudioCapture() {
    const { session, desktopCapturer } = require('electron');
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      if (!isAudioPage(request.frame && request.frame.url)) return callback({});
      desktopCapturer.getSources({ types: ['screen'] })
        .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
        .catch(() => callback({}));
    });
    M.ipcMain.on('audio:result', (_e, r) => onResult(r));
  }

  return {
    audioStart: start, audioStop: stop, audioOnMedia: onMedia, audioVerdict, setupAudioCapture, isAudioPage,
    get audioState() { return { verdict: audioVerdict(), last, failed, listening: !!(win && !win.isDestroyed()) }; },
  };
};

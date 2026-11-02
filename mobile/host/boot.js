// Arranque de la app de Android: carga los datos guardados y corre el mismo main.js de la PC.
const fs = require('fs');
const native = require('./native');
const views = require('./views');

(async () => {
  try {
    globalThis.__pmDevice = { name: native.deviceName() };
    const info = await native.info();
    globalThis.__pmAppVersion = info.version || __PM_VERSION__;
    const appFiles = await (await fetch('appfiles.json')).json();
    await fs.__init(appFiles);
    native.onBack(() => views.back());
    native.onPause(() => fs.__flush());
    native.ensureNotifications();
    if (native.isNative()) {
      globalThis.__pmScan = native.scanQR;
      // Lo que usa src/main/cloud.js en el teléfono (ver PmNativePlugin.java).
      globalThis.__pmNativeCloud = (cfg) => native.configureCloud(cfg);
      globalThis.__pmNotifyOnce = (id, title, body, silent) => native.notifyOnce(id, title, body, silent);
      native.pushToken().then((t) => { globalThis.__pmPushToken = t; });
    }
    require('./overlay').install();
    require('../../main.js');
  } catch (e) {
    console.error('Arranque:', e);
    const b = document.getElementById('boot');
    if (b) b.querySelector('span').textContent = '😿 No pude arrancar: ' + e.message;
    return;
  }
  // El panel avisa cuando está listo; mientras, la pantalla de arranque.
  const hide = () => document.getElementById('boot').classList.add('gone');
  const t0 = Date.now();
  const wait = setInterval(() => {
    const panel = document.querySelector('#main iframe');
    if ((panel && panel.contentWindow && panel.contentWindow.pm && panel.contentDocument.readyState === 'complete') || Date.now() - t0 > 8000) { clearInterval(wait); setTimeout(hide, 250); }
  }, 120);
})();

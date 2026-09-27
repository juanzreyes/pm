// Bandeja del sistema: icono dinámico y menú.
// Parte del proceso principal (antes en main.js). `M` es el contexto compartido de la app:
// da acceso a todo lo demás (ventanas, datos, funciones de otros módulos).
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  // ---------- icono de bandeja (pollito dibujado a mano, 32x32) ----------
  function trayIcon() {
    const S = 32;
    const buf = Buffer.alloc(S * S * 4);
    const set = (x, y, [r, g, b, a = 255]) => {
      if (x < 0 || y < 0 || x >= S || y >= S) return;
      const i = (y * S + x) * 4;
      buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = a; // BGRA
    };
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = x - 16, dy = y - 18;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= 12.5) set(x, y, d > 11.5 ? [230, 160, 20] : [255, 212, 59]);
      }
    }
    for (let y = 3; y < 7; y++) for (let x = 15; x < 18; x++) set(x, y, [255, 200, 40]); // copete
    for (let y = 14; y < 18; y++) for (let x = 11; x < 13; x++) set(x, y, [40, 30, 20]); // ojo
    for (let y = 14; y < 18; y++) for (let x = 20; x < 22; x++) set(x, y, [40, 30, 20]); // ojo
    for (let y = 19; y < 22; y++) for (let x = 14; x < 19; x++) if (x - 14 + (y - 19) < 5) set(x, y, [255, 128, 32]); // pico
    set(9, 20, [255, 150, 150]); set(23, 20, [255, 150, 150]);
    return M.nativeImage.createFromBitmap(buf, { width: S, height: S });
  }

  // ---------- icono dinámico de la bandeja: anillo con el % de la sesión o el pomodoro ----------
  let trayBase = null;
  let lastTrayKey = '';
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function trayIconWith(frac, color) {
    const S = 32;
    if (!trayBase) {
      const png = M.nativeImage.createFromPath(M.path.join(M.APP_DIR, 'build', 'icon.png'));
      trayBase = png.isEmpty() ? trayIcon() : png.resize({ width: S, height: S, quality: 'best' });
    }
    const buf = Buffer.from(trayBase.toBitmap()); // BGRA
    const [r, g, b] = hexRgb(color);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = x + 0.5 - S / 2, dy = y + 0.5 - S / 2;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 12.6 || d > 15.9) continue;
        let ang = Math.atan2(dx, -dy); // 0 arriba, sentido horario
        if (ang < 0) ang += Math.PI * 2;
        const on = ang / (Math.PI * 2) <= frac;
        const i = (y * S + x) * 4;
        const [cr, cg, cb, ca] = on ? [r, g, b, 255] : [60, 50, 40, 110];
        const a = ca / 255;
        buf[i] = Math.round(cb * a + buf[i] * (1 - a));
        buf[i + 1] = Math.round(cg * a + buf[i + 1] * (1 - a));
        buf[i + 2] = Math.round(cr * a + buf[i + 2] * (1 - a));
        buf[i + 3] = Math.max(buf[i + 3], ca);
      }
    }
    return M.nativeImage.createFromBitmap(buf, { width: S, height: S });
  }
  function updateTrayIcon() {
    if (!M.tray) return;
    const name = M.store.data.pet.name || 'PM';
    const pomo = M.prod && M.prod.pomoState();
    const s = (M.usage.limits || []).find((l) => l.key === 'five_hour');
    let frac = 0, color = '#b9b0a0', tip = `${name} · tu pollito PM`;
    if (pomo && pomo.endsAt) {
      const total = (pomo.phase === 'focus' ? 25 : pomo.long ? 15 : 5) * 60e3;
      const left = Math.max(0, pomo.endsAt - Date.now());
      frac = left / total;
      color = pomo.phase === 'focus' ? '#e63946' : '#3cc46b';
      const mm = String(Math.floor(left / 60000)).padStart(2, '0'), ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
      tip = `${name} · ${pomo.phase === 'focus' ? '🍅' : '☕'} ${mm}:${ss}`;
    } else if (s) {
      const p = s.utilization;
      frac = Math.min(1, p / 100);
      color = p >= 90 ? '#e63946' : p >= 75 ? '#ff8c1a' : p >= 50 ? '#f5c518' : '#3cc46b';
      const f = M.usage.forecast && M.usage.forecast.five_hour;
      tip = `${name} · Sesión ${Math.round(p)}%${f && f.rate ? ` (+${Math.round(f.rate)}%/h)` : ''} · reinicio en ${M.brain.fmtUntil(s.resetsAt)}`;
    }
    const unread = (M.store.data.inbox || []).filter((x) => !x.read && x.cat !== 'pet').length;
    if (unread) tip += ` · 🔔 ${unread}`;
    const key = `${Math.round(frac * 40)}|${color}`;
    if (key !== lastTrayKey) { lastTrayKey = key; M.tray.setImage(trayIconWith(frac, color)); }
    M.tray.setToolTip(M.T(tip));
  }

  // Sale del modo "presentando" a mano (desde la bandeja).
  function forceShowPet() {
    M.presenting = null;
    M.presentQuietSince = 0;
    M.presentBuffer.length = 0;
    presentSnoozeUntil = Date.now() + 30 * 60000; // no volver a esconderse en 30 min
    if (M.petWin) M.petWin.showInactive();
    if (M.tray) { M.tray.setToolTip('PM Pollito'); M.tray.refreshMenu && M.tray.refreshMenu(); }
    M.broadcast();
  }
  let presentSnoozeUntil = 0;

  function buildTray() {
    const png = M.nativeImage.createFromPath(M.path.join(M.APP_DIR, 'build', 'icon.png'));
    M.tray = new M.Tray(png.isEmpty() ? trayIcon() : png.resize({ width: 32, height: 32 }));
    const refresh = () => {
      const name = M.store.data.pet.name || 'PM';
      updateTrayIcon();
      M.tray.setContextMenu(
        M.Menu.buildFromTemplate(/** @type {Electron.MenuItemConstructorOptions[]} */ ([
          { label: `🐣 ${name}`, enabled: false },
          { type: 'separator' },
          { label: 'Abrir panel', click: () => M.openPanel('chat') },
          { label: '🍅 Pomodoro (empezar / detener)', click: () => (M.prod.pomoState() ? M.prod.pomoStop() : M.prod.pomoStart()) },
          { label: '✍️ Anotar rápido  (Ctrl+Alt+P)', click: M.openCapture },
          { label: '📊 Informe semanal', click: () => M.openPanel('report') },
          { label: '📈 Estadísticas', click: () => M.openPanel('stats') },
          { label: '🎮 Minijuego', click: M.openGame },
          { label: 'Daily de la mañana', click: () => M.openPanel('standup') },
          { label: 'Cierre del día', click: () => M.openPanel('review') },
          { label: 'Actualizar consumo', click: () => M.refreshUsage(true) },
          M.isMuted()
            ? { label: '🔔 Quitar silencio', click: () => M.setMute(0) }
            : { label: '🔕 Silenciar 1 hora', click: () => M.setMute(60) },
          { type: 'separator' },
          ...(M.presenting ? [
            { label: `🙈 Escondido: ${M.presenting.reason}`, enabled: false },
            { label: '👀 Mostrarme igualmente', click: () => { forceShowPet(); } },
            ...(M.presenting.app && M.presenting.reason !== 'Compartiendo pantalla en Teams'
              ? [{ label: `🚫 No esconderme con ${M.presenting.app}`, click: () => { const l = M.store.data.settings.noHideApps || (M.store.data.settings.noHideApps = []); if (!l.includes(M.presenting.app)) l.push(M.presenting.app); M.store.save(); forceShowPet(); } }]
              : []),
            { type: 'separator' },
          ] : []),
          {
            label: 'Mostrar pollito',
            type: 'checkbox',
            checked: !!(M.petWin && M.petWin.isVisible()),
            click: (i) => { if (M.petWin) (i.checked ? M.petWin.show() : M.petWin.hide()); },
          },
          { label: 'Traer a la esquina', click: resetPosition },
          {
            label: 'Iniciar con Windows',
            type: 'checkbox',
            checked: M.app.getLoginItemSettings().openAtLogin,
            click: (i) => setAutoStart(i.checked),
          },
          { type: 'separator' },
          { label: '⚙️ Ajustes…', click: () => M.openSettings() },
          { label: 'ℹ️ Acerca de PM Pollito…', click: M.openAbout },
          { type: 'separator' },
          { label: 'Salir', click: () => M.confirmQuit('bandeja') },
        ]))
      );
    };
    refresh();
    M.tray.on('click', () => M.openPanel('chat'));
    M.tray.refreshMenu = refresh;
  }

  function resetPosition() {
    if (!M.petWin) return;
    const wa = M.screen.getPrimaryDisplay().workArea;
    const x = wa.x + wa.width - M.PET_W - 30, y = wa.y + wa.height - M.PET_H - 10;
    M.petWin.setPosition(x, y);
    M.petWin.show();
    M.store.data.position = { x, y };
    M.store.save();
    M.placePanel();
  }

  function setAutoStart(on) {
    if (M.TEST) return; // los tests nunca tocan el inicio de Windows
    const opts = { openAtLogin: !!on };
    if (!M.app.isPackaged) {
      opts.path = process.execPath;
      opts.args = [M.app.getAppPath()];
    }
    M.app.setLoginItemSettings(opts);
    M.store.data.settings.autoStart = !!on;
    M.store.save();
    if (M.tray) M.tray.refreshMenu();
    M.broadcast();
  }

  return {
    trayIcon,
    get trayBase() { return trayBase; },
    set trayBase(v) { trayBase = v; },
    get lastTrayKey() { return lastTrayKey; },
    set lastTrayKey(v) { lastTrayKey = v; },
    hexRgb,
    trayIconWith,
    updateTrayIcon,
    forceShowPet,
    get presentSnoozeUntil() { return presentSnoozeUntil; },
    set presentSnoozeUntil(v) { presentSnoozeUntil = v; },
    buildTray,
    resetPosition,
    setAutoStart,
  };
};

// Apariencia, modo discreto, ventanas auxiliares, datos y captura rápida.
// Parte del proceso principal (antes en main.js). `M` es el contexto compartido de la app:
// da acceso a todo lo demás (ventanas, datos, funciones de otros módulos).
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  // ---------- apariencia ----------
  function isDark() {
    const t = M.store.data.settings.theme || 'system';
    return t === 'dark' || t === 'contrast' || (t === 'system' && (M.nativeTheme.shouldUseDarkColors || M.nativeTheme.shouldUseHighContrastColors));
  }

  const SIZE_FACTOR = { s: 0.8, m: 1, l: 1.25 };
  function petFactor() {
    return SIZE_FACTOR[M.store.data.settings.petSize] || 1;
  }
  function setPetSize(size) {
    M.store.data.settings.petSize = SIZE_FACTOR[size] ? size : 'm';
    M.store.save();
    applyPetSize();
    M.broadcast();
  }
  function applyPetSize() {
    if (!M.petWin) return;
    const f = petFactor();
    const b = M.petWin.getBounds();
    const w = Math.round(M.PET_W * f), h = Math.round(M.PET_H * f);
    M.petWin.webContents.setZoomFactor(f);
    // Mantiene el pollito anclado por abajo y centrado.
    M.petWin.setBounds({ x: Math.round(b.x + (b.width - w) / 2), y: b.y + b.height - h, width: w, height: h });
    if (M.store.data.settings.discreet) dockPet(false);
    placePanel();
  }

  // ---------- modo discreto: se esconde en el borde y se asoma ----------
  let dockTimer = null;
  let slideTimer = null;
  function slidePetTo(x) {
    if (!M.petWin) return;
    clearInterval(slideTimer);
    const start = M.petWin.getPosition()[0];
    const y = M.petWin.getPosition()[1];
    let i = 0;
    const steps = 12;
    slideTimer = setInterval(() => {
      i++;
      const t = i / steps;
      const e = 1 - Math.pow(1 - t, 3);
      M.petWin.setPosition(Math.round(start + (x - start) * e), y);
      if (i >= steps) clearInterval(slideTimer);
    }, 14);
  }
  function dockPositions() {
    const b = M.petWin.getBounds();
    const wa = M.screen.getDisplayMatching(b).workArea;
    const f = b.width / M.PET_W;
    const side = M.store.data.settings.dockSide || ((b.x + b.width / 2) > wa.x + wa.width / 2 ? 'right' : 'left');
    if (side === 'right') return { side, hidden: wa.x + wa.width - Math.round(120 * f), peek: wa.x + wa.width - Math.round(205 * f) };
    return { side, hidden: wa.x - Math.round(120 * f), peek: wa.x - Math.round(35 * f) };
  }
  function dockPet(peek) {
    if (!M.petWin || !M.store.data.settings.discreet || M.drag) return;
    const p = dockPositions();
    slidePetTo(peek ? p.peek : p.hidden);
    M.sendPet('pet:dock', { side: p.side, peek });
  }
  function peekPet(ms = 6000) {
    if (!M.store.data.settings.discreet) return;
    dockPet(true);
    clearTimeout(dockTimer);
    dockTimer = setTimeout(() => dockPet(false), ms);
  }
  function setDiscreet(on) {
    M.store.data.settings.discreet = !!on;
    if (on) {
      const b = M.petWin.getBounds();
      const wa = M.screen.getDisplayMatching(b).workArea;
      M.store.data.settings.dockSide = (b.x + b.width / 2) > wa.x + wa.width / 2 ? 'right' : 'left';
      dockPet(false);
      M.say('🫣 Modo discreto: me escondo en el borde y me asomo cuando tenga algo que decirte.', 'peck', 6000, { log: false });
    } else {
      const p = dockPositions();
      slidePetTo(p.side === 'right' ? p.peek - 20 : p.peek + 20);
      M.sendPet('pet:dock', null);
    }
    M.store.save();
    M.broadcast();
  }

  // ---------- ventanas nuevas: ajustes, paleta de comandos y "acerca de" ----------
  function baseWinOpts(extra) {
    return {
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      backgroundColor: '#00000000',
      webPreferences: { preload: M.path.join(M.APP_DIR, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
      ...extra,
    };
  }

  function openSettings(section) {
    if (M.panelWin) M.panelWin.hide();
    if (!M.settingsWin || M.settingsWin.isDestroyed()) {
      const d = M.screen.getDisplayNearestPoint(M.screen.getCursorScreenPoint()).workArea;
      M.settingsWin = new M.BrowserWindow(baseWinOpts({
        width: 760, height: 600, skipTaskbar: false, title: 'PM · Ajustes',
        x: Math.round(d.x + (d.width - 760) / 2), y: Math.round(d.y + (d.height - 600) / 2),
        icon: M.path.join(M.APP_DIR, 'build', 'icon.png'),
      }));
      M.settingsWin.setAlwaysOnTop(true, 'floating');
      M.settingsWin.loadFile(M.path.join(M.APP_DIR, 'renderer', 'settings.html'), { query: section ? { section } : {} });
      M.settingsWin.once('ready-to-show', () => { M.settingsWin.show(); M.settingsWin.focus(); });
      M.settingsWin.on('closed', () => (M.settingsWin = null));
    } else {
      M.settingsWin.show();
      M.settingsWin.focus();
      if (section) M.settingsWin.webContents.send('settings:section', section);
    }
  }

  // Menos memoria: las ventanas auxiliares ocultas se destruyen tras un rato sin usarse
  // (se vuelven a crear al abrirlas; tarda una fracción de segundo).
  function autoDispose(win, ms) {
    let t = null;
    win.on('hide', () => { clearTimeout(t); t = setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) win.destroy(); }, ms); });
    win.on('show', () => clearTimeout(t));
    win.on('closed', () => clearTimeout(t));
  }

  function openPalette() {
    if (!M.paletteWin || M.paletteWin.isDestroyed()) {
      M.paletteWin = new M.BrowserWindow(baseWinOpts({ width: 580, height: 440, alwaysOnTop: true }));
      autoDispose(M.paletteWin, 5 * 60e3);
      M.paletteWin.setAlwaysOnTop(true, 'screen-saver', 3);
      M.paletteWin.loadFile(M.path.join(M.APP_DIR, 'renderer', 'palette.html'));
      M.paletteWin.on('blur', () => { if (M.paletteWin && !M.paletteWin.isDestroyed()) M.paletteWin.hide(); });
      M.paletteWin.on('closed', () => (M.paletteWin = null));
    }
    const d = M.screen.getDisplayNearestPoint(M.screen.getCursorScreenPoint()).workArea;
    M.paletteWin.setPosition(Math.round(d.x + (d.width - 580) / 2), Math.round(d.y + d.height * 0.2));
    M.paletteWin.show();
    M.paletteWin.focus();
    M.paletteWin.webContents.send('palette:open', M.paletteCommands());
    M.store.data.flags = { ...(M.store.data.flags || {}), usedPalette: true };
    M.store.save();
  }

  function openAbout() {
    if (!M.aboutWin || M.aboutWin.isDestroyed()) {
      const d = M.screen.getDisplayNearestPoint(M.screen.getCursorScreenPoint()).workArea;
      M.aboutWin = new M.BrowserWindow(baseWinOpts({
        width: 380, height: 530, alwaysOnTop: true, title: 'Acerca de PM Pollito',
        x: Math.round(d.x + (d.width - 380) / 2), y: Math.round(d.y + (d.height - 530) / 2),
      }));
      M.aboutWin.setAlwaysOnTop(true, 'screen-saver', 2);
      M.aboutWin.loadFile(M.path.join(M.APP_DIR, 'renderer', 'about.html'));
      M.aboutWin.once('ready-to-show', () => { M.aboutWin.show(); M.aboutWin.focus(); });
      M.aboutWin.on('closed', () => (M.aboutWin = null));
    } else {
      M.aboutWin.show();
      M.aboutWin.focus();
    }
  }

  // ---------- copia de seguridad y privacidad ----------
  // Contraseña de las copias (guardada cifrada con el sistema).
  function backupPassword() {
    return M.store.data.settings.backupPass ? M.decrypt(M.store.data.settings.backupPass) || '' : '';
  }
  async function exportData() {
    const parent = M.settingsWin && !M.settingsWin.isDestroyed() ? M.settingsWin : undefined;
    const r = await M.dialog.showSaveDialog(parent, {
      title: 'Exportar la memoria del pollito',
      defaultPath: M.path.join(M.app.getPath('documents'), `pm-pollito-backup-${M.dayKey()}.json`),
      filters: [{ name: 'Copia de PM', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return null;
    // Los secretos cifrados solo sirven en este PC: no se exportan. Con contraseña, la copia va cifrada.
    M.fs.writeFileSync(r.filePath, JSON.stringify(require('../backup').envelope(M.store.data, M.app.getVersion(), backupPassword()), null, 2));
    M.shell.showItemInFolder(r.filePath);
    return r.filePath;
  }

  async function importData() {
    const parent = M.settingsWin && !M.settingsWin.isDestroyed() ? M.settingsWin : undefined;
    const r = await M.dialog.showOpenDialog(parent, { title: 'Importar copia de PM', filters: [{ name: 'Copia de PM', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    let parsed;
    try { parsed = JSON.parse(M.fs.readFileSync(r.filePaths[0], 'utf8')); } catch { return { ok: false, error: 'El archivo no es una copia válida.' }; }
    try {
      parsed = { ...parsed, data: require('../backup').open(parsed, backupPassword()) };
    } catch (e) {
      if (e.message === 'PASSWORD') return { ok: false, error: 'Esta copia está cifrada: escribe su contraseña en "Contraseña de las copias" y vuelve a importar.' };
      return { ok: false, error: 'El archivo no es una copia de PM Pollito.' };
    }
    if (!parsed.data || !parsed.data.pet) return { ok: false, error: 'El archivo no es una copia de PM Pollito.' };
    const ok = await M.dialog.showMessageBox(parent, {
      type: 'warning', buttons: ['Cancelar', 'Sí, reemplazar'], defaultId: 0, cancelId: 0,
      message: `¿Reemplazar la memoria actual por la de "${parsed.data.pet.name || 'PM'}"?`,
      detail: 'Se guardará una copia de la memoria actual por si acaso. Tus claves (IA, GitHub, correo) se conservan.',
    });
    if (ok.response !== 1) return { ok: false };
    M.fs.copyFileSync(M.store.file, M.store.file.replace(/\.json$/, `.antes-de-importar-${Date.now()}.json`));
    const keep = {};
    for (const k of ['manualToken', 'aiKey', 'githubToken', 'calendarUrl', 'mail', 'accounts']) keep[k] = M.store.data.settings[k];
    M.store.data = parsed.data;
    M.store.data.settings = { ...M.store.data.settings, ...keep };
    M.store.data.life = { ...(M.store.data.life || {}), running: false, lastQuitHow: 'update', lastQuitAt: Date.now() };
    M.store.flush();
    M.quitHow = 'update';
    M.app.relaunch();
    M.app.quit();
    return { ok: true };
  }

  async function deleteAllData() {
    const parent = M.settingsWin && !M.settingsWin.isDestroyed() ? M.settingsWin : undefined;
    const r = await M.dialog.showMessageBox(parent, {
      type: 'warning', buttons: ['Cancelar', 'Borrar todo'], defaultId: 0, cancelId: 0,
      message: '¿Borrar TODOS tus datos de PM?',
      detail: 'Se borran el pollito, sus recuerdos, tareas, estadísticas, claves y conexiones de este PC. No se puede deshacer (exporta una copia antes si quieres).',
    });
    if (r.response !== 1) return false;
    try { await M.claudeWeb.logout(); } catch { /* sin sesión */ }
    M.store.save = () => {};
    M.store.flush = () => {};
    for (const f of [M.store.file, M.store.bak]) { try { M.fs.unlinkSync(f); } catch { /* no existe */ } }
    M.quitHow = 'update';
    M.app.relaunch();
    M.app.exit(0);
    return true;
  }

  // ---------- captura rápida (Ctrl+Alt+P desde cualquier app) ----------
  function openCapture() {
    if (!M.captureWin || M.captureWin.isDestroyed()) {
      M.captureWin = new M.BrowserWindow({
        width: 520,
        height: 150,
        show: false,
        frame: false,
        transparent: true,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        backgroundColor: '#00000000',
        webPreferences: { preload: M.path.join(M.APP_DIR, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
      });
      M.captureWin.setAlwaysOnTop(true, 'screen-saver', 3);
      M.captureWin.loadFile(M.path.join(M.APP_DIR, 'renderer', 'capture.html'));
      M.captureWin.on('blur', () => { if (M.captureWin && !M.captureWin.isDestroyed()) M.captureWin.hide(); });
      M.captureWin.on('closed', () => (M.captureWin = null));
      autoDispose(M.captureWin, 5 * 60e3);
    }
    const d = M.screen.getDisplayNearestPoint(M.screen.getCursorScreenPoint()).workArea;
    M.captureWin.setPosition(Math.round(d.x + (d.width - 520) / 2), Math.round(d.y + d.height * 0.28));
    M.captureWin.show();
    M.captureWin.focus();
    M.captureWin.webContents.send('capture:open');
    M.animate('peck');
  }

  function placePanel() {
    if (!M.panelWin || !M.petWin) return;
    const pb = M.petWin.getBounds();
    const wa = M.screen.getDisplayMatching(pb).workArea;
    const f = pb.width / M.PET_W;
    const chickLeft = pb.x + 50 * f;
    const chickRight = pb.x + pb.width - 50 * f;
    let x = chickRight + M.PANEL_W + 8 <= wa.x + wa.width ? chickRight + 8 : chickLeft - M.PANEL_W - 8;
    x = M.clamp(x, wa.x, wa.x + wa.width - M.PANEL_W);
    let y = pb.y + pb.height - M.PANEL_H;
    y = M.clamp(y, wa.y, wa.y + wa.height - M.PANEL_H);
    M.panelWin.setBounds({ x: Math.round(x), y: Math.round(y), width: M.PANEL_W, height: M.PANEL_H });
  }

  function openPanel(view) {
    const fresh = !M.panelWin || M.panelWin.isDestroyed();
    if (fresh) M.createPanel();
    placePanel();
    if (view) M.panelSend('panel:view', view);
    const reveal = () => { if (M.panelWin && !M.panelWin.isDestroyed()) { M.panelWin.show(); M.panelWin.focus(); } };
    if (fresh) M.panelWin.once('ready-to-show', reveal); else reveal();
  }

  function togglePanel() {
    if (!M.panelWin || M.panelWin.isDestroyed()) return openPanel();
    if (M.panelWin.isVisible()) M.panelWin.hide();
    else openPanel();
  }

  return {
    isDark,
    SIZE_FACTOR,
    petFactor,
    setPetSize,
    applyPetSize,
    get dockTimer() { return dockTimer; },
    set dockTimer(v) { dockTimer = v; },
    get slideTimer() { return slideTimer; },
    set slideTimer(v) { slideTimer = v; },
    slidePetTo,
    dockPositions,
    dockPet,
    peekPet,
    setDiscreet,
    baseWinOpts,
    openSettings,
    autoDispose,
    openPalette,
    openAbout,
    backupPassword,
    exportData,
    importData,
    deleteAllData,
    openCapture,
    placePanel,
    openPanel,
    togglePanel,
  };
};

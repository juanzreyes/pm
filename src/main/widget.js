// Widget de escritorio: una tarjeta pequeña con tus límites de Claude, tu día, la próxima reunión
// y el pomodoro. Vive en el escritorio (no siempre encima) y recuerda dónde la dejaste.
// Es la alternativa al panel de widgets de Windows 11, que solo admite proveedores nativos
// empaquetados en MSIX (no aplicaciones Electron).
// Parte del proceso principal. `M` es el contexto compartido de la app.
module.exports = function install(M) {
  const W = 300;
  const H = 196;
  const set = () => M.store.data.settings;

  function place() {
    const p = set().widgetPos;
    const d = M.screen.getPrimaryDisplay().workArea;
    const visible = p && M.screen.getAllDisplays().some((s) => p.x >= s.workArea.x - W / 2 && p.x < s.workArea.x + s.workArea.width - W / 2 && p.y >= s.workArea.y && p.y < s.workArea.y + s.workArea.height - 40);
    return visible ? p : { x: d.x + d.width - W - 24, y: d.y + 24 };
  }
  function open() {
    if (M.widgetWin && !M.widgetWin.isDestroyed()) { M.widgetWin.showInactive(); return; }
    const pos = place();
    M.widgetWin = new M.BrowserWindow({
      ...M.baseWinOpts({ width: W, height: H, x: pos.x, y: pos.y, alwaysOnTop: false, focusable: true, title: 'PM Pollito · Widget' }),
      minimizable: false, maximizable: false,
    });
    M.widgetWin.loadFile(M.path.join(M.APP_DIR, 'renderer', 'widget.html'));
    M.widgetWin.once('ready-to-show', () => M.widgetWin && M.widgetWin.showInactive());
    let t = null;
    M.widgetWin.on('moved', () => {
      clearTimeout(t);
      t = setTimeout(() => { if (!M.widgetWin || M.widgetWin.isDestroyed()) return; const [x, y] = M.widgetWin.getPosition(); set().widgetPos = { x, y }; M.store.save(); }, 400);
    });
    M.widgetWin.on('closed', () => (M.widgetWin = null));
  }
  function close() {
    if (M.widgetWin && !M.widgetWin.isDestroyed()) M.widgetWin.close();
    M.widgetWin = null;
  }
  function toggle(on = !set().desktopWidget) {
    set().desktopWidget = !!on;
    M.store.save();
    if (on) open(); else close();
    M.broadcast();
    return !!on;
  }
  function start() {
    if (set().desktopWidget) open();
  }
  return { open, close, toggle, start };
};

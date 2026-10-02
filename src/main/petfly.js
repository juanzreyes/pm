// Vuelo del pollito cuando lo lanzas (src/petphysics.js): mueve su ventana a 60 fps, rebota en los
// bordes y cae a la barra de tareas; el pollito se aplasta en cada golpe. Soltarlo despacio no
// cambia nada: se queda donde lo dejas. Parte del proceso principal. `M` es el contexto compartido.
module.exports = function install(M) {
  const phys = require('../petphysics');
  let samples = [];
  let timer = null;

  /** Durante el arrastre: guarda las últimas posiciones de la ventana. */
  function track(x, y) {
    const t = Date.now();
    samples.push({ t, x, y });
    if (samples.length > 12) samples.shift();
  }
  const flying = () => !!timer;

  /** Al soltar: ¿lo lanzaste? Entonces vuela. Devuelve true si empieza el vuelo. */
  function release() {
    const v = phys.velocityFrom(samples, Date.now());
    samples = [];
    const s = M.store.data.settings;
    if (!M.petWin || M.petWin.isDestroyed() || !phys.isThrow(v) || !Number.isFinite(v.vx + v.vy) || s.reducedMotion || s.discreet || s.petPhysics === false) return false;
    const [x, y] = M.petWin.getPosition();
    const [w, h] = M.petWin.getSize();
    const b = phys.boundsFor(M.screen.getDisplayNearestPoint({ x: Math.round(x + w / 2), y: Math.round(y + h / 2) }).workArea, w, h);
    let st = { x, y, vx: v.vx, vy: v.vy };
    let last = Date.now();
    const t0 = last;
    clearInterval(timer);
    M.sendPet('pet:fly', { on: true, vx: v.vx });
    timer = setInterval(() => {
      if (!M.petWin || M.petWin.isDestroyed()) return stop();
      const now = Date.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const r = phys.step(st, dt, b);
      st = r.s;
      if (![st.x, st.y, st.vx, st.vy].every(Number.isFinite)) return stop(true);
      try {
        M.petWin.setPosition(Math.round(st.x), Math.round(st.y));
      } catch (e) {
        M.diag.log('info', 'Vuelo del pollito: ' + e.message);
        return stop(true);
      }
      if (M.panelWin && M.panelWin.isVisible()) M.placePanel();
      for (const hit of r.hits) M.sendPet('pet:impact', hit);
      if (r.rest || now - t0 > 5000) stop(true);
    }, 16);
    return true;
  }
  function stop(landed = false) {
    clearInterval(timer);
    timer = null;
    if (!M.petWin || M.petWin.isDestroyed()) return;
    const [x, y] = M.petWin.getPosition();
    M.store.data.position = { x, y };
    M.store.save();
    M.sendPet('pet:fly', { on: false, landed });
  }
  return { track, release, flying, stop };
};

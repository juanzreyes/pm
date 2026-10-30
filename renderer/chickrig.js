// ChickRig: el motor de animación propio del pollito.
//
// Por qué existe: la ventana del pollito es transparente y está siempre encima. Cada cuadro que
// cambia algo obliga a rasterizar y componer la ventana entera; con ~15 animaciones CSS infinitas
// (respirar, alas, copete, sombra, amiguito…) eso eran 60 cuadros por segundo todo el día:
// ~16% de un núcleo solo para que el pollito "esté quieto".
//
// Qué hace:
//  · Gobernador de cuadros: las animaciones INFINITAS de reposo no corren solas a 60 fps; se pausan
//    y el motor las avanza a mano a pocos cuadros por segundo (mismas curvas y keyframes, nada se
//    reescribe). Las animaciones de acción (saltar, bailar, caminar, arrastrar, acariciar…) y
//    cuando tienes el ratón encima corren a fluidez completa.
//  · Seguidores: lo que antes se medía en cada cuadro (la colita de la burbuja, el globo de
//    "pensando") se recalcula solo cuando el pollito se mueve.
//  · Movimiento secundario: ojos que siguen al cursor con un resorte, microsacadas y respiración
//    con pausas, todo dentro del mismo latido (sin bucles propios).
(function () {
  const body = document.body;
  // Fluidez en reposo según el ajuste (cuadros por segundo). 'max' = sin gobernador.
  const PRESETS = { eco: 8, balanced: 10, smooth: 24, max: 0 };
  const ACTING_FPS = 20;
  const NEAR_FPS = 20; // el cursor anda cerca: lo estás viendo, más fluido (pero sin llegar a 60)
  // Interacción de verdad (lo estás tocando, camina, baila…): todo a fluidez completa.
  const ACTIVE = /(^|\s)(walking|music|dragged|flying|petting|breathing|visiting|visit-leaving)(\s|$)/;
  // Un gesto (a-hop, a-look…): fluido si lo estás viendo (cursor cerca); si no, a ACTING_FPS.
  const ACTING = /(^|\s)a-[\w-]+/;
  // Dormido, de vacaciones o con la PC sin usar: casi nada se mueve, basta con muy pocos cuadros.
  const DROWSY = /(^|\s)(napping|asleep|on-vacation|user-away)(\s|$)/;

  let preset = 'balanced';
  let mode = 'idle'; // 'idle' | 'near' | 'acting' | 'active' | 'drowsy' | 'max'
  let nearUntil = 0;
  let timer = 0;
  let boostUntil = 0;
  let ticks = 0;
  const followers = new Map(); // nombre → fn
  const reduced = () => body.classList.contains('reduced');
  const now = () => document.timeline.currentTime || performance.now();

  function fps() {
    if (mode === 'max' || mode === 'active') return 0; // nativo
    if (mode === 'acting') return Date.now() < nearUntil ? 0 : ACTING_FPS;
    if (mode === 'drowsy') return 4;
    if (mode === 'near') return Math.max(NEAR_FPS, PRESETS[preset] || 0);
    return PRESETS[preset] || PRESETS.balanced;
  }

  function computeMode() {
    if (!PRESETS[preset] && preset === 'max') return 'max';
    const cls = body.className;
    if (Date.now() < boostUntil || ACTIVE.test(cls)) return 'active';
    // Si no estás mirando, ni los gestos van a 60 fps (antes cada gesto soltaba todo).
    if (DROWSY.test(cls)) return 'drowsy';
    if (ACTING.test(cls)) return 'acting';
    if (Date.now() < nearUntil) return 'near';
    return 'idle';
  }

  /** Infinita = de reposo (las de acción tienen un número de vueltas). */
  const idleCache = new WeakMap();
  function isIdleAnim(a) {
    let v = idleCache.get(a);
    if (v === undefined) {
      const t = a.effect && a.effect.getTiming && a.effect.getTiming();
      v = !!t && t.iterations === Infinity;
      idleCache.set(a, v);
    }
    return v;
  }

  /** Avanza (o suelta) las animaciones gobernadas. */
  function step() {
    ticks++;
    const governed = mode === 'idle' || mode === 'near' || mode === 'drowsy' || (mode === 'acting' && fps() > 0);
    const t = now();
    for (const a of document.getAnimations()) {
      // Lo que no se ve (dentro de un grupo oculto: en SVG, display:none en el padre NO detiene
      // las animaciones de los hijos) queda pausado y no se toca: moverlo es trabajo para nada.
      const target = a.effect && a.effect.target;
      if (target && target.checkVisibility && !target.checkVisibility()) {
        if (a.playState === 'running') { a.__rigStart = t - (a.currentTime || 0); a.pause(); }
        continue;
      }
      // En reposo, solo las infinitas; adormilado, también los gestos (animaciones CSS finitas).
      const mine = isIdleAnim(a) || ((mode === 'drowsy' || mode === 'acting') && typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation);
      if (!mine && a.__rigStart === undefined) continue;
      if (governed && mine) {
        if (a.playState === 'running') { a.__rigStart = t - (a.currentTime || 0); a.pause(); }
        if (a.__rigStart === undefined) a.__rigStart = t - (a.currentTime || 0);
        a.currentTime = t - a.__rigStart;
      } else if (a.__rigStart !== undefined) {
        a.currentTime = t - a.__rigStart;
        delete a.__rigStart;
        a.play();
      }
    }
    if (isMoving()) runFollowers();
  }

  const isMoving = () => /(^|\s)(walking|dragged|flying|visiting)(\s|$)/.test(body.className);
  function runFollowers() { center = null; for (const fn of followers.values()) { try { fn(); } catch { /* el siguiente cuadro lo reintenta */ } } }

  function schedule() {
    clearTimeout(timer);
    if (document.hidden) return; // Chromium ya lo congela; al volver se reanuda
    const f = fps();
    // A fluidez completa basta con revisar de vez en cuando si ya se calmó (y mover seguidores).
    const ms = f ? 1000 / f : eyesBusy() || isMoving() ? 33 : 400;
    timer = setTimeout(() => { setMode(computeMode()); step(); eyesTick(); schedule(); }, ms);
  }

  function setMode(m) {
    if (m === mode) return;
    mode = m;
    step(); // suelta o pausa en el acto, sin esperar al siguiente latido
  }

  // Al cambiar de estado (empieza una acción, se va a dormir…) reacciona en el momento.
  new MutationObserver(() => {
    const m = computeMode();
    if (m !== mode) { setMode(m); schedule(); }
  }).observe(body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', schedule);

  // =============== ojos que te siguen (resorte) ===============
  // El proceso principal manda dónde está el cursor (en toda la pantalla). Aquí solo se fija hacia
  // dónde mirar; los ojos llegan con un resorte dentro del latido gobernado. Antes cada movimiento
  // del ratón creaba una transición CSS nueva: usar el PC = el pollito a 60 fps todo el día.
  // Cerca del pollito, fluidez completa; lejos, con los cuadros de reposo basta.
  const eyes = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, last: 0, nextSaccade: 0 };
  let eyesEl = null;
  let lastLook = 0;
  let center = null;
  let centerAt = 0;
  const tracking = () => Date.now() - lastLook < 3000;
  function lookAt(x, y) {
    if (!center || Date.now() - centerAt > 1500) {
      const chick = document.getElementById('chick');
      if (!chick) return;
      const r = chick.getBoundingClientRect();
      center = { x: r.left + r.width / 2, y: r.top + r.height * 0.5 };
      centerAt = Date.now();
    }
    const dx = x - center.x;
    const dy = y - center.y;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, d / 90);
    const flip = body.classList.contains('left') ? -1 : 1;
    eyes.tx = (dx / d) * 2.8 * k * flip;
    eyes.ty = (dy / d) * 2 * k;
    lastLook = Date.now();
    if (d < 170) {
      nearUntil = Date.now() + 1200;
      if (mode === 'idle' || mode === 'acting') { const m = computeMode(); mode = ''; setMode(m); schedule(); }
    }
  }

  function eyesTick() {
    if (!eyesEl) eyesEl = document.getElementById('pupils');
    if (!eyesEl || reduced()) return;
    const t = performance.now();
    const dt = Math.min(0.2, (t - (eyes.last || t)) / 1000) || 0.016;
    eyes.last = t;
    const n = Math.max(1, Math.ceil(dt / 0.016));
    if (!tracking() && t > eyes.nextSaccade) {
      eyes.nextSaccade = t + 1800 + Math.random() * 4200;
      const far = Math.random() < 0.25;
      eyes.tx = far ? (Math.random() - 0.5) * 4.4 : (Math.random() - 0.5) * 1.2;
      eyes.ty = far ? (Math.random() - 0.4) * 2.4 : (Math.random() - 0.5) * 0.8;
    }
    // Resorte críticamente amortiguado: llega rápido y sin rebotar raro.
    const k = 140;
    const c = 2 * Math.sqrt(k) * 0.9;
    for (let i = 0; i < n; i++) {
      const h = dt / n;
      eyes.vx += (k * (eyes.tx - eyes.x) - c * eyes.vx) * h;
      eyes.vy += (k * (eyes.ty - eyes.y) - c * eyes.vy) * h;
      eyes.x += eyes.vx * h;
      eyes.y += eyes.vy * h;
    }
    const s = `translate(${eyes.x.toFixed(2)} ${eyes.y.toFixed(2)})`;
    if (eyesEl.getAttribute('transform') !== s) eyesEl.setAttribute('transform', s);
  }

  const eyesBusy = () => Math.abs(eyes.tx - eyes.x) + Math.abs(eyes.ty - eyes.y) + Math.abs(eyes.vx) + Math.abs(eyes.vy) > 0.05;

  // =============== API ===============
  /** Fluidez completa durante `ms` (al tocarlo, al hablar, al llegar algo nuevo). */
  function boost(ms = 2500) {
    boostUntil = Math.max(boostUntil, Date.now() + ms);
    if (mode !== 'active' && mode !== 'max') { setMode('active'); schedule(); }
  }
  function setPreset(p) {
    const next = Object.prototype.hasOwnProperty.call(PRESETS, p) ? p : 'balanced';
    if (next === preset) return;
    preset = next;
    setMode(computeMode());
    schedule();
  }
  /** Recalcula `fn` ahora y cada vez que el pollito se mueva (hasta quitarlo con unfollow). */
  function follow(name, fn) { followers.set(name, fn); try { fn(); } catch { /* sin DOM aún */ } }
  function unfollow(name) { followers.delete(name); }
  // Al terminar un paseo o un arrastre, una última pasada con la posición final.
  document.addEventListener('transitionend', (e) => { if (e.target && e.target.id === 'walker') runFollowers(); });

  window.ChickRig = {
    boost, setPreset, follow, unfollow, refresh: runFollowers, lookAt,
    stats: () => ({ mode, fps: fps(), preset, ticks, followers: [...followers.keys()] }),
  };
  schedule();
}());

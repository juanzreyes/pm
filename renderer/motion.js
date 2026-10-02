// Movimiento compartido de las ventanas (panel y ajustes): números que cuentan, barras que crecen
// desde su valor anterior, salida animada de las ventanas internas (.overlay) y esqueletos de carga.
// Todo respeta "reducir movimiento" (html.reduced o la preferencia de Windows).
(function (root) {
  const reduced = () => document.documentElement.classList.contains('reduced') || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  /** Cuenta desde el valor anterior hasta `to` (ms: duración). fmt(n) da el texto. */
  function countTo(el, to, fmt = (n) => String(n), ms = 520) {
    if (!el) return;
    const from = typeof el._num === 'number' ? el._num : to;
    el._num = to;
    cancelAnimationFrame(el._raf);
    if (from === to || reduced()) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      el.textContent = fmt(Math.round(from + (to - from) * easeOut(k)));
      if (k < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }

  // Valores anteriores por clave: el HTML se regenera en cada repintado, así no se pierden.
  const prev = new Map();
  /**
   * Tras pintar con innerHTML: [data-num][data-key] cuenta desde su valor anterior y
   * [data-bar][data-key] (una barra) crece desde su ancho anterior.
   */
  function afterRender(rootEl = document) {
    for (const el of rootEl.querySelectorAll('[data-num][data-key]')) {
      const to = Number(el.dataset.num);
      const k = el.dataset.key;
      if (prev.has(k)) el._num = prev.get(k);
      const suffix = el.dataset.suffix || '';
      countTo(el, to, (n) => n + suffix);
      prev.set(k, to);
    }
    for (const el of rootEl.querySelectorAll('[data-bar][data-key]')) {
      const to = Math.min(100, Number(el.dataset.bar));
      const k = el.dataset.key;
      if (prev.has(k) && prev.get(k) !== to && !reduced()) {
        el.style.width = prev.get(k) + '%';
        void el.offsetWidth; // fija el ancho viejo antes de animar al nuevo
      }
      el.style.width = to + '%';
      prev.set(k, to);
    }
  }

  /** Esqueleto de carga: n líneas que brillan (en vez de "Cargando…"). */
  function skeleton(n = 3, label = 'Cargando') {
    const w = [92, 78, 85, 64, 70];
    return `<div class="skeleton" role="status" aria-label="${label}">${Array.from({ length: n }, (_, i) => `<span style="width:${w[i % w.length]}%"></span>`).join('')}</div>`;
  }

  // Ventanas internas: al ocultarse (class "hidden"), primero se van con una animación corta.
  const LEAVE_MS = 170;
  function watchOverlays(sel = '.overlay') {
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        const el = m.target;
        if (/\bleaving\b/.test(m.oldValue || '')) continue; // es el final de nuestra propia salida
        const was = /\bhidden\b/.test(m.oldValue || '');
        if (!was && el.classList.contains('hidden') && !el._leaving && !reduced()) {
          el._leaving = true;
          el.classList.remove('hidden');
          el.classList.add('leaving');
          // Termina al acabar la animación (o, por si no corre, a los 400 ms).
          const done = () => {
            if (!el._leaving) return;
            el._leaving = false;
            el.removeEventListener('animationend', onEnd);
            el.classList.add('hidden');
            el.classList.remove('leaving');
          };
          const onEnd = (e) => { if (e.target === el) done(); };
          el.addEventListener('animationend', onEnd);
          setTimeout(done, LEAVE_MS + 230);
        }
      }
    });
    for (const el of document.querySelectorAll(sel)) mo.observe(el, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  }

  root.MOTION = { countTo, afterRender, skeleton, watchOverlays, reduced };
})(typeof window !== 'undefined' ? window : globalThis);

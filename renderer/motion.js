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

  // ---------- Listas vivas ----------
  /**
   * Pinta una lista sin rehacerla entera: reutiliza las filas que no cambiaron y anima las que
   * entran, salen o cambian de sitio (FLIP). items: [{ key, html }] (html de UNA fila).
   */
  function keyedList(container, items, { emptyHtml = '' } = {}) {
    const first = !container._keyed;
    container._keyed = true;
    const old = new Map();
    const rects = new Map();
    for (const el of [...container.children]) {
      if (el.dataset.key == null) { el.remove(); continue; }
      old.set(el.dataset.key, el);
      rects.set(el.dataset.key, el.getBoundingClientRect());
    }
    const anim = !first && !reduced();
    const cRect = container.getBoundingClientRect();
    // Las que se van: un "fantasma" en su sitio que se desvanece.
    const keep = new Set(items.map((i) => i.key));
    for (const [k, el] of old) {
      if (keep.has(k)) continue;
      if (anim) {
        const r = rects.get(k);
        const g = el.cloneNode(true);
        g.removeAttribute('data-key');
        g.classList.add('ghost-out');
        Object.assign(g.style, { position: 'absolute', left: (r.left - cRect.left) + 'px', top: (r.top - cRect.top + container.scrollTop) + 'px', width: r.width + 'px', margin: 0, pointerEvents: 'none' });
        container.style.position = container.style.position || 'relative';
        container.append(g);
        const a = g.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(18px) scale(.97)' }], { duration: 220, easing: 'cubic-bezier(.4,0,1,1)' });
        const kill = () => g.remove();
        a.onfinish = kill;
        setTimeout(kill, 500);
      }
      el.remove();
    }
    if (!items.length) { container.innerHTML = emptyHtml; container._keyed = false; return; }
    const tpl = document.createElement('template');
    let prevEl = null;
    for (const it of items) {
      let el = old.get(it.key);
      if (!el || el.dataset.h !== it.html) {
        tpl.innerHTML = it.html.trim();
        const fresh = tpl.content.firstElementChild;
        fresh.dataset.key = it.key;
        fresh.dataset.h = it.html;
        if (el) el.replaceWith(fresh);
        else if (anim) fresh.classList.add('enter');
        el = fresh;
      }
      // Orden: cada fila justo después de la anterior.
      const want = prevEl ? prevEl.nextElementSibling : container.firstElementChild;
      if (want !== el) container.insertBefore(el, want);
      prevEl = el;
    }
    if (!anim) return;
    // FLIP: las que cambiaron de sitio se deslizan desde donde estaban.
    for (const it of items) {
      const el = container.querySelector(`:scope > [data-key="${CSS.escape(it.key)}"]`);
      const was = rects.get(it.key);
      if (!el || !was) continue;
      const now = el.getBoundingClientRect();
      const dy = was.top - now.top;
      if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }

  // ---------- Confeti ----------
  /** Pequeña explosión de confeti desde (x, y) de la ventana. big: celebración grande. */
  function burst(x, y, { n = 10, big = false } = {}) {
    if (reduced()) return;
    let layer = document.getElementById('fx-layer');
    if (!layer) { layer = document.createElement('div'); layer.id = 'fx-layer'; document.body.append(layer); }
    const colors = ['#ff5d8f', '#ffd23f', '#3bceac', '#4d7cfe', '#ff8c42', '#a066ff'];
    const count = big ? 46 : n;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('i');
      const ang = big ? Math.random() * Math.PI * 2 : -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const dist = (big ? 120 : 34) + Math.random() * (big ? 160 : 30);
      const dx = Math.cos(ang) * dist;
      const dy = Math.sin(ang) * dist;
      p.style.cssText = `left:${x}px;top:${y}px;background:${colors[i % colors.length]};width:${big ? 7 : 5}px;height:${big ? 10 : 7}px`;
      layer.append(p);
      const a = p.animate([
        { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${Math.random() * 540 - 270}deg)`, opacity: 1, offset: 0.7 },
        { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + (big ? 90 : 30)}px)) rotate(${Math.random() * 720}deg)`, opacity: 0 },
      ], { duration: big ? 1400 : 650, easing: 'cubic-bezier(.2,.8,.2,1)', delay: big ? Math.random() * 120 : 0 });
      const kill = () => p.remove();
      a.onfinish = kill;
      setTimeout(kill, 2200);
    }
  }

  // ---------- Botones con estado ----------
  /** Mientras corre fn(): girando; luego ✓ o ✗ un momento. Devuelve lo que devuelva fn. */
  async function busy(btn, fn) {
    if (!btn || btn.classList.contains('is-busy')) return fn();
    btn.classList.remove('is-ok', 'is-err');
    btn.classList.add('is-busy');
    btn.setAttribute('aria-busy', 'true');
    let ok = true;
    let out;
    try { out = await fn(); ok = !(out && (out.ok === false || out.error)); } catch (e) { ok = false; throw e; } finally {
      btn.classList.remove('is-busy');
      btn.removeAttribute('aria-busy');
      if (!(out && out.canceled)) {
        btn.classList.add(ok ? 'is-ok' : 'is-err');
        if (!ok) btn.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 260 });
        setTimeout(() => btn.classList.remove('is-ok', 'is-err'), 1300);
      }
      sfx(ok ? 'pop' : 'error');
    }
    return out;
  }

  // ---------- Sonidos de interfaz (opcionales, sintetizados) ----------
  let actx = null;
  let soundsOn = false;
  const setSounds = (on) => { soundsOn = !!on; };
  /** kind: 'done' | 'celebrate' | 'pop' | 'error'. Muy suaves y cortos. */
  function sfx(kind) {
    if (!soundsOn) return;
    try {
      actx = actx || new AudioContext();
      const notes = { done: [[660, 0], [990, 0.07]], celebrate: [[523, 0], [659, 0.08], [784, 0.16], [1047, 0.24]], pop: [[740, 0]], error: [[220, 0], [180, 0.09]] }[kind] || [];
      for (const [f, t] of notes) {
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = kind === 'error' ? 'triangle' : 'sine';
        o.frequency.value = f;
        const at = actx.currentTime + t;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(kind === 'error' ? 0.05 : 0.06, at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
        o.connect(g).connect(actx.destination);
        o.start(at);
        o.stop(at + 0.16);
      }
    } catch { /* sin audio */ }
  }

  // ---------- Cambio de tema suave ----------
  // Al pasar de claro a oscuro (o al revés), un fundido de 350 ms en vez de un parpadeo.
  // La primera vez (al cargar) no se anima.
  let themeKnown = null;
  const t0 = performance.now(); // el tema inicial llega con el primer pintado: ese no se anima
  new MutationObserver(() => {
    const html = document.documentElement;
    const dark = html.classList.contains('dark');
    if (themeKnown !== null && dark !== themeKnown && !reduced() && performance.now() - t0 > 1500) {
      html.classList.add('theme-anim');
      clearTimeout(html._themeT);
      html._themeT = setTimeout(() => html.classList.remove('theme-anim'), 400);
    }
    themeKnown = dark;
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  root.MOTION = { countTo, afterRender, skeleton, watchOverlays, reduced, keyedList, burst, busy, sfx, setSounds };
})(typeof window !== 'undefined' ? window : globalThis);

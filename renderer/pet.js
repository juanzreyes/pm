const $ = (s) => document.querySelector(s);
const body = document.body;
const chick = $('#chick');
const bubble = $('#bubble');
const bubbleText = $('#bubble-text');
const fx = $('#fx');
const walker = $('#walker');
const meter = $('#meter');
const meterText = $('#meter-text');
const eyes = $('#eyes');

let state = null;
let lastInteract = Date.now();
let busyUntil = 0;
let dragging = false;
let posX = 0;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------- Clic a través de las zonas transparentes ----------
const hovered = new Set();
function syncIgnore() {
  if (!dragging) pm.setIgnore(hovered.size === 0);
}
document.querySelectorAll('.hit').forEach((el) => {
  el.addEventListener('mouseenter', () => {
    hovered.add(el);
    syncIgnore();
    if (el === chick) body.classList.add('hover');
  });
  el.addEventListener('mouseleave', () => {
    hovered.delete(el);
    syncIgnore();
    if (el === chick) body.classList.remove('hover');
  });
});

// ---------- Sonidos (píos sintetizados, sin archivos) ----------
let actx = null;
const SOUNDS = {
  pio: [[1800, 2700, 0.08], [2000, 3000, 0.09]],
  happy: [[1500, 2400, 0.07], [1900, 2800, 0.07], [2400, 3300, 0.11]],
  angry: [[520, 300, 0.16], [480, 260, 0.2]],
  sad: [[1500, 900, 0.3]],
  alarm: [[2300, 2300, 0.07], [2300, 2300, 0.07], [2300, 2300, 0.07]],
};
function chirp(kind = 'pio') {
  if (!state || !state.settings || !state.settings.sounds || state.muted) return;
  const notes = SOUNDS[kind];
  if (!notes) return;
  try {
    actx = actx || new AudioContext();
    // Libera el audio tras 20 s en silencio (el servicio de audio ocupa memoria).
    clearTimeout(chirp.idle);
    chirp.idle = setTimeout(() => { if (actx) { actx.close().catch(() => {}); actx = null; } }, 20000);
    let t = actx.currentTime + 0.01;
    for (const [f1, f2, d] of notes) {
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = kind === 'angry' ? 'sawtooth' : 'sine';
      o.frequency.setValueAtTime(f1, t);
      o.frequency.exponentialRampToValueAtTime(f2, t + d);
      g.gain.setValueAtTime(0.0001, t);
      const vol = Math.max(0.0002, ((state.settings.volume ?? 70) / 100) * (kind === 'angry' ? 0.07 : 0.14));
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(actx.destination);
      o.start(t);
      o.stop(t + d + 0.02);
      t += d + 0.035;
    }
  } catch { /* sin audio */ }
}
const ANIM_SOUND = {
  celebrate: 'happy', dance: 'happy', love: 'happy', eat: 'happy', hatch: 'happy',
  angry: 'angry', alarm: 'alarm', alert: 'alarm', 'alarm-soft': 'alarm', sad: 'sad', faint: 'sad', hop: 'pio', flap: 'pio',
};

// ---------- Acciones animadas ----------
const DUR = {
  hop: 900, peck: 900, flap: 1300, 'alarm-soft': 1400, dance: 2000, love: 1900, celebrate: 1500,
  alert: 1000, alarm: 1600, sad: 2500, faint: 3300, eat: 1900, wobble: 1300, look: 1700, hatch: 2900, hug: 2200,
  angry: 2000, judge: 2000, yawn: 2200, stretch: 2700,
  // Gestos de reposo
  bath: 2300,
  read: 2900, coffee: 3300, typing: 3600, gum: 2700, sing: 3100, scratch: 1900, preen: 2300, fluff: 1300,
  wave: 1800, sneeze: 1500, hiccup: 1900, sit: 3500, spin: 1100, lookaround: 2500, butterfly: 4300,
  // Trucos aprendidos (2.0)
  'trick-spin': 1500, 'trick-flip': 1500, 'trick-moonwalk': 2400, 'trick-salute': 1800, 'trick-juggle': 2700,
};
let actionTimer = null;
let currentAction = null;

function act(name, silent = false) {
  if (!DUR[name]) return;
  wake();
  if (!silent) chirp(ANIM_SOUND[name]);
  if (currentAction) body.classList.remove('a-' + currentAction);
  void chick.offsetWidth; // reinicia la animación CSS
  currentAction = name;
  body.classList.add('a-' + name);
  clearTimeout(actionTimer);
  busyUntil = Date.now() + DUR[name];
  actionTimer = setTimeout(() => {
    body.classList.remove('a-' + name);
    currentAction = null;
  }, DUR[name]);
  effects(name);
}

// Coordenadas dentro de #fx: el pollito empieza en (40, 60), cabeza ~ (100, 95).
function particle(content, x, y, opts = {}) {
  const el = document.createElement('div');
  el.className = opts.cls || 'p';
  el.textContent = content;
  el.style.setProperty('--x', x + 'px');
  el.style.setProperty('--y', y + 'px');
  if (opts.dx != null) el.style.setProperty('--dx', opts.dx + 'px');
  if (opts.dy != null) el.style.setProperty('--dy', opts.dy + 'px');
  if (opts.r != null) el.style.setProperty('--r', opts.r + 'deg');
  if (opts.d) el.style.setProperty('--d', opts.d + 's');
  if (opts.c) el.style.setProperty('--c', opts.c);
  if (opts.size) el.style.fontSize = opts.size + 'px';
  if (opts.delay) el.style.animationDelay = opts.delay + 's';
  fx.appendChild(el);
  setTimeout(() => el.remove(), ((opts.d || 2) + (opts.delay || 0)) * 1000 + 300);
}

function hearts(n = 5) {
  for (let i = 0; i < n; i++) {
    particle(pick(['💛', '💕', '💖', '🧡']), rand(60, 130), rand(60, 100), { dx: rand(-30, 30), r: rand(-30, 30), d: rand(1.3, 2), delay: i * 0.15, size: rand(13, 20) });
  }
}

function confetti() {
  const colors = ['#ff5d8f', '#ffd23f', '#3bceac', '#4d7cfe', '#ff8c42', '#a066ff'];
  for (let i = 0; i < 34; i++) {
    const el = document.createElement('div');
    el.className = 'confetti';
    el.style.setProperty('--x', rand(80, 120) + 'px');
    el.style.setProperty('--y', rand(70, 100) + 'px');
    el.style.setProperty('--dx', rand(-110, 110) + 'px');
    el.style.setProperty('--dy', rand(-90, 70) + 'px');
    el.style.setProperty('--r', rand(-540, 540) + 'deg');
    el.style.setProperty('--c', pick(colors));
    el.style.setProperty('--d', rand(1.2, 2.2) + 's');
    fx.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }
}

function effects(name) {
  // Malabares: tres granos de maíz por el aire.
  if (name === 'trick-juggle') { for (let i = 0; i < 6; i++) setTimeout(() => particle('🌽', 70 + (i % 3) * 18, 40, { size: 16, d: 0.9 }), i * 380); return; }
  if (name === 'trick-salute') { particle('🫡', 128, 50, { size: 18, d: 1.4 }); return; }
  switch (name) {
    case 'love': hearts(6); break;
    case 'hug': hearts(3); break;
    case 'celebrate': confetti(); particle('✨', 50, 60); particle('⭐', 140, 70, { delay: 0.2 }); break;
    case 'alert': bang('!'); break;
    case 'alarm': bang('!!'); break;
    case 'alarm-soft': particle('⏰', 130, 55, { size: 22, d: 1.8 }); break;
    case 'faint': for (let i = 0; i < 4; i++) particle('💫', rand(70, 130), rand(70, 95), { delay: i * 0.4, d: 1.4 }); break;
    case 'eat':
      for (let i = 0; i < 6; i++) particle(pick(['🌽', '•']), rand(85, 115), 118, { cls: 'p fall', d: 0.9, delay: i * 0.25, size: 12 });
      setTimeout(() => hearts(2), 1500);
      break;
    case 'sad': particle('💧', 120, 70, { d: 1.6, size: 13 }); break;
    case 'hatch': for (let i = 0; i < 5; i++) particle('✨', rand(50, 150), rand(70, 120), { delay: 0.8 + i * 0.2 }); break;
    case 'dance': particle('🎵', 130, 70, { dx: 20 }); particle('🎶', 60, 75, { dx: -20, delay: 0.6 }); break;
    case 'angry':
      particle('💢', 128, 48, { size: 24, d: 1.6 });
      particle('💨', 45, 105, { dx: -35, d: 1.2, delay: 0.3 });
      particle('💨', 140, 105, { dx: 35, d: 1.2, delay: 0.5 });
      particle('💢', 58, 55, { size: 18, d: 1.4, delay: 0.8 });
      break;
    case 'judge': particle(pick(['👀', '🤨', '📋']), 132, 55, { size: 20, d: 1.8 }); break;
    case 'yawn': particle('💤', 125, 60, { size: 16, d: 2 }); break;
    case 'bath':
      for (let i = 0; i < 10; i++) particle(pick(['🫧', '🫧', '💧', '✨']), rand(55, 145), rand(70, 140), { dx: rand(-25, 25), d: rand(1, 1.8), delay: i * 0.18, size: rand(11, 17) });
      break;
    // Gestos de reposo
    case 'read': particle('✅', 58, 100, { size: 13, d: 1.3, delay: 2 }); break;
    case 'coffee': for (let i = 0; i < 3; i++) particle('♨️', rand(118, 132), 118, { size: 11, d: 1.6, delay: 0.3 + i * 0.5, dx: rand(-6, 6) }); break;
    case 'typing': particle('💡', 128, 52, { size: 15, d: 1.6, delay: 2.6 }); break;
    case 'gum': particle('¡pop!', 88, 112, { cls: 'p word', size: 12, d: 0.9, delay: 2.05 }); break;
    case 'sing': for (let i = 0; i < 4; i++) particle(pick(['🎵', '🎶', '♪']), rand(118, 140), rand(80, 95), { dx: rand(-20, 25), d: 1.6, delay: i * 0.6, size: rand(12, 17) }); break;
    case 'scratch': particle('❓', 138, 58, { size: 13, d: 1.4, delay: 0.4 }); break;
    case 'fluff': for (let i = 0; i < 6; i++) particle('•', rand(60, 140), rand(80, 130), { dx: rand(-30, 30), d: 1.1, size: rand(8, 12), cls: 'p feather' }); break;
    case 'wave': particle('👋', 145, 78, { size: 16, d: 1.4 }); break;
    case 'sneeze': particle('¡Achís!', 110, 100, { cls: 'p word', size: 13, d: 1, delay: 0.6, dx: 20 }); break;
    case 'hiccup': for (let i = 0; i < 3; i++) particle('hic', rand(118, 134), 80, { cls: 'p word', size: 11, d: 0.8, delay: i * 0.55 }); break;
    case 'sit': particle('😌', 132, 70, { size: 14, d: 2, delay: 0.6 }); break;
    case 'butterfly': {
      const b = document.createElement('div');
      b.className = 'butterfly';
      b.textContent = '🦋';
      fx.appendChild(b);
      setTimeout(() => b.remove(), 4400);
      setTimeout(() => act('hop', true), 3900);
      break;
    }
  }
}

function bang(txt) {
  const el = document.createElement('div');
  el.className = 'bang';
  el.textContent = txt;
  fx.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

// ---------- Bocadillo ----------
let typeTimer = null;
let hideTimer = null;

const bubbleActions = $('#bubble-actions');

// Voz del pollito (voces de Windows, sin internet). Solo avisos importantes.
function speakText(text, lang) {
  try {
    if (!window.speechSynthesis) return;
    const clean = String(text)
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '') // sin emojis
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    const want = ['en', 'pt', 'fr'].includes(lang) ? lang : 'es';
    const voice = speechSynthesis.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith(want));
    if (voice) u.voice = voice;
    u.lang = { en: 'en-US', pt: 'pt-BR', fr: 'fr-FR' }[want] || 'es-ES';
    u.pitch = 1.7; // voz de pollito
    u.rate = 1.05;
    u.volume = Math.max(0, Math.min(1, ((state && state.settings && state.settings.volume) ?? 70) / 100));
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* sin voz disponible */ }
}

function say(payload) {
  const { text, anim, ms, quiet, actions } = payload;
  bubbleTarget = payload.target || null;
  bubble.title = bubbleTarget ? (payload.lang === 'en' ? 'Click to see it' : 'Clic para ir a verlo') : '';
  if (!text) return;
  wake();
  clearTimeout(typeTimer);
  body.classList.remove('lipsync', 'beak-open'); // si interrumpe a otra burbuja, el pico no se queda abierto
  clearTimeout(hideTimer);
  // ¿Tapa a otro aviso que apenas se vio (y que quedó en el centro de avisos)? Suma al "+N".
  const visible = !bubble.classList.contains('hidden') && !bubble.classList.contains('out');
  if (visible && lastLogged && Date.now() - shownAt < 4000) stacked++;
  else if (!visible) stacked = 0;
  lastLogged = payload.logged !== false;
  shownAt = Date.now();
  const stackBtn = $('#bubble-stack');
  stackBtn.classList.toggle('hidden', !stacked);
  if (stacked) stackBtn.textContent = (payload.lang === 'en' ? `+${stacked} more` : `+${stacked} más`);
  bubble.style.translate = '';
  bubble.style.opacity = '';
  bubble.classList.remove('hidden', 'out');
  bubble.style.animation = 'none';
  void bubble.offsetWidth;
  bubble.style.animation = '';
  followTail();
  bubbleText.textContent = '';
  // Botones de acción dentro del bocadillo (Unirme, Posponer, Es trabajo…).
  bubbleActions.innerHTML = '';
  bubble.classList.toggle('has-actions', !!(actions && actions.length));
  for (const a of actions || []) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = a.label;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      pm.petAction(a.cmd, a.arg);
      hideBubble();
    });
    bubbleActions.appendChild(b);
  }
  const chars = [...text];
  let i = 0;
  body.classList.add('talking');
  const reduced = !!(state && state.settings && state.settings.reducedMotion);
  if (reduced) {
    bubbleText.textContent = text; // sin efecto máquina de escribir
    body.classList.remove('talking');
  } else {
    // Escribe al ritmo del habla: el pico se abre con las vocales y hace pausas en comas y puntos.
    body.classList.add('lipsync');
    const tick = () => {
      const ch = chars[i++] || '';
      bubbleText.textContent += ch;
      body.classList.toggle('beak-open', /[aeiouáéíóúAEIOUÁÉÍÓÚ]/.test(ch));
      if (i >= chars.length) {
        body.classList.remove('talking', 'lipsync', 'beak-open');
        return;
      }
      typeTimer = setTimeout(tick, /[.!?…]/.test(ch) ? 230 : /[,;:]/.test(ch) ? 120 : 26);
    };
    typeTimer = setTimeout(tick, 26);
  }
  if (anim) act(anim, !!quiet);
  else if (!quiet) chirp('pio');
  if (payload.speak) speakText(text, payload.lang);
  scheduleHide(ms || Math.max(5000, 2500 + chars.length * 55));
}

function scheduleHide(ms) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideBubble, ms);
}

function hideBubble() {
  if (bubble.classList.contains('hidden')) return;
  bubble.classList.add('out');
  setTimeout(() => {
    bubble.classList.add('hidden');
    bubble.classList.remove('out');
    resetStack();
    hovered.delete(bubble);
    syncIgnore();
  }, 250);
}

bubble.addEventListener('mouseenter', () => clearTimeout(hideTimer));
bubble.addEventListener('mouseleave', () => scheduleHide(3000));
// Clic en el bocadillo (fuera de los botones) → ir a ver el aviso.
let bubbleTarget = null;
bubble.addEventListener('click', (e) => {
  if (bubble.dataset.swiped) { delete bubble.dataset.swiped; return; }
  if (e.target.closest('button')) return;
  if (bubbleTarget) pm.petAction(bubbleTarget.cmd, bubbleTarget.arg);
  else pm.openPanel('chat');
  hideBubble();
});

// Modo discreto: al pasar el ratón por encima, se asoma.
chick.addEventListener('mouseenter', () => pm.hover(true));
chick.addEventListener('mouseleave', () => pm.hover(false));
pm.onDock((d) => {
  body.classList.toggle('docked', !!d);
  if (d) body.classList.toggle('left', d.side === 'right'); // mira hacia la pantalla
});

function updateTail() {
  // Centro real del pollito (también a mitad de un paseo), no el destino.
  const r = chick.getBoundingClientRect();
  const center = r.width ? r.left + r.width / 2 : 120 + posX;
  bubble.style.setProperty('--tail-x', Math.max(22, Math.min(200, center - 8)).toFixed(1) + 'px');
}
let tailRaf = 0;
function followTail() {
  cancelAnimationFrame(tailRaf);
  const loop = () => {
    if (bubble.classList.contains('hidden')) return;
    updateTail();
    tailRaf = requestAnimationFrame(loop);
  };
  loop();
}

// Deslizar la burbuja a un lado la descarta (como una notificación del móvil).
let swipe = null;
bubble.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('button')) return;
  swipe = { x: e.clientX, dx: 0, moved: false };
  try { bubble.setPointerCapture(e.pointerId); } catch { /* sintético */ }
});
bubble.addEventListener('pointermove', (e) => {
  if (!swipe) return;
  swipe.dx = e.clientX - swipe.x;
  if (Math.abs(swipe.dx) > 6) swipe.moved = true;
  if (!swipe.moved) return;
  clearTimeout(hideTimer);
  bubble.style.translate = swipe.dx + 'px 0';
  bubble.style.opacity = String(Math.max(0.2, 1 - Math.abs(swipe.dx) / 160));
});
bubble.addEventListener('pointerup', () => {
  if (!swipe) return;
  const { dx, moved } = swipe;
  swipe = null;
  if (!moved) return;
  bubble.dataset.swiped = '1'; // el "click" que llega después no abre nada
  if (Math.abs(dx) > 60) {
    const out = bubble.animate([{ translate: dx + 'px 0', opacity: bubble.style.opacity }, { translate: Math.sign(dx) * 260 + 'px 0', opacity: 0 }], { duration: 180, easing: 'cubic-bezier(.4,0,1,1)' });
    let gone = false;
    const finish = () => {
      if (gone) return;
      gone = true;
      clearTimeout(hideTimer);
      bubble.classList.add('hidden');
      bubble.style.translate = '';
      bubble.style.opacity = '';
      resetStack();
      hovered.delete(bubble);
      syncIgnore();
    };
    out.onfinish = finish;
    setTimeout(finish, 400); // por si la animación no corre (ventana sin pintar)
  } else {
    bubble.animate([{ translate: dx + 'px 0' }, { translate: '0 0' }], { duration: 260, easing: 'cubic-bezier(.3,1.45,.5,1)' });
    bubble.style.translate = '';
    bubble.style.opacity = '';
    scheduleHide(3000);
  }
});

// Avisos que llegan seguidos: el nuevo reemplaza al anterior y un "+N" lleva a verlos todos.
let stacked = 0;
let shownAt = 0;
let lastLogged = false;
function resetStack() { stacked = 0; $('#bubble-stack').classList.add('hidden'); }
$('#bubble-stack').addEventListener('click', (e) => {
  e.stopPropagation();
  pm.command('inbox');
  hideBubble();
});

// ---------- Arrastrar / clic / caricias / mantener presionado ----------
// Al arrastrarlo se estira según la velocidad; si lo lanzas, vuela (src/main/petfly.js) y se
// aplasta en cada golpe. Frotarlo es una caricia; mantenerlo presionado abre el menú circular.
let down = null;
let rubDist = 0;
let rubStart = 0;
let lastMove = null; // { t, x, y } para la velocidad del arrastre
let holdTimer = null;
const reducedNow = () => body.classList.contains('reduced');

/** Estirar/aplastar sin pisar los transform de las animaciones (propiedades scale/rotate). */
function stretch(vx, vy) {
  if (reducedNow()) return;
  const v = Math.min(1, Math.hypot(vx, vy) / 2200);
  const horiz = Math.abs(vx) >= Math.abs(vy);
  const k = 1 + v * 0.16;
  chick.style.scale = horiz ? `${k.toFixed(3)} ${(1 / k).toFixed(3)}` : `${(1 / k).toFixed(3)} ${k.toFixed(3)}`;
  chick.style.rotate = `${Math.max(-14, Math.min(14, vx / 160)).toFixed(1)}deg`;
}
function unstretch() {
  chick.style.scale = '';
  chick.style.rotate = '';
}
/** Golpe: se aplasta según la fuerza y vuelve con rebote. */
function squash(speed = 800, kind = 'floor') {
  if (reducedNow()) return;
  const f = Math.min(1, speed / 2200);
  const a = (1 + 0.32 * f).toFixed(3);
  const b = (1 - 0.3 * f).toFixed(3);
  const frames = kind === 'wall'
    ? [{ scale: `${b} ${a}` }, { scale: '1.06 0.95' }, { scale: '1 1' }]
    : [{ scale: `${a} ${b}`, translate: `0 ${(6 * f).toFixed(1)}px` }, { scale: '0.94 1.07', translate: '0 -2px' }, { scale: '1 1', translate: '0 0' }];
  chick.animate(frames, { duration: 380, easing: 'cubic-bezier(.3,1.45,.5,1)' });
  if (kind === 'floor' && f > 0.35) for (let i = 0; i < 3; i++) particle('💨', 60 + rand(-25, 25), 118, { dx: rand(-40, 40), dy: -rand(6, 16), d: 0.7, size: 14, delay: i * 0.04 });
}

chick.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  down = { x: e.screenX, y: e.screenY, moved: false, t: Date.now() };
  lastMove = { t: performance.now(), x: e.screenX, y: e.screenY, vx: 0, vy: 0 };
  try { chick.setPointerCapture(e.pointerId); } catch { /* puntero sintético (tests) */ }
  // Mantener presionado (sin moverlo) abre el menú circular.
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => { if (down && !down.moved) { down.held = true; openRadial(); } }, 520);
});

chick.addEventListener('pointermove', (e) => {
  if (!down) return rub(e);
  if (!down.moved && Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4) {
    if (down.held) return; // con el menú abierto no se arrastra
    clearTimeout(holdTimer);
    down.moved = true;
    dragging = true;
    pm.dragStart({ screenX: down.x, screenY: down.y });
    body.classList.add('dragged');
    wake();
  }
  if (down.moved) {
    pm.dragMove({ screenX: e.screenX, screenY: e.screenY });
    const now = performance.now();
    const dt = Math.max(8, now - lastMove.t) / 1000;
    // Velocidad suavizada: el estiramiento no tiembla.
    const vx = 0.6 * ((e.screenX - lastMove.x) / dt) + 0.4 * lastMove.vx;
    const vy = 0.6 * ((e.screenY - lastMove.y) / dt) + 0.4 * lastMove.vy;
    lastMove = { t: now, x: e.screenX, y: e.screenY, vx, vy };
    stretch(vx, vy);
  }
});

chick.addEventListener('pointerup', (e) => {
  clearTimeout(holdTimer);
  if (!down) return;
  const wasDrag = down.moved;
  const held = down.held;
  down = null;
  try { chick.releasePointerCapture(e.pointerId); } catch { /* ya liberado */ }
  if (held) return; // soltar tras abrir el menú: el menú se queda abierto
  if (wasDrag) {
    dragging = false;
    body.classList.remove('dragged');
    unstretch();
    pm.dragEnd();
    if (!chick.matches(':hover')) hovered.delete(chick);
    syncIgnore();
    act('wobble');
  } else {
    wake();
    pm.click();
    act('hop');
  }
});

chick.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  wake();
  pm.context();
});

// Vuelo: mientras vuela da vueltas; en cada golpe se aplasta; al aterrizar, polvo y alivio.
pm.onFly(({ on, vx, landed }) => {
  body.classList.toggle('flying', !!on);
  if (on && !reducedNow()) chick.animate([{ rotate: '0deg' }, { rotate: `${vx > 0 ? 360 : -360}deg` }], { duration: 700, easing: 'cubic-bezier(.2,.8,.2,1)' });
  if (!on && landed) { unstretch(); setTimeout(() => act('wobble'), 120); }
});
pm.onImpact(({ kind, speed }) => squash(speed, kind));

// Frotar el ratón encima = caricia 💛: cierra los ojitos, se sonroja y suelta corazones.
let pettingTimer = null;
let heartAt = 0;
let rubLast = null;
function rub(e) {
  const now = Date.now();
  if (now - rubStart > 1800) { rubStart = now; rubDist = 0; heartAt = 0; }
  // Distancia desde el último punto (movementX no siempre viene informado).
  if (rubLast && now - rubLast.t < 250) rubDist += Math.hypot(e.clientX - rubLast.x, e.clientY - rubLast.y);
  rubLast = { t: now, x: e.clientX, y: e.clientY };
  if (rubDist > 140) {
    body.classList.add('petting');
    clearTimeout(pettingTimer);
    pettingTimer = setTimeout(() => body.classList.remove('petting'), 650);
    if (rubDist - heartAt > 160) { heartAt = rubDist; particle(pick(['💛', '💕', '💖']), rand(70, 120), rand(55, 80), { dx: rand(-20, 20), d: 1.2, size: rand(12, 16) }); }
  }
  if (rubDist > 450) {
    rubDist = 0;
    heartAt = 0;
    rubStart = now;
    wake();
    pm.petted();
  }
}

// ---------- Menú circular (mantener presionado) ----------
const RADIAL = [
  { icon: '📋', label: 'Mi día', cmd: 'panel', arg: 'day' },
  { icon: '🍅', label: 'Pomodoro', cmd: 'pomo.toggle' },
  { icon: '✍️', label: 'Anotar', cmd: 'capture' },
  { icon: '🎯', label: 'Foco 25 min', cmd: 'focus.start25' },
  { icon: '🌽', label: 'Dar de comer', cmd: 'feed' },
  { icon: '🔕', label: 'Silenciar 1 h', cmd: 'mute' },
];
const radial = $('#radial');
function openRadial() {
  if (!radial) return;
  wake();
  const r = chick.getBoundingClientRect();
  const R = 84;
  const M = 24; // medio botón + margen: nada se sale de la ventana
  // Centro en el pollito, pero corrido lo justo para que el arco entero quepa en la ventana.
  const cx = Math.max(R + M, Math.min(innerWidth - R - M, r.left + r.width / 2));
  const cy = Math.max(R + M, Math.min(innerHeight - M, r.top + r.height * 0.55));
  radial.innerHTML = RADIAL.map((it, i) => {
    // Arco superior (de 195° a 345°): el de abajo quedaría fuera de la ventana.
    const a = ((195 + (150 / (RADIAL.length - 1)) * i) * Math.PI) / 180;
    const x = cx + Math.cos(a) * R;
    const y = cy + Math.sin(a) * R;
    return `<button class="rd" style="left:${x.toFixed(0)}px;top:${y.toFixed(0)}px;--i:${i}" data-i="${i}" title="${it.label}" aria-label="${it.label}"><span>${it.icon}</span></button>`;
  }).join('') + '<div class="rd-label" aria-hidden="true"></div>';
  radial.classList.add('open');
  hovered.add(radial);
  syncIgnore();
  chick.animate([{ scale: '1 1' }, { scale: '1.08 0.94' }, { scale: '1 1' }], { duration: 260 });
  const first = radial.querySelector('.rd');
  if (first) first.focus({ preventScroll: true });
}
function closeRadial() {
  if (!radial || !radial.classList.contains('open')) return;
  radial.classList.remove('open');
  hovered.delete(radial);
  syncIgnore();
}
if (radial) {
  radial.addEventListener('click', (e) => {
    const b = e.target.closest('.rd');
    if (!b) return closeRadial();
    const it = RADIAL[Number(b.dataset.i)];
    closeRadial();
    pm.command(it.cmd, it.arg);
  });
  radial.addEventListener('mouseover', (e) => {
    const b = e.target.closest('.rd');
    radial.querySelector('.rd-label').textContent = b ? RADIAL[Number(b.dataset.i)].label : '';
  });
  radial.addEventListener('focusin', (e) => {
    const b = e.target.closest('.rd');
    if (b) radial.querySelector('.rd-label').textContent = RADIAL[Number(b.dataset.i)].label;
  });
  radial.addEventListener('mouseleave', () => setTimeout(closeRadial, 350));
  document.addEventListener('keydown', (e) => {
    if (!radial.classList.contains('open')) return;
    if (e.key === 'Escape') closeRadial();
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const bs = [...radial.querySelectorAll('.rd')];
      const i = bs.indexOf(document.activeElement);
      bs[(i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length].focus();
    }
  });
}

// ---------- Ojos que siguen el cursor ----------
let lastCursor = { x: 0, y: 0 };
let lastCursorMove = 0;
pm.onCursor(({ x, y }) => {
  if (Math.abs(x - lastCursor.x) + Math.abs(y - lastCursor.y) > 2) lastCursorMove = Date.now();
  lastCursor = { x, y };
  lookAt(x, y);
});

function lookAt(x, y) {
  const r = chick.getBoundingClientRect();
  const cx = r.left + 60, cy = r.top + 66;
  const dx = x - cx, dy = y - cy;
  const d = Math.hypot(dx, dy) || 1;
  const k = Math.min(d / 60, 1) * 3.2;
  let ex = (dx / d) * k;
  const ey = (dy / d) * k * 0.8;
  if (body.classList.contains('left')) ex = -ex;
  eyes.style.transform = `translate(${ex.toFixed(2)}px, ${ey.toFixed(2)}px)`;
}

// ---------- Vida: parpadeo, paseos y gestos ----------
function blink() {
  if (!body.classList.contains('mood-sleep')) {
    body.classList.add('blink');
    setTimeout(() => body.classList.remove('blink'), 120);
    if (Math.random() < 0.25) {
      setTimeout(() => body.classList.add('blink'), 240);
      setTimeout(() => body.classList.remove('blink'), 360);
    }
  }
  setTimeout(blink, rand(1800, 5500));
}

function sleeping() {
  return body.classList.contains('mood-sleep');
}

function wander() {
  if (dragging || sleeping() || Date.now() < busyUntil || !bubble.classList.contains('hidden')) return;
  const target = Math.round(rand(-55, 55));
  if (Math.abs(target - posX) < 15) return;
  body.classList.toggle('left', target < posX);
  const dur = Math.abs(target - posX) * 38;
  walker.style.transitionDuration = dur + 'ms';
  body.classList.add('walking');
  walker.style.transform = `translateX(${target}px)`;
  posX = target;
  busyUntil = Date.now() + dur;
  setTimeout(() => {
    body.classList.remove('walking');
    if (Math.random() < 0.5) body.classList.remove('left');
    updateTail();
  }, dur);
}

// Repertorio de reposo según la hora del día (y sin repetir el último gesto).
let lastIdle = '';
function standbyPool() {
  const h = new Date().getHours();
  const base = ['look', 'lookaround', 'peck', 'flap', 'hop', 'wobble', 'dance', 'scratch', 'preen', 'fluff', 'wave', 'spin', 'sneeze', 'hiccup', 'gum', 'sing', 'butterfly', 'sit'];
  let extra = [];
  if (h >= 7 && h < 11) extra = ['coffee', 'coffee', 'read', 'stretch'];          // mañana: café y planear el día
  else if (h >= 11 && h < 18) extra = ['typing', 'typing', 'read', 'read', 'coffee']; // horario laboral: a trabajar
  else if (h >= 18 && h < 23) extra = ['sit', 'yawn', 'sing', 'gum'];              // tarde-noche: más relajado
  const pool = [...base, ...extra].filter((x) => x !== lastIdle);
  return pool;
}

function idle() {
  const reduced = !!(state && state.settings && state.settings.reducedMotion);
  const docked = body.classList.contains('docked');
  // Con "menos animación" solo hace gestos suaves de vez en cuando; en el borde no pasea.
  if (reduced && !dragging && Date.now() > busyUntil) {
    if (Math.random() < 0.3) act('look', true);
  } else if (!dragging && !sleeping() && Date.now() > busyUntil && !docked) {
    const mood = [...body.classList].find((c) => c.startsWith('mood-')) || 'mood-happy';
    const hungry = body.classList.contains('hungry');
    let pool = standbyPool();
    if (mood === 'mood-panic') pool = ['alert', 'look', 'flap', 'alert'];
    if (mood === 'mood-worried') pool = ['look', 'peck', 'wobble', 'look'];
    if (mood === 'mood-exhausted') pool = ['look', 'sad', 'wobble'];
    if (hungry) pool.push('sad', 'peck', 'peck');
    if (mood === 'mood-angry') pool = ['angry', 'look', 'angry', 'wobble'];
    if (body.classList.contains('judging')) pool = body.classList.contains('fuming') ? ['angry', 'judge', 'angry'] : ['judge', 'judge', 'look'];
    if (body.classList.contains('bored')) pool = ['yawn', 'look', 'sad', 'yawn'];
    if (body.classList.contains('tired')) pool = ['yawn', 'sit', 'look', 'yawn', 'sit'];
    if (body.classList.contains('sick')) pool = ['sad', 'sneeze', 'look', 'sit'];
    if (body.classList.contains('dirty') && Math.random() < 0.4) particle('🪰', rand(60, 150), rand(60, 110), { dx: rand(-40, 40), d: 2.2, size: 12 });
    const still = mood === 'mood-angry' || body.classList.contains('judging') || body.classList.contains('meeting') || body.classList.contains('pomo-focus');
    if (body.classList.contains('meeting')) pool = ['look', 'peck', 'look'];
    if (!still && Math.random() < 0.25) wander();
    else {
      lastIdle = pick(pool);
      act(lastIdle, true);
    }
  }
  setTimeout(idle, rand(3500, 8000));
}

// Zzz mientras duerme
setInterval(() => {
  if (sleeping()) particle('z', rand(100, 115), rand(55, 70), { cls: 'zzz', size: rand(12, 18) });
}, 1400);

// Ambiente de temporada: nieve, murciélagos, corazones, confeti de Año Nuevo, velitas de cumpleaños.
setInterval(() => {
  if (body.classList.contains('reduced') || sleeping() && Math.random() < 0.5) return;
  if (body.classList.contains('season-xmas')) particle('❄️', rand(20, 200), 20, { cls: 'p fall', d: 3, size: rand(9, 14) });
  else if (body.classList.contains('season-halloween') && Math.random() < 0.35) particle('🦇', rand(40, 180), rand(40, 90), { dx: rand(-40, 40), d: 2.2, size: 13 });
  else if (body.classList.contains('season-valentine') && Math.random() < 0.5) particle('💘', rand(60, 150), rand(60, 100), { d: 2, size: 13 });
  else if (body.classList.contains('season-newyear') && Math.random() < 0.3) confetti();
  else if (body.classList.contains('birthday') && Math.random() < 0.4) particle(pick(['🎂', '🎈', '🎉']), rand(40, 170), rand(60, 110), { d: 2.2, size: 15 });
}, 2500);

// ---------- Ánimo según el consumo ----------
function isNight() {
  const h = new Date().getHours();
  return h >= 23 || h < 7;
}

function wake() {
  lastInteract = Date.now();
  if (sleeping()) {
    body.classList.remove('mood-sleep');
    updateMood();
  }
}

function updateMood() {
  const lims = (state && state.usage && state.usage.limits) || [];
  const s = lims.find((l) => l.key === 'five_hour');
  const w = lims.find((l) => l.key === 'seven_day');
  let u = s ? s.utilization : 0;
  if (w && w.utilization >= 100) u = 100;
  let m = 'happy';
  if (u >= 100) m = 'exhausted';
  else if (u >= 90) m = 'panic';
  else if (u >= 75) m = 'worried';
  else if (u >= 50) m = 'ok';
  const angry = !!(state && state.life && state.life.angryUntil > Date.now());
  if (angry) m = 'angry';
  else if ((state && state.pet && (state.pet.napUntil || 0) > Date.now()) || (isNight() && Date.now() - lastInteract > 60000 && Date.now() - lastCursorMove > 60000)) m = 'sleep';

  const before = [...body.classList].find((c) => c.startsWith('mood-'));
  for (const c of [...body.classList]) if (c.startsWith('mood-')) body.classList.remove(c);
  body.classList.add('mood-' + m);
  // Cambio de ánimo: un pequeño "reacomodo" en vez de un salto seco de una cara a otra.
  if (before && before !== 'mood-' + m && !body.classList.contains('reduced') && !dragging) {
    chick.animate([{ scale: '1 1' }, { scale: '1.04 0.96' }, { scale: '1 1' }], { duration: 320, easing: 'ease-out' });
  }
  body.classList.toggle('hungry', !!(state && state.pet.fullness < 25));
  if (state && state.pet.fullness < 25) body.classList.add('mood-hungry');
}

// Temporada según la fecha (disfraces automáticos).
function seasonOf(d = new Date()) {
  const m = d.getMonth() + 1, day = d.getDate();
  if ((m === 12 && day === 31) || (m === 1 && day === 1)) return 'newyear';
  if ((m === 12 && day >= 15) || (m === 1 && day <= 6)) return 'xmas';
  if ((m === 10 && day >= 25) || (m === 11 && day <= 1)) return 'halloween';
  if (m === 2 && day === 14) return 'valentine';
  return '';
}
function isBirthday() {
  const born = state && state.pet && state.pet.born;
  if (!born) return false;
  const b = new Date(born), n = new Date();
  return n.getFullYear() > b.getFullYear() && b.getMonth() === n.getMonth() && b.getDate() === n.getDate();
}

// Evolución, accesorios, colores, necesidades y temporada según el estado.
const SLOTS = ['head', 'face', 'neck', 'back', 'skin', 'buddy'];
const SPECIES = ['chick', 'duck', 'cat', 'penguin'];
function updateLook() {
  if (!state) return;
  const p = state.pet || {};
  body.classList.toggle('dirty', (p.clean ?? 100) < 35);
  body.classList.toggle('sick', !!p.sick);
  body.classList.toggle('tired', (p.energy ?? 100) < 25 && !p.sick);
  body.classList.toggle('napping', (p.napUntil || 0) > Date.now());
  const season = seasonOf();
  for (const s of ['xmas', 'halloween', 'newyear', 'valentine']) body.classList.toggle('season-' + s, season === s);
  body.classList.toggle('birthday', isBirthday());
  body.classList.toggle('focus-mode', !!state.focusMode);
  const stage = (state.stage && state.stage.id) || 'chick';
  body.classList.toggle('stage-young', stage === 'young');
  body.classList.toggle('stage-rooster', stage === 'rooster');
  for (const c of [...body.classList]) if (/^(acc-|skin-|has-)/.test(c)) body.classList.remove(c);
  // Rasgos que salen de cómo trabajas y vacaciones (2.0)
  for (const c of [...body.classList]) if (c.startsWith('trait-')) body.classList.remove(c);
  for (const t of ((state.soul && state.soul.traits) || [])) body.classList.add('trait-' + t.id);
  const vac = state.soul && state.soul.vacation;
  body.classList.toggle('on-vacation', !!vac);
  if (vac) {
    $('#away-emoji').textContent = vac.emoji;
    const back = new Date(vac.until).toLocaleDateString(state.lang === 'en' ? 'en' : 'es', { weekday: 'long' });
    $('#away-sign').textContent = state.lang === 'en' ? `On vacation · back ${back}` : `De vacaciones · vuelvo el ${back}`;
  }
  const style = (state.settings && state.settings.petStyle) || 'normal';
  for (const x of ['pixel', 'clay', 'minimal']) body.classList.toggle('style-' + x, style === x);
  const sp = SPECIES.includes(p.species) ? p.species : 'chick';
  for (const x of SPECIES) body.classList.toggle('species-' + x, sp === x);
  const eq = state.equipped || {};
  for (const slot of SLOTS) {
    const id = eq[slot];
    if (!id) continue;
    if (slot === 'skin') body.classList.add(id);
    else body.classList.add('acc-' + id, 'has-' + slot);
  }
}

function updateMeter() {
  updateLook();
  const st = state && state.settings;
  body.classList.toggle('reduced', !!(st && st.reducedMotion));
  // Contador de avisos sin leer (clic en el medidor → centro de avisos).
  const unread = (state && state.unread) || 0;
  const badge = $('#unread');
  badge.textContent = unread > 9 ? '9+' : String(unread);
  badge.classList.toggle('hidden', !unread);
  if (pomo && pomo.endsAt) {
    const left = Math.max(0, Math.round((pomo.endsAt - Date.now()) / 1000));
    const mm = String(Math.floor(left / 60)).padStart(2, '0');
    const ss = String(left % 60).padStart(2, '0');
    meter.className = 'hit ' + (pomo.phase === 'focus' ? 'pomo' : 'pomo-break');
    meterText.textContent = (pomo.phase === 'focus' ? '🍅 ' : '☕ ') + mm + ':' + ss;
    meter.title = pomo.phase === 'focus' ? 'Pomodoro en curso' : 'Descanso';
    return;
  }
  const lv = (state && state.level && state.level.level) || 1;
  body.classList.toggle('lvl3', lv >= 3);
  body.classList.toggle('lvl8', lv >= 8);
  const u = state && state.usage;
  const lims = (u && u.limits) || [];
  const s = lims.find((l) => l.key === 'five_hour');
  meter.className = 'hit';
  if (s) {
    const p = Math.round(s.utilization);
    meterText.textContent = `${state.trackingPausedUntil ? '⏸️ ' : ''}${state.muted ? '🔕 ' : ''}5 h · ${p}%`;
    meter.classList.add(p >= 90 ? 'lvl-max' : p >= 75 ? 'lvl-high' : p >= 50 ? 'lvl-mid' : 'lvl-ok');
    meter.title = lims.map((l) => `${l.label}: ${Math.round(l.utilization)}%`).join('\n');
  } else if (u && u.local && u.local.today.messages) {
    meterText.textContent = state.lang === "en" ? `today · ${u.local.today.messages} msgs` : `hoy · ${u.local.today.messages} msj`;
    meter.title = 'Sin conexión a la cuenta: mostrando registros locales';
  } else {
    meterText.textContent = (state && state.muted ? '🔕 ' : '') + ((state && state.pet.name) || 'PM');
    meter.title = 'Haz clic en el pollito para abrir el panel';
  }
}

$('#away').addEventListener('click', () => pm.openPanel('pet#soul-postcards'));
meter.addEventListener('click', () => pm.openPanel(state && state.unread ? 'inbox' : 'usage'));

// ---------- Eventos desde el proceso principal ----------
pm.onState((s) => {
  state = s;
  updateMood();
  updateMeter();
});
pm.onSay(say);
// Pomodoro: bandana y cuenta atrás en el medidor.
let pomo = null;
pm.onPomo((p) => {
  pomo = p;
  body.classList.toggle('pomo-focus', !!(p && p.phase === 'focus'));
  body.classList.toggle('pomo-break', !!(p && p.phase === 'break'));
  updateMeter();
});
setInterval(() => { if (pomo) updateMeter(); }, 1000);

// Claude Code trabajando: burbuja de "pensando".
pm.onClaude((c) => {
  body.classList.toggle('claude-working', !!(c && c.working));
  keepThinkingInside();
});
// El globo de "pensando" va a la derecha del pollito; si al pasear se saldría de la ventana,
// se corre lo justo hacia dentro (se revisa en cada cuadro mientras está visible).
let thinkRaf = 0;
function keepThinkingInside() {
  cancelAnimationFrame(thinkRaf);
  const el = $('#thinking');
  const loop = () => {
    if (!body.classList.contains('claude-working')) { el.style.translate = ''; return; }
    el.style.translate = '';
    const r = el.getBoundingClientRect();
    const pad = 4;
    let dx = 0;
    if (r.right > innerWidth - pad) dx = innerWidth - pad - r.right;
    if (r.left + dx < pad) dx = pad - r.left;
    if (dx) el.style.translate = `${Math.round(dx)}px 0`;
    thinkRaf = requestAnimationFrame(loop);
  };
  loop();
}

pm.onMeeting((m) => {
  body.classList.toggle('meeting', !!m);
  if (m) particle('🎧', 128, 55, { size: 20, d: 1.8 });
});
pm.onFocus((f) => {
  const distracted = f.cat === 'distraction';
  const wasJudging = body.classList.contains('judging');
  body.classList.toggle('judging', distracted);
  body.classList.toggle('fuming', distracted && f.scoldLevel >= 2);
  body.classList.toggle('bored', f.cat === 'idle' && f.idle > 300);
  if (distracted && !wasJudging) act('judge');
});
pm.onAnim(act);

// ---------- Jugar: maíz, pelota y paseo por la barra de tareas ----------
function chickCenter() {
  const r = chick.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height * 0.62 };
}
function toy(emoji, cls, x, y) {
  const el = document.createElement('div');
  el.className = 'toy ' + (cls || '');
  el.textContent = emoji;
  el.style.left = x - 11 + 'px';
  el.style.top = y - 11 + 'px';
  document.body.appendChild(el);
  return el;
}
function throwCorn() {
  wake();
  const c = chickCenter();
  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      const el = toy('🌽', 'corn-drop', c.x + (i - 1) * 14, c.y);
      setTimeout(() => el.remove(), 1400);
    }, i * 180);
  }
  busyUntil = Date.now() + 2500;
}
function playBall() {
  wake();
  busyUntil = Date.now() + 7000;
  const W = window.innerWidth;
  const floor = chick.getBoundingClientRect().bottom - 14;
  // La pelota entra botando por el lado con más espacio…
  const fromLeft = chickCenter().x > W / 2;
  let x = fromLeft ? -20 : W + 20, y = floor - 80, vx = fromLeft ? 2.4 : -2.4, vy = 0, t = 0, kicked = false, bounces = 0;
  const ball = toy('⚽', '', x, y);
  const step = () => {
    t++;
    vy += 0.55;
    x += vx; y += vy;
    if (y > floor - 11) { y = floor - 11; vy = -Math.abs(vy) * 0.62; if (Math.abs(vy) < 1.2) vy = 0; }
    ball.style.left = x - 11 + 'px';
    ball.style.top = y - 11 + 'px';
    ball.style.transform = `rotate(${x * 4}deg)`;
    const c = chickCenter();
    // …el pollito corre hacia ella…
    if (!kicked && t % 12 === 0) {
      const target = Math.max(-55, Math.min(55, posX + (x - c.x) * 0.5));
      body.classList.toggle('left', x < c.x);
      body.classList.add('walking');
      walker.style.transitionDuration = '400ms';
      walker.style.transform = `translateX(${target}px)`;
      posX = target;
    }
    // …y la patea.
    if (!kicked && Math.abs(x - c.x) < 34) {
      kicked = true;
      body.classList.remove('walking');
      act('hop');
      vx = fromLeft ? 3.6 : -3.6; // …y la devuelve por donde vino
      vy = -10;
      chirp();
    }
    // Rebota en los bordes de la ventana un par de veces antes de irse.
    if (kicked && bounces < 2 && (x < 12 || x > W - 12)) { vx = -vx * 0.8; bounces++; }
    if (x < -40 || x > W + 40 || t > 600) {
      ball.remove();
      body.classList.remove('walking');
      setTimeout(() => act('dance'), 200);
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
pm.onPlay((kind) => {
  if (kind === 'corn') throwCorn();
  if (kind === 'ball') playBall();
});
// Paseo: la ventana se mueve desde el proceso principal; aquí solo caminamos.
pm.onStroll((d) => {
  if (d) {
    wake();
    body.classList.add('walking');
    body.classList.toggle('left', d.dir === 'left');
    busyUntil = Date.now() + 60000;
  } else {
    body.classList.remove('walking', 'left');
    busyUntil = Date.now() + 800;
    act('hop', true);
  }
});

pm.getState().then((s) => {
  state = s;
  pomo = s.pomo || null;
  body.classList.toggle('pomo-focus', !!(pomo && pomo.phase === 'focus'));
  body.classList.toggle('claude-working', !!(s.claudeCode && s.claudeCode.working));
  body.classList.toggle('meeting', !!s.meetingNow);
  updateMood();
  updateMeter();
});

setInterval(updateMood, 15000);
setTimeout(blink, 1500);
setTimeout(idle, 4000);
updateTail();

// Modo foco: se pone la cinta de concentración.
pm.onFocusMode((on) => body.classList.toggle('focus-mode', !!on));

// 🎵 Modo música: con auriculares y una coreografía que cambia de paso cada pocos compases.
// Pasos: cabeceo · balanceo lateral · alas arriba · saltitos · giro. Notas musicales flotando.
const DANCE_MOVES = ['dance-bop', 'dance-sway', 'dance-wings', 'dance-hop', 'dance-bop', 'dance-twist'];
let musicTimer = null;
let moveTimer = null;
let moveIdx = 0;
function setMove(name) {
  for (const m of DANCE_MOVES) body.classList.remove(m);
  if (name) body.classList.add(name);
}
function stopDance() {
  clearInterval(musicTimer);
  clearInterval(moveTimer);
  setMove(null);
  body.classList.remove('music');
}
pm.onMusic((m) => {
  const was = body.classList.contains('music');
  if (!m) {
    stopDance();
    chick.title = '';
    if (was) act('wave', true); // saludo al acabar la canción
    return;
  }
  body.classList.add('music');
  chick.title = `🎵 ${m.title}${m.app ? ` · ${m.app}` : ''}`;
  if (was) return; // cambió de canción: sigue bailando
  wake();
  clearInterval(musicTimer);
  clearInterval(moveTimer);
  if (body.classList.contains('reduced')) { setMove('dance-bop'); return; } // accesibilidad: solo cabeceo suave
  moveIdx = Math.floor(Math.random() * DANCE_MOVES.length);
  setMove(DANCE_MOVES[moveIdx]);
  // Cambia de paso cada 4 compases (8 s a 120 ppm).
  moveTimer = setInterval(() => {
    if (document.hidden || dragging || body.classList.contains('walking')) return;
    moveIdx = (moveIdx + 1 + Math.floor(Math.random() * 2)) % DANCE_MOVES.length;
    setMove(DANCE_MOVES[moveIdx]);
  }, 8000);
  musicTimer = setInterval(() => {
    if (!body.classList.contains('music') || document.hidden) return;
    const r = chick.getBoundingClientRect();
    const n = toy(['🎵', '🎶', '♪', '♫'][Math.floor(Math.random() * 4)], 'note-float', r.left + r.width * (0.15 + Math.random() * 0.7), r.top + 18);
    setTimeout(() => n.remove(), 2200);
  }, 1000);
});

// 🥚 Eclosión: el huevo tiembla, se rompe y sale el coleccionable.
pm.onHatch(({ emoji, rarity }) => {
  wake();
  const c = chickCenter();
  const egg = toy('🥚', 'egg-hatch', c.x + 34, c.y + 4);
  setTimeout(() => {
    egg.textContent = '🐣';
    egg.classList.add('cracked');
    const prize = toy(emoji, `prize ${rarity}`, c.x + 34, c.y - 10);
    setTimeout(() => { egg.remove(); prize.remove(); }, 3000);
    act('celebrate');
  }, 1400);
});


// =================== 2.0 · presencia en el escritorio ===================
// Sentado sobre una ventana.
pm.onPerch((p) => body.classList.toggle('perched', !!(p && p.on)));
// CPU al 100%: suda y se abanica.
pm.onPc((p) => {
  const was = body.classList.contains('cpu-hot');
  body.classList.toggle('cpu-hot', !!(p && p.cpuHot));
  if (p && p.cpuHot && !was) particle('🔥', 128, 50, { size: 18, d: 1.6 });
});
// Reacciones al PC (se pueden apagar en Ajustes → Apariencia).
const pcOn = () => !(state && state.settings && state.settings.pcReactions === false);
// Batería baja (sin cargar): se le cierran los ojos y bosteza de vez en cuando.
if (navigator.getBattery) {
  navigator.getBattery().then((b) => {
    const upd = () => {
      const low = pcOn() && !b.charging && b.level <= 0.2;
      const was = body.classList.contains('low-battery');
      body.classList.toggle('low-battery', low);
      if (low && !was) { act('yawn'); particle('🪫', 128, 55, { size: 18, d: 1.8 }); }
    };
    b.addEventListener('levelchange', upd);
    b.addEventListener('chargingchange', upd);
    upd();
  }).catch(() => {});
}
setInterval(() => { if (body.classList.contains('low-battery') && Math.random() < 0.35) act('yawn', true); }, 120000);
// Sin wifi: saca una antena buscando señal.
const netUpd = () => {
  const off = pcOn() && !navigator.onLine;
  body.classList.toggle('offline', off);
  if (off) particle('📶', 128, 55, { size: 16, d: 1.6 });
};
window.addEventListener('online', netUpd);
window.addEventListener('offline', netUpd);
netUpd();
// Clima de tu ciudad: paraguas, bufanda, abanico; gotas o copos de vez en cuando.
let weatherKind = '';
pm.onWeather((w) => {
  weatherKind = (w && !w.error && w.kind) || '';
  for (const k of ['rain', 'snow', 'hot', 'cold']) body.classList.toggle('weather-' + k, weatherKind === k);
});
setInterval(() => {
  if (body.classList.contains('style-minimal') || body.classList.contains('reduced')) return;
  if (weatherKind === 'rain') for (let i = 0; i < 4; i++) particle('💧', rand(40, 160), 10, { size: 12, d: 1.4, delay: i * 0.3 });
  if (weatherKind === 'snow') for (let i = 0; i < 4; i++) particle('❄️', rand(40, 160), 10, { size: 12, d: 2.2, delay: i * 0.4 });
}, 9000);
// Teclea contigo: mientras escribes, él también teclea en su portátil.
pm.onTyping((t) => body.classList.toggle('typing-along', !!(t && t.on)));
// Respiración guiada: se infla (inhala), espera y se desinfla (exhala).
let breathing = null;
pm.onBreathe((b) => {
  if (breathing) return;
  const svg = chick.querySelector('svg');
  const word = $('#breath-word');
  const count = $('#breath-count');
  const en = state && state.lang === 'en';
  const phases = [['in', b.inhale, en ? 'Breathe in' : 'Inhala'], ['hold', b.hold, en ? 'Hold' : 'Aguanta'], ['out', b.exhale, en ? 'Breathe out' : 'Exhala']];
  let cycle = 0;
  let pi = 0;
  let left = 0;
  body.classList.add('breathing');
  hideBubble();
  const next = () => {
    if (pi >= phases.length) { pi = 0; cycle++; }
    if (cycle >= b.cycles) {
      clearInterval(breathing); breathing = null;
      body.classList.remove('breathing', 'breathe-in', 'breathe-out');
      act('love');
      return;
    }
    const [k, secs, label] = phases[pi++];
    left = secs;
    svg.style.transitionDuration = secs + 's';
    if (k !== 'hold') { body.classList.toggle('breathe-in', k === 'in'); body.classList.toggle('breathe-out', k === 'out'); }
    word.textContent = label;
    count.textContent = String(left);
  };
  next();
  breathing = setInterval(() => {
    left--;
    if (left <= 0) next();
    else count.textContent = String(left);
  }, 1000);
});

// 🏠 De visita: el pollito de un compañero llega caminando, se queda un rato y se va.
const VISIT_COLORS = { chick: ['#ffe066', '#d99a14', '#ff9f1c'], duck: ['#fbfaf5', '#c9bfa8', '#ff9f1c'], cat: ['#f6a85c', '#b86b27', '#ff7b9c'], penguin: ['#3d4352', '#22262f', '#ffb020'] };
let visitTimer = null;
pm.onVisitor((v) => {
  const [fill, line, beak] = VISIT_COLORS[v.species] || VISIT_COLORS.chick;
  const belly = v.species === 'penguin' ? '<ellipse cx="25" cy="32" rx="10" ry="11" fill="#fff"/>' : '';
  const ears = v.species === 'cat' ? `<path d="M12 18 l2 -10 l8 7z M38 18 l-2 -10 l-8 7z" fill="${fill}" stroke="${line}" stroke-width="1.2"/>` : '';
  $('#visitor-pet').innerHTML = `<svg viewBox="0 0 50 50" width="54" height="54" aria-label="Visita"><ellipse cx="25" cy="47" rx="12" ry="2.5" fill="#000" opacity=".14"/><path d="M19 42 q-1 5 -4 6 h6z M31 42 q1 5 4 6 h-6z" fill="${beak}"/>${ears}<ellipse cx="25" cy="29" rx="16" ry="16" fill="${fill}" stroke="${line}" stroke-width="1.4"/>${belly}<ellipse cx="19.5" cy="25" rx="2.3" ry="2.8" fill="#3b2f2f"/><ellipse cx="30.5" cy="25" rx="2.3" ry="2.8" fill="#3b2f2f"/><path d="M22 31 q3 -3 6 0 q-3 3 -6 0z" fill="${beak}"/><ellipse cx="14" cy="31" rx="2.8" ry="1.8" fill="#ff9fb0" opacity=".6"/><ellipse cx="36" cy="31" rx="2.8" ry="1.8" fill="#ff9fb0" opacity=".6"/></svg>`;
  $('#visitor-tag').textContent = `${v.petName} · de ${v.name}`;
  body.classList.remove('visit-leaving');
  body.classList.add('visiting');
  clearTimeout(visitTimer);
  visitTimer = setTimeout(() => {
    body.classList.add('visit-leaving');
    visitTimer = setTimeout(() => body.classList.remove('visiting', 'visit-leaving'), 1600);
  }, Math.max(5000, Math.min(120000, v.ms || 45000)));
});
// Pijama tras el ritual de cierre (hasta la mañana).
pm.onPajamas((p) => body.classList.toggle('pajamas', !!(p && p.on)));

// ---------- Soltarle cosas al pollito (enlaces, textos, archivos) ----------
// Su silueta se informa al proceso principal: así su ventana acepta lo que arrastras desde otra
// app aunque normalmente deje pasar los clics (src/main/boot.js → followCursor).
let lastHitbox = '';
function sendHitbox() {
  const r = chick.getBoundingClientRect();
  if (!r.width) return;
  const k = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
  if (k === lastHitbox) return;
  lastHitbox = k;
  pm.hitbox({ x: r.left, y: r.top, w: r.width, h: r.height });
}
setInterval(sendHitbox, 700);
window.addEventListener('resize', sendHitbox);
sendHitbox();

let dropLeave = null;
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  body.classList.add('drop-ready');
  clearTimeout(dropLeave);
  dropLeave = setTimeout(() => body.classList.remove('drop-ready'), 300);
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  body.classList.remove('drop-ready');
  const dt = e.dataTransfer;
  const files = [...(dt.files || [])].map((f) => ({ name: f.name, path: pm.pathForFile(f) }));
  const url = (dt.getData('text/uri-list') || '').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) || '';
  const text = dt.getData('text/plain') || '';
  if (!files.length && !url && !text.trim()) return;
  wake();
  act('eat');
  const r = await pm.petDrop({ files, url, text });
  if (r && r.ok === false) act('sad');
});

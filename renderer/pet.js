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
  clearInterval(typeTimer);
  clearTimeout(hideTimer);
  bubble.classList.remove('hidden', 'out');
  bubble.style.animation = 'none';
  void bubble.offsetWidth;
  bubble.style.animation = '';
  updateTail();
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
    typeTimer = setInterval(() => {
      bubbleText.textContent += chars[i++] || '';
      if (i >= chars.length) {
        clearInterval(typeTimer);
        body.classList.remove('talking');
      }
    }, 26);
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
    hovered.delete(bubble);
    syncIgnore();
  }, 250);
}

bubble.addEventListener('mouseenter', () => clearTimeout(hideTimer));
bubble.addEventListener('mouseleave', () => scheduleHide(3000));
// Clic en el bocadillo (fuera de los botones) → ir a ver el aviso.
let bubbleTarget = null;
bubble.addEventListener('click', (e) => {
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
  const center = 120 + posX; // centro del pollito en la ventana
  bubble.style.setProperty('--tail-x', Math.max(22, Math.min(200, center - 8)) + 'px');
}

// ---------- Arrastrar / clic / caricias ----------
let down = null;
let rubDist = 0;
let rubStart = 0;

chick.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  down = { x: e.screenX, y: e.screenY, moved: false };
  chick.setPointerCapture(e.pointerId);
});

chick.addEventListener('pointermove', (e) => {
  if (!down) return rub(e);
  if (!down.moved && Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4) {
    down.moved = true;
    dragging = true;
    pm.dragStart({ screenX: down.x, screenY: down.y });
    body.classList.add('dragged');
    wake();
  }
  if (down.moved) pm.dragMove({ screenX: e.screenX, screenY: e.screenY });
});

chick.addEventListener('pointerup', (e) => {
  if (!down) return;
  const wasDrag = down.moved;
  down = null;
  try { chick.releasePointerCapture(e.pointerId); } catch { /* ya liberado */ }
  if (wasDrag) {
    dragging = false;
    body.classList.remove('dragged');
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

// Frotar el ratón encima = caricia 💛
function rub(e) {
  const now = Date.now();
  if (now - rubStart > 1800) { rubStart = now; rubDist = 0; }
  rubDist += Math.hypot(e.movementX || 0, e.movementY || 0);
  if (rubDist > 450) {
    rubDist = 0;
    rubStart = now;
    wake();
    pm.petted();
  }
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

  for (const c of [...body.classList]) if (c.startsWith('mood-')) body.classList.remove(c);
  body.classList.add('mood-' + m);
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
pm.onClaude((c) => body.classList.toggle('claude-working', !!(c && c.working)));

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

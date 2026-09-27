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
    let t = actx.currentTime + 0.01;
    for (const [f1, f2, d] of notes) {
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = kind === 'angry' ? 'sawtooth' : 'sine';
      o.frequency.setValueAtTime(f1, t);
      o.frequency.exponentialRampToValueAtTime(f2, t + d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(kind === 'angry' ? 0.05 : 0.1, t + 0.012);
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

function say({ text, anim, ms, quiet }) {
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
  const chars = [...text];
  let i = 0;
  body.classList.add('talking');
  typeTimer = setInterval(() => {
    bubbleText.textContent += chars[i++] || '';
    if (i >= chars.length) {
      clearInterval(typeTimer);
      body.classList.remove('talking');
    }
  }, 26);
  if (anim) act(anim, !!quiet);
  else if (!quiet) chirp('pio');
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
bubble.addEventListener('click', () => {
  pm.openPanel('chat');
  hideBubble();
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

function idle() {
  if (!dragging && !sleeping() && Date.now() > busyUntil) {
    const mood = [...body.classList].find((c) => c.startsWith('mood-')) || 'mood-happy';
    const hungry = body.classList.contains('hungry');
    let pool = ['look', 'peck', 'flap', 'hop', 'look', 'wobble', 'dance'];
    if (mood === 'mood-panic') pool = ['alert', 'look', 'flap', 'alert'];
    if (mood === 'mood-worried') pool = ['look', 'peck', 'wobble', 'look'];
    if (mood === 'mood-exhausted') pool = ['look', 'sad', 'wobble'];
    if (hungry) pool.push('sad', 'peck', 'peck');
    if (mood === 'mood-angry') pool = ['angry', 'look', 'angry', 'wobble'];
    if (body.classList.contains('judging')) pool = body.classList.contains('fuming') ? ['angry', 'judge', 'angry'] : ['judge', 'judge', 'look'];
    if (body.classList.contains('bored')) pool = ['yawn', 'look', 'sad', 'yawn'];
    const still = mood === 'mood-angry' || body.classList.contains('judging') || body.classList.contains('meeting') || body.classList.contains('pomo-focus');
    if (body.classList.contains('meeting')) pool = ['look', 'peck', 'look'];
    if (!still && Math.random() < 0.35) wander();
    else act(pick(pool), true);
  }
  setTimeout(idle, rand(4500, 10000));
}

// Zzz mientras duerme
setInterval(() => {
  if (sleeping()) particle('z', rand(100, 115), rand(55, 70), { cls: 'zzz', size: rand(12, 18) });
}, 1400);

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
  else if (isNight() && Date.now() - lastInteract > 60000 && Date.now() - lastCursorMove > 60000) m = 'sleep';

  for (const c of [...body.classList]) if (c.startsWith('mood-')) body.classList.remove(c);
  body.classList.add('mood-' + m);
  body.classList.toggle('hungry', !!(state && state.pet.fullness < 25));
  if (state && state.pet.fullness < 25) body.classList.add('mood-hungry');
}

// Evolución, accesorios y colores según el estado.
const SLOTS = ['head', 'face', 'neck', 'back', 'skin'];
function updateLook() {
  if (!state) return;
  const stage = (state.stage && state.stage.id) || 'chick';
  body.classList.toggle('stage-young', stage === 'young');
  body.classList.toggle('stage-rooster', stage === 'rooster');
  for (const c of [...body.classList]) if (/^(acc-|skin-|has-)/.test(c)) body.classList.remove(c);
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
    meterText.textContent = `${state.muted ? '🔕 ' : ''}5 h · ${p}%`;
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

meter.addEventListener('click', () => pm.openPanel('usage'));

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

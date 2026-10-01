// Minijuegos del pollito: "Atrapa el maíz", "Aplasta los bugs" y "La viborita".
// Cada partida da maíz, suma al pase de temporada y guarda tu récord (que ve tu equipo).
const cv = document.getElementById('c');
const g = cv.getContext('2d');
const W = cv.width;
const H = cv.height;
const $ = (id) => document.getElementById(id);

const GAMES = {
  corn: { title: '🎮 Atrapa el maíz', intro: 'Mueve el pollito con el ratón o las flechas.<br>Atrapa 🌽 (+1) y ⭐ (+5). Esquiva las 🪨 (−3).<br>Cada grano es maíz para la tienda.', time: 45 },
  bugs: { title: '🐞 Aplasta los bugs', intro: 'Haz clic en los 🐞 antes de que se escondan (+1).<br>Los 🔥 bugs críticos valen +3. ¡No aplastes las ✨ features (−2)!', time: 30 },
  snake: { title: '🐍 La viborita', intro: 'Flechas o WASD para girar. Come 🌽 para crecer.<br>No choques con las paredes ni contigo.', time: 0 },
};
let mode = new URLSearchParams(location.search).get('mode') || '';
let keys = {};
let running = false;
let last = 0;
let score = 0;
let timeLeft = 0;
let pops = [];
let lang = 'es';

// ---------- comunes ----------
window.addEventListener('keydown', (e) => {
  keys[e.key] = true;
  if (e.key === 'Escape') { if (running || !mode) pm.gameClose(); else showMenu(); }
  if (mode === 'snake' && running) snakeKey(e.key);
});
window.addEventListener('keyup', (e) => { keys[e.key] = false; });
$('x').addEventListener('click', () => pm.gameClose());
$('play').addEventListener('click', () => start());
$('menu-btn').addEventListener('click', () => { running = false; showMenu(); });
$('menu').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) choose(b.dataset.mode); });
if (pm.onGameMode) pm.onGameMode((m) => { running = false; choose(m); });

function emoji(e, x, y, size, rot = 0) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = '#000'; // los emojis a color heredan la transparencia del relleno anterior
  g.font = `${size}px "Segoe UI Emoji", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(e, 0, 0);
  g.restore();
}
function pop(x, y, pts) { pops.push({ x, y, t: 0.8, txt: pts > 0 ? `+${pts}` : `${pts}` }); }
function drawPops(dt) {
  pops = pops.filter((p) => (p.t -= dt) > 0);
  for (const p of pops) {
    g.globalAlpha = p.t / 0.8;
    g.font = 'bold 16px "Segoe UI", sans-serif';
    g.fillStyle = p.txt.startsWith('+') ? '#1e8a4a' : '#c0392b';
    g.textAlign = 'center';
    g.fillText(p.txt, p.x, p.y - (0.8 - p.t) * 40);
    g.globalAlpha = 1;
  }
}
function drawChick(x, y, r = 24, mouthOpen = false) {
  g.save();
  g.translate(x, y);
  g.fillStyle = 'rgba(0,0,0,.15)';
  g.beginPath(); g.ellipse(0, r + 2, r * 0.9, r * 0.2, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffd84a'; g.strokeStyle = '#d99a14'; g.lineWidth = 2;
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); g.stroke();
  const k = r / 24;
  g.fillStyle = '#2b1d1d';
  g.beginPath(); g.ellipse(-8 * k, -4 * k, 3.5 * k, 4.5 * k, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(8 * k, -4 * k, 3.5 * k, 4.5 * k, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ff9f1c';
  g.beginPath(); g.moveTo(-6 * k, 4 * k); g.quadraticCurveTo(0, (mouthOpen ? 14 : 8) * k, 6 * k, 4 * k); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,143,163,.6)';
  g.beginPath(); g.ellipse(-15 * k, 5 * k, 4 * k, 2.6 * k, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(15 * k, 5 * k, 4 * k, 2.6 * k, 0, 0, Math.PI * 2); g.fill();
  g.restore();
}
function hud() {
  $('score').textContent = mode === 'bugs' ? `🐞 ${score}` : `🌽 ${score}`;
  $('time').textContent = mode === 'snake' ? `🐍 ${snake.length}` : `⏱ ${Math.max(0, Math.ceil(timeLeft))}`;
}

// ---------- menú ----------
async function showMenu() {
  mode = '';
  $('title').textContent = '🎮 Minijuegos';
  $('hud').classList.add('hidden');
  $('menu-btn').classList.add('hidden');
  $('ov').classList.add('hidden');
  $('menu').classList.remove('hidden');
  cv.className = '';
  g.clearRect(0, 0, W, H);
  try {
    const s = await pm.getState();
    const b = (s.game && s.game.bestScores) || {};
    for (const m of Object.keys(GAMES)) $('best-' + m).textContent = b[m] ? `Récord: ${b[m]}` : 'Sin récord';
    const left = s.game ? Math.max(0, 3 - s.game.gamesToday) : 3;
    $('menu-note').textContent = left ? `Tus ${left === 3 ? '3 primeras' : left + ' próximas'} partidas de hoy suman puntos al pase de temporada 🎟️` : 'Hoy ya sumaste al pase: ahora juegas por el maíz y el récord.';
  } catch { /* sin estado */ }
  translate();
}
function choose(m) {
  if (!GAMES[m]) return showMenu();
  mode = m;
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('menu-btn').classList.remove('hidden');
  $('title').textContent = GAMES[m].title;
  $('ov-title').textContent = GAMES[m].title;
  $('ov-text').innerHTML = GAMES[m].intro;
  $('play').textContent = '▶ Jugar';
  $('ov').classList.remove('hidden');
  cv.className = 'm-' + m;
  score = 0;
  timeLeft = GAMES[m].time;
  if (m === 'snake') snakeReset();
  render(0);
  hud();
  translate();
}

function start() {
  score = 0;
  timeLeft = GAMES[mode].time;
  pops = [];
  if (mode === 'corn') cornReset();
  if (mode === 'bugs') bugsReset();
  if (mode === 'snake') snakeReset();
  running = true;
  last = performance.now();
  $('ov').classList.add('hidden');
  requestAnimationFrame(loop);
}
function loop(now) {
  if (!running) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (mode === 'corn') cornStep(dt);
  else if (mode === 'bugs') bugsStep(dt);
  else snakeStep(dt);
  if (!running) return;
  render(dt);
  hud();
  requestAnimationFrame(loop);
}
function render(dt) {
  g.clearRect(0, 0, W, H);
  if (mode === 'corn') cornDraw();
  else if (mode === 'bugs') bugsDraw();
  else if (mode === 'snake') snakeDraw();
  drawPops(dt);
}
async function end(msg) {
  running = false;
  render(0);
  const r = await pm.gameEnd(score, mode);
  const unit = mode === 'bugs' ? 'bugs aplastados' : 'granos';
  $('ov-title').textContent = score >= r.best && score > 0 ? '🏆 ¡Nuevo récord!' : msg;
  $('ov-text').innerHTML = `<b>${score}</b> ${unit} (+${r.corn} 🌽${r.pts ? ` · +${r.pts} 🎟️` : ''}).<br>Récord: ${r.best} · Tienes ${r.coins} 🌽 para la tienda.`;
  $('play').textContent = '🔁 Otra vez';
  $('ov').classList.remove('hidden');
  translate();
}

// ---------- 🌽 atrapa el maíz ----------
let chickX = W / 2;
let items = [];
let spawnT = 0;
cv.addEventListener('mousemove', (e) => { if (mode === 'corn') chickX = Math.max(24, Math.min(W - 24, e.offsetX)); });
function cornReset() { items = []; spawnT = 0; chickX = W / 2; }
function cornSpawn() {
  const r = Math.random();
  const type = r < 0.12 ? 'star' : r < 0.32 ? 'rock' : 'corn';
  const speed = 110 + Math.random() * 90 + (45 - timeLeft) * 4; // cada vez más rápido
  items.push({ type, x: 16 + Math.random() * (W - 32), y: -20, vy: speed, rot: Math.random() * 6 });
}
function cornStep(dt) {
  timeLeft -= dt;
  if (keys.ArrowLeft) chickX = Math.max(24, chickX - 360 * dt);
  if (keys.ArrowRight) chickX = Math.min(W - 24, chickX + 360 * dt);
  spawnT -= dt;
  if (spawnT <= 0) { cornSpawn(); spawnT = Math.max(0.25, 0.7 - (45 - timeLeft) * 0.01); }
  for (const it of items) { it.y += it.vy * dt; it.rot += dt * 2; }
  const cy = H - 34;
  items = items.filter((it) => {
    if (Math.abs(it.x - chickX) < 30 && Math.abs(it.y - cy) < 26) {
      const pts = it.type === 'star' ? 5 : it.type === 'rock' ? -3 : 1;
      score = Math.max(0, score + pts);
      pop(it.x, it.y, pts);
      return false;
    }
    return it.y < H + 30;
  });
  if (timeLeft <= 0) end('⏰ ¡Tiempo!');
}
function cornDraw() {
  for (const it of items) emoji(it.type === 'star' ? '⭐' : it.type === 'rock' ? '🪨' : '🌽', it.x, it.y, it.type === 'corn' ? 22 : 24, it.rot);
  drawChick(chickX, H - 34 + Math.sin(performance.now() / 120) * 2, 24, running);
}

// ---------- 🐞 aplasta los bugs ----------
const HOLES = [];
for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) HOLES.push({ x: 70 + c * 100, y: 70 + r * 95 });
let bugs = [];
let bugT = 0;
let splats = [];
function bugsReset() { bugs = []; bugT = 0.4; splats = []; }
function bugsStep(dt) {
  timeLeft -= dt;
  const t = GAMES.bugs.time - timeLeft; // segundos jugados
  bugT -= dt;
  if (bugT <= 0) {
    const free = HOLES.map((_, i) => i).filter((i) => !bugs.some((b) => b.hole === i));
    if (free.length) {
      const r = Math.random();
      const kind = r < 0.14 ? 'feature' : r < 0.26 ? 'critical' : 'bug';
      const life = Math.max(0.55, 1.25 - t * 0.022) * (kind === 'critical' ? 0.75 : 1);
      bugs.push({ hole: free[Math.floor(Math.random() * free.length)], kind, life, max: life });
    }
    bugT = Math.max(0.28, 0.75 - t * 0.016);
  }
  for (const b of bugs) b.life -= dt;
  bugs = bugs.filter((b) => b.life > 0);
  splats = splats.filter((s) => (s.t -= dt) > 0);
  if (timeLeft <= 0) end('⏰ ¡Tiempo!');
}
cv.addEventListener('mousedown', (e) => {
  if (!running || mode !== 'bugs') return;
  const hit = bugs.find((b) => Math.hypot(HOLES[b.hole].x - e.offsetX, HOLES[b.hole].y - 6 - e.offsetY) < 34);
  if (!hit) return;
  const pts = hit.kind === 'feature' ? -2 : hit.kind === 'critical' ? 3 : 1;
  score = Math.max(0, score + pts);
  const h = HOLES[hit.hole];
  pop(h.x, h.y - 20, pts);
  splats.push({ x: h.x, y: h.y, t: 0.5, good: pts > 0 });
  bugs = bugs.filter((b) => b !== hit);
});
function bugsDraw() {
  for (const h of HOLES) {
    // Cada "agujero" es una pantalla de portátil donde se asoman los bugs.
    g.fillStyle = '#2b2440'; g.strokeStyle = '#3b2f2f'; g.lineWidth = 2.5;
    g.beginPath(); g.roundRect(h.x - 40, h.y - 34, 80, 54, 8); g.fill(); g.stroke();
    g.fillStyle = '#c9bfa8';
    g.beginPath(); g.roundRect(h.x - 46, h.y + 20, 92, 9, 4); g.fill(); g.stroke();
  }
  for (const b of bugs) {
    const h = HOLES[b.hole];
    const k = Math.min(1, (b.max - b.life) / 0.12, b.life / 0.12); // aparece y se esconde
    emoji(b.kind === 'feature' ? '✨' : b.kind === 'critical' ? '🔥' : '🐞', h.x, h.y - 6 + (1 - k) * 18, 30 * Math.max(0.3, k), b.kind === 'bug' ? Math.sin(performance.now() / 90) * 0.2 : 0);
  }
  for (const s of splats) { g.globalAlpha = s.t / 0.5; emoji(s.good ? '💥' : '😵', s.x, s.y - 6, 34); g.globalAlpha = 1; }
}

// ---------- 🐍 la viborita ----------
const CELL = 20;
const COLS = Math.floor(W / CELL);
const ROWS = Math.floor(H / CELL);
let snake = [];
let dir = { x: 1, y: 0 };
let nextDir = dir;
let food = null;
let stepT = 0;
function snakeReset() {
  snake = [{ x: 6, y: 8 }, { x: 5, y: 8 }, { x: 4, y: 8 }];
  dir = { x: 1, y: 0 };
  nextDir = dir;
  stepT = 0;
  placeFood();
}
function placeFood() {
  let p;
  do p = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS), star: Math.random() < 0.1 };
  while (snake.some((s) => s.x === p.x && s.y === p.y));
  food = p;
}
function snakeKey(k) {
  const m = { ArrowUp: [0, -1], w: [0, -1], W: [0, -1], ArrowDown: [0, 1], s: [0, 1], S: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0], ArrowRight: [1, 0], d: [1, 0], D: [1, 0] }[k];
  if (!m) return;
  if (m[0] === -dir.x && m[1] === -dir.y) return; // no se da la vuelta sobre sí misma
  nextDir = { x: m[0], y: m[1] };
}
function snakeStep(dt) {
  stepT -= dt;
  if (stepT > 0) return;
  stepT = Math.max(0.06, 0.15 - score * 0.003);
  dir = nextDir;
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
  if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS || snake.some((s) => s.x === head.x && s.y === head.y)) { end('💥 ¡Choque!'); return; }
  snake.unshift(head);
  if (head.x === food.x && head.y === food.y) {
    const pts = food.star ? 3 : 1;
    score += pts;
    pop(head.x * CELL + CELL / 2, head.y * CELL, pts);
    if (food.star) snake.push({ ...snake[snake.length - 1] }, { ...snake[snake.length - 1] });
    placeFood();
  } else snake.pop();
}
function snakeDraw() {
  g.fillStyle = 'rgba(255,255,255,.18)';
  for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) if ((x + y) % 2) g.fillRect(x * CELL, y * CELL, CELL, CELL);
  if (food) emoji(food.star ? '⭐' : '🌽', food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, 17);
  for (let i = snake.length - 1; i > 0; i--) {
    const s = snake[i];
    g.fillStyle = i % 2 ? '#ffe066' : '#ffd84a'; g.strokeStyle = '#d99a14'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(s.x * CELL + CELL / 2, s.y * CELL + CELL / 2, CELL / 2 - 1.5, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  if (snake[0]) drawChick(snake[0].x * CELL + CELL / 2, snake[0].y * CELL + CELL / 2, 12, running);
}

// ---------- idioma y arranque ----------
function translate() {
  pm.getState().then((s) => { lang = s.lang || 'es'; if (lang !== 'es') I18N.translateDom(document.body, lang); }).catch(() => {});
}
if (GAMES[mode]) choose(mode); else showMenu();

// Minijuego "Atrapa el maíz": 45 segundos, el pollito atrapa lo que cae.
const cv = document.getElementById('c');
const g = cv.getContext('2d');
const W = cv.width;
const H = cv.height;
const $ = (id) => document.getElementById(id);

let chickX = W / 2;
let keys = {};
let items = [];
let score = 0;
let timeLeft = 45;
let running = false;
let last = 0;
let spawnT = 0;
let pops = [];

cv.addEventListener('mousemove', (e) => { chickX = Math.max(24, Math.min(W - 24, e.offsetX)); });
window.addEventListener('keydown', (e) => { keys[e.key] = true; if (e.key === 'Escape') pm.gameClose(); });
window.addEventListener('keyup', (e) => { keys[e.key] = false; });
$('x').addEventListener('click', () => pm.gameClose());
$('play').addEventListener('click', start);

function start() {
  score = 0;
  timeLeft = 45;
  items = [];
  pops = [];
  running = true;
  last = performance.now();
  $('ov').classList.add('hidden');
  requestAnimationFrame(loop);
}

function spawn() {
  const r = Math.random();
  const type = r < 0.12 ? 'star' : r < 0.32 ? 'rock' : 'corn';
  const speed = 110 + Math.random() * 90 + (45 - timeLeft) * 4; // cada vez más rápido
  items.push({ type, x: 16 + Math.random() * (W - 32), y: -20, vy: speed, rot: Math.random() * 6 });
}

function drawChick(x) {
  const y = H - 34;
  g.save();
  g.translate(x, y);
  const bob = Math.sin(performance.now() / 120) * 2;
  g.translate(0, bob);
  g.fillStyle = 'rgba(0,0,0,.15)';
  g.beginPath(); g.ellipse(0, 26, 22, 5, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffd84a'; g.strokeStyle = '#d99a14'; g.lineWidth = 2;
  g.beginPath(); g.arc(0, 0, 24, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#2b1d1d';
  g.beginPath(); g.ellipse(-8, -4, 3.5, 4.5, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(8, -4, 3.5, 4.5, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ff9f1c';
  g.beginPath(); g.moveTo(-6, 4); g.quadraticCurveTo(0, running ? 14 : 8, 6, 4); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,143,163,.6)';
  g.beginPath(); g.ellipse(-15, 5, 4, 2.6, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(15, 5, 4, 2.6, 0, 0, Math.PI * 2); g.fill();
  g.restore();
}

function emoji(e, x, y, size, rot = 0) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.font = `${size}px "Segoe UI Emoji", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(e, 0, 0);
  g.restore();
}

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (running) {
    timeLeft -= dt;
    if (keys.ArrowLeft) chickX = Math.max(24, chickX - 360 * dt);
    if (keys.ArrowRight) chickX = Math.min(W - 24, chickX + 360 * dt);
    spawnT -= dt;
    if (spawnT <= 0) { spawn(); spawnT = Math.max(0.25, 0.7 - (45 - timeLeft) * 0.01); }
    for (const it of items) { it.y += it.vy * dt; it.rot += dt * 2; }
    const cy = H - 34;
    items = items.filter((it) => {
      if (Math.abs(it.x - chickX) < 30 && Math.abs(it.y - cy) < 26) {
        const pts = it.type === 'star' ? 5 : it.type === 'rock' ? -3 : 1;
        score = Math.max(0, score + pts);
        pops.push({ x: it.x, y: it.y, t: 0.8, txt: pts > 0 ? `+${pts}` : `${pts}` });
        return false;
      }
      return it.y < H + 30;
    });
    if (timeLeft <= 0) return end();
  }
  g.clearRect(0, 0, W, H);
  for (const it of items) emoji(it.type === 'star' ? '⭐' : it.type === 'rock' ? '🪨' : '🌽', it.x, it.y, it.type === 'corn' ? 22 : 24, it.rot);
  drawChick(chickX);
  pops = pops.filter((p) => (p.t -= dt) > 0);
  for (const p of pops) {
    g.globalAlpha = p.t / 0.8;
    g.font = 'bold 16px "Segoe UI", sans-serif';
    g.fillStyle = p.txt.startsWith('+') ? '#1e8a4a' : '#c0392b';
    g.textAlign = 'center';
    g.fillText(p.txt, p.x, p.y - (0.8 - p.t) * 40);
    g.globalAlpha = 1;
  }
  $('score').textContent = `🌽 ${score}`;
  $('time').textContent = `⏱ ${Math.max(0, Math.ceil(timeLeft))}`;
  if (running) requestAnimationFrame(loop);
}

async function end() {
  running = false;
  const r = await pm.gameEnd(score);
  $('ov-title').textContent = score >= r.best && score > 0 ? '🏆 ¡Nuevo récord!' : '⏰ ¡Tiempo!';
  $('ov-text').innerHTML = `Atrapaste <b>${score}</b> granos (+${score} 🌽).<br>Récord: ${r.best} · Tienes ${r.coins} 🌽 para la tienda.`;
  $('play').textContent = '🔁 Otra vez';
  $('ov').classList.remove('hidden');
  translate();
}

// Pantalla inicial
function translate() {
  pm.getState().then((s) => { if (s.lang && s.lang !== 'es') I18N.translateDom(document.body, s.lang); }).catch(() => {});
}
g.clearRect(0, 0, W, H);
drawChick(W / 2);
translate();

// Física del pollito (pulido 2/6): si lo lanzas, vuela, rebota en los bordes de la pantalla y cae
// hasta la barra de tareas; si lo sueltas despacio, se queda donde lo dejaste. Lógica pura.

const GRAVITY = 3000; // px/s²
const THROW_SPEED = 700; // px/s: por encima, es un lanzamiento
const WALL_BOUNCE = 0.55;
const FLOOR_BOUNCE = 0.35;
const FLOOR_FRICTION = 6; // 1/s: frena al rodar por el suelo
const MAX_SPEED = 4500;

/** Velocidad (px/s) de las últimas muestras de arrastre [{ t, x, y }] (ventana de 90 ms). */
function velocityFrom(samples, now = samples.length ? samples[samples.length - 1].t : 0) {
  const recent = samples.filter((s) => now - s.t <= 90);
  if (recent.length < 2) return { vx: 0, vy: 0 };
  const a = recent[0];
  const b = recent[recent.length - 1];
  const dt = Math.max(0.008, (b.t - a.t) / 1000);
  const clamp = (v) => Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v));
  return { vx: clamp((b.x - a.x) / dt), vy: clamp((b.y - a.y) / dt) };
}
const isThrow = ({ vx, vy }) => Math.hypot(vx, vy) >= THROW_SPEED;

/**
 * Límites para la ventana del pollito (w×h) en un área de trabajo: el pollito ocupa el centro
 * de su ventana, así que la ventana puede salirse un poco para que él toque el borde.
 */
function boundsFor(wa, w, h) {
  return { left: wa.x - w * 0.25, right: wa.x + wa.width - w * 0.75, top: wa.y - h * 0.4, floor: wa.y + wa.height - h };
}

/** Un paso de simulación (dt en s). Devuelve el estado nuevo y los choques: [{ kind: 'wall'|'floor', speed }]. */
function step(s, dt, b) {
  const hits = [];
  let { x, y, vx, vy } = s;
  vy += GRAVITY * dt;
  x += vx * dt;
  y += vy * dt;
  if (x < b.left) { x = b.left; if (Math.abs(vx) > 60) hits.push({ kind: 'wall', speed: Math.abs(vx) }); vx = Math.abs(vx) * WALL_BOUNCE; }
  if (x > b.right) { x = b.right; if (Math.abs(vx) > 60) hits.push({ kind: 'wall', speed: Math.abs(vx) }); vx = -Math.abs(vx) * WALL_BOUNCE; }
  if (y < b.top) { y = b.top; vy = Math.abs(vy) * WALL_BOUNCE; }
  let onFloor = false;
  if (y >= b.floor) {
    y = b.floor;
    if (vy > 160) hits.push({ kind: 'floor', speed: vy });
    vy = vy > 160 ? -vy * FLOOR_BOUNCE : 0;
    onFloor = vy === 0;
    if (onFloor) vx *= Math.max(0, 1 - FLOOR_FRICTION * dt);
  }
  const rest = onFloor && Math.abs(vx) < 25;
  return { s: { x, y, vx: rest ? 0 : vx, vy }, hits, rest };
}

/** Simula todo el vuelo (para tests y para saber cuánto dura). */
function simulate(start, b, { dt = 1 / 60, maxS = 5 } = {}) {
  let s = { ...start };
  const events = [];
  for (let t = 0; t < maxS; t += dt) {
    const r = step(s, dt, b);
    s = r.s;
    for (const h of r.hits) events.push({ ...h, t });
    if (r.rest) return { end: s, events, t };
  }
  return { end: { ...s, y: b.floor, vx: 0, vy: 0 }, events, t: maxS };
}

module.exports = { GRAVITY, THROW_SPEED, velocityFrom, isThrow, boundsFor, step, simulate };

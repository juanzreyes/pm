// Rachas, logros, evolución y tienda de accesorios del pollito.
const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ---------- Evolución por nivel ----------
const STAGES = [
  { from: 1, id: 'chick', name: 'Pollito' },
  { from: 5, id: 'young', name: 'Pollo joven' },
  { from: 10, id: 'rooster', name: 'Gallo' },
];
function stageOf(level) {
  let s = STAGES[0];
  for (const x of STAGES) if (level >= x.from) s = x;
  return s;
}

// ---------- Tienda (se paga con maíz 🌽, que ganas con XP y logros) ----------
const SHOP = [
  { id: 'glasses-sun', slot: 'face', name: 'Gafas de sol', emoji: '🕶️', price: 120 },
  { id: 'glasses-nerd', slot: 'face', name: 'Gafas de nerd', emoji: '🤓', price: 90 },
  { id: 'hat-party', slot: 'head', name: 'Gorro de fiesta', emoji: '🥳', price: 100 },
  { id: 'hat-cowboy', slot: 'head', name: 'Sombrero vaquero', emoji: '🤠', price: 180 },
  { id: 'hat-cap', slot: 'head', name: 'Gorra dev', emoji: '🧢', price: 110 },
  { id: 'hat-wizard', slot: 'head', name: 'Sombrero de mago', emoji: '🧙', price: 260 },
  { id: 'neck-scarf', slot: 'neck', name: 'Bufanda', emoji: '🧣', price: 130 },
  { id: 'neck-tie', slot: 'neck', name: 'Corbata de jefe', emoji: '👔', price: 150 },
  { id: 'back-cape', slot: 'back', name: 'Capa de héroe', emoji: '🦸', price: 300 },
  { id: 'skin-blue', slot: 'skin', name: 'Plumas azul pastel', emoji: '💙', price: 250 },
  { id: 'skin-pink', slot: 'skin', name: 'Plumas rosadas', emoji: '🩷', price: 250 },
  { id: 'skin-mint', slot: 'skin', name: 'Plumas menta', emoji: '💚', price: 250 },
  { id: 'skin-gold', slot: 'skin', name: 'Plumas doradas', emoji: '✨', price: 600 },
];

// ---------- Logros ----------
// Cada uno: { id, emoji, name, desc, reward (maíz), test(ctx) }
// ctx = { data, level, todayKey, chatCount }
const sum = (data, fn) => Object.values(data.days || {}).reduce((a, d) => a + (fn(d) || 0), 0);
const anyDay = (data, fn) => Object.values(data.days || {}).some(fn);

const ACHIEVEMENTS = [
  { id: 'first-daily', emoji: '🐣', name: 'Primer daily', desc: 'Haz tu primer daily', reward: 20, test: (c) => anyDay(c.data, (d) => d.standup) },
  { id: 'streak-3', emoji: '🔥', name: 'Racha x3', desc: '3 días laborables seguidos con daily', reward: 40, test: (c) => c.streaks.daily >= 3 },
  { id: 'streak-5', emoji: '🔥', name: 'Semana completa', desc: '5 días laborables seguidos con daily', reward: 80, test: (c) => c.streaks.daily >= 5 },
  { id: 'streak-10', emoji: '☄️', name: 'Imparable', desc: '10 días laborables seguidos con daily', reward: 150, test: (c) => c.streaks.daily >= 10 },
  { id: 'perfect-day', emoji: '🏆', name: 'Día perfecto', desc: 'Cumple el 100% de tus tareas (mínimo 3)', reward: 50, test: (c) => anyDay(c.data, (d) => d.standup && d.standup.today.length >= 3 && d.standup.today.every((t) => t.done)) },
  { id: 'early-bird', emoji: '🌅', name: 'Madrugador', desc: 'Haz el daily antes de las 8:15', reward: 30, test: (c) => anyDay(c.data, (d) => d.standup && d.standup.at && new Date(d.standup.at).getHours() * 60 + new Date(d.standup.at).getMinutes() < 8 * 60 + 15) },
  { id: 'tomato-4', emoji: '🍅', name: 'Tomatero', desc: '4 pomodoros en un día', reward: 40, test: (c) => anyDay(c.data, (d) => (d.pomodoros || 0) >= 4) },
  { id: 'tomato-50', emoji: '🥫', name: 'Salsa de tomate', desc: '50 pomodoros en total', reward: 150, test: (c) => sum(c.data, (d) => d.pomodoros) >= 50 },
  { id: 'zero-distraction', emoji: '🧘', name: 'Cero distracciones', desc: 'Un día con +2 h de trabajo y menos de 5 min distraído', reward: 60, test: (c) => anyDay(c.data, (d) => d.focus && d.focus.work >= 7200 && d.focus.distraction < 300) },
  { id: 'deep-work', emoji: '🧠', name: 'Trabajo profundo', desc: '6 h de trabajo enfocado en un día', reward: 60, test: (c) => anyDay(c.data, (d) => d.focus && d.focus.work >= 6 * 3600) },
  { id: 'commits-10', emoji: '📦', name: 'Commitero', desc: '10 commits en un día', reward: 40, test: (c) => anyDay(c.data, (d) => (d.commits || 0) >= 10) },
  { id: 'commits-100', emoji: '🚀', name: 'Centenario', desc: '100 commits en total', reward: 150, test: (c) => sum(c.data, (d) => d.commits) >= 100 },
  { id: 'claude-duo', emoji: '🤖', name: 'Dúo con Claude', desc: '10 tareas de Claude Code en un día', reward: 50, test: (c) => anyDay(c.data, (d) => (d.claudeTasks || 0) >= 10) },
  { id: 'chatty', emoji: '💬', name: 'Charlatán', desc: 'Envía 100 mensajes al pollito', reward: 30, test: (c) => c.chatCount >= 100 },
  { id: 'bff', emoji: '💛', name: 'Mejores amigos', desc: 'Llega a 100 de felicidad', reward: 30, test: (c) => (c.data.pet.happiness || 0) >= 99.5 },
  { id: 'level-5', emoji: '🐥', name: 'Evolución', desc: 'Llega a nivel 5 (pollo joven)', reward: 80, test: (c) => c.level >= 5 },
  { id: 'level-10', emoji: '🐓', name: '¡Soy un gallo!', desc: 'Llega a nivel 10', reward: 200, test: (c) => c.level >= 10 },
  { id: 'gamer', emoji: '🎮', name: 'Gamer', desc: 'Consigue 30 puntos en el minijuego', reward: 40, test: (c) => (c.data.pet.bestScore || 0) >= 30 },
  { id: 'shopper', emoji: '🛍️', name: 'Fashionista', desc: 'Compra 3 accesorios', reward: 50, test: (c) => (c.data.pet.owned || []).length >= 3 },
];

/** Racha de días laborables consecutivos con daily (hoy cuenta si ya lo hiciste). */
function streaks(data) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  let daily = 0;
  let perfect = 0;
  let perfectAlive = true;
  const today = data.days[key(d)];
  if (!(today && today.standup)) d.setDate(d.getDate() - 1); // hoy aún no rompe la racha
  for (let i = 0; i < 400; i++) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      const v = data.days[key(d)];
      if (!v || !v.standup) break;
      daily++;
      const t = v.standup.today || [];
      if (perfectAlive && t.length && t.every((x) => x.done)) perfect++;
      else perfectAlive = false;
    }
    d.setDate(d.getDate() - 1);
  }
  return { daily, perfect };
}

module.exports = { STAGES, stageOf, SHOP, ACHIEVEMENTS, streaks };

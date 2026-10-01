// Presencia en el escritorio (2.0): el pollito vive sobre tus ventanas, reacciona a tu PC
// (CPU al 100%), al clima de tu ciudad, teclea contigo y respira contigo.
// (La batería y el wifi los mira la propia ventana del pollito: navigator.getBattery / onLine.)
// Parte del proceso principal. `M` es el contexto compartido de la app.
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  const set = () => M.store.data.settings;
  const send = (ch, d) => M.sendPet(ch, d);

  // =====================================================================
  // 🪟 SOBRE TUS VENTANAS
  // =====================================================================
  let perched = null; // { key, x, y }
  let candidate = null; // { key, rect, n }
  let pausedUntil = 0;
  let tween = null;
  const perchOn = () => !M.TEST && set().petPerch !== false && !set().discreet && !M.presenting && !M.drag && !M.SAFE && Date.now() > pausedUntil && !(M.store.data.pet || {}).vacation;

  /** Dónde se sienta: sobre la barra de título, a un cuarto del borde izquierdo (lejos de los botones). */
  function perchSpot(r) {
    const b = M.petWin.getBounds();
    const f = b.width / M.PET_W;
    const x = Math.round(Math.min(r.x + r.width - b.width - 140 * f, r.x + Math.max(40 * f, r.width * 0.22)));
    const feet = Math.round(36 * f); // del borde inferior de la ventana del pollito a sus patas
    const y = Math.round(r.y - b.height + feet + 4 * f);
    return { x, y };
  }
  function moveTo(x, y, hop) {
    if (!M.petWin || M.petWin.isDestroyed()) return;
    clearInterval(tween);
    const [sx, sy] = M.petWin.getPosition();
    const steps = hop ? 22 : 10;
    let i = 0;
    if (hop) send('pet:anim', 'hop');
    tween = setInterval(() => {
      i++;
      const t = i / steps;
      const e = 1 - Math.pow(1 - t, 3);
      const arc = hop ? Math.sin(Math.PI * t) * 60 : 0; // salto en parábola
      if (!M.petWin || M.petWin.isDestroyed()) return clearInterval(tween);
      M.petWin.setPosition(Math.round(sx + (x - sx) * e), Math.round(sy + (y - sy) * e - arc));
      if (i >= steps) clearInterval(tween);
    }, 16);
  }
  function goHome() {
    if (!perched) return;
    perched = null;
    send('pet:perch', { on: false });
    const p = M.store.data.position;
    if (p) moveTo(p.x, p.y, true);
  }
  /** Cada muestra del vigilante (5 s): ¿hay una ventana nueva donde sentarse? */
  function onSample(s) {
    if (!M.petWin || M.petWin.isDestroyed()) return;
    if (!perchOn()) { if (perched) goHome(); candidate = null; return; }
    const proc = String(s.p || '').toLowerCase();
    if (/^(electron|pm pollito)$/.test(proc)) return; // tocaste al pollito o sus ventanas: se queda donde está
    const parts = String(s.wr || '').split(',').map(Number);
    if (parts.length !== 5 || parts.some((n) => Number.isNaN(n)) || parts[4] === 1) { if (perched) goHome(); candidate = null; return; } // sin ventana o maximizada
    let r;
    try { r = M.screen.screenToDipRect(null, { x: parts[0], y: parts[1], width: parts[2] - parts[0], height: parts[3] - parts[1] }); } catch { r = { x: parts[0], y: parts[1], width: parts[2] - parts[0], height: parts[3] - parts[1] }; }
    const wa = M.screen.getDisplayMatching(r).workArea;
    const spot = perchSpot(r);
    if (spot.y < wa.y - 10 || spot.x < wa.x - 40) { if (perched) goHome(); candidate = null; return; } // no cabe encima
    const key = `${proc}|${Math.round(r.x / 8)}|${Math.round(r.y / 8)}|${Math.round(r.width / 8)}`;
    if (perched && perched.key === key) return;
    // La misma ventana movida: la sigue sin saltar. Otra ventana: espera a que se quede quieta (2 muestras).
    if (perched && perched.proc === proc && Math.abs(perched.w - r.width) < 16) { perched = { key, proc, w: r.width }; moveTo(spot.x, spot.y, false); return; }
    if (!candidate || candidate.key !== key) { candidate = { key, n: 1 }; return; }
    candidate = null;
    perched = { key, proc, w: r.width };
    send('pet:perch', { on: true });
    moveTo(spot.x, spot.y, true);
  }
  /** Lo arrastraste tú: se queda donde lo dejaste 30 min. */
  function onDragged() {
    if (!perched && !candidate) return;
    perched = null;
    candidate = null;
    pausedUntil = Date.now() + 30 * 60e3;
    send('pet:perch', { on: false });
  }

  // =====================================================================
  // 🔥 CPU AL 100%
  // =====================================================================
  let lastCpu = null;
  let hotCount = 0;
  let hot = false;
  function cpuUsage() {
    const cpus = M.os.cpus();
    const t = cpus.reduce((a, c) => { for (const [k, v] of Object.entries(c.times)) a[k] = (a[k] || 0) + v; return a; }, {});
    const total = Object.values(t).reduce((a, b) => a + b, 0);
    const prev = lastCpu;
    lastCpu = { total, idle: t.idle };
    if (!prev) return 0;
    const dt = total - prev.total;
    return dt > 0 ? Math.round(100 * (1 - (t.idle - prev.idle) / dt)) : 0;
  }
  function cpuTick() {
    if (set().pcReactions === false) { if (hot) { hot = false; send('pet:pc', { cpuHot: false }); } return; }
    const u = cpuUsage();
    hotCount = u >= 90 ? hotCount + 1 : 0;
    const now = hotCount >= 2; // 30 s seguidos
    if (now !== hot) { hot = now; send('pet:pc', { cpuHot: hot, cpu: u }); }
  }

  // =====================================================================
  // ☁️ CLIMA (Open-Meteo, sin clave; solo si pones tu ciudad)
  // =====================================================================
  let weather = null; // { kind, temp, city, code, at }
  /** Qué ponerse según el tiempo. */
  function weatherKind(code, temp, precip) {
    if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95 || precip > 0.2) return 'rain';
    if (temp >= 30) return 'hot';
    if (temp <= 8) return 'cold';
    return 'mild';
  }
  async function weatherTick(force = false) {
    const city = String(set().weatherCity || '').trim();
    if (!city) { if (weather) { weather = null; send('pet:weather', null); M.broadcast(); } return weather; }
    if (!force && weather && weather.city === city && Date.now() - weather.at < 30 * 60e3) return weather;
    try {
      let geo = set().weatherGeo;
      if (!geo || geo.city !== city) {
        const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=es&format=json`)).json();
        const hit = g && g.results && g.results[0];
        if (!hit) throw new Error(`No encontré "${city}"`);
        geo = set().weatherGeo = { city, lat: hit.latitude, lon: hit.longitude, name: `${hit.name}${hit.country ? ', ' + hit.country : ''}` };
        M.store.save();
      }
      const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,precipitation,weather_code,is_day&timezone=auto`)).json();
      const c = w.current || {};
      weather = { city, place: geo.name, temp: Math.round(c.temperature_2m), code: c.weather_code, kind: weatherKind(c.weather_code, c.temperature_2m, c.precipitation || 0), at: Date.now() };
    } catch (e) {
      weather = { city, error: e.message, kind: 'mild', at: Date.now() };
      M.diag.log('main', 'Clima: ' + e.message);
    }
    send('pet:weather', weather);
    M.broadcast();
    return weather;
  }

  // =====================================================================
  // ⌨️ TECLEA CONTIGO
  // =====================================================================
  // Sin espiar teclas: si hay actividad continua (inactividad 0 s) y el ratón no se mueve, estás escribiendo.
  let lastCursor = '';
  let busyPolls = 0;
  let typing = false;
  let quietPolls = 0;
  function typingTick() {
    if (set().typeAlong === false || M.presenting || !M.petWin || !M.petWin.isVisible()) { if (typing) { typing = false; send('pet:typing', { on: false }); } return; }
    let idle = 99;
    try { idle = require('electron').powerMonitor.getSystemIdleTime(); } catch { /* sin datos */ }
    const c = M.screen.getCursorScreenPoint();
    const k = `${c.x},${c.y}`;
    const still = k === lastCursor;
    lastCursor = k;
    if (idle === 0 && still) { busyPolls++; quietPolls = 0; } else { quietPolls++; if (quietPolls > 2) busyPolls = 0; }
    const now = busyPolls >= 4; // ~1,2 s escribiendo seguido
    if (now && !typing) { typing = true; send('pet:typing', { on: true }); }
    if (!now && typing && quietPolls > 6) { typing = false; send('pet:typing', { on: false }); }
  }

  // =====================================================================
  // 🫁 RESPIRACIÓN GUIADA
  // =====================================================================
  function breathe(cycles = 4) {
    send('pet:breathe', { cycles: Math.max(1, Math.min(10, cycles)), inhale: 4, hold: 2, exhale: 6 });
    M.say('🫁 Respira conmigo: cuando me inflo, inhala; cuando me desinflo, exhala.', 'peck', 6000, { log: false });
    return true;
  }

  function presenceState() {
    return { weather, perched: !!perched, typing };
  }

  function start() {
    if (M.TEST) return;
    setInterval(cpuTick, 15e3);
    setInterval(typingTick, 300);
    setTimeout(() => weatherTick(), 15e3);
    setInterval(() => weatherTick(), 30 * 60e3);
  }

  return { start, onSample, onDragged, goHome, breathe, weatherTick, weatherKind, presenceState, perchSpot };
};

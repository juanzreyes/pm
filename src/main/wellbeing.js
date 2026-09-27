// Bienestar, patrones, niveles, logros, sitios y estadísticas.
// Parte del proceso principal (antes en main.js). `M` es el contexto compartido de la app:
// da acceso a todo lo demás (ventanas, datos, funciones de otros módulos).
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  // ---------- bienestar: señales de agotamiento (últimos 7 días) ----------
  function wellbeingSignals() {
    const pad2 = (n) => String(n).padStart(2, '0');
    const signals = [];
    let longDays = 0, lateDays = 0, weekendWork = 0, workTotal = 0;
    const moods = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const v = M.store.data.days[`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`];
      if (!v) continue;
      const w = (v.focus && v.focus.work) || 0;
      workTotal += w;
      if (w > 8 * 3600) longDays++;
      if ((v.lateWork || 0) > 30 * 60) lateDays++;
      if ((d.getDay() === 0 || d.getDay() === 6) && w > 2 * 3600) weekendWork++;
      if (v.mood) moods.push(v.mood);
    }
    const avgMood = moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : null;
    if (longDays >= 3) signals.push(`${longDays} días de más de 8 h de trabajo`);
    if (lateDays >= 2) signals.push(`${lateDays} noches trabajando después de las 22:00`);
    if (weekendWork) signals.push('trabajaste el fin de semana');
    if (avgMood !== null && moods.length >= 3 && avgMood <= 2.4) signals.push('tu ánimo ha estado bajo');
    return { signals, workHours: workTotal / 3600, avgMood };
  }
  // ---------- cumpleaños del pollito (aniversario del día en que nació) ----------
  function checkBirthday() {
    const p = M.store.data.pet;
    if (!p.born || !p.name) return;
    const b = new Date(p.born), n = new Date();
    const years = n.getFullYear() - b.getFullYear();
    if (years < 1 || b.getMonth() !== n.getMonth() || b.getDate() !== n.getDate() || p.lastBirthday === n.getFullYear()) return;
    p.lastBirthday = n.getFullYear();
    p.coins = (p.coins || 0) + 50;
    p.happiness = 100;
    M.store.save();
    addXp(30);
    M.say(`🎂 ¡HOY CUMPLO ${years} AÑO${years === 1 ? '' : 'S'}! 🎉 Gracias por cuidarme todo este tiempo 💛 (+50 🌽)`, 'celebrate', 15000, { cat: 'pet' });
    M.broadcast();
  }

  function checkWellbeing() {
    const day = M.today();
    const h = new Date().getHours();
    if (day.wellbeingChecked || h < 10 || h >= 20 || M.isMuted() || M.meetingNow) return;
    day.wellbeingChecked = true;
    M.store.save();
    const w = wellbeingSignals();
    if (w.signals.length < 2 && !(w.avgMood !== null && w.avgMood <= 2)) return;
    M.say(`💛 Oye, te vengo notando cansado: ${w.signals.join(', ')}. ¿Qué tal si hoy cierras a tu hora y te tomas pausas de verdad? Tu salud va primero. 🫂`, 'hug', 20000, {
      cat: 'health', actions: [{ label: '💛 Gracias', cmd: 'ack' }, { label: '📈 Ver estadísticas', cmd: 'stats' }],
    });
  }

  // ---------- tus patrones (insights de los últimos 14 días) ----------
  function insights() {
    const pad2 = (n) => String(n).padStart(2, '0');
    const out = [];
    const byHour = Array.from({ length: 24 }, () => ({ w: 0, d: 0 }));
    const byDow = Array.from({ length: 7 }, () => ({ w: 0, d: 0, n: 0 }));
    const DOW = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
    for (let i = 0; i < 14; i++) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const v = M.store.data.days[`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`];
      if (!v) continue;
      for (const [h, x] of Object.entries(v.hours || {})) { byHour[h].w += x.w || 0; byHour[h].d += x.d || 0; }
      if (v.focus) { const b = byDow[d.getDay()]; b.w += v.focus.work || 0; b.d += v.focus.distraction || 0; b.n++; }
    }
    // Mejor franja de 2 horas.
    let best = -1, bestH = 0;
    for (let h = 6; h < 22; h++) { const s = byHour[h].w + byHour[h + 1].w; if (s > best) { best = s; bestH = h; } }
    if (best > 3 * 3600) out.push(`🔥 Tu mejor franja es de ${bestH}:00 a ${bestH + 2}:00: ahí conviene tu pomodoro más difícil.`);
    // Día con más distracción (proporción).
    const ratios = byDow.map((b, i) => ({ i, r: b.w + b.d > 3600 ? b.d / (b.w + b.d) : null })).filter((x) => x.r !== null);
    if (ratios.length >= 3) {
      const worst = ratios.reduce((a, b) => (b.r > a.r ? b : a));
      const avg = ratios.reduce((a, b) => a + b.r, 0) / ratios.length;
      if (worst.r > avg * 1.4 && worst.r > 0.1) out.push(`🙈 Los ${DOW[worst.i]} te distraes más (${Math.round(worst.r * 100)}% del tiempo).`);
      const top = byDow.map((b, i) => ({ i, w: b.n ? b.w / b.n : 0 })).reduce((a, b) => (b.w > a.w ? b : a));
      if (top.w > 3600) out.push(`💪 Tu día más productivo suele ser el ${DOW[top.i].replace(/s$/, '')} (${(top.w / 3600).toFixed(1)} h de media).`);
    }
    const est = estimateStats();
    if (est.ratio) out.push(est.ratio > 1.15 ? `⏱️ Sueles tardar ${est.ratio.toFixed(1)}× lo que estimas.` : est.ratio < 0.85 ? '⏱️ Terminas antes de lo que estimas.' : '⏱️ Estimas muy bien tus tareas.');
    const w = wellbeingSignals();
    if (w.avgMood) out.push(`${w.avgMood >= 4 ? '😄' : w.avgMood >= 3 ? '🙂' : '😕'} Tu ánimo medio esta semana: ${w.avgMood.toFixed(1)}/5.`);
    if (!out.length) out.push('🌱 Aún estoy aprendiendo de ti: en unos días te mostraré tus patrones.');
    return out;
  }

  // ---------- precisión de tus estimaciones (últimos 30 días) ----------
  function estimateStats() {
    let est = 0, spent = 0, n = 0;
    const cutoff = Date.now() - 30 * 864e5;
    for (const [k, d] of Object.entries(M.store.data.days || {})) {
      if (Date.parse(k) < cutoff) continue;
      for (const t of (d.standup && d.standup.today) || []) {
        const s = (t.spent || 0) + (t.startedAt ? (Date.now() - t.startedAt) / 1000 : 0);
        if (t.done && t.est && s >= 60) { est += t.est * 60; spent += s; n++; }
      }
    }
    return n >= 3 ? { ratio: spent / est, samples: n } : { ratio: null, samples: n };
  }

  // ---------- "Configura tu pollito": lista de primeros pasos ----------
  function checklist(hooksInstalled) {
    const d = M.store.data;
    const everDay = (fn) => Object.values(d.days || {}).some(fn);
    return [
      { id: 'name', label: 'Ponerme nombre', done: !!d.pet.name, cmd: 'panel.profile' },
      { id: 'claude', label: 'Conectar tu cuenta de Claude', done: M.usage.connection && M.usage.connection.status === 'ok', cmd: 'panel.usage' },
      { id: 'daily', label: 'Hacer tu primer daily', done: everDay((x) => x.standup), cmd: 'daily' },
      { id: 'pomo', label: 'Completar un pomodoro', done: everDay((x) => (x.pomodoros || 0) > 0), cmd: 'pomo.start' },
      { id: 'capture', label: 'Anotar algo con Ctrl+Alt+P', done: !!(d.flags && d.flags.usedCapture), cmd: 'capture' },
      { id: 'palette', label: 'Abrir la paleta con Ctrl+Alt+Espacio', done: !!(d.flags && d.flags.usedPalette), cmd: 'palette' },
      { id: 'hooks', label: 'Conectar Claude Code', done: !!hooksInstalled, cmd: 'settings.integrations' },
      { id: 'style', label: 'Comprarme un accesorio', done: (d.pet.owned || []).length > 0, cmd: 'panel.profile' },
    ];
  }

  // ---------- niveles (tamagotchi) ----------
  /** @type {Array<[number, string]>} */
  const TITLES = [
    [1, 'Pollito becario'], [2, 'Pollito junior'], [3, 'Pollito semi-senior'], [5, 'Pollito senior'],
    [8, 'Gallo Tech Lead'], [12, 'Gallo Director'], [20, 'Gallo CEO 👑'],
  ];
  function levelInfo(xp) {
    const level = 1 + Math.floor(xp / 100);
    let title = TITLES[0][1];
    for (const [l, t] of TITLES) if (level >= l) title = t;
    return { level, title, xp, into: xp % 100, next: 100 };
  }
  function addXp(n) {
    const p = M.store.data.pet;
    const before = levelInfo(p.xp || 0).level;
    p.xp = (p.xp || 0) + n;
    p.coins = (p.coins || 0) + n; // cada XP también da 1 maíz 🌽 para la tienda
    const after = levelInfo(p.xp);
    M.store.save();
    if (after.level > before) {
      const evolved = M.gami.stageOf(after.level).id !== M.gami.stageOf(before).id;
      setTimeout(() => {
        if (evolved) {
          M.say(`✨ ¡EVOLUCIONÉ! ✨ Ahora soy un ${M.gami.stageOf(after.level).name} (nivel ${after.level}) 🎉`, 'hatch', 12000);
        } else {
          M.say(`¡SUBÍ A NIVEL ${after.level}! 🎉 Ahora soy ${after.title}${after.level === 3 ? ' (¡con corbatín!)' : after.level === 8 ? ' (¡con corona!)' : ''}`, 'celebrate', 10000);
        }
        M.pushChat('pet', `¡Nivel ${after.level}: ${after.title}! 🎉`);
        M.broadcast();
        checkAchievements();
      }, 2500);
    }
  }

  // ---------- logros ----------
  function achievementCtx() {
    return {
      data: M.store.data,
      level: levelInfo(M.store.data.pet.xp || 0).level,
      streaks: M.gami.streaks(M.store.data),
      chatCount: M.store.data.chatSent || 0,
    };
  }
  function checkAchievements() {
    const p = M.store.data.pet;
    const have = new Set((p.achievements || []).map((a) => a.id));
    const ctx = achievementCtx();
    const fresh = M.gami.ACHIEVEMENTS.filter((a) => !have.has(a.id) && (() => { try { return a.test(ctx); } catch { return false; } })());
    if (!fresh.length) return;
    p.achievements = [...(p.achievements || []), ...fresh.map((a) => ({ id: a.id, at: Date.now() }))];
    for (const a of fresh) p.coins = (p.coins || 0) + a.reward;
    M.store.save();
    // Uno a uno, con un respiro entre ellos.
    fresh.forEach((a, i) => setTimeout(() => {
      M.say(`🏅 ¡Logro desbloqueado! ${a.emoji} ${a.name} — ${a.desc} (+${a.reward} 🌽)`, 'celebrate', 10000);
      M.pushChat('pet', `🏅 ${a.emoji} ${a.name} (+${a.reward} 🌽)`);
      M.notify(`🏅 ${a.name}`, a.desc);
    }, 3000 + i * 11000));
    M.broadcast();
  }

  // ---------- monitor de sitios ----------
  async function checkMonitors(announce = true) {
    const list = M.store.data.settings.monitors || [];
    await Promise.all(list.map(async (m) => {
      const r = await M.monitor.check(m.url);
      const prev = M.monitorState[m.id];
      M.monitorState[m.id] = { ...r, checkedAt: Date.now(), since: prev && prev.up === r.up ? prev.since : Date.now() };
      if (announce && prev && prev.up !== r.up) {
        const name = m.name || new URL(m.url).host;
        if (r.up) {
          M.say(`🟢 ${name} volvió a funcionar (${r.ms} ms)`, 'celebrate', 9000);
          M.notify(`🟢 ${name}`, 'Vuelve a responder');
        } else {
          M.say(`🔴 ${name} está caído ${r.status ? `(HTTP ${r.status})` : `(${r.error || 'sin respuesta'})`} 😱`, 'alarm', 15000, {
            actions: [{ label: '🌐 Abrir', cmd: 'open.monitor', arg: m.id }],
          });
          M.notify(`🔴 ${name} está caído`, r.status ? `HTTP ${r.status}` : r.error || 'Sin respuesta', () => M.shell.openExternal(m.url));
        }
        M.pushChat('pet', `${r.up ? '🟢' : '🔴'} ${name}: ${r.up ? 'arriba' : 'caído'}`);
      }
    }));
    M.broadcast();
  }

  // ---------- estadísticas (30 días) ----------
  function statsData() {
    const pad2 = (n) => String(n).padStart(2, '0');
    const keyOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const days = [];
    for (let i = 34; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const k = keyOf(d);
      const v = M.store.data.days[k] || {};
      const t = (v.standup && v.standup.today) || [];
      const byDay = (M.usage.local && M.usage.local.byDay) || {};
      days.push({
        key: k,
        dow: d.getDay(),
        label: d.toLocaleDateString(M.lang() === 'en' ? 'en' : 'es', { day: 'numeric', month: 'short' }),
        work: (v.focus && v.focus.work) || 0,
        distraction: (v.focus && v.focus.distraction) || 0,
        done: t.filter((x) => x.done).length,
        planned: t.length,
        pomodoros: v.pomodoros || 0,
        commits: v.commits || 0,
        tokens: (byDay[k] && byDay[k].tokens) || 0,
        cost: (byDay[k] && byDay[k].cost) || 0,
        mood: v.mood || 0,
      });
    }
    const month = days.slice(-30);
    const projects = {};
    for (const x of month) for (const [p, s] of Object.entries((M.store.data.days[x.key] || {}).projects || {})) projects[p] = (projects[p] || 0) + s;
    return {
      days,
      projects: Object.entries(projects).sort((a, b) => b[1] - a[1]).slice(0, 7),
      insights: insights().map((x) => M.T(x)),
      totals: {
        hours: month.reduce((a, x) => a + x.work, 0) / 3600,
        pomodoros: month.reduce((a, x) => a + x.pomodoros, 0),
        commits: month.reduce((a, x) => a + x.commits, 0),
        streak: M.gami.streaks(M.store.data).daily,
      },
    };
  }

  return {
    wellbeingSignals,
    checkBirthday,
    checkWellbeing,
    insights,
    estimateStats,
    checklist,
    TITLES,
    levelInfo,
    addXp,
    achievementCtx,
    checkAchievements,
    checkMonitors,
    statsData,
  };
};

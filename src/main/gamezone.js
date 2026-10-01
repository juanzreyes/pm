// Juego (src/gamezone.js): misiones diarias, pase de temporada, huevos dorados, minijuegos y
// "Tu año con PM Pollito". Parte del proceso principal. `M` es el contexto compartido de la app.
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  const gz = require('../gamezone');
  const S = () => M.store.data;
  const P = () => S().pet;
  const G = () => {
    const g = (S().game = S().game || {});
    const today = M.dayKey();
    if (!g.day || g.day.key !== today) g.day = { key: today, claimed: [], games: 0, bonus: false, notified: [] };
    const sid = gz.seasonOf();
    if (!g.season || g.season.id !== sid) {
      const was = g.season;
      g.season = { id: sid, pts: 0, tier: 0 };
      if (was) M.say(`🎟️ ¡Empieza la temporada de ${gz.seasonName(sid)}! Pase nuevo, gratis: misiones y minijuegos suben de nivel; en el 10 y el 20 hay plumas exclusivas.`, 'celebrate', 12000, { cat: 'pet', actions: [{ label: '🎟️ Ver el pase', cmd: 'panel', arg: 'pet#game-season' }] });
    }
    g.eggs = g.eggs || [];
    return g;
  };

  // ---------- recompensas ----------
  function grant(r, why) {
    const p = P();
    const got = [];
    if (r.corn) { p.coins = (p.coins || 0) + r.corn; got.push(`+${r.corn} 🌽`); }
    if (r.xp) { M.addXp(r.xp); got.push(`+${r.xp} XP`); }
    if (r.item) {
      const it = M.gami.SHOP.find((x) => x.id === r.item);
      p.owned = p.owned || [];
      if (it && !p.owned.includes(it.id)) { p.owned.push(it.id); got.push(`${it.emoji} ${it.name}`); }
      else if (it) { p.coins = (p.coins || 0) + 200; got.push('+200 🌽 (ya lo tenías)'); }
    }
    if (why && got.length) M.say(`${why}: ${got.join(' · ')}`, 'celebrate', 10000, { cat: 'pet' });
    return got;
  }
  function addPts(n) {
    if (!n) return;
    const s = G().season;
    const before = s.tier;
    s.pts += n;
    s.tier = gz.tierOf(s.pts);
    for (let t = before + 1; t <= s.tier; t++) {
      const r = gz.tierReward(t);
      grant(r, `🎟️ ¡Nivel ${t} del pase de ${gz.seasonName(s.id)}!`);
      if (r.item) M.sendPet('pet:anim', 'celebrate');
    }
    if (s.tier > before) M.checkAchievements();
  }

  // ---------- 🎯 misiones ----------
  function ctx() {
    const today = M.dayKey();
    const kudos = ((S().farm && S().farm.sent) || []).filter((e) => e.type === 'kudo' && M.dayKey(new Date(e.at)) === today).length;
    const recent = Object.entries(S().days || {}).filter(([k]) => k >= M.dayKey(new Date(Date.now() - 14 * 864e5)));
    return {
      day: S().days[today] || {}, games: G().day.games, kudos,
      team: !!S().settings.teamFolder, claude: recent.some(([, d]) => (d.claudeTasks || 0) > 0),
    };
  }
  function missions() {
    const c = ctx();
    return gz.missionsFor(G().day.key, c).map((m) => gz.missionView(m, c, G().day.claimed));
  }
  function claimMission(id) {
    const g = G();
    const m = missions().find((x) => x.id === id);
    if (!m) return { ok: false, error: 'Esa misión no es de hoy' };
    if (!m.done) return { ok: false, error: 'Aún no la terminas' };
    if (m.claimed) return { ok: false, error: 'Ya la reclamaste' };
    g.day.claimed.push(id);
    P().coins = (P().coins || 0) + gz.MISSION_CORN;
    addPts(gz.MISSION_PTS);
    let bonus = false;
    if (!g.day.bonus && missions().every((x) => x.claimed)) {
      g.day.bonus = true;
      bonus = true;
      P().coins = (P().coins || 0) + 30;
      addPts(gz.MISSION_PTS);
    }
    M.sendPet('pet:anim', bonus ? 'celebrate' : 'hop');
    M.say(bonus ? `🎯 ¡Las 3 misiones de hoy! +${gz.MISSION_CORN + 30} 🌽 y +${gz.MISSION_PTS * 2} puntos de pase` : `🎯 ${m.emoji} ¡Misión cumplida! +${gz.MISSION_CORN} 🌽 y +${gz.MISSION_PTS} puntos de pase`, 'celebrate', 8000, { cat: 'pet', log: false });
    M.store.save();
    M.broadcast();
    return { ok: true, bonus };
  }

  // ---------- 🥚 huevos dorados ----------
  function eggTick() {
    let streak = 0;
    try { streak = M.gami.streaks(S()).daily; } catch { return; }
    const g = G();
    for (const e of gz.newEggs(streak, g.eggs)) {
      g.eggs.push({ streak: e.streak, at: Date.now(), opened: false });
      M.sendPet('pet:anim', 'celebrate');
      M.say(`🥚✨ ¡Un huevo dorado por ${e.streak} días de racha! Ábrelo en tu perfil.`, 'celebrate', 15000, { cat: 'pet', actions: [{ label: '🥚 Abrirlo', cmd: 'egg.open', arg: String(e.streak) }] });
      M.checkAchievements();
    }
  }
  function openEgg(streak) {
    const g = G();
    const egg = g.eggs.find((e) => e.streak === Number(streak) && !e.opened);
    if (!egg) return { ok: false, error: 'No tienes ese huevo por abrir' };
    const def = gz.EGGS.find((e) => e.streak === egg.streak);
    egg.opened = true;
    egg.openedAt = Date.now();
    const got = grant(def.reward, `🐣 Del huevo dorado de ${egg.streak} días salió`);
    M.sendPet('pet:anim', 'celebrate');
    M.store.save();
    M.broadcast();
    return { ok: true, got };
  }

  // ---------- 🎮 minijuegos ----------
  const MODES = { corn: { max: 500, corn: (s) => s }, bugs: { max: 300, corn: (s) => Math.round(s / 2) }, snake: { max: 400, corn: (s) => s * 2 } };
  function onGameEnd(mode, score) {
    const m = MODES[mode] ? mode : 'corn';
    score = Math.max(0, Math.min(MODES[m].max, Math.floor(Number(score) || 0)));
    const p = P();
    const g = G();
    p.bestScores = p.bestScores || {};
    const prevBest = m === 'corn' ? p.bestScore || 0 : p.bestScores[m] || 0;
    const best = score > prevBest;
    if (best) { p.bestScores[m] = score; if (m === 'corn') p.bestScore = score; }
    const corn = MODES[m].corn(score);
    p.coins = (p.coins || 0) + corn;
    p.happiness = M.clamp((p.happiness || 0) + 8);
    const pts = gz.gamePts(score, g.day.games);
    g.day.games++;
    addPts(pts);
    M.store.save();
    const what = m === 'bugs' ? `🐞 ¡${score} bugs aplastados!` : m === 'snake' ? `🐍 ¡${score} granos con la viborita!` : `🎮 ¡${score} granos atrapados!`;
    M.say(`${what} +${corn} 🌽${pts ? ` · +${pts} pase` : ''}${best ? ' ¡NUEVO RÉCORD! 🏆' : ''}`, 'celebrate', 9000);
    M.checkAchievements();
    M.broadcast();
    return { best: m === 'corn' ? p.bestScore : p.bestScores[m], coins: Math.floor(p.coins), corn, pts };
  }

  // ---------- 🎁 tu año ----------
  function wrappedData(year) {
    const y = Number(year) || new Date().getFullYear();
    const kudos = ((S().farm && S().farm.received) || []).filter((e) => new Date(e.at).getFullYear() === y).length;
    const w = gz.wrapped(S(), y, { kudos });
    G().wrappedSeen = y;
    M.store.save();
    return { ...w, text: gz.wrappedText(w), name: S().settings.myName || '' };
  }
  async function saveWrapped(dataUrl, win) {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) return { ok: false, error: 'Imagen no válida' };
    const r = await M.dialog.showSaveDialog(win, { title: 'Guardar mi año con PM Pollito', defaultPath: M.path.join(M.app.getPath('pictures'), `mi-${new Date().getFullYear()}-con-pm-pollito.png`), filters: [{ name: 'Imagen PNG', extensions: ['png'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    M.fs.writeFileSync(r.filePath, Buffer.from(m[1], 'base64'));
    M.shell.showItemInFolder(r.filePath);
    return { ok: true, file: r.filePath };
  }

  // ---------- cada minuto ----------
  function tick() {
    const g = G();
    eggTick();
    // Aviso (una vez) cuando una misión queda lista para reclamar.
    for (const m of missions()) {
      if (m.done && !m.claimed && !g.day.notified.includes(m.id)) {
        g.day.notified.push(m.id);
        M.say(`🎯 ${m.emoji} Misión lista: «${m.text}». ¡Reclámala!`, 'hop', 8000, { cat: 'pet', log: false, actions: [{ label: '🎁 Reclamar', cmd: 'mission.claim', arg: m.id }] });
      }
    }
    // En diciembre, la invitación a ver tu año (una vez).
    const now = new Date();
    if (now.getMonth() === 11 && now.getDate() >= 10 && g.wrappedInvited !== now.getFullYear()) {
      g.wrappedInvited = now.getFullYear();
      M.say(`🎁 ¡Ya está listo tu ${now.getFullYear()} con PM Pollito! Tus horas de foco, tu proyecto estrella y qué tipo de dev fuiste.`, 'celebrate', 20000, { cat: 'pet', actions: [{ label: '🎁 Ver mi año', cmd: 'wrapped' }] });
    }
    M.store.save();
  }

  function gameState() {
    const g = G();
    const s = g.season;
    let streak = 0;
    try { streak = M.gami.streaks(S()).daily; } catch { /* sin historial */ }
    const ne = gz.nextEgg(streak);
    return {
      missions: missions(), bonus: g.day.bonus,
      season: {
        id: s.id, name: gz.seasonName(s.id), pts: s.pts, tier: s.tier, max: gz.MAX_TIER, tierPts: gz.TIER_PTS,
        into: s.tier >= gz.MAX_TIER ? gz.TIER_PTS : s.pts % gz.TIER_PTS,
        rewards: Array.from({ length: gz.MAX_TIER }, (_, i) => ({ tier: i + 1, ...gz.tierReward(i + 1), got: s.tier >= i + 1 })),
        daysLeft: Math.ceil((new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).getTime() - Date.now()) / 864e5),
      },
      eggs: g.eggs.map((e) => ({ ...e, label: (gz.EGGS.find((x) => x.streak === e.streak) || {}).label || '' })),
      streak, nextEgg: ne ? { streak: ne.streak, left: ne.streak - streak, label: ne.label } : null,
      bestScores: { corn: P().bestScore || 0, ...(P().bestScores || {}) }, gamesToday: g.day.games,
    };
  }

  function start() {
    G();
    if (M.TEST) return;
    setTimeout(tick, 15000);
    setInterval(tick, 60e3);
  }

  return { start, tick, gameState, claimMission, openEgg, onGameEnd, wrappedData, saveWrapped, eggTick };
};

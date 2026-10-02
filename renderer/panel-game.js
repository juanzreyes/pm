// Panel 2.0 · juego: misiones diarias, pase de temporada, huevos dorados y "Tu año con PM Pollito"
// (una tarjeta dibujada en un canvas para guardarla como imagen). Datos en src/main/gamezone.js.
/* global $, esc, state, toast, I18N */
(() => {
  const tr = (el) => { if (state && state.lang && state.lang !== 'es' && el) I18N.translateDom(el, state.lang); };

  // ================= 🎯 MISIONES =================
  function renderMissions(gm) {
    $('#game-bonus').classList.toggle('hidden', !gm.bonus);
    $('#game-missions').innerHTML = gm.missions.map((m) => {
      const pct = Math.round((m.n / m.goal) * 100);
      const prog = m.unit === 'min' ? `${m.n} / ${m.goal} min` : `${m.n} / ${m.goal}`;
      const btn = m.claimed ? '<span class="muted small">✅</span>'
        : m.done ? `<button class="primary mini m-claim" data-id="${esc(m.id)}">🎁 Reclamar</button>`
          : `<span class="muted small">${prog}</span>`;
      return `<div class="mission ${m.done ? 'done' : ''} ${m.claimed ? 'claimed' : ''}"><span class="me">${m.emoji}</span><div class="mt"><b>${esc(m.text)}</b><div class="bar"><i class="${pct >= 100 ? '' : 'mid'}" style="width:${pct}%"></i></div></div>${btn}</div>`;
    }).join('');
  }
  $('#game-missions').addEventListener('click', async (e) => {
    const b = e.target.closest('.m-claim');
    if (!b) return;
    const r = await MOTION.busy(b, () => pm.missionClaim(b.dataset.id));
    if (r.ok) { const rc = b.getBoundingClientRect(); MOTION.burst(rc.left + rc.width / 2, rc.top, { n: 14 }); MOTION.sfx(r.bonus ? 'celebrate' : 'done'); }
    if (!r.ok) { b.disabled = false; toast('😿 ' + r.error); }
  });

  // ================= 🎟️ PASE DE TEMPORADA =================
  function renderPass(s) {
    $('#game-season-name').textContent = `${s.name} · quedan ${s.daysLeft} día${s.daysLeft === 1 ? '' : 's'}`;
    const next = s.rewards[s.tier];
    $('#game-pass').innerHTML = `<div class="row between"><b>Nivel ${s.tier} / ${s.max}</b><span class="muted">${s.pts} puntos</span></div>
      <div class="bar"><i style="width:${s.tier >= s.max ? 100 : Math.round((s.into / s.tierPts) * 100)}%"></i></div>
      <div class="muted">${next ? `Próximo: ${next.emoji} ${esc(next.label)} (faltan ${s.tierPts - s.into} puntos). ` : '🏁 ¡Pase completo! '}Las misiones dan 100 puntos y tus 3 primeras partidas del día, hasta 50.</div>
      <div class="pass-track">${s.rewards.map((r) => `<div class="pass-tier ${r.got ? 'got' : ''} ${r.item ? 'big' : ''} ${r.tier === s.tier + 1 ? 'now' : ''}" title="Nivel ${r.tier}: ${esc(r.label)}">${r.got ? '✅' : r.emoji}<small>${r.tier}</small></div>`).join('')}</div>`;
    const now = $('#game-pass .pass-tier.now');
    if (now) now.parentElement.scrollLeft = Math.max(0, now.offsetLeft - now.parentElement.offsetLeft - 120);
  }

  // ================= 🥚 HUEVOS DORADOS =================
  function renderEggs(gm) {
    $('#game-streak').textContent = gm.streak ? `🔥 racha de ${gm.streak} día${gm.streak === 1 ? '' : 's'}` : '';
    const eggs = gm.eggs.slice().sort((a, b) => a.opened - b.opened || b.streak - a.streak);
    $('#game-eggs').innerHTML = `${eggs.length ? `<div class="eggs">${eggs.map((e) => `<div class="egg ${e.opened ? 'open' : 'closed'}" title="${esc(e.label)}"><span class="ee">${e.opened ? '🐣' : '🥚'}</span><b>${e.streak} días</b>${e.opened ? '<span class="muted">abierto</span>' : `<button class="primary mini egg-open" data-streak="${e.streak}">Abrir</button>`}</div>`).join('')}</div>` : ''}
      <div class="muted">${gm.nextEgg ? `Próximo huevo a los <b>${gm.nextEgg.streak} días</b> de racha (te faltan ${gm.nextEgg.left}): ${esc(gm.nextEgg.label)}.` : '¡Tienes todos los huevos dorados! 🏆'} La racha cuenta los días laborables con daily.</div>`;
  }
  $('#game-eggs').addEventListener('click', async (e) => {
    const b = e.target.closest('.egg-open');
    if (!b) return;
    b.disabled = true;
    const r = await pm.eggOpen(Number(b.dataset.streak));
    if (!r.ok) { b.disabled = false; toast('😿 ' + r.error); } else toast('🐣 ' + r.got.join(' · '));
  });

  function render() {
    const gm = state.game;
    if (!gm) return;
    renderMissions(gm);
    renderPass(gm.season);
    renderEggs(gm);
    tr($('#game-missions'));
  }

  // ================= 🎁 TU AÑO =================
  let wr = null;
  async function openWrapped() {
    wr = await pm.wrappedGet(new Date().getFullYear());
    $('#o-wrapped').classList.remove('hidden');
    draw(wr);
    tr($('#o-wrapped'));
  }
  function draw(w) {
    const cv = $('#wr-canvas');
    const g = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    const font = (size, weight = 800) => `${weight} ${size}px "Segoe UI Rounded", "Nunito", "Segoe UI", system-ui, sans-serif`;
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#ffe066');
    bg.addColorStop(0.55, '#ffb347');
    bg.addColorStop(1, '#ff7b9c');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // Confeti suave de fondo (siempre igual para el mismo año).
    let seed = w.year;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.25})`; g.beginPath(); g.arc(rnd() * W, rnd() * H, 3 + rnd() * 8, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#3b2f2f';
    g.textAlign = 'center';
    g.font = font(30, 700);
    g.fillText(w.name ? `El ${w.year} de ${w.name}` : `Mi ${w.year}`, W / 2, 70);
    g.font = font(46);
    g.fillText('con PM Pollito', W / 2, 122);
    // Tu tipo de año.
    g.font = '96px "Segoe UI Emoji", sans-serif';
    g.fillText(w.persona.emoji, W / 2, 245);
    g.font = font(44);
    g.fillText(w.persona.name, W / 2, 315);
    g.font = font(24, 600);
    g.fillText(w.persona.why, W / 2, 352);
    // Números.
    const stats = [['🧠', `${w.focusH} h`, 'de foco'], ['✅', w.tasks, 'tareas'], ['🍅', w.pomodoros, 'pomodoros'], ['📦', w.commits, 'commits'], ['🤖', w.claudeTasks, 'con Claude'], ['☀️', w.dailies, 'dailies']];
    stats.forEach(([e, n, l], i) => {
      const x = 60 + (i % 3) * 210;
      const y = 400 + Math.floor(i / 3) * 150;
      g.fillStyle = 'rgba(255,253,246,.88)';
      g.beginPath(); g.roundRect(x, y, 190, 130, 22); g.fill();
      g.strokeStyle = '#3b2f2f'; g.lineWidth = 3; g.stroke();
      g.fillStyle = '#3b2f2f';
      g.font = '34px "Segoe UI Emoji", sans-serif';
      g.fillText(e, x + 95, y + 44);
      g.font = font(38);
      g.fillText(String(n), x + 95, y + 92);
      g.font = font(19, 600);
      g.fillText(l, x + 95, y + 118);
    });
    // Destacados.
    const lines = [];
    if (w.topProject) lines.push(`🏆 Proyecto estrella: ${w.topProject}`);
    if (w.bestWeekday) lines.push(`📅 Tu mejor día de la semana: los ${w.bestWeekday}`);
    if (w.bestMonth) lines.push(`🗓️ Tu mes más enfocado: ${w.bestMonth}`);
    if (w.bestDay) lines.push(`🔥 Día récord: ${w.bestDay.hours} h enfocado (${new Date(w.bestDay.date + 'T12:00').toLocaleDateString('es', { day: 'numeric', month: 'long' })})`);
    if (w.kudos) lines.push(`🌽 ${w.kudos} kudos de tu equipo`);
    if (w.achievements) lines.push(`🏅 ${w.achievements} logros desbloqueados`);
    g.textAlign = 'left';
    // Cada línea se achica hasta caber (nunca se corta).
    lines.slice(0, 4).forEach((t, i) => {
      let size = 24;
      do { g.font = font(size, 700); size--; } while (g.measureText(t).width > W - 120 && size > 14);
      g.fillText(t, 60, 735 + i * 38);
    });
    // El pollito firma la tarjeta.
    const cx = W - 90;
    const cy = H - 70;
    g.fillStyle = '#ffd84a'; g.strokeStyle = '#3b2f2f'; g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, 34, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#2b1d1d';
    g.beginPath(); g.ellipse(cx - 11, cy - 6, 4.5, 6, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(cx + 11, cy - 6, 4.5, 6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff9f1c';
    g.beginPath(); g.moveTo(cx - 8, cy + 6); g.quadraticCurveTo(cx, cy + 18, cx + 8, cy + 6); g.closePath(); g.fill();
    g.fillStyle = '#3b2f2f';
    g.font = font(20, 700);
    g.textAlign = 'right';
    g.fillText(`— ${w.petName}, tu pollito PM 💛`, cx - 48, cy + 8);
  }
  $('#game-wrapped').addEventListener('click', openWrapped);
  $('#wr-close').addEventListener('click', () => $('#o-wrapped').classList.add('hidden'));
  $('#wr-save').addEventListener('click', async (e) => {
    const r = await MOTION.busy(e.currentTarget, () => pm.wrappedSave($('#wr-canvas').toDataURL('image/png')));
    if (r.ok) toast('💾 Imagen guardada'); else if (!r.canceled) toast('😿 ' + r.error);
  });
  $('#wr-copy').addEventListener('click', async () => {
    if (!wr) return;
    try { await navigator.clipboard.writeText(wr.text); toast('📋 Copiado'); } catch { toast('😿 No pude copiar'); }
  });

  const prevOpen = window.openExtra;
  window.openExtra = (view) => (view === 'wrapped' ? openWrapped() : prevOpen && prevOpen(view));
  const prevRender = window.renderExtras;
  window.renderExtras = () => { if (prevRender) prevRender(); render(); };
  if (typeof state !== 'undefined' && state) window.renderExtras();
})();

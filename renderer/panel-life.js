// Panel: priorizar, dividir tareas, cola para Claude, presupuesto, builds/push/ramas,
// hitos, revisión del viernes, personalidad, casita, colección y diario del pollito.
/* global $, $$, esc, state, show, toast */
(() => {
  const tr = (el) => { if (state && state.lang && state.lang !== 'es' && el) I18N.translateDom(el, state.lang); };
  const money = (n) => '$' + (n || 0).toFixed(2);
  const hrs = (secs) => { const m = Math.round(secs / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };

  // ================= DÍA: priorizar y dividir =================
  $('#btn-prioritize').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = '🧠 Pensando…';
    try { await pm.prioritize(true); } finally { b.disabled = false; b.textContent = '🧠 Priorizar'; tr(b); }
  });
  $('#tasks').addEventListener('click', async (e) => {
    const sp = e.target.closest('[data-split]');
    if (!sp) return;
    e.stopPropagation();
    sp.textContent = '⏳';
    await pm.splitTask(Number(sp.dataset.split));
  }, true);

  // ================= COLA PARA CLAUDE =================
  function renderQueue() {
    const q = state.claudeQueue || [];
    $('#queue-next').classList.toggle('hidden', !q.length);
    $('#claude-queue').innerHTML = q.length
      ? q.map((x, i) => `<div class="qi" data-id="${x.id}"><span class="qn">${i + 1}</span><span class="qt">${esc(x.text.length > 140 ? x.text.slice(0, 139) + '…' : x.text)}${x.project ? ` <span class="pill">${esc(x.project)}</span>` : ''}</span>${x.project ? '<button class="icon mini q-run" title="Que Claude la haga ya (en una copia aparte del repo)" aria-label="Ejecutar con Claude">▶</button>' : ''}<button class="icon mini q-del" title="Quitar" aria-label="Quitar">✕</button></div>`).join('')
      : '<span class="muted">Apunta aquí lo que quieres pedirle a Claude mientras trabaja en otra cosa. Cuando termine, te lo recuerdo. También: <b>para claude: …</b> en la captura rápida o <b>Ctrl+Alt+Q</b> en VS Code.</span>';
    tr($('#claude-queue'));
  }
  $('#claude-queue').addEventListener('click', (e) => {
    const d = e.target.closest('.q-del');
    if (d) pm.queueRemove(d.closest('.qi').dataset.id);
    const r = e.target.closest('.q-run');
    if (r) {
      r.disabled = true;
      pm.runStart(r.closest('.qi').dataset.id).then((res) => { if (!res.ok) { r.disabled = false; toast('😿 ' + res.error); } });
    }
  });
  $('#queue-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#queue-input').value.trim();
    if (!v) return;
    pm.queueAdd(v, $('#queue-project').value);
    $('#queue-input').value = '';
  });
  $('#queue-next').addEventListener('click', () => pm.queueNext(''));

  // ================= PRESUPUESTO =================
  let editingBudget = false;
  function renderBudget() {
    const b = state.budget || {};
    const box = $('#budget');
    if (document.activeElement && document.activeElement.id === 'budget-input') return;
    if (!b.budget || editingBudget) {
      box.innerHTML = `<div class="row between"><b>💰 Presupuesto semanal de Claude</b><span class="muted small">esta semana ${money(b.spent)}</span></div>
        <form id="budget-form" class="row"><input id="budget-input" type="number" min="1" step="1" placeholder="Ej: 50" aria-label="Presupuesto en dólares" /><button class="soft" type="submit">${b.budget ? 'Guardar' : 'Poner límite'}</button></form>
        <div class="muted small">Te aviso al 80% y al 100%, y te digo qué proyecto gasta más.</div>`;
    } else {
      const pct = Math.min(100, b.pct);
      const cls = b.pct >= 100 ? 'max' : b.pct >= 80 ? 'high' : b.pct >= 50 ? 'mid' : 'ok';
      box.innerHTML = `<div class="row between"><b>💰 Presupuesto semanal</b><button id="budget-edit" class="ghost mini">Cambiar</button></div>
        <div class="bar" role="progressbar" aria-valuenow="${Math.round(b.pct)}" aria-valuemin="0" aria-valuemax="100"><i class="${cls}" style="width:${pct}%"></i></div>
        <div class="row between small"><span><b>${money(b.spent)}</b> de ${money(b.budget)} (${Math.round(b.pct)}%)</span><span class="muted">a este ritmo: ${money(b.projected)}</span></div>
        ${b.top ? `<div class="muted small">Lo que más gasta: <b>${esc(b.top.name)}</b> (${money(b.top.cost)} en 7 días)</div>` : ''}`;
    }
    tr(box);
  }
  $('#budget').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Number($('#budget-input').value);
    editingBudget = false;
    pm.updateSettings({ claudeBudget: v > 0 ? v : 0 });
  });
  $('#budget').addEventListener('click', (e) => {
    if (e.target.id !== 'budget-edit') return;
    editingBudget = true;
    renderBudget();
    const i = $('#budget-input');
    if (i) { i.value = (state.budget && state.budget.budget) || ''; i.focus(); i.select(); }
  });

  // ================= BUILDS, PUSH Y RAMAS =================
  function renderDev() {
    const d = (state.today && state.today.builds) || null;
    const checks = Object.values(state.pushChecks || {}).filter((c) => c.ahead && Date.now() - c.at < 24 * 3600e3);
    const L = [];
    if (d) L.push(`🧪 Tests y builds hoy: <b>${d.ok}</b> ✅ · <b>${d.fail}</b> ❌`);
    for (const c of checks) L.push(c.found.length ? `🔍 ${esc(c.repo)}: ${c.ahead} commit${c.ahead === 1 ? '' : 's'} sin subir · <b>${c.found.length}</b> aviso${c.found.length === 1 ? '' : 's'}` : `🚀 ${esc(c.repo)}: ${c.ahead} commit${c.ahead === 1 ? '' : 's'} sin subir, todo limpio`);
    L.push('<button id="push-check" class="ghost mini">🔍 Revisar antes de push</button>');
    $('#devbox').innerHTML = L.join('<br>');
    const br = Object.entries((state.today && state.today.branches) || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
    $('#branches').classList.toggle('hidden', !br.length);
    const max = br.length ? br[0][1] : 1;
    $('#branches-list').innerHTML = br.map(([k, s]) => `<div class="proj"><span class="n" title="${esc(k)}">${esc(k)}</span><div class="bar"><i style="width:${(s / max) * 100}%"></i></div><span class="t">${hrs(s)}</span></div>`).join('');
    tr($('#devbox'));
  }
  $('#devbox').addEventListener('click', (e) => { if (e.target.id === 'push-check') pm.pushCheck(); });

  // ================= HITOS =================
  const ST = { ok: ['🟢', 'En plazo'], risk: ['🟠', 'Va justo'], late: ['🔴', 'Atrasado'], done: ['✅', 'Hecho'] };
  function renderMilestones() {
    const ms = state.milestones || [];
    $('#ms-count').textContent = ms.filter((m) => !m.done).length || '';
    $('#milestones').innerHTML = ms.map((m) => {
      const [ic, lab] = ST[m.status] || ST.ok;
      const when = m.done ? 'hecho' : m.days === 0 ? '¡hoy!' : m.days > 0 ? `en ${m.days} día${m.days === 1 ? '' : 's'}` : `hace ${-m.days} día${m.days === -1 ? '' : 's'}`;
      const prog = m.hours ? Math.min(100, (m.spent / m.hours) * 100) : 0;
      return `<div class="ms ${m.status}" data-id="${m.id}">
        <div class="row between"><b>${ic} ${esc(m.title)}</b><span class="pill" title="${lab}">${when}</span></div>
        <div class="muted small">${m.project ? `📁 ${esc(m.project)} · ` : ''}${esc(m.due)}${m.hours ? ` · ${m.spent}/${m.hours} h${m.remaining && !m.done ? ` · ~${m.perDay} h/día` : ''}` : ''}</div>
        ${m.hours ? `<div class="bar thin"><i style="width:${prog}%"></i></div>` : ''}
        <div class="row gap"><button class="ghost mini ms-done">${m.done ? '↩ Reabrir' : '✅ Hecho'}</button><button class="icon mini ms-del" title="Borrar" aria-label="Borrar">✕</button></div>
      </div>`;
    }).join('') || '<div class="muted small">Pon fechas de entrega a tus proyectos: te aviso a 7, 3 y 1 día, y si vas justo según tus horas.</div>';
    $('#ms-projects').innerHTML = Object.keys(Object.assign({}, ...Object.values(state.days || {}).map((d) => d.projects || {}))).map((p) => `<option value="${esc(p)}">`).join('');
    if (!$('#ms-due').value) { const d = new Date(Date.now() + 7 * 864e5); $('#ms-due').value = d.toISOString().slice(0, 10); }
    tr($('#milestones'));
  }
  $('#milestones').addEventListener('click', (e) => {
    const card = e.target.closest('.ms');
    if (!card) return;
    const m = (state.milestones || []).find((x) => x.id === card.dataset.id);
    if (e.target.closest('.ms-done')) pm.milestoneDone(m.id, !m.done);
    if (e.target.closest('.ms-del') && confirm(`¿Borrar el hito "${m.title}"?`)) pm.milestoneDelete(m.id);
  });
  $('#ms-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = await pm.milestoneSave({ title: $('#ms-title').value, project: $('#ms-project').value, due: $('#ms-due').value, hours: $('#ms-hours').value });
    if (ok) { $('#ms-title').value = ''; $('#ms-project').value = ''; $('#ms-hours').value = ''; toast('🏁 Hito guardado'); }
  });

  // ================= REVISIÓN DEL VIERNES =================
  async function openFriday() {
    $('#o-friday').classList.remove('hidden');
    $('#fr-report').textContent = 'Cargando…';
    const d = await pm.fridayData();
    $('#fr-report').textContent = d.report;
    $('#fr-goals').innerHTML = (d.goals || []).map((g) => `<div class="goal" data-id="${g.id}"><div class="row between"><span class="gt">${esc(g.text)}</span><span class="small muted g-pct">${g.progress || 0}%</span></div>
      <input type="range" min="0" max="100" step="10" value="${g.progress || 0}" class="g-range" style="--p:${g.progress || 0}%" aria-label="Progreso de ${esc(g.text)}"></div>`).join('') || '<div class="muted small">No definiste objetivos esta semana. ¡El lunes te los propongo! 🎯</div>';
    const pending = ((state.today && state.today.standup && state.today.standup.today) || []).filter((t) => !t.done).map((t) => t.text);
    const prev = state.nextWeekPlan && Date.now() - state.nextWeekPlan.at < 3 * 864e5 ? state.nextWeekPlan.plan : null;
    $('#fr-plan').value = (prev || pending).join('\n');
    tr($('#o-friday'));
  }
  $('#fr-goals').addEventListener('input', (e) => {
    if (!e.target.classList.contains('g-range')) return;
    e.target.style.setProperty('--p', e.target.value + '%');
    e.target.closest('.goal').querySelector('.g-pct').textContent = e.target.value + '%';
  });
  $('#fr-close').addEventListener('click', () => $('#o-friday').classList.add('hidden'));
  $('#fr-save').addEventListener('click', async () => {
    await pm.fridaySave({
      plan: $('#fr-plan').value.split('\n'),
      note: $('#fr-note').value,
      goals: $$('#fr-goals .goal').map((g) => ({ id: g.dataset.id, progress: Number(g.querySelector('input').value) })),
    });
    $('#o-friday').classList.add('hidden');
  });

  // ================= PERSONALIDAD =================
  function renderPersonality() {
    const cur = state.personality || 'motivador';
    $('#personality').innerHTML = (state.personas || []).map((p) => `<button class="sp ${p.id === cur ? 'on' : ''}" data-pers="${p.id}" aria-pressed="${p.id === cur}"><span>${p.emoji}</span>${esc(p.name)}</button>`).join('');
    tr($('#personality'));
  }
  $('#personality').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pers]');
    if (b) pm.updateSettings({ personality: b.dataset.pers });
  });

  // ================= CASITA =================
  function renderHome() {
    const items = state.home || [];
    const own = items.filter((h) => h.owned);
    $('#home-count').textContent = `${own.length}/${items.length}`;
    const petEmoji = { chick: '🐥', duck: '🦆', cat: '🐱', penguin: '🐧' }[state.pet.species] || '🐥';
    const col = (state.collection && state.collection.items || []).filter((c) => c.count).slice(0, 6);
    $('#home').innerHTML = `<div class="wall"></div><div class="floor"></div>`
      + own.map((h) => `<span class="furn ${h.cls || ''}" style="left:${h.x}%;top:${h.y}%;z-index:${h.z}" title="${esc(h.name)}">${h.emoji}</span>`).join('')
      + (own.some((h) => h.id === 'shelf') && col.length ? `<span class="shelf-items" style="left:38%;top:38%">${col.map((c) => c.emoji).join('')}</span>` : '')
      + `<span class="room-pet ${state.music ? 'dance' : ''}" style="left:48%;top:70%">${petEmoji}</span>`
      + (!own.length ? '<span class="room-empty">Casita vacía… ¡decórala con 🌽!</span>' : '');
    $('#home-shop').innerHTML = items.filter((h) => !h.owned).map((h) => `<button class="hs" data-home="${h.id}" ${h.locked ? 'disabled' : ''} title="${esc(h.name)}">${h.emoji}<small>${h.locked ? `🏅${h.need}` : `${h.price}🌽`}</small></button>`).join('');
    tr($('#home-shop'));
  }
  $('#home-shop').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-home]');
    if (!b) return;
    const r = await pm.buyHome(b.dataset.home);
    if (r && r.error) toast(r.error);
  });

  // ================= COLECCIÓN =================
  function renderCollection() {
    const c = state.collection;
    if (!c) return;
    $('#col-count').textContent = `${c.got}/${c.total}`;
    const eggs = c.eggs.map((e) => `<span class="egg" title="Se abre en ${e.need - e.progress} pomodoro(s)">🥚<i style="width:${(e.progress / e.need) * 100}%"></i></span>`).join('');
    $('#collection').innerHTML = `<div class="row between"><span>${eggs || '<span class="muted">Sin huevos ahora</span>'}</span><span class="muted">próximo huevo en ${c.nextEggIn} 🍅</span></div>
      <div class="col-grid">${c.items.map((it) => `<span class="ci ${it.rarity} ${it.count ? '' : 'missing'}" title="${it.count ? `${it.emoji} ×${it.count} (${it.rarity})` : '???'}">${it.count ? it.emoji : '❔'}</span>`).join('')}</div>`;
    tr($('#collection'));
  }

  // ================= DIARIO =================
  function renderDiary() {
    const d = state.petDiary || [];
    $('#diary').innerHTML = d.length
      ? d.slice(0, 5).map((e) => `<article class="entry"><div class="muted small">${esc(e.day)}</div><p>${esc(e.text)}</p></article>`).join('')
      : '<div class="muted small">Cada noche escribo lo que hicimos. ¡Mañana tendrás tu primera entrada! 📜</div>';
  }
  $('#diary-write').addEventListener('click', async (e) => {
    e.currentTarget.textContent = '✍️ Escribiendo…';
    await pm.writeDiary();
    e.currentTarget.textContent = '✍️ Escribir hoy';
  });

  // ================= SESIONES DE CLAUDE EN VIVO =================
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h`; };
  const dur = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
  const ST_S = { working: ['🟢', 'trabajando'], waiting: ['🙋', 'te espera'], idle: ['💤', 'en pausa'] };
  function renderSessions() {
    const list = state.claudeSessions || [];
    const box = $('#live-sessions');
    box.classList.toggle('hidden', !list.length && !(state.integrations && state.integrations.hooks));
    box.innerHTML = `<div class="row between"><b>🎬 Sesiones de Claude en vivo</b><span class="pill">${list.filter((s) => s.state === 'working').length} trabajando</span></div>`
      + (list.length ? list.map((s) => {
        const [ic, lab] = s.stuck ? ['🧐', '¿atascada?'] : ST_S[s.state] || ST_S.idle;
        return `<div class="ses ${s.state} ${s.stuck ? 'stuck' : ''}"><div class="row between"><b>${ic} ${esc(s.project)}</b><span class="muted">${lab}${s.state === 'working' && s.workingSince ? ' · ' + dur(s.workingSince) : ''}</span></div>
          <div class="muted">${s.prompts} petición${s.prompts === 1 ? '' : 'es'} · ${fmtTokens(s.tokens)} tokens · $${(s.cost || 0).toFixed(2)}${s.model ? ' · ' + esc(s.model) : ''} · ${ago(s.lastActivity)}</div>
          ${s.waitingMsg && s.state === 'waiting' ? `<div class="small">💬 ${esc(s.waitingMsg)}</div>` : ''}</div>`;
      }).join('') : '<div class="muted">Ninguna sesión abierta. Cuando uses Claude Code, las verás aquí en tiempo real.</div>');
    tr(box);
  }

  // ================= enganches =================
  const prevOpen = window.openExtra;
  window.openExtra = (view) => {
    if (view === 'friday') return openFriday();
    return prevOpen && prevOpen(view);
  };
  const prevRender = window.renderExtras;
  window.renderExtras = () => {
    if (prevRender) prevRender();
    renderQueue();
    renderSessions();
    renderBudget();
    renderDev();
    renderMilestones();
    renderPersonality();
    renderHome();
    renderCollection();
    renderDiary();
  };
  // Si el panel ya pintó antes de cargar este archivo, repinta con todo.
  if (typeof state !== 'undefined' && state) render();
})();

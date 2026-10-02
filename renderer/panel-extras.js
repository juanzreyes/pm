// Panel: diario de Claude, prompts, bloques de tiempo, objetivos, hábitos, notas, especie y juegos.
/* global $, $$, esc, state, show, flashTo, toast */
(() => {
  const pad = (n) => String(n).padStart(2, '0');
  const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
  const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const tr = (el) => { if (state && state.lang && state.lang !== 'es' && el) I18N.translateDom(el, state.lang); };

  // ================= DÍA =================
  function renderBlocksNext() {
    const now = state.blockNow, next = state.blockNext, n = (state.blocks || []).length;
    $('#blocks-next').innerHTML = '<div>' + (now
      ? `▶ <b>Ahora:</b> ${esc(now.title)} <span class="muted">hasta las ${now.end}</span>${next ? `<br><span class="muted">Después: ${next.start} ${esc(next.title)}</span>` : ''}`
      : next
        ? `⏭ <b>Siguiente:</b> ${next.start} · ${esc(next.title)}`
        : n ? '✅ Terminaste los bloques de hoy' : '<span class="muted">Reparte tus tareas en horas del día y te aviso al empezar cada bloque.</span>') + '</div>';
  }

  function renderGoals() {
    const goals = state.goals || [];
    $('#goals-week').textContent = goals.length ? `${goals.filter((g) => g.progress >= 100).length}/${goals.length}` : 'semana';
    if ($('#goals input:focus')) return;
    $('#goals').innerHTML = goals.map((g) => `<li class="goal ${g.progress >= 100 ? 'done' : ''}" data-id="${g.id}">
      <div class="row between"><span class="gt">${g.progress >= 100 ? '✅ ' : ''}${esc(g.text)}</span><button class="icon mini g-del" title="Quitar">✕</button></div>
      <div class="row gap"><input type="range" min="0" max="100" step="10" value="${g.progress || 0}" class="g-range" style="--p:${g.progress || 0}%" aria-label="Progreso"><span class="small muted g-pct">${g.progress || 0}%</span></div>
    </li>`).join('') || '<li class="muted small">Define hasta 5 objetivos. El viernes te digo cómo te fue 🎯</li>';
    $('#goal-form').classList.toggle('hidden', goals.length >= 5);
  }
  $('#goals').addEventListener('input', (e) => {
    if (!e.target.classList.contains('g-range')) return;
    e.target.closest('li').querySelector('.g-pct').textContent = e.target.value + '%';
    e.target.style.setProperty('--p', e.target.value + '%');
  });
  $('#goals').addEventListener('change', (e) => {
    if (!e.target.classList.contains('g-range')) return;
    pm.goalSave({ id: e.target.closest('li').dataset.id, progress: Number(e.target.value) });
  });
  $('#goals').addEventListener('click', (e) => {
    if (e.target.closest('.g-del')) pm.goalDelete(e.target.closest('li').dataset.id);
  });
  $('#goal-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#goal-input').value.trim();
    if (v) pm.goalSave({ text: v });
    $('#goal-input').value = '';
  });

  function renderHabits() {
    $('#habits').innerHTML = (state.habits || []).map((h) => {
      const ok = h.today >= h.target;
      return `<div class="habit ${ok ? 'ok' : ''}" data-id="${h.id}" title="${esc(h.name)} · clic +1 · clic derecho −1">
        <button class="h-plus"><span class="h-emo">${esc(h.emoji)}</span><span class="h-name">${esc(h.name)}</span>
        <span class="h-count">${h.target > 1 ? `${h.today}/${h.target}` : ok ? '✔' : '—'}</span></button>
        ${h.streak > 0 ? `<span class="h-streak" title="Racha">🔥${h.streak}</span>` : ''}
        <button class="h-del icon mini" title="Quitar hábito">✕</button>
      </div>`;
    }).join('');
  }
  $('#habits').addEventListener('click', (e) => {
    const card = e.target.closest('.habit');
    if (!card) return;
    if (e.target.closest('.h-del')) { if (confirm('¿Quitar este hábito?')) pm.habitDelete(card.dataset.id); return; }
    pm.habitStep(card.dataset.id, 1);
  });
  $('#habits').addEventListener('keydown', (e) => {
    const card = e.target.closest('.habit');
    if (!card || !['-', '+', 'Subtract', 'Add'].includes(e.key)) return;
    e.preventDefault();
    pm.habitStep(card.dataset.id, e.key === '-' || e.key === 'Subtract' ? -1 : 1);
  });
  $('#habits').addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.habit');
    if (!card) return;
    e.preventDefault();
    pm.habitStep(card.dataset.id, -1);
  });
  $('#habit-add').addEventListener('click', () => {
    $('#habit-form').classList.toggle('hidden');
    if (!$('#habit-form').classList.contains('hidden')) $('#habit-name').focus();
  });
  $('#habit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#habit-name').value.trim();
    if (!name) return;
    pm.habitSave({ emoji: $('#habit-emoji').value.trim() || '⭐', name, target: Number($('#habit-target').value) || 1 });
    $('#habit-name').value = '';
    $('#habit-form').classList.add('hidden');
  });

  // Notas: autoguardado.
  let noteTimer = null;
  function renderNotes() {
    if (document.activeElement !== $('#notes') && $('#notes').value !== (state.notes || '')) $('#notes').value = state.notes || '';
  }
  $('#notes').addEventListener('input', () => {
    $('#notes-saved').textContent = 'escribiendo…';
    clearTimeout(noteTimer);
    noteTimer = setTimeout(async () => { await pm.setNotes($('#notes').value); $('#notes-saved').textContent = '✓ guardado'; }, 700);
  });
  let searchTimer = null;
  $('#notes-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const q = $('#notes-search').value.trim();
      const res = q.length >= 2 ? await pm.searchNotes(q) : [];
      $('#notes-results').innerHTML = q.length < 2 ? '' : res.length
        ? res.map((r) => `<div class="nr"><b>${esc(r.day)}</b> ${esc(r.snippet)}</div>`).join('')
        : '<div class="muted small">Sin resultados</div>';
    }, 250);
  });

  // 🛠️ En qué trabajé hoy: resumen redactado por proyecto (no la lista de lo que le escribiste a Claude).
  let summary = null; // { text, by, at }
  let summaryAt = 0;
  let loading = false;
  const BY = { ai: 'redactado con Claude', claude: 'redactado con Claude Code', local: 'resumen automático' };
  function paintSummary() {
    const box = $('#claude-journal');
    if (!summary || !summary.text) {
      box.innerHTML = loading ? MOTION.skeleton(4, 'Redactando en qué trabajaste')
        : '<span class="muted">Aún no hay trabajo de hoy que resumir. Cuando trabajes en tus proyectos (commits, Claude Code o tiempo en el editor) lo verás aquí, ya redactado, y en tu daily de mañana.</span>';
      return;
    }
    const blocks = summary.text.split(/\n\s*\n/).map((b) => {
      const [head, ...rest] = b.split('\n');
      return `<div class="cj"><b>${esc(head)}</b><p>${esc(rest.join(' '))}</p></div>`;
    }).join('');
    box.innerHTML = `${blocks}<div class="row between"><span class="muted small">${BY[summary.by] || ''}</span><button class="ghost mini" id="cj-copy">📋 Copiar</button></div>`;
    $('#cj-copy').onclick = () => { navigator.clipboard.writeText(summary.text); toast('📋 Copiado'); };
  }
  async function loadSummary(force = false) {
    if (loading) return;
    loading = true;
    summaryAt = Date.now();
    if (force || !summary) paintSummary();
    try { summary = await pm.workSummary('today', force); } catch { /* se queda el anterior */ }
    loading = false;
    paintSummary();
  }
  // Se pide al abrir el panel y, como mucho, cada 30 min (si nada cambió, sale de lo guardado).
  function renderJournal() {
    if (!summary || Date.now() - summaryAt > 30 * 60e3) loadSummary();
    else paintSummary();
  }
  $('#journal-ai').addEventListener('click', () => loadSummary(true));

  $('#btn-blocks').addEventListener('click', () => show('blocks'));
  $('#btn-monthly').addEventListener('click', () => pm.monthlyPdf('current'));
  $('#st-pdf').addEventListener('click', () => pm.monthlyPdf('current'));
  $('#chip-prompts').addEventListener('click', () => show('prompts'));

  // ================= MASCOTA: especie y juegos =================
  const SPECIES = [['chick', '🐥', 'Pollito'], ['duck', '🦆', 'Patito'], ['cat', '🐱', 'Gatito'], ['penguin', '🐧', 'Pingüino']];
  function renderSpecies() {
    const cur = state.pet.species || 'chick';
    $('#species').innerHTML = SPECIES.map(([id, e, n]) => `<button class="sp ${cur === id ? 'on' : ''}" data-sp="${id}"><span>${e}</span>${n}</button>`).join('');
  }
  $('#species').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sp]');
    if (b) pm.setSpecies(b.dataset.sp);
  });
  // Elegir especie también al nacer (bienvenida).
  $('#onb-species').innerHTML = SPECIES.map(([id, e, n], i) => `<button type="button" class="sp ${i === 0 ? 'on' : ''}" data-sp="${id}"><span>${e}</span>${n}</button>`).join('');
  $('#onb-species').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sp]');
    if (!b) return;
    $$('#onb-species .sp').forEach((x) => x.classList.toggle('on', x === b));
  });
  $('#play-corn').addEventListener('click', () => pm.play('corn'));
  $('#play-ball').addEventListener('click', () => pm.play('ball'));
  $('#play-stroll').addEventListener('click', () => pm.play('stroll'));

  // ================= BIBLIOTECA DE PROMPTS =================
  function renderPrompts() {
    const list = (state.prompts || []).slice().sort((a, b) => (b.uses || 0) - (a.uses || 0));
    $('#pr-list').innerHTML = list.map((p) => `<div class="pr" data-id="${p.id}">
      <button class="pr-main" title="Copiar"><b>${esc(p.title)}</b><span class="muted small">${esc(p.text.slice(0, 90))}${p.text.length > 90 ? '…' : ''}</span></button>
      <div class="pr-tools"><button class="icon mini pr-edit" title="Editar">✎</button><button class="icon mini pr-del" title="Borrar">✕</button></div>
    </div>`).join('') || '<div class="muted small">No hay prompts todavía.</div>';
    tr($('#pr-list'));
  }
  function resetPromptForm() {
    $('#pr-id').value = ''; $('#pr-title').value = ''; $('#pr-text').value = '';
    $('#pr-save').textContent = '＋ Guardar prompt';
    $('#pr-cancel').classList.add('hidden');
  }
  $('#pr-list').addEventListener('click', async (e) => {
    const card = e.target.closest('.pr');
    if (!card) return;
    const p = (state.prompts || []).find((x) => x.id === card.dataset.id);
    if (e.target.closest('.pr-del')) { if (confirm(`¿Borrar "${p.title}"?`)) pm.promptDelete(p.id); return; }
    if (e.target.closest('.pr-edit')) {
      $('#pr-id').value = p.id; $('#pr-title').value = p.title; $('#pr-text').value = p.text;
      $('#pr-save').textContent = '💾 Guardar cambios';
      $('#pr-cancel').classList.remove('hidden');
      $('#pr-title').focus();
      return;
    }
    await pm.promptCopy(p.id);
    card.classList.add('copied');
    setTimeout(() => card.classList.remove('copied'), 900);
    toast('📋 Copiado. ¡Pégalo en Claude!');
  });
  $('#pr-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await pm.promptSave({ id: $('#pr-id').value || undefined, title: $('#pr-title').value, text: $('#pr-text').value });
    resetPromptForm();
  });
  $('#pr-cancel').addEventListener('click', resetPromptForm);
  $('#pr-close').addEventListener('click', () => $('#o-prompts').classList.add('hidden'));

  // ================= BLOQUES DE TIEMPO =================
  const DAY_START = 6 * 60, DAY_END = 24 * 60, PX = 0.9; // px por minuto
  let blocksDraft = null; // copia local mientras editas
  let resizing = null;
  const tasksList = () => ((state.today && state.today.standup && state.today.standup.today) || []);

  function renderBlocksPlanner() {
    if (resizing) return;
    blocksDraft = (state.blocks || []).map((b) => ({ ...b }));
    const tasks = tasksList();
    const planned = new Set(blocksDraft.map((b) => b.task).filter((x) => x !== undefined));
    $('#bl-tasks').innerHTML = tasks.map((t, i) => (t.done ? '' : `<span class="bl-chip ${planned.has(i) ? 'planned' : ''}" draggable="true" data-i="${i}">${esc(t.text)}</span>`)).join('')
      + '<span class="bl-chip free" draggable="true" data-i="-1">＋ Bloque libre</span>';
    const tl = $('#bl-timeline');
    tl.style.height = (DAY_END - DAY_START) * PX + 'px';
    let html = '';
    for (let m = DAY_START; m < DAY_END; m += 60) html += `<div class="bl-hour" style="top:${(m - DAY_START) * PX}px">${pad(m / 60)}:00</div>`;
    // Reuniones del calendario (no editables).
    for (const ev of (state.calendar && state.calendar.events) || []) {
      if (ev.allDay) continue;
      const s = new Date(ev.start), e = new Date(ev.end);
      if (s.toDateString() !== new Date().toDateString()) continue;
      const a = Math.max(DAY_START, s.getHours() * 60 + s.getMinutes()), b = Math.min(DAY_END, e.getHours() * 60 + e.getMinutes());
      if (b > a) html += `<div class="bl-meet" style="top:${(a - DAY_START) * PX}px;height:${(b - a) * PX}px">📅 ${esc(ev.title)}</div>`;
    }
    blocksDraft.forEach((b, k) => {
      const a = Math.max(DAY_START, toMin(b.start)), z = Math.min(DAY_END, toMin(b.end));
      html += `<div class="bl-block" data-k="${k}" style="top:${(a - DAY_START) * PX}px;height:${Math.max(14, (z - a) * PX)}px">
        <span class="bl-t">${b.start}–${b.end} · ${esc(b.title)}</span><button class="bl-x" title="Quitar">✕</button><i class="bl-resize"></i></div>`;
    });
    const now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
    if (nm >= DAY_START && nm < DAY_END) html += `<div class="bl-now" style="top:${(nm - DAY_START) * PX}px"></div>`;
    tl.innerHTML = html;
    const sel = $('#bl-kb-task');
    if (document.activeElement !== sel) sel.innerHTML = tasks.map((t, i) => (t.done ? '' : `<option value="${i}">${esc(t.text.slice(0, 40))}</option>`)).join('') + '<option value="-1">＋ Bloque libre</option>';
    tr($('#o-blocks'));
  }
  const minAt = (clientY) => {
    const r = $('#bl-timeline').getBoundingClientRect();
    return Math.max(DAY_START, Math.min(DAY_END - 15, DAY_START + Math.round((clientY - r.top) / PX / 15) * 15));
  };
  const saveBlocks = () => pm.setBlocks(blocksDraft);

  $('#bl-tasks').addEventListener('dragstart', (e) => {
    const c = e.target.closest('.bl-chip');
    if (c) e.dataTransfer.setData('text/plain', c.dataset.i);
  });
  $('#bl-timeline').addEventListener('dragover', (e) => e.preventDefault());
  $('#bl-timeline').addEventListener('drop', (e) => {
    e.preventDefault();
    const i = Number(e.dataTransfer.getData('text/plain'));
    const start = minAt(e.clientY);
    const title = i >= 0 ? (tasksList()[i] || {}).text : ($('#bl-free').value.trim() || 'Foco profundo');
    if (!title) return;
    blocksDraft.push({ start: fromMin(start), end: fromMin(Math.min(DAY_END, start + 60)), title, task: i >= 0 ? i : undefined });
    saveBlocks();
  });
  $('#bl-timeline').addEventListener('click', (e) => {
    const x = e.target.closest('.bl-x');
    if (!x) return;
    blocksDraft.splice(Number(x.closest('.bl-block').dataset.k), 1);
    saveBlocks();
  });
  $('#bl-timeline').addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.bl-resize');
    if (!h) return;
    e.preventDefault();
    const k = Number(h.closest('.bl-block').dataset.k);
    resizing = { k, el: h.closest('.bl-block') };
    h.setPointerCapture(e.pointerId);
  });
  $('#bl-timeline').addEventListener('pointermove', (e) => {
    if (!resizing) return;
    const b = blocksDraft[resizing.k];
    const end = Math.max(toMin(b.start) + 15, minAt(e.clientY));
    b.end = fromMin(end);
    resizing.el.style.height = (end - toMin(b.start)) * PX + 'px';
    resizing.el.querySelector('.bl-t').textContent = `${b.start}–${b.end} · ${b.title}`;
  });
  $('#bl-timeline').addEventListener('pointerup', () => {
    if (!resizing) return;
    resizing = null;
    saveBlocks();
  });
  $('#bl-close').addEventListener('click', () => $('#o-blocks').classList.add('hidden'));
  // Añadir un bloque sin ratón: tarea + hora de inicio y fin.
  $('#bl-kb').addEventListener('submit', (e) => {
    e.preventDefault();
    const i = Number($('#bl-kb-task').value);
    const start = $('#bl-kb-start').value, end = $('#bl-kb-end').value;
    if (!start || !end || toMin(end) <= toMin(start)) return toast('La hora de fin debe ser después del inicio ⏰');
    const title = i >= 0 ? (tasksList()[i] || {}).text : ($('#bl-free').value.trim() || 'Foco profundo');
    blocksDraft.push({ start, end, title, task: i >= 0 ? i : undefined });
    saveBlocks();
  });

  // ================= MODO FOCO =================
  let focusTimer = null;
  function renderFocus() {
    const on = !!state.focusMode;
    const box = $('#focus-box');
    box.classList.toggle('on', on);
    $('#focus-start').classList.toggle('hidden', on);
    $('#focus-stop').classList.toggle('hidden', !on);
    $('#focus-time').classList.toggle('hidden', !state.focusUntil);
    const why = { manual: 'Solo lo urgente; lo demás te espera en avisos.', block: 'Activado por tu bloque de tiempo.', pomodoro: 'Activado por el pomodoro.' };
    $('#focus-title').textContent = on ? '🎯 Modo foco activo' : '🎯 Modo foco';
    $('#focus-sub').textContent = on ? why[state.focusMode] || '' : 'Solo te molesto con lo urgente; lo demás te espera en avisos.';
    clearInterval(focusTimer);
    if (state.focusUntil) {
      const tick = () => {
        const left = Math.max(0, Math.round((state.focusUntil - Date.now()) / 1000));
        $('#focus-time').textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
      };
      tick();
      focusTimer = setInterval(tick, 1000);
    }
    tr(box);
  }
  $('#focus-start').addEventListener('click', (e) => {
    const b = e.target.closest('[data-focus]');
    if (b) pm.focusStart(Number(b.dataset.focus));
  });
  $('#focus-stop').addEventListener('click', () => pm.focusStop());

  // ================= RECURRENTES =================
  function renderRecurring() {
    const list = state.recurring || [];
    $('#rec-count').textContent = list.length || '';
    if ($('#rec-list input:focus')) return;
    $('#rec-list').innerHTML = list.map((r) => `<li data-id="${r.id}"><span class="grow">${esc(r.text)} <span class="muted small">· ${esc(r.label)}</span></span><button class="icon mini rec-del" title="Quitar">✕</button></li>`).join('')
      || '<li class="muted small">Tareas que se repiten: se añaden solas a tu daily los días que toca.</li>';
    tr($('#recurring'));
  }
  $('#rec-list').addEventListener('click', (e) => {
    if (e.target.closest('.rec-del')) pm.deleteRecurring(e.target.closest('li').dataset.id);
  });
  $('#rec-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('#rec-text').value.trim();
    if (!text) return;
    pm.addRecurring({ text, days: $('#rec-days').value.split(',').map(Number) });
    $('#rec-text').value = '';
  });

  // ================= PLANTILLAS DE DÍA =================
  function renderTemplates() {
    $('#bl-templates').innerHTML = (state.templates || []).map((t) => `<span class="tpl" data-id="${t.id}" title="${t.blocks} bloques · ${t.tasks} tareas">
      <button class="tpl-apply">${esc(t.emoji || '🧩')} ${esc(t.name)}</button><button class="tpl-del" title="Borrar plantilla">✕</button></span>`).join('');
  }
  $('#bl-templates').addEventListener('click', (e) => {
    const t = e.target.closest('.tpl');
    if (!t) return;
    if (e.target.closest('.tpl-del')) { if (confirm('¿Borrar esta plantilla?')) pm.deleteTemplate(t.dataset.id); return; }
    pm.applyTemplate(t.dataset.id);
  });
  $('#tpl-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#tpl-name').value.trim();
    if (!name) return;
    const ok = await pm.saveTemplate(name);
    if (ok) { $('#tpl-name').value = ''; toast('🧩 Plantilla guardada'); } else toast('Primero crea algún bloque hoy 🗓️');
  });

  // ================= NOVEDADES =================
  const closeNews = () => $('#o-whatsnew').classList.add('hidden');
  $('#wn-close').addEventListener('click', closeNews);
  $('#wn-ok').addEventListener('click', closeNews);

  // ================= enganches con panel.js =================
  window.openExtra = (view) => {
    if (view === 'whatsnew') { tr($('#o-whatsnew')); $('#o-whatsnew').classList.remove('hidden'); return; }
    if (view === 'prompts') { resetPromptForm(); renderPrompts(); $('#o-prompts').classList.remove('hidden'); }
    if (view === 'blocks') {
      renderTemplates();
      renderBlocksPlanner();
      $('#o-blocks').classList.remove('hidden');
      setTimeout(() => { const n = $('.bl-now') || $('.bl-block'); if (n) n.scrollIntoView({ block: 'center' }); }, 60);
    }
  };
  window.renderExtras = () => {
    renderBlocksNext();
    renderGoals();
    renderHabits();
    renderNotes();
    renderJournal();
    renderSpecies();
    renderFocus();
    renderRecurring();
    if (!$('#o-prompts').classList.contains('hidden') && !$('#pr-form').contains(document.activeElement)) renderPrompts();
    if (!$('#o-blocks').classList.contains('hidden')) { renderTemplates(); renderBlocksPlanner(); }
  };
})();

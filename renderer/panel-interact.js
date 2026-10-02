// Panel · interacción (pulido 5/6): tooltips con su atajo, hoja de atajos (?), flechas en la lista
// de tareas, menú contextual de una tarea y arrastrar una tarea al pollito (cronómetro) o a la
// cola de Claude; soltar enlaces/archivos sobre el panel crea tareas.
/* global $, $$, esc, state, toast, pm, MOTION, show, dragFrom */
(() => {
  // ================= Tooltips con atajo =================
  // "Ajustes (Ctrl+,)" → tooltip "Ajustes" con la tecla en una cajita, en vez del tooltip del sistema.
  const KEY_RE = /\s*\(((?:Ctrl|Alt|Shift|Esc|Supr|Enter|[0-9A-Z/?,.]|F\d+)(?:\+[^)]{1,8})?)\)\s*$/;
  const tip = document.createElement('div');
  tip.id = 'tip';
  tip.setAttribute('role', 'tooltip');
  document.body.append(tip);
  let tipTimer = null;
  function adopt(el) {
    const t = el.getAttribute('title');
    if (!t) return;
    const m = KEY_RE.exec(t);
    el.dataset.tip = m ? t.slice(0, m.index) : t;
    if (m) el.dataset.kbd = m[1];
    el.removeAttribute('title');
    if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', el.dataset.tip);
  }
  const extraTitles = { '#task-input': 'Añadir tarea (N)', '#chat-input': 'Hablar con el pollito (/)', '#journal-ai': 'Volver a redactar el resumen' };
  for (const [sel, t] of Object.entries(extraTitles)) { const el = $(sel); if (el && !el.getAttribute('title')) el.setAttribute('title', t); }
  for (const el of $$('header [title], nav [title], #task-input[title], #chat-input[title]')) adopt(el);
  function showTip(el) {
    tip.innerHTML = `${esc(el.dataset.tip)}${el.dataset.kbd ? ` <kbd>${esc(el.dataset.kbd)}</kbd>` : ''}`;
    tip.classList.add('on');
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const below = r.bottom + t.height + 8 < innerHeight;
    tip.style.left = Math.max(6, Math.min(innerWidth - t.width - 6, r.left + r.width / 2 - t.width / 2)) + 'px';
    tip.style.top = (below ? r.bottom + 6 : r.top - t.height - 6) + 'px';
  }
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    clearTimeout(tipTimer);
    if (!el) { tip.classList.remove('on'); return; }
    tipTimer = setTimeout(() => showTip(el), 380);
  });
  // Con el teclado (Tab), el tooltip también aparece al enfocar; no cuando la app enfoca un campo sola.
  let lastTab = 0;
  document.addEventListener('keydown', (e) => { if (e.key === 'Tab') lastTab = Date.now(); }, true);
  document.addEventListener('focusin', (e) => { const el = e.target.closest('[data-tip]'); if (el && Date.now() - lastTab < 600 && !/^(INPUT|TEXTAREA)$/.test(el.tagName)) showTip(el); });
  document.addEventListener('focusout', () => tip.classList.remove('on'));
  document.addEventListener('mousedown', () => { clearTimeout(tipTimer); tip.classList.remove('on'); });

  // ================= Hoja de atajos (?) =================
  const KEYS = [
    ['1 … 5', 'Cambiar de pestaña'], ['N', 'Nueva tarea'], ['/', 'Hablar con el pollito'], ['P', 'Empezar / parar pomodoro'],
    ['↑ ↓', 'Moverte por las tareas'], ['Espacio', 'Marcar la tarea como hecha'], ['Supr', 'Quitar la tarea (con deshacer)'],
    ['Shift+F10', 'Menú de la tarea'], ['Ctrl+K', 'Paleta de comandos'], ['Ctrl+,', 'Ajustes'], ['Esc', 'Cerrar'], ['?', 'Esta ayuda'],
  ];
  const sheet = document.createElement('div');
  sheet.id = 'o-keys';
  sheet.className = 'overlay hidden';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Atajos de teclado');
  sheet.innerHTML = `<div class="row between"><h2>⌨️ Atajos de teclado</h2><button type="button" class="icon" id="keys-close" aria-label="Cerrar">✕</button></div>
    <div class="keys">${KEYS.map(([k, d]) => `<div><span>${esc(d)}</span><kbd>${esc(k)}</kbd></div>`).join('')}</div>
    <p class="muted small">Con el pollito: mantenlo presionado para el menú rápido, frótalo para hacerle una caricia, lánzalo… y suéltale enlaces o archivos para crear tareas.</p>`;
  $('#card').append(sheet);
  MOTION.watchOverlays('#o-keys');
  $('#keys-close').addEventListener('click', () => sheet.classList.add('hidden'));
  document.addEventListener('keydown', (e) => {
    const typing = document.activeElement.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select, [contenteditable="true"]');
    if (!typing && e.key === '?') { sheet.classList.toggle('hidden'); e.preventDefault(); }
    else if (e.key === 'Escape' && !sheet.classList.contains('hidden')) { sheet.classList.add('hidden'); e.stopImmediatePropagation(); }
  }, true);

  // ================= Menú contextual de una tarea =================
  const menu = document.createElement('div');
  menu.id = 'ctx';
  menu.setAttribute('role', 'menu');
  menu.className = 'hidden';
  document.body.append(menu);
  let menuIdx = null;
  const task = (i) => ((state.today && state.today.standup && state.today.standup.today) || [])[i];
  function openMenu(i, x, y) {
    const t = task(i);
    if (!t) return;
    menuIdx = i;
    const P = { h: 'Alta', m: 'Media', l: 'Baja', '': 'Ninguna' };
    menu.innerHTML = [
      `<button role="menuitem" data-a="timer">${t.startedAt ? '⏸ Pausar cronómetro' : '▶ Iniciar cronómetro'}</button>`,
      t.done ? '' : '<button role="menuitem" data-a="claude">🤖 Mandar a la cola de Claude</button>',
      t.done ? '' : '<button role="menuitem" data-a="later">📅 Pasar a mañana</button>',
      `<div class="ctx-prio" role="group" aria-label="Prioridad">${['h', 'm', 'l', ''].map((p) => `<button role="menuitemradio" aria-checked="${(t.priority || '') === p}" data-a="prio" data-p="${p}" class="prio ${p}" title="Prioridad ${P[p].toLowerCase()}">${P[p]}</button>`).join('')}</div>`,
      '<button role="menuitem" data-a="edit">✏️ Editar</button>',
      '<button role="menuitem" data-a="del" class="danger">🗑 Quitar <kbd>Supr</kbd></button>',
    ].join('');
    menu.classList.remove('hidden');
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, innerWidth - r.width - 6) + 'px';
    menu.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
    menu.querySelector('button').focus();
  }
  const closeMenu = () => { menu.classList.add('hidden'); menuIdx = null; };
  async function doAction(a, i, p) {
    const t = task(i);
    if (!t) return;
    if (a === 'timer') pm.taskTimer(i, t.startedAt ? 'stop' : 'start');
    else if (a === 'claude') { await pm.queueAdd(t.text.replace(/^↳\s*/, ''), ''); toast('🤖 Enviada a la cola de Claude'); }
    else if (a === 'later') { const r = await pm.taskLater(i); if (r.ok) toast('📅 La verás en el daily del próximo día laborable'); }
    else if (a === 'prio') pm.updateTask(i, { priority: p });
    else if (a === 'edit') { const el = document.querySelector(`#tasks [data-edit="${i}"]`); if (el) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }
    else if (a === 'del') { const removed = await pm.removeTask(i); if (removed) toast(`Tarea eliminada: “${removed.text}”`, () => pm.restoreTask(i, removed)); }
  }
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-a]');
    if (!b || menuIdx === null) return;
    const i = menuIdx;
    closeMenu();
    doAction(b.dataset.a, i, b.dataset.p);
  });
  menu.addEventListener('keydown', (e) => {
    const bs = [...menu.querySelectorAll('button')];
    const k = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { bs[(k + 1) % bs.length].focus(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { bs[(k - 1 + bs.length) % bs.length].focus(); e.preventDefault(); }
    else if (e.key === 'Escape') { const i = menuIdx; closeMenu(); focusRow(i); e.stopPropagation(); }
  });
  document.addEventListener('mousedown', (e) => { if (!menu.contains(e.target)) closeMenu(); });
  window.addEventListener('blur', closeMenu);
  $('#tasks').addEventListener('contextmenu', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    e.preventDefault();
    openMenu(Number(li.dataset.i), e.clientX, e.clientY);
  });

  // ================= Teclado en la lista de tareas =================
  function focusRow(i) {
    const cb = document.querySelector(`#tasks li[data-i="${i}"] input[type=checkbox]`);
    if (cb) cb.focus();
  }
  $('#tasks').addEventListener('keydown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li || e.target.matches('input.edit, input.tedit')) return;
    const i = Number(li.dataset.i);
    const n = $$('#tasks li[data-i]').length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { focusRow(Math.max(0, Math.min(n - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))); e.preventDefault(); }
    else if (e.key === 'Delete') { doAction('del', i); setTimeout(() => focusRow(Math.min(i, n - 2)), 200); e.preventDefault(); }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { const r = li.getBoundingClientRect(); openMenu(i, r.left + 30, r.bottom - 4); e.preventDefault(); }
  });

  // ================= Arrastrar una tarea al pollito o a la cola =================
  const zones = [
    { el: $('header .avatar'), label: 'Suelta para cronometrar', act: (i) => { const t = task(i); pm.taskTimer(i, 'start'); toast(`⏱️ Cronómetro en marcha: “${t.text}”`); $('header .avatar').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25) rotate(-8deg)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.3,1.45,.5,1)' }); } },
    { el: $('#claude-queue'), label: 'Suelta para mandarla a Claude', act: async (i) => { const t = task(i); await pm.queueAdd(t.text, ''); toast('🤖 Enviada a la cola de Claude'); } },
  ].filter((z) => z.el);
  for (const z of zones) {
    z.el.dataset.dropLabel = z.label;
    z.el.addEventListener('dragover', (e) => { if (dragFrom === null) return; e.preventDefault(); z.el.classList.add('drop-hot'); });
    z.el.addEventListener('dragleave', () => z.el.classList.remove('drop-hot'));
    z.el.addEventListener('drop', (e) => {
      if (dragFrom === null) return;
      e.preventDefault();
      e.stopPropagation();
      z.el.classList.remove('drop-hot');
      z.act(dragFrom);
    });
  }
  $('#tasks').addEventListener('dragstart', () => document.body.classList.add('dragging-task'));
  document.addEventListener('dragend', () => { document.body.classList.remove('dragging-task'); for (const z of zones) z.el.classList.remove('drop-hot'); });

  // Soltar enlaces, textos o archivos (desde el navegador o el Explorador) sobre el panel → tareas.
  document.addEventListener('dragover', (e) => {
    if (dragFrom !== null || !e.dataTransfer || ![...e.dataTransfer.types].some((t) => t === 'Files' || t === 'text/uri-list' || t === 'text/plain')) return;
    e.preventDefault();
    document.body.classList.add('drop-ext');
  });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('drop-ext'); });
  document.addEventListener('drop', async (e) => {
    document.body.classList.remove('drop-ext');
    if (dragFrom !== null || e.defaultPrevented) return;
    const dt = e.dataTransfer;
    const files = [...(dt.files || [])].map((f) => ({ name: f.name, path: pm.pathForFile(f) }));
    const url = (dt.getData('text/uri-list') || '').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) || '';
    const text = dt.getData('text/plain') || '';
    if (!files.length && !url && !text.trim()) return;
    e.preventDefault();
    const r = await pm.petDrop({ files, url, text });
    if (r && r.ok !== false) { toast(files.length ? `📎 ${files.length} archivo${files.length === 1 ? '' : 's'} en tus tareas` : '📌 Anotado en tus tareas'); show('day'); }
  });
})();

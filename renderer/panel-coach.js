// Panel 2.0 · productividad: mis proyectos (¿dónde me quedé? y contextos), logros, notas de
// reunión → tareas y el aviso del modo pato de goma.
/* global $, $$, esc, state, toast, I18N */
(() => {
  const tr = (el) => { if (state && state.lang && state.lang !== 'es' && el) I18N.translateDom(el, state.lang); };

  // ================= 🎯 MIS PROYECTOS =================
  let repos = [];
  let reposLoaded = false;
  let showAll = false;
  async function loadRepos() {
    if (reposLoaded) return;
    reposLoaded = true;
    try { repos = (await pm.gitRepos()).map((r) => r.name); } catch { reposLoaded = false; }
    render();
  }
  function render() {
    const where = state.where || { contexts: {} };
    const r = where.lastResume;
    $('#pj-resume').classList.toggle('hidden', !r || Date.now() - r.at > 12 * 3600e3);
    if (r) $('#pj-resume').innerHTML = `<b>📍 ${esc(r.project)}</b>${r.lines.map((l) => `<div>${esc(l)}</div>`).join('')}`;
    // Primero los que más usaste estas dos semanas; el resto, a un clic.
    const used = {};
    for (const d of Object.values(state.days || {})) for (const [p, s] of Object.entries(d.projects || {})) used[p.toLowerCase()] = (used[p.toLowerCase()] || 0) + s;
    const sorted = repos.slice().sort((a, b) => (used[b.toLowerCase()] || 0) - (used[a.toLowerCase()] || 0) || a.localeCompare(b));
    const shown = showAll ? sorted : sorted.slice(0, 6);
    $('#pj-more').classList.toggle('hidden', sorted.length <= 6);
    $('#pj-more').textContent = showAll ? 'Ver menos' : `Ver todos (${sorted.length})`;
    $('#pj-list').innerHTML = repos.length ? shown.map((name) => {
      const c = where.contexts[name] || { links: [], music: '', focus: 0 };
      return `<div class="pj" data-p="${esc(name)}">
        <div class="row between"><b>${esc(name)}</b><span class="row gap">
          <button type="button" class="primary mini pj-open" title="Abrir el editor, sus enlaces, su música y el modo foco">▶ Trabajar</button>
          <button type="button" class="ghost mini pj-where" title="¿Dónde me quedé?">📍</button></span></div>
        <details class="small"><summary class="muted">Contexto: ${c.links.length} enlace${c.links.length === 1 ? '' : 's'}${c.music ? ' · 🎵' : ''}${c.focus ? ` · 🎯 ${c.focus} min` : ''}</summary>
          <form class="pj-form col">
            <textarea name="links" rows="2" placeholder="Enlaces (uno por línea): tablero de Jira, staging, docs… (https://)">${esc(c.links.join('\n'))}</textarea>
            <input name="music" placeholder="Música de foco (https://open.spotify.com/… o spotify:…)" value="${esc(c.music)}" />
            <div class="row gap"><label class="small">Modo foco <input name="focus" type="number" min="0" max="240" step="5" value="${c.focus || 0}" style="width:70px" /> min</label><button class="soft mini" type="submit">Guardar</button></div>
          </form></details>
      </div>`;
    }).join('') : '<span class="muted small">No encontré repos de git (Ajustes → Integraciones → Carpetas con tus repos).</span>';
    tr($('#pj-section'));
  }
  $('#pj-more').addEventListener('click', () => { showAll = !showAll; render(); });
  $('#pj-list').addEventListener('click', async (e) => {
    const pj = e.target.closest('.pj');
    if (!pj) return;
    const name = pj.dataset.p;
    if (e.target.closest('.pj-open')) { const r = await pm.contextOpen(name); if (!r.ok) toast('😿 ' + r.error); }
    if (e.target.closest('.pj-where')) { e.target.closest('button').disabled = true; try { await pm.whereResume(name); } finally { e.target.closest('button').disabled = false; } }
  });
  $('#pj-list').addEventListener('submit', async (e) => {
    const f = e.target.closest('.pj-form');
    if (!f) return;
    e.preventDefault();
    await pm.contextSave(f.closest('.pj').dataset.p, { links: f.links.value, music: f.music.value, focus: f.focus.value });
    toast('✅ Contexto guardado');
  });
  $$('[data-brag]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { const r = await pm.brag(b.dataset.brag); if (r && !r.ok) toast('😿 ' + r.error); } finally { b.disabled = false; }
  }));

  // ================= 📝 NOTAS DE REUNIÓN =================
  let items = [];
  function openMeeting() {
    $('#o-meeting').classList.remove('hidden');
    if (state.settings && state.settings.myName && !$('#mt-me').value) $('#mt-me').value = state.settings.myName;
    setTimeout(() => $('#mt-text').focus(), 50);
    tr($('#o-meeting'));
  }
  $('#pj-meeting').addEventListener('click', openMeeting);
  $('#mt-close').addEventListener('click', () => $('#o-meeting').classList.add('hidden'));
  $('#mt-go').addEventListener('click', async () => {
    const me = $('#mt-me').value.trim();
    if (me && me !== (state.settings || {}).myName) pm.updateSettings({ myName: me });
    $('#mt-go').disabled = true;
    $('#mt-go').textContent = '⏳ Leyendo…';
    try {
      const r = await pm.meetingActions($('#mt-text').value);
      if (!r.ok) { toast('😿 ' + r.error); return; }
      items = r.items;
      $('#mt-list').classList.remove('hidden');
      $('#mt-actions').classList.toggle('hidden', !items.length);
      $('#mt-list').innerHTML = items.length
        ? `<div class="muted small">${items.length} acciones (leídas con ${esc(r.via)}):</div>` + items.map((x, i) => `<label class="mt-item"><input type="checkbox" data-i="${i}" ${x.mine ? 'checked' : ''} /> ${esc(x.text)}${x.owner ? ` <span class="pill">${esc(x.owner)}</span>` : ''}</label>`).join('')
        : '<span class="muted">No encontré acciones claras. Prueba con líneas tipo "Ana: enviar el informe" o "Acción: …".</span>';
      tr($('#mt-list'));
    } finally { $('#mt-go').disabled = false; $('#mt-go').textContent = '🔎 Sacar acciones'; }
  });
  $('#mt-add').addEventListener('click', async () => {
    const pickd = $$('#mt-list input[type=checkbox]').filter((c) => c.checked).map((c) => items[Number(c.dataset.i)].text);
    if (!pickd.length) return toast('Marca al menos una');
    await pm.meetingAdd(pickd);
    $('#o-meeting').classList.add('hidden');
    $('#mt-text').value = '';
    $('#mt-list').classList.add('hidden');
    $('#mt-actions').classList.add('hidden');
  });
  $('#mt-copy').addEventListener('click', () => {
    const others = $$('#mt-list input[type=checkbox]').filter((c) => !c.checked).map((c) => items[Number(c.dataset.i)]);
    if (!others.length) return toast('No hay acciones de otras personas');
    pm.copy(others.map((x) => `• ${x.owner ? x.owner + ': ' : ''}${x.text}`).join('\n'));
    toast('📋 Copiadas para pegarlas en el chat de la reunión');
  });

  // ================= 🦆 MODO PATO =================
  function renderDuck() { $('#duck-banner').classList.toggle('hidden', !(state.coach && state.coach.duck)); }

  const prevOpen = window.openExtra;
  window.openExtra = (view) => (view === 'meetingnotes' ? openMeeting() : prevOpen && prevOpen(view));
  const prevRender = window.renderExtras;
  window.renderExtras = () => { if (prevRender) prevRender(); render(); renderDuck(); loadRepos(); };
  if (typeof state !== 'undefined' && state) window.renderExtras();
})();

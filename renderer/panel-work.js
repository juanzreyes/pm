// Panel 1.6: tickets del equipo (Jira, GitHub Issues, Linear, Azure DevOps) y lo que hizo
// Claude con la cola (ejecuciones en una copia aparte del repo: ver, aceptar o descartar).
/* global $, esc, state, toast, I18N */
(() => {
  const tr = (el) => { if (state && state.lang && state.lang !== 'es' && el) I18N.translateDom(el, state.lang); };
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`; };
  const EMOJI = { github: '🐙', jira: '🟦', linear: '🟪', azure: '🔷' };

  // ================= TICKETS =================
  function renderTickets() {
    const tk = state.tickets || {};
    const box = $('#tickets');
    const on = tk.status && tk.status !== 'off';
    box.classList.toggle('hidden', !on);
    if (!on) return;
    const list = tk.issues || [];
    const pending = list.filter((i) => !i.inDay).length;
    $('#tk-count').textContent = String(list.length);
    $('#tk-all').classList.toggle('hidden', !pending);
    $('#tk-when').textContent = tk.at ? ago(tk.at) : '';
    const errs = (tk.errors || []).map((e) => `<div class="small err">⚠️ ${esc(e.label)}: ${esc(e.error)}</div>`).join('');
    $('#tk-list').innerHTML = errs + (list.length
      ? list.map((i) => `<div class="tk-row" data-key="${esc(i.key2)}">
          <span class="tk-ic">${EMOJI[i.provider] || '🎫'}</span>
          <span class="grow"><button type="button" class="link tk-open" title="Abrir en el navegador">${esc(i.key)}</button> ${esc(i.title)}${i.status ? ` <span class="muted small">· ${esc(i.status)}</span>` : ''}</span>
          <span class="tk-acts">
            <button type="button" class="ghost mini tk-start" title="Empezar: rama con su nombre, cronómetro y &quot;en curso&quot;">▶</button>
            <button type="button" class="ghost mini tk-claude" title="Mandarlo a la cola de Claude">🤖</button>
            ${i.inDay ? '<span class="muted small" title="Ya está en tus tareas de hoy">✓ hoy</span>' : '<button type="button" class="ghost mini tk-add" title="Añadir a mis tareas de hoy">＋</button>'}
          </span>
        </div>${picking && picking.key === i.key2 ? repoPicker(i) : ''}`).join('')
      : '<div class="muted small">No tienes tickets abiertos asignados. 🎉</div>');
    tr(box);
  }
  // Elegir el repo la primera vez que se trabaja un ticket de un proyecto (luego se recuerda).
  let picking = null; // { key, action, msg }
  const repoPicker = (i) => `<form class="tk-pick row gap" data-key="${esc(i.key2)}"><span class="small">${esc(picking.msg)}</span>
    <select class="tk-repo" aria-label="Repositorio">${repoNames.map((n) => `<option>${esc(n)}</option>`).join('')}</select>
    <button class="primary mini" type="submit">OK</button><button type="button" class="link tk-cancel">Cancelar</button></form>`;
  async function ticketAction(key, action, repo) {
    const r = await (action === 'start' ? pm.ticketStart(key, repo) : pm.ticketClaude(key, repo));
    if (r.needRepo) { picking = { key, action, msg: r.error }; renderTickets(); return; }
    picking = null;
    renderTickets();
    if (!r.ok) toast('😿 ' + r.error);
  }
  $('#tk-list').addEventListener('click', (e) => {
    if (e.target.closest('.tk-cancel')) { picking = null; renderTickets(); return; }
    const row = e.target.closest('.tk-row');
    if (!row) return;
    if (e.target.closest('.tk-add')) pm.ticketAdd(row.dataset.key);
    if (e.target.closest('.tk-open')) pm.ticketOpen(row.dataset.key);
    if (e.target.closest('.tk-start')) ticketAction(row.dataset.key, 'start');
    if (e.target.closest('.tk-claude')) ticketAction(row.dataset.key, 'claude');
  });
  $('#tk-list').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.closest('.tk-pick');
    if (f && picking) ticketAction(f.dataset.key, picking.action, f.querySelector('.tk-repo').value);
  });
  $('#tk-all').addEventListener('click', () => pm.ticketAdd('*'));
  $('#tk-refresh').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try { await pm.ticketsRefresh(); } finally { b.disabled = false; }
  });

  // ================= LO QUE HIZO CLAUDE CON LA COLA =================
  const ST = {
    starting: ['⏳', 'preparando'], running: ['🤖', 'trabajando'], testing: ['🧪', 'probando los tests'], review: ['👀', 'revisa los cambios'], failed: ['😿', 'falló'],
    empty: ['💬', 'sin cambios'], accepted: ['✅', 'en su rama'], discarded: ['🗑️', 'descartado'], pr: ['🚀', 'PR abierto'],
  };
  function renderRuns() {
    const runs = state.claudeRuns || [];
    const box = $('#claude-runs');
    box.innerHTML = runs.length ? `<div class="row between small"><b>Lo que hizo Claude</b>${runs.some((r) => ['accepted', 'discarded', 'empty'].includes(r.status)) ? '<button type="button" class="link runs-clear">Limpiar</button>' : ''}</div>` + runs.map((r) => {
      const [ic, lab] = ST[r.status] || ['•', r.status];
      const stat = r.stat && r.stat.n ? ` · ${r.stat.n} archivo${r.stat.n === 1 ? '' : 's'} <span class="okmsg">+${r.stat.ins}</span> <span class="err">−${r.stat.del}</span>` : '';
      const cost = r.cost ? ` · $${r.cost.toFixed(2)}` : '';
      const prBtn = r.prReady ? '<button type="button" class="primary mini run-pr" title="Commit, subir la rama y abrir el pull request en GitHub">🚀 Crear PR</button>' : '';
      const btns = r.status === 'running' ? '<button type="button" class="ghost mini run-stop">⏹ Parar</button>'
        : r.status === 'review' ? `<button type="button" class="soft mini run-open">👀 Ver</button>${prBtn}<button type="button" class="${prBtn ? 'ghost' : 'primary'} mini run-accept" title="Guardar los cambios en la rama ${esc(r.branch || '')} (sin subir)">✅ ${prBtn ? 'Solo rama' : 'Aceptar'}</button><button type="button" class="ghost mini run-discard" aria-label="Descartar">🗑️</button>`
          : r.status === 'failed' ? `${r.stat && r.stat.n ? '<button type="button" class="soft mini run-open">👀 Ver</button><button type="button" class="ghost mini run-accept">Guardar igual</button>' : ''}<button type="button" class="ghost mini run-discard">🗑️ Descartar</button>`
            : r.status === 'accepted' ? prBtn
              : r.status === 'pr' && r.pr ? `<button type="button" class="soft mini run-openpr" data-url="${esc(r.pr)}">🔗 Ver PR</button>` : '';
      const tests = r.tests ? `<div class="small ${r.tests.ok ? 'okmsg' : 'err'}">${r.tests.ok ? '✅' : '⚠️'} ${esc(r.tests.label)} <span>${r.tests.ok ? 'pasa' : 'falla'}</span></div>${!r.tests.ok && r.tests.tail ? `<details class="small"><summary class="muted">Salida de los tests</summary><pre class="run-result">${esc(r.tests.tail)}</pre></details>` : ''}` : '';
      const resume = r.sessionId && ['review', 'failed', 'empty'].includes(r.status) ? `<button type="button" class="link run-resume" title="Seguir la conversación en una terminal, dentro de la copia del repo">claude --resume</button>` : '';
      return `<div class="run ${r.status}" data-id="${esc(r.id)}" data-ses="${esc(r.sessionId || '')}">
        <div class="row between"><span>${ic} <b>${esc(r.project)}</b> <span class="muted small"><span>${lab}</span>${r.status === 'running' ? ' · ' + ago(r.startedAt) : r.endedAt ? ' · ' + ago(r.endedAt) : ''}${stat}${cost}</span></span></div>
        <div class="small run-text">${r.issueKey ? `<span class="pill">${esc(r.issueKey)}</span> ` : ''}${esc(r.text.length > 120 ? r.text.slice(0, 119) + '…' : r.text)}</div>
        ${r.error ? `<div class="small err">${esc(r.error)}</div>` : ''}
        ${tests}
        ${r.result && r.status !== 'running' ? `<details class="small"><summary class="muted">Respuesta de Claude</summary><div class="run-result">${esc(r.result)}</div></details>` : ''}
        ${btns || resume ? `<div class="row gap wrap">${btns}${resume}</div>` : ''}
      </div>`;
    }).join('') : '';
    tr(box);
  }
  $('#claude-runs').addEventListener('click', async (e) => {
    if (e.target.closest('.runs-clear')) return pm.runsClear();
    const run = e.target.closest('.run');
    if (!run) return;
    const id = run.dataset.id;
    const b = e.target.closest('button');
    if (!b) return;
    if (b.classList.contains('run-open')) pm.runOpen(id);
    if (b.classList.contains('run-stop')) pm.runStop(id);
    if (b.classList.contains('run-accept')) { b.disabled = true; const r = await pm.runAccept(id); if (!r.ok) { b.disabled = false; toast('😿 ' + r.error); } }
    if (b.classList.contains('run-pr')) { b.disabled = true; b.textContent = '⏳ Subiendo…'; const r = await pm.runPr(id); if (!r.ok) { b.disabled = false; b.textContent = '🚀 Crear PR'; toast('😿 ' + r.error); } }
    if (b.classList.contains('run-openpr')) pm.command('open.url', b.dataset.url);
    if (b.classList.contains('run-discard') && confirm('¿Descartar lo que hizo Claude? Se borra la copia y su rama.')) pm.runDiscard(id);
    if (b.classList.contains('run-resume')) { pm.copy(`claude --resume ${run.dataset.ses}`); toast('📋 Copiado. Pégalo en una terminal abierta en la copia del repo (👀 Ver).'); }
  });

  // Proyectos para la cola: los repos de git que conozco.
  let reposLoaded = false;
  let repoNames = [];
  async function loadRepos() {
    if (reposLoaded) return;
    reposLoaded = true;
    try {
      const list = await pm.gitRepos();
      repoNames = list.map((r) => r.name);
      const sel = $('#queue-project');
      sel.innerHTML = '<option value="">Proyecto…</option>' + list.map((r) => `<option value="${esc(r.name)}">${esc(r.name)}</option>`).join('');
    } catch { reposLoaded = false; }
  }

  const prevRender = window.renderExtras;
  window.renderExtras = () => {
    if (prevRender) prevRender();
    renderTickets();
    renderRuns();
    loadRepos();
  };
  if (typeof state !== 'undefined' && state) window.renderExtras();
})();

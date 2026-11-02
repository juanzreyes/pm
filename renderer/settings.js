// Ventana de ajustes: menú lateral, buscador y todas las preferencias.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let state = null;
let current = new URLSearchParams(location.search).get('section') || 'general';
let loggingIn = false;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const isEn = () => state && state.lang === 'en';

// ---------- navegación y búsqueda ----------
function showSection(id) {
  current = id;
  $('#search').value = '';
  applySearch();
  $$('#snav button').forEach((b) => b.classList.toggle('active', b.dataset.sec === id));
  $$('.sec').forEach((s) => s.classList.toggle('hidden', s.id !== 'sec-' + id));
  const sec = $('#sec-' + id);
  $('#sec-title').textContent = sec ? sec.querySelector('h2') ? sec.querySelector('h2').textContent : sec.dataset.title : '';
  $('.scroll').scrollTop = 0;
}
$$('#snav button').forEach((b) => b.addEventListener('click', () => showSection(b.dataset.sec)));

function applySearch() {
  const q = norm($('#search').value.trim());
  if (!q) {
    $$('.opt').forEach((o) => o.classList.remove('hidden'));
    $$('.sec').forEach((s) => s.classList.toggle('hidden', s.id !== 'sec-' + current));
    $('#no-results').classList.add('hidden');
    return;
  }
  let any = false;
  for (const s of $$('.sec')) {
    let secHit = norm(s.dataset.title + ' ' + (s.querySelector('h2') || {}).textContent).includes(q);
    let optHits = 0;
    for (const o of s.querySelectorAll('.opt')) {
      const hit = secHit || norm(o.textContent).includes(q);
      o.classList.toggle('hidden', !hit);
      if (hit) optHits++;
    }
    const show = secHit || optHits > 0;
    s.classList.toggle('hidden', !show);
    any = any || show;
  }
  $$('#snav button').forEach((b) => b.classList.remove('active'));
  $('#sec-title').textContent = isEn() ? 'Search' : 'Búsqueda';
  $('#no-results').classList.toggle('hidden', any);
}
$('#search').addEventListener('input', applySearch);
$('#close').addEventListener('click', () => pm.closeSettings());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if ($('#search').value) { $('#search').value = ''; applySearch(); } else pm.closeSettings(); }
  if (e.key === 'f' && e.ctrlKey) { e.preventDefault(); $('#search').focus(); }
});
pm.onSettingsSection((id) => { showSection(id); if (id === 'diag') renderDiag(); });

// ---------- pintar estado ----------
function seg(el, value) {
  for (const b of el.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === value);
}

function render() {
  if (!state) return;
  const s = state.settings;
  document.documentElement.classList.toggle('dark', !!state.dark); document.documentElement.classList.toggle('contrast', !!state.contrast);
  document.documentElement.classList.toggle('acrylic', !!(state.winMaterialOk && state.settings && state.settings.winMaterial));
  document.documentElement.classList.toggle('reduced', !!s.reducedMotion);

  // General
  $('#lang').value = state.lang || 'es';
  $('#s-autostart').checked = !!state.autoStart;
  if (document.activeElement !== $('#s-morning')) $('#s-morning').value = s.morningTime;
  if (document.activeElement !== $('#s-evening')) $('#s-evening').value = s.eveningTime;
  renderSchedule();
  renderCloud();
  $('#s-chatter').checked = !!s.chatter;
  $('#s-focus-blocks').checked = s.focusDuringBlocks !== false;
  $('#s-personality').value = s.personality || 'motivador';
  $('#s-music').checked = s.musicMode !== false;
  $('#s-musicdetect').checked = s.musicDetect !== false;
  $('#s-musicdetect').disabled = s.musicMode === false;
  $('#s-builds').checked = s.buildWatch !== false;
  $('#bk-pass-info').textContent = s.hasBackupPass ? '🔐 Tus copias se guardan cifradas. Deja el campo vacío y guarda para quitar la contraseña.' : 'Opcional: cifra las copias (AES-256). Sin ella no se podrán abrir, ¡no la olvides!';
  $('#s-focus-pomo').checked = s.focusDuringPomodoro !== false;
  $('#mute').textContent = state.muted ? '🔔 Quitar silencio' : '🔕 Silenciar 1 hora';

  // Apariencia
  seg($('#theme'), s.theme || 'system');
  seg($('#size'), s.petSize || 'm');
  $('#discreet').checked = !!s.discreet;
  $('#auto-hide').checked = state.autoHide !== false;
  $('#reduced').checked = !!s.reducedMotion;
  $('#s-petfps').value = s.petFps || 'balanced';
  $('#s-sounds').checked = !!s.sounds;
  $('#voice').checked = s.voice !== false;
  if (document.activeElement !== $('#volume')) $('#volume').value = s.volume ?? 70;

  // Salud
  const h = state.health || {};
  $('#h-breaks').checked = h.breaks !== false;
  $('#h-eyes').checked = h.eyes !== false;
  $('#h-water').checked = h.water !== false;

  // Privacidad
  const paused = state.trackingPausedUntil;
  $('.pause-box').classList.toggle('paused', !!paused);
  $('#pause-status').textContent = paused
    ? `⏸️ Seguimiento en pausa hasta las ${new Date(paused).toLocaleTimeString(isEn() ? 'en' : 'es', { hour: '2-digit', minute: '2-digit' })}${new Date(paused).toDateString() !== new Date().toDateString() ? ' (mañana)' : ''}`
    : 'El seguimiento está activo 👀';
  $('#pause-resume').classList.toggle('hidden', !paused);
  $('#pause-1h').classList.toggle('hidden', !!paused);
  $('#pause-day').classList.toggle('hidden', !!paused);
  $('#s-focus').checked = !!s.focusWatch;
  $('#p-mic').checked = s.micWatch !== false;
  $('#p-git').checked = s.gitWatch !== false;
  $('#data-dir').textContent = state.dataDir || '';
  $('#p-clip').checked = s.smartClipboard !== false;
  $('#s-strolls').checked = s.strolls !== false;
  $('#s-follow').checked = s.followMonitor !== false;
  $('#opt-follow').classList.toggle('hidden', !state.multiMonitor);
  const bk = state.backup || {};
  $('#bk-auto').checked = bk.auto !== false;
  $('#bk-info').textContent = `📁 ${bk.dir || ''}` + (bk.lastAt ? ` · última: ${new Date(bk.lastAt).toLocaleString()}` : ' · aún no hay copias');

  // Integraciones
  const cc = state.claudeCode || {};
  const gh = state.github || {};
  $('#cc-status').textContent = cc.installed ? (cc.working ? '🤖 trabajando…' : '✅ conectado') : 'sin conectar';
  $('#cc-install').textContent = cc.installed ? '🔄 Reinstalar hooks' : 'Conectar con Claude Code';
  // Perfiles, sincronización, exportar, CLI, memoria
  const pr = state.profiles || { list: [] };
  if (document.activeElement !== $('#prof-sel')) $('#prof-sel').innerHTML = pr.list.map((p) => `<option value="${p.id}" ${p.id === pr.activeId ? 'selected' : ''}>${p.emoji} ${p.name}${p.id === pr.activeId ? ' (actual)' : ''}</option>`).join('');
  const sy = state.sync || {};
  $('#sync-on').checked = !!sy.enabled;
  $('#sync-info').textContent = `📁 ${sy.dir || ''}` + (sy.lastAt ? ` · última: ${new Date(sy.lastAt).toLocaleString()}` : '');
  const ex = state.exportsInfo || {};
  $('#md-auto').checked = !!ex.autoMarkdown;
  if (ex.markdownDir) $('#md-info').textContent = `📁 ${ex.markdownDir}` + (ex.lastMarkdownAt ? ` · última: ${new Date(ex.lastMarkdownAt).toLocaleString()}` : '');
  $('#cli-on').checked = !!state.cli;
  $('#s-lowmem').checked = s.lowMemory !== false;
  const it = state.integrations || {};
  $('#mcp-code').checked = !!it.mcpCode;
  $('#mcp-desktop').checked = !!it.mcpDesktop;
  $('#mcp-desktop-row').classList.toggle('hidden', !it.desktopAvailable);
  $('#mcp-statusline').checked = !!(it.statusline && it.statusline.installed);
  $('#sl-info').textContent = it.statusline && it.statusline.other ? '⚠️ Ya tienes otra línea de estado: la guardo y la restauro si lo quitas.' : 'Abajo en Claude Code: 🐣 42% · 🍅 12:30 · ✅ 3/7';
  $('#mcp-status').textContent = it.mcpCode || it.mcpDesktop ? 'conectado' : 'no conectado';
  $('#cc-uninstall').classList.toggle('hidden', !cc.installed);
  $('#gh-status').textContent = gh.status === 'ok' ? '✅ @' + gh.login : gh.hasToken ? '⚠️ error' : 'sin conectar';
  $('#gh-remove').classList.toggle('hidden', !gh.hasToken);
  if (document.activeElement !== $('#git-roots')) $('#git-roots').value = ((state.git && state.git.roots) || []).join('\n');

  // Cuenta de Claude
  const w = state.web || {};
  const c = (state.usage && state.usage.connection) || {};
  $('#web-status').innerHTML = w.connected
    ? `<b>✅ Conectado a claude.ai</b>${w.orgName ? ` <span class="muted">· ${esc(w.orgName)}</span>` : ''}`
    : c.status === 'ok' ? '<b>✅ Conectado</b> <span class="muted">(vía Claude Code o token)</span>' : '<span class="muted">Inicia sesión en la página oficial de Claude; yo solo leo tu uso.</span>';
  $('#web-login').textContent = loggingIn ? '⏳ Esperando a que inicies sesión…' : w.connected ? '🔄 Volver a conectar' : '🌐 Conectar con mi cuenta de Claude';
  $('#web-logout').classList.toggle('hidden', !w.connected);
  $('#token-clear').classList.toggle('hidden', !s.hasManualToken);

  // IA
  const a = state.ai || {};
  const sel = $('#ai-model');
  if (!sel.options.length) sel.innerHTML = Object.entries(a.models || {}).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  sel.value = a.model;
  $('#ai-enabled').checked = !!a.enabled;
  $('#ai-remove').classList.toggle('hidden', !a.hasKey);
  $('#ai-key').placeholder = a.hasKey ? '•••••••• (guardada)' : 'sk-ant-…';

  // Acerca de
  $('#version').textContent = `v${state.version}${state.packaged ? '' : ' (desarrollo)'}`;

  if (isEn()) I18N.translateDom(document.body, 'en');
}

// ---------- General ----------
$('#lang').addEventListener('change', async (e) => { await pm.updateSettings({ lang: e.target.value }); pm.command('lang-reload'); });
$('#s-autostart').addEventListener('change', (e) => pm.updateSettings({ autoStart: e.target.checked }));
$('#s-morning').addEventListener('change', (e) => e.target.value && pm.updateSettings({ morningTime: e.target.value }));
$('#s-evening').addEventListener('change', (e) => e.target.value && pm.updateSettings({ eveningTime: e.target.value }));
// ---------- Horario: días, comidas, pausas, descanso y días especiales ----------
function renderSchedule() {
  const r = state.routine;
  if (!r) return;
  const s = state.settings;
  for (const b of $$('#s-workdays button')) b.classList.toggle('on', r.workDays.includes(Number(b.dataset.d)));
  for (const [k, m] of Object.entries(r.meals)) {
    $(`[data-meal="${k}"]`).checked = m.on;
    if (document.activeElement !== $(`[data-meal-at="${k}"]`)) $(`[data-meal-at="${k}"]`).value = m.at;
    if (document.activeElement !== $(`[data-meal-min="${k}"]`)) $(`[data-meal-min="${k}"]`).value = m.min;
  }
  const box = $('#s-breaks');
  if (!box.contains(document.activeElement)) {
    box.innerHTML = r.breaks.map((b, i) => `<div class="sched-break" data-i="${i}"><input type="time" value="${esc(b.at)}" aria-label="Hora de la pausa" /> <input type="number" min="5" max="60" step="5" value="${b.min}" aria-label="Minutos" /> min <button type="button" class="ghost mini" data-del="${i}" title="Quitar">✕</button></div>`).join('') || '<span class="muted small">Sin pausas</span>';
  }
  $('#s-mealrem').checked = s.mealReminders !== false;
  $('#s-leisure').checked = s.leisure !== false;
  $('#s-extras').innerHTML = (r.extras || []).map((x) => `<div class="entry"><span>${x.off ? '🌴' : '📅'} <b>${esc(x.label)}</b> · ${x.off ? 'libre' : `de ${esc(x.start)} a ${esc(x.end)}`}</span><button type="button" class="ghost mini" data-date="${esc(x.date)}" data-start="${esc(x.start || '')}" title="Quitar">✕</button></div>`).join('');
  const ot = r.overtime;
  const fmt = (secs) => { const m = Math.round(secs / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
  $('#s-overtime').textContent = ot && ot.secs >= 60 ? `${fmt(ot.secs)} fuera de tu jornada${ot.night >= 60 ? ` (${fmt(ot.night)} nocturnas)` : ''}${ot.planned >= 60 ? ` · ${fmt(ot.planned)} en turno extra` : ''}` : 'Nada fuera de tu jornada 👌';
}
const readBreaks = () => $$('#s-breaks .sched-break').map((row) => { const [t, n] = row.querySelectorAll('input'); return { at: t.value, min: Number(n.value) || 15 }; }).filter((b) => /^\d{2}:\d{2}$/.test(b.at));
$('#s-workdays').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-d]');
  if (!b) return;
  b.classList.toggle('on');
  pm.updateSettings({ workDays: $$('#s-workdays button.on').map((x) => Number(x.dataset.d)) });
});
$('.sched-meals').addEventListener('change', () => {
  const meals = {};
  for (const k of ['breakfast', 'lunch', 'dinner']) meals[k] = { on: $(`[data-meal="${k}"]`).checked, at: $(`[data-meal-at="${k}"]`).value, min: Number($(`[data-meal-min="${k}"]`).value) || 30 };
  pm.updateSettings({ meals });
});
$('#s-breaks').addEventListener('change', () => pm.updateSettings({ breaks: readBreaks() }));
$('#s-breaks').addEventListener('click', (e) => {
  const d = e.target.closest('[data-del]');
  if (d) pm.updateSettings({ breaks: readBreaks().filter((_, i) => i !== Number(d.dataset.del)) });
});
$('#s-break-add').addEventListener('click', () => pm.updateSettings({ breaks: [...readBreaks(), { at: '15:00', min: 15 }] }));
$('#s-mealrem').addEventListener('change', (e) => pm.updateSettings({ mealReminders: e.target.checked, breakReminders: e.target.checked }));
$('#s-leisure').addEventListener('change', (e) => pm.updateSettings({ leisure: e.target.checked }));
// ---------- Tus dispositivos (ecosistema en la nube) ----------
let pairHide = null;
function renderCloud() {
  const c = state.cloud || { on: false };
  $('#cl-off').classList.toggle('hidden', !!c.on);
  $('#cl-on').classList.toggle('hidden', !c.on);
  if (!c.on) return;
  const st = c.status || {};
  const pill = $('#cl-status');
  pill.textContent = st.state === 'ok' ? 'Al día' : st.state === 'error' ? 'Sin conexión' : 'Conectando…';
  pill.title = st.error || (st.at ? 'Última vez: ' + new Date(st.at).toLocaleTimeString() : '');
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`; };
  $('#cl-devices').innerHTML = (c.devices || []).map((d) => `<div class="entry"><span>${d.kind === 'phone' ? '📱' : '🖥️'} <b>${esc(d.name)}</b>${d.me ? ' <span class="muted">(este)</span>' : ''}</span><span class="muted small">${d.at ? ago(d.at) : ''}</span></div>`).join('') || '<span class="muted small">Solo este dispositivo por ahora.</span>';
  if (document.activeElement !== $('#cl-name')) $('#cl-name').value = c.name || '';
}
$('#cl-create').addEventListener('click', async (e) => {
  e.target.disabled = true;
  $('#cl-msg').textContent = 'Creando…';
  const r = await pm.cloudCreate();
  e.target.disabled = false;
  if (!r || !r.ok) { $('#cl-msg').textContent = 'No pude crearlo: ' + ((r && r.error) || 'sin conexión'); return; }
  $('#cl-msg').textContent = '';
  showPairing(r);
});
$('#cl-join').addEventListener('click', async (e) => {
  const code = $('#cl-code').value.trim();
  if (!code) return;
  e.target.disabled = true;
  $('#cl-msg').textContent = 'Conectando…';
  const r = await pm.cloudJoin(code);
  e.target.disabled = false;
  $('#cl-msg').textContent = r && r.ok ? '¡Listo! Ya está todo sincronizado.' : (r && r.error) || 'No pude unirme.';
  if (r && r.ok) $('#cl-code').value = '';
});
function showPairing(r) {
  $('#cl-qr').src = r.qr;
  $('#cl-shortcode').textContent = r.code;
  $('#cl-pair').classList.remove('hidden');
  $('#cl-show').textContent = 'Ocultar código';
  let left = 120;
  clearInterval(pairHide);
  $('#cl-pair-left').textContent = 'Se oculta en 2 min';
  pairHide = setInterval(() => {
    left -= 1;
    if (left <= 0) hidePairing();
    else $('#cl-pair-left').textContent = `Se oculta en ${left} s`;
  }, 1000);
}
function hidePairing() {
  clearInterval(pairHide);
  $('#cl-pair').classList.add('hidden');
  $('#cl-qr').removeAttribute('src');
  $('#cl-shortcode').textContent = '';
  $('#cl-show').textContent = 'Mostrar código';
}
$('#cl-show').addEventListener('click', async () => {
  if (!$('#cl-pair').classList.contains('hidden')) { hidePairing(); return; }
  const r = await pm.cloudPairing();
  if (r) showPairing(r);
});
$('#cl-copy').addEventListener('click', () => { pm.copy($('#cl-shortcode').textContent); $('#cl-copy').textContent = '¡Copiado!'; setTimeout(() => { $('#cl-copy').textContent = 'Copiar código'; }, 1500); });
$('#cl-sync').addEventListener('click', async (e) => { e.target.disabled = true; await pm.cloudSync(); e.target.disabled = false; });
$('#cl-name').addEventListener('change', (e) => pm.cloudRename(e.target.value));
$('#cl-leave').addEventListener('click', async () => {
  if (!confirm('¿Desvincular este dispositivo? Tus datos se quedan aquí, pero dejan de sincronizarse.')) return;
  await pm.cloudLeave();
  hidePairing();
});
$('#cl-wipe').addEventListener('click', async () => {
  if (!confirm('¿Borrar tus datos del servidor? Se desvinculan TODOS tus dispositivos (cada uno conserva sus datos locales).')) return;
  await pm.cloudWipe();
  hidePairing();
});

async function addWorkExtra() {
  const t = $('#s-extra-text').value.trim();
  if (!t) return;
  const r = await pm.workExtra({ text: t });
  if (r && r.ok) $('#s-extra-text').value = '';
  $('#s-extra-text').setCustomValidity(r && r.ok ? '' : 'No lo entendí. Prueba: "trabajaré el domingo de 8 a 12" o "el lunes es feriado".');
  $('#s-extra-text').reportValidity();
}
$('#s-extra-add').addEventListener('click', addWorkExtra);
$('#s-extra-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') addWorkExtra(); });
$('#s-extra-text').addEventListener('input', (e) => e.target.setCustomValidity(''));
$('#s-extras').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-date]');
  if (b) pm.workExtra({ remove: { date: b.dataset.date, start: b.dataset.start } });
});
$('#s-personality').addEventListener('change', (e) => pm.updateSettings({ personality: e.target.value }));
$('#s-music').addEventListener('change', (e) => pm.updateSettings({ musicMode: e.target.checked }));
$('#s-musicdetect').addEventListener('change', (e) => pm.updateSettings({ musicDetect: e.target.checked }));
$('#s-builds').addEventListener('change', (e) => pm.updateSettings({ buildWatch: e.target.checked }));
$('#bk-pass-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await pm.setBackupPass($('#bk-pass').value);
  $('#bk-pass').value = '';
  $('#data-msg').textContent = '🔐 Contraseña de las copias actualizada';
});
$('#s-focus-blocks').addEventListener('change', (e) => pm.updateSettings({ focusDuringBlocks: e.target.checked }));
$('#s-focus-pomo').addEventListener('change', (e) => pm.updateSettings({ focusDuringPomodoro: e.target.checked }));

// ----- Diagnóstico -----
async function renderDiag() {
  const d = await pm.diagGet();
  $('#dg-mem').textContent = d.memory;
  $('#dg-cpu').textContent = d.cpu + '%';
  $('#dg-up').textContent = d.uptime;
  $('#dg-err').textContent = String(d.errors.length);
  $('#dg-ver').textContent = `PM Pollito ${d.version} · Electron ${d.electron} · ${d.os} · ${d.processes} procesos`;
  const escH = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  $('#dg-events').innerHTML = (d.events || []).length
    ? d.events.slice(0, 10).map((e) => `<div class="dg"><span class="muted small">${new Date(e.at).toLocaleString()}</span> ${escH(e.msg)}</div>`).join('')
    : '<div class="opt small muted">Nada que contar todavía.</div>';
  $('#dg-list').innerHTML = d.errors.length
    ? d.errors.slice(0, 20).map((e) => `<details class="dg"><summary><span class="muted small">${new Date(e.at).toLocaleString()} · ${escH(e.where)}</span> ${escH(e.msg.split('\n')[0].slice(0, 110))}</summary><pre>${escH(e.msg)}</pre></details>`).join('')
    : '<div class="opt small">✅ Sin errores desde que arrancó. ¡Todo en orden!</div>';
}
$('#dg-refresh').addEventListener('click', renderDiag);
$('#dg-open').addEventListener('click', () => pm.diagOpen());
$('#dg-copy').addEventListener('click', async () => {
  await pm.diagCopy();
  $('#dg-copy').textContent = '✓ Copiado';
  setTimeout(() => { $('#dg-copy').textContent = 'Copiar informe'; }, 1800);
});
document.querySelector('[data-sec="diag"]').addEventListener('click', renderDiag);
$('#s-chatter').addEventListener('change', (e) => pm.updateSettings({ chatter: e.target.checked }));
$('#mute').addEventListener('click', () => pm.command(state.muted ? 'unmute' : 'mute'));

// ---------- Apariencia ----------
$('#theme').addEventListener('click', async (e) => { const b = e.target.closest('button'); if (b) { state = await pm.setAppearance({ theme: b.dataset.v }); render(); } });
$('#size').addEventListener('click', async (e) => { const b = e.target.closest('button'); if (b) { state = await pm.setAppearance({ petSize: b.dataset.v }); render(); } });
$('#discreet').addEventListener('change', async (e) => { state = await pm.setAppearance({ discreet: e.target.checked }); render(); });
$('#auto-hide').addEventListener('change', (e) => pm.updateSettings({ autoHide: e.target.checked }));
$('#reduced').addEventListener('change', async (e) => { state = await pm.setAppearance({ reducedMotion: e.target.checked }); render(); });
$('#s-petfps').addEventListener('change', async (e) => { state = await pm.setAppearance({ petFps: e.target.value }); render(); });
$('#s-sounds').addEventListener('change', (e) => pm.updateSettings({ sounds: e.target.checked }));
$('#voice').addEventListener('change', (e) => pm.updateSettings({ voice: e.target.checked }));
$('#voice-test').addEventListener('click', () => pm.command('voice.test'));
$('#volume').addEventListener('change', async (e) => { state = await pm.setAppearance({ volume: Number(e.target.value) }); pm.command('ack'); });

// ---------- Salud ----------
for (const id of ['breaks', 'eyes', 'water']) {
  $('#h-' + id).addEventListener('change', async (e) => { state = await pm.updateIntegrations({ health: { [id]: e.target.checked } }); render(); });
}

// ---------- Privacidad y datos ----------
$('#pause-1h').addEventListener('click', async () => { state = await pm.pauseTracking(60); render(); });
$('#pause-day').addEventListener('click', async () => {
  const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(7, 0, 0, 0);
  state = await pm.pauseTracking(Math.round((t - Date.now()) / 60000));
  render();
});
$('#pause-resume').addEventListener('click', async () => { state = await pm.pauseTracking(0); render(); });
$('#s-focus').addEventListener('change', (e) => pm.updateSettings({ focusWatch: e.target.checked }));
$('#p-clip').addEventListener('change', (e) => pm.updateSettings({ smartClipboard: e.target.checked }));
$('#s-strolls').addEventListener('change', (e) => pm.updateSettings({ strolls: e.target.checked }));
$('#s-follow').addEventListener('change', (e) => pm.updateSettings({ followMonitor: e.target.checked }));
$('#bk-auto').addEventListener('change', (e) => pm.updateSettings({ autoBackup: e.target.checked }));
$('#bk-now').addEventListener('click', async () => {
  const r = await pm.backupNow();
  $('#data-msg').textContent = r && r.ok ? '✅ Copia guardada en ' + r.file : '❌ ' + ((r && r.error) || 'No se pudo copiar');
});
$('#bk-dir').addEventListener('click', () => pm.backupDir());
$('#bk-open').addEventListener('click', () => pm.backupOpen());
$('#p-mic').addEventListener('change', async (e) => { state = await pm.setPrivacy({ micWatch: e.target.checked }); render(); });
$('#p-git').addEventListener('change', async (e) => { state = await pm.setPrivacy({ gitWatch: e.target.checked }); render(); });
$('#open-dir').addEventListener('click', () => pm.openDataDir());
$('#export').addEventListener('click', async () => {
  const f = await pm.exportData();
  $('#data-msg').className = 'small okmsg';
  $('#data-msg').textContent = f ? `✅ Copia guardada en ${f}` : '';
});
$('#import').addEventListener('click', async () => {
  const r = await pm.importData();
  if (r && r.error) { $('#data-msg').className = 'small err'; $('#data-msg').textContent = '😿 ' + r.error; }
});
$('#delete').addEventListener('click', () => pm.deleteData());

// ---------- Integraciones ----------
$('#cc-install').addEventListener('click', async () => {
  const r = await pm.hooksInstall();
  $('#cc-msg').className = 'small ' + (r.ok ? 'okmsg' : 'err');
  $('#cc-msg').textContent = r.ok ? '✅ ¡Listo! Abre una sesión nueva de Claude Code para que empiece a avisarme.' : '😿 ' + r.error;
  if (r.ok) { state = r.state; render(); }
});
$('#cc-uninstall').addEventListener('click', async () => {
  const r = await pm.hooksUninstall();
  $('#cc-msg').className = 'small ' + (r.ok ? 'muted' : 'err');
  $('#cc-msg').textContent = r.ok ? 'Hooks quitados. Tu configuración de Claude Code quedó como antes.' : '😿 ' + r.error;
  if (r.ok) { state = r.state; render(); }
});
$('#gh-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = $('#gh-token').value.trim();
  if (!t) return;
  $('#gh-token').value = '';
  $('#gh-status').textContent = '⏳';
  state = await pm.setGithubToken(t);
  render();
});
$('#gh-remove').addEventListener('click', async () => { state = await pm.setGithubToken(''); render(); });
$('#git-roots-save').addEventListener('click', async () => {
  const roots = $('#git-roots').value.split('\n').map((x) => x.trim()).filter(Boolean);
  state = await pm.updateIntegrations({ gitRoots: roots });
  $('#git-roots-msg').textContent = '✅ Guardado. Buscando repos…';
  render();
});

// ---------- Cuenta de Claude ----------
$('#web-login').addEventListener('click', async () => {
  if (loggingIn) return;
  loggingIn = true;
  render();
  try { state = await pm.webLogin(); } finally { loggingIn = false; render(); }
});
$('#web-logout').addEventListener('click', async () => { state = await pm.webLogout(); render(); });
$('#token-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = $('#token-input').value.trim();
  if (!t) return;
  $('#token-input').value = '';
  state = await pm.setToken(t);
  render();
});
$('#token-clear').addEventListener('click', async () => { state = await pm.setToken(''); render(); });

// ---------- IA ----------
$('#ai-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const k = $('#ai-key').value.trim();
  if (!k) return;
  $('#ai-key').value = '';
  $('#ai-msg').className = 'small muted';
  $('#ai-msg').textContent = '⏳ Probando la API key…';
  const r = await pm.setAiKey(k);
  state = r.state;
  $('#ai-msg').className = 'small ' + (r.ok ? 'okmsg' : 'err');
  $('#ai-msg').textContent = r.ok ? '✅ ¡IA activada! Pregúntame lo que quieras en el chat.' : '😿 ' + r.error;
  render();
});
$('#ai-remove').addEventListener('click', async () => { const r = await pm.setAiKey(''); state = r.state; render(); });
$('#ai-model').addEventListener('change', (e) => pm.updateSettings({ aiModel: e.target.value }));
$('#ai-enabled').addEventListener('change', (e) => pm.updateSettings({ aiEnabled: e.target.checked }));

// ---------- Acerca de ----------
$('#check-updates').addEventListener('click', async () => {
  $('#upd-msg').textContent = '⏳';
  const r = await pm.checkUpdates();
  $('#upd-msg').textContent = r.ok ? `✅ v${r.version}` : r.error;
});
$('#tour').addEventListener('click', () => { pm.command('tour'); pm.closeSettings(); });
$('#quit').addEventListener('click', () => pm.quit());
$('#donate').addEventListener('click', () => pm.command('donate'));

// Enlaces externos
document.addEventListener('click', (e) => {
  const o = e.target.closest('[data-open]');
  if (o) pm.openExternal(o.dataset.open);
});

// ---------- estado ----------
pm.onState((s) => { state = s; render(); });
pm.getState().then((s) => { state = s; render(); showSection(current); });
if (current === 'diag') renderDiag();

// ----- MCP, línea de estado y memoria de proyecto -----
for (const [id, what] of [['#mcp-code', 'mcpCode'], ['#mcp-desktop', 'mcpDesktop'], ['#mcp-statusline', 'statusline']]) {
  $(id).addEventListener('change', async (e) => {
    const r = await pm.setIntegration(what, e.target.checked);
    $('#mcp-msg').textContent = r.ok ? (e.target.checked ? '✅ Listo. Reinicia Claude para que lo vea.' : 'Quitado.') : '❌ ' + r.error;
  });
}
pm.gitRepos().then((list) => {
  $('#pm-repo').innerHTML = list.map((r) => `<option value="${r.path.replace(/"/g, '&quot;')}">${r.name}</option>`).join('') || '<option value="">(no encontré repos git)</option>';
});
$('#pm-mem').addEventListener('click', async () => {
  const repo = $('#pm-repo').value;
  if (!repo) return;
  const r = await pm.updateProjectMemory(repo);
  $('#pm-mem-msg').textContent = r.ok ? '✅ Actualizado: ' + r.file : '❌ ' + r.error;
});

// ----- perfiles, sincronización, exportar, CLI, memoria -----
$('#prof-go').addEventListener('click', () => {
  const id = $('#prof-sel').value;
  if (id && id !== (state.profiles || {}).activeId && confirm('Cambiar de perfil reinicia PM. ¿Seguimos?')) pm.profileSwitch(id);
});
$('#prof-add').addEventListener('click', async () => {
  const name = $('#prof-name').value.trim();
  if (!name) return $('#prof-name').focus();
  await pm.profileAdd(name, $('#prof-emoji').value);
  $('#prof-name').value = '';
});
$('#prof-del').addEventListener('click', async () => {
  const id = $('#prof-sel').value;
  const p = ((state.profiles || {}).list || []).find((x) => x.id === id);
  if (!p || !confirm(`¿Borrar el perfil "${p.name}"? (se guarda una copia por si acaso)`)) return;
  const r = await pm.profileRemove(id);
  if (!r.ok) alert(r.error);
});
$('#sync-on').addEventListener('change', async (e) => { await pm.updateSettings({ syncEnabled: e.target.checked }); if (e.target.checked) pm.syncNow(); });
$('#sync-now').addEventListener('click', () => pm.syncNow());
$('#sync-dir').addEventListener('click', () => pm.syncDir());
$('#md-export').addEventListener('click', () => pm.exportMarkdown());
$('#md-auto').addEventListener('change', (e) => pm.updateSettings({ autoMarkdown: e.target.checked }));
$('#ics-export').addEventListener('click', () => pm.exportIcs());
$('#cli-on').addEventListener('change', async (e) => {
  const r = await pm.setCli(e.target.checked);
  $('#cli-msg').textContent = r.ok ? (r.on ? '✅ Listo: abre una terminal nueva y escribe pm' : 'Quitado.') : '❌ ' + r.error;
});
$('#s-lowmem').addEventListener('change', (e) => pm.updateSettings({ lowMemory: e.target.checked }));

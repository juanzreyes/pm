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
  document.documentElement.classList.toggle('reduced', !!s.reducedMotion);

  // General
  $('#lang').value = state.lang || 'es';
  $('#s-autostart').checked = !!state.autoStart;
  if (document.activeElement !== $('#s-morning')) $('#s-morning').value = s.morningTime;
  if (document.activeElement !== $('#s-evening')) $('#s-evening').value = s.eveningTime;
  $('#s-workdays').checked = !!s.workdaysOnly;
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
$('#s-workdays').addEventListener('change', (e) => pm.updateSettings({ workdaysOnly: e.target.checked }));
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

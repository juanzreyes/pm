// Panel: agenda (reuniones, calendario, correo y cuentas de Microsoft/Google). Separado de panel.js (usa $, $$, esc, state, render, show… de allí;
// se carga justo después y repinta si el panel ya se había pintado).
/* global $, $$, esc, state, render, show, LOC, hm, I18N */

// Inicio de sesión web con Microsoft/Google: se muestra en cuanto hay un ID de aplicación
// (Ajustes → Integraciones → Microsoft 365 / Google) o alguna cuenta ya conectada.
const webAccountsEnabled = () => !!(state.oauthReady && (state.oauthReady.microsoft || state.oauthReady.google)) || (state.accounts || []).length > 0;
function renderAgenda() {
  const now = Date.now();

  const live = $('#meeting-now');
  live.classList.toggle('hidden', !state.meetingNow);
  if (state.meetingNow) {
    const mins = Math.round((now - state.meetingNow.since) / 60000);
    live.textContent = `🎧 En reunión ${state.meetingNow.title ? `“${state.meetingNow.title}” ` : ''}(${state.meetingNow.app}) · ${mins} min`;
  }

  // Cuentas conectadas por inicio de sesión web (solo si hay un ID de aplicación configurado)
  $('#accounts').classList.toggle('hidden', !webAccountsEnabled());
  if (webAccountsEnabled()) renderAccounts();

  renderAgendaBody();
}

function renderAccounts() {
  const accs = state.accounts || [];
  const ready = state.oauthReady || {};
  const NAMES = { microsoft: 'Microsoft', google: 'Google' };
  $('#acc-list').innerHTML = accs.map((a) => `
    <div class="acc ${a.error ? 'bad' : ''}">
      <span>${a.error ? '⚠️' : '✅'} <b>${esc(NAMES[a.provider])}</b> · ${esc(a.email || 'conectado')}${a.error ? `<br><small>${esc(a.error)}</small>` : ''}</span>
      ${a.error ? `<button type="button" class="link" data-connect="${a.provider}">Reconectar</button>` : ''}
      <button type="button" class="link" data-disconnect="${a.provider}">Quitar</button>
    </div>`).join('');
  for (const b of $$('.acc-btn[data-connect]')) {
    const p = b.dataset.connect;
    const has = accs.some((a) => a.provider === p);
    b.classList.toggle('hidden', has);
    b.disabled = connecting === p || !ready[p];
    b.title = ready[p] ? '' : 'Falta configurar el ID de aplicación (oauth.config.json)';
    const small = b.querySelector('small');
    if (connecting === p) small.textContent = '⏳ Esperando que inicies sesión en el navegador…';
    else if (!ready[p]) small.textContent = '⚙️ Falta configurar (ver README)';
    else small.textContent = p === 'microsoft' ? 'Outlook · Hotmail · Microsoft 365 · Teams' : 'Gmail · Google Calendar · Meet';
  }
}

function renderAgendaBody() {
  const cal = state.calendar || {};
  const m = state.mail || {};
  const now = Date.now();
  // Reuniones
  const box = $('#meetings');
  if (!cal.configured) {
    box.innerHTML = '<div class="muted small">Conecta tu calendario (abajo 👇) y te avisaré 10 min antes de cada reunión de Teams, con botón para unirte.</div>';
  } else if (cal.status === 'error') {
    box.innerHTML = `<div class="err small">😿 ${esc(cal.error)}</div>`;
  } else {
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const list = (cal.events || []).filter((e) => !e.allDay && e.start <= end.getTime() && e.end > now - 4 * 3600e3);
    box.innerHTML = list.length
      ? list.map((e) => {
          const cls = e.start <= now && e.end > now ? 'now' : e.end <= now ? 'past' : '';
          const badge = e.join ? `<span class="badge ${esc(e.join.platform)}">${esc(e.join.platform)}</span> ` : '';
          const btn = e.join && e.join.url && e.end > now ? `<button class="primary join" data-join="${esc(e.join.url)}">Unirse</button>` : '';
          return `<div class="meet ${cls}"><span class="t">${hm(e.start)}</span><div class="info"><b>${esc(e.title)}</b><span>${badge}${hm(e.start)}–${hm(e.end)}${e.location && !e.join ? ' · ' + esc(e.location) : ''}</span></div>${btn}</div>`;
        }).join('')
      : '<div class="muted small">¡Hoy no tienes reuniones! 🎉 Día para enfocarse.</div>';
  }
  $('#cal-remove').classList.toggle('hidden', !cal.ics);

  // Correo
  const mb = $('#mailbox');
  if (!m.configured) {
    mb.innerHTML = '<div class="muted small">Conecta tu correo (abajo 👇) y te avisaré cuando llegue algo nuevo.</div>';
  } else if (m.status === 'error') {
    mb.innerHTML = `<div class="err small">😿 ${esc(m.error)}</div>`;
  } else if (m.status !== 'ok') {
    mb.innerHTML = '<div class="muted small">Revisando tu correo… 📬</div>';
  } else {
    const multi = new Set((m.recent || []).map((x) => x.account)).size > 1;
    mb.innerHTML = `<div class="row between"><span class="muted small">${m.error ? '⚠️ ' + esc(m.error) : ''}</span><span><span class="bigcount">${m.unseen}</span> sin leer</span></div>` +
      (m.recent || []).map((x) => `<div class="mailrow"><b>${esc(x.from)}</b><span>${esc(x.subject)}</span>${multi ? `<small class="muted">${esc(x.account)}</small>` : ''}</div>`).join('');
  }
  $('#mail-remove').classList.toggle('hidden', !m.imap);

  // Selector de proveedor (una sola vez)
  const sel = $('#mail-provider');
  if (!sel.options.length && state.presets) {
    sel.innerHTML = Object.entries(state.presets).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
    sel.value = m.provider || 'gmail';
    providerChanged();
  }
}

let connecting = null;
async function connectAccount(provider) {
  if (connecting) return;
  connecting = provider;
  $('#acc-msg').className = 'small muted';
  $('#acc-msg').textContent = '🌐 Te abrí el navegador: inicia sesión y pulsa "Aceptar". Luego vuelve aquí.';
  renderAgenda();
  try {
    const r = await pm.connectAccount(provider);
    if (r.ok) {
      state = r.state;
      $('#acc-msg').className = 'small okmsg';
      $('#acc-msg').textContent = '✅ ¡Cuenta conectada!';
    } else {
      $('#acc-msg').className = 'small err';
      $('#acc-msg').textContent = '😿 ' + r.error;
    }
  } finally {
    connecting = null;
    render();
  }
}

document.addEventListener('click', async (e) => {
  const c = e.target.closest('[data-connect]');
  if (c && !c.disabled) connectAccount(c.dataset.connect);
  const d = e.target.closest('[data-disconnect]');
  if (d) { state = await pm.removeAccount(d.dataset.disconnect); render(); }
});

function providerChanged() {
  const p = $('#mail-provider').value;
  const preset = (state.presets || {})[p] || {};
  $('#mail-custom').classList.toggle('hidden', p !== 'custom');
  const help = {
    gmail: 'Gmail: activa la verificación en 2 pasos y crea una <b>contraseña de aplicación</b> <button type="button" class="link" data-open="https://myaccount.google.com/apppasswords">aquí</button>. Pégala abajo (16 letras).',
    yahoo: 'Yahoo: Seguridad de la cuenta → <b>Generar contraseña de app</b> <button type="button" class="link" data-open="https://login.yahoo.com/account/security">aquí</button>.',
    icloud: 'iCloud: account.apple.com → Inicio de sesión y seguridad → <b>Contraseñas específicas de app</b> <button type="button" class="link" data-open="https://account.apple.com">aquí</button>.',
    outlook: '⚠️ Microsoft bloquea este acceso en cuentas personales y en muchas empresas. Si falla, conecta el <b>calendario</b> (arriba) para tus reuniones de Teams.',
    zoho: 'Zoho: activa IMAP en ajustes y usa una contraseña específica de aplicación.',
    custom: 'Escribe el servidor IMAP de tu proveedor (SSL, normalmente puerto 993).',
  }[p] || '';
  $('#mail-help').innerHTML = help;
  $('#mail-host').value = preset.host || '';
  $('#mail-port').value = preset.port || 993;
}

$('#mail-provider').addEventListener('change', providerChanged);

document.addEventListener('click', (e) => {
  const o = e.target.closest('[data-open]');
  if (o) pm.openExternal(o.dataset.open);
  const j = e.target.closest('[data-join]');
  if (j) pm.join(j.dataset.join);
});

$('#cal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('#cal-url').value.trim();
  if (!url) return;
  $('#cal-msg').className = 'small muted';
  $('#cal-msg').textContent = '⏳ Leyendo tu calendario…';
  const r = await pm.saveCalendar(url);
  if (r.ok) {
    $('#cal-url').value = '';
    $('#cal-msg').className = 'small okmsg';
    $('#cal-msg').textContent = '✅ ¡Calendario conectado!';
    $('#cal-setup').open = false;
    state = r.state;
    render();
  } else {
    $('#cal-msg').className = 'small err';
    $('#cal-msg').textContent = '😿 ' + r.error;
  }
});
$('#cal-remove').addEventListener('click', async () => { state = await pm.removeCalendar(); render(); });
$('#cal-refresh').addEventListener('click', async () => { state = await pm.refreshCalendar(); render(); });

$('#mail-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cfg = {
    provider: $('#mail-provider').value,
    user: $('#mail-user').value.trim(),
    pass: $('#mail-pass').value,
    host: $('#mail-host').value.trim(),
    port: Number($('#mail-port').value) || 993,
  };
  $('#mail-msg').className = 'small muted';
  $('#mail-msg').textContent = '⏳ Probando conexión…';
  const r = await pm.saveMail(cfg);
  if (r.ok) {
    $('#mail-pass').value = '';
    $('#mail-msg').className = 'small okmsg';
    $('#mail-msg').textContent = '✅ ¡Correo conectado!';
    $('#mail-setup').open = false;
    state = r.state;
    render();
  } else {
    $('#mail-msg').className = 'small err';
    $('#mail-msg').textContent = '😿 ' + r.error;
  }
});
$('#mail-remove').addEventListener('click', async () => { state = await pm.removeMail(); render(); });
$('#mail-refresh').addEventListener('click', async () => { state = await pm.refreshMail(); render(); });

// Si el panel ya pintó antes de cargar este archivo, repinta con todo.
if (typeof state !== 'undefined' && state) render();

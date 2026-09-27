const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let state = null;
const LOC = () => (state && state.lang === 'en' ? 'en' : 'es');
let chatCount = -1;
let suTasks = [];

// ---------- utilidades ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + ' M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '') + ' k';
  return String(n || 0);
}
function fmtUntil(iso) {
  if (!iso) return '—';
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'ya mismo';
  const m = Math.round(ms / 60000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${mm} min`;
  return `${mm} min`;
}
function fmtClock(iso) {
  const d = new Date(iso);
  const hm = d.toLocaleTimeString(LOC(), { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return `hoy ${hm}`;
  return d.toLocaleDateString(LOC(), { weekday: 'short', day: 'numeric' }) + ` ${hm}`;
}
function level(p) {
  return p >= 90 ? 'max' : p >= 75 ? 'high' : p >= 50 ? 'mid' : 'ok';
}
function dayLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(LOC(), { weekday: 'short', day: 'numeric' });
}

// ---------- navegación ----------
let pendingView = null;
function show(view) {
  if (!state) { pendingView = view; return; }
  $$('.overlay').forEach((o) => o.classList.add('hidden'));
  if (view === 'report' || view === 'daily-copy') {
    openReport(view === 'report' ? 'weekly' : 'daily');
    return;
  }
  if (view === 'stats') {
    if (window.openStats) window.openStats();
    return;
  }
  if (view === 'shop') view = 'pet';
  if (view === 'onboarding' || view === 'standup' || view === 'review') {
    if (view === 'standup') openStandup();
    if (view === 'review') openReview();
    if (view === 'onboarding') openOnboarding();
    return;
  }
  $$('nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'v-' + view));
  pm.viewChanged(view);
  if (view === 'chat') setTimeout(() => $('#chat-input').focus(), 50);
}
$$('nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
$('#close').addEventListener('click', () => pm.hidePanel());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') pm.hidePanel();
});
pm.onView(show);

// ---------- render ----------
function render() {
  if (!state) return;
  const name = state.pet.name || 'PM';
  $('#h-name').textContent = name + (state.level ? ` · Nv ${state.level.level}` : '') + (state.muted ? ' 🔕' : '');
  $('#h-mood').textContent = moodLine();
  renderChat();
  renderUsage();
  renderDay();
  renderAgenda();
  renderProd();
  renderPet();
  renderGami();
  if (state.lang === 'en') I18N.translateDom(document.getElementById('card'), 'en');
}

function moodLine() {
  const s = (state.usage.limits || []).find((l) => l.key === 'five_hour');
  if (state.life && state.life.angryUntil > Date.now()) return 'ENOJADO 😤💢 (acarícialo o pídele perdón)';
  if (state.focusNow && state.focusNow.cat === 'distraction') return `te está vigilando 🤨 (${state.focusNow.label})`;
  if (state.pet.fullness < 25) return 'con hambre 🥺🌽';
  if (!s) return 'tu pollito Project Manager';
  const p = Math.round(s.utilization);
  if (p >= 100) return `agotado 😵 · sesión al ${p}%`;
  if (p >= 90) return `¡en pánico! 🥵 · sesión al ${p}%`;
  if (p >= 75) return `un poco preocupado 😬 · sesión al ${p}%`;
  return `feliz ✨ · sesión al ${p}%`;
}

function renderChat() {
  const chat = state.chat || [];
  if (chat.length === chatCount) return;
  chatCount = chat.length;
  const box = $('#messages');
  if (!chat.length) {
    box.innerHTML = `<div class="msg pet">¡Pío! Pregúntame cuánto llevas gastado de Claude, cuándo se reinicia tu límite o cuáles son tus tareas 🐣</div>`;
    return;
  }
  box.innerHTML = chat
    .map((m) => `<div class="msg ${m.from === 'me' ? 'me' : 'pet'}">${esc(m.text)}<time>${new Date(m.at).toLocaleTimeString(LOC(), { hour: '2-digit', minute: '2-digit' })}</time></div>`)
    .join('');
  box.scrollTop = box.scrollHeight;
}

function connectionHtml(c) {
  if (!c) return '';
  if (c.status === 'ok') {
    const src = { web: 'claude.ai', manual: 'token manual', 'claude-code': 'sesión de Claude Code' }[c.source] || c.source;
    return `<b>✅ Conectado a tu cuenta de Claude</b><span class="small muted">Vía ${src}${c.plan ? ` · plan ${esc(c.plan)}` : ''}</span>`;
  }
  if (c.status === 'checking') return '<b>⏳ Comprobando conexión…</b>';
  return `<b>🔌 Aún no estoy conectado a tu cuenta</b>
    <span class="small">${esc(c.message || '')}</span>
    <button type="button" class="primary web-btn" data-weblogin>🌐 Conectar con mi cuenta de Claude</button>
    <span class="small muted">Se abrirá la página oficial de claude.ai: inicia sesión como siempre. PM nunca ve tu contraseña. Mientras tanto te muestro tus estadísticas locales.</span>
    <button type="button" class="ghost" data-recheck>🔄 Volver a comprobar</button>`;
}

function renderUsage() {
  const u = state.usage;
  const c = u.connection || {};
  const conn = $('#conn');
  conn.className = 'box ' + (c.status === 'ok' ? 'ok' : c.status === 'checking' ? '' : 'bad');
  conn.innerHTML = connectionHtml(c);

  $('#limits').innerHTML = (u.limits || [])
    .map((l) => {
      const p = Math.round(l.utilization);
      return `<div class="limit">
        <div class="top"><b>${esc(l.label)}</b><span class="pct">${p}%</span></div>
        <div class="bar"><i class="${level(p)}" style="width:${Math.min(100, p)}%"></i></div>
        <div class="reset">${l.resetsAt ? `⏳ Se reinicia en <b>${fmtUntil(l.resetsAt)}</b> · ${fmtClock(l.resetsAt)}` : ''}</div>
      </div>`;
    })
    .join('');

  const lo = u.local;
  if (!lo || !lo.available) {
    $('#local').innerHTML = '<div class="tile wide muted">No encontré registros de Claude Code en este equipo.</div>';
  } else {
    const t = lo.today, h = lo.last5h, w = lo.week;
    const models = Object.entries(t.models).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, n]) => `${esc(m)} · ${fmtTokens(n)}`).join('<br>') || '—';
    $('#local').innerHTML = `
      <div class="tile"><b>${t.messages}</b><span>respuestas hoy</span></div>
      <div class="tile"><b>${fmtTokens(t.input + t.output)}</b><span>tokens hoy (entrada+salida)</span></div>
      <div class="tile"><b>${fmtTokens(h.input + h.output)}</b><span>últimas 5 h · ${h.messages} resp.</span></div>
      <div class="tile"><b>${fmtTokens(w.input + w.output)}</b><span>últimos 7 días · ${w.messages} resp.</span></div>
      <div class="tile wide"><span>Modelos hoy</span><div>${models}</div></div>`;
  }
  $('#fetched').textContent = u.fetchedAt ? 'Actualizado ' + new Date(u.fetchedAt).toLocaleTimeString(LOC(), { hour: '2-digit', minute: '2-digit' }) : '';
}

function renderDay() {
  const day = state.today || {};
  const tasks = (day.standup && day.standup.today) || [];
  const done = tasks.filter((t) => t.done).length;
  $('#day-title').textContent = 'Hoy · ' + new Date().toLocaleDateString(LOC(), { weekday: 'long', day: 'numeric', month: 'short' });
  $('#day-progress').textContent = tasks.length ? `${done}/${tasks.length}` : 'sin plan';
  $('#tasks').innerHTML = tasks.length
    ? tasks.map((t, i) => `<li class="${t.done ? 'done' : ''}"><input type="checkbox" data-i="${i}" ${t.done ? 'checked' : ''}/><span>${esc(t.text)}</span><button data-del="${i}" title="Quitar">✕</button></li>`).join('')
    : '<li class="empty">Aún no hay tareas. Haz el daily o añade una 👇</li>';
  $$('#tasks input[type=checkbox]').forEach((cb) => cb.addEventListener('change', () => pm.toggleTask(state.todayKey, Number(cb.dataset.i))));
  $$('#tasks button[data-del]').forEach((b) => b.addEventListener('click', () => pm.removeTask(Number(b.dataset.del))));

  const notes = [];
  if (day.standup && day.standup.yesterday) notes.push(`<p><b>Ayer:</b> ${esc(day.standup.yesterday)}</p>`);
  if (day.standup && day.standup.help) notes.push(`<p><b>Me pediste ayuda con:</b> ${esc(day.standup.help)}</p>`);
  if (day.review) notes.push(`<p><b>Cierre:</b> ${day.review.done}/${day.review.total} ✅ ${esc(day.review.notes || '')}</p>`);
  $('#day-notes').innerHTML = notes.length ? `<div class="box">${notes.join('')}</div>` : '';
  $('#btn-standup').textContent = day.standup ? '☀️ Editar daily' : '☀️ Hacer daily';
  renderFocus();

  const keys = Object.keys(state.days).filter((k) => state.days[k].standup).sort().reverse().slice(0, 7);
  $('#history').innerHTML = keys.length
    ? keys.map((k) => {
        const ts = state.days[k].standup.today;
        const n = ts.filter((t) => t.done).length;
        const p = ts.length ? Math.round((n / ts.length) * 100) : 0;
        const cls = p === 100 ? 'ok' : p >= 50 ? 'mid' : 'high';
        return `<div class="hist"><span class="d">${dayLabel(k)}</span><div class="bar"><i class="${cls}" style="width:${p}%"></i></div><span class="n">${n}/${ts.length}</span></div>`;
      }).join('')
    : '<div class="muted small">Aquí verás cómo te fue cada día.</div>';
}

function renderPet() {
  const p = state.pet;
  $('#st-happy').style.width = Math.round(p.happiness) + '%';
  $('#st-full').style.width = Math.round(p.fullness) + '%';
  const days = p.born ? Math.floor((Date.now() - p.born) / 864e5) : 0;
  $('#st-age').textContent = p.born ? `Edad: ${days === 0 ? 'nació hoy 🥚' : days + ' día' + (days === 1 ? '' : 's')}` : '';
  if (document.activeElement !== $('#rename-input')) $('#rename-input').value = p.name || '';
  const s = state.settings;
  $('#s-morning').value = s.morningTime;
  $('#s-evening').value = s.eveningTime;
  $('#s-workdays').checked = !!s.workdaysOnly;
  $('#s-chatter').checked = !!s.chatter;
  $('#s-autostart').checked = !!state.autoStart;
  $('#token-clear').classList.toggle('hidden', !s.hasManualToken);
  $('#s-focus').checked = !!s.focusWatch;
  $('#s-sounds').checked = !!s.sounds;
  $('#mute').textContent = state.muted ? '🔔 Quitar silencio' : '🔕 Silenciar 1 hora (reunión)';
  const lv = state.level || { level: 1, title: 'Pollito becario', into: 0, next: 100 };
  $('#lv-title').textContent = lv.title;
  $('#lv-num').textContent = 'Nv ' + lv.level;
  $('#st-xp').style.width = Math.round((lv.into / lv.next) * 100) + '%';
  const w = state.web || {};
  $('#web-status').innerHTML = w.connected
    ? `<b>✅ Conectado a claude.ai</b>${w.orgName ? ` <span class="muted">· ${esc(w.orgName)}</span>` : ''}`
    : '<span class="muted">Inicia sesión en la página oficial de Claude; yo solo leo tu uso.</span>';
  $('#web-login').textContent = loggingIn ? '⏳ Esperando a que inicies sesión…' : w.connected ? '🔄 Volver a conectar' : '🌐 Conectar con mi cuenta de Claude';
  $('#web-logout').classList.toggle('hidden', !w.connected);
}

// ---------- conexión web ----------
let loggingIn = false;
async function webLogin() {
  if (loggingIn) return;
  loggingIn = true;
  $$('[data-weblogin], #web-login').forEach((b) => { b.textContent = '⏳ Esperando a que inicies sesión…'; b.disabled = true; });
  try {
    state = await pm.webLogin();
  } finally {
    loggingIn = false;
    $$('[data-weblogin], #web-login').forEach((b) => { b.textContent = '🌐 Conectar con mi cuenta de Claude'; b.disabled = false; });
  }
  render();
  if (!$('#o-onboarding').classList.contains('hidden')) $('#onb-conn').innerHTML = connectionHtml(state.usage.connection);
}
document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-weblogin]')) webLogin();
  if (e.target.closest('[data-recheck]')) {
    await refresh();
    if (!$('#o-onboarding').classList.contains('hidden')) $('#onb-conn').innerHTML = connectionHtml(state.usage.connection);
  }
});
$('#web-login').addEventListener('click', webLogin);
$('#web-logout').addEventListener('click', async () => { state = await pm.webLogout(); render(); });

function fmtDur(secs) {
  const m = Math.round((secs || 0) / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function renderFocus() {
  const f = state.today.focus;
  const box = $('#focus');
  if (!state.settings.focusWatch) { box.innerHTML = '<span class="muted small">La vigilancia de distracciones está apagada (🐣 Mascota → Rutina).</span>'; return; }
  if (!f || !(f.work + f.distraction + f.neutral)) { box.innerHTML = '<span class="muted small">Aún no hay datos de hoy. Te estoy observando 👀</span>'; return; }
  const total = f.work + f.distraction + f.neutral + (f.idle || 0);
  const pct = (v) => ((v || 0) / total) * 100;
  const top = Object.entries(f.apps || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${esc(k)} ${fmtDur(v)}`).join(' · ');
  const active = f.work + f.distraction + f.neutral;
  const wp = Math.round((f.work / active) * 100);
  const verdict = f.distraction >= 3600 ? 'Más de una hora perdida… 😤' : f.distraction >= 1200 ? 'Demasiadas distracciones 🤨' : wp >= 60 ? '¡Día muy enfocado! 🥹' : 'Vamos bien, ¡a enfocarse! 💪';
  box.innerHTML = `
    <div class="fbar"><i class="w" style="width:${pct(f.work)}%"></i><i class="n" style="width:${pct(f.neutral)}%"></i><i class="d" style="width:${pct(f.distraction)}%"></i><i class="z" style="width:${pct(f.idle)}%"></i></div>
    <div class="legend"><span>🟩 Trabajo <b>${fmtDur(f.work)}</b></span><span>🟥 Distracción <b>${fmtDur(f.distraction)}</b></span><span>⬜ Otros <b>${fmtDur(f.neutral)}</b></span><span>💤 Inactivo <b>${fmtDur(f.idle)}</b></span></div>
    ${top ? `<div class="small muted">Distracciones: ${top}</div>` : ''}
    <div class="verdict">${verdict}</div>`;
}

// ---------- agenda: reuniones + correo ----------
// Inicio de sesión web con Microsoft/Google: oculto hasta registrar los IDs de aplicación (ver README).
const WEB_ACCOUNTS_ENABLED = false;
function hm(ms) {
  return new Date(ms).toLocaleTimeString(LOC(), { hour: '2-digit', minute: '2-digit' });
}

function renderAgenda() {
  const now = Date.now();

  const live = $('#meeting-now');
  live.classList.toggle('hidden', !state.meetingNow);
  if (state.meetingNow) {
    const mins = Math.round((now - state.meetingNow.since) / 60000);
    live.textContent = `🎧 En reunión ${state.meetingNow.title ? `“${state.meetingNow.title}” ` : ''}(${state.meetingNow.app}) · ${mins} min`;
  }

  // Cuentas conectadas por inicio de sesión web (desactivado por ahora, ver WEB_ACCOUNTS_ENABLED)
  if (WEB_ACCOUNTS_ENABLED) renderAccounts();

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

// ---------- productividad: pomodoro, recordatorios, proyectos, git, GitHub, integraciones ----------
function fmtClockMs(ms) {
  const left = Math.max(0, Math.round(ms / 1000));
  return String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
}

function renderPomo() {
  const p = state.pomo;
  const box = $('#pomo-box');
  box.classList.toggle('focus', !!(p && p.phase === 'focus'));
  box.classList.toggle('break', !!(p && p.phase === 'break'));
  const n = state.pomodorosToday || 0;
  if (!p) {
    $('#pomo-title').textContent = '🍅 Pomodoro';
    $('#pomo-sub').textContent = n ? `${n} completado${n === 1 ? '' : 's'} hoy · 25 min + 5 de descanso` : '25 min de concentración · 5 de descanso';
    $('#pomo-time').textContent = '25:00';
    $('#pomo-btn').textContent = '▶ Empezar pomodoro';
  } else {
    $('#pomo-title').textContent = p.phase === 'focus' ? `🍅 Concentración · #${p.round}` : `☕ Descanso${p.long ? ' largo' : ''}`;
    $('#pomo-sub').textContent = p.phase === 'focus' ? 'Nada de distracciones: el pollito vigila 👀' : 'Levántate, estírate, toma agua 🧘';
    $('#pomo-time').textContent = fmtClockMs(p.endsAt - Date.now());
    $('#pomo-btn').textContent = '⏹ Detener';
  }
}
setInterval(() => { if (state && state.pomo) renderPomo(); }, 1000);

function renderProd() {
  renderPomo();

  // Recordatorios
  const rems = state.reminders || [];
  $('#reminders').innerHTML = rems.length
    ? rems.map((r) => {
        const d = new Date(r.at);
        const when = d.toDateString() === new Date().toDateString() ? hm(r.at) : d.toLocaleDateString(LOC(), { weekday: 'short' }) + ' ' + hm(r.at);
        return `<li><span><small>${esc(when)}</small>${esc(r.text)}</span><button type="button" data-rem="${esc(r.id)}" title="Quitar">✕</button></li>`;
      }).join('')
    : '<li class="empty small">Sin recordatorios pendientes</li>';

  // Proyectos
  const projs = state.projectsToday || [];
  const max = projs.length ? projs[0][1] : 1;
  $('#projects').innerHTML = projs.length
    ? projs.map(([n, s]) => `<div class="proj"><span class="n" title="${esc(n)}">${esc(n)}</span><div class="bar"><i style="width:${Math.max(4, (s / max) * 100)}%"></i></div><span class="t">${fmtDur(s)}</span></div>`).join('')
    : '<span class="muted small">Aún no hay tiempo registrado hoy. Detecto el proyecto desde VS Code, Cursor, JetBrains, la terminal y más.</span>';

  // Git
  const g = state.git || {};
  const commits = g.today || [];
  $('#gitbox').innerHTML = !g.at
    ? '<span class="muted small">Revisando tus repositorios… 🔍</span>'
    : `<div class="small muted">${g.repos} repos vigilados · <b>${commits.length}</b> commit${commits.length === 1 ? '' : 's'} hoy</div>` +
      commits.slice(-6).reverse().map((c) => `<div class="commit"><b>${esc(c.repo)}</b> ${hm(c.at)} · ${esc(c.subject)}</div>`).join('') +
      (g.warnings || []).map((w) => `<div class="warn">⚠️ ${esc(w.repo)}: ${esc(w.text)}</div>`).join('');

  // GitHub (pestaña Agenda)
  const gh = state.github || {};
  const ghbox = $('#ghbox');
  if (!gh.hasToken) {
    ghbox.innerHTML = '<div class="muted small">Conecta GitHub en 🐣 Perfil → Integraciones para ver PRs y CI.</div>';
  } else if (gh.status === 'error') {
    ghbox.innerHTML = `<div class="err small">😿 ${esc(gh.error)}</div>`;
  } else if (gh.status !== 'ok') {
    ghbox.innerHTML = '<div class="muted small">Revisando GitHub… 🐙</div>';
  } else {
    const CI = { SUCCESS: '✅', FAILURE: '❌', ERROR: '❌', PENDING: '⏳', EXPECTED: '⏳' };
    const REV = { APPROVED: '👍 aprobado', CHANGES_REQUESTED: '✏️ cambios pedidos', REVIEW_REQUIRED: '👀 esperando revisión' };
    const rev = (gh.toReview || []).map((p) => `<div class="pr" data-pr="${esc(p.url)}"><span class="ci">👀</span><div class="info"><b>${esc(p.title)}</b><span>Revisar · ${esc(p.repo)} · @${esc(p.author)}</span></div></div>`).join('');
    const mine = (gh.mine || []).map((p) => `<div class="pr" data-pr="${esc(p.url)}"><span class="ci">${CI[p.ci] || '•'}</span><div class="info"><b>${p.draft ? '📝 ' : ''}${esc(p.title)}</b><span>${esc(p.repo)}${p.review ? ' · ' + (REV[p.review] || '') : ''}</span></div></div>`).join('');
    ghbox.innerHTML = `<div class="small muted">@${esc(gh.login)} · ${(gh.toReview || []).length} por revisar · ${(gh.mine || []).length} tuyos abiertos</div>` +
      (rev || '') + (mine || '') + (!rev && !mine ? '<div class="muted small">¡Nada pendiente en GitHub! 🎉</div>' : '');
  }

  // Integraciones (Perfil)
  const cc = state.claudeCode || {};
  $('#cc-status').textContent = cc.installed ? (cc.working ? '🤖 trabajando…' : '✅ conectado') : 'sin conectar';
  $('#cc-install').textContent = cc.installed ? '🔄 Reinstalar hooks' : 'Conectar con Claude Code';
  $('#cc-uninstall').classList.toggle('hidden', !cc.installed);
  $('#gh-status').textContent = gh.status === 'ok' ? '✅ @' + gh.login : gh.hasToken ? '⚠️ error' : 'sin conectar';
  $('#gh-remove').classList.toggle('hidden', !gh.hasToken);
  if (document.activeElement !== $('#git-roots')) $('#git-roots').value = (g.roots || []).join('\n');
  const h = state.health || {};
  $('#h-breaks').checked = h.breaks !== false;
  $('#h-eyes').checked = h.eyes !== false;
  $('#h-water').checked = h.water !== false;
}

$('#pomo-btn').addEventListener('click', () => (state.pomo ? pm.pomoStop() : pm.pomoStart()));
$('#rem-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = $('#rem-input').value.trim();
  if (!v) return;
  const r = await pm.addReminder(v);
  if (r) {
    $('#rem-input').value = '';
  } else {
    $('#rem-input').value = v;
    $('#rem-input').placeholder = 'No entendí la hora: "a las 3 …", "en 20 min …", "mañana a las 9 …"';
    $('#rem-input').select();
  }
});
$('#btn-csv').addEventListener('click', async () => {
  const f = await pm.exportTimesheet();
  if (f) $('#btn-csv').textContent = '✅ Guardado';
  setTimeout(() => ($('#btn-csv').textContent = '⬇ CSV'), 2500);
});
$('#git-refresh').addEventListener('click', async () => { state = await pm.gitRefresh(); render(); });
$('#gh-refresh').addEventListener('click', async () => { state = await pm.githubRefresh(); render(); });
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
$('#git-roots-save').addEventListener('click', async () => {
  const roots = $('#git-roots').value.split('\n').map((x) => x.trim()).filter(Boolean);
  state = await pm.updateIntegrations({ gitRoots: roots });
  $('#git-roots-msg').textContent = '✅ Guardado. Buscando repos…';
  render();
});
for (const id of ['breaks', 'eyes', 'water']) {
  $('#h-' + id).addEventListener('change', async (e) => { state = await pm.updateIntegrations({ health: { [id]: e.target.checked } }); render(); });
}
document.addEventListener('click', (e) => {
  const r = e.target.closest('[data-rem]');
  if (r) pm.removeReminder(r.dataset.rem);
  const p = e.target.closest('[data-pr]');
  if (p) pm.openPR(p.dataset.pr);
});

// ---------- informe semanal / daily para copiar ----------
async function openReport(kind) {
  reportKind = kind;
  $('#o-report').classList.remove('hidden');
  $('#rp-title').textContent = kind === 'daily' ? '📋 Daily para copiar' : '📊 Informe semanal';
  $('#rp-sub').textContent = kind === 'daily' ? 'Formato listo para Slack o Teams.' : 'Últimos 7 días. Listo para Slack, Teams o un correo.';
  $('#rp-text').value = '⏳ Preparando…';
  $('#rp-text').value = kind === 'daily' ? await pm.dailyText() : await pm.weeklyReport();
  $('#rp-copy').textContent = '📋 Copiar';
}
$('#btn-report').addEventListener('click', () => openReport('weekly'));
$('#btn-daily-copy').addEventListener('click', () => openReport('daily'));
$('#rp-close').addEventListener('click', () => $('#o-report').classList.add('hidden'));
$('#rp-copy').addEventListener('click', async () => {
  await pm.copy($('#rp-text').value);
  $('#rp-copy').textContent = '✅ ¡Copiado!';
});

// ---------- logros, tienda, IA, idioma, sitios ----------
const SLOT_NAMES = { head: 'cabeza', face: 'cara', neck: 'cuello', back: 'espalda', skin: 'plumas' };
let seenAch = null;

function renderGami() {
  // Logros
  const achs = state.achievements || [];
  const got = achs.filter((a) => a.at);
  $('#ach-count').textContent = `${got.length}/${achs.length}`;
  const newest = got.reduce((m, a) => Math.max(m, a.at), 0);
  $('#achievements').innerHTML = achs.map((a) => `<div class="ach ${a.at ? '' : 'locked'} ${a.at && seenAch !== null && a.at > seenAch ? 'new' : ''}" title="${esc(a.name)} — ${esc(a.desc)}${a.at ? ' ✅' : ` (+${a.reward} 🌽)`}">${a.emoji}</div>`).join('');
  seenAch = Math.max(seenAch || 0, newest);

  // Tienda
  $('#coins').textContent = `🌽 ${state.coins || 0}`;
  $('#shop').innerHTML = (state.shop || []).map((x) => {
    let btn;
    if (x.equipped) btn = `<button class="wear" data-unequip="${x.slot}">Quitarse</button>`;
    else if (x.owned) btn = `<button class="wear" data-equip="${x.id}">Equipar</button>`;
    else btn = `<button class="buy" data-buy="${x.id}" ${state.coins < x.price ? 'disabled' : ''}>🌽 ${x.price}</button>`;
    return `<div class="item ${x.equipped ? 'eq' : ''}" title="${esc(SLOT_NAMES[x.slot] || x.slot)}"><span class="e">${x.emoji}</span><span class="n">${esc(x.name)}</span>${btn}</div>`;
  }).join('');

  // IA
  const a = state.ai || {};
  const sel = $('#ai-model');
  if (!sel.options.length) sel.innerHTML = Object.entries(a.models || {}).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  sel.value = a.model;
  $('#ai-enabled').checked = !!a.enabled;
  $('#ai-remove').classList.toggle('hidden', !a.hasKey);
  $('#ai-key').placeholder = a.hasKey ? '•••••••• (guardada)' : 'sk-ant-…';

  // Idioma y presentación
  $('#lang').value = state.lang || 'es';
  $('#auto-hide').checked = state.autoHide !== false;
  $('#version').textContent = `PM v${state.version || '?'}${state.packaged ? '' : ' (desarrollo)'}`;

  // Sitios
  const mons = state.monitors || [];
  $('#monitors').innerHTML = mons.length
    ? mons.map((m) => {
        const s = m.state;
        const cls = !s ? '' : s.up ? 'up' : 'down';
        const host = (() => { try { return new URL(m.url).host; } catch { return m.url; } })();
        const detail = !s ? 'comprobando…' : s.up ? `${s.status} · ${s.ms} ms` : `caído · ${s.status ? 'HTTP ' + s.status : esc(s.error || 'sin respuesta')}`;
        return `<div class="mon ${cls}"><span class="dot"></span><div class="info" data-mon="${esc(m.id)}"><b>${esc(m.name || host)}</b><span>${detail}</span></div><button data-mon-del="${esc(m.id)}" title="Quitar">✕</button></div>`;
      }).join('')
    : '<div class="muted small">Añade tus webs, APIs o servidores locales y te aviso si se caen 🔴</div>';
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-buy]');
  if (b && !b.disabled) {
    const r = await pm.shopBuy(b.dataset.buy);
    state = r.state;
    render();
    if (!r.ok) alertMsg(r.error);
  }
  const q = e.target.closest('[data-equip]');
  if (q) { const r = await pm.shopEquip(q.dataset.equip); state = r.state; render(); }
  const u = e.target.closest('[data-unequip]');
  if (u) { state = await pm.shopUnequip(u.dataset.unequip); render(); }
  const m = e.target.closest('[data-mon]');
  if (m) pm.openMonitor(m.dataset.mon);
  const md = e.target.closest('[data-mon-del]');
  if (md) { state = await pm.removeMonitor(md.dataset.monDel); render(); }
});

// Aviso flotante breve dentro del panel.
function alertMsg(text) {
  const t = document.createElement('div');
  t.className = 'viz-tip';
  t.textContent = text;
  t.style.left = '20px';
  t.style.bottom = '20px';
  t.style.whiteSpace = 'normal';
  t.style.maxWidth = '320px';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

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
$('#lang').addEventListener('change', async (e) => {
  await pm.updateSettings({ lang: e.target.value });
  location.reload(); // recarga el panel para aplicar el idioma a todos los textos
});
$('#auto-hide').addEventListener('change', (e) => pm.updateSettings({ autoHide: e.target.checked }));
$('#check-updates').addEventListener('click', async () => {
  $('#check-updates').textContent = '⏳';
  const r = await pm.checkUpdates();
  $('#check-updates').textContent = r.ok ? `✅ v${r.version}` : '—';
  if (!r.ok) alertMsg(r.error);
});
$('#open-stats').addEventListener('click', () => show('stats'));
$('#open-game').addEventListener('click', () => pm.openGame());
$('#mon-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = $('#mon-url').value.trim();
  if (!v) return;
  const r = await pm.addMonitor(v, '');
  if (r.ok) { $('#mon-url').value = ''; state = r.state; render(); } else alertMsg(r.error);
});
$('#mon-refresh').addEventListener('click', async () => { state = await pm.checkMonitors(); render(); });

// Informe / daily: mejorar con IA
let reportKind = 'weekly';
$('#rp-ai').addEventListener('click', async () => {
  const btn = $('#rp-ai');
  btn.disabled = true;
  btn.textContent = '⏳ Pensando…';
  const r = await pm.aiPolish($('#rp-text').value, reportKind);
  btn.disabled = false;
  btn.textContent = '✨ Mejorar con IA';
  if (r.ok) $('#rp-text').value = r.text;
  else alertMsg(r.error);
});

// Chat: indicador de "escribiendo…" mientras responde la IA
pm.onThinking((on) => {
  const box = $('#messages');
  const el = box.querySelector('.typing');
  if (on && !el) { box.insertAdjacentHTML('beforeend', '<div class="msg pet typing"><i></i><i></i><i></i></div>'); box.scrollTop = box.scrollHeight; }
  if (!on && el) el.remove();
});

// Traducción al inglés: se aplica tras cada cambio del panel.
let i18nTimer = null;
const i18nObserver = new MutationObserver(() => {
  if (!state || state.lang !== 'en') return;
  clearTimeout(i18nTimer);
  i18nTimer = setTimeout(() => I18N.translateDom(document.getElementById('card'), 'en'), 30);
});
i18nObserver.observe(document.getElementById('card'), { childList: true, subtree: true, characterData: true });

// ---------- chat ----------
async function send(text) {
  text = text.trim();
  if (!text) return;
  $('#chat-input').value = '';
  await pm.chat(text);
}
$('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); send($('#chat-input').value); });
$$('.chips button').forEach((b) => b.addEventListener('click', () => send(b.dataset.q)));

// ---------- uso ----------
async function refresh() {
  $('#refresh').textContent = '⏳';
  state = await pm.refreshUsage();
  $('#refresh').textContent = '↻ Actualizar';
  render();
}
$('#refresh').addEventListener('click', refresh);
setInterval(() => { if (state) renderUsage(); }, 30000); // cuenta atrás de reinicio

// ---------- día ----------
$('#task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = $('#task-input').value.trim();
  if (!v) return;
  $('#task-input').value = '';
  await pm.addTask(v);
});
$('#btn-standup').addEventListener('click', () => show('standup'));
$('#btn-review').addEventListener('click', () => show('review'));

// ---------- mascota / ajustes ----------
$('#feed').addEventListener('click', () => pm.feed());
$('#pet').addEventListener('click', () => pm.pet());
$('#rename-form').addEventListener('submit', (e) => { e.preventDefault(); pm.rename($('#rename-input').value); $('#rename-input').blur(); });
$('#s-morning').addEventListener('change', (e) => e.target.value && pm.updateSettings({ morningTime: e.target.value }));
$('#s-evening').addEventListener('change', (e) => e.target.value && pm.updateSettings({ eveningTime: e.target.value }));
$('#s-workdays').addEventListener('change', (e) => pm.updateSettings({ workdaysOnly: e.target.checked }));
$('#s-chatter').addEventListener('change', (e) => pm.updateSettings({ chatter: e.target.checked }));
$('#s-focus').addEventListener('change', (e) => pm.updateSettings({ focusWatch: e.target.checked }));
$('#s-sounds').addEventListener('change', (e) => pm.updateSettings({ sounds: e.target.checked }));
$('#mute').addEventListener('click', () => pm.chat(state.muted ? 'quita el silencio' : 'silencio'));
$('#s-autostart').addEventListener('change', (e) => pm.updateSettings({ autoStart: e.target.checked }));
$('#token-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = $('#token-input').value.trim();
  if (!t) return;
  $('#token-input').value = '';
  state = await pm.setToken(t);
  render();
  show('usage');
});
$('#token-clear').addEventListener('click', async () => { state = await pm.setToken(''); render(); });
$('#quit').addEventListener('click', () => pm.quit());

// ---------- onboarding ----------
function openOnboarding() {
  $('#o-onboarding').classList.remove('hidden');
  const c = state && state.usage.connection;
  $('#onb-conn').innerHTML = connectionHtml(c);
  setTimeout(() => $('#onb-name').focus(), 100);
}
$('#onb-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const n = $('#onb-name').value.trim();
  if (!n) return;
  await pm.rename(n);
  $('#o-onboarding').classList.add('hidden');
  show('chat');
});

// ---------- daily ----------
function renderSuTasks() {
  $('#su-tasks').innerHTML = suTasks.map((t, i) => `<li><span>📌 ${esc(t)}</span><button type="button" data-i="${i}">✕</button></li>`).join('');
  $$('#su-tasks button').forEach((b) => b.addEventListener('click', () => { suTasks.splice(Number(b.dataset.i), 1); renderSuTasks(); }));
}
function addSuTask() {
  const v = $('#su-task').value.trim();
  if (!v) return;
  suTasks.push(v);
  $('#su-task').value = '';
  renderSuTasks();
}
function openStandup() {
  const day = state.today || {};
  const prev = state.previous;
  if (day.standup) {
    $('#su-yesterday').value = day.standup.yesterday;
    suTasks = day.standup.today.map((t) => t.text);
    $('#su-help').value = day.standup.help;
    $('#su-intro').textContent = 'Puedes ajustar el plan de hoy.';
  } else {
    const pt = (prev && prev.standup && prev.standup.today) || [];
    $('#su-yesterday').value = pt.map((t) => `${t.done ? '✅' : '⬜'} ${t.text}`).join('\n');
    suTasks = prev && prev.review && prev.review.carry ? pt.filter((t) => !t.done).map((t) => t.text) : [];
    $('#su-help').value = '';
    $('#su-intro').textContent = prev ? `Te dejé lo que planeaste el ${dayLabel(prev.date)} para que lo ajustes.` : 'Cuéntame para organizar el día.';
    // Añade tus commits del último día laborable (git) a "¿Qué hiciste ayer?".
    const base = $('#su-yesterday').value;
    pm.gitYesterday().then((commits) => {
      if (!commits || !commits.length || $('#su-yesterday').value !== base) return;
      const lines = commits.slice(-12).map((c) => `📦 [${c.repo}] ${c.subject}`);
      $('#su-yesterday').value = (base ? base + '\n' : '') + lines.join('\n');
      $('#su-intro').textContent += ` Añadí tus ${commits.length} commit${commits.length === 1 ? '' : 's'} de git 📦`;
    }).catch(() => {});
  }
  renderSuTasks();
  $('#o-standup').classList.remove('hidden');
  setTimeout(() => (day.standup ? $('#su-task') : $('#su-yesterday')).focus(), 100);
}
$('#su-add').addEventListener('click', addSuTask);
$('#su-task').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSuTask(); } });
$('#su-later').addEventListener('click', async () => { await pm.snooze('standup'); $('#o-standup').classList.add('hidden'); pm.hidePanel(); });
$('#su-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('#su-task').value.trim()) addSuTask();
  if (!suTasks.length) {
    $('#su-task').placeholder = '¡Añade al menos una tarea! 🐣';
    $('#su-task').focus();
    return;
  }
  await pm.saveStandup({ yesterday: $('#su-yesterday').value, tasks: suTasks, help: $('#su-help').value });
  $('#o-standup').classList.add('hidden');
  show('day');
});

// ---------- cierre ----------
function openReview() {
  const tasks = (state.today.standup && state.today.standup.today) || [];
  if (!tasks.length) {
    show('standup');
    return;
  }
  $('#rv-tasks').innerHTML = tasks
    .map((t, i) => `<li class="${t.done ? 'done' : ''}"><input type="checkbox" data-i="${i}" ${t.done ? 'checked' : ''}/><span>${esc(t.text)}</span></li>`)
    .join('');
  $$('#rv-tasks input').forEach((cb) => cb.addEventListener('change', () => cb.parentElement.classList.toggle('done', cb.checked)));
  $('#rv-notes').value = (state.today.review && state.today.review.notes) || '';
  $('#o-review').classList.remove('hidden');
}
$('#rv-later').addEventListener('click', async () => { await pm.snooze('review'); $('#o-review').classList.add('hidden'); pm.hidePanel(); });
$('#rv-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const done = $$('#rv-tasks input').map((cb) => cb.checked);
  await pm.saveReview({ done, notes: $('#rv-notes').value, carry: $('#rv-carry').checked });
  $('#o-review').classList.add('hidden');
  show('day');
});

// ---------- estado ----------
function setState(s) {
  const first = !state;
  state = s;
  render();
  if (first) {
    if (!s.pet.name) show('onboarding');
    else if (pendingView) show(pendingView);
    else if (s.life && s.life.lastView) show(s.life.lastView);
  }
}
pm.onState(setState);
pm.getState().then(setState);

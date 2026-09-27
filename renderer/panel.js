const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let state = null;
const LOC = () => (state && state.lang) || 'es';
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
// Lleva la vista hasta una sección y la resalta un momento.
function flashTo(sel) {
  const el = $(sel);
  if (!el) return;
  if (el.tagName === 'DETAILS') el.open = true;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1800);
}

function show(view) {
  if (!state) { pendingView = view; return; }
  // Destinos tipo "day#reminders": pestaña + sección a resaltar.
  let focusSel = null;
  if (typeof view === 'string' && view.includes('#')) {
    const [v, s] = view.split('#');
    view = v;
    focusSel = '#' + s;
  }
  if (focusSel) setTimeout(() => flashTo(focusSel), 120);
  $$('.overlay').forEach((o) => o.classList.add('hidden'));
  if (view === 'report' || view === 'daily-copy') {
    openReport(view === 'report' ? 'weekly' : 'daily');
    return;
  }
  if (view === 'stats') {
    if (window.openStats) window.openStats();
    return;
  }
  if (view === 'inbox') {
    $('#o-inbox').classList.remove('hidden');
    renderInbox();
    return;
  }
  if (view === 'tour') {
    startTour();
    return;
  }
  if (view === 'prompts' || view === 'blocks' || view === 'whatsnew' || view === 'friday') {
    if (window.openExtra) window.openExtra(view);
    return;
  }
  if (view === 'shop') view = 'pet';
  if (view === 'onboarding' || view === 'standup' || view === 'review') {
    if (view === 'standup') openStandup();
    if (view === 'review') openReview();
    if (view === 'onboarding') openOnboarding();
    return;
  }
  $$('nav button').forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle('active', on);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(on));
    b.setAttribute('aria-controls', 'v-' + b.dataset.view);
    b.tabIndex = on ? 0 : -1;
  });
  $$('.view').forEach((v) => v.setAttribute('role', 'tabpanel'));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'v-' + view));
  pm.viewChanged(view);
  if (view === 'chat') setTimeout(() => $('#chat-input').focus(), 50);
}
$$('nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
// Pestañas con flechas (← →), como en cualquier app accesible.
document.querySelector('nav').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const tabs = $$('nav button');
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
  show(next.dataset.view);
  next.focus();
  e.preventDefault();
});
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
  renderInbox();
  if (window.renderExtras) window.renderExtras();
  // Accesibilidad: todo botón con solo icono lleva nombre para el lector de pantalla.
  for (const b of document.querySelectorAll('button:not([aria-label])')) {
    const txt = b.textContent.replace(/[\p{Extended_Pictographic}\uFE0F\s✕＋↻▶⏹]/gu, '');
    if (!txt && (b.title || b.dataset.q)) b.setAttribute('aria-label', b.title || b.dataset.q);
  }
  document.documentElement.classList.toggle('dark', !!state.dark); document.documentElement.classList.toggle('contrast', !!state.contrast);
  document.documentElement.classList.toggle('reduced', !!(state.settings && state.settings.reducedMotion));
  if (state.lang && state.lang !== 'es') I18N.translateDom(document.getElementById('card'), state.lang);
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

const money = (v) => '$' + (v || 0).toFixed((v || 0) < 10 ? 2 : 0);
// Coste por proyecto (hoy, y de la semana si hoy no hay nada).
function projectCosts(today, week) {
  const src = Object.keys(today || {}).length ? today : week || {};
  const list = Object.entries(src).sort((a, b) => b[1].cost - a[1].cost).slice(0, 5);
  if (!list.length) return '';
  const max = list[0][1].cost || 1;
  return list.map(([k, v]) => `<div class="proj"><span class="n" title="${esc(k)}">${esc(k)}</span><div class="bar"><i style="width:${Math.max(4, (v.cost / max) * 100)}%"></i></div><span class="t">${money(v.cost)}</span></div>`).join('');
}

// Predicción: ritmo y a qué hora llegarías al 100%.
function forecastHtml(f, l) {
  if (!f) return '';
  if (f.rate === null) return '<div class="fc muted">🔮 Calculando tu ritmo… (necesito unos minutos de datos)</div>';
  const rate = `+${f.rate < 10 ? f.rate.toFixed(1) : Math.round(f.rate)}%/h`;
  if (!f.eta || !f.willHit) return `<div class="fc ok">🔮 Ritmo ${rate} · al paso actual <b>no llegarás al límite</b> antes del reinicio ✅</div>`;
  const opts = l.key === 'five_hour' ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' };
  return `<div class="fc warn">🔮 Ritmo ${rate} · llegarás al 100% a las <b>${new Date(f.eta).toLocaleString(LOC(), opts)}</b> (${fmtDur(f.beforeReset / 1000)} antes del reinicio)</div>`;
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
        ${forecastHtml((u.forecast || {})[l.key], l)}
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
      <div class="tile wide"><span>Modelos hoy</span><div>${models}</div></div>
      <div class="tile wide cost">
        <div class="cost-title">💵 Coste equivalente en la API</div>
        <div class="cost-sum"><div><small>Hoy</small><strong>${money(t.cost)}</strong></div><div><small>7 días</small><strong>${money(w.cost)}</strong></div></div>
        ${projectCosts(t.projects, w.projects)}
        <span class="small muted">Con tu plan no pagas esto: es lo que costaría por API. Útil para ver dónde se va tu cuota.</span>
      </div>`;
  }
  $('#fetched').textContent = u.fetchedAt ? 'Actualizado ' + new Date(u.fetchedAt).toLocaleTimeString(LOC(), { hour: '2-digit', minute: '2-digit' }) : '';
}

function renderDay() {
  const day = state.today || {};
  const tasks = (day.standup && day.standup.today) || [];
  const done = tasks.filter((t) => t.done).length;
  $('#day-title').textContent = 'Hoy · ' + new Date().toLocaleDateString(LOC(), { weekday: 'long', day: 'numeric', month: 'short' });
  $('#day-progress').textContent = tasks.length ? `${done}/${tasks.length}` : 'sin plan';
  // No repintar mientras editas una tarea o la arrastras.
  if (!$('#tasks input.edit, #tasks input.tedit') && !dragFrom) {
    const PRIO_T = { h: 'Prioridad alta', m: 'Prioridad media', l: 'Prioridad baja' };
    $('#tasks').innerHTML = tasks.length
      ? tasks.map((t, i) => `<li class="${t.done ? 'done' : ''}" draggable="true" data-i="${i}">
          <span class="grip" title="Arrastra para ordenar">${ICON('grip', 14)}</span>
          <button class="prio ${t.priority || ''}" data-prio="${i}" title="${t.priority ? PRIO_T[t.priority] : 'Sin prioridad'} (clic para cambiar)" aria-label="Prioridad"></button>
          <input type="checkbox" data-i="${i}" ${t.done ? 'checked' : ''} aria-label="Hecha"/>
          <span class="t" data-edit="${i}" title="Doble clic para editar">${esc(t.text)}</span>${!t.done && (state.taskAges || [])[i] >= 2 ? `<span class="age ${(state.taskAges[i] >= 4) ? 'hot' : ''}" title="Lleva ${state.taskAges[i]} días laborables posponiéndose">🔥${state.taskAges[i]}d</span>` : ''}
          <span class="ttime ${t.time ? '' : 'empty'}" data-time="${i}" title="Hora (crea un recordatorio)">${t.time ? '🕒 ' + esc(t.time) : '🕒'}</span>
          <span class="timer ${t.startedAt ? 'on' : ''} ${t.spent || t.est || t.startedAt ? '' : 'empty'}" data-timer="${i}" title="Clic: iniciar / pausar cronómetro · Doble clic: estimar minutos">${timerText(t)}</span>
          ${!t.done && !/^↳/.test(t.text) ? `<button class="split" data-split="${i}" title="Dividir en pasos" aria-label="Dividir en pasos">🪜</button>` : ''}<button data-del="${i}" title="Quitar" aria-label="Quitar">✕</button></li>`).join('')
      : '<li class="empty">Aún no hay tareas. Haz el daily o añade una 👇</li>';
  }

  // Qué tan bien estimas (con al menos 3 tareas cronometradas y estimadas).
  const est = state.estimates || {};
  const ei = $('#est-insight');
  ei.classList.toggle('hidden', !est.ratio);
  if (est.ratio) {
    const r = est.ratio;
    ei.textContent = r > 1.15
      ? `⏱️ Sueles tardar ${r.toFixed(1).replace('.', ',')}× lo que estimas (${est.samples} tareas). ¡Estima un poco más largo!`
      : r < 0.85
        ? `⏱️ Terminas antes de lo que estimas (${Math.round(r * 100)}% del tiempo). ¡Eres más rápido de lo que crees!`
        : `⏱️ ¡Estimas muy bien! Tardas lo que calculas (${est.samples} tareas).`;
  }

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
  $('#st-clean').style.width = Math.round(p.clean ?? 100) + '%';
  $('#st-energy').style.width = Math.round(p.energy ?? 100) + '%';
  const napping = (p.napUntil || 0) > Date.now();
  const status = p.sick ? '🤒 Está enfermo: dale una medicina (y comida y un baño).' : napping ? '😴 Durmiendo la siesta…' : (p.clean ?? 100) < 35 ? '🪰 Está sucio: ¡hora del baño!' : (p.energy ?? 100) < 25 ? '😪 Está muy cansado: déjalo dormir una siesta.' : '';
  $('#st-status').textContent = status;
  $('#st-status').classList.toggle('hidden', !status);
  $('#medicine').classList.toggle('hidden', !p.sick);
  $('#nap').disabled = napping;
  const lv = state.level || { level: 1, title: 'Pollito becario', into: 0, next: 100 };
  $('#lv-title').textContent = lv.title;
  $('#lv-num').textContent = 'Nv ' + lv.level;
  $('#st-xp').style.width = Math.round((lv.into / lv.next) * 100) + '%';

  // Primeros pasos
  const cl = state.checklist || [];
  const done = cl.filter((x) => x.done).length;
  $('#checklist-box').classList.toggle('hidden', cl.length > 0 && done === cl.length);
  $('#cl-count').textContent = `${done}/${cl.length}`;
  $('#cl-bar').style.width = cl.length ? Math.round((done / cl.length) * 100) + '%' : '0%';
  $('#checklist').innerHTML = cl.map((x) => `<li class="${x.done ? 'done' : ''}" ${x.done ? '' : `data-cmd="${esc(x.cmd)}"`}><span class="ck">${x.done ? '✓' : ''}</span>${esc(x.label)}</li>`).join('');
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
document.addEventListener('click', (e) => {
  const r = e.target.closest('[data-rem]');
  if (r) {
    const rem = (state.reminders || []).find((x) => x.id === r.dataset.rem);
    pm.removeReminder(r.dataset.rem);
    if (rem) toast(`Recordatorio eliminado`, () => pm.restoreReminder(rem));
  }
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
  if (md) {
    const mon = (state.monitors || []).find((x) => x.id === md.dataset.monDel);
    state = await pm.removeMonitor(md.dataset.monDel);
    render();
    if (mon) toast('Sitio eliminado', async () => { const r = await pm.addMonitor(mon.url, mon.name); if (r.ok) { state = r.state; render(); } });
  }
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

// ---------- cabecera: paleta, avisos, ajustes ----------
$('#hb-palette').addEventListener('click', () => pm.openPalette());
$('#hb-inbox').addEventListener('click', () => show('inbox'));
$('#hb-settings').addEventListener('click', () => pm.openSettings());

// ---------- centro de avisos ----------
const IB_CATS = [
  ['all', 'Todo'], ['routine', '☀️ Rutina'], ['meeting', '📅 Reuniones'], ['reminder', '⏰ Recordatorios'], ['claude', '🤖 Claude'],
  ['focus', '👀 Enfoque'], ['usage', '📊 Uso'], ['github', '🐙 GitHub'], ['git', '📦 Git'], ['monitor', '🌐 Sitios'],
  ['pomodoro', '🍅 Pomodoro'], ['health', '🧘 Salud'], ['achievement', '🏅 Logros'], ['mail', '📧 Correo'], ['pet', '🐣 Pollito'],
];
let ibFilter = 'all';
function renderInbox() {
  const items = state.inbox || [];
  const present = new Set(items.map((x) => x.cat));
  $('#ib-filters').innerHTML = IB_CATS.filter(([k]) => k === 'all' || present.has(k))
    .map(([k, n]) => `<button type="button" class="${k === ibFilter ? 'on' : ''}" data-ibf="${k}">${n}</button>`).join('');
  const list = items.filter((x) => ibFilter === 'all' || x.cat === ibFilter);
  $('#ib-list').innerHTML = list.length
    ? list.map((x) => {
        const d = new Date(x.at);
        const when = d.toDateString() === new Date().toDateString() ? hm(x.at) : d.toLocaleDateString(LOC(), { day: 'numeric', month: 'short' }) + ' ' + hm(x.at);
        const cat = (IB_CATS.find(([k]) => k === x.cat) || ['', ''])[1];
        const acts = (x.actions || []).filter((a) => !/^(ack|snooze\.|focus\.)/.test(a.cmd));
        const tg = x.target || { cmd: 'panel', arg: IB_TARGET[x.cat] || 'chat' };
        return `<div class="ib ${x.read ? '' : 'unread'}" role="button" tabindex="0" data-ibid="${esc(x.id)}" data-tcmd="${esc(tg.cmd)}" data-targ="${esc(tg.arg || '')}" title="Clic para ir a verlo">
          <div class="meta"><span>${esc(cat)}</span><span>${esc(when)}</span></div>${esc(x.text)}
          <div class="ib-foot">${acts.length ? `<div class="acts">${acts.map((a) => `<button type="button" data-ibcmd="${esc(a.cmd)}" data-ibarg="${esc(a.arg || '')}">${esc(a.label)}</button>`).join('')}</div>` : '<span></span>'}<span class="go">Ver →</span></div></div>`;
      }).join('')
    : '<div class="empty">No hay avisos por aquí 🐣</div>';
  const unread = state.unread || 0;
  $('#hb-badge').textContent = unread > 9 ? '9+' : String(unread);
  $('#hb-badge').classList.toggle('hidden', !unread);
}
$('#ib-filters').addEventListener('click', (e) => { const b = e.target.closest('[data-ibf]'); if (b) { ibFilter = b.dataset.ibf; renderInbox(); } });
// Destino por categoría (para avisos antiguos que no lo traen guardado).
const IB_TARGET = {
  meeting: 'agenda#meetings', reminder: 'day#reminders', usage: 'usage#limits', focus: 'day#focus', github: 'agenda#ghbox',
  git: 'day#gitbox', monitor: 'agenda#monitors', pomodoro: 'day#pomo-box', health: 'day#focus', achievement: 'pet#achievements',
  mail: 'agenda#mailbox', claude: 'usage#local', pet: 'pet', routine: 'day',
};
function openInboxItem(card) {
  pm.inboxRead(card.dataset.ibid);
  $('#o-inbox').classList.add('hidden');
  const cmd = card.dataset.tcmd;
  const arg = card.dataset.targ || undefined;
  // Si el destino está en este mismo panel, navega aquí; si no (web, proyecto…), lo hace la app.
  if (cmd === 'panel') show(arg || 'chat');
  else pm.command(cmd, arg);
}
$('#ib-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ibcmd]');
  if (b) {
    e.stopPropagation();
    pm.command(b.dataset.ibcmd, b.dataset.ibarg || undefined);
    return;
  }
  const card = e.target.closest('.ib[data-ibid]');
  if (card) openInboxItem(card);
});
$('#ib-list').addEventListener('keydown', (e) => {
  const card = e.target.closest('.ib[data-ibid]');
  if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openInboxItem(card); }
});
$('#ib-close').addEventListener('click', () => { $('#o-inbox').classList.add('hidden'); pm.inboxRead(); });
$('#ib-read').addEventListener('click', () => pm.inboxRead());
$('#ib-clear').addEventListener('click', () => pm.inboxClear());

// ---------- tour de bienvenida ----------
const TOUR = [
  { view: 'chat', sel: 'header', text: '👋 ¡Hola! Soy tu pollito PM. Aquí arriba ves mi ánimo y cuánto llevas de tu sesión de Claude.' },
  { view: 'chat', sel: '.hbtns', text: '🔍 Busca cualquier acción, 🔔 revisa tus avisos y ⚙️ abre los ajustes. Truco: Ctrl+Alt+Espacio abre la paleta desde cualquier app.' },
  { view: 'chat', sel: 'nav', text: '📑 Estas son mis pestañas. También puedes cambiar con las teclas 1 a 5.' },
  { view: 'chat', sel: '#chat-form', text: '💬 Pregúntame lo que quieras: “¿cuánto llevo?”, “mis tareas”, “recuérdame a las 3…”. Pulsa / para escribir aquí.' },
  { view: 'usage', sel: '#limits', text: '📊 Tus límites de Claude y cuándo se reinician. Te aviso al 50, 75, 90 y 100%.' },
  { view: 'day', sel: '#pomo-box', text: '🍅 Pomodoro: 25 min de concentración. Mientras dura me pongo mi bandana y te vigilo más de cerca.' },
  { view: 'day', sel: '#tasks', text: '✅ Tus tareas del día. Doble clic para editar, arrástralas para ordenar, el puntito cambia la prioridad y el 🕒 pone hora.' },
  { view: 'agenda', sel: '#meetings', text: '📅 Reuniones, GitHub, tus sitios y correo. Conecta tu calendario para que te avise antes de cada reunión.' },
  { view: 'pet', sel: '#checklist-box', text: '🚀 Completa estos pasos para sacarme todo el partido. ¡Y compra accesorios en la tienda con tu maíz 🌽!' },
];
let tourI = 0;
function tourShow() {
  const st = TOUR[tourI];
  show(st.view, true);
  setTimeout(() => {
    const el = $(st.sel);
    const spot = $('#tour-spot');
    const card = $('#tour-card');
    if (el) {
      const r = el.getBoundingClientRect();
      Object.assign(spot.style, { left: r.left - 4 + 'px', top: r.top - 4 + 'px', width: r.width + 8 + 'px', height: r.height + 8 + 'px' });
      spot.classList.remove('hidden');
      const below = r.bottom + 170 < window.innerHeight;
      card.style.top = (below ? r.bottom + 12 : Math.max(10, r.top - 150)) + 'px';
    }
    $('#tour-step').textContent = `${tourI + 1} / ${TOUR.length}`;
    $('#tour-text').textContent = state ? I18N.tr(st.text, state.lang) : st.text;
    $('#tour-prev').classList.toggle('hidden', tourI === 0);
    $('#tour-next').textContent = tourI === TOUR.length - 1 ? '¡Listo! 🎉' : 'Siguiente';
    card.classList.remove('hidden');
    $('#tour-next').focus();
  }, 120);
}
function tourEnd() {
  $('#tour-spot').classList.add('hidden');
  $('#tour-card').classList.add('hidden');
  pm.setFlags({ tourDone: true });
  show('chat');
}
$('#tour-next').addEventListener('click', () => { if (tourI < TOUR.length - 1) { tourI++; tourShow(); } else tourEnd(); });
$('#tour-prev').addEventListener('click', () => { if (tourI > 0) { tourI--; tourShow(); } });
$('#tour-skip').addEventListener('click', tourEnd);
function startTour() { tourI = 0; tourShow(); }

// ---------- atajos de teclado en el panel ----------
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); pm.openPalette(); return; }
  if (e.ctrlKey && e.key === ',') { e.preventDefault(); pm.openSettings(); return; }
  if (!$('#tour-card').classList.contains('hidden')) {
    if (e.key === 'ArrowRight' || e.key === 'Enter') $('#tour-next').click();
    if (e.key === 'ArrowLeft') $('#tour-prev').click();
    return;
  }
  if (typing || e.ctrlKey || e.altKey || e.metaKey) return;
  const views = ['chat', 'usage', 'day', 'agenda', 'pet'];
  if (/^[1-5]$/.test(e.key)) { show(views[Number(e.key) - 1]); e.preventDefault(); }
  else if (e.key === '/') { show('chat'); $('#chat-input').focus(); e.preventDefault(); }
  else if (e.key.toLowerCase() === 'n') { show('day'); $('#task-input').focus(); e.preventDefault(); }
  else if (e.key.toLowerCase() === 'p') { state.pomo ? pm.pomoStop() : pm.pomoStart(); e.preventDefault(); }
});

// Pregunta enviada desde la paleta de comandos.
pm.onChatAsk((text) => { show('chat'); send(text); });

// ---------- chat ----------
async function send(text) {
  text = text.trim();
  if (!text) return;
  $('#chat-input').value = '';
  await pm.chat(text);
}
$('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); send($('#chat-input').value); });
$$('.chips button[data-q]').forEach((b) => b.addEventListener('click', () => send(b.dataset.q)));

// ---------- uso ----------
async function refresh() {
  $('#refresh').textContent = '⏳';
  state = await pm.refreshUsage();
  $('#refresh').textContent = '↻ Actualizar';
  render();
}
$('#refresh').addEventListener('click', refresh);
setInterval(() => { if (state) renderUsage(); }, 30000); // cuenta atrás de reinicio

// ---------- tareas editables ----------
let dragFrom = null;
const tasksEl = document.getElementById('tasks');
const PRIO_NEXT = { undefined: 'h', '': 'h', h: 'm', m: 'l', l: '' };

tasksEl.addEventListener('change', (e) => {
  const cb = e.target.closest('input[type=checkbox][data-i]');
  if (cb) pm.toggleTask(state.todayKey, Number(cb.dataset.i));
});
tasksEl.addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    const i = Number(del.dataset.del);
    const removed = await pm.removeTask(i);
    if (removed) toast(`Tarea eliminada: “${removed.text}”`, () => pm.restoreTask(i, removed));
    return;
  }
  const pr = e.target.closest('[data-prio]');
  if (pr) {
    const i = Number(pr.dataset.prio);
    const t = state.today.standup.today[i];
    pm.updateTask(i, { priority: PRIO_NEXT[t.priority || ''] });
    return;
  }
  const tm = e.target.closest('[data-time]');
  if (tm && !tm.querySelector('input')) {
    const i = Number(tm.dataset.time);
    const t = state.today.standup.today[i];
    tm.innerHTML = `<input type="time" class="tedit" value="${esc(t.time || '')}" />`;
    const inp = tm.querySelector('input');
    inp.focus();
    const commit = () => { pm.updateTask(i, { time: inp.value || '' }); inp.classList.remove('tedit'); setTimeout(render, 0); };
    inp.addEventListener('change', commit);
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { inp.value = t.time || ''; inp.blur(); } });
  }
});
// Doble clic para editar el texto.
tasksEl.addEventListener('dblclick', (e) => {
  const sp = e.target.closest('[data-edit]');
  if (!sp) return;
  const i = Number(sp.dataset.edit);
  const old = sp.textContent;
  sp.innerHTML = `<input class="edit" value="${esc(old)}" maxlength="200" />`;
  const inp = sp.querySelector('input');
  inp.focus();
  inp.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const v = inp.value.trim();
    inp.classList.remove('edit');
    if (save && v && v !== old) pm.editTask(i, v);
    else sp.textContent = old;
    setTimeout(render, 0);
  };
  inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
});
// Arrastrar para reordenar.
tasksEl.addEventListener('dragstart', (e) => {
  const li = e.target.closest('li[data-i]');
  if (!li) return;
  dragFrom = Number(li.dataset.i);
  li.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});
tasksEl.addEventListener('dragover', (e) => {
  const li = e.target.closest('li[data-i]');
  if (!li || dragFrom === null) return;
  e.preventDefault();
  const r = li.getBoundingClientRect();
  const below = e.clientY > r.top + r.height / 2;
  $$('#tasks li').forEach((x) => x.classList.remove('drop-above', 'drop-below'));
  li.classList.add(below ? 'drop-below' : 'drop-above');
});
tasksEl.addEventListener('drop', (e) => {
  e.preventDefault();
  const li = e.target.closest('li[data-i]');
  if (li && dragFrom !== null) {
    let to = Number(li.dataset.i);
    const below = li.classList.contains('drop-below');
    if (below && to < dragFrom) to += 1;
    if (!below && to > dragFrom) to -= 1;
    if (to !== dragFrom) pm.moveTask(dragFrom, to);
  }
});
tasksEl.addEventListener('dragend', () => {
  dragFrom = null;
  $$('#tasks li').forEach((x) => x.classList.remove('dragging', 'drop-above', 'drop-below'));
  setTimeout(render, 0);
});

// ---------- cronómetro por tarea ----------
function spentOf(t) {
  return (t.spent || 0) + (t.startedAt ? (Date.now() - t.startedAt) / 1000 : 0);
}
function clock(secs) {
  const s = Math.floor(secs), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
function timerText(t) {
  const s = spentOf(t);
  const icon = t.startedAt ? '⏸' : '▶';
  if (!s && !t.est) return '⏱';
  const over = t.est && s > t.est * 60;
  return `${icon} ${clock(s)}${t.est ? ` / ${t.est}m` : ''}${over ? ' ⚠️' : ''}`;
}
// Refresco en vivo del cronómetro que está en marcha (sin repintar la lista).
setInterval(() => {
  if (!state || !state.today || !state.today.standup) return;
  state.today.standup.today.forEach((t, i) => {
    if (!t.startedAt) return;
    const el = document.querySelector(`#tasks [data-timer="${i}"]`);
    if (el && !el.querySelector('input')) el.textContent = timerText(t);
  });
}, 1000);
let timerClickT = null;
tasksEl.addEventListener('click', (e) => {
  const tm = e.target.closest('[data-timer]');
  if (!tm || tm.querySelector('input')) return;
  // Espera un poco por si es doble clic (estimar).
  clearTimeout(timerClickT);
  timerClickT = setTimeout(() => {
    const i = Number(tm.dataset.timer);
    const t = state.today.standup.today[i];
    pm.taskTimer(i, t.startedAt ? 'stop' : 'start');
  }, 230);
});
tasksEl.addEventListener('dblclick', (e) => {
  const tm = e.target.closest('[data-timer]');
  if (!tm) return;
  clearTimeout(timerClickT);
  const i = Number(tm.dataset.timer);
  const t = state.today.standup.today[i];
  tm.innerHTML = `<input type="number" class="tedit" min="1" max="600" placeholder="min" value="${t.est || ''}" />`;
  const inp = tm.querySelector('input');
  inp.focus();
  inp.select();
  let done = false;
  const commit = () => { if (done) return; done = true; pm.updateTask(i, { est: inp.value }); inp.classList.remove('tedit'); setTimeout(render, 0); };
  inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') commit(); if (ev.key === 'Escape') { done = true; inp.classList.remove('tedit'); setTimeout(render, 0); } });
  inp.addEventListener('blur', commit);
});

// ---------- aviso con "Deshacer" ----------
let toastTimer = null;
let toastUndo = null;
function toast(text, undo) {
  $('#toast-text').textContent = state ? I18N.tr(text, state.lang) : text;
  $('#toast-undo').classList.toggle('hidden', !undo);
  toastUndo = undo || null;
  $('#toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.add('hidden'), 6000);
}
$('#toast-undo').addEventListener('click', () => {
  if (toastUndo) toastUndo();
  toastUndo = null;
  $('#toast').classList.add('hidden');
});

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
$('#open-settings2').addEventListener('click', () => pm.openSettings());
$('#bath').addEventListener('click', () => pm.command('bath'));
$('#nap').addEventListener('click', () => pm.command('nap'));
$('#medicine').addEventListener('click', () => pm.command('medicine'));
$('#checklist').addEventListener('click', (e) => {
  const li = e.target.closest('[data-cmd]');
  if (li) pm.command(li.dataset.cmd);
});

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
  const sp = document.querySelector('#onb-species .sp.on');
  if (sp && sp.dataset.sp !== 'chick') pm.setSpecies(sp.dataset.sp);
  $('#o-onboarding').classList.add('hidden');
  show('chat');
  // Primera vez: tour de bienvenida.
  if (!(state.flags && state.flags.tourDone)) setTimeout(startTour, 2500);
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
    // Las recurrentes de hoy ya vienen puestas 🔁
    for (const t of state.recurringToday || []) if (!suTasks.includes(t)) suTasks.push(t);
    // El lunes, lo que planeaste en la revisión del viernes 📆
    for (const t of state.mondayPlan || []) if (!suTasks.includes(t)) suTasks.push(t);
    $('#su-help').value = '';
    $('#su-intro').textContent = prev ? `Te dejé lo que planeaste el ${dayLabel(prev.date)} para que lo ajustes.` : 'Cuéntame para organizar el día.';
    // Añade tus commits del último día laborable (git) a "¿Qué hiciste ayer?".
    const base = $('#su-yesterday').value;
    pm.gitYesterday().then((commits) => {
      if (!commits || !commits.length || $('#su-yesterday').value !== base) return;
      const lines = commits.slice(-12).map((c) => `📦 [${c.repo}] ${c.subject}`);
      $('#su-yesterday').value = (base ? base + '\n' : '') + lines.join('\n');
      $('#su-intro').textContent += ` Añadí tus ${commits.length} commit${commits.length === 1 ? '' : 's'} de git 📦`;
    }).catch(() => {}).finally(() => {
      // …y lo que le pediste a Claude Code ese día.
      const cj = (state.claudeJournal && state.claudeJournal.prev) || [];
      if (!cj.length) return;
      const cur = $('#su-yesterday').value;
      $('#su-yesterday').value = (cur ? cur + '\n' : '') + cj.map((p) => `🤖 [${p.project}] ${p.items.join(' · ')}`).join('\n');
      $('#su-intro').textContent += ' y lo que hiciste con Claude 🤖';
    });
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
let rvMood = 0;
$('#rv-mood').addEventListener('click', (e) => {
  const b = e.target.closest('[data-m]');
  if (!b) return;
  rvMood = Number(b.dataset.m);
  $$('#rv-mood button').forEach((x) => x.classList.toggle('on', x === b));
});
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
  rvMood = state.today.mood || 0;
  $$('#rv-mood button').forEach((b) => b.classList.toggle('on', Number(b.dataset.m) === rvMood));
  $('#o-review').classList.remove('hidden');
}
$('#rv-later').addEventListener('click', async () => { await pm.snooze('review'); $('#o-review').classList.add('hidden'); pm.hidePanel(); });
$('#rv-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const done = $$('#rv-tasks input').map((cb) => cb.checked);
  await pm.saveReview({ done, notes: $('#rv-notes').value, carry: $('#rv-carry').checked, mood: rvMood || undefined });
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

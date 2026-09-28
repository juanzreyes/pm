// Panel: centro de avisos y tour de bienvenida. Separado de panel.js (usa $, $$, esc, state, render, show… de allí;
// se carga justo después y repinta si el panel ya se había pintado).
/* global $, $$, esc, state, render, show, LOC, hm, I18N */

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

// Si el panel ya pintó antes de cargar este archivo, repinta con todo.
if (typeof state !== 'undefined' && state) render();

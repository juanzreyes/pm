// Ventanita de la extensión: lee el último estado del service worker y manda acciones.
/* global chrome */
const $ = (s) => document.querySelector(s);
const send = (msg) => new Promise((ok) => chrome.runtime.sendMessage(msg, ok));
const flash = (t, bad) => { $('#msg').textContent = t; $('#msg').className = 'small ' + (bad ? 'err' : 'muted'); };

function bar(id, pct) {
  const el = $(id);
  el.style.width = Math.min(100, pct || 0) + '%';
  el.className = pct >= 90 ? 'hot' : pct >= 70 ? 'warn' : '';
}
async function render() {
  const { status: st, error } = await chrome.storage.session.get(['status', 'error']);
  const { token } = await chrome.storage.local.get('token');
  $('#err').classList.toggle('hidden', !error);
  $('#err-text').textContent = error || '';
  $('#pair').classList.toggle('hidden', !!token && !/emparejar|Código/i.test(error || ''));
  $('#main').classList.toggle('hidden', !st);
  if (!st) return;
  $('#name').textContent = st.name || 'PM Pollito';
  bar('#s-bar', st.session && st.session.pct);
  bar('#w-bar', st.weekly && st.weekly.pct);
  $('#s-pct').textContent = st.session ? st.session.pct + '%' : '—';
  $('#w-pct').textContent = st.weekly ? st.weekly.pct + '%' : '—';
  $('#tasks').textContent = `✅ ${st.tasks.done}/${st.tasks.total} tareas${st.runningTask ? ' · ▶ ' + st.runningTask.text : ''}${st.meeting ? ' · 🔴 en reunión' : ''}`;
  $('#focus-off').classList.toggle('hidden', !!st.focus);
  $('#focus-on').classList.toggle('hidden', !st.focus);
  $('#sites-n').textContent = st.blockSites.length ? `frena ${st.blockSites.length} sitios` : '';
  if (st.focus) $('#focus-text').textContent = st.focus.until ? `🎯 En foco · quedan ${self.PMExt.minsLeft(st.focus.until)} min` : '🎯 En foco';
}
async function act(msg, ok) {
  const r = await send(msg);
  if (!r || !r.ok) return flash('😿 ' + ((r && r.error) || 'No pude hablar con PM'), true);
  flash(ok);
  await send({ type: 'refresh' });
  render();
}
async function currentTab() { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t || {}; }

document.querySelectorAll('[data-min]').forEach((b) => b.addEventListener('click', () => act({ type: 'focus', data: { minutes: Number(b.dataset.min) } }, '🎯 ¡A concentrarse!')));
$('#focus-stop').addEventListener('click', () => act({ type: 'focus', data: { stop: true } }, '🏁 Foco terminado'));
$('#add').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#add-text').value.trim();
  if (!text) return;
  $('#add-text').value = '';
  act({ type: 'capture', data: { text, kind: 'task' } }, '📌 ¡Anotado en PM!');
});
$('#page-task').addEventListener('click', async () => { const t = await currentTab(); act({ type: 'capture', data: { title: t.title, url: t.url, kind: 'task' } }, '📌 Página añadida como tarea'); });
$('#page-note').addEventListener('click', async () => { const t = await currentTab(); act({ type: 'capture', data: { title: t.title, url: t.url, kind: 'note' } }, '📝 Guardada en tus notas'); });
$('#pair').addEventListener('click', () => chrome.runtime.openOptionsPage());

render();
send({ type: 'refresh' }).then(render);

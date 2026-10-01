// Widget de escritorio: se repinta con cada cambio de estado (y cada 30 s, por las cuentas atrás).
/* global I18N */
const $ = (s) => document.querySelector(s);
let state = null;

function bar(id, pct) {
  const el = $(id);
  el.style.width = Math.min(100, Math.max(0, pct)) + '%';
  el.className = pct >= 90 ? 'hot' : pct >= 70 ? 'warn' : '';
}
const hm = (ms) => new Date(ms).toLocaleTimeString(state && state.lang === 'en' ? 'en' : 'es', { hour: '2-digit', minute: '2-digit' });

function render() {
  if (!state) return;
  document.body.classList.toggle('dark', !!state.dark);
  $('#name').textContent = state.pet ? state.pet.name || 'PM' : 'PM';
  const lims = (state.usage && state.usage.limits) || [];
  for (const [key, b, p] of [['five_hour', '#s-bar', '#s-pct'], ['seven_day', '#w-bar', '#w-pct']]) {
    const l = lims.find((x) => x.key === key);
    bar(b, l ? l.utilization : 0);
    $(p).textContent = l ? Math.round(l.utilization) + '%' : '—';
  }
  const tasks = (state.today && state.today.standup && state.today.standup.today) || [];
  const running = tasks.find((t) => t.startedAt && !t.done);
  const pending = tasks.find((t) => !t.done);
  const done = tasks.filter((t) => t.done).length;
  const cur = running || pending;
  $('#tasks').textContent = tasks.length ? `✅ ${done}/${tasks.length}${cur ? ` · ${running ? '▶ ' : ''}${cur.text}` : ' · ¡todo listo!'}` : '✅ Aún sin plan de hoy';
  const now = Date.now();
  const ev = ((state.calendar && state.calendar.events) || []).find((e) => e.end > now && e.start < now + 12 * 3600e3);
  $('#next').textContent = state.meetingNow ? `🔴 En reunión: ${state.meetingNow.title || state.meetingNow.app}` : ev ? `📅 ${ev.start <= now ? 'Ahora' : hm(ev.start)} · ${ev.title}` : '📅 Sin reuniones pendientes';
  const pomo = state.pomo;
  $('#w-pomo').textContent = pomo && pomo.phase ? `⏹ ${Math.max(0, Math.ceil((pomo.endsAt - now) / 60e3))} min` : '🍅 Pomodoro';
  $('#focus').hidden = !state.focusMode;
  if (state.lang && state.lang !== 'es') I18N.translateDom(document.body, state.lang);
}

pm.getState().then((s) => { state = s; render(); });
pm.onState((s) => { state = s; render(); });
setInterval(render, 30e3);
$('#w-close').addEventListener('click', () => pm.command('widget.toggle'));
$('#w-pomo').addEventListener('click', () => pm.command(state && state.pomo && state.pomo.phase ? 'pomo.stop' : 'pomo.start'));
$('#w-add').addEventListener('click', () => pm.command('capture'));
$('#w-panel').addEventListener('click', () => pm.command('panel', 'day'));

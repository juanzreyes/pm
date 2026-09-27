// Informe mensual: una página HTML bonita que se convierte en PDF.
const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hours = (s) => (s / 3600).toFixed(1).replace('.', ',');

/**
 * data: store.data · extra: { name, local (usage.local), achievements (catálogo), iconDataUrl }
 * month: Date de cualquier día del mes a informar.
 */
function build(data, extra, month = new Date()) {
  const y = month.getFullYear(), m = month.getMonth();
  const label = month.toLocaleDateString('es', { month: 'long', year: 'numeric' });
  const daysIn = new Date(y, m + 1, 0).getDate();
  const rows = [];
  let work = 0, dist = 0, pomos = 0, commits = 0, done = 0, total = 0, meetMins = 0, claudeTasks = 0;
  const projects = {}, moods = [];
  for (let d = 1; d <= daysIn; d++) {
    const k = `${y}-${pad(m + 1)}-${pad(d)}`;
    const v = data.days[k];
    if (!v) continue;
    const w = (v.focus && v.focus.work) || 0;
    work += w;
    dist += (v.focus && v.focus.distraction) || 0;
    pomos += v.pomodoros || 0;
    commits += v.commits || 0;
    claudeTasks += v.claudeTasks || 0;
    const t = (v.standup && v.standup.today) || [];
    total += t.length;
    done += t.filter((x) => x.done).length;
    for (const mt of v.meetings || []) meetMins += mt.mins || 0;
    for (const [p, s] of Object.entries(v.projects || {})) projects[p] = (projects[p] || 0) + s;
    if (v.mood) moods.push(v.mood);
    rows.push({ d, w });
  }
  // Coste de Claude del mes (registros locales: últimos 30 días).
  let cost = 0, tokens = 0;
  for (const [k, v] of Object.entries((extra.local && extra.local.byDay) || {})) {
    const [ky, km] = k.split('-').map(Number);
    if (ky === y && km === m + 1) { cost += v.cost || 0; tokens += v.tokens || 0; }
  }
  const unlocked = (data.pet.achievements || []).filter((a) => { const d = new Date(a.at); return d.getFullYear() === y && d.getMonth() === m; });
  const achMap = Object.fromEntries((extra.achievements || []).map((a) => [a.id, a]));
  const topProjects = Object.entries(projects).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxP = topProjects.length ? topProjects[0][1] : 1;
  const maxW = Math.max(1, ...rows.map((r) => r.w));
  const avgMood = moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : null;
  const MOOD = ['', '😫', '😕', '😐', '🙂', '😄'];

  const bars = Array.from({ length: daysIn }, (_, i) => {
    const r = rows.find((x) => x.d === i + 1);
    const h = r ? Math.max(2, (r.w / maxW) * 90) : 0;
    return `<div class="day"><div class="b" style="height:${h}px"></div><span>${i + 1}</span></div>`;
  }).join('');

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe ${esc(label)}</title><style>
  @page { size: A4; margin: 16mm; }
  body { font-family: "Segoe UI", system-ui, sans-serif; color: #3b2f2f; margin: 0; }
  header { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #ffd84a; padding-bottom: 10px; }
  header img { width: 64px; height: 64px; }
  h1 { margin: 0; font-size: 26px; } h2 { font-size: 16px; margin: 22px 0 8px; }
  .sub { color: #8a7a6a; font-size: 13px; }
  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 16px; }
  .tile { border: 1.5px solid #efe2bf; border-radius: 12px; padding: 10px; background: #fffdf6; }
  .tile b { display: block; font-size: 22px; } .tile span { font-size: 11px; color: #8a7a6a; }
  .chart { display: flex; align-items: flex-end; gap: 3px; height: 110px; border-bottom: 1.5px solid #efe2bf; padding-top: 6px; }
  .day { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
  .day .b { width: 100%; background: #2a78d6; border-radius: 3px 3px 0 0; } .day span { font-size: 8px; color: #8a7a6a; margin-top: 2px; }
  .proj { display: flex; align-items: center; gap: 8px; font-size: 12px; margin: 4px 0; }
  .proj .n { width: 150px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .proj .bar { flex: 1; height: 10px; background: #f2e8cc; border-radius: 99px; overflow: hidden; } .proj .bar i { display: block; height: 100%; background: #2a78d6; }
  .proj .t { width: 60px; text-align: right; color: #8a7a6a; }
  ul { margin: 0; padding-left: 18px; font-size: 13px; }
  footer { margin-top: 26px; font-size: 11px; color: #8a7a6a; text-align: center; }
  </style></head><body>
  <header>${extra.iconDataUrl ? `<img src="${extra.iconDataUrl}">` : ''}<div><h1>Informe de ${esc(label)}</h1><div class="sub">${esc(extra.name)} · tu pollito Project Manager</div></div></header>
  <div class="tiles">
    <div class="tile"><b>${hours(work)} h</b><span>trabajo enfocado</span></div>
    <div class="tile"><b>${total ? Math.round((done / total) * 100) : 0}%</b><span>tareas cumplidas (${done}/${total})</span></div>
    <div class="tile"><b>${pomos}</b><span>pomodoros 🍅</span></div>
    <div class="tile"><b>${commits}</b><span>commits 📦</span></div>
    <div class="tile"><b>${hours(dist)} h</b><span>distracciones</span></div>
    <div class="tile"><b>${Math.round(meetMins / 60 * 10) / 10} h</b><span>en reuniones</span></div>
    <div class="tile"><b>$${cost.toFixed(2)}</b><span>coste equivalente de Claude</span></div>
    <div class="tile"><b>${avgMood ? MOOD[Math.round(avgMood)] + ' ' + avgMood.toFixed(1) : '—'}</b><span>ánimo medio</span></div>
  </div>
  <h2>Horas trabajadas por día</h2><div class="chart">${bars}</div>
  ${topProjects.length ? `<h2>Tiempo por proyecto</h2>${topProjects.map(([p, s]) => `<div class="proj"><span class="n">${esc(p)}</span><div class="bar"><i style="width:${(s / maxP) * 100}%"></i></div><span class="t">${hours(s)} h</span></div>`).join('')}` : ''}
  <h2>Claude</h2><ul><li>${(tokens / 1e6).toFixed(2)} M tokens · coste equivalente en la API $${cost.toFixed(2)}</li><li>${claudeTasks} tareas completadas por Claude Code</li></ul>
  ${unlocked.length ? `<h2>Logros del mes 🏅</h2><ul>${unlocked.map((a) => `<li>${esc((achMap[a.id] || {}).emoji || '🏅')} ${esc((achMap[a.id] || {}).name || a.id)}</li>`).join('')}</ul>` : ''}
  <footer>Generado por PM Pollito · Hecho con ❤️ por Juanzreyes</footer>
  </body></html>`;
}

module.exports = { build };

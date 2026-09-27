// Textos listos para copiar: daily (Slack/Teams) e informe semanal.
const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hours = (secs) => {
  const m = Math.round((secs || 0) / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
};
const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' M' : n >= 1e3 ? (n / 1e3).toFixed(1) + ' k' : String(n || 0));
const dayName = (d) => d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' });

/** Daily en formato para pegar en Slack / Teams. */
function daily(day, date = new Date(), commitsYesterday = [], extras = {}) {
  const s = day.standup || { yesterday: '', today: [], help: '' };
  const lines = [`*Daily · ${dayName(date)}*`, ''];
  lines.push('✅ *Ayer:*');
  const y = (s.yesterday || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (y.length) y.forEach((l) => lines.push(`• ${l.replace(/^[•\-✅⬜📦]\s*/u, '')}`));
  else if (commitsYesterday.length) commitsYesterday.forEach((c) => lines.push(`• [${c.repo}] ${c.subject}`));
  else lines.push('• —');
  lines.push('', '📋 *Hoy:*');
  if (s.today.length) s.today.forEach((t) => lines.push(`• ${t.done ? '~' + t.text + '~ ✔' : t.text}`));
  else lines.push('• —');
  if (extras.claudeToday && extras.claudeToday.length) {
    lines.push('', '🤖 *Con Claude hoy:*');
    extras.claudeToday.forEach((l) => lines.push(`• ${l}`));
  }
  lines.push('', `🚧 *Bloqueos / ayuda:* ${s.help || 'Ninguno'}`);
  return lines.join('\n');
}

/** Informe de los últimos 7 días. */
function weekly(data, extra = {}) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push({ date: d, k: key(d), v: data.days[key(d)] || {} });
  }
  let done = 0, total = 0, work = 0, dist = 0, pomos = 0, commits = 0, meetMins = 0, meetCount = 0;
  const doneList = [];
  const projects = {};
  const distApps = {};
  for (const { date, v } of days) {
    const t = (v.standup && v.standup.today) || [];
    total += t.length;
    for (const x of t) if (x.done) { done++; doneList.push(`${date.toLocaleDateString('es', { weekday: 'short' })}: ${x.text}`); }
    if (v.focus) {
      work += v.focus.work || 0;
      dist += v.focus.distraction || 0;
      for (const [a, s] of Object.entries(v.focus.apps || {})) distApps[a] = (distApps[a] || 0) + s;
    }
    pomos += v.pomodoros || 0;
    commits += v.commits || 0;
    for (const [p, s] of Object.entries(v.projects || {})) projects[p] = (projects[p] || 0) + s;
    for (const m of v.meetings || []) { meetCount++; meetMins += m.mins || 0; }
  }
  const from = days[0].date, to = days[6].date;
  const L = [];
  L.push(`# 📊 Informe semanal · ${from.toLocaleDateString('es', { day: 'numeric', month: 'short' })} – ${to.toLocaleDateString('es', { day: 'numeric', month: 'short' })}`);
  L.push('');
  L.push(`**Tareas:** ${done}/${total} completadas${total ? ` (${Math.round((done / total) * 100)}%)` : ''}`);
  L.push(`**Trabajo enfocado:** ${hours(work)} · **Distracciones:** ${hours(dist)}`);
  if (pomos) L.push(`**Pomodoros:** ${pomos} 🍅`);
  if (commits) L.push(`**Commits:** ${commits}`);
  if (meetCount) L.push(`**Reuniones:** ${meetCount} (${hours(meetMins * 60)})`);
  const top = Object.entries(projects).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (top.length) {
    L.push('', '## ⏱️ Tiempo por proyecto');
    top.forEach(([p, s]) => L.push(`- ${p}: ${hours(s)}`));
  }
  if (doneList.length) {
    L.push('', '## ✅ Logros');
    doneList.slice(0, 25).forEach((x) => L.push(`- ${x}`));
  }
  const pending = ((data.days[key(to)] || {}).standup || { today: [] }).today.filter((t) => !t.done);
  if (pending.length) {
    L.push('', '## 📌 Pendiente');
    pending.forEach((t) => L.push(`- ${t.text}`));
  }
  const topDist = Object.entries(distApps).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (topDist.length) L.push('', `🙈 Mayores distracciones: ${topDist.map(([a, s]) => `${a} (${hours(s)})`).join(', ')}`);
  if (extra.claude) {
    const c = extra.claude;
    L.push('', '## 🤖 Claude');
    if (c.local) L.push(`- ${c.local.week.messages} respuestas · ${fmtTok(c.local.week.input + c.local.week.output)} tokens esta semana`);
    for (const l of c.limits || []) L.push(`- ${l.label}: ${Math.round(l.utilization)}%`);
  }
  if (extra.goals && extra.goals.length) {
    L.push('', '## 🎯 Objetivos de la semana');
    extra.goals.forEach((g) => L.push(`- ${g.progress >= 100 ? '✅' : `${g.progress || 0}%`} ${g.text}`));
  }
  L.push('', `_Generado por ${extra.name || 'PM'} 🐣_`);
  return L.join('\n');
}

/** CSV de horas por proyecto (últimos N días), con ; y coma decimal para Excel en español. */
function timesheetCsv(data, daysBack = 30) {
  const rows = ['Fecha;Proyecto;Horas'];
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const v = data.days[key(d)];
    if (!v || !v.projects) continue;
    for (const [p, s] of Object.entries(v.projects).sort((a, b) => b[1] - a[1])) {
      if (s < 60) continue;
      rows.push(`${key(d)};"${p.replace(/"/g, '""')}";${(s / 3600).toFixed(2).replace('.', ',')}`);
    }
  }
  return '﻿' + rows.join('\r\n');
}

module.exports = { daily, weekly, timesheetCsv };

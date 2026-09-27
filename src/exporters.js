// Exportar: días a Markdown (Obsidian, Logseq, cualquier carpeta) y bloques de tiempo a .ics.
const fs = require('fs');
const path = require('path');

const pad = (n) => String(n).padStart(2, '0');
const hrs = (s) => { const m = Math.round((s || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };

/** Un día como nota de Markdown. journal: [{ project, count, items }] (lo pedido a Claude). */
function markdownDay(data, key, journal = [], diary = null) {
  const d = (data.days || {})[key] || {};
  const [y, m, dd] = key.split('-').map(Number);
  const date = new Date(y, m - 1, dd);
  const tasks = (d.standup && d.standup.today) || [];
  const L = [];
  L.push('---');
  L.push(`date: ${key}`);
  L.push('tags: [pm-pollito, daily]');
  L.push(`tasks_done: ${tasks.filter((t) => t.done).length}`);
  L.push(`tasks_total: ${tasks.length}`);
  if (d.focus) L.push(`focus_minutes: ${Math.round((d.focus.work || 0) / 60)}`);
  if (d.mood) L.push(`mood: ${d.mood}`);
  L.push('---');
  L.push('');
  L.push(`# ${date.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`);
  L.push('');
  if (d.standup && d.standup.yesterday) { L.push('## Ayer'); L.push(d.standup.yesterday.split('\n').map((l) => `- ${l.replace(/^[-•]\s*/, '')}`).join('\n')); L.push(''); }
  if (tasks.length) {
    L.push('## Tareas');
    for (const t of tasks) L.push(`- [${t.done ? 'x' : ' '}] ${t.text}${t.spent ? ` ⏱ ${hrs(t.spent)}` : ''}`);
    L.push('');
  }
  if (d.blocks && d.blocks.length) { L.push('## Bloques'); d.blocks.forEach((b) => L.push(`- ${b.start}–${b.end} ${b.title}`)); L.push(''); }
  if (d.notes) { L.push('## Notas'); L.push(d.notes); L.push(''); }
  if (journal.length) {
    L.push('## Con Claude');
    for (const p of journal) { L.push(`- **${p.project}** (${p.count} peticiones)`); p.items.forEach((i) => L.push(`  - ${i}`)); }
    L.push('');
  }
  const proj = Object.entries(d.projects || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (proj.length) { L.push('## Tiempo por proyecto'); proj.forEach(([p, s]) => L.push(`- ${p}: ${hrs(s)}`)); L.push(''); }
  const f = d.focus;
  if (f) { L.push(`**Foco:** ${hrs(f.work)} · **Distracciones:** ${hrs(f.distraction)}${d.pomodoros ? ` · 🍅 ${d.pomodoros}` : ''}${d.commits ? ` · 📦 ${d.commits} commits` : ''}`); L.push(''); }
  if (d.habits && data.habits) {
    const hb = data.habits.map((h) => `${h.emoji} ${h.name} ${(d.habits[h.id] || 0)}/${h.target}`).join(' · ');
    L.push(`**Hábitos:** ${hb}`); L.push('');
  }
  if (d.review && d.review.note) { L.push('## Cierre'); L.push(d.review.note); L.push(''); }
  if (diary) { L.push('## 📜 Diario del pollito'); L.push(`> ${diary.text.replace(/\n/g, '\n> ')}`); L.push(''); }
  return L.join('\n');
}

/** Escribe los últimos `days` días en <dir>/PM Pollito/AAAA-MM-DD.md. Devuelve cuántos. */
/**
 * @param {string} dir
 * @param {any} data
 * @param {number} [days]
 * @param {(key: string) => any[]} [journalFor]
 */
function exportMarkdown(dir, data, days = 30, journalFor = () => []) {
  const out = path.join(dir, 'PM Pollito');
  fs.mkdirSync(out, { recursive: true });
  const keys = Object.keys(data.days || {}).sort().slice(-days);
  let n = 0;
  for (const k of keys) {
    const d = data.days[k];
    if (!d || (!d.standup && !d.notes && !d.focus && !d.blocks)) continue;
    fs.writeFileSync(path.join(out, `${k}.md`), markdownDay(data, k, journalFor(k), (data.petDiary || {})[k]));
    n++;
  }
  return { dir: out, count: n };
}

// ---------- .ics ----------
const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
/** Bloques de un día como calendario .ics (horas locales). */
function icsBlocks(blocks, date = new Date()) {
  const now = new Date();
  const utc = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PM Pollito//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const b of blocks || []) {
    const [sh, sm] = b.start.split(':').map(Number);
    const [eh, em] = b.end.split(':').map(Number);
    const s = new Date(date); s.setHours(sh, sm, 0, 0);
    const e = new Date(date); e.setHours(eh, em, 0, 0);
    L.push('BEGIN:VEVENT', `UID:pm-${stamp(s)}-${Math.abs(hash(b.title))}@pm-pollito`, `DTSTAMP:${utc}`, `DTSTART:${stamp(s)}`, `DTEND:${stamp(e)}`,
      `SUMMARY:${icsEsc('🎯 ' + b.title)}`, 'DESCRIPTION:Bloque de foco planificado con PM Pollito', 'TRANSP:OPAQUE', 'CATEGORIES:Foco', 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}
function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

module.exports = { markdownDay, exportMarkdown, icsBlocks };

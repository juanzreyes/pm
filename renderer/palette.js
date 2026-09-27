// Paleta de comandos (Ctrl+Alt+Espacio): busca y ejecuta cualquier acción con el teclado.
const q = document.getElementById('q');
const list = document.getElementById('list');
let commands = [];
let results = [];
let sel = 0;
let lang = 'es';
let found = []; // resultados de la búsqueda global (tareas, notas, prompts, avisos…)
let searchSeq = 0;

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const L = (es, en) => (lang === 'en' ? en : es);

// Puntuación simple: todas las palabras deben aparecer; mejor si están al principio del nombre.
function score(cmd, query) {
  const hay = norm(cmd.label + ' ' + cmd.kw);
  const label = norm(cmd.label);
  let s = 0;
  for (const w of query.split(/\s+/).filter(Boolean)) {
    const i = hay.indexOf(w);
    if (i < 0) return -1;
    s += label.startsWith(w) ? 30 : label.includes(' ' + w) ? 20 : i < label.length ? 12 : 6;
  }
  return s;
}

function render() {
  const query = norm(q.value.trim());
  const raw = q.value.trim();
  results = query
    ? commands.map((c) => ({ c, s: score(c, query) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).map((x) => x.c)
    : commands.slice();
  // Búsqueda global: tus tareas, notas, prompts, objetivos, avisos y el diario de Claude.
  if (raw && found.length) {
    results = results.slice(0, 6);
    results.push({ id: '__sep', label: L('En tus datos', 'In your data') });
    results.push(...found.map((f) => ({ ...f, id: '__open' })));
  }
  // Acciones con texto libre: anotar o preguntarle al pollito.
  if (raw) {
    results.push({ id: '__capture', icon: '✍️', label: L(`Anotar: “${raw}”`, `Note down: “${raw}”`), hint: L('tarea o recordatorio', 'task or reminder') });
    results.push({ id: '__ask', icon: '💬', label: L(`Preguntar al pollito: “${raw}”`, `Ask the chick: “${raw}”`), hint: 'chat' });
  }
  sel = Math.min(sel, Math.max(0, results.length - 1));
  if (results[sel] && results[sel].id === '__sep') sel = Math.min(results.length - 1, sel + 1);
  list.innerHTML = results.length
    ? results.map((r, i) => r.id === '__sep' ? `<div class="sep">${esc(r.label)}</div>` : `<div class="it ${i === sel ? 'sel' : ''}" role="option" aria-selected="${i === sel}" data-i="${i}"><span class="e">${r.icon || '•'}</span><span class="l">${esc(r.label)}</span>${r.hint ? `<span class="h">${esc(r.hint)}</span>` : ''}</div>`).join('')
    : `<div class="empty">${L('Sin resultados', 'No results')}</div>`;
  const el = list.querySelector('.sel');
  if (el) el.scrollIntoView({ block: 'nearest' });
}

async function run(i) {
  const r = results[i];
  if (!r) return;
  const raw = q.value.trim();
  if (r.id === '__sep') return;
  if (r.id === '__open') {
    await pm.paletteRun(r.cmd, r.arg);
  } else if (r.id === '__capture') {
    const t = /^(recu[eé]rdame|av[ií]same|remind me|cada |todos los |todas las |every )/i.test(raw) ? raw : `tarea: ${raw}`;
    await pm.paletteText(t);
  } else if (r.id === '__ask') {
    await pm.paletteText(raw);
  } else {
    await pm.paletteRun(r.id, r.arg);
  }
  q.value = '';
}

let searchTimer = null;
q.addEventListener('input', () => {
  sel = 0;
  found = [];
  render();
  clearTimeout(searchTimer);
  const text = q.value.trim();
  if (text.length < 2) return;
  const seq = ++searchSeq;
  searchTimer = setTimeout(async () => {
    const r = await pm.paletteSearch(text);
    if (seq !== searchSeq) return; // llegó tarde: ya escribiste otra cosa
    found = r || [];
    render();
  }, 160);
});
// Salta los separadores con las flechas.
const step = (d) => { let i = sel + d; while (results[i] && results[i].id === '__sep') i += d; if (results[i]) sel = i; };
q.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { step(1); render(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { step(-1); render(); e.preventDefault(); }
  else if (e.key === 'Enter') { run(sel); e.preventDefault(); }
  else if (e.key === 'Escape') { q.value = ''; pm.paletteClose(); }
});
list.addEventListener('mousemove', (e) => {
  const it = e.target.closest('.it');
  if (it && Number(it.dataset.i) !== sel) { sel = Number(it.dataset.i); render(); }
});
list.addEventListener('click', (e) => {
  const it = e.target.closest('.it');
  if (it) run(Number(it.dataset.i));
});

pm.onPaletteOpen((cmds) => {
  commands = cmds || [];
  found = [];
  q.value = '';
  sel = 0;
  render();
  setTimeout(() => q.focus(), 20);
});
pm.onState((s) => {
  lang = s.lang || 'es';
  document.documentElement.classList.toggle('dark', !!s.dark);
});
pm.getState().then((s) => {
  lang = s.lang || 'es';
  document.documentElement.classList.toggle('dark', !!s.dark);
  if (lang === 'en') I18N.translateDom(document.body, 'en');
});
pm.paletteList().then((c) => { commands = c; render(); });
q.focus();

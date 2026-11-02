// Cómo se ven en el teléfono las "ventanas" de la PC:
//  · pet.html    → el escenario de arriba (el pollito, escalado para llenar su zona);
//  · panel.html  → la pantalla principal, debajo;
//  · settings, capture, palette, about, game → hojas a pantalla completa con botón de volver;
//  · widget, audio (ventanas invisibles o de escritorio) → no se cargan.
const ROLES = { pet: 'pet', panel: 'panel', widget: 'hidden', audio: 'hidden' };
const TITLES = { settings: 'Ajustes', capture: 'Anotar', palette: 'Comandos', about: 'Acerca de', game: 'Juegos' };
const views = new Map(); // id ventana → { win, role, el, frame }
const sheets = []; // pila de hojas abiertas
const lastPointer = { x: 0, y: 0 };
addEventListener('pointerdown', (e) => { lastPointer.x = e.clientX; lastPointer.y = e.clientY; }, { capture: true, passive: true });

const fileOf = (rel) => (/renderer\/([\w-]+)\.html/.exec(rel) || [])[1] || '';
function roleOf(rel) { return ROLES[fileOf(rel)] || 'sheet'; }

function slot(role) {
  if (role === 'pet') return document.getElementById('stage');
  if (role === 'panel') return document.getElementById('main');
  return document.getElementById('sheets');
}

function mount(win, rel) {
  unmount(win, true);
  const role = roleOf(rel);
  const name = fileOf(rel);
  if (role === 'hidden') { views.set(win.id, { win, role }); setTimeout(() => win.__ready(), 0); return; }
  const el = document.createElement('div');
  el.className = 'view view-' + role + ' view-' + name;
  const frame = document.createElement('iframe');
  frame.name = String(win.id);
  frame.title = TITLES[name] || name;
  frame.src = rel.startsWith('data:') ? rel : rel;
  frame.setAttribute('allow', 'clipboard-write; autoplay');
  if (role === 'sheet') {
    const bar = document.createElement('div');
    bar.className = 'sheet-bar';
    bar.innerHTML = `<button class="sheet-back" type="button" aria-label="Volver">‹</button><span class="sheet-title"></span>`;
    bar.querySelector('.sheet-title').textContent = TITLES[name] || '';
    bar.querySelector('.sheet-back').addEventListener('click', () => win.close());
    el.appendChild(bar);
    el.hidden = !win._visible;
  }
  el.appendChild(frame);
  slot(role).appendChild(el);
  views.set(win.id, { win, role, el, frame });
  if (role === 'pet') fitPet();
  if (role === 'sheet' && win._visible) openSheet(win.id);
}
function unmount(win, keep) {
  const v = views.get(win.id);
  if (!v) return;
  if (v.el) v.el.remove();
  const i = sheets.indexOf(win.id);
  if (i >= 0) sheets.splice(i, 1);
  if (!keep) views.delete(win.id);
  document.body.classList.toggle('has-sheet', sheets.length > 0);
}
function frameOf(win) { const v = views.get(win.id); return v && v.frame; }
function isDocked(win) { const v = views.get(win.id); return !!v && (v.role === 'pet' || v.role === 'panel'); }
function openSheet(id) {
  const i = sheets.indexOf(id);
  if (i >= 0) sheets.splice(i, 1);
  sheets.push(id);
  document.body.classList.add('has-sheet');
}
function show(win) {
  const v = views.get(win.id);
  if (!v || !v.el) return;
  if (v.role === 'sheet') { v.el.hidden = false; openSheet(win.id); }
}
function hide(win) {
  const v = views.get(win.id);
  if (!v || !v.el || v.role !== 'sheet') return;
  v.el.hidden = true;
  const i = sheets.indexOf(win.id);
  if (i >= 0) sheets.splice(i, 1);
  document.body.classList.toggle('has-sheet', sheets.length > 0);
}
function topWindow() {
  const id = sheets[sheets.length - 1];
  if (id) return views.get(id).win;
  for (const v of views.values()) if (v.role === 'panel') return v.win;
  return null;
}
/** Botón atrás de Android: cierra la hoja de arriba; si no hay, sale al escritorio. */
function back() {
  const id = sheets[sheets.length - 1];
  if (id) { views.get(id).win.close(); return true; }
  return false;
}

// El pollito vive en 240×300 (como su ventana de la PC): se escala para llenar el escenario.
function fitPet() {
  for (const v of views.values()) {
    if (v.role !== 'pet' || !v.frame) continue;
    const stage = document.getElementById('stage');
    const s = Math.min(stage.clientWidth / 240, stage.clientHeight / 300);
    v.frame.style.transform = `translate(-50%, 0) scale(${s})`;
  }
}
addEventListener('resize', fitPet);

// Diálogos (dialog.showMessageBox): una hoja chica con los botones de la PC.
function messageBox(o = {}) {
  return new Promise((res) => {
    const wrap = document.createElement('div');
    wrap.className = 'msgbox';
    const box = document.createElement('div');
    box.className = 'msgbox-card';
    const h = document.createElement('b');
    h.textContent = o.message || o.title || '';
    box.appendChild(h);
    if (o.detail) { const p = document.createElement('p'); p.textContent = o.detail; box.appendChild(p); }
    const row = document.createElement('div');
    row.className = 'msgbox-row';
    (o.buttons && o.buttons.length ? o.buttons : ['Aceptar']).forEach((label, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (i === (o.defaultId ?? 0)) b.className = 'primary';
      b.addEventListener('click', () => { wrap.remove(); res({ response: i, checkboxChecked: false }); });
      row.appendChild(b);
    });
    box.appendChild(row);
    wrap.appendChild(box);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) { wrap.remove(); res({ response: o.cancelId ?? 0, checkboxChecked: false }); } });
    document.body.appendChild(wrap);
  });
}

module.exports = { roleOf, mount, unmount, frameOf, isDocked, show, hide, topWindow, back, messageBox, lastPointer, fitPet, views };

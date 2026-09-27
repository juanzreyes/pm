// Perfiles (p. ej. Trabajo y Personal): cada uno con sus tareas, horarios, límites y ajustes,
// pero el MISMO pollito (se lleva su nivel, maíz, accesorios y colección al cambiar).
const fs = require('fs');
const path = require('path');

function create(dir) {
  const file = path.join(dir, 'profiles.json');
  const read = () => {
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && Array.isArray(j.list) && j.list.length) return j; } catch { /* primera vez */ }
    return { active: 'default', list: [{ id: 'default', name: 'Trabajo', emoji: '💼' }] };
  };
  const write = (j) => fs.writeFileSync(file, JSON.stringify(j, null, 2));
  const fileFor = (id) => (id === 'default' ? 'pm-data.json' : `pm-data-${id}.json`);

  function list() { return read(); }
  function active() {
    const j = read();
    return j.list.find((p) => p.id === j.active) || j.list[0];
  }
  /** Crea un perfil nuevo copiando los ajustes y el pollito del actual. */
  function add(name, emoji, current) {
    const j = read();
    const id = Date.now().toString(36);
    name = String(name || '').trim().slice(0, 24) || 'Perfil';
    j.list.push({ id, name, emoji: String(emoji || '🗂️').slice(0, 4) });
    write(j);
    const settings = { ...current.settings };
    delete settings.mcpToken; // cada perfil, su propia clave
    fs.writeFileSync(path.join(dir, fileFor(id)), JSON.stringify({ pet: current.pet, settings, life: { running: false, lastQuitHow: 'update' } }));
    return id;
  }
  /** Deja listo el cambio: lleva el pollito al perfil destino. Hay que reiniciar después. */
  function switchTo(id, currentPet) {
    const j = read();
    if (!j.list.some((p) => p.id === id)) throw new Error('Ese perfil no existe.');
    const f = path.join(dir, fileFor(id));
    let target = {};
    try { target = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* nuevo */ }
    target.pet = currentPet;
    target.life = { ...(target.life || {}), running: false, lastQuitHow: 'update', lastQuitAt: Date.now() };
    fs.writeFileSync(f, JSON.stringify(target));
    j.active = id;
    write(j);
  }
  function remove(id) {
    const j = read();
    if (id === 'default' || id === j.active) throw new Error('No puedo borrar el perfil principal ni el que estás usando.');
    j.list = j.list.filter((p) => p.id !== id);
    write(j);
    const f = path.join(dir, fileFor(id));
    if (fs.existsSync(f)) fs.renameSync(f, f.replace(/\.json$/, `.borrado-${Date.now()}.json`)); // por si acaso
  }
  return { list, active, add, switchTo, remove, fileFor };
}

module.exports = { create };

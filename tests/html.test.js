// Las pantallas no pueden repetir ids: el código de una sección acabaría pintando en otra
// (pasó en 2.0 con "projects": la lista de proyectos se borraba sola).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('ningún HTML de la app repite un id', () => {
  const dir = path.join(__dirname, '..', 'renderer');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html'))) {
    const ids = [...fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(dup, [], `${f} repite: ${dup.join(', ')}`);
  }
});

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createScanner } = require('../src/claudescan');
const git = require('../src/git');

const NOW = Date.parse('2026-10-08T15:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const asst = (id, msAgo, out = 10) => JSON.stringify({ type: 'assistant', requestId: 'r' + id, timestamp: iso(msAgo), cwd: 'C:\\Desarrollo\\kim', message: { id: 'm' + id, model: 'claude-opus-5-5', usage: { input_tokens: 100, output_tokens: out } } });
const user = (id, msAgo, text) => JSON.stringify({ type: 'user', uuid: 'u' + id, timestamp: iso(msAgo), cwd: 'C:\\Desarrollo\\kim', message: { role: 'user', content: text } });

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-scan-'));
  const root = path.join(dir, 'projects');
  fs.mkdirSync(path.join(root, 'kim'), { recursive: true });
  return { dir, root, file: path.join(root, 'kim', 's1.jsonl'), cacheFile: path.join(dir, 'cache.json') };
}

test('el lector solo lee lo nuevo y espera a que la última línea esté completa', () => {
  const { root, file, cacheFile } = setup();
  fs.writeFileSync(file, asst(1, 3600e3) + '\n' + user(1, 3500e3, 'arregla el minimapa del juego') + '\n');
  const sc = createScanner({ root, cacheFile, now: () => NOW });
  assert.strictEqual(sc.stats().today.output, 10);
  const leidos = sc.info().bytesRead;

  // Una línea a medio escribir no cuenta ni se pierde.
  const otra = asst(2, 60e3, 5);
  fs.appendFileSync(file, otra.slice(0, 40));
  sc.update(0);
  assert.strictEqual(sc.stats().today.output, 10);
  fs.appendFileSync(file, otra.slice(40) + '\n');
  sc.update(0);
  assert.strictEqual(sc.stats().today.output, 15);
  // No se volvió a leer lo de antes.
  assert.ok(sc.info().bytesRead - leidos <= otra.length + 1 + 40, 'releyó el archivo entero');

  const p = sc.prompts(NOW - 864e5, NOW + 1);
  assert.deepStrictEqual(Object.values(p).flat().map((x) => x.text), ['arregla el minimapa del juego']);
});

test('al reiniciar usa la caché y no relee nada; si el archivo se reescribe, empieza de cero', () => {
  const { root, file, cacheFile } = setup();
  fs.writeFileSync(file, asst(1, 3600e3) + '\n' + asst(2, 1800e3) + '\n');
  createScanner({ root, cacheFile, now: () => NOW }).update(0);
  assert.ok(fs.existsSync(cacheFile));

  const sc = createScanner({ root, cacheFile, now: () => NOW });
  assert.strictEqual(sc.stats().today.output, 20);
  assert.strictEqual(sc.info().bytesRead, 0);

  fs.writeFileSync(file, asst(9, 60e3, 3) + '\n'); // más corto que antes: se reescribió
  sc.update(0);
  assert.strictEqual(sc.stats().today.output, 3);
});

test('un archivo que no termina en salto de línea se lee igual; lo viejo se descarta', () => {
  const { root, file, cacheFile } = setup();
  fs.writeFileSync(file, asst(1, 40 * 864e5) + '\n' + asst(2, 60e3, 7));
  const sc = createScanner({ root, cacheFile, now: () => NOW });
  const s = sc.stats();
  assert.strictEqual(s.today.output, 7);
  assert.strictEqual(sc.prompts(0, NOW + 1) && Object.keys(sc.prompts(0, NOW + 1)).length, 0);
});

test('git: actividad y último commit salen de los reflogs sin abrir git', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ref-'));
  assert.strictEqual(git.refActivity(dir), Infinity); // no es repo: hay que preguntarle a git
  assert.strictEqual(git.lastHeadMove(dir), null);

  fs.mkdirSync(path.join(dir, '.git', 'logs', 'refs', 'heads'), { recursive: true });
  const t = 1791460800; // segundos
  fs.writeFileSync(path.join(dir, '.git', 'logs', 'HEAD'),
    `0000 1111 Ana <a@x> ${t - 100} -0600\tcommit (initial): uno\n1111 2222 Ana <a@x> ${t} -0600\tcommit: dos\n`);
  fs.writeFileSync(path.join(dir, '.git', 'logs', 'refs', 'heads', 'main'), 'x\n');
  const old = new Date(Date.now() - 10 * 864e5);
  fs.utimesSync(path.join(dir, '.git', 'logs', 'HEAD'), old, old);
  assert.strictEqual(git.lastHeadMove(dir), t * 1000);
  assert.ok(Math.abs(git.refActivity(dir) - Date.now()) < 60e3, 'la rama movida hace nada cuenta como actividad');
});

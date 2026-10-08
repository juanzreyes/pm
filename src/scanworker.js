// Hilo aparte que lee el historial de Claude Code (src/claudescan.js): así la app y el pollito
// nunca se congelan aunque haya cientos de MB que revisar.
const { parentPort, workerData } = require('worker_threads');
const { createScanner } = require('./claudescan');

const scanner = createScanner(workerData || {});
parentPort.on('message', ({ id, op, args }) => {
  try {
    const result = op === 'stats' ? scanner.stats() : op === 'prompts' ? scanner.prompts(args[0], args[1]) : op === 'info' ? scanner.info() : null;
    parentPort.postMessage({ id, result });
  } catch (e) {
    parentPort.postMessage({ id, error: e && e.message ? e.message : String(e) });
  }
});

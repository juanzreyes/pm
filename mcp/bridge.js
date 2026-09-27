// Puente MCP por stdio → HTTP local del pollito (para Claude Desktop y otros clientes solo-stdio).
// Lee mensajes JSON-RPC (uno por línea) y los reenvía a http://127.0.0.1:47823/mcp.
// Se ejecuta con el propio ejecutable de PM en modo Node (ELECTRON_RUN_AS_NODE=1).
const http = require('http');
const readline = require('readline');

const TOKEN = process.env.PM_MCP_TOKEN || '';
const PORT = Number(process.env.PM_PORT || 47823);

function post(line) {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/mcp', method: 'POST', timeout: 20000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-PM': '1', Authorization: `Bearer ${TOKEN}`, 'Content-Length': Buffer.byteLength(line) },
    }, (res) => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.write(line);
    req.end();
  });
}

const rl = readline.createInterface({ input: process.stdin });
const pending = new Set();
rl.on('line', (line) => {
  const job = handleLine(line).finally(() => pending.delete(job));
  pending.add(job);
});
async function handleLine(line) {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const r = await post(line);
  if (msg.id === undefined || msg.id === null) return; // notificación: sin respuesta
  if (r.status === 200 && r.body) { process.stdout.write(r.body.trim() + '\n'); return; }
  const error = r.status === 0
    ? { code: -32000, message: 'PM Pollito no está abierto. Ábrelo y vuelve a intentarlo.' }
    : { code: -32001, message: `PM Pollito respondió ${r.status}` };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error }) + '\n');
}
// Al cerrarse la entrada, termina cuando se hayan respondido las peticiones en curso.
rl.on('close', async () => { await Promise.allSettled([...pending]); process.exit(0); });

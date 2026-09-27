// Línea de comandos del pollito:  pm status · pm tasks · pm add "revisar PR" · pm done 2 · pm focus 50 …
// Habla con PM Pollito por su servidor local (127.0.0.1). Se ejecuta con el propio ejecutable de PM
// en modo Node (ELECTRON_RUN_AS_NODE=1), así que no hace falta instalar Node.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 47823;
const HELP = `🐣 PM Pollito desde la terminal

  pm status              cómo vas: límites de Claude, tareas, pomodoro
  pm tasks               tus tareas de hoy
  pm add <texto>         añadir tarea
  pm done <n|texto>      marcar tarea como hecha
  pm remind <texto>      recordatorio ("en 20 min revisar el deploy")
  pm note <texto>        añadir a las notas de hoy
  pm queue <texto>       a la cola para Claude
  pm focus [minutos]     modo foco (50 min por defecto)
  pm pomo                empezar / parar pomodoro
  pm week                informe de la semana
  pm open                abrir el panel
`;

// La clave del MCP está en los datos de PM (solo accesibles para tu usuario de Windows).
function token() {
  const dir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'pm-pollito');
  let file = 'pm-data.json';
  try {
    const p = JSON.parse(fs.readFileSync(path.join(dir, 'profiles.json'), 'utf8'));
    if (p.active && p.active !== 'default') file = `pm-data-${p.active}.json`;
  } catch { /* perfil principal */ }
  try { return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).settings.mcpToken || ''; } catch { return ''; }
}

function request(p, body, auth) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : '';
    const headers = { 'X-PM': '1', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
    if (auth) headers.Authorization = `Bearer ${auth}`;
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: body ? 'POST' : 'GET', timeout: 8000, headers }, (res) => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', () => resolve({ status: 0 }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0 }); });
    if (data) req.write(data);
    req.end();
  });
}

async function tool(name, args = {}) {
  const tk = token();
  if (!tk) { console.log('⚠️  Abre PM Pollito una vez (crea la clave local) y vuelve a intentarlo.'); process.exit(1); }
  const r = await request('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, tk);
  if (r.status === 0) { console.log('😴 PM Pollito no está abierto.'); process.exit(1); }
  if (r.status !== 200) { console.log(`😿 PM respondió ${r.status}`); process.exit(1); }
  const j = JSON.parse(r.body);
  const text = j.result && j.result.content && j.result.content[0] ? j.result.content[0].text : JSON.stringify(j.error || j);
  if (j.result && j.result.isError) { console.log('😿 ' + text); process.exit(1); }
  return text;
}

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = rest.join(' ').trim();
  switch ((cmd || '').toLowerCase()) {
    case 'status': case 's': {
      const s = JSON.parse(await tool('pm_status'));
      const c = s.claude || {};
      const L = [];
      if (c.session) L.push(`🐣 Sesión ${c.session.percent}%${c.weekly ? ` · semanal ${c.weekly.percent}%` : ''}`);
      if (c.forecast && c.forecast.willHitLimit) L.push(`🔮 A este ritmo llegas al 100% a las ${new Date(c.forecast.eta).toLocaleTimeString()}`);
      if (c.budget && c.budget.budget) L.push(`💰 $${c.budget.spent.toFixed(2)} de $${c.budget.budget} esta semana`);
      L.push(`✅ ${s.tasks.done}/${s.tasks.total} tareas${s.tasks.pending.length ? ` · siguiente: ${s.tasks.pending[0]}` : ''}`);
      if (s.pomodoro) L.push(`🍅 Pomodoro en curso (${s.pomodoro.phase})`);
      if (s.focusMode) L.push('🎯 Modo foco activo');
      if (s.nextMeeting) L.push(`📅 ${s.nextMeeting.title} a las ${new Date(s.nextMeeting.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
      console.log(L.join('\n'));
      break;
    }
    case 'tasks': case 't': case 'ls': {
      const list = JSON.parse(await tool('pm_list_tasks'));
      if (!list.length) console.log('📭 Aún no hay tareas hoy. Añade una: pm add "…"');
      for (const t of list) console.log(`${String(t.index).padStart(2)}. ${t.done ? '✅' : '⬜'} ${t.text}${t.postponedDays >= 2 ? `  🔥${t.postponedDays}d` : ''}`);
      break;
    }
    case 'add': case 'a': if (!arg) return console.log('Uso: pm add <texto>'); console.log('📌 ' + await tool('pm_add_task', { text: arg })); break;
    case 'done': case 'd': {
      if (!arg) return console.log('Uso: pm done <número o texto>');
      console.log('✅ ' + await tool('pm_complete_task', /^\d+$/.test(arg) ? { index: Number(arg) } : { text: arg }));
      break;
    }
    case 'remind': case 'r': console.log(await tool('pm_add_reminder', { text: arg })); break;
    case 'note': case 'n': console.log('🗒️ ' + await tool('pm_add_note', { text: arg })); break;
    case 'queue': case 'q': console.log('🤖 ' + await tool('pm_queue_add', { text: arg })); break;
    case 'focus': case 'f': console.log('🎯 ' + await tool('pm_start_focus', { minutes: Number(arg) || 50 })); break;
    case 'week': case 'w': console.log(await tool('pm_weekly_report')); break;
    case 'pomo': case 'p': case 'open': case 'o': {
      const r = await request('/command', { cmd: cmd.startsWith('p') ? 'pomo.toggle' : 'panel.chat' });
      console.log(r.status === 0 ? '😴 PM Pollito no está abierto.' : r.status === 200 ? '👍' : '😿 No se pudo.');
      break;
    }
    default: console.log(HELP);
  }
})();

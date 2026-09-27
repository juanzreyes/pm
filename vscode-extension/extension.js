// Extensión de VS Code para PM Pollito: muestra el estado del pollito en la barra de estado
// y permite lanzar acciones. Habla solo con la app en tu PC (127.0.0.1), nunca con internet.
const vscode = require('vscode');
const http = require('http');

let item;
let timer;
let last = null;

function port() {
  return vscode.workspace.getConfiguration('pmPollito').get('port', 47823);
}

function request(method, path, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      { host: '127.0.0.1', port: port(), path, method, timeout: 2500, headers: { 'X-PM': '1', 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } },
      (res) => {
        let out = '';
        res.on('data', (c) => (out += c));
        res.on('end', () => { try { resolve(JSON.parse(out)); } catch { resolve(null); } });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    if (data) req.write(data);
    req.end();
  });
}

const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const hm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function render() {
  const s = last;
  if (!s) {
    item.text = '🐣 PM apagado';
    item.tooltip = 'PM Pollito no está abierto. Ábrelo para ver tu consumo de Claude y tus tareas.';
    item.backgroundColor = undefined;
    return;
  }
  const parts = [];
  const face = s.mood === 'angry' ? '😤' : s.mood === 'sick' ? '🤒' : s.meeting ? '🎧' : '🐣';
  if (s.session) parts.push(`${face} ${s.session.pct}%`);
  else parts.push(face);
  if (s.pomo && s.pomo.endsAt) parts.push(`${s.pomo.phase === 'focus' ? '🍅' : '☕'} ${clock(s.pomo.endsAt - Date.now())}`);
  if (s.runningTask) parts.push(`⏱ ${clock(s.runningTask.spent * 1000 + (Date.now() - s.runningTask.since))}`);
  if (vscode.workspace.getConfiguration('pmPollito').get('showTasks', true) && s.tasks.total) parts.push(`✅ ${s.tasks.done}/${s.tasks.total}`);
  if (s.unread) parts.push(`🔔 ${s.unread}`);
  item.text = parts.join('  ');

  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`**${s.name}** · tu pollito PM\n\n`);
  if (s.session) md.appendMarkdown(`- Sesión de Claude: **${s.session.pct}%** · reinicio ${hm(s.session.resetsAt)}\n`);
  if (s.weekly) md.appendMarkdown(`- Semanal: **${s.weekly.pct}%**\n`);
  if (s.forecast) md.appendMarkdown(`- 🔮 Ritmo +${s.forecast.rate.toFixed(1)}%/h${s.forecast.willHit ? ` · llegarás al 100% a las **${hm(s.forecast.eta)}**` : ' · no llegarás al límite'}\n`);
  if (s.costToday) md.appendMarkdown(`- 💵 Coste equivalente hoy: $${s.costToday.toFixed(2)}\n`);
  if (s.runningTask) md.appendMarkdown(`- ⏱ En curso: ${s.runningTask.text}\n`);
  if (s.meeting) md.appendMarkdown(`- 🎧 En reunión${s.meeting.title ? `: ${s.meeting.title}` : ''}\n`);
  md.appendMarkdown('\n_Clic para ver acciones_');
  item.tooltip = md;
  const pct = s.session ? s.session.pct : 0;
  item.backgroundColor = pct >= 90 ? new vscode.ThemeColor('statusBarItem.errorBackground') : pct >= 75 ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
}

async function refresh() {
  last = await request('GET', '/status');
  render();
}

async function command(cmd) {
  const r = await request('POST', '/command', { cmd });
  if (!r) vscode.window.showWarningMessage('PM Pollito no está abierto.');
  setTimeout(refresh, 400);
}

async function capture() {
  const text = await vscode.window.showInputBox({
    title: '🐣 Anotar en PM Pollito',
    prompt: 'Una tarea, o un recordatorio con hora: “recuérdame a las 3 revisar el PR”',
    ignoreFocusOut: false,
  });
  if (!text) return;
  const r = await request('POST', '/capture', { text });
  if (r && r.ok) vscode.window.setStatusBarMessage('🐣 ¡Anotado!', 2500);
  else vscode.window.showWarningMessage('PM Pollito no está abierto.');
  setTimeout(refresh, 400);
}

async function menu() {
  const s = last;
  const items = [
    { label: '✍️ Anotar tarea o recordatorio', run: capture },
    s && s.pomo ? { label: '⏹️ Detener pomodoro', run: () => command('pomo.stop') } : { label: '🍅 Empezar pomodoro (25 min)', run: () => command('pomo.start') },
    { label: '📊 Ver consumo de Claude', run: () => command('panel.usage') },
    { label: '📋 Ver mis tareas del día', run: () => command('panel.day') },
    { label: '🔔 Centro de avisos', run: () => command('inbox') },
    { label: '🔍 Paleta de comandos de PM', run: () => command('palette') },
    s && s.muted ? { label: '🔔 Quitar silencio', run: () => command('unmute') } : { label: '🔕 Silenciar 1 hora', run: () => command('mute') },
    { label: '🌽 Dar de comer al pollito', run: () => command('feed') },
  ];
  const pick = await vscode.window.showQuickPick(items, { title: `🐣 ${s ? s.name : 'PM Pollito'}`, placeHolder: s ? '¿Qué hacemos?' : 'PM Pollito no está abierto' });
  if (pick) pick.run();
}

function activate(context) {
  item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
  item.command = 'pmPollito.menu';
  item.show();
  context.subscriptions.push(
    item,
    vscode.commands.registerCommand('pmPollito.menu', menu),
    vscode.commands.registerCommand('pmPollito.capture', capture),
    vscode.commands.registerCommand('pmPollito.pomodoro', () => command(last && last.pomo ? 'pomo.stop' : 'pomo.start')),
    vscode.commands.registerCommand('pmPollito.usage', () => command('panel.usage')),
  );
  refresh();
  // Estado cada 10 s; el reloj del pomodoro/cronómetro se repinta cada segundo.
  timer = setInterval(refresh, 10000);
  const tick = setInterval(() => { if (last && (last.pomo || last.runningTask)) render(); }, 1000);
  context.subscriptions.push({ dispose: () => { clearInterval(timer); clearInterval(tick); } });
}

function deactivate() {}

module.exports = { activate, deactivate };

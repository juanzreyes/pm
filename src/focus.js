// Vigila (solo en tu PC) qué ventana tienes delante, si estás inactivo y si estás
// en una llamada/reunión, para que el pollito sepa si trabajas o pierdes el tiempo.
// Nada de esto sale de tu equipo.
const { spawn } = require('child_process');

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class PmWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [StructLayout(LayoutKind.Sequential)] public struct LII { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LII l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  // ¿La ventana activa ocupa todo el monitor? (presentación, vídeo o juego a pantalla completa)
  public static bool IsFullscreen(IntPtr h) {
    if (h == IntPtr.Zero) return false;
    var cls = new StringBuilder(256); GetClassName(h, cls, 256);
    var c = cls.ToString();
    if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd") return false; // escritorio / barra de tareas
    RECT r; if (!GetWindowRect(h, out r)) return false;
    var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return false;
    return r.L <= mi.rcMonitor.L && r.T <= mi.rcMonitor.T && r.R >= mi.rcMonitor.R && r.B >= mi.rcMonitor.B;
  }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  // Títulos de las ventanas visibles de Teams (para saber si hay una reunión abierta).
  public static string TeamsTitles() {
    var ids = new System.Collections.Generic.List<uint>();
    foreach (var name in new[] { "ms-teams", "Teams", "msteams" })
      foreach (var p in System.Diagnostics.Process.GetProcessesByName(name)) ids.Add((uint)p.Id);
    if (ids.Count == 0) return "";
    var sb = new StringBuilder();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (ids.Contains(pid)) {
        var t = new StringBuilder(512); GetWindowText(h, t, 512);
        if (t.Length > 0) sb.Append(t.ToString()).Append("\u001f");
      }
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
}
"@
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$micBases = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone\NonPackaged'
)
while ($true) {
  $h = [PmWin]::GetForegroundWindow()
  $sb = New-Object Text.StringBuilder 512
  [void][PmWin]::GetWindowText($h, $sb, 512)
  $procId = [uint32]0
  [void][PmWin]::GetWindowThreadProcessId($h, [ref]$procId)
  $pn = ''
  try { $pn = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}
  $l = New-Object PmWin+LII
  $l.cbSize = 8
  [void][PmWin]::GetLastInputInfo([ref]$l)
  $now = [int64][Environment]::TickCount
  if ($now -lt 0) { $now += 4294967296 }
  $idle = $now - $l.dwTime
  if ($idle -lt 0) { $idle += 4294967296 }
  # Apps usando el micrófono AHORA (Teams, Meet, Zoom…). Solo lee el registro de privacidad de Windows.
  $mic = @()
  foreach ($base in $micBases) {
    Get-ChildItem $base -ErrorAction SilentlyContinue | ForEach-Object {
      $pr = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
      if ($pr.LastUsedTimeStart -and $pr.LastUsedTimeStop -eq 0) { $mic += $_.PSChildName }
    }
  }
  $tt = ''
  try { $tt = [PmWin]::TeamsTitles() } catch {}
  $fs = $false
  try { $fs = [PmWin]::IsFullscreen($h) } catch {}
  [Console]::Out.WriteLine((@{ t = $sb.ToString(); p = $pn; i = [int]($idle / 1000); m = ($mic -join '|'); tt = $tt; f = $fs } | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Seconds 5
}
`;

// [etiqueta, expresión] — se busca en "proceso título" en minúsculas.
const DISTRACTIONS = [
  ['YouTube', /youtube/],
  ['Netflix', /netflix/],
  ['Twitch', /twitch/],
  ['TikTok', /tiktok/],
  ['Instagram', /instagram/],
  ['Facebook', /facebook/],
  ['X / Twitter', /twitter|\bx\.com|\/ x\b| on x\b/],
  ['Reddit', /reddit/],
  ['Prime Video', /prime video/],
  ['Disney+', /disney\+/],
  ['HBO Max', /\bhbo\b|max\.com/],
  ['Crunchyroll', /crunchyroll/],
  ['9GAG', /9gag/],
  ['Juegos', /steam|epicgameslauncher|riotclient|leagueclient|valorant|minecraft|roblox|fortnite/],
];

const WORK = [
  /\bcode\b|vscode|cursor|devenv|idea64|pycharm|webstorm|rider|android studio|sublime|notepad\+\+|vim|zed/,
  /windowsterminal|powershell|cmd\b|wt\b|git|postman|insomnia|docker|dbeaver|datagrip|ssms|pgadmin/,
  /claude|github|gitlab|bitbucket|stack ?overflow|localhost|127\.0\.0\.1|vercel|netlify|aws|azure|jira|linear|trello|asana|clickup|notion|confluence|figma/,
  /excel|winword|word|powerpnt|powerpoint|outlook|olk|teams|slack|zoom|meet\.google|docs\.google|sheets|onenote/,
  /chatgpt|developer\.mozilla|mdn|npmjs|pypi|docs\./,
];

const NEUTRAL_PROCS = /^(electron|explorer|lockapp|searchhost|shellexperiencehost|startmenuexperiencehost|applicationframehost)$/;

/** Clasifica una muestra: { cat: 'work'|'distraction'|'neutral'|'idle', label } */
function classify(sample, idleLimit = 120) {
  if (sample.i >= idleLimit && !sample.m) return { cat: 'idle', label: 'Inactivo' };
  const proc = (sample.p || '').toLowerCase();
  const hay = `${proc} ${(sample.t || '').toLowerCase()}`;
  for (const [label, re] of DISTRACTIONS) if (re.test(hay)) return { cat: 'distraction', label };
  if (NEUTRAL_PROCS.test(proc)) return { cat: 'neutral', label: 'Escritorio' };
  if (WORK.some((re) => re.test(hay))) return { cat: 'work', label: proc || 'trabajo' };
  return { cat: 'neutral', label: proc || 'otro' };
}

const TEAMS_SECTIONS = /^(chat|actividad|activity|equipos|teams|calendario|calendar|llamadas|calls|archivos|files|aplicaciones|apps|onedrive|comunidades|communities|microsoft teams|notificaciones|notifications)\b/i;

/**
 * ¿Estás en una reunión/llamada ahora? Devuelve { app, title, mic } o null.
 * Señales: alguna app usando el micrófono, o una ventana de reunión de Teams.
 */
function meetingFrom(sample) {
  const mic = String(sample.m || '').split('|').filter(Boolean);
  const titles = String(sample.tt || '').split('\u001f').map((t) => t.trim()).filter(Boolean);
  const meetingWin = titles.find((t) => /reuni[oó]n|meeting|llamada|\bcall\b|en curso|compartiendo|sharing/i.test(t) && !TEAMS_SECTIONS.test(t));
  const micApp = mic.find((k) => !/pm-pollito|electron/i.test(k));
  if (!micApp && !meetingWin) return null;
  let app = 'llamada';
  const k = (micApp || '').toLowerCase();
  if (meetingWin || /teams/.test(k)) app = 'Teams';
  else if (/zoom/.test(k)) app = 'Zoom';
  else if (/chrome|msedge|firefox|opera|brave/.test(k)) app = 'navegador (Meet/Zoom web)';
  else if (/discord/.test(k)) app = 'Discord';
  else if (/whatsapp/.test(k)) app = 'WhatsApp';
  else if (/slack/.test(k)) app = 'Slack';
  return { app, title: meetingWin ? meetingWin.replace(/\s*\|\s*Microsoft Teams.*$/i, '') : '', mic: !!micApp };
}

/** Arranca el vigilante. Llama a onSample({t, p, i, m, tt}) cada ~5 s. Devuelve una función para pararlo. */
function start(onSample) {
  let child = null;
  let stopped = false;
  let buf = '';

  const run = () => {
    if (stopped || process.platform !== 'win32') return;
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('{')) continue;
        try { onSample(JSON.parse(line)); } catch { /* línea rara */ }
      }
    });
    child.on('exit', () => {
      child = null;
      if (!stopped) setTimeout(run, 15000); // si muere, vuelve a arrancar
    });
  };
  run();

  return () => {
    stopped = true;
    if (child) child.kill();
  };
}

/**
 * ¿Estás presentando o a pantalla completa? Devuelve un motivo o null.
 * (Para que el pollito se esconda y no salga en tu presentación.)
 */
function presentingFrom(sample) {
  const titles = String(sample.tt || '').split('\u001f');
  if (titles.some((t) => /compartiendo|sharing|presentando|presenting|barra de control de uso compartido|sharing control bar/i.test(t))) {
    return 'Compartiendo pantalla en Teams';
  }
  const p = String(sample.p || '').toLowerCase();
  if (sample.f && !/^(electron|explorer|pm pollito)$/.test(p)) {
    if (p === 'powerpnt') return 'Presentación de PowerPoint';
    return 'Pantalla completa';
  }
  return null;
}

module.exports = { start, classify, meetingFrom, presentingFrom };

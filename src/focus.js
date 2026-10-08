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
  // Canción de Spotify (su ventana se titula "Artista - Canción" mientras suena; "Spotify…" en pausa).
  public static string SpotifyTitle() {
    foreach (var p in System.Diagnostics.Process.GetProcessesByName("Spotify")) {
      var t = p.MainWindowTitle;
      if (!string.IsNullOrEmpty(t) && t.Contains(" - ") && !t.StartsWith("Spotify")) return t;
    }
    return "";
  }
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  // Ventana activa donde el pollito puede sentarse: "L,T,R,B,Z" (Z=1 si está maximizada) o "".
  // Solo ventanas normales con barra de título (ni escritorio, ni barra de tareas, ni minimizadas).
  public static string PerchRect(IntPtr h) {
    if (h == IntPtr.Zero || IsIconic(h)) return "";
    var cls = new StringBuilder(256); GetClassName(h, cls, 256);
    var c = cls.ToString();
    if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd" || c == "Windows.UI.Core.CoreWindow") return "";
    const int WS_CAPTION = 0x00C00000;
    if ((GetWindowLong(h, -16) & WS_CAPTION) != WS_CAPTION) return "";
    RECT r; if (!GetWindowRect(h, out r)) return "";
    if (r.R - r.L < 200 || r.B - r.T < 120) return "";
    return r.L + "," + r.T + "," + r.R + "," + r.B + "," + (IsZoomed(h) ? "1" : "0");
  }
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  // ¿La ventana activa está en pantalla completa de verdad? (presentación, vídeo o juego)
  // Devuelve el rectángulo del monitor "L,T,R,B" o "" si no.
  // Una ventana MAXIMIZADA no cuenta (en un 2º monitor sin barra de tareas, o con la barra
  // oculta, también cubre todo el monitor), ni una con barra de título.
  public static string FullscreenMonitor(IntPtr h) {
    if (h == IntPtr.Zero) return "";
    var cls = new StringBuilder(256); GetClassName(h, cls, 256);
    var c = cls.ToString();
    if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return ""; // escritorio / barras de tareas
    if (IsZoomed(h)) return "";
    const int WS_CAPTION = 0x00C00000;
    if ((GetWindowLong(h, -16) & WS_CAPTION) == WS_CAPTION) return "";
    RECT r; if (!GetWindowRect(h, out r)) return "";
    var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return "";
    var m = mi.rcMonitor;
    if (r.L <= m.L && r.T <= m.T && r.R >= m.R && r.B >= m.B) return m.L + "," + m.T + "," + m.R + "," + m.B;
    return "";
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
# Coordenadas en píxeles reales (Electron las pasa a su escala con screenToDip*).
try { [void][PmWin]::SetProcessDPIAware() } catch {}
# Controles multimedia de Windows: qué suena en cualquier app (Spotify, navegador, Apple Music…).
$media = $null
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*' })[0]
  function Await($op, [Type]$t) { $task = $asTaskGeneric.MakeGenericMethod($t).Invoke($null, @($op)); [void]$task.Wait(2000); $task.Result }
  [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $media = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
} catch { $media = $null }
function NowPlaying() {
  if (-not $media) { return @('', '') }
  foreach ($s in $media.GetSessions()) {
    $pi = $s.GetPlaybackInfo()
    if ([string]$pi.PlaybackStatus -ne 'Playing' -or [string]$pi.PlaybackType -eq 'Video') { continue }
    $pr = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $t = if ($pr.Artist) { $pr.Artist + ' - ' + $pr.Title } else { [string]$pr.Title }
    return @($t, [string]$s.SourceAppUserModelId)
  }
  return @('', '')
}
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
  $fs = ''
  try { $fs = [PmWin]::FullscreenMonitor($h) } catch {}
  $wr = ''
  try { $wr = [PmWin]::PerchRect($h) } catch {}
  $mu = ''; $ms = ''
  try { $np = NowPlaying; $mu = $np[0]; $ms = $np[1] } catch {}
  if (-not $mu) { try { $mu = [PmWin]::SpotifyTitle(); if ($mu) { $ms = 'Spotify' } } catch {} }
  [Console]::Out.WriteLine((@{ t = $sb.ToString(); p = $pn; i = [int]($idle / 1000); m = ($mic -join '|'); tt = $tt; f = $fs; wr = $wr; mu = $mu; ms = $ms } | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Seconds 5
}
`;

// [etiqueta, expresión] — se busca en "proceso título" en minúsculas.
/** @type {Array<[string, RegExp]>} */
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
// ---------- macOS: app y ventana activas con AppleScript (JXA), inactividad con ioreg ----------
// El título de la ventana necesita el permiso de Accesibilidad; sin él, solo se ve el nombre de la app.
const MAC_JXA = `
var se = Application('System Events');
var out = { p: '', t: '', mu: '' };
try {
  var p = se.processes.whose({ frontmost: true })[0];
  out.p = p.name();
  try { out.t = p.windows[0].name(); } catch (e) {}
} catch (e) {}
try {
  var sp = Application('Spotify');
  if (sp.running() && sp.playerState() === 'playing') out.mu = sp.currentTrack.artist() + ' - ' + sp.currentTrack.name();
} catch (e) {}
JSON.stringify(out);`;
function startMac(onSample) {
  const { execFile } = require('child_process');
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    execFile('osascript', ['-l', 'JavaScript', '-e', MAC_JXA], { timeout: 4000 }, (err, out) => {
      let s = {};
      try { s = JSON.parse(String(out || '{}').trim()); } catch { /* sin permiso */ }
      execFile('/bin/sh', ['-c', "ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'"], { timeout: 3000 }, (e2, idle) => {
        if (!stopped && s.p) {
          try { onSample({ t: s.t || '', p: String(s.p).toLowerCase(), i: Number(String(idle).trim()) || 0, m: '', tt: '', f: '', mu: s.mu || '' }); } catch { /* muestra rara */ }
        }
        if (!stopped) setTimeout(tick, 5000);
      });
    });
  };
  tick();
  return () => { stopped = true; };
}

// ---------- Linux (X11): ventana activa con xdotool, inactividad con xprintidle ----------
// En Wayland no hay forma estándar de leer la ventana activa: el vigilante no da muestras y
// PM sigue funcionando sin medir el foco (lo dice en Diagnóstico).
const LINUX_SH = 'w=$(xdotool getactivewindow 2>/dev/null) || exit 3; t=$(xdotool getwindowname "$w" 2>/dev/null); pid=$(xdotool getwindowpid "$w" 2>/dev/null); p=""; [ -n "$pid" ] && p=$(cat /proc/$pid/comm 2>/dev/null); i=$(xprintidle 2>/dev/null || echo 0); printf "%s\\n%s\\n%s\\n" "$p" "$t" "$i"';
/** Salida del script de Linux → muestra como la de Windows (o null si no hay ventana). */
function parseLinux(out) {
  const [p = '', t = '', i = '0'] = String(out || '').split('\n');
  if (!p.trim() && !t.trim()) return null;
  return { t: t.trim(), p: p.trim().toLowerCase(), i: Math.floor((Number(i) || 0) / 1000), m: '', tt: '', f: '', mu: '' };
}
/** @param {(s: object) => void} onSample @param {(why: string) => void} [onError] */
function startLinux(onSample, onError = (_why) => {}) {
  const { execFile } = require('child_process');
  let stopped = false;
  let warned = false;
  const tick = () => {
    if (stopped) return;
    execFile('/bin/sh', ['-c', LINUX_SH], { timeout: 4000 }, (err, out) => {
      const s = err ? null : parseLinux(out);
      if (s) { try { onSample(s); } catch { /* muestra rara */ } }
      else if (!warned) { warned = true; onError(process.env.WAYLAND_DISPLAY ? 'Wayland: no se puede leer la ventana activa' : 'Falta xdotool (sudo apt install xdotool xprintidle)'); }
      if (!stopped) setTimeout(tick, 5000);
    });
  };
  tick();
  return () => { stopped = true; };
}

function start(onSample, onError) {
  if (process.platform === 'darwin') return startMac(onSample);
  if (process.platform === 'linux') return startLinux(onSample, onError);
  let child = null;
  let stopped = false;
  let buf = '';

  const run = () => {
    if (stopped || process.platform !== 'win32') return;
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    child = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
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

// Quién abre el PowerShell del vigilante: en la app, un hilo aparte (src/main/proc.js), porque
// abrirlo congela unos segundos a quien lo abre.
let spawnImpl = (file, args, opts) => spawn(file, args, opts);
function setSpawn(fn) { spawnImpl = fn; }

module.exports = { start, classify, meetingFrom, presentingFrom, parseLinux, setSpawn };

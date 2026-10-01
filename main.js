const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, safeStorage, shell, dialog, Notification } = require('electron');
const path = require('path');
const os = require('os');
const { Store } = require('./src/store');
const usageApi = require('./src/usage');
const claudeWeb = require('./src/claudeWeb');
const focus = require('./src/focus');
const fs = require('fs');
const calendar = require('./src/calendar');
const mail = require('./src/mail');
const accounts = require('./src/accounts');
const productivity = require('./src/productivity');
const aiMod = require('./src/ai');
const gami = require('./src/gamification');
const monitor = require('./src/monitor');
const i18n = require('./src/i18n');
const forecastMod = require('./src/forecast');
const extrasMod = require('./src/extras');
const diag = require('./src/diag');
const devtoolsMod = require('./src/devtools');
const plannerMod = require('./src/planner');
const petlifeMod = require('./src/petlife');
const mcpMod = require('./src/mcp');
const integrations = require('./src/claudeIntegrations');
const sessionsMod = require('./src/sessions');
const projmem = require('./src/projmem');
const syncMod = require('./src/sync');
const exporters = require('./src/exporters');
const journalMod = require('./src/journal');
const profilesMod = require('./src/profiles');
let profiles = null; // perfiles (Trabajo / Personal…)
let sess = null; // sesiones de Claude Code en vivo
let dev = null; // tests/builds, commits, push, ramas
let plan = null; // cola de Claude, presupuesto, priorizar, hitos, viernes
let pl = null; // casita, huevos, diario, personalidad, música
let ex = null; // diario, prompts, hábitos, bloques, objetivos, notas, paseos, copias… (se crea al arrancar)
let ai = null; // chat con IA (se crea al arrancar)
let gameWin = null;
let presenting = null; // { reason, petWasVisible, since } mientras presentas
let presentQuietSince = 0;
const presentBuffer = []; // avisos guardados mientras presentas
const monitorState = {}; // id -> { up, status, ms, since, checkedAt, error }
const lang = () => (store && store.data.settings.lang) || 'es';
const T = (s) => i18n.tr(s, lang());
const { globalShortcut, clipboard } = require('electron');
let prod = null; // funciones de productividad (se crea al arrancar)
let captureWin = null;
let settingsWin = null;
let paletteWin = null;
let aboutWin = null;
const { nativeTheme } = require('electron');
const brain = require('./src/brain');

// La misma carpeta de datos en desarrollo y en la versión instalada: el pollito conserva su memoria.
// PM_USER_DATA: carpeta aislada (tests automáticos). PM_TEST: sin efectos fuera de la app.
const TEST = !!process.env.PM_TEST;
app.setPath('userData', process.env.PM_USER_DATA || path.join(app.getPath('appData'), 'pm-pollito'));
diag.init(app.getPath('userData'));
// Ahorro de memoria: sin aceleración gráfica el proceso de la GPU usa mucho menos memoria.
// Se lee directamente del archivo porque hay que decidirlo antes de que arranque Electron.
try {
  const raw = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'pm-data.json'), 'utf8'));
  if (!raw.settings || raw.settings.lowMemory !== false) app.disableHardwareAcceleration();
} catch { app.disableHardwareAcceleration(); }
// Errores de consola de cualquier ventana → pm-errors.log
app.on('browser-window-created', (_e, w) => diag.watch(w, () => {
  try { return path.basename(new URL(w.webContents.getURL()).pathname, '.html') || 'ventana'; } catch { return 'ventana'; }
}));

// ---------- seguridad ----------
// Todas las ventanas en "sandbox": aunque una página tuviera un fallo, no puede tocar el sistema.
app.enableSandbox();
const RENDERER_URL = require('url').pathToFileURL(path.join(__dirname, 'renderer')).href.toLowerCase();
const isAppPage = (u) => decodeURIComponent(String(u || '')).toLowerCase().startsWith(decodeURIComponent(RENDERER_URL));
app.on('web-contents-created', (_e, wc) => {
  // Nuestras páginas no navegan a ningún otro sitio; los enlaces https se abren en el navegador.
  wc.on('will-navigate', (ev, url) => {
    if (isAppPage(wc.getURL()) && !isAppPage(url)) {
      ev.preventDefault();
      if (url.toLowerCase().startsWith('https://')) shell.openExternal(url);
    }
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (url.toLowerCase().startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-attach-webview', (ev) => ev.preventDefault());
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const PET_W = 240;
const PET_H = 300;
const PANEL_W = 380;
const PANEL_H = 560;
const USAGE_EVERY_MS = 3 * 60 * 1000;
const THRESHOLDS = [25, 50, 75, 90, 100];

let store;
let petWin = null;
let panelWin = null;
let tray = null;
let usage = { limits: [], local: null, connection: { status: 'checking' }, fetchedAt: null };
let drag = null;
let quitting = false;
let quitHow = null; // 'user' | 'shutdown'
let startup = null; // cómo terminó la vez anterior
let stopFocus = null;
const fx = {
  cat: null, label: null, distractSince: null, lastDistractAt: 0, scoldLevel: 0, scolded: false,
  workSince: null, idleSince: null, idleNotified: false, lastSampleAt: 0, sentKey: '',
};

// ---------- utilidades ----------
const pad = (n) => String(n).padStart(2, '0');
function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function today() {
  const k = dayKey();
  if (!store.data.days[k]) store.data.days[k] = {};
  return store.data.days[k];
}
function clamp(v, a = 0, b = 100) {
  return Math.max(a, Math.min(b, v));
}

function manualToken() {
  const enc = store.data.settings.manualToken;
  if (!enc) return '';
  try {
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(enc, 'base64'))
      : Buffer.from(enc, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function encrypt(text) {
  if (!text) return '';
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(text).toString('base64')
    : Buffer.from(text, 'utf8').toString('base64');
}
function decrypt(enc) {
  if (!enc) return '';
  try {
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(enc, 'base64'))
      : Buffer.from(enc, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

// → src/main/agenda.js (correo, calendario y reuniones)

// → src/main/wellbeing.js (bienestar, patrones, niveles, logros, sitios y estadísticas)

// ---------- IA ----------
function aiAvailable() {
  return !!(ai && store.data.settings.aiKey && store.data.settings.aiEnabled !== false);
}

function aiContext() {
  const now = new Date();
  const day = today();
  const tasks = (day.standup && day.standup.today) || [];
  const L = [];
  L.push(`Fecha y hora local: ${now.toLocaleString('es', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} (ISO local: ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')})`);
  L.push(`Tareas de hoy: ${tasks.length ? tasks.map((t, i) => `${i + 1}. [${t.done ? 'x' : ' '}] ${t.text}`).join(' | ') : 'ninguna (no ha hecho el daily)'}`);
  if (day.standup && day.standup.help) L.push(`Pidió ayuda con: ${day.standup.help}`);
  const rem = (store.data.reminders || []).filter((r) => !r.done).map((r) => `${new Date(r.at).toLocaleString('es')}: ${r.text}`);
  if (rem.length) L.push(`Recordatorios: ${rem.join(' | ')}`);
  if (usage.limits && usage.limits.length) L.push(`Límites de Claude: ${usage.limits.map((l) => `${l.label} ${Math.round(l.utilization)}% (reinicio ${l.resetsAt || '?'})`).join(' | ')}`);
  if (usage.local) L.push(`Claude Code hoy: ${usage.local.today.messages} respuestas, ${usage.local.today.input + usage.local.today.output} tokens`);
  const meets = M.todaysMeetings().map((e) => `${new Date(e.start).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })} ${e.title}`);
  if (meets.length) L.push(`Reuniones de hoy: ${meets.join(' | ')}`);
  if (M.meetingNow) L.push(`Ahora está en una reunión (${M.meetingNow.app}).`);
  if (day.focus) L.push(`Enfoque hoy: trabajo ${Math.round(day.focus.work / 60)} min, distracciones ${Math.round(day.focus.distraction / 60)} min`);
  const pr = Object.entries(day.projects || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, s]) => `${k} ${Math.round(s / 60)} min`);
  if (pr.length) L.push(`Proyectos hoy: ${pr.join(', ')}`);
  if (prod && prod.pomoState()) L.push(`Pomodoro en curso (${prod.pomoState().phase}).`);
  L.push(`Mascota: nivel ${M.levelInfo(store.data.pet.xp || 0).level}, felicidad ${Math.round(store.data.pet.happiness)}, pancita ${Math.round(store.data.pet.fullness)}, maíz ${Math.floor(store.data.pet.coins || 0)}`);
  L.push(`Racha de dailies: ${gami.streaks(store.data).daily} días`);
  L.push(`Patrones del usuario: ${M.insights().join(" ")}`);
  const wb = M.wellbeingSignals();
  if (wb.signals.length) L.push(`Señales de cansancio esta semana: ${wb.signals.join(", ")}`);
  if (usage.local) L.push(`Coste equivalente en API hoy: $${usage.local.today.cost.toFixed(2)}`);
  const fc = usage.forecast && usage.forecast.five_hour;
  if (fc && fc.rate) L.push(`Ritmo de consumo de la sesión: +${fc.rate.toFixed(1)}%/h${fc.willHit ? `, llegará al 100% a las ${new Date(fc.eta).toLocaleTimeString("es")}` : ", no llegará al límite antes del reinicio"}`);
  if (ex) {
    const j = ex.claudeJournal();
    if (j.today.length) L.push(`Lo que le pidió hoy a Claude Code: ${ex.journalText(j.today, '').join(' | ')}`);
    const goals = ex.goals();
    if (goals.length) L.push(`Objetivos de la semana: ${goals.map((g) => `${g.text} (${g.progress || 0}%)`).join(' | ')}`);
    const hb = ex.habits().map((h) => `${h.emoji} ${h.name} ${((day.habits || {})[h.id]) || 0}/${h.target}`);
    if (hb.length) L.push(`Hábitos hoy: ${hb.join(', ')}`);
    if (day.blocks && day.blocks.length) L.push(`Bloques de tiempo de hoy: ${day.blocks.map((b) => `${b.start}-${b.end} ${b.title}`).join(' | ')}`);
    if (day.notes) L.push(`Notas del día: ${day.notes.slice(0, 1200)}`);
  }
  if (plan) {
    const ps = plan.snapshot();
    if (ps.claudeQueue.length) L.push(`Cola de peticiones para Claude: ${ps.claudeQueue.map((q) => q.text.slice(0, 80)).join(' | ')}`);
    const ms = ps.milestones.filter((x) => !x.done);
    if (ms.length) L.push(`Hitos: ${ms.map((x) => `${x.title} (${x.project || 'sin proyecto'}) entrega ${x.due}, faltan ${x.days} días, estado ${x.status}`).join(' | ')}`);
    if (ps.budget.budget) L.push(`Presupuesto semanal de Claude: $${ps.budget.spent.toFixed(2)} de $${ps.budget.budget} (${Math.round(ps.budget.pct)}%)`);
    const aged = ((day.standup && day.standup.today) || []).map((t, i) => [t, ps.taskAges[i]]).filter(([t, a]) => !t.done && a >= 3);
    if (aged.length) L.push(`Tareas que se arrastran: ${aged.map(([t, a]) => `${t.text} (${a} días)`).join(' | ')}`);
  }
  return L.join('\n');
}

// ---------- modo presentación: el pollito se esconde ----------
let lastPresentApp = '';
function handlePresenting(reason) {
  const now = Date.now();
  if (reason && Date.now() < M.presentSnoozeUntil && reason !== 'Compartiendo pantalla en Teams') reason = null;
  if (reason && store.data.settings.autoHide !== false) {
    presentQuietSince = 0;
    if (!presenting) {
      presenting = { reason, petWasVisible: !!(petWin && petWin.isVisible()), since: now, app: lastPresentApp };
      if (petWin) petWin.hide();
      if (tray) { tray.setToolTip(`PM · escondido: ${reason}`); tray.refreshMenu && tray.refreshMenu(); }
      diag.log('info', `Me escondí: ${reason} (${lastPresentApp || '?'})`);
      if (panelWin) panelWin.hide();
      if (captureWin && !captureWin.isDestroyed()) captureWin.hide();
      M.broadcast();
    }
    return;
  }
  if (!presenting) return;
  // Espera unos segundos sin pantalla completa antes de volver (evita parpadeos).
  if (!presentQuietSince) { presentQuietSince = now; return; }
  if (now - presentQuietSince < 4000) return;
  const was = presenting;
  presenting = null;
  presentQuietSince = 0;
  if (was.petWasVisible && petWin) petWin.showInactive();
  if (tray) tray.refreshMenu && tray.refreshMenu();
  const pending = presentBuffer.splice(0);
  if (pending.length) {
    const mins = Math.round((now - was.since) / 60000);
    const last = pending[pending.length - 1];
    say(`${pending.length > 1 ? `Mientras presentabas (${mins} min) pasaron ${pending.length} cosas. La última: ` : ''}${last.text}`, last.anim, 12000);
  }
  M.broadcast();
}

// ---------- tienda ----------
function buyItem(id) {
  const item = gami.SHOP.find((x) => x.id === id);
  const p = store.data.pet;
  if (!item) return { ok: false, error: 'Ese accesorio no existe.' };
  p.owned = p.owned || [];
  if (p.owned.includes(id)) return equipItem(id);
  if ((p.coins || 0) < item.price) return { ok: false, error: `Te faltan ${item.price - (p.coins || 0)} 🌽. ¡Completa tareas y pomodoros para ganar más!` };
  p.coins -= item.price;
  p.owned.push(id);
  store.save();
  equipItem(id);
  say(`¡Mira mi ${item.name.toLowerCase()} nuevo! ${item.emoji} ¿A que me queda genial? 💛`, 'dance', 8000);
  M.checkAchievements();
  return { ok: true };
}
function equipItem(id) {
  const item = gami.SHOP.find((x) => x.id === id);
  const p = store.data.pet;
  if (!item || !(p.owned || []).includes(id)) return { ok: false, error: 'Aún no lo tienes.' };
  p.equipped = { ...(p.equipped || {}), [item.slot]: id };
  store.save();
  M.broadcast();
  animate('flap');
  return { ok: true };
}
function unequipSlot(slot) {
  const p = store.data.pet;
  p.equipped = { ...(p.equipped || {}) };
  delete p.equipped[slot];
  store.save();
  M.broadcast();
  return { ok: true };
}

// ---------- silencio (reuniones, concentración) ----------
// ---------- modo "no me distraigas" ----------
// Activo a mano (focus.start) o, si está en ajustes, durante los bloques de tiempo y los pomodoros.
const focusBuffer = [];
function focusMode() {
  const s = store.data.settings;
  if ((store.data.focusUntil || 0) > Date.now()) return 'manual';
  if ((store.data.focusSkipUntil || 0) > Date.now()) return null; // lo terminaste a mano
  if (s.focusDuringBlocks !== false && currentBlock()) return 'block';
  if (s.focusDuringPomodoro !== false && prod && prod.isPomoFocus()) return 'pomodoro';
  return null;
}
function currentBlock() {
  const now = new Date().getHours() * 60 + new Date().getMinutes();
  return (today().blocks || []).find((b) => toMinutes(b.start) <= now && now < toMinutes(b.end)) || null;
}
// Lo urgente pasa siempre; lo demás espera a que termine el foco.
const FOCUS_PASS = new Set(['meeting', 'reminder', 'claude', 'focus', 'pomodoro', 'routine', 'monitor', 'usage']);
let focusWas = null;
function focusTick() {
  const m = focusMode();
  if (m === focusWas) return;
  const was = focusWas;
  focusWas = m;
  sendPet('pet:focusmode', !!m);
  if (tray) tray.refreshMenu && tray.refreshMenu();
  M.broadcast();
  if (!m && was) {
    const n = focusBuffer.length;
    focusBuffer.length = 0;
    if (store.data.focusUntil && store.data.focusUntil <= Date.now()) store.data.focusUntil = 0;
    say(n ? `🎯 ¡Fin del modo foco! Mientras tanto te guardé ${n} aviso${n === 1 ? '' : 's'}.` : '🎯 ¡Fin del modo foco! Buen trabajo 💪', 'celebrate', 9000, {
      cat: 'focus', log: false, actions: n ? [{ label: '🔔 Ver avisos', cmd: 'inbox' }] : [],
    });
  }
}
function startFocus(minutes) {
  store.data.focusUntil = Date.now() + minutes * 60000;
  store.save();
  focusTick();
  say(`🎯 Modo foco ${minutes} min: solo te molesto con lo urgente y te regaño al minuto si te distraes. ¡Tú puedes! 💪`, 'hop', 8000, { cat: 'focus', log: false });
}
function endFocus() {
  store.data.focusUntil = 0;
  // Si era por un bloque o un pomodoro, no vuelvas a activarlo hasta que terminen.
  const b = currentBlock();
  const p = prod && prod.pomoState();
  let until = Date.now() + 60000;
  if (b) { const e = new Date(); e.setHours(0, toMinutes(b.end), 0, 0); until = Math.max(until, e.getTime()); }
  if (p && p.endsAt) until = Math.max(until, p.endsAt);
  store.data.focusSkipUntil = until;
  store.save();
  focusTick();
}

function isMuted() {
  return (store.data.settings.muteUntil || 0) > Date.now();
}
function setMute(minutes) {
  store.data.settings.muteUntil = minutes ? Date.now() + minutes * 60000 : 0;
  store.save();
  if (tray) tray.refreshMenu();
  M.broadcast();
}

function isAngry() {
  return store.data.life.angryUntil > Date.now();
}

function calmDown(minutes) {
  const life = store.data.life;
  if (!isAngry()) return false;
  life.angryUntil -= minutes * 60000;
  if (life.angryUntil <= Date.now()) {
    life.angryUntil = 0;
    say('Hmph… 😤 … bueno, está bien. Te perdono 💛', 'love', 8000);
    pushChat('pet', 'Te perdono… pero no me vuelvas a cerrar 😤💛');
  } else {
    say(pick(['Hmph 😤 … sigue, sigue…', 'No creas que con eso se me pasa… 😒', '…un poquito menos enojado 😤']), 'wobble');
  }
  store.flush();
  M.broadcast();
  return true;
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function inWorkHours() {
  const now = new Date();
  const dow = now.getDay();
  if (store.data.settings.workdaysOnly && (dow === 0 || dow === 6)) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  return m >= toMinutes(store.data.settings.morningTime) && m <= toMinutes(store.data.settings.eveningTime) + 60;
}

function firstPending() {
  const keys = Object.keys(store.data.days).sort().reverse();
  for (const k of keys) {
    const t = store.data.days[k].standup && store.data.days[k].standup.today.find((x) => !x.done);
    if (t) return t.text;
    if (store.data.days[k].standup) return null;
  }
  return null;
}

// → src/main/watcher.js (vigilante de ventanas: distracciones, reuniones, presentaciones)

// ---------- categorías y botones de los avisos ----------
/** @type {Array<[RegExp, string]>} */
const CAT_RULES = [
  [/^(🍅|☕|⏰ ¡Se acabó el descanso)/, 'pomodoro'],
  [/^🏅/, 'achievement'],
  [/^⏰/, 'reminder'],
  [/^(📅|🎧)/, 'meeting'],
  [/Claude (terminó|necesita|está esperando)|^🙋/, 'claude'],
  [/^(❌ Falló el CI|👀 .+ te pidió revisar|🎉 ¡Aprobaron|✏️ Te pidieron|💬 Nuevo comentario|✅ El CI)/, 'github'],
  [/^(📦|💾|🌿)/, 'git'],
  [/^(🧘|💧|👀 Regla)/, 'health'],
  [/^(🔴|🟢)/, 'monitor'],
  [/^📧/, 'mail'],
  [/(min(utos)? en |MINUTOS en|¡Estamos en pomodoro|Sigues ahí|Volviste)/, 'focus'],
  [/(límite|sesión|Llegamos al 100%)/, 'usage'],
  [/(Buenos días! ☀️ ¿Qué hiciste|Casi termina el día|informe semanal está listo)/, 'routine'],
];
function inferCat(text) {
  for (const [re, cat] of CAT_RULES) if (re.test(text)) return cat;
  return 'pet';
}
// Botones automáticos según el aviso (los que necesitan datos concretos se pasan en opts.actions).
function inferActions(text, cat) {
  if (/¿Qué hiciste ayer y qué vas a hacer hoy/.test(text)) return [{ label: '☀️ Hacer daily', cmd: 'daily' }, { label: 'Más tarde', cmd: 'snooze.standup' }];
  if (/Casi termina el día/.test(text)) return [{ label: '🌇 Hacer cierre', cmd: 'review' }, { label: 'Más tarde', cmd: 'snooze.review' }];
  if (cat === 'focus' && /(min(utos)? en |MINUTOS en)/.test(text)) return [{ label: '💼 Es trabajo', cmd: 'focus.allow' }, { label: '👍 Ya lo cierro', cmd: 'focus.ok' }];
  if (/Pomodoro completado/.test(text)) return [{ label: '🎮 Jugar', cmd: 'game' }, { label: '⏭️ Saltar descanso', cmd: 'pomo.start' }];
  if (/Se acabó el descanso/.test(text)) return [{ label: '🍅 Otro pomodoro', cmd: 'pomo.start' }];
  if (/Sigues ahí/.test(text)) return [{ label: '👋 Aquí estoy', cmd: 'ack' }];
  if (/tengo hambre/i.test(text)) return [{ label: '🌽 Dar maíz', cmd: 'feed' }];
  if (/Pausa activa/.test(text)) return [{ label: '🧘 ¡Hecho!', cmd: 'health.done' }, { label: 'Luego', cmd: 'ack' }];
  if (/(CERRASTE|Me cerraste|Por fin vuelves|ENOJADO)/.test(text)) return [{ label: '🥺 Perdón', cmd: 'forgive' }, { label: '💛 Acariciar', cmd: 'pet' }];
  if (/(SUBÍ A NIVEL|EVOLUCIONÉ)/.test(text)) return [{ label: '🛍️ Ver tienda', cmd: 'panel.profile' }];
  if (cat === 'achievement') return [{ label: '🏅 Ver logros', cmd: 'panel.profile' }];
  if (/informe semanal está listo/.test(text)) return [{ label: '📊 Ver informe', cmd: 'report.weekly' }];
  if (/Reunión terminada/.test(text)) return [{ label: '✍️ Anotar tarea', cmd: 'capture' }];
  if (cat === 'usage' && /(Alerta|100%)/.test(text)) return [{ label: '📊 Ver uso', cmd: 'panel.usage' }];
  if (cat === 'claude' && /terminó/.test(text)) return [{ label: '👍 Visto', cmd: 'ack' }];
  return null;
}

// A dónde te lleva cada aviso al hacer clic (bocadillo, centro de avisos o notificación de Windows).
const CAT_TARGET = {
  meeting: 'agenda#meetings', reminder: 'day#reminders', usage: 'usage#limits', focus: 'day#focus', github: 'agenda#ghbox',
  git: 'day#gitbox', monitor: 'agenda#monitors', pomodoro: 'day#pomo-box', health: 'day#focus', achievement: 'pet#achievements',
  mail: 'agenda#mailbox', claude: 'usage#local', pet: 'pet', routine: 'day',
};
function targetFor(raw, cat, opts, actions) {
  if (opts.target) return opts.target;
  if (/¿Qué hiciste ayer y qué vas a hacer hoy/.test(raw)) return { cmd: 'daily' };
  if (/Casi termina el día/.test(raw)) return { cmd: 'review' };
  if (/informe semanal está listo/.test(raw)) return { cmd: 'report.weekly' };
  if (/(SUBÍ A NIVEL|EVOLUCIONÉ|Mira mi .* nuevo)/.test(raw)) return { cmd: 'panel', arg: 'pet#shop' };
  if (/(tengo hambre|Huelo un poquito|Estoy agotado|No me siento bien)/i.test(raw)) return { cmd: 'panel', arg: 'pet' };
  if (/Reunión terminada/.test(raw)) return { cmd: 'panel', arg: 'day#tasks' };
  if (/Pomodoro completado|Se acabó el descanso/.test(raw)) return { cmd: 'panel', arg: 'day#pomo-box' };
  // Si el aviso trae un enlace (PR de GitHub…), ese es su destino.
  const link = (actions || []).find((a) => a.cmd === 'open.url' && cat === 'github');
  if (link) return { cmd: 'open.url', arg: link.arg };
  return { cmd: 'panel', arg: CAT_TARGET[cat] || 'chat' };
}

function logInbox(text, cat, actions, target) {
  const inbox = store.data.inbox || (store.data.inbox = []);
  inbox.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: Date.now(), text, cat, read: false, actions: actions && actions.length ? actions : undefined, target });
  if (inbox.length > 200) store.data.inbox = inbox.slice(-200);
  store.save();
}

function say(text, anim, ms, opts = {}) {
  const raw = String(text);
  const cat = opts.cat || inferCat(raw);
  // Lo importante también sale del PC: canal del equipo y celular (src/main/remote.js).
  try { if (mods.remote) mods.remote.onSay(raw, cat, opts); } catch (e) { diag.log('main', 'Avisos fuera del PC: ' + e.message); }
  if (!petWin || petWin.isDestroyed()) return;
  const actions = (opts.actions || inferActions(raw, cat) || []).map((a) => ({ ...a, label: T(a.label) }));
  text = T(raw);
  const target = targetFor(raw, cat, opts, actions);
  if (opts.log !== false) logInbox(text, cat, actions, target);
  // Modo foco: lo no urgente se queda en el centro de avisos hasta que termines.
  if (focusMode() && !opts.urgent && !FOCUS_PASS.has(cat)) {
    if (opts.log !== false) focusBuffer.push(text);
    return;
  }
  // Mientras presentas, no aparece nada en pantalla: se guarda para después.
  if (presenting) {
    presentBuffer.push({ text, anim, ms });
    if (presentBuffer.length > 5) presentBuffer.shift();
    return;
  }
  if (store.data.settings.discreet) M.peekPet(Math.max(ms || 7000, actions.length ? 20000 : 0) + 800);
  // Voz: solo para avisos importantes (reuniones, recordatorios, Claude te necesita, sitios caídos, límite).
  const speak = store.data.settings.voice !== false && !isMuted() && (
    ((cat === 'meeting' || cat === 'reminder' || cat === 'monitor') && !/^(🟢)/.test(raw)) ||
    (cat === 'claude' && /(necesita|esperando)/.test(raw)) ||
    (cat === 'usage' && /(Alerta|100%|🔮)/.test(raw)));
  petWin.webContents.send('pet:say', { text, anim, ms: actions.length ? Math.max(ms || 0, 20000) : ms, quiet: !!opts.quiet, actions, speak, lang: lang(), target });
  M.broadcast();
  // Si el pollito está oculto, avisa con una notificación de Windows.
  if (!petWin.isVisible() && Notification.isSupported()) {
    const n = new Notification({ title: `🐣 ${store.data.pet.name || 'PM'}`, body: text, silent: false });
    n.on('click', () => runCommand(target.cmd, target.arg)); // clic en la notificación → a verlo
    n.show();
  }
}
function animate(name) {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('pet:anim', name);
}

function sendPet(channel, data) {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send(channel, data);
}

function notify(title, body, onClick) {
  if (!Notification.isSupported() || presenting) return; // nada de notificaciones en plena presentación
  const n = new Notification({ title: T(title), body: T(body) });
  n.on('click', onClick || (() => M.openPanel('inbox')));
  n.show();
}

function openSafeUrl(url) {
  if (/^https:\/\/(github\.com|teams\.microsoft\.com|teams\.live\.com|meet\.google\.com|([\w-]+\.)?zoom\.us)\//i.test(url || '')) shell.openExternal(url);
}

function addTask(text) {
  const day = today();
  if (!day.standup) day.standup = { yesterday: '', today: [], help: '', at: Date.now() };
  day.standup.today.push({ text, done: false });
  store.save();
  M.broadcast();
}

function pushChat(from, text) {
  if (from === 'pet') text = T(text);
  store.data.chat.push({ from, text, at: Date.now() });
  if (store.data.chat.length > 200) store.data.chat = store.data.chat.slice(-200);
  store.save();
}

// ---------- ventanas ----------
function createPet() {
  const wa = screen.getPrimaryDisplay().workArea;
  let pos = store.data.position;
  const visible = pos && screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return pos.x + PET_W / 2 >= a.x && pos.x + PET_W / 2 <= a.x + a.width && pos.y + PET_H / 2 >= a.y && pos.y + PET_H / 2 <= a.y + a.height;
  });
  if (!visible) pos = { x: wa.x + wa.width - PET_W - 30, y: wa.y + wa.height - PET_H - 10 };

  petWin = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: PET_W,
    height: PET_H,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    title: 'PM',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.setVisibleOnAllWorkspaces(true);
  petWin.setIgnoreMouseEvents(true, { forward: true });
  petWin.loadFile(path.join(__dirname, 'renderer', 'pet.html'));
  petWin.on('closed', () => (petWin = null));
}

// El panel se libera de memoria tras 3 min oculto y se vuelve a crear al abrirlo.
// Los mensajes para el panel se encolan hasta que termina de cargar.
let panelReady = false;
const panelQueue = [];
let panelDisposeTimer = null;
function panelSend(channel, data) {
  if (panelWin && !panelWin.isDestroyed() && panelReady) panelWin.webContents.send(channel, data);
  else { panelQueue.push([channel, data]); if (panelQueue.length > 20) panelQueue.shift(); }
}
function createPanel() {
  panelReady = false;
  panelWin = new BrowserWindow({
    width: PANEL_W,
    height: PANEL_H,
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    title: 'PM · Panel',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  panelWin.setAlwaysOnTop(true, 'screen-saver');
  panelWin.loadFile(path.join(__dirname, 'renderer', 'panel.html'));
  const win = panelWin;
  win.webContents.once('did-finish-load', () => {
    panelReady = true;
    for (const [ch, data] of panelQueue.splice(0)) win.webContents.send(ch, data);
    if (!win.isVisible()) win.emit('hide'); // si nadie lo abre, también se libera
  });
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('hide', () => {
    clearTimeout(panelDisposeTimer);
    if (store.data.settings.lowMemory === false) return;
    panelDisposeTimer = setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) win.destroy(); }, 3 * 60e3);
  });
  win.on('show', () => clearTimeout(panelDisposeTimer));
  win.on('closed', () => { if (panelWin === win) { panelWin = null; panelReady = false; } });
  win.webContents.on('render-process-gone', (_e, d) => {
    if (quitting || d.reason === 'clean-exit' || win.isDestroyed()) return;
    diag.log('main', `La ventana del panel se cayó (${d.reason}); la recupero`);
    setTimeout(() => { if (!win.isDestroyed()) win.webContents.reload(); }, 800);
  });
}

// ---------- minijuego: atrapa el maíz ----------
function openGame() {
  if (gameWin && !gameWin.isDestroyed()) { gameWin.show(); gameWin.focus(); return; }
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  gameWin = new BrowserWindow({
    width: 460,
    height: 400,
    x: Math.round(d.x + (d.width - 460) / 2),
    y: Math.round(d.y + (d.height - 400) / 2),
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    title: 'PM · Minijuego',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  gameWin.setAlwaysOnTop(true, 'screen-saver', 2);
  gameWin.loadFile(path.join(__dirname, 'renderer', 'game.html'));
  gameWin.on('closed', () => (gameWin = null));
}

// ---------- actualizaciones automáticas (solo en la versión instalada) ----------
let updater = null;
function getUpdater() {
  if (!app.isPackaged) return null;
  if (!updater) {
    try {
      updater = require('electron-updater').autoUpdater;
      updater.autoDownload = true;
      updater.autoInstallOnAppQuit = true;
      updater.on('update-downloaded', (info) => {
        quitHow = 'update';
        // PM casi nunca se cierra (vive en la bandeja): mejor ofrecer instalarla ya.
        say(`🎁 ¡Hay una versión nueva (${info.version})! Se instalará cuando cierres PM, o ahora mismo si quieres (tardo unos segundos).`, 'celebrate', 20000, {
          cat: 'pet', actions: [{ label: '🔄 Actualizar ahora', cmd: 'update.install' }, { label: 'Luego', cmd: 'ack' }],
        });
      });
      updater.on('error', () => {}); // sin servidor configurado o sin internet: silencio
    } catch {
      updater = null;
    }
  }
  return updater;
}
async function checkUpdates(manual) {
  const u = getUpdater();
  if (!u) return { ok: false, error: app.isPackaged ? 'No hay servidor de actualizaciones configurado.' : 'Las actualizaciones solo funcionan en la versión instalada.' };
  try {
    const r = await u.checkForUpdates();
    const v = r && r.updateInfo && r.updateInfo.version;
    if (manual) say(v && v !== app.getVersion() ? `Descargando la versión ${v}… 🎁` : '¡Ya tienes la última versión! ✅', 'peck', 7000);
    return { ok: true, version: v || app.getVersion() };
  } catch (e) {
    // Primero "sin versiones publicadas": su mensaje ("No published versions") también contiene "publish".
    const noRelease = /404|Unable to find latest version|No published versions/i.test(e.message);
    const noServer = /app-update\.yml|ENOENT|publish/i.test(e.message);
    return { ok: false, error: noRelease ? `Aún no hay versiones publicadas: tienes la ${app.getVersion()}.` : noServer ? 'No hay servidor de actualizaciones configurado (ver README → Publicar actualizaciones).' : e.message };
  }
}

// =====================================================================
// COMANDOS: un solo registro para la paleta, los botones de los avisos,
// el menú contextual y los atajos.
// =====================================================================
function allowCurrentDistraction() {
  const day = today();
  if (fx.label && (fx.cat === 'distraction' || fx.distractSince)) {
    day.focusAllow = { ...(day.focusAllow || {}), [fx.label]: true };
    const label = fx.label;
    fx.distractSince = null; fx.scoldLevel = 0; fx.scolded = false; fx.sentKey = '';
    store.save();
    return `Vale… hoy ${label} cuenta como trabajo 🤨 Te creo. Por ahora.`;
  }
  setMute(30);
  return 'Vale, te dejo tranquilo 30 minutos 🤫';
}

function nextJoinable() {
  const now = Date.now();
  return (M.calState.events || []).find((e) => e.join && e.join.url && !e.allDay && e.end > now && e.start - now < 15 * 60000);
}

function trackingPaused() {
  return (store.data.settings.trackingPausedUntil || 0) > Date.now();
}
function pauseTracking(minutes) {
  store.data.settings.trackingPausedUntil = minutes ? Date.now() + minutes * 60000 : 0;
  fx.cat = null; fx.distractSince = null; fx.sentKey = '';
  sendPet('pet:focus', { cat: null, scoldLevel: 0, idle: 0 });
  store.save();
  M.broadcast();
}

// → src/main/commands.js (todas las acciones (paleta, botones de los avisos, vs code, mcp))

// ---------- API para la extensión de VS Code (servidor local 127.0.0.1:47823) ----------
const EXT_COMMANDS = new Set([
  'pomo.toggle',
  'push.check', 'day.prioritize', 'queue.next',
  'pomo.start', 'pomo.stop', 'capture', 'palette', 'panel.chat', 'panel.usage', 'panel.day', 'panel.agenda', 'panel.profile',
  'inbox', 'mute', 'unmute', 'daily', 'review', 'report.weekly', 'stats', 'feed', 'pet', 'usage.refresh', 'join',
]);
// → src/main/pro.js (sincronizar, exportar, perfiles, comando pm, mcp y memoria de proyecto)

function extCommand(cmd) {
  return EXT_COMMANDS.has(cmd) && runCommand(cmd);
}
function extStatus() {
  const s = (usage.limits || []).find((l) => l.key === 'five_hour');
  const w = (usage.limits || []).find((l) => l.key === 'seven_day');
  const fc = usage.forecast && usage.forecast.five_hour;
  const tasks = (today().standup && today().standup.today) || [];
  const running = tasks.find((t) => t.startedAt);
  return {
    name: store.data.pet.name || 'PM',
    lang: lang(),
    session: s ? { pct: Math.round(s.utilization), resetsAt: s.resetsAt } : null,
    weekly: w ? { pct: Math.round(w.utilization), resetsAt: w.resetsAt } : null,
    forecast: fc && fc.rate ? { rate: fc.rate, eta: fc.eta, willHit: !!fc.willHit } : null,
    pomo: prod ? prod.pomoState() : null,
    tasks: { done: tasks.filter((t) => t.done).length, total: tasks.length },
    runningTask: running ? { text: running.text, since: running.startedAt, spent: running.spent || 0, est: running.est || 0 } : null,
    meeting: M.meetingNow ? { title: M.meetingNow.title, app: M.meetingNow.app } : null,
    unread: (store.data.inbox || []).filter((x) => !x.read && x.cat !== 'pet').length,
    muted: isMuted(),
    costToday: usage.local ? usage.local.today.cost : 0,
    mood: isAngry() ? 'angry' : store.data.pet.sick ? 'sick' : 'ok',
  };
}

function openProject(dir) {
  try {
    if (!dir || !fs.statSync(dir).isDirectory()) return M.openPanel('usage#local');
  } catch {
    return M.openPanel('usage#local');
  }
  // Intenta VS Code ("code" en el PATH); si no existe, abre la carpeta en el Explorador.
  const child = require('child_process').spawn('cmd.exe', ['/d', '/c', 'code', dir], { windowsHide: true, detached: true, stdio: 'ignore' });
  child.on('exit', (code) => { if (code !== 0) shell.openPath(dir); });
  child.on('error', () => shell.openPath(dir));
  child.unref();
}

function runCommand(id, arg) {
  const c = M.COMMANDS.find((x) => x.id === id);
  if (!c) {
    // Una ventana pide algo que este proceso no conoce: pasa si el código se actualizó con PM abierto
    // (las ventanas cargan lo nuevo al abrirse, pero el proceso principal no hasta reiniciar).
    diag.log('main', `Comando desconocido: ${id}`);
    say('🔄 Esa acción es nueva y necesito reiniciarme para usarla.', 'peck', 12000, { log: false, remote: false, actions: [{ label: '🔄 Reiniciar ahora', cmd: 'restart' }] });
    return false;
  }
  if (c.when && !c.when()) return false;
  try {
    const r = c.run(arg);
    if (r && typeof r.catch === 'function') r.catch((e) => diag.log('main', `Comando ${id}: ${e.stack || e.message}`));
  } catch (e) { diag.log('main', `Comando ${id}: ${e.stack || e.message}`); }
  return true;
}

function paletteCommands() {
  const repos = prod ? require('./src/git').discover(prod.snapshot().git.roots || []) : [];
  const mem = repos.map((r) => ({ id: 'project.memory', arg: r, icon: '🧠', label: T('Actualizar CLAUDE.md de ') + path.basename(r), kw: 'claude.md memoria proyecto contexto ' + path.basename(r) }))
    .concat(repos.map((r) => ({ id: 'context.open', arg: path.basename(r), icon: '🎯', label: T('Trabajar en ') + path.basename(r), kw: 'contexto trabajar abrir proyecto cambiar ' + path.basename(r) })))
    .concat(repos.map((r) => ({ id: 'where.resume', arg: path.basename(r), icon: '📍', label: T('¿Dónde me quedé en ') + path.basename(r) + '?', kw: 'donde me quede retomar resumen ultimo ' + path.basename(r) })));
  const tpl = ex ? ex.templates().map((t) => ({ id: 'template.apply', arg: t.id, icon: t.emoji || '🧩', label: T('Aplicar plantilla: ') + t.name, kw: 'plantilla dia ' + t.name })) : [];
  return M.COMMANDS.filter((c) => !c.hidden && (!c.when || c.when())).map((c) => ({ id: c.id, icon: c.icon, label: T(c.label), kw: c.kw })).concat(tpl).concat(mem).concat(profiles.list().list.filter((p) => p.id !== profiles.active().id).map((p) => ({ id: 'profile', arg: p.id, icon: p.emoji, label: T('Cambiar al perfil ') + p.name, kw: 'perfil cambiar ' + p.name })));
}

// Recarga todas las ventanas (p. ej. al cambiar el idioma).
function reloadUi() {
  for (const w of [panelWin, settingsWin, paletteWin, aboutWin]) if (w && !w.isDestroyed()) w.webContents.reload();
  if (tray) tray.refreshMenu();
  M.broadcast();
}

// → src/main/windows.js (apariencia, modo discreto, ventanas auxiliares, datos y captura rápida)

// → src/main/tray.js (bandeja del sistema: icono dinámico y menú)

// → src/main/usagewatch.js (consumo de Claude: límites, predicción y umbrales)

// → src/main/petcare.js (daily y cierre, vida de la mascota, memoria entre aperturas, comida, mimos y cronómetro)

// → src/main/ipc.js (mensajes entre las ventanas y el proceso principal (ipc))

// ---------- arranque ----------
// → src/main/safemode.js (modo seguro y copias para restaurar al arrancar)

// ---------- contexto compartido para los módulos de src/main ----------
// Cada propiedad lee (o cambia) la variable o función real, así los módulos siempre ven el valor actual.
const mods = {};
// Carpeta de la app (los módulos de src/main la usan para rutas a renderer/, build/, cli/, mcp/…).
const APP_DIR = __dirname;
const M = {
  get APP_DIR() { return APP_DIR; },
  get app() { return app; },
  get BrowserWindow() { return BrowserWindow; },
  get ipcMain() { return ipcMain; },
  get screen() { return screen; },
  get Tray() { return Tray; },
  get Menu() { return Menu; },
  get nativeImage() { return nativeImage; },
  get safeStorage() { return safeStorage; },
  get shell() { return shell; },
  get dialog() { return dialog; },
  get Notification() { return Notification; },
  get path() { return path; },
  get os() { return os; },
  get Store() { return Store; },
  get usageApi() { return usageApi; },
  get claudeWeb() { return claudeWeb; },
  get focus() { return focus; },
  get fs() { return fs; },
  get calendar() { return calendar; },
  get mail() { return mail; },
  get accounts() { return accounts; },
  get productivity() { return productivity; },
  get aiMod() { return aiMod; },
  get gami() { return gami; },
  get monitor() { return monitor; },
  get i18n() { return i18n; },
  get forecastMod() { return forecastMod; },
  get extrasMod() { return extrasMod; },
  get diag() { return diag; },
  get devtoolsMod() { return devtoolsMod; },
  get plannerMod() { return plannerMod; },
  get petlifeMod() { return petlifeMod; },
  get mcpMod() { return mcpMod; },
  get integrations() { return integrations; },
  get sessionsMod() { return sessionsMod; },
  get projmem() { return projmem; },
  get syncMod() { return syncMod; },
  get exporters() { return exporters; },
  get journalMod() { return journalMod; },
  get profilesMod() { return profilesMod; },
  get profiles() { return profiles; },
  set profiles(v) { profiles = v; },
  get sess() { return sess; },
  set sess(v) { sess = v; },
  get dev() { return dev; },
  set dev(v) { dev = v; },
  get plan() { return plan; },
  set plan(v) { plan = v; },
  get pl() { return pl; },
  set pl(v) { pl = v; },
  get ex() { return ex; },
  set ex(v) { ex = v; },
  get ai() { return ai; },
  set ai(v) { ai = v; },
  get gameWin() { return gameWin; },
  set gameWin(v) { gameWin = v; },
  get presenting() { return presenting; },
  set presenting(v) { presenting = v; },
  get presentQuietSince() { return presentQuietSince; },
  set presentQuietSince(v) { presentQuietSince = v; },
  get presentBuffer() { return presentBuffer; },
  get monitorState() { return monitorState; },
  get lang() { return lang; },
  get T() { return T; },
  get globalShortcut() { return globalShortcut; },
  get clipboard() { return clipboard; },
  get prod() { return prod; },
  set prod(v) { prod = v; },
  get captureWin() { return captureWin; },
  set captureWin(v) { captureWin = v; },
  get settingsWin() { return settingsWin; },
  set settingsWin(v) { settingsWin = v; },
  get paletteWin() { return paletteWin; },
  set paletteWin(v) { paletteWin = v; },
  get aboutWin() { return aboutWin; },
  set aboutWin(v) { aboutWin = v; },
  get nativeTheme() { return nativeTheme; },
  get brain() { return brain; },
  get TEST() { return TEST; },
  get RENDERER_URL() { return RENDERER_URL; },
  get isAppPage() { return isAppPage; },
  get PET_W() { return PET_W; },
  get PET_H() { return PET_H; },
  get PANEL_W() { return PANEL_W; },
  get PANEL_H() { return PANEL_H; },
  get USAGE_EVERY_MS() { return USAGE_EVERY_MS; },
  get THRESHOLDS() { return THRESHOLDS; },
  get store() { return store; },
  set store(v) { store = v; },
  get petWin() { return petWin; },
  set petWin(v) { petWin = v; },
  get panelWin() { return panelWin; },
  set panelWin(v) { panelWin = v; },
  get tray() { return tray; },
  set tray(v) { tray = v; },
  get usage() { return usage; },
  set usage(v) { usage = v; },
  get drag() { return drag; },
  set drag(v) { drag = v; },
  get quitting() { return quitting; },
  set quitting(v) { quitting = v; },
  get quitHow() { return quitHow; },
  set quitHow(v) { quitHow = v; },
  get startup() { return startup; },
  set startup(v) { startup = v; },
  get stopFocus() { return stopFocus; },
  set stopFocus(v) { stopFocus = v; },
  get fx() { return fx; },
  get pad() { return pad; },
  get dayKey() { return dayKey; },
  get toMinutes() { return toMinutes; },
  get today() { return today; },
  get clamp() { return clamp; },
  get manualToken() { return manualToken; },
  get encrypt() { return encrypt; },
  get decrypt() { return decrypt; },
  get aiAvailable() { return aiAvailable; },
  get aiContext() { return aiContext; },
  get lastPresentApp() { return lastPresentApp; },
  set lastPresentApp(v) { lastPresentApp = v; },
  get handlePresenting() { return handlePresenting; },
  get buyItem() { return buyItem; },
  get equipItem() { return equipItem; },
  get unequipSlot() { return unequipSlot; },
  get focusBuffer() { return focusBuffer; },
  get focusMode() { return focusMode; },
  get currentBlock() { return currentBlock; },
  get FOCUS_PASS() { return FOCUS_PASS; },
  get focusWas() { return focusWas; },
  set focusWas(v) { focusWas = v; },
  get focusTick() { return focusTick; },
  get startFocus() { return startFocus; },
  get endFocus() { return endFocus; },
  get isMuted() { return isMuted; },
  get setMute() { return setMute; },
  get isAngry() { return isAngry; },
  get calmDown() { return calmDown; },
  get pick() { return pick; },
  get inWorkHours() { return inWorkHours; },
  get firstPending() { return firstPending; },
  get CAT_RULES() { return CAT_RULES; },
  get inferCat() { return inferCat; },
  get inferActions() { return inferActions; },
  get CAT_TARGET() { return CAT_TARGET; },
  get targetFor() { return targetFor; },
  get logInbox() { return logInbox; },
  get say() { return say; },
  get animate() { return animate; },
  get sendPet() { return sendPet; },
  get notify() { return notify; },
  get openSafeUrl() { return openSafeUrl; },
  get addTask() { return addTask; },
  get pushChat() { return pushChat; },
  get createPet() { return createPet; },
  get panelReady() { return panelReady; },
  set panelReady(v) { panelReady = v; },
  get panelQueue() { return panelQueue; },
  get panelDisposeTimer() { return panelDisposeTimer; },
  set panelDisposeTimer(v) { panelDisposeTimer = v; },
  get panelSend() { return panelSend; },
  get createPanel() { return createPanel; },
  get openGame() { return openGame; },
  get updater() { return updater; },
  set updater(v) { updater = v; },
  get getUpdater() { return getUpdater; },
  get checkUpdates() { return checkUpdates; },
  get allowCurrentDistraction() { return allowCurrentDistraction; },
  get nextJoinable() { return nextJoinable; },
  get trackingPaused() { return trackingPaused; },
  get pauseTracking() { return pauseTracking; },
  get EXT_COMMANDS() { return EXT_COMMANDS; },
  get extCommand() { return extCommand; },
  get extStatus() { return extStatus; },
  get openProject() { return openProject; },
  get runCommand() { return runCommand; },
  get paletteCommands() { return paletteCommands; },
  get reloadUi() { return reloadUi; },
  get refreshUsage() { return mods.usagewatch.refreshUsage; },
  get updateForecasts() { return mods.usagewatch.updateForecasts; },
  get processThresholds() { return mods.usagewatch.processThresholds; },
  get checkSchedule() { return mods.petcare.checkSchedule; },
  get petTick() { return mods.petcare.petTick; },
  get markStarted() { return mods.petcare.markStarted; },
  get markStopped() { return mods.petcare.markStopped; },
  get greetOnStart() { return mods.petcare.greetOnStart; },
  get confirmQuit() { return mods.petcare.confirmQuit; },
  get chatter() { return mods.petcare.chatter; },
  get feed() { return mods.petcare.feed; },
  get petPet() { return mods.petcare.petPet; },
  get taskTimer() { return mods.petcare.taskTimer; },
  get mailState() { return mods.agenda.mailState; },
  set mailState(v) { mods.agenda.mailState = v; },
  get calState() { return mods.agenda.calState; },
  set calState(v) { mods.agenda.calState = v; },
  get meetingNow() { return mods.agenda.meetingNow; },
  set meetingNow(v) { mods.agenda.meetingNow = v; },
  get reminded() { return mods.agenda.reminded; },
  get mailConfig() { return mods.agenda.mailConfig; },
  get oauthConfig() { return mods.agenda.oauthConfig; },
  get oauthReady() { return mods.agenda.oauthReady; },
  get saveOauthConfig() { return mods.agenda.saveOauthConfig; },
  get accountIo() { return mods.agenda.accountIo; },
  get connectedAccounts() { return mods.agenda.connectedAccounts; },
  get PROVIDER_LABEL() { return mods.agenda.PROVIDER_LABEL; },
  get accountErrors() { return mods.agenda.accountErrors; },
  get refreshMail() { return mods.agenda.refreshMail; },
  get refreshCalendar() { return mods.agenda.refreshCalendar; },
  get todaysMeetings() { return mods.agenda.todaysMeetings; },
  get currentEvent() { return mods.agenda.currentEvent; },
  get joinMeeting() { return mods.agenda.joinMeeting; },
  get meetingReminders() { return mods.agenda.meetingReminders; },
  get previousStandup() { return mods.agenda.previousStandup; },
  get snapshot() { return mods.agenda.snapshot; },
  get wellbeingSignals() { return mods.wellbeing.wellbeingSignals; },
  get checkBirthday() { return mods.wellbeing.checkBirthday; },
  get checkWellbeing() { return mods.wellbeing.checkWellbeing; },
  get insights() { return mods.wellbeing.insights; },
  get estimateStats() { return mods.wellbeing.estimateStats; },
  get checklist() { return mods.wellbeing.checklist; },
  get TITLES() { return mods.wellbeing.TITLES; },
  get levelInfo() { return mods.wellbeing.levelInfo; },
  get addXp() { return mods.wellbeing.addXp; },
  get achievementCtx() { return mods.wellbeing.achievementCtx; },
  get checkAchievements() { return mods.wellbeing.checkAchievements; },
  get checkMonitors() { return mods.wellbeing.checkMonitors; },
  get statsData() { return mods.wellbeing.statsData; },
  get sendMeeting() { return mods.watcher.sendMeeting; },
  get handleMeeting() { return mods.watcher.handleMeeting; },
  get onFocusSample() { return mods.watcher.onFocusSample; },
  get broadcastTimer() { return mods.watcher.broadcastTimer; },
  set broadcastTimer(v) { mods.watcher.broadcastTimer = v; },
  get broadcast() { return mods.watcher.broadcast; },
  get COMMANDS() { return mods.commands.COMMANDS; },
  get syncDir() { return mods.pro.syncDir; },
  get device() { return mods.pro.device; },
  get syncing() { return mods.pro.syncing; },
  set syncing(v) { mods.pro.syncing = v; },
  get syncNow() { return mods.pro.syncNow; },
  get journalForDay() { return mods.pro.journalForDay; },
  get exportObsidian() { return mods.pro.exportObsidian; },
  get exportBlocksIcs() { return mods.pro.exportBlocksIcs; },
  get switchProfile() { return mods.pro.switchProfile; },
  get cliPaths() { return mods.pro.cliPaths; },
  get cliInstalled() { return mods.pro.cliInstalled; },
  get installCli() { return mods.pro.installCli; },
  get mcpToken() { return mods.pro.mcpToken; },
  get repoByName() { return mods.pro.repoByName; },
  get completeTaskBy() { return mods.pro.completeTaskBy; },
  get mcpRun() { return mods.pro.mcpRun; },
  get statusLineText() { return mods.pro.statusLineText; },
  get updateProjectMemory() { return mods.pro.updateProjectMemory; },
  get integrationsState() { return mods.pro.integrationsState; },
  get bridgePaths() { return mods.pro.bridgePaths; },
  get setIntegration() { return mods.pro.setIntegration; },
  get isRepo() { return mods.pro.isRepo; },
  get extCapture() { return mods.pro.extCapture; },
  get isDark() { return mods.windows.isDark; },
  get SIZE_FACTOR() { return mods.windows.SIZE_FACTOR; },
  get petFactor() { return mods.windows.petFactor; },
  get setPetSize() { return mods.windows.setPetSize; },
  get applyPetSize() { return mods.windows.applyPetSize; },
  get dockTimer() { return mods.windows.dockTimer; },
  set dockTimer(v) { mods.windows.dockTimer = v; },
  get slideTimer() { return mods.windows.slideTimer; },
  set slideTimer(v) { mods.windows.slideTimer = v; },
  get slidePetTo() { return mods.windows.slidePetTo; },
  get dockPositions() { return mods.windows.dockPositions; },
  get dockPet() { return mods.windows.dockPet; },
  get peekPet() { return mods.windows.peekPet; },
  get setDiscreet() { return mods.windows.setDiscreet; },
  get baseWinOpts() { return mods.windows.baseWinOpts; },
  get openSettings() { return mods.windows.openSettings; },
  get autoDispose() { return mods.windows.autoDispose; },
  get openPalette() { return mods.windows.openPalette; },
  get openAbout() { return mods.windows.openAbout; },
  get backupPassword() { return mods.windows.backupPassword; },
  get exportData() { return mods.windows.exportData; },
  get importData() { return mods.windows.importData; },
  get deleteAllData() { return mods.windows.deleteAllData; },
  get openCapture() { return mods.windows.openCapture; },
  get placePanel() { return mods.windows.placePanel; },
  get openPanel() { return mods.windows.openPanel; },
  get togglePanel() { return mods.windows.togglePanel; },
  get trayIcon() { return mods.tray.trayIcon; },
  get trayBase() { return mods.tray.trayBase; },
  set trayBase(v) { mods.tray.trayBase = v; },
  get lastTrayKey() { return mods.tray.lastTrayKey; },
  set lastTrayKey(v) { mods.tray.lastTrayKey = v; },
  get hexRgb() { return mods.tray.hexRgb; },
  get trayIconWith() { return mods.tray.trayIconWith; },
  get updateTrayIcon() { return mods.tray.updateTrayIcon; },
  get forceShowPet() { return mods.tray.forceShowPet; },
  get presentSnoozeUntil() { return mods.tray.presentSnoozeUntil; },
  set presentSnoozeUntil(v) { mods.tray.presentSnoozeUntil = v; },
  get buildTray() { return mods.tray.buildTray; },
  get resetPosition() { return mods.tray.resetPosition; },
  get setAutoStart() { return mods.tray.setAutoStart; },
  get guardIpc() { return mods.ipc.guardIpc; },
  get setupIpc() { return mods.ipc.setupIpc; },
  get SAFE() { return mods.safemode.SAFE; },
  set SAFE(v) { mods.safemode.SAFE = v; },
  get bootFile() { return mods.safemode.bootFile; },
  get readBoot() { return mods.safemode.readBoot; },
  get writeBoot() { return mods.safemode.writeBoot; },
  get latestBackup() { return mods.safemode.latestBackup; },
  get checkSafeMode() { return mods.safemode.checkSafeMode; },
};
mods.usagewatch = require('./src/main/usagewatch')(M);
mods.petcare = require('./src/main/petcare')(M);
mods.agenda = require('./src/main/agenda')(M);
mods.wellbeing = require('./src/main/wellbeing')(M);
mods.watcher = require('./src/main/watcher')(M);
mods.commands = require('./src/main/commands')(M);
mods.pro = require('./src/main/pro')(M);
mods.windows = require('./src/main/windows')(M);
mods.tray = require('./src/main/tray')(M);
mods.ipc = require('./src/main/ipc')(M);
mods.safemode = require('./src/main/safemode')(M);
mods.audio = require('./src/main/audio')(M);
// Escucha de audio (¿música o voz?): sus funciones también van en M.
for (const k of ['audioStart', 'audioStop', 'audioOnMedia', 'audioVerdict', 'setupAudioCapture', 'isAudioPage']) Object.defineProperty(M, k, { get: () => mods.audio[k] });
Object.defineProperty(M, 'audioState', { get: () => mods.audio.audioState });
// Tickets del equipo y cola de Claude que se ejecuta sola; avisos al canal y al celular.
mods.work = require('./src/main/work')(M);
mods.remote = require('./src/main/remote')(M);
M.work = mods.work;
mods.team = require('./src/main/team')(M);
M.team = mods.team;
mods.presence = require('./src/main/presence')(M);
M.presence = mods.presence;
mods.whereami = require('./src/main/whereami')(M);
M.whereami = mods.whereami;
mods.coach = require('./src/main/coach')(M);
M.coach = mods.coach;
mods.farm = require('./src/main/teamfarm')(M);
M.farm = mods.farm;
mods.errreport = require('./src/main/errreport')(M);
M.errreport = mods.errreport;
mods.boot = require('./src/main/boot')(M);
M.remote = mods.remote;

// → src/main/boot.js (arranque: datos, ventanas, módulos y temporizadores)
app.whenReady().then(() => mods.boot.boot());

app.on('second-instance', () => M.openPanel('chat'));
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', () => {
  quitting = true;
  M.writeBoot({ pending: false, fails: 0, at: Date.now() });
  if (store) try { M.syncNow(false); } catch { /* al cerrar, sin drama */ }
  if (stopFocus) stopFocus();
  if (mods.remote) mods.remote.stopPolling();
  if (store) {
    M.markStopped(quitHow || 'user');
    store.flush();
  }
});
// Con este oyente, cerrar todas las ventanas no cierra la app (el pollito vive en la bandeja).
// (El evento no trae argumentos: antes se llamaba a e.preventDefault() y habría fallado.)
app.on('window-all-closed', () => {});

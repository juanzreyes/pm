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
app.setPath('userData', path.join(app.getPath('appData'), 'pm-pollito'));
diag.init(app.getPath('userData'));
// Errores de consola de cualquier ventana → pm-errors.log
app.on('browser-window-created', (_e, w) => diag.watch(w, () => {
  try { return path.basename(new URL(w.webContents.getURL()).pathname, '.html') || 'ventana'; } catch { return 'ventana'; }
}));

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
let prevSession = null;
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

// ---------- correo y agenda ----------
let mailState = { status: 'off' };
let calState = { status: 'off', events: [] };
let meetingNow = null; // { app, title, since }
const reminded = new Set();

function mailConfig() {
  const m = store.data.settings.mail;
  return m && m.user && m.passEnc ? m : null;
}

// ----- cuentas con inicio de sesión web (Microsoft / Google) -----
function oauthConfig() {
  for (const f of ['oauth.config.json', 'oauth.config.example.json']) {
    try {
      return JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    } catch { /* prueba el siguiente */ }
  }
  return {};
}
function oauthReady() {
  const c = oauthConfig();
  return {
    microsoft: !!(c.microsoft && c.microsoft.clientId),
    google: !!(c.google && c.google.clientId && c.google.clientSecret),
  };
}
const accountIo = {
  cfg: (provider) => oauthConfig()[provider] || {},
  encrypt,
  decrypt,
  save: () => store.save(),
};
function connectedAccounts() {
  return Object.values(store.data.settings.accounts || {}).filter((a) => a && a.refreshEnc);
}
const PROVIDER_LABEL = { microsoft: 'Microsoft', google: 'Google' };
const accountErrors = {}; // provider -> mensaje

async function refreshMail(announce = false) {
  const sources = connectedAccounts().map((acc) => ({
    label: acc.email || PROVIDER_LABEL[acc.provider],
    provider: acc.provider,
    run: () => accounts.mailOf(acc, accountIo),
  }));
  const cfg = mailConfig();
  if (cfg) sources.push({ label: cfg.user, provider: 'imap', run: () => mail.check({ host: cfg.host, port: cfg.port, user: cfg.user, pass: decrypt(cfg.passEnc) }) });
  if (!sources.length) { mailState = { status: 'off' }; broadcast(); return mailState; }

  let unseen = 0;
  let recent = [];
  const errors = [];
  let ok = 0;
  for (const s of sources) {
    try {
      const r = await s.run();
      ok++;
      unseen += r.unseen;
      recent.push(...r.recent.map((m) => ({ ...m, account: s.label })));
      if (s.provider !== 'imap') delete accountErrors[s.provider];
    } catch (e) {
      errors.push({ label: s.label, error: e.message });
      if (s.provider !== 'imap') accountErrors[s.provider] = e.message;
    }
  }
  recent.sort((a, b) => (b.date || 0) - (a.date || 0));

  if (ok) {
    const known = new Set(store.data.mailSeen || []);
    const fresh = recent.filter((m) => !known.has(m.uid));
    // La primera vez solo memoriza; después avisa de los nuevos.
    if (store.data.mailSeen && fresh.length && !isMuted() && !meetingNow) {
      const m = fresh[0];
      const more = fresh.length > 1 ? ` (y ${fresh.length - 1} más)` : '';
      say(`📧 Correo nuevo de ${m.from}: "${m.subject.slice(0, 60)}"${more}`, 'flap', 10000);
    }
    store.data.mailSeen = [...new Set([...(store.data.mailSeen || []), ...recent.map((m) => m.uid)])].slice(-300);
    store.save();
  }
  mailState = { status: ok ? 'ok' : 'error', unseen, recent: recent.slice(0, 8), errors, error: errors.map((e) => `${e.label}: ${e.error}`).join(' · '), at: Date.now() };
  if (announce && ok) say(`¡Correo conectado! 📬 Tienes ${unseen} sin leer.`, 'celebrate', 8000);
  broadcast();
  return mailState;
}

async function refreshCalendar(announce = false) {
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = from.getTime() + 3 * 864e5;
  const sources = connectedAccounts().map((acc) => ({
    label: acc.email || PROVIDER_LABEL[acc.provider],
    provider: acc.provider,
    run: () => accounts.eventsOf(acc, accountIo, from.getTime(), to),
  }));
  const url = decrypt(store.data.settings.calendarUrl);
  if (url) sources.push({ label: 'Calendario ICS', provider: 'ics', run: () => calendar.load(url, from.getTime(), to) });
  if (!sources.length) { calState = { status: 'off', events: [] }; broadcast(); return calState; }

  const events = [];
  const errors = [];
  let ok = 0;
  for (const s of sources) {
    try {
      events.push(...(await s.run()));
      ok++;
      if (s.provider !== 'ics') delete accountErrors[s.provider];
    } catch (e) {
      errors.push({ label: s.label, error: e.message });
      if (s.provider !== 'ics') accountErrors[s.provider] = e.message;
    }
  }
  // Quita duplicados (la misma reunión en dos calendarios).
  const seen = new Set();
  const merged = events.sort((a, b) => a.start - b.start).filter((e) => {
    const k = `${e.title.trim().toLowerCase()}|${e.start}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  calState = ok
    ? { status: 'ok', events: merged, errors, error: errors.map((e) => `${e.label}: ${e.error}`).join(' · '), at: Date.now() }
    : { ...calState, status: 'error', errors, error: errors.map((e) => `${e.label}: ${e.error}`).join(' · '), at: Date.now() };
  if (announce && ok) {
    const n = todaysMeetings().length;
    say(`¡Agenda conectada! 📅 Hoy tienes ${n} reunion${n === 1 ? '' : 'es'}.`, 'celebrate', 8000);
  }
  broadcast();
  return calState;
}

function todaysMeetings() {
  const end = new Date(); end.setHours(23, 59, 59, 999);
  return (calState.events || []).filter((e) => !e.allDay && e.end > Date.now() - 3600e3 && e.start <= end.getTime());
}

function currentEvent() {
  const now = Date.now();
  return (calState.events || []).find((e) => !e.allDay && e.start <= now && e.end > now);
}

function joinMeeting(url) {
  if (url && /^https:\/\/([\w.-]+\.)?(teams\.microsoft\.com|teams\.live\.com|meet\.google\.com|zoom\.us|webex\.com)\//i.test(url)) {
    shell.openExternal(url);
    return true;
  }
  return false;
}

// Avisos de reunión: 10 min antes y al empezar (con botón para unirte).
function meetingReminders() {
  const now = Date.now();
  for (const e of calState.events || []) {
    if (e.allDay) continue;
    const mins = (e.start - now) / 60000;
    const where = e.join ? ` en ${e.join.platform}` : '';
    if (mins <= 10 && mins > 2 && !reminded.has(e.id + '|10')) {
      reminded.add(e.id + '|10');
      say(`📅 En ${Math.round(mins)} min: "${e.title}"${where}. ¡Prepárate! 🎧`, 'alarm-soft', 12000, {
        actions: e.join && e.join.url ? [{ label: '🎧 Unirme', cmd: 'open.url', arg: e.join.url }, { label: '👍 Ok', cmd: 'ack' }] : undefined,
      });
      pushChat('pet', `📅 En ${Math.round(mins)} min tienes "${e.title}"${where}.`);
    }
    if (mins <= 1 && mins > -5 && !reminded.has(e.id + '|0')) {
      reminded.add(e.id + '|0');
      say(`🎧 ¡Ya empieza "${e.title}"!`, 'alarm', 20000, {
        actions: e.join && e.join.url ? [{ label: '🎧 Unirme ahora', cmd: 'open.url', arg: e.join.url }] : undefined,
      });
      if (Notification.isSupported()) {
        const n = new Notification({
          title: `🎧 Empieza: ${e.title}`,
          body: e.join && e.join.url ? `Clic para unirte en ${e.join.platform}` : e.location || 'Tu reunión está empezando',
        });
        if (e.join && e.join.url) n.on('click', () => joinMeeting(e.join.url));
        n.show();
      }
    }
  }
}

function previousStandup() {
  const keys = Object.keys(store.data.days).filter((k) => k < dayKey() && store.data.days[k].standup).sort();
  const k = keys[keys.length - 1];
  return k ? { date: k, ...store.data.days[k] } : null;
}

function snapshot() {
  const ps = prod ? prod.snapshot() : {};
  const s = { ...store.data.settings };
  s.hasManualToken = !!s.manualToken;
  // Los secretos nunca salen del proceso principal.
  s.hasAiKey = !!s.aiKey;
  s.hasGithubToken = !!s.githubToken;
  for (const k of ['manualToken', 'aiKey', 'githubToken', 'calendarUrl', 'accounts']) delete s[k];
  if (s.mail) s.mail = { provider: s.mail.provider, user: s.mail.user };
  const recent = {};
  Object.keys(store.data.days).sort().slice(-14).forEach((k) => (recent[k] = store.data.days[k]));
  return {
    pet: store.data.pet,
    settings: s,
    usage,
    todayKey: dayKey(),
    today: store.data.days[dayKey()] || {},
    days: recent,
    previous: previousStandup(),
    chat: store.data.chat.slice(-60),
    autoStart: app.getLoginItemSettings().openAtLogin,
    life: { angryUntil: store.data.life.angryUntil, closes: store.data.life.closes, crashes: store.data.life.crashes, lastView: store.data.life.lastView },
    web: { connected: !!store.data.web.orgId, orgName: store.data.web.orgName },
    focusNow: { cat: fx.cat, label: fx.label, scoldLevel: fx.scoldLevel },
    level: levelInfo(store.data.pet.xp || 0),
    stage: gami.stageOf(levelInfo(store.data.pet.xp || 0).level),
    coins: Math.floor(store.data.pet.coins || 0),
    streaks: gami.streaks(store.data),
    achievements: gami.ACHIEVEMENTS.map((a) => {
      const got = (store.data.pet.achievements || []).find((x) => x.id === a.id);
      return { id: a.id, emoji: a.emoji, name: a.name, desc: a.desc, reward: a.reward, at: got ? got.at : null };
    }),
    shop: gami.SHOP.map((x) => ({
      ...x,
      owned: (store.data.pet.owned || []).includes(x.id),
      equipped: (store.data.pet.equipped || {})[x.slot] === x.id,
    })),
    equipped: store.data.pet.equipped || {},
    lang: lang(),
    ai: {
      hasKey: !!store.data.settings.aiKey,
      model: store.data.settings.aiModel || aiMod.DEFAULT_MODEL,
      models: aiMod.MODELS,
      enabled: store.data.settings.aiEnabled !== false,
    },
    monitors: (store.data.settings.monitors || []).map((m) => ({ ...m, state: monitorState[m.id] || null })),
    presenting: presenting ? presenting.reason : null,
    autoHide: store.data.settings.autoHide !== false,
    version: app.getVersion(),
    packaged: app.isPackaged,
    dark: isDark(),
    inbox: (store.data.inbox || []).slice(-100).reverse(),
    unread: (store.data.inbox || []).filter((x) => !x.read && x.cat !== 'pet').length,
    trackingPausedUntil: trackingPaused() ? store.data.settings.trackingPausedUntil : 0,
    flags: store.data.flags || {},
    checklist: checklist(ps.claudeCode && ps.claudeCode.installed),
    estimates: estimateStats(),
    dataDir: app.getPath('userData'),
    muted: isMuted(),
    mail: {
      ...mailState,
      configured: !!mailConfig() || connectedAccounts().length > 0,
      imap: !!mailConfig(),
      user: mailConfig() ? mailConfig().user : '',
      provider: mailConfig() ? mailConfig().provider : '',
    },
    calendar: { ...calState, configured: !!store.data.settings.calendarUrl || connectedAccounts().length > 0, ics: !!store.data.settings.calendarUrl },
    accounts: connectedAccounts().map((a) => ({ provider: a.provider, email: a.email, error: accountErrors[a.provider] || null })),
    oauthReady: oauthReady(),
    meetingNow,
    ...ps,
    ...(ex ? ex.snapshot() : {}),
    focusMode: focusMode(),
    focusUntil: store.data.focusUntil > Date.now() ? store.data.focusUntil : 0,
    presets: Object.fromEntries(Object.entries(mail.PRESETS).map(([k, v]) => [k, { label: v.label, host: v.host, port: v.port, help: v.help }])),
  };
}

// ---------- bienestar: señales de agotamiento (últimos 7 días) ----------
function wellbeingSignals() {
  const pad2 = (n) => String(n).padStart(2, '0');
  const signals = [];
  let longDays = 0, lateDays = 0, weekendWork = 0, workTotal = 0;
  const moods = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const v = store.data.days[`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`];
    if (!v) continue;
    const w = (v.focus && v.focus.work) || 0;
    workTotal += w;
    if (w > 8 * 3600) longDays++;
    if ((v.lateWork || 0) > 30 * 60) lateDays++;
    if ((d.getDay() === 0 || d.getDay() === 6) && w > 2 * 3600) weekendWork++;
    if (v.mood) moods.push(v.mood);
  }
  const avgMood = moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : null;
  if (longDays >= 3) signals.push(`${longDays} días de más de 8 h de trabajo`);
  if (lateDays >= 2) signals.push(`${lateDays} noches trabajando después de las 22:00`);
  if (weekendWork) signals.push('trabajaste el fin de semana');
  if (avgMood !== null && moods.length >= 3 && avgMood <= 2.4) signals.push('tu ánimo ha estado bajo');
  return { signals, workHours: workTotal / 3600, avgMood };
}
// ---------- cumpleaños del pollito (aniversario del día en que nació) ----------
function checkBirthday() {
  const p = store.data.pet;
  if (!p.born || !p.name) return;
  const b = new Date(p.born), n = new Date();
  const years = n.getFullYear() - b.getFullYear();
  if (years < 1 || b.getMonth() !== n.getMonth() || b.getDate() !== n.getDate() || p.lastBirthday === n.getFullYear()) return;
  p.lastBirthday = n.getFullYear();
  p.coins = (p.coins || 0) + 50;
  p.happiness = 100;
  store.save();
  addXp(30);
  say(`🎂 ¡HOY CUMPLO ${years} AÑO${years === 1 ? '' : 'S'}! 🎉 Gracias por cuidarme todo este tiempo 💛 (+50 🌽)`, 'celebrate', 15000, { cat: 'pet' });
  broadcast();
}

function checkWellbeing() {
  const day = today();
  const h = new Date().getHours();
  if (day.wellbeingChecked || h < 10 || h >= 20 || isMuted() || meetingNow) return;
  day.wellbeingChecked = true;
  store.save();
  const w = wellbeingSignals();
  if (w.signals.length < 2 && !(w.avgMood !== null && w.avgMood <= 2)) return;
  say(`💛 Oye, te vengo notando cansado: ${w.signals.join(', ')}. ¿Qué tal si hoy cierras a tu hora y te tomas pausas de verdad? Tu salud va primero. 🫂`, 'hug', 20000, {
    cat: 'health', actions: [{ label: '💛 Gracias', cmd: 'ack' }, { label: '📈 Ver estadísticas', cmd: 'stats' }],
  });
}

// ---------- tus patrones (insights de los últimos 14 días) ----------
function insights() {
  const pad2 = (n) => String(n).padStart(2, '0');
  const out = [];
  const byHour = Array.from({ length: 24 }, () => ({ w: 0, d: 0 }));
  const byDow = Array.from({ length: 7 }, () => ({ w: 0, d: 0, n: 0 }));
  const DOW = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
  for (let i = 0; i < 14; i++) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const v = store.data.days[`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`];
    if (!v) continue;
    for (const [h, x] of Object.entries(v.hours || {})) { byHour[h].w += x.w || 0; byHour[h].d += x.d || 0; }
    if (v.focus) { const b = byDow[d.getDay()]; b.w += v.focus.work || 0; b.d += v.focus.distraction || 0; b.n++; }
  }
  // Mejor franja de 2 horas.
  let best = -1, bestH = 0;
  for (let h = 6; h < 22; h++) { const s = byHour[h].w + byHour[h + 1].w; if (s > best) { best = s; bestH = h; } }
  if (best > 3 * 3600) out.push(`🔥 Tu mejor franja es de ${bestH}:00 a ${bestH + 2}:00: ahí conviene tu pomodoro más difícil.`);
  // Día con más distracción (proporción).
  const ratios = byDow.map((b, i) => ({ i, r: b.w + b.d > 3600 ? b.d / (b.w + b.d) : null })).filter((x) => x.r !== null);
  if (ratios.length >= 3) {
    const worst = ratios.reduce((a, b) => (b.r > a.r ? b : a));
    const avg = ratios.reduce((a, b) => a + b.r, 0) / ratios.length;
    if (worst.r > avg * 1.4 && worst.r > 0.1) out.push(`🙈 Los ${DOW[worst.i]} te distraes más (${Math.round(worst.r * 100)}% del tiempo).`);
    const top = byDow.map((b, i) => ({ i, w: b.n ? b.w / b.n : 0 })).reduce((a, b) => (b.w > a.w ? b : a));
    if (top.w > 3600) out.push(`💪 Tu día más productivo suele ser el ${DOW[top.i].replace(/s$/, '')} (${(top.w / 3600).toFixed(1)} h de media).`);
  }
  const est = estimateStats();
  if (est.ratio) out.push(est.ratio > 1.15 ? `⏱️ Sueles tardar ${est.ratio.toFixed(1)}× lo que estimas.` : est.ratio < 0.85 ? '⏱️ Terminas antes de lo que estimas.' : '⏱️ Estimas muy bien tus tareas.');
  const w = wellbeingSignals();
  if (w.avgMood) out.push(`${w.avgMood >= 4 ? '😄' : w.avgMood >= 3 ? '🙂' : '😕'} Tu ánimo medio esta semana: ${w.avgMood.toFixed(1)}/5.`);
  if (!out.length) out.push('🌱 Aún estoy aprendiendo de ti: en unos días te mostraré tus patrones.');
  return out;
}

// ---------- precisión de tus estimaciones (últimos 30 días) ----------
function estimateStats() {
  let est = 0, spent = 0, n = 0;
  const cutoff = Date.now() - 30 * 864e5;
  for (const [k, d] of Object.entries(store.data.days || {})) {
    if (Date.parse(k) < cutoff) continue;
    for (const t of (d.standup && d.standup.today) || []) {
      const s = (t.spent || 0) + (t.startedAt ? (Date.now() - t.startedAt) / 1000 : 0);
      if (t.done && t.est && s >= 60) { est += t.est * 60; spent += s; n++; }
    }
  }
  return n >= 3 ? { ratio: spent / est, samples: n } : { ratio: null, samples: n };
}

// ---------- "Configura tu pollito": lista de primeros pasos ----------
function checklist(hooksInstalled) {
  const d = store.data;
  const everDay = (fn) => Object.values(d.days || {}).some(fn);
  return [
    { id: 'name', label: 'Ponerme nombre', done: !!d.pet.name, cmd: 'panel.profile' },
    { id: 'claude', label: 'Conectar tu cuenta de Claude', done: usage.connection && usage.connection.status === 'ok', cmd: 'panel.usage' },
    { id: 'daily', label: 'Hacer tu primer daily', done: everDay((x) => x.standup), cmd: 'daily' },
    { id: 'pomo', label: 'Completar un pomodoro', done: everDay((x) => (x.pomodoros || 0) > 0), cmd: 'pomo.start' },
    { id: 'capture', label: 'Anotar algo con Ctrl+Alt+P', done: !!(d.flags && d.flags.usedCapture), cmd: 'capture' },
    { id: 'palette', label: 'Abrir la paleta con Ctrl+Alt+Espacio', done: !!(d.flags && d.flags.usedPalette), cmd: 'palette' },
    { id: 'hooks', label: 'Conectar Claude Code', done: !!hooksInstalled, cmd: 'settings.integrations' },
    { id: 'style', label: 'Comprarme un accesorio', done: (d.pet.owned || []).length > 0, cmd: 'panel.profile' },
  ];
}

// ---------- niveles (tamagotchi) ----------
const TITLES = [
  [1, 'Pollito becario'], [2, 'Pollito junior'], [3, 'Pollito semi-senior'], [5, 'Pollito senior'],
  [8, 'Gallo Tech Lead'], [12, 'Gallo Director'], [20, 'Gallo CEO 👑'],
];
function levelInfo(xp) {
  const level = 1 + Math.floor(xp / 100);
  let title = TITLES[0][1];
  for (const [l, t] of TITLES) if (level >= l) title = t;
  return { level, title, xp, into: xp % 100, next: 100 };
}
function addXp(n) {
  const p = store.data.pet;
  const before = levelInfo(p.xp || 0).level;
  p.xp = (p.xp || 0) + n;
  p.coins = (p.coins || 0) + n; // cada XP también da 1 maíz 🌽 para la tienda
  const after = levelInfo(p.xp);
  store.save();
  if (after.level > before) {
    const evolved = gami.stageOf(after.level).id !== gami.stageOf(before).id;
    setTimeout(() => {
      if (evolved) {
        say(`✨ ¡EVOLUCIONÉ! ✨ Ahora soy un ${gami.stageOf(after.level).name} (nivel ${after.level}) 🎉`, 'hatch', 12000);
      } else {
        say(`¡SUBÍ A NIVEL ${after.level}! 🎉 Ahora soy ${after.title}${after.level === 3 ? ' (¡con corbatín!)' : after.level === 8 ? ' (¡con corona!)' : ''}`, 'celebrate', 10000);
      }
      pushChat('pet', `¡Nivel ${after.level}: ${after.title}! 🎉`);
      broadcast();
      checkAchievements();
    }, 2500);
  }
}

// ---------- logros ----------
function achievementCtx() {
  return {
    data: store.data,
    level: levelInfo(store.data.pet.xp || 0).level,
    streaks: gami.streaks(store.data),
    chatCount: store.data.chatSent || 0,
  };
}
function checkAchievements() {
  const p = store.data.pet;
  const have = new Set((p.achievements || []).map((a) => a.id));
  const ctx = achievementCtx();
  const fresh = gami.ACHIEVEMENTS.filter((a) => !have.has(a.id) && (() => { try { return a.test(ctx); } catch { return false; } })());
  if (!fresh.length) return;
  p.achievements = [...(p.achievements || []), ...fresh.map((a) => ({ id: a.id, at: Date.now() }))];
  for (const a of fresh) p.coins = (p.coins || 0) + a.reward;
  store.save();
  // Uno a uno, con un respiro entre ellos.
  fresh.forEach((a, i) => setTimeout(() => {
    say(`🏅 ¡Logro desbloqueado! ${a.emoji} ${a.name} — ${a.desc} (+${a.reward} 🌽)`, 'celebrate', 10000);
    pushChat('pet', `🏅 ${a.emoji} ${a.name} (+${a.reward} 🌽)`);
    notify(`🏅 ${a.name}`, a.desc);
  }, 3000 + i * 11000));
  broadcast();
}

// ---------- monitor de sitios ----------
async function checkMonitors(announce = true) {
  const list = store.data.settings.monitors || [];
  await Promise.all(list.map(async (m) => {
    const r = await monitor.check(m.url);
    const prev = monitorState[m.id];
    monitorState[m.id] = { ...r, checkedAt: Date.now(), since: prev && prev.up === r.up ? prev.since : Date.now() };
    if (announce && prev && prev.up !== r.up) {
      const name = m.name || new URL(m.url).host;
      if (r.up) {
        say(`🟢 ${name} volvió a funcionar (${r.ms} ms)`, 'celebrate', 9000);
        notify(`🟢 ${name}`, 'Vuelve a responder');
      } else {
        say(`🔴 ${name} está caído ${r.status ? `(HTTP ${r.status})` : `(${r.error || 'sin respuesta'})`} 😱`, 'alarm', 15000, {
          actions: [{ label: '🌐 Abrir', cmd: 'open.monitor', arg: m.id }],
        });
        notify(`🔴 ${name} está caído`, r.status ? `HTTP ${r.status}` : r.error || 'Sin respuesta', () => shell.openExternal(m.url));
      }
      pushChat('pet', `${r.up ? '🟢' : '🔴'} ${name}: ${r.up ? 'arriba' : 'caído'}`);
    }
  }));
  broadcast();
}

// ---------- estadísticas (30 días) ----------
function statsData() {
  const pad2 = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const days = [];
  for (let i = 34; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const k = keyOf(d);
    const v = store.data.days[k] || {};
    const t = (v.standup && v.standup.today) || [];
    const byDay = (usage.local && usage.local.byDay) || {};
    days.push({
      key: k,
      dow: d.getDay(),
      label: d.toLocaleDateString(lang() === 'en' ? 'en' : 'es', { day: 'numeric', month: 'short' }),
      work: (v.focus && v.focus.work) || 0,
      distraction: (v.focus && v.focus.distraction) || 0,
      done: t.filter((x) => x.done).length,
      planned: t.length,
      pomodoros: v.pomodoros || 0,
      commits: v.commits || 0,
      tokens: (byDay[k] && byDay[k].tokens) || 0,
      cost: (byDay[k] && byDay[k].cost) || 0,
      mood: v.mood || 0,
    });
  }
  const month = days.slice(-30);
  const projects = {};
  for (const x of month) for (const [p, s] of Object.entries((store.data.days[x.key] || {}).projects || {})) projects[p] = (projects[p] || 0) + s;
  return {
    days,
    projects: Object.entries(projects).sort((a, b) => b[1] - a[1]).slice(0, 7),
    insights: insights().map((x) => T(x)),
    totals: {
      hours: month.reduce((a, x) => a + x.work, 0) / 3600,
      pomodoros: month.reduce((a, x) => a + x.pomodoros, 0),
      commits: month.reduce((a, x) => a + x.commits, 0),
      streak: gami.streaks(store.data).daily,
    },
  };
}

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
  const meets = todaysMeetings().map((e) => `${new Date(e.start).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })} ${e.title}`);
  if (meets.length) L.push(`Reuniones de hoy: ${meets.join(' | ')}`);
  if (meetingNow) L.push(`Ahora está en una reunión (${meetingNow.app}).`);
  if (day.focus) L.push(`Enfoque hoy: trabajo ${Math.round(day.focus.work / 60)} min, distracciones ${Math.round(day.focus.distraction / 60)} min`);
  const pr = Object.entries(day.projects || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, s]) => `${k} ${Math.round(s / 60)} min`);
  if (pr.length) L.push(`Proyectos hoy: ${pr.join(', ')}`);
  if (prod && prod.pomoState()) L.push(`Pomodoro en curso (${prod.pomoState().phase}).`);
  L.push(`Mascota: nivel ${levelInfo(store.data.pet.xp || 0).level}, felicidad ${Math.round(store.data.pet.happiness)}, pancita ${Math.round(store.data.pet.fullness)}, maíz ${Math.floor(store.data.pet.coins || 0)}`);
  L.push(`Racha de dailies: ${gami.streaks(store.data).daily} días`);
  L.push(`Patrones del usuario: ${insights().join(" ")}`);
  const wb = wellbeingSignals();
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
  return L.join('\n');
}

// ---------- modo presentación: el pollito se esconde ----------
let lastPresentApp = '';
function handlePresenting(reason) {
  const now = Date.now();
  if (reason && Date.now() < presentSnoozeUntil && reason !== 'Compartiendo pantalla en Teams') reason = null;
  if (reason && store.data.settings.autoHide !== false) {
    presentQuietSince = 0;
    if (!presenting) {
      presenting = { reason, petWasVisible: !!(petWin && petWin.isVisible()), since: now, app: lastPresentApp };
      if (petWin) petWin.hide();
      if (tray) { tray.setToolTip(`PM · escondido: ${reason}`); tray.refreshMenu && tray.refreshMenu(); }
      diag.log('info', `Me escondí: ${reason} (${lastPresentApp || '?'})`);
      if (panelWin) panelWin.hide();
      if (captureWin && !captureWin.isDestroyed()) captureWin.hide();
      broadcast();
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
  broadcast();
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
  checkAchievements();
  return { ok: true };
}
function equipItem(id) {
  const item = gami.SHOP.find((x) => x.id === id);
  const p = store.data.pet;
  if (!item || !(p.owned || []).includes(id)) return { ok: false, error: 'Aún no lo tienes.' };
  p.equipped = { ...(p.equipped || {}), [item.slot]: id };
  store.save();
  broadcast();
  animate('flap');
  return { ok: true };
}
function unequipSlot(slot) {
  const p = store.data.pet;
  p.equipped = { ...(p.equipped || {}) };
  delete p.equipped[slot];
  store.save();
  broadcast();
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
  broadcast();
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
  broadcast();
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
  broadcast();
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

// ---------- vigilante de distracciones ----------
function sendMeeting() {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('pet:meeting', meetingNow);
  broadcast();
}

// Reunión/llamada en curso (micrófono en uso o ventana de reunión de Teams).
function handleMeeting(mt) {
  const now = Date.now();
  if (mt) {
    if (!meetingNow) {
      const ev = currentEvent();
      meetingNow = { app: mt.app, title: mt.title || (ev ? ev.title : ''), since: now, lastSeen: now };
      const what = meetingNow.title ? `"${meetingNow.title}"` : 'una reunión';
      say(`🎧 Estás en ${what} (${mt.app}). Me pongo los audífonos y me quedo calladito 🤫`, null, 7000);
      sendMeeting();
    }
    meetingNow.lastSeen = now;
  } else if (meetingNow && now - meetingNow.lastSeen > 30000) {
    const mins = Math.round((now - meetingNow.since) / 60000);
    const ended = meetingNow;
    meetingNow = null;
    sendMeeting();
    if (mins >= 3) {
      addXp(5);
      const day = today();
      day.meetings = [...(day.meetings || []), { title: ended.title || ended.app, mins }];
      store.save();
      say(`¡Reunión terminada! (${mins} min) 📝 ¿Salió alguna tarea? Añádela en 📋 Día o pulsa Ctrl+Alt+P.`, 'hop', 10000);
    }
  }
}

function onFocusSample(s) {
  let pres = focus.presentingFrom(s);
  if (pres && pres !== 'Compartiendo pantalla en Teams' && (store.data.settings.noHideApps || []).includes(String(s.p || '').toLowerCase())) pres = null;
  lastPresentApp = String(s.p || '').toLowerCase();
  // Pantalla completa en OTRO monitor: el pollito no estorba, no hace falta esconderlo.
  if (pres === 'Pantalla completa' || pres === 'Presentación de PowerPoint') {
    try {
      const [l, t, r, b] = String(s.f).split(',').map(Number);
      const center = screen.screenToDipPoint({ x: Math.round((l + r) / 2), y: Math.round((t + b) / 2) });
      const fsDisplay = screen.getDisplayNearestPoint(center);
      if (petWin && screen.getDisplayMatching(petWin.getBounds()).id !== fsDisplay.id) pres = null;
    } catch { /* si falla la cuenta, mejor esconderse */ }
  }
  handlePresenting(pres);
  // Privacidad: con el seguimiento en pausa no se registra ni se analiza nada.
  if (trackingPaused()) return;
  if (store.data.settings.micWatch === false) s = { ...s, m: '' };
  handleMeeting(focus.meetingFrom(s));
  const now = Date.now();
  const dt = fx.lastSampleAt ? Math.min((now - fx.lastSampleAt) / 1000, 15) : 5;
  if (!store.data.settings.focusWatch) {
    fx.lastSampleAt = now;
    if (prod) prod.onSample(s, null, 0); // la salud funciona aunque no vigile distracciones
    return;
  }
  fx.lastSampleAt = now;
  const day = today();
  let c = meetingNow ? { cat: 'work', label: 'Reunión' } : focus.classify(s);
  // Lo que le dijiste que es trabajo hoy ("es trabajo") cuenta como trabajo.
  if (c.cat === 'distraction' && day.focusAllow && day.focusAllow[c.label]) c = { cat: 'work', label: c.label };
  fx.cat = c.cat;
  fx.label = c.label;

  const f = day.focus || (day.focus = { work: 0, distraction: 0, neutral: 0, idle: 0, apps: {} });
  const hoursBefore = Math.floor((f.work || 0) / 3600);
  f[c.cat] = (f[c.cat] || 0) + dt;
  if (c.cat === 'distraction') f.apps[c.label] = (f.apps[c.label] || 0) + dt;
  // Por horas (para "tus patrones") y trabajo nocturno (para cuidar el agotamiento).
  const hr = new Date().getHours();
  if (c.cat === 'work' || c.cat === 'distraction') {
    day.hours = day.hours || {};
    const hb = day.hours[hr] || (day.hours[hr] = { w: 0, d: 0 });
    if (c.cat === 'work') hb.w += dt; else hb.d += dt;
  }
  if (c.cat === 'work' && (hr >= 22 || hr < 6)) day.lateWork = (day.lateWork || 0) + dt;
  if (Math.floor(f.work / 3600) > hoursBefore) {
    addXp(10);
    if (!isMuted()) say(`¡${Math.floor(f.work / 3600)} h de trabajo enfocado hoy! 💪 +10 XP`, 'dance', 7000);
  }

  if (prod) prod.onSample(s, c.cat, dt); // tiempo por proyecto + salud

  const pomoFocus = !!(prod && prod.isPomoFocus());
  const work = (inWorkHours() || pomoFocus || !!focusMode()) && !isMuted() && !meetingNow;
  const step = focusMode() ? 1 : prod ? prod.scoldStep() : 10;

  // Racha de distracción: regaña a los 10, 20, 30… minutos (cada 2 min durante un pomodoro).
  if (c.cat === 'distraction') {
    if (!fx.distractSince) { fx.distractSince = now; fx.scoldLevel = 0; }
    fx.lastDistractAt = now;
    fx.workSince = null;
    const mins = Math.floor((now - fx.distractSince) / 60000);
    if (work && mins >= step * (fx.scoldLevel + 1)) {
      fx.scoldLevel++;
      fx.scolded = true;
      const m = brain.scold(c.label, mins, fx.scoldLevel, firstPending());
      if (pomoFocus) m.text = '🍅 ¡Estamos en pomodoro! ' + m.text;
      else if (focusMode()) m.text = '🎯 ¡Estás en modo foco! ' + m.text;
      say(m.text, m.anim, 11000);
      pushChat('pet', m.text);
      store.data.pet.happiness = clamp(store.data.pet.happiness - 3);
    }
  } else if (fx.distractSince && now - fx.lastDistractAt > 60000) {
    // Dejó la distracción. Si lo regañé y vuelve a trabajar, lo felicito.
    if (fx.scolded && c.cat === 'work') {
      if (!fx.workSince) fx.workSince = now;
      if (now - fx.workSince >= 90000) {
        say(brain.backToWork(), 'dance', 7000);
        fx.scolded = false;
        fx.distractSince = null;
        fx.scoldLevel = 0;
      }
    } else if (!fx.scolded || now - fx.lastDistractAt > 10 * 60000) {
      fx.distractSince = null;
      fx.scoldLevel = 0;
      fx.scolded = false;
    }
  }

  // Inactividad
  if (c.cat === 'idle') {
    if (!fx.idleSince) fx.idleSince = now - s.i * 1000;
    if (work && !fx.idleNotified && now - fx.idleSince >= 20 * 60000) {
      fx.idleNotified = true;
      say('¿Hola? ¿Sigues ahí? 👀 Llevas 20 min sin tocar nada…', 'sad', 12000);
    }
  } else if (fx.idleSince) {
    if (fx.idleNotified && work) say(`¡Volviste! Estuviste ${brain.fmtDur((now - fx.idleSince) / 1000)} fuera 👀`, 'hop', 8000);
    fx.idleSince = null;
    fx.idleNotified = false;
  }

  // Gestos del pollito según lo que estás haciendo.
  const payload = { cat: c.cat, label: c.label, scoldLevel: fx.scoldLevel, idle: s.i };
  const key = `${c.cat}|${fx.scoldLevel}|${s.i > 300}`;
  if (key !== fx.sentKey && petWin && !petWin.isDestroyed()) {
    fx.sentKey = key;
    petWin.webContents.send('pet:focus', payload);
  }
}

let broadcastTimer = null;
function broadcast() {
  // Agrupa varios cambios seguidos en un solo envío (evita trabajo repetido).
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    const snap = snapshot();
    for (const w of [petWin, panelWin, settingsWin, paletteWin]) if (w && !w.isDestroyed()) w.webContents.send('state', snap);
  }, 16);
}

// ---------- categorías y botones de los avisos ----------
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
  if (!petWin || petWin.isDestroyed()) return;
  const raw = String(text);
  const cat = opts.cat || inferCat(raw);
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
  if (store.data.settings.discreet) peekPet(Math.max(ms || 7000, actions.length ? 20000 : 0) + 800);
  // Voz: solo para avisos importantes (reuniones, recordatorios, Claude te necesita, sitios caídos, límite).
  const speak = store.data.settings.voice !== false && !isMuted() && (
    ((cat === 'meeting' || cat === 'reminder' || cat === 'monitor') && !/^(🟢)/.test(raw)) ||
    (cat === 'claude' && /(necesita|esperando)/.test(raw)) ||
    (cat === 'usage' && /(Alerta|100%|🔮)/.test(raw)));
  petWin.webContents.send('pet:say', { text, anim, ms: actions.length ? Math.max(ms || 0, 20000) : ms, quiet: !!opts.quiet, actions, speak, lang: lang(), target });
  broadcast();
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
  n.on('click', onClick || (() => openPanel('inbox')));
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
  broadcast();
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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.setVisibleOnAllWorkspaces(true);
  petWin.setIgnoreMouseEvents(true, { forward: true });
  petWin.loadFile(path.join(__dirname, 'renderer', 'pet.html'));
  petWin.on('closed', () => (petWin = null));
}

function createPanel() {
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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  panelWin.setAlwaysOnTop(true, 'screen-saver');
  panelWin.loadFile(path.join(__dirname, 'renderer', 'panel.html'));
  panelWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      panelWin.hide();
    }
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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' },
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
        say(`🎁 ¡Hay una versión nueva (${info.version})! Se instalará cuando cierres PM.`, 'celebrate', 12000);
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
    const noServer = /app-update\.yml|ENOENT|publish/i.test(e.message);
    return { ok: false, error: noServer ? 'No hay servidor de actualizaciones configurado (ver README → Publicar actualizaciones).' : e.message };
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
  return (calState.events || []).find((e) => e.join && e.join.url && !e.allDay && e.end > now && e.start - now < 15 * 60000);
}

function trackingPaused() {
  return (store.data.settings.trackingPausedUntil || 0) > Date.now();
}
function pauseTracking(minutes) {
  store.data.settings.trackingPausedUntil = minutes ? Date.now() + minutes * 60000 : 0;
  fx.cat = null; fx.distractSince = null; fx.sentKey = '';
  sendPet('pet:focus', { cat: null, scoldLevel: 0, idle: 0 });
  store.save();
  broadcast();
}

const COMMANDS = [
  { id: 'panel.chat', icon: '💬', label: 'Abrir el chat', kw: 'chat hablar preguntar', run: () => openPanel('chat') },
  { id: 'panel.usage', icon: '📊', label: 'Ver mi consumo de Claude', kw: 'uso limite tokens cuanto llevo reinicio', run: () => openPanel('usage') },
  { id: 'panel.day', icon: '📋', label: 'Ver mi día y tareas', kw: 'dia tareas pendientes', run: () => openPanel('day') },
  { id: 'panel.agenda', icon: '📬', label: 'Ver agenda, correo y GitHub', kw: 'agenda reuniones correo github sitios', run: () => openPanel('agenda') },
  { id: 'panel.profile', icon: '🐣', label: 'Ver mascota, logros y tienda', kw: 'perfil mascota logros tienda accesorios', run: () => openPanel('pet') },
  { id: 'inbox', icon: '🔔', label: 'Centro de avisos', kw: 'avisos notificaciones historial', run: () => openPanel('inbox') },
  { id: 'pomo.start', icon: '🍅', label: 'Empezar pomodoro (25 min)', kw: 'pomodoro enfoque concentrarme focus', when: () => !prod.pomoState(), run: () => prod.pomoStart() },
  { id: 'pomo.stop', icon: '⏹️', label: 'Detener pomodoro', kw: 'pomodoro parar', when: () => !!prod.pomoState(), run: () => prod.pomoStop() },
  { id: 'capture', icon: '✍️', label: 'Anotar tarea o recordatorio', kw: 'anotar tarea recordatorio nota', run: () => openCapture() },
  { id: 'daily', icon: '☀️', label: 'Hacer el daily', kw: 'daily standup plan manana', run: () => openPanel('standup') },
  { id: 'review', icon: '🌇', label: 'Cierre del día', kw: 'cierre revision fin del dia', run: () => openPanel('review') },
  { id: 'report.weekly', icon: '📊', label: 'Informe semanal', kw: 'informe reporte semana resumen', run: () => openPanel('report') },
  { id: 'daily.copy', icon: '📋', label: 'Copiar daily para Slack/Teams', kw: 'copiar daily slack teams', run: () => openPanel('daily-copy') },
  { id: 'stats', icon: '📈', label: 'Estadísticas del mes', kw: 'estadisticas graficos mes', run: () => openPanel('stats') },
  { id: 'join', icon: '🎧', label: 'Unirme a la próxima reunión', kw: 'reunion teams unirme meet zoom', when: () => !!nextJoinable(), run: () => { const e = nextJoinable(); if (e) joinMeeting(e.join.url); } },
  { id: 'game', icon: '🎮', label: 'Minijuego: atrapa el maíz', kw: 'juego jugar minijuego', run: () => openGame() },
  { id: 'feed', icon: '🌽', label: 'Dar de comer al pollito', kw: 'comer maiz alimentar', run: () => feed() },
  { id: 'pet', icon: '💛', label: 'Acariciar al pollito', kw: 'acariciar mimo', run: () => petPet() },
  { id: 'bath', icon: '🛁', label: 'Bañar al pollito', kw: 'banar bano limpiar ducha', run: () => {
    const p = store.data.pet;
    p.clean = 100; p.happiness = clamp(p.happiness + 5);
    store.save(); addXp(2);
    say('¡Qué fresquito! 🛁✨ Huelo a flores', 'bath', 7000, { log: false });
    broadcast();
  } },
  { id: 'nap', icon: '😴', label: 'Siesta del pollito (3 min)', kw: 'siesta dormir descansar energia', run: () => {
    const p = store.data.pet;
    p.napUntil = Date.now() + 3 * 60e3;
    p.energy = clamp((p.energy ?? 100) + 10);
    store.save();
    say('Zzz… despiértame si me necesitas 😴', 'yawn', 5000, { log: false });
    broadcast();
    setTimeout(() => { p.energy = clamp((p.energy ?? 100) + 30); store.save(); say('¡Qué buena siesta! ⚡ Energía recargada', 'hop', 6000, { log: false }); broadcast(); }, 3 * 60e3 + 500);
  } },
  { id: 'medicine', icon: '💊', label: 'Dar medicina (25 🌽)', kw: 'medicina curar enfermo', when: () => !!store.data.pet.sick, run: () => {
    const p = store.data.pet;
    if ((p.coins || 0) < 25) { say('No tenemos suficiente maíz para la medicina (25 🌽) 😿 Completa tareas o juega al minijuego.', 'sad', 8000, { log: false }); return; }
    p.coins -= 25; p.sick = false; p.happiness = clamp(p.happiness + 10);
    p.fullness = Math.max(p.fullness, 30); p.clean = Math.max(p.clean ?? 0, 40);
    store.save();
    say('💊 ¡Ya me siento mucho mejor! Gracias por cuidarme 💛', 'celebrate', 8000);
    broadcast();
  } },
  { id: 'mute', icon: '🔕', label: 'Silenciar 1 hora (reunión)', kw: 'silencio callar reunion no molestar', when: () => !isMuted(), run: () => { setMute(60); say('Shhh 🤫 Te dejo tranquilo 1 hora.', 'peck', 5000, { log: false }); } },
  { id: 'unmute', icon: '🔔', label: 'Quitar silencio', kw: 'silencio hablar', when: () => isMuted(), run: () => { setMute(0); say('¡Volví! 🐣', 'hop', 4000, { log: false }); } },
  { id: 'tracking.pause', icon: '⏸️', label: 'Pausar el seguimiento 1 hora (privacidad)', kw: 'privacidad pausar seguimiento vigilancia', when: () => !trackingPaused(), run: () => { pauseTracking(60); say('⏸️ Seguimiento en pausa 1 hora. No miro ninguna ventana 🙈', 'peck', 6000); } },
  { id: 'tracking.resume', icon: '▶️', label: 'Reanudar el seguimiento', kw: 'privacidad reanudar seguimiento', when: () => trackingPaused(), run: () => { pauseTracking(0); say('▶️ Seguimiento reanudado 👀', 'hop', 5000); } },
  { id: 'usage.refresh', icon: '↻', label: 'Actualizar consumo de Claude', kw: 'actualizar uso refrescar', run: () => refreshUsage(true) },
  { id: 'pet.toggle', icon: '🙈', label: 'Ocultar / mostrar el pollito', kw: 'ocultar esconder mostrar', run: () => { if (petWin.isVisible()) petWin.hide(); else petWin.showInactive(); if (tray) tray.refreshMenu(); } },
  { id: 'discreet', icon: '🫣', label: 'Modo discreto (esconderse en el borde)', kw: 'discreto borde esconder asomar', run: () => setDiscreet(!store.data.settings.discreet) },
  { id: 'theme', icon: '🌓', label: 'Cambiar tema claro / oscuro', kw: 'tema oscuro claro dark light', run: () => { const cur = isDark(); store.data.settings.theme = cur ? 'light' : 'dark'; store.save(); broadcast(); } },
  { id: 'size.s', icon: '🐤', label: 'Pollito pequeño', kw: 'tamano pequeno size small', run: () => setPetSize('s') },
  { id: 'size.m', icon: '🐥', label: 'Pollito mediano', kw: 'tamano mediano size medium', run: () => setPetSize('m') },
  { id: 'size.l', icon: '🐔', label: 'Pollito grande', kw: 'tamano grande size large', run: () => setPetSize('l') },
  { id: 'lang', icon: '🌐', label: 'Switch to English / Cambiar a español', kw: 'idioma language ingles espanol english', run: () => { store.data.settings.lang = lang() === 'en' ? 'es' : 'en'; store.save(); reloadUi(); } },
  { id: 'tour', icon: '🧭', label: 'Ver el tour de bienvenida', kw: 'tour ayuda guia tutorial', run: () => openPanel('tour') },
  { id: 'settings', icon: '⚙️', label: 'Ajustes', kw: 'ajustes configuracion opciones preferencias settings', run: () => openSettings() },
  { id: 'about', icon: 'ℹ️', label: 'Acerca de PM Pollito', kw: 'acerca de version creditos about', run: () => openAbout() },
  { id: 'prompts', icon: '📚', label: 'Biblioteca de prompts', kw: 'prompts plantillas biblioteca claude copiar', run: () => openPanel('prompts') },
  { id: 'blocks', icon: '🗓️', label: 'Planificar el día en bloques de tiempo', kw: 'bloques time blocking horario planificar calendario', run: () => openPanel('blocks') },
  { id: 'goals', icon: '🎯', label: 'Objetivos de la semana', kw: 'objetivos metas semana goals', run: () => openPanel('day#goals') },
  { id: 'habits', icon: '💧', label: 'Hábitos (agua, ejercicio, leer…)', kw: 'habitos agua ejercicio leer racha', run: () => openPanel('day#habits') },
  { id: 'habit.water', icon: '💧', label: 'Me bebí un vaso de agua (+1)', kw: 'agua vaso beber hidratar', run: () => ex.habitStep('water', 1) },
  { id: 'notes', icon: '🗒️', label: 'Notas rápidas del día', kw: 'notas apuntes nota rapida buscar', run: () => openPanel('day#notes') },
  { id: 'journal', icon: '🤖', label: 'Qué hice hoy con Claude Code', kw: 'diario claude code peticiones prompts hoy', run: () => openPanel('day#claude-journal') },
  { id: 'play.corn', icon: '🌽', label: 'Lanzarle maíz al pollito', kw: 'jugar lanzar maiz tirar comida', run: () => { sendPet('pet:play', 'corn'); setTimeout(feed, 1400); } },
  { id: 'play.ball', icon: '⚽', label: 'Jugar a la pelota con el pollito', kw: 'jugar pelota balon', run: () => { sendPet('pet:play', 'ball'); const p = store.data.pet; p.happiness = clamp(p.happiness + 8); p.energy = clamp((p.energy ?? 100) - 4); addXp(2); store.save(); broadcast(); } },
  { id: 'play.stroll', icon: '🚶', label: 'Pasear por la barra de tareas', kw: 'pasear caminar paseo barra', run: () => { if (!ex.stroll()) say('Ahora no puedo pasear 🙈', 'peck', 4000, { log: false }); } },
  { id: 'report.monthly', icon: '📄', label: 'Informe mensual en PDF', kw: 'informe mensual pdf mes reporte exportar', run: () => ex.monthlyPdf(null, 'current').catch((e) => say('No pude crear el PDF 😿 ' + e.message, 'sad', 8000)) },
  { id: 'backup.now', icon: '💾', label: 'Hacer copia de seguridad ahora', kw: 'copia seguridad backup respaldo onedrive drive', run: () => { const r = ex.backupNow(true); if (!r.ok) say('No pude hacer la copia 😿 ' + r.error, 'sad', 8000); } },
  { id: 'focus.start', icon: '🎯', label: 'Modo foco: no me distraigas (50 min)', kw: 'foco concentracion no molestar distraigas focus', when: () => !focusMode(), run: () => startFocus(50) },
  { id: 'focus.start25', icon: '🎯', label: 'Modo foco 25 min', kw: 'foco concentracion no molestar focus corto', when: () => !focusMode(), run: () => startFocus(25) },
  { id: 'focus.stop', icon: '🏁', label: 'Terminar el modo foco', kw: 'foco terminar parar salir focus', when: () => !!focusMode(), run: () => endFocus() },
  { id: 'recurring', icon: '🔁', label: 'Tareas recurrentes', kw: 'recurrentes repetir cada lunes todos los dias rutina', run: () => openPanel('day#recurring') },
  { id: 'templates', icon: '🧩', label: 'Plantillas de día', kw: 'plantilla dia foco reuniones bugs planificar', run: () => openPanel('blocks') },
  { id: 'diag', icon: '🩺', label: 'Diagnóstico y errores', kw: 'diagnostico errores memoria cpu problema fallo log', run: () => openSettings('diag') },
  { id: 'quit', icon: '❌', label: 'Cerrar PM', kw: 'salir cerrar quit', run: () => confirmQuit('paleta') },
  { id: 'template.apply', hidden: true, run: (id) => ex.applyTemplate(id) },
  { id: 'whatsnew', hidden: true, run: () => openPanel('whatsnew') },
  { id: 'copy.text', hidden: true, run: (t) => { clipboard.writeText(String(t || '')); say(`📋 Copiado: ${String(t || '').slice(0, 40)}`, 'peck', 3500, { log: false }); } },
  { id: 'prompt.copy', hidden: true, run: (id) => ex.copyPrompt(id) },
  { id: 'clip.prompt', hidden: true, run: () => ex.clipPrompt() },
  { id: 'clip.task', hidden: true, run: () => ex.clipTask() },
  { id: 'clip.ask', hidden: true, run: () => ex.clipAsk() },
  { id: 'monthly.pdf', hidden: true, run: (which) => ex.monthlyPdf(null, which || 'prev').catch((e) => say('No pude crear el PDF 😿 ' + e.message, 'sad', 8000)) },
  { id: 'task.timer', hidden: true, run: (i) => taskTimer(Number(i), 'start') },
  { id: 'palette', hidden: true, run: () => openPalette() },
  // Ir a una sección del panel, p. ej. "day#reminders" (abre la pestaña y resalta la sección).
  { id: 'panel', hidden: true, run: (where) => openPanel(where || 'chat') },
  // Abrir el proyecto donde trabajó Claude (VS Code si está, si no el Explorador).
  { id: 'open.project', hidden: true, run: (dir) => openProject(dir) },
  { id: 'voice.test', hidden: true, run: () => {
    const n = store.data.pet.name || 'PM';
    if (petWin) petWin.webContents.send('pet:say', { text: T(`¡Hola! Soy ${n}, tu pollito PM. Así sueno 🐣`), anim: 'wave', ms: 6000, speak: true, lang: lang() });
  } },
  { id: 'lang-reload', hidden: true, run: () => reloadUi() },
  { id: 'settings.integrations', hidden: true, run: () => openSettings('integrations') },
  // Solo para botones de los avisos (no aparecen en la paleta):
  { id: 'focus.allow', hidden: true, run: () => say(allowCurrentDistraction(), 'judge', 7000, { log: false }) },
  { id: 'focus.ok', hidden: true, run: () => { fx.distractSince = Date.now(); fx.scoldLevel = 0; say('👍 ¡Confío en ti! 💪', 'hop', 4000, { log: false }); } },
  { id: 'forgive', hidden: true, run: () => { store.data.life.angryUntil = 0; store.flush(); say('Hmph… 😤 … bueno, está bien. Te perdono 💛', 'love', 7000, { log: false }); broadcast(); } },
  { id: 'ack', hidden: true, run: () => animate('hop') },
  { id: 'health.done', hidden: true, run: () => { addXp(3); say('¡Así me gusta! Cuerpo sano, código sano 💪 +3 XP', 'dance', 5000, { log: false }); } },
  { id: 'snooze.standup', hidden: true, run: () => { today().snoozeStandup = Date.now() + 30 * 60000; store.save(); say('¡Vale! Te vuelvo a preguntar en 30 minutos ⏰', 'peck', 5000, { log: false }); } },
  { id: 'snooze.review', hidden: true, run: () => { today().snoozeReview = Date.now() + 30 * 60000; store.save(); say('¡Vale! Te vuelvo a preguntar en 30 minutos ⏰', 'peck', 5000, { log: false }); } },
  { id: 'reminder.done', hidden: true, run: () => { addXp(2); animate('dance'); } },
  { id: 'reminder.snooze', hidden: true, run: (id) => {
    const r = (store.data.reminders || []).find((x) => x.id === id);
    if (r) { prod.addReminderAt(Date.now() + 10 * 60000, r.text); say(`⏰ Te lo recuerdo en 10 minutos: "${r.text}"`, 'peck', 5000, { log: false }); }
  } },
  { id: 'open.url', hidden: true, run: (url) => { if (/^https:\/\//.test(url || '')) (joinMeeting(url) || openSafeUrl(url)); } },
  { id: 'open.monitor', hidden: true, run: (id) => { const m = (store.data.settings.monitors || []).find((x) => x.id === id); if (m) shell.openExternal(m.url); } },
];

// ---------- API para la extensión de VS Code (servidor local 127.0.0.1:47823) ----------
const EXT_COMMANDS = new Set([
  'pomo.start', 'pomo.stop', 'capture', 'palette', 'panel.chat', 'panel.usage', 'panel.day', 'panel.agenda', 'panel.profile',
  'inbox', 'mute', 'unmute', 'daily', 'review', 'report.weekly', 'stats', 'feed', 'pet', 'usage.refresh', 'join',
]);
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
    meeting: meetingNow ? { title: meetingNow.title, app: meetingNow.app } : null,
    unread: (store.data.inbox || []).filter((x) => !x.read && x.cat !== 'pet').length,
    muted: isMuted(),
    costToday: usage.local ? usage.local.today.cost : 0,
    mood: isAngry() ? 'angry' : store.data.pet.sick ? 'sick' : 'ok',
  };
}

function openProject(dir) {
  try {
    if (!dir || !fs.statSync(dir).isDirectory()) return openPanel('usage#local');
  } catch {
    return openPanel('usage#local');
  }
  // Intenta VS Code ("code" en el PATH); si no existe, abre la carpeta en el Explorador.
  const child = require('child_process').spawn('cmd.exe', ['/d', '/c', 'code', dir], { windowsHide: true, detached: true, stdio: 'ignore' });
  child.on('exit', (code) => { if (code !== 0) shell.openPath(dir); });
  child.on('error', () => shell.openPath(dir));
  child.unref();
}

function runCommand(id, arg) {
  const c = COMMANDS.find((x) => x.id === id);
  if (!c || (c.when && !c.when())) return false;
  try {
    const r = c.run(arg);
    if (r && typeof r.catch === 'function') r.catch((e) => diag.log('main', `Comando ${id}: ${e.stack || e.message}`));
  } catch (e) { diag.log('main', `Comando ${id}: ${e.stack || e.message}`); }
  return true;
}

function paletteCommands() {
  const tpl = ex ? ex.templates().map((t) => ({ id: 'template.apply', arg: t.id, icon: t.emoji || '🧩', label: T('Aplicar plantilla: ') + t.name, kw: 'plantilla dia ' + t.name })) : [];
  return COMMANDS.filter((c) => !c.hidden && (!c.when || c.when())).map((c) => ({ id: c.id, icon: c.icon, label: T(c.label), kw: c.kw })).concat(tpl);
}

// Recarga todas las ventanas (p. ej. al cambiar el idioma).
function reloadUi() {
  for (const w of [panelWin, settingsWin, paletteWin, aboutWin]) if (w && !w.isDestroyed()) w.webContents.reload();
  if (tray) tray.refreshMenu();
  broadcast();
}

// ---------- apariencia ----------
function isDark() {
  const t = store.data.settings.theme || 'system';
  return t === 'dark' || (t === 'system' && nativeTheme.shouldUseDarkColors);
}

const SIZE_FACTOR = { s: 0.8, m: 1, l: 1.25 };
function petFactor() {
  return SIZE_FACTOR[store.data.settings.petSize] || 1;
}
function setPetSize(size) {
  store.data.settings.petSize = SIZE_FACTOR[size] ? size : 'm';
  store.save();
  applyPetSize();
  broadcast();
}
function applyPetSize() {
  if (!petWin) return;
  const f = petFactor();
  const b = petWin.getBounds();
  const w = Math.round(PET_W * f), h = Math.round(PET_H * f);
  petWin.webContents.setZoomFactor(f);
  // Mantiene el pollito anclado por abajo y centrado.
  petWin.setBounds({ x: Math.round(b.x + (b.width - w) / 2), y: b.y + b.height - h, width: w, height: h });
  if (store.data.settings.discreet) dockPet(false);
  placePanel();
}

// ---------- modo discreto: se esconde en el borde y se asoma ----------
let dockTimer = null;
let slideTimer = null;
function slidePetTo(x) {
  if (!petWin) return;
  clearInterval(slideTimer);
  const start = petWin.getPosition()[0];
  const y = petWin.getPosition()[1];
  let i = 0;
  const steps = 12;
  slideTimer = setInterval(() => {
    i++;
    const t = i / steps;
    const e = 1 - Math.pow(1 - t, 3);
    petWin.setPosition(Math.round(start + (x - start) * e), y);
    if (i >= steps) clearInterval(slideTimer);
  }, 14);
}
function dockPositions() {
  const b = petWin.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const f = b.width / PET_W;
  const side = store.data.settings.dockSide || ((b.x + b.width / 2) > wa.x + wa.width / 2 ? 'right' : 'left');
  if (side === 'right') return { side, hidden: wa.x + wa.width - Math.round(120 * f), peek: wa.x + wa.width - Math.round(205 * f) };
  return { side, hidden: wa.x - Math.round(120 * f), peek: wa.x - Math.round(35 * f) };
}
function dockPet(peek) {
  if (!petWin || !store.data.settings.discreet || drag) return;
  const p = dockPositions();
  slidePetTo(peek ? p.peek : p.hidden);
  sendPet('pet:dock', { side: p.side, peek });
}
function peekPet(ms = 6000) {
  if (!store.data.settings.discreet) return;
  dockPet(true);
  clearTimeout(dockTimer);
  dockTimer = setTimeout(() => dockPet(false), ms);
}
function setDiscreet(on) {
  store.data.settings.discreet = !!on;
  if (on) {
    const b = petWin.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    store.data.settings.dockSide = (b.x + b.width / 2) > wa.x + wa.width / 2 ? 'right' : 'left';
    dockPet(false);
    say('🫣 Modo discreto: me escondo en el borde y me asomo cuando tenga algo que decirte.', 'peck', 6000, { log: false });
  } else {
    const p = dockPositions();
    slidePetTo(p.side === 'right' ? p.peek - 20 : p.peek + 20);
    sendPet('pet:dock', null);
  }
  store.save();
  broadcast();
}

// ---------- ventanas nuevas: ajustes, paleta de comandos y "acerca de" ----------
function baseWinOpts(extra) {
  return {
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    ...extra,
  };
}

function openSettings(section) {
  if (panelWin) panelWin.hide();
  if (!settingsWin || settingsWin.isDestroyed()) {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    settingsWin = new BrowserWindow(baseWinOpts({
      width: 760, height: 600, skipTaskbar: false, title: 'PM · Ajustes',
      x: Math.round(d.x + (d.width - 760) / 2), y: Math.round(d.y + (d.height - 600) / 2),
      icon: path.join(__dirname, 'build', 'icon.png'),
    }));
    settingsWin.setAlwaysOnTop(true, 'floating');
    settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'), { query: section ? { section } : {} });
    settingsWin.once('ready-to-show', () => { settingsWin.show(); settingsWin.focus(); });
    settingsWin.on('closed', () => (settingsWin = null));
  } else {
    settingsWin.show();
    settingsWin.focus();
    if (section) settingsWin.webContents.send('settings:section', section);
  }
}

function openPalette() {
  if (!paletteWin || paletteWin.isDestroyed()) {
    paletteWin = new BrowserWindow(baseWinOpts({ width: 580, height: 440, alwaysOnTop: true }));
    paletteWin.setAlwaysOnTop(true, 'screen-saver', 3);
    paletteWin.loadFile(path.join(__dirname, 'renderer', 'palette.html'));
    paletteWin.on('blur', () => { if (paletteWin && !paletteWin.isDestroyed()) paletteWin.hide(); });
    paletteWin.on('closed', () => (paletteWin = null));
  }
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  paletteWin.setPosition(Math.round(d.x + (d.width - 580) / 2), Math.round(d.y + d.height * 0.2));
  paletteWin.show();
  paletteWin.focus();
  paletteWin.webContents.send('palette:open', paletteCommands());
  store.data.flags = { ...(store.data.flags || {}), usedPalette: true };
  store.save();
}

function openAbout() {
  if (!aboutWin || aboutWin.isDestroyed()) {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    aboutWin = new BrowserWindow(baseWinOpts({
      width: 380, height: 470, alwaysOnTop: true, title: 'Acerca de PM Pollito',
      x: Math.round(d.x + (d.width - 380) / 2), y: Math.round(d.y + (d.height - 470) / 2),
    }));
    aboutWin.setAlwaysOnTop(true, 'screen-saver', 2);
    aboutWin.loadFile(path.join(__dirname, 'renderer', 'about.html'));
    aboutWin.once('ready-to-show', () => { aboutWin.show(); aboutWin.focus(); });
    aboutWin.on('closed', () => (aboutWin = null));
  } else {
    aboutWin.show();
    aboutWin.focus();
  }
}

// ---------- copia de seguridad y privacidad ----------
async function exportData() {
  const parent = settingsWin && !settingsWin.isDestroyed() ? settingsWin : undefined;
  const r = await dialog.showSaveDialog(parent, {
    title: 'Exportar la memoria del pollito',
    defaultPath: path.join(app.getPath('documents'), `pm-pollito-backup-${dayKey()}.json`),
    filters: [{ name: 'Copia de PM', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return null;
  const data = JSON.parse(JSON.stringify(store.data));
  // Los secretos cifrados solo sirven en este PC: no se exportan.
  for (const k of ['manualToken', 'aiKey', 'githubToken', 'calendarUrl']) delete data.settings[k];
  if (data.settings.mail) delete data.settings.mail.passEnc;
  if (data.settings.accounts) data.settings.accounts = {};
  fs.writeFileSync(r.filePath, JSON.stringify({ app: 'pm-pollito', version: app.getVersion(), exportedAt: new Date().toISOString(), data }, null, 2));
  shell.showItemInFolder(r.filePath);
  return r.filePath;
}

async function importData() {
  const parent = settingsWin && !settingsWin.isDestroyed() ? settingsWin : undefined;
  const r = await dialog.showOpenDialog(parent, { title: 'Importar copia de PM', filters: [{ name: 'Copia de PM', extensions: ['json'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch { return { ok: false, error: 'El archivo no es una copia válida.' }; }
  if (!parsed || parsed.app !== 'pm-pollito' || !parsed.data || !parsed.data.pet) return { ok: false, error: 'El archivo no es una copia de PM Pollito.' };
  const ok = await dialog.showMessageBox(parent, {
    type: 'warning', buttons: ['Cancelar', 'Sí, reemplazar'], defaultId: 0, cancelId: 0,
    message: `¿Reemplazar la memoria actual por la de "${parsed.data.pet.name || 'PM'}"?`,
    detail: 'Se guardará una copia de la memoria actual por si acaso. Tus claves (IA, GitHub, correo) se conservan.',
  });
  if (ok.response !== 1) return { ok: false };
  fs.copyFileSync(store.file, store.file.replace(/\.json$/, `.antes-de-importar-${Date.now()}.json`));
  const keep = {};
  for (const k of ['manualToken', 'aiKey', 'githubToken', 'calendarUrl', 'mail', 'accounts']) keep[k] = store.data.settings[k];
  store.data = parsed.data;
  store.data.settings = { ...store.data.settings, ...keep };
  store.data.life = { ...(store.data.life || {}), running: false, lastQuitHow: 'update', lastQuitAt: Date.now() };
  store.flush();
  quitHow = 'update';
  app.relaunch();
  app.quit();
  return { ok: true };
}

async function deleteAllData() {
  const parent = settingsWin && !settingsWin.isDestroyed() ? settingsWin : undefined;
  const r = await dialog.showMessageBox(parent, {
    type: 'warning', buttons: ['Cancelar', 'Borrar todo'], defaultId: 0, cancelId: 0,
    message: '¿Borrar TODOS tus datos de PM?',
    detail: 'Se borran el pollito, sus recuerdos, tareas, estadísticas, claves y conexiones de este PC. No se puede deshacer (exporta una copia antes si quieres).',
  });
  if (r.response !== 1) return false;
  try { await claudeWeb.logout(); } catch { /* sin sesión */ }
  store.save = () => {};
  store.flush = () => {};
  for (const f of [store.file, store.bak]) { try { fs.unlinkSync(f); } catch { /* no existe */ } }
  quitHow = 'update';
  app.relaunch();
  app.exit(0);
  return true;
}

// ---------- captura rápida (Ctrl+Alt+P desde cualquier app) ----------
function openCapture() {
  if (!captureWin || captureWin.isDestroyed()) {
    captureWin = new BrowserWindow({
      width: 520,
      height: 150,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    captureWin.setAlwaysOnTop(true, 'screen-saver', 3);
    captureWin.loadFile(path.join(__dirname, 'renderer', 'capture.html'));
    captureWin.on('blur', () => { if (captureWin && !captureWin.isDestroyed()) captureWin.hide(); });
  }
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  captureWin.setPosition(Math.round(d.x + (d.width - 520) / 2), Math.round(d.y + d.height * 0.28));
  captureWin.show();
  captureWin.focus();
  captureWin.webContents.send('capture:open');
  animate('peck');
}

function placePanel() {
  if (!panelWin || !petWin) return;
  const pb = petWin.getBounds();
  const wa = screen.getDisplayMatching(pb).workArea;
  const f = pb.width / PET_W;
  const chickLeft = pb.x + 50 * f;
  const chickRight = pb.x + pb.width - 50 * f;
  let x = chickRight + PANEL_W + 8 <= wa.x + wa.width ? chickRight + 8 : chickLeft - PANEL_W - 8;
  x = clamp(x, wa.x, wa.x + wa.width - PANEL_W);
  let y = pb.y + pb.height - PANEL_H;
  y = clamp(y, wa.y, wa.y + wa.height - PANEL_H);
  panelWin.setBounds({ x: Math.round(x), y: Math.round(y), width: PANEL_W, height: PANEL_H });
}

function openPanel(view) {
  if (!panelWin) return;
  placePanel();
  if (view) panelWin.webContents.send('panel:view', view);
  panelWin.show();
  panelWin.focus();
}

function togglePanel() {
  if (!panelWin) return;
  if (panelWin.isVisible()) panelWin.hide();
  else openPanel();
}

// ---------- icono de bandeja (pollito dibujado a mano, 32x32) ----------
function trayIcon() {
  const S = 32;
  const buf = Buffer.alloc(S * S * 4);
  const set = (x, y, [r, g, b, a = 255]) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = a; // BGRA
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - 16, dy = y - 18;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= 12.5) set(x, y, d > 11.5 ? [230, 160, 20] : [255, 212, 59]);
    }
  }
  for (let y = 3; y < 7; y++) for (let x = 15; x < 18; x++) set(x, y, [255, 200, 40]); // copete
  for (let y = 14; y < 18; y++) for (let x = 11; x < 13; x++) set(x, y, [40, 30, 20]); // ojo
  for (let y = 14; y < 18; y++) for (let x = 20; x < 22; x++) set(x, y, [40, 30, 20]); // ojo
  for (let y = 19; y < 22; y++) for (let x = 14; x < 19; x++) if (x - 14 + (y - 19) < 5) set(x, y, [255, 128, 32]); // pico
  set(9, 20, [255, 150, 150]); set(23, 20, [255, 150, 150]);
  return nativeImage.createFromBitmap(buf, { width: S, height: S });
}

// ---------- icono dinámico de la bandeja: anillo con el % de la sesión o el pomodoro ----------
let trayBase = null;
let lastTrayKey = '';
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function trayIconWith(frac, color) {
  const S = 32;
  if (!trayBase) {
    const png = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
    trayBase = png.isEmpty() ? trayIcon() : png.resize({ width: S, height: S, quality: 'best' });
  }
  const buf = Buffer.from(trayBase.toBitmap()); // BGRA
  const [r, g, b] = hexRgb(color);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - S / 2, dy = y + 0.5 - S / 2;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 12.6 || d > 15.9) continue;
      let ang = Math.atan2(dx, -dy); // 0 arriba, sentido horario
      if (ang < 0) ang += Math.PI * 2;
      const on = ang / (Math.PI * 2) <= frac;
      const i = (y * S + x) * 4;
      const [cr, cg, cb, ca] = on ? [r, g, b, 255] : [60, 50, 40, 110];
      const a = ca / 255;
      buf[i] = Math.round(cb * a + buf[i] * (1 - a));
      buf[i + 1] = Math.round(cg * a + buf[i + 1] * (1 - a));
      buf[i + 2] = Math.round(cr * a + buf[i + 2] * (1 - a));
      buf[i + 3] = Math.max(buf[i + 3], ca);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: S, height: S });
}
function updateTrayIcon() {
  if (!tray) return;
  const name = store.data.pet.name || 'PM';
  const pomo = prod && prod.pomoState();
  const s = (usage.limits || []).find((l) => l.key === 'five_hour');
  let frac = 0, color = '#b9b0a0', tip = `${name} · tu pollito PM`;
  if (pomo && pomo.endsAt) {
    const total = (pomo.phase === 'focus' ? 25 : pomo.long ? 15 : 5) * 60e3;
    const left = Math.max(0, pomo.endsAt - Date.now());
    frac = left / total;
    color = pomo.phase === 'focus' ? '#e63946' : '#3cc46b';
    const mm = String(Math.floor(left / 60000)).padStart(2, '0'), ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
    tip = `${name} · ${pomo.phase === 'focus' ? '🍅' : '☕'} ${mm}:${ss}`;
  } else if (s) {
    const p = s.utilization;
    frac = Math.min(1, p / 100);
    color = p >= 90 ? '#e63946' : p >= 75 ? '#ff8c1a' : p >= 50 ? '#f5c518' : '#3cc46b';
    const f = usage.forecast && usage.forecast.five_hour;
    tip = `${name} · Sesión ${Math.round(p)}%${f && f.rate ? ` (+${Math.round(f.rate)}%/h)` : ''} · reinicio en ${brain.fmtUntil(s.resetsAt)}`;
  }
  const unread = (store.data.inbox || []).filter((x) => !x.read && x.cat !== 'pet').length;
  if (unread) tip += ` · 🔔 ${unread}`;
  const key = `${Math.round(frac * 40)}|${color}`;
  if (key !== lastTrayKey) { lastTrayKey = key; tray.setImage(trayIconWith(frac, color)); }
  tray.setToolTip(T(tip));
}

// Sale del modo "presentando" a mano (desde la bandeja).
function forceShowPet() {
  presenting = null;
  presentQuietSince = 0;
  presentBuffer.length = 0;
  presentSnoozeUntil = Date.now() + 30 * 60000; // no volver a esconderse en 30 min
  if (petWin) petWin.showInactive();
  if (tray) { tray.setToolTip('PM Pollito'); tray.refreshMenu && tray.refreshMenu(); }
  broadcast();
}
let presentSnoozeUntil = 0;

function buildTray() {
  const png = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
  tray = new Tray(png.isEmpty() ? trayIcon() : png.resize({ width: 32, height: 32 }));
  const refresh = () => {
    const name = store.data.pet.name || 'PM';
    updateTrayIcon();
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `🐣 ${name}`, enabled: false },
        { type: 'separator' },
        { label: 'Abrir panel', click: () => openPanel('chat') },
        { label: '🍅 Pomodoro (empezar / detener)', click: () => (prod.pomoState() ? prod.pomoStop() : prod.pomoStart()) },
        { label: '✍️ Anotar rápido  (Ctrl+Alt+P)', click: openCapture },
        { label: '📊 Informe semanal', click: () => openPanel('report') },
        { label: '📈 Estadísticas', click: () => openPanel('stats') },
        { label: '🎮 Minijuego', click: openGame },
        { label: 'Daily de la mañana', click: () => openPanel('standup') },
        { label: 'Cierre del día', click: () => openPanel('review') },
        { label: 'Actualizar consumo', click: () => refreshUsage(true) },
        isMuted()
          ? { label: '🔔 Quitar silencio', click: () => setMute(0) }
          : { label: '🔕 Silenciar 1 hora', click: () => setMute(60) },
        { type: 'separator' },
        ...(presenting ? [
          { label: `🙈 Escondido: ${presenting.reason}`, enabled: false },
          { label: '👀 Mostrarme igualmente', click: () => { forceShowPet(); } },
          ...(presenting.app && presenting.reason !== 'Compartiendo pantalla en Teams'
            ? [{ label: `🚫 No esconderme con ${presenting.app}`, click: () => { const l = store.data.settings.noHideApps || (store.data.settings.noHideApps = []); if (!l.includes(presenting.app)) l.push(presenting.app); store.save(); forceShowPet(); } }]
            : []),
          { type: 'separator' },
        ] : []),
        {
          label: 'Mostrar pollito',
          type: 'checkbox',
          checked: !!(petWin && petWin.isVisible()),
          click: (i) => { if (petWin) (i.checked ? petWin.show() : petWin.hide()); },
        },
        { label: 'Traer a la esquina', click: resetPosition },
        {
          label: 'Iniciar con Windows',
          type: 'checkbox',
          checked: app.getLoginItemSettings().openAtLogin,
          click: (i) => setAutoStart(i.checked),
        },
        { type: 'separator' },
        { label: '⚙️ Ajustes…', click: () => openSettings() },
        { label: 'ℹ️ Acerca de PM Pollito…', click: openAbout },
        { type: 'separator' },
        { label: 'Salir', click: () => confirmQuit('bandeja') },
      ])
    );
  };
  refresh();
  tray.on('click', () => openPanel('chat'));
  tray.refreshMenu = refresh;
}

function resetPosition() {
  if (!petWin) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const x = wa.x + wa.width - PET_W - 30, y = wa.y + wa.height - PET_H - 10;
  petWin.setPosition(x, y);
  petWin.show();
  store.data.position = { x, y };
  store.save();
  placePanel();
}

function setAutoStart(on) {
  const opts = { openAtLogin: !!on };
  if (!app.isPackaged) {
    opts.path = process.execPath;
    opts.args = [app.getAppPath()];
  }
  app.setLoginItemSettings(opts);
  store.data.settings.autoStart = !!on;
  store.save();
  if (tray) tray.refreshMenu();
  broadcast();
}

// ---------- consumo ----------
let refreshing = false;
async function refreshUsage(manual = false) {
  if (refreshing) return usage;
  refreshing = true;
  try {
    let local = null;
    try { local = usageApi.localStats(); } catch (e) { console.error('Stats locales:', e.message); }

    // Fuentes por orden de preferencia: cuenta web (navegador) → token manual → Claude Code.
    const sources = [];
    if (store.data.web.orgId) {
      sources.push({
        source: 'web',
        plan: store.data.web.orgName,
        run: () => claudeWeb.fetchLimits(store.data.web.orgId),
        bad: 'Tu sesión de claude.ai caducó. Pulsa “Conectar con mi cuenta de Claude” para volver a entrar.',
      });
    }
    const manualTok = manualToken();
    if (manualTok) {
      sources.push({ source: 'manual', run: () => usageApi.fetchLimits(manualTok), bad: 'El token que pegaste no es válido o caducó.' });
    }
    const cc = usageApi.readClaudeCodeSession();
    if (cc.found && !(cc.expiresAt && cc.expiresAt < Date.now())) {
      sources.push({
        source: 'claude-code',
        plan: cc.plan,
        run: () => usageApi.fetchLimits(cc.token),
        bad: 'La sesión de Claude Code de este equipo ya no es válida.',
      });
    }

    let connection = null;
    let limits = [];
    for (const src of sources) {
      try {
        limits = await src.run();
        connection = { source: src.source, plan: src.plan, status: 'ok' };
        break;
      } catch (e) {
        const invalid = e.status === 401 || e.status === 403;
        if (!connection) {
          connection = {
            source: src.source,
            status: invalid ? 'invalid' : 'error',
            message: invalid ? src.bad : 'No pude contactar con Claude (' + e.message + '). Reintentaré pronto.',
          };
        }
      }
    }
    if (!connection) {
      connection = { source: null, status: 'missing', message: 'Aún no me has conectado a tu cuenta de Claude.' };
    }
    // Conserva los últimos límites conocidos si solo fue un fallo de red.
    if (connection.status === 'error' && usage.limits) limits = usage.limits;

    usage = { limits, local, connection, fetchedAt: Date.now() };
    if (connection.status === 'ok') updateForecasts();
    processThresholds();
    broadcast();
    if (manual) {
      const s = limits.find((l) => l.key === 'five_hour');
      say(connection.status === 'ok'
        ? (s ? `¡Actualizado! Sesión al ${Math.round(s.utilization)}% 📊` : '¡Actualizado! 📊')
        : '¡Ups! No pude conectarme a Claude 😿', connection.status === 'ok' ? 'peck' : 'sad');
    }
    return usage;
  } finally {
    refreshing = false;
  }
}

// ---------- predicción de consumo ----------
function updateForecasts() {
  const hist = store.data.usageHist || (store.data.usageHist = {});
  const now = Date.now();
  usage.forecast = {};
  for (const [key, windowMs] of [['five_hour', 90 * 60e3], ['seven_day', 36 * 3600e3]]) {
    const l = (usage.limits || []).find((x) => x.key === key);
    if (!l || !l.resetsAt) continue;
    const list = hist[key] || (hist[key] = []);
    list.push({ t: now, u: l.utilization, r: Date.parse(l.resetsAt) });
    hist[key] = list.filter((s) => now - s.t < 3 * 864e5).slice(-300);
    const f = forecastMod.forecast(hist[key], l, windowMs);
    if (!f) continue;
    usage.forecast[key] = f;
    // Aviso anticipado (una vez por ventana): sesión si llegas al 100% en < 2,5 h; semanal si en < 2 días.
    const soon = key === 'five_hour' ? 2.5 * 3600e3 : 2 * 864e5;
    const bucket = Math.round(f.resetAt / 600000);
    const alertKey = `forecast|${key}|${bucket}`;
    if (key === 'five_hour' && ex && usage.local) {
      const models = Object.entries(usage.local.today.models || {}).sort((a, b) => b[1] - a[1]);
      ex.modelAdvice(f, l.utilization, models.length ? models[0][0] : '', bucket);
    }
    if (f.willHit && f.eta - now < soon && l.utilization >= 25 && l.utilization < 95 && !store.data.alerts[alertKey]) {
      store.data.alerts[alertKey] = [1];
      const at = new Date(f.eta).toLocaleString(lang() === 'en' ? 'en' : 'es', key === 'five_hour' ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'long', hour: '2-digit', minute: '2-digit' });
      const early = brain.fmtDur(f.beforeReset / 1000);
      const what = key === 'five_hour' ? 'tu sesión' : 'tu límite semanal';
      say(`🔮 A este ritmo (+${Math.round(f.rate)}%/h) llenarás ${what} a las ${at}, ${early} antes del reinicio. ¿Bajamos el ritmo o pasamos a un modelo más ligero?`, 'alert', 15000, {
        cat: 'usage', actions: [{ label: '📊 Ver uso', cmd: 'panel.usage' }, { label: '👍 Entendido', cmd: 'ack' }],
      });
    }
  }
  store.save();
}

function processThresholds() {
  const now = Date.now();
  // Limpieza de avisos viejos.
  for (const k of Object.keys(store.data.alerts)) {
    const t = Number(k.split('|')[1]);
    if (t && t < now - 864e5) delete store.data.alerts[k];
  }

  let best = null;
  for (const l of usage.limits || []) {
    const bucket = l.resetsAt ? Math.round(Date.parse(l.resetsAt) / 600000) * 600000 : 0;
    const key = `${l.key}|${bucket}`;
    const done = store.data.alerts[key] || [];
    const important = l.key === 'five_hour' || l.key === 'seven_day';
    const crossed = THRESHOLDS.filter((t) => l.utilization >= t && !done.includes(t) && (important || t >= 75));
    if (crossed.length) {
      store.data.alerts[key] = [...done, ...crossed];
      const t = Math.max(...crossed);
      if (!best || t > best.t) best = { l, t };
    }
  }

  const s = (usage.limits || []).find((l) => l.key === 'five_hour');
  if (s && prevSession && prevSession.utilization >= 30 && s.utilization < 10 && s.resetsAt !== prevSession.resetsAt) {
    say('¡Tu límite de sesión se reinició! 🎉 Energía al 100%', 'celebrate', 9000);
    pushChat('pet', '¡Tu límite de sesión de 5 h se reinició! 🎉');
    if (ex) setTimeout(() => ex.onSessionReset(), 10000);
  } else if (best) {
    const m = brain.thresholdMessage(best.l, best.t);
    say(m.text, m.anim, 10000);
    pushChat('pet', m.text);
  }
  if (s) prevSession = s;
  store.save();
}

// ---------- horario: daily a las 8 y cierre antes de las 5 ----------
function checkSchedule() {
  const now = new Date();
  const dow = now.getDay();
  if (store.data.settings.workdaysOnly && (dow === 0 || dow === 6)) return;
  if (!store.data.pet.name || isMuted() || meetingNow) return; // primero el onboarding; en silencio o reunión no molesta
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const morning = toMinutes(store.data.settings.morningTime);
  const evening = toMinutes(store.data.settings.eveningTime);
  const day = today();
  const t = Date.now();

  if (nowMin >= morning && nowMin < evening && !day.standup && !(day.snoozeStandup > t)) {
    day.snoozeStandup = t + 30 * 60000; // si no contestas, vuelvo a preguntar en 30 min
    store.save();
    const n = todaysMeetings().length;
    const agenda = calState.status === 'ok' ? ` Hoy tienes ${n} reunion${n === 1 ? '' : 'es'} 📅` : '';
    const inbox = mailState.status === 'ok' && mailState.unseen ? ` y ${mailState.unseen} correos sin leer 📧` : '';
    say(`¡Buenos días! ☀️ ¿Qué hiciste ayer y qué vas a hacer hoy?${agenda}${inbox}`, 'alarm-soft', 14000);
    openPanel('standup');
  }

  const tasks = day.standup && day.standup.today;
  if (nowMin >= evening && tasks && tasks.length && !day.review && !(day.snoozeReview > t)) {
    day.snoozeReview = t + 30 * 60000;
    store.save();
    say('¡Casi termina el día! 🌇 ¿Cumpliste lo que dijiste?', 'alarm-soft', 12000);
    openPanel('review');
  }

  // Viernes después del cierre: informe semanal listo para copiar.
  const weekKey = `${now.getFullYear()}-w${Math.floor((now - new Date(now.getFullYear(), 0, 1)) / (7 * 864e5))}`;
  if (dow === 5 && nowMin >= evening + 5 && (day.review || !tasks) && store.data.lastWeeklyReport !== weekKey) {
    store.data.lastWeeklyReport = weekKey;
    store.save();
    say('¡Es viernes! 🎉 Tu informe semanal está listo para copiar y enviar 📊', 'celebrate', 12000);
    openPanel('report');
  }
}

// ---------- vida de la mascota ----------
function petTick() {
  const p = store.data.pet;
  const now = Date.now();
  const last = p.lastTick || now;
  const mins = Math.min((now - last) / 60000, 60 * 24);
  p.fullness = clamp(p.fullness - mins / 15);
  p.happiness = clamp(p.happiness - mins / 25);
  // Limpieza: se ensucia poco a poco.
  p.clean = clamp((p.clean ?? 100) - mins / 40);
  // Energía: duerme de noche (o en la siesta) y se cansa de día.
  const h = new Date().getHours();
  const napping = (p.napUntil || 0) > now;
  const userAway = !fx.lastSampleAt || now - fx.lastSampleAt > 60e3 || (fx.idleSince && now - fx.idleSince > 15 * 60e3);
  if (napping) p.energy = clamp((p.energy ?? 100) + mins * 12);
  else if ((h >= 23 || h < 7) && userAway) p.energy = clamp((p.energy ?? 100) + mins * 1.5);
  else p.energy = clamp((p.energy ?? 100) - mins / 10);
  // Enfermedad: si pasa mucha hambre y está muy sucio.
  if (!p.sick && (p.fullness <= 0 || p.clean <= 1 || (p.fullness <= 5 && p.clean <= 15))) {
    p.sick = true;
    p.sickSince = now;
    p.happiness = clamp(p.happiness - 15);
    setTimeout(() => say('🤒 No me siento bien… creo que me enfermé. ¿Me das una medicina?', 'sad', 20000, {
      cat: 'pet', actions: [{ label: '💊 Medicina (25 🌽)', cmd: 'medicine' }, { label: '🌽 Dar maíz', cmd: 'feed' }],
    }), 2000);
  }
  p.lastTick = now;
  store.data.life.lastSeen = now; // latido: sirve para saber cuánto estuvo apagado
  store.save();
  broadcast();
}

// ---------- memoria entre aperturas ----------
function markStarted() {
  const life = store.data.life;
  const now = Date.now();
  const bootAt = now - os.uptime() * 1000;
  let how = null;
  if (life.lastStart) {
    if (life.running) {
      // No se cerró bien. Si el PC se reinició después, fue un apagado; si no, lo mataron.
      how = (life.lastSeen || life.lastStart) < bootAt ? 'shutdown' : 'killed';
      if (how === 'killed') life.crashes = (life.crashes || 0) + 1;
    } else {
      how = life.lastQuitHow || 'user';
    }
  }
  const lastAlive = life.running ? life.lastSeen || life.lastStart : life.lastQuitAt;
  startup = { how, awayMs: lastAlive ? now - lastAlive : 0 };
  life.running = true;
  life.lastStart = now;
  life.lastSeen = now;
  store.flush();
}

function markStopped(how) {
  const life = store.data.life;
  if (!life.running) return;
  life.running = false;
  life.lastQuitAt = Date.now();
  life.lastQuitHow = how || 'user';
  if (life.lastQuitHow === 'user') life.closes = (life.closes || 0) + 1;
  store.flush();
}

function greetOnStart() {
  const p = store.data.pet;
  if (!p.name) {
    say('¡Pío! Acabo de nacer 🐣 ¿Cómo me llamo?', 'hatch', 15000);
    setTimeout(() => openPanel('onboarding'), 1200);
    return;
  }
  const life = store.data.life;
  if (startup && startup.how) {
    const g = brain.returnGreeting({
      name: p.name, how: startup.how, awayMs: startup.awayMs, crashes: life.crashes, closes: life.closes, pending: firstPending(),
    });
    if (g.angry) {
      life.angryUntil = Date.now() + 15 * 60000; // se le pasa con mimos, comida o pidiéndole perdón
      store.flush();
    }
    say(g.text, g.anim, 14000);
    pushChat('pet', g.text);
    broadcast();
    return;
  }
  const h = new Date().getHours();
  const hi = h < 12 ? '¡Buenos días' : h < 19 ? '¡Buenas tardes' : '¡Buenas noches';
  say(`${hi}! ${p.name} reportándose 🫡`, 'hop', 7000);
}

async function confirmQuit(from = 'menú') {
  if (typeof from !== 'string') from = 'menú';
  const name = store.data.pet.name || 'PM';
  say('¿Me vas a cerrar? 🥺', 'sad', 8000);
  const parent = panelWin && panelWin.isVisible() ? panelWin : petWin;
  const r = await dialog.showMessageBox(parent, {
    type: 'question',
    buttons: ['No, quédate 💛', 'Sí, ciérrate'],
    defaultId: 0,
    cancelId: 0,
    title: name,
    message: `¿Seguro que quieres cerrar a ${name}? 🥺`,
    detail: 'Se acordará… y la próxima vez que lo abras estará enojado 😤',
  });
  if (r.response === 1) {
    quitHow = 'user';
    diag.log('info', `Cerrado por el usuario desde: ${from}`);
    app.quit();
  } else {
    say('¡Yay! Sabía que me querías 💛', 'love', 6000);
  }
}

let nextChatterAt = Date.now() + 20 * 60000;
let lastHungryAt = 0;
function chatter() {
  const now = Date.now();
  const h = new Date().getHours();
  if (h < 7 || h >= 23 || !store.data.pet.name || isMuted() || meetingNow) return;
  const p = store.data.pet;
  if (p.fullness < 25 && now - lastHungryAt > 60 * 60000) {
    lastHungryAt = now;
    say('Pío… tengo hambre 🥺 ¿Me das maicito? 🌽', 'sad', 9000);
    return;
  }
  if ((p.clean ?? 100) < 30 && now - (p.lastDirtyMsg || 0) > 2 * 3600e3) {
    p.lastDirtyMsg = now;
    say('Huelo un poquito raro… 🪰 ¿Un bañito? 🛁', 'wobble', 12000, { cat: 'pet', actions: [{ label: '🛁 Bañar', cmd: 'bath' }] });
    return;
  }
  if ((p.energy ?? 100) < 20 && !(p.napUntil > now) && now - (p.lastTiredMsg || 0) > 2 * 3600e3) {
    p.lastTiredMsg = now;
    say('Estoy agotado… 😪 ¿Me dejas dormir una siestita?', 'yawn', 12000, { cat: 'pet', actions: [{ label: '😴 Siesta (3 min)', cmd: 'nap' }] });
    return;
  }
  if (store.data.settings.chatter && now >= nextChatterAt) {
    nextChatterAt = now + (25 + Math.random() * 25) * 60000;
    say(brain.idleChatter({ usage, day: today(), pet: p, name: p.name }), 'flap', 8000);
  }
}

function feed() {
  const p = store.data.pet;
  if (p.fullness >= 98) {
    say('¡Estoy llenito! No me cabe ni un grano 🫃', 'wobble');
    return;
  }
  p.fullness = clamp(p.fullness + 25);
  p.happiness = clamp(p.happiness + 5);
  p.clean = clamp((p.clean ?? 100) - 6); // come como un pollito: se mancha
  addXp(2);
  store.save();
  animate('eat');
  if (!calmDown(5)) say('¡Ñam ñam! 🌽 Gracias 💛', 'eat');
  broadcast();
}

function petPet() {
  const p = store.data.pet;
  const now = Date.now();
  if (now - (p.lastPetAt || 0) > 3000) {
    p.happiness = clamp(p.happiness + 3);
    p.lastPetAt = now;
    addXp(1);
    store.save();
    animate('love');
    calmDown(4);
    broadcast();
  } else {
    animate('love');
  }
}

// Cronómetro por tarea (solo uno en marcha a la vez).
function taskTimer(index, action) {
  const list = today().standup && today().standup.today;
  const t = list && list[index];
  if (!t) return false;
  const now = Date.now();
  for (const x of list) if (x.startedAt) { x.spent = (x.spent || 0) + (now - x.startedAt) / 1000; delete x.startedAt; }
  if (action === 'start') {
    t.startedAt = now;
    if (!t.est) say(`⏱️ Cronómetro en marcha para "${t.text}". Tip: doble clic en el reloj para poner cuánto estimas.`, 'peck', 6000, { log: false });
  }
  store.save();
  broadcast();
  return true;
}

// ---------- IPC ----------
function setupIpc() {
  ipcMain.handle('get-state', () => snapshot());

  ipcMain.on('pet:ignore', (_e, ignore) => {
    if (!petWin || drag) return;
    petWin.setIgnoreMouseEvents(!!ignore, { forward: true });
  });

  ipcMain.on('pet:drag-start', (_e, { screenX, screenY }) => {
    if (!petWin) return;
    const [x, y] = petWin.getPosition();
    drag = { dx: screenX - x, dy: screenY - y };
    petWin.setIgnoreMouseEvents(false);
  });
  ipcMain.on('pet:drag-move', (_e, { screenX, screenY }) => {
    if (!petWin || !drag) return;
    petWin.setPosition(Math.round(screenX - drag.dx), Math.round(screenY - drag.dy));
    if (panelWin && panelWin.isVisible()) placePanel();
  });
  ipcMain.on('pet:drag-end', () => {
    if (!petWin) return;
    drag = null;
    const [x, y] = petWin.getPosition();
    store.data.position = { x, y };
    // En modo discreto se pega al borde más cercano.
    if (store.data.settings.discreet) {
      const b = petWin.getBounds();
      const wa = screen.getDisplayMatching(b).workArea;
      store.data.settings.dockSide = (b.x + b.width / 2) > wa.x + wa.width / 2 ? 'right' : 'left';
      peekPet(2500);
    }
    store.save();
  });

  ipcMain.on('pet:click', () => togglePanel());
  ipcMain.on('pet:petted', () => petPet());
  ipcMain.on('panel:hide', () => panelWin && panelWin.hide());
  ipcMain.on('panel:open', (_e, view) => openPanel(view));

  ipcMain.handle('chat:send', async (_e, text) => {
    text = String(text || '').trim().slice(0, 500);
    if (!text) return null;
    pushChat('me', text);
    store.data.chatSent = (store.data.chatSent || 0) + 1;
    // "cada lunes: revisar métricas" → tarea recurrente
    if (ex && ex.parseRecurring(text)) {
      const msg = prod.capture(text);
      pushChat('pet', msg);
      broadcast();
      return { text: msg };
    }
    // "modo foco", "no me distraigas 30 min", "focus mode"
    const fm = text.match(/^(?:activa(?:r)? )?(?:el )?(?:modo foco|no me distraigas|focus mode)(?:\D+(\d{1,3})\s*(?:min|m)?)?/i);
    if (fm) {
      const min = Math.max(5, Math.min(240, Number(fm[1]) || 50));
      startFocus(min);
      const msg = `🎯 ¡Hecho! Modo foco ${min} min. Nos vemos al terminar 💪`;
      pushChat('pet', msg);
      broadcast();
      return { text: msg };
    }
    const p = store.data.pet;
    const r = brain.reply(text, {
      name: p.name || 'PM', usage, day: today(), pet: p, level: levelInfo(p.xp || 0), insights,
      mail: { ...mailState, configured: !!mailConfig() || connectedAccounts().length > 0 },
      calendar: { ...calState, configured: !!store.data.settings.calendarUrl || connectedAccounts().length > 0 },
      meetingNow,
    });

    // Con IA activada, todo lo que no sea una acción directa lo responde Claude.
    if (!r.action && aiAvailable()) {
      broadcast();
      if (panelWin) panelWin.webContents.send('chat:thinking', true);
      animate('look');
      try {
        const res = await ai.chat(text);
        pushChat('pet', res.text);
        animate('peck');
      } catch (e) {
        pushChat('pet', (e.message === 'NO_KEY' ? '' : '😿 ' + e.message + '\n') + r.text);
      } finally {
        if (panelWin) panelWin.webContents.send('chat:thinking', false);
      }
      checkAchievements();
      broadcast();
      return { text: '' };
    }

    pushChat('pet', r.text);
    if (r.action === 'feed') feed();
    else if (r.action === 'pet') petPet();
    else if (r.action === 'allow') {
      const day = today();
      if (fx.cat === 'distraction' || (fx.distractSince && fx.label)) {
        day.focusAllow = { ...(day.focusAllow || {}), [fx.label]: true };
        fx.distractSince = null; fx.scoldLevel = 0; fx.scolded = false; fx.sentKey = '';
        r.text = `Vale… hoy ${fx.label} cuenta como trabajo 🤨 Te creo. Por ahora.`;
      } else {
        setMute(30);
        r.text = 'Vale, te dejo tranquilo 30 minutos 🤫';
      }
      store.data.chat[store.data.chat.length - 1].text = r.text;
      store.save();
    } else if (['bath', 'nap', 'medicine'].includes(r.action)) {
      runCommand(r.action);
    } else if (r.action === 'pomo-start') {
      prod.pomoStart();
    } else if (r.action === 'pomo-stop') {
      prod.pomoStop();
    } else if (r.action === 'remind') {
      const msg = prod.capture(text);
      r.text = msg || 'No entendí la hora 🤔 Prueba: "recuérdame a las 3 revisar el informe" o "recuérdame en 20 min llamar a Ana".';
      store.data.chat[store.data.chat.length - 1].text = r.text;
    } else if (r.action === 'report' || r.action === 'daily-copy') {
      setTimeout(() => panelWin && panelWin.webContents.send('panel:view', r.action === 'report' ? 'report' : 'daily-copy'), 400);
    } else if (r.action === 'mute') {
      setMute(60);
    } else if (r.action === 'unmute') {
      setMute(0);
    } else if (r.action === 'forgive') {
      store.data.life.angryUntil = 0;
      store.flush();
      animate('love');
    }
    else if (r.anim) animate(r.anim);
    if (r.action === 'standup' || r.action === 'review') {
      setTimeout(() => panelWin && panelWin.webContents.send('panel:view', r.action), 600);
    }
    broadcast();
    return r;
  });

  ipcMain.on('pet:feed', () => feed());
  ipcMain.on('pet:pet', () => petPet());

  ipcMain.handle('pet:rename', (_e, name) => {
    name = String(name || '').trim().slice(0, 24);
    if (!name) return false;
    const first = !store.data.pet.name;
    store.data.pet.name = name;
    if (!store.data.pet.born) store.data.pet.born = Date.now();
    if (first && !store.data.settings.autoStartAsked) {
      store.data.settings.autoStartAsked = true;
      setAutoStart(true); // siempre ahí: arranca con Windows (se puede quitar en Ajustes)
    }
    store.flush();
    if (tray) tray.refreshMenu();
    say(first ? `¡Pío! Me llamo ${name} 🐣💛 ¡Seré tu PM!` : `¡Ahora me llamo ${name}! 💛`, 'celebrate', 9000);
    if (first) pushChat('pet', `¡Hola! Soy ${name}, tu pollito Project Manager 🐣📋. Pregúntame "¿cuánto llevo?" o escribe "ayuda".`);
    broadcast();
    return true;
  });

  ipcMain.handle('standup:save', (_e, { yesterday, tasks, help }) => {
    const day = today();
    const list = (tasks || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 30);
    const wasDone = new Set(((day.standup && day.standup.today) || []).filter((t) => t.done).map((t) => t.text));
    day.standup = { yesterday: String(yesterday || '').trim(), today: list.map((text) => ({ text, done: wasDone.has(text) })), help: String(help || '').trim(), at: Date.now() };
    delete day.snoozeStandup;
    const p = store.data.pet;
    p.happiness = clamp(p.happiness + 10);
    if (!day.standup.xpGiven) { day.standup.xpGiven = true; addXp(15); }
    store.save();
    let msg = `¡Anotado! Hoy tienes ${list.length} tarea${list.length === 1 ? '' : 's'} 📋`;
    if (day.standup.help) msg += `. Sobre "${day.standup.help}": lo tendré presente y te lo recordaré durante el día 💛`;
    msg += ` Antes de las ${store.data.settings.eveningTime} te pregunto cómo te fue.`;
    pushChat('pet', msg);
    say(`¡Plan listo! ${list.length} tareas para hoy 💪`, 'celebrate', 8000);
    broadcast();
    return true;
  });

  ipcMain.handle('task:toggle', (_e, { date, index }) => {
    const day = store.data.days[date || dayKey()];
    const t = day && day.standup && day.standup.today[index];
    if (!t) return false;
    t.done = !t.done;
    // Al terminarla, se para su cronómetro.
    if (t.done && t.startedAt) { t.spent = (t.spent || 0) + (Date.now() - t.startedAt) / 1000; delete t.startedAt; }
    if (t.done) {
      store.data.pet.happiness = clamp(store.data.pet.happiness + 4);
      if (!t.xp) { t.xp = true; addXp(10); }
      const all = day.standup.today.every((x) => x.done);
      say(all ? '¡TODAS las tareas listas! 🎉🎉' : `¡Bien! "${t.text}" ✅`, all ? 'celebrate' : 'dance', 6000);
    }
    store.save();
    broadcast();
    return true;
  });

  ipcMain.handle('task:add', (_e, text) => {
    text = String(text || '').trim().slice(0, 200);
    if (!text) return false;
    const day = today();
    if (!day.standup) day.standup = { yesterday: '', today: [], help: '', at: Date.now() };
    day.standup.today.push({ text, done: false });
    store.save();
    animate('peck');
    broadcast();
    return true;
  });

  ipcMain.handle('task:remove', (_e, index) => {
    const day = today();
    if (!day.standup || !day.standup.today[index]) return null;
    const [removed] = day.standup.today.splice(index, 1);
    if (removed.remId) store.data.reminders = (store.data.reminders || []).filter((r) => r.id !== removed.remId);
    store.save();
    broadcast();
    return removed; // el panel lo usa para "Deshacer"
  });

  ipcMain.handle('review:save', (_e, { done, notes, carry, mood }) => {
    const day = today();
    const tasks = (day.standup && day.standup.today) || [];
    tasks.forEach((t, i) => (t.done = !!(done && done[i])));
    if (mood >= 1 && mood <= 5) day.mood = Math.round(mood);
    for (const t of tasks) if (t.startedAt) { t.spent = (t.spent || 0) + (Date.now() - t.startedAt) / 1000; delete t.startedAt; }
    const n = tasks.filter((t) => t.done).length;
    day.review = { at: Date.now(), notes: String(notes || '').trim(), carry: !!carry, done: n, total: tasks.length };
    delete day.snoozeReview;
    const ratio = tasks.length ? n / tasks.length : 1;
    if (!day.reviewXp) { day.reviewXp = true; addXp(15); }
    const p = store.data.pet;
    p.happiness = clamp(p.happiness + 5 + Math.round(ratio * 15));
    store.save();
    let msg, anim;
    if (ratio === 1) { msg = `¡Cumpliste TODO (${n}/${tasks.length})! Eres increíble 🏆🎉`; anim = 'celebrate'; }
    else if (ratio >= 0.5) { msg = `¡Buen día! ${n}/${tasks.length} tareas ✅ Lo demás, mañana 💪`; anim = 'dance'; }
    else { msg = `${n}/${tasks.length} hoy. No pasa nada, mañana lo sacamos juntos 🫂`; anim = 'hug'; }
    if (carry && n < tasks.length) msg += ' Pasé tus pendientes a mañana 📌';
    pushChat('pet', msg);
    if (day.focus) pushChat('pet', brain.focusSummary(day));
    say(msg, anim, 10000);
    broadcast();
    return true;
  });

  ipcMain.handle('snooze', (_e, kind) => {
    const day = today();
    const key = kind === 'review' ? 'snoozeReview' : 'snoozeStandup';
    day[key] = Date.now() + 30 * 60000;
    store.save();
    say('¡Vale! Te vuelvo a preguntar en 30 minutos ⏰', 'peck');
    return true;
  });

  ipcMain.handle('settings:update', (_e, patch) => {
    const allowed = ['morningTime', 'eveningTime', 'workdaysOnly', 'chatter', 'focusWatch', 'sounds', 'lang', 'aiModel', 'aiEnabled', 'autoHide', 'voice', 'smartClipboard', 'followMonitor', 'strolls', 'autoBackup', 'focusDuringBlocks', 'focusDuringPomodoro'];
    if ('aiModel' in patch && !aiMod.MODELS[patch.aiModel]) delete patch.aiModel;
    if ('lang' in patch && !['es', 'en'].includes(patch.lang)) delete patch.lang;
    if ('lang' in patch && tray) setTimeout(() => tray.refreshMenu(), 50);
    for (const k of allowed) if (k in patch) store.data.settings[k] = patch[k];
    if (patch.focusWatch === false && petWin) {
      fx.cat = null;
      fx.sentKey = '';
      petWin.webContents.send('pet:focus', { cat: null, scoldLevel: 0, idle: 0 });
    }
    if ('autoStart' in patch) setAutoStart(patch.autoStart);
    store.save();
    broadcast();
    return true;
  });

  ipcMain.handle('token:set', async (_e, token) => {
    token = String(token || '').trim();
    if (!token) store.data.settings.manualToken = '';
    else {
      store.data.settings.manualToken = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(token).toString('base64')
        : Buffer.from(token, 'utf8').toString('base64');
    }
    store.save();
    await refreshUsage(true);
    return snapshot();
  });

  ipcMain.handle('usage:refresh', async () => {
    await refreshUsage(true);
    return snapshot();
  });

  ipcMain.on('open-external', (_e, url) => {
    const ok = /^https:\/\/(docs\.claude\.com|claude\.ai|code\.claude\.com|www\.anthropic\.com|myaccount\.google\.com|calendar\.google\.com|outlook\.office\.com|outlook\.live\.com|login\.yahoo\.com|account\.apple\.com|github\.com|console\.anthropic\.com)\//;
    if (ok.test(url)) shell.openExternal(url);
  });

  ipcMain.handle('web:login', async () => {
    say('Te abrí la página de Claude 🌐 Entra con tu CORREO (Google a veces no deja dentro de apps). Yo espero aquí 🐣', 'peck', 15000);
    pushChat('pet', 'Para conectarme: en la ventana de Claude escribe tu correo → te llega un código o enlace → ponlo ahí. Es solo una vez: después me acuerdo 💛');
    if (panelWin) panelWin.hide();
    const org = await claudeWeb.login();
    openPanel('usage');
    if (!org) say('Cerraste la ventana sin entrar 😿 Cuando quieras, vuelve a pulsar "Conectar".', 'sad', 9000);
    if (org) {
      store.data.web = { orgId: org.id, orgName: org.name };
      store.flush();
      await refreshUsage();
      const ok = usage.connection.status === 'ok';
      say(ok ? '¡Conectado a tu cuenta de Claude! 🎉 Ya veo tus límites.' : 'Entraste, pero no pude leer tu uso todavía 😿', ok ? 'celebrate' : 'sad', 9000);
    }
    broadcast();
    return snapshot();
  });

  ipcMain.handle('web:logout', async () => {
    await claudeWeb.logout();
    store.data.web = { orgId: null, orgName: null };
    store.flush();
    await refreshUsage();
    return snapshot();
  });

  ipcMain.on('panel:view-changed', (_e, view) => {
    if (['chat', 'usage', 'day', 'agenda', 'pet'].includes(view)) {
      store.data.life.lastView = view;
      store.save();
    }
  });

  ipcMain.on('pet:context', () => {
    const name = store.data.pet.name || 'PM';
    Menu.buildFromTemplate([
      { label: `🐣 ${name} · nivel ${levelInfo(store.data.pet.xp || 0).level}`, enabled: false },
      { type: 'separator' },
      { label: '💬 Abrir panel', click: () => openPanel('chat') },
      { label: '🔍 Buscar comando…  (Ctrl+Alt+Espacio)', click: openPalette },
      { label: `🔔 Centro de avisos${(store.data.inbox || []).filter((x) => !x.read && x.cat !== 'pet').length ? ` (${(store.data.inbox || []).filter((x) => !x.read && x.cat !== 'pet').length})` : ''}`, click: () => openPanel('inbox') },
      prod && prod.pomoState()
        ? { label: '⏹️ Detener pomodoro', click: () => prod.pomoStop() }
        : { label: '🍅 Empezar pomodoro (25 min)', click: () => prod.pomoStart() },
      { label: '✍️ Anotar rápido…  (Ctrl+Alt+P)', click: openCapture },
      { label: '🎮 Minijuego: atrapa el maíz', click: openGame },
      { label: '📈 Estadísticas', click: () => openPanel('stats') },
      { label: '🛍️ Tienda', click: () => openPanel('shop') },
      { label: '📊 ¿Cuánto llevo?', click: () => openPanel('usage') },
      { label: '🌽 Dar de comer', click: feed },
      { label: '💛 Acariciar', click: petPet },
      { type: 'separator' },
      { label: '☀️ Daily de la mañana', click: () => openPanel('standup') },
      { label: '🌇 Cierre del día', click: () => openPanel('review') },
      { type: 'separator' },
      isMuted()
        ? { label: '🔔 Quitar silencio', click: () => { setMute(0); say('¡Volví! 🐣', 'hop'); } }
        : { label: '🔕 Silenciar 1 hora (reunión)', click: () => { setMute(60); say('Shhh 🤫 Te dejo tranquilo 1 hora.', 'peck'); } },
      { label: '🙈 Ocultar (sigue en la bandeja)', click: () => { petWin.hide(); if (panelWin) panelWin.hide(); if (tray) tray.refreshMenu(); } },
      { type: 'separator' },
      { label: '⚙️ Ajustes…', click: () => openSettings() },
      { label: 'ℹ️ Acerca de PM Pollito…', click: openAbout },
      { label: '❌ Cerrar PM', click: () => confirmQuit('menú del pollito') },
    ]).popup({ window: petWin });
  });

  // ----- cuentas: inicio de sesión web (Microsoft / Google) -----
  ipcMain.handle('account:connect', async (_e, provider) => {
    if (!['microsoft', 'google'].includes(provider)) return { ok: false, error: 'Proveedor desconocido.' };
    if (!oauthReady()[provider]) {
      return { ok: false, error: `Falta el ID de aplicación de ${PROVIDER_LABEL[provider]} en oauth.config.json (ver README).` };
    }
    say(`Te abrí el navegador 🌐 Inicia sesión con ${PROVIDER_LABEL[provider]} y pulsa "Aceptar". Yo espero aquí 🐣`, 'peck', 15000);
    try {
      const acc = await accounts.connect(provider, accountIo);
      store.data.settings.accounts = { ...(store.data.settings.accounts || {}), [provider]: acc };
      delete accountErrors[provider];
      store.data.mailSeen = null; // la primera lectura solo memoriza
      store.flush();
      openPanel('agenda');
      await refreshCalendar();
      await refreshMail();
      const n = todaysMeetings().length;
      const unseen = mailState.unseen || 0;
      say(`¡${acc.email || PROVIDER_LABEL[provider]} conectado! 🎉 Hoy: ${n} reunion${n === 1 ? '' : 'es'} y ${unseen} correos sin leer.`, 'celebrate', 10000);
      return { ok: true, state: snapshot() };
    } catch (e) {
      openPanel('agenda');
      say('No se pudo conectar 😿 ' + e.message, 'sad', 10000);
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('account:remove', async (_e, provider) => {
    const all = { ...(store.data.settings.accounts || {}) };
    delete all[provider];
    store.data.settings.accounts = all;
    accounts.forget(provider);
    delete accountErrors[provider];
    store.flush();
    await refreshCalendar();
    await refreshMail();
    return snapshot();
  });

  // ----- correo -----
  ipcMain.handle('mail:save', async (_e, cfg) => {
    const preset = mail.PRESETS[cfg.provider] || mail.PRESETS.custom;
    const host = String(cfg.host || preset.host || '').trim();
    const user = String(cfg.user || '').trim();
    const pass = String(cfg.pass || '').replace(/\s+/g, ''); // las contraseñas de app de Google vienen con espacios
    if (!host || !user || !pass) return { ok: false, error: 'Faltan datos: servidor, correo y contraseña de aplicación.' };
    try {
      await mail.check({ host, port: cfg.port || preset.port, user, pass });
    } catch (e) {
      return { ok: false, error: e.message };
    }
    store.data.settings.mail = { provider: cfg.provider, host, port: Number(cfg.port || preset.port) || 993, user, passEnc: encrypt(pass) };
    store.data.mailSeen = null; // la primera lectura solo memoriza
    store.flush();
    await refreshMail(true);
    return { ok: true, state: snapshot() };
  });
  ipcMain.handle('mail:remove', async () => {
    store.data.settings.mail = null;
    store.data.mailSeen = null;
    store.flush();
    await refreshMail();
    return snapshot();
  });
  ipcMain.handle('mail:refresh', async () => { await refreshMail(); return snapshot(); });

  // ----- agenda -----
  ipcMain.handle('cal:save', async (_e, url) => {
    url = String(url || '').trim();
    try {
      const from = new Date(); from.setHours(0, 0, 0, 0);
      await calendar.load(url, from.getTime(), from.getTime() + 864e5);
    } catch (e) {
      return { ok: false, error: e.message };
    }
    store.data.settings.calendarUrl = encrypt(url);
    store.flush();
    await refreshCalendar(true);
    return { ok: true, state: snapshot() };
  });
  ipcMain.handle('cal:remove', async () => {
    store.data.settings.calendarUrl = '';
    store.flush();
    await refreshCalendar();
    return snapshot();
  });
  ipcMain.handle('cal:refresh', async () => { await refreshCalendar(); return snapshot(); });
  ipcMain.on('join', (_e, url) => joinMeeting(url));

  // ----- productividad -----
  ipcMain.on('pomo:start', () => prod.pomoStart());
  ipcMain.on('pomo:stop', () => prod.pomoStop());
  ipcMain.handle('reminder:add', (_e, text) => {
    const r = prod.addReminder(String(text || '').match(/^\s*(recu[eé]rdame|av[ií]same)/i) ? text : 'recuérdame ' + text);
    return r;
  });
  ipcMain.on('reminder:remove', (_e, id) => prod.removeReminder(id));
  ipcMain.handle('capture:submit', (_e, text) => {
    const msg = prod.capture(text);
    store.data.flags = { ...(store.data.flags || {}), usedCapture: true };
    if (captureWin && !captureWin.isDestroyed()) captureWin.hide();
    return msg;
  });
  ipcMain.on('capture:close', () => { if (captureWin && !captureWin.isDestroyed()) captureWin.hide(); });
  ipcMain.handle('git:yesterday', async () => prod.lastWorkdayCommits());
  ipcMain.handle('git:refresh', async () => { await prod.gitRefresh(); return snapshot(); });
  ipcMain.handle('github:token', async (_e, token) => {
    store.data.settings.githubToken = token ? encrypt(String(token).trim()) : '';
    store.flush();
    const r = await prod.ghRefresh();
    if (r.status === 'ok') say(`¡GitHub conectado como @${r.login}! 🐙 ${r.toReview.length} PRs esperan tu revisión.`, 'celebrate', 9000);
    return snapshot();
  });
  ipcMain.handle('github:refresh', async () => { await prod.ghRefresh(); return snapshot(); });
  ipcMain.on('open-pr', (_e, url) => openSafeUrl(url));
  ipcMain.handle('hooks:install', () => {
    try {
      prod.hooksInstall();
      say('¡Conectado con Claude Code! 🤖 Te aviso cuando Claude termine o te necesite. (Reinicia tus sesiones de Claude Code)', 'celebrate', 11000);
      return { ok: true, state: snapshot() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('hooks:uninstall', () => {
    try { prod.hooksUninstall(); return { ok: true, state: snapshot() }; } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('report:weekly', () => prod.weeklyReport());
  ipcMain.handle('report:daily', () => prod.dailyText());
  ipcMain.handle('copy', (_e, text) => { clipboard.writeText(String(text || '')); return true; });
  ipcMain.handle('timesheet:export', async () => {
    const parent = panelWin && panelWin.isVisible() ? panelWin : petWin;
    const r = await dialog.showSaveDialog(parent, {
      title: 'Exportar horas por proyecto',
      defaultPath: path.join(app.getPath('documents'), `horas-pm-${dayKey()}.csv`),
      filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }],
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, prod.timesheet());
    shell.showItemInFolder(r.filePath);
    return r.filePath;
  });
  ipcMain.handle('settings:integrations', async (_e, patch) => {
    if (Array.isArray(patch.gitRoots)) store.data.settings.gitRoots = patch.gitRoots.map((x) => String(x).trim()).filter(Boolean);
    if (patch.health) store.data.settings.health = { ...(store.data.settings.health || {}), ...patch.health };
    store.save();
    if (patch.gitRoots) prod.gitRefresh();
    broadcast();
    return snapshot();
  });

  // ----- IA -----
  ipcMain.handle('ai:setKey', async (_e, key) => {
    key = String(key || '').trim();
    store.data.settings.aiKey = key ? encrypt(key) : '';
    store.data.settings.aiEnabled = true;
    store.flush();
    if (ai) ai.reset();
    if (!key) return { ok: true, state: snapshot() };
    try {
      const r = await ai.chat(lang() === 'en' ? 'Say hi in one short sentence.' : 'Salúdame en una frase corta.');
      pushChat('pet', r.text);
      say(r.text, 'celebrate', 8000);
      return { ok: true, state: snapshot() };
    } catch (e) {
      return { ok: false, error: e.message === 'NO_KEY' ? 'Falta la API key.' : e.message, state: snapshot() };
    }
  });
  ipcMain.handle('ai:polish', async (_e, { text, kind }) => {
    if (!aiAvailable()) return { ok: false, error: 'Activa la IA en 🐣 Perfil → IA.' };
    const instr = kind === 'daily'
      ? (lang() === 'en' ? 'Rewrite this daily stand-up to be clear, concise and professional for Slack/Teams. Keep the same facts and format (bullets).' : 'Reescribe este daily para que sea claro, conciso y profesional para Slack/Teams. Mantén los mismos datos y el formato con viñetas.')
      : (lang() === 'en' ? 'Turn this weekly report into a polished summary for my manager: 3-line executive summary at the top, then the key points. Keep all facts, do not invent anything.' : 'Convierte este informe semanal en un resumen pulido para mi jefe: resumen ejecutivo de 3 líneas arriba y luego los puntos clave. Mantén todos los datos y no inventes nada.');
    try {
      return { ok: true, text: await ai.polish(text, instr) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ----- tienda, logros, estadísticas -----
  ipcMain.handle('shop:buy', (_e, id) => { const r = buyItem(id); return { ...r, state: snapshot() }; });
  ipcMain.handle('shop:equip', (_e, id) => { const r = equipItem(id); return { ...r, state: snapshot() }; });
  ipcMain.handle('shop:unequip', (_e, slot) => { unequipSlot(slot); return snapshot(); });
  ipcMain.handle('stats:get', () => statsData());

  // ----- monitor de sitios -----
  ipcMain.handle('monitor:add', async (_e, { url, name }) => {
    const u = monitor.normalize(url);
    if (!u) return { ok: false, error: 'URL no válida.' };
    const list = store.data.settings.monitors || [];
    if (list.length >= 15) return { ok: false, error: 'Máximo 15 sitios.' };
    list.push({ id: Date.now().toString(36), url: u, name: String(name || '').trim().slice(0, 40) });
    store.data.settings.monitors = list;
    store.save();
    await checkMonitors(false);
    return { ok: true, state: snapshot() };
  });
  ipcMain.handle('monitor:remove', (_e, id) => {
    store.data.settings.monitors = (store.data.settings.monitors || []).filter((m) => m.id !== id);
    delete monitorState[id];
    store.save();
    return snapshot();
  });
  ipcMain.handle('monitor:check', async () => { await checkMonitors(false); return snapshot(); });
  ipcMain.on('open-monitor', (_e, id) => {
    const m = (store.data.settings.monitors || []).find((x) => x.id === id);
    if (m) shell.openExternal(m.url);
  });

  // ----- minijuego -----
  ipcMain.on('game:open', () => openGame());
  ipcMain.handle('game:end', (_e, score) => {
    score = Math.max(0, Math.min(500, Math.floor(Number(score) || 0)));
    const p = store.data.pet;
    const best = score > (p.bestScore || 0);
    if (best) p.bestScore = score;
    p.coins = (p.coins || 0) + score;
    p.happiness = clamp(p.happiness + 8);
    store.save();
    say(`🎮 ¡${score} granos atrapados! +${score} 🌽${best ? ' ¡NUEVO RÉCORD! 🏆' : ''}`, 'celebrate', 9000);
    checkAchievements();
    broadcast();
    return { best: p.bestScore, coins: Math.floor(p.coins) };
  });
  ipcMain.on('game:close', () => { if (gameWin && !gameWin.isDestroyed()) gameWin.close(); });

  // ----- actualizaciones -----
  ipcMain.handle('update:check', async () => checkUpdates(true));

  // ----- comandos (botones de avisos, paleta, atajos) -----
  ipcMain.on('pet:action', (_e, { cmd, arg }) => runCommand(cmd, arg));
  ipcMain.on('command', (_e, { cmd, arg }) => runCommand(cmd, arg));
  ipcMain.handle('palette:list', () => paletteCommands());
  ipcMain.handle('palette:search', (_e, q) => (ex ? ex.search(q).map((r) => ({ ...r, label: r.label, hint: T(r.hint) })) : []));
  // ----- recurrentes, plantillas, modo foco y diagnóstico -----
  ipcMain.handle('recurring:add', (_e, r) => ex.addRecurring(r || {}));
  ipcMain.handle('recurring:delete', (_e, id) => ex.deleteRecurring(id));
  ipcMain.handle('templates:apply', (_e, id) => ex.applyTemplate(id));
  ipcMain.handle('templates:save', (_e, name) => ex.saveTemplate(name));
  ipcMain.handle('templates:delete', (_e, id) => ex.deleteTemplate(id));
  ipcMain.handle('focus:start', (_e, min) => { startFocus(Math.max(5, Math.min(240, Number(min) || 50))); return true; });
  ipcMain.handle('focus:stop', () => { endFocus(); return true; });
  ipcMain.handle('diag:get', () => diag.metrics(app));
  ipcMain.handle('diag:copy', () => {
    clipboard.writeText(diag.report(app, { Idioma: lang(), Empaquetada: app.isPackaged ? 'sí' : 'no', 'Claude conectado': usage.connection && usage.connection.status }));
    return true;
  });
  ipcMain.handle('diag:open', () => { const f = diag.metrics(app).logFile; if (f && fs.existsSync(f)) shell.showItemInFolder(f); else shell.openPath(app.getPath('userData')); return true; });
  ipcMain.on('diag:error', (e, msg) => diag.log('ventana', String(msg).slice(0, 2000)));
  ipcMain.handle('palette:run', (_e, { id, arg }) => {
    if (paletteWin && !paletteWin.isDestroyed()) paletteWin.hide();
    return runCommand(id, arg);
  });
  ipcMain.handle('palette:text', async (_e, text) => {
    if (paletteWin && !paletteWin.isDestroyed()) paletteWin.hide();
    text = String(text || '').trim();
    if (!text) return false;
    if (/^\s*(recu[eé]rdame|av[ií]same|remind me)\b/i.test(text) || /^(tarea|todo|task)\s*:/i.test(text) || (ex && ex.parseRecurring(text))) {
      prod.capture(text);
    } else {
      openPanel('chat');
      setTimeout(() => panelWin && panelWin.webContents.send('chat:ask', text), 250);
    }
    return true;
  });
  ipcMain.on('palette:close', () => { if (paletteWin && !paletteWin.isDestroyed()) paletteWin.hide(); });

  // ----- centro de avisos -----
  ipcMain.handle('inbox:read', (_e, id) => {
    for (const x of store.data.inbox || []) if (!id || x.id === id) x.read = true;
    store.save();
    broadcast();
    return true;
  });
  ipcMain.handle('inbox:clear', () => { store.data.inbox = []; store.save(); broadcast(); return true; });

  // ----- ventanas -----
  ipcMain.on('settings:open', (_e, section) => openSettings(section));
  ipcMain.on('settings:close', () => { if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close(); });
  ipcMain.on('about:open', () => openAbout());
  ipcMain.on('about:close', () => { if (aboutWin && !aboutWin.isDestroyed()) aboutWin.close(); });
  ipcMain.on('palette:open', () => openPalette());
  ipcMain.on('open-data-dir', () => shell.openPath(app.getPath('userData')));

  // ----- apariencia y privacidad -----
  ipcMain.handle('appearance:set', (_e, patch) => {
    const s = store.data.settings;
    if (patch.theme && ['system', 'light', 'dark'].includes(patch.theme)) s.theme = patch.theme;
    if ('reducedMotion' in patch) s.reducedMotion = !!patch.reducedMotion;
    if ('volume' in patch) s.volume = Math.max(0, Math.min(100, Number(patch.volume) || 0));
    store.save();
    if (patch.petSize) setPetSize(patch.petSize);
    if ('discreet' in patch && !!patch.discreet !== !!s.discreet) setDiscreet(patch.discreet);
    broadcast();
    return snapshot();
  });
  ipcMain.handle('tracking:pause', (_e, minutes) => { pauseTracking(minutes); return snapshot(); });
  ipcMain.handle('privacy:set', (_e, patch) => {
    const s = store.data.settings;
    if ('micWatch' in patch) s.micWatch = !!patch.micWatch;
    if ('gitWatch' in patch) s.gitWatch = !!patch.gitWatch;
    store.save();
    broadcast();
    return snapshot();
  });
  ipcMain.handle('data:export', () => exportData());
  ipcMain.handle('data:import', () => importData());
  ipcMain.handle('data:delete', () => deleteAllData());
  ipcMain.handle('flags:set', (_e, patch) => { store.data.flags = { ...(store.data.flags || {}), ...patch }; store.save(); broadcast(); return true; });

  // ----- tareas editables -----
  const taskAt = (i) => today().standup && today().standup.today[i];
  ipcMain.handle('task:edit', (_e, { index, text }) => {
    const t = taskAt(index);
    text = String(text || '').trim().slice(0, 200);
    if (!t || !text) return false;
    t.text = text;
    store.save();
    broadcast();
    return true;
  });
  ipcMain.handle('task:move', (_e, { from, to }) => {
    const list = today().standup && today().standup.today;
    if (!list || !list[from] || to < 0 || to >= list.length) return false;
    const [t] = list.splice(from, 1);
    list.splice(to, 0, t);
    store.save();
    broadcast();
    return true;
  });
  ipcMain.handle('task:update', (_e, { index, patch }) => {
    const t = taskAt(index);
    if (!t) return false;
    if ('priority' in patch) t.priority = ['h', 'm', 'l'].includes(patch.priority) ? patch.priority : undefined;
    if ('est' in patch) t.est = Math.max(0, Math.min(600, Math.round(Number(patch.est) || 0))) || undefined;
    if ('time' in patch) {
      if (t.remId) store.data.reminders = (store.data.reminders || []).filter((r) => r.id !== t.remId);
      t.time = /^\d{2}:\d{2}$/.test(patch.time || '') ? patch.time : undefined;
      t.remId = undefined;
      if (t.time) {
        const [h, m] = t.time.split(':').map(Number);
        const at = new Date(); at.setHours(h, m, 0, 0);
        if (at > new Date()) t.remId = prod.addReminderAt(at.getTime(), `📌 ${t.text}`).id;
      }
    }
    store.save();
    broadcast();
    return true;
  });
  ipcMain.handle('task:timer', (_e, { index, action }) => taskTimer(index, action));

  // ----- diario de Claude, prompts, bloques, objetivos, hábitos, notas, copias, informe mensual -----
  ipcMain.handle('journal:ai', (_e, which) => ex.aiJournal(which));
  ipcMain.handle('journal:refresh', () => { ex.claudeJournal(true); broadcast(); return true; });
  ipcMain.handle('prompts:copy', (_e, id) => ex.copyPrompt(id));
  ipcMain.handle('prompts:save', (_e, p) => ex.savePrompt(p || {}));
  ipcMain.handle('prompts:delete', (_e, id) => ex.deletePrompt(id));
  ipcMain.handle('blocks:set', (_e, list) => ex.setBlocks(list));
  ipcMain.handle('goals:save', (_e, g) => ex.saveGoal(g || {}));
  ipcMain.handle('goals:delete', (_e, id) => ex.deleteGoal(id));
  ipcMain.handle('habits:step', (_e, { id, delta }) => ex.habitStep(id, delta > 0 ? 1 : -1));
  ipcMain.handle('habits:save', (_e, h) => ex.saveHabit(h || {}));
  ipcMain.handle('habits:delete', (_e, id) => ex.deleteHabit(id));
  ipcMain.handle('notes:set', (_e, text) => ex.setNotes(text));
  ipcMain.handle('notes:search', (_e, q) => ex.searchNotes(q));
  ipcMain.handle('backup:now', () => ex.backupNow(true));
  ipcMain.handle('backup:dir', (e) => ex.chooseBackupDir(BrowserWindow.fromWebContents(e.sender)));
  ipcMain.handle('backup:open', () => { const d = snapshot().backup.dir; fs.mkdirSync(d, { recursive: true }); shell.openPath(d); return true; });
  ipcMain.handle('monthly:pdf', (e, which) => ex.monthlyPdf(BrowserWindow.fromWebContents(e.sender), which));
  ipcMain.handle('pet:species', (_e, sp) => {
    if (!['chick', 'duck', 'cat', 'penguin'].includes(sp)) return false;
    store.data.pet.species = sp;
    store.save();
    broadcast();
    animate('celebrate');
    return true;
  });
  ipcMain.handle('pet:play', (_e, kind) => runCommand({ corn: 'play.corn', ball: 'play.ball', stroll: 'play.stroll' }[kind]));

  ipcMain.handle('task:restore', (_e, { index, task }) => {
    const day = today();
    if (!day.standup) day.standup = { yesterday: '', today: [], help: '', at: Date.now() };
    const list = day.standup.today;
    const t = { text: String(task.text || ''), done: !!task.done, priority: task.priority, time: task.time };
    // Si tenía hora, vuelve a crear su recordatorio.
    if (t.time && /^\d{2}:\d{2}$/.test(t.time)) {
      const [h, m] = t.time.split(':').map(Number);
      const at = new Date(); at.setHours(h, m, 0, 0);
      if (at > new Date()) t.remId = prod.addReminderAt(at.getTime(), `📌 ${t.text}`).id;
    }
    list.splice(Math.max(0, Math.min(index, list.length)), 0, t);
    store.save();
    broadcast();
    return true;
  });
  ipcMain.handle('reminder:restore', (_e, r) => { prod.addReminderAt(r.at, r.text); return true; });

  // ----- modo discreto: el pollito se asoma al pasar el ratón -----
  ipcMain.on('pet:hover', (_e, on) => {
    if (!store.data.settings.discreet) return;
    if (on) { clearTimeout(dockTimer); dockPet(true); } else peekPet(2500);
  });

  ipcMain.on('app:quit', () => confirmQuit('ajustes'));
}

// ---------- arranque ----------
app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('com.pm.pollito');
  store = new Store(app.getPath('userData'));
  markStarted();
  setupIpc();
  createPet();
  createPanel();
  buildTray();
  // Si el proceso de una ventana se cae (memoria, GPU…), se recarga sola en vez de desaparecer.
  const revive = (getWin, name) => {
    const w = getWin();
    if (!w) return;
    w.webContents.on('render-process-gone', (_e, d) => {
      if (quitting || d.reason === 'clean-exit') return;
      diag.log('main', `La ventana ${name} se cayó (${d.reason}); la recupero`);
      setTimeout(() => { const x = getWin(); if (x && !x.isDestroyed()) x.webContents.reload(); }, 800);
    });
  };
  revive(() => petWin, 'del pollito');
  revive(() => panelWin, 'del panel');
  // La GPU caída deja las ventanas transparentes en blanco o invisibles: recarga el pollito.
  app.on('child-process-gone', (_e, d) => {
    if (quitting) return;
    diag.log('main', `Proceso ${d.type} caído (${d.reason})`);
    if (d.type === 'GPU' && petWin && !petWin.isDestroyed()) setTimeout(() => petWin.webContents.reload(), 1500);
  });
  if (startup && startup.how === 'killed') diag.log('main', 'La sesión anterior terminó de golpe (proceso terminado desde fuera o fallo grave).');

  // Los ojos siguen al cursor.
  let lastCursor = '';
  setInterval(() => {
    if (!petWin || petWin.isDestroyed() || !petWin.isVisible()) return;
    const c = screen.getCursorScreenPoint();
    const b = petWin.getBounds();
    const k = `${c.x - b.x},${c.y - b.y}`;
    if (k !== lastCursor) {
      lastCursor = k;
      const f = b.width / PET_W; // con zoom, las coordenadas de la página son más pequeñas
      petWin.webContents.send('pet:cursor', { x: (c.x - b.x) / f, y: (c.y - b.y) / f });
    }
  }, 90);

  petWin.webContents.once('did-finish-load', () => {
    petTick();
    applyPetSize();
    if (store.data.settings.discreet) setTimeout(() => dockPet(false), 1500);
    setTimeout(greetOnStart, 800);
  });
  // Apagado o cierre de sesión de Windows: no cuenta como "me cerraste".
  petWin.on('session-end', () => {
    quitHow = 'shutdown';
    markStopped('shutdown');
  });

  prod = productivity.create({
    store,
    appDir: __dirname,
    command: (cmd, arg) => runCommand(cmd, arg),
    // Dónde buscar repos si el usuario no configuró carpetas: en desarrollo, junto a este proyecto;
    // instalado, en las carpetas habituales de cualquier persona.
    defaultGitRoots: () => {
      if (!app.isPackaged) return [path.dirname(__dirname)];
      const h = os.homedir();
      return ['Desktop', 'Escritorio', 'Documents', 'Documentos', path.join('source', 'repos'), 'repos', 'dev', 'projects', 'Proyectos', 'code']
        .map((d) => path.join(h, d))
        .filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
    },
    say,
    animate,
    send: sendPet,
    pushChat,
    broadcast,
    addXp,
    isMuted,
    getMeeting: () => meetingNow,
    today,
    notify,
    openUrl: openSafeUrl,
    decrypt,
    encrypt,
    addTask,
    getUsage: () => usage,
    petName: () => store.data.pet.name || 'PM',
    weekGoals: () => (ex ? ex.goals() : []),
    captureHook: (text) => {
      const r = ex && ex.parseRecurring(text.replace(/^(tarea|todo|task)s*:s*/i, ''));
      if (!r) return null;
      ex.addRecurring(r);
      const st = ex.snapshot().recurring.slice(-1)[0];
      const msg = `🔁 ¡Anotado! "${r.text}" se añadirá a tus tareas ${st ? st.label : ''}.`;
      say(msg, 'peck', 7000, { log: false, target: { cmd: 'panel', arg: 'day#recurring' } });
      return msg;
    },
    claudeToday: () => (ex ? ex.journalText(ex.claudeJournal().today, '').map((l) => l.trim()) : []),
  });
  prod.start({ status: extStatus, command: extCommand, capture: (text) => !!prod.capture(text) });

  ai = aiMod.create({
    apiKey: () => decrypt(store.data.settings.aiKey),
    model: () => store.data.settings.aiModel || aiMod.DEFAULT_MODEL,
    lang,
    name: () => store.data.pet.name || 'PM',
    context: aiContext,
    actions: {
      addTask: (text) => { addTask(text); animate('peck'); },
      completeTask: (i) => {
        const t = today().standup && today().standup.today[i];
        if (!t) return false;
        if (!t.done) { t.done = true; if (!t.xp) { t.xp = true; addXp(10); } }
        store.save();
        broadcast();
        animate('dance');
        return true;
      },
      addReminder: (at, text) => prod.addReminderAt(at, text),
      startPomodoro: () => prod.pomoStart(),
    },
  });

  ex = extrasMod.create({
    store, say, broadcast, animate, sendPet, today, addTask, addXp, isMuted, trackingPaused, aiAvailable, lang,
    clipboard, screen, dialog, shell, app, BrowserWindow,
    appDir: __dirname,
    version: app.getVersion(),
    achievements: gami.ACHIEVEMENTS,
    ai: () => ai,
    usage: () => usage,
    getMeeting: () => meetingNow,
    meetingsToday: () => todaysMeetings(),
    isPresenting: () => !!presenting,
    petWin: () => (petWin && !petWin.isDestroyed() ? petWin : null),
    dragging: () => !!drag,
    onMoved: () => { if (tray) tray.refreshMenu && tray.refreshMenu(); },
    askChat: (text) => { openPanel('chat'); setTimeout(() => panelWin && panelWin.webContents.send('chat:ask', text), 300); },
  });
  ex.start();
  setInterval(focusTick, 5000);
  // Novedades: la primera vez que arranca una versión nueva.
  setTimeout(() => {
    const v = app.getVersion();
    // Quien ya usaba la app antes de guardar la versión también ve las novedades.
    const seen = store.data.lastVersionSeen || (store.data.chat.length ? '1.1.0' : null);
    store.data.lastVersionSeen = v;
    store.save();
    if (seen && seen !== v && store.data.pet.name) {
      say(`🎁 ¡Me actualicé a la ${v}! Tengo cosas nuevas: modo foco, tareas recurrentes, plantillas de día y búsqueda global.`, 'celebrate', 15000, {
        cat: 'pet', actions: [{ label: '✨ Ver novedades', cmd: 'whatsnew' }],
      });
    }
  }, 20000);

  // Monitor de sitios cada 2 min, logros cada 5 min, actualizaciones cada 6 h.
  setTimeout(() => checkMonitors(false), 6000);
  setInterval(() => checkMonitors(true), 2 * 60 * 1000);
  setTimeout(checkAchievements, 15000);
  setInterval(checkAchievements, 5 * 60 * 1000);
  setTimeout(() => checkUpdates(false), 30000);
  setInterval(() => checkUpdates(false), 6 * 3600 * 1000);

  // Captura rápida desde cualquier app.
  if (!globalShortcut.register('CommandOrControl+Alt+Space', openPalette)) {
    console.error('No se pudo registrar Ctrl+Alt+Espacio (¿lo usa otra app?)');
  }
  nativeTheme.on('updated', broadcast);
  if (!globalShortcut.register('CommandOrControl+Alt+P', openCapture)) {
    console.error('No se pudo registrar Ctrl+Alt+P (¿lo usa otra app?)');
  }

  stopFocus = focus.start(onFocusSample);

  // En la versión instalada, el inicio con Windows debe apuntar al .exe instalado (no al de desarrollo).
  if (app.isPackaged && store.data.settings.autoStart) setAutoStart(true);

  // "Siempre debe estar ahí": activa el inicio con Windows una vez (se puede quitar en Ajustes).
  if (!store.data.settings.autoStartAsked && store.data.pet.name) {
    store.data.settings.autoStartAsked = true;
    setAutoStart(true);
  }

  await refreshUsage();
  setInterval(() => refreshUsage(), USAGE_EVERY_MS);
  // Icono de la bandeja: cada 5 s (la cuenta atrás del pomodoro se ve moverse).
  updateTrayIcon();
  setInterval(updateTrayIcon, 5000);
  refreshCalendar();
  refreshMail();
  setInterval(() => refreshCalendar(), 10 * 60 * 1000);
  setInterval(() => refreshMail(), 3 * 60 * 1000);
  setInterval(meetingReminders, 20 * 1000);
  setInterval(petTick, 60 * 1000);
  setInterval(() => { checkSchedule(); chatter(); checkWellbeing(); checkBirthday(); }, 30 * 1000);
  setTimeout(checkSchedule, 5000);
  // Reafirma "siempre encima" por si otra app lo tapa.
  setInterval(() => { if (petWin && petWin.isVisible()) petWin.setAlwaysOnTop(true, 'screen-saver'); }, 15000);
});

app.on('second-instance', () => openPanel('chat'));
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', () => {
  quitting = true;
  if (stopFocus) stopFocus();
  if (store) {
    markStopped(quitHow || 'user');
    store.flush();
  }
});
app.on('window-all-closed', (e) => e.preventDefault());

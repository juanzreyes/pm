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
const brain = require('./src/brain');

// La misma carpeta de datos en desarrollo y en la versión instalada: el pollito conserva su memoria.
app.setPath('userData', path.join(app.getPath('appData'), 'pm-pollito'));

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
      say(`📅 En ${Math.round(mins)} min: "${e.title}"${where}. ¡Prepárate! 🎧`, 'alarm-soft', 12000);
      pushChat('pet', `📅 En ${Math.round(mins)} min tienes "${e.title}"${where}.`);
    }
    if (mins <= 1 && mins > -5 && !reminded.has(e.id + '|0')) {
      reminded.add(e.id + '|0');
      say(`🎧 ¡Ya empieza "${e.title}"!${e.join && e.join.url ? ' Haz clic en el aviso para unirte.' : ''}`, 'alarm', 12000);
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
  const s = { ...store.data.settings };
  s.hasManualToken = !!s.manualToken;
  delete s.manualToken;
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
    ...(prod ? prod.snapshot() : {}),
    presets: Object.fromEntries(Object.entries(mail.PRESETS).map(([k, v]) => [k, { label: v.label, host: v.host, port: v.port, help: v.help }])),
  };
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
        say(`🔴 ${name} está caído ${r.status ? `(HTTP ${r.status})` : `(${r.error || 'sin respuesta'})`} 😱`, 'alarm', 15000);
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
    });
  }
  const month = days.slice(-30);
  const projects = {};
  for (const x of month) for (const [p, s] of Object.entries((store.data.days[x.key] || {}).projects || {})) projects[p] = (projects[p] || 0) + s;
  return {
    days,
    projects: Object.entries(projects).sort((a, b) => b[1] - a[1]).slice(0, 7),
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
  return L.join('\n');
}

// ---------- modo presentación: el pollito se esconde ----------
function handlePresenting(reason) {
  const now = Date.now();
  if (reason && store.data.settings.autoHide !== false) {
    presentQuietSince = 0;
    if (!presenting) {
      presenting = { reason, petWasVisible: !!(petWin && petWin.isVisible()), since: now };
      if (petWin) petWin.hide();
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
  handlePresenting(focus.presentingFrom(s));
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
  if (Math.floor(f.work / 3600) > hoursBefore) {
    addXp(10);
    if (!isMuted()) say(`¡${Math.floor(f.work / 3600)} h de trabajo enfocado hoy! 💪 +10 XP`, 'dance', 7000);
  }

  if (prod) prod.onSample(s, c.cat, dt); // tiempo por proyecto + salud

  const pomoFocus = !!(prod && prod.isPomoFocus());
  const work = (inWorkHours() || pomoFocus) && !isMuted() && !meetingNow;
  const step = prod ? prod.scoldStep() : 10;

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

function broadcast() {
  const snap = snapshot();
  for (const w of [petWin, panelWin]) if (w && !w.isDestroyed()) w.webContents.send('state', snap);
}

function say(text, anim, ms, opts = {}) {
  if (!petWin || petWin.isDestroyed()) return;
  text = T(text);
  // Mientras presentas, no aparece nada en pantalla: se guarda para después.
  if (presenting) {
    presentBuffer.push({ text, anim, ms });
    if (presentBuffer.length > 5) presentBuffer.shift();
    return;
  }
  petWin.webContents.send('pet:say', { text, anim, ms, quiet: !!opts.quiet });
  // Si el pollito está oculto, avisa con una notificación de Windows.
  if (!petWin.isVisible() && Notification.isSupported()) {
    new Notification({ title: `🐣 ${store.data.pet.name || 'PM'}`, body: text, silent: false }).show();
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
  if (onClick) n.on('click', onClick);
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
  const chickLeft = pb.x + 50;
  const chickRight = pb.x + PET_W - 50;
  let x = chickRight + PANEL_W + 8 <= wa.x + wa.width ? chickRight + 8 : chickLeft - PANEL_W - 8;
  x = clamp(x, wa.x, wa.x + wa.width - PANEL_W);
  let y = pb.y + PET_H - PANEL_H;
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

function buildTray() {
  const png = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
  tray = new Tray(png.isEmpty() ? trayIcon() : png.resize({ width: 32, height: 32 }));
  const refresh = () => {
    const name = store.data.pet.name || 'PM';
    tray.setToolTip(`${name} · tu pollito PM`);
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
        { label: 'Salir', click: () => confirmQuit() },
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

async function confirmQuit() {
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
    const p = store.data.pet;
    const r = brain.reply(text, {
      name: p.name || 'PM', usage, day: today(), pet: p, level: levelInfo(p.xp || 0),
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
    if (!day.standup) return false;
    day.standup.today.splice(index, 1);
    store.save();
    broadcast();
    return true;
  });

  ipcMain.handle('review:save', (_e, { done, notes, carry }) => {
    const day = today();
    const tasks = (day.standup && day.standup.today) || [];
    tasks.forEach((t, i) => (t.done = !!(done && done[i])));
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
    const allowed = ['morningTime', 'eveningTime', 'workdaysOnly', 'chatter', 'focusWatch', 'sounds', 'lang', 'aiModel', 'aiEnabled', 'autoHide'];
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
      { label: '❌ Cerrar PM', click: confirmQuit },
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

  ipcMain.on('app:quit', () => confirmQuit());
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

  // Los ojos siguen al cursor.
  let lastCursor = '';
  setInterval(() => {
    if (!petWin || petWin.isDestroyed() || !petWin.isVisible()) return;
    const c = screen.getCursorScreenPoint();
    const b = petWin.getBounds();
    const k = `${c.x - b.x},${c.y - b.y}`;
    if (k !== lastCursor) {
      lastCursor = k;
      petWin.webContents.send('pet:cursor', { x: c.x - b.x, y: c.y - b.y });
    }
  }, 90);

  petWin.webContents.once('did-finish-load', () => {
    petTick();
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
  });
  prod.start();

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

  // Monitor de sitios cada 2 min, logros cada 5 min, actualizaciones cada 6 h.
  setTimeout(() => checkMonitors(false), 6000);
  setInterval(() => checkMonitors(true), 2 * 60 * 1000);
  setTimeout(checkAchievements, 15000);
  setInterval(checkAchievements, 5 * 60 * 1000);
  setTimeout(() => checkUpdates(false), 30000);
  setInterval(() => checkUpdates(false), 6 * 3600 * 1000);

  // Captura rápida desde cualquier app.
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
  refreshCalendar();
  refreshMail();
  setInterval(() => refreshCalendar(), 10 * 60 * 1000);
  setInterval(() => refreshMail(), 3 * 60 * 1000);
  setInterval(meetingReminders, 20 * 1000);
  setInterval(petTick, 60 * 1000);
  setInterval(() => { checkSchedule(); chatter(); }, 30 * 1000);
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

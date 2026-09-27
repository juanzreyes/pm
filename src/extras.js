// Funciones "extra" del pollito:
// diario de Claude · consejo de modelo · biblioteca de prompts · portapapeles inteligente ·
// bloques de tiempo · objetivos semanales · hábitos · notas del día · paseo por la pantalla ·
// seguir al monitor · copia de seguridad automática · informe mensual en PDF.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const journal = require('./journal');
const backup = require('./backup');
const monthly = require('./monthly');

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };

// Semana ISO (lunes a domingo): "2026-W39".
function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${pad(Math.ceil(((t - y0) / 864e5 + 1) / 7))}`;
}

const DEFAULT_PROMPTS = [
  { title: 'Revisar este PR / código', text: 'Revisa este código como un senior: bugs, casos límite, seguridad y legibilidad. Dame los problemas ordenados por gravedad con la corrección propuesta.\n\n{{clipboard}}' },
  { title: 'Escribir tests', text: 'Escribe tests unitarios completos para este código (casos normales, límites y errores), usando el framework de testing del proyecto.\n\n{{clipboard}}' },
  { title: 'Explicar y arreglar un error', text: 'Explícame este error en palabras simples, dime la causa más probable y cómo arreglarlo paso a paso:\n\n```\n{{clipboard}}\n```' },
  { title: 'Refactorizar', text: 'Refactoriza este código para que sea más claro y mantenible sin cambiar su comportamiento. Explica brevemente cada cambio.\n\n{{clipboard}}' },
  { title: 'Mensaje de commit', text: 'Escribe un mensaje de commit claro (título de máximo 72 caracteres + cuerpo breve) para estos cambios:\n\n{{clipboard}}' },
];

const DEFAULT_HABITS = [
  { id: 'water', emoji: '💧', name: 'Agua', target: 8 },
  { id: 'move', emoji: '🏃', name: 'Moverme', target: 1 },
  { id: 'read', emoji: '📖', name: 'Leer', target: 1 },
  { id: 'sleep', emoji: '😴', name: 'Dormir temprano', target: 1 },
];

// La línea más útil de un error: la del tipo de error (la última), si no la primera que encaje.
function errLine(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const typed = lines.filter((l) => /\b\w*(Error|Exception)\b/.test(l) && !/^at\s/.test(l));
  return (typed.length ? typed[typed.length - 1] : lines.find((l) => ERROR_RE.test(l)) || lines[0] || '').slice(0, 120);
}

const ERROR_RE = /(Traceback \(most recent call last\)|\b\w*(Error|Exception)\b[:\s]|^\s+at .+[:(]\d+[:)]|\bENOENT\b|\bEACCES\b|\bpanic:|\bFATAL\b|\bSegmentation fault\b|npm ERR!|error\[E\d+\]|Uncaught |Unhandled|failed with exit code)/m;

function create(ctx) {
  const S = () => ctx.store.data;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  // ================= 1. DIARIO DE CLAUDE CODE =================
  let journalCache = { at: 0, today: [], prev: [] };
  function lastWorkdayRange() {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
    const e = new Date(d); e.setDate(e.getDate() + 1);
    return [d.getTime(), e.getTime()];
  }
  function claudeJournal(force = false) {
    if (!force && Date.now() - journalCache.at < 5 * 60e3) return journalCache;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const [pf, pt] = lastWorkdayRange();
    try {
      journalCache = {
        at: Date.now(),
        today: journal.summarize(journal.prompts(start.getTime(), Date.now())),
        prev: journal.summarize(journal.prompts(pf, pt)),
      };
    } catch { /* sin registros */ }
    return journalCache;
  }
  function journalText(list, prefix = '🤖') {
    return list.map((p) => `${prefix} [${p.project}] ${p.items.join(' · ')}${p.count > p.items.length ? ` (+${p.count - p.items.length})` : ''}`);
  }
  async function aiJournal(which) {
    const j = claudeJournal(true);
    const list = which === 'prev' ? j.prev : j.today;
    if (!list.length) return null;
    const raw = list.map((p) => `Proyecto ${p.project} (${p.count} peticiones): ${p.items.join(' | ')}`).join('\n');
    if (!ctx.aiAvailable()) return journalText(list).join('\n');
    try {
      return await ctx.ai().polish(raw, ctx.lang() === 'en'
        ? 'These are the requests I made to Claude Code, grouped by project. Write 1-3 short bullet points per project describing WHAT I WORKED ON (not the requests themselves), for my daily stand-up.'
        : 'Estas son las peticiones que le hice a Claude Code, agrupadas por proyecto. Escribe 1-3 viñetas cortas por proyecto describiendo EN QUÉ TRABAJÉ (no las peticiones literales), para mi daily.');
    } catch {
      return journalText(list).join('\n');
    }
  }

  // ================= 2. CONSEJO DE MODELO =================
  function modelAdvice(forecast, util, dominantModel, bucket) {
    const alerts = S().alerts;
    // La clave lleva la hora del reinicio en ms: la limpieza de avisos la borra un día después (no antes).
    const key = `modeladvice|${bucket * 600000}`;
    if (alerts[key] || !forecast || !forecast.willHit || util < 45 || ctx.isMuted()) return;
    if (!/opus|fable/.test(dominantModel || '')) return;
    if (Date.now() - (S().modelAdviceAt || 0) < 4 * 3600e3) return; // como mucho una vez cada 4 h
    S().modelAdviceAt = Date.now();
    alerts[key] = [1];
    ctx.store.save();
    ctx.say('💡 Vas rápido y casi todo es con Opus. Para lo sencillo (tests, renombrar, docs) cambia en Claude Code a /model sonnet y ahorra cuota. Te aviso cuando se reinicie para volver.', 'read', 18000, {
      cat: 'usage', actions: [{ label: '📋 Copiar /model sonnet', cmd: 'copy.text', arg: '/model sonnet' }, { label: '👍 Ok', cmd: 'ack' }],
    });
    S().modelAdvicePending = true;
  }
  function onSessionReset() {
    if (!S().modelAdvicePending) return;
    S().modelAdvicePending = false;
    ctx.store.save();
    ctx.say('🔄 Se reinició tu límite: ya puedes volver a /model opus para lo difícil 💪', 'hop', 12000, {
      cat: 'usage', actions: [{ label: '📋 Copiar /model opus', cmd: 'copy.text', arg: '/model opus' }],
    });
  }

  // ================= 3. BIBLIOTECA DE PROMPTS =================
  function promptsList() {
    if (!Array.isArray(S().prompts)) { S().prompts = DEFAULT_PROMPTS.map((p) => ({ id: newId(), ...p })); ctx.store.save(); }
    return S().prompts;
  }
  function copyPrompt(id) {
    const p = promptsList().find((x) => x.id === id);
    if (!p) return false;
    const clip = ctx.clipboard.readText() || '';
    ctx.clipboard.writeText(p.text.replace(/\{\{\s*clipboard\s*\}\}/g, clip.trim()));
    p.uses = (p.uses || 0) + 1;
    ctx.store.save();
    ctx.say(`📋 Prompt "${p.title}" copiado${/\{\{\s*clipboard/.test(p.text) && clip ? ' (con lo que tenías copiado dentro)' : ''}. ¡Pégalo en Claude!`, 'peck', 5000, { log: false });
    return true;
  }
  function savePrompt(p) {
    const list = promptsList();
    const title = String(p.title || '').trim().slice(0, 60);
    const text = String(p.text || '').trim().slice(0, 8000);
    if (!title || !text) return false;
    const ex = p.id && list.find((x) => x.id === p.id);
    if (ex) Object.assign(ex, { title, text });
    else list.push({ id: newId(), title, text });
    ctx.store.save();
    ctx.broadcast();
    return true;
  }
  function deletePrompt(id) {
    S().prompts = promptsList().filter((x) => x.id !== id);
    ctx.store.save();
    ctx.broadcast();
  }

  // ================= 4. PORTAPAPELES INTELIGENTE =================
  let lastClipHash = '';
  let lastClipAlert = 0;
  function clipboardTick() {
    if (S().settings.smartClipboard === false || ctx.trackingPaused() || ctx.isPresenting() || ctx.isMuted()) return;
    let text = '';
    try { text = ctx.clipboard.readText(); } catch { return; }
    if (!text || text.length < 30 || text.length > 20000) return;
    const hash = crypto.createHash('md5').update(text).digest('hex');
    if (hash === lastClipHash) return;
    lastClipHash = hash;
    if (!ERROR_RE.test(text) || Date.now() - lastClipAlert < 90e3) return;
    lastClipAlert = Date.now();
    const first = errLine(text);
    S().lastClipError = text.slice(0, 6000);
    const actions = [
      { label: '📋 Prompt para Claude', cmd: 'clip.prompt' },
      { label: '📌 Guardar como tarea', cmd: 'clip.task' },
    ];
    if (ctx.aiAvailable()) actions.unshift({ label: '🤖 Preguntar', cmd: 'clip.ask' });
    ctx.say(`🐞 Copiaste un error: "${first.trim().slice(0, 70)}". ¿Te ayudo?`, 'look', 15000, { cat: 'pet', log: false, actions });
  }
  function clipPrompt() {
    const t = S().lastClipError;
    if (!t) return;
    ctx.clipboard.writeText(`Explícame este error, su causa más probable y cómo arreglarlo:\n\n\`\`\`\n${t}\n\`\`\``);
    lastClipHash = crypto.createHash('md5').update(ctx.clipboard.readText()).digest('hex');
    ctx.say('📋 Listo: pega en Claude Code el prompt con tu error 🐞', 'peck', 5000, { log: false });
  }
  function clipTask() {
    const t = S().lastClipError;
    if (!t) return;
    const first = errLine(t).slice(0, 90);
    ctx.addTask(`🐞 Arreglar: ${first}`);
    ctx.say('📌 Error guardado como tarea', 'peck', 4000, { log: false });
  }
  function clipAsk() {
    const t = S().lastClipError;
    if (t) ctx.askChat(`Explícame este error y cómo arreglarlo:\n${t.slice(0, 3000)}`);
  }

  // ================= 5. BLOQUES DE TIEMPO =================
  function blocks() { return ctx.today().blocks || []; }
  function setBlocks(list) {
    ctx.today().blocks = (list || []).filter((b) => b && /^\d{2}:\d{2}$/.test(b.start) && /^\d{2}:\d{2}$/.test(b.end) && toMin(b.end) > toMin(b.start))
      .map((b) => ({ id: b.id || newId(), start: b.start, end: b.end, title: String(b.title || '').slice(0, 120), task: Number.isInteger(b.task) ? b.task : undefined, notified: b.notified }))
      .sort((a, b) => toMin(a.start) - toMin(b.start));
    ctx.store.save();
    ctx.broadcast();
    return true;
  }
  function blocksTick() {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    let changed = false;
    for (const b of blocks()) {
      if (b.notified || nowMin < toMin(b.start) || nowMin >= toMin(b.end)) continue;
      b.notified = true;
      changed = true;
      const actions = [{ label: '🍅 Pomodoro', cmd: 'pomo.start' }];
      if (Number.isInteger(b.task)) actions.push({ label: '⏱ Cronómetro', cmd: 'task.timer', arg: b.task });
      ctx.say(`🗓️ Empieza tu bloque: "${b.title}" (hasta las ${b.end}). ¡A por ello! 💪`, 'alarm-soft', 15000, { cat: 'routine', target: { cmd: 'panel', arg: 'day#blocks-next' }, actions });
    }
    if (changed) ctx.store.save();
  }

  // ================= 6. OBJETIVOS SEMANALES =================
  function goals(wk = weekKey()) {
    S().weeks = S().weeks || {};
    return (S().weeks[wk] = S().weeks[wk] || { goals: [] }).goals;
  }
  function saveGoal(g) {
    const list = goals();
    if (g.id) {
      const ex = list.find((x) => x.id === g.id);
      if (!ex) return false;
      if ('text' in g) ex.text = String(g.text).slice(0, 120);
      if ('progress' in g) {
        const before = ex.progress || 0;
        ex.progress = Math.max(0, Math.min(100, Math.round(Number(g.progress) || 0)));
        if (ex.progress === 100 && before < 100) {
          ctx.addXp(20);
          ctx.say(`🎯 ¡Objetivo de la semana cumplido! "${ex.text}" +20 XP 🎉`, 'celebrate', 10000, { cat: 'achievement', target: { cmd: 'panel', arg: 'day#goals' } });
        }
      }
    } else {
      const text = String(g.text || '').trim().slice(0, 120);
      if (!text || list.length >= 5) return false;
      list.push({ id: newId(), text, progress: 0 });
    }
    ctx.store.save();
    ctx.broadcast();
    return true;
  }
  function deleteGoal(id) {
    const wk = weekKey();
    S().weeks[wk].goals = goals().filter((x) => x.id !== id);
    ctx.store.save();
    ctx.broadcast();
  }
  // Lunes: si aún no hay objetivos, el pollito los propone.
  function goalsTick() {
    const d = new Date();
    if (d.getDay() !== 1 || d.getHours() < 9 || d.getHours() >= 13 || goals().length || ctx.isMuted() || ctx.getMeeting()) return;
    const k = `goalsAsk|${weekKey()}`;
    if (S().alerts[k]) return;
    S().alerts[k] = [1];
    ctx.store.save();
    ctx.say('🎯 ¡Nueva semana! ¿Definimos 3 objetivos? El viernes te digo cómo te fue.', 'read', 15000, { cat: 'routine', target: { cmd: 'panel', arg: 'day#goals' }, actions: [{ label: '🎯 Definir objetivos', cmd: 'panel', arg: 'day#goals' }] });
  }

  // ================= 7. HÁBITOS =================
  function habits() {
    if (!Array.isArray(S().habits)) { S().habits = DEFAULT_HABITS.map((h) => ({ ...h })); ctx.store.save(); }
    return S().habits;
  }
  function habitStreak(id, target) {
    let n = 0;
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const todayV = ((S().days[keyOf(d)] || {}).habits || {})[id] || 0;
    if (todayV < target) d.setDate(d.getDate() - 1); // hoy aún no rompe la racha
    for (let i = 0; i < 400; i++) {
      const v = ((S().days[keyOf(d)] || {}).habits || {})[id] || 0;
      if (v < target) break;
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }
  function habitStep(id, delta) {
    const h = habits().find((x) => x.id === id);
    if (!h) return false;
    const day = ctx.today();
    day.habits = day.habits || {};
    const before = day.habits[id] || 0;
    day.habits[id] = Math.max(0, Math.min(h.target * 3, before + delta));
    ctx.store.save();
    if (before < h.target && day.habits[id] >= h.target) {
      ctx.addXp(3);
      const st = habitStreak(id, h.target);
      ctx.say(`${h.emoji} ¡Hábito cumplido: ${h.name}!${st > 1 ? ` 🔥 ${st} días seguidos` : ''} +3 XP`, 'dance', 6000, { cat: 'health', target: { cmd: 'panel', arg: 'day#habits' } });
    }
    ctx.broadcast();
    return true;
  }
  function saveHabit(h) {
    const list = habits();
    const name = String(h.name || '').trim().slice(0, 30);
    if (!name) return false;
    list.push({ id: newId(), emoji: String(h.emoji || '⭐').slice(0, 4), name, target: Math.max(1, Math.min(20, Number(h.target) || 1)) });
    ctx.store.save();
    ctx.broadcast();
    return true;
  }
  function deleteHabit(id) {
    S().habits = habits().filter((x) => x.id !== id);
    ctx.store.save();
    ctx.broadcast();
  }

  // ================= 8. NOTAS DEL DÍA =================
  function setNotes(text) {
    ctx.today().notes = String(text || '').slice(0, 20000);
    ctx.store.save();
    return true;
  }
  function searchNotes(q) {
    q = String(q || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    if (q.length < 2) return [];
    const out = [];
    for (const [k, v] of Object.entries(S().days).sort((a, b) => (a[0] < b[0] ? 1 : -1))) {
      const n = v.notes || '';
      const hay = n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const i = hay.indexOf(q);
      if (i < 0) continue;
      out.push({ day: k, snippet: (i > 30 ? '…' : '') + n.slice(Math.max(0, i - 30), i + 70).replace(/\s+/g, ' ') + '…' });
      if (out.length >= 20) break;
    }
    return out;
  }

  // ================= 9. PASEO POR LA PANTALLA =================
  let strolling = false;
  function stroll() {
    const win = ctx.petWin();
    if (!win || strolling || ctx.dragging() || S().settings.discreet || ctx.isPresenting() || !win.isVisible()) return false;
    strolling = true;
    const b = win.getBounds();
    const wa = ctx.screen.getDisplayMatching(b).workArea;
    const home = { x: b.x, y: b.y };
    const y = wa.y + wa.height - b.height; // sobre la barra de tareas
    const from = b.x, to = b.x + b.width / 2 > wa.x + wa.width / 2 ? wa.x + 20 : wa.x + wa.width - b.width - 20;
    ctx.sendPet('pet:stroll', { dir: to < from ? 'left' : 'right' });
    let t = 0;
    const dur = Math.min(26000, Math.abs(to - from) * 14);
    const steps = Math.max(1, Math.round(dur / 40));
    const path1 = (i) => ({ x: Math.round(from + (to - from) * (i / steps)), y: Math.round(b.y + (y - b.y) * Math.min(1, (i / steps) * 4)) });
    const walkTo = (pts, done) => {
      const iv = setInterval(() => {
        if (ctx.dragging() || !win || win.isDestroyed()) { clearInterval(iv); strolling = false; ctx.sendPet('pet:stroll', null); return; }
        t++;
        const p = pts(t);
        win.setPosition(p.x, p.y);
        if (t >= steps) { clearInterval(iv); t = 0; done(); }
      }, 40);
    };
    walkTo(path1, () => {
      ctx.sendPet('pet:stroll', { dir: to < from ? 'right' : 'left' });
      setTimeout(() => {
        const back = (i) => ({ x: Math.round(to + (home.x - to) * (i / steps)), y: Math.round(y + (home.y - y) * Math.max(0, (i / steps) * 4 - 3)) });
        walkTo(back, () => { strolling = false; ctx.sendPet('pet:stroll', null); });
      }, 1500);
    });
    return true;
  }
  function strollTick() {
    const s = S().settings;
    if (s.strolls === false || s.discreet || ctx.isMuted() || ctx.getMeeting() || ctx.isPresenting()) return;
    const h = new Date().getHours();
    if (h < 8 || h >= 22) return;
    if (Math.random() < 0.12) stroll(); // de vez en cuando (se llama cada ~5 min)
  }
  const isStrolling = () => strolling;

  // ================= 11. SEGUIR AL MONITOR =================
  let otherSince = 0;
  function monitorTick() {
    const win = ctx.petWin();
    if (!win || S().settings.followMonitor === false || strolling || ctx.dragging() || !win.isVisible()) return;
    const displays = ctx.screen.getAllDisplays();
    if (displays.length < 2) return;
    const cur = ctx.screen.getDisplayNearestPoint(ctx.screen.getCursorScreenPoint());
    const b = win.getBounds();
    const mine = ctx.screen.getDisplayMatching(b);
    if (cur.id === mine.id) { otherSince = 0; return; }
    if (!otherSince) { otherSince = Date.now(); return; }
    if (Date.now() - otherSince < 4000) return;
    otherSince = 0;
    // Misma posición relativa en el otro monitor.
    const rx = (b.x - mine.workArea.x) / Math.max(1, mine.workArea.width - b.width);
    const ry = (b.y - mine.workArea.y) / Math.max(1, mine.workArea.height - b.height);
    const wa = cur.workArea;
    const x = Math.round(wa.x + Math.min(1, Math.max(0, rx)) * (wa.width - b.width));
    const y = Math.round(wa.y + Math.min(1, Math.max(0, ry)) * (wa.height - b.height));
    win.setPosition(x, y);
    S().position = { x, y };
    ctx.store.save();
    ctx.animate('hop');
    ctx.onMoved();
  }

  // ================= 12. COPIA DE SEGURIDAD AUTOMÁTICA =================
  function backupDir() {
    return S().settings.backupDir || backup.suggestDir();
  }
  function backupNow(manual = false) {
    try {
      const file = backup.write(backupDir(), S(), ctx.version);
      S().lastBackupAt = Date.now();
      S().lastBackupFile = file;
      ctx.store.save();
      if (manual) ctx.say('💾 Copia de seguridad hecha. Mi memoria está a salvo 💛', 'hop', 6000, { log: false });
      ctx.broadcast();
      return { ok: true, file };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  function backupTick() {
    if (S().settings.autoBackup === false) return;
    if (Date.now() - (S().lastBackupAt || 0) >= 7 * 864e5) backupNow(false);
  }
  async function chooseBackupDir(parent) {
    const r = await ctx.dialog.showOpenDialog(parent, { title: 'Carpeta para las copias de seguridad', defaultPath: backupDir(), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    S().settings.backupDir = r.filePaths[0];
    ctx.store.save();
    ctx.broadcast();
    return r.filePaths[0];
  }

  // ================= 13. INFORME MENSUAL EN PDF =================
  async function monthlyPdf(parent, which = 'current') {
    const d = new Date();
    if (which === 'prev') d.setMonth(d.getMonth() - 1, 1);
    let icon = '';
    try { icon = 'data:image/png;base64,' + fs.readFileSync(path.join(ctx.appDir, 'build', 'icon.png')).toString('base64'); } catch { /* sin icono */ }
    const html = monthly.build(S(), { name: S().pet.name || 'PM', local: ctx.usage().local, achievements: ctx.achievements, iconDataUrl: icon }, d);
    const win = new ctx.BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
    win.destroy();
    const label = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const r = await ctx.dialog.showSaveDialog(parent, {
      title: 'Guardar informe mensual',
      defaultPath: path.join(ctx.app.getPath('documents'), `PM-Pollito-informe-${label}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, pdf);
    ctx.shell.openPath(r.filePath);
    return r.filePath;
  }
  // Día 1 del mes: ofrece el informe del mes anterior.
  function monthlyTick() {
    const d = new Date();
    if (d.getDate() > 3 || d.getHours() < 9) return;
    const k = `monthly|${d.getFullYear()}-${d.getMonth()}`;
    if (S().alerts[k] || ctx.isMuted()) return;
    S().alerts[k] = [1];
    ctx.store.save();
    ctx.say('📄 ¡Nuevo mes! Tu informe del mes pasado está listo en PDF 📊', 'read', 15000, { cat: 'routine', actions: [{ label: '📄 Crear PDF', cmd: 'monthly.pdf', arg: 'prev' }] });
  }

  // ================= TAREAS RECURRENTES =================
  // days: 0 = domingo … 6 = sábado.
  const DAY_WORDS = [
    [/^(d[ií]as?|diari[oa]|day|daily)$/i, [0, 1, 2, 3, 4, 5, 6]],
    [/^(d[ií]as? laborables?|laborables?|entre semana|weekdays?|workdays?)$/i, [1, 2, 3, 4, 5]],
    [/^(lunes|mondays?)$/i, [1]], [/^(martes|tuesdays?)$/i, [2]], [/^(mi[eé]rcoles|wednesdays?)$/i, [3]],
    [/^(jueves|thursdays?)$/i, [4]], [/^(viernes|fridays?)$/i, [5]], [/^(s[aá]bados?|saturdays?)$/i, [6]], [/^(domingos?|sundays?)$/i, [0]],
  ];
  /** "cada lunes: revisar métricas", "todos los días: leer correo", "every friday: deploy" */
  function parseRecurring(text) {
    const m = String(text || '').trim().match(/^(?:cada|todos los|todas las|every)\s+(.+?)\s*[:,\-–]\s*(.+)$/i);
    if (!m) return null;
    const days = new Set();
    for (const part of m[1].split(/\s*(?:,|\by\b|\band\b)\s*/i).filter(Boolean)) {
      const hit = DAY_WORDS.find(([re]) => re.test(part.trim()));
      if (!hit) return null;
      hit[1].forEach((d) => days.add(d));
    }
    return { days: [...days].sort(), text: m[2].trim().slice(0, 200) };
  }
  function recurringList() { return (S().recurring = S().recurring || []); }
  function addRecurring(r) {
    const days = (r.days || []).map(Number).filter((d) => d >= 0 && d <= 6);
    const text = String(r.text || '').trim().slice(0, 200);
    if (!text || !days.length) return false;
    recurringList().push({ id: newId(), text, days: [...new Set(days)].sort() });
    // Si toca hoy y ya hiciste el daily, se añade ya.
    const day = ctx.today();
    if (days.includes(new Date().getDay()) && day.standup && !day.standup.today.some((t) => t.text === text)) ctx.addTask(text);
    ctx.store.save();
    ctx.broadcast();
    return true;
  }
  function deleteRecurring(id) {
    S().recurring = recurringList().filter((x) => x.id !== id);
    ctx.store.save();
    ctx.broadcast();
  }
  const recurringToday = () => recurringList().filter((r) => r.days.includes(new Date().getDay())).map((r) => r.text);
  /** Tras el daily, añade las recurrentes de hoy que falten (una vez al día). */
  function recurringTick() {
    const day = ctx.today();
    if (!day.standup || day.recurringAdded) return;
    day.recurringAdded = true;
    const have = new Set(day.standup.today.map((t) => t.text));
    const add = recurringToday().filter((t) => !have.has(t));
    for (const t of add) day.standup.today.push({ text: t, done: false, recurring: true });
    ctx.store.save();
    if (add.length) ctx.broadcast();
  }
  const RULE_LABEL = (days) => {
    const k = days.join('');
    if (k === '0123456') return 'todos los días';
    if (k === '12345') return 'lunes a viernes';
    const N = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
    return days.map((d) => N[d]).join(', ');
  };

  // ================= PLANTILLAS DE DÍA =================
  const DEFAULT_TEMPLATES = [
    { name: 'Día de foco', emoji: '🎯', blocks: [
      { start: '09:00', end: '11:00', title: 'Foco profundo' }, { start: '11:15', end: '12:00', title: 'Correo y PRs' },
      { start: '14:00', end: '16:00', title: 'Foco profundo' }, { start: '16:30', end: '17:00', title: 'Cierre y plan de mañana' }], tasks: [] },
    { name: 'Día de reuniones', emoji: '🤝', blocks: [
      { start: '08:30', end: '09:00', title: 'Preparar reuniones' }, { start: '12:30', end: '13:00', title: 'Correo y mensajes' },
      { start: '17:00', end: '17:30', title: 'Pasar a limpio notas y tareas' }], tasks: ['Enviar resumen de las reuniones'] },
    { name: 'Día de bugs', emoji: '🐞', blocks: [
      { start: '09:00', end: '10:00', title: 'Triaje de incidencias' }, { start: '10:00', end: '12:30', title: 'Arreglar bugs' },
      { start: '15:00', end: '16:30', title: 'Arreglar bugs' }, { start: '16:30', end: '17:00', title: 'Tests y despliegue' }], tasks: ['Revisar incidencias nuevas'] },
  ];
  function templates() {
    if (!Array.isArray(S().templates)) { S().templates = DEFAULT_TEMPLATES.map((t) => ({ id: newId(), ...t })); ctx.store.save(); }
    return S().templates;
  }
  function applyTemplate(id) {
    const t = templates().find((x) => x.id === id);
    if (!t) return false;
    const day = ctx.today();
    const cur = day.blocks || [];
    const busy = cur.map((b) => [toMin(b.start), toMin(b.end)]);
    // Las reuniones de hoy también ocupan hueco.
    for (const ev of ctx.meetingsToday()) {
      const s = new Date(ev.start), e = new Date(ev.end);
      busy.push([s.getHours() * 60 + s.getMinutes(), e.getHours() * 60 + e.getMinutes()]);
    }
    let added = 0, skipped = 0;
    const list = cur.slice();
    for (const b of t.blocks || []) {
      const a = toMin(b.start), z = toMin(b.end);
      if (busy.some(([x, y]) => a < y && z > x)) { skipped++; continue; }
      list.push({ ...b });
      busy.push([a, z]);
      added++;
    }
    setBlocks(list);
    let tasks = 0;
    const have = new Set(((day.standup && day.standup.today) || []).map((x) => x.text));
    for (const x of t.tasks || []) if (!have.has(x)) { ctx.addTask(x); tasks++; }
    ctx.say(`${t.emoji || '🗓️'} Plantilla "${t.name}" aplicada: ${added} bloque${added === 1 ? '' : 's'}${tasks ? ` y ${tasks} tarea${tasks === 1 ? '' : 's'}` : ''}${skipped ? ` (${skipped} no cabían por reuniones o bloques)` : ''}.`, 'peck', 8000, { log: false, target: { cmd: 'panel', arg: 'blocks' } });
    return true;
  }
  function saveTemplate(name) {
    name = String(name || '').trim().slice(0, 40);
    const day = ctx.today();
    const blocks = (day.blocks || []).map((b) => ({ start: b.start, end: b.end, title: b.title }));
    if (!name || !blocks.length) return false;
    const tasks = ((day.standup && day.standup.today) || []).filter((t) => !t.recurring).map((t) => t.text).slice(0, 10);
    templates().push({ id: newId(), name, emoji: '⭐', blocks, tasks });
    ctx.store.save();
    ctx.broadcast();
    return true;
  }
  function deleteTemplate(id) {
    S().templates = templates().filter((x) => x.id !== id);
    ctx.store.save();
    ctx.broadcast();
  }

  // ================= BÚSQUEDA GLOBAL (paleta) =================
  const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function search(q) {
    const words = fold(q).split(/\s+/).filter((w) => w.length >= 2);
    if (!words.length) return [];
    const hit = (s) => { const f = fold(s); return words.every((w) => f.includes(w)); };
    const out = [];
    const seen = new Set();
    const add = (r) => {
      const k = r.icon + r.label;
      if (out.length < 14 && !seen.has(k)) { seen.add(k); out.push(r); }
    };
    const cut = (s, n = 80) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
    const todayK = keyOf(new Date());
    // Tareas (hoy primero, luego 14 días atrás)
    const keys = Object.keys(S().days).sort().reverse().slice(0, 15);
    for (const k of keys) {
      for (const t of ((S().days[k].standup || {}).today || [])) {
        if (hit(t.text)) add({ icon: t.done ? '✅' : '📌', label: cut(t.text), hint: k === todayK ? 'tarea de hoy' : `tarea · ${k}`, cmd: 'panel', arg: k === todayK ? 'day#tasks' : 'stats' });
      }
    }
    for (const r of (S().reminders || []).filter((x) => !x.done)) {
      if (hit(r.text)) add({ icon: '⏰', label: cut(r.text), hint: `recordatorio · ${new Date(r.at).toLocaleString('es', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`, cmd: 'panel', arg: 'day#reminders' });
    }
    for (const p of promptsList()) {
      if (hit(p.title + ' ' + p.text)) add({ icon: '📚', label: p.title, hint: 'copiar prompt', cmd: 'prompt.copy', arg: p.id });
    }
    for (const n of searchNotes(q).slice(0, 4)) add({ icon: '🗒️', label: cut(n.snippet), hint: `nota · ${n.day}`, cmd: 'panel', arg: 'day#notes' });
    for (const g of goals()) if (hit(g.text)) add({ icon: '🎯', label: g.text, hint: `objetivo · ${g.progress || 0}%`, cmd: 'panel', arg: 'day#goals' });
    const j = journalCache;
    for (const [list, when] of [[j.today, 'hoy'], [j.prev, 'último día']]) {
      for (const p of list) for (const it of p.items) if (hit(it + ' ' + p.project)) add({ icon: '🤖', label: cut(it), hint: `Claude · ${p.project} · ${when}`, cmd: 'panel', arg: 'day#claude-journal' });
    }
    let nInbox = 0;
    for (const x of (S().inbox || []).slice().reverse()) {
      if (nInbox < 4 && hit(x.text) && !seen.has('🔔' + cut(x.text)) && ++nInbox) add({ icon: '🔔', label: cut(x.text), hint: 'aviso', cmd: (x.target && x.target.cmd) || 'inbox', arg: x.target && x.target.arg });
    }
    return out;
  }

  // ================= estado para el panel =================
  function snapshot() {
    const j = journalCache;
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const bl = blocks();
    return {
      claudeJournal: { today: j.today, prev: j.prev },
      prompts: promptsList().map((p) => ({ id: p.id, title: p.title, text: p.text, uses: p.uses || 0 })),
      blocks: bl,
      blockNow: bl.find((b) => toMin(b.start) <= nowMin && nowMin < toMin(b.end)) || null,
      blockNext: bl.find((b) => toMin(b.start) > nowMin) || null,
      goals: goals(),
      habits: habits().map((h) => ({ ...h, today: ((ctx.today().habits || {})[h.id]) || 0, streak: habitStreak(h.id, h.target) })),
      notes: ctx.today().notes || '',
      backup: { dir: backupDir(), lastAt: S().lastBackupAt || 0, auto: S().settings.autoBackup !== false },
      multiMonitor: ctx.screen.getAllDisplays().length > 1,
      recurring: recurringList().map((r) => ({ ...r, label: RULE_LABEL(r.days) })),
      recurringToday: recurringToday(),
      templates: templates().map((t) => ({ id: t.id, name: t.name, emoji: t.emoji, blocks: (t.blocks || []).length, tasks: (t.tasks || []).length })),
    };
  }

  function start() {
    setTimeout(() => claudeJournal(true), 12000);
    setInterval(() => claudeJournal(true), 10 * 60e3);
    setInterval(clipboardTick, 2000);
    setInterval(() => { blocksTick(); goalsTick(); monthlyTick(); recurringTick(); }, 20000);
    setInterval(strollTick, 5 * 60e3);
    setInterval(monitorTick, 1500);
    setTimeout(backupTick, 60e3);
    setInterval(backupTick, 6 * 3600e3);
  }

  return {
    start, snapshot, weekKey,
    claudeJournal, journalText, aiJournal,
    modelAdvice, onSessionReset,
    promptsList, copyPrompt, savePrompt, deletePrompt,
    clipPrompt, clipTask, clipAsk,
    setBlocks, saveGoal, deleteGoal, goals,
    habits, habitStep, saveHabit, deleteHabit,
    setNotes, searchNotes,
    stroll, isStrolling,
    backupNow, chooseBackupDir,
    monthlyPdf,
    parseRecurring, addRecurring, deleteRecurring, recurringToday,
    templates, applyTemplate, saveTemplate, deleteTemplate,
    search,
  };
}

module.exports = { create, weekKey };

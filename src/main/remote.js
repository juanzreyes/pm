// Avisos fuera del PC: el canal del equipo (Slack / Teams / Discord por webhook) y tu celular
// (ntfy o un bot de Telegram, que además te deja anotar tareas y ver tu día desde el móvil).
// Parte del proceso principal. `M` es el contexto compartido de la app.
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  const out = require('../outbound');
  const set = () => M.store.data.settings;
  const recent = new Map(); // texto → cuándo se mandó (evita repetir el mismo aviso)

  // ---------- configuración ----------
  const webhookUrl = () => M.decrypt(set().teamWebhook || '');
  const tgToken = () => M.decrypt(set().telegramToken || '');
  function phoneCfg() {
    const s = set();
    if (s.phoneVia === 'telegram') return { via: 'telegram', token: tgToken(), chatId: s.telegramChatId || null };
    return { via: 'ntfy', server: s.ntfyServer || 'https://ntfy.sh', topic: s.ntfyTopic || '' };
  }
  const phoneReady = () => { const c = phoneCfg(); return c.via === 'telegram' ? !!(c.token && c.chatId) : !!c.topic; };

  /** ¿Estás lejos del PC? (5 min sin tocar nada o sesión bloqueada) */
  function away() {
    try {
      const { powerMonitor } = require('electron');
      return powerMonitor.getSystemIdleTime() >= 300 || powerMonitor.getSystemIdleState(60) === 'locked';
    } catch { return false; }
  }

  // ---------- envío ----------
  function sendTeam(msg) {
    return out.sendWebhook(webhookUrl(), msg);
  }
  function sendPhone(msg) {
    const c = phoneCfg();
    return c.via === 'telegram' ? out.sendTelegram(c, msg) : out.sendNtfy(c, msg);
  }
  const petName = () => M.store.data.pet.name || 'PM';

  /** Cada aviso del pollito pasa por aquí: decide si también va al equipo o a tu celular. */
  function onSay(raw, cat, opts = {}) {
    if (M.TEST || opts.remote === false) return;
    const s = set();
    const r = out.route(cat, raw, {
      phone: !!s.phoneOn && phoneReady(), phoneWhen: s.phoneWhen, phoneCats: s.phoneCats,
      team: !!s.teamOn && !!s.teamWebhook, teamCats: s.teamCats,
    }, away());
    if (!r.team && !r.phone) return;
    const now = Date.now();
    if (recent.get(raw) > now - 60e3) return;
    recent.set(raw, now);
    if (recent.size > 50) recent.delete(recent.keys().next().value);
    if (r.team) sendTeam({ title: `🐣 ${petName()}`, text: raw }).catch((e) => M.diag.log('main', 'Webhook del equipo: ' + e.message));
    if (r.phone) sendPhone({ title: `🐣 ${petName()}`, text: raw, urgent: cat === 'meeting' || /necesita|esperando|100%/.test(raw) }).catch((e) => M.diag.log('main', 'Aviso al celular: ' + e.message));
  }

  // ---------- daily e informe al canal ----------
  async function postDaily(manual = false) {
    if (!set().teamWebhook) return { ok: false, error: 'Falta el webhook del canal' };
    try {
      await sendTeam({ text: await M.prod.dailyText() });
      M.store.data.teamPosted = { ...(M.store.data.teamPosted || {}), daily: M.dayKey() };
      M.store.save();
      M.say('📣 Daily publicado en el canal del equipo', 'celebrate', 6000, { log: !manual, remote: false });
      return { ok: true };
    } catch (e) {
      M.say('😿 No pude publicar el daily: ' + e.message, 'sad', 9000, { remote: false });
      return { ok: false, error: e.message };
    }
  }
  async function postWeekly(manual = false) {
    if (!set().teamWebhook) return { ok: false, error: 'Falta el webhook del canal' };
    try {
      await sendTeam({ text: M.prod.weeklyReport() });
      M.store.data.teamPosted = { ...(M.store.data.teamPosted || {}), weekly: M.dayKey() };
      M.store.save();
      M.say('📣 Informe semanal publicado en el canal', 'celebrate', 6000, { log: !manual, remote: false });
      return { ok: true };
    } catch (e) {
      M.say('😿 No pude publicar el informe: ' + e.message, 'sad', 9000, { remote: false });
      return { ok: false, error: e.message };
    }
  }
  /** Publica solo: el daily a su hora (si ya lo hiciste) y el informe los viernes tras el cierre. */
  function scheduleTick() {
    const s = set();
    if (M.TEST || !s.teamOn || !s.teamWebhook) return;
    const now = new Date();
    const hm = M.pad(now.getHours()) + ':' + M.pad(now.getMinutes());
    const posted = M.store.data.teamPosted || {};
    const workday = now.getDay() !== 0 && now.getDay() !== 6;
    const st = M.today().standup;
    if (s.teamDaily && workday && hm >= s.teamDaily && posted.daily !== M.dayKey() && st && (st.today || []).length) postDaily(false);
    if (s.teamWeekly && now.getDay() === 5 && hm >= (s.eveningTime || '16:30') && posted.weekly !== M.dayKey()) postWeekly(false);
  }

  // ---------- Telegram: el bot también escucha ----------
  let polling = null;
  function pairCode() {
    if (!set().telegramPairCode) { set().telegramPairCode = String(Math.floor(100000 + Math.random() * 900000)); M.store.save(); }
    return set().telegramPairCode;
  }
  function stopPolling() {
    if (polling) { polling.stop = true; try { polling.ctrl.abort(); } catch { /* ya parado */ } polling = null; }
  }
  function startPolling() {
    stopPolling();
    const token = tgToken();
    if (M.TEST || !token) return;
    const p = { stop: false, ctrl: new AbortController() };
    polling = p;
    (async () => {
      let offset = set().telegramOffset || 0;
      let fails = 0;
      while (!p.stop) {
        try {
          const ups = await out.telegramUpdates(token, offset, 25, fetch, p.ctrl.signal);
          fails = 0;
          for (const u of ups) {
            offset = u.update_id + 1;
            if (u.message && u.message.text) await onTelegram(token, u.message);
          }
          if (ups.length) { set().telegramOffset = offset; M.store.save(); }
        } catch (e) {
          if (p.stop) break;
          fails++;
          if (fails === 3) M.diag.log('main', 'Telegram: ' + e.message);
          await new Promise((r) => setTimeout(r, Math.min(300e3, 5000 * fails)));
        }
      }
    })();
  }
  const reply = (token, chatId, text) => out.sendTelegram({ token, chatId }, { text }).catch(() => {});

  async function onTelegram(token, msg) {
    const chatId = msg.chat.id;
    const text = String(msg.text || '').trim();
    // Vincular: el primero que manda el código de 6 cifras queda como tu chat.
    if (!set().telegramChatId) {
      if (text.replace(/\D/g, '') === pairCode()) {
        set().telegramChatId = chatId;
        set().telegramPairCode = '';
        M.store.flush();
        M.broadcast();
        await reply(token, chatId, `✅ ¡Vinculado con ${petName()}! Escríbeme una tarea o un recordatorio ("a las 5 llamar a Ana"), o usa /estado, /tareas, /hecha 2, /cola <petición para Claude>.`);
        M.say('📱 ¡Telegram vinculado! Ya te aviso al celular.', 'celebrate', 8000, { remote: false });
      } else {
        await reply(token, chatId, '🐣 Para vincularme, envíame el código de 6 cifras que ves en PM → Ajustes → Avisos fuera del PC.');
      }
      return;
    }
    if (String(chatId) !== String(set().telegramChatId)) return; // solo tu chat
    const c = out.parseTelegram(text);
    const tasks = () => (M.today().standup && M.today().standup.today) || [];
    switch (c.cmd) {
      case 'help':
        return reply(token, chatId, 'Escríbeme una tarea o un recordatorio y lo anoto. Comandos: /estado · /tareas · /hecha <n> · /cola <petición para Claude>');
      case 'status': {
        const st = M.extStatus();
        const lines = [`🐣 ${st.name}`];
        if (st.session) lines.push(`Sesión de Claude: ${st.session.pct}%`);
        if (st.weekly) lines.push(`Semana: ${st.weekly.pct}%`);
        lines.push(`Tareas: ${st.tasks.done}/${st.tasks.total}`);
        if (st.pomo) lines.push('🍅 Pomodoro en marcha');
        if (st.meeting) lines.push(`🎧 En reunión: ${st.meeting.title || st.meeting.app}`);
        const q = (M.store.data.claudeQueue || []).length;
        if (q) lines.push(`🤖 Cola de Claude: ${q}`);
        return reply(token, chatId, lines.join('\n'));
      }
      case 'tasks': {
        const t = tasks();
        return reply(token, chatId, t.length ? t.map((x, i) => `${x.done ? '✅' : '⬜'} ${i + 1}. ${x.text}`).join('\n') : 'No tienes tareas hoy 🌤️');
      }
      case 'done': {
        const n = Number(c.arg);
        try {
          const r = M.completeTaskBy(Number.isInteger(n) && n > 0 ? { index: n - 1, by: 'telegram' } : { text: c.arg, by: 'telegram' });
          return reply(token, chatId, '✅ ' + r);
        } catch (e) { return reply(token, chatId, '😿 ' + e.message); }
      }
      case 'queue': {
        const m = c.arg.match(/^\[([^\]]+)\]\s*([\s\S]+)$/);
        if (!c.arg || !M.plan.queueAdd(m ? m[2] : c.arg, m ? m[1] : '')) return reply(token, chatId, 'Escribe la petición: /cola [proyecto] revisa los tests');
        return reply(token, chatId, `🤖 En la cola de Claude (${(M.store.data.claudeQueue || []).length}).`);
      }
      case 'capture': {
        if (!c.arg) return null;
        const r = M.prod.capture(c.arg);
        return reply(token, chatId, r || '😿 No lo entendí');
      }
      default:
        return reply(token, chatId, `No conozco /${c.arg}. Prueba /ayuda`);
    }
  }

  // ---------- ajustes ----------
  /** @param {Record<string, any>} patch */
  async function save(patch = {}) {
    const s = set();
    if ('teamWebhook' in patch) {
      const u = String(patch.teamWebhook || '').trim();
      if (u && !/^https:\/\//i.test(u)) return { ok: false, error: 'La URL del webhook debe empezar por https://' };
      s.teamWebhook = u ? M.encrypt(u) : '';
      s.teamKind = u ? out.kind(u) : '';
      if (u && s.teamOn === undefined) s.teamOn = true;
    }
    for (const k of ['teamOn', 'teamWeekly', 'phoneOn']) if (k in patch) s[k] = !!patch[k];
    if ('teamDaily' in patch) s.teamDaily = /^\d{2}:\d{2}$/.test(patch.teamDaily || '') ? patch.teamDaily : '';
    if (Array.isArray(patch.teamCats)) s.teamCats = patch.teamCats.filter((x) => ['monitor', 'ci', 'tickets'].includes(x));
    if (Array.isArray(patch.phoneCats)) s.phoneCats = patch.phoneCats.filter((x) => ['claude', 'meeting', 'reminder', 'usage', 'monitor', 'ci', 'tickets'].includes(x));
    if ('phoneWhen' in patch) s.phoneWhen = patch.phoneWhen === 'always' ? 'always' : 'away';
    if ('phoneVia' in patch) s.phoneVia = patch.phoneVia === 'telegram' ? 'telegram' : 'ntfy';
    if ('ntfyServer' in patch) s.ntfyServer = /^https:\/\//.test(patch.ntfyServer || '') ? patch.ntfyServer.replace(/\/+$/, '') : 'https://ntfy.sh';
    if (s.phoneVia !== 'telegram' && !s.ntfyTopic) s.ntfyTopic = 'pm-' + require('crypto').randomBytes(8).toString('hex'); // tema secreto
    if ('newNtfyTopic' in patch) s.ntfyTopic = 'pm-' + require('crypto').randomBytes(8).toString('hex');
    if ('telegramToken' in patch) {
      const t = String(patch.telegramToken || '').trim();
      if (t && !/^\d+:[\w-]{30,}$/.test(t)) return { ok: false, error: 'Ese no parece un token de bot (se ve como 123456:ABC-…). Pídeselo a @BotFather.' };
      s.telegramToken = t ? M.encrypt(t) : '';
      s.telegramChatId = null;
      s.telegramOffset = 0;
      s.telegramPairCode = '';
      if (t) {
        try {
          const res = await fetch(`https://api.telegram.org/bot${t}/getMe`);
          const j = await res.json();
          if (!j.ok) return { ok: false, error: j.description || 'Telegram no aceptó el token' };
          s.telegramBot = j.result.username;
        } catch (e) { return { ok: false, error: 'No pude hablar con Telegram: ' + e.message }; }
        pairCode();
      }
    }
    M.store.flush();
    if (s.phoneVia === 'telegram' && s.telegramToken) startPolling(); else stopPolling();
    M.broadcast();
    return { ok: true };
  }

  async function test(which) {
    try {
      if (which === 'team') await sendTeam({ title: `🐣 ${petName()}`, text: '¡Hola, equipo! Soy el pollito de PM. Por aquí llegarán los avisos que elijas 🐥' });
      else await sendPhone({ title: `🐣 ${petName()}`, text: '¡Funciona! Así te llegarán mis avisos al celular 📱' });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  function remoteState() {
    const s = set();
    return {
      team: { configured: !!s.teamWebhook, kind: s.teamKind || '', on: !!s.teamOn, cats: s.teamCats || ['monitor', 'ci'], daily: s.teamDaily || '', weekly: !!s.teamWeekly },
      phone: {
        on: !!s.phoneOn, via: s.phoneVia || 'ntfy', when: s.phoneWhen || 'away', cats: s.phoneCats || ['claude', 'meeting', 'reminder', 'usage'],
        ntfyServer: s.ntfyServer || 'https://ntfy.sh', ntfyTopic: s.ntfyTopic || '',
        telegram: { configured: !!s.telegramToken, paired: !!s.telegramChatId, bot: s.telegramBot || '', code: s.telegramToken && !s.telegramChatId ? pairCode() : '' },
        ready: phoneReady(),
      },
    };
  }

  function start() {
    if (M.TEST) return;
    if (set().phoneVia === 'telegram' && set().telegramToken) startPolling();
    setInterval(scheduleTick, 60e3);
  }

  return { onSay, postDaily, postWeekly, save, test, remoteState, start, stopPolling };
};

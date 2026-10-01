// Consumo de Claude: leer los límites (cuenta web, token o Claude Code), predecir cuándo
// llegarás al 100% y avisar al cruzar cada umbral.
// Parte del proceso principal (antes en main.js). `M` es el contexto compartido de la app.
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  let refreshing = false;
  let prevSession = null;

  async function refreshUsage(manual = false) {
    if (refreshing) return M.usage;
    refreshing = true;
    try {
      let local = null;
      try { local = M.usageApi.localStats(); } catch (e) { console.error('Stats locales:', e.message); }

      // Fuentes por orden de preferencia: cuenta web (navegador) → token manual → Claude Code.
      const sources = [];
      if (M.store.data.web.orgId) {
        sources.push({
          source: 'web',
          plan: M.store.data.web.orgName,
          run: () => M.claudeWeb.fetchLimits(M.store.data.web.orgId),
          bad: 'Tu sesión de claude.ai caducó. Pulsa “Conectar con mi cuenta de Claude” para volver a entrar.',
        });
      }
      const manualTok = M.manualToken();
      if (manualTok) {
        sources.push({ source: 'manual', run: () => M.usageApi.fetchLimits(manualTok), bad: 'El token que pegaste no es válido o caducó.' });
      }
      // En los tests no se lee la sesión real de Claude Code del equipo: tu uso de verdad no debe cambiar el resultado.
      const cc = M.TEST ? { found: false } : M.usageApi.readClaudeCodeSession();
      if (cc.found && !(cc.expiresAt && cc.expiresAt < Date.now())) {
        sources.push({
          source: 'claude-code',
          plan: cc.plan,
          run: () => M.usageApi.fetchLimits(cc.token),
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
      if (connection.status === 'error' && M.usage.limits) limits = M.usage.limits;

      M.usage = { limits, local, connection, fetchedAt: Date.now() };
      if (connection.status === 'ok') updateForecasts();
      processThresholds();
      M.broadcast();
      if (manual) {
        const s = limits.find((l) => l.key === 'five_hour');
        M.say(connection.status === 'ok'
          ? (s ? `¡Actualizado! Sesión al ${Math.round(s.utilization)}% 📊` : '¡Actualizado! 📊')
          : '¡Ups! No pude conectarme a Claude 😿', connection.status === 'ok' ? 'peck' : 'sad');
      }
      return M.usage;
    } finally {
      refreshing = false;
    }
  }

  // ---------- predicción de consumo ----------
  function updateForecasts() {
    const store = M.store;
    const usage = M.usage;
    const hist = store.data.usageHist || (store.data.usageHist = {});
    const now = Date.now();
    usage.forecast = {};
    for (const [key, windowMs] of [['five_hour', 90 * 60e3], ['seven_day', 36 * 3600e3]]) {
      const l = (usage.limits || []).find((x) => x.key === key);
      if (!l || !l.resetsAt) continue;
      const list = hist[key] || (hist[key] = []);
      list.push({ t: now, u: l.utilization, r: Date.parse(l.resetsAt) });
      hist[key] = list.filter((s) => now - s.t < 3 * 864e5).slice(-300);
      const f = M.forecastMod.forecast(hist[key], l, windowMs);
      if (!f) continue;
      usage.forecast[key] = f;
      // Aviso anticipado (una vez por ventana): sesión si llegas al 100% en < 2,5 h; semanal si en < 2 días.
      const soon = key === 'five_hour' ? 2.5 * 3600e3 : 2 * 864e5;
      const bucket = Math.round(f.resetAt / 600000);
      const alertKey = `forecast|${key}|${bucket}`;
      if (key === 'five_hour' && M.ex && usage.local) {
        const models = Object.entries(usage.local.today.models || {}).sort((a, b) => b[1] - a[1]);
        M.ex.modelAdvice(f, l.utilization, models.length ? models[0][0] : '', bucket);
      }
      if (f.willHit && f.eta - now < soon && l.utilization >= 25 && l.utilization < 95 && !store.data.alerts[alertKey]) {
        store.data.alerts[alertKey] = [1];
        const at = new Date(f.eta).toLocaleString(M.lang() === 'en' ? 'en' : 'es', key === 'five_hour' ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'long', hour: '2-digit', minute: '2-digit' });
        const early = M.brain.fmtDur(f.beforeReset / 1000);
        const what = key === 'five_hour' ? 'tu sesión' : 'tu límite semanal';
        M.say(`🔮 A este ritmo (+${Math.round(f.rate)}%/h) llenarás ${what} a las ${at}, ${early} antes del reinicio. ¿Bajamos el ritmo o pasamos a un modelo más ligero?`, 'alert', 15000, {
          cat: 'usage', actions: [{ label: '📊 Ver uso', cmd: 'panel.usage' }, { label: '👍 Entendido', cmd: 'ack' }],
        });
      }
    }
    store.save();
  }

  function processThresholds() {
    const store = M.store;
    const usage = M.usage;
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
      const crossed = M.THRESHOLDS.filter((t) => l.utilization >= t && !done.includes(t) && (important || t >= 75));
      if (crossed.length) {
        store.data.alerts[key] = [...done, ...crossed];
        const t = Math.max(...crossed);
        if (!best || t > best.t) best = { l, t };
      }
    }

    const s = (usage.limits || []).find((l) => l.key === 'five_hour');
    if (s && prevSession && prevSession.utilization >= 30 && s.utilization < 10 && s.resetsAt !== prevSession.resetsAt) {
      M.say('¡Tu límite de sesión se reinició! 🎉 Energía al 100%', 'celebrate', 9000);
      M.pushChat('pet', '¡Tu límite de sesión de 5 h se reinició! 🎉');
      if (M.ex) setTimeout(() => M.ex.onSessionReset(), 10000);
    } else if (best) {
      const m = M.brain.thresholdMessage(best.l, best.t);
      M.say(m.text, m.anim, 10000);
      M.pushChat('pet', m.text);
    }
    if (s) prevSession = s;
    store.save();
  }

  return { refreshUsage, updateForecasts, processThresholds };
};

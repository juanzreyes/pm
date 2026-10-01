// Correo, calendario y reuniones.
// Parte del proceso principal (antes en main.js). `M` es el contexto compartido de la app:
// da acceso a todo lo demás (ventanas, datos, funciones de otros módulos).
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  // ---------- correo y agenda ----------
  let mailState = { status: 'off' };
  let calState = { status: 'off', events: [] };
  let meetingNow = null; // { app, title, since }
  const reminded = new Set();

  function mailConfig() {
    const m = M.store.data.settings.mail;
    return m && m.user && m.passEnc ? m : null;
  }

  // ----- cuentas con inicio de sesión web (Microsoft / Google) -----
  // Los IDs de aplicación se buscan primero en tu carpeta de datos (se guardan desde Ajustes, sin
  // recompilar) y luego junto a la app (oauth.config.json que viaja dentro del instalador).
  const userOauthFile = () => M.path.join(M.app.getPath('userData'), 'oauth.config.json');
  function oauthConfig() {
    const out = {};
    for (const f of [M.path.join(M.APP_DIR, 'oauth.config.example.json'), M.path.join(M.APP_DIR, 'oauth.config.json'), userOauthFile()]) {
      try {
        const c = JSON.parse(M.fs.readFileSync(f, 'utf8'));
        for (const p of ['microsoft', 'google']) if (c[p] && c[p].clientId) out[p] = c[p];
      } catch { /* no existe */ }
    }
    return out;
  }
  /** Guarda los IDs pegados en Ajustes (un campo vacío deja el que había). */
  function saveOauthConfig(patch) {
    let cur = {};
    try { cur = JSON.parse(M.fs.readFileSync(userOauthFile(), 'utf8')); } catch { /* primera vez */ }
    const clean = (s) => String(s || '').trim();
    if (patch.microsoft) {
      const m = { ...(cur.microsoft || {}) };
      if (clean(patch.microsoft.clientId)) m.clientId = clean(patch.microsoft.clientId);
      if ('tenant' in patch.microsoft) m.tenant = clean(patch.microsoft.tenant);
      if (m.clientId && !/^[0-9a-f-]{36}$/i.test(m.clientId)) throw new Error('El ID de aplicación de Microsoft es un GUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)');
      if (m.tenant && !/^[\w.-]+$/.test(m.tenant)) throw new Error('El inquilino debe ser un ID o un dominio (ej. tuempresa.onmicrosoft.com)');
      cur.microsoft = m;
    }
    if (patch.google) {
      const g = { ...(cur.google || {}) };
      if (clean(patch.google.clientId)) g.clientId = clean(patch.google.clientId);
      if (clean(patch.google.clientSecret)) g.clientSecret = clean(patch.google.clientSecret);
      if (g.clientId && !/\.apps\.googleusercontent\.com$/.test(g.clientId)) throw new Error('El ID de cliente de Google termina en .apps.googleusercontent.com');
      cur.google = g;
    }
    if (patch.remove) delete cur[patch.remove];
    M.fs.mkdirSync(M.path.dirname(userOauthFile()), { recursive: true });
    M.fs.writeFileSync(userOauthFile(), JSON.stringify(cur, null, 2));
    return oauthReady();
  }
  function oauthInfo() {
    const c = oauthConfig();
    return {
      microsoft: { clientId: (c.microsoft && c.microsoft.clientId) || '', tenant: (c.microsoft && c.microsoft.tenant) || '' },
      google: { clientId: (c.google && c.google.clientId) || '', hasSecret: !!(c.google && c.google.clientSecret) },
    };
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
    encrypt: M.encrypt,
    decrypt: M.decrypt,
    save: () => M.store.save(),
  };
  function connectedAccounts() {
    return Object.values(M.store.data.settings.accounts || {}).filter((a) => a && a.refreshEnc);
  }
  const PROVIDER_LABEL = { microsoft: 'Microsoft', google: 'Google' };
  const accountErrors = {}; // provider -> mensaje

  async function refreshMail(announce = false) {
    const sources = connectedAccounts().map((acc) => ({
      label: acc.email || PROVIDER_LABEL[acc.provider],
      provider: acc.provider,
      run: () => M.accounts.mailOf(acc, accountIo),
    }));
    const cfg = mailConfig();
    if (cfg) sources.push({ label: cfg.user, provider: 'imap', run: () => M.mail.check({ host: cfg.host, port: cfg.port, user: cfg.user, pass: M.decrypt(cfg.passEnc) }) });
    if (!sources.length) { mailState = { status: 'off' }; M.broadcast(); return mailState; }

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
      const known = new Set(M.store.data.mailSeen || []);
      const fresh = recent.filter((m) => !known.has(m.uid));
      // La primera vez solo memoriza; después avisa de los nuevos.
      if (M.store.data.mailSeen && fresh.length && !M.isMuted() && !meetingNow) {
        const m = fresh[0];
        const more = fresh.length > 1 ? ` (y ${fresh.length - 1} más)` : '';
        M.say(`📧 Correo nuevo de ${m.from}: "${m.subject.slice(0, 60)}"${more}`, 'flap', 10000);
      }
      M.store.data.mailSeen = [...new Set([...(M.store.data.mailSeen || []), ...recent.map((m) => m.uid)])].slice(-300);
      M.store.save();
    }
    mailState = { status: ok ? 'ok' : 'error', unseen, recent: recent.slice(0, 8), errors, error: errors.map((e) => `${e.label}: ${e.error}`).join(' · '), at: Date.now() };
    if (announce && ok) M.say(`¡Correo conectado! 📬 Tienes ${unseen} sin leer.`, 'celebrate', 8000);
    M.broadcast();
    return mailState;
  }

  async function refreshCalendar(announce = false) {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = from.getTime() + 3 * 864e5;
    const sources = connectedAccounts().map((acc) => ({
      label: acc.email || PROVIDER_LABEL[acc.provider],
      provider: acc.provider,
      run: () => M.accounts.eventsOf(acc, accountIo, from.getTime(), to),
    }));
    const url = M.decrypt(M.store.data.settings.calendarUrl);
    if (url) sources.push({ label: 'Calendario ICS', provider: 'ics', run: () => M.calendar.load(url, from.getTime(), to) });
    if (!sources.length) { calState = { status: 'off', events: [] }; M.broadcast(); return calState; }

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
      M.say(`¡Agenda conectada! 📅 Hoy tienes ${n} reunion${n === 1 ? '' : 'es'}.`, 'celebrate', 8000);
    }
    M.broadcast();
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
      M.shell.openExternal(url);
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
        M.say(`📅 En ${Math.round(mins)} min: "${e.title}"${where}. ¡Prepárate! 🎧`, 'alarm-soft', 12000, {
          actions: e.join && e.join.url ? [{ label: '🎧 Unirme', cmd: 'open.url', arg: e.join.url }, { label: '👍 Ok', cmd: 'ack' }] : undefined,
        });
        M.pushChat('pet', `📅 En ${Math.round(mins)} min tienes "${e.title}"${where}.`);
      }
      if (mins <= 1 && mins > -5 && !reminded.has(e.id + '|0')) {
        reminded.add(e.id + '|0');
        M.say(`🎧 ¡Ya empieza "${e.title}"!`, 'alarm', 20000, {
          actions: e.join && e.join.url ? [{ label: '🎧 Unirme ahora', cmd: 'open.url', arg: e.join.url }] : undefined,
        });
        if (M.Notification.isSupported()) {
          const n = new M.Notification({
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
    const keys = Object.keys(M.store.data.days).filter((k) => k < M.dayKey() && M.store.data.days[k].standup).sort();
    const k = keys[keys.length - 1];
    return k ? { date: k, ...M.store.data.days[k] } : null;
  }

  function snapshot() {
    const ps = M.prod ? M.prod.snapshot() : {};
    const s = { ...M.store.data.settings };
    s.hasManualToken = !!s.manualToken;
    // Los secretos nunca salen del proceso principal.
    s.hasAiKey = !!s.aiKey;
    s.hasGithubToken = !!s.githubToken;
    for (const k of ['manualToken', 'aiKey', 'githubToken', 'calendarUrl', 'accounts', 'backupPass', 'trackers', 'teamWebhook', 'telegramToken', 'telegramPairCode', 'telegramChatId']) delete s[k];
    s.hasBackupPass = !!M.store.data.settings.backupPass;
    if (s.mail) s.mail = { provider: s.mail.provider, user: s.mail.user };
    const recent = {};
    Object.keys(M.store.data.days).sort().slice(-14).forEach((k) => (recent[k] = M.store.data.days[k]));
    return {
      pet: M.store.data.pet,
      settings: s,
      usage: M.usage,
      todayKey: M.dayKey(),
      today: M.store.data.days[M.dayKey()] || {},
      days: recent,
      previous: previousStandup(),
      chat: M.store.data.chat.slice(-60),
      autoStart: M.app.getLoginItemSettings().openAtLogin,
      life: { angryUntil: M.store.data.life.angryUntil, closes: M.store.data.life.closes, crashes: M.store.data.life.crashes, lastView: M.store.data.life.lastView },
      web: { connected: !!M.store.data.web.orgId, orgName: M.store.data.web.orgName },
      focusNow: { cat: M.fx.cat, label: M.fx.label, scoldLevel: M.fx.scoldLevel },
      level: M.levelInfo(M.store.data.pet.xp || 0),
      stage: M.gami.stageOf(M.levelInfo(M.store.data.pet.xp || 0).level),
      coins: Math.floor(M.store.data.pet.coins || 0),
      streaks: M.gami.streaks(M.store.data),
      achievements: M.gami.ACHIEVEMENTS.map((a) => {
        const got = (M.store.data.pet.achievements || []).find((x) => x.id === a.id);
        return { id: a.id, emoji: a.emoji, name: a.name, desc: a.desc, reward: a.reward, at: got ? got.at : null };
      }),
      shop: M.gami.SHOP.map((x) => ({
        ...x,
        owned: (M.store.data.pet.owned || []).includes(x.id),
        equipped: (M.store.data.pet.equipped || {})[x.slot] === x.id,
      })),
      equipped: M.store.data.pet.equipped || {},
      lang: M.lang(),
      ai: {
        hasKey: !!M.store.data.settings.aiKey,
        model: M.store.data.settings.aiModel || M.aiMod.DEFAULT_MODEL,
        models: M.aiMod.MODELS,
        enabled: M.store.data.settings.aiEnabled !== false,
      },
      monitors: (M.store.data.settings.monitors || []).map((m) => ({ ...m, state: M.monitorState[m.id] || null })),
      presenting: M.presenting ? M.presenting.reason : null,
      autoHide: M.store.data.settings.autoHide !== false,
      version: M.app.getVersion(),
      packaged: M.app.isPackaged,
      dark: M.isDark(),
      contrast: (M.store.data.settings.theme || 'system') === 'contrast' || ((M.store.data.settings.theme || 'system') === 'system' && M.nativeTheme.shouldUseHighContrastColors),
      inbox: (M.store.data.inbox || []).slice(-100).reverse(),
      unread: (M.store.data.inbox || []).filter((x) => !x.read && x.cat !== 'pet').length,
      trackingPausedUntil: M.trackingPaused() ? M.store.data.settings.trackingPausedUntil : 0,
      flags: M.store.data.flags || {},
      checklist: M.checklist(ps.claudeCode && ps.claudeCode.installed),
      estimates: M.estimateStats(),
      dataDir: M.app.getPath('userData'),
      muted: M.isMuted(),
      mail: {
        ...mailState,
        configured: !!mailConfig() || connectedAccounts().length > 0,
        imap: !!mailConfig(),
        user: mailConfig() ? mailConfig().user : '',
        provider: mailConfig() ? mailConfig().provider : '',
      },
      calendar: { ...calState, configured: !!M.store.data.settings.calendarUrl || connectedAccounts().length > 0, ics: !!M.store.data.settings.calendarUrl },
      accounts: connectedAccounts().map((a) => ({ provider: a.provider, email: a.email, error: accountErrors[a.provider] || null })),
      oauthReady: oauthReady(),
      oauthInfo: oauthInfo(),
      meetingNow,
      ...ps,
      ...(M.ex ? M.ex.snapshot() : {}),
      ...(M.plan ? M.plan.snapshot() : {}),
      ...(M.pl ? M.pl.snapshot() : {}),
      pushChecks: M.store.data.pushChecks || {},
      claudeSessions: M.sess ? M.sess.list() : [],
      tickets: M.work.ticketsState(),
      ...M.work.runsState(),
      remote: M.remote.remoteState(),
      team: M.team.teamState(),
      farm: M.farm ? M.farm.farmState() : null,
      game: M.gz ? M.gz.gameState() : null,
      browserExt: M.browser ? M.browser.browserState() : null,
      plugins: M.plugins ? M.plugins.pluginsState() : null,
      errReport: M.errreport.errState(),
      ...(M.soul ? M.soul.snapshot() : {}),
      presence: M.presence.presenceState(),
      where: M.whereami.whereState(),
      coach: M.coach.coachState(),
      audioListen: M.audioState || null,
      integrations: M.integrationsState(),
      profiles: { ...M.profiles.list(), activeId: M.profiles.active().id },
      sync: { enabled: !!M.store.data.settings.syncEnabled, dir: M.syncDir(), lastAt: M.store.data.lastSyncAt || 0, device: M.os.hostname() },
      exportsInfo: { markdownDir: M.store.data.settings.markdownDir || '', lastMarkdownAt: M.store.data.lastMarkdownAt || 0, autoMarkdown: !!M.store.data.settings.autoMarkdown },
      cli: M.cliInstalled(),
      focusMode: M.focusMode(),
      focusUntil: M.store.data.focusUntil > Date.now() ? M.store.data.focusUntil : 0,
      presets: Object.fromEntries(Object.entries(M.mail.PRESETS).map(([k, v]) => [k, { label: v.label, host: v.host, port: v.port, help: v.help }])),
    };
  }

  return {
    get mailState() { return mailState; },
    set mailState(v) { mailState = v; },
    get calState() { return calState; },
    set calState(v) { calState = v; },
    get meetingNow() { return meetingNow; },
    set meetingNow(v) { meetingNow = v; },
    reminded,
    mailConfig,
    oauthConfig,
    oauthReady,
    saveOauthConfig,
    accountIo,
    connectedAccounts,
    PROVIDER_LABEL,
    accountErrors,
    refreshMail,
    refreshCalendar,
    todaysMeetings,
    currentEvent,
    joinMeeting,
    meetingReminders,
    previousStandup,
    snapshot,
  };
};

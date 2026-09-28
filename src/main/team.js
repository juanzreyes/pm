// Configuración del equipo en un clic: exportar / importar pm-equipo.json (src/teampack.js).
// Si el instalador trae un pm-equipo.json junto a la app, se aplica solo la primera vez.
// Parte del proceso principal. `M` es el contexto compartido de la app.
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  const teampack = require('../teampack');
  const set = () => M.store.data.settings;
  const DEFAULT_ROUTINE = { morningTime: '08:00', eveningTime: '16:30' };

  /** Guarda el paquete del equipo en un archivo. */
  async function exportPack({ includeWebhook = false, name = '' } = {}) {
    const pack = teampack.build(set(), M.oauthConfig(), { name, webhook: includeWebhook ? M.decrypt(set().teamWebhook || '') : '' });
    const parent = M.settingsWin && !M.settingsWin.isDestroyed() ? M.settingsWin : undefined;
    const r = await M.dialog.showSaveDialog(parent, {
      title: 'Guardar la configuración del equipo',
      defaultPath: M.path.join(M.app.getPath('documents'), 'pm-equipo.json'),
      filters: [{ name: 'Configuración de PM Pollito', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    M.fs.writeFileSync(r.filePath, JSON.stringify(pack, null, 2));
    M.shell.showItemInFolder(r.filePath);
    return { ok: true, file: r.filePath, webhook: !!(pack.team && pack.team.webhook) };
  }

  /** Aplica un paquete ya validado. Nunca pisa tokens; la rutina solo si seguía la de fábrica. */
  async function applyPack(pack) {
    const s = set();
    const tr = { ...(s.trackers || {}) };
    if (pack.trackers.jira) tr.jira = { ...(tr.jira || {}), site: pack.trackers.jira.site };
    if (pack.trackers.azure) tr.azure = { ...(tr.azure || {}), org: pack.trackers.azure.org };
    if (pack.trackers.github && s.githubToken) tr.github = { ...(tr.github || {}), on: true };
    s.trackers = tr;
    if (pack.oauth.microsoft || pack.oauth.google) M.saveOauthConfig({ ...(pack.oauth.microsoft ? { microsoft: pack.oauth.microsoft } : {}), ...(pack.oauth.google ? { google: pack.oauth.google } : {}) });
    const team = {};
    if (pack.team.webhook) Object.assign(team, { teamWebhook: pack.team.webhook, teamOn: true });
    if (pack.team.daily) team.teamDaily = pack.team.daily;
    if (pack.team.weekly) team.teamWeekly = true;
    if (pack.team.cats) team.teamCats = pack.team.cats;
    if (Object.keys(team).length) await M.remote.save(team);
    for (const k of ['morningTime', 'eveningTime']) if (pack.routine[k] && (!s[k] || s[k] === DEFAULT_ROUTINE[k])) s[k] = pack.routine[k];
    if (pack.routine.workdaysOnly) s.workdaysOnly = true;
    M.store.data.teamPack = { name: pack.name, at: Date.now() };
    M.store.flush();
    M.broadcast();
    return teampack.todo(pack);
  }

  async function importFrom(file) {
    const pack = teampack.parse(M.fs.readFileSync(file, 'utf8'));
    const todo = await applyPack(pack);
    M.say(`👥 ¡Configuración${pack.name ? ` de "${pack.name}"` : ' del equipo'} lista!${todo.length ? ` Te falta: ${todo.join(' · ')}` : ''}`, 'celebrate', 20000, {
      cat: 'pet', actions: [{ label: '⚙️ Completar', cmd: 'settings.integrations' }],
    });
    return { ok: true, name: pack.name, todo };
  }

  /** Elige el archivo y lo aplica. */
  async function importPack(file) {
    try {
      if (!file) {
        const parent = M.settingsWin && !M.settingsWin.isDestroyed() ? M.settingsWin : undefined;
        const r = await M.dialog.showOpenDialog(parent, { title: 'Configuración del equipo (pm-equipo.json)', properties: ['openFile'], filters: [{ name: 'Configuración de PM Pollito', extensions: ['json'] }] });
        if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
        file = r.filePaths[0];
      }
      return await importFrom(file);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Instalador preparado para un equipo: pm-equipo.json junto a la app se aplica la primera vez. */
  async function applyBundled() {
    if (M.store.data.teamPack) return;
    const f = M.path.join(M.APP_DIR, 'pm-equipo.json');
    if (!M.fs.existsSync(f)) return;
    try { await importFrom(f); } catch (e) { M.diag.log('main', 'pm-equipo.json del instalador: ' + e.message); }
  }

  const teamState = () => ({ pack: M.store.data.teamPack || null });

  return { exportPack, importPack, applyBundled, teamState };
};

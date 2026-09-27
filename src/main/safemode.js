// Modo seguro y copias para restaurar al arrancar.
// Parte del proceso principal (antes en main.js). `M` es el contexto compartido de la app:
// da acceso a todo lo demás (ventanas, datos, funciones de otros módulos).
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  // ---------- modo seguro ----------
  // boot.json anota cada arranque; si dos seguidos no llegan a durar 90 s, algo va mal.
  let SAFE = false;
  const bootFile = () => M.path.join(M.app.getPath('userData'), 'boot.json');
  function readBoot() { try { return JSON.parse(M.fs.readFileSync(bootFile(), 'utf8')); } catch { return {}; } }
  function writeBoot(b) { try { M.fs.writeFileSync(bootFile(), JSON.stringify(b)); } catch { /* sin disco */ } }
  /** Última copia disponible: la automática (carpeta de copias) o el .bak interno. */
  function latestBackup() {
    const out = [];
    try {
      const raw = JSON.parse(M.fs.readFileSync(M.path.join(M.app.getPath('userData'), 'pm-data.json.bak'), 'utf8'));
      if (raw && raw.pet) out.push({ file: 'pm-data.json.bak', at: M.fs.statSync(M.path.join(M.app.getPath('userData'), 'pm-data.json.bak')).mtimeMs, data: raw });
    } catch { /* no hay */ }
    try {
      const dir = require('../backup').suggestDir();
      for (const f of M.fs.readdirSync(dir).filter((x) => /^pm-pollito-backup-.*\.json$/.test(x))) {
        const p = M.path.join(dir, f);
        try {
          const env = JSON.parse(M.fs.readFileSync(p, 'utf8'));
          if (env && env.data && env.data.pet) out.push({ file: p, at: M.fs.statSync(p).mtimeMs, data: env.data });
        } catch { /* cifrada o rota */ }
      }
    } catch { /* sin carpeta */ }
    return out.sort((a, b) => b.at - a.at)[0] || null;
  }
  async function checkSafeMode() {
    const prev = readBoot();
    const fails = prev.pending ? (prev.fails || 0) + 1 : 0;
    writeBoot({ pending: true, fails, at: Date.now() });
    setTimeout(() => writeBoot({ pending: false, fails: 0, at: Date.now() }), 90e3); // ha arrancado bien
    if (fails < 2 || process.env.PM_NO_SAFE) return;
    const bk = latestBackup();
    const buttons = ['Arrancar en modo seguro', 'Arrancar normal'];
    if (bk) buttons.splice(1, 0, `Restaurar la copia del ${new Date(bk.at).toLocaleString()}`);
    const r = await M.dialog.showMessageBox({
      type: 'warning', title: 'PM Pollito', buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true,
      message: 'PM se cerró al arrancar varias veces seguidas 😿',
      detail: 'En modo seguro arranco solo con lo básico (sin vigilar ventanas, git, Claude Code ni sitios) para que puedas revisar Ajustes → Diagnóstico. También puedo restaurar mi última copia de seguridad.',
    });
    const choice = buttons[r.response];
    if (choice.startsWith('Restaurar') && bk) {
      const cur = M.path.join(M.app.getPath('userData'), 'pm-data.json');
      try { M.fs.copyFileSync(cur, cur.replace(/\.json$/, `.antes-de-restaurar-${Date.now()}.json`)); } catch { /* no existía */ }
      M.fs.writeFileSync(cur, JSON.stringify(bk.data));
      M.diag.log('info', `Restaurada la copia ${bk.file}`);
    } else if (choice.startsWith('Arrancar en modo seguro')) {
      SAFE = true;
      M.diag.log('info', 'Arranque en modo seguro');
    }
  }

  return {
    get SAFE() { return SAFE; },
    set SAFE(v) { SAFE = v; },
    bootFile,
    readBoot,
    writeBoot,
    latestBackup,
    checkSafeMode,
  };
};

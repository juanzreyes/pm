// Copia de seguridad automática de la memoria del pollito en una carpeta sincronizada
// (OneDrive o Google Drive si existen; si no, Documentos). Sin APIs: la sincroniza tu cliente de nube.
const fs = require('fs');
const path = require('path');
const os = require('os');

const SECRETS = ['manualToken', 'aiKey', 'githubToken', 'calendarUrl'];

/** Carpeta sugerida para las copias. */
function suggestDir() {
  const h = os.homedir();
  const candidates = [
    process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial,
    path.join(h, 'OneDrive'), 'G:\\Mi unidad', 'G:\\My Drive', path.join(h, 'Google Drive'), path.join(h, 'Documents'),
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.statSync(c).isDirectory()) return path.join(c, 'PM Pollito'); } catch { /* no existe */ }
  }
  return path.join(h, 'PM Pollito');
}

/** Copia sin secretos (las claves cifradas solo sirven en este PC). */
function sanitized(data) {
  const d = JSON.parse(JSON.stringify(data));
  for (const k of SECRETS) delete d.settings[k];
  if (d.settings.mail) delete d.settings.mail.passEnc;
  if (d.settings.accounts) d.settings.accounts = {};
  return d;
}

/** Escribe la copia y deja solo las últimas `keep`. Devuelve la ruta. */
function write(dir, data, version, keep = 6) {
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const file = path.join(dir, `pm-pollito-backup-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ app: 'pm-pollito', version, exportedAt: d.toISOString(), data: sanitized(data) }, null, 2));
  const old = fs.readdirSync(dir).filter((f) => /^pm-pollito-backup-.*\.json$/.test(f)).sort().reverse();
  for (const f of old.slice(keep)) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* en uso */ } }
  return file;
}

module.exports = { suggestDir, sanitized, write };

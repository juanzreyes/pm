// Copia de seguridad automática de la memoria del pollito en una carpeta sincronizada
// (OneDrive o Google Drive si existen; si no, Documentos). Sin APIs: la sincroniza tu cliente de nube.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const SECRETS = ['manualToken', 'aiKey', 'githubToken', 'calendarUrl', 'backupPass', 'trackers', 'teamWebhook', 'telegramToken', 'telegramChatId', 'telegramPairCode'];

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

// ---------- cifrado opcional (AES-256-GCM, clave derivada con scrypt) ----------
function encrypt(obj, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(String(password), salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { alg: 'aes-256-gcm/scrypt', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), body: body.toString('base64') };
}
function decrypt(enc, password) {
  const key = crypto.scryptSync(String(password), Buffer.from(enc.salt, 'base64'), 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'base64'));
  d.setAuthTag(Buffer.from(enc.tag, 'base64'));
  const out = Buffer.concat([d.update(Buffer.from(enc.body, 'base64')), d.final()]);
  return JSON.parse(out.toString('utf8'));
}
/** Contenido del archivo de copia: cifrado si hay contraseña. */
function envelope(data, version, password) {
  const base = { app: 'pm-pollito', version, exportedAt: new Date().toISOString() };
  return password ? { ...base, encrypted: encrypt(sanitized(data), password) } : { ...base, data: sanitized(data) };
}
/** Lee una copia (cifrada o no). Lanza 'PASSWORD' si hace falta contraseña o no es la buena. */
function open(parsed, password) {
  if (!parsed || parsed.app !== 'pm-pollito') throw new Error('NOT_PM');
  if (parsed.data) return parsed.data;
  if (!parsed.encrypted) throw new Error('NOT_PM');
  if (!password) throw new Error('PASSWORD');
  try { return decrypt(parsed.encrypted, password); } catch { throw new Error('PASSWORD'); }
}

/** Escribe la copia y deja solo las últimas `keep`. Devuelve la ruta. */
function write(dir, data, version, keep = 6, password = '') {
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const file = path.join(dir, `pm-pollito-backup-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(envelope(data, version, password), null, 2));
  const old = fs.readdirSync(dir).filter((f) => /^pm-pollito-backup-.*\.json$/.test(f)).sort().reverse();
  for (const f of old.slice(keep)) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* en uso */ } }
  return file;
}

module.exports = { suggestDir, sanitized, write, envelope, open, encrypt, decrypt };

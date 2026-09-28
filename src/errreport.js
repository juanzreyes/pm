// Informe de errores opcional: qué se manda al autor cuando algo falla en el PC de alguien.
// Solo con permiso, solo errores (nunca tareas, notas, chat ni eventos) y limpiados de datos
// personales: rutas de usuario, correos, tokens, claves y parámetros de enlaces.
// Lógica pura; el envío y el permiso viven en src/main/errreport.js.
const crypto = require('crypto');

/** Quita datos personales de un texto de error. */
function scrub(text, { home = '', user = '' } = {}) {
  let s = String(text || '');
  if (home) s = s.split(home).join('~').split(home.replace(/\\/g, '/')).join('~');
  s = s
    .replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s'"]+/gi, '~') // otras rutas de usuario de Windows
    .replace(/\/(?:home|Users)\/[^/\s'"]+/g, '~')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<correo>')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[\w-]{10,}|xox[abpr]-[\w-]{10,}|lin_api_\w{10,}|\d{6,}:[\w-]{30,})\b/g, '<token>')
    .replace(/\b(Bearer|Basic)\s+[\w.~+/=-]{8,}/gi, '$1 <token>')
    .replace(/(https?:\/\/[^\s?#'"]+)[?#][^\s'"]*/g, '$1?…') // los parámetros de un enlace pueden llevar claves
    .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, '<secreto>'); // cadenas largas (tokens, claves cifradas)
  if (user && user.length >= 3) s = s.split(user).join('<usuario>');
  return s;
}

/** Huella de un error (el mismo fallo con distintos números cuenta como uno). */
function fingerprint(e) {
  const first = String(e.msg || '').split('\n')[0].replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha1').update(`${e.where}|${first}`).digest('hex').slice(0, 12);
}

/**
 * Errores que aún no se enviaron (sin repetir la misma huella), como mucho `max`.
 * sent: { huella: cuándo se envió }.
 */
function pending(errors, sent = {}, max = 5) {
  const out = [];
  const seen = new Set();
  for (const e of errors || []) {
    if (!e || e.where === 'info') continue;
    const fp = fingerprint(e);
    if (sent[fp] || seen.has(fp)) continue;
    seen.add(fp);
    out.push({ ...e, fp });
    if (out.length >= max) break;
  }
  return out;
}

/** Mensaje para el canal del autor. meta: { version, os, electron, install } */
function message(batch, meta, ctx = {}) {
  const lines = batch.map((e) => {
    const body = scrub(e.msg, ctx).split('\n').slice(0, 6).join('\n').slice(0, 900);
    return `• [${e.where}] ${body}`;
  });
  return {
    title: `🐞 PM Pollito ${meta.version} · ${meta.os}`,
    text: [`Instalación ${meta.install} · Electron ${meta.electron} · ${batch.length} error${batch.length === 1 ? '' : 'es'} nuevo${batch.length === 1 ? '' : 's'}`, '', ...lines].join('\n').slice(0, 3800),
  };
}

module.exports = { scrub, fingerprint, pending, message };

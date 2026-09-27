// Correo por IMAP (solo lectura): cuántos correos sin leer tienes y de quién son.
// Se usa una "contraseña de aplicación", nunca tu contraseña normal.
const { ImapFlow } = require('imapflow');

const PRESETS = {
  gmail: { label: 'Gmail', host: 'imap.gmail.com', port: 993, help: 'https://myaccount.google.com/apppasswords' },
  yahoo: { label: 'Yahoo', host: 'imap.mail.yahoo.com', port: 993, help: 'https://login.yahoo.com/account/security' },
  icloud: { label: 'iCloud', host: 'imap.mail.me.com', port: 993, help: 'https://account.apple.com' },
  outlook: { label: 'Outlook / Microsoft 365', host: 'outlook.office365.com', port: 993, help: null },
  zoho: { label: 'Zoho', host: 'imap.zoho.com', port: 993, help: null },
  custom: { label: 'Otro (IMAP)', host: '', port: 993, help: null },
};

function friendlyError(e) {
  const msg = String((e && (e.responseText || e.message)) || e);
  if (/auth|credential|login|invalid|password/i.test(msg)) {
    return 'Usuario o contraseña de aplicación incorrectos. Recuerda: no es tu contraseña normal, es una "contraseña de aplicación".';
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(msg)) return 'No pude llegar al servidor de correo. Revisa el servidor o tu conexión.';
  return msg.slice(0, 200);
}

/** Consulta la bandeja de entrada. Devuelve { unseen, recent: [{uid, from, subject, date}] }. */
async function check({ host, port, user, pass }) {
  const client = new ImapFlow({
    host,
    port: Number(port) || 993,
    secure: true,
    auth: { user, pass },
    logger: false,
    socketTimeout: 30000,
  });
  client.on('error', () => {}); // evita que un corte de red tumbe la app
  try {
    await client.connect();
  } catch (e) {
    throw new Error(friendlyError(e));
  }
  try {
    const lock = await client.getMailboxLock('INBOX');
    const recent = [];
    let unseen = 0;
    try {
      const uids = (await client.search({ seen: false }, { uid: true })) || [];
      unseen = uids.length;
      const last = uids.slice(-8);
      if (last.length) {
        for await (const msg of client.fetch(last, { envelope: true, uid: true }, { uid: true })) {
          const f = (msg.envelope.from && msg.envelope.from[0]) || {};
          recent.push({
            uid: msg.uid,
            from: f.name || f.address || 'desconocido',
            address: f.address || '',
            subject: msg.envelope.subject || '(sin asunto)',
            date: msg.envelope.date ? new Date(msg.envelope.date).getTime() : null,
          });
        }
      }
    } finally {
      lock.release();
    }
    recent.sort((a, b) => (b.date || 0) - (a.date || 0));
    return { unseen, recent };
  } finally {
    await client.logout().catch(() => {});
  }
}

module.exports = { PRESETS, check };

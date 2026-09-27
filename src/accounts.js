// Cuentas conectadas por inicio de sesión web (Microsoft / Google):
// correos sin leer (solo remitente y asunto) y reuniones del calendario.
const oauth = require('./oauth');
const { findJoin } = require('./calendar');

class AuthError extends Error {}

/**
 * Gestiona los tokens de una cuenta. `acc` = { provider, email, refreshEnc }.
 * `io` = { cfg(provider), decrypt, encrypt, save }.
 */
const tokenCache = new Map(); // provider -> { token, exp }

async function accessToken(acc, io) {
  const c = tokenCache.get(acc.provider);
  if (c && c.exp > Date.now() + 60000) return c.token;
  const cfg = io.cfg(acc.provider);
  let t;
  try {
    t = await oauth.refresh(acc.provider, cfg, io.decrypt(acc.refreshEnc));
  } catch (e) {
    if (e.code === 'invalid_grant' || e.code === 'interaction_required') throw new AuthError('La sesión caducó: vuelve a conectar la cuenta.');
    throw e;
  }
  if (t.refresh_token) { acc.refreshEnc = io.encrypt(t.refresh_token); io.save(); } // Microsoft rota el token
  tokenCache.set(acc.provider, { token: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000 });
  return t.access_token;
}

async function api(acc, io, url, headers = {}) {
  const token = await accessToken(acc, io);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...headers } });
  if (res.status === 401) {
    tokenCache.delete(acc.provider);
    throw new AuthError('La sesión caducó: vuelve a conectar la cuenta.');
  }
  if (!res.ok) throw new Error(`${acc.provider} respondió ${res.status}`);
  return res.json();
}

/** Tras el login: guarda la cuenta y averigua su correo. */
async function connect(provider, io) {
  const t = await oauth.authorize(provider, io.cfg(provider));
  if (!t.refresh_token) throw new Error('El proveedor no devolvió acceso permanente. Inténtalo de nuevo.');
  tokenCache.set(provider, { token: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000 });
  const acc = { provider, email: '', refreshEnc: io.encrypt(t.refresh_token) };
  try {
    if (provider === 'microsoft') {
      const me = await api(acc, io, 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName');
      acc.email = me.mail || me.userPrincipalName || me.displayName || '';
    } else {
      const me = await api(acc, io, 'https://openidconnect.googleapis.com/v1/userinfo');
      acc.email = me.email || '';
    }
  } catch { /* no crítico */ }
  return acc;
}

function forget(provider) {
  tokenCache.delete(provider);
}

// ---------- correo ----------
async function mailOf(acc, io) {
  if (acc.provider === 'microsoft') {
    const G = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox';
    const folder = await api(acc, io, `${G}?$select=unreadItemCount`);
    const list = await api(acc, io, `${G}/messages?$filter=receivedDateTime ge 2000-01-01T00:00:00Z and isRead eq false&$top=8&$select=id,subject,from,receivedDateTime&$orderby=receivedDateTime desc`);
    return {
      unseen: folder.unreadItemCount || 0,
      recent: (list.value || []).map((m) => ({
        uid: 'ms:' + m.id,
        from: (m.from && m.from.emailAddress && (m.from.emailAddress.name || m.from.emailAddress.address)) || 'desconocido',
        subject: m.subject || '(sin asunto)',
        date: Date.parse(m.receivedDateTime) || null,
      })),
    };
  }
  // Google (Gmail, solo metadatos: remitente y asunto)
  const B = 'https://gmail.googleapis.com/gmail/v1/users/me';
  const label = await api(acc, io, `${B}/labels/INBOX`);
  const list = await api(acc, io, `${B}/messages?labelIds=INBOX&labelIds=UNREAD&maxResults=8`);
  const recent = [];
  for (const m of list.messages || []) {
    try {
      const d = await api(acc, io, `${B}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
      const h = Object.fromEntries((d.payload.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
      recent.push({
        uid: 'g:' + m.id,
        from: (h.from || 'desconocido').replace(/\s*<.*>$/, '').replace(/^"|"$/g, ''),
        subject: h.subject || '(sin asunto)',
        date: Number(d.internalDate) || null,
      });
    } catch { /* un correo raro no rompe la lista */ }
  }
  return { unseen: label.messagesUnread || 0, recent };
}

// ---------- calendario ----------
async function eventsOf(acc, io, fromMs, toMs) {
  const from = new Date(fromMs).toISOString();
  const to = new Date(toMs).toISOString();
  if (acc.provider === 'microsoft') {
    const url = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${from}&endDateTime=${to}&$top=100&$orderby=start/dateTime` +
      '&$select=id,subject,start,end,isAllDay,isCancelled,location,onlineMeeting,onlineMeetingProvider,bodyPreview';
    const data = await api(acc, io, url, { Prefer: 'outlook.timezone="UTC"' });
    return (data.value || []).filter((e) => !e.isCancelled).map((e) => {
      const joinUrl = e.onlineMeeting && e.onlineMeeting.joinUrl;
      const platform = e.onlineMeetingProvider === 'teamsForBusiness' || /teams/i.test(joinUrl || '') ? 'Teams' : 'Reunión';
      return {
        id: 'ms:' + e.id,
        title: e.subject || '(sin título)',
        start: Date.parse(e.start.dateTime + 'Z'),
        end: Date.parse(e.end.dateTime + 'Z'),
        allDay: !!e.isAllDay,
        location: (e.location && e.location.displayName) || '',
        join: joinUrl ? { platform, url: joinUrl } : findJoin(e.location && e.location.displayName, e.bodyPreview),
      };
    });
  }
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${from}&timeMax=${to}&singleEvents=true&orderBy=startTime&maxResults=100`;
  const data = await api(acc, io, url);
  return (data.items || []).filter((e) => e.status !== 'cancelled').map((e) => {
    const allDay = !!(e.start && e.start.date);
    const s = allDay ? new Date(e.start.date + 'T00:00:00').getTime() : Date.parse(e.start.dateTime);
    const en = allDay ? new Date(e.end.date + 'T00:00:00').getTime() : Date.parse(e.end.dateTime);
    const video = e.conferenceData && (e.conferenceData.entryPoints || []).find((x) => x.entryPointType === 'video');
    const join = findJoin(e.location, e.description, e.hangoutLink) || (video ? { platform: 'Meet', url: video.uri } : null);
    return { id: 'g:' + e.id, title: e.summary || '(sin título)', start: s, end: en, allDay, location: e.location || '', join };
  });
}

module.exports = { connect, forget, mailOf, eventsOf, AuthError };

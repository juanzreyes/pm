// Firebase Cloud Messaging (API HTTP v1) sin SDK: JWT RS256 firmado con WebCrypto → access token
// OAuth (cacheado ~1 h en el isolate) → messages:send. Mismo esquema que eshoy (booking-worker/src/lib/fcm.ts).
// La cuenta de servicio vive solo como secret: `npx wrangler secret put FCM_SERVICE_ACCOUNT < clave.json`.
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const enc = new TextEncoder();
let cached = null;

export function parseServiceAccount(raw) {
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    return sa.project_id && sa.client_email && sa.private_key ? sa : null;
  } catch { return null; }
}
const b64url = (input) => {
  const bytes = typeof input === 'string' ? enc.encode(input) : input;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
function pemToDer(pem) {
  const raw = atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}
async function accessToken(sa, now = Date.now()) {
  if (cached && cached.email === sa.client_email && cached.expiresAt - 60e3 > now) return cached.token;
  const iat = Math.floor(now / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri || TOKEN_URI, iat, exp: iat + 3600 }));
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${claims}`));
  const res = await fetch(sa.token_uri || TOKEN_URI, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${b64url(new Uint8Array(sig))}` }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.access_token) throw new Error('fcm_auth_failed:' + res.status);
  cached = { email: sa.client_email, token: data.access_token, expiresAt: now + (data.expires_in || 3600) * 1000 };
  return cached.token;
}

/**
 * "Despierta" a los teléfonos del espacio que deben leer un mensaje nuevo (todos menos quien lo
 * mandó, o solo el destinatario). Nunca lanza: la push es un extra, el mensaje ya quedó guardado.
 */
export async function wake(env, space, from, to) {
  const sa = parseServiceAccount(env.FCM_SERVICE_ACCOUNT);
  if (!sa) return { sent: 0 };
  let sent = 0;
  try {
    const q = to === '*'
      ? env.DB.prepare('SELECT device, token FROM push_tokens WHERE space = ? AND device != ? LIMIT 10').bind(space, from)
      : env.DB.prepare('SELECT device, token FROM push_tokens WHERE space = ? AND device = ? LIMIT 1').bind(space, to);
    const { results } = await q.all();
    if (!results.length) return { sent: 0 };
    const bearer = await accessToken(sa);
    const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`;
    await Promise.all(results.map(async ({ device, token }) => {
      // Solo datos (sin "notification"): la app decide qué mostrar después de descifrar el buzón.
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ message: { token, data: { pm: 'wake' }, android: { priority: 'HIGH', ttl: '3600s' } } }),
      });
      if (res.ok) { sent++; return; }
      const body = await res.text().catch(() => '');
      if (res.status === 404 || (res.status === 400 && /UNREGISTERED|registration token/i.test(body))) {
        await env.DB.prepare('DELETE FROM push_tokens WHERE space = ? AND device = ?').bind(space, device).run();
      } else console.error('fcm_send_failed', res.status, body.slice(0, 200));
    }));
  } catch (e) {
    console.error('fcm_error', e && e.message);
  }
  return { sent };
}

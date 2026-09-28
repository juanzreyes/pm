// Inicio de sesión web oficial (OAuth 2.0 + PKCE) con Microsoft y Google.
// Se abre TU navegador normal; al aceptar, el navegador vuelve a un servidor local
// temporal (solo 127.0.0.1) que recibe el código y se cierra. PM nunca ve tu contraseña.
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const PROVIDERS = {
  microsoft: {
    label: 'Microsoft',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['offline_access', 'openid', 'email', 'User.Read', 'Mail.ReadBasic', 'Calendars.Read'],
    redirectHost: 'localhost', // Microsoft acepta http://localhost con cualquier puerto
    extra: { prompt: 'select_account' },
  },
  google: {
    label: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'openid',
      'email',
      'https://www.googleapis.com/auth/gmail.metadata',
      'https://www.googleapis.com/auth/calendar.readonly',
    ],
    redirectHost: '127.0.0.1', // Google (app de escritorio) acepta 127.0.0.1 con cualquier puerto
    extra: { access_type: 'offline', prompt: 'consent select_account' },
  },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DONE_PAGE = (ok, rawMsg, msg = esc(rawMsg)) => `<!doctype html><html lang="es"><meta charset="utf-8"><title>PM</title>
<body style="font-family:Segoe UI,system-ui,sans-serif;background:#fff9e8;color:#3b2f2f;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center;border:3px solid #3b2f2f;border-radius:24px;padding:32px 40px;background:#fffdf6;box-shadow:0 5px 0 #3b2f2f">
<div style="font-size:64px">${ok ? '🐣🎉' : '🐣😿'}</div>
<h1 style="margin:8px 0">${ok ? '¡Conectado!' : 'No se pudo conectar'}</h1>
<p>${msg}</p><p style="opacity:.6">Ya puedes cerrar esta pestaña y volver con tu pollito.</p></div></body></html>`;

let pending = null; // solo un inicio de sesión a la vez

/** URLs del proveedor. Microsoft: con `tenant` (ID o dominio de tu empresa) en vez de "common" si la app es de un solo inquilino. */
function urls(providerKey, cfg) {
  const p = PROVIDERS[providerKey];
  const tenant = providerKey === 'microsoft' && cfg && /^[\w.-]+$/.test(cfg.tenant || '') ? cfg.tenant : '';
  if (!tenant) return { authUrl: p.authUrl, tokenUrl: p.tokenUrl };
  return { authUrl: p.authUrl.replace('/common/', `/${tenant}/`), tokenUrl: p.tokenUrl.replace('/common/', `/${tenant}/`) };
}

function isLoopback(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = Object.assign(new Error(json.error_description || json.error || `HTTP ${res.status}`), { code: json.error });
    throw err;
  }
  return json;
}

/**
 * Abre el navegador para iniciar sesión y devuelve los tokens.
 * cfg: { clientId, clientSecret? }
 */
function authorize(providerKey, cfg) {
  const p = PROVIDERS[providerKey];
  if (!p) return Promise.reject(new Error('Proveedor desconocido'));
  if (!cfg || !cfg.clientId) return Promise.reject(new Error('Falta configurar el ID de aplicación (oauth.config.json).'));
  if (pending) pending.cancel('Se inició otro inicio de sesión.');

  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  return new Promise((resolve, reject) => {
    let finished = false;
    let redirectUri = '';
    const server = http.createServer(async (req, res) => {
      if (!isLoopback(req.socket.remoteAddress)) { res.writeHead(403); return res.end(); }
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/callback') { res.writeHead(404); return res.end(); }
      const q = url.searchParams;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (q.get('state') !== state) {
        res.end(DONE_PAGE(false, 'La respuesta no coincide con la solicitud. Inténtalo de nuevo.'));
        return;
      }
      if (q.get('error')) {
        res.end(DONE_PAGE(false, q.get('error_description') || q.get('error')));
        return finish(new Error(q.get('error_description') || q.get('error')));
      }
      try {
        const tokens = await postForm(urls(providerKey, cfg).tokenUrl, {
          client_id: cfg.clientId,
          ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
          grant_type: 'authorization_code',
          code: q.get('code'),
          redirect_uri: redirectUri,
          code_verifier: verifier,
          ...(providerKey === 'microsoft' ? { scope: p.scopes.join(' ') } : {}),
        });
        res.end(DONE_PAGE(true, `Tu cuenta de ${p.label} quedó conectada con PM.`));
        finish(null, tokens);
      } catch (e) {
        res.end(DONE_PAGE(false, e.message));
        finish(e);
      }
    });

    const timer = setTimeout(() => finish(new Error('Se acabó el tiempo para iniciar sesión (5 min).')), 5 * 60000);
    function finish(err, tokens) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      pending = null;
      setTimeout(() => server.close(), 1500);
      if (err) reject(err);
      else resolve(tokens);
    }
    pending = { cancel: (msg) => finish(new Error(msg)) };

    // Escucha en IPv4 e IPv6 locales (dual stack) y solo acepta conexiones de este equipo.
    server.listen(0, '::', () => {
      const port = /** @type {import('net').AddressInfo} */ (server.address()).port;
      redirectUri = `http://${p.redirectHost}:${port}/callback`;
      const params = new URLSearchParams({
        client_id: cfg.clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: p.scopes.join(' '),
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        ...p.extra,
      });
      shell.openExternal(`${urls(providerKey, cfg).authUrl}?${params}`);
    });
    server.on('error', (e) => finish(e));
  });
}

async function refresh(providerKey, cfg, refreshToken) {
  const p = PROVIDERS[providerKey];
  return postForm(urls(providerKey, cfg).tokenUrl, {
    client_id: cfg.clientId,
    ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    ...(providerKey === 'microsoft' ? { scope: p.scopes.join(' ') } : {}),
  });
}

module.exports = { authorize, refresh, urls, PROVIDERS };

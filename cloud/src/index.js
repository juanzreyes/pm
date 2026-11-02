// pm-sync: servidor de sincronización del ecosistema PM Pollito (PC + Android).
//
// Solo guarda paquetes cifrados en el dispositivo: cada persona tiene un "espacio" con la foto
// cifrada de cada uno de sus dispositivos y un buzón de mensajes entre ellos. La llave de cifrado
// viaja de un dispositivo a otro por el QR de vinculación y nunca llega aquí; lo único que se
// guarda para autenticar es el SHA-256 de una llave de acceso derivada de ella.
//
//   GET    /v1/health
//   PUT    /v1/s/:space                 crea el espacio (o comprueba la llave si ya existe)
//   PUT    /v1/s/:space/d/:device       sube la foto de un dispositivo
//   GET    /v1/s/:space/pull?device=&since=&after=   fotos nuevas de los demás + mensajes
//   POST   /v1/s/:space/msg             manda un mensaje a un dispositivo o a todos ('*')
//   DELETE /v1/s/:space/d/:device       desvincula un dispositivo
//   DELETE /v1/s/:space                 borra todo el espacio ("borrar mis datos del servidor")
//   PUT    /v1/s/:space/push            token de Firebase del teléfono (para "despertarlo" con cada mensaje)

import { wake } from './fcm.js';

const VERSION = 1;
const MAX_BLOB = 1_500_000; // caracteres base64 (~1.1 MB cifrado y comprimido; una foto típica pesa ~60 KB)
const MAX_META = 2_000;
const MAX_MSG = 64_000;
const MAX_MSGS_PER_SPACE = 500;
const RATE_PER_HOUR = 1_200; // ~1 cada 3 s sostenido: de sobra para varios dispositivos sincronizando
const MSG_TTL = 14 * 864e5;
const SPACE_TTL = 180 * 864e5; // espacios abandonados (sin uso en 6 meses) se borran
const ID = /^[A-Za-z0-9_-]{22,64}$/;
const DEV = /^[A-Za-z0-9_-]{6,64}$/;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS } });
const fail = (status, error) => json({ ok: false, error }, status);

async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function bearer(req) {
  const m = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(req.headers.get('authorization') || '');
  return m ? m[1] : null;
}
async function body(req, max) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > max + 4096) throw Object.assign(new Error('demasiado grande'), { status: 413 });
  const text = await req.text();
  if (text.length > max + 4096) throw Object.assign(new Error('demasiado grande'), { status: 413 });
  try { return JSON.parse(text || '{}'); } catch { throw Object.assign(new Error('JSON inválido'), { status: 400 }); }
}

/** Comprueba la llave de acceso del espacio y suma un pedido al límite por hora. */
async function authorize(env, space, token, { create = false } = {}) {
  if (!ID.test(space)) return { error: [400, 'espacio inválido'] };
  if (!token) return { error: [401, 'falta la llave'] };
  const hash = await sha256(token);
  const now = Date.now();
  const row = await env.DB.prepare('SELECT auth_hash FROM spaces WHERE id = ?').bind(space).first();
  if (!row) {
    if (!create) return { error: [404, 'el espacio no existe'] };
    await env.DB.prepare('INSERT INTO spaces (id, auth_hash, created_at, last_seen) VALUES (?, ?, ?, ?)').bind(space, hash, now, now).run();
  } else if (row.auth_hash !== hash) {
    return { error: [403, 'llave incorrecta'] };
  }
  const bucket = Math.floor(now / 3600e3);
  const r = await env.DB.prepare('INSERT INTO rate (space, bucket, n) VALUES (?, ?, 1) ON CONFLICT (space, bucket) DO UPDATE SET n = n + 1 RETURNING n').bind(space, bucket).first();
  if (r && r.n > RATE_PER_HOUR) return { error: [429, 'demasiados pedidos; espera unos minutos'] };
  if (row) await env.DB.prepare('UPDATE spaces SET last_seen = ? WHERE id = ? AND last_seen < ?').bind(now, space, now - 3600e3).run();
  return { ok: true, now, created: !row };
}

async function handle(req, env, ctx) {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean); // v1 s :space d :device
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (parts[0] !== 'v1') return fail(404, 'no existe');
  if (parts[1] === 'health') return json({ ok: true, app: 'pm-sync', version: VERSION, now: Date.now() });
  if (parts[1] !== 's' || !parts[2]) return fail(404, 'no existe');

  const space = parts[2];
  const token = bearer(req);
  const sub = parts[3] || '';

  // Crear (o comprobar) el espacio.
  if (!sub && req.method === 'PUT') {
    const a = await authorize(env, space, token, { create: true });
    if (a.error) return fail(...a.error);
    return json({ ok: true, created: a.created, now: a.now });
  }
  const a = await authorize(env, space, token);
  if (a.error) return fail(...a.error);
  const now = a.now;

  // Subir la foto de un dispositivo.
  if (sub === 'd' && parts[4] && req.method === 'PUT') {
    const device = parts[4];
    if (!DEV.test(device)) return fail(400, 'dispositivo inválido');
    const b = await body(req, MAX_BLOB + MAX_META);
    if (typeof b.data !== 'string' || !b.data || b.data.length > MAX_BLOB) return fail(413, 'foto demasiado grande');
    if (typeof (b.meta ?? '') !== 'string' || (b.meta || '').length > MAX_META) return fail(400, 'meta inválida');
    await env.DB.prepare(`INSERT INTO blobs (space, device, meta, rev, updated_at, data) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (space, device) DO UPDATE SET meta = excluded.meta, rev = excluded.rev, updated_at = excluded.updated_at, data = excluded.data`)
      .bind(space, device, b.meta || '', Number(b.rev) || 0, now, b.data).run();
    return json({ ok: true, at: now });
  }

  // Desvincular un dispositivo.
  if (sub === 'd' && parts[4] && req.method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM push_tokens WHERE space = ? AND device = ?').bind(space, parts[4]),
      env.DB.prepare('DELETE FROM blobs WHERE space = ? AND device = ?').bind(space, parts[4]),
      env.DB.prepare('DELETE FROM messages WHERE space = ? AND target = ?').bind(space, parts[4]),
    ]);
    return json({ ok: true });
  }

  // Traer lo nuevo: fotos de los demás cambiadas desde `since` + mensajes después de `after`.
  if (sub === 'pull' && req.method === 'GET') {
    const device = url.searchParams.get('device') || '';
    if (!DEV.test(device)) return fail(400, 'dispositivo inválido');
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
    const [list, changed, msgs] = await env.DB.batch([
      env.DB.prepare('SELECT device, meta, rev, updated_at FROM blobs WHERE space = ?').bind(space),
      env.DB.prepare('SELECT device, data, updated_at FROM blobs WHERE space = ? AND device != ? AND updated_at > ?').bind(space, device, since),
      env.DB.prepare("SELECT id, sender, target, created_at, data FROM messages WHERE space = ? AND id > ? AND sender != ? AND (target = ? OR target = '*') ORDER BY id LIMIT 100").bind(space, after, device, device),
    ]);
    return json({
      ok: true,
      now,
      devices: list.results.map((r) => ({ device: r.device, meta: r.meta, rev: r.rev, at: r.updated_at })),
      blobs: changed.results.map((r) => ({ device: r.device, data: r.data, at: r.updated_at })),
      messages: msgs.results.map((r) => ({ id: r.id, from: r.sender, to: r.target, at: r.created_at, data: r.data })),
    });
  }

  // Mandar un mensaje.
  if (sub === 'msg' && req.method === 'POST') {
    const b = await body(req, MAX_MSG);
    if (!DEV.test(b.from || '') || !(b.to === '*' || DEV.test(b.to || ''))) return fail(400, 'remitente o destino inválido');
    if (typeof b.data !== 'string' || !b.data || b.data.length > MAX_MSG) return fail(413, 'mensaje demasiado grande');
    const r = await env.DB.prepare('INSERT INTO messages (space, sender, target, created_at, data) VALUES (?, ?, ?, ?, ?) RETURNING id').bind(space, b.from, b.to, now, b.data).first();
    // Los teléfonos con push revisan ya (no esperan a su próxima revisión).
    if (ctx && ctx.waitUntil) ctx.waitUntil(wake(env, space, b.from, b.to));
    // Buzón acotado: si se llena, se van los más viejos.
    await env.DB.prepare('DELETE FROM messages WHERE space = ? AND id <= ?').bind(space, r.id - MAX_MSGS_PER_SPACE).run();
    return json({ ok: true, id: r.id, at: now });
  }

  // Token de push del teléfono (o borrarlo con token vacío).
  if (sub === 'push' && req.method === 'PUT') {
    const b = await body(req, 4096);
    if (!DEV.test(b.device || '')) return fail(400, 'dispositivo inválido');
    if (!b.token) {
      await env.DB.prepare('DELETE FROM push_tokens WHERE space = ? AND device = ?').bind(space, b.device).run();
      return json({ ok: true, removed: true });
    }
    if (typeof b.token !== 'string' || b.token.length > 400) return fail(400, 'token inválido');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM push_tokens WHERE token = ? AND NOT (space = ? AND device = ?)').bind(b.token, space, b.device), // un token es de un solo dispositivo
      env.DB.prepare('INSERT INTO push_tokens (space, device, token, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (space, device) DO UPDATE SET token = excluded.token, updated_at = excluded.updated_at').bind(space, b.device, b.token, now),
    ]);
    return json({ ok: true, push: !!env.FCM_SERVICE_ACCOUNT });
  }

  // Borrar todo el espacio.
  if (!sub && req.method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM push_tokens WHERE space = ?').bind(space),
      env.DB.prepare('DELETE FROM blobs WHERE space = ?').bind(space),
      env.DB.prepare('DELETE FROM messages WHERE space = ?').bind(space),
      env.DB.prepare('DELETE FROM rate WHERE space = ?').bind(space),
      env.DB.prepare('DELETE FROM spaces WHERE id = ?').bind(space),
    ]);
    return json({ ok: true });
  }

  return fail(404, 'no existe');
}

export default {
  async fetch(req, env, ctx) {
    try {
      return await handle(req, env, ctx);
    } catch (e) {
      return fail(e.status || 500, e.status ? e.message : 'error interno');
    }
  },
  // Limpieza diaria: mensajes viejos, contadores de límite y espacios abandonados.
  async scheduled(_ev, env) {
    const now = Date.now();
    const old = await env.DB.prepare('SELECT id FROM spaces WHERE last_seen < ? LIMIT 200').bind(now - SPACE_TTL).all();
    const stmts = [
      env.DB.prepare('DELETE FROM messages WHERE created_at < ?').bind(now - MSG_TTL),
      env.DB.prepare('DELETE FROM rate WHERE bucket < ?').bind(Math.floor(now / 3600e3) - 2),
    ];
    for (const { id } of old.results) {
      stmts.push(env.DB.prepare('DELETE FROM push_tokens WHERE space = ?').bind(id), env.DB.prepare('DELETE FROM blobs WHERE space = ?').bind(id), env.DB.prepare('DELETE FROM messages WHERE space = ?').bind(id), env.DB.prepare('DELETE FROM spaces WHERE id = ?').bind(id));
    }
    await env.DB.batch(stmts);
  },
};

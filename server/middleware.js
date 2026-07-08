import { verifyToken } from './auth.js';
import { db } from './db.js';

// Minimal cookie parser (avoids a cookie-parser dependency).
export function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

// Require a logged-in admin (JWT cookie).
export function requireAdmin(req, res, next) {
  const cookies = parseCookies(req);
  const payload = verifyToken(cookies.aperture_session);
  if (!payload || payload.kind !== 'admin') {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.user = payload;
  next();
}

// Require a valid kiosk device token (Authorization: Bearer <token>).
// The token is a signed token whose device_id matches a row in `devices`.
export function requireKiosk(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload || payload.kind !== 'kiosk') {
    return res.status(401).json({ error: 'Invalid kiosk token' });
  }
  const device = db.prepare('SELECT id FROM devices WHERE id = ?').get(payload.device_id);
  if (!device) return res.status(401).json({ error: 'Unknown device' });
  db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?')
    .run(new Date().toISOString(), payload.device_id);
  req.device = payload;
  next();
}

// Accept EITHER an admin session OR a kiosk token (used by read-only descriptor fetch).
export function requireAdminOrKiosk(req, res, next) {
  const cookies = parseCookies(req);
  const adminPayload = verifyToken(cookies.aperture_session);
  if (adminPayload && adminPayload.kind === 'admin') {
    req.user = adminPayload;
    return next();
  }
  return requireKiosk(req, res, next);
}

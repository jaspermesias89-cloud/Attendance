import { Router } from 'express';
import { db } from '../db.js';
import { verifyPassword, signToken, verifyToken } from '../auth.js';
import { parseCookies, ah } from '../middleware.js';

const router = Router();

const COOKIE = 'aperture_session';
// Admin sessions are non-expiring: the token carries no exp, and the cookie is
// persisted ~10 years (browsers have no true "never"). Sign out to end a session.
const COOKIE_MAXAGE = 60 * 60 * 24 * 365 * 10 * 1000; // ~10 years in ms

router.post('/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = await db.get('SELECT * FROM users WHERE email = ?', String(email).toLowerCase());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = signToken({ kind: 'admin', uid: user.id, email: user.email, role: user.role }, null);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: COOKIE_MAXAGE,
    path: '/',
  });
  res.json({ ok: true, user: { email: user.email, role: user.role } });
}));

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

// Who am I — used by the frontend to decide admin vs login screen.
router.get('/me', (req, res) => {
  const payload = verifyToken(parseCookies(req).aperture_session);
  if (!payload || payload.kind !== 'admin') return res.status(401).json({ error: 'no' });
  res.json({ email: payload.email, role: payload.role });
});

export default router;

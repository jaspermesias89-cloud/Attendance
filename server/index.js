import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, initDb } from './db.js';
import { hashPassword, initSecret } from './auth.js';

import authRoutes from './routes/auth.js';
import employeeRoutes from './routes/employees.js';
import attendanceRoutes from './routes/attendance.js';
import settingsRoutes from './routes/settings.js';
import deviceRoutes from './routes/devices.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// First-boot admin bootstrap for hosts without shell access (cloud deploys).
// Creates the admin from env vars only when no users exist yet.
async function bootstrapAdmin() {
  if (!(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD)) return;
  const row = await db.get('SELECT COUNT(*) AS c FROM users');
  if (row.c === 0) {
    await db.run('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
      process.env.ADMIN_EMAIL.toLowerCase(), hashPassword(process.env.ADMIN_PASSWORD), 'admin');
    console.log(`Bootstrapped admin user ${process.env.ADMIN_EMAIL}`);
  }
}

const app = express();
app.set('trust proxy', 1); // behind the platform's TLS-terminating proxy
app.use(express.json({ limit: '5mb' })); // descriptors + optional thumbnails

// Tiny cookie helper so we don't need cookie-parser for res.cookie.
app.use((req, res, next) => {
  res.cookie = (name, value, opts = {}) => {
    const parts = [`${name}=${encodeURIComponent(value)}`];
    if (opts.maxAge != null) parts.push(`Max-Age=${Math.floor(opts.maxAge / 1000)}`);
    parts.push(`Path=${opts.path || '/'}`);
    if (opts.httpOnly) parts.push('HttpOnly');
    if (opts.secure) parts.push('Secure');
    if (opts.sameSite) parts.push(`SameSite=${opts.sameSite[0].toUpperCase() + opts.sameSite.slice(1)}`);
    res.append('Set-Cookie', parts.join('; '));
    return res;
  };
  res.clearCookie = (name, opts = {}) => {
    res.append('Set-Cookie', `${name}=; Max-Age=0; Path=${opts.path || '/'}`);
    return res;
  };
  next();
});

// API
app.use('/api/auth', authRoutes);
app.use('/api', employeeRoutes);
app.use('/api', attendanceRoutes);
app.use('/api', settingsRoutes);
app.use('/api', deviceRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Static frontend + self-hosted face models
app.use(express.static(join(__dirname, '..', 'public')));

// JSON error handler (catches rejections forwarded by the ah() wrapper).
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// Initialise the DB (await schema) before accepting requests.
initDb()
  .then(initSecret) // load/persist the token-signing secret before serving
  .then(bootstrapAdmin)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Aperture attendance running on http://localhost:${PORT}`);
    });
  })
  .catch((e) => {
    console.error('Failed to start:', e);
    process.exit(1);
  });

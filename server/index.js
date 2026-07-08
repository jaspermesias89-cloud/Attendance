import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from './db.js'; // initialise DB + schema on boot
import { hashPassword } from './auth.js';

import authRoutes from './routes/auth.js';
import employeeRoutes from './routes/employees.js';
import attendanceRoutes from './routes/attendance.js';
import settingsRoutes from './routes/settings.js';
import deviceRoutes from './routes/devices.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// First-boot admin bootstrap for hosts without shell access (cloud deploys).
// Creates the admin from env vars only when no users exist yet.
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (c === 0) {
    db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)')
      .run(process.env.ADMIN_EMAIL.toLowerCase(), hashPassword(process.env.ADMIN_PASSWORD), 'admin');
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

app.listen(PORT, () => {
  console.log(`Aperture attendance running on http://localhost:${PORT}`);
});

// Seed an initial admin user and default settings.
// Usage:
//   node server/seed.js                       (uses defaults / env)
//   ADMIN_EMAIL=you@co ADMIN_PASSWORD=secret node server/seed.js
import { db } from './db.js';
import { hashPassword } from './auth.js';

const email = (process.env.ADMIN_EMAIL || 'admin@company.local').toLowerCase();
const password = process.env.ADMIN_PASSWORD || 'changeme123';

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(hashPassword(password), email);
  console.log(`Updated admin password for ${email}`);
} else {
  db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)')
    .run(email, hashPassword(password), 'admin');
  console.log(`Created admin user ${email}`);
}

console.log('\nLogin with:');
console.log(`  email:    ${email}`);
console.log(`  password: ${password}`);
if (password === 'changeme123') {
  console.log('\n⚠  Using the default password. Set ADMIN_PASSWORD and re-run seed for production.');
}

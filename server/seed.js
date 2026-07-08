// Seed an initial admin user and default settings.
// Usage:
//   node server/seed.js                       (uses defaults / env)
//   ADMIN_EMAIL=you@co ADMIN_PASSWORD=secret node server/seed.js
import { db, initDb } from './db.js';
import { hashPassword } from './auth.js';

const email = (process.env.ADMIN_EMAIL || 'admin@company.local').toLowerCase();
const password = process.env.ADMIN_PASSWORD || 'changeme123';

await initDb();

const existing = await db.get('SELECT id FROM users WHERE email = ?', email);
if (existing) {
  await db.run('UPDATE users SET password_hash = ? WHERE email = ?', hashPassword(password), email);
  console.log(`Updated admin password for ${email}`);
} else {
  await db.run('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
    email, hashPassword(password), 'admin');
  console.log(`Created admin user ${email}`);
}

console.log('\nLogin with:');
console.log(`  email:    ${email}`);
console.log(`  password: ${password}`);
if (password === 'changeme123') {
  console.log('\n⚠  Using the default password. Set ADMIN_PASSWORD and re-run seed for production.');
}
process.exit(0);

// Produce a clean, single-file SQLite database ready to upload to Turso
// (dashboard: "Seed from a database file", or `turso db create <name> --from-file turso-seed.db`).
// Contains the full schema, the settings row, and one admin user.
//
// Usage:
//   node server/make-seed-file.js
//   $env:ADMIN_EMAIL="you@company.com"; $env:ADMIN_PASSWORD="a-strong-password"; node server/make-seed-file.js
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hashPassword } from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'turso-seed.db');

// Start from a blank file (remove any previous output + stray sidecars).
for (const f of [OUT, OUT + '-wal', OUT + '-shm', OUT + '-journal']) {
  if (existsSync(f)) rmSync(f);
}

const db = new DatabaseSync(OUT);
// DELETE journal mode → a single self-contained file, which Turso imports cleanly.
db.exec('PRAGMA journal_mode = DELETE;');

const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);
db.exec('INSERT OR IGNORE INTO settings (id) VALUES (1);');

const email = (process.env.ADMIN_EMAIL || 'admin@company.local').toLowerCase();
const password = process.env.ADMIN_PASSWORD || 'changeme123';
if (!db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
  db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)')
    .run(email, hashPassword(password), 'admin');
}

db.exec('VACUUM;'); // compact into a clean single file
db.close();

const kb = (statSync(OUT).size / 1024).toFixed(1);
console.log(`Created ${OUT} (${kb} KB)`);
console.log('Contains: schema + settings + admin user');
console.log(`Admin login: ${email} / ${password}`);
if (password === 'changeme123') {
  console.log('\n⚠  Default password. Re-run with ADMIN_EMAIL/ADMIN_PASSWORD set to bake in your own.');
}

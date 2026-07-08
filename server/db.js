import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// DB file lives next to the server code by default; override with APERTURE_DB.
export const DB_PATH = process.env.APERTURE_DB || join(__dirname, '..', 'data', 'aperture.db');

// Ensure the data directory exists.
import { mkdirSync } from 'node:fs';
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// Apply schema (idempotent — all statements use IF NOT EXISTS).
const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Ensure the single settings row exists.
db.exec(`INSERT OR IGNORE INTO settings (id) VALUES (1);`);

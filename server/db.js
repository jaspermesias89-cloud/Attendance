import { createClient } from '@libsql/client';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Two backends, one client:
//  - production: set TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) → hosted libSQL
//  - local dev:  no env → a local SQLite file (APERTURE_DB or data/aperture.db)
let url, authToken;
if (process.env.TURSO_DATABASE_URL) {
  url = process.env.TURSO_DATABASE_URL;
  authToken = process.env.TURSO_AUTH_TOKEN;
} else {
  const dbPath = process.env.APERTURE_DB || join(__dirname, '..', 'data', 'aperture.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  url = pathToFileURL(dbPath).href.replace('file://', 'file:');
}

const client = createClient({ url, authToken, intMode: 'number' });

// Accept either db.get(sql, a, b) or db.get(sql, [a, b]).
function normArgs(args) {
  return args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
}

// Small async adapter with a better-sqlite3-like surface.
export const db = {
  client,
  async get(sql, ...args) {
    const r = await client.execute({ sql, args: normArgs(args) });
    return r.rows[0];
  },
  async all(sql, ...args) {
    const r = await client.execute({ sql, args: normArgs(args) });
    return r.rows;
  },
  async run(sql, ...args) {
    const r = await client.execute({ sql, args: normArgs(args) });
    return {
      changes: Number(r.rowsAffected || 0),
      lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : undefined,
    };
  },
  async exec(sql) {
    await client.executeMultiple(sql);
  },
  transaction(mode = 'write') {
    return client.transaction(mode);
  },
};

// Apply schema (idempotent) + ensure the single settings row. Await before serving.
export async function initDb() {
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await client.executeMultiple(schema);
  await client.execute('INSERT OR IGNORE INTO settings (id) VALUES (1)');
}

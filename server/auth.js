import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { db } from './db.js';

// ---- Secret ----
// Signs cookies + kiosk tokens. Preference order:
//   1. APERTURE_SECRET env var (recommended — inject via your host's secrets).
//   2. A random secret persisted in the database's app_meta table.
// The DB fallback is what keeps tokens valid across restarts on disk-less hosts
// (e.g. Render's free tier, where the container filesystem is ephemeral but the
// Turso database is durable). Must be initialised via initSecret() before any
// token is signed or verified — index.js does this after initDb().
let SECRET = null;

export async function initSecret() {
  if (process.env.APERTURE_SECRET) {
    SECRET = process.env.APERTURE_SECRET;
    return;
  }
  const existing = await db.get("SELECT value FROM app_meta WHERE key = 'token_secret'");
  if (existing?.value) {
    SECRET = existing.value;
  } else {
    // INSERT OR IGNORE + re-read so concurrent instances converge on one value.
    await db.run(
      "INSERT OR IGNORE INTO app_meta (key, value) VALUES ('token_secret', ?)",
      randomBytes(32).toString('hex')
    );
    const row = await db.get("SELECT value FROM app_meta WHERE key = 'token_secret'");
    SECRET = row.value;
  }
  console.warn(
    '[auth] APERTURE_SECRET is not set — using a generated secret stored in the ' +
    'database (tokens will persist across restarts). Set APERTURE_SECRET in your ' +
    'environment for stronger secret management.'
  );
}

function requireSecret() {
  if (!SECRET) throw new Error('Token secret not initialised — call initSecret() during boot.');
  return SECRET;
}

// ---- Password hashing (scrypt) ----
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return test.length === known.length && timingSafeEqual(test, known);
}

// ---- Compact signed token (JWT-like: base64url(payload).hmac) ----
function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

export function signToken(payload, ttlSeconds = 60 * 60 * 12) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const data = b64url(JSON.stringify(body));
  const sig = createHmac('sha256', requireSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = createHmac('sha256', requireSecret()).update(data).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

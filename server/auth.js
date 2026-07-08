import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

// ---- Secret ----
// In production set APERTURE_SECRET. If unset we persist a random one to disk so
// tokens survive restarts on a single-server deployment.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSecret() {
  if (process.env.APERTURE_SECRET) return process.env.APERTURE_SECRET;
  const dataDir = join(__dirname, '..', 'data');
  mkdirSync(dataDir, { recursive: true });
  const p = join(dataDir, '.secret');
  if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  const s = randomBytes(32).toString('hex');
  writeFileSync(p, s, { mode: 0o600 });
  return s;
}
const SECRET = loadSecret();

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
  const sig = createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = createHmac('sha256', SECRET).update(data).digest('base64url');
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

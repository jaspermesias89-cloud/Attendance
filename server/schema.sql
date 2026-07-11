-- Aperture attendance schema (libSQL / SQLite — local file or Turso)
-- No PRAGMAs here: journal mode is managed by the backend, and FK cascades are
-- handled explicitly in code (see routes) so behaviour is identical on Turso.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_code    TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  department  TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  photo       TEXT,                       -- optional base64 thumbnail for UI avatar
  enrolled_at TEXT NOT NULL DEFAULT (date('now'))
);

CREATE TABLE IF NOT EXISTS face_descriptors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  vector      TEXT NOT NULL,              -- JSON array of 128 floats
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_descriptors_employee ON face_descriptors(employee_id);

CREATE TABLE IF NOT EXISTS attendance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  ts          TEXT NOT NULL,             -- ISO timestamp, server-stamped
  local_date  TEXT NOT NULL,            -- YYYY-MM-DD in the server's local tz
  local_time  TEXT NOT NULL,            -- HH:MM
  kind        TEXT NOT NULL DEFAULT 'in',   -- 'in' | 'out'
  status      TEXT NOT NULL DEFAULT 'present', -- 'present' | 'late'
  confidence  INTEGER NOT NULL DEFAULT 0,
  device_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(local_date);
CREATE INDEX IF NOT EXISTS idx_attendance_emp  ON attendance(employee_id);

CREATE TABLE IF NOT EXISTS devices (
  id        TEXT PRIMARY KEY,            -- device id string used by kiosks
  name      TEXT NOT NULL DEFAULT '',
  token     TEXT NOT NULL,
  last_seen TEXT
);

-- Internal key/value store (e.g. the token-signing secret) so values persist
-- across restarts even on disk-less hosts where the DB is the only durable store.
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  threshold   REAL NOT NULL DEFAULT 0.5,
  late_cutoff TEXT NOT NULL DEFAULT '09:30',
  work_start  TEXT NOT NULL DEFAULT '09:00',
  work_end    TEXT NOT NULL DEFAULT '17:00',
  timezone    TEXT NOT NULL DEFAULT 'UTC', -- IANA name, e.g. Asia/Manila
  daily_rate  REAL NOT NULL DEFAULT 450,   -- default pay for a standard day
  standard_hours REAL NOT NULL DEFAULT 8   -- hours that make up a standard day
);

-- Per-department pay overrides. A department without a row here falls back to the
-- default daily_rate / standard_hours in settings.
CREATE TABLE IF NOT EXISTS department_rates (
  department     TEXT PRIMARY KEY,
  daily_rate     REAL NOT NULL,
  standard_hours REAL NOT NULL DEFAULT 8
);

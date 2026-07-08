# Aperture — Facial-Recognition Attendance

A self-hosted attendance system for a small company. Employees check in by looking at a webcam
on a **kiosk**; managers enroll staff and view records in an **admin** console. Face recognition
runs entirely in the browser (`face-api.js`) — raw video never leaves the device; only a numeric
face signature and check-in events are sent to the server.

## Stack
- **Backend:** Node.js + Express, **libSQL/SQLite** via `@libsql/client`. Locally it uses a plain
  SQLite file (`data/aperture.db`); in production it can point at **Turso** (hosted SQLite) so the
  app runs on a free, disk-less host — same code, just env vars. See [DEPLOY.md](DEPLOY.md).
- **Auth:** signed httpOnly cookie for admins; long-lived signed bearer token per kiosk.
- **Frontend:** static HTML/CSS + ES modules, `face-api.js` (self-hosted under `public/vendor` and
  `public/models`).

## Requirements
- Node.js **20+** (developed on Node 24). No native build tools needed — `@libsql/client` ships
  prebuilt binaries.

## Setup

```powershell
npm install
# Create the admin login (set your own password!)
$env:ADMIN_EMAIL="you@company.com"; $env:ADMIN_PASSWORD="a-strong-password"; npm run seed
npm start
```

Then open **http://localhost:3000** and sign in.

> If you run `npm run seed` with no env vars it creates `admin@company.local` / `changeme123` —
> fine for a first look, but change it before real use.

## Using it
1. **Admin → Register**: enable the camera, capture 3 face samples, fill in name / employee ID /
   department, tick the consent box, **Save Employee**.
2. **Admin → Kiosks**: create a kiosk, then open the generated link on the check-in device (a
   tablet/PC with a webcam). The link carries the device token; it's stored locally so the kiosk
   stays linked.
3. **Kiosk**: press **Start Scan**. Recognized employees are checked in automatically. Switch the
   dropdown to **Clocking OUT** for end-of-day.
4. **Admin → Records**: filter by name/date/status and **Export CSV**.
5. **Admin → Settings**: recognition threshold, late cutoff time, and clear-all-data.

## HTTPS is required off-localhost
Browsers only allow camera access (`getUserMedia`) on `localhost` or over **HTTPS**. To run a kiosk
on another device on your network, put the app behind TLS — e.g. a reverse proxy (Caddy/nginx) with
a certificate, or a tunnel. `localhost` on the same machine works without TLS for testing.

## Configuration (env vars)
| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `3000` | HTTP port |
| `TURSO_DATABASE_URL` | — | if set, use hosted Turso instead of a local file |
| `TURSO_AUTH_TOKEN` | — | Turso auth token (with `TURSO_DATABASE_URL`) |
| `APERTURE_DB` | `data/aperture.db` | local SQLite path (when Turso vars are absent) |
| `APERTURE_SECRET` | random, persisted to `data/.secret` | signs cookies + kiosk tokens |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | seeds/creates the admin on first boot |

## Backups
For a local file, stop the server and copy `data/aperture.db`. For Turso, use
`turso db shell <db> ".dump" > backup.sql` or the Turso dashboard. Because WAL mode may be on for
the local file, also copy `-wal`/`-shm` if the server is
running. **Treat this file as sensitive** — it contains biometric face signatures. Restrict file
permissions and encrypt off-site backups. Restore by copying the file back and restarting.

## Privacy notes
- Only 128-number face **descriptors** are stored, plus an optional small avatar thumbnail — no
  video or full-resolution photos.
- Registration requires an explicit **consent** checkbox. Get employee consent before enrolling.
- Deleting an employee cascades to their descriptors and attendance rows.

## Project layout
```
server/            Express API
  index.js         app entry (serves API + static frontend)
  db.js            SQLite connection + schema apply
  schema.sql       tables
  auth.js          scrypt password hashing + signed tokens
  middleware.js    admin / kiosk auth guards
  routes/          auth, employees, attendance, settings, devices
  seed.js          create the admin user
public/            frontend
  index.html       admin console        js/admin.js
  kiosk.html       check-in kiosk       js/kiosk.js
  js/api.js, js/face.js   shared helpers
  css/app.css      styles
  vendor/, models/ self-hosted face-api.js + weights
data/              SQLite db + secret (gitignored)
```

> The original single-file prototype (browser-only storage) lived at the repo root; it has been
> removed to avoid confusion. It remains available in git history if you need it. The live app is
> served from `public/`.

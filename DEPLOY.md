# Deploying Aperture

The app talks to a **libSQL/SQLite** database. You have two storage choices:

- **Turso** (hosted SQLite) — lets you run the app on a **free**, disk-less host like Render's
  free tier. **Recommended for $0 hosting.**
- **A local file on a persistent disk** — simplest if your host gives you a volume (Fly.io, a VPS).

All hosts below provide **HTTPS automatically**, which the webcam requires.

Environment variables the app understands:

| Var | Purpose |
|-----|---------|
| `TURSO_DATABASE_URL` | `libsql://<db>.turso.io` — if set, the app uses Turso |
| `TURSO_AUTH_TOKEN` | Turso token (with `TURSO_DATABASE_URL`) |
| `APERTURE_DB` | local SQLite file path (used only when Turso vars are absent) |
| `APERTURE_SECRET` | signs cookies + kiosk tokens; keep stable |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | creates the admin on first boot (when no users exist) |

> The admin is created on **first boot** only. Afterwards, changing `ADMIN_PASSWORD` won't reset it.

---

## Option A — Render (free) + Turso  ⭐ recommended for $0

### 1. Create the Turso database
Install the Turso CLI (https://docs.turso.tech/cli/installation), then:
```bash
turso auth signup                     # free account
turso db create aperture              # create the database
turso db show aperture --url          # -> libsql://aperture-<you>.turso.io   (TURSO_DATABASE_URL)
turso db tokens create aperture       # -> a long token                        (TURSO_AUTH_TOKEN)
```
> No CLI? You can also create the DB and copy the URL + token from the Turso web dashboard.

### 2. Deploy on Render
1. Go to https://dashboard.render.com → **New + → Blueprint** → select your
   `jaspermesias89-cloud/Attendance` repo. It reads `render.yaml` and creates a **free** Docker
   web service (no disk).
2. When prompted, fill in the `sync: false` variables:
   - `TURSO_DATABASE_URL` = the `libsql://…` URL from step 1
   - `TURSO_AUTH_TOKEN` = the token from step 1
   - `ADMIN_EMAIL` = your admin email
   - `ADMIN_PASSWORD` = a strong password
   (`APERTURE_SECRET` is generated automatically.)
3. **Apply**. First build takes ~3–5 min. In **Logs** look for `Bootstrapped admin user …` and
   `Aperture attendance running …`.
4. Open the `…onrender.com` URL and sign in.

**Free-tier note:** the service sleeps after ~15 min idle and takes ~30–60 s to wake on the next
request (the first scan each morning is slow, then instant). Your data is safe in Turso regardless.

---

## Option B — Fly.io (local SQLite on a volume)

Uses `fly.toml` (a persistent volume, no Turso needed). Fly's small machines are cheap but not
strictly free.
```bash
fly auth login
fly launch --no-deploy --copy-config --name your-unique-name
fly volumes create aperture_data --size 1 --region <region>
fly secrets set APERTURE_SECRET=$(openssl rand -hex 32) \
                ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='a-strong-password'
fly deploy
```
`fly.toml` already sets `APERTURE_DB=/data/aperture.db` on the mounted volume.

---

## Option C — Railway (Turso or a volume)

1. Railway → **New Project → Deploy from GitHub repo** → this repo (builds from the `Dockerfile`).
2. Either add a **Volume** mounted at `/data` and set `APERTURE_DB=/data/aperture.db`, **or**
   (simpler) set `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` and skip the volume.
3. Also set `APERTURE_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. Deploy and open the URL.

---

## After deploying
1. Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
2. **Register** employees (camera + 3 samples + consent).
3. **Kiosks → Create Kiosk** and open the generated link on each check-in device.

## Backups
- **Turso:** `turso db shell aperture ".dump" > backup.sql`, or use Turso's dashboard backups.
- **Local file:** copy `aperture.db` off the volume.
The data contains biometric face signatures — treat backups as sensitive and encrypt them.

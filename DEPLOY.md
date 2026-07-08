# Deploying Aperture to the cloud

This app needs a host that runs **Node.js** and gives it a **persistent volume** for the
SQLite database. GitHub Pages cannot run it (static files only). All options below provide
**HTTPS automatically**, which the webcam requires.

Set these environment variables on any platform:

| Var | Value | Notes |
|-----|-------|-------|
| `APERTURE_DB` | `/data/aperture.db` | must live on the mounted volume |
| `APERTURE_SECRET` | a long random string | signs cookies + kiosk tokens; keep stable |
| `ADMIN_EMAIL` | your admin email | used once, on first boot, to create the admin |
| `ADMIN_PASSWORD` | a strong password | used once, on first boot |

> The admin is auto-created on **first boot** only (when no users exist). After that you can
> change `ADMIN_PASSWORD` freely — it won't reset the account. Keep the volume and the account
> persists.

---

## Option A — Fly.io (recommended for SQLite)

Fly has first-class persistent volumes and free-tier-friendly small machines.

```bash
# 1. Install flyctl and sign in
#    https://fly.io/docs/flyctl/install/
fly auth login

# 2. Claim an app name (edit fly.toml's `app` + `primary_region` first, or let launch set them).
#    --no-deploy so we can create the volume and secrets before the first deploy.
fly launch --no-deploy --copy-config --name your-unique-name

# 3. Create the persistent volume (must match [[mounts]].source in fly.toml)
fly volumes create aperture_data --size 1 --region <your-region>

# 4. Set secrets (these become env vars, encrypted)
fly secrets set APERTURE_SECRET=$(openssl rand -hex 32) \
                ADMIN_EMAIL=you@company.com \
                ADMIN_PASSWORD='a-strong-password'

# 5. Deploy
fly deploy
```

Open `https://your-unique-name.fly.dev` and sign in. Details in `fly.toml`.

---

## Option B — Railway

1. Push this repo to GitHub (done).
2. Railway → **New Project → Deploy from GitHub repo** → pick this repo. It builds from the
   `Dockerfile` automatically.
3. Add a **Volume** and mount it at `/data`.
4. In **Variables**, set `APERTURE_DB=/data/aperture.db`, `APERTURE_SECRET`, `ADMIN_EMAIL`,
   `ADMIN_PASSWORD`.
5. Deploy; open the generated URL.

## Option C — Render

1. Render → **New → Blueprint** → point at this repo (uses `render.yaml`).
2. It provisions a Docker web service + a 1 GB disk at `/data`.
3. Fill in `ADMIN_EMAIL` and `ADMIN_PASSWORD` when prompted (they're `sync: false`).
4. Deploy; open the `onrender.com` URL.
   > A persistent disk requires a **paid** instance — free web services lose the database on redeploy.

---

## After deploying
1. Sign in at the app URL with your `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
2. **Register** employees (camera + 3 samples + consent).
3. **Kiosks → Create Kiosk**, open the generated link on the check-in device.
4. Because the site is HTTPS, the camera works on any device — no extra TLS setup needed.

## Backups
The whole database is the single file on the volume (`/data/aperture.db`). Back it up on a
schedule (e.g. `fly ssh console` + copy off, or the platform's volume snapshots). It contains
biometric face signatures — treat it as sensitive and encrypt off-site copies.

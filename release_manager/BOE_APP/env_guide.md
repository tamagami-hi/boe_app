# BOE_APP — engineering guide

Everything that runs in the deployed stack and every setting that drives it.
`BOE_APP/` is the **live deployment directory**: `docker compose` runs here, images
are loaded here, and `.env` here is the single switchboard for the whole stack.

---

## 1. What runs (the stack)

Five compose units, started in dependency order by `deploy.sh`:

| Unit | Type | Image | Role |
|------|------|-------|------|
| `postgres` | long-running | `postgres:16-alpine` | the database; data in the `pgdata` volume |
| `migrate` | one-shot | `boe-backend` | applies SQL migrations via `psql`, then exits |
| `seed` | one-shot | `boe-backend` | seeds the admin + client auth rows, then exits |
| `backend` | long-running | `boe-backend` | the Node API (`backend_controller`) on `:47502` |
| `landing` | long-running | `boe-landing` | the Next.js public site on `:3100` |

Order: `postgres` (healthy) → `migrate` (success) → `seed` → `backend` → `landing`.

**Not here:** the admin portal and client APK. They run elsewhere (local `npm run dev`
/ the app build) and talk to this `backend` over the public domain.

---

## 2. How requests flow

```
Browser / APK
     │  https://<domain>            https://<domain>/v1/...
     ▼                                   │
 host nginx (TLS, not a container) ──────┤
     │  /  → 127.0.0.1:3100              │  /v1/ → 127.0.0.1:47502
     ▼                                   ▼
  landing (Next.js)  ── server-side ──► backend (Node API) ──► postgres
     │  BEO_API_BASE=http://backend:47502 (internal Docker network)
```

- The browser only ever sees the **landing** origin. The landing's own server-side
  routes (`/api/auth/*`, `/api/onboarding/*`) proxy to the backend over the internal
  Docker network (`http://backend:47502`) — the backend host is never exposed to the browser.
- Admin/client hit the backend **directly** at `https://<domain>/v1/...` (allowed by `CORS_ORIGIN`).
- Both containers bind to `127.0.0.1` only; the host nginx is the sole public door.

---

## 3. Ports

| Port | Bound | Who | Notes |
|------|-------|-----|-------|
| `3100` | `127.0.0.1` | landing | `LANDING_PORT`; nginx proxies `/` here |
| `47502` | `127.0.0.1` | backend | `BACKEND_PORT`; nginx proxies `/v1/` here |
| `5433` | `127.0.0.1` | postgres | `POSTGRES_HOST_BIND_PORT` → container `5432`; for local `psql` only |

Nothing is published to `0.0.0.0` — only the host nginx faces the internet.

---

## 4. The `.env` — every setting explained

`.env` lives next to `docker-compose.yml` and is read automatically for `${VAR}`
interpolation. It is **gitignored** (real secrets never leave the machine). The
committed template is `.env.example`.

### Switchboard rule
For the VPS you change **only the PUBLIC SURFACE block** (localhost → your domain)
and fill the secrets. Everything else is internal and stays put.

### 4.1 Version
| Var | Meaning |
|-----|---------|
| `BOE_VERSION` | Image tag the compose resolves (`boe-backend:${BOE_VERSION}`). `export.sh`/`deploy.sh` set this per release; `local` for manual runs. |

### 4.2 Public surface — the only block you swap for the VPS
| Var | Local default | VPS value | Consumed by |
|-----|---------------|-----------|-------------|
| `PUBLIC_LANDING_ORIGIN` | `http://localhost:3100` | `https://<domain>` | backend (signup origin gate) + landing |
| `PUBLIC_API_BASE_URL` | `http://localhost:47502` | `https://<domain>` | backend (self-advertised base) |
| `CORS_ORIGIN` | localhost + capacitor origins | `https://<domain>,` + same dev origins | backend CORS allow-list |

Keep the `localhost:5173` / `capacitor://localhost` entries in `CORS_ORIGIN` even on the
VPS — that is how the locally-run admin portal and the client APK reach this backend.

### 4.3 Runtime mode
| Var | Value | Effect |
|-----|-------|--------|
| `NODE_ENV` | `production` | turns on the strict config validator (hard-fails on weak/placeholder secrets) |
| `PROVIDER_MODE` | `live` | payment/provider mode (`development`/`staging`/`live`) |
| `LOG_LEVEL` | `info` | backend log verbosity |

### 4.4 Ports
`BACKEND_PORT=47502`, `LANDING_PORT=3100`, `POSTGRES_HOST_BIND_PORT=5433` — see §3. Rarely changed.

### 4.5 PostgreSQL
| Var | Meaning |
|-----|---------|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | credentials for the `postgres` container |

The compose **derives** the backend's DB wiring from these (you don't set them separately):
`DATABASE_URL=postgres://<user>:<pass>@postgres:5432/<db>` plus discrete `DATABASE_HOST/PORT/NAME/USER/PASSWORD`
(the `psql`-based `migrate` job needs the discrete form), and `DATA_STORE=postgres` to select the pg adapter.

### 4.6 Secrets (required; `openssl rand`)
| Var | Generate with | Purpose |
|-----|----------------|---------|
| `ACCESS_TOKEN_SECRET` | `openssl rand -hex 48` | signs short-lived access JWTs |
| `REFRESH_TOKEN_SECRET` | `openssl rand -hex 48` | signs refresh JWTs |
| `SIGNUP_PROXY_SECRET` | `openssl rand -hex 32` | shared landing↔backend signup gate (see §5) |

With `NODE_ENV=production`, the backend refuses to boot if any of these look like
placeholders — that is deliberate.

### 4.7 Admin login (env-based, not a DB row)
| Var | Meaning |
|-----|---------|
| `ADMIN_LOGIN_ID` | admin email/login used by the admin portal |
| `ADMIN_PASSWORD` | admin password (read straight from env) |
| `ADMIN_FIRST_NAME` / `ADMIN_LAST_NAME` / `ADMIN_PHONE` | admin profile fields |

### 4.8 Auth seed
| Var | Meaning |
|-----|---------|
| `SEED_AUTH_ENABLED` | run the seed job at deploy |
| `SEED_AUTH_ALLOW_PRODUCTION` | allow seeding when `NODE_ENV=production` (true here, since the prod DB starts empty) |
| `SEED_AUTH_OVERWRITE` | overwrite existing users (keep `false` — never clobber live users) |
| `SEED_CLIENT_EMAIL` / `SEED_CLIENT_PASSWORD` | the seeded client account |

---

## 5. The signup security gate (why it exists)

Account creation is allowed **only from the landing page**. Two checks, both in the backend:

1. The landing's signup proxy adds header `x-signup-key` = `SIGNUP_PROXY_SECRET`.
   The backend compares it to its own `SIGNUP_PROXY_SECRET`.
2. The proxy also sets `origin` = `PUBLIC_LANDING_ORIGIN`; the backend compares it to
   its `SIGNUP_ALLOWED_ORIGIN` (which the compose sets = `PUBLIC_LANDING_ORIGIN`).

Because both containers read the **same** `.env`, these always match. Any direct
signup attempt from another origin without the secret gets `403 SIGNUP_NOT_ALLOWED`.

---

## 6. Persistence & safety

- **Data** lives in the `pgdata` named Docker volume. `deploy.sh`/`rollback.sh` run
  `docker compose down` **without `-v`**, so the database survives every release.
- **Backup:** `docker compose exec postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql`
- **Rollback** refuses to run if the compose file is missing the `pgdata` volume
  contract or if the volume has vanished (guards against silent state loss).

---

## 7. Operating it (from the main repo)

```bash
./release_manager/status.sh      # dashboard: what's committed/merged/staged/deployed + next steps
./release_manager/export.sh ...  # build + bundle images (run on a build machine)
./release_manager/deploy.sh      # load images + compose up here, with health checks
./release_manager/rollback.sh    # restore a previous release
```

Files that appear in this dir at deploy time (all gitignored): `.env`, `images/*.tar.gz`,
`version.json`, `current-version.json`, `manifest.json`, `README.txt`. The only
tracked files here are `docker-compose.yml`, `.env.example`, and this guide.

---

## 8. Local vs VPS in one line

**Local:** the `.env` defaults already work — `deploy.sh` brings the whole stack up on
`localhost:3100` / `:47502`. **VPS:** swap the three PUBLIC SURFACE URLs to your domain,
point the host nginx `server_name` at the same domain, run `certbot`, deploy. Nothing
else moves.


---

## 9. Where to put the domain name and the VPS IP

Two different things in two different places — and only the **domain** ever enters
the app. The top of `.env` has a fill-in block to record both for reference.

### Domain name -> goes INTO the app config (4 spots, all the same name)
1. `BOE_APP/.env` -> `PUBLIC_LANDING_ORIGIN` = `https://<domain>`
2. `BOE_APP/.env` -> `PUBLIC_API_BASE_URL`   = `https://<domain>`
3. `BOE_APP/.env` -> `CORS_ORIGIN`           = `https://<domain>,` + the existing localhost/capacitor entries
4. Host nginx `server_name` in `frontend_stack/deploy/nginx.single-port.example.conf`
   (and the matching `certbot --nginx -d <domain>`)

### VPS IP address -> does NOT go into the app
The IP is infrastructure, not app config. It is used in exactly two places, both
**outside** this repo:
1. **DNS** — at your domain registrar, create an `A` record: `<domain> -> <VPS IP>`.
   That is what makes `https://<domain>` resolve to your server.
2. **SSH** — to reach the box: `ssh <user>@<VPS IP>`.

So the app always refers to the **domain**; the **IP** only lives in your DNS record
and your SSH command. To smoke-test before DNS is ready you can hit the server
directly at `http://<VPS IP>:3100` / `:47502`, but the real config uses the domain.

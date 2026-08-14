# BeOnEdge — VPS deployment

The VPS runs the **backend_controller** API, the **user SPA**, the **admin SPA**, and
**PostgreSQL** — orchestrated from `release_manager/BOE_APP/`. The marketing site is
**not** here: it is a separate application on separate infrastructure (AWS, `beonedge.in`)
that only posts new signups to `POST /api/newuser`. The client APK connects to this same
backend over the public domain.

**One env file drives everything:** `release_manager/BOE_APP/.env`. Its defaults target
localhost; going live means swapping the localhost URLs in its **PUBLIC SURFACE** block
for your domain. Internal container wiring uses Docker service names, so nothing else moves.

```
                 Internet :443
                       │
              ┌────────▼─────────┐   host nginx (TLS, NOT a container)
              │   host nginx     │   frontend_stack/deploy/nginx.single-port.example.conf
              └───┬──────────┬───┘
            /     │          │  /api/
        ┌─────────▼──┐   ┌───▼────────┐
        │ user SPA   │   │ backend    │◄── admin SPA + client APK connect here
        │ :8080      │   │ :47502     │◄── AWS beonedge.in POSTs /api/newuser
        └────────────┘   └─────┬──────┘
                               │
                         ┌─────▼──────┐
                         │ postgres   │  (pgdata volume; internal network)
                         └────────────┘
```

Both app containers bind to `127.0.0.1` only; the host nginx is the sole public entry.

## Release flow (image-based, via release_manager)

```bash
# 1. Build machine — build + bundle the images
./release_manager/export.sh --version 1.0.0     # or --patch / --minor / --major

# 2. Ship release_manager/ to the VPS (rsync/scp/git), then on the VPS:
cd release_manager/BOE_APP
cp .env.example .env            # first time only
#   Edit .env:
#     - PUBLIC SURFACE block: swap localhost URLs -> https://<your-domain>
#       PUBLIC_API_BASE_URL=https://<your-domain>
#       CORS_ORIGIN=https://<your-domain>,https://beonedge.in,https://localhost
#       WEB_ORIGIN_ALLOWLIST=https://<your-domain>,https://localhost
#       (WEB_ORIGIN_ALLOWLIST is authoritative; CORS_ORIGIN is the legacy fallback.
#        `https://localhost` is the APK's own content origin — see the client note
#        below. Never use `*`.)
#     - Fill every CHANGE_ME secret (production hard-fails on placeholders):
#         openssl rand -hex 48   # ACCESS_TOKEN_SECRET, REFRESH_TOKEN_SECRET
#         openssl rand -hex 32   # NEWUSER_SHARED_SECRET (give it to the beonedge.in site)
#         strong values for POSTGRES_PASSWORD, ADMIN_PASSWORD, SEED_CLIENT_PASSWORD

# 3. Deploy (postgres -> migrate -> seed -> backend -> SPAs, with health checks)
cd ../..
./release_manager/deploy.sh

# Roll back if needed
./release_manager/rollback.sh
```

`deploy.sh` reuses an existing `BOE_APP/.env`; the bundle's `.env` is only a first-deploy
fallback. During VPS shipping, the script archives the active `BOE_APP/` directory and
replaces the remote `BOE_APP/` after `docker compose down`. The VPS `.env` is restored
into the new directory with only `BOE_VERSION` advanced, so compose uses the newly
loaded image tags while keeping the VPS secrets/domains intact. Postgres data persists
in the `pgdata` volume across deploys and rollbacks.

## Host nginx + TLS (one-time, on the VPS)

```bash
sudo cp frontend_stack/deploy/nginx.single-port.example.conf /etc/nginx/sites-available/beonedge.conf
sudo sed -i 's/your-domain.tld/<your-domain>/g' /etc/nginx/sites-available/beonedge.conf
sudo ln -s /etc/nginx/sites-available/beonedge.conf /etc/nginx/sites-enabled/
sudo certbot --nginx -d <your-domain>        # provisions + wires TLS certs
sudo nginx -t && sudo systemctl reload nginx
```

`server_name` MUST equal the domain in `BOE_APP/.env` `PUBLIC_API_BASE_URL`.
It proxies `/api/` → the backend (the `/api` prefix is stripped) and `/` → the user SPA.

## How admin / client connect (not containerized)

- **Admin** (local `npm run dev` or app build): point its API base at `https://<your-domain>`
  (calls hit `/v1/...`). Its dev origin (`http://localhost:5173`) is only in the local
  `backend_controller/.env` allowlist — do not add a cleartext origin to a deployed stack.
- **Client / Admin APK**: build with the API base = `https://<your-domain>`. The APK's own
  content origin is **`https://localhost`** (Capacitor serves the bundle over
  `androidScheme=https`), so every request it makes carries `Origin: https://localhost`.
  That exact string must be in `WEB_ORIGIN_ALLOWLIST` on any backend serving an APK, or
  CORS drops every reply and the app looks entirely offline. It is not present by default
  in a fresh `.env` — check it. `capacitor://localhost` and `http://localhost` are **not**
  the current origins and should not be added.

## Security checklist (enforced)

- backend + postgres bound to `127.0.0.1`; only nginx is public (TLS-only, HTTP→HTTPS redirect).
- `NODE_ENV=production` hard-fails on placeholder/weak secrets — fill real values.
- Real secrets live only in the VPS's untracked `BOE_APP/.env`; the committed `.env.example`
  keeps `CHANGE_ME` placeholders (see `release_manager/.gitignore`).
- `POST /api/newuser` is the signup door for the AWS-hosted marketing site. Only that
  site may call it: it presents `NEWUSER_SHARED_SECRET` in the `x-signup-key` header,
  compared in constant time, and the route fails closed if the secret is unconfigured.
  Origin/Referer are deliberately not used — the call is server-to-server, so those
  headers are absent or attacker-controlled. It is additionally throttled by the
  `boe_signup` nginx zone (10r/m per address). Signup creates a submitted application
  but sends no email; approval queues the welcome/download email.
- Back up Postgres: `docker compose exec postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"`.

## DB-safe rollback (dump on deploy, restore on rollback)

A deploy runs migrations **forward** before the new app starts. If a rollback only
restored the old *images*, the old app would be pointed at the newer, already-migrated
schema — which can break. So the snapshot carries the data too:

- **`deploy.sh`** — at the *ROLLBACK SNAPSHOT* step (before the new stack migrates), it
  `pg_dump`s the still-running database into the snapshot as `db.sql.gz`, pinned to the
  exact release being replaced. Skipped cleanly on the first deploy (no DB yet); a dump
  failure is non-fatal (snapshot keeps images only).
- **`rollback.sh`** — if the chosen snapshot has a `db.sql.gz`, it brings up **Postgres
  alone** (app down, no writers), then — after an explicit destructive-overwrite confirm —
  drops + recreates the database and reloads the dump onto a clean schema, then starts the
  full stack. Use `--skip-db-restore` for an images-only rollback that keeps current data.

The `pgdata` volume still persists across deploys/rollbacks; the dump/restore is a
point-in-time data rewind layered on top, used only when you actually roll back.

## VPS DB sync on `--ship` (consistent across updates *and* migrations)

The VPS Postgres lives in a Docker named volume. That volume survives `compose down`
on the **same** VPS, but it does **not** travel when you move to a **different** VPS —
a fresh host starts with an empty database. To keep data consistent across both,
`deploy.sh --ship` synchronizes the database around the stack swap:

1. **Pull (always, before touching the remote):** it probes the live VPS DB and, if it
   has data, `pg_dump`s it back to `release_manager/BOE_APP/db_records/<version>-<ts>.sql.gz`
   (with a `latest.sql.gz` pointer; the newest `DB_RECORDS_KEEP=10` are retained). Your
   local machine thus always holds the freshest production snapshot. *(db_records/ is
   gitignored — it contains real user data — and is excluded from the shipped archive.)*
2. **Seed a fresh VPS (migration):** after the stack is loaded, Postgres is brought up
   **alone**, and if the remote DB is **empty** (new host / new volume) the latest local
   snapshot is restored into it **before** migrations run. `compose up` then runs migrate
   forward over that restored data, so a brand-new VPS comes up with the old VPS's data,
   schema-upgraded to the shipped release.
3. **Never clobbers a populated remote:** if the VPS already has data, it is left intact
   (it was just backed up in step 1, and its `pgdata` volume persists anyway).

Flags:

- `--skip-db-sync` — ship the stack only; no pull, no seed.
- `--db-force-restore` — **DESTRUCTIVE.** Restore the latest local `db_records` snapshot
  onto the VPS *even if it already has data*, overwriting it. Use only when you
  deliberately want local to become the source of truth.

Migration in practice: ship to the old VPS once (this pulls its DB into `db_records/`),
then point `SHIP_HOST` at the new VPS and ship again — the fresh host is detected as
empty and seeded from that local snapshot automatically.

## Migration rule: expand/contract (backward-compatible)

Every migration must be **backward-compatible with the previous app version**, so the
prior release can run against the new schema. This is what makes an *images-only* rollback
(`--skip-db-restore`, no data rewind) safe.

- **Expand (the release that needs the change):** add-only. New tables, new **nullable**
  columns (or columns with a default), new indexes. Never drop or rename in the same
  release that starts depending on the change.
- **Contract (a *later* release, once nothing rolls back to the old app):** drop/rename the
  now-unused columns or tables.
- Backfills run as their own step and tolerate both old and new code reading the row.

When a migration genuinely cannot be made backward-compatible, treat it as a
**data-restoring rollback only** — i.e. rolling back *requires* `db.sql.gz` (do not use
`--skip-db-restore`), and call that out in the release notes.

## Scaling roadmap (build → registry → pull-deploy → staging)

Today images are built locally and shipped as tarballs over SSH. The path to scale:

1. **CI builds from a tag.** Pushing a release tag (e.g. `v1.2.0`) triggers CI to build the
   backend + frontend images reproducibly from that commit — no more build-machine drift,
   and provenance is the tag itself.
2. **GHCR registry.** CI pushes the images to GitHub Container Registry
   (`ghcr.io/<org>/boe-backend:<tag>`, `…/boe-app:<tag>`) instead of producing tarballs.
3. **`compose pull` deploy.** The VPS deploy becomes `docker compose pull && up -d` against
   the pinned tag — no `docker load`, no SSH tar upload. Rollback = pull the previous tag
   (the DB dump/restore flow above still applies).
4. **Staging environment.** A staging stack (own domain + DB) deploys every tag first;
   promotion to production is re-using the *same* registry image, not a rebuild.

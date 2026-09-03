# BeOnEdge — VPS deployment

Three independent stacks are deployed from `release_manager/`, each with its own compose
file, `.env`, remote directory and lock:

| Stack | Flag | Remote directory | What it runs |
| ----- | ---- | ---------------- | ------------ |
| `dev_release` | `--dev` | `/srv/dev_stack/BOE_APP/dev_release` | the development app stack |
| `prod_release` | `--prod` | `/srv/dev_stack/BOE_APP/prod_release` | the production app stack |
| `monitor_service` | `--monitor` | `/srv/dev_stack/BOE_APP/monitor_service` | Prometheus, Grafana, Alertmanager, Blackbox |

Every remote path comes from that stack's tracked `paths.json` (schema 3). No script in
`release_manager/` derives a remote path itself, and `verify.sh` compares each `paths.json`
against `lib/stacks.sh` so a drifted copy fails before a deploy.

The marketing site is **not** in this repository: it is a separate application on separate
infrastructure (AWS, `beonedge.in`) whose only inbound call is `POST /api/newuser`.

## What an app stack actually runs

Nine services, not four. The four workers are where money and mail move.

```
                 Internet :443
                       │
              ┌────────▼─────────┐  host nginx (TLS, NOT a container)
              │   host nginx     │  release_manager/nginx/*.conf
              └──┬────────┬──────┘
           /     │        │  /api/
    ┌────────────▼─┐  ┌───▼──────────┐
    │ app SPA      │  │ backend      │◄── admin SPA + both APKs
    │ 127.0.0.1    │  │ 127.0.0.1    │◄── AWS beonedge.in POSTs /api/newuser
    │ :47411 prod  │  │ :47413 prod  │
    │ :47421 dev   │  │ :47423 dev   │
    └──────────────┘  └───┬──────────┘
    ┌──────────────┐      │
    │ admin SPA    │      │
    │ :47412 prod  │      │
    │ :47422 dev   │      │
    └──────────────┘      │
                    ┌─────▼───────────────────────────────┐
                    │ postgres (pgdata volume)  ·  redis  │
                    └─────▲───────────────────────────────┘
                          │
   ┌──────────────────────┴──────────────────────────────────────────┐
   │ migrate → seed → then four long-running workers:                │
   │   payments-worker      paymentReconciliationEntrypoint.js       │
   │   email-worker         emailWorker.js         (loop, 15 s)      │
   │   collections-worker   mandateCollectionEntrypoint.js (60 s)    │
   │   sips-worker          sipScheduleEntrypoint.js       (300 s)   │
   └─────────────────────────────────────────────────────────────────┘
```

`migrate` runs `npm run migrate` from the backend image with `depends_on: postgres healthy`,
ahead of the backend, so a pending migration applies automatically on the next deploy once
it is in the image. **Migrations are ordered before code**: a release whose code writes a
column added by a pending migration must have that migration in the same image.

Each worker's healthcheck reads its own `worker_heartbeats` row through
`dist/scripts/check-worker-health.js <worker> <maxAgeSeconds>` — 120 s for payments, 60 s
for email, 180 s for collections, 900 s for SIPs. A green healthcheck means the pass
completed without throwing; it does **not** prove the pass did any work, because an
unconfigured gateway or absent SMTP transport returns a zero summary and still reports
success.

Both SPA containers and the backend bind to `127.0.0.1` only; the host nginx is the sole
public entry.

## Release flow

Three scripts, in this order. Only `export.sh` advances the version.

```bash
# 1. Build machine — build images and stage a bundle under release_manager/build/<stack>/
./release_manager/export.sh --prod                 # or --dev / --monitor
#   --with-apk     also build and stage the Android APKs for this stack
#   --skip-build   reuse already-built images (development/monitoring only)
#   --keep N       bundles retained per stack (default 3)

# 2. Ship the newest staged bundle and run that stack's native deploy script on the VPS
./release_manager/deploy.sh --prod
#   --bundle DIR   ship a specific bundle instead of the newest
#   --ship-only    upload the artifacts but do not run the remote deploy
#   --yes, -y      skip local confirmation, and pass --yes to the remote script
#   --force        redeploy the same version
#   --skip-checks  pass --skip-checks to the remote script

# 3. Roll back if needed — start with --list
./release_manager/rollback.sh --prod --list
./release_manager/rollback.sh --prod --to 0.12.6
#   --latest       newest archived version that is not running
#   --restore-db   ALSO restore that release's pre-deploy database snapshot
```

Version labelling: a clean tree on the exact `vX.Y.Z` tag produces a stable `X.Y.Z`;
anything else produces `<next>-dev.N.gSHA[.dirty]`. **Production deploys refuse any version
containing `-`**, so cut a release in `status.sh` before exporting a production bundle.

`release_manager/verify.sh` checks the whole contract locally (108 assertions; add
`--remote` for the VPS checks). `release_manager/status.sh` is the interactive console for
version state, git workflow and stack status.

## Database rollback semantics

**Restoring data is opt-in, not opt-out.** `rollback.sh` swaps images only unless you pass
`--restore-db`, which is destructive: it discards transactions committed since the
snapshot and requires typing `RESTORE` at the remote prompt.

A deploy runs migrations forward before the new app starts, so an images-only rollback
points the previous app at an already-migrated schema. That is safe only while migrations
stay backward-compatible — see the expand/contract rule below. When a migration cannot be
made backward-compatible, say so in the release notes: rolling back that release *requires*
`--restore-db` and its matching snapshot.

Per-stack backup roots live under `/srv/backup/BOE_APP/` (`PROD_ROLLBACK/`, `DB_BACKUPS/`,
`LOGS/`) and are addressed through `paths.json`, never by literal path.

## Host nginx + TLS (one-time, on the VPS)

`release_manager/lib/nginx_ship.sh` owns the repo-name → install-path mapping. Use it;
installing a differently-named vhost by hand leaves two configs serving the same host.

| Repository file | Installed as |
| --------------- | ------------ |
| `app.beonedge.in.conf` | `sites-available/boe-app` |
| `dev-app.beonedge.in.conf` | `sites-available/boe-dev-app` |
| `admin.tailscale.conf` | `sites-available/boe-admin-tailscale` |
| `boe-shared.conf` | `conf.d/boe-shared.conf` |
| `boe-security-headers.conf` | `snippets/boe-security-headers.conf` |

A config in `release_manager/nginx/` with no row is reported as unroutable rather than
shipped. After any change:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

`boe-shared.conf` holds the `limit_req_zone` definitions, which are only valid in the http
context: `boe_general` 20 r/s, `boe_auth` 5 r/m, `boe_signup` 60 r/m, `boe_monitor` 10 r/s.
The site configs put all four login endpoints —
`/v1/auth/{native,web,client/web,admin/native}/login` — in `boe_auth`. A new login route
that is not added to that regex silently falls through to `boe_general`.

Readiness is never public: `location /api/health/` is restricted to loopback, because
readiness leaks dependency state and gives an unauthenticated caller a cheap liveness
oracle. `GET /metrics` has no nginx location at all — it is guarded inside the application
by `isPrivateRequest` (`runtime/metrics.ts:50`), which admits loopback, the Docker bridge
and RFC1918 ranges so the monitoring stack can scrape it.

## How admin and the APKs connect

- **Admin console in a browser**: served by the admin SPA container behind
  `admin.tailscale.conf`. It authenticates with HttpOnly cookies on the `web` session
  channel plus a CSRF synchroniser token.
- **Both APKs**: built with the API base pointed at the stack's public host. The APK's own
  content origin is **`https://localhost`** (Capacitor serves the bundle over
  `androidScheme=https`), so every request carries `Origin: https://localhost`. That exact
  string must be in `WEB_ORIGIN_ALLOWLIST` on any backend serving an APK, or CORS drops
  every reply and the app looks entirely offline. `capacitor://localhost` and
  `http://localhost` are not the current origins and must not be added.
  `originExamples.test.ts` pins this across all four env examples.
- The client APK uses the `native` bearer channel; the admin APK uses `admin_native`. They
  are separate session channels on purpose — an investor bearer token must not satisfy
  admin authentication.

## Configuration

Each stack's `.env` is created once on the VPS from the shipped `.env.example` and is never
overwritten by a deploy:

```bash
cd /srv/dev_stack/BOE_APP/prod_release && cp .env.example .env && chmod 600 .env
```

Real secrets exist only in those untracked `.env` files. `NODE_ENV=production` hard-fails
on placeholder or weak secrets. Token signing is asymmetric ES256:
`ACCESS_TOKEN_SIGNING_KEY` plus `ACCESS_TOKEN_VERIFICATION_KEYS`, with `REFRESH_HMAC_KEY`
for deterministic refresh derivation — generate them with
`npm run keys:generate` in `backend_controller`.

`envPassthrough.test.ts` enforces both directions: every backend-read key declared in a
stack `.env.example` must be substituted into that stack's compose file, and no example may
declare a setting nothing consumes.

`POST /api/newuser` is the signup door for the AWS marketing site. It presents
`NEWUSER_SHARED_SECRET` in `x-signup-key`, compared in constant time, and fails closed if
the secret is unconfigured. Origin and Referer are deliberately not used — the call is
server-to-server, so those headers are absent or attacker-controlled. Signup creates a
`submitted` application and sends no email; approval is what queues the welcome mail.

## Migration rule: expand/contract

Every migration must be backward-compatible with the previous app version, so the prior
release can run against the new schema. That is what makes an images-only rollback safe.

- **Expand**, in the release that needs the change: add-only. New tables, new nullable
  columns (or columns with a default), new indexes. Never drop or rename in the same
  release that starts depending on the change.
- **Contract**, in a later release once nothing rolls back to the old app: drop or rename
  the now-unused columns and tables.
- Backfills run as their own step and tolerate both old and new code reading the row.

## Scaling roadmap

Images are built locally and shipped as tarballs over SSH. The path to scale:

1. **CI builds from a tag**, so provenance is the tag rather than a build machine.
2. **A registry** (e.g. GHCR) receives those images instead of producing tarballs.
3. **`compose pull` deploy** replaces `docker load` and the tar upload; rollback becomes
   pulling the previous tag, with the snapshot flow above unchanged.
4. **A staging stack** takes every tag first; promotion re-uses the same image.

# PROD_RELEASE — production stack, on-VPS guide

This file lives at `/srv/dev_stack/BOE_APP/prod_release/` on the VPS. It
documents what you can do **from here**, over SSH, with no source tree present.

Normally you drive deployments from the build machine
(`./release_manager/deploy.sh --prod`), which uploads the bundle and then runs
`./prod_deploy.sh` here. Everything below is the same machinery, invoked directly.

---

## What is in this directory

| Path | Purpose |
| --- | --- |
| `prod_deploy.sh` | Deploy the staged release. Owns every docker command. |
| `prod_rollback.sh` | Roll back to a previously archived release. |
| `_boe_lib.sh` | Shared runtime library (locking, checksums, health, backups). |
| `_boe_deploy.sh` / `_boe_rollback.sh` | The generic flows the two entry points drive. |
| `paths.json` | **Generated.** Every path both sides use. Never hand-edit. |
| `docker-compose.prod_app.yml` | The stack definition. Replaced by each deploy. |
| `manifest.json` | Incoming release metadata + SHA-256 checksums. |
| `release-version.json` | What is **actually deployed** right now. |
| `.env` | All runtime configuration and secrets. **You own this; deploys never overwrite it.** |
| `.env.example` | Template, refreshed by every deploy. |
| `images/*.tar.gz` | Incoming image archives. |
| `prod_apk/`, `admin_apk/` | Published APK artifacts. |

Release scripts read only this stack's `.env`; there is no second secrets file.

---

## First-time setup

```bash
cd /srv/dev_stack/BOE_APP/prod_release
cp .env.example .env
chmod 600 .env
$EDITOR .env
```

Confirm `.env` is private and readable:

```bash
stat -c '%U:%G %a %n' .env
```

---

## Deploy

```bash
cd /srv/dev_stack/BOE_APP/prod_release
./prod_deploy.sh
```

Flags:

| Flag | Effect |
| --- | --- |
| `--yes` | Skip the confirmation prompt (required when non-interactive). |
| `--force` | Redeploy a version that is already active. |
| `--skip-checks` | Start the stack without gating on health checks. **Records the version unverified.** |

`--skip-db-backup` is **rejected** for production.

### What it does, in order

1. Take the exclusive lock (`/run/lock/boe-prod_release.lock`) — shared with rollback.
2. Verify the release directory and `manifest.json`.
3. Verify `/srv/backup` is mounted and writable.
4. Check disk space (3× the incoming archive size).
5. Read the deployed version; refuse a no-op unless `--force`.
6. **Refuse any version containing `-`** — dev builds never reach production.
7. Verify SHA-256 of the compose file and every image archive. Mismatch aborts.
8. Verify docker, compose, and the required env keys.
9. Confirm with the operator.
10. Archive the currently running images to `PROD_ROLLBACK/IMAGES/<version>/`.
11. Copy current APKs to `PROD_ROLLBACK/APK/<version>/`.
12. Take a pre-deployment `pg_dump` into `PROD_ROLLBACK/PSQL_DB/<version>/`.
13. Load the new images.
14. Start postgres, wait for `pg_isready`, then bring up the whole stack.
    Migrations run in-band via the `migrate` service before the backend starts.
15. Wait for every healthcheck, then smoke-test backend, landing, app and admin.
16. **Only if healthy:** write `release-version.json` and update the registry.

If health checks fail it automatically rolls back to the previous images and
exits non-zero. It does **not** restore the database — that stays explicit.

---

## Roll back

Always look first:

```bash
./prod_rollback.sh --list
```

Then:

```bash
./prod_rollback.sh --latest          # one release back
./prod_rollback.sh --to 1.4.1        # a specific version
```

Application rollback only swaps container images. It is safe and itself
reversible, because the outgoing release is archived before the swap.

### Database restoration is separate

```bash
./prod_rollback.sh --to 1.4.1 --restore-db
```

This **discards every transaction committed since that release was deployed.**
It backs up the current database first and requires you to type `RESTORE`.

Reach for application rollback first. Restore the database only when the data
itself is the problem — a bad migration or a corrupting bug.

---

## Inspect

```bash
cd /srv/dev_stack/BOE_APP/prod_release

# what is deployed
jq . release-version.json

# containers
docker compose --project-name boe_prod -f docker-compose.prod_app.yml ps

# logs
docker compose --project-name boe_prod -f docker-compose.prod_app.yml logs -f backend

# health, direct on loopback (not public — nginx denies /api/health/)
curl -fsS http://127.0.0.1:47413/health/ready | jq .

# deploy history
ls -t /srv/backup/BOE_APP/LOGS/PROD_LOGS/DEPLOY_LOGS/ | head
```

---

## Ports

From `.env`, all bound to `127.0.0.1`. nginx is the only public entry point.

| Variable | Port |
| --- | --- |
| `LANDING_PORT` | 47410 |
| `APP_FRONTEND_PORT` | 47411 |
| `ADMIN_FRONTEND_PORT` | 47412 |
| `BACKEND_PORT` | 47413 |
| postgres | none — internal network only |

Changing one means editing `.env` **and** the nginx site config, then
`sudo nginx -t && sudo systemctl reload nginx`, then redeploying.

---

## Troubleshooting

**"another deploy or rollback is already running"** — a previous run holds the
lock. Confirm nothing is live, then `ls -l /run/lock/boe-prod_release.lock`. The
lock releases automatically when the holding process exits.

**"checksum verification failed"** — the upload was corrupted. Re-run
`./release_manager/deploy.sh --prod` from the build machine; rsync `--checksum`
will re-send the bad file.

**"is not writable by beonedge"** — see `OPERATOR_MANUAL_STEPS.md §1`.

**"missing required env keys"** — a key is absent from `.env`. The message names
it.

**Migrations failed** — check `docker compose logs migrate`. Migrations are
checksummed in `schema_migrations`; editing an already-applied migration file
makes it fail permanently. Roll the application back and fix forward.

**Deployed but 502 through nginx** — the container is up but nginx points at the
wrong port. Compare `.env` with the `proxy_pass` lines in
`/etc/nginx/sites-available/boe-app`.

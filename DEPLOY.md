# BeOnEdge — VPS deployment

Operator reference only. Root [RULES.md](RULES.md) owns safety and permissions;
these commands do not authorize an agent to export, connect to the VPS, deploy,
restore data, or run a migration against a deployed database.

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

The email worker writes its heartbeat only at the end of a pass, so a pass must finish
well inside that 60 s. `backend_controller/src/email/sendTiming.ts` budgets a pass at 35 s
(60 s minus the 15 s loop sleep minus 10 s overhead) and stops starting new messages when
the next one could not finish inside it. A test ties those two numbers to the compose files,
so changing the email healthcheck age or `EMAIL_WORKER_INTERVAL_SECONDS` default means
changing that file too. The SMTP timeouts and the lease are derived from
`EMAIL_WORKER_LEASE_MS` (default 60000): a lease below 20 s is raised to 20 s, and the
socket idle timeout is 10 s at the default. There are no separate timeout settings.

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
stay backward-compatible; see the migration policy below. A migration that cannot be made
backward-compatible is a destructive boundary: rolling back across it *requires*
`--restore-db` and its matching snapshot, which discards every transaction committed since,
including customer activity. Such a migration needs maintainer approval under `RULES.md`
rule 11 and must be registered as a rollback boundary (migrations 025 and 042 are).

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

## Maintenance mode and required updates

A deploy or rollback raises a maintenance flag for its stack, `<stack_dir>/maintenance/active`,
and installs the stack's `maintenance.html` (shipped in every bundle) as
`<stack_dir>/maintenance/index.html`. While the flag exists, the site configs in
`release_manager/nginx/` answer every web-app request with that page and a 503, and every API
request with a 503 JSON error `SERVICE_MAINTENANCE` plus the header `X-BOE-Maintenance: 1` and
`Retry-After: 60`. APK downloads, `/.well-known/assetlinks.json`, and the localhost health probes
keep working, so a client can still download an update. Apps from v0.15.0 recognize the header
and show a "We are updating BeOnEdge" screen that checks again every 30 seconds and closes by
itself; older APKs show their generic temporary error.

When the flag goes up and down:

- Deploy: raised at step 15, before the pre-deploy database backup, so no customer write lands
  after the snapshot. Lowered once the health checks pass, or once an automatic rollback comes
  up healthy. If the deploy fails before anything is stopped or replaced, it is lowered again on
  exit because the running release was never touched. If it fails after the stack was stopped or
  replaced, it stays up and the log says how to lower it.
- Rollback: raised before the database step, lowered after the health checks pass, with the same
  exit rule.
- By hand: `<stack>_deploy.sh --maintenance-on` and `--maintenance-off` raise or lower it under
  the deployment lock and exit.

The nginx part only takes effect once the updated site configs are installed in `/etc/nginx`
(the deploy prints the commands; see Host nginx). Until then the flag has no visible effect.

Advance notice and required updates are published app configuration (Admin, App configuration,
`config.publish`), read by the apps from `GET /v1/app-config` when they open or regain focus (at most every five minutes):

- `maintenance.message` with `maintenance.scheduledFor` (an ISO date-time) shows a "Planned
  maintenance from <time>" banner until that time passes. `maintenance.enabled: true` shows
  "Maintenance in progress" with the message, without blocking the app.
- `minimumSupportedVersion.android` (a dotted version) makes every older APK show its blocking
  "Update required" screen with the install button; this already works for APKs up to v0.14.7.
  `minimumSupportedVersion.message` adds an extra line to that screen on apps from v0.15.0. Raise
  the floor to the new version when the v0.15.0 APK is published, so older APKs update before
  they meet the changed API.

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

`CLIENT_PASSWORD_LINK_URL` is the client web page that password set and reset links open, for
example `https://app.beonedge.in/reset-password` on production. A link is this URL with
`?token=` added, so the value must be an absolute URL with no query, no fragment and no
username or password, and `NODE_ENV=production` also requires https. It replaces the first
`WEB_ORIGIN_ALLOWLIST` origin that older backends used. The backend reads it when a link is
issued, never at boot, so a missing or invalid value does not stop the backend. Instead
admin client creation answers 503 `DEPENDENCY_UNAVAILABLE`, names the setting in the message
and saves nothing, and the forgot-password route keeps its uniform 202 but logs the problem
and issues and queues nothing. A deploy never overwrites a stack `.env`, so add the key to
each stack's `.env` before the release that queues password mail goes out. Password mail is
queued, not sent by the web request, and leaves only while `email-worker` runs with SMTP
configured.

### Rotating `CRYPTO_RECIPIENT_ENC_KEY`

One key, `CRYPTO_RECIPIENT_ENC_KEY` with its `CRYPTO_RECIPIENT_ENC_KEY_VERSION`, encrypts the
recipient address of every queued mail message, the sealed payload of messages that carry a
secret such as a password link, and the PhonePe callback payloads kept for audit. There is no
keyring, so queued mail can be opened only under the version it was written with. A sealed
message under another version is dead-lettered with `EMAIL_PAYLOAD_KEY_MISMATCH`. A recipient
address under another key cannot be decrypted at all, so that message is dead-lettered with
`EMAIL_RECIPIENT_UNREADABLE` and never sent, while the rest of the queue carries on. Either way
the mail is lost, so rotate only when no mail is queued:

1. Choose a maintenance window and stop the `backend` service so nothing new is queued. Leave
   Postgres and `email-worker` running.
2. Wait until these read-only queries all return 0. Mail in `retryable_failed` waits on the
   retry ladder (about 42 hours before dead-lettering), so either wait it out or have the
   maintainer decide how to resolve it.

   ```sql
   select count(*) from outbox_events
    where topic in ('email', 'email.sealed') and state in ('pending', 'processing', 'retryable_failed');
   select count(*) from email_deliveries where state = 'sending';
   select count(*) from email_delivery_payloads p
     join email_deliveries d on d.id = p.email_delivery_id
    where p.scrubbed_at is null and d.state <> 'sending';
   ```

   A delivery in `sending` is in doubt, because the message may already have been sent. It
   stays as recorded, with its sealed ciphertext under the old key, until the maintainer
   decides what to do with it.
3. Stop `email-worker`, set the new key and a new version in the stack `.env`, then start
   `backend` and `email-worker` and check both healthchecks.

Rows that are already delivered, cancelled, or failed keep their old ciphertext. The
application never decrypts it again (the admin views show only the masked address), and the
same holds for the stored PhonePe callback payloads. Keep the old key somewhere safe if an
audit might need to read them.

## Migration policy

Production holds customer, financial, consent, and audit data. Root `RULES.md` rule 11 is
the authority; this section is the mechanics.

- **Expand**, in the release that needs the change, is add-only: new tables, new nullable
  columns (or columns with a default), and indexes or constraints that every existing row
  already satisfies. Never drop or rename in the release that starts depending on the
  change. The previous release must keep working against the migrated schema, because
  `migrate` completes before the new backend starts and an images-only rollback reuses the
  old image.
- **Contract**, in a later release once nothing rolls back to the old app and the
  maintainer has approved it, drops or renames the now-unused columns and tables. A
  contract step that can lose data is a destructive migration.
- **Backfills** run as their own step, are idempotent, touch only the rows they must, and
  tolerate both old and new code reading the row. They never re-trigger mail, payments, or
  ledger writes for historical rows.
- **Destructive migrations refuse instead of deleting.** Check for existing rows first and
  raise, as `042_remove_legacy_compliance_tables.sql` does for non-empty tables. Register
  the boundary in `release_manager/stacks/_shared/_boe_lib.sh` (rollback) and
  `_boe_deploy.sh` (backup policy), with tests in `release_manager/tests/database_backup.test.sh`.
- **Applied migrations are immutable.** `migrate` stores each file's checksum but does not
  verify it, so an edited applied migration never re-runs and silently diverges
  environments. Correct one with a new migration.
- Each file runs inside one transaction, so a statement that cannot (such as
  `CREATE INDEX CONCURRENTLY`) needs a deliberate runner change.
- Every production deploy over an existing database takes a pre-deploy `pg_dump` snapshot
  (`--skip-db-backup` is refused for production) and aborts if the dump fails. A snapshot is
  a recovery aid, not a rollback plan: restoring it discards later transactions.

Where a release cannot be made compatible with the previous one, the maintainer decides the
cut (for example a schema-only release ahead of the behaviour release, as in
`release_manager/docs/existing-client-impl/06-sequencing-and-migrations.md`) and states the
rollback implication in the release notes.

## Scaling roadmap

Images are built locally and shipped as tarballs over SSH. The path to scale:

1. **CI builds from a tag**, so provenance is the tag rather than a build machine.
2. **A registry** (e.g. GHCR) receives those images instead of producing tarballs.
3. **`compose pull` deploy** replaces `docker load` and the tar upload; rollback becomes
   pulling the previous tag, with the snapshot flow above unchanged.
4. **A staging stack** takes every tag first; promotion re-uses the same image.

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
success. Without the payment service (`PAYMENTS_SERVICE_URL` and `PAYMENTS_SERVICE_SECRET`)
the SIPs worker creates no instalment orders and logs `PAYMENT_GATEWAY_NOT_CONFIGURED`, and
the API refuses client lump-sum orders and SIP plans with `DEPENDENCY_UNAVAILABLE` before
writing anything. In that state the payments worker only expires one-time checkouts that
were never sent to the provider, have no other live or settled attempt on the same payment,
and whose pay-by time plus `PAYMENT_RECONCILIATION_EXPIRY_GRACE_SECONDS` has passed, with an
audit row each, and waits the idle interval between passes. Checkouts already sent to the provider stay open
until a configured gateway reconciles them.

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
#   --prod builds origin's production tip; push a release there first (status.sh → Git)

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

Version labelling: a clean tree on the exact `vX.Y.Z` tag, with origin's `vX.Y.Z` at the same
commit, produces a stable `X.Y.Z`; anything else produces `<next>-dev.N.gSHA[.dirty]`.
**Production deploys refuse any version containing `-`**, so cut a release in `status.sh`
before exporting a production bundle. The production checks are in
[Production gate](#production-gate).

The frontend learns that label at build time from `VITE_BEO_APP_VERSION` (DEC-71). `export.sh`
passes it to both SPA images as the `--build-arg VITE_BEO_APP_VERSION=<label>` that
`frontend_stack_ts/Dockerfile` turns into the same env variable, and `emu/boe_update.sh` exports
it with the label it gives the APK `versionName`, so the native and JavaScript versions agree.
The build sends it as `x-app-version` and `device.appVersion` on native sign-in and shows it as
"App version" on the admin Account and the What's new pages (the APK shows its `versionName` there).
A build without the variable, such as `npm run dev` or a plain `npm run build:client`, is
labelled `0.0.0-dev`. A value that is not `X.Y.Z`, `X.Y.Z-label` or `X.Y.Z+label` fails the
Vite build, which checks it with the contracts' `AppVersion`, the pattern the server uses to
refuse a version at native sign-in.

The web build also writes `dist/version.json` with that version and its target (`client` or
`admin`). From 0.18.3 the web app, never the APK, reads it when the tab regains focus and every
five minutes, and offers a Reload banner when the deployed version differs from its own. The
frontend container's nginx serves `index.html` and the SPA fallback with `Cache-Control:
no-cache`, `/version.json` with `no-cache`, and `/assets/` as immutable for a year; a missing
file under `/assets/` returns 404 instead of `index.html`. The host vhosts in
`release_manager/nginx/` pass these headers through unchanged. Tabs opened on 0.18.2 or earlier
have no watcher and pick up a new build on their next reload.

`release_manager/verify.sh` checks the whole contract locally (119 assertions; add
`--remote` for the VPS checks). `release_manager/status.sh` is the interactive console for
version state, git workflow and stack status.

### Production gate

`main` keeps moving after a cut (tally records commits, landed lanes). Production does not
follow `main`: it follows origin's `production` branch, which means "approved for
production". Records commits after a cut never block a production export.

- **Approve.** `status.sh` → Git → Push a release to production (also offered, default No,
  right after Cut a release). It fetches origin and reads `main`, `production` and the tags
  live; if that fails it refuses rather than list stale refs. It shows production's tip, for
  example `production is at v0.18.6 (468b02f)`, and the five newest release tags on it, then
  lists up to five of the newest `vX.Y.Z` tags that are on origin's `main`, not on
  `production`, and descend from its tip, so every choice is a fast-forward. Confirming
  `Push vX.Y.Z (<sha>) onto production? [y/N]` runs
  `git push origin <sha>:refs/heads/production` (no `+`, `--force` or
  `--force-with-lease`; origin refuses anything that is not a fast-forward) and then checks
  with `git ls-remote` that origin's `production` is that commit. Without a terminal, or on
  No, nothing is pushed and the exact command is printed. When `production` does not exist,
  the same choice creates it; the first time, choose v0.18.6, the release already live.
- **Export.** `export.sh --prod` never builds the checkout it runs in, and takes no tag: it
  reads origin's `production` live (refusing when origin is unreachable or the branch is
  missing), requires the tip to be exactly a release tag `vX.Y.Z` on origin, with `VERSION`
  `X.Y.Z` at that commit and the local tag at the same commit, checks it out in a temporary
  detached worktree under `.temp/prod-export/` and runs that commit's own `export.sh` there
  with the internal `--production-worktree` flag. That step refuses to run anywhere but a
  detached checkout under `.temp/prod-export/`, and refuses to build unless the tree is
  clean, `HEAD` is exactly `v<VERSION>`, and origin's tag and `production` both resolve to
  `HEAD`. The bundle is staged under `release_manager/build/prod_release/` as before, only if
  its manifest says `stable`, the tag's version and commit, and `git_dirty: false`. The
  worktree is removed on success, failure and Ctrl-C. Because each export runs its own
  tag's scripts, the first production export through this flow is the first release cut
  after this change; a tag cut earlier has the old scripts and is refused.
- **APKs.** With `--with-apk`, and for status.sh → Exports → Build + ship APKs → production,
  the worktree also gets what the APK build reads but Git does not track:
  `keystore.properties`, the files in `keystore/` and `local.properties` are linked from this
  checkout's `frontend_stack_ts/android/` (each must be ignored at the tag, so the tree stays
  clean), and `npm ci` installs `packages/contracts` and `frontend_stack_ts` from the tag's
  lockfiles. Standalone production APKs are built from production's tip the same way.
- **Deploy.** `deploy.sh --prod` refuses a version with `-`, a `git_sha` that is not 40 hex
  characters, and any `git_dirty` other than the boolean `false` (a missing value, `null` or
  the string `"false"` is refused). In one live `git ls-remote` read, the bundle's `git_sha`
  must equal both origin's `production` tip and origin's `vX.Y.Z` tag (peeled). Neither
  `origin/main` nor ancestry is compared, and nothing is pushed after a deploy.
- **Rollback.** `rollback.sh --prod` is not blocked by any of this and does not move
  `production`. After a rollback, `production` still names the newer release; the fix goes
  out as a newer release tag pushed to `production`.
- **Dashboard.** `status.sh --status` shows production's tip, read live from origin, next to
  the version the production stack runs, and says when the newest release tag is not on
  `production` yet.

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

Migration 073 (SIP early exit) is not such a boundary, but an images-only rollback to
v0.16.2 after it is degraded for any client with an early exit (DEC-59). No money row or
record is lost:

- The v0.16.2 admin app cannot load that client's maturity payout list at all, so no
  payout of that client, maturity or early exit, can be marked paid or failed until the
  roll-forward.
- v0.16.2 lets an early-closed SIP schedule be reopened. After the roll-forward, a second
  early exit on that schedule is refused with `409 STATE_CONFLICT` and writes nothing.
- An early-exit email still queued at the rollback is dead-lettered by the v0.16.2 email
  worker, which has no `sip_early_exit` template (the same case as `finding-26`), and is not
  re-sent after the roll-forward. The in-app notice is not affected.

Migration 074 (payout transfer reference no longer asked for, DEC-61 UQ-2 and DEC-69) is
expand-only and not a boundary: it relaxes the `withdrawal_operations` paid-row check so a
paid payout may carry no reference, which every existing row already satisfies. The server
still stores a reference a released admin app sends. The previous release runs against it
unchanged, still asks for a reference, and returns `transferReference: null` for a payout
paid without one, which every released admin app parses. Admin builds up to v0.18.0 show
"Awaiting transfer confirmation" under the `paid` state for such a payout; they hide the
outcome form once a payout is not pending, so nothing can be recorded twice. During an
images-only rollback to a backend from before 074 (for example v0.17.0 or v0.18.0):

- The new admin APK never sends a reference, so that backend refuses every Paid with
  `400 VALIDATION_FAILED` and writes nothing. Mark payouts paid from the rolled-back admin
  web or an older admin APK until the roll-forward.
- A held payout outcome saved by the new admin web carries no reference, so a rolled-back
  v0.18.0 admin web shows "Held request not readable" for it (v0.17.0 keeps no held writes
  and ignores it). Check the payout list before starting a new attempt.

Payout outcome dates (0.18.1) add only the route `GET /v1/admin/clients/{userId}/withdrawal-payout-outcomes`, with no migration: older admin apps never call it and every existing payout response keeps its shape, and a new admin app against a backend without it gets `404`, so its paid or failed payout cards say "Paid date unavailable" or "Failure date unavailable" while the outcome form keeps working.

From 0.18.1 the admin app sends the fund terms version it started from as the
`expectedVersion` query parameter of `POST /v1/admin/funds/{fundId}/versions`, and the
backend refuses a stale one with `409 STATE_CONFLICT`. Earlier backends ignore the query
string, so after an images-only rollback a newer admin APK still publishes terms, checked
only by its own re-read of the fund before sending, as in 0.18.0. A publish that reached
the server and was left Not confirmed across a rollback or roll-forward stays Not confirmed
on Check again, because the two backends hash the request differently, so check the fund's
versions by hand.

From 0.18.1 the backend also honours the `If-Match` fund version that every admin app since
v0.15.4 sends with `PATCH /v1/admin/funds/{fundId}` (publish, pause, archive): a strong `"n"`
or weak `W/"n"` that is not the fund's current version is refused with `409 STATE_CONFLICT`,
while `*`, a list or any other unreadable value is not checked, as before. A terms publish by
another admin also moves that version, so an older page's pause or archive is refused too.
Admin apps v0.15.4 to v0.17.1 show the refusal as "This fund changed while you were editing.
It has been reloaded", but they do not reload, and v0.18.0 has no reload button on its
refusal line, so a retry is refused again until the admin refreshes the page or reopens the
app. Earlier backends ignore the header, so after an images-only rollback a stale change is
again bounded only by the allowed transitions. The header is not part of the request hash,
so a held change still replays across either move.

Migration 075 (growth emails, DEC-72, 0.18.3) is expand-only and not a boundary: it re-adds
the `email_deliveries` template check with the new key `investment_growth`, which every
existing row already satisfies, and the previous release never writes that key. From 0.18.3
a one-investor growth adjustment, a collective growth commit and a monthly value update
queue one `investment_growth` email per active client and fund, in the same transaction as
the ledger rows; suspended, closed and erased clients get none. No API response or
notification kind changes. Released admin apps list such a delivery under its raw key
`investment_growth` and cannot filter by it. The email-deliveries filter accepts the key from
0.18.3, so a newer admin app that filters by it against an earlier backend gets a refused
request.

**Deploy the API and the email worker together**, as `_boe_deploy.sh` does: an email worker
from before 0.18.3 has no `investment_growth` template and permanently dead-letters such an
email (the `finding-26` case). During an images-only rollback to a release before 0.18.3, a
growth email still queued at the rollback is dead-lettered and not re-sent after the
roll-forward, and growth writes made while the earlier release runs send no email, then or
later. The ledger rows and the in-app notice are not affected.

Migration 077 (recording categories, DEC-75, 0.18.3) is expand-only and not a boundary: it
adds the append-only `client_value_entry_categories` table, which marks a recorded
investment as one-time beside its ledger entry, and re-adds the `email_deliveries` template
check with `sip_payment_recorded` and `one_time_investment_recorded`, which every existing row
satisfies and the previous release never writes. From 0.18.3 a recording linked to a SIP
schedule month (the admin form's SIP payment, the payment sheet, or a released admin app's
monthly investment with a month) queues `sip_payment_recorded`, and a recording sent with
the one-time category queues `one_time_investment_recorded`; a recording a released admin app
sends without a category still queues `investment_recorded`, which the worker keeps
rendering. Linking earlier recordings to SIP months and marking them one-time send no email.
No response shape changes: only the receipt and report `categoryLabel` text reads SIP payment
or One-time investment. The same deploy rule applies: an email worker from before 0.18.3
dead-letters the two new templates. After an images-only rollback the previous release
ignores the category table, so receipts show the earlier labels again; the links and
categories stay and reappear on roll-forward.

Migration 078 (investment breakdown, DEC-76, 0.18.4) is expand-only and not a boundary:
`078_investment_breakdown.sql` adds four append-only tables, `client_growth_parts` (the
per-investment parts of a growth entry), `client_earlier_growth_splits`,
`client_earlier_growth_split_parts` and `client_earlier_growth_split_entries` (a confirmed
split of a fund's earlier growth, its part per investment, and the growth entries it covers).
It changes no existing row, column or constraint, and 0.18.3 runs against it and ignores the
tables. No existing response changes: the client breakdown, the clean-up list, the split and
per-investment growth are new routes or new optional request fields. **Deploy the API and the
email worker together**: growth recorded per investment queues `investment_growth` v2, which
lists each investment's change and which an email worker from before 0.18.4 cannot render (the
`finding-26` case); the 0.18.4 worker still renders v1 rows queued earlier.

After the deploy, the client's Breakdown reads "Your breakdown is being prepared by BeOnEdge."
for every fund until admins have categorised that fund's recordings, corrections included, as
SIP payments or one-time investments in the admin app, and confirmed the split of its earlier
growth where the fund holds more than one investment. Portfolio's own figures do not change.
Admins find the work from the Overview item "Investments to categorise", from Client values >
To categorise, and from the banner on the client page, which leads to the client's Ledger tab.
Categorising and confirming a split send no email. Until a client is done, the value sheet
lists them as "Categorise first" for a fund with more than one investment and leaves them out
of the batch, and a SIP early exit from a fund still being prepared is refused and writes
nothing.

Admin apps older than 0.18.4 cannot record growth for a client with more than one investment in
a fund. The server refuses the whole write with `403 AUTHORIZATION_DENIED`, and the app shows
"Update the admin app to record growth for clients with more than one investment in a fund.";
growth for a fund with one investment works as before. Install the 0.18.4 admin APK on every
admin phone before the next value update. The admin web is replaced by the deploy itself.

A SIP early exit now returns only that SIP's current value; one-time investments in the same
fund stay invested (amends DEC-41). With only the SIP in the fund, the amount is the same as in
0.18.3. Released admin apps show and send back the amount the server works out, so they need no
update for this. The email and the in-app notice say "the current value of your SIP". The
exit cancels the fund's maturity date only when nothing else in the fund holds value; otherwise
the date stays.

During an images-only rollback to 0.18.3 the four tables, the categories and the confirmed
splits stay. Clients lose the Breakdown, and an early exit returns the whole holding again.
Growth recorded while 0.18.3 runs is untargeted, which 0.18.3 allows for any fund, so after the
roll-forward a fund with more than one investment that took such growth reads "being prepared"
again, and the client is back under To categorise until an admin confirms a new split. A v2
growth email still queued at the rollback cannot be rendered by the 0.18.3 worker and is not
re-sent after the roll-forward; the ledger rows and the in-app notice are not affected. So
before an images-only rollback, wait until the email deliveries list shows no queued growth email.

Two host steps also ship with 0.18.4, under Host nginx + TLS: the
[default server](#default-server-0184) that refuses unknown hosts, and the
[Grafana root URL](#grafana-root-url-0184).

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
| `admin-prod.tailscale.conf` | `sites-available/boe-admin-prod-tailscale` |
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

The one-time statement page (Phase H, migration 070) needs no nginx change. The APK
opens `https://<host>/api/v1/public/statement-links/<token>` in the phone's browser,
built from its configured API base and the contract path; the general `/api/` location
(`boe_general`) proxies it. The backend answers HTML with `Cache-Control: no-store`,
`Referrer-Policy: no-referrer` and a script-free `Content-Security-Policy`. Two things
the site config does on top of that:

- `boe-security-headers.conf` adds `Referrer-Policy: strict-origin-when-cross-origin`
  after the backend's header, and browsers apply the last valid value. The page has no
  links or subresources, so no referrer leaves it either way. A location with no
  `add_header` of its own still inherits the server-level headers; only a location that
  declares its own `add_header` lines and does not include the snippet drops them, which
  would make `no-referrer` the effective value.
- The access log records the path, which carries the token. A token opens once and
  expires after `EMAIL_VERIFICATION_CODE_TTL_MS`, the lifetime password links use.

During maintenance this path answers the JSON maintenance body like every `/api/` path.

### Default server (0.18.4)

`boe-shared.conf` now also holds the box's default server for :80 and :443. A request whose
`Host` or TLS server name matches no `server_name` is refused: on :80 nginx closes the
connection (`return 444`), and on :443 it rejects the handshake (`ssl_reject_handshake`, nginx
1.19.4 or later), so no certificate is needed. Until now such a request got whichever site
loaded first: the production console's `.internal` redirect on :80 and the dev console's
certificate on :443. Hosts that a site names are unchanged.

nginx allows one default server per address and port. Check before installing:

```bash
sudo nginx -T 2>/dev/null | grep -n 'default_server'
```

- No output: install as below.
- Only Debian's stock site (`/etc/nginx/sites-enabled/default`, the "Welcome to nginx" page):
  remove its link in the same step with `sudo rm /etc/nginx/sites-enabled/default`. The file
  stays in `sites-available`.
- Any other site: stop. It belongs to the landing site or another tenant, and the maintainer
  decides which default wins.

After the ship step has staged the files (`nginx_ship.sh` prints the same commands):

```bash
sudo cp -a /etc/nginx /root/nginx-backup-$(date +%Y%m%dT%H%M%S)
sudo cp /srv/dev_stack/BOE_APP/NGINX/boe-shared.conf /etc/nginx/conf.d/boe-shared.conf
sudo cp /srv/dev_stack/BOE_APP/NGINX/admin.tailscale.conf /etc/nginx/sites-available/boe-admin-tailscale
sudo nginx -t && sudo systemctl reload nginx
```

If another default is still enabled, `nginx -t` fails with `a duplicate default server for
0.0.0.0:80` and nothing is reloaded. Restore the backup if anything else goes wrong.

Check it:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: app.beonedge.in' http://127.0.0.1/      # the app, as before
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: dev-app.beonedge.in' http://127.0.0.1/  # the dev app, as before
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: unknown.invalid' http://127.0.0.1/      # 000: empty reply, curl exit 52
openssl s_client -connect 127.0.0.1:443 -servername unknown.invalid </dev/null 2>&1 | grep -m1 'alert'   # SSL alert number 112
```

Then check through the Cloudflare tunnel, from outside the box: open `https://app.beonedge.in`
and `https://dev-app.beonedge.in`, and confirm a signup from beonedge.in still reaches
`POST /newuser`. The default server is only safe while cloudflared passes the app's own Host
header through (its default); if the tunnel sets another `httpHostHeader`, those requests are
now refused, so restore the backup and tell the maintainer. Then open both admin consoles from
a tailnet device and the client app from a phone.

`nginx_ship.sh` now prints its check against `app.beonedge.in`. A request for `beonedge.in`
itself prints `000` unless a site on this box serves that name: that is the refusal, not an
outage.

The admin console's TLS settings are now written in both `boe-shared.conf` (the default server)
and `admin.tailscale.conf`; change them together.

### Grafana root URL (0.18.4)

In `monitor_service/.env` on the VPS, set `GRAFANA_ROOT_URL` to the URL the browser actually
uses: `http://localhost:3000/` for the SSH tunnel in
[MS_GUIDE.md](release_manager/stacks/monitor_service/MS_GUIDE.md), or the dev console URL if
the `boe-monitor-grafana.conf` snippet serves Grafana. Then run `./ms_deploy.sh`, which also
loads the corrected alert rules.

## Admin consoles over Tailscale

The client apps are public: `dev-app.beonedge.in` for the dev build and `app.beonedge.in`
for production. The admin consoles are not. Each stack has its own browser console, and
each is reachable only from a device signed in to the tailnet:

| Type in the browser | Lands on | Stack | Served by |
| --- | --- | --- | --- |
| `admin.boe.dev.app.internal` | `https://beonedge-vps.tail4ea2bc.ts.net` | dev (admin 47422, backend 47423) | the VPS's own Tailscale node and `admin.tailscale.conf` |
| `admin.boe.app.internal` | `https://boe-prod-admin.tail4ea2bc.ts.net` | production (admin 47412, backend 47413) | a separate Tailscale container, `boe-prod-admin`, and `admin-prod.tailscale.conf` |

The `.internal` names only redirect, over plain HTTP, to the HTTPS Tailscale names. Two
browser rules make this necessary:
- The console's `__Host-` session cookies are refused on plain HTTP.
- No public authority issues a certificate for a `.internal` name, while `tailscale cert`
  and `tailscale serve` issue real ones for `*.ts.net`.

Each stack needs its own Tailscale name, because cookies are scoped to a host, not a port:
two consoles on one name would share sessions.

Why production's node is a container:
- A userspace `tailscaled` forwards any port it does not serve to the loopback of the
  machine it runs on.
- Run on the VPS itself, it would open the backend, Postgres, SSH and every other
  loopback-only service to the tailnet.
- In its own container, that loopback is empty. The node reaches nginx only through the
  `boe_prod_admin_proxy` network (`10.251.47.0/24`), on `10.251.47.1:47491`.
- It is not part of the production stack, so an image rollback cannot take it down.

**Until these steps are done**, `admin.boe.app.internal` still reaches the dev console,
through the old redirect.

### One-time setup on the VPS

1. **Install both nginx configs.** `nginx_ship.sh` stages them under the stacks' `NGINX`
   folder and prints the `cp` and `ln -sfn` commands that install them. Run those for
   `boe-admin-tailscale` and `boe-admin-prod-tailscale`, then:

   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

   - `admin.tailscale.conf` now answers `admin.boe.dev.app.internal`, no longer
     `admin.boe.app.internal`.
   - `admin-prod.tailscale.conf` redirects `admin.boe.app.internal`.
   - It also listens on port 47491 for the production console, accepting only
     `10.251.47.0/24`.

   Then let the container's bridge, and nothing else, through ufw to that listener:

   ```bash
   sudo ufw allow in on boepadmin0 from 10.251.47.0/24 to 10.251.47.1 port 47491 proto tcp
   ```

   The bridge `boepadmin0` appears when the container's network is created in step 3. The
   rule can be added before that.

2. **Prepare the tailnet.** In the Tailscale admin console:
   - Add the tag `tag:boe-prod-admin` and an access rule that lets only operator devices
     reach it, and only on port 443. Access rules only ever grant access, so:
     - add the rule to the existing `acls` array, never replacing the array, or the dev
       console and SSH over the tailnet stop working;
     - remove or narrow every existing rule whose `dst` covers the tag, including the
       default `"dst": ["*:*"]`, or the new rule restricts nothing.

     For example, in the policy file:

     ```json
     "tagOwners": { "tag:boe-prod-admin": ["autogroup:admin"] },
     "acls": [ { "action": "accept", "src": ["autogroup:admin"], "dst": ["tag:boe-prod-admin:443"] } ],
     "tests": [
       { "src": "<an operator>", "accept": ["tag:boe-prod-admin:443"], "deny": ["tag:boe-prod-admin:22", "tag:boe-prod-admin:47413"] },
       { "src": "<a non-operator>", "deny": ["tag:boe-prod-admin:443"] }
     ]
     ```

     Fit `src` to who operates the console, and fill the `tests` with real users or
     devices. Tailscale refuses a policy whose tests fail, which is the proof that the
     rule works. This rule is required, not optional: the container is the first fence,
     and the rule is the second.
   - Create a one-off, non-ephemeral auth key with that tag. Tagged nodes do not expire, so
     the console will not drop off the tailnet after the key-expiry period.
   - Never put the key in the repository or in a stack `.env`.

3. **Start the container.** Copy `release_manager/tailscale/docker-compose.boe-prod-admin.yml`
   and `serve.json` to a folder on the VPS, for example
   `/srv/dev_stack/BOE_APP/admin_tailnet/`. Next to them, create a `.env` that holds only
   `TAILSCALE_IMAGE=tailscale/tailscale:<version>`, pinned to a released version, never
   `latest` or `stable`. The `serve` configuration needs Tailscale 1.52 or newer. Then, in
   that folder:

   ```bash
   TS_AUTHKEY=<the key> docker compose -f docker-compose.boe-prod-admin.yml up -d
   docker compose -f docker-compose.boe-prod-admin.yml exec tailscale tailscale serve status
   ```

   - The key is used once. Later starts reuse the state in the
     `boe_prod_admin_tailnet_state` volume.
   - `serve` gets the `boe-prod-admin.tail4ea2bc.ts.net` certificate itself.
   - If the tailnet shows the name as `boe-prod-admin-1`, an old node holds the name.
     Remove that node and restart the container.

4. **Allow the production console's origin.** In the production stack's `.env`, set
   `WEB_ORIGIN_ALLOWLIST=https://app.beonedge.in,https://boe-prod-admin.tail4ea2bc.ts.net,https://localhost`.
   `admin.beonedge.in` was never served and can go. Then, from the build machine, redeploy
   the version that is running, so the backend reads the value:

   ```bash
   ./release_manager/deploy.sh --prod --force
   ```

   `deploy.sh` ships the newest staged bundle. If a newer one is staged, add
   `--bundle <the deployed bundle>`. The confirmation prompt shows which version it will
   ship.

### On each device

Add both names to the hosts file. `100.122.85.101` is the VPS's Tailscale address
(`beonedge-vps`):

```
100.122.85.101 admin.boe.dev.app.internal
100.122.85.101 admin.boe.app.internal
```

- The `.ts.net` names need no hosts entry; MagicDNS resolves them on tailnet devices.
- Type the names with `http://` the first time. A browser may otherwise try `https://` or
  run a search.

### Check it

- `http://admin.boe.dev.app.internal` must land on `https://beonedge-vps.tail4ea2bc.ts.net`
  with dev data.
- `http://admin.boe.app.internal` must land on `https://boe-prod-admin.tail4ea2bc.ts.net`
  with production data.
- The address bar and the data tell the two apart. `/api/health/` and `/api/metrics` are not
  reachable from a browser on either console. `/api/v1/health` answers only
  `{"status":"ok"}` on both, so it cannot tell them apart.
- From an operator device, `nc -vz -w 5 boe-prod-admin.tail4ea2bc.ts.net 47413` must fail,
  and so must the same check on ports 5432 and 22. Only 443 answers. The container refuses
  those ports even without the access rule, so the policy `tests` in step 2 are what prove
  the rule.
- A browser off the tailnet must get nothing from either name.

### Known limits of the production console

- Every request reaches nginx from the container's address in `10.251.47.0/24`. So all
  production console users share one sign-in rate-limit bucket (5 per minute, burst 10).
- Which client address the backend records for those sessions has not been checked. It is
  the container's address, or the device's tailnet address if `serve` forwards one.
- `/api/metrics` and `/api/health/` answer 404 on the production console.
- The dev console keeps per-device addresses, because Tailscale traffic reaches its nginx
  directly.

## Maintenance mode and required updates

A deploy or rollback raises a maintenance flag for its stack, `<stack_dir>/maintenance/active`,
and installs the stack's `maintenance.html` (shipped in every bundle) as
`<stack_dir>/maintenance/index.html`. While the flag exists, the site configs in
`release_manager/nginx/` answer every web-app request with that page and a 503, and every API
request with a 503 JSON error `SERVICE_MAINTENANCE` plus the header `X-BOE-Maintenance: 1` and
`Retry-After: 60`. APK downloads, `/.well-known/assetlinks.json`, and the localhost health probes
keep working, so a client can still download an update. Apps from v0.15.0 recognize the header
and show a "We are updating BeOnEdge" screen that checks again every 30 seconds and closes by
itself; older APKs show their generic temporary error. When that screen closes, the app checks for
a newer APK straight away instead of waiting for its usual ten-minute interval.

The APKs run at the origin `https://localhost` and call the API cross-origin, so the maintenance
reply carries its own CORS headers: it echoes the `Origin` only for the hosts listed in the
`$boe_maintenance_cors_origin` map in `boe-shared.conf` (the app and admin hosts and
`https://localhost`), exposes `X-BOE-Maintenance` and `Retry-After`, and answers a preflight
`OPTIONS` with 204. Without those headers the WebView discards the 503 as a network failure and
the app never shows its maintenance screen, which is what the first v0.15 dev deploy showed. A new
app or admin host must be added to that map as well as to the backend's origin allowlist.

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

From 0.18.3, publishing app configuration asks the admin's password (DEC-74). The console
lists the changed keys, then calls `POST /v1/admin/auth/confirm-password`, which returns a
single-use confirmation valid for five minutes, bound to that admin, that session and the exact
changes reviewed; `PATCH /v1/admin/app-config` refuses a publish without it. Five wrong passwords
in fifteen minutes block that admin from publishing for up to fifteen minutes; the counter is per
API process and resets when the API restarts. Admin apps before 0.18.3 cannot publish app
configuration against a 0.18.3 backend: they show "Update the admin app to publish app config."
Migration `076_admin_step_up_confirmations.sql` is expand-only; the previous release ignores the
table. The maintenance-mode CORS reply in `release_manager/nginx/*.conf` now also allows the
`x-admin-confirmation` header, so install the updated site configs (see Host nginx) when deploying
0.18.3, or an admin APK publishing during maintenance sees a network failure instead of the
maintenance screen.

A deploy never raises the floor by itself. After deploying a release every client must install,
either send a required announcement from Admin, Send email, "App update to all clients" (it emails
every active client the official download link and publishes the new floor in the same step), or
publish `minimumSupportedVersion.android` set to that release's version (and, if wanted, a
`minimumSupportedVersion.message`) in App configuration yourself; until then older APKs only see
the optional "A newer BeOnEdge is available" sheet when they next check. A stack with no published
app configuration (`GET /v1/app-config` answers `config: null`) never shows the required screen.

## How admin and the APKs connect

- **Admin console in a browser**: one console per stack, reachable only over Tailscale
  (see "Admin consoles over Tailscale" below). It authenticates with HttpOnly cookies on
  the `web` session channel plus a CSRF synchroniser token.
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

`CLIENT_WEB_APP_URL` is optional. It is the client web app's bare https origin, for example
`https://app.beonedge.in` on production and `https://dev-app.beonedge.in` on development.
When it is set, the application approval, password invite (admin-created client) and
password-set app-download emails each add one line telling iPhone and computer users they
can open the BeOnEdge web app at that address, in both the plain-text and HTML bodies. When
it is unset or blank, those emails render exactly as before and nothing else changes. The
line is added by `email-worker` when it renders a message, never stored in the queued
payload, so it also appears in mail queued before the key was set and disappears from
queued mail once it is removed. Any other value, such as `http://`, a path, a query or a
fragment, makes the backend and every worker refuse to start, the same as other malformed
settings. Compose passes it to every backend service; add it to each stack's `.env` by hand,
because a deploy never overwrites that file.

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
`release_manager/docs/Completed/existing-client-impl/06-sequencing-and-migrations.md`) and states the
rollback implication in the release notes.

## Scaling roadmap

Images are built locally and shipped as tarballs over SSH. The path to scale:

1. **CI builds from a tag**, so provenance is the tag rather than a build machine.
2. **A registry** (e.g. GHCR) receives those images instead of producing tarballs.
3. **`compose pull` deploy** replaces `docker load` and the tar upload; rollback becomes
   pulling the previous tag, with the snapshot flow above unchanged.
4. **A staging stack** takes every tag first; promotion re-uses the same image.

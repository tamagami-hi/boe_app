# 07 — Tooling, deployment and documentation

## 1. The nginx rate-limit gap — the security finding

*Class: BROKEN / STUCK. Severity: highest in this document. **Requires an nginx reload to take
effect.***

All three site configs gated login brute-force with:

```
location ~ ^/api/v1/auth/(native|web)/login$ {
    limit_req zone=boe_auth burst=10 nodelay;
```

The backend serves **four** login endpoints:

| Endpoint | Registered at | Matched by the old regex? |
| -------- | ------------- | ------------------------- |
| `/v1/auth/native/login` | `nativeAuthRoutes.ts:47` | yes |
| `/v1/auth/web/login` | `webAuthRoutes.ts:41` | yes |
| `/v1/auth/client/web/login` | `clientWebAuthRoutes.ts:50` | **no** |
| `/v1/auth/admin/native/login` | `adminNativeAuthRoutes.ts:69` | **no** |

The two unmatched ones fell through to `location /api/` and were limited by `boe_general` at
**20 r/s** instead of `boe_auth` at **5 r/m** — a 240× weaker limit, on the browser client's login
and on the admin APK's login.

Two things made this invisible. The regex was written for the pre-split auth surface, and neither
D-052 (which added the `client_web` channel) nor D-053 (which added `admin_native`) mentions nginx
at all — each was reasoned about entirely inside the application. And because
`rate_limit_windows` is a dead table and `http/rateLimit.ts` is in-process and per-process
([06](06-persistence-audit.md) §1), the nginx zone is the *only* real brute-force control on these
endpoints.

Widened in all three configs to:

```
location ~ ^/api/v1/auth/(?:native|web|client/web|admin/native)/login$ {
```

Non-capturing because no capture is referenced. **UNVERIFIED** — needs, on the VPS:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Until that reload, the two endpoints remain at 20 r/s.

A durable follow-up worth considering: nothing connects the set of registered login routes to this
regex. A guard could assert that every `application.post("/v1/auth/…/login")` in
`backend_controller/src/routes/` appears in the `boe_auth` pattern of all three configs. Not built
here — it would be the fourth new guard in one change set — but it is the only thing that stops
this recurring the next time a session channel is added.

## 2. A readiness probe that never ran

*Class: STALE, kept alive by a test that checked for text rather than use.*

Both stack compose files declared:

```
x-worker-health: &worker-health
  test: ["CMD-SHELL", "test -f /tmp/boe-worker-ready"]
  interval: 5s
```

and **no service aliased `*worker-health`**. All four workers use their own heartbeat-age anchors
(`*payments-worker-health` and siblings), which run `dist/scripts/check-worker-health.js <worker>
<maxAgeSeconds>` against the `worker_heartbeats` table. So:

- the file-based probe never executed;
- `rm -f /tmp/boe-worker-ready` and `touch /tmp/boe-worker-ready` in three worker commands were
  writes nothing read.

It survived because `runtime_contract.test.sh` asserted the anchor's **literal text** was present
in the compose file, and that the `touch`/`rm -f` strings were present in the worker blocks — never
that either was used. The heartbeat assertion in the same test matched
`healthcheck: \*[a-z0-9_-]+-worker-health`, which the real anchors satisfy, so the test passed
without noticing the orphan.

That is the same failure mode as the link-map defect in [04](04-frontend-dead-code.md) §8 and, in a
different register, the `SEED_ADMIN_*` mismatch in [05](05-configuration-audit.md) §3: **a
declaration and a consumer that were never checked against each other.**

Removed the anchor and both side effects from both compose files, and rewrote the three
assertions to pin the heartbeat protocol that actually runs. The heartbeat anchors, thresholds and
`check-worker-health.js` calls are untouched.

**TESTED** — `runtime_contract.test.sh` passes; 15/15 release_manager tests pass; `verify.sh`
108/0/1.

**Note:** this edits shipped compose files, so it takes effect on the next deploy. Behaviour is
unchanged either way, since the removed probe never ran.

## 3. Dead scripts removed

**`test_e2e/faq-debug.mjs`** — 16 lines, hardcoded `http://localhost:5174` and hardcoded
credentials, printing the primary-nav link texts. A one-off probe from a single bug hunt.
Referenced by nothing: not `package.json`, not CI, not any document.

**`test_e2e/frontend-ts-shots.mjs`** — 101 lines, a Playwright screenshot walker. Referenced by
nothing, *including* `DEPLOY_AND_TEST_RUNBOOK.md`, which does reference its four siblings.

The second is **STALE by construction**, and the evidence is quantitative. It iterates a
**hand-maintained** list of 20 paths. `frontend-ts-audit.mjs` reads the two route manifests
directly, walks multiple viewports, and screenshots — against **45** manifest routes. A
hand-maintained route list beside a manifest-derived one is guaranteed to drift, and had.
`frontend-ts-audit.mjs` is authoritative and documented; this was its superseded predecessor.

**`release_manager/lib/repo_sync.sh` → `repo_sync_notice()`** — 26 lines, zero callers.
`status.sh` renders the `RS_*` globals inline instead. `repo_sync_eval`, its sibling, has four
callers and stays. `repo_sync.test.sh` passes.

**The commented `/ws/` WebSocket blocks** — 11 lines in each of the three site configs, plus the
now-unreferenced `map $http_upgrade $connection_upgrade` http-level plumbing in `boe-shared.conf`
that existed solely to serve them. `grep -rn "websocket\|/ws\|Upgrade"` across
`backend_controller/src` returns nothing. Also a direct violation of the root `README.md`'s
prohibition on commented-out code.

**15 stale `BOE_APP/` rules** from `release_manager/.gitignore` — that directory does not exist;
the layout is `stacks/<stack>/`.

## 4. Git hygiene

`git ls-files` confirms **no build output is tracked**: `backend_controller/dist`,
`backend_controller/coverage`, `packages/contracts/coverage`, `frontend_stack_ts/android/build`,
`android/.gradle`, `emu/out`, `release_manager/build`. `release_manager/{state,recent_builds,rollback}`
contain only their `.gitkeep`.

One gap, fixed: **`frontend_stack_ts/.kotlin` was untracked *and* unignored** — matched by no rule,
so it appeared in `git status` as an accidental-commit risk. Added `.kotlin` and `android/.kotlin`
to `frontend_stack_ts/.gitignore`; `git check-ignore -v` now confirms it.

Two untracked accumulations, correctly ignored, reported for housekeeping only:
`release_manager/build/` is **272 MB** across three dev bundles, and `emu/out/` is **34 MB**. Do not
prune `emu/out` blindly — `export.sh` reads APKs from it, so it is a real pipeline input, and its
four captured logs are the evidence base for the open Entry 032/041 payment diagnoses.

**`kimi-api-key.txt`** at the repo root: 73 bytes, untracked, gitignored, and `git log --all`
confirms it was **never committed**. Contents deliberately not read. It is correctly contained but
still a live credential on disk — **recommend rotating it and removing the file**. It was already
flagged in `complexity-audit-2026-08-26/FILE_DISPOSITION_AND_ROADMAP.md` and is still there.
`.codex` is a 0-byte marker; harmless.

## 5. Documentation corrected

### `DEPLOY.md` — rewritten in full

This was the worst material in the repository, and dangerous specifically **during an incident**,
which is when it would be read.

| Claim | Reality |
| ----- | ------- |
| Everything orchestrated from `release_manager/BOE_APP/` (9 references) | That directory **does not exist**. The layout is `release_manager/stacks/<stack>/`, with every remote path from `paths.json` schema 3 |
| A `--ship` DB-sync feature with `--skip-db-sync`, `--db-force-restore`, `--skip-db-restore`, `SHIP_HOST`, `db_records/`, `DB_RECORDS_KEEP` | **None of these exist** in `deploy.sh` or `rollback.sh`. Real flags: `--dev/--prod/--monitor`, `--bundle`, `--ship-only`, `--yes`, `--force`, `--skip-checks`; and for rollback `--list`, `--to`, `--latest`, `--restore-db` |
| DB restore is the default; opt out with `--skip-db-restore` | **Inverted.** It is opt-**in** via `--restore-db`, which is destructive and requires typing `RESTORE` at the remote prompt |
| — | The four workers were **absent entirely** (`grep worker DEPLOY.md` returned nothing) while both compose files run payments, email, collections and sips |
| Install nginx as `sites-available/beonedge.conf` | Contradicts `lib/nginx_ship.sh`, which maps `app.beonedge.in.conf → sites-available/boe-app`. Following the doc installs a second, differently-named vhost beside the shipped one |
| Backend public at `:47502` | 47502 is the **container** port. Host ports are 47413/47423 (backend), 47411/47421 (app SPA), 47412/47422 (admin SPA) |

An operator following the old document during an incident would pass unrecognised flags and
**misjudge whether data was being rewound**. That is why this was rewritten rather than patched.

The replacement documents the three stacks and `paths.json` authority, the real nine-service
topology including `migrate`, `seed` and `redis`, the four workers with their real heartbeat
thresholds (120/60/180/900 s), the real flag sets, opt-in DB restore, the `nginx_ship` mapping
table, the four rate-limit zones and the four-endpoint `boe_auth` regex, the ES256 key names with
`npm run keys:generate`, and `envPassthrough`'s two-directional guarantee. Every figure was checked
against source.

Including one of my own errors, caught before commit: I first wrote that nginx restricts `/metrics`
to loopback. There is **no `/metrics` location in any nginx config** — the guard is
`isPrivateRequest` inside the application (`runtime/metrics.ts:50`), which admits loopback, the
Docker bridge and RFC1918 ranges so the monitoring stack can scrape it. Corrected.

### `CLAUDE.md`

Three sections described the **pre-TypeScript** backend. Verified absent from the tree:
`src/server.js`, `shared/`, `src/db/store.js`, `scripts/migrate.js`, `scripts/start-dev.js`, and
the npm scripts `routes`, `db:check`, `migrate:status`, `authz:admin-rbac`, `authz:403`.

An agent reading it would have hunted for a plain `node:http` server, a `shared/routes/index.js`
registry, a `db/store.js` abstraction and `scripts/check-*.js` guards — none of which exist.

Rewritten: the backend command block; the "Backend architecture" section (Fastify,
`runtime/composition.ts` as composition root with four config-gated registrations, the real layer
map, relay providers, the four worker entrypoints, and the paise-string / server-authoritative
settlement invariants); the test-runner paragraph (the guards are Vitest tests, not `authz:*`
scripts); the "no root compose file" fact; the PhonePe-egress half-sentence, which `380ba1a`
retired; the env paragraph (no root `.env`; the real ES256 key names); and the frontend "CSS
Modules" claim — **zero `*.module.css` files exist**, it is Tailwind v4 per D-033.

### `WORKFLOW.md`

`release_manager/BOE_APP/current-version.json` → the per-stack `version_file` named in
`paths.json`. The `authz:*` CI claim → the three real `ci.yml` jobs (`backend`, `frontend`,
`contracts`), each running that unit's `npm run check`, with the added note that
`release_manager/tests/*.test.sh` and `verify.sh` are **not in CI** and must be run by hand.

`WORKFLOW.md:23` was deliberately left: it is an explicit historical note about `frontend_stack/`'s
old name, correctly labelled as such.

### `PRODUCT.md`

Not wrong about its subject, but wrong about where it sits. It specifies the **out-of-repo AWS
marketing site** and forbids invest/SIP/portfolio/returns copy there — while sitting unqualified at
the root of the repository that *is* the invest/SIP/portfolio product.

A scope block was added at the top stating what it governs and that the education-only boundary
applies to the public site alone. Not moved or deleted: relocating a product document is the
maintainer's call.

### Already correct — two doc claims that were themselves stale

- `.github/workflows/ci.yml` does **not** reference the deleted `frontend_stack/`. Its `frontend`
  job points at `frontend_stack_ts`. The blueprint's B6 blocker is closed; the claim that it is
  open was the stale item.
- `CLAUDE.md` no longer mentions razorpay, so
  `06-legacy-dead-duplicate-code.md:246`'s claim that it does is stale. The only razorpay reference
  in the tree is the intentional deletion guard at `legacy-deletion.guard.test.ts:46`, which is
  working as designed.

## 6. `packages/contracts`

`npm run check` passes: OpenAPI validates, and `check-frontend-contract-bypass.mjs` reports
"No contract bypasses. 101 contracted operations, all reachable through the generated client."

Confirmed that `check-frontend-contract-drift.mjs` was genuinely replaced — `scripts/` holds only
`check-frontend-contract-bypass.mjs` and `generate-openapi.ts`, and git history shows the drift
checker removed in the `frontend_stack` retirement commit. **No stale checker remains.** D-030 is
accurately reflected.

Two gaps reported, not changed:

**Six uncontracted v1 mutations.** `POST /v1/admin/users/:userId/{suspend,reinstate,close}` and
`POST /v1/client/sips/:sipPlanId/{pause,resume,cancel}` are registered and served but absent from
`packages/contracts`. `POST /newuser` and the two PhonePe webhook routes are also uncontracted, but
defensibly so — the contract is the app-facing v1 surface and those are server-to-server. The six
above are ordinary v1 operations a frontend can call.

**Error codes with no frontend handler.** `CURSOR_INVALID`, `IDEMPOTENCY_KEY_REUSED`,
`IDEMPOTENCY_IN_PROGRESS`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE` are emitted by the backend
and handled nowhere in the frontend. `CURSOR_INVALID` is the notable one: `decodeCursor` fails
closed on a filter-hash mismatch, so any filter change must restart pagination, and a client that
does not handle it shows an error where it should silently re-page.

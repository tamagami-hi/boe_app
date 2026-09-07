# 006 — Tooling and documentation

## The rate limit that had stopped covering half its surface

All three nginx site configs gated login brute-force with:

```
location ~ ^/api/v1/auth/(native|web)/login$ {
    limit_req zone=boe_auth burst=10 nodelay;
```

The backend serves four login endpoints. Two do not match that regex:
`/v1/auth/client/web/login` (added by D-052) and `/v1/auth/admin/native/login` (added by D-053). Both
fell through to `location /api/` and got `boe_general` at **20 r/s** instead of `boe_auth` at
**5 r/m**.

240× weaker, on the browser client's login and on the admin console's own login.

Two things made it invisible. The regex was written for the pre-split auth surface, and **neither
D-052 nor D-053 mentions nginx** — each was reasoned about entirely inside the application, which is
exactly where a transport-layer control is not.

It also matters more than it first looks. `rate_limit_windows` is a dead table and
`http/rateLimit.ts` is in-process and per-process, so application-level limits do not survive a
restart and are not shared between replicas. **The nginx zone is the only real brute-force control on
these endpoints.**

Widened in all three configs. This is **inert until nginx is reloaded on the VPS** —
`sudo nginx -t && sudo systemctl reload nginx`.

A durable follow-up is described in `../07-tooling-deployment-docs.md` §1: nothing connects the set
of registered login routes to that regex. A guard asserting every
`application.post("/v1/auth/…/login")` appears in the `boe_auth` pattern of all three configs is the
only thing that stops this recurring next time a session channel is added. Not built here — it would
have been the fourth new guard in one change set.

## The readiness probe that never ran

Both stack compose files declared:

```
x-worker-health: &worker-health
  test: ["CMD-SHELL", "test -f /tmp/boe-worker-ready"]
```

and **no service aliased `*worker-health`**. All four workers use heartbeat-age probes instead,
running `check-worker-health.js <worker> <maxAge>` against `worker_heartbeats`. So the file probe
never executed, and the `rm -f` / `touch /tmp/boe-worker-ready` in three worker commands were writes
nothing read.

It survived because `runtime_contract.test.sh` asserted the anchor's **literal text** was present in
the compose file, and that the `touch`/`rm -f` strings were present in the worker blocks — never that
either was *used*. The heartbeat assertion in the same test matched
`healthcheck: \*[a-z0-9_-]+-worker-health`, which the real anchors satisfy, so the test passed
without noticing the orphan.

That is the third instance in this audit of the same failure mode — a declaration and a consumer that
were never checked against each other. The other two: the nginx regex above, and the `SEED_ADMIN_*`
mismatch in task 004. It is the single most productive pattern to look for in this repository.

Removed the anchor and both side effects, and rewrote the three assertions to pin the heartbeat
protocol that actually runs.

## Dead scripts

`test_e2e/faq-debug.mjs` — 16 lines, hardcoded localhost and hardcoded credentials, printing nav link
texts. A one-off probe from a single bug hunt, referenced by nothing.

`test_e2e/frontend-ts-shots.mjs` — 101 lines, referenced by nothing including
`DEPLOY_AND_TEST_RUNBOOK.md`, which *does* reference its four siblings. It is STALE **by
construction**, and the evidence is quantitative: it walks a **hand-maintained** list of 20 paths,
while `frontend-ts-audit.mjs` reads the two route manifests directly — **45** routes — across multiple
viewports, and screenshots too. A hand-maintained route list beside a manifest-derived one will drift,
and had.

`repo_sync_notice()` — 26 lines, zero callers; `status.sh` renders the `RS_*` globals inline.
`repo_sync_eval`, its sibling, has four callers and stays.

The commented `/ws/` blocks in three configs, plus the `$connection_upgrade` map in
`boe-shared.conf` that existed solely to serve them. No websocket code exists in the backend. Also a
direct violation of the root `README.md`'s ban on commented-out code.

Fifteen `BOE_APP/` rules in `release_manager/.gitignore` for a directory that does not exist.

## Git hygiene

No build output is tracked anywhere — verified with `git ls-files` across all nine candidate paths.
One real gap: `frontend_stack_ts/.kotlin` was untracked **and** unignored, matched by no rule, so it
showed in `git status` as an accidental-commit risk. Fixed.

Two untracked accumulations reported for housekeeping only: `release_manager/build/` at 272 MB and
`emu/out/` at 34 MB. **Do not prune `emu/out` blindly** — `export.sh` reads APKs from it, so it is a
real pipeline input, and its four captured logs are the evidence base for the open Entry 032/041
payment diagnoses.

`kimi-api-key.txt`: 73 bytes, untracked, gitignored, and `git log --all` confirms never committed.
Contents deliberately not read. Correctly contained but still a live credential on disk — rotate and
remove. It was already flagged in the 2026-08-26 complexity audit and is still there.

## DEPLOY.md was the worst material in the repository

Not stale in the ordinary sense — actively dangerous, and dangerous **specifically during an
incident**, which is when it would be read.

- It orchestrated everything from `release_manager/BOE_APP/`, referenced nine times. **That directory
  does not exist.**
- It documented a `--ship` DB-sync feature with `--skip-db-sync`, `--db-force-restore`,
  `--skip-db-restore`, `SHIP_HOST`, `db_records/` and `DB_RECORDS_KEEP`. **None of them exist.**
- It **inverted the DB-restore default**: it said restore happens by default and you opt out with
  `--skip-db-restore`. The code makes it opt-**in** via `--restore-db`, which is destructive and
  requires typing `RESTORE` at the remote prompt.
- It omitted all four workers. `grep worker DEPLOY.md` returned nothing, while both compose files run
  payments, email, collections and sips.
- Its nginx install path contradicted `lib/nginx_ship.sh`, so following it installs a second,
  differently-named vhost beside the shipped one.
- It published the container port 47502 as the public backend port.

An operator following it would pass unrecognised flags and **misjudge whether data was being
rewound**. That is why it was rewritten rather than patched.

The replacement documents the three stacks and `paths.json` authority, the real nine-service topology,
the four workers with their actual heartbeat thresholds, the real flag sets, opt-in DB restore, the
`nginx_ship` mapping table, the four rate-limit zones and the four-endpoint `boe_auth` regex, the ES256
key names, and `envPassthrough`'s two-directional guarantee. Every figure checked against source.

Including one of my own: I first wrote that nginx restricts `/metrics` to loopback. There is **no
`/metrics` location in any nginx config** — the guard is `isPrivateRequest` inside the application.
Caught and corrected before commit.

## CLAUDE.md described a backend that no longer exists

Three sections were pre-TypeScript. Verified absent: `src/server.js`, `shared/`, `src/db/store.js`,
`scripts/migrate.js`, `scripts/start-dev.js`, and the `routes` / `db:check` / `migrate:status` /
`authz:admin-rbac` / `authz:403` scripts. An agent reading it would have hunted for a plain
`node:http` server, a `shared/routes/index.js` registry and `scripts/check-*.js` guards — none of
which exist.

Rewritten against source. Also corrected: the PhonePe-egress claim (`380ba1a` retired it), the "two
`.env` files including project root" claim (there is no root `.env`), the symmetric token-secret
names, and "styled with CSS Modules" — **zero `*.module.css` files exist**; it is Tailwind v4 per
D-033.

`WORKFLOW.md` got two corrections: the version-file path, and the `authz:*` CI claim replaced by the
three real `ci.yml` jobs, plus a note that `release_manager/tests/*.test.sh` and `verify.sh` are not
in CI. Its line 23 was left alone — it is an explicit historical note about `frontend_stack/`'s old
name.

`PRODUCT.md` got a scope block. It specifies the out-of-repo AWS marketing site and forbids
invest/SIP/portfolio copy there, while sitting unqualified at the root of the repository that *is*
the invest/SIP product. Not moved — relocating a product document is the maintainer's call.

## Two doc claims that were themselves the stale thing

Worth recording because the blueprint still lists them as open:

- `.github/workflows/ci.yml` already points its `frontend` job at `frontend_stack_ts`. The B6
  blocker is closed; the claim that it is hardcoded to the deleted tree is what is stale.
- `CLAUDE.md` no longer mentions razorpay, so `06-legacy-dead-duplicate-code.md:246`'s claim that it
  does is stale. The only razorpay reference in the tree is the intentional deletion guard at
  `legacy-deletion.guard.test.ts:46`, working as designed.

## What to check next

**`sudo nginx -t && sudo systemctl reload nginx` on the VPS.** Nothing else in this audit has a
security consequence that stays live until an operator acts.

Then read the new `DEPLOY.md` once, as someone who deploys, and correct anything I derived wrongly
from source alone. And decide `apk_manifest_debuggable`: wire it into the release path or retire it
deliberately (A-007).

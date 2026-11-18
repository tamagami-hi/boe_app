# BOE_APP Release Manager

This is an operator reference, not agent permission to run a release. Root
[RULES.md](../RULES.md) governs safety, exports, VPS access, deployment, and the
production data and migration policy.

Air-gapped, operator-controlled deployment for the three BeOnEdge VPS stacks.

You build here. The VPS runs. Artifacts move deliberately, by rsync over SSH.
No source code, no git repository, and no registry credentials ever land on the
VPS, and **this machine never runs a docker command against the VPS** — it ships
tarballs and invokes the VPS's own scripts.

---

## The four scripts

| Script | Runs where | Does |
| --- | --- | --- |
| `status.sh` | here | **Start here.** Dashboard + interactive control center. Drives the others. Also the only place that cuts a release. |
| `export.sh` | here | Builds images and APKs, **advances the version**, stages a bundle. |
| `deploy.sh` | here | Uploads a bundle, then invokes the VPS-native deploy script. |
| `rollback.sh` | here | Invokes the VPS-native rollback script. |
| `verify.sh` | here | Self-check. Proves the configs, ports and image tags all agree. |

Each stack additionally carries its own pair of **VPS-native** scripts, which own
every docker command:

| Stack | On the VPS at | Scripts |
| --- | --- | --- |
| `dev_release` | `/srv/dev_stack/BOE_APP/dev_release` | `dev_deploy.sh`, `dev_rollback.sh` |
| `prod_release` | `/srv/dev_stack/BOE_APP/prod_release` | `prod_deploy.sh`, `prod_rollback.sh` |
| `monitor_service` | `/srv/dev_stack/BOE_APP/monitor_service` | `ms_deploy.sh`, `ms_rollback.sh` |

---

## Normal flow

```bash
./release_manager/status.sh                 # see everything; do most things from here
```

The interactive menu is organized as `Git → Exports → Ship + Deploy`. Under
`Git`, the full workflow previews and commits dirty `wt/admin` and `wt/client`
worktrees and main (their names are historical: `frontend_stack_ts` is one
package building both variants; they predate tally tracks, and lanes now run in
`.temp/worktrees/<track>/` and land through the tally landing queue, see
`WORKFLOW.md`); checks, reviews, and integrates approved PRs;
synchronizes `origin/main`; pushes after confirmation; and fast-forwards main
back into each dev worktree. `Sync local worktrees` runs only that final
main-to-worktree synchronization; it also resets nothing, so if a worktree's
sparse cone ever drifts from the live layout, fix the cone first or the sync
will leave it missing directories. `Cut a release` offers to run the full Git
preparation automatically when needed.

`Exports → Build + ship APKs` builds the client and admin variants for the exact
release version, validates their sidecar provenance and SHA-256, archives any
previously published APKs into variant-specific rollback directories, and then
publishes each artifact atomically (temp upload → remote digest check → rename)
to the dedicated VPS directories declared by that stack's `paths.json`. The
production route builds the tip of origin's `production` branch in a temporary
worktree, exactly as `export.sh --prod` does, and refuses debug-signed
artifacts. APKs included in a full bundle are selected by
the bundle manifest and published only after the remote deploy succeeds;
`deploy.sh --ship-only` stages them under `<stack>/apk/` for inspection without
touching the live APK directories.

Or directly:

```bash
# development
./release_manager/export.sh --dev
./release_manager/deploy.sh --dev

# production (after Git → Push a release to production; builds that branch's tip)
./release_manager/export.sh --prod --with-apk
./release_manager/deploy.sh --prod

# monitoring
./release_manager/export.sh  --monitor
./release_manager/deploy.sh  --monitor

# rollback — always list first
./release_manager/rollback.sh --prod --list
./release_manager/rollback.sh --prod --latest
```

Every script takes exactly one of `--dev`, `--prod`, `--monitor`.

### Production releases come from the `production` branch

Origin's `production` branch means "approved for production". Production does
not follow `main`, so tally records commits (or anything else) landing on `main`
after a cut never block a production export.

1. Cut on `main` with `status.sh` → Git → Cut a release (commit, tag, push).
   It then asks whether to push a release to production; the default is No.
2. Export and deploy the development stack, and test it.
3. `status.sh` → Git → Push a release to production. It reads origin live, shows
   production's tip and the newest releases on it, and lists up to five newer
   release tags on `main` that fast-forward it. Confirm one to push it (never
   forced). The first time, choose v0.18.6, the release already live, to create
   the branch.
4. `export.sh --prod --with-apk` builds production's tip, which must be exactly
   a release tag, in a temporary worktree under `.temp/prod-export/` with that
   tag's own scripts, stages the bundle under `build/prod_release/` and removes
   the worktree, also on failure. This checkout may be ahead or dirty. The first
   export through this flow is the first release cut after this change landed.
5. `deploy.sh --prod` ships only a stable bundle with `git_dirty: false` whose
   commit is both origin's live `production` tip and its live release tag.

`rollback.sh` is the way back. It is not blocked and does not move
`production`; after a rollback the fix goes out as a newer release tag.
`status.sh --status` shows production's tip, read live, next to the version the
production stack runs. Details: `DEPLOY.md`, "Production gate".

---

## Layout

```
release_manager/
├── status.sh · export.sh · deploy.sh · rollback.sh · verify.sh
│
├── lib/                        shared, sourced by the local scripts
│   ├── stacks.sh               THE stack registry — the single source of truth
│   ├── paths.sh                validates + reads paths.json (nothing generates it)
│   ├── version.sh              semver helpers (also used by the APK builder)
│   ├── production_gate.sh      production release and deploy gates, live origin reads
│   ├── production_push.sh      Git → Push a release to production
│   ├── prod_export.sh          production builds from a temporary worktree at production's tip
│   ├── status_dashboard.sh     the status.sh dashboard
│   ├── ui.sh                   output helpers
│   └── repo_sync.sh            git local-vs-origin comparison
│
├── stacks/                     what gets shipped to the VPS
│   ├── _shared/                _boe_lib.sh, _boe_deploy.sh, _boe_rollback.sh
│   ├── dev_release/            compose, native scripts, .env.example, guide
│   ├── prod_release/
│   └── monitor_service/        temporary external-monitoring deployment scaffold
│
├── nginx/                      site configs for you to install (see the guide)
├── build/                      staged bundles, per stack (gitignored)
├── state/versions.json         local ledger of built vs deployed (gitignored)
│
├── docs/                       topic records and operator notes
│   └── Completed/              dated history, including the architecture plan,
│                               "BeOnEdge Application Deployment.md"
│
├── FACTS_VS_PLAN.md            VPS reality vs the plan, as captured on 2026-07-31
└── OPERATOR_MANUAL_STEPS.md    everything you must do by hand, and the known gaps
```

`monitor_service/` is deliberately outside the BOE_APP business runtime. It is
currently shipped by this operator pipeline only to preserve the existing VPS
deployment path; it is the extraction boundary for the future independent
monitoring/operations repository. It must not gain business logic or arbitrary
production database write access. See
`docs/Completed/complexity-audit-2026-08-26/DEPLOYMENT_CONSTRAINTS_IMPLEMENTATION.md`.

`recent_builds/` and `rollback/` (each only a `.gitkeep`) are left from the
**previous** single-stack pipeline; nothing new reads them. The old
`release_manager/BOE_APP/` folder no longer exists. `BOE_APP` now names only the
VPS roots: `/srv/dev_stack/BOE_APP/<stack>/` and `/srv/backup/BOE_APP/`.

---

## Design rules

**One source of truth for paths.** Each stack's tracked `paths.json` (schema 3)
is the sole authority for every deployment, backup, log, database, image,
configuration and APK path. It is hand-edited canonical configuration —
`paths.sh` only validates and reads it; nothing generates it. Change a path by
editing the contract, validate it (`status.sh` → Exports → Validate path
contracts), and re-ship. `verify.sh` fails if a contract is malformed, unsafe,
escapes its containment, or overlaps another stack's APK directories, and if
any operational script carries a raw path literal.

**The version advances in exactly one place.** `export.sh` labels the build:
a clean tree on the exact `vX.Y.Z` tag produces a stable, shippable version only
when the same tag resolves to that commit on `origin`; anything else produces
`<next>-dev.N.gSHA[.dirty]`, which production refuses. `origin/main` does not
have to be at the tag. A production export always builds the tip of origin's
`production` branch in its own worktree.
`deploy.sh` and `rollback.sh` never change a version — they only record what the
VPS reports.

**All docker work happens on the VPS.** The local scripts upload files and run
`ssh <stack>_deploy.sh`. This is why a stack directory on the VPS is
self-sufficient: given only SSH you can deploy or roll it back.

**Never swap directories.** The previous implementation replaced the whole deploy
directory (`mv D D.previous && mv D.next D && rm -rf D.previous`). With three
stacks under one parent that would destroy the siblings and their state. Shipping
now writes only the files it owns, in place, and rsync runs without `--delete`.

**Everything is loopback-bound.** Every published port is `127.0.0.1:PORT:PORT`.
Postgres publishes nothing at all and sits on an `internal: true` network. Host
nginx is the only public entry point. `verify.sh` enforces this.

**Health gates the version.** `docker compose up -d` returning 0 means
"containers created", not "application works". The version file is written only
after every healthcheck passes and the smoke tests succeed. A failure triggers an
automatic image rollback.

**Application rollback and database restore are separate.** Rollback swaps images
without restoring the database. The current stack `.env` is reused, so config
changes must remain backward-compatible across the retained rollback window, and
migrations must stay compatible with the previous release unless they are registered
destructive boundaries (`RULES.md` rule 11; migration policy in `DEPLOY.md`).
Crossing a registered boundary requires `--restore-db`.
Keep an encrypted recovery copy outside ordinary rollback/log directories.
Database restore discards committed transactions, so it is opt-in
(`--restore-db`), backs up the current database first, and requires typing
`RESTORE`.

**Configuration never ships.** Each stack's `.env` is its sole runtime source,
including secrets. Shipping excludes `.env` and never deletes unmanaged files.

---

## Manual steps and known gaps

What only you can do on the VPS, what blocks a first deploy, and the application
gaps the tooling reports are kept in one place:
**[`OPERATOR_MANUAL_STEPS.md`](OPERATOR_MANUAL_STEPS.md)**.
`./release_manager/status.sh --diagnose` names whatever still blocks.

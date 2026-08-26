# BOE_APP Release Manager

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
worktrees and main; checks, reviews, and integrates approved PRs;
synchronizes `origin/main`; pushes after confirmation; and fast-forwards main
back into each surface worktree. `Sync local worktrees` runs only that final
main-to-worktree synchronization. `Cut a release` offers to run the full Git
preparation automatically when needed.

`Exports → Build + ship APKs` builds the client and admin variants for the exact
release version, validates their sidecar provenance and SHA-256, archives any
previously published APKs into variant-specific rollback directories, and then
publishes each artifact atomically (temp upload → remote digest check → rename)
to the dedicated VPS directories declared by that stack's `paths.json`. The
production route first requires a clean, tagged, pushed release commit and
refuses debug-signed artifacts. APKs included in a full bundle are selected by
the bundle manifest and published only after the remote deploy succeeds;
`deploy.sh --ship-only` stages them under `<stack>/apk/` for inspection without
touching the live APK directories.

Or directly:

```bash
# development
./release_manager/export.sh --dev
./release_manager/deploy.sh --dev

# production (needs Git → Cut a release first)
./release_manager/export.sh --prod
./release_manager/deploy.sh --prod

# monitoring
./release_manager/export.sh  --monitor
./release_manager/deploy.sh  --monitor

# rollback — always list first
./release_manager/rollback.sh --prod --list
./release_manager/rollback.sh --prod --latest
```

Every script takes exactly one of `--dev`, `--prod`, `--monitor`.

---

## Layout

```
release_manager/
├── status.sh · export.sh · deploy.sh · rollback.sh · verify.sh
│
├── lib/                        shared, sourced by the local scripts
│   ├── stacks.sh               THE stack registry — the single source of truth
│   ├── paths.sh                generates + reads paths.json
│   ├── version.sh              semver helpers (also used by the APK builder)
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
├── FACTS_VS_PLAN.md            verified VPS reality vs the plan, and the gaps
├── OPERATOR_MANUAL_STEPS.md    everything you must do by hand
└── BeOnEdge Application Deployment.md    the architecture plan
```

`monitor_service/` is deliberately outside the BOE_APP business runtime. It is
currently shipped by this operator pipeline only to preserve the existing VPS
deployment path; it is the extraction boundary for the future independent
monitoring/operations repository. It must not gain business logic or arbitrary
production database write access. See
`docs/complexity-audit-2026-08-26/DEPLOYMENT_CONSTRAINTS_IMPLEMENTATION.md`.

`BOE_APP/`, `recent_builds/` and `rollback/` are the **previous** single-stack
pipeline, kept for reference. Nothing new reads them.

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
`<next>-dev.N.gSHA[.dirty]`, which production refuses.
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
changes must remain backward-compatible across the retained rollback window.
Keep an encrypted recovery copy outside ordinary rollback/log directories.
Database restore discards committed transactions, so it is opt-in
(`--restore-db`), backs up the current database first, and requires typing
`RESTORE`.

**Configuration never ships.** Each stack's `.env` is its sole runtime source,
including secrets. Shipping excludes `.env` and never deletes unmanaged files.

---

## Before the first deploy

Two things block deployment and only you can do them:

1. `sudo chown -R beonedge:beonedge /srv/backup/BOE_APP` — it is currently
   root-owned, and the VPS has no passwordless sudo, so deploys cannot write
   rollback artifacts.
2. Create and fill each stack-local `.env` with mode `600` (or root-owned mode
   `640` and readable by the `beonedge` group).

Then:

```bash
./release_manager/status.sh --diagnose      # confirms readiness, names blockers
./release_manager/verify.sh --remote        # proves the tooling is consistent
```

Full detail: **`OPERATOR_MANUAL_STEPS.md`**.

---

## Known application gaps

Reported by the tooling rather than silently worked around:

- No Gradle product flavors, so dev and prod APKs cannot be co-installed.
  Release signing and version injection are done: `emu/boe_update.sh` builds a
  signed, minified release APK whenever `android/keystore.properties` exists.
- No backend `/metrics`, so Prometheus has no application-level series.
- No WebSocket support; the `/ws/` nginx blocks are commented out.
- Backend health routes have no `/api` prefix; nginx strips it. See
  `FACTS_VS_PLAN.md` §4 D1.

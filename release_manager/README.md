# BeOnEdge release manager

Image-based release workflow for the VPS stack: **landing (Next.js) + backend_controller (Node API) + PostgreSQL**. The admin portal and client APK are **not** deployed here — they connect to this backend over the public domain.

```
release_manager/
├── status.sh            # console: ALL git work (integrate, push, PR approve, cut release)
├── export.sh            # build + docker save images → recent_builds/<ver>/ (no git work)
├── deploy.sh            # load + compose up into BOE_APP/, snapshot to rollback/
├── rollback.sh          # restore a previous snapshot from rollback/
├── recent_builds/       # exactly one staged bundle (gitignored)
├── rollback/            # saved previous releases (gitignored)
└── BOE_APP/             # the live deployment dir (compose runs here)
    ├── docker-compose.yml   # image-based deploy compose (no build)
    ├── .env.example         # copy → .env, fill secrets
    └── images/              # loaded image tarballs (gitignored)
```

## 0. Git + releases — all in the console

Every git operation (fully sync local ↔ remote main, integrate contributor work, approve PRs, and **cut a release**: bump `VERSION` → commit → tag `vX.Y.Z` → push) lives in `status.sh`. `export.sh` and `deploy.sh` never mutate git.

```bash
./release_manager/status.sh                # DEFAULT: report-only — status + what to do next
./release_manager/status.sh --interactive  # act on those steps (y/N prompts; needs a terminal)
./release_manager/status.sh --main -i      # just the main section, interactive
```

The default run changes nothing. With `--interactive` (`-i`) on a terminal, section 2 will:
- **pull** `--rebase` when local main is behind, **push** when ahead (full bidirectional sync);
- merge contributor branches into local main;
- when main is clean and level with origin, **prompt to cut a release** (bump → commit → tag → push).

Section 3 prompts to approve open PRs. Only local main is ever pushed to remote main.

## 1. Build a release (build machine)

```bash
./release_manager/export.sh                # build images from the CURRENT tree
./release_manager/export.sh --skip-build   # re-bundle existing images
```

No version bump or git work here. The label is derived from git state: a clean tree sitting on the exact `vX.Y.Z` release tag (cut in `status.sh`) produces a **stable** `X.Y.Z` bundle; anything else produces a local-only `<next>-dev.N.gSHA[.dirty]` build that `deploy.sh` refuses to ship.

Produces one bundle in `recent_builds/<version>-<stamp>/`: `backend.tar.gz`, `landing.tar.gz`, `docker-compose.yml`, `.env`, `version.json`, `manifest.json`.

## 2. Ship to the VPS

Copy the repo (or at least `release_manager/`) to the VPS. First time, configure env:

```bash
cd release_manager/BOE_APP
cp .env.example .env
# Fill every CHANGE_ME. Generate secrets:
#   openssl rand -hex 48   # ACCESS_TOKEN_SECRET, REFRESH_TOKEN_SECRET
#   openssl rand -hex 32   # SIGNUP_PROXY_SECRET
# Set PUBLIC_LANDING_ORIGIN / PUBLIC_API_BASE_URL to the real https domain.
```

`deploy.sh` reuses an existing `BOE_APP/.env`; the bundle's `.env` is only used as a fallback on first deploy. When shipping to the VPS, the script archives the active `BOE_APP/` directory and replaces the remote `BOE_APP/` after `docker compose down`. The VPS `.env` is preserved and restored into the new directory with only `BOE_VERSION` updated, so compose resolves the newly loaded image tags without overwriting secrets/domains.

## 3. Deploy

```bash
./release_manager/deploy.sh                          # local Docker deploy (default)
./release_manager/deploy.sh --production <pem-key>   # local deploy + ship to the VPS
```

The default deploys the staged bundle locally: snapshots the active release into `rollback/`, loads the new images, runs `docker compose up -d` (postgres → migrate → seed → backend → landing), then health-checks `:47502/health` and `:3100/`. Postgres data persists in the `pgdata` volume.

`--production` (alias `--ship`) does the local deploy first, then the **ship gate** verifies the bundle is a STABLE release whose commit `== origin/main`, built clean — and only then ships to the VPS. If you skipped the `status.sh` release cut (so the bundle is a `-dev` build or its commit ≠ origin/main), the gate refuses; override only with `--force-ship`.

Flags: `--skip-down`, `--skip-load`, `--skip-checks`.

## 4. Roll back (VPS)

```bash
./release_manager/rollback.sh                 # interactive picker
./release_manager/rollback.sh --rollback-dir release_manager/rollback/<snapshot>
```

Refuses to run if the compose file is missing the `pgdata` persistence contract or if the expected Docker volume has vanished.

## Edge / TLS

A **host nginx** (not a container) terminates TLS and routes `/v1/`→`127.0.0.1:47502` and `/`→`127.0.0.1:3100`. Use `frontend_stack/deploy/nginx.single-port.example.conf`. See `../DEPLOY.md`.

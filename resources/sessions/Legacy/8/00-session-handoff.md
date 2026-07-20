# Session 8 — Worktree topology, release_manager, and deploy config (handoff)

> Resume point for the next session. This session set up the multi-worktree git
> topology, the VPS deployment stack, and the centralized `release_manager`.
> Read this first, then run `./release_manager/status.sh` to see live state.

---

## 1. What this session accomplished (in order)

1. **Verified worktree isolation** — each surface worktree is sparse-checked to only its surface.
2. **Worked the landing worktree** — `npm install`, tests (17/17), build all pass. Diagnosed "port 3100 shows nothing / 5173 shows admin" (landing Next.js wasn't running; 5173 was a stray Vite from the main tree).
3. **Built the VPS deploy stack** — backend + landing Dockerfiles, image-based compose, single env.
4. **Created `release_manager/`** (modeled on `~/PROJECTS/algo_engine/release_manager`) with `export.sh` / `deploy.sh` / `rollback.sh` and `BOE_APP/` as the live deploy dir.
5. **Consolidated to one env** — `release_manager/BOE_APP/.env` is the single switchboard (localhost defaults; swap the "PUBLIC SURFACE" block for the VPS). Deleted the duplicate root `docker-compose.yml` + `.env.production.example`.
6. **Restructured branches** — `main` is now the single source of truth (fast-forwarded over the old `feat/session4-fund-pool-redesign`); surfaces are local-only dev worktrees; remote holds **only `main`**.
7. **Added guard-rails** — CI workflow, a state-aware `status.sh` dashboard, `WORKFLOW.md`.
8. **Created the real `.env`** (generated secrets, gitignored) + `env_guide.md` (engineering guide).
9. **Documented where the domain name and VPS IP go.**
10. **Discussed shared-backend consistency** across worktrees (open decision — see §6).

---

## 2. Current repo topology (the agreed structure)

```
GitHub origin ── only `main` ── published, tested truth
      ▲  push (only from boe_app/main, after CI + local deploy)
boe_app  = /home/nethunter07/PROJECTS/boe_app  ── branch: main ── FULL checkout
      • single source of truth + integration + RELEASE (holds release_manager/)
      ▲   merge up        │ merge main ↓ (resync)
  ┌───┴───────┬───────────┴─────┐
boe_app-admin  boe_app-client  boe_app-landing
  wt/admin      wt/client       wt/landing
  • sparse worktrees, one surface each, LOCAL-ONLY (never pushed)
```

- **Removed** this session: `boe_app-main` worktree, local `feat/session4-fund-pool-redesign`, remote `wt/*` + `feat`.
- `main` head at session end: commit with `release_manager/`, CI, `WORKFLOW.md`, `env_guide.md`, domain/IP docs.
- Surface worktrees are at the old `86def36` tip → they show **"behind main"** in `status.sh` (they lack `main`'s release_manager/CI commits). Resync with `git merge main` when resuming.

### Data flow
1. Develop per surface in the worktree (commit on `wt/<surface>`, local).
2. `git merge wt/<surface>` into `boe_app` (main) — local, instant (shared `.git`).
3. Test + local Docker deploy via `release_manager/`.
4. `git push origin main` (only `main` ever goes to remote).

---

## 3. Deployment architecture

- **Three containers only**: `landing` (Next.js :3100), `backend` (Node API :47502), `postgres` (`pgdata` volume) + one-shot `migrate` & `seed` jobs.
- **Admin/client are NOT deployed** — they run locally / as the APK and hit the same backend over the public domain (allowed via `CORS_ORIGIN`).
- **Host nginx** (not a container) terminates TLS, routes `/` → 3100 and `/v1/` → 47502. Config: `frontend_stack/deploy/nginx.single-port.example.conf`.
- Both app containers bind `127.0.0.1` only; nginx is the sole public door.

### `release_manager/` layout (on `main` only)
```
release_manager/
├── export.sh      # build boe-backend + boe-landing, docker save → recent_builds/<ver>/
├── deploy.sh      # load images + compose up in BOE_APP/, snapshot old → rollback/
├── rollback.sh    # restore a previous snapshot (pgdata-contract guarded)
├── status.sh      # state-aware dashboard: what's committed/merged/staged/deployed + next steps
├── WORKFLOW.md is at repo ROOT (not here)
└── BOE_APP/       # the live deploy dir (compose runs here)
    ├── docker-compose.yml   # image-based (no build); references boe-*:${BOE_VERSION}
    ├── .env.example         # committed template (CHANGE_ME placeholders)
    ├── .env                 # REAL, generated secrets — GITIGNORED (local only)
    └── env_guide.md         # full engineering guide (stack, every env var, signup gate, ops)
```

### The single env (`BOE_APP/.env`)
- Localhost defaults; the **PUBLIC SURFACE** block (`PUBLIC_LANDING_ORIGIN`, `PUBLIC_API_BASE_URL`, `CORS_ORIGIN`) is the only thing you swap for the VPS.
- A **DEPLOYMENT TARGET** block at the top records the domain + VPS IP.
- **Domain** → the 3 PUBLIC_* vars + nginx `server_name`. **VPS IP** → NOT in the app; only DNS `A` record + `ssh`. (Full detail in `env_guide.md` §9.)
- Secrets already generated locally. Local admin login: `admin@beonedge.local` / `7d827f47a4277067739100d7`; client `client@beonedge.local` / `aabddfaf540b6df2a8c0c898` (read from `.env`).

---

## 4. Key files created/changed this session

**On `main` (committed + pushed):**
- `release_manager/` (export/deploy/rollback/status + BOE_APP compose, .env.example, env_guide.md)
- `DEPLOY.md` (repo root) — VPS deploy guide
- `WORKFLOW.md` (repo root) — dev + release workflow, cheat sheet
- `.github/workflows/ci.yml` — backend authz guards + tests, landing test + build
- `backend_controller/.env.example` — `PORT 47500 → 47502` (consistency fix)
- `frontend_stack/deploy/nginx...conf` — `example.com → your-domain.tld` + header notes

**On `wt/landing` (UNCOMMITTED — still pending):**
- `frontend_stack/packages/landing_page/Dockerfile` (new)
- `frontend_stack/packages/landing_page/.dockerignore` (new)
- `frontend_stack/packages/landing_page/next.config.mjs` (added `output: 'standalone'`)
- `frontend_stack/packages/landing_page/package-lock.json` (from npm install)

**Local-only (gitignored):** `release_manager/BOE_APP/.env`

---

## 5. OPEN ITEMS / next steps

1. **Commit the landing build files on `wt/landing` and merge to `main`.** Until then, `release_manager/export.sh` cannot build the landing image from `main` (main lacks the Dockerfile + `output: 'standalone'`). This is the most important next step to make releases functional.
2. **Verify CI on GitHub.** The CI run is unverified locally — check the Actions tab; the `landing` job (`npm ci` in a workspace child) is the likeliest to need a tweak.
3. **Backup gap.** Surface worktrees are local-only; unmerged work lives on one disk. Merge+push often, or use `git bundle create ~/backups/boe-$(date +%F).bundle --all`.
4. **Resync surfaces.** They're behind `main` — `git merge main` in each worktree before new work.
5. **First real deploy / VPS.** Fill the PUBLIC SURFACE block with the real domain, set nginx `server_name`, run `certbot`, `deploy.sh`.

---

## 6. UNRESOLVED DECISION — shared backend across worktrees

`backend_controller/` is present in every worktree (for *running* it), but is **shared core**. Risk: two surface branches editing it → divergent backends.

**Principle agreed:** present everywhere to RUN; authored in ONE lane; propagated by `git merge main`. Parallel-agent consistency comes from: (a) one source = `main`, (b) frequent small two-way merges, (c) `resources/_coord/coord.mjs` file-claim protocol for same-file backend edits. Topology does NOT remove same-file serialization — coordination does.

**Two patterns (user to choose):**
- **Pattern A (recommended)** — author backend changes on `main` directly; surfaces `git merge main` to resync. Simpler; fits full-stack features.
- **Pattern B** — dedicated `boe_app-backend` / `wt/backend` worktree as its own lane (only worth it if backend is a large independent workstream with its own agent).

**PENDING:** user to pick A or B, then I will codify it in `WORKFLOW.md`, add a "backend = shared core, author on main, merge main to resync" note to `status.sh`, and document the `resources/_coord` claim step for backend edits.

---

## 7. How to resume

```bash
cd ~/PROJECTS/boe_app
git status && git log --oneline -8
./release_manager/status.sh        # live dashboard + ordered next steps
```
Then: resolve §5 item 1 (commit landing build files → merge to main), decide §6 (Pattern A/B), and proceed to a first build/deploy.

> Note: session cost ran high (~$120). Be mindful next session — batch tool calls, avoid re-reading unchanged files.

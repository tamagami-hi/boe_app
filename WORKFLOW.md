# BeOnEdge — development & release workflow

> The single page that answers: *where do I work, where do I release, how do I
> know the current state.* If anything here feels ambiguous, this file is wrong —
> fix it here, not in your head.

## The shape (one rule per box)

```
GitHub origin ── only `main` ── the published, tested truth
      ▲
      │ push (only from boe_app/main, only after CI + local deploy pass)
      │
boe_app  (this folder)  ── branch: main ── FULL checkout
      • the ONLY place you integrate, test, and RELEASE
      • holds release_manager/ (deploy tooling) — worktrees never do
      ▲       ▲   merge up
      │       │
  ┌───┘       └────────┐
admin              client        ← boe_app-admin / boe_app-client
  • two sparse dev worktrees, cone: backend_controller emu
    frontend_stack_ts packages release_manager
  • the names are historical. frontend_stack/ held separate admin and
    client packages; frontend_stack_ts is ONE package building two
    variants via VITE_BEO_APP_TARGET, so both worktrees see the same
    frontend. They are parallel workspaces, not per-surface silos.
```

**One job per location.** A worktree builds its surface. `boe_app` (main)
integrates + releases. There is exactly one place for each activity — that is
what keeps it un-confusing.

## Daily development (in a surface worktree)

```bash
cd ~/PROJECTS/boe_app-client        # or -admin
git pull --rebase                    # stay current with main's base
# ...code, commit on wt/client...
git checkout wt/client && git rebase main    # periodically, to avoid drift
```

## Integrate a surface into main (in boe_app)

```bash
cd ~/PROJECTS/boe_app                 # always on main
git merge wt/client                   # bring the surface's commits in
# resolve, then test locally (see Release below)
```

## Release — ALWAYS from boe_app, never from a worktree

Centralised by construction: `release_manager/` exists only on `main`, so you
*cannot* release from a surface worktree even by accident.

```bash
cd ~/PROJECTS/boe_app

./release_manager/status.sh                 # 1. see where things stand
./release_manager/export.sh --minor         # 2. build + bundle images (bumps version)
./release_manager/deploy.sh                 # 3. deploy locally / on the VPS
git push origin main                        # 4. publish — only after the above pass
git tag -a vX.Y.Z -m "release X.Y.Z" && git push origin vX.Y.Z   # 5. mark it
```

### How do I know what's released?
- `./release_manager/status.sh` — branch, divergence, worktrees, **deployed version**, staged build, rollback count.
- `release_manager/BOE_APP/current-version.json` — the version actually running.
- `git tag --list 'v*'` — every published release.
- Roll back: `./release_manager/rollback.sh`.

## Two guard-rails this setup needs (don't skip)

1. **Backup.** Surface worktrees are **local-only** — nothing off-machine until it
   reaches `main` and is pushed. So: commit often, and **merge to `main` + push
   frequently**. Treat unmerged worktree work as "exists on one disk only."
   (Optional hard backup: `git bundle create ~/backups/boe-$(date +%F).bundle --all`.)

2. **CI gate.** `main` is protected by `.github/workflows/ci.yml` (tests + the
   `authz:*` invariant guards). Don't merge a surface into `main` and push if CI is
   red — for auth/payment code that gate is the substitute for PR review.

## Cheat sheet

| I want to… | Where | Command |
|---|---|---|
| Build a surface | `boe_app-<surface>` | edit + commit on `wt/<surface>` |
| Integrate it | `boe_app` (main) | `git merge wt/<surface>` |
| See current state | anywhere on main | `./release_manager/status.sh` |
| Cut a release | `boe_app` (main) | `export.sh` → `deploy.sh` → `git push` → tag |
| Undo a release | wherever deployed | `./release_manager/rollback.sh` |

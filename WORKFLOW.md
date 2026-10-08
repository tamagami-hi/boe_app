# BeOnEdge — development & release workflow

This is the workspace/operator reference. Root [RULES.md](RULES.md) governs
permissions, Git identity, safety, and verification; command examples do not
authorize an agent to commit, push, export, connect to the VPS, or deploy.

## Workspaces and integration

- `boe_app` on `main` is the full integration checkout and the maintainer's release
  location. Check `git status` and `git worktree list` rather than assuming a
  particular branch or extra worktree exists.
- Maintainer-approved `wt/admin` and `wt/client` worktrees may be used for
  development when present. Their names are historical: `frontend_stack_ts/` is
  one package compiling both client/admin variants, not two separate frontends.
- Verify sparse worktrees contain the live backend/frontend/contracts paths.
  Do not rely on missing deployment tooling as a safety boundary.
- Integrate only authorized, reviewed work into `main`. Run the relevant checks
  and preserve unrelated user changes. Committing, branching, and pushing require
  explicit authorization and the identity check in `RULES.md` rule 14.
- Local unmerged work is not an off-machine backup. The maintainer decides when
  to commit, integrate, back up, and publish it.

## Verification and CI

The full applicable sweep is in [RULES.md](RULES.md#verification-boundaries).
`.github/workflows/ci.yml` defines backend, frontend, and contracts jobs:

- Backend runs `npm run check` and PostgreSQL integration tests.
- Frontend builds contracts, then runs typecheck, lint, tests, generated-client
  drift checks, both variant builds, and the native PhonePe-target guard.
- Contracts runs its package `npm run check`.

CI configuration is not proof of GitHub branch protection or runtime behavior.
Release-manager shell tests/verification are separate; inspect a script before
running it and obtain permission if it exports, starts services, or contacts the
VPS. Never report a deployment or device check from a unit-test result.

## Release — maintainer-operated, from the full integration checkout

1. Use `release_manager/status.sh` to inspect/prepare Git and release state.
2. Production export requires a clean, tagged, published release commit; prepare
   that through the maintainer's release flow before exporting.
3. Export the selected stack with exactly one of `--dev`, `--prod`, `--monitor`.
4. The maintainer ships/deploys the matching bundle, observes its health/runtime
   checks, and decides whether it is accepted.
5. If recovery is needed, the maintainer selects a rollback only after checking
   the current schema/configuration. Database restoration is separate and destructive.

| Operator action | Reference command |
| --- | --- |
| Inspect/prepare release state | `./release_manager/status.sh` |
| Export production bundle | `./release_manager/export.sh --prod` |
| Deploy production bundle | `./release_manager/deploy.sh --prod` |
| List production rollback choices | `./release_manager/rollback.sh --prod --list` |

`VERSION` and local tags describe source/release metadata, not proof of the version
running on the VPS. The selected stack's `paths.json` names its deployed version
file; live inspection requires permission. Detailed flags and recovery semantics
are in [DEPLOY.md](DEPLOY.md) and [release_manager/README.md](release_manager/README.md).

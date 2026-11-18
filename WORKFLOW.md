# BeOnEdge — development & release workflow

This is the workspace/operator reference. Root [RULES.md](RULES.md) governs
permissions, Git identity, safety, and verification; command examples do not
authorize an agent to commit, push, export, connect to the VPS, or deploy.

## Workspaces and integration

- `boe_app` on `main` is the full integration checkout and the maintainer's release
  location. Check `git status` and `git worktree list` rather than assuming a
  particular branch or extra worktree exists.
- Work runs in lanes, each a tally track. The coordinator (tally's operator
  session on `main`) opens a track as a branch `track/<name>` cut from `main`,
  with its own worktree under `.temp/worktrees/<name>/`. A lane works only in
  that worktree, opens its tally session there and claims its planned task.
- A track reaches `main` only through tally's landing queue. The coordinator
  lands it with `land_start` and `land_wait`: tally rebases the track onto
  `main` in a clean checkout and hands back the landing script to run. Lanes do
  not merge, rebase, push or land themselves.
- `frontend_stack_ts/` is one package compiling both client/admin variants, not
  two separate frontends. The `wt/admin` and `wt/client` worktrees that
  `release_manager/status.sh` still handles under Git predate tally tracks;
  lanes do not use them.
- Verify a worktree contains the live backend/frontend/contracts paths before
  relying on it. Do not rely on missing deployment tooling as a safety boundary.
- Decisions, questions, progress, reviews and handoffs live in tally
  (`docs/records/`), not in new Markdown files.
- Integrate only authorized, reviewed work into `main`. Run the relevant checks
  and preserve unrelated user changes. Committing, branching, and pushing require
  explicit authorization and the identity check in `RULES.md` rule 14.
- Local unmerged work is not an off-machine backup. The maintainer decides when
  to commit, integrate, back up, and publish it.

## Verification and CI

The full applicable sweep is in [RULES.md](RULES.md#verification-boundaries).
`.github/workflows/ci.yml` defines four jobs, run on pushes and pull requests to
`main`:

- Backend runs `npm run check` and the PostgreSQL integration tests, with
  coverage disabled for the integration run.
- Frontend builds contracts, then runs typecheck, lint, tests, generated-client
  drift checks, both variant builds, and the native PhonePe-target guard.
- Contracts runs its package `npm run check`.
- Onboarding harness runs the root `npm run test:onboarding:harness`
  (`test_e2e/onboarding-harness.test.mjs`).

CI configuration is not proof of GitHub branch protection or runtime behavior.
Release-manager shell tests/verification are separate; inspect a script before
running it and obtain permission if it exports, starts services, or contacts the
VPS. Never report a deployment or device check from a unit-test result.

## Release — maintainer-operated, from the full integration checkout

1. Before cutting a release, add its What's new entry. In
   `frontend_stack_ts/src/features/whats-new/`, give `clientNotes.ts` and
   `adminNotes.ts` a new first entry whose `id` is the new version, but only for
   an audience that has something to tell; the other gets no entry and sees no
   sheet. Each build treats its newest entry as the current release, and the
   copy follows `RULES.md` "Product, copy, and accessibility". Keep earlier
   entries in place and in order: the sheet shows every entry newer than the
   one a user last closed, so a user whose entry is gone sees only the newest.
   Then freeze the new entries before the cut moves `VERSION`: entries at or below
   `VERSION` are released, and `releasedNotes.test.ts` fails for any released entry
   with no row in `releasedNotes.json` or whose text changed. With `VERSION` set to
   the new version in your working tree only, run
   `npx vitest run src/features/whats-new/releasedNotes.test.ts -t "released client notes freeze"`
   from `frontend_stack_ts`, then again with `admin` in place of `client` (Vitest merges
   the two failures into one report if they run together), copy the `{ id, sha256 }` row
   each reports into
   `releasedNotes.json` (newest first, per audience), restore `VERSION`, and commit
   the notes and the rows together. A released entry is never edited afterwards.
2. Cut the release on `main` with `release_manager/status.sh`, Git → Cut a release.
   It commits `VERSION`, tags `vX.Y.Z` and pushes `main` and the tag together.
   It then asks `Push a release onto the production branch? [y/N]`; answer No
   until the development stack has been tested.
3. Export and deploy the development stack: `export.sh --dev`, then
   `deploy.sh --dev`. Test it on the phone; the maintainer decides whether it is
   accepted. An export straight after the cut is labelled `X.Y.Z`; once `main` has
   moved on, a dev export gets a `-dev` label, which the development stack accepts.
4. Approve it for production: `status.sh`, Git → Push a release to production.
   It reads origin live, shows where `production` stands and lists up to five of
   the newest release tags on `main` that are not on `production` yet. Choose
   one and confirm `Push vX.Y.Z (<sha>) onto production? [y/N]`; the push is a
   fast-forward and is never forced. The first time, `production` does not exist
   yet: choose v0.18.6, the release already live, to create it.
5. Export production: `export.sh --prod --with-apk`. It builds the tip of
   origin's `production` branch, which must be exactly a release tag, in a
   temporary worktree, using that tag's own scripts. Tally records commits that
   land on `main` after a cut, and uncommitted changes in this checkout, never
   block a production export and never reach the bundle. Each export runs its
   own tag's scripts, so the first production export through this flow is the
   first release cut after this change landed; v0.18.6 itself is not exported
   again.
6. Deploy production: `deploy.sh --prod`. It checks again that the bundle is
   stable and clean, and that its commit is both origin's `production` tip and
   origin's `vX.Y.Z` tag. The maintainer observes the health and runtime checks.
7. If recovery is needed, the maintainer selects a rollback only after checking
   the current schema/configuration. `rollback.sh` is not blocked by
   `production` and does not move it: after a rollback, `production` still names
   the newer release, and the fix goes out as a newer release tag. Database
   restoration is separate and destructive.

The commands are in [release_manager/README.md](release_manager/README.md#normal-flow)
("Normal flow"); flags and recovery semantics are in
[DEPLOY.md](DEPLOY.md#release-flow) ("Release flow").

`VERSION` and local tags describe source/release metadata, not proof of the version
running on the VPS. The selected stack's `paths.json` names its deployed version
file; live inspection requires permission.

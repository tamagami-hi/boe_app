# BE-024 Migrate-CLI baseline / legacy 001-008 disposition

Status: DONE — branch `ts-migration/backend` (PR #1). Backend finalization batch F2.

Makes `migrate up` production-correct for the canonical `>= 009` baseline by
archiving the legacy pre-rearchitecture migrations `001-008` out of the applied
directory, per the spec 03 §8 disposition matrix ("archive migrations 001-008 as
historical reference").

## Problem

`src/scripts/migrate.ts` applies every `.sql` file in `db/migrations/` in
filename order. With legacy `001-008` present, a full `migrate up` from an empty
database collides with the canonical migrations (e.g. legacy `001` creates a
`users` table + enums that canonical `010`/`014` recreate), so it could not run
in production. Tests worked around this by filtering `version >= "009"`.

## Change

- Moved `db/migrations/001..008_*.sql` -> `db/migrations-archive/` via `git mv`
  (history preserved). The applied directory now contains only the canonical
  `009-018` baseline, so `migrate up` / `migrate:dev` run cleanly from empty.
- Added `db/migrations-archive/README.md` documenting that these eight files are
  historical reference only (spec 03 §8) and must never re-enter `db/migrations/`.
- Added a permanent guard in `src/scripts/migrate.test.ts`: `db/migrations/`
  contains only `>= 009` files, and the eight legacy files remain archived. This
  prevents a colliding legacy migration from being reintroduced to the apply path.

The pre-existing `version >= "009"` filter in the integration harnesses is now a
redundant (harmless) safety net; left in place to avoid churn.

## Validation

- `npm run check` green (296 unit tests, +2 new baseline guards; build; smokes).
- `npm run test:integration` green (79 tests, 8 files) — the suites apply the
  canonical `009-018` baseline from the pruned directory, which is itself the
  proof that `migrate up` is now collision-free.
- Guards: `git diff --check` clean; Legacy tree hash intact; backend authored JS
  still 0; `package.json`/lock unchanged.

## Follow-ups (out of scope, noted)

- The Dockerfile does not copy `db/migrations` into the runtime image, so
  `node dist/scripts/migrate.js up` in the container has no migrations to apply.
  Wiring migrations into the image/release job belongs to **OPS-002**
  (Docker/release-manager migration).
- The single clean SQL baseline (regenerated from the verified target schema) and
  removal of the archive belong to **CLEAN-002** after backfill/cutover proofs.

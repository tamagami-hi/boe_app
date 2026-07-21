# Archived pre-canonical migrations (001-008)

These are the legacy pre-rearchitecture migrations, retained **only as historical
reference** per spec 03 §8 (Migration 001-008 disposition matrix). They are
**not** part of the applied schema and must never be placed back into
`db/migrations/`.

The canonical baseline is `>= 009`. Applying 001-008 alongside the canonical
migrations collides (e.g. legacy `001` creates a `users` table and enums that the
canonical `010`/`014` recreate). The migration runner (`src/scripts/migrate.ts`)
applies every `.sql` file in `db/migrations/`, so the legacy files were moved out
of that directory to make `migrate up` production-correct from an empty database.

A guard in `src/scripts/migrate.test.ts` asserts that `db/migrations/` contains
only `>= 009` files and that these eight legacy files remain archived here.

The eventual single clean baseline (CLEAN-002) will be generated from the
verified canonical target schema; these files are kept until that baseline and
the backfill/cutover proofs are complete.

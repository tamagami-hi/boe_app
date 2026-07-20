# BE-005: Migration / Check / Seed Operational Tooling

- Status: `DONE`
- Owner surface: `backend_controller/src/scripts/**`, `scripts/*.js` deletions.
- Dependencies: BE-004 (`DONE`).
- Objective: replace the legacy `psql`/alias-based operational JavaScript scripts
  with emitted TypeScript operational commands over the typed BE-004 pool, and
  delete the superseded JS.
- Normative sources: `TASKS.md` BE-005; `plans/01` Phase 3;
  `specifications/05` §3.1/§3.3 (emitted `dist/scripts` operational entrypoints).
- Dominant risk: an unsafe/partial migration apply. Mitigation: each migration
  runs in its own transaction (BEGIN/apply/record/COMMIT, ROLLBACK+rethrow on
  error); applied versions tracked in `schema_migrations`; idempotent re-runs.
- Production replacement closure: `src/scripts/migrate.ts` (deterministic
  `loadMigrationFiles`, `runMigrations`, `migrationStatus`, `status|up` CLI over
  the typed pool — no `psql` dependency) and `src/scripts/check-db.ts`
  (connectivity check). Emitted to `dist/scripts`; `migrate`/`migrate:dev`/
  `check:db` package scripts added.
- Exact JS/JSX deletion target: `scripts/migrate.js`, `scripts/check-db.js`,
  `scripts/seed-auth.js` (3 files). Backend backlog 86 -> 83.
- Seed scope: the typed bootstrap seed (spec `02` §3.5) requires the canonical
  users/credentials/roles tables and is authored with the schema in BE-007;
  `seed-auth.js` (which seeds the dead legacy schema through removed aliases) is
  deleted now as superseded dead code.
- Capability eval: unit tests prove file ordering/checksums, pending-only apply,
  per-migration transaction + rollback-on-failure, and status; an integration
  test applies a real migration idempotently and records `schema_migrations`.
- Coverage/build gates: unit `check` (>=80% overall) + `test:integration`.
- Required reviews: general/TypeScript + security (transactional apply, no SQL
  injection beyond trusted migration files, no secret logging).
- Rollback shape: revert the BE-005 commit; legacy scripts return as dead
  backlog. No schema applied outside ephemeral test containers.
- Done condition: unit + integration green; 3 JS deleted + guarded; records
  updated; commit pushed to `ts-migration/backend`; PR updated; Legacy hash
  `d5fd7425...`.
- Phase log: [BE-005 log](../logs/BE-005-migration-seed-check-tooling.md)

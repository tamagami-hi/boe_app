# BE-005 Phase Log: Migration / Check / Seed Operational Tooling

Status: `DONE`

## Objective And Dependency Closure

- Objective: replace legacy `psql`/alias-based operational scripts with emitted
  TypeScript commands over the BE-004 typed pool; delete the superseded JS.
- Dependencies: BE-004 (`DONE`).
- Normative sources: `TASKS.md` BE-005; `specifications/05` §3.1/§3.3.
- Dominant risk: unsafe/partial migration apply.
- Intentional behavior change: migrations apply via the owned `pg` pool instead
  of the `psql` CLI; the `#config`/`#db` aliases are gone. Behavior (ordered,
  checksummed, transactional, idempotent apply tracked in `schema_migrations`)
  is preserved.

## Atomic Units

- [x] `src/scripts/migrate.ts` (loadMigrationFiles/runMigrations/migrationStatus
      + `status|up` CLI) and `src/scripts/check-db.ts`.
- [x] Unit tests with a fake pool/client (ordering, pending-only apply,
      rollback-on-failure, status; check ok/not-ok).
- [x] RED: runtime-boundary deletion guard failed while the JS existed.
- [x] GREEN: deleted `scripts/migrate.js`, `check-db.js`, `seed-auth.js`.
- [x] Integration: real migration applied idempotently + recorded.
- [x] `migrate`/`migrate:dev`/`check:db` package scripts; records updated.

## Replacement And Deletion Map

| New TypeScript | Superseded JS deleted | Guard |
|---|---|---|
| `src/scripts/migrate.ts` | `scripts/migrate.js` (~150) | runtime-boundary guard + unit + integration |
| `src/scripts/check-db.ts` | `scripts/check-db.js` (~15) | runtime-boundary guard + unit |
| (typed bootstrap seed deferred to BE-007) | `scripts/seed-auth.js` (dead legacy-schema seed) | runtime-boundary guard |

## Research And Reuse

- Reused the BE-004 typed pool/config; replaced the `psql` subprocess with `pg`
  transactions (no external CLI dependency). Narrow `MigrationPool`/
  `MigrationClient` interfaces keep the logic unit-testable and let the real
  `pg.Pool` be passed at the CLI/integration boundary.
- No new dependency.

## RED Evidence

- `npx vitest run src/runtime-boundary.test.ts` — the new BE-005 deletion
  assertion failed while `scripts/migrate.js`/`check-db.js`/`seed-auth.js`
  existed; GREEN after deletion.

## Implementation And Decisions

- `runMigrations` applies each pending migration in its own transaction
  (BEGIN, migration SQL, INSERT into `schema_migrations`, COMMIT), ROLLBACK and
  rethrow on failure, `client.release()` in `finally`; already-applied versions
  are skipped (idempotent).
- Decision: `seed-auth.js` deleted as superseded dead code; the typed bootstrap
  seed (needs canonical identity tables) is authored in BE-007.
- Security: migration SQL comes only from trusted repository files; the
  `schema_migrations` insert is parameterized; no secret is logged.

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Unit suite | `npm run test:coverage` | 42/42; overall 87.69% stmts / 92.18% branch / 90.9% funcs |
| Typecheck/lint/build/smoke | `npm run check` | green |
| Integration | `npm run test:integration` | 4/4 vs PostgreSQL 16 (incl. idempotent migrate + `schema_migrations` record) |

## Reviews

- Code/TypeScript + security (focused inline review): transactional per-migration
  apply with rollback; parameterized bookkeeping insert; trusted-file SQL source;
  no secret logging; narrow interfaces keep pure logic unit-covered. No
  CRITICAL/HIGH/MEDIUM. (Fuller review available on PR #1.)

## Metrics

- Production TS added: `src/scripts/migrate.ts` (~120), `src/scripts/check-db.ts`
  (~35).
- Test TS added: `migrate.test.ts` (5), `check-db.test.ts` (2), +1 integration
  test; runtime-boundary +1 guard.
- Production JS deleted: 3 files (`migrate.js`, `check-db.js`, `seed-auth.js`).
- Remaining authored backend JS/JSX: **83 files** (was 86).

## Risk, Rollback, And Resume

- Residual risk: no typed bootstrap seed yet (deferred to BE-007 with the
  schema).
- Rollback shape: revert the BE-005 commit; no schema/provider/Legacy change.
- Commit/push: conventional commit on `ts-migration/backend`; PR #1 updated.
- Exact next action: `BE-007` canonical identity/onboarding schema (additive
  migrations + repositories), which begins deleting the identity/auth service JS.

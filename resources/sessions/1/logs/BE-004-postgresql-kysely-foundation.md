# BE-004 Phase Log: PostgreSQL/Kysely Foundation

Status: `DONE`

## Objective And Dependency Closure

- Objective: typed PostgreSQL foundation (owned `pg` pool, typed Kysely
  instance, explicit transaction/unit-of-work boundary, `Database` type) proven
  against real PostgreSQL 16.
- Dependencies: BE-003 (`DONE`), CON-006 (`DONE`).
- Gate deviation: authorized ahead of full GATE-02 closure (CON-007/LN-000/
  OPS-001/OPS-003A pending) to unblock the deletion-heavy persistence/identity/
  route batches; recorded here and in the packet.
- Normative sources: `plans/01` Phase 3; `specifications/03` §6-§7;
  `specifications/05` §3.4/§5.1.
- Dominant risk: untyped/implicitly-committing DB layer, or a non-functional
  container harness.
- Intentional behavior change: none (additive foundation; no runtime route uses
  it yet).

## Atomic Units

- [x] Feasibility spike: Testcontainers 12 + `@testcontainers/postgresql` start
      PostgreSQL 16 over the podman-backed runtime (log-based wait strategy,
      ryuk disabled). Confirmed; spike removed.
- [x] Typed config/pool/database/unit-of-work + `Database` type.
- [x] Unit tests (config parsing; lazy pool + Kysely + unit-of-work
      construction) with no live DB.
- [x] Integration test: pooled query + committed transaction + rollback.
- [x] Container-runtime wrapper + `vitest.integration.config.ts` +
      `test:integration` script; tsconfig include += `test/**`.
- [x] Unit `check` green; integration green; records updated.

## Replacement And Deletion Map

| New TypeScript | Superseded JS/JSX to delete | Guard |
|---|---|---|
| `src/db/config.ts`, `pool.ts`, `database.ts`, `types.ts` | none (legacy `src/db/*.js` kept until consumers gone; deleted by BE-005 + final cutover) | unit + integration tests |
| `test/integration/database.integration.test.ts` | none | real PostgreSQL query/commit/rollback |
| `scripts/with-container-runtime.ts`, `vitest.integration.config.ts` | none | provisions Testcontainers runtime |

## Research And Reuse

- Reused Kysely `PostgresDialect` over an owned `pg` pool (framework DB plugin
  rejected per `specifications/05` §6.4 — the backend owns pool/transaction/
  shutdown). No hand-rolled query builder.
- Install-script review: `testcontainers` pulls `ssh2`/`cpu-features` (native,
  optional SSH-transport deps — denied) and `protobufjs` (approved). `npm audit`
  0 vulnerabilities.
- Environment: podman-only sandbox has no Docker socket; a temporary
  `podman system service` + `DOCKER_HOST` + `TESTCONTAINERS_RYUK_DISABLED` +
  log-based wait strategy make Testcontainers work; real CI Docker sockets are
  used unchanged.

## RED Evidence

- Typecheck RED: the generic `UnitOfWork.execute` could not be inferred through
  a frozen object literal (`TS2322`/`TS7006`) until implemented as an explicit
  generic function.
- Lint RED: type-only `Kysely` import flagged by `consistent-type-imports`.
- Both fixed before GREEN.

## Implementation And Decisions

- `createPool` builds a lazy `pg.Pool` from typed config; `createDatabase`
  wraps it in `Kysely<Database>`; `createUnitOfWork` runs an operation inside a
  single transaction (commit on success, rollback on throw). Repositories will
  receive the transaction handle; they never begin/commit their own.
- `Database` is an empty typed table map until the schema batch (BE-007) adds
  tables; this keeps the pool/tx/`sql` usable without asserting a nonexistent
  schema.
- Decision: unit coverage excludes nothing new; the DB adapters are unit-covered
  by construction and integration-covered for execution.

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Unit suite | `npm run test:coverage` | 34/34 pass; 93.93% stmts / 93.02% branch / 88.23% funcs (src/db 95.23% / 100% / 83.33%) |
| Typecheck/lint/build/smoke | `npm run check` | green |
| Integration | `npm run test:integration` | 3/3 pass against PostgreSQL 16 (query + commit + rollback), ~6.3s |

## Reviews

- Code/TypeScript + security (focused inline review): explicit transaction
  boundary (no implicit commits); Kysely/pool are lazy and owned; the
  container-runtime wrapper spawns only the fixed `podman` binary and the passed
  command (argv, no shell interpolation) and only when no `DOCKER_HOST` is set;
  native `ssh2`/`cpu-features` scripts denied; `Database` empty until BE-007; no
  secret/PII. No CRITICAL/HIGH/MEDIUM. (A fuller design review remains available
  on PR #1.)

## Metrics

- Production TS added: `src/db/config.ts`, `pool.ts`, `database.ts`, `types.ts`
  (~110 lines).
- Test TS added: `src/db/config.test.ts` (4), `src/db/database.test.ts` (2),
  `test/integration/database.integration.test.ts` (3).
- Tooling TS added: `scripts/with-container-runtime.ts`,
  `vitest.integration.config.ts`.
- Production JS/JSX deleted: 0 (per BE-004 boundary). Backend backlog stays
  86 files.
- Deps (exact): `kysely` 0.29.3, `pg` 8.22.0, `@types/pg` 8.20.0,
  `testcontainers` 12.0.4, `@testcontainers/postgresql` 12.0.4.

## Risk, Rollback, And Resume

- Residual risk: local integration runs depend on the podman-service wrapper;
  real CI needs a Docker socket (documented). No schema applied outside
  ephemeral containers.
- Rollback shape: revert the BE-004 commit; no schema/provider/Legacy change.
- Commit/push: conventional commit on `ts-migration/backend`; PR #1 updated.
- Exact next action: `BE-005` migration/seed/check tooling — replace and DELETE
  `scripts/migrate.js`, `check-db.js`, `seed-auth.js` (backend JS 86 -> 83).

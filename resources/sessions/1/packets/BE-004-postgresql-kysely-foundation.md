# BE-004: PostgreSQL/Kysely Foundation

- Status: `DONE`
- Owner surface: `backend_controller/src/db/**`, `test/integration/**`,
  container-runtime tooling.
- Dependencies: BE-003 (`DONE`), CON-006 (`DONE`). GATE-02 note: the remaining
  Phase-2 workstreams (CON-007, LN-000, OPS-001, OPS-003A) are not yet closed;
  this batch was authorized ahead of the full gate to unblock the deletion-heavy
  persistence/identity/route batches (recorded deviation).
- Objective: establish the typed PostgreSQL foundation — an owned `pg` pool,
  a typed Kysely instance, an explicit transaction/unit-of-work boundary, and a
  `Database` type — proven against real PostgreSQL 16 via Testcontainers.
- Normative sources: `plans/01` §2 and Phase 3; `specifications/03` §6-§7
  (transaction/unit-of-work, repository conventions); `specifications/05`
  §3.4/§5.1 (Testcontainers `PostgreSqlContainer`, integration project); primary
  docs for Kysely 0.29, `pg` 8, testcontainers 12.
- Dominant risk: an untyped/implicitly-committing DB layer or a non-functional
  container test harness. Mitigation: repositories receive an explicit
  transaction; a real Postgres integration test proves query + commit + rollback.
- Production replacement closure: `src/db/config.ts` (Zod DB config),
  `src/db/pool.ts` (owned lazy pool), `src/db/database.ts` (Kysely instance +
  `UnitOfWork`), `src/db/types.ts` (empty `Database` map until BE-007). Adds
  `test/integration/**`, `vitest.integration.config.ts`, and
  `scripts/with-container-runtime.ts`. Deps (exact): `kysely` 0.29.3, `pg`
  8.22.0, `@types/pg` 8.20.0, `testcontainers` 12.0.4,
  `@testcontainers/postgresql` 12.0.4.
- Exact JS/JSX deletion target: none. BE-004 boundary keeps legacy DB JS
  (`src/db/*.js`) until no consumers remain; those and the operational scripts
  are deleted by BE-005 and the final DB cutover.
- Capability eval: `npm run check` (unit) stays green with >=80% coverage;
  `npm run test:integration` starts PostgreSQL 16 and proves a pooled query, a
  committed unit-of-work transaction, and a full rollback on thrown error.
- Coverage/build gates: unit `check` (typecheck, typed lint, coverage, build,
  smoke) + separate `test:integration` (Testcontainers).
- Required reviews: general/TypeScript + security (dependency install-script
  surface, the process-spawning container-runtime wrapper, no implicit commits).
- Container-runtime decision: the mandated Testcontainers harness needs a Docker
  API socket. This sandbox ships only the rootless `podman` CLI, so
  `scripts/with-container-runtime.ts` starts a temporary `podman system service`
  and disables ryuk for local runs; real CI/dev with a Docker socket is used
  unchanged. `ssh2`/`cpu-features` native install scripts are denied (optional
  SSH-transport deps, unused for a local socket); `protobufjs` approved.
- Rollback shape: revert the BE-004 commit; no schema/provider/Legacy change
  (no migrations applied outside ephemeral test containers).
- Done condition: unit + integration green; records/metrics updated; commit
  pushed to `ts-migration/backend`; PR updated; Legacy hash `d5fd7425...`.
- Phase log: [BE-004 log](../logs/BE-004-postgresql-kysely-foundation.md)

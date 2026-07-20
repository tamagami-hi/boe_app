# BE-002: Graceful API Lifecycle

- Status: `DONE`
- Owner surface: `backend_controller/src/server.ts` plus a new
  `backend_controller/src/runtime/shutdown.ts` module and its test.
- Dependencies: BE-001 (`DONE`, checkpoint `9e884ad`; current `HEAD` is
  `f991298`). No CON-006/GATE dependency; this is additive runtime hardening.
- Objective: add tested, bounded graceful shutdown so the authoritative
  TypeScript/Fastify runtime drains in-flight work and stops accepting
  connections on `SIGTERM`/`SIGINT` before the process exits, instead of relying
  on Node's default signal termination.
- Normative sources: `WORKING_MODEL.md`; `decisions/RISKS_AND_DECISIONS.md`
  (open risk: "Liveness server has no graceful signal drain ... `BE-002` before
  any stateful route or worker"); `TASKS.md` BE-002 row ("Tested signal drain
  and bounded shutdown in `server.ts`; no JS deletion"); `plans/01` Phase 2 and
  `specifications/05` §3.3 runtime scripts; Fastify v5 `close()` primary docs.
- Dominant risk: a shutdown path that either never exits (hung `close()`),
  double-runs on repeated signals, or exits without draining. Bounded-timeout,
  idempotent, and single-drain behavior is the core capability.
- Production replacement closure: additive strict TypeScript only. New
  `runtime/shutdown.ts` provides `performGracefulShutdown` and
  `registerGracefulShutdown`; `server.ts` main-module block wires them with the
  runtime logger and application. No route, DB, provider, or worker behavior is
  added.
- Exact JS/JSX deletion target: none. BE-002 deletes no legacy JavaScript; it
  hardens the already-migrated TypeScript runtime. Backend JS backlog stays at
  89 files / 12,600 lines.
- Capability eval: on a shutdown signal the runtime calls `application.close()`
  exactly once, resolves the outcome as `closed` within the bound, forces a
  `timeout` outcome when `close()` exceeds the deadline, maps a failing
  `close()` to an `error` outcome, and exits with code `0` on clean drain and
  `1` on timeout/error; repeated signals do not start a second drain.
- Regression evals: existing 18 runtime tests stay green; `/health/live` still
  returns exactly `{ "status": "ok" }`; source and emitted smoke still reach
  liveness and exit on `SIGTERM` within the smoke stop timeout; no legacy
  alias/router import is introduced in `server.ts`.
- Coverage/build/integration/E2E/image gates: `npm run check` (strict
  typecheck, typed lint, Vitest V8 coverage >=80% all metrics, production build,
  source smoke, emitted smoke). Shutdown-critical branches target >=90% branch
  coverage. No PostgreSQL/Testcontainers, E2E, or new image behavior in scope.
- Required reviews: general/TypeScript review of the diff (immutability, strict
  types, no legacy imports, function/file size limits) and a security review of
  signal handling and process-exit control (no unbounded hang, no secret in
  logs, redaction preserved).
- Rollback shape: revert the BE-002 commit; the TypeScript runtime returns to
  default signal termination. No schema, provider, or Legacy change.
- Done condition: every gate/review finding resolved; BE-002 records marked
  `DONE`; conventional commit created and pushed to `dev`; PR opened to `main`;
  Legacy tree hash still `d5fd7425...`.
- Phase log: [BE-002 log](../logs/BE-002-graceful-api-lifecycle.md)

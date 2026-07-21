# BE-002 Phase Log: Graceful API Lifecycle

Status: `DONE`

## Objective And Dependency Closure

- Objective: add tested, bounded graceful shutdown to the authoritative
  TypeScript/Fastify runtime so `SIGTERM`/`SIGINT` drains in-flight work and
  stops the listener before process exit.
- Dependencies: BE-001 (`DONE`, `9e884ad`); working tree branched from `main`
  at `f991298` on `dev`.
- Normative sources: `WORKING_MODEL.md`, `decisions/RISKS_AND_DECISIONS.md`,
  `TASKS.md` (BE-002), `plans/01` Phase 2, `specifications/05` §3.3, Fastify v5
  `close()` documentation.
- Dominant risk: hung, double-run, or non-draining shutdown.
- Intentional behavior change: the runtime now installs `SIGTERM`/`SIGINT`
  handlers and controls its own bounded exit (`0` clean, `1` timeout/error)
  instead of using Node's default signal termination.

## Atomic Units

- [x] Establish green baseline (`npm ci`, `npm run check`) before changes.
- [x] RED: `runtime/shutdown.test.ts` fails because `runtime/shutdown.ts` is
      absent.
- [x] GREEN: implement `runtime/shutdown.ts` (`performGracefulShutdown`,
      `registerGracefulShutdown`).
- [x] Wire `server.ts` main-module block to register shutdown; prove wiring via
      the strengthened source/dist smoke graceful-exit assertion.
- [x] Full `npm run check` green; coverage >=80% (shutdown branch >=90%).
- [x] Review (semantic_reviewer) resolved; records updated; commit + push to
      `dev`; PR to `main`.

## Replacement And Deletion Map

| New/replaced TypeScript | Superseded JS/JSX to delete | Guard |
|---|---|---|
| `src/runtime/shutdown.ts` (new, 127 lines) | none | Additive; backend JS backlog unchanged at 89 files |
| `src/runtime/shutdown.test.ts` (new, 185 lines, 9 tests) | none | Unit coverage of drain/exit/idempotency/ordering |
| `src/server.ts` (main block edit, +12/-5) | none | Smoke graceful-exit assertion + no legacy alias |
| `scripts/smoke-entrypoint.ts` (tooling, +40/-8) | none | Asserts SIGTERM -> exit code 0 in source and dist |

## Research And Reuse

- Repository/GitHub search: existing runtime modules (`application.ts`,
  `logger.ts`, `environment.ts`) reviewed for conventions; no new dependency.
- Primary documentation: Fastify v5 `close()` lifecycle (waits/idle-close);
  Node `process` signal handling and `AbortController`/`timers/promises`.
- Registry/license/advisory check: none needed; uses existing `fastify`,
  `pino`, Node built-ins only.
- Selected reuse/rejection: no third-party shutdown helper adopted; the drain is
  a thin, injectable wrapper over `application.close()` per the "narrow adapter,
  visible lifecycle" decision in `specifications/05` §6.

## RED Evidence

- Command: `npx vitest run src/runtime/shutdown.test.ts`.
- Expected failure signature: `Failed to load url ./shutdown.js ... Does the
  file exist?` (module absent) — observed, 0 tests ran.
- Wiring RED: `npm run smoke:source` against the un-wired server printed
  `Backend entrypoint smoke failed` because the process was terminated by the
  `SIGTERM` signal (exit via signal, not code 0).

## Implementation And Decisions

- `performGracefulShutdown` races `application.close()` against an unref'd,
  always-cleared timeout timer; resolves `closed`/`timeout`/`error` and never
  hangs unbounded. A late `close()` rejection after a timeout is absorbed by the
  race input, so there is no unhandled rejection.
- `registerGracefulShutdown` sets a synchronous `started` flag before any await,
  guaranteeing single-drain under repeated signals; exits `0` clean / `1`
  otherwise; returns an unregister function; `target` and `exit` are injectable
  for deterministic tests.
- `server.ts` main block parses env + logger once and registers shutdown after
  a successful start.
- Error/security boundaries: no secret/PII logged (pino redaction preserved,
  `base:null`); `/health/live` unchanged; no legacy alias/router import.
- Compatibility/data constraints: additive only; no schema, provider, or
  external-contract change; no JS deleted.

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Focused tests | `npx vitest run src/runtime/shutdown.test.ts` | 9/9 pass |
| Full suite | `npm run test:coverage` | 27/27 pass |
| Typecheck/lint | `npm run typecheck && npm run lint` | pass, 0 errors |
| Coverage | v8 | 93.69% stmts, 91.89% branch, 90.9% funcs (all >=80%); `shutdown.ts` 97.18%/95%/80% |
| Build/smoke | `npm run build && npm run smoke:source && npm run smoke:dist` | pass; SIGTERM -> exit 0 in both modes |
| Integration/E2E/image | n/a | out of BE-002 scope |

## Reviews

- Code/TypeScript (semantic_reviewer): no CRITICAL/HIGH. Confirmed race always
  resolves, timer unref'd + cleared, synchronous idempotency flag, correct exit
  codes, no abandoned-promise hazard, pino flushes before exit.
- Findings and regression-first fixes:
  - MEDIUM (smoke proves wiring not draining): added a deterministic drain-wait
    test proving `performGracefulShutdown` does not resolve `closed` until
    `application.close()` completes. A real-connection Fastify drain test was
    prototyped but rejected as timing-flaky (undici keep-alive socket close).
  - LOW (lingering ~2s timer in smoke stop path): fixed with `AbortController`
    to cancel the deadline on clean exit.
  - LOW (startup `.catch` could mislabel a `registerGracefulShutdown` throw as
    `BACKEND_STARTUP_FAILURE`): tracked, latent only — registration is
    synchronous and does not throw today.
- Security: signal handling is bounded, exits deterministically, leaks no
  secret; no new attack surface.

## Metrics

- Production TS/TSX added/changed: `shutdown.ts` +127; `server.ts` +12/-5.
- Test TS/TSX added/changed: `shutdown.test.ts` +185 (9 tests).
- Tooling TS added/changed: `smoke-entrypoint.ts` +40/-8.
- Production JS/JSX deleted: 0 (none in scope).
- Test JS/JSX deleted: 0.
- Remaining authored backend JS/JSX: 89 files / 12,600 lines (unchanged).

## Risk, Rollback, And Resume

- Residual risk: real per-connection drain relies on Fastify `close()` semantics
  (verified by end-to-end smoke, not a per-request unit test); revisit if a
  future stateful route needs explicit connection accounting.
- Rollback shape: revert the BE-002 commit; runtime returns to default signal
  termination. No schema/provider/Legacy change.
- Commit/push: conventional commit on `dev`, pushed; PR opened to `main`.
- Exact next action: begin `CON-006` (deterministic OpenAPI generator) — the
  prerequisite that unblocks `BE-003` config closure and the first backend JS
  deletions.

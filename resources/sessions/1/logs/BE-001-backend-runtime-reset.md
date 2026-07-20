# BE-001 Phase Log: Backend TypeScript Runtime Reset

## Objective And Closure

Replace the authoritative backend server entrypoint, tests, dev launcher, and
runtime image with a strict TypeScript/Fastify dependency closure exposing only
database-independent `GET /health/live`.

## Files And Deletion

- Added TypeScript runtime: `server.ts`, application, environment, and logger.
- Added TypeScript tests, runtime-boundary guard, and real-entrypoint smoke tool.
- Added strict compiler, Vitest, ESLint, npm-engine/install-script controls.
- Replaced Docker with digest-pinned build/runtime stages copying only `dist`.
- Deleted `src/server.js` (40 lines), `src/server.test.js` (47 lines), and
  `scripts/start-dev.js` (124 lines).

## Eval-First Evidence

- Initial RED: five suites failed because TypeScript runtime modules were absent;
  deletion guard also found the old server/test.
- Deployment RED: old Docker copied `src`, ran `src/server.js`, used DB-dependent
  `/health`, and old dev launcher remained.
- Review RED: implicit HEAD returned 200; malformed URL reflected Fastify/path
  details; nested credentials/PII leaked; host default exposed all interfaces;
  Docker was not digest-pinned; helper smokes bypassed the real CLI.
- GREEN: all regressions passed after GET-only routing, framework error mapping,
  raw-body/PII redaction, loopback default, digest pins, and child-process CLI
  smokes with hard timeouts.

## Decisions

- Fastify is the sole authoritative transport from this reset.
- Unreplaced business JS stays unreachable and outside `allowJs:false` output.
- Liveness returns exactly `{ "status": "ok" }` with no DB/config/version data.
- Default local bind is loopback; Docker explicitly selects `0.0.0.0`.
- Logs use fixed internal classifications and do not serialize raw bodies,
  provider payloads, credentials, or identified PII.

## Validation And Reviews

- Node 22.20.0/npm 11.16.0 `npm run check`: pass.
- 18/18 tests; 95.17% statements/lines, 88.88% branches, 100% functions.
- Real `src/server.ts` and `dist/server.js` process smokes: pass.
- Dependency audit: zero vulnerabilities.
- Digest-pinned image build and healthy non-root container probe: pass.
- Contracts: 113/113, 100% coverage.
- Code/TypeScript and security re-reviews: no CRITICAL/HIGH/MEDIUM.

## Risk And Rollback

Graceful signal drain remains a LOW liveness-only risk and is required in
`BE-002` before stateful routes. Revert commit `9e884ad` to roll back source;
no database state changed.

## Checkpoint

- Commit/push: `9e884ad` on `main`/`origin/main`.
- Next requested work: `DOC-001`, then `CON-006` and `BE-002`.

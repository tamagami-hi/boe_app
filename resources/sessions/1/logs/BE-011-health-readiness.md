# BE-011 Readiness and compatibility health

Status: DONE — branch `ts-migration/backend` (PR #1). Accelerated single-task
mode; no dedicated suite beyond a light `inject` unit test (health is not
security-critical, but the readiness route + aggregation warrant one).

## Change

- Added `src/runtime/health.ts`:
  - `buildReadinessReport(database, emailConfigured)` — readiness is degraded
    until the database is reachable **and** email is configured (spec 04 §6.1,
    02 §3.5).
  - `createReadinessCheck(database, emailConfigured)` — pings the database
    (`select 1`, fail-closed on throw) and returns the report; wired at
    composition time (deferred with the auth/server wiring).
  - `registerHealthRoutes(app, { checkReadiness })` — `GET /health/ready`
    returns `200 {status:"ready"}` / `503 {status:"degraded"}` as a plain
    operational body exposing only booleans (`checks.database`, `checks.email`)
    and no configuration values; `GET /v1/health` returns the versioned success
    envelope `{status:"ok"}`.
  - `/health/live` remains database-independent in `runtime/application.ts`.
- Added `src/runtime/health.test.ts` (unit, via `app.inject`): ready→200,
  degraded→503, no-leak assertion, versioned envelope shape.
- Deleted legacy `src/shared/services/healthService.js` (leaked env/provider/
  db config) and `src/shared/routes/healthRoutes.js`; both added to
  `legacy-deletion.guard.test.ts`. Verified no TS consumer.

## Verification

- `npm run check` green (typecheck + lint + coverage ≥80% aggregate + build +
  source/dist smoke asserting `/health/live`).
- `npm run test:integration` green (35/35; health is unaffected).
- Guards: `git diff --check` clean; Legacy tree hash `d5fd7425…` intact;
  backend authored JS **76 → 74**.

## Deferred

- Production composition wiring `createReadinessCheck` (real DB + emailConfigured
  env) into the running `server.ts` — tracked with the BE-010 auth/server wiring.

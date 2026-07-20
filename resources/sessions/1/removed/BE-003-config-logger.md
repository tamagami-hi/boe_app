# Removed: JavaScript Runtime Config And Logger

- Removed in: `BE-003`, on branch `ts-migration/backend` (PR #1).
- Deleted: `backend_controller/src/config/env.js` (~140),
  `backend_controller/src/config/dotenv.js` (~40),
  `backend_controller/src/shared/logger.js` (~28) — ~208 JS lines.
- Replacement: typed `src/runtime/environment.ts` (Zod-parsed
  `HOST`/`PORT`/`LOG_LEVEL`/`NODE_ENV`) and `src/runtime/logger.ts` (Pino with
  redaction), both authoritative since BE-001; Node `--env-file-if-exists`
  replaces the hand-rolled dotenv loader.
- Intentional behavior change: none for the authoritative liveness runtime. The
  legacy `loadConfig`/`assertProductionConfig` covered DB/CORS/secret/admin/
  Razorpay surfaces that do not exist in the new runtime; that typed validation
  is authored by its owning later batches (BE-004 DB, BE-006 HTTP/CORS, BE-009
  security), not preserved as JavaScript.
- Data impact: none.
- Rollback: revert the BE-003 commit; the files return as dead backlog.
- Note: dead legacy importers (e.g., `shared/services/healthService.js`) still
  reference the removed config path but are uncompiled, unlinted, unrun backlog
  deleted in their own batches.

# Removed: JavaScript Backend Server Entrypoint

- Removed in: `BE-001`, commit `9e884ad`.
- Deleted: `backend_controller/src/server.js`, `src/server.test.js`, and
  `scripts/start-dev.js` (211 JS lines total).
- Replacement: strict `server.ts`, Fastify application/environment/logger,
  Vitest coverage, real source/emitted CLI smoke, and emitted-only Docker image.
- Intentional behavior change: the old custom-router business runtime is not
  kept runnable. The authoritative interim server exposes only GET
  `/health/live`; unreplaced business JS is unreachable backlog.
- Data impact: none.
- Rollback: revert `9e884ad`; no schema/provider evidence changed.

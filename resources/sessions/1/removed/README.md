# Removed Mechanisms Index

This directory preserves concise historical records for mechanisms deleted by
completed replacement packets. It is not an active implementation backlog.

| Mechanism | Replacement | Task/commit |
|---|---|---|
| JavaScript backend server/dev launcher | Strict TypeScript/Fastify liveness runtime | [BE-001](./BE-001-javascript-server.md), `9e884ad` |
| JavaScript runtime config/logger (`config/env.js`, `config/dotenv.js`, `shared/logger.js`) | Typed `runtime/environment.ts` + `runtime/logger.ts` + Node `--env-file` | [BE-003](./BE-003-config-logger.md), on `ts-migration/backend` |
| JavaScript DB operational scripts (`migrate.js`, `check-db.js`, `seed-auth.js`) | Typed `src/scripts/migrate.ts` + `check-db.ts` over the BE-004 pool (bootstrap seed deferred to BE-007) | [BE-005](./BE-005-db-scripts.md), on `ts-migration/backend` |

Future completed packets add one removed note and link it here. The active task
ledger drops completed legacy targets while this history remains stable.

# BE-019 Retire legacy transport / persistence / route-inventory scripts

Status: DONE (deletion-only) — branch `ts-migration/backend` (PR #1). Accelerated
single-task mode. This batch takes the backend to **zero authored JavaScript**.

## Scope

The final dead legacy scaffolding. The canonical transport is `src/http/*.ts`
(boundary, errorCatalog, envelope, validation, idempotencyProtocol, cursor) and
the canonical persistence is `src/db/*.ts` (pool, database, repositories, types,
config, limits, seedCatalog). The live server is `server.ts -> createApplication`;
none of the deleted files had a TypeScript consumer, and none is wired into
`package.json` scripts or CI. The four `scripts/*.js` imported the legacy `#router`
and the already-removed `#config/env.js`, so they were dead.

## Change

Deleted (13 files):

- Legacy transport: `src/http/{errors,idempotency,response,router,validate}.js`,
  root `src/router.js`
- Legacy persistence: `src/db/{client,pgAdapter,store}.js`
- Legacy route-inventory scripts:
  `scripts/{check-admin-rbac-routes,check-auth-403-envelope,print-routes,t11-route-inventory}.js`

All registered in `legacy-deletion.guard.test.ts`. The basename-collision comments
in `errorCatalog.ts` and `idempotencyProtocol.ts` (which had explained the `*.ts`
naming to avoid resolving to the legacy `errors.js`/`idempotency.js`) were updated
to past tense now that those legacy files are gone.

## Verification

- `npm run check` green (typecheck + lint + unit coverage + build + source/dist
  smoke, including the extended deletion guard).
- `npm run test:integration` green (63/63; unaffected).
- Guards: `git diff --check` clean; Legacy tree hash `d5fd7425...` intact; backend
  authored JS/JSX **13 -> 0**; `package.json`/`package-lock.json` unchanged.

The permanent zero-JavaScript assertion is added in BE-020.

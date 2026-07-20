# BE-018 Retire remaining legacy shared block

Status: DONE (deletion-only) — branch `ts-migration/backend` (PR #1). Accelerated
single-task mode.

## Scope

The remaining `src/shared/**` legacy JavaScript: content/financial services,
contracts, route registrations, tax config, and date utilities. None appears in
spec 04's first-slice surface (which is served by `src/routes/*.ts` +
`src/runtime`), and grep confirmed **no TypeScript module imports any of them**.
They all ran on the retired JSON store or served deferred domains
(funds/receipts/timeline/courses/plans/landing/app-config), so they are retired
rather than migrated; the canonical versions are later-slice tasks.

## Change

Deleted (26 files; `src/shared/` directory now removed):

- `shared/config/{taxConfig,taxConfig.test}.js`
- `shared/contracts/{index,moneyState,payloads,receipt}.js`
- `shared/routes/{constants,index,internalRoutes,receiptRoutes,timelineRoutes}.js`
- `shared/services/{appConfigService,copyRegistry,courseService,fundCatalogService,
  fundClientView,fundClientView.test,landingConfigSchema,landingConfigSchema.test,
  landingConfigService,placeholderService,planService,receiptService,timelineService,
  withReceipt}.js`
- `shared/utils/istDate.js`

All registered in `legacy-deletion.guard.test.ts`.

## Not in this batch (BE-019)

The legacy transport (`http/{errors,idempotency,response,router,validate}.js`), the
top-level `router.js`, the legacy persistence (`db/{client,pgAdapter,store}.js`),
and the four legacy `scripts/*.js` (which import `#router`) are retired together in
BE-019, leaving BE-020 to assert zero backend JavaScript.

## Verification

- `npm run check` green (typecheck + lint + unit coverage + build + source/dist
  smoke, including the extended deletion guard).
- `npm run test:integration` green (63/63; unaffected).
- Guards: `git diff --check` clean; Legacy tree hash `d5fd7425...` intact; backend
  authored JS **39 -> 13**; `package.json`/`package-lock.json` unchanged.

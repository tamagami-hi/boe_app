# BE-015 Retire legacy client investment domain

Status: DONE (deletion-only) — branch `ts-migration/backend` (PR #1). Accelerated
single-task mode.

## Scope (same first-slice boundary as BE-013/BE-014)

Every legacy client route is financial/investment domain and none appears in spec
04's exhaustive first-slice route inventory:

- `/v1/client/dashboard`, `/portfolio`(+holdings), `/research-context`
- `/v1/products`(+`/:id`)
- `/v1/client/sips`, `/lumpsum-orders`, `/orders`(+`/:id`, pay-pending-installment)
- `/v1/client/payments`(+`/:id`, confirm-razorpay, retry)
- `/v1/client/mandates`(+`/:id`, authorize)
- `/v1/client/sip-control-requests`, `/transactions`(+`/:id`), `/statements`(+`/:id`)
- `/v1/client/notifications`(+ patch), `/kyc-status`, `/kyc-depth`
- `/v1/client/support/*`, `/withdrawals`(preview + create), `/redemptions`(+ list)

Spec 04 defers financial routes to later slices; the first-slice client surface is
native/web authentication (built in BE-010). The services also ran on the retired
JSON store (`readJsonStore`/`updateJsonStore` from `db/pgAdapter.js`) and the
deleted payment provider, against non-canonical tables. So BE-015 is a deletion
batch; the canonical client finance domain and its schema are a later-slice task
(tracked with GATE-08).

## Change

Deleted (all dead — no TypeScript module references any of them; no non-client
importer of `client/services`):
- `src/client/routes/clientRoutes.js`
- `src/client/services/{clientDataService,fundsService,kycService,mandateService,
  notificationService,orderService,paymentService,portfolioService,
  sipControlService,sipService,statementService,supportService,
  supportTicketDetailService,transactionService,withdrawalService}.js`

The `src/client/` directory is now removed. All 16 files are registered in
`legacy-deletion.guard.test.ts`. `clientRoutes.js` was already broken — it imported
`shared/routes/webhookRoutes.js`, removed in BE-014.

## Verification

- `npm run check` green (typecheck + lint + unit coverage + build + source/dist
  smoke, including the extended deletion guard).
- `npm run test:integration` green (43/43; client domain is out of scope, so
  unaffected).
- Guards: `git diff --check` clean; Legacy tree hash `d5fd7425...` intact; backend
  authored JS **67 -> 51**; `package.json`/`package-lock.json` unchanged.

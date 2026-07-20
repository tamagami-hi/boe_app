# BE-014 Retire legacy payment/mandate webhooks + provider abstractions

Status: DONE (deletion-only) — branch `ts-migration/backend` (PR #1). Accelerated
single-task mode.

## Scope (same first-slice boundary as BE-013)

The authoritative API/security spec (04) makes the current slice's webhook surface
exactly one route: `POST /v1/provider-events/aws-sns` (the signed SES/SNS email
provider-event ingress, built in BE-012). Its route inventory is declared
exhaustive for the first slice, and financial routes remain later slices.

The legacy payment/mandate provider webhooks are therefore out of first-slice
scope. They also ran entirely on the retired JSON store (`updateJsonStore` /
`readJsonStore` from `db/pgAdapter.js`) against non-canonical tables (`payments`,
`mandates`, `transactions`, `investmentPlans`) that do not exist in the canonical
schema (009-013). So BE-014 is a deletion batch; a canonical Razorpay provider and
idempotent payment/mandate evidence are a later-slice task (tracked with GATE-08 /
BE-015 / BE-017).

## Change

Deleted (all dead — no TypeScript module references any of them):
- `src/shared/routes/webhookRoutes.js`
- `src/shared/services/webhookService.js`
- `src/shared/services/payments/mockProvider.js`
- `src/shared/services/payments/providerFactory.js`
- `src/shared/services/payments/razorpayProvider.js` (the `payments/` directory is
  now empty)

All five are registered in `legacy-deletion.guard.test.ts`.

`providerFactory.js` is still imported by legacy `client/services/orderService.js`
and `sipService.js` (BE-015) and `admin/services/reconcileService.js` (BE-017);
those files gain a dangling import until their owning batches remove them, which
is harmless because they are dead legacy JS never loaded by the canonical
`server.ts` / `createApplication` (same accepted pattern as the BE-010/BE-011/BE-013
deletions).

## Verification

- `npm run check` green (typecheck + lint + unit coverage + build + source/dist
  smoke, including the extended deletion guard).
- `npm run test:integration` green (43/43; payment webhooks are out of scope, so
  unaffected).
- Guards: `git diff --check` clean; Legacy tree hash `d5fd7425...` intact; backend
  authored JS **72 -> 67**; `package.json`/`package-lock.json` unchanged.

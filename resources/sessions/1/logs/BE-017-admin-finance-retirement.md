# BE-017 Retire legacy admin finance/content domain

Status: DONE (deletion-only) — branch `ts-migration/backend` (PR #1). Accelerated
single-task mode.

## Scope (same first-slice boundary as BE-013/BE-014/BE-015)

The legacy `admin/routes/adminRoutes.js` exposes ~60 `/v1/admin/*` endpoints, all
in deferred financial/content/compliance domains and absent from spec 04's
exhaustive first-slice route inventory:

- Overview/stats, users list, approvals, KYC review, risk profiles
- Products/funds/capital-transactions/redemptions, holdings, disclosures
- Payments (reconcile/approve/reject), mandates, SIP control, reconciliation ledger
- App config, landing config, notifications, FAQs, courses, membership plans
- Support tickets

Spec 04 defers financial and content routes to later slices; the only first-slice
admin surface (application review/approval/invite + delivery inspection) is served
by `routes/adminIdentityRoutes.ts` (BE-016). The services also ran on the retired
JSON store and non-canonical tables. So BE-017 is a deletion batch; the canonical
admin finance/content domain is a later-slice task (tracked with GATE-08).

## Change

Deleted (all dead — no TypeScript module references any of them; confirmed no TS
importer of `admin/routes` or `admin/services`):

- `src/admin/routes/adminRoutes.js`
- `src/admin/services/{adminDataService,faqAdminService,fundsService,
  kycReviewService,mandateAdminService,notificationComposerService,
  paymentReconcileService,reconcileService,sipControlAdminService,
  supportTicketAdminService,userDetailService}.js`

The `src/admin/` directory is now removed. All 12 files are registered in
`legacy-deletion.guard.test.ts`. This also clears the dangling imports the BE-014
payment-provider deletion left in `reconcileService.js`.

## Verification

- `npm run check` green (typecheck + lint + unit coverage + build + source/dist
  smoke, including the extended deletion guard).
- `npm run test:integration` green (63/63; admin finance/content is out of scope,
  so unaffected).
- Guards: `git diff --check` clean; Legacy tree hash `d5fd7425...` intact; backend
  authored JS **51 -> 39**; `package.json`/`package-lock.json` unchanged.

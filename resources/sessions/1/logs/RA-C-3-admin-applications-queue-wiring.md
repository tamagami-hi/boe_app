# RA-C.3 Admin applications queue wiring

Status: DONE — branch `ts-migration/backend`. Third batch of RA-C.

Wires the admin console's approvals surface to the canonical admin identity
endpoints (spec 04 §3.2 / BE-016): the queue read and the review -> decision
handshake, over the web-cookie + CSRF transport (RA-C.1).

## Changes

- `packages/client/src/services/_util.js`: `apiRequest` now accepts per-request
  `headers` (merged last), so mutations can send `Idempotency-Key` / `If-Match`.
- **New** `packages/client/src/services/adminApplicationsApi.js`:
  - `listApplications`/`listPendingApplications` (`GET /v1/admin/applications`,
    submitted + in_review), `getApplicationDetail`,
  - `startApplicationReview` (`POST .../review`, `expectedVersion` + Idempotency-Key),
  - `decideApplication` (`POST .../decision?outcome=` + Idempotency-Key + `If-Match`),
  - `resolveApplication` — the orchestration: a `submitted` row is moved to
    `in_review` first (version increments), then decided with the post-review
    version's If-Match precondition,
  - `resendActivationInvite` (`POST /v1/admin/users/:id/activation-invites/resend`).
- `packages/admin/src/helpers/loadAdminData.js`: the `/v1/admin/approvals`
  collection + the overview pending count are now backed by the canonical
  applications queue (mapped to the approval-row shape, keeping `applicationId`
  + `version`).
- `packages/admin/src/context/LegacyAdminDataContext.jsx`: `handleUserDecision`
  now calls `resolveApplication` (review -> decision) instead of the legacy
  `PATCH /v1/admin/users/:id/status`; the rejection note becomes `reasonDetail`
  with a short `reasonCode`.

## Validation

- `cd frontend_stack && npm run build` (Vite; client + admin) green.
- Backend unchanged; the admin identity endpoints are covered by
  `adminIdentity.integration.test.ts` (queue, review, decision, resend,
  RBAC/idempotency).
- Guards: whitespace clean; Legacy hash intact; backend authored JS still 0.

## Notes / boundaries

- Other admin data collections (funds/payments/mandates/kyc/etc.) still target
  legacy endpoints that the canonical first slice does not implement; those
  screens surface load errors (expected) and belong to the later financial/admin
  domain build. Only the applications/approvals flow is canonical here.
- E2E (admin ↔ backend, same-site cookie + CSRF) runs in the user's deploy stack;
  here it is build-verified + backed by the backend admin integration tests.
- Remaining RA-C: the `/v1/client/*` financial backend routes (orders, SIPs,
  payments, executions, holdings, redemptions, mandates) over the BE-021 schema,
  built slice-by-slice with integration tests (spec 03 §6/§7), then the client
  data screens.

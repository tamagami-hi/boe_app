# BE-016 Canonical admin identity/compliance domain

Status: DONE (additive build) — branch `ts-migration/backend` (PR #1). Accelerated
single-task mode; security-critical, so it carries a real test suite (cursor unit
tests + 20 admin integration tests).

## Scope

The first non-deletion domain batch since BE-012. Spec 04 §3.2/§4.5 defines the
first-slice admin surface as the application review/approval lifecycle plus
RBAC-guarded reads; the canonical schema (010/012) already has the tables. This
batch builds that surface in TypeScript.

Endpoints (all web-cookie transport; unsafe methods require X-CSRF-Token +
Idempotency-Key; RBAC per §4.5):

- `GET /v1/admin/applications` — queue, `applications.read`, status/created-range
  filters, authenticated opaque cursor (createdAt DESC, id DESC).
- `GET /v1/admin/applications/:applicationId` — `applications.read` plus
  (`email_deliveries.read` or `email_deliveries.read_masked`); returns the
  application, consents, reviews, and a strict-safe embedded delivery page.
- `POST /v1/admin/applications/:applicationId/review` — `applications.review`;
  submitted -> in_review with `expectedVersion`, audit; stale/non-submitted is 409.
- `POST /v1/admin/applications/:applicationId/decision?outcome=` —
  `applications.decide`; If-Match version + Idempotency-Key. Approval atomically
  creates one invited user, activation invite, review, audit event, activation
  outbox event, and activation delivery; rejection creates the review, audit
  event, and a token-free rejection outbox event + delivery (no user/invite).
  Onboarding decisions use no maker-checker (§4.5).
- `POST /v1/admin/users/:userId/activation-invites/resend` — `invitations.manage`;
  verifies the expected pending invite, revokes it, issues one replacement, queues
  one delivery.
- `GET /v1/admin/email-deliveries` — full projection for `email_deliveries.read`,
  masked projection for `email_deliveries.read_masked`.

## Change

- `src/http/cursor.ts` (+unit test) — HMAC-SHA-256 authenticated opaque cursor
  binding sort values + route + filter hash + 24h expiry; fail-closed
  `CURSOR_INVALID`. `envelope.ts`/`boundary.ts` extended with an optional
  `meta.page` (backward-compatible).
- `src/domain/admin/adminAccess.ts` — resolves the web principal via
  `authenticateWebRequest` and loads live permissions; `requireAnyPermission`
  fails closed with `AUTHORIZATION_DENIED`, so a revocation denies immediately.
- `src/domain/admin/{startApplicationReview,decideApplication,resendActivationInvite}.ts`.
- Repositories: extended `applicationRepository` (findById/lockById/queue keyset/
  startReview/applyDecision/listConsentDetails/listReviews), `userRepository`
  (createInvited), `activationInviteRepository` (create/lockPendingByUserId/revoke),
  `emailDeliveryRepository` (activation/rejection delivery + adminList +
  listByApplication); new `applicationReviewRepository`.
- `src/routes/adminIdentityRoutes.ts` — the six endpoints with RBAC, cursor
  pagination, idempotency, and If-Match.

## No legacy deletion (consolidated to BE-017)

BE-016 deletes no JavaScript. All eleven legacy `admin/services/*.js` are imported
only by `admin/routes/adminRoutes.js`, and no TypeScript references any of them.
`adminRoutes.js` is BE-017's file ("final owner of `adminRoutes.js` and remaining
admin JS"), and legacy KYC (`kycReviewService`) is a deferred domain with no
canonical schema (not superseded here). Retiring the admin block as one unit in
BE-017 avoids leaving dangling imports in a BE-017-owned file. Backend authored JS
stays at **51**.

## Verification

- `npm run check` green (typecheck + lint + unit coverage incl. cursor + build +
  source/dist smoke).
- `npm run test:integration` green — 63/63 across 7 files; aggregate ≥80% branch
  over repositories/routes/domain.
- Guards: `git diff --check` clean; Legacy tree hash `d5fd7425...` intact; backend
  authored JS **51** (unchanged); `package.json`/`package-lock.json` unchanged.

## Deferred

- Production composition wiring (cursor-signing key from env, route registration)
  with the BE-010/BE-011 running-server deferral.
- PII-tombstone projection is honored in the mapper but never triggered until the
  retention/erasure jobs exist; review reason-evidence retention likewise.

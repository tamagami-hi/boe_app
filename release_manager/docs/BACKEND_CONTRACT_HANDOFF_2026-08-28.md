# Backend Contract Simplification Handoff

Date: 2026-08-28
Repository: `/home/nethunter07/PROJECTS/boe_app`
Scope: backend contracts, legacy `frontend_stack` hosted checkout, Android packaging, root release
metadata, and deployment contracts. `frontend_stack_ts` remains untouched.

## Objective

Complete the backend decisions blocking the TypeScript frontend rebuild without modifying
`frontend_stack_ts` or preserving superseded pre-production API paths.

The source decision ledger is:

- `release_manager/docs/frontend-typescript-redesign-architecture/LOGS/risk_and_decision.md`
- D-011 through D-015 are the relevant open contracts.

## Completion Status

Backend implementation is complete for D-011 through D-015:

- D-011: hosted PhonePe AutoPay setup replaces the native SDK setup/token path.
  The remaining Node SDK dependency was also removed; hosted checkout, status, refunds, and
  AutoPay now use the shared authenticated PhonePe HTTP API client directly. The Capacitor
  PhonePe plugin and native checkout bridge were removed from `frontend_stack`; both browser and
  Android now consume the same validated hosted redirect contract.
- D-012: the public consent-document route returns the canonical terms/privacy pair and fails
  closed when it cannot do so unambiguously.
- D-013: Email OTP Verification uses `not_started | pending | verified`, remains durable after
  success, and is exposed as `emailVerificationStatus`.
- D-014: account lifecycle APIs remain; suspend and close revoke all sessions atomically. Refund
  initiation remains intentionally unavailable until an atomic accounting reversal exists.
- D-015: root release version is `0.11.10`.

Verification completed on 2026-08-28:

- Exact staged snapshot `npm run check`: PASS (73 files, 675 tests, build and smoke checks;
  81.46% line/statement,
  80.04% branch, 88.54% function coverage).
- Exact staged `npm run test:integration -- --coverage.enabled=false`: PASS (19 files, 211 tests).
  Coverage is enforced by the authoritative full check above rather than by this behavioral subset.
- `release_manager/tests/deploy_env_validation.test.sh`: PASS.
- Exact staged legacy payment/native suite: PASS (5 files, 50 tests). The working tree's full
  frontend suite also passed (68 files, 891 tests), but it includes concurrent redesign changes
  intentionally excluded from this commit. Without those unrelated changes, the full staged
  frontend baseline has one known App Builder fixture failure outside the payment/native scope.
- Legacy frontend production and Android builds: PASS; bundle boot and acyclic chunk checks PASS.
- Capacitor Android sync: PASS with five reviewed common plugins and no PhonePe payment plugin.
- `release_manager/tests/apk_logging_policy.test.sh`: PASS (12 checks).
- Backend production dependency audit: zero vulnerabilities. Frontend production dependency audit
  has no HIGH or CRITICAL findings; remaining moderate React Router findings predate this change.
- Payment/auth security review: APPROVED with no CRITICAL or HIGH findings.

The remaining verification is runtime deployment against PhonePe and frontend consumption of the
new redirect/status contracts. That is not a missing backend implementation.

## Worktree Safety

The repository currently contains concurrent, uncommitted work from other agents. Do not reset,
revert, or indiscriminately stage it.

Known concurrent changes that remain out of scope for the SDK-removal commit include:

- `.github/workflows/ci.yml`
- `packages/contracts/**`
- unrelated `frontend_stack/**` redesign and fixture-removal edits
- untracked `frontend_stack_ts/`
- `release_manager/docs/frontend-typescript-redesign-architecture/**`
- existing complexity-audit documentation edits

Known pre-existing backend changes which must be reviewed before inclusion in any commit:

- `backend_controller/src/db/repositories.ts`
- `backend_controller/src/http/originExamples.test.ts`
- `backend_controller/src/routes/adminContentRoutes.ts`
- `backend_controller/src/routes/phonePeProviderEventRoutes.ts`
- `backend_controller/src/runtime/metrics.test.ts`
- `backend_controller/src/scripts/seedAuth.ts`
- `backend_controller/src/domain/payments/applyRefundOutcome.ts` (untracked)
- `backend_controller/src/domain/payments/applyRefundOutcome.test.ts` (untracked)

Use explicit path-based staging. Never use `git add .` for this worktree.

## Verified Current Backend State

### AutoPay collection

`backend_controller/src/providers/phonepe/phonePeRecurringGateway.ts` already implements the
correct recurring collection responsibility model:

```text
POST /checkout/v2/subscriptions/notify
paymentFlow.type = SUBSCRIPTION_CHECKOUT_REDEMPTION
redemptionRetryStrategy = STANDARD
autoDebit = true
```

No merchant-side Execute Redemption call exists. The collection worker schedules and notifies;
PhonePe performs the authorized debit and standard retries; the backend reconciles status and
webhooks. This behavior must remain.

### AutoPay mandate setup

Mandate authorization now uses the hosted provider path on every client platform:

- `RecurringPaymentGateway.createMandateSetup()` calls `POST /checkout/v2/pay`.
- `clientAutoPaySipRoutes.ts` returns `checkout.type = "redirect"` with an allowlisted HTTPS URL.
- migration `044_hosted_autopay_setup.sql` removes encrypted SDK-token columns and converts any
  in-flight legacy SDK attempts to a failed terminal state.
- recoverable provider-pending attempts replay the persisted hosted URL without another provider
  POST; ambiguous dispatches fail closed and rely on reconciliation.
- `frontend_stack` redirects through `CheckoutProvider` on browser and Capacitor Android alike.

No native PhonePe plugin, SDK package, SDK order endpoint, or SDK-token runtime configuration
remains in active backend or legacy frontend code.

### Public consent documents

`GET /v1/public/consent-documents` exists in the shared contract but is not registered by the
backend. The authoritative records already exist in `consent_documents` and are read through
`ConsentRepositoryImpl.findCurrentDocuments()` during `POST /newuser`.

### Email verification vocabulary

The durable user identity is `users`. Email OTP Verification is stored directly on that durable
row, including `users.email_verification_state` and `users.email_verified_at`.

Active code writes these states:

- `not_started`
- `pending`
- `verified`

Migration `040_email_verification_schema.sql` also permits `rejected`, but no active code writes
that value. `pending_verification` elsewhere is an investing-eligibility result, not an email
verification state, and must not be conflated with it.

### Admin account controls

The following routes exist and are registered in `runtime/composition.ts`:

- `GET /v1/admin/users/:userId/login-events`
- `POST /v1/admin/users/:userId/suspend`
- `POST /v1/admin/users/:userId/reinstate`
- `POST /v1/admin/users/:userId/close`

These capabilities are proportionate security and account-management features and should remain.
A security-sensitive defect requires correction: suspend and close must revoke all active sessions
inside the same transaction. Otherwise an old token may become useful again after reinstatement.

### Refunds

No production path creates a `refund_operations` row. Existing refund reconciliation changes
payment/order/refund state but does not create an allocation or `client_value_entries` reversal.
Adding refund initiation now would therefore produce inconsistent financial accounting.

Do not expose refund initiation until an explicit atomic accounting-reversal policy is designed.
The existing extracted `applyRefundOutcome` work should be reviewed and fully transition-tested;
it does not by itself make refunds a complete product feature.

### Release version

Root `VERSION` is `0.11.9`, and commit `0347ee7` already tagged that release. The next backend
contract slice must use `0.11.10`.

## Implemented Decisions for D-011 Through D-015

### D-011 — Hosted-only AutoPay mandate authorization

Use one canonical hosted flow for web and Android:

```text
POST /checkout/v2/pay
paymentFlow.type = SUBSCRIPTION_CHECKOUT_SETUP
merchantUrls.redirectUrl = validated application return URL
```

Return:

```json
{
  "checkout": {
    "type": "redirect",
    "url": "https://..."
  }
}
```

Delete the competing SDK setup path rather than keeping both. Validate the returned HTTPS URL
against `PHONEPE_CHECKOUT_ALLOWED_ORIGINS`, using the same security boundary as one-time hosted
payments.

For crash-safe replay after a completed provider dispatch, persist the already validated hosted
redirect URL with its expiry and return the same URL without another provider POST. An ambiguous
`dispatching` replay returns `checkout: null` with `mandate_setup_in_progress` and relies on status
reconciliation; it must never redispatch an uncertain financial command. No SDK token is retained.

Forward migration `044` should remove the obsolete SDK token envelope columns from
`mandate_setup_attempts`. Remove the matching token crypto/config plumbing. Keep
`PHONEPE_MERCHANT_ID`, which is still needed for provider event correlation.

Primary files:

- `backend_controller/src/providers/recurringPaymentGateway.ts`
- `backend_controller/src/providers/phonepe/phonePeRecurringGateway.ts`
- `backend_controller/src/providers/phonepe/phonePeRecurringGateway.test.ts`
- `backend_controller/src/routes/clientAutoPaySipRoutes.ts`
- `backend_controller/src/routes/clientAutoPaySipRoutes.test.ts`
- `backend_controller/src/domain/payments/mandateSetupToken.ts`
- `backend_controller/src/repositories/mandatesRepository.ts`
- `backend_controller/src/repositories/paymentsRepository.ts`
- `backend_controller/src/db/types.ts`
- `backend_controller/src/runtime/environment.ts`
- `backend_controller/src/runtime/environment.test.ts`
- `backend_controller/src/runtime/composition.ts`
- `backend_controller/src/runtime/composition.test.ts`
- `backend_controller/db/migrations/044_hosted_mandate_setup.sql`

### D-012 — Implement the public consent-document read route

Add unauthenticated `GET /v1/public/consent-documents` to
`registerPublicOnboardingRoutes()`. It must:

1. Read `terms` and `privacy` through `findCurrentDocuments()` on every request.
2. Require exactly one current document for each required kind.
3. Return `kind`, `version`, `publicPath`, `contentMarkdown`, and lowercase hexadecimal `sha256`.
4. Fail with `DEPENDENCY_UNAVAILABLE` if the canonical pair is incomplete.
5. Perform no signup-secret check because the documents are public.

Primary files:

- `backend_controller/src/routes/publicOnboardingRoutes.ts`
- the relevant public-route integration test file under `backend_controller/src/routes/`

### D-013 — Canonical Email OTP Verification state

Canonical storage and wire vocabulary:

```text
not_started | pending | verified
```

Create forward migration `045_email_verification_state_contract.sql` which maps any historical
`rejected` value to `not_started` and replaces the CHECK constraint without `rejected`. Update
`EmailVerificationState` in `src/db/types.ts` accordingly.

Email ownership verification is durable. The OTP code expires, but a successfully verified email
account does not become unverified merely because time passes. Migration `045` should therefore
also remove `users.email_verification_expires_at`; retain `users.email_verified_at`. Remove the
associated `EMAIL_VERIFICATION_VALIDITY_MS` configuration and the inherited
`email_verification_expired` eligibility branch. OTP-code expiry remains unchanged.

`pending_verification` remains valid only for the separate investing-eligibility response.

For the new frontend contract, prefer one explicit field named `emailVerificationStatus`. Avoid
maintaining multiple writable or semantically overlapping status aliases in a pre-production API.
The status response should expose `method: "email_otp"`, `startedAt`, and `verifiedAt`, without
account-verification `expiresAt` or `expired` fields.
Coordinate this wire rename with the contracts/frontend owner because `packages/contracts/**` is
currently being edited concurrently.

Primary files:

- `backend_controller/db/migrations/045_email_verification_state_contract.sql`
- `backend_controller/src/db/types.ts`
- `backend_controller/src/routes/clientEmailVerificationRoutes.ts`
- its route/integration tests
- concurrent shared contract operation owned by the TypeScript frontend task

### D-014 — Keep account controls; do not invent refund initiation

Keep login-event, suspend, reinstate, and close routes. Inject the auth-session repository into the
oversight route dependencies and call `revokeAllForUser()` for suspend and close in the same unit of
work as the account transition. Add authorization, CSRF, transition, audit, and session-revocation
tests.

Do not create a refund endpoint or UI contract in this slice. Refund completion needs a separately
approved design for atomic reversal of client value/allocation/accounting facts. Until then, the
absence of a creator is a fail-closed product boundary, not a missing CRUD handler.

Primary files:

- `backend_controller/src/routes/adminOversightRoutes.ts`
- `backend_controller/src/runtime/composition.ts`
- oversight route integration tests
- `backend_controller/src/repositories/authSessionRepository.ts` or its declared interface

### D-015 — Version

After all checks pass, change root `VERSION` from `0.11.9` to `0.11.10`. Do not retag or amend
`v0.11.9`.

## Completed TDD Sequence

1. Add failing hosted-mandate gateway tests proving `/checkout/v2/pay`, exact setup payload,
   redirect URL validation, and malformed response rejection.
2. Add failing AutoPay route tests proving redirect output, recoverable provider-pending replay,
   `checkout: null` for ambiguous dispatch, and no duplicate provider POST.
3. Add failing public-consent integration tests for the complete pair and fail-closed incomplete
   data.
4. Add failing email-state migration/type tests proving `rejected` is no longer accepted.
5. Add failing oversight tests proving suspend/close revoke sessions transactionally while
   reinstate does not resurrect them.
6. Complete the refund transition tests already requested by review: success, failure, correlation
   mismatch, and idempotent duplicate delivery.
7. Implement the minimum code required to make each test pass.

## Verification Gate Results

Run from `backend_controller`:

```bash
npm run check
```

The final exact-staged backend gate passed 73 files and 675 tests with 81.46% statement/line coverage,
80.04% branch coverage, and 88.54% function coverage. All source and distribution smoke checks
also passed. The exact staged integration invocation passed all 211 behavioral tests with coverage
disabled because this subset is not the repository-wide coverage gate; the full `npm run check`
is the authoritative coverage result.

Also run:

```bash
git diff --check
git status --short
```

Before committing, inspect the staged diff and confirm it contains only reviewed backend contract
files, the legacy hosted-checkout replacement, intended migrations, release tooling, and
`VERSION`. Payment/auth security review found no CRITICAL or HIGH issues.

## Suggested Commit Boundary

One coherent commit is acceptable if all tests pass:

```text
refactor: finalize hosted autopay backend contracts
```

If split, use:

1. `refactor: replace autopay sdk setup with hosted checkout`
2. `feat: expose canonical public consent documents`
3. `fix: finalize identity lifecycle contracts`
4. `chore: release v0.11.10`

Do not include concurrent TypeScript frontend, contracts, CI, or unrelated redesign/documentation
changes unless their owners explicitly hand them over.

## External Provider Evidence

PhonePe's official Standard Checkout AutoPay setup documentation supports hosted setup through
`POST /checkout/v2/pay`, requires `merchantUrls.redirectUrl` inside `paymentFlow`, and returns a
`redirectUrl`. The SDK setup endpoint
`POST /checkout/v2/sdk/order` is the distinct native SDK channel. Therefore hosted-only setup is a
provider-supported simplification, not an inferred adapter workaround.

The standard one-time checkout and refund integrations also use PhonePe's documented HTTP APIs:
`POST /checkout/v2/pay`, `GET /checkout/v2/order/{merchantOrderId}/status`,
`POST /payments/v2/refund`, and `GET /payments/v2/refund/{merchantRefundId}/status`. No PhonePe SDK
package remains in `backend_controller/package.json` or its lockfile.

Runtime payment and device behavior still needs deployment verification after the backend and the
new TypeScript frontend consume the final contract.

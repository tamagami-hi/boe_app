# Remaining Work and Payment-Test Readiness

**Reviewed:** 2026-08-28

**Code baseline:** working tree pending the 2026-08-28 simplification commit

**Monitoring:** intentionally outside this work

## Decision

Deploy the application to the **development/UAT VPS stack** and test real
payments there. Do not promote this build directly to production.

The repository-level checks are green, and payment testing is now the correct
next validation step because static tests cannot prove PhonePe credentials,
public webhook routing, provider correlation, worker scheduling, or real debit
and reconciliation behavior.

The development deployment may use the same PhonePe production configuration
and source behavior intended for production, as required by the product owner.
Use dedicated tester accounts and the smallest permitted payment and mandate
amounts as an operational safety control. Do not add source-level dev payment
gates or a second PhonePe implementation.

The active provider adapter follows PhonePe's product-specific Standard Checkout
AutoPay contract:

- [Redemption Notify](https://developer.phonepe.com/payment-gateway/autopay/standard-checkout/redemption-notify)
- [Redemption status](https://developer.phonepe.com/payment-gateway/autopay/standard-checkout/notification-status)
- [Subscription status](https://developer.phonepe.com/payment-gateway/autopay/standard-checkout/subscription-status-2)
- [Subscription cancellation](https://developer.phonepe.com/payment-gateway/autopay/standard-checkout/subscription-cancel)

## Preconditions before the development deployment

1. Create a `0.11.9` or newer release. The current root `VERSION` is `0.11.8`,
   while the deployment safety code assigns destructive migration 042 to schema
   family `0.11.9`. Deployment must fail closed under an older identity.
2. Push or otherwise package the exact reviewed commit and confirm that the VPS
   receives the same application images that passed verification.
3. Confirm the development stack has a recorded current release. A populated
   database with no recorded release cannot safely create a version-addressable
   backup and rollback target.
4. Inspect the development database before migration 042:
   - row counts for `users`, `kyc_cases`, `kyc_verification_codes`, and the six
     designated obsolete tables;
   - counts of verified users and their durable `users.email_verification_*`
     destination fields;
   - user relationships from SIP, mandates, orders, payments, allocations, and
     ledger history;
   - unexpected rows in obsolete tables that require archive or explicit
     disposition.
5. Allow the deployment workflow to stop database consumers and take its
   mandatory snapshot. Do not use `--skip-db-backup`.
6. Confirm development and production do not share PostgreSQL databases, Redis
   instances/volumes, environment files, callback secrets, or storage paths.
7. Confirm PhonePe credentials, environment selection, redirect URLs, webhook
   URL, webhook authorization/signature material, and public TLS routing.
8. Confirm the backend and payment, reconciliation, SIP, and mandate collection
   workers are running and reporting healthy heartbeats.

## Development/UAT payment test sequence

### 1. One-time payment success

1. Create an approved client and complete Email OTP Verification.
2. Initiate the smallest permitted lump-sum investment.
3. Complete the PhonePe payment.
4. Confirm the callback is authenticated and correlated to the merchant order.
5. Confirm one canonical result across:
   - `investment_orders`;
   - `payments`;
   - `payment_attempts`;
   - `provider_payment_details` and `provider_events`;
   - `investment_allocations`;
   - `client_value_entries`;
   - `fund_receipt_acknowledgements`;
   - notifications and audit events.
6. Confirm the client portfolio and transaction history show the same amount.

### 2. One-time payment failure and recovery

1. Exercise a cancelled or failed payment.
2. Confirm no allocation or client-value contribution is created.
3. Retry through the supported application workflow and verify that a new
   attempt does not duplicate the original order or settlement.
4. Replay or re-query the terminal provider result and verify idempotency.

### 3. SIP and AutoPay setup

1. Create a low-value SIP using a dedicated tester account.
2. Complete PhonePe Standard Checkout mandate setup.
3. Confirm `payment_mandates` reaches the active state with the expected merchant
   and provider subscription identifiers.
4. Confirm the setup webhook/status reconciliation is idempotent.

### 4. SIP collection

1. Arrange one due development SIP using controlled development data.
2. Confirm the BOE worker validates the active mandate and creates exactly one
   installment order, payment attempt, and mandate collection attempt.
3. Confirm Notify Redemption uses:
   - `/checkout/v2/subscriptions/notify`;
   - `SUBSCRIPTION_CHECKOUT_REDEMPTION`;
   - `autoDebit=true`;
   - `redemptionRetryStrategy=STANDARD`.
4. Confirm the backend does not call Execute Redemption and does not run a
   second debit-retry engine.
5. Confirm PhonePe performs the authorized debit and the webhook/status path
   settles exactly one allocation and ledger contribution.

### 5. SIP failure, restart, and reconciliation

1. Exercise a definitive provider rejection and confirm collection, payment,
   attempt, and order state close consistently without an allocation.
2. Exercise or simulate an ambiguous timeout/5xx and confirm the application
   reconciles status rather than resending a potentially accepted debit.
3. Restart the collection/reconciliation worker after Notify and confirm it
   recovers without duplicate debit or settlement.
4. Capture any persistent provider `404` after an ambiguous Notify. Do not add
   automatic resend behavior until PhonePe confirms the merchant-specific
   idempotency or terminal-not-found contract.

### 6. Mandate cancellation

1. Cancel the test mandate.
2. Confirm provider status and local mandate state reconcile.
3. Confirm no later SIP collection is dispatched against the cancelled mandate.

## Acceptance criteria before production

- Migration 042 preserves every Email-verified user and all linked financial
  history in development.
- Backup and rollback controls are exercised successfully.
- No duplicate provider debit, payment settlement, allocation, or ledger entry
  occurs during callback replay, worker restart, or status reconciliation.
- Failed payments never create client value.
- Successful payments produce one consistent order/payment/allocation/ledger
  result and matching frontend display.
- SIP setup, Notify, PhonePe-managed debit/retry, webhook reconciliation, and
  cancellation all work against the selected PhonePe environment.
- Dev PostgreSQL and Redis isolation is verified on the VPS.
- Worker health and public webhook exposure are verified.
- Operational logs contain correlation identifiers without credentials, OTPs,
  access tokens, or unredacted provider secrets.

Only after these checks pass should the same tested application artifacts be
promoted with production environment configuration.

## Open-contract closeout

The implementation contracts that could be completed from repository evidence
are closed:

| Contract | Status | Evidence |
| --- | --- | --- |
| Canonical frontend payment states | Complete | `frontend_stack/packages/shared/src/paymentStates.js` is consumed by client and admin payment displays and the client order adapter validates the client-safe status vocabulary. |
| Shared form primitive | Complete | Admin `FormField.jsx` delegates to `packages/shared/src/components/FormField.jsx` while preserving admin styling hooks. |
| Production fixture behavior | Complete | Runtime fixture-mode branches and fixture business records were removed from client/admin service modules. Network-backed services now fail through the canonical transport instead of silently presenting invented business state. |
| App configuration | Complete | `packages/shared/src/appConfig.js` now contains presentation defaults and remote transport only; the embedded product/research catalogue and stale AutoPay disclosure defaults were removed. |
| Admin legacy wrapper | Complete | The active route registry is `packages/admin/src/pages/adminRoutes.jsx`; the `pages/legacy` wrapper was removed. |
| SIP/AutoPay boundary | Complete in source | `phonePeRecurringGateway.ts` sends Notify with `autoDebit=true` and `STANDARD`; workers schedule, correlate, and reconcile without Execute Redemption or a second debit retry engine. Runtime PhonePe behavior remains a UAT gate. |
| Fund AUM authority | Decision closed | Fund AUM snapshots are intentionally an operational fund-level measure independent from the client value ledger. No automatic equality invariant is valid because their scopes differ. |
| Current rate limiting | Decision closed for one backend instance | Nginx/ingress controls, the Argon2 password gate, OTP cooldowns, and local process limiters remain the current controls. A distributed limiter is required before horizontal backend scaling, not speculatively now. The unused `RateLimitRepository` abstraction was removed. |
| Finance policy shell | Runtime abstraction removed | The obsolete seed/write abstraction was removed. The physical `finance_policy_versions` table is retained until a separately reviewed forward schema migration can prove deployed data and rollback safety. |
| Refund callback consistency | Complete | Verified refund callbacks now require a canonical local `refund_operations` row and correlated evidence before changing payment/order state. |

The API-authority work under `packages/contracts` is outside this slice because
another active workstream owns those files. This closeout deliberately does not
stage or modify that work.

## Remaining decisions and runtime gates

These are not unfinished implementation tasks that can be safely guessed from
the repository:

- **Deposits/manual receipts:** define whether money can enter outside a
  PhonePe-backed investment payment and specify its accounting evidence.
- **Withdrawals/redemptions:** define authorization, available-value rules,
  payout execution, failure recovery, and ledger semantics before restoring a
  client workflow.
- **Generic admin adjustments:** decide whether the existing controlled growth
  adjustment is sufficient. A generic principal-changing command needs explicit
  approval and audit policy.
- **Refund initiation:** `refund_operations` supports dispatch and
  reconciliation, but no production creator exists. A completed payment already
  has an allocation and contribution; therefore a refund command must atomically
  define the allocation/ledger reversal. Exposing refund creation without that
  rule would create divergent financial truth.
- **Legal holds and physical table removal:** `legal_holds`,
  `finance_policy_versions`, and `rate_limit_windows` require a forward migration
  with deployed row-count, retention, backup, and rollback evidence. Legal holds
  cannot be removed on architectural grounds alone.
- **Runtime evidence:** verify VPS dev/prod PostgreSQL and Redis isolation,
  worker scheduling/heartbeats, public PhonePe callbacks, real hosted checkout,
  AutoPay setup/Notify, and ambiguous provider recovery.

Large route-file splitting is intentionally deferred. It should happen only
when a feature change needs the affected module, using cohesive domain commands
and without adding pass-through layers. Mechanical splitting now would add
regression risk without closing a business contract.

# RA-C.5 Client order write path (createOrder + beginPayment)

Status: DONE — branch `ts-migration/backend`. Fifth batch of RA-C, and the first
canonical `/v1/client/*` **write** commands over the BE-021 investing schema
(spec 03 §5.2, §6; §2.3 eligibility). The client can now place a one-time
purchase order and initiate its payment, native-authenticated and idempotent.

## Backend

- **New** `src/repositories/orderRepository.ts` (`OrderWriteRepository`):
  - `findFundOrderTerms(fundId)` — funds ⋈ current published `fund_versions`
    (state, currency, `minimum_purchase_paise`, `minimum_sip_paise` as strings).
  - `latestCompliance(userId)` — lateral latest KYC case + latest risk assessment.
  - `createPurchase` — inserts a `purchase` order (`submitted`, `requested_at=now`).
  - `lockById({orderId,userId})` — owner-scoped `SELECT ... FOR UPDATE`.
  - `beginPayment` — guarded `UPDATE ... WHERE id AND user_id AND state='submitted'
    AND type IN ('purchase','sip_installment')` → `payment_pending`, `version+1`.
- **New** `src/repositories/paymentRepository.ts` (`PaymentWriteRepository`):
  `createWithFirstAttempt` inserts the `payments` aggregate (`created`) and its
  first `payment_attempts` row (attempt 1, provider, expiry) atomically.
- **New** `src/domain/client/createOrder.ts` — locks the user, **re-derives
  investing eligibility** from the live account state + latest KYC + latest risk
  (spec 03 §2.3; never a cached value), requires the fund published with a
  minimum, enforces `amount ≥ minimum` (exact `BigInt` paise), inserts the order,
  and appends `order.create` audit. Non-eligible maps: suspended/blocked →
  `ACCOUNT_NOT_ACTIVE`, pending-compliance → `STATE_CONFLICT`.
- **New** `src/domain/client/beginPayment.ts` — locks the order, transitions
  `submitted → payment_pending`, creates the payment + first attempt, enqueues a
  `payment` provider-call outbox event (the durable trigger the later sender
  worker consumes; no network I/O in-transaction), and appends
  `order.begin_payment` audit.
- **New** `src/routes/clientOrderRoutes.ts` — `POST /v1/client/orders`,
  `POST /v1/client/orders/:orderId/pay`. Native bearer re-check on every handler;
  both require `Idempotency-Key` and run under the DB idempotency protocol
  (`user:<id>` scope), so a replay returns the first committed result.
- `src/runtime/composition.ts` — constructs the two repositories and registers
  the routes (config: `idempotencyTtlMs`, placeholder `paymentProvider="manual"`,
  15-minute `attemptTtlMs`).

## Frontend

- `packages/client/src/services/ordersApi.js` — `createLumpsum` now posts
  `POST /v1/client/orders` (`amountPaise = round(amount·100)`, `Idempotency-Key`)
  and maps the response; new `beginOrderPayment(orderId)` →
  `POST /v1/client/orders/:id/pay`. Fixture fallbacks preserved. `createSip`
  still targets the deferred SIP endpoint.

## Validation

- `npm run check` green (313 unit; unit coverage excludes the integration-gated
  domain/repositories/routes). `npm run test:integration` — **11 files, 104
  tests** (was 94/10); aggregate branch coverage 83.4% ≥ 80%.
- **New** `test/integration/clientOrders.integration.test.ts` (10 tests): eligible
  create → `submitted`; idempotent replay (one row); below-minimum →
  `VALIDATION_FAILED`; unpublished fund → `STATE_CONFLICT`; ineligible client →
  `STATE_CONFLICT`; missing `Idempotency-Key` → 400; begin-payment →
  `payment_pending` + payment/attempt/outbox rows; pay replay + second-key
  conflict; unknown order → `RESOURCE_NOT_FOUND`; cross-user pay → 404.
- Frontend `npm run build` green. Guards: `git diff --check` clean; Legacy hash
  intact; backend authored JS still 0.

## Notes / boundaries

- Eligibility's `suspended`/`blocked` branches are unreachable via the endpoint
  (the native bearer check already rejects non-active accounts) but are enforced
  by `createOrder` under lock and unit-tested in the pure function.
- **Deferred to the next slice** (provider/ops-driven): `sendPaymentToProvider`
  (the worker that consumes the provider-call outbox), `confirmPayment`/
  `succeedPayment` (signed provider event), and `bookOrder` (`payment_confirmed →
  booked`: execution + lot + holding delta with round-half-even money math). Until
  booking lands, holdings stay empty and orders rest at `payment_pending`.
- `paymentProvider="manual"` is a placeholder until a live gateway (e.g. Razorpay)
  integration; the provider-call outbox event is already emitted for it.
- APK/emulator packaging (Capacitor/Gradle) stays on the user's local stack.

# RA-C.6 Order booking money-math (payment confirmation → booked → holdings)

Status: DONE — branch `ts-migration/backend`. Sixth batch of RA-C. Completes the
purchase-order lifecycle from `payment_pending` through to `booked`, producing
authoritative holdings via exact round-half-to-even arithmetic (spec 03 §4.3
arithmetic, §5.2, §6). Payment confirmation + booking are system/provider-driven
commands, verified by integration tests.

## Backend

- **New** `src/finance/money.ts` (+ `money.test.ts`, 14 unit tests) — the pure,
  centralized financial arithmetic. `computeAllotmentUnits(amountPaise, navText)`
  = `roundHalfEvenDiv(amountPaise · 1e14 / navScaled8)` formatted at scale 8;
  plus `parseDecimalToScaled`, `roundHalfEvenDiv` (banker's rounding), and
  `formatScaled`. All BigInt — never floating point — with rounding applied once.
  Placed under `src/finance/` (not `domain/`) so this pure module is **unit-gated**
  like the `auth`/`crypto` primitives, rather than integration-gated.
- **New** `src/repositories/holdingRepository.ts` — `findCurrentNav`
  (`as_of_date DESC, revision DESC`), `insertAllotmentExecution`, `upsertHolding`
  (`INSERT … ON CONFLICT (user_id, fund_id) DO UPDATE` adding units/cost basis,
  `version+1`), `insertLot`, `insertAllotmentMovement`.
- **New** `src/repositories/notificationRepository.ts` — `create` (allowlisted
  JSON payload; no secrets).
- `src/repositories/orderRepository.ts` — added guarded `confirmPayment`
  (`payment_pending → payment_confirmed`) and `book`
  (`payment_confirmed → booked`) transitions.
- `src/repositories/paymentRepository.ts` — added `lockByOrder`, `sendToProvider`
  (`created → provider_pending` on payment + attempt), `succeed`
  (`provider_pending → succeeded`).
- **New** `src/domain/client/confirmPayment.ts` — `sendPaymentToProvider` and
  `confirmPayment` (provider seam): `confirmPayment` validates the provider
  evidence amount/currency against the payment, succeeds the payment, and moves
  the order to `payment_confirmed`, all atomically with audit.
- **New** `src/domain/client/bookOrder.ts` — locks the order, requires a
  payment-confirmed purchase/SIP allotment and an applicable current NAV,
  computes units exactly, transitions `payment_confirmed → booked`, and appends
  the immutable allotment **execution + holding (upsert) + lot + lot movement**,
  a user notification, and audit — all in one transaction.

## Validation

- `npm run check` green (**327 unit**, was 313; +14 money-math). `npm run
  test:integration` — **12 files, 109 tests** (was 104/11); aggregate branch
  coverage 82.0% ≥ 80%.
- **New** `test/integration/clientBooking.integration.test.ts` (5 tests): the
  full `createOrder → beginPayment → sendPaymentToProvider → confirmPayment →
  bookOrder` chain allots **₹2,000 at NAV 20.00 → exactly `100.00000000` units**
  with matching holding / lot / movement / execution / succeeded payment /
  notification; a second booking increments the holding and adds a lot; booking a
  `payment_pending` order, confirming with mismatched evidence, and double-booking
  all fail with `STATE_CONFLICT` (one execution only).
- Guards: `git diff --check` clean; Legacy hash intact; backend authored JS still 0.

## Notes / boundaries

- `confirmPayment` and `bookOrder` have **no client or ops route yet** — they are
  system/provider-driven commands, exercised here via `UnitOfWork.execute` +
  the domain functions. Until a runtime trigger exists they do not run in the
  live app, so holdings populate only in tests.
- **Deferred (next slice):** the `sendPaymentToProvider` worker that drains the
  `payment` provider-call outbox topic, the signed provider webhook (real
  Razorpay) that invokes `confirmPayment`, and the ops/system trigger for
  `bookOrder` — i.e., the runtime path that reaches booking in the running app.
  Then SIPs, mandates, and redemptions.
- The manual/mock provider seam collapses the network hop; a real gateway keeps
  the same `created → provider_pending → succeeded` states with signature
  verification.
- APK/emulator packaging (Capacitor/Gradle) stays on the user's local stack.

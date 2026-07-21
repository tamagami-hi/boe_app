# RA-C.7 Payment settlement worker (runtime trigger to booking)

Status: DONE — branch `ts-migration/backend`. Seventh batch of RA-C. Closes the
runtime gap left by RA-C.6: a worker now drains the `payment` provider-call
outbox that `beginPayment` enqueues and drives each payment
`send → confirm → book`, so a paid order reaches `booked` and holdings
materialize **in the running app**, not just in tests (spec 03 §5.2, §6).

## Backend

- **New** `src/domain/client/settlePayment.ts`:
  - `settleMockPayment(tx, deps, { paymentId })` — an idempotent driver that
    resolves the payment's order/owner and advances it to booked, tolerating
    partial progress: from `payment_pending` it runs `sendPaymentToProvider →
    confirmPayment → bookOrder`; from `payment_confirmed` it just books; an
    already-`booked` order is a no-op (`already_booked`). Runs in one transaction
    (safe because the placeholder "manual" provider performs no external I/O).
  - `settleDuePayments(deps)` — one worker pass mirroring the email delivery
    worker: recover expired leases, claim a bounded batch of due `payment`
    events, and for each commit the `processing → sending` point of no return,
    settle, and mark the outbox `delivered`; failures reschedule with backoff and
    dead-letter after the maximum attempts.
- `src/repositories/paymentRepository.ts` — added `findById` so the worker can
  resolve a payment's order/owner from the outbox `aggregate_id`.
- `src/runtime/composition.ts` — new `composePaymentSettlementWorker(env)`
  (its own pool; `WORKER_ID` / `PAYMENT_WORKER_CLAIM_LIMIT` /
  `PAYMENT_WORKER_LEASE_MS` / `PAYMENT_PROVIDER` from env).
- **New** `src/paymentWorker.ts` — entrypoint that runs a single settlement pass
  and exits (cron/process-manager friendly). New npm scripts `worker:payments`
  (dist) and `worker:payments:dev` (tsx).

## Validation

- `npm run check` green (**329 unit**, was 327; +2 entrypoint). `npm run
  test:integration` — **13 files, 113 tests** (was 109/12); aggregate branch
  81.6% ≥ 80%.
- **New** `test/integration/paymentWorker.integration.test.ts` (4 tests): after
  `createOrder` + `beginPayment`, one pass books the order (₹2,000 @ NAV 20.00 →
  `100.00000000` units) with the payment succeeded and the outbox event
  `delivered`; a second pass is a no-op (the delivered event is not reclaimed,
  exactly one execution); one pass settles multiple due payments; an empty pass
  settles nothing.
- Guards: `git diff --check` clean; Legacy hash intact; backend authored JS still 0.

## How it runs end-to-end (mock provider)

1. Client: `POST /v1/client/orders` → order `submitted`.
2. Client: `POST /v1/client/orders/:id/pay` → order `payment_pending`, payment +
   attempt + a `payment` provider-call outbox event.
3. Operator/schedule: `npm run worker:payments` (one pass) → the order is
   `booked`, units allotted, holding created; `GET /v1/client/holdings` now shows
   it. Schedule the pass on a short interval (cron / process manager).

## Notes / boundaries

- The `payment` outbox topic has no HTTP consumer; only this worker drains it, so
  it is inert until the worker runs.
- **Deferred:** a real payment gateway (e.g. Razorpay) — its async dispatch +
  signed webhook would replace `settleMockPayment`'s instant success and invoke
  `confirmPayment`; the claim/lease/retry loop stays the same. `bookOrder` would
  then be triggered by settlement/ops rather than folded into the mock pass.
- Next domain slices: SIPs, mandates, redemptions; then the remaining client
  data screens. APK/emulator packaging (Capacitor/Gradle) stays on the user's
  local stack.

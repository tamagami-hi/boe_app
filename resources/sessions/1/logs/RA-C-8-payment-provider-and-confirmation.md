# RA-C.8 Env-driven payment provider + paid/failed confirmation checkpoint

Status: DONE — branch `ts-migration/backend`. Eighth batch of RA-C. Makes the
payment gateway configurable from the environment and adds the paid/not-paid
confirmation checkpoint (both outcomes), so a real provider drops in without code
changes and every payment resolves to a definite success or failure (spec 03
§5.2, §6).

## Backend

- `src/runtime/environment.ts` — new payment config from env: `PAYMENT_PROVIDER`
  (default `manual`), `PAYMENT_WEBHOOK_SECRET`, `PAYMENT_GATEWAY_KEY_ID`,
  `PAYMENT_GATEWAY_KEY_SECRET`, `PAYMENT_ATTEMPT_TTL_MS`. `serverConfig.payments`
  exposes `{ provider, autoConfirm, webhookSecret, webhookConfigured,
  gatewayKeyId, gatewayKeySecret, attemptTtlMs }`. `autoConfirm` is true only for
  the mock `manual` provider.
- **Failure path (the negative checkpoint):** `paymentRepository.fail`
  (`created|provider_pending → failed`) + `orderRepository.failPayment`
  (`payment_pending → payment_failed`) + a `failPayment` command in
  `confirmPayment.ts`.
- `src/domain/client/settlePayment.ts` — renamed the driver to
  `advancePaymentToBooked` (provider-agnostic); added `dispatchPayment`
  (dispatch-only for a real gateway) and `recordPaymentResult` (the webhook entry:
  success → advance+book, failure → fail; idempotent on a terminal order). The
  worker is now **provider-aware**: mock auto-settles to booked; a real gateway is
  only dispatched (`created → provider_pending`) and confirmed later by the
  webhook.
- **New** `src/routes/paymentWebhookRoutes.ts` — `POST /v1/provider-events/payment`,
  registered only when `PAYMENT_WEBHOOK_SECRET` is set. Verifies HMAC-SHA256 of
  the exact raw body (`x-payment-signature`, hex) fail-closed, then records the
  `succeeded`/`failed` result. Bad/missing signature → 401.
- `src/runtime/composition.ts` — the client order routes and the webhook take the
  provider/attempt window from `serverConfig.payments`; the webhook is wired only
  when configured; the worker composition sets `autoConfirm` from the provider.
- `.env.example` / `.env.production.example` — documented the payment vars.

## Validation

- `npm run check` green (329 unit). `npm run test:integration` — **14 files, 119
  tests** (was 113/13); aggregate branch 80.9% ≥ 80%.
- **New** `test/integration/paymentWebhook.integration.test.ts` (5): a signed
  success books the order + materializes the holding; success is idempotent on
  replay (`already_booked`, one execution); a signed failure sets the order
  `payment_failed` with its failure code and the payment `failed`; an invalid
  signature → 401 with no mutation; an unknown paymentId → 404.
- `paymentWorker.integration.test.ts` extended: a real-provider pass only
  *dispatches* (order stays `payment_pending`, payment `provider_pending`) and
  does not book — booking awaits the webhook.
- Guards: `git diff --check` clean; Legacy hash intact; backend authored JS still 0.

## How confirmation flows now

- **Mock (`manual`)** — `worker:payments` pass dispatches + confirms + books
  (instant). Used for local/dev.
- **Real gateway** — `worker:payments` dispatches to the gateway; the gateway's
  signed webhook hits `POST /v1/provider-events/payment` with `succeeded`
  (→ confirm + book) or `failed` (→ payment_failed). This is the recurring
  checkpoint each SIP installment payment will also pass through.

## Notes / boundaries

- The gateway's outbound API client (creating the gateway order, using
  `PAYMENT_GATEWAY_KEY_ID/SECRET`) is not implemented here — `dispatchPayment`
  currently records the `provider_pending` transition; a provider adapter slots
  into that seam. The credentials are parsed and wired so the adapter has them.
- A durable financial `provider_events` inbox (dedup/replay of raw webhook
  evidence) is the eventual home for the webhook ingress; this idempotent direct
  handler is the first slice.
- APK/emulator packaging stays on the user's local stack.

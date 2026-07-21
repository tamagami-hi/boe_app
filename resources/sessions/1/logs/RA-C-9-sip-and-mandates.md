# RA-C.9 SIP slice — mandates, lifecycle, and the recurring installment scheduler

Status: DONE — branch `ts-migration/backend`. Ninth batch of RA-C. Adds the
recurring-investment (SIP) domain over the BE-021 schema: a client creates a SIP,
requests a debit mandate, the mandate is authorized via a signed webhook, and a
scheduler then generates installment orders that flow through the existing
payment → paid/failed confirmation → booking pipeline (spec 03 §4.3, §4.4, §5.2).

## Backend

- **Repositories:** `mandateRepository` (create pending-authorization, lock,
  activate, revoke) and `sipRepository` (create, link mandate, activate,
  pause/resume/cancel/complete, advance next due date, find due active plans with
  `FOR UPDATE SKIP LOCKED`, count live plans per mandate). `orderRepository`
  gained `createSipInstallment` + `countBySipPlan`.
- **Commands** (`src/domain/client/`):
  - `sip.ts` — `createSip` (draft; eligibility re-derived under lock + fund
    published + SIP minimum), `requestSipMandate` (draft → pending_mandate; creates
    the mandate + authorization outbox), `pauseSip`/`resumeSip`/`cancelSip`
    (cancel revokes an unshared mandate).
  - `activateMandate.ts` — `activateMandate` (pending_user_authorization → active,
    activating every waiting SIP) and idempotent `recordMandateResult` (webhook
    entry: authorized → activate, failed → revoke).
  - `generateSipInstallments.ts` — the scheduler pass: for each due active SIP,
    re-check eligibility + fund publication, create a `sip_installment` order,
    begin its payment, then advance the next due date (or complete the plan when
    its duration is reached). `addMonthsKeepingDay` computes the next due date.
- **Routes:** `clientSipRoutes.ts` — native-authenticated, idempotent
  `POST /v1/client/sips`, `.../:id/mandate`, `.../:id/pause|resume|cancel`.
  `mandateWebhookRoutes.ts` — signed `POST /v1/provider-events/mandate`
  (HMAC-SHA256, env-gated) driving the mandate confirmation checkpoint.
- **Worker:** `composeSipInstallmentWorker` + `src/sipWorker.ts` entrypoint and
  `worker:sips` / `worker:sips:dev` npm scripts (one scheduler pass per
  invocation, cron-friendly).
- **Composition:** SIP routes + mandate webhook wired into `composeBackend`
  (webhook only when a secret is configured); provider/frequency from
  `serverConfig.payments`.

## Frontend

- `packages/client/src/services/ordersApi.js` — `createSip` now posts the
  canonical `POST /v1/client/sips` (rupees → paise, idempotency key); new
  `requestSipMandate`, `pauseSip`, `resumeSip`, `cancelSip`. Fixture fallbacks
  kept.

## Validation

- `npm run check` green (**331 unit**, was 329; +2 SIP worker entrypoint).
  `npm run test:integration` — **15 files, 130 tests** (was 119/14); aggregate
  branch 80.3% ≥ 80%.
- **New** `test/integration/clientSip.integration.test.ts` (11): the full
  create → mandate → authorize (webhook) → scheduler → settle chain books a
  `100.00000000`-unit installment and advances the next due date; a second pass
  does not double-charge; below-minimum → `VALIDATION_FAILED`; pause/resume/cancel
  (cancel revokes the unshared mandate); create on an unpublished fund or for an
  ineligible client → `STATE_CONFLICT`; SIP control-state guards; mandate webhook
  bad-signature (401) / unknown (404) / failed-revoke / authorized-replay
  idempotency; scheduler skips a SIP whose fund is no longer published.
- Frontend `npm run build` green. Guards: `git diff --check` clean; Legacy hash
  intact; backend authored JS still 0.

## End-to-end (mock provider)

`POST /v1/client/sips` → `.../:id/mandate` → (user authorizes) → the mandate
webhook activates the SIP → schedule `worker:sips` (generates the due installment
order) → `worker:payments` settles + books it → holdings grow each cycle.

## Notes / boundaries

- First installment is due immediately on mandate activation (mock-friendly); a
  real deployment would schedule the first debit on the next debit day.
- Installment cadence is monthly (mandate `frequency` stored; weekly/quarterly
  cadence and `pauseMandate`/`resumeMandate`/`expireMandate` are deferred).
- A failed mandate authorization revokes the mandate; its SIPs stay
  `pending_mandate` for a retry (no auto-cancel yet).
- A SIP list read endpoint and deeper UI rewiring of the mandate-authorization
  step are follow-ups. Redemptions are the next domain slice.
- APK/emulator packaging stays on the user's local stack.

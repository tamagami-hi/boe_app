# Resumption Task List - Investment/Payment/AUM Greenfield Reset

**Date:** 2026-08-20
**Source reports:** IMPLEMENTATION_STATUS_REPORT_2026-08-20.md, INVESTMENT_FUND_SIZE_CORE_MECHANISM_REPORT.md, SESSION_ANALYSIS_SUMMARY_2026-08-20.md, SPEC_ALIGNMENT_VERIFICATION_2026-08-20.md
**Working directory:** `/home/nethunter07/PROJECTS/boe_app/backend_controller`

This is the live task list being worked through in this session. Status is updated as work completes.

## 1. Fix 3 TypeScript compilation errors — ✅ DONE

- `phonePeCheckoutGateway.ts:133` — added `GatewayError` to the import list from `./paymentGateway.js`.
- `phonePeCheckoutGateway.ts:146` (`buildClient`) — cast `StandardCheckoutClient.getInstance(...)` `as unknown as PhonePeSdkClient`, since the port interface is deliberately narrowed to `unknown` for testability and the SDK's concrete request/response classes don't structurally satisfy it.
- `providerEventInboxRepository.ts:43` — added `now: Date` to the `attachPayment` input interface (implementation at line 126 already used `input.now`).

Verified: `npm run typecheck` clean, `npm test` 523/523 passing.

## 2. Deep context gathered — ✅ DONE

Dispatched a context-gatherer sub-agent to read: `clientOrderRoutes.ts`, `paymentsRepository.ts`, `refundRepository.ts`, `investmentReviewRepository.ts`, `clientValueEntryRepository.ts`, `merchantIds.ts`, `clientStatus.ts`, `providerEventRoutes.ts` (SNS pattern), `composition.ts`, `environment.ts`, migrations 017/018, `createOrder.ts`, `adminClientGrowthRoutes.ts` pattern, the architecture guard test, idempotency/permission middleware, and the frontend's `InvestmentReviewScreen.jsx` / `Transactions.jsx` / `StartSipSheet.jsx` expectations.

Key findings that refine the plan below:
- `sip_plans` table **already exists** in migration 017 with `debit_day`, `duration_months`, `state sip_state` — no new migration needed for SIP fallback.
- `paymentsRepository.ts`, `refundRepository.ts`, `investmentReviewRepository.ts` are **fully built** with guarded state-transition methods — the missing piece is only the **routes/orchestrator/worker** that call them.
- `clientValueEntryRepository.ts` is client-read-only; the contribution write lives in `investmentReviewRepository.insertContribution`.
- Admin frontend (`InvestmentReviewScreen.jsx`) expects **nested JSON** (`client: {name,email}`, `selectedFund: {name,versionId}`, `payment: {...}`, `review: {...}`), not flat columns — route serializer must reshape `ReviewQueueRow`.
- Frontend sends `expectedVersion` in the **body**, not as an `If-Match` header, for accept/reject.
- Architecture guard forbids payments/review/worker code from importing `clientValueEntryRepository`, `clientGrowthRepository`, or any AUM repo except through the one sanctioned path (`investmentReviewRepository.insertContribution`).
- Still need to check before finalizing: `frontend_stack/packages/client/src/data/clientResources.js` (`usePaymentQueue`/`useTransactions`) and `ordersApi.js` (`createSip`, `payOrder`) for exact field names client already expects.
- Permission code `investment_reviews.write` used by frontend is a guess by convention — confirm against `seedAuth.ts` / RBAC seed before hardcoding (spec says `investments.review.write` — note the frontend may use a different string; reconcile during implementation).

## 3. Two-transaction checkout orchestrator — `POST /v1/client/orders/:orderId/pay`

- TX A: `paymentsRepository.lockOrderForPayment` → `markOrderPaymentPending` → `createPayment` → `createAttempt` (stable `merchantOrderId` via `newMerchantOrderId()`), commit.
- Call `paymentGateway.createCheckout(...)` **after** TX A commits (outside any DB transaction).
- TX B: `markAttemptDispatched` (providerOrderId, checkoutExpiresAt) → `markPaymentProviderPending`, commit.
- Return `{ orderId, paymentId, provider: "phonepe", checkout: { type: "redirect", url }, expiresAt }`.
- Crash recovery: if a non-terminal attempt already exists for the order (`latestAttempt` in `created`/`provider_pending`), reuse its `merchantOrderId`; call `getOrderStatus()` first rather than creating a new attempt. After a terminal `failed`/`expired` attempt, create a new attempt with a new merchant order id.
- Must not import client-value/growth/AUM repositories (guard test).

## 4. PhonePe callback ingress — `POST /v1/provider-events/phonepe/{payment,subscription,refund}`

- Mirror the `providerEventRoutes.ts` SNS sub-plugin pattern: raw-body content-type parser, verify-then-parse, uniform failure response.
- Auth via `paymentGateway.validateShaCallback(authorizationHeader, rawBody)`.
- Insert into inbox via `providerEventInboxRepository.insertVerified` (dedup key from event+merchantOrderId+state per spec §5.4), return 2xx immediately.
- Async processing (can be inline after insert for MVP, or the worker task in item 6): on `succeeded`, in one transaction — `markAttemptSucceeded` → `markPaymentSucceeded` → `markOrderReviewPending` → `investmentReviewRepository`'s pending-review insert (via `paymentsRepository.createPendingReview`). On `failed`, mark attempt/payment/order failed, no review row.
- `/subscription` and `/refund` callback variants follow the same fast-ack/durable-inbox shape; refund callback resolves via `refundRepository.markRefunded`/`markFailed`.

## 5. Admin investment review routes — `adminInvestmentReviewRoutes.ts`

- `GET /v1/admin/investment-reviews?state=pending|accepted&cursor=` — `investmentReviewRepository.findQueuePage`, reshape `ReviewQueueRow` into the nested JSON the frontend expects.
- `GET /v1/admin/investment-reviews/:orderId` — `findDetailByOrder`.
- `POST /v1/admin/investment-reviews/:orderId/accept` — body `{bankVerified:true, expectedVersion, privateNote?}`; 9-step atomic transaction: lock order+payment+review, validate preconditions (succeeded payment, pending review, `bankVerified===true`, version match, fund not archived, no prior allocation), `insertAllocation`, `insertContribution`, `markAccepted`, `markOrderAccepted`, audit. 409 on stale version/wrong state.
- `POST /v1/admin/investment-reviews/:orderId/reject` — body `{reasonCode, expectedVersion, privateNote?}`; `markRejected` → `markOrderRefundPending` → `paymentsRepository.markPaymentRefundPending` → `refundRepository.create` (stable `merchantRefundId`, no network call in-transaction).
- `GET /v1/admin/refunds?state=` — `refundRepository.listPage`.
- `POST /v1/admin/refunds/:refundId/retry` — `refundRepository.requeue`.
- `POST /v1/admin/refunds/:refundId/reconcile` — call `paymentGateway.getRefundStatus`, apply via `markRefunded`/`markFailed`.
- Permissions: `investments.review.read`/`investments.review.write`/`refunds.write` — confirm exact seeded string. `Idempotency-Key` + CSRF required on all mutations, mirroring `adminClientGrowthRoutes.ts`.
- Wire into `composition.ts` alongside the other admin route registrations.

## 6. Payment/refund reconciliation worker

- New file (not a restore of the deleted `paymentWorker.ts`), modeled on `composeEmailDispatchWorker`'s standalone composition pattern (`{ runOnce, dispose }`).
- Poll `paymentsRepository.lockAttemptsForReconciliation` (SKIP LOCKED) → `paymentGateway.getOrderStatus(merchantOrderId)` → apply succeeded/failed/pending outcome with bounded retry/backoff.
- Poll `refundRepository.lockDueRefunds` → dispatch via `paymentGateway.initiateRefund` (first call) or `getRefundStatus` (follow-up) → apply via `markRefunded`/`markFailed`; dead-letter exhausted failures (stay in `failed` state, surfaced via the admin refunds exception queue already built).
- Must not import client-value/growth/AUM repos.

## 7. Client order list — `GET /v1/client/orders?status=`

- Read `frontend_stack/packages/client/src/data/clientResources.js` and `ordersApi.js` first to lock exact field names before finalizing.
- Repeatable canonical `?status=` params (client-safe `ClientInvestmentStatus` values from `clientStatus.ts`), owner-scoped to the authenticated user.

## 8. SIP fallback routes — `/v1/client/sips`

- `sip_plans` table already exists; no migration needed.
- `POST /v1/client/sips` (create plan, state `draft`/`active` depending on design), `GET /v1/client/sips` (list), `POST /v1/client/sips/:id/{pause,resume,cancel}`.
- Each due installment is a fresh call into the same checkout orchestrator (item 3) with `type: 'sip_installment'`, `sip_plan_id` set — no separate payment code path.
- Check `ordersApi.js`'s `createSip` call shape before finalizing request/response fields.

## 9. `appConfig.js` disclosure copy — spec §11.2

- Remove `mandateConsent` / Razorpay-era `paymentDisclosure` copy.
- Remove "units allocate at next published NAV" language.
- New copy: SIP = schedule/reminder, each installment paid by fresh PhonePe checkout, no automatic debit; one-time = PhonePe confirms then admin processes, client sees neutral "processing" status. No bank-verification/review/allocation language.

## 10. Frontend gap audit

- `Explore.jsx` — aggregate AUM display audit (remove "Trending by AUM"/"Highest AUM"/aggregate "Total AUM" unless clearly display-only per spec §11.1).
- `Transactions.jsx` — wire to whatever `GET /v1/client/orders` shape is finalized in item 7.
- `MandateDetail.jsx` — polish for SIP fallback model (no automatic-debit language).
- Admin fund workspace — audit for AUM/client totals sharing a comparison card (forbidden by spec).

## 11. Backend verification

- `npm run typecheck`, `npm test` (vitest run), `npm run build` after each major slice, not just at the end.

## 12. Integration tests

- Rebuild for: checkout orchestrator + crash recovery, callback processing to `review_pending`, admin accept → allocation+contribution, admin reject → refund created, idempotency replay, duplicate/out-of-order callback safety.
- Follow the existing pattern in `test/integration/clientGrowth.integration.test.ts` / `adminAum.integration.test.ts`.
- Note: integration tests likely need a running Postgres — per local-machine-rules steering, do not start long-running DB containers on this laptop without asking first; flag this when reached.

## 13. Frontend test suites

- Run `npm test` (or equivalent) in `frontend_stack/packages/client` and `frontend_stack/packages/admin`.

## 14. Final summary and handoff

- Document completed work, remaining deferred items (PhonePe AutoPay/UPI real recurring mandate is explicitly out of scope per spec §6.2 until merchant provisioning — fallback is intentional, not a gap), and exact VPS commands for runtime verification (sandbox PhonePe checkout, DB migration order, etc.) per local-machine-rules steering.



---

## Status: ALL TASKS COMPLETE (this session)

Every item above is done. See `SESSION_COMPLETION_REPORT_2026-08-20.md` in this same folder for the full handoff: what was built, what was verified (and how), what was NOT verified (needs VPS/PhonePe sandbox), and exact next-step commands.

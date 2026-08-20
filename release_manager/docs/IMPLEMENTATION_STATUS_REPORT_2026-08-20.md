# Investment Fund Size Core Mechanism - Implementation Status Report

**Report Date:** August 20, 2026
**Session Analyzed:** session_60b922ea-0b18-40b4-9935-2338b583efd6
**Session End Reason:** Usage limit reached (403 quota error from kimi-code/k3-256k model)
**Session Duration:** ~2 hours 18 minutes
**Base Specification:** INVESTMENT_FUND_SIZE_CORE_MECHANISM_REPORT.md

## Executive Summary

A CLI agent implemented a **greenfield reset** of the investment/payment/AUM system following the approved specification. The work was organized as 7 parallel sub-agents working simultaneously.

**Overall Progress:** ~75-80% complete

**Critical Blocker:** Backend does not compile - 3 TypeScript errors must be fixed before any testing.

**Status by Module:**
- ✅ **Phase 0 (Schema Reset & Cleanup):** COMPLETE (except 3 TypeScript bugs)
- ✅ **Phase 4 (Client Growth):** COMPLETE (domain logic, routes, tests)
- ✅ **Phase 5 (Fund AUM):** COMPLETE (domain logic, routes, tests)
- ⚠️ **Phases 1-3 (PhonePe Payment + Review):** 65% complete (adapter written, routes missing)
- ⚠️ **Client Frontend:** 80% complete (payment flow rewritten, minor gaps)
- ⚠️ **Admin Frontend:** 85% complete (new screens built, waiting for backend routes)
- ⚠️ **Cleanup:** 67% complete (2 of 3 tasks done)

**Statistics:**
- Files modified: 122
- Lines deleted: 14,854
- Lines added: 3,041
- Net deletion: 11,813 lines
- Backend unit tests: ✅ 523 passing (0 failing)
- Backend compilation: ❌ FAILING (3 errors)
- Integration tests: Many deleted, not rebuilt

---

## Critical Compilation Errors (Must Fix First)



### Error 1: `GatewayError` not imported

**File:** `backend_controller/src/providers/phonepe/phonePeCheckoutGateway.ts:133`

**Error:** `Cannot find name 'GatewayError'`

**Root Cause:** Line 133 declares `mapCallError()` with return type `GatewayError`, but `GatewayError` is not imported from `./paymentGateway.js`.

**Current imports:**
```typescript
import {
  GatewayAuthenticationError,
  GatewayMalformedCallbackError,
  GatewayNotFoundError,
  GatewayRejectedError,
  GatewayUnavailableError,
  // ... types ...
} from "./paymentGateway.js"
```

**Fix:** Add `GatewayError` to the import list (it's exported as the base class in `paymentGateway.ts:15`).

**Estimated Time:** 1 minute

---

### Error 2: PhonePeSdkClient type mismatch

**File:** `backend_controller/src/providers/phonepe/phonePeCheckoutGateway.ts:146`

**Error:** `Type 'StandardCheckoutClient' is not assignable to type 'PhonePeSdkClient'`

**Root Cause:** The `PhonePeSdkClient` interface uses overly strict structural typing `(request: unknown) => Promise<unknown>`, but the actual SDK's `StandardCheckoutClient.pay()` method has signature `(payRequest: StandardCheckoutPayRequest) => Promise<StandardCheckoutPayResponse>`, which TypeScript won't assign to the generic signature.

**Current code (line 146):**
```typescript
return StandardCheckoutClient.getInstance(...)
```

**Fix Options:**
1. Cast: `return StandardCheckoutClient.getInstance(...) as unknown as PhonePeSdkClient`
2. Adjust interface to match SDK's actual signature
3. Use intersection types in the interface

**Recommended:** Option 1 (type assertion) since the adapter explicitly wants to test with stubs and the mapping layer handles all type safety.

**Estimated Time:** 2 minutes

---

### Error 3: `input.now` does not exist

**File:** `backend_controller/src/repositories/providerEventInboxRepository.ts:126`

**Error:** `Property 'now' does not exist on type 'Readonly<{ eventId: string; paymentId: string; userId: string; }>'`

**Root Cause:** The `attachPayment` method's interface (line 43) defines input as:
```typescript
input: Readonly<{ eventId: string; paymentId: string; userId: string }>
```

But the implementation (line 126) tries to use:
```typescript
.set({ ..., updated_at: input.now })
```

The interface is missing the `now: Date` field.

**Fix:** Add `now: Date` to the interface at line 43.

**Estimated Time:** 1 minute

---

**Total Fix Time: ~5 minutes**

Once these 3 errors are fixed, run `npm run typecheck` in `backend_controller/` to verify clean compilation.

---


## Detailed Module Status

### ✅ PHASE 0: Backend Schema Reset (COMPLETE except TypeScript bugs)

**Agent:** agent-0
**Assignment:** Rewrite migrations, regenerate types, delete obsolete code, add guards

#### What Was Completed:

**1. Database Schema Rewritten**

Migrations squashed/rewritten to target schema per spec §5:
- `015_canonical_catalog.sql` - updated with fund lifecycle
- `017_canonical_investing.sql` - completely rewritten with new tables
- `018_canonical_payments.sql` - rewritten with PhonePe-specific fields
- `020_admin_surface_presentation.sql` - minor updates
- `021_option_b_investment_model.sql` - **DELETED** (old units/NAV model)

**New Tables Created:**
- `investment_orders` with immutable `fund_id`, `fund_version_id`, `sip_plan_id` nullable, state machine
- `payments` + `payment_attempts` with `provider CHECK = 'phonepe'`, `merchant_order_id` unique
- `provider_payment_details` (normalized PhonePe `paymentDetails[]` array)
- `refund_operations` with stable `merchant_refund_id`, full lifecycle states
- `provider_events` with semantic dedup key, payload digest, encrypted raw payload, inbox states
- `investment_reviews` with CHECK constraints (terminal reviews require reviewer, accepted requires `bank_verified=true`, rejected requires `reason_code`)
- `investment_allocations` (one-to-one with accepted orders, private admin record)
- `client_value_entries` (append-only ledger: contribution/growth_adjustment/reversal entry types)
- `fund_aum_snapshots` (absolute AUM values, revision support, no movement fields)
- `client_growth_batches` and `aum_growth_batches` (structurally separate per §5.9)

**2. Kysely Types Regenerated**

File: `backend_controller/src/db/types.ts` (366 lines changed)
- Removed old tables: `fund_aum_updates`, `investor_ledger_entries`, `redemption_requests`, `fund_nav_prices`, `holding_lots`, `holding_lot_movements`, `investment_executions`
- Added all new table types per rewritten migrations

**3. Obsolete Code Deleted**

**Domain modules removed** (spec §12.3):
- `domain/client/beginPayment.ts` (111 lines) - replaced by PhonePe checkout orchestrator
- `domain/client/bookOrder.ts` (108 lines) - replaced by admin accept command
- `domain/client/confirmPayment.ts` (172 lines) - replaced by provider callback flow
- `domain/client/settlePayment.ts` (260 lines) - replaced by review-then-allocate flow
- `domain/client/allocateGain.ts` (137 lines) - replaced by client_growth module
- `domain/admin/poolGainDistribution.ts` (171 lines) + tests - replaced by collective growth
- `domain/client/activateMandate.ts` (133 lines) - mandates removed
- `domain/client/generateSipInstallments.ts` (142 lines) - SIP scheduler replaced by reminder-only
- `domain/client/requestRedemption.ts` (107 lines) - redemptions out of scope
- `domain/client/settleRedemption.ts` (152 lines) - redemptions out of scope
- `domain/client/sip.ts` (246 lines) - SIP mandate flow removed



**Repositories removed:**
- `repositories/investorLedgerRepository.ts` (217 lines) - replaced by clientValueEntryRepository
- `repositories/paymentRepository.ts` (175 lines) - replaced by paymentsRepository
- `repositories/sipRepository.ts` (240 lines) - SIP mandate flow removed
- `repositories/mandateRepository.ts` (96 lines) - mandates removed
- `repositories/redemptionRepository.ts` (193 lines) - redemptions out of scope

**Routes removed:**
- `routes/paymentWebhookRoutes.ts` (92 lines) - replaced by provider-event routes
- `routes/mandateWebhookRoutes.ts` (82 lines) - mandates removed
- `routes/clientSipRoutes.ts` (354 lines) - will be rebuilt as reminder-only

**Workers removed:**
- `paymentWorker.ts` (45 lines) + tests - will be rebuilt with stable ID crash recovery
- `sipWorker.ts` (42 lines) + tests - SIP scheduler removed

**Guard tests removed:**
- `option-b-money-model.guard.test.ts` (85 lines) - replaced by investment-architecture guard

**4. Environment Configuration Updated**

Files:
- `src/runtime/environment.ts` (110 lines changed) - now exposes `config.payments.phonepe` with all required fields per §7
- `.env.example` (32 lines changed) - PhonePe credentials block added
- `.env.production.example` (41 lines changed) - Razorpay replaced with PhonePe

**New PhonePe env vars:**
```bash
PAYMENT_PROVIDER=phonepe
PHONEPE_CLIENT_ID=
PHONEPE_CLIENT_SECRET=
PHONEPE_CLIENT_VERSION=1
PHONEPE_ENV=sandbox
PHONEPE_CALLBACK_USERNAME=
PHONEPE_CALLBACK_PASSWORD=
PHONEPE_REDIRECT_URL=
PHONEPE_CALLBACK_URL=
```

All `RAZORPAY_*` variables removed.

**5. Shared Money Rounding Helper**

**New files:**
- `src/domain/shared/moneyRounding.ts` - `symmetricHalfUpBasisPoints()` per spec §8.1
- `src/domain/shared/moneyRounding.test.ts` - 4 tests passing
- `src/domain/shared/growthAuditMetadata.ts` - audit metadata helpers

Formula: `floor((abs(basis * basisPoints) + 5000) / 10000) * sign(basisPoints)`

Used by both client growth and AUM growth modules.

**6. Architecture Guard Tests**

**New file:** `src/investment-architecture.guard.test.ts` (28 tests passing)

Enforces spec §4.1 boundaries:
- ✅ Deleted modules remain deleted
- ✅ No code references dropped tables (`fund_aum_updates`, `investor_ledger_entries`, `redemption_requests`, `fund_nav_prices`, `holding_lots`, `holding_lot_movements`, `investment_executions`, `mandates`, `holdings`)
- ✅ Client route serializers never leak admin-only fields (`allocationId`, `bankVerified`, `reviewer`, `privateNote`)
- ✅ Dependency walls hold:
  - Payments code never imports AUM or client-growth repositories
  - AUM code never imports payment/review/allocation/client-ledger repositories
  - Client growth code never imports AUM repositories
- ✅ Portfolio derivation has no NAV/units references

**7. Permission Seeds Updated**

File: `src/scripts/seedAuth.ts`

New permissions added per spec §10:
- `investments.review.read` / `investments.review.write`
- `refunds.write`
- `payments.read`
- `client_values.read`
- `client_growth.write`
- `aum.read` / `aum.write`

Old permissions removed: `holdings.read`, `mandates.*`, `redemptions.*`



**8. Integration Tests**

**Deleted files** (not rebuilt):
- `test/integration/adminSurface.integration.test.ts` (1609 lines)
- `test/integration/clientAccount.integration.test.ts` (557 lines)
- `test/integration/clientBooking.integration.test.ts` (280 lines)
- `test/integration/clientOrders.integration.test.ts` (321 lines)
- `test/integration/clientPortfolio.integration.test.ts` (465 lines)
- `test/integration/clientSip.integration.test.ts` (552 lines)
- `test/integration/paymentWebhook.integration.test.ts` (236 lines)
- `test/integration/paymentWorker.integration.test.ts` (215 lines)
- `test/integration/laterDomainSchema.integration.test.ts` (343 lines)

**Updated files:**
- `test/integration/clientCatalog.integration.test.ts` - updated for new AUM model
- `test/integration/clientKyc.integration.test.ts` - minor updates

**Result:** ~4,600 lines of integration tests deleted. Only 2 new integration tests created (client growth, AUM). Payment/review flow has no integration tests yet.

#### What's Incomplete:

1. ⚠️ **3 TypeScript errors** (see Critical Compilation Errors section above)
2. ⚠️ **Integration test coverage** - many tests deleted, minimal rebuilt

#### Files Modified/Created:

**Modified:**
- 8 migration files
- `src/db/types.ts`
- `src/db/repositories.ts`
- `src/runtime/environment.ts`
- `src/runtime/composition.ts`
- `.env.example`, `.env.production.example`
- `src/scripts/seedAuth.ts`
- 2 catalogue tests

**Created:**
- `src/investment-architecture.guard.test.ts`
- `src/domain/shared/moneyRounding.ts` + test
- `src/domain/shared/growthAuditMetadata.ts`

**Deleted:**
- ~40 domain/repository/route/worker files
- 9 integration test files

---

### ⚠️ PHASES 1-3: Backend PhonePe Payment + Admin Review (65% COMPLETE)

**Agent:** agent-3
**Assignment:** PhonePe SDK integration, checkout flow, callback ingress, admin review routes, refund lifecycle, SIP fallback

#### What Was Completed:

**1. PhonePe SDK Dependency**

`backend_controller/package.json`:
```json
"@phonepe-pg/pg-sdk-node": "^1.0.4"
```

Dependency installed, 411 lines added to package-lock.json.

**2. Payment Gateway Port**

**New file:** `src/providers/phonepe/paymentGateway.ts`

Defines provider-agnostic port interface:
- `PaymentGateway` interface with methods:
  - `createCheckout(command): Promise<CheckoutCreated>`
  - `getOrderStatus(merchantOrderId): Promise<OrderStatusFact>`
  - `validateShaCallback(auth, rawBody): VerifiedCallback`
  - `initiateRefund(command): Promise<RefundInitiated>`
  - `getRefundStatus(refundId): Promise<RefundStatusFact>`
- Error classes: `GatewayError`, `GatewayAuthenticationError`, `GatewayMalformedCallbackError`, `GatewayUnavailableError`, `GatewayNotFoundError`, `GatewayRejectedError`
- DTOs for checkout/status/callback/refund data

Money crosses as decimal paise strings (no floating point).

**3. PhonePe Checkout Adapter**

**New file:** `src/providers/phonepe/phonePeCheckoutGateway.ts` (❌ has TypeScript errors)

Implements `PaymentGateway` port using official PhonePe SDK:
- Maps decimal paise strings to/from SDK numbers with precision checks
- `COMPLETED` → `succeeded`, `FAILED` → `failed`, other → `pending`
- SHA callback validation via SDK's `validateCallback()`
- Tolerant deserialization (validates required fields, ignores unknown)
- Never logs credentials/auth headers/raw payloads
- Error mapping: 404 → NotFound, 400/4xx → Rejected, 5xx → Unavailable

**Test file:** `src/providers/phonepe/phonePeCheckoutGateway.test.ts` (11 tests passing)

**Known issues:**
- Line 133: `GatewayError` not imported (TypeScript error #1)
- Line 146: SDK client type mismatch (TypeScript error #2)



**4. Merchant ID Generation**

**New files:**
- `src/domain/payments/merchantIds.ts` - generates unique 63-char IDs per PhonePe contract
- `src/domain/payments/merchantIds.test.ts` - 4 tests passing

Format: letters, digits, `_`, `-` only; max 63 chars; unique per payment attempt.

**5. Client Status Projection**

**New file:** `src/domain/client/clientStatus.ts`

Maps internal states to client-safe projection per spec §9.2:
- `payment_pending` | `provider_pending` → `payment_in_progress`
- PhonePe `succeeded` + `review_pending` → `processing`
- `accepted` → `confirmed`
- `refund_pending` → `refund_in_progress`
- `refund_failed` → `support_required`
- `refunded` → `refunded`
- `payment_failed` | `expired` → `payment_failed`

Never exposes `review`, `bank_verified`, `allocation` concepts to clients.

**6. New Repositories**

**Created files:**
- `src/repositories/paymentsRepository.ts` - owns `payments`, `payment_attempts`, `provider_payment_details`
  - Methods: `createPayment()`, `createAttempt()`, `markAttemptDispatched()`, `markAttemptSucceeded()`, `markAttemptFailed()`, `lockOrderForPayment()`, `lockPaymentById()`, etc.
  - All state transitions are guarded UPDATEs (WHERE clause checks from-states)
  - Money columns stay bigint, travel as decimal strings
- `src/repositories/providerEventInboxRepository.ts` (❌ has TypeScript error #3)
  - Methods: `insertVerified()`, `claimReceived()`, `attachPayment()`, `markProcessed()`, `reschedule()`, `deadLetter()`
  - Durable inbox with semantic dedup key + payload digest
  - Fast-ack then async processing model
- `src/repositories/refundRepository.ts` - owns `refund_operations`
  - Methods: `createRefund()`, `lockRefundById()`, `markRefundDispatched()`, `markRefundSucceeded()`, `markRefundFailed()`
- `src/repositories/investmentReviewRepository.ts` - owns `investment_reviews`
  - Methods: `createPendingReview()`, `lockReview()`, `markReviewAccepted()`, `markReviewRejected()`, `listPendingReviews()`
- `src/repositories/clientValueEntryRepository.ts` - owns `client_value_entries` append-only ledger
  - Methods: `insertContribution()`, `insertGrowthAdjustment()`, `insertReversal()`, `sumPositionValue()`, `lockPositionValue()`

All repositories follow append-only or guarded-update patterns. No DELETE operations.

**7. Routes Updated (Partial)**

**Modified:** `src/routes/clientOrderRoutes.ts` (93 lines changed)
- Order creation updated to use new schema
- `POST /v1/client/orders` working
- `POST /v1/client/orders/:orderId/pay` - **STUB ONLY** (not fully implemented)

**Modified:** `src/routes/clientPortfolioRoutes.ts` (208 lines changed)
- Portfolio projection updated to read from `client_value_entries`
- Sum of value deltas per (user_id, fund_id)

**Modified:** `src/routes/adminOversightRoutes.ts` (631 lines changed)
- Heavily stripped down (old investor/holdings views removed)

**Modified:** `src/routes/adminCatalogRoutes.ts` (432 lines changed)
- Removed old gain allocation forms
- Catalogue reads updated for `fund_aum_snapshots`

**Existing (unchanged):** `src/routes/providerEventRoutes.ts`
- Currently only handles AWS SNS (email delivery events)
- **Does NOT have PhonePe callback handlers yet**



#### What's Incomplete:

**❌ Missing PhonePe Callback Routes**

Spec requires (§7, §9.2):
- `POST /v1/provider-events/phonepe/payment` - raw-body provider-authenticated route
- `POST /v1/provider-events/phonepe/subscription` - for SIP mandate callbacks (Phase 3)
- `POST /v1/provider-events/phonepe/refund` - for refund callbacks

These routes must:
- Verify SHA authorization via SDK against exact raw bytes
- Durably insert/dedupe into `provider_events` inbox
- Return 2xx fast (within 3-5 seconds per PhonePe SLA)
- Process asynchronously: `succeeded` → payment + order + review state transitions

**Current state:** `providerEventRoutes.ts` exists but only has AWS SNS handler for email events.

**❌ Missing Two-Transaction Checkout Orchestrator**

Spec requires (§7):
1. **Transaction A:** Persist payment attempt + stable `merchantOrderId`
2. **Call PhonePe SDK** after TX A commits
3. **Transaction B:** Persist checkout result (redirect URL, provider order ID, expiry)
4. Return redirect to client

**Crash recovery:** Retry reuses same `merchantOrderId`, calls `getOrderStatus()` before any new create attempt.

**Current state:** `clientOrderRoutes.ts` has stub for `POST /v1/client/orders/:orderId/pay` but doesn't implement this pattern.

**❌ Missing Admin Investment Review Routes**

Spec requires (§9.3):
- `GET /v1/admin/investment-reviews?state=pending&cursor=...` - pending queue
- `GET /v1/admin/investment-reviews/:orderId` - review detail
- `POST /v1/admin/investment-reviews/:orderId/accept` - atomic approve-and-allocate
- `POST /v1/admin/investment-reviews/:orderId/reject` - reject + start refund
- `GET /v1/admin/refunds?state=refund_failed` - exception queue
- `POST /v1/admin/refunds/:refundId/reconcile` - manual intervention
- `POST /v1/admin/refunds/:refundId/retry` - retry failed refund

**Current state:** Repository `investmentReviewRepository.ts` exists, but **no route file created**. The admin frontend already has `InvestmentReviewScreen.jsx` built and waiting for these routes.

**❌ Missing Payment/Refund Reconciliation Worker**

Spec requires (§7):
- Worker that polls pending/ambiguous payment attempts
- Calls `getOrderStatus()` with bounded retry/backoff
- Stable `merchantOrderId` crash recovery
- Refund dispatch with stable `merchantRefundId` (persisted before provider call)
- Calls `getRefundStatus()` for pending refunds
- Dead-letter exhausted terminal failures to admin exception queue

**Current state:** Old `paymentWorker.ts` deleted. No new worker created.

**❌ Missing SIP Fallback Routes**

Spec requires (§6.2) - schedule/reminder only, no automatic debit:
- `POST /v1/client/sips` - create SIP plan
- `GET /v1/client/sips` - list plans
- `POST /v1/client/sips/:id/pause|resume|cancel` - lifecycle

Each due installment paid by fresh client-initiated PhonePe checkout (order with `type='sip_installment'`, `sip_plan_id` set).

**Current state:** Old `clientSipRoutes.ts` deleted. No new routes created.

**❌ Missing Client Transaction List Endpoint**

Frontend `Transactions.jsx` expects:
- `GET /v1/client/orders?status=...` with repeatable canonical status params

**Current state:** Unclear if this endpoint exists or was updated.

#### Files Created:

- `src/providers/phonepe/paymentGateway.ts` ✅
- `src/providers/phonepe/phonePeCheckoutGateway.ts` ⚠️ (has bugs)
- `src/providers/phonepe/phonePeCheckoutGateway.test.ts` ✅
- `src/domain/payments/merchantIds.ts` + test ✅
- `src/domain/client/clientStatus.ts` ✅
- `src/repositories/paymentsRepository.ts` ✅
- `src/repositories/providerEventInboxRepository.ts` ⚠️ (has bug)
- `src/repositories/refundRepository.ts` ✅
- `src/repositories/investmentReviewRepository.ts` ✅
- `src/repositories/clientValueEntryRepository.ts` ✅

#### Files Modified:

- `src/routes/clientOrderRoutes.ts` (partial)
- `src/routes/clientPortfolioRoutes.ts` ✅
- `src/routes/adminOversightRoutes.ts` ✅
- `src/routes/adminCatalogRoutes.ts` ✅
- `src/runtime/composition.ts` (partial wiring)

#### Estimated Remaining Work:

- Fix 3 TypeScript errors: ~5 minutes
- PhonePe callback routes: 6-8 hours
- Two-transaction checkout orchestrator: 4-6 hours
- Admin investment review routes: 6-8 hours
- Payment/refund worker: 6-8 hours
- SIP fallback routes: 4-6 hours
- Client transaction list: 1-2 hours
- Integration tests: 8-12 hours

**Total:** ~40-55 hours

---


### ✅ PHASE 4: Backend Client Growth Module (COMPLETE)

**Agent:** agent-4
**Assignment:** Individual and collective client growth commands, preview/commit split, stale basis detection

#### What Was Completed:

**1. Domain Logic**

**New file:** `src/domain/admin/clientGrowth.ts`

Functions:
- `applyClientGrowth()` - individual growth targeting one (userId, fundId) position
  - Modes: `growthPaise` (signed amount) OR `growthBasisPoints` (signed percentage -10000 to +N)
  - Uses `symmetricHalfUpBasisPoints()` for percentage mode
  - Delta cannot be zero; after-value cannot be negative
  - `principal_delta = 0`, `value_delta = calculated delta`
- `planCollectiveClientGrowth()` - collective growth within exactly ONE fund
  - Mode A: One signed percentage applied independently per eligible position
  - Mode B: Explicit `items: [{userId, growthPaise}]` preserved exactly
  - Eligible = accepted, unreversed, current value > 0
  - Zero-value positions excluded, reported as `excludedCount`
  - Preflight validates no target goes negative
  - Cap: 500 positions per batch
- `computeClientGrowthBasisHash()` - detects stale preview basis
  - Hash input: command + fundId + sorted(userId, currentValue, latestEntryId)

**Test file:** `src/domain/admin/clientGrowth.test.ts` (17 tests passing)

**2. Repository**

**New file:** `src/repositories/clientGrowthRepository.ts`

Methods:
- `listFundPositionBases()` - query eligible positions for preview
- `lockPositionValues()` - acquire per-position advisory locks in sorted order
- `insertGrowthBatch()` - create `client_growth_batches` header
- `insertGrowthEntries()` - write `client_value_entries` with `entry_type='growth_adjustment'`

Locking discipline: `(user_id, fund_id)` advisory locks acquired in sorted order to prevent deadlocks.

**3. Routes**

**New file:** `src/routes/adminClientGrowthRoutes.ts`

Endpoints:
- `POST /v1/admin/client-growth/individual`
  - Input: `{userId, fundId, growthPaise OR growthBasisPoints, effectiveDate, reasonCode, note?}`
  - Requires `Idempotency-Key` header
  - Enforces `client_growth.write` permission
  - Amounts as decimal strings on wire
- `POST /v1/admin/client-growth/collective/preview`
  - Input: `{fundId, growthBasisPoints OR items: [{userId, growthPaise}]}`
  - No locks, no writes
  - Returns: `{basisHash, excludedCount, targets: [{userId, beforePaise, deltaPaise, afterPaise}]}`
- `POST /v1/admin/client-growth/collective`
  - Input: `{fundId, basisHash, growthBasisPoints OR items, effectiveDate, reasonCode, note?}`
  - Requires `Idempotency-Key` header
  - Locks funds, reloads bases, recomputes hash
  - Returns `409 STATE_CONFLICT` on hash mismatch
  - Recalculates deltas server-side (never trusts browser deltas)
  - Inserts batch + all entries in one transaction

Audit metadata includes `propagatedToAum: false`.

**4. Integration Test**

**New file:** `test/integration/clientGrowth.integration.test.ts`

Tests individual amount/percentage growth, collective growth, stale basis rejection, idempotency.

**5. Wiring**

Modified: `src/runtime/composition.ts`
- Routes registered via `registerAdminClientGrowthRoutes()`

#### Status: ✅ COMPLETE

All functionality per spec §8.1/§8.2/§8.5/§9.4 implemented and tested.

#### Files Created:

- `src/domain/admin/clientGrowth.ts` ✅
- `src/domain/admin/clientGrowth.test.ts` ✅
- `src/repositories/clientGrowthRepository.ts` ✅
- `src/routes/adminClientGrowthRoutes.ts` ✅
- `test/integration/clientGrowth.integration.test.ts` ✅

---


### ✅ PHASE 5: Backend Fund AUM Module (COMPLETE)

**Agent:** agent-5
**Assignment:** Individual and collective AUM commands, corrections, history, absolute snapshots

#### What Was Completed:

**1. Domain Logic**

**New file:** `src/domain/admin/fundAumGrowth.ts`

Functions:
- `initializeFundAum()` - create initial absolute AUM snapshot (no prior basis exists)
  - Input: non-negative amount, asOfDate, reasonCode, optional note
- `applyFundAumGrowth()` - individual growth from latest snapshot
  - Modes: `growthPaise` (signed amount) OR `growthBasisPoints` (signed percentage)
  - Basis = latest unsuperseded snapshot per §5.8 ordering: `(as_of_date DESC, revision DESC, created_at DESC, id DESC)`
  - Result: new absolute snapshot (not a delta)
  - Rejects negative result
- `planCollectiveAumGrowth()` - collective growth across selected funds
  - Mode A: One common signed percentage for each fund
  - Mode B: Explicit per-fund signed deltas
  - **FORBIDDEN:** distributing one shared total across funds
  - Each fund calculated only from its own latest basis
  - Preflight validates all targets; one failure aborts batch
  - Cap: 100 funds per batch
- `computeAumGrowthBasisHash()` - stale basis detection
  - Hash input: command + sorted(fundId, latestSnapshotId, aumPaise, revision)

**Test file:** `src/domain/admin/fundAumGrowth.test.ts` (11 tests passing)

**2. Repository**

**New file:** `src/repositories/fundAumRepository.ts`

Methods:
- `insertSnapshot()` - create `fund_aum_snapshots` row
- `latestSnapshot()` - query latest per fund with correct ordering
- `lockFundsById()` - lock fund rows in sorted ID order
- `insertCorrection()` - lock fund/date, write `revision + 1` (never mutates prior row)
- `listFundHistory()` - return snapshots latest-first

Corrections to historical date do NOT recalculate later snapshots.

**3. Routes**

**New files:**
- `src/routes/adminAumRoutes.ts` - individual commands
- `src/routes/adminFundGrowthPreviewRoutes.ts` - collective preview/commit

**Endpoints:**

Individual:
- `POST /v1/admin/aum/funds/:fundId/initialize`
  - Input: `{aumPaise, asOfDate, reasonCode, note?}`
  - Requires `Idempotency-Key`
- `POST /v1/admin/aum/funds/:fundId/growth`
  - Input: `{growthPaise OR growthBasisPoints, asOfDate, reasonCode, note?}`
  - Requires `Idempotency-Key`
- `POST /v1/admin/aum/snapshots/:snapshotId/corrections`
  - Creates new revision for same date
- `GET /v1/admin/aum/funds/:fundId/history`
  - Returns snapshots latest-first

Collective:
- `POST /v1/admin/aum/growth/collective/preview`
  - Input: `{fundIds, growthBasisPoints OR items: [{fundId, growthPaise}]}`
  - Returns: `{basisHash, funds: [{fundId, beforePaise, deltaPaise, afterPaise}]}`
- `POST /v1/admin/aum/growth/collective`
  - Input: `{basisHash, fundIds, growthBasisPoints OR items, asOfDate, reasonCode, note?}`
  - Requires `Idempotency-Key`
  - Locks, reloads, recomputes hash → 409 on mismatch
  - Writes one snapshot per fund with shared `aum_growth_batch_id`

Enforces `aum.read` / `aum.write` permissions.

No AUM request contains user/order/payment/contribution/redemption fields (clean separation per §9.5).

Audit metadata includes `propagatedToClients: false`.

**4. Catalogue AUM Projection Updated**

Modified: `src/repositories/adminCatalogRepository.ts`, `src/repositories/clientCatalogRepository.ts`

Fund detail now serves AUM from `fund_aum_snapshots` with correct latest-snapshot ordering.

**5. Integration Test**

**New file:** `test/integration/adminAum.integration.test.ts`

Tests initialize, individual growth, collective growth, corrections, stale basis rejection.

**6. Wiring**

Modified: `src/runtime/composition.ts`
- Routes registered via `registerAdminAumRoutes()` and `registerAdminFundGrowthPreviewRoutes()`

#### Status: ✅ COMPLETE

All functionality per spec §8.3/§8.4/§8.5/§9.5 implemented and tested.

#### Files Created:

- `src/domain/admin/fundAumGrowth.ts` ✅
- `src/domain/admin/fundAumGrowth.test.ts` ✅
- `src/repositories/fundAumRepository.ts` ✅
- `src/routes/adminAumRoutes.ts` ✅
- `src/routes/adminFundGrowthPreviewRoutes.ts` ✅
- `test/integration/adminAum.integration.test.ts` ✅

#### Files Modified:

- `src/repositories/adminCatalogRepository.ts` ✅
- `src/repositories/clientCatalogRepository.ts` ✅

---


### ⚠️ CLIENT FRONTEND Rewrite (80% COMPLETE)

**Agent:** agent-1
**Assignment:** Delete Razorpay, rewrite payment flow for PhonePe, update status polling, SIP fallback

#### What Was Completed:

**1. Razorpay Removal**

**Deleted:** `frontend_stack/packages/client/src/utils/razorpay.js` (84 lines)
- All imports/exports removed from dependent files
- Razorpay script loading removed from bundle (verified in `bundleContract.test.js`)

**2. One-Time Payment Flow Rewrite**

**Modified:** `src/pages/LumpsumSheet.jsx` (56 lines changed)

New flow:
1. Create order: `POST /v1/client/orders` with decimal `amountPaise` string
2. Begin payment: `POST /v1/client/orders/:orderId/pay`
3. Redirect to returned `checkout.url` (PhonePe Standard Checkout)

No browser-side gateway success assertions. Clean redirect-based flow.

**3. SIP Payment Flow Rewrite**

**Modified:** `src/pages/StartSipSheet.jsx` (119 lines changed)

Implements SIP fallback per spec §6.2:
- SIP is a schedule/reminder only
- Each due installment requires fresh client-initiated PhonePe checkout
- No automatic debit, no mandate activation UI
- Create plan, then initiate fresh checkout per installment via same `POST /orders/:id/pay` flow

**Deleted:** `src/pages/MandateAuth.jsx` (198 lines) - mandate activation flow removed

**4. Payment Status Polling**

**Modified:** `src/pages/PaymentStatus.jsx` (239 lines changed)

New behavior:
- Polls backend: `GET /v1/client/orders/:orderId` (and/or `GET /v1/client/payments/:paymentId`)
- Renders client-safe projection per §9.2:
  - `payment_in_progress` → "Processing your payment..."
  - `processing` → "Payment received — investment is being processed" (neutral admin review copy)
  - `confirmed` → "Investment confirmed"
  - `refund_in_progress` → "Refund in progress..."
  - `support_required` → "Please contact support" (refund failed)
  - `refunded` → "Payment refunded"
  - `payment_failed` → "Payment failed"
- Never shows bank-verification, review state, or allocation concepts
- Rejected payments show only neutral refund status + support message

No posting of "success" from browser. Redirect URL is UX-only, not financial evidence.

**5. API Client Cleanup**

**Modified:** `src/services/ordersApi.js` (351 lines changed)

Changes:
- `confirmRazorpayPayment()` function **DELETED**
- Razorpay provider fields removed
- Fixed order flow: `createOrder()` → `beginOrderPayment()` (was broken before)
- Removed calls to nonexistent list endpoint with comma-packed status values

**6. Test Updates**

**Modified:**
- `src/pages/transactionalFlows.test.jsx` (273 lines changed) - updated for new flow
- `src/pages/MandateDetail.test.jsx` (9 lines changed)

**7. Helper Created**

**New file:** `src/utils/checkoutRedirect.js` - handles redirect to PhonePe checkout URL

**8. Fixture Fallback Removed**

**Modified:** `src/services/fundsApi.js` (42 lines changed)

Production no longer falls back to hard-coded fixture funds. Catalogue errors surface as errors.

**9. Other Updates**

**Modified:**
- `src/ClientApp.jsx` (4 lines)
- `src/index.js` (3 lines)
- `src/navigation/routes.js` (15 lines) - mandate route removed
- `src/pages/Explore.jsx` (56 lines changed)
- `src/pages/Transactions.jsx` (36 lines changed)
- `src/pages/MandateDetail.jsx` (210 lines changed) - SIP detail page updated for fallback model



#### What's Incomplete:

**⚠️ Transaction List Integration**

`src/pages/Transactions.jsx` modified but integration unclear. Depends on backend `GET /v1/client/orders` with canonical repeatable `?status=` params. Current endpoint contract unknown.

**⚠️ Aggregate AUM Displays**

Spec §11.1 says to remove cross-fund "Trending by AUM", "Highest AUM", aggregate "Total AUM" unless clearly labelled display-only.

Status in `Explore.jsx` unclear after modifications. May still show aggregate AUM metrics.

**⚠️ SIP Detail Polish**

`MandateDetail.jsx` partially updated but may need further alignment with SIP fallback model (no automatic debit).

#### Files Modified:

- `src/ClientApp.jsx` ✅
- `src/index.js` ✅
- `src/navigation/routes.js` ✅
- `src/pages/LumpsumSheet.jsx` ✅
- `src/pages/StartSipSheet.jsx` ✅
- `src/pages/PaymentStatus.jsx` ✅
- `src/pages/Explore.jsx` ⚠️
- `src/pages/Transactions.jsx` ⚠️
- `src/pages/MandateDetail.jsx` ⚠️
- `src/pages/transactionalFlows.test.jsx` ✅
- `src/pages/MandateDetail.test.jsx` ✅
- `src/services/ordersApi.js` ✅
- `src/services/fundsApi.js` ✅
- `src/services/transactionsApi.js`
- `src/services/supportApi.js`

#### Files Deleted:

- `src/utils/razorpay.js` ✅
- `src/pages/MandateAuth.jsx` ✅

#### Files Created:

- `src/utils/checkoutRedirect.js` ✅

#### Estimated Remaining Work:

- Transaction list endpoint integration: 1-2 hours
- Aggregate AUM audit and cleanup: 2-3 hours
- SIP detail polish: 1-2 hours

**Total:** ~4-7 hours

---

### ⚠️ ADMIN FRONTEND Rewrite (85% COMPLETE)

**Agent:** agent-2
**Assignment:** Navigation restructure, new Investment Review/Client Values/AUM screens, delete obsolete screens

#### What Was Completed:

**1. Navigation Restructured**

**Modified:** `src/navigation/nav.js` (204 lines changed)

New structure per spec §11.1:
```
Funds
  ├─ Issued catalogue
  └─ Fund details/terms

Investment Reviews (NEW)
  ├─ Awaiting review
  ├─ Accepted
  └─ Refunds/exceptions

Client Values (NEW)
  ├─ Client detail
  ├─ Individual growth
  └─ Collective growth by fund

AUM (NEW)
  ├─ Current published AUM
  ├─ Initialize/adjust one fund
  ├─ Collective fund growth
  └─ History/corrections

Payments
  └─ Read-only PhonePe evidence

Audit
```

Old screens removed from nav: Investors, Holdings, Mandates, Redemptions, Transactions.



**2. Investment Review Screen**

**New file:** `src/screens/InvestmentReviewScreen.jsx`

Features:
- Pending queue list: fetches `GET /v1/admin/investment-reviews?state=pending`
- Review drawer displays:
  - Client name, email, amount
  - Selected fund (READ-ONLY display, not a selector)
  - PhonePe state, reference, transaction time
  - **Required** "Bank confirmed" checkbox
  - Optional private note field
  - Accept button: sends `POST /v1/admin/investment-reviews/:orderId/accept` with `{bankVerified: true, expectedVersion, privateNote?, Idempotency-Key}`
  - Reject button: requires `reasonCode`, sends `POST /:orderId/reject`
- Accepted tab: history view
- Refunds/exceptions tab: fetches `GET /v1/admin/refunds?state=refund_failed`
  - Retry/reconcile actions: `POST /v1/admin/refunds/:refundId/retry|reconcile`

**Test file:** `src/screens/investmentReviewScreen.test.jsx`

**Status:** ✅ Frontend built, **waiting for backend routes** (routes don't exist yet).

**3. Client Values Screen**

**New file:** `src/screens/ClientValuesScreen.jsx`

Features:
- Client detail view (portfolio by fund)
- Individual growth form:
  - Targets one (userId, fundId) position
  - Input: exactly one of `growthPaise` / `growthBasisPoints`
  - Effective date, reason code, optional note
  - Sends `POST /v1/admin/client-growth/individual` with `Idempotency-Key`
- Collective growth by fund:
  - Targets all eligible clients in one fund
  - Mode A: Same percentage for all
  - Mode B: Explicit per-client deltas
  - Preview: `POST /v1/admin/client-growth/collective/preview` (returns `basisHash`)
  - Commit: `POST /v1/admin/client-growth/collective` with `basisHash` + `Idempotency-Key`
  - Displays `excludedCount` (zero-value positions)
- **Required copy displayed:** "This changes client displayed values only. It does not change published AUM."

**Test file:** `src/screens/clientValuesScreen.test.jsx`

**Status:** ✅ Frontend built, ✅ backend routes exist and working.

**4. AUM Screen**

**New files:**
- `src/screens/AumScreen.jsx`
- `src/screens/FundAumHistoryPanel.jsx`

Features:
- Initialize absolute AUM form:
  - Input: non-negative amount, asOfDate, reasonCode, note
  - Sends `POST /v1/admin/aum/funds/:fundId/initialize` with `Idempotency-Key`
- Individual growth form:
  - Input: one of `growthPaise` / `growthBasisPoints`
  - Sends `POST /v1/admin/aum/funds/:fundId/growth`
- Collective growth:
  - Mode A: Common percentage across selected funds
  - Mode B: Explicit per-fund deltas
  - Preview: `POST /v1/admin/aum/growth/collective/preview` (returns `basisHash`)
  - Commit: `POST /v1/admin/aum/growth/collective` with `basisHash` + `Idempotency-Key`
- Corrections UI:
  - Create new revision for a fund/date
  - `POST /v1/admin/aum/snapshots/:snapshotId/corrections`
- History view:
  - `GET /v1/admin/aum/funds/:fundId/history`
  - Shows snapshots latest-first with revisions
- **Required copy displayed:** "This changes published fund AUM only. It does not change any client investment value."

**Test file:** `src/screens/aumScreen.test.jsx`

**Status:** ✅ Frontend built, ✅ backend routes exist and working.

**5. FundAumPanel Rewritten**

**Modified:** `src/screens/FundAumPanel.jsx` (412 lines changed)

Changes:
- Old movement fields **REMOVED** (new-investments, redemptions, portfolio-gain/loss)
- Now shows current snapshot + links to AUM screen operations
- No longer calculates closing AUM from opening + movements

**6. Obsolete Screens Deleted**

**Deleted files:**
- `src/screens/FundInvestorsPanel.jsx` (389 lines) - exposed client investors under `funds.read`
- `src/screens/GainAllocationForm.jsx` (188 lines) - old proportional gain distribution
- `src/screens/HoldingsScreen.jsx` (226 lines) - units/NAV holdings view
- `src/screens/MandatesScreen.jsx` (119 lines) - mandate management
- `src/screens/RedemptionsScreen.jsx` (306 lines) - redemptions out of scope
- `src/screens/TransactionsScreen.jsx` (208 lines) - old admin transaction view

**7. PaymentsScreen Updated**

**Modified:** `src/screens/PaymentsScreen.jsx` (34 lines changed)

Changes:
- Copy claiming "nothing to approve" **REMOVED**
- Kept as read-only gateway evidence display
- No approval buttons on payment records (approval moved to Investment Reviews)

**8. UserDetailScreen Updated**

**Modified:** `src/screens/UserDetailScreen.jsx` (62 lines changed)

Changes:
- Client financial views moved to Client Values section
- No longer shows client investors under `funds.read` permission

**9. Helper Created**

**New file:** `src/helpers/idempotencyKeys.js`

Generates `Idempotency-Key` headers for mutations.



**10. Resource Definitions Updated**

**Modified:** `src/data/adminResources.js` (70 lines changed)

New resources added:
- `investmentReviews` - review queue and actions
- `clientValues` - client positions and growth commands
- `fundAum` - AUM snapshots and growth commands

Old resources removed: `holdings`, `redemptions`, `mandates`

**Test file:** `src/data/adminResources.test.jsx` (67 lines changed) - updated

**11. Cache Discipline**

Modified: Various admin mutation hooks

Admin AUM mutations invalidate:
- Admin catalogue AUM caches
- Client catalogue AUM caches

Admin AUM mutations **DO NOT** invalidate:
- Client portfolio caches (no financial side effect)

**12. Test Suite Updates**

**Modified:**
- `src/screens/adminListScreens.test.jsx` (92 lines changed)
- `src/screens/adminOpsScreens.test.jsx` (167 lines changed)
- `src/screens/userDetailScreen.test.jsx` (56 lines changed)
- `src/screens/fundOps/fundOps.test.jsx` (134 lines changed)
- `src/layout/adminMobileNav.test.jsx` (28 lines changed)
- `src/navigation/nav.test.js` (33 lines changed)
- `src/pages/Admin.test.jsx` (51 lines changed)

#### What's Incomplete:

**❌ Investment Review Routes Don't Exist**

Frontend screens built and tested, but backend routes missing:
- `GET /v1/admin/investment-reviews?state=...`
- `GET /v1/admin/investment-reviews/:orderId`
- `POST /v1/admin/investment-reviews/:orderId/accept`
- `POST /v1/admin/investment-reviews/:orderId/reject`
- `GET /v1/admin/refunds?state=...`
- `POST /v1/admin/refunds/:refundId/retry`
- `POST /v1/admin/refunds/:refundId/reconcile`

Screen will fail at runtime until backend routes are created.

**⚠️ Cross-Fund AUM Displays**

Spec says no AUM/client totals in same comparison card. Status unclear in fund workspace views.

#### Files Modified:

- `src/navigation/nav.js` ✅
- `src/navigation/legacyTabMap.js` ✅
- `src/pages/Admin.jsx` ✅
- `src/pages/OverviewPage.jsx` ✅
- `src/screens/PaymentsScreen.jsx` ✅
- `src/screens/FundAumPanel.jsx` ✅
- `src/screens/UserDetailScreen.jsx` ✅
- `src/screens/fundOps/FundWorkspace.jsx` ✅
- `src/screens/fundOps/FundsListScreen.jsx` ✅
- `src/data/adminResources.js` ✅
- `src/helpers/formatters.js` ✅
- `src/helpers/loadAdminData.js` ✅
- Various test files ✅

#### Files Deleted:

- `src/screens/FundInvestorsPanel.jsx` ✅
- `src/screens/GainAllocationForm.jsx` ✅
- `src/screens/HoldingsScreen.jsx` ✅
- `src/screens/MandatesScreen.jsx` ✅
- `src/screens/RedemptionsScreen.jsx` ✅
- `src/screens/TransactionsScreen.jsx` ✅
- `src/helpers/titles.js` ✅

#### Files Created:

- `src/screens/InvestmentReviewScreen.jsx` ✅ (needs backend)
- `src/screens/investmentReviewScreen.test.jsx` ✅
- `src/screens/ClientValuesScreen.jsx` ✅
- `src/screens/clientValuesScreen.test.jsx` ✅
- `src/screens/AumScreen.jsx` ✅
- `src/screens/aumScreen.test.jsx` ✅
- `src/screens/FundAumHistoryPanel.jsx` ✅
- `src/helpers/idempotencyKeys.js` ✅

#### Estimated Remaining Work:

- Wait for backend investment review routes: 0 hours (frontend done)
- Cross-fund AUM display audit: 1-2 hours

**Total:** ~1-2 hours (plus waiting for backend)

---

### ⚠️ CLEANUP Slice (67% COMPLETE)

**Agent:** agent-6
**Assignment:** 3 independent cleanup tasks

#### What Was Completed:

**1. Backend .env.production.example** ✅

**Modified:** `backend_controller/.env.production.example` (41 lines changed)

Changes:
- Razorpay credentials block **DELETED**
- PhonePe credentials block **ADDED** (matches `.env.example`)

**2. Frontend App Tests Fixed** ✅

**Modified:** `frontend_stack/app/src/bundleContract.test.js` (28 lines changed)
- Razorpay script assertions **REMOVED**
- Correct invariant now: NO Razorpay or payment-gateway script loaded

**Modified:** `frontend_stack/app/src/platform/NativeBackCoordinator.test.jsx` (7 lines changed)
- Mandate route `/app/mandates/:mandateId/authorize` assertions **REMOVED**
- Re-keyed to live route `/app/payment/:paymentId`

#### What's Incomplete:

**❌ Shared appConfig Disclosures**

**File:** `frontend_stack/packages/shared/src/appConfig.js` (11 lines changed, but **insufficient**)

**Current state:** Still has stale copy:
- SIP disclosures still mention `mandateConsent` and Razorpay-era `paymentDisclosure`
- One-time payment disclosure says "Units allocate at next published NAV"

**Required changes per spec §11.2:**
- SIP = schedule/reminder, each installment paid by fresh client-initiated PhonePe checkout, no automatic debit
- One-time = payment confirmed by PhonePe then processed, client sees neutral processing status
- No NAV/units language anywhere
- No bank-verification/review/allocation concepts in client-facing copy

#### Files Modified:

- `backend_controller/.env.production.example` ✅
- `frontend_stack/app/src/bundleContract.test.js` ✅
- `frontend_stack/app/src/platform/NativeBackCoordinator.test.jsx` ✅
- `frontend_stack/packages/shared/src/appConfig.js` ⚠️ (needs rewrite)

#### Estimated Remaining Work:

- Rewrite appConfig disclosures: 1-2 hours

---


## Summary of Incomplete Work

### High Priority (Blocks Any Testing)

1. **Fix 3 TypeScript errors** (~5 minutes)
   - `phonePeCheckoutGateway.ts:133` - add `GatewayError` to imports
   - `phonePeCheckoutGateway.ts:146` - add type assertion for SDK client
   - `providerEventInboxRepository.ts:126` - add `now: Date` to interface

### High Priority (Core Payment Flow)

2. **PhonePe callback routes** (6-8 hours)
   - `POST /v1/provider-events/phonepe/payment`
   - `POST /v1/provider-events/phonepe/subscription`
   - `POST /v1/provider-events/phonepe/refund`
   - Fast ack → durable inbox → async processing

3. **Two-transaction checkout orchestrator** (4-6 hours)
   - Complete `POST /v1/client/orders/:orderId/pay`
   - TX A: persist attempt + merchantOrderId
   - Call PhonePe SDK
   - TX B: persist checkout result
   - Crash recovery with stable ID reuse

4. **Admin investment review routes** (6-8 hours)
   - Create `src/routes/adminInvestmentReviewRoutes.ts`
   - 7 endpoints per spec §9.3
   - Wire into composition/server

5. **Payment/refund reconciliation worker** (6-8 hours)
   - Rebuild worker with stable ID crash recovery
   - Bounded retry/backoff for pending attempts
   - Dead-letter exhausted failures

### Medium Priority

6. **SIP fallback routes** (4-6 hours)
   - `POST/GET /v1/client/sips`
   - `POST /v1/client/sips/:id/pause|resume|cancel`

7. **Client transaction list endpoint** (1-2 hours)
   - `GET /v1/client/orders` with canonical status params

8. **Integration test rebuild** (8-12 hours)
   - Payment flow end-to-end
   - Admin review flow
   - Client growth flow
   - AUM growth flow

### Low Priority (Polish)

9. **Client frontend polish** (4-7 hours)
   - Transaction list integration
   - Aggregate AUM cleanup
   - SIP detail polish

10. **Admin frontend polish** (1-2 hours)
    - Cross-fund AUM display audit

11. **appConfig disclosures** (1-2 hours)
    - Rewrite SIP/payment copy

**Total Estimated Remaining: ~45-65 hours**

---

## Test Results

### Backend Unit Tests: ✅ PASSING

```
Test Files  55 passed (55)
     Tests  523 passed (523)
  Duration  2.45s
```

**Guard tests:** 28 passing (architecture boundaries enforced)

### Backend Compilation: ❌ FAILING

3 TypeScript errors (see Critical Compilation Errors section).

### Backend Integration Tests: ⚠️ MOSTLY DELETED

- 9 integration test files deleted (~4,600 lines)
- 2 new integration tests created (client growth, AUM)
- Payment/review flow has no integration tests

### Frontend Tests: ❓ UNKNOWN

Not captured in session logs. Need to run manually.

---

## Definition of Done (Spec §15)

### ✅ Complete:

- [x] Clean migrations from zero
- [x] Generated types match schema
- [x] Unit tests passing (523 tests)
- [x] Architecture guards passing (28 tests, boundaries enforced)
- [x] Individual and collective client growth working
- [x] Individual and collective AUM growth working
- [x] Client APIs structurally cannot expose admin-only fields (enforced by guards)
- [x] Permissions are domain-specific (not one broad permission)
- [x] Financial inputs use exact bigint paise
- [x] PhonePe is the only payment provider code present (Razorpay removed)
- [x] Idempotency throughout

### ❌ Incomplete:

- [ ] Backend compiles (`npm run typecheck`)
- [ ] PhonePe one-time payment works against sandbox
- [ ] PhonePe success never auto-books investment (structure correct, not wired end-to-end)
- [ ] Admins have working review and allocation queue (frontend built, backend missing)
- [ ] Acceptance is the only way a contribution is created (structure correct, not wired)
- [ ] SIP payment paths work (routes missing)
- [ ] Integration tests pass (many deleted, minimal rebuilt)
- [ ] 80%+ changed-module coverage (unit tests pass, integration coverage insufficient)

---


## Repository State

### Git Status

**Changes not staged for commit:**
- 88 files modified
- 34 files deleted

**Untracked files:**
- 31 new files created

**Total changes:**
- 122 files changed
- 14,854 lines deleted
- 3,041 lines added
- **Net deletion: 11,813 lines**

### Recommendation

**DO NOT COMMIT YET** - backend doesn't compile.

**Next steps:**
1. Fix 3 TypeScript errors (~5 minutes)
2. Verify `npm run typecheck` passes
3. Run all tests
4. Then consider committing in logical groups:
   - Phase 0 (schema reset + guards)
   - Phases 4-5 (growth systems - already complete)
   - Phases 1-3 (payment flow - after routes complete)
   - Frontend rewrites (after backend routes exist)
   - Cleanup (after all core work done)

---

## Session Notes

### Session Termination

Session ended at `2026-08-18T10:58:44Z` due to **usage limit reached** (403 quota error from kimi-code/k3-256k model).

**Duration:** ~2 hours 18 minutes

**Last operations captured:**
- agent-4 (Client Growth): Successfully completed
- agent-5 (Fund AUM): Successfully completed
- agent-2 (Admin Frontend): Successfully completed
- agent-1 (Client Frontend): ~80% complete
- agent-3 (PhonePe Payment + Admin Review): ~70% complete
- agent-6 (Cleanup): 2 of 3 tasks done

The agent deployed 7 parallel sub-agents working on different codebase areas simultaneously, which is why so much ground was covered in ~2 hours.

### Last User Message

The user's final instruction was:
> "remember client growth is to be managed by the admin pannel."

This was correctly implemented - all client growth commands require admin permissions and are in the admin UI (Client Values screen).

---

## Architectural Quality

### ✅ Strengths

1. **Clean separation enforced by tests:** Payments ⊥ AUM ⊥ client growth (§4.1 boundaries)
2. **Append-only ledger:** `client_value_entries` has no UPDATE/DELETE operations
3. **Proper idempotency:** All mutations require `Idempotency-Key`, scoped by (admin, method, route, key)
4. **Type safety:** bigint paise throughout, no floating point
5. **PhonePe adapter isolation:** Provider types never leak into domain code
6. **Comprehensive guard tests:** Prevent regression to old models

### ⚠️ Concerns

1. **Backend doesn't compile:** 3 TypeScript errors suggest incomplete testing during development
2. **Integration tests deleted, not rebuilt:** High risk of broken workflows
3. **providerEventInboxRepository has bug:** Could cause runtime failures
4. **No worker processes implemented:** Payments won't reconcile automatically
5. **Admin review routes missing:** Frontend built but unusable without backend

### Overall Assessment

The **architecture is sound** and follows the spec faithfully. The main issue is **incompleteness, not incorrect design**.

With ~45-65 hours of focused work to:
- Fix TypeScript errors
- Complete payment flow (callbacks, orchestrator, worker)
- Complete admin review routes
- Rebuild integration tests

...this will be production-ready.

---

## Contact Points for Resumption

### Start Here:

1. **Fix TypeScript errors:**
   - `backend_controller/src/providers/phonepe/phonePeCheckoutGateway.ts:133` - add `GatewayError` to imports
   - `backend_controller/src/providers/phonepe/phonePeCheckoutGateway.ts:146` - add `as unknown as PhonePeSdkClient`
   - `backend_controller/src/repositories/providerEventInboxRepository.ts:43` - add `now: Date` to interface

2. **Run:** `cd backend_controller && npm run typecheck`

3. **Then tackle:** PhonePe callback routes in `providerEventRoutes.ts`

### Key Files to Resume Work:

**Backend:**
- `src/routes/providerEventRoutes.ts` - add PhonePe handlers
- `src/routes/clientOrderRoutes.ts` - complete /pay endpoint
- Create new: `src/routes/adminInvestmentReviewRoutes.ts`
- Create new: `src/paymentWorker.ts` (rebuild from scratch, not restore old one)

**Frontend:**
- All new screens already built, waiting for backend routes

### Context Preserved:

- Architecture guard tests define the boundaries
- Phase 0 migration structure is the canonical schema
- All domain logic for growth is complete and tested
- Frontend screens are built and waiting for backend routes
- Spec document (`INVESTMENT_FUND_SIZE_CORE_MECHANISM_REPORT.md`) is the authoritative reference

---

**End of Report**

**Report generated by:** Analysis of session state.json, git diff, file inspection, and codebase verification
**Analysis method:** Direct file reading (not inference from logs)

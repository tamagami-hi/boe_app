# Investment, Admin Allocation, Client Growth, and Fund AUM Implementation Specification

**Date:** 2026-08-18

**Status:** Approved implementation blueprint for a greenfield reset

**Primary decision:** PhonePe confirms payments; an admin privately verifies, accepts, and allocates each investment to the exact issued fund selected by the client; client growth and fund AUM growth are independently controlled by admins.

## 1. Executive decision

The repository must implement four separate financial responsibilities:

1. **Fund catalogue** — admins issue funds; clients may read issued funds and select one.
2. **Payment and investment acceptance** — PhonePe confirms payment; an admin privately verifies it and decides whether to accept the investment.
3. **Client value management** — an admin may adjust one client's growth or apply a collective adjustment to clients in one pool.
4. **Fund AUM management** — an admin may adjust one fund's AUM or apply a batch adjustment to several independent funds.

These responsibilities may share stable identifiers, but they must not automatically update one another.

```text
Client selects issued fund
          |
          v
PhonePe payment succeeds
          |
          v
Private admin review + bank confirmation
          |
          v
Admin accepts and privately allocates payment
          |
          v
Client investment entry is created

Client growth commands --------------------> client displayed value only
Fund AUM growth commands ------------------> published fund AUM only

client payment/investment --X--> automatic AUM change
client growth             --X--> automatic AUM change
fund AUM growth           --X--> automatic client growth
Fund A AUM                --X--> Fund B AUM dependency
```

The intended boundary is not “clients and funds never share an ID.” A client investment must identify the issued fund selected. For MVP, that same `fund_id` is the allocation and client-position key. The boundary is: **no amount, state transition, or growth action propagates automatically across client accounting and AUM accounting.**

Because this repository has no production data or real clients, implementation should replace the current baseline cleanly. Do not build dual-read code, compatibility migrations, historical backfills, or feature flags for obsolete models.

## 2. Final product rules

### 2.1 Client-visible behavior

A client can:

- see only issued funds;
- view issued terms and the latest admin-published AUM with its as-of date;
- select an issued fund for a one-time investment or SIP;
- start a PhonePe checkout or PhonePe AutoPay authorization;
- see payment states such as pending, received, failed, or refunded;
- see a neutral “investment is being processed” state after PhonePe succeeds;
- see the investment after the admin accepts it;
- see their contribution, current admin-adjusted value, and growth history.

A client must never see:

- bank-verification status or evidence;
- admin private notes or rejection investigation details;
- the reviewing administrator;
- the private allocation record, bank workflow, or operator details;
- AUM adjustment controls or batch details;
- a claim that their payment changed fund AUM;
- a claim that fund AUM growth automatically changed their value.

### 2.2 Admin behavior

An authorized admin can:

- issue, pause, and archive fund catalogue entries;
- inspect successful PhonePe payments awaiting review;
- see client, amount, selected issued fund, PhonePe reference, and payment time;
- privately confirm the payment against bank evidence;
- accept and allocate the full payment to the exact issued fund selected by the client;
- reject a successful payment and start a full refund;
- adjust one client's growth in one fund;
- adjust all eligible clients in one pool collectively;
- publish an initial AUM for a fund;
- adjust one fund's AUM by amount or percentage;
- adjust selected funds collectively using a common percentage or explicit per-fund deltas.

### 2.3 Non-negotiable invariants

- PhonePe success is evidence of payment, not acceptance of the investment.
- Browser redirects and client callbacks never confirm payment.
- A successful PhonePe callback creates no client investment entry and no AUM record.
- Only the admin accept command creates the initial client contribution.
- Admin acceptance creates no AUM change.
- Client growth creates no AUM change.
- AUM growth creates no client ledger change.
- A client collective growth command targets clients inside exactly one fund.
- A collective AUM command fans out independent calculations; it never distributes one total amount across funds.
- No reconciliation warning or equality check compares client value with AUM.
- Every financial commit is authorized, validated, idempotent, atomic, and audited.

## 3. What the current code actually does

### 3.1 Useful foundations

The current Option B migration already stores client value and fund AUM separately. `investor_ledger_entries` and `fund_aum_updates` independently reference a fund, but there is no foreign key between the two tables. See [021_option_b_investment_model.sql](../../backend_controller/db/migrations/021_option_b_investment_model.sql#L35) and lines 108–138.

Current order and SIP creation validate the selected published fund and minimum amount in [createOrder.ts](../../backend_controller/src/domain/client/createOrder.ts#L47), [sip.ts](../../backend_controller/src/domain/client/sip.ts#L44), and [generateSipInstallments.ts](../../backend_controller/src/domain/client/generateSipInstallments.ts#L79). Preserve the server-side validation concept.

The current client growth implementation has useful primitives:

- an individual value-only gain/loss entry in [allocateGain.ts](../../backend_controller/src/domain/client/allocateGain.ts#L54);
- percentage calculation code in [poolGainDistribution.ts](../../backend_controller/src/domain/admin/poolGainDistribution.ts#L127);
- one transaction for a collective commit in [adminCatalogRoutes.ts](../../backend_controller/src/routes/adminCatalogRoutes.ts#L842).

Keep the value-only write shape, percentage rounding behavior, and transaction boundary after moving them behind clearer modules and stronger idempotency/concurrency controls. Retire the current “distribute one total pool gain proportionally” algorithm. Collective growth in the target is either one percentage applied independently or explicit per-client deltas; it does not invent a proportional fund-management calculation.

The payment schema also has useful pieces: integer paise, payment attempts, composite ownership foreign keys, a unique provider reference, and a durable `provider_events` shape in [018_canonical_payments.sql](../../backend_controller/db/migrations/018_canonical_payments.sql#L14). Preserve those properties.

### 3.2 Current payment flow violates the intended admin checkpoint

The present sequence is:

```text
create order -> begin payment -> provider success -> confirm -> book order -> append client ledger
```

`recordPaymentResult()` calls `advancePaymentToBooked()` on success, and that calls `bookOrder()`. See [settlePayment.ts](../../backend_controller/src/domain/client/settlePayment.ts#L62), lines 62–107 and 137–163. `bookOrder()` immediately appends the contribution in [bookOrder.ts](../../backend_controller/src/domain/client/bookOrder.ts#L53), lines 53–107.

This must change to:

```text
create order -> begin PhonePe -> PhonePe success -> admin_review_pending
             -> admin approve and allocate -> append client contribution
```

The current admin UI explicitly says there is nothing to approve in [PaymentsScreen.jsx](../../frontend_stack/packages/admin/src/screens/PaymentsScreen.jsx#L40), lines 40–54 and 102–105. The admin payment projection also omits the selected fund. Both conflict with the required workflow.

### 3.3 There is no live PhonePe integration

The backend currently has a generic/manual scaffold, not a working external provider adapter:

- [beginPayment.ts](../../backend_controller/src/domain/client/beginPayment.ts#L70) creates a payment attempt and outbox event;
- real-provider dispatch in [settlePayment.ts](../../backend_controller/src/domain/client/settlePayment.ts#L113) merely constructs `${provider}:${payment.id}` and performs no gateway call;
- [paymentWebhookRoutes.ts](../../backend_controller/src/routes/paymentWebhookRoutes.ts#L33) expects an internal UUID and a custom `x-payment-signature`, not PhonePe's callback contract;
- runtime composition injects no PhonePe client;
- `backend_controller/package.json` has no PhonePe SDK;
- `.env.production.example` still declares Razorpay credentials.

The client is also Razorpay-bound through [razorpay.js](../../frontend_stack/packages/client/src/utils/razorpay.js#L1), [LumpsumSheet.jsx](../../frontend_stack/packages/client/src/pages/LumpsumSheet.jsx#L68), [StartSipSheet.jsx](../../frontend_stack/packages/client/src/pages/StartSipSheet.jsx#L105), and [PaymentStatus.jsx](../../frontend_stack/packages/client/src/pages/PaymentStatus.jsx#L180).

The one-time flow is broken against the HTTP API: order creation returns an order, while the UI immediately expects a payment ID instead of calling `beginOrderPayment()`. The SIP flow similarly creates a plan and immediately expects a payment ID instead of initiating its mandate. See [ordersApi.js](../../frontend_stack/packages/client/src/services/ordersApi.js#L71) and lines 149–159, 179–188, and 219–235.

### 3.4 Current AUM is independent but needlessly resembles client accounting

The active AUM form asks an admin for new investments, redemptions, and portfolio gain/loss and computes:

```text
closing = opening + new investments - redemptions + portfolio gain/loss
```

See [FundAumPanel.jsx](../../frontend_stack/packages/admin/src/screens/FundAumPanel.jsx#L7) and the route in [adminCatalogRoutes.ts](../../backend_controller/src/routes/adminCatalogRoutes.ts#L447). The route does not query client investments, so these are manually typed figures that only imply a relationship.

For the new design, remove `fund_aum_updates` and reactivate the simpler absolute record shape already represented by `fund_aum_snapshots` in [015_canonical_catalog.sql](../../backend_controller/db/migrations/015_canonical_catalog.sql#L79). An AUM growth command calculates a new absolute snapshot from the previous snapshot; it does not store client investment/redemption components.

### 3.5 Current client growth is useful but poorly isolated

The current admin fund route lists client names, emails, balances, and returns under fund catalogue permissions. See [adminCatalogRoutes.ts](../../backend_controller/src/routes/adminCatalogRoutes.ts#L773), lines 773–840. Fund detail also returns investor totals beside AUM at lines 275–317.

This is both a domain crossing and a confidentiality defect: `funds.read` should not reveal client financial records. Client growth operations may remain pool-scoped, but they belong in a dedicated Investment/Client Growth module protected by client-finance permissions. AUM handlers must never import the client ledger repository.

## 4. Target domain model

### 4.1 Domain boundaries

```text
Fund Catalogue
  owns: funds, issued versions, terms, lifecycle
  client access: read issued catalogue

Payments
  owns: PhonePe checkout, callbacks, status inquiry, refunds
  output: provider payment fact only

Investment Review and Allocation
  owns: private bank check, acceptance, internal allocation
  output: accepted contribution to Client Value

Client Value
  owns: contributions and admin growth/loss adjustments
  client access: safe projection without private allocation metadata

Fund AUM
  owns: admin-published absolute AUM snapshots and AUM growth batches
  client access: optional read-only publication
```

Allowed references:

- an order has canonical `fund_id` and `fund_version_id` selected by the client;
- an accepted order has one private allocation record for that same `fund_id`;
- a contribution may reference its private allocation for provenance;
- an AUM snapshot has `fund_id`;
- all domains may reference an audit/request ID.

Forbidden dependencies:

- Payments must not import AUM or client-growth repositories.
- AUM must not import payment, review, allocation, or client-ledger repositories.
- Client growth must not import AUM repositories.
- No endpoint may commit both client growth and AUM growth.
- No batch ID may span both growth domains.

### 4.2 Canonical fund identity and private allocation

For MVP, one accepted investment belongs to the exact issued fund the client selected. Use one canonical `fund_id` across the order, allocation, client position, and client value entries.

The allocation is private because its **administrative workflow** is private, not because the destination is secretly different. It records who accepted the money, when it was accepted, and that the full payment was assigned. It does not give the admin a different-fund selector.

Each accepted payment has exactly one private allocation for the full succeeded amount. Do not implement split allocation, partial acceptance, weighted allocation, automatic routing, or later rebalancing.

If the business later needs internal operational pools that differ from client-issued funds, model them as a separately named admin-only concept after its legal/accounting meaning and client-growth mapping are approved. Do not reuse another issued/AUM fund ID and hide the mismatch from the client.

The authoritative client position key is:

```text
(user_id, fund_id)
```

Individual growth targets one such position. Collective client growth targets all eligible positions in one `fund_id`. Contribution entries retain `allocation_id` only as provenance; growth entries do not attach themselves to an arbitrary prior order allocation.

## 5. Target persistence model

This is a greenfield replacement baseline. Rewrite/squash the investment/payment/AUM migrations rather than stacking compatibility migrations.

### 5.1 `investment_orders`

Required fields:

```text
id
user_id
fund_id
fund_version_id
sip_plan_id nullable
type: lump_sum | sip_installment
state: submitted | payment_pending | review_pending | accepted |
       refund_pending | refunded | refund_failed | payment_failed | cancelled
amount_paise bigint > 0
currency = INR
requested_at
payment_confirmed_at nullable
accepted_at nullable
cancelled_at nullable
failure_code nullable
version bigint
created_at / updated_at
```

Store the selected issued version so later catalogue changes cannot rewrite the terms accepted by the client. Fund/version must be tied with a composite foreign key.

Do not place bank verification or operational allocation fields on the order.

### 5.2 `payments` and `payment_attempts`

Keep one payment per order and separate provider attempts. Use payment states:

```text
created | provider_pending | succeeded | failed | expired |
refund_pending | refunded | refund_failed
```

Add to the attempt/payment model:

```text
provider = phonepe
merchant_order_id unique, immutable, max 63 characters; only letters, digits, `_`, `-`
provider_order_id nullable
checkout_expires_at nullable
last_status_checked_at nullable
provider_state nullable
```

Do not treat a redirect URL as permanent financial evidence. Return it to the client and persist only if operational retry requires it.

Money must enter HTTP APIs as a decimal string parsed to `bigint`, or as a JavaScript safe integer with an explicit business maximum. Current unconstrained Zod `number().int()` inputs can lose precision above `2^53`.

Normalize PhonePe `paymentDetails[]` into a child `provider_payment_details` table keyed by attempt plus provider transaction/reference. Do not overwrite a single transaction-ID field: one merchant order may produce multiple details because of retries or split instruments.

### 5.3 `refund_operations`

Rejected succeeded payments require a first-class refund record:

```text
id
payment_id unique
order_id unique
merchant_refund_id unique, immutable
provider_refund_id nullable
amount_paise bigint > 0
state: pending | provider_pending | refunded | failed
failure_code nullable
attempt_count
last_status_checked_at nullable
created_by_user_id
request_id
created_at / updated_at
```

The amount must equal the full succeeded payment for this MVP. The stable merchant refund ID is persisted before any provider call and reused for crash recovery/reconciliation.

### 5.4 `provider_events`

Retain a durable inbox with:

- a provider-specific semantic deduplication key, such as event + merchant order/provider order/refund ID + resulting state;
- exact raw payload digest;
- verified authorization flag;
- encrypted raw payload with retention/erasure policy;
- merchant order correlation;
- received, processing, processed, and dead-lettered states;
- retry count and processing error code.

Raw digest remains evidence but is not the sole deduplication key because semantically identical payloads can be serialized differently. The callback route authenticates raw bytes, durably inserts/deduplicates a minimal inbox record, returns 2xx within PhonePe's documented short acknowledgement window (roughly 3–5 seconds), and processes business effects asynchronously. Duplicate and out-of-order callbacks must be safe.

### 5.5 `investment_reviews`

Admin-only one-to-one review record:

```text
id
order_id unique
state: pending | accepted | rejected
bank_verified boolean
reviewed_by_user_id nullable
reason_code nullable
private_note nullable
reviewed_at nullable
version bigint
created_at / updated_at
```

Create the pending review when PhonePe payment becomes `succeeded`. Never return this row from client routes.

Provider-event processing must update payment to `succeeded`, order to `review_pending`, and insert the pending review in one database transaction. A pending review starts with `bank_verified=false`. Constraints require terminal reviews to have reviewer and reviewed timestamp; accepted requires `bank_verified=true`; rejected requires a reason code; pending has no reviewer or reviewed timestamp. `bank_verified` is an admin attestation, not PhonePe proof.

### 5.6 `investment_allocations`

Admin-only, one allocation per accepted order for MVP:

```text
id
order_id unique
user_id
fund_id
amount_paise bigint > 0
allocated_by_user_id
allocated_at
request_id unique
created_at
```

The accept transaction verifies:

- payment is succeeded;
- review is pending and the accept input contains literal `bankVerified: true`;
- order/user/payment amounts and currencies match;
- allocation fund equals the order's immutable selected fund and is published or paused; archived forces refund;
- allocation amount equals the entire succeeded payment;
- no prior allocation or contribution exists.

The same accept transaction sets `bank_verified=true`, reviewer, reviewed timestamp, and accepted state. There is no earlier “mark bank verified” endpoint. This row never inserts or updates AUM.

Enforce unique allocation per order, allocation/order/payment user consistency, and composite fund/version ownership. Cross-table “accepted iff allocation and contribution exist” cannot be a SQL `CHECK`; enforce it in the one transaction and an integration invariant test.

### 5.7 `client_value_entries`

Replace ambiguous legacy/units-era ownership with one append-only client value ledger:

```text
id
user_id
fund_id
allocation_id
entry_type: contribution | growth_adjustment | reversal
principal_delta_paise bigint
value_delta_paise bigint
effective_date
order_id nullable
payment_id nullable
growth_batch_id nullable
reason_code
note nullable
reverses_entry_id nullable unique
actor_type: admin | system
created_by_user_id nullable
request_id
created_at
```

Shapes:

```text
contribution:
  principal_delta = accepted payment amount
  value_delta     = accepted payment amount
  order/payment/allocation required

growth_adjustment:
  principal_delta = 0
  value_delta     = signed admin adjustment
  growth batch and admin required

reversal:
  exact negation of one prior entry for the same user and fund
  only reversal rows have reverses_entry_id
  one original row can be reversed at most once
```

Add unique constraints for one contribution per order and per payment, and one growth entry per `(client_growth_batch_id, user_id, fund_id)`. Use composite ownership/provenance foreign keys so a row cannot reference another user's order, payment, allocation, or original entry. `actor_type=admin` iff `created_by_user_id` is present; provider reconciliation workers use `system`. Database roles should deny application `UPDATE` and `DELETE`; corrections are a reversal followed by a correct new entry.

Client projections:

```text
total investment = sum(principal_delta_paise)
current value    = sum(value_delta_paise)
total growth     = current value - total investment
```

The client API groups by `fund_id` or returns an overall total. It must not expose `allocation_id`, review data, or operator details. Ledger notes are admin-private; client transaction labels come from a strict public allowlist rather than returning raw reason/note text.

### 5.8 `fund_aum_snapshots`

Use one absolute AUM publication table:

```text
id
fund_id
as_of_date
revision integer > 0
aum_paise bigint >= 0
aum_growth_batch_id nullable
reason_code
note nullable
published_by_user_id
request_id
created_at
```

Use append-only corrections with unique `(fund_id, as_of_date, revision)`. The highest revision for one fund/date is authoritative. A correction locks the fund/date and writes exactly `previous revision + 1`; it never mutates the prior row. Latest AUM orders by `as_of_date DESC, revision DESC, created_at DESC, id DESC`. A correction to a historical date does not recalculate later absolute snapshots. `request_id` is indexed but not unique because one collective HTTP request produces several snapshots; `(aum_growth_batch_id, fund_id)` is unique for batch outputs.

There is no opening AUM, new-investment amount, redemption amount, portfolio-gain column, or monthly predecessor identity. Initial publication sets an absolute value. Later growth commands calculate and store a new absolute snapshot.

### 5.9 Separate growth batch headers

Use structurally separate `client_growth_batches` and `aum_growth_batches` tables. Do not use one polymorphic batch table with a domain discriminator.

```text
id
scope: individual | collective
instruction_type: amount | percentage | explicit_deltas
effective_date
reason_code
note nullable
basis_hash
actor_user_id
request_id
idempotency_record_id
target_count
total_delta_paise
created_at
```

`client_value_entries` can reference only `client_growth_batches`; `fund_aum_snapshots` can reference only `aum_growth_batches`. The existing idempotency subsystem remains canonical; do not store a free-standing raw key on a batch. Commit the scoped idempotency result and batch in the same transaction.

## 6. State machines and command behavior

### 6.1 One-time investment

```text
submitted -> payment_pending
payment_pending -> review_pending | payment_failed
review_pending -> accepted | refund_pending
refund_pending -> refunded | refund_failed
```

The “Approve and allocate” command is one atomic transaction:

1. Lock order, payment, and review.
2. Re-read their current states and versions.
3. Require the input literal `bankVerified: true`.
4. Validate that the allocation fund is the selected order fund and is not archived.
5. Insert the private allocation.
6. Insert exactly one contribution entry.
7. Mark review and order accepted.
8. Append audit records and a generic client notification.
9. Commit all or none.

Do not create an intermediate “accepted but unallocated” state.

Reject/refund is also explicit:

1. The admin reject transaction changes review `pending -> rejected`, order `review_pending -> refund_pending`, and payment `succeeded -> refund_pending`.
2. It creates a stable `merchantRefundId` and enqueues a refund request; it performs no PhonePe network call inside the transaction.
3. The worker calls PhonePe idempotently with that stable ID.
4. Verified callback/status changes payment and order to `refunded`.
5. Exhausted terminal failure changes them to `refund_failed` and places the item in an admin exception queue with retry/reconcile actions.

A pre-accept rejection writes no client value entry, so it needs no ledger reversal. The general reversal entry exists for later correction/chargeback work; do not implement post-accept refunds in MVP unless a separate reviewed workflow is added.

### 6.2 SIP

PhonePe Standard Checkout alone is not recurring debit. Phase 3 is blocked until the merchant account is provisioned and the team selects one exact PhonePe AutoPay rail (for example UPI AutoPay or eNACH). Do not mix those contracts. After selection, implement that rail's documented subscription state machine behind `RecurringPaymentGateway`:

```text
create SIP plan
  -> initiate PhonePe subscription/mandate authorization
  -> verified subscription callback marks mandate active
  -> scheduler creates due installment
  -> PhonePe subscription redemption request
  -> PhonePe redemption succeeds
  -> installment enters the same admin review queue
  -> admin approves and allocates
```

The selected rail's request fields, scheduling window, callback types, status APIs, and credentials must be copied from its current official contract. The linked eNACH redemption reference is evidence that recurring debit is a separate API, not a universal AutoPay request shape. The current Node checkout SDK may not cover the selected recurring rail; authenticated REST may be required. A standard checkout success cannot be reused as proof of a recurring mandate.

If PhonePe AutoPay is unavailable for the merchant account, the permitted fallback is explicit: the SIP is a schedule/reminder and each installment requires a fresh client-initiated PhonePe checkout. Do not retain a fake generic mandate webhook or simulate automatic debit.

Define fund pause policy simply:

- no new one-time checkout may start for a paused/archived fund;
- no new SIP installment may be generated for it;
- a payment already confirmed by PhonePe still enters review and must be accepted or refunded deterministically;
- provider-pending payments are reconciled, not discarded.

## 7. PhonePe integration specification

Use a narrow domain port and one adapter:

```text
PaymentGateway
  createCheckout(command)
  getOrderStatus(merchantOrderId)
  validateShaCallback(authorizationHeader, rawBody)
  initiateRefund(command)
  getRefundStatus(reference)

RecurringPaymentGateway
  createSubscription(command)
  getSubscriptionStatus(id)
  redeemSubscription(command)
  validateSubscriptionCallback(...)
```

Implement these in a dedicated `providers/phonepe/` module. PhonePe DTOs must not leak into order, review, allocation, client-value, or AUM domain code. This specification chooses PhonePe's SHA callback-auth mode so the official Node SDK validator and configured callback username/password have one unambiguous meaning. If operations later switches the PhonePe dashboard to HMAC mode, implement it as a separately tested adapter/configuration using PhonePe's checksum-key headers and secret; never try to make one validator guess both modes.

The official Node SDK currently documents:

- `@phonepe-pg/pg-sdk-node`;
- `StandardCheckoutClient.getInstance(clientId, clientSecret, clientVersion, env)`;
- `client.pay(request)` returning a redirect URL;
- `client.getOrderStatus(merchantOrderId)`;
- `client.validateCallback(username, password, authorizationHeader, rawBody)`.

Implementation must pin and verify the current SDK version when coding. Authoritative references are the [official PhonePe Node SDK](https://github.com/PhonePe/phonepe-pg-sdk-node), [checkout initiation](https://developer.phonepe.com/payment-gateway/backend-sdk/nodejs-be-sdk/api-reference-node-js/initiate-payment), [order status](https://developer.phonepe.com/payment-gateway/backend-sdk/nodejs-be-sdk/api-reference-node-js/order-status-api), [webhooks](https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/webhook), and [subscription redemption](https://developer.phonepe.com/payment-gateway/enach/payment-operations/redeem).

PhonePe integration rules:

- `merchantOrderId` is server-generated, unique, at most 63 characters, and contains only letters, digits, `_`, or `-`.
- Amount is paise and must satisfy the configured business minimum; PhonePe documents a minimum of 100 paise for checkout.
- Checkout creation uses a request-driven three-step orchestrator: transaction A persists the payment attempt and stable merchant order ID; the application calls PhonePe after that transaction commits; transaction B persists the checkout/provider result.
- `POST /orders/:id/pay` returns the redirect when transaction B succeeds. It does not wrap the network call in the existing whole-route database idempotency transaction.
- If the process crashes after PhonePe accepts but before transaction B, a retry reuses the same merchant order ID and calls `getOrderStatus()` before any new create attempt. Refund dispatch follows the same rule with stable `merchantRefundId`.
- Treat PhonePe `COMPLETED` as payment success, `FAILED` as failure, and `PENDING` as non-terminal.
- Verify SHA callback authorization using the official SDK against the exact raw body.
- Read top-level `event` and nested `payload.state`; do not use the legacy `type` field or the repository's invented DTO.
- Do not use strict deserialization that breaks when PhonePe adds fields; validate required fields and ignore unknown safe fields.
- Correlate by stored merchant order ID, then verify merchant identity, amount, and expected order. INR remains an internal invariant; verify currency only against a PhonePe response that actually supplies it.
- The redirect page is UX only. For the Capacitor Android app, use a configured HTTPS App Link/universal-link return that opens the payment status route, with a web fallback. It polls the backend; it never posts “success.”
- Reconcile pending/ambiguous attempts with `getOrderStatus()` using bounded retry/backoff.
- Persist/dedupe callbacks before applying state transitions.
- Never log credentials, authorization headers, raw payment instruments, or full callback payloads.
- Use one app-created attempt and merchant order ID at a time. After a terminal failed/expired attempt, an explicit retry creates a new attempt and merchant order ID. A crash retry of a non-terminal attempt reuses its existing ID.

Required environment variables:

```text
PAYMENT_PROVIDER=phonepe
PHONEPE_CLIENT_ID
PHONEPE_CLIENT_SECRET
PHONEPE_CLIENT_VERSION
PHONEPE_ENV=sandbox|production
PHONEPE_CALLBACK_USERNAME
PHONEPE_CALLBACK_PASSWORD
PHONEPE_REDIRECT_URL
PHONEPE_CALLBACK_URL   # deployment/dashboard configuration
```

Add refund/subscription credentials only if PhonePe provisions separate values. Production startup must fail if the credentials required by the selected features are incomplete. The callback URL is deployment/dashboard configuration, not a checkout SDK credential. Secrets remain backend-only.

Remove all `RAZORPAY_*`, Razorpay scripts, provider key IDs sent to browsers, Razorpay confirmation functions, fixtures, tests, and deployment validation.

## 8. Independent growth systems

### 8.1 Individual client growth

An admin targets one `(userId, fundId)` position.

Amount mode:

```text
delta = signed growthPaise
after = current client value + delta
```

Percentage mode:

```text
delta = symmetricHalfUp(current client value * signedBasisPoints / 10,000)
after = current client value + delta
```

Rules:

- exactly one of `growthPaise` or `growthBasisPoints`;
- delta cannot be zero;
- loss is negative;
- after cannot be negative;
- principal delta is zero;
- value delta equals calculated delta;
- no AUM read/write occurs.

`growthBasisPoints` is a signed integer from `-10,000` (-100.00%) through a named configurable positive business maximum. Define symmetric half-up once and reuse it everywhere:

```text
roundedMagnitude = floor((abs(basis * basisPoints) + 5,000) / 10,000)
delta = sign(basisPoints) * roundedMagnitude
```

An individual form may show a local non-authoritative preview. Commit locks and recalculates from the current server basis; the commit response is authoritative.

### 8.2 Collective client growth within one fund

Allowed modes:

1. **Same percentage:** apply one signed basis-point rate independently to every eligible client position in the selected fund.
2. **Explicit deltas:** the admin supplies one signed amount per selected client; preview and commit validate every item.

Do not accept one shared currency total and distribute it proportionally. That current largest-remainder mechanism is unnecessary fund-management complexity and must be removed.

An eligible target is an accepted, unreversed `(user_id, fund_id)` position with current value greater than zero. Zero-value positions are excluded and reported as `excludedCount`; a batch with no eligible positions returns 409. Percentage mode skips calculated zero deltas instead of inserting zero ledger rows. Explicit losses and percentage losses are preflighted so no target becomes negative. One invalid target rejects the entire batch. Cap a batch at 500 positions; reject larger requests rather than partially committing chunks.

### 8.3 Individual fund AUM growth

Use the fund's latest unsuperseded snapshot as the basis.

```text
amount mode:     newAum = previousAum + signed growthPaise
percentage mode: delta  = symmetricHalfUp(previousAum * signedBasisPoints / 10,000)
                 newAum = previousAum + delta
```

Reject a negative result. An initial AUM is a separate direct publication command because no prior basis exists. The resulting absolute value is stored in `fund_aum_snapshots`.

Every initialize, growth, and correction command requires `asOfDate`, `reasonCode`, and optional private note. Multiple records on the same date use revisions. A growth action records the new authoritative value; a correction replaces an erroneous same-date value with a higher revision. Neither causes historical or later snapshots to be recomputed. AUM delta is a comparison between absolute snapshots, not evidence of portfolio performance, cash flow, contributions, or redemptions.

### 8.4 Collective fund AUM growth

Allowed modes:

- same signed percentage for each selected fund; or
- an explicit signed delta for each selected fund.

Forbidden mode:

- distribute one shared currency total across funds.

Each fund is calculated only from its own previous AUM. Preflight all targets, lock funds in sorted ID order, recompute bases, then write every snapshot in one transaction. If any target fails, write none. Cap a batch at 100 funds.

### 8.5 Preview, stale basis, and idempotency

All collective commands use separate preview and commit endpoints. Preview writes nothing and returns before/delta/after plus a `basisHash`.

Client hash input:

```text
command + fundId + sorted(userId, currentValue, latestEntryId)
```

AUM hash input:

```text
command + sorted(fundId, latestSnapshotId, aumPaise, revision)
```

Commit behavior:

1. Acquire locks in deterministic order.
2. Reload bases.
3. Recalculate the hash.
4. Return `409 STATE_CONFLICT` if it differs.
5. Recalculate all deltas on the server.
6. Insert batch and target rows.
7. Audit and commit once.

The server never trusts preview deltas returned by the browser.

Every growth commit requires `Idempotency-Key`. The canonical uniqueness scope is `(admin, method, route template, key)` and the idempotency record stores the canonical request hash. Same key/same body returns the original result; same key/different body conflicts. Preview requires no key.

Use one locking discipline for individual and collective client adjustments to prevent concurrent losses from taking a value negative. The simplest approach is a transaction advisory lock for `(user_id, fund_id)` acquired in sorted order. AUM actions lock fund rows in sorted order.

## 9. API specification

All financial amounts in JSON should be decimal strings. Responses use the existing success/error envelope.

### 9.1 Client catalogue and investments

```http
GET  /v1/client/funds
GET  /v1/client/funds/:fundId
POST /v1/client/orders
POST /v1/client/orders/:orderId/pay
GET  /v1/client/orders/:orderId
GET  /v1/client/payments/:paymentId
GET  /v1/client/portfolio
GET  /v1/client/transactions
```

Create order:

```json
{
  "fundId": "uuid",
  "amountPaise": "500000"
}
```

Begin payment response:

```json
{
  "orderId": "uuid",
  "paymentId": "uuid",
  "provider": "phonepe",
  "checkout": { "type": "redirect", "url": "https://..." },
  "expiresAt": "2026-08-18T12:00:00Z"
}
```

Do not add a client “confirm payment” endpoint. Derive transaction tabs from owner-scoped orders plus payment detail, or add one paginated payment list with repeatable canonical status parameters. Do not keep the current frontend's calls to a nonexistent list endpoint with comma-packed status values.

### 9.2 PhonePe ingress

```http
POST /v1/provider-events/phonepe/payment
POST /v1/provider-events/phonepe/subscription
POST /v1/provider-events/phonepe/refund
```

These are provider-authenticated raw-body routes, not client-authenticated mutation routes.

Client-safe investment status is a separate projection, never a raw join of internal enums:

```text
payment pending                         -> payment_in_progress
PhonePe succeeded + review pending      -> processing
accepted                                -> confirmed
refund pending                          -> refund_in_progress
refund failed                           -> support_required
refunded                                -> refunded
payment failed/expired                  -> payment_failed
```

Never serialize review state `rejected` or `bank_verified`.

### 9.3 Admin investment review

```http
GET  /v1/admin/investment-reviews?state=pending&cursor=...
GET  /v1/admin/investment-reviews/:orderId
POST /v1/admin/investment-reviews/:orderId/accept
POST /v1/admin/investment-reviews/:orderId/reject
GET  /v1/admin/refunds?state=refund_failed
POST /v1/admin/refunds/:refundId/reconcile
POST /v1/admin/refunds/:refundId/retry
```

Pending item:

```json
{
  "orderId": "uuid",
  "client": { "id": "uuid", "name": "Client", "email": "..." },
  "amountPaise": "500000",
  "currency": "INR",
  "selectedFund": { "id": "uuid", "name": "Issued Fund", "versionId": "uuid" },
  "payment": {
    "id": "uuid",
    "state": "succeeded",
    "provider": "phonepe",
    "merchantOrderId": "...",
    "providerReference": "...",
    "succeededAt": "..."
  },
  "review": { "state": "pending", "version": "1" }
}
```

Accept request:

```json
{
  "bankVerified": true,
  "expectedVersion": "1",
  "privateNote": "optional"
}
```

The server allocates to the immutable order `fundId`; the form displays that fund read-only. Reject requires `reasonCode`, optional private note, and expected version. This blueprint uses body `expectedVersion`, not `If-Match`. Both mutations require CSRF and `Idempotency-Key`.

Accept returns 200 with safe admin fields `{orderId,state:'accepted',acceptedAt}`. Reject returns 200 with `{orderId,state:'refund_pending',refundId}`. A stale version or conflicting terminal state returns 409. A replay with the same idempotency scope/body returns the original 200 result; the same key with a changed body returns 409. Refund retry/reconcile requires `refunds.write` and never changes client value or AUM.

### 9.4 Client growth

```http
POST /v1/admin/client-growth/individual
POST /v1/admin/client-growth/collective/preview
POST /v1/admin/client-growth/collective
```

Individual request targets `userId` and `fundId`, and accepts exactly one of `growthPaise` or `growthBasisPoints`, plus effective date, reason code, and private note.

Collective request targets exactly one `fundId`. It accepts either one `growthBasisPoints` value or an explicit `items: [{userId, growthPaise}]` list. Commit additionally requires the preview `basisHash`.

### 9.5 AUM

```http
POST /v1/admin/aum/funds/:fundId/initialize
POST /v1/admin/aum/funds/:fundId/growth
POST /v1/admin/aum/growth/collective/preview
POST /v1/admin/aum/growth/collective
POST /v1/admin/aum/snapshots/:snapshotId/corrections
GET  /v1/admin/aum/funds/:fundId/history
```

Initialize, individual growth, and correction require `asOfDate`, `reasonCode`, and optional private note. Individual growth accepts exactly one of `growthPaise` or `growthBasisPoints`. Collective growth accepts either one common percentage with fund IDs or explicit per-fund deltas. No AUM request contains a user, order, payment, contribution, or redemption field.

## 10. Permissions and privacy

Create least-privilege permissions:

| Capability | Permission |
|---|---|
| Read payment evidence | `payments.read` |
| Read private review queue | `investments.review.read` |
| Accept/reject/allocate | `investments.review.write` |
| Retry/reconcile refunds | `refunds.write` |
| Read client values | `client_values.read` |
| Adjust individual/collective client growth | `client_growth.write` |
| Read AUM | `aum.read` |
| Initialize/adjust/correct AUM | `aum.write` |
| Issue/pause/archive catalogue | `funds.write` |

Do not let `funds.read` reveal client names, email addresses, payments, balances, bank status, or allocations. Do not use one broad permission for both client growth and AUM growth.

Audit events must include actor, command, entity, version, request/idempotency reference, allowlisted before/after state, public-safe reason code, and batch ID. Client growth audit metadata includes `propagatedToAum: false`; AUM audit metadata includes `propagatedToClients: false`.

Private notes, bank evidence, callback authorization, raw provider payloads, and operator investigation text must never enter general audit metadata, logs, notifications, client/admin-generic caches, error details, or analytics. Store private review notes only in the restricted review record (encrypted if required) and expose them only through `investments.review.read`. General audit projections are allowlisted/redacted.

Client serializers must structurally omit:

```text
allocationId
bankVerified
reviewer
privateNote
internal reason/investigation fields
```

Client repositories must not select `investment_reviews`, `investment_allocations`, or private notes. Client DTO schemas use strict positive allowlists. Test portfolio, order, payment, transaction, statement, notification, errors, exports, cache serialization, and generic audit projections—not only the primary detail endpoint.

## 11. Admin and client UI

### 11.1 Admin navigation

```text
Funds
  Issued catalogue
  Fund details/terms

Investment reviews
  Awaiting review
  Accepted
  Refunds/exceptions

Client values
  Client detail
  Individual growth
  Collective growth by fund

AUM
  Current published AUM
  Initialize/adjust one fund
  Collective fund growth
  History/corrections

Payments
  Read-only PhonePe evidence

Audit
```

Payments remain gateway evidence. Investment Reviews owns accept/reject/allocation. Do not place approval buttons on the payment record itself.

The review drawer shows client, amount, selected fund, PhonePe state/reference/time, a required “bank confirmed” checkbox, and optional private note. The selected fund is read-only. One confirmation performs the atomic accept-and-allocate command.

The Client Growth screen must state:

> This changes client displayed values only. It does not change published AUM.

The AUM screen must state:

> This changes published fund AUM only. It does not change any client investment value.

Do not put AUM and client totals in the same comparison card. Remove cross-fund “Trending by AUM,” “Highest AUM,” and aggregate “Total AUM” presentation unless they are clearly labelled as display-only statistics; the simplest client catalogue omits them.

### 11.2 Client flow

```text
Issued funds
  -> Fund detail
  -> One-time or SIP
  -> PhonePe redirect/authorization
  -> Payment status
  -> “Payment received — investment is being processed”
  -> “Investment confirmed” after admin acceptance
```

The client should not see “bank verification pending” or internal allocation. If a succeeded payment is rejected, show only a neutral refund status and support message.

Remove Razorpay script loading and all browser-side gateway success assertions. The status page polls the backend after redirect.

## 12. File-level implementation map

### 12.1 Backend: replace or split

- Replace success-to-booking behavior in [settlePayment.ts](../../backend_controller/src/domain/client/settlePayment.ts#L62) with success-to-review behavior.
- Replace [bookOrder.ts](../../backend_controller/src/domain/client/bookOrder.ts#L53) with an admin-owned `acceptInvestment.ts` command.
- Replace [paymentWebhookRoutes.ts](../../backend_controller/src/routes/paymentWebhookRoutes.ts#L1) and [mandateWebhookRoutes.ts](../../backend_controller/src/routes/mandateWebhookRoutes.ts#L1) with PhonePe adapters using official validation.
- Add `providers/phonepe/phonePeCheckoutGateway.ts`, `phonePeRecurringGateway.ts`, and mapping tests.
- Add focused `adminInvestmentReviewRoutes.ts`, repository, query service, and accept/reject commands.
- Split growth routes out of the 999-line [adminCatalogRoutes.ts](../../backend_controller/src/routes/adminCatalogRoutes.ts#L1) and 1,100-line [adminOversightRoutes.ts](../../backend_controller/src/routes/adminOversightRoutes.ts#L1).
- Keep/refactor the value-only entry logic from [allocateGain.ts](../../backend_controller/src/domain/client/allocateGain.ts#L54) and the percentage helper from [poolGainDistribution.ts](../../backend_controller/src/domain/admin/poolGainDistribution.ts#L127) into Client Growth; delete proportional total-distribution code.
- Replace monthly AUM flow calculation with snapshot initialization/growth/correction commands.
- Join payment/order/user/selected fund/review in the admin queue instead of returning separate unmapped rows from [adminOversightRepository.ts](../../backend_controller/src/repositories/adminOversightRepository.ts#L308).
- Replace generic/Razorpay runtime settings in [environment.ts](../../backend_controller/src/runtime/environment.ts#L84), composition, deploy stacks, and environment examples.
- Update Kysely types after the clean schema rewrite.

### 12.2 Frontend: replace or remove

- Delete `frontend_stack/packages/client/src/utils/razorpay.js` and its exports.
- Rewrite `LumpsumSheet.jsx` as create order -> begin PhonePe -> redirect.
- Rewrite `StartSipSheet.jsx` as create plan -> PhonePe subscription authorization.
- Rewrite `PaymentStatus.jsx` to poll server truth and show neutral review state.
- Remove `confirmRazorpayPayment()` and Razorpay provider fields from `ordersApi.js`.
- Add `InvestmentReviewScreen.jsx` and its dedicated admin resource/cache domain.
- Keep PaymentsScreen as read-only gateway evidence, but remove its claim that no investment approval exists.
- Move individual and collective client growth out of fund catalogue workspace into Client Values.
- Replace `FundAumPanel.jsx` movement fields with initialize, amount/percentage growth, preview, and corrections.
- Ensure admin AUM mutations invalidate admin/client catalogue AUM caches after commit, but never invalidate client portfolio as a financial side effect.
- Remove production HTTP fallback to fixture funds; an eligibility error must not reveal hard-coded products or invented AUM.

### 12.3 Delete obsolete mechanisms

In the greenfield baseline, delete:

- Razorpay code, environment variables, copy, tests, and fixtures;
- unit/NAV executions, holdings, lots, movements, requested-units fields, and dummy redemption orders;
- `fund_aum_updates` and its investment/redemption roll-forward fields;
- legacy duplicate `fund_aum_snapshots` behavior before recreating the single target definition;
- generic fake payment and mandate webhook contracts;
- direct provider-success `bookOrder` path;
- fixture catalogue fallback in HTTP mode;
- SIP step-up until explicitly required;
- any endpoint that returns client investors under `funds.read`;
- any route accepting both client-growth and AUM-growth inputs.

## 13. TDD implementation sequence

Follow this order. Each slice begins with failing tests, then minimal implementation, refactoring, and coverage verification.

### Phase 0 — baseline reset

1. Write architecture tests for forbidden imports and output fields.
2. Replace migrations 015/017/018/021 with the clean target schema.
3. Regenerate database types.
4. Delete unit/NAV/Razorpay/generic-provider artifacts.

Exit: clean database migrates from zero; no old-model types or routes compile.

### Phase 1 — PhonePe one-time payment

1. Add `PaymentGateway` contract tests.
2. Add PhonePe SDK adapter tests for create, status, callback validation, timeout, and mapping.
3. Implement the two-short-transactions checkout orchestrator with stable-ID crash recovery.
4. Implement fast-ack durable callback inbox, asynchronous event processing, and reconciliation worker.
5. Implement client redirect/status UI.

Exit: PhonePe success produces `payment=succeeded`, `order=review_pending`, `review=pending`, and zero allocation/client-value/AUM rows.

### Phase 2 — admin acceptance and private allocation

1. Write command tests for accept, replay, concurrency, invalid state, amount mismatch, and permission denial.
2. Implement the review queue query and least-privilege routes.
3. Implement atomic approve-and-allocate.
4. Implement reject/refund lifecycle.
5. Build admin review UI and safe client statuses.

Exit: one accepted payment creates exactly one allocation and one contribution; no AUM row changes.

### Phase 3 — PhonePe SIP

1. Confirm merchant provisioning and current PhonePe AutoPay contract.
2. Test subscription creation/callback/status/redemption mappings.
3. Implement mandate authorization and due-installment redemption.
4. Route every successful installment through the same admin review.
5. If AutoPay is unavailable, implement the documented manual-checkout SIP fallback instead.

Exit: no mock mandate activation and no automatic client credit before admin acceptance.

### Phase 4 — client growth

1. Test individual amount/percentage gain and loss.
2. Test same-rate percentage and explicit per-client-delta collective modes.
3. Test negative guards, deterministic rounding, stale preview, rollback, idempotency, and concurrency.
4. Build individual and collective admin UI.
5. Verify client notifications contain no private allocation details.

Exit: client value changes; AUM remains byte-for-byte unchanged.

### Phase 5 — AUM

1. Test initialization, correction revisions, and latest-snapshot selection.
2. Test individual amount/percentage growth.
3. Test collective same-rate and explicit-delta modes.
4. Test negative guards, stale preview, rollback, idempotency, and locking.
5. Build AUM UI and cache invalidation.

Exit: AUM changes; client ledger remains byte-for-byte unchanged.

### Phase 6 — review and end-to-end verification

1. Run unit, integration, and critical E2E suites.
2. Verify at least 80% coverage for changed financial modules.
3. Run security review for PhonePe ingress, admin permissions, input validation, secrets, and private-field serialization.
4. Run code/TypeScript review and fix all critical/high findings.
5. Verify no Razorpay or retired model reference remains with repository guards.

## 14. Required tests

### Payment and PhonePe

- checkout request uses unique valid merchant order ID and exact amount/currency;
- crash after PhonePe checkout acceptance but before local persistence recovers by status lookup with the same merchant order ID;
- refund dispatch has the equivalent stable-ID crash recovery;
- callback authorization failure makes zero writes;
- authenticated callback is durably accepted within the acknowledgement deadline and processed asynchronously;
- malformed, duplicate, and out-of-order callbacks are safe;
- multiple `paymentDetails` records are retained without overwriting one provider transaction;
- callback merchant/amount/reference mismatch fails closed; INR is checked internally and against status responses that supply currency;
- redirect cannot confirm payment;
- status inquiry recovers a missed callback;
- provider success stops at review pending;
- provider failure creates no review/allocation/contribution/AUM;
- refund initiation and callback are idempotent;
- secrets and raw sensitive payloads are absent from logs/responses.

### Admin review/allocation

- only `investments.review.write` may accept/reject;
- accept requires succeeded payment, pending review, `bankVerified=true`, and the immutable selected fund;
- amount must equal the complete succeeded payment;
- concurrent/replayed acceptance creates one allocation and one contribution;
- accepted-order invariant proves its allocation and contribution exist and match the same user/fund/payment;
- acceptance changes no AUM row;
- rejection creates no contribution/allocation and starts a full refund;
- client APIs cannot serialize private review/allocation fields.

### Client growth

- individual amount and percentage adjustment;
- loss cannot make value negative;
- principal remains unchanged by growth;
- collective explicit deltas are preserved exactly and the batch total equals their sum;
- collective percentage calculates each client independently;
- zero-value/ineligible targets are handled explicitly;
- stale preview returns 409 with zero writes;
- any failed target rolls back the batch;
- replay creates no duplicate entries;
- AUM is unchanged.

### Fund AUM

- only `aum.write` may initialize/grow/correct;
- direct initial snapshot requires non-negative amount and valid date;
- individual amount and percentage growth;
- loss cannot make AUM negative;
- correction creates a revision and preserves prior snapshot;
- same-rate collective growth uses each fund's own basis;
- explicit deltas do not create fund-to-fund dependencies;
- one invalid/stale fund rolls back the whole batch;
- replay creates no duplicate snapshots;
- client values are unchanged.

### E2E

- one-time: issue fund -> client selects -> PhonePe sandbox success -> admin sees queue -> verifies/accepts/allocates -> client sees confirmed investment;
- rejection: PhonePe success -> admin rejects -> refund completes -> no investment exists;
- SIP: mandate active -> redemption success -> admin review -> accepted installment;
- individual client growth and collective client growth;
- individual AUM growth and collective AUM growth;
- client cannot discover private allocation through UI, API, errors, audit routes, or cache payloads.

## 15. Definition of done

Implementation is complete only when:

- PhonePe is the only live payment provider and Razorpay is absent;
- one-time and chosen SIP payment paths work against PhonePe sandbox;
- PhonePe success never auto-books an investment;
- admins have a working private review and allocation queue;
- acceptance is the only way a contribution is created;
- individual and collective client growth work independently of AUM;
- individual and collective AUM growth work independently of client values;
- client APIs cannot expose bank-review or private-allocation data;
- permissions are domain-specific;
- financial inputs are exact, validated, idempotent, locked, and audited;
- clean migrations, generated types, unit tests, integration tests, E2E tests, and 80%+ changed-module coverage pass;
- architecture guards prove there is no automatic client/AUM propagation or reconciliation.

## 16. Final recommendation

Implement this as a clean replacement, not an incremental compatibility project.

The simplest faithful model is:

> A client selects an issued fund and pays through PhonePe. PhonePe confirms the money movement. An admin privately verifies, accepts, and assigns the full investment to that selected fund. Client value is then maintained through explicit individual or fund-wide admin growth entries. Fund AUM is maintained through separate individual or multi-fund admin snapshots. Similar admin controls may exist in both systems, but neither system triggers, calculates, validates, or reconciles the other.

This preserves the manual control you want while removing the dangerous ambiguity in the current code: payment confirmation, investment acceptance, client growth, and fund AUM are four different facts, with four explicit owners and no hidden automatic bridge.

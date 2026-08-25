# PhonePe Mobile SDK, UPI Payment, and SIP AutoPay Implementation Plan

**Status:** Implementation in progress; external PhonePe UAT and production rollout not completed
**Date:** 2026-08-24
**Supersedes:** The earlier redirect-only SIP AutoPay plan at this same path
**Scope:** Replace browser-based PhonePe checkout in the Android client with PhonePe's native Ionic/Capacitor SDK for one-time investments, then implement real UPI AutoPay mandates for SIP investments while preserving the current investment review, allocation, ledger, callback, and reconciliation architecture.

## Implementation status as of 2026-08-24

This table describes the current working-tree implementation, not a released-production claim. Physical-device PhonePe UAT, merchant entitlement, signing registration, production pilot and a complete monthly cycle remain external gates.

| Phase | Current status | Evidence/remaining gate |
|---|---|---|
| 0 — vendor contract/spike | Externally blocked/pending | Official contracts were reviewed, but merchant AutoPay entitlement, exact app/signing registration and physical-device sandbox approval are not recorded as complete. |
| 1 — return containment | Implemented locally | Non-authoritative return bridge, expiry/correlation validation and environment/deploy guards are present; external hosted-fallback validation remains. |
| 2 — one-time mobile backend | Implemented locally | Stable SDK-order attempts, UPI Intent request, encrypted token replay and inquiry-first ambiguity handling are present behind a disabled-by-default flag. |
| 3 — native one-time client | Implemented locally | A single Capacitor adapter/orchestrator, owner-bound pending-payment recovery and client/admin native target guards are present; physical-device/vendor validation remains. |
| 4 — mandate persistence | Implemented locally | Migrations 034-035, application-owned mandate/setup/collection/cancel state, guarded repositories and manual-SIP isolation are present. |
| 5 — mandate authorization | Implemented locally | Canonical first-debit setup, owner APIs, callbacks, inquiry, cancellation outbox and client recovery/state mapping are present behind disabled-by-default flags. |
| 6 — monthly collection | In implementation/independent verification | T-24 collection preparation, notify, inquiry and canonical outcome handling plus dev/prod worker wiring are present in the working tree; do not mark complete until Phase 6 review and UAT pass. |
| 7 — operations/rollout | Partial | [Operations runbook](./PHONEPE_AUTOPAY_OPERATIONS_RUNBOOK.md) and [focused UAT checklist](./PHONEPE_AUTOPAY_UAT_CHECKLIST.md) are added. Admin exception UI, application metrics/alerts, vendor UAT, pilot and full-cycle observation remain pending. |
| 8 — final verification | Not complete | Dependency remediation, signed APK evidence, physical-device scenarios, sandbox/UAT collection cycle and final security/coverage evidence remain. |

No AutoPay production enablement or external UAT completion is claimed by this status update. Prometheus AutoPay alert rules are deferred because the backend currently exposes no `/metrics` endpoint and no implemented application metric names are available to alert on.

## 1. Decisions

1. **The Android app will use PhonePe's native mobile SDK.** It will no longer treat a hosted HTTPS checkout URL as the primary mobile payment experience.
2. **One-time investments will use a PhonePe mobile SDK order.** The backend creates `/checkout/v2/sdk/order`, returns the PhonePe order ID and short-lived SDK token, and the app invokes `PhonePePaymentPlugin.startTransaction()`.
3. **One-time mobile checkout will be restricted to UPI Intent initially.** PhonePe may display its native PayPage and then hand off to a compatible installed UPI app. The exact Android chooser UI is controlled by PhonePe/Android and must not be promised in application copy.
4. **SIP will use a real UPI AutoPay mandate.** SIP creation will create a pending local plan and PhonePe `SUBSCRIPTION_CHECKOUT_SETUP` order. The user authorizes it through a mandate-capable UPI app.
5. **PhonePe is not the investment ledger.** PhonePe owns provider-side authorization and debit outcomes; this application owns users, SIP schedules, installments, payments, fund relationships, admin review, allocations, ledger entries, and reconciliation history.
6. **SDK results and redirects are never payment truth.** Only authenticated PhonePe webhooks and server-to-server status APIs may confirm a payment, mandate, notification, redemption, cancellation, or refund.
7. **Existing manual SIPs will not be silently converted.** They remain `manual_checkout` until the user explicitly authorizes an AutoPay mandate.
8. **Web checkout remains a temporary/fallback channel only.** It must have a valid, non-authoritative return bridge during rollout, but it is not the target Android flow.
9. **The existing admin review rule remains initially.** A successful one-time payment or monthly SIP debit continues to enter `review_pending`; admin acceptance creates the allocation and client contribution exactly once.

## 2. Current implementation and observed defect

### 2.1 Current one-time payment flow

```text
LumpsumSheet
  -> POST /v1/client/orders
  -> POST /v1/client/orders/:orderId/pay
  -> StandardCheckoutClient.pay()
  -> backend returns checkout:{type:"redirect",url}
  -> window.location.assign(PhonePe URL)
  -> PhonePe redirects to configured HTTPS URL
  -> browser, not BeOnEdge native app
```

Evidence:

- `backend_controller/src/providers/phonepe/paymentGateway.ts` exposes `createCheckout()` returning `redirectUrl`; it has no mobile SDK-order operation.
- `backend_controller/src/providers/phonepe/phonePeCheckoutGateway.ts` uses `StandardCheckoutPayRequest` and `client.pay()` and rejects a response without `redirectUrl`.
- `backend_controller/src/routes/clientOrderRoutes.ts` returns `checkout: { type: "redirect", url }`.
- `frontend_stack/packages/client/src/services/ordersApi.js` preserves that redirect response.
- `LumpsumSheet.jsx`, `MandateDetail.jsx`, and `PaymentStatus.jsx` call `redirectToCheckout()`.
- `frontend_stack/packages/client/src/utils/checkoutRedirect.js` validates an external HTTPS URL and calls `window.location.assign()`.

### 2.2 Why `https://dev-app.beonedge.in/payment-status` fails

The configured PhonePe return URL does not match an application route:

- The actual route is `/app/payment/:paymentId` in `frontend_stack/packages/client/src/ClientApp.jsx` and `frontend_stack/packages/client/src/navigation/routes.js`.
- `/payment-status` is not registered. `frontend_stack/app/src/ClientRoot.jsx` therefore renders the Not Found screen: “We couldn't find that screen.”
- The configured URL is static and contains no `paymentId`, so changing it to `/app/payment/:paymentId` in an environment variable would still not work.
- Even a correct web URL opens in the external browser, whose storage/session is different from the installed Capacitor WebView. It cannot safely assume the app's authenticated session.
- Nginx already falls back to the SPA; this is a route and channel-contract error, not an Nginx 404.

The native SDK target removes this dependency: the app already knows its local `paymentId`, receives control through the plugin result, navigates internally to `/app/payment/:paymentId`, and polls the backend.

### 2.3 Current payment records that must be preserved

The existing payment architecture is a sound base:

- migration `018_canonical_payments.sql` provides one payment per investment order, multiple attempts, stable unique merchant order IDs, provider detail evidence, provider event storage, and refunds;
- `clientOrderRoutes.ts` persists the attempt before the provider call, calls PhonePe outside the transaction, then persists the result;
- `paymentsRepository.ts` uses guarded state transitions;
- `phonePeProviderEventRoutes.ts` authenticates raw callbacks, deduplicates events, and stores encrypted evidence;
- `paymentReconciliationWorker.ts` repairs missed or ambiguous callbacks through order-status inquiry;
- confirmed provider payment becomes `review_pending`, not an allocation;
- `adminInvestmentReviewRoutes.ts` atomically creates the allocation and contribution only after a verified successful payment.

### 2.4 Current SIP flow

The current SIP implementation is a recurring reminder/manual-checkout system:

```text
POST /v1/client/sips
  -> sip_plans.state = active
  -> first sip_installment order created immediately
  -> user manually opens another hosted checkout
  -> callback/status reconciliation
  -> admin review and allocation
  -> scheduler advances after order acceptance
```

There is no mandate table, setup attempt, subscription identifier, notify/redeem orchestration, or mandate-specific callback correlation. The existing `/phonepe/subscription` callback route currently feeds ordinary payment handling and is not a real subscription implementation.

## 3. Product and ownership boundaries

| Concern | BeOnEdge application | PhonePe |
|---|---:|---:|
| User/KYC/fund eligibility | Authoritative | None |
| SIP amount, fund, debit day, duration and due periods | Authoritative | Receives mandate/collection instruction |
| One-time investment order/payment records | Authoritative | Provider order and transaction outcome |
| Mandate authorization | Auditable local mirror | Authoritative provider evidence |
| Monthly debit execution | Schedules, requests and tracks | Executes and reports |
| Allocation, contribution ledger and portfolio | Authoritative | None |
| Fund AUM/growth/performance | Authoritative/admin controlled | None |
| Refund business record | Authoritative | Executes provider refund |

Out of scope: cards as the primary mobile flow, lending, invoices, merchant billing, wallets, generic subscriptions, market trading, or any broader financial platform.

## 4. Allowed PhonePe APIs and SDK surface

Implementation must copy the confirmed official contracts below. When PhonePe documentation conflicts, the merchant-specific integration pack and a sandbox contract test decide the behavior.

### 4.1 Ionic/Capacitor mobile SDK

Official package and calls:

```text
npm install ionic-capacitor-phonepe-pg
npx cap sync
```

```ts
import { PhonePePaymentPlugin } from "ionic-capacitor-phonepe-pg"

PhonePePaymentPlugin.init({
  environment: "SANDBOX" | "PRODUCTION",
  merchantId,
  flowId,
  enableLogging: false,
})

PhonePePaymentPlugin.startTransaction({
  request: JSON.stringify({ orderId, merchantId, token, paymentMode: { type: "PAY_PAGE" } }),
  appSchema: null,
})
```

The documentation identifies Ionic SDK version `3.0.5`. Unknown environment values default to production in the plugin; BeOnEdge must validate an exact enum and fail closed before invoking it.

Reference: [PhonePe Ionic SDK setup](https://developer.phonepe.com/payment-gateway/mobile-app-integration/standard-checkout-mobile/ionic/sdk-setup).

### 4.2 One-time mobile SDK order

Server endpoint:

```text
Sandbox:    POST https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/sdk/order
Production: POST https://api.phonepe.com/apis/pg/checkout/v2/sdk/order
```

Request shape:

```json
{
  "merchantOrderId": "stable-order-id",
  "amount": 10000,
  "expireAfter": 1200,
  "paymentFlow": {
    "type": "PG_CHECKOUT",
    "paymentModeConfig": {
      "enabledPaymentModes": [{ "type": "UPI_INTENT" }]
    }
  }
}
```

Response shape:

```json
{
  "orderId": "phonepe-order-id",
  "state": "PENDING",
  "expireAt": 1703756259307,
  "token": "short-lived-sdk-token"
}
```

Reference: [PhonePe Create Order Token API](https://developer.phonepe.com/payment-gateway/mobile-app-integration/standard-checkout-mobile/api-reference/create-order-token).

The installed `@phonepe-pg/pg-sdk-node` `2.0.6` already exposes `CreateSdkOrderRequest.StandardCheckoutBuilder()` and `StandardCheckoutClient.createSdkOrder()`. Its builder documentation and the raw REST documentation disagree about redirect URL requirements and its Standard builder does not clearly expose UPI constraints. Phase 0 must prove whether to use the installed builder, a verified newer version, or a small raw-HTTP adapter.

### 4.3 AutoPay mobile mandate setup

Use the same `/checkout/v2/sdk/order` endpoint with:

```json
{
  "merchantOrderId": "SIP_SETUP_stable-id",
  "amount": 10000,
  "expireAfter": 1200,
  "paymentFlow": {
    "type": "SUBSCRIPTION_CHECKOUT_SETUP",
    "subscriptionDetails": {
      "subscriptionType": "RECURRING",
      "merchantSubscriptionId": "SIP_stable-id",
      "authWorkflowType": "TRANSACTION",
      "amountType": "FIXED",
      "maxAmount": 10000,
      "frequency": "MONTHLY",
      "productType": "UPI_MANDATE",
      "expireAt": 1893456000000
    }
  }
}
```

The documented mobile mandate maximum is 1,500,000 paise (₹15,000). Fixed SIPs use `FIXED` and `MONTHLY`. The response contains the same SDK order ID/token shape and the app calls `startTransaction()`.

Reference: [PhonePe AutoPay Mobile SDK setup](https://developer.phonepe.com/payment-gateway/autopay/standard-checkout/setup-subscription/sdk-integration).

### 4.4 AutoPay lifecycle APIs

| Purpose | Official operation |
|---|---|
| Setup order status | `GET /checkout/v2/order/{merchantOrderId}/status` |
| Subscription status | `GET /checkout/v2/subscriptions/{merchantSubscriptionId}/status` |
| Notify monthly debit | `POST /checkout/v2/subscriptions/notify` |
| Notification/redemption status | `GET /checkout/v2/order/{merchantOrderId}/status` |
| Manual execute when `autoDebit:false` | `POST /checkout/v2/subscriptions/redeem` |
| Cancel mandate | `POST /checkout/v2/subscriptions/{merchantSubscriptionId}/cancel` |

PhonePe documents notification as mandatory 24 hours before a scheduled debit. The target request uses `autoDebit:true` with `redemptionRetryStrategy:"STANDARD"`; PhonePe then manages execution/retries. Do not also call redeem for the same auto-debit collection.

```json
{
  "merchantOrderId": "SIP_DUE_stable-period-id",
  "amount": 10000,
  "paymentFlow": {
    "type": "SUBSCRIPTION_CHECKOUT_REDEMPTION",
    "merchantSubscriptionId": "SIP_stable-id",
    "redemptionRetryStrategy": "STANDARD",
    "autoDebit": true
  }
}
```

References: [notify](https://developer.phonepe.com/payment-gateway/autopay/standard-checkout/redemption-notify), [execute](https://developer.phonepe.com/payment-gateway/autopay/standard-checkout/redemption-execute), [subscription status](https://developer.phonepe.com/payment-gateway/autopay/standard-checkout/subscription-status-2), and [cancel](https://developer.phonepe.com/payment-gateway/autopay/standard-checkout/subscription-cancel).

### 4.5 Vendor gates

Obtain written PhonePe confirmation for:

- AutoPay enablement and investment-category eligibility;
- dev/prod merchant IDs, Android application IDs and signing-certificate registration;
- Capacitor 8, Android target 36, and current plugin compatibility;
- one-time UPI Intent instrument behavior and fallback when no compatible UPI app exists;
- SDK token lifetime/replay behavior and whether mobile SDK orders need any HTTPS redirect;
- exact webhook HMAC algorithm, acknowledgement, event names, retry SLA, and raw-body rules;
- the documented 24-hour notification timing, holidays/time zones, retry/settlement behavior, and collection limits;
- discrepancies in `expireAt`/`expiryAt`, setup event names, and documented flow-type names.

## 5. Target flows

### 5.1 One-time UPI investment

```text
User confirms one-time amount
  -> local investment order created idempotently
  -> local payment + attempt + stable merchantOrderId persisted
  -> PhonePe mobile SDK order created outside DB transaction
  -> encrypted short-lived token + provider order ID persisted
  -> app receives checkout:{type:phonepe_sdk,...}
  -> PhonePe plugin opens native PayPage/UPI intent
  -> plugin returns SUCCESS/FAILURE/INTERRUPTED as UX result only
  -> app navigates internally to /app/payment/:paymentId
  -> webhook/status reconciliation establishes truth
  -> confirmed payment -> review_pending
  -> admin acceptance -> allocation + contribution + portfolio
```

### 5.2 SIP mandate setup

```text
User confirms SIP terms
  -> SIP = pending_mandate
  -> mandate + setup attempt + stable IDs persisted
  -> PhonePe SUBSCRIPTION_CHECKOUT_SETUP SDK order
  -> app invokes native startTransaction
  -> user authorizes in preferred mandate-capable UPI app
  -> setup status/webhook confirms COMPLETED
  -> subscription status confirms ACTIVE
  -> mandate = active; SIP = active
```

### 5.3 Monthly SIP collection

```text
T-24h worker validates ACTIVE mandate
  -> creates exactly one installment/order/payment/collection for due period
  -> POST notify with autoDebit:true and STANDARD retry
  -> PhonePe notifies and executes debit
  -> webhook/status reconciliation
  -> successful payment -> review_pending
  -> admin acceptance -> allocation/contribution
  -> schedule advances exactly once
```

## 6. Target backend architecture

### 6.1 Provider ports

Extend the ordinary payment port with a provider-neutral mobile operation, or add a focused `MobilePaymentGateway`:

```ts
interface MobilePaymentGateway {
  createSdkOrder(command: CreateSdkOrderCommand): Promise<SdkOrderCreated>
  getOrderStatus(merchantOrderId: string): Promise<OrderStatusFact>
}
```

Add a separate recurring port:

```ts
interface RecurringPaymentGateway {
  createMandateSdkOrder(command): Promise<MandateSdkOrderCreated>
  getSetupOrderStatus(command): Promise<MandateSetupStatus>
  getMandateStatus(command): Promise<MandateStatus>
  notifyCollection(command): Promise<CollectionNotificationResult>
  getCollectionStatus(command): Promise<CollectionStatus>
  cancelMandate(command): Promise<MandateCancellationResult>
}
```

Provider DTOs and PhonePe enums must remain inside `providers/phonepe`. Domain/database states are application-owned and explicitly mapped.

### 6.2 Client payment API

Keep `POST /v1/client/orders/:orderId/pay`, but make the requested channel explicit and idempotent:

```json
{
  "checkoutChannel": "phonepe_mobile_sdk"
}
```

Target response:

```json
{
  "orderId": "local-order-id",
  "paymentId": "local-payment-id",
  "provider": "phonepe",
  "status": "payment_in_progress",
  "checkout": {
    "type": "phonepe_sdk",
    "providerOrderId": "phonepe-order-id",
    "token": "short-lived-sdk-token",
    "merchantId": "registered-merchant-id",
    "environment": "PRODUCTION",
    "expiresAt": "ISO-8601"
  }
}
```

Never send client secret, OAuth token, callback credentials, or internal provider payloads to the APK.

The SDK token must be encrypted at rest until expiry so an idempotent retry can return the same provider order without minting a duplicate. It must never appear in logs, analytics, audit metadata, exception messages, screenshots, or admin APIs.

### 6.3 Transaction boundary

For every provider command:

1. Authenticate, authorize and validate.
2. In transaction A, lock the aggregate and persist stable merchant IDs plus a pending attempt.
3. Commit.
4. Call PhonePe outside the database transaction.
5. In transaction B, persist normalized result/token ciphertext/expiry using guarded transitions.
6. Recover an ambiguous crash/timeout through status inquiry using the same merchant ID.

### 6.4 Browser fallback return bridge

During rollout, do not keep `PHONEPE_REDIRECT_URL=/payment-status`.

If hosted checkout remains enabled, add a narrow public return bridge such as `/payment-return` that:

- accepts only an opaque, signed, expiring correlation token created per payment attempt;
- displays no private payment data and never claims success;
- offers “Return to BeOnEdge” through a verified Android App Link if configured;
- tells the user to reopen the app and check Transactions when app linking is unavailable;
- does not depend on browser authentication;
- cannot update payment state.

The primary mobile SDK path skips this bridge and navigates internally with the already-known `paymentId`.

## 7. Data model

### 7.1 Extend payment attempts

Add only fields required for the SDK channel:

- `checkout_channel`: `hosted_redirect | phonepe_mobile_sdk`;
- encrypted SDK token ciphertext/key version and token expiry;
- provider SDK order ID/state where not already represented;
- token-dispatched/consumed timestamps if operationally useful.

Do not store the SDK token in idempotency JSON, logs, generic provider metadata, or plaintext columns.

### 7.2 Extend SIP plans

Add `collection_mode`: `manual_checkout | phonepe_autopay`. Existing plans remain manual.

Legal AutoPay flow:

```text
pending_mandate -> active -> completed
pending_mandate -> cancelled | setup_failed
active -> cancel_pending -> cancelled
active <-> paused only from confirmed provider events/status
```

PhonePe documents pause/unpause as customer-controlled in the PSP app; the merchant cannot unpause. Current local pause/resume buttons must not pretend to change an AutoPay mandate.

### 7.3 Add `payment_mandates`

Fields:

- local ID, SIP/user/fund relationships;
- provider and unique `merchant_subscription_id`;
- PhonePe subscription ID/reference when returned;
- normalized state: setup pending, active, pause pending/paused, cancel pending/cancelled, revoke pending/revoked, expired, failed;
- fixed/variable amount type, max amount paise, monthly frequency;
- authorization, expiry, cancellation, last-status-check timestamps;
- sanitized provider error code and optimistic version.

Allow mandate history and enforce at most one current non-terminal mandate per SIP.

### 7.4 Add setup and collection attempts

`mandate_setup_attempts` persists stable setup merchant order ID, provider SDK order ID, encrypted SDK token/expiry, state and reconciliation fields.

`mandate_collection_attempts` links mandate, SIP, due period, investment order and payment; it stores unique merchant order ID, notify state/time, collection state, retry strategy, provider references and reconciliation fields.

Preserve the existing unique `(sip_plan_id, due_period)` installment invariant from migration `027_sip_installment_periods.sql`.

## 8. Android/Capacitor architecture

### 8.1 Single platform adapter

Add one application-owned adapter, for example:

- `frontend_stack/app/src/platform/phonePeMobileCheckout.js`;
- a small injectable interface exposed to the client package.

No page component should import `ionic-capacitor-phonepe-pg` directly. The adapter owns:

- exact environment mapping and fail-closed validation;
- `PhonePePaymentPlugin.init()` once per valid app session/config;
- SDK request serialization;
- `startTransaction()` invocation;
- normalization of `SUCCESS | FAILURE | INTERRUPTED | unavailable`;
- redaction and production logging policy;
- web/non-native fallback behavior.

### 8.2 Client orchestration

Create one shared flow used by `LumpsumSheet`, SIP/manual installment payment, and `PaymentStatus` retry:

```text
begin backend payment
  -> branch on checkout.type
  -> phonepe_sdk: invoke platform adapter
  -> redirect: legacy browser fallback only
  -> always navigate to local payment status after native SDK returns
```

The plugin's `SUCCESS` must not render “Investment confirmed.” It means only that the SDK UI returned. `PaymentStatus` continues polling the backend.

Persist the local pending `paymentId` before invoking the SDK so process death/interruption can recover through Transactions.

### 8.3 Android configuration

- Install the official PhonePe Capacitor package and synchronize native projects.
- Add PhonePe's documented Maven repository through the supported Gradle configuration.
- Register the exact dev and production application IDs/signing fingerprints with PhonePe. Current builds use `com.beonedge.app.dev` for dev client and `com.beonedge.app` for production client.
- Do not include or initialize the payment SDK in admin builds.
- Keep SDK logging disabled in production.
- Add VIEW/BROWSABLE intent filters and `appUrlOpen`/cold-start handling only if the confirmed PhonePe contract or the legacy fallback bridge requires them.
- Normalize any inbound URL through the canonical route manifest; never navigate directly from an untrusted URL.

## 9. SIP and collection workers

Modify `sipScheduleWorker.ts` to distinguish manual and AutoPay plans. AutoPay plans require an active mandate and create an idempotent monthly installment/payment/collection attempt.

Add a dedicated mandate collection worker that:

- claims bounded batches using locks/leases;
- creates notification work at least 24 hours before the scheduled debit;
- checks mandate status before notify;
- calls notify with `autoDebit:true` and `STANDARD` retry;
- does not call execute for the same auto-debit request;
- reconciles notification and redemption states;
- handles paused/cancelled/revoked/expired mandates without local state fiction;
- keeps stable IDs across timeouts and crashes;
- emits user/admin notifications and operational metrics.

Add the worker service to dev/prod Compose and keep callback/reconciliation consumers running when a collection kill switch disables new commands.

## 10. Callback, reconciliation, admin, and UI

### 10.1 Webhooks

- Confirm and implement PhonePe HMAC on the exact raw payload before parsing.
- Use the documented `event` field, not deprecated `type`.
- Route payment, mandate setup/status, notification, redemption, cancellation, pause/unpause/revoke and refund events to separate handlers.
- Do not send subscription events through ordinary `applyPaymentOutcome()`.
- Deduplicate semantically, tolerate out-of-order delivery, reject illegal state regression, and quarantine unknown events.
- Status APIs remain the repair path for callback gaps.

### 10.2 Admin

Add a focused mandate/collection surface showing:

- user, SIP, fund, mandate and provider references;
- setup/active/paused/cancelled/revoked/failed status;
- due/notified/debited/failed/reconciliation-required installments;
- callback/status timeline and sanitized failure codes;
- safe reconcile and cancel actions with permissions/reasons/audit.

Admins may not forge a provider success or directly rewrite provider history.

### 10.3 Client UI

- One-time button says “Pay securely with UPI” and opens the native SDK.
- If no compatible app/SDK exists, show an honest fallback or retry choice; do not silently open an unrelated URL.
- SIP creation explains monthly amount, first expected debit, mandate cap, authorization, pause/cancel ownership, and admin processing.
- SIP remains “Awaiting mandate authorization” until server-confirmed activation.
- Dashboard and detail pages show backend-confirmed states only.
- Rename `MandateDetail` if it remains a mixed plan screen, or make it a real mandate-backed screen.

## 11. Security and observability

- Strictly validate all client and provider payloads.
- Rate-limit setup, pay, retry, status and cancel endpoints.
- Require owner scoping for every payment/SIP/mandate read/write.
- Validate admin permissions and audit every operator action.
- Keep client/OAuth/callback secrets only in VPS secret configuration.
- Never log SDK tokens, OAuth tokens, full VPAs, callback credentials or raw authorization payloads.
- Encrypt short-lived SDK tokens if replay storage is required.
- Add explicit sanitized provider failure logs with request ID; do not collapse every provider/configuration failure into an unobservable generic 503.
- Add kill switches independently for mobile order creation, mandate setup, and monthly collection. Reconciliation stays enabled.

Metrics:

- mobile SDK order creation/success/failure and time to launch;
- SDK UI result versus eventual provider truth;
- mandate setup success/time to active;
- active/paused/cancelled/revoked/mismatched mandates;
- due/notified/debited/failed/review-pending installments;
- callback authentication failure, duplicate rate and lag;
- reconciliation mismatch age and provider latency;
- duplicate payment/allocation prevention.

## 12. Phased implementation roadmap

### Phase 0 — PhonePe contract and mobile spike

**What to implement**

1. Obtain AutoPay entitlement and merchant/app registration confirmation.
2. Validate official plugin `ionic-capacitor-phonepe-pg` against Capacitor 8, target SDK 36, dev/prod app IDs and release signing.
3. Build a throwaway SDK spike that initializes and opens a PhonePe sandbox mobile SDK order; do not connect it to investment posting.
4. Contract-test installed Node `createSdkOrder()` against the raw REST API and determine how UPI-only configuration is expressed.
5. Resolve every documentation discrepancy and record an ADR for SDK-result versus provider-truth ownership.

**Documentation references**

- Official Ionic SDK, Create Order Token, AutoPay setup/status/notify/cancel docs in section 4.
- Installed SDK README and type declarations under `backend_controller/node_modules/@phonepe-pg/pg-sdk-node`.

**Verification checklist**

- [ ] PhonePe confirms investment AutoPay entitlement.
- [ ] Correct application IDs and signing fingerprints are registered.
- [ ] Sandbox SDK opens on a physical Android device.
- [ ] Exact SDK order request/response and token lifetime are captured in contract fixtures.
- [ ] No production-default environment fallback is possible.

**Anti-pattern guards**

- Do not infer APIs from package names.
- Do not promise a specific Android chooser UI.
- Do not test production credentials as a substitute for sandbox/UAT approval.

### Phase 1 — Legacy return-route containment and observability

**What to implement**

1. Add a non-authoritative public `/payment-return` bridge for hosted-checkout fallback.
2. Generate a signed, expiring per-attempt return correlation value; remove the invalid static `/payment-status` target.
3. Add sanitized logging that distinguishes unconfigured gateway, PhonePe auth rejection, request rejection, timeout, provider 5xx and malformed response.
4. Add deployment validation for PhonePe environment/credentials/merchant configuration consistency.

**Documentation references**

- `ClientRoot.jsx`, `ClientApp.jsx`, `navigation/routes.js`, `checkoutRedirect.js`.
- `clientOrderRoutes.ts`, `phonePeCheckoutGateway.ts`, `runtime/environment.ts`.

**Verification checklist**

- [ ] Hosted fallback never lands on an unknown route.
- [ ] Return bridge works without browser authentication and exposes no payment data.
- [ ] Redirect alone cannot mark payment successful.
- [ ] Provider failures are diagnosable by request ID without secret leakage.

**Anti-pattern guards**

- Do not set a literal `/app/payment/:paymentId` environment URL.
- Do not pass raw payment IDs or success claims through an untrusted redirect.
- Do not build the fallback bridge as the primary Android flow.

### Phase 2 — One-time backend mobile SDK orders

**What to implement**

1. Write failing unit/integration tests for mobile order creation, idempotency, encrypted token replay, timeout recovery and UPI-only configuration.
2. Add the provider-neutral mobile checkout port and PhonePe adapter.
3. Extend payment-attempt persistence and API contracts with a discriminated checkout type.
4. Update `POST /v1/client/orders/:orderId/pay` to create/reuse a stable mobile SDK order outside the transaction.
5. Preserve existing webhook, reconciliation, review and allocation transitions.

**Documentation references**

- PhonePe Create Order Token API and Node SDK `CreateSdkOrderRequest.StandardCheckoutBuilder()`/`createSdkOrder()`.
- Existing two-transaction pattern in `clientOrderRoutes.ts`.

**Verification checklist**

- [ ] Repeated idempotent calls return the same provider order/token until expiry.
- [ ] UPI Intent is the only enabled mobile instrument.
- [ ] Timeout never creates a duplicate merchant order.
- [ ] SDK/OAuth tokens are absent from logs and plaintext DB fields.
- [ ] Callback/status success reaches current review flow exactly once.

**Anti-pattern guards**

- Do not return an OAuth token to the app.
- Do not store SDK tokens in generic JSON/idempotency logs.
- Do not hold DB transactions over PhonePe calls.

### Phase 3 — Capacitor native one-time checkout

**What to implement**

1. Write platform-adapter and client orchestration tests first.
2. Install/sync the official plugin and add required Android repository/configuration.
3. Add the single PhonePe platform adapter and fail-closed configuration.
4. Refactor lumpsum, installment payment, and payment retry to use the shared checkout orchestrator.
5. After any SDK UI result, navigate internally to the known payment status and poll backend truth.
6. Add interruption/process-death recovery through pending Transactions.

**Documentation references**

- PhonePe Ionic SDK init/startTransaction example.
- `frontend_stack/app/src/platform` lifecycle patterns and canonical route manifest.

**Verification checklist**

- [ ] APK launches PhonePe native PayPage/UPI intent without browser navigation.
- [ ] Double tap invokes one provider order and one SDK transaction.
- [ ] SUCCESS, FAILURE and INTERRUPTED never directly confirm payment.
- [ ] Physical-device UPI handoff and return work for registered build/signature.
- [ ] Web/admin builds remain functional and admin does not bundle the SDK.

**Anti-pattern guards**

- Do not import the plugin in page components.
- Do not create raw `upi://pay` requests.
- Do not rely on emulator completion for bank-linked UPI proof.

### Phase 4 — Mandate persistence and state machines

**What to implement**

1. Write migration/repository/state-transition tests.
2. Add SIP collection mode, mandates, setup attempts and collection attempts.
3. Add immutable application-owned state transitions and repositories.
4. Replace the architecture guard's blanket mandate prohibition with exact approved dependency and invariant checks; keep legacy deletion guards.
5. Update generated API contracts.

**Documentation references**

- Existing migrations `017`, `018`, and `027`.
- Sections 7 and PhonePe status-state documentation.

**Verification checklist**

- [ ] Existing SIP/payment/allocation data is unchanged.
- [ ] Existing SIPs remain manual checkout.
- [ ] One current mandate per plan and one installment/collection per due period are enforced.
- [ ] AutoPay SIP cannot be active without a confirmed active mandate.
- [ ] Out-of-order transitions cannot regress terminal state.

**Anti-pattern guards**

- Do not silently migrate existing SIPs.
- Do not use PhonePe enum strings as database/domain truth.
- Do not store full VPA or raw mandate authorization payloads.

### Phase 5 — Native SIP mandate authorization

**What to implement**

1. Add idempotent SIP create/setup/detail/retry/cancel APIs.
2. Create `pending_mandate`, setup attempt and stable subscription IDs before PhonePe call.
3. Create `SUBSCRIPTION_CHECKOUT_SETUP` mobile order and return the SDK token.
4. Reuse the mobile adapter to launch authorization.
5. Add setup/subscription webhook handlers plus status reconciliation.
6. Update SIP screens and remove manual-checkout copy for AutoPay plans.

**Documentation references**

- PhonePe AutoPay Mobile SDK setup and setup/subscription status pages.
- Existing eligibility/fund validation in `clientSipPlanRoutes.ts`.

**Verification checklist**

- [ ] SIP remains pending until server-confirmed active subscription.
- [ ] Retry preserves failed setup history and cannot duplicate a current mandate.
- [ ] User can authorize in a supported UPI app on a physical device.
- [ ] User cannot access another user's mandate.
- [ ] Existing manual SIP behavior remains truthful.

**Anti-pattern guards**

- Do not activate from plugin SUCCESS.
- Do not map local pause/resume buttons to nonexistent merchant control.
- Do not overwrite setup history on retry.

### Phase 6 — Monthly notify/auto-debit orchestration

**What to implement**

1. Write scheduler/concurrency/timing/crash/reconciliation tests.
2. Refactor SIP scheduler for AutoPay eligibility and idempotent monthly records.
3. Add the mandate collection worker and deploy services.
4. Notify at the confirmed 24-hour boundary with `autoDebit:true` and `STANDARD` retry.
5. Process notification/redemption callbacks and poll ambiguous outcomes.
6. Reuse payment success -> admin review -> allocation flow.

**Documentation references**

- PhonePe notify, notification status, redemption status and retry documentation.
- Current `sipScheduleWorker.ts`, `paymentReconciliationWorker.ts`, and Compose worker patterns.

**Verification checklist**

- [ ] Exactly one installment and merchant order exist per due period.
- [ ] Concurrent workers cannot double notify/debit/pay/allocate.
- [ ] Auto-debit flow does not also call manual execute.
- [ ] Paused/cancelled/revoked mandates produce no new debit command.
- [ ] Confirmed monthly payment reaches portfolio only after exact-once admin acceptance.

**Anti-pattern guards**

- Do not treat notify acceptance as payment success.
- Do not create a new merchant ID after ambiguous timeout.
- Do not advance schedule merely because notify was sent.

### Phase 7 — Admin, security, observability, and rollout

**What to implement**

1. Add mandate/collection exception admin APIs and screens.
2. Add safe reconcile/cancel actions, audit and permissions.
3. Add metrics, alerts, kill switches and runbooks.
4. Deploy dark, sandbox/UAT test, pilot one-time SDK checkout, then pilot new AutoPay SIPs.
5. Observe at least one complete monthly cycle before expansion.
6. Offer explicit opt-in mandate migration for existing manual SIP users.
7. Remove hosted redirect code only after live records and web fallback policy allow it.

**Documentation references**

- PhonePe go-live/UAT guidance.
- Release Manager deployment/rollback documentation.

**Verification checklist**

- [ ] Admin traces user -> SIP -> mandate -> installment -> payment -> allocation.
- [ ] Kill switch stops new commands while callbacks/reconciliation continue.
- [ ] Alerts detect auth failures, callback failures, stale notifications and mismatches.
- [ ] No existing SIP changes mode without consent.
- [ ] Rollback does not lose provider events or pending reconciliation.

**Anti-pattern guards**

- Do not perform a flag-day conversion.
- Do not let admins forge provider success.
- Do not disable reconciliation during a provider incident.

### Phase 8 — Final verification

**What to verify**

1. Re-read current PhonePe contracts and compare every DTO/endpoint/state.
2. Run unit, integration, architecture, security and E2E suites with at least 80% coverage.
3. Build signed dev/prod client APKs and confirm admin bundles exclude PhonePe SDK.
4. Run physical-device one-time UPI and mandate authorization tests.
5. Run sandbox/UAT monthly notification/debit, webhook loss, duplicate/out-of-order event and crash recovery scenarios.
6. Search for stale browser-only/SIP-manual claims and forbidden secret logging.

**Verification checklist**

- [ ] No `window.location.assign()` remains in the primary native payment path.
- [ ] No `/payment-status` configuration remains.
- [ ] No SDK result updates payment/mandate truth.
- [ ] No raw `upi://pay` construction exists.
- [ ] No PhonePe secrets/tokens occur in client bundles or logs.
- [ ] All exact-once investment/allocation invariants pass.

**Dependency audit baseline recorded for Phase 8 (2026-08-24)**

- Root workspace: high findings in direct `ngrok` and transitive `extract-zip`; no critical finding. The root ngrok version is user-owned drift and must be reviewed separately rather than changed during payment SDK work.
- Frontend workspace: critical findings in direct `vitest` and transitive `tar`; high findings in direct `vite` and transitive `brace-expansion`, `nanoid`, and `postcss`.
- Backend workspace: high findings in direct `nodemailer` and transitive `brace-expansion`, `fast-uri`, `find-my-way`, `js-yaml`, `nanoid`, and `undici`; no critical finding.
- Phase 8 must rerun `npm audit` in all three workspaces, assess reachable production impact, upgrade with regression testing, and record any accepted residual risk. These dependencies are not broad-upgraded during Phase 3 payment hardening.

**Anti-pattern guards**

- Do not waive contract/device tests because unit tests pass.
- Do not ship unresolved PhonePe documentation discrepancies.
- Do not mark rollout complete before a full monthly collection cycle.

## 13. File-level change map

### Add

- mobile payment gateway port and PhonePe SDK-order adapter/tests;
- PhonePe recurring gateway/schemas/state mapper/tests;
- migration for payment SDK fields, SIP collection mode, mandates and attempts;
- mandate/setup/collection repositories and domain state services;
- mandate collection worker/entrypoint;
- `frontend_stack/app/src/platform/phonePeMobileCheckout.js` or equivalent injected adapter;
- shared client checkout orchestrator;
- public legacy payment-return bridge;
- mandate/collection admin resources/screens;
- ADR, provider runbook and UAT checklist.

### Modify

- `backend_controller/src/providers/phonepe/paymentGateway.ts`
- `backend_controller/src/providers/phonepe/phonePeCheckoutGateway.ts`
- `backend_controller/src/routes/clientOrderRoutes.ts`
- `backend_controller/src/routes/clientSipPlanRoutes.ts`
- `backend_controller/src/routes/phonePeProviderEventRoutes.ts`
- `backend_controller/src/repositories/paymentsRepository.ts`
- `backend_controller/src/paymentReconciliationWorker.ts`
- `backend_controller/src/sipScheduleWorker.ts`
- `backend_controller/src/runtime/environment.ts` and composition;
- `backend_controller/src/db/types.ts` and repository exports;
- `backend_controller/src/investment-architecture.guard.test.ts`;
- `packages/contracts` source operations and regenerated OpenAPI;
- `frontend_stack/app/package.json`, lockfile, Capacitor/Android Gradle configuration;
- `frontend_stack/packages/client/src/services/ordersApi.js`;
- `LumpsumSheet.jsx`, `PaymentStatus.jsx`, `StartSipSheet.jsx`, `MandateDetail.jsx`, `Dashboard.jsx` and tests;
- dev/prod env examples, compose workers, deployment validation and health/diagnostics.

### Remove only after rollout

- redirect-only primary Android checkout behavior;
- invalid `/payment-status` configuration/copy;
- generic subscription callback-to-payment routing;
- fake/misleading mandate and AutoPay UI states;
- manual-payment actions from AutoPay SIP paths;
- hosted-checkout fallback if product policy and remaining records no longer require it.

## 14. Test matrix

| Area | Required cases |
|---|---|
| Mobile adapter | init success/failure, invalid environment, unavailable plugin, start SUCCESS/FAILURE/INTERRUPTED |
| One-time API | idempotent order, timeout recovery, token encryption/replay, UPI-only request, expiry/retry |
| Android | dev/prod app IDs, signing, cold/warm return, process death, no UPI app, physical UPI app |
| Payment truth | SDK SUCCESS with pending/failed provider; callback loss; duplicate/out-of-order callback; reconciliation |
| Mandate setup | success, cancel, expiry, retry, duplicate submit, inactive subscription |
| Monthly collection | T-24h notify, concurrent workers, autoDebit, paused/revoked/cancelled, provider timeout |
| Investment posting | one-time and SIP success -> one review -> one allocation/contribution |
| Security | cross-user access, admin permissions, token/log scan, callback authentication/replay, rate limits |
| Rollout | SDK kill switch, AutoPay kill switch, reconciliation remains active, manual SIP compatibility |

## 15. Final acceptance criteria

- Android one-time investment launches PhonePe native checkout/UPI handoff without an external browser as the primary flow.
- The app always returns to its own canonical payment status using its local `paymentId`.
- Browser fallback never lands on an unknown route or claims payment success.
- Provider webhook/status, not SDK UI, confirms payment.
- A SIP is active only after confirmed UPI mandate activation.
- Every monthly installment has an auditable local order, payment and collection record.
- Notify/auto-debit/reconciliation cannot duplicate debit or allocation.
- Admin can trace and operate the complete user/fund/SIP/mandate/payment/allocation chain without rewriting provider truth.
- Existing manual SIPs remain supported until explicit opt-in migration.
- Credentials and tokens are absent from APKs, logs and plaintext storage.
- Tests meet the repository's 80% threshold and all physical-device/UAT gates pass.

## 16. Recommended implementation order

1. Confirm PhonePe mobile SDK and AutoPay merchant/app entitlement.
2. Fix the broken legacy return route and provider error observability.
3. Add backend one-time mobile SDK-order support behind a kill switch.
4. Integrate the official Capacitor plugin and ship native one-time UPI checkout.
5. Validate on a physical device and pilot one-time investments.
6. Add mandate persistence and state machines.
7. Implement native SIP mandate authorization.
8. Implement T-24h notify/auto-debit collection and reconciliation.
9. Add admin operations, metrics, alerts and runbooks.
10. Pilot new AutoPay SIPs for a full monthly cycle.
11. Offer opt-in migration for existing manual SIPs.
12. Remove legacy browser/manual surfaces only after stability and record migration are proven.

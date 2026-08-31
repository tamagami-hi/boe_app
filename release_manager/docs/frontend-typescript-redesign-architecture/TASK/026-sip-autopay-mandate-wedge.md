# Task 026 — SIP AutoPay: the mandate never opens a payment page

## What was asked

Install the latest builds on the running emulator, log in as the maintainer's test client, and start a
SIP AutoPay mandate payment. AutoPay "was giving errors and doesn't even open the payments page".

Then, after the diagnosis: fix the three defects found, while the maintainer raises subscription
enablement with PhonePe.

## What I did

Installed `boe.dev.client.0.12.7.apk` and `boe.dev.admin.0.12.7.apk` on `emulator-5554`. Both match by
sha256 what `/srv/dev_stack/BOE_APP/dev_release/dev_apk/` and `dev_admin_apk/` publish, so the artifact
under test is the deployed one and not a local rebuild.

Drove the client through the WebView's DevTools socket rather than by tapping coordinates:

```bash
adb -s emulator-5554 shell cat /proc/net/unix | grep webview_devtools
adb -s emulator-5554 forward tcp:9222 localabstract:webview_devtools_remote_<pid>
# then CDP over 127.0.0.1:9222 — Runtime.evaluate, Input.dispatchMouseEvent, Network.*, Page.captureScreenshot
```

That is worth knowing for the next person: the dev APK is debuggable, so the whole client is
scriptable this way and the network trail comes out with response bodies attached. Remember
`adb forward --remove-all` afterwards.

## What actually happens

The account already had one SIP stuck in `pending_mandate` from the day before. Starting a fresh one
reproduced the failure exactly:

```
POST /api/v1/client/sip-autopay → 503 DEPENDENCY_UNAVAILABLE
```

No checkout URL comes back, so there is nothing for the app to open — that is the whole of "doesn't even
open the payments page". The screen said *"Nothing was created — AutoPay is not configured in this
environment."* Both halves of that were untrue.

Tracing the request id through `boe-dev-backend` into `boe-payment-service` gave
`err: "GatewayCredentialError"`, and calling PhonePe directly with the service's own credentials from
inside its container gave the actual answer:

```
POST /checkout/v2/pay  SUBSCRIPTION_CHECKOUT_SETUP → 401
{"code":"AUTHORIZATION_FAILED","message":"Subscription not enabled for merchant: M23X2SH2ZC4S1"}
```

**The root cause is a PhonePe merchant provisioning gap, not a bug.** OAuth succeeds, one-time checkout
works (the account has three settled ₹1 lump sums), and the dev stack talks to PhonePe *production*.
Subscriptions are simply not enabled on that merchant. Nothing in either repository can fix that.

## What was not expected

Three defects that turn a clean, well-reported refusal into a plan that can never move again. Full
detail in Entry 041; the shape is:

- `prepareAutoPay` commits everything, *then* `dispatchSetup` calls the gateway, and nothing rolled the
  setup attempt back on a throw — so it sat in `dispatching` forever.
- `canRetrySetup` needs `setup.state === "failed"`, which `dispatching` never becomes, so the detail
  screen offered only *Cancel the mandate*. No retry was reachable from the UI at all.
- PhonePe reports not-found as **400 `ORDER_NOT_FOUND`**, and the payment service only mapped **404** to
  `GatewayNotFoundError`. `mandateReconciliationWorker` reaches its grace-expiry path only for that error
  class, so it could never resolve the wedge — and kept retrying every 5 seconds against production
  PhonePe for 21 hours.

The third one is the interesting failure. The state machine's in-flight state had exactly one exit, and
that exit depended on an error class the provider never emits. See D-071.

## What changed

| Repo | File | Change |
|---|---|---|
| `boe_landing` | `payment-service/…/phonePeRecurringGateway.ts` | `bodyOf` maps a sub-500 body whose `code` matches `/_NOT_FOUND$/` to `GatewayNotFoundError` |
| `boe_landing` | `payment-service/…/phonePeRecurringGateway.test.ts` | New — 3 tests on that classification |
| `boe_app` | `backend_controller/src/routes/clientAutoPaySipRoutes.ts` | Mark setup + payment `failed` on a **definitive** refusal only |
| `boe_app` | `backend_controller/src/runtime/composition.ts` | Pass `settlementRepository` |
| `boe_app` | `backend_controller/test/integration/paymentSettlement.integration.test.ts` | Same, for the new required dep |
| `boe_app` | `frontend_stack_ts/src/features/sip/SipStartScreen.tsx` | Honest failure copy, mode-aware |

The rollback is gated on error class on purpose. A timeout or 5xx does **not** mean the mandate was not
created at PhonePe, and recording `failed` against a mandate that actually exists would let a retry create
a second mandate on one plan. Only `GatewayRejectedError` / `GatewayCredentialError` /
`GatewayNotFoundError` are treated as "nothing was created". Everything else stays `dispatching` for
reconciliation. D-071 has the reasoning.

## Verified, and not

**TESTED** — `payment-service` 65 tests, `backend_controller` 794 tests, `frontend_stack_ts` 199 tests,
three typechecks, eslint clean on touched files. The new gateway test was confirmed non-vacuous by
reverting the mapping and watching 2 of 3 fail.

**VPS, read-only** — container logs, the direct PhonePe probe, and `mandate_setup_attempts` showing
`dispatching | 2`.

**UNVERIFIED** — none of the three fixes has run against a real gateway. A green suite here proves the
classification and proves nothing regressed; it does not prove the rollback fires. AutoPay will keep
returning 503 until PhonePe enables subscriptions, so what should visibly change after deploy is the
**retry button appearing** on a refused plan, and the reconciliation loop **going quiet** as the two
wedged rows expire.

The two existing wedged rows are not repaired by code. They should drain on their own once the payment
service ships — reconciliation starts seeing `GatewayNotFoundError`, records
`not_found_first_observed_at`, and expires them after the grace window. That has not been observed.

## Before you touch this

1. **The fix for the actual outage is with PhonePe**, not here. Ask for UPI AutoPay / Subscription
   enablement on merchant `M23X2SH2ZC4S1`. Until then AutoPay returns 503 by design and manual checkout
   is the working path.
2. **`phonePeCheckoutGateway.ts` has the identical 400-vs-404 defect** for one-time payments. No live
   symptom, no wedged rows, left alone deliberately. Fix it on purpose, with a test, not incidentally.
3. **Pressing *Authorise the mandate* twice now gives 409, not 503.** The idempotency key is derived from
   the form inputs, so the second press replays a spent attempt. The contract pins `status` to the single
   literal `"mandate_setup_in_progress"`, so there was no truthful success shape to return and the
   `STATE_CONFLICT` copy was made accurate instead. Routing the user to the plan on failure is the real
   fix and needs the contract change.
4. **`boe_landing` had uncommitted work when I arrived** — `payment-service/src/server.ts` already adds
   `GatewayCredentialError → 502` and `GatewayThrottledError → 429` to `statusForGatewayError`. That is
   why the deployed service answered 500 rather than 502. Not mine; do not revert it. It needs deploying.
5. The payment service belongs to the **`boe-landing`** compose project at
   `/srv/dev_stack/BOE_LANDING/repo`, not to `dev_release`. Two separate deploys.

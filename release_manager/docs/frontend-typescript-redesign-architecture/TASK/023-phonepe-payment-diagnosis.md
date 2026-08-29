# Task 023 — why payments fail on the deployed dev stack

## What was asked

Payments on `https://dev-app.beonedge.in` end at a generic "Something went wrong on our side"
screen. The maintainer's hypothesis: `mercury-t2.phonepe.com` is not an allowed origin, only
`mercury.phonepe.com` is, so our own allowlist rejects the redirect. Test the deployed stack
through a real browser with real production PhonePe credentials and find out whether payments
pass through.

## What actually happens

They do not pass through, and the cause is not in this repository.

`POST https://api.phonepe.com/apis/pg/checkout/ui/v2/pay` — the request the *PhonePe checkout page*
makes once it has loaded, not a request our backend makes — returns HTTP 400:

```json
{
  "errorCode": "INTERNAL_SECURITY_BLOCK_1",
  "detailedErrorCode": null,
  "isRetryEnabled": false,
  "data": {
    "Onboarding_URL": ["www.beonedge.in"],
    "Transacting_URL": "https://dev-app.beonedge.in/"
  }
}
```

PhonePe is refusing the transaction because the merchant is onboarded for `www.beonedge.in` and the
transaction is originating from `dev-app.beonedge.in`. It is a merchant-side domain whitelist.
`isRetryEnabled: false` means no amount of retrying, and no change to our code, will make it
succeed from this host.

## Everything up to that point works

Confirmed by driving the deployed stack in a headed browser as the maintainer's test client:

| Step | Result |
| --- | --- |
| `POST /api/v1/client/orders` | `201` |
| `POST /api/v1/client/orders/{id}/pay` | `200`, with a redirect URL |
| Redirect host | `https://mercury-t2.phonepe.com/transact/pgv3?token=…` |
| Frontend allowlist check | passed — no `CheckoutUrlRejected` |
| PhonePe page render | merchant name **Beonedge LLP**, correct amount, UPI / Debit-Credit Card / Net Banking all offered |
| Paying | blocked by `INTERNAL_SECURITY_BLOCK_1` |

The merchant name and a valid token rendering on PhonePe's own page is proof the production
credentials are correct and the signed payload is accepted. The block is purely about which domain
the payment page was opened from.

## Both original hypotheses were wrong

**The maintainer's:** `mercury-t2.phonepe.com` is not merely allowed, it is the *correct* production
host for Standard Checkout v2. It was already present in both allowlists:

- `frontend_stack_ts/src/features/payments/checkout.ts` → `CHECKOUT_ORIGIN_ALLOWLIST`
- `PHONEPE_CHECKOUT_ALLOWED_ORIGINS` in the deployed `.env`, read back from the VPS as
  `https://mercury.phonepe.com,https://mercury-t2.phonepe.com`

**Mine, first:** that the deployed allowlist was missing the host the provider returned, so
`trustedCheckoutUrl()` in `phonePeCheckoutGateway.ts:321-326` threw
`GatewayMalformedResponseError` and the client rendered `ErrorState` variant `server`
(`ui/patterns/ErrorState.tsx:36`, the exact string the maintainer saw). Disproven: the redirect
reached PhonePe, so that gate passed.

The identical user-visible error from two unrelated causes is the thing worth remembering here.
See the log entry for what was changed about that.

## Not the cause

- **Amount.** Fails identically at ₹500 and at ₹50,000.
- **`PHONEPE_ENV`.** Left at `production` throughout; the credentials are valid.
- **Our CORS / origin allowlist.** `WEB_ORIGIN_ALLOWLIST` includes `https://dev-app.beonedge.in`.

## The fix, which is not a code change

One of:

1. Add `dev-app.beonedge.in` as a transacting domain on the PhonePe merchant dashboard, or ask
   PhonePe support to whitelist it against the same merchant. Preferred for a dev stack.
2. Serve the client from `www.beonedge.in`, the domain already onboarded.
3. Use a separate sandbox merchant for `dev-app` and set `PHONEPE_ENV=sandbox`. This needs the
   allowlist change described in the log entry, which is the one code change this task made.

## Orders left behind on the production merchant

Driving the checkout created real orders against the live merchant. None were paid; all sit in
`payment_pending` and will expire on their own. Recorded so they are not mistaken for user activity:

```
04bc5dca   ₹50,000   payment_pending   ← mine, unintended: the script hit an amount preset button
fc722745   ₹500      payment_pending   ← mine
235f5577   ₹500      payment_pending   ← mine
d8a7d54b   ₹1        payment_failed    ← the maintainer's, 11:48
1ba178d5   ₹1        payment_failed    ← the maintainer's, 11:45
```

`investment_allocations` gained no rows in the window, which is correct: nothing was paid.

## Reproducing this

`test_e2e/vps-payment-diagnose.mjs` drives login → order → pay against the deployed stack in a
headed browser. `test_e2e/vps-qr-400-body.mjs` is the narrower one: it captures the response *body*
of the failing PhonePe request, which is where `INTERNAL_SECURITY_BLOCK_1` and the two URLs are.
Without reading that body the failure looks like an opaque 400.

Both need `DISPLAY=:0` and the maintainer's test credentials passed in the environment.

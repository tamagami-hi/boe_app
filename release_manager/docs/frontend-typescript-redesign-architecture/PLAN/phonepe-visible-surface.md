# Step 1 + §33 — the complete set of inputs PhonePe can see

Enumerated from source, not inferred. This is the deliverable for "produce a code-accurate map" and
it also answers Phase 0.5 (§31) without needing another run.

## Every occurrence of `dev-app.beonedge.in` in shipped backend code

Four, and **none is in the PhonePe request path**:

| location | what it is | reaches PhonePe? |
| --- | --- | --- |
| `routes/publicOnboardingRoutes.ts:8` | a comment | no |
| `runtime/environment.ts:186` | default `downloadBaseUrl` for the APK | no |
| `release/releaseFeed.ts:264` | compares against that same download URL | no |
| `runtime/environment.ts:405` | `expectedHost`, used to *validate* our own callback URLs | no — validation input, never transmitted |

48 further occurrences are in tests. The rest are release scripts, nginx, docs and env examples.

## Every byte the checkout call sends

`buildClient` in `phonePeCheckoutGateway.ts` and `authorizedRequest` in `phonePeApiClient.ts` are the
whole surface:

```
POST https://api.phonepe.com/apis/pg/checkout/v2/pay
  Authorization: O-Bearer <token>
  Accept: application/json
  Content-Type: application/json

  { merchantOrderId, amount, expireAfter,
    paymentFlow: { type: "PG_CHECKOUT",
                   merchantUrls: { redirectUrl } } }
```

No `Host` of ours, no `X-CALLBACK-URL`, no `User-Agent` carrying a domain, no referer. The OAuth grant
sends `clientId` / `clientSecret` / `clientVersion` and no URL. `getOrderStatus`, `refund` and
`getRefundStatus` are path-and-`Accept` only.

## So the complete PhonePe-visible input set is

| input | current value | on the approved domain? |
| --- | --- | --- |
| merchant credentials | `PHONEPE_CLIENT_ID` etc. | n/a |
| `merchantOrderId`, `amount`, `expireAfter` | per order | no URL |
| `merchantUrls.redirectUrl` | `https://www.beonedge.in/pay/return/dev` | **yes**, confirmed by `docker exec printenv` |
| dashboard: webhook URL | `https://www.beonedge.in/api/v1/provider-events/phonepe/payment` | **yes** |
| dashboard: approved URL (T&C) | `www.beonedge.in` | **yes** |

## Which means Phase 0.5 has already run, and returned Result B

§31 asks for a ₹1 order where every PhonePe-visible URL is on `beonedge.in` and no `dev-app` URL appears
in the checkout request. That is exactly the state the stack has been in since the compose passthrough
landed: the redirect is on `www`, the webhook is on `www`, and the enumeration above shows there is no
third URL. The order run in that state returned:

```json
{"errorCode":"INTERNAL_SECURITY_BLOCK_1",
 "data":{"Onboarding_URL":["www.beonedge.in"],"Transacting_URL":"https://dev-app.beonedge.in/"}}
```

That is §32 **Result B**.

## §32 Result B — where the value comes from, having searched rather than guessed

Checked and eliminated:

- **Runtime environment variables** — enumerated; only `expectedHost` mentions `dev-app` and it is a
  validation input, never sent.
- **Merchant URLs in the request** — the only one is `redirectUrl`, already on `www`, varied and
  confirmed in-process.
- **Dashboard configuration** — webhook moved to `www`; approved URL is `www`.
- **Checkout request construction** — enumerated above, byte for byte.
- **Redirect URL construction** — `command.redirectUrl ?? config.checkoutRedirectUrl`, unit-tested.
- **Frontend-generated values** — the browser sends `{"type":"UPI_QR"}` and no hostname (Entry 032).
- **Database values** — no table stores a provider URL; `provider_payment_details` holds ids and states.
- **Deployment configuration** — compose passthrough verified with `printenv` in the running container.

Nothing in anything we control still emits `dev-app.beonedge.in` toward PhonePe.

**Conclusion: `Transacting_URL` is a value stored inside PhonePe against this merchant.** It is
consistent with their email describing the URL "you are using to receive payments" against the one
"approved and mentioned in your Terms & Conditions document" — a record, not a per-request derivation.

## Consequence for the migration

Steps 3–6 of §44 move code that **already sends only approved-domain URLs**. There is no remaining
`dev-app` input for the migration to remove, so it cannot change `Transacting_URL`. The architecture is
still worth building on its own merits — provider abstraction, credential isolation, one integration
point for both apps, and provider replaceability per §43 — but it will not lift the current block, and
the 3 September deadline should not depend on it.

## The two remaining levers, both on PhonePe's side

1. **Rotate the API key.** The dashboard's *API Keys* tab is the one input never varied. If the stored
   transacting URL is bound to the key pair rather than the merchant, a new key pair may carry a fresh
   record. Cheap, minutes, no code. Note `PHONEPE_CLIENT_ID` was already changed once today
   (fingerprint `eaeca95858` → `d1b5c71aac`) with no effect, which weakens this but does not kill it —
   that may have been a rotation within the same key record.
2. **Support ticket, naming the value explicitly.** Help → "Unable to receive customer payments?" →
   Contact Us → Update URL. Ask two things: add `dev-app.beonedge.in` and `app.beonedge.in` as approved
   URLs, and **reset the recorded transacting URL**, quoting the `INTERNAL_SECURITY_BLOCK_1` body. Ask
   whether subdomains of an already-approved parent skip full re-verification.

## For the 3 September deadline

PhonePe approval is 7+ days and the deadline is inside that window, so the realistic plan is:

- **Dev testing now:** sandbox credentials. Proven working on 2026-08-25 — 7 succeeded payments, 7
  allocations. Needs `PHONEPE_ENV=sandbox` plus sandbox credentials; the allowlist already carries
  `https://mercury-uat.phonepe.com`.
- **Production:** cannot take live payments until PhonePe approves the production host or resets the
  record. That is a business dependency, not an engineering one, and it is worth raising with them today
  with the deadline stated.

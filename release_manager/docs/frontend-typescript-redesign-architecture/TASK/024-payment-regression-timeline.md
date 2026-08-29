# Task 024 — when payments worked, and what actually changed

## Why this exists

Task 023 concluded that payments from `dev-app.beonedge.in` are blocked by PhonePe with
`INTERNAL_SECURITY_BLOCK_1`, and that the merchant is onboarded for `www.beonedge.in`. That
conclusion still holds. What it got wrong was the implication that this had always been so.

The maintainer said payments used to pass through, from this same host, around v0.10.7. They were
right, and Task 023 had no evidence either way because it only looked at the live database — which
was **created on 2026-08-27 09:53** and therefore contains no history from before that date.

## Payments really did succeed

Recovered from the pre-deploy dump
`/srv/backup/BOE_APP/DEV_ROLLBACK/DEV_PSQL_DB/0.11.6/dev_boe_app_dev_20260826T121152Z_pre-deploy.dump`,
read with `pg_restore -f -` in a throwaway container — no server started, nothing written, the live
database untouched:

```
payments:               24 rows, of which 7 succeeded
investment_orders:      30 rows
investment_allocations:  7 rows   ← money landed
```

Allocation timestamps run **2026-08-25 13:37** to **2026-08-26 04:48**. The two earliest carry
`source = admin`; the rest are `source = system` with `settlement:<uuid>` references, i.e. produced
by the settlement path rather than entered by hand. So the full chain — order → payment → allocation
— has demonstrably run on this stack.

For contrast, the live database has never had a single `succeeded` payment or a single allocation.

## What changed between then and now

The deployed `.env` is preserved across deploys and the maintainer keeps timestamped copies of it.
Reading the PhonePe keys out of each (secrets as lengths and salted fingerprints only):

| `.env` snapshot | when | `PHONEPE_ENV` | merchant id len | client id len | checkout allowlist |
| --- | --- | --- | --- | --- | --- |
| `.env.before-nodeenv-fix` | 08-25 10:13 | production | – | 114 | none |
| `.env.before-phonepe-fix` | 08-25 10:14 | production | – | 114 | none |
| `.env.before-sandbox-creds` | 08-25 11:54 | **sandbox** | **11** | 114 | `https://mercury-uat.phonepe.com` |
| `.env.before-production-layout…` | 08-26 11:25 | **production** | **13** | 24 | `https://mercury-uat.phonepe.com` |
| `.env.pre-email-verification…` | 08-27 09:45 | production | 13 | 24 | none |
| `.env.pre-hosted-checkout-20260827` | 08-27 19:16 | production | 13 | 24 | none |
| `.env` (current) | 08-27 19:17 | production | 13 | 24 | `mercury.phonepe.com,mercury-t2.phonepe.com` |

The credentials are genuinely different accounts, not the same account reconfigured — the client-id
fingerprint changes from `20629fcceb` to `eaeca95858` and the merchant id changes length.

**The seven successful payments (08-25 13:37 → 08-26 04:48) fall entirely inside the sandbox
window**, which opens at 08-25 11:54 and closes at 08-26 11:25 when the production merchant was
configured. Since that switch, nothing has succeeded.

## So the causal story is

Payments worked against the PhonePe **sandbox** merchant, which does not enforce the onboarded-domain
check. When the stack was pointed at the **production** merchant — onboarded for `www.beonedge.in` —
PhonePe began refusing transactions that originate from `dev-app.beonedge.in`.

Nothing in this repository regressed. The change was a credential change on 2026-08-26, and the
blocking rule belongs to PhonePe.

## Confirmed at ₹1, not just at ₹500

Re-ran the diagnostic under a hard ₹2 spend cap. PhonePe rendered "Beonedge LLP" and `Total: ₹1.00`,
offered UPI / Debit-Credit Card / Net Banking, and returned the same body on
`POST /apis/pg/checkout/ui/v2/pay`:

```json
{"errorCode":"INTERNAL_SECURITY_BLOCK_1","isRetryEnabled":false,
 "data":{"Onboarding_URL":["www.beonedge.in"],"Transacting_URL":"https://dev-app.beonedge.in/"}}
```

Order `92dd79b6` was created at exactly `100` paise. The block is amount-independent: identical at
₹1, ₹500 and ₹50,000.

## Two ways forward, and what each needs

1. **Whitelist `dev-app.beonedge.in`** against the production merchant on the PhonePe dashboard.
   Nothing to change here.
2. **Point the dev stack back at the sandbox merchant** to keep testing. This needs
   `PHONEPE_ENV=sandbox`, the sandbox credentials, *and* `https://mercury-uat.phonepe.com` in
   `PHONEPE_CHECKOUT_ALLOWED_ORIGINS` — the current deployed `.env` has dropped it, and without it
   sandbox checkout fails closed at `trustedCheckoutUrl()` with the same generic error screen. The
   repo examples were fixed for this in Entry 027; the deployed `.env` still needs it by hand.

The 08-25 sandbox configuration is the proof that option 2 works: it lists exactly that origin.

## A separate defect: paying from the APK returns to the browser, not the app

Reported by the maintainer and confirmed by reading the code. Three independent reasons, all of
which have to be fixed for the return to land in the app:

1. **The backend never asks for an app return.** `clientOrderRoutes.ts:221` passes
   `redirectUrl: null`, so `phonePeCheckoutGateway.ts:313` falls back to
   `new URL("/dashboard", config.callbackUrl)` → `https://dev-app.beonedge.in/dashboard`. A web URL.
2. **There is no contract field to ask with.** The pay operation has no `redirectUrl` input, so the
   client cannot supply a deep link even if it wanted to.
3. **The app registers no deep link.** `frontend_stack_ts/android/app/src/main/AndroidManifest.xml`
   declares exactly one intent filter — `MAIN` / `LAUNCHER`. No `VIEW`, no `BROWSABLE`, no
   `android:scheme`, no `autoVerify`. And nothing in `frontend_stack_ts/src` listens for
   `appUrlOpen`. So no URL, however formed, can currently re-enter the app.

`androidScheme: "https"` with no `hostname` means the APK's own content origin is `https://localhost`,
which is a different origin from `dev-app.beonedge.in` — the return cannot be handled by the WebView
simply navigating there.

This is not fixed in this task. It needs a decision first, recorded as the open question in D-055:
Android App Links on `dev-app.beonedge.in` (verified, needs `/.well-known/assetlinks.json` and a
stable signing certificate — release APKs are currently unsigned) versus a custom scheme such as
`beonedge://payment-return` (works immediately, but PhonePe may refuse a non-https `redirectUrl`).

## Also noted, and deliberately not "fixed"

`9b0ed63` deleted `location = /payment-return` from both nginx configs and `32e4764`
("restore hosted checkout") never put it back. That looks like a botched restore, but it is not:
`9b0ed63` also deleted `paymentReturnRoutes.ts` and `paymentReturnToken.ts` from the backend and
those were not restored either. nginx and the backend agree that the route does not exist. Adding the
nginx block back would proxy to nothing. The real gap is the one above — there is no return path into
the app at all — and it needs designing, not un-deleting.

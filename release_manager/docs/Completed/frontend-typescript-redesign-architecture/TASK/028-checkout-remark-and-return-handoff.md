# Task 028 — the payer saw an order id, and the return never reached the app

## What was asked

From a live ₹1.00 payment on a real handset, two things:

1. The UPI confirm sheet showed `Payment for boe_b02d2cb1372a449c92c9a0863f0dc08f` in the remark
   slot. The maintainer does not want that visible.
2. After the payment completed, the phone stayed on a web page instead of handing back to the
   app, and there was no payment confirmation screen.

Server `.env` files were out of scope: provider secrets and backend runtime config are the
maintainer's, and no script may read or write them.

## What the remark turned out to be

Not ours. Nothing in `boe_app` or in `boe_landing/payment-service` composes that string — the
service was searched for `Payment for`, `remark`, `transactionNote`, `message` and `description`.

PhonePe's `POST /checkout/v2/pay` takes an optional `paymentFlow.message`, described in the
create-payment reference as the message used for collect requests and in the Node SDK reference
as the message shown in the app for a UPI collect transaction. When it is not sent, PhonePe
composes `Payment for <merchantOrderId>` itself. The pay request built in
`phonePeCheckoutGateway.ts` sent `type` and `merchantUrls` and nothing else.

So the defect was an omission, and the fix is to stop omitting it. `CHECKOUT_MESSAGE` in
`gateways.ts` is the single value, `"BeOnEdge investment"`, and it is now part of the gateway's
required config rather than an optional extra that can be forgotten.

The recurring gateway was left alone on purpose — `message` is not documented for the
subscription flows and PhonePe rejects unexpected fields outright. Breaking AutoPay setup to
tidy a screen nobody complained about is the wrong trade. Recorded as D-073.

## Why the return stayed in the browser

Three independent causes, stacked. Each one alone was enough to keep the payer on a web page.

**The destination was the dashboard.** `PAYMENT_CALLERS[].returnUrl` pointed at
`<app-host>/dashboard`. The Android manifest claims `/pay/return` and nothing else, so the
dashboard was never going to trigger a handoff; the tab just rendered a second copy of the app,
on the web, with its own storage.

**Nothing named the caller.** The return route in `server.ts` already read `?s=` and resolved it
through `deps.runtimes` — so this was never an open redirect — but no code ever produced a URL
carrying `s`. Every payer fell through to `runtimes[0]`.

**The App Link, when it did fire, opened the wrong screen.** This is the one that produced "no
confirmation page", and it was not visible from reading the return chain alone. The invest
screens persist the pending payment and navigate to `/activity/payments/<paymentId>` *before*
opening the checkout tab, so the confirmation screen is already there, underneath, polling — and
it dismisses the tab itself the moment the status goes terminal. `AppLinkRouter` was then
navigating to `/pay/return` on the incoming link, replacing that live confirmation with a static
page that says "We do not have the final result of this payment yet." and dropping the payment
id on the floor.

## What changed

`boe_landing/payment-service`:

- `phonePeCheckoutGateway.ts` — `checkoutMessage` added to `PhonePeGatewayConfig` and sent as
  `paymentFlow.message`.
- `gateways.ts` — `CHECKOUT_MESSAGE`, and `returnUrlFor()` as the one place a return URL is
  built. It tags the URL with the authenticated caller's service name.
- `server.ts` — the mandate flow uses `returnUrlFor()` instead of composing its own URL. The
  checkout flow needed no change: it passes `null` and the per-caller gateway config now carries
  the tagged URL, which also keeps the existing "a caller-supplied redirect URL is ignored" test
  honest.
- `config/env.ts` — `APP_RETURN_PATH = "/pay/return"`, and the configured `returnUrl` is reduced
  to its origin. The path comes from the constant.

`boe_app`:

- `AppLinkRouter.tsx` — `internalDestinationFor` replaced by `isClaimedPaymentReturn` (does this
  link belong to us) and `pendingPaymentDestination` (where should it go). An incoming claimed
  link now closes the tab and navigates to the pending payment's own screen —
  `/activity/payments/<id>`, or `/sips/<id>` for a mandate setup — and navigates **nowhere** when
  nothing is in flight, because then the app is already showing the resolved result.

`/pay/return` is untouched and stays the web fallback: it is what a browser sees when App Link
verification is not in force, and its copy is written for exactly that reader.

## Deployment

Nothing needs editing on the server. Because the return path is derived in code, deploying
boe_landing is sufficient — there is no `.env` change and therefore no ordering constraint
between config and code.

Rechecked on 2026-09-08: the live development host serves valid JSON at
`/.well-known/assetlinks.json`, and the emulator verifies the domain against the installed
release signing certificate. A direct Android VIEW intent for the return URL opens
`com.beonedge.app.dev`. The earlier claim that this host serves the SPA catch-all was stale.
The live payment-service return still points to `/dashboard`; its updated source must be
deployed, and the native return changes require an updated client APK.

## Gates

`payment-service`: typecheck silent · 7 files / 76 tests (was 5 / 65) · build clean.
`boe_landing` root: `tsc --noEmit` silent · 7 files / 102 tests · build compiles, `/pay/return/[target]` still dynamic.
`boe_app`: typecheck and eslint silent · 22 files / 206 tests (was 21 / 199) · `build:client` with the Android checks · `release_manager` 15/15.

## What is not proven

The remark and the handoff are both **unverified in the sense that matters**: no payment has been
made since the change. The message field's behaviour is documented, not observed, and the
complete PhonePe-to-APK handoff needs the payment-service deployment and updated APK. The
documentation describes the message field for collect requests; replacement of the specific
remark in the screenshot remains unverified.

## Return review follow-up — 2026-09-08

The return handler now rejects missing, unknown, empty, or repeated service selectors with
HTTP 400 rather than selecting the first caller. Every response has `Cache-Control: no-store`.
The deployment verifier now probes `/payment-return?s=boe-dev` and `?s=boe-prod`, including
invalid selector cases, in addition to the separate Next.js bridge.

The native router now reads Capacitor's cold launch URL and retains incoming return events
while the session restores. It resolves only the current user's persisted payment. Navigation
runs after the authentication redirect effects, with cleanup cancelling stale work. A real
MemoryRouter regression reproduced the splash/login race to `/dashboard` before the fix and
now lands on the payment route. URL parameters never supply the payment identity or status.

Validation: frontend 212 tests, typecheck and lint passed; payment-service 79 tests,
typecheck and build passed. A local check using the real runtime builder, mocked PhonePe HTTP,
and the actual return route verified both caller URLs through to their own `/pay/return`.
No PhonePe payment was initiated by those checks.

The rebuilt development APK was installed on `emulator-5554`. Calling the native
Browser plugin with `https://www.beonedge.in/pay/return/dev` opened the checkout tab and
returned to BeOnEdge's MainActivity. After force-stopping the app, an Android VIEW intent
for the app return URL reported `LaunchState: COLD`; Capacitor's `getLaunchUrl()` returned
that exact URL. The emulator was signed out and correctly remained on `/login`.
Authenticated return destinations are covered by the router tests, not a real payment.

Artifact: `emu/out/boe.dev.client.0.13.4.apk`, a debuggable development build signed with
the configured release certificate. The shared payment service has not been deployed by
this follow-up, so its public endpoint still uses the previous dashboard destination.

After the maintainer signed in on the emulator, the warm browser return was repeated:
MainActivity returned to the foreground and `/dashboard` remained active. A second test
force-stopped the app and opened its return URL; Android reported a cold launch, Capacitor
received the URL, and the restored session reached `/dashboard` without another sign-in.
There was no persisted pending payment on this emulator, so these signed-in device checks
verify handoff and session restoration, not a specific payment confirmation. No payment
was created and no payment data was changed.

The maintainer then initiated and completed a real payment at 20:38 IST. After completion,
Chrome CustomTabActivity remained in the foreground at
`https://dev-app.beonedge.in/login`. Its navigation history contained PhonePe checkout
entries followed by that login page. The continuous capture failed to start, so intermediate
HTTP redirects were not captured for this transaction. Bringing the existing APK forward
manually revealed its payment screen showing ₹1 as `Invested`, with payment received and
investment timestamps at 20:38 and the pending-payment record cleared. This confirms a
successful payment with a failed automatic return under the still-deployed old service.
The assistant initiated no payment and changed no payment state.

# Task 010 — the rest of the product, and the retirement of the legacy frontend

Phases 5 to 12.3. At the end of this task `frontend_stack_ts` is the only frontend in the repository
and every route in both manifests renders a real screen.

## The shape of the work

Three things had to happen in order, and the order was forced by dependency rather than preference.

**Contracts first.** Fifty-eight new operations. Nothing could be built against a surface that was
not described, and describing it meant reading the route handlers — not the legacy client, which was
wrong about at least one thing (it read `latestSetupState` from the AutoPay detail response, a field
that endpoint does not return). Four parallel investigations transcribed the handlers literally:
methods, path templates, permission codes, header requirements, Zod bodies field by field, exact
success statuses, response objects with nullability, and every reachable `AppError`.

Two findings changed the backend rather than the contract:

- `/v1/client/sips/autopay` is ambiguous against `/v1/client/sips/{sipPlanId}/pause` in the OpenAPI
  path model. Fastify resolves it by preferring the static segment, so nothing was broken at runtime,
  but a path that works only because of a framework's matching order is worth fixing while the app is
  pre-production. It is now `/v1/client/sip-autopay`.
- `PATCH /v1/admin/faqs/:faqId` decided what operation it was performing by counting the keys in the
  request body. Two operations cannot share one method and path, and the dispatch was actively
  harmful: `{"status":"published","order":3}` was silently reinterpreted as a content edit and then
  rejected. Lifecycle moved to `PATCH /v1/admin/faqs/:faqId/status`.

**Then the screens.** Thirty of them were seven-line placeholders. The client side carries the
money-handling rules; the admin side carries the permission and concurrency rules.

**Then the retirement**, which is mostly a reference-chasing exercise: 370 files removed, and every
script, workflow, test and document that named them followed.

## What the money code actually promises

Phase 7 is the highest-risk phase in the plan, so its rules live in two small modules with tests
rather than inside a screen.

`checkout.ts` decides what to do with a `/pay` response and refuses to guess:

- `terminal: true` is a normal outcome, not an error. The order was already past the payable states.
- `checkout: null` means **poll**. It does not mean retry. The dispatch claim is a one-writer lock,
  and a retry would be a second write against a claim someone else holds.
- The checkout URL is validated a second time on the client even though the backend validated it.
  Two independent checks on a URL that takes the user out of the application. `https` only, exact
  origin match against an allowlist, and no userinfo — `https://mercury-t2.phonepe.com@evil.test/pay`
  is refused, which is the case a substring check would wave through.

`pendingPayment.ts` records where the user went, and **verifies the write by reading it back**. If it
did not persist, the checkout is aborted before the redirect. That is the difference between an
investor who can find their payment and one who cannot: there is no deep link back, and PhonePe is
sent `redirectUrl: null`.

Twenty tests cover exactly those decisions. They are not there for coverage; each one is a way the
money could go wrong.

The copy is held to the same standard. The payment status screen says returning from PhonePe is not
settlement evidence, because it is not — only the provider's authenticated callback and server-side
reconciliation settle money. The SIP screens say a manual-checkout plan never debits automatically,
and that returning from the UPI app does not authorise a mandate.

## What the admin console refuses to do

- **Write affordances gate on the write permission.** `content.read` alone previously opened the FAQ
  screen with a working Publish button. Every write control now checks the write code and says which
  permission is missing when it is absent.
- **Both preview-then-commit protocols clear the preview on conflict.** A `STATE_CONFLICT` on commit
  means the underlying data moved after the preview was taken. The UI voids the preview and requires a
  new one. It does not retry, because retrying would apply a decision made about different numbers.
  The screens say so in those words.
- **Receipt acknowledgement carries the version it read.** If someone else acknowledges first, the
  request is refused and the screen refetches rather than overwriting their decision.
- **Illegal transitions are not offered.** The fund workspace mirrors `ALLOWED_TRANSITIONS` from the
  route; the FAQ table only offers Publish to a draft and Unpublish to a published row.
- **A missing provider is not a missing screen.** The mandate routes are registered only when both
  PhonePe credential sets exist, so an unconfigured environment 404s before authentication. The list
  screen recognises that and says "PhonePe is not configured in this environment".

## Reading the screenshots found what the tests could not

Thirty-five screenshots at 390px and 1512px, read rather than merely captured.

Money was rendering in JetBrains Mono. Every test passed; 676 backend tests, 110 frontend tests and
45 browser checks had nothing to say about it. `₹51,25,000` in a monospace face on warm ivory reads as
terminal output, and the rupee sign was falling back to a different face than the digits. The
requirement in doc 10 is *tabular figures*, so values do not shift — not a monospace typeface. See
D-029.

The same pass found empty states hugging the left edge of a full-width card, tab bars stretching
across the entire measure, the admin topbar repeating the page title next to a sign-out button styled
like a disabled control, and a duplicated `aria-label` across the two client navs.

One real defect came from a check that was passing while printing an error: `check-bundle-boots.mjs`
was emitting `Route render failed TypeError: window.matchMedia is not a function` and exiting 0,
because it only fails on a thrown boot error. `useBreakpoint` and `Reveal` called `window.matchMedia`
directly, so any environment with a `window` but no `matchMedia` failed to render the route. Both now
go through `lib/media.ts`.

## The drift check had to be replaced, not re-baselined

Blocker B4 said: point `check-frontend-contract-drift.mjs` at `frontend_stack_ts` and regenerate the
baseline, or deleting the legacy tree makes it throw `ENOENT`.

Doing that produced `Checked 0 frontend paths`. The check scans source for literal `/v1/...` strings,
and the new frontend never writes one — it passes an operation descriptor to one transport. The check
had become vacuous, and a vacuous check is worse than no check because it reports success.

It is replaced with the invariant that actually holds: no literal `/v1` path may appear in frontend
source outside the generated client, and the generated client must carry exactly as many operations as
the contracts define. It currently reports 94 operations and no bypasses. Details in D-030.

## Verification

`test_e2e/frontend-ts-smoke.mjs` grew from 45 to **71 checks**, all passing after the retirement. The
new ones assert that every admin surface renders its own `h1`, that an unconfigured provider is
distinguished from a missing screen, that a new FAQ is created as a draft and only then offers
Publish, and that publishing it lands in the audit log under `content_item`.

The money assertion is unchanged and still literal: an administrator records 250 basis points of
growth on ₹50,00,000 and the investor's catalogue shows **exactly ₹51,25,000**. The arithmetic is
checked, not assumed.

All three gates exit 0. The three `release_manager` shell tests pass against the ported paths.

## What is still unproven, and it matters

**No money has moved.** `/pay` returns `DEPENDENCY_UNAVAILABLE` without PhonePe credentials, which is
correct behaviour and also means every phase 7 acceptance criterion is unverified. The rules above are
tested as decisions; the flow they guard has never run.

**No APK exists.** `android/` is ported but `cap sync` has never touched it and no Gradle build has
been attempted. Everything doc 10 lists as needing a device — safe-area insets under a cutout, system
bar contrast, keyboard resize with a sticky action bar, all five Back rules, the WebView checkout
round-trip, the biometric prompt, APK self-update with its SHA-256 check, and the absence of tokens in
`logcat` — remains untested.

**The containers have never been built.** `frontend_stack_ts/Dockerfile` is asserted on by
`runtime_contract.test.sh` and has never been given to `docker build`.

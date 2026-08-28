# 12 — Risk, Regression and Testing Plan

## What can and cannot be verified on the development machine

The maintainer's laptop is a development and test machine. Available: `tsc --noEmit`,
`vitest run`, `eslint`, one-shot builds, read-only inspection. Not available: a running system.

**A green test run is not evidence that a feature works.** Three real defects in this repository
were invisible to a full green suite:

1. A button whose handler prop was never passed — and the legacy `NativeBackCoordinator`'s
   `onTransactionalBack` is a live instance of exactly this, documented as a prop and never
   supplied by `main.jsx`.
2. An optimistic-concurrency precondition sent from a stale snapshot.
3. Mail recorded as `sent` by a transport that silently discarded it — which is why
   `createUnconfiguredEmailSender` now rejects rather than resolving.

So every claim below is labelled either **TESTABLE HERE** or **VPS ONLY**, and no phase is
called complete on the strength of tests alone.

## Risk register

| # | Risk | Impact | Likelihood | Mitigation | Verification |
|---|---|---|---|---|---|
| R1 | Duplicate payment — money taken twice | Severe, financial | Low, given the backend design | Idempotency key per operation, re-minted only on body change; writes never auto-retried; the dispatch claim is a one-writer lock; `payments_order_uk`; attempt reuse; `(provider, provider_order_id)` uniqueness | TESTABLE HERE for the client rules; **VPS ONLY** for the outcome |
| R2 | Payment taken but not recorded | Severe, financial | Low | Server-side reconciliation owns the truth; `applyCanonicalPaymentOutcome` requires exact amount, currency, merchant-order-id and detail-sum matches or falls to `reconciliation_required` | **VPS ONLY** |
| R3 | Migration 043 not applied before hosted-checkout code ships | Severe — every hosted-checkout write violates a CHECK | **High if unmanaged** | Migration before code; the deploy tooling already gates on schema family | **VPS ONLY** |
| R4 | User leaves for PhonePe and cannot get back to their payment | High | Medium | Persist the pending payment **and verify the write** before navigating; abort the checkout if it fails; recovery on next authenticated mount | TESTABLE HERE (unit); **VPS ONLY** (device) |
| R5 | Return from PhonePe misread as success | Severe — a user believes they invested when they did not | Medium if the rule is forgotten | Return always shows *pending*; only server state settles | TESTABLE HERE (the UI never renders success from a return); **VPS ONLY** end to end |
| R6 | Session family revoked by parallel refresh, signing users out mid-flow | High | **High without coalescing** | One in-flight refresh promise per scope; reuse `rotationId` on retry | TESTABLE HERE |
| R7 | Credentials in `localStorage` on a device | Severe, security | Low | Secure Storage only on native; fail closed; purge legacy `localStorage` tokens | TESTABLE HERE (unit); **VPS ONLY** (device) |
| R8 | Admin authorization bypassed | Severe, security | Very low | Backend re-reads roles and permissions **per request**; client guards are UX only | TESTABLE HERE (guard units); **VPS ONLY** (real principal) |
| R9 | Cross-tenant data exposure | Severe, security | Very low | Backend maps `WRONG_OWNER → RESOURCE_NOT_FOUND`; the frontend never constructs another user's id | **VPS ONLY** |
| R10 | Safe-area failure — content under the notch or gesture bar | High, silent | **Medium** | The four-mechanism contract; `safeArea.test.ts` guards the source | TESTABLE HERE (source contract); **VPS ONLY** (a real device, both orientations) |
| R11 | Blank screen from a cyclic chunk graph | Severe — v0.9.0 shipped this with zero failing tests | Medium | `check-android-dist.mjs` acyclicity check; `check-bundle-boots.mjs` JSDOM evaluation | TESTABLE HERE |
| R12 | Admin asset shipped inside the client APK | Medium — bundle bloat and information leak | Medium | Single dynamic import on a ternary; `check-android-dist.mjs` name check | TESTABLE HERE |
| R13 | Token or credential leaked to `logcat` | Severe, security — this has happened | Low | `loggingBehavior: 'none'`; PhonePe `enableLogging: false` for **every** target | **VPS ONLY** — read `logcat` during a full flow |
| R14 | New frontend origin missing from `WEB_ORIGIN_ALLOWLIST` | High — the app looks entirely offline | **High if forgotten** | Blocker B5, resolved in Phase 0 | **VPS ONLY** |
| R15 | Contract drift — the new frontend calling an uncontracted path | Medium, compounding | Medium | Blocker B4: point the drift checker at the new tree | TESTABLE HERE, in CI |
| R16 | `contracts` CI job breaks when the legacy frontend is deleted | Medium — blocks all merges | **Certain without B4** | Parameterise `frontendRoot`, tolerate a missing root | TESTABLE HERE |
| R17 | Stale optimistic-concurrency snapshot silently overwriting | High, data integrity | Medium | `OptimisticVersionForm` refetches and re-presents on `STATE_CONFLICT`; never blind-retry | TESTABLE HERE (unit); **VPS ONLY** (concurrent operators) |
| R18 | `basisHash` commit against a moved basis | High, financial | Medium | `PreviewCommitPanel` clears the preview on 409 and forces a re-preview; a backend guard test enforces the server half | TESTABLE HERE; **VPS ONLY** end to end |
| R19 | Mandate admin screens broken where PhonePe is unconfigured | Medium | **High** — the routes are conditionally registered | Render a 404 on those routes as "not configured in this environment" | TESTABLE HERE (unit); **VPS ONLY** per environment |
| R20 | Remote-supplied path or URL reaching the router or the browser unresolved | High, security | Medium — the legacy code has one live instance at `Notifications.jsx:89` | `resolveDestination` at all four call sites | TESTABLE HERE |
| R21 | Feature regression during cutover | High | Medium | The parity checklist below | **VPS ONLY** |
| R22 | Email verification vocabulary mismatch producing a blank status | Low | Medium | Resolve decision D8 before building the status UI | **VPS ONLY** to confirm the wire value |
| R23 | AutoPay unbuildable on web, shipped as a broken button | Medium | **High without decision D1** | Resolve D1 in Phase 0 | TESTABLE HERE once decided |
| R24 | Stale fund detail after a publish | Low | **Certain** — `invalidatePrefix` is never called | Accept it, or apply backend correction BC10 | **VPS ONLY** |
| R25 | Rate limiting absent on login, OTP, `/newuser`, payments | Medium, security | Existing, pre-dating this work | Out of scope for the frontend; recorded so it is not lost | **VPS ONLY** |
| R26 | APK self-update installs unverified bytes | Severe, security | Very low | The native plugin **rejects** a download without a `sha256`, rejects non-https, hashes in the same pass, and confines installs to `cacheDir/updates/` | **VPS ONLY** |

## Tests written here — and why each is justified

`README.md` §2–3 permits new tests only for logic that is critical, security-sensitive,
financial, authentication/authorization, or data-integrity related.

| Test | Protects | Justification |
|---|---|---|
| `domain/money.test.ts` | `rupeesToPaise` / `paiseToRupees` round-trip; rejection of non-positive, non-safe-integer, and float-drift inputs | Financial calculation — a wrong conversion is monetary loss |
| `api/http.test.ts` — 401 coalescing | Concurrent 401s produce **exactly one** rotation | A second rotation revokes the session family |
| `api/http.test.ts` — retry policy | A non-GET is never retried, on any error | Duplicate payment prevention |
| `api/http.test.ts` — timeout | The deadline covers body reading, not just headers | A hung body read otherwise blocks a payment flow indefinitely |
| `api/idempotency.test.ts` | Stable key per body; re-minted on body change | Duplicate payment prevention, and `IDEMPOTENCY_KEY_REUSED` avoidance |
| `app/routing/resolveDestination.test.ts` | Refuses `javascript:`, `data:`, cleartext `http:`, `//host`, self-origin, unknown internal path | A security boundary over remote content: notification deep links, published config, disclosure documents |
| `features/payments/checkout.test.ts` | `terminal` does not redirect; `checkout: null` polls and does **not** re-POST; a non-allowlisted URL is refused; a failed pending-payment write **aborts** | Money can be taken with no route back |
| `features/payments/pendingPayment.test.ts` | Expiry, owner match, verified write | Same |
| `app/routing/RequirePermission.test.tsx` | Denies on a missing permission; any-of and all-of semantics | Authorization UX over a server-enforced boundary |
| `app/routing/routeIntegrity.test.ts` | Every manifest route mounted; every nav entry resolvable; every write-capable route linked; every route declares a back parent | Navigation integrity is a stated product requirement, and the legacy frontend has a real unreachable-capability defect |
| `domain/status.test.ts` | Exhaustive over every API status union | A new backend status becomes a compile error, not a blank badge |
| `ui/tokens/safeArea.test.ts` | Only `tokens-core.css` reads `env(safe-area-inset-*)`; nothing redeclares `--be-safe-*`; the viewport meta is correct; no `user-scalable=no` | Silent APK layout failure with no error anywhere |
| `ui/contracts.test.ts` | No colour/spacing/radius/font/z-index literal outside tokens; no media query outside `ui/` and `shells/`; no breakpoint literal in TypeScript; only `Page` sets a content `max-width`; only `PageHeader` renders `<h1>`; no gsap | These are the exact rules whose absence produced the legacy inconsistency |
| `scripts/check-android-dist.mjs` | Asset budgets, font subsets, cross-target assets, **acyclic chunk graph** | v0.9.0 shipped a blank screen with zero failing tests |
| `scripts/check-bundle-boots.mjs` | Every chunk evaluates without throwing | The only pre-device smoke test |
| `features/admin/OptimisticVersionForm.test.tsx` | `STATE_CONFLICT` refetches and re-presents, never blind-retries | Data integrity on concurrent admin operations |
| `features/admin/PreviewCommitPanel.test.tsx` | A 409 clears the preview and blocks commit until a new preview | Financial integrity on batch growth |

**Not tested**, per `README.md` §4: styling, spacing, typography, icons, labels, text, basic
component rendering, simple formatting, non-critical helpers, refactoring, file reorganisation,
straightforward CRUD, cosmetic bugs, navigation adjustments, logging.

## Feature parity checklist — must pass on the VPS before cutover

Nothing here is provable on the development machine.

### Authentication and session

- [ ] Client login on a real Android device, on both dev and prod stacks
- [ ] Admin login in a browser
- [ ] Admin login in the admin APK — the **bearer** path, not cookies
- [ ] App restart preserves the client session
- [ ] Browser reload preserves the admin session and recovers CSRF before any mutation
- [ ] An expired access token refreshes transparently once, mid-navigation
- [ ] Two simultaneous requests hitting 401 produce **one** rotation and do **not** revoke the family
- [ ] A revoked session lands on login with an expiry notice
- [ ] A backend outage during restore shows a retry state, **not** a logout
- [ ] Logout clears the token store and the query cache
- [ ] Device-limit eviction: a fourth device sign-in evicts the oldest and does not reject
- [ ] Same-device re-login replaces rather than accumulating sessions
- [ ] A client account in `suspended` or `closed` renders the terminal wall, with support reachable

### Email OTP Verification

- [ ] Start issues a code and the email arrives
- [ ] Verify unlocks investing and the eligibility state changes
- [ ] A wrong code decrements the visible attempt count
- [ ] The fifth wrong attempt locks with a distinct message
- [ ] Resend inside the cooldown shows a server-driven countdown
- [ ] An expired code offers resend and does not read as a wrong code
- [ ] Requesting a new code invalidates the previous one
- [ ] An SMTP failure reads "we could not send the email", **not** "verification failed"
- [ ] No screen, label or URL says "KYC"

### Funds

- [ ] The catalogue lists every published fund
- [ ] Search, status chips, risk chips and all four sort modes work
- [ ] Fund detail renders performance, benchmark, holdings, sector allocation, ratios, disclosures
- [ ] The donut reflows from 320px to 1440px without overflow or dead space
- [ ] Percentages are consistent between the list and the detail
- [ ] Disclosure links open externally through the allowlist
- [ ] Investor charter and grievance are reachable **from Legal**

### Payments — the highest-risk block

- [ ] A ₹2 lump sum completes and produces exactly **one** `payments` row, one `payment_attempts` row, one `investment_allocations` row, one `client_value_entries` contribution and one `pending` `fund_receipt_acknowledgements` row
- [ ] A duplicate submit with the same idempotency key **replays** and creates nothing new
- [ ] An edited amount produces a new key and a new order
- [ ] A second `/pay` on the same attempt returns `checkout: null` and the UI **polls** instead of re-POSTing
- [ ] Return from PhonePe shows **pending**, never success
- [ ] Killing the app during checkout and reopening recovers to the payment status screen
- [ ] An abandoned checkout expires and reconciles to a terminal state
- [ ] A payment failure surfaces a retry that creates a **new attempt**, not a duplicate payment
- [ ] `PHONEPE_CHECKOUT_ALLOWED_ORIGINS` is enforced — a non-allowlisted URL is refused client-side
- [ ] Migration 043 is applied and no CHECK violation appears in the backend logs

### SIP and AutoPay

- [ ] A manual SIP can be created and appears in `/sips`
- [ ] `/sips/:sipPlanId` is reachable **from the list**, not only after creation
- [ ] Pause, resume and cancel all work and reflect immediately
- [ ] A due installment appears in Activity and is payable through the standard flow
- [ ] `debitDay` is constrained to 1–28
- [ ] The UI states plainly that manual mode has no automatic debit
- [ ] AutoPay behaves per decision D1 on web **and** on Android
- [ ] Returning from the UPI app does not claim authorisation; only server state does
- [ ] AutoPay setup retry within the token TTL replays rather than creating a second mandate

### Portfolio, activity, statements, notifications, support

- [ ] Portfolio positions and total value match the backend projection
- [ ] Exactly **one** total-return figure across dashboard, portfolio and statements
- [ ] Activity paginates by cursor past 100 rows
- [ ] Changing a filter restarts pagination without `CURSOR_INVALID`
- [ ] Notification mark-read persists
- [ ] A notification deep link resolves through the manifest, and an unknown path is refused
- [ ] Support FAQs load, tickets list, ticket creation returns 201

### Device security and app update

- [ ] PIN set, change, remove
- [ ] Biometric enable, disable, unlock
- [ ] App lock engages on cold start and on resume
- [ ] The UI does not overstate what the lock protects
- [ ] A mandatory update blocks the app, including on the login screen
- [ ] An optional update can be deferred for the launch and is not remembered across launches
- [ ] A download with a mismatched SHA-256 is rejected
- [ ] The install intent launches and the update applies

### Admin — every route

- [ ] Every route renders with correct permission gating for at least two distinct role sets
- [ ] Read-only principals see **no** write affordances
- [ ] Application queue lists, expands and decides; a duplicate decision replays
- [ ] The decision endpoint is called with `?outcome=` and an empty body
- [ ] User directory search and status filter paginate correctly
- [ ] Fund create, publish, lifecycle and holdings CRUD all work with `If-Match`
- [ ] A version conflict refetches and re-presents rather than retrying
- [ ] AUM initialize, growth and correction work; the rate limit surfaces as a wait, not an error
- [ ] Collective AUM preview then commit works, and a 409 clears the preview
- [ ] Client growth individual and collective work, including the 409 path
- [ ] Receipt acknowledgement works, including the `expectedVersion` conflict
- [ ] Refund retry and reconcile work **if** decision D6 keeps the feature
- [ ] Mandate list and detail load; reconcile and cancel work with `finance.operate`
- [ ] Where PhonePe is unconfigured, mandate routes read "not configured in this environment"
- [ ] Audit log loads and paginates
- [ ] Email deliveries load with masked recipients
- [ ] FAQ create, edit, publish, unpublish and delete work — **each with an idempotency key**
- [ ] App config loads, edits, validates and publishes; the client picks up the new version
- [ ] Admin renders correctly at 375px, 768px and 1440px
- [ ] The admin APK launches, authenticates and navigates

### Android platform

- [ ] Safe-area insets correct under a camera cutout, **portrait and landscape**
- [ ] Status bar and navigation bar colour and icon contrast correct on every screen
- [ ] A sheet darkens the bars and restores them exactly on close
- [ ] The keyboard resizes the view; a focused input is never behind the bottom nav or a sticky bar
- [ ] Hardware Back through all five rules: overlay dismiss, transactional confirm, declared parent, primary-tab home, exit
- [ ] **`onTransactionalBack` actually fires** on the invest and checkout screens — the legacy prop was never wired
- [ ] Rotation preserves state and re-applies insets
- [ ] External links open in the system browser; `mailto:` and `tel:` reach the OS handler
- [ ] No token, credential or PhonePe transaction token appears in `logcat` during a full flow
- [ ] Portfolio values do not appear in the recents screenshot
- [ ] Cold start shows no colour flash through the splash handoff

### Deployment

- [ ] `boe-dev-app` and `boe-dev-admin` build from the new Dockerfile
- [ ] Both start as UID 101 with a read-only root filesystem and answer `GET /health`
- [ ] `assert_frontend_runtime_images()` passes
- [ ] The admin image uses a **relative** `/api` base and the admin splash releases
- [ ] The client image uses the absolute origin
- [ ] The APK's `Origin: https://localhost` is accepted by CORS and by `validateWebOrigin`
- [ ] The new frontend origin is in `WEB_ORIGIN_ALLOWLIST`
- [ ] All four CI jobs green, with the drift baseline regenerated

## Minimum bar before replacing the old frontend

Cutover is permitted only when all of the following hold.

1. **Every item in the Payments block passes on dev, with database rows inspected**, not merely
   a success screen.
2. **Every item in the Authentication block passes** on a real device and in a browser.
3. **The Android platform block passes on at least two physical devices**, one with a camera
   cutout and one without, and at least one on Android 15 or newer — because the safe-area
   fallback chain branches on exactly that version.
4. **Every admin route has been exercised by a real principal** with at least two distinct
   permission sets.
5. **No token or credential appears in `logcat`** during a complete client flow.
6. **Migration 043 is applied** on the target environment, ahead of the code.
7. **All four CI jobs are green** and the contract-drift baseline reflects the new frontend.
8. **The parity checklist is signed off by the maintainer**, not by an agent.
9. **The previous images remain available for rollback**, and the rollback path has been
   exercised at least once on dev.

## Rollback

The frontend is a static SPA behind nginx with no state of its own, so rollback is an image
swap: redeploy the previous `boe-{dev,prod}-{app,admin}` tag. `docker-compose.*_app.yml`
references exact `${BOE_VERSION}` images with no `:latest`, precisely so a rollback can name a
specific image.

Two constraints:

- **Migration 043 is forward-only.** It relaxes a CHECK constraint, so rolling the frontend back
  is safe, but rolling the *backend* back past the destructive boundary is blocked by the deploy
  tooling by design.
- `frontend_stack` is deleted only after production is verified and soaked. Until then the legacy
  images remain deployable, which is the real rollback path for the whole cutover.

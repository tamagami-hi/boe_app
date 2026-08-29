# 00 — Executive Summary

## What the application actually does today

BOE is an Indian retail investment application. A person is onboarded, approved by an
administrator, verifies their email with a one-time code, and then invests money into
administrator-managed fund pools either as a lump sum or as a monthly SIP. Money movement
goes through PhonePe. An administrator console manages funds, valuations, payments,
mandates and users.

The precise flow, end to end:

1. **Signup is server-to-server, not in-app.** The marketing site calls
   `POST /newuser` (`backend_controller/src/routes/publicOnboardingRoutes.ts`), gated by a
   shared secret in `x-signup-key`. This creates an `applications` row in state `submitted`
   holding an Argon2id password hash. It creates no user, no credential, no session, and
   deliberately sends no email.
2. **An administrator approves the application.**
   `POST /v1/admin/applications/:applicationId/decision?outcome=approved`
   (`src/domain/admin/decideApplication.ts`) creates the durable `users` row, copies the
   password hash into `user_credentials`, wipes `applications.password_hash`, and enqueues
   an `account_approved` email through the transactional outbox. **This is the moment the
   canonical user identity comes into existence.** Accounts are born active — there is no
   activation-invite redemption.
3. **The user logs in.** Android uses `POST /v1/auth/native/login` (bearer token, device
   bound). The browser admin console uses `POST /v1/auth/web/login` (HttpOnly cookies plus
   a synchroniser CSRF token). Both mint a row in `auth_sessions` and an ES256 JWT with a
   10-minute TTL; the session row is re-read from PostgreSQL on every authenticated request,
   so the JWT is never trusted alone.
4. **Email OTP Verification gates investing.** `POST /v1/client/email-verification/start`
   issues a 6-character case-sensitive code (`src/domain/client/emailVerification.ts`),
   hashed into `email_verification_codes`, 10-minute TTL, 5 attempts, 60-second resend
   cooldown. Verification sets `users.email_verification_state = 'verified'` and a
   365-day `email_verification_expires_at`. Until then `GET /v1/client/eligibility`
   refuses investing.
5. **The user browses funds** (`/v1/client/funds`, Redis-cached) and invests.
   Lump sum: `POST /v1/client/orders` with an integer paise string and an
   `Idempotency-Key`, then `POST /v1/client/orders/:orderId/pay`, which returns a
   PhonePe hosted checkout URL. The app performs a full-page redirect.
6. **Settlement is server-authoritative.** PhonePe posts a callback which is authenticated
   by a SHA-256 shared secret, deduplicated into `provider_events`, and then **discarded as
   evidence** — the backend re-reads the truth from the gateway and applies it in
   `src/domain/payments/applyCanonicalPaymentOutcome.ts`. In that same transaction the
   investment is created: `investment_allocations`, `client_value_entries`, and a pending
   `fund_receipt_acknowledgements` row for the administrator.
7. **SIP.** `sip_plans` carry an amount, a `debit_day` in 1–28, and a `next_due_date`.
   `sipScheduleWorker` materialises a due installment as an ordinary payable order. For
   `collection_mode = 'manual_checkout'` there is no automatic debit — the user pays each
   installment through the same hosted checkout. For `collection_mode = 'phonepe_autopay'`,
   `mandateCollectionWorker` notifies PhonePe 24 hours ahead and debits at 10:00 IST.
8. **The portfolio balance is derived, never stored.** `client_value_entries` is
   append-only and `src/domain/client/portfolioLedger.ts` sums it. There is no stored
   balance column anywhere.
9. **Administrators** manage the fund catalogue and its versions/holdings, publish absolute
   AUM snapshots and growth batches, adjust individual and collective client values,
   acknowledge received funds, drive refunds, inspect payments and mandates, read the audit
   log, publish FAQs and the client app configuration, and view email deliveries.

The public marketing site is a separate concern. `PRODUCT.md` describes **only** that
surface and explicitly forbids invest/SIP/portfolio/returns copy there. It contains no
scope statement for the authenticated application at all.

## Why the frontend became difficult to maintain

The backend is in good shape: TypeScript throughout, 49 typed tables, a single canonical
settlement transaction, five test-enforced architecture guards, and a documented error
catalogue. The frontend is where the decay is, and it is structural rather than cosmetic.

**No enforced layout primitive.** `frontend_stack/packages/client/src/layout/` ships eleven
wrappers. Seven of them — `Screen`, `PageHeader`, `Section`, `Card`, `MetricGrid`,
`ActionBar`, `BottomSheet` — have **zero importers**, yet all seven are still re-exported as
the package's public API from `src/index.js:5-11`. The pages instead hand-write the classes
those wrappers exist to emit: `be-card` appears 63 times, `be-btn` 58 times, `be-eyebrow`
39 times across `src/pages`. Page width, padding and safe-area handling are therefore
decided independently more than twenty times.

**Two competing class vocabularies.** `be-*` from the design-token kit and `apk-*` from the
client's own stylesheets are used inside the same JSX element — `FundDetail.jsx:471`
renders `className="be-btn be-btn-primary be-btn-lg apk-invest-cta-btn"`. Admin adds a
third and fourth: `styles/desktop/shell.css:1-6` states in its own header that the `.ash-`
namespace "coexists with the legacy `.adm-` styles while old screens await their per-domain
rebuild."

**No responsive system.** The client's 16 stylesheets contain exactly three "small phone"
breakpoints, in two different units, that do not coincide: `layout.css:174` at 430px,
`dashboard.css:395` at 24rem (384px), `disclosures.css:167` at 480px. **There is no tablet
or desktop breakpoint anywhere in the client CSS** — yet that stylesheet is what the browser
build serves. `auth.css` alone declares seven different container max-widths between 420px
and 780px. Admin states its mobile threshold four times (JS `MOBILE_BREAKPOINT = 768`, CSS
768px in two files, 1100px for form grids, 40rem for one form grid), and the 768px block in
`admin-responsive.css:11-40` still implements a horizontally-scrolling sidebar for
`.adm-app`, a root class no component renders any more.

**Three generations of overlay, three of skeleton, two of form field.** Dead
`BottomSheet.jsx` (`.be-sheet*`), live `PageSheet.jsx` (`.apk-sheet*`), and shared
`AdaptiveDialog.jsx` (`.be-dialog*`) all delegate behaviour correctly to one hook but
triplicate markup and CSS. Admin ships `SkeletonTableRow` (10 screens) and `SkeletonTile`
(1 screen) while five other admin screens import the shared `Skeleton`. Admin's
`FormField.jsx` and shared's `FormField.jsx` have incompatible APIs and different
accessibility behaviour — and it is admin's weaker one that all 35 money-handling call
sites use.

**Two data strategies in one package.** Most client screens read through a cache layer with
per-domain staleness (`data/clientResources.js`), but `FundDetail.jsx` — the heaviest read
screen — bypasses it entirely with raw `useEffect` fetches at lines 33–51.

**Admin code lives inside the client package.** `packages/admin` imports
`@beonedge/client/services/adminApplicationsApi.js`,
`@beonedge/client/store/AdminSessionContext.jsx`, and reaches directly into
`@beonedge/client/src/styles/mobile/{base,auth}.css`. `AdminSessionContext.jsx` is a
near-verbatim copy of `SessionContext.jsx` differing only in a scope string. The "client"
package is really an undifferentiated app core.

**Fixture mode is a half-abandoned production code path.** `serviceMode()` in
`services/_util.js:17-22` returns `'fixture'` unless `VITE_BEO_API_MODE === 'http'`, and
five fixture files are imported at module scope by the services themselves. Three of the
five are `export const … = []`. So a default build signs in as a fake user with a hardcoded
₹12,38,450 portfolio and no history. Worse, the two halves of the console disagree about
what offline means: `helpers/loadAdminData.js` silently returns fake FAQs, while
`hooks/useAdminList.js` refuses and shows "This screen needs the backend."

**Neither package declares its own dependencies.** `packages/client/package.json` lists
exactly one dependency (`@beonedge/shared`) while importing `react`, `react-dom`,
`react-router-dom`, `lucide-react`, `@capacitor/core`, `@capacitor/app` and
`@aparajita/capacitor-secure-storage`. `packages/shared/package.json` has no `dependencies`
field at all despite importing React everywhere. `@beonedge/design-tokens` is a dependency
of neither consumer, yet every client stylesheet consumes its custom properties.

## Major legacy problems, ranked by consequence

1. **Real capability with no navigation to it.** `/app/mandates/:mandateId` — the screen
   holding SIP pause/resume/cancel and mandate re-authorisation — is reached only
   programmatically from `StartSipSheet.jsx`, always with `{replace: true}`. Neither
   Portfolio nor Transactions links to a SIP plan. After the creating session ends, the
   user cannot get back to manage their SIP.
2. **AutoPay does not work in a browser at all.** `clientAutoPaySipRoutes.dispatchSetup`
   returns `checkout: {type:'phonepe_sdk', token, merchantId, environment}` and
   `MandateDetail.jsx:119` hands it to a native platform bridge. `browserPlatform.start`
   returns `{status:'unavailable'}`. One-time payments have just been migrated to hosted
   redirect; AutoPay mandate authorisation has not.
3. **Features that look real and are not.** Explore's "notify me" button only sets a local
   toast string and calls no API (`Explore.jsx:140`). `notificationsApi.markAllRead`
   has no HTTP call in its http branch (line 48) — "mark all read" does not persist.
   Statements has no download action despite the iconography.
4. **A security-relevant trust-boundary bypass.** `Notifications.jsx:89` passes a
   server-supplied `deepLink` straight to `navigate()` without `resolveInternalPath()`,
   which is the resolver the route manifest exists to provide.
5. **Orphaned regulatory screens.** `/app/investor-charter` and `/app/grievance` are
   reachable only from a fund detail page's disclosure links. `Legal.jsx` — where a user
   would look — contains no links at all.
6. **Backend capability with no frontend.** `POST /v1/admin/users/:id/{suspend,reinstate,close}`
   and `GET /v1/admin/users/:id/login-events` have no caller anywhere in the admin package,
   and `users.suspend`/`users.close` appear nowhere in `navigation/nav.js`.
7. **The device app-lock PIN is not a security boundary and reads like one.** A single
   unsalted SHA-256 over a 4–6 digit space, stored in `localStorage` not secure storage, no
   attempt counter, no lockout, no server call — and `AppLockGate` renders the app tree live
   behind the overlay while `sessionVault` keeps handing the bearer token to every request.

## Recommended redesign strategy

**Greenfield `frontend_stack_ts`, one Vite application, two build-time targets, one shared
feature layer, two presentation shells.**

- **Stack:** React 19 + TypeScript 5.9 + Vite 7, React Router v7 declarative, TanStack Query
  v5 for all server state, React Context for session/overlay/toast only, `zod` for
  validation (already a transitive requirement via `packages/contracts`), `react-hook-form`
  for the six non-trivial money forms, `lucide-react` for icons. No Redux, no Zustand, no
  UI component library. Tailwind v4 is the styling layer (D-033).
- **Styling:** one token layer (ported from `packages/design-tokens`, which already owns the
  only correct safe-area contract in the repository) plus **Tailwind v4 utilities derived from
  that layer** via `@theme inline`, plus a typed recipe layer that declares each pattern once.
  One class vocabulary. One breakpoint set. One page container. **Amended by D-033:** Tailwind
  was originally rejected on the token contract and a 160 kB CSS budget. The budget was
  superseded by D-028, and the token contract is preserved rather than replaced —
  `tokens-core.css` is still the sole reader of `env(safe-area-inset-*)` and `safeArea.test.ts`
  passes unchanged.
- **API layer:** extend the existing root `packages/contracts` from 15 endpoints to full
  coverage using its own `defineOperation` descriptor, then generate the frontend client
  from it. Do not hand-write API shapes. This is the single highest-leverage decision in
  the whole plan — it is what prevents the new frontend from accumulating its own drift.
- **Shells:** `ClientShell` (mobile-first, bottom navigation, sheets, cards) and
  `AdminShell` (sidebar at ≥1024px, bottom navigation below, data tables that become cards).
  Both are presentation only. Every feature module, query, mutation, type, validator and
  permission check is shared.
- **Both shells must work in a browser and in the APK.** The admin console is already
  shipped as an APK variant (`emu/boe_update.sh` builds `com.beonedge.app.admin`), so
  "admin is desktop-only" is false and must not be assumed.

## Are backend changes required?

Yes — five, all small, all listed with proposals in
[04 §Required backend corrections](04-backend-api-contract-map.md#required-backend-corrections).

1. **AutoPay mandate authorisation must gain a hosted/redirect channel**, or web AutoPay is
   formally out of scope and the UI must say so. This is a product decision, not a
   technical one.
2. **`GET /v1/public/consent-documents` is in the generated OpenAPI contract with no
   backend implementation.** Either implement it or remove it from the contract.
3. **`packages/contracts` is missing two error codes** the backend really returns:
   `PROVIDER_CALLBACK_UNVERIFIED` and `MOBILE_CHECKOUT_DISABLED`. It also has no `page`
   metadata shape, so paginated responses are not describable.
4. **`check-frontend-contract-drift.mjs` hardcodes `frontend_stack/packages/{client,admin,shared}`.**
   A new frontend elsewhere gets no drift protection, and deleting the legacy frontend
   breaks `npm run check` in the contracts package with `ENOENT`.
5. **The new frontend origin must be added to `WEB_ORIGIN_ALLOWLIST`**, or every browser
   response is discarded by CORS and the app looks entirely offline.

Two further items are cleanups, not blockers: `POST /v1/client/email-verification/resend`
is a pure alias of `/start` on the same handler, and
`POST /v1/admin/applications/:id/decision` takes its decision in the **query string** with
a strict-empty body — unusual enough that a new client will get `VALIDATION_FAILED` if it
guesses.

## Critical blockers

These must be resolved before the corresponding phase begins.

| # | Blocker | Blocks | Resolution |
|---|---------|--------|-----------|
| B1 | 34 uncommitted changes implement the hosted-checkout refactor; migration `043_hosted_checkout_dispatch_claim.sql` is untracked. **Verified on the dev stack 2026-08-27: 33 migrations applied, latest `042`, and `payment_attempts` still carries `payment_attempts_sdk_dispatch_channel_check` — the 035 constraint that excludes `hosted_redirect`.** So the deployed dev database would reject every hosted-checkout dispatch write. | Phase 7 | Commit the slice. Migration ordering is already structural: the compose `migrate` service runs `npm run migrate` from the backend image with `depends_on: postgres healthy`, ahead of the backend, so 043 applies automatically on the next deploy once it is in the image. Then verify one real payment. |
| B2 | `packages/contracts` covers 15 of ~90 endpoints. All `/v1/client/*`, all web auth, and most of the admin console are uncontracted. | Phase 1 onward | Phase 0: extend the contracts package. |
| B3 | AutoPay mandate setup is native-SDK-only and non-functional in a browser. | Phase 8 | Product decision + possible backend change. |
| B4 | The contract-drift CI gate cannot see a frontend outside `frontend_stack/packages/{client,admin,shared}`, and will fail with `ENOENT` when the legacy frontend is deleted. | Phase 1 and Phase 12 | Parameterise `frontendRoot`/`SERVICE_DIRECTORIES`. |
| B5 | New frontend origin absent from `WEB_ORIGIN_ALLOWLIST`. | Phase 3 | Add dev origin before first authenticated request. |
| B6 | `.github/workflows/ci.yml` has exactly three jobs: `backend`, `frontend` (hardcoded to `frontend_stack`), `contracts`. The new frontend has no CI job. | Phase 1 | Add a fourth job; keep the legacy `frontend` job until Phase 12. |
| B7 | `backend_controller/.env.legacy-backup` exists on disk (gitignored) containing `PROVIDER_MODE=razorpay` and a `RAZORPAY_KEY_ID`/`KEY_SECRET`/`WEBHOOK_SECRET` triple. | Nothing, but it is a live finding | Delete the file or rotate the keys through secret management. |

## Major risks

- **Payments.** Money can be taken and not recorded, or recorded twice. The mitigation
  already exists in the backend (idempotency records, one payment per order, attempt reuse,
  a one-writer dispatch claim, `(provider, provider_order_id)` uniqueness, and gateway
  re-read instead of trusting the callback). The new frontend's job is to not fight it:
  never auto-retry a write, always send an `Idempotency-Key`, and treat return-from-PhonePe
  as *pending*, never as success.
- **Android packaging.** Four separate mechanisms conspire to make the app render correctly
  under the notch: `viewport-fit=cover` in the HTML, the `--be-safe-*` token fallback chain,
  `SystemBars.setStyle`, and the custom `SystemChrome.setBarBackground` plugin painting
  behind transparent bars. Dropping any one of them fails **silently**, with no error
  anywhere. `targetSdkVersion 36` makes edge-to-edge mandatory.
- **The admin console is broad.** 28 routes, 20 screens, 11 permission codes, three
  independent pagination implementations, optimistic-concurrency `If-Match` on fund PATCHes,
  and `basisHash` preview-then-commit protocols on both AUM and client-growth batches.
  Underestimating admin is the most likely schedule failure.
- **Session semantics are subtle.** Deterministic HMAC-derived refresh successors, a
  30-second grace window keyed on `rotationId`, and family revocation on reuse. Two parallel
  refreshes are read as token theft and kill the session family — which is why the legacy
  transport coalesces them per scope. The new client must do the same.
- **Cursor pagination is filter-bound.** `decodeCursor` fails closed with `CURSOR_INVALID`
  on a filter hash mismatch. Any filter change must restart pagination.

## Approximate scope

| Area | Target artefacts | Notes |
|------|------------------|-------|
| Foundation, tooling, CI, Docker, tokens | ~35 files | Phase 1 |
| Shells, routing, providers, native | ~30 files | Phase 2 |
| API layer generated from contracts | ~25 modules | Driven by Phase 0 |
| Client features | 9 modules, ~22 screens | Down from 24 legacy pages |
| Admin features | 13 modules, ~20 screens | Roughly at parity |
| UI primitives + patterns | ~24 + ~14 components | Replaces ~40 legacy components across 3 packages |
| Android + packaging scripts | ~10 files | Ported, not reinvented |

Legacy inventory being replaced: 130 client files, 110 admin files, 78 shared/token files,
30+ stylesheets. Target is a single package with one stylesheet strategy, no dead exports,
and no fixture mode.

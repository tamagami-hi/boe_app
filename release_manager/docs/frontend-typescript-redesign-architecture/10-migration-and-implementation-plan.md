# 10 — Migration and Implementation Plan

Thirteen phases. Each states its objective, prerequisites, what it creates and modifies, what it
does **not** touch, its backend dependencies, its test requirements, and acceptance criteria.

Two rules apply to every phase:

- **`frontend_stack/` is never modified.** Not one file, until Phase 12.
- **Verification claims are bounded.** On this machine only `tsc --noEmit`, `vitest run`,
  `eslint` and one-shot builds are available. Those do not exercise wiring — they would not
  catch a handler prop never passed, a stale optimistic-concurrency snapshot, or mail recorded
  as `sent` by a transport that discards it. All three were real defects here. Anything needing
  runtime proof is handed over as exact commands to run on the VPS.

---

## Phase 0 — Stabilise the contract foundation

**Objective.** Land only what must precede any UI. **Amended 2026-08-27** from the original
"extend contracts to full coverage first". Full coverage is roughly 75 operations at ~100 lines
each (`admin-fund-aum.ts` is 782 lines for 8), so ~7,000 lines of descriptors written blind
before a single screen exists. That is the wrong shape.

**Contracts and backend corrections are now extended per feature phase, immediately before the
phase that consumes them.** Two things make that safe, and neither existed when the original
plan was written:

1. `check-frontend-contract-drift.mjs` now scans `frontend_stack_ts/src`, so the moment the new
   frontend calls an uncontracted path, CI fails. The guard that was missing while the legacy
   frontend accumulated 60 uncontracted paths is in place.
2. The backend corrections in [04](04-backend-api-contract-map.md#required-backend-corrections)
   are promoted from "consider" to **mandatory** — the application is pre-production with no real
   users, so the contract is shaped for the new frontend and the legacy frontend is allowed to
   break as a consequence. But they are **not** made speculatively ahead of the phase that
   consumes them: an unconsumed API change is an unverified one, and until the new frontend
   reaches parity the legacy frontend is the only working end-to-end system on the dev stack.

Per-phase assignment of the mandatory corrections:

| Correction | Phase |
|---|---|
| Server-side transaction filtering (BC9) | 6 |
| Single `{type:'redirect'}` checkout shape; drop the legacy branch | 7 |
| Fund-detail cache invalidation on publish (BC10) | 5 |
| AutoPay channel decision (BC1) | 8 |
| Bulk mark-all-read (BC8) | 9 |
| Delete `/v1/client/email-verification/resend` (BC6) | 4 |
| Move `outcome` into the decision body (BC7) | 10 |
| Rename `payments.mobileSdk` and `MOBILE_CHECKOUT_DISABLED` | 8 |

**Cutover target for the drift baseline: `uncontractedPaths: []`.** The current 60-entry baseline
records *legacy* drift and must not be inherited. At Phase 12 the baseline is emptied and only
`frontend_stack_ts/src` is scanned.

**Prerequisites.** None.

### 0.1 The in-flight payment refactor (blocker B1) — deferred to the new-stack deploy

31 modified files, 3 deletions and 4 untracked additions implement the PhonePe hosted-checkout
migration. `tsc --noEmit` passes and no stale references to the deleted modules remain.

**Verified read-only on the dev stack, 2026-08-27:** 33 migrations applied, latest `042`;
`payment_attempts` still carries `payment_attempts_sdk_dispatch_channel_check`, the 035
constraint that excludes `hosted_redirect`. So the deployed dev database would currently reject
every hosted-checkout dispatch write. Deployed version `0.11.9`.

Migration ordering is **structural, not procedural**: the compose `migrate` service runs
`npm run migrate` from the backend image with `depends_on: postgres service_healthy`, and the
backend depends on its completion, so `043` applies automatically on the next deploy once it is
in the image.

**Decision (maintainer, 2026-08-27): 043 is verified together with the new frontend when the new
stack is deployed, with a schema backup taken as part of that deploy.** It therefore does not
gate Phase 1. It remains a hard prerequisite for **Phase 7**, which is the first phase whose code
depends on the relaxed constraint.

Still to be decided when the slice is committed: the version, since `VERSION` is already
`0.11.9` and commit `0347ee7` already tagged it.

### 0.2 Structural contract prerequisites — DONE 2026-08-27

Landed, with `lint`, `test:coverage`, `build`, `test:exports`, `lint:openapi` and
`check:frontend-contract-drift` all passing:

- **Error-code parity.** Added `PROVIDER_CALLBACK_UNVERIFIED` (401) and
  `MOBILE_CHECKOUT_DISABLED` (409). Backend `ErrorCode` and `@beonedge/contracts` are now
  24 codes, identical sets, matching statuses. `errors.test.ts` updated as the deliberate mirror
  of an intentional catalogue change.
- **`PageMeta`.** Added `PageMeta`, `MAX_PAGE_LIMIT`, `PAGINATED_METADATA_SHAPE` and
  `createPaginatedSuccessEnvelopeSchema`. Every list endpoint was previously undescribable.
- **A descriptor gap not caught in the original audit.** `OperationSecurityPolicy` only permitted
  `native-bearer` with `idempotency: "naturally-idempotent"`, so it could not express a client
  write requiring an idempotency key — `POST /v1/client/orders`, `/pay`, and all four AutoPay
  operations. Added a `native-bearer` variant supporting `"required-key"`. Without this the entire
  client write surface was uncontractable.
- **Drift checker parameterised (B4).** Scan roots come from `BOE_FRONTEND_SCAN_ROOTS`
  (comma-separated, repo-relative), defaulting to the three legacy packages plus
  `frontend_stack_ts/src`. Missing roots are skipped; all roots missing now throws an actionable
  error rather than reporting a false "no drift".
- **B7.** `backend_controller/.env.legacy-backup` deleted — untracked, gitignored, and entirely
  pre-TypeScript (`DATA_STORE`, `JSON_DB_PATH`, shared-secret tokens, `PROVIDER_MODE=razorpay`,
  plaintext seed passwords).

Outstanding: `generate:check` requires the regenerated `generated/openapi-v1.{json,d.ts}` to be
committed. The diff is exactly the two new error codes propagating.

### 0.3 Open decision — `GET /v1/public/consent-documents`

Contracted and generated, with no backend route. Deleting it is the forward-only instinct, but it
is plausibly contracted *because* the marketing site must display terms and privacy before
capturing consent, and `POST /newuser` already reads `consentRepository.findCurrentDocuments`
server-side — the data exists, only the GET is missing. A product question about the signup flow,
not dead code. Removing it also means rewriting `public.test.ts` (223 lines) and emptying
`PUBLIC_OPERATIONS`.

### 0.4 Deferred to Phase 1

- **B5** — the new frontend origin in `WEB_ORIGIN_ALLOWLIST`. Needs the dev port, which does not
  exist until the project does.
- **B6** — the fourth CI job. `working-directory: frontend_stack_ts` fails at `npm ci` until the
  directory exists.

**Acceptance.** Phase 0 is complete. The remaining contract work is distributed across
Phases 4–10.

---

## Phase 1 — Foundation

**Objective.** A `frontend_stack_ts` that builds, type-checks, lints, tests, containerises and
passes CI — rendering one placeholder screen.

**Prerequisites.** Phase 0. Not blocked by B1 — migration 043 is verified with the new frontend
at new-stack deploy time, and is a prerequisite for Phase 7 only.

**Creates.**

```
frontend_stack_ts/
  package.json  tsconfig.json  tsconfig.node.json
  vite.config.ts  vitest.config.ts  vitest.setup.ts  eslint.config.mjs
  index.html  Dockerfile  nginx.conf
  .dockerignore  .gitignore
  scripts/check-android-dist.mjs
  scripts/check-bundle-boots.mjs
  scripts/generate-api-client.ts
  src/main.tsx
  src/index.css
  src/lib/env.ts
  src/ui/tokens/{tokens.css,tokens-core.css,fonts.css,kit.css}
  src/ui/tokens/safeArea.test.ts
  src/api/{http.ts,envelope.ts,errors.ts,idempotency.ts,cursor.ts}
  src/api/generated/operations.ts        generated
  src/api/session/{tokenStore.ts,refresh.ts,scope.ts}
  src/domain/{money.ts,money.test.ts,status.ts,dates.ts,permissions.ts}
```

Details that matter:

- **`Dockerfile` must declare `ARG VITE_BEO_APP_TARGET`.** `release_manager/export.sh` runs a
  literal `grep -q 'ARG[[:space:]]\+VITE_BEO_APP_TARGET'` before building, because Docker
  silently ignores an undeclared `--build-arg` and both images would otherwise be identical —
  the user-facing app would serve the admin UI.
- Three stages, both base images pinned by `@sha256:` digest, `USER 101:101`, `EXPOSE 8080`,
  SPA fallback, `GET /health` returning 200, and a read-only root filesystem with only
  `tmpfs /tmp` writable.
- Build context is the `frontend_stack_ts/` directory itself, unlike the legacy Dockerfile whose
  context is the workspace root.
- `resolveApiBase()` implements the four-step order from
  [07](07-typescript-frontend-target-architecture.md): injected global → build-time env →
  same-origin `/api` in a browser → hard failure in a Capacitor WebView. This makes the browser
  images promotable, which `DEPLOYMENT_CONSTRAINTS_IMPLEMENTATION.md` records as a wanted fix.
- `assertHttpMode()` renders a single configuration-error screen if `VITE_BEO_API_MODE` is not
  `http`. **There is no fixture mode.**
- Port `safeArea.test.ts` and both bundle-check scripts before writing any component, so the
  constraints bind from the first commit.

**Modifies.** `.github/workflows/ci.yml` — add a fourth job:

```yaml
frontend-ts:
  working-directory: frontend_stack_ts
  run: npm ci && npm run typecheck && npm run lint && npm test && npm run build
```

Keep the existing `frontend` job pointing at `frontend_stack` until Phase 12.
`release_manager/tests/runtime_contract.test.sh` asserts the CI jobs and commands exist, so it
needs the new job added to its expectations.

**Tests.** `domain/money.test.ts` (round-trip, boundary, rejection of non-safe-integers),
`safeArea.test.ts`, `api/http.test.ts` (401 coalescing, write-never-retried),
`api/idempotency.test.ts`.

**Acceptance.** `npm run typecheck && npm run lint && npm test && npm run build` all pass.
`VITE_BEO_APP_TARGET=client npm run build` passes `check-android-dist.mjs` and
`check-bundle-boots.mjs`. `docker build` produces an image that starts as UID 101 with a
read-only root filesystem and answers `GET /health`. CI is green on all three jobs (`backend`, `frontend`, `contracts`) — the planned fourth job became an adaptation of the existing `frontend` job to `frontend_stack_ts`.

**Does not touch.** `frontend_stack/`. `release_manager/stacks/*` — deployment wiring waits for
Phase 11.

---

## Phase 2 — Shells, routing, providers, native

**Objective.** Both shells navigate, both respect safe areas, Android Back works, and the
route manifest is the single source of truth.

**Prerequisites.** Phase 1.

**Creates.**

```
src/shells/client/{ClientShellRoot.tsx,ClientFrame.tsx,ClientNavigation.tsx,clientBackPolicy.ts}
src/shells/admin/{AdminShellRoot.tsx,AdminFrame.tsx,AdminNavigation.tsx,adminBackPolicy.ts}
src/app/providers/{AppProviders,QueryProvider,SessionProvider,OverlayStackProvider,ToastProvider,NetworkStatusProvider}.tsx
src/app/routing/{clientRoutes.ts,adminRoutes.ts,buildRouter.tsx}
src/app/routing/{RequireSession,RequireRole,RequirePermission,RequireEligible}.tsx
src/app/routing/{resolveDestination.ts,resolveDestination.test.ts,routeIntegrity.test.ts}
src/app/layouts/{Page,PageHeader,Section,ContentGrid,AuthLayout}.tsx  + .module.css
src/app/native/{NativeBackCoordinator.tsx,SystemBarsController.tsx,ConnectivityBanner.tsx}
src/platform/{capacitor.ts,lifecycle.ts,systemChrome.ts,openExternal.ts,errors.ts}
src/ui/primitives/  the first 8: Button, IconButton, Card, Badge, Divider, Spinner, Skeleton, Alert
src/ui/patterns/{AsyncBoundary,EmptyState,ErrorState}.tsx
src/lib/useBreakpoint.ts
```

Requirements carried from the legacy implementation because each exists for a reason:

- **`main.tsx` performs a single dynamic import on a ternary**, and each shell root module also
  exports `backPolicy` and `probeReachability`. Splitting the policy into its own import
  defeated dead-branch elimination and shipped the admin chunk into the client APK.
- **`buildRouter(manifest)` generates the `<Routes>` tree.** Manifest-versus-router drift becomes
  structurally impossible rather than test-caught.
- **`NativeBackCoordinator` registers the `backButton` listener exactly once**, with all handler
  state in a ref, and implements the five-rule order: overlay dismiss → transactional confirm →
  declared parent → primary-tab home → exit-unless-`canGoBack`.
- **`onTransactionalBack` must actually be wired.** In the legacy code `main.jsx` never passes
  it, so rule 2 is inert. The client shell passes a confirm handler for routes marked
  `transactional: true`.
- **Provider order is the contract**: `BrowserRouter` outside everything (the coordinator needs
  `useNavigate`), then `QueryProvider` → `NetworkStatusProvider` → `OverlayStackProvider` →
  `SessionProvider` → `ToastProvider`, with the two effect-only controllers and the connectivity
  banner inside.
- **`resolveDestination` is the only path from remote content to the router**, refusing
  `javascript:`, `data:`, cleartext `http:`, protocol-relative `//host`, the WebView's own
  `https://localhost` origin, and any internal path not in the manifest.

**Tests.** `resolveDestination.test.ts` (every refusal case). `routeIntegrity.test.ts` — every
manifest route is mounted, every nav entry resolves, every write-capable route is linked from a
permitted surface, every route declares a back parent.

**Acceptance.** Both shells build and navigate. Below `lg`: bottom navigation; at `lg`: client
top navigation and admin sidebar. `AsyncBoundary` renders five visually distinct states. In a
browser the safe-area tokens resolve to `0px` and nothing shifts.
`NEEDS RUNTIME VERIFICATION` on a device: Back order, safe-area insets under a cutout in both
orientations, and system-bar chrome push/pop.

---

## Phase 3 — Authentication and session

**Objective.** Login, logout, session restore, coalesced refresh, and route protection on both
transports.

**Prerequisites.** Phase 2, blocker B5 resolved.

**Creates.**

```
src/features/auth/{api.ts,queries.ts,LoginScreen.tsx,SplashScreen.tsx,BlockedScreen.tsx}
src/features/auth/{ForbiddenScreen.tsx,NotFoundScreen.tsx}
src/api/session/{tokenStore.ts,refresh.ts}   completed
src/platform/secureStorage.ts
src/ui/primitives/{Input,FormField,Label,Checkbox}.tsx
```

Behaviour requirements, each traced to a backend constraint:

| Requirement | Backend reason |
|---|---|
| `hydrateTokenStore()` completes **before** the first authenticated request | the transport reads the access token synchronously; racing them produced unauthenticated probes on cold start |
| Native tokens go to Capacitor Secure Storage only, and the store **fails closed** if it is unavailable — memory only, and purge any legacy `localStorage` tokens | credentials must never sit in `localStorage` on a device that changes hands |
| Web keeps only the principal and CSRF token in `localStorage` | the real credential is an HttpOnly cookie the browser owns |
| Android admin uses the **native bearer** path with `buildAdminDevice()`, not cookies | the WebView origin is `https://localhost`, cross-site with the API, so `SameSite=Lax` plus the `Sec-Fetch-Site` gate make cookie auth impossible |
| **One in-flight refresh promise per scope** | two parallel rotations are read as token theft and revoke the whole session family |
| Send `rotationId` on refresh and reuse it on retry | the 30-second grace replay is keyed on `rotationId` and re-derives the identical successor with no write |
| Web reload recovers CSRF via `GET /v1/auth/web/csrf` before any mutation | the in-memory token is lost on reload while the cookies survive |
| Distinguish `restoring` / `authenticated` / `anonymous`, and treat timeout, offline and `status >= 500` as an **outage, not a logout** | the legacy comment records this check previously tested the wrong codes and never fired |
| `SESSION_INVALID` clears the scope and routes to login with `endedReason: 'expired'` | — |
| An unauthenticated 401 (login itself) must **not** emit `session-invalidated` | otherwise a failed login in one tab signs out a valid session in another |
| A user-id change away from a known id clears the query cache | prevents one investor's cached valuation reaching the next signer-in |

**Tests.** Concurrent 401s produce exactly one rotation. `RequirePermission` denies on a missing
permission. Restore failure classification distinguishes outage from logout.

**Acceptance.** Client login on Android and admin login in a browser both work. Reload preserves
the admin session. App restart preserves the client session. An expired access token refreshes
transparently once. A revoked session lands on login with an expiry notice. A backend outage
during restore shows a retry state, not a logout.
`NEEDS RUNTIME VERIFICATION`: everything in this phase. It cannot be proven by tests.

---

## Phase 4 — Email OTP Verification and the eligibility gate

**Objective.** A user can verify their email and unlock investing.

**Prerequisites.** Phase 3.

**Creates.**

```
src/features/email-verification/{api.ts,queries.ts,EmailVerificationScreen.tsx}
src/features/email-verification/{VerificationStatusScreen.tsx,OtpInput.tsx,ResendCountdown.tsx}
src/app/routing/RequireEligible.tsx   completed
src/ui/patterns/StatusBadge.tsx
```

Requirements:

- Call `/start` only. `/resend` is an alias on the same handler and should not be used.
- Six characters, **case-sensitive**, alphanumeric — the alphabet is 62 characters. Do not
  uppercase the input.
- Show remaining attempts. The cap is 5 and it is enforced under a row lock.
- Resend cooldown is **server-authoritative**. Drive the countdown from
  `RATE_LIMITED`'s `retryAfterSeconds`, not from a local timer.
- Distinguish the five failure modes: `RATE_LIMITED` (cooldown), `STATE_CONFLICT` (attempt cap
  or no active verification), `TOKEN_EXPIRED` (offer resend), `TOKEN_INVALID` (wrong code), and
  `DEPENDENCY_UNAVAILABLE`.
- `DEPENDENCY_UNAVAILABLE` must read "we could not send the email — try resend in N seconds",
  **not** "verification failed". The mail is sent after the transaction commits, so the code
  exists and the cooldown has started; only delivery failed.
- On success, invalidate eligibility and return the user to `returnTo`, defaulting to the
  dashboard. **Fixes the legacy defect** where Back from the investing gate went to Profile
  because the manifest parented `verify_email` under `/app/profile`.
- Requesting a new code consumes the previous one — only the newest works.
- Use "Email OTP Verification" or "Email Verification". **Never "KYC".**
- **Resolve the vocabulary conflict first**: the migration CHECK allows
  `not_started | pending | verified | rejected`, while prior implementation logs describe
  projections using `verified` and `pending_verification`. `NEEDS RUNTIME VERIFICATION` of what
  the API actually returns before building the status UI. Note `'rejected'` is permitted by the
  CHECK but no code path writes it.

**Acceptance.** A user with `email_verification_state = 'pending'` can verify and reach the fund
list. Wrong codes decrement visibly and lock at 5 with a distinct message. Resend respects the
cooldown. An SMTP failure is reported honestly.

---

## Phase 5 — Funds catalogue and fund detail

**Objective.** Browse, filter, sort and inspect funds. The largest read surface.

**Prerequisites.** Phase 4.

**Creates.**

```
src/features/funds/{api.ts,queries.ts,FundListScreen.tsx,FundDetailScreen.tsx}
src/features/funds/{FundCard.tsx,FundCardList.tsx,FundTable.tsx,FundHeroSummary.tsx}
src/features/funds/{PerformanceChart.tsx,HoldingsDonut.tsx,SectorLegend.tsx,RatioTable.tsx}
src/features/funds/{DisclosureList.tsx,SipCalculator.tsx}
src/features/legal/{DisclosureApi.ts,InvestorCharterScreen.tsx,GrievanceScreen.tsx,LegalScreen.tsx}
src/ui/charts/{LineChart,AreaChart,DonutChart,Sparkline}.tsx  chartMath.ts
src/ui/primitives/{Select,Tabs,Tooltip}.tsx
src/ui/patterns/{DataList,MoneyValue,DetailRow}.tsx
src/domain/fund.ts
```

Requirements:

- Fund detail uses the shared query layer with `STALE.CATALOGUE`. The legacy `FundDetail.jsx`
  bypasses the cache with raw `useEffect` at lines 33–51; do not repeat that.
- Expect server-side staleness up to `catalogTtlMs` on fund detail, because
  `invalidatePrefix` is never called on publish. Do not try to defeat it client-side; consider
  backend correction BC10.
- **One percentage formatter.** The legacy `formatReturnPct` (2 decimals) and `fmtPct`
  (1 decimal) make Explore and FundDetail disagree.
- `DonutChart` must **reflow**. The legacy 160px fixed SVG beside a 180px minimum-width legend
  cannot use extra width and overflows below ~360px.
- `Legal` becomes the hub for the investor charter and grievance screens — **fixes the legacy
  orphaning**, where `Legal.jsx` contains no links at all and both regulatory screens are
  reachable only from a fund disclosure.
- `GrievanceScreen` keeps the legacy destination-resolution behaviour, which is the one place the
  trust boundary is used correctly.
- Below `lg`: card list. At `lg`: table with sortable headers.

**Acceptance.** Filters, chips and all four sort modes work. Fund detail renders performance,
holdings, sector allocation, ratios and disclosures. The donut reflows from 320px to 1440px.
Charter and grievance are reachable from Legal.

---

## Phase 6 — Portfolio, activity, statements

**Objective.** A user can see what they hold and everything that has happened.

**Prerequisites.** Phase 5.

**Creates.**

```
src/features/portfolio/{api.ts,queries.ts,PortfolioScreen.tsx,PortfolioSummary.tsx,PositionRow.tsx}
src/features/activity/{api.ts,queries.ts,ActivityScreen.tsx,LedgerRow.tsx,PaymentQueueRow.tsx,ActivityDetailSheet.tsx}
src/features/statements/{api.ts,queries.ts,StatementsScreen.tsx}
src/features/profile/{ProfileScreen.tsx,DashboardScreen.tsx}
src/ui/patterns/StatCard.tsx
src/ui/primitives/{Sheet,Dialog,Menu}.tsx
```

Requirements:

- **One derived total-return value, from `GET /v1/client/portfolio`.** The legacy code computes
  it in three places, and `Statements.jsx:50` derives it from statement rows instead of the
  authoritative endpoint. `NEEDS RUNTIME VERIFICATION` that they currently agree.
- Balances are **derived server-side** from the append-only `client_value_entries`. There is no
  stored balance and no NAV/units model. Do not compute money client-side.
- Activity combines the value ledger and the payment queue, as the legacy `Transactions.jsx`
  already does. Keep the tab in the URL.
- **Filters belong in the query key**, so a filter change starts a new query. The cursor is
  filter-bound and `decodeCursor` fails closed with `CURSOR_INVALID` on a mismatch.
- Consider sending filters to the server. The legacy `transactionsApi` accepts a `filter`
  argument and **never transmits it**, filtering client-side over `?limit=100` — which silently
  breaks past 100 rows. See backend correction BC9.
- No statement download. The legacy affordance does not exist; do not imply it.
- `Dialog` below `lg` renders as `Sheet`. Both register with the overlay stack so Android Back
  closes the topmost.

**Acceptance.** Portfolio shows positions and one total-return figure. Activity paginates by
cursor and restarts cleanly on a filter change. Statements list and detail work. Money renders
in tabular mono figures so values do not shift layout.

---

## Phase 7 — Orders and hosted-redirect payments

**Objective.** A user can invest a lump sum and the money is recorded exactly once. **The
highest-risk phase.**

**Prerequisites.** Phase 6. Blocker B1 fully resolved — migration 043 applied and one payment
verified on the VPS.

**Creates.**

```
src/features/orders/{api.ts,mutations.ts,LumpsumInvestScreen.tsx,LumpsumForm.tsx,RiskConsent.tsx}
src/features/payments/{api.ts,queries.ts,PaymentStatusScreen.tsx,PaymentStatusPanel.tsx}
src/features/payments/{checkout.ts,checkout.test.ts,pendingPayment.ts,pendingPayment.test.ts}
src/features/payments/{PendingPaymentRecovery.tsx,CheckoutRedirectNotice.tsx}
src/ui/primitives/AmountInput.tsx
src/ui/patterns/ConfirmDialog.tsx
```

The flow, exactly:

```
1  rupeesToPaise(input)                      reject anything not a positive safe integer
2  POST /v1/client/orders                    { fundId, amountPaise } + Idempotency-Key  → 201
3  POST /v1/client/orders/:orderId/pay       { checkoutChannel: "hosted_redirect" } + Idem
4  if response.terminal                      → go to payment status, do not redirect
5  if checkout === null                      → go to payment status and POLL. Do NOT retry /pay
6  validate checkout.url against the allowlist   https only, exact origin, no userinfo
7  persistPendingPayment(paymentId, ownerId, +30min)   VERIFY the write; abort if it failed
8  window.location.assign(checkout.url)
9  on return: PendingPaymentRecovery reads localStorage → /activity/payments/:paymentId
10 poll GET /v1/client/payments/:paymentId with an expiry; on success invalidate the money prefix
```

Non-negotiable rules:

1. **Return from PhonePe is never settlement evidence.** Browser navigation, UPI app return and
   the hosted page confirm nothing. Show *pending* on return, always. Only authenticated
   provider callbacks and server-side reconciliation settle money.
2. **`checkout: null` means poll, not retry.** The dispatch claim is a one-writer lock.
3. **Validate the URL again client-side**, even though the backend validated it. Two independent
   checks on a URL that leaves the app.
4. **If the pending-payment write fails, abort the checkout.** Otherwise the user leaves with no
   route back to their payment. There is no deep link and PhonePe is sent `redirectUrl: null`.
5. **Never auto-retry a write** (`rules.md` §3).
6. **Always send an `Idempotency-Key`**, re-minted only when the body changes.
7. `terminal: true` is a normal response, not an error — the order was already past the payable
   states.
8. `DEPENDENCY_UNAVAILABLE` on `/pay` means PhonePe is unconfigured or unreachable; the attempt
   may already hold a dispatch timestamp and the reconciliation worker owns it. Send the user to
   status, not back to the form.

**Tests (justified — financial integrity).** `checkout.test.ts`: `checkout: null` polls; a
non-allowlisted URL is refused; a failed pending-payment write aborts; a write is never retried.
`pendingPayment.test.ts`: expiry, owner match, verified write.

**Acceptance.** A real lump-sum payment completes on dev and produces exactly one `payments`
row, one `payment_attempts` row, one `investment_allocations` row and one pending
`fund_receipt_acknowledgements` row. A duplicate submit with the same key replays. An abandoned
checkout expires and reconciles.

Hand over to the VPS:

```
# on the VPS, dev stack
docker compose -f docker-compose.dev_app.yml exec backend node dist/scripts/check-db.js
# then, from the app: create a ₹2 lump-sum order, complete checkout, and confirm
#   payments.state = 'succeeded'
#   payment_attempts.state = 'succeeded' and provider_dispatch_started_at is set
#   investment_orders.state = 'accepted'
#   one investment_allocations row and one client_value_entries contribution
#   one fund_receipt_acknowledgements row in state 'pending'
```

---

## Phase 8 — SIP and AutoPay

**Objective.** A user can start, manage and pay a SIP — and SIP management is **reachable**.

**Prerequisites.** Phase 7. The 0.2 AutoPay decision.

**Creates.**

```
src/features/sip/{api.ts,queries.ts,mutations.ts}
src/features/sip/{SipStartScreen.tsx,SipListScreen.tsx,SipDetailScreen.tsx}
src/features/sip/{SipStartForm.tsx,SipModeSelector.tsx,SipPlanCard.tsx,SipScheduleSummary.tsx}
src/features/sip/{AutoPayStatusPanel.tsx,AutoPaySetupNotice.tsx,pendingAutoPaySetup.ts}
src/ui/primitives/{Radio,Switch}.tsx
```

Requirements:

- **`/sips` is a new first-class list screen**, linked from Portfolio and Dashboard, and it is
  `/sips/:sipPlanId`'s parent. **This fixes the largest reachability hole in the product**: the
  legacy `/app/mandates/:mandateId` holds pause, resume, cancel, mandate re-authorisation and
  "pay the due installment", and is reached only programmatically from `StartSipSheet` with
  `{replace: true}`.
- The route is `/sips/:sipPlanId`, not `/mandates/:id`. The entity is a SIP plan and the legacy
  route comment already admits the old name is historical.
- `debitDay` is **1–28**, enforced by a DB CHECK.
- `manual_checkout` mode has **no automatic debit**. A due installment becomes an ordinary
  payable order created by `sipScheduleWorker`, paid through the Phase 7 flow. Say so plainly in
  the UI — the legacy `MandateDetail.jsx:258` does.
- `phonepe_autopay` mode: PhonePe notifies 24 hours ahead and debits at 10:00 IST, with a 48-hour
  collection expiry.
- AutoPay setup returns a **native SDK token**, not a URL, and needs a native bridge. Per the 0.2
  decision, either implement the new hosted channel or show an explicit Android-only state — not
  a broken button.
- Returning from the UPI app **does not confirm authorisation**. Only the server-confirmed
  mandate state does. The legacy UI warns about this; keep the warning.
- `pendingAutoPaySetup` stores `{ownerId, requestKey, inputFingerprint, sipPlanId, expiresAt}`
  with a 30-minute expiry so recovery can return to the right plan.
- Client-side caps in the legacy code: 1–360 months and `amountPaise ≤ 1_500_000` (₹15,000).
  `NEEDS RUNTIME VERIFICATION` whether the backend enforces the same range.
- Pause, resume and cancel send **no** `Idempotency-Key` — the backend treats them as naturally
  idempotent state transitions.

**Acceptance.** A SIP can be created in manual mode, appears in `/sips`, and can be paused,
resumed and cancelled from `/sips/:sipPlanId`. A due installment appears in Activity and is
payable. AutoPay behaves per the 0.2 decision on both web and Android.

---

## Phase 9 — Remaining client surfaces

**Objective.** Notifications, support, profile, device security, app update, dashboard.

**Prerequisites.** Phase 8.

**Creates.**

```
src/features/notifications/{api.ts,queries.ts,NotificationsScreen.tsx}
src/features/support/{api.ts,queries.ts,SupportScreen.tsx,TicketForm.tsx,FaqAccordion.tsx}
src/features/device-security/{DeviceSecurityScreen.tsx,PinPad.tsx,BiometricToggle.tsx,securityStore.ts}
src/features/app-update/{AppUpdateGate.tsx,DownloadProgress.tsx,appUpdate.ts,updateNotification.ts}
src/features/profile/{EmailVerificationStatusScreen.tsx}
src/platform/{biometrics.ts,appUpdate.ts}
src/ui/primitives/Textarea.tsx
```

Requirements:

- **Notification deep links must go through `resolveDestination`.**
  `Notifications.jsx:89` passes a server-supplied `deepLink` straight to `navigate()` — a
  trust-boundary bypass on remote content.
- **No "mark all read".** There is no bulk endpoint and the legacy button is a no-op. Either
  omit it or add backend correction BC8 first.
- App-config quick-action routes must be re-resolved through the manifest, dropping
  unresolvable ones. The legacy `useAppConfig.js` does this correctly, and it matters because
  anyone who can publish config could otherwise steer the app to an arbitrary path.
- **Device security is not a security boundary and the UI must not imply it is.** It is a single
  unsalted SHA-256 over a 4–6 digit space in `localStorage`, with no attempt counter, no lockout
  and no server call, and the app tree renders live behind the overlay while the token store
  keeps serving the bearer token. Copy should say it protects against casual access on a shared
  device. Biometrics use `BIOMETRY_ANY` deliberately — enrolment changes are a convenience
  concern here, not a trust boundary.
- The PIN pad is a **custom in-app keypad**, not the device IME.
- `AppUpdateGate` mounts **above the routes**, so a mandatory update is enforced on the login
  screen too. The dialog is withheld while on the splash. "Later" is per-launch and deliberately
  **not persisted**.
- `GET /v1/app/update` uses raw fetch semantics (`unauthenticated: true`) because it runs before
  any session exists. Read the running build from `AppUpdate.getInfo()`, never from a bundled
  constant. Send `baseVersion(versionName)`.
- `actionable = updateAvailable && latest.url && latest.sha256`. A manifest without a download
  URL is not actionable.
- The native plugin **rejects a download without a `sha256`** and rejects a non-https URL, and
  confines installs to `cacheDir/updates/`. Do not attempt to work around any of it.
- Support ticket creation returns **201**.

**Acceptance.** Notifications list, mark-read and safe deep-link follow work. Support FAQs,
tickets and creation work. PIN set/change/remove and biometric enable/disable work on a device.
A mandatory update blocks the app; an optional one can be deferred for the launch.

---

## Phase 10 — Admin console

**Objective.** Full admin parity on the canonical route map. **The most likely phase to be
underestimated** — 28 routes, 20 screens, 11 permission codes, three pagination shapes,
optimistic concurrency, and two preview-then-commit protocols.

**Prerequisites.** Phase 3 for auth; independent of Phases 5–9 and parallelisable with them.

**Creates.** Sixteen feature modules under `src/features/admin/`:

```
overview/       applications/    users/          funds/
fund-aum/       client-values/   receipts/       refunds/
payments/       mandates/        audit/          emails/
content/        app-config/
```

Plus:

```
src/ui/patterns/{PreviewCommitPanel.tsx,OptimisticVersionForm.tsx}
src/features/admin/shared/{useAdminQuery.ts,adminPermissions.ts}
```

Requirements:

- **Screens own their queries.** No container layer doing every screen's fetching — that is what
  `pages/legacy/legacyRoutes.jsx` became.
- **Split the tab-prop mega-screens into routes.** `AumScreen` (601 lines), `ClientValuesScreen`
  (711) and `FundReceiptScreen` (492) each become three or four small screens with explicit
  permissions.
- **`OptimisticVersionForm`** for every `If-Match` PATCH and for fund-receipt acknowledgement
  (which carries `expectedVersion` in the body). On `STATE_CONFLICT`, refetch and re-present.
  Never blind-retry.
- **`PreviewCommitPanel`** for collective AUM growth and collective client growth. Send the
  preview's `basisHash` on commit; on `STATE_CONFLICT` **clear the preview and require a new
  one**. The underlying data moved. A guard test enforces the server half of this protocol.
- **`Idempotency-Key` on every admin mutation, including FAQ writes.** Admin FAQ writes are the
  one legacy exception and should not be copied.
- **The application decision endpoint takes `?outcome=` in the query string with a strict-empty
  body.** Sending `{outcome}` in the body gives `VALIDATION_FAILED`.
- **Mandate routes are conditionally registered.** A 404 must render as "PhonePe is not
  configured in this environment", distinctly from "not found".
- **Write affordances gate on the write permission, not the read one.** Permissions are any-of,
  so `content.read` alone currently opens FAQs and `config.read` alone opens the App Builder
  with a visible Publish button.
- **One pagination hook.** Filters in the query key so a filter change restarts the cursor.
  "Load more", never a numbered pager.
- **Server-side filtering** on the payments and audit tables. The legacy screens filter
  client-side over whatever the first page returned.
- **New screens for existing backend capability**: `/users/:userId/login-events`, and
  suspend/reinstate/close on `/users/:userId` — the latter only after confirming the product
  wants it, since the permissions exist in the database but not in the legacy nav.
- **Fold `/admin/system/environment` into App Builder** as a read-only panel. It reads the same
  endpoint and says so in its own copy.
- **`/admin/users/approvals` becomes `/applications`** — removing the last KYC-adjacent path.
- Admin must work below `lg`, including as an APK. It is not desktop-only.

**Acceptance.** Every route on the canonical admin map renders with correct permission gating.
Fund create, publish, lifecycle and holdings CRUD work with `If-Match`. AUM initialize, growth,
correction and collective preview/commit work, including the 409 path. Client growth individual
and collective work. Receipt acknowledgement works, including the version conflict. Mandate
reconcile and cancel work. FAQ and app-config publishing work. Admin renders correctly at 375px,
768px and 1440px.

---

## Phase 11 — Android packaging

**Objective.** Both APK variants build, install and run correctly.

**Prerequisites.** Phases 2, 9, 10.

**Creates / ports.**

```
frontend_stack_ts/capacitor.config.ts        BOE_CAPACITOR_VARIANT gate, per-variant plugins
frontend_stack_ts/android/                   cap add android
  app/src/main/AndroidManifest.xml
  app/src/main/java/com/beonedge/app/{MainActivity,SystemChromePlugin,AppUpdatePlugin}.java
  app/build.gradle  build.gradle  variables.gradle
  app/src/main/res/values/{styles,colors,strings}.xml
  app/src/main/res/xml/{network_security_config,file_paths,backup_rules,data_extraction_rules,config}.xml
frontend_stack_ts/resources/launcher/{client,admin}/   + generate-android-assets.mjs
frontend_stack_ts/scripts/check-phonepe-native-target.mjs
```

Port verbatim, because each of these exists because of a shipped defect:

| Setting | Reason |
|---|---|
| `androidScheme: 'https'` | WebView origin becomes `https://localhost`, which **must** be in `WEB_ORIGIN_ALLOWLIST` or the app looks entirely offline |
| `cleartext: false`, `allowMixedContent: false` | one policy for all builds, no dev exception; `emu/boe_update.sh` refuses a non-https API origin |
| `loggingBehavior: 'none'` | the default `debug` printed secure-storage tokens, biometric credentials and the PhonePe transaction token to logcat |
| `insetsHandling: 'css'`, `style: 'LIGHT'` | the safe-area contract and dark icons on ivory |
| `zoomEnabled: false` | page zoom only; OS text scaling and TalkBack must keep working |
| transparent `statusBarColor` / `navigationBarColor` + `windowDrawsSystemBarBackgrounds` | what makes `SystemChrome.setBarBackground` work |
| `AppTheme.NoActionBarLaunch` → `postSplashScreenTheme` | without the handoff the activity keeps the splash theme for its whole life and `forceDarkAllowed=false` never applies |
| `allowBackup="false"` | the WebView data directory holds the session vault |
| `windowSoftInputMode="adjustResize"` | Android 12+ otherwise leaves inputs behind the bottom nav |
| `setRecentsScreenshotEnabled(false)` on API 33+ | keeps portfolio values out of the task switcher without `FLAG_SECURE`, so users can still screenshot for support |
| `res.srcDirs += resources/launcher/${boeVariant}` | replaced a copy-into-`src/main/res` step that leaked admin red branding into client builds |
| release-signing `taskGraph.whenReady` guard | fails any release task with an actionable message when signing material is missing |
| PhonePe repo scoped to `includeGroup` | — |
| `minSdk 24`, `compileSdk 36`, `targetSdk 36` | **targetSdk 36 makes edge-to-edge mandatory** |

**Modifies.** `emu/boe_update.sh` — point it at `frontend_stack_ts` behind a flag, keeping the
legacy path working. **Add the missing admin APK npm scripts** — `app/package.json`'s
`build:android*` scripts hardcode `client`, so the admin variant is currently buildable only
through `emu/boe_update.sh`.

**Acceptance.** `VITE_BEO_APP_TARGET=client npm run build:android` passes both dist checks, and
`check-phonepe-native-target.mjs` confirms PhonePe plugin entries are present for `client` and
absent for `admin`. Both APKs install and launch.

`NEEDS RUNTIME VERIFICATION` on a device, and none of it is provable here:

- Safe-area insets under a camera cutout, in portrait **and landscape**
- Status bar and navigation bar colour and icon contrast
- Keyboard resize with a sticky action bar present
- Hardware Back through all five rules, including the transactional confirm
- Hosted checkout redirect and return inside the WebView
- AutoPay native SDK authorisation
- Biometric prompt and PIN unlock
- APK self-update download, SHA-256 verification and install
- No token or credential appears in `logcat`

---

## Phase 12 — Cutover and legacy retirement

**Objective.** `frontend_stack_ts` becomes the deployed frontend and `frontend_stack` is
removed.

**Prerequisites.** Phase 11 and the full [12](12-risk-regression-test-plan.md) checklist signed
off on the VPS.

### 12.1 Deployment wiring

Modify `release_manager/export.sh::build_images()` to build from `frontend_stack_ts`,
producing the same two images from one Dockerfile:

- `boe-{dev,prod}-app` — `VITE_BEO_APP_TARGET=client`, absolute API base
- `boe-{dev,prod}-admin` — `VITE_BEO_APP_TARGET=admin`, **relative `/api`**

The relative admin base is not optional. The admin console is served from a different host whose
vhost proxies `/api/` itself; baking the user SPA's absolute origin made every admin call
cross-origin and failed three ways at once — CORS, `validateWebOrigin()` rejecting
`Sec-Fetch-Site: cross-site`, and `Secure`/`__Host-` cookies not being sent cross-site. The
visible symptom was the admin splash never releasing.

Keep the `ARG VITE_BEO_APP_TARGET` grep guard, and keep
`assert_frontend_runtime_images()` — it proves the exact images start under the VPS security
profile and it also gates `--skip-build`.

`docker-compose.{dev,prod}_app.yml` need no structural change: same port 8080, same
`read_only: true` plus `tmpfs /tmp`, same healthcheck, same `127.0.0.1` binding. Only the image
names' provenance changes.

### 12.2 Cutover sequence

```
dev: deploy frontend_stack_ts images → full regression on dev → soak
prod: deploy → verify → keep the previous images available for rollback
```

Deployment is the maintainer's, via `release_manager/` on the VPS.

### 12.3 Legacy removal — only after prod is verified

```
git rm -r frontend_stack/
```

Then, in the same commit or immediately after:

- Remove the `frontend` CI job from `.github/workflows/ci.yml` and update
  `release_manager/tests/runtime_contract.test.sh` expectations.
- **Point `check-frontend-contract-drift.mjs` at `frontend_stack_ts` and regenerate the
  baseline.** Blocker B4: without this, deleting the legacy tree makes `discoverFrontendPaths`
  throw `ENOENT` and the `contracts` CI job fails.
- Remove `frontend_stack` references from `DEPLOY.md`, `WORKFLOW.md`, `CLAUDE.md`,
  `emu/boe_update.sh` and `release_manager/export.sh`.
- Delete the duplicate assets: `logo-mark.svg`, `logo-on-dark.svg`,
  `frontend_stack/assets/beonedge_logo.svg`, root `beonedge_logo.svg`, and both root
  `.zip` files.
- **Do not rename `frontend_stack_ts` to `frontend_stack`** in this phase. Prove the replacement
  works under isolation first; normalise the name later if wanted.

Git history retains the old frontend. Nothing is preserved in the working tree.

---

## Phase 13 — Backend cleanup

**Objective.** No unnecessary remains in the backend either. **Prove obsolescence; do not delete
because the new frontend does not call something.**

**Prerequisites.** Phase 12, soaked in production.

Safe to remove — proven dead, with the evidence:

| Item | Evidence |
|---|---|
| `src/auth/sessionTokens.ts` | referenced only by its own test; the live path uses `refreshDerivation.hashToken` |
| `CACHE_KEYS.fundList`, both `CACHE_PREFIXES` entries | no consumer; `invalidatePrefix` never called. **Consider instead wiring `invalidatePrefix` into fund publish (BC10)** rather than deleting the capability |
| Three duplicate `requireIdempotencyKey` bodies | use the shared one in `adminRouteKit.ts` |
| `optionalIdempotencyKey` | unused |
| `PUT` from the CORS allowed-methods list | no route uses it |
| `POST /v1/client/email-verification/resend` | a pure alias on the same handler; remove once the new frontend stops calling it |
| `payments.mobileSdk` → rename | it now holds only recurring-gateway credentials |
| `AppError("MOBILE_CHECKOUT_DISABLED")` for AutoPay | rename to something truthful, or drop it with the 0.2 decision |
| `email_verification_state = 'rejected'` | permitted by the CHECK, written by nothing — decide whether to use it or drop it from the CHECK |
| Fixture-name residue | `fundowner-kyc@example.com` and `'kyc-fund'` in `clientEmailVerification.integration.test.ts:167,169` |

Requires a decision, not a deletion:

| Item | Question |
|---|---|
| `refundRepository` and the refund state machine | Nothing creates a refund row. Is refunding a product feature? If yes, the creation path is missing. If no, remove the machinery and the admin surface |
| `providerEventInboxRepository.claimReceived` / `.reschedule` / `.deadLetter` | An async inbox drain that nothing calls. A webhook whose synchronous processing fails is retried only by PhonePe redelivery or reconciliation polling. Wire it or remove it |
| `user_credentials.locked_until` / `failed_attempt_count` | No account lockout exists. Migration `026` calls it a deliberate deferral. Implement or drop the columns |
| In-process rate limiting | Covers only 4 AUM writes, not login, `/newuser`, OTP, payments, webhooks or support, and multiplies by instance count. The audit calls it "a security gap to fix deliberately, not an abstraction to delete" |
| `mandateReconciliationWorker` | No dedicated entrypoint, no compose service, and **no health check**, while the other four workers have all three |
| `legacy_investment_reviews` | Guarded by migration 042 but not dropped by it. Needs its own reviewed migration |
| `adminFundGrowthPreviewRoutes.ts` | A one-route module split off solely to satisfy the guard-test path scanner. Consider adjusting the scanner instead |
| `phonepe_mobile_sdk` as a **one-time** channel | Legitimate for mandate setup; two integration-test cases still exercise it as one-time |
| `POST /v1/admin/users/:id/{suspend,reinstate,close}` and login-events | Either surface them (Phase 10) or prove them obsolete |

Documentation cleanup, all of it live misinformation:

- `CLAUDE.md:20` — backend deps are not "`pg`, `razorpay`".
- `release_manager/docs/CAPACITOR_DEBUG_LOG_TOKEN_EXPOSURE.md:28` — `enableLogging` is `false`
  for every target.
- `docs/major architectural changes/` (6 files) and `docs/android-architect/` (2 files) — still
  describe Razorpay as live and recommend "defer Razorpay". Mark superseded or archive.
- The complexity-audit table, migration and contract-location counts (49 tables not 55;
  34 migrations `009`–`020`, `022`–`043`; contracts at root).
- `.claude/agent-memory/node-backend-engineer/project_razorpay_test_integration.md` — describes a
  payment provider and idempotency layer that do not exist. **Delete it**; it is the sole entry
  `MEMORY.md` indexes, so any agent loading that memory starts wrong.
- **`backend_controller/.env.legacy-backup`** — delete the file or rotate the Razorpay keys it
  contains through secret management.

**Do not remove** anything protected by the five guard tests, any table referenced by a
restrictive FK, or any capability whose absence has not been proven.

---

## Parallelisation

```
Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──┬──▶ 4 ──▶ 5 ──▶ 6 ──▶ 7 ──▶ 8 ──▶ 9 ─┐
                                              │                                      ├──▶ 11 ──▶ 12 ──▶ 13
                                              └──▶ 10 (admin, independent) ──────────┘
```

Phase 10 needs only Phase 3 and can run alongside 4–9. Phase 11 needs 9 and 10 both landed.

## Decisions log

To be filled in as Phase 0 resolves them.

| # | Decision | Chosen | Date | Note |
|---|---|---|---|---|
| D1 | AutoPay web support: hosted channel, or Android-only | | | Blocker B3, blocks Phase 8 |
| D2 | `GET /v1/public/consent-documents`: implement, or remove from the contract | | | BC2 |
| D3 | Bulk mark-all-read: add endpoint, or drop the affordance | | | BC8 |
| D4 | Server-side transaction filtering: add params, or accept client-side | | | BC9 |
| D5 | Suspend / reinstate / close: build the UI, or prove obsolete | | | Backend capability with no frontend |
| D6 | Refunds: is refunding a product feature at all | | | Nothing creates a refund row |
| D7 | Statement download: specify as new work, or omit | | | Legacy affordance never existed |
| D8 | Email verification state vocabulary: `pending` or `pending_verification` on the wire | | | Blocks Phase 4 status UI |
| D9 | Version for the committed payment slice | | | `VERSION` is already `0.11.9` and tagged |
| D10 | Fund-detail cache invalidation on publish (BC10) | | | Affects perceived staleness |

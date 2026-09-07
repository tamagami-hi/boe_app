# 06 — Legacy / Dead / Duplicate Code

Classified inventory with evidence. This exists so the greenfield build does not reproduce any
of it, and so a later cleanup phase knows what is safe to delete.

Classifications:
`ACTIVE` · `DEFINITELY DEAD` (zero importers or zero call sites, proven) ·
`PROBABLY STALE` (reachable but superseded) · `DUPLICATE` (same code twice) ·
`SEMANTIC DUPLICATE` (same responsibility, different code) ·
`HALF-MIGRATED` · `FAKE` (renders as a feature, does nothing) ·
`NEEDS RUNTIME VERIFICATION`

## DEFINITELY DEAD — client package

| Artefact | Evidence |
|---|---|
| `layout/Screen.jsx` | zero importers under `src/pages`, `src/components`, `src/layout`; still re-exported from `src/index.js:5-11` |
| `layout/PageHeader.jsx` | zero importers; still re-exported |
| `layout/Section.jsx` | zero importers; still re-exported |
| `layout/Card.jsx` | zero importers; still re-exported — while `be-card` is hand-written 63 times in `src/pages` |
| `layout/MetricGrid.jsx` + `Metric` | zero importers; still re-exported |
| `layout/ActionBar.jsx` | zero importers; still re-exported |
| `layout/BottomSheet.jsx` | zero importers. The superseded overlay generation — `PageSheet.jsx`'s header (lines 5–20) records that it was created to replace five hand-rolled sheets |
| `services/types.js` | `grep '^export'` returns **nothing**, and no file imports it |

Seven of eleven layout wrappers are dead, and all seven are still advertised as the package's
public layout API. That combination is the single clearest signal of how the frontend decayed.

## DEFINITELY DEAD — admin package

| Artefact | Evidence |
|---|---|
| `layout/primitives/PageHeader.jsx` + `PageHeader.css` | imported nowhere outside `primitives/index.js`. Its own docblock says it "Replaces .ash-top-heading and .adm-top title patterns" and unifies "the 18px ash style and 28px serif adm style into a single 20px sans authoritative header" — the unification never landed. If it *were* used inside `AdminShell` it would emit a second `<h1>` alongside `TopBar`'s |
| `.adm-app`, `.adm-side`, `.adm-brand`, `.adm-side-foot`, `.adm-top` rules in `styles/admin/admin-responsive.css:11-40` | `AdminShell` emits `ash-app`. `.adm-app` is a selector **no component renders**. An entire mobile sidebar treatment styling a dead root class |
| `.adm-app` token block in `styles/desktop/shell.css:19-25` | same reason — it re-points `--be-content-max` and `--be-page-pad-x` for a class nothing renders |
| `styles/desktop/site.css` (18 lines) | last remnant of a wider site/landing CMS; imported by `Admin.jsx` only to satisfy the import |
| Landing-content-editor block in `shell.css` around line 1060 | `.ash-content-rail-stack`, `.ash-section-desc*` — no JSX consumer in the package |

## DEFINITELY DEAD — shared and root

| Artefact | Evidence |
|---|---|
| `packages/shared/src/assets/logo-mark.svg` | zero importers; md5-identical to four other files |
| `beonedge_logo.zip` (1283 B) and `beonedge logo.zip` (2041 B, with a space) at repo root | referenced by no build step and no source file; hand-checked-in design deliverables |
| `frontend_stack/colors_and_type.css` | sits at the workspace root outside every package, not in the design-tokens `exports` map. `NEEDS RUNTIME VERIFICATION` whether anything imports it |
| `packages/design-tokens/src/{tokens-core,kit-core,fonts}.css` are unexported | not dead — reachable only through the two exported sheets' `@import`s. Noted because it looks like dead code and is not |

## DEFINITELY DEAD — backend

| Artefact | Evidence |
|---|---|
| `src/auth/sessionTokens.ts` | `parseSessionTokenKeys` and `createSessionTokenService` are referenced **only by their own test**. Its keyed-HMAC design and `CRYPTO_CSRF_TOKEN_KEY` are not in force — the live path uses `refreshDerivation.hashToken`, an unkeyed SHA-256. Under the forward-only rule this is a superseded implementation retained as a dormant alternative |
| `deps.csrfKeyVersion` | stored in `auth_sessions.csrf_key_version`, but the *refresh* key is what actually derives CSRF successors (`deriveCsrfToken(deps.refreshKey, …)`). The CSRF key is never used |
| `CACHE_KEYS.fundList` | defined in `cache/cache.ts`, **not referenced** by `listFunds` or anything else |
| `CACHE_PREFIXES.funds` and `.publicContent` | no consumer; `Cache.invalidatePrefix` is implemented and **never called from any route**. Direct consequence: publishing a fund version does not evict `funds:detail:*` |
| `providerEventInboxRepository.claimReceived`, `.reschedule`, `.deadLetter` | implemented; nothing in `src/` calls them. `provider_events` only ever goes `received → processed` inline, so a webhook whose synchronous processing fails is retried only by PhonePe redelivery or the reconciliation worker |
| `refundRepository.create` | `grep "refundRepository.create\|createRefund\|insertRefund"` finds only the factory and its two wirings in `composition.ts`. **No code path can create a refund row**, so the admin refund retry/reconcile UI operates on rows nothing produces |
| `optionalIdempotencyKey` in `adminRouteKit.ts` | appears unused |
| `PUT` in the CORS `Access-Control-Allow-Methods` | advertised; no registered route uses `PUT` |
| `email_verification_state = 'rejected'` | permitted by the migration-040 CHECK; **no code path writes it** |
| `user_credentials.locked_until`, `.failed_attempt_count`, `.failed_attempt_window_started_at` | never written. There is no account lockout; migration `026`'s comment confirms this is a deliberate deferral |

## FAKE — renders as a feature, does nothing

| Artefact | Evidence | Verdict |
|---|---|---|
| Explore "notify me" button | `Explore.jsx:140` sets a local toast string via `setNotifyToast`; **no API call anywhere** | REMOVE |
| `notificationsApi.markAllRead` | line 48: the http branch contains **no `apiRequest` call**. There is also no bulk endpoint on the backend | REMOVE or add a backend endpoint |
| Statement download | `Statements.jsx:210` is a Close button; download iconography exists elsewhere but no export path does | REMOVE, or specify as new work |
| Portfolio redemption | `layout/PageSheet.jsx:16-17` comments reference a "part-entered redemption" sheet Portfolio once had | Already removed by `81fd011`; do not resurrect |

## HALF-MIGRATED

### The uncommitted payment refactor

31 files changed, +487/−945, 3 deletions, 4 untracked additions. `tsc --noEmit` passes on the
dirty tree, and the change is internally coherent — a repo-wide grep for
`mobilePaymentGateway|phonePeMobileOrderGateway|MobilePaymentGateway|createSdkOrder|markAttemptSdkDispatched|paymentSdkTokenAad|PHONEPE_MOBILE_SDK_ORDER_ENABLED`
finds **nothing** in live source.

Deleted: `backend_controller/src/providers/mobilePaymentGateway.ts`,
`src/providers/phonepe/phonePeMobileOrderGateway.ts` and its 249-line test.
Added: `createCheckout` on the `PaymentGateway` interface, `trustedCheckoutUrl()` origin
validation, `PHONEPE_CHECKOUT_ALLOWED_ORIGINS`, `markAttemptDispatched`,
untracked migration `043_hosted_checkout_dispatch_claim.sql`, untracked
`frontend_stack/packages/client/src/utils/checkoutRedirect.js`.
Removed config: `PHONEPE_MOBILE_SDK_ORDER_ENABLED`, `payments.mobileSdk.enabled`.

**What is still unfinished:**

1. **Migration 043 is untracked and unapplied.** Migration 035 created
   `payment_attempts_sdk_dispatch_channel_check`, which permits
   `provider_dispatch_started_at` only for `phonepe_mobile_sdk`, `phonepe_mandate_setup` and
   `phonepe_autopay`. The new `/pay` path calls `markAttemptDispatchStarted` on a
   `hosted_redirect` attempt, so **every hosted-checkout write violates the CHECK until 043 is
   applied**. Migration must precede code.
2. **The payment contract is now split, not migrated.** One-time payments are hosted redirect;
   AutoPay mandate authorisation is still native-SDK-only and returns
   `{type:'phonepe_sdk', token, merchantId, environment}`. In a browser
   `browserPlatform.start` returns `{status:'unavailable'}`, so **web AutoPay cannot
   complete at all**. Two different checkout contracts now coexist.
3. **`payments.mobileSdk` is a badly-named survivor.** It now only holds `merchantId`,
   `tokenEncryptionKey`, `tokenKeyVersion` and `requestTimeoutMs`, consumed by the recurring
   gateway, `clientAutoPaySipRoutes` and `phonePeMandateEventRoutes`. It compiles; the name
   lies.
4. **`AppError("MOBILE_CHECKOUT_DISABLED")` is still the code thrown when AutoPay is
   disabled** (`clientAutoPaySipRoutes.ts:352,546`), even though mobile checkout no longer
   exists.
5. **`mapPaymentCheckout` keeps a dual shape** — it accepts both `{type:'redirect', url}` and
   the legacy `phonepe_sdk` form. Under the forward-only rule the legacy branch should go once
   AutoPay is resolved.
6. **`phonepe_mobile_sdk` is now a partly-orphaned enum value.** It survives legitimately for
   mandate setup (`pages/MandateDetail.jsx:116`, `pages/StartSipSheet.jsx:120`,
   `app/src/platform/phonePeMobileCheckout.js:53`), but also in `db/types.ts:810`,
   `paymentsRepository.ts:23,684`, `metricsRepository.ts:42`, migrations `033`/`035`/`039`/`043`,
   and two integration-test cases at `paymentSettlement.integration.test.ts:1464,1488` that
   still exercise it as a **one-time** channel.
7. **Nothing is committed.** `VERSION` is already `0.11.9` and commit `0347ee7` already tagged
   that release, so this slice needs a new version or an amended release decision.

Also uncommitted in this slice: `PHONEPE_ENV` flipped from `sandbox` to `production` in
`stacks/dev_release/.env.example`, with the section header changing from "never use live
gateway credentials in development" to "environment-selected PhonePe credentials". The
recorded reason (in the untracked `LUNA_IMPL_LOG.md` entries) is that physical-device testing
proved PhonePe rejects `/checkout/v2/sdk/order` because `com.beonedge.app.dev` is not the
onboarded package, and git archaeology found the two successful ₹2 payments in `v0.10.7` used
hosted Standard Checkout — the path a prior commit had deleted.

### Other half-migrated items

| Artefact | State |
|---|---|
| `packages/admin/src/pages/legacy/legacyRoutes.jsx` | The name says legacy; the file is live and load-bearing. `Admin.jsx:6-22` imports 17 wrappers, and it owns all 18 `React.lazy` boundaries plus every screen's data fetching and prop drilling. Removing it breaks every route except `/admin/site/faqs`. What is actually stale is the **pattern** — screens take props instead of calling hooks |
| `shared/src/appConfig.js` as a second transport | Alongside `client/src/services/_util.js::apiRequest`. `IMPLEMENTATION_CHANGELOG.md` claims its requests were routed through the canonical transport, but the presentation/fixture separation is still listed as future work |
| `migration 042` | Committed, guarded, and **not applied to any deployed database**. The deploy tooling assigns it to schema family `0.11.9`, refuses `--skip-db-backup` while pending, and blocks image-only auto-rollback past the boundary. `NEEDS RUNTIME VERIFICATION` |
| `legacy_investment_reviews` | **Guarded** by migration 042's `RAISE EXCEPTION` block but **not dropped** by it. Needs a separate reviewed migration |
| `.ash-` / `.adm-` namespace coexistence | `shell.css:1-6` states it explicitly: the new namespace "Coexists with the legacy `.adm-` styles while old screens await their per-domain rebuild." The rebuild did not happen |

## DUPLICATE — literal

| Artefact | Duplicate of | Difference |
|---|---|---|
| `client/src/store/AdminSessionContext.jsx` | `client/src/store/SessionContext.jsx` | `scope: 'admin'` and the event filter (`=== 'admin'` vs `=== 'client' \|\| !e.detail?.scope`). Otherwise the same hydrate-then-`currentUser` sequence, the same listener, the same `sessionState` helpers |
| `admin/src/data/AdminCacheEvictor.jsx` | `client/src/data/ClientCacheEvictor.jsx` | cache prefix only |
| `packages/shared/src/assets/logo.svg`, `logo-mark.svg`, `logo-on-dark.svg`, `frontend_stack/assets/beonedge_logo.svg`, root `beonedge_logo.svg` | each other | **md5-identical**, `87255e92d395e9d571f3b73e3722d43d`. Five files, four names, one artwork. `logo-on-dark` is a naming lie |
| `requireIdempotencyKey` in `clientOrderRoutes.ts:76`, `clientAutoPaySipRoutes.ts:76`, `adminIdentityRoutes.ts:129` | `adminRouteKit.ts:38` | same semantics, four bodies (backend) |
| `styles/mobile/index.css` imported twice | — | `ClientApp.jsx` and again at `NotFound.jsx:11` |
| `desktop/admin.css` + `shell.css` imported three times | — | `Admin.jsx`, `NotFound.jsx`, `Forbidden.jsx` |
| Two identical "Contact support" buttons | — | `Blocked.jsx:33` and `:36`, across two branches |

## SEMANTIC DUPLICATE

| Responsibility | Implementations | Canonical |
|---|---|---|
| Page frame | client: 7 dead wrappers + hand-written `be-*`; admin: `.ash-page` and `.adm-screen` with different padding, only `.adm-screen` adding bottom-nav clearance; plus `layout/primitives/Page.jsx` | one `Page` primitive |
| Page title | admin `layout/PageHeading.jsx` (a **context provider**, not a component), admin `layout/primitives/PageHeader.jsx` (dead), client `layout/PageHeader.jsx` (dead) | one `PageHeader` |
| Overlay | client `BottomSheet.jsx` `.be-sheet*` (dead), client `PageSheet.jsx` `.apk-sheet*` (4 importers), shared `AdaptiveDialog.jsx` `.be-dialog*` (admin). All three correctly delegate to `useOverlayBehavior` and `OverlayStackContext` — markup and CSS are what is triplicated | one `Dialog` + one `Sheet`, sharing the hook |
| Form field | admin `components/FormField.jsx` (24 lines, requires a caller `id`, children-as-function, `aria-describedby` = error **or** hint) vs shared `components/FormField.jsx` (56 lines, `useId`, `cloneElement`, joins both descriptions, adds `required`). **Admin's weaker one serves all 35 money-form call sites** | shared's, with the correct a11y |
| Skeleton | admin `SkeletonTableRow` (10 screens), admin `SkeletonTile` (1), shared `Skeleton` (5 admin screens) | one |
| Empty / error / loading | admin `EmptyTableRow` (10 screens), shared `EmptyState` (1 screen), shared `AsyncState` (**unused by admin**, so every screen hand-rolls an `ash-load-note` retry banner — `EmailDeliveriesScreen.jsx:43-51`, `EnvironmentScreen.jsx:104-112`) | one `AsyncBoundary` |
| Table | admin `DataTable.jsx` (178 lines, selection, imports shared `StickyActionBar`) used by **exactly one** screen; every other screen writes raw `<table class="adm-table">` with `data-label` for card mode; shared `CurrencyCell`, `DateCell`, `UserCell`, `ListRow` unused in admin | one `DataList` |
| Badge | admin `StateBadge` (11 screens), admin `ApprovalStatusBadge` (1 screen), shared `Badges.jsx` | one `StatusBadge` |
| Money formatting | `client/utils/format.js` is **a pure re-export** of `shared/format.js`; `src/index.js:34-42` re-exports a third time; inside `shared/format.js`, `fmtMoney:19` and `formatMoney:26` are near-identical | one function, one import path |
| Percentage formatting | `client/utils/fundDisplay.js::formatReturnPct` (2 decimals) vs `shared/format.js::fmtPct` (1 decimal). **Explore and FundDetail therefore render percentages to different precision** | one |
| Fund risk / labels | `client/utils/fundDisplay.js`, `pages/fundDetail/fundDetailModel.js`, `shared/riskMapping.js`, `shared/components/Badges.jsx::RiskBadge` | one fund-presentation module |
| Total return | `Dashboard.jsx:45` + own JSX + `dashboard.css` (402 lines); `Portfolio.jsx:18` + own JSX + `portfolio.css` (614 lines); and `Statements.jsx:50` computes `totalReturns` **from statement rows rather than from `/v1/client/portfolio`** | one derived value from the authoritative endpoint. `NEEDS RUNTIME VERIFICATION` that they currently agree |
| Pagination | `hooks/useAdminList.js` (`limit=25`), the bespoke append buffer in `adminResources.js::useAdminFunds` (`limit=100`), `screens/useAumHistory.js` (own `PAGE_LIMIT`) — all three speaking the same wire protocol | one paginated-query hook |
| Offline behaviour | `helpers/loadAdminData.js` returns fake FAQs; `hooks/useAdminList.js` refuses and shows "This screen needs the backend" | one honest refusal. `rules.md` §4 forbids rendering a failed read as emptiness |
| Breakpoint | client 430px / 24rem / 480px; admin JS 768 + CSS 768 ×2 + 1100 + 40rem | one token set |
| Page max-width | eight declarations spanning 420–780px across `auth.css`, `base.css`, `layout.css` | one container token |
| Explore card styling | `explore.css` (641 lines) **and** `fund-redesign.css` (63 selectors, all `.apk-fc-*`) both style Explore; they collide on exactly one rule, `.apk-ha-dot`, where `fund-redesign.css` wins by import order | one stylesheet per component |
| Class vocabulary | `be-*`, `apk-*`, `adm-*`, `ash-*` — all four live, two of them inside the same element at `FundDetail.jsx:471` | one |
| Admin route container | `pages/legacy/legacyRoutes.jsx` does the fetching for 17 screens that could each own their query | screens own their data |

## PROBABLY STALE

| Artefact | Why |
|---|---|
| `client/src/services/adminApplicationsApi.js` | zero importers in the client package; its only consumer is `admin/src/data/ApprovalsQueueProvider.jsx:5`. An admin API in the client package |
| `admin/src/pages/AdminLogin.jsx:8-9` importing `client/src/styles/mobile/{base,auth}.css` | admin reaching into the client's mobile stylesheet |
| `transactionsApi.listTransactions({filter})` | the `filter` argument is **never sent to the server**; filtering happens client-side after `mapLedgerRow` over `?limit=100` |
| `services/appUpdate.js:81` raw `fetch` | deliberate (it runs before any session exists), but it means no retry, no error normalisation and no connectivity reporting on that path |
| `/app/mandates/:mandateId` path name | `routes.js:159-161` admits it is historical and there is no mandate |
| `adminFundGrowthPreviewRoutes.ts` | a one-route module split off `adminAumRoutes.ts` sharing the identical deps object; its header says the split exists only to satisfy the dependency-wall path scanner |
| `POST /v1/client/email-verification/resend` | registered on the **same handler** as `/start` at `clientEmailVerificationRoutes.ts:126-127`. Two paths, one behaviour |
| `EmailVerificationDetail.jsx` | a read-only status view that duplicates the status row already on `Profile.jsx` |
| `screens/EnvironmentScreen.jsx` | reads the same `GET /v1/admin/app-config` as App Builder and says in its own copy that changes are made there |
| `xml/config.xml` | a vestigial Cordova widget with `<access origin="*" />` |
| `payments.mobileSdk` config key | now holds only recurring-gateway credentials; the name is wrong post-refactor |

## FIXTURE MODE — a production code path, not test data

Five client fixtures, each imported at module scope **by a service**, returned whenever
`useHttpApi()` is false:

| Fixture | Importer | Contents |
|---|---|---|
| `data/fixtureUser.js` | `services/authApi.js:1` | `local_client` / `client@beonedge.local`, `status:'approved'` |
| `data/fixturePortfolio.js` | `services/portfolioApi.js:1` | hardcoded ₹12,38,450 (`:5`) |
| `data/fixtureTransactions.js` | `services/transactionsApi.js:1` | **`[]`** |
| `data/fixtureStatements.js` | `services/statementsApi.js:2` | **`[]`** |
| `data/fixtureNotifications.js` | `services/notificationsApi.js:1` | **`[]`** |

No test file imports any of them. Three of five are empty, so the default build produces a
signed-in fake user with a fake balance and no history — a worse demo than either a real
backend or a complete fixture set. Screens with no fixture throw `FixtureModeError` and render
an error state.

Admin's `fixtures/adminCollections.js` has exactly one importer anywhere in the monorepo:
`helpers/loadAdminData.js:4,37` — also a production path. It carries one collection, so
FaqsPage shows three fake FAQs while every sibling screen silently shows an empty table.
And `hooks/useAdminList.js` does the opposite for the same condition.

**Verdict: REMOVE the entire mechanism.** It creates a third environment nobody tests, and it
directly violates `rules.md` §4 ("a failed read is never rendered as 'there is nothing
here'").

## Already removed — do not resurrect

Verified absent from disk. Guard tests enforce several of these.

| Artefact | Removed by | Guard |
|---|---|---|
| `frontend_stack/packages/ui-kits`, `frontend_stack/preview` | `538abe6` | `app/src/bundleContract.test.js` |
| `client/src/data/fixture{Mandates,Orders,SipControlRequests}.js` | `cb963a5` | — |
| `admin/src/legacyTabMap.js`, `LegacyTabRedirect.jsx`, admin route aliases `/admin/users/*`, `/admin/ops/*`, `/admin/system/{support,audit-log}` | `a356b15` | — |
| `client/src/pages/WithdrawalRequests.jsx`, `submitRedemption`, `listRedemptionRequests`, `/app/withdrawals` | `81fd011` | `Portfolio.test.jsx:22` asserts the absence |
| Root `kimi:chunk` / `kimi:run` / `kimi:apply` scripts, `agent-browser`, `ngrok` | — | root `package.json` now has one devDependency |
| ~120 legacy Express/JSON-store backend files, including `domain/payments/paymentReturnToken.ts` and `routes/paymentReturnRoutes.ts` | BE-008…BE-015 | `legacy-deletion.guard.test.ts` |
| 25 investment modules including `domain/client/{beginPayment,bookOrder,confirmPayment,settlePayment,allocateGain,requestRedemption,settleRedemption,sip,activateMandate,generateSipInstallments}.ts`, singular-named repositories, `paymentWorker.ts`, `sipWorker.ts` | 039-era | `investment-architecture.guard.test.ts` |
| Nine dropped table names: `fund_aum_updates`, `investor_ledger_entries`, `redemption_requests`, `fund_nav_prices`, `holding_lots`, `holding_lot_movements`, `investment_executions`, `fund_positions`, `approval_actions` | — | `investment-architecture.guard.test.ts` — no module may even reference them |
| Razorpay | `9c7030e`, `932f400` | `legacy-deletion.guard.test.ts:46` keeps `razorpayProvider.js` deleted; `bundleContract.test.js:27-40` asserts `index.html` matches neither `razorpay` nor `phonepe`, no `<script src="https…">` is injected, `client/src/utils/razorpay.js` does not exist, and no client source references `checkout.razorpay.com` |

## Razorpay — definitive status

**Fully dead.** `backend_controller/package.json` dependencies are exactly
`@phonepe-pg/pg-sdk-node`, `argon2`, `fastify`, `ioredis`, `jose`, `kysely`,
`libphonenumber-js`, `nodemailer`, `pg`, `pino`, `zod`. No `razorpay`.

`git grep -il razorpay` returns 11 tracked files, **none of them runtime source**:
two negative guards (above), historical documentation, and two correct historical references
in the complexity audit.

Two live hazards remain, and both are documentation rather than code:

1. **`CLAUDE.md:20` still says the backend is "Dependency-light (`pg`, `razorpay`)".** Both
   halves are now wrong.
2. **`release_manager/docs/major architectural changes/` (6 files, 184 KB) and
   `release_manager/docs/android-architect/` (2 files, 125 KB) still describe Razorpay as
   live**, and `BOE_ANDROID_AUDIT_HANDOVER.md:39-40` plus `BOE_ANDROID_UX_ARCHITECTURE_AUDIT.md`
   (lines 65, 342, 346, 537, 672, 871, 1041, 1412) recommend "defer/lazy-load Razorpay".
   **These are the most dangerous stale documents in the repository for a new frontend author.**

And one live security finding: **`backend_controller/.env.legacy-backup`** exists on disk
(correctly gitignored by `.gitignore:18:.env.*`) containing `PROVIDER_MODE=razorpay` plus a
`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` triple (test-prefixed
`rzp_test_…`). Delete the file or rotate the keys through secret management regardless of test
status.

## Agent-memory hazard

`.claude/agent-memory/node-backend-engineer/project_razorpay_test_integration.md`, dated
2026-05-10, instructs wrapping POSTs with `withIdempotency(routePath, handler)` from
`src/http/idempotency.js`, persisting to a `requestIdempotency` collection, and notes "PG
branch is not yet wired — currently 503s". **None of that exists.** `src/http/` contains
`idempotencyProtocol.ts`, the store is the PostgreSQL `idempotency_records` table, and
`investmentPlans` / `requestIdempotency` are JSON-store-era names removed by `522d3a0`.
`MEMORY.md` indexes this as the sole memory entry, so any agent loading that memory starts
with a wrong model of both the payment provider and the idempotency layer.

Its one surviving principle is still correct and is now codified in `rules.md` §3: clients
legitimately retry POSTs, so server-side `Idempotency-Key` deduplication is required.

## Stale-documentation ledger

A new frontend author will be actively misled by these.

| Document | Stale claim | Reality |
|---|---|---|
| `release_manager/docs/CAPACITOR_DEBUG_LOG_TOKEN_EXPOSURE.md:28` | "PhonePe SDK logging stays disabled outside debug builds (`enableLogging: androidBuildType === 'debug'`)" | `app/src/platform/phonePeMobileCheckout.js:69` reads `enableLogging: false`. The uncommitted `RISK_AND_DECISIONS.md` correctly says false **for every target**; the Capacitor doc was not updated by commit `089dd27` |
| `CLAUDE.md:20` | backend deps are "`pg`, `razorpay`" | PhonePe SDK + Kysely + Fastify; no Razorpay |
| `docs/major architectural changes/` (6 files), `docs/android-architect/` (2 files) | Razorpay live; "defer Razorpay"; `.env.production.example` declares Razorpay | all obsolete |
| `docs/Completed/INTENDED_SCOPE_ARCHITECTURE_AUDIT_2026-08-24.md` (53 KB) | describes the pre-039 investment-review flow | superseded; the audit itself names it as stale |
| complexity audit §1/§6/§21 and `DATABASE_AND_SOURCES_OF_TRUTH.md` | "55 Kysely tables" | **49** |
| same | "30 migrations" / "009–042" | **34**: `009`–`020`, `022`–`043` (no `021`); `043` untracked |
| same | contracts package at `frontend_stack/packages/contracts`, "no runtime imports found", "disconnected" | it is at **root** `packages/contracts` and is a CI job of its own |
| `DATABASE_AND_SOURCES_OF_TRUTH.md` §"Tables read without complete current writes" | "`risk_assessments` is read by eligibility/order logic" | **zero references anywhere under `backend_controller/src`** |
| same, "Confirmed legacy compliance/profile" and "legacy marketing" rows | imply `investor_profiles`, `kyc_documents`, `kyc_reviews`, `risk_assessments`, `marketing_leads`, `kyc_cases`, `kyc_verification_codes` are still typed | **none appear in `src/db/types.ts`** — the rows describe physical tables awaiting migration 042, not typed ones |
| `FILE_DISPOSITION_AND_ROADMAP.md` §KEEP | `src/http/csrf.ts` | does not exist at that path; CSRF lives in `domain/auth/webAuth.ts` |
| same §"Verification baseline" | "663 backend tests / 909 pass 3 fail frontend" | superseded twice (666/903, then 664/899). The 3 failures were fixed by `0de72d1`. **Three mutually inconsistent baselines exist across the doc set** |
| `REMAINING_WORK_AND_PAYMENT_TEST_READINESS.md` §Preconditions | "the current root `VERSION` is `0.11.8`" | `VERSION` is `0.11.9` |
| complexity audit §2/§11 | native mobile SDK one-time checkout is the live path | deleted in the working tree |

`REMAINING_WORK_AND_PAYMENT_TEST_READINESS.md` §"Documentation reconciliation still required"
contains a self-aware list of most of these. The previous agent knew; the reconciliation was
never done.

## What this means for the new frontend

| Do not build | Because |
|---|---|
| A fixture or demo mode | It is a third untested environment and it renders failures as emptiness |
| More than one class vocabulary | Four coexist today and two appear in the same element |
| Layout wrappers that pages are free to ignore | Seven of eleven ended up dead while pages hand-wrote the classes |
| More than one overlay markup | Three exist; the behaviour hook was always the hard part and it is already shared |
| Per-screen error and loading banners | `AsyncState` exists and admin ignores it entirely |
| Client-side-only filtering on a server-paginated list | `transactionsApi` and `PaymentsScreen` both do it; the cursor is filter-bound so it cannot be mixed safely |
| A numbered pager | There is no offset and no total count anywhere in the API |
| A second transport | `appConfig.js` became one and it is still unresolved |
| Admin code inside a client package | It made the client package unreplaceable |
| A route whose name records history | `/app/mandates/:id` manages SIP plans and its own comment admits it |
| A write path without an `Idempotency-Key` | Admin FAQ writes are the one legacy exception and they should not be copied |
| Comments in source files | `rules.md` §1 forbids them outright, in every language and every form |

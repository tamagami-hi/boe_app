# 02 — Active Feature Inventory

Every capability, with evidence, and a verdict for the new frontend.

Verdicts:
`REBUILD` — real, keep the behaviour, rewrite the implementation ·
`REDESIGN` — real but the current UX or IA is wrong ·
`CONSOLIDATE` — several implementations collapse into one ·
`REMOVE` — do not carry forward ·
`VERIFY` — needs a product or runtime decision first

## Client capabilities

| Feature | Legacy frontend | Backend | API | DB | Status | Verdict |
|---|---|---|---|---|---|---|
| Native login (Android) | `pages/Login.jsx`, `services/authApi.js`, `auth/sessionVault.js`, `store/SessionContext.jsx` | `routes/nativeAuthRoutes.ts`, `domain/auth/nativeAuth.ts` | `POST /v1/auth/native/{login,refresh,logout}` | `users`, `user_credentials`, `auth_sessions`, `auth_refresh_tokens`, `auth_login_events` | ACTIVE | **REBUILD** |
| Web login (admin) | `admin/pages/AdminLogin.jsx`, `store/AdminSessionContext.jsx` | `routes/webAuthRoutes.ts`, `domain/auth/webAuth.ts` | `POST /v1/auth/web/{login,refresh,logout}`, `GET /v1/auth/web/csrf` | same | ACTIVE | **REBUILD** |
| Session restore across reload / app restart | `hydrateSessionVault()` then `authApi.currentUser()`; native trusts a cached principal, web recovers CSRF | `webRecoverCsrf`, native refresh rotation | `GET /v1/auth/web/csrf`, `POST /v1/auth/native/refresh` | `auth_sessions` | ACTIVE | **REBUILD** |
| Coalesced single-flight 401 refresh | `services/_util.js::refreshSessionOnce` per scope | reuse detection revokes the family | — | `auth_refresh_tokens` | ACTIVE — **mandatory**, two parallel rotations are read as theft | **REBUILD** |
| Email OTP Verification | `pages/EmailVerification.jsx` (+ `EmailVerificationDetail.jsx`), `services/emailVerificationApi.js` | `routes/clientEmailVerificationRoutes.ts`, `domain/client/emailVerification.ts` | `POST /v1/client/email-verification/{start,resend,verify}`, `GET /v1/client/email-verification-status` | `users.email_verification_*`, `email_verification_codes` | ACTIVE | **REDESIGN** — one screen, not two; move out from under Profile in the back hierarchy |
| Investing eligibility gate | `ClientApp.jsx::RequireApproved`, `services/eligibilityApi.js` | `routes/clientPortfolioRoutes.ts::getEligibility`, `domain/client/investingEligibility.ts` | `GET /v1/client/eligibility` | derived | ACTIVE | **REBUILD** |
| Dashboard / home | `pages/Dashboard.jsx` (295 lines) | portfolio + sip + research + funds + eligibility | five cached reads | derived | ACTIVE | **REDESIGN** — remove the duplicated summary computation |
| Fund catalogue with search, status and risk filters, four sort modes | `pages/Explore.jsx` (520 lines) | `routes/clientCatalogRoutes.ts::listFunds` | `GET /v1/client/funds?limit=100` | `funds`, `fund_versions` | ACTIVE | **REBUILD** |
| Explore "notify me" | `Explore.jsx:140` sets a local toast string | **none** | **none** | — | **FAKE** | **REMOVE** |
| Fund detail: hero, performance periods, benchmark, holdings donut, sector legend, advanced ratios, allocation legend, disclosures, in-page SIP calculator | `pages/FundDetail.jsx` (591) + `pages/fundDetail/*` (6 modules) | `clientCatalogRoutes.ts::getFund` (Redis-cached), `publicContentRoutes.ts` | `GET /v1/client/funds/:fundId`, `GET /v1/public/disclosures` | `funds`, `fund_versions`, `fund_stock_disclosures`, `fund_disclosure_versions` | ACTIVE | **REBUILD** — and join the shared cache, which it currently bypasses |
| Portfolio valuation and per-pool positions | `pages/Portfolio.jsx` (216) | `clientPortfolioRoutes.ts::getPortfolio`, `domain/client/portfolioLedger.ts` | `GET /v1/client/portfolio` | derived from `client_value_entries` | ACTIVE | **REBUILD** |
| Transactions: ledger tabs + payment-queue tabs, row detail sheet | `pages/Transactions.jsx` (284) | `clientPortfolioRoutes.ts::listTransactions`, `clientAccountRoutes.ts::listPayments` | `GET /v1/client/transactions`, `GET /v1/client/payments?status=` | `client_value_entries`, `payments` | ACTIVE | **REBUILD** — and send the filter to the server; the legacy `filter` argument is never transmitted |
| Statements list + detail | `pages/Statements.jsx` (218) | `clientAccountRoutes.ts::listStatements`, `domain/client/statements.ts` | `GET /v1/client/statements` | `client_value_entries` | ACTIVE | **REDESIGN** — stop computing a third `totalReturns` locally; read it from the portfolio endpoint |
| Statement download | icon only, no action (`Statements.jsx:210` is a Close button) | **none** | **none** | — | **ABSENT** | **REMOVE** (or specify as new work) |
| Lump-sum investment | `pages/LumpsumSheet.jsx` (157) | `clientOrderRoutes.ts::postCreateOrder` | `POST /v1/client/orders` + `Idempotency-Key` | `investment_orders` | ACTIVE | **REBUILD** |
| Hosted-redirect checkout | `payments/checkoutOrchestrator.js`, `CheckoutProvider.jsx`, `utils/checkoutRedirect.js` (untracked) | `clientOrderRoutes.ts::postPay`, `phonePeCheckoutGateway.ts::createCheckout` | `POST /v1/client/orders/:orderId/pay` `{checkoutChannel:"hosted_redirect"}` | `payments`, `payment_attempts` | **ACTIVE but UNCOMMITTED**; migration 043 required | **REBUILD** after blocker B1 |
| Pending-payment recovery | `payments/pendingPayment.js`, `localStorage['boe.pendingPayment']`, 30-minute expiry, `PendingPaymentRecovery` | — | — | — | ACTIVE — the only return-path mechanism, since PhonePe is sent `redirectUrl: null` | **REBUILD** |
| Payment status polling with expiry and retry | `pages/PaymentStatus.jsx` (266) | `clientPortfolioRoutes.ts::getPayment` | `GET /v1/client/payments/:paymentId` | `payments`, `payment_attempts` | ACTIVE — the best-written legacy flow screen | **REBUILD** |
| SIP creation (manual mode) | `pages/StartSipSheet.jsx` (337) | `clientSipPlanRoutes.ts::createSip` | `POST /v1/client/sips` | `sip_plans` | ACTIVE | **REBUILD** |
| SIP list | via `ordersApi.listSips` on Dashboard and MandateDetail | `clientSipPlanRoutes.ts::listSips` | `GET /v1/client/sips` | `sip_plans` | ACTIVE | **REBUILD** — needs a first-class screen |
| SIP pause / resume / cancel | `pages/MandateDetail.jsx:236-249` | `clientSipPlanRoutes.ts` | `POST /v1/client/sips/:sipPlanId/{pause,resume,cancel}` | `sip_plans` | ACTIVE but **unreachable after the creating session** | **REDESIGN** — give SIP plans a real destination |
| Pay a due SIP installment | `MandateDetail.jsx` checkout action | `sipScheduleWorker` creates the order; the ordinary `/pay` flow settles it | `POST /v1/client/orders/:orderId/pay` | `investment_orders` type `sip_installment` | ACTIVE | **REBUILD** |
| AutoPay mandate setup | `StartSipSheet.jsx` autopay branch, `payments/pendingAutoPaySetup.js` | `clientAutoPaySipRoutes.ts::postAutoPay` | `POST /v1/client/sips/autopay` + `Idempotency-Key` | `payment_mandates`, `mandate_setup_attempts` | ACTIVE on Android only — returns `{type:'phonepe_sdk'}` and needs a native bridge | **VERIFY** (blocker B3) |
| AutoPay status, retry, cancel | `pages/MandateDetail.jsx` | `clientAutoPaySipRoutes.ts` | `GET /v1/client/sips/autopay/:sipPlanId`, `POST …/setup/retry`, `POST …/cancel` | mandate tables | ACTIVE | **REBUILD**, gated on B3 |
| Notifications list, mark read, deep-link follow | `pages/Notifications.jsx` (177) | `clientAccountRoutes.ts` | `GET /v1/client/notifications`, `PATCH /v1/client/notifications/:id` | `notifications` | ACTIVE | **REDESIGN** — `Notifications.jsx:89` passes a server-supplied `deepLink` to `navigate()` **without** `resolveInternalPath()`; the new frontend must resolve it |
| Mark all notifications read | `notificationsApi.js:48` — **no HTTP call in the http branch** | **no bulk endpoint** | **none** | — | **FAKE** | **REMOVE** or add a backend endpoint |
| Support: FAQ accordion with search, ticket list, ticket creation | `pages/Support.jsx` (211) | `clientAccountRoutes.ts` | `GET /v1/client/support/{faqs,tickets}`, `POST /v1/client/support/tickets` | `content_items(kind='faq')`, support tables | ACTIVE | **REBUILD** |
| Profile hub | `pages/Profile.jsx` | email-verification status | `GET /v1/client/email-verification-status` | `users` | ACTIVE — the only IA hub for secondary screens | **REBUILD** |
| Device PIN and biometric app lock | `components/AppLockGate.jsx`, `PinPad.jsx`, `services/securitySettings.js`, `platform/security.js`, `pages/Security.jsx` (361) | **none** — zero backend calls | **none** | device-local | ACTIVE, entirely client-side, **not a security boundary** | **REBUILD with the weakness documented in the UI copy** |
| Legal text | `pages/Legal.jsx` | — | — | — | ACTIVE but inert; contains **no links** | **REDESIGN** — make it the hub for charter and grievance |
| Investor charter | `pages/InvestorCharter.jsx` | `publicContentRoutes.ts` | `GET /v1/public/investor-charter` | `content_items` | ACTIVE, reachable only from a fund detail disclosure link | **REDESIGN** — reach it from Legal |
| Grievance redressal escalation matrix | `pages/GrievanceRedressal.jsx` (159) | `publicContentRoutes.ts` | `GET /v1/public/grievance` (content key `grievance-redressal`) | `content_items` | ACTIVE, same reachability problem; **the one screen that uses the destination trust boundary correctly** | **REDESIGN** — keep the resolver, fix the entry point |
| Disclosures on fund detail | `pages/fundDetail/DisclosureLink.jsx`, `services/disclosureApi.js` | `publicContentRoutes.ts` | `GET /v1/public/disclosures` | `content_items` | ACTIVE | **REBUILD** |
| Research context strip | Dashboard + Explore, `services/researchApi.js` | `clientAccountRoutes.ts::researchContext` | `GET /v1/client/research-context` | `content_items` | ACTIVE, returns `{items: []}` when unpublished | **REBUILD** |
| Remote app configuration | `hooks/useAppConfig.js`, `shared/src/appConfig.js` | `publicAppRoutes.ts` | `GET /v1/app-config` (Redis-cached) | `app_config` versions | ACTIVE — and `useAppConfig.js` re-resolves every quick-action route through `resolveInternalPath`, dropping unresolvable ones | **REBUILD**, keeping that resolution |
| In-app APK self-update | `components/AppUpdateGate.jsx`, `services/appUpdate.js`, `services/updateNotification.js`, native `AppUpdatePlugin.java` | `publicAppRoutes.ts`, `release/releaseFeed.ts` | `GET /v1/app/update`, `POST /v1/client/app-version` | filesystem APK feed + `notifications` | ACTIVE | **REBUILD** |
| Splash / launch gate / reachability probe | `pages/Splash.jsx`, `shared/net/launchGate.js`, `authApi.checkReachability` | `runtime/health.ts` | `GET /v1/health` (unauthenticated, 6 s, no retry) | — | ACTIVE | **REBUILD** |
| Connectivity banner | `shared/net/connectivity.js` + `reportTransportOutcome` from every request | — | — | — | ACTIVE | **REBUILD** |
| Terminal-account wall | `pages/Blocked.jsx` | `users.account_state` | any authenticated call | `users` | ACTIVE | **REBUILD** — deduplicate the two identical "Contact support" buttons |
| Withdrawals / redemptions | **deleted** by commit `81fd011` (`WithdrawalRequests.jsx`, `submitRedemption`, `listRedemptionRequests`, `/app/withdrawals`) | **no route**; `017_canonical_investing.sql` explicitly states no redemption requests | **none** — `grep "redemptions" backend_controller/src/routes` returns zero | — | **REMOVED**; `Portfolio.test.jsx:22` asserts the absence | **REMOVE — do not resurrect** |
| Fixture / offline demo mode | `services/_util.js::serviceMode`, five `data/fixture*.js` imported at module scope | — | — | — | Production code path; **three of five fixtures are `[]`** | **REMOVE entirely** |
| `/app/start` route alias | `CLIENT_ROUTE_ALIASES`, `ClientApp.jsx:87` | — | — | — | Dead — nothing produces that URL | **REMOVE** |

## Admin capabilities

All 28 admin routes are reachable and every feature area is still served by a live backend
route — verified against `backend_controller/src/routes/*.ts`. Nothing in the admin package
targets a deleted endpoint.

| Feature | Legacy screen | Backend route module | API | Permission (any-of) | Verdict |
|---|---|---|---|---|---|
| Overview dashboard: applications waiting, payments in flight, fund count, seven quick links | `pages/OverviewPage.jsx` | oversight + catalog + identity | `GET /v1/admin/{payments,funds}` + approvals queue | `[]` — any admin | **REBUILD** |
| Application approvals queue with expandable applicant identity, CSV export, truncation notice | `screens/ApprovalsScreen.jsx` (319), `data/ApprovalsQueueProvider.jsx` | `routes/adminIdentityRoutes.ts`, `domain/admin/decideApplication.ts` | `GET /v1/admin/applications`, `POST /v1/admin/applications/:id/decision?outcome=` + `Idempotency-Key` | `applications.read` | **REBUILD** — note the decision is in the **query string** with a strict-empty body |
| Approvals badge polling | same provider: 20 s on the approvals/overview routes, 120 s elsewhere, paused on `visibilitychange`, resync on focus/online, 5 s floor | — | — | `applications.read` | **REBUILD** |
| User directory with debounced search and status filter | `screens/UserDetailsListScreen.jsx` (209) | `routes/adminOversightRoutes.ts` | `GET /v1/admin/users?status=&q=&limit=&after=` | `users.read`, `users.read_limited` | **REBUILD** |
| User detail: roles, email verification, positions, recent orders, account state | `screens/UserDetailScreen.jsx` (445) | oversight | `GET /v1/admin/users/:userId/detail` | prefix-inherited | **REBUILD** |
| Suspend / reinstate / close a user | **none** — no caller anywhere in the admin package | `routes/adminOversightRoutes.ts:8-10` | `POST /v1/admin/users/:id/{suspend,reinstate,close}` | `users.suspend`, `users.close` — **absent from `nav.js`** | **VERIFY** — live backend capability with no UI |
| User login-event history | **none** | `routes/adminOversightRoutes.ts:7,69` | `GET /v1/admin/users/:id/login-events` | — | **VERIFY** — same |
| Fund catalogue list with state filter, search, summary counts | `screens/fundOps/FundsListScreen.jsx` | `routes/adminCatalogRoutes.ts` | `GET /v1/admin/funds?limit=100&state=&search=&after=` | `funds.read` | **REBUILD** |
| Fund creation | `screens/fundOps/FundCreateScreen.jsx` + `FundProfileForm.jsx` (240) | catalog | `POST /v1/admin/funds` + `Idempotency-Key` | `funds.write` **and** requiresAll `funds.write`,`aum.write` | **REBUILD** |
| Fund workspace: versions, publish, lifecycle transitions | `screens/fundOps/FundWorkspace.jsx` | catalog | `GET /v1/admin/funds/:fundId`, `POST …/versions`, `PATCH /v1/admin/funds/:fundId` with `If-Match` | `funds.read` / `funds.write` | **REBUILD** |
| Fund holdings CRUD | `screens/FundStockListPanel.jsx` (391) | catalog | `GET/POST /v1/admin/funds/:fundId/stocks`, `PATCH/DELETE …/stocks/:stockId` | `funds.write` | **REBUILD** |
| Opening AUM and growth instruction | `screens/FundAumPanel.jsx` (325) | `routes/adminAumRoutes.ts`, `domain/admin/fundAumGrowth.ts` | `POST /v1/admin/aum/funds/:fundId/{initialize,growth}` + `Idempotency-Key`, rate-limited | `aum.write` + requiresAll `funds.read`,`aum.read` | **REBUILD** |
| AUM snapshot history and corrections | `screens/FundAumHistoryPanel.jsx` (310), `screens/useAumHistory.js` | AUM | `GET /v1/admin/aum/funds/:fundId/history?limit=&after=`, `POST /v1/admin/aum/snapshots/:snapshotId/corrections` | `aum.read` / `aum.write` | **REBUILD** |
| Collective AUM growth: preview then commit with `basisHash` | `screens/AumScreen.jsx` (601) tab `collective` | `adminAumRoutes.ts` + `adminFundGrowthPreviewRoutes.ts` | `POST /v1/admin/aum/growth/collective/preview` then `/collective` | `aum.write` | **REBUILD** — a 409 must clear the preview and force a re-preview |
| Individual client value adjustment | `screens/ClientValuesScreen.jsx` (711) tab `individual` | `routes/adminClientGrowthRoutes.ts`, `domain/admin/clientGrowth.ts` | `POST /v1/admin/client-growth/individual` + `Idempotency-Key` | `client_growth.write` | **REBUILD** |
| Collective client growth: preview then commit | same, tab `collective` | client growth | `POST /v1/admin/client-growth/collective/preview` then `/collective` | `client_growth.write` | **REBUILD** |
| Client position lookup | same, tab `detail` | oversight | `GET /v1/admin/users`, `GET /v1/admin/users/:id/detail` | `client_values.read`, `users.read`, `users.read_limited` | **REBUILD** |
| Fund receipts: awaiting / acknowledged, acknowledge with `expectedVersion` | `screens/FundReceiptScreen.jsx` (492) | `routes/adminFundReceiptRoutes.ts` | `GET /v1/admin/fund-receipts?state=`, `POST …/:orderId/acknowledge` | `funds.receipts.read` | **REBUILD** — a conflict must refresh the queue, not retry |
| Refunds: list, retry, reconcile | same screen, tab `refunds` | fund receipts | `GET /v1/admin/refunds`, `POST /v1/admin/refunds/:id/{retry,reconcile}` | `funds.receipts.read`, `refunds.write` | **REBUILD** — but note **nothing in the codebase creates a refund row** |
| Payment evidence table with client-side filtering | `screens/PaymentsScreen.jsx` (185) | fund receipts | `GET /v1/admin/payments` | `payments.read` | **REDESIGN** — push filtering to the server |
| Mandate list with state and attention filters | `screens/MandatesScreen.jsx` (121) | `routes/adminMandateRoutes.ts` (**conditionally registered**) | `GET /v1/admin/mandates?limit=100&state=&attention=true` | `payments.read` | **REBUILD** — must handle a 404 as "PhonePe not configured" |
| Mandate detail trace: mandate, user, fund, SIP, setup attempts, collection attempts, cancel commands | `screens/MandateDetailScreen.jsx` (145) | mandates | `GET /v1/admin/mandates/:mandateId` | `payments.read`; writes need `finance.operate` | **REBUILD** |
| Reconcile mandate, reconcile collection, cancel mandate | same, via `data/useMandateMutations.js` | mandates | `POST /v1/admin/mandates/:id/{reconcile,cancel}`, `POST /v1/admin/mandate-collections/:collectionId/reconcile` | `finance.operate` | **REBUILD** |
| Audit log grouped by day with client-side filters | `screens/AuditLogScreen.jsx` (227) | oversight | `GET /v1/admin/audit-logs` | `audit.read` | **REBUILD** |
| Email delivery evidence log with masked recipients, attempt counts, last error | `screens/EmailDeliveriesScreen.jsx` (136) | identity | `GET /v1/admin/email-deliveries?state=&templateKey=&limit=50` | `email_deliveries.read`, `email_deliveries.read_masked` | **REBUILD** |
| FAQ CMS: list, create, edit, publish/unpublish, delete | `features/site/FaqsPage.jsx`, `FaqEditorDrawer.jsx`, `fields.jsx` | `routes/adminContentRoutes.ts` | `GET/POST /v1/admin/faqs`, `PATCH/DELETE /v1/admin/faqs/:faqId` | `content.read`, `content.publish` | **REBUILD** — and **add the missing `Idempotency-Key`**; FAQ writes are the only admin mutations without one |
| App Builder: publish client app configuration (component visibility, screen copy, shortcuts, amount presets) | `screens/appBuilder/AppBuilderScreen.jsx` (495), `appBuilderModel.js` | `adminContentRoutes.ts` | `GET /v1/admin/app-config`, `PATCH /v1/admin/app-config` | `config.read`, `config.publish` | **REBUILD** |
| Environment read-only view of the published config | `screens/EnvironmentScreen.jsx` (146) | content | `GET /v1/admin/app-config` | `config.read`, `config.publish` | **CONSOLIDATE** into App Builder — it reads the same endpoint |
| Admin session and permission bootstrap | `BrowserRoot.RequireAdmin`, `Admin.jsx::Permitted`, `navigation/nav.js::canAccessPath` | `routes/adminIdentityRoutes.ts` | `GET /v1/admin/session` | rejects zero roles | **REBUILD** |
| Admin splash with reachability retry and native system bars | `pages/AdminSplash.jsx` | health | `GET /v1/health` | — | **REBUILD** — evidence the admin build ships as an APK |
| Admin route container layer | `pages/legacy/legacyRoutes.jsx` — 17 wrappers, 18 `React.lazy` boundaries, all data fetching and prop drilling | — | — | — | **REDESIGN** — the name is a lie; it is live and load-bearing. Screens should call their own hooks. |
| Admin route aliases and `legacyTabMap.js` | **deleted** by commit `a356b15` | — | — | — | **REMOVE — do not resurrect** |
| Admin offline behaviour | `helpers/loadAdminData.js` returns fake FAQs; `hooks/useAdminList.js` refuses and shows a message | — | — | — | **Two conflicting behaviours in one console** | **REMOVE fixtures; keep the honest refusal** |

## Backend capability with no frontend at all

Prove these are wanted before building UI for them; prove they are obsolete before removing
the backend code.

| Capability | Evidence | Note |
|---|---|---|
| `POST /v1/admin/users/:id/suspend` / `/reinstate` / `/close` | `routes/adminOversightRoutes.ts:8-10` | Permissions `users.suspend`, `users.close` exist in the DB but not in `nav.js` |
| `GET /v1/admin/users/:id/login-events` | `routes/adminOversightRoutes.ts:7,69` | `auth_login_events` is populated on every attempt |
| Refund creation | `repositories/refundRepository.ts` fully implemented; `grep "refundRepository.create\|createRefund\|insertRefund"` finds **only the factory** | No code path can create a refund row. The retry/reconcile UI can only finish a row that does not exist yet. |
| `GET /v1/client/research-context` publishing | route reads `clientAccountRepository.findDocument` | Returns `{items: []}` when unpublished; no admin screen publishes it |
| Provider-event async inbox drain | `providerEventInboxRepository.claimReceived`/`reschedule`/`deadLetter` | Implemented, never called |
| `GET /metrics` | `runtime/health.ts`, IP-scoped in `runtime/metrics.ts::renderMetrics` | Intentionally outside the frontend — monitoring is a separate future stack |

## Contract present, implementation absent

| Operation | Evidence |
|---|---|
| `GET /v1/public/consent-documents` | In `packages/contracts/src/operations/public.ts` and in `generated/openapi-v1.json`. `grep` over `backend_controller/src` finds **no route registering that path**. The live consent surface is `POST /newuser` reading `consentRepository.findCurrentDocuments` in-request. A client calling it gets a 404. |

## Terminology

The KYC-versus-Email-OTP-Verification problem is **already fixed in source**. A repo-wide
grep for `kyc|KYC|know_your_customer|kycStatus` returns 77 lines and zero hits on
`know_your_customer` or `kycStatus`. Classification:

- **Historical migrations that created the misnamed schema — must NOT be renamed**, because
  rewriting an applied migration breaks the ledger: `014_canonical_compliance.sql`,
  `019_kyc_email_verification.sql` (the mis-named one), `012`, `020`, `025`, `041`
  (which performed the rename), `042` (which drops the tables), `018`.
- **Guard-test literals naming deleted files — leave alone**:
  `legacy-deletion.guard.test.ts:59,83`, `scripts/seedAuth.test.ts:12,17-18` (which asserts
  `kyc.read`/`kyc.review` are absent).
- **Genuine regulatory KYC in disclosure prose — correct as written**:
  `src/db/seedContent.ts:76,85` and its client mirror `services/disclosureApi.js:38,47`
  ("Provide accurate KYC information…", "…keep records of… KYC documents"). Do not rename.
- **Cosmetic residue, optional cleanup**: test fixture strings
  `clientEmailVerification.integration.test.ts:167,169`
  (`fundowner-kyc@example.com`, `'kyc-fund'`), `adminCollections.js:9` (`fixture-faq-kyc`),
  and `emailVerificationMigration.integration.test.ts:44,68` which **must** keep `kyc_cases`
  because it tests the drop.
- **One live application-code path**: `frontend_stack/packages/admin/src/pages/Admin.test.jsx:105`
  asserts the route `/admin/users/kyc` maps to `page-approvals`. That is the last place
  application code uses KYC vocabulary for the approvals surface. The new frontend must use
  `/admin/applications`.

Canonical vocabulary for the new frontend: **Email OTP Verification**. Route family
`/v1/client/email-verification/*`. State field `users.email_verification_state`.
Environment keys `EMAIL_VERIFICATION_{FROM,CODE_TTL_MS,CODE_MAX_ATTEMPTS,RESEND_COOLDOWN_MS,VALIDITY_MS}`.

**One vocabulary conflict to resolve before building status UI**: the migration CHECK allows
`not_started | pending | verified | rejected`, but the admin and client projections in
`LUNA_IMPL_LOG.md` use `verified` and `pending_verification`. These are two different
vocabularies for the same concept. `NEEDS RUNTIME VERIFICATION` of what the API actually
returns.

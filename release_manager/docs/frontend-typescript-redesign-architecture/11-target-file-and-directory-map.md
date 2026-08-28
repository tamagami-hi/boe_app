# 11 — Target File and Directory Map

Column `New/Ported` — **New** written from scratch · **Ported** copied with minimal change
because it is already correct · **Rebuilt** same responsibility, new implementation.

## Root

| Path | Purpose | New/Ported | Notes |
|---|---|---|---|
| `package.json` | one package, `@beonedge/frontend-ts`, `type: module`, `private` | New | **Declares every runtime dependency it imports.** The legacy packages declared almost none and relied on workspace hoisting |
| `tsconfig.json` | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` | New | |
| `tsconfig.node.json` | config for Vite and scripts | New | |
| `vite.config.ts` | target `define`, `manualChunks`, `cssMinify: 'lightningcss'` | Rebuilt | from `frontend_stack/app/vite.config.js` |
| `vitest.config.ts` / `vitest.setup.ts` | jsdom, Testing Library | Ported | from `frontend_stack/vitest.config.js`. **Do not opt into `v7_relativeSplatPath`** — the splat-resolution tests depend on current behaviour |
| `eslint.config.mjs` | flat config, `typescript-eslint`, import-boundary rules | New | the legacy frontend has **no lint tooling at all** |
| `index.html` | `viewport-fit=cover`, `theme-color`, `color-scheme: light`, inline `#F7F7F5` launch style | Ported | four places must keep the same colour |
| `Dockerfile` | 3 stages, digest-pinned, `ARG VITE_BEO_APP_TARGET`, nginx 8080, `USER 101:101` | Rebuilt | the `ARG` is grep-checked by `export.sh` |
| `nginx.conf` | `listen 8080`, SPA fallback, `GET /health` | Ported | no cache or gzip headers — the host nginx owns those |
| `capacitor.config.ts` | `BOE_CAPACITOR_VARIANT` gate, per-variant plugin lists | Ported | throws unless the variant is `client` or `admin` |
| `CAPACITOR_CONFIG.md` | why each key is set | Ported | required reading; every entry records a defect |

## scripts/

| Path | Purpose | New/Ported |
|---|---|---|
| `check-android-dist.mjs` | no cross-target asset; JS ≤ 320 kB, CSS ≤ 160 kB, total ≤ 1400 kB; woff2 only; no cyrillic/greek/vietnamese; **acyclic chunk graph** | Ported |
| `check-bundle-boots.mjs` | evaluate every chunk in JSDOM; the only pre-device smoke test | Ported |
| `check-phonepe-native-target.mjs` | PhonePe plugin present for `client`, absent for `admin` | Ported |
| `generate-api-client.ts` | emit `src/api/generated/operations.ts` from `@beonedge/contracts` descriptors | New |

## src/ root

| Path | Purpose | New/Ported | Legacy source |
|---|---|---|---|
| `main.tsx` | single dynamic import on a target ternary | Rebuilt | `app/src/main.jsx` — preserve the single-import shape |
| `index.css` | token imports, `#root` background, reset | Rebuilt | `app/src/index.css` |

## src/shells/

| Path | Purpose | New/Ported | Legacy source |
|---|---|---|---|
| `client/ClientShellRoot.tsx` | default export + `backPolicy` + `probeReachability` | Rebuilt | `app/src/ClientRoot.jsx` |
| `client/ClientFrame.tsx` | bottom nav below `lg`, top nav at `lg` | Rebuilt | `client/src/layout/ClientLayout.jsx` |
| `client/ClientNavigation.tsx` | five tabs from the manifest | Rebuilt | `client/src/layout/BottomNav.jsx` |
| `client/clientBackPolicy.ts` | `resolveClientBackPolicy` | Ported | `client/src/navigation/backPolicy.js` — keep param substitution in `parentPathOf` |
| `admin/AdminShellRoot.tsx` | default export + `backPolicy` + `probeReachability` | Rebuilt | `app/src/BrowserRoot.jsx` |
| `admin/AdminFrame.tsx` | sidebar at `lg`, bottom nav + domain strip below | Rebuilt | `admin/src/layout/AdminShell.jsx` |
| `admin/AdminNavigation.tsx` | sidebar, topbar, mobile nav, domain strip, approvals badge | Rebuilt | `admin/src/layout/{Sidebar,TopBar,AdminMobileNav,AdminDomainStrip}.jsx` |
| `admin/adminBackPolicy.ts` | `resolveAdminBackPolicy` | Ported | `admin/src/navigation/backPolicy.js` |

## src/app/

| Path | Purpose | New/Ported | Legacy source |
|---|---|---|---|
| `providers/AppProviders.tsx` | the ordering contract | Rebuilt | `app/src/NativeAppRoot.jsx` |
| `providers/QueryProvider.tsx` | TanStack Query client | New | replaces `shared/src/data/ResourceCacheProvider.jsx` |
| `providers/SessionProvider.tsx` | **one** provider parameterised by scope | Rebuilt | `client/src/store/SessionContext.jsx` **and** `AdminSessionContext.jsx` — a duplicate pair collapsed |
| `providers/OverlayStackProvider.tsx` | overlay stack for Back and Escape | Ported | `shared/src/overlay/OverlayStackContext.jsx` |
| `providers/ToastProvider.tsx` | transient confirmations | Rebuilt | `admin/src/components/ToastProvider.jsx` — was admin-only |
| `providers/NetworkStatusProvider.tsx` | online state + last transport outcome | Ported | `shared/src/net/connectivity.js` |
| `routing/clientRoutes.ts` | the client manifest | Rebuilt | `client/src/navigation/routes.js` |
| `routing/adminRoutes.ts` | the admin manifest | Rebuilt | `admin/src/navigation/nav.js` |
| `routing/buildRouter.tsx` | **generates `<Routes>` from the manifest** | New | replaces the hand-mounted `ClientApp.jsx` and `Admin.jsx` route trees that drift |
| `routing/RequireSession.tsx` | session gate | Rebuilt | `ClientLayout.jsx` / `BrowserRoot.RequireAdmin` |
| `routing/RequireRole.tsx` | client/admin role gate | Rebuilt | `shared/src/auth/roles.js` consumers |
| `routing/RequirePermission.tsx` | permission gate | Rebuilt | `Admin.jsx::Permitted` + `nav.js::canAccessPath` |
| `routing/RequireEligible.tsx` | investing eligibility gate | Rebuilt | `ClientApp.jsx::RequireApproved` |
| `routing/resolveDestination.ts` | **the one trust boundary** for remote URLs and paths | Ported | `client/src/navigation/routes.js::resolveDestination` + `resolveInternalPath` |
| `layouts/Page.tsx` | the **only** owner of content width and horizontal padding | New | replaces `layout/Screen.jsx` (dead), `admin/layout/primitives/Page.jsx`, `.ash-page`, `.adm-screen` |
| `layouts/PageHeader.tsx` | the **only** `<h1>` | New | replaces three page headers, two of them dead |
| `layouts/Section.tsx` | titled group | Rebuilt | `layout/Section.jsx` (dead) + `admin/layout/primitives/Section.jsx` |
| `layouts/ContentGrid.tsx` | responsive grid | Rebuilt | `admin/layout/primitives/ContentGrid.jsx` |
| `layouts/AuthLayout.tsx` | login and splash frame | New | replaces the seven container widths in `auth.css` |
| `native/NativeBackCoordinator.tsx` | one Back listener, five rules | Ported | `app/src/platform/NativeBackCoordinator.jsx` — **and wire `onTransactionalBack`, which the legacy `main.jsx` never passes** |
| `native/SystemBarsController.tsx` | `SystemBars.setStyle` + `SystemChrome.setBarBackground`, re-applied on resume | Ported | `app/src/platform/SystemBarsController.jsx` |
| `native/ConnectivityBanner.tsx` | offline banner | Ported | `shared/src/net/` consumers |

## src/api/

| Path | Purpose | New/Ported | Legacy source |
|---|---|---|---|
| `http.ts` | the transport: sync bearer read, CSRF, GET-only retry `[300,900]`, 20 s body-inclusive deadline, typed errors, coalesced 401 refresh, `unauthenticated` escape | Rebuilt | `client/src/services/_util.js` — behaviour-for-behaviour |
| `envelope.ts` | narrow `{ok,data,error,meta}` from `@beonedge/contracts` | New | |
| `errors.ts` | `ApiError` with `code: ErrorCode`, `TransportError` with `kind` | Rebuilt | the three ad-hoc classes in `_util.js` |
| `idempotency.ts` | `useIdempotencyKey(scope, body)` | Ported | `admin/src/helpers/idempotencyKeys.js` — the logic is correct |
| `cursor.ts` | branded opaque `Cursor` + page helpers | New | replaces three pagination implementations |
| `generated/operations.ts` | **generated, never hand-edited** | New | replaces 15 hand-written service modules |
| `session/tokenStore.ts` | in-memory sync read, async persistence, fail-closed on native | Ported | `client/src/auth/sessionVault.js` |
| `session/refresh.ts` | per-scope coalescing | Ported | `_util.js::refreshSessionOnce` |
| `session/scope.ts` | `'client' \| 'admin'` | New | |

## src/domain/

| Path | Purpose | New/Ported | Legacy source |
|---|---|---|---|
| `money.ts` | branded `Paise`, `paiseToRupees`, `rupeesToPaise`, `formatINR` | Rebuilt | `shared/src/money.js` + `shared/src/format.js` + `ordersApi.rupeesToPaiseString`. Consolidates `fmtMoney`/`formatMoney` into one |
| `status.ts` | every backend status → `{label, tone}`, exhaustive with `assertNever` | New | replaces per-screen status maps and three badge families |
| `dates.ts` | formatting, relative day, period arithmetic | Rebuilt | `shared/src/format.js` date helpers |
| `fund.ts` | risk, lifecycle, monogram, return formatting, ratio rows | Rebuilt | `client/src/utils/fundDisplay.js` + `pages/fundDetail/fundDetailModel.js` + `shared/src/riskMapping.js`. **One percentage precision** |
| `permissions.ts` | `PermissionCode` union, `hasAny`, `hasAll` | Rebuilt | `admin/src/navigation/nav.js` predicates |

## src/features/ — client

Each module contains `api.ts`, `queries.ts`, optional `mutations.ts`, its screens and its
components.

| Module | Screens | Legacy source |
|---|---|---|
| `auth` | `Login`, `Splash`, `Blocked`, `Forbidden`, `NotFound` | `pages/{Login,Splash,Blocked,NotFound}.jsx`, `admin/pages/{AdminLogin,AdminSplash,Forbidden,NotFound}.jsx`, `services/authApi.js` |
| `email-verification` | `EmailVerification`, `VerificationStatus` | `pages/EmailVerification.jsx`, `EmailVerificationDetail.jsx`, `services/emailVerificationApi.js`, `eligibilityApi.js` |
| `funds` | `FundList`, `FundDetail` | `pages/Explore.jsx`, `FundDetail.jsx`, `pages/fundDetail/*`, `services/fundsApi.js`, `researchApi.js` |
| `portfolio` | `Portfolio` | `pages/Portfolio.jsx`, `services/portfolioApi.js` |
| `activity` | `Activity` | `pages/Transactions.jsx`, `services/transactionsApi.js`, part of `ordersApi.js` |
| `orders` | `LumpsumInvest` | `pages/LumpsumSheet.jsx`, part of `ordersApi.js` |
| `payments` | `PaymentStatus` | `pages/PaymentStatus.jsx`, `payments/{CheckoutProvider,checkoutOrchestrator,pendingPayment}.js`, `utils/checkoutRedirect.js` |
| `sip` | `SipStart`, **`SipList` (new)**, `SipDetail` | `pages/StartSipSheet.jsx`, `MandateDetail.jsx`, `payments/pendingAutoPaySetup.js` |
| `statements` | `Statements` | `pages/Statements.jsx`, `services/statementsApi.js` |
| `notifications` | `Notifications` | `pages/Notifications.jsx`, `services/notificationsApi.js` |
| `support` | `Support` | `pages/Support.jsx`, `services/supportApi.js` |
| `legal` | `Legal`, `InvestorCharter`, `Grievance` | `pages/{Legal,InvestorCharter,GrievanceRedressal}.jsx`, `services/disclosureApi.js` |
| `profile` | `Profile`, `Dashboard` | `pages/{Profile,Dashboard}.jsx` |
| `device-security` | `DeviceSecurity` | `pages/Security.jsx`, `components/{AppLockGate,PinPad}.jsx`, `services/securitySettings.js` |
| `app-update` | `AppUpdateGate` | `components/AppUpdateGate.jsx`, `services/{appUpdate,updateNotification}.js`, `hooks/useAppConfig.js` |

## src/features/admin/

| Module | Screens | Legacy source |
|---|---|---|
| `overview` | `Overview` | `pages/OverviewPage.jsx` |
| `applications` | `ApplicationQueue`, `ApplicationDetail` | `screens/ApprovalsScreen.jsx`, `data/ApprovalsQueueProvider.jsx`, `client/src/services/adminApplicationsApi.js` |
| `users` | `UserDirectory`, `UserDetail`, `UserLoginEvents` (new) | `screens/UserDetailsListScreen.jsx`, `UserDetailScreen.jsx` |
| `funds` | `FundList`, `FundCreate`, `FundWorkspace`, `FundHoldings` | `screens/fundOps/*`, `screens/FundStockListPanel.jsx`, `data/{fundContracts,useFundMutations}.js` |
| `fund-aum` | `AumOverview`, `FundAum`, `FundAumHistory`, `CollectiveAumGrowth` | `screens/AumScreen.jsx` (601 lines, 4 tabs), `FundAumPanel.jsx`, `FundAumHistoryPanel.jsx`, `useAumHistory.js` |
| `client-values` | `ClientPositions`, `IndividualClientGrowth`, `CollectiveClientGrowth` | `screens/ClientValuesScreen.jsx` (711 lines, 3 tabs), `helpers/signedAmounts.js` |
| `receipts` | `FundReceiptQueue`, `FundReceiptDetail` | `screens/FundReceiptScreen.jsx` (492 lines, 3 tabs) |
| `refunds` | `RefundQueue` | same screen, `refunds` tab |
| `payments` | `PaymentEvidence` | `screens/PaymentsScreen.jsx` |
| `mandates` | `MandateList`, `MandateDetail` | `screens/MandatesScreen.jsx`, `MandateDetailScreen.jsx`, `data/{mandateContracts,useMandateMutations}.js` |
| `audit` | `AuditLog` | `screens/AuditLogScreen.jsx` |
| `emails` | `EmailDeliveries` | `screens/EmailDeliveriesScreen.jsx` |
| `content` | `FaqList` | `features/site/{FaqsPage,FaqEditorDrawer,fields}.jsx` |
| `app-config` | `AppConfigBuilder` | `screens/appBuilder/*`, `screens/EnvironmentScreen.jsx` (folded in), `shared/src/appConfig.js` |

## src/ui/

| Path | Purpose | New/Ported | Legacy source |
|---|---|---|---|
| `tokens/tokens-core.css` | **sole owner of the safe-area contract** | Ported | `design-tokens/src/tokens-core.css` — port verbatim |
| `tokens/tokens.css` | colour, type scale, spacing, radius, elevation, z-index, breakpoints | Ported | `design-tokens/src/tokens.css` |
| `tokens/fonts.css` | eight explicit `@font-face` rules, woff2, `unicode-range`, latin + latin-ext | Ported | `design-tokens/src/fonts.css` — never import the fontsource barrels |
| `tokens/kit.css` | base element styles | Ported | `design-tokens/src/{kit,kit-core}.css` |
| `tokens/safeArea.test.ts` | enforce the contract | Ported | `design-tokens/src/safeArea.test.js` |
| `primitives/*` | 24 components | New | replaces ~40 components across three packages, including 2 form fields, 3 skeletons, 3 overlays |
| `patterns/*` | 14 components | New | see [09](09-design-system-component-plan.md) |
| `charts/*` | 4 charts + `chartMath.ts` | Rebuilt | `client/src/components/{Charts.jsx,chartMath.js}`, `shared/src/components/SectorMiniBar.jsx` |

## src/platform/

| Path | Purpose | New/Ported | Legacy source |
|---|---|---|---|
| `capacitor.ts` | `isNative`, `platform`, lazy guarded plugin resolution | Rebuilt | `client/src/platform/info.js` |
| `secureStorage.ts` | credential store, fail-closed, purge legacy `localStorage` tokens | Ported | `client/src/platform/storage.js` |
| `biometrics.ts` | availability, prompt, keystore secret under `BIOMETRY_ANY` | Ported | `client/src/platform/security.js` |
| `lifecycle.ts` | foreground/background/resume, hardware Back subscription | Ported | `client/src/platform/lifecycle.js` |
| `appUpdate.ts` | the `AppUpdate` plugin bridge | Ported | `client/src/services/appUpdate.js` |
| `systemChrome.ts` | the chrome **stack** + the `SystemChrome` bridge | Ported | `shared/src/platform/systemBarStyle.js` |
| `openExternal.ts` | the only route out of the app, allowlisted | Ported | `client/src/utils/openExternal.js` |
| `errors.ts` | `PlatformError` | Ported | `client/src/platform/errors.js` |

## android/

| Path | New/Ported | Notes |
|---|---|---|
| `app/src/main/AndroidManifest.xml` | Ported | `allowBackup=false`, `adjustResize`, `singleTask`, wide `configChanges`, FileProvider, five permissions, `MAIN`/`LAUNCHER` only |
| `app/src/main/java/com/beonedge/app/MainActivity.java` | Ported | registers both plugins **before** `super.onCreate`, sets `AppTheme_NoActionBar`, `setRecentsScreenshotEnabled(false)` on API 33+ |
| `.../SystemChromePlugin.java` | Ported | `setBarBackground` paints window + decor + every WebView ancestor |
| `.../AppUpdatePlugin.java` | Ported | rejects a download without `sha256`, rejects non-https, single-flight, confines installs to `cacheDir/updates/`, `optLong` via `optDouble` |
| `app/build.gradle` | Ported | per-variant `res.srcDirs`, injected id/version, release-signing guard, minify + shrink |
| `build.gradle` / `variables.gradle` | Ported | AGP 8.13.0, scoped PhonePe repo, `minSdk 24` / `compileSdk 36` / `targetSdk 36` |
| `res/values/styles.xml` | Ported | transparent bars, `windowDrawsSystemBarBackgrounds`, splash-theme handoff, `forceDarkAllowed=false` |
| `res/values/colors.xml` | Ported | `launchBackground = #F7F7F5` |
| `res/xml/network_security_config.xml` | Ported | `cleartextTrafficPermitted=false`, system trust anchors only, **no dev carve-out** |
| `res/xml/file_paths.xml` | Ported | `cache-path app_updates path="updates/"` — narrowly scoped |
| `res/xml/{backup_rules,data_extraction_rules}.xml` | Ported | belt-and-braces with backup off |
| `res/xml/config.xml` | **Drop** | vestigial Cordova widget with `<access origin="*" />` |
| `resources/launcher/{client,admin}/` + `generate-android-assets.mjs` | Ported | source SVGs plus generated mipmaps and splashes |

---

## Legacy → target migration map

Action: **Rewrite** (behaviour survives, implementation does not) · **Port** (copy, minimal
change) · **Consolidate** (several into one) · **Remove** (do not carry forward)

### Client pages

| Legacy file | Responsibility | Target | Action |
|---|---|---|---|
| `pages/Login.jsx` | credential entry, `?from=` return | `features/auth/LoginScreen.tsx` | Rewrite |
| `pages/Splash.jsx` | launch gate, reachability | `features/auth/SplashScreen.tsx` | Rewrite |
| `pages/Blocked.jsx` | terminal-account wall | `features/auth/BlockedScreen.tsx` | Rewrite — deduplicate the two identical support buttons |
| `pages/NotFound.jsx` | recoverable dead end | `features/auth/NotFoundScreen.tsx` | Rewrite — drop the duplicate CSS import |
| `pages/Dashboard.jsx` | home, quick actions, summaries | `features/profile/DashboardScreen.tsx` | Rewrite — one summary source |
| `pages/Explore.jsx` | fund catalogue | `features/funds/FundListScreen.tsx` | Rewrite — **remove the fake "notify me"** |
| `pages/FundDetail.jsx` + `pages/fundDetail/*` | fund detail | `features/funds/FundDetailScreen.tsx` + components | Rewrite — **join the shared query layer** |
| `pages/Portfolio.jsx` | valuation, positions | `features/portfolio/PortfolioScreen.tsx` | Rewrite |
| `pages/Transactions.jsx` | ledger + payment queue | `features/activity/ActivityScreen.tsx` | Rewrite — filters in the query key |
| `pages/Statements.jsx` | statements | `features/statements/StatementsScreen.tsx` | Rewrite — **stop computing a third total return**; remove the download implication |
| `pages/Notifications.jsx` | notifications | `features/notifications/NotificationsScreen.tsx` | Rewrite — **resolve `deepLink`**; drop `markAllRead` |
| `pages/Profile.jsx` | account hub | `features/profile/ProfileScreen.tsx` | Rewrite |
| `pages/Security.jsx` | PIN, biometrics, session | `features/device-security/DeviceSecurityScreen.tsx` | Rewrite — state the weakness in copy |
| `pages/Support.jsx` | FAQs, tickets | `features/support/SupportScreen.tsx` | Rewrite |
| `pages/Legal.jsx` | legal text | `features/legal/LegalScreen.tsx` | Rewrite — **becomes the charter/grievance hub** |
| `pages/InvestorCharter.jsx` | charter | `features/legal/InvestorCharterScreen.tsx` | Rewrite |
| `pages/GrievanceRedressal.jsx` | escalation matrix | `features/legal/GrievanceScreen.tsx` | Rewrite — keep the destination resolution |
| `pages/EmailVerification.jsx` | OTP flow | `features/email-verification/EmailVerificationScreen.tsx` | Rewrite — `returnTo`, correct back parent |
| `pages/EmailVerificationDetail.jsx` | status view | `features/email-verification/VerificationStatusScreen.tsx` | Consolidate — reduce to status only |
| `pages/LumpsumSheet.jsx` | lump-sum entry | `features/orders/LumpsumInvestScreen.tsx` | Rewrite |
| `pages/StartSipSheet.jsx` | SIP creation, autopay branch | `features/sip/SipStartScreen.tsx` | Rewrite |
| `pages/MandateDetail.jsx` | SIP plan detail and actions | `features/sip/SipDetailScreen.tsx` | Rewrite — **now reachable from a new `/sips` list** |
| `pages/PaymentStatus.jsx` | polling, retry, recovery | `features/payments/PaymentStatusScreen.tsx` | Rewrite |
| — | SIP plan list | `features/sip/SipListScreen.tsx` | **New** — fixes the reachability hole |

### Client infrastructure

| Legacy file | Target | Action |
|---|---|---|
| `services/_util.js` | `api/http.ts` | Rewrite — preserve every behaviour |
| `services/authApi.js` | `features/auth/api.ts` + `api/session/*` | Rewrite |
| `services/ordersApi.js` (552 lines) | split across `features/{orders,payments,sip}/api.ts` | Rewrite |
| `services/{funds,portfolio,transactions,statements,notifications,support,disclosure,research,eligibility,emailVerification}Api.js` | `features/*/api.ts`, all generated from contracts | Rewrite |
| `services/adminApplicationsApi.js` | `features/admin/applications/api.ts` | Rewrite — **moves out of the client package** |
| `services/appUpdate.js` | `platform/appUpdate.ts` + `features/app-update/appUpdate.ts` | Rewrite |
| `services/updateNotification.js` | `features/app-update/updateNotification.ts` | Port |
| `services/securitySettings.js` | `features/device-security/securityStore.ts` | Port |
| `services/types.js` | — | **Remove** — no exports, no importers |
| `data/clientResources.js` | `api/queryKeys.ts` + per-feature `queries.ts` | Rewrite |
| `data/ClientCacheEvictor.jsx` | inside `SessionProvider` | Consolidate |
| `data/fixture*.js` (5 files) | — | **Remove** — a production code path, three of five empty |
| `store/SessionContext.jsx` | `app/providers/SessionProvider.tsx` | Rewrite |
| `store/AdminSessionContext.jsx` | same file, `scope="admin"` | **Consolidate** — a duplicate |
| `store/sessionState.js` | inside `SessionProvider` | Port — keep `isRestoreFailure` |
| `auth/sessionVault.js` | `api/session/tokenStore.ts` | Port |
| `navigation/routes.js` | `app/routing/clientRoutes.ts` + `resolveDestination.ts` | Rewrite |
| `navigation/backPolicy.js` | `shells/client/clientBackPolicy.ts` | Port |
| `layout/AppBar.jsx` | `shells/client/ClientFrame.tsx` header | Rewrite |
| `layout/BottomNav.jsx` | `shells/client/ClientNavigation.tsx` | Rewrite |
| `layout/PageSheet.jsx` | `ui/primitives/Sheet.tsx` | Consolidate |
| `layout/BottomSheet.jsx` | — | **Remove** — dead |
| `layout/{Screen,PageHeader,Section,Card,MetricGrid,ActionBar}.jsx` | `app/layouts/*`, `ui/primitives/Card.tsx` | **Remove the files; rebuild the concepts** — all six dead |
| `components/{Charts.jsx,chartMath.js}` | `ui/charts/*` | Rewrite |
| `components/{AppLockGate,PinPad}.jsx` | `features/device-security/*` | Rewrite |
| `components/AppUpdateGate.jsx` | `features/app-update/AppUpdateGate.tsx` | Rewrite |
| `payments/{CheckoutProvider,checkoutOrchestrator}.js` | `features/payments/checkout.ts` | Rewrite — hosted redirect only |
| `payments/{pendingPayment,pendingAutoPaySetup}.js` | `features/payments/pendingPayment.ts`, `features/sip/pendingAutoPaySetup.ts` | Port |
| `platform/*.js` (6 files) | `platform/*.ts` | Port |
| `utils/format.js` | — | **Remove** — a pure re-export facade |
| `utils/{fundDisplay,approval}.js` | `domain/fund.ts`, `domain/status.ts` | Consolidate |
| `utils/{openExternal,openOnboarding}.js` | `platform/openExternal.ts` | Port |
| `utils/checkoutRedirect.js` | `features/payments/checkout.ts` | Port |
| `hooks/useAppConfig.js` | `features/app-update/useAppConfig.ts` | Port — keep route re-resolution |
| `styles/mobile/*.css` (16 files) | per-component `.module.css` | **Rewrite** — the source of every layout inconsistency |

### Admin

| Legacy file | Target | Action |
|---|---|---|
| `pages/Admin.jsx` | `app/routing/buildRouter.tsx` + `adminRoutes.ts` | Rewrite |
| `pages/legacy/legacyRoutes.jsx` | — | **Remove** — screens own their queries |
| `pages/{AdminLogin,AdminSplash,Forbidden,NotFound}.jsx` | `features/auth/*` | Rewrite |
| `pages/OverviewPage.jsx` | `features/admin/overview/OverviewScreen.tsx` | Rewrite |
| `screens/ApprovalsScreen.jsx` | `features/admin/applications/*` | Rewrite |
| `screens/{UserDetailsListScreen,UserDetailScreen}.jsx` | `features/admin/users/*` | Rewrite |
| `screens/fundOps/*` | `features/admin/funds/*` | Rewrite |
| `screens/FundStockListPanel.jsx` | `features/admin/funds/HoldingsEditor.tsx` | Rewrite |
| `screens/AumScreen.jsx` (601 lines, 4 tabs) | four screens under `features/admin/fund-aum/` | **Rewrite, split by route** |
| `screens/{FundAumPanel,FundAumHistoryPanel}.jsx`, `useAumHistory.js` | `features/admin/fund-aum/*` | Rewrite |
| `screens/ClientValuesScreen.jsx` (711 lines, 3 tabs) | three screens under `features/admin/client-values/` | **Rewrite, split by route** |
| `screens/FundReceiptScreen.jsx` (492 lines, 3 tabs) | `features/admin/receipts/*` + `features/admin/refunds/*` | **Rewrite, split by route** |
| `screens/PaymentsScreen.jsx` | `features/admin/payments/*` | Rewrite — server-side filtering |
| `screens/{MandatesScreen,MandateDetailScreen}.jsx` | `features/admin/mandates/*` | Rewrite — handle the conditional 404 |
| `screens/AuditLogScreen.jsx` | `features/admin/audit/*` | Rewrite |
| `screens/EmailDeliveriesScreen.jsx` | `features/admin/emails/*` | Rewrite |
| `screens/EnvironmentScreen.jsx` | a read-only panel in `features/admin/app-config/` | **Consolidate** |
| `screens/appBuilder/*` | `features/admin/app-config/*` | Rewrite |
| `features/site/*` | `features/admin/content/*` | Rewrite — **add the missing `Idempotency-Key`** |
| `data/adminResources.js` | per-feature `queries.ts` | Rewrite |
| `data/{fundContracts,mandateContracts}.js` | `@beonedge/contracts` schemas | **Remove** — replaced by generated validation |
| `data/{useFundMutations,useMandateMutations}.js` | per-feature `mutations.ts` | Rewrite |
| `data/ApprovalsQueueProvider.jsx` | `features/admin/applications/queries.ts` | Rewrite — polling via `refetchInterval` |
| `data/{AdminCacheEvictor,AdminReadError}.jsx` | `SessionProvider`, `AsyncBoundary` | Consolidate |
| `hooks/useAdminList.js` | `api/cursor.ts` + `useInfiniteQuery` | Consolidate — **three pagination implementations become one** |
| `helpers/loadAdminData.js` | — | **Remove** — the fixture path |
| `helpers/idempotencyKeys.js` | `api/idempotency.ts` | Port |
| `helpers/{formatters,signedAmounts,aumReasons}.js` | `domain/money.ts`, `domain/status.ts` | Consolidate |
| `fixtures/adminCollections.js` | — | **Remove** |
| `components/FormField.jsx` | `ui/primitives/FormField.tsx` | **Consolidate** — use the better a11y behaviour |
| `components/{StateBadge,ApprovalStatusBadge}.jsx` | `ui/patterns/StatusBadge.tsx` | Consolidate |
| `components/{SkeletonTableRow,SkeletonTile}.jsx` | `ui/primitives/Skeleton.tsx` | **Consolidate** — dimensions as props |
| `components/{EmptyTableRow}.jsx` | `ui/patterns/{EmptyState,AsyncBoundary}.tsx` | Consolidate |
| `components/DataTable.jsx` | `ui/patterns/DataList.tsx` | **Consolidate** — one screen used it; every other wrote raw tables |
| `components/{Toast,ToastProvider}.jsx` | `ui/primitives/Toast.tsx` + `ToastProvider` | Port — **promoted out of admin-only** |
| `components/{StatTile,HelpTooltip,I,IndeterminateCheckbox}.jsx` | `ui/patterns/StatCard.tsx`, `ui/primitives/{Tooltip,Checkbox}.tsx`, direct lucide imports | Consolidate |
| `layout/AdminShell.jsx` | `shells/admin/AdminFrame.tsx` | Rewrite |
| `layout/{Sidebar,TopBar,AdminMobileNav,AdminDomainStrip}.jsx` | `shells/admin/AdminNavigation.tsx` | Rewrite |
| `layout/Drawer.jsx` | `ui/primitives/Sheet.tsx` with a placement prop | Consolidate |
| `layout/PageHeading.jsx` | `app/layouts/PageHeader.tsx` | Rewrite — the context indirection goes away |
| `layout/primitives/PageHeader.jsx` | — | **Remove** — dead |
| `layout/primitives/{Page,Section,ContentGrid}.jsx` | `app/layouts/*` | Consolidate |
| `navigation/{nav,useAdminNavigation,backPolicy}.js` | `app/routing/adminRoutes.ts`, `shells/admin/adminBackPolicy.ts` | Rewrite |
| `styles/{admin,desktop}/*.css` (11 files) | per-component `.module.css` | **Rewrite** — `.ash-`/`.adm-` coexistence ends |

### Shared and tokens

| Legacy file | Target | Action |
|---|---|---|
| `shared/src/components/AsyncState.jsx` | `ui/patterns/AsyncBoundary.tsx` | Rewrite — **now used everywhere, including admin** |
| `shared/src/components/{EmptyState,ErrorState}.jsx` | `ui/patterns/*` | Rewrite |
| `shared/src/components/FormField.jsx` | `ui/primitives/FormField.tsx` | Rewrite — this is the version to keep |
| `shared/src/components/{MoneyValue,CurrencyCell}.jsx` | `ui/patterns/MoneyValue.tsx` | Consolidate |
| `shared/src/components/{DateCell,UserCell,ListRow}.jsx` | `ui/patterns/{DetailRow,DataList}.tsx` | Consolidate |
| `shared/src/components/Badges.jsx` | `ui/patterns/StatusBadge.tsx`, `ui/primitives/Badge.tsx` | Consolidate |
| `shared/src/components/Skeleton.jsx` | `ui/primitives/Skeleton.tsx` | Rewrite |
| `shared/src/components/{ErrorBoundary,RouteErrorBoundary}.jsx` | `app/routing/RouteErrorBoundary.tsx` | Port |
| `shared/src/components/BootstrapShell.jsx` | `app/layouts/AuthLayout.tsx` restoring state | Consolidate |
| `shared/src/components/StickyActionBar.jsx` | `ui/patterns/StickyActionBar.tsx` | Port |
| `shared/src/components/{DataFreshnessBadge,SectorMiniBar}.jsx` | `ui/primitives/Badge.tsx`, `ui/charts/*` | Consolidate |
| `shared/src/overlay/*` | `ui/primitives/{Dialog,Sheet}.tsx` + `OverlayStackProvider` | Port the hook, rewrite the markup |
| `shared/src/data/ResourceCacheProvider.jsx` | TanStack Query | **Remove** — replaced |
| `shared/src/{format,money,riskMapping}.js` | `domain/{money,dates,fund}.ts` | Consolidate |
| `shared/src/auth/roles.js` | `domain/permissions.ts` | Port |
| `shared/src/hooks/useBreakpoint.js` | `lib/useBreakpoint.ts` | Rewrite — reads the token, one source |
| `shared/src/motion/*` | tokens + CSS transitions | **Remove** — `PageTransition` is already inert and gsap is forbidden |
| `shared/src/net/{connectivity,launchGate}.js` | `app/providers/NetworkStatusProvider.tsx`, `features/auth/SplashScreen.tsx` | Port |
| `shared/src/platform/systemBarStyle.js` | `platform/systemChrome.ts` | Port |
| `shared/src/appConfig.js` | `features/app-update/appConfig.ts` + `features/admin/app-config/` | **Rewrite** — stop being a second transport |
| `shared/src/appTarget.js` | inline `import.meta.env` check | Consolidate |
| `shared/src/assets/logo.svg` | `src/assets/logo.svg` | Port — **the one canonical mark** |
| `shared/src/assets/logo-on-red.svg` | `src/assets/logo-on-red.svg` | Port — genuinely different |
| `shared/src/assets/{logo-mark,logo-on-dark}.svg` | — | **Remove** — md5-identical duplicates |
| `design-tokens/src/tokens-core.css` | `ui/tokens/tokens-core.css` | **Port verbatim** |
| `design-tokens/src/{tokens,kit,kit-core,fonts}.css` | `ui/tokens/*` | Port |
| `design-tokens/src/safeArea.test.js` | `ui/tokens/safeArea.test.ts` | Port |
| `design-tokens/src/{css,class,component,import,interaction}Contract.test.js` | `ui/` contract tests | Rewrite for CSS Modules — `classContract` becomes unnecessary, since CSS Modules make an undefined class a build error |
| `frontend_stack/colors_and_type.css` | — | **Remove** — an orphan outside every package |
| root `beonedge_logo.svg`, `frontend_stack/assets/beonedge_logo.svg`, both `.zip` files | — | **Remove** — duplicates and out-of-band deliverables |

### App shell

| Legacy file | Target | Action |
|---|---|---|
| `app/src/main.jsx` | `src/main.tsx` | Rewrite — preserve the single-import shape |
| `app/src/{ClientRoot,BrowserRoot}.jsx` | `src/shells/{client,admin}/*ShellRoot.tsx` | Rewrite |
| `app/src/NativeAppRoot.jsx` | `app/providers/AppProviders.tsx` | Rewrite — preserve the ordering contract |
| `app/src/platform/NativeBackCoordinator.jsx` | `app/native/NativeBackCoordinator.tsx` | Port — **and wire `onTransactionalBack`** |
| `app/src/platform/SystemBarsController.jsx` | `app/native/SystemBarsController.tsx` | Port |
| `app/src/platform/phonePeMobileCheckout.js` | `platform/phonePeMandateCheckout.ts` | Port — mandate setup only, per decision D1 |
| `app/scripts/*.mjs` | `scripts/*.mjs` | Port |
| `app/{Dockerfile,nginx.conf,capacitor.config.ts,index.html}` | root equivalents | Port |
| `app/android/**` | `android/**` | Port |
| `app/resources/launcher/**` | `resources/launcher/**` | Port |

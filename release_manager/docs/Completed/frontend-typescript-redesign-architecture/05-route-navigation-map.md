# 05 — Route and Navigation Map

## CURRENT — client routes

Route table is data-driven in `packages/client/src/navigation/routes.js` (`CLIENT_ROUTES`,
lines 58–304) and **separately hand-mounted** in `ClientApp.jsx:84-116`. Neither is generated
from the other, so they can and do disagree. All paths are children of `/app`, mounted under
`/app/*` by `app/src/ClientRoot.jsx`.

Auth column: `public` = `isPublic: true` in the manifest, short-circuited at
`ClientLayout.jsx:22-28`. `client` = requires `user` + `hasRole(user,'client')`
(`ClientLayout.jsx:38-48`). `client+eligible` = additionally wrapped in `RequireApproved`
(`ClientApp.jsx:56-75`).

| Path | Component | Auth | Reached by | Linked? |
|---|---|---|---|---|
| `/app` | redirect → `splash` | — | index | yes |
| `/app/splash` | `Splash.jsx` | public | index redirect | yes |
| `/app/login` | `Login.jsx` | public | `ClientLayout.jsx:40`, `Blocked.jsx:38`, `Profile.jsx:40` | yes |
| `/app/verify-email` | `EmailVerification.jsx` | client | `RequireApproved` redirect (`ClientApp.jsx:72`), `Dashboard.jsx:32`, `EmailVerificationDetail.jsx:127` | yes |
| `/app/start` | `Navigate` → `/app/dashboard` | client | alias only (`CLIENT_ROUTE_ALIASES`, routes.js:308) | **no** |
| `/app/dashboard` | `Dashboard.jsx` | client | bottom nav, `HOME_PATH` | yes |
| `/app/explore` | `Explore.jsx` | client | bottom nav, `Portfolio.jsx:9`, `Dashboard.jsx:31`, `EmailVerification.jsx:108`, `InvestorCharter.jsx:75`, `GrievanceRedressal.jsx:151` | yes |
| `/app/funds/:fundId` | `FundDetail.jsx` | client | `Explore.jsx:133,180`, `Dashboard.jsx:232`, `Portfolio.jsx:201` | yes |
| `/app/invest/sip/:fundId` | `StartSipSheet.jsx` | client+eligible | `FundDetail.jsx:471,580` | yes |
| `/app/invest/lumpsum/:fundId` | `LumpsumSheet.jsx` | client+eligible | `FundDetail.jsx:475,578` | yes |
| `/app/payment/:paymentId` | `PaymentStatus.jsx` | client+eligible | `Transactions.jsx:152`; programmatic from checkout | yes |
| `/app/mandates/:mandateId` | `MandateDetail.jsx` | client | **programmatic only** — `StartSipSheet.jsx:131,158,162`, always `{replace: true}` | **no declarative link anywhere** |
| `/app/portfolio` | `Portfolio.jsx` | client | bottom nav, `Dashboard.jsx:30`, `MandateDetail.jsx:149` | yes |
| `/app/transactions` | `Transactions.jsx` | client | bottom nav, `Portfolio.jsx:10`, `PaymentStatus.jsx:241,249` | yes |
| `/app/statements` | `Statements.jsx` | client | `Profile.jsx:19` | yes |
| `/app/notifications` | `Notifications.jsx` | client | `Profile.jsx:17` | yes |
| `/app/profile` | `Profile.jsx` | client | bottom nav | yes |
| `/app/profile/email-verification` | `EmailVerificationDetail.jsx` | client | `Profile.jsx:77` | yes |
| `/app/profile/security` | `Security.jsx` | client | `Profile.jsx:18` | yes |
| `/app/profile/support` | `Support.jsx` | client (`allowTerminalAccount: true`, routes.js:229) | `Profile.jsx:20`, `Blocked.jsx:33,36` | yes |
| `/app/profile/legal` | `Legal.jsx` | client | `Profile.jsx:21` | yes |
| `/app/investor-charter` | `InvestorCharter.jsx` | client | **only** a disclosure `investorCharterUrl` rendered by `DisclosureLink` on FundDetail | effectively no |
| `/app/grievance` | `GrievanceRedressal.jsx` | client | **only** a disclosure `grievanceUrl` (default at `disclosureApi.js:16`) | effectively no |
| `/app/*` | `NotFound.jsx` | client | fallback (`ClientApp.jsx:116`) | — |

### Defects in the current client route map

1. **`/app/mandates/:mandateId` is unreachable after the creating session.** It holds SIP
   pause, resume, cancel, mandate re-authorisation and "pay the due installment"
   (`MandateDetail.jsx:236-249`). Only `StartSipSheet` navigates there, always with
   `{replace: true}`. Neither Portfolio nor Transactions renders a link to a SIP plan. The
   route comment at `routes.js:159-161` even admits the path name is historical and there is
   no mandate. **This is the largest reachability hole in the product: real capability with no
   navigation to it.**
2. **The investing-unlock screen sits under Profile in the back hierarchy.** `ClientApp.jsx:86`
   mounts `verify-email` at the top level, but the manifest marks `verify_email` as a
   non-public child of `/app/profile` (routes.js:174-185). So Android Back from the screen a
   user was pushed to *while trying to invest* takes them to Profile, not back to the fund.
3. **`Legal.jsx` links to nothing.** `grep 'href|Link|charter|grievance'` in it returns zero
   matches. So the two regulatory screens have no entry point from the place a user would
   look, and are reachable only from a fund detail page.
4. **`/app/start` is a dead alias.** Nothing in the app produces that URL.
5. **The bottom nav is clean.** `BottomNav.jsx:29-33` builds all five tabs from the manifest
   via `buildPath()`, so no dead nav entries exist there — the historical `/app/orders` drift
   described in the `routes.js` header is gone.
6. **`backPolicy.js` is an adapter with no in-package consumer.** `resolveClientBackPolicy`
   (lines 20–52) is imported by the native back coordinator in `app/`. Nothing in
   `packages/client` calls it, so the manifest's `BACK_POLICY.TRANSACTIONAL` and
   `PRIMARY_TAB` values have no effect unless the host wires the coordinator.
7. **`Notifications.jsx:89` bypasses the destination trust boundary.** It passes a
   server-supplied `deepLink` straight to `navigate()` without `resolveInternalPath()` — the
   very resolver the route manifest exists to provide. `GrievanceRedressal.jsx` is the one
   screen that uses it correctly.

## CURRENT — admin routes

Mount chain: `app/src/main.jsx` → `BrowserRoot.jsx` (default target) → `RequireAdmin` →
`Admin.jsx` → `AdminShell` layout route → screens, each wrapped by
`pages/legacy/legacyRoutes.jsx`.

Guards: `BrowserRoot.RequireAdmin` (`RESTORING` → `BootstrapShell`; no user →
`/admin/login?from=`; user without the `admin` role → `/admin/login`), then `Admin.jsx`'s
`Permitted` wrapper calling `canAccessPath(user, pathname)` from `navigation/nav.js`.

Above the shell:

| Path | Component | Auth |
|---|---|---|
| `/` | `Navigate` → `/admin/splash` | none |
| `/admin/splash` | `AdminSplash` | none |
| `/admin/login` | `AdminLogin` | none |
| `/admin/*` | `Admin` inside `RequireAdmin` | session + `admin` role |
| `*` | `NotFound standalone` | none |

Inside the shell. Permissions are **any-of** via `hasAnyPermission`, plus all-of `requiresAll`.

| Path | Screen | Permission (any-of) / requiresAll |
|---|---|---|
| `/admin` | → `/admin/overview` | — |
| `/admin/overview` | `OverviewPage` | `[]` — any admin |
| `/admin/users/approvals` | `ApprovalsScreen` | `applications.read` |
| `/admin/users/directory` | `UserDetailsListScreen` | `users.read`, `users.read_limited` |
| `/admin/users/directory/:userId` | `UserDetailScreen` | prefix-inherited |
| `/admin/funds` | `FundsListScreen` | `funds.read` |
| `/admin/funds/new` | `FundCreateScreen` | override: `funds.write` + requiresAll `funds.write`,`aum.write` |
| `/admin/funds/:fundId` | `FundWorkspace` | prefix-inherits `funds.read` |
| `/admin/funds-received` | → `…/awaiting` | — |
| `/admin/funds-received/awaiting` | `FundReceiptScreen tab="awaiting"` | `funds.receipts.read` |
| `/admin/funds-received/acknowledged` | `FundReceiptScreen tab="acknowledged"` | `funds.receipts.read` |
| `/admin/funds-received/refunds` | `FundReceiptScreen tab="refunds"` | `funds.receipts.read`, `refunds.write` |
| `/admin/client-values` | → `…/detail` | — |
| `/admin/client-values/detail` | `ClientValuesScreen tab="detail"` | `client_values.read`, `users.read`, `users.read_limited` |
| `/admin/client-values/individual` | `ClientValuesScreen tab="individual"` | `client_growth.write` |
| `/admin/client-values/collective` | `ClientValuesScreen tab="collective"` | `client_growth.write` |
| `/admin/aum` | `AumEntryRedirect` → `aumEntryPathFor(user)` | — |
| `/admin/aum/current` | `AumScreen tab="current"` | `aum.read` + requiresAll `funds.read` |
| `/admin/aum/manage` | `AumScreen tab="manage"` | `aum.write` + requiresAll `funds.read`,`aum.read` |
| `/admin/aum/collective` | `AumScreen tab="collective"` | `aum.write` + requiresAll `funds.read` |
| `/admin/aum/history` | `AumScreen tab="history"` | `aum.read` + requiresAll `funds.read` |
| `/admin/payments` | `PaymentsScreen` | `payments.read` |
| `/admin/payments/mandates` | `MandatesScreen` | `payments.read` |
| `/admin/payments/mandates/:mandateId` | `MandateDetailScreen` | `payments.read`; writes need `finance.operate` |
| `/admin/audit` | `AuditLogScreen` | `audit.read` |
| `/admin/site/faqs` | `FaqsPage` — the only route not wrapped by `legacyRoutes.jsx` | `content.read`, `content.publish` |
| `/admin/app/builder` | `AppBuilderScreen` | `config.read`, `config.publish` |
| `/admin/system/emails` | `EmailDeliveriesScreen` | `email_deliveries.read`, `email_deliveries.read_masked` |
| `/admin/system/environment` | `EnvironmentScreen` | `config.read`, `config.publish` |
| `/admin/*` | `NotFound` in-shell | — |

### Findings on the admin route map

- **Nothing is unreachable.** Every `NAV_DOMAINS` item maps to a mounted route and every
  mounted route except the two `:id` details, the three redirects and `/admin/funds/new` is a
  nav item. Route aliases and `legacyTabMap.js` were genuinely removed by commit `a356b15`.
- **`pages/legacy/legacyRoutes.jsx` is live and load-bearing despite the name.**
  `Admin.jsx:6-22` imports 17 route wrappers from it, and it owns every one of the 18
  `React.lazy` code-split boundaries plus all the data fetching and prop drilling. Removing it
  breaks every route except `/admin/site/faqs`. "Legacy" here means "screens take props
  instead of calling hooks" — a container layer, not dead code.
- **Any-of permissions leak write affordances to read-only principals.**
  `/admin/site/faqs` opens for `content.read` alone and `/admin/system/environment` for
  `config.read` alone, so a read-only admin sees the App Builder's Publish button.
  `NEEDS RUNTIME VERIFICATION` whether the backend refuses the write.
- **Two live backend capabilities have no route at all**: user suspend/reinstate/close and
  user login-event history.

## TARGET — canonical client route map

Design rules applied:

- One route manifest, and the router is **generated from it**, so drift is structurally
  impossible rather than caught by a test.
- The path expresses the domain, not the history. `/app/mandates/:id` becomes
  `/app/sips/:sipPlanId`, because the entity is a SIP plan.
- Every route with real capability has at least one declarative link.
- The back parent is declared, not inferred from history.
- Investing gates redirect to a screen whose back parent is the fund the user came from.

| Path | Screen | Auth | Nav entry | Back parent |
|---|---|---|---|---|
| `/` | → `/splash` | — | — | — |
| `/splash` | `Splash` | public | — | — |
| `/login` | `Login` | public | — | — |
| `/verify-email` | `EmailVerification` | client | prompted from Dashboard and from any gate | `returnTo` param, default `/dashboard` |
| `/dashboard` | `Dashboard` | client | **tab 1** | exit |
| `/funds` | `FundList` | client | **tab 2** | `/dashboard` |
| `/funds/:fundId` | `FundDetail` | client | from `/funds`, Dashboard, Portfolio | `/funds` |
| `/funds/:fundId/invest/lumpsum` | `LumpsumInvest` | client + eligible | from `FundDetail` | `/funds/:fundId` |
| `/funds/:fundId/invest/sip` | `SipStart` | client + eligible | from `FundDetail` | `/funds/:fundId` |
| `/portfolio` | `Portfolio` | client | **tab 3** | `/dashboard` |
| `/activity` | `Activity` | client | **tab 4** | `/dashboard` |
| `/activity/payments/:paymentId` | `PaymentStatus` | client + eligible | from `/activity`, from checkout return, from pending-payment recovery | `/activity` |
| `/sips` | `SipList` | client | from Portfolio **and** from Dashboard | `/portfolio` |
| `/sips/:sipPlanId` | `SipDetail` | client | **from `/sips`** — this is the fix | `/sips` |
| `/statements` | `Statements` | client | from Profile | `/profile` |
| `/notifications` | `Notifications` | client | from Profile **and** a header bell | `/dashboard` |
| `/profile` | `Profile` | client | **tab 5** | `/dashboard` |
| `/profile/email-verification` | `EmailVerificationStatus` | client | from Profile | `/profile` |
| `/profile/security` | `DeviceSecurity` | client | from Profile | `/profile` |
| `/profile/support` | `Support` | client, `allowTerminalAccount` | from Profile, from Blocked | `/profile` |
| `/profile/legal` | `Legal` | client | from Profile | `/profile` |
| `/profile/legal/investor-charter` | `InvestorCharter` | client | **from Legal** and from fund disclosures | `/profile/legal` |
| `/profile/legal/grievance` | `Grievance` | client | **from Legal** and from fund disclosures | `/profile/legal` |
| `*` | `NotFound` | client | — | `/dashboard` |

Changes from current, each with a reason:

| Change | Reason |
|---|---|
| `/app/*` prefix dropped | The client build serves only the client app; the prefix is a leftover from a shared shell |
| `/app/mandates/:mandateId` → `/sips/:sipPlanId` | The entity is a SIP plan. The route comment already admits the old name is historical |
| **New `/sips` list screen** | Gives SIP detail a real parent and a real nav entry — fixes the largest reachability hole |
| `/app/transactions` → `/activity` | The screen already shows both the value ledger and the payment queue; "transactions" understates it |
| `/app/payment/:id` → `/activity/payments/:paymentId` | Declared parent so Back is correct from a checkout return |
| `/app/invest/{sip,lumpsum}/:fundId` → `/funds/:fundId/invest/{sip,lumpsum}` | The parent is the fund; the URL should say so |
| `/app/investor-charter`, `/app/grievance` → children of `/profile/legal` | Gives them the entry point they lack |
| `/app/verify-email` back parent becomes a `returnTo` param | So Back from the investing gate returns to the fund |
| `/app/start` removed | Dead alias |
| `/app/profile/email-verification` retained but reduced | Status only; the action lives on `/verify-email` |

**No old client URL needs preserving.** There are no deep links (the only Android intent
filter is `MAIN`/`LAUNCHER`, and `custom_url_scheme` is declared but unconsumed), no App Links
`assetlinks`, no backend redirects to frontend paths, and PhonePe is sent `redirectUrl: null`.
The one thing that must keep working is the **pending-payment recovery** path, which resolves
a `paymentId` from `localStorage` — and that is a client-side navigation, so it moves with the
route map.

## TARGET — canonical admin route map

Design rules: domain-first paths, no tab state hidden in a prop, permissions declared once,
and every write affordance gated on the write permission rather than the read one.

| Path | Screen | Permission |
|---|---|---|
| `/` | → `/splash` | — |
| `/splash` | `AdminSplash` | public |
| `/login` | `AdminLogin` | public |
| `/overview` | `Overview` | any admin |
| `/applications` | `ApplicationQueue` | `applications.read` |
| `/applications/:applicationId` | `ApplicationDetail` | `applications.read` |
| `/users` | `UserDirectory` | `users.read`, `users.read_limited` |
| `/users/:userId` | `UserDetail` | `users.read`, `users.read_limited` |
| `/users/:userId/login-events` | `UserLoginEvents` | `users.read` — **new, backend already exists** |
| `/funds` | `FundList` | `funds.read` |
| `/funds/new` | `FundCreate` | `funds.write` + all of `funds.write`,`aum.write` |
| `/funds/:fundId` | `FundWorkspace` | `funds.read` |
| `/funds/:fundId/holdings` | `FundHoldings` | `funds.read`; writes `funds.write` |
| `/funds/:fundId/aum` | `FundAum` | `aum.read`; writes `aum.write` |
| `/funds/:fundId/aum/history` | `FundAumHistory` | `aum.read` |
| `/aum` | `AumOverview` | `aum.read` + all of `funds.read` |
| `/aum/collective` | `CollectiveAumGrowth` | `aum.write` |
| `/client-values` | `ClientPositions` | `client_values.read`, `users.read`, `users.read_limited` |
| `/client-values/individual` | `IndividualClientGrowth` | `client_growth.write` |
| `/client-values/collective` | `CollectiveClientGrowth` | `client_growth.write` |
| `/receipts` | `FundReceiptQueue` | `funds.receipts.read` |
| `/receipts/:orderId` | `FundReceiptDetail` | `funds.receipts.read`; ack `funds.receipts.write` |
| `/refunds` | `RefundQueue` | `refunds.write` |
| `/payments` | `PaymentEvidence` | `payments.read` |
| `/mandates` | `MandateList` | `payments.read` |
| `/mandates/:mandateId` | `MandateDetail` | `payments.read`; writes `finance.operate` |
| `/audit` | `AuditLog` | `audit.read` |
| `/emails` | `EmailDeliveries` | `email_deliveries.read`, `email_deliveries.read_masked` |
| `/content/faqs` | `FaqList` | `content.read`; writes `content.publish` |
| `/app-config` | `AppConfigBuilder` | `config.read`; publish `config.publish` |
| `*` | `NotFound` | — |

Changes from current:

| Change | Reason |
|---|---|
| `/admin` prefix dropped | The admin image is a separate deployable on its own host; the prefix is redundant |
| `/admin/users/approvals` → `/applications` | It is an application queue, and it removes the last KYC-adjacent path (`Admin.test.jsx:105` still asserts `/admin/users/kyc`) |
| **New `/applications/:applicationId`** | The backend has a detail endpoint; the legacy console only expands a row |
| `/admin/users/directory` → `/users` | "directory" is a UI word |
| **New `/users/:userId/login-events`** | `GET /v1/admin/users/:id/login-events` exists with no caller |
| `?tab=` props → real routes | `AumScreen`, `ClientValuesScreen` and `FundReceiptScreen` are each one component with three or four tab props (601, 711 and 492 lines). Splitting them by route makes each screen small and each permission explicit |
| AUM per-fund panels become fund children | `FundAumPanel` and `FundAumHistoryPanel` are mounted from `FundWorkspace` today but addressed nowhere |
| `/admin/funds-received/refunds` → `/refunds` | Refunds are not fund receipts; they only shared a screen |
| `/admin/system/environment` **removed** | It reads the same `GET /v1/admin/app-config` as App Builder and says so in its own copy. Fold it in as a read-only panel |
| `/admin/site/faqs` → `/content/faqs` | `site` was the wider CMS that no longer exists; `styles/desktop/site.css` is its last remnant |
| `/admin/payments/mandates` → `/mandates` | Mandates are a domain, not a payments sub-tab, and they are conditionally registered — they need their own "not configured" state |
| **Suspend / reinstate / close** surfaced on `/users/:userId` | `VERIFY` first: the backend capability exists and the permissions are in the DB but absent from `nav.js` |

## Navigation models

### Client — mobile (APK and narrow browser)

```
┌──────────────────────────────────────┐
│  header: title · bell · optional back│  respects --be-safe-top
├──────────────────────────────────────┤
│                                      │
│  scrollable content                  │  padding-bottom reserves nav + --be-safe-bottom
│                                      │
├──────────────────────────────────────┤
│  Home · Funds · Portfolio · Activity · Profile │  respects --be-safe-bottom
└──────────────────────────────────────┘
```

Five tabs, matching the legacy set. Sheets slide from the bottom. Back follows the five-rule
coordinator.

### Client — wide browser (≥1024px)

Same five destinations, presented as a **top navigation bar** with a centred content
container. No sidebar — five destinations do not justify one, and a sidebar would make the
browser and APK layouts structurally different for no gain. Sheets become centred dialogs.
Lists gain a second column where the data supports it.

### Admin — desktop (≥1024px)

```
┌────────────┬─────────────────────────────────────┐
│ sidebar    │ topbar: title · breadcrumbs · logout│
│ domains    ├─────────────────────────────────────┤
│ + items    │ content, max-width container        │
│ approvals  │ tables, panels, drawers             │
│ badge      │                                     │
└────────────┴─────────────────────────────────────┘
```

### Admin — mobile (< 1024px, including the admin APK)

```
┌──────────────────────────────────────┐
│ topbar: title · logout               │
├──────────────────────────────────────┤
│ domain strip: sibling links          │  only when the domain has siblings
├──────────────────────────────────────┤
│ content — tables render as cards     │
├──────────────────────────────────────┤
│ Overview · Applications · Funds · Money · More │
└──────────────────────────────────────┘
```

"More" opens a sheet listing the remaining permitted destinations. This mirrors the legacy
`AdminMobileNav` + `AdminDomainStrip` model, which is sound — the problem was never the IA, it
was that `admin-responsive.css` still styles the sidebar IA that was abandoned.

## Navigation integrity requirements

The target must guarantee, and the tests in [12](12-risk-regression-test-plan.md) must prove:

1. **Every route in the manifest is mounted, and every mounted route is in the manifest.**
   Achieved structurally by generating the router from the manifest, not by a drift test.
2. **Every route with a write capability has at least one declarative link from a permitted
   surface.** A test walks the manifest and asserts each non-index, non-detail route is
   referenced by a nav entry or by another screen's link map.
3. **Every nav entry resolves to a mounted route.** Same walk, opposite direction.
4. **No server-supplied destination reaches the router unresolved.** Every path that can
   originate from remote content — notification `deepLink`, app-config quick-action `route`,
   disclosure `investorCharterUrl` / `grievanceUrl`, grievance escalation `destination` —
   must pass through one resolver that returns a discriminated
   `{kind: 'internal' | 'external' | 'email' | 'phone' | 'refused'}`. `javascript:`, `data:`,
   cleartext `http:`, protocol-relative `//host`, and the WebView's own `https://localhost`
   origin are all refused. The legacy code has this resolver and uses it in three of four
   places; the new frontend must use it in all four.
5. **Every route declares a back parent**, so the Android Back coordinator never has to guess.
6. **Permission-gated routes render a Forbidden state, not a blank screen**, and the client
   guard is UX only — the backend re-enforces every permission.
7. **A conditionally-registered endpoint's 404 renders as "not configured in this
   environment"**, distinctly from "not found". This applies to all mandate admin routes.

# Task 025 — Fluid desktop layout, and admin navigation completeness

**Log entry:** [`LOGS/implementation_log.md` Entry 035](../LOGS/implementation_log.md)
**Decisions:** [D-059](../LOGS/risk_and_decision.md#d-059) · [D-060](../LOGS/risk_and_decision.md#d-060) · [D-061](../LOGS/risk_and_decision.md#d-061) · [D-062](../LOGS/risk_and_decision.md#d-062) · [D-063](../LOGS/risk_and_decision.md#d-063)
**Scope:** targeted. The two-column admin detail layout with a sticky summary rail is explicitly **not** in this pass.

## What was asked

Two things, stated as separate problems.

1. The web UI "feels like a mobile application that has simply been allowed to stretch across a desktop
   browser". Make the client and admin desktop surfaces feel purpose-built, without redesigning the
   phone UI — the phone design is already acceptable and must not move.
2. The admin APK/mobile surface has incomplete navigation, so some pages are hard or impossible to reach.
   Fix reachability using the existing navigation language, not a visual redesign.

Plus a route-reachability audit of both shells before declaring completion.

## What was actually wrong

The token caps were the smaller half. The larger finding, from a full survey of both surfaces:

**There was not one `xl:` prefix anywhere in `src/`.** Every responsive ladder in the codebase stopped
at `lg` (1024 px). So widening the caps alone would have made the stretching worse, not better — the
entire 1024→2560 px range had no composition rules at all.

Concretely, at a 1920 px browser:

| Symptom | Mechanism |
|---|---|
| 13 label→value rows with ~2000 px of void between label and value | `LIST_ROW` is `flex justify-between`, used by every `DataList` and by `FundWorkspaceScreen`'s local `Row` |
| A 1500 px-wide subject field and textarea | `SupportScreen` declares `Page width="default"` while `Input`/`Textarea` are `w-full` with no measure |
| 1600 px-wide parchment slab containing a 52ch paragraph | `STATE_PANEL` re-declared `max-w-content`, so `EmptyState`/`ErrorState` inherited the widening on every list screen |
| A 176 px donut beside a ~2000 px single-column legend | `DONUT_FIGURE` is `md:w-44 md:flex-none` with no `lg`/`xl` step; `LEGEND_ROOT` is `md:flex-1` |
| A ~1085 px-wide date input | `ADMIN_FORM_GRID` frozen at `lg:grid-cols-2`, 13 call sites |
| Six client lists as single columns of full-width cards | `CARD_STACK`/`SIP_LIST` with no breakpoint classes |

And for navigation: `AdminFrame` rendered `permitted.slice(0, 5)`, so **nine of fourteen admin
destinations had no phone path at all** — including every money screen and every system screen. The
admin APK has no sidebar to fall back on, so on a device those nine were simply gone.

## What changed

### Tokens — `src/ui/tokens/tokens-core.css`

```css
--be-content-max:      clamp(60rem, 82vw, 100rem);
--be-content-max-wide: clamp(80rem, 90vw, 150rem);
--be-content-max-form: 35rem;
--be-page-pad-x-lg:    clamp(var(--be-space-7), 2vw, var(--be-space-10));
```

Computed width by viewport, client / admin inner:

| Viewport | Client content | Admin content | Padding at `lg` |
|---|---|---|---|
| ≤ 1023 | 960 (never binds) | 1280 (never binds) | 32 (not read below `lg`) |
| 1024 | 960 | 1024 − 264 sidebar | 32 |
| 1366 | 1120 | 1102 | 32 |
| 1920 | 1574 | 1656 | 38 |
| 2560 | 1600 (capped) | 2194 | 51 |
| 3840 | 1600 | 2400 (capped) | 64 |

The admin sidebar is a fixed 264 px, so admin content is `100vw − 264px` and the 90vw cap only binds
above a ~2640 px viewport.

### Shared recipes and patterns

| File | Constant | Change |
|---|---|---|
| `ui/recipes/datalist.ts` | `LIST_ROW` | + `lg:grid lg:max-w-[44rem] lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-6` |
| | `LIST_VALUE` | + `lg:text-left` |
| | `LIST_SPLIT` | new — `lg:grid lg:grid-cols-2 lg:gap-x-12` |
| `ui/recipes/layout.ts` | `CARD_COLUMNS` | new — `{2,3}`, `lg:`/`xl:` only |
| | `CARD_COLUMNS_WRAP` | new — `contents` + the above |
| | `FEED_MEASURE` | new — `lg:max-w-[68rem]` |
| | `FIELD_MEASURE` | new — `lg:max-w-[38rem]` |
| `ui/recipes/state.ts` | `STATE_PANEL` | − `max-w-content`, + `lg:max-w-[46rem]` |
| `ui/recipes/chart.ts` | `DONUT_WRAP` | + `lg:items-start lg:gap-10` |
| | `DONUT_FIGURE` | + `lg:w-56 xl:w-64` |
| | `LEGEND_ROOT` | + `lg:grid lg:grid-cols-2 lg:gap-x-10 xl:grid-cols-3` |
| | `DONUT_CENTRE_VALUE` | + `xl:text-2xl` |
| `ui/recipes/admin.ts` | `ADMIN_FORM_GRID` | + `lg:max-w-[72rem]`, + `xl:grid-cols-3` |
| `ui/recipes/shellAdmin.ts` | `ADMIN_TOPBAR` | `lg:px-10` → `lg:px-[max(var(--be-page-pad-x-lg),var(--be-safe-right))]` |
| | `ADMIN_NAV_MORE`, `ADMIN_MORE_GROUP`, `ADMIN_MORE_GROUP_LABEL`, `ADMIN_MORE_LIST`, `ADMIN_MORE_LINK` | new |
| `features/activity/activity.recipe.ts` | `ROW`, `ROW_LEFT`, `ROW_RIGHT` | + `lg:` horizontal composition |
| `ui/patterns/DataList.tsx` | — | optional `split` prop applying `LIST_SPLIT` |
| `app/routing/routeManifest.ts` | — | `navGroups()`, `navBarEntries()`, `NavGroup` |
| `app/routing/adminRoutes.ts` | `ADMIN_NAV_DOMAINS` | new, eight domain labels |

### Which screens each shared change reaches

- `LIST_ROW` / `LIST_VALUE` → every `DataList` and `DetailRow`: client `Profile`, `PaymentStatus`,
  `SipDetail`, `VerificationStatus`; admin `UserDetail`, `MandateDetail`, `ApplicationDetail` (×2),
  `FundReceiptDetail` (×2), `AppConfigBuilder` (×2), `IndividualClientGrowth`; plus
  `FundWorkspaceScreen`'s local `Row`.
- `STATE_PANEL` → every `EmptyState` and `ErrorState`, i.e. every list screen in both shells.
- `ADMIN_FORM_GRID` → `FundTermsForm`, `FundCreate`, `FundHoldings` (×2), `FaqList`, `FundAum` (×2),
  `CollectiveAumGrowth`, `CollectiveClientGrowth` (×2), `IndividualClientGrowth` (×2) — 13 sites.
- chart recipes → client `FundDetailScreen`, admin `FundHoldingsScreen`.
- `ADMIN_TOPBAR` → the whole admin shell.

### Screen-level desktop compositions

| Screen | Desktop change | Why this and not something else |
|---|---|---|
| `NotificationsScreen` | `CARD_COLUMNS[3]` | independent cards, unbounded count, prose already 64ch |
| `StatementsScreen` | `CARD_COLUMNS[2]` | each card holds a 4-column flow row; 3 columns would crush it |
| `SipListScreen` | `CARD_COLUMNS[2]` | each card holds a 4-column summary; and a 2-plan account must not look broken |
| `SupportScreen` | `FIELD_MEASURE` on the form stack, `CARD_COLUMNS[2]` on tickets | the form was the only place a control itself stretched |
| `ActivityScreen` | `FEED_MEASURE`, rows horizontal at `lg` | chronological order is the point, so it stays one column |
| `PortfolioScreen` | `CARD_COLUMNS_WRAP[3]` on positions | fixes `POOL_META`'s `1fr` value column as a side effect |
| admin `FundListScreen` | `CARD_COLUMNS_WRAP[3]` | independent fund cards |
| admin `FundAumScreen` | `CARD_COLUMNS_WRAP[3]` on history | independent snapshot cards |
| admin `UserDetail`, `MandateDetail`, `FundReceiptDetail`, `ApplicationDetail` | `<DataList split>` | 11, 12, 11 and 7 rows on wide pages |

### Kept single-column, deliberately

- **Activity, both tabs** — a feed. Reading order is chronological; a grid makes the eye jump.
- **Every `width="form"` page** (`LumpsumInvest`, `SipStart`, `PaymentStatus`, `EmailVerification`,
  `VerificationStatus`, `DeviceSecurity`, `NotFound`) — 560 px page, two columns would be cramped.
- **`ProfileScreen`'s identity `DataList`** — 3 rows.
- **`AppConfigBuilder` and `IndividualClientGrowth` `DataList`s** — 4, 3 and 6 rows.
- **`FundWorkspaceScreen`'s "Current state"** — 7 rows, and it is a local `Row` inside `Section` rather
  than a `DataList`, so `split` does not apply. The `LIST_ROW` measure handles the stretch.
- **`ADMIN_SUMMARY_GRID` (4) and `ContentGrid` (2/3/4)** — semantic maxima, per instruction. Overview
  renders exactly 4 queue tiles; `CollectiveAumGrowth` renders 3 Stats. More columns would add empty
  cells.

### Admin mobile navigation

Bar: **Overview · Applications · Funds · Receipts · More**, from `navBarEntries(permitted, 4)`.
"More" opens a `Modal` titled "All sections" listing every permitted destination grouped by domain
(`Money`: Receipts, Refunds, Payments, Mandates · `System`: Audit, Emails, FAQs, App config ·
single-entry domains unheaded). The sheet closes on route change and on hardware Back.

`Modal` rather than `Sheet` because only `Modal` registers with `OverlayStackProvider`, which is what
makes Android Back dismiss the overlay instead of navigating. See D-063.

### Client mobile navigation

**Unchanged.** The audit found it already complete: all five tabs render in both the bottom nav and the
desktop island, and every non-tab screen has a rendered inbound link.

## Route reachability matrix

Desktop = sidebar (admin) or top-nav island (client). Mobile = bottom bar or More sheet. "Reachable
from" lists components that render a link, measured from source, not from `ADMIN_LINK_MAP`.

### Client — 24 routes, 5 nav entries, 0 orphans

| Route | Screen | Desktop | Mobile | Reachable from | Issue / action |
|---|---|---|---|---|---|
| `/splash` | `auth/SplashScreen` | — | — | boot | public |
| `/login` | `auth/LoginScreen` | — | — | boot, sign-out, `BlockedScreen` | public |
| `/blocked` | `auth/BlockedScreen` | — | — | guard redirect | intended |
| `/verify-email` | `email-verification/EmailVerificationScreen` | — | — | guard redirect, `Dashboard` | intended |
| `/dashboard` | `dashboard/DashboardScreen` | top nav | bottom bar | nav | — |
| `/funds` | `funds/FundListScreen` | top nav | bottom bar | nav, Dashboard, Portfolio, Activity, SipList | — |
| `/funds/:fundId` | `funds/FundDetailScreen` | — | — | FundList, FundTable, Dashboard, Portfolio, Activity, PaymentStatus | — |
| `/funds/:fundId/invest/lumpsum` | `orders/LumpsumInvestScreen` | — | — | FundDetail | — |
| `/funds/:fundId/invest/sip` | `sip/SipStartScreen` | — | — | FundDetail | — |
| `/portfolio` | `portfolio/PortfolioScreen` | top nav | bottom bar | nav, Dashboard, PaymentStatus | — |
| `/activity` | `activity/ActivityScreen` | top nav | bottom bar | nav, LumpsumInvest, PaymentStatus, SipDetail | — |
| `/activity/payments/:paymentId` | `payments/PaymentStatusScreen` | — | — | Activity, LumpsumInvest | — |
| `/sips` | `sip/SipListScreen` | — | — | Dashboard, Portfolio, SipDetail | — |
| `/sips/:sipPlanId` | `sip/SipDetailScreen` | — | — | SipList, SipStart | — |
| `/statements` | `statements/StatementsScreen` | — | — | Profile | — |
| `/notifications` | `notifications/NotificationsScreen` | — | — | `ClientFrame` bell (both shells), Profile | — |
| `/profile` | `profile/ProfileScreen` | top nav | bottom bar | nav | — |
| `/profile/email-verification` | `email-verification/VerificationStatusScreen` | — | — | Profile | — |
| `/profile/security` | `device-security/DeviceSecurityScreen` | — | — | Profile | — |
| `/profile/support` | `support/SupportScreen` | — | — | Profile, Blocked, PaymentStatus, VerificationStatus, Grievance | — |
| `/profile/legal` | `legal/LegalScreen` | — | — | Profile | — |
| `/profile/legal/investor-charter` | `legal/InvestorCharterScreen` | — | — | Legal, FundDetail | — |
| `/profile/legal/grievance` | `legal/GrievanceScreen` | — | — | Legal, FundDetail | — |
| `*` | `auth/NotFoundScreen` | — | — | catch-all | — |

### Admin — 30 routes, 14 nav entries, 0 orphans

| Route | Screen | Desktop | Mobile (before) | Mobile (now) | Reachable from | Issue / action |
|---|---|---|---|---|---|---|
| `/splash` | `auth/SplashScreen` | — | — | — | boot | public |
| `/login` | `auth/LoginScreen` | — | — | — | boot, sign-out | public |
| `/overview` | `overview/OverviewScreen` | sidebar | bottom bar | bottom bar | nav | — |
| `/applications` | `applications/ApplicationQueueScreen` | sidebar | bottom bar | bottom bar | nav, Overview, ApplicationDetail | — |
| `/applications/:applicationId` | `applications/ApplicationDetailScreen` | — | — | — | ApplicationQueue | — |
| `/users` | `users/UserDirectoryScreen` | sidebar | bottom bar | **More sheet** | nav, Overview | moved out of the bar to free a slot; still one tap |
| `/users/:userId` | `users/UserDetailScreen` | — | — | — | UserDirectory | — |
| `/users/:userId/login-events` | `users/UserLoginEventsScreen` | — | — | — | UserDetail | — |
| `/funds` | `funds/FundListScreen` | sidebar | bottom bar | bottom bar | nav, Overview | — |
| `/funds/new` | `funds/FundCreateScreen` | — | — | — | FundList, AumOverview | — |
| `/funds/:fundId` | `funds/FundWorkspaceScreen` | — | — | — | FundList, FundCreate | — |
| `/funds/:fundId/holdings` | `funds/FundHoldingsScreen` | — | — | — | **FundWorkspace (added)** | **was unreachable — no inbound link anywhere; declared in `ADMIN_LINK_MAP` but never rendered** |
| `/funds/:fundId/aum` | `fund-aum/FundAumScreen` | — | — | — | FundWorkspace, AumOverview | — |
| `/funds/:fundId/aum/history` | `fund-aum/FundAumHistoryScreen` | — | — | — | AumOverview | — |
| `/aum` | `fund-aum/AumOverviewScreen` | sidebar | bottom bar | **More sheet** | nav | as `/users` |
| `/aum/collective` | `fund-aum/CollectiveAumGrowthScreen` | — | — | — | AumOverview | — |
| `/client-values` | `client-values/ClientPositionsScreen` | sidebar | **none** | **More sheet** | nav | **fixed** |
| `/client-values/individual` | `client-values/IndividualClientGrowthScreen` | — | via parent | via parent | ClientPositions | parent was unreachable on mobile; now reachable |
| `/client-values/collective` | `client-values/CollectiveClientGrowthScreen` | — | via parent | via parent | ClientPositions | as above |
| `/receipts` | `receipts/FundReceiptQueueScreen` | sidebar | **none** | **bottom bar** | nav, Overview | **fixed** — `primary: true` now drives the bar |
| `/receipts/:orderId` | `receipts/FundReceiptDetailScreen` | — | via parent | via parent | FundReceiptQueue | — |
| `/refunds` | `refunds/RefundQueueScreen` | sidebar | **none** | **More sheet** | nav, domain strip | **fixed** |
| `/payments` | `payments/PaymentEvidenceScreen` | sidebar | **none** | **More sheet** | nav, Overview, domain strip | **fixed** |
| `/mandates` | `mandates/MandateListScreen` | sidebar | **none** | **More sheet** | nav, domain strip | **fixed** |
| `/mandates/:mandateId` | `mandates/MandateDetailScreen` | — | via parent | via parent | MandateList | — |
| `/audit` | `audit/AuditLogScreen` | sidebar | **none** | **More sheet** | nav, Overview, domain strip | **fixed** |
| `/emails` | `emails/EmailDeliveriesScreen` | sidebar | **none** | **More sheet** | nav, domain strip | **fixed** |
| `/content/faqs` | `content/FaqListScreen` | sidebar | **none** | **More sheet** | nav, domain strip | **fixed** |
| `/app-config` | `app-config/AppConfigBuilderScreen` | sidebar | **none** | **More sheet** | nav, domain strip | **fixed** |
| `*` | `auth/NotFoundScreen` | — | — | — | catch-all | — |

Nine destinations had no phone path before this pass; all nine now have one. No route was removed.

**Reproducing the audit.** There is no committed script — it is a throwaway. Resolve each manifest
`path`, substituting the exported `*_PATH` constants, then scan `src/**/*.ts{,x}` for
`to=`, `to:` or `navigate(` targeting that path, with `${...}` matching any `:param` segment. Scope the
scan so `src/features/admin/**` is only credited to the admin manifest and the rest of `src/features/**`
only to the client manifest, since both manifests declare `/funds` and `/funds/:fundId`. Ignore the
`*_ROUTES.ts` files themselves. Treat `CLIENT_GUARD_DESTINATIONS` / `ADMIN_GUARD_DESTINATIONS` and
`access: "public"` as reachable by definition.

## Verification

All **TESTED** on this machine unless marked otherwise.

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm test` | 20 files, 197 tests, all pass |
| `npm run generate:api:check` | 101 operations, no drift |
| `npm run build` + `check-bundle-boots` | 7 chunks, no throw; CSS 85.68 kB / 640 kB |
| `npm run build:android` | `check-android-dist` client: 16 assets, 849 253 B / 2 600 000 |
| `npm run build:android:admin` | `check-android-dist` admin: 16 assets, 870 773 B / 2 600 000 |
| `check-phonepe-native-target` | clean, both variants |
| `release_manager/verify.sh` | 108 passed, 0 failed, 1 skipped (remote) |

`recipes.test.ts` and `safeArea.test.ts` passing unchanged is meaningful here: they prove the new
`lg:max-w-*` measures introduced no duplicate class string, no fifth breakpoint, and no second reader of
`env(safe-area-inset-*)`.

### Mobile-parity proof

The claim "the phone layout did not change" is mechanical, not visual:

1. `git worktree add --detach /tmp/boe-baseline HEAD`, symlink `node_modules` and
   `packages/contracts/dist`, `npx vite build`.
2. Strip every `@media (min-width:1024px)` and `(min-width:1440px)` block from both emitted
   stylesheets and compare the remaining rules.
3. Result: **745 sub-`lg` rules before, 745 after, identical except the single `:root` token block.**
4. Numeric clamp check across 21 viewports from 320 to 3840 px: the first width at which any token
   differs from its old fixed value is **1171 px**, well above the 1024 px shell switch.

That covers CSS. It does not cover the DOM change from the three new wrapper `<div>`s — those rely on
`display: contents` (D-061), which is reasoned about and confirmed in the emitted cascade but not
observed rendering.

## What still needs eyes

**Nothing in this task was seen in a browser or on a device.** No dev server, preview server or emulator
may run on this machine. Every width figure above is arithmetic from the tokens.

Run on the VPS or a local browser:

```sh
cd frontend_stack_ts
npm run dev          # client, port 5174
npm run dev:admin    # admin,  port 5175
```

Widths — check both shells at each, looking for horizontal overflow first:

| Width | What to look for |
|---|---|
| 375, 390, 430 | phone. Must be **identical to before**: card gaps, bottom nav, safe areas, 44 px targets |
| 768 | large phone / tablet portrait — still the mobile shell |
| 1023 → 1024 | the shell switch. Bottom nav → sidebar (admin) / island (client) with no reflow jump |
| 1366 | first real desktop. `DataList` label→value adjacency; two-column card grids |
| 1920 | three-column grids at `xl`; Activity feed bounded at 68rem; donut 256 px beside a 3-column legend |
| 2560 | client capped at 1600 px and centred; admin ~2194 px; `ADMIN_FORM_GRID` 3 columns of ~370 px |
| 3840 | admin capped at 2400 px; page gutter 64 px; topbar "Sign out" aligned with page content |

Also explicitly:

- **Portrait and landscape phone.** Landscape exercises `--be-safe-left/right`; nothing here touched
  them, but the Activity `lg:` row composition must not engage at 1024 px landscape on a phone — it
  will, and that is intended (it is a width rule, not a device rule). Confirm it looks right.
- **Browser zoom 100 / 150 / 200 %.** Full-page zoom scales `px` and `vw` together so the layout should
  simply move down the breakpoint ladder. `--be-content-max-form: 35rem` now tracks root font size —
  check a form at 200 % is wider, not clipped.
- **Pinch zoom.** `user-scalable=no` is forbidden and asserted; confirm pinch still works and that
  nothing new is horizontally clipped when zoomed in.
- **Admin APK navigation** — the important one. Build, install, sign in as an operator with full
  permissions and again with narrow permissions:
  ```sh
  cd frontend_stack_ts && npm run android:apk:admin
  ```
  Confirm: the bar shows Overview · Applications · Funds · Receipts · More; "More" lists every
  permitted section grouped; a narrow-permission operator sees a full bar rather than gaps; hardware
  **Back closes the sheet** rather than navigating; the sheet closes when a destination is chosen; and
  each of the nine previously-unreachable screens opens.
- **Client APK navigation** — `npm run android:apk`. Should be unchanged; confirm the five tabs and the
  bell.
- **Desktop sidebar / island** — admin sidebar `aria-current` still marks the active route now that the
  bar is built differently; client island unchanged.
- **`display: contents` on a real device WebView** — Portfolio positions, admin fund list and admin AUM
  history. If the wrapper misbehaved, the symptom is wrong vertical gaps on a phone, not a broken page.

## For the next developer

- **Adding a desktop grid to a list that already has a container?** Use `CARD_COLUMNS[n]`. **Adding a
  container that did not exist?** Use `CARD_COLUMNS_WRAP[n]`. Getting this backwards changes the phone
  layout silently — it already happened once in this task. D-061.
- **Never put an unprefixed utility on a wrapper introduced for a desktop grid.**
- The only remaining lever above `lg` is `xl` (1440 px). There is no `2xl` and `--breakpoint-*` is
  cleared to exactly four values, so a fifth is unrepresentable. If a composition seems to need one, it
  is a composition problem.
- `ADMIN_LINK_MAP` is intent, not evidence. Re-run the reachability scan when adding a route. D-062.
- `Sheet` is exported as a primitive but does not register with `OverlayStackProvider`; `Modal` is the
  layer that does, and hardware Back only closes a registered overlay. Every overlay in the app goes
  through `Modal` today, so nothing is broken — but reach past it and Back will navigate away instead of
  closing your sheet. Use `Modal`, or `ConfirmDialog` on top of it.
- The seven admin detail screens remain single-column stacks. Doc 08 specifies two columns with a sticky
  summary rail at `≥ lg`; it has never been built and was deferred out of this task. That is the next
  desktop piece of work, and `LIST_SPLIT` plus the `LIST_ROW` measure are only mitigations.


---

## Addendum — device verification, 2026-08-30

The maintainer started an emulator (API 36 / Android 16, 1080×2400, gesture navigation) and supplied
dev-stack credentials, so most of "What still needs eyes" above is now **TESTED**. See
[Entry 036](../LOGS/implementation_log.md) and [D-064](../LOGS/risk_and_decision.md#d-064) to
[D-066](../LOGS/risk_and_decision.md#d-066).

### What the device found that the suite could not

Tapping a destination **inside** the More sheet froze React permanently: URL advanced, tree stuck on
the previous screen, sheet stuck open, no exception, 3.7 % CPU. Cause was `Modal`'s registration effect
depending on the whole `OverlayStackProvider` context object, whose identity changes on every stack
change — an unbounded effect loop that starved the suspended `lazy()` route transition. Latent since
Phase 10; `ConfirmDialog` has nine consumers on the same path. Fixed by depending on the stable
`register` callback. D-064.

This is the fourth defect in this repository that only a running system exposed, and the pattern holds:
the failure was silent, cheap to see on a device, and invisible to 197 passing tests.

### Measured on the device

| Claim | Result |
|---|---|
| tokens never move below `lg` | content 960 px at 1023 **and** 1024; crossover 1171 px |
| desktop growth | 1120 @1366 · 1574.4 @1920 · capped 1600 @2560; wide 2304 @2560 · capped 2400 @3840 |
| forms never widen | 560 px at every width from 375 to 3840 |
| no horizontal overflow | clean at 375/390/430/768/1023/1024/1171/1366/1440/1920/2560/3840 |
| `LIST_ROW` regression | gap 748 px @1023 (unchanged) → **24 px** @1024, capped 704 px, left-aligned |
| `contents` wrapper | `display: contents` @412/768; 2 grid tracks @1024/1366; 3 @1920/2560 |
| card grids | notifications 2 @1024 → 3 @1440; statements 2; support form capped 608 px; activity feed capped 1088 px |
| admin split `DataList` | 1 column below `lg`, 2 from 1024 |
| admin bar | Overview · Applications · Funds · Receipts · More; sidebar `display:none` below `lg` |
| More sheet | `aria-modal`, 14 links, Money(4)/System(4) headed, singles unheaded, scroll locked |
| Back handling | Escape **and** `adb shell input keyevent KEYCODE_BACK` close the sheet without navigating |
| nine restored routes | all open with the right `h1`, sheet closes, no overflow |
| dark nav contrast | inactive 7.32:1 · active 15.07:1 · client island pill 8.53:1 — all AA |
| phone CSS | sub-`lg` diff is 7 removed / 23 added rules, **all** of them `--be-nav-*` or nav-surface |

### Still open

- **The Android bottom seam.** A 63 px strip of `#F4F1E9` window background sits below the dark bar,
  because `--be-safe-bottom` resolves to `0px` on API 36 and the WebView is inset natively rather than
  drawing under the system bars. Pre-existing; it was invisible only while the bar was the same colour
  as the window. Not fixable by recolouring the window (one colour, and the top strip correctly matches
  the light header per D-034). Needs an inset-handling investigation. D-065.
- **`npm run android:apk:admin` installs over `com.beonedge.app`.** It passes `-PboeVariant=admin` for
  branding but not `-PboeApplicationId`; only `emu/boe_update.sh` does that. The emulator's
  `com.beonedge.app` was overwritten during this work and has been restored with a **client** build
  against the dev API — rebuild it through `emu/boe_update.sh` for whichever target it should hold. The
  script should either set the id or be renamed.
- Landscape, browser zoom 150/200 %, pinch zoom: not exercised.
- No release/minified APK; nothing installed on a physical handset.
- The seven admin detail screens are still single-column stacks (the deferred summary-rail work).

### Reproducing the device checks

```sh
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof <package>)
curl -s http://127.0.0.1:9222/json/list
```

Then drive the WebView over CDP. Two things to know, both of which cost time here:

1. `getComputedStyle().getPropertyValue("--be-content-max")` returns the **specified** value, not the
   resolved one — custom properties are substituted at use time. Measure a probe element with
   `max-width: var(--token)` and read its `getBoundingClientRect().width` instead.
2. `Emulation.setDeviceMetricsOverride` gives real rendering at arbitrary CSS widths in the device
   WebView, which is how the desktop compositions were checked without a browser. It does **not**
   include the system bars — use `adb exec-out screencap -p` for anything involving the status or
   navigation bar.


---

## Addendum 2 — phase closed, 2026-08-30

Maintainer direction settled the open questions; see [Entry 038](../LOGS/implementation_log.md) and
[D-067](../LOGS/risk_and_decision.md#d-067) to [D-069](../LOGS/risk_and_decision.md#d-069).
Everything in "What still needs eyes" is now closed except what is listed as deferred below.

### Closed in this pass

| Item | Result |
|---|---|
| APK pinch / double-tap / scaling | Blocked in both APKs, verified with a positive control. D-067 |
| Browser zoom 100/125/150/200 % | No overflow, no clipping, navigation usable at every level, both surfaces |
| Landscape, both APKs, with a cutout | 867 × 360, no overflow on any route, More sheet complete, Back works |
| Twelve-width sweep, behavioural | No overflow, no clipped controls, no text overlap; shell switch exact at 1024 |
| Release APKs | Signed, R8-minified, distinct ids, coexist, launch independently |
| applicationId across every build path | Audited; gradle now refuses admin-under-client-id. D-068 |
| WebView-133 bottom seam | Accepted as an environment limitation. D-069 |
| Emulator client restored | Rebuilt through `emu/boe_update.sh --prod --client` |

### Two things that needed a method, not just a check

**Verifying "zoom is disabled" needs a positive control.** A probe reporting `scale === 1` proves nothing
unless the probe has been shown to detect zoom. Rebuild with `zoomEnabled: true`, confirm the same
synthetic pinch yields `scale 2.5`, then restore. Without that step the result is unfalsifiable.

**Rotating this emulator needs the console.** `adb shell settings put system user_rotation 1` silently
reverts, and `adb shell cmd window set-user-rotation` does not exist on API 36. What works:

```sh
TOKEN=$(cat ~/.emulator_console_auth_token)
printf 'auth %s\nrotate\nquit\n' "$TOKEN" | nc -q 2 localhost 5554
adb shell cmd overlay enable com.android.internal.display.cutout.emulation.corner
```

`rotate` cycles, so check `adb exec-out screencap -p` dimensions and repeat until you have the
orientation you want. Disable the cutout overlay and restore `accelerometer_rotation 1` afterwards.

### Browser zoom is emulated, and that limit is real

Browser full-page zoom at *Z* on a *W*-pixel window is a *W/Z* CSS viewport, so zoom was reproduced by
setting the CSS viewport width in the device WebView. That faithfully tests **layout under zoom**. It does
not test that a browser *permits* zoom — that rests on the viewport meta carrying no `user-scalable=no`
or `maximum-scale`, which `safeArea.test.ts` asserts. No browser can be served from this machine.

### Genuinely deferred

- **The admin summary rail.** Doc 08 specifies two columns with a sticky summary rail for admin detail
  screens at `≥ lg`; never built. Seven screens. `LIST_SPLIT` and the `LIST_ROW` measure mitigate the
  symptom only. This is the next desktop design task.
- **Physical-device verification.** Everything native is emulator-only, API 36 / WebView 133.
- **WebView ≥ 140 behaviour.** The first such device is the first real exercise of the safe-area contract,
  because the CSS insets are inert below 140 (D-069).
- **Production authentication and payments** from a release build — deliberately not exercised here.

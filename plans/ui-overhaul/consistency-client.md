# Client app: code-side consistency inventory (U6)

Status: read-only audit, evidence label `STATIC`. Tally task `M16-ui-overhaul:U6-static-client`, lane `u-static-client`. Written 2026-11-16 for the UI overhaul (DEC-40). It keeps today's identity and design system (DEC-45) and uses the reference widths of DEC-56: client phone 360 and 390 px, client web 768, 1280 and 1440 px. Nothing in this document is a decision or an approved fix; the per-surface plan (U5) decides.

Paths are relative to `frontend_stack_ts/src/` unless they start with a repository folder. `file:line` points at commit `d4c817e`.

## 1. Method

- **Commit:** `d4c817e` (`main`), read in worktree `.temp/worktrees/u-static-client` on branch `track/u-static-client`. No dev server, browser, container or check was run; no application source was changed. Runtime behaviour at the reference widths is for lane `u-audits` to confirm.
- **Rules read:** `README.md`, `RULES.md` (with "Product, copy, and accessibility" and rules 4, 9 and 12), `CLAUDE.md`, and in `plans/admin-improvements.md` DEC-14, DEC-25, DEC-40, DEC-45, DEC-47, DEC-56 and section 6 "Next: UI overhaul, four surfaces".
- **Files read:**
  - Routing: `app/routing/clientRoutes.ts`, `routeManifest.ts`, `buildRouter.tsx`, `guards.tsx`, `resolveDestination.ts`, `RouteErrorBoundary.tsx`, plus `app/native/backPolicy.ts` and `app/native/NativeBackCoordinator.tsx` (6 + 2 files, in full).
  - Client shell: all 5 non-test files in `shells/client` (in full).
  - App frame: `app/layouts/*` (5), `app/overlays/*` (2), `app/providers/AppProviders.tsx`, `ToastProvider.tsx`, `app/native/AppUpdateGate.tsx`, `ConnectivityBanner.tsx` (in full).
  - Design layer `ui/`: 47 non-test files. 37 read in full (every client recipe, every primitive but `Combobox`, every pattern, `DonutChart`, `Reveal`, `tokens-core.css`, `base.css`, `utilities.css`); 5 read in part (`theme.css`, `tokens-elevation.css`, `patterns.css`, `status.css`, `chartMath.ts`); 5 not read (`recipes/admin.ts` beyond `ADMIN_NUMERIC`, `recipes/shellAdmin.ts`, `primitives/Combobox.tsx` (unused by the client), `tokens/fonts.css`, `styles/index.css`).
  - Client features: 113 non-test files in 23 folders (everything under `features/` except `admin/`). 92 read in full: every route screen and every component a screen renders. 3 read in part: `payments/PaymentStatusScreen.tsx` (parked), `device-security/LockScreen.tsx` (render part), `app-update/UpdateInstallPanel.tsx` (render part). 18 data and decision modules (query hooks, stores, checkout and update logic, `legal/publishedContent.ts`) were consulted only where a screen's behaviour depended on them.
  - Domain helpers for display: `domain/money.ts`, `dates.ts`, `percent.ts`, `plural.ts`, `reference.ts`, `notifications.ts` in full; `failure.ts`, `status.ts`, `clientStatus.ts` scanned for copy.
- **Searches:** the copy checks in section 5 grep 224 client files (features, app, shells, ui, domain, lib, platform; admin excluded). Contrast ratios in CC-08 were computed with the WCAG 2.x formula from the token hex values.
- **Counts (client `.tsx` under `features/`, `shells/client`, `app/`, 98 files, admin excluded):** 35 routes; 31 `PageHeader`, 39 `Page`; 61 `Button`, 41 `ButtonLink`, 12 raw `<button>`; 90 `Card`; 33 `Section`; 35 `AsyncBoundary`; 70 `Skeleton`; 18 `EmptyState`; 57 `Alert`; 11 `Form`, 23 `FormField`; 48 `MoneyValue`, 10 `MoneyFootnote`; 10 `DataList`, 35 `DetailRow`; 9 `LoadMore`; 5 `ConfirmDialog`; 3 `toast.show`; 13 `StatusBadge`, 8 `Badge`.
- **Not covered:** Phase I screens (nominee by request, SIP early exit) are not on `main` at `d4c817e`; the nominee section audited here is the current direct-edit form that lane `i-nominee-requests` replaces. They are to be audited when they land (DEC-47).

## 2. Route inventory

### 2.0 The client chrome every signed-in route shares

`shells/client/ClientFrame.tsx:36-147` draws the chrome when the route is not public, not `chrome: "none"`, and the session is authenticated (`:42-43`). Public routes, `/blocked` and `/statements/print` render bare.

| Width | What is drawn | Code |
| --- | --- | --- |
| 360, 390, 768 (below `lg` 1024) | Sticky header: back button on the left when the manifest back target is `parent` or `home`, empty spacer, bell on the right. No title. Bottom navigation with 5 tabs (Home, Funds, Portfolio, Activity, Profile), glyph plus 10 px label. | header `ClientFrame.tsx:100-124`, recipe `ui/recipes/shellClient.ts:8-16` (`lg:hidden`); bottom nav `ClientFrame.tsx:128-144`, recipe `ui/recipes/layout.ts:97-102` (`lg:hidden`) |
| 1280, 1440 (`lg` and up) | Floating top-nav island: wordmark, the same 5 tabs as text, bell. No back control and no title anywhere in the chrome. | `ClientFrame.tsx:71-98`, `shellClient.ts:70-103` |

- The header back button is icon-only (`BackGlyph`, `shells/client/navGlyphs.tsx:54`), labelled "Go back", 44 px target (`ICON_ACTION`, `shellClient.ts:20-25`). It pushes the manifest parent path as written, without filling in route parameters (`ClientFrame.tsx:54-59`, `:107`).
- Android hardware back is separate: `app/native/NativeBackCoordinator.tsx:42-82` dismisses an open overlay first, asks the transactional prompt on the two invest routes (`shells/client/ClientShellRoot.tsx:39-48`), then replaces to the parent with parameters filled in (`app/native/backPolicy.ts:45`). Routes without a parent go back in history, else home, else exit.
- A tab shows as current only when the route id equals the tab id (`ClientFrame.tsx:80`, `:136`).
- Page frame: `Page` (`app/layouts/Page.tsx:13-15`, `ui/recipes/layout.ts:3-17`). Side padding 16 px, 24 px from 768, 32 px from 1024. Widths: `default` = clamp(60rem, 82vw, 100rem) (full width at 768, about 1050 px at 1280, 1181 px at 1440); `form` = 560 px; `wide` = clamp(80rem, 90vw, 150rem).

### 2.1 Structure and titles

| # | Path (manifest line) | Screen component | Shell and layout | Title shown: text, source, placement | Manifest title |
| --- | --- | --- | --- | --- | --- |
| 1 | `/splash` (`app/routing/clientRoutes.ts:15`) | `features/auth/ClientSplashScreen.tsx:4` → `features/auth/SplashScreen.tsx:18` | Bare; own full-screen layout in `features/auth/splash.css` | No heading. Wordmark "BeOnEdge" centred; `aria-label` "Starting BeOnEdge" on `main` (`SplashScreen.tsx:71`) | Starting |
| 2 | `/login` (`:23`) | `features/auth/LoginScreen.tsx:16` | Bare; `AuthLayout` (`app/layouts/AuthLayout.tsx:32`) | h1 marketing headline "Investing, made deliberate" (`AuthLayout.tsx:20-24`), h2 panel title "Sign in" (`LoginScreen.tsx:51`), eyebrow "Client access" | Sign in |
| 3 | `/password/forgot` (`:31`) | `features/auth/ForgotPasswordScreen.tsx:12` | Bare; `AuthLayout` | Panel "Reset your password" (`:34`), eyebrow "BeOnEdge" (`:32`) | Reset your password |
| 4 | `/reset-password` (`:39`) | `features/auth/ResetPasswordScreen.tsx:23` | Bare; `AuthLayout`, three states | Panel "Reset your password" (no token, `:58`), "Password set" (`:77`), "Choose a new password" (`:103`); eyebrow "BeOnEdge" | Choose a new password |
| 5 | `/pay/return` (`:47`), parked | `features/payments/PaymentReturnScreen.tsx:10` | Bare (public); `Page form` + `PageHeader` | "Back from PhonePe" (`:17-20`) | Back from PhonePe |
| 6 | `/blocked` (`:55`, `chrome: "none"`) | `features/auth/BlockedScreen.tsx:34` | Bare; `AuthLayout` (`:50`) | Panel by account state: "Account on hold", "Account closed", "Account unavailable" (`:16-32`); eyebrow "Client access" | Account unavailable |
| 7 | `/verify-email` (`:65`) | `features/email-verification/EmailVerificationScreen.tsx:44` | Chrome; `Page form` (`:93`) | `PageHeader` "Verify your email" (`:94-97`) | Verify your email |
| 8 | `/dashboard` (`:74`) | `features/dashboard/DashboardScreen.tsx:50` | Chrome; `Page default` (`:64`) | "Good to see you, {first name}", from the session (`:65`) | Home |
| 9 | `/funds` (`:84`) | `features/funds/FundListScreen.tsx:29` | Chrome; `Page default` (`:59`) | "Funds" (`:60-63`) | Funds |
| 10 | `/funds/:fundId` (`:94`) | `features/funds/FundDetailScreen.tsx:27` | Chrome; `AsyncBoundary` wraps the whole `Page` (`:42`, `:49`) | Eyebrow fund category, title fund name, description fund objective, risk badge as header action; all from data (`:50-55`) | Fund |
| 11 | `/funds/:fundId/invest/lumpsum` (`:103`), parked | `features/orders/LumpsumInvestScreen.tsx:259` (form `:45`; payments off: `features/investing/InvestmentsRecorded.tsx:18`) | Chrome; `Page form` (`:153`) | "Invest a lump sum" (`:154-157`) | Invest a lump sum |
| 12 | `/funds/:fundId/invest/sip` (`:113`), parked | `features/sip/SipStartScreen.tsx:322` (form `:53`) | Chrome; `Page form` (`:180`) | "Start a SIP" (`:181`) | Start a SIP |
| 13 | `/portfolio` (`:123`) | `features/portfolio/PortfolioScreen.tsx:32` | Chrome; `Page default` (`:40`) | "Portfolio" (`:41-44`) | Portfolio |
| 14 | `/portfolio/funds/:fundId` (`:133`) | `features/invested-funds/InvestedFundScreen.tsx:21` | Chrome; `Page default` (`:27`) | Fund name from data, else "Your investment" (`:28-31`) | Your investment |
| 15 | `/portfolio/value-updates` (`:142`) | `features/portfolio/ValueUpdatesScreen.tsx:29` | Chrome; `Page default` (`:40`) | "Value updates" (`:41-44`) | Value updates |
| 16 | `/maturity-options/:offerId` (`:151`) | `features/maturity-options/MaturityOptionsScreen.tsx:135` | Chrome; `Page default` (`:141`) | "Your maturity options" (`:142`) | Maturity options |
| 17 | `/activity` (`:160`) | `features/activity/ActivityScreen.tsx:105` | Chrome; `Page default` (`:133`) | "Activity"; description changes with the payments flag; header action "Receipts" (`:134-146`) | Activity |
| 18 | `/activity/payments/:paymentId` (`:170`), parked | `features/payments/PaymentStatusScreen.tsx:72` | Chrome; `Page form` (`:96`) | "Payment" (`:97`) | Payment |
| 19 | `/activity/receipts` (`:180`) | `features/receipts/ReceiptsScreen.tsx:26` | Chrome; `Page default` (`:31`) | "Receipts" (`:32-35`) | Receipts |
| 20 | `/activity/receipts/:entryId` (`:189`) | `features/receipts/ReceiptDetailScreen.tsx:21` | Chrome; `Page default` (`:27`) | "Receipt" (`:28`) | Receipt |
| 21 | `/sips` (`:198`), parked | `features/sip/SipListScreen.tsx:27` | Chrome; `Page default` (`:37`) | "SIP plans" (`:38-41`) | SIP plans |
| 22 | `/sips/:sipPlanId` (`:207`), parked | `features/sip/SipDetailScreen.tsx:63` | Chrome; `Page default` (`:167`) | "SIP plan" (`:168`) | SIP plan |
| 23 | `/statements` (`:216`) | `features/statements/StatementsScreen.tsx:42` | Chrome; `Page default` (`:51`) | "Statements"; header action differs APK/web (`:52-79`) | Statements |
| 24 | `/statements/print` (`:225`, `chrome: "none"`) | `features/statements/StatementPrintScreen.tsx:44` | Bare; `Page wide` (`:52`); action row sits above the header | Eyebrow "BeOnEdge", title "Investment statement" (`:64`), under the action row | Investment statement |
| 25 | `/notifications` (`:235`) | `features/notifications/NotificationsScreen.tsx:51` | Chrome; `Page default` (`:105`) | "Notifications" (`:106`) | Notifications |
| 26 | `/profile` (`:244`) | `features/profile/ProfileScreen.tsx:94` | Chrome; `Page default` (`:110`) | "Profile" (`:111`) | Profile |
| 27 | `/profile/email-verification` (`:254`) | `features/email-verification/VerificationStatusScreen.tsx:26` | Chrome; `Page form` (`:31`) | "Email verification" (`:32-35`) | Email verification |
| 28 | `/profile/contact` (`:263`) | `features/profile/ContactDetailsScreen.tsx:24` | Chrome; `Page default` (`:56`) | "Contact details" (`:57-60`) | Contact details |
| 29 | `/profile/security` (`:272`) | `features/device-security/DeviceSecurityScreen.tsx:46` | Chrome; `Page form` (`:136`) | "Security" (`:137-140`) | Security |
| 30 | `/profile/support` (`:281`) | `features/support/SupportScreen.tsx:44` | Chrome, also for suspended and closed accounts (`allowTerminalAccount`, `:286`); `Page default` (`:86`) | "Support" (`:87-90`) | Support |
| 31 | `/profile/reviews` (`:291`) | `features/reviews/ReviewsScreen.tsx:48` | Chrome; `Page default` (`:53`) | "Reviews" (`:54-57`) | Reviews |
| 32 | `/profile/legal` (`:300`) | `features/legal/LegalScreen.tsx:38` | Chrome; `Page default` (`:39`) | "Legal" (`:40-43`) | Legal |
| 33 | `/profile/legal/investor-charter` (`:309`) | `features/legal/InvestorCharterScreen.tsx:6` → `features/legal/LegalDocumentScreen.tsx:25` | Chrome; `Page default` (`:34`) | "Investor charter" (`:35`) | Investor charter |
| 34 | `/profile/legal/grievance` (`:318`) | `features/legal/GrievanceScreen.tsx:27` | Chrome; `Page default` (`:32`) | "Grievance redressal" (`:33-36`) | Grievance redressal |
| 35 | `*` (`:327`) | `features/auth/NotFoundScreen.tsx:9` | Chrome when signed in; `Page default` (`:14`) | "We could not find that page" (`:15`) | Not found |

Manifest titles are never shown or used as the document title on the client (CC-06). The admin frame shows them (`shells/admin/AdminFrame.tsx:109`).

### 2.2 Back controls

"Header back" is the shell button described in 2.0: phone and 768 only, pushes the manifest parent. "Web" means 1280 and 1440.

| # | Path | Header back (360, 390, 768) | In-page back control | Web (1280, 1440) | Android hardware back |
| --- | --- | --- | --- | --- | --- |
| 1 | `/splash` | none | none | none | history back, else exit app |
| 2 | `/login` | none | none | none | history back, else exit app |
| 3 | `/password/forgot` | none | "Back to sign in": `ButtonLink` ghost, full width, in the form actions (`ForgotPasswordScreen.tsx:69-71`); after sending, `ButtonLink` secondary full width (`:49-51`). Text only, pushes `/login` | same in-page link | replace to `/login` |
| 4 | `/reset-password` | none | none in the form state; after a refused token a row "Request a new link" / "Sign in if you already set it" (`ResetPasswordScreen.tsx:111-119`); done state "Sign in" (`:83`) | same | replace to `/login` |
| 5 | `/pay/return` (parked) | none | none; "Open this payment" only when `paymentId` is valid (`PaymentReturnScreen.tsx:24-28`) | same | history back, else exit. **Dead end** without a valid `paymentId` |
| 6 | `/blocked` | none (`chrome: "none"`) | none; "Contact support" and "Sign out" | same | history back, else home (which redirects back here) |
| 7 | `/verify-email` | yes → `/dashboard` (kind `home`, ignores `returnTo`) | none | none | history back |
| 8 | `/dashboard` | none (kind `exit`) | none | none | history back, else exit app |
| 9 | `/funds` | yes → `/dashboard` (a tab root) | none | none | replace to `/dashboard` |
| 10 | `/funds/:fundId` | yes → `/funds` | none | none | replace to `/funds` |
| 11 | `/funds/:fundId/invest/lumpsum` (parked) | yes → literal `/funds/:fundId`, **broken** (CC-01) | none; payments off: "See my portfolio" (`InvestmentsRecorded.tsx:21-23`) | none | `window.confirm` "Leave without investing?", then replace to `/funds/<id>` |
| 12 | `/funds/:fundId/invest/sip` (parked) | yes → literal `/funds/:fundId`, **broken** (CC-01) | as row 11 | none | `window.confirm`, then replace to `/funds/<id>` |
| 13 | `/portfolio` | yes → `/dashboard` (a tab root) | none | none | replace to `/dashboard` |
| 14 | `/portfolio/funds/:fundId` | yes → `/portfolio` | none | none | replace to `/portfolio` |
| 15 | `/portfolio/value-updates` | yes → `/portfolio` | none | none | replace to `/portfolio` |
| 16 | `/maturity-options/:offerId` | yes → `/portfolio` (also when opened from the dashboard or a notification) | none | none | replace to `/portfolio` |
| 17 | `/activity` | yes → `/dashboard` (a tab root) | none | none | replace to `/dashboard` |
| 18 | `/activity/payments/:paymentId` (parked) | yes → `/activity` | "Back to activity" `ButtonLink` secondary (`PaymentStatusScreen.tsx:198-200`) | in-page link | replace to `/activity` |
| 19 | `/activity/receipts` | yes → `/activity` | none | none | replace to `/activity` |
| 20 | `/activity/receipts/:entryId` | yes → `/activity/receipts` | "All receipts" `ButtonLink` secondary md, no icon (`ReceiptDetailScreen.tsx:61-63`) | in-page link | replace to `/activity/receipts` |
| 21 | `/sips` (parked) | yes → `/portfolio` | none | none | replace to `/portfolio` |
| 22 | `/sips/:sipPlanId` (parked) | yes → `/sips` | "Back to SIP plans" `ButtonLink` secondary, only when the plan is not found (`SipDetailScreen.tsx:186-188`) | conditional link | replace to `/sips` |
| 23 | `/statements` | yes → `/profile` | none | none | replace to `/profile` |
| 24 | `/statements/print` | none (`chrome: "none"`) | "Back to statements" `ButtonLink` ghost sm above the title, hidden in print (`StatementPrintScreen.tsx:54-56`) | same | replace to `/statements` |
| 25 | `/notifications` | yes → `/dashboard` (also when opened from the bell on another page or from Profile) | none | none | replace to `/dashboard` |
| 26 | `/profile` | yes → `/dashboard` (a tab root) | none | none | replace to `/dashboard` |
| 27-32 | `/profile/email-verification`, `/contact`, `/security`, `/support`, `/reviews`, `/legal` | yes → `/profile` | none | none | replace to `/profile` |
| 33-34 | `/profile/legal/investor-charter`, `/grievance` | yes → `/profile/legal` (also when opened from a fund page) | none | none | replace to `/profile/legal` |
| 35 | `*` | yes → `/dashboard` (kind `home`) | "Go to home" `Button` primary, `navigate(replace)` (`NotFoundScreen.tsx:17-26`) | in-page button | history back, else home |

**Dead ends** (no in-app way to leave the route at any width): `/pay/return` without a valid `paymentId` (parked under DEC-14). No other route is a strict dead end: the gates (maintenance, mandatory update, device lock) are dead ends by design, and `/blocked` offers support and sign-out.

**No in-app back at 1280 and 1440** (top navigation only): rows 7, 10, 14, 15, 16, 19, 23, 25, 27 to 34, and the parked rows 11, 12, 21 and 22 (CC-03).

### 2.3 Navigation, primary action, responsive layout

"B" = bottom navigation plus header bell; "T" = top-nav island with bell; "—" = no navigation.

| # | Path | Nav 360/390/768 | Nav 1280/1440 | Tab marked current | Primary action and placement | Layout changes between phone and web |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `/splash` | — | — | — | "Try again" `Button` lg full width, only after a failed probe (`SplashScreen.tsx:85-96`) | none; fixed grid, `clamp()` type (`splash.css`) |
| 2 | `/login` | — | — | — | "Sign in" `Button` lg full width in form actions (`LoginScreen.tsx:71`); "Forgot your password?" ghost sm inside the form body (`:115-117`) | `AUTH_SHELL`: narrative stacked above the panel below 1024, two columns from 1024; footnote absolute from 1024 (`ui/recipes/auth.ts`) |
| 3 | `/password/forgot` | — | — | — | "Email me a reset link" lg full width, disabled until an email is typed (`:60-68`) | as row 2 |
| 4 | `/reset-password` | — | — | — | "Set my password" lg full width, disabled until valid (`:127`) | as row 2 |
| 5 | `/pay/return` | — | — | — | "Open this payment" as the `EmptyState` action | `Page form` only |
| 6 | `/blocked` | — | — | — | "Contact support" `Button` primary lg full width that navigates (`BlockedScreen.tsx:55-64`); "Sign out" secondary lg full width with loading (`:65-79`) | as row 2 |
| 7 | `/verify-email` | B | T | none | "Verify" lg full width plus "Email me a code" secondary lg full width, in the form actions (`EmailVerificationScreen.tsx:121-146`) | 560 px column; padding steps only |
| 8 | `/dashboard` | B | T | Home | None at page level. "See portfolio" secondary sm in the value card (`:133-135`); "Verify now" in a warning `Alert` (`:77-79`); "See all" ghost sm in the Funds section head (`:190-192`) | `BENTO` (`dashboard.recipe.ts:3-11`): one column below 768; 6-column grid from 768 (value card 4, account card 2, fund cards 2 each); return figure right-aligned from 1024 |
| 9 | `/funds` | B | T | Funds | None. Search field plus sort pills (pills below 1024 only, `FundListScreen.tsx:75-91`) | JavaScript breakpoint (`lib/useBreakpoint.ts:40-41`): cards in `ContentGrid` (1 column, 2 from 480) below 1024; sortable `FundTable` from 1024 (`FundListScreen.tsx:131-133`) |
| 10 | `/funds/:fundId` | B | T | none | "Invest a lump sum" primary lg plus "Start a SIP" secondary lg, full width inside the summary card (`:101-114`); with payments off a note and no action; legal links ghost sm (`:165-174`) | actions side by side from 480; `SUMMARY_GRID` 2 → 4 columns from 768 |
| 11 | invest lump sum (parked) | B | T | none | "Continue to PhonePe" md full width trailing (`LumpsumInvestScreen.tsx:232-236`); payments off: "See my portfolio" secondary | 560 px column |
| 12 | invest SIP (parked) | B | T | none | "Create the SIP" / "Set up AutoPay" md full width trailing (`SipStartScreen.tsx:303-307`) | 560 px column |
| 13 | `/portfolio` | B | T | Portfolio | Section actions "Value updates" and "SIP plans", secondary sm (`:105-116`); empty: "Browse funds" primary (`:67`) | `SUMMARY_GRID` 2 → 4 columns; positions one column, 2 from 1024, 3 from 1440 (`CARD_COLUMNS_WRAP[3]`) |
| 14 | `/portfolio/funds/:fundId` | B | T | none | "Fund details" secondary sm trailing (`:47-49`) | `SUMMARY_GRID`; list rows go to one line from 1024 (`activity.recipe.ts`); feed capped at 68rem |
| 15 | `/portfolio/value-updates` | B | T | none | None ("Show older updates" in an `Alert`; "Show more") | feed capped at 68rem from 1024 |
| 16 | `/maturity-options/:offerId` | B | T | none | "Choose this option" / "Change my choice" `Button` md, stretched by the card column (`:128-130`) | detail rows become a label column grid from 1024 |
| 17 | `/activity` | B | T | Activity | "Receipts" secondary sm as the header action (`:141-145`) | header actions beside the title from 480; rows to one line from 1024; feed 68rem |
| 18 | payment (parked) | B | T | none | conditional `ButtonLink` row (`:183-201`) | 560 px column |
| 19 | `/activity/receipts` | B | T | none | None; each receipt card is a link | as row 17 |
| 20 | `/activity/receipts/:entryId` | B | T | none | "All receipts" secondary (`:61-63`) | detail rows grid from 1024 |
| 21 | `/sips` (parked) | B | T | none | empty state "Browse funds" | 2 columns from 1024 |
| 22 | `/sips/:sipPlanId` (parked) | B | T | none | Pause / Resume, ghost link to Activity, danger row | `SUMMARY_GRID` |
| 23 | `/statements` | B | T | none | Web: "Print statement" `ButtonLink` secondary sm; APK: "Open statement" `Button` secondary sm; both as the header action (`:59-78`) | 2 columns from 1024; 5 figures in a 2 → 4 column grid, so 4 + 1 from 768 |
| 24 | `/statements/print` | — | — | — | "Print" primary sm (web only) beside "Back to statements" (`:53-61`) | table min-width 48rem, scrolls sideways on phones; `print:` variants |
| 25 | `/notifications` | B | T | none (the bell has no current state) | Per item "Open" secondary sm and "Mark read" ghost sm (`:159-177`) | feed 68rem |
| 26 | `/profile` | B | T | Profile | "Save my nominee" md trailing (`NomineeSection.tsx:116`); "Sign out" secondary md in its own last section (`:157-164`) | menu list capped at 44rem; nominee rows in 2 columns from 1024 |
| 27 | `/profile/email-verification` | B | T | none | "Verify my email" primary trailing, or "Contact support" secondary (`:77-84`) | 560 px column |
| 28 | `/profile/contact` | B | T | none | "Send a code to the new address" md trailing (`EmailChangePanel.tsx:181`); "Change my phone number" md trailing (`ContactDetailsScreen.tsx:110`) | detail rows in 2 columns from 1024 |
| 29 | `/profile/security` | B | T | none | "Change my password" md trailing (`AccountPasswordPanel.tsx:102`); "Set a PIN" / "Change PIN"; "Remove PIN" danger (`DeviceSecurityScreen.tsx:192-201`) | 560 px column |
| 30 | `/profile/support` | B | T | none | "Send request" md trailing (`:129`) | form capped at 38rem; tickets 2 columns from 1024 |
| 31 | `/profile/reviews` | B | T | none | "Send review" md trailing (`ReviewForm.tsx:105`) | as row 30 |
| 32 | `/profile/legal` | B | T | none | None; menu rows with chevrons | menu capped at 44rem |
| 33 | investor charter | B | T | none | "Contact support" secondary sm trailing, only when unpublished (`LegalDocumentScreen.tsx:48`, `:83`) | detail rows grid |
| 34 | grievance | B | T | none | "Open support" primary trailing in the last section (`GrievanceScreen.tsx:103-105`) | — |
| 35 | `*` | B | T | none | "Go to home" primary (`NotFoundScreen.tsx:17-26`) | — |

Screens and states outside the route table: `features/app-notice/MaintenanceScreen.tsx`, `features/app-update/MandatoryUpdateScreen.tsx` and `features/device-security/LockScreen.tsx` (full-screen block layers, `ui/recipes/overlay.ts` `BLOCK_*`), `features/app-update/OptionalUpdateSheet.tsx` (sheet), `app/routing/RouteErrorBoundary.tsx`, the guard screens in `app/routing/guards.tsx` ("Restoring your session" spinner, forbidden `ErrorState`), `features/email-verification/EligibilityReadCheck.tsx`, and the route-chunk spinner in `app/routing/buildRouter.tsx`.

## 3. Pattern inventories

Each subsection ends with the variant closest to `ui/`.

### 3.1 Back and close controls

| Variant | Where | Look | Behaviour |
| --- | --- | --- | --- |
| Shell header back | `shells/client/ClientFrame.tsx:101-112`; `ICON_ACTION` `ui/recipes/shellClient.ts:20-25`; `BackGlyph` `navGlyphs.tsx:54` | icon-only chevron, 44 px, "Go back" | pushes the raw parent path; 27 routes; below 1024 only |
| Android hardware back | `app/native/NativeBackCoordinator.tsx:42-82`, `app/native/backPolicy.ts:28-55` | system | closes overlays, transactional `window.confirm`, replaces to the parent with parameters |
| Browser back | — | — | history |
| Text back links | `ForgotPasswordScreen.tsx:49-51` (secondary, full width), `:69-71` (ghost, full width); `StatementPrintScreen.tsx:54-56` (ghost sm); `ReceiptDetailScreen.tsx:61-63` (secondary md, "All receipts"); `SipDetailScreen.tsx:186-188` (secondary md); `PaymentStatusScreen.tsx:198-200` (secondary md) | no icon; four tone and size combinations; four phrasings | pushes the parent; all widths |
| Home button | `NotFoundScreen.tsx:17-26` primary `Button`; `InvestmentsRecorded.tsx:21-23` secondary trailing `ButtonLink` | text | navigate |
| Sheet close | `ui/primitives/Sheet.tsx:141-154`, `SHEET_CLOSE` `ui/recipes/overlay.ts` | X icon, "Close", 44 px | dismiss |
| Dialog cancel | `app/overlays/ConfirmDialog.tsx:25` default "Go back"; custom "Keep it running", "Keep it paused", "Keep plan", "Keep AutoPay" (`SipDetailScreen.tsx:350-410`), "Keep my PIN" (`DeviceSecurityScreen.tsx:246-257`); "Not now" ghost (`OptionalUpdateSheet.tsx:26-28`) | secondary or ghost button | dismiss |
| Step back inside a flow | "Use a different address" ghost (`EmailChangePanel.tsx:140-149`); "Cancel" ghost (`DeviceSecurityScreen.tsx:239-241`); "Go back" ghost (`LockScreen.tsx:162-169`) | text | local state |
| Dismiss | toast X "Dismiss" (`app/providers/ToastProvider.tsx:62-77`); "Dismiss" ghost (`PendingPaymentRecovery.tsx`, parked) | — | — |

Closest to `ui/`: the shell header back (shared recipe and glyph) for back, `Sheet` close for close. Missing: a page-level back control that works at every width (CC-03).

### 3.2 Page headers and titles

| Variant | Where | Notes |
| --- | --- | --- |
| `PageHeader` | `app/layouts/PageHeader.tsx:21-38`, recipes `ui/recipes/layout.ts` `PAGE_HEADER_*`; 31 uses | h1 in display type (clamp 2-2.6rem, 2.6-3.5rem from 1024), gold rule, optional description (29 uses), eyebrow (2: fund category `FundDetailScreen.tsx:51`, "BeOnEdge" `StatementPrintScreen.tsx:64`), actions (3: risk badge, "Receipts", "Open/Print statement"); wrapped in `Reveal` |
| `AuthLayout` panel | `app/layouts/AuthLayout.tsx:95-108` | h1 marketing headline plus h2 panel title; 4 routes, 6 states; eyebrow "Client access" or "BeOnEdge" |
| Block gate | `GATE_TITLE` `ui/recipes/layout.ts`, `BLOCK_MARK` | Maintenance, mandatory update, device lock |
| Splash | `features/auth/splash.css` | own type sizes in px |
| Sheet title | `SHEET_TITLE` | dialogs |
| Section title | `app/layouts/Section.tsx` h2, `SECTION_HEAD_TITLE`; 33 uses | 22 px display |
| In-card titles | `ITEM_TITLE` span (16 px UI semibold, the most common), `CARD_TITLE` span (`StatementsScreen.tsx:112`, `LockScreen.tsx:156`), `CARD_TITLE` h2 (`LegalDocumentScreen.tsx:75`, `LegalSections.tsx:15`, `GrievanceScreen.tsx:75`, `:88`), unstyled `<h3>` (`FundStockAllocation.tsx:42`) | four forms |
| Shell | none | no title in the phone header or the web top nav (`ClientFrame.tsx:71-124`) |

Title source: hard-coded on 28 routes, data-driven on 3 (dashboard greeting, fund detail, invested fund). Closest to `ui/`: `PageHeader` plus `Section`.

### 3.3 Buttons

- **Tones and sizes:** `ui/recipes/button.ts:14-26`: primary, gold (unused by the client), secondary, ghost, danger; sm, md, lg = 44/44/52 px on phones, 36/40/48 px from 1024.
- **Counts:** 61 `Button`, 41 `ButtonLink`, 12 raw `<button>`. Tone secondary 37, ghost 17, danger 4, primary for the rest; size sm 51, lg 14, md for the rest; `trailing` 31; `fullWidth` 16.
- **Icon use:** only the trailing up-right arrow (`ui/primitives/Button.tsx:28-43`, duplicated in `ButtonLink.tsx:25-40`) and the loading spinner. It appears on form submits ("Change my password"), in-app links ("See portfolio") and AutoPay setup alike (CC-32).
- **Destructive actions:** `ACTION_DANGER_ROW` (`ui/recipes/layout.ts`) puts them under a rule below the safe actions in `SipDetailScreen.tsx:322` (parked) and `DeviceSecurityScreen.tsx:192`; `LockScreen.tsx:158-170` puts "Remove PIN and sign out" (danger) beside a ghost "Go back" in an ordinary row. Danger actions confirm through `ConfirmDialog` with `confirmTone="danger"` (SIP cancel, AutoPay off, remove PIN). Sign-out is not danger-toned and differs between Profile and Blocked (CC-16).
- **Loading versus disabled:** `Button` `loading` disables and shows a spinner with `aria-busy` (`Button.tsx:59-69`); `ButtonLink` `disabled` renders a `<button disabled>` without `BUTTON_DISABLED` styling (`ButtonLink.tsx:59-65`).
- **Raw buttons:** fund sort pills `FundListScreen.tsx:78`; table sort headers `FundTable.tsx:53`, `:66`, `:79`; risk checkbox `RiskConsent.tsx:25`; PIN keys `PinPad.tsx:45`, `:57`, `:66`, `:76`; contact links `PublishedContactList.tsx:40`; shell back `ClientFrame.tsx:102`; toast dismiss `ToastProvider.tsx:62`.

Closest to `ui/`: `Button` and `ButtonLink` with their recipes.

### 3.4 Cards, lists and tables

| Pattern | Recipe | Where |
| --- | --- | --- |
| Card feed, one card per item | `CARD_STACK` + `FEED_MEASURE` | Activity ledger `ActivityScreen.tsx:182-214` (static card with inner links); payments `:251-260` (card links, parked); receipts `ReceiptsScreen.tsx:54-71` (card links); fund receipts `FundReceiptList.tsx:47` (card links); value updates `ValueUpdatesScreen.tsx:78-96` (static, fund name as inline link); fund value updates `FundValueUpdateList.tsx` (static); notifications `NotificationsScreen.tsx:133-181` (static, buttons) |
| Card grid | `ContentGrid` (2 from 480, 3 from 1024) | fund cards `FundListScreen.tsx:136` |
| | `BENTO` (6-column from 768) | dashboard `DashboardScreen.tsx:87`, `:211` |
| | `CARD_COLUMNS_WRAP[3]` (2 from 1024, 3 from 1440) | positions `PortfolioScreen.tsx:119`, schedules `SipSchedulesSection.tsx` |
| | `CARD_COLUMNS[2]` (2 from 1024) | SIP list `SipListScreen.tsx:75`, statements `StatementsScreen.tsx:108`, tickets `SupportScreen.tsx:225`, reviews `ReviewsScreen.tsx:35` |
| Menu list in a card | `NAV_LIST` / `NAV_ROW` + chevron | `ProfileScreen.tsx:141-153`, `LegalScreen.tsx:45-59` |
| Key-value list | `DataList` / `DetailRow` (10 / 35) | profile, contact, nominee, receipt detail, verification status, maturity (×2), grievance timelines, SIP detail, payment status |
| Figure blocks | `STAT_ROOT` + `STAT_LABEL`, hand-built (42 label spans) | dashboard, portfolio, invested fund summary, fund detail, statements, SIP start, SIP detail, payment status, verification status, update panel. The `Stat` pattern (`ui/patterns/DataList.tsx:42`) is unused by the client |
| Tables | private recipes | `FundTable.tsx:49` (`funds.recipe.ts:20-56`), `StatementPrintScreen.tsx:88` (`statements.recipe.ts`); no table recipe in `ui/` |
| Disclosure | `Disclosure` | support answers `SupportScreen.tsx:113` |
| Alerts as cards | `Alert`, `Card tone="feature"` | `MaturityOffersCard.tsx`, `PendingPaymentRecovery.tsx` (parked) |

Closest to `ui/`: `Card` with `CARD_LINK` for collections and `DataList` for detail. Missing: an interactive card state (CC-14) and a table recipe (CC-27).

### 3.5 Forms

Labels sit above the field in every `FormField` (12 px uppercase, `FIELD_LABEL`); help text and the field error sit below (`ui/primitives/FormField.tsx:21-58`).

| Form | Where | Element | Required marking | Inline errors | Summary error | Submit | Disabled until valid |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sign in | `LoginScreen.tsx:66` | `Form` | `*` on both | server field errors only | `Alert` above (`:62`) | primary lg full width | no |
| Forgot password | `ForgotPasswordScreen.tsx:54` | `Form` | `*` | none | `Alert` above (`:38`) | primary lg full width + ghost back | yes (email non-empty) |
| Reset password | `ResetPasswordScreen.tsx:122` | `Form` | `*` | live (length, match) | `Alert` above (`:107`) | primary lg full width | yes |
| Verify email | `EmailVerificationScreen.tsx:121` | `Form` in `Card` | `*` | none | two `Alert`s above (`:111`, `:116`) | primary lg + secondary lg, full width | yes (6 characters) |
| Lump sum (parked) | `LumpsumInvestScreen.tsx:169` | `div`, not a form | none on Amount | on submit | `Alert` between fields and submit (`:227`) | md full width trailing | no |
| SIP start (parked) | `SipStartScreen.tsx:196` | `div` | none; `STAT_LABEL` pseudo-labels for radio and presets | on submit | `Alert` below the card (`:298`) | md full width trailing | no |
| Nominee | `NomineeSection.tsx:113` | `Form` in `Card` | name, relation unmarked (optional); password `*` | live plus server refusals | `Alert` above (`:97`) | md trailing, natural width | yes |
| New email | `EmailChangePanel.tsx:176` | `Form` | `*` | none | `Alert` above (`:125`) | md trailing | yes |
| Email code | `EmailChangePanel.tsx:131` | `Form` | `*` | none | `Alert` above | md trailing + ghost | yes |
| Phone | `ContactDetailsScreen.tsx:105` | `Form` | `*` | live | `Alert` above (`:100`) | md trailing | yes |
| Password | `AccountPasswordPanel.tsx:97` | `Form` | `*` | live | `Alert` above (`:92`) | md trailing | yes |
| Device PIN | `DeviceSecurityScreen.tsx:217-243` | no form; `PinPad` | — | — | `Alert` at page top (`:156`) | md stretched + ghost "Cancel" | yes (4 digits) |
| Support request | `SupportScreen.tsx:126` | `Form` capped at 38rem | `*` on all three | on submit | `Alert` inside the form above the fields (`:142`) | md trailing | no |
| Review | `ReviewForm.tsx:101` | `Form` | rating label hand-built with `*` (`RatingControl.tsx`); "Comment (optional)" | on submit | `Alert` above (`:112`) | md trailing | only while pending |
| Maturity choice | `MaturityOptionsScreen.tsx:120-130` | no form; `RadioGroup` | legend | — | `Alert` above (`:116`) | md stretched | yes (choice changed) |
| Fund search | `FundListScreen.tsx:66-74` | lone input | no visible label (placeholder and `aria-label`) | — | — | — | — |

Closest to `ui/`: `Form` + `FormField` + summary `Alert` above + submit in the actions slot, as the profile forms do.

### 3.6 Loading, empty and error states (rule 4)

| Route | Reads | Loading | Empty | Failed read |
| --- | --- | --- | --- | --- |
| `/splash` | reachability probe | spinner | — | `Alert` + "Try again" |
| `/login` | support contacts (`LoginHelp`) | skeleton | unpublished copy | `ErrorState` + retry in the panel |
| `/verify-email` | eligibility | — | — | form stays usable |
| `/dashboard` | portfolio; funds; eligibility; SIP plans; schedules; maturity offers; notifications count | card skeletons | funds: **none** (CC-29) | `ErrorState`; inline "Couldn’t check" + "Try again" for eligibility and SIP plans; `Alert` + retry for maturity offers; unread badge silently 0 (CC-54) |
| `/funds` | catalogue | card or row skeletons | two empty states | `ErrorState` |
| `/funds/:fundId` | fund; eligibility | skeleton inside `Page` | holdings note | `ErrorState` outside `Page` (CC-21); eligibility `Alert` + retry |
| `/portfolio` | portfolio; fund names; SIP plans; schedules | skeleton | `EmptyState` | `ErrorState`; names `Alert` + retry |
| `/portfolio/funds/:fundId` | invested fund; portfolio; receipts; value updates | skeletons | per list | `ErrorState` each; "Show more" failure silent (CC-13) |
| `/portfolio/value-updates` | value updates; portfolio | skeleton | `EmptyState` | `ErrorState`; "Show more" failure silent |
| `/maturity-options/:offerId` | offer; portfolio | skeleton | info `Alert` | `ErrorState` |
| `/activity` | ledger; fund names; catalogue; payments (parked) | skeleton | `EmptyState` | `ErrorState`; "Show more" failure silent |
| `/activity/receipts`, `/:entryId` | receipts; receipt | skeleton | `EmptyState` | `ErrorState` (not found variant on detail); "Show more" failure silent |
| `/statements`, `/statements/print` | statements; portfolio | skeleton | `EmptyState` | `ErrorState`; "Open statement" failure `Alert` |
| `/notifications` | notifications | skeleton | `EmptyState` | `ErrorState`; "Show more" failure silent; mark-read failure toast |
| `/profile` | eligibility; nominee | bare 6rem skeleton | "No nominee" line | inline retry; `ErrorState` |
| `/profile/contact` | profile | bare 4rem skeleton | — | `ErrorState`; email panel hidden until loaded |
| `/profile/support` | answers; tickets; contacts | skeleton | `EmptyState` ×2 | `ErrorState`; "Show more" failure silent |
| `/profile/reviews` | reviews | skeleton | `EmptyState` in section | `ErrorState`; "Show more" failure silent |
| legal documents | document | skeleton | unpublished fallback | `ErrorState`; not-found shows the fallback |

- Global: `RouteErrorBoundary` (`ErrorState` "unknown" with retry), guard spinners, `EligibilityReadCheck` (`ErrorState` + retry), route-chunk spinner, and the `AsyncBoundary` "Updating" indicator on refetch.
- Failed reads take three forms: `ErrorState` through `AsyncBoundary` (35 uses, consistent), an `Alert` with "Try again" (`FundNames.tsx:43-45`, `FundDetailScreen.tsx:116-131`, `MaturityOffersCard.tsx:17`), and `InlineReadFailure` (3 uses).
- Empty-state titles vary in voice: "Nothing here yet", "Nothing to read", "No … yet", "You have not invested yet", "You have no SIP plans".

Closest to `ui/`: `AsyncBoundary` with `EmptyState` and `ErrorState`. `LoadMore` lacks an error state (CC-13).

### 3.7 Dialogs, sheets, toasts and gates

- **Sheet:** `ui/primitives/Sheet.tsx`, used only through `app/overlays/Modal.tsx`, which registers with the overlay stack so hardware back closes it. Bottom sheet with grip below 1024, centred 480 px panel from 1024 (`overlay.ts:1-21`).
- **ConfirmDialog:** 5 uses (`SipDetailScreen.tsx:350`, `:365`, `:380`, `:396`, parked; `DeviceSecurityScreen.tsx:246`). Default cancel label "Go back" (`ConfirmDialog.tsx:25`).
- **Modal direct:** `OptionalUpdateSheet.tsx`.
- **Native browser dialog:** `window.confirm` for the transactional back prompt (`ClientShellRoot.tsx:39-48`), outside the design system (CC-24).
- **Toasts:** `ToastProvider`; 3 calls, all errors (`NotificationsScreen.tsx:66`, `:76`; `PublishedContactList.tsx:26`). Success is always an inline `Alert` ("Request sent", "Review received", "Nominee saved", "Phone number changed").
- **Gates:** maintenance, mandatory update and device lock share the `BLOCK_*` recipes; banners for offline and planned maintenance (`feedbackShell.ts`).

Closest to `ui/`: `Modal`/`ConfirmDialog` over `Sheet`.

### 3.8 Money display

- **Formatter:** `domain/money.ts:111-130` (`formatINR`, `Intl.NumberFormat("en-IN", INR)`): Indian grouping, whole rupees unless `showDecimals`. `ui/patterns/MoneyValue.tsx:23` defaults `showDecimals` to false; `null` renders an em dash and a precision error "Amount unavailable".
- **Paise:** amounts arrive as integer paise strings and go through `toPaise` everywhere. Of 48 `MoneyValue` calls, 4 show paise (`ReceiptDetailScreen.tsx:52`; `MaturityOptionsScreen.tsx:48`, `:51`, `:54`) plus `maturityOptionCopy.ts:21`; 44 round to rupees (CC-11).
- **Hand-styled figures:** "Return" percentages are spans with `MONEY_BASE`/`MONEY_SIZE`/`MONEY_TONE.default` (`DashboardScreen.tsx:108`, `PortfolioScreen.tsx:96`, `:140`, `InvestedFundSummary.tsx:52`); growth uses `tone="signed"` (CC-12).
- **Input:** `AmountInput` with a fixed ₹ prefix, whole rupees, no grouping while typing (parked screens only).
- **Risk line:** `MoneyFootnote` (`ui/patterns/MoneyFootnote.tsx:8-17`): "Values recorded by BeOnEdge · Last updated … · Investments are subject to market risk." on 10 screens (dashboard, portfolio, invested fund, value updates, activity, receipts, receipt detail, maturity, statements, statement print). Missing on Funds and Fund detail (CC-10). Other wordings: splash footer (`SplashScreen.tsx:100`), sign-in footnote (`AuthLayout.tsx:110-113`). Drawn in `META_TEXT`, which fails contrast (CC-08).
- **Signal colours:** green/red via `tone="signed"` on growth, value changes, statement growth, corrections and withdrawals.
- **Labels:** fund size has "Fund size" on Funds and Fund detail but no label on the dashboard fund cards (`DashboardScreen.tsx:221-223`).

Closest to `ui/`: `MoneyValue` + `MoneyFootnote`.

### 3.9 Dates and times

- **Formatters:** `domain/dates.ts`: `formatDate` ("16 Nov 2026"), `formatDateTime` ("16 Nov 2026, 14:30", 24-hour), `formatMonth`, `formatYearMonth`, `formatCountdown`. All use `en-IN` and `Asia/Kolkata`. No "IST" label anywhere; no relative times.
- **Date-only values:** built by appending `T00:00:00Z` at 10 sites (`DashboardScreen.tsx:114`, `FundDetailScreen.tsx:92`, `ActivityScreen.tsx:195`, `ValueUpdatesScreen.tsx:89`, `ReceiptsScreen.tsx:62`, `ReceiptDetailScreen.tsx:19`, `:56`, `FundReceiptList.tsx:52`, `FundValueUpdateList.tsx:46`, `maturityOptionCopy.ts:12`, plus `MoneyFootnote.tsx:16`), two of them local `calendarDate` helpers.
- **Months:** `formatMonth(\`${period}-01\`)` (`StatementsScreen.tsx:112`, `StatementPrintScreen.tsx:106`) beside `formatYearMonth` (maturity).
- **Date or date-time:** date-time for notifications, tickets, reviews, receipt "Recorded", verification "Last checked", code expiry, maintenance; date for activity, receipts, value updates, statements. "As at" (`DashboardScreen.tsx:114`) and "As of" (`FundDetailScreen.tsx:92`) both appear.

Closest to `ui/`: `domain/dates.ts` formatters; a calendar-date helper is missing (CC-35).

### 3.10 Spacing and typography

- **Spacing steps:** page side padding 16/24/32; page top 32/40/64; page gap 32/40/48 (`layout.ts:3-11`); section gap 16; card padding 20/24/28, gap 12 (`surface.ts` `CARD_BASE`); stacks 8 and 16; action row 8; form gap 16, actions gap 8 plus 8 top; legal sections 24; activity panel 32. One-offs: `gap-[5px]` (nav item), `pt-1` (`NotificationsScreen.tsx:159`).
- **Type steps:** tokens 12, 13, 15 (body), 16, 18, 22, 28, 36 px, plus a raw `--text-2xs: 10px` (`ui/tokens/theme.css:78`) and clamp sizes for page, display and money. Display face (Fraunces) for page, section and card titles; UI face (Instrument Sans) elsewhere.
- **Small labels:** field labels 12 px uppercase; figure labels (`STAT_LABEL`), eyebrows, nav labels and table heads 10 px uppercase; table heads track 0.12em (`statements.recipe.ts`) or 0.16em (`funds.recipe.ts:41`).

Closest to `ui/`: the `ui/recipes/layout.ts` and `text.ts` steps.

### 3.11 Icons

No icon primitive. 15 glyphs in 9 files:

| Glyph | Where | viewBox / stroke / size |
| --- | --- | --- |
| Home, Funds, Portfolio, Activity, Profile, Bell, Back | `shells/client/navGlyphs.tsx:12-60` | 24 / 1.15 / 20 px |
| Trailing arrow (×2 copies) | `ui/primitives/Button.tsx:30`, `ButtonLink.tsx:27` | 14 / 1.25 / 13 px |
| Close | `ui/primitives/Sheet.tsx:142` | 20 / 1.4 / 20 px |
| Toast dismiss | `app/providers/ToastProvider.tsx:70` | 16 / 1.5 / 16 px |
| Disclosure plus | `ui/patterns/DataList.tsx:79` | 18 / 1.15 / 16 px |
| Chevron (×2 copies) | `ProfileScreen.tsx:72`, `LegalScreen.tsx:24` | 18 / 1.15 / 16 px |
| Sort caret | `FundTable.tsx:33` | 9 / 1.3 / 10 px |
| Check | `RiskConsent.tsx:44` | 12 / 1.6 / 12 px |

Closest to `ui/`: `navGlyphs.tsx` with the `size-icon-*` tokens.

### 3.12 Styles that bypass `ui/`

- **Whole-screen CSS:** `features/auth/splash.css` (px sizes, `white`, its own easing curves, 13/12 px type).
- **Raw class strings in TSX:** `ResetPasswordScreen.tsx:91` (`underline` on an `<a>`), `FundStockAllocation.tsx:46` (list reset), `SupportScreen.tsx:111` (`flex flex-col`), `NotificationsScreen.tsx:159` (`pt-1`), `ProfileScreen.tsx:147` (`max-w-[46ch]`), `LegalScreen.tsx:52` (`max-w-[52ch]`).
- **Inline styles:** `FundStockAllocation.tsx:43`, `:49`, `:56` (conic-gradient pie, swatches); `UpdateInstallPanel.tsx:56` (progress transform, legitimate).
- **Arbitrary values in feature recipes:** `profile.recipe.ts:5` (gold gradient re-declared instead of `grad-gold`), `funds.recipe.ts:29-30` (card radius re-declared), `funds.recipe.ts:41` (`tracking-[0.16em]`), `device-security.recipe.ts:4-5`, `:18`, `statements.recipe.ts:6`, `portfolio.recipe.ts:3`, `payments.recipe.ts:6`, `sip.recipe.ts:12`, `legal.recipe.ts:13`.
- **Cross-surface import:** client `FundTable.tsx:12` imports `ADMIN_NUMERIC` from `ui/recipes/admin.ts`.
- **Raw token:** `--text-2xs: 10px` is a literal, not a `--be-*` token (`theme.css:78`).

## 4. Findings

Severity: high = broken or blocks a task; medium = confusing or breaks a rule; low = polish. Every direction stays within DEC-45 and names the `ui/` item to standardise on, or says one is missing. Findings that touch only the shell but show on parked routes are marked; the maintainer decides whether DEC-14 covers them.

| ID | Sev | Routes and places | What is inconsistent or wrong | Direction |
| --- | --- | --- | --- | --- |
| CC-01 | high | `/funds/:fundId/invest/lumpsum`, `/funds/:fundId/invest/sip`. `shells/client/ClientFrame.tsx:54-59`, `:107`; parents `app/routing/clientRoutes.ts:109`, `:119` | The phone header back navigates to the literal path `/funds/:fundId`, because the frame uses `route.back.path` without filling in parameters. Hardware back fills them in (`app/native/backPolicy.ts:45`), and `routeIntegrity.test.ts:55-66` only checks that filling is possible. The fund page then loads fund id `:fundId` and shows an error. With payments off these routes are reached by old links or typed URLs, so reach is limited today. The fault is in the shell, not the payment screens. | Resolve the header target with `createBackPolicyResolver` (the hardware path), so both use one resolver. |
| CC-02 | medium | Every route with a back target. Header `ClientFrame.tsx:107` (push), hardware `NativeBackCoordinator.tsx:58` (replace), browser (history); transactional prompt only on hardware back (`NativeBackCoordinator.tsx:52-55`) | Three back behaviours. The header pushes the parent, so the next browser back returns to the child. Hardware back replaces. Screens with several ways in always go to one fixed parent: fund detail (from the dashboard `DashboardScreen.tsx:215`, invested fund `InvestedFundScreen.tsx:47`), invested fund (portfolio, activity `ActivityScreen.tsx:191`, value updates `ValueUpdatesScreen.tsx:82`), receipt detail (activity `:198`, fund receipts `FundReceiptList.tsx:47`, notifications), maturity options (dashboard, portfolio, notifications), notifications (bell, profile), investor charter and grievance (fund page `FundDetailScreen.tsx:167-172`, legal), verify email (ignores `returnTo`). The header back also skips the invest-screen prompt. | Pick one rule (parent or history) for all three paths; keep `ICON_ACTION` + `BackGlyph` as the control. |
| CC-03 | medium | Rows 7, 10, 14-16, 19, 23, 25, 27-34 (and parked 11, 12, 21, 22) at 1280/1440. `ui/recipes/shellClient.ts:9` (`lg:hidden`); top nav `ClientFrame.tsx:71-98` | No in-app back control at web widths. Where a back exists it is an ad hoc text link in four styles: `ForgotPasswordScreen.tsx:49-51`, `:69-71`; `StatementPrintScreen.tsx:54-56`; `ReceiptDetailScreen.tsx:61-63`; `SipDetailScreen.tsx:186-188`; `PaymentStatusScreen.tsx:198-200`. This is the maintainer's "back buttons differ between pages". | Missing primitive: a back slot in `PageHeader` (icon plus parent title) fed by the shared resolver, shown at every width or at `lg` only; then retire the ad hoc links. |
| CC-04 | medium | `/funds`, `/portfolio`, `/activity`, `/profile` (`clientRoutes.ts:91`, `:130`, `:167`, `:251`) vs `/dashboard` (`:81`) | Tab roots show a back arrow to Home on phones while Home shows none, and the bottom nav already reaches them. Tab and back semantics are mixed. | Give tab roots no header back (`backPolicy.ts` already treats primary routes apart). |
| CC-05 | medium | All nested routes. `ClientFrame.tsx:80`, `:136`; `NavPlacement.domain` `app/routing/routeManifest.ts:12-17` unused | No tab is marked current on nested routes (fund detail, invested fund, value updates, maturity, receipts, statements, notifications, profile subpages, legal), at any width. | Mark the tab whose domain owns the route; use the existing `nav.domain` (or parent chain). |
| CC-06 | medium | All routes. Header `ClientFrame.tsx:100-124`; `frontend_stack_ts/index.html:11`; admin `shells/admin/AdminFrame.tsx:109` | The client never shows manifest titles: no title in the phone header, the browser tab always reads "BeOnEdge" (WCAG 2.4.2 on the web), and `PageHeader` titles differ from the manifest: "Good to see you, …" / Home, fund name / Fund, fund name / Your investment, "Your maturity options" / Maturity options, "We could not find that page" / Not found, blocked panel titles / Account unavailable, none / Starting. | Use the route title for `document.title` and the phone header title (scrolled state); `PageHeader` keeps its h1. |
| CC-07 | medium | All route changes. `app/providers/AppProviders.tsx:40`, `app/routing/buildRouter.tsx`; no `scrollTo`, `ScrollRestoration` or focus call in `app`, `shells` or `features` | Nothing resets scroll or moves focus on navigation, so a new page can open at the previous page's offset and screen readers hear no change. `STATIC`: confirm at runtime. | Add a route-change handler in the shell (scroll top, focus the h1); `PageHeader` is the focus target. |
| CC-08 | medium | Every screen. `--be-fg-faint` = `#8a929d` (`ui/tokens/tokens-core.css:15`, `:35`): 2.79:1 on the page background, 2.99:1 on cards | Text in `fg-faint` fails WCAG AA (needs 4.5:1): `META_TEXT` (`ui/recipes/text.ts:26`), which draws the market-risk line, "As at" dates and counts; `STAT_LABEL` (`datalist.ts:26`), the 10 px label on every figure; `FIELD_HINT` (`field.ts:12`); `META_ROW` (`text.ts:34`); `REFERENCE_TEXT` (`:37`); `STATE_REFERENCE` (`state.ts:19`); the sign-in markers and risk footnote (`auth.ts:32`, `:65`); "Not available" in the fund table; placeholders (`base.css:44`). `fg-muted` measures 5.3-5.7:1. | Token-level: text recipes use `fg-muted`; keep `fg-faint` for non-text (glyphs, rules). |
| CC-09 | medium | `/funds/:fundId`. `ui/tokens/tokens-elevation.css:55-56`; `ui/charts/chartMath.ts:15-24`; `FundStockAllocation.tsx` via `colourFor` | Chart series 1 is `#8a6428` (exactly `--be-gold-deep`) and series 2 `#c79a53` is a gold. RULES: gold is a brand accent only, never a chart series. | Replace series 1-2 in the token file with non-gold hues; `DONUT_PALETTE` stays the single source. |
| CC-10 | medium | `/funds` (`FundListScreen.tsx`), `/funds/:fundId` (`FundDetailScreen.tsx`); wordings `MoneyFootnote.tsx:8-10`, `SplashScreen.tsx:100`, `AuthLayout.tsx:110-113` | Money screens without the market-risk line: fund sizes and minimum amounts show with no source, freshness or risk line. The line also appears in three wordings. | `MoneyFootnote` on every money screen (a variant without "Values recorded by BeOnEdge" for fund sizes, with the fund size date); one standard sentence. |
| CC-11 | medium | `/activity/receipts` vs `/:entryId`; `/portfolio`, `/dashboard`, `/portfolio/funds/:fundId` vs `/maturity-options/:offerId`; all money screens. `ui/patterns/MoneyValue.tsx:23`, `domain/money.ts:111-117` | 44 of 48 `MoneyValue` calls round to whole rupees; 4 show paise. The same receipt reads "₹1,235" in the list (`ReceiptsScreen.tsx:66`, `FundReceiptList.tsx:56`) and "₹1,234.56" on its detail (`ReceiptDetailScreen.tsx:52`); the same holding rounds on the portfolio (`PortfolioScreen.tsx:79-87`) and shows paise on maturity (`MaturityOptionsScreen.tsx:48-54`). | One precision rule inside `MoneyValue` (for example paise whenever the amount has them), not per call. |
| CC-12 | medium | `/dashboard`, `/portfolio`, `/portfolio/funds/:fundId`. `DashboardScreen.tsx:99-136`, `:108`; `PortfolioScreen.tsx:77-101`, `:96`, `:122-145`, `:140`; `InvestedFundSummary.tsx:36-59`, `:52` | The value summary (current value, invested, growth, return) is built by hand four ways: dashboard hero with its own `SPLIT`, portfolio card, a near copy in the invested-fund summary, and the position card grid. "Return" is styled with raw `MONEY_*` classes and never coloured, while growth is signed green/red. `Stat` (`ui/patterns/DataList.tsx:42`) exists and is unused; 42 label spans are hand-assembled. | Use `Stat` for figure blocks; missing pattern: a shared value-summary component and a signed percent display in `ui/patterns`. |
| CC-13 | medium | `/notifications`, `/profile/reviews`, `/portfolio/value-updates`, `/activity` (×2), `/profile/support`, `/activity/receipts`, `/portfolio/funds/:fundId` (×2). `ui/patterns/LoadMore.tsx:11-21`; `api/paged.ts:96-116`; `AsyncBoundary.tsx:52` | When "Show more" fails, the loaded rows stay, `AsyncBoundary` only shows errors when there is no data, and `LoadMore` has no error state, so the failure is silent. Rule 4. Uses: `NotificationsScreen.tsx:186`, `ReviewsScreen.tsx:104`, `ValueUpdatesScreen.tsx:99`, `ActivityScreen.tsx:218`, `:263`, `SupportScreen.tsx:251`, `ReceiptsScreen.tsx:75`, `FundReceiptList.tsx:65`, `FundValueUpdateList.tsx:58`. | Give `LoadMore` an inline error with retry (the `Alert` pattern). |
| CC-14 | medium | `/funds`, `/portfolio`, `/activity/receipts`, `/portfolio/funds/:fundId`, `/dashboard`; parked `/sips`, payments tab. `ui/recipes/surface.ts:16`, `:36` | Card links have no hover, pressed or card-level focus state: `SHELL` waits for a `data-interactive` child that nothing sets. Link cards (`SipListScreen.tsx:79`, `PortfolioScreen.tsx:121`, `PaymentCard.tsx:34`, `FundListScreen.tsx:138`, `ReceiptsScreen.tsx:56`, `FundReceiptList.tsx:47`, `DashboardScreen.tsx:215`) look the same as static cards (schedules, ledger entries with inner links, value updates, statements). | Make `CARD_LINK` carry the interactive state (and a chevron or similar cue) in `ui/recipes/surface.ts`. |
| CC-15 | medium | Most routes | Five ways to navigate: `ButtonLink` secondary sm ("See portfolio" `DashboardScreen.tsx:133`, "Value updates" `PortfolioScreen.tsx:107`, "Fund details" `InvestedFundScreen.tsx:47`, "Receipts" `ActivityScreen.tsx:142`, "Print statement" `StatementsScreen.tsx:74`); `ButtonLink` ghost sm ("See all" `DashboardScreen.tsx:190`, legal links `FundDetailScreen.tsx:167`, `:170`, "Forgot your password?" `LoginScreen.tsx:115`); inline `LINK_TEXT` (`ActivityScreen.tsx:191`, `:198`, `ValueUpdatesScreen.tsx:82`); card links (CC-14); menu rows (`ProfileScreen.tsx:144`, `LegalScreen.tsx:49`). Two navigations are `Button` + `navigate` instead of links (`NotFoundScreen.tsx:17-26`, `BlockedScreen.tsx:55-64`). | `ButtonLink` for page-level moves, `LINK_TEXT` inline, `CARD_LINK` for collection items, `NAV_ROW` for menus; navigation is always a link element. |
| CC-16 | medium | Several | The same action looks different. "Contact support": primary lg full width `Button` (`BlockedScreen.tsx:55-64`), secondary md (`VerificationStatusScreen.tsx:82`), secondary sm trailing (`LegalDocumentScreen.tsx:48`, `:83`), primary md (`PaymentStatusScreen.tsx:186`, parked), "Open support" primary trailing (`GrievanceScreen.tsx:103-105`). "Try again": secondary sm (`ErrorState.tsx:72-77`, `FundNames.tsx:43-45`, `FundDetailScreen.tsx:120-129`, `MaturityOffersCard.tsx:17`), ghost sm (`InlineReadFailure.tsx:20-22`), primary lg full width (`SplashScreen.tsx:91-94`), primary (`UpdateInstallPanel.tsx:81-83`). "Sign out": secondary md without loading (`ProfileScreen.tsx:161`) vs secondary lg full width with loading (`BlockedScreen.tsx:65-79`). "Browse funds" with and without the trailing arrow (`PortfolioScreen.tsx:67`, `ActivityScreen.tsx:173`). | One tone and size per action kind, recorded next to `ui/recipes/button.ts`. |
| CC-17 | medium | All form routes (3.5) | Submit buttons come in four shapes: lg full width (sign-in screens, verify email), md full width trailing (invest, parked), md natural width trailing (profile forms, support, reviews), md stretched (maturity, PIN). The invest forms are `div`s, so Enter does not submit (`LumpsumInvestScreen.tsx:169`, `SipStartScreen.tsx:196`, parked); the maturity chooser and PIN entry are not forms either. | One submit placement in `Form` actions (`FORM_ACTIONS`), with one size per surface (for example full width on phones, natural width on the web). |
| CC-18 | medium | All form routes (3.5) | Validation timing differs: live (reset password, change password, phone, nominee), on submit (support, review, invest), server only (sign in). Submit is disabled until valid on ten forms (including the PIN and maturity controls) and always enabled on five (sign in, support, review, both invest forms), and a disabled button gives no reason. | One rule: enabled submit, errors on submit and on blur, through `FormField` `error`. |
| CC-19 | medium | `/profile/support`, `/profile/reviews`, `/maturity-options/:offerId`, `/verify-email` | Raw server messages reach the user: `SupportScreen.tsx:66-67`, `ReviewForm.tsx:30`, `MaturityOptionsScreen.tsx:84`, bypassing `describeClientFailure` (`domain/failure.ts`). `EmailVerificationScreen.tsx:20-42` keeps its own copy of messages that `domain/failure.ts` already has, with different wording. | Route every failure through `describeClientFailure` and its contexts. |
| CC-20 | medium | `/activity`, `/portfolio`, `/portfolio/funds/:fundId`, `/statements` | Recorded investments get five names: "Payment recorded" (`ActivityScreen.tsx:42`), "N payments" (`PortfolioScreen.tsx:144`, `InvestedFundSummary.tsx:57`), "recorded payments" (`InvestedFundScreen.tsx:19`), "Recorded investments" (`FundReceiptList.tsx:27`), "Receipts", and "Contributions" on statements (`StatementsScreen.tsx:129`). With payments off (DEC-25), "payment" invites the how-to-pay question. | One noun in copy ("recorded investment"); no `ui/` change. |
| CC-21 | medium | `/funds/:fundId` (`FundDetailScreen.tsx:42`) | The loading skeleton is wrapped in `Page`, but the error state is not, so a failed fund read (including CC-01) renders with no page padding, header or width. Every other screen keeps `AsyncBoundary` inside `Page`. | Put `AsyncBoundary` inside `Page` with a `PageHeader`, as elsewhere. |
| CC-22 | medium | `/funds`, `/dashboard`, `/portfolio`, `/statements`, `/profile/support`, `/profile/reviews`, `/sips` | Four grid systems with different breakpoints: `ContentGrid` (2 columns from 480), `BENTO` (6-column from 768), `CARD_COLUMNS` (2 from 1024, 3 from 1440), `CARD_COLUMNS_WRAP`. At 768 fund cards sit two across while statements, tickets, reviews, positions and SIP plans stay in one column. | Standardise on `ContentGrid`/`CARD_COLUMNS` with one breakpoint rule per collection type. |
| CC-23 | medium | Most routes at 1280/1440 | Content caps differ per block: feeds 68rem (`FEED_MEASURE`), detail rows and menus 44rem (`LIST_ROW`, `NAV_LIST`), forms 38rem (`FIELD_MEASURE`), state panels 46rem, inside a ~1050-1180 px page, so right edges are ragged (Profile: full-width identity card above a 44rem menu inside a full-width card). Sibling Profile pages pick different page widths: contact, support, reviews, legal `default`; email verification, security `form`. | Choose page widths per screen type (`Page` `default`/`form`) and one measure per content type in `ui/recipes/layout.ts`. |
| CC-24 | medium | `/funds/:fundId/invest/*` (parked routes; shell code). `ClientShellRoot.tsx:39-48` | The transactional back prompt uses `window.confirm`, outside the design system, and also fires on the payments-off page, which has no form ("Leave without investing? Nothing will be submitted."). | `ConfirmDialog`, and only when a form is dirty. Maintainer to say whether DEC-14 covers this shell change. |
| CC-25 | medium | `/dashboard`, `/profile`, `/profile/email-verification`, `/profile/contact` | Status is shown three ways: `StatusBadge` (domain labels), `Badge` with literal labels ("Reversed", "Closed", "From your notification", categories: `ReceiptsScreen.tsx:60`, `:63`, `SipSchedulesSection.tsx:39`, `ValueUpdatesScreen.tsx:93`), and plain text ("Locked", "Not verified by SMS"). The investing state reads "Available" (`DashboardScreen.tsx:154`), "Unlocked" (`ProfileScreen.tsx:132`) and "Available / Not yet available" (`VerificationStatusScreen.tsx:58`). | `StatusBadge` with a domain presentation for every state; one label set. |
| CC-26 | low | `/funds`. `FundListScreen.tsx:66-91`; `funds.recipe.ts:8-14`; `FundTable.tsx:56`, `:69`, `:82` | Search has no visible label; sort pills use a one-off recipe instead of `PresetChoice`; table sort headers use `aria-pressed` rather than `aria-sort`; sorting is pills below 1024 and headers above. | `FormField` label; `PresetChoice` (or `Tabs`) for sort; `aria-sort` on headers. |
| CC-27 | low | `/funds`, `/statements/print`. `funds.recipe.ts:20-56`, `statements.recipe.ts`; `FundTable.tsx:12` | Two private table recipe sets, and the client table imports `ADMIN_NUMERIC` from `ui/recipes/admin.ts`. | Missing recipe: a shared table recipe in `ui/recipes`. |
| CC-28 | low | `/funds/:fundId`. `FundStockAllocation.tsx:16`, `:36`, `:42`, `:46` | A second chart implementation (CSS conic-gradient pie) beside `DonutChart`; unstyled `<h3>`; raw list classes; one-off `PIE_SIZE`. | `DonutChart` (or its recipes) and `CARD_TITLE`/`LIST_ROOT`. |
| CC-29 | low | `/dashboard` (`DashboardScreen.tsx:195-231`) | The Funds section has no empty state, so with no published funds it shows a title and nothing. | `EmptyState` via `AsyncBoundary` `isEmpty`, as `/funds` does. |
| CC-30 | low | Forms (3.5) | Required and optional marking differs: `*` on most required fields, none on the required amount fields (parked), nominee fields optional with no marker, "Comment (optional)" in the label, the rating label hand-built (`RatingControl.tsx`). | `FormField` `required` for every required field; "(optional)" convention in `FormField`. |
| CC-31 | low | Forms (3.5) | The summary error sits above the form on most screens, between fields and submit on the invest forms (`LumpsumInvestScreen.tsx:227`, `SipStartScreen.tsx:298`), and at page top for the PIN (`DeviceSecurityScreen.tsx:156`). | `Alert` above the form, inside `Form`. |
| CC-32 | low | 31 controls. `Button.tsx:28-43`, `ButtonLink.tsx:25-40` | The trailing up-right arrow reads as "external link" but marks submits and in-app links alike, and its SVG is duplicated. | Define what `trailing` means (forward navigation only) and share one glyph. |
| CC-33 | low | `/portfolio/value-updates` (`ValueUpdatesScreen.tsx:80`), `/notifications` (`NotificationsScreen.tsx:138`) | Card elevation marks state (the highlighted update, unread notifications), while elevation elsewhere marks the main card on a screen. | A state treatment (badge or tone) instead of `Card` `elevated`. |
| CC-34 | low | `/notifications` (`NotificationsScreen.tsx:124`), `/profile` (`ProfileScreen.tsx:37`) | "Payment confirmations, SIP reminders and account updates" while payments are off. | Copy only. |
| CC-35 | low | 10 sites (3.9) | No shared calendar-date helper (`T00:00:00Z` appended at each site, two local helpers); times have no zone label; month formatting two ways; "As at" vs "As of". | Missing helper: `formatCalendarDate` in `domain/dates.ts`; one phrase. |
| CC-36 | low | 3.11 | No icon primitive; 15 glyphs with five stroke widths and seven viewBoxes; chevron and trailing arrow defined twice. | Missing primitive: a small icon set in `ui/` using the `size-icon-*` tokens. |
| CC-37 | low | 3.12 | Styles that bypass `ui/`: `splash.css`, raw class strings, inline styles, arbitrary values, a re-declared gold gradient, the 10 px literal token. | The matching recipes (`grad-gold`, `LINK_TEXT`, `LIST_ROOT`, text steps); turn `text-2xs` into a `--be-*` token. |
| CC-38 | low | `orders.recipe.ts:4`, `funds.recipe.ts:20`, `sip.recipe.ts:12`; `ReceiptsScreen.tsx:22`, `FundReceiptList.tsx:6`, `FundValueUpdateList.tsx:4` | Feature recipes duplicate `ui/` ones (`RULES` ≈ list, `FUND_DISCLOSURE_BODY` ≈ `PROSE_SM`, `SIP_HINT` ≈ `HINT_MUTED`), and features import each other's recipes (activity rows in receipts, portfolio rows in invested funds). | Move shared row recipes into `ui/recipes/datalist.ts`; drop duplicates. |
| CC-39 | low | `ui/recipes/feedbackShell.ts:17` | The toast region always sits above the bottom-nav height, also on bare routes with no nav. Toasts are used only for 3 errors; all success is inline. | Offset from the chrome actually shown; one success-feedback rule. |
| CC-40 | low | All routes (70 `Skeleton` calls) | Skeletons are hand-composed per screen with different shapes; the fund page wraps its skeleton in `Page`, others do not. | Missing pattern: card, row and figure skeletons in `ui/patterns`. |
| CC-41 | low | `/profile/support` for suspended or closed accounts (`clientRoutes.ts:286`) | The full chrome shows, but every tab and the header back lead to `/blocked`. | Bare layout for terminal accounts, as `/blocked` has. |
| CC-42 | low | Copy-wide | "We could not" (13) vs "We couldn't" (37); a curly apostrophe at `SplashScreen.tsx:82` vs straight elsewhere; sign-in eyebrow "Client access" vs "BeOnEdge" (`LoginScreen.tsx:49`, `ForgotPasswordScreen.tsx:32`). | Copy only. |
| CC-43 | low | `ResetPasswordScreen.tsx:64`, `:83`, `:91`, `:113`, `:116`; `DashboardScreen.tsx:77`; `FundDetailScreen.tsx:139`; `VerificationStatusScreen.tsx:82`; `LegalDocumentScreen.tsx:48` | A raw `<a className="underline">` and literal paths (`/login`, `/password/forgot`, `/verify-email`, `/profile/support`) where route constants exist. | `LINK_TEXT`; `clientRoutes.ts` constants. |
| CC-44 | low | `/profile` (`ProfileScreen.tsx:100-105`, `:161`); `/profile/security` (`DeviceSecurityScreen.tsx:116`, `:151`) | Sign-out shows no progress; a success `Alert` titled "Saved" announces "Choose a new PIN." | `loading` on sign-out; neutral title for step notices. |
| CC-45 | low | Card titles across screens | Card titles are spans, so screen-reader heading navigation skips cards; legal cards use h2 and the allocation card an h3. | One heading rule for card titles. |
| CC-46 | low | `/profile/security`, device lock (`PinPad.tsx`) | PIN digits can only be clicked, not typed, on the web. | Accept keyboard digits in `PinPad`. |
| CC-47 | low | `/notifications` (`NotificationsScreen.tsx:140-143`) | The text block is a clickable `div` beside the "Open" button (mouse-only target). | Keep the button as the only target, or make the card a link (CC-14). |
| CC-48 | low | `/activity/receipts` vs `/portfolio/funds/:fundId`; `/portfolio/value-updates` vs `/portfolio/funds/:fundId` | The same data uses different row anatomy: receipts with or without the fund name; value updates with fund link and labelled date vs bare date. | One row recipe per record type. |
| CC-49 | low | `/statements` vs `/statements/print` (`StatementsScreen.tsx:123-156`, `StatementPrintScreen.tsx:30-38`) | The screen card omits the Corrections figure that the print table shows. | Same figure set on both. |
| CC-50 | low | `/portfolio` (`PortfolioScreen.tsx:151`, `:156`) | The money footnote sits above the schedules section and only renders when the portfolio read succeeds; other screens end with it unconditionally. | Footnote last, always. |
| CC-51 | low | 768 web | A desktop browser at 768-1023 px gets the phone chrome (header back, bottom nav). Observation for U5, which decides the 768 layout. | — |
| CC-52 | low | `LINK_TEXT` (`ui/recipes/text.ts`), `ButtonLink` sm at `lg` | Inline links have 36 px targets on phones where other controls use 44 px. | `min-h-target` for phone-width links. |
| CC-53 | low | `ClientFrame.tsx:105`, `ConfirmDialog.tsx:25`, `LockScreen.tsx:162-169` | "Go back" names the shell back, a dialog cancel and a panel close. | Distinct labels ("Cancel", "Keep …"). |
| CC-54 | low | Chrome bell (`ClientFrame.tsx:60`); `MoneyFootnote` callers | A failed notifications read shows no badge; a failed portfolio read drops "Last updated" from the footnote without saying so. Minor rule-4 gaps. | Show "unknown" rather than nothing. |
| CC-55 | low | `STAT_LABEL`, `EYEBROW`, nav labels, table heads | 10 px uppercase labels (combined with CC-08 contrast) on every figure and the bottom nav. | Raise to the 12 px step for labels that carry meaning. |

Counts: 55 findings, 1 high, 24 medium, 30 low.

## 5. Copy against the RULES copy rules

Searched 224 client files (admin excluded).

- **BeOnEdge naming:** no "BOE" or "BE" in client strings.
- **Exclamation marks, emoji:** none found.
- **Bank details, payment instructions, reference numbers:** none on non-parked screens. Parked copy is listed in section 6.
- **Banned words:** "guarantee" appears only in negated disclaimers: `app/layouts/AuthLayout.tsx:111-112` ("BeOnEdge does not guarantee a return") and `features/orders/RiskConsent.tsx:58-59` (parked). Not a promise, but the rule lists the word and the standard line is "Investments are subject to market risk."; the maintainer may prefer the standard line (CC-10).
- **Market-risk line missing on money screens:** `features/funds/FundListScreen.tsx` (fund sizes) and `features/funds/FundDetailScreen.tsx` (minimum amounts, fund size). See CC-10.
- **Risk line legibility:** the line renders in `META_TEXT` at about 3:1 contrast (CC-08).
- **Not rule breaks, but copy consistency:** terminology (CC-20), "Payment confirmations" while payments are off (CC-34), contraction style and apostrophes (CC-42).

## 6. Parked under DEC-14

These routes and components belong to payments, AutoPay or the gateway. They are inventoried above for completeness; this audit proposes no change to them.

- Routes: `/funds/:fundId/invest/lumpsum` (`features/orders/LumpsumInvestScreen.tsx`), `/funds/:fundId/invest/sip` (`features/sip/SipStartScreen.tsx`), `/pay/return` (`features/payments/PaymentReturnScreen.tsx`), `/activity/payments/:paymentId` (`features/payments/PaymentStatusScreen.tsx`), `/sips` (`features/sip/SipListScreen.tsx`), `/sips/:sipPlanId` (`features/sip/SipDetailScreen.tsx`).
- Components on other routes: `features/payments/PendingPaymentRecovery.tsx` (dashboard), the Activity "Payments" tab with `features/activity/OnlinePaymentHistory.tsx` and `PaymentCard.tsx`, `features/orders/RiskConsent.tsx`, the payments flag reader `features/investing/onlinePayments.ts` (fails open on a failed config read, already parked as `finding-27`), and the checkout modules in `features/payments/`.
- Parked copy noted, unchanged: "Back from PhonePe", "Continue to PhonePe", the PhonePe and UPI AutoPay descriptions, "How long it takes depends on your bank" (`PaymentStatusScreen.tsx:46`), the "Fund" name fallback on payment and SIP screens.
- Shell findings that show on parked routes (CC-01, CC-24) live in shell code, not in these screens; the maintainer decides whether DEC-14 covers them.

## 7. What code alone cannot settle

For lane `u-audits` (runtime) and U5:

- Actual rendering at 360, 390, 768, 1280 and 1440: wrapping of long fund names and money figures, bottom-nav label fit, sideways scroll, the auth narrative pushing the sign-in panel below the fold on phones.
- Whether CC-07 shows (scroll position after navigation) and how CC-01 renders (validation or not-found error).
- Contrast on the gradient and mesh backgrounds, and focus-ring visibility on the dark nav.
- Android WebView behaviour of hardware back, `window.confirm` and the keyboard offset.
- Screen-reader announcements, focus order and the `Reveal` animation under reduced motion.
- Whether production amounts carry paise often enough for CC-11 to show.
- Phase I screens, which are not on `main` at `d4c817e`.

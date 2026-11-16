# Admin app: code-side UI consistency audit (U7)

Lane `u-static-admin`, tally task `M16-ui-overhaul:U7-static-admin`. It is a read-only audit under DEC-40, DEC-45, DEC-47 and DEC-56. It changes no application source and proposes no new visual direction (DEC-45). Fixes wait for the per-surface plan (U5) and its approval.

## 1. Method

- **Commit:** `d4c817e` on `main`, read in the worktree of branch `track/u-static-admin`.
- **Evidence:** all evidence is `STATIC`, meaning source was read and nothing was rendered.
  - No dev server, browser, emulator or test was run. Screenshots and runtime checks belong to lane `u-audits`.
  - Phase I screens (nominee requests, SIP early exit) were not on `main` at this commit, so they are not covered here. DEC-47 has them audited when they land.
- **Path convention:** every `file:line` below is relative to `frontend_stack_ts/src/` unless it starts with another top-level folder.
- **Reference widths (DEC-56):**
  - The admin phone is 390 px; the admin web widths are 1280, 1440 and 1920 px.
  - The breakpoints are reset in `ui/tokens/theme.css:171-175`: `sm` 480, `md` 768, `lg` 1024, `xl` 1440.
  - At 390 px no breakpoint applies. At 1280 px only `lg` applies. At 1440 and 1920 px `xl` also applies.

### Files read

- **Routing:** `app/routing/adminRoutes.ts`, `routeManifest.ts`, `buildRouter.tsx`, `guards.tsx`, `resolveDestination.ts`, `RouteErrorBoundary.tsx`.
- **Shell:** `shells/admin/AdminFrame.tsx`, `AdminShellRoot.tsx`.
- **App layer:** `app/layouts/Page.tsx`, `PageHeader.tsx`, `Section.tsx`, `ContentGrid.tsx`, `AuthLayout.tsx`; `app/overlays/ConfirmDialog.tsx`, `Modal.tsx`; `app/native/backPolicy.ts`, `NativeBackCoordinator.tsx`.
- **Design layer:** all 47 non-test files under `ui/` (3,626 lines): tokens, primitives, patterns, recipes, styles, charts and motion.
- **Admin features:** all 157 non-test files under `features/admin/` (21,138 lines), across 25 feature folders.
  - Every admin route's screen component was read in full, along with every local component it renders.
- **Shared screens the admin build mounts:** `features/auth/LoginScreen.tsx`, `NotFoundScreen.tsx`, `SplashScreen.tsx`; `features/funds/FundStockAllocation.tsx`.
- **Helpers whose behaviour the UI depends on:**
  - `api/paged.ts`, `api/errors.ts`, `api/idempotency.ts`;
  - `domain/money.ts`, `dates.ts`, `status.ts`;
  - `lib/useBreakpoint.ts`;
  - the seeded role map `backend_controller/src/db/seedCatalog.ts:97-126`, read for permission effects only.

### How the reading was done

- The lead read routing, the shell and the whole design layer, and ran the repository-wide greps.
- Five reader passes then read the feature folders in full, in parallel:
  - users and shared;
  - client values;
  - monthly payments, maturities, returns and exports;
  - overview, queues, system, sign-in and parked;
  - funds, AUM and email.
- The lead re-checked every high-severity claim against source before recording it, including:
  - the login link;
  - the fund publish prefill;
  - the unconfirmed growth write;
  - the fund archive;
  - the nominee removal;
  - the tab URL state;
  - the UTC dates;
  - the seeded finance role.

### Counts (grep over `features/admin`, non-test)

- **Routes:** 46 in the manifest.
  - 22 have a nav entry and 21 are child or detail routes.
  - The other 3 are `/splash`, `/login` and the catch-all.
  - 6 routes are parked payment screens (DEC-14).
- **Layout:**
  - `PageHeader` on 44 routes.
  - `Page` widths: 37 screens `wide`, 6 `default`, 1 `form`.
  - `Section` 77, `Card` 127.
- **Actions:** `Button` 153, `ButtonLink` 25.
- **Data:**
  - `AdminTable` 41 instances, in 36 files.
  - `LoadMore` 25, `FilterChip` 16, `FormField` 109, `MoneyValue` 72.
- **States:**
  - `AsyncBoundary` 56, in 51 files.
  - `EmptyState` 33, `Alert` 143, `Skeleton` 96.
- **Overlays:** `ConfirmDialog` 32, `Modal` 7, `useToast` 5 calls.
- **Breakpoints and styles:**
  - No feature file contains a literal `sm:`, `md:`, `lg:` or `xl:` class, so all responsive behaviour comes from `ui/recipes` and `features/admin/shared/AdminTable.tsx`.
  - No feature file contains an inline `style=`, a hex or rgb colour, or a literal Tailwind class string. The only exceptions are `className="sr-only"` in AdminTable and `features/funds/FundStockAllocation.tsx`.

## 2. Route inventory

### 2.0 Facts that hold for every route

- **Breadcrumbs:** none on any admin route.
- **Frame, `shells/admin/AdminFrame.tsx`:**
  - **Top bar** (`:108-113`): the manifest `route.title` and "Sign out". The title is `lg:hidden` (`ui/recipes/shellAdmin.ts:23-24`).
    - Below 1024 px the top bar shows the manifest title, and the screen's own h1 sits under it.
    - At 1024 px and up the bar holds only "Sign out", and the screen's h1 is the only visible title.
  - **Sidebar** (`:88-105`): from 1024 px. Group labels show only for groups with more than one entry (`:92`). The groups are Client values, Support, Money and System.
    - A route without a `nav` entry highlights no sidebar item, because `aria-current` matches the exact route id only (`:98`).
  - **"Section pages" chip strip** (`:115-128`): below 1024 px only. It appears on nav routes whose domain has more than one permitted entry. Child routes never show it (`:64-66`).
  - **Bottom nav** (`:134-159`): below 1024 px. It has 4 slots, primary entries first (`routeManifest.ts:141-147`). For a full-permission admin the slots are Overview, Users, Funds and Client values, and every other section is behind "More", a modal titled "All sections" (`:168-196`).
- **Back control:**
  - No screen renders a back control; the frame has none.
  - The manifest `back` field (`adminRoutes.ts`) is read only by the Android hardware-back handler (`app/native/backPolicy.ts:44-45`, `NativeBackCoordinator.tsx:57-58`). That handler goes to the parent path with `replace`.
  - So on the web, and in a phone-width browser, the only ways out of a child route are browser history, the sidebar (from 1024 px) and the bottom nav or More (below 1024 px).
  - The single exception is the erase result state (`/users/:userId/erase`).
- **Document title:** never set. `frontend_stack_ts/index.html` has `<title>BeOnEdge</title>`, and no code writes `document.title`, so every admin tab reads "BeOnEdge".
- **Tables:** every table is `AdminTable` (`features/admin/shared/AdminTable.tsx:30-70`). Its `min-w-[42rem]` sits inside `overflow-x-auto` (`ui/recipes/admin.ts:41-49`), so at 390 px every table scrolls sideways. No stacked phone layout exists.
- **Page gate and denial:**
  - Every session route is wrapped by `RequireSession`, `RequireRole("admin")` and `RequirePermission` (`app/routing/buildRouter.tsx:37-79`).
  - A denied route renders `ErrorState variant="forbidden"` inside `Page width="default"` (`guards.tsx:28-32`). Its copy is "Not available on this account".

### 2.1 Inventory

Columns:

| Column | Holds |
|---|---|
| Shell | `Page` width and the PageHeader variant |
| h1 vs manifest | The screen h1 (`PageHeader` title) against the manifest title the phone top bar shows. "=" means they match. |
| Back | Back control |
| Nav | Sidebar group from 1024 px, then what the 390 px phone shows |
| Primary action | The main action and where it sits |
| Gate | Route permissions (any of; `+all` means `requiresAll`), then checks inside the screen |
| 390 to 1280 | What changes between the phone and 1280 px |
| DE | Dead end: a child or detail page with no in-app way back to its list or parent |

**Sign-in and overview**

| Path | Screen | Shell | h1 vs manifest | Back | Nav | Primary action | Gate | 390 to 1280 | DE |
|---|---|---|---|---|---|---|---|---|---|
| `/splash` | `features/admin/auth/AdminSplashScreen.tsx:4` → `features/auth/SplashScreen.tsx:18` | Own `<main className="be-splash">`, outside the frame | No h1; "Starting" never shown | None (public) | None | "Try again", primary lg, full width, only when the backend or restore fails (`SplashScreen.tsx:85-94`) | Public | `features/auth/splash.css` only | n/a |
| `/login` | `features/auth/LoginScreen.tsx:16` | `AuthLayout`, eyebrow "Administrator console" | Panel h2 "Sign in"; layout h1 is the client headline "Investing, made deliberate" (`AuthLayout.tsx:20-24,73`); manifest "Administrator sign in" never shown | None | None | "Sign in", primary lg, full width, submit, in `Form` actions (`:66-74`); "Forgot your password?" ghost sm to a client-only path (`:115-117`, CA-07) | Public | `AUTH_SHELL`: one column, two at `lg` (`ui/recipes/auth.ts:1-5`) | n/a |
| `/overview` | `features/admin/overview/OverviewScreen.tsx:145` | wide; plain + description | "Overview" = | None (home) | Sidebar first, no label; phone bottom slot 1 | Per tile "Open", ghost sm, trailing, at card bottom (`:111`, `DailyTiles.tsx:72`, `OpenTicketsTile.tsx:56`); quick links, secondary sm (`:189-193`) | session; per-tile `hasAnyPermission` (`:169-170`, `DailyTiles.tsx:83-85`, `OpenTicketsTile.tsx:49`) | `ContentGrid 4`: 1 column at 390 (8 stacked cards), 2 at 480, 4 at `lg` | n/a |

**Applications**

| Path | Screen | Shell | h1 vs manifest | Back | Nav | Primary action | Gate | 390 to 1280 | DE |
|---|---|---|---|---|---|---|---|---|---|
| `/applications` | `features/admin/applications/ApplicationQueueScreen.tsx:32` | wide; plain | "Applications" = | None | Sidebar, no label; phone More | None; name is a table link (`:87-92`) | `applications.read` | FilterRow wraps; table scrolls | n/a |
| `/applications/:applicationId` | `features/admin/applications/ApplicationDetailScreen.tsx:38` | wide; plain, static title | "Application" = (name only in the DataList, `:93`) | None; after a decision it navigates to `/applications` with `replace` (`:56`); APK back to `/applications` | No nav entry | "Approve" primary md and "Reject" danger md in Section "Decide" (`:119-142`); "Open the client account" secondary sm trailing (`:111`), ungated | `applications.read`; `applications.decide` else info Alert naming the code (`:144-146`) | DataList split at `lg`; tables scroll | **yes** |

**Users**

| Path | Screen | Shell | h1 vs manifest | Back | Nav | Primary action | Gate | 390 to 1280 | DE |
|---|---|---|---|---|---|---|---|---|---|
| `/users` | `features/admin/users/UserDirectoryScreen.tsx:40` | wide; with actions | "Users" = | None | Sidebar, no label; phone bottom slot 2 | "Create a client", secondary sm trailing, in header actions (`:62-67`) | `users.read` or `users.read_limited`; `clients.create` for the button; ClientPageLink (`:142`); returns columns need `client_values.read` | Header actions stack below 480; search and filters are direct Page children, not `ADMIN_CONTROLS`; 6 to 10 column table scrolls | n/a |
| `/users/create` | `features/admin/users/CreateClientScreen.tsx:72` | default; plain | "Create a client account" vs "Create a client" | None (no cancel before creation; "Find the account" only in conflict and unknown Alerts) | No nav entry | "Review the details", then "Create the account and queue the password link", primary md trailing, at the card bottom (`:279`, `:261`) | `clients.create`; `client_position.write` for the post-create recording Section (`:74`) | `ADMIN_FORM_GRID`: 1 column, 2 at `lg`, 3 at `xl` with 2 fields | **yes** |
| `/users/:userId` | `features/admin/users/UserDetailScreen.tsx:46` | wide; plain, static "User" | "User" = (name not in any heading) | None; APK back to `/users` | No nav entry | Hub "Actions" Section (`ClientHubActions.tsx:43-62`); 12 blocks (section 3.12) | `users.read`; per-panel gates (CA-23) | DataList split at `lg`; up to 7 tabs scroll with a hidden scrollbar; at least 5 tables scroll | **yes** |
| `/users/:userId/login-events` | `features/admin/users/UserLoginEventsScreen.tsx:8` | wide; plain | "Sign-in history" vs "Login events"; never names the user | None; APK back to `/users/:userId` | No nav entry | None (Show more) | `users.read` | 7 column table scrolls | **yes** |
| `/users/:userId/erase` | `features/admin/users/ClientEraseScreen.tsx:142` | form; plain; Section h2 is the name (`:155`) | "Erase client" = | None during check and form; after a result "Back to users" ButtonLink secondary sm, no icon, to `/users` not the user (`ClientErasureNotices.tsx:62`), plus "Open the kept record" (`:58`) | No nav entry | "Erase client" danger md after typing `ERASE` (`:125-134`) | `users.close` | DataList split puts long paragraphs in 2 columns at `lg` | **yes** (check and form states) |

**Funds and AUM**

| Path | Screen | Shell | h1 vs manifest | Back | Nav | Primary action | Gate | 390 to 1280 | DE |
|---|---|---|---|---|---|---|---|---|---|
| `/funds` | `features/admin/funds/FundListScreen.tsx:35` | wide; with actions | "Funds" = | None | Sidebar, no label; phone bottom slot 3 | "New fund" ButtonLink primary sm, no trailing, in header (`:52-54`); repeated primary md in the empty state (`:111`) | `funds.read`; `funds.write`+`aum.write` for create (`:42-43`) | `ADMIN_CONTROLS` stacks below 480; cards 1 column, 2 at `lg`, 3 at `xl` (`CARD_COLUMNS_WRAP[3]`) | n/a |
| `/funds/new` | `features/admin/funds/FundCreateScreen.tsx:40` | wide; plain | "New fund" = | None, no cancel; on success `replace` to `/funds/:id` (`:78`) | No nav entry | "Create fund" primary **lg** at form bottom (`FundTermsForm.tsx:302-306`) | `funds.write` +all `funds.write`,`aum.write` | Grid capped at 72rem, but the textareas outside it run the full wide page width, wider than the grid above them at 1440 and 1920 | **yes** |
| `/funds/:fundId` | `features/admin/funds/FundWorkspaceScreen.tsx:72` | wide; title from data, slug eyebrow, StatusBadge in actions | Fund name vs "Fund workspace" | None; APK back to `/funds` | No nav entry | "Holdings" and "Manage AUM" secondary sm (`:159-164`); lifecycle Publish, Pause, Archive sm with no confirm (`:165-187`); "Publish version" primary lg (`:214`) | `funds.read`; `funds.write` for writes (`:79`); "Manage AUM" ungated against `aum.read` | Local `Row` on `LIST_ROW` turns into a 14rem/1fr grid at `lg`; ErrorState renders outside `Page` (`:103`) | **yes** |
| `/funds/:fundId/holdings` | `features/admin/funds/FundHoldingsScreen.tsx:119` | wide; slug eyebrow, which is an empty pill while loading or failed | "Holdings" = | None | No nav entry | "Add the holding" / "Save the holding" primary md trailing at form bottom (`:270`); rows "Edit" ghost sm, "Exit" danger sm | `funds.read`; `funds.write` (`:134`) | Two 2-field grids, so a third column is empty at `xl`; table scrolls | **yes** |
| `/funds/:fundId/aum` | `features/admin/fund-aum/FundAumScreen.tsx:173` | wide; slug eyebrow | "Fund AUM" = | None; no link to its own history page | No nav entry | "Record opening AUM" primary lg, no confirm (`:143`), or "Review fund size change" primary lg (`FundSizeAdjustmentForm.tsx:162`) | `aum.read` +all `funds.read`; `aum.write` (`:178`) | History cards stack, 2 columns at `lg`, 3 at `xl`; xl money size | **yes** |
| `/funds/:fundId/aum/history` | `features/admin/fund-aum/FundAumHistoryScreen.tsx:19` | wide; slug eyebrow | "AUM history" = | None; reachable only from `/aum` "History" | No nav entry | None | `aum.read` (reads the fund, which needs `funds.read`) | Table scrolls | **yes** |
| `/aum` | `features/admin/fund-aum/AumOverviewScreen.tsx:28` | wide; with actions | "AUM" = | None | Sidebar, no label; phone More | "Grow several funds" ButtonLink primary md trailing in header (`:40-42`); rows "Set opening size" / "Record growth" secondary sm and "History" ghost sm | `aum.read` +all `funds.read`; `aum.write` gates the header button only | Table scrolls | n/a |
| `/aum/collective` | `features/admin/fund-aum/CollectiveAumGrowthScreen.tsx:145` | wide; plain | "Grow several funds" vs "Collective AUM growth" | None | No nav entry | "Preview the batch" secondary, then "Commit N fund size(s)" primary trailing, both full width (`:318`, `:407`) | `aum.write` | `ADMIN_SUMMARY_GRID` holds 3 stats (one column empty at `lg`); table scrolls | **yes** |

**Client values**

| Path | Screen | Shell | h1 vs manifest | Back | Nav | Primary action | Gate | 390 to 1280 | DE |
|---|---|---|---|---|---|---|---|---|---|
| `/client-values` | `features/admin/client-values/ClientPositionsScreen.tsx:46` | default; plain | "Client values" = | None | Sidebar group "Client values"; phone bottom slot 4 plus chip strip (Client values, Monthly payments, Returns, Maturities, Exports) | Five hub cards, each "Open" ButtonLink secondary sm trailing (`:72`), disabled per route access | `client_values.read`, `users.read` or `users.read_limited`; `useRouteAccess` per card | `ContentGrid 2`: 1 column, 2 at 480; 5 cards leave an orphan | n/a |
| `/client-values/monthly` | `features/admin/client-values/ValueUpdateSheetScreen.tsx:82` | wide; plain | "Monthly value update" = | None | No nav entry | "Preview the changes" secondary md (`:307`), then "Review and commit N update(s)" primary trailing (`ValueUpdatePreview.tsx:143`) with confirm | +all `client_values.read`,`client_growth.write` | Gain input sits in table column 5, which scrolls off-screen at 390 | **yes** |
| `/client-values/payment-sheet` | `features/admin/payment-sheet/PaymentSheetScreen.tsx:219` | wide; plain | "Monthly payments" = | None | Sidebar "Client values" group; phone chip strip | "Record" primary md under the table, with confirm (`:176-184`, `:192`) | `client_position.write` | 8 column table with inputs; status and outcome in the last column | n/a |
| `/client-values/returns` | `features/admin/client-returns/ReturnsDashboardScreen.tsx:50` | wide; plain | "Returns" = | None | Sidebar "Client values"; phone chip strip | None (sort chips, Show more) | `client_values.read`; names need `users.read*`, links need `users.read` (`:52-53`) | `ADMIN_SUMMARY_GRID` 7 stats: 2 columns, 4 at `lg`; 7 column table scrolls | n/a |
| `/maturities` | `features/admin/maturities/MaturitiesScreen.tsx:33` | wide; plain | "Maturities" = | None | Sidebar "Client values" (path is outside `/client-values`); phone chip strip | Row buttons in a header-less column (`MaturityActions.tsx:28-56`) | `client_position.write` or `client_values.read`; manage column only with `client_position.write` (`:37`, `:111`) | Table scrolls; up to 4 sm buttons wrap in one cell | n/a |
| `/client-values/exports` | `features/admin/reports/AccountingExportsScreen.tsx:80` | wide; plain | "Accounting exports" = (nav label "Exports") | None | Sidebar "Client values"; phone chip strip | "Download balances CSV" and "Download contributions CSV" primary md, under each field (`:150`, `:181`) | `client_values.read`; disabled in the native app (`:88`, `:117-121`) | One-field grids: full width, half at `lg`, a third at `xl` | n/a |
| `/client-values/individual` | `features/admin/client-values/IndividualClientGrowthScreen.tsx:64` | default; plain | "Adjust one investor" vs "Individual adjustment" (hub card "One investor", user page "Update value") | None; from the user page (`?userId=`) there is no way back to that user; APK back to `/client-values` | No nav entry | "Append the adjustment" primary md trailing, **no confirm** (`:486`) | `client_growth.write`; picker needs `users.read*` (CA-06) | Two 2-field grids | **yes** |
| `/client-values/collective` | `features/admin/client-values/CollectiveClientGrowthScreen.tsx:62` | wide; plain | "Adjust a whole fund" vs "Collective growth" | None | No nav entry | "Preview the batch" secondary md (`:262`), then "Review and commit N adjustment(s)" primary trailing with confirm (`:367`, `:384`) | `client_growth.write`; names need `users.read*` | `ADMIN_SUMMARY_GRID` 4 stats; table scrolls | **yes** |
| `/client-values/position` | `features/admin/client-values/ClientPositionDetailScreen.tsx:54` | wide; plain | "One investor's record" vs "One investor's position" | None; from the user page there is no way back | No nav entry | InvestorPicker; ledger "Reverse" danger sm (`:308`); embedded recording form; MaturityPanel buttons | `client_position.write` or `client_values.read`; `client_position.write` for writes (`:56`) | 3 tables scroll; "Reverse" sits in column 7 | **yes** |

**Support and reviews**

| Path | Screen | Shell | h1 vs manifest | Back | Nav | Primary action | Gate | 390 to 1280 | DE |
|---|---|---|---|---|---|---|---|---|---|
| `/support` | `features/admin/support/SupportInboxScreen.tsx:29` | wide; plain | "Support" = | None | Sidebar group "Support"; phone More plus chip strip (Support, Reviews) | None; client name links to the ticket (`:81-83`) | `support.read` | Table scrolls | n/a |
| `/support/:ticketId` | `features/admin/support/SupportTicketScreen.tsx:120` | wide; plain | "Support request" = | None; ClientPageLink to the client (`:35`) | No nav entry | "Send reply" primary md trailing at form bottom (`SupportResponseForm.tsx:191`) | `support.read`; `support.write` else plain `<p>` (`:158`) | DataList split; form at `FIELD_MEASURE` | **yes** |
| `/reviews` | `features/admin/reviews/ReviewInboxScreen.tsx:34` | wide; plain | "Reviews" = | None | Sidebar "Support"; phone chip strip | None; rating links to the review, client name links to the client page (`:97-105`) | `support.read` | Two FilterRows wrap | n/a |
| `/reviews/:reviewId` | `features/admin/reviews/ReviewDetailScreen.tsx:50` | wide; plain | "Client review" = | None | No nav entry | "Save" primary md trailing at form bottom (`ReviewModerationForm.tsx:179`) | `support.read`; `support.write` else plain `<p>` (`:87`) | DataList split | **yes** |

**Parked payment screens (DEC-14)**

| Path | Screen | Shell | h1 vs manifest | Back | Nav | Primary action | Gate | 390 to 1280 | DE |
|---|---|---|---|---|---|---|---|---|---|
| `/receipts` (parked) | `features/admin/receipts/FundReceiptQueueScreen.tsx:29` | wide; plain | "Fund receipts" = | None | Sidebar group "Money"; phone chip strip | None | `funds.receipts.read` | Table scrolls | n/a |
| `/receipts/:orderId` (parked) | `features/admin/receipts/FundReceiptDetailScreen.tsx:47` | default; plain | "Fund receipt" vs "Receipt" | None | No nav entry | "Acknowledge the funds" primary md trailing, with confirm | `funds.receipts.read`; `funds.receipts.write` | DataList split | **yes** |
| `/refunds` (parked) | `features/admin/refunds/RefundQueueScreen.tsx:70` | wide; plain | "Refunds" = | None | Sidebar "Money" | Row "Queue again" / "Ask provider", with confirm | `refunds.write` | Table scrolls | n/a |
| `/payments` (parked) | `features/admin/payments/PaymentEvidenceScreen.tsx:19` | wide; plain | "Payments" = | None | Sidebar "Money" | None | `payments.read` | Table scrolls | n/a |
| `/mandates` (parked) | `features/admin/mandates/MandateListScreen.tsx:37` | wide; plain | "Mandates" = | None | Sidebar "Money" | None | `payments.read` | Table scrolls | n/a |
| `/mandates/:mandateId` (parked) | `features/admin/mandates/MandateDetailScreen.tsx:31` | wide; plain | "Mandate" = | None | No nav entry | "Ask PhonePe for the state" secondary md, "Cancel the mandate" danger md, both with confirm | `payments.read`; `finance.operate` | Tables scroll | **yes** |

**System**

| Path | Screen | Shell | h1 vs manifest | Back | Nav | Primary action | Gate | 390 to 1280 | DE |
|---|---|---|---|---|---|---|---|---|---|
| `/audit` | `features/admin/audit/AuditLogScreen.tsx:28` | wide; plain | "Audit log" = (nav "Audit") | None | Sidebar group "System"; phone More plus chip strip (6 entries) | None (filters) | `audit.read`; table links ungated (`AuditTrailTable.tsx:23-30,81`) | `ADMIN_CONTROLS`: stacked, then 4 flex-1 controls in one row from 480 | n/a |
| `/emails` | `features/admin/emails/EmailDeliveriesScreen.tsx:46` | wide; plain | "Emails" vs "Email deliveries" | None | Sidebar "System" | None; recipient ClientPageLink (`:122`) | `email_deliveries.read` or `read_masked`; masked Alert (`:63-68`) | 8 and 13 chip rows wrap into many lines at 390; table scrolls | n/a |
| `/emails/templates` | `features/admin/emails/EmailTemplatesScreen.tsx:22` | wide; with actions | "Email templates" = | None | Sidebar "System" | "New template" ButtonLink secondary sm trailing in header (`:35-39`) | `email_templates.write` or `email_messages.send`; `email_templates.write` for the button | Table scrolls | n/a |
| `/emails/templates/new` | `features/admin/emails/EmailTemplateNewScreen.tsx:14` | wide; plain | "New email template" = | None, no cancel; on success `replace` to the detail page (`:41`) | No nav entry | "Create template" primary md, full width (`TemplateContentForm.tsx:227`) | `email_templates.write` | Fields full width of the wide page | **yes** |
| `/emails/templates/:templateId` | `features/admin/emails/EmailTemplateDetailScreen.tsx:164` | wide; title from data | Template name vs "Email template" | None | No nav entry | "Save as a new version" primary full width; "Archive template" secondary (`:70`); "Send this template" secondary sm trailing (`:130`) | `email_templates.write` or `email_messages.send`; per-action gates (`:113-114`) | As above | **yes** |
| `/emails/send` | `features/admin/emails/SendEmailScreen.tsx:335` | wide; plain | "Send an email" = (nav "Send email") | None | Sidebar "System" | `SendAction` buttons in Section "Send", with confirm (`SendAction.tsx:131`, `:144`) | `email_messages.send`; `users.read` for the chosen client (`:224`) | Mode Tabs; one grid | n/a |
| `/content/faqs` | `features/admin/content/FaqListScreen.tsx:42` | wide; plain | "FAQs" = | None | Sidebar "System" | "Save as draft" primary md trailing at form bottom (`:161`); row Publish, Unpublish, Edit, Archive | `content.read`; `content.publish` (`:55`) | 2-field grid; table scrolls | n/a |
| `/app-config` | `features/admin/app-config/AppConfigBuilderScreen.tsx:64` | **default** (siblings are wide); plain | "App config" vs "App configuration" | None | Sidebar "System" | "Publish this configuration" primary md trailing, with confirm (`:266`, `:288`) | `config.read`; `config.publish` (`:75`) | JSON area full width | n/a |
| `*` | `features/auth/NotFoundScreen.tsx:9` | default; plain | "We could not find that page" vs "Not found" | "Go to home", a primary md **Button** calling `navigate` (`:19-25`), not a link | Frame renders; no highlight | "Go to home" | session | None | no |

**Dead ends:** 21 routes.

- 19 are working routes: `/applications/:id`, `/users/create`, `/users/:id`, `/users/:id/login-events`, `/users/:id/erase` (form state), `/funds/new`, `/funds/:id`, `/funds/:id/holdings`, `/funds/:id/aum`, `/funds/:id/aum/history`, `/aum/collective`, `/client-values/individual`, `/client-values/collective`, `/client-values/monthly`, `/client-values/position`, `/support/:id`, `/reviews/:id`, `/emails/templates/new` and `/emails/templates/:id`.
- 2 are parked: `/receipts/:id` and `/mandates/:id`.

## 3. Pattern inventories

Each pattern lists every variant with its locations. The variant marked **closest** is the one nearest `src/ui`, under DEC-45. "Missing" means `src/ui` has no primitive for it.

### 3.1 Back controls and breadcrumbs

| Variant | Where |
|---|---|
| None | 45 of 46 routes (2.0) |
| ButtonLink "Back to users", secondary sm, no icon, to `/users` rather than the parent `/users/:id` | `features/admin/users/ClientErasureNotices.tsx:62`, result state only |
| Redirect after a write, with `replace` | `ApplicationDetailScreen.tsx:56` (to `/applications`), `FundCreateScreen.tsx:78`, `EmailTemplateNewScreen.tsx:41` |
| Forward links that double as an exit | ClientPageLink: `UserDirectoryScreen.tsx:142`, `MaturitiesScreen.tsx:82`, `ReturnsDashboardScreen.tsx:65`, `SupportTicketScreen.tsx:35`, `ReviewDetailScreen.tsx:29`, `ReviewInboxScreen.tsx:105`, `EmailDeliveriesScreen.tsx:122`. Raw links: `AuditTrailTable.tsx:23-30,81`. "Find the account" `CreateClientScreen.tsx:149,169`. "Open this user" `:312`. "Open the delivery log" `SendAction.tsx:87`. |
| Android hardware back from the manifest `back` (invisible) | `app/native/NativeBackCoordinator.tsx:57-58` |
| Home button | `features/auth/NotFoundScreen.tsx:19-25`, a Button with `navigate`, not a link |

- **Manifest `back` targets that disagree with how pages are entered:**
  - `/client-values/individual` and `/client-values/position` are opened from the user page with `?userId=` (`ClientHubActions.tsx:15,22`). The manifest sends them to `/client-values`.
  - Erase returns to `/users`, not `/users/:id`.
  - `/maturities` is a sidebar sibling of client values but lives outside its path.
- **Closest:** none exists. The nearest primitive is `ButtonLink tone="ghost" size="sm"`. Missing: a back slot on `app/layouts/PageHeader` fed from the manifest `back.parent` (`substituteParams` already resolves `:userId`, `backPolicy.ts:44-45`), with a return-to-client variant for `?userId=` entries.

### 3.2 Page headers and titles

| Variant | Where |
|---|---|
| PageHeader, static title plus description (**closest**) | 33 routes |
| With actions slot (button or link) | `/users` (`:62-67`), `/funds` (`:50-55`), `/aum` (`:38-43`), `/emails/templates` (`:33-39`) |
| With a status badge in the actions slot | `/funds/:id` (`FundWorkspaceScreen.tsx:119`) |
| Slug eyebrow | `FundWorkspaceScreen.tsx:117`, `FundHoldingsScreen.tsx:177`, `FundAumScreen.tsx:183`, `FundAumHistoryScreen.tsx:27`. The last three pass `""` while loading or failed, which renders an empty pill. |
| Title from data | `FundWorkspaceScreen.tsx:118` (fund name), `EmailTemplateDetailScreen.tsx:171` (template name); `ClientEraseScreen.tsx:155` puts the name in a Section h2 |
| Static generic title on a record page | "User" (`UserDetailScreen.tsx:74`), "Application" (`ApplicationDetailScreen.tsx:67`), "Support request", "Client review", "Mandate", "Fund receipt" |
| No PageHeader | `/splash`; `/login` (`AuthLayout` h1 is the client marketing headline) |
| Manifest title in the top bar, below 1024 px only | `AdminFrame.tsx:109`, `shellAdmin.ts:23-24` |

**h1 different from the manifest title (13 routes):**

| Route | h1 | Manifest title |
|---|---|---|
| `/login` | "Sign in" | "Administrator sign in" |
| `/users/create` | "Create a client account" | "Create a client" |
| `/users/:id/login-events` | "Sign-in history" | "Login events" |
| `/funds/:id` | fund name | "Fund workspace" |
| `/aum/collective` | "Grow several funds" | "Collective AUM growth" |
| `/client-values/individual` | "Adjust one investor" | "Individual adjustment" |
| `/client-values/collective` | "Adjust a whole fund" | "Collective growth" |
| `/client-values/position` | "One investor's record" | "One investor's position" |
| `/receipts/:id` | "Fund receipt" | "Receipt" |
| `/emails` | "Emails" | "Email deliveries" |
| `/emails/templates/:id` | template name | "Email template" |
| `/app-config` | "App config" | "App configuration" |
| `*` | "We could not find that page" | "Not found" |

- **Nav labels that differ again:** "Exports", "Send email", "Audit", "Receipts". The hub cards add "One investor", "A whole fund" and "One investor's record" (`ClientPositionsScreen.tsx:13-44`). The user page adds "Update value" and "Investor record" (`ClientHubActions.tsx:14,21`).
- **Every page carries a long description paragraph**, many of them in internal language (section 5).
- **Closest:** PageHeader with the manifest title on list pages, and the record's name as title with the section as eyebrow on record pages. `FundWorkspaceScreen.tsx:116-120` is the existing example.

### 3.3 Buttons

**Sizes and tones in use:**

| Kind | Where |
|---|---|
| Primary `lg` | Only fund forms: `FundTermsForm.tsx:303` SubmitRow, `FundAumScreen.tsx:143`, `FundSizeAdjustmentForm.tsx:162`; also login and splash |
| Primary `md` | Every other form submit |
| `sm` | Row, inline and retry buttons |
| Full-width submits outside `ACTION_ROW` | `CollectiveAumGrowthScreen.tsx:318,407`, `TemplateContentForm.tsx:227` |

**Header primary actions differ in tone, size and arrow:**
- "New fund": primary sm, no arrow (`FundListScreen.tsx:52`).
- "Grow several funds": primary md, arrow (`AumOverviewScreen.tsx:40`).
- "Create a client": secondary sm, arrow (`UserDirectoryScreen.tsx:64`).
- "New template": secondary sm, arrow (`EmailTemplatesScreen.tsx:36`).

**The trailing arrow means two things:**
- navigation: `OverviewScreen.tsx:111`, `ClientHubActions.tsx:52`, `ClientPositionsScreen.tsx:72`;
- submit: "Append the adjustment" `IndividualClientGrowthScreen.tsx:486`, "Save the nominee" `ClientNomineeSection.tsx:194`, `SupportResponseForm.tsx:191`, `FaqListScreen.tsx:161`, `AppConfigBuilderScreen.tsx:266`.

Other submits have no arrow: "Start the schedule", "Save changes", "Send the link", "Release", "Erase".

**Retry labels (9 variants):** "Try again", "Check again", "Read again", "Load funds again", "Load investors again", "Load this investor's funds again", "Reload the sheet", "Reload the schedules", "Reload the account" / "Reload the request" / "Reload the review" / "Reload the nominee".

**Danger action rows** use `ACTION_ROW`. `ACTION_DANGER_ROW` (`ui/recipes/layout.ts:92-95`) is used nowhere in admin.

**Money and destructive actions, and how each is confirmed** (CD = ConfirmDialog; tone defaults to primary; cancel defaults to "Go back"):

| Action | Where | Tone | Confirmation |
|---|---|---|---|
| Append the adjustment (growth) | `IndividualClientGrowthScreen.tsx:486` | primary md trailing | **none** |
| Commit collective client growth | `CollectiveClientGrowthScreen.tsx:367` | primary trailing | CD `:384`, DataList summary (**closest**) |
| Commit monthly value update | `ValueUpdatePreview.tsx:143` | primary trailing | CD `ValueUpdateSheetScreen.tsx:345`, DataList summary |
| Record earlier, monthly or correction | `EarlierInvestmentForm.tsx:304` | primary trailing | CD `:317`, DataList summary |
| Record monthly payments | `PaymentSheetScreen.tsx:176` | primary md | CD `:192` (count of ready rows only) |
| Reverse a ledger entry | `ClientLedgerTab.tsx:161`, `ClientPositionDetailScreen.tsx:308` | danger sm | CD danger "Append the reversal", cancel "Leave it alone"; names no entry |
| Mark matured | `MaturityPanel.tsx:93` | primary md | **none** |
| Record withdrawal / Reinvest full position | `MaturityPanel.tsx:97-98` | primary md | CD `:118` "Confirm settlement", cancel "Cancel"; no amount or fund |
| Record transfer outcome | `WithdrawalPayoutPanel.tsx:50` | primary md | CD `:54`, title shows the raw state |
| Resolve maturity | `MaturityActions.tsx:43` | primary or secondary sm | Modal `MaturityResolveDialog.tsx:148` "Confirm resolution", primary |
| Confirm client's choice | `MaturityActions.tsx:39` | primary sm | Modal `MaturityConfirmDialog.tsx:144`, primary |
| Create fund (records opening AUM) | `FundTermsForm.tsx:303` | primary lg | **none** |
| Record opening AUM | `FundAumScreen.tsx:143` | primary lg | **none** |
| Fund size change | `FundSizeAdjustmentForm.tsx:162` | primary lg | CD `:167`, cancel "Cancel"; unstyled `<div>` lines |
| Commit collective AUM | `CollectiveAumGrowthScreen.tsx:407` | primary full width | **none** (the preview step only) |
| Start SIP schedule / Save changes | `SipScheduleCreateForm.tsx:115`, `SipScheduleEditor.tsx:120` | primary md | none |
| Close SIP schedule | `SipScheduleEditor.tsx:124` | **secondary** | CD `:144`, confirm tone **primary** |
| Suspend / Close account | `UserLifecyclePanel.tsx:178,199` | danger | CD danger, confirm label just "Confirm" (`:221`) |
| Release email and phone | `ContactReleasePanel.tsx:165` | danger | CD danger "Release them" (**closest** destructive) |
| Erase client | `ClientEraseScreen.tsx:125` | danger | typed `ERASE`, no dialog; the entry link is a neutral secondary arrow (`ClientHubActions.tsx:24`) |
| Remove the nominee | `ClientNomineeSection.tsx:202` | **primary trailing** | **none** |
| Cancel maturity date | `ClientMaturitySection.tsx:174` | ghost sm | CD confirm tone **primary**, "Keep the date" |
| Withdraw maturity options | `MaturityActions.tsx:50` | ghost sm | Modal danger "Withdraw the options", "Keep the options" |
| Reject application | `ApplicationDetailScreen.tsx:133` | danger | CD danger |
| Archive fund (irreversible) / Pause | `FundWorkspaceScreen.tsx:167-185` | danger sm / secondary sm | **none** |
| Exit holding | `FundHoldingsScreen.tsx:387` | danger sm | CD danger |
| Archive template | `EmailTemplateDetailScreen.tsx:70` | **secondary** | CD danger, no description |
| Archive FAQ | `FaqListScreen.tsx:310` | danger sm | CD danger |
| Publish / Unpublish FAQ (client-visible) | `FaqListScreen.tsx:252,271` | primary sm / secondary sm | **none** |
| Publish app config | `AppConfigBuilderScreen.tsx:266` | primary trailing | CD primary |
| Email sends | `SendAction.tsx:131` | per prop | CD primary, DataList summary |
| Parked: acknowledge, queue refund, ask provider, cancel mandate | `FundReceiptDetailScreen.tsx:184`, `RefundQueueScreen.tsx:192,203`, `MandateDetailScreen.tsx:156,165` | — | CD (parked, DEC-14) |

**Closest:** `Button` primary md in `ACTION_ROW` at the form bottom. Destructive actions use `Button tone="danger"` plus `ConfirmDialog confirmTone="danger"` with a specific verb (`ContactReleasePanel.tsx:165,177`). Money writes use a ConfirmDialog with a DataList of the exact figures (`CollectiveClientGrowthScreen.tsx:384-406`). Navigation uses `ButtonLink` secondary sm.

### 3.4 Tables versus cards

| Shape | Where | At 390 px |
|---|---|---|
| `AdminTable` (**closest**) | 41 instances in 36 files (every list in 2.1 except below) | Scrolls sideways (`min-w-[42rem]`). Row actions and inputs sit in the last columns, off-screen. |
| Card grid of links | Fund list (`FundListScreen.tsx:130-156`, `CARD_COLUMNS_WRAP[3]`) | Stacks |
| Card grid of snapshots | AUM history on `/funds/:id/aum` (`FundAumScreen.tsx:233-249`). The same data is a table on `/funds/:id/aum/history`. | Stacks |
| Hub cards | `ClientPositionsScreen.tsx:66-75` (`ContentGrid 2`), overview tiles (`ContentGrid 4`) | Stack |
| One card per row | Payouts (`MaturityPanel.tsx:115` → `WithdrawalPayoutPanel.tsx:37`) | Stack |
| List rows with actions | Maturity due prompt (`MaturityDuePrompt.tsx:73-93`, `LIST_ROW`, which becomes a 14rem label grid at `lg`) | Stacks |
| Local `Row` on `LIST_ROW` divs | `FundWorkspaceScreen.tsx:62-70` (outside a `<ul>`) | Label and value on one line |

**Phone-hostile columns:**
- the ledger "Reverse" (column 7 or 8, `ClientPositionDetailScreen.tsx:250`, `ClientLedgerTab.tsx:114`);
- the value-sheet gain input (column 5, `ValueUpdateSheetTable.tsx:87-113`);
- the payment-sheet amount, date and status (columns 6 to 8, `RecordingSheetTable.tsx:130-246`);
- the maturities manage column (`MaturitiesScreen.tsx:111`);
- FAQ actions (column 7);
- SIP actions (column 7, `SipScheduleSection.tsx:158`).

**Unnamed or inconsistent columns:**
- Empty header strings: `SipScheduleSection.tsx:158`, `ClientMaturitySection.tsx:160`, `MaturitiesScreen.tsx:115`.
- Money columns not marked `numeric`: `MaturityPanel.tsx:108`, `RecordingSheetTable.tsx:178`.

**Missing:** a phone layout for `AdminTable` (stacked rows or cards), or a documented rule for which columns stay visible.

### 3.5 Filters and search

| Screen | Control | State |
|---|---|---|
| Users | Search `Input type="search"`, placeholder only, applies on Enter or blur, no `maxLength` (`UserDirectoryScreen.tsx:71-85`); segment and state FilterChips (`:87-111`) | Chips in the URL via `useUrlFilter` (**closest**); `?q=` read once (`:43-48`), never written |
| Emails | State (8) and template (13) FilterChips (`EmailDeliveriesScreen.tsx:70-94`) | URL via `useUrlFilter` (`:47-48`) |
| Applications | FilterChips, 5 | local (`ApplicationQueueScreen.tsx:33`) |
| Support | FilterChips, 5 | local (`SupportInboxScreen.tsx:30`) |
| Reviews | State 4 and rating 6 FilterChips | local (`ReviewInboxScreen.tsx:35-36`) |
| Audit | Preset chips 6, From/To date FormFields, two unlabelled text Inputs applied on blur or Enter | local (`AuditLogScreen.tsx:29-61`) |
| Maturities | FilterChips, 3 | local (`MaturitiesScreen.tsx:34`) |
| Returns | FilterChips used as a sort | local (`ReturnsDashboardScreen.tsx:54`) |
| Monthly payments | Month input and fund Select | local (`PaymentSheetScreen.tsx:220-221`) |
| Funds | Search on every keystroke, placeholder only; state chips are raw `<button>` (`FundListScreen.tsx:60-93`) | local (`:36-37`) |
| Email templates | FilterChips, 2 | local (`EmailTemplatesScreen.tsx:25`) |
| Send email | Mode `Tabs`, template `Select`, client `Combobox` | local; `templateId`/`userId` read once (`SendEmailScreen.tsx:215-216,336`) |
| User page tabs | `Tabs` | reads `?tab=` but never writes it (`ClientHubTabs.tsx:26-29,57-59`) |
| Investor pickers | `Combobox`, no debounce | `?userId=&fundId=` via `useLinkedRecord` (`linkedRecord.ts:3-31`) on Individual and Position only |
| Parked receipts, refunds, mandates | FilterChips | local |

- No list has a "clear filters" control. Empty states tell the admin to clear filters anyway: `UserDirectoryScreen.tsx:127`, `AuditLogScreen.tsx:123`, `FundListScreen.tsx:106`.
- **Closest:** `FilterRow` and `FilterChip` with `useUrlFilter`, which is what Users and Emails do.
- **Missing:** a shared admin search control with a visible label, debounce, URL state and a clear action.

### 3.6 Paging

| Variant | Where |
|---|---|
| `LoadMore` "Show more" with "N so far" (**closest**; the only paging pattern) | 25 lists. Page sizes are 25 (`adminQueries.ts:39`, `userDirectoryQueries.ts:10`, `queries.ts:27`) and 50 for returns (`returnQueries.ts:21`). |
| Walk every page (`loadAll`) | Fund catalogue (`shared/queries.ts:61`), investor directory (`investorQueries.ts:25`), payment sheet (`recordingSheetQueries.ts:30`, with progress line `PaymentSheetScreen.tsx:37-46`), exports (`collectPages.ts:7`, up to 2,000 pages, fails loudly) |
| Silent cap | InvestorPicker 25 (`InvestorPicker.tsx:28`), SendEmail client combobox 25 (`SendEmailScreen.tsx:217-237`), maturities and payouts 100 (`maturityQueries.ts:22,32`), application emails (page meta ignored, `ApplicationDetailScreen.tsx:201-244`) |
| Disclosed cap | Due prompt 25 with "N more on the maturities page." (`MaturityDuePrompt.tsx:94-96`), Recent orders 10 (`UserDetailScreen.tsx:209`), overview tiles "25+" (`OverviewScreen.tsx:71-72`) vs "100+" (`DailyTiles.tsx:126`, `OpenTicketsTile.tsx:24`) |

- No numbered pages exist anywhere.
- A failed "Show more" is silent on all 25 lists. `AsyncBoundary` shows an error only when `data === undefined` (`ui/patterns/AsyncBoundary.tsx:52`). `LoadMore` has no error slot (`ui/patterns/LoadMore.tsx:11-20`).

### 3.7 Forms

**Form root:**
- `Form` primitive (`ui/primitives/Form.tsx`, sets `noValidate`, Enter submits): used only by `/login`.
- Raw `<form>`:
  - `FundCreateScreen.tsx:103`
  - `FundWorkspaceScreen.tsx:192`
  - `FundHoldingsScreen.tsx:194`
  - `FundAumScreen.tsx:73`
  - `FundSizeAdjustmentForm.tsx:133`, which has no `noValidate`, so browser bubbles appear.
- Every other admin form is a `div` with a Button `onClick`, so Enter does nothing. Examples: `CreateClientScreen.tsx:191`, `ContactCorrectionForm.tsx:156`, `ClientNomineeSection.tsx:132`, `SipScheduleCreateForm.tsx:58`, `SupportResponseForm.tsx:113`, `ReviewModerationForm.tsx:103`, `FaqListScreen.tsx:107`, `AppConfigBuilderScreen.tsx:229`, `TemplateContentForm`, `IndividualClientGrowthScreen`, `CollectiveClientGrowthScreen`, `ValueUpdateSheetScreen`, `EarlierInvestmentForm`, `MaturityPanel`.

**Labels:**
- `FormField`, with the label above, everywhere (**closest**).
- Exceptions with no visible label:
  - Users search (`UserDirectoryScreen.tsx:71-85`)
  - Funds search (`FundListScreen.tsx:60-68`)
  - Audit text filters (`AuditLogScreen.tsx:47-61`)
  - Table-cell inputs, which use `aria-label` plus the column header (`RecordingSheetTable.tsx:191,222`, `ValueUpdateSheetTable.tsx:95-109`)

**FormField render props not wired** (`describedBy` and `invalid` ignored, so hints and errors are not announced):
- `FaqListScreen.tsx:109-157`
- `AppConfigBuilderScreen.tsx:237-263`
- `FundCreateScreen.tsx:173-196`
- `FundTermsForm.tsx:216-246`
- `CollectiveAumGrowthScreen.tsx:276-286,395-405`
- `FundAumScreen.tsx:116-140`
- `MaturityConfirmDialog.tsx:188`, `MaturityResolveDialog.tsx:194`
- `ExtensionFields.tsx:52,74`, `FollowUpSipFields.tsx:60,80`
- `MaturityDateForm.tsx:78`
- `FundReceiptDetailScreen.tsx:168`, `MandateDetailScreen.tsx:144` (parked)

**Inline errors:**
- `FormField error` (**closest**): create client, contact correction, nominee, SIP, growth forms, holdings, templates.
- Hand-made `FIELD_ERROR` spans without `role=alert`: `RecordingSheetTable.tsx:202-206,231-235`, `ValueUpdateSheetTable.tsx:42,48`.
- A validation message passed as a hint: `SupportResponseForm.tsx:61,165-169`.
- No inline errors at all, only an Alert: `FundSizeAdjustmentForm.tsx:131`.
- Silent disable with no message:
  - `MaturityPanel.tsx:50-52,96-98`
  - `WithdrawalPayoutPanel.tsx:50`
  - `AccountingExportsScreen.tsx:129-131`
  - FAQ incomplete (`FaqListScreen.tsx:56`)
  - Fund month fields silently emptied (`FundTermsForm.tsx:55-59`)

**Summary errors:**
- Alert at the top of the page, far from the button: Application `:82`, FAQ `:98`, App config `:150-174`, Individual `:207`, Collective `:172`, Monthly `:222`, funds.
- Alert inside the form: Support, Review, `EarlierInvestmentForm`, `MaturityPanel`.

**Submit placement:**
- `ACTION_ROW` at the form bottom, submit first, ghost cancel second (**closest**).
- Cancel labels vary: "Change the details", "Cancel", "Done".
- `MaturityDateForm.tsx:116-123` puts primary then ghost "Cancel"; the dialogs put "Go back" first.

**Held idempotent writes:**
- `useHeldWrite` and `HeldWriteNotice` (in `features/admin/users/`, used by SIP and six maturity files) are the closest. They live in a feature folder, not in `ui`.
- Hand-written equivalents:
  - `ContactCorrectionForm.tsx:96-119`
  - `ContactReleasePanel.tsx:61-87`
  - `UserLifecyclePanel.tsx:79-109`
  - `ClientNomineeSection.tsx:83-104`
  - `ClientEraseScreen.tsx:55-75`
  - `CreateClientScreen.tsx:79-85`
  - `PasswordLinkPanel.tsx:122-125`
  - `IndividualClientGrowthScreen.tsx:81,144,181`
  - `CollectiveClientGrowthScreen.tsx:75,104,149`
  - `ValueUpdateSheetScreen.tsx:95,131,189`
  - `EarlierInvestmentForm.tsx:102`
  - `SupportResponseForm.tsx:54-87`
  - `ReviewModerationForm.tsx:45-77`
  - `TemplateContentForm.tsx:71`
  - `SendAction.tsx:58`
  - `FundSizeAdjustmentForm.tsx:76-127`
  - payment sheet, the only one that persists to `sessionStorage` (`heldRecordings.ts:8-81`)
- No held write at all (a new key per click): see CA-03.

**Unknown-outcome copy:**
- Consistent where handled: "The reply did not arrive, so it is not known whether …". Examples: `HeldWriteNotice.tsx:61`, `CreateClientScreen.tsx:185`, `IndividualClientGrowthScreen.tsx:234-237`.
- Wrong where not handled (CA-02).

### 3.8 Loading, empty, error and forbidden states

**Loading:**
- `AsyncBoundary` skeleton props (**closest**). Eight shapes are in use:
  - Card with two bars (most lists)
  - Card with 1.2rem and 3rem bars (detail pages)
  - Card with 1rem and 2rem bars
  - bare 3rem or 4rem blocks
  - Card 6rem
  - 12rem and 20rem blocks (email)
  - 2rem by 3rem tile block
  - `ListSkeleton` (`client-values/ListSkeleton.tsx`, feature-local, also used by the payment sheet)
- No skeleton is table-shaped.
- Select placeholders "Loading funds" and "Loading templates" stand in for loading.
- `MaturityPanel` shows nothing while loading (`:46-50`).

**Empty:**
- `EmptyState` (**closest**): 33 uses. It has an action only in `FundListScreen.tsx:106-113`, `AumOverviewScreen.tsx:57-63` and `NotFoundScreen.tsx:16`.
- Card with a `<p>`: `UserDetailScreen.tsx:212-214`, `SipScheduleSection.tsx:116-120`, `ClientMaturitySection.tsx:121-125`.
- Bare `<p>`:
  - `ClientNomineeSection.tsx:238`
  - `CollectiveAumGrowthScreen.tsx:105`
  - `ApplicationDetailScreen.tsx:154,172,203`
  - `MandateDetailScreen.tsx:187,234`
  - `DailyTiles.tsx:145`

**Error:**
- `AsyncBoundary` to `ErrorState` with "Try again" on every primary read (**closest**; 56 uses).
- Tiles: own message plus "Try again", with a stale warning (`OverviewScreen.tsx:80-98`, `DailyTiles.tsx:32-45`, `OpenTicketsTile.tsx:25-38`).
- Alerts with retry: `linkedInvestor.tsx:41-58`, `SipMonthLinkField.tsx:22-33`, `CollectivePreviewTable.tsx:99-110`, `RecordingSheetControls.tsx:54,70-74`, `ResolutionFacts.tsx:53-56,84-86`, `CollectiveAumGrowthScreen.tsx:112-124`.
- FormField error plus a separate retry button: `InvestorPicker.tsx:47,71`, `CatalogueFundPicker.tsx:38,54`.
- Alert without retry: `MaturityPanel.tsx:82`, `AccountingExportsScreen.tsx:65-67`.
- `ErrorState` outside `Page`: `FundWorkspaceScreen.tsx:103`.

**Forbidden and read-only:**
- Guard-level `ErrorState forbidden` (**closest** for whole pages).
- In-page treatments (seven kinds, CA-23):
  - info Alert naming permission codes
  - plain `<p>`
  - "Read only" cell text
  - disabled without a reason
  - section returns `null`
  - Card notice
  - tile text

### 3.9 Dialogs, sheets and toasts

**`ConfirmDialog` → `Modal` → `Sheet` (**closest**; 32 uses):**
- Below 1024 px it is a bottom sheet with a grip; from 1024 px a 480 px panel (`ui/recipes/overlay.ts:1-41`).
- Actions are cancel then confirm. Below 1024 px they are reversed into a column, so confirm is on top.
- Escape, a scrim tap and × all call `onCancel` even while `pending` (`ui/primitives/Sheet.tsx:71-75,115-117,141`).

**Variations across the 32 dialogs:**
- **Cancel label (7 variants):** "Go back", "Cancel", "Keep this attempt", "Keep this commit", "Leave it alone", "Keep the date", "Keep the options".
- **`pending`:**
  - passed, so the dialog stays open during the write: `UserLifecyclePanel.tsx:223`, `ContactReleasePanel.tsx:183`;
  - not passed, so the dialog closes before the write: `ClientLedgerTab.tsx:180`, `PasswordLinkPanel.tsx:237`, `SipScheduleEditor.tsx:144`, and every client-values dialog.
- **Mounting:** conditional at `UserLifecyclePanel.tsx:216` and `RefundQueueScreen.tsx:224`; always mounted elsewhere.

**Direct `Modal` (7 uses):**
- maturity dialogs: six layouts, listed in CA-21;
- the due prompt (`MaturityDuePrompt.tsx:53`);
- "All sections" (`AdminFrame.tsx:168`).

**Toasts (`useToast`) appear only in funds and AUM (5 calls):**
- `FundCreateScreen.tsx:77`
- `FundWorkspaceScreen.tsx:178,199`
- `FundAumScreen.tsx:82`
- `FundSizeAdjustmentForm.tsx:119`

Inline success Alerts and missing feedback are covered in CA-22.

### 3.10 Money display

**`MoneyValue`, 72 uses (**closest**):**
- **`showDecimals` (paise)** on 67 uses.
- **Whole rupees** (default `showDecimals=false`):
  - `UserDetailScreen.tsx:235` (Recent orders, on a page where ledger and SIP show paise);
  - parked: `FundReceiptQueueScreen.tsx:100`, `FundReceiptDetailScreen.tsx:106`, `RefundQueueScreen.tsx:157`, `PaymentEvidenceScreen.tsx:65`.
- **Size:** `sm` in tables, except `AumOverviewScreen.tsx:99` (`md` in a table).
- **Signed amounts:**
  - with `tone="signed"`: most;
  - without: `FundSizeAdjustmentForm.tsx:172` (`showSign`, default tone).

**Other money rendering:**
- `money()` plain text via `formatINR` (`maturities/resolutionCopy.ts:31`). Used in `ResolutionFacts.tsx:22-26,36,98-99` and `MaturityConfirmDialog.tsx:82`. There is no green or red for gain or loss, and no `MoneyPrecisionError` guard.
- `ReturnValue.tsx:11-21` re-creates MoneyValue styling for percentages. Zero is the default colour there, while a signed MoneyValue zero is green.
- Percent strings are built three more ways: `${row.weightPercent}%` (`FundHoldingsScreen.tsx:338`), `${bps/100}%` (`FundSizeAdjustmentForm.tsx:173`), `${basisPoints} bps` (`CollectiveAumGrowthScreen.tsx:338`).
- `formatPercent` exists in `domain/percent.ts` and is used only by the client chart.
- "₹" appears only in column headers: `ValueUpdateSheetTable.tsx:89`, `RecordingSheetTable.tsx:184`.
- INR grouping comes from `formatINR` (`en-IN`). The one Western-grouped number in copy is "100,000" in `FundHoldingsScreen.tsx:251` (a sort order, not money).

**Money inputs:**
- **`AmountInput decimals`** (rupees, ₹ prefix; **closest**):
  - `IndividualClientGrowthScreen.tsx:421`
  - `EarlierInvestmentForm.tsx:238`
  - `MaturityPanel.tsx:96`
  - `FollowUpSipFields.tsx:41-51`
  - `SipScheduleCreateForm.tsx:62-79`, `SipScheduleEditor.tsx:91-99`
  - `FundCreateScreen.tsx:148`, `FundTermsForm.tsx:184,203`
  - `FundAumScreen.tsx:106`
  - `FundSizeAdjustmentForm.tsx:148`
- **Plain `Input` for rupees:**
  - `ValueUpdateSheetTable.tsx:95-109` (signed)
  - `RecordingSheetTable.tsx:190-201`
  - `FundSizeAdjustmentForm.tsx:149` (signed, mono)
- **Signed entry, two ways:**
  - a direction `Select` "Raise the value"/"Lower the value" (`IndividualClientGrowthScreen.tsx:397`);
  - a leading minus sign (value sheet, fund size).
- **Basis-point rates, two ways:**
  - `Input type="number"`: Individual `:374`, Collective client `:238`, Collective AUM `:278`;
  - a text pattern: `FundSizeAdjustmentForm.tsx:149`.
  - Only Individual converts the rate to a percent (`:53-54,347`).
- **Missing:** a signed `AmountInput` and a `PercentValue` pattern.

**Null AUM is worded four ways:**
- "No AUM" (`FundListScreen.tsx:147`)
- "Not set" (`FundWorkspaceScreen.tsx:146`)
- "Not initialised" (`AumOverviewScreen.tsx:97`)
- "No opening AUM has been recorded for this fund" (`FundAumScreen.tsx:159`)

### 3.11 Dates and times

**Formatters (`domain/dates.ts`):** `formatDateTime` 58 calls, `formatDate` 23, `formatYearMonth` 9. All are IST and `en-IN`.

**Date-only values are formatted three ways:**
- a raw `YYYY-MM-DD` passed to `formatDate` (`RecordingSheetTable.tsx:56,76`, `FundSizeAdjustmentForm.tsx:174`);
- `T00:00:00Z` appended inline (`ReturnFigures.tsx:43`, `ReturnsDashboardScreen.tsx:131`, `AumOverviewScreen.tsx:108`, `FundAumHistoryScreen.tsx:57`, `FundAumScreen.tsx:166,238`);
- the wrapper `formatMaturityDate` (`maturities/maturityPresentation.ts:47`).

**Same-kind values shown at different precision:**
- "Joined" is a date, while "Suspended" and "Closed" are date-times (`UserDetailScreen.tsx:114-121`).
- The mandate "Due period" is shown as a date (`MandateDetailScreen.tsx:245`, parked).

**Raw date shown:** `asOfDate` (`CollectiveAumGrowthScreen.tsx:341`).

**Relative dates:**
- Support "Age" uses UTC day boundaries (`support/supportPresentation.ts:21-24`).
- Maturity "Due today"/"In N days" (`maturityPresentation.ts:39-45`).

**"Today" defaults:**
- IST via `indiaToday` (`client-values/indiaToday.ts:4`; used by client values, maturities and SIP).
- UTC via `new Date().toISOString().slice(0, 10)`: `FundCreateScreen.tsx:26`, `FundAumScreen.tsx:39`, `FundSizeAdjustmentForm.tsx:70`, `CollectiveAumGrowthScreen.tsx:48`.
- `indiaCalendarDate` (`domain/dates.ts:54`) exists and is unused in admin.

**Date and month inputs:**
- Native `type="date"` and `type="month"` everywhere.
- Messages still say "YYYY-MM-DD" (`payment-sheet/recordingSheet.ts:8`, `RecordingSheetCsvPanel.tsx:18`).
- `min`/`max` are applied unevenly. The follow-up month has a min and no max; the exports month has a max and no min. The extension date's `min` equals the maturity date, but validation needs a later date (`ExtensionFields.tsx:27,43,77`).

**Closest:** `formatDate` / `formatDateTime` / `formatYearMonth`. A calendar-date helper is missing (`formatCalendarDate` for `YYYY-MM-DD`), alongside `indiaCalendarDate` for defaults.

### 3.12 Spacing and typography

**Page rhythm:** `Page` children are spaced `gap-8 md:gap-10 lg:gap-12` (`ui/recipes/layout.ts:10`). The user page stacks up to 12 blocks at that spacing:

1. an unheaded identity card;
2. invite and password link;
3. portfolio summary;
4. actions;
5. record form;
6. SIP schedules;
7. maturity dates;
8. Records tabs;
9. email and phone;
10. nominee;
11. account lifecycle;
12. recent orders.

It mixes eight panel patterns: Section > Card, Section > bare table, Section > Tabs, a bare Card, a Card with a `<p>`, a bare `<p>`, `EmptyState`, and a raw `<div ref>` (`UserDetailScreen.tsx:165`).

**Section and Card nesting runs both ways:**
- Card > Section: `FundCreateScreen.tsx:104-133`, `FundWorkspaceScreen.tsx:133,206`, `FundAumScreen.tsx:98`, `FundSizeAdjustmentForm.tsx:134`.
- Section > Card (**closest**): most other screens.

**Heading scale:** only h1 (PageHeader) and h2 (Section and Sheet).

Other title-like elements:
- `ITEM_TITLE` spans (`MaturitySendDialog.tsx:107-115`, `FundListScreen.tsx:135`, `FundAumScreen.tsx:237`);
- `LIST_LABEL` used as a card heading (`FundAumScreen.tsx:157`);
- `Stat` labels used as card titles (`ClientPositionsScreen.tsx:69`);
- raw `<p>` used as headings (`MaturityPanel.tsx:113`, `WithdrawalPayoutPanel.tsx:39`);
- an unstyled `<h3>` (`features/funds/FundStockAllocation.tsx:42`).

`CARD_TITLE` is unused in admin.

**Grids that leave empty columns:**
- `ADMIN_FORM_GRID` (`ui/recipes/admin.ts:22-26`) with 2 children is the common case. It is 2 columns at 1280 and 3 at 1440 and 1920, so the third column stays empty. Examples: `CreateClientScreen.tsx:206`, `ContactCorrectionForm.tsx:185`, `ClientNomineeSection.tsx:161`, client values (`IndividualClientGrowthScreen.tsx:396,435`, `CollectiveClientGrowthScreen.tsx:227,316`), funds (`FundHoldingsScreen.tsx:195,232`), `FaqListScreen.tsx:132`, `RecordingSheetControls.tsx:34`, `AccountingExportsScreen.tsx:128,162`.
- It also applies inside 480 px dialogs (`FollowUpSipFields.tsx:33`, `ExtensionFields.tsx:45`).
- `ADMIN_SUMMARY_GRID` with 2 stats (`ValueUpdatePreview.tsx:54`) or 3 stats (`CollectiveAumGrowthScreen.tsx:333`).

**Spacing in admin comes from recipes.** No feature file sets its own margin or padding classes.

### 3.13 Icons

There is no icon set in the admin app. Glyphs come from:
- the `Button` and `ButtonLink` trailing arrow (`ui/primitives/Button.tsx:28-43`, duplicated in `ButtonLink.tsx:25-40`);
- the `Sheet` close × (`Sheet.tsx:142-151`);
- the `Disclosure` plus sign;
- the toast dismiss.

Other glyphs:
- **Feature-local svg:** the `SheetCheckbox` tick (`payment-sheet/SheetCheckbox.tsx:25-35`).
- **Text glyphs:** "·" separators, "—" placeholders, "→" (`AuditTrailTable.tsx:67`), "..." (`reviewPresentation.tsx:6`), and "+" on capped counts.
- **Nav entries:** the sidebar, bottom nav and More have no icons; the bottom nav is text at `text-2xs`, 10 px (`ui/recipes/shellAdmin.ts:83`).

### 3.14 One-off styles and bypasses of `src/ui`

No raw colour, inline style or literal utility class appears in `features/admin`. The bypasses are structural:

| Bypass | Where | Existing primitive |
|---|---|---|
| Raw chip `<button className={ADMIN_FILTER}>` | `FundListScreen.tsx:70,81`; `FundSizeAdjustmentForm.tsx:140` (mode switch); `CollectiveAumGrowthScreen.tsx:127` (multi-select, no group label) | `FilterChip`; `Tabs`/`RadioGroup`; a checkbox group is missing |
| Raw `<select className={SELECT_BASE}>` | `FundTermsForm.tsx:142,161` | `Select` |
| Raw `<textarea>` | `FundTermsForm.tsx:251,281`; `AppConfigBuilderScreen.tsx:238` (`ADMIN_JSON_AREA`) | `Textarea` (no mono variant) |
| Feature-local checkbox | `payment-sheet/SheetCheckbox.tsx:11-39` (`features/orders/RiskConsent.tsx` builds another) | missing `Checkbox` |
| Percent clone of MoneyValue | `client-returns/ReturnValue.tsx:11-21` | missing `PercentValue` |
| Local detail row | `FundWorkspaceScreen.tsx:62-70` | `DetailRow` |
| Local submit row | `FundTermsForm.tsx:298-307` | `ACTION_ROW` / `Form` actions |
| Local list skeleton | `client-values/ListSkeleton.tsx` | `Skeleton` in `Card` |
| Duplicated text recipe `MESSAGE_TEXT` | `SupportTicketScreen.tsx:27`, `ReviewDetailScreen.tsx:21` | belongs in `ui/recipes/datalist.ts` |
| Three tile implementations | `OverviewScreen.tsx:74-116`, `DailyTiles.tsx:23-83`, `OpenTicketsTile.tsx:18-62` | a shared tile is missing |
| Route access re-implemented | `ClientHubActions.tsx:36-39` | `shared/routeAccess.ts` |
| Admin table and filters outside `src/ui` | `features/admin/shared/AdminTable.tsx` | candidate to move to `ui/patterns` |
| Held-write hook and notice inside `features/admin/users` | `useHeldWrite.ts`, `HeldWriteNotice.tsx` | candidate shared admin pattern |
| Literal class and inline style in a shared fund chart | `features/funds/FundStockAllocation.tsx:16,42,43,46,49` | `LIST_ROOT`, `CARD_TITLE` |
| Arbitrary values inside recipes | `ui/recipes/admin.ts` (`min-w-[42rem]`, `lg:max-w-[72rem]`, `min-h-[16rem]`, `min-h-[34rem]`), `datalist.ts` (`lg:grid-cols-[14rem_minmax(0,1fr)]`, `lg:max-w-[44rem]`), `layout.ts` (`lg:max-w-[38rem]`, `[68rem]`) | token-backed sizes are missing for these measures |
| `ButtonLink` disabled lacks `BUTTON_DISABLED` and the arrow | `ui/primitives/ButtonLink.tsx:59-61` | `Button` disabled styling (`Button.tsx:65`) |

## 4. Findings

**Counts:** 47 findings: 8 high, 23 medium, 16 low.

**Severity:** high means broken or blocks a task; medium means confusing or breaks a rule; low means polish.

All fixes stay within today's identity (DEC-45). They name the existing `src/ui` primitive or recipe to standardise on, or say that one is missing.

| ID | Sev | Routes and `file:line` | What is inconsistent or broken | Fix direction (DEC-45) |
|---|---|---|---|---|
| CA-01 | high | All 21 dead-end routes in 2.1. Frame `shells/admin/AdminFrame.tsx:64-66,98` (no strip or highlight on child routes). Manifest `back` used only by `app/native/NativeBackCoordinator.tsx:57-58`. Erase result `ClientErasureNotices.tsx:62` goes to `/users`, not the user. | No admin page renders a back control or breadcrumb. On the web, and in a phone-width browser, a child or detail page has no in-app way back to its list or parent. The sidebar has no item highlighted on child routes, and below 1024 px most lists are behind "More". Client-values screens opened from a client page with `?userId=` (`ClientHubActions.tsx:15,22`) cannot return to that client; Android back goes to `/client-values`. The maintainer's "back buttons differ between pages" is, in the admin, "there are none". | Missing primitive: a `back` slot on `app/layouts/PageHeader` driven by the manifest `back.parent` (resolved with `substituteParams`, as `app/native/backPolicy.ts:44-45` does), rendered as `ButtonLink tone="ghost" size="sm"` on phone and web. Pages opened with `?userId=` link back to the client through `ClientPageLink` (`features/admin/shared/clientPageLink.tsx`). Child routes should mark their parent's nav item current. |
| CA-02 | high | `FundCreateScreen.tsx:26-38` ("We could not reach the backend. Nothing was created."); `FundWorkspaceScreen.tsx:52-55` ("Nothing was changed.", "It has been reloaded" with no reload); `FaqListScreen.tsx:58-63,99` ("Nothing changed" on 5xx or network); `MaturityPanel.tsx:83`; `WithdrawalPayoutPanel.tsx:43`; `FundHoldingsScreen.tsx:145-150` (5xx shown as definite; "Save not confirmed" title for every rejection); `ApplicationDetailScreen.tsx:29-36,83-89` (no reload). Parked: `MandateDetailScreen.tsx:49-57,89`. | An unknown write outcome (timeout, transport error, 5xx) is reported as a definite failure, or reported with no recovery. RULES rule 4 says unknown remains unknown. Elsewhere the same condition reads "Not confirmed … Check again" (`HeldWriteNotice.tsx:47-62`). | `isUnknownWriteOutcome` (`api/errors.ts:79`) with `HeldWriteNotice` copy and actions. Remove "Nothing was created/changed" claims on transport errors. |
| CA-03 | high | New key per click: ledger reversal (`features/admin/shared/adminQueries.ts:477`, `ClientLedgerTab.tsx:40-47,161`, `ClientPositionDetailScreen.tsx:89-105`); maturity mark, settle and payout (`client-values/maturityQueries.ts:41,58,76`); application decide (`adminQueries.ts:87`); FAQ writes (`adminQueries.ts:347,367,391,407`); fund create, publish, lifecycle and opening AUM (`shared/queries.ts:102,122,141,162`); holdings (`FundHoldingsScreen.tsx:79,86,106`). Fund size: `FundSizeAdjustmentForm.tsx:48-49,122-124` uses its own `isUncertainError`, which drops the held key on `IDEMPOTENCY_IN_PROGRESS`. Collective AUM note stays editable after an unknown outcome and re-mints the key (`CollectiveAumGrowthScreen.tsx:395-405`). | After an unknown outcome these writes leave the button live, and a retry mints a new `Idempotency-Key`, against RULES rule 6. Money and ledger writes are among them. | `useHeldWrite` (`features/admin/users/useHeldWrite.ts`) for every state-changing admin write. Lock inputs while held, as `TemplateContentForm.tsx:73` does. Use `isUnknownWriteOutcome` rather than local predicates. |
| CA-04 | high | `ClientHubActions.tsx:47` (close the recording form; `isFormHolding` exists at `UserDetailScreen.tsx:54` but is not passed); `SipScheduleCreateForm.tsx:125`, `SipScheduleEditor.tsx:139`, `SipScheduleSection.tsx:190` (remount); `MaturityActions.tsx:73-75,108`, `MaturityConfirmDialog.tsx:133-135`, `MaturityResolveDialog.tsx:137-139`, `MaturitySendDialog.tsx:66-68`, `MaturityDateForm.tsx:120`; `ClientPositionDetailScreen.tsx:145-151,215,228` (picker stays enabled and remounts the form). No route sets `transactional` (`adminRoutes.ts`), and keys live in `useRef` (`api/idempotency.ts:45-48`). | A held, unconfirmed write is silently discarded when its form or dialog closes, when another row is opened, when the investor changes, or on any navigation. The only exception is the payment sheet, which keeps held rows in `sessionStorage` (`payment-sheet/heldRecordings.ts`). | Block close and dismiss while a write is held: wire `onHoldChange` as `UserDetailScreen.tsx:171` does, and disable the picker. Mark held-write routes `transactional` for Android back. Use the payment sheet's persisted held write as the model for the shared `useHeldWrite`. |
| CA-05 | high | Irreversible: fund Archive and Pause, one click (`FundWorkspaceScreen.tsx:165-187`; `ALLOWED_TRANSITIONS.archived: []` at `:42`). Money, no confirm: "Append the adjustment" (`IndividualClientGrowthScreen.tsx:486`), "Mark matured" (`MaturityPanel.tsx:93`), "Record opening AUM" (`FundAumScreen.tsx:143`), "Create fund" with opening AUM (`FundTermsForm.tsx:303`), collective AUM commit (`CollectiveAumGrowthScreen.tsx:407`). Destructive, no confirm, primary tone with arrow: "Remove the nominee" (`ClientNomineeSection.tsx:194-203`). Client-visible, no confirm: FAQ "Publish" and "Unpublish" (`FaqListScreen.tsx:252,271`). | Sibling money writes all confirm with a figures summary (Collective growth, Monthly update, Earlier investment, Payment sheet), and sibling destructive actions confirm with danger (release, suspend, exit holding, archive FAQ). These do not, and the fund archive cannot be undone. | `ConfirmDialog` with `confirmTone="danger"` for destructive actions; `ConfirmDialog` with a `DataList` of the exact figures for money writes (model: `CollectiveClientGrowthScreen.tsx:384-406`). |
| CA-06 | high | `/client-values/individual` and `/client-values/position`: `InvestorPicker.tsx:26-29,47,71` lists users. The seeded `finance` role holds `client_growth.write` and `client_position.write` but neither `users.read` nor `users.read_limited` (`backend_controller/src/db/seedCatalog.ts:107-122`). Also `FundWorkspaceScreen.tsx:162-164`: "Manage AUM" is shown to the seeded `content` role (`funds.read`, no `aum.read`), which lands on Forbidden. | The finance role cannot choose an investor at all. It sees "The investor list could not be loaded" with a retry that can never succeed. Content admins are offered a link they cannot open. Whether production roles match the seed is not visible in code. | Show a role notice through `ErrorState`'s forbidden variant (`errorVariantOf`, `ui/patterns/AsyncBoundary.tsx:28-39`) instead of retry. Gate links with `useRouteAccess` (`features/admin/shared/routeAccess.ts`). The access model itself is a maintainer decision (DEC-36 keeps finance off client pages). |
| CA-07 | high | `/login`: `features/auth/LoginScreen.tsx:115-117` always renders "Forgot your password?" to `CLIENT_FORGOT_PASSWORD_PATH`. The admin manifest has no such route (`adminRoutes.ts`), so the catch-all guard sends an anonymous admin back to `/login?from=/password/forgot`; after signing in they land on "We could not find that page" (`LoginScreen.tsx:26-29`). | A dead link on the admin sign-in that ends in a not-found page. | Hide the link when the auth port has no reset path, the way `supportPath: null` and `loginHelp: null` are already passed (`shells/admin/AdminShellRoot.tsx:49-51`). No new primitive needed. |
| CA-08 | high | `/funds/:fundId`: `FundWorkspaceScreen.tsx:84-98` seeds the "Publish new terms" form with `minimumDurationMonths: null`, `recommendedHoldingMonths: null` and a blank disclosure. `data.versions` carries the current values (`packages/contracts/src/operations/admin-fund-aum.ts:101-102,296-300`). | Publishing a new terms version starts from blank duration fields and a blank disclosure. An admin changing one field can publish a version that drops the others. The UI does not say the fields are not carried over. Not verified at runtime. | Prefill from the latest `data.versions` and `data.disclosures` entries. Standard `FormField` hints. No new primitive. |
| CA-09 | medium | 13 h1/manifest mismatches (3.2). `frontend_stack_ts/index.html` `<title>BeOnEdge</title>` with no `document.title` updates. Generic h1 on record pages: `UserDetailScreen.tsx:74` "User", `ApplicationDetailScreen.tsx:67`, `SupportTicketScreen.tsx:133`, `ReviewDetailScreen.tsx:62`; `UserLoginEventsScreen.tsx:14` never names the user. | Below 1024 px the top bar title and the h1 disagree on 13 routes, one directly above the other. From 1024 px the manifest title is not shown at all. Every browser tab reads "BeOnEdge" (WCAG 2.4.2). Record pages do not say whose record it is. Hub card, nav label, page title and user-page link use four names for the same screen. | One title per route from the manifest, used by the top bar, PageHeader and `document.title`. On record pages, put the record name in the PageHeader title and the section in the eyebrow (model: `FundWorkspaceScreen.tsx:116-120`). |
| CA-10 | medium | Frame: `AdminFrame.tsx:37` (`MOBILE_NAV_SLOTS = 4`), `:115-128` (strip only on nav routes), `:134-159`. `ClientHubTabs.tsx:52` (7 tabs in `TABS_ROOT` with a hidden scrollbar, `ui/recipes/field.ts:158-162`). `EmailDeliveriesScreen.tsx:83-94` (13 template chips). `ui/recipes/layout.ts:23` (Section action row never wraps: `SipScheduleSection.tsx:84`, `ClientMaturitySection.tsx:62`). `ui/recipes/shellAdmin.ts:83` (`text-2xs` nav labels). | At 390 px only Overview, Users, Funds and Client values are one tap away; 18 sections sit behind "More". On child routes the strip and highlight disappear, so the admin has no sign of where they are. Tabs and chip rows overflow with no visual cue. Bottom-nav labels are 10 px. | Keep the bottom nav (DEC-45), but show the parent section as current on child routes and carry CA-01's back control. Give `TABS_ROOT` an overflow cue, or use a `Select` below `sm` for long filter sets (`ui/primitives/Select`). Let the Section header row wrap like `PAGE_HEADER_ROW` (`layout.ts:57-60`). |
| CA-11 | medium | All 41 `AdminTable` uses (`features/admin/shared/AdminTable.tsx:30-70`; `ui/recipes/admin.ts:41-49`). Worst cases: ledger "Reverse" in column 7 or 8 (`ClientPositionDetailScreen.tsx:250-319`, `ClientLedgerTab.tsx:114-176`), value-sheet gain input in column 5 (`ValueUpdateSheetTable.tsx:87-113`), payment-sheet inputs and status in columns 6 to 8 (`RecordingSheetTable.tsx:130-246`), maturities manage column (`MaturitiesScreen.tsx:111-119`), FAQ actions (`FaqListScreen.tsx:206-321`). | At the admin phone width every table scrolls sideways. Entering money, or reaching a row's action or outcome, means scrolling right, out of sight of the client name. No list switches to a stacked layout. | Missing primitive: a phone layout for `AdminTable` (stacked rows, with the primary cell, key figures and actions visible), defined once in `src/ui` (or `features/admin/shared`) and used by every table. |
| CA-12 | medium | All 25 `LoadMore` lists, for example `UserDirectoryScreen.tsx:187`, `ClientLedgerTab.tsx:179`, `AuditLogScreen.tsx:127`, `MaturitiesScreen.tsx:124`, `EmailDeliveriesScreen.tsx:156`. Cause: `ui/patterns/AsyncBoundary.tsx:52`, `ui/patterns/LoadMore.tsx:11-20`, `api/paged.ts:97-106`. | A failed "Show more", or a failed background refetch, leaves the old rows with no message (RULES rule 4). The overview tiles alone warn "The last refresh failed" (`OverviewScreen.tsx:81`). This is carried from Phase H (H4: "a failed Show more is silent"). | Give `LoadMore` an error state with retry, and let `AsyncBoundary` show a stale notice when `error` is set with data present (the tile copy is the model). |
| CA-13 | medium | Raw fund UUIDs on catalogue failure or while loading: `ClientLedgerTab.tsx:70-73`, `ClientMaturityTab.tsx:16-19`, `IndividualClientGrowthScreen.tsx:87-90`, `ClientPositionDetailScreen.tsx:71-74`, `ClientMaturitySection.tsx:47-50`, `CollectiveAumGrowthScreen.tsx:176-179`. Pending names shown as absent: `ReturnsDashboardScreen.tsx:59-66`. "Unavailable" for both failure and absence: `directoryReturns.tsx:32-35`. Failed fund read leaves editing enabled: `FundHoldingsScreen.tsx:121,143`. Queue 404 shown as "n/a": `OverviewScreen.tsx:89-90`. Failed read titled "Maturities need your decision": `MaturityDuePrompt.tsx:31,45,55`. | Failed or pending reads turn into ids, absence or a false claim instead of an explicit failure with retry (RULES rule 4). | Wrap the dependent read in `AsyncBoundary`, or show an Alert with retry (model: `RecordingSheetControls.tsx:54,70-74`). Use `Skeleton` while pending. Neutral title on a failed prompt read. |
| CA-14 | medium | `InvestorPicker.tsx:28` (25, `userDirectoryQueries.ts:10`); `SendEmailScreen.tsx:217-237` (25); `client-values/maturityQueries.ts:22,32` with `MaturityPanel.tsx:46-47,105,113` (100, and `pending` derived from the capped list); `ApplicationDetailScreen.tsx:201-244` (page meta ignored). Overview caps "25+" vs "100+" (`OverviewScreen.tsx:71-72`, `DailyTiles.tsx:126`). | Pickers and lists silently stop at a page size, so a client can be unfindable, a pending maturity can show "Mark matured", and missing email rows are not disclosed. The same "+" means different floors on adjacent tiles. | `LoadMore` or `loadAll` for pickers (`api/paged.ts:40-45`); disclose caps as the due prompt does (`MaturityDuePrompt.tsx:94-96`). |
| CA-15 | medium | URL state only on `/users` chips and `/emails` (`features/admin/shared/urlFilter.ts`). Local state: `ApplicationQueueScreen.tsx:33`, `SupportInboxScreen.tsx:30`, `ReviewInboxScreen.tsx:35-36`, `AuditLogScreen.tsx:29`, `MaturitiesScreen.tsx:34`, `ReturnsDashboardScreen.tsx:54`, `PaymentSheetScreen.tsx:220-221`, `FundListScreen.tsx:36-37`, `EmailTemplatesScreen.tsx:25`, `SendEmailScreen.tsx:215-216,336`. `ClientHubTabs.tsx:26-29,57-59` reads `?tab=` but never writes it (a repeated deep link to the same tab is ignored). `UserDirectoryScreen.tsx:43-48` reads `?q=` once. | Returning from a detail page resets the queue filter. Filtered views cannot be shared or reloaded. The user-page tab is lost on reload or back. Two screens keep filters in the URL and eleven do not. | `useUrlFilter` for every filter, sort, tab and search, with `replace: true` as today. |
| CA-16 | medium | Users search: Enter or blur, no label, no `maxLength` against the contract cap of 120 (`packages/contracts/src/operations/admin-oversight.ts:242`) (`UserDirectoryScreen.tsx:71-85`). Funds search: every keystroke, no label (`FundListScreen.tsx:60-68`). Audit text filters: blur or Enter, no label, jargon placeholders (`AuditLogScreen.tsx:47-61,110-111`). Combobox searches with no debounce (`InvestorPicker.tsx:28`, `SendEmailScreen.tsx:272`). No clear control where the empty state asks to clear (`UserDirectoryScreen.tsx:127`, `AuditLogScreen.tsx:123`, `FundListScreen.tsx:106`). | Each list searches differently. Unlabelled fields fail WCAG 3.3.2. A long Users query becomes a full-page error. | Missing: one admin search control (`FormField` label, debounce, `useUrlFilter`, clear button, `maxLength`), placed in `ADMIN_CONTROLS` with the filters. |
| CA-17 | medium | Raw controls: `FundListScreen.tsx:70,81`, `FundSizeAdjustmentForm.tsx:140`, `CollectiveAumGrowthScreen.tsx:127`, `FundTermsForm.tsx:142,161,251,281`, `AppConfigBuilderScreen.tsx:238`. Feature-local re-implementations: `SheetCheckbox.tsx`, `ReturnValue.tsx`, `FundWorkspaceScreen.tsx:62-70`, `FundTermsForm.tsx:298-307`, `ListSkeleton.tsx`, `MESSAGE_TEXT` duplicated, three tile implementations, `ClientHubActions.tsx:36-39` (all in 3.14). | RULES rule 12 asks for the existing `ui` primitives. Raw selects and textareas lose `aria-invalid` and `aria-describedby`. Chips double as tabs, radios and multi-selects. | `FilterChip`; `Tabs` or `RadioGroup` (`ui/primitives/Toggle`); `Select`; `Textarea` (add a mono variant); `DetailRow`; `useRouteAccess`. Missing: a `Checkbox` primitive, a `PercentValue` pattern and an admin tile pattern. |
| CA-18 | medium | `Form` is used only by `/login`. 5 raw `<form>` (3.7), and `FundSizeAdjustmentForm.tsx:133` lacks `noValidate`. All other admin forms are `div` plus `onClick`. Unwired `FormField` render props (3.7 list). Hint used as error (`SupportResponseForm.tsx:61`). Silent disable without a message (`MaturityPanel.tsx:50-52`, `WithdrawalPayoutPanel.tsx:50`, `AccountingExportsScreen.tsx:129-131`, `FundTermsForm.tsx:55-59`). Summary errors at the page top (Application, FAQ, App config, client values) vs inside the form (Support, Review). | Enter submits on 5 forms and nowhere else. Hints and errors are not announced on the fields listed in 3.7 (WCAG 1.3.1, 3.3.1). Admins are not told why a button is disabled. | `Form` (`ui/primitives/Form.tsx`) for every admin form, with its `actions` slot. Pass `describedBy` and `invalid` from `FormField` everywhere. Inline `FormField error` for every rule that disables submit. Summary errors inside the form, above the actions. |
| CA-19 | medium | `useHeldWrite` and `HeldWriteNotice` are used by SIP and maturities. There are 17 hand-written equivalents (3.7). `HeldWriteNotice.tsx:55-57` hard-codes "Reload the schedules", which shows in six maturity flows; in the withdraw dialog it closes the dialog (`MaturityActions.tsx:108`). Restart wording drifts: "Start a new attempt" / "Start over", "Keep this attempt" / "Keep this commit" (`IndividualClientGrowthScreen.tsx:221,495`, `CollectiveClientGrowthScreen.tsx:192,414`, `ValueUpdateSheetScreen.tsx:246,380`). | The same rule-6 state machine exists in 18 shapes with different labels and gaps (CA-03, CA-04). A button label says one thing and does another. | Move `useHeldWrite` and `HeldWriteNotice` to a shared admin location, add a reload-label prop and one restart dialog, and route every admin write through them. |
| CA-20 | medium | Cancel labels in 7 variants (3.9). `pending` passed in some dialogs and not others (3.9). Confirm tone mismatched: maturity resolve and confirm (money) are primary while withdrawing options (no money) is danger (`MaturityResolveDialog.tsx:148`, `MaturityConfirmDialog.tsx:144` vs `MaturityActions.tsx:84-98`); cancel date is primary (`ClientMaturitySection.tsx:203-208`); close SIP schedule has a secondary trigger and a primary confirm (`SipScheduleEditor.tsx:124,144`); template archive trigger is secondary vs fund archive danger (`EmailTemplateDetailScreen.tsx:70`). Generic "Confirm" (`UserLifecyclePanel.tsx:221`). Confirms that do not name what they act on: `ClientPositionDetailScreen.tsx:331-334`, `ClientLedgerTab.tsx:180-191`, `MaturityPanel.tsx:118`, `WithdrawalPayoutPanel.tsx:54` (raw state in the title). The payment-sheet confirm counts only ready rows (`PaymentSheetScreen.tsx:173-175,192-209`). Escape, scrim and × close dialogs while `pending` (`ui/primitives/Sheet.tsx:71-75,116,141`). | The same decision is asked in different words, colours and behaviours. Money confirmations sometimes omit the figures. | `ConfirmDialog` defaults ("Go back", `pending` always passed, confirm label is the specific verb), `confirmTone="danger"` for every destructive or irreversible action, and a `DataList` of the figures in children. `Sheet` should ignore dismiss while pending. |
| CA-21 | medium | Maturity UI: six dialog layouts plus an inline form with reversed button order (`MaturityDateForm.tsx:116-123`); "Done" is primary md in dialogs and secondary sm in the form (`:49`). `ClosedOfferModal` says "Reload to see the latest." but offers only "Close" (`MaturityActions.tsx:123-129`). When changing a date, the edited fund is missing from its own select (`ClientMaturitySection.tsx:51-54`, `MaturityDateForm.tsx:79-86`). Resolve and Confirm are disabled before the date with no reason (`MaturityActions.tsx:39-45`). Success copy points to the "Maturity tab" without a link (`resolutionCopy.ts:38,56`). A second, older maturity surface `MaturityPanel` (Position page and `ClientMaturityTab.tsx:32`) behaves differently from `features/admin/maturities`. `ADMIN_FORM_GRID` used inside 480 px dialogs (`FollowUpSipFields.tsx:33`, `ExtensionFields.tsx:45`). | One task, maturity handling, is spread over two surfaces and seven layouts, with inconsistent buttons and missing context. | One maturity dialog layout on `ConfirmDialog`/`Modal` conventions; `ClientPageLink` to `?tab=maturity` (pattern `AuditTrailTable.tsx:28`); hint text for disabled actions; plain `GRID_BASE` in dialogs. Retiring `MaturityPanel` in favour of `features/admin/maturities` is a plan decision (U5). |
| CA-22 | medium | Toast: `FundCreateScreen.tsx:77`, `FundWorkspaceScreen.tsx:178,199`, `FundAumScreen.tsx:82`, `FundSizeAdjustmentForm.tsx:119`. Inline Alert: Support "Reply sent", Review "Saved", Holdings "Holding saved", Collective "Batch committed", templates "Saved", sends "Email queued", value and growth receipts. None: FAQ create, edit, publish, unpublish and archive (`FaqListScreen.tsx:77-80,257-284,343-350`); app-config publish (`AppConfigBuilderScreen.tsx:118-122`); application decide (redirect only); holding exit (`FundHoldingsScreen.tsx:419-429`); template archive, restore and create (`EmailTemplateDetailScreen.tsx:41-51`, `EmailTemplateNewScreen.tsx:40-41`); cancel maturity date (`HeldWriteNotice.tsx:45`). | Three feedback styles, chosen by feature folder. Some writes give no sign they succeeded. | One rule. Inline success `Alert` where the result has figures to show (receipts). `useToast` for short confirmations. Never silent. |
| CA-23 | medium | Info Alert or error copy naming permission codes, 12 places: `ClientPositionsScreen.tsx:59-62`, `ClientPositionDetailScreen.tsx:126-128`, `EarlierInvestmentForm.tsx:168-171` (two stacked "Read only" Alerts on Position), `ApplicationDetailScreen.tsx:144-146`, `FaqListScreen.tsx:183-185`, `AppConfigBuilderScreen.tsx:278-280`, `FundCreateScreen.tsx:34`, `FundWorkspaceScreen.tsx:217-219`, `FundHoldingsScreen.tsx:288-291`, `FundAumScreen.tsx:203-205`, `EmailTemplateDetailScreen.tsx:136-140`, `AppUpdateAnnouncementPanel.tsx:108`. Plain `<p>` naming codes: `ClientContactsSection.tsx:57-60`, `ContactReleasePanel.tsx:96-103`, `UserLifecyclePanel.tsx:211-213`, `PasswordLinkPanel.tsx:233`, `ClientNomineeSection.tsx:255-259`. Plain `<p>`: `SupportTicketScreen.tsx:158`, `ReviewDetailScreen.tsx:87`. "Read only" cell text: `FaqListScreen.tsx:323`. Disabled with no reason: `ClientLedgerTab.tsx:164`, `ClientPositionsScreen.tsx:72`. Hidden: `SipScheduleSection.tsx:71`, `ClientMaturitySection.tsx:40`, `directoryReturns.tsx:28`. Card notice: `PortfolioSummarySection.tsx:35-39`. | Seven treatments for "your role cannot do this", most of them showing internal permission codes to admins. | Missing: one admin role-notice pattern (an `Alert tone="info"` with plain-language copy, no codes), used wherever an action is withheld. Disabled controls always say why. |
| CA-24 | medium | Ungated links: `ApplicationDetailScreen.tsx:109-115`, `AuditTrailTable.tsx:23-30,81` (carried H3 finding), `FundWorkspaceScreen.tsx:162`, `AumOverviewScreen.tsx:61-63,115-117`, `SendAction.tsx:87-89`. The hub `/client-values` admits `users.read` and `users.read_limited` roles (`adminRoutes.ts:197`), who can open none of its five cards (`ClientPositionsScreen.tsx:72`). Name visibility differs by endpoint (`ValueUpdateSheetTable.tsx:30` vs `CollectivePreviewTable.tsx:13`). Disabled `ButtonLink` keeps the enabled look (`ui/primitives/ButtonLink.tsx:59-61`). | DEC-36 is applied through `ClientPageLink` in some places and not others. A role reaches a hub where everything is disabled with no reason, and the disabled buttons look enabled. | `ClientPageLink`/`useCanOpenClientPage` and `useRouteAccess` for every cross-page link. Give `ButtonLink` the `BUTTON_DISABLED` class. The hub's route permissions are a maintainer decision (DEC-36). |
| CA-25 | medium | Plain `Input` for rupees: `ValueUpdateSheetTable.tsx:95-109`, `RecordingSheetTable.tsx:190-201`, `FundSizeAdjustmentForm.tsx:149`. Signed entry as a direction Select (`IndividualClientGrowthScreen.tsx:397`) vs a leading minus. Basis points as `type="number"` (`IndividualClientGrowthScreen.tsx:374`, `CollectiveClientGrowthScreen.tsx:238`, `CollectiveAumGrowthScreen.tsx:278`) vs a text pattern (`FundSizeAdjustmentForm.tsx:149`); percent shown only on Individual (`:347`). Mode labels that do not match field labels (`FundSizeAdjustmentForm.tsx:34,138`). | Money and rate entry looks and validates differently on every money screen. | `AmountInput decimals` for every rupee field. Missing: a signed `AmountInput` and one rate field that shows the percent equivalent as Individual does. |
| CA-26 | medium | `FundCreateScreen.tsx:26`, `FundAumScreen.tsx:39`, `FundSizeAdjustmentForm.tsx:70`, `CollectiveAumGrowthScreen.tsx:48` use `new Date().toISOString().slice(0, 10)`. `support/supportPresentation.ts:21-24` computes "Age" on UTC days. | Between 00:00 and 05:30 IST the AUM and fund forms default the effective date to yesterday, and support "Today" flips at 05:30 IST. Client-values forms use IST (`client-values/indiaToday.ts:4`). | `indiaToday` (move it beside `indiaCalendarDate` in `domain/dates.ts:54`) for every default date and day count. |
| CA-27 | medium | `/client-values/payment-sheet`: invalid ticked rows are silently left out of the confirm (`PaymentSheetScreen.tsx:173-175,192-209`). Held rows from other months or funds are unreachable from the default view (`:135-139,220-221`). A storage failure is silent (`useRecordingSheetRecorder.ts:135`, `heldRecordings.ts:52,66-68`). "Sheet filled" title shows with 0 rows filled (`RecordingSheetCsvPanel.tsx:53-55`). The CSV copy tells admins to use a schedule id the UI never shows (`RecordingSheetCsvPanel.tsx:18`, `recordingSheetCsv.ts:14,18`). The CSV panel sits after the Record button (`PaymentSheetScreen.tsx:176-185`). | The busiest money screen can drop ticked rows without saying so and can strand unconfirmed recordings. | Confirm dialog lists the rows needing attention. A held-row summary across months, plus `useUrlFilter` for month and fund. An Alert when held storage fails. Conditional titles. Order the panels in task order. |
| CA-28 | medium | `/users/:userId`: 12 blocks and eight panel patterns (3.12), unheaded identity card first (`UserDetailScreen.tsx:89-131`). Maturity appears twice, as a section (`:186-188`) and a tab (`ClientHubTabs.tsx:36`). Sign-ins appear three times: a button (`UserDetailScreen.tsx:127`), a tab (`ClientHubTabs.tsx:44`) and a page. The same password-link panel is titled differently on create (`CreateClientScreen.tsx:323`) and on the user page (`UserDetailScreen.tsx:135`). | The central admin page has no consistent structure, and duplicated surfaces make the admin decide which is canonical. | Section > Card for every block, with a heading on each. Records stay in `Tabs`; drop the duplicated section, button and page or link them. Same titles across create and detail. The exact order is for U5. |
| CA-29 | medium | `/login`: `AuthLayout.tsx:20-30,73,110-113` defaults render the client headline "Investing, made deliberate", the client tagline (`LoginScreen.tsx:50`) and three client markers. The manifest title "Administrator sign in" is never rendered. | The admin console's sign-in reads as the investor app's marketing page. | `AuthLayout`'s existing `headline` and `markers` props, set by the admin auth port. No new primitive. |
| CA-30 | medium | Label `htmlFor` pointing at nothing: `IndividualClientGrowthScreen.tsx:258-279` (RadioGroup), `CollectiveAumGrowthScreen.tsx:263-265`. Empty column headers: `SipScheduleSection.tsx:158`, `ClientMaturitySection.tsx:160`, `MaturitiesScreen.tsx:115`. `<ul>` inside an Alert `<span>`: `RecordingSheetCsvPanel.tsx:58`, `ResolutionFacts.tsx:73`. Cell errors without `role=alert`: `RecordingSheetTable.tsx:202-206,231-235`, `ValueUpdateSheetTable.tsx:42,48`. RadioGroups that look enabled while locked: `MaturityResolveDialog.tsx:175-182`, `IndividualClientGrowthScreen.tsx:264`. Sidebar groups lack group semantics (carried H3 finding, `AdminFrame.tsx:90-104`). Filter chip groups have no visible label (`AdminTable.tsx:76`). | WCAG 2.2 AA gaps (1.3.1, 2.5.3, 4.1.2) concentrated in admin forms and tables. | `RadioGroup` with a legend and `disabled`; named action columns ("Actions"); `Alert` content as block markup; `FormField` error conventions; `role="group"` with `aria-labelledby` on sidebar groups. |
| CA-31 | medium | See section 5: permission codes, raw ids and enums, and internal words, at the locations listed there. | Admin copy mixes product language with implementation language, and the same thing has several names. | A label map per enum (`domain/status.ts` pattern) and one glossary of the terms (client, investment, value). Section 5 lists each string. |
| CA-32 | low | FAQ "Edit" fills the top form with no scroll or focus (`FaqListScreen.tsx:297-303`); STATE_CONFLICT copy reused for publish and archive (`:61`); Save spinner driven by row writes (`:89,161`); raw status in Badge (`:231`). App config: a JSON array called "not valid JSON" (`AppConfigBuilderScreen.tsx:57,233-235`); a read failure titled "Not published" (`:97,164-167`); "API origin" shows `window.location.origin` (`:214`). | Small mismatches between what the screen says and what happened. | Focus the form on edit (or open it in a `Sheet`); `StatusBadge`; accurate copy. |
| CA-33 | low | `/overview`: three tile implementations (3.14); quick links include Overview itself (`domain/permissions.ts:52` `hasAny([])`) and follow manifest order, not `nav.order` (`OverviewScreen.tsx:148-153,189`); `DataList` inside a quarter-width tile (`DailyTiles.tsx:147-152`); raw role codes and "permission(s)" (`:186,198`). Three of four queue tiles are parked payment queues (DEC-14). | The home page duplicates logic and orders links differently from the sidebar. | One admin tile pattern; `navRoutes`/`navGroups` (`app/routing/routeManifest.ts`) for quick links; `countOf` (`domain/plural`). |
| CA-34 | low | Form pages: `default` (`CreateClientScreen.tsx:136`), `form` (`ClientEraseScreen.tsx:148`), `wide` (`FundCreateScreen.tsx:85`, `EmailTemplateNewScreen.tsx:20`). App config is `default` among `wide` siblings (`AppConfigBuilderScreen.tsx:144`). Exports is `wide` for two one-field forms (`AccountingExportsScreen.tsx:107`). | Same kind of page, three widths. | `Page width="form"` for single forms, `wide` for lists and record pages, `default` for hubs. |
| CA-35 | low | `ADMIN_FORM_GRID` with 2 fields (3.12) leaves an empty column at 1440 and 1920. `ADMIN_SUMMARY_GRID` with 2 or 3 stats. Fields outside the 72rem grid run the full wide page width at 1440 and 1920 (`FundTermsForm.tsx:249-294`, `TemplateContentForm.tsx:152-220`). Full-width buttons (`CollectiveAumGrowthScreen.tsx:318,407`, `TemplateContentForm.tsx:227`). The 5-card hub leaves an orphan (`ClientPositionsScreen.tsx:66`). | Desktop layouts look unfinished at the reference widths. | `ContentGrid columns={2}` or a 2-column form grid where there are 2 fields; `FIELD_MEASURE` (`ui/recipes/layout.ts:53`) for long fields; `ACTION_ROW` for buttons. |
| CA-36 | low | Card > Section vs Section > Card (3.12). Headings made from `ITEM_TITLE`, `LIST_LABEL`, `Stat` labels and raw `<p>` (3.12). Unstyled `<h3>` (`features/funds/FundStockAllocation.tsx:42`). | Grouping and heading levels vary, which affects scanning and screen-reader outlines. | Section > Card; `Section` titles for groups; `CARD_TITLE` for card headings. |
| CA-37 | low | `EmptyState` vs Card + `<p>` vs bare `<p>` (3.8). Empty states without the obvious action (create a template, set a maturity date, record an investment, clear filters). | Empty screens look and behave differently. | `EmptyState` with an `action` wherever there is a next step. |
| CA-38 | low | Eight skeleton shapes, none table-shaped (3.8). `MaturityPanel` shows nothing while loading (`:46-50`). `ErrorState` outside `Page` (`FundWorkspaceScreen.tsx:103`). Empty eyebrow pill (`FundHoldingsScreen.tsx:177`, `FundAumScreen.tsx:183`, `FundAumHistoryScreen.tsx:27`). | Loading looks different on every page. | Missing: a table skeleton that matches `AdminTable`. Keep `PageHeader` outside `AsyncBoundary` (model: `EmailTemplateDetailScreen.tsx:169-183`); pass `undefined` for an absent eyebrow. |
| CA-39 | low | Raw `Badge` for states (`SipScheduleSection.tsx:154`, `ClientLedgerTab.tsx:126,159`, `UserLoginEventsList.tsx:56`, `FaqListScreen.tsx:231`, `ApplicationQueueScreen.tsx:119`). Raw enums as text (`MaturityPanel.tsx:109`, `WithdrawalPayoutPanel.tsx:39,54`, `FundHoldingsScreen.tsx:352`, `FundTermsForm.tsx:152,171`, `CreateClientScreen.tsx:303-304`). | The same state renders as a badge in one place and as lowercase code in another. | `StatusBadge` with a presentation in `domain/status.ts` for every state. |
| CA-40 | low | Header-action tone and size vary; the trailing arrow is used for both navigation and submit; the "Erase client" entry is styled like neutral links (`ClientHubActions.tsx:24,52`); `ACTION_DANGER_ROW` is unused; all lifecycle buttons spin at once (`FundWorkspaceScreen.tsx:171`); 9 retry label variants; `ACTION_ROW` on `span` vs `div` (3.3). | Buttons do not signal role consistently. | Header action: `ButtonLink` secondary sm with arrow. Arrow for navigation only. Destructive entries in `ACTION_DANGER_ROW` with tone `danger`. One retry label, "Try again" (`ErrorState`). |
| CA-41 | low | Whole rupees for orders beside paise on the same page (`UserDetailScreen.tsx:235`). `md` money in a table (`AumOverviewScreen.tsx:99`). Signed amount without signed tone (`FundSizeAdjustmentForm.tsx:172`). Plain-text money without tone or guard (`resolutionCopy.ts:31`). Four percent renderings (3.10). Null AUM worded four ways (3.10). | Money presentation differs within a screen. | `MoneyValue showDecimals` for every recorded amount; `tone="signed"` for every change; missing `PercentValue`. |
| CA-42 | low | Three date-only call conventions; date vs date-time for the same kind of value (`UserDetailScreen.tsx:114-121`); raw `asOfDate` (`CollectiveAumGrowthScreen.tsx:341`); "YYYY-MM-DD" messages under native pickers (`recordingSheet.ts:8`); uneven `min`/`max` (3.11). | Small date inconsistencies. | Missing: `formatCalendarDate` in `domain/dates.ts`; `formatDate` for dates and `formatDateTime` for events. |
| CA-43 | low | `NotFoundScreen.tsx:15-25`: Button plus `navigate` for "Go to home"; title differs from the manifest. | The only home link is a button. | `ButtonLink` to the home path. |
| CA-44 | low | `/client-values/exports`: "File saved" is claimed after `anchor.click()` (`AccountingExportsScreen.tsx:46-47,70-75`); result Alerts persist after inputs change; empty fields disable the button with no message (`:129-131,163`). | The success message cannot know the file was saved. | "Download started" copy; reset on change; `FormField required` and error. |
| CA-45 | low | Deliveries show the raw `templateKey` although a label map exists (`EmailDeliveriesScreen.tsx:118` vs `:30-44`); the templates empty state has no create action (`EmailTemplatesScreen.tsx:69-78`); "Earlier versions" includes the current one and there is no preview on the template page (`EmailTemplateDetailScreen.tsx:97-106`); the app-update message commits on blur and may swallow the first Send click (`AppUpdateAnnouncementPanel.tsx:125-127,160`, unverified). | Email screens are inconsistent with each other. | Reuse `TEMPLATES` labels; `EmptyState` action; reuse SendEmail's preview panel. |
| CA-46 | low | AUM snapshots are cards on `/funds/:id/aum` (`FundAumScreen.tsx:233-249`) and a table on `/funds/:id/aum/history` (`FundAumHistoryScreen.tsx:49`); no link between them. | Same data, two shapes, one unreachable from the other. | `AdminTable` in both, plus a `ButtonLink` to the history. |
| CA-47 | low | Money screens without `MoneyFootnote` or the market-risk line: returns (only `ReturnFigures.tsx:52`, and with `lastUpdated={null}`), client values, payment sheet, maturity dialogs, user page money tables, funds, AUM, audit amounts. | RULES "Product, copy, and accessibility" asks money screens to show source, freshness and "Investments are subject to market risk."; whether this binds admin-only screens is not settled. | `MoneyFootnote` (`ui/patterns/MoneyFootnote.tsx`) with a real freshness date, if the maintainer applies the rule to admin. |

## 5. Copy

### 5.1 Strings that break the `RULES.md` copy rules

Greps over `features/admin`, `shells/admin` and the admin-mounted auth screens found:
- no `BOE` or `BE`;
- no "guaranteed", "assured", "risk-free", "multibagger", "tip" or "guru";
- no emoji, no exclamation mark and no FOMO copy.

The only "guarantee" is negated: "BeOnEdge does not guarantee a return." (`app/layouts/AuthLayout.tsx:111-112`).

The rule items that are not met are presentation rules, not wording:

| Rule | Where | What |
|---|---|---|
| Money screens show source, freshness and "Investments are subject to market risk." | Every admin money screen except `client-returns/ReturnFigures.tsx:52`, which omits freshness (`lastUpdated={null}`) | Missing (CA-47; applicability to admin needs a maintainer call) |
| Green, red and amber express money states | `maturities/ResolutionFacts.tsx:22-26` ("Gain of …"/"Loss of …" as plain text); `FundSizeAdjustmentForm.tsx:172` (signed amount, default tone) | No signal colour on a gain or loss |
| Indian grouping | `FundHoldingsScreen.tsx:251` "Enter a whole number from 0 to 100,000." | Western grouping in copy (a sort order, not money) |
| Same risk wording everywhere | `AuthLayout.tsx:111` "Investments are market-linked. Their value can fall as well as rise, …" vs "Investments are subject to market risk." (`SplashScreen.tsx:100`, `MoneyFootnote.tsx:10`) | Two disclaimers |
| The admin sign-in addresses admins | `LoginScreen.tsx:50`, `AuthLayout.tsx:20-30` | Client marketing headline, tagline and markers on the admin login (CA-29) |

### 5.2 Internal language, raw ids and naming drift

These do not break a written rule, but they are the bulk of the copy inconsistency.

**Permission codes in UI text:**

- `ClientPositionsScreen.tsx:60-61`
- `ClientPositionDetailScreen.tsx:127`
- `EarlierInvestmentForm.tsx:170`
- `ClientContactsSection.tsx:58-59`
- `ContactReleasePanel.tsx:99-100`
- `UserLifecyclePanel.tsx:212`
- `PasswordLinkPanel.tsx:233`
- `ClientNomineeSection.tsx:258`
- `ApplicationDetailScreen.tsx:145`
- `FaqListScreen.tsx:184`
- `AppConfigBuilderScreen.tsx:279`
- `FundCreateScreen.tsx:34`
- `FundWorkspaceScreen.tsx:218`
- `FundHoldingsScreen.tsx:290`
- `FundAumScreen.tsx:55,204`
- `EmailTemplateDetailScreen.tsx:138`
- `AppUpdateAnnouncementPanel.tsx:108`
- `OverviewScreen.tsx:186,198` (raw role codes)

**Implementation words** (quoted, with locations):

| Word or phrase | Where |
|---|---|
| "append-only ledger … no stored balance … the backend derives value" | `ClientPositionsScreen.tsx:55` |
| "Written straight to the ledger." | `ClientPositionsScreen.tsx:30` |
| "the server recalculates it authoritatively and its response is the truth" | `IndividualClientGrowthScreen.tsx:203` |
| "under the same key" | `IndividualClientGrowthScreen.tsx:235` |
| "Append the adjustment" | `IndividualClientGrowthScreen.tsx:487` |
| "Committing sends the preview's basis back" | `CollectiveClientGrowthScreen.tsx:168` |
| "Basis" and the raw hash | `CollectiveClientGrowthScreen.tsx:297-298`, `CollectiveAumGrowthScreen.tsx:243,344-345` |
| "in exact paise" | `ValueUpdateSheetScreen.tsx:53` |
| "read from the ledger now" | `ValueUpdateSheetScreen.tsx:278`, `PaymentSheetScreen.tsx:144` |
| "Folded from the ledger on every read" | `ClientPositionDetailScreen.tsx:159`, `PortfolioSummarySection.tsx:21`, `ReturnsDashboardScreen.tsx:75` |
| "Append-only." | `ClientPositionDetailScreen.tsx:236` |
| "Append the reversal" | `ClientLedgerTab.tsx:183-184` |
| "The ledger entry, if any, carries this date." | `MaturityConfirmDialog.tsx:185`, `MaturityResolveDialog.tsx:191` |
| "No ledger change." | `MaturityResolveDialog.tsx:126` |
| "sent two at a time" | `PaymentSheetScreen.tsx:33` |
| "Each tab reads live from the backend when you open it." | `ClientHubTabs.tsx:51` |
| "Every number is read live from the backend." | `OverviewScreen.tsx:160` |
| "Filtering runs on the server" | `AuditLogScreen.tsx:67` |
| "Entity type, for example content_item" and "Command, for example user.suspended" | `AuditLogScreen.tsx:110-111` |
| "The published app_config_versions row with no retirement date" | `AppConfigBuilderScreen.tsx:217` |
| "config cache" | `AppConfigBuilderScreen.tsx:291` |
| "Concurrency version" | `FundWorkspaceScreen.tsx:153` |
| "Version" | `UserDetailScreen.tsx:123`, `ApplicationDetailScreen.tsx:107` |
| "chain of snapshots" | `AumOverviewScreen.tsx:133` |
| "Growth batch" with a raw id, "direct entry" | `FundAumHistoryScreen.tsx:76-79` |
| "Provider message", "withheld", "mail provider" | `EmailDeliveriesScreen.tsx:60,65-66,142-144` |
| "PII", "Tombstoned" | `ApplicationQueueScreen.tsx:117,119` |
| "Slug" | `FundCreateScreen.tsx:107` |
| "AUM writes" | `FundCreateScreen.tsx:36`, `FundAumScreen.tsx:52-53` |
| "backend" in errors | `FundCreateScreen.tsx:29`, `FundWorkspaceScreen.tsx:52`, `FundSizeAdjustmentForm.tsx:52` |
| "Withdrawals use positive growth first." | `MaturityPanel.tsx:80` |
| "Option 3 is not offered" | `MaturitySendDialog.tsx:32` |
| "Schedule link" | `useRecordingSheetRecorder.ts:35` |

**Raw ids, codes and enums rendered:**

| Value | Where |
|---|---|
| user id | `ReturnsDashboardScreen.tsx:66`, `CreateClientScreen.tsx:301` |
| fund id | the CA-13 list |
| reason codes | `ClientPositionDetailScreen.tsx:299`, `ClientLedgerTab.tsx:152`, `FundAumHistoryScreen.tsx:82`, `FundAumScreen.tsx:244`; also the default input values "initial_aum", "fund_size_adjustment", "periodic_growth" (`FundCreateScreen.tsx:49`, `FundAumScreen.tsx:64`, `FundSizeAdjustmentForm.tsx:73`, `CollectiveAumGrowthScreen.tsx:153`) |
| batch and entry UUIDs | `GrowthReceipt.tsx:19-24` |
| templateKey | `EmailDeliveriesScreen.tsx:118`, `ClientEmailsTab.tsx:41`, `ApplicationDetailScreen.tsx:211` |
| lastErrorCode | `EmailDeliveriesScreen.tsx:138`, `ClientEmailsTab.tsx:54`, `PasswordLinkPanel.tsx:101`, `ApplicationDetailScreen.tsx:235` |
| channel and requestId | `UserLoginEventsList.tsx:61,79` |
| roles | `UserDetailScreen.tsx:111` |
| failureCode | `UserDetailScreen.tsx:252` |
| consent kind, decision and reasonCode | `ApplicationDetailScreen.tsx:160,180-181` |
| contentKey | `FaqListScreen.tsx:217` |
| audit actor, command, entity and request | `AuditTrailTable.tsx:38-96` |
| ticket reference | `SupportInboxScreen.tsx:84`, `SupportTicketScreen.tsx:38,108` |
| content digest | `AppConfigBuilderScreen.tsx:196-197` |
| sesMessageId | `EmailDeliveriesScreen.tsx:144` |
| actorUserId fallback | `ContactHistoryList.tsx:43` |
| account state and email verification as plain text | `CreateClientScreen.tsx:303-304` |
| maturity and payout state | `MaturityPanel.tsx:109`, `WithdrawalPayoutPanel.tsx:39,54` |
| holding state | `FundHoldingsScreen.tsx:352` |
| risk level and return tier | `FundTermsForm.tsx:152,171` |

**One person, five names:**

| Name | Where |
|---|---|
| "client" | most screens |
| "investor" | collective growth, fund terms, holdings, FAQ, the lifecycle reason field (`UserLifecyclePanel.tsx:35,40,162`), "Investor record" (`ClientHubActions.tsx:21`), the "Investor" role label |
| "user" | page title "User", "No user matches" |
| "account" | "accounts so far", "Every account on the platform" |
| "applicant" and "invitee" | `ApplicationQueueScreen.tsx:84`, `ClientContactsSection.tsx:58` |

Monthly value update says "client" throughout. Collective growth says "investor" throughout.

**One thing, several names:**

| Concept | Names in use |
|---|---|
| A recorded holding | "record", "position", "holding" ("One investor's record" vs manifest "position"; "holding" vs "position" in `ResolutionFacts.tsx:91`) |
| Growth | "Growth" vs "Gain so far" vs "Gain or loss" |
| Invested amount | "Invested" vs "Amount invested" vs "Principal" |
| Value | "Value" vs "Current value" |
| Return | "Return" vs "Simple return" |
| Versions | "Version" vs "Revision" (templates and AUM) |
| AUM | "AUM" vs "fund size" vs "opening AUM" |
| Monthly payments | "Monthly payments" vs "SIP payments" vs "monthly investment" vs "Record the payments" (`PaymentSheetScreen.tsx:33,194-195`) |
| Sign-in records | "Login events" vs "Sign-in history" vs "Sign-ins" |
| Maturity actions | "Confirm choice" vs "Confirm the client's choice"; "Resolve" vs "Confirm resolution"; "Change date" vs "Change the date" |

**Pluralisation:** "(s)" is used instead of real plurals:
- "position(s)", "adjustment(s)" (`CollectiveClientGrowthScreen.tsx:221,375`)
- "client(s)", "change(s)", "row(s)" (`ValueUpdateSheetScreen.tsx:267,303-305`)
- "update(s)" (`ValueUpdatePreview.tsx:149`)
- "fund size(s)" (`CollectiveAumGrowthScreen.tsx:257,408`)
- "line(s)" (`RecordingSheetCsvPanel.tsx:54,57`)

Real plurals are used elsewhere (`MaturityDuePrompt.tsx:71`), and `domain/plural` exists.

**Apostrophes:**
- Curly ’ in `ClientPositionDetailScreen.tsx:122` (under an h1 with a straight one) and `FundHoldingsScreen.tsx:165,189`.
- Straight `'` or `&apos;` everywhere else.

**Vague errors:**
- "That did not work." (`FundWorkspaceScreen.tsx:53,59`, `FundAumScreen.tsx:56`)
- "We could not apply that change." (the only error using "we", `UserLifecyclePanel.tsx:52`)

**Ellipsis:** "..." as three periods (`reviews/reviewPresentation.tsx:6`).

## 6. Parked (DEC-14)

Payments, AutoPay, the gateway, mandates and refunds stay untouched until the maintainer resumes them (DEC-14, tally `rule-17`). These screens appear in the inventory above for completeness only, and this audit proposes no change to them:

| Route | Screen |
|---|---|
| `/receipts` | `features/admin/receipts/FundReceiptQueueScreen.tsx:29` |
| `/receipts/:orderId` | `features/admin/receipts/FundReceiptDetailScreen.tsx:47` |
| `/refunds` | `features/admin/refunds/RefundQueueScreen.tsx:70` |
| `/payments` | `features/admin/payments/PaymentEvidenceScreen.tsx:19` |
| `/mandates` | `features/admin/mandates/MandateListScreen.tsx:37` |
| `/mandates/:mandateId` | `features/admin/mandates/MandateDetailScreen.tsx:31` |

Gateway-related pieces on unparked screens are also left as they are:
- the "Mandates" link on the user page (`ClientHubActions.tsx:18`);
- the user page's "Recent orders" table of gateway orders (`UserDetailScreen.tsx:207-257`);
- three of the four overview queue tiles, which count receipts, refunds and mandates (`OverviewScreen.tsx:41-58`).

When the parked screens are resumed, the patterns above (CA-01 back control, CA-02/CA-03 unknown outcomes, CA-11 tables, CA-15 URL filters, CA-41 whole-rupee amounts) apply to them in the same way.

Whether `WithdrawalPayoutPanel` (maturity payouts, with a "Bank transfer reference" field at `WithdrawalPayoutPanel.tsx:48`) falls under DEC-14, or under tally `rule-18` (no bank details, payment instructions or reference numbers), is for the maintainer. The panel is listed above but not parked here.

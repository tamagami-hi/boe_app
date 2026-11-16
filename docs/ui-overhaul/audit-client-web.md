# UI audit U2: client app, web browser

Read-only audit of the client app in a browser at tablet and desktop widths (`app.beonedge.in`), for the UI overhaul (DEC-40). It keeps today's BeOnEdge identity and design system (DEC-45). Fixes wait for the per-surface plan (U5) and its approval (DEC-47).

## Summary

At 768 px the client app is the phone layout with wider margins. From 1024 px it switches to a floating pill bar at the top and drops the app bar, which removes the only back control: no route at 1280 or 1440 has a way back other than the browser (UCW-02). The tab is never highlighted on sub-pages, and every browser tab is titled "BeOnEdge" (UCW-03, UCW-04). The Home and Profile failure loop from the phone audit happens here too (UCW-01). Layout is otherwise stable: no horizontal overflow at any width, one container width per breakpoint, and tables only where they fit (Funds, statement print). Smaller issues are detail rows that stop at two thirds of their card, three table styles, and the shared copy, contrast and money-format issues of the phone audit, listed once more here so this document stands alone.

Counts: 24 findings: 1 high, 9 medium, 14 low.

## Method

- **Commit audited:** `a842496` on `track/u-audits`; Phase I screens are not on this branch and are left out (DEC-47).
- **Widths:** 768×1024 (tablet, touch on), 1280×800 and 1440×900 (desktop, mouse), Chromium 1248 through Playwright 1.59.1, device scale 1, `en-IN`, `Asia/Kolkata`, reduced motion on so the reveal animation does not hide content in screenshots.
- **Stack and data:** the same local stack and data as U1 ([audit-client-mobile.md](audit-client-mobile.md), Method): migrations 001 to 071, seeds, the backend and the client dev server in the Node 22 container, payments unconfigured, app config unpublished (as production until G11), plus a browser-only pass with `onlinePayments=false`.
- **Per route and width:** viewport and full-page screenshots and the same in-page probe as U1. Screenshots and JSON are in the closed track's scratch folder `.temp/closed/u-audits/` (not committed); paths below are relative to it.
- **States:** failed (500) and slow (7 s) reads on 13 money and account screens at 1280×800.
- **Keyboard:** tab order and focus indicator on sign-in and Home at 1280 px.
- **Not checked:** browsers other than Chromium; browser zoom at 200% and 400% (WCAG reflow); a real screen reader; print output; Phase I screens; contrast over gradients (about 60% of text nodes sit on a gradient and were skipped by the probe).

Severity: **high** breaks a screen or blocks a task; **medium** is hard to use or breaks a rule in `RULES.md`; **low** is polish.

## Findings

| ID | Sev | Route and width | What is wrong | Evidence | Direction of a fix (DEC-45) |
| --- | --- | --- | --- | --- | --- |
| UCW-01 | high | `/dashboard`, `/profile`; 768, 1280, 1440 | Same as UCM-01: on failed reads Home and Profile stay on skeletons and "Checking…" (26 s and counting) and Home re-requests its reads in a loop; every other money screen shows the failure panel with "Try again". Rule 4 breach. | `shots/states/client/1280x800/dashboard.fail.late.png`, `profile.fail.late.png`; `results/states-client.json`; `src/shells/client/ClientRoutes.tsx:16-29`, `src/app/routing/buildRouter.tsx:31-35` | As UCM-01: stable router and screen components; let the eligibility failure reach the existing failure patterns. |
| UCW-02 | medium | 27 routes at 1280 and 1440 (all except auth and print) | No back control. The phone app bar, which holds the back arrow, is hidden from 1024 px, and the pill bar has only the five tabs and the bell. A receipt, a fund, an investment, value updates, statements, notifications and every profile page can only be left through the tabs or the browser. At 768 px the same pages have a back arrow. | `shots/client/1280x800/receipt-detail.png`, `fund-detail.png`; `src/ui/recipes/shellClient.ts:9` (`lg:hidden`), `src/shells/client/ClientFrame.tsx:71-98` | A back or breadcrumb link above the page heading at desktop widths, fed by the same route `back` data as the phone bar. |
| UCW-03 | medium | all sub-pages; 1280, 1440 | The pill bar highlights a tab only on the five tab pages; on 22 sub-pages no tab is current (0 `aria-current` elements on receipts, an investment, contact details). | `logs/probes.txt`; `src/shells/client/ClientFrame.tsx:80` | Mark the owning section as current on its sub-pages. |
| UCW-04 | medium | every route; 768, 1280, 1440 | The browser tab title is "BeOnEdge" on every page; nothing sets `document.title` per route. Tabs, history and bookmarks cannot be told apart. WCAG 2.2 2.4.2 Page Titled. | `results/client-1280x800.json` (`docTitle`, 45 of 45 routes); `frontend_stack_ts/index.html:11` | Set the title from the route manifest's `title` (with the fund or record name where the heading has one), e.g. "Receipts · BeOnEdge". |
| UCW-05 | medium | every money screen and auth pages; all widths | The faint text token (`#8a929d`) is 2.79:1 on the page and 2.99:1 on cards. It carries the market-risk footnote, timestamps, references and "Not available" in the Funds table. Failing text on 22 routes at 1280 px. WCAG 2.2 AA needs 4.5:1. | `results/client-1280x800.json` (`contrast`); `src/ui/tokens/tokens-core.css:15,35` | Darken the token or use `fg-muted` for meaningful text. |
| UCW-06 | medium | `/verify-email` and every disabled primary; all widths | Disabled primary buttons keep the dark gradient and look pressable. | `logs/probes.txt`; `src/ui/primitives/Button.tsx:59-67`, `src/ui/recipes/button.ts:15,43` | The disabled recipe must override every tone. |
| UCW-07 | medium | `/portfolio`, `/activity`, `/notifications`, `/profile`; all widths | Payment wording as UCM-05: with the flag unset the empty states point to "Browse funds" and "your first payment"; with payments off, "Payment recorded" and "Payment confirmations, SIP reminders" remain. | `shots/client/1280x800/empty_portfolio.png`, `empty_activity.png`; `shots/payoff/1280x800/*.png`; `src/features/activity/ActivityScreen.tsx:42`, `src/features/notifications/NotificationsScreen.tsx:124` | G11 is the maintainer's; reword the strings that remain with payments off. |
| UCW-08 | low | `/sips`; all widths | The parked SIP plans page tells a client with an admin-tracked monthly plan "You have no SIP plans" (UCM-06); it is linked only when gateway plans exist. | `shots/client/1280x800/sips.png`, `dashboard.png` | No change to the parked screen (DEC-14); note it for when payments resume. |
| UCW-09 | medium | `/maturity-options/:offerId`; all widths | "Withdraw your money" is preselected and the choose button enabled (UCM-07). | `shots/client/1280x800/maturity-options.png`; `src/features/maturity-options/MaturityOptionsScreen.tsx:66` | No default option; button disabled until a choice. |
| UCW-10 | medium | `/funds`, `/funds/:id`, empty `/portfolio`; all widths | No "Investments are subject to market risk." where fund sizes and minimums are shown; empty Portfolio has no footnote while empty Activity has one (UCM-11). Home's fund cards show the fund size unlabelled (UCM-13). | `shots/client/1280x800/funds.png`, `fund-detail.png`, `dashboard.png` | `MoneyFootnote` on every amount-bearing screen; label fund sizes. |
| UCW-11 | medium | `/login`, `/password/forgot`, `/reset-password`; all widths | The page `h1` is the tagline, the form title is an `h2`, and there is no `main` landmark (UCM-12). | `results/client-1280x800.json` (`headings`, `landmarks`); `src/app/layouts/AuthLayout.tsx:73,101` | Form title as `h1`, panel in `main`. |
| UCW-12 | low | `/profile`, `/maturity-options/:offerId`, `/activity/receipts/:id`; 1280, 1440 | Detail rows stop at 44 rem inside wider cards, leaving the right third of the card empty, while Contact details splits the same rows into two columns. | `shots/client/1280x800/profile.png`, `maturity-options.png`, `profile-contact.png`; `src/ui/recipes/datalist.ts:3-7,17` | One rule for detail rows at desktop width: fill the card or split it, chosen by the card's width rather than the viewport's. |
| UCW-13 | low | 768 vs 1024 and up | Two navigation models: 768 to 1023 px uses the phone app bar (back, bell) and the bottom bar; from 1024 px the pill bar replaces both. The switch moves the bell, drops back, and changes where header actions sit. | `shots/client/768x1024/*.png`, `shots/client/1280x800/*.png` | Keep one model per input type and carry the back control across the switch. |
| UCW-14 | low | `/funds`, `/statements/print`; 1280, 1440 | Three table styles in the client app and admin: the Funds table has its own recipe (head letter-spacing 0.16 em, sand head row), the statement table another (`tracking-eyebrow`, strong rule), admin a third. The Funds sort buttons are hand-made toggles rather than the shared toggle primitive. | `shots/client/1280x800/funds.png`, `statement-print.png`; `src/features/funds/funds.recipe.ts:8-14,27-63`, `src/features/statements/statements.recipe.ts:32-57` | One table recipe and the shared toggle in `src/ui`. |
| UCW-15 | low | `/statements/print`; 1280, 1440 | The print page uses the wide container (1,280 and 1,296 px) and starts at the left edge, unlike every other page (1,050 and 1,181 px, centred). | `shots/client/1280x800/statement-print.png` | Use the default page width on screen; the print styles can stay full width. |
| UCW-16 | low | `/dashboard`, `/statements`, `/statements/print`; all widths | Zero amounts and withdrawals are green (UCM-16). | `shots/client/1280x800/statement-print.png` | Neutral for zero; money-out tone for withdrawals. |
| UCW-17 | low | `/maturity-options/:offerId`, `/activity/receipts/:id`; all widths | Paise shown on two screens, whole rupees elsewhere (UCM-15). | `shots/client/1280x800/maturity-options.png` | One precision rule in the shared formatter. |
| UCW-18 | low | all dated routes; all widths | Mixed date and time formats: "Sept", "December" in notification text, 24-hour and 12-hour times, em-dash ranges (UCM-17). | `results/client-1280x800.json` (`dates`); `src/domain/dates.ts:22-44` | One date and time style. |
| UCW-19 | low | status words; all widths | "Available", "Unlocked", "Locked"; "As at" and "As of"; "1 payment" (UCM-18). | screenshots of `/dashboard`, `/profile`, `/funds/:id` | One vocabulary list. |
| UCW-20 | low | empty states; 1280, 1440 | Empty panels are 46 rem wide and centred while the page heading above them is left-aligned, and their action button is left-aligned inside the centred panel. | `shots/client/1280x800/empty_portfolio.png`, `empty_activity.png` | Align empty panels with the page column; centre their actions. |
| UCW-21 | low | `/activity`, `/statements`; all widths | "Print statement" shows on an empty Statements page; header actions are chips on Activity and Statements but pills with arrows elsewhere. | `shots/client/1280x800/empty_statements.png`, `activity.png` | Hide actions that have nothing to act on; one header-action style. |
| UCW-22 | low | `/profile/email-verification`; all widths | The "Verified" badge stretches to the card width (UCM-19). | `shots/client/1280x800/profile-email-verification.png` | Inline badge width. |
| UCW-23 | low | all slow reads; all widths | Skeletons carry no `aria-busy` or live text (UCM-29). | `results/states-client.json` | Busy state in `AsyncBoundary`. |
| UCW-24 | low | 768 (touch) | The 36 px text links of the phone audit (support contacts, "View receipt", fund names in cards) remain 36 px at 768, where the tablet is touch-driven. | `results/client-768x1024.json` (`targets.under44`) | 44 px targets below 1024 px. |

## Inconsistencies

### Between routes (web)

- **Back control:** present at 768 px (phone app bar) on every route but Home; absent at 1280 and 1440 px on all 27 signed-in routes except the statement print page ("Back to statements") and the parked SIP plan page (UCW-02).
- **Current tab:** the pill bar marks the five tab roots only (UCW-03).
- **Page title:** in the page heading only; the browser tab title never changes (UCW-04). Six headings differ from the manifest titles (Home's greeting, a fund's or investment's fund name, "Your maturity options", the not-found heading).
- **Container width:** content width (1,050 px at 1280, 1,181 px at 1440) on 33 routes, form width (560 px) on 7 (verification, security and the parked payment screens), wide (1,280 to 1,296 px, left-aligned) on the statement print page (UCW-15). Contact details and Security, sibling profile pages, have different widths.
- **Header actions:** at web width "Receipts" (Activity) and "Print statement" (Statements) sit at the right of the heading as chips; "Value updates" is a pill in a section header; "See all" a text link with an arrow chip; "Fund details" and "All receipts" pills at the end of content (UCW-21).
- **Detail rows:** capped at 44 rem in most cards, split into two columns on Contact details (UCW-12).
- **Tables:** two in the client app (Funds, statement print), each with its own recipe (UCW-14).
- **Empty states, money, dates and status words:** as in U1 (UCW-16 to UCW-20).

### Web and phone layouts of the same route

See U1, "Phone and web layouts of the same route". At 768 px the client app uses the phone layout with 24 px padding and a 960 px cap; the switch to the pill bar happens at 1024 px.

## Pattern inventory (web)

- **Buttons:** the same four tones as on the phone. Heights at 1024 px and up: 48 px on auth forms, 40 px for other primaries, 36 px for header and small actions (the `sm` and `md` sizes drop to compact targets from `lg`). The pill bar's tabs are 36 px; the bell is a 38 px circle.
- **Cards and lists:** stacked cards for every list except Funds (table) and the statement print page (table, full width); the Home dashboard uses a bento grid (value card beside the account card).
- **Forms:** labels above fields, required asterisk, hints under the field, full-width primary submit under the fields (the fields themselves are capped at 38 rem on support).
- **Loading, empty and error:** as on the phone; failure panels within 8 to 15 s on 11 of 13 tested screens, endless on Home and Profile (UCW-01).
- **Money:** ₹ with Indian grouping everywhere, signed growth in green, the market-risk footnote in faint 12 px text (UCW-05).
- **Dates:** as on the phone (UCW-18).
- **Toasts and dialogs:** none on the audited routes; inline alerts for results.
- **Type and spacing:** seventeen font sizes at 1280 px (10, 12, 13, 15, 16, 18, 22, 28, 40 to 49 for page titles, 56 and 72 px on the auth tagline). Page padding 32 px, page top 64 px, section gap 48 px.

## States: failed and slow reads (1280×800)

| Screen | Failed read (500) | Slow read (7 s) |
| --- | --- | --- |
| Home | endless skeleton and "Checking…" (UCW-01) | skeleton, then content |
| Portfolio, investment, value updates, Activity, Receipts, SIP plans, Statements, maturity options, Notifications, Funds, Support | failure panel with "Try again" and a reference within 8 to 15 s | skeleton, then content |
| Profile | "Checking…" and a blank nominee panel for good (UCW-01) | skeleton, then content |

Evidence: `shots/states/client/1280x800/*.png`, `results/states-client.json`.

## Keyboard

Sign-in and Home at 1280 px, with the Tab key (`results/keyboard.json`, `shots/keyboard/client-1280-*.png`):

- Sign-in order: Email, Password, "Forgot your password?", "Sign in", the support email link. Enter submits. Focus visible at every stop (2 px ring on inputs, 2 px outline elsewhere).
- Home order: the five pill tabs and the bell (6 stops), then the page. There is no skip link, but six stops is acceptable.
- No focused element was outside the viewport or covered.

## Parked under DEC-14

No proposal for `/pay/return`, `/funds/:id/invest/lumpsum`, `/funds/:id/invest/sip`, `/activity/payments/:id`, `/sips` and `/sips/:id`. With the app config unpublished, the fund page offers "Invest a lump sum" and "Start a SIP" into them; G11 is the maintainer's.

## Navigation and page-shell inventory

One row per route and width (768, 1280, 1440). Columns as in U1. Routes prefixed `empty:` were captured with a client who has nothing recorded, `unverified:` with an unverified client. The browser tab title is "BeOnEdge" on every route.

| Route | Width | Title shown | Back control | Header / app bar | Main navigation | Primary action | Container |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `splash` | 768 | no h1 | absent | none (bare page) | none | none | max none, w 768, pad 24px/24px, top 24px |
| `splash` | 1280 | no h1 | absent | none (bare page) | none | none | max none, w 1280, pad 24px/24px, top 24px |
| `splash` | 1440 | no h1 | absent | none (bare page) | none | none | max none, w 1440, pad 24px/24px, top 24px |
| `login` | 768 | h1 'Investing, made deliberate'; manifest 'Sign in' | absent | none (bare page) | none | 'Sign in' primary, bottom, full width, 52px | no <main> (count 0) |
| `login` | 1280 | h1 'Investing, made deliberate'; manifest 'Sign in' | absent | none (bare page) | none | 'Sign in' primary, bottom, full width, 48px | no <main> (count 0) |
| `login` | 1440 | h1 'Investing, made deliberate'; manifest 'Sign in' | absent | none (bare page) | none | 'Sign in' primary, bottom, full width, 48px | no <main> (count 0) |
| `forgot-password` | 768 | h1 'Investing, made deliberate'; manifest 'Reset your password' | Back to sign in [in page, y=643] -> /login | none (bare page) | none | 'Email me a reset link' primary, bottom, full width, 52px | no <main> (count 0) |
| `forgot-password` | 1280 | h1 'Investing, made deliberate'; manifest 'Reset your password' | Back to sign in [in page, y=523] -> /login | none (bare page) | none | 'Email me a reset link' primary, bottom, full width, 48px | no <main> (count 0) |
| `forgot-password` | 1440 | h1 'Investing, made deliberate'; manifest 'Reset your password' | Back to sign in [in page, y=573] -> /login | none (bare page) | none | 'Email me a reset link' primary, bottom, full width, 48px | no <main> (count 0) |
| `reset-password` | 768 | h1 'Investing, made deliberate'; manifest 'Choose a new password' | absent | none (bare page) | none | none | no <main> (count 0) |
| `reset-password` | 1280 | h1 'Investing, made deliberate'; manifest 'Choose a new password' | absent | none (bare page) | none | none | no <main> (count 0) |
| `reset-password` | 1440 | h1 'Investing, made deliberate'; manifest 'Choose a new password' | absent | none (bare page) | none | none | no <main> (count 0) |
| `payment-return` (parked) | 768 | h1 'Back from PhonePe' | absent | none (bare page) | none | none | max 560px, w 560, pad 24px/24px, top 40px |
| `payment-return` (parked) | 1280 | h1 'Back from PhonePe' | absent | none (bare page) | none | none | max 560px, w 560, pad 32px/32px, top 64px |
| `payment-return` (parked) | 1440 | h1 'Back from PhonePe' | absent | none (bare page) | none | none | max 560px, w 560, pad 32px/32px, top 64px |
| `verify-email` | 768 | h1 'Verify your email' | Go back [app bar, top-left] -> home | sticky bar [Go back, Notifications, 2 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | 'Verify' primary, middle, full width, 52px | max 560px, w 560, pad 24px/24px, top 40px |
| `verify-email` | 1280 | h1 'Verify your email' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Verify' primary, middle, full width, 48px | max 560px, w 560, pad 32px/32px, top 64px |
| `verify-email` | 1440 | h1 'Verify your email' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Verify' primary, middle, full width, 48px | max 560px, w 560, pad 32px/32px, top 64px |
| `dashboard` | 768 | h1 'Good to see you, BeOnEdge'; manifest 'Home' | absent | sticky bar [Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current 'Home') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `dashboard` | 1280 | h1 'Good to see you, BeOnEdge'; manifest 'Home' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `dashboard` | 1440 | h1 'Good to see you, BeOnEdge'; manifest 'Home' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `funds` | 768 | h1 'Funds' | Go back [app bar, top-left] -> parent -> /dashboard | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current 'Funds') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `funds` | 1280 | h1 'Funds' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `funds` | 1440 | h1 'Funds' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `fund-detail` | 768 | h1 'BeOnEdge Growth Fund'; manifest 'Fund' | Go back [app bar, top-left] -> parent -> /funds | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | 'Invest a lump sum' primary, middle, left, 52px | max 960px, w 768, pad 24px/24px, top 40px |
| `fund-detail` | 1280 | h1 'BeOnEdge Growth Fund'; manifest 'Fund' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Invest a lump sum' primary, middle, left, 48px | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `fund-detail` | 1440 | h1 'BeOnEdge Growth Fund'; manifest 'Fund' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Invest a lump sum' primary, middle, left, 48px | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `invest-lumpsum` (parked) | 768 | h1 'Invest a lump sum' | Go back [app bar, top-left] -> parent -> /funds/:fundId | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | 'Continue to PhonePe' primary, middle, full width, 44px | max 560px, w 560, pad 24px/24px, top 40px |
| `invest-lumpsum` (parked) | 1280 | h1 'Invest a lump sum' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Continue to PhonePe' primary, middle, full width, 40px | max 560px, w 560, pad 32px/32px, top 64px |
| `invest-lumpsum` (parked) | 1440 | h1 'Invest a lump sum' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Continue to PhonePe' primary, middle, full width, 40px | max 560px, w 560, pad 32px/32px, top 64px |
| `invest-sip` (parked) | 768 | h1 'Start a SIP' | Go back [app bar, top-left] -> parent -> /funds/:fundId | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | 'Create the SIP' primary, bottom, full width, 44px | max 560px, w 560, pad 24px/24px, top 40px |
| `invest-sip` (parked) | 1280 | h1 'Start a SIP' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Create the SIP' primary, bottom, full width, 40px | max 560px, w 560, pad 32px/32px, top 64px |
| `invest-sip` (parked) | 1440 | h1 'Start a SIP' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Create the SIP' primary, bottom, full width, 40px | max 560px, w 560, pad 32px/32px, top 64px |
| `portfolio` | 768 | h1 'Portfolio' | Go back [app bar, top-left] -> parent -> /dashboard | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current 'Portfolio') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `portfolio` | 1280 | h1 'Portfolio' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `portfolio` | 1440 | h1 'Portfolio' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `invested-fund` | 768 | h1 'BeOnEdge Growth Fund'; manifest 'Your investment' | Go back [app bar, top-left] -> parent -> /portfolio | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `invested-fund` | 1280 | h1 'BeOnEdge Growth Fund'; manifest 'Your investment' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `invested-fund` | 1440 | h1 'BeOnEdge Growth Fund'; manifest 'Your investment' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `value-updates` | 768 | h1 'Value updates' | Go back [app bar, top-left] -> parent -> /portfolio | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `value-updates` | 1280 | h1 'Value updates' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `value-updates` | 1440 | h1 'Value updates' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `maturity-options` | 768 | h1 'Your maturity options'; manifest 'Maturity options' | Go back [app bar, top-left] -> parent -> /portfolio | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | 'Choose this option' primary, bottom, full width, 44px | max 960px, w 768, pad 24px/24px, top 40px |
| `maturity-options` | 1280 | h1 'Your maturity options'; manifest 'Maturity options' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Choose this option' primary, bottom, full width, 40px | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `maturity-options` | 1440 | h1 'Your maturity options'; manifest 'Maturity options' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Choose this option' primary, bottom, full width, 40px | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `activity` | 768 | h1 'Activity' | Go back [app bar, top-left] -> parent -> /dashboard | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current 'Activity') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `activity` | 1280 | h1 'Activity' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `activity` | 1440 | h1 'Activity' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `payment-status` (parked) | 768 | h1 'Payment' | Go back [app bar, top-left] -> parent -> /activity | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | none | max 560px, w 560, pad 24px/24px, top 40px |
| `payment-status` (parked) | 1280 | h1 'Payment' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 560px, w 560, pad 32px/32px, top 64px |
| `payment-status` (parked) | 1440 | h1 'Payment' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 560px, w 560, pad 32px/32px, top 64px |
| `receipts` | 768 | h1 'Receipts' | Go back [app bar, top-left] -> parent -> /activity | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `receipts` | 1280 | h1 'Receipts' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `receipts` | 1440 | h1 'Receipts' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `receipt-detail` | 768 | h1 'Receipt' | Go back [app bar, top-left] -> parent -> /activity/receipts | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `receipt-detail` | 1280 | h1 'Receipt' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `receipt-detail` | 1440 | h1 'Receipt' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `sips` | 768 | h1 'SIP plans' | Go back [app bar, top-left] -> parent -> /portfolio | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | 'Browse funds' primary, middle, left, 44px | max 960px, w 768, pad 24px/24px, top 40px |
| `sips` | 1280 | h1 'SIP plans' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Browse funds' primary, bottom, left, 40px | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `sips` | 1440 | h1 'SIP plans' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Browse funds' primary, bottom, left, 40px | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `sip-detail` | 768 | h1 'SIP plan' | Go back [app bar, top-left] -> parent -> /sips; Back to SIP plans [in page, y=297] -> /sips | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `sip-detail` | 1280 | h1 'SIP plan' | Back to SIP plans [in page, y=369] -> /sips | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `sip-detail` | 1440 | h1 'SIP plan' | Back to SIP plans [in page, y=374] -> /sips | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `statements` | 768 | h1 'Statements' | Go back [app bar, top-left] -> parent -> /profile | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `statements` | 1280 | h1 'Statements' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `statements` | 1440 | h1 'Statements' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `statement-print` | 768 | h1 'Investment statement' | Back to statements [in page, y=40] -> /statements | none (bare page) | none | 'Print' primary, top, left, 44px | max 1280px, w 768, pad 24px/24px, top 40px |
| `statement-print` | 1280 | h1 'Investment statement' | Back to statements [in page, y=64] -> /statements | none (bare page) | none | 'Print' primary, top, left, 36px | max 1280px, w 1280, pad 32px/32px, top 64px |
| `statement-print` | 1440 | h1 'Investment statement' | Back to statements [in page, y=64] -> /statements | none (bare page) | none | 'Print' primary, top, left, 36px | max 1296px, w 1296, pad 32px/32px, top 64px |
| `notifications` | 768 | h1 'Notifications' | Go back [app bar, top-left] -> parent -> /dashboard | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `notifications` | 1280 | h1 'Notifications' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `notifications` | 1440 | h1 'Notifications' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `profile` | 768 | h1 'Profile' | Go back [app bar, top-left] -> parent -> /dashboard | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current 'Profile') | 'Save my nominee' primary, middle, full width, 44px | max 960px, w 768, pad 24px/24px, top 40px |
| `profile` | 1280 | h1 'Profile' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Save my nominee' primary, middle, full width, 40px | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `profile` | 1440 | h1 'Profile' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Save my nominee' primary, middle, full width, 40px | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `profile-email-verification` | 768 | h1 'Email verification' | Go back [app bar, top-left] -> parent -> /profile | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | none | max 560px, w 560, pad 24px/24px, top 40px |
| `profile-email-verification` | 1280 | h1 'Email verification' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 560px, w 560, pad 32px/32px, top 64px |
| `profile-email-verification` | 1440 | h1 'Email verification' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 560px, w 560, pad 32px/32px, top 64px |
| `profile-contact` | 768 | h1 'Contact details' | Go back [app bar, top-left] -> parent -> /profile | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | 'Send a code to the new addre' primary, middle, full width, 44px (+1) | max 960px, w 768, pad 24px/24px, top 40px |
| `profile-contact` | 1280 | h1 'Contact details' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Send a code to the new addre' primary, middle, full width, 40px (+1) | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `profile-contact` | 1440 | h1 'Contact details' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Send a code to the new addre' primary, middle, full width, 40px (+1) | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `profile-security` | 768 | h1 'Security' | Go back [app bar, top-left] -> parent -> /profile | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | 'Change my password' primary, middle, full width, 44px (+1) | max 560px, w 560, pad 24px/24px, top 40px |
| `profile-security` | 1280 | h1 'Security' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Change my password' primary, middle, full width, 40px (+1) | max 560px, w 560, pad 32px/32px, top 64px |
| `profile-security` | 1440 | h1 'Security' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Change my password' primary, middle, full width, 40px (+1) | max 560px, w 560, pad 32px/32px, top 64px |
| `profile-support` | 768 | h1 'Support' | Go back [app bar, top-left] -> parent -> /profile | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | 'Send request' primary, middle, full width, 44px | max 960px, w 768, pad 24px/24px, top 40px |
| `profile-support` | 1280 | h1 'Support' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Send request' primary, middle, full width, 40px | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `profile-support` | 1440 | h1 'Support' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Send request' primary, middle, full width, 40px | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `profile-reviews` | 768 | h1 'Reviews' | Go back [app bar, top-left] -> parent -> /profile | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `profile-reviews` | 1280 | h1 'Reviews' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `profile-reviews` | 1440 | h1 'Reviews' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `profile-legal` | 768 | h1 'Legal' | Go back [app bar, top-left] -> parent -> /profile | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `profile-legal` | 1280 | h1 'Legal' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `profile-legal` | 1440 | h1 'Legal' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `investor-charter` | 768 | h1 'Investor charter' | Go back [app bar, top-left] -> parent -> /profile/legal | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `investor-charter` | 1280 | h1 'Investor charter' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `investor-charter` | 1440 | h1 'Investor charter' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `grievance` | 768 | h1 'Grievance redressal' | Go back [app bar, top-left] -> parent -> /profile/legal | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | 'Open support' primary, bottom, left, 44px | max 960px, w 768, pad 24px/24px, top 40px |
| `grievance` | 1280 | h1 'Grievance redressal' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Open support' primary, bottom, left, 40px | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `grievance` | 1440 | h1 'Grievance redressal' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Open support' primary, bottom, left, 40px | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `blocked` -> `/dashboard` | 768 | h1 'Good to see you, BeOnEdge'; manifest 'Account unavailable' | absent | sticky bar [Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current 'Home') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `blocked` -> `/dashboard` | 1280 | h1 'Good to see you, BeOnEdge'; manifest 'Account unavailable' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `blocked` -> `/dashboard` | 1440 | h1 'Good to see you, BeOnEdge'; manifest 'Account unavailable' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `not-found` | 768 | h1 'We could not find that page'; manifest 'Not found' | Go back [app bar, top-left] -> home | sticky bar [Go back, Notifications, 10 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | 'Go to home' primary, middle, right, 44px | max 960px, w 768, pad 24px/24px, top 40px |
| `not-found` | 1280 | h1 'We could not find that page'; manifest 'Not found' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Go to home' primary, middle, right, 40px | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `not-found` | 1440 | h1 'We could not find that page'; manifest 'Not found' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Go to home' primary, middle, right, 40px | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `empty:dashboard` | 768 | h1 'Good to see you, Rohan'; manifest 'Home' | absent | sticky bar [Notifications] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current 'Home') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `empty:dashboard` | 1280 | h1 'Good to see you, Rohan'; manifest 'Home' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `empty:dashboard` | 1440 | h1 'Good to see you, Rohan'; manifest 'Home' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `empty:portfolio` | 768 | h1 'Portfolio' | Go back [app bar, top-left] -> parent -> /dashboard | sticky bar [Go back, Notifications] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current 'Portfolio') | 'Browse funds' primary, middle, left, 44px | max 960px, w 768, pad 24px/24px, top 40px |
| `empty:portfolio` | 1280 | h1 'Portfolio' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Browse funds' primary, bottom, left, 40px | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `empty:portfolio` | 1440 | h1 'Portfolio' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Browse funds' primary, bottom, left, 40px | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `empty:activity` | 768 | h1 'Activity' | Go back [app bar, top-left] -> parent -> /dashboard | sticky bar [Go back, Notifications] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current 'Activity') | 'Browse funds' primary, middle, left, 44px | max 960px, w 768, pad 24px/24px, top 40px |
| `empty:activity` | 1280 | h1 'Activity' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Browse funds' primary, middle, left, 40px | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `empty:activity` | 1440 | h1 'Activity' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Browse funds' primary, middle, left, 40px | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `empty:receipts` | 768 | h1 'Receipts' | Go back [app bar, top-left] -> parent -> /activity | sticky bar [Go back, Notifications] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `empty:receipts` | 1280 | h1 'Receipts' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `empty:receipts` | 1440 | h1 'Receipts' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `empty:value-updates` | 768 | h1 'Value updates' | Go back [app bar, top-left] -> parent -> /portfolio | sticky bar [Go back, Notifications] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `empty:value-updates` | 1280 | h1 'Value updates' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `empty:value-updates` | 1440 | h1 'Value updates' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `empty:sips` | 768 | h1 'SIP plans' | Go back [app bar, top-left] -> parent -> /portfolio | sticky bar [Go back, Notifications] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | 'Browse funds' primary, middle, left, 44px | max 960px, w 768, pad 24px/24px, top 40px |
| `empty:sips` | 1280 | h1 'SIP plans' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Browse funds' primary, bottom, left, 40px | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `empty:sips` | 1440 | h1 'SIP plans' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Browse funds' primary, bottom, left, 40px | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `empty:statements` | 768 | h1 'Statements' | Go back [app bar, top-left] -> parent -> /profile | sticky bar [Go back, Notifications] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `empty:statements` | 1280 | h1 'Statements' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `empty:statements` | 1440 | h1 'Statements' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `empty:notifications` | 768 | h1 'Notifications' | Go back [app bar, top-left] -> parent -> /dashboard | sticky bar [Go back, Notifications] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `empty:notifications` | 1280 | h1 'Notifications' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `empty:notifications` | 1440 | h1 'Notifications' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `empty:profile-support` | 768 | h1 'Support' | Go back [app bar, top-left] -> parent -> /profile | sticky bar [Go back, Notifications] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current '-') | 'Send request' primary, middle, full width, 44px | max 960px, w 768, pad 24px/24px, top 40px |
| `empty:profile-support` | 1280 | h1 'Support' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Send request' primary, middle, full width, 40px | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `empty:profile-support` | 1440 | h1 'Support' | absent | floating pill bar (top, y=0) | top pill (6 items) | 'Send request' primary, middle, full width, 40px | max 1180.8px, w 1181, pad 32px/32px, top 64px |
| `unverified:dashboard` | 768 | h1 'Good to see you, Arjun'; manifest 'Home' | absent | sticky bar [Notifications, 2 unread] | bottom bar (5: Home/Funds/Portfolio/Activity/Profile; current 'Home') | none | max 960px, w 768, pad 24px/24px, top 40px |
| `unverified:dashboard` | 1280 | h1 'Good to see you, Arjun'; manifest 'Home' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1049.6px, w 1050, pad 32px/32px, top 64px |
| `unverified:dashboard` | 1440 | h1 'Good to see you, Arjun'; manifest 'Home' | absent | floating pill bar (top, y=0) | top pill (6 items) | none | max 1180.8px, w 1181, pad 32px/32px, top 64px |

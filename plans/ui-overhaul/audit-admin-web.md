# UI audit U4: admin app, web browser

Read-only audit of the admin console in a browser at laptop and desktop widths (the Tailscale consoles), for the UI overhaul (DEC-40). It keeps today's BeOnEdge identity and design system (DEC-45). Fixes wait for the per-surface plan (U5) and its approval (DEC-47).

## Summary

The console has a clear frame: a dark sidebar with grouped sections, a wide content column and one card style. Two screens break at laptop width: the shared detail row collapses its value column to one character, so the Overview's "Last value update per fund" date runs down the page through the next tile, and the Erase client explanation becomes a 6,450 px column of single letters (UAW-01). Beyond that, the console has no back control and highlights no sidebar entry on 23 detail screens (UAW-02). Its sidebar is taller than an 800 or 900 px laptop screen (UAW-04). The Users and Monthly payments tables are wider than their column at 1280 px (UAW-05). The client page is a 4,500 to 5,300 px stack of twelve sections (UAW-11). The phone audit's issues of words, destructive placement, contrast and forms apply here as well. Failed reads are handled well.

Counts: 29 findings: 1 high, 11 medium, 17 low.

## Method

- **Commit audited:** `a842496` on `track/u-audits`; Phase I screens are not on this branch and are left out (DEC-47).
- **Widths:** 1280×800, 1440×900 and 1920×1080 CSS px, Chromium 1248 through Playwright 1.59.1, mouse, device scale 1, `en-IN`, `Asia/Kolkata`, reduced motion on.
- **Stack and data:** as U3 (`plans/ui-overhaul/audit-admin-mobile.md`, Method): local throwaway stack, migrations 001 to 071, seeds, superadmin sign-in, three funds, five clients with recordings, an admin SIP schedule, value updates, maturities (one with options sent), support requests, reviews, FAQs and an admin template; payments unconfigured.
- **Per route and width:** viewport and full-page screenshots and the in-page probe of U1. Detail routes without a local record were opened with an unknown id. Screenshots and JSON are in the track's scratch folder `.temp/u-audits/` (not committed); paths below are relative to it.
- **States:** failed (500) and slow (7 s) reads on 16 admin screens at 1440×900.
- **Keyboard:** tab order and the focus indicator on sign-in and Overview, and the path from a client's page to the recording form, at 1440 px.
- **Not checked:** browsers other than Chromium; browser zoom at 200% and 400%; roles other than superadmin (DEC-36 views); a real screen reader; the Phase I screens; contrast over gradients.

Severity: **high** breaks a screen or blocks a task; **medium** is hard to use or breaks a rule in `RULES.md`; **low** is polish.

## Findings

| ID | Sev | Route and width | What is wrong | Evidence | Direction of a fix (DEC-45) |
| --- | --- | --- | --- | --- | --- |
| UAW-01 | high | `/overview` at 1280 and 1440; `/users/:id/erase` at 1280, 1440 and 1920 | From 1024 px the shared detail row becomes a grid with a fixed 14 rem label column, so inside a narrow tile or a half-width split the value column shrinks to about one character and `overflow-wrap: anywhere` breaks it per letter. Overview: the "Last value update per fund" dates run vertically out of their tile, over and below the "Open support requests" tile. Erase client: both "Erasing it means" rows become single-letter columns overlapping their labels; the page is 6,450 px tall at every desktop width. At 1920 the Overview dates still wrap to three lines. | `shots/admin/1280x800/overview.png`, `shots/admin/1440x900/user-erase.full.jpg`, `work/sheets/zoom-overview-both.png`, `work/sheets/zoom-erase-1440.png`; `src/ui/recipes/datalist.ts:3-7`, `src/features/admin/overview/DailyTiles.tsx:146-150`, `src/features/admin/users/ClientErasureNotices.tsx:35-38` | Make the detail row respond to its container (container query or a stacked variant), and use prose for long explanations. |
| UAW-02 | medium | all 47 routes; 1280, 1440, 1920 | No back control on any page, and the sidebar marks no entry on 23 detail and sub-pages (a client, a support request, a review, a fund workspace, the adjustment screens). The manifest's `back` data is unused by the admin shell. | `logs/probes.txt` (sidebar current: 0 on `/users/:id`, `/support/:id`, `/client-values/individual`); `src/shells/admin/AdminFrame.tsx:88-104` | A back or breadcrumb link above the heading from the manifest's `back`; highlight the owning section. |
| UAW-03 | medium | every route; 1280, 1440, 1920 | Every browser tab is titled "BeOnEdge" (47 of 47 routes). Admins working in several tabs cannot tell them apart. WCAG 2.2 2.4.2. | `results/admin-1440x900.json` (`docTitle`); `frontend_stack_ts/index.html:11` | Title from the manifest plus the record name, e.g. "Priya Raman · Users · BeOnEdge Admin". |
| UAW-04 | medium | every route; 1280×800, 1440×900 | The sidebar lists 22 entries in five groups and is 1,112 px tall, more than an 800 or 900 px screen. "Send email", "FAQs" and "App config" are below the fold and need a page scroll; short pages are padded to 1,112 px. The parked money group (Receipts, Refunds, Payments, Mandates) sits between Support and System. | `results/admin-1280x800.json` (`scroll.pageHeight` 1,112 on 22 of 47 routes); `shots/admin/1280x800/funds.png`; `src/ui/recipes/shellAdmin.ts:54-60` | A sidebar that scrolls on its own within the viewport, tighter rows, and the parked group last or collapsed. |
| UAW-05 | medium | `/users`, `/client-values/payment-sheet`, `/users/:id/login-events`, `/audit`, `/content/faqs`; 1280, 1440 | The Users table (10 columns, 1,117 px) and the Monthly payments sheet (1,058 px) are wider than the 940 px column at 1280 px and scroll sideways ("Joined" cut). Narrow date columns wrap "16 Nov 2026, 18:08" onto three to five lines in Users, Audit, FAQs and sign-in history, where full user-agent strings fill a column. | `shots/admin/1280x800/users.png`, `user-login-events.png`, `audit.png`; `results/admin-1280x800.json` (`components.tables`); `results/squeeze-admin.json` | Fewer default columns, dates on one line (`white-space: nowrap` in the table recipe), long technical values behind a detail view. |
| UAW-06 | medium | most routes; all widths | The faint text token is 2.99:1 on cards and 2.79:1 on the page: dates in tables, fund names under clients, references (166 failing text nodes on 21 routes at 1440, capped at 25 per route). WCAG 2.2 AA needs 4.5:1. | `results/admin-1440x900.json` (`contrast`); `src/ui/tokens/tokens-core.css:15,35` | Darken the token or use `fg-muted`. |
| UAW-07 | medium | every disabled primary; all widths | Disabled primary buttons keep the dark gradient and look pressable. | `logs/probes.txt`; `src/ui/primitives/Button.tsx:59-67`, `src/ui/recipes/button.ts:15,43` | The disabled recipe must override every tone. |
| UAW-08 | medium | Client values, adjustments, Returns, AUM, Monthly value update, Exports, investor record, fund AUM, Audit, sign-in history, the client page; all widths | Engineering language and raw codes, as UAM-05: "append-only ledger", "backend", "folded from the client value ledger on each read", "basis points", "commit", "authoritatively", "Concurrency version", `recorded_offline_monthly_investment` in the ledger's reason column, `fund_size_adjustment` prefilled. | `shots/admin/1440x900/client-values.png`, `client-values-returns.png`, `fund-aum.png`, `user-detail.full.jpg`; `results/admin-1440x900.json` (`copy.rawEnums`) | Task language; category labels instead of codes; internal fields hidden. |
| UAW-09 | medium | `/users/:id`, `/funds/:id`; all widths | A red "Reverse" on every ledger row; "Suspend" and "Close" in red mid-page; "Archive" in red in the row with "Holdings", "Manage AUM" and "Pause"; "Erase client" among the client's navigation pills; "Remove the nominee" in the primary tone (UAM-06). | `shots/admin/1440x900/user-detail.full.jpg`, `fund-workspace.png` | A separate danger area per page and a row action menu. |
| UAW-10 | medium | admin input groups; all widths | 41 of 45 admin feature files with fields do not use the shared `Form`; Enter does not submit and there is no form grouping (UAM-09). | `src/features/admin/users/CreateClientScreen.tsx`, `src/features/admin/client-values/EarlierInvestmentForm.tsx`; `src/ui/primitives/Form.tsx:11-17` | Wrap each input group in `Form`. |
| UAW-11 | medium | `/users/:id`; all widths | The client page is 5,267 px at 1280 and 4,492 px at 1920: twelve sections, four tables, 15 primary or danger buttons. Recording an investment, the most frequent task, is a button in the fourth section. | `shots/admin/1440x900/user-detail.full.jpg`; `results/admin-1280x800.json` | A summary header with the frequent actions; the rest in tabs or a second column at wide widths. |
| UAW-12 | low | `/funds/:id`, `/users/:id`, `/review/:id`, `/support/:id`; 1280, 1440, 1920 | Detail rows stop at 44 rem inside full-width cards (the fund's "Current state" ends at two thirds of its card) while the client's details split into two columns. | `shots/admin/1440x900/fund-workspace.png`, `user-detail.png`; `src/ui/recipes/datalist.ts:3-7,17` | Rows sized by their card. |
| UAW-13 | low | `/overview`; 1280, 1440, 1920 | In "Today", each tile's outer frame stretches to the row height but the card inside does not, so the frames show empty bands of different heights under the cards. | `shots/admin/1920x1080/overview.png`, `work/sheets/zoom-overview-both.png` | Let the card fill its frame, or the frame wrap the card. |
| UAW-14 | low | Funds, AUM, Users, Email templates, template page; all widths | Header actions differ: primary with and without an arrow, secondary with an arrow, top right (UAM-21). | `shots/admin/1440x900/funds.png`, `aum.png`, `users.png` | One header-action style. |
| UAW-15 | low | all routes; 1920 | The wide container grows to 1,728 px. Descriptions stay at 58 ch while tables stretch to 1,567 px, and forms such as Create a client stay in a 500 px card at the left of a 1,656 px column. | `shots/admin/1920x1080/users.png`, `client-create.png` | A maximum width for reading and form pages; full width only for tables. |
| UAW-16 | low | money everywhere; all widths | Admin amounts always carry paise, inputs show ungrouped digits ("10000") (UAM-15). | `shots/admin/1440x900/client-values-payment-sheet.png` | Group digits in inputs. |
| UAW-17 | low | AUM history, sign-in history, Audit, Emails; all widths | Raw UUIDs, request ids and user-agent strings on screen (UAM-16). | `results/admin-1440x900.json` (`copy.rawIds`) | Short references behind a detail view. |
| UAW-18 | low | date inputs; all widths | Inputs show "dd/mm/yyyy"; displays show "16 Nov 2026" (UAM-17). | `shots/admin/1440x900/client-values-exports.png` | Label the expected date in the display format. |
| UAW-19 | low | unknown application, receipt or mandate id; all widths | Not found is a red error panel with "Try again" (UAM-18). | `shots/admin/1440x900/application-detail.png` | A neutral not-found state with a way back. |
| UAW-20 | low | `/users/:id` for an unused invite; all widths | Account "Active" for a client who never set a password (UAM-19). | `shots/admin/1440x900/pending_user-detail.png` | Show the invite state. |
| UAW-21 | low | `/client-values/position?userId=…`; all widths | The investor field is empty although the page says the investor was selected from the link (UAM-20). | `shots/admin/1440x900/client-values-position.png` | Show the selected investor in the field. |
| UAW-22 | low | every app open; all widths | The maturity prompt has five actions, two in the primary style (UAM-14). | `shots/admin/1440x900/_launch-prompt.png` | One primary action. |
| UAW-23 | low | all dated routes; all widths | "Sept" beside three-letter months, 24-hour times, relative and absolute dates mixed (UAM-24). | `results/admin-1440x900.json` (`dates`) | One date and time style. |
| UAW-24 | low | slow reads; all widths | Skeletons carry no `aria-busy` or live text (UAM-25). | `results/states-admin.json` | Busy state in `AsyncBoundary`. |
| UAW-25 | low | `/login`; all widths | The sign-in page's `h1` is the tagline; no `main` landmark (UAM-26). | `results/admin-1440x900.json` (`headings`) | Form title as `h1`, panel in `main`. |
| UAW-26 | low | 10 px text; all widths | 1,038 text nodes at 10 px at 1440 (table headers, sidebar group labels, stat labels). | `results/admin-1440x900.json` (`typography.sizes`) | 12 px minimum for meaningful labels. |
| UAW-27 | medium | every route; 1440×900 | Keyboard users pass the 22 sidebar links and "Sign out" before reaching content (no skip link), and the five lowest sidebar links ("Emails" to "App config") take focus below the visible area of a 900 px screen without scrolling into view. WCAG 2.2 2.4.1 is met by landmarks, 2.4.11 Focus Not Obscured is not. | `results/keyboard.json` (`homeSeq`, `inViewport`); `shots/keyboard/admin-1440-home.tab*.png` | A "Skip to content" link as the first stop, and a sidebar that scrolls within the viewport (UAW-04). |
| UAW-28 | low | `/users/:id`; 1440 | "Record an investment" opens an inline form with focus left on its toggle; five navigation pills, including "Erase client", come before the first field; Escape does not close it. | `results/keyboard.json`; `shots/flows/admin-1440-record-open.png` | Focus the first field on open; place the form directly after its toggle. |
| UAW-29 | low | `/funds/new` submitted empty; 1440 | The form has no field checks before sending: the server's answer is shown as "Not created: Request validation failed" with "Must be at least 1 characters.", wording from the validation library rather than the product. The client app's support form, by contrast, checks fields first and shows a sentence under each one. | `results/flows.json` (`admin-390-fund-create-empty-submit`); the same form at 1440 px | Check required fields in the form and show product wording under each field, as the client forms do. |

## Inconsistencies

### Between routes (web)

- **Back control:** none on any route (UAW-02).
- **Current sidebar entry:** marked on the 22 sidebar routes; nothing on the 23 detail and sub-pages (UAW-02).
- **Page title:** the page heading only (no bar title at web width); headings differ from the manifest titles on the 13 routes listed in U3, UAM-02, and the client page is headed "User".
- **Container width:** wide (1,280, 1,296 and 1,728 px) on 38 routes; content width (1,050 to 1,181 px) on 6 routes (create a client, the Client values hub, individual adjustment, fund receipt, App config, not found); form width (560 px) on Erase client. Neighbouring pages of the same section therefore start and end at different x positions (UAW-15).
- **Detail rows:** capped at 44 rem in full-width cards on most pages, split into two columns on the client page, collapsed in narrow tiles (UAW-01, UAW-12).
- **Header actions, destructive actions, not found, money, filters:** as in U3 (UAW-09, UAW-14, UAW-16, UAW-19).

### Web and phone layouts of the same route

See U3, "Phone and web layouts of the same route".

## Pattern inventory (web)

- **Buttons:** primary, secondary, ghost and danger pills as on the phone; at 1024 px and up most are 36 to 40 px tall (compact sizes), primaries in forms 48 px. The sidebar links are 36 px rows. "Sign out" is a 44 px pill at the top right of every page.
- **Cards and lists:** card grids for funds, applications, the Today tiles and the Client values task cards (two columns); tables elsewhere, full column width; label–value rows in cards.
- **Forms:** labels above fields; fields in two or three columns on wide forms (fund size, create a client); submit placement varies as on the phone; only four feature files use `Form` (UAW-10).
- **Loading, empty, error:** as on the phone; every tested screen showed the failure panel with "Try again".
- **Money:** ₹ with Indian grouping and paise; the market-risk line appears only with a client's portfolio summary.
- **Dates:** as on the phone (UAW-23); narrow table columns wrap them (UAW-05).
- **Toasts and dialogs:** centred dialogs at web width (`Sheet` becomes a centred panel from `lg`), toasts on fund screens.
- **Type and spacing:** sixteen font sizes across the three widths, 1,038 nodes at 10 px at 1440 px (UAW-26). Page padding 32 px (38 px at 1920), page top 64 px, section gap 48 px.

## States: failed and slow reads (1440×900)

| Screen | Failed read (500) | Slow read (7 s) |
| --- | --- | --- |
| Overview, Users, the client page, Client values, Returns, Maturities, Monthly payments, Monthly value update, investor record, Support, Reviews, Funds, fund size, Audit, Emails, Exports (16) | failure panel "Something went wrong" with "Try again" and a reference within 8 s on every screen; no empty list, no endless skeleton | skeletons, then content; Users and the client page load in two waves (24 and 12 row skeletons after the first list arrives) |

Evidence: `shots/states/admin/1440x900/*.png`, `results/states-admin.json`.

## Keyboard

Sign-in, Overview and the client page at 1440 px (`results/keyboard.json`, `shots/keyboard/admin-1440-*.png`):

- Sign-in: Email, Password, "Forgot your password?", "Sign in"; Enter submits; focus visible at every stop.
- The maturity prompt takes focus on open and Escape closes it.
- **No skip link:** every page starts with the 22 sidebar links; the page content begins at the 24th stop (after "Sign out") (UAW-27).
- **Focus off-screen (WCAG 2.2 2.4.11):** the sticky sidebar is taller than the 900 px viewport, so "Emails", "Email templates", "Send email", "FAQs" and "App config" received focus below the visible area and the page did not scroll to them (UAW-04, UAW-27).
- Recording an investment: the inline form opens with focus left on its toggle; five navigation pills, including "Erase client", come before the first field; the date field takes four stops; Escape does not close it (UAW-28).

## Parked under DEC-14

No proposal for `/receipts`, `/receipts/:orderId`, `/refunds`, `/payments`, `/mandates` and `/mandates/:mandateId` (captured for the inventory only). They hold four of the sidebar's 22 entries (UAW-04).

## Navigation and page-shell inventory

One row per route and width (1280, 1440, 1920). Columns as in U1. `pending:user-detail` is the page of a client whose invite was never used. The browser tab title is "BeOnEdge" on every route.

| Route | Width | Title shown | Back control | Header / app bar | Main navigation | Primary action | Container |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `splash` | 1280 | no h1 | absent | none (bare page) | none | none | max none, w 1280, pad 24px/24px, top 24px |
| `splash` | 1440 | no h1 | absent | none (bare page) | none | none | max none, w 1440, pad 24px/24px, top 24px |
| `splash` | 1920 | no h1 | absent | none (bare page) | none | none | max none, w 1920, pad 24px/24px, top 24px |
| `login` | 1280 | h1 'Investing, made deliberate'; manifest 'Administrator sign in' | absent | none (bare page) | none | 'Sign in' primary, bottom, full width, 48px | no <main> (count 0) |
| `login` | 1440 | h1 'Investing, made deliberate'; manifest 'Administrator sign in' | absent | none (bare page) | none | 'Sign in' primary, bottom, full width, 48px | no <main> (count 0) |
| `login` | 1920 | h1 'Investing, made deliberate'; manifest 'Administrator sign in' | absent | none (bare page) | none | 'Sign in' primary, bottom, full width, 48px | no <main> (count 0) |
| `overview` | 1280 | h1 'Overview' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `overview` | 1440 | h1 'Overview' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `overview` | 1920 | h1 'Overview' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `applications` | 1280 | h1 'Applications' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `applications` | 1440 | h1 'Applications' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `applications` | 1920 | h1 'Applications' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `application-detail` | 1280 | h1 'Application' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `application-detail` | 1440 | h1 'Application' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `application-detail` | 1920 | h1 'Application' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `users` | 1280 | h1 'Users' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `users` | 1440 | h1 'Users' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `users` | 1920 | h1 'Users' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `client-create` | 1280 | h1 'Create a client account'; manifest 'Create a client' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Review the details' primary, bottom, full width, 40px | max 1049.6px, w 1016, pad 32px/32px, top 64px |
| `client-create` | 1440 | h1 'Create a client account'; manifest 'Create a client' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Review the details' primary, bottom, full width, 40px | max 1180.8px, w 1176, pad 32px/32px, top 64px |
| `client-create` | 1920 | h1 'Create a client account'; manifest 'Create a client' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Review the details' primary, bottom, full width, 40px | max 1574.4px, w 1574, pad 38.4px/38.4px, top 64px |
| `user-detail` | 1280 | h1 'User' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Send a password reset link' primary, top, left, 40px (+14) | max 1280px, w 1016, pad 32px/32px, top 64px |
| `user-detail` | 1440 | h1 'User' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Send a password reset link' primary, top, left, 40px (+14) | max 1296px, w 1176, pad 32px/32px, top 64px |
| `user-detail` | 1920 | h1 'User' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Send a password reset link' primary, top, left, 40px (+14) | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `user-login-events` | 1280 | h1 'Sign-in history'; manifest 'Login events' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `user-login-events` | 1440 | h1 'Sign-in history'; manifest 'Login events' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `user-login-events` | 1920 | h1 'Sign-in history'; manifest 'Login events' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `user-erase` | 1280 | h1 'Erase client' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 560px, w 560, pad 32px/32px, top 64px |
| `user-erase` | 1440 | h1 'Erase client' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 560px, w 560, pad 32px/32px, top 64px |
| `user-erase` | 1920 | h1 'Erase client' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 560px, w 560, pad 38.4px/38.4px, top 64px |
| `funds` | 1280 | h1 'Funds' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'New fund' primary, top, full width, 36px | max 1280px, w 1016, pad 32px/32px, top 64px |
| `funds` | 1440 | h1 'Funds' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'New fund' primary, top, full width, 36px | max 1296px, w 1176, pad 32px/32px, top 64px |
| `funds` | 1920 | h1 'Funds' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'New fund' primary, top, full width, 36px | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `fund-create` | 1280 | h1 'New fund' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Create fund' primary, bottom, left, 48px | max 1280px, w 1016, pad 32px/32px, top 64px |
| `fund-create` | 1440 | h1 'New fund' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Create fund' primary, bottom, left, 48px | max 1296px, w 1176, pad 32px/32px, top 64px |
| `fund-create` | 1920 | h1 'New fund' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Create fund' primary, bottom, left, 48px | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `fund-workspace` | 1280 | h1 'BeOnEdge Growth Fund'; manifest 'Fund workspace' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Archive' danger, middle, right, 36px (+1) | max 1280px, w 1016, pad 32px/32px, top 64px |
| `fund-workspace` | 1440 | h1 'BeOnEdge Growth Fund'; manifest 'Fund workspace' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Archive' danger, middle, right, 36px (+1) | max 1296px, w 1176, pad 32px/32px, top 64px |
| `fund-workspace` | 1920 | h1 'BeOnEdge Growth Fund'; manifest 'Fund workspace' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Archive' danger, middle, left, 36px (+1) | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `fund-holdings` | 1280 | h1 'Holdings' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Add the holding' primary, middle, left, 40px | max 1280px, w 1016, pad 32px/32px, top 64px |
| `fund-holdings` | 1440 | h1 'Holdings' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Add the holding' primary, middle, left, 40px | max 1296px, w 1176, pad 32px/32px, top 64px |
| `fund-holdings` | 1920 | h1 'Holdings' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Add the holding' primary, middle, left, 40px | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `fund-aum` | 1280 | h1 'Fund AUM' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Review fund size change' primary, bottom, left, 48px | max 1280px, w 1016, pad 32px/32px, top 64px |
| `fund-aum` | 1440 | h1 'Fund AUM' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Review fund size change' primary, middle, left, 48px | max 1296px, w 1176, pad 32px/32px, top 64px |
| `fund-aum` | 1920 | h1 'Fund AUM' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Review fund size change' primary, bottom, left, 48px | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `fund-aum-history` | 1280 | h1 'AUM history' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `fund-aum-history` | 1440 | h1 'AUM history' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `fund-aum-history` | 1920 | h1 'AUM history' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `aum` | 1280 | h1 'AUM' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Grow several funds' primary, top, full width, 40px | max 1280px, w 1016, pad 32px/32px, top 64px |
| `aum` | 1440 | h1 'AUM' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Grow several funds' primary, top, full width, 40px | max 1296px, w 1176, pad 32px/32px, top 64px |
| `aum` | 1920 | h1 'AUM' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Grow several funds' primary, top, full width, 40px | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `aum-collective` | 1280 | h1 'Grow several funds'; manifest 'Collective AUM growth' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `aum-collective` | 1440 | h1 'Grow several funds'; manifest 'Collective AUM growth' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `aum-collective` | 1920 | h1 'Grow several funds'; manifest 'Collective AUM growth' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `client-values` | 1280 | h1 'Client values' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1049.6px, w 1016, pad 32px/32px, top 64px |
| `client-values` | 1440 | h1 'Client values' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1180.8px, w 1176, pad 32px/32px, top 64px |
| `client-values` | 1920 | h1 'Client values' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1574.4px, w 1574, pad 38.4px/38.4px, top 64px |
| `client-values-returns` | 1280 | h1 'Returns' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `client-values-returns` | 1440 | h1 'Returns' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `client-values-returns` | 1920 | h1 'Returns' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `client-values-exports` | 1280 | h1 'Accounting exports' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Download balances CSV' primary, middle, left, 40px (+1) | max 1280px, w 1016, pad 32px/32px, top 64px |
| `client-values-exports` | 1440 | h1 'Accounting exports' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Download balances CSV' primary, middle, left, 40px (+1) | max 1296px, w 1176, pad 32px/32px, top 64px |
| `client-values-exports` | 1920 | h1 'Accounting exports' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Download balances CSV' primary, middle, left, 40px (+1) | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `maturities` | 1280 | h1 'Maturities' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Resolve' primary, bottom, right, 36px (+1) | max 1280px, w 1016, pad 32px/32px, top 64px |
| `maturities` | 1440 | h1 'Maturities' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Resolve' primary, bottom, right, 36px (+1) | max 1296px, w 1176, pad 32px/32px, top 64px |
| `maturities` | 1920 | h1 'Maturities' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Resolve' primary, bottom, right, 36px (+1) | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `client-values-individual` | 1280 | h1 'Adjust one investor'; manifest 'Individual adjustment' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Append the adjustment' primary, bottom, full width, 40px | max 1049.6px, w 1016, pad 32px/32px, top 64px |
| `client-values-individual` | 1440 | h1 'Adjust one investor'; manifest 'Individual adjustment' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Append the adjustment' primary, bottom, full width, 40px | max 1180.8px, w 1176, pad 32px/32px, top 64px |
| `client-values-individual` | 1920 | h1 'Adjust one investor'; manifest 'Individual adjustment' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Append the adjustment' primary, bottom, full width, 40px | max 1574.4px, w 1574, pad 38.4px/38.4px, top 64px |
| `client-values-collective` | 1280 | h1 'Adjust a whole fund'; manifest 'Collective growth' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `client-values-collective` | 1440 | h1 'Adjust a whole fund'; manifest 'Collective growth' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `client-values-collective` | 1920 | h1 'Adjust a whole fund'; manifest 'Collective growth' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `client-values-monthly` | 1280 | h1 'Monthly value update' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `client-values-monthly` | 1440 | h1 'Monthly value update' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `client-values-monthly` | 1920 | h1 'Monthly value update' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `client-values-payment-sheet` | 1280 | h1 'Monthly payments' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Record' primary, middle, full width, 40px | max 1280px, w 1016, pad 32px/32px, top 64px |
| `client-values-payment-sheet` | 1440 | h1 'Monthly payments' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Record' primary, middle, full width, 40px | max 1296px, w 1176, pad 32px/32px, top 64px |
| `client-values-payment-sheet` | 1920 | h1 'Monthly payments' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Record' primary, middle, full width, 40px | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `client-values-position` | 1280 | h1 'One investor's record'; manifest 'One investor's position' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Mark matured' primary, middle, full width, 40px (+10) | max 1280px, w 1016, pad 32px/32px, top 64px |
| `client-values-position` | 1440 | h1 'One investor's record'; manifest 'One investor's position' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Mark matured' primary, middle, full width, 40px (+10) | max 1296px, w 1176, pad 32px/32px, top 64px |
| `client-values-position` | 1920 | h1 'One investor's record'; manifest 'One investor's position' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Mark matured' primary, middle, full width, 40px (+10) | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `support` | 1280 | h1 'Support' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `support` | 1440 | h1 'Support' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `support` | 1920 | h1 'Support' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `support-ticket` | 1280 | h1 'Support request' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Send reply' primary, bottom, left, 40px | max 1280px, w 1016, pad 32px/32px, top 64px |
| `support-ticket` | 1440 | h1 'Support request' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Send reply' primary, bottom, left, 40px | max 1296px, w 1176, pad 32px/32px, top 64px |
| `support-ticket` | 1920 | h1 'Support request' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Send reply' primary, bottom, left, 40px | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `reviews` | 1280 | h1 'Reviews' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `reviews` | 1440 | h1 'Reviews' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `reviews` | 1920 | h1 'Reviews' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `review-detail` | 1280 | h1 'Client review' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Save' primary, bottom, left, 40px | max 1280px, w 1016, pad 32px/32px, top 64px |
| `review-detail` | 1440 | h1 'Client review' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Save' primary, bottom, left, 40px | max 1296px, w 1176, pad 32px/32px, top 64px |
| `review-detail` | 1920 | h1 'Client review' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Save' primary, bottom, left, 40px | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `receipts` (parked) | 1280 | h1 'Fund receipts' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `receipts` (parked) | 1440 | h1 'Fund receipts' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `receipts` (parked) | 1920 | h1 'Fund receipts' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `receipt-detail` (parked) | 1280 | h1 'Fund receipt'; manifest 'Receipt' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1049.6px, w 1016, pad 32px/32px, top 64px |
| `receipt-detail` (parked) | 1440 | h1 'Fund receipt'; manifest 'Receipt' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1180.8px, w 1176, pad 32px/32px, top 64px |
| `receipt-detail` (parked) | 1920 | h1 'Fund receipt'; manifest 'Receipt' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1574.4px, w 1574, pad 38.4px/38.4px, top 64px |
| `refunds` (parked) | 1280 | h1 'Refunds' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `refunds` (parked) | 1440 | h1 'Refunds' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `refunds` (parked) | 1920 | h1 'Refunds' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `payments` (parked) | 1280 | h1 'Payments' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `payments` (parked) | 1440 | h1 'Payments' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `payments` (parked) | 1920 | h1 'Payments' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `mandates` (parked) | 1280 | h1 'Mandates' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `mandates` (parked) | 1440 | h1 'Mandates' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `mandates` (parked) | 1920 | h1 'Mandates' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `mandate-detail` (parked) | 1280 | h1 'Mandate' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `mandate-detail` (parked) | 1440 | h1 'Mandate' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `mandate-detail` (parked) | 1920 | h1 'Mandate' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `audit` | 1280 | h1 'Audit log' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `audit` | 1440 | h1 'Audit log' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `audit` | 1920 | h1 'Audit log' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `emails` | 1280 | h1 'Emails'; manifest 'Email deliveries' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `emails` | 1440 | h1 'Emails'; manifest 'Email deliveries' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `emails` | 1920 | h1 'Emails'; manifest 'Email deliveries' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `email-templates` | 1280 | h1 'Email templates' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `email-templates` | 1440 | h1 'Email templates' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `email-templates` | 1920 | h1 'Email templates' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `email-template-new` | 1280 | h1 'New email template' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Create template' primary, bottom, full width, 40px | max 1280px, w 1016, pad 32px/32px, top 64px |
| `email-template-new` | 1440 | h1 'New email template' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Create template' primary, bottom, full width, 40px | max 1296px, w 1176, pad 32px/32px, top 64px |
| `email-template-new` | 1920 | h1 'New email template' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Create template' primary, bottom, full width, 40px | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `email-template-detail` | 1280 | h1 'Office closure notice'; manifest 'Email template' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Save as a new version' primary, bottom, full width, 40px | max 1280px, w 1016, pad 32px/32px, top 64px |
| `email-template-detail` | 1440 | h1 'Office closure notice'; manifest 'Email template' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Save as a new version' primary, bottom, full width, 40px | max 1296px, w 1176, pad 32px/32px, top 64px |
| `email-template-detail` | 1920 | h1 'Office closure notice'; manifest 'Email template' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Save as a new version' primary, bottom, full width, 40px | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `email-send` | 1280 | h1 'Send an email' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1280px, w 1016, pad 32px/32px, top 64px |
| `email-send` | 1440 | h1 'Send an email' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1296px, w 1176, pad 32px/32px, top 64px |
| `email-send` | 1920 | h1 'Send an email' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | none | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `content-faqs` | 1280 | h1 'FAQs' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Save as draft' primary, middle, left, 40px (+8) | max 1280px, w 1016, pad 32px/32px, top 64px |
| `content-faqs` | 1440 | h1 'FAQs' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Save as draft' primary, middle, left, 40px (+8) | max 1296px, w 1176, pad 32px/32px, top 64px |
| `content-faqs` | 1920 | h1 'FAQs' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Save as draft' primary, middle, left, 40px (+8) | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |
| `app-config` | 1280 | h1 'App config'; manifest 'App configuration' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Publish this configuration' primary, bottom, full width, 40px | max 1049.6px, w 1016, pad 32px/32px, top 64px |
| `app-config` | 1440 | h1 'App config'; manifest 'App configuration' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Publish this configuration' primary, bottom, full width, 40px | max 1180.8px, w 1176, pad 32px/32px, top 64px |
| `app-config` | 1920 | h1 'App config'; manifest 'App configuration' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Publish this configuration' primary, bottom, full width, 40px | max 1574.4px, w 1574, pad 38.4px/38.4px, top 64px |
| `not-found` | 1280 | h1 'We could not find that page'; manifest 'Not found' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Go to home' primary, middle, right, 40px | max 1049.6px, w 1016, pad 32px/32px, top 64px |
| `not-found` | 1440 | h1 'We could not find that page'; manifest 'Not found' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Go to home' primary, middle, right, 40px | max 1180.8px, w 1176, pad 32px/32px, top 64px |
| `not-found` | 1920 | h1 'We could not find that page'; manifest 'Not found' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Go to home' primary, middle, right, 40px | max 1574.4px, w 1574, pad 38.4px/38.4px, top 64px |
| `pending:user-detail` | 1280 | h1 'User' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Send a new invite link' primary, middle, left, 40px (+5) | max 1280px, w 1016, pad 32px/32px, top 64px |
| `pending:user-detail` | 1440 | h1 'User' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Send a new invite link' primary, middle, left, 40px (+5) | max 1296px, w 1176, pad 32px/32px, top 64px |
| `pending:user-detail` | 1920 | h1 'User' | absent | sidebar; sticky bar [Sign out] | sidebar (22 items) | 'Send a new invite link' primary, middle, left, 40px (+5) | max 1728px, w 1656, pad 38.4px/38.4px, top 64px |

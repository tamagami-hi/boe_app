# UI page-by-page audit — Program overview (shared context)

> Not a page plan. Shared reference for every per-page plan in `resources/sessions/2/`.
> **Roles:** an implementing agent executes one page plan at a time; the author agent plans and
> later verifies (does not code). One plan file = one page.

## Goal
Systematic, one-page-at-a-time pass over the whole frontend (`client`, `admin`, `website`) to fix
**element arrangement / positioning on mobile and desktop**, while checking **functionality,
routes, and consistency** with each page's intended purpose.

Stack: Vite + React 18 npm-workspace monorepo under `frontend_stack/`; packages
`@beonedge/{client,admin,website,shared,ui-kits,design-tokens}` consumed by `frontend_stack/app/`.
Mobile-first CSS: base = ~412px APK; desktop layered via `@media (min-width: 768px)`. Per surface,
styles live in `styles/mobile/*.css` and `styles/desktop/*.css`, imported mobile-first then desktop.

## Systemic finding (READ FIRST — recurs across pages)
`packages/client/src/styles/desktop/components.css` has a **`@media (max-width: 767px)`** block
(≈ lines 99–165) that force-collapses many grids/rows on mobile (`.apk-portfolio-grid`,
`.apk-fund-foot`, `.apk-perf-stats`, `.apk-fund-mins`, `.apk-quick`, `.apk-metric-grid-4`,
`.apk-mandate-actions` → `grid-template-columns:1fr`; `.apk-fund-head`, `.apk-sip-head`,
`.apk-perf-head`, … → `flex-direction:column`; `.apk-research-row`, `.apk-pulse-row`,
`.apk-holding-row`, `.apk-statements-row` → `1fr`). Because `desktop/index.css` is imported **after**
`mobile/index.css`, this mobile-width block **overrides** mobile-first base rules. Already caused the
Profile list-row bug (fixed) and the Dashboard portfolio-grid stacking.
**Do not delete it wholesale** (some rows should stack); fix **per-element** as each page proves a
selector wrong, and set the right mobile layout in that page's `styles/mobile/*.css`.

## Per-page workflow
1. **Intent** — `resources/app-map/md-maps/` (`03_frontend_pages.md`, `05_user_journey.md`,
   `06_admin_flow.md`, `09_api_routes.md`).
2. **Inspect** via Playwright on the dev server (`npm run dev` → `http://127.0.0.1:5173`):
   - Mobile = **412 × 914** CSS px (emulator Pixel/api36: 1080×2400 @ density 420, dpr 2.625) →
     `browser_resize(412, 914)`.
   - Desktop = **1280 × 860** → `browser_resize(1280, 860)`.
   - Client pages are at `/app/*` and need login (creds below). Use the emulator/APK for periodic
     real-device confirmation.
3. **Functionality** — data load, links/routes, actions, loading/empty/error states.
4. **Consistency** — design tokens + `@beonedge/ui-kits`; brand rules (Indian currency `₹1,25,000`;
   signal colors only for money state; `Investments are subject to market risk.` on money screens;
   never "BOE" in client copy); parity with sibling pages.
5. **Fix** in the page's `styles/mobile/*.css` + `styles/desktop/*.css` (+ JSX for empty/loading);
   targeted per-element rules over broad overrides.
6. **Verify** both viewports; `bash emu/boe_update.sh` for a real-APK pass when the bundle changed.
7. **Commit** per page (or small batches) only on human approval.

## Backlog (ordered)
- **Client (current):** Dashboard, Explore, Fund detail, Start SIP, Lumpsum, Payment status,
  Mandate auth, Mandate detail, Portfolio, Withdrawals, Transactions, Statements, Notifications,
  KYC detail, Security, Support, Legal, Investor-charter, Grievance, Approval-required, AppStart,
  Blocked, then verification-only checks for Login, Splash, Profile.
- **Website (later):** Landing, Website one-pager (hero/philosophy/funds/how/disclosures), Apk page.
- **Admin (later):** overview, approvals, funds/AUM, payments, mandates, KYC review, risk,
  SIP-control requests, audit, support, ledger, holdings, transactions, env, user-detail,
  app-builder, admin-login.

## Environment / fixtures
- Backend `http://127.0.0.1:47502` (`DATA_STORE=json`); frontend dev `http://127.0.0.1:5173`.
- Test client: `verify@beonedge.local` / `Verify@123456` (pending-approval — good for locked-action
  states). Admin seed: `admin@beonedge.local` / `Admin@123456`.
- Emulator API base baked to `http://10.0.2.2:47502`; web dev uses `127.0.0.1:47502`.
- Playwright Chrome is installed (for desktop+mobile inspection).

## Out of scope (all pages)
No backend changes; no data-wiring changes (services/stores/fixtures); no commits without approval.

## Page plans in this session
- `01-client-dashboard.md` — Client Dashboard.
- `02-client-explore.md` — Explore.
- `03-client-fund-detail.md` — Fund detail.
- `04-client-start-sip.md` — Start SIP.
- `05-client-lumpsum.md` — Lumpsum.
- `06-client-payment-status.md` — Payment status.
- `07-client-mandate-auth.md` — Mandate authorization.
- `08-client-mandate-detail.md` — Mandate detail.
- `09-client-portfolio.md` — Portfolio.
- `10-client-withdrawals.md` — Withdrawal requests.
- `11-client-transactions.md` — Transactions.
- `12-client-statements.md` — Statements.
- `13-client-notifications.md` — Notifications.
- `14-client-kyc-detail.md` — KYC detail.
- `15-client-security.md` — Security.
- `16-client-support.md` — Support.
- `17-client-legal.md` — Legal.
- `18-client-investor-charter.md` — Investor charter.
- `19-client-grievance.md` — Grievance redressal.
- `20-client-approval-required.md` — Approval required.
- `21-client-app-start.md` — App start.
- `22-client-blocked.md` — Blocked account state.
- `23-client-login.md` — Login verification pass.
- `24-client-splash.md` — Splash verification pass.
- `25-client-profile.md` — Profile verification pass.

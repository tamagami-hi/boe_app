# Plan: Responsive Mobile + Desktop Redesign of BeOnEdge Client Surface

## Goal
Redesign every screen in `frontend_stack/app/src/client/` to be responsive: polished mobile-first layout for the Android APK / narrow viewport, and a proper multi-column desktop dashboard at ≥768px. Convert CSS from desktop-first to mobile-first. Switch chrome responsively (mobile = bottom tab nav + per-screen app bar; desktop = sidebar). Strip Login to a minimal sign-in form with external-browser signup.

## Context

The client surface currently uses desktop-first CSS (`max-width` breakpoints, `max-width: 1120px`, 4-column grids, 268px sidebar). At 412px APK viewport the layout collapses poorly. The true mobile design language already exists in `frontend_stack/ui_kits/apk/apk.css` but is not wired into the app. `BottomNav.jsx` and `AppBar.jsx` exist and are correct but dormant — `ClientLayout` renders the sidebar only.

## Responsive Convention (all screens)

- Mobile-first: base rules target 412px APK. Desktop added with `@media (min-width: 768px)`. Optional `@media (min-width: 1040px)` for wide dashboards.
- Single source breakpoint: 768px primary. Documented at top of `base.css`.
- Chrome contract:
  - **Mobile (<768px)**: no sidebar. Full-width content, `padding: 18px 16px`, `padding-bottom` reserves 64px bottom nav. Primary tab screens show `<BottomNav/>` (fixed). Detail/sheet screens render their own `<AppBar/>` (back) and hide bottom nav.
  - **Desktop (≥768px)**: `.app-shell` sidebar + `.app-main` (existing). Bottom nav + mobile app bar hidden. `.apk-screen` regains centered max-width and multi-column grids.
- Money/number/disclosure rules stay intact (Indian formatting, `be-money`/`be-num`, market-risk disclosure).

## Work Breakdown

### Wave 1 — Shell, Tokens, Breakpoint Convention (must land first)

**Owner:** Single agent (blocks all Wave 2 work).

**Files:**
- `client/layout/ClientLayout.jsx`
- `client/styles/base.css`
- `client/styles/components.css`
- Confirm token/kit imports in `client/` entry point.

**Tasks:**
1. Rewrite `ClientLayout` to render responsive chrome:
   - Keep `.app-shell` sidebar for desktop.
   - Render existing `<AppBar/>` / `<BottomNav/>` (or route-derived default) for mobile.
   - Decide chrome by CSS media query (render both, toggle `display`) so browser resize is responsive. On APK the 412px width selects mobile automatically.
   - Preserve all existing guards (`isLoading`, public routes, `isTerminalAccount` → `Blocked`, role checks, sign-out).
   - Compute `isPrimaryTab` for `['/app/dashboard','/app/explore','/app/portfolio','/app/transactions','/app/profile']` → show `<BottomNav/>` on those; detail/sheet routes are full-screen with their own `<AppBar/>`.
2. `base.css`: flip `.app-shell`, `.app-sidebar`, `.app-main`, `.apk-screen` to mobile-first. Align `.apk-screen` mobile padding to kit (`18px 16px 80px`). Add documented breakpoint comment.
3. `components.css`: align `.apk-appbar` (52px sticky), `.apk-tabbar` (64px, ink, fixed on mobile, 5 tabs, gold active bar), `.apk-sheet*`, `.apk-chip*` to kit values.

### Wave 2 — Screens (parallel; each subagent owns its JSX + CSS, no shared-file overlap)

**Constraint:** Keep all data wiring (`SessionContext`, `client/services/*Api.js`, fixtures) unchanged — layout/CSS only.

| Agent | Screens | CSS Files |
|---|---|---|
| **Agent B** — Auth & onboarding | `Login.jsx`, `Splash.jsx`, `AppStart.jsx`, `ApprovalRequired.jsx`, `Blocked.jsx` | `auth.css` |
| **Agent C** — Home group | `Dashboard.jsx`, `Explore.jsx`, `FundDetail.jsx` | `dashboard.css`, `explore.css`, `fund-detail.css` |
| **Agent D** — Money group | `Portfolio.jsx`, `Transactions.jsx`, `Statements.jsx`, `Notifications.jsx`, `WithdrawalRequests.jsx` | `portfolio.css`, `transactions.css` |
| **Agent E** — Invest + profile + legal | `StartSipSheet.jsx`, `LumpsumSheet.jsx`, `PaymentStatus.jsx`, `MandateAuth.jsx`, `MandateDetail.jsx`, `Profile.jsx`, `KycDetail.jsx`, `Security.jsx`, `Support.jsx`, `Legal.jsx`, `InvestorCharter.jsx`, `GrievanceRedressal.jsx` | `invest.css`, `profile.css`, `disclosures.css` |

Each agent converts its screens to mobile-first responsive per the Wave-1 contract, reusing kit components (`be-card`, `be-btn`, `be-badge`, `apk-*`).

### Wave 2b — Onboarding-in-Browser Plumbing (owned by Agent B)

1. Install `@capacitor/browser` (Capacitor 8 compatible). Picked up by `cap sync` / `npm run android:sync`.
2. New helper `client/utils/openOnboarding.js`:
   - Uses `Capacitor.isNativePlatform()` to branch.
   - On native: dynamically import `@capacitor/browser` and `Browser.open({ url })`.
   - On web: `window.open(url, '_blank', 'noopener')`.
   - URL from `import.meta.env.VITE_BEO_WEB_ONBOARDING_URL`, defaulting to host site in dev.
3. Add `VITE_BEO_WEB_ONBOARDING_URL` to:
   - `frontend_stack/app/.env` (`http://127.0.0.1:5173/`)
   - `frontend_stack/app/.env.android` (`http://10.0.2.2:5173/`)
   - `frontend_stack/app/.env.example`
4. `Login.jsx`: remove `.auth-copy` block, logo, Sign in/Create account tabs, and entire in-app signup form/`onSignup`. Keep sign-in form (identifier+password, error handling, `useSession().login`, post-login `isClientShell ? '/app/dashboard' : '/app/start'`). Add single "New to BeOnEdge? Sign up" affordance calling `openOnboarding()`. Use kit `.apk-login-*` classes for centered card on desktop / full-screen on mobile.

## Critical Files

- **Shell/tokens:** `client/layout/ClientLayout.jsx`, `client/layout/AppBar.jsx`, `client/layout/BottomNav.jsx`, `client/styles/base.css`, `client/styles/components.css`
- **Reference (read-only source of truth):** `frontend_stack/ui_kits/apk/apk.css`, `ui_kits/apk/Components.jsx`, `ui_kits/shared/kit.css`, `frontend_stack/colors_and_type.css`
- **Auth/onboarding:** `client/pages/Login.jsx`, new `client/utils/openOnboarding.js`, `frontend_stack/app/.env`, `.env.android`, `.env.example`, `package.json` (+`@capacitor/browser`)
- **Screens + CSS:** every file in `client/pages/` and `client/styles/` as grouped in Wave 2
- **Unchanged:** `client/store/*`, `client/services/*`, `client/utils/approval.js`

## Verification (end-to-end)

1. **Build/deploy to emulator:** `bash emu/boe_update.sh` (runs `android:sync` → installs → launches). Backend up first: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:47502/health` → `200`.
2. **APK (mobile):** boot → Splash → minimal Login (no logo/marketing). Sign in with `verify@beonedge.local` / `Verify@123456` → Dashboard. Verify: bottom tab nav (5 tabs) is fixed and switches Home/Explore/Portfolio/Transactions/Profile; each screen is single-column, full-width, no horizontal scroll, no clipped 4-column grids; Fund detail + Start-SIP sheet render as mobile detail/bottom-sheet; screenshots via `adb`.
3. **Signup → browser:** on Login tap "Sign up" → system browser opens `VITE_BEO_WEB_ONBOARDING_URL` (`10.0.2.2:5173` on emulator). Confirm in `adb logcat` (Browser plugin / intent) and that the in-app WebView did not navigate.
4. **Desktop (web):** `npm run dev` in `frontend_stack/`, open `http://127.0.0.1:5173/app/dashboard` wide → sidebar + multi-column layout; resize window narrow → chrome flips to bottom nav + single column (responsive). Login page shows minimal centered card; "Sign up" opens onboarding in a new tab.
5. **No regressions to data:** portfolio/orders/transactions still fetch (`/v1/client/*` in backend log).
6. **Brand checks:** Indian currency formatting intact, signal colors only on money state, market-risk disclosure present on money screens.

## Execution Options

1. **Wave 1 first, then 4 parallel Wave-2 agents (Recommended)**
   - One agent handles Wave 1 (shell + base.css + components.css + onboarding plumbing).
   - Once Wave 1 lands, dispatch 4 parallel subagents (B–E) for screen groups.
   - Lower risk, clear contract, easy to verify incrementally.

2. **Single agent, all waves sequential**
   - One agent does Wave 1, then sequentially processes each screen group.
   - Simpler coordination but much slower.

3. **Speculative parallel start (higher risk)**
   - Launch all 5 agents simultaneously with a strict "do not touch shared files" rule.
   - Faster but risks CSS merge conflicts in `base.css`/`components.css`.

## Rollback / Safety

- All CSS changes are reversible by reverting the file.
- No backend changes required.
- No data wiring changes.
- If `@capacitor/browser` fails to install, fallback remains web `window.open`.

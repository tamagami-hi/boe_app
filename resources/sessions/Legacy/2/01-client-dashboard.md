# Page plan — Client Dashboard

> One page, one plan. Shared context (workflow, systemic CSS finding, env, creds) is in
> `00-program-overview.md`. Implementing agent: make the edits in **Fixes** exactly, then report.
> No backend/data-wiring changes; no commit without approval.

## Page
- **Route:** `/app/dashboard`
- **Component:** `frontend_stack/packages/client/src/pages/Dashboard.jsx`
- **Styles:** `packages/client/src/styles/mobile/dashboard.css`, `.../desktop/dashboard.css`,
  shared collapse block in `.../desktop/components.css`.
- **Intent (app-map):** post-login home — portfolio snapshot, active SIPs, quick actions,
  research/market context, notifications. Investment actions are **locked until the account is
  approved** (pending users see the approval panel + locked quick actions).
- **Data (keep working — do NOT touch wiring):** `portfolioApi.getPortfolio()`,
  `ordersApi.listOrders({filter:'active'})`, `researchApi.getResearchContext()`,
  `fundsApi.listFunds()`; copy via `useAppConfig().mobile.screens.dashboard.copy`; section
  visibility via `isComponentEnabled(appConfig,'dashboard',…)`.

## Issues found (mobile, emulator)
- **M1 — Portfolio mini-stats stack vertically.** "Holdings" and "Active SIPs" render stacked
  instead of side-by-side. Cause: `.apk-portfolio-grid` is in the `@media (max-width:767px)`
  collapse group in `desktop/components.css` (forced to `1fr`), overriding the base grid.
- **M2 — Empty research card.** The "HOW BEONEDGE INVESTS" section (`.apk-grid-research` →
  `.apk-pulse` card) renders an **empty white card** when `research` is `[]`. Looks broken; affects
  desktop too.
- **D (verify)** — desktop two-column layout (`1.6fr / 1fr`), 56px portfolio number, 4-col quick
  actions: confirm visually; M2 applies on desktop as well.

## Fixes (make exactly these)

### Fix M1a — `packages/client/src/styles/desktop/components.css`
In the `@media (max-width: 767px)` block, remove `.apk-portfolio-grid,` from the
`grid-template-columns: 1fr` selector list (leave all other selectors in that block unchanged):
```css
/* before */
  .apk-portfolio-grid,
  .apk-fund-foot,
  .apk-perf-stats,
  .apk-fund-mins,
  .apk-quick,
  .apk-metric-grid-4,
  .apk-mandate-actions { grid-template-columns: 1fr; }
/* after */
  .apk-fund-foot,
  .apk-perf-stats,
  .apk-fund-mins,
  .apk-quick,
  .apk-metric-grid-4,
  .apk-mandate-actions { grid-template-columns: 1fr; }
```

### Fix M1b — `packages/client/src/styles/mobile/dashboard.css`
Base rule near the top:
```css
.apk-portfolio-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; padding-top: 10px; border-top: 1px solid var(--be-border); }
```
Change `grid-template-columns: 1fr 1fr 1fr;` → `grid-template-columns: 1fr 1fr;`
(only Holdings + Active SIPs are rendered; the third column was always empty).

### Fix M2 — `packages/client/src/pages/Dashboard.jsx`
Gate the research section on having data. Change:
```jsx
{isComponentEnabled(appConfig, 'dashboard', 'research_context') && (
  <div className="apk-grid-research">
```
to:
```jsx
{isComponentEnabled(appConfig, 'dashboard', 'research_context') && research.length > 0 && (
  <div className="apk-grid-research">
```
(Hide the whole section when empty — consistent with the existing notifications / active-SIPs empty
handling. Do **not** add a new empty-state card.)

### Leave as-is
Greeting shows the full username because `user.name` has no space
(`firstName = user.name.split(' ')[0]`) — data artifact, not layout.

## Acceptance criteria
- **Mobile (412×914):** Holdings / Active SIPs **side-by-side**; **no empty research card**; quick
  actions 2-up; portfolio card, active-SIP cards, and pending-approval panel/locked actions unchanged.
- **Desktop (≥1024):** two-column dashboard, large portfolio number, 4-col quick actions; research
  hidden when empty, shown (pulse card) when data exists.
- No regression to data fetching or approval-lock; brand/disclosure rules intact.

## Verification (author agent verifies after implementation)
1. `npm run dev`; Playwright `browser_resize(412,914)` then `(1280,860)`; log in
   (`verify@beonedge.local` / `Verify@123456`); navigate `/app/dashboard`; screenshot both.
2. Real-device: `bash emu/boe_update.sh` → emulator screenshot of Dashboard.
3. Confirm acceptance criteria; backend log still shows `/v1/client/*` fetches.

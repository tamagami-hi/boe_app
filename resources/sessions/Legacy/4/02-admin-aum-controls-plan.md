# Admin AUM Controls Plan

## Current State

`AumScreen.jsx` owns the fund editor. Existing state is initialized in `emptyForm` at `frontend_stack/packages/admin/src/screens/AumScreen.jsx:53`. Existing edit hydration is in `openEdit` at `AumScreen.jsx:103`. Existing submit payload is built in `handleSubmit` at `AumScreen.jsx:214`.

The editor already has:

- Basic Information section at `AumScreen.jsx:329`
- Lifecycle Workflow section
- Sector Distribution section
- Investment Distribution section
- Visibility Controls section
- Client Preview section
- Audit Trail and Summary sections

## New Admin Fields

Extend `emptyForm` and `openEdit` with:

```js
category: '',
subCategory: '',
riskText: '',
fundIconUrl: '',
nav: { value: '', asOf: '' },
rating: { value: '', scale: 5 },
performanceSummary: {
  selectedPeriod: '3Y',
  annualizedReturnPct: '',
  oneDayReturnPct: '',
  niftyReturnPct: '',
  asOf: ''
},
performanceSeries: [],
performancePeriods: [],
assetAllocation: [],
advancedRatios: {
  pe: '',
  pb: '',
  beta: '',
  alpha: '',
  sharpe: '',
  sortino: ''
},
holdingsAsOf: ''
```

Extend `chartConfig` with:

```js
showBenchmarkComparison: true,
showAssetAllocation: true,
showAdvancedRatios: true
```

## Editor Layout

Keep the existing editor page but split data-heavy controls into practical sections:

1. Basic Information
   - Add category, sub-category, risk display text, fund icon URL.
   - Add NAV value/date and rating.

2. Performance vs Nifty
   - Period summary rows: `1M`, `6M`, `1Y`, `3Y`, `5Y`, `ALL`.
   - Each row controls fund return pct, Nifty return pct, and annualized flag.
   - Series table controls date, fund index value, Nifty index value.
   - Add buttons to add row, remove row, and sort by date.
   - Show a small inline warning when fewer than two points exist.

3. Asset Split
   - Rows for label, percentage, color.
   - Default seed rows: Equity, Debt, Cash.
   - Total indicator must show exact total and color state.
   - This powers the bottom `Equity / Debt / Cash split` donut.

4. Sector Allocation
   - Reuse the existing sector editor where possible.
   - Rename admin copy to "Equity sector allocation" if the chart is intended to represent only equity exposure.
   - Keep sector total validation.

5. Holdings
   - Reuse existing `investments` as top holdings.
   - Add a `holdingsAsOf` date.
   - Continue hiding raw amounts from client payloads.
   - Let `showCompanyNames` control whether holding names are visible.

6. Advanced Ratios
   - Add P/E, P/B, beta, alpha, Sharpe, Sortino controls.
   - These are display metrics only, not used in order execution.

7. Visibility Controls
   - Add toggles for benchmark comparison, asset allocation, sector allocation, holdings names, advanced ratios.
   - Existing visibility controls are at `AumScreen.jsx:548`; extend them there.

## Admin Preview

The existing preview modal starts at `AumScreen.jsx:941` and the side preview is around `AumScreen.jsx:574`. Update both after the data model lands:

- Preview the redesigned Explore card, not the old compact card.
- Add a small mini comparison chart if performance series has at least two points.
- Preview bottom analysis charts in a narrow mobile-like column so admins understand what clients see.

## UX Rules

- Use existing admin styling classes and `lucide-react` icons.
- Avoid nested cards inside cards.
- Keep dense operational controls; this is an admin data-entry surface, not a marketing page.
- Inline validation is preferred over modal errors.
- Do not block draft save for incomplete chart data.
- Block or warn before `active` stage if client-visible charts are enabled but missing required data.

## Backend/API Touchpoints

Admin mutations already call:

- `POST /v1/admin/funds` in `frontend_stack/packages/admin/src/pages/Admin.jsx:121`
- `PATCH /v1/admin/funds/:id` in `Admin.jsx:126`

Backend routes are already wired:

- `POST /v1/admin/funds` in `backend_controller/src/admin/routes/adminRoutes.js:247`
- `PATCH /v1/admin/funds/:fund_id` in `adminRoutes.js:256`

The implementation should reuse these routes and extend the payload only.

## Implementation Status

✅ **Complete.**

- `frontend_stack/packages/admin/src/screens/AumDisplayFields.jsx` — Full editor for all new display fields.
- `frontend_stack/packages/admin/src/screens/AumScreen.jsx` — Integrated with `emptyForm`, `openEdit`, `handleSubmit`, and visibility toggles.
- Admin preview (inline side + modal) renders the redesigned Explore card with performance, NAV, rating, etc.
- Lifecycle validation warns before `active` stage if client-visible charts are enabled but missing required data.


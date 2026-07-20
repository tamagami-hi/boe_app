# Client Explore and Fund Detail UI Plan

## Current Client Explore

Explore cards are rendered by `FundCard` in `frontend_stack/packages/client/src/pages/Explore.jsx:22`. The list is rendered at `Explore.jsx:304`, after filters and sorting.

Existing card contents:

- fund name and status
- tagline
- pool size and sector count
- sector mini bar
- risk and min SIP
- Explore or Notify CTA
- disclaimer

## Explore Card Redesign

Replace the current card hierarchy with a compact fund profile card:

- Top row: fund icon/monogram, fund name, status.
- Meta line: risk text, category, sub-category.
- Performance block:
  - primary return, e.g. `16.90%`
  - label such as `3Y annualised`
  - one-day return if available
  - Nifty comparison, e.g. `Nifty 13.40%`
- Mini comparison chart:
  - two lines: fund and Nifty
  - no axes; just trend context
  - hide when no valid series exists
- Details grid:
  - NAV as of date
  - rating
  - min SIP
  - fund size
- Footer:
  - `View details` for active funds
  - `Notify me` for published/coming soon funds

Keep the existing Explore filters and sort controls for now. Add a future sort option only if performance data exists across funds.

## Current Fund Detail

`FundDetail.jsx:53` renders a broad BOE detail page with hero, objective, key stats, sector distribution, investment breakdown, top holdings, fees, disclosures, CTA, minimums, and SIP projection.

The Groww reference prioritizes:

- compact app bar
- fund identity and actions
- headline return
- performance chart with period chips
- NAV/rating/min SIP/fund size grid
- return calculator
- holdings list
- holdings analysis charts at the bottom

## Fund Detail Redesign

Use BOE theme but reorder the page closer to the reference:

1. Header
   - AppBar remains.
   - Fund icon, watchlist/bookmark/search/share actions if already supported; otherwise keep share only and do not add no-op actions.
   - Fund name and meta: risk, category, sub-category.

2. Performance Summary
   - Annualized return, one-day return, Nifty return.
   - Use positive/negative color rules.
   - Add a compliance disclosure nearby.

3. Fund vs Nifty Comparison Chart
   - Build a reusable SVG line chart in `Charts.jsx`.
   - Inputs: `series`, `activePeriod`, `lines=[fund,nifty]`.
   - Normalize line scale to visible min/max.
   - Period chips: `1M`, `6M`, `1Y`, `3Y`, `5Y`, `ALL`.
   - If selected period has no series, fallback to full series or show "Performance data pending".

4. Key Metric Grid
   - NAV/date
   - rating
   - min SIP
   - fund size

5. Return Calculator
   - Reuse existing SIP projection state around `FundDetail.jsx:61`.
   - Style it closer to the reference, but avoid implying guaranteed returns.
   - Use fund annualized return only as an admin-published illustrative rate, with clear disclosure.

6. Holdings
   - Show top holdings from `topHoldings`.
   - Use existing sanitized investments; do not expose amounts.
   - Add a link/button to scroll to holdings analysis rather than a separate route for this slice.

7. Holdings Analysis Bottom Section
   - Equity / Debt / Cash split donut.
   - Equity sector allocation donut.
   - Advanced ratios grid.
   - Holdings as-of date at the bottom.

8. Investment CTA
   - Keep action bar and Start SIP / One-time Investment actions.
   - On mobile, keep sticky bottom action bar if current app shell supports it.

## Chart Components

Existing chart components live in `frontend_stack/packages/client/src/components/Charts.jsx`.

Add:

- `LineComparisonChart`
  - SVG polyline/path chart for two series.
  - Accepts `height`, `fundColor`, `benchmarkColor`, and `showLegend`.
  - Must handle flat data and empty data.

- `DonutChart`
  - Prefer a flat donut over existing `PieChart3D` for a Groww-like mobile finance page.
  - Existing `AllocationRing` at `Charts.jsx:5` can be extended or wrapped.
  - Center label should show pool/AUM amount for asset split and equity amount for sector allocation.

## Styling

Use existing CSS files:

- `frontend_stack/packages/client/src/styles/mobile/explore.css`
- `frontend_stack/packages/client/src/styles/mobile/fund-detail.css`
- matching desktop CSS files

Design constraints for implementation:

- No oversized marketing hero.
- No nested cards inside cards.
- Cards should stay at 8px radius or less unless current tokens require otherwise.
- Avoid a one-note purple/blue palette. Use BOE green/gold/slate plus chart-specific colors.
- Text must fit in mobile widths around 360-430px.
- Use stable chart dimensions to avoid layout shifts.

## Empty States

- No performance series: hide chart and show a compact pending state.
- No asset split: hide `Equity / Debt / Cash split`.
- No sectors: hide sector allocation chart.
- No ratios: hide advanced ratios.
- No holdings: hide holdings list and holdings analysis as appropriate.

## Implementation Status

✅ **Complete.**

- `frontend_stack/packages/client/src/pages/Explore.jsx` — `FundCard` redesigned with monogram, performance block, mini chart, metric grid.
- `frontend_stack/packages/client/src/pages/FundDetail.jsx` — `PerformanceSection` and `HoldingsAnalysis` components added.
- `frontend_stack/packages/client/src/components/Charts.jsx` — `LineComparisonChart` and `DonutChart` implemented.
- `frontend_stack/packages/client/src/utils/fundDisplay.js` — Display helpers (`fundMonogram`, `formatReturnPct`, `formatNavDate`, `returnTone`).
- `frontend_stack/packages/client/src/styles/mobile/fund-redesign.css` — Mobile styles for all new components.
- `frontend_stack/packages/client/src/styles/desktop/fund-redesign.css` — Desktop breakpoint overrides.


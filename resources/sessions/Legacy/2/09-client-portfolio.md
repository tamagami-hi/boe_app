# Page plan — Client Portfolio

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** `/app/portfolio`
- **Component:** `frontend_stack/packages/client/src/pages/Portfolio.jsx`
- **Styles:** `packages/client/src/styles/mobile/portfolio.css`, `.../desktop/portfolio.css`,
  shared collapse block in `.../desktop/components.css`.
- **Intent:** show portfolio totals, holdings, redemption entry, and portfolio state.
- **Evidence:** `/tmp/ui/desk_portfolio.png`, `/tmp/ui/mob_portfolio.png`,
  `/tmp/ui/mob_portfolio.s.png`.

## Issues found
- **M1 — Holding headers may stack more than intended.** `.apk-holding-head` is forced into column
  layout by the shared collapse block. Verify against the mobile screenshot: fund name/units and
  status badge should remain scannable.
- **M2 — Summary grid uses `.apk-portfolio-grid`.** This selector is affected by the same block as
  Dashboard. Decide whether Portfolio summary should be one column, two columns, or a compact grid.
- **C1 — Footer disclosure lacks explicit risk wording.**

## Fixes
1. If mobile screenshot shows awkward badge stacking, remove `.apk-holding-head` from the
   `max-width:767px` flex-column group and set the intended mobile layout in `mobile/portfolio.css`.
2. Treat `.apk-portfolio-grid` carefully: Dashboard needs a two-column mobile grid; Portfolio
   summary may need a separate class override (`.apk-portfolio-summary-grid`) so changing the shared
   selector does not overfit one page.
3. Update the footer disclosure to include market-risk wording, for example:
   `Holdings as of ... Investment values are subject to market risk. Published by BeOnEdge.`

## Acceptance Criteria
- Mobile: holding cards have clear fund name, units, status, value, and gain/loss without crowding.
- Desktop: portfolio summary and holdings list remain aligned.
- Redemption modal still opens/submits as before.
- Market-risk wording is present once on the page.

# Page plan — Client Fund Detail

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** `/app/funds/:fundId`
- **Component:** `frontend_stack/packages/client/src/pages/FundDetail.jsx`
- **Styles:** `packages/client/src/styles/mobile/fund-detail.css`, `.../desktop/fund-detail.css`,
  shared collapse block in `.../desktop/components.css`.
- **Intent:** present full fund detail, allocation, holdings, fees, disclosures, and investment
  entry points.
- **Evidence:** `/tmp/ui/desk_fund-detail.png`, `/tmp/ui/mob_fund-detail.png` (verify auth state).

## Issues found
- **M1 — Minimums grid may collapse.** `.apk-fund-mins` is intended as three compact facts on mobile,
  but is in the desktop `max-width:767px` single-column group.
- **M2 — Fees rows may stack incorrectly.** `.apk-fund-fees-row` is a label/value flex row in mobile
  CSS; the shared collapse block forces it into a column.
- **M3 — Holdings row selector is risky.** `.apk-holding-row` is included in the grid collapse block.
  Confirm whether the fund holdings rows are grid or flex in the current render before changing it.
- **C1 — Hero risk copy should be explicit.** The disclaimer section has market-risk wording, but
  the hero quote says only past performance is not indicative of future returns.
- **F1 — Mobile capture may show an auth/sign-in state.** Re-capture while logged in before signing
  off on mobile layout.

## Fixes
1. In `styles/desktop/components.css`, remove `.apk-fund-mins` from the `max-width:767px`
   single-column grid list if screenshots confirm the mobile three-fact grid is intended.
2. In `styles/desktop/components.css`, remove `.apk-fund-fees-row` from the flex-column collapse
   list; preserve the mobile label/value row from `styles/mobile/fund-detail.css`.
3. Verify `.apk-holding-row` in the rendered fund-detail page. If it should stay label/value inline,
   remove it from the collapse list and add an explicit mobile rule in `mobile/fund-detail.css`.
4. In `FundDetail.jsx`, change the hero quote to include the standard risk phrase, for example:
   `Investments are subject to market risks. Past performance is not indicative of future returns.`
   Keep the full disclaimer section below.

## Acceptance Criteria
- Mobile 412px: minimums, fees, and holdings are readable without awkward stacked labels/values.
- Desktop 1280px: detail stack/sidebar, charts, disclosures, and investment CTA layout remain intact.
- Active/coming-soon state, share, back navigation, and invest links still work.
- Authenticated mobile screenshot confirms the actual detail page, not a login fallback.

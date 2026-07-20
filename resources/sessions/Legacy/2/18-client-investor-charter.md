# Page plan — Client Investor Charter

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** `/app/investor-charter`
- **Component:** `frontend_stack/packages/client/src/pages/InvestorCharter.jsx`
- **Styles:** `packages/client/src/styles/mobile/disclosures.css`, `.../desktop/disclosures.css`.
- **Intent:** show investor rights, responsibilities, do/don'ts, expectations, and contact details.
- **Evidence:** `/tmp/ui/desk_investor-charter.png`, `/tmp/ui/mob_investor-charter.png`.

## Issues found
- **No confirmed layout issue.** Charter-specific classes are outside the bad shared collapse block.
- **M1 — Verify contact grid on mobile.** It should remain one column with readable icon/text rows.
- **F1 — Loading skeleton should match the final card widths.**

## Fixes
1. No planned CSS change unless mobile screenshot shows contact-card crowding.
2. If necessary, add a targeted mobile rule for `.apk-charter-contact-grid` in
   `mobile/disclosures.css`.

## Acceptance Criteria
- Mobile: all charter sections and contact details stack cleanly.
- Desktop: contact grid remains two columns.
- Loading and empty/error states are not visually jarring.

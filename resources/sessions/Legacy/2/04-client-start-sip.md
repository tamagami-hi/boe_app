# Page plan — Client Start SIP

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** `/app/invest/sip/:fundId`
- **Component:** `frontend_stack/packages/client/src/pages/StartSipSheet.jsx`
- **Styles:** `packages/client/src/styles/mobile/invest.css`, `.../desktop/invest.css`,
  shared collapse block in `.../desktop/components.css`.
- **Intent:** collect recurring SIP amount, duration, debit day, optional step-up, risk consent, and
  create the first payment/order.
- **Evidence:** `/tmp/ui/desk_start-sip.png`, `/tmp/ui/mob_start-sip.png`.

## Issues found
- **M1 — Summary rows are forced vertical.** `.apk-sheet-summary-row` is a label/value row in
  `mobile/invest.css`; the shared collapse block turns it into a column on mobile.
- **M2 — Step-up toggle is forced vertical.** `.apk-stepup-toggle` should keep text and toggle in a
  usable row; the collapse block stacks it.
- **C1 — Consent copy uses full brand name inside mandate text.** This may be acceptable, but align
  it with the quieter tone used elsewhere if product wants "we" copy.
- **C2 — Risk wording is present but should match the exact standard consistently.**

## Fixes
1. In `styles/desktop/components.css`, remove `.apk-sheet-summary-row` from the `max-width:767px`
   flex-column selector list.
2. In `styles/desktop/components.css`, remove `.apk-stepup-toggle` from that same selector list.
3. In `styles/mobile/invest.css`, explicitly set:
   `.apk-sheet-summary-row { align-items: center; }` and
   `.apk-stepup-toggle { flex-direction: row; align-items: center; justify-content: space-between; }`
   to protect the intended mobile layout.
4. In `StartSipSheet.jsx`, standardize the consent and review disclosure wording to the same risk
   sentence used across money screens. Only replace "BeOnEdge" in the mandate consent if product
   approves the tone change.

## Acceptance Criteria
- Mobile 412px: review and inline summaries keep label/value alignment; step-up toggle remains easy
  to scan and tap.
- Desktop 1280px: form grid, review screen, and buttons remain balanced.
- Validation, consent gates, Razorpay handoff, and pending error path still work.

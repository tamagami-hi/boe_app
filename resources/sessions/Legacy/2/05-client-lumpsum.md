# Page plan — Client Lumpsum

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** `/app/invest/lumpsum/:fundId`
- **Component:** `frontend_stack/packages/client/src/pages/LumpsumSheet.jsx`
- **Styles:** `packages/client/src/styles/mobile/invest.css`, `.../desktop/invest.css`,
  shared collapse block in `.../desktop/components.css`.
- **Intent:** collect one-time investment amount and create a payment/order.
- **Evidence:** `/tmp/ui/desk_lumpsum.png`, `/tmp/ui/mob_lumpsum.png`.

## Issues found
- **M1 — Summary row is forced vertical.** `.apk-sheet-summary-row` is affected by the shared
  collapse block.
- **C1 — Missing explicit risk disclosure.** The page has payment disclosure but no market-risk
  statement before payment.
- **F1 — Amount input validation is less polished than Start SIP.** It allows direct numeric
  conversion without the same integer/clamp pattern and shows the minimum error even when the field
  starts with a default invalid/empty state.
- **F2 — No explicit risk consent.** Decide whether one-time investment requires the same consent
  gate as SIP. If yes, add it here.

## Fixes
1. Use the shared `.apk-sheet-summary-row` fix from the Start SIP plan.
2. Add a `be-disclosure` above or inside `.apk-sheet-summary`:
   `Investments are subject to market risk. Please read all scheme-related documents carefully before investing.`
3. Replace the inline amount `onChange` with the Start SIP `onAmountChange` pattern so invalid input
   is normalized consistently.
4. If compliance requires explicit acknowledgment, add a `riskConsent` state and disable the pay
   button until the checkbox is checked.

## Acceptance Criteria
- Mobile and desktop: one-time summary remains readable and not vertically awkward.
- Market-risk disclosure is visible before the Pay button.
- Amount validation is predictable and does not allow negative or fractional values.
- Razorpay success/failure navigation remains unchanged.

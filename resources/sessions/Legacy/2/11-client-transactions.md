# Page plan — Client Transactions

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** `/app/transactions`
- **Component:** `frontend_stack/packages/client/src/pages/Transactions.jsx`
- **Styles:** `packages/client/src/styles/mobile/transactions.css`, `.../desktop/transactions.css`,
  shared collapse block in `.../desktop/components.css`.
- **Intent:** show completed and pending transactions, payment retry actions, and transaction detail.
- **Evidence:** `/tmp/ui/desk_transactions.png`, `/tmp/ui/mob_transactions.png`,
  `/tmp/ui/mob_transactions.s.png`.

## Issues found
- **M1 — Pending row head may stack.** `.apk-row-head` is forced into column layout by the shared
  collapse block; verify badge/name alignment in mobile screenshot.
- **M2 — Payment action is intentionally stacked on mobile.** Keep this mobile behavior, but ensure
  desktop restores horizontal buttons.
- **M3 — Transaction detail sheet summary rows inherit the shared `.apk-sheet-summary-row` issue.**
- **C1 — Footer disclosure should mention market pricing/risk for investment transactions.**

## Fixes
1. Remove `.apk-row-head` from the shared flex-column group if screenshot shows unnecessary stacking;
   set the intended mobile layout in `mobile/transactions.css`.
2. Keep `.apk-payment-action` stack behavior in `mobile/transactions.css` and desktop row behavior in
   `desktop/transactions.css`; do not rely on the shared collapse block for this page.
3. Use the shared `.apk-sheet-summary-row` fix for the transaction detail sheet.
4. Update footer disclosure:
   - Pending tab: `Pending installments are AutoPay attempts that did not complete. Retrying does not double-charge.`
   - History tab: `Showing last 90 days. Older history is available in Statements. Investment values reflect market pricing.`

## Acceptance Criteria
- Mobile: pending cards are readable, retry/cancel actions are full-width and clear.
- Desktop: pending/payment actions align cleanly with table/card layout.
- Detail sheet keeps label/value rows readable.
- Tab-specific disclosure is correct.

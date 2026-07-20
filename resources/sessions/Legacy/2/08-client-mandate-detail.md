# Page plan — Client Mandate Detail

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** `/app/mandates/:mandateId`
- **Component:** `frontend_stack/packages/client/src/pages/MandateDetail.jsx`
- **Styles:** `packages/client/src/styles/mobile/invest.css`, `.../desktop/invest.css`,
  shared collapse block in `.../desktop/components.css`.
- **Intent:** view mandate details, pause/change/cancel SIP, and see recent control requests.
- **Evidence:** no direct screenshot with real mandate id; verify with seeded/created mandate.

## Issues found
- **M1 — Summary rows are forced vertical.** `.apk-sheet-summary-row` is affected by the shared
  collapse block.
- **M/D1 — Mandate actions need clear breakpoints.** Mobile CSS uses one column; desktop CSS uses
  three columns. Keep that behavior explicit.
- **C1 — Disclosure/modal copy uses full brand name where "our team" is cleaner.**
- **F1 — Change amount modal lacks client-side min/max validation.**
- **F2 — Pause/cancel modal copy does not explain the consequence of each action.**

## Fixes
1. Use the shared `.apk-sheet-summary-row` fix from the Start SIP plan.
2. Keep `.apk-mandate-actions` single-column in `mobile/invest.css` and three-column in
   `desktop/invest.css`; do not let the shared collapse block define this behavior.
3. Replace disclosure copy with:
   `Requests are auditable and reviewed by our team. You'll be notified once processed.`
4. Replace generic confirmation text with type-specific copy for pause, cancel, and change amount.
5. Add client-side amount validation for `change_amount` before enabling submit.

## Acceptance Criteria
- Mobile: action buttons stack with full-width tap targets.
- Desktop: action buttons are three equal columns.
- Request history remains readable with badge alignment.
- Invalid amount cannot be submitted from the modal.

# Page plan — Client Payment Status

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** `/app/payment/:paymentId`
- **Component:** `frontend_stack/packages/client/src/pages/PaymentStatus.jsx`
- **Styles:** `packages/client/src/styles/mobile/invest.css`, `.../desktop/invest.css`,
  shared action-bar rules in `.../desktop/components.css`.
- **Intent:** show payment state, timeline, retry/continue actions, and Razorpay fallback.
- **Evidence:** not fully captured because route needs a real payment id; verify with seeded payment.

## Issues found
- **M/D1 — Action bar behavior needs explicit breakpoint ownership.** `.apk-action-bar` is styled in
  the shared mobile-width block and desktop rules. Confirm mobile stack vs desktop row after edits.
- **C1 — Success/failure disclosure says "BeOnEdge does not store your UPI PIN."** Full brand name is
  not a "BOE" violation, but quieter copy (`We do not store your UPI PIN.`) is more consistent.
- **C2 — Missing market-risk reminder on successful investment payment.**
- **F1 — Fallback checkout name is generic.** `BeOnEdge Investment` should fall back to SIP/one-time
  wording when `order.fundName` is unavailable.

## Fixes
1. Keep `.apk-action-bar` stacked on mobile but make the breakpoint explicit in mobile/desktop CSS:
   mobile full-width column, desktop row with sticky bottom behavior.
2. In `PaymentStatus.jsx`, replace fallback checkout name with:
   `order?.fundName || (order?.type === 'sip' ? 'Monthly SIP' : 'One-time Investment')`.
3. Replace UPI PIN disclosure with "We do not store your UPI PIN."
4. Add a success-only `be-disclosure` after the timeline:
   `Investments are subject to market risk. Monitor your portfolio from the dashboard.`

## Acceptance Criteria
- Mobile: actions are full-width and stacked; desktop: success/failure actions sit in a row.
- Created Razorpay state still shows payment button/config error correctly.
- Polling stops on terminal states.
- Success state includes risk reminder and continues to mandate auth/dashboard as before.

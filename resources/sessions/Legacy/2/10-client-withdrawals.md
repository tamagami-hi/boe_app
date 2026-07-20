# Page plan — Client Withdrawal Requests

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** `/app/withdrawals`
- **Component:** `frontend_stack/packages/client/src/pages/WithdrawalRequests.jsx`
- **Styles:** `packages/client/src/styles/mobile/portfolio.css`, `.../desktop/portfolio.css`.
- **Intent:** show redemption/withdrawal requests and their current approval/payment state.
- **Evidence:** `/tmp/ui/desk_withdrawals.png`, `/tmp/ui/mob_withdrawals.png`,
  `/tmp/ui/mob_withdrawals.s.png`.

## Issues found
- **C1 — Missing money-screen disclosure.** Add clear redemption timing/risk text.
- **D/M1 — Heading hierarchy is thinner than sibling money pages.** Portfolio has a clearer eyebrow
  and page hierarchy; withdrawals should match that density.
- **F1 — Empty state and link back to Portfolio should be verified.**

## Fixes
1. Add an eyebrow above the title, for example `Manage funds`.
2. Add a `be-disclosure` near the bottom:
   `Redemption requests require approval. Final values may vary with market movement until units are processed.`
3. Verify the empty state CTA routes users to `/app/portfolio` to start a withdrawal from holdings.

## Acceptance Criteria
- Mobile and desktop: heading, request rows, statuses, and empty state match portfolio/transactions
  visual language.
- Disclosure appears without creating a new large card.
- Navigation to Portfolio works.

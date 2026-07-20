# Page plan — Client Approval Required

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** `/app/approval-required`
- **Component:** `frontend_stack/packages/client/src/pages/ApprovalRequired.jsx`
- **Styles:** `packages/client/src/styles/mobile/auth.css`, `.../desktop/auth.css`.
- **Intent:** explain account approval gating and route users back to safe exploration.
- **Evidence:** `/tmp/ui/desk_approval-required.png`, `/tmp/ui/mob_approval-required.png`.

## Issues found
- **No confirmed layout issue.** State card is centered and responsive.
- **C1 — Copy uses full brand name.** Acceptable, but can be changed to "we review" for warmer tone.
- **F1 — CTA route should be verified for pending users.**

## Fixes
1. No planned CSS change unless mobile screenshot shows card overflow.
2. Optional copy:
   `Explore the dashboard and strategies while we review the account.`
3. Verify CTA does not send pending users to a locked action.

## Acceptance Criteria
- Mobile and desktop: state card is centered, readable, and not oversized.
- Pending users can navigate safely.
- Copy stays calm and non-technical.

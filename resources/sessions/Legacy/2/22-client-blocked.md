# Page plan — Client Blocked State

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** routed by auth/status state to `Blocked.jsx`
- **Component:** `frontend_stack/packages/client/src/pages/Blocked.jsx`
- **Styles:** `packages/client/src/styles/mobile/auth.css`, `.../desktop/auth.css`.
- **Intent:** explain pending/rejected/suspended/closed account states and provide safe next actions.
- **Evidence:** no direct screenshot captured; create one by seeding each blocked status.

## Issues found
- **No confirmed layout issue.** Card uses existing centered state-screen styling.
- **F1 — Need status-specific screenshot verification.** Copy, icon color, and CTA vary by status.
- **C1 — Pending copy uses full brand name; acceptable, but "your account" wording may be calmer.**

## Fixes
1. No planned CSS change unless seeded status screenshots reveal overflow.
2. Verify every status config has an appropriate CTA or explanation.
3. Optional copy tightening: avoid repeated brand name in body text if surrounding UI already brands
   the app.

## Acceptance Criteria
- Mobile and desktop: pending/rejected/suspended/closed states render without overflow.
- CTAs route to support/logout where appropriate.
- Signal colors are used only for status meaning.

# Page plan — Client Support

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** `/app/support`
- **Component:** `frontend_stack/packages/client/src/pages/Support.jsx`
- **Styles:** `packages/client/src/styles/mobile/profile.css`, `.../desktop/profile.css`.
- **Intent:** searchable FAQ, ticket creation, and active ticket status.
- **Evidence:** `/tmp/ui/desk_support.png`, `/tmp/ui/mob_support.png`.

## Issues found
- **No confirmed layout issue.** FAQ/search/ticket cards are not directly affected by the shared
  collapse block.
- **M1 — Verify ticket form spacing on mobile.** Search, FAQ accordion, form, and active tickets can
  become a long screen; spacing should stay dense but readable.
- **F1 — Verify FAQ expand/collapse and ticket submit state.**

## Fixes
1. No planned CSS change unless mobile screenshot shows crowded form controls.
2. If needed, add page-specific spacing in `mobile/profile.css`; avoid introducing a new card wrapper
   around the whole page.

## Acceptance Criteria
- Mobile and desktop: FAQ search, accordion, ticket fields, and active tickets are readable.
- Submitting a ticket shows expected status/error.
- Empty FAQ/ticket states are handled cleanly.

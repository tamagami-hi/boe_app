# Page plan — Client Legal

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** `/app/legal`
- **Component:** `frontend_stack/packages/client/src/pages/Legal.jsx`
- **Styles:** `packages/client/src/styles/mobile/profile.css`, `.../desktop/profile.css`.
- **Intent:** present terms, privacy, risk, methodology, grievance, licenses, and version content.
- **Evidence:** `/tmp/ui/desk_legal.png`, `/tmp/ui/mob_legal.png`.

## Issues found
- **No confirmed layout issue.** Legal sections are simple reading blocks.
- **C1 — Copy is static and uses full brand name.** This is acceptable for legal content.
- **D/M1 — Verify line length.** Desktop should stay constrained; mobile should not feel like cards
  inside cards.

## Fixes
1. No functional/CSS change planned unless screenshots show poor text width.
2. Preserve the exact market-risk statement already present in the Risk disclosure section.

## Acceptance Criteria
- Mobile: sections are readable with comfortable spacing and no horizontal scroll.
- Desktop: content stays constrained around the existing legal-section width.
- Risk disclosure remains visible.

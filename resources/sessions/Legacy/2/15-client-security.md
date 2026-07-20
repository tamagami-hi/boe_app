# Page plan — Client Security

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** `/app/security`
- **Component:** `frontend_stack/packages/client/src/pages/Security.jsx`
- **Styles:** `packages/client/src/styles/mobile/profile.css`, `.../desktop/profile.css`.
- **Intent:** show app/device security preferences and session controls.
- **Evidence:** `/tmp/ui/desk_security.png`, `/tmp/ui/mob_security.png`.

## Issues found
- **No confirmed layout issue.** Rows use `.apk-list-row`, which is no longer in the bad collapse
  block.
- **C1 — Biometric disclosure uses full brand name.** This is acceptable if brand wants legal clarity;
  otherwise use "we" for consistency.
- **F1 — Controls appear presentational.** Verify whether toggles/buttons are intentionally disabled
  placeholders or should route/action.

## Fixes
1. No layout fix planned unless screenshots show row overflow.
2. Optional copy change:
   `We never receive your fingerprint or face data.`
3. If controls are placeholders, ensure disabled/coming-soon state is explicit and not misleading.

## Acceptance Criteria
- Mobile and desktop: list rows align labels, meta text, and controls without truncation.
- Copy is calm and consistent.
- Placeholder controls do not imply a working security setting if none exists.

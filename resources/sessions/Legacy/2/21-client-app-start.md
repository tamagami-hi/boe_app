# Page plan — Client AppStart

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** `/app/start`
- **Component:** `frontend_stack/packages/client/src/pages/AppStart.jsx`
- **Styles:** `packages/client/src/styles/mobile/auth.css`, `.../desktop/auth.css`.
- **Intent:** choose web/app path after login on browser flows.
- **Evidence:** `/tmp/ui/desk_appstart.png`, `/tmp/ui/mob_appstart.png`.

## Issues found
- **No confirmed layout issue.** Card grid is one column mobile, two columns desktop.
- **F1 — Verify route relevance after client-shell routing changes.** APK shell may bypass this page
  and go straight to dashboard.
- **C1 — Copy says download app when release package is available; ensure it matches current rollout.**

## Fixes
1. No planned CSS change.
2. Verify browser route uses `/app/start` and client-shell APK route does not strand users here.
3. Update copy only if release/install flow has changed.

## Acceptance Criteria
- Mobile and desktop: cards are clear and tappable.
- Browser flow and APK flow route as intended.
- No dead CTA.

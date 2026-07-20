# Page plan — Client Notifications

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** `/app/notifications`
- **Component:** `frontend_stack/packages/client/src/pages/Notifications.jsx`
- **Styles:** `packages/client/src/styles/mobile/transactions.css`, `.../desktop/transactions.css`.
- **Intent:** show grouped transactional notifications and let users open linked actions.
- **Evidence:** `/tmp/ui/desk_notifications.png`, `/tmp/ui/mob_notifications.png`,
  `/tmp/ui/mob_notifications.s.png`.

## Issues found
- **No confirmed layout issue.** The subagent checked `.apk-notif` against the collapse block and did
  not find a real override conflict.
- **F1 — Verify read/deep-link behavior.** Ensure notification clicks mark read and route correctly.
- **D/M1 — Empty state should remain compact and centered.**

## Fixes
1. No CSS change planned unless screenshots show overlap/truncation.
2. If adding polish, keep it targeted to spacing in `mobile/transactions.css`; do not add a shared
   selector to the collapse block.

## Acceptance Criteria
- Mobile and desktop: grouped notifications scan cleanly with unread state visible.
- Empty state text and icon do not feel like a large marketing block.
- Deep links and mark-read behavior still work.

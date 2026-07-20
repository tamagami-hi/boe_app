# Page plan — Client Grievance Redressal

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** `/app/grievance`
- **Component:** `frontend_stack/packages/client/src/pages/GrievanceRedressal.jsx`
- **Styles:** `packages/client/src/styles/mobile/disclosures.css`, `.../desktop/disclosures.css`.
- **Intent:** explain escalation levels, timeline commitments, grievance officer contact, and links.
- **Evidence:** `/tmp/ui/desk_grievance.png`, `/tmp/ui/mob_grievance.png`.

## Issues found
- **M1 — Timeline grid may be too tight on small mobile.** Subagent flagged the two-column timeline
  at 412px as a potential squeeze point.
- **No confirmed shared-collapse issue.** Grievance classes are not in the bad block.

## Fixes
1. Inspect `/tmp/ui/mob_grievance.png`. If labels wrap poorly, add:
   `@media (max-width: 480px) { .apk-grievance-timeline-grid { grid-template-columns: 1fr; } }`
   in `mobile/disclosures.css`.
2. Keep desktop timeline at two columns.

## Acceptance Criteria
- Mobile: timeline labels and target values do not squeeze or overlap.
- Desktop: escalation/timeline layout remains balanced.
- External/action links remain accessible.

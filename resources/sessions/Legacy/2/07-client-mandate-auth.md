# Page plan — Client Mandate Auth

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** `/app/mandates/:mandateId/authorize`
- **Component:** `frontend_stack/packages/client/src/pages/MandateAuth.jsx`
- **Styles:** `packages/client/src/styles/mobile/invest.css`, `.../desktop/invest.css`,
  shared collapse block in `.../desktop/components.css`.
- **Intent:** guide users through UPI AutoPay authorization or explain Razorpay pending setup.
- **Evidence:** no direct screenshot with real mandate id; verify with seeded/created SIP mandate.

## Issues found
- **M1 — Summary rows are forced vertical.** `.apk-sheet-summary-row` is affected by the shared
  collapse block.
- **C1 — Copy uses full brand name repeatedly in user-facing mandate text.** Consider replacing with
  "we" while retaining legal clarity.
- **A11y1 — Authorization steps are div rows, not a semantic ordered list.**
- **F1 — Active/authorized state feedback is mostly button text.** Add a clearer confirmation state
  when mandate becomes active.

## Fixes
1. Use the shared `.apk-sheet-summary-row` fix from the Start SIP plan.
2. Replace:
   `BeOnEdge can debit only...`
   with:
   `We can debit only...`
   if approved by product/legal.
3. Render authorization steps as an `<ol aria-label="AutoPay authorization steps">` with `<li>`
   rows while preserving `.apk-timeline-row` visual styling.
4. When `mandate.status === 'active'`, show a small success disclosure:
   `Your UPI AutoPay mandate is active.`

## Acceptance Criteria
- Mobile and desktop: mandate summary rows retain clean label/value alignment.
- Pending Razorpay explanation remains centered and clear.
- Mock authorization flow still updates and navigates to dashboard.
- Screen reader order for authorization steps is clear.

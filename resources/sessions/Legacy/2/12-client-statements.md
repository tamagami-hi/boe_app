# Page plan — Client Statements

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** `/app/statements`
- **Component:** `frontend_stack/packages/client/src/pages/Statements.jsx`
- **Styles:** `packages/client/src/styles/mobile/transactions.css`, `.../desktop/transactions.css`,
  shared collapse block in `.../desktop/components.css`.
- **Intent:** list downloadable statements with filters and summary counts.
- **Evidence:** `/tmp/ui/desk_statements.png`, `/tmp/ui/mob_statements.png`,
  `/tmp/ui/mob_statements.s.png`.

## Issues found
- **M1 — Statement rows are forced single-column.** `.apk-statements-row` is in the shared collapse
  block. Verify whether the current mobile row should remain grid/inline.
- **C1 — Disclosure lacks full risk context.**
- **A11y1 — Summary counts are visually definition-list data but use generic divs.**

## Fixes
1. Remove `.apk-statements-row` from the shared grid collapse block if mobile screenshot confirms the
   action/period row should remain inline.
2. Set the intended mobile and desktop `.apk-statements-row` grid templates in
   `mobile/transactions.css` and `desktop/transactions.css`.
3. Convert the summary counts to a semantic `<dl className="apk-statements-summary">` with `dt/dd`
   pairs while preserving visual styles.
4. Update disclosure:
   `Statements reflect published NAV and reconciled ledger entries. Past performance does not guarantee future returns.`

## Acceptance Criteria
- Mobile: each statement row shows period/meta and action buttons without overflow.
- Desktop: statement row action buttons remain aligned to the right.
- Summary is semantic and visually unchanged.
- Filter and download/open actions still work.

# Page plan — Client Explore

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** `/app/explore`
- **Component:** `frontend_stack/packages/client/src/pages/Explore.jsx`
- **Styles:** `packages/client/src/styles/mobile/explore.css`, `.../desktop/explore.css`,
  shared collapse block in `.../desktop/components.css`.
- **Intent:** help users discover available funds, filter/search by status and risk, and open fund
  detail pages.
- **Evidence:** `/tmp/ui/desk_explore.png`, `/tmp/ui/mob_explore.png`, `/tmp/ui/mob_explore.s.png`.

## Issues found
- **M1 — Fund card foot collapses on mobile.** `.apk-fund-foot` is rendered for risk/min SIP in
  `Explore.jsx`; mobile CSS gives it a compact grid, but the desktop `max-width:767px` collapse
  block forces `grid-template-columns: 1fr`.
- **C1 — Explore disclosure copy is weaker than the money-screen standard.** Fund cards mention
  past performance, but the page should include the exact market-risk wording required in the
  overview for investment screens.
- **D1 — Verify active/coming-soon cards after edits.** The desktop screenshot shows the intended
  card grid; ensure any mobile fix does not flatten desktop status/action layout.
- **M2 — Empty "research context" card (MISS — found during verification; NOT yet implemented).**
  When `researchApi.getResearchContext()` resolves to `[]`, `Explore.jsx:339` tests `!research`
  (an empty array is truthy) so it renders `.apk-research-card` with zero rows → an **empty white
  card** under the research eyebrow. Same bug class as Dashboard M2; confirmed still present in the
  mobile render after the first implementation pass (`/tmp/ui2/explore.png`).

## Fixes
1. In `styles/desktop/components.css`, remove `.apk-fund-foot` from the `max-width:767px`
   `grid-template-columns: 1fr` group if the mobile screenshot confirms risk/min SIP should remain
   in a compact row/grid. **(DONE in first pass — verify.)**
2. In `styles/mobile/explore.css`, make the intended mobile shape explicit for `.apk-fund-foot`
   after the shared component imports, ideally `grid-template-columns: repeat(2, minmax(0, 1fr))`
   because the JSX currently renders two real cells. **(DONE in first pass — verify.)**
3. In `Explore.jsx`, add a page-level `be-disclosure` near the bottom of the screen:
   `Investments are subject to market risk. Please read all scheme-related documents carefully before investing.`
   Keep per-card past-performance text if it remains visually useful. **(DONE in first pass — verify.)**
4. **(M2 — OUTSTANDING) Hide the research section when it has no data.** In `Explore.jsx:335`,
   gate the section so it shows the skeleton while loading (`research === null`) and the grid only
   when there are items — never an empty card. Change the wrapper condition to:
   `isComponentEnabled(appConfig, 'explore', 'research_context') && (research === null || research.length > 0) && (`
   (mirrors Dashboard M2; preserves the loading skeleton which relies on `research === null`).

## Acceptance Criteria
- Mobile 412px: fund card foot shows Risk and Min SIP cleanly without a long single-column stack.
- Desktop 1280px: fund cards, featured row, search/filter controls, and Notify/Explore actions keep
  the current layout.
- Filtering, sorting, coming-soon notify toast, and fund-card navigation still work.
- Market-risk disclosure is visible once on the page without duplicating awkwardly in every card.
- **No empty research card**: when research data is empty the whole research section is hidden; the
  loading skeleton still appears while research is loading.

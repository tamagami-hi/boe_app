# Admin Surface Responsive Refactor — Fluid Layout + Design-Token Consolidation

## Context

The admin portal suffers layout instability, wasted whitespace on wide monitors, inconsistent spacing, and scattered responsive behavior. Audit found the root causes are architectural, not cosmetic:

1. **720px content cap** — all admin pages clamp to `--be-content-max` (720px reading width) while monitors get 1920px+. Dead whitespace, poor screen utilization.
2. **Legacy `.adm-*` CSS layer** (`styles/desktop/admin.css`, 1889 lines, used by 19 operational screens) — raw px spacing (10/13/14/18/22px), hardcoded `max-width: 1440px` caps (×3), fixed panel widths (640/460/420/360px), hardcoded font sizes bypassing the type scale.
3. **Media-query sprawl** — `styles/mobile/admin.css` duplicates 1100px rules from the desktop file; one-off 900px/1024px breakpoints diverge from the documented 768/1100 canon.
4. **Untokenized component sizes** — avatars (26/32px), icon buttons (36/44px), table cell padding (13px 14px) hardcoded throughout.

**User decisions:** scope = admin surface only (we're in wt/admin worktree); containers fully fluid — percentage/fr/clamp based, **no max-width cap** on data screens. Design-tokens changes must be **additive only** (client/website consume the same file).

What's already good (reuse, don't rebuild): complete token system (`design-tokens/src/tokens-core.css` — colors 100% tokenized, spacing scale, type scale, z-index); grid-based `.ash-*` shell; layout primitives `src/layout/primitives/{Page,ContentGrid,PageHeader,Section,SplitLayout}` with CSS-custom-property prop passthrough; kit primitives `.be-btn/.be-card/.be-badge` in `kit-core.css`.

## Key mechanism (smallest root-cause fix)

All three page containers read the same token:
- `.ash-page` → `shell.css:38`
- `.adm-screen` → `shell.css:887` (compat block — **live**, 18 screens use it; keep)
- `.be-page` → `Page.css:6` (`var(--page-max-w, var(--be-content-max))`)

One admin-scoped override makes everything fluid without touching other surfaces:

```css
.ash-app, .adm-app {
  --be-content-max: 100%;
  --be-page-pad-x: var(--be-page-pad-x-fluid);
  --be-page-pad-y: var(--be-page-pad-y-fluid);
  --be-sidebar-w: var(--be-sidebar-w-fluid);
}
```

## Phase 1 — Token additions (append-only)

`frontend_stack/packages/design-tokens/src/tokens-core.css` — append commented block after Layout section (~line 158):

```css
/* Fluid layout (admin-first, additive) */
--be-page-pad-x-fluid: clamp(var(--be-space-4), 2.5vw, var(--be-space-12));
--be-page-pad-y-fluid: clamp(var(--be-space-4), 1.8vw, var(--be-space-8));
--be-sidebar-w-fluid:  clamp(208px, 16vw, 256px);
--be-sidebar-w-rail:   60px;
/* Component sizes */
--be-avatar-sm: 26px; --be-avatar-md: 32px; --be-avatar-lg: 40px;
--be-icon-btn-sm: 36px; --be-icon-btn-md: 44px;
--be-control-h: 40px; --be-control-h-sm: 32px;
/* Table density */
--be-table-cell-pad-y: var(--be-space-3);
--be-table-cell-pad-x: var(--be-space-3);
/* Auto-fit grid minimums */
--be-col-min-stat: clamp(180px, 18vw, 240px);
--be-col-min-card: clamp(260px, 24vw, 340px);
```

(Icon size tokens `--be-icon-xs..xl` already exist — reuse, don't re-add.)

## Phase 2 — Shell + primitives fluidity (surgical patches)

`frontend_stack/packages/admin/src/styles/desktop/shell.css`:
- Add the scope override block (above) at top.
- Lines 20 & 933 grids: `grid-template-columns: var(--be-sidebar-w) minmax(0, 1fr)` — **`minmax(0,…)` is the critical overflow fix** so wide tables scroll inside the page instead of blowing the grid out.
- Line 929: alias `--ash-sidebar-w-collapsed: var(--be-sidebar-w-rail)`.
- `.ash-stat-grid` (line 523): `repeat(4,1fr)` → `repeat(auto-fit, minmax(var(--be-col-min-stat), 1fr))`; delete the now-redundant 1100/768 column overrides (lines 704–707).
- Line 994: `@media (max-width: 900px)` → `768px` (breakpoint canon).
- Preview panel caps (lines 806–817): fixed 560/720px → `clamp(320px, 30vw, 45vw)`.
- Tokenize raw px (avatar 26px line 738 → `var(--be-avatar-sm)`, icon buttons → `--be-icon-btn-*`, etc.).
- **Keep** the `.adm-*` compat block (lines 885–933) — verified live.

`layout/primitives/Page.css`: padding to `var(--be-page-pad-y-fluid) var(--be-page-pad-x-fluid)`; drop re-hardcoded breakpoint padding values.

`layout/primitives/ContentGrid.css`: default `--grid-min-col: var(--be-col-min-card)`.

## Phase 3 — `admin.css` wholesale rewrite (same selectors, same order)

`frontend_stack/packages/admin/src/styles/desktop/admin.css` — rewrite values, not structure. Zero JSX changes.

1. **px → token mapping** (mechanical, document in PR body):
   spacing 4→`space-1`, 6/8→`space-2`, 10/12→`space-3`, 14/16→`space-4`, 18/20→`space-5`, 22/24→`space-6`, 32→`space-8`;
   type 10/11→`--be-text-xs` (**no 2xs token exists**), 12→`xs`, 13/14→`sm`, 18→`lg`, 26→`2xl`;
   avatars/icon-btns/table-cells → new component tokens.
2. **Width unlocks**: remove three `max-width: 1440px` caps (login + AUM layouts); fixed panels 640/460/420/360 → `clamp(320px, 36vw, 520px)` style; `.adm-screen` keeps reading `--be-content-max` (now 100% via scope block).
3. **Grids**: `.adm-stats` → auto-fit minmax; `.adm-grid-2` → `minmax(0,2fr) minmax(0,1fr)`; same for `.adm-metric-grid`, `.adm-fund-stats`.
4. **Login** (line 677): `min-width: 1024px` → `1101px` (re-home to canon).
5. **Single consolidated responsive section at end** — exactly two queries (`max-width: 1100px`, `max-width: 768px`), absorbing `mobile/admin.css` content, dropping rules made obsolete by auto-fit.
6. **Universal table pattern in base styles** (not just 768px): `.adm-table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; min-width: 0; }`, table `width: 100%; min-width: max-content;`. Existing `data-label` card view in shell.css stays opt-in (needs JSX touches — out of scope).

## Phase 4 — Kill duplication

- **Delete** `styles/mobile/admin.css` (170 lines absorbed in Phase 3).
- `pages/Admin.jsx:28` — remove `import '../styles/mobile/admin.css';` (1 line).

## Phase 5 — Shared helpers (additive)

`screens/admin-screens-shared.css`: add `.be-table-wrap` (token-backed scroll wrapper) + `.be-filter-bar { display:flex; flex-wrap:wrap; gap:var(--be-space-3); }` with `> * { flex: 1 1 clamp(160px, 20vw, 260px); }` — replaces per-screen filter-row width hacks.

`styles/desktop/site.css` (234 lines): same px→token mapping pass.

## Files summary

| Action | Files |
|---|---|
| Append-only | `design-tokens/src/tokens-core.css` |
| Patch | `shell.css`, `Page.css`, `ContentGrid.css`, `admin-screens-shared.css`, `site.css`, `pages/Admin.jsx` (1 line) |
| Rewrite wholesale | `styles/desktop/admin.css` |
| Delete | `styles/mobile/admin.css` |
| Untouched | packages/client, packages/website, app host, all screen JSX |

Commit staging: (1) tokens, (2) shell fluidity, (3) admin.css rewrite, (4) consolidation + deletion.

## Verification

1. `cd frontend_stack && npm run dev` (port 8080 per project docs; if vite strictPort pins 5173, use that).
2. Playwright MCP: navigate `/admin`, login (seed creds in `backend_controller/.env`), screenshot at **1920×1080, 1366×768, 834×1112, 390×844**.
3. Screens covering every archetype: Overview (stats grid), Approvals (table+review panel), Payments (filters), UserDetailsList (wide table), Funds editor (split layout), AUM + tabs (1440 cap removal), AppBuilder, AdminLogin (breakpoint re-home), Transactions, AuditLog.
4. Per viewport: no horizontal body scroll; tables scroll in wrapper; sidebar 240→rail@1100→horizontal@768; content fills width at 1920 with visibly larger clamp padding than 1366.
5. `npm run build` passes (catches CSS syntax errors).

## Risks / notes

- `--be-content-max: 100%` also widens genuinely narrow form pages — those should pass `maxWidth` prop to `<Page>` (primitive already supports it); audit during verification.
- Sticky sidebar (`height: 100dvh`) + new `minmax(0,1fr)`: watch collapse animation for layout shift.
- `git stash list` shows `stash@{0}: superseded local admin.css cleanup` — superseded, do NOT pop.
- Dark mode: tokens remap automatically; spot-check one screen with `data-theme="dark"`.

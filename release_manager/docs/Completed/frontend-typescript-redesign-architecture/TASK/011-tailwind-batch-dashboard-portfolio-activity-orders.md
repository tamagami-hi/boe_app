# 011 — Tailwind v4 conversion: dashboard, portfolio, activity, orders

## What this was

Four of the sixteen remaining `.module.css` files under `frontend_stack_ts/src/features/` were
converted to Tailwind v4 utilities. `src/ui/`, `src/app/` and `src/shells/` were already converted;
this batch is one of four disjoint slices of the feature layer, so nothing outside these four
directories was touched apart from three shared recipe files.

Scope:

- `src/features/dashboard/` — `DashboardScreen.tsx`, 156-line stylesheet
- `src/features/portfolio/` — `PortfolioScreen.tsx`, 70-line stylesheet
- `src/features/activity/` — `ActivityScreen.tsx`, 42-line stylesheet
- `src/features/orders/` — `LumpsumInvestScreen.tsx` and `RiskConsent.tsx`, 124-line stylesheet

All four stylesheets are deleted. No `styles.` reference survives in the five components.

## How the class vocabulary was decided

The rule followed was: reuse `src/ui/recipes/` first, promote to a recipe only when the pattern would
plausibly recur in another feature, and put the rest in a per-feature `<feature>.recipe.ts`. No long
utility strings were left inline in JSX.

Reused without change: `STAT_LABEL`, `STAT_ROOT`, `MONEY_BASE`/`MONEY_SIZE`/`MONEY_TONE`,
`SECTION_TITLE`, `CARD_TITLE`, `BODY_SM`, `META_TEXT`, `FIELD_ERROR`, `GRID_BASE`, `CARD_LINK`,
`ring-inset-hairline-strong`.

Promoted to shared recipes:

- `src/ui/recipes/text.ts` — `META_MUTED`. Six separate `font-ui / text-xs / fg-muted` rules existed
  across the four stylesheets (`.date`, `.sub`, `.category`, `.fundMeta`, `.hint`, `.poolMeta`).
- `src/ui/recipes/surface.ts` — `CARD_STACK` (vertical stack of cards, was `.list`) and `CARD_ACTION`
  (a `Link` wrapping a `Button` at the foot of a card, was `.cardAction`).
- `src/ui/recipes/field.ts` — `CHECKBOX_ROW`, `CHECKBOX_MARK_BASE`, `CHECKBOX_MARK_OFF`,
  `CHECKBOX_MARK_ON`, `CHECKBOX_GLYPH`. A checkbox is a form control, so it belongs beside the
  existing switch and radio recipes rather than inside `orders/`.

Per-feature recipes created: `dashboard.recipe.ts` (the 6-column bento and its span helpers),
`portfolio.recipe.ts`, `activity.recipe.ts`, `orders.recipe.ts`.

## Three things worth knowing

**`.statusRow + .statusRow` became `first-of-type:border-t-0`.** The old rule drew a rule between
adjacent status rows. A naive `border-b … last:border-b-0` would have been wrong, because the last
status row is not the last child of the card — a `Link` follows it. The rows are the only `div`
children of that card, so `border-t border-hairline first-of-type:border-t-0` reproduces the original
exactly without adding a wrapper element.

**Percentages use the money recipes.** `.returnValue`, `.percent` and `.percentSmall` were
hand-rolled `--be-font-numeric` + `tabular-nums` rules. They now compose
`MONEY_BASE + MONEY_SIZE[…] + MONEY_TONE.default`, which is the same font stack and the same numeric
features, and keeps D-029 (money never renders in `font-mono`) in one place instead of three.

**A `CARD_LINK` collision was resolved mid-flight.** A parallel batch added `CARD_LINK` to
`surface.ts` at the same time as this one, with the same intent but without `h-full`. The shorter
definition was kept as the shared one, and the dashboard's fund tiles — which need the anchor to fill
its grid cell — use `FUND_CARD_LINK` in `dashboard.recipe.ts`, which is `CARD_LINK` plus `h-full`.

## Defects found in the original CSS

- Three near-identical micro-labels: `Dashboard.label` (10px / 0.2em), `Portfolio.label`
  (12px / 0.12em) and `Orders.label` (10px / 0.16em) all meant "label above a figure". They are now
  one `STAT_LABEL`. Portfolio's label therefore renders 10px rather than 12px.
- `Dashboard.spanHalf` and `Dashboard.spanAside` were only ever used together, as
  `cx(styles.spanAside, styles.spanHalf)`. They are now a single `SPAN_ASIDE`.
- `cx(styles.spanHero)` was a single-argument `cx` call that did nothing.
- `Activity.fundLink` — a text style — was also used as the `className` of the `Link` that wraps an
  entire payment card. Every descendant sets its own typography, so the text properties were dead
  there. That wrapper now uses `CARD_LINK`.
- `Orders.consentBox` used `border-radius: 5px`, which matches no radius token. It is now
  `rounded-sm` (6px).
- `Orders.ruleDot` used `margin-top: 7px`, off the spacing scale. It is now `mt-1.5` (6px).
- `Dashboard.label` carried `display: block`, but every one of its four call sites is a flex child,
  where the declaration has no effect.

## Deliberate visual deltas

Small and listed so a reviewer is not surprised:

- Portfolio's stat labels: 12px → 10px, tracking 0.12em → 0.16em.
- Dashboard's stat labels: tracking 0.2em → 0.16em.
- Dashboard's fund-tile name: `CARD_TITLE` is weight 500 where `.fundName` was 400, and tracking
  −0.01em where it was −0.018em.
- Portfolio's three headline cells gained `STAT_ROOT` (a 4px label-to-figure gap where there was
  none). This is also what supplies the block layout that `display: block` used to provide.
- The consent checkbox's unchecked border is 1px (`ring-inset-hairline-strong`) where it was a raw
  1.5px inset shadow, which is now consistent with the switch and radio controls.

## Verification

TESTED, from `frontend_stack_ts/`:

- `npx eslint src/features/dashboard src/features/portfolio src/features/activity src/features/orders`
  — clean.
- `npx vitest run` — 8 files, 110 tests, all passing, including
  `src/ui/tokens/safeArea.test.ts`, which is the guard against writing `env(safe-area-inset-*)`
  outside `tokens-core.css`.
- `npx tsc -p tsconfig.json --noEmit` — no error in any file in this batch's scope. The run is not
  globally clean, because the three parallel batches were mid-edit; their errors are confined to
  `src/features/admin/`, `src/features/support/` and a duplicate `ACTION_ROW` in
  `src/ui/recipes/layout.ts`, none of which this batch wrote.
- Every utility class produced by the four new recipe files was compiled through the Tailwind engine
  against the real `src/ui/styles/index.css` — 53 candidates, none unresolved. This is what confirms
  that `size-4.5`, `first-of-type:border-t-0`, `border-rule` and `grid-cols-[auto_1fr]` are real
  classes and not silent no-ops, which a typecheck cannot tell you.

UNVERIFIED: no browser has rendered any of these five screens. A green typecheck and a green test run
say nothing about whether the bento collapses correctly at 768px, whether the status-row divider
lands where the old sibling selector put it, or whether the checkmark is centred in the consent box.
`vite build` was deliberately not run, because the other three batches leave the tree
non-compiling while they work; it needs to run once all four have landed.

To get runtime proof, on the VPS after the full set of sixteen conversions has landed and deployed:

```
# read, at 390px and at 1512px
/dashboard        # bento spans, the split row, the account card dividers
/portfolio        # the three-up headline grid and its top rule
/activity         # both tabs, ledger rows and payment rows
/funds/<fundId>/invest   # amount block, consent checkbox both states, the rules list
```

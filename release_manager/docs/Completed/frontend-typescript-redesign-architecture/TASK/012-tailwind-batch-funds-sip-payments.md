# 012 — Tailwind v4 conversion: funds, sip, payments

One of four parallel, disjoint slices of the remaining CSS-module conversion in
`frontend_stack_ts/src/features/`. This slice owned `features/funds/`, `features/sip/` and
`features/payments/` and nothing else.

## What it had to preserve

The fund list is deliberately two different things at two sizes (doc 10, phase 5): a real sortable
`<table>` at `lg` and up, cards below it. `FundListScreen` decides that in TypeScript via
`isCompact(useBreakpoint())`, not in CSS, so the split survives the conversion untouched — the table
is still a `<table>` with `<th scope="col">` and per-column sort buttons, and it was not turned into
an auto-fit grid.

These are money screens. Every rupee figure already went through `MoneyValue`, which composes
`MONEY_BASE`/`MONEY_SIZE`/`MONEY_TONE`, so D-029 holds by construction: `grep -rn font-mono` over the
three directories returns nothing.

## Converted

| File | Was |
| --- | --- |
| `funds/FundListScreen.tsx` | `Funds.module.css` |
| `funds/FundDetailScreen.tsx` | `Funds.module.css` |
| `funds/FundTable.tsx` | `FundTable.module.css` |
| `sip/SipListScreen.tsx` | `Sip.module.css` |
| `sip/SipDetailScreen.tsx` | `Sip.module.css` |
| `sip/SipStartScreen.tsx` | `Sip.module.css` |
| `payments/PaymentStatusScreen.tsx` | `Payments.module.css` |
| `payments/PendingPaymentRecovery.tsx` | `Payments.module.css` |

Deleted: `funds/Funds.module.css`, `funds/FundTable.module.css`, `sip/Sip.module.css`,
`payments/Payments.module.css`.

Added: `funds/funds.recipe.ts` (23 constants), `sip/sip.recipe.ts` (9), `payments/payments.recipe.ts` (4).

Added to shared recipes, because each recurs outside its feature:

- `HONESTY_TEXT` — `ui/recipes/text.ts`. The "nothing is hidden from you" paragraph appears on the
  SIP detail, SIP start, payment status and pending-recovery surfaces with one declaration block.
- `CARD_LINK` — `ui/recipes/surface.ts`. A `Link` wrapping a whole `Card`.
- `ACTION_ROW` — `ui/recipes/layout.ts`. A wrapping row of buttons under a `Section`.

Reused rather than re-derived: `SHELL`, `CARD_LINK`, `SECTION_TITLE`, `STAT_LABEL`, `STAT_ROOT`,
`LIST_LABEL`, `LIST_VALUE`, `FIELD_ERROR`, `STATE_REFRESHING`, `ACTION_ROW`, `HONESTY_TEXT`.

## Defects found in the CSS being deleted

1. **Four names, one rule.** `Funds.module.css` declared `.category`, `.holdings`, `.noSize` and
   `.sizeLabel` as a single grouped selector with one body. They are now one constant, `FUND_META`.
2. **The SIP summary grid never stacked.** In `SipDetailScreen` and `SipStartScreen` each summary cell
   was a bare `<div>` holding two `<span>`s, with no `flex-direction: column` anywhere. The spans are
   inline and JSX drops the newline between them, so a 10px uppercase label rendered flush against its
   value — `DEBIT DAY15`. The cells now use `STAT_ROOT` (`flex flex-col gap-1`), the same recipe
   `ui/patterns/DataList`'s `Stat` uses. Same DOM, intended layout. This is a visual change, and it is
   deliberate.
3. **The table bezel was a size behind every card beside it.** `FundTable.module.css` hardcoded
   `--be-squircle-lg` + `--be-shell-pad`, with no `lg:` step, while `Card` goes to `--be-squircle-xl` +
   `--be-shell-pad-lg` at 1024px. The table only renders at 1024px and above, so it was *always*
   mismatched with the cards on the same page. It now composes `SHELL` and mirrors `CARD_BASE`'s
   `calc()` radius, so the two bezels agree.
4. **Dead reduced-motion rule.** `@media (prefers-reduced-motion: reduce) { .row { transition: none } }`
   restated what `ui/styles/base.css` already forces globally. Deleted per the conversion spec.
5. **`composes:` + `aria-pressed` said the same thing twice.** `.sortActive` and `.headButtonActive`
   duplicated their base rule and sat on elements that already carried a correct `aria-pressed`. Both
   active states now derive from the `aria-pressed:` variant, so the class can no longer drift from the
   attribute a screen reader reads. Cascade order was checked in the built stylesheet, not assumed:
   `.text-fg-muted` at byte 31890 precedes `.aria-pressed\:text-fg-inverse` at 53295, and
   `.border-rule-strong` at 20448 precedes `.aria-pressed\:border-ink` at 53090, so the pressed state
   wins.
6. `.hint` in `Sip.module.css` used `--be-fg-muted` where the shared `FIELD_HINT` uses `--be-fg-faint`.
   Kept as `SIP_HINT` rather than silently re-toned; worth a decision later, not during a migration.

## Verified — TESTED

- `npx tsc -p tsconfig.json --noEmit` — zero errors in `features/{funds,sip,payments}` and in
  `ui/recipes/`. (Other, concurrently-converted directories were reporting errors while this ran.)
- `npx eslint src/features/funds src/features/sip src/features/payments src/ui/recipes` — clean.
- `npx vitest run` — 8 files, 110 tests pass, including `ui/tokens/safeArea.test.ts`.
- `npx vite build` — succeeded. The emitted stylesheet was then read to confirm the utilities this
  batch introduced actually generate rules rather than nothing:
  `.aria-pressed\:{border-ink,bg-ink,text-fg,text-fg-inverse}`,
  `.group-last\:border-b-0:is(:where(.group):last-child *)`,
  `.bg-sand\/32` → `color-mix(in oklab, var(--be-sand) 32%, transparent)`, `.bg-sand\/22`,
  `size-[9px]`, `max-w-[64ch]/[60ch]/[68ch]`, `md:grid-cols-4`, `border-rule-strong`, `text-2xs`.
  `.border-b` (byte 17805) precedes `.group-last\:border-b-0` (46647), so the last table row still
  loses its bottom rule.
- `grep -rn 'styles\.'` over the three directories: nothing. `grep -rn 'font-mono'`: nothing.
  `grep -rn 'env(safe-area'`: nothing.

## Not verified — UNVERIFIED

A green typecheck and a green build say nothing about whether these screens render correctly. No
browser has opened any of them. Specifically unproven:

- That the card/table split flips at exactly 1024px in a real viewport, and that the table's four
  columns do not overflow at 1024px.
- The sort pills' pressed contrast (`bg-ink` on `text-fg-inverse`), the table row hover tint
  (`bg-sand/22`), and the `SortGlyph` alignment inside the header buttons.
- The SIP summary grid change described in defect 2.
- The payment status screen's polling row while a payment is genuinely open — that needs a real
  in-progress PhonePe payment, not a fixture.

To confirm, on the VPS:

```
cd frontend_stack_ts && npx tsc -p tsconfig.json --noEmit && npm run lint && npm test && npm run build
```

then read, at 390px and 1512px: `/funds`, `/funds/<fundId>`, `/sips`, `/sips/<sipPlanId>`,
`/funds/<fundId>/invest/sip`, `/activity/payments/<paymentId>`.

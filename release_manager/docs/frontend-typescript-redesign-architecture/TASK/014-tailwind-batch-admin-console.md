# 014 — Tailwind v4 conversion: the admin console

One of four parallel, disjoint slices of the remaining CSS-module conversion in
`frontend_stack_ts/src/features/`. This slice owned `features/admin/` and nothing else. It was a
single 354-line stylesheet, `admin/shared/Admin.module.css`, read by 29 files across thirteen admin
domains — the widest blast radius of the four slices and the only one where every screen shares one
vocabulary.

## Why the constants went into `ui/recipes/admin.ts`

The other slices put feature-local vocabulary in `<feature>/<feature>.recipe.ts`. That would have been
wrong here. `Admin.module.css` was not the stylesheet of one feature; it was the stylesheet of a
console, consumed by `mandates/`, `refunds/`, `payments/`, `emails/`, `app-config/`, `applications/`,
`audit/`, `fund-aum/`, `client-values/`, `receipts/`, `users/`, `content/`, `overview/`, `funds/` and
`shared/`. A recipe file under any one of those would have made the other thirteen import across a
sibling feature boundary. It is genuinely shared vocabulary, so it lives with the shared vocabulary.

## What it had to preserve

These are money screens, and D-029 says money is never `font-mono`. The admin stylesheet made that
easy to get wrong, because it had a class literally called `.mono` that was **not** monospace — it was
`--be-font-numeric` with `tabular-nums lining-nums`, i.e. the money treatment under a misleading name,
and it carried the rupee figures on the mandate list and mandate detail screens. It is now
`ADMIN_FIGURE`, which composes `MONEY_BASE`. The one real monospace class, `.code`, only ever carried
identifiers: merchant order ids, provider references, SES message ids, request ids, entity ids,
content keys, SHA-256 digests and preview basis hashes. All 22 of its call sites were re-read
individually to confirm none of them is an amount.

`MandateListScreen` and `MandateDetailScreen` format rupees with a local `Intl.NumberFormat`
(`maximumFractionDigits: 0`) rather than `MoneyValue`. That was left alone: swapping in `MoneyValue`
would have changed the rendered text, which is out of scope for a styling migration. It is noted as a
follow-up, not fixed here.

## Converted

Twenty-nine files, all previously importing `~/features/admin/shared/Admin.module.css`:

| Directory | Files |
| --- | --- |
| `admin/shared/` | `AdminTable.tsx` |
| `admin/overview/` | `OverviewScreen.tsx` |
| `admin/applications/` | `ApplicationQueueScreen.tsx`, `ApplicationDetailScreen.tsx` |
| `admin/users/` | `UserDirectoryScreen.tsx`, `UserDetailScreen.tsx`, `UserLoginEventsScreen.tsx` |
| `admin/funds/` | `FundListScreen.tsx`, `FundCreateScreen.tsx`, `FundWorkspaceScreen.tsx`, `FundHoldingsScreen.tsx`, `FundTermsForm.tsx` |
| `admin/fund-aum/` | `AumOverviewScreen.tsx`, `FundAumScreen.tsx`, `FundAumHistoryScreen.tsx`, `CollectiveAumGrowthScreen.tsx` |
| `admin/client-values/` | `ClientPositionsScreen.tsx`, `IndividualClientGrowthScreen.tsx`, `CollectiveClientGrowthScreen.tsx` |
| `admin/receipts/` | `FundReceiptQueueScreen.tsx`, `FundReceiptDetailScreen.tsx` |
| `admin/refunds/` | `RefundQueueScreen.tsx` |
| `admin/payments/` | `PaymentEvidenceScreen.tsx` |
| `admin/mandates/` | `MandateListScreen.tsx`, `MandateDetailScreen.tsx` |
| `admin/emails/` | `EmailDeliveriesScreen.tsx` |
| `admin/audit/` | `AuditLogScreen.tsx` |
| `admin/content/` | `FaqListScreen.tsx` |
| `admin/app-config/` | `AppConfigBuilderScreen.tsx` |

Deleted: `admin/shared/Admin.module.css`.

Added: `ui/recipes/admin.ts` — 18 constants, the ones that are genuinely admin-console vocabulary:

`ADMIN_CONTROLS`, `ADMIN_FILTER_ROW`, `ADMIN_FILTER`, `ADMIN_META`, `ADMIN_FORM_GRID`,
`ADMIN_SUMMARY_GRID`, `ADMIN_FIGURE`, `ADMIN_QUEUE_COUNT`, `ADMIN_LABEL`, `ADMIN_CODE`,
`ADMIN_TABLE_WRAP`, `ADMIN_TABLE_INNER`, `ADMIN_TABLE`, `ADMIN_HEAD_CELL`, `ADMIN_BODY_ROW`,
`ADMIN_CELL`, `ADMIN_NUMERIC`, `ADMIN_CELL_LINK`, `ADMIN_JSON_AREA`.

Nine more constants were written, then deleted again after re-reading `ui/recipes/` at the end of the
slice: `ACTION_ROW`, `STACK_LG`, `ROW_BETWEEN_BASELINE`, `CARD_LINK`, `ITEM_TITLE`, `ENTRY_TEXT`,
`PROSE_SM`, `META_TEXT` and `REFERENCE_TEXT` had all been added to the shared layer by the three
sibling slices while this one was running, with byte-identical or near-identical bodies. The admin
screens now import those from `layout.ts`, `surface.ts`, `datalist.ts` and `text.ts` instead. See the
decision log entry for why this had to be a second pass rather than a first-pass lookup.

Nothing was added to an existing shared recipe file by this slice.

## Defects found in the original CSS

- **Four dead rules.** `.list`, `.hint`, `.error` and `.previewTotals` had no call site anywhere in
  the 29 importers. Dropped rather than converted.
- **Two exact duplicate rules.** `.counts` and `.meta` had identical declaration blocks; so did
  `.code` and `.basis`. Each pair is now one constant.
- **A raw colour literal.** `.jsonArea` set `color: #f1ede4`, the only hard-coded hex in the file and
  a direct breach of the token rule. It is now `text-parchment`, matching how `shellAdmin.ts` already
  colours text on a dark ground.
- **A misnamed class.** `.mono` was the numeric/tabular money treatment, not monospace. Anything
  reading the class name would have assumed the opposite.
- **Three `*Active` classes that duplicated an ARIA attribute.** `.filterActive` was selected by
  `active ? styles.filterActive : styles.filter` on four elements that already carried a correct
  `aria-pressed`. All four now derive from the `aria-pressed:` variant, so the class cannot drift from
  what a screen reader reads. Cascade order was checked in the emitted CSS, not assumed:
  `aria-pressed:text-fg-inverse` lands after `hover:text-fg` at equal specificity, so hovering a
  pressed chip keeps the inverse text and does not go dark-on-dark.
- **`.select` and `.textarea` were hand-rolled duplicates** of `SELECT_BASE` and `TEXTAREA_BASE` in
  `field.ts`, on the two raw `<select>` and two raw `<textarea>` elements in `FundTermsForm`. They now
  use the recipes. The elements stay raw — swapping them for the `Select`/`Textarea` primitives would
  have changed the DOM.

## Verified — TESTED

- `npx tsc -p tsconfig.json --noEmit` — zero errors.
- `npx eslint src/features/admin src/ui/recipes` — clean.
- `npx vitest run` — 8 files, 110 tests pass.
- `npx vite build` — succeeded, and the emitted stylesheet was read to confirm the less common
  utilities actually generate rules rather than being silently dropped:
  `aria-pressed\:bg-ink[aria-pressed=true]`, `.sm\:\[\&\>\*\]\:flex-1>*{flex:1}`,
  `last\:\[\&\>td\]\:border-b-0:last-child>td`, `min-width:42rem`, `tab-size:2`,
  `hover:underline-offset-[3px]`.
- `grep -rn 'styles\.' src/features/admin` — nothing.
- `grep -rn 'font-mono' src/features/admin` — nothing; the mono treatment reaches the screens only
  through `ADMIN_CODE` and `REFERENCE_TEXT`, and every one of those call sites was listed and read.

## Not verified — UNVERIFIED

No browser has rendered any of the 29 screens. Specifically unobserved:

- The `AdminTable` horizontal scroll at 390px. The table keeps `min-width: 42rem` inside an
  `overflow-x-auto` bezel, so on a phone it scrolls sideways. That was the pre-existing behaviour and
  it was preserved, but it has never been seen on a device.
- The pressed-filter contrast (`bg-ink` / `text-fg-inverse`) and the row hover tint.
- `ADMIN_JSON_AREA` in `AppConfigBuilderScreen`: light-on-espresso monospace, and its focus ring
  switching from hairline to gold.
- The `sm:` step in `ADMIN_CONTROLS`, where the search input and filter row become equal-width
  columns at 480px.
- Reused-recipe substitutions that are close but not pixel-identical to what they replaced:
  `PROSE_SM` for `.note` (64ch/`leading-normal` where `.note` was 68ch/`leading-relaxed`),
  `META_TEXT` for `.faint` (adds an explicit `leading-normal`), and `REFERENCE_TEXT` for `.slug`
  (adds `tracking-[0.06em]`). Thirteen, fourteen and one call sites respectively.

On the VPS, after deploy:

```
cd frontend_stack_ts && npx tsc -p tsconfig.json --noEmit && npm run lint && npm test && npm run build
```

then read, at 390px and at 1512px: `/overview`, `/applications`, `/users`, `/funds`, `/funds/new`,
`/funds/<fundId>`, `/funds/<fundId>/holdings`, `/aum`, `/aum/collective`, `/funds/<fundId>/aum`,
`/client-values/individual`, `/client-values/collective`, `/receipts`, `/refunds`, `/payments`,
`/mandates`, `/emails`, `/audit`, `/content/faqs`, `/app-config`.

# 09 — Design System / Component Plan

Only what this application needs. The legacy frontend has roughly 40 components spread over
three packages with two form fields, three skeletons, three page headers and three overlays.
This is 24 primitives and 14 application components, each with exactly one implementation.

Every component ships as `Name.tsx` + `Name.module.css` in `src/ui/primitives/` or
`src/ui/patterns/`. No component declares a colour, spacing value, radius, font, z-index or
safe-area value — all come from tokens.

## Foundations

### Colour

Ported from the existing token layer, which is already coherent.

```
Surface     --be-ivory #F7F7F5   --be-surface   --be-surface-raised   --be-surface-sunken
Ink         --be-ink   --be-ink-muted   --be-ink-subtle   --be-ink-inverse
Line        --be-line  --be-line-strong
Brand       --be-slate (primary)   --be-gold (accent only)
Signal      --be-positive  --be-negative  --be-warning  --be-info
            each with -bg and -border variants
Focus       --be-focus-ring
```

`#F7F7F5` must stay byte-identical in four places: `index.html`'s inline style, `#root` in
`index.css`, `values/colors.xml` `launchBackground`, and `--be-ivory`.

**Signal colours are reserved for money and risk state** (`PRODUCT.md`, stated as product
policy). Gold is a brand accent only. A green success toast is a violation — use neutral
confirmation.

### Typography

Three self-hosted families, eight explicit `@font-face` rules, woff2 only, explicit
`unicode-range`, `latin` + `latin-ext` only. `latin-ext` is **required** — the rupee sign
U+20B9 lives in its range.

```
--be-font-ui       Instrument Sans Variable   400–700
--be-font-display  Fraunces Variable          100–900   page titles, brand moments
--be-font-mono     JetBrains Mono             400, 500  money, ids, codes
```

Never import the fontsource CSS barrels — they pull cyrillic, greek and vietnamese subsets plus
woff fallbacks, and the Android build packages **every emitted asset** into the APK.
`check-android-dist.mjs` fails on both.

```
--be-text-xs   12 / 16      --be-text-lg   18 / 26
--be-text-sm   13 / 18      --be-text-xl   22 / 30
--be-text-base 15 / 22      --be-text-2xl  28 / 36   display
--be-text-md   16 / 24      --be-text-3xl  36 / 44   display, ≥ lg only
```

Money always renders in `--be-font-mono` with tabular figures, so columns align and a changing
value does not shift layout.

### Spacing, radius, elevation, z-index

```
--be-space-1  4     --be-space-5  20    --be-space-9  48
--be-space-2  8     --be-space-6  24    --be-space-10 64
--be-space-3  12    --be-space-7  32
--be-space-4  16    --be-space-8  40

--be-radius-sm 6   --be-radius-md 10   --be-radius-lg 14   --be-radius-full 999px

--be-elev-1  subtle card lift
--be-elev-2  dropdown, popover
--be-elev-3  dialog, sheet

--be-z-header 100   --be-z-nav 100   --be-z-sticky 200
--be-z-overlay 900  --be-z-toast 1000
```

**No component may use a raw z-index literal.** The legacy `cssContract.test.js` already
enforces this and the rule is worth keeping.

## Primitives — 24

| Component | Purpose | Variants | Responsive | Used by |
|---|---|---|---|---|
| `Button` | the single action element | `primary`, `secondary`, `ghost`, `danger` × `sm`, `md`, `lg`; `loading`, `disabled`, `fullWidth`, `iconOnly` | min-height 44 below `lg`, 40 at `md`, 36 at `lg` | everywhere |
| `IconButton` | icon-only action with a required `aria-label` | same tones | 44×44 below `lg` | headers, rows, sheets |
| `Input` | text, email, password, number | `invalid`, `disabled`, `readOnly`, `prefix`, `suffix`, `showToggle` | full width, 44 height below `lg` | forms |
| `AmountInput` | rupee entry producing `Paise` | `min`, `max`, `presets` | mono font, large below `lg` | lumpsum, SIP, growth, corrections |
| `Textarea` | multi-line | `invalid`, `rows`, `maxLength` | auto-grow to a cap | support ticket, notes |
| `Select` | native `<select>`, styled | `invalid`, `placeholder` | native picker on mobile | filters, forms |
| `Checkbox` | boolean | `indeterminate`, `invalid` | 44 hit area below `lg` | consent, selection |
| `Radio` / `RadioGroup` | one of several | `orientation` | stacks below `md` | SIP mode, growth direction |
| `Switch` | immediate toggle | `disabled` | 44 hit area | device security |
| `FormField` | label + control + hint + error, **one implementation** | `required`, `error`, `hint` | label above below `lg`, inline at `lg` | every form |
| `Label` | standalone label | `size` | — | tables, detail rows |
| `Badge` | small status chip | `neutral`, `positive`, `negative`, `warning`, `info` × `subtle`, `solid` | — | everywhere |
| `Card` | the surface container | `padding`, `interactive`, `elevated` | padding 16 / 20 / 24 | everywhere |
| `Divider` | separator | `horizontal`, `vertical`, `inset` | — | lists, sections |
| `Avatar` | user initial or monogram | `sm`, `md`, `lg` | — | user cells, fund cards, profile |
| `Tooltip` | supplementary text | placement | **tap-to-toggle popover below `lg`**, hover at `lg` | admin help |
| `Spinner` | indeterminate progress | `sm`, `md` | — | pending buttons only |
| `Skeleton` | loading placeholder, **one implementation** | `text`, `block`, `circle`, `row` — dimensions via **props**, never class names | inherits container width | every loading state |
| `Alert` | inline persistent message | `info`, `warning`, `error`, `success` | — | forms, screens |
| `Toast` | transient confirmation | `neutral`, `error` | bottom above nav + safe area; bottom-right at `lg` | mutations |
| `Dialog` | modal, centred | `sm`, `md`, `lg` | **becomes `Sheet` below `lg`** | confirmations, editors |
| `Sheet` | bottom sheet | `auto`, `half`, `full`; drag-to-dismiss | `max-height: 92dvh`, safe-bottom padding | mobile overlays |
| `Menu` | action list from a trigger | `align` | becomes a `Sheet` below `lg` | row actions, profile |
| `Tabs` | in-page view switch | `underline`, `pill` | horizontal scroll below `md` | activity, fund periods |

Notes on specific decisions:

- **`AmountInput` is a primitive, not a pattern**, because it owns the `Paise` boundary. It is
  the only place rupee input becomes paise, and it must reject anything that is not a positive
  safe integer after conversion. Six screens depend on it and every one of them handles money.
- **`Skeleton` takes dimensions as props.** The legacy `.apk-skel--h-180`, `--h-200`, `--h-240`
  across three stylesheets is exactly what this prevents.
- **`Dialog` and `Sheet` are the only two overlays.** Both use one shared `useOverlayBehavior`
  hook for Escape, Android Back, scroll lock and focus trap, and both register with the overlay
  stack so Back closes the topmost. The legacy code got the hook right and triplicated the
  markup.
- **`Tooltip` must be tappable below `lg`.** A hover-only tooltip is inaccessible on a
  touchscreen, and admin uses tooltips for the help text on money operations.
- No `Pagination` primitive. The API has no offset and no total count — pagination is
  "Load more" inside `DataList`.
- No `Table` primitive. Tabular rendering is a mode of `DataList`, because the same data must
  render as cards below `lg`.

## Application components — 14

| Component | Purpose | Variants | Responsive | Used by |
|---|---|---|---|---|
| `Page` | the **only** owner of content width and horizontal padding | `default` 960, `wide` 1280, `form` 560 | pad 16 / 24 / 32; `max(pad, safe-left/right)` | every screen |
| `PageHeader` | the **only** `<h1>` on a page, plus eyebrow, description, actions | `actions`, `back`, `eyebrow` | actions stack below `sm` | every screen |
| `Section` | titled content group | `title`, `description`, `actions`, `collapsible` | collapsible below `lg` on admin detail | every screen |
| `ContentGrid` | responsive grid | `columns: 2 \| 3 \| 4` | 1 / 2 / n | dashboards, card lists |
| `FormSection` | grouped fields with one description | `columns: 1 \| 2` | 1 column below `lg` | all forms |
| `AsyncBoundary` | the **single** loading / empty / error / offline policy | `skeleton`, `empty`, `onRetry` | — | **every data read** |
| `EmptyState` | nothing here, with a next action | `icon`, `title`, `description`, `action` | — | lists |
| `ErrorState` | something failed, with recovery | `variant: offline \| timeout \| server \| forbidden \| notFound \| notConfigured`; shows `requestId` | — | via `AsyncBoundary` |
| `DataList` | the **only** tabular renderer | `columns`, `rows`, `onRowClick`, `rowActions`, `selectable`, `loadMore` | **cards below `lg`, table at `lg`** | every list |
| `StatCard` | one headline figure | `label`, `value`, `delta`, `tone`, `href` | 2 / 3 / 4 per row | dashboards |
| `MoneyValue` | render `Paise` | `size`, `signed`, `tone`, `mono` | — | everywhere money appears |
| `StatusBadge` | map a backend status to label + tone, exhaustively | domain: `payment`, `order`, `sip`, `mandate`, `verification`, `account`, `delivery` | — | everywhere status appears |
| `DetailRow` | label / value pair | `mono`, `copyable`, `tone` | stacks below `sm` | detail screens, sheets |
| `ConfirmDialog` | destructive or financial confirmation, optionally requiring a typed reason | `tone`, `reasonRequired`, `confirmLabel` | `Sheet` below `lg` | cancel SIP, close user, cancel mandate, refunds |

### `AsyncBoundary` is the most important component here

Every data read goes through it. It is what makes `rules.md` §4 structurally true — an outage,
a timeout and an empty collection cannot look alike, because one component decides. The legacy
frontend has `AsyncState` in `shared/`, **which admin does not use at all**, so fourteen admin
screens hand-roll their own retry banner.

### `DataList` is what replaces four legacy approaches

Today: admin's `DataTable.jsx` (178 lines, used by exactly one screen), raw
`<table class="adm-table">` with `data-label` attributes in every other screen, shared's unused
cell components, and card lists on the client. One component, two rendering modes, one
definition of a column:

```ts
interface Column<Row> {
  key: string
  header: string
  render: (row: Row) => ReactNode
  align?: 'start' | 'end'
  mono?: boolean
  hideBelow?: 'md' | 'lg'      // dropped from card mode, and from narrow tables
  primary?: boolean            // becomes the card title
  secondary?: boolean          // becomes the card subtitle
}
```

Card mode renders `primary` and `secondary` as a heading pair and the rest as `DetailRow`s.
Table mode renders a real `<table>` with a sticky header. `loadMore` is a cursor callback —
there is no page number, because the API has no offset.

## Feature components — per module, not shared

These live in `features/*` and are not part of the design system. Listed so the inventory is
complete.

| Module | Components |
|---|---|
| `funds` | `FundCard`, `FundCardList`, `FundTable`, `FundHeroSummary`, `PerformanceChart`, `HoldingsDonut`, `SectorLegend`, `RatioTable`, `DisclosureList`, `SipCalculator` |
| `portfolio` | `PortfolioSummary`, `PositionRow` |
| `activity` | `LedgerRow`, `PaymentQueueRow`, `ActivityDetailSheet` |
| `orders` | `LumpsumForm`, `RiskConsent` |
| `payments` | `PaymentStatusPanel`, `CheckoutRedirectNotice`, `PendingPaymentRecovery` |
| `sip` | `SipStartForm`, `SipModeSelector`, `SipPlanCard`, `SipScheduleSummary`, `AutoPayStatusPanel`, `AutoPaySetupNotice` |
| `email-verification` | `OtpInput`, `ResendCountdown`, `VerificationStatePanel` |
| `device-security` | `PinPad`, `BiometricToggle`, `SecurityWarningNotice` |
| `app-update` | `AppUpdateGate`, `DownloadProgress` |
| `admin/funds` | `FundProfileForm`, `FundVersionPanel`, `HoldingsEditor`, `LifecycleControl` |
| `admin/fund-aum` | `AumInitializeForm`, `AumGrowthForm`, `AumSnapshotHistory`, `CorrectionForm` |
| `admin/client-values` | `IndividualGrowthForm`, `CollectiveGrowthPreview`, `PositionLookup` |
| `admin/applications` | `ApplicationRow`, `ApplicantDetailPanel`, `DecisionActions`, `CsvExportButton` |
| `admin/mandates` | `MandateTracePanel`, `SetupAttemptList`, `CollectionAttemptList`, `OperatorActions` |
| `admin/receipts` | `ReceiptQueueRow`, `AcknowledgeForm` |
| `admin/app-config` | `ConfigDraftEditor`, `ComponentVisibilityPanel`, `PresetEditor`, `PublishBar` |

Two reusable patterns worth naming because they encode a backend protocol:

- **`PreviewCommitPanel`** — used by collective AUM growth and collective client growth. Holds
  the preview result and its `basisHash`, sends the hash on commit, and **on `STATE_CONFLICT`
  clears the preview and requires a new one**. The underlying data moved; a blind retry would
  commit against a stale basis. The guard test
  `investment-architecture.guard.test.ts` enforces the server half of this protocol.
- **`OptimisticVersionForm`** — used by every admin PATCH requiring `If-Match`, and by fund
  receipt acknowledgement (which carries `expectedVersion` in the body instead). Holds the
  version from the last read, sends it, and on `STATE_CONFLICT` refetches and re-presents rather
  than retrying. The legacy `FundReceiptScreen` gets this right; it is worth naming so it is not
  reinvented per screen.

## Charts — hand-built, roughly 300 lines

| Component | Purpose | Notes |
|---|---|---|
| `LineChart` | fund performance over a period | optional benchmark series |
| `AreaChart` | portfolio value over time | gradient fill from tokens |
| `DonutChart` | holdings and sector allocation | must **reflow** — no fixed pixel size beside a `min-width` legend |
| `Sparkline` | trend inside a fund card | no axes, no labels |
| `chartMath.ts` | scales, ticks, path building, percentage helpers | pure functions, unit-testable |

Pure SVG, tokens for colour, no library. A charting dependency would consume most of the 320 kB
chunk budget on its own. `DonutChart` must not repeat the legacy defect at
`fund-detail.css:226`/`:253`, where a fixed 160px SVG sits beside a 180px minimum-width legend
column so neither can reflow.

## What is deliberately not built

| Not built | Reason |
|---|---|
| `Accordion` | `Section collapsible` covers it |
| `Breadcrumbs` component | admin `PageHeader` renders a trail from the route manifest |
| `Pagination` | no offset and no total count in the API |
| `Table` | a mode of `DataList` |
| `Popover` | `Menu` and `Tooltip` cover every case |
| `Stepper` | one multi-step flow, and it is route-based |
| `DateRangePicker` | two native `<input type="date">` fields |
| `Autocomplete` | debounced `Input` + `DataList`, which is what admin search already is |
| `Drawer` | `Sheet` from the side is `Sheet` with a placement prop; the legacy admin `Drawer` served exactly one screen |
| `ThemeProvider` / dark mode | the product is light-only, `forceDarkAllowed=false` in the Android theme, and `color-scheme: light` in the HTML |
| A second form field | the legacy duplication is the whole point of this document |
| A second skeleton | same |
| A second page header | same |
| A third overlay | same |

## Component contract tests

Ported from the legacy scan-based contracts, which are cheap and catch real defects:

| Test | Asserts |
|---|---|
| token ownership | no colour, spacing, radius, font or z-index literal outside `ui/tokens/` |
| safe-area | only `tokens-core.css` reads `env(safe-area-inset-*)`; nothing redeclares `--be-safe-*` |
| hit area | every interactive primitive declares a min-height ≥ 44px below `lg` |
| single `h1` | only `PageHeader` renders `<h1>` |
| breakpoint ownership | no media query outside `ui/` and `shells/`; no breakpoint literal in `.ts`/`.tsx` |
| container ownership | no `max-width` on a content container outside `Page` |
| no motion library | no `gsap` import anywhere |
| exhaustive status | `StatusBadge` and `domain/status.ts` cover every union member, enforced by `assertNever` at compile time |
| bundle contract | asset budgets, font subsets, no cross-target asset, acyclic chunk graph |

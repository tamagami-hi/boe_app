# 08 — Responsive Web / Mobile Layout System

This document is deliberately concrete. The legacy frontend's defining failure is that layout
decisions were made independently on every screen; this specifies them once.

## The problem being solved

Measured from the legacy source:

- Three "small phone" breakpoints in two units that do not coincide — 430px, 24rem (384px),
  480px.
- **No tablet or desktop breakpoint anywhere in the client CSS**, and that stylesheet is what
  the browser build serves.
- Eight page-width containers spanning 420–780px, seven of them in one file.
- Four mobile thresholds in admin (JS 768, CSS 768 twice, 1100, 40rem), one of them styling a
  root class no component renders any more.
- Fixed pixel dimensions that cannot reflow — a 160px donut beside a 180px minimum-width
  legend, two different fixed chart-rail heights on one screen, skeleton heights encoded as
  class names in three files.
- Four class vocabularies, two of them inside the same element.

## Breakpoints — one set, tokens only

```css
--be-bp-sm:  480px;   /* small phone           */
--be-bp-md:  768px;   /* large phone / tablet  */
--be-bp-lg: 1024px;   /* laptop — shell switch */
--be-bp-xl: 1440px;   /* wide desktop          */
```

Rules:

1. **Four breakpoints. No fifth.** A component needing another has a layout problem, not a
   breakpoint problem.
2. **`px` only.** The legacy `40rem` query moved when the user changed their root font size
   while every other query stayed put.
3. **`min-width` only.** Mobile-first, so the base styles are the APK's styles.
4. **`--be-bp-lg` (1024px) is the only shell switch.** Above it: admin shows a sidebar, client
   shows top navigation. Below it: both use bottom navigation.
5. The JavaScript breakpoint constant is derived from the same token, read once:
   `useBreakpoint()` returns `'sm' | 'md' | 'lg' | 'xl'` from a single
   `matchMedia` set. There is no second numeric literal in TypeScript. The legacy
   `MOBILE_BREAKPOINT = 768` in `AdminShell.jsx:18` next to CSS `768px` in two other files is
   exactly the drift this prevents.
6. Capability queries stay separate from size queries: `@media (hover: hover) and (pointer: fine)`
   for hover affordances, `@media (prefers-reduced-motion: reduce)` for motion. A large screen
   is not a mouse, and a small screen is not a touchscreen.

## Content width — one container

```css
--be-content-max:       960px;   /* default reading/content column */
--be-content-max-wide: 1280px;   /* admin data tables              */
--be-content-max-form:  560px;   /* single-column forms            */
--be-page-pad-x:      var(--be-space-4);   /* < md */
--be-page-pad-x-md:   var(--be-space-6);   /* ≥ md */
--be-page-pad-x-lg:   var(--be-space-8);   /* ≥ lg */
```

Only `Page` applies these. **No screen may set its own `max-width` or horizontal padding.**
That single rule removes eight competing container widths.

```tsx
<Page width="default" | "wide" | "form">
```

**Amended (D-059, D-060).** The three caps are now fluid clamps whose floors are the fixed values
above, so client content grows to 1600px and admin content to 2400px while nothing below a 1171px
viewport changes:

```css
--be-content-max:      clamp(60rem, 82vw, 100rem);
--be-content-max-wide: clamp(80rem, 90vw, 150rem);
--be-content-max-form: 35rem;
--be-page-pad-x-lg:    clamp(var(--be-space-7), 2vw, var(--be-space-10));
```

The "no screen may set its own `max-width`" rule is also refined, because it was already violated in
eight places when it was written. **Page width** — the width of the content column — still belongs to
`Page` alone, and is now enforced more strictly: `STATE_PANEL` no longer re-declares `max-w-content`. A
**measure** — readable line length, or the width a control or figure should be regardless of the page —
belongs to the component, and must be either a `ch` value or an `lg:`/`xl:`-gated cap so it can never
reach the phone. See D-060 for the list.

## Safe area — port the contract verbatim

This is the one part of the legacy styling layer that is correct, and every constraint in it
exists because of a defect that shipped.

`ui/tokens/tokens-core.css` is the **sole legal owner**:

```css
--be-safe-top:    var(--safe-area-inset-top,    env(safe-area-inset-top, 0px));
--be-safe-right:  var(--safe-area-inset-right,  env(safe-area-inset-right, 0px));
--be-safe-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
--be-safe-left:   var(--safe-area-inset-left,   env(safe-area-inset-left, 0px));
```

Three layers, in this order, for this reason:

1. `--safe-area-inset-*` — injected in dp on `document.documentElement` by Capacitor 8's
   `SystemBars` plugin, but **only on Android 15+ (VANILLA_ICE_CREAM)** where a Chromium bug
   makes `env()` wrong, and **only when the viewport meta contains the literal
   `viewport-fit=cover`** (the plugin greps for it). Re-applied on configuration *and keyboard*
   changes.
2. `env(safe-area-inset-*)` — everywhere else: iOS, browsers, Android 14 and below.
3. `0px`.

A ported `safeArea.test.ts` walks every `.css` under `src/`, strips comments, and asserts:

- `tokens-core.css` declares all four edges with the exact literal string.
- **No other stylesheet reads `env(safe-area-inset-`.**
- **No other stylesheet redeclares `--be-safe-*`** — import-order shadowing is how the legacy
  client sheet once silently ignored Capacitor's injected values.
- `index.html` matches `/name="viewport"[^>]*viewport-fit=cover/`.
- `index.html` does **not** contain `user-scalable=no`.

Failure modes, all of them silent:

| Mistake | Result |
|---|---|
| Drop `viewport-fit=cover` | Capacitor's injection stops (it greps the meta) **and** `env()` is unreliable on Android 15+. All four tokens fall to `0px`. The header slides under the status bar and the bottom nav under the gesture bar. **No error anywhere** |
| Read only `env()` | Wrong values on Android 15+ — the exact bug this chain exists for |
| Read only `--safe-area-inset-*` | Zero insets on Android 14 and below, on iOS, and in every browser build |
| Redeclare `--be-safe-*` in a page stylesheet | Shadows the contract depending on CSS import order |
| Ignore `--be-safe-left/right` | Content behind a camera cutout in landscape, or under a curved display edge |

Consumers, and nowhere else:

```css
.header      { padding-top: calc(var(--be-space-3) + var(--be-safe-top)); }
.bottomNav   { height: calc(var(--be-nav-h) + var(--be-safe-bottom));
               padding-bottom: var(--be-safe-bottom);
               padding-left: var(--be-safe-left);
               padding-right: var(--be-safe-right); }
.page        { padding-left: max(var(--be-page-pad-x), var(--be-safe-left));
               padding-right: max(var(--be-page-pad-x), var(--be-safe-right));
               min-height: 100dvh; }
.pageContent { padding-bottom: calc(var(--be-nav-h) + var(--be-safe-bottom) + var(--be-space-6)); }
.stickyBar   { bottom: calc(var(--be-nav-h) + var(--be-safe-bottom)); }
.sheet       { max-height: 92dvh; padding-bottom: var(--be-safe-bottom); }
.toast       { bottom: calc(var(--be-space-8) + var(--be-safe-bottom)); }
```

`100dvh`, never `100vh` — `vh` does not account for the Android URL bar or the IME.

## Android constraints — non-negotiable

`targetSdkVersion 36` makes edge-to-edge **mandatory**; Android 15+ removed the opt-out. Bars
are visible, not immersive: the app draws under them and reserves space in CSS.

Four separate mechanisms cooperate, and all four must be present:

| # | Mechanism | Where |
|---|---|---|
| 1 | `viewport-fit=cover` | `index.html` |
| 2 | The `--be-safe-*` fallback chain | `tokens-core.css` |
| 3 | `SystemBars.setStyle({style})` — icon appearance | `SystemBarsController` |
| 4 | `SystemChrome.setBarBackground({color})` — the custom plugin painting behind transparent bars | `SystemBarsController` |

Mechanism 4 needs explaining because it is unusual. `values/styles.xml` sets
`statusBarColor` and `navigationBarColor` to `@android:color/transparent` with
`windowDrawsSystemBarBackgrounds=true`. `SystemChromePlugin.setBarBackground` then sets the
window background drawable, the decor-view background, **and walks every `View` ancestor of the
WebView**, setting each background colour. Transparent bars plus a coloured window behind them
is what makes the bars appear to be the app colour. The plugin does **not** set bar colours
directly and does **not** report insets.

Note also `SystemBars` style semantics: `'LIGHT'` means *light appearance*, i.e. **dark icons**
(`setAppearanceLightStatusBars(!style.equals("DARK"))`). BOE is light-only, so `LIGHT` is
correct; `DARK` would give invisible white icons on ivory.

Chrome is managed as a **stack**, not a setter:

```ts
const pop = pushSystemChrome({ style: 'DARK', background: '#111111' })
// on sheet close
pop()
```

so a full-screen sheet can darken the bars and restore them exactly. Validation **throws** on a
style other than `LIGHT`/`DARK` or a background not matching
`/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/`. Chrome is re-applied on
`platformLifecycle.onResume`, because Android can reset window appearance across resume.

**One colour, five places, byte-identical.** `#F4F1E9` must be the same in
`index.html`'s inline style, `index.html`'s `theme-color`, `values/colors.xml`
`launchBackground`, `DEFAULT_BAR_BACKGROUND` in `src/platform/systemChrome.ts`, and whatever
`--be-bg` resolves to in the token layer. `src/ui/styles/base.css` paints `#root` with
`var(--be-bg)` and must never restate a literal. Drift produces a visible flash during the
native-splash → WebView → React handoff.

**Amended (D-034).** This contract previously pinned `#F7F7F5` (`--be-ivory`), but every real
screen — the auth layout and both app shells — paints `--be-parchment-2` (`#F4F1E9`). The
contract therefore kept the launch surfaces consistent with each other while still mismatching
the running app, which produced two visible defects: a launch flash, and on Android a coloured
seam where the system-bar insets are painted with the window background. `--be-bg` now aliases
`--be-parchment-2`, the shells consume `bg-bg` rather than `bg-parchment-2`, and
`src/platform/launchColour.test.ts` enforces all five places automatically.

### Keyboard

`android:windowSoftInputMode="adjustResize"` plus `100dvh` layout. **No `@capacitor/keyboard`
dependency.** The manifest comment records why: without `adjustResize`, Android 12+ defaults can
leave a focused input behind the bottom nav or a sticky action bar with no way to scroll to it,
and Capacitor's inset listener is written against `adjustResize`.

Requirements:

- Any focused input must scroll into view above a sticky action bar.
- A sticky action bar sits above the keyboard, not under it.
- The PIN pad is a **custom in-app keypad**, not the device IME — the legacy `pinpad.css` notes
  the IME resize was disruptive. Keep that decision.

### Orientation

**No lock, in either direction.** No `screenOrientation` in the manifest and no orientation
reference in any source file. `configChanges` includes
`orientation|screenSize|screenLayout|smallestScreenSize`, so rotation does **not** recreate the
activity — the WebView reflows and Capacitor re-injects insets.

Consequences: landscape is a supported state; `--be-safe-left/right` are load-bearing; and no
layout may assume portrait.

### Deep links

There are none, and none are needed. The only intent filter is `MAIN`/`LAUNCHER`;
`custom_url_scheme = com.beonedge.app` is declared in `strings.xml` and consumed by nothing;
there is no App Links `assetlinks` setup. `launchMode="singleTask"` means an external launch
reuses the running task.

Payment return is therefore **not** a deep link. It is a full-page `window.location.assign` in
the same WebView, plus `localStorage` pending-payment recovery, plus server-authoritative
status polling. Do not introduce a deep-link dependency for payments — the settlement truth is
the API, not the return.

## Shells

### Client — below `lg`

```
┌────────────────────────────────────────┐
│ ░░░░ status bar / camera cutout ░░░░  │  --be-safe-top
├────────────────────────────────────────┤
│ ClientHeader                           │  56px + safe-top, sticky
│   [back?]  Title            [bell]     │
├────────────────────────────────────────┤
│                                        │
│ Page  width="default"                  │  scrollable
│   padding-x: max(pad, safe-left/right) │
│   padding-bottom: nav + safe-bottom    │
│                                        │
├────────────────────────────────────────┤
│ Home · Funds · Portfolio · Activity · Profile │  56px + safe-bottom
├────────────────────────────────────────┤
│ ░░░░ system navigation ░░░░           │  --be-safe-bottom
└────────────────────────────────────────┘
```

### Client — `lg` and above

```
┌──────────────────────────────────────────────────────────┐
│ logo   Home  Funds  Portfolio  Activity     bell  avatar │  top nav, 64px
├──────────────────────────────────────────────────────────┤
│                                                          │
│              Page  max-width: 960px  centred             │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Five destinations do not justify a sidebar, and a sidebar would make the browser and the APK
structurally different for no gain. Sheets become centred dialogs. Lists gain a second column
where the data supports it.

### Admin — `lg` and above

```
┌──────────────┬───────────────────────────────────────────┐
│ logo         │ Title            breadcrumbs      logout  │  topbar 56px
│              ├───────────────────────────────────────────┤
│ Overview     │                                           │
│ Applications │  Page  width="wide"  max-width: 1280px    │
│  · badge     │                                           │
│ Users        │  data tables, panels, drawers             │
│ Funds        │                                           │
│ AUM          │                                           │
│ Client values│                                           │
│ Money        │                                           │
│ System       │                                           │
│              │                                           │
│ [collapse]   │                                           │
└──────────────┴───────────────────────────────────────────┘
  240px, collapsible to 64px (icons only)
```

### Admin — below `lg`, including the admin APK

```
┌────────────────────────────────────────┐
│ ░░░░ safe-top ░░░░                    │
├────────────────────────────────────────┤
│ Title                        logout    │
├────────────────────────────────────────┤
│ awaiting · acknowledged · refunds      │  domain strip, only when siblings exist
├────────────────────────────────────────┤
│ Page — tables render as cards          │
├────────────────────────────────────────┤
│ Overview · Apps · Funds · Money · More │
├────────────────────────────────────────┤
│ ░░░░ safe-bottom ░░░░                 │
└────────────────────────────────────────┘
```

"More" opens a sheet with the remaining permitted destinations. This mirrors the legacy
`AdminMobileNav` + `AdminDomainStrip` model, which is sound — the failure was that
`admin-responsive.css` still styles the sidebar IA the shell abandoned.

**Amended (D-063).** This was specified and not built. Until 2026-08-30 `AdminFrame` rendered
`permitted.slice(0, 5)` with no "More", which left **nine of fourteen destinations with no phone path at
all** — every money screen and every system screen, on a surface that ships as its own APK with no
sidebar to fall back on. The bar is now `navBarEntries(permitted, 4)`, primary-first, and "More" opens a
`Modal` listing **every** permitted destination grouped by domain, not only the overflow: with Receipts
promoted into the bar, a Money group missing Receipts reads as though it lives elsewhere. `Modal` rather
than `Sheet` because only `Modal` registers with `OverlayStackProvider`, which is what makes Android
hardware Back dismiss the sheet instead of navigating away from it.

**The admin console is a real APK.** `emu/boe_update.sh:363-400` builds it with
`applicationId = com.beonedge.app.admin` and its own launcher branding, and `AdminSplash`'s
system-bar handling and reachability retry exist for that build. Note there is **no npm script**
for it — `app/package.json`'s `build:android*` scripts hardcode `client` — so it is buildable
only through `emu/boe_update.sh` or manual env. `NEEDS RUNTIME VERIFICATION` whether an admin
APK is currently distributed. Either way, admin must not be designed as desktop-only.

## Component strategy — SHARED / RESPONSIVE / WEB / MOBILE

### SHARED — identical in every presentation

Never diverges. Any divergence here is a bug.

- API access, types, validation schemas
- Domain logic: money conversion, status mapping, eligibility, permissions
- Query keys, staleness policy, cache invalidation
- Session and authentication
- Idempotency-key minting
- Form validation and error mapping
- Route manifest, guards, `resolveDestination`
- Every feature hook
- Design tokens

### RESPONSIVE — one component, fluid or breakpoint-adjusted

| Component | `< md` | `md` | `≥ lg` |
|---|---|---|---|
| `Page` | pad 16, full width | pad 24 | pad 32, max-width |
| `ContentGrid` | 1 column | 2 | 3–4 |
| `StatCard` grid | 2 columns | 3 | 4 |
| `FormSection` | stacked | stacked | 2-column label/field |
| `FundCard` grid | 1 column | 2 | 3 |
| `Button` | 44px min height | 40px | 36px |
| `Card` padding | 16 | 20 | 24 |
| Typography | base scale | base | +1 step for page titles |
| `DataList` | card mode | card mode | table mode |

Touch targets are **44 × 44 px minimum below `lg`**, per WCAG 2.2 AA and the accessibility
policy in `PRODUCT.md`. Above `lg`, pointer-precision targets are acceptable and hover
affordances appear — gated on the capability query, not the size query.

**Amended (D-059).** This table stops at `≥ lg`, and so did the implementation: until 2026-08-30 there
was not a single `xl:` prefix in `src/`, which made the whole 1024→2560px range one unstyled band and is
the reason the browser build looked like a stretched phone. `xl` (1440px) is now the large-desktop
composition step and the only lever above `lg` — there is no `2xl`, and `--breakpoint-*` is cleared to
exactly four values so a fifth is unrepresentable. Where it is used: independent-card grids go 2→3
columns (`CARD_COLUMNS`), `ADMIN_FORM_GRID` goes 2→3, the holdings legend goes 2→3, and the donut grows.
Grids whose semantic maximum is already reached at `lg` — `ADMIN_SUMMARY_GRID`, `ContentGrid` — are left
alone; extra width goes to spacing, not to empty cells.

### Deliberately different representation

Same component name, same props, same feature hook — different internal rendering. The
divergence is a rendering decision inside one component, never two components with two copies
of the logic.

| Concern | `< lg` | `≥ lg` | Why |
|---|---|---|---|
| Tabular data | stacked cards, label + value per row | real `<table>`, sortable headers, sticky header | A 9-column payments table is unusable on a phone; a card list wastes a 1440px screen |
| Overlay | `Sheet` from the bottom, drag-to-dismiss, `max-height: 92dvh` | centred `Dialog`, `max-width: 560px` | Thumb reach versus pointer precision |
| Navigation | bottom nav (both shells) | top nav (client) / sidebar (admin) | Thumb zone versus screen real estate |
| Multi-step form | one step per screen with a progress indicator | all sections on one page | Vertical space |
| Filters | a filter `Sheet` with an applied-count badge | an inline filter bar | Horizontal space |
| Fund performance chart | 220px tall, period chips | 320px tall, period tabs + benchmark toggle | Detail affordance |
| Admin detail screens | accordion sections | two-column with a sticky summary rail | Scan versus scroll |
| Row actions | tap the row → detail sheet | inline action buttons + row click | No hover on touch |

**Explicitly forbidden**, because it is what the plan warns against and what the legacy
`fund-detail.css` / `fund-redesign.css` split effectively became:

```
features/funds/FundListWeb.tsx
features/funds/FundListMobile.tsx     ← two copies of the same business logic
```

Correct shape:

```tsx
export function FundList() {
  const { data, status } = useFunds()          // shared, one implementation
  const bp = useBreakpoint()
  return (
    <Page width="default">
      <PageHeader title="Funds" />
      <AsyncBoundary query={...} empty={<EmptyState … />}>
        {bp === 'sm' || bp === 'md'
          ? <FundCardList funds={data} />       // presentation only
          : <FundTable funds={data} />}         // presentation only
      </AsyncBoundary>
    </Page>
  )
}
```

`FundCardList` and `FundTable` contain markup and CSS. No fetching, no money conversion, no
status derivation, no permission checks.

### WEB-SPECIFIC presentation

- Hover states, tooltips on hover, `title` affordances
- Keyboard shortcuts in admin (`/` to focus search, `Esc` to close)
- The sidebar collapse toggle
- Breadcrumbs
- Multi-column dashboards
- Text selection on data cells for copy-paste

### MOBILE / APK-SPECIFIC presentation

- Safe-area padding (present in CSS everywhere, resolving to `0px` in a browser)
- Bottom navigation
- Sheets with drag-to-dismiss
- The custom PIN pad
- The app-update gate and download progress
- Hardware Back handling
- Biometric prompts
- System-bar chrome pushes
- Pull-to-refresh on primary tabs

## Motion

The legacy `motionContract.test.jsx` asserts **no gsap anywhere** and that `PageTransition` is
inert. Keep both constraints — the token budget does not allow an animation library, and route
transitions in a WebView were the source of jank.

```css
--be-dur-fast:  120ms;   /* hover, focus, press          */
--be-dur-base:  200ms;   /* sheets, dialogs, disclosure  */
--be-dur-slow:  320ms;   /* only full-screen sheets      */
--be-ease-out:  cubic-bezier(0.16, 1, 0.3, 1);
--be-ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
```

Rules: transition only `opacity` and `transform` — never `height`, `width`, `top` or `left`.
No route transitions. Skeletons, not spinners, for initial loads; a spinner only for a pending
button. Every animation has a `prefers-reduced-motion: reduce` alternative that is a state
change with no movement — this is stated as an accessibility requirement in `PRODUCT.md`, not a
nicety.

## Accessibility

Target WCAG 2.2 AA, as `PRODUCT.md` states as product policy.

| Requirement | Implementation |
|---|---|
| Contrast | body ≥ 4.5:1, large text ≥ 3:1; token pairs pre-validated |
| Focus | a visible `:focus-visible` ring on every interactive element, never `outline: none` |
| Semantics | real `<button>`, `<a>`, `<table>`, `<nav>`, `<main>`, one `<h1>` per page (owned by `PageHeader` — the legacy admin nearly shipped two) |
| Labels | every input labelled via `useId`; `aria-describedby` joins **both** hint and error, which the legacy admin `FormField` got wrong |
| Errors | `role="alert"`, `aria-invalid`, focus moved to the first invalid field on submit |
| Touch targets | ≥ 44 × 44 px below `lg` |
| Keyboard | full operability; dialogs and sheets trap focus and restore it on close (already centralised in `useOverlayBehavior`) |
| Screen readers | live regions for toasts; `aria-live="polite"` on payment status polling |
| Motion | `prefers-reduced-motion` alternative for every animation |
| Zoom | `zoomEnabled: false` disables **page zoom only**. OS text scaling and TalkBack must keep working, and `user-scalable=no` is forbidden in the viewport meta and asserted against |
| Language | plain language treated as an accessibility requirement per `PRODUCT.md` |

## Content and copy constraints

`PRODUCT.md` states these as product policy, not style preference, and they bind the
authenticated app too:

- Banned words: "guaranteed return", "assured", "risk-free", "multibagger", "tip", "guru".
- No emoji. No exclamation marks. No FOMO or urgency language.
- **Never abbreviate to "BOE" or "BE" in any client-facing string.**
- Signal colours — green, red, amber — are reserved for money and risk state. Gold is a brand
  accent only. A green "Saved" toast violates this; use neutral confirmation.
- Indian currency formatting throughout, with disclaimers where required.

## Performance budgets — enforced, not aspirational

From `check-android-dist.mjs`:

| Budget | Limit |
|---|---|
| Largest JS chunk | 320 kB |
| Largest CSS file | 640 kB (raised from 160 kB by D-028) |
| Total assets | 2600 kB (raised from 1400 kB by D-028) |
| Font files | woff2 only; no cyrillic, greek or vietnamese subsets |
| Client build | zero assets matching `/admin/i`, `/website/i`, `/landing/i`, `/browserroot/i` |
| Chunk import graph | **must be acyclic** |

The acyclicity check exists because v0.9.0 shipped a blank screen — a TDZ `ReferenceError` from
a cyclic chunk graph — **with zero failing tests**. `rules.md` §5 states it directly: do not
split chunks without proving the graph is acyclic.

`check-bundle-boots.mjs` then evaluates the entry chunk and every other chunk in a JSDOM with a
stubbed `window`/`fetch`/`matchMedia`, failing on any throw or unhandled rejection. It is the
only pre-device smoke test and it must be ported.

Achieved by: route-level `lazy()` on every screen; `manualChunks` splitting vendor and the
admin domains; icons as named imports; self-hosted woff2 with explicit `unicode-range`; CSS
Modules so only a route's own CSS loads; no charting or component library.

## Layout anti-patterns — forbidden, with the legacy evidence

| Forbidden | Legacy evidence |
|---|---|
| A `max-width` on anything but `Page` — see the D-060 amendment above: page width, not a `ch` or `lg:`-gated measure | eight competing containers, seven in `auth.css` alone |
| A media query outside `ui/` and `shells/` | three mismatched client breakpoints, four admin thresholds |
| A breakpoint value in TypeScript | `MOBILE_BREAKPOINT = 768` beside CSS `768px` in two other files |
| A fixed pixel height on a content container | `explore.css:67` 220px and `:70` 190px for the same rail |
| A dimension encoded in a class name | `.apk-skel--h-180`, `--h-200`, `--h-240` across three files |
| A fixed-size chart beside a `min-width` legend | `fund-detail.css:226` 160px SVG next to `:253` 180px column — cannot reflow either way |
| Mixing `ch` and `px` caps for the same text role | `fund-detail.css` uses `72ch`, `40ch`, `44ch` **and** `400px`, `260px` |
| A second class vocabulary | `be-*`, `apk-*`, `adm-*`, `ash-*` — and `FundDetail.jsx:471` uses two at once |
| A stylesheet whose name does not match its component | `fund-redesign.css` styles Explore |
| Styling a class no component renders | `.adm-app` rules in `admin-responsive.css:11-40` |
| `100vh` | does not account for the Android URL bar or the IME |
| Reading `env(safe-area-inset-*)` outside `tokens-core.css` | test-enforced; import-order shadowing already shipped once |
| Hardcoded safe-area padding | the whole reason the token chain exists |
| A dead layout wrapper left exported | seven of eleven, all still in the public API |

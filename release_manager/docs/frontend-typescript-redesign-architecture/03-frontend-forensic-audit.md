# 03 — Frontend Forensic Audit

Evidence-based findings about `frontend_stack`. The purpose is to know precisely what not to
carry forward. Nothing here is a change request against the legacy frontend — it must remain
untouched.

## Package topology

```
frontend_stack/                        npm workspace root, name "beonedge-design-system"
├── app/                               the only Vite application + the Android project
│   ├── src/                           main.jsx, ClientRoot, BrowserRoot, NativeAppRoot,
│   │                                  platform/{SystemBarsController,NativeBackCoordinator,
│   │                                  phonePeMobileCheckout}, components/
│   ├── scripts/                       3 build gates
│   ├── android/                       Capacitor Android project, 3 custom Java plugins
│   ├── resources/launcher/{client,admin}/
│   ├── Dockerfile, nginx.conf, capacitor.config.ts, CAPACITOR_CONFIG.md
├── packages/client/                   ~130 files — the client app AND, in practice, the app core
├── packages/admin/                    ~110 files — the admin console
├── packages/shared/                   ~50 files — components, motion, overlay, net, format
├── packages/design-tokens/            5 CSS files + 7 contract test files
├── colors_and_type.css                orphan at workspace root, outside every package
└── vitest.config.js, vitest.setup.js
```

`packages/admin` depends on `packages/client`. There is no dependency in the other
direction, but the consequence is the same: **the client package is the admin package's
shared base**, so it cannot be replaced independently.

## 1 · Layout — the root cause of inconsistency

`packages/client/src/layout/` contains eleven wrappers. Importer counts across
`src/pages`, `src/components` and `src/layout`:

| Wrapper | Importers |
|---|---|
| `AppBar.jsx` | **16 pages** |
| `PageSheet.jsx` | 4 (Statements, MandateDetail, Transactions, Security) |
| `BottomNav.jsx` | 1 (`ClientLayout.jsx`) |
| `Screen.jsx` | **0** |
| `PageHeader.jsx` | **0** |
| `Section.jsx` | **0** |
| `Card.jsx` | **0** |
| `MetricGrid.jsx` / `Metric` | **0** |
| `ActionBar.jsx` | **0** |
| `BottomSheet.jsx` | **0** |

Seven of eleven are dead, and **all seven are still re-exported from `src/index.js:5-11`** as
the package's public layout API. Meanwhile the pages hand-write exactly the classes those
wrappers exist to emit: `be-card` × 63, `be-btn` × 58, `be-eyebrow` × 39 across `src/pages`.

That is the finding that explains everything else in this document. **There is no enforced
layout primitive**, so page width, padding, spacing and safe-area handling are each decided
independently more than twenty times.

Admin has the mirror-image problem. `layout/primitives/PageHeader.jsx` (60 lines, with its
own `PageHeader.css`) was written to be the unification — its own docblock says it "Replaces
.ash-top-heading and .adm-top title patterns" and merges "the 18px ash style and 28px serif
adm style into a single 20px sans authoritative header." It is imported **nowhere** outside
`primitives/index.js`. It never landed. And if it were used inside `AdminShell` it would
render a second `<h1>` alongside `TopBar`'s.

Worse, `layout/PageHeading.jsx` is not a visual component at all despite the name — it is a
context provider (`PageHeadingProvider`, `usePageHeading`, `useSetPageHeading`) that lets a
screen override the shell's `TopBar` title. Two near-homonyms solving the same problem in
incompatible ways, one of them dead.

## 2 · Styling — measured evidence

### Client: 16 stylesheets, three mismatched breakpoints, no desktop story

`src/styles/mobile/index.css` imports fifteen files in a fixed order. All are reachable.
`NotFound.jsx:11` imports `index.css` a second time (harmless). `packages/admin/src/pages/AdminLogin.jsx:8-9`
reaches directly into `client/src/styles/mobile/base.css` and `auth.css`, so the client's
mobile stylesheet is also the admin login's stylesheet.

**Three "small phone" breakpoints, two units, none coinciding:**

| File | Query |
|---|---|
| `layout.css:174` | `@media (max-width: 430px)` |
| `dashboard.css:395` | `@media (max-width: 24rem)` — 384px |
| `disclosures.css:167` | `@media (max-width: 480px)` |

A 400px-wide device receives the `layout.css` and `disclosures.css` adjustments but not the
`dashboard.css` ones.

**Nothing above 480px is handled anywhere.** The only other media queries in the client are
capability queries — `@media (hover: hover) and (pointer: fine)` at `explore.css:385,464,475,609,620`
and `dashboard.css:202` — plus `prefers-reduced-motion` at `base.css:169`,
`components.css:263`, `app-update.css:43`. The client is mobile-only by construction, and
that same stylesheet is what the browser build serves.

**Eight competing page-width containers:**

| File:line | `max-width` |
|---|---|
| `auth.css:20` | 420px |
| `auth.css:105` | 680px |
| `auth.css:122` | 760px |
| `auth.css:131` | 620px |
| `auth.css:285` | 780px |
| `auth.css:302` | 760px |
| `auth.css:349` | 560px |
| `base.css:242` / `:253` | 620px / 590px |
| `layout.css:259` | 560px |

`auth.css` alone declares seven container widths spanning 420–780px. On a tablet the login
screen and the shell disagree about how wide "the page" is.

**Hardcoded pixel dimensions that cannot reflow:**

- `auth.css:243` `.apk-login-logo { height: 56px; max-width: 220px }`
- `auth.css:245` `.apk-splash-logo { height: 104px; max-width: 104px }`
- `auth.css:112` `width: 224px`, `:290` `188px`, `:427` `240px`; `base.css:236` `164px`
- `explore.css:67` `height: 220px` and `:70` `height: 190px` — two different fixed heights for the same chart rail
- `fund-detail.css:103` `height: 140px`; `:226` `.apk-sector-chart svg { width: 160px; height: 160px }`; `:253` `min-width: 180px`
- `transactions.css:279` `min-height: 260px`

A fixed 160px SVG next to a `min-width: 180px` legend column means the holdings donut cannot
use extra width on a larger screen and will overflow below roughly 360px.

**Skeleton heights encoded as class names, in three files:**
`disclosures.css:201-202` `.apk-skel--h-180`, `.apk-skel--h-240`; `invest.css:236`
`.apk-skel--h-200`. A layout change requires inventing a new class.

**Two theories of line length in one stylesheet.** Character caps
(`fund-detail.css:21` `72ch`, `:496` `40ch`, `:528` `44ch`; `explore.css:278` `32ch`;
`components.css:306` `28ch`) sit alongside pixel caps for the same kind of text block
(`fund-detail.css:503` and `:547` `400px`, `:554` `260px`).

**`fund-detail.css` versus `fund-redesign.css` — a misfiling, not a duplicate.** Diffing
their top-level selectors, the intersection is exactly **one** rule: `.apk-ha-dot`.
`fund-redesign.css` (63 selectors) is actually the **Explore fund-card system** —
`.apk-fc`, `.apk-fc-top`, `.apk-fc-mono`, `.apk-fc-name`, `.apk-fc-perf`, `.apk-fc-return`,
`.apk-fc-chart`, `.apk-fc-grid` at lines 27–56, consumed by `Explore.jsx:133`. So a file
called `fund-redesign` styles Explore while `explore.css` (641 lines) also styles Explore.
Two files, one screen, neither name says so. The single `.apk-ha-dot` collision is a real
cascade hazard: `fund-redesign.css` is imported after `fund-detail.css` (index.css lines 8
and 7), so it wins for the holdings-analysis dot.

**Two class vocabularies in one element.** `FundDetail.jsx:471`:
`className="be-btn be-btn-primary be-btn-lg apk-invest-cta-btn"`. Every component inherits
from two independent cascades with no documented precedence.

### Admin: three namespaces, four mobile thresholds, dead rules for a dead root class

`styles/desktop/shell.css:1-6` states the situation in its own header: the `.ash-` namespace
"Coexists with the legacy `.adm-` styles while old screens await their per-domain rebuild."
So `.ash-*` (shell, Overview, FAQs, NotFound, Forbidden) and `.adm-*` (every screen under
`screens/`) both define page frames, cards, tables and empty states, and `.be-*` from
primitives and tokens is the third layer.

`shell.css:19-25` then re-points shared layout tokens for **both** roots:
`.ash-app, .adm-app { --be-content-max: 100%; --be-page-pad-x: var(--be-page-pad-x-fluid); … }`.
But `AdminShell` emits `ash-app` — **`.adm-app` is a selector no component renders any more**,
and `admin-responsive.css` still styles `.adm-app`, `.adm-side`, `.adm-brand`,
`.adm-side-foot`, `.adm-top`: an entire dead mobile sidebar treatment.

Four mobile thresholds for one console:

| Location | Threshold |
|---|---|
| `AdminShell.jsx:18` | JS `MOBILE_BREAKPOINT = 768` |
| `admin-responsive.css:1` | `max-width: 1100px` (form grids) |
| `admin-responsive.css:11` | `max-width: 768px` — implements the horizontally-scrolling sidebar for `.adm-app`, which no longer exists |
| `desktop/shell.css:722` | `max-width: 768px` — with a comment directly contradicting the block above: "The sidebar is not rendered at this width at all — AdminShell mounts AdminMobileNav and AdminDomainStrip instead" |
| `desktop/shell.css:1056` | a **second** `max-width: 768px` block, just to hide `.ash-nav-collapse` |
| `desktop/admin.css:21` | `max-width: 40rem` — the only query in `rem`, so a user root-font change moves this breakpoint and not the others |

Two page containers: `.ash-page` (Forbidden, NotFound, FaqsPage) and `.adm-screen` (all
screens), each with its own padding and gap rules — and `.adm-screen` is the one that adds
bottom-nav clearance, `.ash-page` is not.

CSS imports are duplicated per entry: `Admin.jsx` imports `desktop/admin.css` +
`shell.css` + `site.css`; `NotFound.jsx` and `Forbidden.jsx` re-import the same two;
`AdminLogin.jsx`/`AdminSplash.jsx` import `desktop/admin.css` plus two client mobile
stylesheets; every screen additionally imports `screens/admin-screens-shared.css`
(14 importers).

Residue with no JSX consumer: `styles/desktop/site.css` (18 lines, last remnant of a wider
site CMS) and a "Landing content editor: rail stack + description panel" section in
`shell.css` around line 1060 (`.ash-content-rail-stack`, `.ash-section-desc*`).

### The one part of the styling layer that is genuinely good

`packages/design-tokens/src/tokens-core.css:33-36` is the **sole owner** of the safe-area
contract, with a three-layer fallback:

```css
--be-safe-top:    var(--safe-area-inset-top,    env(safe-area-inset-top, 0px));
--be-safe-right:  var(--safe-area-inset-right,  env(safe-area-inset-right, 0px));
--be-safe-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
--be-safe-left:   var(--safe-area-inset-left,   env(safe-area-inset-left, 0px));
```

The order is deliberate. Capacitor 8's `SystemBars` plugin injects `--safe-area-inset-*` in
dp on `document.documentElement`, but **only on Android 15+ where a Chromium bug makes
`env()` wrong**, and **only when the viewport meta contains the literal `viewport-fit=cover`**.
`env()` covers everywhere else. `0px` is the floor.

`safeArea.test.js` enforces it by scanning every `.css` under `packages/` and `app/src` with
comments stripped: tokens-core must declare all four edges with the exact literal string; no
other stylesheet may read `env(safe-area-inset-`; no other stylesheet may redeclare
`--be-safe-*` (import-order shadowing was a real past defect); the dead `--be-safe-area-*`
alias set must stay gone; `app/index.html` must match `/name="viewport"[^>]*viewport-fit=cover/`;
and `index.html` must not contain `user-scalable=no`.

**Port this contract verbatim.** It is the only part of the legacy styling layer worth
keeping, and every one of its constraints exists because of a defect that shipped.

### Fonts — self-hosted, hand-written, deliberately not the fontsource barrels

`packages/design-tokens/src/fonts.css` declares eight explicit `@font-face` rules pointing
directly at files inside `@fontsource-variable/fraunces`,
`@fontsource-variable/instrument-sans` and `@fontsource/jetbrains-mono`, with explicit
`unicode-range` and `font-display: swap`:

| Family | Token | Weights |
|---|---|---|
| Instrument Sans Variable | `--be-font-body` / `--be-font-ui` | `400 700` variable, `woff2-variations` |
| Fraunces Variable | `--be-font-display` / `--be-font-brand` | `100 900` variable, `woff2-variations` |
| JetBrains Mono | `--be-font-mono` / `--be-font-code` | static 400 and 500 |

The header explains why the barrels are avoided: they pulled cyrillic, greek and vietnamese
subsets **and** both woff2 and woff. `unicode-range` stops a *browser* downloading unused
subsets, but the Android build packages every emitted asset into the APK, so 20 font files
shipped to reach the 8 that can ever be used. **`latin-ext` is required, not optional — the
rupee sign U+20B9 lives in its range.** `check-android-dist.mjs` fails the build on any
`.woff` and on any cyrillic/greek/vietnamese subset.

## 3 · State and data

### Session

`store/SessionContext.jsx` holds one `useState` and a typed status from `store/sessionState.js`:
`RESTORING` / `AUTHENTICATED` / `ANONYMOUS`, plus `error` and `endedReason: 'expired'`.
On mount: `hydrateSessionVault().then(() => authApi.currentUser({scope:'client'}))` —
hydration **must** precede the probe because `apiRequest` reads tokens synchronously.
A restore failure is classified by `isRestoreFailure()` (`sessionState.js:60-67`:
`REQUEST_TIMEOUT`, `NETWORK_UNAVAILABLE`, or `status >= 500`) so an outage does not present
as a logout. The comment records that this previously checked the wrong codes and therefore
never fired. It listens for the `boe:session-invalidated` window event.

`auth/sessionVault.js` — two scopes (`client`, `admin`) × four fields, keys
`boe.<scope>.<field>`. An in-memory object is the **synchronous read path**; persistence is a
side effect. Native: Capacitor Secure Storage, and if `secure.available()` is false the vault
**fails closed** — memory only, nothing written, and `purgeLegacyLocalSecrets()` deletes any
`accessToken`/`refreshToken` left in `localStorage` (deleted, not migrated). Web: the
principal and CSRF token in `localStorage`, on the argument that the real credential is an
HttpOnly cookie the browser owns. `hydrateSessionVault()` is idempotent and single-flight.
`sessionVaultStatus()` deliberately never returns token values.

**Android admin is a special case.** `authApi.js::adminUsesBearer()` — the admin SPA in a
Capacitor WebView is served from `https://localhost`, cross-site with the API, so
`SameSite=Lax` cookies plus the `Sec-Fetch-Site` gate make cookie auth impossible. It logs
in via `/v1/auth/native/login` with a bearer token and `buildAdminDevice()`, then fetches
`/v1/admin/session`.

### Server state — two coexisting strategies

`shared/src/data/ResourceCacheProvider.jsx` + `client/src/data/clientResources.js` form the
good one. A single provider holds a key→entry store; `useResource(key, loader, {staleTime, enabled})`
returns `{data, status, error, updatedAt}`. A `null` key disables the resource entirely
(used by `useEligibility` before a user exists). Keys are all under a `client:` prefix so
logout can drop them in one call: `client:portfolio`, `client:funds`, `client:fund:{id}`,
`client:research`, `client:sips`, `client:eligibility:{userId}`,
`client:transactions:{filter}`, `client:payments:{kind}`. Staleness is declared per domain
(`STALE_TIME.MONEY`, `.CATALOGUE`, `.ELIGIBILITY`) with no global default, and `useFundsById`
derives from the *same* entry as `useFundList`. Writes call
`useClientCacheActions().invalidateMoney()`, which invalidates prefixes — invalidate keeps
data while refetching; only `clearAll` discards.

`data/ClientCacheEvictor.jsx` renders null, watches `user?.id`, and calls `clearAll()` only
on a transition *away from* a known id (`previousId != null && previousId !== currentId`), so
a cold-start `null → user` does not throw away what the launch path fetched. This prevents
one investor's cached valuation being shown to the next signer-in on a shared device.

**And then `FundDetail.jsx` — the heaviest read screen — bypasses all of it** with raw
`useEffect` fetches at lines 33–51, refetching on every mount while Explore's list is cached.

### Duplicated session layer

`store/AdminSessionContext.jsx` is a near-verbatim copy of `SessionContext.jsx`: same
hydrate-then-`currentUser` sequence, same event listener, same `sessionState` helpers,
differing only in `scope: 'admin'` and the event filter (`=== 'admin'` versus
`=== 'client' || !e.detail?.scope`). It lives in the client package and has **no client
consumer** — it is imported by `app/src/BrowserRoot.jsx:4` and by `packages/admin` at
`layout/AdminShell.jsx:4`, `data/AdminCacheEvictor.jsx:2`, `pages/AdminLogin.jsx:3`,
`pages/legacy/legacyRoutes.jsx:4`. `ClientCacheEvictor.jsx` and
`admin/src/data/AdminCacheEvictor.jsx` are the same story.

## 4 · Transport

`packages/client/src/services/_util.js`, 339 lines, is the one genuinely well-designed module
in the legacy frontend. Its behaviours are requirements, not accidents.

| Concern | Implementation |
|---|---|
| Mode gate | `serviceMode()` returns `'http'` only when `VITE_BEO_API_MODE === 'http'`; `apiRequest` throws `FixtureModeError` otherwise (line 245) |
| Base URL | `apiBaseUrl()` = `VITE_BEO_API_BASE_URL` with trailing slash stripped, default `http://127.0.0.1:47502` |
| Auth | `Authorization: Bearer <token>` read **synchronously** from the vault; `credentials: 'include'` always; `x-csrf-token` on non-GET when present |
| Header override | per-request `headers` override defaults — this is how `Idempotency-Key` and `If-Match` get through |
| Retry | idempotent reads only, `READ_RETRY_DELAYS_MS = [300, 900]`, defaulted to `method === 'GET'`. **Writes are never replayed**; the compensation is a caller-supplied `Idempotency-Key` |
| Timeout | `DEFAULT_TIMEOUT_MS = 20000`, and `fetchWithDeadline` covers `response.text()`, not just headers |
| Errors | three named classes — `FixtureModeError` (`FIXTURE_MODE`), `RequestTimeoutError` (`REQUEST_TIMEOUT`), `NetworkError` (`NETWORK_UNAVAILABLE`) — plus `isTransportError()`; HTTP failures carry `status`, `code`, `details` from `payload.error` |
| Connectivity | every attempt reports to `reportTransportOutcome()`, which feeds the offline banner |
| 401 | `refreshSessionOnce(scope)` **coalesces concurrent refreshes per scope**, because the backend does reuse detection and parallel rotations revoke the whole family. One rotation, one replay; on failure clear the scope's vault and dispatch `boe:session-invalidated`. Unauthenticated 401s (login) deliberately skip all of this — otherwise a failed login in one tab would sign out a valid session in another |
| Envelope | `envelope: true` preserves `{ok,data,meta}` for keyset pagination; otherwise `data` is unwrapped |

Two modules bypass it. `services/appUpdate.js:81` uses raw `fetch` — deliberately, because it
runs on the splash before any session exists and must not enter the 401-refresh machinery.
`shared/src/appConfig.js` is a second transport, which is not deliberate and is listed in the
prior audit as unresolved.

## 5 · Service layer inventory

The full method-and-path table is in [04](04-backend-api-contract-map.md). What matters
forensically:

- **`services/types.js` is genuinely dead** — `grep '^export'` returns nothing, and nothing
  imports it.
- **`services/adminApplicationsApi.js` has zero importers in the client package.** Its only
  consumer is `packages/admin/src/data/ApprovalsQueueProvider.jsx:5`. An admin API living in
  the client package, consumed cross-package.
- **`transactionsApi.listTransactions({filter})` never sends the filter to the server.** It
  requests `?limit=100` and filters client-side after `mapLedgerRow`.
- **`notificationsApi.markAllRead` has no `apiRequest` call in its http branch** (line 48).
  The action does not persist.
- `eligibilityApi`, `researchApi`, `disclosureApi`, `supportApi`, `statementsApi`,
  `notificationsApi` are all live — the suspicion that they were dead is wrong.

## 6 · Fixture mode is a production code path

The five `data/fixture*.js` files are imported at module scope **by the services themselves**
and returned whenever `useHttpApi()` is false:

| Fixture | Importer |
|---|---|
| `fixtureUser.js` | `services/authApi.js:1` |
| `fixturePortfolio.js` | `services/portfolioApi.js:1` |
| `fixtureTransactions.js` | `services/transactionsApi.js:1` |
| `fixtureStatements.js` | `services/statementsApi.js:2` |
| `fixtureNotifications.js` | `services/notificationsApi.js:1` |

No test file imports any of them. So in a default build the app signs in as
`local_client` / `client@beonedge.local` with `status:'approved'` and shows a hardcoded
₹12,38,450 portfolio (`fixturePortfolio.js:5`).

**Four of the five are empty arrays.** `fixtureTransactions.js:1`,
`fixtureStatements.js:1`, `fixtureNotifications.js:1` are all `export const … = []`. So
fixture mode produces a signed-in user with a fake balance and no history — a worse demo
than either a real backend or a complete fixture set. Screens with no fixture at all throw
`FixtureModeError` and render their error state.

Admin's equivalent is `fixtures/adminCollections.js`, whose sole importer anywhere in the
monorepo is `helpers/loadAdminData.js:4,37` — also a production path. It carries one
collection (`FIXTURE_FAQS`), so FaqsPage renders three fake FAQs while every sibling screen
silently shows an empty table. And `hooks/useAdminList.js` takes the **opposite** approach
for the same condition, refusing to render and showing "This screen needs the backend.
Set VITE_BEO_API_MODE=http to use live data." Two conflicting offline behaviours in one
console.

This directly collides with `rules.md` §4: a failed read must never be rendered as "there is
nothing here."

## 7 · Semantic duplication

| Responsibility | Implementations | Canonical answer |
|---|---|---|
| Money formatting | `client/src/utils/format.js` is **nothing but a re-export** of `@beonedge/shared/format.js`. Nineteen pages import through the facade. `src/index.js:34-42` re-exports the set a third time. Inside `shared/format.js`, `fmtMoney` (line 19) and `formatMoney` (line 26) are near-identical | `shared/format.js`, one function |
| Paise conversion | `shared/money.js::paiseToRupees` (read) and `ordersApi.js::rupeesToPaiseString` (write) — **not** duplicates, two directions | keep both, one each |
| Fund risk / display | `client/utils/fundDisplay.js` (`fundMonogram`, `formatReturnPct`, `formatNavDate`, `returnTone`), `pages/fundDetail/fundDetailModel.js` (`RISK_LABELS`, `LIFECYCLE_LABELS`, `ADVANCED_RATIO_ROWS`, `withPaletteColors`), `shared/riskMapping.js`, `shared/components/Badges.jsx::RiskBadge`. And `formatReturnPct` duplicates `fmtPct` with a different default (2 decimals vs 1), so **Explore and FundDetail render percentages to different precision** | one fund-presentation module |
| Total return | `Dashboard.jsx:45` + own JSX, `Portfolio.jsx:18` + own JSX, and `Statements.jsx:50` computes its own `totalReturns` from statement rows **rather than from `/v1/client/portfolio`** — a figure not sourced from the authoritative endpoint. Styled by `dashboard.css` (402 lines) and `portfolio.css` (614 lines) | one derived value from one endpoint. `NEEDS RUNTIME VERIFICATION` that the figures currently agree |
| Overlays | dead `BottomSheet.jsx` (`.be-sheet*`), live `PageSheet.jsx` (`.apk-sheet*`, 4 importers), shared `AdaptiveDialog.jsx` (`.be-dialog*`, used by admin). All three delegate behaviour to `shared/overlay/useOverlayBehavior.js` and register with `OverlayStackContext.jsx`, so Escape/Back/scroll-lock/focus-trap are correctly centralised. What is triplicated is markup and CSS | one dialog + one sheet, sharing the hook |
| Session context | `SessionContext.jsx` and `AdminSessionContext.jsx` | one, parameterised by scope |
| Cache evictor | `ClientCacheEvictor.jsx` and `admin/data/AdminCacheEvictor.jsx` | one |
| Form field | admin `components/FormField.jsx` (24 lines, requires a caller-supplied `id`, children-as-function, `aria-describedby` set to error **or** hint) versus shared `components/FormField.jsx` (56 lines, generates an id with `useId`, accepts an element child via `cloneElement`, joins both descriptions correctly, adds `required`). **Admin's weaker one is what all 35 money-handling call sites use** | shared, with the correct a11y |
| Skeletons | admin `SkeletonTableRow` (10 screens), admin `SkeletonTile` (1 screen), shared `Skeleton` (5 admin screens) | one |
| Empty / error state | admin `EmptyTableRow` (10 screens), shared `EmptyState` (1 screen), shared `AsyncState` (**unused by admin entirely**, so each screen hand-rolls its own `ash-load-note` retry banner — see `EmailDeliveriesScreen.jsx:43-51`, `EnvironmentScreen.jsx:104-112`) | one async-state trio |
| Tables | admin `DataTable.jsx` (178 lines, selection via `IndeterminateCheckbox`, imports shared `StickyActionBar`) is used by **exactly one screen**; every other screen writes raw `<table class="adm-table">` with `data-label` attributes for card mode. Shared's `CurrencyCell`, `DateCell`, `UserCell`, `ListRow` are unused in admin | one data-list primitive |
| Page header | admin `layout/PageHeading.jsx` (context), admin `layout/primitives/PageHeader.jsx` (dead), client `layout/PageHeader.jsx` (dead) — three things called some variant of "page header", none of them agreeing | one |
| Pagination | `hooks/useAdminList.js` (generic, `limit=25`), the bespoke append buffer inside `data/adminResources.js::useAdminFunds` (`limit=100`), and `screens/useAumHistory.js` (own `PAGE_LIMIT`). All three speak the same wire protocol | one paginated-query hook |

## 8 · Platform bridge

`client/src/platform/clientPlatform.js` is a barrel over five modules.

| Module | Capability | Plugin |
|---|---|---|
| `storage.js` (132 lines) | `platformStorage.secure` — `available()`, `get`, `set`, `remove`. **The credential store**; the vault fails closed without it | `@aparajita/capacitor-secure-storage` |
| `security.js` (261 lines) | biometric prompt and availability, PIN storage; backs the whole Security screen and `AppLockGate` | `@capgo/capacitor-native-biometric` |
| `lifecycle.js` | foreground/background/resume; also the hardware-Back subscription | `@capacitor/app` |
| `info.js` | platform id, native-vs-web, build info; consumed by `appUpdate.currentBuild()` | `@capacitor/core` |
| `errors.js` | `PlatformError` code enum + `platformError(code, message)` so a missing plugin surfaces as a typed error | — |
| `shared/platform/systemBarStyle.js` | status/navigation bar theming as a **stack**: `SYSTEM_BAR_STYLE`, `DEFAULT_BAR_BACKGROUND = '#F7F7F5'`, `pushSystemChrome` returning a pop function, `getSystemChrome`, `subscribeToSystemChrome`, `useSystemChrome`. A stack, not a setter, so a full-screen sheet can darken the bars and restore them on close. Validation **throws** on a bad style or a non-hex background | — |

Ranked by replacement difficulty: Secure Storage → biometrics → APK self-update
(`REQUEST_INSTALL_PACKAGES`) → local notifications → lifecycle and hardware Back → system
bar theming → external URL opening.

`client/src/utils/openExternal.js` is the single validated route out of the app.
`resolveDestination(value)` classifies; only `EXTERNAL`, `EMAIL` and `PHONE` are openable, so
`javascript:`, `data:`, cleartext `http:`, protocol-relative `//host`, and the WebView's own
`https://localhost` origin are all refused. Native + `EXTERNAL` → dynamic
`import('@capacitor/browser')`. `mailto:`/`tel:` fall through to `window.open` because
Capacitor's Browser cannot service them. It always resolves, never throws — callers are
expected to surface `ok: false` rather than leaving a dead tap. **This matters because URLs
arrive from remote content**: disclosure documents, grievance escalation steps, published
config.

## 9 · Android integration

`app/src/platform/NativeBackCoordinator.jsx` is the single owner of hardware Back, mounted
once above both routers by `NativeAppRoot`. It registers the `@capacitor/app` `backButton`
listener **exactly once**; everything the handler reads lives in `stateRef.current`, because
re-registering per navigation risks either no listener or two listeners on one press.

The priority order **is** the design:

1. `dismissTop()` from `OverlayStackContext` — an open overlay closes, unconditionally first.
2. `policy.isTransactional && onTransactionalBack({pathname})` — lets a financial flow confirm
   before being abandoned.
3. `policy.parentPath` → `navigate(parentPath, {replace: true})` — a *declared* parent, not
   history, so a notification-opened screen still has somewhere to go.
4. `policy.isPrimary && !policy.isHome && policy.homePath` → go Home instead of replaying tab
   history.
5. `policy.isHome || policy.isPublic` → exit, unless `canGoBack` (a genuine in-app history
   entry still wins).

Policy is injected, so the coordinator stays target-neutral:
`resolvePolicy({pathname}) → {isTransactional, parentPath, isPrimary, isHome, isPublic, homePath}`.
`client/src/navigation/backPolicy.js::parentPathOf` substitutes params, so
`/app/invest/sip/f1` → `/app/funds/f1`, not a template.

**Rule 2 is currently inert**: `onTransactionalBack` is a documented prop of both
`NativeAppRoot` and `NativeBackCoordinator`, and `main.jsx` never passes it.
`NEEDS RUNTIME VERIFICATION` whether any other mount supplies it.

The `NativeAppRoot` ordering contract is a requirement:
`NetworkStatusProvider` → `OverlayStackProvider` → effect-only `SystemBarsController` and
`NativeBackCoordinator` → `ConnectivityBanner` → children, with `BrowserRouter` **outside**
`NativeAppRoot` because the coordinator needs `useNavigate`/`useLocation`.

Keyboard handling is purely `android:windowSoftInputMode="adjustResize"` plus `100dvh`
layout. There is **no `@capacitor/keyboard` dependency**. The manifest comment explains that
without `adjustResize`, Android 12+ defaults can leave a focused input behind the bottom nav
or a sticky action bar with no way to scroll to it, and that Capacitor's inset listener
explicitly corrects for a shown IME. `styles/mobile/pinpad.css` notes a custom PIN pad
replaces the device IME because the IME resize was disruptive.

**No orientation lock anywhere.** No `screenOrientation` in the manifest, no `orientation`
reference in any package source. The manifest lists
`orientation|screenSize|screenLayout|smallestScreenSize` in `configChanges`, so rotation does
not recreate the activity — the WebView reflows and Capacitor re-injects insets. Landscape is
a supported state, which is exactly why `--be-safe-left/right` matter.

**No deep links at all.** The only intent filter is `MAIN`/`LAUNCHER`. `strings.xml` defines
`custom_url_scheme = com.beonedge.app` but no `<intent-filter>` consumes it, and there is no
App Links `assetlinks` setup. `launchMode="singleTask"` means an external launch reuses the
running task. **Payment return is therefore not a deep link** — it is a full-page
`window.location.assign` in the same WebView plus `localStorage` recovery, with settlement
truth coming only from server callbacks and reconciliation.

## 10 · Dependencies

**Nothing is duplicated, because almost nothing is declared.**

`frontend_stack/package.json` — workspaces, `type: module`, scripts delegating to `app`, and
four devDependencies (`@testing-library/jest-dom ^6.6.3`, `@testing-library/react ^14.3.1`,
`jsdom ^25.0.1`, `vitest ^2.1.9`). **No runtime dependencies and no lint tooling at the
root** — no `eslint`, no `typescript`, no `vite`, no `react`.

`packages/client/package.json` — `dependencies: { "@beonedge/shared": "0.1.0" }` and nothing
else, plus a 15-entry `exports` map. Undeclared runtime imports, resolved only by workspace
hoisting from `app`:

- `react`, `react-dom` (`createPortal` in `BottomSheet.jsx`, `PageSheet.jsx`)
- `react-router-dom` (`ClientApp`, `ClientLayout`, `AppBar`, `BottomNav`, most pages)
- `lucide-react` (~18 pages)
- `@capacitor/core` (`platform/info.js:1`, `security.js:1`, `storage.js:1`, `sessionVault.js:1`)
- `@capacitor/app` (`platform/lifecycle.js:1`)
- `@aparajita/capacitor-secure-storage` (`platform/storage.js:2`)
- `@beonedge/design-tokens` — **a dependency of neither `client` nor `shared`**, yet every
  client stylesheet consumes its custom properties (`--be-slate`, `--be-ink`, `--be-space-8`,
  `--be-ease-out`, `--be-font-ui`, `--be-font-mono`). The tokens package is wired in only by
  `app/src/index.css`.

So `packages/client` cannot be built or rendered standalone despite exporting a public API as
if it could.

`packages/shared/package.json` — **no `dependencies` field at all**, despite
`ResourceCacheProvider.jsx`, every `components/*.jsx`, `motion/*`, `overlay/*` and
`platform/systemBarStyle.js` importing React.

`packages/design-tokens/package.json` — no dependencies. `exports` declares only `.`,
`./tokens.css`, `./kit.css`, but `src/` also ships `tokens-core.css`, `kit-core.css` and
`fonts.css`, which are unreachable from outside except through the two exported files'
`@import`s. Its `src/` is seven contract test files against five CSS files.

## 11 · Assets

md5 comparison shows `87255e92d395e9d571f3b73e3722d43d` is the **same file in five places
under four names**:

- `beonedge_logo.svg` (repo root)
- `frontend_stack/assets/beonedge_logo.svg`
- `packages/shared/src/assets/logo.svg`
- `packages/shared/src/assets/logo-mark.svg`
- `packages/shared/src/assets/logo-on-dark.svg`

`logo-mark.svg` is imported by nothing — dead. `logo-on-dark.svg` and `logo.svg` are
byte-identical, so the "on-dark" variant is a naming lie: the same artwork is used on ivory
and on dark surfaces.

Actually referenced: `logo-on-dark.svg` → `client/src/pages/Splash.jsx:9`;
`logo.svg` → `admin/src/layout/Sidebar.jsx:4` and `admin/src/pages/AdminLogin.jsx:4`;
`logo-on-red.svg` (`353f50e1…`, the only genuinely different mark) →
`admin/src/pages/AdminSplash.jsx:8`. `admin-base.css:151` notes `logo.svg` carries
`width="800" height="1080"`, so its intrinsic aspect ratio must be handled explicitly.

`app/resources/launcher/` holds `beonedge-logo-wide.svg` and `beonedge-logo-wide-red.svg`
(both unique), which are the **source artwork** for the generated PNGs, consumed by
`generate-android-assets.mjs`, plus full `mipmap-{m,h,x,xx,xxx}dpi` sets and splash variants
for `client/` and `admin/`. These are wired in by `build.gradle`'s
`res.srcDirs += file("../../resources/launcher/${boeVariant}")`.

Out-of-band: root `beonedge_logo.zip` (1283 B) and `beonedge logo.zip` (2041 B, note the
space). Neither is referenced by any build step or source file.

Orphan: `frontend_stack/colors_and_type.css` sits at the workspace root outside every
package and is not in the design-tokens `exports` map. `NEEDS RUNTIME VERIFICATION` whether
anything imports it.

## 12 · Performance observations

Not measured on this machine — these are structural observations with file evidence.

- **The whole client stylesheet loads on every route.** `ClientApp.jsx` imports
  `styles/mobile/index.css`, which imports fifteen files. There is no per-route CSS.
- **`FundDetail.jsx` refetches on every mount** because it bypasses the cache layer.
- **Fund detail is stale until TTL.** `CACHE_KEYS.fundList` and both `CACHE_PREFIXES` have no
  consumer and `invalidatePrefix` is never called, so publishing a new fund version does not
  evict `funds:detail:*`.
- **The approvals queue polls unconditionally** at 20 s on two routes and 120 s elsewhere.
  It does pause on `visibilitychange` and resync on focus/online, with a 5 s floor — that
  part is correct.
- **Admin loads three stylesheets per entry point**, re-imported by `NotFound` and
  `Forbidden`, plus `admin-screens-shared.css` from fourteen screens.
- **`app/index.html` carries an inline `<style>`** (`html, body { margin: 0; background: #F7F7F5 }`)
  so the native-splash → WebView → React handoff never flashes. Four places must stay
  `#F7F7F5`: the inline style, `app/src/index.css` `#root`, `values/colors.xml`
  `launchBackground`, and the `--be-ivory` token.
- **Budgets are enforced, not aspirational**: largest JS chunk ≤ 320 kB, largest CSS ≤ 160 kB,
  total assets ≤ 1400 kB, and the chunk import graph must be acyclic — because v0.9.0 shipped
  a blank-screen TDZ `ReferenceError` with zero failing tests.

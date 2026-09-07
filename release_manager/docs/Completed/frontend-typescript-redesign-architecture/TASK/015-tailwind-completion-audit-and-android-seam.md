# 015 — Closing the Tailwind migration: deduplication, the page audit, and the Android seam

Tasks 011 to 014 converted `src/features/` in four parallel slices. This task is everything that had
to happen after them: the foundation they were written against, the reconciliation the slices could not
do individually, the first time any of it was rendered, and the one native defect that survived.

## The foundation the slices used

Built before the slices ran, so they had a vocabulary to import rather than invent:

- `src/ui/tokens/theme.css` — the `@theme inline` bridge. Every Tailwind utility compiles to
  `var(--be-*)`, so `tokens-core.css` stays the live source of truth and remains the only file that
  reads `env(safe-area-inset-*)`. `--color-*`, `--font-*`, `--text-*`, `--radius-*`, `--shadow-*`,
  `--ease-*`, `--breakpoint-*` and `--container-*` are cleared to `initial` and redeclared from tokens,
  so an off-brand colour or a fifth breakpoint cannot be named.
- `src/ui/styles/` — one entry plus `base`, `patterns`, `utilities`, `status` in a declared cascade.
  The token files no longer contain a single selector.
- `src/ui/recipes/` — the typed class vocabulary. Thirteen files at the start, fifteen after the
  slices. Each pattern declared once and imported.

`src/ui/`, `src/app/` and `src/shells/` were converted by hand first, because they define the look and
the frame every feature inherits.

## What this task did after the slices

**Deduplication the compiler cannot see.** The four slices independently created value-identical
constants under different names in different files. `tsc`, `eslint`, the test suite and the emitted CSS
are all blind to it — a name clash is a compile error, a duplicated utility string is not. Twenty-five
duplicate groups were found by diffing every constant *body* across the recipe layer. The
genuinely-same concepts were folded (`FUND_NAME`, `POOL_NAME`, `SIP_STRONG` and
`PAYMENT_RECOVERY_TITLE` all became `ITEM_TITLE`; `FUND_META`, `SIP_META` and `STAT_HINT` became
`META_MUTED`; the two shells became `APP_SHELL`). What was left alone is trivial layout coincidence
like `flex flex-col gap-3`, where a shared name would couple unrelated components for no gain.

`recipes.test.ts` makes it permanent: one declaration per name, no two names sharing a non-structural
class string, no `env()`, no hex literal, only the four canonical breakpoints, and no stale allowlist.
The six deliberate coincidences each carry a reason string the test length-checks.

**The chart palette.** `DONUT_PALETTE` held eight raw hex literals in TypeScript — the last colour
values outside the token layer. They are now `--be-series-1` to `-8`.

## The page audit

`test_e2e/frontend-ts-audit.mjs`. It discovers routes from the route manifests rather than a
hand-maintained list, resolves dynamic segments from live links, and renders every route at 390, 834 and
1440 px against both variants: 141 page audits.

It found and drove fixes for:

- **`admin/app-config` overflowed horizontally at 390 px** (`scrollWidth` 481 against `clientWidth`
  390). `LIST_VALUE` was `flex-none`, so a long config value could neither shrink nor wrap.
- **Three controls below the 44 px touch floor on mobile**, despite `--be-target-min` existing for
  exactly that: the amount preset chips, the client Activity tabs, and the admin section-pages strip.
  Each now takes 44 px on touch and drops to 36 px only from `lg`.

Three of its checks had to be taught the difference between intentional and broken, which is the part
worth remembering. `AdminTable` is `min-w-[42rem]` inside an `overflow-x-auto` bezel and is *supposed*
to scroll sideways on a phone — the document-level `scrollWidth` was unaffected, which is what proves
the scroll container contains it. Desktop nav links are 36 px by design, because `--be-target-compact`
is the pointer-sized token, so the 44 px rule is touch-only. And text links inside table cells cannot be
44 px without destroying table density.

The audit now reports 0 errors and 0 warnings. It is not vacuous: its first run reported 7 errors and
303 warnings.

## The Android seam

A 132 px band above the page in a different colour. The interesting part is that it was **not** a bug in
the app's inset handling.

`SystemBars` is a core plugin bundled inside `@capacitor/android`, not a separate npm package — so the
`plugins.SystemBars` block in `capacitor.config.ts` was always valid, and because it is core it is not
allowlisted, which is why the plugin count stays five. Reading its source: on WebView below 140 it takes
a documented fallback, padding the WebView's parent natively and setting the injected
`--safe-area-inset-*` to zero, because Chromium's `env()` values are wrong on those versions. This
emulator runs WebView 133.

On that fallback path the inset strips are painted with the window background — and the window
background was pinned to `#F7F7F5`, a colour no screen actually renders. Fixed in D-034 by unifying the
launch, window, theme-colour and native-bar colour on `#F4F1E9` and routing the shells through `--be-bg`
so one token answers the question. `launchColour.test.ts` now follows the `var()` alias into the palette
and checks all five places.

The token layer already matched the official recommendation byte for byte —
`var(--safe-area-inset-top, env(safe-area-inset-top, 0px))` is exactly what the Capacitor docs prescribe
as the fallback — so no third-party safe-area or edge-to-edge plugin was needed.

## Dependencies and R8

Capacitor 8.3.4 → 8.5.0 (core, cli, android), with `app`, `browser`, `local-notifications` and
`capacitor-native-biometric` to current, all pinned exact. Nothing was incompatible; the stack was
trailing.

`minifyEnabled true`, `shrinkResources true` and `proguard-android-optimize.txt` sit on the **release**
build type, and this project has only ever built `assembleDebug` — so R8 had never run against this
stack. It does now: `assembleRelease` succeeds for both variants, shrinking 8,666,647 B to 2,312,387 B
(client) and 2,307,119 B (admin). The known Capacitor R8 failure mode is the deprecated
`proguard-android.txt`; this project was already on the optimize variant.

## Verified — TESTED

`npm run check` clean (typecheck, `eslint .`, 10 files / 122 tests, `generate:api:check`, both variant
builds, `check-phonepe-native-target`). `check-bundle-boots` 7 chunks. `check-android-dist` client
810,421 B, admin 828,393 B. CSS 84.26 kB. `check-frontend-contract-bypass` 94 operations, no bypass.
`frontend-ts-smoke.mjs` 71/71 with the money chain still exactly `₹51,25,000`. `frontend-ts-audit.mjs`
141 audits, 0/0. `runtime_contract`, `hermetic_branding` (13), `apk_logging_policy` (12) pass. Both new
guards negative-tested rather than assumed.

On `emulator-5554`: seam gone, measured `srgba(244,241,233)` in both strips against `srgba(240,235,226)`
for the page; client and admin both launch with no FATAL and no logcat token; admin reads
`ADMINISTRATOR CONSOLE` where client reads `CLIENT ACCESS`; an unreachable backend degrades honestly
with "We cannot reach BeOnEdge" rather than a blank screen; landscape rotation survives; root Back exits
to the launcher.

## Not verified — UNVERIFIED

The true edge-to-edge passthrough needs WebView ≥ 140 and this emulator has 133, so the branch that
populates `--safe-area-inset-*` with real values has never executed here — on a current device, confirm
the page paints under the bars and that
`getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top')` is non-zero. R8
at runtime is unproven because the release APKs are unsigned and nothing was installed from them.
Keyboard resize on the login inputs, the Back rules beyond root-exit, the recents thumbnail, the
biometric prompt and APK self-update SHA-256 all remain unobserved. Nothing involving money moving was
exercised, because no PhonePe credentials exist locally, which also left the admin refund, mandate and
support-ticket screens audited empty. `docker build` has still never been run for this frontend.

## Follow-ups

`MandateListScreen` and `MandateDetailScreen` still format rupees with a local `Intl.NumberFormat`
instead of `MoneyValue`, so two admin screens format money differently from the rest of the app.
`check-android-dist.mjs` matches its cross-target patterns against asset *names* only and has therefore
never verified leakage — the no-leakage claim in D-035 rests on manual APK inspection instead.
`TASK/README.md` omits entries 005 onward.

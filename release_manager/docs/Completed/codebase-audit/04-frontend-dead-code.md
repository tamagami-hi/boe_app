# 04 — Frontend dead code

All changes **TESTED**: typecheck, lint, 199 tests across 21 files, `npm run build`,
`check-bundle-boots` (7 chunks), `check-phonepe-native-target`. Net **−389 lines**.

## 1. There were no dead modules

Worth stating because it is the healthy result. An import graph over all 212 `.ts`/`.tsx` files
under `src/` — resolving `~/*` aliases, relative specifiers, static imports and `import()` calls —
found **zero zero-importer modules** beyond the three intended entry points (`main.tsx`,
`ClientShellRoot.tsx`, `AdminShellRoot.tsx`) and the ambient `vite-env.d.ts`. Every route manifest
entry resolves to a real screen file, and every screen file has at least one importer.

The rot was at export granularity, not module granularity.

## 2. Twenty-four dead exports

Criterion: zero references in any other file **and** exactly one occurrence in the declaring file.
That second condition is what distinguishes dead from over-exported; it narrowed 237 unreferenced
exports to 26 candidates, of which 24 were hand-written and 2 were generator output (§4).

| Module | Removed |
| ------ | ------- |
| `api/envelope.ts` | `isSuccessEnvelope` |
| `api/errors.ts` | `definitionFor` |
| `app/routing/buildRouter.tsx` | `useRouter` — a memoising wrapper; both shells call `buildRouter` directly |
| `app/routing/resolveDestination.ts` | `createDestinationResolver` |
| `domain/dates.ts` | `formatTime`, `formatRelativeDay`, `secondsUntil`, `hasElapsed`, `isDebitDay` (+ the now-orphaned `timeFormatter`) |
| `domain/status.ts` | `sipCollectionMode` |
| `features/app-update/updateDecision.ts` | `isBlocking` |
| `features/shared/queries.ts` | `useOrders`, `useOrder`, `useAppConfig`, `useEmailVerificationStatus` |
| `lib/env.ts` | `assertHttpMode` |
| `platform/lifecycle.ts` | `onVisibilityChange` |
| `platform/systemChrome.ts` | `pushSystemChrome` (see §3) |
| `shells/client/ClientFrame.tsx` | `CLIENT_TAB_IDS`, `CLIENT_DEFAULT_PATH` |
| `shells/client/clientRuntime.ts` | `clientRequiresNativeDevice` |
| `ui/patterns/AsyncBoundary.tsx` | `transportErrorVariant` |
| `ui/primitives/Card.tsx` | `InteractiveCard`, `Eyebrow` |
| `ui/primitives/Feedback.tsx` | `Divider` |
| `ui/recipes/text.ts` | `HERO_TITLE` |

Cascade removals: the `DIVIDER` and `CARD_INTERACTIVE` recipes in `ui/recipes/surface.ts`, the
`EYEBROW` import, `qk.client.appConfig()`, four generated-operation imports, and `isAndroid` /
`CLIENT_HOME_PATH` / `useMemo` imports left dangling.

Two of these deserve naming:

**`clientRequiresNativeDevice = () => isNative() && !isAndroid()`** — a guard that would refuse a
non-Android native shell. With no caller, it enforced nothing while reading as if iOS were
handled. A dead guard is worse than no guard: it implies a security posture that does not exist.

**Four dead query hooks** each wrap a live generated operation. Their absence is a signal, not
just dead weight — `getAppConfig` (the admin-published client app configuration) now has **no
reachable frontend consumer at all**, and client email-verification state is read through
`useEligibility` rather than `getEmailVerificationStatus`. That is a backend capability with no
frontend entrypoint; recorded in [08](08-retained-and-uncertain.md) §3.

## 3. `pushSystemChrome` and the subsystem it alone kept alive

The clearest cascade in the audit, and a pre-existing dead subsystem rather than one this work
created.

`platform/systemChrome.ts` held a stack of chrome states, a subscriber set, `notify()`,
`getSystemChrome()` and `subscribeToSystemChrome()`. `pushSystemChrome` was:

- the **only** writer to `stack`, and
- the **only** caller of `notify`,

and it had **no callers itself**. Therefore, in this tree as committed:

- `getSystemChrome()` has always returned `DEFAULT_CHROME` — `stack.at(-1)` was always `undefined`;
- `notify()` was unreachable;
- `subscribeToSystemChrome` could fire only its own initial synchronous call and **never emit a
  change** — a subscription API structurally incapable of doing what its name says.

`SystemBarsController.tsx` subscribed to it and re-applied on resume, so the observable behaviour
was: apply `DEFAULT_CHROME` on mount, re-apply on resume.

Collapsed to `getSystemChrome = (): SystemChrome => DEFAULT_CHROME`, with the stack, subscribers,
`notify` and `subscribeToSystemChrome` removed, and `SystemBarsController` simplified to apply on
mount and on resume.

**Behaviour is byte-identical**: `applySystemChrome(DEFAULT_CHROME)` on mount and on resume,
exactly as before. `DEFAULT_BAR_BACKGROUND` is untouched and `launchColour.test.ts` — which imports
that constant and pins it against the native bar colour, per D-034 — still passes. D-040's
`applySystemChrome` payload is unchanged.

## 4. The generated client lost 108 lines

`scripts/generate-api-client.mjs` emitted three things nothing imports:

```
export const OPERATIONS = { … }              // keyed by operationId
export type OperationId = keyof typeof OPERATIONS
export const OPERATION_IDS = Object.keys(OPERATIONS) as readonly OperationId[]
```

Every call site imports the individual operation symbol from the `export { … }` block instead.

Fixed **in the generator**, not its output, then regenerated: `src/api/generated/operations.ts`
315 → 207 lines. Safe because `packages/contracts/scripts/check-frontend-contract-bypass.mjs`
derives its operation count from the `export { … }` block, not the registry — verified by reading
`generatedOperationCount()`.

The generator was confirmed **idempotent** (a second run produced a byte-identical file) and the
diff against `HEAD` is 108 deletions with **zero additions**. `npm run generate:api:check` compares
generated output to git and therefore reports a difference while the change is uncommitted; it
passes once committed.

This also corrects a false finding: the registry's `logoutNativeSession: nativeLogout` entries
looked like duplicate aliases. They are not — the registry keyed by `operationId` while the export
block uses `exportName`. Two naming systems.

## 5. Duplicates consolidated

**Money formatting.** `domain/money.ts` owned `formatINR(paise)`, but three screens each built
their own `new Intl.NumberFormat("en-IN", …)` with identical options —
`orders/LumpsumInvestScreen.tsx` (which *also* imported `formatINR`),
`admin/mandates/MandateListScreen.tsx` and `admin/mandates/MandateDetailScreen.tsx`.

They are not literal duplicates of `formatINR`, because they format a rupees **number** while
`formatINR` takes a `Paise` string. So `domain/money.ts` gained `formatRupees(rupees, options)` as
the single presenter, `formatINR` now delegates to it, and all three call sites import it. One
owner of rupee presentation, three fewer formatter constructions.

The two admin screens still compute `row.amountPaise / 100` — floating-point division on money.
That is a **contract** defect, not a formatter one, and it is reported unchanged in
[08](08-retained-and-uncertain.md) §2.

**API error classification.** `ui/patterns/AsyncBoundary.tsx` defined:

```
const isSessionEndingError = (error: unknown): boolean =>
  isApiError(error) && (error.code === "AUTHENTICATION_REQUIRED" || error.code === "SESSION_INVALID")
```

which is the verbatim logic of `api/errors.ts:isSessionEnded`. The causal link is worth noting:
`isSessionEnded` appeared in the dead-export list **because** `AsyncBoundary` had re-derived it.
`AsyncBoundary` now imports it; the local copy and the dead `transportErrorVariant` are gone.

**Breakpoints — three declarations reduced to two.** `--be-bp-{sm,md,lg,xl}` in `tokens-core.css`,
`--breakpoint-*` in `theme.css`, and `BREAKPOINTS` in `lib/useBreakpoint.ts` all declared the same
four values. The `--be-bp-*` set is referenced by nothing — not by `var()`, not by `theme.css` —
and was removed. Two remain, which is the floor: one for Tailwind to generate from, one for JS
media queries. `BREAKPOINTS` was **wrongly reported dead** by the initial sweep;
`useBreakpoint`/`isCompact` are used by `FundListScreen.tsx` and `BREAKPOINTS` backs their queries.

**Premises investigated and disproved.** There is exactly one percent formatter, one date module,
one pagination hook (`usePagedQuery`, 24 call sites), one overlay stack, one `Skeleton`, one
`FormField`, one `ErrorState`, and one token store instantiated per scope. Reported so a future
sweep does not re-open them.

## 6. Dependency and Android permission

**`@capacitor/local-notifications` removed** from `package.json`, from
`capacitor.config.ts`'s `ADMIN_ANDROID_PLUGINS`, and `package-lock.json` regenerated (zero
references remain). It was in neither `BRIDGED_PLUGINS` nor `CORE_REGISTERED_PLUGINS` in
`platform/plugins.ts`, so no wrapper, no bridge, no import — it existed only to be packaged into
the APK.

**`android.permission.POST_NOTIFICATIONS` removed** from
`android/app/src/main/AndroidManifest.xml`. Its justifying comment cited
`LocalNotifications via updateNotification.js` — and **`updateNotification.js` does not exist
anywhere in the repository**. There is no `requestPermissions` or `checkPermissions` call in
`src/` or in the Android sources. The app declared a runtime notification permission it never
asks for and cannot use. Removing it shrinks the permission surface.

`android/app/src/main/assets/capacitor.plugins.json` still lists the plugin class, but it is
untracked and regenerated by `cap sync` (run by `emu/boe_update.sh` and the `android:sync`
scripts), so it converges on the next build.

`check-phonepe-native-target.mjs` — which pins both plugin allowlists — passes.

**UNVERIFIED: this changes APK contents.** Rebuild and install both variants:

```bash
cd frontend_stack_ts && npm run android:sync && npm run android:sync:admin
# then the emulator/device path in emu/boe_update.sh
```

## 7. Unused CSS tokens

Thirteen `--be-*` custom properties in `ui/tokens/tokens-core.css` whose only occurrence was their
own declaration: `--be-bp-sm/md/lg/xl`, `--be-gold-soft`, `--be-border-1-strong`,
`--be-font-brand`, `--be-font-code`, `--be-space-1`, `--be-space-3`, `--be-page-pad-y`,
`--be-opacity-disabled`, `--be-opacity-backdrop`.

Method note: only `tokens-core.css` is analysable this way. `theme.css` opens `@theme inline`,
where properties generate **utility classes** consumed by class name — 180 of its 357 properties
have no `var()` reference and that is not evidence of anything. No `theme.css` token was touched.

`--be-safe-*` was not touched: `safeArea.test.ts` asserts `tokens-core.css` is the sole reader of
`env(safe-area-inset-*)`, and it passes.

One loose end reported rather than removed: the `divider-fade` `@utility` in `ui/styles/status.css`
is now unreferenced following the `DIVIDER` recipe removal. Left because Tailwind `@utility`
reachability follows the same class-name rule as §7's method note, and a same-pass double removal
was not worth the risk.

## 8. Route link-map corrections

`CLIENT_LINK_MAP` and `ADMIN_LINK_MAP` are the reachability declarations `routeIntegrity.test.ts`
measures against. Three edges named a source screen that renders no such link. Each was confirmed
by reading the screen:

| Edge | Evidence | Change |
| ---- | -------- | ------ |
| `invest-sip → payment-status` | `SipStartScreen.tsx:138,185` navigate only to `/sips/:id` | removed |
| `sip-detail → payment-status` | `SipDetailScreen.tsx:333` links `/activity`, not `/activity/payments/:id` | changed to `sip-detail → activity` |
| `fund-aum → fund-aum-history` | the link is rendered in `AumOverviewScreen.tsx:119`, whose route id is `aum` | moved to `aum → fund-aum-history` |

`payment-status` remains reachable via `activity` and `invest-lumpsum`
(`ActivityScreen.tsx:186`, `LumpsumInvestScreen.tsx:143`), so no route lost reachability.

**Four further edges were reported stale and are not.** `overview → users/funds/audit/payments`
are rendered by `OverviewScreen.tsx:80-84,121-127`, which filters `ADMIN_ROUTES` by nav presence
and permission and renders `<Link to={route.path}>`. Dynamic rendering; no literal scan sees it.

`dashboard → notifications` was left in place: the bell is rendered by `ClientFrame.tsx:66,86`, the
shell around every client screen, so `notifications` genuinely *is* reachable from the dashboard.
Attributing a shell-level link to one screen is the least-wrong option available, since the map has
no concept of a frame-level edge.

### The enforcement limit, stated plainly

`routeIntegrity.test.ts` measures reachability from the **hand-written map**, not from rendered
JSX. D-062 says a route link map is a declaration, not evidence. That remains true, and this audit
did **not** close it.

A static guard asserting every map target is backed by a rendered path literal **was built and
reverted**. It false-positives on exactly the dynamic pattern above, so it would pressure a future
developer into deleting a correct edge — a worse guard than none. And it could not catch the three
defects found here anyway: those were *mis-sourced* edges, and attributing a link to a file is
defeated by both the shell case and the dynamic case.

D-062's requirement is soundly satisfiable only by the runtime crawl in
`test_e2e/frontend-ts-audit.mjs`, which reads the manifests and measures rendered links across
viewports. The three corrections above were made by manual inspection.

## 9. No obsolete frontend tests

No test file existed solely to cover code classified dead, so none was removed. `routeIntegrity.test.ts`
is *stale in substance* rather than dead in target — see §8 — and its assertions about
`CLIENT_LINK_MAP.sips` and `profile-legal` are sound, being backed by real rendered links in
`SipListScreen.tsx:65` and `LegalScreen.tsx:14,19`.

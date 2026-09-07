# 005 — Frontend dead code

Net −389 lines, the largest reduction of any area.

## No dead modules — the rot was at export granularity

Worth leading with because it is the healthy result. An import graph over all 212 `.ts`/`.tsx` files
under `src/` — resolving `~/*` aliases, relative specifiers, static imports and `import()` — found
**zero zero-importer modules** beyond the three intended entry points and the ambient
`vite-env.d.ts`. Every route manifest entry resolves to a real screen; every screen has an importer.

So the question was never "which files are orphaned" but "which exports are". That needed a
two-part test: zero references in any other file **and** exactly one occurrence in the declaring
file. The second half is what separates *dead* from *merely over-exported*, and it cut 237
unreferenced exports down to 26 honest candidates.

## The one that turned into a subsystem

`platform/systemChrome.ts` held a stack of chrome states, a subscriber set, `notify()`,
`getSystemChrome()` and `subscribeToSystemChrome()`. `pushSystemChrome` was:

- the **only** writer to `stack`,
- the **only** caller of `notify`,

and had **no callers itself**. Follow that through and the whole module was degenerate as committed:

- `getSystemChrome()` has always returned `DEFAULT_CHROME` — `stack.at(-1)` was always `undefined`;
- `notify()` was unreachable;
- `subscribeToSystemChrome` could fire only its own initial synchronous call and **never emit a
  change** — a subscription API structurally incapable of doing what its name promises.

`SystemBarsController.tsx` subscribed to it and re-applied on resume, so the real behaviour was:
apply `DEFAULT_CHROME` on mount, re-apply on resume.

Collapsed to `getSystemChrome = (): SystemChrome => DEFAULT_CHROME`, with the stack, subscribers,
`notify` and `subscribeToSystemChrome` gone, and `SystemBarsController` doing exactly what it always
did — apply on mount, apply on resume. **Behaviour is byte-identical.** `DEFAULT_BAR_BACKGROUND` is
untouched and `launchColour.test.ts`, which pins it against the native bar colour per D-034, still
passes.

This is the cascade rule in `../01-method-and-classification.md` §6 earning its place: one export
removed, then re-check, and a whole layer turns out to have been dead the entire time.

Note also *when* it was found — the final symbol sweep, because I had listed `pushSystemChrome` for
removal and omitted it from the script. Without the sweep the subsystem would have stayed.

## Two dead guards worth naming

**`clientRequiresNativeDevice = () => isNative() && !isAndroid()`** — a guard that would refuse a
non-Android native shell. With no caller it enforced nothing while reading as though iOS were
handled. A dead guard is worse than no guard: it implies a security posture that does not exist.

**Four dead query hooks** are a signal rather than just weight. Their absence means `getAppConfig` —
the admin-published client app configuration — now has **no reachable frontend consumer at all**, and
client email-verification state is read through `useEligibility` rather than
`getEmailVerificationStatus`. That is a backend capability with no frontend entrypoint, and it is
reported rather than resolved.

## Duplicates

**Money formatting.** `domain/money.ts` owned `formatINR(paise)`, and three screens each constructed
their own `new Intl.NumberFormat("en-IN", …)` with identical options — including
`LumpsumInvestScreen`, which imported `formatINR` *and* built its own formatter in the same file.

They were not literal duplicates: the local ones format a rupees **number**, `formatINR` takes a
`Paise` string. So `domain/money.ts` gained `formatRupees(rupees, options)` as the single presenter,
`formatINR` delegates to it, and all three call sites import it.

The two admin screens still compute `row.amountPaise / 100` — float division on money. That is a
**contract** defect, not a formatter one: three admin operations declare `amountPaise: z.number()`
while the rest of the contract uses the `Paise` string scalar. Reported under A-009, not fixed,
because changing a money wire format needs a coordinated release.

**Error classification.** `AsyncBoundary` defined a local `isSessionEndingError` that is the verbatim
logic of `api/errors.isSessionEnded`. The causal link is neat: `isSessionEnded` showed up in the dead
export list *because* `AsyncBoundary` had re-derived it. Consolidating fixed both symptoms at once.

**Breakpoints, three declarations → two.** `--be-bp-*` in `tokens-core.css`, `--breakpoint-*` in
`theme.css`, `BREAKPOINTS` in `useBreakpoint.ts`. The `--be-bp-*` set is referenced by nothing and
went. Two remain, which is the floor: one for Tailwind to generate from, one for JS media queries.

Several suspected duplicates were investigated and **disproved** — one percent formatter, one date
module, one `usePagedQuery` (24 call sites), one overlay stack, one `Skeleton`, one `FormField`, one
`ErrorState`, one token store per scope. Recorded so they are not re-opened.

## The generator, not its output

`scripts/generate-api-client.mjs` emitted an `OPERATIONS` registry plus `OperationId` and
`OPERATION_IDS`. Nothing imports any of them; every call site imports the individual operation
symbol from the `export { … }` block.

Fixed in the generator and regenerated: 315 → 207 lines. Before trusting that, two checks —
`check-frontend-contract-bypass.mjs` was read to confirm it counts operations from the `export { … }`
block and not the registry, and the generator was run twice to confirm byte-identical output.

Expect `npm run generate:api:check` to report a difference until the change is committed: it diffs
generated output against git. That is the gate working correctly.

## Dependency and permission

`@capacitor/local-notifications` was in neither `BRIDGED_PLUGINS` nor `CORE_REGISTERED_PLUGINS` —
no wrapper, no bridge, no import. It existed only to be packaged into the APK.

`android.permission.POST_NOTIFICATIONS` justified itself in a comment citing
`LocalNotifications via updateNotification.js` — and **`updateNotification.js` does not exist
anywhere in the repository**. No `requestPermissions` or `checkPermissions` call exists in `src/` or
the Android sources. The app declared a runtime notification permission it never asks for and cannot
use.

Both removed. `capacitor.plugins.json` still lists the class but is untracked and regenerated by
`cap sync`, so it converges on the next build.

## CSS tokens

Thirteen `--be-*` properties whose only occurrence was their own declaration.

Method note that matters: only `tokens-core.css` is analysable this way. `theme.css` opens
`@theme inline`, where properties generate **utility classes** consumed by class name — 180 of its
357 properties have no `var()` reference and that is not evidence of anything. No `theme.css` token
was touched, and `--be-safe-*` was left alone because `safeArea.test.ts` asserts `tokens-core.css` is
the sole reader of `env(safe-area-inset-*)`.

## Route link map

Three edges named a source screen that renders no such link, each confirmed by reading the screen:
`invest-sip → payment-status` (removed), `sip-detail → payment-status` (changed to `→ activity`),
`fund-aum → fund-aum-history` (moved to `aum`, where the link actually is). No route lost
reachability.

Four further edges were reported stale and **are not** — `overview → users/funds/audit/payments` are
rendered dynamically from `ADMIN_ROUTES`.

`dashboard → notifications` was kept even though `DashboardScreen` renders no such link, because
`ClientFrame` renders the bell on *every* client screen, so the reachability claim is true. A-008
records why understating reachability would be the worse error.

### The guard that was built and reverted

D-062 requires reachability measured from rendered links. A static guard asserting every map target
is backed by a rendered path literal was written, run, and thrown away: it fails on
`overview → users`, which is correct code. Shipping it would have pressured someone into deleting a
working edge to make a test pass.

It also could not have caught the three defects found here, which were *mis-sourced* edges —
attributing a link to a file is defeated by both the shell case and the dynamic case.

So D-062 stays unenforced by unit test, `../04-frontend-dead-code.md` §8 says so plainly rather than
implying otherwise, and the corrections were made by inspection.

## What to check next

**Both APKs need rebuilding and installing.** The plugin and permission removal changes APK contents
and is the only unverified item from this pass:

```bash
cd frontend_stack_ts && npm run android:sync && npm run android:sync:admin
```

Also loose: the `divider-fade` `@utility` in `ui/styles/status.css` is unreferenced after the
`DIVIDER` recipe removal, and `getAppConfig` has no frontend consumer — the second is a product
question, not a cleanup.

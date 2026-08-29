# 07 — TypeScript Frontend Target Architecture

## Principle

> The smallest clean implementation that satisfies the actual product requirements.

Concretely, a feature should read:

```
Route  →  Screen  →  Feature hook (query/mutation)  →  Generated typed client  →  Backend
```

Four layers. If a change needs a fifth, it needs a written reason.

## Location and isolation

```
boe_app/
├── backend_controller/         unchanged, canonical integration target
├── packages/contracts/         extended in Phase 0, shared by backend and both frontends
├── frontend_stack/             LEGACY — untouched, operational, deleted only in Phase 12
├── frontend_stack_ts/          NEW
├── release_manager/
└── test_e2e/
```

`frontend_stack_ts` depends on `backend_controller` through `packages/contracts` and on nothing
else in the repository. It must never import from `frontend_stack`, and `frontend_stack` must
never import from it. No adapter, bridge, or compatibility layer of any kind.

## Stack

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript 5.9, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` | The point of the exercise. `noUncheckedIndexedAccess` matters because most screens index into API arrays |
| UI | React 19 | Already the runtime; `useId`, `useOptimistic` and the ref-as-prop change all help here |
| Build | Vite 7 | Already in use; the three existing build gates are Vite-shaped |
| Router | React Router v7, declarative | The Android Back coordinator needs `useNavigate`/`useLocation` above the router; data-router loaders would fight TanStack Query. Do **not** opt into `v7_relativeSplatPath` behaviour changes without re-checking the splat-resolution tests |
| Server state | TanStack Query v5 | Replaces the bespoke `ResourceCacheProvider` with the same model — key-scoped entries, per-domain `staleTime`, prefix invalidation — plus cursor pagination, request deduplication and devtools. Requires TypeScript ≥ 5.6, satisfied |
| Client state | React Context, three providers only: session, overlay stack, toast | Nothing else in this app is genuinely global. No Redux, no Zustand |
| Forms | `react-hook-form` + `zodResolver` | Six forms are non-trivial (fund create, fund profile, AUM growth, client growth, SIP start, support ticket). The rest are controlled inputs |
| Validation | `zod` | Already the backend's and `packages/contracts`' validator; reusing the same schemas is the whole point |
| Styling | CSS custom-property token layer + **CSS Modules** per component | See below |
| Icons | `lucide-react`, named imports only | Already in use, tree-shakes, no icon-font payload |
| Charts | one small purpose-built SVG module | The legacy `Charts.jsx` + `chartMath.js` are a line/area/donut renderer in about 300 lines. A charting library would blow the 320 kB chunk budget |
| Native | Capacitor 8 + the three existing custom plugins | Ported verbatim, not reinvented |
| Tests | Vitest + Testing Library + jsdom | Already the toolchain; `vitest.setup.js` is reusable |
| Lint | ESLint 9 flat config + `typescript-eslint` | The legacy frontend has **no lint tooling at all** |

### Why CSS Modules and not Tailwind

1. ~~The APK enforces largest CSS ≤ 160 kB~~ **Superseded (D-028): the CSS ceiling is raised to
   640 kB and total assets to 2600 kB at the maintainer's direction, to fund a high-end visual
   layer.** CSS Modules remain the choice for the reasons below, not for byte count.
2. The design-token layer in `packages/design-tokens` already works and is **test-enforced** —
   in particular `tokens-core.css` is the sole legal owner of `env(safe-area-inset-*)`, and
   `safeArea.test.js` fails the build if any other stylesheet reads it or redeclares
   `--be-safe-*`. That contract exists because import-order shadowing was a real shipped
   defect. Utility classes would push safe-area handling back into arbitrary places.
3. CSS Modules give locally-scoped class names by construction, which structurally prevents the
   four-vocabulary collision (`be-*` / `apk-*` / `adm-*` / `ash-*`) that is the legacy
   frontend's defining problem.
4. Zero new build dependencies — Vite supports CSS Modules natively.

Tokens remain global custom properties in one place. Components consume them; they never
declare colours, spacing, radii, fonts, z-indices or safe-area values inline.

## Build targets

One application, two build-time targets, exactly as today — the mechanism is sound and there
is a documented reason for its precise shape.

```ts
// vite.config.ts
const target = process.env.VITE_BEO_APP_TARGET === 'client' ? 'client' : 'admin'
define: { 'import.meta.env.VITE_BEO_APP_TARGET': JSON.stringify(target) }
```

```ts
// src/main.tsx
const shell = import.meta.env.VITE_BEO_APP_TARGET === 'client'
  ? await import('./shells/client/ClientShellRoot')
  : await import('./shells/admin/AdminShellRoot')
```

**A single dynamic import on a ternary, and each shell module also exports `backPolicy` and
`probeReachability`.** This is not stylistic. Splitting the back policy into its own import
previously defeated dead-branch elimination and shipped the admin chunk plus its 82 kB
stylesheet into the client APK. `check-android-dist.mjs` fails a client build containing any
asset whose name matches `/admin/i`.

Three environment variables, all baked at build time, names unchanged because
`release_manager/export.sh` and `emu/boe_update.sh` both hardcode them:
`VITE_BEO_APP_TARGET`, `VITE_BEO_API_MODE`, `VITE_BEO_API_BASE_URL`.

`VITE_BEO_API_MODE` is retained **only** as an explicit http-required assertion at boot. There
is no fixture mode. If it is not `http`, the app renders a single configuration-error screen
rather than a fake signed-in user.

### Runtime-configurable API base — a deliberate improvement

`DEPLOYMENT_CONSTRAINTS_IMPLEMENTATION.md` records that because the API base is baked into
each Vite build, dev and prod archives are **not byte-identical promotable artifacts**, and
that the fix is to make the base runtime-relative or runtime-configured.

The new frontend resolves the base in this order:

1. `window.__BOE_API_BASE__` if present — injected by a tiny `/config.js` served by nginx,
   absent by default.
2. `import.meta.env.VITE_BEO_API_BASE_URL` if set.
3. Same-origin `/api` when running in a browser.
4. Hard failure in a Capacitor WebView, because `https://localhost` has no server to be
   same-origin with.

Rule 3 makes the browser images promotable immediately. Rule 4 keeps the APK honest — it must
always carry an absolute `https://` origin, which is why `emu/boe_update.sh` refuses to build a
target whose API origin is not `https://`.

## Directory design

```
frontend_stack_ts/
├── package.json                     name @beonedge/frontend-ts, type module, private
├── tsconfig.json / tsconfig.node.json
├── vite.config.ts / vitest.config.ts / vitest.setup.ts
├── eslint.config.mjs
├── index.html                       viewport-fit=cover, theme-color, inline launch style
├── Dockerfile                       3 stages, ARG VITE_BEO_APP_TARGET, nginx 8080, /health
├── nginx.conf
├── capacitor.config.ts              BOE_CAPACITOR_VARIANT gate, per-variant plugin lists
├── android/                         cap add android output + 3 custom Java plugins
├── resources/launcher/{client,admin}/
├── scripts/
│   ├── check-android-dist.mjs
│   ├── check-bundle-boots.mjs
│   ├── check-phonepe-native-target.mjs
│   └── generate-api-client.ts       reads packages/contracts descriptors
└── src/
    ├── main.tsx
    │
    ├── shells/
    │   ├── client/
    │   │   ├── ClientShellRoot.tsx        default export + backPolicy + probeReachability
    │   │   ├── ClientFrame.tsx            responsive: bottom nav ↔ top nav
    │   │   ├── ClientNavigation.tsx
    │   │   └── clientBackPolicy.ts
    │   └── admin/
    │       ├── AdminShellRoot.tsx
    │       ├── AdminFrame.tsx             responsive: sidebar ↔ bottom nav + domain strip
    │       ├── AdminNavigation.tsx
    │       └── adminBackPolicy.ts
    │
    ├── app/
    │   ├── providers/
    │   │   ├── AppProviders.tsx           the ordering contract, see below
    │   │   ├── QueryProvider.tsx
    │   │   ├── SessionProvider.tsx
    │   │   ├── OverlayStackProvider.tsx
    │   │   ├── ToastProvider.tsx
    │   │   └── NetworkStatusProvider.tsx
    │   ├── routing/
    │   │   ├── clientRoutes.ts            the manifest — single source of truth
    │   │   ├── adminRoutes.ts
    │   │   ├── buildRouter.tsx            generates <Routes> FROM the manifest
    │   │   ├── RequireSession.tsx
    │   │   ├── RequireRole.tsx
    │   │   ├── RequirePermission.tsx
    │   │   ├── RequireEligible.tsx
    │   │   └── resolveDestination.ts      the ONE trust boundary for remote URLs/paths
    │   ├── layouts/
    │   │   ├── Page.tsx / Page.module.css
    │   │   ├── PageHeader.tsx
    │   │   ├── Section.tsx
    │   │   ├── ContentGrid.tsx
    │   │   └── AuthLayout.tsx
    │   └── native/
    │       ├── NativeBackCoordinator.tsx
    │       ├── SystemBarsController.tsx
    │       └── ConnectivityBanner.tsx
    │
    ├── api/
    │   ├── http.ts                        the transport
    │   ├── envelope.ts                    re-export + narrow from @beonedge/contracts
    │   ├── errors.ts                      ApiError + typed code narrowing
    │   ├── idempotency.ts                 useIdempotencyKey
    │   ├── cursor.ts                      opaque cursor type + page helpers
    │   ├── generated/
    │   │   └── operations.ts              GENERATED from packages/contracts — do not edit
    │   └── session/
    │       ├── tokenStore.ts              in-memory sync read + async persistence
    │       ├── refresh.ts                 per-scope coalescing
    │       └── scope.ts
    │
    ├── domain/
    │   ├── money.ts                       Paise brand, paiseToRupees, rupeesToPaise, formatINR
    │   ├── status.ts                      payment/order/sip/mandate status → label + tone
    │   ├── dates.ts
    │   ├── fund.ts                        risk, lifecycle, monogram, return formatting
    │   └── permissions.ts                 PermissionCode union, hasAny, hasAll
    │
    ├── features/
    │   ├── auth/                    { api.ts, queries.ts, LoginScreen.tsx, SplashScreen.tsx }
    │   ├── email-verification/
    │   ├── funds/
    │   ├── portfolio/
    │   ├── activity/
    │   ├── orders/
    │   ├── payments/
    │   ├── sip/
    │   ├── statements/
    │   ├── notifications/
    │   ├── support/
    │   ├── legal/
    │   ├── profile/
    │   ├── device-security/
    │   ├── app-update/
    │   └── admin/
    │       ├── overview/ applications/ users/ funds/ fund-aum/ client-values/
    │       ├── receipts/ refunds/ payments/ mandates/ audit/ emails/
    │       └── content/ app-config/
    │
    ├── ui/
    │   ├── tokens/                  tokens.css, tokens-core.css, fonts.css, kit.css
    │   ├── primitives/              24 components, each with a .module.css
    │   ├── patterns/                14 application components
    │   └── charts/                  LineChart, AreaChart, DonutChart, chartMath.ts
    │
    ├── platform/
    │   ├── capacitor.ts             isNative, platform, lazy plugin resolution
    │   ├── secureStorage.ts
    │   ├── biometrics.ts
    │   ├── lifecycle.ts
    │   ├── appUpdate.ts             the AppUpdate plugin bridge
    │   ├── systemChrome.ts          the SystemChrome plugin bridge + the chrome stack
    │   ├── openExternal.ts
    │   └── errors.ts                PlatformError
    │
    └── lib/
        ├── useBreakpoint.ts
        ├── useDebouncedValue.ts
        ├── assertNever.ts
        └── env.ts                   resolveApiBase, assertHttpMode
```

### Rules the structure encodes

- **A feature module owns its screens, its queries and its API calls.** Nothing outside it
  imports its internals. There is no container layer doing every screen's fetching — that is
  what `pages/legacy/legacyRoutes.jsx` became.
- **`ui/` never imports from `features/`.** Enforced by an ESLint boundary rule.
- **`features/` never imports from `shells/`.** A feature must not know which shell renders it.
- **Only `api/` may call `fetch`.** No exceptions — the legacy `appUpdate.js` bypass is
  reproduced *inside* the transport as an explicit `unauthenticated: true` option instead.
- **Only `ui/tokens/tokens-core.css` may name `env(safe-area-inset-*)`.** Ported test enforces
  it.
- **Only `app/routing/resolveDestination.ts` may hand a remote-supplied path to the router.**

## Providers — the ordering contract

The legacy `NativeAppRoot` ordering is a requirement, not a preference, and it must be
preserved:

```tsx
<BrowserRouter>                          {/* outside: the coordinator needs useNavigate */}
  <QueryProvider>
    <NetworkStatusProvider>
      <OverlayStackProvider>             {/* outermost of the two: Back consults it first */}
        <SessionProvider scope={scope}>
          <ToastProvider>
            <SystemBarsController />      {/* effect-only, renders null */}
            <NativeBackCoordinator resolvePolicy={backPolicy} />
            <ConnectivityBanner />
            <AppUpdateGate />             {/* client shell only, ABOVE the routes */}
            {children}
          </ToastProvider>
        </SessionProvider>
      </OverlayStackProvider>
    </NetworkStatusProvider>
  </QueryProvider>
</BrowserRouter>
```

Six providers, each with a stated reason to exist:

| Provider | Owns | Why not a query or local state |
|---|---|---|
| `QueryProvider` | the TanStack Query client | — |
| `NetworkStatusProvider` | online/offline plus the last transport outcome | fed by every request; the banner must be global |
| `OverlayStackProvider` | the open-overlay stack | Android Back must close the top overlay before anything else, and Escape/scroll-lock/focus-trap must be centralised |
| `SessionProvider` | `{status, user, scope, endedReason}` | every guard and every request depends on it; the vault read must be synchronous |
| `ToastProvider` | transient confirmations | mutations across unrelated features need one surface |
| `AppUpdateGate` | mandatory-update enforcement | must sit **above the routes** so a mandatory update is enforced on the login screen too |

`SessionProvider` is **one component parameterised by scope**, not two — the legacy
`SessionContext` / `AdminSessionContext` split was a copy, differing only in a string.

## Routing

The manifest is the single source of truth and the router is **generated from it**, so
manifest-versus-router drift becomes structurally impossible instead of being caught by a test.

```ts
export interface RouteDef {
  readonly id: string
  readonly path: string
  readonly element: () => Promise<{ default: ComponentType }>
  readonly access: 'public' | 'session' | 'eligible'
  readonly role?: 'client' | 'admin'
  readonly permissions?: readonly PermissionCode[]
  readonly requiresAll?: readonly PermissionCode[]
  readonly allowTerminalAccount?: boolean
  readonly title: string
  readonly nav?: { domain: string; order: number; icon: IconName }
  readonly back: { parent: string } | { kind: 'home' } | { kind: 'exit' }
  readonly transactional?: boolean
}
```

`buildRouter(manifest)` emits the `<Routes>` tree, wrapping each element in the guards its
`access`, `role`, `permissions` and `requiresAll` imply, and lazy-loading via `element`.

Guards are **UX only**. The backend re-enforces every permission — `resolveAdminPrincipal`
re-reads roles and permissions from the database on every single request. A guard that lets
something through is a UX bug, not a security hole; a backend that lets something through is
the security hole.

`resolveDestination(value)` returns a discriminated union and is the only path from remote
content to the router:

```ts
type Destination =
  | { kind: 'internal'; path: string }
  | { kind: 'external'; url: string }
  | { kind: 'email'; address: string }
  | { kind: 'phone'; number: string }
  | { kind: 'refused'; reason: 'scheme' | 'cleartext' | 'protocol-relative' | 'self-origin' | 'unknown-route' }
```

Refuses `javascript:`, `data:`, cleartext `http:`, protocol-relative `//host`, the WebView's own
`https://localhost` origin, and any internal path not present in the manifest. **Four call
sites must use it**: notification `deepLink`, app-config quick-action `route`, disclosure
`investorCharterUrl` / `grievanceUrl`, and grievance escalation `destination`. The legacy code
uses it in three of the four — `Notifications.jsx:89` is the miss.

## API layer

### Generation, not hand-writing

`scripts/generate-api-client.ts` reads the `defineOperation` descriptors from
`@beonedge/contracts` and emits `src/api/generated/operations.ts`:

```ts
export const clientCreateOrder = {
  method: 'POST',
  path: '/v1/client/orders',
  authChannel: 'native-bearer',
  idempotency: 'required',
  body: CreateOrderBody,          // zod
  success: { status: 201, schema: OrderCreated },
  errorCodes: ['VALIDATION_FAILED', 'STATE_CONFLICT', 'IDEMPOTENCY_KEY_REUSED',
               'IDEMPOTENCY_IN_PROGRESS', 'DEPENDENCY_UNAVAILABLE'],
} as const satisfies Operation
```

One generic call site:

```ts
const order = await request(clientCreateOrder, {
  body: { fundId, amountPaise },
  idempotencyKey: key,
})
```

`request()` infers the response type from the descriptor, so `order` is fully typed with no
cast and no hand-written interface. Adding an endpoint means adding a descriptor to
`packages/contracts` — which the `contracts` CI job then type-checks, lints, OpenAPI-lints and
diff-checks. **This is the mechanism that prevents the new frontend from acquiring its own 60
uncontracted paths.**

`api/generated/` is committed and regenerated by a script. It is never edited by hand.

### The transport

`src/api/http.ts` reproduces every behaviour of the legacy `_util.js`, because each one exists
for a reason:

| Behaviour | Detail |
|---|---|
| Base URL | `resolveApiBase()` — the four-step order above |
| Auth | `Authorization: Bearer` read **synchronously** from `tokenStore`; `credentials: 'include'` always; `x-csrf-token` on non-GET when the scope has one |
| Headers | `Idempotency-Key` and `If-Match` supplied per call from the descriptor and options |
| Read retry | GET only, `[300, 900]` ms. **Writes are never retried** — `rules.md` §3: the `Idempotency-Key` exists so a *user* can retry deliberately |
| Timeout | 20 s via `AbortController`, and the deadline must cover **body reading**, not just headers |
| Errors | one `ApiError` carrying `code: ErrorCode`, `status`, `fields`, `retryable`, `retryAfterSeconds`, `requestId`; plus `TransportError` with `kind: 'timeout' \| 'offline'` |
| Connectivity | every attempt reports to `NetworkStatusProvider` |
| 401 | `refreshOnce(scope)` **coalescing concurrent refreshes per scope**, one rotation, one replay. On failure clear the scope and emit `session-invalidated`. Unauthenticated 401s (login) skip all of it |
| Envelope | always unwrap `data`; always surface `meta.page` separately for list operations; always surface `meta.idempotencyReplay` |
| Unauthenticated escape | `{ unauthenticated: true }` for `GET /v1/app/update` and `GET /v1/health`, which run before any session exists — inside the transport, not bypassing it |

**The refresh coalescing is not an optimisation.** The backend treats two parallel rotations of
the same refresh token as theft and revokes the whole session family. One in-flight promise per
scope is a correctness requirement.

### Query keys and staleness

```ts
export const qk = {
  client: {
    eligibility: (userId: string) => ['client', 'eligibility', userId] as const,
    portfolio:   ()               => ['client', 'portfolio'] as const,
    funds:       ()               => ['client', 'funds'] as const,
    fund:        (id: string)     => ['client', 'fund', id] as const,
    transactions:(f: Filter)      => ['client', 'transactions', f] as const,
    payments:    (s: Status)      => ['client', 'payments', s] as const,
    payment:     (id: string)     => ['client', 'payment', id] as const,
    sips:        ()               => ['client', 'sips'] as const,
    autopay:     (id: string)     => ['client', 'autopay', id] as const,
    // …
  },
  admin: { /* mirror */ },
} as const

export const STALE = {
  MONEY:       15_000,     // portfolio, transactions, payments, sips
  CATALOGUE:   300_000,    // funds, research, disclosures
  ELIGIBILITY: 60_000,
  CONFIG:      600_000,
  SESSION:     Infinity,   // invalidated by events, never by time
} as const
```

Every query declares a `staleTime` from `STALE`. There is no global default, deliberately —
that is what made the legacy per-domain policy legible.

Rules:

- Any money-moving mutation invalidates the `['client']` money prefix
  (`portfolio`, `transactions`, `payments`, `sips`). Invalidate, do not remove — keep showing
  data while refetching.
- Sign-out calls `queryClient.clear()`.
- **A change of user id clears the cache**, and only on a transition *away from* a known id, so
  a cold-start `null → user` does not discard what the launch path fetched. This prevents one
  investor's cached valuation being rendered to the next signer-in on a shared device.
- Fund detail is a normal query with `STALE.CATALOGUE`. Because the backend never invalidates
  `funds:detail:*` on publish, expect server-side staleness up to `catalogTtlMs` and do not try
  to defeat it client-side.

### Pagination

```ts
type Cursor = string & { readonly __brand: 'Cursor' }

useInfiniteQuery({
  queryKey: qk.admin.users(filters),
  queryFn: ({ pageParam }) => request(adminListUsers, { query: { ...filters, after: pageParam } }),
  initialPageParam: undefined as Cursor | undefined,
  getNextPageParam: (last) => last.meta.page.hasMore ? last.meta.page.nextCursor : undefined,
})
```

Two hard rules from the backend's cursor design:

1. **The cursor is opaque.** Never construct, parse, persist or reuse it across routes.
2. **A filter change must start a new query.** The cursor's payload contains a filter hash and
   `decodeCursor` fails closed with `CURSOR_INVALID` on a mismatch. Because the filters are
   part of the query key, TanStack Query gives this for free — which is exactly why the filters
   belong in the key.

There is no offset and no total count in the API. Build "Load more", never a numbered pager.

### Idempotency

```ts
function useIdempotencyKey<T>(scope: string, body: T): string
```

Mints `crypto.randomUUID()`, caches it per scope in a ref, and **re-mints when the serialised
body changes**. The same request retried reuses the key and safely replays; an edited request
gets a fresh key and cannot 409 against the earlier attempt. This is exactly the legacy
`helpers/idempotencyKeys.js` behaviour, which is correct.

Every operation whose descriptor says `idempotency: 'required'` gets one — including admin FAQ
writes, which the legacy console omits.

## Types

Sourced, in priority order:

1. **`@beonedge/contracts`** — envelope, `ErrorCode`, scalars, and every operation's request
   and response schema with its inferred type. This is the default.
2. **`src/domain/`** — presentation-facing domain types that are not wire types: labels,
   tones, derived view models.
3. **Local to a feature** — component props and form shapes only.

Money is a branded type so it cannot be confused with a display number:

```ts
export type Paise = string & { readonly __brand: 'Paise' }

export function paiseToRupees(p: Paise): number         // display only
export function rupeesToPaise(rupees: number): Paise    // request boundary only
export function formatINR(p: Paise, opts?): string
```

Conversion happens in exactly two places: `paiseToRupees` at the render boundary and
`rupeesToPaise` at the request boundary. No arithmetic on rupee floats. No rounding twice. No
number sent to the API. `rupeesToPaise` throws unless the result is a positive
`Number.isSafeInteger`.

Status enums are never rendered raw. `domain/status.ts` maps every backend status to
`{ label, tone }` with an exhaustive `switch` and `assertNever`, so adding a backend status
becomes a compile error rather than a blank badge.

`assertNever` is used at the end of every exhaustive switch over an API union. That is the main
reason `strict` mode earns its keep here.

## State classification

| Kind | Mechanism | Examples |
|---|---|---|
| Server state | TanStack Query | everything from the API |
| Session state | `SessionProvider` + `tokenStore` | status, user, scope, `endedReason` |
| Ephemeral UI state | `useState` in the owning component | open sheet, active tab, expanded row |
| Overlay stack | `OverlayStackProvider` | which overlay Back closes |
| Form state | `react-hook-form`, or `useState` for trivial forms | amounts, filters, drafts |
| Cross-navigation transient state | `localStorage`, namespaced, **with an expiry** | `boe.pendingPayment`, `boe.pendingAutoPaySetup`, 30 minutes |
| Persistent client preference | `localStorage` | device-security settings, last activity tab |
| Credentials | Capacitor Secure Storage on native; **HttpOnly cookie on web** | never `localStorage` on native |

The session status must distinguish three things, because conflating them is a real defect the
legacy code had and fixed:

```ts
type SessionStatus = 'restoring' | 'authenticated' | 'anonymous'
interface SessionState {
  status: SessionStatus
  user: User | null
  error: TransportError | null      // an outage, NOT a logout
  endedReason: 'expired' | null
}
```

`isRestoreFailure(error)` treats `timeout`, `offline` and `status >= 500` as an outage, so a
backend outage renders "we cannot reach BeOnEdge, retry" rather than signing the user out. The
legacy comment records that this check previously tested the wrong codes and therefore never
fired.

`hydrateTokenStore()` must complete **before** the first authenticated request, because the
transport reads the access token synchronously. Racing the two produced unauthenticated probes
on cold start.

## Error handling — one policy, no per-screen invention

`rules.md` §4 is binding: **an outage, a timeout and an empty collection must be visually
distinct.** `.catch(() => setItems([]))` is forbidden.

One component decides:

```tsx
<AsyncBoundary
  query={q}
  empty={<EmptyState … />}
  skeleton={<TableSkeleton rows={6} />}
/>
```

It renders, by inspecting the query state and the `ApiError` code:

| Condition | Rendering |
|---|---|
| `isPending` && no data | skeleton |
| `isPending` && has data | previous data + a subtle refreshing indicator |
| `TransportError.offline` | offline state + Retry — never "no results" |
| `TransportError.timeout` | timeout state + Retry |
| `AUTHENTICATION_REQUIRED` / `SESSION_INVALID` | nothing; the transport has already emitted `session-invalidated` and the guard redirects |
| `AUTHORIZATION_DENIED` | Forbidden state |
| `ACCOUNT_NOT_ACTIVE` | the terminal-account wall |
| `RESOURCE_NOT_FOUND` on a conditional endpoint | "Not configured in this environment" |
| `RESOURCE_NOT_FOUND` otherwise | not-found state |
| `retryable` (`STATE_CONFLICT`, `RATE_LIMITED`, `INTERNAL_ERROR`, `DEPENDENCY_UNAVAILABLE`) | error state + Retry, honouring `retryAfterSeconds` |
| any other code | error state, no Retry, `requestId` shown for support |
| success && empty array | the caller's `empty` |

Mutation errors are handled at the call site because they need domain-specific copy, but
through one helper that maps `ErrorCode` to a message and a recovery affordance. Specific
mappings that matter:

- `VALIDATION_FAILED` → set `error.fields` into the form. The backend's messages are already
  user-facing prose (`zodFieldErrors` rewrites every Zod message), so **display them verbatim**
  rather than inventing client copy.
- `STATE_CONFLICT` on an `If-Match` PATCH → refetch and re-present. Never blind-retry.
- `STATE_CONFLICT` on a `basisHash` commit → clear the preview and require a new preview.
- `IDEMPOTENCY_IN_PROGRESS` → wait `retryAfterSeconds` and retry **the same key**.
- `IDEMPOTENCY_KEY_REUSED` → a client bug; mint a new key and surface a generic failure.
- `RATE_LIMITED` on OTP resend → show a countdown from `retryAfterSeconds`.
- `DEPENDENCY_UNAVAILABLE` on OTP issue → "we could not send the email, try resend in N
  seconds", **not** "verification failed". The code was created; only the mail failed.

A `RouteErrorBoundary` wraps each route element so a render error degrades one screen, not the
app. The shell itself is wrapped separately.

## Payment safety rules

Non-negotiable, and each has a recorded reason.

1. **Return from PhonePe is never settlement evidence.** Browser navigation, UPI app return and
   the hosted page confirm nothing. Only authenticated provider callbacks and server-to-server
   reconciliation settle money. The UI shows *pending* on return, always.
2. **Validate `checkout.url` before navigating**, even though the backend already validated it
   against `PHONEPE_CHECKOUT_ALLOWED_ORIGINS`. Two independent checks on a URL that leaves the
   app.
3. **`checkout: null` means poll, not retry.** The dispatch claim is a one-writer lock; a
   second `/pay` for the same attempt returns `null` and the client must go to canonical status
   recovery.
4. **Persist the pending payment before navigating away, and verify the write.** If
   `localStorage` cannot be written, abort the checkout — otherwise the user leaves with no way
   back to their payment.
5. **Never auto-retry a write.** `rules.md` §3.
6. **Always send an `Idempotency-Key`** on every mutating operation.
7. **Never compute or trust a money value client-side.** Amounts are echoed from the server;
   the frontend only converts for display.

## Native integration

Ported behaviour-for-behaviour. The details are in
[08](08-responsive-web-mobile-layout-system.md); the architectural points:

- **One `NativeBackCoordinator`**, mounted once above the router, registering the
  `@capacitor/app` `backButton` listener **exactly once**, with all handler state in a ref.
  Re-registering per navigation risks zero or two listeners on one press.
- The five-rule priority order is preserved: overlay dismiss → transactional confirm →
  declared parent → primary-tab home → exit-if-home-or-public-unless-`canGoBack`.
- `onTransactionalBack` **must actually be wired** this time. In the legacy code it is a
  documented prop that `main.jsx` never passes, so rule 2 is inert. The new client shell passes
  a confirm handler for routes marked `transactional: true` — the invest and checkout screens.
- Back policy is **injected** per shell, so the coordinator stays target-neutral.
- `parentPathOf` substitutes route params, so `/funds/f1/invest/sip` resolves to `/funds/f1`,
  not to a template.
- Plugins are resolved lazily inside try/catch and every call is individually guarded, so an
  older APK without a plugin degrades instead of crashing.
- System chrome is a **stack** with `pushSystemChrome(...)` returning a pop function, so a
  full-screen sheet can darken the bars and restore them on close. Validation throws on a bad
  style or a non-hex background.
- Re-apply chrome on `onResume`, because Android can reset window appearance across resume.

## Testing strategy

Per `README.md` §2–3, tests are for critical logic only, not for ordinary functionality.
Justified here:

| Area | Test | Why justified |
|---|---|---|
| `domain/money.ts` | round-trip and boundary | financial calculation; a wrong conversion is monetary loss |
| `api/http.ts` 401 refresh | concurrent 401s produce exactly one rotation | a second rotation revokes the session family |
| `api/http.ts` retry policy | writes are never retried | duplicate payment prevention |
| `useIdempotencyKey` | stable per body, re-minted on change | duplicate payment prevention |
| `resolveDestination` | refuses `javascript:`, `data:`, cleartext, protocol-relative, self-origin, unknown internal | a security boundary over remote content |
| checkout orchestration | `checkout: null` polls; a failed pending-payment write aborts; a non-allowlisted URL is refused | money can be taken with no way back |
| `RequirePermission` | denies on missing permission | authorization UX, backed by server enforcement |
| route manifest integrity | every route mounted, every nav entry resolvable, every write route linked | navigation integrity is a stated requirement |
| `domain/status.ts` | exhaustive over every API union | a new backend status must be a compile error |
| safe-area contract | ported `safeArea.test.js` | silent APK layout failure |
| bundle contract | ported `check-android-dist.mjs` and `check-bundle-boots.mjs` | acyclic chunks and boot verification; v0.9.0 shipped a blank screen with zero failing tests |

Not tested by default: styling, spacing, typography, icons, labels, basic rendering, simple
formatting, navigation adjustments, straightforward CRUD screens.

## CI

A fourth job, added in Phase 1 alongside the existing three. The legacy `frontend` job stays
until Phase 12.

```yaml
frontend-ts:
  working-directory: frontend_stack_ts
  run: npm ci && npm run typecheck && npm run lint && npm test && npm run build
```

`npm run build` runs `vite build` plus `check-bundle-boots.mjs`, and the client-target build
additionally runs `check-android-dist.mjs`.

**Blocker B4 must be resolved in the same phase**: `check-frontend-contract-drift.mjs`
hardcodes `frontend_stack/packages/{client,admin,shared}`, so the new frontend is invisible to
the drift gate, and deleting the legacy frontend in Phase 12 will break the `contracts` job
with `ENOENT`.

## Explicitly rejected

| Rejected | Reason |
|---|---|
| Next.js / SSR | The product is an authenticated SPA packaged as an APK. SSR buys nothing and breaks the Capacitor model |
| A monorepo of new frontend packages | The legacy four-package split is precisely what let admin code lodge inside the client package. One package, enforced internal boundaries |
| Redux / Zustand | Server state is TanStack Query's job; three contexts cover the rest |
| A UI component library (MUI, Chakra, Radix-everything) | The 320 kB chunk budget, and the design language is specific. A handful of headless primitives will be hand-built |
| Tailwind | See above — token contract and CSS budget |
| A charting library | 320 kB budget; the existing SVG maths is ~300 lines |
| `openapi-fetch` as the client | The `defineOperation` descriptors carry auth channel, idempotency requirement and error codes, which OpenAPI paths alone do not |
| Codegen from a running server | The contract package is the source of truth, and CI already diff-checks the generated artefacts |
| A fixture / demo mode | It is a third untested environment that renders failures as emptiness |
| Preserving legacy URLs | No deep links, no App Links, no backend redirects to frontend paths, and PhonePe gets `redirectUrl: null` |
| A compatibility or adapter layer to `frontend_stack` | Forbidden by the greenfield boundary |
| Comments in source files | `rules.md` §1, in every language and every form. Intent goes in names; rationale goes in commit messages and these documents |

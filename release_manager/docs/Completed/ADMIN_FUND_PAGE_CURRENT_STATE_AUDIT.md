# Admin Panel → Funds and AUM: Current-State Forensic Audit

Audit date: 2026-08-21
Repository root: `/home/nethunter07/PROJECTS/boe_app`
Scope: `/admin/funds`, `/admin/funds/:fundId`, and every page under `/admin/aum/*`; inspection only; no application, schema, migration, configuration, test, or database changes were made.

## 1. Executive Summary

The current Admin Fund and AUM surfaces are routed React implementations with six canonical URLs:

- `/admin/funds` renders the issued-fund catalogue and create form.
- `/admin/funds/:fundId` renders a routed workspace for published terms, lifecycle, stock disclosures, and version history.
- `/admin/aum/current` renders the latest published AUM projection for the Fund catalogue.
- `/admin/aum/manage` selects one fund and initializes or grows its AUM.
- `/admin/aum/collective` previews and commits one growth command across selected funds.
- `/admin/aum/history` reads snapshot history and conditionally exposes append-only correction controls.

The active frontend starts at `frontend_stack/app/src/main.jsx`, selects the admin `BrowserRoot` whenever `VITE_BEO_APP_TARGET !== 'client'`, restores an admin session, mounts the admin shell, then routes through `Admin.jsx` to wrappers in the misleadingly named but **ACTIVE** `pages/legacy/legacyRoutes.jsx`. The Fund list uses a shared resource cache; the detail workspace and stock panel use direct `apiRequest` calls.

The active backend is Fastify. `runtime/composition.ts` registers `adminCatalogRoutes.ts`, whose handlers authenticate, authorize, validate with Zod, and call `adminCatalogRepository.ts` directly. There is no intervening Fund service layer. Kysely and parameterized Kysely SQL operate on PostgreSQL.

Core database tables directly used by this page are `funds`, `fund_versions`, `fund_disclosure_versions`, `fund_stock_disclosures`, and, read-only here, `fund_aum_snapshots`. Every Fund mutation also appends `audit_events`; `idempotency_records` is only touched if the caller supplies an `Idempotency-Key`. The current Fund frontend supplies none for catalogue or stock mutations, so its normal runtime path bypasses idempotency persistence.

Material current-state findings:

1. **Only the first 25 funds are reachable in the current UI.** The backend defaults `limit=25` and returns an authenticated next cursor, but `useAdminFunds` unwraps and discards envelope pagination metadata and there is no load-more control.
2. **Fund detail omits the disclosure body the edit form expects.** `listDisclosures()` selects only id/version/title/effective/created timestamps. `profileFromDetail()` reads `disclosures[0].body`, so an existing version opens with a blank required disclosure body.
3. **Create is non-atomic across two HTTP requests.** It first inserts a draft, then publishes version 1. A second-call failure leaves the draft persisted and the form reports failure without compensation.
4. **First-version publication immediately changes the fund to `published`.** This contradicts catalogue copy saying the pool stays draft until separately published from its workspace.
5. **“Archive and remove” does not remove anything.** `DELETE /v1/admin/funds/:id` updates state to `archived`; the list query does not filter archived funds, so the row remains visible. The PATCH lifecycle handler also permits an archived fund with a current version to return to `published`, contradicting “cannot be published again.”
6. **The create flow does not open the new workspace**, despite comments saying it does. The returned ID is ignored.
7. **Stock count can remain stale for up to the catalogue cache window.** Stock add/exit reloads the stock panel but does not invalidate `admin:funds`, even though that cached projection contains `stockCount`.
8. **The backend stock PATCH capability has no current Fund UI.** The UI can add and mark exited, but cannot edit an existing stock.
9. **Write controls are not permission-gated in the UI.** Entry requires only `funds.read`; read-only operators see create/publish/lifecycle/archive/stock-write controls and encounter backend 403 responses.
10. **Allocation, unallocation, redemption, and AUM mutation are not Fund-page actions.** Allocation occurs conditionally in the separate Investment Reviews workflow. AUM is a separate `/admin/aum/*` surface. There is no unallocation or redemption model/route in the current baseline.
11. **A separate AUM contract is broken:** `FundAumPanel` sends `amountPaise` for initialization, while the strict backend schema requires `aumPaise`. This is outside the Fund route proper but is a Fund-related frontend/backend conflict.
12. **The generated OpenAPI/contracts package contains no admin Fund contract.** Runtime schemas are the backend Zod definitions plus handwritten frontend objects and optional-property access.
13. **Successful create does not refresh the still-mounted catalogue.** Cache invalidation only nulls `updatedAt`; the mounted `useResource` effect does not rerun. Because create also does not navigate, the new fund can remain absent until remount or manual refresh.
14. **The Fund/AUM shell always loads the approvals queue without checking `applications.read`.** A principal with Fund/AUM access but without application access gets a hidden background 403 and a zero badge while the requested page itself remains usable.
15. **Two visible AUM write paths are non-functional.** Initialize and correction both send `amountPaise`; their strict backend schemas require `aumPaise`, so every submission reaches validation and returns 400.
16. **The 25-fund catalogue cap propagates across AUM.** Current shows at most 25 funds; Manage and History can select at most 25; Collective can target at most 25 even though its backend supports 100.
17. **AUM history is also truncated.** Both history consumers send no `limit`; the endpoint defaults to the newest 25 snapshots and provides no cursor, while the UI claims to show every publication.
18. **Collective explicit-delta mode is non-functional.** The frontend sends both `fundIds` and `items`; the backend's XOR refinement requires `items` with no `fundIds`, so every explicit preview returns 400.
19. **Real collective previews lose Before/After values in the UI.** The backend returns `beforeAumPaise`/`afterAumPaise`; the frontend only checks incompatible aliases, so those cells format undefined values.
20. **The frontend is not one design system.** A redesigned `.ash-*` shell surrounds legacy `.adm-*` operational pages that use `.be-*` kit controls; newer `.be-page`/section/grid primitives exist but Fund/AUM do not use them.
21. **Three active table treatments produce visibly different pages.** Fund catalogue and Current AUM use the intended responsive contract; Fund stocks and AUM history are effectively browser-default tables; collective preview applies the table class at the wrong DOM level.
22. **Dark-mode and status contrast are materially broken.** The active Fund state-badge family fails AA for several light states and all dark states; AUM result/error colors also fail; the collective nested preview can place ivory text on a hardcoded near-white surface.
23. **Keyboard/mobile affordances are inconsistent.** Fund search/filter explicitly remove focus outlines without replacement, many controls are below the repository's 44 px target, and the Fund workspace tab strip competes with the sticky shell header.
24. **AUM navigation and visual hierarchy are duplicated.** Its four in-page chips repeat desktop navigation and the mobile domain strip; headings repeat shell titles, while the same Fund entity changes noun, form-label style, badge family, and action hierarchy across adjacent views.

The configured local frontend uses `http://127.0.0.1:47502`; the local backend resolves PostgreSQL at `127.0.0.1:5433`, database `boe_local` (credentials redacted). Neither endpoint was listening during this audit. Therefore the configured local target is proven, but current row contents, physical schema state, and applied migration versions are **UNKNOWN**. Tracked release configuration instead builds the admin with relative `/api` and routes it through nginx to the selected dev/prod backend and its isolated PostgreSQL container.

## 2. Fund Page Entry Point

| Stage | Evidence | Classification |
|---|---|---|
| HTML/Vite entry | `frontend_stack/app/index.html`; `frontend_stack/app/src/main.jsx:29-53` | ACTIVE |
| Target selection | `main.jsx:30-32`: `client` selects `ClientRoot`; every other value selects `BrowserRoot` | ACTIVE / build-conditional |
| Admin root | `frontend_stack/app/src/BrowserRoot.jsx:12-15,52-79` | ACTIVE |
| Session gate | `BrowserRoot.jsx:26-44,67` (`RequireAdmin`) | ACTIVE |
| Admin route table | `frontend_stack/packages/admin/src/pages/Admin.jsx:56-129` | ACTIVE |
| Catalogue route | `Admin.jsx:75`: `funds` → `Permitted` → `FundsRoute` | ACTIVE |
| Workspace route | `Admin.jsx:76`: `funds/:fundId` → `Permitted` → `FundWorkspaceRoute` | ACTIVE |
| Old ops URLs | `Admin.jsx:49-54,101-106` | CONDITIONAL redirects only |
| Old tab URL | `navigation/legacyTabMap.js:9-35`; `pages/LegacyTabRedirect.jsx:1-7` | CONDITIONAL redirect only |

`pages/legacy/legacyRoutes.jsx` is not legacy at runtime. `Admin.jsx:5-19` imports it directly, and its `FundsRoute`/`FundWorkspaceRoute` wrappers are the sole route elements for the canonical Fund URLs.

## 3. Frontend Component Tree

```text
app/index.html
└─ main.jsx::boot
   └─ BrowserRouter
      └─ NativeAppRoot
         └─ BrowserRoot
            └─ AdminSessionProvider
               └─ ResourceCacheProvider
                  └─ RootErrorBoundary
                     └─ Routes
                        └─ RequireAdmin
                           └─ Suspense + RouteErrorBoundary
                              └─ Admin
                                 └─ Permitted
                                    └─ AdminShell
                                       └─ ToastProvider
                                          └─ ApprovalsQueueProvider
                                             ├─ AdminCacheEvictor
                                             └─ ShellFrame
                                                ├─ Sidebar / TopBar / mobile navigation
                                                └─ Outlet
                                                   ├─ FundsRoute
                                                   │  ├─ AdminReadError
                                                   │  └─ FundsListScreen
                                                   │     └─ FundProfileForm (conditional create)
                                                   └─ FundWorkspaceRoute
                                                      └─ FundWorkspace
                                                         ├─ FundProfileForm (`section=profile`)
                                                         ├─ FundStockListPanel (`section=stocks`)
                                                         └─ inline version history (`section=history`)
```

Relevant code: `BrowserRoot.jsx:52-79`, `AdminShell.jsx:18-81`, `legacyRoutes.jsx:52-73`, `FundsListScreen.jsx:29-183`, and `FundWorkspace.jsx:37-296`.

## 4. Frontend Dependency / Import Map

| Artifact | Responsibility | Runtime status |
|---|---|---|
| `app/src/main.jsx` | Target selection and React boot | ACTIVE |
| `app/src/BrowserRoot.jsx` | Admin session/cache/error/router providers | ACTIVE |
| `admin/src/pages/Admin.jsx` | Canonical and compatibility routes | ACTIVE |
| `admin/src/pages/legacy/legacyRoutes.jsx` | Thin route-to-data wrappers | ACTIVE |
| `admin/src/navigation/nav.js` | Fund nav metadata and `funds.read` presentation gate | ACTIVE |
| `admin/src/layout/AdminShell.jsx` | Shell providers, navigation, global approvals badge | ACTIVE |
| `admin/src/data/adminResources.js` | `admin:funds` cache resource and invalidation | ACTIVE |
| `shared/src/data/ResourceCacheProvider.jsx` | Cache, in-flight dedupe, stale time, refresh | INDIRECTLY ACTIVE |
| `admin/src/helpers/loadAdminData.js` | HTTP-mode gate, collection extraction | ACTIVE |
| `admin/src/helpers/formatters.js` | Fund list normalization/paise-to-rupees mapping | ACTIVE, with stale aliases |
| `admin/src/data/useFundMutations.js` | Create/version/lifecycle/archive requests | ACTIVE |
| `admin/src/screens/fundOps/FundsListScreen.jsx` | Catalogue, local filters, create surface | ACTIVE |
| `admin/src/screens/fundOps/FundWorkspace.jsx` | Detail read, lifecycle, sections/history | ACTIVE |
| `admin/src/screens/fundOps/FundProfileForm.jsx` | Shared create/new-version form | ACTIVE |
| `admin/src/screens/fundOps/fundOpsModel.js` | states, form transform, validation | ACTIVE |
| `admin/src/screens/FundStockListPanel.jsx` | Stock list/add/exit | CONDITIONAL (`section=stocks`) |
| `client/src/services/_util.js` | API base, fetch, credentials, CSRF, retry, envelope unwrap | INDIRECTLY ACTIVE |
| `client/src/store/AdminSessionContext.jsx` | restore/login/logout session state | INDIRECTLY ACTIVE |
| `client/src/services/authApi.js` | cookie/native admin auth and refresh | INDIRECTLY ACTIVE |
| `client/src/auth/sessionVault.js` | cached principal/CSRF or native token storage | INDIRECTLY ACTIVE |
| `admin/src/data/ApprovalsQueueProvider.jsx` | shell-wide approvals badge request/poll | INDIRECTLY ACTIVE |
| `client/src/services/adminApplicationsApi.js` | shell approval list calls | INDIRECTLY ACTIVE |
| `StateBadge`, `StatTile`, `I`, `EmptyTableRow`, `SkeletonTableRow` | visible primitives | INDIRECTLY ACTIVE |
| `styles/desktop/admin.css`, `admin-screens-shared.css` and imported modules | styling | ACTIVE, partly stale |

There is no TypeScript type, frontend DTO, Zod schema, generated contract import, Redux store, or Fund-specific React context in the active frontend path.

## 5. Runtime Load Sequence

### 5.1 Browser admin

1. `main.jsx::boot()` chooses `BrowserRoot`.
2. `AdminSessionProvider` hydrates the vault and calls `currentUser({scope:'admin'})` (`AdminSessionContext.jsx:25-43`).
3. Browser transport calls `GET /v1/auth/web/csrf`; native admin uses a stored bearer token and calls `GET /v1/admin/session` (`authApi.js:408-446`).
4. `RequireAdmin` waits while restoring, redirects if anonymous/non-admin, or mounts `/admin/*` (`BrowserRoot.jsx:26-44`).
5. `AdminShell` mounts `ApprovalsQueueProvider`. Independently of Fund data, it walks `GET /v1/admin/applications?status=submitted&limit=100[&after=...]` for the navigation badge (`ApprovalsQueueProvider.jsx:50-89`; `adminApplicationsApi.js:20-61`). On Fund pages it polls every 120 seconds and refreshes on visibility/focus/online (`ApprovalsQueueProvider.jsx:19-23,91-130`). This mount is unconditional: it does not check `applications.read`, so a Fund-only principal can generate a background 403 that is retained in provider metadata but not displayed on the Fund page.
6. `Permitted` checks `canAccessPath(user, pathname)`. `/admin/funds` and descendants require `funds.read` (`nav.js:69-85,295-320`).
7. `FundsRoute` mounts `useAdminFunds`, whose key is `admin:funds` and stale time is two minutes (`adminResources.js:27-29,43-61`; `ResourceCacheProvider.jsx:283-292`).
8. Cache miss/stale entry invokes `loadAdminCollection('/v1/admin/funds')` → `apiRequest` → `GET {apiBase}/v1/admin/funds`.
9. `apiRequest` unwraps the success envelope's `data`; `extractAdminCollection` selects `items`; `normalizeFundRow` maps rows; `FundsListScreen` renders.

### 5.2 Fixture mode

If `VITE_BEO_API_MODE !== 'http'`, `loadAdminCollection` returns `[]` for funds and makes no request (`loadAdminData.js:46-55`). There is no Fund fixture in `adminCollections.js:34-44`. Mutations still reach `apiRequest`, which throws `FixtureModeError` before network (`_util.js:233-249`).

### 5.3 Workspace

`FundWorkspace` does not use the resource cache. Its mount effect calls `GET /v1/admin/funds/:fundId` directly (`FundWorkspace.jsx:51-64`). Profile and history use that response. The stock section, when selected, makes an additional `GET /v1/admin/funds/:fundId/stocks` even though the detail response already included `stocks`.

## 6. User Action → Code Execution Mapping

### 6.1 Catalogue page

| UI element | Event/function | API | Backend | Database effect |
|---|---|---|---|---|
| New pool | `setCreating(true)` | None | None | None |
| Search pools | `setQuery` → local `useMemo` filter | None | None | None |
| State dropdown | `setStateFilter` → local filter | None | None | None |
| Open | React Router link to `/admin/funds/:id` | Workspace mount GET | `getFund` | Read only |
| Create Cancel | `setCreating(false)` | None | None | None |
| Create submit | `FundProfileForm.submit` → validate/transform → `create` → `handleCreateFund` | POST fund, then POST version | `createFund`, then `publishVersion` | Inserts fund, disclosure, version, audits; updates fund pointer/state |
| Read-error Try again | resource `refresh()` | GET funds | `listFunds` | Read only |

There is no server-side search, filter, sort, or pagination control. Stats are display-only.

After a successful create, `invalidate('admin:funds')` only sets the cache entry's `updatedAt` to null (`ResourceCacheProvider.jsx:152-160`). The mounted `useResource` load effect is not keyed on that timestamp (`:245-251`), so invalidation alone does not refetch. Because the component also stays on the catalogue, the just-created fund can remain absent until a remount or explicit refresh. If phase 1 returns a success payload without `fund.id`, the hook skips phase 2 but still invalidates and shows the “first version published” success toast (`useFundMutations.js:39-49`).

### 6.2 Workspace

| UI element | Event/function | API | Backend | Database effect |
|---|---|---|---|---|
| Back to pools | Link | None | None | None |
| Publish to clients / Move to paused / archived | First click `setConfirming`; confirm `changeState` | PATCH fund `{status}` | `patchFundState` | Updates `funds`; appends audit |
| Archive and remove | First click confirm; confirm `remove` | DELETE fund | `patchFundState(...,'archived')` | Updates `funds.state`; appends audit; no DELETE SQL |
| Confirmation Cancel | `setConfirming('')` | None | None | None |
| Profile tab | `selectSection('profile')` | None | None | None |
| Publish new version | form submit → `publish` → `handlePublishVersion` | POST versions | `publishVersion` | Inserts disclosure/version, updates fund, audit |
| Stocks tab | `selectSection('stocks')`; conditional mount | GET stocks | `listStocks` | Read only |
| History tab | `selectSection('history')` | None | None | Uses detail response only |
| Detail Try again | `load()` | GET detail | `getFund` | Read only |

### 6.3 Stock section

| UI element | Event/function | API | Backend | Database effect |
|---|---|---|---|---|
| Name/quarter/weight fields | local setters | None | None | None |
| Add stock | `onAdd` | POST stocks | `addStock` | Insert `fund_stock_disclosures`; audit |
| Mark exited (first click) | `setConfirmExit(id)` | None | None | None |
| Confirm exit (second click) | `onExit` | DELETE stock | `exitStock` | Update row to `exited`; audit |
| Exited holdings disclosure | native `<details>` toggle | None | None | None |

No active button is missing an event handler. Dead controls exist only in the unreachable UI-kit prototype described later.

## 7. Frontend API Calls

| Trigger | Method/path | Request body / headers | Frontend response use |
|---|---|---|---|
| Session restore, browser | GET `/v1/auth/web/csrf` | cookie; credentials included | principal + CSRF token |
| Session restore, native admin | GET `/v1/admin/session` | bearer | principal/permissions |
| Shell badge | GET `/v1/admin/applications?status=submitted&limit=100[&after]` | admin auth | submitted application count |
| Catalogue load | GET `/v1/admin/funds` | no explicit query | `data.items`, normalized; page metadata lost |
| Detail load/reload | GET `/v1/admin/funds/:fundId` | encoded UUID | `fund`, `versions`, `disclosures`; returned `stocks` unused |
| Create phase 1 | POST `/v1/admin/funds` | `{slug}` | `fund.id` |
| Create phase 2 / edit | POST `/v1/admin/funds/:fundId/versions` | transformed terms + disclosure | result ignored; reload/invalidate |
| Lifecycle | PATCH `/v1/admin/funds/:fundId` | `{status}` | result ignored; reload |
| Archive | DELETE `/v1/admin/funds/:fundId` | none | result ignored; navigate list |
| Stock load/reload | GET `/v1/admin/funds/:fundId/stocks` | none | `items` |
| Stock add | POST `/v1/admin/funds/:fundId/stocks` | name, quarter, optional numeric weight, computed sort order | result ignored; reload |
| Stock exit | DELETE `/v1/admin/funds/:fundId/stocks/:stockId` | none | result ignored; reload |
| 401 recovery, browser | POST `/v1/auth/web/refresh` | cookie | rotates cookie/CSRF then replays once |
| 401 recovery, native | POST `/v1/auth/native/refresh`, then GET `/v1/admin/session` | refresh token + rotation ID | rotates token, reloads principal |

`apiRequest` behavior is defined at `_util.js:233-333`: 20-second default timeout, JSON, `credentials:'include'`, bearer when available, `x-csrf-token` on non-GET, two transport retries for GET only (300/900 ms), one session-refresh replay on 401, and default envelope unwrapping.

## 8. Backend Route and Handler Mapping

All routes below are registered by `registerAdminCatalogRoutes` at `adminCatalogRoutes.ts:563-588`, called from `runtime/composition.ts:391-403`.

| Method/path | Handler | Permission / CSRF | Repository calls |
|---|---|---|---|
| GET `/v1/admin/funds` | `listFunds` (`:178-197`) | `funds.read`; no CSRF | `list` |
| GET `/v1/admin/funds/:fundId` | `getFund` (`:199-231`) | `funds.read`; no CSRF | `findOne`, then `listVersions`, `listStocks`, `listDisclosures` in parallel |
| POST `/v1/admin/funds` | `createFund` (`:233-260`) | `funds.write`; CSRF | `slugExists`, `insertFund`, audit append |
| POST `/v1/admin/funds/:fundId/versions` | `publishVersion` (`:262-358`) | `funds.write`; CSRF | lock, next versions, inserts, `setCurrentVersion`, audit |
| GET `/v1/admin/funds/:fundId/stocks` | `listStocks` (`:360-376`) | `funds.read`; no CSRF | `listStocks` |
| POST `/v1/admin/funds/:fundId/stocks` | `addStock` (`:378-428`) | `funds.write`; CSRF | lock, insert stock, audit |
| PATCH `/v1/admin/funds/:fundId/stocks/:stockId` | `editStock` (`:430-479`) | `funds.write`; CSRF | find/update stock, audit |
| DELETE `/v1/admin/funds/:fundId/stocks/:stockId` | `exitStock` (`:481-516`) | `funds.write`; CSRF | find/update stock, audit |
| PATCH `/v1/admin/funds/:fundId` | `patchFundState` (`:518-560`) | `funds.write`; CSRF | lock/set state, audit |
| DELETE `/v1/admin/funds/:fundId` | same handler, forced archive | `funds.write`; CSRF | lock/set archived, audit |

The PATCH-stock route is registered but never called by the current admin frontend.

### Runtime request and response schemas

The authoritative request schemas are the strict Zod objects at `adminCatalogRoutes.ts:71-109`; unknown keys are rejected. `fundId` and `stockId` path parameters are UUIDs. The exact accepted shapes are:

| Operation | Parsed request schema |
|---|---|
| List | query `{after?: nonempty string, limit?: coerced integer 1..100 = 25}` |
| Create | `{slug: lowercase-hyphen slug, 1..120 characters}` |
| Publish version | `{name: string 1..200, category: string 1..200, objective?: string <=20000 = '', riskLevel: low\|moderate\|high\|very_high, returnTier?: low\|moderate\|high\|null, minimumSipPaise?: coerced safe nonnegative integer = 0, minimumPurchasePaise?: same, minimumDurationMonths?: coerced positive integer <=1200\|null, recommendedHoldingMonths?: same, disclosure:{title:string 1..200,body:string 1..20000}}` |
| Add/edit stock | `{stockName:string 1..200, quarterLabel:/^Q[1-4] FY\d{2}$/, weightPercent?: coerced number 0..100\|null, sortOrder?: coerced integer 0..100000 = 0}` |
| Lifecycle PATCH | `{status:'published'\|'paused'\|'archived'}` |
| DELETE fund/stock | no body parsed |

Every JSON response uses `SuccessEnvelope<T> = {ok:true,data:T,error:null,meta:{requestId,timestamp,idempotencyReplay?,page?}}` or `ErrorEnvelope = {ok:false,data:null,error:{code,message,fields?,retryable},meta:{requestId,timestamp,...}}` (`http/envelope.ts:8-58`). The frontend transport normally returns only `data`.

Runtime success `data` shapes are:

- list: `{items: Fund[]}`, with `meta.page={nextCursor,limit,hasMore}`;
- detail: `{fund,versions,stocks,disclosures}`;
- create: `{fund:{id,slug,status,createdAt}}`;
- publish version: `{fundId,status,fundVersionId,version,disclosureVersionId}`;
- stock list: `{items: Stock[]}`; stock mutations: `{stock: Stock}`;
- lifecycle/delete: `{fundId,status,version}`.

`Fund` is the `mapFund` projection at `adminCatalogRoutes.ts:111-139`: `id`, `slug`, `status`, version terms, `currentVersion/currentVersionId`, nullable nested `aum`, `stockCount`, publication/create/update timestamps, and row `version`. `Stock` is the repository row mapped to ISO timestamps. Version and disclosure arrays are repository projections mapped to ISO timestamps; critically, the disclosure projection omits `body`. No frontend runtime parser validates these success objects.

## 9. Service / Repository / Data-Access Flow

There is **no Fund service layer**. The real chain is:

```text
Fastify route handler
→ resolveAdminPrincipal / requireAnyPermission
→ parseOrThrow(Zod schema)
→ optional mutate()/UnitOfWork transaction
→ AdminCatalogRepository
→ Kysely query or parameterized Kysely sql template
→ PostgreSQL
```

`createUnitOfWork` owns transactions (`db/database.ts:13-30`). `adminCatalogRepository.ts:174-420` is the authoritative Fund-page data access implementation. It mixes Kysely's fluent query builder with Kysely `sql` templates; both are parameterized.

Every successful mutation invokes `auditRepository.append` in the same transaction. `mutate()` checks an optional idempotency key (`adminCatalogRoutes.ts:141-171`). If absent, it simply executes one transaction (`:153-156`). All current Fund/stock frontend calls omit the header, so `idempotency_records` is not part of their normal call chain.

## 10. Database Connection and URL Configuration

### Proven local repository configuration

- Frontend `frontend_stack/app/.env`: `VITE_BEO_API_MODE=http`, `VITE_BEO_API_BASE_URL=http://127.0.0.1:47502`.
- Backend `backend_controller/.env`: development, `HOST=0.0.0.0`, `PORT=47502`.
- Local `DATABASE_URL`, sanitized: `postgresql://<redacted>@127.0.0.1:5433/boe_local`.
- At audit time, no listener answered on local 47502 or PostgreSQL 5433; `pg_isready` reported no response. Live row/schema inspection was therefore impossible.

`parseDatabaseConfig` requires `DATABASE_URL` and parses pool/timeouts (`db/config.ts:25-73`). Defaults: pool 10, connection timeout 3000 ms, idle timeout 10000 ms, statement timeout 10000 ms, idle-in-transaction timeout 15000 ms. `createPool` passes the connection string to `pg.Pool` and applies timeouts per connection (`db/pool.ts:34-58`). `createDatabase` wraps the pool in Kysely's `PostgresDialect` (`db/database.ts:1-11`).

### Tracked release wiring

- Admin images are built with `VITE_BEO_APP_TARGET=admin`, HTTP mode, and `${ADMIN_API_BASE:-/api}` (`release_manager/export.sh:164-196,238-245`).
- nginx strips `/api/` before proxying (`release_manager/nginx/admin.tailscale.conf:64-71,140-149`).
- Dev compose constructs `DATABASE_URL=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}` and defaults the tracked template DB name to `boe_app_dev` (`dev_release/docker-compose.dev_app.yml:51-66`; `.env.example:79`).
- Prod uses the same container pattern and template DB `boe_app` (`prod_release/docker-compose.prod_app.yml:51-67`; `.env.example:72`).
- PostgreSQL is 16-alpine, internal-network only, persistent volume; migrations gate backend startup (`dev compose:214-267`, equivalent prod section).

Which remote stack the running private admin hostname reaches is operational state outside this checkout. The tracked nginx file points to dev ports and documents a temporary installed-copy divergence. Consequently the actual remote database instance and its contents are **UNKNOWN** from repository evidence alone.

## 11. Database Schema Used by the Fund Page

Ordered SQL migrations loaded by `scripts/migrate.ts:33-55,64-93,107-127` are schema authority. The runtime Kysely interfaces in `src/db/types.ts` are compile-time mirrors, not DDL. The applied state is recorded in `schema_migrations`, but could not be queried.

### `funds` — migration 015 lines 30-47

| Column | Type/default/nullability | Constraints/use |
|---|---|---|
| `id` | uuid, `gen_random_uuid()`, PK | route identifier |
| `slug` | text NOT NULL | unique; lowercase hyphen format |
| `state` | `fund_state`, default `draft` | enum draft/review_pending/published/paused/archived |
| `current_published_version_id` | uuid nullable | composite FK to version of same fund |
| `published_at`, `paused_at`, `archived_at` | timestamptz nullable | state timestamp checks |
| `created_by_user_id` | uuid NOT NULL | FK users, RESTRICT |
| `created_at`, `updated_at` | timestamptz, now | ordering/display |
| `version` | bigint default 1 | positive; incremented on updates |

Indexes/constraints: PK; unique slug; slug regex; state timestamp checks; composite current-version FK (`015:186-191`); admin list keyset index `(created_at DESC,id DESC)` added by migration 020 line 43.

### `fund_disclosure_versions` — migration 015 lines 49-62

Append-only: uuid PK; `fund_id` FK RESTRICT; positive integer version; nonblank title; body text; 32-byte SHA-256; effective timestamp; publisher FK; created/updated timestamps. Unique `(fund_id,version)` and `(id,fund_id)`. Current page writes body but its admin detail read omits body.

### `fund_versions` — migration 015 lines 162-184; migration 020 lines 32-37

Append-only: uuid PK; fund FK; positive version; name/category/objective; `fund_risk_level`; nullable `fund_return_tier`; currency `char(3)` default INR; bigint minimum SIP/purchase paise, both nonnegative; nullable positive duration/holding months; disclosure composite FK; 32-byte terms hash; creator FK; created timestamp. Unique `(fund_id,version)` and `(id,fund_id)`.

### `fund_stock_disclosures` — migration 015 lines 135-158

uuid PK; fund FK; nonblank stock name; quarter regex `^Q[1-4] FY[0-9]{2}$`; nullable numeric(9,4) weight 0..100; state text default active constrained active/exited; nonnegative sort order default 0; added-by FK; nullable exited timestamp with state check; created/updated timestamps. Unique `(fund_id,stock_name,quarter_label)` (despite the constraint name saying “active,” it is not partial). Index `(fund_id,state,sort_order,stock_name)`.

### `fund_aum_snapshots` — migration 015 lines 103-131

Read-only to the Fund page: uuid PK; fund FK; date; positive revision; nonnegative bigint `aum_paise`; optional growth-batch FK; reason/note; publisher FK; request ID; created timestamp. Unique `(fund_id,as_of_date,revision)`; unique batch/fund when batch is non-null; request and latest-ordering indexes.

### Indirect mutation/auth tables

- `audit_events` (`012_canonical_rbac_platform.sql:112-142`): UUID PK; occurrence time; `actor_type`; nullable actor-user FK; nonblank command/entity type; entity UUID; optional from/to state and reason; request UUID; optional idempotency key; positive entity version; IP/user-agent; object-valued JSONB metadata. Indexes cover entity/time, actor/time, and request. Fund writes append this table in the same transaction.
- `idempotency_records` (`012_canonical_rbac_platform.sql:144-167`): UUID PK; actor scope/key version; constrained unsafe HTTP method; route template/key; optional actor-user FK; 32-byte request hash; status 100..599; object JSONB response; create/complete/expiry timestamps. Unique `(actor_scope,http_method,route_template,key)` plus expiry index. It is conditional and not written by current Fund requests because they send no key.
- Auth authorization reads `auth_sessions` (`011_canonical_sessions.sql:15-78`), `users` (`010_canonical_identity.sql:18-48`), `user_roles`, `roles`, `role_permissions`, and `permissions` (`012_canonical_rbac_platform.sql:12-67`). These tables store the session channel/state/expiry/CSRF material, user account state, active role grants, and active permission grants. Their exact DDL, FKs, revocation-group checks, and partial active indexes are in those cited ranges; Fund handlers do not mutate them.

### Schema fields not consumed by the current Fund page

Relative to this page (not necessarily globally obsolete), the current UI does not consume `funds.created_by_user_id`, `paused_at`, or `archived_at`; `fund_versions.terms_sha256` or `created_by_user_id`; disclosure `content_sha256`, publisher, or update timestamp; stock `added_by_user_id`; or AUM `revision`, `growth_batch_id`, `reason`, `note`, publisher, and request ID. The write path still populates integrity/audit fields. The disclosure `body` is not “unused”: it is written and required by the editor, but is accidentally absent from the admin detail SELECT.

### Fund-related but not used by current Fund page

- `fund_positions` (`015:64-78`) has DDL and a Kysely type but no production repository/route query. **UNUSED / UNREACHABLE** in current source.
- `aum_growth_batches` and AUM snapshot writes belong to `/admin/aum/*`, not `/admin/funds`.
- `investment_orders`, `investment_reviews`, `investment_allocations`, and `client_value_entries` belong to the conditional review/allocation flow, not the Fund page.
- `approval_actions` includes legacy enum values such as `fund_nav.correct`, `fund_aum.correct`, redemption approval, and fund maker-checker actions, but has no production repository/caller. **STALE / LEGACY schema capability**.

## 12. Current Database Reads — Fund Routes

| Operation | Tables/fields read |
|---|---|
| Auth each request | active session/channel; active user; current roles and permissions |
| List | `funds` all rows; current `fund_versions` terms/minimums; latest `fund_aum_snapshots` amount/date/time; active stock count |
| Detail | same Fund projection, plus all versions, all stocks, disclosure metadata |
| Create | `funds.id` by slug for conflict check; locks/reads inserted entities |
| Publish version | locks fund; max version from disclosures and fund versions |
| Stock load | all stock rows for fund, active and exited |
| Stock add/lifecycle/archive | locks fund |
| Stock edit/exit | reads target stock first |

Actual current rows/values/counts are **UNKNOWN** because the configured database was unavailable. No statement in this report infers row contents from seeds or fixtures.

## 13. Current Database Writes / Updates / Deletes — Fund Routes

| API | Writes | Derived/transformed values |
|---|---|---|
| POST fund | INSERT `funds`; INSERT `audit_events` | frontend-generated slug; actor/request metadata |
| POST version | INSERT disclosure; INSERT version; UPDATE fund pointer/state/timestamps/version; INSERT audit | SHA-256 of disclosure body; SHA-256 of selected canonical terms; next versions by max+1; paise strings; null optional fields |
| PATCH fund | UPDATE state and matching timestamp, `updated_at`, increment version; audit | next state from strict enum |
| DELETE fund | same UPDATE forced to archived; audit | no physical delete |
| POST stock | INSERT stock; audit | numeric weight string; UI sort order = active UI count + 1 |
| PATCH stock | UPDATE name/quarter/weight/sort/time; audit | backend-only from current UI perspective |
| DELETE stock | UPDATE state/exited timestamp/update timestamp; audit | no physical delete |

There is no Fund-page SQL DELETE. Version/disclosure history is append-only. The two-step frontend create is not one database transaction because it is two HTTP requests.

## 14. Authentication and Authorization Flow

1. Browser admin uses HttpOnly access/refresh cookies plus synchronizer CSRF; native admin uses a bearer token (`adminAccess.ts:1-34`).
2. `resolveAdminPrincipal` prefers the access cookie; if absent and a Bearer header exists, it uses native authentication (`adminAccess.ts:50-80`).
3. Cookie auth validates origin, verifies JWT, reads active `auth_sessions` channel web and active `users`; unsafe calls compare `x-csrf-token` hash (`webAuth.ts:352-385`).
4. Bearer auth verifies JWT, reads active native session and active user (`nativeAuth.ts:403-430`).
5. Both paths load live roles/permissions on every request (`userRepository.ts:139-151`).
6. GETs require `funds.read`; mutations require `funds.write` (`adminCatalogRoutes.ts:178-180,233-236`, repeated per handler).
7. Frontend route visibility checks only `funds.read`; it does not hide write controls from read-only principals.
8. CORS reflects only configured allowlisted origins and permits credentials/authorization/idempotency/CSRF headers (`http/cors.ts:23-84`). The HTTP boundary assigns request IDs, canonical envelopes, no-store, nosniff, and redacted error rendering (`http/boundary.ts:15-185`).

## 15. Active Frontend Code Inventory

Directly active artifacts are listed in section 4. Additional classifications:

- **ACTIVE:** Fund routes, wrappers, list/workspace/form/model, mutation hook, list resource, normalizer, API transport.
- **INDIRECTLY ACTIVE:** session/auth/vault; cache provider; shell/nav/toast/error/display primitives; approval badge polling; shared formatters and imported CSS.
- **CONDITIONAL:** fixture vs HTTP; browser cookie vs native bearer; mobile vs desktop navigation; profile/stocks/history; confirmations; read error/retry; create phase 2 only if phase 1 returns an ID; 401 refresh.
- **CONDITIONAL redirects:** `/admin/ops/funds*` and legacy tab query.

## 16. Active Backend Code Inventory

| Artifact | Status / role |
|---|---|
| `src/server.ts` | ACTIVE process entry |
| `src/runtime/environment.ts` | ACTIVE server/auth/config parsing |
| `src/runtime/composition.ts` | ACTIVE dependency and route registration |
| `src/runtime/application.ts` | ACTIVE Fastify boundary/CORS/routes |
| `src/routes/adminCatalogRoutes.ts` | ACTIVE Fund HTTP handlers and Zod runtime schemas |
| `src/repositories/adminCatalogRepository.ts` | ACTIVE Fund data access |
| `src/domain/admin/adminAccess.ts` | ACTIVE auth transport selection/RBAC |
| `src/domain/auth/webAuth.ts`, `nativeAuth.ts` | INDIRECTLY ACTIVE authentication |
| `src/repositories/userRepository.ts` | INDIRECTLY ACTIVE live permissions |
| `src/db/config.ts`, `pool.ts`, `database.ts`, `types.ts` | INDIRECTLY ACTIVE database infrastructure |
| `src/routes/adminRouteKit.ts` | INDIRECTLY ACTIVE pagination/idempotency/transaction helpers |
| `src/repositories/auditRepository.ts` | INDIRECTLY ACTIVE mutation audit |
| `src/db/repositories.ts` idempotency repository | CONDITIONAL; only with header |
| `src/http/{validation,envelope,boundary,cors,errorCatalog}.ts` | INDIRECTLY ACTIVE HTTP contract |
| migrations 012, 015, 020 | Authoritative DDL for active tables |

## 17. Frontend Duplicate Code Inventory

| Layer | File / Symbol A | File / Symbol B | Duplication Type | Active Implementation | Other Usage | Important Difference | Risk |
|---|---|---|---|---|---|---|---|
| Frontend | `fundOpsModel.js::slugify` | `data/useFundMutations.js::slugify` | Exact duplicate | Both participate; model supplies normal create slug | mutation copy is fallback if slug missing | Same today; independent copies can drift | Medium |
| Frontend | `data/adminResources.js::useAdminCollection` | `hooks/useAdminCollection.js::default` | Partially overlapping loaders | cache-backed version for Funds | second is active for FAQs | cache/staleness/extraction/fixture/error models differ | Medium |
| Frontend | `loadAdminData.js::extractAdminCollection` | `FundWorkspace.load` and `apiRequest` unwrap | Near-duplicate compatibility handling | `apiRequest` unwrap is actual HTTP path | extra `.data` branches support alternate shapes | Hides response drift | Medium |
| Frontend | `fundOps/*` canonical UI | `ui-kits/src/admin/Components.jsx::FundsScreen` | Old/new independent implementations | `fundOps/*` | UI kit unimported by app/admin | old NAV/allocation/CMS model, hardcoded data, dead buttons | High if revived |
| Frontend | `FundsListScreen` catalogue table | `AumScreen::CurrentAumTab` table | Partial overlap | Both active in separate domains | AUM route only | same Fund projection, different task/columns | Low; intentional |
| Frontend | current Fund markup | legacy selectors in `styles/admin/admin-funds.css` | Superseded UI/CSS | current routed markup | legacy selectors still bundled | old editor/tabs/allocation/client preview | Medium bundle/maintenance risk |
| Frontend | `helpers/currency.js::{formatRupeesFromPaise,parseRupeesToPaise}` | `helpers/formatters.js::{paiseToRupees,fmtPaise}` plus Fund/AUM inline converters | Superseded/overlapping conversion helpers | latter implementations | `currency.js` exports have no production imports | null/negative/rounding behavior differs | Medium |

The UI-kit `FundsScreen` is not imported by the production app. Its Upload NAV/Publish/New/Edit controls have no handlers and its static model conflicts with the current no-NAV architecture. It is **STALE / LEGACY** and **UNUSED / UNREACHABLE** from production routing.

`normalizeFundRow` also emits unused legacy aliases: `lifecycleStage`, `tagline`, `riskLabel`, `minSip`, `minLumpsum`, fake `analytics`, empty `sectors`, and empty `investments` (`formatters.js:138-160`). These are stale compatibility output inside an active adapter.

## 18. Backend Duplicate Code Inventory

| Layer | File / Symbol A | File / Symbol B | Duplication Type | Called by current Fund page | Other Usage | Important Difference | Risk |
|---|---|---|---|---|---|---|---|
| Backend | `adminCatalogRepository.ts::FUND_SELECT` | `clientCatalogRepository.ts::FUND_SELECT` | Near duplicate SQL projection | Admin version | client `/v1/client/funds` | admin includes all states; client published only; field sets differ | Medium drift |
| Backend | `adminCatalogRoutes.ts::mapFund` | `clientCatalogRoutes.ts::mapFund` | Overlapping serialization | Admin mapper | client mapper | admin uses `aum/currentVersion`; client uses `fundSize/version` and durations | High contract divergence |
| Backend | admin detail `listStocks` inside `getFund` | separate admin GET stocks | Exact repository read responsibility | Both are reached when stock tab opens | same admin route group | detail stock payload ignored then re-fetched | Medium wasted query |
| Backend | PATCH fund archive | DELETE fund forced archive | Overlapping behavior | Both reachable | same handler/repository | method/canonical idempotency scope differ; both state updates | Low/Medium |
| Backend | PATCH stock | POST/DELETE stock capabilities | Overlapping stock CRUD | PATCH not called | registered externally | update supports fields UI cannot edit | Low now, drift risk |
| Backend | admin catalogue list/detail | client catalogue list/detail | Independent audience versions | admin only for page | client app actively calls client routes | auth/cache/visibility/response shapes differ | Medium |
| Backend | `paymentsRepository.ts::findFundState` | `investmentReviewRepository.ts::findFundState` | Exact duplicate query | neither called by Fund page | review copy active; payment copy has no runtime caller | same `funds.state` lookup | Medium |

No second active admin Fund CRUD controller/service/repository was found. The principal duplication is admin-versus-client read SQL/mapping, plus redundant stock reads. The similarly named AUM, client growth, investment review, SIP, and client catalogue implementations are separate bounded behaviors, not duplicate Fund CRUD.

## 19. Frontend–Backend Duplicate / Conflicting Contracts

| Contract | Frontend | Backend | Finding |
|---|---|---|---|
| List pagination | sends no limit/cursor; discards envelope meta | default 25, cursor in `meta.page` | only first 25 funds reachable |
| Disclosure edit | expects `disclosures[0].body` | admin detail omits body | required field opens blank |
| Create outcome | copy says draft until workspace publish | version publish sets state published | contradictory workflow/copy |
| Create navigation | comments say open workspace | returned ID exists | frontend ignores ID |
| Delete semantics | “Archive and remove”; cannot publish again | archive update; list includes archived; PATCH can republish | materially false UI promise |
| Stock count freshness | catalogue caches count for 2 min | stock writes change count | stock panel does not invalidate catalogue |
| Stock edit | source comment advertises PATCH | PATCH registered and functional | no UI handler/control |
| Idempotency | no key on Fund/stock writes | optional; bypasses record without key | user retry not server-deduped |
| Write permissions | all controls visible after `funds.read` gate | writes require `funds.write` | read-only UI actions fail 403 |
| Response schemas | handwritten optional access and compatibility unwraps | runtime Zod only validates requests | malformed/drifted successes can silently default |
| AUM initialize (adjacent) | sends `{amountPaise}` | strict schema requires `{aumPaise}` | initialization always validation-fails |
| AUM correction | sends `{amountPaise}` | strict schema requires `{aumPaise}` | correction always validation-fails |
| AUM explicit collective | sends both `fundIds` and `items` | strict XOR requires exactly one mode | explicit preview always validation-fails |
| AUM collective preview | expects `beforePaise/currentAumPaise` and `afterPaise/newAumPaise` | returns `beforeAumPaise` and `afterAumPaise` | real Before/After cells render missing values |
| Admin/client Fund object | `aum`, `currentVersion` | client uses `fundSize`, `version` | two live shapes for same persisted fund |
| Validation bounds | frontend checks core required/nonnegative fields | backend additionally caps objective/body at 20,000, title at 200, durations at 1200 | some inputs pass UI validation then receive 400 |

## 20. Stale / Legacy Frontend Code Inventory

- `frontend_stack/packages/ui-kits/src/admin/Components.jsx::FundsScreen` and `ui-kits/src/admin/index.html`: unreachable reference/prototype Fund screen; hardcoded NAV/allocation model and dead buttons.
- Legacy Fund aliases emitted by `helpers/formatters.js:138-160`.
- Large unreferenced sections of `styles/admin/admin-funds.css`, including old form/sector/investment/chart, tab/lifecycle strip, slide-over editor, allocation metrics, and client preview selectors; still bundled via `styles/desktop/admin.css:6-12`.
- Matching old-page responsive rules in `admin-responsive.css`, including comments about the retired four-tab/Redemptions layout.
- `pages/legacy/legacyRoutes.jsx` is **not** stale; only its filename is historical.

## 21. Stale / Legacy Backend Code Inventory

- `approval_actions` DDL/type and action enum values for fund maker-checker, `fund_nav.correct`, and redemption approval have no production caller/repository.
- `fund_positions` DDL and Kysely row type have no production read/write path.
- `db/repositories.ts` aliases `ApprovalAction` and `FundPosition` are unused outside type declaration.
- `paymentsRepository.ts::findFundState` duplicates the active Investment Review lookup but has no production caller.
- `finance_policy_versions.redemption_dual_approval_threshold_paise` is seeded and typed, but no current redemption runtime reads it.
- References to nonexistent `fund_nav_prices` in comments are explanatory negatives, not active models.

## 22. Unused / Unreachable Code Inventory

| Artifact | Proof | Classification |
|---|---|---|
| UI-kit `FundsScreen` | no import from app/admin; reference package only | UNUSED / UNREACHABLE |
| UI-kit Fund buttons | no handlers inside unreachable screen | DEAD UI |
| `fund_positions` | only migration/type/type-alias references | UNUSED / UNREACHABLE data model |
| `approval_actions` runtime | only migration/type/type-alias; no route/repository | UNUSED / UNREACHABLE capability |
| PATCH stock from admin frontend | no PATCH request/caller | backend-only capability |
| normalizer aliases listed above | no active admin consumer | STALE output |
| `review_pending` Fund lifecycle branch | present in DB/type/filter/copy, but no production write assigns it | STALE / LEGACY branch; external/manual DB assignment UNKNOWN |

## 23. Dead / Non-Functional UI Elements

The active routed Fund page has no handlerless controls. Functional gaps/misleading behaviors are:

- no pagination/load-more despite paginated backend;
- create does not navigate as its comments promise;
- successful create invalidates but does not refetch the mounted list, so the new row can remain invisible;
- no stock edit control for the registered PATCH capability;
- archive wording does not match persistence/list/lifecycle behavior;
- both “Move to archived” and “Archive and remove” are rendered and reach the same archive update; repeating archive increments the row version and emits another audit event;
- read-only principals see write controls that will 403;
- the shell makes a hidden approvals request that can 403 for a valid Fund-only principal;
- AUM initialization and correction send the wrong field name; explicit collective sends both mutually exclusive request modes; real collective preview Before/After fields are mapped under the wrong names.

The unreachable UI-kit prototype contains genuinely dead Upload NAV, Publish, New fund, and Edit controls.

## 24. Backend Capabilities Not Used by the Current Fund UI

- `PATCH /v1/admin/funds/:fundId/stocks/:stockId`.
- Cursor pagination after page 1 for `GET /v1/admin/funds`.
- Optional idempotency replay for Fund/stock mutations.
- Returned `stocks` in `GET /v1/admin/funds/:fundId` (payload and database query are unused by the workspace).
- Conditional allocation/refund capabilities under investment review are not Fund-page controls.
- AUM initialize/growth/correction/collective/history routes are not used by `/admin/funds`; they are actively wired by the expanded `/admin/aum/*` scope. Initialize and correction are contract-broken, and explicit collective is shape-broken, as detailed in sections 34–47.

Allocation is registered only when the full PhonePe gateway is configured (`runtime/composition.ts:452-466`); the inspected local environment lacks those credentials, so that local route group would not be registered. Production registration is **UNKNOWN**. No unallocation route exists. No redemption route/model/table exists in the current backend; separately reachable client redemption UI still calls `GET/POST /v1/client/redemptions`, for which repository route search found no backend registration. That is a dead client contract, not a current Admin Fund-page element.

## 25. Duplicate or Conflicting API Implementations

There is no duplicate admin CRUD API version. The overlapping surfaces are:

- `/v1/admin/funds*`: all-state admin catalogue and mutations.
- `/v1/client/funds*`: published-only cached client catalogue.
- `/v1/admin/aum*`: absolute AUM snapshot commands.
- `/v1/admin/investment-reviews*`: conditional accepted-payment allocation/refund operations.

The first two independently serialize the same Fund tables with different field names and projections. That is intentional by audience but creates documented drift. Admin detail's omitted disclosure body is especially inconsistent because the client detail repository does return it (`clientCatalogRepository.ts:136-145`).

## 26. Duplicate or Conflicting Database Models / Schemas

- SQL migrations are authoritative; `db/types.ts` mirrors them and currently includes the same Fund columns, including migration-020 `return_tier`.
- `fund_positions` overlaps conceptually with the active manual `fund_stock_disclosures`, but has no runtime caller. It appears superseded/orphaned rather than a second active representation.
- `investment_allocations` is not a duplicate Fund holding model; it records accepted payment allocation and is active only through Investment Reviews.
- `fund_aum_snapshots` is the active AUM representation. There is no NAV table. `approval_actions` retaining `fund_nav.correct` is legacy schema vocabulary.
- Applied migration state is **UNKNOWN**, so physical divergence between migration files and the unreachable database cannot be ruled out.

## 27. Environment Variables and Configuration Dependencies

| Variable/config | Effect on Fund flow |
|---|---|
| `VITE_BEO_APP_TARGET` | selects admin vs client bundle |
| `VITE_BEO_API_MODE` | `http` enables requests; otherwise empty fixture list and rejected mutations |
| `VITE_BEO_API_BASE_URL` | prefixes all frontend requests; default 127.0.0.1:47502 |
| `DATABASE_URL` | PostgreSQL instance/database credentials |
| `DB_POOL_MAX`, connection/idle/statement transaction timeouts | pool/query bounds |
| `HOST`, `PORT`, `TRUST_PROXY`, `LOG_LEVEL`, `NODE_ENV` | backend listener/runtime |
| access-token issuer/audience/keyring | cookie/bearer JWT verification |
| `REFRESH_HMAC_KEY`, refresh/CSRF key versions | session rotation/CSRF |
| `CURSOR_HMAC_KEY` | authenticated Fund list cursor |
| `WEB_ORIGIN_ALLOWLIST` or legacy `CORS_ORIGIN` | web-origin and CORS gate |
| `WEB_COOKIE_SECURE` | browser cookie transport |
| `IDEMPOTENCY_TTL_MS` | replay lifetime when keys are supplied |
| `MIGRATIONS_DIR` | migration source, default `./db/migrations` |
| PhonePe credential set | conditionally registers Investment Review/refund/allocation APIs; not core Fund CRUD |

`DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_SSL`, `DATA_STORE`, `DB_DRIVER`, and backend `PUBLIC_API_BASE_URL` may appear in compose/documentation, but the backend database parser consumes `DATABASE_URL`; those split database variables are not runtime authority for this flow.

Secret values were deliberately not copied into this report. Repository evidence is sufficient to show presence and wiring without exposing credentials.

## 28. Data Flow Diagram

```text
/admin/funds
  → FundsRoute
  → useAdminFunds [admin:funds, 2-minute freshness]
  → loadAdminCollection
  → apiRequest GET /v1/admin/funds
  → Fastify listFunds
  → admin cookie/native bearer auth
  → live funds.read RBAC query
  → AdminCatalogRepository.list
  → funds
     LEFT JOIN current fund_versions
     LATERAL latest fund_aum_snapshots
     LATERAL active fund_stock_disclosures count
  → {ok,data:{items},meta:{page}}
  → apiRequest unwraps data
  → extractor discards page metadata
  → normalizeFundRow
  → FundsListScreen
```

```text
Create form
  → POST /v1/admin/funds
  → transaction: funds INSERT + audit_events INSERT
  → returned fundId
  → POST /v1/admin/funds/:id/versions
  → transaction:
       lock funds
       INSERT fund_disclosure_versions
       INSERT fund_versions
       UPDATE funds(pointer, state=published, timestamps, version)
       INSERT audit_events
  → invalidate admin:funds/admin:auditLogs
```

```text
/admin/aum/current
  → AumScreen::CurrentAumTab
  → useAdminFunds → GET /v1/admin/funds
  → same capped Fund projection and latest-AUM lateral read
  → normalized AUM table → optional link to /admin/funds/:id

/admin/aum/manage
  → useAdminFunds → local FundPicker
  → GET /v1/admin/aum/funds/:id/history
  ├─ empty → POST initialize → batch + absolute snapshot + audit + idempotency
  └─ nonempty → POST growth → bigint domain calculation → batch + snapshot + audit + idempotency

/admin/aum/collective
  → useAdminFunds → select funds
  → POST collective/preview → read latest bases → plan + basisHash (no writes)
  → POST collective with basisHash + Idempotency-Key
  → lock funds in ID order → reload/re-hash/re-plan
  → one batch + N absolute snapshots + one audit + idempotency record

/admin/aum/history
  → useAdminFunds → local FundPicker
  → GET history (newest 25 by default)
  → optional POST correction
  → append next same-date revision + audit + idempotency record
```

## 29. Current-State Architecture Diagram

```text
Admin SPA (one Vite shell, admin target)
├─ AdminSessionProvider
├─ ResourceCacheProvider
├─ AdminShell
│  └─ global applications-queue polling
├─ Fund routes
│  ├─ cached catalogue list
│  └─ direct-request workspace
│     ├─ terms/version form
│     ├─ stock disclosure panel
│     └─ history
└─ AUM routes
   ├─ current catalogue projection
   ├─ manage-one → FundAumPanel
   ├─ collective preview/commit
   └─ history → FundAumHistoryPanel
           │
           ▼
apiRequest (base URL, cookie/bearer, CSRF, retries)
           │
           ▼
nginx /api stripping (release) or local :47502
           │
           ▼
Fastify
├─ HTTP boundary/CORS
├─ admin authentication + live RBAC
├─ adminCatalogRoutes (Zod request schemas)
├─ adminAumRoutes + adminFundGrowthPreviewRoutes
├─ Fund AUM bigint arithmetic / basis hashing
├─ AdminCatalogRepository (no service layer)
└─ FundAumRepository (no service layer)
           │
           ▼
Kysely + pg Pool
           │
           ▼
PostgreSQL
├─ Fund catalogue/history/stock tables
├─ aum_growth_batches 1 → N fund_aum_snapshots
│  └─ correction snapshots have no batch
├─ audit_events
└─ idempotency_records (required for AUM writes)
```

## 30. Potential Architectural Problems or Inconsistencies

Severity here describes current operational risk, not a redesign prescription.

| Severity | Finding |
|---|---|
| HIGH | First-page-only catalogue silently hides funds after row 25 |
| HIGH | Detail disclosure body contract is incomplete; edit cannot faithfully prefill |
| HIGH | Archive/remove copy and lifecycle behavior conflict with actual persistence |
| HIGH | Two-request create can persist a partial draft |
| HIGH | Successful create can leave the mounted catalogue stale because invalidation does not refetch |
| HIGH | Separate AUM initialize UI sends a field rejected by strict backend schema |
| HIGH | AUM correction sends the same rejected `amountPaise` field |
| HIGH | Explicit collective mode sends mutually exclusive `fundIds` and `items` |
| HIGH | Collective preview displays no real Before/After values because response fields diverge |
| HIGH | All AUM pages and AUM history inherit silent 25-row truncation |
| HIGH | Stale collective previews can commit old values after visible inputs change |
| MEDIUM | First-version publication contradicts draft workflow copy |
| MEDIUM | Write controls exposed to principals lacking `funds.write` |
| MEDIUM | Shell approvals polling is not permission-gated and can generate hidden 403s on a valid Fund page |
| MEDIUM | No idempotency keys on Fund/stock writes despite backend facility |
| MEDIUM | Stock count cache not invalidated after stock mutation |
| MEDIUM | Detail performs/transfers an unused stock query then stocks are re-fetched |
| MEDIUM | Admin/client Fund queries and serializers duplicate mappings with divergent shapes |
| MEDIUM | No shared/generated admin Fund contract or response validation |
| LOW | Create comment promises navigation that code does not perform |
| LOW/MEDIUM | Stale Fund CSS and prototype UI remain in repository/bundle |
| LOW/MEDIUM | `review_pending` is represented throughout schema/UI but has no current production transition into it |

## 31. Files Likely to Require Modification During the Future Redesign

No modifications are made now. Based on proven ownership, likely future touch points are:

- `frontend_stack/packages/admin/src/screens/fundOps/FundsListScreen.jsx`
- `frontend_stack/packages/admin/src/screens/fundOps/FundWorkspace.jsx`
- `frontend_stack/packages/admin/src/screens/fundOps/FundProfileForm.jsx`
- `frontend_stack/packages/admin/src/screens/fundOps/fundOpsModel.js`
- `frontend_stack/packages/admin/src/screens/FundStockListPanel.jsx`
- `frontend_stack/packages/admin/src/data/adminResources.js`
- `frontend_stack/packages/admin/src/data/useFundMutations.js`
- `frontend_stack/packages/admin/src/helpers/loadAdminData.js`
- `frontend_stack/packages/admin/src/helpers/formatters.js`
- `frontend_stack/packages/admin/src/navigation/nav.js`
- `backend_controller/src/routes/adminCatalogRoutes.ts`
- `backend_controller/src/repositories/adminCatalogRepository.ts`
- `packages/contracts` generated/source definitions if admin contracts become shared
- migrations only if persistence semantics genuinely change; current DDL should not be edited retroactively
- adjacent `FundAumPanel.jsx` / `adminAumRoutes.ts` for the proven initialize-name conflict
- `frontend_stack/packages/admin/src/screens/AumScreen.jsx`
- `frontend_stack/packages/admin/src/screens/FundAumHistoryPanel.jsx`
- `frontend_stack/packages/admin/src/helpers/idempotencyKeys.js`
- `backend_controller/src/routes/adminFundGrowthPreviewRoutes.ts`
- `backend_controller/src/repositories/fundAumRepository.ts`
- `backend_controller/src/domain/admin/fundAumGrowth.ts`
- `frontend_stack/packages/admin/src/screens/aumScreen.test.jsx`
- `backend_controller/test/integration/adminAum.integration.test.ts`

## 32. Likely Consolidation / Cleanup Candidates

Candidates, not authorized changes:

- consolidate the two exact `slugify` functions;
- remove or formally isolate the unreachable UI-kit Fund prototype;
- remove verified-unused legacy Fund normalizer aliases;
- remove or reconcile unused `helpers/currency.js` and the duplicated repository `findFundState` method;
- delete verified-unreferenced legacy Fund CSS selectors;
- choose one admin collection-loading convention where requirements overlap;
- eliminate redundant response-envelope compatibility branches after establishing a shared contract;
- avoid returning/querying stocks in detail if the stock panel remains independently loaded, or consume the returned list instead;
- centralize shared admin/client Fund projection primitives without erasing audience-specific authorization/visibility;
- remove orphaned `fund_positions` and `approval_actions` only after physical-data/deployment verification and a forward migration;
- expose/use cursor pagination and stock edit only if product requirements retain those capabilities.
- consolidate duplicated AUM money/date/history helpers while preserving the AUM/client-value ledger boundary;
- align AUM request/response contracts and cross-stack tests before removing compatibility aliases;
- either populate or prospectively remove the AUM batch idempotency FK, after physical-data verification;
- reconcile direct AUM correction with the schema-only maker-checker capability.

## 33. Final Current-State Architecture Summary

The Admin Fund page is not a monolithic legacy editor anymore. It is one canonical catalogue route plus one canonical per-fund workspace, backed by one active admin route module and one active repository. The persisted model is versioned terms/disclosures, a lifecycle row, manual stock disclosures, and externally managed absolute AUM snapshots—no NAV and no physical deletion in the Fund flow.

The implementation is operationally split in important ways: list data is cached but detail/stocks are locally fetched; create spans two HTTP transactions; admin and client catalogues independently map the same tables; request schemas live only in backend Zod; frontend responses are untyped; and several UI promises do not match backend behavior. Allocation and refund are separate conditional review capabilities, AUM is a separate admin domain, and unallocation/redemption do not exist in the current baseline.

The most important pre-redesign facts to preserve are the actual route ownership, the absence of a Fund service layer, append-only version/disclosure history, audit writes in the same mutation transaction, the latest-AUM lateral read, live-per-request RBAC, and the distinction between archiving and deletion. The most urgent inconsistencies to resolve in a future change are pagination loss, disclosure-body omission, non-atomic creation, archive semantics/copy, authorization-aware controls, stock cache invalidation, and the AUM initialize field mismatch.

## 34. Admin AUM Route and Page Inventory

`Admin.jsx:88-92` registers four canonical AUM pages and one redirect. The wrappers in `pages/legacy/legacyRoutes.jsx:84-86` are **ACTIVE**.

| Browser route | Active component | Frontend route permission | Purpose / initial request |
|---|---|---|---|
| `/admin/aum` | `<Navigate replace>` | destination-dependent | redirects to `/admin/aum/current` |
| `/admin/aum/current` | `AumRoute` → `AumScreen('current')` → `CurrentAumTab` | `aum.read` | cached GET `/v1/admin/funds`; read-only current projection |
| `/admin/aum/manage` | `AumScreen('manage')` → `ManageOneFundTab` → conditional `FundAumPanel` | `aum.write` | GET funds; selected fund triggers GET AUM history, then initialize or growth |
| `/admin/aum/collective` | `AumScreen('collective')` → `CollectiveAumTab` | `aum.write` | GET funds; preview then hash-checked collective commit |
| `/admin/aum/history` | `AumScreen('history')` → `HistoryTab` → conditional `FundAumHistoryPanel` | `aum.read` | GET funds; selected fund triggers GET history; correction requires `aum.write` |

Nav ownership is `navigation/nav.js:146-179`. `/admin/ops/holdings` and legacy `?tab=holdings` redirect to `/admin/aum/current` (`Admin.jsx:101-111`; `legacyTabMap.js:15-17`); they are **CONDITIONAL compatibility**, not duplicate pages.

`AumScreen.jsx:484-504` always renders all four internal route links. Those links are not permission-filtered, although `Permitted` rejects the destination. This differs from `AdminDomainStrip`, which filters sibling links. A read-only AUM user therefore sees write-page links that terminate at Forbidden; a write-only user sees read-page links that do the same. `/admin/aum` always redirects to the read page, so an `aum.write`-only principal is redirected to Forbidden instead of an authorized write page.

## 35. AUM Frontend Component and Dependency Tree

```text
BrowserRoot / session / ResourceCacheProvider / AdminShell
└─ Admin → Permitted → AumRoute
   └─ AumScreen
      ├─ four route links
      ├─ CurrentAumTab
      │  └─ useAdminFunds → current table → Open fund link
      ├─ ManageOneFundTab
      │  ├─ useAdminFunds → FundPicker
      │  └─ FundAumPanel (selected fund only)
      │     ├─ direct history loader
      │     ├─ initialize form, conditional on empty history
      │     └─ amount/percentage growth form, conditional on nonempty history
      ├─ CollectiveAumTab
      │  ├─ useAdminFunds → checkboxes
      │  ├─ percentage / explicit-delta form
      │  └─ preview → discard or idempotent commit
      └─ HistoryTab
         ├─ useAdminFunds → FundPicker
         └─ FundAumHistoryPanel (selected fund only)
            ├─ direct history loader
            └─ correction form when principal also has aum.write
```

Direct AUM frontend artifacts are `screens/AumScreen.jsx`, `screens/FundAumPanel.jsx`, `screens/FundAumHistoryPanel.jsx`, `helpers/idempotencyKeys.js`, `data/adminResources.js::{useAdminFunds,useAdminCacheActions}`, `helpers/formatters.js`, `data/AdminReadError.jsx`, and the shared API/session/cache/navigation/display infrastructure already catalogued in sections 3–4 and 14–15. There is no shared generated AUM DTO or response parser.

## 36. AUM Runtime Load Sequences

All four pages first execute the session/shell sequence in section 5, including unconditional Approvals Queue polling. Each then calls `useAdminFunds()` (`AumScreen.jsx:60-61,131-133,160-163,457-459`). Thus every page depends on backend `funds.read` even though its route metadata declares only `aum.read` or `aum.write`.

### Current

`CurrentAumTab` → `useAdminFunds` → cached GET `/v1/admin/funds` → `normalizeFundRow` → render name/slug/state/`aumPaise`/as-of date (`AumScreen.jsx:60-125`). It makes no AUM-specific request and has no search, sort, filter, or pagination.

### Manage one fund

GET funds → local `FundPicker` → select ID → keyed `FundAumPanel` mounts → GET `/v1/admin/aum/funds/:id/history` (`FundAumPanel.jsx:84-105`). `history[0]` is treated as latest. Empty response selects initialize; nonempty selects growth.

A history failure leaves `history=[]`, records an error, and sets loading false. The derived `isInitialize` then becomes true, so the page shows both the read error and an active Initialize form. A failed read is therefore incorrectly treated as proof that no basis exists. There is no history Retry control.

### Collective

GET funds → local selection/mode/inputs → POST preview → store the exact submitted request as `preview.requestBody` alongside returned `basisHash` → optional POST commit using that stored request and an Idempotency-Key (`AumScreen.jsx:217-281`). Preview is read-only at the database layer but uses POST and therefore receives CSRF protection.

### History

GET funds → local picker → selected panel GETs history (`FundAumHistoryPanel.jsx:50-68`). The panel renders the result and only shows Correct to principals with `aum.write` (`:30-35,152,179-190`). There is no explicit retry after a history read failure.

## 37. AUM User Action → Code Execution Mapping

| Page / UI element | Event/function | API request | Backend chain | Database effect |
|---|---|---|---|---|
| Any AUM tab link | React Router `Link` | none | destination `Permitted` | none |
| Current: Open fund | link `/admin/funds/:id` | Fund workspace GET after navigation | admin catalogue detail | reads Fund projection/version/stock/disclosure |
| Current read-error retry | resource `refresh` | GET `/v1/admin/funds` | catalogue list | read only |
| Manage/History fund picker | local `setFundId` | selected panel GETs history | `listHistory` → `findExistingFundIds` + `listSnapshots` | reads `funds`, `fund_aum_snapshots` |
| Manage initialize inputs | local state | none | none | none |
| Publish initial AUM | `FundAumPanel.onSubmit` | POST `/initialize`, but wrong `{amountPaise}` | strict validation stops before handler body | **none; DEAD/NON-FUNCTIONAL UI** |
| Growth mode/direction/magnitude/date/reason/note | local state; local preview | none | none | none |
| Publish AUM adjustment | `FundAumPanel.onSubmit` | POST `/growth` + Idempotency-Key | lock fund → latest basis → bigint growth → batch/snapshot/audit/idempotency | inserts batch, snapshot, audit, idempotency record |
| Collective fund checkbox | immutable toggle; clears preview | none | none | none |
| Collective mode | local setter; clears preview | none | none | none |
| Collective other inputs | local setters; do **not** clear preview | none | none | none |
| Preview growth | `CollectiveAumTab.onPreview` | POST `/growth/collective/preview` | existence/latest reads → plan/hash | read only |
| Discard preview | `setPreview(null)` | none | none | none |
| Commit growth | `onCommit` | POST `/growth/collective` + hash/key | ordered locks → re-read/re-hash → one batch + N snapshots + audit/idempotency | atomic inserts |
| Correct / Close | open prefilled inline form / clear ID | none | none | none |
| Publish correction | `FundAumHistoryPanel.onCorrect` | POST `/corrections`, but wrong `{amountPaise}` | strict validation stops before handler body | **none; DEAD/NON-FUNCTIONAL UI** |

Blank Initialize input is converted by `Number('')` to zero and then `'0'`; the input is not `required` (`FundAumPanel.jsx:34-39,221-234`). The correction converter has the same behavior, although correction opens prefilled. Zero is valid, but blank and explicit zero are indistinguishable.

In explicit collective mode, `buildBody` starts with `fundIds:selected` and then adds `items` without deleting `fundIds` (`AumScreen.jsx:189-215`). The strict backend XOR rejects that request before preview reads. Therefore the explicit Preview button is **DEAD / NON-FUNCTIONAL** in its current branch, and explicit Commit cannot become visible through a real successful preview.

## 38. AUM Frontend Requests and Actual Wire Shapes

| Trigger | Method/path | Body actually built by current frontend | Key |
|---|---|---|---|
| Every page | GET `/v1/admin/funds` | none | none |
| Selected Manage/History fund | GET `/v1/admin/aum/funds/:fundId/history` | no query, therefore backend default limit | none |
| Initialize | POST `/v1/admin/aum/funds/:fundId/initialize` | `{amountPaise,asOfDate,reasonCode,note?}` | required key supplied |
| Individual amount growth | POST `/v1/admin/aum/funds/:fundId/growth` | `{growthPaise,asOfDate,reasonCode,note?}` | required key supplied |
| Individual percentage growth | same | `{growthBasisPoints,asOfDate,reasonCode,note?}` | required key supplied |
| Collective preview | POST `/v1/admin/aum/growth/collective/preview` | percentage `{fundIds,growthBasisPoints,...}` or explicit `{items:[{fundId,growthPaise}],...}` | intentionally none |
| Collective commit | POST `/v1/admin/aum/growth/collective` | exact stored preview request + `basisHash` | required key supplied |
| Correction | POST `/v1/admin/aum/snapshots/:snapshotId/corrections` | `{amountPaise,asOfDate,reasonCode,note?}` | required key supplied |

`useIdempotencyKeys` stores `{JSON.stringify(body),key}` by component-local logical scope. Identical retries reuse a key; a body change mints a new UUID (`helpers/idempotencyKeys.js:17-29`). Unmount/remount loses the map. Shared `apiRequest` supplies JSON, credentials/bearer, and CSRF on all POSTs; write requests are not automatically retried.

The backend requires keys matching `^[A-Za-z0-9._:-]{8,128}$` (`http/idempotencyProtocol.ts:22-23`). `IDEMPOTENCY_TTL_MS` controls replay lifetime and defaults to one day (`runtime/environment.ts:83,435`).

The two history consumers accept either a bare array or `{items}`. Single-fund success accepts `{snapshot}` or a direct snapshot. Collective display accepts `items` or `targets`; however, its Before/After aliases are `beforePaise ?? currentAumPaise` and `afterPaise ?? newAumPaise` (`AumScreen.jsx:284,419-425`), while the real backend returns `beforeAumPaise` and `afterAumPaise`. The real preview therefore renders missing Before/After values; only `deltaPaise` matches. These compatibility branches are handwritten; the generated contracts package contains none of these endpoints.

## 39. AUM Backend Routes, Schemas, and Responses

`runtime/composition.ts:405-418` always constructs one `adminAumDeps`, registers `adminAumRoutes.ts`, and separately registers `adminFundGrowthPreviewRoutes.ts`. The split preview module is **ACTIVE**, not legacy; its comment explains that the literal substring in “preview” would trip the repository's path-based dependency-wall guard (`adminFundGrowthPreviewRoutes.ts:10-16`).

| Method/path | Runtime handler | Permission / boundary | Request schema | Success `data` |
|---|---|---|---|---|
| POST `/v1/admin/aum/funds/:fundId/initialize` | `initializeAum` (`adminAumRoutes.ts:228-297`) | `aum.write`, CSRF, required key | strict `{aumPaise: nonnegative decimal string,asOfDate:ISO date,reasonCode,note?}` | `{snapshot,growthBatchId}` |
| POST `/v1/admin/aum/funds/:fundId/growth` | `growAum` (`:299-386`) | same | strict XOR `growthPaise` signed decimal string / integer `growthBasisPoints` -10000..100000, plus date/reason/note | `{snapshot,growthBatchId,deltaPaise}` |
| POST `/v1/admin/aum/snapshots/:snapshotId/corrections` | `correctSnapshot` (`:388-449`) | same | strict `{aumPaise,asOfDate,reasonCode,note?}` | `{snapshot}` |
| GET `/v1/admin/aum/funds/:fundId/history` | `listHistory` (`:451-461`) | `aum.read`, no CSRF | strict `{limit?: integer 1..100 = 25}` | `{items:Snapshot[]}` |
| POST `/v1/admin/aum/growth/collective/preview` | `planCollectiveGrowth` (`adminFundGrowthPreviewRoutes.ts:33-74`) | `aum.write`, CSRF, no key | strict percentage mode `{fundIds[1..100],growthBasisPoints,...}` XOR explicit mode `{items[1..100],...}`; unique funds | `{basisHash,items:[before/delta/after+basis identity]}` |
| POST `/v1/admin/aum/growth/collective` | `commitCollectiveGrowth` (`adminAumRoutes.ts:463-574`) | `aum.write`, CSRF, required key | preview schema + 64-lowercase-hex `basisHash` | `{growthBatchId,targetCount,totalDeltaPaise,basisHash,items}` |

Paise schemas permit up to 19 digits; reason code is trimmed/nonempty and capped at 80 by `adminRouteKit.ts`; note is trimmed 1..2000 if present. The runtime AUM maximum is the fallback 100,000 basis points (+1000%) because composition supplies no `maxGrowthBasisPoints`. The -10,000 basis-point floor prevents a percentage loss over 100%.

`CLIENT_GROWTH_MAX_BASIS_POINTS` is parsed only for the separate client-growth domain (`runtime/environment.ts:86,438`); it does not configure Fund AUM. There is no AUM-specific environment variable for this cap in the active composition.

Responses use the same canonical envelope documented in section 8. `mapSnapshot` deliberately exposes only `id`, `fundId`, `asOfDate`, `revision`, `aumPaise`, `reasonCode`, and `createdAt` (`adminAumRoutes.ts:213-221`). Private note, publisher, request ID, and growth-batch ID are selected by the repository but discarded at the handler boundary.

## 40. AUM Service, Calculation, and Repository Flow

There is no AUM service class. The active flow is:

```text
Fastify handler
→ live admin authentication/RBAC + strict Zod
→ runAdminMutation / UnitOfWork (writes)
→ domain/admin/fundAumGrowth.ts (growth arithmetic and basis hash)
→ repositories/fundAumRepository.ts
→ parameterized SQL / PostgreSQL
```

`aumGrowthDelta` returns an explicit signed delta verbatim or uses shared `symmetricHalfUpBasisPoints` (`fundAumGrowth.ts:25-36`). `planAumGrowth` sorts by fund ID, calculates each fund from its own latest basis, rejects any negative result, and accumulates total delta (`:63-106`). `computeAumBasisHash` SHA-256 hashes the canonical command plus sorted fund ID/latest snapshot ID/AUM/revision (`:108-150`).

Collective preview reads without locks. Commit locks `funds` rows in ascending UUID order, reloads current bases, recomputes and compares the hash, replans, then inserts all outputs in one transaction. Any missing basis, stale hash, nonexistent target, or negative result aborts the entire command.

Individual growth also uses the latest authoritative snapshot, rejects no basis and negative after-value, then creates a new snapshot for the submitted date. Corrections require the submitted date to equal the target row and the target to remain the highest revision for that fund/date; they append revision + 1 and never update the target.

No AUM write validates Fund lifecycle or chronological consistency. Growth may use the latest current basis but write an earlier or future as-of date; a past-dated result may not become the latest projection because date is the primary ordering key.

The initialize handler does **not** verify that the fund has no existing snapshot. It only locks the fund, calculates the next revision for the submitted date, and inserts. “First publication” semantics therefore depend on caller discipline; direct/repeated initialized commands with fresh keys are accepted.

## 41. AUM Database Schema, Reads, and Writes

Migration `015_canonical_catalog.sql:80-131` is authoritative for the two AUM-owned tables; `db/types.ts:652-682` mirrors it.

### `aum_growth_batches`

UUID PK; enum `scope` (`individual|collective`); enum instruction type; effective date; nonblank reason; nullable note; nonblank basis-hash text; actor-user FK RESTRICT; request ID text; nullable idempotency-record FK RESTRICT with uniqueness; nonnegative target count; signed bigint total delta; created timestamp. Index on request ID.

### `fund_aum_snapshots`

UUID PK; fund FK RESTRICT; as-of date; positive revision default 1; nonnegative bigint absolute AUM; nullable growth-batch FK RESTRICT; nonblank reason; nullable note; publisher-user FK RESTRICT; request ID text; created timestamp. Unique `(fund_id,as_of_date,revision)`; partial unique `(aum_growth_batch_id,fund_id)` for non-null batches; request index; authoritative-latest index `(fund_id,as_of_date DESC,revision DESC,created_at DESC,id DESC)`.

Reads use `funds` for existence/row locks and `fund_aum_snapshots` for latest bases, by-ID correction target, maximum revision, and limited history. The repository always uses the full latest ordering (`fundAumRepository.ts:140-170,215-222`).

| Operation | `aum_growth_batches` | `fund_aum_snapshots` | Other writes |
|---|---|---|---|
| Initialize | one individual/amount row | one absolute row linked to batch | one audit + idempotency record |
| Individual growth | one individual amount/percentage row | one calculated absolute row linked to batch | one audit + idempotency record |
| Correction | none | one same-date next revision with null batch | one audit + idempotency record |
| Collective preview/history | none | reads only | none |
| Collective commit | one collective row | one row per target linked to batch | one batch-level audit + idempotency record |

The DDL comment says `aum_growth_batches.idempotency_record_id` ties a batch to its idempotency result, but `InsertAumGrowthBatchInput` has no such field and `insertBatch` omits the column (`fundAumRepository.ts:65-76,188-212`). Current AUM batches therefore leave it null even though `runAdminMutation` separately persists an idempotency record. The field is **ACTIVE schema but UNUSED/UNPOPULATED**, contradicting its migration comment. Client-growth code has explicit link logic; AUM does not.

Fund catalogue list/detail and client catalogue independently read the latest snapshot. That is how an AUM write returns to `/admin/funds` and client Fund size; AUM mutations never update a Fund AUM column because none exists.

## 42. AUM Authentication, Authorization, and Effective Permissions

Cookie/native auth, live database RBAC, CORS, envelopes, and CSRF are the same as section 14. All AUM POSTs require CSRF, including read-only preview. Every mutating endpoint requires an Idempotency-Key and `aum.write`; history requires `aum.read`.

Actual page dependencies are broader than nav metadata:

| Page/action | Declared route permission | Additional runtime permission required |
|---|---|---|
| Current | `aum.read` | `funds.read` for its only data request |
| Manage | `aum.write` | `funds.read` for picker; `aum.read` for basis/history detection |
| Collective | `aum.write` | `funds.read` for target picker |
| History | `aum.read` | `funds.read` for picker |
| Correction | history dependencies | additionally `aum.write` |

Seeded `finance` and `superadmin` receive all relevant permissions, so the standard roles hide this mismatch. Custom role grants can expose it. `FundAumHistoryPanel` correctly hides correction without `aum.write`, unlike Fund workspace write controls. Current's Open Fund links are unconditional and lead to Forbidden for an AUM reader lacking `funds.read`.

Manage's missing `aum.read` gate is materially unsafe at the presentation layer: a writer without read permission gets a history 403, then sees an initialize form because the failed read is treated as empty history.

The global JSON body limit is 65,536 bytes (`http/boundary.ts:15`; `runtime/application.ts:30-52`). Neither the global application registration nor either AUM route module registers an AUM rate limiter. CORS allows the configured origin set and the Authorization, Idempotency-Key, and CSRF headers used here.

## 43. AUM Duplicate Code Inventory

| Layer | File / Symbol A | File / Symbol B | Type | Active usage / difference | Risk |
|---|---|---|---|---|---|
| Frontend | `FundAumPanel.jsx::toAbsolutePaise` | `FundAumHistoryPanel.jsx::toAbsolutePaise` | Exact duplicate | both active; both callers send the same wrong field name | Medium |
| Frontend | `AumScreen.jsx::today` | `FundAumPanel.jsx::today`; `ClientValuesScreen.jsx::today` | Exact duplicate | UTC date default in active pages | Low/Medium timezone drift |
| Frontend | `FundAumPanel::{toSignedPaise,toSignedBasisPoints}` | conversions in `CollectiveAumTab` and `ClientValuesScreen` | Near duplicate | validation and zero-rounding behavior differs | High |
| Frontend | `FundAumPanel.load` | `FundAumHistoryPanel.load` | Near/exact duplicate loader | same history endpoint/extraction; separate states/errors | Medium |
| Frontend | `CollectiveAumTab` | `ClientValuesScreen::CollectiveGrowthTab` | Large near-duplicate workflow | both active preview/hash/idempotent-commit state machines; distinct AUM/client-value boundaries | High drift; domain separation must remain |
| Frontend | `CurrentAumTab` | `FundsListScreen` | Partial overlapping view | same cache and fund/AUM/state/open-link projection; different task scope | Low/Medium |
| Backend | `fundAumRepository` latest reads | admin/client catalogue lateral latest reads | Near-duplicate SQL rule | same four-column ordering in three active repositories | High drift |
| Backend | AUM preview/commit orchestration | `adminClientGrowthRoutes` preview/commit | Parallel independent implementation | same hash/recheck/idempotent batch pattern over intentionally distinct ledgers | Medium/High maintenance risk |
| Backend/schema | direct `correctSnapshot` | unused `approval_actions` type `fund_aum.correct` | Superseded/conflicting control model | direct single-actor correction is active; maker-checker table has no runtime caller | High governance ambiguity |

The separate `adminFundGrowthPreviewRoutes.ts` module is not a superseded AUM implementation. No old AUM route version was found. Old UI-kit NAV/allocation/AUM content and unreferenced allocation/fund-preview/redemption CSS remain stale as catalogued in sections 20 and 43; current `.adm-aum-*`, nested-card, and form-action CSS is active.

## 44. AUM Frontend–Backend Conflicts and Dead UI

| Severity | Finding | Evidence / result |
|---|---|---|
| CRITICAL | Initialize sends `amountPaise`; backend requires `aumPaise` | `FundAumPanel.jsx:127-133` vs `adminAumRoutes.ts:96-103`; strict validation returns 400 before DB |
| CRITICAL | Correction sends `amountPaise`; backend requires `aumPaise` | `FundAumHistoryPanel.jsx:82,95-110` vs `adminAumRoutes.ts:120-127`; every correction returns 400 |
| CRITICAL | Explicit collective sends both mutually exclusive modes | frontend retains `fundIds` when adding `items`; backend refinement requires exactly one shape; every explicit preview returns 400 |
| HIGH | Collective preview maps the wrong Before/After fields | backend returns `beforeAumPaise`/`afterAumPaise`; frontend checks other aliases and displays missing values |
| HIGH | AUM catalogue/pickers inherit first 25 funds | every tab uses bare `useAdminFunds`; cursor/meta are discarded |
| HIGH | “Every published snapshot” is false | history defaults to 25, UI sends no limit and has no pagination; backend has no cursor |
| HIGH | Stale preview can commit old visible values | only selection/mode clears preview; edits to direction, amounts, date, reason, or note do not; commit uses stored `preview.requestBody` |
| HIGH | Route permissions omit Fund/history prerequisites | page can pass `Permitted` then 403 on its data request |
| HIGH | History failure becomes initialize state | `isInitialize = !loading && history.length===0` despite `readError` |
| MEDIUM | All fund states are eligible | picker uses unfiltered admin catalogue; backend only locks IDs, so draft/paused/archived AUM writes are accepted |
| MEDIUM | Current copy overstates client visibility | page lists all states; client catalogue exposes published funds only |
| MEDIUM | Correction date looks editable but must remain identical | any date change gets 409, whose UI message incorrectly says already corrected |
| MEDIUM | Frontend bounds are weaker | no reason-code max; no percentage max; backend may return validation 400 |
| MEDIUM | Small collective inputs can round to zero | raw nonzero input rounds to 0 basis points/paise; backend schemas permit zero and append zero-delta publications |
| MEDIUM | Individual local preview can lose precision | converts up-to-19-digit paise string to JS Number; server bigint commit remains authoritative |
| LOW/MEDIUM | UTC “today” differs from India local day before 05:30 | Manage and Collective default `toISOString().slice(0,10)` |

Frontend tests currently encode the wrong initialize/correction field names (`aumScreen.test.jsx:92-108,230-247`), while backend integration helpers use `aumPaise` (`adminAum.integration.test.ts:136-139,448-453`). Both suites can pass independently while the real boundary is broken.

Frontend collective tests also mock frontend-only Before/After aliases and check that explicit `items` exist without asserting that forbidden `fundIds` is absent. Backend integration tests use the strict correct explicit shape. This is a second boundary-test divergence.

No AUM control performs allocation, unallocation, redemption, payment, or client-value mutation. All active AUM database writes are absolute snapshot publications. The two wrong-field submit buttons are the only currently visible AUM controls proven to have no successful backend execution path.

## 45. AUM Pagination, State, and Cache Consequences

- Fund-list truncation means Current, Manage, Collective, and History only know the first 25 Fund rows. The collective backend accepts 100, but the UI cannot select rows 26–100.
- History default is 25 and maximum is 100, with no cursor. The current UI cannot request beyond 25; even a direct request cannot paginate beyond the newest 100.
- All AUM selectors include draft, review-pending, published, paused, and archived rows. AUM handlers have no lifecycle guard.
- Successful AUM writes call `invalidateAum()`, which invalidates only `admin:funds` and `admin:auditLogs` (`adminResources.js:121-126`). It intentionally does not invalidate client-value/payment/review caches.
- Single-fund growth and correction also reload their local history. Collective commit performs no follow-up read.
- Resource invalidation does not itself refetch a still-mounted `useAdminFunds` consumer, as documented for Fund create. Navigating to another routed AUM/Fund page remounts and observes the invalidation; the current mounted projection can retain stale catalogue data until then.
- Manage/History fund selection is component-local, absent from the URL, non-bookmarkable, and lost on refresh or tab navigation.

## 46. AUM Active, Conditional, Stale, and Unknown Inventory

**ACTIVE:** AUM route entries/nav metadata/wrapper; `AumScreen` and all four tabs; both panels; Fund catalogue resource/normalizer; AUM cache invalidation; idempotency-key helper; transport/session/auth; `adminAumRoutes`; preview route; `fundAumGrowth`; shared bigint rounding; `fundAumRepository`; migrations/types for AUM batches and snapshots; audit/idempotency plumbing.

**INDIRECTLY ACTIVE:** the full admin shell, global approval polling, responsive navigation, generic UI/display/CSS, catalogue repository's latest-AUM projection, auth and RBAC repositories.

**CONDITIONAL:** selected-fund panels; initialize versus growth; amount versus percentage; collective percentage versus explicit; preview/result/error/409 branches; correction visibility; cookie versus bearer; fixture mode; idempotency replay.

**STALE / LEGACY:** old UI-kit NAV/allocation/AUM prototype; verified-unreferenced legacy Fund allocation/preview/redemption CSS; schema-only `approval_actions.fund_aum.correct` maker-checker capability with no runtime caller; documentation references to deleted `AumDisplayFields`, `AumRedemptionsTab`, `GainAllocationForm`, and `FundInvestorsPanel` are stale documentation, not extant code.

**DUPLICATE / OVERLAPPING:** the conversion, loader, collective-workflow, current-table, latest-SQL, and parallel client-growth implementations in section 43.

**UNUSED / UNREACHABLE:** `aum_growth_batches.idempotency_record_id` in the current AUM repository flow; older-than-25 history through the UI; funds after catalogue row 25; initialize/correction success branches from the current UI request shapes; explicit collective preview/commit from the current UI request shape.

**UNKNOWN:** live AUM rows/applied migrations; deployed environment; external callers; whether custom roles grant AUM permissions without prerequisites; whether policy intends AUM publication for non-published funds. The code's current acceptance of those states is proven even though desired policy is unknown.

## 47. Expanded Funds ↔ AUM Current-State Summary

`/admin/funds` owns Fund identity, terms/disclosure versions, lifecycle, and stock disclosures. It reads—but never writes—the latest absolute AUM. `/admin/aum/*` owns AUM publication/history over the same Fund identities. AUM writes append batches/snapshots and return to both admin and client catalogues through latest-snapshot reads; they never change client investment-value ledgers.

The two surfaces are coupled through the cached, paginated Fund catalogue, permissions, and latest-AUM projection. That coupling currently hides funds after row 25 across both domains. AUM has working individual growth, percentage collective preview/commit, and history reads; initialization and correction are broken by a request-field mismatch, and explicit collective mode is broken by a mutually exclusive shape violation. Its history is truncated, preview display maps two wrong fields, route permissions underdeclare runtime dependencies, and its batch-to-idempotency FK is never populated. These facts should be treated as current architecture, not intended design.

## 48. Frontend View and Design Audit — Scope and Method

This section extends the current-state audit to the rendered frontend of `/admin/funds`, `/admin/funds/:fundId`, and every `/admin/aum/*` page. It is an inspection of the active JSX, resolved stylesheet imports, selector cascade, responsive rules, design tokens, interaction states, and compiled CSS artifact. It does not propose or apply a redesign.

The view audit distinguishes:

- **code-proven rendered structure** — elements and classes present on active route/component paths;
- **code-proven CSS result** — selectors that do or do not match that structure, import-order overrides, dimensions, breakpoints, and color values;
- **reasonable visual inference** — the likely rendered consequence of those rules where an authenticated populated browser session was unavailable;
- **UNKNOWN** — content-dependent geometry and any deployment-specific stylesheet or browser override not present in the repository.

The active routes could not be visually captured with live Fund/AUM data: the configured backend/database were unavailable, and the offline fixture principal has no Fund/AUM permissions. A headless browser correctly redirected an anonymous visit to Admin login and then rendered Forbidden after fixture login. The findings below therefore do not claim pixel-screenshot validation; they are derived from the exact active DOM/CSS paths and, where stated, computed token contrast.

### Impeccable audit score

| Dimension | Score | Evidence-based assessment |
|---|---:|---|
| Accessibility | 1/4 | Good semantic foundations are offset by invisible Fund-filter focus, multiple contrast failures, weak AUM field-error association, sub-token touch targets, and permission-inaccurate affordances. |
| Performance | 3/4 | No heavy page media/charts and route shell is lazy, but all Admin screens and a 101 KB minified Admin CSS chunk load together. |
| Theming | 1/4 | Semantic light/dark tokens exist, but active badge, result, error, danger, and nested-preview rules bypass them and fail contrast or invert incorrectly. |
| Responsive | 2/4 | Mobile shell and opt-in card tables are strong; raw/partial tables, duplicated AUM navigation, 640/768 breakpoint drift, and undersized controls remain. |
| Anti-patterns / consistency | 1/4 | Three style vocabularies, three table treatments, three badge families, nested cards, duplicate page navigation, and import-order-dependent duplicate selectors are active. |
| **Total** | **8/20** | **Needs significant improvement.** The token/shell foundation is sound, but these Fund/AUM views only partially use it. |

The score is an audit aid, not a runtime classification. Functional contract failures already proven elsewhere in this report remain higher priority than visual cleanup.

## 49. Active Frontend Style and Cascade Map

```text
frontend_stack/app/src/main.jsx:4-6
├─ @beonedge/design-tokens/tokens.css
│  ├─ design-tokens/src/fonts.css
│  └─ design-tokens/src/tokens-core.css
├─ @beonedge/design-tokens/kit.css
│  └─ design-tokens/src/kit-core.css
└─ app/src/index.css

frontend_stack/packages/admin/src/pages/Admin.jsx:25-27
├─ styles/desktop/admin.css
│  ├─ styles/admin/admin-base.css
│  ├─ styles/admin/admin-cards.css
│  ├─ styles/admin/admin-tables.css
│  ├─ styles/admin/admin-overlays.css
│  ├─ styles/admin/admin-payments.css
│  ├─ styles/admin/admin-funds.css
│  └─ styles/admin/admin-responsive.css
├─ styles/desktop/shell.css
└─ styles/desktop/site.css

FundsListScreen.jsx:13
FundWorkspace.jsx:14
FundProfileForm.jsx:7
AumScreen.jsx:16
└─ screens/admin-screens-shared.css

SkeletonTableRow.jsx:1
└─ components/SkeletonTableRow.css
```

Three simultaneously active visual vocabularies result:

| Namespace | Current responsibility | Fund/AUM usage | Status |
|---|---|---|---|
| `.ash-*` | Redesigned Admin shell, top bar, sidebar, mobile nav/domain strip, retry banner | Shell around every page; `AdminReadError`; Fund fatal-read Retry | **ACTIVE / INDIRECTLY ACTIVE** |
| `.adm-*` | Legacy operational-page cards, forms, tables, screens, decision regions | Most Fund/AUM page markup | **ACTIVE**, despite the “legacy” designation |
| `.be-*` | Shared tokens/kit buttons, badges, money, numeric and utility classes | All Fund/AUM buttons, `StateBadge`, money, eyebrow, padding/stack utilities | **ACTIVE / INDIRECTLY ACTIVE** |
| `.be-page`, `.be-section`, `.be-content-grid` primitives | New unified replacements for `.ash-page`, `.adm-screen`, old grids | Used by `OverviewPage`, not by Fund/AUM | **DUPLICATE / SUPERSEDING SYSTEM**, not yet active on these pages |

`styles/desktop/shell.css:1-8` explicitly states that the redesigned `.ash-*` shell coexists with legacy `.adm-*` screens while those screens await rebuild. The newer primitives make the same ownership explicit: `layout/primitives/Page.jsx:5-13` says it replaces `.ash-page` and `.adm-screen`; `ContentGrid.jsx:5-9` says it replaces `.adm-stats` and `.adm-grid-2`. The current Fund/AUM pages have not migrated to those primitives.

### Core active design tokens

The canonical source is `frontend_stack/packages/design-tokens/src/tokens-core.css:11-271`.

| Role | Current value |
|---|---|
| Ink / elevated ink | `#0E1116` / `#1A1F27` |
| Ivory / bone | `#F7F7F5` / `#FAF9F6` |
| Slate / faint slate | `#5C6470` / `#8A929D` |
| Accent gold | `#B5894A` |
| Financial green / red / amber | `#1F7A4D` / `#B43A2E` / `#A8741C` |
| Admin UI / metadata type | Instrument Sans / JetBrains Mono |
| UI sizes used here | 11, 13, 16, 18, 22, 28 px |
| Spacing | 4 px base scale |
| Radii | 2, 4, 8, 12 px, pill |
| Motion | 120, 200, 400, 600 ms |
| Touch targets | 48 comfortable, 44 minimum, 40 compact, 32 inline px |
| Admin max/layout | fluid full-width inside a 208–256 px sidebar |
| Breakpoints | 1100 px shell/tablet; 768 px mobile; Fund/AUM form collapse separately at 640 px |

The token palette supports OS dark preference and explicit `data-theme="dark"` (`tokens-core.css:393-477`). This makes the active hardcoded light fallbacks below a real runtime problem, not a hypothetical unused theme concern.

## 50. Rendered Element and Visual-State Inventory

### `/admin/funds`

`FundsListScreen.jsx:62-181` renders:

1. The shell H1, breadcrumbs, sidebar/mobile navigation, and logout controls.
2. A three-card `.adm-stats` row:
   - Fund pools, with a Layers icon;
   - Published pools, without an icon;
   - Draft or in review, without an icon.
3. In normal state, one `.adm-card.adm-table` containing:
   - eyebrow “Fund operations”;
   - H2 “AUM pools”;
   - small primary “New pool” button;
   - search icon/text input and native state select;
   - seven-column table: identity/slug, StateBadge, AUM, as-of date, stock count, version/update time, Open link.
4. Loading state: three `SkeletonTableRow` instances.
5. Empty states: instructional no-pool copy or no-filter-match copy.
6. Creating state: the stats remain, while the complete catalogue card is replaced by `FundProfileForm`.

The table opts into `.adm-table-cards` and supplies `data-label`, so at `<=768px` it becomes labelled row cards rather than a wide scroller (`admin-responsive.css:153-216`). This is the strongest responsive table implementation in the audited scope.

### Fund create / publish form

`FundProfileForm.jsx:82-198` renders one card-form with:

- H3 and immutable-version explanation;
- optional form-level validation banner;
- two-column grid of pool name, category, objective, risk, return band, minimum SIP, minimum one-time amount, minimum duration, recommended holding, disclosure title, and disclosure body;
- field hints or field errors, connected with `htmlFor`, `aria-describedby`, and `aria-invalid`;
- optional workflow note supplied by create;
- Cancel when creating and primary publish/create submit.

At `<=640px` the form becomes one column (`desktop/admin.css:73-77`). The two disclosure fields do span both columns because `.adm-field-wide` exists at `admin-overlays.css:288`; however, their JSX redundantly nests an outer `.adm-field.adm-field-wide` around the inner `.adm-field` returned by `field()` (`FundProfileForm.jsx:60-80,173-182`).

### `/admin/funds/:fundId`

`FundWorkspace.jsx:111-294` renders these states/elements:

- initial narrow skeleton card;
- fatal read alert with Retry and Back;
- full-width Back link in loaded state;
- identity card with slug eyebrow, fund H2, status explanation, and badge;
- four-column auto-fit definition grid for AUM, date, version, and risk;
- conditional status and error banners;
- wrapping lifecycle toolbar with secondary transitions and danger archive/remove;
- inline confirmation region with consequence copy and Cancel/Confirm;
- sticky three-chip section control: Published terms, Stock list, History;
- the shared profile form, stock panel, or version-history card.

The detail route’s shell H1 remains the prefix-matched catalogue title while the actual Fund name appears only as a card H2. This is code-accurate hierarchy, not a route-specific page header.

### Fund stock section

`FundStockListPanel.jsx:114-230` renders:

- icon H3 and explanatory subtitle;
- three-field add form plus primary Add stock;
- global error alert;
- active-stock table with name, quarter, weight, and two-click exit action;
- conditional native `<details>` disclosure containing exited holdings.

The exit button changes from secondary “Mark exited” to danger “Confirm exit” on first click, but no adjacent Cancel action is provided; cancellation requires clicking elsewhere/another row or completing the action.

### Fund version history section

`FundWorkspace.jsx:263-292` renders an H3/subtitle plus either an empty paragraph or an immutable version stream. Each version is another bordered `.adm-list-item` inside the enclosing card, with version/date header and terms summary.

### `/admin/aum/current`

`AumScreen.jsx:60-125,484-505` renders:

- the shell H1;
- a four-link in-page AUM chip strip;
- contextual retry alert when the catalogue fails;
- one `.adm-card.adm-table` with eyebrow, H2, Fund count badge, explanatory boundary note, and five-column table;
- table fields: Fund identity, state, published AUM, as-of date, Open fund;
- skeleton and instructional empty rows.

This table uses the same successful mobile card pattern as the Fund catalogue.

### `/admin/aum/manage`

`AumScreen.jsx:131-154` and `FundAumPanel.jsx:194-320` render:

- in-page AUM tabs and catalogue-read error;
- picker card with H2/subtitle and Fund select;
- after selection, a sibling AUM card with icon H3, explanatory copy, optional right-aligned current AUM/date, strong boundary note, read error, and conditional form;
- initialization form: amount, as-of date, reason, note;
- adjustment form: instruction mode, direction, amount/percentage, date, reason, note, local projection, error/success, publish action.

During history loading, the card shell shows “Adjust published AUM” but no progress indicator or form. After history failure, it simultaneously displays the read error and an initialization form because the empty history array is treated as authoritative no-history state.

### `/admin/aum/collective`

`AumScreen.jsx:286-450` renders:

- in-page tabs;
- one outer card containing catalogue error, icon H2/subtitle, strong boundary note;
- wide fieldset of Fund checkbox chips;
- mode, direction/percentage or generated per-Fund delta inputs, date, reason, note;
- Preview growth action;
- conditional nested preview card with Before/Delta/After table, Discard, and primary Commit;
- result status or error alert.

The same `.adm-chip` visual grammar is used for page navigation, workspace pressed tabs, and checkbox selections. Selected Fund labels do not receive `.is-active`; their only selected indicator is the checkbox itself.

### `/admin/aum/history`

`AumScreen.jsx:457-505` and `FundAumHistoryPanel.jsx:128-250` render:

- in-page tabs and picker card;
- after selection, sibling Snapshot history card with H3/subtitle, error/result feedback, and five- or six-column table;
- row fields: date, revision plus first-row “authoritative”, AUM, reason, publication time, conditional Correct action;
- two skeleton rows or an instructional empty row;
- permission-conditional inline correction row containing amount, editable date, reason, note, global error, and primary submit.

`aria-expanded` exists on Correct, but it has no `aria-controls`, the inserted region has no ID/labelled region, and focus is not moved into or announced for the newly inserted form.

## 51. Design Consistency, Hierarchy, and Symmetry Findings

### Severity-ranked design findings

| Severity | Finding | Exact evidence | Current consequence |
|---|---|---|---|
| P0 | Two primary AUM publish actions are visually enabled but cannot succeed | initialize and correction send `amountPaise`; strict backend requires `aumPaise` | “Publish initial AUM” and “Publish correction” are active-looking dead-end controls. |
| P1 | Destructive/create copy presents false consequences | `FundsListScreen.jsx:73-80`; `FundWorkspace.jsx:202,208-228` | High-risk confirmations assert removal/terminal archive and draft behavior that runtime does not implement. |
| P1 | Fund search and state filter have no code-defined keyboard focus | `admin-tables.css:53-60,70-76`; no wrapper `:focus-within` | More-specific `outline:none` defeats the global focus rule. |
| P1 | Collective preview is effectively unreadable in dark mode | `.adm-card--nested` hardcoded fallback at `desktop/admin.css:82-86` | Ivory inherited text can sit on `#f8fafc`, approximately 1.04:1. |
| P1 | State/result/error/danger treatments fail contrast, especially in dark mode | `kit-core.css:41,125-134`; `desktop/admin.css:45-50`; `admin-funds.css:261-278` | Status and response meaning becomes difficult to read at the actual 11–14 px sizes. |
| P1 | Fund workspace sticky tabs compete with the sticky shell top bar | `shell.css:195-207` and `admin-screens-shared.css:33-40` both use `top:0` and `--be-z-topbar` | On desktop scroll, the later workspace strip occupies the same sticky plane rather than offsetting below the shell header. |
| P1 | Permission and visual affordance are unsynchronized | Fund routes require read but show all writes; AUM tabs expose destinations irrespective of permission | Read-only or dependency-incomplete operators see controls/links that predictably end at 403/Forbidden. |
| P1 | Stock and AUM history tables bypass the table system | bare tables at `FundStockListPanel.jsx:171-214` and `FundAumHistoryPanel.jsx:143-248` | Browser-default table typography/cells remain inside only a max-content scroller. |
| P1 | Collective Fund checkbox CSS collides with broad field-input CSS | fieldset `.adm-field`; descendant rule `.adm-field input { width:100%; padding... }` | Checkbox inputs inherit full-width text-control styling; native fieldset border/padding is also never reset. |
| P1 | Partial results are presented as complete headline facts | Fund stat cards, Current AUM Fund count, “Every published snapshot” | First-25 datasets are elevated as global totals/history with no visual pagination disclosure. |
| P2 | “Fund” and “pool” name the same entity inconsistently | Funds catalogue/workspace vs every AUM page | Cross-navigation sounds like a domain change when it is the same Fund identity. |
| P2 | AUM route hierarchy is repeated | sidebar/mobile domain strip plus `AumScreen` four-chip strip | Mobile renders two AUM section switchers; internal strip additionally contains unauthorized destinations. |
| P2 | Shell and content headings repeat instead of forming one hierarchy | route H1 immediately followed by near-identical card H2 | The card frame, not route content, carries the operative title; detail H1 does not identify the current Fund. |
| P2 | Equivalent forms use different label systems | AUM `.adm-field span` = 11 px uppercase mono; Fund `.adm-field-label` = 12 px UI sans | Adjacent financial forms visibly belong to different generations. |
| P2 | Three table treatments exist in one domain | correct ancestor contract, bare table, `.adm-table` on `<table>` | Width, collapse, font, padding, mobile response, and row treatment differ by tab. |
| P2 | Three badge systems coexist | `.be-badge`, `.adm-status-badge`, `.ash-badge` | Active Fund/AUM `StateBadge` uses the least contrast-safe family. |
| P2 | Collective preview nests a framed card in another framed card | `AumScreen.jsx:405-438`; `desktop/admin.css:79-86` | Extra border/shadow/padding weakens hierarchy and caused the dark-theme fault. |
| P2 | A three-stat layout is forced into a two-column phone grid | three tiles; `admin-responsive.css:84-90` | Third KPI remains a half-width orphan; only the first tile also has an icon. |
| P2 | Back links stretch as screen flex children | `.adm-screen` column flex; `FundWorkspace.jsx:124-142`; no self-alignment | The inline-flex button/link can span the content width, unlike compact Back affordances elsewhere. |
| P2 | Action hierarchy varies across equivalent AUM tasks | bare `.be-btn` Preview/Discard, primary Commit, left-aligned individual/correction submit | Secondary/primary semantics and alignment change between closely related workflows. |
| P2 | Loading/error visuals are inconsistent | skeletons, shared Skeleton card, literal “Loading…”, blank panel, unstyled `.be-error` | Equivalent data waits/failures have materially different weight and recovery affordance. |
| P3 | Workspace retry mixes `.ash-btn` and `.be-btn` in one error state | `FundWorkspace.jsx:122-134` | Minor shell/page control mismatch. |
| P3 | Wrapped current-AUM metric retains right alignment | `.adm-aum-current { text-align:right }`; card head wraps | At narrow widths the wrapped metric is likely visually detached from left-aligned content; browser confirmation remains unavailable. |

### Positive consistency to preserve

- Palette, type, spacing, radius, shadows, safe areas, and motion largely originate in one token source.
- The 4 px rhythm, restrained 8 px cards, subtle shadows, sans task typography, and tabular financial numerals fit an institutional Admin register.
- `StateBadge` always includes text and an indicator, so status is not communicated by color alone and unknown states do not disappear.
- `I.jsx` makes decorative icons non-focusable/hidden from assistive technology unless intentionally labelled.
- Fund field-level validation is unusually complete: explicit labels, hint/error associations, invalid state, and error messages.
- Inline confirmations retain record context and avoid the retired hand-rolled modal/focus-trap problems.
- Opt-in card tables preserve header text off-screen and label every mobile value.
- Empty states explain a next step rather than merely saying “No data”.
- Mobile shell navigation, safe-area compensation, and bottom clearance are deliberately implemented.
- Global reduced-motion handling is comprehensive.

## 52. Table, Form, and Control CSS Contract Audit

### Table contract mismatch

The intended legacy structure is a container with `.adm-table` and a descendant `<table>`:

```jsx
<div className="adm-card adm-table">
  <div className="adm-table-scroll">
    <table>...</table>
  </div>
</div>
```

`admin-tables.css:2-14,98-127` applies width, border collapse, base font, header/cell padding, borders, sticky headers, hover, and column minimums only through this ancestor relationship.

| Surface | Markup | Matched result | Classification |
|---|---|---|---|
| Fund catalogue | parent `.adm-card.adm-table`, descendant `.adm-table-cards` | Full desktop table + mobile cards | **ACTIVE / correct contract** |
| Current AUM | parent `.adm-card.adm-table`, descendant `.adm-table-cards` | Full desktop table + mobile cards | **ACTIVE / correct contract** |
| Fund stocks | parent `.adm-card`, bare descendant `<table>` | Only `.adm-table-scroll table { min-width:max-content }`; browser-default table styling | **ACTIVE / CSS CONTRACT MISMATCH** |
| AUM history | parent `.adm-card`, bare descendant `<table>` | Same browser-default result; no mobile card conversion | **ACTIVE / CSS CONTRACT MISMATCH** |
| Collective preview | `<table className="adm-table">` | Descendant th/td rules match, but `.adm-table table` width/collapse/font rule does not; padding is applied to the table itself | **ACTIVE / PARTIAL MISMATCH** |

The AUM history rows already carry `data-label`, so the missing `.adm-table-cards`/ancestor contract—not missing data—is what prevents the established mobile treatment. Its inline correction-row joining rules also require `.adm-table-cards` (`admin-screens-shared.css:416-439`) and therefore never activate.

### Form contract differences

| Form family | Labelling/error behavior | CSS behavior |
|---|---|---|
| Fund profile | explicit label IDs, `aria-describedby`, `aria-invalid`, field errors/hints | `.adm-field-label` UI sans at 12 px; two-column grid; wide disclosures |
| Fund stock | wrapper labels, one global error | generic `.adm-field span` 11 px uppercase mono; raw controls |
| Individual AUM | wrapper labels, global alerts only | same generic AUM field style; no required/invalid linkage |
| Collective AUM | fieldset/legend plus wrapper labels; global alert | broad `.adm-field input` also styles nested checkboxes; fieldset default retained |
| AUM correction | wrapper labels; one global alert in inserted table row | same generic style; no `aria-controls` from Correct toggle |

`.be-error` is used throughout active AUM markup (`FundAumPanel.jsx:217-218,305-307`; `FundAumHistoryPanel.jsx:140,233-235`; `AumScreen.jsx:448`) but no `.be-error` CSS selector exists anywhere in the repository. These nodes retain `role="alert"`, but visually inherit ordinary paragraph/div styling. Fund errors use the styled `.adm-validation-banner` and `.adm-field-error` systems instead.

### Target-size matrix

| Control | Approximate active height | Repository target | Result |
|---|---:|---:|---|
| `.adm-chip` | at least 44 px | 44 px | Meets |
| Default `.be-btn` | about 39 px | 44 px minimum | Below project target; above WCAG 24 px minimum |
| `.be-btn-sm` | about 29 px | 40 px compact / 44 px minimum | Below project target |
| Generic `.adm-field` controls | mid-30 px | 44 px minimum | Below project target |
| Mobile Fund search/filter wrappers | at least 44 px | 44 px | Meets |
| Mobile card-table actions | at least 40 px | 40 px compact | Meets only in opted-in card tables |
| Mobile shell bottom items | at least 48 px | 48 px comfortable | Meets |

Lifecycle, Back, form submit, stock, history, and top-bar small controls do not receive the mobile table target override.

## 53. Theming and Measured Contrast

Contrast calculations use WCAG relative luminance and sRGB compositing over the actual token surfaces.

### Baseline token pairs

| Pair | Ratio | Result for normal text |
|---|---:|---|
| Ink / ivory | 17.63:1 | Pass |
| Ink / bone | 17.96:1 | Pass |
| Slate / ivory | 5.57:1 | Pass |
| Slate / bone | 5.68:1 | Pass |
| Faint slate / ivory | 2.93:1 | Fail |
| Green / ivory | 4.96:1 | Pass |
| Red / ivory | 5.46:1 | Pass |
| Amber / ivory | 3.78:1 | Fail |
| Gold / ivory | 2.95:1 | Fail for normal text; just below the 3:1 non-text threshold |
| Ivory / dark ink | 17.63:1 | Pass |
| Slate-2 / dark elevated ink | 5.26:1 | Pass |
| Gold / dark elevated ink | 5.23:1 | Pass |

### Active state badge contrast

`StateBadge.jsx:73-80` emits `.be-badge-active|paused|failed|neutral`. `kit-core.css:125-134` uses each raw signal color as 11 px text over its own translucent soft background instead of `--be-text-on-*`.

| Badge | Light elevated | Dark elevated | AA result at 11 px |
|---|---:|---:|---|
| Published/active green | ~4.41:1 | ~2.85:1 | Fails both; light narrowly |
| Review/paused amber | ~3.36:1 | ~3.58:1 | Fails both |
| Failed red | ~4.81:1 | ~2.65:1 | Pass light, fail dark |
| Neutral slate | ~4.97:1 | ~2.54:1 | Pass light, fail dark |

Two duplicate, safer families already use semantic text tokens: `.adm-status-badge*` (`admin-screens-shared.css:121-167`) and `.ash-badge*` (`shell.css:451-467`). Current Fund/AUM uses the inferior third family.

### Other active contrast/theme faults

- `.adm-gain-result` (`desktop/admin.css:45-51`) is ~4.41:1 light and ~2.85:1 dark. It renders AUM publication/correction/collective success feedback.
- Fund error text/banner and danger buttons use raw red. Light generally passes; dark is approximately 2.65–2.83:1.
- `.adm-card--nested` uses undefined `--adm-surface-muted`/`--adm-border`; its `#f8fafc/#e2e8f0` fallback remains light under dark tokens. Inherited ivory on `#f8fafc` is approximately 1.04:1.
- `.adm-field-label` falls back to fixed `#64748b` through another undefined legacy variable.
- The global 2 px gold focus outline (`tokens-core.css:384-388`) is 2.95:1 against page ivory and approximately 3.00:1 against bone: marginal/below WCAG 2.2 non-text contrast in light mode, strong in dark mode.
- `kit-core.css:41` hardcodes the danger border as `rgba(180,58,46,.3)` rather than a semantic theme token.

## 54. Responsive, Reflow, and Motion Audit

### Active breakpoint behavior

| Width | Active behavior |
|---|---|
| `<=1100px` | Several old Fund/editor/review grids collapse; shell is still desktop until the JS breakpoint at 768. |
| `<=768px` | Admin switches to bottom navigation/domain strip; `.adm-screen` gets 16 px padding and bottom-nav clearance; Fund/current tables become cards; search/filter reaches 44 px. |
| `641–768px` | Page is in mobile shell/table mode, but Fund/AUM forms remain two columns. |
| `<=640px` | `.adm-form-grid` finally becomes one column. |

### Page-specific responsive results

- Fund and Current AUM tables reflow into labelled cards and do not require horizontal discovery.
- Stock and AUM-history tables remain max-content horizontal scrollers; their important action columns may initially sit off-screen.
- Collective preview remains a horizontal/partial table because of its class placement.
- Fund’s three KPI cards are forced to two equal columns on phone, producing a 2+1 composition with an empty second track on the last row.
- The AUM in-page chip row wraps, while mobile also renders the domain strip containing substantially the same four destinations.
- At 400% zoom, stock/history/preview depend on horizontal table scrolling instead of the card reflow used by adjacent pages.
- `.adm-card-head` wraps, but the current-AUM summary retains `text-align:right` and has no mobile realignment rule.

### Motion

Active motion is restrained:

- 200 ms page translate/fade (`admin-base.css:83,298-301`);
- about 1.6 s skeleton pulse;
- 120 ms row/side transitions;
- 120/200 ms shell drawer transitions and 1.4 s shimmer.

`tokens-core.css:479-488` globally collapses animation/transition duration and iteration under `prefers-reduced-motion`. Admin and shell add explicit removals (`admin-base.css:303-312`; `shell.css:969-979`). No unresolved reduced-motion defect was found in the active Fund/AUM view.

## 55. Frontend CSS Duplicate, Superseded, and Stale Inventory

| Layer | File / selector A | File / selector B | Type | Active implementation / proof | Important difference / risk |
|---|---|---|---|---|---|
| Page system | `.adm-screen` / `.ash-page` | `layout/primitives/Page.jsx::.be-page` | Superseding system | Fund/AUM still use `.adm-screen`; Overview uses new primitive | Parallel layout contracts and breakpoints. |
| Grid | `admin-overlays.css:264::.adm-form-grid` | `desktop/admin.css:17-23::.adm-form-grid` | Same-selector override | Later desktop rule wins | Different gap, margins, and `align-items`; appearance depends on import order. |
| Wide field | `admin-overlays.css:288::.adm-field-wide` | `desktop/admin.css:25-27::.adm-field--wide` | Duplicate naming | Fund form uses first; AUM uses second | Same responsibility encoded two ways. |
| Accessible hidden | `admin-base.css:323-333::.adm-sr-only` | `desktop/admin.css:64-71::.adm-sr-only` | Near duplicate | Combined cascade is active | Later partial recipe relies on earlier reset declarations. |
| Badge | `kit-core.css::.be-badge*` | `shared.css::.adm-status-badge*`; `shell.css::.ash-badge*` | Independently implemented versions | Fund/AUM `StateBadge` uses `.be-badge*` | Active version has inferior light/dark contrast. |
| Table | `.adm-table*` | `.ash-table*` | Parallel system | Fund/AUM pages use `.adm-*`; shell/new pages use `.ash-*` | Two responsive contracts; current pages also create bare third variants. |
| Detail panel | `admin-overlays.css:304-335` | `admin-screens-shared.css:470-487` | Same selectors, overlapping | Build order makes later Admin barrel copy win | Background/border differences; no cascade layer defines ownership. |
| Table hover | `admin-tables.css:11` | `admin-tables.css:112-114` | Same-selector duplicate | Later 5% rule wins | 4% rule is superseded noise. |
| Old Fund editor | `admin-funds.css:302-304::.adm-fund-editor-panel` | same file `:458-460` | Exact duplicate, deprecated | No production JSX caller | Explicitly deprecated selector is emitted twice. |
| Old Fund page | `admin-funds.css` legacy layout/editor/lifecycle/allocation/preview families | current routed Fund/AUM JSX and generic styles | Superseded / stale | Current routes use generic card/form/table classes | 118 of 126 lexical class selectors have no literal production source reference; dynamic modifiers make this a likely-dead count, not proof for every selector. |
| Error | active `.be-error` markup | no CSS definition | Missing implementation | Used by all AUM forms | Semantic alerts render without intentional visual design. |

Additional same-specificity overlaps include `.adm-review-panel`, `.adm-review-actions`, `.adm-detail-title`, `.adm-detail-tags`, and `.adm-m-t-2`. No CSS `@layer` contract defines which file owns these symbols; current behavior depends on emitted import order.

### Stale selector families still shipped

The following old Fund-control-center families have no current production base-symbol reference and are still imported through `desktop/admin.css:11`:

- `.adm-fund-layout`, `.adm-fund-dashboard`, `.adm-fund-tabs`, `.adm-fund-form`, `.adm-fund-section`;
- `.adm-fund-editor-*`, `.adm-lifecycle-*`;
- `.adm-diversification-*`, `.adm-concentration-*`, `.adm-metric-*`;
- `.adm-distribution-preview*`, `.adm-fund-preview*`;
- `.adm-allocation-stats`, `.adm-capital-stats`;
- old investment/sector/series row families.

The legacy file cannot simply be removed as-is: current Fund validation/help styling still lives in small active islands within it, including `.adm-validation-banner` and `.adm-help-text` (`admin-funds.css:261-288,503-511`). It is therefore **mostly STALE / LEGACY with INDIRECTLY ACTIVE selectors**, not wholly unreachable.

## 56. CSS and Frontend Bundle Cost

The current built artifact contains:

| Artifact | Size |
|---|---:|
| `frontend_stack/app/dist/assets/admin-C4KlvGkC.css` | 101,106 bytes minified; 15,466 bytes gzip |
| Shared `index-B-n7yCQX.css` | 21,221 bytes |
| Source `shell.css` | 34,201 bytes |
| Source `admin-funds.css` | 18,313 bytes / 823 lines |
| Source `admin-base.css` | 14,151 bytes |
| Source `admin-screens-shared.css` | 14,017 bytes |
| Source `admin-overlays.css` | 10,789 bytes |
| Source `admin-responsive.css` | 9,429 bytes |

`Admin.jsx:5-19` statically imports every wrapper from `legacyRoutes.jsx`, and that wrapper statically imports all operational screens. `Admin.jsx:25` loads the complete legacy CSS barrel for every Admin route. Vite’s Admin manual chunk policy further groups Admin modules. Consequently, opening Funds/AUM—or any authenticated Admin route—loads broad Admin UI/CSS rather than a Fund/AUM route-level slice.

This is a measurable bundle/parse-maintenance concern, but no evidence establishes that it presently causes user-visible latency; classification is **ACTIVE PERFORMANCE OVERHEAD / P2**, not a proven runtime performance failure.

## 57. Design-Specific Future Redesign and Cleanup Candidates

No files were changed as part of this audit. If a later redesign is authorized, the design evidence points to these files:

| Priority | File(s) | Why likely to change |
|---:|---|---|
| 1 | `screens/FundAumPanel.jsx`, `screens/FundAumHistoryPanel.jsx`, `screens/AumScreen.jsx` | Repair dead primary interactions first; then align errors, field semantics, preview state, permission-aware navigation, and table markup. |
| 1 | `screens/fundOps/FundsListScreen.jsx`, `FundWorkspace.jsx`, `FundProfileForm.jsx`, `FundStockListPanel.jsx` | Truthful copy/consequences, write affordances, canonical Fund noun, sticky tabs, table contract, action hierarchy, form consolidation. |
| 1 | `design-tokens/src/kit-core.css`, `components/StateBadge.jsx` | Theme-safe badge/danger colors, control targets, consistent button variants. |
| 1 | `styles/desktop/admin.css` | Remove undefined legacy variables/hardcoded light nested card; unify AUM result/projection styling. |
| 1 | `styles/admin/admin-tables.css`, `admin-responsive.css` | One table contract, focus-within for search/filter, consistent reflow and targets. |
| 2 | `styles/admin/admin-overlays.css` | Narrow the overbroad `.adm-field input` rule so checkbox/radio descendants are not text controls; align field labels/errors. |
| 2 | `screens/admin-screens-shared.css` | Separate navigation tabs from selection chips; resolve sticky offset; centralize decision/list/error states. |
| 2 | `layout/primitives/{Page,PageHeader,Section,ContentGrid}` | Already-declared successor primitives for page/layout/hierarchy, if adopted by Fund/AUM. |
| 2 | `styles/admin/admin-funds.css` | Extract the small active validation/help islands before consolidating/removing stale editor/control-center rules. |
| 3 | `pages/legacy/legacyRoutes.jsx`, `pages/Admin.jsx`, `app/vite.config.js` | Route-level component/CSS splitting and removal of static legacy breadth after behavior is stabilized. |

### Design consolidation order supported by current evidence

1. Functional truth and safety: working AUM submit contracts, truthful destructive/create copy, and permission-accurate affordances.
2. Accessibility hardening: Fund-filter focus, contrast-safe status/error/result/danger styles, field-level AUM errors, and consistent targets.
3. Responsive structure: one table markup contract, one mobile treatment, sticky header offset, and removal of duplicate AUM navigation.
4. Visual consistency: canonical “Fund” terminology, one page/title hierarchy, one field-label system, one badge system, and intentional action variants.
5. CSS architecture: migrate or consolidate page primitives, extract active legacy islands, remove proven stale selectors, then revisit chunk boundaries.

## 58. Frontend Design Current-State Summary

The Funds and AUM pages sit inside a well-considered responsive `.ash-*` shell and inherit a strong semantic token foundation, but their page bodies remain predominantly `.adm-*` legacy operational screens using `.be-*` kit controls. This partial migration is visible in the runtime architecture: route headings and retry controls use the new shell language, while cards/forms/tables use an older language and shared buttons/badges use a third.

The current Fund catalogue and Current AUM table are the most internally coherent views: both use the same card/table structure, responsive mobile-card conversion, status component, money formatting, loading rows, and explanatory empty states. FundProfileForm is the strongest accessible form. The mobile Admin shell, safe-area handling, inline confirmations, reduced-motion support, and tabular financial typography are also sound patterns.

The inconsistencies are nevertheless material. Stock/history/preview tables implement three incompatible CSS contracts; AUM errors have no matching selector; two AUM publish controls are visually available but functionally dead; state and result colors fail in dark mode; the collective preview can become almost unreadable; Fund filters lose visible focus; many phone controls miss the repository’s own 44 px target; workspace tabs share the shell’s sticky plane; AUM navigation is duplicated; and the same entity, form labels, badges, and action variants change vocabulary between adjacent tasks.

The compiled Admin stylesheet also carries substantial superseded Fund-editor CSS and same-selector overrides whose ownership is defined only by import order. Those artifacts should not be removed until their small active validation/help islands are extracted and all dynamic callers are rechecked. The code-proven current state is therefore a strong shell/token foundation wrapped around fragmented legacy page implementations—not one unified Fund/AUM design system.

## Verification Performed

- Exhaustive `rg` reference/import/route/table searches across `frontend_stack/packages/admin`, `frontend_stack/packages/ui-kits`, `backend_controller/src`, `backend_controller/db/migrations`, `packages/contracts`, and tracked release configuration.
- Line-by-line tracing of route registration, handler calls, repository SQL, auth, HTTP envelope, database configuration, frontend request transport, route wrappers, UI handlers, and form transforms.
- Frontend focused tests: `fundOps.test.jsx`, `adminResources.test.jsx`, and `Admin.test.jsx`: **125/125 tests passed**.
- AUM frontend route/screen/navigation tests: **116/116 tests passed**. The focused `aumScreen.test.jsx` suite also passed 13/13 in an independent run.
- Backend pure AUM calculation tests: `fundAumGrowth.test.ts`: **11/11 tests passed**.
- Design-token CSS contract suites (`classContract`, `componentContract`, `cssContract`, `importContract`, `interactionContract`, `safeArea`): **33/33 tests passed**. These tests validate repository contracts but do not cover the page-specific selector/markup mismatches documented above.
- CSS import/cascade inspection, current compiled CSS size inspection, active JSX class-to-selector mapping, breakpoint/reflow tracing, reduced-motion tracing, and WCAG relative-luminance calculations were performed for both light and dark token surfaces.
- A local headless-browser smoke attempt reached the expected login/Forbidden boundaries, but populated Funds/AUM visual capture was unavailable without a live authorized backend principal; no screenshot-based pixel claims are made.
- The AUM backend integration suite was inspected line by line for request/response and persistence assertions but not executed because live/container database startup was outside this inspection run. Its correct `aumPaise` fixtures conflict with the frontend tests' `amountPaise` fixtures.
- Backend test search found no dedicated `adminCatalogRoutes` behavioral suite; `adminAum.integration.test.ts:867` exercises the Fund-detail GET only incidentally. Create/version/lifecycle/stock behavior is therefore established from registered code paths, not dedicated backend test coverage.
- Local listener/database readiness check: configured backend/PostgreSQL endpoints unavailable; no database mutations or application startup performed.

## Evidence Limitations / UNKNOWN Items

- Live database contents, counts, current rows, physical indexes/constraints, and applied migrations.
- Which remote release stack/private nginx copy is presently running and its deployment-baked environment values.
- Whether any external consumer outside this repository calls the registered stock PATCH endpoint.
- Whether external/manual database writers assign the otherwise unreachable `review_pending` state.
- Whether physical production data exists in orphaned tables before future cleanup.

These items require read-only access to the running deployment/database or external-consumer inventory; the repository alone cannot prove them.

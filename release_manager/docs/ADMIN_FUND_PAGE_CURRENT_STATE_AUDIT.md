# Admin Panel → Fund Page: Current-State Forensic Audit

Audit date: 2026-08-21
Repository root: `/home/nethunter07/PROJECTS/boe_app`
Scope: inspection only; no application, schema, migration, configuration, test, or database changes were made.

## 1. Executive Summary

The current Admin Fund surface is a routed React implementation with two canonical URLs:

- `/admin/funds` renders the issued-fund catalogue and create form.
- `/admin/funds/:fundId` renders a routed workspace for published terms, lifecycle, stock disclosures, and version history.

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
14. **The Fund shell always loads the approvals queue without checking `applications.read`.** A principal with `funds.read` but without application access gets a hidden background 403 and a zero badge while the Fund page itself remains usable.

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

## 12. Current Database Reads

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

## 13. Current Database Writes / Updates / Deletes

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
- AUM initialization on the separate AUM page sends the wrong field name.

The unreachable UI-kit prototype contains genuinely dead Upload NAV, Publish, New fund, and Edit controls.

## 24. Backend Capabilities Not Used by the Current UI

- `PATCH /v1/admin/funds/:fundId/stocks/:stockId`.
- Cursor pagination after page 1 for `GET /v1/admin/funds`.
- Optional idempotency replay for Fund/stock mutations.
- Returned `stocks` in `GET /v1/admin/funds/:fundId` (payload and database query are unused by the workspace).
- Conditional allocation/refund capabilities under investment review are not Fund-page controls.
- AUM initialize/growth/correction/collective/history routes are separate `/admin/aum` capabilities.

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

## 29. Current-State Architecture Diagram

```text
Admin SPA (one Vite shell, admin target)
├─ AdminSessionProvider
├─ ResourceCacheProvider
├─ AdminShell
│  └─ global applications-queue polling
└─ Fund routes
   ├─ cached catalogue list
   └─ direct-request workspace
      ├─ terms/version form
      ├─ stock disclosure panel
      └─ history
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
└─ AdminCatalogRepository (no service layer)
           │
           ▼
Kysely + pg Pool
           │
           ▼
PostgreSQL
├─ Fund catalogue/history/stock/AUM-read tables
├─ audit_events
└─ optional idempotency_records
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

## 33. Final Current-State Architecture Summary

The Admin Fund page is not a monolithic legacy editor anymore. It is one canonical catalogue route plus one canonical per-fund workspace, backed by one active admin route module and one active repository. The persisted model is versioned terms/disclosures, a lifecycle row, manual stock disclosures, and externally managed absolute AUM snapshots—no NAV and no physical deletion in the Fund flow.

The implementation is operationally split in important ways: list data is cached but detail/stocks are locally fetched; create spans two HTTP transactions; admin and client catalogues independently map the same tables; request schemas live only in backend Zod; frontend responses are untyped; and several UI promises do not match backend behavior. Allocation and refund are separate conditional review capabilities, AUM is a separate admin domain, and unallocation/redemption do not exist in the current baseline.

The most important pre-redesign facts to preserve are the actual route ownership, the absence of a Fund service layer, append-only version/disclosure history, audit writes in the same mutation transaction, the latest-AUM lateral read, live-per-request RBAC, and the distinction between archiving and deletion. The most urgent inconsistencies to resolve in a future change are pagination loss, disclosure-body omission, non-atomic creation, archive semantics/copy, authorization-aware controls, stock cache invalidation, and the AUM initialize field mismatch.

## Verification Performed

- Exhaustive `rg` reference/import/route/table searches across `frontend_stack/packages/admin`, `frontend_stack/packages/ui-kits`, `backend_controller/src`, `backend_controller/db/migrations`, `packages/contracts`, and tracked release configuration.
- Line-by-line tracing of route registration, handler calls, repository SQL, auth, HTTP envelope, database configuration, frontend request transport, route wrappers, UI handlers, and form transforms.
- Frontend focused tests: `fundOps.test.jsx`, `adminResources.test.jsx`, and `Admin.test.jsx`: **125/125 tests passed**.
- Backend test search found no dedicated `adminCatalogRoutes` behavioral suite; `adminAum.integration.test.ts:867` exercises the Fund-detail GET only incidentally. Create/version/lifecycle/stock behavior is therefore established from registered code paths, not dedicated backend test coverage.
- Local listener/database readiness check: configured backend/PostgreSQL endpoints unavailable; no database mutations or application startup performed.

## Evidence Limitations / UNKNOWN Items

- Live database contents, counts, current rows, physical indexes/constraints, and applied migrations.
- Which remote release stack/private nginx copy is presently running and its deployment-baked environment values.
- Whether any external consumer outside this repository calls the registered stock PATCH endpoint.
- Whether external/manual database writers assign the otherwise unreachable `review_pending` state.
- Whether physical production data exists in orphaned tables before future cleanup.

These items require read-only access to the running deployment/database or external-consumer inventory; the repository alone cannot prove them.

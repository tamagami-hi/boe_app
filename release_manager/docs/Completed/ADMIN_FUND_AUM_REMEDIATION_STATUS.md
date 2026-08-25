# Admin Funds/AUM Remediation Status

This companion report reconciles the historical current-state audit against the Fund/AUM remediation now present in the repository. The historical audit remains unchanged in `ADMIN_FUND_PAGE_CURRENT_STATE_AUDIT.md`.

## 1. Reconciliation Scope

Reconciliation date: 2026-08-21

Historical audit baseline: `a48c916`

Remediation commits inspected: `e9c10a5`, `14be861`

Current repository inspected: `5bc5846` (`v0.10.6`)

Working tree before this report-only update: clean

This section answers which findings from the audit have been implemented and which remain open. Status is based on the current import graph, route registration, request construction, handler code, repository queries, ordered migrations, CSS cascade, and focused test/build execution—not commit messages.

Status meanings:

- **APPLIED** — the current source closes the previously reported behavior or design defect.
- **PARTIALLY APPLIED** — the primary path is repaired, but a reachable edge, secondary surface, or contract gap remains.
- **STILL OPEN** — the current source still exhibits the finding.
- **REGRESSED / BLOCKING** — remediation introduced or exposed a new failure that blocks the intended result.
- **DEFERRED PRODUCTION READINESS** — not required for the disposable developer environment by current project decision, but must be resolved before a production release or migration-based upgrade.
- **IMPLEMENTED, DEPLOYMENT UNKNOWN** — a forward migration exists, but its applied state cannot be proven against a live database.
- **N/A / DELIBERATE BOUNDARY** — accurate architecture, not unfinished remediation.

### Current conclusion

Most high-severity frontend and handler-level findings are now repaired. Fund creation is a single atomic and idempotent request; Funds and AUM are paginated; disclosure editing works; archived Funds cannot be restored through lifecycle APIs; AUM initialize/correction and collective request shapes match the backend; permission-aware UI and route prerequisites are substantially improved; stock editing is reachable; and the Fund/AUM CSS and responsive table implementation are materially consolidated.

The application-level remediation is suitable for continued developer testing, subject to the open runtime findings below. By project decision, migration and rollback compatibility are **not an immediate requirement** because there are no real users or production data; development databases may be discarded and rebuilt from a canonical schema. The repository's current ordered migration chain is still factually broken at migration 031, so migration-based integration tests cannot validate the repaired flows. That is recorded as **deferred production readiness / test-harness debt**, not as the first current development fix. It becomes mandatory before a production release or before preserving/upgrading any non-disposable database.

## 2. Applied Remediation Inventory

### Fund catalogue and workspace

| Prior finding | Status | Current proof |
|---|---|---|
| Fund catalogue silently showed only the first 25 rows. | **APPLIED** | `data/adminResources.js:41-107` requests 100 rows and appends authenticated cursor pages; `FundsListScreen.jsx:165-181` exposes Load more; `adminCatalogRoutes.ts:64-71,173-200` implements state/search filters, cursor metadata, and global summary counts. |
| Counts were computed from the loaded slice. | **APPLIED** | The backend returns `summary`; `FundsListScreen.jsx:37-58` renders server totals rather than slice totals. |
| Fund creation used two HTTP calls and could leave a partial draft. | **APPLIED** | `adminCatalogRoutes.ts:303-415` creates the Fund, disclosure/version, opening AUM batch/snapshot, and audit events inside one UnitOfWork transaction. `useFundMutations.js:13-24` sends one `POST /v1/admin/funds`. |
| First-version creation automatically published the Fund despite draft copy. | **APPLIED** | `adminCatalogRepository.ts:259-293` leaves the lifecycle state as `draft` when setting the current version. `FundProfileForm.jsx:107-113` now explains the actual workflow. |
| Create did not navigate and invalidated a still-mounted list. | **APPLIED for create** | `/admin/funds/new` is a separate route (`Admin.jsx:66-68`); `FundCreateScreen.jsx:15-45` navigates to the returned Fund workspace. |
| Create response ID was unchecked. | **APPLIED** | `data/fundContracts.js:62-67` and `useFundMutations.js:19-23` validate the created Fund ID before navigation. |
| Disclosure body was not returned, so edit prefill was blank. | **APPLIED** | `adminCatalogRepository.ts:65-72,362-369` selects `body`; `adminCatalogRoutes.ts:227-231` returns it; `fundContracts.js` validates the detail boundary. |
| Archive and DELETE duplicated the same operation, copy promised removal, and archived Funds could be republished. | **APPLIED for Fund lifecycle** | Fund DELETE is no longer registered (`adminCatalogRoutes.ts:677-700`). `ALLOWED_TRANSITIONS.archived` is empty (`:57-62`) and is enforced in the lifecycle handler. `FundWorkspace.jsx:192-219` describes archive as final and keeps the record visible. |
| Read-only principals saw Fund write controls. | **APPLIED** | `legacyRoutes.jsx:49-89` derives `canWrite`; catalogue, version, lifecycle, and stock controls render conditionally. `/admin/funds/new` additionally requires `funds.write` and `aum.write` in `nav.js:276-290`. |
| Stock PATCH was backend-only. | **APPLIED** | `FundStockListPanel.jsx:110-148,258-324` implements edit/save/cancel and calls PATCH. |
| Stock writes left cached `stockCount` stale. | **APPLIED** | `FundStockListPanel.jsx:80-83` invalidates Fund resources after stock writes. |
| Mounted cache entries did not refetch when invalidated. | **APPLIED for the cached first page** | `ResourceCacheProvider.jsx:163-167` detects `updatedAt === null` and reloads mounted successful resources. |
| Duplicate `slugify` implementations could drift. | **APPLIED** | The active create model owns the remaining Fund slug transformation; the mutation-hook fallback copy was removed. |

### AUM routes and workflows

| Prior finding | Status | Current proof |
|---|---|---|
| AUM current/pickers inherited the first-25-Funds cap. | **APPLIED** | All tabs use paged `useAdminFunds`; `AumScreen.jsx:29-68,138-153,370` exposes Fund pagination. |
| AUM history stopped at 25 with no cursor UI. | **APPLIED** | `useAumHistory.js:5-75` requests 100 and appends cursor pages; `FundAumHistoryPanel.jsx:189-201` exposes Load older; `adminAumRoutes.ts:423-463` serves keyset pages. |
| Initialize and correction sent `amountPaise` instead of `aumPaise`. | **APPLIED** | `FundAumPanel.jsx:75-82` and `FundAumHistoryPanel.jsx:50-77` now send `aumPaise`, matching `adminAumRoutes.ts:70-100`. |
| Explicit collective mode sent both `fundIds` and `items`. | **APPLIED** | `AumScreen.jsx:237-265` sends `{fundIds,growthBasisPoints}` for percentage or `{items}` for explicit deltas, never both. |
| Collective preview consumed incompatible field names. | **APPLIED** | `fundContracts.js:78-92` requires `beforeAumPaise`, `deltaPaise`, and `afterAumPaise`; `AumScreen.jsx:493-513` renders those fields. |
| Editing visible inputs after preview could commit the old request. | **APPLIED** | The shared change/discard path clears preview/result for selection, mode, direction, value, date, reason, and note changes in `AumScreen.jsx:220-265,351-462`. |
| A failed history read was treated as “no history” and exposed initialize. | **APPLIED** | `FundAumPanel.jsx:52-55,169-196` requires a successful read before entering opening state and provides retry UI on failure. |
| Initialize could be repeated despite existing snapshots. | **APPLIED** | `adminAumRoutes.ts:212-216` locks the Fund and rejects initialize when a latest snapshot exists. |
| Correction exposed an editable date the server would reject. | **APPLIED** | The correction request no longer contains a date; the backend derives the target date (`adminAumRoutes.ts:364-415`). `FundAumHistoryPanel.jsx:203-217` presents the date as fixed semantics. |
| Correction expansion lacked a programmatic relationship/focus transition. | **APPLIED** | `FundAumHistoryPanel.jsx:37-39,168-180,203-210` supplies `aria-controls`, an ID, and focus transfer. |
| Local percentage preview lost precision through `Number`. | **APPLIED for preview arithmetic** | `FundAumPanel.jsx:25-33,57-65` uses `BigInt`. |
| UTC default dates could be one local day behind in India. | **APPLIED** | `helpers/aumReasons.js` supplies `todayInIndia()`, used by Fund/AUM flows. |
| Zero-after-rounding and percentage bounds differed across AUM forms. | **APPLIED on current UI paths** | `helpers/signedAmounts.js:1-35` centralizes rejection and the 1000% UI maximum. |
| Route permissions omitted the Fund catalogue and history prerequisites. | **APPLIED at route enforcement** | `nav.js:120-151,257-290` combines `aum.read`/`aum.write` with `funds.read`, and Manage also requires `aum.read`. `AumEntryRedirect` chooses a permitted entry path. |
| Fund selection was lost on navigation/refresh. | **APPLIED** | `AumScreen.jsx:159-169` stores Manage/History selection in `?fund=`. |
| Backdated growth was accepted. | **APPLIED on individual and collective commit** | `adminAumRoutes.ts:289-292,488-491` rejects an as-of date earlier than the latest basis. |

### Authentication, contracts, database code, and design

| Prior finding | Status | Current proof |
|---|---|---|
| The shell polled approvals for users without `applications.read`. | **APPLIED** | `ApprovalsQueueProvider.jsx:31-35,70-112` gates initial read and polling. |
| Latest-AUM SQL and Fund projections were independently duplicated. | **APPLIED** | `repositories/fundAumOrdering.ts` centralizes ordering/lateral projection; `routes/fundProjection.ts` centralizes shared mapping used by admin and client catalogues. |
| `aum_growth_batches.idempotency_record_id` was declared but never populated. | **IMPLEMENTED, DEPLOYMENT UNKNOWN** | Migration 029 drops the constraint/column and the AUM batch runtime type no longer contains it. |
| `fund_positions`, `approval_actions`, stale Fund `review_pending`, and the redemption threshold were orphaned. | **RUNTIME CLEANUP APPLIED; MIGRATION COMPATIBILITY DEFERRED** | Runtime types/code were cleaned. Migrations 030–032 describe the forward cleanup, but current project policy permits a direct development-schema reset instead of maintaining upgrade/rollback compatibility. |
| Fund/AUM responses had no runtime frontend checking. | **PARTIALLY APPLIED** | `data/fundContracts.js:1-93` validates Fund rows/summary/detail/create and AUM history/preview. There is still no generated/shared contract and not every success payload is validated. |
| Fund/AUM screens were bundled through eager operational-screen imports. | **APPLIED for JavaScript** | `legacyRoutes.jsx:17-30` lazy-imports screens; `vite.config.js:30-43` produces separate `admin-funds` and `admin-aum` chunks. |
| The 823-line legacy Fund stylesheet was mostly stale. | **APPLIED** | `admin-funds.css` is now 49 active lines (1,066 bytes), retaining only validation/help/editor-scroll rules. |
| Funds/AUM used incompatible raw/partial table contracts. | **APPLIED** | Catalogue, Current AUM, stock, AUM history, and collective preview now use `.adm-card.adm-table` with `.adm-table-cards`. |
| Search/filter focus was invisible and controls missed the project target size. | **APPLIED** | `admin-tables.css:58-63` adds `:focus-within`; `kit-core.css:3-74` and `admin-overlays.css:257-271` supply 44/40 px targets. |
| Status/error/success surfaces failed dark-theme contrast or used undefined fallbacks. | **LARGELY APPLIED** | `kit-core.css:131-149` uses semantic on-colors; `desktop/admin.css:30-67` uses semantic surfaces/borders. Default danger text still uses raw `--be-red`, so the broader design-system item is partial. |
| AUM in-page tabs duplicated shell/mobile navigation. | **APPLIED** | `AumScreen.jsx:553-560` renders only the routed tab; the second tab strip is gone. |
| Collective checkboxes were styled as full-width text inputs. | **APPLIED** | `admin-overlays.css:257-264` excludes checkbox/radio; `desktop/admin.css:149-187` defines a distinct check-chip contract. |

## 3. Deferred Production-Readiness and Integration-Harness Finding

### Migration 031 cannot convert the Fund enum

**Status: DEFERRED FOR CURRENT DEVELOPMENT; PRODUCTION-RELEASE GATE**

`db/migrations/031_drop_fund_review_pending_state.sql:1-17` drops only `funds_published_ts`, renames `fund_state` to `fund_state_legacy`, creates the replacement enum, and alters `funds.state`. The constraints `funds_archived_ts` and `funds_paused_ts`, created by `015_canonical_catalog.sql:44-45`, remain bound to the renamed enum.

On a fresh integration database, the `ALTER COLUMN` fails with:

```text
operator does not exist: fund_state <> fund_state_legacy
```

Consequences if the ordered migrations are used:

- The ordered migration chain cannot reach the intended current schema without correction or replacement by a reset/squashed development baseline.
- The migration runner commits each migration separately (`scripts/migrate.ts:64`), so 029 and 030 can already be committed when 031 fails.
- All 24 Admin AUM integration tests are skipped after setup failure; their `afterAll` also encounters an uninitialized application.
- Runtime TypeScript assumes the four-state Fund model even though a partially migrated database may remain on the five-state enum.
- The state of any local/test database that previously used this sequence is **UNKNOWN** until `schema_migrations` is queried; no production database is currently in scope.

A second test inconsistency is masked by this failure: migration 030 drops `approval_actions`, but `test/integration/database.integration.test.ts:295-318` still inserts and validates that table.

Current project decision:

- Do not prioritize rollback or in-place upgrade compatibility during developer-only testing.
- A disposable development database may be reset from a corrected canonical schema instead of carrying compatibility migrations 029–032.
- Do not treat this as a blocker for the frontend/backend source fixes in Sections 60–63.
- Before production release, choose and verify one authority: either a repaired forward migration chain or a deliberately squashed production baseline. At that point the full migration and database integration suite must pass from an empty database and from every supported upgrade starting point.

## 4. Partially Applied Findings

| Finding | Current residual issue | Evidence |
|---|---|---|
| Archive is terminal. | Lifecycle/version/add-stock paths reject archived Funds, but stock PATCH and stock DELETE/exit do not lock or check the parent Fund. Direct authenticated `funds.write` callers can still modify archived Fund stocks. | `adminCatalogRoutes.ts:550-635`; compare add-stock guard at `:512-514`. |
| Fund/stock idempotency. | Create/version/lifecycle send keys, but stock POST/PATCH/DELETE do not. Backend idempotency remains optional, so these writes execute without an idempotency record. | `useFundMutations.js:13-45`; `FundStockListPanel.jsx:85-168`; `adminCatalogRoutes.ts:140-168`. |
| Idempotency request equality. | Backend canonical hashes omit material fields: create omits much of terms/disclosure/AUM metadata; version omits most terms; stock hashes omit mutable stock fields. A reused key with a changed omitted field can replay the earlier result rather than conflict. | `adminCatalogRoutes.ts:310-316,424-430,503-510,557-564`. |
| Redundant stock reads. | Detail passes `stocks` into the stock panel, but an empty array is treated as “not loaded,” so a legitimately empty Fund issues another GET. | `FundWorkspace.jsx:274-277`; `FundStockListPanel.jsx:47-57`. |
| Cache invalidation/freshness. | Mounted first-page resources now refetch. Cursor-appended pages are held in separate hook state and are not cleared by cache invalidation; a changed Fund outside page one can remain stale until refresh/remount. | `ResourceCacheProvider.jsx:163-167`; `adminResources.js:66-96`. |
| AUM chronological guard. | Individual and collective commit reject backdated changes, but collective preview does not, so a backdated request can preview successfully and fail only on commit. | `adminFundGrowthPreviewRoutes.ts:33-73`; `adminAumRoutes.ts:488-491`. |
| AUM lifecycle eligibility. | Archived Funds are excluded/rejected. Draft and paused Funds remain valid AUM mutation targets. The repository does not prove whether this is intended policy. | `AumScreen.jsx:25-27`; `adminAumRoutes.ts:192-196,481-483`. |
| Route prerequisite presentation. | `Permitted` correctly enforces `requiresAll`, but mobile `AdminDomainStrip` filters only `item.permissions`; it can show a sibling link whose prerequisite permissions are absent. | `AdminDomainStrip.jsx:18-20`; `nav.js:271-289`. |
| Contracts. | Handwritten response parsers cover important reads, but request schemas remain independently maintained; version/lifecycle/stock successes, individual AUM mutations, correction, and collective commit are not comprehensively parsed. Generated OpenAPI contains no Admin Fund/AUM contract. | `data/fundContracts.js`; backend inline Zod schemas. |
| Design system. | Page/Table primitives, tokens, contrast, focus, targets, and mobile tables improved substantially. `.ash-*`, `.adm-*`, and `.be-*` vocabularies still coexist; AUM card headings often repeat the shell heading. | `AdminShell.jsx`, `AumScreen.jsx`, Admin CSS barrels. |
| CSS delivery. | JavaScript is route-split, but Admin CSS is still broadly imported. Current Admin CSS is 88,896 bytes versus 101,106 bytes in the baseline. | `pages/Admin.jsx` static CSS imports; current production build output. |

## 5. Still-Open and Newly Discovered Findings

Ordered by recommended remediation priority for the current developer-testing phase; deferred production migration work is excluded:

| Priority | Severity | Finding | Evidence / effect |
|---:|---|---|---|
| 1 | **HIGH** | Archived Fund stocks remain mutable through PATCH and DELETE/exit. | `adminCatalogRoutes.ts:550-635` checks the stock but not the parent Fund lifecycle. UI hiding is not authorization/business-rule enforcement. |
| 2 | **HIGH** | Correction prefill can lose financial precision. | `FundAumHistoryPanel.jsx:41-44` converts a supported up-to-19-digit paise string through `Number(snapshot.aumPaise) / 100`. Submitting an unchanged-looking value can persist a different amount above `Number.MAX_SAFE_INTEGER`. |
| 3 | **HIGH** | Backend idempotency hashes do not cover complete mutation bodies. | See Section 62. UI-generated keys reduce normal-path exposure but do not repair the server contract. |
| 4 | **MEDIUM** | Backend accepts zero-delta AUM growth commands. | `adminAumRoutes.ts:59-92` accepts `"0"` or `0`; direct callers can append no-op batches/snapshots even though current UI converters reject zero. |
| 5 | **MEDIUM** | AUM response projection omits stored provenance. | `adminAumRoutes.ts:179-187::mapSnapshot` drops `growthBatchId`, `note`, `publishedByUserId`, and `requestId` selected by `fundAumRepository.ts`. Current History cannot present full stored provenance. Whether disclosure is desired is a product/security decision. |
| 6 | **MEDIUM** | AUM field errors remain form-global. | `FundAumPanel.jsx:284-286`, `FundAumHistoryPanel.jsx:248-250`, and `AumScreen.jsx:479` render one alert; affected inputs lack `aria-invalid`/`aria-describedby`. `FundProfileForm.jsx:55-73` already demonstrates the stronger pattern. |
| 7 | **MEDIUM** | AUM maximum growth is not environment-wired. | Composition does not supply `maxGrowthBasisPoints`; `adminAumRoutes.ts:189-190` always uses the 100,000-bp fallback. `CLIENT_GROWTH_MAX_BASIS_POINTS` is a different domain setting. |
| 8 | **MEDIUM** | There is no AUM-specific rate limiter in either AUM route dependency graph. | The route modules depend on auth, DB, audit, and idempotency but no limiter. Global infrastructure behavior should be assessed before deciding the fix. |
| 9 | **MEDIUM** | Dedicated Admin Fund CRUD/lifecycle/stock backend coverage is still absent. | Backend search finds Fund detail only incidentally in `adminAum.integration.test.ts`; create/version/lifecycle/stock handlers have no dedicated integration suite. |
| 10 | **LOW** | AUM empty-picker copy tells operators to “un-archive one.” | `AumScreen.jsx:63-66` conflicts with archived filtering (`:25-27`) and final-archive copy in `FundWorkspace.jsx:192-196`. |
| 11 | **LOW** | Residual dead CSS and local dead shell code remain. | `.adm-status-badge*` in `admin-screens-shared.css:114-159` has no JSX caller; old `.adm-fund-*` responsive rules remain in `admin-responsive.css`; `AdminShell.jsx:1,20-29` has an unused `Suspense` import and `RouteFallback`. |
| 12 | **LOW** | Default danger text still uses raw signal red; `.be-error` uses physical `border-left`. | `kit-core.css:40-45,141-149`. Semantic hover/on-color is improved, but default dark contrast and RTL adaptability remain partial design-system issues. |
| 13 | **LOW** | Current AUM and Fund catalogue still independently project overlapping Fund/AUM/state/link content. | `AumScreen.jsx::CurrentAumTab` and `fundOps/FundsListScreen.jsx`; both are active task-specific views, so consolidation should target shared presentation pieces, not erase the route distinction. |

## 6. N/A, Deliberate Boundaries, and Unknowns

- Allocation remains a separate Investment Reviews acceptance capability. No Fund/AUM page allocation action was added.
- No unallocation implementation was found.
- Redemption remains absent from the Admin Fund/AUM architecture; payment/refund flows are separate. These are unchanged boundaries, not evidence that the current Fund/AUM remediation failed.
- Fund handlers still call repositories directly rather than a dedicated Fund service. This is unchanged architecture, not by itself a correctness defect.
- `adminFundGrowthPreviewRoutes.ts` remains an active, intentionally separate read-only planning endpoint for collective AUM growth.
- There is currently no production database in scope. The local disposable database, `schema_migrations` ledger, current rows, and physical schema were **UNKNOWN** because PostgreSQL at `127.0.0.1:5433` was unavailable.
- The deployed frontend API base and remote release environment remain **UNKNOWN** from the repository alone.

## 7. Reconciliation Verification

Commands were run without changing application source or database contents.

- Focused frontend Fund/AUM/cache/navigation/approvals tests: **191/191 passed** across six files.
- Backend AUM domain tests: **11/11 passed**.
- Backend TypeScript type-check: **passed**.
- Frontend production build and bundle-boot validation: **passed**.
  - `admin-funds-WhHSXgpj.js`: 30.66 kB (8.49 kB gzip)
  - `admin-aum-BQn4QZv5.js`: 26.94 kB (6.81 kB gzip)
  - Admin CSS: 88.90 kB (14.08 kB gzip)
- Backend production build: **passed**.
- Integration run covering Admin AUM and database invariants: **failed during migration 031**; 4 tests passed and 33 were skipped, including all 24 Admin AUM cases.
- Local PostgreSQL readiness check: `127.0.0.1:5433 - no response`.
- Repository search still finds no dedicated Admin Fund route integration suite and no generated Admin Fund/AUM OpenAPI contract.

Passing unit tests, type-checks, and builds establish source/build health but not database-backed behavior. Under the current developer-only policy, the migration failure is deferred; the skipped integration coverage remains a known evidence gap until a corrected/reset test schema is available.

## 8. Current Fix Order

1. Enforce archived-Fund immutability in stock PATCH and exit handlers and add dedicated Fund route coverage.
2. Make backend idempotency hashes cover the complete canonical request and send keys for stock writes.
3. Remove `Number` from correction prefill/financial conversion paths and test 19-digit paise values.
4. Decide and encode AUM eligibility for draft/paused Funds; apply the same rule in picker, preview, and commit.
5. Close the preview/commit chronology difference and reject zero-delta backend commands if no-op snapshots are not intentional.
6. Fix mobile prerequisite filtering, appended-page invalidation, AUM field-level errors, and the false “un-archive” copy.
7. Decide the public Admin snapshot provenance contract and complete/shared-generate the Fund/AUM API schemas.
8. Remove proven dead CSS/shell code, finish heading/design-token consolidation, and assess route-level CSS splitting.
9. **Before production release only:** establish the production schema baseline or repair the forward migration path, reconcile the stale `approval_actions` test, and require the full database integration suite to pass. Rollback/upgrade compatibility is not required during the present developer-testing phase.


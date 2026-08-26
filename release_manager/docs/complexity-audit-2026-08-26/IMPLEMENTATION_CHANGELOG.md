# Simplification Implementation Change Log

**Started:** 2026-08-26
**Scope:** Implementation of the approved simplification roadmap.
**Rule:** Source changes are limited to bounded roadmap slices; security-critical authentication, payment verification, and ledger invariants are preserved.

## 2026-08-26 — Initial implementation pass

### Completed

- Removed orphaned root Kimi scripts from `package.json` (`kimi:chunk`, `kimi:run`, `kimi:apply`).
- Removed unused root development dependencies `agent-browser` and `ngrok`; refreshed `package-lock.json`.
- Consolidated app-config HTTP calls onto the canonical client transport:
  - `frontend_stack/packages/shared/src/appConfig.js`
  - `frontend_stack/packages/client/src/hooks/useAppConfig.js`
  - `frontend_stack/packages/admin/src/screens/appBuilder/AppBuilderScreen.jsx`
- The app-config path now reuses canonical timeout, retry, authentication, CSRF, refresh, envelope, and error handling.

### Verification

- App-config targeted tests: 22 passed across 2 files.
- Frontend client/admin run after all current changes: 66 files passed, 1 file failed; 903 tests collected, 900 passed and 3 existing failures remain in `packages/admin/src/screens/fundStockListPanel.test.jsx`.
- `git diff --check`: passed for the completed transport slice.

### Additional completed slices

- Added frontend/API drift enforcement:
  - `packages/contracts/scripts/check-frontend-contract-drift.mjs`
  - `packages/contracts/scripts/frontend-contract-drift-baseline.json`
  - `packages/contracts/package.json`
  - The checker scans production frontend `/v1/...` calls, normalizes dynamic paths, compares them with the OpenAPI artifact, and records 74 currently known gaps so new drift fails CI.
- Removed unsupported redemption/withdrawal affordances rather than leaving a UI contract with no backend implementation:
  - Removed withdrawal route/navigation and `WithdrawalRequests.jsx`.
  - Removed redemption methods from `frontend_stack/packages/client/src/services/fundsApi.js`.
  - Removed package export, obsolete CSS, and affected tests/semantic references.
  - Backend was intentionally unchanged because migration `017_canonical_investing.sql` provides no redemption table or route.

### Verification for additional slices

- Contracts: typecheck, ESLint, 95 tests, 99.35% coverage, build/export/OpenAPI checks, and frontend drift check passed.
- Corrected the drift checker’s version-segment normalization so `/v1` is preserved; regenerated the baseline from 74 to 60 actual known path gaps. The checker now reports path-level drift accurately.
- Review note: the checker is intentionally a path-level guard in this pass; it does not yet validate HTTP methods or distinguish every executable string from literals/comments. Method-level contract generation remains a follow-up hardening task.
- Removed the stale `WithdrawalRequests` reference comment from `frontend_stack/packages/client/src/styles/mobile/fund-detail.css`.
- Redemption cleanup: 5 targeted frontend test files, 134 tests passed.
- Backend: 73 files, 663 tests passed.
- `git diff --check`: passed after all current changes.

### In progress

- Full repository verification and implementation review.

## Final review

- Implementation review completed with no remaining blocking or high-severity issues.
- Confirmed no executable references remain to `WithdrawalRequests`, `submitRedemption`, `listRedemptionRequests`, or `/app/withdrawals`.
- Confirmed root dependency/script removals have no remaining repository references.
- Remaining limitation: contract drift enforcement is path-level and baseline-based; it does not validate HTTP methods or request/response schemas, and 60 existing OpenAPI gaps remain explicitly recorded.

## Next roadmap slice — fixture cleanup

- Removed the three unreferenced client fixture modules:
  - `frontend_stack/packages/client/src/data/fixtureMandates.js`
  - `frontend_stack/packages/client/src/data/fixtureOrders.js`
  - `frontend_stack/packages/client/src/data/fixtureSipControlRequests.js`
- These files had no production or test imports in the repository scan. Full frontend verification is pending.

## Next roadmap slice — role helper hardening

- Added `frontend_stack/packages/shared/src/auth/roles.test.js` covering case-insensitive `role`, `accountType`, `roles[]`, empty-role, and absent-user behavior for the shared authorization selector.
- No server-side authorization behavior was changed.

### Preserved pre-existing worktree changes

- `release_manager/stacks/_shared/_boe_deploy.sh`
- `release_manager/tests/deploy_env_validation.test.sh`

These files were already modified before implementation began and were not altered by this work.

## Verification policy

Each subsequent entry must record:

1. Files changed and the roadmap item addressed.
2. Tests/checks run and results.
3. Any known failures or runtime verification still required.

## Role helper consolidation

- Consolidated client role checks into `frontend_stack/packages/shared/src/auth/roles.js`.
- Updated `frontend_stack/packages/client/src/services/authApi.js`, `frontend_stack/packages/client/src/layout/ClientLayout.jsx`, and `frontend_stack/packages/client/src/pages/Splash.jsx` to use the shared `hasRole(user, role)` implementation.
- Added the `@beonedge/shared/auth/*` package export while preserving the existing `authApi.hasRole` public export.
- The canonical helper now supports `role`, `accountType`, and `roles[]` consistently and safely returns `false` for an empty requested role.

Verification:

- `packages/client/src/pages/Splash.test.jsx`: 14 tests passed.
- `packages/client/src/layout/ClientLayout.test.jsx`: 21 tests passed.
- No source comments or new test files were added.
- Runtime verification of native/admin package resolution remains pending until the full frontend build is run.

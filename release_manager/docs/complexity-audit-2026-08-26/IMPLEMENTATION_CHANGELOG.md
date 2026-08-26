# Simplification Implementation Change Log

**Started:** 2026-08-26

**Last verified:** 2026-08-27

**Scope:** Bounded implementation slices from the approved simplification roadmap.

**Rule:** Authentication, authorization, payment verification, ledger integrity, and unresolved product decisions remain protected boundaries.

## Completed implementation slices

### Root dependency cleanup

- Removed orphaned root Kimi scripts from `package.json`.
- Removed unused root development dependencies `agent-browser` and `ngrok`.
- Regenerated the root lockfile.
- Repository search confirms no executable references remain.

### Canonical app-config transport

- Routed shared app-config reads and writes through the canonical frontend request transport.
- Updated:
  - `frontend_stack/packages/shared/src/appConfig.js`
  - `frontend_stack/packages/client/src/hooks/useAppConfig.js`
  - `frontend_stack/packages/admin/src/screens/appBuilder/AppBuilderScreen.jsx`
- App-config requests now share the established authentication, CSRF, refresh, retry, timeout, envelope, and error behavior.
- Broader app-config presentation/fixture separation remains a future roadmap slice.

### Unsupported withdrawal/redemption surface

- Removed the frontend route, navigation, page, service methods, styles, exports, and test references for the unsupported withdrawal/redemption workflow.
- Confirmed no executable references remain to:
  - `WithdrawalRequests`
  - `submitRedemption`
  - `listRedemptionRequests`
  - `/app/withdrawals`
- No backend route or table was removed because none existed.
- Product scope remains unresolved: restoring withdrawals requires one secure backend transaction and owner-scoped history model; permanent removal requires explicit product confirmation.

### Financial settlement characterization

- Expanded `backend_controller/src/domain/payments/applyCanonicalPaymentOutcome.test.ts` around canonical settlement behavior.
- Coverage includes amount/currency correlation, allocation and contribution writes, receipt acknowledgement, failure handling, contradictory state quarantine, and idempotent replay.
- Production settlement logic was not changed.

### Dead fixture cleanup

- Removed the unreferenced client fixture modules:
  - `fixtureMandates.js`
  - `fixtureOrders.js`
  - `fixtureSipControlRequests.js`
- Other active fixture-mode branches remain and have not been classified as removable.

### Shared role selector

- Added the canonical selector at `frontend_stack/packages/shared/src/auth/roles.js`.
- Consolidated client auth, layout, splash, and the browser admin guard onto the shared selector.
- Retained the focused authorization tests in `roles.test.js`; role-based access control is a security-sensitive boundary under the repository test policy.
- The admin guard continues to rely on the server-established admin principal and does not broaden authorization.

### Signed growth parsing

- Added `parseSignedGrowth()` in `frontend_stack/packages/admin/src/helpers/signedAmounts.js`.
- Updated `ClientValuesScreen.jsx` to use it for individual amount/percentage changes and collective percentage growth.
- Preserved the existing collective explicit-amount semantics.
- Broader paise conversion and delta-calculation consolidation remains incomplete.

### Frontend contract-drift guard

- Added `packages/contracts/scripts/check-frontend-contract-drift.mjs` and its reviewed baseline.
- The checker currently observes 74 frontend paths and 57 explicit request paths.
- The accepted baseline contains 60 path gaps and one method gap.
- It prevents additional statically visible path/method drift; it does not yet validate dynamic calls or complete request/response schemas.
- `.github/workflows/ci.yml` now runs `packages/contracts` verification, including the drift checker.

### Frontend workspace scope

- Restricted `frontend_stack/package.json` workspaces to:
  - `app`
  - `packages/admin`
  - `packages/client`
  - `packages/design-tokens`
  - `packages/shared`
- `@beonedge/ui-kits` is no longer resolved as an active workspace dependency.
- `frontend_stack/packages/ui-kits` and `frontend_stack/preview` remain tracked reference material pending an archival/removal decision.

### Admin compatibility aliases

- Removed `legacyTabMap.js` and `LegacyTabRedirect.jsx`.
- Removed the superseded `/admin/users/*`, `/admin/ops/*`, and `/admin/system/{support,audit-log}` aliases.
- Retained canonical section entry redirects.
- The active `pages/legacy/legacyRoutes.jsx` routing wrapper remains and requires a separate consolidation decision.

### Fund-stock regression repair

- Restored custom out-of-range validation feedback in `FundStockListPanel.jsx`.
- Replaced duplicated accessible row-action names with explicit action labels.

### CI verification correction

- Replaced obsolete backend CI commands with the package's real verification command.
- Added all 207 backend PostgreSQL integration tests; the unit check remains the enforced coverage gate.
- Added independent frontend test/build and contracts verification jobs.
- Pinned npm `11.16.0` to satisfy the strict backend/contracts engine contract.
- Added a critical infrastructure assertion to `release_manager/tests/runtime_contract.test.sh` so the required CI jobs and commands cannot silently disappear.

### Backend verification debt exposed by CI

- Fixed six production lint findings in PostgreSQL date parsing, worker heartbeat typing, AUM schemas, client-growth authorization, mandate idempotency replay, and health imports.
- Kept strict production lint rules and scoped `require-await` relief only to asynchronous test doubles.
- Corrected stale AUM history integration expectations to the canonical nullable `note` contract.
- Removed internal `publishedByUserId` and `requestId` fields from the public AUM snapshot mapper because the strict API contract does not expose them.

## Verification baseline

Verified on 2026-08-27:

- Frontend: 68 files, 903/903 tests passed.
- Frontend production build: passed.
- Frontend bundle boot: 11 chunks evaluated successfully.
- Backend: 73 files, 666/666 unit tests passed.
- Backend typecheck, lint, 80% coverage gate, production build, and source/distribution smoke checks: passed.
- Backend PostgreSQL integration: 18 files, 207/207 tests passed.
- Contracts: 6 files, 95/95 tests passed.
- Contracts typecheck, build, generated-artifact consistency, and drift check: passed.
- Release deployment environment validation: passed.
- Release runtime contract: passed.
- `git diff --check`: passed.

The standalone integration coverage profile currently reports less than 80%, so CI runs the complete integration behavior suite without its separate coverage threshold while `npm run check` enforces the backend's 80% unit/source coverage gate. Deployed runtime behavior, bookmarks/deep links, and production data remain runtime-verification boundaries.

## Commit sequence

- `81fd011` — simplify frontend contracts and unsupported withdrawals.
- `cb963a5` — characterize canonical payment settlement and remove dead fixtures.
- `51edbc7` — centralize frontend role checks.
- `c52cb6d` — cover shared role-check edge cases.
- `65ab0f7` — centralize signed growth parsing.
- `5001368` — detect frontend contract method drift.
- `3d09e0d` — scope frontend workspaces to active packages.
- `8444e8f` — record simplification implementation history.
- `a356b15` — remove obsolete admin route aliases.
- `0de72d1` — restore fund-stock validation feedback.
- Current correction slice — enforce CI verification, finish role-selector consolidation, and reconcile this log.

## Deliberately incomplete roadmap work

The following items are not represented as complete:

- Choosing and enforcing one complete API schema authority beyond the current drift baseline.
- Resolving the withdrawal/redemption product decision.
- Consolidating remaining amount/payment-state mappings and form primitives.
- Separating app-config presentation data from fixture/conversion concerns.
- Removing active fixture-mode branches and remaining legacy wrappers.
- SIP/AutoPay product-boundary changes.
- Forward-only orphan-table migrations and data-preservation checks.
- Redis, rate-limit, monitoring, and deployment-architecture changes.

These boundaries require the pending product, data-retention, and deployment decisions before implementation.

## Verification policy

Every subsequent entry must record:

1. Files changed and the roadmap item addressed.
2. Tests and checks run with exact results.
3. Known failures and runtime-verification requirements.
4. Product or data decisions that remain unresolved.

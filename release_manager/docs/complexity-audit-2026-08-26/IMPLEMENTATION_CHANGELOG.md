# Simplification Implementation Change Log

**Started:** 2026-08-26

**Last verified:** 2026-08-27

**Scope:** Bounded implementation slices from the approved simplification roadmap.

**Architecture decisions recorded:** 2026-08-27

- SIP/AutoPay is KEEP. The canonical recurring flow is backend scheduling and
  mandate validation -> PhonePe Notify Redemption -> PhonePe-managed debit and
  `STANDARD` retries -> backend webhook/status reconciliation and canonical
  settlement. Current source uses `autoDebit: true` and
  `redemptionRetryStrategy: "STANDARD"`; no Execute Redemption call is present.
- Email OTP Verification is KEEP but is not regulatory KYC. Migrations 040–042
  and active source now use durable `users.email_verification_*`,
  `email_verification_codes`, and `/v1/client/email-verification/*`; legacy
  source tables remain migration-only until deployed preservation/retention
  checks pass.
- `users` is the durable identity. The six designated legacy tables may be
  removed only through forward migrations after FK, row-count, financial-history,
  statutory-retention, and legal-hold checks.
- Dev and production are separate stacks at `/srv/dev_stack/BOE_APP/dev_release`
  and `/srv/dev_stack/BOE_APP/prod_release`, with separate PostgreSQL and Redis
  resources. PhonePe source/artifacts remain the same; environment selects the
  provider environment.
- Redis is KEEP for shared read caching and PostgreSQL fallback. It is not used
  by the current source for sessions, queues, locks, rate limiting, or worker
  coordination. The historical concurrency incident's causal link to Redis is
  not proven and remains a runtime/history verification item.
- The repository already tracks `release_manager/stacks/monitor_service` as an
  eight-service monitoring deployment. The requested target is an independent
  monitoring repository; no monitoring business logic should be added to BOE_APP.

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
- Product scope remains unresolved: restoring withdrawals requires one secure backend transaction and owner-scoped history model; permanent removal requires explicit product confirmation. Any future schema cleanup must preserve existing withdrawal/payment history if present.

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
- `frontend_stack/packages/ui-kits` and `frontend_stack/preview` were removed
  after confirming no workspace or production imports; the bundle contract
  guards the current app dependency/config boundary against reintroduction.

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

### Shared paise-to-rupee read conversion

- Added `frontend_stack/packages/shared/src/money.js::paiseToRupees()` as the
  single presentation-layer conversion for integer paise values.
- Updated admin formatters/fund mapping and client fund, order, portfolio,
  statement, and transaction adapters to use the shared helper; feature-specific
  signed/write parsing remains local to preserve command validation semantics.
- Added a package export so future screens do not reintroduce near-identical
  `/ 100` mappers; existing admin/client consumer coverage exercises the helper.
- Verification: targeted frontend suite passed (41/41 tests) and `git diff
  --check` passed. The complete frontend suite/build remains the release gate.

### Removed preview-only UI surfaces

- Removed the unreferenced `frontend_stack/packages/ui-kits` package and static
  `frontend_stack/preview` pages. Neither was a workspace member or imported by
  the shipped app; `app/src/bundleContract.test.js` already guarded against the
  package entering production bundles.
- Updated design-token scans and audit records to describe the removal. No
  application, authentication, payment, ledger, or monitoring code changed.
- Verification: full frontend tests and production build/bundle boot passed;
  `git diff --check` passed.

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
- 2026-08-28 closeout slice — remove runtime fixture business paths, consolidate
  payment/form presentation contracts, rename the active admin route registry,
  simplify app configuration, and harden refund callback correlation.

## 2026-08-28 open-contract closeout

- Added `frontend_stack/packages/shared/src/paymentStates.js` as the canonical
  frontend payment presentation vocabulary and wired client/admin payment
  surfaces to it. Client service mapping rejects payment statuses outside the
  client-safe projection.
- Made the shared form field the behavior owner and retained the admin component
  only as a styling adapter.
- Removed runtime fixture selection, fixture business data, stale disclosure
  fallbacks, and embedded product/research catalogues. HTTP failures no longer
  silently become plausible business records.
- Renamed `pages/legacy/legacyRoutes.jsx` to `pages/adminRoutes.jsx` and updated
  the active registry imports/tests.
- Removed the unused persistent rate-limit repository contract and the empty
  finance-policy seed path. Physical tables remain pending a separately reviewed
  forward migration and deployed data checks.
- Extracted refund callback application into
  `domain/payments/applyRefundOutcome.ts`. A verified callback now fails closed
  unless it correlates to a canonical local refund operation and provider
  evidence.
- Confirmed from source that refund initiation is not safely complete: no
  production caller creates `refund_operations`, and no atomic refund reversal
  updates `client_value_entries`. This is an accounting/product decision, not a
  safe inferred CRUD endpoint.
- Confirmed fund AUM is intentionally independent from client ledger value and
  retained the single-instance rate-limit architecture until horizontal backend
  scaling is actually introduced.
- Verification passed for the frontend production build and bundle boot, 900
  frontend tests, and the full backend `npm run check` with 666 tests and
  repository-wide coverage above 80%. All 208 database integration behaviors
  passed; the standalone integration invocation reports a non-zero exit only
  because that isolated subset has 78.39% coverage against the global 80%
  threshold.

## Deliberately incomplete roadmap work

The following items are not represented as complete:

- Choosing and enforcing one complete API schema authority beyond the current drift baseline.
- Resolving the withdrawal/redemption product decision.
- SIP/AutoPay source configuration already matches the accepted PhonePe-managed
  model; worker reachability and deployed scheduling still require runtime
  verification. No worker rewrite has been claimed complete.
- Email OTP terminology/storage migration and forward-only removal of the six
  designated legacy tables are committed in migrations
  `040_email_verification_schema.sql`, `041_email_verification_backfill.sql`,
  and `042_remove_legacy_compliance_tables.sql`, plus the corresponding source
  renames. They are not production-complete until migration tests,
  FK/preservation checks, retention approval, and deployed row/relationship
  counts pass. Populated-upgrade integration coverage is present; deployed
  database validation has not been executed here.
- Redis isolation is represented in both compose definitions but VPS isolation
  and the historical concurrency root cause remain runtime/history verification
  items.
- Refund initiation, deposit/manual receipt, withdrawal/redemption, and generic
  principal-adjustment contracts require explicit accounting and authorization
  decisions before implementation.
- Physical removal of `rate_limit_windows`, `finance_policy_versions`, or
  `legal_holds` requires deployed data/retention evidence and a forward migration.
- Monitoring is intentionally outside the current scope.

These boundaries require the pending product, data-retention, and deployment decisions before implementation.

## Verification policy

Every subsequent entry must record:

1. Files changed and the roadmap item addressed.
2. Tests and checks run with exact results.
3. Known failures and runtime-verification requirements.
4. Product or data decisions that remain unresolved.
